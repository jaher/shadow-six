// Copied from scratchpad chars/guests/pipeline/web/synth.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// synth.js - motion re-synthesis on the ORIGINAL UAL frames (CC0, project code; rework commandos_b).
//  * ik2(): analytic two-bone IK with a pole target (elbow/knee plane), keeps the end bone's world rotation
//  * resampleLoco(): gait re-synthesis for a target ground speed + cadence + duty factor. The feet get EXPLICIT
//    trajectories (stance ankle moves back at exactly v -> planted; swing path = source path stretched to the new
//    stride), legs are IK-solved, body/arms come from the phase-warped source, pelvis drops only if a leg is overreached.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { bonesOf, orderedBones } from './rig_util.js';

const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
export function setWorldQuat(b, q) { b.quaternion.copy(wq(b.parent).invert().multiply(q)); b.updateMatrixWorld(true); }

// two-bone IK: a (upper) -> b (mid) -> c (end) reaches `target`; mid joint bends toward `pole` (world point). Returns error (m).
export function ik2(a, b, c, target, pole = null, { keepEnd = true, maxReach = 0.999 } = {}) {
  a.updateMatrixWorld(true);
  const cw = wq(c);
  const pa = wp(a), pb = wp(b), pc = wp(c);
  const l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pc);
  const t = target.clone().sub(pa); let d = t.length();
  d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * maxReach);
  const tn = t.clone().normalize();
  // bend direction: component of (pole - a) orthogonal to the a->target axis (fallback: current mid joint)
  const ref = (pole ? pole.clone() : pb.clone()).sub(pa);
  let bend = ref.addScaledVector(tn, -ref.dot(tn));
  if (bend.lengthSq() < 1e-8) bend = pb.clone().sub(pa).addScaledVector(tn, -pb.clone().sub(pa).dot(tn));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(tn, -tn.z);
  bend.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const midT = pa.clone().addScaledVector(tn, l1 * cosA).addScaledVector(bend, l1 * sinA);
  const endT = pa.clone().addScaledVector(tn, d);
  // rotate a so that b lands on midT (swing), then b so that c lands on endT
  const swing = (bone, from, to) => {
    const p = wp(bone); const u = from.clone().sub(p).normalize(), v = to.clone().sub(p).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(u, v).multiply(wq(bone)); setWorldQuat(bone, q);
  };
  swing(a, pb, midT); b.updateMatrixWorld(true);
  swing(b, wp(c), endT);
  if (keepEnd) setWorldQuat(c, cw);
  return wp(c).distanceTo(target);
}

// ---- sampling helpers (sample into a separate skeleton: PropertyMixer skips unchanged writes) ----
export function makeRig(ualScene) {
  const root = SkeletonUtils.clone(ualScene); root.traverse(o => { if (o.isMesh) o.visible = false; });
  const B = bonesOf(root), order = orderedBones(root);
  return { root, B, order, rest: order.map(b => [b, b.quaternion.clone(), b.position.clone()]) };
}
export function sampleFrames(ualScene, clip, n) {
  const S = makeRig(ualScene); const mixer = new THREE.AnimationMixer(S.root); mixer.clipAction(clip).play();
  const frames = [];
  for (let i = 0; i < n; i++) {
    mixer.setTime((i / n) * clip.duration); S.root.updateMatrixWorld(true);
    const q = {}; for (const b of S.order) q[b.name] = b.quaternion.clone();
    frames.push({ q, pp: S.B.pelvis.position.clone() });
  }
  return frames;
}
// cyclic interpolation of sampled frames at phase u in [0,1)
export function frameAt(frames, u) {
  const n = frames.length; const x = ((u % 1) + 1) % 1 * n; const i = Math.floor(x) % n, j = (i + 1) % n, w = x - Math.floor(x);
  const q = {}; for (const k in frames[i].q) q[k] = frames[i].q[k].clone().slerp(frames[j].q[k], w);
  return { q, pp: frames[i].pp.clone().lerp(frames[j].pp, w) };
}
export function applyFrame(R, fr) {
  R.rest.forEach(([b, q, p]) => { b.quaternion.copy(q); b.position.copy(p); });
  for (const b of R.order) if (fr.q[b.name]) b.quaternion.copy(fr.q[b.name]);
  R.B.pelvis.position.copy(fr.pp); R.root.updateMatrixWorld(true);
}
export function recordClip(name, R, times, cb) {
  const n = times.length, Q = {}, P = new Float32Array(n * 3);
  R.order.forEach(b => Q[b.name] = new Float32Array(n * 4));
  for (let f = 0; f < n; f++) { cb(f, times[f]); R.order.forEach(b => b.quaternion.toArray(Q[b.name], f * 4)); R.B.pelvis.position.toArray(P, f * 3); }
  const tracks = [new THREE.VectorKeyframeTrack('pelvis.position', times, P)];
  R.order.forEach(b => { if (b.name !== 'root') tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, Q[b.name])); });
  return new THREE.AnimationClip(name, times[n - 1], tracks);
}
const cyc = (x) => ((x % 1) + 1) % 1;
// swing bone so the segment bone->child points along world direction d (children follow)
export function aimSeg(b, child, d) {
  b.updateMatrixWorld(true); const p = wp(b), c = wp(child).sub(p).normalize();
  setWorldQuat(b, new THREE.Quaternion().setFromUnitVectors(c, d.clone().normalize()).multiply(wq(b)));
}

