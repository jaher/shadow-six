/**
 * Terrain & vegetation (ART; docs/terrain-pipeline.md §4). `buildTerrain(grid, theater, ctx)` returns a handle
 * synchronously; with a live renderer it is the final asset-driven ground (`src/art/terrain/`): hex-tiled splat
 * of de-lit CC0 photoscans per theatre with macro variation, 3D grass, clutter, snow sparkle/drifts/falling snow,
 * the deformable trail field, and seeded unique trees (impostors past the preset's unique budget). Without a
 * renderer / DOM (unit tests, headless tools) it falls back to the painted placeholder below.
 * Water: the real path leaves it to src/art/water (ownWater); the masked flat plane is the placeholder/fallback.
 * @module art/terrain
 */

import * as THREE from 'three';
import { T } from '../world/grid.js';
import { createTerrainHandle, tracksNear as trailsNear } from './terrain/game-adapter.js';
import { buildFlatMask, PALETTES } from './terrain/terrain-layers.js';
import { pretrampleRoads, terrainPainter } from '../world/roads.js';
import { createVegetation } from './terrain/vegetation.js';
import { SPECIES } from './terrain/treegen.js';
import { addSnowCover } from './terrain/snowfx.js';
import { CONFIG } from '../config.js';

/** Base colour per terrain code, per theater tint. */
const TERRAIN_RGB = {
  [T.GROUND]: [0x6b, 0x5e, 0x48],
  [T.ROAD]: [0x7d, 0x70, 0x5c],
  [T.SAND]: [0xb8, 0xa2, 0x78],
  [T.SNOW]: [0xe6, 0xea, 0xee],
  [T.GRASS]: [0x55, 0x6b, 0x38],
  [T.WATER]: [0x3a, 0x40, 0x36],
  [T.SHALLOW]: [0x5a, 0x5a, 0x48],
  [T.MUD]: [0x4a, 0x3d, 0x2c],
};
const THEATER_TINT = { desert: [1.08, 1.02, 0.92], snow: [1, 1, 1.04], temperate: [1, 1, 1], coast: [1, 1, 0.98], night: [0.55, 0.6, 0.75] };
const WATER_DEPTH = { [T.WATER]: -1.2, [T.SHALLOW]: -0.35 };

/** Tiny deterministic hash noise in [0,1). */
function hash(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Paint the terrain colour texture from the grid (one texel per cell). */
export function paintGroundTexture(grid, theater = 'temperate') {
  const { cols, rows } = grid;
  const data = new Uint8Array(cols * rows * 4);
  const tint = THEATER_TINT[theater] || THEATER_TINT.temperate;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const rgb = TERRAIN_RGB[grid.terrain[k]] || TERRAIN_RGB[T.GROUND];
      const n = 0.9 + 0.2 * hash(i, j) + 0.06 * Math.sin(i * 0.21) * Math.cos(j * 0.17);
      for (let c = 0; c < 3; c++) data[k * 4 + c] = Math.max(0, Math.min(255, rgb[c] * n * tint[c]));
      data[k * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Painted placeholder ground (no renderer / DOM). Same handle shape as the real terrain.
 * @param {import('../world/grid.js').NavGrid} grid
 * @param {'desert'|'snow'|'temperate'|'coast'|'night'} theater
 * @returns {{ground: THREE.Mesh, water: THREE.Mesh|null, update: (dt:number) => void, dispose: () => void}}
 */
export function buildPlaceholderTerrain(grid, theater = 'temperate') {
  const W = grid.width, D = grid.depth;
  const segX = Math.min(grid.cols, 256), segZ = Math.min(grid.rows, 256);
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(W / 2, 0, D / 2);
  // Sink vertices under water (min depth of the 4 cells around each vertex → soft banks).
  const pos = geo.attributes.position;
  let hasWater = false;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), z = pos.getZ(v);
    let y = 0;
    for (const [ox, oz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const { i, j } = grid.worldToCell(Math.min(W - 0.01, Math.max(0, x + ox)), Math.min(D - 0.01, Math.max(0, z + oz)));
      const t = grid.terrain[grid.idx(i, j)];
      if (WATER_DEPTH[t] != null) { y = Math.min(y, WATER_DEPTH[t]); hasWater = true; }
    }
    pos.setY(v, y);
  }
  geo.computeVertexNormals();
  // UVs: PlaneGeometry v runs bottom→top; map v=0 to z=0 (row 0) to match the DataTexture (flipY false).
  const uv = geo.attributes.uv;
  for (let v = 0; v < uv.count; v++) uv.setXY(v, pos.getX(v) / W, pos.getZ(v) / D);
  const map = paintGroundTexture(grid, theater);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }));
  ground.name = 'terrain:ground';
  ground.receiveShadow = true;

  let water = null;
  if (hasWater) {
    const wgeo = new THREE.PlaneGeometry(W, D);
    wgeo.rotateX(-Math.PI / 2);
    wgeo.translate(W / 2, -0.15, D / 2);
    const wmat = new THREE.MeshStandardMaterial({
      color: theater === 'night' ? 0x16222c : 0x2d4a55, roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: 0.78, depthWrite: false,
    });
    water = new THREE.Mesh(wgeo, wmat);
    water.name = 'terrain:water';
    water.renderOrder = 1;
  }
  let t = 0;
  return {
    ground,
    water,
    ready: Promise.resolve(null),
    heightAt: () => 0,
    groundY: () => 0,
    printVisibility: () => 1,
    /** Refresh the painted texture after grid.terrain changes (e.g. craters). */
    repaint() {
      const tex = paintGroundTexture(grid, theater);
      ground.material.map.dispose();
      ground.material.map = tex;
      ground.material.needsUpdate = true;
    },
    update(dt) {
      t += dt;
      if (water) water.material.opacity = 0.78 + 0.02 * Math.sin(t * 0.8);
    },
    dispose() {
      geo.dispose(); ground.material.map?.dispose(); ground.material.dispose();
      if (water) { water.geometry.dispose(); water.material.dispose(); }
    },
  };
}


