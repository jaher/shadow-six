/**
 * A man's hand on a vehicle door (user request 2026-10-07 "Can we have the commando arm close the door of the car";
 * art/door-hand.js): the door geometry the hand follows (grip spots inside / outside near the free edge, turned about
 * the hinge with the door), how far a door opens for a seat (wide enough to climb through, never further than the
 * seated man reaches with a lean), and the timelines — the door only moves while his fist is on it (IK weight 1),
 * shut at the end of a pull, open at the end of a push. The skeleton side (hand on the pull within 3 cm on the real
 * character) is the GPU test vehicle-hands.
 * Run with the unit suite: node tests/unit/run.mjs door-hand
 */
import { test, assert, near } from './lib.mjs';
import { DOOR_HAND, SEATED_SHOULDER, doorRig, doorPoint, doorAxes, boardFrac, closeKey, openKey, shutKey } from '../../src/art/door-hand.js';

// Opel Blitz cab doors (sidecar parts + the door meshes' box, model frame: +x = left, +z = front)
const BLITZ_L = { def: { node: 'door_l', kind: 'door', pivot: [0.962, 1.4, 1.25], axis: [0, 1, 0], limits_deg: [-75, 0] }, box: { min: [0.937, 0.94, 0.29], max: [0.987, 2.065, 1.25] } };
const BLITZ_R = { def: { node: 'door_r', kind: 'door', pivot: [-0.962, 1.4, 1.25], axis: [0, 1, 0], limits_deg: [0, 75] }, box: { min: [-0.987, 0.94, 0.29], max: [-0.937, 2.065, 1.25] } };
const SEAT_L = [0.45, 1.3, 0.58], SEAT_R = [-0.45, 1.3, 0.58];

test('door rig: the grip spots sit inside / outside the door near its free edge and turn with it about the hinge', () => {
  const L = doorRig(BLITZ_L.def, BLITZ_L.box), R = doorRig(BLITZ_R.def, BLITZ_R.box);
  assert.equal(L.side, 1); assert.equal(R.side, -1);
  near(L.len, 0.96, 1e-9, 'door length');
  assert.ok(L.gIn[0] < 0.937 && L.gOut[0] > 0.987, 'inner spot inside the cab, outer spot outside');
  assert.ok(L.gIn[2] > 0.29 && L.gIn[2] < 0.29 + 0.25, 'near the free (rear) edge');
  assert.ok(L.gIn[1] > 1.5 && L.gIn[1] < 2.0, `elbow-rest / window-sill height (${L.gIn[1].toFixed(2)})`);
  // shut: the spots themselves; fully open: turned 75° outward about the hinge, same distance from it
  const p0 = doorPoint(L, 0), p1 = doorPoint(L, 1), q1 = doorPoint(R, 1);
  near(p0.x, L.gIn[0], 1e-9); near(p0.z, L.gIn[2], 1e-9);
  near(Math.hypot(p1.x - 0.962, p1.z - 1.25), Math.hypot(L.gIn[0] - 0.962, L.gIn[2] - 1.25), 1e-9, 'rigid about the hinge');
  assert.ok(p1.x > 1.6 && p1.z > 0.29 + 0.4, `the left door swings out to the left and forward (${p1.x.toFixed(2)}, ${p1.z.toFixed(2)})`);
  assert.ok(q1.x < -1.6, 'the right door to the right');
  near(p1.y, p0.y, 1e-9, 'a vertical hinge');
  const ax = doorAxes(L, 1);
  assert.ok(ax.n.x > 0.2 && Math.abs(ax.a.length() - 1) < 1e-9, 'outward normal turned with the door');
});

test('a door opens as far as he can reach it from the seat (and wide enough to climb through)', () => {
  for (const [D, seat] of [[BLITZ_L, SEAT_L], [BLITZ_R, SEAT_R]]) {
    const rig = doorRig(D.def, D.box), f = boardFrac(rig, seat);
    assert.ok(f >= 0.5 && f < 1, `${D.def.node}: opens to ${(f * 75).toFixed(0)}° of 75°`);
    const S = SEATED_SHOULDER, side = Math.sign(rig.gIn[0]);
    const sh = [seat[0] + side * S.out, seat[1] + S.up, seat[2] - S.back], p = doorPoint(rig, f);
    assert.ok(Math.hypot(p.x - sh[0], p.y - sh[1], p.z - sh[2]) <= S.reach + S.lean + 1e-9, 'its pull within his reach there');
    const wider = doorPoint(rig, Math.min(1, f + 0.05));
    assert.ok(f > 0.99 || Math.hypot(wider.x - sh[0], wider.y - sh[1], wider.z - sh[2]) > S.reach + S.lean, 'and no further');
  }
});

