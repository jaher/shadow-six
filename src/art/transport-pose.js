/**
 * How a transported man is drawn (docs/bodies-design.md §C.2, §C.3, §C.10). Visual only: the gameplay position stays
 * the kinematic one of Commando._placeDragged / _updateCarried.
 *
 * Every transition (lift, grab, drag ⇄ shoulder, put down, release) is a PAIRED CLIP: the transporter plays his clip
 * (art/body-clips.js) and the load follows a root track authored in the transporter's frame, sharing its timing:
 * keyed pelvis positions (x = his left, y = up, z = forward, metres from his feet) and body orientations (Euler
 * degrees, order YXZ, in his frame), plus the load's skeleton pose as a weighted blend of static poses (the pose he
 * had when the hands took him, 'dead', 'carried', 'being_dragged'). End keys are live placements measured on the
 * transporter's sockets (the pelvis on his right trapezius; the chest at his hands), so a transition always lands
 * exactly on the hold that follows. Positions follow a Catmull-Rom curve through the keys; orientations slerp key to
 * key, so the body is never flipped through an upside-down in-between.
 *
 *   transportState(u)             pure: {carrier, kind, from, to, k, spot?} while u is lifted / carried / put down
 *   transportClip(st)             the load's mixer clip for a phase
 *   TRACKS                        the authored keys per transition kind (tests may inspect them)
 * @module art/transport-pose
 */
import { Vector3, Quaternion, Euler } from 'three';
import { clipPose, capturePose, writePose } from './pose-blend.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (k) => { const x = clamp(k, 0, 1); return x * x * (3 - 2 * x); };

/**
 * Transport phase of `u` (pure).
 * @returns {{carrier:object, kind:string, from:string, to:string, k:number, spot?:{x:number,z:number}, yaw?:number}|null}
 *   kind: 'lift' | 'grab' | 'toShoulder' | 'toDrag' | 'putDown' | 'release' | 'hold'
 */
export function transportState(u) {
  if (!u) return null;
  if (u.state === 'carried' && u.carriedBy) {
    const c = u.carriedBy, mode = c.carryMode === 'drag' ? 'drag' : 'shoulder', tr = c.carryTransition;
    if (tr && tr.dur > 0) {
      const k = clamp(tr.t / tr.dur, 0, 1);
      if (tr.kind === 'toShoulder') return { carrier: c, kind: 'toShoulder', from: 'drag', to: 'shoulder', k };
      if (tr.kind === 'toDrag') return { carrier: c, kind: 'toDrag', from: 'shoulder', to: 'drag', k };
      if (tr.kind === 'putDown') {
        const spot = tr.spot || (mode === 'drag' ? { x: u.x, z: u.z } : { x: c.x + Math.cos(c.heading) * 0.6, z: c.z + Math.sin(c.heading) * 0.6 });
        return { carrier: c, kind: mode === 'drag' ? 'release' : 'putDown', from: mode, to: 'lie', k, spot };
      }
    }
    return { carrier: c, kind: 'hold', from: mode, to: mode, k: 1 };
  }
  const L = u.pendingLift;
  if (L && L.by && L.dur > 0 && u.state !== 'carried') {
    const k = clamp(L.t / L.dur, 0, 1);
    return { carrier: L.by, kind: L.mode === 'drag' ? 'grab' : 'lift', from: 'lie', to: L.mode === 'drag' ? 'drag' : 'shoulder', k };
  }
  return null;
}

/** Mixer clip of the load for a phase: the target hold once past halfway ('shoulder' → carried, 'drag' → being_dragged). */
export function transportClip(st) {
  const p = st.k >= 0.5 ? st.to : st.from;
  return p === 'shoulder' ? 'shoulder' : p === 'drag' ? 'drag' : null;
}

/**
 * Authored paired tracks. `at`: 'from' | 'to' (live placements) or {p:[x, y, z] pelvis in the transporter's frame,
 * e:[x, y, z] degrees}; `pose`: weights of cap (the pose when the hands took him), dead, carried, dragged.
 * Timings match the transporter's clips in art/body-clips.js.
 */
