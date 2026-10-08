/**
 * The Spy's hands-on actions, drawn (abilities/spy-actions.js; user 2026-10-07: "The animation of the spy grabbing
 * clothes or injecting poison should be as realistic as possible"). Visual only: a post pass over the skeletons after
 * every model's own update (Game.render → spyActionsFrame, after the knife pass), through each model's BoneGuard
 * (pose-blend.js), so the mixer takes over again cleanly the frame the pass stops. Everything is a function of the sim
 * record and the interpolated sim time, plus the garment cloths stepped on that clock: deterministic stepping draws the
 * same frames.
 *
 *  INJECTION, FROM BEHIND  the step in to chest-on-back contact (leg IK, lead foot then trail foot) while her right hand
 *    takes the syringe out of her inside breast pocket; her left palm clamps over his mouth and nose and pulls his head
 *    back onto her left shoulder (his throat's right side bared), her right fist brings the needle round to the side of
 *    his neck — the point at the carotid, driven in 12 mm — and her thumb presses the plunger home; he stiffens (back
 *    arched, head jerked), grabs at her forearms, kicks and shakes, goes limp; her arms go under his armpits and she
 *    lowers him — knees giving, sitting, laid back (key poses built on his own skeleton, blended in world space) — onto
 *    his back as she steps back and goes down on one knee behind his head; she lets go, stands, and puts the syringe
 *    back in her pocket. He ends exactly in the pose the mixer shows of his corpse (the 'dead' clip at the sim's corpse
 *    spot), so the settle ragdoll takes over as for any man who fell on his back. Let go early (a move order after the
 *    kill): he slumps into the death clip at once.
 *  INJECTION, FROM THE FRONT  her left hand on his collar, the needle into the left side of his neck at a forearm's
 *    length; he clutches her wrist, struggles, goes limp and crumples while she holds his collar with both hands, then
 *    she lets him go and the death clip (the fall back) takes over from the crumple.
 *  UNIFORM FROM A CLOTHESLINE  both hands to the near corners of the tunic and the trousers (each garment's Verlet cloth
 *    pinned to the palm from then on), the pegs popping one after the other, the two rolled up under her left arm, the
 *    officer's cap lifted off its peg and handed to her left hand; the side-shuffle behind the shirt / the towel (ducking
 *    under the line if that is the other side); then the dressing: her own cap off (the outfit's own headgear mesh as a
 *    loose prop) and into the bundle, the officer's cap from her left hand onto her head (seated exactly where the
 *    disguise's cap sits, which then shows), the tunic out of the bundle by its collar (a cloth hanging from her hand),
 *    shaken out and swung round her back, her arms into the sleeves — the outfit changes there (the sim's swap) — the
 *    buttons, a tug at the hem, a touch to the visor.
 *  UNIFORM FROM THE KIT (U)  the bundle from behind her right hip under her left arm, the cap off it into her left
 *    hand, then the same dressing.
 *
 * Measurements for tests and tools: injectMetrics() (needle point to the carotid point, palm to the mouth, chest-to-back
 * gap, the plunger), dressMetrics() (hands to the garments, which garments are still on the line, the props).
 * @module art/spy-actions
 */
import * as THREE_REF from 'three';
import { Vector3, Quaternion, Matrix4, Object3D } from 'three';
import { clipPose, capturePose, mixPose } from './pose-blend.js';
import { headingToRotY, lerpAngle } from '../core/math.js';
import { realBody, contactMarks, setWQ, turn, setPelvisWorld, snap, writeBlend, limbIK, frameOf, legsTo, feetOf, alignHand,
  palmNormal, handQ, at, wp, wq, faceDir, finish } from './knife-kill.js';
import { setSyringeFill, TIP_Z } from './syringe-prop.js';
import { makeGarment as makeGarmentRef, makeOfficerCap as makeOfficerCapProp, hangCap, LAUNDRY } from './clothesline.js';
import { lineFrame } from '../abilities/spy-actions.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-6, b - a));
const bump = (t, a, b) => { const x = clamp((t - a) / Math.max(1e-6, b - a), 0, 1); return Math.sin(Math.PI * x); };
const BASE_UMW = Object3D.prototype.updateMatrixWorld;
const upd = (o) => BASE_UMW.call(o, true);
const bonesOf = (m) => m?.real?.inner?.bones || null;
const lerpRot = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

/** Visual timeline constants (s, relative to the record's own times). */
export const SA = Object.freeze({
  aIn: 0.12,         // the overlay blends in over the pre-action pose
  aOut: 0.3,         // …and out after the action
  pocket: [0.0, 0.07, 0.11],  // right hand to the breast pocket, the syringe out, the hand away
  vEndBehind: 1.25,  // victim drawn this long after the hit at most (behind: on his back by then)
  vEndFront: 0.95,
});

// ------------------------------------------------------------------ the pass

/**
 * Pose every Spy action under way (Game.render, after the knife pass).
 * @param {object} world @param {number} [alpha] sim interpolation of this frame @param {number} [simDt]
 */
export function spyActionsFrame(world, alpha = 1, simDt = 1 / 60) {
  const list = world?.spyActs;
  if (!list?.length) return;
  const now = world.time - (1 - clamp(alpha, 0, 1)) * simDt;
  for (let i = list.length - 1; i >= 0; i--) {
    const rec = list[i];
    let keep = false;
    try { keep = rec.kind === 'inject' ? injectFrame(world, rec, now) : dressFrame(world, rec, now); } catch (e) { console.warn('[spy-actions]', e?.stack || e); }
    if (!keep) { try { endRecord(rec); } catch { /* best effort */ } list.splice(i, 1); }
  }
}

function endRecord(rec) {
  const v = rec.vis;
  if (!v) return;
  for (const o of v.objects || []) { o.removeFromParent(); o.traverse?.((q) => { if (q.isMesh && q.userData.ownGeo) q.geometry.dispose(); }); }
  v.objects = [];
  if (rec.kind === 'dress') dressCleanup(rec);
}

// ------------------------------------------------------------------ shared pieces

/** Overlay weight of the attacker / the dresser: in from the start, out after `end` or a quick blend once she walks off. */
function overlayW(rec, t, end) {
  const vis = rec.vis, a = rec.a;
  if (vis.walkAt == null && (rec.cancelled != null || (t > end && (a.path || a._moving)))) vis.walkAt = Math.max(t, rec.cancelled ?? 0);
  return ramp(t, 0, SA.aIn) * (1 - ramp(t, end, end + SA.aOut)) * (vis.walkAt != null ? 1 - ramp(t, vis.walkAt, vis.walkAt + 0.15) : 1);
}

/** The pose she was shown in before the action (the action clip's first frame jumps), captured once. */
function pose0Of(m, vis) {
  if (vis.pose0 === undefined) { vis.pose0 = m._preKnife || capturePose(m); m._preKnife = null; }
  return vis.pose0;
}

/** Flex the four fingers of hand s by k (0 open … 1 a fist round a 15 mm bar) and the thumb by kt (about the palm). */
function curl(m, B, s, k, kt = 0) {
  if (Math.abs(k) <= 1e-3 && kt <= 1e-3) return;
  const n = palmNormal(B, s);
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const amt = [1.15, 1.45, 1.05];
    for (let j = 1; j <= 3; j++) {
      const b = B[`${f}_0${j}_${s}`], nx = B[`${f}_0${j + 1}_${s}`] || B[`${f}_0${j}_leaf_${s}`];
      if (!b || !nx) continue;
      const d = wp(nx).sub(wp(b)).normalize();
      const ax = new Vector3().crossVectors(d, n);
      if (ax.lengthSq() < 1e-8) continue;
      turn(m, b, ax.normalize(), amt[j - 1] * k);
    }
  }
  if (kt > 1e-3) {
    const t1 = B['thumb_01_' + s], t2 = B['thumb_02_' + s];
    if (t1 && t2) {
      const d = wp(t2).sub(wp(t1)).normalize(), ax = new Vector3().crossVectors(d, n);
      if (ax.lengthSq() > 1e-8) { turn(m, t1, ax.normalize(), 0.5 * kt); turn(m, t2, ax, 0.6 * kt); }
    }
  }
}

/**
 * The syringe's transform in the right hand's local frame: a fist grip — the barrel across the palm from the index side
 * to the little finger's (tilted to the wrist), the needle out of the little finger's side, the finger flange over the
 * index finger, the plunger and its disc above the thumb. Cached per character.
 */
const GRIP = new Map();
function syringeGrip(m, B) {
  const id = m.characterId;
  if (GRIP.has(id)) return GRIP.get(id);
  const h = B.hand_r, hp = wp(h), hq = wq(h), inv = hq.clone().invert();
  const mid = wp(B.middle_01_r), idx = wp(B.index_01_r || B.hand_r), pky = wp(B.pinky_01_r || B.hand_r);
  const fwd = mid.clone().sub(hp).normalize(), lat = pky.clone().sub(idx).normalize(), n = palmNormal(B, 'r');
  const d = lat.clone().addScaledVector(fwd, -0.4).normalize();                 // the needle's way: out past the little finger
  const x = fwd.clone().addScaledVector(d, -fwd.dot(d)).normalize();            // the flange wings along the fingers
  const y = new Vector3().crossVectors(d, x);
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, d));
  const grip = hp.clone().lerp(mid, 0.82).addScaledVector(n, 0.022).addScaledVector(d, 0.006); // the barrel in the fist
  const out = { p: grip.sub(hp).applyQuaternion(inv), q: inv.clone().multiply(q) };
  GRIP.set(id, out);
  return out;
}
/** Hold the runtime's syringe in the fist (its local transform under hand_r), its plunger at `fill`, shown or not. */
function holdSyringe(m, B, show, fill) {
  const w = m.real.inner.weapon;
  if (!w || !/syringe/.test(w.name)) return null;
  const g = syringeGrip(m, B);
  if (w.parent !== B.hand_r) B.hand_r.add(w);
  w.position.copy(g.p); w.quaternion.copy(g.q); w.scale.set(1, 1, 1);
  w.visible = !!show;
  setSyringeFill(w, fill);
  w.updateMatrixWorld(true);
  return w;
}
/** Her right thumb on the plunger's disc (pressing along the barrel): two-bone IK of the thumb, its last joint aimed. */
function thumbOnDisc(m, B, w, k) {
  const a = B.thumb_01_r, b = B.thumb_02_r, c = B.thumb_03_r, leaf = B.thumb_04_leaf_r, disc = w?.getObjectByName('syringe_thumb');
  if (!a || !b || !c || !leaf || !disc || k <= 1e-3) return;
  w.updateMatrixWorld(true);
  const D = new Vector3(0, 0, 1).applyQuaternion(wq(w)).normalize();          // along the barrel, toward the needle
  const n = palmNormal(B, 'r');
  const l3 = wp(leaf).distanceTo(wp(c));
  const target = wp(disc).addScaledVector(D, -0.004);                          // the pad on the disc's face
  const joint = target.clone().addScaledVector(D, -l3 * 0.75).addScaledVector(n, 0.012);
  limbIK(m, a, b, c, joint, wp(b).addScaledVector(n, 0.04).addScaledVector(D, -0.02), k);
  const from = wp(leaf).sub(wp(c)).normalize(), to = target.clone().sub(wp(c)).normalize();
  setWQ(m, c, new Quaternion().setFromUnitVectors(from, from.clone().lerp(to, k).normalize()).multiply(wq(c)));
}

/** Needle point and axis (world) for the hand's current pose, and the hand-local offsets to aim it. */
function needleFrame(m, B) {
  const g = syringeGrip(m, B), hq = wq(B.hand_r), hp = wp(B.hand_r);
  const ax = new Vector3(0, 0, 1).applyQuaternion(g.q);                           // hand-local needle axis
  const tipL = g.p.clone().add(ax.clone().multiplyScalar(TIP_Z));                 // hand-local needle point
  return { ax, tipL, tip: tipL.clone().applyQuaternion(hq).add(hp), dir: ax.clone().applyQuaternion(hq) };
}

/** World rotation of the right hand that points the needle along `d` with the palm facing `n`, and the wrist position. */
function aimNeedle(m, B, tip, d, n) {
  const NF = needleFrame(m, B);
  const palmL = palmNormal(B, 'r').applyQuaternion(wq(B.hand_r).invert());
  const q = alignHand(NF.ax, palmL, d, n);
  return { q, wrist: tip.clone().sub(NF.tipL.clone().applyQuaternion(q)) };
}

// ------------------------------------------------------------------ injection

