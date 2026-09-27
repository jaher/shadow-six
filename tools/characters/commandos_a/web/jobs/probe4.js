import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rig, sampler } from '../ca_clipkit.js';
import { wpos } from '../ca_ik.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const r3 = x => Math.round(x * 1000) / 1000;
export default async function () {
  const L = new GLTFLoader(); const [u1, ca] = await Promise.all([L.loadAsync(U1), L.loadAsync('/chars/commandos_a/out/ca_anims.glb')]);
  const g = n => ca.animations.find(a => a.name === n); const A = rig(u1), B = rig(u1), sa = sampler(u1, g('walk')), sb = sampler(u1, g('crouch_walk'));
  const out = []; const T = g('walk').duration;
  for (let i = 0; i < 40; i++) { const t = i / 40 * T; A.reset(); B.reset(); sa(t, A); sb(t, B);
    const d = (n) => r3(wpos(A.B[n]).distanceTo(wpos(B.B[n])));
    out.push([r3(t), d('foot_l'), d('foot_r'), d('ball_l'), d('ball_r'), r3(wpos(B.B.pelvis).y), r3(wpos(B.B.ball_r).y), r3(wpos(B.B.ball_r).z), r3(wpos(A.B.ball_r).z)]); }
  return { count: 0, result: () => out };
}
