// prone-fit.js - per-CHARACTER contact fit of the prone clips (CC0 project code; docs/crawl-animation.md §6.2).
// The prone set is authored on the UAL skeleton (tools/characters/prone). MPFB bodies differ a lot (the Green Beret's
// legs are 1.21x UAL, greatcoats add 3-5 cm of cloth), so once per template + clip, on a scratch copy, every frame:
//   1. trunk: the lowest torso vertex is put on the ground (lift OR lower, smoothed) - belly flat, never through
//   2. elbows: each upper arm is re-aimed so the forearm's lowest vertex touches the ground (planted frames) or skims
//      1.5 cm above it (reach frames, meta.contacts.el) - the forearm keeps its world orientation, so it stays flat
//   3. legs: two-bone IK moves each ankle so the lowest leg / boot vertex touches the ground (knee plane kept)
// Only pelvis.position and the arm / leg chains change; the result replaces the adapted clip in the template cache.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { skinnedMinY } from './skin-min.js';

const TRUNK = /^(pelvis|spine_0\d|neck_01|Head|clavicle_)/;
// the belly / chest cloth and gear press 1 cm into the ground (snow, soil) rather than holding the body up on a buckle
const CLEAR = 0.005, SKIM = 0.015, TRUNK_CLEAR = -0.01;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const wp = (o, v = new THREE.Vector3()) => o.getWorldPosition(v);

function scratch(tpl) {
  if (tpl._proneScratch) return tpl._proneScratch;
  const root = SkeletonUtils.clone(tpl.gltf.scene), B = {};
  let mesh = null;
  root.traverse((o) => { if (o.isBone && !(o.name in B)) B[o.name] = o; if (o.isSkinnedMesh && /^LOD2/.test(o.name) && !mesh) mesh = o; });
  if (!mesh) root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  const reg = { trunk: [], fa_l: [], fa_r: [], leg_l: [], leg_r: [] };
  if (mesh) {
    const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, n = mesh.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) {
      let bi = 0, bw = -1;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k); }
      const bn = mesh.skeleton.bones[bi].name;
      if (TRUNK.test(bn)) reg.trunk.push(i);
      let m = bn.match(/^lowerarm_(l|r)$/); if (m) reg['fa_' + m[1]].push(i);
      m = bn.match(/^(thigh|calf|foot|ball)_(l|r)$/); if (m) reg['leg_' + m[2]].push(i);
    }
  }
  return (tpl._proneScratch = { root, B, mesh, reg });
}
const minOf = (S, list) => (list.length ? skinnedMinY(S.mesh, { list }) : 0);

