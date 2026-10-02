/**
 * Contact knife kill, drawn (abilities/knife-contact.js; user 2026-10-02: "When killing someone from behind it should
 * look like you are stabbing the front neck from behind. When stabbing from the front it should look as if there is no
 * distance"). Visual only: a post pass over both skeletons after every model's own update (Game.render →
 * knifeKillFrame), the victim first, then the attacker's hands on the victim's bones as posed this frame, then the
 * victim's hands on the attacker's forearms. Every write goes through the model's BoneGuard (pose-blend.js), so the
 * mixer takes over again cleanly the frame the pass stops. Everything is a function of the sim record and the
 * interpolated sim time: deterministic stepping draws the same frames.
 *
 *  FROM BEHIND  the step in (leg IK: lead foot, then trail foot) to chest-on-back contact (a deep pack keeps him a
 *               little further back, leaning over it); left palm over the victim's mouth pulls the head back, the
 *               knife comes round his right side, its tip drawn across the FRONT of the throat at the hit frame; the
 *               victim's arms jerk up to the attacker's forearms; cut, he sags back against him (knees giving), is let
 *               go, drops to his knees and pitches forward onto his face, ending exactly in the pose the mixer shows
 *               of his corpse (die_prone at the prone corpse spot the sim chose), so the settle ragdoll takes over
 *               as for any man who died lying on his belly.
 *  FROM THE FRONT  the step in to chest-to-chest; left hand on the victim's right collar, the blade driven in under
 *               his ribs at zero distance; he grabs the knife arm and doubles over, is pushed off and the death clip
 *               (a crumple, then the fall back) takes over from the doubled-over pose.
 *
 * Contact geometry comes from the bodies themselves (per character, from the skinned LOD0 mesh in its idle pose):
 * the mouth and throat surface points (Head / neck_01 frames), the chest front and the back (pack included) at chest
 * height. `pairMetrics()` measures what tests and tools report: torso (spine_03) distance, the surface gap, the left
 * palm to the mouth, the knife tip to the throat / belly.
 * @module art/knife-kill
 */
import { Vector3, Quaternion, Matrix4, Object3D } from 'three';
import { twoBoneIKPole } from './characters/commandos_a/ca_ik.js';
import { clipPose, capturePose, mixPose } from './pose-blend.js';
import { headingToRotY, lerpAngle } from '../core/math.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-6, b - a));
const BASE_UMW = Object3D.prototype.updateMatrixWorld;
const upd = (o) => BASE_UMW.call(o, true);

/** Victim / attacker timelines (s). Hit = the kill event (plan.close + 0.3); End = the action's end (close + 0.6). */
export const KK = Object.freeze({
  aOut: 0.3,          // attacker: blend back to his own clip after the action ends
  behindEnd: 1.08,    // victim from behind: on the ground in his corpse pose this long after the hit
  frontEnd: 0.66,     // victim from the front: the death clip has him (blend-out done) this long after the hit
  lift: 0.09,         // step: foot lift (m)
});

/** Bones of a body pose in hierarchy order (fingers left to the mixer). */
const ORDER = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];

const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion(), _m = new Matrix4();
const wp = (o, out = new Vector3()) => o.getWorldPosition(out);
const wq = (o, out = new Quaternion()) => o.getWorldQuaternion(out);

const bonesOf = (m) => m?.real?.inner?.bones || null;
/** A real character with a full UAL body ready. */
export function realBody(m) {
  const B = bonesOf(m);
  return !!(m && !m.fallback && m.real && B && B.pelvis && B.Head && B.neck_01 && B.hand_l && B.hand_r && B.foot_l && B.foot_r && B.calf_l && B.calf_r);
}

function setWQ(m, b, q) {
  if (!b) return;
  m._guard?.touch(b);
  b.quaternion.copy(wq(b.parent, _q2).invert().multiply(q));
  b.updateMatrixWorld(true);
}
/** Rotate bone b by `angle` about the WORLD axis `axis` (its children follow). */
function turn(m, b, axis, angle) {
  if (!b || Math.abs(angle) < 1e-6) return;
  m._guard?.touch(b);
  const pq = wq(b.parent, _q2);
  _v.copy(axis).applyQuaternion(pq.clone().invert()).normalize();
  b.quaternion.premultiply(_q.setFromAxisAngle(_v, angle));
  b.updateMatrixWorld(true);
}
function setPelvisWorld(m, B, p) {
  m._guard?.touch(B.pelvis);
  B.pelvis.parent.updateWorldMatrix(true, false);
  B.pelvis.position.copy(B.pelvis.parent.worldToLocal(p.clone()));
  B.pelvis.updateMatrixWorld(true);
}

/** World snapshot of a body pose: per bone world rotation, pelvis world position. */
function snap(B) {
  const q = new Map();
  for (const n of ORDER) if (B[n]) q.set(n, wq(B[n]));
  return { q, p: wp(B.pelvis) };
}
/** Write the world-space blend of snapshots A → Z (weight w) top-down. */
function writeBlend(m, B, A, Z, w) {
  for (const n of ORDER) {
    const b = B[n]; if (!b) continue;
    const qa = A.q.get(n), qz = Z.q.get(n);
    if (!qa || !qz) continue;
    if (n === 'pelvis') setPelvisWorld(m, B, A.p.clone().lerp(Z.p, w));
    setWQ(m, b, qa.clone().slerp(qz, w));
  }
}

