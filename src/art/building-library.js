/**
 * Building & bridge library — the realistic GLB kit (tools/blender) behind the prop catalogue.
 * Owned by ART. props.js still builds the placeholder boxes; the ART integration step switches
 * buildProp() over to createBuilding() for every catalogue type the manifest covers.
 *
 *   const lib = await loadBuildingLibrary(assets, { preload: ['barracks', 'bridge_stone_arch3_a'], theater: 'snow' });
 *   const b = createBuilding('barracks', { x, z, rot, theater: 'snow', destroyed: false }, world.rng);
 *   scene.add(b.object3d);  // b.footprints → grid, b.interactables → Interactable specs
 *   setBuildingZoom(camera.zoom);  // LOD switch for every live building (orthographic camera: by zoom, not distance)
 *
 * Data: assets/models/buildings/manifest.json (type → variants, LOD files, footprints, doors, roofs, climb edges,
 * ladders, anchors, bridge decks, destroyed/snow variants, theater tags). GLBs are meshopt-compressed and reference
 * the shared texture library assets/textures/lib/1k by relative URI; quality 'ultra' swaps albedo maps to lib/2k (WebP).
 * Textures are shared across every GLB (one GPU upload per image); an asset's scene is cloned per instance
 * (shared geometry + materials) and repeated static assets can be drawn as InstancedMesh (createBuildingBatch).
 * Local sidecar coords: x east, y up, z south; heading = atan2(dz, dx); world = placed like props.js (rotation.y = -rot).
 * @module art/building-library
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { applyAssetFixups, DROP_LODS } from './building-fixups.js';
import { antiTile } from './anti-tiling.js';

const BLOCK = { NONE: 0, LOW: 1, HIGH: 2, FENCE: 3 }; // == world/grid.js B
const BRIDGE_KINDS = new Set(['bridge_deck', 'drawbridge', 'quay', 'footboard', 'landing']);
const WATER_KINDS = new Set(['water', 'water_basin']);
const TARGET_ANCHORS = /^(explosive_target|bomb_target|demolition|dam_charge|charge_[A-Z]|objective)$/;
const SWITCH_KINDS = { interact_switch: 'switch', interact_lever: 'switch', interact_lock: 'switch', lever: 'switch' };

const L = {
  manifest: null, base: 'assets/', quality: 'default', loader: null, ultra: new Set(),
  texCache: new Map(), gltf: new Map(), pending: new Map(), live: new Set(), zoom: 1, lodBias: 0,
};

/**
 * GLTFLoader plugin: one Texture (→ one GPU upload) per shared-library image across all GLBs. Image URIs are rewritten
 * before parsing: byte-identical maps → their survivor (manifest textures.aliases), 'ultra' → 2k WebP albedo,
 * 'low' → the 512 set (tools/perf/lib_textures.py).
 */