export const TRACKS = {
  // squat at his hips, pull him round and in, haul him upright against the chest, tip him over the right shoulder
  // (belly on the shoulder, head down the back, legs in front), stand (1.0 s)
  lift: [
    { k: 0, at: 'from', pose: { cap: 1 } },
    { k: 0.18, at: 'from', pose: { cap: 1 } },
    { k: 0.4, at: { p: [0, 0.14, 0.55], e: [0, 90, 0], near: [90, -90] }, pose: { dead: 1 } },
    { k: 0.64, at: { p: [-0.1, 0.78, 0.36], e: [85, 180, 0] }, pose: { dead: 0.25, idle: 0.4, carried: 0.35, arms: 3 } },
    { k: 1, at: 'to', pose: { carried: 1 } },
  ],
  // kneel at his head, hook the armpits, haul the torso up (1.0 s)
  grab: [
    { k: 0, at: 'from', pose: { cap: 1 } },
    { k: 0.3, at: 'from', pose: { cap: 1 } },
    { k: 0.62, at: { p: [0, 0.13, 0.95], e: [0, 0, 0] }, pose: { dead: 1 } },
    { k: 1, at: 'to', pose: { dragged: 1 } },
  ],
  // haul him upright by the armpits, turn him round to face me, tip him over the shoulder (1.0 s)
  toShoulder: [
    { k: 0, at: 'from', pose: { dragged: 1 } },
    { k: 0.3, at: { p: [0, 0.75, 0.42], e: [85, 0, 0] }, pose: { dragged: 0.4, dead: 0.6, arms: 1.5 } },
    { k: 0.48, at: { p: [-0.05, 0.8, 0.38], e: [85, 90, 0] }, pose: { dead: 0.3, idle: 0.5, carried: 0.2, arms: 3 } },
    { k: 0.64, at: { p: [-0.1, 0.82, 0.36], e: [85, 180, 0] }, pose: { dead: 0.25, idle: 0.4, carried: 0.35, arms: 3 } },
    { k: 1, at: 'to', pose: { carried: 1 } },
  ],
  // slide him off the shoulder upright in front of me, turn him round, lower him onto his back by the collar (0.8 s)
  toDrag: [
    { k: 0, at: 'from', pose: { carried: 1 } },
    { k: 0.34, at: { p: [-0.1, 0.82, 0.36], e: [85, 180, 0] }, pose: { dead: 0.25, idle: 0.4, carried: 0.35, arms: 3 } },
    { k: 0.5, at: { p: [-0.05, 0.8, 0.38], e: [85, 90, 0] }, pose: { dead: 0.3, idle: 0.5, dragged: 0.2, arms: 3 } },
    { k: 0.68, at: { p: [0, 0.72, 0.42], e: [85, 0, 0] }, pose: { dragged: 0.4, dead: 0.6, arms: 1.5 } },
    { k: 1, at: 'to', pose: { dragged: 1 } },
  ],
  // kneel, he slides off the shoulder upright in front of me and is laid down on his back (0.8 s)
  putDown: [
    { k: 0, at: 'from', pose: { carried: 1 } },
    { k: 0.4, at: { p: [-0.08, 0.75, 0.38], e: [85, 180, 0] }, pose: { carried: 0.35, idle: 0.4, dead: 0.25, arms: 3 } },
    { k: 0.8, at: 'to', pose: { dead: 1 } },
    { k: 1, at: 'to', pose: { dead: 1 } },
  ],
  // lower the shoulders to the ground and let go (0.6 s)
  release: [
    { k: 0, at: 'from', pose: { dragged: 1 } },
    { k: 0.8, at: 'to', pose: { dead: 1 } },
    { k: 1, at: 'to', pose: { dead: 1 } },
  ],
};