/** Two-bone IK of a limb with weight w (slerp from the pose before). endQ: world rotation of the end bone, or null. */
function limbIK(m, a, b, c, target, pole, w, endQ = null) {
  if (!a || !b || !c || w <= 1e-3) return 0;
  for (const o of [a, b, c]) m._guard?.touch(o);
  const q0 = a.quaternion.clone(), q1 = b.quaternion.clone(), q2 = c.quaternion.clone();
  const err = twoBoneIKPole(a, b, c, target, pole, endQ);
  if (w < 0.999) {
    a.quaternion.copy(q0.slerp(a.quaternion, w)); b.quaternion.copy(q1.slerp(b.quaternion, w)); c.quaternion.copy(q2.slerp(c.quaternion, w));
    a.updateMatrixWorld(true);
  }
  return err;
}

/** Frame of a model's root: forward / left / up world unit vectors. */
function frameOf(root) {
  const q = wq(root);
  return { f: new Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize(), l: new Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize(), u: new Vector3(0, 1, 0) };
}

// ------------------------------------------------------------------ contact landmarks (per character, from its mesh)

const MARKS = new Map();
/**
 * Contact landmarks of a character, measured once on its skinned LOD0 mesh in the idle pose (the skeleton is put back):
 * mouth / chin (Head frame), throat (neck_01 frame), and root-local depths of the chest front and the back (pack
 * included) at chest height, the belly front. @returns {object|null}
 */
export function contactMarks(m) {
  const id = m?.characterId;
  if (!id || !realBody(m)) return null;
  if (MARKS.has(id)) return MARKS.get(id);
  const B = bonesOf(m), root = m.root, inner = m.real.inner;
  let mesh = null;
  inner.object?.traverse((o) => { if (o.isSkinnedMesh && /^LOD0$/.test(o.name)) mesh = o; });
  if (!mesh) inner.object?.traverse((o) => { if (!mesh && o.isSkinnedMesh && /^LOD\d$/.test(o.name)) mesh = o; });
  if (!mesh) return null;
  const keep = capturePose(m), body = m._body?.();
  const bq = body?.quaternion.clone(), bp = body?.position.clone();
  if (body && body !== root) { body.quaternion.identity(); body.position.set(0, 0, 0); }
  const idle = clipPose(m, 'idle', 0);
  if (idle) { for (const [k, q] of idle.q) if (B[k]) B[k].quaternion.copy(q); if (idle.pelvis) B.pelvis.position.copy(idle.pelvis); }
  upd(root);
  const L = (n) => root.worldToLocal(wp(B[n]));
  const head = L('Head'), neck = L('neck_01'), s3 = L('spine_03'), s2 = L('spine_02');
  const pos = mesh.geometry.attributes.position, v = new Vector3();
  let mouth = null, chin = null, throat = null, chestZ = -1, backZ = 1, bellyZ = -1, chestP = null, backP = null;
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); root.worldToLocal(v);
    const mid = Math.abs(v.x - head.x) < 0.022;
    if (mid && v.y > head.y - 0.065 && v.y < head.y - 0.035 && (!mouth || v.z > mouth.z)) mouth = v.clone();
    if (mid && v.y > head.y - 0.1 && v.y < head.y - 0.075 && (!chin || v.z > chin.z)) chin = v.clone();
    if (Math.abs(v.x - neck.x) < 0.02 && v.y > neck.y - 0.06 && v.y < neck.y - 0.015 && (!throat || v.z > throat.z)) throat = v.clone();
    if (Math.abs(v.x - s3.x) < 0.15 && v.y > s3.y + 0.02 && v.y < s3.y + 0.3) {
      if (v.z > chestZ) { chestZ = v.z; chestP = v.clone(); }
      if (v.z < backZ) { backZ = v.z; backP = v.clone(); }
    }
    if (Math.abs(v.x - s2.x) < 0.1 && v.y > s2.y - 0.02 && v.y < s2.y + 0.1) bellyZ = Math.max(bellyZ, v.z);
  }
  const toBone = (p, n) => (p ? B[n].worldToLocal(root.localToWorld(p.clone())) : null);
  const fwdW = new Vector3(0, 0, 1).applyQuaternion(wq(root));
  const dirIn = (n) => fwdW.clone().applyQuaternion(wq(B[n]).invert()).normalize();   // his forward, in a bone's frame
  const out = {
    mouth: toBone(mouth || head.clone().add(new Vector3(0, -0.05, 0.1)), 'Head'),
    chin: toBone(chin || head.clone().add(new Vector3(0, -0.08, 0.09)), 'Head'),
    throat: toBone(throat || neck.clone().add(new Vector3(0, -0.03, 0.075)), 'neck_01'),
    face: dirIn('Head'), neckFwd: dirIn('neck_01'),
    chestPt: toBone(chestP || new Vector3(s3.x, s3.y + 0.15, 0.17), 'spine_03'), backPt: toBone(backP || new Vector3(s3.x, s3.y + 0.15, -0.2), 'spine_03'),
    belly: toBone(new Vector3(s2.x, s2.y + 0.07, bellyZ), 'spine_02'),
    chestZ, backZ, bellyZ, s3y: s3.y, s2y: s2.y, headY: head.y,
    arm: wp(B.upperarm_l).distanceTo(wp(B.lowerarm_l)) + wp(B.lowerarm_l).distanceTo(wp(B.hand_l)),
  };
  // put the skeleton back as it was
  for (const [k, q] of keep.q) if (B[k]) B[k].quaternion.copy(q);
  if (keep.pelvis) B.pelvis.position.copy(keep.pelvis);
  if (body && body !== root) { body.quaternion.copy(bq); body.position.copy(bp); }
  upd(root);
  MARKS.set(id, out);
  return out;
}
const at = (B, n, local) => B[n].localToWorld(local.clone());

