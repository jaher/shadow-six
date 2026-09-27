// ca_poses.js - overlay clips authored on the UAL skeleton (CC0 project code): kneel_shoot, drag, crawl, crawl_idle,
// die_prone, dead_prone. All contacts are solved geometrically (IK / ground clearance), not eyeballed.
import * as THREE from 'three';
import { rig, sampler, bake, liftPelvis, footPts, REST_H, footClearance, stanceWarp } from './ca_clipkit.js';
import { wpos, wquat, setWorldQuat, rotWorld, aimBone, twoBoneIKPole, handQuat, palmPoint } from './ca_ik.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UPPER = /^(spine_02|spine_03|neck_01|Head|clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const ease = (t) => t * t * (3 - 2 * t);
function spineBend(R, pitchDeg, yawDeg = 0) {
  for (const bn of ['spine_01', 'spine_02', 'spine_03']) {
    rotWorld(R.B[bn], new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), THREE.MathUtils.degToRad(pitchDeg / 3)));
    if (yawDeg) rotWorld(R.B[bn], new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), THREE.MathUtils.degToRad(yawDeg / 3)));
  }
}
function setPelvisY(R, y) { const p = wpos(R.B.pelvis); liftPelvis(R, y - p.y); }
// rotate ball (toe) bone so the toe tip reaches height y (keeps it from digging in)
function toeTo(R, s, y) {
  const b = R.B['ball_' + s], tip = b.localToWorld(R.loc['toe_' + s].clone()), o = wpos(b);
  const d = tip.clone().sub(o); const L = d.length(); const h = THREE.MathUtils.clamp((y - o.y) / L, -0.99, 0.99);
  const hz = Math.sqrt(1 - h * h); const flat = V(d.x, 0, d.z).normalize();
  aimBone(b, tip, flat.multiplyScalar(hz).setY(h));
}

// ---------------- kneel_shoot: right knee down, left foot flat forward, toes of the rear foot tucked ----------------
export function makeKneel(ual, C, { kneeY = 0.08, thighDeg = 18, footFwd = 0.40, rearLift = 0.05 } = {}) {
  const sI = sampler(ual, C.Idle_Loop), sA = sampler(ual, C.Pistol_Aim_Neutral);
  const flatDir = (yaw) => { const r = THREE.MathUtils.degToRad(yaw); return V(0.149 * Math.sin(r), -0.089, 0.149 * Math.cos(r)); };
  return bake(ual, 'kneel_shoot', 2.4, (t, R) => {
    sI(t, R); sA(0.05, R, UPPER);
    const B = R.B;
    const lT = wpos(B.calf_r).distanceTo(wpos(B.thigh_r)), lC = wpos(B.foot_r).distanceTo(wpos(B.calf_r)), lF = wpos(B.ball_r).distanceTo(wpos(B.foot_r));
    const a = THREE.MathUtils.degToRad(thighDeg), off = wpos(B.thigh_r).y - wpos(B.pelvis).y;
    setPelvisY(R, kneeY + lT * Math.cos(a) - off + 0.003 * Math.sin(t / 2.4 * Math.PI * 2));
    const hipL = wpos(B.thigh_l), hipR = wpos(B.thigh_r);
    // rear (right) leg: thigh down and back, knee on the ground; shin back and up; ball of the foot on the ground, toes tucked
    const knee = hipR.clone().add(V(-0.02, -lT * Math.cos(a), -lT * Math.sin(a)));
    aimBone(B.thigh_r, wpos(B.calf_r), knee.clone().sub(hipR));
    const ankleY = REST_H.ball + rearLift + Math.sqrt(Math.max(0, lF * lF - 0.10 * 0.10));
    const ay = ankleY - knee.y, az = Math.sqrt(Math.max(0, lC * lC - ay * ay));
    const ank = V(knee.x, ankleY, knee.z - az);
    aimBone(B.calf_r, wpos(B.foot_r), ank.clone().sub(wpos(B.calf_r)));
    aimBone(B.foot_r, wpos(B.ball_r), V(ank.x, REST_H.ball + rearLift, ank.z - 0.10).sub(wpos(B.foot_r)));
    toeTo(R, 'r', REST_H.toe + rearLift);   // MPFB boot sole + toe cap are ~5 cm thicker than the UAL toe
    // front (left) leg: foot flat ahead of the hip, knee up
    const ankL = V(hipL.x + 0.06, REST_H.ankle, hipL.z + footFwd);
    twoBoneIKPole(B.thigh_l, B.calf_l, B.foot_l, ankL, ankL.clone().add(V(0.08, 0.6, 0.2)), null);
    aimBone(B.foot_l, wpos(B.ball_l), flatDir(12));
    toeTo(R, 'l', REST_H.toe);
    spineBend(R, 8, 0);
  }, { userData: { source: 'project IK pose (UAL Idle breathing + Pistol_Aim_Neutral upper)', loop: true, pose: 'kneel' } });
}

