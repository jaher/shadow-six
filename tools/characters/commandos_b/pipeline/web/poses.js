// poses.js - scripted clip authoring on the ORIGINAL UAL frames (CC0, project code).
// A clip = keys; each key samples a base clip (legs/body) and optionally an upper clip (arms/spine), then applies
// world-space limb directions (character space: +Z forward, +Y up, +X = character's left) and spine/head/pelvis offsets.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { bonesOf, orderedBones, fitSkeleton } from './rig_util.js';

const UPPER_RE = /^(spine_02|spine_03|neck_01|Head|clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;
const D = (a) => new THREE.Vector3(...a).normalize();

function sampler(root, clip) {
  const mixer = new THREE.AnimationMixer(root);
  const a = mixer.clipAction(clip); a.play();
  return (t) => { mixer.setTime(Math.max(0, Math.min(t, clip.duration - 1e-4))); };
}

function rotWorld(b, axis, deg) {   // rotate bone about a world axis, keeping children attached
  const w = b.getWorldQuaternion(new THREE.Quaternion());
  const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg)).multiply(w);
  b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  b.updateMatrixWorld(true);
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// keys: [{t, base_t, upper_t, dirs:{bone:[x,y,z]}, spine:[pitch,yaw,roll], head:[pitch,yaw,roll], pelvisY, pelvisPitch}]
export function keyedClip(ual, name, { base, upper = null, keys, fps = 30, loop = true, meta = {} }) {
  const root = SkeletonUtils.clone(ual.scene);
  root.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });
  const B = bonesOf(root), order = orderedBones(root);
  const rest = order.map(b => [b, b.quaternion.clone(), b.position.clone()]);
  // NOTE: sample into separate (never hand-edited) skeletons: THREE.PropertyMixer skips writes when the sampled
  // value did not change, so a hand-reset skeleton would silently keep its reset pose.
  const baseRoot = SkeletonUtils.clone(ual.scene); const BB = bonesOf(baseRoot);
  const sb = sampler(baseRoot, base);
  let upRoot = null, su = null, UB = null;
  if (upper) { upRoot = SkeletonUtils.clone(ual.scene); UB = bonesOf(upRoot); su = sampler(upRoot, upper); }
  const T = keys[keys.length - 1].t;
  const n = Math.max(2, Math.round(T * fps) + 1);
  const times = new Float32Array(n), Q = {}, P = new Float32Array(n * 3);
  order.forEach(b => Q[b.name] = new Float32Array(n * 4));
  for (let f = 0; f < n; f++) {
    const t = (f / (n - 1)) * T;
    let i = 0; while (i < keys.length - 2 && keys[i + 1].t < t) i++;
    const k0 = keys[i], k1 = keys[Math.min(i + 1, keys.length - 1)];
    const w = k1.t > k0.t ? ease(Math.min(1, Math.max(0, (t - k0.t) / (k1.t - k0.t)))) : 0;
    const num = (k, d = 0) => lerp(k0[k] ?? d, k1[k] ?? d, w);
    const arr = (k) => [0, 1, 2].map(j => lerp((k0[k] || [0, 0, 0])[j], (k1[k] || [0, 0, 0])[j], w));
    rest.forEach(([b, q, p]) => { b.quaternion.copy(q); b.position.copy(p); });
    sb(num('base_t', 0));
    for (const b of order) if (BB[b.name]) { b.quaternion.copy(BB[b.name].quaternion); if (b.name === 'pelvis') b.position.copy(BB[b.name].position); }
    root.updateMatrixWorld(true);
    if (su) {
      su(num('upper_t', 0)); upRoot.updateMatrixWorld(true);
      for (const b of order) if (UPPER_RE.test(b.name) && UB[b.name]) b.quaternion.copy(UB[b.name].quaternion);
      root.updateMatrixWorld(true);
    }
    // pelvis height / pitch
    const py = num('pelvisY', 0), pp = num('pelvisPitch', 0);
    if (pp) rotWorld(B.pelvis, new THREE.Vector3(1, 0, 0), pp);
    if (py) { const wp = B.pelvis.getWorldPosition(new THREE.Vector3()); wp.y += py; B.pelvis.position.copy(B.pelvis.parent.worldToLocal(wp)); }
    root.updateMatrixWorld(true);
    const sp = arr('spine'), hd = arr('head');
    for (const bn of ['spine_02', 'spine_03']) {
      rotWorld(B[bn], new THREE.Vector3(1, 0, 0), sp[0] / 2); rotWorld(B[bn], new THREE.Vector3(0, 1, 0), sp[1] / 2); rotWorld(B[bn], new THREE.Vector3(0, 0, 1), sp[2] / 2);
    }
    rotWorld(B.Head, new THREE.Vector3(1, 0, 0), hd[0]); rotWorld(B.Head, new THREE.Vector3(0, 1, 0), hd[1]); rotWorld(B.Head, new THREE.Vector3(0, 0, 1), hd[2]);
    const dn = new Set([...Object.keys(k0.dirs || {}), ...Object.keys(k1.dirs || {})]);
    if (dn.size) {
      const dirs = {};
      for (const bn of dn) {
        const a = (k0.dirs || {})[bn], b = (k1.dirs || {})[bn];
        if (a && b) dirs[bn] = D(a).lerp(D(b), w).normalize();
        else if (a || b) {   // blend from/to the base pose direction
          const cur = curDir(B, bn);
          dirs[bn] = a ? D(a).lerp(cur, w).normalize() : cur.lerp(D(b), w).normalize();
        }
      }
      fitSkeleton(root, { dir: (bn) => dirs[bn] || null });
    }
    times[f] = t;
    order.forEach(b => b.quaternion.toArray(Q[b.name], f * 4));
    B.pelvis.position.toArray(P, f * 3);
  }
  const tracks = [new THREE.VectorKeyframeTrack('pelvis.position', times, P)];
  order.forEach(b => { if (b.name !== 'root') tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, Q[b.name])); });
  const clip = new THREE.AnimationClip(name, T, tracks);
  clip.userData = { loop, source: 'keyed (poses.js)', license: 'CC0 (project-authored)', ...meta };
  return clip;
}

