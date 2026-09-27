// ca_clipkit.js - clip baking / time-warp / ground-contact helpers on the ORIGINAL UAL skeleton (CC0 project code)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { bonesOf, orderedBones } from '/chars/pipeline/web/rig_util.js';
import { wpos } from './ca_ik.js';

export function rig(ual) {
  const root = SkeletonUtils.clone(ual.scene); root.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });
  const B = bonesOf(root), order = orderedBones(root);
  const rest = order.map(b => [b, b.quaternion.clone(), b.position.clone()]);
  root.updateMatrixWorld(true);
  // sole points in bone-local space from the bind pose: heel under the ankle (foot bone), toe tip ahead of the ball (ball bone)
  const loc = {};
  for (const s of ['l', 'r']) {
    const a = wpos(B['foot_' + s]), b = wpos(B['ball_' + s]);
    loc['heel_' + s] = B['foot_' + s].worldToLocal(new THREE.Vector3(a.x, REST_H.heel, a.z - 0.055));
    loc['toe_' + s] = B['ball_' + s].worldToLocal(new THREE.Vector3(b.x, REST_H.toe, b.z + 0.075));
  }
  return { root, B, order, rest, loc, reset() { rest.forEach(([b, q, p]) => { b.quaternion.copy(q); b.position.copy(p); }); root.updateMatrixWorld(true); } };
}
// sampler: poses a PRIVATE skeleton with the clip (PropertyMixer skip-bug safe), then copies into dst rig
export function sampler(ual, clip) {
  const src = rig(ual); const mixer = new THREE.AnimationMixer(src.root); mixer.clipAction(clip).play();
  return (t, dst, re = null) => {
    mixer.setTime(THREE.MathUtils.clamp(t, 0, clip.duration - 1e-4));
    for (const b of dst.order) { if (re && !re.test(b.name)) continue; const s = src.B[b.name]; if (!s) continue; b.quaternion.copy(s.quaternion); if (b.name === 'pelvis' && !re) b.position.copy(s.position); }
    dst.root.updateMatrixWorld(true);
  };
}
// bake poseFn(t, R) for t in [0,T] at fps into a clip (pelvis.position + every bone quaternion)
export function bake(ual, name, T, poseFn, { fps = 30, userData = {} } = {}) {
  const R = rig(ual); const n = Math.max(2, Math.round(T * fps) + 1);
  const times = new Float32Array(n), P = new Float32Array(n * 3), Q = {};
  R.order.forEach(b => Q[b.name] = new Float32Array(n * 4));
  for (let f = 0; f < n; f++) {
    const t = (f / (n - 1)) * T; R.reset(); poseFn(t, R); R.root.updateMatrixWorld(true);
    times[f] = t; R.order.forEach(b => b.quaternion.toArray(Q[b.name], f * 4)); R.B.pelvis.position.toArray(P, f * 3);
  }
  const tracks = [new THREE.VectorKeyframeTrack('pelvis.position', times, P)];
  R.order.forEach(b => { if (b.name !== 'root') tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, Q[b.name])); });
  const c = new THREE.AnimationClip(name, T, tracks); c.userData = { license: 'CC0 (project-authored)', ...userData }; return c;
}
// move the pelvis vertically in WORLD space by dy
export function liftPelvis(R, dy) { const p = wpos(R.B.pelvis); p.y += dy; R.B.pelvis.position.copy(R.B.pelvis.parent.worldToLocal(p)); R.root.updateMatrixWorld(true); }

// foot contact points (UAL units): ankle, ball, toe tip (ball + 0.075 along foot->ball), heel (ankle - 0.05 back, -0.07 down)
export function footPts(R, s) {
  const B = R.B; const a = wpos(B['foot_' + s]), b = wpos(B['ball_' + s]);
  return { ankle: a, ball: b, toe: B['ball_' + s].localToWorld(R.loc['toe_' + s].clone()), heel: B['foot_' + s].localToWorld(R.loc['heel_' + s].clone()) };
}
// rest heights of those points in UAL bind pose (sole on the ground)
export const REST_H = { ball: 0.015, toe: 0.012, heel: 0.03, ankle: 0.104 };
// lowest (point.y - rest height) over both feet; 0 = sole exactly on the ground
export function footClearance(R) {
  let m = 1e9;
  for (const s of ['l', 'r']) { const p = footPts(R, s); for (const k of ['ball', 'toe', 'heel']) m = Math.min(m, p[k].y - REST_H[k]); }
  return m;
}

// ---- stance-uniform time warp for in-place locomotion loops ----
// Samples `clip` densely; a foot is in contact while its ball is within `cy` of its minimum height. During contact
// the output spends time proportional to the ball's backward travel (=> constant ball speed V0 = planted foot);
// outside contact time is uniform. `stanceFrac` = fraction of the cycle a foot is planted. Returns {clip, V0}.
export function stanceWarp(ual, clip, { stanceFrac = 0.22, cy = 0.03, N = 480, name = clip.name, fps = 30, poseFn = null, sign = 1, T: Tout = null } = {}) {
  const R = rig(ual); const smp = sampler(ual, clip); const T = clip.duration;
  const zs = { l: [], r: [] }, ys = { l: [], r: [] };
  // per foot: the planted point = lowest of heel/ball/toe relative to its rest height; its z and clearance
  for (let i = 0; i <= N; i++) { R.reset(); smp(i / N * T, R); if (poseFn) poseFn(i / N * T, R);
    for (const s of ['l', 'r']) { const P = footPts(R, s); let bk = 'ball', bc = 1e9; for (const k of ['heel', 'ball', 'toe']) { const c = P[k].y - REST_H[k]; if (c < bc) { bc = c; bk = k; } } zs[s].push(P[bk].z); ys[s].push(bc); } }
  const minY = { l: Math.min(...ys.l), r: Math.min(...ys.r) };
  // weights per source interval
  const w = new Float64Array(N); let contactLen = 0, contactN = 0, dist = 0;
  const inC = new Uint8Array(N);
  for (let i = 0; i < N; i++) for (const s of ['l', 'r']) { const dz = sign * (zs[s][i] - zs[s][i + 1]); if (ys[s][i] < minY[s] + cy && ys[s][i + 1] < minY[s] + cy && dz > 0) { inC[i] = 1; w[i] = Math.max(w[i], dz); } }
  for (let i = 0; i < N; i++) if (inC[i]) { dist += w[i]; contactN++; }
  // contact share of output time: 2 feet * stanceFrac (clip = 2 steps); distance per unit output time = V0
  const share = contactN >= N - 2 ? 1 : Math.min(0.9, 2 * stanceFrac);
  for (let i = 0; i < N; i++) w[i] = inC[i] ? w[i] / dist * share : (1 - share) / Math.max(1, N - contactN);
  const U = new Float64Array(N + 1); for (let i = 0; i < N; i++) U[i + 1] = U[i] + w[i];
  const V0 = dist / (share * T);   // per clip-second at timeScale 1 (output duration = T)
  const sOf = (u) => { let i = 0; while (i < N - 1 && U[i + 1] < u) i++; const k = (u - U[i]) / Math.max(1e-9, U[i + 1] - U[i]); return (i + THREE.MathUtils.clamp(k, 0, 1)) / N * T; };
  const out = bake(ual, name, T, (t, RR) => { smp(sOf(t / T), RR); if (poseFn) poseFn(sOf(t / T), RR); }, { fps });
  return { clip: out, V0, contactFrac: contactN / N, dist };
}
