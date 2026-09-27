import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCharacter, createHumanoid } from '../charkit.js';
export default async function (canvas, W, H) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true }); r.setSize(W, H, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x777777);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 4, 3); scene.add(d);
  const ual = await new GLTFLoader().loadAsync('/realism/characters/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb');
  let pel; ual.scene.traverse(o => { if (o.name === 'pelvis') pel = o; });
  const lib = { clips: new Map(ual.animations.map(c => [c.name, c])), meta: {}, srcPelvisRest: pel.position.clone() };
  const tpl = await loadCharacter('/chars/out/probe_char.glb');
  const names = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Death01'];
  const hs = names.map((n, i) => { const h = createHumanoid(tpl, lib); h.object.position.x = (i - 1.5) * 1.1; scene.add(h.object); h.setAnim(n, { fade: 0 }); h.update(0.4); return h; });
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  return { count: 2, render(i) { if (i == 0) cam.position.set(0, 1.2, 9); else cam.position.set(9, 1.2, 0); cam.lookAt(0, 1, 0); r.render(scene, cam); return ['front', 'side'][i]; } };
}