/** Carotid point on the side of his neck (world): the neck's side surface below the jaw, `side` +1 his left / -1 his right. */
function carotid(VB, VM, side) {
  const neck = wp(VB.neck_01), head = wp(VB.Head), th = at(VB, 'neck_01', VM.throat);
  const hf = VM.neckFwd.clone().applyQuaternion(wq(VB.neck_01)).normalize();
  const up = head.clone().sub(neck).normalize();
  const lat = new Vector3().crossVectors(up, hf).normalize();                    // his left (up × forward)
  // halfway between the throat's front and the neck's axis, out to the side of the neck (≈ 5 cm), at the jaw's angle
  const c = neck.clone().lerp(head, 0.5).lerp(th, 0.3);
  return { p: c.addScaledVector(lat, side * 0.052), out: lat.clone().multiplyScalar(side), hf, up };
}

function injectFrame(world, rec, now) {
  const a = rec.a, v = rec.v, am = a?.model, vm = v?.model, T = rec.T;
  const t = now - rec.t0;
  if (t < 0) return true;
  if (rec.missed) return false;
  const behind = rec.side === 'behind';
  const vEnd = T.hit + (behind ? SA.vEndBehind : SA.vEndFront);
  // the kill did not happen as drawn (she was shot before the hit, another bullet got him first)
  if ((a.alive === false && t < T.hit) || (v.alive === false && (v.killer !== a || v.deathCause !== 'injection'))) return false;
  rec.vis ||= {};
  const aOn = t <= T.dur + SA.aOut + 0.25 && a.alive !== false && !a.removed && !(rec.vis.walkAt != null && t > rec.vis.walkAt + 0.2);
  const vOn = t <= vEnd && !v.removed && !v._rd && !v.bodyPose && v.state !== 'carried' && !v.carriedBy && (t < T.hit + 0.1 || v.alive === false);
  if (!aOn && !vOn) return false;
  if (!realBody(am) || !realBody(vm)) return t <= Math.max(vEnd, T.dur + SA.aOut + 0.25);
  const VB = bonesOf(vm), AB = bonesOf(am);
  const VM = contactMarks(vm), AM = contactMarks(am);
  if (!VM || !AM) return false;
  if (vOn) victimInject(world, rec, vm, VB, VM, t);
  if (aOn) attackerInject(world, rec, am, AB, AM, vm, VB, VM, t);
  else holdSyringe(am, AB, false, 1);
  if (vOn) victimHandsInject(rec, vm, VB, am, AB, t);
  if (vOn) finish(vm);
  if (aOn) finish(am);
  rec.vis.last = t;
  return true;
}

/** Displayed heading of the victim at t (a frontal one turns to face her during the step). */
function victimHeading(rec, t) {
  const P = rec.plan;
  if (rec.side !== 'front') return P.v.h;
  return lerpAngle(P.v.h, P.vh, ramp(t, 0, Math.max(0.08, rec.T.close)));
}

/** World snapshot of the 'dead' clip pose with the root at `spot` (his corpse as the mixer will show it), cached. */
function deadSnap(m, B, rec, spot, y) {
  if (rec.vis.dead) return rec.vis.dead;
  const root = m.root, keepP = root.position.clone(), keepR = root.rotation.y, keep = capturePose(m);
  root.position.set(spot.x, y, spot.z); root.rotation.y = headingToRotY(spot.h);
  const dead = clipPose(m, 'dead', 0);
  if (dead) { for (const [k, q] of dead.q) if (B[k]) B[k].quaternion.copy(q); if (dead.pelvis) B.pelvis.position.copy(dead.pelvis); }
  upd(root);
  const S = snap(B);
  for (const [k, q] of keep.q) if (B[k]) B[k].quaternion.copy(q);
  if (keep.pelvis) B.pelvis.position.copy(keep.pelvis);
  root.position.copy(keepP); root.rotation.y = keepR; upd(root);
  return (rec.vis.dead = S);
}

