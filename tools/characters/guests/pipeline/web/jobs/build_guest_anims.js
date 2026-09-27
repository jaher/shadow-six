// build_guest_anims.js (rework r1) - guest-only clips on the UAL skeleton -> guests/out/guest_anims.glb (+ .json)
// Overlay on the shared rework lib (commandos_b/out/anims.glb); guestkit.js merges them (guest clips win).
//   tied_idle, freed                    hands tied in front (bible §6) / rub wrists when freed
//   tied_walk, tied_walk_fast           synth.js gait re-synthesis (planted stance, 108 / 156 steps/min) + tied arms
//   follow_walk, follow_idle            single file behind Gilbert (spec §3.5): hurried, slightly crouched, eyes on the leader
//   die_run                             shot while running: momentum carries him forward onto his face (-> dead_prone)
//   board_boat, boat_sit, board_truck, board_car, car_sit   see guest_board.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/ex/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { keyedClip } from '../poses.js';
import { adaptClip, loadAnimLibrary } from '../charkit.js';
import { resampleLoco } from '../synth.js';
import { frameAt, applyQ, overlay, poseClip, rotW } from '../guest_synth.js';
import { boardClips } from '../guest_board.js';

const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const BASE = '/chars/commandos_b/out/anims.glb';
const R = (v) => [-v[0], v[1], v[2]];
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export default async function () {
  const u1 = await new GLTFLoader().loadAsync(U1); const U = u1.scene;
  const C = {}; for (const c of u1.animations) C[c.name] = c;
  const base = await loadAnimLibrary(BASE); const L = (n) => base.clips.get(n);
  const out = []; const K = (name, o) => out.push(keyedClip(u1, name, o));
  const add = (c) => { out.push(c); return c; };
  // --- hands tied in front (wrists together at the belt buckle, shoulders rolled in)
  const tied = { upperarm_l: [-0.12, -0.9, 0.38], lowerarm_l: [-0.62, -0.22, 0.75], hand_l: [-0.55, -0.35, 0.75],
    upperarm_r: R([-0.12, -0.9, 0.38]), lowerarm_r: R([-0.62, -0.22, 0.75]), hand_r: R([-0.55, -0.35, 0.75]) };
  K('tied_idle', { base: C.Idle_Loop, keys: [{ t: 0, base_t: 0, dirs: tied, spine: [6, 0, 0], head: [10, 0, 0] }, { t: 1.4, base_t: 1.4, dirs: tied, spine: [6, 0, 0], head: [6, -14, 0] },
    { t: 2.8, base_t: 2.8, dirs: tied, spine: [6, 0, 0], head: [10, 8, 0] }, { t: 4.0, base_t: 0.1, dirs: tied, spine: [6, 0, 0], head: [10, 0, 0] }] });
  const rubA = { upperarm_l: [-0.1, -0.85, 0.5], lowerarm_l: [-0.7, 0.05, 0.7], upperarm_r: R([-0.1, -0.85, 0.5]), lowerarm_r: R([-0.55, -0.1, 0.8]) };
  const rubB = { upperarm_l: [-0.1, -0.85, 0.5], lowerarm_l: [-0.55, -0.1, 0.8], upperarm_r: R([-0.1, -0.85, 0.5]), lowerarm_r: R([-0.7, 0.05, 0.7]) };
  K('freed', { base: C.Idle_Loop, loop: false, keys: [{ t: 0, dirs: tied, head: [10, 0, 0] }, { t: 0.35, dirs: rubA, head: [14, 0, 0] }, { t: 0.7, base_t: 0.5, dirs: rubB, head: [14, 0, 0] },
    { t: 1.05, base_t: 0.9, dirs: rubA, head: [12, 0, 0] }, { t: 1.4, base_t: 1.2, dirs: rubB, head: [6, 0, 0] }, { t: 1.9, base_t: 1.7, head: [0, 0, 0] }] });
  // tied arm pose as LOCAL rotations (relative to the chest) -> carried onto any gait without disturbing the legs
  const tiedRef = frameAt(U, out[0], 0);
  const ARM = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
  const tiedArms = (lean, head) => (Rg) => {
    for (const b of Rg.order) if (ARM.test(b.name)) b.quaternion.copy(tiedRef.q[b.name]);
    Rg.root.updateMatrixWorld(true); rotW(Rg.B.spine_02, X, lean / 2); rotW(Rg.B.spine_03, X, lean / 2); rotW(Rg.B.Head, X, head);
  };
  const W = adaptClip(C.Walk_Loop);
  const gait = (name, o, post) => { const g = resampleLoco(U, W, { name: name + '_g', ...o }); const c = overlay(U, g, name, post); c.userData = { ...g.userData, loco: true }; return add(c); };
  gait('tied_walk', { v: 1.1, spm: 108, duty: 0.63, armScale: 0.15, lift: 0.9 }, tiedArms(6, 8));
  gait('tied_walk_fast', { v: 2.2, spm: 156, duty: 0.58, armScale: 0.15, lift: 1.15 }, tiedArms(8, 4));
  // --- single file (M17): hurried, knees a little bent, chest forward, head up on the man in front
  gait('follow_walk', { v: 2.2, spm: 152, duty: 0.6, armScale: 0.75, lift: 1.1, bodyPitch: 9, pelvisDY: -0.045 }, (Rg) => rotW(Rg.B.Head, X, -7));
  const I = C.Idle_Loop;
  const fi = (t, it, yaw, extra = {}) => ({ t, src: [I, it], foot_l: 'src', foot_r: 'src', pelDY: -0.06, spine: [10, yaw * 0.4, 0], head: [-4, yaw, 0], ease: 'io', ...extra });
  add(poseClip(U, 'follow_idle', [fi(0, 0, 0), fi(1.2, 0.8, 28), fi(2.2, 1.6, 22), fi(3.4, 2.2, -30), fi(4.4, 0.4, -24), fi(5.2, 0, 0)], { loop: true, easeEnds: false, meta: { pose: 'crouch-lite' } }));
  // --- crawl / go_prone / get_up: the prone set (crawl*, crawl_idle*, prone_*, go_prone, get_up, die_prone, dead_prone) is authored by
  //     tools/characters/prone (bake_prone.mjs -> write_anims.mjs, run after this job; docs/crawl-animation.md)
  const ci = L('crawl_idle_unarmed') || L('crawl_idle'), dp = L('dead_prone'), run = L('run');
  // --- shot while running: stumble, knees buckle, hands out, face down; pelvis travels 1.3 m (guestkit moves the root)
  // four start phases of the run cycle (guestkit picks the nearest one -> no half-stride pop in the cross-fade)
  for (const ph of [0, 0.25, 0.5, 0.75]) add(poseClip(U, ph ? 'die_run_' + ph * 100 : 'die_run', [
    { t: 0, src: [run, ph * run.duration] },
    { t: 0.18, src: [run, ph * run.duration + 0.12], pel: [0, 0.86, 0.62], spine: [14, 0, 4], head: [-12, 0, 0] },
    { t: 0.42, src: [ci, 0], pitch: -62, pel: [0, 0.55, 1.02], foot_l: [0.2, 0.1, 0.62], foot_r: [-0.22, 0.12, 0.48], hand_l: [0.34, 0.45, 1.45], hand_r: [-0.34, 0.42, 1.45], head: [-25, 0, 0] },
    { t: 0.62, src: [dp, 0], pitch: -14, pel: [0, 0.3, 1.24], hand_l: [0.4, 0.07, 1.72], hand_r: [-0.38, 0.07, 1.7] },
    { t: 1.0, src: [dp, 0], pel: [0, 0.22, 1.31], foot_l: 'src+', foot_r: 'src+', hand_l: 'src+', hand_r: 'src+' }], { meta: { travel: [0, 0, 1.3], next: 'dead_prone', prone: true } }));
  for (const c of boardClips(U, C, base.clips)) add(c);
  return save(u1, out);
}

