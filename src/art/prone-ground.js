/**
 * Prone bodies on real terrain (docs/crawl-animation.md §4.6 / §6): runs after the character's mixer every frame while
 * a prone clip plays.
 *  - slope: the whole body pitches / rolls to the ground under the chest, hips, feet and both sides (world.groundY)
 *  - contacts: each elbow is re-aimed (upper arm about the shoulder, the forearm keeps its world rotation) and each
 *    ankle moved (two-bone IK, knee plane kept) by the local relief under it, so forearms and legs neither float over
 *    a dip nor sink into a bump
 *  - turning: a prone man cannot pivot on the spot; the displayed heading follows the sim heading at <= 75 deg/s
 *    (112 deg/s while crawling), pivoting about the chest, and `turnDir` tells the caller to play prone_turn_l / _r
 * Pure view-side: the sim position / heading are untouched. Bones the mixer did not rewrite this frame (static clips)
 * are restored first, so corrections never accumulate.
 * @module art/prone-ground
 */
import { Vector3, Quaternion, Euler, MathUtils } from 'three';

export const PRONE_CLIP = /^(crawl|prone_|die_prone$|dead_prone$)/;
const TURN = MathUtils.degToRad(75), PIVOT = 0.3, MAX_TILT = MathUtils.degToRad(24);
const _up = new Vector3(0, 1, 0), _v = new Vector3(), _a = new Vector3(), _b = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ');
const LIMB = ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];