// ------------------------------------------------------------------ the pass

/**
 * Pose every contact knife kill under way (Game.render, after every model's update and the transport pass).
 * @param {object} world @param {number} [alpha] sim interpolation of this frame @param {number} [simDt]
 */
export function knifeKillFrame(world, alpha = 1, simDt = 1 / 60) {
  const list = world?.knifeKills;
  if (!list?.length) return;
  const now = world.time - (1 - clamp(alpha, 0, 1)) * simDt;
  for (let i = list.length - 1; i >= 0; i--) {
    let keep = false;
    try { keep = pairFrame(world, list[i], now); } catch (e) { console.warn('[knife-kill]', e?.stack || e); }
    if (!keep) list.splice(i, 1);
  }
}

/** One frame of one kill. @returns {boolean} still under way */
function pairFrame(world, rec, now) {
  const a = rec.a, v = rec.v, am = a?.model, vm = v?.model;
  const t = now - rec.t0;
  if (t < 0) return true;
  const vEnd = rec.hit + (rec.side === 'behind' ? KK.behindEnd : KK.frontEnd);
  // the kill did not happen as drawn (the attacker fell before the hit, someone else's bullet got the victim first):
  // both go back to their own clips
  if ((a.alive === false && t < rec.hit) || (v.alive === false && (v.killer !== a || v.deathCause !== 'knife'))) return false;
  const aOn = t <= rec.dur + KK.aOut + 0.25 && a.alive !== false && !a.removed;
  const vOn = t <= vEnd && !v.removed && !v._rd && !v.bodyPose && v.state !== 'carried' && !v.carriedBy && (t < rec.hit + 0.1 || v.alive === false);
  if (!aOn && !vOn) return false;
  if (!realBody(am) || !realBody(vm)) return t <= Math.max(vEnd, rec.dur + KK.aOut + 0.25);
  const VB = bonesOf(vm), AB = bonesOf(am);
  const VM = contactMarks(vm), AM = contactMarks(am);
  if (!VM || !AM) return false;
  rec.vis ||= {};
  if (vOn) victimBody(world, rec, vm, VB, VM, t);
  if (aOn) attacker(world, rec, am, AB, AM, vm, VB, VM, t);
  if (vOn) victimHands(rec, vm, VB, am, AB, t);
  if (vOn) finish(vm);
  if (aOn) finish(am);
  rec.vis.last = t;
  return true;
}

function finish(m) {
  const root = m.root;
  upd(root);
  m._mw?.copy(root.matrix); m._mwValid = true;
}

// ------------------------------------------------------------------ victim

/** Displayed heading of the victim at t (a frontal kill: he turns to face the attacker during the step). */
function victimHeading(rec, t) {
  const P = rec.plan;
  if (rec.side !== 'front') return P.v.h;
  return lerpAngle(P.v.h, P.vh, ramp(t, 0, Math.max(0.08, rec.close)));
}

function victimBody(world, rec, m, B, M, t) {
  const P = rec.plan, H = rec.hit, root = m.root, body = m._body?.();
  const behind = rec.side === 'behind';
  // the mixer's pose as the sim placed him (after the hit: the corpse clip at the corpse spot): the end of the fall
  const L = t >= H ? snap(B) : null;
  const simPos = root.position.clone(), simRotY = root.rotation.y;
  // his rifle: slung on his back by the runtime (from the mixer's chest) until the grab, then carried with his chest as
  // posed here; at the end it goes where the runtime lays it (beside his corpse)
  const gun = m.real.inner.weapon, gunW = gun?.visible !== false ? gun?.matrixWorld.clone() : null;
  if (gun && gunW && (!rec.vis.gunRel || t < rec.close - 0.16)) {
    rec.vis.gunRel = B.spine_03.matrixWorld.clone().invert().multiply(gunW);
    rec.vis.gunRelP = B.pelvis.matrixWorld.clone().invert().multiply(gunW);
  }
  // he is drawn where he was held (the sim moved a pitched-forward corpse ahead at the hit)
  const out = behind ? 0 : ramp(t, H + 0.28, H + KK.frontEnd - 0.04);
  root.position.set(P.v.x, world.groundY ? world.groundY(P.v.x, P.v.z) + (rec.v.y || 0) : simPos.y, P.v.z);
  if (!behind && t >= H) root.position.lerp(simPos, out);
  root.rotation.y = headingToRotY(victimHeading(rec, t));
  if (!behind && t >= H) root.rotation.y = lerpRot(root.rotation.y, simRotY, out);
  upd(root);
  if (body && body !== root && (body.position.lengthSq() > 0 || body.quaternion.w < 1 - 1e-9)) {   // prone-ground's tilt / lag
    m._guard?.touch(body); body.position.set(0, 0, 0); body.quaternion.identity(); upd(root);
  }
  const F = frameOf(root);
  // standing base: his idle (from the grab on); before it, his own clip
  const idle = clipPose(m, 'idle', 0);
  const wb = t >= H ? 1 : ramp(t, rec.close - 0.16, rec.close - 0.02);
  if (idle && wb > 1e-3) mixPose(m, idle, wb, m._guard);
  upd(root);
  const g = ramp(t, rec.close - 0.06, rec.close + 0.1);                 // grabbed
  if (behind) victimBehind(world, rec, m, B, M, F, t, g, L);
  else victimFront(world, rec, m, B, M, F, t, g, L, out);
  const rel = rec.vis.gunRel;
  if (gun && gunW && rel && gun.parent) {
    upd(root);
    // slung: carried by his chest; a man doubled over lets it swing (half way to where his hips would carry it)
    let Wc = B.spine_03.matrixWorld.clone().multiply(rel);
    if (!behind && rec.vis.gunRelP) Wc = blendM(Wc, B.pelvis.matrixWorld.clone().multiply(rec.vis.gunRelP), 0.6);
    const k = t < H ? 0 : behind ? ramp(t, H + 0.78, H + KK.behindEnd) : out;
    const Wt = k > 0 ? blendM(Wc, gunW, k) : Wc;
    gun.parent.updateWorldMatrix(true, false);
    Wt.premultiply(gun.parent.matrixWorld.clone().invert()).decompose(gun.position, gun.quaternion, gun.scale);
    gun.updateMatrixWorld(true);
  }
}
function blendM(A, Z, k) {
  const pa = new Vector3(), qa = new Quaternion(), sa = new Vector3(), pz = new Vector3(), qz = new Quaternion(), sz = new Vector3();
  A.decompose(pa, qa, sa); Z.decompose(pz, qz, sz);
  return new Matrix4().compose(pa.lerp(pz, k), qa.slerp(qz, k), sa.lerp(sz, k));
}
const lerpRot = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Planted-feet leg IK with the pelvis moved to `pel` (world), knees bending forward. */
function legsTo(m, B, F, feet, w = 1) {
  for (const s of ['l', 'r']) {
    const th = B['thigh_' + s], ca = B['calf_' + s], fo = B['foot_' + s];
    const f = feet[s];
    const pole = wp(ca).addScaledVector(F.f, 0.6).addScaledVector(F.l, s === 'l' ? 0.12 : -0.12);
    limbIK(m, th, ca, fo, f.p, pole, w, f.q);
  }
}
const feetOf = (B) => ({ l: { p: wp(B.foot_l), q: wq(B.foot_l) }, r: { p: wp(B.foot_r), q: wq(B.foot_r) } });

