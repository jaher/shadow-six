/** Building ↔ fence/wall/road alignment (src/missions/alignment.js): analyzer cases + enforced missions. */
import { test, assert, near } from './lib.mjs';
import { analyzeMission, modDev, findEnclosures, wallPolylines, ALIGN } from '../../src/missions/alignment.js';
import { getMission } from '../../src/missions/index.js';

/**
 * Missions whose STRICT items (fuel / storage / water tanks, cisterns, anything tagged `align: 'fence'`) must run
 * parallel to their fence/wall/road (≤ ALIGN.tolDeg). Everything else is advisory (aesthetic call, never fails);
 * near-misses (tolDeg < dev ≤ nearMissDeg) are listed by tools/layout/align-report.mjs for review by eye; every
 * enforced layout has been reviewed, so none may carry one (make it parallel, clearly different, or `alignFree`).
 */
const ENFORCED = Array.from({ length: 20 }, (_, k) => `m${String(k + 1).padStart(2, '0')}`);

const deg = (d) => (d * Math.PI) / 180;
const byId = (res, id) => res.entries.find((e) => e.id === id);
// M2-like diamond palisade W(16,33) → N(42,10) → E(71,35) → S(46,58) with a 4 m gate gap on the SE edge
const DIAMOND = { id: 'palisade', type: 'wall', segments: [[[57.47, 47.45], [46, 58], [16, 33], [42, 10], [71, 35], [54.53, 50.15]]] };
const mission = (structures, extra = {}) => ({ id: 'syn', size: [120, 120], structures, ...extra });

test('modDev: signed deviation modulo 90° in [-45, 45)', () => {
  near(modDev(deg(0), deg(0)), 0);
  near(modDev(deg(90), deg(0)), 0);
  near(modDev(deg(180), deg(0)), 0);
  near(modDev(deg(10), deg(0)), 10);
  near(modDev(deg(-10), deg(0)), -10);
  near(modDev(deg(0), deg(-41.5)), 41.5, 1e-9);
  near(modDev(deg(228), deg(-41.5)), -0.5, 1e-9);
  near(modDev(deg(50), deg(0)), -40, 1e-9);
});

test('enclosure: the diamond palisade closes across its gate gap; a gap wider than closeGap does not', () => {
  const E = findEnclosures(wallPolylines(mission([DIAMOND])));
  assert.equal(E.length, 1);
  near(E[0].area, 1266.5, 60);
  const open = { id: 'u', type: 'fence', points: [[0, 40], [0, 0], [40, 0], [40, 40]] }; // 40 m open side
  assert.equal(findEnclosures(wallPolylines(mission([open]))).length, 0);
  // two walls meeting across two 4 m gates chain into one ring
  const halves = [{ id: 'a', type: 'wall', points: [[2, 0], [0, 0], [0, 20], [2, 20]] },
    { id: 'b', type: 'fence', points: [[6, 20], [20, 20], [20, 0], [6, 0]] }];
  assert.equal(findEnclosures(wallPolylines(mission(halves))).length, 1);
});

test('diamond compound: off-angle tanks are violations, buildings advisory; suggestion keeps the facing', () => {
  const res = analyzeMission(mission([DIAMOND,
    { id: 'tankA', type: 'fueltank', variant: 'horizontal_cradle', x: 52, z: 32, rot: 0, w: 9, d: 3.4 },
    { id: 'tankOk', type: 'fueltank', x: 52, z: 32, rot: deg(40.8), w: 9, d: 3.4 },
    { id: 'tagged', type: 'hut', x: 30, z: 36, rot: deg(10), w: 5, d: 4, align: 'fence' },
    { id: 'barr', type: 'barracks', x: 40, z: 24, rot: 0, w: 12, d: 6 },
    { id: 'barrOk', type: 'barracks', x: 40, z: 24, rot: deg(318.5), w: 12, d: 6 },
    { id: 'tower', type: 'watchtower', x: 30, z: 20.6, rot: deg(228), w: 3, d: 3 }, // faces out, base parallel
    { id: 'hutFlip', type: 'hut', x: 30, z: 36, rot: deg(170), w: 5, d: 4 },
    { id: 'rock', type: 'rocks', x: 44, z: 34, rot: 0.3, w: 3, d: 2 },
    { id: 'pine', type: 'pine', x: 45, z: 30, r: 0.5 }]));
  const ta = byId(res, 'tankA');
  assert.ok(ta.strict);
  assert.equal(ta.status, 'violation');
  near(ta.suggestedDeg, 40.8, 0.05);
  assert.equal(byId(res, 'tankOk').status, 'ok');
  const b = byId(res, 'barr');
  assert.equal(b.strict, false);
  assert.equal(b.status, 'angled'); // 41.5° off: clearly different, an aesthetic call
  assert.equal(b.ref.kind, 'enclosure');
  near(b.devDeg, 41.5, 0.05);
  near(b.suggestedDeg, 318.5, 0.05);
  assert.equal(byId(res, 'barrOk').status, 'ok');
  const t = byId(res, 'tower');
  assert.equal(t.status, 'ok');
  near(t.suggestedDeg, 228.5, 0.05); // stays facing SW-out, not snapped to another side
  const h = byId(res, 'hutFlip');
  assert.equal(h.status, 'angled');
  assert.ok(Math.abs(h.suggestedDeg - 170) <= 45, `suggestion ${h.suggestedDeg} stays within 45° of the facing`);
  for (const id of ['rock', 'pine']) assert.equal(byId(res, id).status, 'skip', `${id} is exempt`);
  assert.deepEqual(res.violations.map((v) => v.id).sort(), ['tagged', 'tankA']);
  assert.deepEqual(res.advisories.map((v) => v.id).sort(), ['barr', 'hutFlip']);
  assert.deepEqual(res.nearMisses, []);
});