class SharedLibTextures {
  constructor(parser) { this.parser = parser; this.name = 'SHADOW_shared_lib_textures'; }
  beforeRoot() {
    const alias = L.manifest?.textures?.aliases || {};
    for (const im of this.parser.json.images || []) {
      const m = im.uri && im.uri.match(/^(.*\/textures\/lib\/)1k\/([^/]+)\.(jpg|png)$/);
      if (!m) continue;
      let file = `${m[2]}.${m[3]}`;
      if (alias[file]) { file = alias[file]; im.uri = `${m[1]}1k/${file}`; }
      if (L.quality === 'ultra' && L.ultra.has(file)) im.uri = `${m[1]}2k/${file.replace(/\.(jpg|png)$/, '')}.webp`;
      else if (L.quality === 'low' && L.manifest?.textures?.low) im.uri = `${m[1]}${L.manifest.textures.low}/${file}`;
    }
    return null;
  }
  loadTexture(index) {
    const json = this.parser.json, def = json.textures[index];
    const img = def && json.images[def.source];
    if (!img || !img.uri || !/textures\/lib\//.test(img.uri)) return null; // embedded AO etc.: default path
    const key = `${new URL(img.uri, new URL(this.parser.options.path || '', globalThis.location?.href ?? 'http://localhost/')).href}|${def.sampler ?? -1}`;
    if (!L.texCache.has(key)) L.texCache.set(key, this.parser.loadTextureImage(index, def.source, this.parser.textureLoader));
    return L.texCache.get(key);
  }
}

/** Resolve rng: world Rng ({next}), a () => [0,1) function, or nothing (first variant). */
function rand(rng) {
  if (!rng) return () => 0;
  if (typeof rng === 'function') return rng;
  return () => rng.next();
}

/**
 * Load the manifest and (optionally) preload GLBs.
 * @param {import('../engine/assets.js').Assets|null} assets engine Assets (uses its LoadingManager + base URL)
 * @param {{base?: string, quality?: 'low'|'default'|'high'|'ultra', preload?: string[]|'all', theater?: string,
 *   lods?: number[], onProgress?: (done:number,total:number)=>void}} [opts] preload = asset names and/or types
 * @returns {Promise<{manifest: object, preload: (list: string[], theater?: string) => Promise<void>}>}
 */
/**
 * URL of a shared library texture file (e.g. 'rock_cliff_diff.jpg') under the current quality rules: manifest
 * aliases, 'ultra' → 2k WebP albedo when shipped, 'low' → the 512 set. Used by procedural dressing (art/dressing.js).
 * @returns {{url: string, tier: string}}
 */
export function libTextureURL(file) {
  const alias = L.manifest?.textures?.aliases || {};
  const f = alias[file] || file, root = `${L.base}textures/lib/`;
  if (L.quality === 'ultra' && L.ultra.has(f)) return { url: `${root}2k/${f.replace(/\.(jpg|png)$/, '')}.webp`, tier: '2k' };
  if (L.quality === 'low' && L.manifest?.textures?.low) return { url: `${root}${L.manifest.textures.low}/${f}`, tier: L.manifest.textures.low };
  return { url: `${root}1k/${f}`, tier: '1k' };
}

/** Add-on manifests under assets/models/buildings/ (same schema, `assets` + `types` only), merged after manifest.json. */
export const EXTRA_MANIFESTS = ['manifest-atlantic-wall', 'manifest-tunis', 'manifest-le-havre'];

/**
 * Merge an add-on manifest into `base` (in place): new assets; per type the variant / all / byTheater lists are
 * unioned (types it introduces are added whole). Returns `base`.
 */
export function mergeManifest(base, ext) {
  Object.assign(base.assets, ext.assets || {});
  for (const [t, e] of Object.entries(ext.types || {})) {
    const b = base.types[t];
    if (!b) { base.types[t] = e; continue; }
    const uni = (a = [], c = []) => [...new Set([...a, ...c])];
    b.variants = uni(b.variants, e.variants); b.all = uni(b.all, e.all);
    b.byTheater = b.byTheater || {};
    for (const [th, l] of Object.entries(e.byTheater || {})) b.byTheater[th] = uni(b.byTheater[th], l);
  }
  return base;
}

export async function loadBuildingLibrary(assets = null, opts = {}) {
  L.base = opts.base ?? assets?.manifest?.base ?? 'assets/';
  L.quality = opts.quality ?? 'default';
  L.lodBias = L.quality === 'low' ? 1 : 0;
  if (!L.loader && !opts.manifest) {
    L.loader = new GLTFLoader(assets?.manager);
    L.loader.setMeshoptDecoder(MeshoptDecoder);
    L.loader.register((parser) => new SharedLibTextures(parser));
  }
  if (opts.manifest) L.manifest = opts.manifest; // injected (node tests / tools)
  if (!L.manifest) {
    const res = await fetch(`${L.base}models/buildings/manifest.json`);
    if (!res.ok) throw new Error(`[building-library] manifest ${res.status}`);
    L.manifest = await res.json();
    // per-family add-on manifests (one small file per art pass, so passes never edit the same one-line JSON)
    await Promise.all(EXTRA_MANIFESTS.map(async (x) => {
      try {
        const r = await fetch(`${L.base}models/buildings/${x}.json`);
        if (r.ok) mergeManifest(L.manifest, await r.json());
      } catch (e) { console.warn(`[building-library] ${x}:`, e?.message || e); }
    }));
    L.ultra = new Set(L.manifest.textures?.ultra2k || []);
  }
  const api = { manifest: L.manifest, preload: (list, theater) => preloadBuildings(list, { theater, lods: opts.lods, onProgress: opts.onProgress }) };
  if (opts.preload) await api.preload(opts.preload === 'all' ? Object.keys(L.manifest.assets) : opts.preload, opts.theater);
  return api;
}

/** Expand types / asset names into the asset names they can resolve to (incl. snow + destroyed variants). */
export function expandBuildingNames(list, theater) {
  const M = L.manifest, out = new Set();
  const add = (n) => {
    const a = M.assets[n]; if (!a) return;
    out.add(n);
    if (a.snowVariant && (!theater || theater === 'snow')) add(a.snowVariant);
    if (a.destroyedVariant) out.add(a.destroyedVariant);
  };
  for (const x of list) {
    if (M.assets[x]) add(x);
    else if (M.types[x]) {
      const t = M.types[x], pool = theater ? t.byTheater[theater] : null;
      for (const n of (pool && pool.length ? pool : t.variants)) add(n);
    }
  }
  return [...out];
}

/**
 * Preload GLBs for asset names / types: every LOD the quality can show ('low' never draws LOD0, so it is skipped here;
 * createBuilding still attaches LOD0 of the placed buildings — their door nodes live there — so in practice 'low' saves
 * the destroyed / unused variants' LOD0).
 */
export async function preloadBuildings(list, { theater, lods = L.lodBias ? [1, 2] : [0, 1, 2], onProgress } = {}) {
  const names = expandBuildingNames(list, theater);
  const jobs = [];
  for (const n of names) for (const i of lods) if (L.manifest.assets[n].lods[i]) jobs.push([n, i]);
  let done = 0;
  await Promise.all(jobs.map(([n, i]) => loadLod(n, i).then(() => onProgress?.(++done, jobs.length))));
}

function loadLod(name, i) {
  const key = `${name}#${i}`;
  if (L.gltf.has(key)) return Promise.resolve(L.gltf.get(key));
  if (L.pending.has(key)) return L.pending.get(key);
  if (DROP_LODS[name]?.includes(i)) { L.gltf.set(key, null); return Promise.resolve(null); } // broken LOD → next finer
  const url = L.base + 'models/' + L.manifest.assets[name].lods[i].url;
  const p = L.loader.loadAsync(url).then((g) => {
    prepareScene(g.scene);
    g.scene.userData.fixups = applyAssetFixups(g.scene, name, i, L.base);
    L.gltf.set(key, g.scene); L.pending.delete(key);
    return g.scene;
  }).catch((e) => {
    console.warn(`[building-library] ${url} failed:`, e?.message || e);
    L.pending.delete(key); L.gltf.set(key, null); return null;
  });
  L.pending.set(key, p);
  return p;
}

/** A texture named after a shared-library albedo (GLTFLoader keeps the image name, e.g. 'ashlar_limestone_diff'). */
const LIB_MAP = /^[a-z0-9_]+_diff$/;

/** Baked kit flags (red field + white disc layout, against design-spec §10.6) — stripped on load; art/flags.js adds the spec banner. */
const BAKED_FLAG = /^flag(\.?\d+)?$/;

/** Shadows, decal layering, anisotropy, baked-flag removal. Runs once per loaded GLB (clones inherit it). */
function prepareScene(root) {
  const flags = [];
  root.traverse((o) => { if (BAKED_FLAG.test(o.name)) flags.push(o); });
  for (const f of flags) f.removeFromParent();
  root.traverse((o) => {
    if (!o.isMesh) return;
    let decal = false;
    for (let p = o; p; p = p.parent) if (p.name === 'decals') { decal = true; break; }
    o.castShadow = !decal; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (decal || m.transparent) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; o.renderOrder = 1; }
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) m[k].anisotropy = 4;
      // shared-library finishes: hex tiling / per-building offset + macro variation (art/anti-tiling.js)
      if (!decal && !m.transparent && m.map && LIB_MAP.test(m.map.name || '')) antiTile(m, { lib: m.map.name, perObject: false });
    }
  });
}