const SEG_CHILD = { upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', hand_l: 'middle_01_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', hand_r: 'middle_01_r',
  thigh_l: 'calf_l', calf_l: 'foot_l', foot_l: 'ball_l', thigh_r: 'calf_r', calf_r: 'foot_r', foot_r: 'ball_r', clavicle_l: 'upperarm_l', clavicle_r: 'upperarm_r' };
function curDir(B, bn) {
  const a = B[bn].getWorldPosition(new THREE.Vector3()), b = B[SEG_CHILD[bn]].getWorldPosition(new THREE.Vector3());
  return b.sub(a).normalize();
}

// ------------ clip catalogue (authored) ------------
// helper: mirror a direction for the right side
const R = (v) => [-v[0], v[1], v[2]];
export function authoredClips(ual, C) {
  const out = [];
  const K = (name, o) => out.push(keyedClip(ual, name, o));
  // hands up (surrender) + held loop
  const upL = { upperarm_l: [0.35, 1, 0.05], lowerarm_l: [0.1, 1, 0.1], hand_l: [0.05, 1, 0.15] };
  const upR = { upperarm_r: R([0.35, 1, 0.05]), lowerarm_r: R([0.1, 1, 0.1]), hand_r: R([0.05, 1, 0.15]) };
  K('surrender', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, base_t: 0 }, { t: 0.6, base_t: 0.6, dirs: { ...upL, ...upR }, head: [8, 0, 0] }, { t: 0.9, base_t: 0.9, dirs: { ...upL, ...upR }, head: [10, 0, 0] }] });
  K('handsup_held', { base: C.Idle_Loop, keys: [{ t: 0, base_t: 0, dirs: { ...upL, ...upR }, head: [10, 0, 0] }, { t: 1.25, base_t: 1.25, dirs: { ...upL, ...upR }, head: [12, -5, 0] }, { t: 2.5, base_t: 2.5, dirs: { ...upL, ...upR }, head: [10, 0, 0] }] });
  // salute (right hand to the brow)
  const sal = { upperarm_r: R([0.95, 0.3, 0.2]), lowerarm_r: R([-0.55, 0.55, 0.35]), hand_r: R([-0.8, 0.25, 0.2]) };
  K('salute', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, base_t: 0 }, { t: 0.35, base_t: 0.3, dirs: sal }, { t: 1.2, base_t: 1.0, dirs: sal }, { t: 1.6, base_t: 1.3 }] });
  // wave (distract / signal)
  const w1 = { upperarm_r: R([0.6, 0.8, 0.1]), lowerarm_r: R([0.35, 1, 0.1]) }, w2 = { upperarm_r: R([0.6, 0.8, 0.1]), lowerarm_r: R([-0.25, 1, 0.1]) };
  K('wave', { base: C.Idle_Loop, keys: [{ t: 0, dirs: w1 }, { t: 0.3, base_t: 0.3, dirs: w2 }, { t: 0.6, base_t: 0.6, dirs: w1 }, { t: 0.9, base_t: 0.9, dirs: w2 }, { t: 1.2, base_t: 1.2, dirs: w1 }] });
  // look_around (sentry): head/spine yaw sweep on idle
  K('look_around', { base: C.Idle_Loop, keys: [{ t: 0, spine: [0, 0, 0], head: [0, 0, 0] }, { t: 1.0, base_t: 1, spine: [0, 25, 0], head: [0, 40, 0] }, { t: 1.8, base_t: 1.8, spine: [0, 25, 0], head: [-5, 45, 0] }, { t: 3.0, base_t: 0.5, spine: [0, -25, 0], head: [0, -40, 0] }, { t: 3.8, base_t: 1.3, spine: [0, -25, 0], head: [-5, -45, 0] }, { t: 4.8, base_t: 2.3, spine: [0, 0, 0], head: [0, 0, 0] }] });
  // knife stab (Green Beret): wind-up then thrust forward-low
  const st0 = { upperarm_r: R([0.35, -0.6, -0.5]), lowerarm_r: R([0.1, 0.1, 1]) }, st1 = { upperarm_r: R([0.12, -0.05, 1]), lowerarm_r: R([0.05, -0.15, 1]) };
  K('stab', { base: C.Pistol_Idle_Loop || C.Idle_Loop, loop: false, keys: [{ t: 0 }, { t: 0.2, dirs: st0, spine: [0, -15, 0] }, { t: 0.36, dirs: st1, spine: [12, 20, 0], pelvisY: -0.04 }, { t: 0.55, dirs: st1, spine: [12, 20, 0], pelvisY: -0.04 }, { t: 0.9 }] });
  // syringe (Spy): quick jab to the neck of a victim in front
  const sy1 = { upperarm_r: R([0.2, 0.25, 1]), lowerarm_r: R([-0.2, 0.3, 1]) };
  K('syringe', { base: C.Pistol_Idle_Loop || C.Idle_Loop, loop: false, keys: [{ t: 0 }, { t: 0.25, dirs: { upperarm_r: R([0.3, -0.3, -0.2]), lowerarm_r: R([0.1, 0.5, 0.6]) } }, { t: 0.45, dirs: sy1, spine: [8, 10, 0] }, { t: 0.8, dirs: sy1, spine: [8, 10, 0] }, { t: 1.1 }] });
  // kneel (right knee down) + aim: sniper / rifle kneeling fire
  const kneel = { thigh_l: [0.12, -0.1, 1], calf_l: [0.05, -1, 0.05], foot_l: [0, -0.2, 1], thigh_r: [-0.12, -1, -0.2], calf_r: [-0.05, -0.1, -1], foot_r: [0, -0.9, -0.3] };
  K('kneel_shoot', { base: C.Idle_Loop, upper: C.Pistol_Aim_Neutral, keys: [{ t: 0, pelvisY: -0.42, dirs: kneel, spine: [6, 0, 0] }, { t: 1.2, base_t: 1.2, pelvisY: -0.42, dirs: kneel, spine: [6, 0, 0] }, { t: 2.4, base_t: 2.4, pelvisY: -0.42, dirs: kneel, spine: [6, 0, 0] }], meta: { pose: 'kneel' } });
  // drag a body: walk backwards bent over, arms reaching down-forward (plays Walk_Loop in reverse)
  const drag = { upperarm_l: [0.15, -0.8, 0.6], lowerarm_l: [0.05, -0.7, 0.7], upperarm_r: R([0.15, -0.8, 0.6]), lowerarm_r: R([0.05, -0.7, 0.7]) };
  const W = C.Walk_Loop.duration;
  K('drag', { base: C.Walk_Loop, keys: [0, 0.25, 0.5, 0.75, 1].map(u => ({ t: u * W * 1.5, base_t: (1 - u) * W, dirs: drag, spine: [28, 0, 0], pelvisY: -0.08 })), meta: { reverse: true } });
  // lower a ladder / rope: arms high then hand-over-hand down
  const la = { upperarm_l: [0.25, 0.7, 0.8], lowerarm_l: [0.1, 0.3, 1], upperarm_r: R([0.25, 0.2, 1]), lowerarm_r: R([0.1, -0.3, 1]) };
  const lb = { upperarm_l: [0.25, 0.2, 1], lowerarm_l: [0.1, -0.3, 1], upperarm_r: R([0.25, 0.7, 0.8]), lowerarm_r: R([0.1, 0.3, 1]) };
  K('lower_ladder', { base: C.Idle_Loop, keys: [{ t: 0, dirs: la, spine: [10, 0, 0] }, { t: 0.6, base_t: 0.6, dirs: lb, spine: [16, 0, 0] }, { t: 1.2, base_t: 1.2, dirs: la, spine: [10, 0, 0] }] });
  // carry idle (body over the shoulder) = first frame of Walk_Carry_Loop held, gentle breathing via Idle
  if (C.Walk_Carry_Loop) K('carry_idle', { base: C.Idle_Loop, upper: C.Walk_Carry_Loop, keys: [{ t: 0, upper_t: 0 }, { t: 2.5, base_t: 2.5, upper_t: 0 }] });
  // rifle recoil (upper body kick over the shoulder aim)
  K('rifle_shoot', { base: C.Idle_Loop, upper: C.Pistol_Aim_Neutral, loop: false, keys: [{ t: 0 }, { t: 0.06, spine: [-6, 0, 0], head: [-3, 0, 0] }, { t: 0.3 }, { t: 0.6 }] });
  // dive (swim pitched down) and dead (last frame of Death01, held)
  K('dive', { base: C.Swim_Fwd_Loop, keys: [{ t: 0, base_t: 0, pelvisPitch: 35 }, { t: C.Swim_Fwd_Loop.duration, base_t: C.Swim_Fwd_Loop.duration, pelvisPitch: 35 }] });
  K('dead', { base: C.Death01, keys: [{ t: 0, base_t: C.Death01.duration }, { t: 0.5, base_t: C.Death01.duration }] });
  return out;
}
