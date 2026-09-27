import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const U1 = '/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb';
const U2 = '/realism/characters/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb';
const r3 = x => Math.round(x * 1000) / 1000;
export default async function () {
  const L = new GLTFLoader(); const [u1, u2] = await Promise.all([L.loadAsync(U1), L.loadAsync(U2)]);
  const res = { names: [...u1.animations, ...u2.animations].map(c => c.name + ':' + c.duration.toFixed(2)) };
  const C = {}; for (const c of [...u1.animations, ...u2.animations]) if (!C[c.name]) C[c.name] = c;
  const root = SkeletonUtils.clone(u1.scene); const B = {}; root.traverse(o => { if (o.isBone && !B[o.name]) B[o.name] = o; });
  root.updateMatrixWorld(true);
  const w = (n) => B[n].getWorldPosition(new THREE.Vector3()).toArray().map(r3);
  res.rest = Object.fromEntries(['pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'middle_01_l', 'index_01_l', 'pinky_01_l', 'thumb_01_l', 'thumb_03_l', 'clavicle_r', 'upperarm_r', 'neck_01', 'Head', 'spine_03'].map(n => [n, w(n)]));
  for (const cn of ['Jog_Fwd_Loop', 'Walk_Loop']) {
    const m = new THREE.AnimationMixer(root); const a = m.clipAction(C[cn]); a.play(); const tr = [];
    const N = 28; for (let i = 0; i <= N; i++) { m.setTime(i * C[cn].duration / N); root.updateMatrixWorld(true); tr.push([r3(i * C[cn].duration / N), ...w('ball_l').map(v=>v), w('pelvis')[1], w('pelvis')[2]]); }
    res[cn] = tr; a.stop(); m.uncacheRoot(root);
  }
  const wg = await L.loadAsync('/chars/out/weapons.glb'); res.weapons = {};
  for (const o of wg.scene.children) { const s = {}; o.traverse(c => { if (c !== o && !c.isMesh) s[c.name] = c.position.toArray().map(r3); }); const bb = new THREE.Box3().setFromObject(o); res.weapons[o.name] = { s, min: bb.min.toArray().map(r3), max: bb.max.toArray().map(r3), pos: o.position.toArray().map(r3) }; }
  const g = await L.loadAsync('/chars/commandos_a/out/sniper.glb'); res.sniperInfo = g.scene.userData.shadowSix;
  return { count: 0, result: () => res };
}