// ------------------------------------------------------------------------------------------------ final terrain

/** Mission structure types drawn by the vegetation system (their grid footprints stay the gameplay occluders). */
export const TREE_TYPES = Object.freeze(['tree', 'pine', 'palm', 'bush']);
/** Engine preset name → terrain / tree quality key. */
const QUALITY_OF = { low: 'low', medium: 'medium', high: 'high', ultra: 'ultra' };
/** Presets that load the 2K albedo + normal layer arrays (the data array stays 1K). */
export const TEX_2K_PRESETS = Object.freeze(['ultra']);
/** Presets that load the 512 albedo + normal arrays (smaller download and VRAM; the data array stays 1K). */
export const TEX_512_PRESETS = Object.freeze(['low']);
/** Terrain layer-array resolution for a quality preset. */
export const terrainTexRes = (q) => (TEX_2K_PRESETS.includes(q) ? 2048 : TEX_512_PRESETS.includes(q) ? 512 : 1024);

const WET_CODES = new Set([T.WATER, T.SHALLOW]);
const seedOf = (def, k) => (def.seed ?? Math.floor(((def.x * 73856093) ^ (def.z * 19349663) ^ (k * 83492791)) >>> 0)) >>> 0;
const pickBy = (seed, list) => list[seed % list.length];

/**
 * Mission tree structure → seeded treegen placement (every tree unique: species variant, shape and tint come
 * from its own seed; `h` sets the scale). Returns null for non-tree types.
 * @param {{type:string, x:number, z:number, h?:number, seed?:number, variant?:string, burnt?:boolean}} def
 * @param {string} theater
 * @param {number} [k] index (seed fallback)
 */
export function treePlacement(def, theater = 'temperate', k = 0) {
  if (!def || !TREE_TYPES.includes(def.type)) return null;
  const seed = seedOf(def, k), snow = theater === 'snow', desert = theater === 'desert';
  let species;
  if (def.species && SPECIES[def.species]) species = def.species;
  else if (def.type === 'pine') species = snow ? (seed % 10 < 7 ? 'spruce' : 'fir') : desert ? 'pine' : pickBy(seed, ['pine', 'pine', 'spruce']);
  else if (def.type === 'palm') species = 'date_palm';
  else if (def.type === 'bush') species = desert ? 'desert_shrub' : snow ? 'shrub' : pickBy(seed, ['shrub', 'hedge']);
  else if (def.variant === 'dead' || def.variant === 'dead_tree') species = 'dead_tree';
  else if (def.variant === 'bare_winter') species = pickBy(seed, ['birch', 'oak', 'beech']);
  else species = desert ? 'olive' : snow ? pickBy(seed, ['birch', 'oak']) : pickBy(seed, ['oak', 'beech', 'plane', 'birch', 'poplar']);
  const H = SPECIES[species].H;
  const scale = def.h ? Math.max(0.35, Math.min(2.5, def.h / ((H[0] + H[1]) / 2))) : 1;
  return {
    species, x: def.x, z: def.z, seed, scale, burnt: !!def.burnt, hero: true,
    leafless: def.variant === 'bare_winter' ? true : undefined,
    crownBase: def.crownBase, crownR: def.crownR, // placement pruning hints (world/placement.js)
  };
}