// ------------------------------------------------------------------ placements

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _p = new Vector3();
const _q = new Quaternion(), _qr = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ');
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0);
/** Hold tuning (visual; tests may tweak it): the dragged torso pitch, pelvis lift and chest reach; the shoulder tilt. */
export const DRAG_POSE = { pitch: (35 * Math.PI) / 180, lift: 0.14, reach: 0.5 };
export const CARRY_POSE = { tilt: -0.45, up: 0.1, neck: 0.35 };

function socket(real, n) { return real?.getSocket?.(n) || null; }

/** Body-local position of bone `n` for the pose currently on the skeleton (independent of the body placement). */
export function localOf(model, n, out) {
  const body = model._body(), b = socket(model.real, n);
  if (!b) return null;
  body.updateMatrixWorld(true);
  return body.worldToLocal(b.getWorldPosition(out));
}

/** Body-local rotation of bone `n` for the pose currently on the skeleton. */
export function localRot(model, n, out) {
  const body = model._body(), b = socket(model.real, n);
  if (!b) return null;
  body.updateMatrixWorld(true);
  return out.copy(body.getWorldQuaternion(_qe).invert()).multiply(b.getWorldQuaternion(_qe2));
}
const _qe = new Quaternion(), _qe2 = new Quaternion();

/**
 * World pelvis position + PELVIS orientation of a live end placement ('shoulder' | 'drag' | 'lie') into `o` ({p, q}).
 * Tracks interpolate the pelvis frame itself (not the body group), so a pose whose pelvis bone is turned round
 * (the 'carried' fold) never fights the root rotation mid-way.
 */
function endPlacement(model, st, place, o, rig) {
  const c = st.carrier, cm = c?.model, root = model.root;
  if (place === 'shoulder') {
    const ua = socket(cm?.real, 'upperarm_r'), nk = socket(cm?.real, 'neck_01') || socket(cm?.real, 'head');
    if (!ua || !nk || !cm?.root) return false;
    cm.root.getWorldQuaternion(_q);
    o.q.copy(_q).multiply(_qr.setFromAxisAngle(Y, Math.PI)).multiply(_qr.setFromAxisAngle(X, CARRY_POSE.tilt));
    ua.getWorldPosition(o.p); nk.getWorldPosition(_a); o.p.lerp(_a, CARRY_POSE.neck); o.p.y += CARRY_POSE.up;
    o.q.multiply(rig.rp.carried);
    return true;
  }
  if (place === 'drag') {
    // on his back with his own (eased) yaw, torso raised about the pelvis, the chest pulled towards the hands
    root.getWorldQuaternion(_q);
    o.q.copy(_q).multiply(_qr.setFromAxisAngle(X, DRAG_POSE.pitch));
    // in a transition the ground level is the transporter's: lowered from the shoulder (toDrag) the load's own y is
    // still the carry height (1.2 m), which lifted the drag end key — he rose 1.2 m and snapped down at its end
    const ly = st.kind === 'hold' || !c ? 0 : (c.y || 0) - (model.unit?.y || 0);
    o.p.set(root.position.x, root.position.y + ly + DRAG_POSE.lift, root.position.z);
    const hl = socket(cm?.real, 'hand_l'), hr = socket(cm?.real, 'hand_r');
    const pel = rig.pelDrag, ch = rig.chestDrag;
    if (hl && hr && pel && ch) {
      _c.copy(ch).sub(pel).applyQuaternion(o.q).add(o.p); // chest if the pelvis sits at o.p
      hl.getWorldPosition(_a); hr.getWorldPosition(_b); _a.lerp(_b, 0.5);
      const dx = _a.x - _c.x, dz = _a.z - _c.z, d = Math.hypot(dx, dz), s = d > DRAG_POSE.reach ? DRAG_POSE.reach / d : 1;
      o.p.x += dx * s * 0.6; o.p.z += dz * s * 0.6;
    }
    o.q.multiply(rig.rp.dragged);
    return true;
  }
  // lie: where the hands took him (captured), or the put-down spot, stretched away from the transporter
  if (st.to !== 'lie' || st.kind === 'lift' || st.kind === 'grab') {
    if (!rig.cap) return false;
    o.p.copy(rig.cap.pel); o.q.copy(rig.cap.qPel);
    return true;
  }
  const spot = st.spot || { x: root.position.x, z: root.position.z };
  const gy = c?.world?.groundY ? c.world.groundY(spot.x, spot.z) + (c.y || 0) : root.position.y;
  // the spot's own heading when the drop turned him (abilities/common dropSpot: no room lying the natural way)
  if (spot.heading != null) o.q.setFromAxisAngle(Y, Math.PI / 2 - spot.heading);
  else if (st.kind === 'release') root.getWorldQuaternion(o.q);
  else { cm?.root?.getWorldQuaternion(_q); o.q.copy(_q).multiply(_qr.setFromAxisAngle(Y, Math.PI)); }
  o.p.set(spot.x, gy, spot.z);
  if (rig.pelDead) o.p.add(_a.copy(rig.pelDead).applyQuaternion(o.q));
  o.q.multiply(rig.rp.dead);
  return true;
}

