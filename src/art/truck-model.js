/**
 * Opel Blitz 3.6-36S trucks (ART integration 2, step 3): the baked Blender models in assets/models/vehicles/
 * (built by tools/blender/vehicles/truck.py) behind the art/vehicles.js model contract
 * (root, turret, dims, update(dt, vehicle), setTurretHeading, setDestroyed, dispose).
 *
 *   await prepareTruckArt(missionDef);             // game.loadMission: loads the theater paint + burnt wreck GLBs
 *   const m = createTruckModel('truck', spawn);    // null → the caller keeps the placeholder box model
 *
 * Paint follows the theater (desert → Afrika Korps RAL 8000 tan, everything else → RAL 7021 panzer grey) unless the
 * spawn says `paint: 'dak'|'grey'`. Cargo types get the canvas-bed body, the tanker types (opel_blitz_tanker /
 * fuel_truck) the Kfz. 385-style tank body on the same chassis. Wheels roll with the ground speed, the front pair
 * steers from the yaw rate (bicycle model); destroyed → the burnt wreck (with its ground scorch decal) replaces the
 * intact truck. Headlights (emissive lenses + an additive ground light pool, no real light → no shader recompiles)
 * are on at night while the truck is crewed, driven or moving. `?trucks=0` keeps the placeholders.
 * Only the browser loads GLBs: in node (unit tests) `prepareTruckArt` resolves false and callers use placeholders.
 * @module art/truck-model
 */

import * as THREE from 'three';
import { applyFlap } from './cloth-wind.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveLighting } from '../engine/lighting.js';

/** Canonical vehicle types (entities/vehicle.js) drawn with the Opel Blitz models. */
export const TRUCK_TYPES = new Set(['truck', 'opel_blitz', 'opel_blitz_tanker', 'fuel_truck']);
const TANKER_TYPES = new Set(['opel_blitz_tanker', 'fuel_truck']);
/** Wheel radius (m, tyre) and wheelbase (front → rear axle, m) of the model. */
export const TRUCK_WHEEL_R = 0.45;
export const TRUCK_WHEELBASE = 3.6;
const MAX_STEER = 0.55;
/** Headlamp lens centres in model space (x, y, z; +Z = forward). */
const LENS = [[-0.66, 1.23, 2.715], [0.66, 1.23, 2.715]];

const S = { ready: false, disabled: false, theater: 'temperate', night: false, base: 'assets/', loader: null,
  scenes: new Map(), pending: new Map(), shared: null };

/** False with `?trucks=0` in the page URL. */
export function trucksEnabled() {
  try { return !/[?&]trucks=0(&|$)/.test(globalThis.location?.search || ''); } catch { return true; }
}

/** Paint scheme for a theater / spawn: 'dak' (desert tan) or 'grey' (panzer grey). */
export function truckPaint(theater, spawn = null) {
  if (spawn?.paint === 'dak' || spawn?.paint === 'grey') return spawn.paint;
  return theater === 'desert' ? 'dak' : 'grey';
}

/** GLB base name for a truck type + paint (+ burnt). */
export function truckAsset(type, paint, burnt = false) {
  const tank = TANKER_TYPES.has(type) ? '_tanker' : '';
  return `truck_${burnt ? 'burnt' : paint}${tank}`;
}

/**
 * The GLBs a mission needs: for every truck-type vehicle (mission `vehicles`, `extraction` / scripted spawns — any
 * object with a truck `vehicleType`, plus vehicles without one, which default to 'truck') its paint + burnt body.
 * @param {object} def mission definition @returns {string[]} asset base names
 */
export function missionTruckAssets(def) {
  const theater = def?.theater || 'temperate';
  const out = new Set();
  const visit = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { for (const x of o) visit(x, depth + 1); return; }
    const t = o.vehicleType;
    if (typeof t === 'string' && TRUCK_TYPES.has(t)) {
      out.add(truckAsset(t, truckPaint(theater, o)));
      out.add(truckAsset(t, null, true));
    }
    for (const k in o) if (k !== 'vehicleType' && o[k] && typeof o[k] === 'object') visit(o[k], depth + 1);
  };
  visit(def, 0);
  for (const v of def?.vehicles || []) {
    if (v && !v.vehicleType) { out.add(truckAsset('truck', truckPaint(theater, v))); out.add(truckAsset('truck', null, true)); }
  }
  return [...out].sort();
}

/** Is the model `name` in memory? */
export const truckLoaded = (name) => S.scenes.has(name);
/** Current truck context (tests / debug). */
export const truckContext = () => ({ ready: S.ready, disabled: S.disabled, theater: S.theater, night: S.night, loaded: [...S.scenes.keys()] });