/** Mission `terrain[]` road paths → pre-trampled polylines (worn ruts / slush at mission start). */
export function roadPolylines(mission) {
  return (mission?.terrain || [])
    .filter((t) => t.type === 'path' && t.terrain === 'road' && Array.isArray(t.points) && t.points.length > 1)
    .map((t, i) => ({ points: t.points.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z])), passes: 7, walkers: 3, seed: i + 1, spread: Math.min(1.2, (t.width ?? 3) * 0.2) }));
}

/** One shared snow-cover uniform set for every patched prop material (materials are cached across missions). */
const PROP_SNOW = { uSnowAmt: { value: 0 }, uSnowBias: { value: 0 } };
/**
 * Top-facing snow on props: patch every opaque MeshStandard/Physical material under `root` once, then drive
 * the shared amount (0 = off; later non-snow missions reuse the same cached materials with amount 0).
 * @returns {number} materials patched now
 */
export function coverPropsWithSnow(root, amount = 1) {
  PROP_SNOW.uSnowAmt.value = amount;
  if (!root || !(amount > 0)) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || m.userData.snowCover || m.transparent || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
      addSnowCover(m, { uniforms: PROP_SNOW });
      m.userData.snowCover = true;
      n++;
    }
  });
  return n;
}
export function setPropSnow(amount) { PROP_SNOW.uSnowAmt.value = amount; }

/**
 * Placeholder water plane for the real terrain: flat, at -0.15, alpha-masked to water/shallow cells (dilated one
 * cell) so undulating land dips never show water. Fallback when the water system (src/art/water) cannot build.
 */
export function buildMaskedWater(grid, theater) {
  const { cols, rows } = grid;
  const data = new Uint8Array(cols * rows * 4);
  let any = false;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let wet = false;
    for (let dj = -1; dj <= 1 && !wet; dj++) for (let di = -1; di <= 1 && !wet; di++) {
      const ii = Math.min(cols - 1, Math.max(0, i + di)), jj = Math.min(rows - 1, Math.max(0, j + dj));
      wet = WET_CODES.has(grid.terrain[jj * cols + ii]);
    }
    if (wet) any = true;
    data.fill(wet ? 255 : 0, (j * cols + i) * 4, (j * cols + i) * 4 + 4);
  }
  if (!any) return null;
  const mask = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  mask.magFilter = mask.minFilter = THREE.LinearFilter;
  mask.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(grid.width, grid.depth);
  geo.rotateX(-Math.PI / 2);
  geo.translate(grid.width / 2, -0.15, grid.depth / 2);
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let v = 0; v < uv.count; v++) uv.setXY(v, pos.getX(v) / grid.width, pos.getZ(v) / grid.depth);
  const mat = new THREE.MeshStandardMaterial({
    color: theater === 'night' ? 0x16222c : theater === 'snow' ? 0x22363c : 0x2d4a55, roughness: 0.12, metalness: 0.1,
    transparent: true, opacity: 0.82, depthWrite: false, alphaMap: mask, alphaTest: 0.02,
  });
  const water = new THREE.Mesh(geo, mat);
  water.name = 'terrain:water';
  water.renderOrder = 1;
  water.userData.aoExclude = true;
  return water;
}

const presetOf = (renderer) => QUALITY_OF[renderer?.presetName] || 'medium';

/**
 * Build the ground for a finished grid.
 * @param {import('../world/grid.js').NavGrid} grid
 * @param {'desert'|'snow'|'temperate'|'coast'|'night'} theater
 * @param {{renderer?: object, scene?: THREE.Object3D, mission?: object, trees?: object[], onSpray?: Function,
 *   real?: boolean, ownWater?: boolean}} [ctx] renderer = engine Renderer (null → placeholder); trees = mission tree structure defs
 * @returns {object} handle: {ground, water, ready, heightAt, groundY, materialAt, frame, stampTrail, recordTrail,
 *   queryTrails, tracksNear, setQuality, stats, dispose}
 */