const ARM = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'];
const LEGS = ['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
/** Lowering from behind (s after the hit) and its keys along it: sagging into a squat, sitting, laid back. */
const LOWER = [0.32, 0.92], LOWER_K = [0.38, 0.72];

/**
 * World-space key poses of the lowering, built once on his own skeleton (then put back): `sag` — his knees given
 * (hips 0.42 m lower, a little back, feet where they stood), leaning back against her, head lolling, upper arms raised by
 * her arms under his armpits; `sit` — on the ground, his torso raised 45° off his corpse pose about the hips, legs out,
 * chin on his chest, arms as in the sag; `dead` — his corpse pose.
 */
function lowerKeys(m, B, rec, F, gy) {
  if (rec.vis.keys) return rec.vis.keys;
  const P = rec.plan, root = m.root, keep = capturePose(m), keepP = root.position.clone(), keepR = root.rotation.y;
  const put = (pose) => { if (!pose) return; for (const [k, q] of pose.q) if (B[k]) B[k].quaternion.copy(q); if (pose.pelvis) B.pelvis.position.copy(pose.pelvis); upd(root); };
  const dead = deadSnap(m, B, rec, P.lie, gy(P.lie.x, P.lie.z));
  // sag: from his idle at where he stood
  root.position.set(P.v.x, gy(P.v.x, P.v.z), P.v.z); root.rotation.y = headingToRotY(P.v.h); upd(root);
  put(clipPose(m, 'idle', 0));
  const back = F.l.clone(), feet = feetOf(B);
  setPelvisWorld(m, B, wp(B.pelvis).addScaledVector(F.u, -0.42).addScaledVector(F.f, -0.07));
  legsTo(m, B, F, feet);
  turn(m, B.spine_01, back, -0.14); turn(m, B.spine_02, back, -0.1); turn(m, B.spine_03, back, -0.06);
  turn(m, B.neck_01, back, 0.38); turn(m, B.Head, back, 0.24); turn(m, B.Head, F.f, 0.18);
  turn(m, B.upperarm_l, F.f, 0.3); turn(m, B.upperarm_r, F.f, -0.3);   // lifted a little by her arms under his
  turn(m, B.lowerarm_l, back, 0.35); turn(m, B.lowerarm_r, back, 0.35);
  const sag = snap(B);
  // sit: his corpse pose with the torso raised about the hips, the legs left lying out, a slight bend at the knees
  root.position.set(P.lie.x, gy(P.lie.x, P.lie.z), P.lie.z); root.rotation.y = headingToRotY(P.lie.h); upd(root);
  put(clipPose(m, 'dead', 0));
  const legs = LEGS.map((n) => [n, B[n] ? wq(B[n]) : null]);
  const pivot = wp(B.thigh_l).lerp(wp(B.thigh_r), 0.5);
  const R = new Quaternion().setFromAxisAngle(F.l, 0.8);               // + about his left axis: head up, toward his feet
  setPelvisWorld(m, B, wp(B.pelvis).sub(pivot).applyQuaternion(R).add(pivot).addScaledVector(F.u, 0.03));
  setWQ(m, B.pelvis, R.clone().multiply(wq(B.pelvis)));
  for (const [n, q] of legs) if (q) setWQ(m, B[n], q);
  turn(m, B.thigh_l, F.l, -0.18); turn(m, B.thigh_r, F.l, -0.22); turn(m, B.calf_l, F.l, 0.3); turn(m, B.calf_r, F.l, 0.36);
  turn(m, B.neck_01, F.l, 0.45); turn(m, B.Head, F.l, 0.3); turn(m, B.Head, F.f, -0.12);
  const sit = snap(B);
  for (const n of ARM) sit.q.set(n, sag.q.get(n).clone());             // her arms still under his
  for (const [k, q] of keep.q) if (B[k]) B[k].quaternion.copy(q);
  if (keep.pelvis) B.pelvis.position.copy(keep.pelvis);
  root.position.copy(keepP); root.rotation.y = keepR; upd(root);
  return (rec.vis.keys = { sag, sit, dead });
}

function victimInject(world, rec, m, B, M, t) {
  const P = rec.plan, T = rec.T, H = T.hit, c = T.close, N = T.needle, root = m.root, body = m._body?.();
  const behind = rec.side === 'behind';
  const L = t >= H ? snap(B) : null;               // the mixer's pose as the sim placed him (the death clip at his corpse spot)
  const simPos = root.position.clone(), simRotY = root.rotation.y;
  const gun = m.real.inner.weapon, gunW = gun?.visible !== false ? gun?.matrixWorld.clone() : null;
  if (gun && gunW && (!rec.vis.gunRel || t < c - 0.16)) rec.vis.gunRel = B.spine_03.matrixWorld.clone().invert().multiply(gunW);
  const gy = (x, z) => (world.groundY ? world.groundY(x, z) + (rec.v.y || 0) : simPos.y);
  // drawn where he was held (the lowering is written in world space: his hips go straight down where he stood)
  const down = behind ? ramp(t, H + LOWER[0], H + LOWER[1]) : 0;
  root.position.set(P.v.x, gy(P.v.x, P.v.z), P.v.z);
  root.rotation.y = headingToRotY(victimHeading(rec, t));
  const out = behind ? 0 : ramp(t, H + 0.3, H + 0.55);   // front: into the death clip (the fall back)
  if (!behind && t >= H) { root.position.lerp(simPos, ramp(t, H + 0.3, H + 0.9)); root.rotation.y = lerpRot(root.rotation.y, simRotY, out); }
  upd(root);
  if (body && body !== root && (body.position.lengthSq() > 0 || body.quaternion.w < 1 - 1e-9)) { m._guard?.touch(body); body.position.set(0, 0, 0); body.quaternion.identity(); upd(root); }
  const F = frameOf(root);
  const idle = clipPose(m, 'idle', 0);
  const wb = t >= H ? 1 : ramp(t, c - 0.16, c - 0.02);
  if (idle && wb > 1e-3) mixPose(m, idle, wb, m._guard);
  upd(root);
  const g = ramp(t, c - 0.06, c + 0.1);
  const back = F.l.clone();                        // + about his left axis = pitch forward
  const stiff = ramp(t, N - 0.02, N + 0.07) * (1 - ramp(t, H + 0.12, H + 0.3));
  const struggle = ramp(t, N + 0.04, N + 0.12) * (1 - ramp(t, H + 0.12, H + 0.32));
  const limp = ramp(t, H + 0.18, H + 0.36);
  const sh = (f, ph) => Math.sin((t * f + ph) * Math.PI * 2);
  if (behind) {
    if (down < 1) {
      // held: his head pulled back by the palm over his mouth, tilted to his left (the right side of his neck bared);
      // the needle: he stiffens (back arched, shoulders up, head jerked), shakes and kicks, then hangs limp in her arms
      const feet = feetOf(B);
      if (struggle > 0) {   // a kick forward with the right foot, then a smaller one with the left
        const k1 = bump(t, N + 0.1, N + 0.34) * struggle, k2 = bump(t, H - 0.04, H + 0.18) * struggle;
        feet.r.p.addScaledVector(F.f, 0.12 * k1).addScaledVector(F.u, 0.1 * k1);
        feet.l.p.addScaledVector(F.f, 0.07 * k2).addScaledVector(F.u, 0.06 * k2);
      }
      const p0 = wp(B.pelvis);
      setPelvisWorld(m, B, p0.addScaledVector(F.u, 0.015 * stiff - 0.07 * limp).addScaledVector(F.f, -0.03 * limp));
      legsTo(m, B, F, feet);
      const pull = g * (1 - limp * 0.5);
      const arch = -0.08 * stiff + 0.02 * struggle * sh(6.5, 0.1);
      turn(m, B.spine_02, back, arch * 0.6 + 0.03 * limp);
      turn(m, B.spine_03, back, arch + 0.04 * limp);
      turn(m, B.spine_03, F.u, 0.06 * struggle * sh(5.2, 0.3));
      turn(m, B.clavicle_l, F.f, 0.12 * stiff); turn(m, B.clavicle_r, F.f, -0.12 * stiff);
      turn(m, B.neck_01, back, -0.2 * pull - 0.06 * stiff + 0.25 * limp);
      turn(m, B.Head, back, -0.22 * pull - 0.08 * stiff + 0.2 * limp);
      turn(m, B.neck_01, F.f, -0.07 * pull + 0.05 * struggle * sh(7.3, 0.6));
      turn(m, B.Head, F.f, -0.1 * pull + 0.07 * limp);
      turn(m, B.Head, F.u, 0.12 * pull);                         // face turned a little to his left: his right neck bared
      // her arms under his armpits from the limp on: his upper arms pushed up and out
      const ha = ramp(t, H + 0.24, H + 0.42);
      turn(m, B.upperarm_l, F.f, 0.3 * ha); turn(m, B.upperarm_r, F.f, -0.3 * ha);
    }
    if (down > 0) {
      // lowered: his knees give and he sags into a squat against her, sits on the ground leaning back in her arms (his
      // legs sliding out), and is laid back — ending exactly in his corpse pose (the 'dead' clip at the corpse spot)
      const K = lowerKeys(m, B, rec, F, gy);
      const held = snap(B);
      const u = down;
      if (u < LOWER_K[0]) writeBlend(m, B, held, K.sag, smooth(u / LOWER_K[0]));
      else if (u < LOWER_K[1]) writeBlend(m, B, K.sag, K.sit, smooth((u - LOWER_K[0]) / (LOWER_K[1] - LOWER_K[0])));
      else writeBlend(m, B, K.sit, K.dead, smooth((u - LOWER_K[1]) / (1 - LOWER_K[1])));
    }
    // the mixer's corpse at the end (the die clip has him on the ground by now), before the settle ragdoll takes him;
    // let go early (she was ordered away): he slumps into it at once
    const drop = rec.cancelled != null ? ramp(t, rec.cancelled, rec.cancelled + 0.35) : 0;
    const e2 = Math.max(ramp(t, H + 1.02, H + 1.18), drop);
    if (L && e2 > 0) writeBlend(m, B, snap(B), L, e2);
  } else {
    const feet = feetOf(B);
    const p0 = wp(B.pelvis);
    setPelvisWorld(m, B, p0.addScaledVector(F.u, 0.01 * stiff - 0.12 * limp).addScaledVector(F.f, -0.04 * limp));
    legsTo(m, B, F, feet);
    const fwd = F.l.clone();
    turn(m, B.spine_02, fwd, -0.05 * g + 0.04 * stiff + 0.1 * limp);
    turn(m, B.spine_03, fwd, -0.04 * g - 0.06 * stiff + 0.08 * limp);
    turn(m, B.spine_03, F.u, 0.05 * struggle * sh(5.6, 0.2));
    turn(m, B.clavicle_l, F.f, 0.1 * stiff); turn(m, B.clavicle_r, F.f, -0.1 * stiff);
    turn(m, B.neck_01, fwd, -0.06 * g - 0.08 * stiff + 0.22 * limp);
    turn(m, B.Head, fwd, -0.05 * g - 0.1 * stiff + 0.25 * limp);
    turn(m, B.Head, F.u, -0.35 * stiff * (1 - limp) + 0.06 * struggle * sh(6.1, 0.4)); // away from the needle (on his left)
    if (L && out > 0) writeBlend(m, B, snap(B), L, out);
  }
  const rel = rec.vis.gunRel;
  if (gun && gunW && rel && gun.parent) {
    upd(root);
    const Wc = B.spine_03.matrixWorld.clone().multiply(rel);
    const k = t < H ? 0 : behind ? ramp(t, H + 0.42, H + 0.7) : out;   // slips off his shoulder as he sinks
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

/** His hands on her forearms: behind, both up to the arm over his mouth, the right one to the needle arm's wrist. */
function victimHandsInject(rec, vm, VB, am, AB, t) {
  const T = rec.T, H = T.hit, c = T.close, N = T.needle, behind = rec.side === 'behind';
  const w = behind ? ramp(t, c - 0.02, c + 0.16) * (1 - ramp(t, H + 0.16, H + 0.34))
    : ramp(t, N - 0.1, N + 0.06) * (1 - ramp(t, H + 0.12, H + 0.3));
  if (w <= 1e-3) return;
  const F = frameOf(vm.root);
  const fore = (s, k) => wp(AB['lowerarm_' + s]).lerp(wp(AB['hand_' + s]), k);
  const jig = (ph) => 0.012 * ramp(t, N + 0.04, N + 0.12) * Math.sin((t * 6.5 + ph) * Math.PI * 2);
  const toR = behind ? ramp(t, N - 0.05, N + 0.08) : 1;          // behind: his right hand goes to the needle arm
  const tl = behind ? fore('l', 0.5) : fore('r', 0.82);
  const tr = behind ? fore('l', 0.72).lerp(fore('r', 0.75), toR) : fore('r', 0.5).addScaledVector(F.l, -0.03);
  tl.addScaledVector(F.u, jig(0)); tr.addScaledVector(F.u, jig(0.37));
  for (const [s, tgt] of [['l', tl], ['r', tr]]) {
    const ua = VB['upperarm_' + s], la = VB['lowerarm_' + s], ha = VB['hand_' + s];
    const side = s === 'l' ? 1 : -1;
    // elbows down in front of his chest (an arm thrown out sideways on its way up read as a punch)
    const pole = wp(ua).addScaledVector(F.l, 0.12 * side).addScaledVector(F.u, -0.45).addScaledVector(F.f, 0.3);
    const palm = wp(ha).lerp(wp(VB['middle_01_' + s] || ha), 0.55).sub(wp(ha));
    limbIK(vm, ua, la, ha, tgt.clone().sub(palm.multiplyScalar(0.8)), pole, w);
    curl(vm, VB, s, 0.6 * w);
  }
}

function attackerInject(world, rec, m, B, M, vm, VB, VM, t) {
  const P = rec.plan, T = rec.T, root = m.root, c = T.close, N = T.needle, H = T.hit, E = T.dur;
  const behind = rec.side === 'behind', vis = rec.vis;
  const W = overlayW(rec, t, E);
  const vF = frameOf(vm.root);
  // chest on his back (a deep pack keeps her a little further back, leaning over it), as the knife
  const need = behind ? (-VM.backZ) + M.chestZ + 0.005 : P.dist;
  const extra = clamp(need - P.dist, -0.08, 0.3);
  const wOff = ramp(t, 0, Math.max(0.06, c)) * (1 - ramp(t, E, E + SA.aOut)) * (vis.walkAt != null ? 1 - ramp(t, vis.walkAt, vis.walkAt + 0.3) : 1);
  const dir = new Vector3(P.to.x - P.v.x, 0, P.to.z - P.v.z).normalize();
  if (Math.abs(extra) > 1e-3 && wOff > 0) { root.position.addScaledVector(dir, extra * wOff); upd(root); }
  const pose0 = pose0Of(m, vis);
  if (!vis.feet0) {
    if (pose0) { const keep = capturePose(m); mixPose(m, pose0, 1); upd(root); vis.feet0 = feetOf(B); mixPose(m, keep, 1); upd(root); } else vis.feet0 = feetOf(B);
  }
  if (W <= 1e-3) { holdSyringe(m, B, false, 1); return; }
  const F = frameOf(root);
  const fwd = F.l.clone();
  const pre = capturePose(m);
  // base: the idle stance; behind, down on one knee behind his head while she lowers him (kneel_shoot's legs), up again
  // after; front, a bend at the knees as he crumples in her hands
  const idle = clipPose(m, 'idle', 0), kneel = lowerBody(clipPose(m, 'kneel_shoot', 0.3)), crouch = lowerBody(clipPose(m, 'crouch_idle', 0.5));
  if (idle) mixPose(m, idle, 1, m._guard);
  const cw = behind ? ramp(t, H + 0.34, H + 0.78) * (1 - ramp(t, H + 0.98, H + 1.22)) : 0.3 * ramp(t, H + 0.08, H + 0.4) * (1 - ramp(t, H + 0.45, H + 0.8));
  const low = behind ? kneel : crouch;
  if (low && cw > 1e-3) mixPose(m, low, cw, m._guard);
  upd(root);
  // feet: the step in (lead foot, then trail foot) to the contact stance; behind, the step back (right, then left) to the
  // crouch behind his head
  const stanceAt = (spot, extraD, pose) => {
    const keep = capturePose(m);
    if (pose) { mixPose(m, pose, 1); upd(root); }
    const fin = new Vector3(spot.x, 0, spot.z).addScaledVector(dir, extraD);
    fin.y = world.groundY ? world.groundY(fin.x, fin.z) + (rec.a.y || 0) : root.position.y;
    const qFin = new Quaternion().setFromAxisAngle(F.u, headingToRotY(spot.h));
    const D = new Matrix4().compose(fin, qFin, new Vector3(1, 1, 1)).multiply(root.matrixWorld.clone().invert());
    const qD = qFin.clone().multiply(wq(root).invert());
    const fe = feetOf(B);
    for (const sd of ['l', 'r']) { fe[sd].p.applyMatrix4(D); fe[sd].q.premultiply(qD); }
    if (world.groundY) for (const sd of ['l', 'r']) fe[sd].p.y += world.groundY(fe[sd].p.x, fe[sd].p.z) - (fin.y - (rec.a.y || 0));
    mixPose(m, keep, 1); upd(root);
    return fe;
  };
  vis.feetA ||= stanceAt(P.to, extra, idle);
  if (P.back && !vis.feetB) {
    vis.feetB = stanceAt(P.back, 0, kneel || idle); vis.feetC = stanceAt(P.back, 0, idle);
    vis.feetB.r.p.lerp(vis.feetC.r.p, 0.35);   // a shorter kneel than the rifleman's: the knee down just behind her
  }
  const feet = { l: { ...vis.feetA.l }, r: { ...vis.feetA.r } };
  const step = Math.hypot(P.to.x - P.from.x, P.to.z - P.from.z) + Math.abs(extra) > 0.08;
  const arc = (a0, a1, k, lift) => ({ p: a0.p.clone().lerp(a1.p, k).addScaledVector(F.u, lift * Math.sin(Math.PI * clamp(k, 0, 1))), q: a0.q.clone().slerp(a1.q, k) });
  if (step && t < c + 0.08) {
    const kL = smooth(t / Math.max(0.05, c * 0.68)), kR = ramp(t, c * 0.3, c + 0.05);
    feet.l = arc(vis.feet0.l, vis.feetA.l, kL, 0.09); feet.r = arc(vis.feet0.r, vis.feetA.r, kR, 0.09);
  }
  if (P.back && t > H + 0.3) {   // back: the right foot (down onto the knee), then the left; up again: the right foot in
    const b0 = H + 0.3;
    feet.r = arc(vis.feetA.r, vis.feetB.r, ramp(t, b0 + 0.04, b0 + 0.32), 0.07);
    feet.l = arc(vis.feetA.l, vis.feetB.l, ramp(t, b0 + 0.24, b0 + 0.5), 0.07);
    if (t > H + 1.0) feet.r = arc(vis.feetB.r, vis.feetC.r, ramp(t, H + 1.0, H + 1.18), 0.06);
    if (t > H + 1.1) feet.l = arc(vis.feetB.l, vis.feetC.l, ramp(t, H + 1.1, H + 1.26), 0.06);
  }
  // her body: a little lower at contact (a taller man bends his knees to the victim's height), crouched while lowering
  const vRef = behind ? at(VB, 'Head', VM.mouth).y : wp(VB.upperarm_r).y;
  const tall = clamp(wp(B.upperarm_l).y - vRef - (behind ? 0.03 : 0.1), 0, 0.14) * ramp(t, c - 0.2, c + 0.05) * (1 - cw);
  const drop = 0.03 * ramp(t, c - 0.1, c + 0.05) * (1 - cw) + tall;
  setPelvisWorld(m, B, wp(B.pelvis).addScaledVector(F.u, -drop));
  // ---- hand targets on his body as posed this frame
  const vRight = vF.l.clone().negate();
  const T_ = {};
  // left hand: behind, the palm over his mouth and nose (as the knife), then under his left armpit; front: his collar
  const wMouth = ramp(t, c - 0.2, c + 0.06) * (1 - ramp(t, H + 0.22, H + 0.36));
  const wPitL = behind ? ramp(t, H + 0.24, H + 0.4) * (1 - ramp(t, H + 0.8, H + 0.94)) : 0;
  const wCollarL = behind ? 0 : ramp(t, c - 0.2, c + 0.06) * (1 - ramp(t, H + 0.42, H + 0.56));
  if (behind && wMouth > 1e-3) {
    const mouth = at(VB, 'Head', VM.mouth).lerp(at(VB, 'Head', VM.chin), 0.25);
    const hf = faceDir(VB, VM), reach = 1 - ramp(t, c - 0.08, c + 0.02);
    const tgt = mouth.clone().addScaledVector(hf, 0.02).addScaledVector(vF.l, 0.2 * reach).addScaledVector(hf, 0.1 * reach);
    T_.l = { target: tgt, fDir: vRight.clone().addScaledVector(F.u, 0.12), nDir: hf.clone().negate(), pole: [0.55, -0.35, -0.1], w: wMouth };
  }
  const TF = torsoFrame(VB);
  if (wPitL > 1e-3) {   // under his left armpit, the palm flat on his chest
    const pl = { target: armpit(VB, TF, 'l'), fDir: TF.l.clone().negate().addScaledVector(TF.u, -0.5), nDir: TF.f.clone().negate(), pole: [0.65, -0.45, -0.25], w: wPitL };
    T_.l = T_.l ? mixT(T_.l, pl, wPitL / Math.max(1e-6, wPitL + T_.l.w)) : pl;
  }
  if (wCollarL > 1e-3) {
    const col = wp(VB.clavicle_r || VB.upperarm_r).lerp(wp(VB.upperarm_r), 0.5).addScaledVector(vF.u, 0.05).addScaledVector(vF.f, 0.06);
    const reach = 1 - ramp(t, c - 0.08, c + 0.02);
    T_.l = { target: col.addScaledVector(F.f, -0.18 * reach), fDir: F.u.clone().addScaledVector(F.f, 0.4), nDir: F.f.clone(), pole: [0.45, -0.5, -0.15], w: wCollarL };
  }
  if (T_.l) { T_.l.q = handQ(B, 'l', T_.l.fDir, T_.l.nDir); T_.l.wrist = T_.l.target.clone().sub(T_.l.q.off.clone().applyQuaternion(T_.l.q.q)); }
  // right hand: the syringe out of her breast pocket, the needle into his neck, the thumb on the plunger; then under his
  // right armpit (behind) / on his left collar (front); the syringe back in the pocket at the end
  const pocket = at(B, 'spine_03', M.chestPt).addScaledVector(F.l, 0.075).addScaledVector(F.u, 0.03).addScaledVector(F.f, -0.015);
  const shown = t >= SA.pocket[1] && t < (behind ? H + 1.13 : H + 0.7);
  const press = ramp(t, N + 0.02, H - 0.03);
  const side = behind ? -1 : 1;                                      // his right side (behind) / his left (front)
  const C = carotid(VB, VM, side);
  const inn = ramp(t, N - 0.06, N), outN = ramp(t, H + 0.04, H + 0.14);
  const wNeedle = ramp(t, SA.pocket[1] + 0.02, Math.max(SA.pocket[2] + 0.08, N - 0.08)) * (1 - ramp(t, H + 0.12, H + 0.26));
  const wPocket1 = bump(t, -0.05, SA.pocket[2] + 0.04);
  const pk2 = behind ? [H + 0.98, H + 1.2] : [H + 0.52, H + 0.76];
  const wPocket2 = bump(t, pk2[0], pk2[1] + 0.06);
  const wPitR = behind ? ramp(t, H + 0.2, H + 0.38) * (1 - ramp(t, H + 0.8, H + 0.94)) : 0;
  const wCollarR = behind ? 0 : ramp(t, H + 0.12, H + 0.26) * (1 - ramp(t, H + 0.42, H + 0.56));
  const cands = [];
  if (wNeedle > 1e-3) {
    // the needle comes in from outside the neck (out along the side and back), in 12 mm at N, out after the hit
    const D = C.out.clone().negate().addScaledVector(C.hf, behind ? 0.25 : 0.15).addScaledVector(C.up, -0.2).normalize();
    const away = 1 - inn + outN;
    const tip = C.p.clone().addScaledVector(D, 0.012 * (1 - outN) - 0.07 * away).addScaledVector(F.f, behind ? -0.05 * (1 - ramp(t, SA.pocket[2], N - 0.06)) : 0);
    const palmTo = behind ? vF.f.clone().negate().addScaledVector(F.u, 0.3) : F.u.clone().addScaledVector(F.l, 0.4);
    const aim = aimNeedle(m, B, tip, D, palmTo);
    cands.push({ w: wNeedle, wrist: aim.wrist, q: aim.q, pole: behind ? [-0.6, -0.3, -0.1] : [-0.55, -0.45, -0.2], tip });
  }
  if (wPitR > 1e-3) {   // under his right armpit, the fist (the syringe in it) on his chest
    const pit = armpit(VB, TF, 'r');
    const q = handQ(B, 'r', TF.l.clone().addScaledVector(TF.u, -0.5), TF.f.clone().negate());
    cands.push({ w: wPitR, wrist: pit.clone().sub(q.off.clone().applyQuaternion(q.q)), q: q.q, pole: [-0.65, -0.45, -0.25] });
  }
  if (wCollarR > 1e-3) {
    const col = wp(VB.clavicle_l || VB.upperarm_l).lerp(wp(VB.upperarm_l), 0.5).addScaledVector(vF.u, 0.05).addScaledVector(vF.f, 0.06);
    const q = handQ(B, 'r', F.u.clone().addScaledVector(F.f, 0.4), F.f.clone());
    cands.push({ w: wCollarR, wrist: col.clone().sub(q.off.clone().applyQuaternion(q.q)), q: q.q, pole: [-0.45, -0.5, -0.15] });
  }
  for (const [wk, k] of [[wPocket1, 0], [wPocket2, 1]]) {
    if (wk <= 1e-3) continue;
    const q = handQ(B, 'r', F.u.clone().negate().addScaledVector(F.l, 0.5), F.f.clone().negate());
    cands.push({ w: wk, wrist: pocket.clone().sub(q.off.clone().applyQuaternion(q.q)), q: q.q, pole: [-0.45, -0.55, -0.1] });
  }
  if (cands.length) {
    let tw = 0; const wr = new Vector3(); let q = null, pole = null;
    for (const cd of cands) {
      const k = cd.w / (tw + cd.w); tw += cd.w;
      wr.lerp(cd.wrist, tw === cd.w ? 1 : k); q = q ? q.slerp(cd.q, k) : cd.q.clone(); pole = pole ? pole.map((v, i) => v + (cd.pole[i] - v) * k) : cd.pole.slice();
    }
    T_.r = { wrist: wr, q, pole, w: Math.min(1, tw), tip: cands.find((cd) => cd.tip)?.tip || null };
  }
  // ---- lean (and shoulders forward round him) until both hands reach
  const reachLen = 0.97 * M.arm;
  const short = () => Math.max(T_.l ? wp(B.upperarm_l).distanceTo(T_.l.wrist) - reachLen : 0, T_.r ? wp(B.upperarm_r).distanceTo(T_.r.wrist) - reachLen : 0);
  const spineLean = (x) => { turn(m, B.spine_01, fwd, x * 0.3); turn(m, B.spine_02, fwd, x * 0.35); turn(m, B.spine_03, fwd, x * 0.35); };
  let lean = behind ? (0.05 + extra * 0.6) * ramp(t, 0, c + 0.05) * (1 - cw) : 0.05 * ramp(t, 0, c + 0.05) + 0.25 * cw;
  spineLean(lean);
  const hug = behind ? Math.max(wMouth, wNeedle, wPitL, wPitR) : 0.4 * Math.max(wCollarL, wNeedle);
  turn(m, B.clavicle_l, F.u, -0.28 * hug); turn(m, B.clavicle_r, F.u, 0.28 * hug);
  let more = 0;
  for (let it = 0; it < 3 && (T_.l || T_.r); it++) {
    const over = short();
    if (over <= 0.004) break;
    const dm = clamp(over / 0.5, 0, 0.6 - lean - more);
    if (dm <= 1e-3) break;
    spineLean(dm); more += dm;
  }
  const wReach = Math.max(T_.l ? T_.l.w : 0, T_.r ? T_.r.w : 0);
  if (more > 0 && wReach < 0.999) spineLean(-more * (1 - wReach));
  vis.lean = lean + more * wReach; vis.short = short();
  // her head: behind his left ear (his right side, where the needle goes, left clear), her eyes on the needle; looking
  // down at him as she lowers him
  const hb = behind ? ramp(t, c - 0.1, c + 0.05) * (1 - ramp(t, H + 0.25, H + 0.45)) : 0;
  turn(m, B.neck_01, F.f, -0.2 * hb); turn(m, B.Head, F.f, -0.12 * hb); turn(m, B.Head, F.u, -0.28 * hb);
  const look = behind ? ramp(t, H + 0.3, H + 0.6) * (1 - ramp(t, H + 0.95, H + 1.2)) : ramp(t, N - 0.15, N) * (1 - ramp(t, H + 0.5, H + 0.8));
  turn(m, B.neck_01, fwd, 0.25 * look); turn(m, B.Head, fwd, 0.2 * look);
  legsTo(m, B, F, feet);
  const poleAt = (s, p) => wp(B['upperarm_' + s]).addScaledVector(F.l, p[0]).addScaledVector(F.u, p[1]).addScaledVector(F.f, p[2]);
  if (T_.l) limbIK(m, B.upperarm_l, B.lowerarm_l, B.hand_l, T_.l.wrist, poleAt('l', T_.l.pole), T_.l.w, T_.l.q.q);
  if (T_.r) limbIK(m, B.upperarm_r, B.lowerarm_r, B.hand_r, T_.r.wrist, poleAt('r', T_.r.pole), T_.r.w, T_.r.q);
  // fingers: a fist round the syringe, the palm over his mouth, hands spread on his chest
  curl(m, B, 'r', shown ? 0.92 : 0.25 * wPitR, 0);
  curl(m, B, 'l', -0.35 * wMouth + 0.3 * Math.max(wPitL, wCollarL));   // flat over his mouth, spread on his chest
  const sy = holdSyringe(m, B, shown, 1 - press);
  if (sy) thumbOnDisc(m, B, sy, ramp(t, SA.pocket[2], N - 0.05) * (1 - ramp(t, H + 0.1, H + 0.25)));   // the thumb on the plunger
  if (sy && T_.r?.tip) vis.tipErr = wp(sy.getObjectByName('syringe_tip')).distanceTo(T_.r.tip);
  // blend the overlay over her own clip (in from the last pose shown before the action, out after it)
  const src = t < E && pose0 ? pose0 : pre;
  if (W < 0.999 && src) mixPose(m, src, 1 - W, m._guard);
}

/** His torso's frame as posed now (world): forward out of his chest, left, up along his spine. */
function torsoFrame(VB) {
  const u = wp(VB.neck_01).sub(wp(VB.spine_02)).normalize();
  const l = wp(VB.upperarm_l).sub(wp(VB.upperarm_r)).normalize();
  const f = new Vector3().crossVectors(l, u).normalize();
  return { f, l: new Vector3().crossVectors(u, f).normalize(), u };
}
/** Where her hand goes under his armpit from behind: on the front of his chest below the shoulder, toward the middle. */
function armpit(VB, TF, s) {
  return wp(VB['upperarm_' + s]).addScaledVector(TF.f, 0.07).addScaledVector(TF.u, -0.09).addScaledVector(TF.l, s === 'l' ? -0.05 : 0.05);
}

const LOWER_BODY = new Set(['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);
/** The hips and legs of a clip pose (a kneel / a crouch under her own upper body). */
function lowerBody(pose) {
  if (!pose) return null;
  if (pose._lower) return pose._lower;
  const q = new Map();
  for (const [k, v] of pose.q) if (LOWER_BODY.has(k)) q.set(k, v);
  return (pose._lower = { q, pelvis: pose.pelvis });
}

/** Weighted mix of two hand targets (target point, finger / palm directions). */
function mixT(A, Z, k) {
  return { target: A.target.clone().lerp(Z.target, k), fDir: A.fDir.clone().lerp(Z.fDir, k).normalize(), nDir: A.nDir.clone().lerp(Z.nDir, k).normalize(),
    pole: A.pole.map((v, i) => v + (Z.pole[i] - v) * k), w: Math.max(A.w, Z.w) };
}

/**
 * Contact metrics of an injection as drawn now: needle point to the carotid point, the needle depth, the left palm to
 * his mouth (behind), the chest-to-back gap (behind) / root distance (front), the plunger (1 full … 0 pressed).
 */
export function injectMetrics(a, v) {
  const am = a?.model, vm = v?.model;
  if (!realBody(am) || !realBody(vm)) return null;
  const AB = bonesOf(am), VB = bonesOf(vm), AM = contactMarks(am), VM = contactMarks(vm);
  const rec = (a.world?.spyActs || []).find((r) => r.kind === 'inject' && r.a === a) || null;
  const side = rec?.side === 'front' ? 1 : -1;
  const C = carotid(VB, VM, side);
  const w = am.real.inner.weapon, tipO = w && /syringe/.test(w.name) ? w.getObjectByName('syringe_tip') : null;
  const tip = tipO && w.visible !== false ? wp(tipO) : null;
  const palm = wp(AB.hand_l).lerp(wp(AB.middle_01_l || AB.hand_l), 0.55);
  const mouth = at(VB, 'Head', VM.mouth);
  const vr = vm.root, ar = am.root;
  const line = new Vector3(ar.position.x - vr.position.x, 0, ar.position.z - vr.position.z);
  const dist = line.length(); line.normalize();
  const vF = frameOf(vr);
  const behindSide = line.dot(vF.f) < 0;
  const vSurf = at(VB, 'spine_03', behindSide ? VM.backPt : VM.chestPt), aSurf = at(AB, 'spine_03', AM.chestPt);
  return {
    side: rec?.side ?? null, tipCarotid: tip ? tip.distanceTo(C.p) : null, depth: tip ? -tip.clone().sub(C.p).dot(C.out) : null,
    palmMouth: palm.distanceTo(mouth), gap: aSurf.clone().sub(vSurf).dot(line), root: dist, fill: w?.userData?.fill ?? null,
    thumbDisc: tip && (AB.thumb_04_leaf_r || AB.thumb_03_r) ? wp(AB.thumb_04_leaf_r || AB.thumb_03_r).distanceTo(wp(w.getObjectByName('syringe_thumb'))) : null,
    // the barrel in her fist: the curled middle finger's middle joint to the barrel's axis
    gripFinger: tip && AB.middle_02_r ? wp(AB.middle_02_r).sub(wp(w)).cross(new Vector3(0, 0, 1).applyQuaternion(wq(w))).length() : null,
    shown: !!(w && w.visible !== false && /syringe/.test(w.name)),
  };
}

// ------------------------------------------------------------------ uniform

/**
 * Visual beats of the clothesline take (s from the action start) and of the dressing (s from its start, the sim's d0);
 * the sim's own marks (take, swap, end) come from abilities/spy-actions.js DRESS.
 */
export const VD = Object.freeze({
  reach: [0.05, 0.27], grab: 0.27, peg1: 0.33, peg2: 0.4, pull: [0.27, 0.48], toBundle: [0.46, 0.6], roll: [0.52, 0.6],
  capReach: [0.6, 0.8], capGrab: 0.8, capLift: [0.8, 0.86], capToL: [0.86, 0.98], capHand: 0.97,
  leftLag: 0.1,      // her left hand takes its garment this much after the right: they come off one after the other
  kitBack: [0, 0.12], kitOut: 0.11, kitTuck: [0.12, 0.26], kitCap: [0.2, 0.32],
});
/**
 * The dressing beats (s from its start). From the kit (U): her own cap off and into the bundle, the officer's cap on,
 * the tunic out and swung on (the swap), the buttons, the hem, a touch to the visor. At a clothesline she first hangs
 * the officer's cap on the line in front of her, so the order is the tunic, the buttons, then the cap off the line and
 * onto her head, then the hem.
 */
export const VDK = Object.freeze({
  flat: [0, 0.09], flatToBundle: [0.09, 0.18], capR: [0.18, 0.24], capUp: [0.24, 0.36],
  tunicReach: [0.36, 0.42], shake: [0.42, 0.52], swingR: [0.52, 0.66], sleeveL: [0.6, 0.76], swap: 0.74, sleeveR: [0.74, 0.86],
  shrug: [0.8, 0.92], buttons: [0.86, 1.08], hem: [1.08, 1.16], visor: [1.14, 1.24], end: 1.26,
});
export const VDL = Object.freeze({
  hang: [0, 0.06, 0.19, 0.26],   // to her left hand (takes the cap), up to the line, hung on its peg, the hand down
  flat: [0.2, 0.3], flatToBundle: [0.3, 0.4],
  tunicReach: [0.4, 0.46], shake: [0.46, 0.56], swingR: [0.56, 0.7], sleeveL: [0.64, 0.8], swap: 0.8, sleeveR: [0.8, 0.9],
  shrug: [0.84, 0.96], buttons: [0.9, 1.1], capReach: [1.1, 1.2], capUp: [1.2, 1.34], hem: [1.34, 1.44], end: 1.48,
});

/** Head-frame data of a character, measured once in its idle pose: up / forward in the Head frame, and where its
 *  disguise cap sits (band centre, width) — the procedural officer's cap is put on exactly there. */
const HEADS = new Map();
function headInfo(m) {
  const id = m.characterId;
  if (HEADS.has(id)) return HEADS.get(id);
  const B = bonesOf(m), root = m.root, inner = m.real.inner;
  const keep = capturePose(m), idle = clipPose(m, 'idle', 0);
  if (idle) { for (const [k, q] of idle.q) if (B[k]) B[k].quaternion.copy(q); if (idle.pelvis) B.pelvis.position.copy(idle.pelvis); }
  upd(root);
  const hq = wq(B.Head).invert(), rq = wq(root);
  const up = new Vector3(0, 1, 0).applyQuaternion(hq), fwd = new Vector3(0, 0, 1).applyQuaternion(rq).applyQuaternion(hq);
  const out = { up: up.normalize(), fwd: fwd.normalize(), band: up.clone().multiplyScalar(0.1), width: 0.25 };
  const part = inner.parts?.['disguise:headgear'];
  if (part?.isSkinnedMesh) {
    const sk = part.skeleton, hi = sk.bones.indexOf(B.Head);
    if (hi >= 0) {
      const M = sk.boneInverses[hi].clone().multiply(part.bindMatrix);
      const pos = part.geometry.attributes.position, v = new Vector3();
      let lo = Infinity, hiU = -Infinity;
      const pts = [];
      for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(M); pts.push(v.clone()); const h = v.dot(out.up); lo = Math.min(lo, h); hiU = Math.max(hiU, h); }
      const ring = pts.filter((p) => p.dot(out.up) < lo + 0.025);
      const c = ring.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / Math.max(1, ring.length));
      const lat = new Vector3().crossVectors(out.up, out.fwd).normalize();
      let wmin = Infinity, wmax = -Infinity;
      for (const p of pts) { const d = p.dot(lat); wmin = Math.min(wmin, d); wmax = Math.max(wmax, d); }
      out.band = c; out.width = wmax - wmin;
    }
  }
  for (const [k, q] of keep.q) if (B[k]) B[k].quaternion.copy(q);
  if (keep.pelvis) B.pelvis.position.copy(keep.pelvis);
  upd(root);
  HEADS.set(id, out);
  return out;
}
/** World matrix of the procedural officer's cap as worn (art/clothesline.js makeOfficerCap: origin at the band's lower
 *  edge, +y up, +z the visor's way), from the Head bone as posed now. */
function wornCapMatrix(m, B) {
  const I = headInfo(m);
  const y = I.up.clone(), z = I.fwd.clone().addScaledVector(y, -I.fwd.dot(y)).normalize(), x = new Vector3().crossVectors(y, z);
  const s = I.width / 0.27;
  const local = new Matrix4().makeBasis(x, y, z).scale(new Vector3(s, s, s)).setPosition(I.band.clone().addScaledVector(y, -0.004));
  return B.Head.matrixWorld.clone().multiply(local);
}
/** Her own cap as a loose prop: the outfit's headgear mesh re-used unskinned, in the Head frame (exact as worn). */
function headgearProp(m, B, which) {
  const part = m.real.inner.parts?.[which === 'disg' ? 'disguise:headgear' : 'headgear'];
  if (!part?.isSkinnedMesh) return null;
  const sk = part.skeleton, hi = sk.bones.indexOf(B.Head);
  if (hi < 0) return null;
  const g = new Object3D(); g.name = 'spy_cap_' + which;
  const ms = new THREE_REF.Mesh(part.geometry, part.material);
  ms.matrixAutoUpdate = false; ms.matrix.copy(sk.boneInverses[hi].clone().multiply(part.bindMatrix));
  ms.castShadow = true; ms.frustumCulled = false;
  g.add(ms);
  return g;
}

/** Place `obj` at world matrix `Wm` under its current parent. */
function setWorld(obj, Wm) {
  obj.parent.updateWorldMatrix(true, false);
  Wm.clone().premultiply(obj.parent.matrixWorld.clone().invert()).decompose(obj.position, obj.quaternion, obj.scale);
  obj.updateMatrixWorld(true);
}
/** Blend two world matrices (position lerp, rotation slerp, scale lerp). */
const lerpM = (A, Z, k) => blendM(A, Z, k);

const palmPt = (B, s) => wp(B['hand_' + s]).lerp(wp(B['middle_01_' + s] || B['hand_' + s]), 0.55);

/** The line's pieces (cloths, cap) as built by art/clothesline.js, with their pegged layout remembered. */
function lineParts(rec) {
  const v = rec.vis;
  if (v.parts !== undefined) return v.parts;
  const o = rec.line?.object3d, uni = o?.getObjectByName?.('clothesline_uniform');
  if (!uni) return (v.parts = null);
  const piece = (n) => {
    const mesh = uni.getObjectByName('laundry_' + n);
    if (!mesh) return null;
    return { mesh, cloth: mesh.userData.cloth || null, pos: mesh.position.clone(), quat: mesh.quaternion.clone(), scale: mesh.scale.clone(), parent: mesh.parent };
  };
  return (v.parts = { uni, tunic: piece('tunic'), trousers: piece('trousers'), cap: piece('cap') });
}
/** Particle index (top row) of a garment's near edge to the point p, and its far edge. */
function nearEdge(pc, p) {
  const { nx } = pc.cloth, P = pc.cloth.x, mw = pc.mesh.matrixWorld;
  const at_ = (i) => new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(mw);
  const a = at_(0), b = at_(nx - 1);
  return a.distanceTo(p) <= b.distanceTo(p) ? { k: 0, far: nx - 1 } : { k: nx - 1, far: 0 };
}
/** Put the line back as it was (an action cut short before the uniform was taken). */
function restoreLine(rec) {
  const L = rec.vis?.parts;
  if (!L) return;
  for (const n of ['tunic', 'trousers', 'cap']) {
    const pc = L[n];
    if (!pc) continue;
    if (pc.mesh.parent !== pc.parent) pc.parent.add(pc.mesh);
    pc.mesh.position.copy(pc.pos); pc.mesh.quaternion.copy(pc.quat); pc.mesh.scale.copy(pc.scale); pc.mesh.visible = true;
    if (pc.cloth) { pc.cloth.setPinned(pc.mesh.userData.pegs.map((i) => i)); pc.cloth.reset(); pc.cloth.write(); }
  }
}

function dressCleanup(rec) {
  const v = rec.vis;
  if (!v) return;
  if (rec.mode === 'line' && rec.taken == null) restoreLine(rec);
  else if (v.parts?.cap?.mesh && v.parts.cap.mesh.parent !== v.parts.cap.parent) { v.parts.cap.mesh.removeFromParent(); }
  for (const k of ['bundle', 'flat', 'tunic', 'kitCap']) { const o = v[k]; if (o) { o.removeFromParent(); if (k === 'tunic' || k === 'bundle') o.traverse((q) => { if (q.isMesh && q.geometry) q.geometry.dispose(); }); v[k] = null; } }
  const inner = rec.a?.model?.real?.inner;
  if (inner?.showHeadgear && v.hg !== undefined && v.hg !== null) inner.showHeadgear(null);
}

/** The rolled bundle of uniform under her arm (field grey, a darker collar showing at one end). */
function makeBundle() {
  const g = new Object3D(); g.name = 'spy_bundle';
  const { Mesh, CylinderGeometry, MeshStandardMaterial } = THREE_REF;
  const mat = BUNDLE_MAT ||= new MeshStandardMaterial({ color: 0x6b6f5f, roughness: 0.95 });
  const dark = BUNDLE_DARK ||= new MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.9 });
  const geo = new CylinderGeometry(0.055, 0.062, 0.26, 12, 4);
  const pa = geo.attributes.position;
  for (let k = 0; k < pa.count; k++) {   // folds: a lumpy roll
    const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k), a = Math.atan2(z, x);
    const r = 1 + 0.08 * Math.sin(a * 3 + y * 20) + 0.05 * Math.sin(a * 5 - y * 31);
    pa.setX(k, x * r); pa.setZ(k, z * r * 0.82);
  }
  geo.computeVertexNormals();
  const roll = new Mesh(geo, mat); roll.rotation.x = Math.PI / 2; roll.castShadow = true; roll.userData.ownGeo = true;
  const band = new Mesh(new CylinderGeometry(0.058, 0.058, 0.03, 12), dark); band.rotation.x = Math.PI / 2; band.position.z = 0.11; band.scale.z = 0.82;
  g.add(roll, band);
  return g;
}
let BUNDLE_MAT = null, BUNDLE_DARK = null;

