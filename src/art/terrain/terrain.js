/**
 * createTerrain — asset-driven realistic ground (T-B).
 * Splat-blended CC0 photoscan layers with hex (stochastic) tiling, macro variation, height blending,
 * per-material deformable trails, 3D instanced grass + clutter, snow glints/sastrugi/falling snow, icy edges.
 * @module terrain-b/terrain
 */
import { missionCarves } from './carve.js';
import * as THREE from 'three';
import { PALETTES, buildSplat, splatAt, undulation } from './terrain-layers.js';
import { COMMON, VERT_PARS, VERT_MAIN, VERT_WORLD, FRAG_MAIN, FRAG_ROUGH, FRAG_NORMAL, FRAG_EMIS, FRAG_AO, APRON_TRAIL, APRON_FLAT } from './terrain-glsl.js';
import { TrailSystem } from './trails.js';
import { pfbm } from './noise.js';
import { createGrass, grassPalette } from './grass.js';
import { vegetationProfile, groundTint, swardOf } from './veg-profile.js';
const seasonTint = (veg, layer) => new THREE.Vector3(...groundTint(veg, layer));
import { placeScrub, nebkhaField, spawnClearance } from './scrub.js';
import { createSnowFx, addSnowCover } from './snowfx.js';
import { loadLayerArray } from './layer-image.js';
import { sessionCache as cache, dataKey } from '../../engine/asset-cache.js';

export const WATER_DEPTH = { 5: -1.2, 6: -0.35 };
export const ICE_DEPTH = { 5: -0.06, 6: -0.04 }; // snow theater: frozen ponds sit just below the snow line (T-A)
const Z8 = [0, 0, 0, 0, 0, 0, 0, 0];
const TRAIL_PX = { low: 16, medium: 24, high: 32, ultra: 32 }; // trail RT texels per metre
// per-layer-name gameplay/trail response
// tau: trail life (s), vis: print visibility for AI, coh: cohesion (tread crispness; dry sand slumps)
const LAYER_INFO = {
  sand: { tau: 420, vis: 0.95, coh: 0.3 }, sand2: { tau: 420, vis: 0.95, coh: 0.3 }, wetsand: { tau: 900, vis: 0.9, coh: 0.85 },
  snow: { tau: 2400, vis: 1, coh: 0.9 }, snowold: { tau: 2400, vis: 0.95, coh: 0.85 }, snowpack: { tau: 1800, vis: 0.6, coh: 0.95 },
  mud: { tau: 1800, vis: 0.9, coh: 1 }, grass: { tau: 500, vis: 0.45, coh: 0.6 }, grassdry: { tau: 500, vis: 0.4, coh: 0.55 },
  dirt: { tau: 900, vis: 0.35, coh: 0.7 }, leaves: { tau: 600, vis: 0.3, coh: 0.4 }, gravel: { tau: 600, vis: 0.08, coh: 0.3 },
  road: { tau: 600, vis: 0.15, coh: 0.6 }, rock: { tau: 300, vis: 0.02, coh: 1 }, burnt: { tau: 600, vis: 0.4, coh: 0.5 },
  ice: { tau: 300, vis: 0.05, coh: 1 }, slush: { tau: 900, vis: 0.5, coh: 0.8 },
};

export const TERRAIN_QUALITY = {
  low: { hex: false, sparkle: 0.0, grassDensity: 0.35, grassBlades: 5, clutter: 0.4, snowFlakes: 3000, shadowsGrass: false },
  medium: { hex: true, sparkle: 1.0, grassDensity: 0.6, grassBlades: 7, clutter: 0.7, snowFlakes: 6000, shadowsGrass: false },
  high: { hex: true, sparkle: 1.0, grassDensity: 1.0, grassBlades: 9, clutter: 1.0, snowFlakes: 12000, shadowsGrass: true },
  ultra: { hex: true, sparkle: 1.0, grassDensity: 1.15, grassBlades: 10, clutter: 1.3, snowFlakes: 20000, shadowsGrass: true },
};

