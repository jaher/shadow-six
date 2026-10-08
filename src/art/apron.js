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
import { edgeCliffOutlines, inPolygon, crossingSource } from '../world/edge-extend.js';
import { buildSplat, buildFlatMask, undulation, PALETTES as LAYER_PALETTES } from './terrain/terrain-layers.js';
import { APRON_MAX_CROSSINGS } from './terrain/terrain-glsl.js';
import { apronBocage, bankField } from './terrain/bocage.js';
import { missionCarves } from './terrain/carve.js';
import { hedgerowPlacements } from './terrain/forest-fill.js';
import { terrainMaterial, splatTexture, sampleCells, cellSignedDistance, carveDepth, WATER_DEPTH, ICE_DEPTH } from './terrain/terrain.js';

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Height field of the apron (pure; unit-testable with a stub heightAt).
 * @param {object} f buildApronField() result
 * @param {{src:string, seed:number, frozen:boolean, heightAt:(x:number,z:number)=>number}} t the map terrain
 * @returns {{heightAt:(x:number,z:number)=>number, flatAt:(x:number,z:number)=>number, range:[number, number]}}
 */
export function apronHeights(f, t, cfg = CONFIG.apron, shore = null, flatLines = []) {
  const g = f.grid, A = f.A, W = f.W, D = f.D;
  // the continuous shore field (world coordinates) when given, else the bilinear cell signed distance (apron grid)
  const wet = shore ? (x, z) => shore.wetAt(x - A, z - A) : sampleCells(cellSignedDistance(g, (c) => c === T.WATER || c === T.SHALLOW), g);
  const deep = shore ? (x, z) => shore.deepAt(x - A, z - A) : sampleCells(cellSignedDistance(g, (c) => c === T.WATER), g);
  const depths = t.frozen ? ICE_DEPTH : WATER_DEPTH;
  const band = cfg.seamBand, fade = cfg.fade;
  let lo = 0, hi = 0;
  // as on the map (art/terrain/terrain.js): roads half-flattened, water banks levelled (buildFlatMask), so a road's
  // banks and berms carry on past the edge instead of fading into the bare relief
  const mask = sampleCells(buildFlatMask(g), g);
  // quays: an edge run with water on one side only (a harbour quay, a canal parapet). Its bank is a wall, not a slope:
  // no carve under the wall or behind it, the full bed right in front of it (the 1 m lattice would otherwise slope the
  // bank across the wall, and the water surface, drawn a little past its cells where the ground dips under it, showed
  // in dashes along the wall's foot)
  const quays = [];
  for (const l of flatLines || []) for (let k = 0; k + 1 < l.points.length; k++) {
    const [ax, az] = l.points[k], [bx, bz] = l.points[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const nx = -(bz - az) / L, nz = (bx - ax) / L, ww = Math.max(0.1, l.hw - 0.6); // the wall's half width (flat lines: + 0.6)
    let wetL = 0, wetR = 0;
    for (const u of [0.25, 0.5, 0.75]) {
      const px = ax + (bx - ax) * u, pz = az + (bz - az) * u;
      if (wet(px + nx * 1.5 + A, pz + nz * 1.5 + A) > 0) wetL++;
      if (wet(px - nx * 1.5 + A, pz - nz * 1.5 + A) > 0) wetR++;
    }
    if ((wetL >= 2) === (wetR >= 2)) continue;
    const s = wetL >= 2 ? -1 : 1; // e = s·(offset along n): > 0 on the dry side
    quays.push({ ax, az, bx, bz, L, nx: nx * s, nz: nz * s, ww });
  }
  const quayAt = (x, z) => { // signed offset off the nearest quay line (> 0 dry side), or null
    let best = null, bd = Infinity;
    for (const q of quays) {
      const u = ((x - q.ax) * (q.bx - q.ax) + (z - q.az) * (q.bz - q.az)) / (q.L * q.L);
      if (u < 0 || u > 1) continue;
      const e = (x - q.ax) * q.nx + (z - q.az) * q.nz;
      if (Math.abs(e) < 2.5 && Math.abs(e) < bd) { bd = Math.abs(e); best = { e, ww: q.ww }; }
    }
    return best;
  };
  const own = (x, z, flat = 0) => {
    let y = undulation(t.src, x, z, t.seed) * (1 - flat) * (1 - mask(x + A, z + A))
      + (t.bank ? t.bank(x, z) : 0) // + bocage earth banks (bocage.js)
      + (t.dry ? t.dry(x, z) : 0); // + dry wadis crossing the edge, at their edge depth (terrain/carve.js)
    let sdW = wet(x + A, z + A);
    const q = quays.length && sdW > -2.5 ? quayAt(x, z) : null;
    if (q && q.e >= -q.ww) return y; // under the quay wall or behind it: no bank
    // in front of it: the full bed on the cell field's 0.5 m staircase; the continuous shore field already runs its bank
    // along the wall (as on the map), and forcing the bed here jogged the bank where the map meets the apron (M12 S quay)
    if (q && !shore) sdW = Math.max(sdW, 0.9);
    if (sdW > -0.4) {
      const wmin = carveDepth(sdW, deep(x + A, z + A), depths);
      const w = Math.min(1, Math.max(0, (sdW + 0.4) / 0.4));
      const carved = t.frozen ? wmin + y * 0.02 : Math.min(y * 0.3, 0) + wmin;
      y = y * (1 - w) + carved * w;
    }
    return y;
  };
  // level ground under the walls / fences / rails that carry on past the edge (as the map's flat mask does under
  // structures): 1 within a run's half width, easing back to the relief over 3 m
  const segs = [];
  for (const l of flatLines || []) for (let k = 0; k + 1 < l.points.length; k++) segs.push([...l.points[k], ...l.points[k + 1], l.hw]);
  const flatAt = (x, z) => {
    let m = 0;
    for (const [ax, az, bx, bz, hw] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const e = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (e < hw + 3) m = Math.max(m, 1 - ss(hw, hw + 3, e));
    }
    return m;
  };
  const heightAt = (x, z) => {
    const qx = Math.min(W, Math.max(0, x)), qz = Math.min(D, Math.max(0, z));
    const d = Math.hypot(x - qx, z - qz); // distance past the map edge (0 inside)
    if (d <= 0) return t.heightAt(x, z);
    const outer = Math.min(x + A, z + A, W + A - x, D + A - z); // distance to the apron's outer edge
    // within the seam band only the map's residual (its own edge height minus this field's: flattening under
    // structures, mesh interpolation) is carried out and faded; the undulation and the water carve come from the same
    // continuous shore field on both sides, so a bank crossing the edge at any angle keeps its line (no extrusion)
    let y = own(x, z, segs.length ? flatAt(x, z) : 0);
    if (d < band) y += (t.heightAt(qx, qz) - own(qx, qz, segs.length ? flatAt(qx, qz) : 0)) * (1 - ss(0, band, d));
    y *= ss(0, fade, outer);
    if (y < lo) lo = y; if (y > hi) hi = y;
    return y;
  };
  /**
   * Whether the lattice cell [x0,x1]x[z0,z1] holds part of a bank or channel slope (needs the fine lattice). The deep
   * field is tested by its range over the cell's corners, edge midpoints and centre, not by its centre value ± the
   * cell radius: it is not a distance everywhere (the nav-rim clamp `deep <= wet - shoreShallowWidth` levels it off at
   * margin - width ≈ 2 m over open sea, M14's whole apron), so only cells it really crosses the slope band in split.
   */
  const fineAt = (x0, z0, x1, z1) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(x1 - x0, z1 - z0) / 2;
    const sw = wet(cx + A, cz + A);
    if (sw > -0.6 - r && sw < 0.6 + r) return true;
    let lo = Infinity, hi = -Infinity;
    for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) {
      const sd = deep(x0 + (x1 - x0) * u + A, z0 + (z1 - z0) * v + A);
      if (sd < lo) lo = sd; if (sd > hi) hi = sd;
    }
    return lo < 0.9 + 0.3 && hi > -0.25 - 0.3; // carveDepth's deep slope (-0.25..0.9) + 0.3 m slack
  };
  return { heightAt, flatAt, fineAt, get range() { return [lo, hi]; } };
}

