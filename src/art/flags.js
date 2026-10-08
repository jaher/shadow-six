/**
 * Enemy flags (design-spec §2.4 / §10.6). Insignia per Options → GAME PREFERENCES → INSIGNIA (art/insignia.js):
 * HISTORICAL (default, user decision 2026-09-30) = the German national flag 1935–45 (red field, white disc offset
 * toward the hoist, black swastika at 45°, 3:5); NEUTRAL = the field-grey banner with a Balkenkreuz. Textures:
 * art/flag-textures.js (wool weave, seams, fray, theater weathering). The cloth is a subdivided plane pinned along
 * its hoist edge, driven by the Verlet solver from the mission WindField (or shader waves for `cloth:false`).
 * Barracks flags mark reinforcement buildings, so they must read at 0.5× zoom.
 * @module art/flags
 */

import * as THREE from 'three';
import { buildingMeta, BAKED_FLAG } from './building-library.js';
import { dressingMaterial } from './dressing.js';
import { VerletCloth, CLOTHS, registerCloth } from './cloth.js';
import { WindField, resolveWind } from '../world/wind.js';
import { FLAG_W, FLAG_H, DISC, paintFlag } from './flag-textures.js';
import { getInsignia, onInsignia } from './insignia.js';

export { registerCloth };
const SEG = [16, 8];
 // simulation grid (17 × 9 particles): ≈0.08 ms per flag per 1/60 s step
/** Flag height / length: 3:5 (the 1935 national flag). */
export const FLAG_ASPECT = 0.6;

/** Shared animation uniforms (one per page): time, wind strength 0..1, wind heading (rad, world). */
export const FLAG_UNIFORMS = { uFlagTime: { value: 0 }, uFlagWind: { value: 0.55 }, uFlagWindDir: { value: 0.6 } };
/** Fabric uniforms: back-face disc mirror (historical: the swastika reads the same from both sides, as on the
 * double-sided appliqué originals) — disc (u, v, ru, rv). */
const FABRIC_UNIFORMS = { uFlagMirror: { value: 1 }, uFlagDisc: { value: new THREE.Vector4(DISC.u, DISC.v, DISC.ru, DISC.rv) } };

const C = { tex: new Map(), mats: new Map(), poleMat: null };
const theaterKey = (t) => (t && typeof t === 'string' ? t : 'temperate');

/** Flag texture for the current insignia mode and a theater (canvas, 640×384; null outside the browser). */
export function flagTexture(theater, mode = getInsignia()) {
  if (typeof document === 'undefined') return null;
  const key = `${mode}:${theaterKey(theater)}`;
  if (C.tex.has(key)) return C.tex.get(key);
  const cv = document.createElement('canvas');
  cv.width = FLAG_W; cv.height = FLAG_H;
  paintFlag(cv.getContext('2d', { willReadFrequently: true }), { mode, theater: theaterKey(theater) });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = `flag_${key}`;
  C.tex.set(key, t);
  return t;
}

/** Wool fabric shading: back-face disc mirror + light translucency (sun through the bunting from behind). */
function fabric(sh) {
  Object.assign(sh.uniforms, FABRIC_UNIFORMS);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uFlagMirror; uniform vec4 uFlagDisc;')
    .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec2 fUv = vMapUv;
  if (uFlagMirror > 0.5 && !gl_FrontFacing) { vec2 dd = (fUv - uFlagDisc.xy) / uFlagDisc.zw; if (dot(dd, dd) < 1.0) fUv.x = 2.0 * uFlagDisc.x - fUv.x; }
  diffuseColor *= texture2D(map, fUv);
#endif`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  { float tr = max(0.0, -dot(normal, directionalLights[0].direction)); reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * tr * 0.28 * RECIPROCAL_PI; }
#endif`);
}

function clothMat(name, theater) {
  const m = new THREE.MeshStandardMaterial({ map: flagTexture(theater), roughness: 0.92, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.name = 'flag_cloth';
  m.userData.shared = true;
  m.userData.snowCover = true; // no top-face snow on a flying flag (art/terrain.js coverPropsWithSnow skips it)
  m.userData.flagTheater = theaterKey(theater);
  C.mats.set(name, m);
  return m;
}

/** Waving cloth material: displaces the pinned plane (uv.x = 0 at the hoist) with travelling waves. */
export function flagMaterial(theater) {
  const name = `wave:${theaterKey(theater)}`;
  if (C.mats.has(name)) return C.mats.get(name);
  const m = clothMat(name, theater);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FLAG_UNIFORMS);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlagTime; uniform float uFlagWind;\nvec3 flagWave(vec3 p, vec2 q){ float u=q.x; float a=(0.06+0.22*uFlagWind)*u; float ph=u*7.0-uFlagTime*(3.0+4.0*uFlagWind)+q.y*1.3; float w=sin(ph)*a+sin(ph*2.13+1.7)*a*0.35; p.z+=w; p.x-=abs(w)*0.25; p.y-=(1.0-uFlagWind)*u*u*0.55; return p; }')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ float u=uv.x; float a=(0.06+0.22*uFlagWind)*u; float ph=u*7.0-uFlagTime*(3.0+4.0*uFlagWind)+uv.y*1.3; float dz=cos(ph)*7.0*a+cos(ph*2.13+1.7)*14.9*a*0.35; objectNormal=normalize(vec3(-dz*0.55,0.0,1.0)); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed=flagWave(transformed,uv);');
    fabric(sh);
  };
  m.customProgramCacheKey = () => 'flag_cloth_v1';
  return m;
}

