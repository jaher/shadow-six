/**
 * Game-side vehicle visuals (vehicle integration): the realistic vehicle library (art/vehicle-library.js) behind the
 * entity model contract of entities/vehicle.js (`root, turret, dims, gun, update(dt, vehicle), setTurretHeading,
 * setGunLift, setDestroyed, dispose`) plus the hooks the rest of the game reads:
 *
 *   await prepareVehicleArt(missionDef, { assets, onProgress });  // Game.loadMission 'vehicles' stage (preload)
 *   const m = createLibraryVehicleModel(vehicle);                  // null → kit model (art/kit-vehicles.js) or placeholder
 *   m.trailContacts(out)      // world-space wheel / track contacts → terrain trails (art/terrain.js stampWorld)
 *   m.seatExit(seat)          // {side: -1 left | 1 right, along} door side of a seat (LHD: driver on the left)
 *   m.boarding(seat, 'enter'|'exit')   // opens + closes that seat's door / hatch
 *   m.muzzleWorld(weapon)     // world position of a gun muzzle (VFX muzzle flash)
 *   m.crewSeats()             // crew-figure anchors (art/vehicle-crew.js)
 *
 * Paint follows the mission theater (manifest byTheater: temperate grey, desert tan, snow winter) unless the spawn
 * sets `paint`. Wheels roll / steer from the ground speed and yaw rate, tracks scroll, turrets / guns follow the
 * entity's turret heading and gun lift. Destroyed → the burnt wreck (lazy-loaded when not preloaded) + an oriented
 * scorch decal. Exhaust puffs scale with the engine load; head / tail lights (blackout covers: dim slit lenses and
 * small ground pools, no real lights → no shader recompiles) are on at night while crewed / moving, or when the
 * vehicle's `lightsOn` flag is set. `?vehicles=0` keeps the placeholders. Only the browser loads GLBs.
 * @module art/vehicle-model
 */

import * as THREE from 'three';
import { loadVehicleLibrary, preloadVehicles, createVehicleVisual, vehicleLibraryReady, resolveVehicle, setVehicleZoom, setVehicleTextureQuality, liveVehicleVisuals } from './vehicle-library.js';
import { resolveLighting } from '../engine/lighting.js';
import { applyCanvasCover } from './cloth-wind.js';
import { createStrapCurtain } from './strap-curtain.js';
import { doorRig, boardFrac } from './door-hand.js';
import { addPennants } from './vehicle-pennants.js';
import { T, B } from '../world/grid.js';
import { KIT_VEHICLES } from './kit-vehicles.js';
import { BEACHED, REST, hullUndersideTris, sampleXZ, boatRest, groundOf, waterOf, terrainReady } from './boat-rest.js';

/**
 * Registry type → library type where the names differ; `null` = the library has no model (placeholder, logged).
 * Every other registry type (truck, kubelwagen, panzer4, train …) uses the library type of the same name.
 */
export const LIB_VEHICLE = Object.freeze({
  van: 'citroen15', atgunM20: null, atgun: null, cable_car: null, // van: M15's civilian grey van → the Citroën Traction (placeholder-art pass)
});
/** Library asset per registry type when the type's first asset is not the right one for a game vehicle. */
export const LIB_ASSET = Object.freeze({
  mgNest: 'mg34_tripod', // the sandbag ring is the mission's own structure (sandbags variant mg_ring)
});

/**
 * Mission spawn `variant` → library type. A variant that names a library type (e.g. `{vehicleType:'car', variant:'kubelwagen'}`,
 * M1's Kübelwagen) draws that type; these are the registry variant names that differ from the library's.
 */
export const LIB_VARIANT = Object.freeze({
  opel_canvas: 'truck', opel_cargo: 'truck', opel_tanker: 'opel_blitz_tanker', kubel: 'kubelwagen', citroen: 'citroen15',
  r75: 'motorcycle', sidecar: 'motorcycle', horch901: 'horch', willys_mb: 'willys',
});

/** Left-hand drive: the driver's door is on the vehicle's left. Only the R75's sidecar sits on the right. */
const DRIVER_SIDE = -1; // entity frame: side +1 = right (heading + π/2), -1 = left

const S = { ready: false, disabled: false, failed: false, theater: 'temperate', night: false, log: [], mission: null, live: new Set(), zoom: 0, tickers: new Set(), releasers: new Set(), pool: null };

/** False with `?vehicles=0` in the page URL. */
export function vehiclesEnabled() {
  try { return !/[?&]vehicles=0(&|$)/.test(globalThis.location?.search || ''); } catch { return true; }
}

/**
 * Library type of a game vehicle, or null (no model → placeholder).
 * @param {string} vehicleType the spawn's type (alias kept: armoredcar → 8-Rad, halftrack → 251)
 * @param {string} [canon] canonical registry type (entities/vehicle.js canonicalType)
 * @param {object} [manifest] vehicle manifest (defaults to the loaded one; node tests pass their own)
 * @param {string} [variant] the spawn's `variant` (registry look, e.g. 'kubelwagen' on a 'car'); wins when the library has it
 */
export function libraryTypeFor(vehicleType, canon = vehicleType, manifest = null, variant = null) {
  const types = manifest?.types;
  if (typeof variant === 'string' && variant) { // the spawn's variant picks the model when the library has it
    const vt = LIB_VARIANT[variant] ?? variant;
    if (types ? types[vt] : Object.prototype.hasOwnProperty.call(LIB_VARIANT, variant)) return vt;
  }
  for (const t of [vehicleType, canon]) {
    if (t == null) continue;
    if (Object.prototype.hasOwnProperty.call(LIB_VEHICLE, t)) return LIB_VEHICLE[t];
  }
  if (!types) return vehicleType ?? canon ?? null;
  return types[vehicleType] ? vehicleType : types[canon] ? canon : null;
}

/** Every vehicle type a mission spawns (vehicles[], scripted / extraction spawns: any object with `vehicleType`). */
export function missionVehicleTypes(def) {
  const out = new Set();
  const visit = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o) visit(x, depth + 1); return; }
    if (typeof o.vehicleType === 'string') out.add(o.vehicleType);
    for (const k in o) if (k !== 'vehicleType' && o[k] && typeof o[k] === 'object') visit(o[k], depth + 1);
  };
  visit(def, 0);
  for (const v of def?.vehicles || []) if (v && !v.vehicleType) out.add('truck');
  return [...out].sort();
}

/** Every [vehicleType, variant] pair a mission spawns (variant null when absent), for the variant-aware preload. */
export function missionVehicleSpawns(def) {
  const out = new Map();
  const visit = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o) visit(x, depth + 1); return; }
    if (typeof o.vehicleType === 'string') {
      const va = typeof o.variant === 'string' ? o.variant : null;
      out.set(`${o.vehicleType}|${va ?? ''}`, [o.vehicleType, va]);
    }
    for (const k in o) if (k !== 'vehicleType' && o[k] && typeof o[k] === 'object') visit(o[k], depth + 1);
  };
  visit(def, 0);
  for (const v of def?.vehicles || []) if (v && !v.vehicleType) out.set('truck|', ['truck', null]);
  return [...out.values()];
}

/** Current context (tests / debug): ready, theater, night, log of placeholder / fitting notes. */
export const vehicleArtContext = () => ({ ready: S.ready, disabled: S.disabled, failed: S.failed, theater: S.theater, night: S.night, log: [...S.log] });

/**
 * Per-mission setup: theater + night flag, the library manifest, then preload every vehicle type the mission uses
 * (theater paint + wreck, both LODs) and the static vehicles among its structures (see art/static-vehicles.js).
 * @param {object} def mission definition
 * @param {{assets?: object, enabled?: boolean, quality?: string, onProgress?: (done:number, total:number) => void,
 *   canon?: (t:string) => string, extra?: string[], ambient?: string[]}} [o] canon = registry alias resolver, extra = more
 *   library types, ambient = flyover aircraft (intact models only),
 *   quality 'low' = the 512 texture set
 * @returns {Promise<boolean>} true when the real models are available
 */
export async function prepareVehicleArt(def, o = {}) {
  S.theater = def?.theater || 'temperate';
  S.mission = def?.id ?? null;
  S.log = [];
  try { S.night = !!resolveLighting(S.theater, def?.lighting || null)?.night; } catch { S.night = S.theater === 'night'; }
  if (typeof fetch !== 'function' || typeof document === 'undefined') return (S.ready = false);
  S.disabled = o.enabled === false || !vehiclesEnabled();
  if (S.disabled) return (S.ready = false);
  try {
    setVehicleTextureQuality(o.quality);
    const lib = await loadVehicleLibrary(o.assets || null);
    const want = new Set(o.extra || []);
    for (const [t, variant] of missionVehicleSpawns(def)) {
      const lt = libraryTypeFor(t, o.canon ? o.canon(t) : t, lib.manifest, variant);
      if (lt) want.add(LIB_ASSET[lt] || lt);
      else S.log.push(KIT_VEHICLES[t] ? `${t}: kit model (art/kit-vehicles.js)` : `${t}: no library model (placeholder)`);
    }
    const amb = (o.ambient || []).filter((t) => !want.has(t)); // flyover aircraft: intact only, no wrecks
    let n0 = 0;
    await Promise.all([
      preloadVehicles([...want], { theater: S.theater, onProgress: (d, n) => { n0 = n; o.onProgress?.(d, n + amb.length); } }),
      amb.length ? preloadVehicles(amb, { theater: S.theater, destroyed: false }) : null,
    ]);
    if (amb.length) o.onProgress?.(n0 + amb.length, n0 + amb.length);
    if (S.log.length) console.info(`[vehicles] ${def?.id}: ${S.log.join('; ')}`);
    S.failed = false;
    return (S.ready = true);
  } catch (e) {
    console.warn('[vehicles] library unavailable, placeholders kept:', e?.message || e);
    S.failed = true;
    return (S.ready = false);
  }
}

/** Is the library active for this mission (manifest loaded, not disabled)? */
export const vehicleArtReady = () => S.ready && !S.disabled && vehicleLibraryReady();