/**
 * Pick the asset for a type (or asset name) + params.
 * @param {string} type catalogue type ('barracks', 'bridge', 'villa', …) or an asset name ('barn_a_snow')
 * @param {{variant?: string|number, theater?: string, region?: string, destroyed?: boolean, snow?: boolean}} [params]
 *   variant: asset name, letter ('a'), or index; otherwise picked with rng among the type's variants for the theater
 */
export function resolveBuilding(type, params = {}, rng = null) {
  const M = L.manifest;
  if (!M) throw new Error('[building-library] call loadBuildingLibrary() first');
  let name = M.assets[type] ? type : null;
  if (!name) {
    const t = M.types[type];
    if (!t) return null;
    const v = params.variant;
    if (typeof v === 'string' && M.assets[v]) name = v;
    else {
      const th = params.theater, ok = (n) => {
        const e = M.assets[n];
        return (!th || e.theaters.includes(th) || (th === 'snow' && e.snowVariant)) && (!params.region || e.region === params.region);
      };
      const pool = t.variants.filter(ok);
      const list = pool.length ? pool : t.variants;
      if (typeof v === 'string' && v.length <= 2) name = list.find((n) => n.endsWith('_' + v)) ?? null; // 'a' | 'b'
      if (!name) name = typeof v === 'number' ? list[v % list.length] : list[Math.floor(rand(rng)() * list.length)];
    }
  }
  let a = M.assets[name];
  if ((params.snow || params.theater === 'snow') && a.snowVariant) { name = a.snowVariant; a = M.assets[name]; }
  if (params.destroyed && a.destroyedVariant) name = a.destroyedVariant;
  return name;
}