test('wall proximity: a hut outside but along a wall aligns to it; one beyond wallNear is unreferenced', () => {
  const wall = { id: 'w', type: 'wall', points: [[0, 0], [60, 60]] }; // 45° wall, not closed
  const res = analyzeMission(mission([wall,
    { id: 'near', type: 'water_tank', x: 36, z: 24, rot: 0, w: 4, d: 4 },
    { id: 'far', type: 'hut', x: 60, z: 10, rot: 0, w: 4, d: 4 }]));
  assert.equal(byId(res, 'near').ref.kind, 'wall');
  assert.equal(byId(res, 'near').status, 'violation'); // a tank: strict
  assert.equal(byId(res, 'far').status, 'noref');
  assert.ok(ALIGN.wallNear >= 10);
});

test('road fallback + advisory grades: houses by a 30° road are ok / near-miss / angled; pavements count', () => {
  const road = { points: [[0, 0], [86.6, 50]], width: 6, spline: false };
  const res = analyzeMission(mission([
    { id: 'h0', type: 'house', x: 40, z: 31, rot: 0, w: 8, d: 7 },
    { id: 'h30', type: 'house', x: 40, z: 31, rot: deg(30), w: 8, d: 7 },
    { id: 'h38', type: 'house', x: 40, z: 31, rot: deg(38), w: 8, d: 7 }, // 8° off: reads as a mistake
    { id: 'h31', type: 'house', x: 40, z: 31, rot: deg(31.5), w: 8, d: 7 }, // within tolDeg
    { id: 'lot', type: 'hut', x: 105, z: 105, rot: 0, w: 4, d: 4 },
  ], { roads: [road], pavements: [{ x: 100, z: 100, w: 12, d: 12 }] }));
  const h0 = byId(res, 'h0');
  assert.equal(h0.ref.kind, 'road');
  near(h0.ref.angleDeg, 30, 0.1);
  assert.equal(h0.status, 'angled'); // 30° off: a deliberate angle, advisory
  near(h0.suggestedDeg, 30, 0.1);
  assert.equal(byId(res, 'h30').status, 'ok');
  assert.equal(byId(res, 'h31').status, 'ok');
  assert.equal(byId(res, 'h38').status, 'near-miss');
  assert.deepEqual(res.nearMisses.map((e) => e.id), ['h38']);
  assert.deepEqual(res.violations, []);
  assert.ok(ALIGN.nearMissDeg >= 10 && ALIGN.nearMissDeg <= 20);
  assert.equal(byId(res, 'lot').ref.kind, 'pavement');
  assert.equal(byId(res, 'lot').status, 'ok');
});

test('opt-out and vehicles: alignFree is never a violation; parked trucks are checked, patrols/boats are not', () => {
  const res = analyzeMission(mission([DIAMOND,
    { id: 'odd', type: 'hut', x: 40, z: 30, rot: 0.2, w: 4, d: 4, alignFree: 'wreck thrown by the blast' }], {
    vehicles: [
      { id: 'parked', vehicleType: 'truck', x: 45, z: 40, heading: deg(10), align: 'fence' },
      { id: 'loose', vehicleType: 'truck', x: 40, z: 30, heading: deg(10) },
      { id: 'patrol', vehicleType: 'truck', x: 45, z: 30, heading: deg(10), route: { points: [{ x: 45, z: 30 }] } },
      { id: 'boat', vehicleType: 'patrolboat', x: 5, z: 5, heading: 0 },
    ],
  }));
  const odd = byId(res, 'odd');
  assert.equal(odd.status, 'free');
  assert.equal(odd.alignFree, 'wreck thrown by the blast');
  assert.equal(byId(res, 'parked').status, 'violation'); // tagged align: 'fence'
  assert.equal(byId(res, 'loose').status, 'angled'); // untagged parked vehicles are advisory
  assert.equal(byId(res, 'patrol').status, 'skip');
  assert.equal(byId(res, 'boat').status, 'skip');
  assert.deepEqual(res.violations.map((v) => v.id), ['parked']);
});

