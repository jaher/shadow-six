/**
 * BEL M17 "Before Dawn" (docs/missions/m17.md): schema + §10.5 test #14, the map's connectivity puzzle (gorge,
 * back gate, gateway), the exact §3.8 loadout, the Kildread census, the zones and garrisons, the three
 * set-pieces (sliding bridge, back-gate box, fuel valve), the pillbox blast, the pen and the five prisoners,
 * and the lorry extraction.
 * Run with the unit suite: node tests/unit/run.mjs m17
 */
import { test, assert } from '../unit/lib.mjs';
import { checkMission, loadGrid } from '../unit/mission-check.mjs';
import { MISSIONS, CAMPAIGNS, getMission } from '../../src/missions/index.js';
import { validateMission } from '../../src/missions/schema.js';
import { findPath } from '../../src/world/pathfinding.js';
import { belLoadout, spawnInventory } from '../../src/items.js';
import { B } from '../../src/world/grid.js';
import { makeSim } from '../unit/abilsim.mjs';
import { Alarm } from '../../src/ai/alarm.js';
import { createObjectives, checkObjectives, updateExtractionVehicle } from '../../src/core/objectives.js';
import { GUESTS } from '../../src/missions/scripts/m17.js';
import { DECK, GATEWAY, PEN_DOOR, PEN_GATE, BACK_GATE, SEND_ON_BLAST } from '../../src/missions/m17_before_dawn.js';
import { coneAt, pointInCone } from '../../src/ai/perception.js';
import { restoreWorld } from '../../src/save.js';
import { Entity } from '../../src/entities/entity.js';
import { ABILITIES, unmaskSpy } from '../../src/abilities/index.js';
import { setLockedGate } from '../../src/missions/scripts/m17.js';

const M = () => getMission('m17');
const reach = (g, a, b, role = 'spy', o = {}) => !!findPath(g, a.x, a.z, b.x, b.z, { role, maxNodes: 400000, ...o });
const pt = (x, z) => ({ x, z });
const START = pt(2.7, 156.8), S_FIELD = pt(72, 170), W_STRIP = pt(10, 110), N_BANK = pt(30, 52), TRUCK = pt(9, 16);
const LOWER = pt(60, 140), UPPER = pt(45, 105), ZONE_E = pt(84, 95);
/** Block (or clear) a disc of cells: the gateway on fire, a gate opened … */
const disc = (g, x, z, r, v) => { g.fillCircle(x, z, r, 'block', v); g.version++; };
const clearOwnerOf = (ctx, id) => ctx.grid.clearOwner(ctx.handle.structures.get(id).owner);

test('m17: registered in the BEL campaign, validates with no errors or warnings', () => {
  const m = M();
  assert.ok(m && MISSIONS.includes(m) && CAMPAIGNS.BEL.includes(m));
  const v = validateMission(m);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.equal(m.title, 'Before Dawn');
  assert.deepEqual(m.size, [90, 185]);
  assert.equal(m.par.time, 780);
  assert.equal(m.theater, 'temperate');
  assert.equal(m.coneColors, 'green');
  assert.deepEqual(m.startDisguised, ['spy']);
  assert.deepEqual(m.jails, ['pen']);
  assert.deepEqual(m.jailStrips, ['divingGear']);
});

