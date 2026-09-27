// ca_loco.js - walk / run rebuilt from UAL Walk_Loop / Jog_Fwd_Loop (CC0): stride amplification + ground contact
// + stance-uniform time warp so the planted foot moves exactly with the ground at the clip's groundSpeed.
import * as THREE from 'three';
import { sampler, stanceWarp, liftPelvis, footClearance, rig } from './ca_clipkit.js';

// per-bone mean local quaternion over the clip
function meanQuats(ual, clip, names, N = 60) {
  const R = rig(ual), smp = sampler(ual, clip), acc = {};
  for (const n of names) acc[n] = new THREE.Vector4();
  for (let i = 0; i < N; i++) {
    smp(i / N * clip.duration, R);
    for (const n of names) { const q = R.B[n].quaternion; const a = acc[n]; const s = (a.x * q.x + a.y * q.y + a.z * q.z + a.w * q.w) < 0 ? -1 : 1; a.x += s * q.x; a.y += s * q.y; a.z += s * q.z; a.w += s * q.w; }
  }
  const out = {}; for (const n of names) { const a = acc[n].normalize(); out[n] = new THREE.Quaternion(a.x, a.y, a.z, a.w); } return out;
}
function powQ(q, k) {   // q^k for a unit quaternion
  const w = THREE.MathUtils.clamp(q.w, -1, 1); const ang = 2 * Math.acos(Math.abs(w)); if (ang < 1e-6) return new THREE.Quaternion();
  const s = Math.sin(ang / 2), sg = w < 0 ? -1 : 1; const ax = new THREE.Vector3(q.x * sg / s, q.y * sg / s, q.z * sg / s);
  return new THREE.Quaternion().setFromAxisAngle(ax, ang * k);
}
// amp: {boneName: k}
export function amplifier(ual, clip, amp) {
  const names = Object.keys(amp); const M = meanQuats(ual, clip, names);
  return (t, R) => {
    for (const n of names) { const b = R.B[n]; const d = M[n].clone().invert().multiply(b.quaternion); b.quaternion.copy(M[n]).multiply(powQ(d, amp[n])); }
    R.root.updateMatrixWorld(true);
  };
}
export function groundFix(R, dy = 0) { liftPelvis(R, -footClearance(R) + dy); }

export function makeWalk(ual, C, { k = 1.18, kKnee = 1.15, kArm = 1.2, stanceFrac = 0.5, name = 'walk' } = {}) {
  const src = C.Walk_Loop; const amp = {};
  for (const s of ['l', 'r']) Object.assign(amp, { ['thigh_' + s]: k, ['calf_' + s]: kKnee, ['foot_' + s]: 1.15, ['upperarm_' + s]: kArm, ['lowerarm_' + s]: 1.1 });
  Object.assign(amp, { pelvis: 1.2, spine_01: 1.2, spine_02: 1.2 });
  const A = amplifier(ual, src, amp);
  const poseFn = (t, R) => { A(t, R); groundFix(R); };
  const r = stanceWarp(ual, src, { stanceFrac, name, poseFn });
  r.clip.userData = { source: 'UAL Walk_Loop (stride x' + k + ', ground-fixed, stance-warped)', license: 'CC0 (Quaternius UAL + project)', loop: true };
  return r;
}
export function makeRun(ual, C, { stanceFrac = 0.37, cy = 0.06, name = 'run' } = {}) {
  const src = C.Jog_Fwd_Loop;
  const r = stanceWarp(ual, src, { stanceFrac, name, cy });
  r.clip.userData = { source: 'UAL Jog_Fwd_Loop (ground-fixed, stance-warped)', license: 'CC0 (Quaternius UAL + project)', loop: true };
  return r;
}

