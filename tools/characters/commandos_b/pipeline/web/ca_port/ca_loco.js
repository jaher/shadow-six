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