/** Rotate bone b (world rotation q about its own joint) keeping `keep` bones' world orientations. */
function rotKeep(b, q, keep) {
  const saved = keep.map((k) => k.getWorldQuaternion(new THREE.Quaternion()));
  const pq = b.parent.getWorldQuaternion(_q2);
  b.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
  b.updateMatrixWorld(true);
  keep.forEach((k, i) => { k.quaternion.copy(k.parent.getWorldQuaternion(_q2).invert().multiply(saved[i])); k.updateMatrixWorld(true); });
}
/** Move the elbow of side s vertically by dy (upper arm re-aimed about the shoulder, forearm + hand keep their world rotation). */
function elbowBy(B, s, dy) {
  const S = wp(B['upperarm_' + s]), E = wp(B['lowerarm_' + s]), L = E.distanceTo(S);
  const d0 = E.clone().sub(S).normalize(), d1 = E.clone().add(_v.set(0, dy, 0)).sub(S).normalize();
  rotKeep(B['upperarm_' + s], _q.setFromUnitVectors(d0, d1), [B['lowerarm_' + s]]);
  return L;
}
/** Two-bone IK: move the ankle of side s by dy (world up) keeping the knee's bend plane and the foot's world rotation. */
function ankleBy(B, s, dy) {
  const a = B['thigh_' + s], b = B['calf_' + s], c = B['foot_' + s];
  const pa = wp(a), pb = wp(b), pc = wp(c), t = pc.clone().add(_v.set(0, dy, 0));
  const l1 = pb.distanceTo(pa), l2 = pc.distanceTo(pb), D = THREE.MathUtils.clamp(t.distanceTo(pa), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const n = pb.clone().sub(pa).cross(pc.clone().sub(pb)); if (n.lengthSq() < 1e-10) n.set(1, 0, 0); n.normalize();   // bend-plane normal
  const u = t.clone().sub(pa).normalize(), cosA = (l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const k0 = pb.clone().sub(pa); k0.addScaledVector(u, -k0.dot(u));                                                  // current knee offset
  const side = new THREE.Vector3().crossVectors(n, u).normalize(); if (side.dot(k0) < 0) side.negate();             // keep the knee's side
  const knee = pa.clone().addScaledVector(u, l1 * cosA).addScaledVector(side, l1 * sinA);
  rotKeep(a, _q.setFromUnitVectors(pb.clone().sub(pa).normalize(), knee.clone().sub(pa).normalize()), [c]);
  const pb2 = wp(b), pc2 = wp(c);
  rotKeep(b, _q.setFromUnitVectors(pc2.clone().sub(pb2).normalize(), t.clone().sub(pb2).normalize()), [c]);
}
const planted = (meta, key, u, s) => {
  const c = meta.contacts && meta.contacts[key]; if (!c) return true;
  const fr = c.split(' '); const f = fr[Math.min(fr.length - 1, Math.round(u * (fr.length - 1)))];
  return f[s === 'l' ? 0 : 1] === '1';
};

/** Put the elbow of side s on world point T: scapula (clavicle) slides the shoulder to upper-arm length, the upper arm
 *  aims at T, the forearm (and the hand / weapon it carries) keeps its world rotation. A residual reach is taken by
 *  lifting the elbow <= 2.5 cm rather than sliding it. */
function pinElbow(B, s, T) {
  const ua = B['upperarm_' + s], la = B['lowerarm_' + s], cl = B['clavicle_' + s];
  const L = wp(la).distanceTo(wp(ua));
  for (let it = 0; cl && it < 4; it++) {
    const Sp = wp(ua), d = T.clone().sub(Sp), err = d.length() - L;
    if (Math.abs(err) < 0.002) break;
    const h = d.setY(0); if (h.lengthSq() < 1e-8) break;   // slide the shoulder along the ground plane only (never prop it up)
    const C = wp(cl), a = Sp.clone().sub(C), b = Sp.clone().addScaledVector(h.normalize(), THREE.MathUtils.clamp(err, -0.025, 0.025)).sub(C);
    rotKeep(cl, _q.setFromUnitVectors(a.normalize(), b.normalize()), [la]);
  }
  const Sp = wp(ua), hz = Math.hypot(T.x - Sp.x, T.z - Sp.z);
  if (T.distanceTo(Sp) > L + 0.002 && hz < L) T = T.clone().setY(Math.min(T.y + 0.025, Math.max(T.y, Sp.y - Math.sqrt(L * L - hz * hz))));
  rotKeep(ua, _q.setFromUnitVectors(wp(la).sub(Sp).normalize(), T.clone().sub(Sp).normalize()), [la]);
}

/** Elbow pin pass of fitProneClip (see step 4 there). vr: root travel per clip second (m). */
function pinElbows(S, clip, meta, times, EL, load, save, vr) {
  const n = times.length, loop = meta.loop !== false, N = loop ? n - 1 : n, dur = clip.duration;
  const dl = { l: new Array(N).fill(null), r: new Array(N).fill(null) };
  for (const s of ['l', 'r']) {
    const pl = Array.from({ length: N }, (_, f) => planted(meta, 'el', times[f] / dur, s));
    if (!pl.some(Boolean)) continue;
    const runs = [];
    if (pl.every(Boolean)) runs.push(Array.from({ length: N }, (_, f) => f));
    else {
      const st0 = pl.findIndex((p, f) => p && !pl[(f - 1 + N) % N] && (loop || f > 0)) ;
      for (let k = 0, f = st0 < 0 ? 0 : st0, run = null; k < N; k++, f = (f + 1) % N) {
        if (!loop && f === 0 && k > 0) run = null;
        if (pl[f]) { if (!run) runs.push(run = []); run.push(f); } else run = null;
      }
    }
    for (const run of runs) {
      let wrap = 0, prev = -1; const ut = run.map((f) => { if (f < prev) wrap += dur; prev = f; return times[f] + wrap; });
      const c = new THREE.Vector3();
      run.forEach((f, i) => c.add(EL[s][f].clone().setZ(EL[s][f].z + vr * ut[i])));
      c.multiplyScalar(1 / run.length);
      run.forEach((f, i) => { dl[s][f] = new THREE.Vector3(c.x - EL[s][f].x, 0, c.z - vr * ut[i] - EL[s][f].z); });
    }
    // reach frames: ease from the end of one plant's correction to the start of the next
    const P0 = dl[s].slice();                                   // planted corrections only (the search must not see eased frames)
    for (let f = 0; f < N; f++) {
      if (P0[f]) continue;
      let a = f, b = f, ka = 0, kb = 0;
      while (!P0[a] && ka < N) { a = loop ? (a - 1 + N) % N : a - 1; ka++; if (a < 0) break; }
      while (!P0[b] && kb < N) { b = loop ? (b + 1) % N : b + 1; kb++; if (b >= N) break; }
      const A = a >= 0 && P0[a], Bv = b < N && P0[b];
      const u = ka / (ka + kb), e = u * u * (3 - 2 * u);
      dl[s][f] = A && Bv ? A.clone().lerp(Bv, e) : (A || Bv || new THREE.Vector3()).clone();
    }
  }
  for (let f = 0; f < n; f++) {
    const fi = loop && f === n - 1 ? 0 : f, D = { l: dl.l[fi], r: dl.r[fi] };
    if (!(D.l && D.l.lengthSq() > 4e-6) && !(D.r && D.r.lengthSq() > 4e-6)) continue;
    load(f);
    for (const s of ['l', 'r']) if (D[s] && D[s].lengthSq() > 4e-6) pinElbow(S.B, s, wp(S.B['lowerarm_' + s]).add(D[s]));
    S.root.updateMatrixWorld(true);
    save(f);
  }
}

/**
 * Fit a prone clip (already adapted to this template) to the character's body. Returns a new clip (same name).
 * @param {{gltf:object}} tpl character template @param {THREE.AnimationClip} clip @param {object} meta clip meta
 */
export function fitProneClip(tpl, clip, meta = {}, ratio = 1) {
  const S = scratch(tpl); if (!S.mesh) return clip;
  const { root, B } = S;
  // evaluate the tracks directly (an AnimationMixer skips writing values that did not change, so the offsets written
  // below would accumulate on constant tracks)
  const ev = [];
  for (const t of clip.tracks) {
    const i = t.name.lastIndexOf('.'), b = B[t.name.slice(0, i)], prop = t.name.slice(i + 1);
    if (b && (prop === 'quaternion' || prop === 'position')) ev.push({ b, prop, it: t.createInterpolant() });
  }
  const n = Math.max(2, Math.min(64, Math.round(clip.duration * (clip.duration > 2 ? 6 : 30)) + 1));   // long holds breathe slowly
  const times = new Float32Array(n); for (let f = 0; f < n; f++) times[f] = (f / (n - 1)) * clip.duration;
  const poseAt = (t) => {
    for (const e of ev) { const v = e.it.evaluate(Math.min(t, clip.duration)); e.b[e.prop].fromArray(v); }
    root.updateMatrixWorld(true);
  };
  // pass 1: trunk offset per frame, smoothed (3-tap) so the body never pops
  const d = new Float32Array(n);
  // transitions (go_prone / get_up) blend standing and prone frames: the fit fades in as a part nears the ground
  const tr = !!meta.transition, near = (m, lo, hi) => (tr ? THREE.MathUtils.clamp((hi - m) / (hi - lo), 0, 1) : 1);
  for (let f = 0; f < n; f++) {
    poseAt(times[f]); const m = minOf(S, S.reg.trunk); d[f] = THREE.MathUtils.clamp((tr ? CLEAR : TRUNK_CLEAR) - m, -0.1, 0.14) * near(m, 0.06, 0.16);
    // transitions (go_prone / get_up): this body's longer shins / thighs must not put a knee through the ground while
    // it drops to (or rises from) its knees - lift the whole body over its lowest limb (review: knee 10-14 cm under)
    if (tr) { let lo = 9; for (const k of ['leg_l', 'leg_r', 'fa_l', 'fa_r']) lo = Math.min(lo, minOf(S, S.reg[k])); if (lo + d[f] < 0) d[f] = -lo; }
  }
  const ds = d.map((_, f) => { const sm = (d[Math.max(0, f - 1)] + 2 * d[f] + d[Math.min(n - 1, f + 1)]) / 4; return tr ? Math.max(sm, d[f]) : sm; });
  const ARM = ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r'], LEG = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
  const names = [...ARM, ...LEG].filter((k) => B[k]), EL = { l: [], r: [] }, Q = Object.fromEntries(names.map((k) => [k, new Float32Array(n * 4)])), P = new Float32Array(n * 3);
  const par = B.pelvis.parent;
  for (let f = 0; f < n; f++) {
    poseAt(times[f]);
    const u = times[f] / clip.duration;
    // 1. trunk: world-up offset converted into the pelvis parent's space
    const p = wp(B.pelvis); p.y += ds[f]; B.pelvis.position.copy(par.worldToLocal(p)); root.updateMatrixWorld(true);
    // 2. elbows / forearms
    for (const s of ['l', 'r']) for (let it = 0; it < 3; it++) {
      const want = CLEAR + (planted(meta, 'el', u, s) ? 0 : SKIM), m = minOf(S, S.reg['fa_' + s]);
      const dy = THREE.MathUtils.clamp(want - m, -0.12, 0.12) * near(m, 0.05, 0.12);
      if (Math.abs(dy) < 0.002) break;
      elbowBy(B, s, dy); root.updateMatrixWorld(true);
    }
    // 3. legs: lowest leg / boot vertex onto the ground
    for (const s of ['l', 'r']) for (let it = 0; it < 2; it++) {
      const m = minOf(S, S.reg['leg_' + s]), dy = THREE.MathUtils.clamp(CLEAR - m, -0.08, 0.12) * near(m, 0.03, 0.09);
      if (Math.abs(dy) < 0.002) break;
      ankleBy(B, s, dy); root.updateMatrixWorld(true);
    }
    for (const s of ['l', 'r']) EL[s].push(wp(B['lowerarm_' + s]));
    for (const k of names) B[k].quaternion.toArray(Q[k], f * 4);
    B.pelvis.position.toArray(P, f * 3);
  }
  // 4. planted elbows stay put in the world. The clip is authored on UAL; on this body (other arm / torso lengths, the
  //    trunk and forearm fits above) the planted elbow drifts 25-55 cm/s against the ground (review). Per planted run
  //    the elbow is pinned to its best-fit ground point (moving back at the root speed in clip space), reached by the
  //    scapula (clavicle) + upper-arm aim; the correction is eased across the reach frames in between.
  if (meta.contacts && meta.contacts.el && !tr) pinElbows(S, clip, meta, times, EL, (f) => {
    poseAt(times[f]);
    for (const k of names) B[k].quaternion.fromArray(Q[k], f * 4);
    B.pelvis.position.fromArray(P, f * 3); root.updateMatrixWorld(true);
  }, (f) => { for (const k of names) B[k].quaternion.toArray(Q[k], f * 4); }, meta.loco && meta.groundSpeed ? meta.groundSpeed * ratio : 0);
  const repl = new Set([...names.map((k) => k + '.quaternion'), 'pelvis.position']);
  const tracks = clip.tracks.filter((t) => !repl.has(t.name));
  tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, P));
  for (const k of names) tracks.push(new THREE.QuaternionKeyframeTrack(k + '.quaternion', times, Q[k]));
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.userData = { ...(clip.userData || {}), proneFit: { trunk: [Math.min(...d), Math.max(...d)].map((x) => +x.toFixed(3)) } };
  return out;
}