/** Local (sidecar) → world transform for the placement. */
function placer(x, z, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return {
    pt: (p) => [x + p[0] * c - p[1] * s, z + p[0] * s + p[1] * c],
    p3: (p) => ({ x: x + p[0] * c - p[2] * s, y: p[1], z: z + p[0] * s + p[2] * c }),
    h: (h) => (h ?? 0) + rot,
  };
}

/** Footprints (props.js format) for an asset placed at (x, z, rot). */
export function buildingFootprints(name, x = 0, z = 0, rot = 0) {
  const a = L.manifest.assets[name], P = placer(x, z, rot), out = [];
  for (const f of a.footprints) {
    const fp = { shape: 'poly', points: f.points.map(P.pt), kind: f.kind };
    if (WATER_KINDS.has(f.kind)) fp.terrain = 'water';
    else if (BRIDGE_KINDS.has(f.kind)) fp.bridge = 1;
    else fp.block = BLOCK[f.block] ?? BLOCK.NONE;
    out.push(fp);
  }
  return out;
}

function interactablesFor(name, P, params, x, z, doorNodes) {
  const a = L.manifest.assets[name], out = [];
  for (const d of a.doors) {
    const p = P.p3(d.pos), ap = d.approach ? P.pt(d.approach) : null;
    out.push({ interactKind: 'door', id: params.id ? `${params.id}:${d.id}` : d.id, doorId: d.id, doorKind: d.kind,
      x: p.x, z: p.z, y: p.y, w: d.width, h: d.height, rot: P.h(d.heading), approach: ap && { x: ap[0], z: ap[1] },
      node: d.node, object3d: doorNodes[d.node] || null, locked: !!params.locked });
  }
  for (const l of a.ladders) {
    const b = P.pt(l.a), t = P.pt(l.b);
    out.push({ interactKind: 'climbable', x: b[0], z: b[1], elevation: l.y, top: { x: t[0], z: t[1] } });
  }
  for (const an of a.anchors) {
    const kind = SWITCH_KINDS[an.kind];
    if (kind) { const p = P.p3(an.pos); out.push({ interactKind: kind, id: params.id ? `${params.id}:${an.name}` : an.name, x: p.x, z: p.z, targets: an.target ? String(an.target).split(',') : [], anchor: an.name }); }
  }
  if (params.destructible) {
    const t = a.anchors.find((an) => TARGET_ANCHORS.test(an.name));
    const p = t ? P.p3(t.pos) : { x, z };
    const bb = a.bbox, r = Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2;
    out.push({ interactKind: 'explosiveTarget', x: p.x, z: p.z, id: params.id, hp: params.hp ?? 100, radius: r });
  }
  return out;
}