/** Step a standalone garment cloth on the sim clock (gravity only, in its mesh frame). */
function stepCloth(cloth, mesh, dt) {
  if (!(dt > 0)) return;
  const e = mesh.matrixWorld.elements, g = [0, 0, 0];
  for (let c = 0; c < 3; c++) { const ax = e[c * 4], ay = e[c * 4 + 1], az = e[c * 4 + 2], s2 = ax * ax + ay * ay + az * az || 1; g[c] = (-9.81 * ay) / s2; }
  cloth.advance(dt, [0, 0, 0], g, 0);
}

function dressFrame(world, rec, now) {
  const a = rec.a, am = a?.model, T = rec.T;
  const t = now - rec.t0;
  if (t < 0) return true;
  rec.vis ||= {};
  const vis = rec.vis;
  const dt = vis.now != null ? Math.max(0, now - vis.now) : 0;
  vis.now = now;
  const end = rec.abort != null ? Math.min(T.dur, rec.abort + 0.25) : T.dur;
  const on = t <= end + SA.aOut + 0.25 && a.alive !== false && !a.removed && !(vis.walkAt != null && t > vis.walkAt + 0.25);
  if (!on) return false;
  if (!realBody(am)) return true;
  const B = bonesOf(am), M = contactMarks(am);
  if (!M) return false;
  dressPose(world, rec, am, B, M, t, dt, end);
  finish(am);
  return true;
}

