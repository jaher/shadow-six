// The rowboat's oars and the men's seats in the open boats (src/art/oars.js, src/art/boat-crew.js): the oars turn
// between thole pins aft of the oarsman, the stroke (catch, drive, feathered recovery), the handles in his reach and
// apart, no oar through the hull or a thwart, turns and pivots, the stroke clock from the speed; every seated man's
// feet inside the hull on its floor, the escape boat's men off its deck fittings, the raft's spare paddle stowed; the
// raft's paddle clear of its tubes, thwart and floor over the whole stroke cycle.
import { test, assert, near } from './lib.mjs';
import { OAR, BLADE_C, ROW, EASY, TRAIL, rowKey, backKey, oarPoints, oarDir, oarAnglesThrough, pivotOf, pitchFor, rowPeriod,
  catchOffset } from '../../src/art/oars.js';
import { BOAT_SEATS, STAND_FIX, boatLayout, oarKeys, SHIPPED, STOW, paddlePose, PADDLE, HOLD, UPRIGHT, SWITCH_U } from '../../src/art/boat-crew.js';

const ROWER = BOAT_SEATS.rowboat.seats[0];
const U = Array.from({ length: 200 }, (_, i) => i / 200);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The rowboat's hull, surveyed from the shipped model (rowboat_wood LOD0, rays toward the centreline): inner
// half-breadth at y 0.35 / 0.45 for z = −1.9 … 1.9 step 0.1, the gunwale top, the thwarts (z range, top).
const HB35 = [0.004, 0.1, 0.194, 0.271, 0.337, 0.403, 0.455, 0.497, 0.517, 0.558, 0.579, 0.599, 0.601, 0.628, 0.641, 0.65, 0.644, 0.664, 0.667,
  0.669, 0.651, 0.664, 0.659, 0.65, 0.628, 0.628, 0.614, 0.598, 0.564, 0.556, 0.528, 0.494, 0.443, 0.4, 0.337, 0.268, 0.192, 0.097, 0.003];
const HB45 = [0.021, 0.129, 0.227, 0.307, 0.371, 0.44, 0.492, 0.532, 0.55, 0.589, 0.608, 0.627, 0.621, 0.653, 0.664, 0.671, 0.658, 0.683, 0.686,
  0.688, 0.665, 0.683, 0.678, 0.671, 0.643, 0.652, 0.64, 0.626, 0.591, 0.588, 0.561, 0.53, 0.481, 0.437, 0.375, 0.304, 0.225, 0.127, 0.019];
const HB05 = [0, 0, 0.059, 0.12, 0.169, 0.22, 0.265, 0.302, 0.331, 0.365, 0.388, 0.414, 0.429, 0.449, 0.464, 0.474, 0.477, 0.491, 0.494, 0.498,
  0.487, 0.491, 0.484, 0.474, 0.459, 0.448, 0.431, 0.412, 0.384, 0.363, 0.332, 0.3, 0.26, 0.217, 0.167, 0.119, 0.058, 0, 0];
const at = (arr, z) => { const f = (z + 1.9) / 0.1, i = Math.max(0, Math.min(arr.length - 2, Math.floor(f))), k = Math.min(1, Math.max(0, f - i)); return arr[i] + (arr[i + 1] - arr[i]) * k; };
const hbAt = (y, z) => (y <= 0.35 ? at(HB35, z) : at(HB35, z) + (at(HB45, z) - at(HB35, z)) * Math.min(1, (y - 0.35) / 0.1));
// gunwale top (sheer) for z = −1.9 … 1.9 step 0.1 (the old thole pins at z 0.3 left out: the oars never reach them)
const SHEER = [0.7, 0.692, 0.656, 0.634, 0.612, 0.584, 0.568, 0.556, 0.553, 0.536, 0.536, 0.523, 0.524, 0.512, 0.508, 0.505, 0.509, 0.499,
  0.509, 0.498, 0.509, 0.499, 0.51, 0.506, 0.516, 0.514, 0.52, 0.527, 0.543, 0.544, 0.556, 0.565, 0.586, 0.594, 0.614, 0.645, 0.666, 0.705, 0.71];