for (const id of ENFORCED) {
  test(`${id}: tanks (and align:'fence' items) run parallel to their fence/wall/road (≤ ${ALIGN.tolDeg}°)`, () => {
    const res = analyzeMission(getMission(id));
    assert.deepEqual(res.violations.map((v) => `${v.id} dev ${v.devDeg}° vs ${v.ref.kind}:${v.ref.id} → rot ${v.suggestedDeg}°`), []);
    // advisory near-misses are for review by eye; the reviewed layouts carry none
    assert.deepEqual(res.nearMisses.map((v) => `${v.id} ${v.devDeg}° vs ${v.ref.kind}:${v.ref.id}`), []);
  });
}

test('suggestions are stable: turning every checked item of m01–m20 to its suggested rot leaves nothing off', () => {
  for (const id of ENFORCED) {
    const def = getMission(id), res = analyzeMission(def);
    const sug = new Map(res.entries.filter((e) => e.suggestedDeg != null).map((e) => [`${e.what}:${e.id}`, deg(e.suggestedDeg)]));
    const fixed = {
      ...def,
      structures: def.structures.map((s, i) => { const k = `structure:${s.id ?? `${s.type}#${i}`}`; return sug.has(k) ? { ...s, rot: sug.get(k) } : s; }),
      vehicles: (def.vehicles || []).map((v, i) => { const k = `vehicle:${v.id ?? `vehicle${i}`}`; return sug.has(k) ? { ...v, heading: sug.get(k) } : v; }),
    };
    const after = analyzeMission(fixed);
    assert.deepEqual([...after.violations, ...after.advisories].map((v) => v.id), [], id);
  }
});

test('debris / obstacle variants of catalogue props are exempt; plain crates are checked', () => {
  const res = analyzeMission(mission([DIAMOND,
    { id: 'wreck', type: 'crates', variant: 'car_wreck_burnt', x: 40, z: 30, rot: 0.3, w: 4, d: 2 },
    { id: 'hh', type: 'crates', variant: 'czech_hedgehog', x: 42, z: 30, rot: deg(45), w: 1.2, d: 1.2 },
    { id: 'rub', type: 'ruins', variant: 'rubble', x: 44, z: 30, rot: 0.2, w: 3, d: 2 },
    { id: 'stack', type: 'crates', variant: 'crate_stack', x: 46, z: 30, rot: 0, w: 2, d: 2 }]));
  for (const id of ['wreck', 'hh', 'rub']) assert.equal(byId(res, id).status, 'skip', id);
  assert.equal(byId(res, 'stack').status, 'angled');
});

test('rolling stock references its rail track, not the fence beside it', () => {
  const res = analyzeMission(mission([
    { id: 'rail', type: 'rail_track', points: [[0, 0], [40, 40]] }, // 45° track
    { id: 'w', type: 'wall', points: [[0, 6], [40, 14]] }, // ~11° wall 3-4 m away
    { id: 'car', type: 'train_car', x: 20, z: 20, rot: deg(45.5), w: 8, d: 3 },
    { id: 'offCar', type: 'train_car', x: 10, z: 10, rot: deg(52), w: 8, d: 3 },
    { id: 'hut', type: 'hut', x: 20, z: 12, rot: deg(11.3), w: 4, d: 4 }]));
  const car = byId(res, 'car');
  assert.equal(car.ref.kind, 'rail');
  assert.equal(car.status, 'ok');
  assert.equal(byId(res, 'offCar').status, 'near-miss'); // 7° off its track reads as a derailment
  assert.equal(byId(res, 'hut').ref.kind, 'wall');
});

test('quay faces (quay_edge set-piece) are reference walls: a depot tank on a quay runs parallel to its face', () => {
  const def = mission([
    { id: 'tank', type: 'fueltank', variant: 'fuel_tank_horizontal', x: 20, z: 4, rot: deg(-10), w: 12, d: 4.5 },
    { id: 'shed', type: 'hut', x: 20, z: 15, rot: 0, w: 4, d: 4 }]);
  def.setpieces = [{ type: 'quay_edge', id: 'qe', rings: [[[0, 0], [40, 0], [40, 30], [0, 30]]], lines: [] }];
  assert.ok(wallPolylines(def).some((p) => p.id === 'qe' && p.pts.length === 5), 'ring closed back to its first point');
  const res = analyzeMission(def);
  const tank = byId(res, 'tank');
  assert.equal(tank.ref.kind, 'enclosure');
  assert.equal(tank.status, 'violation');
  assert.equal(tank.suggestedDeg, 0);
  assert.equal(byId(res, 'shed').status, 'ok');
});
