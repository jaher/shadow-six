/**
 * Vehicle library — the realistic scripted-Blender vehicles (tools/blender/vehicles) behind the vehicle registry
 * (entities/vehicle.js). Owned by ART; vehicle.js is not wired to it yet (the integration step does that).
 *
 *   await loadVehicleLibrary(assets, { preload: ['kubelwagen', 'panzer4'], theater: 'desert' });
 *   const v = createVehicleVisual('kubelwagen', { theater: 'desert', seed: 7, destroyed: false });
 *   scene.add(v.object3d);                 // ground-centre pivot, front = +Z (rotation.y = heading like other models)
 *   v.update(dt, { speed, steer, turretYaw, gunPitch, engine: true });   // wheels, steering, tracks, props, rods
 *   v.sockets.seat_driver.object           // crew/passenger/exit anchors (Object3D, follow turrets/doors)
 *   v.emitters / v.contacts / v.muzzles / v.lights   // {kind|name, object, dir, …} for VFX + terrain trails
 *   v.setPart('door_fl', 1); v.setDestroyed(true);    // open a door; swap to the burnt wreck (lazy-loaded)
 *   setVehicleZoom(camera.zoom);          // LOD0 at zoom >= manifest.lodPolicy.lod0MinZoom, else LOD2
 *
 * Data: assets/models/vehicles/manifest.json — types (registry names → assets), assets (paint variants by theater,
 * destroyed model, texture swaps), models (LOD files + per-model sidecar <group>/<model>.json with parts, sockets,
 * muzzles, emitters, lights, contacts, tracks). GLBs are meshopt-compressed; they reference the shared texture
 * library (assets/textures/lib/1k) and, for armour, per-asset atlases (models/vehicles/armour/tex) whose paint
 * variant is picked by rewriting '_grey_' → '_<paint>_' in texture URLs. Model space: +x = vehicle LEFT, y up,
 * +z = front, metres. Only the browser loads GLBs: in node (unit tests) createVehicleVisual returns an empty group.
 * @module art/vehicle-library
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const DEG = Math.PI / 180;
const YAW_KINDS = new Set(['turret', 'turret_yaw', 'gun_yaw', 'weapon_traverse', 'gun_yaw_pitch']);
const PITCH_KINDS = new Set(['gun', 'gun_pitch', 'weapon_elev']);
const SPIN_KINDS = new Set(['prop', 'propeller', 'rotor']);
const WHEEL_KINDS = new Set(['wheel', 'wheel_free']);

const V = {
  manifest: null, base: 'assets/', manager: null, loaders: new Map(), gltf: new Map(), meta: new Map(),
  pending: new Map(), texCache: new Map(), live: new Set(), zoom: 1, quality: 'default',
};

/** GLTFLoader plugin: one Texture per external image URL across every vehicle GLB (shared lib + armour atlases). */
class SharedTextures {
  constructor(parser) { this.parser = parser; this.name = 'SHADOW_vehicle_shared_textures'; }
  loadTexture(index) {
    const json = this.parser.json, def = json.textures[index];
    const img = def && json.images[def.source];
    if (!img || !img.uri) return null; // embedded AO: default path
    const mgr = this.parser.options.manager;
    const url = new URL(img.uri, new URL(this.parser.options.path || '', globalThis.location?.href ?? 'http://localhost/')).href;
    const key = `${mgr ? mgr.resolveURL(url) : url}|${def.sampler ?? -1}`;
    if (!V.texCache.has(key)) V.texCache.set(key, this.parser.loadTextureImage(index, def.source, this.parser.textureLoader));
    return V.texCache.get(key);
  }
}

/** A GLTFLoader whose LoadingManager rewrites texture URLs for an armour paint swap (null = none). */
function loaderFor(swap) {
  const key = swap ? swap.join('>') : '';
  if (V.loaders.has(key)) return V.loaders.get(key);
  const mgr = new THREE.LoadingManager();
  if (V.manager?.onError) mgr.onError = V.manager.onError;
  mgr.setURLModifier((u) => (/\.(jpe?g|png|webp)(\?|$)/i.test(u) ? libTexture(swap ? u.split(swap[0]).join(swap[1]) : u) : u));
  const l = new GLTFLoader(mgr);
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register((parser) => new SharedTextures(parser));
  V.loaders.set(key, l);
  return l;
}