function dressPose(world, rec, m, B, M, t, dt, end) {
  const vis = rec.vis, T = rec.T, root = m.root, line = rec.mode === 'line';
  const W = overlayW(rec, t, end);
  const pose0 = pose0Of(m, vis);
  const D = t - T.d0;                                   // dressing clock
  const dressing = D >= 0 && rec.abort == null;
  const L = line ? lineParts(rec) : null;
  const F = frameOf(root), fwd = F.l.clone();
  const P = (f, l, u) => root.position.clone().addScaledVector(F.f, f).addScaledVector(F.l, l).addScaledVector(F.u, u);
  if (!vis.feet0) {
    if (pose0) { const keep = capturePose(m); mixPose(m, pose0, 1); upd(root); vis.feet0 = feetOf(B); mixPose(m, keep, 1); upd(root); } else vis.feet0 = feetOf(B);
  }
  const pre = capturePose(m);
  const idle = clipPose(m, 'idle', 0);
  if (idle) mixPose(m, idle, 1, m._guard);
  upd(root);
  // ---- feet: settle into the take spot (from the pose shown before), the step behind the laundry (right foot, left)
  const feetHere = feetOf(B);
  const feet = { l: { ...feetHere.l }, r: { ...feetHere.r } };
  const arc = (a0, a1, k, lift) => ({ p: a0.p.clone().lerp(a1.p, k).addScaledVector(F.u, lift * Math.sin(Math.PI * clamp(k, 0, 1))), q: a0.q.clone().slerp(a1.q, k) });
  if (line && t < 0.2) { feet.l = arc(vis.feet0.l, feetHere.l, ramp(t, 0, 0.12), 0.06); feet.r = arc(vis.feet0.r, feetHere.r, ramp(t, 0.04, 0.18), 0.06); }
  if (line && rec.plan?.cover && T.step > 0 && rec.abort == null) {
    if (!vis.stepFeet && t >= T.take - 0.02) vis.stepFeet = feetOf(B);            // where the feet were as she set off
    if (vis.stepFeet && t < T.take + T.step + 0.05) {
      const s0 = T.take, s1 = T.take + T.step;
      // a side-shuffle: the leading foot half way, the trailing foot all the way, the leading foot home
      const d = s1 - s0, mv = new Vector3(rec.plan.cover.x - rec.plan.take.x, 0, rec.plan.cover.z - rec.plan.take.z);
      const lead = mv.dot(F.l) >= 0 ? 'l' : 'r', trail = lead === 'l' ? 'r' : 'l';
      const mid = { p: vis.stepFeet[lead].p.clone().lerp(feetHere[lead].p, 0.55), q: vis.stepFeet[lead].q.clone().slerp(feetHere[lead].q, 0.55) };
      feet[lead] = t < s0 + d * 0.5 ? arc(vis.stepFeet[lead], mid, ramp(t, s0, s0 + d * 0.38), 0.08) : arc(mid, feetHere[lead], ramp(t, s0 + d * 0.66, s1 + 0.04), 0.07);
      feet[trail] = arc(vis.stepFeet[trail], feetHere[trail], ramp(t, s0 + d * 0.3, s0 + d * 0.74), 0.08);
      if (rec.plan.cover.duck) {   // under the line: knees bent, head down
        const dk = bump(t, s0, s1);
        setPelvisWorld(m, B, wp(B.pelvis).addScaledVector(F.u, -0.3 * dk));
        turn(m, B.spine_01, fwd, 0.35 * dk); turn(m, B.spine_02, fwd, 0.25 * dk); turn(m, B.neck_01, fwd, 0.2 * dk);
      }
    }
  }
  // ---- hand targets: world palm points, finger / palm directions, elbow pole offsets [left, up, forward]
  const H = {};
  const add = (s, w, p, f, n, pole) => { if (w > 1e-3) (H[s] ||= []).push({ w, p, f: f.clone().normalize(), n: n.clone().normalize(), pole }); };
  const head = wp(B.Head), chestF = at(B, 'spine_03', M.chestPt);
  const bundleAt = () => wp(B.spine_03).addScaledVector(F.l, 0.19).addScaledVector(F.u, -0.13).addScaledVector(F.f, 0.0);
  const lHold = P(0.24, 0.13, 0.98);                                  // her left hand at her left front waist
  if (line && L && !vis.hands) assignHands(rec, L, world);
  if (line && L) {
    // both hands to the near corners of the tunic and the trousers, pulled down to her chest, rolled under her left arm
    for (const s of ['l', 'r']) {
      const hd = vis.hands?.[s];
      if (!hd) continue;
      const ts = t - (s === 'l' ? VD.leftLag : 0);                    // the left hand a beat after the right
      const cl = hd.pc.cloth, mesh = hd.pc.mesh, k = hd.k;
      const corner = new Vector3(cl.x[k * 3], cl.x[k * 3 + 1], cl.x[k * 3 + 2]).applyMatrix4(mesh.matrixWorld);
      const reachP = corner.addScaledVector(F.u, -0.03).addScaledVector(F.f, -0.025);
      if (ts >= VD.grab) hd.grabP ||= reachP.clone();
      const w = ramp(ts, VD.reach[0], VD.reach[1]) * (1 - ramp(t, VD.toBundle[1], VD.toBundle[1] + 0.1));
      const chest = P(0.32, s === 'l' ? 0.12 : -0.12, 1.18), bun = bundleAt().addScaledVector(F.f, 0.1).addScaledVector(F.l, s === 'l' ? -0.02 : -0.12);
      const p = ts < VD.grab ? reachP : hd.grabP.clone().lerp(chest, ramp(ts, VD.grab, VD.pull[1])).lerp(bun, ramp(t, VD.toBundle[0], VD.toBundle[1]));
      const gk = ramp(ts, VD.grab, VD.grab + 0.12);
      add(s, w, p, F.u.clone().addScaledVector(F.f, 0.2 + 0.4 * gk), F.f.clone().addScaledVector(F.u, -0.5 * gk), s === 'l' ? [0.4, -0.5, -0.2] : [-0.4, -0.5, -0.2]);
    }
    // the cap: off its peg with the right hand, handed to the left
    const cap = L.cap?.mesh;
    if (cap) {
      if (!vis.capC) vis.capC = new THREE_REF.Box3().setFromObject(cap).getCenter(new Vector3());
      const w = ramp(t, VD.capReach[0], VD.capReach[1]) * (1 - ramp(t, VD.capHand, VD.capHand + 0.12));
      const grabP = vis.capC.clone().addScaledVector(F.f, -0.07).addScaledVector(F.u, 0.03);
      const p = t < VD.capGrab ? grabP : grabP.clone().lerp(P(0.36, -0.02, 1.62), ramp(t, VD.capLift[0], VD.capLift[1])).lerp(lHold.clone().addScaledVector(F.u, 0.07).addScaledVector(F.f, 0.03), ramp(t, VD.capLift[1], VD.capToL[1]));
      add('r', w, p, F.u.clone().addScaledVector(F.f, 0.4), F.f.clone().addScaledVector(F.l, 0.4), [-0.4, -0.5, -0.2]);
    }
  } else if (!line) {
    // U: the bundle (the officer's cap on top) from her kit behind her right hip, tucked under her left arm
    const w = ramp(t, VD.kitBack[0], VD.kitBack[1]) * (1 - ramp(t, VD.kitTuck[1], VD.kitTuck[1] + 0.1));
    add('r', w, P(-0.16, -0.22, 0.95).lerp(bundleAt().addScaledVector(F.f, 0.06), ramp(t, VD.kitTuck[0], VD.kitTuck[1])), F.u.clone().negate(), F.l, [-0.5, -0.4, -0.3]);
  }
  // the left hand cradles the bundle under her arm, then holds the cap at her waist until the dressing takes it
  const capTaken = line ? VDL.hang[1] : VDK.capR[1];
  const wHold = (line ? ramp(t, VD.toBundle[0] + 0.06, VD.toBundle[1] + 0.06) : ramp(t, VD.kitCap[0], VD.kitCap[1]))
    * (1 - ramp(t, T.d0 + capTaken, T.d0 + capTaken + 0.1)) * (rec.abort != null ? 1 - ramp(t, rec.abort + 0.1, rec.abort + 0.25) : 1);
  add('l', wHold, lHold, F.f.clone().addScaledVector(F.u, 0.2), F.l.clone().negate(), [0.4, -0.5, -0.1]);
  const V = line ? VDL : VDK;
  if (dressing) {
    const onHead = head.clone().addScaledVector(F.u, 0.12).addScaledVector(F.f, 0.1);
    if (line) {
      // the officer's cap: from her left hand up onto the line in front of her (her hands free for the tunic) …
      const hangP = capHangWorld(rec).clone().addScaledVector(F.f, -0.05).addScaledVector(F.u, 0.02);
      add('r', bump(D, V.hang[0] - 0.02, V.hang[3]), path(D, [[V.hang[1], lHold.clone().addScaledVector(F.u, 0.07)], [V.hang[2], hangP], [V.hang[3], P(0.25, -0.2, 1.1)]]),
        F.u.clone().addScaledVector(F.f, 0.4), F.f.clone().addScaledVector(F.l, 0.4), [-0.4, -0.5, -0.2]);
      // … and, buttoned up, off the line onto her head
      add('r', ramp(D, V.capReach[0], V.capReach[1]) * (1 - ramp(D, V.capUp[1], V.capUp[1] + 0.06)),
        path(D, [[V.capReach[1], hangP], [V.capUp[1] - 0.04, onHead]]), F.u.clone().addScaledVector(F.f, 0.4), F.f.clone().addScaledVector(F.l, 0.6), [-0.4, -0.45, -0.1]);
    } else {
      // the officer's cap: from her left hand into her right, up and on
      add('r', ramp(D, V.capR[0], V.capR[1]) * (1 - ramp(D, V.capUp[1], V.capUp[1] + 0.06)),
        D < V.capR[1] ? lHold.clone().addScaledVector(F.u, 0.07) : lHold.clone().lerp(onHead, ramp(D, V.capUp[0], V.capUp[1] - 0.04)),
        F.u.clone().addScaledVector(F.f, 0.4), F.f.clone().addScaledVector(F.l, 0.6), [-0.4, -0.45, -0.1]);
    }
    // her own cap off (right hand) and into the bundle
    add('r', bump(D, V.flat[0] - 0.02, V.flatToBundle[1] + 0.02),
      path(D, [[V.flat[1], head.clone().addScaledVector(F.u, 0.13).addScaledVector(F.f, 0.04)], [V.flatToBundle[1], bundleAt().addScaledVector(F.u, 0.06).addScaledVector(F.f, 0.06)]]),
      F.f.clone().addScaledVector(F.u, -0.3), F.u.clone().negate(), [-0.45, -0.3, -0.1]);
    // the tunic: out of the bundle by its collar, shaken out, swung round her back, arms into the sleeves
    add('r', ramp(D, V.tunicReach[0], V.tunicReach[1]) * (1 - ramp(D, V.sleeveR[0], V.sleeveR[1])),
      path(D, [[V.tunicReach[1], bundleAt().addScaledVector(F.f, 0.08)], [V.tunicReach[1] + 0.06, P(0.3, -0.28, 1.42)], [V.shake[1], P(0.3, -0.28, 1.45)],
        [V.swingR[0] + 0.07, P(0.08, -0.26, 1.6)], [V.swingR[1], P(-0.16, -0.12, 1.5)]]).addScaledVector(F.u, 0.035 * Math.sin(D * 40) * bump(D, V.shake[0], V.shake[1])),
      F.u, F.l.clone().negate(), [-0.5, -0.3, -0.2]);
    add('l', bump(D, V.sleeveL[0] - 0.04, V.sleeveL[1] + 0.04), P(-0.22, 0.26, 1.02).lerp(P(-0.12, 0.2, 1.3), ramp(D, V.sleeveL[0] + 0.08, V.sleeveL[1])),
      F.u.clone().negate().addScaledVector(F.f, -0.5), F.l, [0.5, -0.3, -0.3]);
    add('r', bump(D, V.sleeveR[0] - 0.04, V.sleeveR[1]), P(-0.2, -0.25, 1.0).lerp(P(0.05, -0.22, 0.95), ramp(D, V.sleeveR[0] + 0.06, V.sleeveR[1])),
      F.u.clone().negate().addScaledVector(F.f, -0.5), F.l.clone().negate(), [-0.5, -0.3, -0.3]);
    // buttons (right hand down the front, left holding the edge), the tug at the hem, a touch to the visor
    const bu = ramp(D, V.buttons[0], V.buttons[1]);
    const btn = Math.min(3, Math.floor(bu * 4)), sub = bu * 4 - btn;
    const top = chestF.clone().addScaledVector(F.u, 0.12).addScaledVector(F.f, 0.035), bot = chestF.clone().addScaledVector(F.u, -0.2).addScaledVector(F.f, 0.045);
    const wBtn = bump(D, V.buttons[0] - 0.06, V.buttons[1] + 0.04);
    add('r', wBtn, top.clone().lerp(bot, (btn + smooth(sub * 1.6 - 0.3)) / 4).addScaledVector(F.l, 0.01), F.l.clone().addScaledVector(F.u, -0.3), F.f.clone().negate(), [-0.5, -0.4, 0]);
    add('l', wBtn, chestF.clone().addScaledVector(F.l, 0.07).addScaledVector(F.f, 0.03).addScaledVector(F.u, -0.05), F.l.clone().negate().addScaledVector(F.u, -0.3), F.f.clone().negate(), [0.5, -0.4, 0]);
    const wHem = bump(D, V.hem[0] - 0.04, V.hem[1] + 0.03), tug = ramp(D, V.hem[0] + 0.03, V.hem[1]) * 0.05;
    add('l', wHem, P(0.17, 0.13, 0.86 - tug), F.u.clone().negate(), F.f.clone().negate(), [0.5, -0.3, 0]);
    add('r', wHem * (V.visor ? 1 - ramp(D, V.visor[0], V.visor[0] + 0.04) : 1), P(0.17, -0.13, 0.86 - tug), F.u.clone().negate(), F.f.clone().negate(), [-0.5, -0.3, 0]);
    if (V.visor) add('r', bump(D, V.visor[0], V.visor[1] + 0.02), head.clone().addScaledVector(F.f, 0.15).addScaledVector(F.u, 0.07), F.l.clone().addScaledVector(F.u, 0.3), F.f.clone().negate().addScaledVector(F.u, -0.5), [-0.5, -0.2, 0]);
    const sg = bump(D, V.shrug[0], V.shrug[1]);
    turn(m, B.clavicle_l, F.f, -0.18 * sg); turn(m, B.clavicle_r, F.f, 0.18 * sg);
  } else if (rec.abort != null && t >= rec.abort) {
    // watched: a pat of the right hand on the bundle (it goes in her kit with the cap)
    add('r', bump(t, rec.abort - 0.02, rec.abort + 0.22), bundleAt().addScaledVector(F.f, 0.08), F.u.clone().negate(), F.l, [-0.4, -0.4, -0.2]);
  }
  // ---- solve: lean as needed, legs to the feet, arms to the targets, eyes on the work
  const T_ = {};
  for (const s of ['l', 'r']) {
    const list = H[s];
    if (!list?.length) continue;
    let tw = 0; const p = new Vector3(), f = new Vector3(), n = new Vector3(), pole = [0, 0, 0];
    for (const e of list) {
      tw += e.w; const k = e.w / tw;
      p.lerp(e.p, k); f.lerp(e.f, k); n.lerp(e.n, k); for (let i = 0; i < 3; i++) pole[i] += (e.pole[i] - pole[i]) * k;
    }
    const q = handQ(B, s, f.normalize(), n.normalize());
    T_[s] = { wrist: p.clone().sub(q.off.clone().applyQuaternion(q.q)), q: q.q, pole, w: Math.min(1, tw) };
  }
  const reachLen = 0.97 * M.arm;
  const short = () => Math.max(T_.l ? wp(B.upperarm_l).distanceTo(T_.l.wrist) - reachLen : 0, T_.r ? wp(B.upperarm_r).distanceTo(T_.r.wrist) - reachLen : 0);
  const spineLean = (x) => { turn(m, B.spine_01, fwd, x * 0.3); turn(m, B.spine_02, fwd, x * 0.35); turn(m, B.spine_03, fwd, x * 0.35); };
  let more = 0;
  for (let it = 0; it < 3 && (T_.l || T_.r); it++) {
    const over = short();
    if (over <= 0.004) break;
    const dm = clamp(over / 0.5, 0, 0.45 - more);
    if (dm <= 1e-3) break;
    spineLean(dm); more += dm;
  }
  vis.short = short();
  const ahead = P(1, 0, 1.45);
  const look = !dressing
    ? (line ? path(t, [[0.1, P(0.45, 0, 1.55)], [VD.capReach[1], P(0.45, 0, 1.6)], [VD.capToL[1], P(0.35, 0.12, 1.0)], [T.take + 0.1, ahead]]) : path(t, [[0.05, P(0.4, -0.15, 1.1)], [VD.kitCap[1], P(0.35, 0.12, 1.0)], [T.d0, ahead]]))
    : line ? path(D, [[0, ahead], [VDL.hang[1], P(0.4, 0.1, 1.15)], [VDL.hang[2], P(0.6, -0.1, 1.65)], [VDL.flat[1], P(0.6, 0, 1.4)], [VDL.shake[1], P(0.45, -0.25, 1.35)],
      [VDL.sleeveR[1], P(0.5, 0, 1.3)], [VDL.buttons[0] + 0.04, P(0.25, 0, 0.95)], [VDL.capReach[1], P(0.6, -0.1, 1.65)], [VDL.capUp[1], P(0.8, 0, 1.55)], [VDL.hem[1], P(0.3, 0, 0.85)], [VDL.end, ahead]])
      : path(D, [[0, ahead], [VDK.capR[1], P(0.5, 0.1, 1.2)], [VDK.capUp[1], P(0.7, 0, 1.55)], [VDK.shake[1], P(0.45, -0.25, 1.35)], [VDK.sleeveR[1], P(0.5, 0, 1.3)],
        [VDK.buttons[0] + 0.04, P(0.25, 0, 0.95)], [VDK.hem[1], P(0.3, 0, 0.85)], [VDK.visor[1], P(1, 0, 1.6)]]);
  lookAt(m, B, F, look, 0.7);
  legsTo(m, B, F, feet);
  const poleAt = (s, p) => wp(B['upperarm_' + s]).addScaledVector(F.l, p[0]).addScaledVector(F.u, p[1]).addScaledVector(F.f, p[2]);
  for (const s of ['l', 'r']) if (T_[s]) limbIK(m, B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], T_[s].wrist, poleAt(s, T_[s].pole), T_[s].w, T_[s].q);
  curl(m, B, 'r', T_.r ? 0.55 * T_.r.w : 0, T_.r ? 0.4 * T_.r.w : 0);
  curl(m, B, 'l', T_.l ? 0.5 * T_.l.w : 0, T_.l ? 0.3 * T_.l.w : 0);
  vis.targets = T_;
  const src = t < end && pose0 ? pose0 : pre;
  if (W < 0.999 && src) mixPose(m, src, 1 - W, m._guard);
  upd(root);
  // ---- props, with the hands where they are drawn this frame
  dressProps(rec, m, B, F, t, D, dt, { L, line, dressing, bundleAt, P });
}