export function buildTerrain(grid, theater = 'temperate', ctx = {}) {
  const R = ctx.renderer || null;
  if (!canBuildRealTerrain(R) || ctx.real === false) return buildPlaceholderTerrain(grid, theater);
  let quality = presetOf(R);
  const mission = ctx.mission || null;
  const inner = createTerrainHandle(R, new THREE.Group(), grid, theater, {
    quality, flatMask: buildFlatMask(grid), frozenWater: !!mission?.water?.frozen,
    // step 3p: ctx.roads (world/roads.js RoadIndex) → soft roads pre-trampled + splat painter; else the legacy paths
    roads: ctx.roads ? pretrampleRoads(ctx.roads.net) : roadPolylines(mission),
    paint: ctx.roads ? terrainPainter(ctx.roads, theater, (PALETTES[theater] || PALETTES.temperate).layers) ?? undefined : undefined,
    exclude: ctx.roads && (ctx.roads.net.roads.some((r) => !r.legacy) || ctx.roads.net.areas.length) ? (x, z) => ctx.roads.covers(x, z) : undefined,
    onSpray: ctx.onSpray, texRes: terrainTexRes(quality),
  });
  const ground = inner.ground;
  ground.name = 'terrain:ground';
  ground.userData.terrain = true;
  const water = ctx.ownWater ? null : buildMaskedWater(grid, theater); // ownWater: src/art/water owns the surface
  const placements = (ctx.trees || []).map((d, k) => treePlacement(d, theater, k)).filter(Boolean);
  const stats = { trees: placements.length, readyMs: 0 };
  let veg = null, disposed = false;
  const t0 = performance.now();
  const pitchDeg = CONFIG.camera?.pitchDeg ?? 40;
  const ready = inner.ready.then(async (t) => {
    if (disposed) return null;
    if (placements.length) {
      veg = await createVegetation(ground, placements, theater, { quality, terrain: t, renderer: R, pitchDeg });
      if (disposed) { veg.dispose(); veg = null; return null; }
    }
    stats.readyMs = Math.round(performance.now() - t0);
    stats.vegetation = veg?.stats || null;
    return h;
  }).catch((e) => { console.error('[terrain] build failed', e); return null; });
  const wetAt = (x, z) => {
    const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
    return i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && WET_CODES.has(grid.terrain[j * grid.cols + i]);
  };
  const h = {
    ground, water, ready, stats, real: true,
    get terrain() { return inner.terrain; },
    get vegetation() { return veg; },
    get quality() { return quality; },
    heightAt: (x, z) => inner.heightAt(x, z),
    /** Visual ground height for entity meshes: the undulating surface on land, 0 over water (swimmers, boats). */
    groundY: (x, z) => (wetAt(x, z) ? 0 : inner.heightAt(x, z)),
    materialAt: (x, z) => inner.materialAt(x, z),
    stampTrail: (...a) => inner.stampTrail(...a),
    recordTrail: (...a) => inner.recordTrail(...a),
    queryTrails: (...a) => inner.queryTrails(...a),
    /** Trails a guard at (x, z) could notice (terrain record ring, material visibility; §4.8 — see ai/footprints.js). */
    tracksNear: (x, z, r = 3, o = {}) => trailsNear(inner, x, z, r, o),
    /**
     * Visibility 0..1 of a print `age` s old at (x, z): the ground material's print visibility × exp(-age / its
     * trail life) (snow 1, sand .95, mud .9, grass .45, road .15, rock .02). Used by ai/footprints.tracksNear.
     */
    printVisibility(x, z, age = 0) {
      const hard = ctx.roads?.trailInfo(x, z);   // step 3p: no prints on stone / tar / concrete
      if (hard?.hard) return hard.visible * Math.exp(-age / hard.tau);
      if (!inner.terrain) return 1;
      const m = inner.materialAt(x, z);
      return m.tau > 0 ? m.visible * Math.exp(-age / m.tau) : m.visible;
    },
    update() {}, // sim tick: nothing (the ground animates per displayed frame, see frame())
    /** Per displayed frame (Game.render): quality follows the preset, trails/grass/snow/trees animate. */
    frame(dt, camera, world) {
      const q = presetOf(R);
      if (q !== quality) h.setQuality(q);
      inner.update(dt, camera);
      veg?.update(dt, camera);
      if (world && inner.terrain) stampWorld(inner, world, grid);
    },
    setQuality(q) {
      if (!QUALITY_OF[q]) return null;
      quality = q;
      inner.terrain?.setQuality(q);
      inner.terrain?.setTextureRes?.(terrainTexRes(q));
      return veg?.setQuality(q) ?? null;
    },
    dispose() {
      disposed = true;
      veg?.dispose(); veg = null;
      inner.dispose();
      ground.parent?.remove(ground);
      if (water) { water.parent?.remove(water); water.geometry.dispose(); water.material.alphaMap?.dispose(); water.material.dispose(); }
    },
  };
  return h;
}

