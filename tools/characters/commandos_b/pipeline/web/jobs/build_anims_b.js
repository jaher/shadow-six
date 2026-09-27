// build_anims_b.js - rework of the shared animation library -> chars/commandos_b/out/anims.glb (+ anims.json)
// = build_anims.js (UAL clips + poses.js) with: re-synthesised gaits (walk_fast, run_slow, run, run_fast: planted stance,
// realistic cadence), planted crawl v2 (+ effector paths for per-character grounding), prone death, fireman's carry +
// carried body, set_trap, cut_wire, change_clothes, corrected kneel_shoot. Meta lives on scene userData.shadowSix.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/ex/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { adaptClip } from '../charkit.js';
import { authoredClips } from '../poses.js';
import { reworkClips } from '../poses_b.js';
import { resampleLoco } from '../synth.js';
import { MAP } from './build_anims.js';
import { bonesOf } from '../rig_util.js';

const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const U2 = '/realism/characters/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';
const ONESHOT = new Set(['shoot', 'reload', 'punch', 'jab', 'throw', 'pickup', 'open', 'climb', 'die', 'hit', 'hit_head', 'knockback', 'yes', 'sit_enter', 'sit_exit', 'stand_up', 'roll', 'aim', 'aim_up', 'aim_down', 'plant', 'use', 'bury']);
const MEASURE = ['walk', 'sprint', 'walk_formal', 'crouch_walk', 'drag', 'swim'];

function groundSpeed(ual, clip) {   // as build_anims.js: planted-foot speed of an in-place clip (fine for walks)
  const root = SkeletonUtils.clone(ual.scene); const B = bonesOf(root);
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const N = 60, dt = clip.duration / N; let prev = null, acc = 0, cnt = 0;
  for (let i = 0; i <= N; i++) {
    mixer.setTime(i * dt); root.updateMatrixWorld(true);
    const cur = { fl: B.ball_l.getWorldPosition(new THREE.Vector3()), fr: B.ball_r.getWorldPosition(new THREE.Vector3()) };
    if (prev) { const low = cur.fl.y < cur.fr.y ? 'fl' : 'fr'; const v = Math.abs(cur[low].z - prev[low].z) / dt; if (v > 0) { acc += v; cnt++; } }
    prev = cur;
  }
  return cnt ? acc / cnt : 0;
}

export default async function () {
  const L = new GLTFLoader();
  const [u1, u2] = await Promise.all([L.loadAsync(U1), L.loadAsync(U2)]);
  const C = {}; for (const c of [...u1.animations, ...u2.animations]) if (!C[c.name]) C[c.name] = c;
  const clips = new Map(), meta = {};
  const add = (c, m) => { clips.set(c.name, c); meta[c.name] = { ...(meta[c.name] || {}), ...m }; };
  for (const [game, src] of Object.entries(MAP)) {
    if (!C[src]) continue; const c = adaptClip(C[src]); c.name = game;
    add(c, { source: 'UAL ' + src, license: 'CC0 (Quaternius UAL)', loop: !ONESHOT.has(game) });
  }
  for (const c of authoredClips(u1, C)) add(c, { source: c.userData.source, license: c.userData.license, loop: c.userData.loop !== false });
  // --- gaits (synth.js). UAL-space speeds; characters scale by pelvisRatio (~1.0-1.08) at runtime.
  const W = adaptClip(C.Walk_Loop), J = adaptClip(C.Jog_Fwd_Loop);
  const gaits = [
    resampleLoco(u1.scene, W, { name: 'walk_fast', v: 2.2, spm: 158, duty: 0.6, armScale: 1.3, lift: 1.2 }),
    resampleLoco(u1.scene, J, { name: 'run_slow', v: 3.7, spm: 164, duty: 0.4, roll: [0, 0] }),
    resampleLoco(u1.scene, J, { name: 'run', v: 4.4, spm: 174, duty: 0.36, roll: [0, 0] }),
    resampleLoco(u1.scene, J, { name: 'run_fast', v: 5.2, spm: 186, duty: 0.31, roll: [0, 0], bodyPitch: 5 }),
  ];
  for (const g of gaits) add(g, { ...g.userData, loop: true, loco: true });
  const carryBase = resampleLoco(u1.scene, W, { name: 'carry_base', v: 1.55, spm: 116, duty: 0.64, armScale: 0.3, lift: 0.9, pelvisDY: -0.02 });
  // --- the prone set (crawl*, crawl_idle*, prone_*, go_prone, get_up, die_prone, dead_prone) is authored by
  //     tools/characters/prone (bake_prone.mjs -> write_anims.mjs, run after this job; docs/crawl-animation.md)
  // --- rework keyed clips
  for (const c of reworkClips(u1, C, { carryBase })) {
    const { source, license, loop, ...rest } = c.userData;
    add(c, { source, license, loop: loop !== false, ...rest });
  }
  meta.carry_walk.groundSpeed = carryBase.userData.groundSpeed;
  for (const n of MEASURE) if (clips.has(n)) meta[n].groundSpeed = +groundSpeed(u1, clips.get(n)).toFixed(3);
  meta.drag.moveDir = -1;       // drag: walks backwards, pulling the body -> move the root backwards at `speed`
  for (const [n, c] of clips) meta[n].duration = +c.duration.toFixed(3);
  // lossy key reduction (as build_anims.js)
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
  const list = [...clips.values()];
  for (const c of list) c.tracks = c.tracks.map(tr => reduce(tr, tr.name.endsWith('.position') ? 0.0015 : 0.003));
  const scene = SkeletonUtils.clone(u1.scene);
  const kill = []; scene.traverse(o => { if (o.isMesh) kill.push(o); }); kill.forEach(o => o.removeFromParent());
  let pel; scene.traverse(o => { if (o.name === 'pelvis') pel = o; });
  scene.userData.shadowSix = { pelvisRest: pel.position.toArray(), skeleton: 'UAL (Quaternius Universal Animation Library)', clips: meta, rework: 'commandos_b' };
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: list, onlyVisible: false });
  await fetch('/save?path=commandos_b/out/anims.glb', { method: 'POST', body: glb });
  await fetch('/save?path=commandos_b/out/anims.json', { method: 'POST', body: JSON.stringify(meta, null, 1) });
  console.log('anims_b:', list.length, 'clips,', (glb.byteLength / 1e6).toFixed(2), 'MB');
  for (const n of ['walk', 'walk_fast', 'run_slow', 'run', 'run_fast', 'crawl', 'carry_walk']) console.log(n, JSON.stringify({ gs: meta[n].groundSpeed, spm: meta[n].spm, drop: meta[n].maxDrop, ik: meta[n].maxIkErr }));
  return { count: 0, render() { return null; } };
}