/**
 * GPU warm-up behind the loading screen. Every live vehicle visual (intact AND its burnt wreck, every LOD) is drawn
 * through the game's own render pipeline (`renderFrame`: shadow, AO, x-ray, water passes…) with frustum culling off,
 * next to the shared lamp / scorch materials: the exact programs (per-object shadow flags, render-target colour space,
 * pass overrides, the water mirror's clipping plane), textures and vertex buffers the first pan / wreck swap would otherwise create. Each wreck instance
 * is built now and kept (a later destroy only flips visibility). Everything is restored; shadows redraw next frame.
 * @param {import('three').WebGLRenderer} renderer @param {import('three').Scene} scene @param {import('three').Camera} camera
 * @param {() => void} [renderFrame] one frame of the real pipeline (default: renderer.render(scene, camera))
 * @returns {Promise<{ms: number, visuals: number, wrecks: number}>}
 */
export async function warmVehicleArt(renderer, scene, camera, renderFrame = null) {
  const t0 = performance.now();
  if (!renderer || !scene || !camera || !vehicleArtReady()) return { ms: 0, visuals: 0, wrecks: 0 };
  const vis = liveVehicleVisuals();
  await Promise.all(vis.map((h) => h.ready?.catch?.(() => null)));
  const swap = vis.filter((h) => h.destroyed === false); // single models shown intact (consists forward to their cars)
  await Promise.all(swap.map((h) => h.setDestroyed(true).catch(() => null)));
  const wrecks = swap.filter((h) => h.destroyed).length;
  const group = new THREE.Group(); group.name = 'vehicle-warmup';
  const sh = shared();
  for (const m of [sh.scorchMat, sh.beamFull, sh.beamBlackout, sh.notekPool]) group.add(new THREE.Mesh(sh.poolGeo, m));
  for (const m of [sh.lensHead, sh.lensSlit, sh.lensTail, sh.lensConvoy]) group.add(new THREE.Mesh(sh.lensGeo, m));
  for (const m of [sh.haloHead, sh.haloSlit, sh.haloTail, sh.haloConvoy]) group.add(new THREE.Sprite(m));
  group.traverse((o) => { o.frustumCulled = false; o.castShadow = o.receiveShadow = false; });
  group.position.copy(camera.position);
  const restore = [];
  const unhide = (root) => root.traverse((o) => {
    restore.push([o, o.visible, o.frustumCulled]);
    o.frustumCulled = false;
    if (/_lod\d$|^vehicle:/.test(o.name)) o.visible = true; // every LOD of the intact model and of the wreck
  });
  for (const h of vis) unhide(h.object3d);
  // both wreck and intact roots shown at once (instance roots are the visual's direct children)
  for (const h of vis) for (const c of h.object3d.children) if (c.isGroup && /_lod|^[a-z0-9_]+$/i.test(c.name)) c.visible = true;
  scene.add(group);
  const sm = renderer.shadowMap, prevAuto = sm.autoUpdate;
  const frame = renderFrame || (() => renderer.render(scene, camera));
  try {
    sm.autoUpdate = true; sm.needsUpdate = true;
    scene.updateMatrixWorld(true);
    // twice: the first frame allocates the sun's shadow map, which the water's mirror pass waits for; the second also
    // draws the mirror (renderer clipping plane → each vehicle material's clipped program variant)
    frame(); sm.needsUpdate = true; frame();
    mirrorWarm(renderer, scene, camera, [...vis.map((h) => h.object3d), group]);
  } catch (e) {
    console.warn('[vehicles] warm-up failed:', e?.message || e);
  } finally {
    scene.remove(group);
    for (let i = restore.length - 1; i >= 0; i--) { const [o, v, fc] = restore[i]; o.visible = v; o.frustumCulled = fc; }
    sm.autoUpdate = prevAuto; sm.needsUpdate = true;
    await Promise.all(swap.map((h) => h.setDestroyed(false).catch(() => null)));
  }
  return { ms: performance.now() - t0, visuals: vis.length, wrecks };
}

const WARM_LAYER = 31;
/**
 * The water's mirror pass (art/water) renders the scene with one renderer clipping plane: a separate program variant
 * per material, created the first time a vehicle is seen near water. Draw just the vehicles (+ the lights, via a
 * spare layer) once into a tiny half-float target with one plane that clips nothing.
 */
function mirrorWarm(renderer, scene, camera, roots) {
  const saved = [];
  const tag = (o) => { saved.push([o, o.layers.mask]); o.layers.enable(WARM_LAYER); };
  for (const r of roots) r.traverse(tag);
  scene.traverse((o) => { if (o.isLight) tag(o); });
  const mask = camera.layers.mask, rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const prevRT = renderer.getRenderTarget(), prevClip = renderer.clippingPlanes, sm = renderer.shadowMap, auto = sm.autoUpdate;
  try {
    camera.layers.set(WARM_LAYER); sm.autoUpdate = false;
    renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4)];
    renderer.setRenderTarget(rt); renderer.render(scene, camera);
  } catch (e) {
    console.warn('[vehicles] mirror warm-up failed:', e?.message || e);
  } finally {
    renderer.clippingPlanes = prevClip; renderer.setRenderTarget(prevRT); sm.autoUpdate = auto; sm.needsUpdate = true;
    camera.layers.mask = mask;
    for (const [o, m] of saved) o.layers.mask = m;
    rt.dispose();
  }
}

/** Test hook: forget the mission context. */
export function _resetVehicleArt() { Object.assign(S, { ready: false, disabled: false, failed: false, theater: 'temperate', night: false, log: [], mission: null }); }
/** Test hook: mark the library active for a theater (node tests with a manifest passed to loadVehicleLibrary). */
export function _setVehicleArt(ctx = {}) { Object.assign(S, { ready: true, disabled: false, theater: ctx.theater ?? 'temperate', night: !!ctx.night }); }
/** Note a placeholder / fitting decision in the mission log. */
export function noteVehicleArt(msg) { if (!S.log.includes(msg)) S.log.push(msg); }

// ------------------------------------------------------------------ shared resources (lights, scorch)