/** World placement of an authored key in the transporter's frame (orientation as the 'dead' pose's body). */
function keyPlacement(st, at, o, rig) {
  const cr = st.carrier?.model?.root;
  if (!cr) return false;
  cr.updateMatrixWorld(true);
  o.p.set(at.p[0], at.p[1], at.p[2]);
  cr.localToWorld(o.p);
  cr.getWorldQuaternion(o.q);
  const D = Math.PI / 180;
  let yaw = at.e[1];
  if (at.near && rig.cap) { // the side nearest to how he lies (he is rolled, not spun round)
    _a.set(0, 0, 1).applyQuaternion(_qe.copy(rig.cap.qPel).multiply(_qe2.copy(rig.rp.dead).invert()));
    _b.set(0, 0, 1).applyQuaternion(o.q);
    const rel = Math.atan2(_a.x, _a.z) - Math.atan2(_b.x, _b.z);
    let best = 1e9;
    for (const c of at.near) { const d = Math.abs(Math.atan2(Math.sin(rel - c * D), Math.cos(rel - c * D))); if (d < best) { best = d; yaw = c; } }
  }
  _e.set(at.e[0] * D, yaw * D, at.e[2] * D, 'YXZ');
  o.q.multiply(_q.setFromEuler(_e)).multiply(rig.rp.dead);
  return true;
}

// ------------------------------------------------------------------ evaluation

const ARMS = /^(clavicle|upperarm|lowerarm|hand)_[lr]$/i;
const mk = () => ({ p: new Vector3(), q: new Quaternion() });
const _qb = new Quaternion(), _qp = new Quaternion(), _pl = new Vector3();
const KP = [mk(), mk(), mk(), mk()];

/** Per-model transport state (captured start pose, cached static poses, measured offsets). */
export function rigOf(model) { return model._tp || (model._tp = { cap: null, poses: null }); }

function poses(model, rig) {
  if (!rig.poses) {
    rig.poses = { dead: clipPose(model, 'dead', 1, true), carried: clipPose(model, 'carried', 0), dragged: clipPose(model, 'being_dragged', 0),
      idle: clipPose(model, 'idle', 0) };
    rig.poses.idle ||= rig.poses.dead;
    // limp arms hanging from the shoulders while he is held upright (the arm bones of the standing pose)
    rig.poses.arms = { q: new Map([...rig.poses.idle.q].filter(([n]) => ARMS.test(n))), pelvis: null };
    rig.poses.carried ||= rig.poses.dead; rig.poses.dragged ||= rig.poses.dead;
  }
  return rig.poses;
}

/** Capture how and where the body lies right now (start of a lift / grab; call before the mixer update). */
export function captureStart(model) {
  const rig = rigOf(model), body = model._body(), pel = socket(model.real, 'pelvis');
  model.root.updateMatrixWorld(true);
  rig.cap = { pose: capturePose(model), pel: pel ? pel.getWorldPosition(new Vector3()) : model.root.position.clone(),
    qPel: pel ? pel.getWorldQuaternion(new Quaternion()) : body.getWorldQuaternion(new Quaternion()) };
  return rig.cap;
}