/**
 * Shared-library texture URL: byte-identical maps removed from textures/lib/1k resolve to their survivor
 * (manifest textures.aliases), and the 'low' quality preset fetches the 512 set (setVehicleTextureQuality).
 */
function libTexture(u) {
  const T = V.manifest?.textures;
  if (!T || !/\/textures\/lib\/1k\//.test(u)) return u;
  const name = u.slice(u.lastIndexOf('/') + 1).split('?')[0];
  const kept = T.aliases?.[name];
  let out = kept ? u.slice(0, u.lastIndexOf('/') + 1) + kept : u;
  if (V.quality === 'low' && T.low) out = out.replace('/textures/lib/1k/', `/textures/lib/${T.low}/`);
  return out;
}

/** Texture set for the next loads: 'low' → the 512 library maps (the engine 'low' preset), else 1k. */
export function setVehicleTextureQuality(q) { V.quality = q === 'low' ? 'low' : 'default'; }

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Load the manifest and (optionally) preload vehicles.
 * @param {object|null} assets engine Assets (its LoadingManager + base URL), or null
 * @param {{base?: string, manifest?: object, preload?: string[]|'all', theater?: string, destroyed?: boolean,
 *   lods?: number[], onProgress?: (done:number,total:number)=>void}} [opts] preload = registry types or asset names
 */
export async function loadVehicleLibrary(assets = null, opts = {}) {
  V.base = opts.base ?? assets?.manifest?.base ?? 'assets/';
  V.manager = assets?.manager || null;
  if (opts.manifest) V.manifest = opts.manifest;
  if (!V.manifest) {
    const res = await fetch(`${V.base}models/vehicles/manifest.json`);
    if (!res.ok) throw new Error(`[vehicle-library] manifest ${res.status}`);
    V.manifest = await res.json();
  }
  const api = { manifest: V.manifest, preload: (list, theater) => preloadVehicles(list, { theater, lods: opts.lods, onProgress: opts.onProgress }) };
  if (opts.preload) await api.preload(opts.preload === 'all' ? Object.keys(V.manifest.types) : opts.preload, opts.theater);
  return api;
}

/** True once the manifest is loaded. */
export const vehicleLibraryReady = () => !!V.manifest;

/** Registry types and asset names the library can draw. */
export function vehicleTypes() {
  return V.manifest ? [...Object.keys(V.manifest.types), ...Object.keys(V.manifest.assets)] : [];
}

/** Theater key ('temperate' | 'desert' | 'snow') for any mission theater string. */
export function theaterKey(theater) {
  return V.manifest?.theaters?.[theater] || (theater === 'desert' ? 'desert' : /snow|winter/.test(theater || '') ? 'snow' : 'temperate');
}

function hash(seed, salt = 0) {
  let h = (Number(seed) || 0) * 2654435761 + salt * 40503;
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Pick asset + model for a type (registry name, alias or asset name).
 * @param {{theater?: string, seed?: number, destroyed?: boolean, asset?: string, paint?: string}} [o]
 * @returns {{type: string|null, asset: string, paint: string, model: string, swap: string[]|null,
 *   wreck: string|null, wreckSwap: null}|null}
 */
export function resolveVehicle(type, o = {}) {
  const M = V.manifest;
  if (!M) throw new Error('[vehicle-library] call loadVehicleLibrary() first');
  const T = M.types[type];
  let asset = o.asset && M.assets[o.asset] ? o.asset : T ? T.assets[0] : M.assets[type] ? type : null;
  if (!asset) return null;
  const A = M.assets[asset];
  let paint = o.paint && A.variants[o.paint] ? o.paint : T?.paint && A.variants[T.paint] ? T.paint : A.byTheater[theaterKey(o.theater)];
  if (T?.pool && !o.paint) { // seed picks among same-paint dressings (e.g. grey / grey_top)
    const pool = Object.keys(A.variants).filter((k) => k === paint || k.startsWith(paint + '_'));
    paint = pool[Math.floor(hash(o.seed, 3) * pool.length)] || paint;
  }
  const model = A.variants[paint] || Object.values(A.variants)[0];
  const swap = A.texture_swap?.[paint] || null;
  return { type: T ? type : null, asset, paint, model, swap, wreck: A.destroyed || null };
}

/** Sidecar (parts, sockets, emitters, …) of a model. */
function loadMeta(model) {
  if (V.meta.has(model)) return V.meta.get(model);
  const p = fetch(V.base + 'models/vehicles/' + V.manifest.models[model].meta).then((r) => (r.ok ? r.json() : null))
    .catch(() => null).then((m) => { V.meta.set(model, m); return m; });
  V.meta.set(model, p);
  return p;
}

/** LOD scene (shared; instances clone it). Missing LODs (LOD1 is not shipped) resolve to null. */
function loadLod(model, i, swap) {
  const key = `${model}#${i}#${swap ? swap[1] : ''}`;
  if (V.gltf.has(key)) return Promise.resolve(V.gltf.get(key));
  if (V.pending.has(key)) return V.pending.get(key);
  const file = V.manifest.models[model]?.lods[i];
  if (!file || !isBrowser()) { V.gltf.set(key, null); return Promise.resolve(null); }
  const url = V.base + 'models/vehicles/' + file;
  const p = loaderFor(swap).loadAsync(url).then((g) => {
    prepareScene(g.scene);
    V.gltf.set(key, g.scene); V.pending.delete(key);
    return g.scene;
  }).catch((e) => {
    console.warn(`[vehicle-library] ${url} failed:`, e?.message || e);
    V.pending.delete(key); V.gltf.set(key, null); return null;
  });
  V.pending.set(key, p);
  return p;
}

const shippedLods = (model) => (V.manifest.models[model]?.lods || []).map((f, i) => (f ? i : -1)).filter((i) => i >= 0);

/** Load every shipped LOD + the sidecar of a model (and its wreck when asked). */
async function loadModel(model, swap, lods = null) {
  await Promise.all([loadMeta(model), ...(lods || shippedLods(model)).map((i) => loadLod(model, i, swap))]);
}

/**
 * Preload types / asset names for a theater (their paint + wreck).
 * @param {string[]} list @param {{theater?: string, lods?: number[], destroyed?: boolean, onProgress?: Function}} [o]
 */
export async function preloadVehicles(list, { theater, lods, destroyed = true, onProgress } = {}) {
  const jobs = [];
  for (const t of list) {
    const T = V.manifest.types[t];
    for (const a of T ? (T.consist || [T.assets[0]]) : [t]) {
      const r = resolveVehicle(a, { theater, paint: T?.paint });
      if (!r) continue;
      jobs.push(loadModel(r.model, r.swap, lods));
      if (destroyed && r.wreck) jobs.push(loadModel(r.wreck, null, lods));
    }
  }
  let done = 0;
  await Promise.all(jobs.map((j) => j.then(() => onProgress?.(++done, jobs.length))));
}

/** Shadows, anisotropy, alpha-feathered aprons (vertex alpha), glass. Runs once per loaded GLB. */
function prepareScene(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (o.geometry.attributes.color && o.geometry.attributes.color.itemSize === 4 && m.vertexColors && m.transparent) m.depthWrite = false;
      if (m.transparent) o.castShadow = !/glass|lens/i.test(m.name);
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) m[k].anisotropy = 4;
    }
  });
}