let SH = null;
/** Radial / beam textures and materials shared by every vehicle (created once, never recompiled). */
function shared() {
  if (SH) return SH;
  const tex = (W, H, f) => {
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const [v, a] = f(i / (W - 1), j / (H - 1)), k = (j * W + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(255 * v); data[k + 3] = Math.round(255 * a);
    }
    const t = new THREE.DataTexture(data, W, H);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  };
  // headlight beam on the ground, t = 0 at the bumper → 1 at the far end (pool quad: v = 0 at its near edge after the
  // flip below). Light, not paint: it rises from the bumper to a peak a few metres out, then falls off smoothly to
  // nothing well before the far edge; across, a gaussian that widens with distance, renormalised to reach exactly
  // zero at the quad's sides (no hard edges anywhere).
  const sstep = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const beam = tex(64, 128, (u, t) => {
    const along = sstep(0, 0.25, t) * Math.pow(1 - t, 1.3) * sstep(1, 0.5, t) * 1.3;
    const sg = 0.07 + 0.17 * t, g = (x) => Math.exp(-0.5 * (x / sg) ** 2), ge = g(0.5);
    const across = Math.max(0, (g(u - 0.5) - ge) / (1 - ge));
    return [Math.min(1, along * across), 1];
  });
  // scorched ground under a wreck: soot, darkest in the middle, ragged edge from value noise
  const rnd = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const scorch = tex(128, 128, (u, v) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.hypot(x * 1.0, y * 1.0);
    const n = 0.5 * rnd(Math.floor(u * 12), Math.floor(v * 12)) + 0.5 * rnd(Math.floor(u * 29), Math.floor(v * 29));
    const e = Math.max(0, Math.min(1, (1.02 - r - 0.2 * n) / 0.45)), a = e * e * (3 - 2 * e) * (0.8 + 0.2 * n);
    return [(1 - a * 0.9) ** 2, 1]; // linear multiply factor: soot darkens the ground to ~5-15 % in the middle
  });
  const pool = (color, k) => new THREE.MeshBasicMaterial({ map: beam, color: new THREE.Color(color).multiplyScalar(k), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const lens = (color, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false });
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const uv = poolGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  // lamp glare (night): a soft radial halo, drawn additively around the lens so a lit vehicle reads from afar
  const halo = tex(64, 64, (u, v) => { const r = Math.hypot(u * 2 - 1, v * 2 - 1); return [Math.max(0, 1 - r) ** 2.2, 1]; });
  const glare = (color, k) => new THREE.SpriteMaterial({ map: halo, color: new THREE.Color(color).multiplyScalar(k), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  SH = {
    poolGeo,
    haloHead: glare(0xffe0a8, 0.8), haloSlit: glare(0xffd49a, 0.55), haloTail: glare(0xff3018, 0.9), haloConvoy: glare(0xff5030, 0.35),
    beamFull: pool(0xffd79a, 0.42), beamBlackout: pool(0xffd79a, 0.06), notekPool: pool(0xcfe0ff, 0.05),
    lensHead: lens(0xfff0cc, 6), lensSlit: lens(0xffe2b0, 4), lensTail: lens(0xff2a10, 3), lensConvoy: lens(0xff4020, 1.2),
    lensGeo: new THREE.CircleGeometry(1, 16), slitGeo: new THREE.PlaneGeometry(1, 1),
    // multiply-blended like the VFX ground decals (render/vfx/decals.js): darkens whatever ground is under it
    scorchMat: new THREE.MeshBasicMaterial({ map: scorch, color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    scorchGeo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  for (const v of Object.values(SH)) if (v?.userData) v.userData.shared = true; // Entity.dispose keeps them
  return SH;
}

/**
 * Lamp meshes at the library's light anchors: head (blackout cover → narrow slit + dim pool), Notek convoy lamp
 * (downward pool), tail and convoy tail lamps. Anchors follow their node (e.g. the R75 lamp turns with the fork).
 * @returns {THREE.Object3D[]} lamp groups (visible toggled together)
 */
const MOVING_LAMP_NODES = /fork|steer|turret/;
function buildLamps(lights, container = null) {
  const sh = shared(), out = [];
  let pools = 0; // one beam pool per vehicle (on the centreline), not one per lamp
  container?.updateMatrixWorld(true);
  for (const L of lights || []) {
    const kind = L.kind || '', covered = !!(L.blackout || L.cover);
    const g = new THREE.Group(); g.name = `lamp:${L.name || kind}`;
    const ahead = new THREE.Vector3(0, 0, 1); // anchors look along their dir; model +z by default
    if (/head/.test(kind)) {
      const m = new THREE.Mesh(covered ? sh.slitGeo : sh.lensGeo, covered ? sh.lensSlit : sh.lensHead);
      if (covered) m.scale.set(0.09, 0.012, 1); else m.scale.setScalar(0.085);
      m.position.copy(ahead).multiplyScalar(0.012);
      g.add(m);
      g.add(haloSprite(covered ? sh.haloSlit : sh.haloHead, covered ? 0.35 : 0.75, ahead));
      if (!pools++) {
        const p = new THREE.Mesh(sh.poolGeo, covered ? sh.beamBlackout : sh.beamFull);
        p.userData.pool = { len: covered ? 7 : 12, wid: covered ? 3.2 : 5.5 };
        g.add(p);
      }
    } else if (/notek|convoy/.test(kind) && /front|notek/.test(kind + (L.name || '')) && !/tail|rear/.test(L.name || '')) {
      if (pools++) continue;
      const p = new THREE.Mesh(sh.poolGeo, sh.notekPool);
      p.userData.pool = { len: 5, wid: 3 };
      g.add(p);
    } else if (/tail|convoy/.test(kind)) {
      const m = new THREE.Mesh(sh.lensGeo, kind === 'convoy' ? sh.lensConvoy : sh.lensTail);
      m.scale.setScalar(kind === 'convoy' ? 0.03 : 0.035);
      m.rotation.y = Math.PI; m.position.z = -0.012; // faces backwards
      g.add(m);
      g.add(haloSprite(kind === 'convoy' ? sh.haloConvoy : sh.haloTail, kind === 'convoy' ? 0.25 : 0.4, new THREE.Vector3(0, 0, -1)));
    } else continue;
    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 3; });
    L.object.add(g);
    // lamps on the hull live on the instance root, so they stay visible when the LOD2 mesh is shown
    if (container && !MOVING_LAMP_NODES.test(L.node || '')) { L.object.updateMatrixWorld(true); container.attach(g); }
    out.push(g);
  }
  return out;
}

/** Glare sprite just in front of a lens (billboard; world-size `size` m). */
function haloSprite(mat, size, dir) {
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(size); sp.position.copy(dir).multiplyScalar(0.12 + size * 0.2); // clear of the lamp housing
  sp.name = 'lamp-glare'; sp.userData.aoExclude = true; sp.userData.noXray = true;
  return sp;
}

/**
 * Beam of a vehicle for the real-light pool: front centre of its head / Notek lamps (model space) and kind
 * ('full' uncovered headlamps, 'blackout' slit covers, 'notek' convoy lamp only), or null (no front lamps).
 */
function beamInfo(lights) {
  const heads = (lights || []).filter((L) => /head/.test(L.kind || ''));
  const notek = (lights || []).filter((L) => /notek/.test(L.kind || ''));
  const src = heads.length ? heads : notek;
  if (!src.length) return null;
  const pos = new THREE.Vector3();
  for (const L of src) pos.add(new THREE.Vector3(...(L.pos || [0, 1, 1])));
  pos.multiplyScalar(1 / src.length); pos.x = 0;
  const kind = heads.length ? (heads.every((L) => L.blackout || L.cover) ? 'blackout' : 'full') : 'notek';
  return { pos, kind };
}

const _p = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _e = new THREE.Euler();

/** Ground pools lie flat on the ground below their lamp, pointing along the vehicle's forward axis. */
function placePools(lamps, root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  for (const g of lamps) {
    for (const p of g.children) {
      const d = p.userData.pool; if (!d) continue;
      // lamp position in root space → pool centre on the ground ahead, in the lamp group's frame
      inv.copy(g.matrixWorld).invert();
      _p.setFromMatrixPosition(g.matrixWorld); root.worldToLocal(_p);
      const c = new THREE.Vector3(0, 0.05, _p.z + 0.05 + d.len / 2); // centreline, the near edge at the lamps
      root.localToWorld(c); c.applyMatrix4(inv);
      p.position.copy(c);
      g.getWorldQuaternion(_q0).invert(); root.getWorldQuaternion(p.quaternion); p.quaternion.premultiply(_q0);
      p.scale.set(d.wid, 1, d.len);
    }
  }
}

// ------------------------------------------------------------------ seats, doors, exit sides

const TRUCKS = new Set(['truck', 'opel_blitz', 'opel_blitz_tanker', 'fuel_truck', 'van']);
/**
 * Which side a seat gets out on (pure data, same in node and browser — the exit point is gameplay).
 * Entity frame: side +1 = the vehicle's right (heading + π/2), -1 = its left; `back` = out through the rear.
 * Left-hand drive: driver (seat 0) left, co-driver right, rear seats alternate. BMW R75: the rider steps off to the
 * left, the sidecar passenger (seat 1) to the right. Truck passengers use the tailgate, everyone in the
 * Sd.Kfz. 251 half-track its rear doors. Planes: cabin door on the left. Boats, rail and guns: null (the caller keeps its own rule).
 * @param {string} type spawn vehicle type @param {string} kind def.kind @param {number} seat occupant index
 * @returns {{side: number, back?: boolean, row: number}|null}
 */
export function seatSide(type, kind, seat = 0) {
  const row = Math.floor(seat / 2);
  if (kind === 'plane') return { side: DRIVER_SIDE, row: 0 };
  if (kind !== 'land') return null;
  if (type === 'motorcycle') return { side: seat >= 1 ? 1 : DRIVER_SIDE, row: 0 }; // 2 seats (§3.2): rider + sidecar
  if (type === 'halftrack' || type === 'sdkfz') return { side: seat % 2 ? 1 : -1, back: true, row: 0 }; // Sd.Kfz. 251: rear doors
  if (seat >= 2 && TRUCKS.has(type)) return { side: seat % 2 ? 1 : -1, back: true, row: 0 };
  return { side: seat % 2 ? 1 : DRIVER_SIDE, row };
}

const SEAT_ROLE = /driver|passenger|pilot|gunner|inside|rider|sidecar|seat|helm|rower/;
/** Seat sockets of a model in boarding order (driver first). */
function seatSockets(meta) {
  const all = (meta?.sockets || []).filter((s) => SEAT_ROLE.test(`${s.role || ''} ${s.pose || ''} ${s.name || ''}`) && !/exit|coupler|push|carry/.test(s.name || ''));
  const drv = all.filter((s) => /driver|pilot|rider|helm|rower/.test(`${s.role || ''} ${s.name || ''}`) && !/codriver|copilot|rear/.test(s.name || ''));
  return [...drv.slice(0, 1), ...all.filter((s) => s !== drv[0])];
}

/**
 * Door / hatch part(s) a seat uses: the doors on its side nearest the seat socket (rear doors / tailgate for `back`).
 * @returns {string[]} part node names
 */
export function doorsForSeat(meta, type, kind, seat) {
  const doors = (meta?.parts || []).filter((p) => /^(door|hatch|door_slide|tailgate)$/.test(p.kind) && p.pivot);
  if (!doors.length) return [];
  const ss = seatSide(type, kind, seat);
  if (ss?.back) {
    const rear = doors.filter((p) => p.kind === 'tailgate' || /rear/.test(p.node));
    if (rear.length) return rear.map((p) => p.node);
  }
  const sock = seatSockets(meta)[seat] || seatSockets(meta)[0];
  const sx = ss ? -ss.side : Math.sign(sock?.pos?.[0] || 0); // model +x = vehicle left = entity side -1
  const cand = doors.filter((p) => p.kind !== 'tailgate');
  const pos = sock?.pos || [0, 0, 0];
  let best = null, bd = Infinity;
  for (const p of cand) {
    const side = Math.sign(p.pivot[0]);
    // hinges sit at a door's edge, so the front / rear row comes from the name (door_fl vs door_rl, door_rear_L)
    const rearDoor = /(^|_)r[lr]$|rear|_b$/i.test(p.node), rearSeat = (ss?.row ?? (seat >= 2 ? 1 : 0)) > 0;
    const d = Math.hypot(p.pivot[0] - pos[0], p.pivot[2] - pos[2]) + (side && sx && side !== sx ? 10 : 0) + (rearDoor !== rearSeat ? 3 : 0);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? [best.node] : [];
}

// ------------------------------------------------------------------ crew figure anchors

/**
 * Crew figures per registry model key: socket name patterns in seat order, clip, figure offset below the socket
 * (null = seated: measured from the figure's pelvis in that clip, art/vehicle-crew.js). A socket whose pose says
 * seated always gets the seated treatment.
 */
const SEATED = (a) => ({ anim: a, dy: null }); // dy null: measured from the figure's pelvis in that clip
const CREW_SOCKETS = {
  car: [{ s: /^seat_driver$/, ...SEATED('drive') }, { s: /^seat_codriver$/, ...SEATED('sit') }, { s: /^seat_rear_l$/, ...SEATED('sit') }, { s: /^seat_rear_r$/, ...SEATED('sit') }],
  truck: [{ s: /^seat_driver$/, ...SEATED('drive') }, { s: /^seat_codriver$/, ...SEATED('sit') }],
  fuel_truck: [{ s: /^seat_driver$/, ...SEATED('drive') }, { s: /^seat_codriver$/, ...SEATED('sit') }],
  motorcycle: [{ s: /rider/, anim: 'drive', dy: -0.5 }, { s: /sidecar/, anim: 'sit', dy: -0.28 }],
  tank: [{ s: /^commander$/, anim: 'look_around', dy: -1.15 }],
  // 8-Rad: commander standing in the turret; 251: commander beside the driver (seated socket → seated clip)
  armoredcar: [{ s: /^commander$/, anim: 'look_around', dy: -1.1 }, { s: /^driver(_front)?$/, ...SEATED('drive') }],
  patrolboat: [{ s: /gunner_mg/, anim: 'idle', dy: 0 }, { s: /crew_stern/, anim: 'look_around', dy: 0 }],
};
export { CREW_SOCKETS };

// ------------------------------------------------------------------ the model

const BERTH_MAX = 2, BERTH_STEPS = [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1, -1.25, 1.25, -1.5, 1.5, -1.75, 1.75, -BERTH_MAX, BERTH_MAX];
/** Half-beam of a boat's waterline plan at u ∈ [-1 stern, 1 bow]: parallel midbody, fine bow, slightly narrower transom. */
export const boatHalfBeam = (u, W) => (W / 2) * (u > 0.3 ? 1 - ((u - 0.3) / 0.7) ** 2 : u < -0.85 ? 0.85 : 1);

const DEG = Math.PI / 180;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hashId = (s) => { let h = 0x811c9dc5; for (const ch of String(s ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); } return (h >>> 0) % 100003; };
const has = (t) => { try { return !!resolveVehicle(t); } catch { return false; } };
const DOOR_OPEN = 0.35, DOOR_HOLD = 0.8, REAR_DOOR_FRAC = 0.55;
const TURRET_KINDS = /^(turret|turret_yaw|weapon_traverse|gun_yaw|gun_yaw_pitch)$/;

/**
 * Real vehicle model for an entity, or null (library not active / no model for the type → placeholder).
 * @param {string} type spawn vehicle type @param {object} def resolved def (entities/vehicle.js vehicleDef)
 * @param {object} [spawn] mission spawn (id, variant, paint, asset)
 */
export function createLibraryVehicleModel(type, def = {}, spawn = {}) {
  if (!vehicleArtReady()) return null;
  const lt = libraryTypeFor(type, def.type, { types: new Proxy({}, { get: (_, t) => has(t) }) }, spawn.variant);
  if (!lt) { if (!KIT_VEHICLES[type]) noteVehicleArt(`${type}: no library model (placeholder)`); return null; }
  const vis = createVehicleVisual(lt, { theater: S.theater, seed: hashId(spawn.id ?? type), paint: spawn.paint, asset: spawn.asset || LIB_ASSET[lt] });
  if (!vis) return null;
  const root = new THREE.Group(); root.name = `vehicle:${type}`;
  root.userData.library = vis.asset; root.userData.paint = vis.paint;
  const body = new THREE.Group(); body.name = 'body';
  root.add(body); body.add(vis.object3d);
  const [len, wid] = def.size || [4, 2];
  const dims = { l: len, w: wid, h: def.kind === 'emplacement' ? 1 : 2, library: vis.asset, paint: vis.paint };
  const st = { berth: 0, berthWant: 0, berthT: 0, berthy: false, destroyed: false, lastHeading: null, lastSpeed: 0, steer: 0, yawRate: 0, yaw: 0, lift: 0,
    pitch: 0, pitchV: 0, roll: 0, rollV: 0, steerMax: 30 * DEG, holders: [], doors: new Map(), exT: Math.random() * 0.3, lamps: [], lampsOn: null, poolT: 0, scorch: null, t: 0, wb: len * 0.6 };
  const onWater = (v) => { const g = v.world?.grid; const t = g?.terrainAt?.(v.x, v.z); return t != null && (t === T_WATER || t === T_SHALLOW); };

  const model = {
    dims, library: true, visual: vis, ready: null, isReady: false,
    /** Library type drawn (e.g. 'raft', 'rowboat', 'minisub' for registry model key 'raft'): boat crew layouts (art/boat-crew.js). */
    libType: lt,
    /** Boats: the underside samples (model space) and the last rest pose (art/boat-rest.js boatRest result) — tests. */
    get rest() { return def.kind === 'boat' ? { pts: st.under?.pts || null, pose: st.restInfo || null } : null; },
    root,
    /** The traversing turret / gun mount node (LOD0; the clipping audit sweeps it), null until loaded or when wrecked. */
    get turret() {
      if (st.destroyed || !vis.meta) return null;
      const p = vis.meta.parts?.find((q) => TURRET_KINDS.test(q.kind));
      return (p && vis.parts[p.node]) || null;
    },
    get meta() { return vis.meta; },
    /** The wreck's scorch decal mesh (lives in the ground-decal scene once the wreck is in a world), or null. */
    get scorch() { return st.scorch; },
    get contacts() { return st.destroyed ? [] : vis.contacts; },
    /** Clipping-rule gun reach (world/placement.js turretArc): barrel length / bore height / turret housing. */
    get gun() { return gunInfo(vis, def, dims); },
    update(dt, v) { if (dt > 0 && v) step(dt, v); },
    setTurretHeading(localRad) {
      st.yaw = -wrapPi(Number.isFinite(localRad) ? localRad : 0);
      // posed at once (the clipping audit sweeps without sim steps; the next step re-applies the same pose)
      if (vis.meta && !st.destroyed) { vis.update(0, { speed: 0, steer: st.steer, turretYaw: mountYaw(), gunPitch: st.lift }); body.rotation.y = bodyYaw(); }
    },
    setGunLift(a) { st.lift = Number.isFinite(a) ? a : 0; if (vis.meta && !st.destroyed) vis.update(0, { speed: 0, steer: st.steer, turretYaw: mountYaw(), gunPitch: st.lift }); },
    setDestroyed(on) {
      st.destroyed = !!on;
      vis.setDestroyed(st.destroyed);
      for (const g of st.pennants?.list || []) g.visible = !st.destroyed;
      for (const g of st.lamps) g.visible = false;
      st.lampsOn = null;
      if (st.destroyed && !st.scorch && def.kind !== 'boat' && def.kind !== 'emplacement') {
        const sh = shared(), m = new THREE.Mesh(sh.scorchGeo, sh.scorchMat);
        m.name = 'scorch'; m.scale.set(dims.w * 1.9 + 1.5, 1, dims.l * 1.35 + 1.5); m.position.y = 0.04; m.renderOrder = 2;
        m.castShadow = m.receiveShadow = false;
        root.add(m); st.scorch = m;
      }
      if (st.scorch) st.scorch.visible = st.destroyed;
    },
    /**
     * A seat's door through a boarding: 'open' (he stands at it: it swings open and stays open while he climbs in),
     * 'enter' (he is in: the door stays open until he is seated, then shuts), 'exit' (open while he climbs out).
     * Lorry passengers climb over the tailgate: it stays shut.
     */
    boarding(seat, kind) {
      const ss = seatSide(lt, def.kind, seat);
      if (ss?.back && TRUCKS.has(lt)) return;
      // open: he stands at it 0.5 s, then climbs in (~1.45 s, art/vehicle-crew.js BOARD_TIMES) — it shuts as he sits
      const hold = kind === 'open' ? DOOR_HOLD + 1.0 : kind === 'exit' ? DOOR_HOLD + 0.5 : DOOR_HOLD + 0.8;
      for (const n of doorsForSeat(vis.meta, lt, def.kind, seat)) {
        const d = st.doors.get(n);
        if (d?.claim || d?.hand != null) continue; // a man's hand has it (art/vehicle-crew.js)
        // as far as he needs to climb through, and no further than he can reach to pull it shut from the seat
        const max = rigOf(n, seat)?.frac ?? 1;
        if (d && d.t < DOOR_OPEN + d.hold) d.hold = Math.max(d.hold, d.t - DOOR_OPEN + (kind === 'enter' ? DOOR_HOLD + 0.4 : hold)); // already open: keep it open
        else st.doors.set(n, { t: d ? DOOR_OPEN * Math.max(0, 1 - (d.t - DOOR_OPEN - d.hold) / DOOR_OPEN) : 0, hold, max });
      }
    },
    /**
     * The doors a seat uses, rigged for a man's hand (art/door-hand.js doorRig, model frame, door shut) with the fraction
     * they open to for him (`frac`). [] without doors.
     */
    doorRigs(seat) { return doorsForSeat(vis.meta, lt, def.kind, seat).map((n) => rigOf(n, seat)).filter(Boolean); },
    /**
     * A figure takes door `node` in hand (art/vehicle-crew.js): it keeps opening as far as it was going and stays there —
     * no timer shuts it — until his hand moves it (`handDoor`).
     */
    claimDoor(node) {
      const d = st.doors.get(node);
      if (d) { if (d.hand == null) d.claim = true; } else st.doors.set(node, { t: 0, hold: DOOR_HOLD, claim: true, hand: 0, max: 1 });
    },
    /**
     * Door `node` where his hand has it: opening fraction 0..1 (posed at once), or null to let go — shut, it stays shut;
     * left open (he was called away), it swings shut on its own a moment later.
     */
    handDoor(node, frac) {
      let d = st.doors.get(node);
      if (frac == null) {
        if (!d) return;
        const f = d.hand ?? d.cur ?? 0;
        if (f <= 1e-3) { vis.setPart(node, 0); st.doors.delete(node); return; }
        const m = Math.max(f, 1e-3);
        st.doors.set(node, { t: DOOR_OPEN + 0.6, hold: 0.6, max: m }); // swings shut after a moment, from where it is
        return;
      }
      if (!d) st.doors.set(node, (d = { t: 0, hold: DOOR_HOLD }));
      d.hand = clamp(frac, 0, 1); d.claim = true; d.cur = d.hand;
      vis.setPart(node, d.hand);
    },
    /** Opening fraction door `node` shows now (0 shut). */
    doorFrac(node) { return st.doors.get(node)?.cur ?? 0; },
    seatExit: (seat) => seatSide(lt, def.kind, seat),
    trailContacts(v, out = []) {
      if (st.destroyed) return out;
      const h = v.heading, c = Math.cos(h), s = Math.sin(h);
      for (const k of vis.contacts) {
        const p = k.pos || [0, 0, 0];
        const track = k.kind === 'track' || k.track_w != null;
        out.push({ x: v.x + p[2] * c + p[0] * s, z: v.z + p[2] * s - p[0] * c, kind: track ? 'track' : 'tire',
          width: k.width ?? k.track_w ?? (track ? 0.4 : 0.2), id: k.name || `${p[0]},${p[2]}` });
      }
      return out;
    },
    /** World muzzle {x, y, z} of a weapon at the entity's SIMULATION transform (turret posed first), or null. */
    muzzleWorld(weapon = null, v = null) {
      const list = vis.muzzles; if (!list.length) return null;
      const cannon = weapon === 'cannon' || weapon === 'torpedo';
      const m = list.find((q) => (cannon ? q.caliber || /main|gun$|torpedo/.test(q.name) : /mg/i.test(`${q.name} ${q.weapon}`))) || list[0];
      if (!st.destroyed) vis.update(0, { speed: 0, steer: st.steer, turretYaw: mountYaw(), gunPitch: st.lift });
      body.rotation.y = bodyYaw();
      root.updateMatrixWorld(true);
      const p = root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(m.object.matrixWorld));
      if (!v) return root.localToWorld(p);
      const h = v.heading, c = Math.cos(h), s = Math.sin(h);
      const gy = (v.world?.groundY?.(v.x, v.z) || 0) + (v.y || 0);
      return { x: v.x + p.z * c + p.x * s, y: gy + p.y, z: v.z + p.z * s - p.x * c };
    },
    /** Where a wreck burns / smokes: the model's 'fire' (engine bay, fuel tank) or 'smoke' emitter, world {x, y, z}. */
    wreckEmitter(v) {
      const meta = vis.meta;
      const e = (meta?.emitters || []).find((q) => q.kind === 'fire') || (meta?.emitters || []).find((q) => q.kind === 'smoke');
      if (!e || !v) return null;
      const p = e.pos || [0, 1, 0], h = v.heading, c = Math.cos(h), s = Math.sin(h);
      return { x: v.x + p[2] * c + p[0] * s, y: (v.world?.groundY?.(v.x, v.z) || 0) + p[1], z: v.z + p[2] * s - p[0] * c };
    },
    /**
     * Crew-figure holders at the model's crew sockets (commander in the cupola turns with the turret). A holder lives
     * on the instance root and copies its socket every step, so the figure stays visible at every LOD.
     */
    crewSeats(modelKey) {
      const spec = CREW_SOCKETS[modelKey] || [];
      const socks = Object.values(vis.sockets);
      return spec.map((c) => {
        const s = socks.find((q) => c.s.test(q.name));
        if (!s) return null;
        const seated = /seat|sit/.test(s.pose || '') && !/stand/.test(s.pose || '');
        return { ...holderAt(s, 'crew'), anim: seated && c.anim !== 'drive' ? 'sit' : c.anim, dy: seated ? null : c.dy, roof: cabRoof() };
      }).filter(Boolean);
    },
    /**
     * Holder at boarding seat `k` (driver first) for a visible occupant (a commando or an enemy who got in), or null.
     * Clip: 'drive' for the driver / rider, else 'sit'; dy null (seated, measured). Cached per seat.
     */
    seatHolder(k) {
      if (!vis.meta || st.destroyed) return null;
      st.seatH ||= [];
      if (st.seatH[k] !== undefined) return st.seatH[k];
      const d = seatSockets(vis.meta)[k];
      const s = d && Object.values(vis.sockets).find((q) => q.name === d.name);
      if (!s?.object || /cargo|bay|troop|bench|deck/.test(d.name)) return (st.seatH[k] = null); // under the canvas / in the back
      const drv = /driver|rider|pilot|helm/.test(`${d.role || ''} ${d.name}`) && !/codriver/.test(d.name);
      return (st.seatH[k] = { ...holderAt(s, 'seat'), anim: drv ? 'drive' : 'sit', dy: null, roof: cabRoof() });
    },
    /** Night beam for the real-light pool: {on, kind, pos (model space), obj (the posed model)} or null. */
    get beam() { return st.beam && !st.destroyed ? { on: !!st.lampsOn, kind: st.beam.kind, pos: st.beam.pos, obj: vis.object3d } : null; },
    /**
     * Men climbing over the tailgate this frame (art/vehicle-crew.js): their body capsules in `curtainFrame`'s space part
     * the rear straps (art/strap-curtain.js). @param {object[]} caps
     */
    curtainPush(caps) { if (st.curtain && !st.destroyed) st.curtain.push(caps); },
    /** The rear strap curtain's frame (the model instance), or null when the vehicle has none. */
    get curtainFrame() { return st.curtain?.mesh.parent || null; },
    /** The rear strap curtain (tests / tools) or null. */
    get curtain() { return st.curtain || null; },
    /**
     * A covered lorry's canvas over the bay (model frame, m): rear / front ends, the roof's top, the underside of the
     * rolled-up flap over the rear opening — men climbing in stoop under it (art/vehicle-crew.js). null when uncovered.
     */
    get canopy() {
      const f = st.curtain?.found;
      if (!f || st.destroyed) return null;
      const b = f.coverBox, roll = Math.min(...f.defs.map((d) => d.y));
      return { zRear: b.min.z, zFront: b.max.z, roof: b.max.y, roll };
    },
    dispose() { S.live.delete(model); st.pennants?.dispose(); st.curtain?.dispose(); vis.object3d.traverse((o) => { if (o.userData.ownCanvas) o.material.dispose(); }); vis.dispose(); st.scorch?.removeFromParent(); root.clear(); },
  };

  model.ready = vis.ready.then(() => {
    const b = vis.meta?.bbox, md = vis.meta?.dims || {};
    // authored dimensions first (a few sidecar bboxes are loose), else the bbox
    if (b) Object.assign(dims, { w: md.width ?? md.span ?? md.beam ?? (b.max[0] - b.min[0]), l: md.length ?? md.length_over_fenders ?? (b.max[2] - b.min[2]), h: md.height ?? b.max[1] });
    const wheels = (vis.meta?.contacts || []).map((k) => k.pos?.[2]).filter(Number.isFinite);
    if (wheels.length > 1) st.wb = Math.max(...wheels) - Math.min(...wheels) || st.wb;
    const lock = Math.max(0, ...(vis.meta?.parts || []).filter((p) => p.steer).map((p) => Math.abs(p.steer_limits_deg?.[1] ?? 30)));
    if (lock > 0) st.steerMax = lock * DEG; // the model's own steering lock (Opel Blitz 35°)
    st.lamps = buildLamps(vis.lights, vis.object3d);
    st.beam = beamInfo(vis.meta?.lights);
    st.pennants = addPennants(vis, spawn, S.theater);
    clearGlass(vis.object3d);
    placePools(st.lamps, vis.object3d);
    for (const g of st.lamps) g.visible = false;
    if (/opel_blitz_cargo/.test(vis.model || '')) st.curtain = rearCurtain(vis.object3d, canvasFlap(vis.object3d));
    if (st.destroyed) model.setDestroyed(true);
    markShared(vis.object3d);
    model.isReady = true;
    return model;
  }).catch((e) => { console.warn('[vehicles] model failed', type, e?.message || e); return model; });

  /** One simulation step of the visuals: drive, suspension, doors, lamps, exhaust. */
  function step(dt, v) {
    st.t += dt;
    if (st.destroyed && !st.burnt && v.world) { // the grass under a burnt-out hull lies flat and scorched
      st.burnt = true;
      if (def.kind === 'land') v.world.terrain?.stampTrail?.('flatten', v.x, v.z, v.heading, { length: dims.l * 1.3 + 1, width: dims.w * 1.8 + 1, record: false });
      // the scorch joins the engine's ground-decal scene (drawn over the terrain before AO, like the VFX decals)
      const ds = v.world.fx?.vfx?.decals?.scene;
      if (st.scorch && ds) {
        root.updateMatrixWorld(true);
        const m = st.scorch; m.matrixAutoUpdate = false; m.matrix.copy(m.matrixWorld);
        m.matrix.elements[13] = (v.world.groundY?.(v.x, v.z) || 0) + 0.03;
        ds.add(m); m.matrixWorldNeedsUpdate = true;
      }
    }
    if (!st.fitted && model.isReady && v.world?.grid) fit(v);
    const speed = (v.reversing ? -1 : 1) * (v.speed || 0);
    let yawL = 0;
    if (st.lastHeading != null && Number.isFinite(v.heading)) yawL = -wrapPi(v.heading - st.lastHeading) / dt; // + = left (CCW)
    st.lastHeading = v.heading;
    st.yawRate += (yawL - st.yawRate) * Math.min(1, dt * 12);
    // car-steered hulls (entities/vehicle-maneuver.js) carry the curvature they drive on (steerK, + = heading grows =
    // a right turn): the front wheels take the matching lock (bicycle model, wheelbase from the wheel contacts), turn
    // over while the hull stands at a change of gear, and keep their last lock when it stops; others: from the yaw rate
    const target = v.arcDrive && Number.isFinite(v.steerK) ? clamp(Math.atan(-st.wb * v.steerK) / st.steerMax, -1, 1)
      : Math.abs(speed) > 0.3 ? clamp(Math.atan((st.wb * st.yawRate) / speed) / (30 * DEG), -1, 1) : st.steer * 0.9;
    st.steer += (target - st.steer) * Math.min(1, dt * (v.arcDrive ? 3.5 : 6));
    const accel = (speed - st.lastSpeed) / dt; st.lastSpeed = speed;
    const crewed = !!v.driver || (v.crew || []).some((c) => c?.alive !== false);
    const engine = !st.destroyed && (crewed || Math.abs(speed) > 0.05);
    if (!st.destroyed) vis.update(dt, { speed, steer: st.steer, turretYaw: mountYaw(), gunPitch: st.lift, engine, yawRate: st.yawRate });
    suspension(dt, v, accel);
    berth(dt, v);
    doors(dt);
    if (st.holders.length) syncHolders();
    if (st.pennants) { const h = v.heading || 0; st.pennants.setVelocity(Math.cos(h) * speed, Math.sin(h) * speed); }
    lamps(v, crewed, speed);
    if (st.lampsOn && v.world?.groundY && (st.poolT -= dt) <= 0) { st.poolT = Math.abs(speed) > 0.2 ? 0.25 : 2; fitPools(v.world); }
    if (engine) exhaust(dt, v, speed, accel);
    if (st.curtain && !st.destroyed) {
      // the hull's acceleration in its own frame (x left, z forward): low-passed, clamped (a stop / start step is a jolt, not a fling)
      const k = Math.min(1, dt / 0.15), ca = st.curtA || (st.curtA = [0, 0, 0]);
      ca[0] += (clamp(speed * st.yawRate, -6, 6) - ca[0]) * k; ca[2] += (clamp(accel, -6, 6) - ca[2]) * k;
      st.curtain.step(dt, { acc: ca });
    }
  }

  /**
   * Berth (visual only, boats at true scale): the patrol routes were laid for the registry footprint (e.g. 8 m), so a
   * true-size hull passing an islet or the cut end of a river would ride over the land. Like a helmsman giving the
   * shore a berth, the drawn hull eases sideways (≤ BERTH_MAX m, slowly) to where it floats clear; the entity, its
   * sight and its path are untouched. Re-evaluated 4× a second on the hull plan.
   */
  function berth(dt, v) {
    if (!st.berthy || !v.world?.grid || st.destroyed) return;
    if ((st.berthT -= dt) <= 0) {
      st.berthT = 0.25;
      const ahead = (v.reversing ? -1 : 1) * Math.min(6, (v.speed || 0) * 2.5); // where the hull will be as it shifts
      const ov = (d) => Math.max(overlap(v, dims.l, dims.w, d), ahead ? overlap(v, dims.l, dims.w, d, ahead) : 0);
      let best = st.berthWant, bo = ov(best);
      if (bo > 0.002 || best !== 0) {
        for (const d of BERTH_STEPS) {
          if (d === best) continue;
          const o = ov(d);
          if (o < bo - 0.002 || (o <= bo + 0.002 && Math.abs(d) < Math.abs(best))) { bo = o; best = d; }
        }
      }
      st.berthWant = best;
      if (!st.berthSet) { st.berthSet = true; st.berth = best; } // already moored clear at the mission start
    }
    st.berth += clamp(st.berthWant - st.berth, -0.6 * dt, 0.6 * dt); // ≤ 0.6 m/s sideways
    body.position.x = -st.berth; // model +x = the vehicle's left; berth + = to its right
  }

  /** Body on the ground: terrain pitch / roll from the relief under the hull, squat / dive spring; boats float + bob. */
  function suspension(dt, v, accel) {
    const w = v.world, gy = w?.groundY ? (x, z) => w.groundY(x, z) || 0 : null;
    let pitch = 0, roll = 0, y = 0;
    const rest = def.kind === 'boat' ? boatPose(dt, v) : null;
    if (rest) {
      // boats: afloat the bob is eased in as before; on the ground posed outright (a lag would let a bank paddled onto
      // come up through the hull for a moment)
      body.position.y = rest.afloat ? body.position.y + (rest.y - body.position.y) * Math.min(1, dt * 10) : rest.y;
      body.rotation.set(rest.pitch, bodyYaw(), rest.roll, 'YXZ');
      return;
    }
    if (def.kind === 'boat' && onWater(v)) {
      const t = (w?.time ?? st.t) + (hashId(spawn.id) % 17);
      const k = def.raft ? 1.4 : clamp(6 / (dims.l || 6), 0.4, 1.2);
      y = (w?.water?.level ?? -0.1) + Math.sin(t * 1.7) * 0.04 * k;
      pitch = Math.sin(t * 1.1) * 0.012 * k; roll = Math.sin(t * 0.83 + 1) * 0.02 * k;
    } else if (gy && def.kind !== 'rail' && def.kind !== 'emplacement' && !v.hiddenRail) {
      const h = v.heading, c = Math.cos(h), s = Math.sin(h), L = Math.max(1, dims.l * 0.4), W = Math.max(0.5, dims.w * 0.4);
      const g0 = gy(v.x, v.z), gF = gy(v.x + c * L, v.z + s * L), gB = gy(v.x - c * L, v.z - s * L);
      const gL = gy(v.x + s * W, v.z - c * W), gR = gy(v.x - s * W, v.z + c * W); // left = (sin h, -cos h)
      pitch = Math.atan2(gB - gF, 2 * L); roll = Math.atan2(gL - gR, 2 * W);
      y = Math.max((gF + gB) / 2, (gL + gR) / 2) - g0; // settle on the higher pair: never sinks into a hump
    }
    // squat under acceleration, dive under braking (damped spring; tracks and heavy hulls barely move)
    const soft = def.kind === 'land' ? (/tank|armoredcar/.test(def.model) ? 0.25 : type === 'motorcycle' ? 0.5 : 1) : 0;
    const want = soft ? clamp(-accel * 0.006 * soft, -0.035, 0.035) : 0;
    st.pitchV += ((want - st.pitch) * 90 - st.pitchV * 11) * dt;
    st.pitch += st.pitchV * dt;
    // body roll in a bend: the body leans out of the turn with the sideways acceleration (speed × yaw rate), sprung
    const lat = (v.reversing ? -1 : 1) * (v.speed || 0) * st.yawRate;
    const wantR = soft ? clamp(lat * 0.011 * soft, -0.045, 0.045) : 0;
    st.rollV += ((wantR - st.roll) * 70 - st.rollV * 10) * dt;
    st.roll += st.rollV * dt;
    // the road under the wheels: a light, speed-scaled bounce and rock on the springs (the hull reads as rolling over
    // ground, not sliding over it), phased by the distance driven so it stops when the wheels do
    const sp = Math.abs((v.reversing ? -1 : 1) * (v.speed || 0));
    st.odo = (st.odo || 0) + sp * dt;
    const amp = soft ? Math.min(1, sp / 4) * soft : 0, o = st.odo;
    const bump = amp * (Math.sin(o * 2.3) * 0.006 + Math.sin(o * 5.1 + 1.3) * 0.003);
    const rock = amp * (Math.sin(o * 1.7 + 0.4) * 0.0045 + Math.sin(o * 3.9) * 0.002), nod = amp * Math.sin(o * 2.9 + 2.1) * 0.003;
    body.position.y += (y + bump - body.position.y) * Math.min(1, dt * 10);
    body.rotation.set(pitch + st.pitch + nod, bodyYaw(), roll + st.roll + rock, 'YXZ');
  }

  /**
   * A boat at rest (art/boat-rest.js): afloat, the gentle bob, pitch and roll on the water; wherever the drawn ground
   * under its hull comes up to it (a bank, a beach, the shallow bed, dry land) it rests on the ground instead — the land
   * end on the shore, the water end afloat, pitched and rolled to the slope, never into it. The underside is sampled
   * from the model drawn (intact or wreck); the ground and water under it are read again whenever the hull moves.
   * @returns {{y:number, pitch:number, roll:number}|null} body pose (y above the entity's root), null = not loaded yet
   */
  function boatPose(dt, v) {
    const w = v.world;
    if (!w || !model.isReady || !vis.meta) return null;
    const t = (w.time ?? st.t) + (hashId(spawn.id) % 17);
    const k = def.raft ? 1.4 : clamp(6 / (dims.l || 6), 0.4, 1.2);
    const R = st.rest || (st.rest = { key: '', near: false, pts: null, ground: null, water: null, q: null, level: -0.1 });
    // ground / water under the hull: read again when the hull has moved (or the terrain mesh came in)
    const ready = terrainReady(w), dx = body.position.x, h = v.heading || 0;
    const inst = shownInstance(); // (the intact model, or the wreck once it is in)
    const key = `${v.x.toFixed(3)},${v.z.toFixed(3)},${h.toFixed(4)},${dx.toFixed(3)},${ready ? 1 : 0},${inst?.id ?? 0}`;
    if (key !== R.key) {
      R.key = key;
      const G = groundOf(w), Wl = waterOf(w), beach = BEACHED.has(lt), xz = { x: 0, z: 0 };
      R.level = Wl(v.x, v.z) ?? (Number.isFinite(w.water?.level) ? w.water.level : -0.1);
      // open water (no ground within reach of the keel anywhere round the hull's box): afloat, nothing more to read
      const b = vis.meta.bbox, deep = Math.max(0.1, -(b?.min?.[1] ?? -0.3)) + 0.3;
      R.near = !b;
      if (b) {
        for (let e = 0; e <= 4; e++) for (let f = 0; f <= 8 && !R.near; f++) {
          sampleXZ({ x: b.min[0] + ((b.max[0] - b.min[0]) * e) / 4, z: b.min[2] + ((b.max[2] - b.min[2]) * f) / 8 }, v.x, v.z, h, dx, xz);
          const g = G(xz.x, xz.z), l = Wl(xz.x, xz.z);
          if (l == null ? g > -1e6 : g > l - (beach ? deep : 0.3)) R.near = true;
        }
      }
      if (R.near) {
        const pts = underside(inst);
        if (pts?.length) {
          if (R.pts !== pts) { R.pts = pts; R.ground = new Float64Array(pts.length); R.water = new Array(pts.length).fill(null); }
          for (let i = 0; i < pts.length; i++) {
            sampleXZ(pts[i], v.x, v.z, h, dx, xz);
            const g = G(xz.x, xz.z), l = Wl(xz.x, xz.z);
            // a deep keel only rests on ground standing out of the water (its keel at a mooring is under the surface)
            R.ground[i] = beach || l == null || g >= l ? g : -Infinity;
            R.water[i] = l;
          }
        } else R.near = false;
        R.fk = null;
      }
    }
    // the bob of a hull at rest on the water, gentler the more of it lies on the ground
    const q = R.near ? R.q ?? 1 : 1;
    const float = { h: R.level + Math.sin(t * 1.7) * 0.04 * k * q, pitch: Math.sin(t * 1.1) * 0.012 * k * q, roll: Math.sin(t * 0.83 + 1) * 0.02 * k * q };
    let r;
    if (!R.near) r = { h: float.h, pitch: float.pitch, roll: float.roll, grounded: 0, afloat: true };
    else {
      // (solved again only when the hull moved or its floating pose changed by a tenth of a millimetre)
      const fk = `${R.key}|${float.h.toFixed(4)}|${float.pitch.toFixed(5)}|${float.roll.toFixed(5)}`;
      if (fk !== R.fk) { R.fk = fk; R.r = boatRest(R.pts, float, R.ground, R.water, { squash: REST.squash[lt] ?? 0, com: [0, -0.03 * (dims.l || 3)] }); }
      r = R.r;
    }
    const want = clamp(1 - 2 * r.grounded, 0, 1);
    R.q = R.q == null ? want : R.q + (want - R.q) * Math.min(1, dt * 2);
    st.restInfo = r;
    const base = (typeof w.groundY === 'function' ? w.groundY(v.x, v.z) || 0 : 0) + (v.y || 0); // the root's height (Entity.syncTransform)
    return { y: r.h - base, pitch: r.pitch, roll: r.roll, afloat: r.afloat };
  }

  /** The model instance shown (intact or wreck root: the visual's child holding the LOD groups), or null. */
  function shownInstance() {
    for (const c of vis.object3d.children) if (c.visible && c.children.some((q) => /_lod\d+$/.test(q.name))) return c;
    return null;
  }

  /**
   * Underside samples of the model drawn now (intact or wreck: every LOD of it, as any may be shown, without the
   * paddles / oars, which swing on their own), model space; cached per model instance.
   */
  function underside(inst = shownInstance()) {
    const o = vis.object3d;
    if (!inst) return st.under?.pts || null;
    if (st.under?.inst === inst) return st.under.pts;
    o.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), m = new THREE.Matrix4();
    const loose = (q) => { for (let a = q; a && a !== inst; a = a.parent) if (/paddle|oar|splash/i.test(a.name)) return true; return false; };
    const tris = []; // model-space triangles of every LOD's hull meshes
    for (const lod of inst.children) {
      if (!/_lod\d+$/.test(lod.name)) continue;
      lod.traverse((q) => {
        if (!q.isMesh || !q.geometry?.attributes?.position || loose(q)) return;
        m.multiplyMatrices(inv, q.matrixWorld);
        const pos = q.geometry.attributes.position, idx = q.geometry.index, n = idx ? idx.count : pos.count, e = m.elements;
        const put = (t, o, k) => {
          const i = idx ? idx.getX(k) : k, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          t[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; t[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; t[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        };
        for (let k = 0; k + 2 < n; k += 3) { const t = new Float64Array(9); put(t, 0, k); put(t, 3, k + 1); put(t, 6, k + 2); tris.push(t); }
      });
    }
    const pts = hullUndersideTris(tris);
    st.under = { inst, pts };
    return pts;
  }

  /**
   * Visual fit (never gameplay): planes and guns whose real size exceeds the registry footprint keep their true
   * scale when the scene has room, else shrink (≥ 0.55) until the hull clears static structures. Boats, and anything
   * that carries crew figures, always keep their true scale: a shrunk hull under full-size sailors reads as a toy,
   * so the mission's route has to keep a true-size hull in the water; any bank / islet contact is logged instead.
   */
  function fit(v) {
    st.fitted = true;
    const [rl, rw] = def.size || [4, 2];
    if (def.kind === 'land' || def.kind === 'rail' || (dims.l <= rl + 0.4 && dims.w <= rw + 0.4)) return;
    if (def.kind === 'boat' || CREW_SOCKETS[type] || CREW_SOCKETS[def.model]) {
      st.berthy = def.kind === 'boat' && !def.raft; // a true-size hull on a route laid for the registry footprint: berth
      const o = overlap(v, dims.l, dims.w);
      if (o > 0.01) noteVehicleArt(`${spawn.id ?? type} (${vis.asset}) true scale ${dims.l.toFixed(1)}×${dims.w.toFixed(1)} m: ${(o * 100).toFixed(0)}% of the hull over land at its post (berth offset)`);
      return;
    }
    let sc = 1;
    for (; sc > 0.55; sc -= 0.05) if (overlap(v, dims.l * sc, (def.kind === 'plane' ? Math.min(dims.w, dims.l * 0.35) : dims.w) * sc) <= 0.01) break;
    sc = Math.max(0.55, Math.round(sc * 100) / 100);
    if (sc < 1) {
      body.scale.setScalar(sc);
      dims.l *= sc; dims.w *= sc; dims.h *= sc; dims.scale = sc;
      noteVehicleArt(`${spawn.id ?? type} (${vis.asset}) shown at ${sc.toFixed(2)}x to clear the scene`);
    }
  }
  /**
   * Fraction of the hull rectangle (length L, width W at the entity pose, shifted `d` m to its right) over static
   * structures / dry land; `f` m further along its heading (look-ahead).
   */
  function overlap(v, L, W, d = 0, f = 0) {
    const g = v.world.grid, c = Math.cos(v.heading), s = Math.sin(v.heading);
    let n = 0, bad = 0;
    for (let a = -L / 2; a <= L / 2; a += 0.5) for (let b = -W / 2; b <= W / 2; b += 0.5) {
      if (def.kind === 'boat' && Math.abs(b) > boatHalfBeam((2 * a) / L, W) + 1e-6) continue; // hull plan, not its box
      const x = v.x + c * (a + f) - s * (b + d), z = v.z + s * (a + f) + c * (b + d);
      const { i, j } = g.worldToCell(x, z);
      n++;
      if (!g.inBounds(i, j)) { if (def.kind !== 'boat') bad++; continue; } // off-map water goes on
      const k = g.idx(i, j);
      if (g.block[k] === B_HIGH && !g.bridge?.[k]) bad++;
      else if (def.kind === 'boat' && g.terrain[k] !== T_WATER && g.terrain[k] !== T_SHALLOW && !g.bridge?.[k]) bad++;
    }
    return n ? bad / n : 0;
  }

  function holderAt(s, tag) {
    const holder = new THREE.Group(); holder.name = `${tag}:${s.name}`; holder.matrixAutoUpdate = false;
    vis.object3d.add(holder);
    st.holders.push({ holder, anchor: s.object });
    if (vis.meta) syncHolders();
    return { object: holder, socket: s.name };
  }
  /** Inside height (model y) of a closed cab / saloon roof, or null for open vehicles (heads may clear the screen). */
  function cabRoof() {
    const md = vis.meta?.dims || {};
    if (/opel_blitz/.test(vis.asset || '')) return (md.height_cab ?? 2.19) - 0.08;
    if (/citroen|sdkfz231/.test(vis.asset || '')) return (vis.meta?.height ?? md.height ?? 1.5) - 0.09;
    if (/_top$/.test(vis.model || '')) return (md.height_top_up ?? vis.meta?.height ?? 1.6) - 0.1; // canvas top up
    return null;
  }

  const _inv = new THREE.Matrix4();
  function syncHolders() {
    vis.object3d.updateMatrixWorld(true);
    _inv.copy(vis.object3d.matrixWorld).invert();
    for (const h of st.holders) { h.holder.matrix.multiplyMatrices(_inv, h.anchor.matrixWorld); h.holder.matrixWorldNeedsUpdate = true; }
  }

  /**
   * Guns on a limited mount (MG tripod ±30°, mortar): the crew re-lays the whole gun, so the traverse beyond the mount's
   * own limits turns the gun body; free mounts (turrets, the Flak's cruciform) traverse on their ring.
   */
  function mountLimit() {
    if (st.mountLim !== undefined) return st.mountLim;
    if (!vis.meta) return null;
    const p = def.kind === 'emplacement' ? vis.meta.parts?.find((q) => TURRET_KINDS.test(q.kind)) : null;
    const l = p?.limits_deg;
    return (st.mountLim = l && l[1] - l[0] < 359 ? [l[0] * DEG, l[1] * DEG] : null);
  }
  function bodyYaw() {
    const L = mountLimit();
    if (!L) return 0;
    return st.yaw - clamp(st.yaw, L[0], L[1]) + 0;
  }
  function mountYaw() { return st.yaw - bodyYaw(); }

  function doors(dt) {
    for (const [n, d] of st.doors) {
      if (d.hand != null) { vis.setPart(n, d.hand); d.cur = d.hand; continue; } // in a man's hand (art/door-hand.js)
      d.t += dt;
      const hold = d.claim ? Infinity : d.hold ?? DOOR_HOLD;
      const open = d.t < DOOR_OPEN ? d.t / DOOR_OPEN : d.t < DOOR_OPEN + hold ? 1 : 1 - (d.t - DOOR_OPEN - hold) / DOOR_OPEN;
      const e = clamp(open, 0, 1);
      d.cur = e * e * (3 - 2 * e) * (d.max ?? 1);
      vis.setPart(n, d.cur);
      if (open <= 0) { vis.setPart(n, 0); st.doors.delete(n); }
    }
  }

  /**
   * Door `node` rigged for a hand (art/door-hand.js): its geometry measured once from the intact model's door meshes
   * (door shut), and the fraction it opens to for a man in `seat`. null when the model has no such door part.
   */
  function rigOf(node, seat) {
    st.rigs ||= new Map();
    const key = `${node}|${seat}`;
    if (st.rigs.has(key)) return st.rigs.get(key);
    // hinged doors only (a vertical hinge): not a tailgate dropping down, not a roof hatch
    const def = (vis.meta?.parts || []).find((p) => p.node === node && p.pivot && p.kind === 'door' && Math.abs(p.axis?.[1] ?? 1) > 0.9);
    const obj = def && vis.parts[node];
    let rig = null;
    if (obj) {
      const box = st.rigs.get(node) || doorBox(obj, def);
      st.rigs.set(node, box);
      if (box) {
        rig = doorRig(def, box);
        const sock = seatSockets(vis.meta)[seat];
        // side doors: as far as he reaches from the seat; rear doors (the half-track's swing in): half-way, so a man
        // inside or just outside them reaches their edges
        rig.frac = rig.alongZ ? (sock?.pos ? boardFrac(rig, sock.pos) : 1) : REAR_DOOR_FRAC;
        rig.seat = sock?.pos || null;
      }
    }
    st.rigs.set(key, rig);
    return rig;
  }
  /** Model-frame box of a door's meshes with the door shut (LOD0 node of the intact model). */
  function doorBox(obj, def) {
    const was = st.doors.get(def.node)?.cur ?? 0;
    vis.setPart(def.node, 0);
    vis.object3d.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(vis.object3d.matrixWorld).invert(), m = new THREE.Matrix4(), bb = new THREE.Box3();
    obj.traverse((o) => { if (o.isMesh) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld))); } });
    vis.setPart(def.node, was);
    return bb.isEmpty() ? null : { min: bb.min.toArray(), max: bb.max.toArray() };
  }

  /** Ground pools follow the relief: each pool's centre is lifted / lowered onto the ground under it. */
  const _pw = new THREE.Vector3();
  function fitPools(world) {
    for (const g of st.lamps) for (const p of g.children) {
      if (!p.userData.pool) continue;
      p.userData.p0 ||= p.position.clone();
      p.position.copy(p.userData.p0);
      p.updateWorldMatrix(true, false);
      p.getWorldPosition(_pw);
      _pw.y = (world.groundY(_pw.x, _pw.z) || 0) + 0.06;
      p.position.copy(p.parent.worldToLocal(_pw));
    }
  }

  function lamps(v, crewed, speed) {
    const on = !st.destroyed && !v.hiddenRail && (v.lightsOn === true || (v.lightsOn !== false && S.night && (crewed || Math.abs(speed) > 0.1)));
    if (on === st.lampsOn) return;
    st.lampsOn = on;
    for (const g of st.lamps) g.visible = on;
  }

  const _w = new THREE.Vector3(), _d = new THREE.Vector3();
  /** Exhaust puffs at the library's exhaust emitters: rate, size and soot scale with the engine load. */
  function exhaust(dt, v, speed, accel) {
    const vfx = v.world?.fx?.vfx;
    if (!vfx || !root.visible) return;
    st.exT -= dt;
    if (st.exT > 0) return;
    const fast = v.def?.fast || 5;
    const load = clamp(Math.abs(speed) / fast * 0.55 + Math.max(0, accel) / 3 + (Math.abs(st.yawRate) > 0.2 ? 0.2 : 0), 0, 1);
    st.exT = 0.5 - 0.36 * load + Math.random() * 0.08;
    const ems = vis.emitters.filter((e) => e.kind === 'exhaust');
    if (!ems.length) return;
    const grey = 0.62 - 0.3 * load;
    for (const e of ems) {
      e.object.getWorldPosition(_w);
      _d.set(0, 0, 1).transformDirection(e.object.matrixWorld);
      if (_d.y < -0.5 || _d.lengthSq() < 0.1) _d.set(0, 0.2, 0);
      vfx.spawn('smoke_puff', _w.clone(), { dir: _d.clone().multiplyScalar(0.35).setY(0.25), size: 0.18 + 0.4 * load, col: [grey, grey, grey * 1.04] });
    }
  }

  S.live.add(model);
  return model;
}

/**
 * Cab glazing (library 'glass_cab', 0.55 opaque near-black): period glass is clear, so the crew is seen through it —
 * 0.3 keeps the reflections and the dim cab but shows the driver at the wheel. Shared materials: set once.
 */
function clearGlass(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.transparent && /glass_cab/.test(m.name) && m.opacity > 0.3) m.opacity = 0.3;
  });
}

