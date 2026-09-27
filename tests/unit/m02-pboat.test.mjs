/**
 * M2 feasibility (§7.5 pboat; hint "Hide when the patrol boat passes; pack the raft after crossing";
 * intended solution steps 3–4): the boat looks from its gun mount (hull centre), not from a proxy at the
 * hull tip that stretched its 28.8 m cone to ~33 m and its 14.4 m near band to ~18.7 m. Its own hull stamp
 * (OCLU) doesn't blind it (grid.lineOfSight `ownHull`). With that, the rocks between the camp wall and
 * the river shelter a prone man for a whole boat cycle, and a timed raft crossing + climb is feasible.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { canSee } from '../../src/ai/perception.js';
import { viewerFor } from '../../src/ai/vehicle-ai.js';
import { Alarm } from '../../src/ai/alarm.js';

const place = (u, x, z, y = 0) => { u.x = x; u.z = z; u.y = y; u.path = null; };
const dummy = (x, z, low) => ({ x, z, y: 0, isLow: low, isVisibleToEnemies: true, kind: 'commando', alive: true });

test('pboat eye: apex at the gun mount; own hull does not blind it; far 28.8 / near 14.4 measured from the gunner', () => {
  const s = makeSim(getMission('m02'), { brains: false });
  const w = s.world, boat = s.get('pboat');
  // mid-river on the (18,50)→(36,64) leg, looking straight along its heading (no sweep)
  const h = Math.atan2(14, 18);
  Object.assign(boat, { x: 24, z: 54.67, heading: h, sweepActive: false, headOffset: 0 });
  w.grid.clearDynamic();
  boat.stampOccluder(w.grid);
  const eye = viewerFor(boat);
  assert.ok(Math.hypot(eye.x - boat.x, eye.z - boat.z) < 1e-9, 'eye at the hull centre (gun mount)');
  const at = (d) => [boat.x + Math.cos(h) * d, boat.z + Math.sin(h) * d];
  assert.ok(w.grid.dynamicBlock[w.grid.idx(w.grid.worldToCell(...at(2)).i, w.grid.worldToCell(...at(2)).j)] > 0, 'hull stamped');
  assert.notEqual(canSee(eye, dummy(...at(6), false), w), 'none', 'a man just past the bow is seen through the own hull stamp');
  assert.notEqual(canSee(eye, dummy(...at(28), false), w), 'none', 'standing at 28 m: seen');
  assert.equal(canSee(eye, dummy(...at(30), false), w), 'none', 'standing at 30 m: out of range (was seen from the hull tip)');
  assert.notEqual(canSee(eye, dummy(...at(13.5), true), w), 'none', 'crawling at 13.5 m: near band');
  assert.equal(canSee(eye, dummy(...at(16), true), w), 'none', 'crawling at 16 m: far band, not seen (was near from the hull tip)');
  // another vehicle's hull still occludes
  w.grid.stampDynamic(...at(10), 6, 2.4, h + Math.PI / 2); // a truck-sized hull across the line
  assert.equal(canSee(eye, dummy(...at(14), false), w), 'none', 'a foreign hull between still blocks');
});

test('pboat finding (311.2): a prone man between the wall and rocks_n2 is not seen from the boat at (15.9,48.6)', () => {
  const s = makeSim(getMission('m02'), { brains: false });
  const w = s.world, boat = s.get('pboat');
  const bearing = Math.atan2(49 - 48.6, 33.4 - 15.9);
  Object.assign(boat, { x: 15.9, z: 48.6, heading: bearing, sweepActive: false, headOffset: 0 });
  const eye = viewerFor(boat);
  assert.equal(canSee(eye, dummy(33.4, 49, true), w), 'none', 'prone at 17.5 m: far band, hidden');
  assert.notEqual(canSee(eye, dummy(33.4, 49, false), w), 'none', 'standing there he is seen (hide = lie down)');
});

/** Full-brain M2 sim with steps 1–2 done (e1–e5 gone) and alarm events recorded. */
function m02Sim() {
  const s = makeSim(getMission('m02'));
  const w = s.world;
  w.alarm = new Alarm(w);
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) w.remove(s.get(id));
  w.flushRemovals();
  s.alarms = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ t: w.time, ...p }));
  return s;
}