function lodFor(zoom) {
  const lods = L.manifest ? [0.8, 0.4, 0] : [0];
  let i = lods.findIndex((m) => zoom > m);
  return Math.min(2, (i < 0 ? 2 : i) + L.lodBias);
}

function applyLod(entry, zoom) {
  let want = lodFor(zoom);
  while (want > 0 && !entry.lods[want]) want--;           // missing LOD file → next finer one
  if (!entry.lods[want]) want = entry.lods.findIndex(Boolean);
  entry.lods.forEach((o, i) => { if (o) o.visible = i === want; });
  entry.current = want;
}

/**
 * Build one building/bridge instance. LODs load on demand if not preloaded (the group fills in when ready).
 * @param {string} type catalogue type or asset name
 * @param {{x?: number, z?: number, rot?: number, id?: string, variant?: string|number, theater?: string,
 *   destroyed?: boolean, snow?: boolean, destructible?: boolean, hp?: number, locked?: boolean}} [params]
 * @param {{next: () => number}|(() => number)} [rng]
 * @returns {{object3d: THREE.Group, asset: string, meta: object, footprints: object[], interactables: object[],
 *   lods: (THREE.Object3D|null)[], anchors: object[], roofs: object[], climbEdges: object[], bridge: object|null,
 *   ready: Promise<void>, setLod: (i:number)=>void, setDoorOpen: (id:string, t:number, sign?:number)=>void, dispose: ()=>void}|null}
 */
export function createBuilding(type, params = {}, rng = null) {
  const name = resolveBuilding(type, params, rng);
  if (!name) return null;
  const a = L.manifest.assets[name];
  const x = params.x ?? 0, z = params.z ?? 0, rot = params.rot ?? 0, P = placer(x, z, rot);
  const group = new THREE.Group();
  group.name = `building:${name}${params.id ? ':' + params.id : ''}`;
  group.position.set(x, 0, z);
  group.rotation.y = -rot;
  group.userData.building = name;
  const entry = { group, lods: [null, null, null], current: -1 };
  const doorNodes = {};
  const attach = (i, src) => {
    if (!src) return;
    const o = src.clone(true);
    o.name = `lod${i}`;
    entry.lods[i] = o; group.add(o);
    if (i === 0) o.traverse((n) => { if (n.name && n.name.startsWith('door_')) doorNodes[n.name] = n; });
    applyLod(entry, L.zoom);
    group.userData.onLodAttached?.(i, o); // dressing hooks (flags) re-run on late LODs
  };
  const jobs = a.lods.map((_, i) => {
    const cached = L.gltf.get(`${name}#${i}`);
    if (cached !== undefined) { attach(i, cached); return null; }
    return loadLod(name, i).then((s) => attach(i, s));
  }).filter(Boolean);
  L.live.add(entry);
  const anchors = a.anchors.map((an) => ({ ...an, pos: P.p3(an.pos), heading: P.h(an.heading) }));
  const roofs = a.roofs.map((r) => ({ ...r, points: r.points.map(P.pt) }));
  const climbEdges = a.climbEdges.map((c) => ({ ...c, a: P.pt(c.a), b: P.pt(c.b) }));
  const bridge = a.bridge ? { ...a.bridge, deck: a.bridge.deck ? a.bridge.deck.map(P.pt) : null, crest: a.bridge.crest_poly ? a.bridge.crest_poly.map(P.pt) : null } : null;
  return {
    object3d: group, asset: name, meta: a,
    footprints: buildingFootprints(name, x, z, rot),
    interactables: interactablesFor(name, P, params, x, z, doorNodes),
    lods: entry.lods, anchors, roofs, climbEdges, bridge,
    destroyedVariant: a.destroyedVariant ?? null,
    ready: Promise.all(jobs).then(() => undefined),
    setLod: (i) => { entry.lods.forEach((o, k) => { if (o) o.visible = k === i; }); entry.current = i; },
    setDoorOpen: (id, t, sign = 1) => {
      const d = a.doors.find((dd) => dd.id === id); const n = d && doorNodes[d.node];
      if (n) { n.userData.rest ??= n.rotation.y; n.rotation.y = n.userData.rest + sign * t * Math.PI / 2; }
    },
    dispose: () => { L.live.delete(entry); group.removeFromParent(); },
  };
}

