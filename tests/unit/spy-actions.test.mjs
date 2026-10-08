/**
 * The Spy's hands-on actions (user 2026-10-07: "The animation of the spy grabbing clothes or injecting poison should be
 * as realistic as possible"): abilities/spy-actions.js (sim plans and timelines), abilities/spy.js (the tasks),
 * art/spy-actions.js (the poses and props), art/clothesline.js (the line), art/syringe-prop.js (the syringe).
 *
 *  - injection: contact like the knife (behind within ±70° of his back: 0.41 m chest on back; front: 0.42 m, he turns
 *    to her), the kill at 0.5 s as the classic jab (the step inside it), the victim held, laid on his back (behind: his hips
 *    where he stood, she steps back 0.7 m; front: 0.3 m back), interruptible from hit + 0.15 s, silent, his cry muffled;
 *    no room: the classic jab (0.9 s, kill at 0.5 s)
 *  - uniform: the clothesline layout (the officer's cap between the tunic and the trousers); she walks to the spot in
 *    front of it, takes it (the uniform in her kit at 1.05 s), steps behind the laundry, is dressed at the swap; watched:
 *    the uniform in her kit, no dressing; U from the kit: dressed at 1.06 s, ends 1.58 s
 *  - poses on the real bodies (the Spy and a German rifleman GLB in node): the needle point at the carotid point (12 mm
 *    in), her palm on his mouth, chest on his back, the plunger pressed, his corpse pose reached before the settle
 *    ragdoll; the garments' corners in her palms, the line emptied piece by piece, the cap seated where the outfit's cap
 *    sits, the tunic's collar in her hand
 */
import { test, assert, near } from './lib.mjs';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeSim, guard } from './abilsim.mjs';
import { CONFIG } from '../../src/config.js';
import { B as BLOCK } from '../../src/world/grid.js';
import { injectionPlan, injectTimes, INJ, DRESS, dressTimes, takeSpot, coverSpot, lineFrame } from '../../src/abilities/spy-actions.js';
import { spyActionsFrame, injectMetrics, dressMetrics, VD } from '../../src/art/spy-actions.js';
import { makeClothesline, LAUNDRY, lineY } from '../../src/art/clothesline.js';
import { buildSyringe, setSyringeFill, syringeWeapon, TIP_Z, SYRINGE } from '../../src/art/syringe-prop.js';
import { BoneGuard } from '../../src/art/pose-blend.js';
import { equip } from '../../src/art/characters/commandos_b/weapons.js';
import { adaptClip } from '../../src/art/characters/pipeline/charkit.js';
import { headingToRotY } from '../../src/core/math.js';

const S = CONFIG.weapons.syringe;
const DEG = Math.PI / 180;

/** Sim with the Spy `d` m from a guard at (20, 20) facing east, at `deg` degrees off the guard's back. */
function setup(deg, d = 4, extra = {}) {
  const gx = 20, gz = 20, a = Math.PI + deg * DEG;
  const s = makeSim({ commandos: [{ role: 'spy', x: gx + Math.cos(a) * d, z: gz + Math.sin(a) * d, heading: a + Math.PI }],
    enemies: [guard('e1', gx, gz, 0)], ...extra }, { brains: false });
  return { s, spy: s.cmd('spy'), e: s.get('e1') };
}

/** Run a syringe order; per tick: the Spy, the guard. */
function runInject(s, spy, e, until = 4) {
  const rows = [];
  let start = null, kill = null, end = null;
  s.world.events.on('ability:start', (p) => { if (p.id === 'syringe') start ??= s.world.time; });
  s.world.events.on('ability:end', (p) => { if (p.id === 'syringe') end ??= s.world.time; });
  s.world.events.on('unit:killed', (p) => { if (p.unit === e) kill ??= s.world.time; });
  assert.ok(spy.issue({ type: 'ability', id: 'syringe', target: e }), 'syringe order');
  for (let i = 0; i < 60 * 12 && (end == null || s.world.time < end + 0.2); i++) {
    s.step();
    rows.push({ t: s.world.time, x: spy.x, z: spy.z, h: spy.heading, ex: e.x, ez: e.z, eh: e.heading, alive: e.alive, act: spy.currentActionId });
  }
  return { rows, start, kill, end, rec: (s.world.spyActs || []).find((r) => r.v === e) || null };
}