function prepScene(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (/scorch/i.test(o.name) || o.material?.transparent) { // burnt wreck ground decal: no shadows, drawn after terrain
      o.castShadow = false; o.receiveShadow = false; o.renderOrder = 2;
      const m = o.material;
      m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    } else { o.castShadow = true; o.receiveShadow = true; }
    if (/_2sided$/.test(o.material?.name || '') && !o.geometry.attributes.aFlap) canvasFlap(o); // step 4w: cargo cover
  });
  return scene;
}

/** Canvas cover flap weights (bed rail and hoops fixed, bays between the 4 hoops and the rear flap free). */
function canvasFlap(o) {
  const g = o.geometry, P = g.attributes.position;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox, H = Math.max(bb.max.y - bb.min.y, 0.1), L = Math.max(bb.max.z - bb.min.z, 0.1);
  const F = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const yr = (P.getY(i) - bb.min.y) / H, zr = (P.getZ(i) - bb.min.z) / L;
    const wy = Math.min(1, Math.max(0, yr / 0.2)), bay = Math.abs(Math.sin(Math.PI * zr * 4));
    F[i] = zr < 0.05 ? wy : wy * (0.25 + 0.6 * bay) * 0.85;
  }
  g.setAttribute('aFlap', new THREE.BufferAttribute(F, 1));
  applyFlap(o.material);
}

function loadAsset(name) {
  if (S.scenes.has(name)) return Promise.resolve(S.scenes.get(name));
  if (S.pending.has(name)) return S.pending.get(name);
  const p = S.loader.loadAsync(`${S.base}models/vehicles/${name}.glb`)
    .then((g) => { S.scenes.set(name, prepScene(g.scene)); return g.scene; })
    .catch((e) => { console.warn(`[trucks] ${name} failed`, e); return null; })
    .finally(() => S.pending.delete(name));
  S.pending.set(name, p);
  return p;
}

/**
 * Per-mission setup: theater + night flag, then load the mission's truck GLBs (cached across missions).
 * @param {object} def mission definition @param {{assets?: object, base?: string, enabled?: boolean}} [o]
 * @returns {Promise<boolean>} true when the real models are available
 */
export async function prepareTruckArt(def, o = {}) {
  S.theater = def?.theater || 'temperate';
  try { S.night = !!resolveLighting(S.theater, def?.lighting || null)?.night; } catch { S.night = S.theater === 'night'; }
  if (typeof fetch !== 'function' || typeof document === 'undefined') return (S.ready = false);
  S.disabled = o.enabled === false || !trucksEnabled();
  if (S.disabled) return (S.ready = false);
  S.base = o.base ?? o.assets?.manifest?.base ?? 'assets/';
  S.loader ||= new GLTFLoader(o.assets?.manager);
  await Promise.all(missionTruckAssets(def).map(loadAsset));
  S.ready = true;
  return true;
}

/** Shared headlight resources (one lens material, one light-pool texture/material/geometry for every truck). */
function shared() {
  if (S.shared) return S.shared;
  const W = 64, H = 128, data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const t = j / (H - 1);                                  // 0 at the bumper → 1 at the far end
    const half = 0.12 + 0.38 * t;                           // beam widens with distance
    const along = Math.min(1, t / 0.08) * Math.pow(1 - t, 1.6);
    for (let i = 0; i < W; i++) {
      const u = Math.abs(i / (W - 1) - 0.5);
      const across = Math.max(0, 1 - (u / half) ** 2);
      const v = Math.round(255 * along * across * across);
      const k = (j * W + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = v; data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const poolMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.0, 0.84, 0.58).multiplyScalar(0.7),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const poolGeo = new THREE.PlaneGeometry(6.5, 13).rotateX(-Math.PI / 2);
  // texture v runs bottom (v=0) → top; after rotateX(-90°) v=0 is at +Z: flip so the bright end sits at the bumper
  const uv = poolGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const lensOn = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: new THREE.Color(1.0, 0.9, 0.7), emissiveIntensity: 6, roughness: 0.2 });
  const lensGeo = new THREE.CircleGeometry(0.095, 16);
  return (S.shared = { poolMat, poolGeo, lensOn, lensGeo });
}