const RUB = 0.73; // the rubbing strip's outer face (its top 1 cm under the sheer)
const THWARTS = [[-1.31, -1.09, 0.357], [-0.27, -0.03, 0.337], [0.93, 1.17, 0.357]];
/** Is hull point p (an oar's loom, radius r) inside the hull's planking, gunwale or a thwart? */
function inHull(p, r = 0.024) {
  const [x, y, z] = p, ax = Math.abs(x);
  const sheer = at(SHEER, z), cap = hbAt(0.45, z) + 0.03;
  if (ax > cap) {                                              // outboard of the gunwale cap: the rubbing strip's corner
    const dx = Math.max(0, ax - RUB), dy = Math.max(0, y - (sheer - 0.01));
    if (Math.hypot(dx, dy) < r - 0.002 && y + r > 0) return 'side';
  } else if (y - r < sheer && ax > hbAt(Math.max(0.35, y), z) - r && y + r > 0) return 'side';
  for (const [z0, z1, tw] of THWARTS) if (z > z0 - r && z < z1 + r && y - r < tw && y + r > tw - 0.035 && ax < hbAt(0.35, z)) return 'thwart';
  return false;
}
/** Sample points along an oar (pivot ± inboard / outboard) at sweep / pitch. */
function along(s, sweep, pitch, step = 0.02) {
  const P = oarPoints(s, sweep, pitch), out = [];
  for (let k = -OAR.inboard; k <= OAR.length - OAR.inboard + 1e-9; k += step) out.push({ k, p: P.pivot.map((v, i) => v + P.dir[i] * k) });
  return out;
}

test('oars: each turns about its thole pivot on the gunwale, a little aft of the oarsman (in front of him); the hand on the grip', () => {
  for (const s of [1, -1]) {
    const p = pivotOf(s);
    assert.ok(Math.sign(p[0]) === s && Math.abs(Math.abs(p[0]) - hbAt(0.45, p[2])) < 0.03, 'on the gunwale of its side');
    assert.ok(p[1] > at(SHEER, p[2]) && p[1] < at(SHEER, p[2]) + 0.12, 'between the thole pins above the gunwale');
    const ahead = ROWER.p[2] - p[2];
    assert.ok(ahead > 0.25 && ahead < 0.45, `aft of the thwart by ${ahead.toFixed(2)} m — the handles cross the pins' line mid-drive`);
    for (const sweep of [-1.3, -0.6, 0, 0.7]) for (const pitch of [-0.1, 0.25, 0.42]) {
      const P = oarPoints(s, sweep, pitch);
      assert.deepEqual(P.pivot, p, 'the pivot never leaves the oarlock');
      near(dist(P.hand, P.pivot), OAR.hand, 1e-9);
      near(dist(P.blade, P.pivot), BLADE_C, 1e-9);
      near(Math.hypot(...oarDir(s, sweep, pitch)), 1, 1e-12);
      const back = oarAnglesThrough(s, P.hand);
      near(back.sweep, sweep, 1e-9, 'angles through the hand: sweep'); near(back.pitch, pitch, 1e-9, '…pitch'); near(back.reach, OAR.hand, 1e-9);
    }
  }
});

test('oars: a stroke — the blades dip in at the catch, stay buried through the drive, come out and go back feathered, clear of the water', () => {
  const y = (u) => oarPoints(1, rowKey(u).sweep, rowKey(u).pitch).blade[1];
  assert.ok(y(0) > 0.05, 'catch: the blade just over the water…');
  assert.ok(y(ROW.dip) < -0.1, '…and in it a moment later');
  for (const u of U) {
    const k = rowKey(u), b = y(u);
    if (u > 0.08 && u < ROW.drive - 0.02) { assert.ok(b < -0.1, `drive u=${u}: blade centre ${b.toFixed(2)} buried (the 13 cm blade wholly under)`); assert.ok(k.wet); assert.equal(k.feather, 0, 'square on the drive'); }
    if (u > ROW.release + 0.02 && u < 0.92) { assert.ok(b > 0.1, `recovery u=${u}: blade clear (${b.toFixed(2)})`); assert.ok(!k.wet); }
    if (u > 0.58 && u < 0.84) assert.ok(k.feather > 1.4, 'feathered on the recovery');
  }
  // the drive sweeps the blade aft (the boat pushed forward), the recovery forward; the oarsman leans with it
  assert.ok(rowKey(0.1).sweep > rowKey(0.3).sweep && rowKey(0.7).sweep > rowKey(0.6).sweep);
  assert.ok(rowKey(0).bend > 0.35 && rowKey(ROW.drive).bend < -0.2, 'reaching toward the stern at the catch, leaning back at the finish');
  let prev = rowKey(0);
  for (const u of U.slice(1)) { const k = rowKey(u); assert.ok(Math.abs(k.sweep - prev.sweep) < 0.06 && Math.abs(k.pitch - prev.pitch) < 0.05, `smooth at u=${u}`); prev = k; }
  near(rowKey(1).sweep, rowKey(0).sweep, 1e-9); near(rowKey(1).pitch, rowKey(0).pitch, 1e-9);
});