test('injection from behind: step in to chest-on-back contact, kill at 0.5 s as before, laid on his back, she steps back; silent', () => {
  const { s, spy, e } = setup(25);
  let muffled = null;
  s.world.events.on('unit:killed', (p) => { muffled = p.unit.muffledCry; });
  const { rows, start, kill, end, rec } = runInject(s, spy, e);
  assert.ok(rec && rec.side === 'behind', 'contact injection from behind');
  const P = rec.plan, T = rec.T;
  assert.ok(P.close >= 0.1 - 1e-9 && P.close <= 0.3 + 1e-9, `step ${P.close.toFixed(3)} s`);
  near(kill - start, S.hit, 1 / 60 + 1e-9, 'the kill at 0.5 s, as the classic jab (gameplay unchanged)');
  near(end - start, T.hit + INJ.endBehind, 1 / 60 + 1e-9, 'ends 1.25 s after the kill');
  assert.ok(T.needle >= P.close + 0.12 - 1e-9 && T.needle >= T.hit - 0.2 - 1e-9 && T.needle <= T.hit - 0.12 + 1e-9,
    `the needle in after the grab, 0.12–0.2 s before the kill: the plunger pressed (${T.needle.toFixed(2)} s)`);
  const hit = rows.find((r) => r.t >= kill - 1e-9);
  // at the hit: right behind him, chest on his back, facing his way
  const bx = P.v.x - Math.cos(P.v.h) * INJ.behind, bz = P.v.z - Math.sin(P.v.h) * INJ.behind;
  near(Math.hypot(hit.x - bx, hit.z - bz), 0, 1e-6, 'contact spot');
  // held until the kill (no slide, no turn)
  for (const r of rows.filter((q) => q.t >= start && q.alive)) { near(Math.hypot(r.ex - P.v.x, r.ez - P.v.z), 0, 1e-9, 'held'); near(r.eh, P.v.h, 1e-9); }
  // laid on his back: his body lies with its hips where he stood (the root 0.5 m ahead), a standing (supine) corpse
  assert.equal(e.alive, false); assert.equal(e.deathCause, 'injection'); assert.equal(e.stance, 'stand', 'on his back');
  near(Math.hypot(e.x - P.lie.x, e.z - P.lie.z), 0, 0.05, 'corpse spot');
  const ahead = (e.x - P.v.x) * Math.cos(P.v.h) + (e.z - P.v.z) * Math.sin(P.v.h);
  near(ahead, INJ.lieAhead, 0.05, 'his root 0.5 m ahead of where he stood (hips where his feet were)');
  // she stepped back 0.7 m as she lowered him, behind his head
  const last = rows[rows.length - 1];
  near(Math.hypot(last.x - P.back.x, last.z - P.back.z), 0, 1e-6, 'her step back');
  near(Math.hypot(P.back.x - bx, P.back.z - bz), INJ.stepBack, 1e-6, '0.7 m');
  assert.equal(s.count('noise'), 0, 'silent to the AI');
  assert.equal(muffled, true, 'the cry is muffled (her hand over his mouth)');
  assert.ok(!e.muffledCry, 'transient flag');
});

test('injection: not interruptible until he is dead; a move order then lets go (the action cut short)', () => {
  const { s, spy, e } = setup(10, 1.15);
  assert.ok(spy.issue({ type: 'ability', id: 'syringe', target: e }));
  s.run(0.2);
  assert.equal(spy.currentActionId, 'syringe');
  assert.equal(spy.issue({ type: 'move', x: 10, z: 10 }), false, 'held: no move before the kill');
  s.run(3, () => !e.alive);
  s.run(0.2);
  assert.equal(e.alive, false);
  assert.ok(spy.issue({ type: 'move', x: 10, z: 10 }), 'after the kill she can let go and go');
  assert.notEqual(spy.currentActionId, 'syringe');
  assert.ok((s.world.spyActs || [])[0]?.cancelled != null, 'the drawn lowering is told she let go');
});

