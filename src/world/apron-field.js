/**
 * Apron code field (design-spec §2.3 "never see the map boundary"): the terrain codes of the non-playable scenery
 * ring past the map edges, on a NavGrid of (W + 2A) x (D + 2A) whose (0, 0) corner is world (-A, -A). Pure (no
 * three.js / DOM): art/apron.js turns it into ground, water and forest; unit tests read it directly.
 *
 *  - interior = the real nav grid's codes, copied verbatim (the map itself never changes);
 *  - features crossing an edge continue: mission `terrain` paths (rivers, roads, rail beds) and `roads` polylines
 *    are extended along their end direction; polygons / rects / circles that reach past the edge are drawn whole;
 *  - any other wet / road / non-base edge cell is extruded straight out (lakes, fjords, the sea; patches fade out
 *    after a few noisy metres);
 *  - a shore shallow rim like the map's (mission.shoreShallowWidth);
 *  - `mission.apron` overrides: {width?, terrain?: [features in world coords], extend?: false, trees?: number}.
 * The nav grid is never touched: nothing out here is walkable.
 * @module world/apron-field
 */
import { NavGrid, T } from './grid.js';
import { CONFIG } from '../config.js';
import { sampleCenterline } from './roads.js';
import { extendPolygonPastEdges, edgeStructureRuns, sidesOf, inPolygon as inPoly } from './edge-extend.js';

const CODES = { ground: T.GROUND, road: T.ROAD, sand: T.SAND, snow: T.SNOW, grass: T.GRASS, water: T.WATER, shallow: T.SHALLOW, mud: T.MUD };
const code = (n) => CODES[n] ?? T.GROUND;
const pts2 = (P) => P.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]));
const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Smooth value noise in [0, 1). */
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Apron width (m) for a mission: mission.apron.width ?? CONFIG.apron.width. */
export function apronWidth(mission) {
  return mission?.apron?.width ?? CONFIG.apron.width;
}

/**
 * Extend a polyline's ends that touch / cross the map rect [0,W]x[0,D] (within `near` m) by `len` m along the end
 * segment's direction. Returns {points, widths?} (per-point widths repeat the end widths).
 */
export function extendPath(points, widths, W, D, near, len) {
  const P = pts2(points), Wd = Array.isArray(widths) ? widths.slice() : null;
  if (P.length < 2) return { points: P, widths: Wd };
  const out = (p) => Math.min(p[0], p[1], W - p[0], D - p[1]) <= near;
  const ext = (a, b) => { // a = end point, b = its neighbour
    const dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz) || 1;
    return [a[0] + (dx / L) * len, a[1] + (dz / L) * len];
  };
  // the end direction from a point a few metres back (smooth curves: the last 1-m piece can point anywhere)
  const back = (ix, step) => { let k = ix; const a = P[ix]; while (k + step >= 0 && k + step < P.length && Math.hypot(P[k][0] - a[0], P[k][1] - a[1]) < 6) k += step; return P[k]; };
  if (out(P[0])) { P.unshift(ext(P[0], back(0, 1))); Wd?.unshift(Wd[0]); }
  const n = P.length - 1;
  if (out(P[n])) { P.push(ext(P[n], back(n, -1))); Wd?.push(Wd[Wd.length - 1]); }
  return { points: P, widths: Wd };
}

/**
 * @param {NavGrid} grid the mission's finished nav grid
 * @param {object} mission normalized mission def
 * @param {{width?:number}} [o]
 * @returns {{grid:NavGrid, A:number, W:number, D:number, base:number, ox:number, oz:number, codeAt:(x:number,z:number)=>number, inMap:(x:number,z:number)=>boolean}}
 */