/** The apron's strip inside the map: lattice line this far in from each edge, its vertices this far under the map. */
export const SEAM_IN = 0.25, INNER_DROP = 0.3;

/**
 * Ring geometry: lattice lines every `step` m plus the map edges, quads strictly inside the map (1 m in from every
 * edge) left out; vertices inside the map sit INNER_DROP m under the map's own surface, from a lattice line SEAM_IN m in
 * from each edge (the strip only closes cracks along the seam; that deep, the map's wheel ruts never let it show).
 * Lattice cells where `fineAt` finds a bank or channel slope are split `fine` x `fine` (0.25 m near the map, like its
 * own mesh; 0.5 m on the far lattice), so a shore keeps its smooth line across the seam and over the apron; where a
 * split cell meets an unsplit one its edge vertices lie on the coarse edge (no crack) and the unsplit cell takes them
 * into its outline as a fan around its centre (no T-junction pinholes).
 */
export function apronGeometry(f, heightAt, mapHeightAt, step = CONFIG.apron.cell, fineAt = null, fine = 4) {
  const A = f.A, W = f.W, D = f.D;
  // lattice lines every `step` m within `near` m of the map, twice as far apart beyond (seen only at low zoom)
  const near = 24;
  const axis = (L) => {
    const s = new Set([0, L, -A, L + A, SEAM_IN, L - SEAM_IN]);
    for (let v = -A; v <= L + A + 1e-9; v += step) {
      const out = v < -near || v > L + near;
      if (!out || Math.round((v + A) / step) % 2 === 0) s.add(+v.toFixed(4));
    }
    return [...s].sort((a, b) => a - b);
  };
  const xs = axis(W), zs = axis(D), nx = xs.length - 1, nz = zs.length - 1;
  const inMap = (x, z) => x > 0 && x < W && z > 0 && z < D;
  const H = (x, z) => (inMap(x, z) ? mapHeightAt(x, z) : heightAt(x, z));
  const hole = (i, j) => xs[i] >= 1 && xs[i + 1] <= W - 1 && zs[j] >= 1 && zs[j + 1] <= D - 1;
  // per-cell split count (0 = left out, 1 = plain quad)
  const n = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    n[j * nx + i] = hole(i, j) ? 0 : fineAt && fineAt(xs[i], zs[j], xs[i + 1], zs[j + 1]) ? fine : 1;
  }
  const cnt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : n[j * nx + i]);
  const pos = [], idx = [], vmap = new Map();
  // shared vertices keyed by position (1/64 m); the height (true, or `y` on a coarse edge) only for new ones
  const vert = (x, z, y = null) => {
    const k = Math.round((x + A + 8) * 64) * 1e6 + Math.round((z + A + 8) * 64);
    let v = vmap.get(k);
    if (v === undefined) { v = pos.length / 3; pos.push(x, y ?? H(x, z), z); vmap.set(k, v); }
    return v;
  };
  const Y = (x, z) => pos[vert(x, z) * 3 + 1]; // a lattice corner's height (shared with the coarse neighbour)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const m = n[j * nx + i];
    if (!m) continue;
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    if (m === 1) {
      const a = vert(x0, z0), b = vert(x1, z0), c = vert(x0, z1), d = vert(x1, z1);
      const kW = cnt(i - 1, j), kE = cnt(i + 1, j), kN = cnt(i, j - 1), kS = cnt(i, j + 1);
      if (kW < 2 && kE < 2 && kN < 2 && kS < 2) { idx.push(a, c, b, b, c, d); continue; }
      // next to a split cell: take its edge vertices into this cell's outline (a fan around the centre), so the
      // shared edge has the same vertices on both sides (no T-junction pinholes at grazing angles)
      const ring = [], ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yc = pos[c * 3 + 1], yd = pos[d * 3 + 1];
      const edge = (k, P, Q, yP, yQ) => { ring.push(vert(P[0], P[1])); for (let s = 1; s < k; s++) { const u = s / k; ring.push(vert(P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u, yP + (yQ - yP) * u)); } };
      edge(Math.max(1, kW), [x0, z0], [x0, z1], ya, yc); // a → c (W), c → d (S), d → b (E), b → a (N)
      edge(Math.max(1, kS), [x0, z1], [x1, z1], yc, yd);
      edge(Math.max(1, kE), [x1, z1], [x1, z0], yd, yb);
      edge(Math.max(1, kN), [x1, z0], [x0, z0], yb, ya);
      const o = vert((x0 + x1) / 2, (z0 + z1) / 2, (ya + yb + yc + yd) / 4);
      for (let k = 0; k < ring.length; k++) idx.push(o, ring[k], ring[(k + 1) % ring.length]);
      continue;
    }
    // edges shared with an unsplit neighbour: vertices on the straight coarse edge
    const flatW = cnt(i - 1, j) === 1, flatE = cnt(i + 1, j) === 1, flatN = cnt(i, j - 1) === 1, flatS = cnt(i, j + 1) === 1;
    const V = [];
    for (let b = 0; b <= m; b++) for (let a = 0; a <= m; a++) {
      const u = a / m, w = b / m, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * w;
      const corner = (a === 0 || a === m) && (b === 0 || b === m);
      let y = null;
      if (!corner && a === 0 && flatW) y = Y(x0, z0) + (Y(x0, z1) - Y(x0, z0)) * w;
      else if (!corner && a === m && flatE) y = Y(x1, z0) + (Y(x1, z1) - Y(x1, z0)) * w;
      else if (!corner && b === 0 && flatN) y = Y(x0, z0) + (Y(x1, z0) - Y(x0, z0)) * u;
      else if (!corner && b === m && flatS) y = Y(x0, z1) + (Y(x1, z1) - Y(x0, z1)) * u;
      V.push(vert(x, z, y));
    }
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const p = b * (m + 1) + a, q = V[p], r = V[p + 1], c = V[p + m + 1], d = V[p + m + 2];
      idx.push(q, c, r, r, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  // normals from the undropped surface: the steep strip would tilt the edge-line normals and light every map edge up
  geo.computeVertexNormals();
  const P = geo.attributes.position.array;
  for (let k = 0; k < P.length; k += 3) if (inMap(P[k], P[k + 2])) P[k + 1] -= INNER_DROP;
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
export function apronTrees(f, mission = {}, trees = [], theater = 'temperate', cfg = CONFIG.apron, avoid = null) {
  const A = f.A, W = f.W, D = f.D, bg = BACKGROUND[theater] || BACKGROUND.temperate;
  const k = mission.apron?.trees ?? 1;
  if (!(k > 0)) return [];
  const band = 20, side = (x, z) => { const d = [z, W - x, D - z, x]; return d.indexOf(Math.min(...d)); }; // N E S W
  const near = [[], [], [], []];
  for (const t of trees) if (Math.min(t.x, t.z, W - t.x, D - t.z) <= band) near[side(t.x, t.z)].push(t);
  const dens = near.map((l, s) => Math.min(0.06, l.length / (band * (s % 2 ? D : W))));
  // nothing inside a rock massif carried on over the apron (art/dressing.js buildCliff, world/edge-extend.js)
  const rock = edgeCliffOutlines(mission.structures, W, D, A + 12).map(({ points: P }) => {
    const xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
    return { P, x0: Math.min(...xs) - 2, x1: Math.max(...xs) + 2, z0: Math.min(...zs) - 2, z1: Math.max(...zs) + 2 };
  });
  const inRock = (x, z) => rock.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1
    && (inPolygon(x, z, r.P) || inPolygon(x + 2, z, r.P) || inPolygon(x - 2, z, r.P) || inPolygon(x, z + 2, r.P) || inPolygon(x, z - 2, r.P)));
  const out = [], cell = 3;
  for (let z = -A; z < D + A; z += cell) for (let x = -A; x < W + A; x += cell) {
    const i = Math.round(x / cell), j = Math.round(z / cell);
    const px = x + hash2(i, j, 1) * cell, pz = z + hash2(i, j, 2) * cell;
    const qx = Math.min(W, Math.max(0, px)), qz = Math.min(D, Math.max(0, pz)), d = Math.hypot(px - qx, pz - qz);
    if (d < 3) continue;
    const c = f.codeAt(px, pz);
    if (c === T.WATER || c === T.SHALLOW || c === T.ROAD) continue;
    if (inRock(px, pz) || avoid?.(px, pz)) continue;
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
 * @param {{trees?:object[], quality?:string, pitchDeg?:number, createVegetation?:Function, treePlacement?:Function,
 *   crossings?:object[], paint?:Function, flatLines?:{points:number[][], hw:number}[], season?:object, snow?:number,
 *   field?:object, shore?:object}} [o] crossings: roads leaving the map (world/edge-extend.js edgeCrossings); paint: the
 *   map's splat painter; flatLines: edge runs to level the ground under; field = a prebuilt buildApronField(); shore =
 *   the continuous shore field (world/shore-field.js) the map's terrain carves with (same banks across the seam)
 */
export function createApron(R, parent, t, grid, mission, theater, o = {}) {
  const t0 = performance.now();
  const f = o.field || buildApronField(grid, mission);
  // bocage past the edges (Normandy / Belgium / Germany farmland): hedges on raised earth banks with bare soil flanks
  const boc = apronBocage(f, mission), bank = bankField(boc.banks);
  const dry = missionCarves(mission);
  const H = apronHeights(f, bank || dry ? { ...t, ...(bank ? { bank } : {}), ...(dry ? { dry: dry.at } : {}) } : t, CONFIG.apron, o.shore || null, o.flatLines);
  // roads that leave the map (art/terrain.js edgeCrossings): their paint and wheel ruts carry on along the road,
  // repeated from the map's last metres (world/edge-extend.js crossingSource) instead of stopping on the edge line
  const X = (o.crossings || []).slice(0, APRON_MAX_CROSSINGS), period = CONFIG.apron.rutPeriod;
  const roadPaint = o.paint && X.length ? (x, z, w) => {
    if (f.inMap(x, z)) return o.paint(x, z, w);
    const q = crossingSource(x, z, X, f.W, f.D, period);
    if (!q) return;
    const v = w.slice();
    o.paint(q.x, q.z, v);
    for (let k = 0; k < w.length; k++) w[k] += (v[k] - w[k]) * q.w;
  } : o.paint;
  const L = (LAYER_PALETTES[theater] || LAYER_PALETTES.temperate).layers, iDirt = L.indexOf('dirt'), iLeaf = L.indexOf('leaves');
  const bankPaint = bank && iDirt >= 0 ? (x, z, w) => {
    const b = bank(x, z);
    if (b < 0.04) return;
    const soilW = ss(0.06, 0.45, b) * 0.8, leafW = iLeaf >= 0 ? ss(0.6, 1.0, b) * 0.35 : 0;  // bare flanks, litter on top
    for (let k = 0; k < 8; k++) w[k] *= 1 - soilW - leafW;
    w[iDirt] += soilW; if (iLeaf >= 0) w[iLeaf] += leafW;
  } : null;
  const paint = roadPaint && bankPaint ? (x, z, w) => { roadPaint(x, z, w); bankPaint(x, z, w); } : (roadPaint || bankPaint || undefined);
  const splat = buildSplat(f.grid, theater, { splatRes: 1, origin: [f.ox, f.oz], frozenWater: t.frozen, seed: t.seed, paint, shore: o.shore || null });
  const tA = splatTexture(splat.a, splat.w, splat.h), tB = splatTexture(splat.b, splat.w, splat.h);
  const Wg = f.grid.width, Dg = f.grid.depth, W = f.W, D = f.D;
  const tex = t.uniforms.uTrailTexel.value; // one map trail texel per neighbour step (rut normals) in the apron's uv
  const XA = Array.from({ length: APRON_MAX_CROSSINGS }, (_, i) => new THREE.Vector4(...(X[i] ? [...X[i].e, ...X[i].d] : [0, 0, 1, 0])));
  const XB = Array.from({ length: APRON_MAX_CROSSINGS }, (_, i) => new THREE.Vector3(...(X[i] ? [X[i].hw, X[i].side, X[i].cos] : [0, 0, 1])));
  // shares every other uniform object with the map (layer arrays, sun, wind, quality toggles, trail targets follow it)
  const U = { ...t.uniforms, tSplatA: { value: tA }, tSplatB: { value: tB },
    uMap: { value: new THREE.Vector4(Wg, Dg, 1 / Wg, 1 / Dg) }, uOrigin: { value: new THREE.Vector2(f.ox, f.oz) },
    uTrailTexel: { value: new THREE.Vector2(tex.x * W / Wg, tex.y * D / Dg) },
    uTrMap: { value: new THREE.Vector4(W, D, 1 / W, 1 / D) }, uXA: { value: XA }, uXB: { value: XB }, uXN: { value: X.length }, uXPeriod: { value: period } };
  const mat = terrainMaterial(U, 'terrainB:apron', { apronTrails: true });
  const geo = apronGeometry(f, H.heightAt, t.heightAt, CONFIG.apron.cell, H.fineAt);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain:apron'; mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.userData.apron = true;
  const skirt = new THREE.Mesh(skirtGeometry(f), mat);
  skirt.name = 'terrain:apronSkirt'; skirt.receiveShadow = false; skirt.userData.apron = true;
  parent.add(mesh, skirt);
  // the map's 3D grass continues past the edge and thins out over grassBand m along a noisy line (no straight edge)
  const grass = t.grass?.setApron ? t.grass : null;
  grass?.setApron({ splat, ox: f.ox, oz: f.oz, heightAt: H.heightAt, band: CONFIG.apron.grassBand });
  const stats = { width: f.A, verts: geo.attributes.position.count, tris: geo.index.count / 3, trees: 0, ms: 0, grass: grass?.apronInstances ?? 0, crossings: X.length };
  let veg = null, disposed = false;
  stats.groundMs = Math.round(performance.now() - t0);
  // background forest trees keep 2.5 m off the hedge lines (no trunk inside a hedge crown); none in an edge run
  const hedges = boc.hedgerows.flatMap((hr) => hedgerowPlacements(hr));
  const hCell = new Set(hedges.map((p) => Math.floor(p.x / 2.5) + ',' + Math.floor(p.z / 2.5)));
  const nearHedge = (x, z) => { const i = Math.floor(x / 2.5), j = Math.floor(z / 2.5); for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (hCell.has((i + a) + ',' + (j + b))) return true; return false; };
  const defs = apronTrees(f, mission, o.trees || [], theater, CONFIG.apron, (x, z) => H.flatAt(x, z) > 0.2).filter((d) => !hedges.length || !nearHedge(d.x, d.z));
  stats.treeDefs = defs.length; stats.hedges = boc.hedgerows.length; stats.hedgePlants = hedges.length;
  const forest = (async () => {
    if ((!defs.length && !hedges.length) || !o.createVegetation || !o.treePlacement) return null;
    const placements = [...defs.map((d, k) => o.treePlacement(d, theater, 100000 + k)).filter(Boolean), ...hedges]
      .map((p) => ({ ...p, hero: false, visual: true, y: H.heightAt(p.x, p.z) }));
    try {
      veg = await o.createVegetation(parent, placements, theater, { quality: o.quality, renderer: R, pitchDeg: o.pitchDeg, maxUnique: 0, terrain: { heightAt: H.heightAt }, season: o.season, snow: o.snow }); // the map's season: bare winter hedges
      if (disposed) { veg.dispose(); veg = null; }
      if (veg) {
        veg.group.name = 'vegetation:apron'; veg.group.userData.apron = true;
        // no unit stands out here: the cards' bottoms may slide up to clear the ground (art/terrain/impostors.js)
        veg.group.traverse((m) => { const U = m.userData?.impostorUniforms; if (U) U.uImpLift.value = 1; });
      }
    } catch (e) { console.warn('[apron] forest failed', e); veg = null; }
    stats.trees = veg?.stats?.trees ?? 0;
    stats.ms = Math.round(performance.now() - t0);
    return veg;
  })();
  return {
    mesh, skirt, field: f, stats, forest,
    /** Road crossings whose ruts the ground repeats, and its uniform set (tests / tools). */
    crossings: X, uniforms: U,
    heightAt: H.heightAt,
    /** [lowest, highest] apron ground y (camera footprint slack). */
    get range() { return H.range; },
    get vegetation() { return veg; },
    update(dt, camera) { veg?.update(dt, camera); },
    dispose() {
      disposed = true;
      parent.remove(mesh, skirt);
      grass?.setApron(null);
      geo.dispose(); skirt.geometry.dispose(); mat.dispose(); tA.dispose(); tB.dispose();
      veg?.dispose(); veg = null;
    },
  };
}