test('oars: the handles stay in the oarsman\'s reach, in front of him, a hand\'s width apart (they never cross)', () => {
  const pelvis = [ROWER.p[0], ROWER.p[1] + 0.1, ROWER.p[2]];
  for (const u of U) {
    const k = rowKey(u);
    // his shoulders: 0.47 m up the spine from the pelvis, leaning toward the stern (−z) by the stroke's bend
    const sh = (side) => [side * 0.18, pelvis[1] + 0.47 * Math.cos(k.bend), pelvis[2] - 0.47 * Math.sin(k.bend)];
    const hp = oarPoints(1, k.sweep, k.pitch).hand, hs = oarPoints(-1, k.sweep, k.pitch).hand;
    assert.ok(hp[0] > 0.12 && hs[0] < -0.12, `u=${u}: port handle at x ${hp[0].toFixed(2)}, starboard ${hs[0].toFixed(2)} — apart`);
    assert.ok(hp[2] < pelvis[2] - 0.05, 'in front of him (toward the stern he faces)');
    assert.ok(hp[1] > pelvis[1] + 0.2 && hp[1] < pelvis[1] + 0.45, 'between his lap and his chest');
    assert.ok(dist(hp, sh(1)) < 0.6 && dist(hs, sh(-1)) < 0.6, `u=${u}: within arm's reach (${dist(hp, sh(1)).toFixed(2)} m)`);
  }
  for (const key of [EASY]) assert.ok(oarPoints(1, key.sweep, key.pitch).hand[0] > 0.12, 'held at rest: still apart');
});

test('oars: no part of an oar goes through the planking, the gunwale or a thwart — rowing, turning, pivoting, held, trailing', () => {
  const check = (s, k, what) => { for (const { k: d, p } of along(s, k.sweep, k.pitch)) if (Math.abs(d) > 0.05) { const h = inHull(p); assert.ok(!h, `${what}: the ${s > 0 ? 'port' : 'starboard'} oar ${d.toFixed(2)} m from its pivot is in the ${h} (${p.map((v) => v.toFixed(2))})`); } };
  for (const u of U) {
    for (const [opts, what] of [[{}, 'rowing'], [{ turn: 1 }, 'turning'], [{ turn: -1 }, 'turning'], [{ pivot: true, turn: 1 }, 'pivoting'], [{ act: 0 }, 'held'], [{ hold: 0 }, 'trailing']]) {
      const K = oarKeys(u, opts);
      for (const s of [1, -1]) check(s, K[s], `${what} u=${u.toFixed(3)}`);
    }
  }
  // the blade outboard: wholly outside the hull, buried on the drive below the waterline (y 0)
  for (const u of [0.15, 0.3]) { const P = oarPoints(-1, rowKey(u).sweep, rowKey(u).pitch); assert.ok(Math.abs(P.blade[0]) > 1.5 && P.blade[1] < -0.08); }
  // shipped (the empty boat): inside along the sides over the thwarts, clear of the planking
  for (let d = -OAR.inboard; d <= OAR.length - OAR.inboard; d += 0.05) {
    const z = SHIPPED.z + d, w = d > OAR.length - OAR.inboard - OAR.blade ? 0.007 : 0.024;
    assert.ok(SHIPPED.x + w < hbAt(SHIPPED.y, z), `shipped oar at z ${z.toFixed(2)} inside the hull`);
    for (const [z0, z1, top] of THWARTS) if (z > z0 && z < z1) assert.ok(SHIPPED.y - (d > 1.4 ? OAR.bladeW / 2 : 0.024) > top, 'over the thwarts');
  }
});