test('m17: §10.5 #14 — loads; every start reaches the pen and the lorry; no start in a cone; routes walkable', () => {
  // the five prisoners start jailed, and a jailed man is never seen (§4.10): cones over the cage are not a problem
  const probs = checkMission(M()).filter((p) => !/^commando guest starts inside e\w+'s cone$/.test(p));
  assert.deepEqual(probs, []);
  const ctx = loadGrid(M());
  clearOwnerOf(ctx, 'gate_back'); clearOwnerOf(ctx, 'pen_gate'); // the box, the pen door
  const g = ctx.grid;
  for (const c of M().commandos.filter((q) => q.role !== 'guest')) {
    assert.ok(reach(g, c, pt(...PEN_DOOR), c.role), `${c.role} reaches the pen door`);
    assert.ok(reach(g, c, TRUCK, c.role), `${c.role} reaches the lorry`);
  }
  for (const id of GUESTS) assert.ok(reach(g, M().commandos.find((c) => c.id === id), TRUCK, 'guest'), `${id} walks to the lorry`);
});

test('m17: connectivity — the S reaches the N only over the sliding bridge, by the GB\'s climb, or through the camp', () => {
  const ctx = loadGrid(M()), g = ctx.grid;
  // as built: bridge retracted, back gate shut
  for (const role of ['spy', 'diver']) assert.ok(!reach(g, START, W_STRIP, role), `${role}: no way over the gorge on foot`);
  assert.ok(!reach(g, START, N_BANK, 'spy'), 'no way N while the back gate is shut');
  assert.ok(reach(g, START, W_STRIP, 'greenberet'), 'the GB climbs the gorge at its W end');
  assert.ok(reach(g, START, LOWER, 'spy') && reach(g, LOWER, UPPER, 'spy'), 'main gate → lower camp → gateway → upper yard');
  assert.ok(!reach(g, LOWER, ZONE_E, 'spy') && !reach(g, S_FIELD, ZONE_E, 'spy'), 'no way round the camp on the E');
  // the back gate open: through the camp to the N bank; with the gateway burning, the lower camp is cut off
  clearOwnerOf(ctx, 'gate_back');
  assert.ok(reach(g, S_FIELD, N_BANK, 'spy'), 'main gate → gateway → back gate → road bridge');
  assert.ok(reach(g, UPPER, ZONE_E, 'spy'), 'zone E from the riverside path');
  disc(g, GATEWAY.x, GATEWAY.z, 4.5, B.HIGH);
  assert.ok(!reach(g, LOWER, UPPER, 'spy') && !reach(g, S_FIELD, N_BANK, 'spy'), 'the gateway is the lower garrison\'s only way N');
  // the sliding bridge out (deck cells walkable): S fields ↔ W strip
  g.fillPoly(DECK, 'block', B.NONE); g.fillPoly(DECK, 'bridge', 1); g.version++;
  assert.ok(reach(g, START, W_STRIP, 'spy') && reach(g, START, N_BANK, 'spy'), 'over the deck, then the road bridge');
});

test('m17: §3.8 row 17 loadout exactly (GB, Marine, Spy in uniform and the medic) + Gilbert & 4; raft and 1 barrel on site', () => {
  const L = belLoadout(17);
  const team = M().commandos.filter((c) => c.role !== 'guest');
  assert.deepEqual(team.map((c) => c.role), L.team);
  const sort = (o) => Object.fromEntries(Object.entries(o).sort());
  for (const c of team) {
    const want = { ...L.inventories[c.role], ...(c.role === L.medic ? { firstAid: 6 } : {}) };
    assert.deepEqual(sort(spawnInventory(c.role, c.inventory)), sort(spawnInventory(c.role, want)), c.role);
  }
  assert.equal(L.medic, 'spy');
  assert.ok(!spawnInventory('greenberet', {}).shovel, 'no shovel from M12 on');
  assert.ok(spawnInventory('greenberet', {}).decoy && spawnInventory('diver', {}).divingGear);
  const guests = M().commandos.filter((c) => c.role === 'guest');
  assert.deepEqual(guests.map((c) => c.id), GUESTS);
  assert.equal(guests.length, L.guests.length);
  for (const c of guests) { assert.equal(c.jailed, true); assert.equal(c.jailId, 'pen'); assert.equal(c.noCrawl, true); }
  assert.deepEqual(guests.map((c) => c.follow ?? null), [null, 'gilbert', 'fr1', 'fr2', 'fr3'], 'single file behind Gilbert');
  assert.equal(M().vehicles.filter((v) => v.vehicleType === 'raft').length, L.site.raft);
  assert.equal(M().structures.filter((s) => s.type === 'barrels' && s.explosive === 'barrel').length, L.site.barrels);
});

test('m17: enemy census = Kildread (14 walkers, 11 sentries, four 3-man patrols, 1 MG, the bunker, 5 towers, 2 garrisons)', () => {
  const es = M().enemies;
  assert.equal(es.filter((e) => e.soldierType === 'soldier' && e.route && !e.squad).length, 14);
  assert.equal(es.filter((e) => e.soldierType === 'sentry' && !e.tower).length, 11);
  const squads = {};
  for (const e of es.filter((q) => q.squad)) squads[e.squad.id] = (squads[e.squad.id] || 0) + 1;
  assert.deepEqual(Object.values(squads), [3, 3, 3, 3]);
  assert.equal(es.filter((e) => e.soldierType === 'mg').length, 1);
  assert.deepEqual(es.filter((e) => e.structure).map((e) => e.structure), ['pillbox']);
  const towers = es.filter((e) => e.tower);
  assert.equal(towers.length, 5);
  for (const e of towers) assert.equal(e.y, 6);
  assert.equal(M().structures.filter((s) => s.type === 'watchtower').length, 5);
  assert.deepEqual(Object.keys(M().barracks).sort(), ['barracks_se', 'hq_n']);
  assert.equal(M().barracks.barracks_se.squads.length, 3);
  assert.equal(es.length, 44);
});

test('m17: the whole map is silent (seen → alarm, heard → nobody sounds it); the river only picks the garrison', () => {
  const s = makeSim(M(), { brains: false });
  const a = new Alarm(s.world);
  for (const [x, z] of [[5, 5], [30, 50], [80, 40]]) assert.equal(a.zoneAt(x, z)?.id, 'z_n');
  for (const [x, z] of [[10, 110], [60, 140], [5, 180], [85, 95]]) assert.equal(a.zoneAt(x, z)?.id, 'z_s');
  for (const z of M().zones) assert.equal(z.onHeard, null);
  assert.deepEqual(M().zones.map((z) => z.onSeen), ['RINT_N', 'RINT']);
  assert.ok(M().barracks.barracks_se.squads.every((q) => q.event === 'RINT'));
  assert.ok(M().barracks.hq_n.squads.every((q) => q.event === 'RINT_N'));
  assert.ok(M().triggers.some((t) => t.on === 'alarm:zone' && t.match?.event === 'RINT_N' && t.do.some((d) => d.event === 'RINT' || typeof d.run === 'function')), 'T6'); // run: RINT at the N alarm's x, z
  assert.equal(M().alarmFail, null, 'an alarm is not a failure here');
  // the lower squads' exit route runs through the gateway (where the oil burns)
  const exit = M().barracks.barracks_se.squads[0].exitRoute;
  assert.ok(exit.some((p) => Math.hypot(p.x - GATEWAY.x, p.z - GATEWAY.z) < 1), 'barracks_se turns out through the gateway');
  const o = Object.fromEntries(M().objectives.map((q) => [q.id, q]));
  assert.equal(o.o1.type, 'script');
  assert.equal(o.o2.type, 'escape');
  assert.equal(o.o2.vehicleId, 'truck');
  assert.deepEqual(M().extraction.spawnWhen, ['o1']);
});

/** Full M17 sim (stub brains): alarm, objectives, set-pieces and triggers, the lorry extraction. */
function m17Sim() {
  const s = makeSim(M(), { brains: false });
  const w = s.world;
  w.alarm = new Alarm(w);
  w.objectives = createObjectives(s.mission.objectives);
  s.flags = {};
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); checkObjectives(w); updateExtractionVehicle(w, s.flags); };
  // the map builder already installed the set-pieces and the triggers
  s.msgs = [];
  w.events.on('message', (p) => s.msgs.push(p.text));
  s.run(0.1);
  return s;
}
const place = (u, x, z) => { u.setPosition?.(x, z); u.x = x; u.z = z; };
const DECK_MID = pt(14.8, 134.6);