test('injection from the front: he turns to her, a forearm apart (0.42 m), body 0.3 m back, ends hit + 0.95 s', () => {
  for (const deg of [180, 100]) {
    const { s, spy, e } = setup(deg);
    const { rows, start, kill, end, rec } = runInject(s, spy, e);
    assert.ok(rec && rec.side === 'front', `${deg}°: frontal`);
    const P = rec.plan, hit = rows.find((r) => r.t >= kill - 1e-9);
    near(Math.hypot(hit.x - P.v.x, hit.z - P.v.z), INJ.front, 1e-6, 'a forearm apart');
    near(kill - start, S.hit, 1 / 60 + 1e-9);
    near(end - start, rec.T.hit + INJ.endFront, 1 / 60 + 1e-9);
    const face = Math.atan2(P.v.z - hit.z, P.v.x - hit.x);
    near(Math.atan2(Math.sin(P.vh - (face + Math.PI)), Math.cos(P.vh - (face + Math.PI))), 0, 1e-6, 'he turned to her');
    near(Math.hypot(e.x - P.v.x, e.z - P.v.z), INJ.lieBack, 0.05, 'his body 0.3 m back');
    assert.equal(e.stance, 'stand');
  }
});

test('injection: no room to lay him down behind him (a wall at her back) → the classic jab, 0.9 s, kill at 0.5 s', () => {
  const { s, spy, e } = setup(0, 4);
  const g = s.world.grid;
  for (let dz = -1.5; dz <= 1.5; dz += 0.25) { const i = Math.floor((20 - 1.0) / g.cell), j = Math.floor((20 + dz) / g.cell); g.block[j * g.cols + i] = BLOCK.HIGH; }
  assert.equal(injectionPlan(s.world, { x: 19.3, z: 20, heading: 0, stance: 'stand', y: 0 }, e), null, 'no room');
  spy.setPosition(19.3, 20, 0);
  const { start, kill, end, rec } = runInject(s, spy, e);
  assert.equal(rec, null, 'no contact record');
  near(kill - start, S.hit, 1 / 60 + 1e-9, 'classic: kill at 0.5 s');
  near(end - start, S.dur, 1 / 60 + 1e-9, 'classic: 0.9 s');
  // a dog, a man prone, the switch off
  assert.equal(injectionPlan(s.world, spy, { ...e, soldierType: 'dog', kind: 'enemy', x: 25, z: 25, heading: 0 }), null, 'dog');
  CONFIG.abilities.syringeContact = false;
  try { assert.equal(injectionPlan(setup(25).s.world, { x: 19, z: 19.8, heading: 0, stance: 'stand', y: 0 }, setup(25).e), null, 'switch off'); }
  finally { delete CONFIG.abilities.syringeContact; }
});

// ------------------------------------------------------------------ uniform (sim)

test('clothesline layout: the officer\'s cap hangs between the tunic and the trousers; the shirt and the towel either side', () => {
  const g = makeClothesline({ uniform: true });
  const uni = g.getObjectByName('clothesline_uniform');
  for (const n of ['tunic', 'trousers', 'cap']) assert.ok(uni.getObjectByName('laundry_' + n), n + ' on the line, in the uniform group');
  for (const n of ['shirt', 'towel']) { const o = g.getObjectByName('laundry_' + n); assert.ok(o && o.parent === g, n + ' stays'); }
  assert.ok(LAUNDRY.tunic < LAUNDRY.cap && LAUNDRY.cap < LAUNDRY.trousers, 'tunic | cap | trousers');
  assert.ok(g.getObjectByName('clothesline_pegs'), 'pegs');
  const cap = uni.getObjectByName('laundry_cap'), b = new THREE.Box3().setFromObject(cap);
  assert.ok(b.max.y <= lineY(LAUNDRY.cap) + 0.02 && b.min.y > lineY(LAUNDRY.cap) - 0.4, 'the cap hangs just under the line');
  const tunic = uni.getObjectByName('laundry_tunic');
  assert.equal(tunic.userData.cloth.inv.filter((v) => v === 0).length, 3, 'the tunic pegged at three points');
});

