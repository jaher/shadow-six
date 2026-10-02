/**
 * Scenery apron (design-spec §2.3; user request 2026-09-30 "when moving around the map we should never see the
 * boundaries of the map, you may need to make it wider on all levels"): non-playable ground past every map edge.
 *
 *  - ground: one ring mesh (1 m lattice, lines through the map edges) from the map edge out to CONFIG.apron.width,
 *    reaching 1 m under the map (no crack can show the void); the terrain's own shader and layer arrays with an apron
 *    splat built from the code field (world/apron-field.js) — rivers, roads, the sea, shore rims continue off-map;
 *    heights = the theatre's world-space undulation + the same water carve, blended into the map's own edge heights
 *    over seamBand m (no seam) and settling to y = 0 over the outer `fade` m, where a flat far skirt takes over;
 *  - forest: impostor trees (one instanced draw, no unique meshes) at the density of the map's edge band, thinning
 *    outward to the theatre's background density; none on water / roads or within 3 m of the edge;
 *  - water: buildWater extends every edge-crossing body over the apron (art/water.js extendBodiesOverApron);
 *  - grass: the map's 3D tufts (terrain/grass.js setApron) continue from the apron splat, thinning out over
 *    CONFIG.apron.grassBand m along a noisy line.
 * Never walkable: the nav grid is not touched. Built once, after the map's terrain (art/terrain.js buildTerrain).
 * @module art/apron
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { T } from '../world/grid.js';
import { buildApronField } from '../world/apron-field.js';
import { buildSplat, undulation } from './terrain/terrain-layers.js';
import { apronBocage, bankField } from './terrain/bocage.js';
import { hedgerowPlacements } from './terrain/forest-fill.js';
import { PALETTES as LAYER_PALETTES } from './terrain/terrain-layers.js';
import { terrainMaterial, splatTexture, sampleCells, cellSignedDistance, carveDepth, WATER_DEPTH, ICE_DEPTH } from './terrain/terrain.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Height field of the apron (pure; unit-testable with a stub heightAt).
 * @param {object} f buildApronField() result
 * @param {{src:string, seed:number, frozen:boolean, heightAt:(x:number,z:number)=>number}} t the map terrain
 * @returns {{heightAt:(x:number,z:number)=>number, range:[number, number]}}
 */
export function apronHeights(f, t, cfg = CONFIG.apron) {
  const g = f.grid, A = f.A, W = f.W, D = f.D;
  const wet = sampleCells(cellSignedDistance(g, (c) => c === T.WATER || c === T.SHALLOW), g);
  const deep = sampleCells(cellSignedDistance(g, (c) => c === T.WATER), g);
  const depths = t.frozen ? ICE_DEPTH : WATER_DEPTH;
  const band = cfg.seamBand, fade = cfg.fade;
  let lo = 0, hi = 0;
  const own = (x, z) => {
    let y = undulation(t.src, x, z, t.seed) + (t.bank ? t.bank(x, z) : 0); // + bocage earth banks (bocage.js)
    const sdW = wet(x + A, z + A);
    if (sdW > -0.4) {
      const wmin = carveDepth(sdW, deep(x + A, z + A), depths);
      const w = Math.min(1, Math.max(0, (sdW + 0.4) / 0.4));
      const carved = t.frozen ? wmin + y * 0.02 : Math.min(y * 0.3, 0) + wmin;
      y = y * (1 - w) + carved * w;
    }
    return y;
  };
  const heightAt = (x, z) => {
    const qx = Math.min(W, Math.max(0, x)), qz = Math.min(D, Math.max(0, z));
    const d = Math.hypot(x - qx, z - qz); // distance past the map edge (0 inside)
    if (d <= 0) return t.heightAt(x, z);
    const outer = Math.min(x + A, z + A, W + A - x, D + A - z); // distance to the apron's outer edge
    let y = own(x, z);
    if (d < band) y = t.heightAt(qx, qz) + (y - t.heightAt(qx, qz)) * ss(0, band, d);
    y *= ss(0, fade, outer);
    if (y < lo) lo = y; if (y > hi) hi = y;
    return y;
  };
  return { heightAt, get range() { return [lo, hi]; } };
}

