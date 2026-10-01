/**
 * Gate smash (design-spec §3.7 ramming addendum): break decision from J = m·v, the pre-fractured layouts, the
 * vehicle response, determinism of the Rapier break under a fixed seed, and save/load of the wreckage.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { Entity } from '../../src/entities/entity.js';
import { createPhysics } from '../../src/physics/world-physics.js';
import { restoreWorld, restorePhysicsLayer } from '../../src/save.js';
import { GATE_KINDS, ramOutcome, vehicleResponse, gateLayout, gateKindOf, isBreakableGate, vehicleMass, gateMass } from '../../src/world/breakables.js';
import { planFracture, componentsOf, pieceBoxes, obbOverlap } from '../../src/physics/debris.js';
import { GROUPS, groundAt } from '../../src/physics/statics.js';
import '../../src/abilities/index.js';

const M2_GATE = { id: 'gate_se', type: 'gate', variant: 'barrier_boom', look: 'palisade_double', w: 4, rammable: true };

test('gate smash: outcome from the impulse J = m·v against the gate strength (hold / burst / shatter)', () => {
  const K = GATE_KINDS.plank;
  assert.equal(ramOutcome('plank', 3500, 9).outcome, 'shatter', 'truck at escape speed');
  assert.equal(ramOutcome('plank', 3500, 4).outcome, 'burst', 'truck with a short run-up');
  assert.equal(ramOutcome('plank', 1300, 9).outcome, 'burst', 'a car only bursts a plank gate');
  assert.equal(ramOutcome('plank', 3500, 0.5).outcome, 'hold', 'a truck creeping into it');
  assert.equal(ramOutcome('plank', 9500, 5).outcome, 'shatter', 'a tank at its fast speed');
  assert.equal(ramOutcome('boom', 1300, 9).outcome, 'shatter', 'a car snaps a boom');
  assert.equal(ramOutcome('plank', 3500, 9).J, 31500);
  // thresholds are monotonic in mass and speed
  for (const [m, v] of [[260, 10], [750, 9], [3500, 9], [9500, 5]]) {
    const { J, outcome } = ramOutcome('plank', m, v);
    assert.equal(outcome, J < K.holdJ ? 'hold' : J >= K.shatterJ ? 'shatter' : 'burst');
  }
  assert.equal(vehicleMass({ def: { model: 'truck' } }), 3500);
  assert.equal(vehicleMass({ def: { model: 'motorcycle' } }), 260);
});

test('gate smash: vehicle speed loss is proportional to the gate strength (boom < plank; car loses more than truck)', () => {
  const plank = gateLayout(M2_GATE), boom = gateLayout({ id: 'b', type: 'gate', variant: 'barrier_boom', w: 6 });
  const truckPlank = vehicleResponse('plank', plank, 3500, 9, 'shatter').loss;
  const truckBoom = vehicleResponse('boom', boom, 3500, 9, 'shatter').loss;
  const carPlank = vehicleResponse('plank', plank, 1300, 9, 'burst').loss;
  assert.ok(truckBoom < truckPlank && truckPlank < carPlank, `${truckBoom} < ${truckPlank} < ${carPlank}`);
  assert.ok(truckPlank > 0.1 && truckPlank < 0.4, `truck keeps most of its speed (${truckPlank})`);
  assert.equal(vehicleResponse('plank', plank, 3500, 0.5, 'hold').loss, 1, 'hold stops the vehicle');
});

test('gate smash: every rammable gate kind has a pre-fractured layout (planks/rails/brace/hinges; boom pole; wire frame)', () => {
  assert.ok(isBreakableGate(M2_GATE) && gateKindOf(M2_GATE) === 'plank');
  assert.equal(gateKindOf({ type: 'gate', variant: 'barrier_boom' }), 'boom', 'M4 booms');
  assert.equal(gateKindOf({ type: 'gate', variant: 'chainlink', rammable: true }), 'wire');
  assert.ok(!isBreakableGate({ type: 'gate', variant: 'chainlink' }), 'non-rammable gates keep their own model');
  const L = gateLayout(M2_GATE);
  const kinds = new Set(L.pieces.map((p) => p.kind));
  for (const k of ['plank', 'rail', 'brace', 'post']) assert.ok(kinds.has(k), k);
  assert.equal(L.hinges.length, 4, 'two strap hinges per leaf');
  assert.ok(L.pieces.some((p) => p.strap), 'hinge straps on the rails');
  assert.ok(L.pieces.filter((p) => p.seamTop).every((p) => L.pieces.find((q) => q.id === p.id.slice(0, -1) + 'b').seamBot === p.seamTop), 'seams interlock');
  assert.deepEqual(gateLayout(M2_GATE), L, 'deterministic per structure id');
  const B = gateLayout({ id: 'b', type: 'gate', variant: 'barrier_boom', w: 6 });
  assert.equal(B.pieces.filter((p) => p.kind === 'pole').length, 4, 'boom pole in four segments');
  assert.ok(gateMass(L) > 150 && gateMass(L) < 350, `plank gate mass ${gateMass(L).toFixed(0)} kg`);
});

test('gate smash: fracture plan — burst tears one leaf off and leaves the other hanging; shatter splits everything', () => {
  const L = gateLayout(M2_GATE), info = { u: -0.4, y: 0.7, halfWidth: 1.2 };
  const burst = planFracture(L, { outcome: 'burst', info, seed: 7 }, 64), shatter = planFracture(L, { outcome: 'shatter', info, seed: 7 }, 64);
  const nb = componentsOf(L, burst.edges, burst.cut).length, ns = componentsOf(L, shatter.edges, shatter.cut).length;
  assert.ok(nb >= 3 && ns > nb * 1.5, `burst ${nb} groups, shatter ${ns}`);
  assert.ok(burst.hinges.length >= 1 && burst.hinges.every((h) => h.leaf !== burst.torn), 'the torn leaf keeps no hinge, the other hangs');
  assert.ok(shatter.hinges.length <= 1);
  assert.ok(componentsOf(L, shatter.edges, planFracture(L, { outcome: 'shatter', info, seed: 7 }, 10).cut).length <= 10, 'debris cap respected');
  // shatter: the less-hit leaf stays a large chunk (rails + Z-brace + most boards) hanging on its upper hinge
  const [keep] = shatter.hinges;
  assert.ok(keep && keep.leaf !== shatter.torn && keep.id.endsWith('1'), `one upper hinge of the other leaf holds (${keep?.id})`);
  const leafIds = L.pieces.filter((p) => p.leaf === keep.leaf).map((p) => p.id);
  const chunk = componentsOf(L, shatter.edges, shatter.cut).find((c) => c.includes(keep.piece));
  assert.ok(chunk.includes(`L${keep.leaf}br`) && chunk.length >= 0.6 * leafIds.length, `hanging chunk ${chunk.length}/${leafIds.length} pieces with the brace`);
  // loose splinters only come out of seams that broke
  assert.ok(L.splinters.length >= 4 && L.splinters.every((p) => p.kind === 'splinter' && L.pieces.some((q) => q.id === `${p.host}a`)), 'splinters at board seams');
  const boom = gateLayout({ id: 'b', type: 'gate', variant: 'barrier_boom', w: 6 });
  const bp = planFracture(boom, { outcome: 'burst', info: { u: 0.5, y: 0.7, halfWidth: 1.2 }, seed: 3 }, 64);
  const groups = componentsOf(boom, bp.edges, bp.cut);
  assert.equal(groups.length, 2, 'the boom pole snaps once at the impact');
  assert.ok(groups.some((g) => g.includes('pole0') && g.includes('weight')), 'the stub stays on the pivot with the counterweight');
});

// ------------------------------------------------------------------ physics (M2 gate_se)

async function m2Sim() {
  Entity.nextId = 1;
  const def = getMission('m02');
  const s = makeSim({ ...def, commandos: def.commandos.filter((c) => c.role === 'driver') }, { brains: false });
  s.world.physics = await createPhysics(s.world, { tier: 'high' });
  const truck = s.get('truck'), gate = s.world.interactables.find((i) => i.tag === 'gate_se'), driver = s.cmd('driver');
  driver.setPosition(truck.x - 3, truck.z + 3);
  truck.enter(driver);
  return { s, truck, gate, driver, pw: s.world.physics };
}
const digest = (pw) => JSON.stringify(pw.gates.byKey('gate_se').bodies.map((b) => [b.pieces, b.pose, b.fixed]));

test('gate smash physics: M2 truck at escape speed → pieces fly, settle, freeze; no interpenetration; truck goes on', async () => {
  const { s, truck, gate, driver, pw } = await m2Sim();
  assert.equal(pw.isNull, false);
  const ev = [];
  for (const n of ['gate:smash', 'gate:settled', 'gate:thud']) s.world.events.on(n, (e) => ev.push([n, s.world.time, e]));
  assert.ok(truck.handleOrder(driver, { type: 'move', x: 62, z: 55, run: true }));
  s.run(9);
  const smash = ev.find((e) => e[0] === 'gate:smash'), settled = ev.find((e) => e[0] === 'gate:settled');
  assert.ok(smash && settled, 'smash and settle events');
  assert.equal(smash[2].outcome, 'shatter');
  assert.ok(settled[1] - smash[1] < 4.5, `settled ${(settled[1] - smash[1]).toFixed(2)} s after the smash`);
  const g = pw.gates.byKey('gate_se');
  assert.ok(g.bodies.length >= 12 && g.bodies.every((b) => b.fixed), `${g.bodies.length} frozen pieces`);
  assert.equal(pw.moving(), false);
  const boxes = pieceBoxes(g);
  let worst = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].body !== boxes[j].body) worst = Math.max(worst, obbOverlap(boxes[i], boxes[j]));
  assert.ok(worst < 0.05, `max piece overlap ${worst.toFixed(3)} m`);
  // lowest corner of every piece vs the ground under it; none standing on end; none inside a wall collider
  const low = Math.min(...boxes.map((b) => b.c.y - b.h.reduce((q, h, i) => q + h * Math.abs(b.ax[i].y), 0) - groundAt(s.world, b.c.x, b.c.z)));
  assert.ok(low > -0.03, `nothing under the ground (lowest corner ${(low * 100).toFixed(1)} cm)`);
  const upright = g.bodies.filter((b) => !b.hinged && pw.gates._upright(g, b));
  assert.equal(upright.length, 0, `no loose piece rests standing on end (${upright.map((b) => b.pieces.join('+'))})`);
  const walls = [], X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 };
  pw.rw.forEachCollider((c) => {
    if (c.collisionGroups() !== GROUPS.STATIC || c.shapeType() !== pw.R.ShapeType.Cuboid) return;
    const t = c.translation(), he = c.halfExtents();
    if (Math.abs(t.x - gate.x) < 12 + he.x && Math.abs(t.z - gate.z) < 12 + he.z) walls.push({ c: { x: t.x, y: t.y, z: t.z }, h: [he.x, he.y, he.z], ax: [X, Y, Z] });
  });
  const inWall = Math.max(0, ...boxes.flatMap((b) => walls.map((w) => obbOverlap(b, w))));
  assert.ok(walls.length > 0 && inWall < 0.03, `no piece inside a wall collider (${(inWall * 100).toFixed(1)} cm)`);
  const cuts = new Set(g.bodies.flatMap((b) => b.pieces).filter((id) => /s\d$/.test(id)));
  assert.ok(cuts.size > 0, `splinters thrown (${cuts.size})`);
  assert.ok(Math.hypot(truck.x - 62, truck.z - 55) < 1.5, 'the truck reached its target through the gap');
  assert.ok(ev.some((e) => e[0] === 'gate:thud'), 'landing thuds');
});

test('gate smash physics: same scenario twice is bit-identical (fixed step, smash seed)', async () => {
  const a = await m2Sim(), b = await m2Sim();
  for (const r of [a, b]) r.truck.handleOrder(r.driver, { type: 'move', x: 62, z: 55, run: true });
  a.s.run(7); b.s.run(7);
  assert.equal(digest(a.pw), digest(b.pw));
  assert.deepEqual(a.gate.smash, b.gate.smash);
});

test('gate smash physics: save mid-flight → load → continue equals the uninterrupted run; settled wreckage reloads', async () => {
  const ref = await m2Sim();
  ref.truck.handleOrder(ref.driver, { type: 'move', x: 62, z: 55, run: true });
  ref.s.run(7);
  const run = await m2Sim();
  run.truck.handleOrder(run.driver, { type: 'move', x: 62, z: 55, run: true });
  run.s.run(1.2); // pieces in the air
  assert.ok(run.pw.moving(), 'saved while the debris moves');
  const snap = JSON.parse(JSON.stringify({ world: { ...run.s.world.serialize(), nextId: Entity.nextId }, physics: run.pw.serialize(), house: { ...run.s.world.house } }));
  const again = await m2Sim();
  restoreWorld(again.s.world, snap.world);
  restorePhysicsLayer(again.s.world, snap);
  again.s.run(7 - 1.2);
  assert.equal(digest(again.pw), digest(ref.pw), 'continuation identical');
  // settled: a save without a snapshot rebuilds the frozen pieces where they lie
  const snap2 = JSON.parse(JSON.stringify({ world: { ...ref.s.world.serialize(), nextId: Entity.nextId }, physics: ref.pw.serialize(), house: { ...ref.s.world.house } }));
  assert.ok(!snap2.physics.snapshot, 'nothing moving → no Rapier snapshot');
  const load = await m2Sim();
  restoreWorld(load.s.world, snap2.world);
  restorePhysicsLayer(load.s.world, snap2);
  assert.equal(digest(load.pw), digest(ref.pw), 'wreckage poses restored');
  assert.ok(load.gate.destroyed && load.gate.smash?.outcome === 'shatter', 'gate broken with its smash record');
});

test('gate smash: slow truck stops at the gate (hold); open gate is never rammed', async () => {
  const { s, truck, gate, driver } = await m2Sim();
  const holds = [];
  s.world.events.on('gate:hold', (e) => holds.push(e));
  truck.handleOrder(driver, { type: 'move', x: 62, z: 55, run: false });
  s.run(8);
  assert.equal(gate.destroyed, false);
  assert.equal(holds.length, 1, 'the slow truck halts against the gate: it bows and holds');
  assert.ok(!s.events.some((e) => e.name === 'noise' && e.p.kind === 'crash'), 'no crash noise for a hold');
  // a fast order that meets the gate barely moving (nose on it) holds: the truck halts, the gate bows
  const h = await m2Sim();
  const ev = [];
  h.s.world.events.on('gate:hold', (e) => ev.push(e));
  const L = h.truck.def.size[0], hd = h.truck.heading;
  h.truck.setPosition(h.gate.x - Math.cos(hd) * (L / 2 + 0.3), h.gate.z - Math.sin(hd) * (L / 2 + 0.3), hd);
  h.truck.handleOrder(h.driver, { type: 'move', x: 62, z: 55, run: true });
  h.s.run(0.2);
  assert.ok(ev.length >= 1 && !h.gate.destroyed, `hold (${ev.length} events)`);
  const o = await m2Sim();
  o.gate.setOpen(true);
  o.truck.handleOrder(o.driver, { type: 'move', x: 62, z: 55, run: true });
  o.s.run(6);
  assert.equal(o.gate.destroyed, false, 'an open gate is driven through, not rammed');
});