function victimBehind(world, rec, m, B, M, F, t, g, L) {
  const H = rec.hit, E = rec.dur;
  const s = ramp(t, H + 0.02, H + 0.3);         // cut: knees give, he sags back against him
  const k = ramp(t, H + 0.26, H + 0.6);          // let go: down onto his knees
  const fu = clamp((t - H - 0.52) / 0.38, 0, 1); // pitches forward onto his face (accelerating)
  const f = fu * fu;
  const e = ramp(t, H + 0.78, H + KK.behindEnd); // into his corpse pose (the mixer's)
  const rel = ramp(t, E - 0.04, E + 0.16);       // the attacker lets go
  const back = F.l.clone();                       // + about his left axis = pitch forward / down
  const feet = feetOf(B);
  // pelvis: sag (down, back into the attacker), then the kneel over his planted feet
  if (s > 0 || k > 0) {
    const p0 = wp(B.pelvis), thigh = wp(B.thigh_l).distanceTo(wp(B.calf_l)), shin = wp(B.calf_l).distanceTo(wp(B.foot_l));
    const mid = feet.l.p.clone().lerp(feet.r.p, 0.5);
    const sag = p0.clone().addScaledVector(F.u, -0.15 * s).addScaledVector(F.f, -0.035 * s);
    const kneel = mid.clone().addScaledVector(F.f, shin * 0.72);
    kneel.y = Math.min(feet.l.p.y, feet.r.p.y) - 0.04 + thigh * 0.98;
    setPelvisWorld(m, B, sag.lerp(kneel, k));
    // the feet go onto their toes as the shins come down (plantar flexion about his left axis)
    if (k > 0) for (const sd of ['l', 'r']) feet[sd].q = new Quaternion().setFromAxisAngle(back, 1.05 * k).multiply(feet[sd].q);
    legsTo(m, B, F, feet);
  }
  // torso: arched back while the head is pulled back; slumps after the cut, folds forward on his knees
  const arch = -0.07 * g * (1 - rel), slump = 0.05 * s + 0.16 * k;
  turn(m, B.spine_01, back, slump * 0.5);
  turn(m, B.spine_02, back, arch + slump * 0.7);
  turn(m, B.spine_03, back, arch + slump * 0.6);
  const pull = g * (1 - rel);                   // head pulled back by the hand over his mouth
  const loll = ramp(t, E - 0.02, E + 0.25);     // released: the head drops
  turn(m, B.neck_01, back, -0.22 * pull + 0.35 * loll);
  turn(m, B.Head, back, -0.26 * pull + 0.3 * loll);
  // pulled back onto the attacker's left shoulder: his head tilts to his left (the right of his throat bared)
  turn(m, B.neck_01, F.f, -0.12 * pull);
  turn(m, B.Head, F.f, -0.16 * pull);
  // the fall: everything above the knees rotates forward about the knee line (toward where his corpse will lie: ahead,
  // or a clear diagonal), the shins stay on the ground
  if (f > 0) {
    const fh = rec.plan.fall ?? rec.plan.v.h, fl = new Vector3(Math.sin(fh), 0, -Math.cos(fh));
    const kl = wp(B.calf_l), kr = wp(B.calf_r), pivot = kl.clone().lerp(kr, 0.5);
    const keep = ['calf_l', 'foot_l', 'calf_r', 'foot_r'].map((n) => [n, wq(B[n])]);
    const R = new Quaternion().setFromAxisAngle(fl, f * 1.42);
    const pp = wp(B.pelvis).sub(pivot).applyQuaternion(R).add(pivot);
    setPelvisWorld(m, B, pp);
    setWQ(m, B.pelvis, R.clone().multiply(wq(B.pelvis)));
    for (const [n, q] of keep) setWQ(m, B[n], q);
    // the arms keep hanging toward the ground ahead of him (hands out to break the fall), not swung back with the torso
    for (const sd of ['l', 'r']) turn(m, B['upperarm_' + sd], fl, -0.75 * f);
  }
  if (L && e > 0) writeBlend(m, B, snap(B), L, e);
}