test('timelines: the door moves only while his fist is on it; shut after a pull, open after a push', () => {
  const T = DOOR_HAND, dt = 1 / 60;
  let prev = closeKey(0), moved = 0;
  for (let t = dt; t < T.reach + T.pull + T.let + 0.1; t += dt) {
    const k = closeKey(t);
    if (Math.abs(k.door - prev.door) > 1e-9) { moved++; assert.ok(k.w > 0.999 && prev.w > 0.999, `t=${t.toFixed(2)}: door moves only with the hand on it (w ${k.w})`); }
    assert.ok(k.door <= prev.door + 1e-12, 'a pull only ever closes it');
    prev = k;
  }
  assert.ok(moved > 20, 'it moves through the pull');
  const end = closeKey(T.reach + T.pull + T.let + 0.01);
  assert.ok(end.done && end.door === 0 && end.w === 0, 'shut, hand back');
  assert.ok(closeKey(T.reach * 0.5).door === 1, 'still open while he reaches');
  let po = openKey(0);
  for (let t = dt; t < T.reach + T.push + 0.05; t += dt) {
    const k = openKey(t);
    if (k.door !== po.door) assert.ok(k.w > 0.999 && po.w > 0.999, 'pushed open only with the hand on it');
    assert.ok(k.door >= po.door - 1e-12);
    po = k;
  }
  assert.ok(po.done && po.door === 1 && po.w === 1, 'open, his hand still on it as he rises');
  let ps = shutKey(0);
  for (let t = dt; t < 1.2; t += dt) { const k = shutKey(t); if (k.door !== ps.door) assert.ok(k.w > 0.999 && ps.w > 0.999, 'swung shut only in his hand'); ps = k; }
  assert.ok(ps.done && ps.door === 0, 'shut from outside');
});

test('rear doors (the half-track): in over the sill, held at the doors only for the last man in, along the floor, sat; out the reverse', async () => {
  const { rearDoorMotion, REAR_HOLD, BOARD_TIMES: T } = await import('../../src/art/vehicle-crew.js');
  const S = { x: 0, y: 0, z: -3.4 }, G = { x: 0, y: 0.64, z: -2.47 }, P = { x: 0.42, y: 0.64, z: -0.15 }, Z = { x: 0.42, y: 0.5, z: 0.35 };
  const walk = Math.hypot(P.x - G.x, P.z - G.z) / 1.3;
  const at = (t, hold) => rearDoorMotion('in', t, S, G, P, Z, hold);
  assert.equal(at(0.1, REAR_HOLD.pull).clip, 'idle');
  const up = at(T.wait + T.climb * 0.5, REAR_HOLD.pull);
  assert.ok(up.clip === 'climb' && up.p.y > 0 && up.p.y <= G.y + 1e-9, 'climbing over the sill');
  const held = at(T.wait + T.climb + 0.5, REAR_HOLD.pull);
  assert.ok(held.holding > 0.49 && held.holding < 0.51 && Math.hypot(held.p.x - G.x, held.p.z - G.z) < 1e-9, 'the last man in stands at the doors while he shuts them');
  assert.equal(at(T.wait + T.climb + 0.5, 0).holding, -1, 'nobody holds them when men follow');
  const mid = at(T.wait + T.climb + REAR_HOLD.pull + walk / 2, REAR_HOLD.pull);
  assert.ok(mid.clip === 'walk' && mid.p.y === 0.64, 'walks up the floor to his seat');
  const end = at(T.wait + T.climb + REAR_HOLD.pull + walk + T.sit + 0.01, REAR_HOLD.pull);
  assert.ok(end.done && end.seated && Math.hypot(end.p.x - Z.x, end.p.y - Z.y, end.p.z - Z.z) < 1e-9, 'sat');
  // a troop seat (no seat figure): stops at P, done there (hidden under the hull sides)
  const bench = rearDoorMotion('in', T.wait + T.climb + walk + 0.01, S, G, P, null, 0);
  assert.ok(bench.done && !bench.seated);
  // out: rise, walk back, (push the doors open), climb down to the ground outside
  const o1 = rearDoorMotion('out', T.rise + walk + 0.3, S, G, P, Z, REAR_HOLD.push);
  assert.ok(o1.holding > 0.29 && o1.holding < 0.31, 'pushing them open');
  const o2 = rearDoorMotion('out', T.rise + walk + REAR_HOLD.push + T.down + 0.01, S, G, P, Z, REAR_HOLD.push);
  assert.ok(o2.done && Math.hypot(o2.p.x - S.x, o2.p.y - S.y, o2.p.z - S.z) < 1e-9, 'down outside');
});
