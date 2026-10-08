/**
 * "Commandos get stuck and don't respond to my go-to-location orders (they can stand and crawl)" (user, tutorial).
 * A soak through the real input layer (engine/input.js click → orderMove → Commando.issue, a stub top-down camera)
 * on the real tutorial map (m00, built with its meshes so crawl steps and nav stamps are in) and M1 / M2: random
 * ground clicks (walk and double-click run) for every commando in both stances, mixed with what a player does between
 * them — the pistol (G) fired and its cursor left by Esc, the bag icon, another item or another man, the knife, stance
 * toggles (C / S, the HUD icon) and orders given mid-animation. Every move click must either move the man (he leaves
 * where he stood and gets to the end of his path) or be refused with the game's message ("can't get there") because
 * there truly is no way there; "order accepted but he does not move" and "order silently ignored" fail the soak.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { buildMap } from '../../src/world/map-builder.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { getMission } from '../../src/missions/index.js';
import { placeSpawn } from '../../src/world/placement.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { Input } from '../../src/engine/input.js';
import { firstAidCarrier, FIRST_AID_DOSES, defaultInventory } from '../../src/items.js';
import { stubBrain } from './abilsim.mjs';
import { pathLength } from '../../src/world/pathfinding.js';

const PPM = 40; // stub camera: 40 px per metre, top-down

/** A mission as Game.loadMission builds it (map with its meshes, units placed by the placement rules), brains inert. */
export function missionSim(id, { meshes = true } = {}) {
  const def = normalizeMission(getMission(id), { quiet: true });
  const world = new World({ size: def.size, scene: new THREE.Scene(), mission: def, seed: def.seed ?? 7 });
  buildMap(world, def, { meshes });
  world.debug = { invulnerable: true, noDetect: true }; // (the ?debug inspection flags: a vehicle's gunner shoots no one)
  world.vehicleFactory = (s) => new Vehicle(s);
  const free = (x, z, s) => world.grid.walkableAt(x, z) && Math.abs((world.grid.elevAt?.(x, z) ?? 0) - (s.y ?? 0)) < 0.3;
  const medic = firstAidCarrier(def.commandos.map((c) => c.role));
  for (const c of def.commandos) {
    const s = { ...c, campaign: world.campaign, inventory: c.inventory ? { ...c.inventory } : undefined };
    if (s.role === medic && s.inventory?.firstAid === undefined && def.firstAid !== false) s.inventory = { ...(s.inventory || defaultInventory(s.role)), firstAid: FIRST_AID_DOSES };
    const u = new Commando(placeSpawn(s, world.placement, free));
    world.add(u);
    if (c.stance === 'crawl') { u.setStance('crawl'); u._stanceT = 0; }
  }
  for (const e of def.enemies) { const en = new Enemy(placeSpawn(e, world.placement, free)); en.brain = stubBrain(en); world.add(en); }
  for (const v of def.vehicles || []) world.spawnVehicle(v.vehicleType || 'truck', v);
  world.rebuildSpatial();
  const cameraController = {
    worldToScreen: (x, y, z) => ({ x: x * PPM, y: z * PPM - y * PPM * 0.5 }),
    screenToGround: (sx, sy) => ({ x: sx / PPM, z: sy / PPM }),
    pxPerMeter: () => PPM, isOnScreen: () => true, recenterOn() {}, track() {}, untrack() {},
  };
  const queue = [];
  const game = { world, state: 'playing', cameraController, enqueue: (fn) => queue.push(fn), events: world.events, options: {}, toggleCone() {} };
  const inp = new Input(game, null);
  const msgs = [], orders = [];
  world.events.on('message', (m) => msgs.push({ t: world.time, unit: m.unit, text: m.text }));
  world.events.on('unit:order', (e) => orders.push({ t: world.time, unit: e.unit, order: e.order }));
  const step = (dt = 1 / 60) => {
    for (const fn of queue.splice(0)) fn(); // Game.step: queued orders first
    world.rebuildSpatial();
    world.refreshDynamicOccluders();
    for (const list of [world.commandos, world.enemies]) for (const e of [...list]) if (!e.removed) e.update(dt);
    world.runBelTicks(dt);
    for (const list of [world.vehicles, world.projectiles, world.interactables]) for (const e of [...list]) if (!e.removed) e.update(dt);
    world.flushRemovals();
    world.time += dt;
    world.tick++;
  };
  const run = (s, until) => { for (let k = Math.round(s * 60); k > 0; k--) { step(); if (until?.()) return true; } return false; };
  const scr = (x, z) => cameraController.worldToScreen(x, 0, z);
  return { def, world, inp, game, step, run, scr, msgs, orders, queue };
}

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t + 7 >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const KEY = (code) => ({ code, key: code, target: null, repeat: false, preventDefault() {}, stopPropagation() {} });
const fmt = (p) => `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;

/**
 * Was a refused move order really impossible? With no bare grid route (his own path options, no body clearance) at all,
 * yes. With one, he is walked along it as it is (no planning): if he gets to its end, the refusal was wrong (a bug).
 * @returns {boolean} reachable after all
 */
function reachable(S, c, x, z) {
  const w = S.world, p = w.findPath(c.x, c.z, x, z, c.pathQuery());
  if (!p) return false;
  const end = p[p.length - 1];
  c.path = p; c.pathIndex = p.length > 1 ? 1 : 0; c.moveTarget = end; c._onArrive = null; c._pathGridVersion = w.grid.version;
  S.run(pathLength(p) / Math.max(0.5, c.speed) * 1.6 + 6, () => !c.path);
  if (c.path) c.stop();
  return Math.hypot(c.x - end.x, c.z - end.z) <= 1.2;
}

/**
 * Click the ground at (x, z) through Input.click with `c` alone selected; step until he arrives (or the time a walk
 * there takes, ×1.6 + 6 s). @returns {{kind: string, ...}} 'moved' | 'arrived' | 'refused' (with the message) |
 * 'silent' (no order and no message) | 'stuck' (order taken, he never left) | 'short' (stopped well short) | 'skip'
 */
export function clickMove(S, c, x, z, { run = false } = {}) {
  const { inp, world: w, scr, msgs, orders } = S;
  inp.select([c]);
  const p = scr(x, z);
  const m0 = msgs.length, o0 = orders.length, x0 = c.x, z0 = c.z;
  inp._lastClick = null;
  const r = inp.click(p.x, p.y, { double: run });
  if (r !== 'move' && r !== 'run') return { kind: 'skip', r };
  for (const fn of S.queue.splice(0)) fn(); // the queued order (Game.step runs it at the start of the next tick)
  const took = orders.slice(o0).some((o) => o.unit === c && o.order.type === 'move');
  const said = msgs.slice(m0).filter((m) => m.unit === c).map((m) => m.text);
  if (!took) {
    const why = { at: fmt(c), to: fmt({ x, z }), stance: c.stance, armed: c.armed, state: c.state, said };
    if (!said.length) return { kind: 'silent', ...why };
    return { kind: 'refused', ...why, reachable: reachable(S, c, x, z) };
  }
  // (where his path ends: a click on a building or into water is walked to the nearest spot he can reach)
  const end = c.moveTarget ? { x: c.moveTarget.x, z: c.moveTarget.z } : { x, z };
  let L = 0;
  const P = c.path || [];
  for (let k = 1; k < P.length; k++) L += Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z);
  S.step();
  const T = L / Math.max(0.5, c.speed) * 1.6 + 6;
  let moved = 0;
  for (let t = 0; t < T && c.path; t += 0.25) { S.run(0.25); moved = Math.max(moved, Math.hypot(c.x - x0, c.z - z0)); }
  const dEnd = Math.hypot(c.x - end.x, c.z - end.z);
  const told = msgs.slice(m0).filter((m) => m.unit === c).map((m) => m.text);
  const info = { at: fmt({ x: x0, z: z0 }), to: fmt({ x, z }), now: fmt(c), stance: c.stance, L: +L.toFixed(1), dEnd: +dEnd.toFixed(2), moved: +moved.toFixed(2), said: told };
  if (c.path) c.issue({ type: 'stop' });
  if (dEnd <= 1.2) return { kind: 'arrived', ...info }; // (the step guard stops him ≤ 1.2 m short of a solid at the end)
  // order taken, he never left: with the game's "can't get there" at least (blocked: the step guard gave up), else stuck
  if (moved < 0.3) return { kind: told.some((t) => /can't get there/.test(t)) ? 'blocked' : 'stuck', ...info };
  return { kind: 'short', ...info };
}

/** The ways a player leaves the pistol cursor (§3.2) other than a shot — and right-click, which holsters. */
const LEAVE_PISTOL = ['esc', 'bag', 'otherTool', 'otherMan', 'rightClick'];

function leavePistol(S, c, how) {
  const { inp, world: w } = S;
  switch (how) {
    case 'esc': inp._keyDown(KEY('Escape')); break;
    case 'bag': inp.cancelTargeting(); break; // knapsack.activate: a click on the armed item's icon again
    case 'otherTool': { const id = ['knife', 'decoy', 'bearTrap', 'sniper', 'grenade'].find((a) => c.abilities.includes(a)); if (id) inp.beginTargeting(id); inp.cancelTargeting(); break; }
    case 'otherMan': { const o = w.commandos.find((u) => u !== c && u.alive); if (o) inp.select([o]); break; }
    case 'rightClick': inp.rightClick(); break;
  }
  S.step();
}

/** Fire the pistol (G, a click on an enemy in range) as the player does; @returns whether a shot went off. */
function pistolShot(S, c) {
  const { inp, world: w, scr } = S;
  const e = w.enemies.filter((q) => q.alive).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
  if (!e || !c.abilities.includes('pistol')) return false;
  inp.select([c]);
  if (!inp.beginTargeting('pistol')) return false;
  const p = scr(e.x, e.z);
  inp._lastClick = null;
  inp.click(p.x, p.y, { double: false });
  S.run(0.8);
  if (c.armed === 'pistol') return true;
  inp.rightClick(); // no shot (out of reach, no line of fire): the cursor put away
  S.step();
  return false;
}

/**
 * Random soak of one mission: per commando `perMan` ground clicks, each after a random lead-in (a stance key mid-way
 * through nothing, the HUD stance icon, the pistol fired and its cursor left one of the LEAVE_PISTOL ways, or nothing).
 * @param {{pistol?: boolean, onBad?: Function}} [o] pistol: false leaves the pistol out (to soak the rest on a build
 *   where it would jam every later order); onBad(S, man, outcome, click) is called on each bad outcome (debugging)
 * @returns {{counts: object, bad: object[], stops: object[]}} stops: the short / blocked walks
 */
export function soak(S, seed, perMan, { pistol = true, onBad = null } = {}) {
  const R = rng(seed), w = S.world, counts = {}, bad = [], stops = [];
  const add = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const near = (x, z) => [...w.commandos, ...w.enemies].some((u) => u.alive && Math.hypot(u.x - x, u.z - z) < 1.6);
  const point = (c) => {
    for (let k = 0; k < 30; k++) {
      // half the clicks anywhere on the map, half within 12 m of him (round the buildings, steps and drifts he is at)
      const far = R() < 0.5, x = far ? 1 + R() * (w.width - 2) : c.x + (R() - 0.5) * 24, z = far ? 1 + R() * (w.depth - 2) : c.z + (R() - 0.5) * 24;
      if (x > 0.5 && z > 0.5 && x < w.width - 0.5 && z < w.depth - 0.5 && !near(x, z)) return { x, z };
    }
    return null;
  };
  for (const c of w.commandos) {
    if (!c.alive) continue;
    for (let n = 0; n < perMan; n++) {
      const roll = R();
      let pre = 'plain';
      if (roll < 0.15) { const s = c.stance === 'crawl' ? 'stand' : 'crawl'; S.inp.select([c]); S.inp._keyDown(KEY(s === 'crawl' ? 'KeyC' : 'KeyS')); S.step(); pre = `key-${s}`; } // mid-animation: no wait
      else if (roll < 0.25) { c.issue({ type: 'stance', stance: c.stance === 'crawl' ? 'stand' : 'crawl' }); S.run(0.8); pre = 'hud-stance'; }
      else if (roll < 0.4 && pistol) { const how = LEAVE_PISTOL[Math.floor(R() * LEAVE_PISTOL.length)]; if (pistolShot(S, c)) { leavePistol(S, c, how); pre = `pistol-${how}`; } }
      const t = point(c);
      if (!t) continue;
      const o = clickMove(S, c, t.x, t.z, { run: R() < 0.3 });
      add(o.kind);
      const wrong = o.kind === 'silent' || o.kind === 'stuck' || (o.kind === 'refused' && o.reachable);
      if (wrong) { bad.push({ seed, role: c.role, pre, ...o }); onBad?.(S, c, o, t); }
      else if (o.kind === 'short' || o.kind === 'blocked') stops.push({ seed, role: c.role, pre, ...o });
    }
  }
  return { counts, bad, stops };
}

test('stuck orders: after the pistol, Esc / the bag icon / another item / another man leave him able to walk', () => {
  for (const how of LEAVE_PISTOL) {
    const S = missionSim('m00', { meshes: false });
    const gb = S.world.commandos.find((c) => c.role === 'greenberet');
    const en = S.world.enemies.find((e) => e.alive);
    gb.setPosition(en.x - 8, en.z, 0); S.step();
    assert.ok(pistolShot(S, gb), `${how}: the pistol is drawn and fired`);
    leavePistol(S, gb, how);
    assert.equal(S.inp.targeting, null, `${how}: no item cursor up`);
    const o = clickMove(S, gb, gb.x - 6, gb.z + 3);
    assert.ok(o.kind === 'arrived', `${how}: a click on the ground walks him there (${JSON.stringify(o)})`);
    assert.equal(gb.armed, null, `${how}: the pistol is holstered`);
  }
});

test('stuck orders: the pistol then the knife (K) — after the kill he walks again', () => {
  const S = missionSim('m00', { meshes: false });
  const w = S.world, gb = w.commandos.find((c) => c.role === 'greenberet');
  const [e1, e2] = w.enemies.filter((e) => e.alive);
  gb.setPosition(e1.x - 8, e1.z, 0); S.step();
  assert.ok(pistolShot(S, gb), 'pistol fired');
  S.inp.beginTargeting('knife');
  const p = S.scr(e2.x, e2.z);
  S.inp._lastClick = null;
  assert.equal(S.inp.click(p.x, p.y, { double: true }), 'ability');
  S.run(40, () => !e2.alive && !gb.currentAction && !gb.pendingAbility);
  assert.ok(!e2.alive, 'the knife killed him');
  const o = clickMove(S, gb, gb.x + 5, gb.z + 2);
  assert.equal(o.kind, 'arrived', `walks after the kill (${JSON.stringify(o)})`);
});

test('stuck orders: a pistol still drawn with no pistol cursor (a shot queued as the cursor went) — a move click holsters and walks', () => {
  const S = missionSim('m00', { meshes: false });
  const w = S.world, gb = w.commandos.find((c) => c.role === 'greenberet'), en = w.enemies.find((e) => e.alive);
  gb.setPosition(en.x - 8, en.z, 0); S.step();
  S.inp.select([gb]);
  S.inp.beginTargeting('pistol');
  const p = S.scr(en.x, en.z);
  S.inp._lastClick = null;
  S.inp.click(p.x, p.y, { double: false }); // queued shot …
  S.inp._keyDown(KEY('Escape')); // … and Esc in the same frame
  S.run(0.8);
  const o = clickMove(S, gb, gb.x - 5, gb.z - 3);
  assert.equal(o.kind, 'arrived', `walks (${JSON.stringify(o)})`);
  assert.equal(gb.armed, null);
  // the sim rule (§3.2: moves refused while drawn) still holds for a drawn pistol, but never silently
  gb.armed = 'pistol';
  const m0 = S.msgs.length;
  assert.equal(gb.issue({ type: 'move', x: gb.x + 3, z: gb.z }), false, 'refused while drawn');
  assert.ok(S.msgs.slice(m0).some((m) => m.unit === gb), 'with a message');
});

/** Put `role` at (x, z) facing `h` in `stance` (others well away), settled; @returns the man */
function placeMan(S, role, x, z, h, stance = 'stand') {
  const w = S.world, c = w.commandos.find((u) => u.role === role);
  w.commandos.forEach((u, k) => { if (u !== c) u.setPosition(3 + 2 * k, 3, 0); });
  c.setPosition(x, z, h);
  if (stance !== c.stance) { c.setStance(stance); c._stanceT = 0; }
  S.run(0.1);
  c.setPosition(x, z, h);
  S.step();
  return c;
}

test('stuck orders: a crawler lying with his head at the compound sandbags (m00) turns away from them and crawls off', () => {
  // (the soak's find, m00 seed 3: every turn east swept his head or legs through the bags, both ways round, so the step
  // guard undid every step — the order was taken and he never moved)
  const S = missionSim('m00');
  const c = placeMan(S, 'sapper', 47.369, 24.099, 2.476, 'crawl');
  const o = clickMove(S, c, 50.47, 24.2);
  assert.equal(o.kind, 'arrived', JSON.stringify(o));
});

test('stuck orders: a man on his feet whose way grazes a solid slides along it (M2, the Marine by the dock drums)', () => {
  // (a disc on his feet: the step guard's "turn in place" was always clear and came before the slides — he stood still,
  // re-planned the same way three times and stopped, silently, from there to anywhere north or west)
  const S = missionSim('m02');
  const c = placeMan(S, 'diver', 49.914, 36.22, 0.924);
  const x0 = c.x, z0 = c.z;
  S.inp.select([c]);
  assert.ok(c.issue({ type: 'move', x: 10.15, z: 37.23 }), 'order taken');
  S.run(8);
  assert.ok(Math.hypot(c.x - x0, c.z - z0) > 2, `he is on his way (${fmt(c)})`);
});

test('stuck orders: a walk the step guard gives up on says "can\'t get there" (never a man who just stops)', () => {
  // (M2 gate_se: the grid passes between the boom post and its fork rest, a slot a crawler's body cannot turn into)
  const S = missionSim('m02');
  const c = placeMan(S, 'diver', 58.41, 47.06, 0.8, 'crawl');
  const o = clickMove(S, c, 52.17, 41.4);
  assert.ok(o.kind === 'arrived' || o.kind === 'short' || o.kind === 'blocked', JSON.stringify(o));
  if (o.kind !== 'arrived') assert.ok(o.said.some((t) => /can't get there/.test(t)), `told (${JSON.stringify(o)})`);
});

for (const [id, seeds, per] of [['m00', [1, 2, 3, 4, 5, 6, 7, 8], 14], ['m01', [11, 12, 13], 10], ['m02', [21, 22, 23], 10]]) {
  test(`stuck orders: ${id} soak — random clicks for every commando, both stances, pistol / stance / mid-animation between (${seeds.length} seeds)`, () => {
    const all = { counts: {}, bad: [], stops: [] };
    for (const seed of seeds) {
      const r = soak(missionSim(id), seed, per);
      for (const [k, v] of Object.entries(r.counts)) all.counts[k] = (all.counts[k] || 0) + v;
      all.bad.push(...r.bad);
      all.stops.push(...r.stops);
    }
    const C = all.counts, moves = (C.arrived || 0) + (C.short || 0) + (C.stuck || 0) + (C.blocked || 0);
    assert.ok(moves > seeds.length * 8, `enough move clicks went through (${JSON.stringify(C)})`);
    assert.equal(all.bad.length, 0, `${id}: ${all.bad.length} stuck / ignored orders (${JSON.stringify(C)}):\n${all.bad.slice(0, 12).map((b) => JSON.stringify(b)).join('\n')}`);
    // stopping well short of the planned end stays rare: silently (a mate in the way, out of time) ≤ 5 %, and with the
    // game's "can't get there" (a solid the step guard gave up on: M2's gate_se slot for a crawler) ≤ 10 %
    const told = all.stops.filter((b) => b.said?.length), list = (L) => L.slice(0, 12).map((b) => JSON.stringify(b)).join('\n');
    assert.ok(all.stops.length - told.length <= Math.max(2, moves * 0.05), `few silent short stops (${JSON.stringify(C)}):\n${list(all.stops.filter((b) => !b.said?.length))}`);
    assert.ok(told.length <= Math.max(2, moves * 0.1), `few walks given up (${JSON.stringify(C)}):\n${list(told)}`);
  });
}