function victimFront(world, rec, m, B, M, F, t, g, L, out) {
  const H = rec.hit;
  const d = ramp(t, H - 0.04, H + 0.12);  // the blade in: he doubles over
  const fwd = F.l.clone();
  const feet = feetOf(B);
  if (d > 0) {
    const p0 = wp(B.pelvis);
    setPelvisWorld(m, B, p0.addScaledVector(F.u, -0.07 * d).addScaledVector(F.f, -0.07 * d));
    legsTo(m, B, F, feet);
  }
  const flinch = 0.05 * g;
  turn(m, B.spine_01, fwd, flinch + 0.22 * d);
  turn(m, B.spine_02, fwd, flinch + 0.26 * d);
  turn(m, B.spine_03, fwd, 0.2 * d);
  turn(m, B.neck_01, fwd, 0.1 * g + 0.12 * d);
  turn(m, B.Head, fwd, 0.08 * g + 0.22 * d);
  // pushed off the blade: the death clip (a crumple, then the fall back) takes over from here
  if (L && out > 0) writeBlend(m, B, snap(B), L, out);
}

/** The victim's hands on the attacker's forearms (after the attacker is posed). */
function victimHands(rec, vm, VB, am, AB, t) {
  const H = rec.hit, c = rec.close;
  const behind = rec.side === 'behind';
  const w = behind ? ramp(t, c - 0.06, c + 0.2) * (1 - ramp(t, H + 0.06, H + 0.36))
    : ramp(t, c - 0.06, c + 0.18) * (1 - ramp(t, H + 0.25, H + 0.45));
  if (w <= 1e-3) return;
  const F = frameOf(vm.root);
  const fore = (s, k) => wp(AB['lowerarm_' + s]).lerp(wp(AB['hand_' + s]), k);
  // from behind: left hand on the arm over his mouth, right on the knife arm's wrist; from the front: both on the
  // knife arm (left on the wrist, right on the forearm), clutching it as it goes in
  const tl = behind ? fore('l', 0.55) : fore('r', 0.8);
  const tr = behind ? fore('r', 0.6) : fore('r', 0.45).addScaledVector(F.l, -0.04);
  for (const [s, tgt] of [['l', tl], ['r', tr]]) {
    const ua = VB['upperarm_' + s], la = VB['lowerarm_' + s], ha = VB['hand_' + s];
    const side = s === 'l' ? 1 : -1;
    const pole = wp(ua).addScaledVector(F.l, 0.35 * side).addScaledVector(F.u, -0.45).addScaledVector(F.f, -0.1);
    // the palm (not the wrist) on the forearm
    const palm = wp(ha).lerp(wp(VB['middle_01_' + s] || ha), 0.55).sub(wp(ha));
    limbIK(vm, ua, la, ha, tgt.clone().sub(palm.multiplyScalar(0.8)), pole, w);
  }
}

// ------------------------------------------------------------------ attacker

/** Hand world rotation putting hand-local axis `ax` along world `d` and hand-local `bx` toward world `n`. */
function alignHand(ax, bx, d, n) {
  const basis = (z, y) => {
    const Z = z.clone().normalize(), Y = y.clone().addScaledVector(Z, -y.dot(Z));
    if (Y.lengthSq() < 1e-8) Y.set(0, 1, 0).addScaledVector(Z, -Z.y);
    Y.normalize();
    const X = new Vector3().crossVectors(Y, Z);
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
  };
  return basis(d, n).multiply(basis(ax, bx).invert());
}

