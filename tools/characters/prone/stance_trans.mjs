// stance_trans.mjs - go_prone / get_up on one shared path (CC0 project code; docs/crawl-animation.md §4.4).
//
// The path runs over a phase s = 0..5 between six key poses:
//   0 PRONE  crawl_idle frame 0 (elbows planted)
//   1 HANDS  head up, hands drawn in under the shoulders (left palm flat, right fist on the weapon)
//   2 PUSH   arms straight, chest up, the right knee drawn forward under the hip, left toes still on the ground
//   3 KNEEL  rocked back onto the right knee, hands off the ground, the left foot planted forward
//   4 RISE   driving up off the left leg, the right foot pushing off and stepping through
//   5 IDLE   idle frame 0
// get_up plays it forward (0.6 s), go_prone backward (0.5 s, a quicker drop to the knee, a slower lowering at the end).
// Torso and arms blend per bone between the key poses; the hip centre, both legs and the planted hands are solved
// every frame from explicit world targets (knee on the ground, toes on the ground, a swinging foot on an arc above the
// ground), so no limb passes through the ground, nothing levitates and no contact slides more than a few cm.
// No root motion: the hip stays within ~0.15 m of the root and ends over it like idle.
import * as THREE from 'three';
import { V } from './rig.mjs';
import { layTorso, legPose, sstep, lerp } from './pose.mjs';

const D2R = Math.PI / 180;
const KNEE_Y = 0.08, ANKLE_KNEEL_Y = 0.15;   // knee joint / ankle of the kneeling leg (toes then just on the ground)

/** Monotone cubic (Fritsch-Carlson) through (xs[i], ys[i]): smooth, no overshoot between knots. */
export function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const q4 = new THREE.Quaternion(), q5 = new THREE.Quaternion();
/** Set bone n's WORLD rotation. */
function setWorldQ(R, n, q) {
  const b = R.B[n]; b.parent.updateMatrixWorld(true);
  b.quaternion.copy(b.parent.getWorldQuaternion(q4).invert().multiply(q)); b.updateMatrixWorld(true);
}
/** Blend the local rotations of `names` from snapshot-like {q} `from` toward the current pose by weight w (0 = from). */
function mixFrom(R, from, names, w) {
  if (w >= 1) return;
  for (const n of names) { if (!from[n]) continue; q5.fromArray(from[n]); R.B[n].quaternion.copy(q5.slerp(R.B[n].quaternion, w)); }
  R.update();
}
const grab = (R, names) => Object.fromEntries(names.map((n) => [n, R.B[n].quaternion.toArray()]));
const legBones = (s) => ['thigh_' + s, 'calf_' + s, 'foot_' + s, 'ball_' + s];
const armBones = (s) => ['clavicle_' + s, 'upperarm_' + s, 'lowerarm_' + s, 'hand_' + s];

/** Knee on the ground toward Kt (at thigh length from the hip joint), shin back to the ankle, foot at world q. */
function kneelLeg(R, s, Kt, footQ) {
  const H = R.wp('thigh_' + s), L1 = R.len['thigh_' + s], L2 = R.len['calf_' + s];
  const dy = Kt.y - H.y, hz = Math.sqrt(Math.max(0, L1 * L1 - dy * dy));
  const dir = V(Kt.x - H.x, 0, Kt.z - H.z); if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1); dir.normalize();
  const K = H.clone().addScaledVector(dir, hz); K.y = H.y + Math.max(dy, -L1);
  const ay = ANKLE_KNEEL_Y - K.y, A = K.clone().add(V(0, ay, -Math.sqrt(Math.max(0, L2 * L2 - ay * ay))));
  const d1 = K.clone().sub(H).normalize(), d2 = A.clone().sub(K).normalize();
  // the knee hinge stays lateral (no thigh twist): kneecap forward when upright, toward the ground when prone
  const hinge = V(-1, 0, 0).addScaledVector(d1, d1.x).normalize();
  R.orient('thigh_' + s, d1, new THREE.Vector3().crossVectors(hinge, d1)); R.orient('calf_' + s, d2, new THREE.Vector3().crossVectors(hinge, d2));
  setWorldQ(R, 'foot_' + s, footQ); R.update();
  return { K, A };
}
/** Two-bone leg: ankle at A, knee toward pole, foot at world rotation footQ. */
function ikLeg(R, s, A, pole, footQ) {
  legPose(R, s, A, pole, 0.5);
  setWorldQ(R, 'foot_' + s, footQ); R.update();
}