/**
 * Where she hangs the officer's cap while she dresses: on the line beside the laundry she stands behind (toward the
 * bare stretch where the uniform hung), by its strap, the crown toward her; where it hung before when she dresses at
 * the take spot. Line-group matrix of the cap, cached.
 */
function capHang(rec) {
  if (rec.vis.capHang) return rec.vis.capHang;
  const F = lineFrameArt(rec.line), spot = rec.plan.cover || rec.plan.take;
  const lxS = (spot.x - F.x) * F.ax + (spot.z - F.z) * F.az;
  const lx = rec.plan.cover ? lxS + (Math.sign(LAUNDRY.cap - lxS) || 1) * 0.42 : LAUNDRY.cap;
  const o = new Object3D();
  hangCap(o, lx);
  if (spot.side < 0) { o.position.z *= -1; o.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)); }
  o.updateMatrix();
  return (rec.vis.capHang = { local: o.matrix.clone(), lx });
}
/** World point her hand takes the hung cap by (its crown, a little above its centre). */
function capHangWorld(rec) {
  const g = rec.line.object3d, HG = capHang(rec);
  g.updateWorldMatrix(true, false);
  const M = g.matrixWorld.clone().multiply(HG.local);
  return new Vector3(0, 0.07, 0.02).applyMatrix4(M);
}
const lineFrameArt = (line) => { const F = lineFrame(line); return { x: F.x, z: F.z, ax: F.ax, az: F.az }; }; // honours visualAt / visualRot