/** Body-local pelvis (and chest) of the static poses, measured once per model. */
function measure(model, rig, guard) {
  if (rig.pelDead) return;
  const P = poses(model, rig);
  writePose(model, [{ pose: P.dead, w: 1 }], guard);
  rig.pelDead = localOf(model, 'pelvis', new Vector3());
  rig.rp = { dead: localRot(model, 'pelvis', new Quaternion()) };
  writePose(model, [{ pose: P.dragged, w: 1 }], guard);
  rig.pelDrag = localOf(model, 'pelvis', new Vector3()); rig.chestDrag = localOf(model, 'spine_03', new Vector3());
  rig.rp.dragged = localRot(model, 'pelvis', new Quaternion());
  writePose(model, [{ pose: P.carried, w: 1 }], guard);
  rig.rp.carried = localRot(model, 'pelvis', new Quaternion());
}

function place(model, st, key, o, rig) {
  if (key.at === 'from') return endPlacement(model, st, st.from, o, rig);
  if (key.at === 'to') return endPlacement(model, st, st.to, o, rig);
  return keyPlacement(st, key.at, o, rig);
}

/**
 * Put the body group so that its pelvis lands on world `P` with world orientation `Q` (the body group's own, or the
 * pelvis bone's when `rp` = the pelvis' body-local rotation is given).
 */
export function setBody(model, P, Q, pelLocal, rp = null) {
  const root = model.root, body = model._body();
  if (rp) Q = _qb.copy(Q).multiply(_qe.copy(rp).invert());
  root.getWorldQuaternion(_qr).invert();
  body.quaternion.copy(_qr).multiply(Q);
  _p.copy(pelLocal).applyQuaternion(Q);
  body.position.copy(P).sub(_p).sub(root.position).applyQuaternion(_qr);
}

/**
 * Pose and place a transported man for phase `st` (paired track, or the live hold). `guard` records direct bone
 * writes (unit-model restores them before the next mixer update). @returns {boolean} placed
 */
export function poseTransported(model, st, guard = null) {
  const rig = rigOf(model), P = poses(model, rig);
  if (!P.dead || !socket(model.real, 'pelvis')) return false;
  measure(model, rig, guard);
  const keys = st.kind === 'hold' ? null : TRACKS[st.kind];
  if (!keys) {
    const pl = localOf(model, 'pelvis', _pl), rp = localRot(model, 'pelvis', _qp);
    if (!pl || !endPlacement(model, st, st.from, KP[1], rig)) return false;
    setBody(model, KP[1].p, KP[1].q, pl, rp);
    return true;
  }
  let i = 0;
  while (i < keys.length - 2 && st.k > keys[i + 1].k) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const u = smooth((st.k - k0.k) / Math.max(1e-6, k1.k - k0.k));
  // skeleton: blend of the static poses
  const list = [];
  for (const n of new Set([...Object.keys(k0.pose), ...Object.keys(k1.pose)])) {
    const w = (k0.pose[n] || 0) * (1 - u) + (k1.pose[n] || 0) * u;
    const pose = n === 'cap' ? rig.cap?.pose || P.dead : P[n];
    if (w > 1e-4 && pose) list.push({ pose, w });
  }
  writePose(model, list, guard);
  const pl = localOf(model, 'pelvis', _pl), rp = localRot(model, 'pelvis', _qp);
  // root: Catmull-Rom through the key pelvis positions, slerp between the key orientations
  const ids = [Math.max(0, i - 1), i, i + 1, Math.min(keys.length - 1, i + 2)];
  for (let j = 0; j < 4; j++) if (!place(model, st, keys[ids[j]], KP[j], rig)) return false;
  const [A, B, C, D] = KP, u2 = u * u, u3 = u2 * u;
  _a.copy(B.p).multiplyScalar(2)
    .addScaledVector(_b.copy(C.p).sub(A.p), u)
    .addScaledVector(_b.copy(A.p).multiplyScalar(2).addScaledVector(B.p, -5).addScaledVector(C.p, 4).sub(D.p), u2)
    .addScaledVector(_b.copy(B.p).multiplyScalar(3).sub(A.p).addScaledVector(C.p, -3).add(D.p), u3)
    .multiplyScalar(0.5);
  _q.copy(B.q).slerp(C.q, u);
  setBody(model, _a, _q, pl, rp);
  return true;
}
// ------------------------------------------------------------------ leg grounding (§C.2 fallback pose)

