/**
 * Draws a physics ragdoll pose on a real character's skeleton (bodies-design §A.4). The sim publishes, per body part,
 * its transform now and at spawn plus the unit's anchor; every bone gets the rotation delta of its body segment
 * applied to a BASE pose captured from the skeleton itself:
 *
 *   boneWorld = (bodyQ · spawnQ⁻¹) · anchorQ · baseRootLocal
 *
 * base = the character's idle pose for a blast (the ragdoll template IS that pose) or the frozen death-clip pose for
 * a settle, so the hand-off never pops. Intermediate bones (spine_01/02, neck, clavicles, hands, feet) take the delta
 * of their segment (the spine is spread between pelvis and chest). Visual only: nothing here feeds the sim.
 * @module art/ragdoll-pose
 */

import { Quaternion, Vector3, Matrix4 } from 'three';

/** Bone → [segment index, blend segment index | -1, blend weight]. Segments follow physics/ragdoll-template PARTS. */
const BONES = [
  ['pelvis', 0, -1, 0], ['spine_01', 0, 1, 1 / 3], ['spine_02', 0, 1, 2 / 3], ['spine_03', 1, -1, 0],
  ['neck_01', 1, 2, 0.5], ['head', 2, -1, 0],
  ['clavicle_l', 1, -1, 0], ['upperarm_l', 3, -1, 0], ['lowerarm_l', 4, -1, 0], ['hand_l', 4, -1, 0],
  ['clavicle_r', 1, -1, 0], ['upperarm_r', 5, -1, 0], ['lowerarm_r', 6, -1, 0], ['hand_r', 6, -1, 0],
  ['thigh_l', 7, -1, 0], ['calf_l', 8, -1, 0], ['foot_l', 8, -1, 0],
  ['thigh_r', 9, -1, 0], ['calf_r', 10, -1, 0], ['foot_r', 10, -1, 0],
];
const NSEG = 11;
/** Idle base poses per character id (captured once from a standing instance). */
const IDLE = new Map();

const _q = new Quaternion(), _q2 = new Quaternion(), _qa = new Quaternion(), _qr = new Quaternion();
const _p = new Vector3(), _s = new Vector3(), _v = new Vector3(), _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const D = Array.from({ length: NSEG }, () => new Quaternion());

/** Bones of a real model in hierarchy order (parents first), cached on the model. */
function bonesOf(model) {
  if (model._rdBones !== undefined) return model._rdBones;
  const R = model.real, list = [];
  for (const [name, seg, seg2, w] of BONES) {
    const b = R.getSocket(name);
    if (b && b.isBone !== false) list.push({ name, b, seg, seg2, w });
  }
  model._rdBones = list.length >= 11 ? list : null;
  return model._rdBones;
}

/** Capture the current skeleton pose in root-local terms: rotations of every mapped bone + the pelvis position. */
export function captureBase(model) {
  const bones = bonesOf(model);
  if (!bones) return null;
  const root = model.root;
  root.updateMatrixWorld(true);
  root.matrixWorld.decompose(_p, _qr, _s);
  _qr.invert();
  const base = { q: bones.map(() => new Quaternion()), pelvis: new Vector3(), scale: _s.x || 1 };
  bones.forEach(({ b }, i) => {
    b.matrixWorld.decompose(_v, _q, _s);
    base.q[i].copy(_qr).multiply(_q);
  });
  bones[0].b.getWorldPosition(base.pelvis);
  root.worldToLocal(base.pelvis);
  base.pelvis.multiplyScalar(base.scale);   // root-local metres (roots are unscaled in practice)
  return base;
}

/** Remember a standing idle pose for this character id (UnitModel calls it once the body shows its idle clip). */
export function rememberIdle(model) {
  if (!model?.characterId || IDLE.has(model.characterId)) return;
  const b = captureBase(model);
  if (b) IDLE.set(model.characterId, b);
}

/** Base pose for a record: blast → idle of this character (else the current pose); settle → the current (death) pose. */
function baseFor(model, rec) {
  const key = rec.mode + ':' + rec.a.join(',');
  if (model._rdBase && model._rdBaseKey === key) return model._rdBase;
  const base = (rec.mode === 'blast' ? IDLE.get(model.characterId) : null) || captureBase(model);
  model._rdBase = base; model._rdBaseKey = key;
  return base;
}

/**
 * Pose the skeleton of `model` from pose record `rec` ({mode, a:[x,y,z,h], s:[11×4], p0:[3], b:[11×7], n?, tn?, t0?}).
 * @param {object} model UnitModel (real) @param {object} rec @param {number} now world time (s)
 * @param {{before:Function, after:Function}} [guard] records the mixer values under the written bones (StickyGuard)
 * @returns {boolean} posed
 */
export function applyRagdollPose(model, rec, now = 0, guard = null) {
  const bones = bonesOf(model);
  if (!bones || !rec?.b || rec.b.length < NSEG * 7) return false;
  const base = baseFor(model, rec);
  if (!base) return false;
  const [ax, ay, az, ah] = rec.a;
  _qa.setFromAxisAngle(_up, Math.PI / 2 - ah);
  // visual nudge (settle moved the gameplay position off a blocker): blend in over 0.3 s
  let nx = 0, nz = 0;
  if (rec.n && (rec.n[0] || rec.n[1])) { const k = Math.min(1, Math.max(0, (now - (rec.tn ?? 0)) / 0.3)); nx = rec.n[0] * k; nz = rec.n[1] * k; }
  for (let i = 0; i < NSEG; i++) {
    const o = i * 7, s = i * 4;
    _q.set(rec.b[o + 3], rec.b[o + 4], rec.b[o + 5], rec.b[o + 6]);
    _q2.set(rec.s[s], rec.s[s + 1], rec.s[s + 2], rec.s[s + 3]).invert();
    D[i].copy(_q).multiply(_q2).normalize();
  }
  // blast blend-in from the animated pose (0.15 s)
  const blend = rec.mode === 'blast' && rec.t0 != null ? Math.min(1, Math.max(0, (now - rec.t0) / 0.15)) : 1;
  model.root.updateMatrixWorld(true);
  for (let i = 0; i < bones.length; i++) {
    const { b, seg, seg2, w } = bones[i];
    const d = seg2 >= 0 ? _q.copy(D[seg]).slerp(D[seg2], w) : _q.copy(D[seg]);
    const target = _q2.copy(d).multiply(_qa).multiply(base.q[i]);   // bone world rotation
    const parent = b.parent;
    guard?.before(b);
    parent.matrixWorld.decompose(_v, _qr, _s);
    if (blend < 1) { b.matrixWorld.decompose(_p, _q, _s); target.copy(_q.slerp(target, blend)); }
    b.quaternion.copy(_qr.invert().multiply(target));
    if (i === 0) {
      // pelvis position: the spawn-relative displacement of the pelvis body, applied to the base pelvis
      _v.copy(base.pelvis).applyQuaternion(_qa).add(_p.set(ax, ay, az)).sub(_s.set(rec.p0[0], rec.p0[1], rec.p0[2]));
      _v.applyQuaternion(D[0]).add(_p.set(rec.b[0] + nx, rec.b[1], rec.b[2] + nz));
      if (blend < 1) { b.getWorldPosition(_s); _v.lerp(_s, 1 - blend); }
      parent.worldToLocal(_v);
      b.position.copy(_v);
    }
    guard?.after(b);
    b.updateMatrix();
    b.matrixWorld.multiplyMatrices(parent.matrixWorld, b.matrix);
  }
  model.root.updateMatrixWorld(true);
  return true;
}