function lineSim(spyAt = [10, 13.2], enemies = []) {
  const s = makeSim({ commandos: [{ role: 'spy', x: spyAt[0], z: spyAt[1] }], interactables: [{ kind: 'clothesline', id: 'cl', x: 11, z: 11 }], enemies }, { brains: false });
  return { s, spy: s.cmd('spy'), line: s.get('cl') };
}

test('clothesline: she walks to the cap\'s spot, takes the uniform (1.05 s), steps behind the laundry, is dressed at the swap', () => {
  const { s, spy, line } = lineSim();
  const take = takeSpot(s.world, spy, line);
  const F = lineFrame(line);
  near(Math.hypot(take.x - (F.x + F.ax * LAUNDRY.cap + F.nx * LAUNDRY.standOff), take.z - (F.z + F.az * LAUNDRY.cap + F.nz * LAUNDRY.standOff)), 0, 1e-9, 'in front of the cap, her side');
  let start = null, end = null, taken = null, dressed = null;
  s.world.events.on('ability:start', (p) => { if (p.id === 'use') start ??= s.world.time; });
  s.world.events.on('ability:end', (p) => { if (p.id === 'use') end ??= s.world.time; });
  assert.ok(spy.issue({ type: 'ability', id: 'use', target: line }));
  for (let i = 0; i < 60 * 10 && end == null; i++) {
    s.step();
    if (taken == null && line.count === 0) taken = s.world.time;
    if (dressed == null && spy.disguised) dressed = s.world.time;
  }
  const rec = s.world.spyActs[0], T = rec.T;
  assert.ok(Math.hypot(rec.plan.from.x - take.x, rec.plan.from.z - take.z) <= 0.45 + 1e-6, 'walked up to the spot');
  near(taken - start, DRESS.take, 1 / 60 + 1e-9, 'the uniform off the line at 1.05 s');
  assert.ok(rec.plan.cover, 'a spot behind the laundry');
  near(T.d0, DRESS.take + T.step, 1e-9);
  assert.ok(T.step >= DRESS.step[0] - 1e-9 && T.step <= DRESS.step[1] + 1e-9, `the step ${T.step.toFixed(2)} s`);
  near(dressed - start, T.swap, 2 / 60 + 1e-9, `dressed at the swap (${T.swap.toFixed(2)} s; before: 1.5 s)`);
  near(end - start, T.dur, 2 / 60 + 1e-9, `the action ${T.dur.toFixed(2)} s`);
  assert.ok(T.swap <= 2.5 && T.dur <= 3.2, 'close to the old 1.5 s');
  near(Math.hypot(spy.x - rec.plan.cover.x, spy.z - rec.plan.cover.z), 0, 1e-6, 'dressed behind the laundry');
  assert.ok(!spy.has('uniform') && spy.disguised, 'wearing it');
  assert.equal(line.count, 0);
});

test('clothesline: watched when she has taken it → the uniform in her kit, no dressing; behind the laundry = away from the nearest enemy', () => {
  // a guard 3.5 m off the line on her side, looking at it: she is seen as she takes it
  const { s, spy, line } = lineSim([10, 13.2], [guard('w', 11, 15, -Math.PI / 2)]);
  const take = takeSpot(s.world, spy, line);
  const cov = coverSpot(s.world, take, line);
  const F = lineFrame(line);
  const sideOf = (p) => Math.sign((p.x - F.x) * F.nx + (p.z - F.z) * F.nz);
  assert.ok(cov, 'a spot behind the laundry');
  assert.equal(sideOf(cov), -sideOf({ x: 11, z: 15 }), 'on the far side of the line from the guard');
  assert.equal(cov.duck, true, 'she would duck under the line where the uniform hung');
  assert.ok(spy.issue({ type: 'ability', id: 'use', target: line }));
  let start = null;
  s.world.events.on('ability:start', (p) => { if (p.id === 'use') start ??= s.world.time; });
  s.run(8, () => s.world.spyActs?.[0]?.abort != null);
  const rec = s.world.spyActs[0];
  assert.ok(rec.abort != null, 'stopped: watched');
  near(rec.abort, DRESS.take, 2 / 60 + 1e-9, 'as she took it');
  s.run(1);
  assert.ok(!spy.disguised && spy.has('uniform'), 'the uniform in her kit, not on her');
  assert.equal(line.count, 0, 'the line is bare');
  assert.ok(Math.hypot(spy.x - take.x, spy.z - take.z) < 1e-6, 'no step behind the laundry');
  void start;
});

