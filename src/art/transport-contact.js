/**
 * Contact and secondary motion of body transport (docs/bodies-design.md §C.2, §C.3, §C.10). Visual only.
 *
 *   carrierContact(cm, lm, st, guard)  the transporter's hands on the load by two-bone IK (elbows bent out and down):
 *                                      a fireman's carry wraps the right arm round the thighs and holds the knees with
 *                                      the left hand; a drag hooks both hands under the armpits. Weighted in and out
 *                                      over each transition so the hands reach, take and let go in step with the clip.
 *   loadSway(lm, st, dt, guard)        the load's limp parts (head, arms, legs over a shoulder) swing with the
 *                                      transporter's gait: a damped pendulum driven by the pelvis acceleration and
 *                                      the vertical bob of each step.
 * @module art/transport-contact
 */
import { Vector3, Quaternion } from 'three';
import { twoBoneIKPole } from './characters/commandos_a/ca_ik.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ramp = (k, a, b) => { const x = clamp((k - a) / Math.max(1e-6, b - a), 0, 1); return x * x * (3 - 2 * x); };
const sock = (m, n) => m?.real?.getSocket?.(n) || null;
const _a = new Vector3(), _b = new Vector3(), _t = new Vector3(), _pole = new Vector3(), _f = new Vector3(), _l = new Vector3();
const _q = new Quaternion();

/** Weights {legs, arms} of the two holds for a phase (0..1 each). */
export function contactWeights(st) {
  const k = st.k;
  switch (st.kind) {
    case 'hold': return st.from === 'shoulder' ? { legs: 1, arms: 0 } : { legs: 0, arms: 1 };
    case 'lift': return { legs: ramp(k, 0.3, 0.45) * ramp(k, 0.45, 0.8) + 0, arms: 0, reach: ramp(k, 0.2, 0.4) * (1 - ramp(k, 0.45, 0.8)) };
    case 'grab': return { legs: 0, arms: ramp(k, 0.35, 0.6) };
    case 'toShoulder': return { legs: ramp(k, 0.55, 0.9), arms: 1 - ramp(k, 0.4, 0.7) };
    case 'toDrag': return { legs: 1 - ramp(k, 0.2, 0.45), arms: ramp(k, 0.5, 0.85) };
    case 'putDown': return { legs: 1 - ramp(k, 0.55, 0.85), arms: 0 };
    case 'release': return { legs: 0, arms: 1 - ramp(k, 0.55, 0.9) };
    default: return { legs: 0, arms: 0 };
  }
}

/** IK one arm of the carrier to `target` with weight w (slerp from the animated pose). */
function reachArm(cm, s, target, pole, w, guard) {
  const ua = sock(cm, 'upperarm_' + s), la = sock(cm, 'lowerarm_' + s), h = sock(cm, 'hand_' + s);
  if (!ua || !la || !h || w <= 1e-3) return false;
  guard?.touch(ua); guard?.touch(la); guard?.touch(h);
  const q0 = ua.quaternion.clone(), q1 = la.quaternion.clone(), q2 = h.quaternion.clone();
  twoBoneIKPole(ua, la, h, target, pole);
  if (w < 1) { ua.quaternion.copy(q0.slerp(ua.quaternion, w)); la.quaternion.copy(q1.slerp(la.quaternion, w)); h.quaternion.copy(q2.slerp(h.quaternion, w)); }
  ua.updateMatrixWorld(true);
  return true;
}

/**
 * Put the carrier's hands on the load for phase `st`. @returns {boolean} changed the carrier's pose
 */
export function carrierContact(cm, lm, st, guard = null) {
  const W = contactWeights(st);
  if (!(W.legs > 1e-3 || W.arms > 1e-3 || W.reach > 1e-3)) return false;
  const root = cm.root;
  root.updateMatrixWorld(true);
  _f.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(_q)).setY(0).normalize(); // his forward
  _l.set(1, 0, 0).applyQuaternion(_q).setY(0).normalize(); // his left
  let did = false;
  if (W.legs > 1e-3) {
    // fireman's carry: the right forearm over the backs of the thighs, the left hand on the knees
    const tr = sock(lm, 'thigh_r'), tl = sock(lm, 'thigh_l'), cr = sock(lm, 'calf_r'), cl = sock(lm, 'calf_l');
    if (tr && tl && cr && cl) {
      tr.getWorldPosition(_a); tl.getWorldPosition(_b); _a.lerp(_b, 0.5); // hips
      cr.getWorldPosition(_t); cl.getWorldPosition(_b); _t.lerp(_b, 0.5); // knees
      const thigh = _b.copy(_a).lerp(_t, 0.55).addScaledVector(_f, 0.07);
      _pole.copy(thigh).addScaledVector(_l, -0.45).addScaledVector(_f, -0.1).y -= 0.35;
      did = reachArm(cm, 'r', thigh, _pole, W.legs, guard) || did;
      _t.addScaledVector(_f, 0.06).addScaledVector(_l, 0.02);
      _pole.copy(_t).addScaledVector(_l, 0.45).y -= 0.4;
      did = reachArm(cm, 'l', _t.clone(), _pole.clone(), W.legs, guard) || did;
    }
  }
  if (W.arms > 1e-3 || W.reach > 1e-3) {
    // drag: both hands hooked under the armpits (the upper arm roots of the load); the lift reaches for the waist
    for (const s of ['l', 'r']) {
      const up = sock(lm, W.reach > W.arms ? (s === 'l' ? 'thigh_l' : 'spine_01') : 'upperarm_' + s);
      if (!up) continue;
      up.getWorldPosition(_t);
      if (W.reach <= W.arms) _t.y -= 0.03;
      const side = s === 'l' ? 1 : -1;
      _pole.copy(_t).addScaledVector(_l, 0.5 * side).addScaledVector(_f, -0.15).y -= 0.45;
      did = reachArm(cm, s, _t.clone(), _pole.clone(), Math.max(W.arms, W.reach || 0), guard) || did;
    }
  }
  return did;
}

