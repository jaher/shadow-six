/**
 * Natural climbing (user 2026-10-22: "Make sure the ladder climbing looks natural, commando not crossing the ladder /
 * wall"), the pure parts:
 *  - art/wall-climb.js planClimb: a Green Beret climb link measured on the drawn faces (synthetic scenes): up onto a
 *    deck (the face where it is drawn, not where the link's end stands; a link crossing it aslant climbs it square),
 *    over a palisade standing above its walk (its inner face found), down from a deck, over a wall with a drop on both
 *    sides (two faces, his back to the drop going down), nothing steep (no pose);
 *  - art/ladder-climb.js: the leapfrog ends both feet on the top rung before a vault; a link end in the ladder's way /
 *    against the wall's inner face is drawn clear of it, eased out with the distance (ladderEndShift).
 */
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { planClimb, holdO, FACE } from '../../src/art/wall-climb.js';
import { collectParts, local } from '../../src/art/ladder-frame.js';
import { ladderSchedule, footLevel, endShift, ladderEndShift, vaults, LADDER } from '../../src/art/ladder-climb.js';

/** A scene of boxes [cx, cy, cz, sx, sy, sz, yawDeg] and its static parts in a box round the origin. */
function scene(boxes) {
  const s = new THREE.Scene();
  for (const [cx, cy, cz, sx, sy, sz, yaw = 0] of boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial());
    m.position.set(cx, cy, cz); m.rotation.y = (yaw * Math.PI) / 180; s.add(m);
  }
  s.updateMatrixWorld(true);
  return collectParts(s, new THREE.Box3(new THREE.Vector3(-12, -1, -12), new THREE.Vector3(12, 12, 12)), new Set());
}
/** A walk grid stand-in: walkable ground everywhere at `ground(x, z)`. */
const grid = (ground = () => 0) => ({ walkableAt: () => true, elevAt: (x, z) => ground(x, z) });
const link = (a, b) => ({ id: 1, kind: 'climb', a: { x: a[0], z: a[1], y: a[2] }, b: { x: b[0], z: b[1], y: b[2] } });

test('wall climb: up onto a deck — the face where it is drawn (1.2 m past the link end), a hold line just off it', () => {
  // a wall walk 2.2 m high from z 5 to 7, the link from the ground at z 3.8 to its top at z 6
  const parts = scene([[0, 1.1, 6, 10, 2.2, 2]]);
  const P = planClimb(link([0, 3.8, 0], [0, 6, 2.2]), 'ab', parts, grid((x, z) => (z >= 5 && z <= 7 ? 2.2 : 0)));
  assert.equal(P.kind, 'up');
  assert.equal(P.segs.length, 1);
  const { F, T } = P.segs[0];
  assert.ok(T.up && F.face, 'a ladder leg up a face');
  near(F.fz, 1, 0.02, 'facing the wall'); near(F.s0, 1.2 - FACE.holdOff, 0.03, 'hold line just off the drawn face');
  near(F.H, 2.2, 1e-6); near(F.over, 2.2, 0.05, 'no wall over the deck');
  assert.ok(F.rungs.length >= 6 && F.rungs.every((v, i) => !i || Math.abs(v - F.rungs[i - 1] - FACE.sp) < 1e-3), 'holds every 0.3 m');
  near(holdO(F, 0.9, 0.12), 0, 0.01, 'a flat face: the holds on the line');
});

test('wall climb: a link crossing the face aslant climbs it square to the face', () => {
  // the same wall turned 40° about the y axis through the origin's line
  const parts = scene([[0, 1.1, 6, 10, 2.2, 2, 40]]);
  const P = planClimb(link([-1.2, 3.2, 0], [0, 6.5, 2.2]), 'ab', parts, grid());
  assert.equal(P.kind, 'up');
  const { F } = P.segs[0];
  // the face's normal (into the wall): the box's local +z turned 40° → (sin 40°, cos 40°)
  const n = [Math.sin((40 * Math.PI) / 180), Math.cos((40 * Math.PI) / 180)];
  assert.ok(F.fx * n[0] + F.fz * n[1] > 0.99, `square to the face (f ${F.fx.toFixed(3)}, ${F.fz.toFixed(3)})`);
});

test('wall climb: over a palisade standing over its walk — one face, the wall top over the deck, its inner face', () => {
  // stakes 0.25 m thick 3.4 m high (z 5 to 5.25), the walk behind them 2.2 m high (z 5.25 to 7.25)
  const parts = scene([[0, 1.7, 5.125, 10, 3.4, 0.25], [0, 1.1, 6.25, 10, 2.2, 2]]);
  const P = planClimb(link([0, 3.8, 0], [0, 6.2, 2.2]), 'ab', parts, grid((x, z) => (z >= 5.25 ? 2.2 : 0)));
  assert.equal(P.kind, 'up');
  const { F } = P.segs[0];
  near(F.over, 3.4, 0.05, 'over the stakes'); near(F.H, 2.2, 1e-6);
  assert.ok(vaults(F), 'a wall 1.2 m over the deck is vaulted, not stepped over');
  assert.ok(F.inner != null, 'its inner face measured');
  // inner face at z 5.25: o of that point at the deck's height
  near(F.inner, local(F, { x: 0, y: 2.2, z: 5.25 }).o, 0.03, 'the inner face');
  // and the way back down: the same face, going down
  const D = planClimb(link([0, 3.8, 0], [0, 6.2, 2.2]), 'ba', parts, grid((x, z) => (z >= 5.25 ? 2.2 : 0)));
  assert.equal(D.kind, 'down');
  assert.ok(!D.segs[0].T.up, 'climbed down');
  near(D.segs[0].F.fz, 1, 0.02, 'facing the wall (his back to the drop)');
});

