import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rig, sampler, footPts, REST_H } from '../ca_clipkit.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const r3 = x => Math.round(x * 1000) / 1000;
export default async function (c, W, H, args) {
  const L = new GLTFLoader(); const u1 = await L.loadAsync(U1); const ov = await L.loadAsync(args.lib || '/chars/commandos_a/out/ca_anims.glb');
  const C = {}; for (const c of u1.animations) C[c.name] = c; for (const c of ov.animations) C[c.name] = c;
  const clip = C[args.clip]; const R = rig(u1); const smp = sampler(u1, clip); const N = args.N || 28, out = [];
  for (let i = 0; i <= N; i++) { const t = i / N * clip.duration; R.reset(); smp(t, R); const P = footPts(R, 'l');
    const row = [r3(t)]; for (const k of args.pts || ['heel', 'ball', 'toe', 'ankle']) row.push(k[0] + ':' + r3(P[k].y - (REST_H[k] || 0)) + '/' + r3(P[k].z));
    for (const b of args.bones || []) { const p = R.B[b].getWorldPosition(new THREE.Vector3()); row.push(b + ':' + p.toArray().map(r3).join(',')); }
    out.push(row.join(' ')); }
  return { count: 0, result: () => out };
}
