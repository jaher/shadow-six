/**
 * Terrain & vegetation (ART; docs/terrain-pipeline.md §4). `buildTerrain(grid, theater, ctx)` returns a handle
 * synchronously; with a live renderer it is the final asset-driven ground (`src/art/terrain/`): hex-tiled splat
 * of de-lit CC0 photoscans per theatre with macro variation, 3D grass, clutter, snow sparkle/drifts/falling snow,
 * the deformable trail field, and seeded unique trees (impostors past the preset's unique budget). Without a
 * renderer / DOM (unit tests, headless tools) it falls back to the painted placeholder below.
 * Water: the real path leaves it to src/art/water (ownWater); the masked flat plane is the placeholder/fallback.
 * @module art/terrain
 */

import { missionCarves, carvePainter } from './terrain/carve.js';
import * as THREE from 'three';
import { T } from '../world/grid.js';
import { createTerrainHandle, tracksNear as trailsNear, dragHeels } from './terrain/game-adapter.js';
import { footOf } from '../ai/footprints.js';
import { buildFlatMask, PALETTES } from './terrain/terrain-layers.js';
import { pretrampleRoads, terrainPainter } from '../world/roads.js';
import { createVegetation } from './terrain/vegetation.js';
import { vegetationProfile } from './terrain/veg-profile.js';
import { fillForest, hedgerowPlacements, forestUnderstorey, forestFloorPainter } from './terrain/forest-fill.js';
import { SPECIES } from './terrain/treegen.js';
import { farmland } from './terrain/bocage.js';
import { addSnowCover } from './terrain/snowfx.js';
import { CONFIG } from '../config.js';
import { dataKey } from '../engine/asset-cache.js';
import { screenDensity } from '../engine/texel-budget.js';
import { createApron } from './apron.js';
import { buildApronField, extendPath } from '../world/apron-field.js';
import { edgeCrossings } from '../world/edge-extend.js';
import { buildShoreField } from '../world/shore-field.js';
import { structureRecords, obstacle, pruneTree, OBSTACLE_H } from '../world/placement.js';
import { polyDist } from '../world/placement-geom.js';
import { vegetationWetAt, onDryLand } from '../world/veg-shore.js';

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
const THEATER_TINT = { desert: [1.08, 1.02, 0.92], snow: [1, 1, 1.04], temperate: [1, 1, 1], coast: [1, 1, 0.98], night: [0.55, 0.6, 0.75],
  frost: [0.97, 0.99, 1.04] };
/** §2.4 frost variant (mission `groundPalette: 'frost'`, M18 December): rimed, bleached grass and dark wet mud. */
const PALETTE_RGB = {
  frost: { [T.GRASS]: [0x7a, 0x7e, 0x6c], [T.GROUND]: [0x6a, 0x5f, 0x50], [T.MUD]: [0x3e, 0x34, 0x2a], [T.ROAD]: [0x76, 0x6f, 0x64] },
};
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
      const rgb = PALETTE_RGB[theater]?.[grid.terrain[k]] || TERRAIN_RGB[grid.terrain[k]] || TERRAIN_RGB[T.GROUND];
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
    surfaceAt: () => 0,
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
/**
 * Terrain layer-array resolution for a quality preset. 'medium' / 'high' also take the 512 arrays when every layer of
 * the theatre's palette keeps at least the preset's screen density at 512 (texels per metre = size ÷ layer tile;
 * engine/texel-budget.js): the same picture at a quarter of the memory and download.
 * @param {string} q preset @param {string} [theater] mission theatre (palette)
 */
export const terrainTexRes = (q, theater) => {
  if (TEX_2K_PRESETS.includes(q)) return 2048;
  if (TEX_512_PRESETS.includes(q)) return 512;
  const P = PALETTES[theater] || PALETTES.temperate; // createTerrain's palette
  if (P && (q === 'medium' || q === 'high') && 512 / Math.max(...P.tile) >= screenDensity(q)) return 512;
  return 1024;
};

const WET_CODES = new Set([T.WATER, T.SHALLOW]);
const seedOf = (def, k) => (def.seed ?? Math.floor(((def.x * 73856093) ^ (def.z * 19349663) ^ (k * 83492791)) >>> 0)) >>> 0;
const pickBy = (seed, list) => list[seed % list.length];