function makeHeadlights() {
  const sh = shared();
  const g = new THREE.Group();
  g.name = 'headlights';
  for (const [x, y, z] of LENS) {
    const l = new THREE.Mesh(sh.lensGeo, sh.lensOn);
    l.position.set(x, y, z);
    g.add(l);
  }
  const pool = new THREE.Mesh(sh.poolGeo, sh.poolMat);
  pool.position.set(0, 0.06, 3.0 + 6.5);
  pool.renderOrder = 3;
  g.add(pool);
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  g.visible = false;
  return g;
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _qs = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0), _ay = new THREE.Vector3(0, 1, 0);

/** Wheel nodes of a cloned truck scene: {node, q0 (authored rotation), front}. */
function wheelsOf(scene) {
  const out = [];
  scene.traverse((o) => { if (/^wheel_[FR][LR]/.test(o.name)) out.push({ node: o, q0: o.quaternion.clone(), front: o.name[6] === 'F' }); });
  return out;
}

/**
 * Real Opel Blitz model for a truck-type vehicle, or null (library not loaded / disabled / not a truck type) → the
 * caller keeps the placeholder. Geometry, materials and textures are shared with the cached GLTF scene.
 * @param {string} type canonical vehicle type @param {object} [spawn] mission spawn (paint override)
 */
export function createTruckModel(type, spawn = {}) {
  if (!S.ready || S.disabled || !TRUCK_TYPES.has(type)) return null;
  const paint = truckPaint(S.theater, spawn);
  const src = S.scenes.get(truckAsset(type, paint));
  if (!src) return null;
  const root = new THREE.Group();
  root.name = `vehicle:${type}`;
  root.userData.truck = truckAsset(type, paint);
  const intact = src.clone(true);
  root.add(intact);
  const wheels = wheelsOf(intact);
  const lights = makeHeadlights();
  intact.add(lights);
  let wreck = null, destroyed = false, spin = 0, steer = 0, lastHeading = null;
  const dims = { w: 2.39, l: 6.2, h: 2.86, truck: true, paint };
  return {
    root, turret: null, dims,
    /** @param {number} dt @param {object} [v] the Vehicle (speed m/s, heading rad, driver, crew) */
    update(dt, v) {
      if (destroyed || !(dt > 0)) return;
      const speed = v?.speed ?? 0;
      const sgn = v?.reversing ? -1 : 1;
      spin = (spin + (sgn * speed * dt) / TRUCK_WHEEL_R) % (Math.PI * 2);
      let target = 0;
      if (v && Number.isFinite(v.heading)) {
        if (lastHeading != null && speed > 0.3) {
          const rotYRate = -wrapPi(v.heading - lastHeading) / dt;              // headingToRotY = π/2 − h
          target = Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.atan((TRUCK_WHEELBASE * rotYRate) / (sgn * speed))));
        }
        lastHeading = v.heading;
      }
      steer += (target - steer) * Math.min(1, dt * 6);
      _qx.setFromAxisAngle(_ax, spin);
      for (const w of wheels) {
        _qs.setFromAxisAngle(_ay, w.front ? steer : 0);
        w.node.quaternion.copy(_qs).multiply(_qx).multiply(w.q0);
      }
      const crewed = !!v?.driver || (v?.crew || []).some((c) => c?.alive !== false);
      lights.visible = S.night && (crewed || speed > 0.1);
    },
    setTurretHeading() {},
    setDestroyed(on) {
      destroyed = !!on;
      if (destroyed && !wreck) {
        const b = S.scenes.get(truckAsset(type, null, true));
        if (b) { wreck = b.clone(true); root.add(wreck); }
      }
      intact.visible = !destroyed || !wreck;
      if (wreck) wreck.visible = destroyed;
      if (destroyed) lights.visible = false;
      if (destroyed && !wreck) intact.traverse((o) => { // no wreck model loaded: char the intact one (own material copies)
        if (!o.isMesh || o.userData.charred) return;
        o.material = o.material.clone(); o.material.color.multiplyScalar(0.18); o.userData.charred = true;
      });
    },
    dispose() {
      intact.traverse((o) => { if (o.userData.charred) o.material.dispose(); });
      root.clear();
    },
  };
}

/** Test hook: forget loaded scenes and context (node). */
export function _resetTrucks() { S.ready = false; S.disabled = false; S.theater = 'temperate'; S.night = false; S.scenes.clear(); S.pending.clear(); }

/** Test hook: register an already-built scene under an asset name (node tests without GLB loading). */
export function _registerTruckScene(name, scene, ctx = null) {
  S.scenes.set(name, prepScene(scene)); S.ready = true; S.disabled = false;
  if (ctx) { S.theater = ctx.theater ?? 'temperate'; S.night = !!ctx.night; }
}