/** LOD index for a zoom among the shipped LODs. */
function lodForZoom(model, zoom) {
  const avail = shippedLods(model);
  const want = zoom >= (V.manifest.lodPolicy?.lod0MinZoom ?? 0.75) ? 0 : 2;
  return avail.reduce((b, i) => (Math.abs(i - want) < Math.abs(b - want) ? i : b), avail[0] ?? 0);
}

/** LOD switch for every live vehicle (orthographic camera: by zoom, not distance). */
export function setVehicleZoom(zoom) {
  V.zoom = zoom;
  for (const h of V.live) h.setZoom(zoom);
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Per-instance track materials (UV scroll must not leak to other vehicles). */
function ownTrackMaterials(node, out) {
  node.traverse((o) => {
    if (!o.isMesh) return;
    const one = (m) => {
      const c = m.clone();
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (c[k]) { c[k] = c[k].clone(); out.push(c[k]); }
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
}

/** Anchor Object3D at a model-space point, +Z along `dir`, parented to the named node so it follows it. */
function anchor(root, lod0, def) {
  const o = new THREE.Object3D();
  o.name = def.name || def.kind || 'anchor';
  o.position.fromArray(def.pos || [0, 0, 0]);
  if (def.dir && (def.dir[0] || def.dir[1] || def.dir[2])) o.lookAt(_v.fromArray(def.pos || [0, 0, 0]).add(vec(def.dir)));
  root.add(o);
  const n = def.node && lod0?.getObjectByName(def.node);
  if (n) { root.updateMatrixWorld(true); n.attach(o); }
  return o;
}

/** Build one model instance: LOD clones in a group, part table, anchors. */
function buildInstance(model, swap, meta) {
  const root = new THREE.Group(); root.name = model;
  const lods = new Map();
  for (const i of shippedLods(model)) {
    const src = V.gltf.get(`${model}#${i}#${swap ? swap[1] : ''}`);
    if (!src) continue;
    const c = src.clone(true); c.name = `${model}_lod${i}`; c.visible = false;
    root.add(c); lods.set(i, c);
  }
  const lod0 = lods.get(0) || lods.values().next().value || null;
  const parts = new Map(), texs = [], wheels = [];
  for (const def of meta?.parts || []) {
    const nodes = [...lods.values()].map((l) => l.getObjectByName(def.node)).filter(Boolean);
    if (!nodes.length) continue; // e.g. a wreck without its dropped gun
    const p = { def, nodes, rest: nodes.map((n) => ({ p: n.position.clone(), q: n.quaternion.clone() })),
      axis: vec(def.axis || [1, 0, 0]).normalize(), angle: 0, steer: 0, value: 0 };
    parts.set(def.node, p);
    if (WHEEL_KINDS.has(def.kind)) wheels.push(p);
  }
  const tracks = [];
  for (const t of meta?.tracks || []) {
    const out = [];
    for (const l of lods.values()) { const n = l.getObjectByName(t.node); if (n) ownTrackMaterials(n, out); }
    tracks.push({ def: t, texs: out, offset: 0 });
  }
  const mk = (list) => (list || []).map((d) => ({ ...d, object: anchor(root, lod0, d) }));
  const sockets = {};
  for (const s of mk(meta?.sockets)) sockets[s.name] = s;
  return { model, root, lods, parts, wheels, tracks, texs, meta, sockets, muzzles: mk(meta?.muzzles),
    emitters: mk(meta?.emitters), lights: mk(meta?.lights), contacts: mk(meta?.contacts), odo: 0, lod: -1 };
}

/** Write a part pose to every LOD node: rest ∘ extra rotation, rest + model-space offset. */
function pose(p, q = null, off = null) {
  p.nodes.forEach((n, k) => {
    const r = p.rest[k];
    n.quaternion.copy(r.q); if (q) n.quaternion.multiply(q);
    n.position.copy(r.p); if (off) n.position.add(off);
  });
}

const lim = (d, x) => (d.limits_deg ? Math.min(d.limits_deg[1] * DEG, Math.max(d.limits_deg[0] * DEG, x)) : x);
const openLimit = (d) => (d.limits_deg ? (Math.abs(d.limits_deg[1]) >= Math.abs(d.limits_deg[0]) ? d.limits_deg[1] : d.limits_deg[0]) * DEG : Math.PI / 2);

/** Door/hatch/flap/slide … to fraction t (0 = rest, 1 = fully open / deployed). */
function setPartValue(p, t) {
  const d = p.def; p.value = t;
  const travel = d.travel_m ?? d.raise_m;
  if (/slide/.test(d.kind) || travel != null) {
    const m = d.translate_m ? vec(d.translate_m) : p.axis.clone().multiplyScalar(travel ?? 0.5);
    pose(p, null, m.multiplyScalar(t));
  } else pose(p, _q.setFromAxisAngle(p.axis, openLimit(d) * t));
}

/** Locomotive valve gear: coupling rods orbit the driving crank, main rods + crossheads follow, links rock. */
function driveRods(inst) {
  const side = {};
  for (const p of inst.parts.values()) {
    const d = p.def;
    if (!d.axle && d.kind !== 'crosshead' && d.kind !== 'expansion_link') continue;
    const s = d.node.slice(-2);
    let w = inst.crank;
    if (!w) { // driving wheel = the wheelset whose pivot is on the crank axle
      const ax = inst.parts.values().next().value && [...inst.parts.values()].find((q) => q.def.axle)?.def.axle;
      w = inst.crank = ax && inst.wheels.reduce((b, q) => { const e = Math.hypot(q.def.pivot[1] - ax[1], q.def.pivot[2] - ax[2]); return !b || e < b.e ? { p: q, e } : b; }, null)?.p;
      if (!w) return;
    }
    const a = w.angle;
    if (d.kind === 'rod_coupling' || d.kind === 'rod_main') {
      const c0y = d.pivot[1] - d.axle[1], c0z = d.pivot[2] - d.axle[2];
      const cy = c0y * Math.cos(a) - c0z * Math.sin(a), cz = c0y * Math.sin(a) + c0z * Math.cos(a);
      const off = new THREE.Vector3(0, cy - c0y, cz - c0z);
      if (d.kind === 'rod_coupling') { pose(p, null, off); continue; }
      const by = d.pivot[1] + off.y, bz = d.pivot[2] + off.z, se = d.small_end, L = d.length;
      const dir = Math.sign(se[2] - d.pivot[2]) || 1;
      const zs = bz + dir * Math.sqrt(Math.max(0, L * L - (se[1] - by) ** 2));
      const psi0 = Math.atan2(se[1] - d.pivot[1], se[2] - d.pivot[2]), psi1 = Math.atan2(se[1] - by, zs - bz);
      pose(p, _q.setFromAxisAngle(p.axis, (psi0 - psi1) * Math.sign(p.axis.x || 1)), off);
      side[s] = zs - se[2];
    } else if (d.kind === 'expansion_link') {
      pose(p, _q.setFromAxisAngle(p.axis, (d.limits_deg?.[1] ?? 14) * DEG * -Math.sin(a)));
    }
  }
  for (const p of inst.parts.values()) if (p.def.kind === 'crosshead' && side[p.def.node.slice(-2)] != null) pose(p, null, _v.set(0, 0, side[p.def.node.slice(-2)]));
}

/**
 * Advance moving parts. o.speed m/s (signed, + = forward), o.steer -1..1 (+ = left), o.turretYaw / o.gunPitch rad
 * (+ = left / up; parts clamp to their limits), o.engine (props idle/spin), o.rpm override, o.yawRate rad/s (tracks).
 */
function drive(inst, dt, o) {
  const dist = (o.speed || 0) * dt; inst.odo += dist;
  const steer = Math.max(-1, Math.min(1, o.steer || 0)), arm = inst.meta?.group === 'armour';
  for (const p of inst.parts.values()) {
    const d = p.def, k = d.kind;
    if (WHEEL_KINDS.has(k)) {
      p.angle += dist / (d.radius || 0.4);
      const st = d.steer ? steer * (d.steer_limits_deg?.[1] ?? 30) * DEG : 0;
      _q.setFromAxisAngle(p.axis, p.angle);
      if (st) _q.premultiply(_q2.setFromAxisAngle(_Y, st));
      pose(p, _q);
    } else if (k === 'steer' || k === 'steering_wheel') {
      const max = k === 'steering_wheel' ? (d.limits_deg?.[1] ?? 540) * DEG : openLimit(d) || 30 * DEG;
      pose(p, _q.setFromAxisAngle(p.axis, steer * Math.abs(max) * (d.steer_ratio ?? 1)));
    } else if (YAW_KINDS.has(k) && o.turretYaw != null) {
      _q.setFromAxisAngle(p.axis, lim(d, o.turretYaw));
      if (k === 'gun_yaw_pitch' && o.gunPitch != null && d.pitch_axis) {
        const pl = d.pitch_limits || [-90, 90];
        _q.multiply(_q2.setFromAxisAngle(vec(d.pitch_axis).normalize(), Math.min(pl[1] * DEG, Math.max(pl[0] * DEG, o.gunPitch))));
      }
      pose(p, _q);
    } else if (PITCH_KINDS.has(k) && o.gunPitch != null) {
      pose(p, _q.setFromAxisAngle(p.axis, (arm ? -1 : 1) * lim(d, o.gunPitch)));
    } else if (SPIN_KINDS.has(k)) {
      const rpm = o.rpm ?? (o.engine ? ((o.speed || 0) !== 0 ? d.rpm_max ?? d.rpm_flight ?? 1200 : d.rpm_idle ?? 600) : 0);
      p.angle += (rpm / 60) * 2 * Math.PI * dt;
      pose(p, _q.setFromAxisAngle(p.axis, p.angle));
    }
  }
  for (const t of inst.tracks) { // belt texture scroll; differential when turning on the spot
    const dd = dist - (o.yawRate || 0) * dt * (t.def.x || 0);
    t.offset += (t.def.v_per_m || 1) * dd;
    const off = (o.speed || o.yawRate) ? t.offset : Math.round(t.offset / (t.def.snap || 1e-9)) * (t.def.snap || 0) || t.offset;
    for (const tx of t.texs) tx.offset.y = off;
  }
  if (inst.meta?.group === 'rail') driveRods(inst);
}

/**
 * Create a vehicle visual. Returns at once; `ready` resolves when the GLBs are in (instant when preloaded).
 * @param {string} type registry type ('kubelwagen', 'panzer4', 'train', …), alias or asset name ('panzer3_l')
 * @param {{theater?: string, seed?: number, destroyed?: boolean, asset?: string, paint?: string}} [opts]
 * @returns {{object3d: THREE.Group, ready: Promise<any>, type: string, asset: string, paint: string,
 *   parts: Object<string, THREE.Object3D>, sockets: object, emitters: object[], contacts: object[], muzzles: object[],
 *   lights: object[], meta: object|null, destroyed: boolean, setDestroyed: (on?: boolean) => Promise<void>,
 *   setPart: (name: string, t: number) => void, setToggle: (name: string, on: boolean) => void,
 *   update: (dt: number, o?: object) => void, setZoom: (z: number) => void, dispose: () => void}|null}
 */
export function createVehicleVisual(type, opts = {}) {
  if (!V.manifest) throw new Error('[vehicle-library] call loadVehicleLibrary() first');
  const T = V.manifest.types[type];
  if (T?.consist && !opts.asset) return createConsist(type, T, opts);
  const r = resolveVehicle(type, opts);
  if (!r) return null;
  const object3d = new THREE.Group(); object3d.name = `vehicle:${r.asset}`;
  const S = { intact: null, wreck: null, cur: null, destroyed: false, zoom: V.zoom, last: {} };
  const empty = { parts: new Map(), sockets: {}, emitters: [], contacts: [], muzzles: [], lights: [], meta: null };
  const inst = () => S.cur || empty;
  const show = () => {
    for (const x of [S.intact, S.wreck]) if (x) x.root.visible = x === S.cur;
    const c = S.cur; if (!c) return;
    const want = lodForZoom(c.model, S.zoom);
    if (c.lod !== want) { for (const [i, l] of c.lods) l.visible = i === want; c.lod = want; }
  };
  const make = async (model, swap) => {
    await loadModel(model, swap);
    const x = buildInstance(model, swap, V.meta.get(model));
    object3d.add(x.root);
    return x;
  };
  const h = {
    object3d, type: r.type || type, asset: r.asset, paint: r.paint, model: r.model,
    get parts() { const o = {}; for (const [k, p] of inst().parts) o[k] = p.nodes[0]; return o; },
    get sockets() { return inst().sockets; }, get emitters() { return inst().emitters; },
    get contacts() { return inst().contacts; }, get muzzles() { return inst().muzzles; },
    get lights() { return inst().lights; }, get meta() { return inst().meta; }, get destroyed() { return S.destroyed; },
    async setDestroyed(on = true) {
      S.destroyed = on;
      if (on && r.wreck) { if (!S.wreck) S.wreck = await make(r.wreck, null); if (S.destroyed) S.cur = S.wreck; }
      else if (!on) S.cur = S.intact;
      show();
    },
    setPart(name, t) { const p = inst().parts.get(name); if (p) setPartValue(p, t); },
    /**
     * Pose a part on every LOD: its rest rotation ∘ `q` (null = rest), moved by the model-space offset `off` (null =
     * at its pivot). Crew rigs: the raft's stowed paddle (art/boat-crew.js).
     */
    posePart(name, q = null, off = null) { const p = inst().parts.get(name); if (p) pose(p, q, off); },
    /** Show / hide a part on every LOD (a paddle taken in hand). */
    showPart(name, on) { const p = inst().parts.get(name); if (p) for (const n of p.nodes) n.visible = !!on; },
    setToggle(name, on) {
      const tg = inst().meta?.toggles?.[name];
      const nodes = tg?.node ? [tg.node] : Array.isArray(tg?.nodes) ? [...inst().parts.keys()].filter((k) => tg.nodes.some((s) => s.startsWith(k.split('_')[0] + '_'))) : [name];
      for (const n of nodes) {
        const p = inst().parts.get(n);
        if (p && tg?.translate_m) pose(p, null, vec(tg.translate_m).multiplyScalar(on ? 1 : 0));
        else if (p) setPartValue(p, on ? 1 : 0);
        else for (const l of inst().lods?.values() || []) { const o = l.getObjectByName(n); if (o) o.visible = on; }
      }
    },
    update(dt, o = {}) { S.last = o; if (S.cur && S.cur === S.intact) drive(S.cur, dt, o); },
    setZoom(z) { S.zoom = z; show(); },
    dispose() { V.live.delete(h); object3d.removeFromParent(); for (const x of [S.intact, S.wreck]) x?.tracks.forEach((t) => t.texs.forEach((tx) => tx.dispose())); },
  };
  h.ready = (async () => {
    S.intact = await make(r.model, r.swap);
    S.cur = S.intact;
    if (opts.destroyed) await h.setDestroyed(true); else show();
    return h;
  })();
  V.live.add(h);
  return h;
}

/** Train: locomotive + tender + cars along -z, buffers touching. update()/setZoom forward to every car. */
function createConsist(type, T, opts) {
  const object3d = new THREE.Group(); object3d.name = `vehicle:${type}`;
  const cars = (opts.consist || T.consist).map((a, i) => createVehicleVisual(a, { ...opts, asset: a, seed: (opts.seed || 0) + i }));
  for (const c of cars) object3d.add(c.object3d);
  const h = {
    object3d, type, asset: T.consist[0], model: T.consist[0], paint: null, cars, get parts() { return cars[0].parts; }, get sockets() { return cars[0].sockets; },
    get emitters() { return cars.flatMap((c) => c.emitters); }, get contacts() { return cars.flatMap((c) => c.contacts); },
    get muzzles() { return []; }, get lights() { return cars[0].lights; }, get meta() { return cars[0].meta; },
    setDestroyed: (on = true) => Promise.all(cars.map((c) => c.setDestroyed(on))),
    setPart: (n, t) => cars.forEach((c) => c.setPart(n, t)), setToggle: (n, on) => cars.forEach((c) => c.setToggle(n, on)),
    update: (dt, o) => cars.forEach((c) => c.update(dt, o)), setZoom: (z) => cars.forEach((c) => c.setZoom(z)),
    dispose: () => { cars.forEach((c) => c.dispose()); object3d.removeFromParent(); },
  };
  h.ready = Promise.all(cars.map((c) => c.ready)).then(() => {
    let z = 0;
    cars.forEach((c, i) => {
      const b = c.meta?.bbox || { min: [0, 0, -5], max: [0, 0, 5] };
      if (i) z -= b.max[2];
      c.object3d.position.z = z; z += b.min[2];
    });
    return h;
  });
  return h;
}

/** Every live vehicle visual (mission vehicles, static vehicles, consist cars): the loading-screen GPU warm-up. */
export function liveVehicleVisuals() { return [...V.live]; }

/** Drop cached GLBs/sidecars (tests, mission unload). Live visuals keep their clones. */
export function clearVehicleCache() { V.gltf.clear(); V.meta.clear(); V.pending.clear(); V.texCache.clear(); }

export default createVehicleVisual;
