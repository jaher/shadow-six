import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rig, sampler } from '../ca_clipkit.js';
import { wpos } from '../ca_ik.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const r3 = x => Math.round(x * 1000) / 1000;
export default async function (c, W, H, args) {
  const L = new GLTFLoader(); const [u1, ca] = await Promise.all([L.loadAsync(U1), L.loadAsync('/chars/commandos_a/out/ca_anims.glb')]);
  const clip = ca.animations.find(a => a.name === (args.clip || 'go_prone')); const R = rig(u1), s = sampler(u1, clip);
  const J = ['pelvis', 'Head', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'hand_l', 'hand_r', 'lowerarm_l', 'lowerarm_r', 'ball_l', 'ball_r'];
  const res = []; let prev = null;
  for (let t = 0; t <= clip.duration + 1e-6; t += 1 / 30) { R.reset(); s(t, R); const P = Object.fromEntries(J.map(j => [j, wpos(R.B[j])]));
    let mx = 0, at = ''; if (prev) for (const j of J) { const d = P[j].distanceTo(prev[j]); if (d > mx) { mx = d; at = j; } }
    res.push([r3(t), r3(mx), at, ...(args.show || ['pelvis', 'Head', 'hand_l', 'calf_l']).map(j => P[j].toArray().map(v => r3(v)).join(','))]); prev = P; }
  return { count: 0, result: () => res };
}
