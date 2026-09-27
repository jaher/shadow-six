// guest_synth.js - guest clip authoring on the ORIGINAL UAL frames (CC0, project code; rework guests r1).
//  * frameAt(ual, clip, t)      exact-time sample of a clip (separate rig; PropertyMixer-safe)
//  * overlay(ual, clip, name, fn) re-record a clip frame by frame after fn(R, t, i) edits the pose (tied arms, head)
//  * poseClip(ual, name, keys)  key-pose clip: keys sample source frames, are slerped (C1 Catmull-Rom for pelvis and
//    effector targets), then limbs are IK-solved to planted world targets. Character space: +Z forward, +X = LEFT.
//    key = { t, src:[clip,time], pel:[x,y,z], yaw, pitch, spine:[p,y,r], head:[p,y,r], hand_l, hand_r, foot_l, foot_r }
import * as THREE from 'three';
import { makeRig, recordClip, ik2, setWorldQuat } from './synth.js';

const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

const _rigs = new WeakMap();
export function frameAt(ual, clip, t) {
  let S = _rigs.get(clip); if (!S) { S = makeRig(ual); S.mixer = new THREE.AnimationMixer(S.root); S.mixer.clipAction(clip).play(); _rigs.set(clip, S); }
  S.mixer.setTime(Math.max(0, Math.min(t, clip.duration - 1e-4))); S.root.updateMatrixWorld(true);
  const q = {}; for (const b of S.order) q[b.name] = b.quaternion.clone();
  return { q, pp: S.B.pelvis.position.clone(), pw: wp(S.B.pelvis) };
}
export function applyQ(R, fr) {
  R.rest.forEach(([b, q, p]) => { b.quaternion.copy(q); b.position.copy(p); });
  for (const b of R.order) if (fr.q[b.name]) b.quaternion.copy(fr.q[b.name]);
  R.B.pelvis.position.copy(fr.pp); R.root.updateMatrixWorld(true);
}
export function rotW(b, axis, deg) { if (!deg) return; setWorldQuat(b, new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg)).multiply(wq(b))); }
export function setPelvisW(R, p) { R.B.pelvis.position.copy(R.B.pelvis.parent.worldToLocal(p.clone())); R.root.updateMatrixWorld(true); }

// frame-by-frame re-record of `clip` (fps grid), fn(R, t, i) may edit the sampled pose
export function overlay(ual, clip, name, fn, { fps = 30 } = {}) {
  const R = makeRig(ual); const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n); for (let i = 0; i < n; i++) times[i] = (i / (n - 1)) * clip.duration;
  const out = recordClip(name, R, times, (i, t) => { applyQ(R, frameAt(ual, clip, i === n - 1 ? 0 : t)); fn(R, t, i); R.root.updateMatrixWorld(true); });
  out.userData = { ...(clip.userData || {}) };
  return out;
}

const V = (a) => new THREE.Vector3(...a);
function cr(p0, p1, p2, p3, u) {   // Catmull-Rom (uniform) between p1 and p2
  const u2 = u * u, u3 = u2 * u;
  return p1.clone().multiplyScalar(2).add(p2.clone().sub(p0).multiplyScalar(u)).add(p0.clone().multiplyScalar(2).sub(p1.clone().multiplyScalar(5)).add(p2.clone().multiplyScalar(4)).sub(p3).multiplyScalar(u2))
    .add(p1.clone().multiplyScalar(3).sub(p0).sub(p2.clone().multiplyScalar(3)).add(p3).multiplyScalar(u3)).multiplyScalar(0.5);
}
const LIMBS = { hand_l: ['upperarm_l', 'lowerarm_l', 'hand_l'], hand_r: ['upperarm_r', 'lowerarm_r', 'hand_r'], foot_l: ['thigh_l', 'calf_l', 'foot_l'], foot_r: ['thigh_r', 'calf_r', 'foot_r'] };