test('oars: in a turn the inside oar shortens its stroke; pivoting one pulls while the other backs; at rest held flat on the water; nobody at the oars: trailing', () => {
  const arc = (K, s) => { let lo = 9, hi = -9; for (const u of U) { lo = Math.min(lo, K(u)[s].sweep); hi = Math.max(hi, K(u)[s].sweep); } return hi - lo; };
  const right = (u) => oarKeys(u, { turn: 1 });          // turning to starboard: the port oar is outside
  assert.ok(arc(right, -1) < arc(right, 1) * 0.5, 'turning to starboard: the starboard (inside) oar takes the short stroke');
  const left = (u) => oarKeys(u, { turn: -1 });
  assert.ok(arc(left, 1) < arc(left, -1) * 0.5, '…and the port one turning to port');
  // pivoting: both blades in the water at once, swept opposite ways (pull and back)
  let opposite = 0, n = 0;
  for (const u of U) {
    const a = oarKeys(u, { pivot: true, turn: 1 }), b = oarKeys(u + 0.005, { pivot: true, turn: 1 });
    if (a[1].wet && a[-1].wet) { n++; if (Math.sign(b[1].sweep - a[1].sweep) === -Math.sign(b[-1].sweep - a[-1].sweep)) opposite++; }
  }
  assert.ok(n > 40 && opposite / n > 0.9, `pivoting: one oar pulls while the other backs (${opposite}/${n})`);
  near(backKey(0.1).sweep, rowKey(ROW.drive - 0.1).sweep, 1e-9);
  // rest: the oarsman holds them, blades flat on the water; nobody: trailing aft alongside, blades on the water
  const r = oarKeys(0.3, { act: 0 });
  near(r[1].sweep, EASY.sweep, 1e-9); near(r[1].feather, Math.PI / 2, 1e-9);
  near(oarPoints(1, EASY.sweep, EASY.pitch).blade[1], 0.02, 1e-6, 'blade resting on the water');
  const t = oarKeys(0.3, { hold: 0 });
  near(t[-1].sweep, TRAIL.sweep, 1e-9);
  const tb = oarPoints(-1, TRAIL.sweep, TRAIL.pitch);
  assert.ok(tb.tip[2] < -1.8 && tb.blade[1] > 0 && tb.blade[1] < 0.25, 'trailing aft, blade just clear of the water');
});

test('oars: the stroke clock follows the speed (the blade grips the water through the drive); the wake rings where the blades catch', () => {
  assert.ok(rowPeriod(1) > rowPeriod(2.5) && rowPeriod(2.5) > rowPeriod(4) - 1e-9, 'faster boat, quicker strokes');
  assert.ok(rowPeriod(0) <= 2.6 && rowPeriod(10) >= 1.25, 'clamped');
  // at the rowboat's 2.5 m/s the boat runs past the buried blade: its travel along the hull ≈ the boat's in the drive
  const v = 2.5, per = rowPeriod(v);
  const travel = oarPoints(1, ROW.catch, ROW.pitchIn).blade[2] - oarPoints(1, ROW.finish, ROW.pitchIn).blade[2];
  near(travel, v * ROW.drive * per, 0.1 * travel, 'blade locked in the water');
  const c = catchOffset(), b = oarPoints(1, ROW.catch, ROW.pitchIn).blade;
  near(c.fwd, b[2], 1e-9); near(c.side, b[0], 1e-9);
  assert.ok(c.side > 1.5 && c.fwd > 0, 'out beyond the hull, forward of midships');
  near(pitchFor(0.02), EASY.pitch, 1e-12);
});

// ------------------------------------------------------------------ seats: legs fitted inside the hulls