test('wall climb: down from a deck, over a wall with a drop both sides, nothing steep', () => {
  // a 4 m bluff from z 5 on: down from its top (z 6) to the ground in front (z 3)
  const bluff = scene([[0, 2, 10, 20, 4, 10]]);
  const D = planClimb(link([0, 6, 4], [0, 3, 0]), 'ab', bluff, grid((x, z) => (z >= 5 ? 4 : 0)));
  assert.equal(D.kind, 'down');
  near(D.segs[0].F.fz, 1, 0.02, 'facing the bluff going down');
  near(D.segs[0].F.H, 4, 1e-6);
  // a 2.4 m wall 0.6 m thick (z 5 to 5.6) with ground on both sides: up one face, down the other
  const wall = scene([[0, 1.2, 5.3, 10, 2.4, 0.6]]);
  const O = planClimb(link([0, 3.6, 0], [0, 7.2, 0]), 'ab', wall, grid());
  assert.equal(O.kind, 'over');
  assert.equal(O.segs.length, 2);
  assert.ok(O.segs[0].T.up && !O.segs[1].T.up, 'up the near face, down the far one');
  near(O.segs[0].F.fz, 1, 0.02); near(O.segs[1].F.fz, -1, 0.02, 'the far face faced from its own side');
  near(O.segs[0].F.top.z, O.segs[1].F.top.z, 1e-6, 'both meet on the wall top');
  // a power line strung 6.6 m up over the wall is no part of it (M1: the profile from above found it)
  const wired = scene([[0, 1.2, 5.3, 10, 2.4, 0.6], [0, 6.6, 5.3, 10, 0.03, 0.03]]);
  const Ow = planClimb(link([0, 3.6, 0], [0, 7.2, 0]), 'ab', wired, grid());
  assert.equal(Ow.kind, 'over');
  near(Ow.H, 2.4, 0.08, 'the wall top, not the wire');
  // flat: no wall between the ends
  assert.equal(planClimb(link([0, 3, 0], [0, 7, 0]), 'ab', scene([[8, 1, 8, 1, 2, 1]]), grid()).kind, 'flat');
});

test('ladder: before a vault the leapfrog brings both feet onto the top rung', () => {
  for (const n of [5, 6, 9, 10]) {
    const sch = ladderSchedule(n, n);
    const a = footLevel(sch.q1, 'A', sch.D), b = footLevel(sch.q1, 'B', sch.D);
    assert.equal(a.b, n, `n ${n}: right foot on the top rung`); assert.equal(b.b, n, `n ${n}: left foot on the top rung`);
    // and never a level past it on the way
    for (let q = sch.q0; q <= sch.q1; q += 0.05) assert.ok(footLevel(q, 'A', sch.D).b <= n && footLevel(q, 'B', sch.D).b <= n);
  }
  // a plain ladder still ends on the deck
  const s = ladderSchedule(8);
  assert.equal(footLevel(s.q1, 'A', s.D).b, 9); assert.equal(footLevel(s.q1, 'B', s.D).b, 9);
});

/** A plumb ladder frame (ladder-frame.js coordinates) facing +z: foot end at z 0, rung line at z s0. */
function frame({ s0 = 0.5, top = [0, 1.2, 3], inner = null, over = 3 } = {}) {
  const k = 0, n = 1;
  return { foot: { x: 0, y: 0, z: 0 }, top: { x: top[0], y: 3, z: top[1] }, fx: 0, fz: 1, lx: 1, lz: 0, H: 3, hd: 1.2, s0, k, c: 0, rr: 0.02,
    halfW: 0.23, over, rungs: [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7], ax: { f: 0, y: 1 }, ox: { f: -1 / n, y: 0 }, footO: s0, topO: s0 - 1.2, inner };
}

test('ladder: a foot end behind the rungs (against the wall) is drawn out in front of them; one in front is left', () => {
  const behind = frame({ s0: -0.33 }), front = frame({ s0: 0.6 });
  const sh = endShift(behind, 'foot');
  assert.ok(sh, 'shifted');
  near(sh.x, 0, 1e-6, 'straight out'); assert.ok(sh.z < -0.75 && sh.z > -0.95, `out of the ladder's way (${sh.z.toFixed(2)} m)`);
  assert.equal(endShift(front, 'foot'), null, 'a foot end in front of the ladder stays');
  // the shift eases out with the distance from the end, for anyone standing there
  const world = { ladderFrames: new Map([[1, behind]]) };
  const at0 = ladderEndShift(world, 0, 0, 0), far = ladderEndShift(world, 0, 0, -LADDER.endR - 0.1), mid = ladderEndShift(world, 0.6, 0, 0);
  near(at0.z, sh.z, 1e-9); assert.equal(far, null);
  assert.ok(mid && Math.abs(mid.z) < Math.abs(sh.z) && Math.abs(mid.z) > 0, 'eased');
  assert.equal(ladderEndShift(world, 0, 2.5, 0), null, 'not a man on the deck above');
});

test('ladder: a top end against the inner face of the wall over the deck is drawn off it onto the deck', () => {
  // the wall's inner face 0.4 m behind the rung line; the top end only 0.3 m behind it (inside the stakes)
  const F = frame({ s0: 0, top: [0, 0.3], inner: -0.4, over: 4.2 });
  F.topO = -0.3;
  const sh = endShift(F, 'top');
  assert.ok(sh && sh.z > 0, 'onto the deck');
  near(0.3 + sh.z, 0.4 + LADDER.endIn, 1e-6, `${LADDER.endIn} m clear of the inner face (a stride: he turns and walks off there)`);
  assert.equal(endShift(frame({ s0: 0, top: [0, 1.5], inner: -0.4 }), 'top'), null, 'a top end well on the deck stays');
});
