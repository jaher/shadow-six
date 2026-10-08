/**
 * Vehicle realism (user request 2026-10-07 after the M3 video: "the car seems to cross the mountain when turning
 * around, fix that", "when commandos enter the car it should be realistic", "it should somehow feel the wheels of the
 * car are moving, also the car turning around should look more realistic, it may involve going backwards and forwards
 * to do a full turn"):
 *  - land hulls steer like cars (entities/vehicle-maneuver.js): the heading turns only as far as the distance rolled
 *    allows on the turning circle — never a pivot on the spot; a turn-round in a tight place is a multi-point turn
 *    (forward, reverse, forward…) and no pose of the real footprint overlaps a cliff, rock or wall;
 *  - the hull rolls (speed > 0, `reversing` set) while it backs up, so its wheels turn — backwards;
 *  - boarding: a man walks to the door of his seat (LHD driver left, co-driver right, lorry passengers the tailgate),
 *    the door opens before he gets in; the climb in / out is a continuous motion from the door to the seat.
 */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { B } from '../../src/world/grid.js';
import { createVehicle } from '../../src/entities/vehicle.js';
import { Commando } from '../../src/entities/commando.js';
import { arcStep, planManeuver, headingError } from '../../src/entities/vehicle-maneuver.js';
import { boardPoint } from '../../src/abilities/drive.js';
import { seatMotion, tailgateMotion, BOARD_TIMES } from '../../src/art/vehicle-crew.js';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';

