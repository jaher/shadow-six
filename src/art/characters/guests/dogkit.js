// Copied from scratchpad chars/guests/pipeline/web/dogkit.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// dogkit.js - runtime for the Alsatian guard dog GLB (guests build group). Same interface family as charkit's humanoid:
//   const tpl = await loadDog('/chars/guests/out/dogs/dog_a.glb');  const d = createDog(tpl);
//   d.setAnim('walk', { speed: 1.3 });  d.setAnim('die', { loop: false });  d.update(dt);  d.autoLOD(pxPerMetre);
//   clips: idle walk sniff_walk trot run sniff bark attack die dead sit   (meta: loop, duration, groundSpeed, events)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export async function loadDog(url) {
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  let meta = {};
  try { meta = await (await fetch(url.replace(/\.glb$/, '.sidecar.json'))).json(); } catch (e) { /* optional */ }
  const tpl = { gltf: g, clips: new Map(g.animations.map(c => [c.name, c])), meta };
  tpl.groundSpeed = measureGroundSpeeds(tpl);
  return tpl;
}

/** Paw bones (the planted contacts of a gait). */
export const PAWS = ['hpaw_l', 'hpaw_r', 'fpaw_l', 'fpaw_r'];
/** Gait clips whose playback rate follows the dog's ground speed. */
export const DOG_GAITS = ['walk', 'sniff_walk', 'trot', 'run'];
/** Gaits picked by ground speed for a walk / run order. */
const GAIT_FAMILY = ['walk', 'trot', 'run'];

/**
 * Real ground speed (m/s at timeScale 1) of each gait clip, measured on the built dog: the planted (lowest) paw's
 * backward speed under the body, median over the cycle. The sidecar's groundSpeed was authored at another scale
 * (walk 0.89 against a real 0.53 m/s, run 5.84 against ~2.7): timed with it, every paw slid along the ground at
 * 40–60 % of the dog's speed (M3 video follow-up: "all soldiers should walk/run in all configurations").
 * @returns {Object<string, number>} clip name → m/s (absent when it cannot be measured)
 */
export function measureGroundSpeeds(tpl) {
  const out = {};
  const object = SkeletonUtils.clone(tpl.gltf.scene);
  const bones = {}; object.traverse(o => { if (o.isBone) bones[o.name] = o; });
  const paws = PAWS.map(n => bones[n]);
  if (paws.some(b => !b)) return out;
  const mixer = new THREE.AnimationMixer(object);
  const p = new THREE.Vector3();
  for (const name of DOG_GAITS) {
    const clip = tpl.clips.get(name); if (!clip || !(clip.duration > 0)) continue;
    const a = mixer.clipAction(clip); a.reset().play();
    const N = 48, dt = clip.duration / N, v = [];
    let prev = null;
    for (let i = 0; i <= N + 1; i++) {
      mixer.setTime(i * dt); object.updateMatrixWorld(true);
      const now = paws.map(b => b.getWorldPosition(p).clone());
      if (prev) { let k = 0; for (let j = 1; j < now.length; j++) if (now[j].y < now[k].y) k = j; v.push(Math.hypot(now[k].x - prev[k].x, now[k].z - prev[k].z) / dt); }
      prev = now;
    }
    a.stop(); mixer.uncacheAction(clip);
    v.sort((x, y) => x - y);
    const med = v[Math.floor(v.length / 2)];
    if (med > 0.05) out[name] = med;
  }
  mixer.uncacheRoot(object);
  return out;
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
    if (speed && GAIT_FAMILY.includes(name)) name = gaitFor(name, speed);
    const clip = tpl.clips.get(name); if (!clip) return false;
    const m = cm[name] || {};
    const a = mixer.clipAction(clip);
    const lp = loop ?? (m.loop !== false);
    a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !lp;
    const gs = (tpl.groundSpeed && tpl.groundSpeed[name]) || m.groundSpeed;   // measured on the body (loadDog)
    a.timeScale = timeScale ?? (speed && gs ? speed / gs : 1);
    if (name !== curName) { a.reset().play(); if (cur && fade > 0) cur.crossFadeTo(a, fade, false); else if (cur) cur.stop(); }
    cur = a; curName = name; return true;
  };
  // walk / trot / run by ground speed: the clip played nearest its own pace (a patrol dog at 0.9 m/s trots slowly
  // rather than pedalling the 0.53 m/s walk at 1.7×); the current one is kept while within ±40 % of its pace
  const gsOf = (n) => (tpl.groundSpeed && tpl.groundSpeed[n]) || (cm[n] && cm[n].groundSpeed) || 0;
  const gaitFor = (want, speed) => {
    if (GAIT_FAMILY.includes(curName) && gsOf(curName) && Math.abs(Math.log(speed / gsOf(curName))) < Math.log(1.4)) return curName;
    let best = want, bd = Infinity;
    for (const n of GAIT_FAMILY) { const g = gsOf(n); if (!g || !tpl.clips.has(n)) continue; const d = Math.abs(Math.log(speed / g)); if (d < bd) { bd = d; best = n; } }
    return best;
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