/** Layer strip → DataArrayTexture (art/terrain/layer-image.js; WebP strips, 2K ones as a 2-column grid). */
function loadArray(url, srgb, anisotropy, tile) {
  // session cache: a restart / the next mission in the theatre reuses the decoded, uploaded array (no decode,
  // no getImageData, no texture upload); freed when the cache evicts it
  return cache.memoAsync(`layer:${url}|${tile || 0}|${srgb ? 1 : 0}|${anisotropy}`, () => loadLayerArray(url, { srgb, anisotropy, tile }).then((t) => cache.retain(t)), {
    bytes: (t) => t.image.width * t.image.height * t.image.depth * 4 * 1.34, dispose: (t) => t.dispose(),
  });
}

function noiseTexture(size = 256) {
  const d = new Uint8Array(size * size * 4);
  // G: seed 207, rescaled to the old seed-202 statistics (mean 0.459, sd 0.132). Seed 202 ran ~1 sd darker along the
  // texture's border, so every lookup drew a dark grid at its repeat (5.3 m tussocks, 23 m macro): regular stripes
  // across meadows and dunes.
  const g = new Float32Array(size * size);
  let gm = 0, gs = 0;
  for (let k = 0; k < size * size; k++) { const v = pfbm(k % size, Math.floor(k / size), size, 3, 3, 207); g[k] = v; gm += v; gs += v * v; }
  gm /= size * size; gs = Math.sqrt(Math.max(1e-6, gs / (size * size) - gm * gm));
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const o = (j * size + i) * 4;
    d[o] = pfbm(i, j, size, 4, 4, 101) * 255;
    d[o + 1] = Math.max(0, Math.min(255, (0.459 + (g[j * size + i] - gm) / gs * 0.132) * 255));
    d[o + 2] = pfbm(i, j, size, 6, 3, 303) * 255;
    d[o + 3] = pfbm(i, j, size, 8, 5, 404) * 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Bilinear sampler over a per-grid-cell Float32Array (cell centres). */
export function sampleCells(arr, grid) {
  const { cols, rows, cell } = grid;
  return (x, z) => {
    const fx = Math.min(cols - 1, Math.max(0, x / cell - 0.5)), fz = Math.min(rows - 1, Math.max(0, z / cell - 0.5));
    const i = Math.min(cols - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
    const k = j * cols + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + cols] * (1 - tx) + arr[k + cols + 1] * tx) * tz;
  };
}

/**
 * Signed distance (m, cell centres) to the edge of the cells where `pred(code)` holds: > 0 inside, < 0 outside.
 * 8-neighbour chamfer (exact on axes, ~3 % on diagonals); sampled bilinearly (sampleCells) its contours are smooth
 * lines instead of the 0.5 m cell staircase — used to carve river banks and shores.
 */
export function cellSignedDistance(grid, pred) {
  const { cols, rows, cell } = grid, N = cols * rows, INF = 1e9, d2 = cell * Math.SQRT2;
  const inside = new Uint8Array(N);
  for (let k = 0; k < N; k++) inside[k] = pred(grid.terrain[k]) ? 1 : 0;
  const run = (src) => { // distance from each cell to the nearest cell with src[k] = 0
    const d = new Float32Array(N);
    for (let k = 0; k < N; k++) d[k] = src[k] ? INF : 0;
    const rl = (k, q, c) => { if (d[q] + c < d[k]) d[k] = d[q] + c; };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const k = j * cols + i;
      if (i > 0) rl(k, k - 1, cell); if (j > 0) { rl(k, k - cols, cell); if (i > 0) rl(k, k - cols - 1, d2); if (i < cols - 1) rl(k, k - cols + 1, d2); } }
    for (let j = rows - 1; j >= 0; j--) for (let i = cols - 1; i >= 0; i--) { const k = j * cols + i;
      if (i < cols - 1) rl(k, k + 1, cell); if (j < rows - 1) { rl(k, k + cols, cell); if (i < cols - 1) rl(k, k + cols + 1, d2); if (i > 0) rl(k, k + cols - 1, d2); } }
    return d;
  };
  const din = run(inside), dout = run(inside.map((v) => 1 - v)), sd = new Float32Array(N);
  for (let k = 0; k < N; k++) sd[k] = inside[k] ? Math.min(din[k], 1e4) - cell / 2 : -(Math.min(dout[k], 1e4) - cell / 2);
  return smoothSigned(sd, inside, cols, rows);
}