test('U from the kit: dressed at 1.06 s (unwatched), the action 1.58 s; watched: refused as before', () => {
  const s = makeSim({ commandos: [{ role: 'spy', x: 10, z: 10, inventory: { uniform: 1, pistol: 1 } }] }, { brains: false });
  const spy = s.cmd('spy');
  let start = null, end = null, dressed = null;
  s.world.events.on('ability:start', (p) => { if (p.id === 'uniform') start ??= s.world.time; });
  s.world.events.on('ability:end', (p) => { if (p.id === 'uniform') end ??= s.world.time; });
  assert.ok(spy.issue({ type: 'ability', id: 'uniform', target: spy }));
  for (let i = 0; i < 300 && end == null; i++) { s.step(); if (dressed == null && spy.disguised) dressed = s.world.time; }
  const T = dressTimes('kit');
  near(dressed - start, T.swap, 1 / 60 + 1e-9, 'dressed');
  near(T.swap, DRESS.kitOut + DRESS.kit.swap, 1e-9);
  near(end - start, T.dur, 1 / 60 + 1e-9, 'ends');
  assert.ok(T.dur < 1.6, '≈ the old 1.5 s');
});

// ------------------------------------------------------------------ the props

test('syringe prop: glass barrel, the dose, plunger and needle; the plunger slides 37 mm as the thumb presses', () => {
  const g = buildSyringe();
  for (const n of ['syringe_barrel', 'syringe_dose', 'syringe_plunger', 'syringe_needle', 'syringe_bevel', 'syringe_flange', 'syringe_tip', 'syringe_thumb']) assert.ok(g.getObjectByName(n), n);
  near(g.getObjectByName('syringe_tip').position.z, TIP_Z, 1e-9);
  const thumb = () => new THREE.Vector3().setFromMatrixPosition(g.getObjectByName('syringe_thumb').matrixWorld);
  g.updateMatrixWorld(true); const z1 = thumb().z;
  setSyringeFill(g, 0); g.updateMatrixWorld(true); const z0 = thumb().z;
  near(z0 - z1, SYRINGE.travel, 1e-9, 'stroke');
  assert.equal(g.getObjectByName('syringe_dose').visible, false, 'empty');
  const w = syringeWeapon();
  assert.ok(w.sockets.grip_r && w.sockets.tip, 'weapon sockets for the commandos_b equip');
});

// ------------------------------------------------------------------ poses on the real bodies