/** Cloth-simulated flag material: the geometry itself moves (correct shadows), no vertex waves. */
export function flagClothMaterial(theater) {
  const name = `sim:${theaterKey(theater)}`;
  if (C.mats.has(name)) return C.mats.get(name);
  const m = clothMat(name, theater);
  m.onBeforeCompile = fabric;
  m.customProgramCacheKey = () => 'flag_cloth_sim_v1';
  return m;
}

/** Options → INSIGNIA changed: repaint every live flag material (same meshes, new map). */
function applyInsignia(mode) {
  FABRIC_UNIFORMS.uFlagMirror.value = mode === 'neutral' ? 0 : 1;
  for (const m of C.mats.values()) {
    const t = flagTexture(m.userData.flagTheater, mode);
    if (t && m.map !== t) { m.map = t; m.needsUpdate = true; }
  }
}
FABRIC_UNIFORMS.uFlagMirror.value = getInsignia() === 'neutral' ? 0 : 1;
onInsignia(applyInsignia);

function poleMaterial() {
  // placeholder-art pass: the painted steel PBR set (art/dressing.js), tinted the old pole grey
  if (!C.poleMat) { C.poleMat = dressingMaterial('steel').clone(); C.poleMat.color.set(0x8a857a); C.poleMat.name = 'flag:pole'; }
  return C.poleMat;
}

/**
 * A flag (hoist edge at x = 0, top at y = 0, flying towards +x), optionally on its own pole.
 * @param {{w?: number, h?: number, pole?: boolean, poleH?: number, theater?: string, cloth?: boolean}} [o] pole → the
 *   group origin is the pole foot; theater picks the weathering (art/flag-textures.js)
 * @returns {THREE.Group}
 */
export function makeFlag(o = {}) {
  const w = o.w ?? 1.8, hgt = o.h && !o.pole ? o.h : (o.flagH ?? w * FLAG_ASPECT);
  const g = new THREE.Group();
  g.name = 'flag';
  const sim = o.cloth !== false;
  const seg = sim ? SEG : [24, 12];
  const geo = new THREE.PlaneGeometry(w, hgt, seg[0], seg[1]);
  geo.translate(w / 2, -hgt / 2, 0);
  const cloth = new THREE.Mesh(geo, sim ? flagClothMaterial(o.theater) : flagMaterial(o.theater));
  cloth.name = 'flag_cloth';
  cloth.castShadow = true;
  cloth.userData.cloth = { pinned: 'hoist', w, h: hgt, segments: seg };
  if (sim) {
    // Verlet cloth: the whole hoist edge is laced to the pole (sleeve); bounds cover every pose it can reach
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -hgt / 2, 0), Math.hypot(w, hgt) + 0.2);
    const vc = new VerletCloth(geo.attributes, { nx: seg[0] + 1, ny: seg[1] + 1, pinned: (i) => i === 0, density: 0.15 });
    registerCloth(cloth, vc);
    cloth.userData.cloth.sim = vc;
  }
  if (o.pole) {
    const ph = o.poleH ?? o.h ?? 6.5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, ph, 8), poleMaterial());
    pole.position.y = ph / 2; pole.castShadow = true;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), poleMaterial());
    ball.position.y = ph + 0.06;
    cloth.position.set(0.06, ph - 0.1, 0);
    g.add(pole, ball, cloth);
  } else g.add(cloth);
  return g;
}

/**
 * Replace every baked flag of a library building (the kit's own flag meshes) with the spec flag (current insignia).
 * `flag:false` (no garrison) → bare pole. Returns the added flag groups.
 * @param {THREE.Object3D} root the createBuilding() group (sidecar-local coords)
 * @param {string} asset asset name
 */