function attacker(world, rec, m, B, M, vm, VB, VM, t) {
  const P = rec.plan, root = m.root, c = rec.close, H = rec.hit, E = rec.dur;
  const behind = rec.side === 'behind';
  const vis = rec.vis;
  // weight of the whole overlay over his own clip: in at the start, out after the action (quicker once he walks off:
  // his feet leave their contact stance)
  if (t > E && vis.walkAt == null && (rec.a.path || rec.a._moving)) vis.walkAt = t;
  const W = ramp(t, 0, 0.14) * (1 - ramp(t, E, E + KK.aOut)) * (vis.walkAt != null ? 1 - ramp(t, vis.walkAt, vis.walkAt + 0.1) : 1);
  const vF = frameOf(vm.root);
  // a deep pack on the victim's back (or webbing on either chest) keeps him a little further off than the sim's
  // contact distance: drawn back along the line, leaning over it
  const need = behind ? (-VM.backZ) + M.chestZ + 0.005 : VM.chestZ + M.chestZ - 0.05;   // face to face: pressed in a little
  const extra = clamp(need - P.dist, -0.08, 0.3);
  const wOff = ramp(t, 0, Math.max(0.06, c)) * (1 - ramp(t, E + 0.05, E + KK.aOut + 0.25)) * (vis.walkAt != null ? 1 - ramp(t, vis.walkAt, vis.walkAt + 0.3) : 1);
  const dir = new Vector3(P.to.x - P.v.x, 0, P.to.z - P.v.z).normalize();
  if (Math.abs(extra) > 1e-3 && wOff > 0) { root.position.addScaledVector(dir, extra * wOff); upd(root); }
  if (!vis.feet0) {   // the step starts from the pose he was shown in before the action (the stab clip's first frame jumps)
    vis.pose0 = m._preKnife || null; m._preKnife = null;
    if (vis.pose0) { const keep = capturePose(m); mixPose(m, vis.pose0, 1); upd(root); vis.feet0 = feetOf(B); mixPose(m, keep, 1); upd(root); }
    else vis.feet0 = feetOf(B);
  }
  if (W <= 1e-3) {
    if (t < E && vis.pose0) mixPose(m, vis.pose0, 1, m._guard);
    return;
  }
  const F = frameOf(root);
  const fwd = F.l.clone();              // + about his left axis = lean forward
  // feet: where the clip put them at the start of the step, and where the idle stance puts them at the contact spot
  const pre = capturePose(m);
  const idle = clipPose(m, 'idle', 0);
  if (idle) mixPose(m, idle, 1, m._guard);
  upd(root);
  // the idle stance at the contact spot (the step's end), carried over from where the root is drawn now
  const fin = new Vector3(P.to.x, 0, P.to.z).addScaledVector(dir, extra);
  fin.y = world.groundY ? world.groundY(fin.x, fin.z) + (rec.a.y || 0) : root.position.y;
  const qFin = new Quaternion().setFromAxisAngle(F.u, headingToRotY(P.to.h));
  const Tcur = root.matrixWorld.clone(), D = new Matrix4().compose(fin, qFin, new Vector3(1, 1, 1)).multiply(Tcur.clone().invert());
  const qD = qFin.clone().multiply(wq(root).invert());
  const feetEnd = feetOf(B);
  for (const sd of ['l', 'r']) { feetEnd[sd].p.applyMatrix4(D); feetEnd[sd].q.premultiply(qD); }
  if (world.groundY) for (const sd of ['l', 'r']) feetEnd[sd].p.y += world.groundY(feetEnd[sd].p.x, feetEnd[sd].p.z) - (fin.y - (rec.a.y || 0));
  // step targets: lead foot first, then the trail foot (lifted on an arc); after it, planted at the contact stance
  const step = Math.hypot(P.to.x - P.from.x, P.to.z - P.from.z) + Math.abs(extra) > 0.08;
  const feet = { l: { ...feetEnd.l }, r: { ...feetEnd.r } };
  if (step && t < c + 0.08) {
    const kL = smooth(t / Math.max(0.05, c * 0.68)), kR = ramp(t, c * 0.3, c + 0.05);
    for (const [sd, k] of [['l', kL], ['r', kR]]) {
      const a0 = vis.feet0[sd], a1 = feetEnd[sd];
      const p = a0.p.clone().lerp(a1.p, k).addScaledVector(F.u, KK.lift * Math.sin(Math.PI * clamp(k, 0, 1)));
      feet[sd] = { p, q: a0.q.clone().slerp(a1.q, k) };
    }
  }
  // the attacker's own crouch / lean
  const sagFollow = behind ? ramp(t, H + 0.02, H + 0.3) * (1 - ramp(t, E - 0.02, E + 0.2)) : 0;
  // a taller man (or one standing uphill) bends his knees to the victim's height: his shoulders a hand's breadth over
  // the victim's mouth (behind) / collar (front)
  const vRef = behind ? at(VB, 'Head', VM.mouth).y : wp(VB.upperarm_r).y;
  const tall = clamp(wp(B.upperarm_l).y - vRef - (behind ? 0.03 : 0.08), 0, 0.14) * ramp(t, c - 0.2, c + 0.05);
  const drop = 0.035 * ramp(t, c - 0.1, c + 0.05) + tall + 0.08 * sagFollow;
  const hipsBack = behind ? 0 : 0.07 * ramp(t, c - 0.1, H - 0.1);
  const pel = wp(B.pelvis).addScaledVector(F.u, -drop).addScaledVector(F.f, -hipsBack);
  setPelvisWorld(m, B, pel);
  rec.vis.drop = drop;
  // ---- hand targets on the victim's body as posed this frame
  const vRight = vF.l.clone().negate();
  const wl = ramp(t, c - 0.2, c + 0.06) * (1 - ramp(t, E - 0.02, E + 0.2));
  const wr = ramp(t, c - 0.22, c + 0.03) * (1 - ramp(t, E - 0.02, E + 0.22));
  const T = {};
  if (wl > 1e-3) {
    if (behind) {   // left palm over his mouth and chin, flat on his face, fingers across to his right
      const mouth = at(VB, 'Head', VM.mouth).lerp(at(VB, 'Head', VM.chin), 0.3);
      const hf = faceDir(VB, VM);
      const reach = 1 - ramp(t, c - 0.08, c + 0.02);
      T.l = { target: mouth.clone().addScaledVector(hf, 0.02).addScaledVector(vF.l, 0.2 * reach).addScaledVector(hf, 0.1 * reach),
        fDir: vRight.clone().addScaledVector(F.u, 0.1), nDir: hf.clone().negate(), pole: [0.55, -0.35, -0.1] };
    } else {        // left hand on his right collar, fingers over the shoulder
      const col = wp(VB.clavicle_r || VB.upperarm_r).lerp(wp(VB.upperarm_r), 0.55).addScaledVector(F.u, 0.06).addScaledVector(vF.f, 0.06);
      const reach = 1 - ramp(t, c - 0.08, c + 0.02);
      T.l = { target: col.addScaledVector(F.f, -0.18 * reach), fDir: F.u.clone().addScaledVector(F.f, 0.4), nDir: F.f.clone(), pole: [0.45, -0.5, -0.15] };
    }
    T.l.q = handQ(B, 'l', T.l.fDir, T.l.nDir);
    T.l.wrist = T.l.target.clone().sub(T.l.q.off.clone().applyQuaternion(T.l.q.q));
  }
  const knife = m.real.inner.weapon, tipS = knife?.visible !== false ? knife?.userData?.sockets?.tip : null, gripS = knife?.userData?.sockets?.grip_r;
  if (wr > 1e-3 && tipS) {
    const hq = wq(B.hand_r), hp = wp(B.hand_r), inv = hq.clone().invert();
    const tipOff = wp(tipS).sub(hp).applyQuaternion(inv);
    const ax = wp(tipS).sub(gripS ? wp(gripS) : hp).applyQuaternion(inv).normalize();
    const palmN = palmNormal(B, 'r').applyQuaternion(inv);
    let tip, d, n, pole;
    if (behind) {
      const th = at(VB, 'neck_01', VM.throat);
      const hf = VM.neckFwd.clone().applyQuaternion(wq(VB.neck_01)).setY(0).normalize();
      // round his right side to the front of his neck: the tip set at the front of the throat, driven in at the hit
      // (into the front of the neck, angled in toward the spine), then drawn across it to his left
      const u = ramp(t, c - 0.04, H - 0.1), inn = ramp(t, H - 0.08, H), past = ramp(t, H + 0.01, H + 0.14);
      d = vF.l.clone().addScaledVector(hf, -0.3).addScaledVector(F.u, -0.08).normalize();
      tip = th.clone().addScaledVector(d, -0.06 * (1 - inn) + 0.012 * inn).addScaledVector(vRight, 0.14 * (1 - u)).addScaledVector(hf, 0.08 * (1 - u))
        .addScaledVector(vF.l, 0.05 * past);
      n = vF.f.clone().negate().addScaledVector(F.u, -0.35);  // palm toward his throat (knuckles forward)
      pole = [-0.55, -0.3, -0.1];
    } else {
      // a low thrust in under his ribs from the attacker's right hip: the fist beside the bellies, the blade angled
      // forward, up and in to the middle (the tip in at his belly front, a little to his left)
      const belly = bellyTarget(VB, VM, vF);
      const wind = ramp(t, c - 0.12, H - 0.16) * (1 - ramp(t, H - 0.12, H - 0.01)), inn = ramp(t, H - 0.05, H);
      d = F.f.clone().multiplyScalar(0.55).addScaledVector(F.u, 0.4).addScaledVector(F.l, 0.75).normalize();
      tip = belly.clone().addScaledVector(d, -0.2 * wind + 0.035 * inn - 0.03 * (1 - inn) * (1 - wind)).addScaledVector(F.u, -0.03 * (1 - inn));
      n = F.l.clone().addScaledVector(F.u, 0.3);                 // palm inward (thumb up)
      pole = [-0.4, -0.45, -0.3];
    }
    const q = alignHand(ax, palmN, d, n);
    T.r = { tip, q, pole, wrist: tip.clone().sub(tipOff.clone().applyQuaternion(q)), tipS };
  }
  // ---- lean (and turn the shoulders) until both hands reach their targets
  const reachLen = 0.97 * M.arm;
  const short = () => Math.max(T.l ? wp(B.upperarm_l).distanceTo(T.l.wrist) - reachLen : 0, T.r ? wp(B.upperarm_r).distanceTo(T.r.wrist) - reachLen : 0);
  const spineLean = (x) => { turn(m, B.spine_01, fwd, x * 0.3); turn(m, B.spine_02, fwd, x * 0.35); turn(m, B.spine_03, fwd, x * 0.35); };
  // (face to face: his hips go back, the lean keeps his chest on the victim's)
  let lean = behind ? (0.05 + extra * 0.6) * ramp(t, 0, c + 0.05) : 0.06 * ramp(t, 0, c + 0.05) + 2.4 * hipsBack;
  spineLean(lean);
  // shoulders forward round him first (clavicles protracted), then the lean
  const hug = behind ? Math.max(wl, wr) : 0.5 * Math.max(wl, wr);
  turn(m, B.clavicle_l, F.u, -0.3 * hug); turn(m, B.clavicle_r, F.u, 0.3 * hug);
  // (the reach lean comes in with the hands, never ahead of them)
  let more = 0;
  for (let it = 0; it < 3 && (T.l || T.r); it++) {
    const over = short();
    if (over <= 0.004) break;
    const dm = clamp(over / 0.5, 0, 0.52 - lean - more);
    if (dm <= 1e-3) break;
    spineLean(dm); more += dm;
  }
  const wReach = Math.max(T.l ? wl : 0, T.r ? wr : 0);
  if (more > 0 && wReach < 0.999) spineLean(-more * (1 - wReach));
  lean += more * wReach;
  rec.vis.lean = lean; rec.vis.short = short();
  if (!behind) {
    turn(m, B.spine_03, F.u, 0.14 * ramp(t, H - 0.2, H)); // right shoulder into the thrust
    // face to face: his head past the victim's, over the victim's right shoulder (to his own left)
    const hb = ramp(t, c - 0.1, c + 0.05) * (1 - ramp(t, E - 0.02, E + 0.2));
    turn(m, B.neck_01, F.f, -0.16 * hb); turn(m, B.Head, F.f, -0.12 * hb); turn(m, B.Head, F.u, 0.3 * hb);
  }
  if (behind) {   // his head beside the victim's (the victim's head pulled back onto his left shoulder): to his right
    const hb = ramp(t, c - 0.1, c + 0.05) * (1 - ramp(t, E - 0.02, E + 0.2));
    turn(m, B.neck_01, F.f, 0.24 * hb); turn(m, B.Head, F.f, 0.18 * hb); turn(m, B.Head, F.u, -0.35 * hb);
    turn(m, B.neck_01, fwd, -0.12 * hb);
  }
  legsTo(m, B, F, feet);
  const poleAt = (s, p) => wp(B['upperarm_' + s]).addScaledVector(F.l, p[0]).addScaledVector(F.u, p[1]).addScaledVector(F.f, p[2]);
  if (T.l) limbIK(m, B.upperarm_l, B.lowerarm_l, B.hand_l, T.l.wrist, poleAt('l', T.l.pole), wl, T.l.q.q);
  if (T.r) {
    limbIK(m, B.upperarm_r, B.lowerarm_r, B.hand_r, T.r.wrist, poleAt('r', T.r.pole), wr, T.r.q);
    rec.vis.tipErr = wp(T.r.tipS).distanceTo(T.r.tip);
  }
  // blend the whole overlay over his own clip (in at the start, from the last pose shown before the action: the stab
  // clip's first frame jumps; out after the action)
  const src = t < E && vis.pose0 ? vis.pose0 : pre;
  if (W < 0.999 && src) mixPose(m, src, 1 - W, m._guard);
}

