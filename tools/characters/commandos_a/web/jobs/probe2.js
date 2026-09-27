import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rig, sampler } from '../ca_clipkit.js';
import { wpos } from '../ca_ik.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const U2 = '/realism/characters/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';
const r3 = x => Math.round(x * 1000) / 1000;
export default async function () {
  const L = new GLTFLoader(); const [u1, u2, ca] = await Promise.all([L.loadAsync(U1), L.loadAsync(U2), L.loadAsync('/chars/commandos_a/out/ca_anims.glb')]);
  const C = {}; for (const c of [...u1.animations, ...u2.animations, ...ca.animations]) if (!C[c.name]) C[c.name] = c;
  const res = {}; const R = rig(u1);
  const J = ['pelvis', 'spine_03', 'Head', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r', 'upperarm_l'];
  for (const [cn, ts] of [['Idle_Loop', [0]], ['Crouch_Idle_Loop', [0]], ['Fixing_Kneeling', [0, 0.5, 1, 2]], ['crawl_idle', [0]], ['Swim_Fwd_Loop', [0, 0.33, 0.67, 1.0]], ['Crouch_Fwd_Loop', [0, 0.5, 1, 1.5]], ['LayToIdle', [0, 0.5, 1.0, 1.5]]]) {
    const s = sampler(u1, C[cn]); res[cn] = { dur: r3(C[cn].duration) };
    for (const t of ts) { R.reset(); s(t, R); res[cn]['t' + t] = Object.fromEntries(J.map(j => [j, wpos(R.B[j]).toArray().map(r3)])); }
  }
  return { count: 0, result: () => res };
}
