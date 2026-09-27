// Copied from scratchpad chars/commandos_b/pipeline/web/ground.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// ground.js - per-CHARACTER grounding of clips at adapt time (once per template+clip, cached by charkit).
// Clips are authored on the UAL skeleton; MPFB bodies differ in torso depth, kit and limb lengths, so a pose that is
// grounded on UAL can sink (dead pelvis -7..-19 cm, kneel toe -23 cm) or float (crawl hands +15 cm) on a character.
//  pass 1: per frame, the lowest skinned vertex of the TRUNK (torso, thighs, calves, upper arms, head; LOD2) -> lift d(t),
//          smoothed (max-filter + box) so one-shots do not pop
//  pass 2: apply lift, re-plant feet that were grounded before the lift (leg IK, foot keeps its rotation), pull toes /
//          ankles / fingers out of the ground, and follow authored effector paths (meta.paths, e.g. the planted crawl)
import * as THREE from 'three';
import { skinnedMinY } from '../skin-min.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ik2, aimSeg } from './synth.js';

const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const TRUNK = /^(pelvis|spine_0\d|neck_01|Head|clavicle_|upperarm_|thigh_|calf_)/;
const FING = ['thumb_03', 'index_03', 'middle_03', 'ring_03', 'pinky_03'];
// r8: 'drag' deliberately NOT grounded (the per-frame toe IK made the planted feet slide 0.4 m/s; raw toe dip is -2 cm, same as commandos_a)
// the prone set (meta.prone) is fitted by prone-fit.js instead; go_prone / get_up (transitions) are grounded here
export const GROUND_CLIPS = new Set(['dead', 'die', 'go_prone', 'get_up', 'kneel_shoot', 'plant', 'set_trap', 'cut_wire',
  'bury', 'dig', 'pickup', 'stand_up',  'change_clothes', 'crouch_idle', 'crouch_walk', 'crouch_fast', 'detonate', 'stab']);

function scratch(tpl) {
  if (tpl._gscratch) return tpl._gscratch;
  const mk = () => { const r = SkeletonUtils.clone(tpl.gltf.scene); const B = {}; r.traverse(o => { if (o.isBone && !(o.name in B)) B[o.name] = o; }); return { r, B }; };
  const S = mk(), E = mk();
  let mesh = null; E.r.traverse(o => { if (o.isSkinnedMesh && /^LOD2/.test(o.name)) mesh = o; });
  if (!mesh) E.r.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
  const idx = [], foot = { l: [], r: [] }, hand = { l: [], r: [] };
  if (mesh) {
    const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, n = mesh.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k); } const bn = mesh.skeleton.bones[bi].name; if (TRUNK.test(bn)) idx.push(i); const fm = bn.match(/^(ball|foot)_(l|r)$/); if (fm) foot[fm[2]].push(i); const hm = bn.match(/^(hand|thumb_0\d|index_0\d|middle_0\d|ring_0\d|pinky_0\d)_(l|r)$/); if (hm) hand[hm[2]].push(i); }
  }
  return (tpl._gscratch = { S, E, mesh, idx, foot, hand });
}
const _v = new THREE.Vector3();
function meshMin(G, list) { return list.length ? skinnedMinY(G.mesh, { list }) : 1e9; }
function trunkMin(G) {
  if (!G.mesh) return 0; G.E.r.updateMatrixWorld(true); let mn = 1e9;
  if (G.idx.length) mn = skinnedMinY(G.mesh, { list: G.idx });
  return mn;
}