export function dressFlags(root, asset, o = {}) {
  const a = buildingMeta(asset);
  if (!a) return [];
  const hide = (n) => { n.traverse((c) => { if (c.isMesh) c.visible = false; }); n.userData.flagHidden = true; };
  const sweep = () => root.traverse((n) => { if (BAKED_FLAG.test(n.name) && n.parent?.name !== 'flag_spec' && !n.userData.flagHidden) hide(n); });
  sweep();
  // LODs attach asynchronously: sweep again whenever one lands
  root.userData.onLodAttached = sweep;
  const out = [];
  if (!o.flag) return out;
  for (const an of a.anchors) {
    if (an.name !== 'flag') continue;
    const fw = an.width ?? 1.6; // 3:5 cloth, never taller than the kit's flag anchor
    const f = makeFlag({ w: fw, h: Math.min(an.height ?? 1.07, fw * FLAG_ASPECT), theater: o.theater });
    f.name = 'flag_spec';
    f.position.set(an.pos[0], an.pos[1], an.pos[2]);
    f.rotation.y = -(an.heading ?? 0);
    root.add(f);
    out.push(f);
  }
  return out;
}

const _w = { x: 0, z: 0, speed: 0, gust: 0, turb: 0 }, _lw = [0, 0, 0], _lg = [0, 0, 0];
let _lastT = null, _lastWind = null, _defWind = null;
function inScene(o) { while (o.parent) o = o.parent; return !!o.isScene; }
/** World vector → the mesh's local frame (rotation + scale of matrixWorld). */
function toLocal(e, x, y, z, out) {
  for (let c = 0; c < 3; c++) {
    const ax = e[c * 4], ay = e[c * 4 + 1], az = e[c * 4 + 2], s2 = ax * ax + ay * ay + az * az || 1;
    out[c] = (x * ax + y * ay + z * az) / s2;
  }
  return out;
}

/**
 * Advance the flags. `wind` = the mission WindField (world/wind.js: cloth sim, sim-time driven → frozen while paused)
 * or a legacy {strength 0..1, dir rad} (shader waves only). `camera` (optional) skips off-screen cloths.
 * A gust hitting a flag emits 'wind:flag' {x, z, gust} on `wind.events` (halyard/rope clank, audio).
 */
export function tickFlags(dt, wind = null, camera = null) {
  FLAG_UNIFORMS.uFlagTime.value += dt;
  if (wind) {
    if (wind.strength != null) FLAG_UNIFORMS.uFlagWind.value = wind.strength;
    if (wind.dir != null) FLAG_UNIFORMS.uFlagWindDir.value = wind.dir;
  }
  if (!CLOTHS.length) return;
  if (!wind?.sample) { // no mission (menu diorama, viewers): a private temperate breeze on the frame clock
    _defWind ||= new WindField(resolveWind({ theater: 'temperate' }));
    _defWind.t += dt;
    wind = _defWind;
  }
  if (wind !== _lastWind) { // new mission: forget flags of the previous one (no longer in any scene)
    _lastWind = wind; _lastT = null;
    for (let i = CLOTHS.length - 1; i >= 0; i--) if (!inScene(CLOTHS[i].mesh)) CLOTHS.splice(i, 1);
  }
  const t = wind.t ?? 0;
  let step = _lastT == null ? 0 : t - _lastT;
  _lastT = t;
  if (step < 0) { step = 1 / 60; for (const c of CLOTHS) c.warm = false; } // time went backwards (save loaded)
  if (!step && !CLOTHS.some((c) => !c.warm)) return;
  let frustum = null;
  if (camera?.projectionMatrix) {
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum = _fr.setFromProjectionMatrix(_m);
  }
  for (let i = CLOTHS.length - 1; i >= 0; i--) {
    const c = CLOTHS[i], m = c.mesh;
    if (!inScene(m)) continue;
    if (!m.visible || (frustum && !frustum.intersectsSphere(_sp.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld)))) continue;
    if (!step && c.warm) continue;
    const e = m.matrixWorld.elements;
    wind.sample(e[12], e[14], t, _w);
    if (c.vel) { _w.x -= c.vel.x; _w.z -= c.vel.z; } // a cloth on a moving vehicle feels the apparent wind
    toLocal(e, _w.x, 0, _w.z, _lw);
    toLocal(e, 0, -9.81, 0, _lg);
    // first simulated frame (mission start, first time on screen, after a rewind): start pre-warmed, never flat
    c.cloth.advance(c.warm ? step : 99, _lw, _lg, Math.min(1, _w.gust));
    c.warm = true;
    // halyard clank: rising edge of a strong gust at this flag
    const g = _w.gust;
    if (m.name === 'flag_cloth' && g > 0.45 && c.gust <= 0.45 && t - c.clank > 2.5) { c.clank = t; wind.events?.emit?.('wind:flag', { x: e[12], z: e[14], gust: g }); }
    c.gust = g;
  }
}
const _m = new THREE.Matrix4(), _fr = new THREE.Frustum(), _sp = new THREE.Sphere();

/** Number of live simulated flags (tests / perf). */
export function clothFlagCount() { return CLOTHS.length; }