/**
 * Ring geometry: lattice lines every `step` m plus the map edges, quads strictly inside the map (1 m in from every
 * edge) left out; vertices inside the map sit 5 cm under the map's own surface.
 */
export function apronGeometry(f, heightAt, mapHeightAt, step = CONFIG.apron.cell) {
  const A = f.A, W = f.W, D = f.D;
  // lattice lines every `step` m within `near` m of the map, twice as far apart beyond (seen only at low zoom)
  const near = 24;
  const axis = (L) => {
    const s = new Set([0, L, -A, L + A]);
    for (let v = -A; v <= L + A + 1e-9; v += step) {
      const out = v < -near || v > L + near;
      if (!out || Math.round((v + A) / step) % 2 === 0) s.add(+v.toFixed(4));
    }
    return [...s].sort((a, b) => a - b);
  };
  const xs = axis(W), zs = axis(D), nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xs[i], z = zs[j], k = (j * nx + i) * 3;
    const inMap = x > 0 && x < W && z > 0 && z < D;
    pos[k] = x; pos[k + 1] = inMap ? mapHeightAt(x, z) - 0.05 : heightAt(x, z); pos[k + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (xs[i] >= 1 && xs[i + 1] <= W - 1 && zs[j] >= 1 && zs[j + 1] <= D - 1) continue;
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return geo;
}

/** Flat far skirt (y = 0): four quads from the apron's outer rectangle out to `skirt` m. */
export function skirtGeometry(f, skirt = CONFIG.apron.skirt) {
  const A = f.A, W = f.W, D = f.D, a0 = -A, b0 = W + A, c0 = D + A, S = A + skirt;
  const R = [[-S, -S, W + S, a0], [-S, c0, W + S, D + S], [-S, a0, a0, c0], [b0, a0, W + S, c0]]; // x0, z0, x1, z1
  const pos = [], idx = [];
  for (const [x0, z0, x1, z1] of R) {
    const n = pos.length / 3;
    pos.push(x0, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1);
    idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  return geo;
}

/** Theatre background forest (trees / m²) and the tree types it uses when the map has none near an edge. */
const BACKGROUND = {
  snow: { density: 0.006, types: ['pine', 'pine', 'pine', 'tree'] },
  temperate: { density: 0.005, types: ['tree', 'tree', 'pine', 'bush'] },
  coast: { density: 0.003, types: ['tree', 'pine', 'bush'] },
  night: { density: 0.005, types: ['tree', 'pine', 'bush'] },
  desert: { density: 0.0008, types: ['palm', 'bush', 'bush'] },
};
const hash2 = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * Apron tree defs (mission-style {type, x, z, h?}): per map side, the density of the map's own trees in a 20 m band
 * along that edge, thinning (exp(-d / treeFalloff)) toward the theatre background; jittered 3 m lattice; nothing on
 * water, shallows or roads, nor within 3 m of the map. `mission.apron.trees` scales the whole forest (0 = none).
 */
export function apronTrees(f, mission = {}, trees = [], theater = 'temperate', cfg = CONFIG.apron) {
  const A = f.A, W = f.W, D = f.D, bg = BACKGROUND[theater] || BACKGROUND.temperate;
  const k = mission.apron?.trees ?? 1;
  if (!(k > 0)) return [];
  const band = 20, side = (x, z) => { const d = [z, W - x, D - z, x]; return d.indexOf(Math.min(...d)); }; // N E S W
  const near = [[], [], [], []];
  for (const t of trees) if (Math.min(t.x, t.z, W - t.x, D - t.z) <= band) near[side(t.x, t.z)].push(t);
  const dens = near.map((l, s) => Math.min(0.06, l.length / (band * (s % 2 ? D : W))));
  const out = [], cell = 3;
  for (let z = -A; z < D + A; z += cell) for (let x = -A; x < W + A; x += cell) {
    const i = Math.round(x / cell), j = Math.round(z / cell);
    const px = x + hash2(i, j, 1) * cell, pz = z + hash2(i, j, 2) * cell;
    const qx = Math.min(W, Math.max(0, px)), qz = Math.min(D, Math.max(0, pz)), d = Math.hypot(px - qx, pz - qz);
    if (d < 3) continue;
    const c = f.codeAt(px, pz);
    if (c === T.WATER || c === T.SHALLOW || c === T.ROAD) continue;
    if (f.codeAt(px + 2, pz) === T.WATER || f.codeAt(px - 2, pz) === T.WATER || f.codeAt(px, pz + 2) === T.WATER || f.codeAt(px, pz - 2) === T.WATER) continue;
    const s = side(qx, qz), e = dens[s];
    // clumped: low-frequency noise gathers the background forest into stands and clearings
    const clump = 0.35 + 1.3 * hash2(Math.floor(px / 24), Math.floor(pz / 24), 3) * hash2(Math.floor(px / 11), Math.floor(pz / 11), 4);
    const rho = (bg.density * clump + (e - bg.density * clump) * Math.exp(-d / cfg.treeFalloff)) * k;
    if (hash2(i, j, 5) >= rho * cell * cell) continue;
    const src = near[s].length ? near[s][Math.floor(hash2(i, j, 6) * near[s].length)] : null;
    const type = src ? src.type : bg.types[Math.floor(hash2(i, j, 7) * bg.types.length)];
    out.push({ type, x: +px.toFixed(2), z: +pz.toFixed(2), ...(src?.variant ? { variant: src.variant } : {}), ...(src?.species ? { species: src.species } : {}) });
  }
  return out;
}

/**
 * Build the apron for a finished map terrain.
 * @param {object} R engine Renderer (R.renderer = WebGLRenderer)
 * @param {THREE.Object3D} parent where the meshes go (the terrain's ground group)
 * @param {object} t createTerrain() result (uniforms, heightAt, src, seed, frozen)
 * @param {import('../world/grid.js').NavGrid} grid
 * @param {object} mission normalized mission def
 * @param {string} theater
 * @param {{trees?:object[], quality?:string, pitchDeg?:number, createVegetation?:Function, treePlacement?:Function, season?:object, snow?:number}} [o]
 */
export function createApron(R, parent, t, grid, mission, theater, o = {}) {
  const t0 = performance.now();
  const f = buildApronField(grid, mission);
  // bocage past the edges (Normandy / Belgium / Germany farmland): hedges on raised earth banks with bare soil flanks
  const boc = apronBocage(f, mission), bank = bankField(boc.banks);
  const H = apronHeights(f, bank ? { ...t, bank } : t);
  const L = (LAYER_PALETTES[theater] || LAYER_PALETTES.temperate).layers, iDirt = L.indexOf('dirt'), iLeaf = L.indexOf('leaves');
  const paint = bank && iDirt >= 0 ? (x, z, w) => {
    const b = bank(x, z);
    if (b < 0.04) return;
    const soilW = ss(0.06, 0.45, b) * 0.8, leafW = iLeaf >= 0 ? ss(0.6, 1.0, b) * 0.35 : 0;  // bare flanks, litter on top
    for (let k = 0; k < 8; k++) w[k] *= 1 - soilW - leafW;
    w[iDirt] += soilW; if (iLeaf >= 0) w[iLeaf] += leafW;
  } : undefined;
  const splat = buildSplat(f.grid, theater, { splatRes: 1, origin: [f.ox, f.oz], frozenWater: t.frozen, seed: t.seed, paint });
  const tA = splatTexture(splat.a, splat.w, splat.h), tB = splatTexture(splat.b, splat.w, splat.h);
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat); blank.needsUpdate = true;
  const Wg = f.grid.width, Dg = f.grid.depth;
  // shares every other uniform object with the map (layer arrays, sun, wind, quality toggles follow it)
  const U = { ...t.uniforms, tSplatA: { value: tA }, tSplatB: { value: tB }, tTrail: { value: blank }, tFlat: { value: blank },
    uMap: { value: new THREE.Vector4(Wg, Dg, 1 / Wg, 1 / Dg) }, uOrigin: { value: new THREE.Vector2(f.ox, f.oz) } };
  const mat = terrainMaterial(U, 'terrainB:apron');
  const geo = apronGeometry(f, H.heightAt, t.heightAt);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain:apron'; mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.apron = true;
  const skirt = new THREE.Mesh(skirtGeometry(f), mat);
  skirt.name = 'terrain:apronSkirt'; skirt.receiveShadow = false; skirt.userData.apron = true;
  parent.add(mesh, skirt);
  // the map's 3D grass continues past the edge and thins out over grassBand m along a noisy line (no straight edge)
  const grass = t.grass?.setApron ? t.grass : null;
  grass?.setApron({ splat, ox: f.ox, oz: f.oz, heightAt: H.heightAt, band: CONFIG.apron.grassBand });
  const stats = { width: f.A, verts: geo.attributes.position.count, tris: geo.index.count / 3, trees: 0, ms: 0, grass: grass?.apronInstances ?? 0 };
  let veg = null, disposed = false;
  stats.groundMs = Math.round(performance.now() - t0);
  // background forest trees keep 2.5 m off the hedge lines (no trunk inside a hedge crown)
  const hedges = boc.hedgerows.flatMap((hr) => hedgerowPlacements(hr));
  const hCell = new Set(hedges.map((p) => Math.floor(p.x / 2.5) + ',' + Math.floor(p.z / 2.5)));
  const nearHedge = (x, z) => { const i = Math.floor(x / 2.5), j = Math.floor(z / 2.5); for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (hCell.has((i + a) + ',' + (j + b))) return true; return false; };
  const defs = apronTrees(f, mission, o.trees || [], theater).filter((d) => !hedges.length || !nearHedge(d.x, d.z));
  stats.treeDefs = defs.length; stats.hedges = boc.hedgerows.length; stats.hedgePlants = hedges.length;
  const forest = (async () => {
    if ((!defs.length && !hedges.length) || !o.createVegetation || !o.treePlacement) return null;
    const placements = [...defs.map((d, k) => o.treePlacement(d, theater, 100000 + k)).filter(Boolean), ...hedges]
      .map((p) => ({ ...p, hero: false, visual: true, y: H.heightAt(p.x, p.z) }));
    try {
      veg = await o.createVegetation(parent, placements, theater, { quality: o.quality, renderer: R, pitchDeg: o.pitchDeg, maxUnique: 0, terrain: { heightAt: H.heightAt }, season: o.season, snow: o.snow }); // the map's season: bare winter hedges
      if (disposed) { veg.dispose(); veg = null; }
      if (veg) { veg.group.name = 'vegetation:apron'; veg.group.userData.apron = true; }
    } catch (e) { console.warn('[apron] forest failed', e); veg = null; }
    stats.trees = veg?.stats?.trees ?? 0;
    stats.ms = Math.round(performance.now() - t0);
    return veg;
  })();
  return {
    mesh, skirt, field: f, stats, forest,
    heightAt: H.heightAt,
    /** [lowest, highest] apron ground y (camera footprint slack). */
    get range() { return H.range; },
    get vegetation() { return veg; },
    update(dt, camera) { veg?.update(dt, camera); },
    dispose() {
      disposed = true;
      parent.remove(mesh, skirt);
      grass?.setApron(null);
      geo.dispose(); skirt.geometry.dispose(); mat.dispose(); tA.dispose(); tB.dispose(); blank.dispose();
      veg?.dispose(); veg = null;
    },
  };
}