// ---- crouch_walk: the commandos_a walk (planted feet move at exactly V0) with the pelvis lowered `drop`, legs re-solved by
// two-bone IK to the SAME ankle paths / foot orientations (knees forward), torso pitched forward, head up, arm swing
// reduced. Same stride + ground speed as walk => no slip at game speed (the UAL crouch loop covers 0.7 m/s only).
import { bake } from './ca_clipkit.js';
import { wpos, wquat, setWorldQuat, rotWorld, twoBoneIKPole } from './ca_ik.js';
export function makeCrouchWalk(ual, wk, { drop = 0.16, pitch = 24, head = -16, armK = 0.6 } = {}) {
  const T = wk.clip.duration, sW = sampler(ual, wk.clip);
  const amp = {}; for (const s of ['l', 'r']) Object.assign(amp, { ['upperarm_' + s]: armK, ['lowerarm_' + s]: armK });
  const A = amplifier(ual, wk.clip, amp);
  const X = new THREE.Vector3(1, 0, 0);
  const clip = bake(ual, 'crouch_walk', T, (t, R) => {
    sW(t, R); A(t, R); const B = R.B, keep = {};
    for (const s of ['l', 'r']) keep[s] = { a: wpos(B['foot_' + s]), qf: wquat(B['foot_' + s]), qb: wquat(B['ball_' + s]) };
    liftPelvis(R, -drop);
    for (const bn of ['spine_01', 'spine_02', 'spine_03']) rotWorld(B[bn], new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(pitch / 3)));
    rotWorld(B.neck_01, new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(head * 0.5)));
    rotWorld(B.Head, new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(head * 0.5)));
    for (const s of ['l', 'r']) {
      const side = s === 'l' ? 1 : -1, hip = wpos(B['thigh_' + s]);
      twoBoneIKPole(B['thigh_' + s], B['calf_' + s], B['foot_' + s], keep[s].a, hip.clone().add(new THREE.Vector3(side * 0.12, -0.25, 1.0)), keep[s].qf);
      setWorldQuat(B['ball_' + s], keep[s].qb);
    }
    // elbows bent a little more (compact carry), forearms forward
    for (const s of ['l', 'r']) rotWorld(B['lowerarm_' + s], new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(-25)));
    R.root.updateMatrixWorld(true);
  }, { userData: { source: 'commandos_a walk (UAL Walk_Loop, stance-warped) lowered ' + drop + ' m, leg IK to the same foot paths', license: 'CC0 (Quaternius UAL + project)', loop: true } });
  return { clip, V0: wk.V0 };
}

// ---- swim: UAL Swim_Fwd_Loop (a breaststroke) re-timed with a GLIDE: output time per source sample is inversely
// proportional to the hands' speed (fast pull + recovery, long streamlined glide with the arms extended), clip lengthened
// to T. Stroke length D (source units) sets groundSpeed = D / T: at 1.8 m/s the cycle is ~1.15 s (52 strokes/min,
// ~2.1 m per stroke - a strong breaststroke) instead of 0.49 s.
export function makeSwim(ual, C, { T = 1.6, D = 1.87, soft = 0.45, N = 240 } = {}) {
  const src = C.Swim_Fwd_Loop, Ts = src.duration, R = rig(ual), smp = sampler(ual, src);
  const P = [];
  for (let i = 0; i <= N; i++) { R.reset(); smp(i / N * Ts, R); const pel = wpos(R.B.pelvis); P.push(['hand_l', 'hand_r'].map(n => wpos(R.B[n]).sub(pel))); }
  const v = []; for (let i = 0; i < N; i++) v.push(Math.max(P[i + 1][0].distanceTo(P[i][0]), P[i + 1][1].distanceTo(P[i][1])));
  const mv = v.reduce((a, b) => a + b, 0) / N;
  const sm = v.map((_, i) => { let a = 0; for (let k = -4; k <= 4; k++) a += v[(i + k + N) % N]; return a / 9; });
  const w = sm.map(x => 1 / (x + soft * mv)); const tot = w.reduce((a, b) => a + b, 0);
  const U = [0]; for (let i = 0; i < N; i++) U.push(U[i] + w[i] / tot);
  const sOf = (u) => { let i = 0; while (i < N - 1 && U[i + 1] < u) i++; const k = (u - U[i]) / Math.max(1e-9, U[i + 1] - U[i]); return (i + THREE.MathUtils.clamp(k, 0, 1)) / N * Ts; };
  const clip = bake(ual, 'swim', T, (t, RR) => smp(sOf((t / T) % 1 || (t >= T ? 1 : 0)), RR), { userData: { source: 'UAL Swim_Fwd_Loop re-timed with a glide phase (project)', license: 'CC0 (Quaternius UAL + project)', loop: true } });
  return { clip, V0: D / T };
}