/** Switch every live building (and batch) to the LOD for this camera zoom (0.5 / 1 / 2 / close). */
export function setBuildingZoom(zoom) {
  L.zoom = zoom;
  for (const e of L.live) applyLod(e, zoom);
}

/**
 * Repeated static assets (fence runs, grave rows, wall segments, huts) as one InstancedMesh per mesh and LOD.
 * No door nodes / per-instance interactivity: use createBuilding() for anything that animates or gets destroyed.
 * @param {string} type catalogue type or asset name
 * @param {object[]} placements createBuilding params ({x, z, rot, variant, theater, …}) per instance
 * @returns {Promise<{object3d: THREE.Group, footprints: object[], interactables: object[], lods: THREE.Group[], dispose: ()=>void}>}
 */
export async function createBuildingBatch(type, placements, rng = null) {
  const byName = new Map();
  for (const p of placements) {
    const n = resolveBuilding(type, p, rng);
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(p);
  }
  const group = new THREE.Group();
  group.name = `buildings:${type}`;
  const lods = [0, 1, 2].map((i) => { const g = new THREE.Group(); g.name = `lod${i}`; group.add(g); return g; });
  const footprints = [], interactables = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [name, list] of byName) {
    const scenes = await Promise.all(L.manifest.assets[name].lods.map((_, i) => loadLod(name, i)));
    // p.matrix: full placement (e.g. fitted onto a gameplay footprint, non-uniform scale); else x/z/rot
    const place = list.map((p) => p.matrix ? p.matrix.clone() : m.clone().compose(new THREE.Vector3(p.x ?? 0, 0, p.z ?? 0), q.clone().setFromAxisAngle(up, -(p.rot ?? 0)), one));
    scenes.forEach((sc, i) => {
      if (!sc) return;
      sc.updateMatrixWorld(true);
      sc.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, place.length);
        place.forEach((pm, k) => im.setMatrixAt(k, m.multiplyMatrices(pm, o.matrixWorld)));
        im.castShadow = o.castShadow; im.receiveShadow = o.receiveShadow; im.renderOrder = o.renderOrder;
        im.computeBoundingSphere();
        lods[i].add(im);
      });
    });
    for (const p of list) {
      footprints.push(...buildingFootprints(name, p.x ?? 0, p.z ?? 0, p.rot ?? 0));
      if (p.destructible) interactables.push(...interactablesFor(name, placer(p.x ?? 0, p.z ?? 0, p.rot ?? 0), p, p.x ?? 0, p.z ?? 0, {}).filter((it) => it.interactKind === 'explosiveTarget'));
    }
  }
  const entry = { group, lods, current: -1 };
  L.live.add(entry);
  applyLod(entry, L.zoom);
  return { object3d: group, footprints, interactables, lods, dispose: () => { L.live.delete(entry); group.removeFromParent(); } };
}

/** Manifest entry for an asset name (or null). */
export function buildingMeta(name) {
  return L.manifest?.assets[name] ?? null;
}

/** Catalogue types the library covers (ARCHITECTURE catalogue + spec §7.7 + extra kit types). */
export function buildingTypes() {
  return L.manifest ? Object.keys(L.manifest.types) : [];
}

/** Drop cached scenes/textures (e.g. between missions). Live instances keep working until disposed. */
export function clearBuildingCache() {
  L.gltf.clear();
  for (const p of L.texCache.values()) p.then((t) => t?.dispose());
  L.texCache.clear();
}

export default createBuilding;