export function poseClip(ual, name, keys, { fps = 30, loop = false, meta = {}, easeEnds = true } = {}) {
  const R = makeRig(ual); const B = R.B; const K = keys.length;
  // resolve every key: source frame (+ its pelvis world position) with yaw applied
  // effector target 'src' = FK position in the (yawed) source frame; 'src+' = FK after the key's pel/pitch are applied
  const R0 = makeRig(ual);
  const rk = keys.map(k0 => {
    const k = { ...k0 };
    const fr = frameAt(ual, k.src[0], k.src[1]);
    const yaw = k.yaw || 0; const qy = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(yaw));
    const pel = k.pel ? V(k.pel) : fr.pw.clone().applyQuaternion(qy).add(new THREE.Vector3(0, k.pelDY || 0, 0)).add(V(k.off || [0, 0, 0]));
    applyQ(R0, fr); rotW(R0.B.pelvis, Y, yaw); setPelvisW(R0, fr.pw.clone().applyQuaternion(qy));
    const raw = {}; for (const e in LIMBS) raw[e] = wp(R0.B[e]).toArray();
    rotW(R0.B.pelvis, X, k.pitch || 0); rotW(R0.B.pelvis, Z, k.roll || 0); setPelvisW(R0, pel);
    for (const e in LIMBS) { if (k[e] === 'src') k[e] = raw[e]; else if (k[e] === 'src+') k[e] = wp(R0.B[e]).toArray(); }
    return { k, fr, pel };
  });
  const at = (arr, i) => arr[Math.max(0, Math.min(K - 1, i))];
  const T = keys[K - 1].t, n = Math.max(2, Math.round(T * fps) + 1);
  const times = new Float32Array(n); for (let i = 0; i < n; i++) times[i] = (i / (n - 1)) * T;
  const errs = [], worst = {};
  const clip = recordClip(name, R, times, (f, t) => {
    let i = 0; while (i < K - 2 && keys[i + 1].t <= t) i++;
    const a = rk[i], b = rk[Math.min(i + 1, K - 1)];
    let u = b.k.t > a.k.t ? THREE.MathUtils.clamp((t - a.k.t) / (b.k.t - a.k.t), 0, 1) : 0;
    const ease = a.k.ease ?? ((easeEnds && (i === 0 || i === K - 2)) ? (i === 0 && i === K - 2 ? 'io' : i === 0 ? 'in' : 'out') : 'lin');
    const w = ease === 'io' ? u * u * (3 - 2 * u) : ease === 'in' ? u * u * (2 - u) : ease === 'out' ? u * (1 + u - u * u) : ease === 'hold' ? 0 : u;
    // rotations: slerp the two source frames
    const q = {}; for (const bn in a.fr.q) q[bn] = a.fr.q[bn].clone().slerp(b.fr.q[bn], w);
    applyQ(R, { q, pp: a.fr.pp.clone().lerp(b.fr.pp, w) });
    const L = (key, d = 0) => { const x = a.k[key], y = b.k[key]; if (Array.isArray(x) || Array.isArray(y)) return [0, 1, 2].map(j => THREE.MathUtils.lerp((x || [0, 0, 0])[j], (y || [0, 0, 0])[j], w)); return THREE.MathUtils.lerp(x ?? d, y ?? d, w); };
    // whole-body yaw + pitch about the pelvis, then pelvis position on the spline
    const yaw = L('yaw'), pitch = L('pitch'), roll = L('roll');
    rotW(B.pelvis, Y, yaw); rotW(B.pelvis, X, pitch); rotW(B.pelvis, Z, roll);
    const pel = cr(at(rk, i - 1).pel, a.pel, b.pel, at(rk, i + 2).pel, w);
    setPelvisW(R, pel);
    const sp = L('spine'), hd = L('head');
    for (const bn of ['spine_02', 'spine_03']) { rotW(B[bn], X, sp[0] / 2); rotW(B[bn], Y, sp[1] / 2); rotW(B[bn], Z, sp[2] / 2); }
    rotW(B.Head, X, hd[0]); rotW(B.Head, Y, hd[1]); rotW(B.Head, Z, hd[2]);
    // limb targets
    for (const [eff, [b0, b1, b2]] of Object.entries(LIMBS)) {
      const ta = a.k[eff], tb = b.k[eff]; if (!ta && !tb) continue;
      const fk = wp(B[b2]);
      const pa = ta ? V(ta) : fk, pb = tb ? V(tb) : fk;
      const pm = at(rk, i - 1).k[eff] ? V(at(rk, i - 1).k[eff]) : pa, pn = at(rk, i + 2).k[eff] ? V(at(rk, i + 2).k[eff]) : pb;
      const tgt = ta && tb ? cr(pm, pa, pb, pn, w) : pa.clone().lerp(pb, w);
      const leg = eff.startsWith('foot'); const side = eff.endsWith('_l') ? 1 : -1;
      // pole: keep the FK bend plane of the interpolated pose (knee/elbow direction away from the root->end chord)
      const r0 = wp(B[b0]), m1 = wp(B[b1]), e2 = wp(B[b2]); const bend = m1.clone().sub(r0.clone().lerp(e2, 0.5));
      if (bend.length() < 0.02) bend.copy(leg ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(side * 0.35, -0.1, -0.3));
      const pole = m1.clone().addScaledVector(bend.normalize(), 0.5);
      const e = ik2(B[b0], B[b1], B[b2], tgt, pole); errs.push(e); if (e > 0.03) (worst[eff] = worst[eff] || []).push(+t.toFixed(2) + ':' + e.toFixed(2));
    }
  });
  clip.userData = { source: 'keyed poses (guest_synth.js) on UAL frames', license: 'CC0 (project-authored, derived from Quaternius UAL CC0)', loop, maxIkErr: +Math.max(0, ...errs).toFixed(3), ...meta };
  if (Object.keys(worst).length) console.log('ik', name, JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, v.filter((_, i) => i % 3 === 0).join(' ')]))));
  return clip;
}
