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
 * `flag:false` (no garrison) → bare pole, unless `stripPole` hides the pole primitive too.
 * `flagShift: [dx, dz]` (world metres) instead moves the whole wired pole assembly — and the spec
 * cloth with it — to stand at the offset anchor: triangles translated, none dropped.
 * Returns the added flag groups.
 * @param {THREE.Object3D} root the createBuilding() group (sidecar-local coords)
 * @param {string} asset asset name
 */
export function dressFlags(root, asset, o = {}) {
  const a = buildingMeta(asset);
  if (!a) return [];
  const hide = (n) => { n.traverse((c) => { if (c.isMesh) c.visible = false; }); n.userData.flagHidden = true; };
  const flagAnchors = a.anchors.filter((an) => an.name === 'flag');
  // `flagShift` (mission opt-in): a world XZ offset (m) that moves the whole kit flag-pole assembly —
  // pole, wires, footing — as one unit, with the spec cloth flying from the shifted anchor (m06's chapel
  // pole stood on the main line). Given in world metres; converted to the root-local frame here.
  const localShift = () => {
    if (!o.flagShift) return null;
    root.updateMatrixWorld(true);
    const lin = new THREE.Matrix4().copy(root.matrixWorld).invert().setPosition(0, 0, 0);
    const v = new THREE.Vector3(o.flagShift[0], 0, o.flagShift[1]).applyMatrix4(lin);
    return [v.x, v.z];
  };
  // One triangle of a merged chunk (root-local vertex offsets ia/ib/ic into `local`): part of the
  // flag-pole assembly? Tight, ground-anchored rules only (broad shape tests ate the door canopy):
  // pole cylinder, footing, wire segments touching the pole, yardarm band, and the wires' flat ground
  // shadow-ribbons + anchor pegs (all within 1.6 m of the axis). The guy wires' bottom tails escape
  // those: too far from the axis to touch it, hovering at cy ~1.0 (above the flat-ribbon band) — caught
  // by the thin/low/near tail rule instead. Shared by the strip and shift surgeries below.
  const poleTri = (local, ia, ib, ic, near) => {
    let cx = 0, cy = 0, cz = 0;
    for (const ii of [ia, ib, ic]) { cx += local[ii]; cy += local[ii + 1]; cz += local[ii + 2]; }
    cx /= 3; cy /= 3; cz /= 3;
    const ux = local[ib] - local[ia], uy = local[ib + 1] - local[ia + 1], uz = local[ib + 2] - local[ia + 2];
    const vx = local[ic] - local[ia], vy = local[ic + 1] - local[ia + 1], vz = local[ic + 2] - local[ia + 2];
    const e1 = Math.hypot(ux, uy, uz);
    const e2 = Math.hypot(local[ic] - local[ib], local[ic + 1] - local[ib + 1], local[ic + 2] - local[ib + 2]);
    const e3 = Math.hypot(vx, vy, vz);
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const maxE = Math.max(e1, e2, e3);
    return near.some((an) => { const dc = Math.hypot(cx - an.pos[0], cz - an.pos[2]); let dmin = 1e9; for (const ii of [ia, ib, ic]) dmin = Math.min(dmin, Math.hypot(local[ii] - an.pos[0], local[ii + 2] - an.pos[2])); return (dc < 0.35 && cy < an.pos[1] + 0.6) || (dc < 0.7 && cy < 1.0) || (dmin < 0.35 && dc < 2.6 && cy < an.pos[1] + 0.6) || (Math.abs(cy - an.pos[1]) < 0.35 && dc < 1.1) || (cy < 0.5 && dc < 2.8 && area / (maxE * maxE) < 0.28) || (dc < 2.8 && cy < 1.6 && area / (maxE * maxE) < 0.05) || (cy < 0.65 && dc < 2.3 && maxE < 0.5 && area < 0.02); });
  };
  // Visit every mesh with its mesh→root-local matrix `m`, the flag anchors within 2.8 m of its bounds
  // (`near`), and whether the whole mesh is the pole itself: a thin tall ground-based mesh on the
  // anchor axis (the coarsest LOD models the pole as its own primitive; finer LODs merge it).
  const scanAssembly = (fn) => {
    if (!flagAnchors.length) return;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const m = new THREE.Matrix4(); const bb = new THREE.Box3();
    root.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      if (!n.geometry.boundingBox) return;
      m.multiplyMatrices(inv, n.matrixWorld);
      bb.copy(n.geometry.boundingBox).applyMatrix4(m);
      const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const wholePole = sx <= 0.45 && sz <= 0.45 && sy >= 3 && bb.min.y <= 1.2 && flagAnchors.some((an) => Math.hypot(cx - an.pos[0], cz - an.pos[2]) < 3.0);
      const near = flagAnchors.filter((an) => bb.min.x < an.pos[0] + 2.8 && bb.max.x > an.pos[0] - 2.8 && bb.min.z < an.pos[2] + 2.8 && bb.max.z > an.pos[2] - 2.8);
      fn(n, { m, wholePole, near });
    });
  };
  // Root-local vertex positions of geometry `g` under mesh matrix `m`.
  const localVerts = (g, m) => {
    const gp = g.attributes.position;
    const v = new THREE.Vector3(); const local = new Float32Array(gp.count * 3);
    for (let i = 0; i < gp.count; i++) { v.fromBufferAttribute(gp, i).applyMatrix4(m); local[i * 3] = v.x; local[i * 3 + 1] = v.y; local[i * 3 + 2] = v.z; }
    return local;
  };
  // `stripPole` (mission opt-in, e.g. a garrison whose kit pole would stand on a track): with `flag:false`
  // the kit normally keeps a bare pole — hide that pole primitive too (thin tall mesh on the flag anchor axis).
  const stripPoles = () => {
    scanAssembly((n, { m, wholePole, near }) => {
      if (n.userData.flagPoleHidden) return;
      // a whole thin tall ground-based mesh on the anchor axis is the pole itself: hide it
      if (wholePole) { n.visible = false; n.userData.flagPoleHidden = true; return; }
      // coarser LODs merge the pole into a bigger chunk: drop just the pole's triangles
      // (a vertical cylinder on the anchor axis, plus the yardarm band at cloth height)
      if (n.userData.flagPoleStripped || Array.isArray(n.material)) return;
      if (!near.length) return;
      if (!n.geometry.attributes?.position) return;
      const g = n.geometry.clone();
      const gp = g.attributes.position;
      const local = localVerts(g, m);
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: gp.count }, (_, i) => i);
      const kept = [];
      for (let f = 0; f + 2 < idx.length; f += 3) if (!poleTri(local, idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3, near)) kept.push(idx[f], idx[f + 1], idx[f + 2]);
      if (kept.length === idx.length) return;
      g.setIndex(kept); g.clearGroups();
      n.geometry = g; n.userData.flagPoleStripped = true;
    });
  };
  // `flagShift`: translate the whole wired assembly by the root-local offset instead of cutting it
  // out. Merged chunks are de-indexed first so the assembly's vertices tear free of the geometry that
  // stays behind; no triangle is dropped — the census count is unchanged, the assembly stands moved.
  // Two escape classes are closed here (either could strand the guy-wires at the old site):
  //  - multi-material chunks: a mesh whose material is an array carries its assembly triangles in a
  //    material group; de-indexing maps group ranges 1:1 (indices → vertices, same order), so the
  //    groups are kept and the triangles classify like any other. (Skipping such meshes wholesale —
  //    as this used to — leaves the whole wired assembly behind.)
  //  - torn wire components: the per-triangle rules can catch only part of one wire (a segment whose
  //    own centroid/edges miss every test). A connected component that contains a classified
  //    triangle and lies entirely within 2.6 m of the anchor axis is assembly by construction —
  //    the building shell and the front walkway all reach past that radius — so it moves whole.
  const shiftPoles = (off) => {
    scanAssembly((n, { m, wholePole, near }) => {
      if (n.userData.flagPoleShifted) return;
      if (!wholePole && !near.length) return;
      if (!n.geometry.attributes?.position) return;
      // clone before touching vertices: the LOD clones share the cached GLB buffers
      const g = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.attributes.position.array), 3));
      if (!Array.isArray(n.material)) g.clearGroups(); // single material: groups meaningless; multi-material groups carry over 1:1
      const gp = g.attributes.position;
      const local = localVerts(g, m);
      const triCount = Math.floor(gp.count / 3);
      const move = new Uint8Array(triCount);
      for (let f = 0; f < triCount; f++) if (wholePole || poleTri(local, f * 9, f * 9 + 3, f * 9 + 6, near)) move[f] = 1;
      if (!wholePole) {
        // connected-component completion (see header): group triangles sharing a vertex,
        // then move every component that a classified triangle seeds and that fits inside
        // the assembly radius — a wire can no longer be left half behind, segment by segment.
        const byVert = new Map();
        for (let f = 0; f < triCount; f++) for (let k = 0; k < 3; k++) {
          const i3 = (f * 3 + k) * 3;
          const key = Math.round(local[i3] * 5000) + ',' + Math.round(local[i3 + 1] * 5000) + ',' + Math.round(local[i3 + 2] * 5000);
          const l = byVert.get(key); if (l) l.push(f); else byVert.set(key, [f]);
        }
        const seen = new Uint8Array(triCount);
        for (let f0 = 0; f0 < triCount; f0++) {
          if (seen[f0]) continue;
          const comp = []; const stack = [f0]; seen[f0] = 1;
          while (stack.length) {
            const f = stack.pop(); comp.push(f);
            for (let k = 0; k < 3; k++) {
              const i3 = (f * 3 + k) * 3;
              const key = Math.round(local[i3] * 5000) + ',' + Math.round(local[i3 + 1] * 5000) + ',' + Math.round(local[i3 + 2] * 5000);
              for (const q of byVert.get(key) || []) if (!seen[q]) { seen[q] = 1; stack.push(q); }
            }
          }
          if (!comp.some((f) => move[f])) continue;
          let inside = true;
          for (const f of comp) for (let k = 0; k < 3 && inside; k++) {
            const i3 = (f * 3 + k) * 3;
            let d = 1e9; for (const an of near) d = Math.min(d, Math.hypot(local[i3] - an.pos[0], local[i3 + 2] - an.pos[2]));
            if (d > 2.6) inside = false;
          }
          if (inside) for (const f of comp) move[f] = 1;
        }
      }
      const minv = new THREE.Matrix4().copy(m).invert();
      const v = new THREE.Vector3();
      let moved = 0;
      for (let f = 0; f < triCount; f++) {
        if (!move[f]) continue;
        for (let k = 0; k < 3; k++) {
          const i3 = (f * 3 + k) * 3;
          v.set(local[i3] + off[0], local[i3 + 1], local[i3 + 2] + off[1]).applyMatrix4(minv);
          gp.setXYZ(f * 3 + k, v.x, v.y, v.z);
        }
        moved++;
      }
      if (!moved) return;
      gp.needsUpdate = true;
      g.computeBoundingBox(); g.computeBoundingSphere();
      n.geometry = g; n.userData.flagPoleShifted = true;
    });
  };
  const shift = localShift();
  const sweep = () => { root.traverse((n) => { if (BAKED_FLAG.test(n.name) && n.parent?.name !== 'flag_spec' && !n.userData.flagHidden) hide(n); }); if (o.stripPole && !o.flag) stripPoles(); else if (shift) shiftPoles(shift); };
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
    f.position.set(an.pos[0] + (shift?.[0] ?? 0), an.pos[1], an.pos[2] + (shift?.[1] ?? 0));
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