/**
 * Bank smoothing of a cell signed distance: a ~1.5 m tent blur (three 3×3 box passes) evens out the staircase a
 * shallow-angled bank leaves in the cells (one 0.5 m jog every few metres reads as a sawtooth rim), while every
 * cell keeps its side of the line (inside ≥ +0.1, outside ≤ −0.1) so narrow channels and the nav grid's
 * wet/dry split stay where they are. Only the cells along the edge change (channel depths keep).
 */
function smoothSigned(sd, inside, cols, rows) {
  let a = sd, b = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { // horizontal 3-tap
      const k = j * cols + i;
      b[k] = (a[i > 0 ? k - 1 : k] + a[k] + a[i < cols - 1 ? k + 1 : k]) / 3;
    }
    const c = new Float32Array(a.length);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { // vertical 3-tap
      const k = j * cols + i;
      c[k] = (b[j > 0 ? k - cols : k] + b[k] + b[j < rows - 1 ? k + cols : k]) / 3;
    }
    a = c;
  }
  for (let k = 0; k < a.length; k++) {
    const r = sd[k], t = Math.min(1, Math.max(0, (Math.abs(r) - 0.26) / 0.2)), v = a[k] + (r - a[k]) * t; // edge cells only
    a[k] = inside[k] ? Math.max(v, Math.min(r, 0.1)) : Math.min(v, Math.max(r, -0.1));
  }
  return a;
}

/**
 * Smooth carve of liquid water (m, <= 0) from the wet / deep signed distances: a bank slope down to the shallow
 * depth across the wet-cell edge, then a second slope into the deep channel. Land cells stay above the water
 * surface (-0.1 m) and wet cells below it, so the shoreline sits on the cell boundary but follows a smooth line.
 */
export function carveDepth(sdWet, sdDeep, depths = WATER_DEPTH) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const sh = depths[6], dp = depths[5];
  return sh * ss(-0.3, 0.45, sdWet) + (dp - sh) * ss(-0.25, 0.9, sdDeep);
}

/**
 * The ground material: MeshStandardMaterial + the splat / hex-tiling / trail shader chunks bound to the uniform set `U`
 * (createTerrain's; the scenery apron passes a copy sharing the layer arrays with its own splat maps and origin).
 */