const A = new URL('../../assets/characters/', import.meta.url).pathname;
async function glb(path) {
  const buf = readFileSync(A + path), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const L = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  L.register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(null) }));
  return new Promise((res, rej) => L.parse(ab, '', res, rej));
}
const meta = (sc) => { let u = sc.userData.shadowSix || null; if (!u) sc.traverse((o) => { if (!u && o.userData?.shadowSix) u = o.userData.shadowSix; }); return u || {}; };
const LIBS = new Map();
async function animLib(path) {
  if (!LIBS.has(path)) LIBS.set(path, glb(path).then((g) => ({ g, rest: meta(g.scene).pelvisRest })));
  return LIBS.get(path);
}
/** A UnitModel-shaped body (what art/spy-actions.js reads) on a character GLB, its clips from a UAL library. */
async function body(path, id, libPath) {
  const L = await animLib(libPath), g = await glb(path);
  const root = new THREE.Group(), bodyG = new THREE.Group(); bodyG.name = 'body'; root.add(bodyG); bodyG.add(g.scene);
  const bones = {}, parts = {};
  g.scene.traverse((o) => { if (o.isBone && !(o.name in bones)) bones[o.name] = o; if (o.isMesh) parts[o.name] = o; });
  const info = meta(g.scene), cache = new Map();
  const clip = (n) => {
    if (cache.has(n)) return cache.get(n);
    const c0 = L.g.animations.find((c) => c.name === n);
    const c = c0 ? adaptClip(c0, { srcPelvisRest: L.rest ? new THREE.Vector3(...L.rest) : null, tgtPelvisRest: info.pelvisRest ? new THREE.Vector3(...info.pelvisRest) : null, ratio: info.pelvisRatio || 1 }) : null;
    cache.set(n, c); return c;
  };
  const hgLog = [];
  const inner = { bones, parts, object: g.scene, clip, _post: [], weapon: null, setAnim() {}, showHeadgear(mode) { hgLog.push(mode); } };
  return { root, characterId: id, real: { inner, getSocket: (n) => bones[n] || null }, fallback: null, _guard: new BoneGuard(),
    _body: () => bodyG, _mw: new THREE.Matrix4(), setAnim() {}, update() {}, hgLog };
}
function mixer(m, name, t) {
  m._guard.restore();
  const c = m.real.inner.clip(name), B = m.real.inner.bones;
  if (!c) return;
  for (const tr of c.tracks) {
    const i = tr.name.lastIndexOf('.'), b = B[tr.name.slice(0, i)], p = tr.name.slice(i + 1);
    if (b && (p === 'quaternion' || p === 'position')) b[p].fromArray(tr.createInterpolant().evaluate(Math.min(t, c.duration - 1e-5)));
  }
}
function place(m, u) { m.root.position.set(u.x, 0, u.z); m.root.rotation.set(0, headingToRotY(u.heading), 0); m.root.updateMatrixWorld(true); }

async function injectPoses(deg) {
  const { s, spy, e } = setup(deg);
  const scene = new THREE.Scene();
  const am = await body('commandos/spy.glb', 'spy', 'anims/commando_anims.glb'), vm = await body('enemies/rifleman_v12.glb', 'rifleman_v12', 'anims/base_anims.glb');
  scene.add(am.root, vm.root);
  mixer(am, 'idle', 0); mixer(vm, 'idle', 0); place(am, spy); place(vm, e);
  equip(am.real.inner, { syringe: syringeWeapon() }, 'syringe', { clip: 'syringe' });
  spy.model = am; e.model = vm;
  let hitM = null, start = null, kill = null, lowEnd = null, held = 0, recRef = null;
  s.world.events.on('ability:start', () => { start ??= s.world.time; });
  s.world.events.on('unit:killed', () => { kill ??= s.world.time; });
  assert.ok(spy.issue({ type: 'ability', id: 'syringe', target: e }));
  const fills = [];
  for (let i = 0; i < 600 && (kill == null || s.world.time < kill + 1.3); i++) {
    s.step();
    mixer(am, spy.currentActionId === 'syringe' ? 'syringe' : 'idle', 0.2);
    if (e.alive) mixer(vm, 'idle', 0); else mixer(vm, s.world.time - kill > 1.2 ? 'dead' : 'die', s.world.time - kill);
    place(am, spy); place(vm, e);
    spyActionsFrame(s.world, 1, 1 / 60);
    const rec = (s.world.spyActs || [])[0];
    recRef ||= rec;
    if (rec && start != null && e.alive) held = Math.max(held, Math.hypot(vm.root.position.x - rec.plan.v.x, vm.root.position.z - rec.plan.v.z));
    if (rec && start != null) fills.push({ t: s.world.time - start, ...injectMetrics(spy, e) });
    if (kill != null && !hitM) hitM = injectMetrics(spy, e);
    if (kill != null && !lowEnd && s.world.time - kill >= 0.95) {   // his corpse pose reached (the 'dead' clip at the corpse spot)
      const B = vm.real.inner.bones, P = new THREE.Vector3();
      const keepP = vm.root.position.clone(), keepR = vm.root.rotation.y;
      const now = { pel: B.pelvis.getWorldPosition(new THREE.Vector3()), head: B.Head.getWorldPosition(new THREE.Vector3()) };
      const save = Object.fromEntries(Object.entries(B).map(([k, b]) => [k, [b.quaternion.clone(), b.position.clone()]]));
      mixer(vm, 'dead', 0); place(vm, e); vm.root.updateMatrixWorld(true);
      const want = { pel: B.pelvis.getWorldPosition(P.clone()), head: B.Head.getWorldPosition(P.clone()) };
      for (const [k, [q, p]] of Object.entries(save)) { B[k].quaternion.copy(q); B[k].position.copy(p); }
      vm.root.position.copy(keepP); vm.root.rotation.y = keepR; vm.root.updateMatrixWorld(true);
      lowEnd = { pel: now.pel.distanceTo(want.pel), head: now.head.distanceTo(want.head) };
    }
  }
  return { m: hitM, held, lowEnd, fills, rec: recRef, am };
}