/**
 * Mission `variant` → species pool (docs/vegetation.md §3.10, pass 2). Unknown variants keep the theatre defaults.
 * The pool is a hint for the look only: footprints, cover and sight come from the structure, never the species.
 */
export const VARIANT_SPECIES = Object.freeze({
  broadleaf_normandy: ['oak', 'ash', 'oak', 'hawthorn', 'apple', 'beech', 'ash'],     // bocage standards, orchards
  broadleaf: ['oak', 'ash', 'poplar', 'beech', 'plane', 'birch', 'oak', 'horse_chestnut'],
  deciduous_bare: ['oak', 'beech', 'ash', 'plane', 'birch', 'apple'],
  plane_tree: ['plane'], horse_chestnut: ['horse_chestnut'], cypress: ['cypress'],
  box_parterre: ['box'], scrub_desert: ['desert_shrub', 'desert_shrub', 'acacia_shrub'], camel_thorn: ['desert_shrub'],
  date_palm: ['date_palm'],
});
/** Theatre defaults for a variant-less structure. */
const DEFAULT_SPECIES = {
  tree: { temperate: ['oak', 'beech', 'plane', 'birch', 'poplar', 'ash', 'horse_chestnut'], coast: ['oak', 'ash', 'hawthorn', 'beech', 'oak', 'apple'],
    desert: ['olive', 'acacia', 'olive'], snow: ['birch', 'birch', 'birch', 'oak'] },
  bush: { temperate: ['shrub', 'hedge', 'hazel', 'shrub'], coast: ['sea_buckthorn', 'gorse', 'shrub', 'hedge'], desert: ['desert_shrub', 'desert_shrub', 'acacia_shrub'], snow: ['shrub'] },
};
const pool = (type, theater) => DEFAULT_SPECIES[type]?.[theater === 'night' ? 'temperate' : theater] ?? DEFAULT_SPECIES[type]?.temperate;

/**
 * Forest-fill trees vs the mission's masonry (rule b, as pruneTree does for the mission's own trees): a fill tree
 * whose crown would reach into a tall structure (a castle range, a crag, a tower) is left out — the wood stops short
 * of the wall like a cleared glacis — and one near a low obstacle gets its lowest branches lifted / crown narrowed.
 * The forest polygon is gameplay data and often overlaps the masonry it backs (M20: crag and N range).
 * @param {object[]} fill fillForest / forestUnderstorey placements ({species, x, z, scale})
 * @param {object[]} [structures] mission structures
 * @returns {object[]} the kept placements (pruning hints set)
 */
export function clearForestFill(fill, structures) {
  if (!fill.length || !structures?.length) return fill;
  const recs = structureRecords(structures.filter((d) => !TREE_TYPES.includes(d.type)));
  const obs = recs.filter((r) => !r.ignored && !['tree', 'foliage', 'item', 'road', 'ground'].includes(r.cat) && r.polys.length)
    .map((r) => obstacle(r.id, r.cat, r.polys, r.def, r.tall));
  if (!obs.length) return fill;
  const out = [];
  for (const p of fill) {
    const sp = SPECIES[p.species], sc = p.scale ?? 1, H = (sp?.H?.[1] ?? 12) * sc; // the tallest this seed can grow
    // crown reach: conifers by their species width (radius ≈ width × H, +15 % seeded), broadleaves ≈ half the height;
    // understorey: a fallen bough lies its whole length any way from its root, a bush spreads its radius
    const reach = sp?.fallen ? H + 0.3 : sp?.kind === 'bush' ? (sp.R?.[1] ?? 1.2) * sc + 0.3
      : (sp?.kind === 'conifer' ? (sp.width ?? 0.3) * 1.15 : 0.5) * H + 0.3;
    let tall = false;
    for (const o of obs) {
      if (o.bb && (p.x < o.bb[0] - reach || p.z < o.bb[1] - reach || p.x > o.bb[2] + reach || p.z > o.bb[3] + reach)) continue;
      const h = o.def?.h ?? OBSTACLE_H[o.cat] ?? 2;
      // low (a wall, a fence, sandbags): pruneTree below lifts the lowest branches over it. Anything taller (a range,
      // a terrace, a crag) keeps the whole crown off: lifted boughs would still overhang its roof / wall walk
      if (h <= 3) continue;
      let d = Infinity;
      for (const q of o.tall) d = Math.min(d, polyDist(p.x, p.z, q));
      if (d < reach) { tall = true; break; }
    }
    if (tall) continue; // a tall wall inside the crown: no tree here
    if (p.understorey || sp?.fallen || sp?.kind === 'bush') { out.push(p); continue; }
    const hint = pruneTree({ x: p.x, z: p.z, h: H }, obs);
    out.push(hint ? { ...p, ...hint } : p);
  }
  return out;
}