// ---------------- drag: backward walk bent over (hands under the victim's armpits) ----------------
export function makeDrag(ual, C) {
  const W = C.Walk_Loop, T = W.duration; const sW = sampler(ual, W);
  const rev = bake(ual, 'walk_rev', T, (t, R) => sW(T - t, R));
  const dirs = { upperarm_l: V(0.15, -0.8, 0.6), lowerarm_l: V(0.05, -0.7, 0.7), upperarm_r: V(-0.15, -0.8, 0.6), lowerarm_r: V(-0.05, -0.7, 0.7) };
  const CH = { upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r' };
  const pose = (t, R) => {
    spineBend(R, 30); rotWorld(R.B.Head, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), THREE.MathUtils.degToRad(-18)));
    for (const [bn, d] of Object.entries(dirs)) aimBone(R.B[bn], wpos(R.B[CH[bn]]), d);
    liftPelvis(R, -0.06); liftPelvis(R, -footClearance(R));
  };
  const r = stanceWarp(ual, rev, { stanceFrac: 0.5, name: 'drag', poseFn: pose, sign: -1, fps: 30 });
  r.clip.duration = T; r.clip.userData = { source: 'UAL Walk_Loop reversed + project pose (ground-fixed, stance-warped)', loop: true, reverse: true };
  return r;
}

// drag v2: the commandos_a WALK (already stance-warped: planted feet move back at exactly V0) played BACKWARD in time
// => a backward walk whose planted feet move forward at exactly V0; root moves opposite the facing (meta.reverse)
export function makeDragFromWalk(ual, wk) {
  const T = wk.clip.duration, sW = sampler(ual, wk.clip);
  const dirs = { upperarm_l: V(0.15, -0.8, 0.6), lowerarm_l: V(0.05, -0.7, 0.7), upperarm_r: V(-0.15, -0.8, 0.6), lowerarm_r: V(-0.05, -0.7, 0.7) };
  const CH = { upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r' };
  const clip = bake(ual, 'drag', T, (t, R) => {
    sW(Math.max(0, T - t - 1e-4), R);
    spineBend(R, 30); rotWorld(R.B.Head, new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), THREE.MathUtils.degToRad(-18)));
    for (const [bn, d] of Object.entries(dirs)) aimBone(R.B[bn], wpos(R.B[CH[bn]]), d);
    liftPelvis(R, -footClearance(R));
  }, { userData: { source: 'commandos_a walk (UAL Walk_Loop, stance-warped) time-reversed + project pose', loop: true, reverse: true } });
  return { clip, V0: wk.V0 };
}

// ---------------- prone set ----------------
// the prone set (crawl*, crawl_idle*, prone_*, go_prone, get_up, die_prone, dead_prone) is authored by
//     tools/characters/prone (bake_prone.mjs -> write_anims.mjs, run after this job; docs/crawl-animation.md)

export function extraClips(ual, C, args = {}) {
  const out = [];
  out.push([makeKneel(ual, C, args.kneel || {}), {}]);
  const d = C.__walk ? makeDragFromWalk(ual, C.__walk) : makeDrag(ual, C); out.push([d.clip, { groundSpeed: +d.V0.toFixed(4), reverse: true }]);
  return out;
}