/** Where the blade goes in from the front: his belly front (spine_02 frame), a little to his left and up (under the ribs). */
const bellyTarget = (VB, VM, vF) => at(VB, 'spine_02', VM.belly).addScaledVector(vF.l, 0.07).add(new Vector3(0, 0.05, 0));

/** His face direction (world, tilted with his head). */
const faceDir = (B, M) => M.face.clone().applyQuaternion(wq(B.Head)).normalize();

/** Palm normal of hand s (world, out of the palm): fingers × (index → pinky) is the palm side of a UAL left hand and
 *  the back of a right hand (measured on the idle pose: the palms face the thighs). */
function palmNormal(B, s) {
  const h = wp(B['hand_' + s]), f = wp(B['middle_01_' + s] || B['hand_' + s]).sub(h).normalize();
  const side = wp(B['index_01_' + s] || B['hand_' + s]).sub(wp(B['pinky_01_' + s] || B['hand_' + s])).normalize();
  return new Vector3().crossVectors(f, side).normalize().multiplyScalar(s === 'l' ? 1 : -1);
}

/** World rotation of hand s with its fingers along fDir and its palm facing nDir; `off` = wrist → palm centre (hand frame). */
function handQ(B, s, fDir, nDir) {
  const h = B['hand_' + s], inv = wq(h).invert(), hp = wp(h);
  const mid = B['middle_01_' + s] || h;
  const fL = wp(mid).sub(hp).applyQuaternion(inv).normalize();
  const nL = palmNormal(B, s).applyQuaternion(inv);
  const off = wp(mid).sub(hp).multiplyScalar(0.55).applyQuaternion(inv).addScaledVector(nL, 0.012);
  return { q: alignHand(fL, nL, fDir, nDir), off };
}