export function buildApronField(grid, mission = {}, o = {}) {
  const A = o.width ?? apronWidth(mission), W = grid.width, D = grid.depth, cell = grid.cell;
  const ext = new NavGrid(W + 2 * A, D + 2 * A, cell);
  const base = code(mission.baseTerrain || 'ground');
  const { cols, rows } = ext, N = cols * rows, t = ext.terrain;
  const icol = Math.round(A / cell), gcols = grid.cols, grows = grid.rows;
  const inside = (i, j) => i >= icol && j >= icol && i < icol + gcols && j < icol + grows;
  const ap = mission.apron || {};
  const sh = (P) => P.map(([x, z]) => [x + A, z + A]);
  const LEN = A + 20;

  // features that leave the map, extended (paths) — also the "explained" mask: their edge cells are not extruded
  const feats = [];
  // A water polygon whose every shore leaving the map ends at a wall that carries on over the apron (a quay, a canal
  // parapet: edgeStructureRuns) follows those walls out (extendPolygonPastEdges) instead of the meandering edge
  // extrusion, and is drawn over the land there, so the harbour keeps meeting its quay past the edge (M12).
  const quayRuns = ap.extend === false ? [] : edgeStructureRuns(mission.structures, W, D, LEN);
  const runEnds = quayRuns.map((r) => r.points[0]);
  const quayBound = (P) => {
    const n = P.length, S = P.map((q) => sidesOf(q, W, D, 1.6));
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!S[i] || ((S[(i + 1) % n] & S[i]) && (S[(i - 1 + n) % n] & S[i]))) continue; // off the edge, or mid-edge
      if (!runEnds.some((e) => Math.hypot(e[0] - P[i][0], e[1] - P[i][1]) < 2)) return false;
      any = true;
    }
    return any;
  };
  // Raised water (a `level` over the map's: the M3 reservoir held up by its dam and rock rims) whose every shore leaving
  // the map ends at a rock massif on that edge: it carries on between those rocks, its shores running along their
  // faces (which carry on too: edge-extend.js edgeCliffOutlines), so the raised lake meets its rock rims past the edge
  // as it does inside the map (no low ground showing between a raised surface and the rock).
  const cliffs = (mission.structures || []).filter((s) => s?.type === 'cliff' && s.points?.length >= 3).map((s) => pts2(s.points));
  const cliffBound = (P) => {
    const n = P.length, S = P.map((q) => sidesOf(q, W, D, 1.6)), dirs = new Map();
    for (let i = 0; i < n; i++) {
      if (!S[i] || ((S[(i + 1) % n] & S[i]) && (S[(i - 1 + n) % n] & S[i]))) continue; // off the edge, or mid-edge
      let best = null, bd = 2.5;
      for (const C of cliffs) for (let k = 0; k < C.length; k++) {
        const c = C[k], dd = Math.hypot(c[0] - P[i][0], c[1] - P[i][1]);
        if (dd >= bd || !(sidesOf(c, W, D, 1.6) & S[i])) continue;
        // the rock's face that leaves the side at this vertex: its neighbour off the side
        const a = C[(k + 1) % C.length], b = C[(k - 1 + C.length) % C.length];
        const inn = !(sidesOf(a, W, D, 1.6) & S[i]) ? a : !(sidesOf(b, W, D, 1.6) & S[i]) ? b : null;
        if (inn) { bd = dd; best = [c[0] - inn[0], c[1] - inn[1]]; }
      }
      if (!best) return null;
      dirs.set(i, best);
    }
    return dirs.size ? dirs : null;
  };
  if (ap.extend !== false) {
    for (const f of mission.terrain || []) {
      if (f.type === 'path' && f.points?.length > 1) {
        const hw = Math.max(...[].concat(f.widths ?? f.width ?? 3)) / 2;
        const e = extendPath(f.points, f.widths, W, D, hw + 2, LEN);
        feats.push({ type: 'path', c: code(f.terrain), points: e.points, widths: e.widths, width: f.width ?? 3 });
      } else if (f.type === 'poly' && f.points) {
        const P = pts2(f.points), c = code(f.terrain), wet = c === T.WATER || c === T.SHALLOW;
        const rock = wet && f.level > 0 && cliffs.length ? cliffBound(P) : null;
        const q = !!rock || (runEnds.length > 0 && wet && quayBound(P));
        feats.push({ type: 'poly', c, points: q ? extendPolygonPastEdges(P, W, D, LEN, 1.6, { dir: (i) => rock?.get(i) }) : P, quay: q });
      }
      else if (f.type === 'rect') feats.push({ type: 'rect', c: code(f.terrain), x: f.x, z: f.z, w: f.w, d: f.d });
      else if (f.type === 'circle') feats.push({ type: 'circle', c: code(f.terrain), x: f.x, z: f.z, r: f.r });
    }
    for (const r of mission.roads || []) {
      if (!Array.isArray(r.points) || r.points.length < 2 || r.closed || r.area) continue;
      // the centre line the road is drawn / rutted along (world/roads.js pretrampleRoads), so the extension leaves in
      // the direction the ruts do
      const P = r.spline === false ? pts2(r.points) : sampleCenterline(r.points, 2, true).map((p) => [p.x, p.z]);
      const w = r.width ?? 6, e = extendPath(P, null, W, D, 1.5, LEN); // world/roads.js ROAD_DEFAULTS.width
      if (e.points.length > P.length) feats.push({ type: 'path', c: T.ROAD, points: e.points, width: w });
    }
  }
  for (const f of ap.terrain || []) feats.push({ ...f, c: code(f.terrain), points: f.points && pts2(f.points) });
  const draw = (g, f, c = f.c) => {
    if (f.type === 'path') g.fillLine(sh(f.points), f.widths ?? f.width, 'terrain', c);
    else if (f.type === 'poly') g.fillPoly(sh(f.points), 'terrain', c);
    else if (f.type === 'rect') g.fillRect(f.x + A, f.z + A, f.w, f.d, 'terrain', c);
    else if (f.type === 'circle') g.fillCircle(f.x + A, f.z + A, f.r, 'terrain', c);
  };
  const explained = new NavGrid(W + 2 * A, D + 2 * A, cell);
  explained.terrain.fill(0);
  for (const f of feats) if (f.type === 'path') draw(explained, f, 1);
  // a quay-bound basin is wholly its walled polygon past the edge: its edge cells are not extruded too (the warped
  // extrusion meandered out past the quay walls and left water on the land side of them: M15 canal W1)
  for (const f of feats) if (f.quay) draw(explained, f, 1);

  // 1. base + 2. edge extrusion. The edge is sampled with a lateral domain warp that grows with the distance past
  // the edge, so extruded shores meander and bays open up instead of running off as straight canals.
  t.fill(base);
  const warp = (s, d, k) => (vnoise(s / 40, d / 48 + k * 7.3) - 0.5) * 2 * Math.min(d, 60) * 0.45
    + (vnoise(s / 9, d / 9 + k * 3.1) - 0.5) * Math.min(d, 10) * 0.4;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (inside(i, j)) continue;
    const ex = i < icol ? icol - i : i >= icol + gcols ? i - icol - gcols + 1 : 0; // cells past the W / E edge
    const ez = j < icol ? icol - j : j >= icol + grows ? j - icol - grows + 1 : 0;
    const dx = ex * cell, dz = ez * cell, d = Math.hypot(dx, dz);
    let gi = Math.min(gcols - 1, Math.max(0, i - icol)), gj = Math.min(grows - 1, Math.max(0, j - icol));
    if (!ex || !dz) gj = Math.min(grows - 1, Math.max(0, gj + Math.round(warp(gj * cell, dx, i < icol ? 1 : 2) / cell)));
    if (!ez || !dx) gi = Math.min(gcols - 1, Math.max(0, gi + Math.round(warp(gi * cell, dz, j < icol ? 3 : 4) / cell)));
    const c = grid.terrain[gj * gcols + gi];
    if (c === base || explained.terrain[(gj + icol) * cols + gi + icol]) continue;
    const wetOrRoad = c === T.WATER || c === T.SHALLOW || c === T.ROAD;
    const lim = wetOrRoad ? Infinity : 3 + 9 * hash(gi >> 3, gj >> 3);
    if (d < lim) t[j * cols + i] = c === T.SHALLOW && d > 3 ? T.WATER : c;
  }
  // 3. extended / overhanging features, in mission order (later ones win, as on the map)
  for (const f of feats) if (!f.quay) draw(ext, f);
  for (const f of feats) if (f.quay) draw(ext, f);
  // ... and ends at its walls: the cells' staircase along a slanted wall poked out past its outer face (a dashed sliver
  // of water on the land side, M15 W3 past the E edge). The outer half of each bounding wall run, from just inside its
  // centre line, is land again.
  for (const f of feats) {
    if (!f.quay) continue;
    for (const r of quayRuns) {
      if (!f.points.some((q) => Math.hypot(q[0] - r.points[0][0], q[1] - r.points[0][1]) < 2.5)) continue;
      const [a, b] = r.points, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (inPoly(mx + nx, mz + nz, f.points)) { nx = -nx; nz = -nz; } // n: away from the water
      // the band [−1.5 cell, ww/2 + 2 cell] off the centre line (cell centres in it): the water cells end about a
      // quarter metre inside the wall's inner face. The water surface is drawn up to 0.7 m past its cells
      // (art/water maskCut) wherever the ground dips under it, and the apron's 1 m lattice lets a slanted bank's
      // triangles dip just past the wall: from there it stays under the wall instead of showing outside it.
      const ww = r.def.width ?? 0.5, lo = -1.5 * cell, hi = ww / 2 + 2 * cell, w = hi - lo, o = (hi + lo) / 2;
      ext.fillLine(sh([[a[0] + nx * o, a[1] + nz * o], [b[0] + nx * o, b[1] + nz * o]]), w, 'terrain', base);
    }
  }
  // 4. the map itself, verbatim
  for (let gj = 0; gj < grows; gj++) t.set(grid.terrain.subarray(gj * gcols, (gj + 1) * gcols), (gj + icol) * cols + icol);
  // 5. shore shallows on apron water within shoreShallowWidth of apron land (as map-builder applyShoreShallows)
  const sw = mission.shoreShallowWidth ?? 2;
  if (sw > 0) shallowRim(ext, sw, (k) => !inside(k % cols, (k / cols) | 0));

  // 6. the outermost 4 m are plain base ground: the flat far skirt samples the splat's clamped border, so rivers /
  // roads must not streak across it (the camera never reaches this ring: art/apron.js, camera.js voidReach)
  const ring = Math.round(4 / cell);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i < ring || j < ring || i >= cols - ring || j >= rows - ring) t[j * cols + i] = base;
  }
  const codeAt = (x, z) => {
    const i = Math.min(cols - 1, Math.max(0, Math.floor((x + A) / cell))), j = Math.min(rows - 1, Math.max(0, Math.floor((z + A) / cell)));
    return t[j * cols + i];
  };
  // feats: the extended terrain features (world coordinates) — the analytic shapes of world/shore-field.js
  return { grid: ext, A, W, D, base, ox: -A, oz: -A, feats, codeAt, inMap: (x, z) => x >= 0 && z >= 0 && x <= W && z <= D };
}