const _A = new Vector3(), _B = new Vector3(), _C = new Vector3(), _T = new Vector3(), _ax = new Vector3(), _d1 = new Vector3(), _d2 = new Vector3();
const _pq = new Quaternion(), _rq = new Quaternion();

/** Rotate `bone` by the WORLD rotation `q` (its children follow). */
function rotWorld(bone, q) {
  bone.parent.getWorldQuaternion(_pq);
  _rq.copy(_pq).invert().multiply(q).multiply(_pq);
  bone.quaternion.premultiply(_rq);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (hip a → knee b → ankle c) towards world point `t`, keeping the bend plane.
 * @returns {number} remaining distance (m)
 */
export function twoBoneIK(a, b, c, t) {
  a.getWorldPosition(_A); b.getWorldPosition(_B); c.getWorldPosition(_C); _T.copy(t);
  const lab = _B.distanceTo(_A), lcb = _C.distanceTo(_B), lat = clamp(_T.distanceTo(_A), 1e-3, lab + lcb - 1e-3);
  const ang = (u, v) => Math.acos(clamp(u.dot(v) / Math.max(1e-9, u.length() * v.length()), -1, 1));
  const ac_ab0 = ang(_d1.copy(_C).sub(_A), _d2.copy(_B).sub(_A));
  const ba_bc0 = ang(_d1.copy(_A).sub(_B), _d2.copy(_C).sub(_B));
  const ac_ab1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const ba_bc1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  _ax.copy(_d1.copy(_C).sub(_A)).cross(_d2.copy(_B).sub(_A));
  if (_ax.lengthSq() < 1e-12) return _C.distanceTo(_T);
  _ax.normalize();
  rotWorld(a, _q.setFromAxisAngle(_ax, ac_ab1 - ac_ab0));
  rotWorld(b, _q.setFromAxisAngle(_ax, ba_bc1 - ba_bc0));
  c.getWorldPosition(_C);
  _d1.copy(_C).sub(_A); _d2.copy(_T).sub(_A);
  const turn = ang(_d1, _d2);
  if (turn > 1e-5) { _ax.copy(_d1).cross(_d2).normalize(); rotWorld(a, _q.setFromAxisAngle(_ax, turn)); }
  c.getWorldPosition(_C);
  return _C.distanceTo(_T);
}

/** Heel (ankle bone) height above the ground of a dragged man's trailing legs (m). */
export const DRAG_HEEL = 0.08;

/**
 * How much the dragged man's heels are put on the ground in a phase (0..1): fully while dragged, eased in as he is
 * lowered into the drag (grab, toDrag) and out as he is let go or hauled up (release, toShoulder).
 */
export function dragGroundWeight(st) {
  if (!st) return 0;
  if (st.kind === 'hold') return st.from === 'drag' ? 1 : 0;
  const ramp = (a, b) => smooth((st.k - a) / (b - a));
  switch (st.kind) {
    case 'grab': return ramp(0.62, 1);
    case 'toDrag': return ramp(0.68, 1);
    case 'release': return 1 - ramp(0.5, 0.9);
    case 'toShoulder': return 1 - ramp(0, 0.3);
    default: return 0;
  }
}

const _H = new Vector3(), _K = new Vector3(), _F = new Vector3();

/**
 * A dragged body's heels follow the ground (§C.2). The hold pose pitches the torso up about the pelvis, which tips the
 * straight legs down into the ground; each leg is swung back up by two-bone IK so the ankle trails at DRAG_HEEL above
 * the terrain, keeping the pose's hip-to-ankle reach (its knee bend, and loadGait's knee bumps) and its sideways
 * swing. A rise in the ground is followed at once (a heel never sinks); a dip is settled into over ~0.4 s (the legs
 * lag behind). `w` < 1 (transitions, dragGroundWeight) blends from the pose towards that; at any `w` (0 included:
 * the rest of a transition) an ankle is never left below the ground (floor: ground + DRAG_HEEL / 2, eased down to the
 * bare ground over w < 0.25 so it meets the lying pose's ankles at w = 0 without a jump).
 * `ey`: the elevation of the level he is on. During a transition that is the TRANSPORTER's (the load's own y is still
 * the shoulder height of 1.2 m above it while he is lowered into a drag: the heels were aimed 1.2 m up in the air).
 */
export function groundDraggedLegs(model, u, dt, guard = null, w = 1, ey = u?.y || 0) {
  const gy = u?.world?.groundY;
  if (typeof gy !== 'function' || !(w >= 0)) return false;
  w = Math.min(1, w);
  const R = model.real, lag = model._legLag || (model._legLag = { l: null, r: null });
  const k = dt > 0 ? Math.min(1, dt / 0.4) : 1, g = (x, z) => gy(x, z) + ey + DRAG_HEEL;
  let did = false;
  for (const s of ['l', 'r']) {
    const th = R.getSocket?.('thigh_' + s), ca = R.getSocket?.('calf_' + s), ft = R.getSocket?.('foot_' + s);
    if (!th || !ca || !ft) continue;
    th.updateMatrixWorld(true);
    if (w === 0) { // the rest of a lift / lower: only an ankle under the snow is lifted onto it (cheap: no IK otherwise)
      lag[s] = null;
      ft.getWorldPosition(_F);
      const fl = gy(_F.x, _F.z) + ey;
      if (_F.y > fl - 0.01) continue;
      guard?.touch(th); guard?.touch(ca);
      twoBoneIK(th, ca, ft, _T.set(_F.x, fl, _F.z));
      did = true;
      continue;
    }
    th.getWorldPosition(_H); ca.getWorldPosition(_K); ft.getWorldPosition(_F);
    const len = _K.distanceTo(_H) + _F.distanceTo(_K);
    const reach = clamp(_F.distanceTo(_H), 0.3 * len, 0.985 * len);
    let hx = _F.x - _H.x, hz = _F.z - _H.z;
    const hl = Math.hypot(hx, hz);
    if (hl < 1e-4) continue;
    hx /= hl; hz /= hl;
    // the heel lands further out along the leg once it is raised: sample the ground there (two passes)
    let ty = g(_F.x, _F.z);
    for (let i = 0; i < 2; i++) {
      const h = Math.sqrt(Math.max(0, reach * reach - (ty - _H.y) ** 2));
      ty = g(_H.x + hx * h, _H.z + hz * h);
    }
    const prev = lag[s];
    lag[s] = prev == null || ty > prev || prev - ty > 0.6 ? ty : prev + (ty - prev) * k;
    ty = lag[s];
    const h = Math.sqrt(Math.max(0, reach * reach - (ty - _H.y) ** 2));
    _T.set(_H.x + hx * h, ty, _H.z + hz * h);
    if (w < 1) {
      _T.lerpVectors(_F, _T, w);
      _T.y = Math.max(_T.y, g(_T.x, _T.z) - DRAG_HEEL * (1 - 0.5 * Math.min(1, w * 4))); // blending: never under the snow
    }
    if (_T.distanceToSquared(_F) < 1e-4) continue;
    guard?.touch(th); guard?.touch(ca);
    twoBoneIK(th, ca, ft, _T);
    did = true;
  }
  return did;
}