// ------------------------------------------------------------------ measurement (tests / tools)

/**
 * Contact metrics of a kill as drawn now: torso (spine_03) horizontal distance, chest-to-back surface gap (behind) /
 * chest-to-chest gap (front), the attacker's left palm to the victim's mouth, the knife tip to his throat / belly.
 */
export function pairMetrics(a, v) {
  const am = a?.model, vm = v?.model;
  if (!realBody(am) || !realBody(vm)) return null;
  const AB = bonesOf(am), VB = bonesOf(vm), AM = contactMarks(am), VM = contactMarks(vm);
  const s3a = wp(AB.spine_03), s3v = wp(VB.spine_03);
  const hd = (p, q) => Math.hypot(p.x - q.x, p.z - q.z);
  const palm = wp(AB.hand_l).lerp(wp(AB.middle_01_l || AB.hand_l), 0.55);
  const mouth = at(VB, 'Head', VM.mouth), throat = at(VB, 'neck_01', VM.throat);
  const tipS = am.real.inner.weapon?.userData?.sockets?.tip, tip = tipS && am.real.inner.weapon.visible !== false ? wp(tipS) : null;
  const vr = vm.root, ar = am.root;
  const vF = frameOf(vr), aF = frameOf(ar);
  // surface gap along the line between the two roots, at chest height (the bodies as posed now): the attacker's chest
  // to the victim's back (from behind) / chest (from the front); < 0 = pressed in
  const line = new Vector3(ar.position.x - vr.position.x, 0, ar.position.z - vr.position.z);
  const dist = line.length(); line.normalize();
  const behindSide = line.dot(vF.f) < 0;
  const vSurf = at(VB, 'spine_03', behindSide ? VM.backPt : VM.chestPt), aSurf = at(AB, 'spine_03', AM.chestPt);
  const gap = aSurf.clone().sub(vSurf).dot(line);
  const belly = bellyTarget(VB, VM, vF);
  return {
    torso: hd(s3a, s3v), torso3d: s3a.distanceTo(s3v), gap, root: dist,
    palmMouth: palm.distanceTo(mouth), tipThroat: tip ? tip.distanceTo(throat) : null, tipBelly: tip ? tip.distanceTo(belly) : null,
    aFacing: Math.atan2(aF.f.z, aF.f.x), vFacing: Math.atan2(vF.f.z, vF.f.x),
  };
}