/** Engine vehicle → trail layout (trails.js VEHICLE_TYPES) by model/type; boats, planes, rail and guns leave none. */
export function vehicleTrailType(v) {
  const D = v?.def;
  if (!D || D.kind !== 'land') return null;
  if (D.model === 'motorcycle') return 'motorcycle';
  if (D.model === 'tank' || v.vehicleType === 'panzer2' || v.vehicleType === 'tank' || D.tracked) return 'tank';
  if (v.vehicleType === 'halftrack' || D.model === 'halftrack') return 'halftrack';
  if (D.model === 'truck' || D.model === 'fuel_truck' || D.model === 'armoredcar') return 'truck';
  if (v.vehicleType === 'kubelwagen' || v.vehicleType === 'willys') return 'jeep';
  return 'car';
}

const GROUND_Y_MAX = 0.4;
/**
 * Visual trail stamping for one displayed frame (docs/terrain-pipeline.md §4.3): boot prints of every walking
 * commando and enemy, crawl furrows, bodies dragged behind their carrier, and every wheel / track of moving land
 * vehicles. Visual only (`record:false`); gameplay prints come from the 'footprint' event (wireFootprints).
 */
export function stampWorld(t, world, grid) {
  const wet = (x, z) => {
    const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
    return i < 0 || j < 0 || i >= grid.cols || j >= grid.rows || WET_CODES.has(grid.terrain[j * grid.cols + i]);
  };
  for (const list of [world.commandos, world.enemies]) {
    for (const u of list || []) {
      if (u.removed || !u.alive || !u.path || u.y > GROUND_Y_MAX || u.state === 'inVehicle' || u.state === 'carried' || u.state === 'jailed') continue;
      if (u.stance === 'swim' || u.stance === 'dive' || wet(u.x, u.z)) continue;
      const id = 'u' + u.id;
      if (u.stance === 'crawl' || u.stance === 'prone') t.stampTrail('crawl', u.x, u.z, u.heading, { id, record: false });
      else t.stampTrail('walker', u.x, u.z, u.heading, { id, run: u.moveMode === 'run', record: false });
      const body = u.carrying;
      if (body && (body.kind === 'commando' || body.kind === 'enemy')) {
        const bx = u.x - Math.cos(u.heading) * 0.9, bz = u.z - Math.sin(u.heading) * 0.9;
        t.stampTrail('drag', bx, bz, u.heading, { id: id + 'd', record: false });
      }
    }
  }
  for (const v of world.vehicles || []) {
    if (v.removed || v.alive === false || !(Math.abs(v.speed || 0) > 0.05) || (v.y || 0) > GROUND_Y_MAX) continue;
    const type = vehicleTrailType(v);
    if (!type || wet(v.x, v.z)) continue;
    t.stampTrail('vehicle', v.x, v.z, v.heading, { id: 'v' + v.id, type, speed: Math.abs(v.speed), record: false });
  }
}

/** Gameplay 'footprint' events → terrain trail records (queryTrails / QA). The AI list stays world.ai.footprints. */
export function wireTrailRecords(events, handle) {
  if (!events?.on) return () => {};
  return events.on('footprint', (e) => handle.recordTrail('foot', e.x, e.z, e.heading, e.owner?.id ?? e.ownerId ?? null, { aiVisible: e.aiVisible !== false, t0: e.t }));
}

/** True when `renderer` (engine Renderer or WebGLRenderer) can host the final terrain (browser, live GL context). */
export function canBuildRealTerrain(renderer) {
  const gl = renderer?.renderer?.isWebGLRenderer ? renderer.renderer : renderer?.isWebGLRenderer ? renderer : null;
  return !!gl && typeof document !== 'undefined' && CONFIG.render?.realTerrain !== false;
}