/** Library geometry / materials are shared by every instance: Entity.dispose must not free them. */
export function markShared(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.userData.shared = true;
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) m.userData.shared = true;
  });
}

/**
 * Per displayed frame (Game.render): LOD by the orthographic camera zoom (library lodPolicy) + registered tickers
 * (windsocks and other wind-driven static vehicle parts, art/static-vehicles.js).
 */
export function tickVehicles(dt, camera, wind = null) {
  if (camera && camera.zoom !== S.zoom) { S.zoom = camera.zoom; setVehicleZoom(camera.zoom); }
  S.pool?.frame(dt, camera);
  for (const t of S.tickers) t(dt, wind, camera);
}
/**
 * Register a per-frame ticker `fn(dt, wind, camera)` (returns the unregister function); `onRelease` runs at the
 * mission unload (ambient flyovers stop their engine loops, free their aircraft).
 */
export function addVehicleTicker(fn, onRelease = null) {
  S.tickers.add(fn);
  if (onRelease) S.releasers.add(onRelease);
  return () => { S.tickers.delete(fn); if (onRelease) S.releasers.delete(onRelease); };
}

/** Real lights per render preset for night headlamps (fixed count per mission → no shader recompiles mid-game). */
export const LAMP_LIGHTS = Object.freeze({ low: 0, medium: 2, high: 3, ultra: 4 });
/** Beam per lamp kind: intensity (cd), reach (m), cone half-angle, penumbra, colour. Blackout slits / Notek are dim. */
const BEAMS = {
  full: { i: 60, d: 32, a: 0.38, pen: 0.5, col: 0xffe4b8 },
  blackout: { i: 9, d: 16, a: 0.3, pen: 0.85, col: 0xffd8a8 },
  notek: { i: 3, d: 9, a: 0.95, pen: 0.9, col: 0xd6e2ff },
};

