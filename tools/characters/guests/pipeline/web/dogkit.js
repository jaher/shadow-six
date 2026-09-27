// dogkit.js - runtime for the Alsatian guard dog GLB (guests build group). Same interface family as charkit's humanoid:
//   const tpl = await loadDog('/chars/guests/out/dogs/dog_a.glb');  const d = createDog(tpl);
//   d.setAnim('walk', { speed: 1.3 });  d.setAnim('die', { loop: false });  d.update(dt);  d.autoLOD(pxPerMetre);
//   clips: idle walk sniff_walk trot run sniff bark attack die dead sit   (meta: loop, duration, groundSpeed, events)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export async function loadDog(url) {
  const g = await new GLTFLoader().loadAsync(url);
  let meta = {};
  try { meta = await (await fetch(url.replace(/\.glb$/, '.sidecar.json'))).json(); } catch (e) { /* optional */ }
  return { gltf: g, clips: new Map(g.animations.map(c => [c.name, c])), meta };
}

export function createDog(tpl) {
  const object = SkeletonUtils.clone(tpl.gltf.scene);
  const parts = {};
  object.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; parts[o.name] = o; }
  });
  const mixer = new THREE.AnimationMixer(object);
  const cm = (tpl.meta && tpl.meta.clips) || {};
  let cur = null, curName = null;
  const setAnim = (name, { loop, speed, timeScale, fade = 0.2 } = {}) => {
    const clip = tpl.clips.get(name); if (!clip) return false;
    const m = cm[name] || {};
    const a = mixer.clipAction(clip);
    const lp = loop ?? (m.loop !== false);
    a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !lp;
    a.timeScale = timeScale ?? (speed && m.groundSpeed ? speed / m.groundSpeed : 1);
    if (name !== curName) { a.reset().play(); if (cur && fade > 0) cur.crossFadeTo(a, fade, false); else if (cur) cur.stop(); }
    cur = a; curName = name; return true;
  };
  const lod = (k) => { for (const n of ['LOD0', 'LOD1', 'LOD2']) if (parts[n]) parts[n].visible = n === k; };
  lod('LOD0');
  return {
    object, parts, mixer, setAnim, update: (dt) => mixer.update(dt),
    autoLOD: (ppm) => lod(ppm >= 60 ? 'LOD0' : ppm >= 28 ? 'LOD1' : 'LOD2'),
    setColors: ({ tint } = {}) => { if (tint) for (const n in parts) { parts[n].material = parts[n].material.clone(); parts[n].material.color.setRGB(...tint); } },
    get anim() { return curName; },
  };
}