async function save(u1, out) {
  const reduce = (tr, tol) => {
    const n = tr.times.length, s = tr.values.length / n; if (n < 3) return tr;
    const keep = [0]; const v = tr.values, t = tr.times;
    const err = (a, b, i) => { const u = (t[i] - t[a]) / (t[b] - t[a]); let e = 0;
      if (s === 4) { const qa = new THREE.Quaternion().fromArray(v, a * 4), qb = new THREE.Quaternion().fromArray(v, b * 4), qi = new THREE.Quaternion().fromArray(v, i * 4); return qa.slerp(qb, u).angleTo(qi); }
      for (let k = 0; k < s; k++) e = Math.max(e, Math.abs(v[a * s + k] + (v[b * s + k] - v[a * s + k]) * u - v[i * s + k])); return e; };
    let a = 0;
    for (let b = 2; b < n; b++) { let bad = false; for (let i = a + 1; i < b; i++) if (err(a, b, i) > tol) { bad = true; break; } if (bad) { keep.push(b - 1); a = b - 1; } }
    keep.push(n - 1);
    const T = keep.map(i => t[i]), V = []; keep.forEach(i => { for (let k = 0; k < s; k++) V.push(v[i * s + k]); });
    return new tr.constructor(tr.name, T, V);
  };
  for (const c of out) c.tracks = c.tracks.map(tr => reduce(tr, tr.name.endsWith('.position') ? 0.0015 : 0.003));
  const meta = {};
  for (const c of out) { const { source, license, loop, ...rest } = c.userData || {}; meta[c.name] = { source, license, loop: loop !== false, ...rest, duration: +c.duration.toFixed(3) }; }
  const scene = SkeletonUtils.clone(u1.scene);
  const kill = []; scene.traverse(o => { if (o.isMesh) kill.push(o); }); kill.forEach(o => o.removeFromParent());
  let pel; scene.traverse(o => { if (o.name === 'pelvis') pel = o; });
  scene.userData.shadowSix = { pelvisRest: pel.position.toArray(), skeleton: 'UAL (Quaternius Universal Animation Library)', clips: meta, rework: 'guests r1' };
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: out, onlyVisible: false });
  await fetch('/save?path=guests/out/guest_anims.glb', { method: 'POST', body: glb });
  await fetch('/save?path=guests/out/guest_anims.json', { method: 'POST', body: JSON.stringify(meta, null, 1) });
  console.log('guest anims:', out.map(c => c.name).join(' '), (glb.byteLength / 1e6).toFixed(2), 'MB');
  for (const c of out) if (c.userData.maxIkErr != null) console.log(c.name, JSON.stringify({ gs: c.userData.groundSpeed, spm: c.userData.spm, ik: c.userData.maxIkErr, drop: c.userData.maxDrop }));
  return { count: 0, render() { return null; } };
}
