// build_anims_b2.js - rework #2 of commandos_b/out/anims.glb: starts from the r1 library (anims_r1.glb, built by
// build_anims_b.js) and REPLACES the clips the review flagged:
//  * the prone set (crawl*, die_prone, dead_prone, ...) is authored in tools/characters/prone (docs/crawl-animation.md)
//  * drag -> commandos_a drag v2 (stance-warped brisk walk played backwards, bent over, hands under the armpits)
//  * crouch_walk re-synthesised (synth.js resampleLoco, planted stance) + crouch_fast variant for fast crouched moves
// Meta stays on scene userData.shadowSix (clips).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/ex/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { adaptClip } from '../charkit.js';
import { resampleLoco } from '../synth.js';
import { makeWalk } from '../ca_port/ca_loco.js';
import { makeDragFromWalk } from '../ca_port/ca_poses.js';

const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const U2 = '/realism/characters/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';
const BASE = '/chars/commandos_b/out/anims_r1.glb';

function reduce(tr, tol) {
  const n = tr.times.length, s = tr.values.length / n; if (n < 3) return tr;
  const keep = [0]; const v = tr.values, t = tr.times;
  const err = (a, b, i) => { const u = (t[i] - t[a]) / (t[b] - t[a]);
    if (s === 4) { const qa = new THREE.Quaternion().fromArray(v, a * 4), qb = new THREE.Quaternion().fromArray(v, b * 4), qi = new THREE.Quaternion().fromArray(v, i * 4); return qa.slerp(qb, u).angleTo(qi); }
    let e = 0; for (let k = 0; k < s; k++) e = Math.max(e, Math.abs(v[a * s + k] + (v[b * s + k] - v[a * s + k]) * u - v[i * s + k])); return e; };
  let a = 0;
  for (let b = 2; b < n; b++) { let bad = false; for (let i = a + 1; i < b; i++) if (err(a, b, i) > tol) { bad = true; break; } if (bad) { keep.push(b - 1); a = b - 1; } }
  keep.push(n - 1);
  const T = keep.map(i => t[i]), V = []; keep.forEach(i => { for (let k = 0; k < s; k++) V.push(v[i * s + k]); });
  return new tr.constructor(tr.name, T, V);
}

export default async function (canvas, W, H, args = {}) {
  const L = new GLTFLoader();
  const [u1, u2, base] = await Promise.all([L.loadAsync(U1), L.loadAsync(U2), L.loadAsync(BASE)]);
  const C = {}; for (const c of [...u1.animations, ...u2.animations]) if (!C[c.name]) C[c.name] = c;
  let ud = base.scene.userData.shadowSix; if (!ud) base.scene.traverse(o => { if (!ud && o.userData.shadowSix) ud = o.userData.shadowSix; });
  const meta = JSON.parse(JSON.stringify(ud.clips));
  const clips = new Map(); for (const c of base.animations) clips.set(c.name, c);
  const fresh = new Set();
  const put = (c, m) => { c.tracks = c.tracks.map(tr => reduce(tr, tr.name.endsWith('.position') ? 0.001 : 0.003)); clips.set(c.name, c); fresh.add(c.name); meta[c.name] = { ...m, duration: +c.duration.toFixed(3) }; };
  const CAL = 'CC0 (project-authored, commandos_a IK clip on UAL skeleton)';
  // --- the prone set (crawl*, crawl_idle*, prone_*, go_prone, get_up, die_prone, dead_prone) is authored by
  //     tools/characters/prone (bake_prone.mjs -> write_anims.mjs, run after this job; docs/crawl-animation.md)
  // --- drag: brisk stance-warped walk played backwards
  const wk = makeWalk(u1, C, {}); const dr = makeDragFromWalk(u1, wk);
  put(dr.clip, { source: dr.clip.userData.source, license: CAL, loop: true, loco: true, groundSpeed: +dr.V0.toFixed(4), reverse: true, moveDir: -1 });
  // --- crouch walk (planted re-synthesis of UAL Crouch_Fwd_Loop) + fast crouched variant
  const CW = adaptClip(C.Crouch_Fwd_Loop);
  const cws = [resampleLoco(u1.scene, CW, { name: 'crouch_walk', v: args.cwV || 1.05, spm: args.cwSpm || 104, duty: 0.62, armScale: 0.8 }),
    // fast crouched move = stooped brisk walk (UAL Walk_Loop, pelvis lowered, trunk pitched): the deep UAL crouch at
    // 2 m/s turned into a lunge with the rear toe dragging
    resampleLoco(u1.scene, adaptClip(C.Walk_Loop), { name: 'crouch_fast', v: args.cfV || 2.1, spm: args.cfSpm || 148, duty: 0.56, armScale: 0.7, lift: 1.5, bodyPitch: args.cfPitch ?? 24, pelvisDY: args.cfDY ?? -0.2 })];
  for (const g of cws) { const { source, license, ...rest } = g.userData; put(g, { source: (g.name === 'crouch_fast' ? 'UAL Walk_Loop stooped (pelvis -0.2, trunk +24 deg)' : 'UAL Crouch_Fwd_Loop') + ' re-synthesised (synth.js resampleLoco, planted stance)', license: 'CC0 (Quaternius UAL + project)', ...rest, loop: true, loco: true }); }
  // export
  const list = [...clips.values()];
  const scene = SkeletonUtils.clone(u1.scene);
  const kill = []; scene.traverse(o => { if (o.isMesh) kill.push(o); }); kill.forEach(o => o.removeFromParent());
  scene.userData.shadowSix = { ...ud, clips: meta, rework: 'commandos_b r2 (CA IK crawl/drag, crouch resynth)' };
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: list, onlyVisible: false });
  const out = args.out || 'commandos_b/out/anims';
  await fetch('/save?path=' + out + '.glb', { method: 'POST', body: glb });
  await fetch('/save?path=' + out + '.json', { method: 'POST', body: JSON.stringify(meta, null, 1) });
  const rep = {}; for (const n of fresh) rep[n] = meta[n];
  console.log('anims_b2:', list.length, 'clips', (glb.byteLength / 1e6).toFixed(2), 'MB; replaced', [...fresh].join(','));
  return { count: 0, result: () => rep };
}