/**
 * Night headlamp lights (call once per mission after the map is built): a FIXED pool of SpotLights (count per render
 * preset) handed each frame to the lit vehicles nearest the view centre, so walls, grass, units and crates ahead of a
 * vehicle are lit for real; the lens glare and the ground-pool texture (the cheap cookie: bright centre, widening
 * throw, slit covers → a short narrow band) stay on every lit vehicle. Daytime / low preset: nothing is created.
 * @param {THREE.Object3D} scene @param {{preset?: string}} [o]
 * @returns {{lights: THREE.SpotLight[], stats: object, frame: Function, dispose: Function}|null}
 */
export function createVehicleLamps(scene, o = {}) {
  S.pool?.dispose();
  S.pool = null;
  const K = S.night && scene ? LAMP_LIGHTS[o.preset] ?? 2 : 0;
  if (!K) return null;
  const group = new THREE.Group(); group.name = 'vehicle-lamps';
  const lights = [];
  for (let k = 0; k < K; k++) {
    const L = new THREE.SpotLight(0xffe0b0, 0, 20, 0.35, 0.6, 2);
    L.castShadow = false; L.userData.slot = null; L.userData.fade = 0;
    group.add(L, L.target); lights.push(L);
  }
  scene.add(group);
  const ray = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), tmp = [];
  const stats = { lights: K, lit: 0, assigned: 0 };
  const pool = {
    lights, stats, group,
    frame(dt, camera) {
      let cx = 0, cz = 0;
      if (camera) {
        camera.getWorldDirection(ray);
        const t = ray.y < -1e-3 ? -camera.position.y / ray.y : 0;
        cx = camera.position.x + ray.x * t; cz = camera.position.z + ray.z * t;
      }
      tmp.length = 0;
      for (const m of S.live) {
        const bm = m.beam;
        if (!bm?.on || !m.root.parent || !m.root.visible) continue;
        bm.obj.getWorldPosition(a);
        tmp.push([(a.x - cx) ** 2 + (a.z - cz) ** 2, m]);
      }
      tmp.sort((p, q) => p[0] - q[0]);
      stats.lit = tmp.length;
      const want = new Set(tmp.slice(0, K).map((p) => p[1]));
      for (const L of lights) if (L.userData.slot && !want.has(L.userData.slot)) L.userData.slot = null;
      for (const L of lights) if (L.userData.slot) want.delete(L.userData.slot);
      for (const m of want) { const L = lights.find((q) => !q.userData.slot); if (!L) break; L.userData.slot = m; L.userData.fade = 0; }
      const k = Math.min(1, (dt || 1 / 60) * 5);
      stats.assigned = 0;
      for (const L of lights) {
        const m = L.userData.slot, bm = m?.beam;
        if (!bm) { L.intensity = 0; continue; }
        const B = BEAMS[bm.kind] || BEAMS.blackout;
        L.userData.fade += (1 - L.userData.fade) * k;
        a.copy(bm.pos).setZ(bm.pos.z + 0.25); bm.obj.localToWorld(a);
        b.set(0, 0, bm.pos.z + B.d * 0.45); bm.obj.localToWorld(b); b.y -= bm.pos.y * 0.9;
        L.position.copy(a); L.target.position.copy(b); L.target.updateMatrixWorld();
        L.color.set(B.col); L.distance = B.d; L.angle = B.a; L.penumbra = B.pen;
        L.intensity = B.i * L.userData.fade;
        stats.assigned++;
      }
    },
    dispose() { group.removeFromParent(); for (const L of lights) L.dispose(); },
  };
  S.pool = pool;
  return pool;
}
/** The night headlamp light pool of the mission (tests / debug), or null. */
export const vehicleLampPool = () => S.pool;