/**
 * Mission tree structure → seeded treegen placement (every tree unique: species variant, shape and tint come
 * from its own seed; `h` sets the scale). Returns null for non-tree types.
 * @param {{type:string, x:number, z:number, h?:number, seed?:number, variant?:string, burnt?:boolean}} def
 * @param {string} theater
 * @param {number} [k] index (seed fallback)
 */
/**
 * Walk-under radius (m) of a tree: walkers pass its trunk as close as the nav allows (the free cell beside the
 * footprint, their body radius 0.35 m), so below head height the branches stay within the trunk's own reach.
 */
export const treeClearR = () => 0.35;

export function treePlacement(def, theater = 'temperate', k = 0) {
  if (!def || !TREE_TYPES.includes(def.type)) return null;
  const seed = seedOf(def, k), snow = theater === 'snow', desert = theater === 'desert';
  let species;
  if (def.species && SPECIES[def.species]) species = def.species;
  else if (VARIANT_SPECIES[def.variant]) species = pickBy(seed, VARIANT_SPECIES[def.variant]);
  else if (def.variant === 'pine_frost' && seed % 10 < 3) species = pickBy(seed >>> 4, ['beech', 'oak']); // M20 Black Forest edge: mixed wood
  // pines by theater: Norway spruce + Scots pine in the snow, Aleppo pine in the desert, stone (umbrella) and Aleppo
  // pines on the coast, a Scots pine / spruce / Aleppo mix elsewhere
  else if (def.type === 'pine') species = snow ? (seed % 20 < 13 ? 'spruce' : 'scots_pine') : desert ? 'pine'
    : theater === 'coast' ? pickBy(seed, ['stone_pine', 'stone_pine', 'pine']) : pickBy(seed, ['scots_pine', 'spruce', 'pine']);
  else if (def.type === 'palm') species = 'date_palm';
  else if (def.type === 'bush') species = pickBy(seed, pool('bush', theater));
  else if (def.variant === 'dead' || def.variant === 'dead_tree') species = 'dead_tree';
  else if (def.variant === 'bare_winter') species = pickBy(seed, snow ? ['birch', 'birch', 'birch', 'oak', 'birch'] : ['birch', 'oak', 'beech']); // Norway: birch
  else species = pickBy(seed, pool('tree', theater));
  const H = SPECIES[species].H;
  const scale = def.h ? Math.max(0.35, Math.min(2.5, def.h / ((H[0] + H[1]) / 2))) : 1;
  return {
    species, x: def.x, z: def.z, seed, scale, burnt: !!def.burnt, hero: true, riverside: def.type === 'tree' && !def.species && (!def.variant || def.variant === 'broadleaf'),
    leafless: def.variant === 'bare_winter' ? true : undefined,
    crownBase: def.crownBase, crownR: def.crownR, // placement pruning hints (world/placement.js)
    // walk-under clearance (placement rule e): below head height no limb's WOOD reaches past the trunk's nav footprint
    // (`wood`: the needles stay, walkers brush through them as through a bush) and, when the crown was lifted over an
    // obstacle (placement pruneTree), no part of a limb sags below its top (crownFloor) — conifers.js limbClearance
    clear: def.type === 'bush' ? undefined : [{ y: 1.95, r: treeClearR(def), wood: true }, ...(def.crownFloor ? [{ y: def.crownFloor, r: treeClearR(def) }] : [])],
  };
}

/** Archetype footprint (radius, height at scale 1; scrub-geo.js) for sizing a hero bush to its structure. */
const SCRUB_DIM = { camelthorn: [0.9, 0.83], saltbush: [0.63, 0.85], retama: [1.4, 1.25] };
/**
 * A mission desert bush (structure def + its placement) → a scrub plan entry (scrub.js): the kind from the variant
 * (camel_thorn → camel thorn; scrub_desert → mostly saltbush / retama), scaled to cover the structure's
 * radius `r` and height `h`; `hero` keeps it out of vehicle crushing (the structure still stands there).
 */
