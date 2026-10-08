// Copied from scratchpad chars/guests/pipeline/web/dogkit.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// dogkit.js - runtime for the Alsatian guard dog GLB (guests build group). Same interface family as charkit's humanoid:
//   const tpl = await loadDog('/chars/guests/out/dogs/dog_a.glb');  const d = createDog(tpl);
//   d.setAnim('walk', { speed: 1.3 });  d.setAnim('die', { loop: false });  d.update(dt);  d.autoLOD(pxPerMetre);
//   clips: idle walk sniff_walk trot run sniff bark attack die dead sit   (meta: loop, duration, groundSpeed, events)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { keepEncodedImages } from '../../../engine/texture-memory.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export async function loadDog(url) {
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(keepEncodedImages).loadAsync(url);
  let meta = {};
  try { meta = await (await fetch(url.replace(/\.glb$/, '.sidecar.json'))).json(); } catch (e) { /* optional */ }
  const tpl = { gltf: g, clips: new Map(g.animations.map(c => [c.name, c])), meta };
  tpl.groundSpeed = measureGroundSpeeds(tpl);
  tpl.pawContacts = measurePawContacts(tpl);
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

/** Paw bone → its print: fore / hind, side (+1 right, −1 left: the trail stamp's mirror convention). */
export const PAW_INFO = { hpaw_l: { fore: false, side: -1 }, hpaw_r: { fore: false, side: 1 }, fpaw_l: { fore: true, side: -1 }, fpaw_r: { fore: true, side: 1 } };

/**
 * When and where each paw meets the ground in every gait clip (user: "Dog is leaving human footprints"), measured on
 * the built dog like the ground speeds. The sole — the pads: the lowest 1.5 cm of the skin weighted to the paw in the
 * rest pose, as a point on the paw bone — is tracked in the dog's own frame over the cycle. A paw is planted while it
 * moves back under the body at ≥ 60 % of the clip's ground speed (a swinging paw moves forward, however low it skims
 * the ground); each planted run of the cycle is one footfall: its touchdown (clip time: the first moment of the run
 * the sole is within 1.2 cm of its lowest, i.e. the pads are down) and the print centre — the sole carried back to the
 * touchdown instant (z + groundSpeed · (t − t0): a planted paw stays put while the body passes over it), median over
 * the stance. The print size is the paw's skin footprint (lowest 3 cm), per paw.
 * @returns {{paws: {name:string, fore:boolean, side:number, w:number, l:number, sole:number[]}[],
 *   clips: Object<string, {dur:number, gs:number, steps: {paw:number, t:number, x:number, z:number, st:number}[]}>}|null}
 */
export function measurePawContacts(tpl) {
  const object = SkeletonUtils.clone(tpl.gltf.scene);
  const bones = {}; object.traverse(o => { if (o.isBone) bones[o.name] = o; });
  let mesh = null; object.traverse(o => { if (o.isSkinnedMesh && (!mesh || o.name === 'LOD0')) mesh = o; });
  if (!mesh || PAWS.some(n => !bones[n])) return null;
  object.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight, v = new THREE.Vector3();
  const bi = PAWS.map(n => mesh.skeleton.bones.indexOf(bones[n])), pts = PAWS.map(() => []);
  for (let i = 0; i < si.count; i++) {
    for (let k = 0; k < 4; k++) {
      let w = 0; for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === bi[k]) w += sw.getComponent(i, j);
      if (w > 0.5) { mesh.getVertexPosition(i, v); pts[k].push(v.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(inv)); break; }
    }
  }
  if (pts.some(p => !p.length)) return null;
  const toBone = new THREE.Matrix4(), span = (a, f) => Math.max(...a.map(f)) - Math.min(...a.map(f));
  const sole = [], paws = [];
  PAWS.forEach((n, k) => {
    const y0 = Math.min(...pts[k].map(p => p.y)), pads = pts[k].filter(p => p.y < y0 + 0.015), foot = pts[k].filter(p => p.y < y0 + 0.03);
    const c = pads.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pads.length); c.y = y0;
    toBone.copy(bones[n].matrixWorld).invert().multiply(object.matrixWorld);
    sole.push(c.applyMatrix4(toBone));
    paws.push({ name: n, ...PAW_INFO[n], w: span(foot, p => p.x), l: span(foot, p => p.z), sole: sole[k].toArray() });
  });
  const mixer = new THREE.AnimationMixer(object), clips = {}, N = 96, med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  for (const name of DOG_GAITS) {
    const clip = tpl.clips.get(name), gs = tpl.groundSpeed && tpl.groundSpeed[name];
    if (!clip || !(clip.duration > 0) || !(gs > 0)) continue;
    const a = mixer.clipAction(clip); a.reset().play();
    const dt = clip.duration / N, S = PAWS.map(() => []);
    for (let i = 0; i < N; i++) {
      mixer.setTime(i * dt); object.updateMatrixWorld(true);
      PAWS.forEach((n, k) => S[k].push(sole[k].clone().applyMatrix4(bones[n].matrixWorld).applyMatrix4(inv)));
    }
    a.stop(); mixer.uncacheAction(clip);
    const steps = [];
    S.forEach((s, k) => {
      const down = s.map((q, i) => (s[(i + 1) % N].z - q.z) / dt < -0.6 * gs);
      for (let i = 0; i < N; i++) {
        if (!down[i] || down[(i + N - 1) % N]) continue;   // i: the first planted sample of a run
        let len = 0; while (len < N && down[(i + len) % N]) len++;
        if (len < 3 || len >= N) continue;                  // a flick, or never lifted
        const xs = [], zs = [];
        let y0 = Infinity, td = 0;
        for (let m = 0; m < len; m++) { const q = s[(i + m) % N]; xs.push(q.x); zs.push(q.z + gs * m * dt); y0 = Math.min(y0, q.y); }
        while (td < len - 1 && s[(i + td) % N].y > y0 + 0.012) td++;   // the paw still coming down: it touches here
        steps.push({ paw: k, t: ((i + td) % N) * dt, x: med(xs), z: med(zs) - gs * td * dt, st: (len - td) * dt });
      }
    });
    steps.sort((p, q) => p.t - q.t);
    if (steps.length) clips[name] = { dur: clip.duration, gs, steps };
  }
  mixer.uncacheRoot(object);
  return { paws, clips };
}

