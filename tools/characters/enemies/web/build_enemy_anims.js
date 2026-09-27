// build_enemy_anims.js - enemy-only clips on the UAL skeleton -> enemies/out/enemy_anims.glb (+ .json)
// Keyed with pipeline/web/poses.js keyedClip() over the ORIGINAL UAL1 frames (CC0; project-authored keys, CC0).
// Merge at runtime: const ex = await loadAnimLibrary('enemies/out/enemy_anims.glb'); for (const [k,c] of ex.clips) lib.clips.set(k,c); Object.assign(lib.meta, ex.meta)
//   smoke          sentry idle (spec §4.1 "idles by smoking"): cigarette to the mouth and back, 5 s loop
//   walk_hands_back / idle_hands_back   Schleper's garden walk (bible §5.5; play walk at speed 0.8x)
//   binoculars     sergeant / officer scanning
//   point          officer / NCO order
//   detonate       engineer on the plunger (M16): kneel + push down (knee on the ground, toes planted, not dug in)
//   die / dead     ENEMY override of Death01: same fall, but the arms are flung forward-out while falling and land spread
//                  beside the body (Death01 swings the hands past the head and lays the left arm over the helmet)
//   walk_fast / run_slow / run_fast   copied from commandos_b/out/anims.glb (gait re-synthesis of UAL Walk_Loop / Jog_Fwd_Loop
//                  with planted stance; CC0 derived from UAL): alert walk at 1.45+ m/s, run below 4.15 m/s (enemy 3.8 m/s)
//   rifle_aim / rifle_fire / rifle_reload   long-gun base poses (bladed torso, cheek down, elbows in the rifle plane);
//                  the hands are IK'd onto the gun every frame by enemy_weapons.js (butt in the shoulder pocket)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/ex/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { keyedClip } from '/chars/pipeline/web/poses.js';

const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const R = (v) => [-v[0], v[1], v[2]];