test('m17 hook: the sliding bridge — one lever N of the gorge; it falls whoever is on the deck, crushes whoever is on the S landing', () => {
  const s = m17Sim(), w = s.world, g = w.grid;
  const lever = s.get('lever_bridge');
  assert.ok(lever && lever.canUse(s.cmd('greenberet')) === true);
  assert.ok(!g.walkableAt(DECK_MID.x, DECK_MID.z), 'starts retracted');
  lever.interact(s.cmd('greenberet'));
  s.run(3.2);
  assert.ok(g.walkableAt(DECK_MID.x, DECK_MID.z), 'slid out');
  assert.ok(findPath(g, START.x, START.z, W_STRIP.x, W_STRIP.z, { role: 'spy', maxNodes: 400000 }), 'S fields → W strip over the deck');
  const e3 = s.get('e3');
  place(e3, DECK_MID.x, DECK_MID.z);
  lever.interact(s.cmd('greenberet'));
  s.run(3.2);
  assert.equal(e3.alive, false, 'fell into the gorge');
  const ps = s.get('psa');
  place(ps, 17.5, 145.8);
  lever.interact(s.cmd('greenberet'));
  s.run(3.2);
  assert.equal(ps.alive, false, 'crushed on the S landing');
});

test('m17 hook: the back gate — no hand opens it; the box inside swings it both ways', () => {
  const s = m17Sim(), w = s.world, g = w.grid;
  const box = s.get('gate_box'), sp = s.cmd('spy');
  assert.ok(!g.walkableAt(...BACK_GATE), 'starts shut');
  const door = w.interactables.find((i) => i.interactKind === 'door' && i.tag === 'gate_back');
  assert.ok(door && door.locked, 'locked');
  assert.equal(door.interact(sp), false, 'the hand does nothing');
  box.interact(sp);
  s.run(0.1);
  assert.ok(g.walkableAt(...BACK_GATE) && door.open && door.locked, 'the box opens it (and it stays locked to hands)');
  box.interact(sp);
  s.run(0.1);
  assert.ok(!g.walkableAt(...BACK_GATE) && !door.open, 'and shuts it');
});