const DT = 1 / 60;
function step(w, n = 1) {
  for (let k = 0; k < n; k++) {
    w.rebuildSpatial(); w.refreshDynamicOccluders();
    for (const c of [...w.commandos]) if (!c.removed) c.update(DT);
    for (const e of [...w.enemies]) if (!e.removed) e.update(DT);
    w.runBelTicks(DT);
    for (const v of [...w.vehicles]) if (!v.removed) v.update(DT);
    w.flushRemovals(); w.time += DT;
  }
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Outline points of the hull (no margin) standing in something solid (cells it overlapped at `had` excepted). */
function solidOverlap(v, had) {
  const g = v.world.grid;
  let n = 0;
  for (const [x, z] of v._outline(v.x, v.z, v.heading, 0)) {
    const { i, j } = g.worldToCell(x, z);
    if (!g.inBounds(i, j)) continue;
    const k = g.idx(i, j);
    if (!had.has(k) && g.block[k] !== B.NONE && !g.bridge[k]) n++;
  }
  return n;
}
/** Drive `v` for up to `secs` s (stop early on `until`): pivots, overlaps, reverse metres, gear changes. */
function watch(v, w, secs, until = () => !v.goal && !v.path, had = new Set()) {
  const R = v.def.turnRadius, o = { pivot: 0, overlap: 0, rev: 0, gears: 0, revRolling: 0 };
  let px = v.x, pz = v.z, ph = v.heading, last = null;
  for (let k = 0; k < secs * 60; k++) {
    step(w);
    const ds = Math.hypot(v.x - px, v.z - pz), dh = Math.abs(wrap(v.heading - ph));
    if (dh > ds / R + 1e-6) o.pivot++;
    o.overlap += solidOverlap(v, had) ? 1 : 0;
    if (v.reversing) { o.rev += ds; if (v.speed > 0.2 && ds > 0) o.revRolling++; }
    if (ds > 1e-4) { const fwd = (v.x - px) * Math.cos(v.heading) + (v.z - pz) * Math.sin(v.heading) > 0; if (last !== null && fwd !== last) o.gears++; last = fwd; }
    px = v.x; pz = v.z; ph = v.heading;
    if (until()) { o.done = true; break; }
  }
  return o;
}

test('maneuver kinematics: arcStep is exact (a full circle closes), a plan in the open is one forward arc', () => {
  let p = { x: 0, z: 0, h: 0 };
  const R = 5, n = 100, L = 2 * Math.PI * R;
  for (let k = 0; k < n; k++) p = arcStep(p.x, p.z, p.h, L / n, 1 / R);
  assert.ok(Math.hypot(p.x, p.z) < 1e-9 && Math.abs(wrap(p.h)) < 1e-9, 'back where it started');
  const T = { x: 0, z: 30 };
  const plan = planManeuver({ x: 0, z: 0, h: 0 }, { R: 6, target: T, tol: 0.03, free: () => true, goal: (q) => Math.abs(headingError(q, T)) < 0.03 });
  assert.equal(plan.legs.length, 1, 'one arc');
  assert.equal(plan.legs[0].dir, 1, 'forward');
  assert.ok(Math.abs(plan.legs[0].k) <= 1 / 6 + 1e-9, 'no tighter than the turning circle');
});

test('player drive: a truck in a dead-end lane ordered back out makes a multi-point turn — reverse included, never a pivot, never in a wall', () => {
  const w = new World({ size: [60, 60] });
  w.vehicleFactory = createVehicle;
  // a 9 m lane closed at its east end (walls z < 25.5 and z > 34.5, x > 46)
  w.grid.fillRect(0, 0, 60, 25, 'block', B.HIGH); w.grid.fillRect(0, 35, 60, 25, 'block', B.HIGH); w.grid.fillRect(47, 25, 13, 10, 'block', B.HIGH);
  const dr = w.add(new Commando({ role: 'driver', x: 30, z: 30 }));
  const tr = w.spawnVehicle('truck', { x: 40, z: 30, heading: 0 }); // facing the dead end
  assert.ok(tr.enter(dr));
  assert.ok(dr.issue({ type: 'move', x: 10, z: 30 }), 'the order is taken (a way round exists)');
  const o = watch(tr, w, 60);
  assert.equal(o.pivot, 0, 'never turns on the spot');
  assert.equal(o.overlap, 0, 'no corner in a wall');
  assert.ok(o.rev > 1, `it backs up as part of the turn (${o.rev.toFixed(1)} m)`);
  assert.ok(o.gears >= 2, `forward / reverse / forward (${o.gears} changes of gear)`);
  assert.ok(o.revRolling > 30, 'backing up it rolls (speed > 0, reversing): its wheels turn backwards');
  assert.ok(tr.x < 12, `then drives out west (${tr.x.toFixed(1)})`);
  assert.ok(Math.abs(wrap(tr.heading - Math.PI)) < 0.1, 'facing the way out');
});

test('player drive: a teammate standing on the planned turning arc — the car stops, then goes round him (or the order ends); it never stalls for good', () => {
  // verifier, fix round 1: a strict (player) turn held up by a man was dropped and planned again without the men,
  // got the same arc through him and waited there for ever (goal kept, blockedT growing)
  const w = new World({ size: [60, 60] });
  w.vehicleFactory = createVehicle;
  const dr = w.add(new Commando({ role: 'driver', x: 5, z: 5 }));
  const v = w.spawnVehicle('kubelwagen', { x: 30, z: 30, heading: 0, seats: 4 });
  assert.ok(v.enter(dr));
  const T = { x: 25, z: 30.5 }, plan = v._planDrive(T.x, T.z);
  assert.ok(plan?.legs.length, 'a turn-round is planned');
  // the man stands half way along the first arc
  const leg = plan.legs[0];
  const p = arcStep(v.x, v.z, v.heading, leg.dir * leg.len * 0.6, leg.k);
  w.add(new Commando({ role: 'sapper', x: p.x, z: p.z }));
  assert.ok(dr.issue({ type: 'move', x: T.x, z: T.z }), 'the order is taken');
  const o = watch(v, w, 40);
  assert.ok(o.done, `the order ends (goal ${JSON.stringify(v.goal && Object.keys(v.goal))}, blockedT ${(v.blockedT || 0).toFixed(1)})`);
  assert.equal(o.pivot, 0, 'never turns on the spot');
  assert.ok(Math.hypot(v.x - T.x, v.z - T.z) < 1.5, `it went round him and arrived (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
});

test('M3: the escape truck turns round north of the dam without its nose crossing the rock rim (multi-point turn, no pivot)', () => {
  const sim = makeSim(getMission('m03'));
  const w = sim.world;
  const v = w.spawnVehicle('truck', { id: 'evac_probe', x: 60, z: 10, heading: Math.PI / 2, seats: 6 }); // as it waits at the pickup
  v.offMapOK = true;
  const had = v._hadCells();
  assert.equal(had.size, 0, 'parked clear of the rock');
  v.followPath([{ x: 60, z: 0 }, { x: 60, z: -12 }], { speed: 6 }); // the scripted leave (core/objectives extraction)
  const o = watch(v, w, 60, () => v.z < -10);
  assert.ok(o.done, `it drove off north (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`);
  assert.equal(o.pivot, 0, 'no pivot on the spot');
  assert.equal(o.overlap, 0, 'no part of the hull in the rim / shack / cliff');
  assert.ok(o.rev > 1 && o.gears >= 2, `a multi-point turn (${o.gears} gear changes, ${o.rev.toFixed(1)} m in reverse)`);
});

test('routes: patrol and shuttle vehicles keep their whole hull out of walls and rigs (M11 tanker, M19 lorry)', () => {
  for (const [id, tag, secs] of [['m11', 'tanker', 90], ['m19', 'lt', 90]]) {
    const sim = makeSim(getMission(id));
    const w = sim.world, v = w.vehicles.find((q) => q.tag === tag);
    const had = v._hadCells();
    const o = watch(v, w, secs, () => false, had);
    assert.equal(o.overlap, 0, `${id} ${tag}: hull never in a wall / rig`);
    assert.equal(o.pivot, 0, `${id} ${tag}: no pivot on the spot`);
  }
});

test('boarding: each man walks to the door of his seat — driver left, co-driver right, lorry passengers the tailgate', () => {
  const w = new World({ size: [60, 60] });
  w.vehicleFactory = createVehicle;
  const tr = w.spawnVehicle('truck', { x: 30, z: 30, heading: 0 }); // facing +x: its left is -z
  const right = w.add(new Commando({ role: 'greenberet', x: 30, z: 36 })); // standing on the truck's right
  const local = (p) => ({ along: (p.x - tr.x), across: (p.z - tr.z) });
  const d0 = local(boardPoint(tr, right, 0)), d1 = local(boardPoint(tr, right, 1)), d2 = local(boardPoint(tr, right, 2));
  assert.ok(d0.across < -1, `seat 0 (driver): the left door, though he stands on the right (${d0.across.toFixed(2)})`);
  assert.ok(d1.across > 1, `seat 1: the right door (${d1.across.toFixed(2)})`);
  assert.ok(d2.along < -3, `seat 2: behind the tailgate (${d2.along.toFixed(2)})`);
});

test('boarding: the Driver walks round to the driver\'s door, it opens before he is in, a passenger takes the door nearest him; the climb runs from the door to the seat', () => {
  const sim = makeSim({ commandos: [{ role: 'driver', x: 30, z: 36 }, { role: 'greenberet', x: 31, z: 36 }] });
  const w = sim.world;
  const tr = w.spawnVehicle('kubelwagen', { id: 'k', x: 30, z: 30, heading: 0 });
  const gb = sim.cmd('driver'), pas = sim.cmd('greenberet');
  const opened = [];
  tr.model.boarding = (seat, kind) => opened.push({ seat, kind, t: w.time, inside: gb.vehicle === tr, x: gb.x, z: gb.z });
  assert.ok(gb.issue({ type: 'ability', id: 'enterVehicle', target: tr }));
  sim.run(20, () => gb.vehicle === tr);
  assert.equal(gb.vehicle, tr, 'he got in');
  const op = opened.find((o) => o.kind === 'open');
  assert.ok(op && !op.inside, 'the door opened while he stood outside it');
  assert.ok(op.z < 30 - 0.8 - 0.3, `at the driver's (left) door, round the car (${op.z.toFixed(2)})`);
  assert.ok(gb.boardFrom && Math.abs(gb.boardFrom.z - op.z) < 0.1, 'he climbs in from where he opened it');
  assert.equal(tr.seatOf(gb), 0, 'the Driver sits at the wheel');
  assert.ok(pas.issue({ type: 'ability', id: 'enterVehicle', target: tr }));
  sim.run(20, () => pas.vehicle === tr);
  assert.equal(pas.vehicle, tr, 'the passenger got in');
  const po = opened.filter((o) => o.kind === 'open').pop();
  assert.ok(po.seat !== 0 && tr.seatOf(pas) === po.seat, `the passenger took a passenger seat (seat ${po.seat})`);
  assert.ok(pas.boardFrom.z > 30 + 0.8, `through the near (right) door, not round the car (z ${pas.boardFrom.z.toFixed(2)})`);
  // the climb (art/vehicle-crew.js): door → doorway → seat, rising, continuous
  const S = { x: 0, y: -1.2, z: -1.4 }, D = { x: 0, y: -0.55, z: -0.5 }, Z = { x: 0, y: -0.35, z: 0.27 };
  let prev = seatMotion('in', 0, S, D, Z).p, maxJump = 0, minY = Infinity;
  for (let t = 0; t <= BOARD_TIMES.wait + BOARD_TIMES.climb + BOARD_TIMES.sit + 0.05; t += 1 / 60) {
    const r = seatMotion('in', t, S, D, Z);
    maxJump = Math.max(maxJump, Math.hypot(r.p.x - prev.x, r.p.y - prev.y, r.p.z - prev.z)); minY = Math.min(minY, r.p.y); prev = r.p;
  }
  assert.ok(maxJump < 0.08, `no jump between frames (${maxJump.toFixed(3)} m)`);
  assert.ok(minY >= S.y - 1e-9, 'never below the ground he stood on');
  assert.ok(Math.hypot(prev.x - Z.x, prev.y - Z.y, prev.z - Z.z) < 1e-6 && seatMotion('in', 9, S, D, Z).done, 'ends on the seat');
  const out = seatMotion('out', 9, S, D, Z);
  assert.ok(out.done && Math.hypot(out.p.x - S.x, out.p.z - S.z) < 1e-6, 'getting out ends at the door');
  // over the tailgate: up onto it, then in under the canvas
  const G = { x: 0, y: 1.15, z: -2.9 }, Bay = { x: 0, y: 1.1, z: -1.5 }, S2 = { x: 0, y: 0, z: -4 };
  const mid = tailgateMotion('in', BOARD_TIMES.climb, S2, G, Bay);
  assert.ok(Math.abs(mid.p.y - G.y) < 1e-6 && mid.clip === 'walk', 'on top of the tailgate after the climb');
  assert.ok(tailgateMotion('in', 9, S2, G, Bay).done && tailgateMotion('out', 9, S2, G, Bay).p.y === S2.y, 'in under the canvas; out on the ground');
});

test('M3 extraction: the escape truck backs down the dead-end road to the pickup, nose north, and drives straight off — no turn in the bay', async () => {
  const { createObjectives, updateExtractionVehicle } = await import('../../src/core/objectives.js');
  const sim = makeSim(getMission('m03'), { brains: false });
  const w = sim.world, flags = {};
  w.objectives = createObjectives(sim.mission.objectives);
  for (const o of w.objectives) if (o.id === 'o1' || o.id === 'o2') o.done = true;
  let v = null, minH = Infinity, maxH = -Infinity, rev = 0, overlap = 0;
  for (let k = 0; k < 60 * 15; k++) {
    sim.step();
    v = updateExtractionVehicle(w, flags);
    if (!v) continue;
    minH = Math.min(minH, v.heading); maxH = Math.max(maxH, v.heading);
    if (v.reversing && v.speed > 0.2) rev++;
    if (v.z > 0) overlap += solidOverlap(v, new Set()) ? 1 : 0;
    if (flags.evacPhase === 'wait') break;
  }
  assert.ok(v && flags.evacPhase === 'wait', 'it got to the pickup and waits');
  assert.ok(Math.hypot(v.x - 60.4, v.z - 10) < 1, `at the pickup (${v.x.toFixed(2)}, ${v.z.toFixed(2)})`);
  assert.ok(Math.abs(wrap(v.heading + Math.PI / 2)) < 0.05 && maxH - minH < 0.05, 'nose north all the way (no turning)');
  assert.ok(rev > 60, 'backing down (rolling in reverse)');
  assert.equal(overlap, 0, 'hull clear of the rim and the shack');
  for (const c of w.commandos) { c.x = v.x + 2.5; c.z = v.z; assert.ok(v.enter(c)); }
  const h0 = v.heading;
  for (let k = 0; k < 60 * 12 && v.z > -6; k++) { sim.step(); updateExtractionVehicle(w, flags); assert.ok(!v.reversing, 'drives off forwards'); }
  assert.ok(v.z < -6 && Math.abs(wrap(v.heading - h0)) < 0.1, `off north, nose first (${v.z.toFixed(1)})`);
});