export function scrubHero(def, p) {
  const kind = def.variant === 'camel_thorn' ? 'camelthorn' : pickBy(p.seed >>> 5, ['saltbush', 'retama', 'saltbush', 'camelthorn', 'retama']); // the fuller kinds: a bush the player hides by
  const [R, H] = SCRUB_DIM[kind];
  const s = Math.max(0.8, Math.min(2.2, Math.max(((def.r ?? 0.9) * 1.1) / R, (def.h ?? 0.9) / H)));
  return { x: def.x, z: def.z, kind, s, rot: ((p.seed >>> 3) % 628) / 100, variant: p.seed & 1, mound: 0.9, hero: true };
}

/**
 * Everything planted on the map (pure; buildTerrain draws it, tests check it): the mission's own trees and bushes
 * (treePlacement; desert bushes become hero scrub archetypes on their nebkha mounds), the wood filling forest AREAS and
 * its understorey, bocage hedgerows and the farmland's orchards (bocage.js farmland), generic trees by the water turned
 * into willows / alders / poplars. Nothing planted stands in the water (world/veg-shore.js; user 2026-10-08 "giant tree
 * standing on the water"): the mission's own trees and bushes were moved ashore by the placement rules
 * (world/placement.js); the planting made here keeps SHORE_MARGIN m of dry land from the drawn waterline (`shore`: the
 * continuous shore field, else the grid's wet cells).
 * @param {import('../world/grid.js').NavGrid} grid
 * @param {string} theater
 * @param {{mission?:object|null, trees?:object[], forests?:object[], shore?:object|null}} [o] trees / forests: the
 *   mission's point trees and forest areas (map-builder: resolved placement)
 * @returns {{placements:object[], scrubHeroes:object[], farm:object}}
 */
export function plantingPlan(grid, theater, { mission = null, trees = [], forests = [], shore = null } = {}) {
  // farmland fringe (bocage.js: mission.vegetation.farmland): field hedges, crops, orchards clear of gameplay
  const farm = farmland(mission, grid);
  // mission trees → treegen placements; desert bushes become hero instances of the 3D scrub archetypes instead
  // (docs/vegetation.md §3.2: camel thorn / saltbush / retama with woody stems, on their own nebkha mound)
  const scrubHeroes = [], placements = [];
  (trees || []).forEach((d, k) => {
    const p = treePlacement(d, theater, k);
    if (!p) return;
    const desertBush = d.type === 'bush' && !d.species && (d.variant === 'scrub_desert' || d.variant === 'camel_thorn' || (!d.variant && theater === 'desert'));
    if (p.species === 'desert_shrub' || desertBush) scrubHeroes.push(scrubHero(d, p));
    else placements.push(p);
  });
  // visual: true → no gameplay footprint and no gun-arc branch stamp (map-builder stampTreeBranches)
  const visual = (list) => list.map((p) => ({ ...p, visual: true }));
  // forest AREAS (M04, M20): fill the polygon with a Poisson-disc wood (M20 Black Forest edge: mixed with beech/oak)
  const mine = placements.slice(); // the mission's own trees: occupied seeds for the fill
  for (const f of forests || []) {
    const fv = theater !== 'snow' && f.type === 'pine' ? 'pine_frost' : f.variant;
    placements.push(...clearForestFill(fillForest({ ...f, forestVariant: fv }, (d, k) => treePlacement(d, theater, k), { spacing: theater === 'snow' ? 3.7 : 4.4, occupied: mine }), mission?.structures));
    placements.push(...visual(clearForestFill(forestUnderstorey(f, theater), mission?.structures))); // brambles, hazel, fallen boughs on the litter
  }
  // bocage hedgerows (visual; mission.vegetation.hedgerows: [{points, gaps?, h?, standards?}])
  for (const hr of [...(mission?.vegetation?.hedgerows || []), ...farm.hedgerows]) placements.push(...visual(hedgerowPlacements(hr)));
  placements.push(...visual(farm.orchard));
  // off the water: the planting made here (the mission's own trees and bushes were placed ashore by world/placement.js)
  const wetAt = vegetationWetAt(shore, grid), own = new Set(mine);
  for (let k = placements.length - 1; k >= 0; k--) if (!own.has(placements[k]) && !onDryLand(wetAt, placements[k].x, placements[k].z)) placements.splice(k, 1);
  // riverside: willows, alders and poplars on the banks (any tree within ~8 m of water that the mission left generic)
  const wetCell = (x, z) => {
    const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
    return i >= 0 && j >= 0 && i < grid.cols && j < grid.rows && WET_CODES.has(grid.terrain[j * grid.cols + i]);
  };
  for (const p of placements) {
    if (!p.riverside || theater === 'snow' || theater === 'desert') continue;
    let wet = false;
    for (let a = 0; a < 12 && !wet; a++) for (const d of [3, 5.5, 8]) if (wetCell(p.x + Math.cos(a * 0.5236) * d, p.z + Math.sin(a * 0.5236) * d)) { wet = true; break; }
    if (wet) { p.species = pickBy(p.seed >>> 3, ['willow', 'alder', 'willow', 'poplar']); p.scale = Math.min(p.scale, 1.15); }
  }
  return { placements, scrubHeroes, farm };
}