/**
 * Build both transition clips.
 * @param {{R:object, sample:Function}} ctx bake context; PRONE / IDLE snapshots; arm / torso key builders
 */
export function stanceClips(ctx, { PRONE, IDLE, upright, crawlHandsIn }) {
  const { R, sample } = ctx;
  // ---------------- references from the end poses ----------------
  const ref = (snap) => {
    R.apply(snap);
    const o = { hip: R.wp('thigh_l').lerp(R.wp('thigh_r'), 0.5) };
    for (const s of ['l', 'r']) {
      o['ankle_' + s] = R.wp('foot_' + s); o['ball_' + s] = R.wp('ball_' + s); o['knee_' + s] = R.wp('calf_' + s);
      o['footQ_' + s] = R.wq('foot_' + s);
      // knee pole: from the hip-ankle midline toward the knee
      o['pole_' + s] = R.wp('calf_' + s).sub(R.wp('thigh_' + s).lerp(R.wp('foot_' + s), 0.5)).normalize();
      // ball joint in the foot's frame (for a pivot about the planted toes)
      o['ballOff_' + s] = o['ball_' + s].clone().sub(o['ankle_' + s]).applyQuaternion(o['footQ_' + s].clone().invert());
      // palm point, hand axes and elbow pole (for the hands drawn in along the ground)
      const ax = R.axes('hand_' + s);
      o['palm_' + s] = R.wp('hand_' + s).lerp(R.wp('middle_01_' + s), 0.55); o['ha_' + s] = ax.along; o['th_' + s] = ax.front;
      o['elbow_' + s] = R.wp('lowerarm_' + s).sub(R.wp('upperarm_' + s).lerp(R.wp('hand_' + s), 0.5)).normalize();
    }
    return o;
  };
  const P = ref(PRONE), I = ref(IDLE);
  // ---------------- explicit targets over the phase s ----------------
  // right knee: drawn forward 7 cm along the ground (1 -> 2), then the pivot of the kneel (2 -> 3)
  const KR = V(-0.13, KNEE_Y, -0.3);
  const kneeR = (s) => s <= 1 ? P.knee_r.clone() : s >= 2 ? KR.clone() : P.knee_r.clone().lerp(KR, sstep(s - 1));
  // hip height: flat -> pushed up -> kneeling -> rising -> standing
  const hipY = monotone([0, 1, 2, 3, 4, 5], [P.hip.y, P.hip.y, 0.33, 0.45, 0.72, I.hip.y]);
  // hip z: in 1..3 the right thigh reaches the right knee on the ground (the knee does not slide); then to idle
  const hzKnee = (s) => {
    const K = kneeR(s), hx = -0.089, dy = hipY(s) - K.y;
    return K.z + Math.sqrt(Math.max(0, R.len.thigh_r ** 2 - dy * dy - (hx - K.x) ** 2));
  };
  const hz3 = hzKnee(3), hipZhi = monotone([3, 4, 5], [hz3, -0.08, I.hip.z]);
  const hipZ = (s) => s <= 1 ? P.hip.z + (hzKnee(1) - P.hip.z) * Math.max(0, s) : s <= 3 ? hzKnee(s) : hipZhi(s);
  const hipAt = (s) => V(lerp(P.hip.x, I.hip.x, sstep((s - 3) / 2)), hipY(s), hipZ(s));
  // left foot: toes drag in 5 cm while the body pushes up (1 -> 2), swing forward on an arc (2 -> 3), planted (3 -> 5)
  const ankL2 = P.ankle_l.clone().add(V(0, 0.04, 0.05));   // crawl_idle's toes sit 2 cm deep (fitted per body): up onto the ground
  // right foot: kneeling toes (1 -> 3), heel lifts about the planted toes (3 -> 3.5), steps through (3.5 -> 4.6)
  const heelUp = (u) => P.footQ_r.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -35 * D2R * u));
  // ---------------- key poses (torso + arms; legs are re-solved per frame) ----------------
  const place = (s) => { const H = hipAt(s); const hc = R.wp('thigh_l').lerp(R.wp('thigh_r'), 0.5); R.pelvisAt(R.wp('pelvis').add(H.sub(hc))); R.update(); };
  // hands planted 1 -> 2 (the same palms as the HANDS key)
  const HL = { palm: V(0.2, 0.03, 0.6), ha: V(0, -0.1, 1).normalize(), th: V(-1, 0.2, 0) };
  const HR = { palm: V(-0.2, 0.06, 0.58), ha: V(0.1, -0.05, 1).normalize(), th: V(0.35, 1, 0) };
  const plantHands = (poleL, poleR) => {
    R.handTo('l', HL.palm, HL.ha, HL.th, poleL); R.curl('l', 0.15, 0.2);
    R.handTo('r', HR.palm, HR.ha, HR.th, poleR); R.curl('r', 1, 0.8);
  };
  const keys = [];
  keys[0] = PRONE;
  crawlHandsIn(R); plantHands(V(1, -0.3, -0.8), V(-1, -0.3, -0.8)); keys[1] = R.snap();
  R.reset(); layTorso(R, { hip: hipAt(2), pitch: 12 * D2R, chest: 0.12, neck: 0.85, head: { pitch: 0.3 } });
  plantHands(V(0.3, -0.2, -1), V(-0.3, -0.2, -1)); keys[2] = R.snap();
  R.reset(); upright(R, hipAt(3), 30 * D2R, { headPitch: 0.15 });
  R.handTo('l', V(0.24, 0.5, 0.36), V(0, -0.8, 0.6).normalize(), V(-0.8, 0, 0.3), V(0.6, -0.2, -0.5)); R.curl('l', 0.3, 0.3);   // left hand on the left knee
  R.handTo('r', V(-0.22, 0.45, 0.3), V(0.05, 0.3, 0.95).normalize(), V(0.3, 1, -0.3), V(-0.6, -0.3, -0.5)); R.curl('r', 1, 0.8);   // weapon low, muzzle forward-up
  keys[3] = R.snap();
  R.reset(); upright(R, hipAt(4), 15 * D2R, { headPitch: 0.1 });
  R.handTo('l', V(0.25, 0.78, 0.17), V(0, -1, 0.2).normalize(), V(0, 0, 1), V(0.5, 0, -0.8)); R.curl('l', 0.3, 0.3);
  R.handTo('r', V(-0.25, 0.78, 0.3), V(0.05, 0.15, 0.99).normalize(), V(0.3, 1, 0), V(-0.5, 0, -0.8)); R.curl('r', 1, 0.8);
  keys[4] = R.snap();
  keys[5] = IDLE;
  const LEGS = [...legBones('l'), ...legBones('r')], ARMS = [...armBones('l'), ...armBones('r')];
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const base = (s) => {
    const i = Math.min(4, Math.max(0, Math.floor(s))), u = sstep(s - i), a = keys[i], b = keys[i + 1];
    for (const n in a.q) { qa.fromArray(a.q[n]); qb.fromArray(b.q[n]); R.B[n].quaternion.copy(qa.slerp(qb, u)); }
    R.B.pelvis.position.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), u); R.update();
  };
  // ---------------- one frame of the path ----------------
  const pose = (s) => {
    s = Math.min(5, Math.max(0, s));
    base(s);
    if (s <= 1) {   // 0 -> 1: the prone body draws its hands in, sliding them back just over the ground
      const armsBase = grab(R, ARMS), e = sstep(s), lift = 0.07 * Math.sin(Math.PI * s);
      for (const [sd, H, pole] of [['l', HL, V(1, -0.3, -0.8)], ['r', HR, V(-1, -0.3, -0.8)]]) {
        const palm = P['palm_' + sd].clone().lerp(H.palm, e); palm.y += lift;
        R.handTo(sd, palm, P['ha_' + sd].clone().lerp(H.ha, e).normalize(), P['th_' + sd].clone().lerp(H.th, e).normalize(),
          P['elbow_' + sd].clone().lerp(pole.clone().normalize(), e).normalize());
      }
      mixFrom(R, armsBase, ARMS, sstep(s / 0.3));
      return;
    }
    place(s);
    const legsBase = grab(R, LEGS), armsBase = grab(R, ARMS);
    // right leg
    if (s <= 3) kneelLeg(R, 'r', kneeR(s), P.footQ_r);
    else {
      const B = B3.clone();   // the toes planted at the end of the kneel
      if (s <= 3.5) {
        const q = heelUp(sstep((s - 3) / 0.5));
        ikLeg(R, 'r', B.clone().sub(P.ballOff_r.clone().applyQuaternion(q)), V(-0.1, -0.3, 1).normalize(), q);
      } else {
        const q0 = heelUp(1), A0 = B.clone().sub(P.ballOff_r.clone().applyQuaternion(q0));
        const u = Math.min(1, (s - 3.5) / 1.1), e = sstep(u);
        const A = A0.lerp(I.ankle_r, e); A.y += 0.1 * Math.sin(Math.PI * u);
        ikLeg(R, 'r', A, V(-0.1, -0.3, 1).normalize().lerp(I.pole_r, e).normalize(), q0.slerp(I.footQ_r, e));
      }
    }
    // left leg
    if (s <= 2) ikLeg(R, 'l', P.ankle_l.clone().lerp(ankL2, sstep((s - 1) / 0.5)), P.pole_l, P.footQ_l);
    else if (s <= 3) {
      const u = s - 2, e = sstep(u), A = ankL2.clone().lerp(I.ankle_l, e); A.y += 0.15 * Math.sin(Math.PI * u);
      ikLeg(R, 'l', A, P.pole_l.clone().lerp(I.pole_l, e).normalize(), P.footQ_l.clone().slerp(I.footQ_l, e));
    } else ikLeg(R, 'l', I.ankle_l, I.pole_l, I.footQ_l);
    // the per-frame solve takes over from the key blend over 1 -> 1.4 (no twist pop where it starts)
    mixFrom(R, legsBase, LEGS, sstep((s - 1) / 0.4));
    // hands planted 1 -> 2, lifting off over 2 -> 2.35
    if (s < 2.35) {
      const t = Math.min(1, s - 1);
      plantHands(V(1, -0.3, -0.8).lerp(V(0.3, -0.2, -1), t), V(-1, -0.3, -0.8).lerp(V(-0.3, -0.2, -1), t));
      mixFrom(R, armsBase, ARMS, s <= 2 ? 1 : 1 - sstep((s - 2) / 0.35));
    }
    // the last stretch settles into idle frame 0 exactly
    if (s > 4.3) {
      const w = sstep((s - 4.3) / 0.7);
      for (const n in IDLE.q) { q5.fromArray(IDLE.q[n]); R.B[n].quaternion.slerp(q5, w); }
      R.B.pelvis.position.lerp(new THREE.Vector3().fromArray(IDLE.p), w); R.update();
    }
  };
  // the key poses carry the solved legs too, so the key blend that the solve takes over from is already close
  pose(3); const B3 = R.wp('ball_r');   // right toes where the kneel leaves them: the push-off pivots about them
  for (const k of [2, 3, 4]) { pose(k); const sn = R.snap(); for (const n of LEGS) keys[k].q[n] = sn.q[n]; keys[k].p = sn.p; }
  // ---------------- clips ----------------
  const upT = monotone([0, 0.1, 0.25, 0.37, 0.47, 0.6], [0, 1, 2, 3, 4, 5]);
  const downT = monotone([0, 0.06, 0.14, 0.27, 0.42, 0.5], [5, 4, 3, 2, 1, 0]);
  // hand plant weight per frame (contacts.hd, digits 0-9 per side): the runtime fit keeps these palms on the ground
  // on every body (art/characters/prone-fit.js 4h)
  const handW = (s) => s < 1 ? sstep((s - 0.6) / 0.4) : s <= 2 ? 1 : 1 - sstep((s - 2) / 0.35);
  const hd = (warp) => (t) => { const k = Math.round(9 * handW(warp(t))); return { hd: [k, k] }; };
  sample('go_prone', 0.5, 30, (t) => pose(downT(t)), { loop: false, transition: true, prone: true, next: 'crawl_idle', phases: [0, 0.06, 0.14, 0.27, 0.42, 0.5] }, hd(downT));
  sample('get_up', 0.6, 30, (t) => pose(upT(t)), { loop: false, transition: true, prone: true, next: 'idle', phases: [0, 0.1, 0.25, 0.37, 0.47, 0.6] }, hd(upT));
  return { pose, hipAt };
}
