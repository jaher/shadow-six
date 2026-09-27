// build_anims.js - builds the shared animation library for the UAL skeleton: out/anims.glb (+ anims.json)
// UAL1/UAL2 clips (CC0, renamed to game names, tracks stripped to quaternions + pelvis.position) + keyed clips (poses.js). Locomotion clips get a measured groundSpeed (m/s) for foot-slide-free playback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/ex/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { adaptClip } from '../charkit.js';
import { authoredClips } from '../poses.js';
import { bonesOf } from '../rig_util.js';

const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const U2 = '/realism/characters/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';
export const MAP = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', walk_formal: 'Walk_Formal_Loop',
  crouch_idle: 'Crouch_Idle_Loop', crouch_walk: 'Crouch_Fwd_Loop', swim: 'Swim_Fwd_Loop', swim_idle: 'Swim_Idle_Loop',
  aim: 'Pistol_Aim_Neutral', aim_up: 'Pistol_Aim_Up', aim_down: 'Pistol_Aim_Down', shoot: 'Pistol_Shoot', reload: 'Pistol_Reload', pistol_idle: 'Pistol_Idle_Loop',
  punch: 'Punch_Cross', jab: 'Punch_Jab', throw: 'OverhandThrow', plant: 'Fixing_Kneeling', use: 'Interact', pickup: 'PickUp_Table', open: 'Chest_Open',
  climb: 'ClimbUp_1m', carry_walk: 'Walk_Carry_Loop', carry_barrel: 'Walk_Carry_Loop', die: 'Death01', hit: 'Hit_Chest', hit_head: 'Hit_Head', knockback: 'Hit_Knockback',
  talk: 'Idle_Talking_Loop', phone: 'Idle_TalkingPhone_Loop', fold_arms: 'Idle_FoldArms_Loop', yes: 'Yes', no: 'Idle_No_Loop',
  drive: 'Driving_Loop', sit: 'Sitting_Idle_Loop', sit_enter: 'Sitting_Enter', sit_exit: 'Sitting_Exit', push: 'Push_Loop',
  dig: 'Farm_Harvest', bury: 'Farm_PlantSeed', chop: 'TreeChopping_Loop', stand_up: 'LayToIdle', roll: 'Roll', torch: 'Idle_Torch_Loop',
};
const ONESHOT = new Set(['shoot', 'reload', 'punch', 'jab', 'throw', 'pickup', 'open', 'climb', 'die', 'hit', 'hit_head', 'knockback', 'yes', 'sit_enter', 'sit_exit', 'stand_up', 'roll', 'aim', 'aim_up', 'aim_down', 'plant', 'use', 'bury']);
const LOCO = ['walk', 'run', 'sprint', 'walk_formal', 'crouch_walk', 'carry_walk', 'carry_barrel', 'crawl', 'drag', 'swim'];

// ground speed: average forward (+Z) speed of the planted (lowest) foot, sign-flipped (in-place clip)
function groundSpeed(ual, clip) {
  const root = SkeletonUtils.clone(ual.scene); const B = bonesOf(root);
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const N = 60, dt = clip.duration / N; let prev = null, acc = 0, cnt = 0;
  for (let i = 0; i <= N; i++) {
    mixer.setTime(i * dt); root.updateMatrixWorld(true);
    const fl = B.ball_l.getWorldPosition(new THREE.Vector3()), fr = B.ball_r.getWorldPosition(new THREE.Vector3());
    const hl = B.hand_l.getWorldPosition(new THREE.Vector3()), hr = B.hand_r.getWorldPosition(new THREE.Vector3());
    const cur = { fl, fr, hl, hr };
    if (prev) {
      const low = fl.y < fr.y ? 'fl' : 'fr';
      const v = Math.abs(cur[low].z - prev[low].z) / dt;
      if (Math.abs(cur[low].y - Math.min(fl.y, fr.y)) < 1e-6 && v > 0) { acc += v; cnt++; }
    }
    prev = cur;
  }
  return cnt ? acc / cnt : 0;
}

export default async function (canvas, W, H) {
  const L = new GLTFLoader();
  const [u1, u2] = await Promise.all([L.loadAsync(U1), L.loadAsync(U2)]);
  const C = {}; for (const c of [...u1.animations, ...u2.animations]) if (!C[c.name]) C[c.name] = c;
  const clips = [], meta = {};
  for (const [game, src] of Object.entries(MAP)) {
    if (!C[src]) { console.log('missing', src); continue; }
    const c = adaptClip(C[src]); c.name = game;
    clips.push(c); meta[game] = { source: 'UAL ' + src, license: 'CC0 (Quaternius UAL)', loop: !ONESHOT.has(game) };
  }
  // the prone set (crawl*, crawl_idle*, prone_*, go_prone, get_up, die_prone, dead_prone) is authored by
  //     tools/characters/prone (bake_prone.mjs -> write_anims.mjs, run after this job; docs/crawl-animation.md)
  for (const c of authoredClips(u1, C)) { clips.push(c); meta[c.name] = { source: c.userData.source, license: c.userData.license, loop: c.userData.loop !== false }; }
  for (const c of clips) {
    meta[c.name].duration = +c.duration.toFixed(3);
    if (LOCO.includes(c.name)) meta[c.name].groundSpeed = +groundSpeed(u1, c).toFixed(3);
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
  for (const c of clips) { c.tracks = c.tracks.map(tr => { k0 += tr.times.length; const r = reduce(tr, tr.name.endsWith('.position') ? 0.002 : 0.004); k1 += r.times.length; return r; }); }
  console.log('keys', k0, '->', k1);
  // skeleton-only scene
  const scene = SkeletonUtils.clone(u1.scene);
  const kill = []; scene.traverse(o => { if (o.isMesh) kill.push(o); }); kill.forEach(o => o.removeFromParent());
  let pel; scene.traverse(o => { if (o.name === 'pelvis') pel = o; });
  scene.userData.shadowSix = { pelvisRest: pel.position.toArray(), skeleton: 'UAL (Quaternius Universal Animation Library)', clips: meta };
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, onlyVisible: false });
  await fetch('/save?path=out/anims.glb', { method: 'POST', body: glb });
  await fetch('/save?path=out/anims.json', { method: 'POST', body: JSON.stringify(meta, null, 1) });
  console.log('anims:', clips.length, 'clips,', (glb.byteLength / 1e6).toFixed(2), 'MB;', LOCO.map(n => n + '=' + (meta[n] || {}).groundSpeed).join(' '));
  return { count: 0, render() { return null; } };
}