test('poses (real bodies): from behind the needle point at the carotid (12 mm in), palm over his mouth, chest on his back, plunger home', async () => {
  const { m, held, lowEnd, fills, rec, am } = await injectPoses(20);
  assert.ok(m && m.side === 'behind', 'drawn from behind');
  console.log(`  inject from behind at the hit: needle-carotid ${m.tipCarotid.toFixed(3)} m (depth ${m.depth.toFixed(3)}), palm-mouth ${m.palmMouth.toFixed(3)} m, gap ${m.gap.toFixed(3)} m, fill ${m.fill}, grip ${m.gripFinger.toFixed(3)} m, thumb-disc ${m.thumbDisc.toFixed(3)} m; corpse pose at hit+0.95 s: pelvis ${lowEnd.pel.toFixed(3)} m, head ${lowEnd.head.toFixed(3)} m`);
  assert.ok(m.shown, 'the syringe in her hand');
  assert.ok(m.tipCarotid <= 0.03, `needle point at the carotid: ${m.tipCarotid.toFixed(3)} m`);
  assert.ok(m.depth > 0.005 && m.depth < 0.025, `needle in ${m.depth.toFixed(3)} m`);
  assert.ok(m.palmMouth <= 0.05, `palm on his mouth: ${m.palmMouth.toFixed(3)} m`);
  assert.ok(m.gap <= 0.03 && m.gap >= -0.06, `chest on his back: ${m.gap.toFixed(3)} m`);
  near(m.fill, 0, 1e-6, 'the plunger pressed home at the kill');
  assert.ok(m.thumbDisc <= 0.03, `her thumb on the plunger's disc (${m.thumbDisc.toFixed(3)} m)`);
  assert.ok(m.gripFinger <= 0.03, `the barrel in her fist (her curled middle finger ${m.gripFinger.toFixed(3)} m from its axis)`);
  const T = rec.T;
  const at = (t) => fills.find((f) => f.t >= t - 1e-6);
  assert.equal(at(0.02).shown, false, 'the syringe still in her pocket at the start');
  assert.equal(at(T.needle - 0.02).fill, 1, 'full until the needle is in');
  assert.ok(at((T.needle + T.hit) / 2).fill > 0.05 && at((T.needle + T.hit) / 2).fill < 0.95, 'pressing');
  assert.equal(at(T.dur - 0.05).shown, false, 'back in her pocket at the end');
  near(held, 0, 1e-6, 'his drawn root held where he stood');
  assert.ok(lowEnd.pel <= 0.03 && lowEnd.head <= 0.03, `laid down into his corpse pose (pelvis ${lowEnd.pel.toFixed(3)}, head ${lowEnd.head.toFixed(3)} m)`);
  assert.ok(am.real.inner.weapon && /syringe/.test(am.real.inner.weapon.name), 'the detailed syringe model in her hand');
});