function rotKeep(b, q, keep) {
  const saved = keep.map((k) => k.getWorldQuaternion(new Quaternion()));
  const pq = b.parent.getWorldQuaternion(_q2);
  b.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq)); b.updateMatrixWorld(true);
  keep.forEach((k, i) => { k.quaternion.copy(k.parent.getWorldQuaternion(_q2).invert().multiply(saved[i])); k.updateMatrixWorld(true); });
}
function elbowBy(B, s, dy) {
  const S = B['upperarm_' + s].getWorldPosition(_a), E = B['lowerarm_' + s].getWorldPosition(_b);
  const d0 = E.clone().sub(S).normalize(), d1 = E.clone().add(_v.set(0, dy, 0)).sub(S).normalize();
  rotKeep(B['upperarm_' + s], _q.setFromUnitVectors(d0, d1), [B['lowerarm_' + s]]);
}
function ankleBy(B, s, dy) {
  const a = B['thigh_' + s], b = B['calf_' + s], c = B['foot_' + s];
  const pa = a.getWorldPosition(new Vector3()), pb = b.getWorldPosition(new Vector3()), pc = c.getWorldPosition(new Vector3());
  const t = pc.clone().add(_v.set(0, dy, 0)), l1 = pb.distanceTo(pa), l2 = pc.distanceTo(pb);
  const D = MathUtils.clamp(t.distanceTo(pa), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const n = pb.clone().sub(pa).cross(pc.clone().sub(pb)); if (n.lengthSq() < 1e-10) return; n.normalize();
  const u = t.clone().sub(pa).normalize(), cosA = (l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const k0 = pb.clone().sub(pa); k0.addScaledVector(u, -k0.dot(u));
  const side = new Vector3().crossVectors(n, u).normalize(); if (side.dot(k0) < 0) side.negate();
  const knee = pa.clone().addScaledVector(u, l1 * cosA).addScaledVector(side, l1 * sinA);
  rotKeep(a, _q.setFromUnitVectors(pb.clone().sub(pa).normalize(), knee.sub(pa).normalize()), [c]);
  const pb2 = b.getWorldPosition(new Vector3()), pc2 = c.getWorldPosition(new Vector3());
  rotKeep(b, _q.setFromUnitVectors(pc2.sub(pb2).normalize(), t.sub(pb2).normalize()), [c]);
}

/**
 * Per-frame prone grounding / turning for one UnitModel. Call after the mixer stepped.
 * @param {object} st persistent state object of the model
 * @param {{root:object, body:object, bones:object, groundY:(x:number,z:number)=>number, prone:boolean, dt:number, moving:boolean}} o
 * @returns {{turnDir:number, active:boolean}}
 */
export function proneGround(st, o) {
  const { root, body, bones: B } = o;
  const yaw = root.rotation.y;
  // restore bones the mixer left untouched since our last write (static prone clips: dead_prone, idle holds)
  if (st.mem) for (const n of LIMB) { const m = st.mem[n], b = B[n]; if (m && b && b.quaternion.equals(m.post)) b.quaternion.copy(m.pre); }
  st.mem = null;
  if (st.visYaw == null || !o.prone) st.visYaw = yaw;
  let turnDir = 0;
  if (o.prone && o.dt > 0) {
    let d = yaw - st.visYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const rate = TURN * (o.moving ? 1.5 : 1) * o.dt;
    st.visYaw += MathUtils.clamp(d, -rate, rate);
    turnDir = Math.abs(d) > 0.12 ? Math.sign(d) : 0;
  }
  const off = o.prone ? Math.atan2(Math.sin(st.visYaw - yaw), Math.cos(st.visYaw - yaw)) : 0;
  // slope under the body (in the displayed heading's frame)
  let pitch = 0, roll = 0;
  if (o.prone && o.groundY) {
    const h = st.visYaw, fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const p = root.position, g = (a, l) => o.groundY(p.x + fx * a + lx * l, p.z + fz * a + lz * l);
    const gc = g(0.45, 0), gf = g(-0.85, 0), gl = g(0, 0.3), gr = g(0, -0.3);
    pitch = MathUtils.clamp(-Math.atan2(gc - gf, 1.3), -MAX_TILT, MAX_TILT);   // head end up = negative x rotation
    roll = MathUtils.clamp(Math.atan2(gl - gr, 0.6), -MAX_TILT, MAX_TILT);
  }
  const k = o.dt > 0 ? Math.min(1, o.dt * 8) : 1;
  st.pitch = st.pitch == null ? pitch : st.pitch + (pitch - st.pitch) * k;
  st.roll = st.roll == null ? roll : st.roll + (roll - st.roll) * k;
  const active = o.prone || Math.abs(st.pitch) > 1e-4 || Math.abs(st.roll) > 1e-4;
  if (!o.prone) { st.pitch *= 1 - k; st.roll *= 1 - k; }
  _e.set(st.pitch, off, st.roll, 'YXZ');   // roll > 0: his left side up (ground higher on the left)
  body.quaternion.setFromEuler(_e);
  // the slope tilt turns the body about the unit origin on the ground (so its ground plane is the fitted plane through
  // the unit, which the relief pass below uses); only the lagging heading pivots about the chest (PIVOT m ahead):
  // body.position = pivot - Ryaw * pivot. (Pivoting the tilt about the chest too sank the body 0.3 * tan(slope)
  // into an uphill slope - review: elbows 1-5 cm, knees 2 cm on the M1 drift.)
  _v.set(0, 0, PIVOT).applyAxisAngle(_up, off); body.position.set(0, 0, PIVOT).sub(_v);
  if (!o.prone || !o.groundY) return { turnDir, active };
  // local relief under each elbow / ankle vs the fitted plane
  root.updateMatrixWorld(true);
  const mem = {}; for (const n of LIMB) if (B[n]) mem[n] = { pre: B[n].quaternion.clone(), post: null };
  const base = root.position.y, plane = (w) => {
    const dx = w.x - root.position.x, dz = w.z - root.position.z, h = st.visYaw;
    const along = dx * Math.sin(h) + dz * Math.cos(h), lat = dx * Math.cos(h) - dz * Math.sin(h);
    return base + along * Math.tan(-st.pitch) + lat * Math.tan(st.roll);
  };
  for (const s of ['l', 'r']) {
    if (B['lowerarm_' + s]) { const e = B['lowerarm_' + s].getWorldPosition(_b); const dy = MathUtils.clamp(o.groundY(e.x, e.z) - plane(e), -0.08, 0.08); if (Math.abs(dy) > 0.008) elbowBy(B, s, dy); }
    if (B['foot_' + s]) { const f = B['foot_' + s].getWorldPosition(_b); const dy = MathUtils.clamp(o.groundY(f.x, f.z) - plane(f), -0.08, 0.1); if (Math.abs(dy) > 0.008) ankleBy(B, s, dy); }
  }
  for (const n of LIMB) if (mem[n]) mem[n].post = B[n].quaternion.clone();
  st.mem = mem;
  return { turnDir, active };
}