/** Chamfer distance from non-water cells; water cells within `width` m become shallow where `may(k)`. */
function shallowRim(g, width, may) {
  const { cols, rows, terrain, cell } = g, N = cols * rows, INF = 1e9, d2 = Math.SQRT2;
  const dist = new Float32Array(N);
  for (let k = 0; k < N; k++) dist[k] = terrain[k] === T.WATER ? INF : 0;
  const rl = (k, q, c) => { if (dist[q] + c < dist[k]) dist[k] = dist[q] + c; };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const k = j * cols + i; if (!dist[k]) continue;
    if (i > 0) rl(k, k - 1, 1); if (j > 0) { rl(k, k - cols, 1); if (i > 0) rl(k, k - cols - 1, d2); if (i < cols - 1) rl(k, k - cols + 1, d2); } }
  for (let j = rows - 1; j >= 0; j--) for (let i = cols - 1; i >= 0; i--) { const k = j * cols + i; if (!dist[k]) continue;
    if (i < cols - 1) rl(k, k + 1, 1); if (j < rows - 1) { rl(k, k + cols, 1); if (i < cols - 1) rl(k, k + cols + 1, d2); if (i > 0) rl(k, k + cols - 1, d2); } }
  const lim = width / cell;
  for (let k = 0; k < N; k++) if (terrain[k] === T.WATER && dist[k] <= lim && may(k)) terrain[k] = T.SHALLOW;
}