/** Mission unload: dispose every live library vehicle + tickers (cached GLBs stay for the next mission). */
export function releaseVehicles() {
  S.pool?.dispose(); S.pool = null;
  for (const f of [...S.releasers]) { try { f(); } catch (e) { console.warn('[vehicles] release', e); } }
  for (const m of [...S.live]) m.dispose();
  S.live.clear(); S.tickers.clear(); S.releasers.clear(); S.zoom = 0;
}

const T_WATER = T.WATER, T_SHALLOW = T.SHALLOW, B_HIGH = B.HIGH;

/** Gun reach for the clipping rule: first muzzle relative to the turret / mount pivot (null until loaded). */
function gunInfo(vis, def, dims) {
  const meta = vis.meta;
  if (!meta || !(def.turret || def.kind === 'emplacement')) return null;
  const mz = meta.muzzles?.find((m) => m.caliber || /main|gun/.test(m.name)) || meta.muzzles?.[0];
  if (!mz) return null;
  const tur = meta.parts?.find((p) => /^(turret|turret_yaw|weapon_traverse|gun_yaw)$/.test(p.kind));
  const pv = tur?.pivot || [0, 0, 0];
  const len = Math.hypot(mz.pos[0] - pv[0], mz.pos[2] - pv[2]);
  if (def.turret) return { len, h: mz.pos[1], hl: dims.l * 0.18, hw: dims.w * 0.33, top: meta.height ?? dims.h };
  // emplacements: the mount's own reach behind the pivot (MG butt stock, breech) from its LOD0 geometry
  if (vis._gunBack === undefined && tur) {
    const node = vis.parts[tur.node];
    let back = 0;
    if (node) {
      const root = vis.object3d, inv = new THREE.Matrix4();
      root.updateMatrixWorld(true); inv.copy(root.matrixWorld).invert();
      const bb = new THREE.Box3(), m = new THREE.Matrix4();
      node.traverse((o) => { if (o.isMesh) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld))); } });
      if (!bb.isEmpty()) back = Math.max(0, pv[2] - bb.min.z);
    }
    vis._gunBack = +back.toFixed(2);
  }
  return { len, h: mz.pos[1], back: vis._gunBack ?? 0 };
}