test('seats: every seated man\'s feet go inside the hull, on its floor — raft (3 and 5 aboard) and rowboat; different men\'s feet apart', () => {
  // raft: floor (y 0.02) between |x| 0.25 from z −0.9 to 0.9 (narrowing to 0.15 at 0.9), the cross-thwart tube
  // z −0.33 … −0.17 topped at 0.21, the tubes' crown ~0.29–0.31 (survey of raft_deployed)
  const raftOk = ([x, y, z]) => {
    const ax = Math.abs(x);
    if (z > -0.34 && z < -0.16) return Math.abs(y - (0.21 + 0.085)) < 0.02 && ax < 0.25;     // a foot up on the thwart
    if (z < -0.95) return y > 0.36 && ax < 0.3;                                              // up on the stern tube
    const half = z > 0.75 ? 0.25 - (z - 0.75) * 0.7 : 0.25;
    return z > -0.9 && z < 0.9 && ax < half - 0.04 && Math.abs(y - 0.105) < 0.01;
  };
  const rowOk = ([x, y, z]) => Math.abs(y - 0.128) < 0.01 && Math.abs(x) < at(HB05, z) - 0.05 && Math.abs(z) < 1.55;
  for (const [type, ok] of [['raft', raftOk], ['rowboat', rowOk]]) {
    const L = boatLayout(type), spots = [];
    L.seats.forEach((s, k) => {
      assert.ok(s.feet?.l && s.feet?.r, `${type} seat ${k}: legs fitted`);
      for (const side of ['l', 'r']) { const f = s.feet[side]; assert.ok(ok(f), `${type} seat ${k} ${side} foot ${f.map((v) => v.toFixed(2))} inside the hull, on its floor`); spots.push({ k, f }); }
      // left / right as the man sees them (yaw: his facing (sin, cos); his left = (cos, −sin))
      const yaw = s.yaw || 0, lx = Math.cos(yaw), lz = -Math.sin(yaw);
      assert.ok((s.feet.l[0] - s.feet.r[0]) * lx + (s.feet.l[2] - s.feet.r[2]) * lz > 0.08, `${type} seat ${k}: left foot to his left`);
    });
    for (const a of spots) for (const b of spots) if (a.k < b.k) assert.ok(dist(a.f, b.f) > 0.1, `${type}: seats ${a.k} and ${b.k} feet apart (${dist(a.f, b.f).toFixed(2)} m)`);
  }
  // the kneeling paddler: back knee down on the floor, toes kept on the stern tube
  assert.equal(BOAT_SEATS.raft.seats[0].feet.kneeR, 'down');
  assert.ok(BOAT_SEATS.raft.seats[0].feet.r[3] >= 0.3, 'back toes not into the stern tube');
});

test('seats: the escape boat\'s men stand on clear deck (off its engine-room vents and the stern bollard); the raft\'s spare paddle is stowed inside on the tube', () => {
  const meta = { asset: 'patrol_boat', sockets: [
    { name: 'helm', pos: [0, 0.981, -3.25], dir: [0, 0, 1], pose: 'stand_helm' },
    { name: 'passenger_0', pos: [-0.7, 0.879, -4.9], dir: [0, 0, 1], pose: 'stand_boat' },
    { name: 'passenger_1', pos: [0.7, 0.879, -4.9], dir: [0, 0, 1], pose: 'stand_boat' },
    { name: 'passenger_2', pos: [-0.7, 0.872, -5.7], dir: [0, 0, 1], pose: 'stand_boat' },
    { name: 'passenger_3', pos: [0.7, 0.872, -5.7], dir: [0, 0, 1], pose: 'stand_boat' },
    { name: 'crew_stern', pos: [0, 0.87, -6.3], dir: [0, 0, -1], pose: 'stand_lookout' },
  ] };
  const L = boatLayout('patrolboat', meta);
  // the after deck's fittings (survey of patrol_boat): vents |x| 0.6 … 1.0 × z −5.3 … −4.9 and −5.8 … −5.5, small
  // vents at (±0.6, −4.6), the centre bollard (0, −6.2)
  const boxes = [[0.6, 1.0, -5.35, -4.85], [0.6, 1.0, -5.85, -5.45], [0.5, 0.7, -4.75, -4.45], [-0.12, 0.12, -6.35, -6.05]];
  for (const s of L.seats.slice(1)) {
    for (const [x0, x1, z0, z1] of boxes) for (const sx of [1, -1]) {
      const bx0 = x0 * sx, bx1 = x1 * sx, lo = Math.min(bx0, bx1), hi = Math.max(bx0, bx1);
      const dx = Math.max(lo - s.p[0], 0, s.p[0] - hi), dz = Math.max(z0 - s.p[2], 0, s.p[2] - z1);
      assert.ok(Math.hypot(dx, dz) > 0.17, `stand spot ${s.p.map((v) => v.toFixed(2))} clear of the fitting [${lo}, ${hi}] × [${z0}, ${z1}]`);
    }
  }
  assert.deepEqual(L.seats[0].p, [0, 0.981, -3.25], 'the helm unchanged');
  assert.ok(STAND_FIX.patrol_boat, 'per-asset fix');
  // raft's spare (starboard) paddle: T-grip 0.55 m inboard of its rowlock, tip 1.05 m out (raft.py); stowed along
  // the crown of the starboard tube, inside the boat's 2.7 × 1.3 m outline, above the tube (crown ≤ 0.31)
  const g = STOW.at(STOW.d0.clone().multiplyScalar(-0.55).toArray()), t = STOW.at(STOW.d0.clone().multiplyScalar(1.05).toArray());
  for (const p of [g, t]) { assert.ok(p.x < -0.3 && p.x > -0.5 && Math.abs(p.z) < 1.0, `stowed end ${p.toArray().map((v) => v.toFixed(2))} along the starboard tube`); assert.ok(p.y > 0.32, 'resting on top of it'); }
  assert.ok(t.z > g.z + 1.4, 'blade forward, grip aft, lengthwise');
});