/** Which hand takes which garment: from the take spot, the near corner on her left with her left hand. */
function assignHands(rec, L, world) {
  const tk = rec.plan?.take;
  if (!tk) return;
  const y = world.groundY ? world.groundY(tk.x, tk.z) : 0, at0 = new Vector3(tk.x, y, tk.z);
  const left = new Vector3(Math.sin(tk.h), 0, -Math.cos(tk.h));
  const out = {};
  for (const pc of [L.tunic, L.trousers]) {
    if (!pc?.cloth) continue;
    pc.mesh.updateWorldMatrix(true, false);
    const e = nearEdge(pc, at0), x = pc.cloth.x;
    const c = new Vector3(x[e.k * 3], x[e.k * 3 + 1], x[e.k * 3 + 2]).applyMatrix4(pc.mesh.matrixWorld);
    let side = c.sub(at0).dot(left) >= 0 ? 'l' : 'r';
    if (out[side]) side = side === 'l' ? 'r' : 'l';
    out[side] = { pc, ...e };
  }
  rec.vis.hands = out;
}

function dressProps(rec, m, B, F, t, D, dt, ctx) {
  const vis = rec.vis, T = rec.T, root = m.root, inner = m.real.inner, { L, line, dressing, bundleAt, P } = ctx;
  let bundleK = 0, bundleHand = null;
  // the garments: pinched corner in the hand, the pegs popping one after the other, rolled up into the bundle
  if (line && L && vis.hands) {
    const rollK = ramp(t, VD.roll[0], VD.roll[1]);
    for (const s of ['l', 'r']) {
      const hd = vis.hands[s], ts = t - (s === 'l' ? VD.leftLag : 0);
      if (!hd || hd.done || ts < VD.grab) continue;
      const { pc, k, far } = hd, cl = pc.cloth, mesh = pc.mesh;
      const pins = ts < VD.peg1 ? [k, far, 3] : ts < VD.peg2 ? [k, far] : [k];
      const key = pins.join(',');
      if (hd.pins !== key) { cl.setPinned(pins); hd.pins = key; }
      mesh.parent.updateWorldMatrix(true, false);
      if (rollK <= 0) {
        mesh.updateWorldMatrix(true, false);
        const lp = mesh.worldToLocal(palmPt(B, s));
        cl.movePin(k, lp.x, lp.y, lp.z);
      } else {   // rolled: shrinks into her hand (the corner held in the palm) as the bundle grows under her arm
        hd.c0 ||= new Vector3(cl.x[k * 3], cl.x[k * 3 + 1], cl.x[k * 3 + 2]);
        const sc = 1 - 0.85 * rollK, hp = mesh.parent.worldToLocal(palmPt(B, s));
        mesh.scale.setScalar(sc); mesh.position.copy(hp.sub(hd.c0.clone().multiplyScalar(sc)));
        cl.movePin(k, hd.c0.x, hd.c0.y, hd.c0.z);
        if (rollK >= 1) { mesh.visible = false; hd.done = true; }
      }
      mesh.updateMatrixWorld(true);
    }
    bundleK = ramp(t, VD.roll[0] + 0.02, VD.roll[1] + 0.02);
    const cap = L.cap?.mesh;
    if (cap) {
      if (t >= VD.capGrab && !vis.capInR) { B.hand_r.attach(cap); vis.capInR = true; }
      if (t >= VD.capHand && !vis.capInL) { B.hand_l.attach(cap); vis.capInL = true; }
    }
  } else if (!line) {
    if (t >= VD.kitOut && !vis.kitCap) { vis.kitCap = makeOfficerCapProp(); root.parent.add(vis.kitCap); }
    bundleK = t >= VD.kitOut ? 1 : 0;
    if (t >= VD.kitOut && t < VD.kitTuck[1]) bundleHand = palmPt(B, 'r').addScaledVector(F.f, 0.05);
    if (vis.kitCap && !vis.kitCapL) {
      if (t < VD.kitCap[1] - 0.04) {   // riding on the bundle: in her right hand, then under her arm
        const host = (bundleHand || bundleAt()).clone().addScaledVector(F.u, 0.07);
        setWorld(vis.kitCap, new Matrix4().compose(host, wq(root), new Vector3(1, 1, 1)));
      } else { B.hand_l.attach(vis.kitCap); vis.kitCapL = true; }
    }
  }
  if (line && t >= VD.roll[1] && rec.abort == null) bundleK = 1;
  const capObj = line ? L?.cap?.mesh : vis.kitCap;
  const V = line ? VDL : VDK;
  if (dressing) {
    // her own cap: off her head into her right hand (the outfit's cap itself, exactly as worn), then into the bundle
    if (D >= V.flat[1] && !vis.flat && D < V.flatToBundle[1]) {
      vis.flat = headgearProp(m, B, 'base');
      if (vis.flat) { B.Head.add(vis.flat); vis.flat.updateMatrixWorld(true); B.hand_r.attach(vis.flat); }
    }
    if (vis.flat) vis.flat.visible = D < V.flatToBundle[1] - 0.01;
    if (capObj && line) {
      // the officer's cap: from her left hand onto a peg of the line in front of her, then off it again onto her head
      const g = rec.line.object3d, HG = capHang(rec);
      if (D >= V.hang[1] - 0.01 && !vis.capInR2) { B.hand_r.attach(capObj); vis.capInR2 = true; }
      if (vis.capInR2 && !vis.capHung) {
        g.updateWorldMatrix(true, false);
        const k = ramp(D, V.hang[2] - 0.06, V.hang[2]);
        if (k > 0) setWorld(capObj, lerpM(capObj.matrixWorld.clone(), g.matrixWorld.clone().multiply(HG.local), k));
        if (D >= V.hang[2]) { g.add(capObj); HG.local.decompose(capObj.position, capObj.quaternion, capObj.scale); capObj.updateMatrixWorld(true); vis.capHung = true; }
      }
      if (vis.capHung && D >= V.capReach[1] && !vis.capInR3) { B.hand_r.attach(capObj); vis.capInR3 = true; }
      if (vis.capInR3) {
        const k = ramp(D, V.capUp[1] - 0.1, V.capUp[1] - 0.025);   // seated a frame or two before the outfit's own shows
        if (k > 0) setWorld(capObj, lerpM(capObj.matrixWorld.clone(), wornCapMatrix(m, B), k));
        capObj.visible = D < V.capUp[1];
      }
    } else if (capObj) {
      // the officer's cap: into her right hand, up, seated exactly where the outfit's own cap sits, which then shows
      if (D >= V.capR[1] - 0.01 && !vis.capInR2) { B.hand_r.attach(capObj); vis.capInR2 = true; }
      if (vis.capInR2) {
        const k = ramp(D, V.capUp[1] - 0.1, V.capUp[1] - 0.025);   // seated a frame or two before the outfit's own shows
        if (k > 0) setWorld(capObj, lerpM(capObj.matrixWorld.clone(), wornCapMatrix(m, B), k));
        capObj.visible = D < V.capUp[1];
      }
    }
    // the tunic: unrolled out of the bundle by its collar, shaken out, swung round her back; it is on at the swap
    if (D >= V.tunicReach[1] && D < V.swap && !vis.tunic) {
      vis.tunic = makeGarmentRef('tunic'); vis.tunic.frustumCulled = false;
      root.parent.add(vis.tunic);
      vis.tunic.quaternion.copy(wq(root));
      const cl = vis.tunic.userData.cloth;
      vis.tc0 = new Vector3(cl.x[3], cl.x[4], cl.x[5]);
      cl.setPinned([1]);
    }
    if (vis.tunic) {
      const cl = vis.tunic.userData.cloth, out = ramp(D, V.tunicReach[1], V.tunicReach[1] + 0.08);
      vis.tunic.visible = D < V.swap;
      if (vis.tunic.visible) {
        if (out < 1) {   // unrolling: grows from her hand, its collar corner kept in the palm
          const sc = 0.25 + 0.75 * out;
          vis.tunic.scale.setScalar(sc);
          vis.tunic.position.copy(palmPt(B, 'r').sub(vis.tc0.clone().multiplyScalar(sc).applyQuaternion(vis.tunic.quaternion)));
          vis.tunic.updateMatrixWorld(true);
          cl.movePin(1, vis.tc0.x, vis.tc0.y, vis.tc0.z);
        } else {         // then it hangs from her hand and swings with it
          if (vis.tunic.scale.x !== 1) { vis.tunic.scale.setScalar(1); }
          vis.tunic.updateMatrixWorld(true);
          const lp = vis.tunic.worldToLocal(palmPt(B, 'r'));
          cl.movePin(1, lp.x, lp.y, lp.z);
        }
        if (D >= V.sleeveL[0] + 0.06) {   // the far collar corner caught by her left hand behind her shoulder
          if (!vis.tPinned) { cl.setPinned([1, 5]); vis.tPinned = true; }
          const lp = vis.tunic.worldToLocal(palmPt(B, 'l'));
          cl.movePin(5, lp.x, lp.y, lp.z);
        }
        stepCloth(cl, vis.tunic, dt);
      }
    }
    bundleK = D < V.tunicReach[1] ? 1 : D < V.swap ? 0.75 : 0;
  } else if (rec.abort != null && t >= rec.abort) {
    const k = ramp(t, rec.abort, rec.abort + 0.2);
    bundleK = 1 - k;
    if (capObj) capObj.visible = k < 0.9;
  }
  if (bundleK > 0 || vis.bundle) {
    if (!vis.bundle) {
      vis.bundle = makeBundle(); B.spine_03.add(vis.bundle);
      setWorld(vis.bundle, new Matrix4().compose(bundleAt(), wq(root), new Vector3(1, 1, 1)));
      vis.bundleLocal = { p: vis.bundle.position.clone(), q: vis.bundle.quaternion.clone() };
    }
    const kk = Math.max(0.01, bundleK);
    if (bundleHand) setWorld(vis.bundle, new Matrix4().compose(bundleHand, wq(root), new Vector3(kk, kk, kk)));
    else { vis.bundle.position.copy(vis.bundleLocal.p); vis.bundle.quaternion.copy(vis.bundleLocal.q); vis.bundle.scale.setScalar(kk); vis.bundle.updateMatrixWorld(true); }
    vis.bundle.visible = bundleK > 0.02;
  }
  // headgear: her own until she lifts it off, none in between, the officer's once it is on (then the outfit's own)
  // (at a line the cap goes on after the swap: no headgear at all from her own cap's lifting to the officer's seating)
  const hg = !dressing ? null : D < V.flat[1] ? null : D < V.capUp[1] ? 'none' : D < V.swap ? 'disg' : null;
  if (hg !== (vis.hg ?? null) && inner.showHeadgear) { inner.showHeadgear(hg); vis.hg = hg; }
}

