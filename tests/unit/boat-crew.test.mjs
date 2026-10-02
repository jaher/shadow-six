// Men in open boats (src/art/boat-crew.js): seat layouts / assignment, clip choice, the paddle stroke and the oars,
// the boarding path; the boarding hint the cursor / tooltip show (abilities/drive.js boardingHint, ui/tooltip.js).
import { test, assert, near } from './lib.mjs';
import { BOAT_SEATS, ENCLOSED, boatLayout, assignBoatSeats, seatClip, paddleKey, paddlePose, HOLD, PADDLE, rowKey, ROW,
  boardPath, pathPoint } from '../../src/art/boat-crew.js';
import { makeSim } from './abilsim.mjs';
import { boardingHint } from '../../src/abilities/drive.js';
import { vehicleOrderLabel } from '../../src/ui/tooltip.js';

test('boat seats: the raft kneels the Marine at the stern and seats the men forward of him, low or on the bow; the mini-sub draws nobody', () => {
  const raft = boatLayout('raft');
  assert.equal(raft, BOAT_SEATS.raft);
  assert.equal(raft.seats[0].pose, 'paddle', 'seat 0: the paddler');
  assert.ok(raft.seats[0].p[2] < -0.6, 'at the stern');
  assert.ok(raft.seats.length >= 5, 'five seats (M13 raft seats: 5)');
  const first = raft.seats[1];
  assert.equal(first.pose, 'floor', 'the first man sits on the floor (below the paddle\'s sweep)');
  assert.ok(!first.yaw, '…facing the bow');
  for (const s of raft.seats.slice(1)) assert.ok(s.p[2] > raft.seats[0].p[2] + 0.6, 'forward of the Marine');
  assert.equal(raft.seats[2].pose, 'tube', 'the second on the bow tube…');
  near(raft.seats[2].yaw, Math.PI, 1e-9, '…facing aft');
  for (const s of raft.seats) assert.ok(Math.abs(s.p[0]) < 0.6 && Math.abs(s.p[2]) < 1.2, 'inside the 2.7 × 1.3 m hull');
  for (const s of raft.seats) assert.ok(s.feet?.l && s.feet?.r, 'every raft seat fits the legs to the hull');
  const row = boatLayout('rowboat');
  assert.equal(row.seats[0].pose, 'row');
  near(row.seats[0].yaw, Math.PI, 1e-9, 'the oarsman faces aft');
  assert.ok(ENCLOSED.has('minisub'));
  assert.equal(boatLayout('minisub').seats.length, 0, 'the Biber pilot is enclosed under the hatch');
  // other library boats: their standing deck sockets, helm first (the M4 escape patrol boat)
  const meta = { sockets: [
    { name: 'gunner_mg', pos: [0, 1.38, 3.95], dir: [0, 0, 1], pose: 'stand_mg' },
    { name: 'passenger_0', pos: [-0.7, 0.88, -4.9], dir: [0, 0, 1], pose: 'stand_boat' },
    { name: 'helm', pos: [0, 0.98, -3.25], dir: [0, 0, 1], role: 'driver', pose: 'stand_helm' },
    { name: 'crew_stern', pos: [0, 0.87, -6.3], dir: [0, 0, -1], pose: 'stand_lookout' },
  ] };
  const pb = boatLayout('patrolboat', meta);
  assert.deepEqual(pb.seats.map((s) => s.p[2]), [-3.25, -4.9, -6.3], 'helm, passenger, stern lookout (not the MG post)');
  assert.ok(pb.seats.every((s) => s.pose === 'stand'));
  near(pb.seats[2].yaw, Math.PI, 1e-9, 'the stern lookout faces aft');
  assert.equal(boatLayout('fishing_boat', null).seats.length, 0, 'no sockets, no figures');
});