// ------------------------------------------------------------------ secondary motion

/** Bones swung by the pendulum and their gains, per hold. */
const SWAY = {
  shoulder: [['neck_01', 0.5, 0.6], ['head', 0.7, 0.8], ['upperarm_l', 1, 0.5], ['upperarm_r', 1, 0.5], ['lowerarm_l', 0.4, 0.3],
    ['lowerarm_r', 0.4, 0.3], ['calf_l', 0.35, 0.25], ['calf_r', 0.35, 0.25]],
  drag: [['neck_01', 0.4, 0.8], ['head', 0.6, 1], ['upperarm_l', 0.3, 0.2], ['upperarm_r', 0.3, 0.2]],
};
const _v = new Vector3(), _acc = new Vector3(), _ax = new Vector3(), _pq = new Quaternion(), _rq = new Quaternion();

/**
 * Limp secondary motion of a transported man. A 2-D pendulum (world tilt about the horizontal axes) and a vertical
 * bounce spring, driven by his pelvis acceleration, add world rotations to his head, arms and dangling legs.
 */
export function loadSway(lm, st, dt, guard = null) {
  const pel = sock(lm, 'pelvis');
  if (!pel || !(dt > 0)) return false;
  const S = lm._sway || (lm._sway = { p: null, v: new Vector3(), tx: 0, tz: 0, wx: 0, wz: 0, b: 0, wb: 0 });
  pel.getWorldPosition(_v);
  if (!S.p) { S.p = _v.clone(); return false; }
  const vx = (_v.x - S.p.x) / dt, vy = (_v.y - S.p.y) / dt, vz = (_v.z - S.p.z) / dt;
  S.p.copy(_v);
  // a teleport (load, a new transport) resets the springs
  if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) > 12) { S.v.set(0, 0, 0); S.tx = S.tz = S.wx = S.wz = S.b = S.wb = 0; return false; }
  _acc.set((vx - S.v.x) / dt, (vy - S.v.y) / dt, (vz - S.v.z) / dt).clampLength(0, 25);
  S.v.set(vx, vy, vz);
  const om = 7.5, ze = 0.22, h = Math.min(dt, 1 / 30);
  // pendulum: the limbs lag the acceleration (tilt towards -a), bounce with the vertical bob of the steps
  S.wx += (-om * om * S.tx - 2 * ze * om * S.wx - _acc.x * 0.9) * h; S.tx += S.wx * h;
  S.wz += (-om * om * S.tz - 2 * ze * om * S.wz - _acc.z * 0.9) * h; S.tz += S.wz * h;
  S.wb += (-om * om * S.b - 2 * ze * om * S.wb - _acc.y * 0.9) * h; S.b += S.wb * h;
  S.tx = clamp(S.tx, -0.35, 0.35); S.tz = clamp(S.tz, -0.35, 0.35); S.b = clamp(S.b, -0.3, 0.3);
  const mode = st.to === 'drag' || (st.kind === 'hold' && st.from === 'drag') ? 'drag' : st.to === 'lie' || st.from === 'lie' ? null : 'shoulder';
  if (!mode) return false;
  const amt = st.kind === 'hold' ? 1 : ramp(st.k, 0.6, 1);
  if (amt <= 0) return false;
  const tilt = Math.hypot(S.tx, S.tz);
  const body = lm._body();
  _f.set(0, 0, 1).applyQuaternion(body.getWorldQuaternion(_q)); // his (the load's) forward: the nod axis is his left
  _l.set(1, 0, 0).applyQuaternion(_q);
  for (const [n, gT, gB] of SWAY[mode]) {
    const b = sock(lm, n);
    if (!b) continue;
    guard?.touch(b);
    b.parent.getWorldQuaternion(_pq);
    let did = false;
    if (tilt > 1e-4) { // world rotation that swings a hanging part towards (tx, 0, tz)
      _ax.set(S.tz, 0, -S.tx).normalize();
      _q.setFromAxisAngle(_ax, tilt * gT * amt);
      _rq.copy(_pq).invert().multiply(_q).multiply(_pq);
      b.quaternion.premultiply(_rq); did = true;
    }
    if (Math.abs(S.b) > 1e-4) {
      _q.setFromAxisAngle(_l, S.b * gB * amt);
      _rq.copy(_pq).invert().multiply(_q).multiply(_pq);
      b.quaternion.premultiply(_rq); did = true;
    }
    if (did) b.updateMatrixWorld(true);
  }
  return true;
}