test('m17 hook: the valve — 3 uses flood the gateway; a shot lights it: the siren, and whoever stands in it burns', () => {
  const s = m17Sim(), w = s.world;
  const valve = s.get('valve'), sp = s.cmd('spy');
  valve.interact(sp); valve.interact(sp);
  s.run(3);
  w.events.emit('shot', { to: { x: GATEWAY.x, z: GATEWAY.z } });
  s.run(0.2);
  assert.ok(!w.alarm.zonesFired.length, 'two turns: no puddle, nothing to light');
  valve.interact(sp);
  s.run(9);
  const e28 = s.get('e28');
  place(e28, GATEWAY.x + 1, GATEWAY.z);
  w.events.emit('shot', { to: { x: GATEWAY.x, z: GATEWAY.z } });
  s.run(0.5);
  assert.equal(e28.alive, false, 'burnt in the gateway');
  assert.ok(w.alarm.zonesFired.some((f) => f.event === 'RINT'), 'T3: the camp is up');
});

test('m17 hook: the barrel behind the pillbox — bunker and gunner gone; Patrol 17 and soldiers 18–21 come over the river', () => {
  const s = m17Sim(), w = s.world;
  const sent = [];
  for (const id of SEND_ON_BLAST) s.get(id).brain._startInvestigate = (x, z) => sent.push([id, [x, z]]);
  const brl = w.interactables.find((i) => i.interactKind === 'barrel') || w.entities.find((e) => e.tag === 'barrel_1');
  assert.ok(brl, 'the barrel is on the map');
  place(brl, 63, 84.4);
  brl.explode ? brl.explode(null) : brl.takeDamage(1e5, null, 'shot');
  s.run(0.8);
  assert.ok(s.events.some((e) => e.name === 'structure:destroyed' && e.p.id === 'pillbox'), 'the pillbox is destroyed');
  assert.equal(s.get('e_bk').alive, false, 'with its gunner');
  assert.deepEqual(sent.map((q) => q[0]).sort(), [...SEND_ON_BLAST].sort(), 'T4');
});

/** Clear the upper yard so nobody watches the pen door (Prima Phase 2). */
const clearYard = (s) => { for (const id of ['e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13']) s.get(id).die('test', null); };

