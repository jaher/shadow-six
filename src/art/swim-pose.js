/**
 * The Marine in the water (user 2026-10-11 "the marine under water looks strange, it should fully swim inside the
 * water (no legs out) and he should be visible clearly when under water. The swimming should look more natural"),
 * and every man standing in it.
 *
 *  - wadeOffset: a man on a water / shallow cell stands on the BED, not on the surface: Entity.syncTransform puts
 *    the root at world.groundY, which is 0 over water (10 cm above the -0.1 surface: "he seems to stand on water").
 *  - swimFrame: a procedural pose written after the mixer (like art/turn-step.js, art/stair-gait.js) while the Marine
 *    swims or dives. Every pose is built from target directions in the BODY frame of his bind pose (X left, Y head,
 *    Z belly) — no clip, no rig-axis knowledge: each bone's world rotation is basis(P, S) · basis(P_bind, S_bind)⁻¹ ·
 *    bind, P the direction to its child, S a second reference (the knee / elbow front, the thumb, the instep).
 *      dive   prone and fully under water at a depth that keeps the back, the tank, the gun and the kicking fins
 *             under the surface and the belly and the fins off the bed (deeper in deep water); a flutter kick from
 *             the hips (knees flexing on the up-beat, fins whipping with the ankle), arms along the body, a gentle
 *             undulation, head up to look ahead; kick rate and amplitude follow the measured speed (a slow fin scull
 *             hovering); he banks into turns and the spine bends with them; pitches down going under and up surfacing
 *      swim   at the surface without the gear: breaststroke, head out of the water, the body riding up on the pull
 *      stand  idle at the surface where he can stand: on the bed, waist / chest deep, hands sculling at the surface
 *      tread  idle in deeper water (the M3 reservoir, the sea): treading water, eggbeater legs, sculling hands
 *      act    an action in the water (the harpoon shot, the knife, the gear on / off): the clip's upper body,
 *             standing on the bed or treading water ('act-tread')
 *    The kick / stroke rate follows his speed from the sim (Unit vx / vz), the bank and spine bend his turn rate.
 *    Modes cross-fade (a frozen-pose fade), the layer fades in / out against the mixer as he enters / leaves the
 *    water, and his height follows a spring (a quick pop-up to shoot, a slow sink back).
 * Pure view-side: the sim never reads any of it.
 * @module art/swim-pose
 */
import { Quaternion, Vector3, Matrix4, MathUtils } from 'three';
import { CONFIG } from '../config.js';