// The inflatable (raft.py, Blender x y z → hull x, z, −y): the buoyancy tube round a stadium centreline (loop_path,
// bow raised and narrowed), radius 0.19; the cross-thwart tube (radius 0.11) at z −0.25; the floor at y 0.02.
const RAFT_TUBE = (() => {
  const L = 2.7, B = 1.3, R = 0.19, a = L / 2 - R, b = B / 2 - R, zc = R - 0.08, out = [];
  for (let i = 0; i < 40; i++) {
    const t = 2 * Math.PI * i / 40, y = a * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.35;
    let x = b * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.8;
    if (y < 0) x *= 1 - 0.18 * (-y / a) ** 3;
    out.push([x, zc + (y < 0 ? 0.14 * Math.max(0, (-y - a * 0.4) / (a * 0.6)) ** 2 : 0), -y]);
  }
  return { R, pts: out };
})();
const segPt = (p, A, C) => {
  const ab = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], ap = [p[0] - A[0], p[1] - A[1], p[2] - A[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
};
/** Distance from hull point p to the raft's tube skin / the thwart's skin (m; < 0 inside). */
const tubeGap = (p) => { const P = RAFT_TUBE.pts; let d = 9; for (let i = 0; i < P.length; i++) d = Math.min(d, segPt(p, P[i], P[(i + 1) % P.length])); return d - RAFT_TUBE.R; };
const thwartGap = (p) => segPt(p, [-0.47, 0.11, -0.25], [0.47, 0.11, -0.25]) - 0.11;
/** Inside the tube's inner edge (over the floor). */
const overFloor = (p) => {
  const P = RAFT_TUBE.pts; let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][2] > p[2]) !== (P[j][2] > p[2]) && p[0] < ((P[j][0] - P[i][0]) * (p[2] - P[i][2])) / (P[j][2] - P[i][2]) + P[i][0]) inside = !inside;
  return inside && tubeGap(p) > 0;
};