export default async function () {
  const u1 = await new GLTFLoader().loadAsync(U1);
  const C = {}; for (const c of u1.animations) C[c.name] = c;
  const out = []; const K = (name, o) => out.push(keyedClip(u1, name, o));
  // --- smoke: right hand to the mouth twice per loop
  const down = {}, mouth = { upperarm_r: R([0.22, -0.5, 0.84]), lowerarm_r: R([-0.5, 0.82, 0.25]), hand_r: R([-0.55, 0.7, 0.3]) };
  const hold = { upperarm_r: R([0.18, -0.9, 0.35]), lowerarm_r: R([-0.1, -0.1, 1]), hand_r: R([-0.1, 0, 1]) };
  K('smoke', { base: C.Idle_Loop, keys: [{ t: 0, base_t: 0, dirs: hold }, { t: 1.4, base_t: 1.4, dirs: hold }, { t: 1.9, base_t: 1.9, dirs: mouth, head: [4, 0, 0] },
    { t: 2.6, base_t: 2.4, dirs: mouth, head: [-6, 0, 0] }, { t: 3.1, base_t: 0.4, dirs: hold, head: [-4, 0, 0] }, { t: 5.0, base_t: 2.3, dirs: hold }] });
  // --- hands clasped behind the back
  const back = { upperarm_l: [0.2, -0.88, -0.42], lowerarm_l: [-0.85, 0.05, -0.5], hand_l: [-0.9, -0.1, -0.2],
    upperarm_r: R([0.2, -0.88, -0.42]), lowerarm_r: R([-0.85, 0.12, -0.5]), hand_r: R([-0.9, 0.0, -0.2]) };
  const W = C.Walk_Loop.duration;
  K('walk_hands_back', { base: C.Walk_Loop, keys: Array.from({ length: 33 }, (_, k) => k / 32).map(u => ({ t: u * W, base_t: u * W, dirs: back, spine: [-4, 0, 0], head: [-3, 0, 0] })), meta: { loco: true } });
  K('idle_hands_back', { base: C.Idle_Loop, keys: [{ t: 0, base_t: 0, dirs: back, spine: [-4, 0, 0] }, { t: 1.25, base_t: 1.25, dirs: back, spine: [-4, 0, 0], head: [-3, 8, 0] }, { t: 2.5, base_t: 2.5, dirs: back, spine: [-4, 0, 0] }] });
  // --- binoculars to the eyes, slow scan
  const bino = { upperarm_l: [0.35, -0.3, 0.88], lowerarm_l: [-0.35, 0.72, 0.52], hand_l: [-0.3, 0.7, 0.4],
    upperarm_r: R([0.35, -0.3, 0.88]), lowerarm_r: R([-0.35, 0.72, 0.52]), hand_r: R([-0.3, 0.7, 0.4]) };
  K('binoculars', { base: C.Idle_Loop, keys: [{ t: 0, dirs: bino, spine: [0, -18, 0], head: [-4, -10, 0] }, { t: 2, base_t: 1.2, dirs: bino, spine: [0, 18, 0], head: [-4, 10, 0] }, { t: 4, base_t: 2.4, dirs: bino, spine: [0, -18, 0], head: [-4, -10, 0] }] });
  // --- point forward (order)
  const pt = { upperarm_r: R([0.12, 0.22, 1]), lowerarm_r: R([0.05, 0.18, 1]), hand_r: R([0.05, 0.1, 1]) };
  K('point', { base: C.Idle_Loop, loop: false, keys: [{ t: 0 }, { t: 0.35, base_t: 0.3, dirs: pt, spine: [0, 8, 0] }, { t: 1.3, base_t: 1.1, dirs: pt, spine: [0, 8, 0] }, { t: 1.7, base_t: 1.4 }] });
  // --- detonate: kneel on the right knee, both hands push the plunger down
  const kneel = { thigh_l: [0.12, -0.07, 1], calf_l: [0.05, -1, 0.05], foot_l: [0, -0.2, 1], thigh_r: [-0.12, -1, -0.2], calf_r: [-0.05, -0.2, -1], foot_r: [0, -0.62, -0.78] };
  const up = { upperarm_l: [0.1, -0.15, 1], lowerarm_l: [-0.1, 0.55, 0.8], upperarm_r: R([0.1, -0.15, 1]), lowerarm_r: R([-0.1, 0.55, 0.8]) };
  const dn = { upperarm_l: [0.05, -0.75, 0.66], lowerarm_l: [-0.08, -0.98, 0.15], upperarm_r: R([0.05, -0.75, 0.66]), lowerarm_r: R([-0.08, -0.98, 0.15]) };
  K('detonate', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, pelvisY: -0.37, dirs: { ...kneel, ...up }, spine: [22, 0, 0] }, { t: 0.5, pelvisY: -0.37, dirs: { ...kneel, ...up }, spine: [22, 0, 0] },
    { t: 0.75, pelvisY: -0.4, dirs: { ...kneel, ...dn }, spine: [38, 0, 0] }, { t: 1.4, pelvisY: -0.4, dirs: { ...kneel, ...dn }, spine: [38, 0, 0] }] });
  // --- die: Death01 body, arms kept off the head (flung forward-out while falling, spread on the ground when lying)
  const D = C.Death01.duration;
  const fling = { upperarm_l: [0.75, 0.15, 0.65], lowerarm_l: [0.55, 0.35, 0.75], hand_l: [0.5, 0.35, 0.8], upperarm_r: R([0.75, 0.15, 0.65]), lowerarm_r: R([0.55, 0.35, 0.75]), hand_r: R([0.5, 0.35, 0.8]) };
  // mid-fall: arms swing out to the sides, below shoulder height, hands never pass the helmet
  const mid = { upperarm_l: [0.9, -0.2, 0.1], lowerarm_l: [0.85, -0.15, -0.15], hand_l: [0.8, -0.15, -0.25], upperarm_r: R([0.9, -0.2, 0.0]), lowerarm_r: R([0.85, -0.15, -0.3]), hand_r: R([0.8, -0.15, -0.4]) };
  const lie = { upperarm_l: [0.93, -0.12, -0.34], lowerarm_l: [0.72, -0.06, -0.69], hand_l: [0.55, -0.1, -0.83],
    upperarm_r: R([0.8, -0.14, -0.58]), lowerarm_r: R([0.6, -0.08, -0.8]), hand_r: R([0.45, -0.1, -0.89]) };
  const LH = [35, 0, -25];   // chin off the sky and face turned to his left: the helmet skirt clears the right shoulder
  K('die', { base: C.Death01, loop: false, keys: [{ t: 0, base_t: 0 }, { t: 0.15, base_t: 0.15, head: [22, 0, 0] }, { t: 0.5, base_t: 0.5 }, { t: 0.85, base_t: 0.85, dirs: fling }, { t: 1.12, base_t: 1.12, dirs: mid, head: [25, 0, -12] }, { t: 1.45, base_t: 1.45, dirs: lie, head: LH }, { t: D, base_t: D, dirs: lie, head: LH }] });
  K('dead', { base: C.Death01, keys: [{ t: 0, base_t: D, dirs: lie, head: LH }, { t: 0.5, base_t: D, dirs: lie, head: LH }] });
  // --- rifle holds: bladed (left shoulder forward), slight forward lean, head turned back to the front and canted onto the stock
  const ra = { upperarm_r: R([0.7, -0.6, 0.1]), lowerarm_r: R([-0.35, 0.25, 0.9]), hand_r: R([-0.45, -0.55, 0.7]),
    upperarm_l: [-0.2, -0.45, 0.87], lowerarm_l: [-0.45, 0.1, 0.89], hand_l: [-0.7, 0.05, 0.7] };
  const AIM = { dirs: ra, spine: [8, -36, 0], head: [6, 36, 10] };
  K('rifle_aim', { base: C.Idle_Loop, keys: [{ t: 0, base_t: 0, ...AIM }, { t: 1.25, base_t: 1.25, ...AIM }, { t: 2.5, base_t: 2.5, ...AIM }] });
  K('rifle_fire', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, ...AIM }, { t: 0.05, base_t: 0.05, dirs: ra, spine: [3, -36, 0], head: [2, 36, 10] }, { t: 0.3, base_t: 0.3, ...AIM }, { t: 0.6, base_t: 0.6, ...AIM }] });
  const rl = { upperarm_r: R([0.45, -0.85, -0.1]), lowerarm_r: R([-0.3, 0.2, 0.93]), upperarm_l: [-0.1, -0.7, 0.7], lowerarm_l: [-0.5, -0.1, 0.85] };
  const RL = { dirs: rl, spine: [10, -25, 0], head: [18, 25, 0] };
  K('rifle_reload', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, ...RL }, { t: 1.0, base_t: 1.0, ...RL }, { t: 2.0, base_t: 2.0, ...RL }] });
  // --- gait variants from the commandos_b re-synthesis (same UAL skeleton and pelvis rest)
  const cb = await new GLTFLoader().loadAsync('/chars/commandos_b/out/anims.glb');
  let cbMeta = {}; cb.scene.traverse(o => { if (o.userData && o.userData.shadowSix && o.userData.shadowSix.clips) cbMeta = o.userData.shadowSix.clips; });
  for (const n of ['walk_fast', 'run_slow', 'run_fast']) {
    const c = cb.animations.find(a => a.name === n); if (!c) throw new Error('commandos_b clip missing: ' + n);
    const m = cbMeta[n] || {}; c.userData = { source: 'commandos_b/out/anims.glb ' + n + ' (' + (m.source || 'resynth') + ')', license: m.license || 'CC0 (derived from Quaternius UAL, CC0)', loop: true, groundSpeed: m.groundSpeed };
    out.push(c);
  }
  // lossy key reduction: drop keys that linear/slerp interpolation reproduces within tolerance
  const reduce = (tr, tol) => {
    const n = tr.times.length, s = tr.values.length / n; if (n < 3) return tr;
    const keep = [0]; const v = tr.values, t = tr.times;
    const err = (a, b, i) => { const u = (t[i] - t[a]) / (t[b] - t[a]); let e = 0;
      if (s === 4) { const qa = new THREE.Quaternion().fromArray(v, a * 4), qb = new THREE.Quaternion().fromArray(v, b * 4), qi = new THREE.Quaternion().fromArray(v, i * 4);
        return qa.slerp(qb, u).angleTo(qi); }
      for (let k = 0; k < s; k++) e = Math.max(e, Math.abs(v[a * s + k] + (v[b * s + k] - v[a * s + k]) * u - v[i * s + k])); return e; };
    let a = 0;
    for (let b = 2; b < n; b++) { let bad = false; for (let i = a + 1; i < b; i++) if (err(a, b, i) > tol) { bad = true; break; } if (bad) { keep.push(b - 1); a = b - 1; } }
    keep.push(n - 1);
    const T = keep.map(i => t[i]), V = []; keep.forEach(i => { for (let k = 0; k < s; k++) V.push(v[i * s + k]); });
    return new tr.constructor(tr.name, T, V);
  };
  let k0 = 0, k1 = 0;
  for (const c of out) { c.tracks = c.tracks.map(tr => { k0 += tr.times.length; const r = reduce(tr, tr.name.endsWith('.position') ? 0.002 : 0.004); k1 += r.times.length; return r; }); }
  const meta = {};
  for (const c of out) { meta[c.name] = { source: c.userData.source, license: c.userData.license, loop: c.userData.loop !== false, duration: +c.duration.toFixed(3) }; if (c.userData.groundSpeed) Object.assign(meta[c.name], { groundSpeed: c.userData.groundSpeed, loco: true }); }
  meta.walk_hands_back.groundSpeed = 0.92;   // same base cycle as walk (measured 0.92 m/s in anims.json)
  const scene = SkeletonUtils.clone(u1.scene);
  const kill = []; scene.traverse(o => { if (o.isMesh) kill.push(o); }); kill.forEach(o => o.removeFromParent());
  let pel; scene.traverse(o => { if (o.name === 'pelvis') pel = o; });
  scene.userData.shadowSix = { pelvisRest: pel.position.toArray(), skeleton: 'UAL (Quaternius Universal Animation Library)', clips: meta };
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: out, onlyVisible: false });
  await fetch('/save?path=enemies/out/enemy_anims.glb', { method: 'POST', body: glb });
  await fetch('/save?path=enemies/out/enemy_anims.json', { method: 'POST', body: JSON.stringify(meta, null, 1) });
  console.log('enemy anims:', out.map(c => c.name).join(' '), (glb.byteLength / 1e6).toFixed(2), 'MB');
  return { count: 0, render() { return null; } };
}