test('poses (real bodies): from the front the needle into the left side of his neck, her hand on his collar', async () => {
  const { m } = await injectPoses(180);
  assert.ok(m && m.side === 'front');
  console.log(`  inject from the front at the hit: needle-carotid ${m.tipCarotid.toFixed(3)} m, roots ${m.root.toFixed(3)} m`);
  assert.ok(m.tipCarotid <= 0.03, `needle at the carotid: ${m.tipCarotid.toFixed(3)} m`);
  near(m.root, INJ.front, 0.02, 'a forearm apart');
});

test('poses (real bodies): the garments come off the line one by one into her hands, the cap onto her head, the tunic by its collar', async () => {
  const { s, spy, line } = lineSim();
  const scene = new THREE.Scene();
  const am = await body('commandos/spy.glb', 'spy', 'anims/commando_anims.glb');
  const g = makeClothesline({ uniform: true });
  g.position.set(line.x, 0, line.z); scene.add(g, am.root); g.updateMatrixWorld(true);
  line.object3d = g;
  mixer(am, 'idle', 0); place(am, spy);
  spy.model = am;
  assert.ok(spy.issue({ type: 'ability', id: 'use', target: line }));
  let start = null;
  s.world.events.on('ability:start', () => { start ??= s.world.time; });
  const log = [];
  for (let i = 0; i < 60 * 8; i++) {
    s.step();
    mixer(am, 'idle', 0); place(am, spy);
    spyActionsFrame(s.world, 1, 1 / 60);
    if (start != null) log.push({ t: s.world.time - start, ...dressMetrics(spy, line) });
    if (start != null && !s.world.spyActs?.length) break;
  }
  const at = (t) => log.find((q) => q.t >= t - 1e-6);
  const before = at(0.1), first = at(VD.peg2 + 0.02), pulled = at(VD.peg2 + VD.leftLag + 0.02), rolled = at(VD.roll[1] + 0.05), capped = at(VD.capGrab + 0.1);
  assert.ok(before.onLine.tunic && before.onLine.trousers && before.onLine.cap, 'all on the line at first');
  console.log(`  clothesline: corners in the palms ${pulled.corner_l} / ${pulled.corner_r} m; cap ${capped.capParent} (${capped.capToPalm} m from the palm)`);
  assert.ok(pulled.corner_l <= 0.02 && pulled.corner_r <= 0.02, 'each garment pinched in a hand (≤ 2 cm)');
  assert.equal([first.onLine.tunic, first.onLine.trousers].filter(Boolean).length, 1, 'one garment off its pegs, the other still pegged');
  assert.ok(!pulled.onLine.tunic && !pulled.onLine.trousers && pulled.onLine.cap, 'then the other; the cap still hangs');
  assert.ok(rolled.bundle, 'rolled under her arm');
  assert.equal(capped.capParent, 'hand_r', 'the cap off its peg in her right hand');
  assert.ok(capped.capToPalm <= 0.16, 'in her fist (cap origin at its band)');
  // the cap seated exactly where the outfit's own cap sits, then that one shows; the tunic's collar in her hand
  const seat = log.filter((q) => q.capToWorn != null).map((q) => q.capToWorn);
  assert.ok(Math.min(...seat) <= 0.01, `the cap seated on her head (${Math.min(...seat).toFixed(4)} m from the worn cap)`);
  const tc = log.filter((q) => q.tunicCorner != null).map((q) => q.tunicCorner);
  assert.ok(tc.length && Math.max(...tc) <= 0.02, `the tunic's collar in her right hand (≤ 2 cm: ${tc.length ? Math.max(...tc).toFixed(4) : '-'})`);
  assert.equal(am.hgLog.join(','), 'none,', 'her own cap off (no headgear while the officer\'s hangs on the line), the outfit\'s own once it is on');
  assert.equal(am.hgLog[am.hgLog.length - 1], null, 'the outfit\'s own headgear after the swap');
  const last = log[log.length - 1];
  assert.ok(!last.onLine.tunic && !last.onLine.trousers && !last.onLine.cap, 'the line left with the shirt and the towel');
  assert.ok(spy.disguised, 'dressed');
});