/**
 * Opel Blitz canvas cover: the shared weld-safe cover model (cloth-wind.js `applyCanvasCover`: pin weights from the
 * hoops / bed rail, smoothed outward field so the rear panel and its roll stay on the cover, slow per-object phases)
 * and its own material per vehicle (library materials are shared by every instance; per-object wind uniforms need
 * their own). The cover is the canvas part that is ≥ 0.3 m tall and ≥ 1 m long along the vehicle (model +z = front),
 * measured in the vehicle's own frame (not the world: the heading at load time must not matter); the small canvas piece
 * behind the cab (1.7 m wide, 12 cm deep), seat cushions and straps stay put. Winter paint whitewashes the cover
 * (`kit:limewash_worn~<tint>`; the untinted `kit:limewash_worn` is the body paint and never matches).
 */
const CANVAS_MAT = /canvas|limewash_worn~/i;
function canvasFlap(root) {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3(), toLocal = new THREE.Matrix4(), inv = root.matrixWorld.clone().invert(), covers = [];
  root.traverse((o) => {
    if (!o.isMesh || !CANVAS_MAT.test(o.material?.name || '') || o.userData.ownCanvas) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(toLocal.multiplyMatrices(inv, o.matrixWorld)); // vehicle-local metres
    if (box.max.y - box.min.y < 0.3 || box.max.z - box.min.z < 1) return;
    covers.push(o);
  });
  for (const o of covers) { applyCanvasCover(o, { rear: -1 }); o.userData.ownCanvas = true; }
  return covers;
}

/**
 * The rear strap curtain of a covered lorry (art/strap-curtain.js): on the intact model's most detailed cover (LOD0),
 * the straps hanging in its rear opening replaced by chains men part as they climb over the tailgate. null when the
 * cover has no straps.
 */
function rearCurtain(root, covers) {
  const lod = (o) => { for (let p = o; p; p = p.parent) { const m = /_lod(\d+)$/.exec(p.name || ''); if (m) return +m[1]; } return 9; };
  const cover = covers.slice().sort((a, b) => lod(a) - lod(b) || b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
  if (!cover) return null;
  let inst = cover; while (inst.parent && inst.parent !== root) inst = inst.parent; // the instance root (model frame)
  try { return createStrapCurtain(inst, cover); } catch (e) { console.warn('[vehicles] strap curtain', e?.message || e); return null; }
}