// returns a NEW clip (same name) or the input clip when nothing needed fixing
export function groundClip(tpl, clip, meta = {}, ratio = 1, { fps = 30, clearance = 0.004 } = {}) {
  const G = scratch(tpl), { S, E } = G, B = E.B;
  const mixer = new THREE.AnimationMixer(S.r); const act = mixer.clipAction(clip); act.play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1), times = new Float32Array(n);
  for (let f = 0; f < n; f++) times[f] = (f / (n - 1)) * clip.duration;
  const names = [...new Set(clip.tracks.map(t => t.name.split('.')[0]))].filter(nm => B[nm]);
  const poseAt = (t) => {
    mixer.setTime(Math.min(t, clip.duration - 1e-4)); S.r.updateMatrixWorld(true);
    for (const nm of names) { B[nm].quaternion.copy(S.B[nm].quaternion); B[nm].position.copy(S.B[nm].position); }
    E.r.updateMatrixWorld(true);
  };
  const paths = meta.paths || null;
  // pass 1: trunk lift
  const d = new Float32Array(n); let any = !!paths;
  for (let f = 0; f < n; f++) { poseAt(times[f]); const m = trunkMin(G); d[f] = Math.max(0, clearance - m); if (d[f] > 0.002) any = true; }
  const feetLow = []; // feet sunk?
  if (!any) {
    for (let f = 0; f < n && !any; f += 2) { poseAt(times[f]); for (const s of ['l', 'r']) if (wp(B['ball_' + s]).y < 0 || wp(B['foot_' + s]).y < 0.03 || (G.foot[s].length && meshMin(G, G.foot[s]) < -0.002)) any = true; }
    if (!any) return clip;
  }
  const sm = new Float32Array(n), W = 4;
  for (let f = 0; f < n; f++) { let mx = 0; for (let k = -W; k <= W; k++) mx = Math.max(mx, d[Math.min(n - 1, Math.max(0, f + k))]); sm[f] = mx; }
  for (let f = 0; f < n; f++) { let a = 0, c = 0; for (let k = -2; k <= 2; k++) { a += sm[Math.min(n - 1, Math.max(0, f + k))]; c++; } d[f] = a / c; }
  // pass 2
  const Q = {}; names.forEach(nm => Q[nm] = new Float32Array(n * 4)); const P = new Float32Array(n * 3);
  const fwd = new THREE.Vector3(0, 0, 1); let maxLift = 0;
  for (let f = 0; f < n; f++) {
    poseAt(times[f]);
    const pre = {}; for (const s of ['l', 'r']) pre[s] = { a: wp(B['foot_' + s]), b: wp(B['ball_' + s]), k: wp(B['calf_' + s]) };
    if (d[f] > 0) { const p = wp(B.pelvis); p.y += d[f]; B.pelvis.position.copy(B.pelvis.parent.worldToLocal(p)); E.r.updateMatrixWorld(true); maxLift = Math.max(maxLift, d[f]); }
    for (const s of ['l', 'r']) {
      const pth = paths && paths['foot_' + s];
      if (pth) { const k = pth[Math.min(pth.length - 1, Math.round((times[f] / clip.duration) * (pth.length - 1)))]; ik2(B['thigh_' + s], B['calf_' + s], B['foot_' + s], new THREE.Vector3(k[0] * ratio, Math.max(k[1], 0.05), k[2] * ratio), wp(B['calf_' + s]).add(new THREE.Vector3(s === 'l' ? 0.6 : -0.6, 0.1, 0.2))); }
      else if (d[f] > 0 && (pre[s].b.y < 0.04 || pre[s].a.y < 0.09) && pre[s].k.y > 0.3) ik2(B['thigh_' + s], B['calf_' + s], B['foot_' + s], pre[s].a, wp(B['calf_' + s]).addScaledVector(fwd, 0.4));
      // toes / ankle out of the ground
      let a = wp(B['foot_' + s]);
      if (a.y < 0.045) { ik2(B['thigh_' + s], B['calf_' + s], B['foot_' + s], a.clone().setY(0.045), wp(B['calf_' + s]).addScaledVector(fwd, 0.4)); a = wp(B['foot_' + s]); }
      let b = wp(B['ball_' + s]);
      if (G.foot[s].length) { E.r.updateMatrixWorld(true); const m = meshMin(G, G.foot[s]); if (m < 0) b = b.setY(b.y + m - 0.004); }   // toe cap below ground
      if (b.y < 0.012) { const dir = b.clone().sub(a); const L = dir.length(); const dy = THREE.MathUtils.clamp(0.012 - a.y, -L * 0.95, L * 0.95); const hz = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(Math.sqrt(L * L - dy * dy)); aimSeg(B['foot_' + s], B['ball_' + s], hz.setY(dy)); }
      // r8: iterate on the actual boot mesh (the toe cap sits ~5 cm below the ball bone when the foot points down, e.g.
      // the stab lunge / drag rear leg): pitch the toe up, and if the sole is still below the ground lift the ankle (leg IK)
      if (G.foot[s].length) for (let it = 0; it < 3; it++) {
        E.r.updateMatrixWorld(true); const m = meshMin(G, G.foot[s]); if (m > -0.001) break;
        const aa = wp(B['foot_' + s]), bb = wp(B['ball_' + s]), dir = bb.clone().sub(aa), L = dir.length();
        const dy = THREE.MathUtils.clamp(dir.y - m + 0.003, -L * 0.95, L * 0.6);
        if (it === 0 && dy > dir.y + 1e-3) { const hz = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(Math.sqrt(L * L - dy * dy)); aimSeg(B['foot_' + s], B['ball_' + s], hz.setY(dy)); continue; }
        ik2(B['thigh_' + s], B['calf_' + s], B['foot_' + s], aa.clone().setY(aa.y - m + 0.003), wp(B['calf_' + s]).addScaledVector(fwd, 0.4));
      }
      // hands
      const hp = paths && paths['hand_' + s];
      if (hp) { const k = hp[Math.min(hp.length - 1, Math.round((times[f] / clip.duration) * (hp.length - 1)))]; ik2(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], new THREE.Vector3(k[0] * ratio, k[1], k[2] * ratio), wp(B['upperarm_' + s]).add(new THREE.Vector3(s === 'l' ? 0.5 : -0.5, -0.1, -0.35))); }
      let mn = 9; for (const fn of FING) { const bb = B[fn + '_' + s]; if (bb) mn = Math.min(mn, wp(bb).y - 0.012); }
      if (wp(B['hand_' + s]).y - 0.03 < mn) mn = wp(B['hand_' + s]).y - 0.03;
      if (mn < 0) ik2(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], wp(B['hand_' + s]).setY(wp(B['hand_' + s]).y - mn), wp(B['lowerarm_' + s]).add(new THREE.Vector3(0, 0.3, 0)));
      // r8: glove / finger MESH below the ground (die_prone palm-up hand) -> lift the hand vertically (no slide)
      if (G.hand[s].length) { E.r.updateMatrixWorld(true); const m = meshMin(G, G.hand[s]); if (m < -0.001) ik2(B['upperarm_' + s], B['lowerarm_' + s], B['hand_' + s], wp(B['hand_' + s]).setY(wp(B['hand_' + s]).y - m + 0.003), wp(B['lowerarm_' + s]).add(new THREE.Vector3(0, 0.3, 0))); }
    }
    E.r.updateMatrixWorld(true);
    names.forEach(nm => B[nm].quaternion.toArray(Q[nm], f * 4)); B.pelvis.position.toArray(P, f * 3);
  }
  const tracks = [new THREE.VectorKeyframeTrack('pelvis.position', times, P)];
  names.forEach(nm => { if (nm !== 'root') tracks.push(new THREE.QuaternionKeyframeTrack(nm + '.quaternion', times, Q[nm])); });
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.userData = { ...(clip.userData || {}), grounded: { maxLift: +maxLift.toFixed(3) } };
  mixer.stopAllAction(); mixer.uncacheRoot(S.r);
  return out;
}