test('pboat: every rock pocket on the NE bank strip is crawl-safe over a whole boat cycle', () => {
  const s = m02Sim(), w = s.world, boat = s.get('pboat');
  for (const c of w.commandos) place(c, c.x, 101);
  // behind rocks_n1 (the GB's climb base), rocks_n2 (the finding's Sapper spot) and rocks_n3
  const spots = [[21, 38], [24, 41], [33.5, 49], [34, 48.5], [42.5, 55.5]].map(([x, z]) => ({ x, z, seen: 0 }));
  for (let i = 0; i < 60 * 110; i++) {
    s.step(1 / 60);
    const eye = viewerFor(boat);
    for (const p of spots) if (canSee(eye, dummy(p.x, p.z, true), w) !== 'none') p.seen++;
  }
  for (const p of spots) assert.equal(p.seen, 0, `prone at (${p.x},${p.z}) never seen by the boat`);
});

test('m02 §7.5 step 3–4 scripted: after the boat passes, the Marine rafts the GB over, packs the raft, the GB climbs; both unseen for a full cycle', () => {
  const s = m02Sim(), w = s.world;
  const boat = s.get('pboat'), gb = s.cmd('greenberet'), ma = s.cmd('diver');
  let bx = boat.x, attacked = null;
  w.events.on('shot', (p) => { if (p.shooter === boat || p.shooter?.vehicle === boat) attacked = attacked ?? w.time; });
  // window: the boat has just passed the crossing, heading downstream (SE)
  assert.ok(s.run(400, () => { const east = boat.x > bx; bx = boat.x; return east && boat.x > 32; }), 'boat passes downstream');
  const watch = () => { if (boat.brain?.state === 'attack') attacked = attacked ?? w.time; return false; };
  place(ma, 23.4, 55.5); place(gb, 22.8, 56.4); // SW shallows opposite the climb base
  assert.ok(ma.issue({ type: 'ability', id: 'raft', target: ma }), 'Marine: deploy the raft');
  s.run(2.2, watch);
  const raft = w.vehicles.find((v) => v.vehicleType === 'raft');
  assert.ok(raft && raft.operator === ma, 'raft deployed, Marine aboard');
  assert.ok(gb.issue({ type: 'ability', id: 'enterVehicle', target: raft }), 'GB: board');
  s.run(10, () => watch() || gb.vehicle === raft);
  assert.equal(gb.vehicle, raft, 'GB aboard');
  assert.ok(ma.issue({ type: 'move', x: 27.9, z: 49.6 }), 'Marine: row to the NE bank');
  s.run(8, watch);
  assert.ok(gb.issue({ type: 'ability', id: 'leaveVehicle', target: gb }), 'GB: land');
  assert.ok(ma.issue({ type: 'ability', id: 'leaveVehicle', target: ma }), 'Marine: out');
  s.run(0.5, watch);
  assert.ok(ma.issue({ type: 'move', x: 27.2, z: 50.3 }));
  s.run(4, () => watch() || !ma.path);
  assert.ok(ma.issue({ type: 'ability', id: 'hand', target: raft }), 'Marine: pack the raft');
  assert.ok(gb.issue({ type: 'ability', id: 'climb', target: { x: 24.3, z: 39.8 } }), 'GB: climb the SW edge');
  s.run(40, () => watch() || (gb.y > 2.1 && !gb.path));
  assert.ok(gb.y > 2.1, `GB on the wall walk (y ${gb.y})`);
  assert.ok(gb.issue({ type: 'stance', stance: 'crawl' }), 'GB: flat on the walk');
  s.run(3, () => watch() || raft.removed);
  assert.ok(raft.removed && ma.has('inflatableBoat'), 'raft packed');
  // the Marine lies down in rocks_n2's shadow until the boat has been by again
  assert.ok(ma.issue({ type: 'move', x: 28.4, z: 48.6 }));
  s.run(4, () => watch() || !ma.path);
  assert.ok(ma.issue({ type: 'stance', stance: 'crawl' }), 'Marine: down');
  assert.ok(ma.issue({ type: 'move', x: 33.5, z: 49 }), 'Marine: crawl behind rocks_n2');
  s.run(110, watch);
  assert.ok(gb.alive && ma.alive, 'both alive');
  assert.equal(attacked, null, 'the boat never engaged');
  assert.equal(s.alarms.length, 0, 'no alarm');
  assert.ok(Math.hypot(ma.x - 33.5, ma.z - 49) < 0.8 && ma.stance === 'crawl', 'Marine hidden prone at the rocks');
});