export function createDog(tpl) {
  const object = SkeletonUtils.clone(tpl.gltf.scene);
  const parts = {};
  object.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; parts[o.name] = o; }
  });
  const mixer = new THREE.AnimationMixer(object);
  const cm = (tpl.meta && tpl.meta.clips) || {};
  let cur = null, curName = null, prev = null, prevName = null;
  const setAnim = (name, { loop, speed, timeScale, fade = 0.2 } = {}) => {
    if (speed && GAIT_FAMILY.includes(name)) name = gaitFor(name, speed);
    const clip = tpl.clips.get(name); if (!clip) return false;
    const m = cm[name] || {};
    const a = mixer.clipAction(clip);
    const lp = loop ?? (m.loop !== false);
    a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !lp;
    const gs = (tpl.groundSpeed && tpl.groundSpeed[name]) || m.groundSpeed;   // measured on the body (loadDog)
    a.timeScale = timeScale ?? (speed && gs ? speed / gs : 1);
    if (name !== curName) {
      a.reset().play();
      if (cur && fade > 0) { cur.crossFadeTo(a, fade, false); prev = cur; prevName = curName; } else { if (cur) cur.stop(); prev = null; }
    }
    cur = a; curName = name; return true;
  };
  // footfalls (measurePawContacts): the touchdowns the playing gait crossed this step, from whichever clip shows (the
  // one at ≥ half weight during a cross-fade), each print where the paw stands now in the dog's frame
  const pc = tpl.pawContacts || null, falls = [];
  const footfalls = (a, name, t0, dt) => {
    const C = pc && pc.clips[name];
    if (!C || !a || !a.isRunning() || a.getEffectiveWeight() < 0.5) return;
    const adv = Math.min(C.dur, dt * a.getEffectiveTimeScale());
    if (!(adv > 0)) return;
    for (const s of C.steps) {
      let d = (s.t - t0) % C.dur; if (d <= 0) d += C.dur;   // clip time from t0 on to this touchdown, (0, dur]
      if (d > adv) continue;
      const P = pc.paws[s.paw];
      falls.push({ paw: P.name, fore: P.fore, side: P.side, w: P.w, l: P.l, gait: name, x: s.x, z: s.z - C.gs * (adv - d) });
    }
    if (falls.length > 64) falls.splice(0, falls.length - 64);
  };
  const update = (dt) => {
    const a = cur, n = curName, t0 = a ? a.time : 0, b = prev, bn = prevName, t1 = b ? b.time : 0;
    mixer.update(dt);
    if (!(dt > 0)) return;
    if (a === cur) footfalls(a, n, t0, dt);
    if (b && b !== cur) footfalls(b, bn, t1, dt);
    if (b && !b.isRunning()) prev = null;
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
    object, parts, mixer, setAnim, update,
    /** The footfalls since the last call ({paw, fore, side, w, l, gait, x, z}: print centre in the dog's frame now). */
    takeFootfalls: () => falls.splice(0),
    /** True when the gait clips' paw contacts were measured (takeFootfalls reports every print). */
    footfallsMeasured: !!(pc && Object.keys(pc.clips).length),
    /** The measured contacts (measurePawContacts; read-only). */
    pawContacts: pc,
    autoLOD: (ppm) => lod(ppm >= 60 ? 'LOD0' : ppm >= 28 ? 'LOD1' : 'LOD2'),
    setColors: ({ tint } = {}) => { if (tint) for (const n in parts) { parts[n].material = parts[n].material.clone(); parts[n].material.color.setRGB(...tint); } },
    get anim() { return curName; },
  };
}