export function terrainMaterial(U, key = 'terrainB', o = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff });
  // o.apronTrails: the trail field is read from the map's targets along the road crossings (APRON_TRAIL)
  const tr = o.apronTrails ? (g) => g.replace(/texture\(tTrail, /g, 'apronTrail(').replace(/texture\(tFlat, /g, 'apronFlat(') : (g) => g;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = VERT_PARS + (o.apronTrails ? APRON_TRAIL : '') + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + tr(VERT_MAIN))
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_WORLD);
    sh.fragmentShader = COMMON + (o.apronTrails ? APRON_TRAIL + APRON_FLAT : '') + sh.fragmentShader
      .replace('#include <map_fragment>', tr(FRAG_MAIN))
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAG_EMIS)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export function splatTexture(arr, w, h) {
  const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * @param {THREE.WebGLRenderer|{renderer:THREE.WebGLRenderer, sun?:THREE.DirectionalLight}} renderer project Renderer or raw WebGLRenderer
 * @param {THREE.Scene} scene
 * @param {import('../../world/grid.js').NavGrid} grid
 * @param {'desert'|'temperate'|'snow'|'coast'|'night'} theater
 * @param {{quality?:string, assetBase?:string, seed?:number, segPerM?:number, trailPxPerM?:number,
 *   paint?:(x:number,z:number,w:Float32Array)=>void, grass?:boolean, clutter?:boolean, snowfall?:number,
 *   wind?:{x:number,z:number}, onTrail?:Function}} [opts]
 * @returns {Promise<{mesh:THREE.Mesh, trails:TrailSystem, update:(dt:number,camera?:THREE.Camera)=>void,
 *   stampTrail:(kind:string,x:number,z:number,heading:number,params?:object)=>object,
 *   queryTrails:(x:number,z:number,r:number,o?:object)=>object[], heightAt:(x:number,z:number)=>number,
 *   materialAt:(x:number,z:number)=>object, setQuality:(q:string)=>void, dispose:()=>void}>}
 */
/**
 * Short-sward ground layer (terrain-glsl uTurf): the turf colours come from the grass tufts' own palette for the
 * season (meadow lush tip / dry tip), so the ground between the tufts is the same grass, not a darker paint.
 */
function turfUniforms(veg, on) {
  const pal = grassPalette(veg), m = 0; // archetype 0 = meadow
  const a = pal.uGRoot[m].clone().lerp(pal.uGTip[m], 0.62), b = pal.uDRoot[m].clone().lerp(pal.uDTip[m], 0.7);
  const t = veg.src === 'temperate' || veg.src === 'coast' ? 1 : 0;
  return { uTurf: { value: new THREE.Vector4(on ? t : 0, Math.min(1, veg.dry ?? 0), 0, 0) }, uTurfA: { value: a }, uTurfB: { value: b } };
}

export async function createTerrain(renderer, scene, grid, theater = 'temperate', opts = {}) {
  const gl = renderer.isWebGLRenderer ? renderer : renderer.renderer;
  const P = PALETTES[theater] || PALETTES.temperate;
  const src = P.sourceTheater || (PALETTES[theater] ? theater : 'temperate');
  const base = opts.assetBase || new URL('../../../assets/terrain/', import.meta.url).href;
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
  const W = grid.width, D = grid.depth;
  const windDir = new THREE.Vector2(opts.wind?.x ?? 1, opts.wind?.z ?? 0.25).normalize();

  // texRes 2048 (ultra): 2K albedo + normal arrays (`*_2k.webp`, 2 x 4 grid); 512 (low): `*_512.webp`; 1K data
  // always. A missing 2K / 512 pair falls back to 1K.
  const sfx = (res) => (res >= 2048 ? '_2k' : res <= 512 ? '_512' : '');
  const loadRes = (res) => Promise.all([
    loadArray(`${base}${src}_albedo${sfx(res)}.webp`, true, aniso, res),
    loadArray(`${base}${src}_normal${sfx(res)}.webp`, false, aniso, res),
  ]);
  const norm = (r) => (r >= 2048 ? 2048 : r > 0 && r <= 512 ? 512 : 1024);
  let texRes = norm(opts.texRes);
  const [pair, tDat] = await Promise.all([
    loadRes(texRes).catch(() => { texRes = 1024; return loadRes(1024); }),
    loadArray(`${base}${src}_data.webp`, false, aniso),
  ]);
  let [tAlb, tNor] = pair;
  // session cache: the splat and the heightfield are pure functions of the grid's terrain codes + these options, so
  // a restart / reload of the mission reuses them (and their uploaded textures / buffers)
  const gridKey = dataKey((h) => { h.num(grid.cols); h.num(grid.rows); h.num(grid.cell); h.words(new Uint8Array(grid.terrain.buffer, grid.terrain.byteOffset, grid.terrain.byteLength)); });
  // a mission paint hook is a function: cacheable only with its identity (`paintKey`, e.g. the road network's hash)
  const splatKey = opts.paint && opts.paintKey == null ? null : `terrain:splat:${gridKey}:${theater}:${opts.seed || 7}:${opts.splatRes || 4}:${opts.featherM ?? 1.5}:${opts.splatBlur ?? 0.5}:${!!opts.frozenWater}:${opts.paint ? opts.paintKey : '-'}`;
  const makeSplat = () => {
    const sp = buildSplat(grid, theater, opts);
    return { splat: sp, tA: splatTexture(sp.a, sp.w, sp.h), tB: splatTexture(sp.b, sp.w, sp.h) };
  };
  const SP = splatKey ? cache.memo(splatKey, () => { const v = makeSplat(); cache.retain(v.tA); cache.retain(v.tB); return v; }, {
    bytes: (v) => v.splat.a.length * 2 + v.splat.f32.byteLength, dispose: (v) => { v.tA.dispose(); v.tB.dispose(); },
  }) : makeSplat();
  const splat = SP.splat, tSplatA = SP.tA, tSplatB = SP.tB;
  const tNoise = cache.memo('terrain:noise256b', () => cache.retain(noiseTexture()), { bytes: 256 * 256 * 4 * 1.34, dispose: (t) => t.dispose() });

  // ---- geometry: undulating heightfield, water cells sunk -----------------------------------------
  const seg = opts.segPerM || 4;
  const sx = Math.round(W * seg), sz = Math.round(D * seg);
  // game integration: flatten the undulation under / around structures, raised decks, bridges and water
  // (buildFlatMask), and carve liquid water even in the snow theatre unless the mission's water is frozen
  const frozen = src === 'snow' && !!opts.frozenWater;
  const flatAt = opts.flatMask ? sampleCells(opts.flatMask, grid) : null;
  // banks follow the continuous shore field (world/shore-field.js: smooth mission shapes, sub-cell) when given,
  // else the bilinear cell signed distance
  const wetAt = opts.shore ? opts.shore.wetAt : sampleCells(cellSignedDistance(grid, (t) => t === 5 || t === 6), grid);
  const deepAt = opts.shore ? opts.shore.deepAt : sampleCells(cellSignedDistance(grid, (t) => t === 5), grid);
  const depths = frozen ? ICE_DEPTH : WATER_DEPTH;
  // docs/vegetation.md §3.2: desert scrub is planned before the heightfield so each plant's nebkha (sand mound with a
  // downwind tail) is real terrain: the plant sits in the ground, units walk over it, shadows fall on it
  const veg = vegetationProfile(opts.mission || null, theater, src);
  let scrubPlan = null, mound = null;
  if (veg.scrub && opts.grass !== false && opts.clutter !== false) {
    const L = (n) => P.layers.indexOf(n), w8 = new Float32Array(8);
    const iRoad = L('road'), iRock = L('rock'), iDirt = L('dirt'), iDry = L('grassdry'), iMud = L('mud');
    const road = (x, z) => (splatAt(splat, x, z, w8), w8[iRoad]);
    const clearOfSpawns = spawnClearance(opts.mission || null);
    const cellFree = (x, z) => {
      const i0 = Math.floor(x / grid.cell), j0 = Math.floor(z / grid.cell);
      for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) {
        if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return false;
        const k = j * grid.cols + i;
        if (grid.block[k] || grid.bridge[k] || grid.owner[k] || grid.elev[k] > 0) return false;
      }
      return true;
    };
    scrubPlan = placeScrub({
      W, D,
      runoff: (x, z) => {
        splatAt(splat, x, z, w8);
        const here = w8[iDirt] * 0.5 + w8[iDry] + w8[iMud];
        let verge = 0; for (const [dx, dz] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) verge = Math.max(verge, road(x + dx, z + dz));
        splatAt(splat, x, z, w8);
        return Math.min(1, here + verge * (1 - w8[iRoad]) * 0.6);
      },
      open: (x, z) => {
        if (opts.exclude && opts.exclude(x, z)) return false;
        splatAt(splat, x, z, w8);
        if (w8[iRoad] > 0.25 || w8[iRock] > 0.5) return false;
        if (wetAt(x, z) > -1.5) return false;
        if (flatAt && flatAt(x, z) > 0.6) return false; // plants may stand near pads / roads; their mounds fade out there
        if (!clearOfSpawns(x, z)) return false;
        return cellFree(x, z);
      },
    }, { density: opts.scrubDensity ?? 1, seed: (opts.seed || 7) * 131 });
  }
  // the mission's own desert bushes (art/terrain.js scrubHero): hero archetypes on their mounds; ambient plants give way
  const heroes = opts.scrubHeroes || [];
  if (heroes.length && opts.grass !== false) {
    scrubPlan = (scrubPlan || []).filter((p) => !heroes.some((h) => Math.abs(h.x - p.x) < 4 && Math.hypot(h.x - p.x, h.z - p.z) < 0.6 + h.s * 0.9));
    scrubPlan.push(...heroes);
  }
  if (scrubPlan) mound = nebkhaField(scrubPlan, { x: windDir.x, y: windDir.y });
  // the nebkha mounds are part of the heightfield: key the cached geometry by the plan's mounds
  const moundKey = scrubPlan ? dataKey((h) => { for (const p of scrubPlan) { h.num(p.x); h.num(p.z); h.num(p.s); h.num(p.mound); } }) : '-';
  // dry wadis / gullies cut into the heightfield (art/terrain/carve.js, mission `carves`)
  const dryCarve = missionCarves(opts.mission || null);
  const geoKey = `terrain:height:${gridKey}:${W}:${D}:${seg}:${src}:${opts.seed || 7}:${frozen}:${dryCarve ? dataKey((h) => h.str(dryCarve.key)) : '-'}:${opts.flatMask ? dataKey((h) => h.floats(opts.flatMask)) : '-'}:${moundKey}:${windDir.x.toFixed(4)}:${windDir.y.toFixed(4)}`;
  const { geo, hgt } = cache.memo(geoKey, () => {
    const geo = new THREE.PlaneGeometry(W, D, sx, sz);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W / 2, 0, D / 2);
    const pos = geo.attributes.position;
    const hgt = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      let y = undulation(src, x, z, opts.seed || 7);
      if (flatAt) y *= 1 - flatAt(x, z);
      if (mound) y += mound(x, z) * (flatAt ? Math.max(0, 1 - flatAt(x, z) * 25) : 1); // footprints stay level
      const sdW = wetAt(x, z);
      if (sdW > -0.4) { // near / in water: smooth banks (bilinear signed distance, no cell staircase)
        const wmin = carveDepth(sdW, deepAt(x, z), depths);
        const w = Math.min(1, Math.max(0, (sdW + 0.4) / 0.4));
        const carved = frozen ? wmin + y * 0.02 : Math.min(y * 0.3, 0) + wmin; // flat ice sheet / carved bed
        y = y * (1 - w) + carved * w;
      }
      if (dryCarve) y += dryCarve.at(x, z);
      hgt[v] = y;
      pos.setY(v, y);
    }
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    cache.retain(geo);
    return { geo, hgt };
  }, { bytes: (v) => v.hgt.byteLength * 9, dispose: (v) => v.geo.dispose() });

  // ---- material ----------------------------------------------------------------------------------
  const layerInfo = P.layers.map((n) => LAYER_INFO[n] || { tau: 600, vis: 0.3 });
  const U = {
    tAlb: { value: tAlb }, tNor: { value: tNor }, tDat: { value: tDat },
    tSplatA: { value: tSplatA }, tSplatB: { value: tSplatB }, tNoise: { value: tNoise }, tTrail: { value: null }, tFlat: { value: null },
    uMap: { value: new THREE.Vector4(W, D, 1 / W, 1 / D) }, uOrigin: { value: new THREE.Vector2(0, 0) }, uTrailTexel: { value: new THREE.Vector2() },
    uTile: { value: P.tile.map((t) => 1 / t) }, uSoft: { value: P.soft.slice() }, uWet: { value: P.wet.slice() },
    uSnow: { value: P.snow.slice() }, uGrass: { value: P.grass.slice() }, uIce: { value: (P.ice || Z8).slice() }, uSlush: { value: (P.slush || Z8).slice() },
    uTintL: { value: (P.tint || []).concat(Array(8).fill([1, 1, 1])).slice(0, 8).map((t, k) => new THREE.Vector3(...t).multiply(seasonTint(veg, P.layers[k]))) }, uGrassShade: { value: opts.grass === false ? 0 : 1 }, uSward: { value: new THREE.Vector2(...swardOf(veg, opts.mission?.date)) }, ...turfUniforms(veg, opts.grass !== false), uMeadowMacro: { value: veg.src === 'temperate' ? 1 : 0 }, uDebug: { value: opts.debugTrail ? 1 : 0 }, uHexScale: { value: 1 / 1.6 }, uMacro: { value: 1 }, uSparkle: { value: 1 },
    uHexOn: { value: 1 }, uSunDirW: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    uSunCol: { value: new THREE.Color(1, 1, 1) }, uWind: { value: windDir }, uTime: { value: 0 },
  };
  const mat = terrainMaterial(U);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrainB';
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ---- surface queries + trails ----------------------------------------------------------------------
  const tmpW = new Float32Array(8);
  function materialAt(x, z) {
    splatAt(splat, x, z, tmpW);
    let soft = 0, wet = 0, vis = 0, tau = 0, best = 0, bi = 0, snow = 0, coh = 0;
    for (let k = 0; k < 8; k++) {
      const w = tmpW[k];
      soft += w * P.soft[k]; wet += w * P.wet[k]; snow += w * P.snow[k];
      vis += w * layerInfo[k].vis; tau += w * layerInfo[k].tau; coh += w * (layerInfo[k].coh ?? 0.7);
      if (w > best) { best = w; bi = k; }
    }
    return { name: P.layers[bi], soft, wet, snow, coh, visible: vis, tau, weights: tmpW };
  }
  const trails = new TrailSystem(gl, {
    width: W, depth: D, pxPerM: opts.trailPxPerM || TRAIL_PX[opts.quality] || 32, splatA: tSplatA, splatB: tSplatB,
    tau: layerInfo.map((l) => l.tau), materialAt, onSpray: opts.onSpray,
  });
  U.tTrail.value = trails.texture;
  U.tFlat.value = trails.flatTexture;
  U.uTrailTexel.value.copy(trails.texel);

  function heightAt(x, z) {
    const fx = Math.min(sx - 1e-3, Math.max(0, (x / W) * sx)), fz = Math.min(sz - 1e-3, Math.max(0, (z / D) * sz));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, r = sx + 1;
    const a = hgt[j * r + i], b = hgt[j * r + i + 1], c = hgt[(j + 1) * r + i], d = hgt[(j + 1) * r + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // ---- grass, clutter, weather -------------------------------------------------------------------------
  let quality = TERRAIN_QUALITY[opts.quality] ? opts.quality : 'high';
  const ctx = { gl, scene, sun: renderer.sun || null, grid, theater, src, P, splat, W, D, heightAt, materialAt, trails, windDir, tNoise, opts, addSnowCover, waterSD: wetAt, deepSD: deepAt, veg, scrubPlan };
  const grass = opts.grass === false ? null : createGrass(ctx, TERRAIN_QUALITY[quality]);
  const snowfx = src === 'snow' || opts.snowfall ? createSnowFx(ctx, TERRAIN_QUALITY[quality]) : null;

  const _sun = new THREE.Vector3();
  let time = 0;
  function syncSun() {
    const sun = renderer.sun || scene.getObjectByProperty('isDirectionalLight', true);
    if (!sun) return;
    _sun.copy(sun.position).sub(sun.target.position).normalize();
    U.uSunDirW.value.copy(_sun);
    U.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
  }

  function setQuality(q) {
    if (!TERRAIN_QUALITY[q]) return;
    quality = q;
    const Q = TERRAIN_QUALITY[q];
    U.uHexOn.value = Q.hex ? 1 : 0;
    U.uSparkle.value = Q.sparkle;
    grass?.setQuality(Q);
    snowfx?.setQuality(Q);
  }
  setQuality(quality);

  return {
    mesh, trails, splat, grass, snowfx, uniforms: U, heightAt, materialAt, segPerM: seg, src, seed: opts.seed || 7, frozen,
    update(dt, camera) {
      time += dt;
      U.uTime.value = time;
      syncSun();
      trails.update(dt);
      grass?.update(dt, camera, time);
      snowfx?.update(dt, camera, time);
    },
    stampTrail(kind, x, z, heading, params) {
      const info = trails.stamp(kind, x, z, heading, params);
      if (opts.onTrail) opts.onTrail(kind, x, z, info);
      return info;
    },
    queryTrails(x, z, r, o) { return trails.query(x, z, r, o); },
    /** Gameplay record without a visual stamp (see game-adapter.js 'footprint' wiring). */
    recordTrail(kind, x, z, heading, id, extra) { return trails.record(kind, x, z, heading, id, extra); },
    /**
     * Pre-age a road / track at mission start: `passes` vehicles driven along the polyline with lateral wander,
     * plus optional foot traffic. No gameplay records are written. Gives slush on snow roads, puddled ruts on muddy
     * roads, and worn wheel lines on desert pistes.
     * @param {number[][]} pts polyline [[x, z], …] @param {{passes?:number, spread?:number, type?:string, walkers?:number, seed?:number}} [o]
     */
    preTrample(pts, o = {}) {
      const passes = o.passes ?? 6, spread = o.spread ?? 0.7;
      let sd = o.seed ?? 1;
      const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let p = 0; p < passes + (o.walkers ?? 0); p++) {
        const walker = p >= passes, id = 'pre' + p + '_' + (o.seed ?? 1);
        const off0 = (rnd() - 0.5) * 2 * spread, ph = rnd() * 6.28, type = o.type ?? (rnd() < 0.3 ? 'jeep' : 'truck');
        let s = 0;
        for (let k = 0; k < pts.length - 1; k++) {
          const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), h = Math.atan2(bz - az, bx - ax);
          for (let t = 0; t < L; t += walker ? 0.3 : 0.25) {
            s += walker ? 0.3 : 0.25;
            const off = off0 + Math.sin(s / 9 + ph) * spread * 0.5 + (walker ? (rnd() - 0.5) * 0.3 : 0);
            const x = ax + (bx - ax) * t / L - Math.sin(h) * off, z = az + (bz - az) * t / L + Math.cos(h) * off;
            if (walker) trails.stamp('walker', x, z, h, { id, record: false });
            else trails.stamp('vehicle', x, z, h, { id, type, record: false, load: (o.load ?? 1.25) * (0.85 + 0.3 * rnd()) });
          }
        }
        trails.endSource(id);
      }
      trails.update(0);
    },
    setQuality,
    get quality() { return quality; },
    get texRes() { return texRes; },
    /** Swap the albedo/normal arrays to 512, 1K or 2K (async; keeps the current ones until the new pair decodes). */
    async setTextureRes(res) {
      res = norm(res);
      if (res === texRes) return texRes;
      const want = res;
      texRes = res;
      try {
        const [a, n] = await loadRes(want);
        if (texRes !== want) { cache.release(a); cache.release(n); return texRes; }
        cache.release(tAlb); cache.release(tNor);
        tAlb = a; tNor = n; U.tAlb.value = a; U.tNor.value = n;
      } catch (e) { texRes = 1024; }
      return texRes;
    },
    dispose() {
      scene.remove(mesh);
      cache.release(geo); mat.dispose();
      [tAlb, tNor, tDat, tSplatA, tSplatB, tNoise].forEach((t) => cache.release(t));
      trails.dispose(); grass?.dispose(); snowfx?.dispose();
    },
  };
}