test('boat seats: the operator takes seat 0, the others the first free seat and keep it; extras get none', () => {
  const ma = { id: 'ma' }, gb = { id: 'gb' }, sn = { id: 'sn' }, sa = { id: 'sa' };
  let s = assignBoatSeats(new Map(), [ma], ma, 3);
  assert.equal(s.get(ma), 0);
  s = assignBoatSeats(s, [ma, gb, sn], ma, 3);
  assert.deepEqual([s.get(ma), s.get(gb), s.get(sn)], [0, 1, 2]);
  s = assignBoatSeats(s, [ma, sn], ma, 3); // GB lands: the Sniper keeps his seat
  assert.equal(s.get(sn), 2);
  s = assignBoatSeats(s, [ma, sn, sa], ma, 3);
  assert.equal(s.get(sa), 1, 'the freed seat is taken');
  const s2 = assignBoatSeats(s, [ma, sn, sa, gb], ma, 3);
  assert.equal(s2.has(gb), false, 'nobody beyond the seats');
  // the operator left: seat 0 stays free for him, passengers never take it
  const s3 = assignBoatSeats(s, [sn, sa, gb], null, 4);
  assert.ok(![...s3.values()].includes(0), 'seat 0 kept for the operator');
  // a boat nobody operates (scripted escape boat): seat 0 (the helm) is anyone's
  const s4 = assignBoatSeats(new Map(), [gb, sn], null, 4, true);
  assert.deepEqual([s4.get(gb), s4.get(sn)], [0, 1]);
});

test('boat seats: clip and placement per pose', () => {
  assert.deepEqual(seatClip('paddle'), { clip: 'kneel_shoot', mode: 'root' }, 'the paddler kneels on the floor');
  assert.deepEqual(seatClip('paddle', (n) => n !== 'kneel_shoot'), { clip: 'crouch_idle', mode: 'root' });
  assert.deepEqual(seatClip('floor'), { clip: 'boat_sit', mode: 'root' }, 'the raft clip: on the floor, hands on the tubes');
  assert.deepEqual(seatClip('floor', (n) => n !== 'boat_sit'), { clip: 'sit', mode: 'settle' });
  assert.deepEqual(seatClip('tube'), { clip: 'sit', mode: 'settle' });
  assert.deepEqual(seatClip('row'), { clip: 'sit', mode: 'settle' });
  assert.deepEqual(seatClip('stand'), { clip: 'idle', mode: 'root' });
});

test('paddle: alternating strokes, blade in the water on the stroke side, the hands change over; one side when pivoting; rest hold', () => {
  for (const s of [1, -1]) {
    const c = paddleKey(0, s);
    assert.ok(c.wet, 'catch: blade in');
    assert.ok(Math.sign(c.T[0]) === s && Math.abs(c.T[0]) > 0.8, `blade out over the ${s > 0 ? 'left' : 'right'} side`);
    assert.ok(c.T[1] < 0 && c.T[2] > 0.5, 'catch: forward, below the waterline');
    assert.equal(c.top, s > 0 ? 'r' : 'l', 'top hand on the grip away from the stroke');
    const ex = paddleKey(0.5, s);
    assert.ok(ex.T[2] < c.T[2] - 0.6, 'the blade is pulled back');
    const rec = paddleKey(0.8, s);
    assert.ok(!rec.wet && rec.T[1] > 0.5, 'recovery: out of the water');
    const next = paddleKey(0.999, s);
    assert.ok(Math.sign(next.T[0]) === -s, 'the next catch is on the other side');
    const turn = paddleKey(0.999, s, true);
    assert.ok(Math.sign(turn.T[0]) === s, 'pivoting: the same side again');
    // continuous through the stroke (no snaps)
    let prev = paddleKey(0, s);
    for (let u = 0.01; u < 1; u += 0.01) {
      const k = paddleKey(u, s);
      assert.ok(Math.hypot(k.G[0] - prev.G[0], k.G[1] - prev.G[1], k.G[2] - prev.G[2]) < 0.08, `grip jumps at u=${u.toFixed(2)}`);
      prev = k;
    }
  }
  const h = paddlePose(0.3, 1, false, 0);
  assert.deepEqual(h.G, HOLD.G, 'stopped: the paddle across his thighs');
  assert.ok(Math.abs(h.T[1] - h.G[1]) < 0.1, 'held level');
  const half = paddlePose(0, 1, false, 0.5);
  assert.ok(half.G[1] > HOLD.G[1] && half.G[1] < paddleKey(0, 1).G[1], 'blends from the hold to the stroke');
  assert.equal(paddlePose(0, 1, false, 1).lowerAt, PADDLE.lower);
});

