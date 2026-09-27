// build_ca_anims.js - commandos_a overlay animation library -> commandos_a/out/ca_anims.glb (+ .json meta)
// Clips here REPLACE same-named clips of the shared chars/out/anims.glb when loaded through ca_runtime.loadCALib().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/ex/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeWalk, makeRun, makeCrouchWalk, makeSwim } from '../ca_loco.js';
import { extraClips } from '../ca_poses.js';

const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const U2 = '/realism/characters/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';

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
  const L = new GLTFLoader(); const [u1, u2] = await Promise.all([L.loadAsync(U1), L.loadAsync(U2)]);
  const C = {}; for (const c of [...u1.animations, ...u2.animations]) if (!C[c.name]) C[c.name] = c;
  const clips = [], meta = {};
  const add = (c, m) => { clips.push(c); meta[c.name] = { source: c.userData.source, license: c.userData.license, loop: c.userData.loop !== false, duration: +c.duration.toFixed(3), ...m }; };
  const wk = makeWalk(u1, C, args.walk || {}); add(wk.clip, { groundSpeed: +wk.V0.toFixed(4), contactFrac: +wk.contactFrac.toFixed(2) });
  const rn = makeRun(u1, C, args.run || {}); add(rn.clip, { groundSpeed: +rn.V0.toFixed(4), contactFrac: +rn.contactFrac.toFixed(2) });
  const cw = makeCrouchWalk(u1, wk, args.crouch || {}); add(cw.clip, { groundSpeed: +cw.V0.toFixed(4) });
  const sw = makeSwim(u1, C, args.swim || {}); add(sw.clip, { groundSpeed: +sw.V0.toFixed(4) });
  C.__walk = wk; for (const [c, m] of extraClips(u1, C, args)) add(c, m);
  let k0 = 0, k1 = 0;
  for (const c of clips) c.tracks = c.tracks.map(tr => { k0 += tr.times.length; const r = reduce(tr, tr.name.endsWith('.position') ? 0.001 : 0.003); k1 += r.times.length; return r; });
  const scene = SkeletonUtils.clone(u1.scene);
  const kill = []; scene.traverse(o => { if (o.isMesh) kill.push(o); }); kill.forEach(o => o.removeFromParent());
  let pel; scene.traverse(o => { if (o.name === 'pelvis') pel = o; });
  // stored on the exported ROOT scene AND read defensively by loadCALib (GLTFExporter may push it to a child node)
  scene.userData.shadowSix = { pelvisRest: pel.position.toArray(), skeleton: 'UAL', overlay: 'commandos_a', clips: meta };
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, onlyVisible: false });
  const out = args.out || 'commandos_a/out/ca_anims';
  await fetch('/save?path=' + out + '.glb', { method: 'POST', body: glb });
  await fetch('/save?path=' + out + '.json', { method: 'POST', body: JSON.stringify(meta, null, 1) });
  console.log('ca_anims', clips.length, 'clips', (glb.byteLength / 1e6).toFixed(2), 'MB keys', k0, '->', k1);
  return { count: 0, result: () => meta };
}
