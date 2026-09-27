/**
 * Enemy flags (design-spec §2.4 / §10.6): a field-grey banner with a black-and-white Balkenkreuz — never the
 * red-field/white-disc layout. The cloth is a subdivided plane pinned along its hoist edge ("cloth-ready": the
 * vertex shader waves it from shared wind uniforms today; step 4w's WindField / cloth solver can drive the same
 * mesh through `userData.cloth`). Barracks flags mark reinforcement buildings, so they must read at 0.5× zoom.
 * @module art/flags
 */

import * as THREE from 'three';
import { buildingMeta } from './building-library.js';
import { VerletCloth, CLOTHS, registerCloth } from './cloth.js';
import { WindField, resolveWind } from '../world/wind.js';

export { registerCloth };
const SEG = [16, 8];
 // simulation grid (17 × 9 particles): ≈0.08 ms per flag per 1/60 s step

/** Shared animation uniforms (one per page): time, wind strength 0..1, wind heading (rad, world). */
export const FLAG_UNIFORMS = { uFlagTime: { value: 0 }, uFlagWind: { value: 0.55 }, uFlagWindDir: { value: 0.6 } };

const C = { tex: null, mat: null, poleMat: null };

/** Field-grey banner + Balkenkreuz (canvas, 512×344). */
export function flagTexture() {
  if (C.tex || typeof document === 'undefined') return C.tex;
  const W = 512, H = 344, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#5e6456'; // Feldgrau
  g.fillRect(0, 0, W, H);
  // woven wool: fine thread noise + slow dye mottling
  const img = g.getImageData(0, 0, W, H), px = img.data;
  let s = 1234567;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4, n = (rnd() - 0.5) * 14 + ((x + y) & 1 ? 3 : -3) + Math.sin(x * 0.021 + y * 0.013) * 6;
    px[k] += n; px[k + 1] += n; px[k + 2] += n * 0.9;
  }
  g.putImageData(img, 0, 0);
  // Balkenkreuz: straight black arms with white outer edges, centred
  const cx = W / 2, cy = H / 2, L = H * 0.36, A = H * 0.075, E = H * 0.035;
  const cross = (half, arm, col) => {
    g.fillStyle = col;
    g.fillRect(cx - half, cy - arm, half * 2, arm * 2);
    g.fillRect(cx - arm, cy - half, arm * 2, half * 2);
  };
  cross(L + E, A + E, '#e9e6dc');
  cross(L, A, '#121212');
  // hem + hoist sleeve, grime towards the fly end
  g.strokeStyle = 'rgba(30,32,26,0.55)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  g.fillStyle = 'rgba(210,205,190,0.55)'; g.fillRect(0, 0, 14, H);
  const grd = g.createLinearGradient(W * 0.6, 0, W, 0);
  grd.addColorStop(0, 'rgba(40,36,28,0)'); grd.addColorStop(1, 'rgba(40,36,28,0.28)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  C.tex = t;
  return t;
}

/** Waving cloth material: displaces the pinned plane (uv.x = 0 at the hoist) with travelling waves. */
export function flagMaterial() {
  if (C.mat) return C.mat;
  const m = new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.name = 'flag_cloth';
  m.userData.shared = true;
  m.userData.snowCover = true; // no top-face snow on a flying flag (art/terrain.js coverPropsWithSnow skips it)
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FLAG_UNIFORMS);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlagTime; uniform float uFlagWind;\nvec3 flagWave(vec3 p, vec2 q){ float u=q.x; float a=(0.06+0.22*uFlagWind)*u; float ph=u*7.0-uFlagTime*(3.0+4.0*uFlagWind)+q.y*1.3; float w=sin(ph)*a+sin(ph*2.13+1.7)*a*0.35; p.z+=w; p.x-=abs(w)*0.25; p.y-=(1.0-uFlagWind)*u*u*0.55; return p; }')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ float u=uv.x; float a=(0.06+0.22*uFlagWind)*u; float ph=u*7.0-uFlagTime*(3.0+4.0*uFlagWind)+uv.y*1.3; float dz=cos(ph)*7.0*a+cos(ph*2.13+1.7)*14.9*a*0.35; objectNormal=normalize(vec3(-dz*0.55,0.0,1.0)); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed=flagWave(transformed,uv);');
  };
  m.customProgramCacheKey = () => 'flag_cloth_v1';
  C.mat = m;
  return m;
}

/** Cloth-simulated flag material: the geometry itself moves (correct shadows), no vertex waves. */
export function flagClothMaterial() {
  if (C.clothMat) return C.clothMat;
  const m = new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  m.name = 'flag_cloth';
  m.userData.shared = true;
  m.userData.snowCover = true;
  C.clothMat = m;
  return m;
}

function poleMaterial() {
  return (C.poleMat ??= new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.55, metalness: 0.6 }));
}

/**
 * A flag (hoist edge at x = 0, top at y = 0, flying towards +x), optionally on its own pole.
 * @param {{w?: number, h?: number, pole?: boolean, poleH?: number}} [o] pole → the group origin is the pole foot
 * @returns {THREE.Group}
 */
export function makeFlag(o = {}) {
  const w = o.w ?? 1.8, hgt = o.h && !o.pole ? o.h : (o.flagH ?? w * 0.66);
  const g = new THREE.Group();
  g.name = 'flag';
  const sim = o.cloth !== false;
  const seg = sim ? SEG : [24, 12];
  const geo = new THREE.PlaneGeometry(w, hgt, seg[0], seg[1]);
  geo.translate(w / 2, -hgt / 2, 0);
  const cloth = new THREE.Mesh(geo, sim ? flagClothMaterial() : flagMaterial());
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
 * Replace every baked flag of a library building (red-field layout in the kit) with the spec banner.
 * `flag:false` (no garrison) → bare pole. Returns the added flag groups.
 * @param {THREE.Object3D} root the createBuilding() group (sidecar-local coords)
 * @param {string} asset asset name
 */
export function dressFlags(root, asset, o = {}) {
  const a = buildingMeta(asset);
  if (!a) return [];
  const hide = (n) => { n.traverse((c) => { if (c.isMesh) c.visible = false; }); n.userData.flagHidden = true; };
  const sweep = () => root.traverse((n) => { if (/^flag(\.?\d+)?$/.test(n.name) && n.parent?.name !== 'flag_spec' && !n.userData.flagHidden) hide(n); });
  sweep();
  // LODs attach asynchronously: sweep again whenever one lands
  root.userData.onLodAttached = sweep;
  const out = [];
  if (!o.flag) return out;
  for (const an of a.anchors) {
    if (an.name !== 'flag') continue;
    const f = makeFlag({ w: an.width ?? 1.6, h: an.height ?? 1.07 });
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