/** Fallback water level (art/water.js WATER_LEVEL) when the world has no water system (placeholder terrain). */
const LEVEL0 = -0.1;
const T_WATER = 5, T_SHALLOW = 6;
const D2R = Math.PI / 180;
/** Bones the layer writes (hierarchical order: parents first). */
const BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
const LEGS = new Set(['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);
/** Child each bone's primary axis points to (the head and the toes' tips: their own Y axis). */
const CHILD = { pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'Head', Head: null,
  clavicle_l: 'upperarm_l', upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l',
  clavicle_r: 'upperarm_r', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r',
  thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', ball_l: 'ball_leaf_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r', ball_r: 'ball_leaf_r' };
/** Gameplay speed of a swimmer / diver (m/s, design-spec §3.1) and the distance one stroke / kick cycle covers. */
const SWIM_V = 1.8, KICK_STRIDE = 1.4, STROKE_STRIDE = 2.2;
/** s: layer fade in / out against the mixer, and the mode cross-fade. */
const LAYER_FADE = 0.55, MODE_FADE = 0.45, ACT_FADE = 0.16;
/** Standing in the water: deeper than this (m) he treads water instead of standing on the bed. */
const STAND_DEPTH = 1.4;
/** Pelvis above the soles of a man standing (UAL bind 0.98 m, a slight knee bend). */
const STAND_PELVIS = 0.95;
/** Diving: the pelvis depth range (m below the surface) and the clearances it keeps. */
const DIVE_MIN = 0.62, DIVE_MAX = 1.1, BELLY = 0.18;
/** Above his hips (m, lying level): the fin tips at rest, and how much higher a full kick lifts them. */
const FIN_REST = 0.12, FIN_KICK = 0.3;
/** Kept between the highest part of him and the surface (m). */
const TOP_MARGIN = 0.08;

const _q = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion(), _m = new Matrix4();
const _v = new Vector3(), _e1 = new Vector3(), _e2 = new Vector3(), _e3 = new Vector3();
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const smooth = (x) => { const t = MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Rotation taking the unit axes X → P, Y → S ⟂ P (Gram-Schmidt), Z → P × S. */
function basis(P, S, out) {
  _e1.copy(P).normalize();
  _e2.copy(S).addScaledVector(_e1, -_e1.dot(S));
  if (_e2.lengthSq() < 1e-8) _e2.copy(Math.abs(_e1.y) < 0.9 ? Y : Z).addScaledVector(_e1, -_e1.dot(Math.abs(_e1.y) < 0.9 ? Y : Z));
  _e2.normalize();
  _e3.crossVectors(_e1, _e2);
  return out.setFromRotationMatrix(_m.makeBasis(_e1, _e2, _e3));
}

/**
 * Water under (x, z): {level, bed, deep} on a water / shallow cell that is not under a deck (a bridge, a raised
 * platform), else null. `bed` is the drawn terrain (the carved river bed), `level` the body's surface (a raised
 * reservoir's own, drawn down after a breach).
 */
export function waterColumn(world, x, z) {
  const g = world?.grid;
  if (!g?.terrain || !g.cell) return null;
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) return null;
  const k = j * g.cols + i, t = g.terrain[k];
  if (t !== T_WATER && t !== T_SHALLOW) return null;
  if (g.bridge?.[k] || (g.elev?.[k] || 0) > 0.05) return null;
  const T = world.terrain;
  if (typeof T?.heightAt !== 'function') return null;
  const bed = T.heightAt(x, z);
  if (!Number.isFinite(bed)) return null;
  // the drawn triangle can sit a few cm above the blended height on a sloping bank: a body lying there keeps off it
  const sf = typeof T.surfaceAt === 'function' ? T.surfaceAt(x, z) : bed;
  const s = world.water?.sample?.(x, z);
  return { level: s?.level ?? world.water?.level ?? LEVEL0, bed, top: Number.isFinite(sf) ? Math.max(bed, sf) : bed, deep: t === T_WATER };
}

/**
 * Before the model's update: a man on a wet cell stands (walks, crawls, kneels…) on the bed under the water instead of
 * on its surface (Entity.syncTransform puts him at world.groundY, 0 over water). Not aboard, carried, on a ladder, dead
 * (a body floats: physics), raised (a deck, a roof). @returns {number} the offset applied (m)
 */
export function wadeOffset(model, u) {
  const root = model.root, w = u?.world;
  let off = 0;
  if (u && w && u.alive !== false && !u.vehicle && u.state !== 'inVehicle' && u.state !== 'carried' && !u.carriedBy && !u._ladder && !((u.y || 0) > 0.05)) {
    const c = waterColumn(w, root.position.x, root.position.z);
    if (c) off = Math.min(0, c.bed - (typeof w.groundY === 'function' ? w.groundY(root.position.x, root.position.z) || 0 : 0));
  }
  if (off) root.position.y += off;
  model._wade = off;
  return off;
}

/** Bind-pose data of a body for the layer, once per built body. */
function rigOf(h) {
  if (h._swimRig !== undefined) return h._swimRig;
  const B = h.bones || {};
  const sk = h.object && (() => { let s = null; h.object.traverse((o) => { if (!s && o.isSkinnedMesh && o.skeleton) s = o.skeleton; }); return s; })();
  if (!sk || !BONES.every((n) => B[n]) || !B.root) return (h._swimRig = null);
  const bindP = {}, bindQ = {}, M = new Matrix4(), S = new Vector3();
  const need = new Set([...BONES, 'root', ...Object.values(CHILD).filter(Boolean), 'thumb_01_l', 'thumb_01_r']);
  sk.bones.forEach((b, i) => {
    if (!need.has(b.name) || bindP[b.name]) return;
    M.copy(sk.boneInverses[i]).invert();
    bindP[b.name] = new Vector3(); bindQ[b.name] = new Quaternion(); M.decompose(bindP[b.name], bindQ[b.name], S);
  });
  if (!BONES.every((n) => bindP[n] && (!CHILD[n] || bindP[CHILD[n]]))) return (h._swimRig = null);
  const R = { bones: {}, bindP, bindQ };
  for (const n of BONES) {
    const P = CHILD[n] ? bindP[CHILD[n]].clone().sub(bindP[n]) : Y.clone().applyQuaternion(bindQ[n]);
    // secondary: the instep for the foot / toes, the thumb for the forearm / hand, else the front (belly / face)
    let Sb = Z.clone();
    if (/^(foot|ball)_/.test(n)) Sb = Y.clone();
    else if (/^(lowerarm|hand)_/.test(n)) { const s = n.slice(-1); Sb = bindP['thumb_01_' + s] ? bindP['thumb_01_' + s].clone().sub(bindP['hand_' + s]) : Z.clone(); }
    const Bb = basis(P, Sb, new Quaternion());
    R.bones[n] = { b: B[n], parent: B[n].parent, C: Bb.clone().invert().multiply(bindQ[n]), len: CHILD[n] ? P.length() : 0,
      P: P.clone().normalize(), S: Sb.clone().addScaledVector(P.clone().normalize(), -Sb.dot(P.clone().normalize())).normalize() };
  }
  const L = (a, b) => bindP[a].distanceTo(bindP[b]);
  R.arm = { a: L('upperarm_l', 'lowerarm_l'), b: L('lowerarm_l', 'hand_l') };
  R.leg = { a: L('thigh_l', 'calf_l'), b: L('calf_l', 'foot_l') };
  R.hip = { l: bindP.thigh_l.clone().sub(bindP.pelvis), r: bindP.thigh_r.clone().sub(bindP.pelvis) };
  R.foot = L('foot_l', 'ball_l');
  R.pelvisH = bindP.pelvis.y;           // bind pelvis above the soles
  return (h._swimRig = R);
}

/** Two-bone IK in the body frame: root joint at `o`, segment lengths a, b, end target `t`, bend toward `pole`. */
const _k1 = new Vector3(), _k2 = new Vector3(), _k3 = new Vector3(), _f1 = new Vector3(), _f2 = new Vector3(), ORIGIN = new Vector3();
function ik2(o, a, b, t, pole, outP1, outP2) {
  const d = _k1.copy(t).sub(o);
  const D = MathUtils.clamp(d.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  d.normalize();
  const cosA = (a * a + D * D - b * b) / (2 * a * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const side = _k2.copy(pole).addScaledVector(d, -d.dot(pole));
  if (side.lengthSq() < 1e-8) side.copy(Z).addScaledVector(d, -d.z);
  side.normalize();
  const elbow = _k3.copy(o).addScaledVector(d, a * cosA).addScaledVector(side, a * sinA);
  outP1.copy(elbow).sub(o);
  outP2.copy(o).addScaledVector(d, D).sub(elbow);
  return outP1;
}

/** Rotate v about a body axis by angle a (in place). */
const rot = (v, axis, a) => v.applyQuaternion(_q3.setFromAxisAngle(axis, a));
const dir = (x, y, z) => new Vector3(x, y, z).normalize();

/** Bind foot: 64° from the shin toward the front; the toes another 30° (flat on the ground). */
const FOOT0 = 64 * D2R, TOES0 = 30 * D2R;
/**
 * Foot and toes (fins) from the shin direction `sh` and its front `fr`: plantar flexion pf (toes toward the shin
 * line: pointed), toe bend tb (+ toward the front), turn-out to (about the shin, + outward; side sign sg).
 */
function footDirs(T, s, sh, fr, pf, tb, to = 0) {
  const fo = T['foot_' + s], ba = T['ball_' + s], sg = s === 'l' ? 1 : -1;
  const sv = _f2.copy(sh).normalize(), f = _f1.copy(fr).addScaledVector(sv, -sv.dot(fr)).normalize();
  const th = FOOT0 - pf, tt = th + TOES0 + tb;
  fo[0].copy(sv).multiplyScalar(Math.cos(th)).addScaledVector(f, Math.sin(th));
  fo[1].copy(sv).multiplyScalar(-Math.sin(th)).addScaledVector(f, Math.cos(th));
  ba[0].copy(sv).multiplyScalar(Math.cos(tt)).addScaledVector(f, Math.sin(tt));
  ba[1].copy(sv).multiplyScalar(-Math.sin(tt)).addScaledVector(f, Math.cos(tt));
  if (to) for (const v of [fo[0], fo[1], ba[0], ba[1]]) v.applyAxisAngle(sv, sg * to);
}

/**
 * A leg from hip flexion al (knee toward the belly, +Z), abduction ab (outward), knee flexion be (shin toward the
 * back, −Z), plantar flexion pf (pointed toes), toe / fin bend tb.
 */
function legDirs(T, s, al, ab, be, pf, tb, to = 0) {
  const th = T['thigh_' + s], ca = T['calf_' + s], sg = s === 'l' ? 1 : -1;
  th[0].set(0, -1, 0); th[1].set(0, 0, 1);
  rot(th[0], X, -al); rot(th[1], X, -al);
  ca[0].set(0, -1, 0); ca[1].set(0, 0, 1);
  rot(ca[0], X, be - al); rot(ca[1], X, be - al);
  for (const v of [th, ca]) { rot(v[0], Z, sg * ab); rot(v[1], Z, sg * ab); }
  footDirs(T, s, ca[0], ca[1], pf, tb, to);
}

/** Arm by IK: hand target `t` relative to the shoulder (body frame), elbow pole, thumb direction. */
function armDirs(T, R, s, t, pole, thumb, handDir) {
  const ua = T['upperarm_' + s], la = T['lowerarm_' + s], ha = T['hand_' + s];
  ik2(ORIGIN, R.arm.a, R.arm.b, t, pole, ua[0], la[0]);
  ua[1].copy(pole);                       // the elbow folds toward the pole
  la[1].copy(thumb); ha[1].copy(thumb);
  ha[0].copy(handDir || la[0]);
}

/** Fresh direction table {bone: [P, S]} (reused per model). */
function table(st) {
  if (st.T) return st.T;
  const T = {};
  for (const n of BONES) T[n] = [new Vector3(), new Vector3()];
  return (st.T = T);
}

/** Spine / neck / head / clavicles from the bind pose, each joint turned about the lateral axis (u: + toward the
 *  belly), bent sideways (bend: + toward the right) and twisted (about the long axis); neck / head: tilt (− back). */
function spineDirs(T, R, u = [0, 0, 0, 0], neck = 0, head = 0, bend = 0, twist = 0) {
  const sp = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'];
  const ux = [u[0], u[1], u[2], u[3], neck, head], bz = [0, bend / 3, bend * 2 / 3, bend, bend * 1.3, bend * 1.6], ty = [0, twist / 3, twist * 2 / 3, twist, twist * 1.2, twist * 1.4];
  for (let i = 0; i < sp.length; i++) {
    const t = T[sp[i]], B = R.bones[sp[i]];
    t[0].copy(B.P); t[1].copy(B.S);
    for (const v of t) { rot(v, X, ux[i]); rot(v, Z, bz[i]); rot(v, Y, ty[i]); }
  }
  for (const s of ['l', 'r']) { const c = T['clavicle_' + s], B = R.bones['clavicle_' + s]; c[0].copy(B.P); c[1].copy(B.S); }
}

// ---------------------------------------------------------------------------------------------------------- poses

/** Thumb direction keys {u: [x (× side), y, z]} and a cyclic key lookup (smoothstep between keys). */
function keyAt(K, u, out) {
  u -= Math.floor(u);
  let i = K.length - 1;
  for (let k = 0; k < K.length; k++) if (K[k][0] <= u) i = k;
  const a = K[i], b = K[(i + 1) % K.length], ua = a[0], ub = i + 1 < K.length ? b[0] : 1 + K[0][0];
  const t = smooth(((u < ua ? u + 1 : u) - ua) / Math.max(1e-3, ub - ua));
  return out.set(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
}

/**
 * Diver: prone, flutter kick. k = kick amplitude 0..1, ph = kick phase, bend = sideways spine bend into a turn,
 * room = 1 in water deep enough for a full kick, → 0.1 in 25 cm shallows (he lies flat along the bottom there: legs
 * and fins down along it, head low).
 */
function poseDive(R, T, k, ph, bend, room = 1) {
  const und = 2 * D2R * (0.4 + k), low = 1 - room;
  spineDirs(T, R, [und * Math.sin(2 * ph), und * Math.sin(2 * ph - 0.7), und * Math.sin(2 * ph - 1.4), und * 0.6 * Math.sin(2 * ph - 2.1)],
    -(22 - 6 * low) * D2R, -(44 + 10 * low) * D2R, bend);
  // arms streamlined along the body, hands by the thighs (thumbs to the belly), swaying a little with the body
  for (const s of ['l', 'r']) {
    const sg = s === 'l' ? 1 : -1, sw = 0.015 * Math.sin(2 * ph + (s === 'l' ? 0 : 1));
    armDirs(T, R, s, _v.set(sg * (-0.01 + sw), -0.49, 0.15), dir(sg * 0.15, 0, 1), dir(-sg * 0.3, 0, 1), dir(-sg * 0.04, -1, 0.15));
  }
  for (const s of ['l', 'r']) {
    const p = ph + (s === 'l' ? 0 : Math.PI);
    const al = 10.5 * D2R * k * Math.sin(p) + (2 + 6 * low) * D2R;
    // the knee flexes on the up-beat (thigh going back) and whips straight on the down-beat
    const be = (5 + 23 * Math.pow(0.5 + 0.5 * Math.cos(p - 1.5 * Math.PI + 0.35), 1.6) * k) * D2R;
    // the fin bends with the water: more pointed on the down-beat, less on the up-beat, the blade lagging
    const pf = (70 + 12 * k * Math.cos(p)) * D2R, tb = (-26 + 10 * low + 12 * k * Math.cos(p - 0.6)) * D2R;
    legDirs(T, s, al, 1.5 * D2R, be, pf, tb);
  }
}

/** Breaststroke (u = stroke phase 0..1): hand path / thumb per side, ankle path relative to the hip. */
const ARM_KEYS = [[0, 0.11, 0.5, 0.19], [0.14, 0.24, 0.45, 0.2], [0.3, 0.4, 0.28, 0.24], [0.43, 0.2, 0.08, 0.32], [0.53, 0.05, 0.14, 0.28],
  [0.68, 0.07, 0.4, 0.22], [0.82, 0.11, 0.5, 0.19]];
const THUMB_KEYS = [[0, 1, 0.1, 0], [0.14, 0.3, 0, -1], [0.3, 0, 0.2, -1], [0.43, -0.3, 0.6, -0.6], [0.53, -0.2, 0.2, -1], [0.68, 0.4, 0.2, -0.8], [0.82, 1, 0.1, 0]];
const LEG_KEYS = [[0, 0.07, -0.88, -0.02], [0.44, 0.07, -0.88, -0.03], [0.58, 0.17, -0.56, -0.19], [0.7, 0.3, -0.62, -0.13],
  [0.82, 0.18, -0.84, -0.04], [0.92, 0.07, -0.88, -0.02]];
function poseSwim(R, T, u, bend) {
  const pull = Math.sin(Math.PI * MathUtils.clamp((u - 0.14) / 0.42, 0, 1));          // the body rides up on the pull
  spineDirs(T, R, [-4 * D2R * pull, -3 * D2R * pull, -2 * D2R * pull, 0], -(30 + 8 * pull) * D2R, -(40 + 6 * pull) * D2R, bend);
  for (const s of ['l', 'r']) {
    const sg = s === 'l' ? 1 : -1;
    const t = keyAt(ARM_KEYS, u, new Vector3()); t.x *= sg;
    const th = keyAt(THUMB_KEYS, u, new Vector3()); th.x *= sg;
    armDirs(T, R, s, t, dir(sg * 0.8, 0.15, -0.45), th, null);
  }
  for (const s of ['l', 'r']) {
    const sg = s === 'l' ? 1 : -1;
    const t = keyAt(LEG_KEYS, u, new Vector3()); t.x *= sg;
    const th = T['thigh_' + s], ca = T['calf_' + s];
    ik2(ORIGIN, R.leg.a, R.leg.b, t, dir(sg * 0.45, 0, 1), th[0], ca[0]);
    th[1].set(sg * 0.45, 0, 1); ca[1].set(sg * 0.35, 0, 1);
    // feet: pointed through the glide, flexed and turned out for the whip
    const flex = smooth((u - 0.6) / 0.08) * (1 - smooth((u - 0.82) / 0.08)), rec = smooth((u - 0.46) / 0.1) * (1 - flex);
    footDirs(T, s, ca[0], ca[1], (66 - 16 * rec - 56 * flex) * D2R, (-26 + 20 * flex) * D2R, 35 * D2R * flex);
  }
  return pull;
}

/** Upright in the water: treading (no bed: eggbeater legs) or standing on the bed; the arms scull at the surface. */
function poseUpright(R, T, ph, tread) {
  spineDirs(T, R, [0, 0, 0, 0], 3 * D2R, -4 * D2R, 0);
  for (const s of ['l', 'r']) {
    const sg = s === 'l' ? 1 : -1, sc = Math.sin(ph * 2 + (s === 'l' ? 0 : Math.PI));
    armDirs(T, R, s, _v.set(sg * (0.3 + 0.06 * sc), -0.3, 0.26 + 0.03 * Math.cos(ph * 2)), dir(sg * 0.6, -0.5, 0.6),
      dir(-sg, 0.25 * sc, 0.25), dir(sg * 0.35, -0.15, 1));
  }
  for (const s of ['l', 'r']) {
    const p = ph + (s === 'l' ? 0 : Math.PI);
    if (tread) legDirs(T, s, (50 + 12 * Math.sin(p)) * D2R, 14 * D2R, (80 + 22 * Math.sin(p + Math.PI / 2)) * D2R, 25 * D2R, -20 * D2R);
    else legDirs(T, s, (2 + 1.5 * Math.sin(p)) * D2R, 2 * D2R, 5 * D2R, 0, 0);
  }
}

/** The fin blade beyond the ball of the foot (marine_diver: 0.29 m) + its thickness. */
const FIN_LEN = 0.3, FIN_THICK = 0.04;
const _ft = new Vector3(), _fq = new Quaternion();
/**
 * Height of the higher fin tip above the hips for the pose in T (body frame) laid out by the body rotation `Mq`
 * (the model's yaw does not change a height): forward kinematics on the bind segment lengths.
 */
function finTop(R, T, Mq) {
  let top = -Infinity;
  for (const s of ['l', 'r']) {
    _ft.copy(R.hip[s]).addScaledVector(T['thigh_' + s][0], R.leg.a).addScaledVector(T['calf_' + s][0], R.leg.b)
      .addScaledVector(T['foot_' + s][0], R.foot).addScaledVector(T['ball_' + s][0], FIN_LEN);
    top = Math.max(top, _ft.applyQuaternion(Mq).y);
  }
  return top + FIN_THICK;
}

// ---------------------------------------------------------------------------------------------------------- driver

/** Body orientation in the model frame: the standing bind body laid down (head forward, belly down) when `lay` is
 *  1, pitched up by `pitch` and rolled by `bank` about its long axis; upright (leaning forward by `lean`) at 0. */
const _bq = new Quaternion();
function bodyQuat(lay, pitch, bank, lean, out) {
  _bq.setFromAxisAngle(X, lay * (Math.PI / 2 - pitch) + (1 - lay) * lean);
  return out.setFromAxisAngle(Z, bank * lay).multiply(_bq);
}

/** Gameplay anims that are not an action in the water (the swim / dive locomotion, idling). */
const NOT_ACTION = /^(swim|dive|idle|walk|run|crawl|crawl_idle)$/;

/** The Marine's water mode (null = out of the water: layer off). */
function modeOf(model, u, col, speed) {
  if (!u || u.alive === false || u.vehicle || u.state === 'inVehicle' || u.state === 'carried' || !col) return null;
  const stance = u.stance;
  if (stance !== 'swim' && stance !== 'dive') return null;
  const deep = col.level - col.bed > STAND_DEPTH;
  if (model.anim && !NOT_ACTION.test(model.anim)) return deep ? 'act-tread' : 'act';
  if (stance === 'dive' && u.underwater) return 'dive';
  if (speed > 0.25) return 'swim';
  return deep ? 'tread' : 'stand';
}

const newSnap = () => Object.fromEntries([...BONES.map((n) => [n, new Quaternion()]), ['pelvisPos', new Vector3()]]);
const copySnap = (to, from) => { for (const n of BONES) to[n].copy(from[n]); to.pelvisPos.copy(from.pelvisPos); return to; };

/**
 * The swim layer, after the mixer and the other pose layers (UnitModel.update), for a body that has the water rig.
 * @param {object} model UnitModel @param {number} dt displayed-frame delta (0 while paused) @param {object} [guard]
 *   BoneGuard: every written bone is touched first @returns {boolean} the pose was written
 */
export function swimFrame(model, dt, guard) {
  const u = model.unit, h = model.real?.inner;
  if (!u || !h || model.dog) return false;
  const st = model._swim || (model._swim = { w: 0, mode: null, ph: 0, v: 0, turn: 0, y: null, vy: 0, fade: null, bank: 0, pitch: 0, amp: 0.2, out: null });
  const root = model.root, w = u.world;
  // his speed and turn rate (+ right) from the sim's last tick (Unit vx / vz, heading): what the shown body does
  // between ticks too (interpolated), whatever the render cadence
  if (dt > 0) {
    const v = Number.isFinite(u.vx) ? Math.hypot(u.vx, u.vz || 0) : 0;
    st.v += (Math.min(v, 4) - st.v) * Math.min(1, dt * 6);
    const tr = Number.isFinite(u.prevHeading) ? wrapPi(u.heading - u.prevHeading) / CONFIG.sim.dt : 0;
    st.turn += (MathUtils.clamp(tr, -3, 3) - st.turn) * Math.min(1, dt * 4);
  }
  const col = waterColumn(w, root.position.x, root.position.z);
  const mode = modeOf(model, u, col, st.v);
  if (!mode && st.w <= 0) {
    st.mode = null; st.y = null; st.fade = null; st.submerged = false; st.out = null;
    if (st.noShadow) shadowsOff(model, st, false);
    return false;
  }
  const R = rigOf(h);
  if (!R) return false;
  seedBackHold(h, R);
  if (dt > 0) st.w = MathUtils.clamp(st.w + Math.sign((mode ? 1 : 0) - st.w) * dt / LAYER_FADE, 0, 1);
  if (mode && mode !== st.mode) {
    if (st.mode && st.out) st.fade = { from: copySnap(st.snap || (st.snap = newSnap()), st.out), t: 0, dur: /^act/.test(mode) || /^act/.test(st.mode) ? ACT_FADE : MODE_FADE };
    st.mode = mode;
  }
  const shown = st.mode || 'stand';
  const level = col?.level ?? st.level ?? LEVEL0, bed = col?.bed ?? st.bed ?? level - 1.2;
  st.level = level; st.bed = bed;
  const depth = level - bed, v = st.v, tread = shown === 'tread' || shown === 'act-tread';
  // phase: kicks / strokes follow the measured speed (no glide); a slow scull at rest
  const f = shown === 'dive' ? Math.max(0.42, v / KICK_STRIDE) : shown === 'swim' ? Math.max(0.5, v / STROKE_STRIDE) : tread ? 0.75 : 0.35;
  if (dt > 0) st.ph = (st.ph + 2 * Math.PI * f * dt) % (Math.PI * 400);
  const ampT = shown === 'dive' ? MathUtils.clamp(0.22 + 0.78 * v / SWIM_V, 0, 1) : 1;
  if (dt > 0) st.amp += (ampT - st.amp) * Math.min(1, dt * 3);
  const fx = Math.sin(root.rotation.y), fz = Math.cos(root.rotation.y);   // model forward (+Z) in the world
  const T = table(st);
  let lay = 1, yT, kick = st.amp;
  if (shown === 'dive') {
    // the shallowest water under the body (head ~1 m ahead, fins ~1.3 m behind): no fin or head through the bank
    let top = col?.top ?? bed;
    for (const a of [1.0, 0.5, -0.6, -1.3]) { const c = waterColumn(w, root.position.x + fx * a, root.position.z + fz * a); if (c) top = Math.max(top, c.top - (c.level - level)); }
    const shallow = level - top;
    const d = MathUtils.clamp(DIVE_MIN + 0.12 * Math.max(0, shallow - 1.1), DIVE_MIN, DIVE_MAX);
    // as deep as the water lets him, never into the bed: belly (the breathing bag) and the down-kick clear of it; in
    // 25 cm shallows his back reaches the surface — the water pass draws the surface over him (WaterPass mask)
    // (and deep enough that the highest fin tip of the last kicks stays under: st.finMax, measured on the pose)
    const kRoom = MathUtils.clamp((shallow - 0.45) / 0.5, 0.1, 1);   // a full kick needs ~1 m of water
    if (dt > 0 || st.room == null) st.room = st.room == null ? kRoom : st.room + (kRoom - st.room) * Math.min(1, dt * 3);
    yT = Math.max(Math.min(level - d, level - TOP_MARGIN - (st.finMax ?? FIN_REST + FIN_KICK)), top + BELLY + 0.12 * kRoom);
    // the kick only as big as the water over him allows (fins never out), smaller in shallows (fins off the bed)
    const yNow = st.y ?? yT;
    kick = Math.min(st.amp, kRoom, MathUtils.clamp((level - TOP_MARGIN - yNow - FIN_REST) / FIN_KICK, 0.1, 1), st.kickCap ?? 1);
  } else if (shown === 'swim') yT = level - 0.12;
  else { lay = 0; yT = tread ? level - 0.42 : bed + STAND_PELVIS; }
  rootBoneWorld(h);
  const pelMix = h.bones.root.localToWorld((st.pelMix || (st.pelMix = new Vector3())).copy(h.bones.pelvis.position));   // the mixer's hips
  if (st.y == null) { st.y = MathUtils.clamp(pelMix.y, bed + 0.12, level + 1); st.vy = 0; }
  if (dt > 0) {
    // spring: a quick pop-up for an action (the harpoon fires 0.2 s after the order), a slower sink / rise otherwise
    const om = /^act/.test(shown) ? 20 : st.y > yT ? 4.2 : 5.5, h1 = Math.min(dt, 0.05);
    st.vy += (om * om * (yT - st.y) - 2 * om * st.vy) * h1; st.y += st.vy * h1;
  }
  let pitchT = lay ? MathUtils.clamp(Math.atan2(st.vy, Math.max(0.6, v)) * 0.9, -0.6, 0.55) + (shown === 'swim' ? 20 * D2R : 3 * D2R) : 0;
  let pMin = -1, pMax = 1;
  if (shown === 'dive') {   // going down / coming up near the surface: no head-down pitch lifting the fins out, no head out
    const room = level - TOP_MARGIN - st.y;
    pMin = -Math.asin(MathUtils.clamp((room - FIN_REST - FIN_KICK * kick) / 1.25, 0, 0.5));
    pMax = Math.asin(MathUtils.clamp((room - 0.2) / 0.85, 0, 0.5));
    pitchT = MathUtils.clamp(pitchT, pMin, pMax);
  }
  const bankT = lay ? MathUtils.clamp(st.turn * Math.max(0.4, v) * 0.32, -0.45, 0.45) : 0;
  if (dt > 0) { st.pitch += (pitchT - st.pitch) * Math.min(1, dt * 4); st.bank += (bankT - st.bank) * Math.min(1, dt * 3); }
  st.pitch = MathUtils.clamp(st.pitch, pMin, pMax);
  const bend = lay ? MathUtils.clamp(st.turn * 0.12, -0.18, 0.18) : 0;
  let rise = 0;
  if (shown === 'dive') {
    poseDive(R, T, kick, st.ph, bend, st.room ?? 1);
    // the fins' reach over the kick cycle (a slowly decaying max) sets the depth; where the water is too shallow
    // for it, the kick shrinks until the fins stay under
    const ft = finTop(R, T, bodyQuat(1, st.pitch, st.bank, 0, _fq));
    st.finMax = Math.max(ft, (st.finMax ?? ft) - dt * 0.1);
    const over = st.y + ft - (level - TOP_MARGIN);
    if (dt > 0) st.kickCap = MathUtils.clamp((st.kickCap ?? 1) + (over > 0 ? -dt * 4 : dt * 0.5), 0.1, 1);
  }
  else if (shown === 'swim') rise = poseSwim(R, T, st.ph / (2 * Math.PI), bend);
  else poseUpright(R, T, st.ph, tread);
  // an action in the water: the clip's upper body (and hips); its legs too when he stands on the bed
  const act = /^act/.test(shown), actLegs = shown === 'act';
  const keep = (n) => (act && !LEGS.has(n)) || (actLegs && LEGS.has(n));
  // ------------------------------------------------------------------ world rotations → locals
  const QM = h.object.getWorldQuaternion(_q).multiply(bodyQuat(lay, st.pitch, st.bank, 5 * D2R, _q2));
  const qRoot = h.bones.root.getWorldQuaternion(st.qRoot || (st.qRoot = new Quaternion()));
  const Qw = st.Qw || (st.Qw = {}), out = st.cur || (st.cur = newSnap());
  for (const n of BONES) {
    const R0 = R.bones[n], b = R0.b, pq = n === 'pelvis' ? qRoot : Qw[b.parent.name];
    const qw = Qw[n] || (Qw[n] = new Quaternion());
    if (keep(n)) { out[n].copy(b.quaternion); qw.copy(pq).multiply(b.quaternion); continue; }
    const t = T[n];
    qw.copy(QM).multiply(basis(t[0], t[1], _q3)).multiply(R0.C);
    out[n].copy(pq).invert().multiply(qw);
  }
  // hips: lying, a little behind the unit's spot (his chest over it); the spring's height (+ a ride up on the pull)
  if (actLegs) out.pelvisPos.copy(h.bones.pelvis.position);
  else {
    if (act) _v.set(pelMix.x, st.y, pelMix.z);
    else _v.set(root.position.x - fx * 0.12 * lay, st.y + (shown === 'swim' ? 0.035 * rise : 0) + (shown === 'dive' ? 0.01 * Math.sin(2 * st.ph) : 0), root.position.z - fz * 0.12 * lay);
    h.bones.root.worldToLocal(out.pelvisPos.copy(_v));
  }
  // mode cross-fade from the last pose shown
  if (st.fade) {
    st.fade.t += dt;
    const k = smooth(st.fade.t / st.fade.dur), F = st.fade.from;
    for (const n of BONES) out[n].copy(F[n]).slerp(out[n], k);
    out.pelvisPos.lerpVectors(F.pelvisPos, out.pelvisPos, k);
    if (k >= 1) st.fade = null;
  }
  st.out = out;
  // blend against the mixer by the layer weight
  const wt = smooth(st.w);
  for (const n of BONES) {
    const b = R.bones[n].b;
    guard?.touch(b);
    if (wt >= 1) b.quaternion.copy(out[n]); else b.quaternion.slerp(out[n], wt);
  }
  const pb = h.bones.pelvis;
  guard?.touch(pb);
  if (wt >= 1) pb.position.copy(out.pelvisPos); else pb.position.lerp(out.pelvisPos, wt);
  // shown state: under the water and laid down (the water pass draws him as submerged), depth of the hips
  st.submerged = shown === 'dive' && wt > 0.6 && st.y < level - 0.02;
  // under water no hard shadow on the bed (as the fish, render/ambient-life.js: the shadow map ignores refraction —
  // the underwater sun is far steeper, its shadows soft)
  if (st.submerged !== !!st.noShadow) shadowsOff(model, st, st.submerged);
  st.depth = level - st.y;
  return true;
}

/**
 * The long gun's 'back' hold (pipeline/weapons.js solve: flat across the back) is solved in the body's root frame,
 * i.e. for an upright man; solved on a body lying in the water it came out different at every re-solve (the gun
 * flipped on his back while he swam). ca_runtime keeps an upright solve per hold (h._homeCache) and reuses it on a
 * lying body: seed it with the solve on the bind pose (upright) before the first one is made lying down.
 */
function seedBackHold(h, R) {
  const w = h.weapon, name = h.weaponName;
  if (!w || !name || !R.bindP.spine_03) return;
  const c = h._homeCache || (h._homeCache = {}), key = name + ':back';
  if (c[key] || !h.bones.spine_03) return;
  const s3 = R.bindP.spine_03, s3q = R.bindQ.spine_03;
  const z = new Vector3(-1, 0.35, 0).normalize(), up = new Vector3(0, 0, -1);
  const y = up.clone().addScaledVector(z, -up.dot(z)).normalize(), x = new Vector3().crossVectors(y, z);
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  const g = w.userData?.sockets?.grip_r ? w.userData.sockets.grip_r.position : new Vector3();
  const pos = s3.clone().add(new Vector3(0.05, 0.02, -0.17)).sub(g.clone().applyQuaternion(q));
  const M = new Matrix4().compose(pos, q, new Vector3(1, 1, 1)).premultiply(new Matrix4().compose(s3, s3q, new Vector3(1, 1, 1)).invert());
  c[key] = { parent: h.bones.spine_03, local: M };
}

/** Turn the shadow casting of his drawn meshes off (submerged) or back to what it was. */
function shadowsOff(model, st, off) {
  if (off) {
    st.shadowWas = [];
    model.root.traverse((o) => { if (o.isMesh && o.castShadow) { st.shadowWas.push(o); o.castShadow = false; } });
  } else {
    for (const o of st.shadowWas || []) o.castShadow = true;
    st.shadowWas = null;
  }
  st.noShadow = off;
}

/** World matrices from the body's object down to its root bone (the mixer's pose is read in world space). */
function rootBoneWorld(h) { h.bones.root.updateWorldMatrix(true, false); }

/** Is this model's shown body under the water (diving, laid down, below the surface)? */
export function shownSubmerged(model) { return !!model?._swim?.submerged; }