/** Mission `terrain[]` road paths → pre-trampled polylines (worn ruts / slush at mission start). */
export function roadPolylines(mission) {
  return (mission?.terrain || [])
    .filter((t) => t.type === 'path' && t.terrain === 'road' && Array.isArray(t.points) && t.points.length > 1)
    .map((t, i) => ({ points: t.points.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z])), passes: 7, walkers: 3, seed: i + 1, spread: Math.min(1.2, (t.width ?? 3) * 0.2), width: t.width ?? 3, legacy: true, near: (t.width ?? 3) / 2 + 2 }));
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

/** Chain splat painters (forest floor first, roads over it); undefined when none. */
const composePaint = (...fs) => { fs = fs.filter(Boolean); return fs.length ? (x, z, w) => { for (const f of fs) f(x, z, w); } : undefined; };

const presetOf = (renderer) => QUALITY_OF[renderer?.presetName] || 'medium';

/**
 * Build the ground for a finished grid.
 * @param {import('../world/grid.js').NavGrid} grid
 * @param {'desert'|'snow'|'temperate'|'coast'|'night'} theater
 * @param {{renderer?: object, scene?: THREE.Object3D, mission?: object, trees?: object[], forests?: object[], onSpray?: Function,
 *   real?: boolean, ownWater?: boolean}} [ctx] renderer = engine Renderer (null → placeholder); trees = mission tree structure defs
 * @returns {object} handle: {ground, water, ready, heightAt, surfaceAt, groundY, materialAt, frame, stampTrail, recordTrail,
 *   queryTrails, tracksNear, setQuality, stats, dispose}
 */
/** Content key of a road network (null when it cannot be serialised: the splat is then rebuilt every load). */
function netKey(net) {
  try { return dataKey((h) => h.str(JSON.stringify(net))); } catch { return undefined; }
}

/** Identity of the composed splat painter: road network + forest-floor polygons (undefined → not cacheable). */
function paintKeyOf(ctx) {
  const roads = ctx.roads ? netKey(ctx.roads.net) : '-';
  if (roads === undefined) return undefined;
  try { return dataKey((h) => { h.str(roads); h.str(JSON.stringify((ctx.forests || []).map((f) => [f.type, f.variant, f.points]))); h.str(JSON.stringify(ctx.mission?.carves || null)); }); } catch { return undefined; }
}