/** A point along keyed positions [[t, Vector3], …] at time x (eased between keys, held before / after). */
function path(x, keys) {
  if (x <= keys[0][0]) return keys[0][1].clone();
  for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) return keys[i - 1][1].clone().lerp(keys[i][1], ramp(x, keys[i - 1][0], keys[i][0]));
  return keys[keys.length - 1][1].clone();
}

/** Turn her neck and head toward a world point (weight w; yaw and pitch shared 40 / 60). */
function lookAt(m, B, F, p, w) {
  if (w <= 1e-3) return;
  const h = wp(B.Head), d = p.clone().sub(h);
  const yaw = Math.atan2(d.dot(F.l), d.dot(F.f)), pitch = Math.atan2(-d.dot(F.u), Math.hypot(d.dot(F.l), d.dot(F.f)));
  const y = clamp(yaw, -1, 1) * w, pt = clamp(pitch, -0.5, 0.9) * w;
  turn(m, B.neck_01, F.u, 0.4 * y); turn(m, B.Head, F.u, 0.6 * y);
  turn(m, B.neck_01, F.l, 0.4 * pt); turn(m, B.Head, F.l, 0.6 * pt);
}

/**
 * Dressing metrics as drawn now: which uniform pieces still hang on the line (visible, pegged), each hand to its target,
 * the cap and the bundle props, the headgear shown, disguised.
 */
export function dressMetrics(spy, line) {
  const m = spy?.model;
  const rec = (spy?.world?.spyActs || []).find((r) => r.kind === 'dress' && r.a === spy) || null;
  const uni = line?.object3d?.getObjectByName?.('clothesline_uniform');
  const onLine = {};
  for (const n of ['tunic', 'trousers', 'cap']) {
    const o = uni?.getObjectByName?.('laundry_' + n);
    onLine[n] = !!(o && uni.visible && o.visible && o.parent && (o.parent === uni) && (!o.userData.cloth || o.userData.cloth.pinned == null || o.userData.cloth.pinned.length >= 3));
  }
  const out = { onLine, disguised: !!spy?.disguised, mode: rec?.mode ?? null };
  if (!realBody(m) || !rec?.vis) return out;
  const B = bonesOf(m), v = rec.vis;
  const err = {};
  for (const s of ['l', 'r']) { const T_ = v.targets?.[s]; if (T_ && T_.w > 0.99) err[s] = +wp(B['hand_' + s]).distanceTo(T_.wrist).toFixed(4); }
  out.handErr = err;
  out.bundle = !!(v.bundle && v.bundle.visible);
  out.hg = v.hg ?? null;
  const cap = line ? v.parts?.cap?.mesh : v.kitCap;
  if (cap && cap.visible && cap.parent) {
    out.capParent = cap.parent.name;
    if (cap.parent === B.hand_l || cap.parent === B.hand_r) out.capToPalm = +wp(cap).distanceTo(palmPt(B, cap.parent === B.hand_l ? 'l' : 'r')).toFixed(4);
    const worn = new Vector3().setFromMatrixPosition(wornCapMatrix(m, B));
    out.capToWorn = +wp(cap).distanceTo(worn).toFixed(4);
  }
  for (const s of ['l', 'r']) {
    const hd = v.hands?.[s];
    if (hd && hd.pins != null && hd.pc.mesh.visible) {
      const cl = hd.pc.cloth, k = hd.k;
      const c = new Vector3(cl.x[k * 3], cl.x[k * 3 + 1], cl.x[k * 3 + 2]).applyMatrix4(hd.pc.mesh.matrixWorld);
      out['corner_' + s] = +c.distanceTo(palmPt(B, s)).toFixed(4);
    }
  }
  if (v.flat && v.flat.visible) {   // her own cap in her hand: its centre to her palm
    const c = new THREE_REF.Box3().setFromObject(v.flat).getCenter(new Vector3());
    out.flatToPalm = +c.distanceTo(palmPt(B, 'r')).toFixed(4);
  }
  if (v.tunic && v.tunic.visible) {
    const cl = v.tunic.userData.cloth;
    out.tunicCorner = +new Vector3(cl.x[3], cl.x[4], cl.x[5]).applyMatrix4(v.tunic.matrixWorld).distanceTo(palmPt(B, 'r')).toFixed(4);
  }
  return out;
}