function stanceOf(meas, s, tol) {
  const N = meas.length, by = meas.map(m => m['b' + s].y), ay = meas.map(m => m['a' + s].y);
  const mb = Math.min(...by), ma = Math.min(...ay);
  const c = meas.map((m, i) => by[i] < mb + tol || ay[i] < ma + tol);
  let best = null;
  for (let i = 0; i < N; i++) if (c[i] && !c[(i - 1 + N) % N]) { let L = 0; while (L < N && c[(i + L) % N]) L++; if (!best || L > best.len) best = { td: i, len: L }; }
  if (!best) best = { td: 0, len: Math.round(N / 2) };
  return { td: best.td / N, to: cyc((best.td + best.len) / N), duty: best.len / N, tdI: best.td, toI: (best.td + best.len) % N };
}
function lerpMeas(meas, u, key) { const n = meas.length, x = cyc(u) * n, i = Math.floor(x) % n, j = (i + 1) % n; return meas[i][key].clone().lerp(meas[j][key], x - Math.floor(x)); }
function meanQ(list) { const m = new THREE.Vector4(); const r = list[0]; for (const q of list) { const s = (q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w) < 0 ? -1 : 1; m.x += s * q.x; m.y += s * q.y; m.z += s * q.z; m.w += s * q.w; } m.normalize(); return new THREE.Quaternion(m.x, m.y, m.z, m.w); }