test('raft paddle: over the whole stroke cycle — both sides, pivoting, to and from the rest hold — the shaft and blade never pass through the tubes, the thwart or the floor; the hands change over with the paddle raised', () => {
  // the paddler kneels at the stern facing the bow (yaw 0): his root-local frame is the hull's, offset by the seat
  const seat = BOAT_SEATS.raft.seats[0];
  assert.ok(seat.pose === 'paddle' && !seat.yaw, 'the paddler: seat 0, facing the bow');
  const root = seat.p;
  // nominal kneeling shoulders (root-local, measured on the posed Marine) and the hand's reach to a fist on the shaft
  const SH = { l: [0.11, 0.92, 0.12], r: [-0.16, 0.96, -0.13] }, REACH = 0.6;
  const line = (P) => {
    const d = P.T.map((v, i) => v - P.G[i]), n = Math.hypot(...d);
    return { G: P.G.map((v, i) => v + root[i]), d: d.map((v) => v / n) };
  };
  const W = { shaft: [9], blade: [9], thwart: [9], floor: [], reach: [0], swap: [9], jump: [0] };
  const N = 400;
  for (const same of [false, true]) for (const s of [1, -1]) for (let ai = 0; ai <= 20; ai++) {
    const act = ai / 20, tag = (u) => `u ${u.toFixed(3)} s ${s}${same ? ' pivoting' : ''} act ${act}`;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const u = i / N, P = paddlePose(u, s, same, act), { G, d } = line(P);
      for (let k = 0; k <= 58; k++) {
        const t = k * 0.025, p = G.map((v, j) => v + d[j] * t), blade = t > PADDLE.length - PADDLE.blade;
        // the shaft (r 1.8 cm) and the blade (taken as a rod as wide as the blade: 8.5 cm)
        const gap = tubeGap(p) - (blade ? 0.085 : 0.018);
        if (blade ? gap < W.blade[0] : gap < W.shaft[0]) W[blade ? 'blade' : 'shaft'] = [gap, tag(u)];
        const tg = thwartGap(p) - 0.018;
        if (tg < W.thwart[0]) W.thwart = [tg, tag(u)];
        if (p[1] < 0.06 && overFloor(p) && W.floor.length < 3) W.floor.push(tag(u));
      }
      // the hand low on the shaft can reach it (closest point to his shoulder, 0.16 … 0.8 m down from the grip)
      const S = SH[P.top === 'r' ? 'l' : 'r'], rel = S.map((v, j) => v - P.G[j]);
      const tt = Math.max(0.16, Math.min(0.8, rel[0] * d[0] + rel[1] * d[1] + rel[2] * d[2]));
      const reach = Math.hypot(...rel.map((v, j) => v - d[j] * tt));
      if (reach > W.reach[0]) W.reach = [reach, tag(u)];
      // the hands change over only with the paddle raised (shaft steeply up: blade high, T-grip at his chest)
      if (prev && prev.top !== P.top && d[1] < W.swap[0]) W.swap = [d[1], tag(u)];
      // continuous (the next stroke's u = 0 follows on from u → 1): no snap — the fastest swing, mid-recovery as the
      // paddle is flicked up from the exit, moves the tip 15 cm per 1/400 of the cycle; a snap was 1.8 m
      const tip = G.map((v, j) => v + d[j] * PADDLE.length);
      if (prev) { const j = Math.hypot(...tip.map((v, k2) => v - prev.tip[k2])); if (j > W.jump[0]) W.jump = [j, tag(u)]; }
      prev = { top: P.top, tip };
    }
  }
  assert.ok(W.shaft[0] > 0.05, `the shaft clear of the tubes by ${(W.shaft[0] * 100).toFixed(1)} cm at the closest (${W.shaft[1]})`);
  assert.ok(W.blade[0] > 0.03, `…the blade by ${(W.blade[0] * 100).toFixed(1)} cm (${W.blade[1]})`);
  assert.ok(W.thwart[0] > 0.1, `…the thwart by ${(W.thwart[0] * 100).toFixed(1)} cm (${W.thwart[1]})`);
  assert.ok(!W.floor.length, `…never down through the floor (${W.floor.join('; ')})`);
  assert.ok(W.reach[0] < REACH, `the lower fist's spot on the shaft within ${W.reach[0].toFixed(2)} m of his shoulder (${W.reach[1]})`);
  assert.ok(W.swap[0] > 0.8, `the hands change over with the paddle raised (shaft direction y ${W.swap[0].toFixed(2)}, ${W.swap[1]})`);
  assert.ok(W.jump[0] < 0.2, `no snap: the blade tip moves ≤ ${(W.jump[0] * 100).toFixed(1)} cm per 1/${N} of the stroke (${W.jump[1]})`);
  // between rest and stroke: raised upright through the middle of the blend, both ways, on either side
  for (const s of [1, -1]) for (const u of [0, 0.3, 0.6, 0.85]) {
    const mid = paddlePose(u, s, false, 0.5);
    assert.deepEqual([mid.G, mid.T], [UPRIGHT.G, UPRIGHT.T], `half way between the hold and the stroke (u ${u}, s ${s}): upright before him`);
  }
  assert.ok(Math.abs(SWITCH_U - 0.82) < 0.05 && paddlePose(SWITCH_U - 0.001, 1, false, 1).top === 'r' && paddlePose(SWITCH_U + 0.001, 1, false, 1).top === 'l', 'the change-over in the recovery');
  // continuous in the blend weight too (start / stop at any phase): ≤ 13 cm per 1/200 of the blend (the straight blend
  // flipped the blade through the boat at 50 cm a step)
  for (const s of [1, -1]) for (let ui = 0; ui < 50; ui++) {
    let prev = null;
    for (let ai = 0; ai <= 200; ai++) {
      const { G, d } = line(paddlePose(ui / 50, s, false, ai / 200)), tip = G.map((v, j) => v + d[j] * PADDLE.length);
      if (prev) assert.ok(Math.hypot(...tip.map((v, j) => v - prev[j])) < 0.2, `blend snaps at act ${ai / 200} (u ${ui / 50}, s ${s})`);
      prev = tip;
    }
  }
  assert.deepEqual(paddlePose(0.4, -1, false, 0).G, HOLD.G, 'at rest: the hold');
});