test('oars: catch → drive (blades in) → feathered recovery, the oarsman leans with the stroke', () => {
  const c = rowKey(0), d = rowKey(ROW.drive * 0.5), f = rowKey(ROW.drive), r = rowKey(0.75);
  near(c.sweep, ROW.catch, 1e-9, 'catch: blades forward');
  assert.ok(d.wet && d.pitch > c.pitch + 0.1, 'blades buried on the drive (pitched down from the catch)');
  assert.ok(d.sweep < c.sweep && f.sweep < d.sweep, 'swept aft');
  near(f.sweep, ROW.finish, 1e-9);
  assert.ok(!r.wet && r.pitch < d.pitch - 0.1 && r.feather > 1.4, 'out of the water and feathered on the recovery');
  assert.ok(c.bend > 0.3 && f.bend < 0, 'reach forward at the catch, lean back at the finish');
  near(rowKey(1).sweep, rowKey(0).sweep, 1e-9, 'cyclic');
});

test('boarding path: from the bank over the tube to the seat (sit down last); from the water hoisted in; inside: no climb', () => {
  const hull = { l: 2.7, w: 1.3, rim: 0.44 };
  const seat = { x: 0, y: 0.02, z: -0.2, floor: 0.02 };
  const bank = { x: 1.8, y: 0.3, z: 0, wet: false };
  const P = boardPath(bank, seat, hull);
  assert.ok(!P.inside && Math.abs(P.R.x) > 0.4 && Math.abs(P.R.x) < 0.65 && P.R.y === 0.44, 'over the side tube');
  const at = (t) => pathPoint(P, bank, seat, t, 'in');
  assert.equal(at(0).x, bank.x); assert.equal(at(0).clip, 'walk');
  near(at(P.t1).y, 0.44, 1e-6, 'on the tube');
  assert.equal(at(P.dur).clip, 'seat');
  near(at(P.dur).x, 0, 1e-9); near(at(P.dur).z, -0.2, 1e-9);
  const water = { x: -1.5, y: -1.0, z: 0.3, wet: true };
  const W = boardPath(water, seat, hull);
  assert.equal(pathPoint(W, water, seat, 0.05, 'in').clip, 'hoist', 'from the water: hoisted in');
  assert.ok(W.t1 >= 0.7);
  const ins = boardPath({ x: 0.1, y: -0.4, z: 0.2 }, seat, hull);
  assert.ok(ins.inside && ins.t1 < 0.3, 'already over the floor (the raft deployed under him): straight to the seat');
  // getting out: stand up, over the side, walk to the spot
  const out = (t) => pathPoint(P, bank, { ...seat, y: 0.02 }, t, 'out');
  assert.equal(out(0.1).clip, 'stand');
  assert.equal(out(P.t3 + 0.1).clip, 'walk');
  near(out(P.dur).x, bank.x, 1e-9); near(out(P.dur).z, bank.z, 1e-9);
});

test('boarding hint: BOARD over a boat the selection may get into, the reason when the Marine has not boarded first', () => {
  const s = makeSim({ size: [40, 40], terrain: [{ type: 'rect', terrain: 'water', x: 20, z: 0, w: 20, d: 40 }, { type: 'rect', terrain: 'shallow', x: 18, z: 0, w: 2, d: 40 }],
    commandos: [{ role: 'greenberet', x: 16, z: 20 }, { role: 'diver', x: 17, z: 22 }] });
  const w = s.world;
  const raft = w.spawnVehicle('raft', { x: 18.6, z: 20, heading: 0 });
  const gb = s.cmd('greenberet'), ma = s.cmd('diver');
  for (const u of w.commandos) u.selected = false;
  gb.selected = true;
  const h1 = boardingHint(raft, [gb], w);
  assert.equal(h1.ok, false);
  assert.match(h1.reason, /Marine must board first/);
  assert.match(vehicleOrderLabel(raft, w, 'RAFT'), /^RAFT — THE MARINE MUST BOARD FIRST$/);
  raft._boardHint = null;
  ma.selected = true;
  assert.deepEqual(boardingHint(raft, [gb, ma], w), { ok: true, reason: null }, 'the Marine may: a click boards');
  raft._boardHint = null;
  assert.equal(vehicleOrderLabel(raft, w, 'RAFT'), 'BOARD RAFT');
  assert.equal(raft.enter(ma), true);
  assert.ok(ma.boardFrom && Math.abs(ma.boardFrom.x - 17) < 1e-9, 'where he got in from is kept for the step-in');
  raft._boardHint = null;
  ma.selected = false;
  assert.equal(boardingHint(raft, [gb], w).ok, true, 'Marine aboard: the Green Beret may board');
  assert.equal(boardingHint(raft, [], w), null, 'nothing selected: plain label');
  assert.equal(vehicleOrderLabel({ kind: 'enemy' }, w, 'SOLDIER'), 'SOLDIER');
});