// gait re-synthesis. v m/s, spm steps/min, duty = stance fraction per foot (null = source), armScale = arm-swing gain,
// lift = swing-height gain, bodyPitch deg (forward lean added to spine_01)
export function resampleLoco(ualScene, clip, { name, v, spm, duty = null, armScale = 1, lift = 1, fps = 30, N = 120, tol = 0.03, bodyPitch = 0, pelvisDY = 0, roll = [0.35, 0.6] } = {}) {
  const src = sampleFrames(ualScene, clip, N); const R = makeRig(ualScene); const B = R.B;
  const meas = src.map(fr => { applyFrame(R, fr); return { al: wp(B.foot_l), ar: wp(B.foot_r), bl: wp(B.ball_l), br: wp(B.ball_r) }; });
  const st = { l: stanceOf(meas, 'l', tol), r: stanceOf(meas, 'r', tol) };
  const D = duty ?? (st.l.duty + st.r.duty) / 2;
  // phase warp (output -> source) through the 4 contact events
  const o = st.l.td; const sk = [['ltd', 0], ['lto', cyc(st.l.to - o)], ['rtd', cyc(st.r.td - o)], ['rto', cyc(st.r.to - o)]];
  const tk = { ltd: 0, lto: cyc(D), rtd: 0.5, rto: cyc(0.5 + D) };
  sk.sort((a, b) => a[1] - b[1]);
  const okOrder = sk.every((k, i) => i === 0 || tk[k[0]] > tk[sk[i - 1][0]]);
  const knots = okOrder ? sk.map(k => [tk[k[0]], k[1]]) : [[0, 0]];
  knots.push([1, 1]);
  const warp = (u) => { u = cyc(u); for (let i = 0; i < knots.length - 1; i++) { const [a0, b0] = knots[i], [a1, b1] = knots[i + 1]; if (u >= a0 && u <= a1) return cyc(o + b0 + (b1 - b0) * (a1 > a0 ? (u - a0) / (a1 - a0) : 0)); } return cyc(o + u); };
  const T = 120 / spm, S = v * D * T;
  const foot = {};
  for (const s of ['l', 'r']) {
    const zt = meas[st[s].tdI]['a' + s].z, zo = meas[st[s].toI]['a' + s].z;
    const ymin = Math.min(...meas.map(m => m['a' + s].y));
    foot[s] = { zt, zo, z0: (zt + zo) / 2, ymin, off: s === 'l' ? 0 : 0.5 };
  }
  const ARM = ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r'];
  const armMean = {}; for (const a of ARM) armMean[a] = meanQ(src.map(f => f.q[a]));
  const M = Math.max(8, Math.round(T * fps)); const times = new Float32Array(M + 1); for (let j = 0; j <= M; j++) times[j] = (j / M) * T;
  const legL = (s) => B['thigh_' + s].position.length() * 0 + wp(B['calf_' + s]).distanceTo(wp(B['thigh_' + s])) + wp(B['foot_' + s]).distanceTo(wp(B['calf_' + s]));
  const pose = (u) => {
    const us = warp(u); const fr = frameAt(src, us);
    for (const a of ARM) fr.q[a] = armMean[a].clone().slerp(fr.q[a], armScale);
    applyFrame(R, fr);
    if (bodyPitch) { const b = B.spine_01; setWorldQuat(b, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(bodyPitch)).multiply(wq(b))); }
    const tg = {};
    for (const s of ['l', 'r']) {
      const F = foot[s]; const p = cyc(u - F.off); const a = lerpMeas(meas, us, 'a' + s);
      const y = F.ymin + (a.y - F.ymin) * (p < D ? 1 : lift);
      // stance: ground contact point moves back at v; contact rolls heel(ankle) -> ball between roll[0..1] of stance
      const offAt = (pp) => { const uu = warp(F.off + pp * D); return lerpMeas(meas, uu, 'b' + s).z - lerpMeas(meas, uu, 'a' + s).z; };
      const ps = roll[0] * D, wr = (pp) => { const x = THREE.MathUtils.clamp((pp - roll[0] * D) / Math.max(1e-6, (roll[1] - roll[0]) * D), 0, 1); return roll[1] <= 0 ? 1 : x * x * (3 - 2 * x); };
      const zc = (pp) => F.z0 + S / 2 - (pp / D) * S;
      const off0 = offAt(ps);
      const zTo = zc(D) + wr(D) * (off0 - offAt(D * 0.999));
      const z = p < D ? zc(p) + wr(p) * (off0 - offAt(p)) : zTo + ((a.z - F.zo) / ((Math.abs(F.zt - F.zo) > 0.05 ? F.zt - F.zo : 0.05))) * (F.z0 + S / 2 - zTo);
      tg[s] = new THREE.Vector3(a.x, y, z);
    }
    return tg;
  };
  // pass 1: pelvis drop needed so that stance legs are not overreached
  const drop = new Float32Array(M + 1);
  for (let j = 0; j <= M; j++) {
    const u = j / M; const tg = pose(u); let d = 0;
    for (const s of ['l', 'r']) {
      if (cyc(u - foot[s].off) >= D) continue;   // only stance legs must reach
      const hip = wp(B['thigh_' + s]); const L = legL(s) * 0.985; const t = tg[s];
      const hz = Math.hypot(hip.x - t.x, hip.z - t.z); const need = (hip.y - t.y) - Math.sqrt(Math.max(0, L * L - hz * hz));
      if (need > d) d = need;
    }
    drop[j] = d;
  }
  const sm = new Float32Array(M + 1);
  for (let j = 0; j <= M; j++) { let mx = 0; for (let k = -3; k <= 3; k++) mx = Math.max(mx, drop[((j + k) % M + M) % M]); sm[j] = mx; }
  for (let j = 0; j <= M; j++) { let a = 0; for (let k = -2; k <= 2; k++) a += sm[((j + k) % M + M) % M]; drop[j] = a / 5; }
  drop[M] = drop[0];
  const errs = [];
  const clipOut = recordClip(name, R, times, (j) => {
    const u = (j % M) / M; const tg = pose(u);
    const pw = wp(B.pelvis); pw.y -= drop[j] - pelvisDY; B.pelvis.position.copy(B.pelvis.parent.worldToLocal(pw)); R.root.updateMatrixWorld(true);
    for (const s of ['l', 'r']) {
      const knee = wp(B['calf_' + s]).add(new THREE.Vector3(0, 0, 0.6));
      errs.push(ik2(B['thigh_' + s], B['calf_' + s], B['foot_' + s], tg[s], knee));
    }
  });
  clipOut.userData = { source: `resynth(${clip.name})`, license: 'CC0 (derived from Quaternius UAL, CC0)', loop: true,
    groundSpeed: v, spm, duty: +D.toFixed(3), stride: +S.toFixed(3), maxDrop: +Math.max(...drop).toFixed(3), maxIkErr: +Math.max(...errs).toFixed(3), warp: okOrder };
  return clipOut;
}

// (the prone crawl moved to tools/characters/prone: elbow-first authored keyframes, docs/crawl-animation.md)