export function buildTerrain(grid, theater = 'temperate', ctx = {}) {
  const R = ctx.renderer || null;
  if (!canBuildRealTerrain(R) || ctx.real === false) return buildPlaceholderTerrain(grid, theater);
  let quality = presetOf(R);
  const mission = ctx.mission || null;
  // step 3p: ctx.roads (world/roads.js RoadIndex) → soft roads pre-trampled + splat painter; else the legacy paths
  let ruts = ctx.roads ? pretrampleRoads(ctx.roads.net) : roadPolylines(mission);
  // a road that leaves the map is driven on past the edge (as world/apron-field.js lays it over the apron), so its
  // ruts run to the boundary and the apron repeats them from there (art/apron.js) instead of stopping on a line
  const apronOn = !!mission && ctx.apron !== false && mission.apron?.extend !== false;
  if (apronOn) ruts = ruts.map((r) => ({ ...r, points: extendPath(r.points, null, grid.width, grid.depth, r.near ?? 1.5, 16).points }));
  const crossings = apronOn ? edgeCrossings(ruts, grid.width, grid.depth) : [];
  const dry = missionCarves(mission); // dry wadis cut into the ground (art/terrain/carve.js): rock banks, gravel bed
  const paint = composePaint(forestFloorPainter(ctx.forests, (PALETTES[theater] || PALETTES.temperate).layers),
    carvePainter(dry, (PALETTES[theater] || PALETTES.temperate).layers),
    ctx.roads ? terrainPainter(ctx.roads, theater, (PALETTES[theater] || PALETTES.temperate).layers) : null) ?? undefined;
  // continuous shorelines (world/shore-field.js): one field over the map + apron drives both carves, the splat's
  // wet line and the water's shore distance (smooth banks instead of the 0.5 m cell staircase)
  let apronField = null, shore = null;
  try {
    if (mission && ctx.apron !== false) apronField = buildApronField(grid, mission);
    shore = buildShoreField(apronField?.grid ?? grid, mission || {}, apronField
      ? { ox: apronField.ox, oz: apronField.oz, feats: apronField.feats, W: apronField.W, D: apronField.D } : { W: grid.width, D: grid.depth });
  } catch (e) { console.error('[shore] field failed', e); shore = null; }
  // everything planted on the map (pure: plantingPlan) — the mission's trees, forest fill, hedgerows, orchards
  const { placements, scrubHeroes, farm } = plantingPlan(grid, theater, { mission, trees: ctx.trees, forests: ctx.forests, shore });
  const inner = createTerrainHandle(R, new THREE.Group(), grid, theater, {
    scrubHeroes,
    fields: farm.fields,
    quality, flatMask: buildFlatMask(grid), frozenWater: !!mission?.water?.frozen, shore,
    roads: ruts, paint,
    // identity of the painter (road network + forest floor polygons): lets the session cache keep the painted splat
    paintKey: paintKeyOf(ctx),
    exclude: ctx.roads && (ctx.roads.net.roads.some((r) => !r.legacy) || ctx.roads.net.areas.length) ? (x, z) => ctx.roads.covers(x, z) : undefined,
    onSpray: ctx.onSpray, texRes: terrainTexRes(quality, theater), mission, // mission → vegetation profile (season, mix)
  });
  const ground = inner.ground;
  ground.name = 'terrain:ground';
  ground.userData.terrain = true;
  const water = ctx.ownWater ? null : buildMaskedWater(grid, theater); // ownWater: src/art/water owns the surface
  const stats = { trees: placements.length, readyMs: 0 };
  let veg = null, disposed = false, apron = null, apronReady = Promise.resolve(null);
  const t0 = performance.now();
  const pitchDeg = CONFIG.camera?.pitchDeg ?? 40;
  const ready = inner.ready.then(async (t) => {
    if (disposed) return null;
    // scenery past the map edges (art/apron.js): ground + water continuation + forest; before the water's bed capture
    if (mission && ctx.apron !== false) {
      try { apron = createApron(R, ground, t, grid, mission, theater, { trees: ctx.trees || [], quality, pitchDeg, createVegetation, treePlacement, crossings, paint, flatLines: ctx.edgeLines,
        season: vegetationProfile(mission, theater).trees, snow: mission?.treeSnow ?? undefined, field: apronField, shore }); }
      catch (e) { console.error('[apron] build failed', e); apron = null; }
      apronReady = Promise.resolve(apron?.forest).then(() => apron);
    }
    if (placements.length) {
      // snow load on the trees: per mission (`treeSnow`, 0..1.3), else 1 in the snow theater
      veg = await createVegetation(ground, placements, theater, { quality, terrain: t, renderer: R, pitchDeg, snow: mission?.treeSnow ?? undefined, season: vegetationProfile(mission, theater).trees });
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
    /** Continuous shore field (world/shore-field.js) the banks are carved with, or null. */
    shore,
    /** Scenery apron (art/apron.js) once built, else null; `apronReady` resolves with it (or null). */
    get apron() { return apron; },
    get apronReady() { return apronReady; },
    get terrain() { return inner.terrain; },
    get vegetation() { return veg; },
    get quality() { return quality; },
    // past the map edge: the scenery apron's ground (edge runs, telegraph poles stand on it), else the map's
    heightAt: (x, z) => (apron && (x < 0 || z < 0 || x > grid.width || z > grid.depth) ? apron.heightAt(x, z) : inner.heightAt(x, z)),
    /** The drawn ground under (x, z): the terrain mesh's own triangle (heightAt blends its quad), the apron past the edge. */
    surfaceAt: (x, z) => (apron && (x < 0 || z < 0 || x > grid.width || z > grid.depth) ? apron.heightAt(x, z) : inner.surfaceAt(x, z)),
    /** Visual ground height for entity meshes: the undulating surface on land, 0 over water (swimmers, boats). */
    groundY: (x, z) => (wetAt(x, z) ? 0 : h.heightAt(x, z)),
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
      apron?.update(dt, camera);
      if (world && inner.terrain) stampWorld(inner, world, grid);
      if (world) brushWorld(veg, inner.terrain?.grass?.scrub, world, dt);
    },
    setQuality(q) {
      if (!QUALITY_OF[q]) return null;
      quality = q;
      inner.terrain?.setQuality(q);
      inner.terrain?.setTextureRes?.(terrainTexRes(q, theater));
      return veg?.setQuality(q) ?? null;
    },
    dispose() {
      disposed = true;
      veg?.dispose(); veg = null;
      apron?.dispose(); apron = null;
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
/** A paw's print in soft ground is a little bigger than the skin that made it (toes spread, the edges crumble). */
const PAW_SPREAD = 1.2;
/**
 * Visual trail stamping for one displayed frame (docs/terrain-pipeline.md §4.3): boot prints of every walking
 * commando and enemy, a guard dog's paw prints where its paws touch down (the BCD animals: their own feet, by gait),
 * crawl furrows, bodies dragged behind their carrier, and every wheel / track of moving land vehicles. Visual only
 * (`record:false`); gameplay prints come from the 'footprint' event (wireFootprints).
 */
export function stampWorld(t, world, grid) {
  const wet = (x, z) => {
    const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
    return i < 0 || j < 0 || i >= grid.cols || j >= grid.rows || WET_CODES.has(grid.terrain[j * grid.cols + i]);
  };
  for (const list of [world.commandos, world.enemies]) {
    for (const u of list || []) {
      // a real dog's footfalls (art/unit-model.js _footfalls: its paws' touchdowns in the clip playing), drained every frame
      const paws = Array.isArray(u.model?.pawFalls) && u.model.pawFalls.length ? u.model.pawFalls.splice(0) : null;
      if (u.removed || !u.alive || !u.path || u.y > GROUND_Y_MAX || u.state === 'inVehicle' || u.state === 'carried' || u.state === 'jailed') continue;
      if (u.stance === 'swim' || u.stance === 'dive' || wet(u.x, u.z)) continue;
      const id = 'u' + u.id, foot = footOf(u);
      if (foot !== 'boot') { // animals leave their own prints, never boots (user: "Dog is leaving human footprints")
        if (Array.isArray(u.model?.pawFalls)) {
          for (const f of paws || []) if (!wet(f.x, f.z)) t.stampTrail('paw', f.x, f.z, u.heading, { id, foot, side: f.side, width: f.w * PAW_SPREAD, length: f.l * PAW_SPREAD, record: false });
        } else t.stampTrail('animal', u.x, u.z, u.heading, { id, foot, run: u.moveMode === 'run', speed: u.speed, record: false }); // no skeleton: its gait table
        continue;
      }
      if (u.stance === 'crawl' || u.stance === 'prone') t.stampTrail('crawl', u.x, u.z, u.heading, { id, record: false });
      else t.stampTrail('walker', u.x, u.z, u.heading, { id, run: u.moveMode === 'run', record: false });
      // bodies-design §B.5: only a DRAG furrows (heels); a shoulder carry leaves the carrier's prints only
      const heels = dragHeels(u);
      if (heels) t.stampTrail('drag', heels.x, heels.z, heels.heading, { id: id + 'd', record: false });
    }
  }
  for (const v of world.vehicles || []) {
    if (v.removed || v.alive === false || !(Math.abs(v.speed || 0) > 0.05) || (v.y || 0) > GROUND_Y_MAX) continue;
    const type = vehicleTrailType(v);
    if (!type || wet(v.x, v.z)) continue;
    // library models (art/vehicle-model.js): one rut per real wheel / track contact (dual rears, sidecar wheel,
    // half-track fronts + tracks); placeholders: the generic layout of trails.js VEHICLE_TYPES
    _contacts.length = 0;
    const cs = v.model?.trailContacts?.(v, _contacts);
    if (cs?.length) {
      const load = TRAIL_LOAD[type] ?? 1;
      for (const c of cs) {
        if (wet(c.x, c.z)) continue;
        t.stampTrail(c.kind, c.x, c.z, v.heading, { id: `v${v.id}:${c.id}`, width: c.width, load, record: false });
      }
    } else t.stampTrail('vehicle', v.x, v.z, v.heading, { id: 'v' + v.id, type, speed: Math.abs(v.speed), record: false });
  }
}
const _contacts = [];
const _movers = [];
/**
 * Interaction (docs/vegetation.md §4), visual only: walkers and vehicles moving through bushes part and shake them
 * (vegetation.agitate); land vehicles crush the desert scrub under them (scrub.crush). Cover, sight and collision
 * stay with the structures.
 */
export function brushWorld(veg, scrub, world, dt) {
  _movers.length = 0;
  for (const list of [world.commandos, world.enemies]) {
    for (const u of list || []) {
      if (u.removed || !u.alive || !u.path || u.state === 'inVehicle' || u.state === 'carried' || u.state === 'jailed') continue;
      _movers.push({ id: 'u' + u.id, x: u.x, z: u.z, s: u.moveMode === 'run' ? 1.2 : u.stance === 'crawl' || u.stance === 'prone' ? 0.9 : 0.7, r: 1.1 });
    }
  }
  for (const v of world.vehicles || []) {
    if (v.removed || v.alive === false || !(Math.abs(v.speed || 0) > 0.05) || (v.y || 0) > GROUND_Y_MAX || v.def?.kind !== 'land') continue;
    const rad = Math.max(1.4, (v.model?.dims?.w ?? 2.2) * 0.6);
    _movers.push({ id: 'v' + v.id, x: v.x, z: v.z, s: 1.6, r: rad + 1 });
    scrub?.crush?.(v.x, v.z, rad);
  }
  veg?.agitate?.(_movers, dt);
}
/** Rut depth factor per trail layout (trails.js VEHICLE_TYPES load): heavier vehicles cut deeper. */
const TRAIL_LOAD = { car: 0.7, jeep: 0.6, truck: 1, motorcycle: 0.45, halftrack: 1.05, tank: 1.25 };

/** Gameplay 'footprint' events → terrain trail records (queryTrails / QA). The AI list stays world.ai.footprints. */
export function wireTrailRecords(events, handle) {
  if (!events?.on) return () => {};
  const off1 = events.on('footprint', (e) => handle.recordTrail(e.foot && e.foot !== 'boot' ? 'paw' : 'foot', e.x, e.z, e.heading, e.owner?.id ?? e.ownerId ?? null,
    { aiVisible: e.aiVisible !== false, t0: e.t, ...(e.foot && e.foot !== 'boot' ? { foot: e.foot } : null) }));
  // bodies-design §B.5: the heel furrow of a dragged man, recorded by the sim every 0.5 m (render-rate independent)
  const off2 = events.on('dragmark', (e) => handle.recordTrail('drag', e.x, e.z, e.heading, e.owner?.id ?? null, { aiVisible: false, t0: e.t }));
  return () => { (typeof off1 === 'function' ? off1 : () => {})(); (typeof off2 === 'function' ? off2 : () => events.off?.('dragmark'))(); };
}

/** True when `renderer` (engine Renderer or WebGLRenderer) can host the final terrain (browser, live GL context). */
export function canBuildRealTerrain(renderer) {
  const gl = renderer?.renderer?.isWebGLRenderer ? renderer.renderer : renderer?.isWebGLRenderer ? renderer : null;
  return !!gl && typeof document !== 'undefined' && CONFIG.render?.realTerrain !== false;
}