test('m17 hook: the pen — one use of its door frees all five; Gilbert leads, the four follow in file (o1)', () => {
  const s = m17Sim(), w = s.world;
  const gs = GUESTS.map((id) => s.get(id));
  for (const u of gs) assert.equal(u.state, 'jailed', `${u.tag} starts in the cage`);
  assert.ok(s.cmd('spy').disguised, 'the Spy starts in uniform');
  clearYard(s);
  const gb = s.cmd('greenberet'), door = s.get('pen_door');
  place(gb, PEN_DOOR[0] + 0.5, PEN_DOOR[1] + 0.5);
  assert.equal(door.canUse(gb), true);
  assert.ok(door.interact(gb));
  s.run(0.3);
  for (const u of gs) assert.equal(u.state, 'active', `${u.tag} is out`);
  assert.equal(s.count('unit:freed'), 5);
  assert.ok(w.objectives.find((o) => o.id === 'o1').done, 'o1');
  assert.ok(s.msgs.some((m) => /Gilbert: "Merci/.test(m)), 'T1');
  const gil = gs[0];
  gil.moveTo(PEN_DOOR[0] - 8, PEN_DOOR[1] + 10);
  s.run(12);
  for (let k = 1; k < 5; k++) {
    assert.equal(gs[k].follow, GUESTS[k - 1]);
    assert.ok(Math.hypot(gs[k].x - gs[k - 1].x, gs[k].z - gs[k - 1].z) < 3, `${GUESTS[k]} keeps behind ${GUESTS[k - 1]}`);
  }
  gs[2].setStance?.('crawl');
  assert.notEqual(gs[2].stance, 'crawl', 'the prisoners cannot crawl');
});

test('m17 hook: a prisoner killed loses the mission (T7)', () => {
  const s = m17Sim(), w = s.world;
  clearYard(s);
  s.get('pen_door').interact(s.cmd('greenberet'));
  s.run(0.2);
  s.get('fr3').die('test', null);
  s.run(0.2);
  assert.match(String(w.scriptFail), /PRISONERS HAS BEEN KILLED/);
});

test('m17 hook: everyone aboard the lorry (the five too) after o1 → it drives off the W edge → win; not before', () => {
  const s = m17Sim(), w = s.world, truck = s.get('truck');
  const everyone = () => w.commandos.filter((c) => c.alive !== false);
  // the team alone, prisoners still caged: nothing happens
  for (const c of everyone().filter((q) => q.role !== 'guest')) { place(c, truck.x + 2, truck.z); assert.equal(truck.enter(c), true); }
  s.run(1);
  assert.notEqual(s.flags.evacPhase, 'leave', 'waits for o1');
  clearYard(s);
  s.get('pen_door').interact(s.cmd('spy'));
  s.run(0.2);
  const [first] = GUESTS.map((id) => s.get(id));
  place(first, truck.x + 2, truck.z);
  assert.equal(truck.enter(first), true);
  s.run(1);
  assert.notEqual(s.flags.evacPhase, 'leave', 'waits for all five');
  for (const id of GUESTS.slice(1)) { const u = s.get(id); place(u, truck.x + 2, truck.z); assert.equal(truck.enter(u), true, `${id} boards`); }
  s.run(0.5);
  assert.equal(s.flags.evacPhase, 'leave', 'drive-off');
  const won = s.run(20, () => w.objectives.find((o) => o.id === 'o2').done);
  assert.ok(won, `the lorry leaves by the W edge (${truck.x.toFixed(1)}, ${truck.z.toFixed(1)})`);
  assert.ok(!w.scriptFail);
});

test('m17 hook: the Marine jailed loses his diving gear (jailStrips) — the message', () => {
  const s = m17Sim(), w = s.world;
  w.events.emit('unit:jailed', { unit: s.cmd('diver'), jailId: 'pen' });
  s.run(0.1);
  assert.ok(s.msgs.some((m) => /diving kit/.test(m)));
});

// ---------------------------------------------------------------- fix round (mission-fix 17)
/** Is (x, z) inside e's cone at any moment of his sweep (one full period, 0.05 s steps)? */
const everInCone = (e, x, z) => {
  e.sweepActive = true; e.headOffset = 0;
  for (let t = 0; t <= e.vision.period; t += 0.05) if (pointInCone(coneAt(e, t), x, z)) return true;
  return false;
};
const BRIDGE_PT = pt(38, 70.9); // on the road bridge, a quarter of the way from its N end
const ROUTE = [pt(...BACK_GATE), pt(49.3, 93.5), pt(53, 91), pt(55.5, 89.5), pt(57.5, 88.3)]; // gate → behind the pillbox

test('m17 fix: the pillbox gunner scans the road bridge and is blind to his rear (the barrel spot, the pen, the gate, the path)', () => {
  const s = makeSim(M(), { brains: false }), e = s.get('e_bk');
  assert.ok(e.vision.sweepDeg <= 50, `±${e.vision.sweepDeg}°`);
  assert.ok(everInCone(e, BRIDGE_PT.x, BRIDGE_PT.z), 'he does watch the bridge');
  for (const p of [pt(63, 84.4), pt(...PEN_GATE), pt(PEN_GATE[0] - 6, PEN_GATE[1] + 3), pt(PEN_GATE[0] + 4, PEN_GATE[1] - 2), pt(58, 106), pt(60, 107), ...ROUTE]) {
    assert.ok(!everInCone(e, p.x, p.z), `(${p.x}, ${p.z}) is behind him`);
  }
});

test('m17 fix: sweeps are ± amplitudes of half the dossier arcs; e18 watches the bridge deck, not the back gate or the path', () => {
  const s = makeSim(M(), { brains: false });
  for (const e of s.world.enemies) if (e.post && e.vision && e.soldierType === 'sentry') assert.ok(e.vision.sweepDeg <= 45, `${e.tag} ±${e.vision.sweepDeg}°`);
  const e18 = s.get('e18');
  assert.ok(everInCone(e18, BRIDGE_PT.x, BRIDGE_PT.z), 'e18 sees the bridge');
  for (const p of ROUTE) assert.ok(!everInCone(e18, p.x, p.z), `e18 does not cover (${p.x}, ${p.z})`);
});

test('m17 fix: the cage has no mesh over wall_n — no sight from the riverside path into the pen and the yard', () => {
  const ctx = loadGrid(M()), g = ctx.grid;
  assert.equal(g.lineOfSight(59.5, 87.2, 62, 100), false, 'Patrol 16\'s E turn → the cage');
  assert.equal(g.lineOfSight(63, 81, 58, 106), false, 'the pillbox → the yard');
  for (let x = 52; x <= 67; x += 0.5) { // wall_n E of the gate: brick all along (no B.FENCE cells)
    const z = 107.8 + ((x - 22.5) / Math.cos((332 * Math.PI) / 180)) * Math.sin((332 * Math.PI) / 180);
    assert.notEqual(g.blockAt(x, z), B.FENCE, `wall_n at x ${x}`);
  }
});

test('m17 fix: quick save/load with the locked back gate open keeps it working: the box still shuts it afterwards', () => {
  Entity.nextId = 1;
  const s = m17Sim(), w = s.world, g = w.grid, sp = s.cmd('spy');
  s.get('gate_box').interact(sp);
  s.run(0.1);
  assert.ok(g.walkableAt(...BACK_GATE), 'open');
  const snap = JSON.parse(JSON.stringify(w.serialize()));
  Entity.nextId = 1; // a load rebuilds the mission with the same ids (game.js)
  const s2 = m17Sim(), w2 = s2.world;
  restoreWorld(w2, snap);
  const door2 = w2.interactables.find((i) => i.interactKind === 'door' && i.tag === 'gate_back');
  assert.ok(door2.open && door2.locked, 'restored open, still locked to hands');
  assert.ok(w2.grid.walkableAt(...BACK_GATE), 'cells open');
  assert.ok(setLockedGate(w2, 'gate_back', false));
  assert.ok(!w2.grid.walkableAt(...BACK_GATE) && !door2.open, 'the box shuts it again after the load');
  assert.ok(setLockedGate(w2, 'gate_back', true) && w2.grid.walkableAt(...BACK_GATE), 'and opens it');
  assert.ok(setLockedGate(w2, 'gate_back', false) && !w2.grid.walkableAt(...BACK_GATE), 'and shuts it for good');
});

test('m17 fix: the fire (T3) and a N-bank alarm (T6) raise the camp alarm where they happen, not at the map origin', () => {
  const s = m17Sim(), w = s.world, zs = [];
  w.events.on('alarm:zone', (p) => zs.push(p));
  w.events.emit('fire', { on: true, x: GATEWAY.x, z: GATEWAY.z });
  s.run(0.2);
  const t3 = zs.find((p) => p.event === 'RINT');
  assert.ok(t3 && Math.hypot(t3.x - GATEWAY.x, t3.z - GATEWAY.z) < 0.5, `T3 at (${t3?.x}, ${t3?.z})`);
  const s2 = m17Sim(), w2 = s2.world, zs2 = [];
  w2.events.on('alarm:zone', (p) => zs2.push(p));
  w2.alarm.fireEvent('RINT_N', { zoneId: 'z_n', cause: 'seen', x: 40, z: 50 });
  s2.run(0.2);
  const t6 = zs2.find((p) => p.event === 'RINT');
  assert.ok(t6 && t6.x === 40 && t6.z === 50, `T6 at (${t6?.x}, ${t6?.z})`);
});

test('m17 fix: the bunker gunner refuses the syringe and the knife with a reason (as Distract)', () => {
  const s = m17Sim(), w = s.world, e = s.get('e_bk'), sp = s.cmd('spy'), gb = s.cmd('greenberet');
  place(sp, 63, 83.5); place(gb, 63.5, 83.5);
  assert.equal(ABILITIES.syringe.canUse(sp, e, w), 'He is shut in his post.');
  assert.equal(ABILITIES.knife.canUse(gb, e, w), 'He is shut in his post.');
  assert.equal(ABILITIES.distract.canUse(sp, e, w), 'He is shut in his post.');
  assert.equal(ABILITIES.syringe.canUse(sp, s.get('e1'), w), true, 'an ordinary sentry still can be');
});

test('m17 fix: the freed five stand in a line along the cage\'s S side, not stacked on one point', () => {
  const s = m17Sim();
  clearYard(s);
  s.get('pen_door').interact(s.cmd('greenberet'));
  s.run(0.1);
  const gs = GUESTS.map((id) => s.get(id));
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    assert.ok(Math.hypot(gs[a].x - gs[b].x, gs[a].z - gs[b].z) >= 0.9, `${GUESTS[a]} / ${GUESTS[b]} apart`);
  }
  for (const u of gs) assert.ok(Math.hypot(u.x - PEN_DOOR[0], u.z - PEN_DOOR[1]) < 3, `${u.tag} by the door`);
});

test('m17 fix: the bunker blown from afar (barrel 9 m off) still kills its gunner — the crew goes with the post', () => {
  const s = m17Sim(), w = s.world;
  const pb = s.handle?.structures?.get('pillbox') || w.interactables.find((i) => i.tag === 'pillbox');
  assert.ok(pb, 'the pillbox');
  const e = s.get('e_bk');
  assert.ok(Math.hypot(e.x - 57.5, e.z - 88.3) > 8, 'the blast point is out of lethal range');
  pb.destroy(null, 'explosion'); // as the 9 m barrel did in round 2 (hp 0, destroyed)
  s.run(0.2);
  assert.ok(pb.destroyed, 'bunker destroyed');
  assert.equal(e.alive, false, 'and its gunner dead in the rubble');
  assert.equal(s.get('e1').alive, true, 'an ordinary soldier is not touched by the rule');
});

test('m17 fix: a prisoner whose leader cannot be reached (out on the river) stops, not marching on along his old path', () => {
  const s = m17Sim();
  clearYard(s);
  s.get('pen_door').interact(s.cmd('greenberet'));
  s.run(0.3);
  const gil = s.get(GUESTS[0]), f1 = s.get(GUESTS[1]);
  assert.equal(f1.follow, GUESTS[0]);
  f1.moveTo(PEN_DOOR[0] - 10, PEN_DOOR[1] + 12); // a stale path, as when Gilbert walked off before boarding
  assert.ok(f1.path, 'walking');
  place(gil, 40, 78); // mid-river: no path reaches him
  f1._followT = 0;
  s.run(0.5);
  assert.ok(!f1.path, 'the follower holds');
  const x = f1.x, z = f1.z;
  s.run(3);
  assert.ok(Math.hypot(f1.x - x, f1.z - z) < 0.3, `stays put (${f1.x.toFixed(1)}, ${f1.z.toFixed(1)})`);
});

test('m17 check: the Spy starts in uniform and, unmasked, takes it off and can put it back on out of sight', () => {
  const s = m17Sim(), w = s.world, sp = s.cmd('spy');
  assert.ok(sp.disguised, 'in uniform at the start (Kildread: Enemy Uniform)');
  place(sp, START.x, START.z); // the start: in no cone
  assert.ok(unmaskSpy(w, sp, null, 'test'));
  assert.ok(!sp.disguised && sp.has('uniform'), 'the uniform is in his kit again');
  assert.equal(ABILITIES.uniform.canUse(sp, null, w), true, 'and he can dress');
});

test('m17 fix: the wire cage is drawn as posts and mesh, not solid slabs (its sides are see-through B.FENCE)', async () => {
  const { buildExtraProp } = await import('../../src/art/props-extra.js'); // as map-builder.js builds it
  const pen = M().structures.find((s) => s.id === 'pen');
  const { object3d } = buildExtraProp(pen.type, { ...pen, x: 0, z: 0, rot: 0 });
  const meshes = [];
  object3d.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.ok(meshes.length > 30, `posts and strands (${meshes.length} meshes)`);
  for (const m of meshes) {
    const pa = m.geometry.parameters, dims = [pa.width, pa.height, pa.depth].sort((a, b) => a - b);
    assert.ok(!(dims[0] >= 0.08 && dims[1] > 1), `no opaque panel (${pa.width.toFixed(2)}×${pa.height.toFixed(2)}×${pa.depth.toFixed(2)})`);
  }
});

test('m17 fix: T4 with live brains — the gunner lies buried (nobody finds him); the sent men come to the rubble and go home', () => {
  const s = makeSim(M(), {}), w = s.world;
  w.alarm = new Alarm(w);
  const found = [], near = {}, alarms = [];
  w.events.on('enemy:body-found', (p) => found.push(p.body?.tag ?? p.body?.id));
  w.events.on('alarm:zone', (p) => alarms.push(p.cause));
  s.run(0.5);
  const home = Object.fromEntries(SEND_ON_BLAST.map((id) => [id, [s.get(id).x, s.get(id).z]]));
  w.interactables.find((i) => i.tag === 'pillbox').destroy(null, 'explosion');
  assert.ok(s.get('e_bk').hiddenBody, 'the gunner is under the rubble');
  for (let k = 0; k < 150; k++) {
    s.run(1);
    for (const id of SEND_ON_BLAST) { const e = s.get(id); if (Math.hypot(e.x - 57, e.z - 88.5) < (id.startsWith('p17') ? 10 : 7)) near[id] = 1; }
  }
  assert.ok(!found.includes('e_bk'), `nobody comes on the gunner (found: ${found.join(',')})`);
  assert.deepEqual(alarms, [], 'no alarm');
  assert.deepEqual(Object.keys(near).sort(), [...SEND_ON_BLAST].sort(), `all seven reach the rubble (near: ${Object.keys(near)}; ${SEND_ON_BLAST.map((id) => `${id}@${s.get(id).x.toFixed(0)},${s.get(id).z.toFixed(0)}`)})`);
  const back = SEND_ON_BLAST.filter((id) => { const e = s.get(id); return Math.hypot(e.x - 57, e.z - 88.5) > 15; });
  assert.ok(back.length >= 5, `and head home again (${back.join(',')})`);
});
