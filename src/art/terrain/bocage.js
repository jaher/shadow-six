/**
 * Farmland (docs/vegetation.md §3.10, plan step 8): crop fields, wall hedges and the bocage, laid out automatically
 * where they cannot change gameplay. Pure (no THREE): the mission and the nav grid in, plain placement data out.
 *  - In-map fields: rotated rectangles of open grass that no gameplay point or route (enemies and their patrols,
 *    commandos, items, objectives, zones, triggers, vehicles, extraction) comes within `clear` metres of; they hold a
 *    crop or pasture (ground cover only: no hedge or orchard tree a player could mistake for cover).
 *  - Walls and fences: a trimmed hedge backs the wall on its grass side, no taller than the wall (+0.2 m), so the
 *    cover and sight the wall gives are unchanged; skipped near gameplay points.
 *  - Bocage past the map edges (apronBocage, on the never-walkable scenery apron): small hedged fields and a hedge
 *    framing each map margin, every hedge on its raised earth bank (bankField).
 * @module terrain/bocage
 */
import { T } from '../../world/grid.js';
import { rng } from './noise.js';

// not gameplay positions: map dressing, the road network (the grid's ROAD cells keep hedges 2 m off), ambience
const SKIP = new Set(['structures', 'terrain', 'baseTerrain', 'water', 'lighting', 'briefing', 'markers', 'vegetation', 'coneColors', 'rules',
  'roads', 'pavements', 'furniture', 'ambient', 'weather', 'size', 'cameraStart']);

/**
 * Every gameplay position in a mission: points ({x, z}) and polylines (arrays of 2+ points, e.g. patrol routes).
 * @returns {{pts:number[][], lines:number[][][]}}
 */
export function gameplayGeometry(mission) {
  const pts = [], lines = [];
  const isP = (o) => o && typeof o === 'object' && Number.isFinite(o.x) && Number.isFinite(o.z);
  const isA = (o) => Array.isArray(o) && o.length >= 2 && Number.isFinite(o[0]) && Number.isFinite(o[1]) && o.length <= 3;
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 7) return;
    if (Array.isArray(o)) {
      const seq = o.filter((p) => isP(p) || isA(p));
      // a route (waypoints), not a list of entities (enemies, items: each has an id)
      if (seq.length >= 2 && seq.length === o.length && !o.some((p) => p && p.id != null)) lines.push(seq.map((p) => (isP(p) ? [p.x, p.z] : [p[0], p[1]])));
      for (const v of o) walk(v, depth + 1);
      return;
    }
    if (isP(o)) pts.push([o.x, o.z]);
    for (const k in o) if (depth > 0 || !SKIP.has(k)) walk(o[k], depth + 1);
  };
  walk(mission, 0);
  return { pts, lines };
}

/** Distance from (x, z) to segment a-b. */
function segDist(x, z, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], L = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / L));
  return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
}

/**
 * Clearance tester for a mission on its grid.
 * @returns {(x:number, z:number, clear:number, struct?:number)=>boolean}
 */
export function clearanceTest(mission, grid) {
  const { pts, lines } = gameplayGeometry(mission);
  const cellOK = (i, j) => i >= 0 && j >= 0 && i < grid.cols && j < grid.rows;
  // struct: metres kept off structures, roads and water (< 0: the cell's own terrain only, e.g. inside a field
  // where a mission tree or rock may stand)
  return (x, z, clear, struct = 2) => {
    const i0 = Math.floor(x / grid.cell), j0 = Math.floor(z / grid.cell);
    if (!cellOK(i0, j0)) return false;
    const t0 = grid.terrain[j0 * grid.cols + i0];
    if (t0 !== T.GRASS && (struct >= 0 || t0 !== T.GROUND)) return false;
    const r = struct < 0 ? -1 : Math.ceil(struct / grid.cell);
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (!cellOK(i, j)) continue;
      const k = j * grid.cols + i, t = grid.terrain[k];
      if (grid.block[k] || grid.owner[k] || (grid.elev && grid.elev[k] > 0) || t === T.ROAD || t === T.WATER || t === T.SHALLOW) return false;
    }
    for (const p of pts) if (Math.abs(p[0] - x) < clear && Math.abs(p[1] - z) < clear && Math.hypot(p[0] - x, p[1] - z) < clear) return false;
    for (const l of lines) for (let s = 0; s + 1 < l.length; s++) if (segDist(x, z, l[s], l[s + 1]) < clear) return false;
    return true;
  };
}

/**
 * Lay out the farmland: fields packed into the open grass that no gameplay point or route comes near. Each field is
 * a rotated rectangle (12–40 m) whose whole area and hedge line pass the clearance test; a hedgerow runs round it
 * with a gate gap, and it holds a crop, an orchard or pasture. Hedges also back walls (wallHedges).
 * @param {object} mission mission def (vegetation.farmland: {clear?, crops?: string|string[], orchards?, walls?, max?})
 * @param {object} grid NavGrid
 * @returns {{hedgerows:object[], fields:{poly:number[][], kind:string, along:number[]}[], orchard:object[]}}
 */
export function farmland(mission, grid) {
  const o = mission?.vegetation?.farmland;
  const out = { hedgerows: [], fields: [], orchard: [] };
  if (!o || !grid) return out;
  const clear = o.clear ?? 9, ok = clearanceTest(mission, grid), r = rng((mission.seed ?? 77) + 4409);
  const W = grid.cols * grid.cell, D = grid.rows * grid.cell, cols = Math.ceil(W), used = new Uint8Array(cols * Math.ceil(D));
  const tries = o.tries ?? 8000, max = o.max ?? 14;
  for (let t = 0; t < tries && out.fields.length < max; t++) {
    const big = 1 - t / tries;                                   // try big fields first, then fill with smaller ones
    const w = 12 + r() * 28 * big, d = 9 + r() * 20 * big;
    const th = (r() - 0.5) * 0.7 + (r() < 0.5 ? 0 : Math.PI / 2), ax = Math.cos(th), az = Math.sin(th);
    const cx = r() * W, cz = r() * D;
    const at = (u, v) => [cx + ax * u - az * v, cz + az * u + ax * v];
    let fits = true;
    for (let u = -w / 2; u <= w / 2 + 1e-6 && fits; u += 2) for (let v = -d / 2; v <= d / 2 + 1e-6; v += 2) {
      const [x, z] = at(u, v);
      if (x < 0.5 || z < 0.5 || x > W - 0.5 || z > D - 0.5 || used[Math.floor(z) * cols + Math.floor(x)] || !ok(x, z, clear, -1)) { fits = false; break; }
    }
    // the hedge line: clear of gameplay everywhere; where it would run into a structure, a tree or a road it breaks
    const gaps = [];
    for (let k = 0, s0 = 0; k < 4 && fits; s0 += k % 2 ? d : w, k++) {
      const L = k % 2 ? d : w, [u0, v0, u1, v1] = [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]][k];
      for (let e = 0; e <= L; e += 0.7) {
        const [x, z] = at(u0 + (u1 - u0) * e / L, v0 + (v1 - v0) * e / L);
        if (!ok(x, z, clear, -1)) { fits = false; break; }
        if (!ok(x, z, clear, 0.6)) gaps.push([s0 + e - 1.2, s0 + e + 1.2]);
      }
    }
    if (fits && gaps.reduce((a, g) => a + g[1] - g[0], 0) > (w + d) * 0.9) fits = false;   // mostly broken: no field
    if (!fits) continue;
    for (let u = -w / 2 - 1.5; u <= w / 2 + 1.5; u += 0.5) for (let v = -d / 2 - 1.5; v <= d / 2 + 1.5; v += 0.5) {
      const [x, z] = at(u, v), i = Math.floor(x), j = Math.floor(z);
      if (i >= 0 && j >= 0 && i < cols && x < W && z < D) used[j * cols + i] = 1;
    }
    const n = out.fields.length;
    const c = [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)];
    const gate = 2 + r() * (w - 6);
    // no hedge round an in-map field: a visual-only 2.5 m hedge on walkable grass reads as cover it does not give
    // (critic round 2). The bocage hedges live past the map edge (apronBocage); the field keeps its crop / pasture.
    void gate; void gaps;
    const kind = pickField({ ...o, orchards: false }, r, w, d);
    const ins = (u, v) => at(u * (w / 2 - 1.6), v * (d / 2 - 1.6));
    out.fields.push({ poly: [ins(-1, -1), ins(1, -1), ins(1, 1), ins(-1, 1)], kind, along: [ax, az] });
    if (kind === 'orchard') for (let u = -w / 2 + 3.5; u < w / 2 - 3; u += 6 + r()) for (let v = -d / 2 + 3.5; v < d / 2 - 3; v += 6.5) {
      const [x, z] = at(u + (r() - 0.5) * 0.8, v + (r() - 0.5) * 0.8);
      if (ok(x, z, clear, 1.5)) out.orchard.push({ species: 'apple', x, z, seed: Math.floor(r() * 1e9), scale: 0.85 + 0.3 * r(), hero: true });
    }
  }
  if (o.walls !== false) out.hedgerows.push(...wallHedges(mission, ok, r));
  return out;
}

/** Field use: orchards on deep fields when allowed, else the mission's crop (or pasture) at random. */
function pickField(o, r, len, depth) {
  const u = r();
  if (o.orchards !== false && depth >= 12 && len >= 14 && u < (o.orchards ?? 0.3)) return 'orchard';
  const crop = Array.isArray(o.crops) ? o.crops[Math.floor(r() * o.crops.length)] : o.crops;
  if (r() < 0.72 && crop && crop !== 'none') return crop;
  return 'pasture';
}

/** Trimmed hedges backing walls and fences on their grass side (≤ wall height + 0.2 m: cover unchanged). */
function wallHedges(mission, ok, r) {
  const out = [];
  for (const s of mission.structures || []) {
    if ((s.type !== 'wall' && s.type !== 'fence') || !Array.isArray(s.points) || /hedgehog|wire|railing|tank/.test(s.variant || '')) continue;
    const h = Math.min(2.2, (s.h ?? 1.4) + 0.2), off = (s.width ?? 0.5) / 2 + 0.85;
    for (let i = 0; i + 1 < s.points.length; i++) {
      const [ax, az] = s.points[i], [bx, bz] = s.points[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 4) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      const n0 = out.length;
      for (const side of [1, -1]) {
        const pts = [];
        for (let d = 0.8; d <= L - 0.8; d += 1) {
          const x = ax + (bx - ax) * (d / L) + nx * off * side, z = az + (bz - az) * (d / L) + nz * off * side;
          if (ok(x, z, 6, 0.4)) pts.push([x, z]);
          else { if (pts.length >= 5) out.push({ points: [pts[0], pts[pts.length - 1]], h, seed: Math.floor(r() * 1e9), standards: false }); pts.length = 0; }
        }
        if (pts.length >= 5) out.push({ points: [pts[0], pts[pts.length - 1]], h, seed: Math.floor(r() * 1e9), standards: false });
        if (out.length > n0) break; // one side per wall: the first with grass
      }
    }
  }
  return out;
}

const ss01 = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Bocage past the map edges (docs/vegetation.md §3.10; critic round 2: Normandy had almost no bocage, and visual-only
 * hedges inside the map looked like cover they do not give). On the scenery apron (art/apron.js, never walkable)
 * the farmland continues as a small-field bocage: a field lattice (~45-70 m, jittered, meandering edges, some edges
 * dropped for bigger fields) plus a hedge framing each map margin 6-10 m outside the edge. Each hedge stands on its
 * earth bank (talus, 1-1.5 m, exposed soil), with gate gaps that cut the bank too. Only on grass / bare ground of the
 * apron code field, ≥ 2.5 m off roads and water, ≥ 5 m past the map edge, ≥ 8 m inside the apron's outer edge.
 * @param {{A:number, W:number, D:number, codeAt:(x:number,z:number)=>number}} f apron code field (world/apron-field.js)
 * @param {object} mission (vegetation.farmland or vegetation.bocage; `apron: false` turns it off)
 * @returns {{hedgerows:object[], banks:{pts:number[][], gaps:number[][], h:number}[]}}
 */
export function apronBocage(f, mission) {
  const o = mission?.vegetation?.bocage || mission?.vegetation?.farmland;
  const out = { hedgerows: [], banks: [] };
  if (!o || o.apron === false || !f || !(f.A > 0)) return out;
  const { A, W, D } = f, r = rng((mission.seed ?? 77) + 9127);
  const soil = (x, z) => { const c = f.codeAt(x, z); return c === T.GRASS || c === T.GROUND; };
  const usable = (x, z) => {
    const qx = Math.min(W, Math.max(0, x)), qz = Math.min(D, Math.max(0, z));
    if (Math.hypot(x - qx, z - qz) < 5 || x < -A + 8 || z < -A + 8 || x > W + A - 8 || z > D + A - 8) return false;
    return soil(x, z) && soil(x + 2.5, z) && soil(x - 2.5, z) && soil(x, z + 2.5) && soil(x, z - 2.5);
  };
  // a candidate line → runs of usable ground (1 m steps), each run a hedgerow on a bank with a gate gap
  const addLine = (pts) => {
    const dense = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L));
      for (let k = 0; k < n; k++) dense.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    dense.push(pts[pts.length - 1]);
    let run = [];
    const flush = () => {
      if (run.length >= 10) {
        const simp = run.filter((_, i) => i % 4 === 0 || i === run.length - 1), L = run.length - 1;
        const g0 = 4 + r() * Math.max(0, L - 12), gaps = L > 24 ? [[g0, g0 + 3.5]] : []; // a field gate
        const h = 2.0 + 0.9 * r();
        out.hedgerows.push({ points: simp, gaps, seed: Math.floor(r() * 1e9), h, standards: true, spacing: 1.9, hero: false });
        out.banks.push({ pts: simp, gaps, h: 1.0 + 0.5 * r() });
      }
      run = [];
    };
    for (const p of dense) { if (usable(p[0], p[1])) run.push(p); else flush(); }
    flush();
  };
  // meandering polyline a → b (midpoint displacement, ±6 % of the length)
  const meander = (a, b) => {
    let pts = [a, b];
    for (let lvl = 0; lvl < 3; lvl++) {
      const nx = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), k = (r() - 0.5) * 0.12 * L;
        nx.push(pts[i], [(ax + bx) / 2 - (bz - az) / L * k, (az + bz) / 2 + (bx - ax) / L * k]);
      }
      nx.push(pts[pts.length - 1]); pts = nx;
    }
    return pts;
  };
  // 1) the margin hedge: a hedge line framing each map side 6-10 m out (the map reads as one field of the bocage)
  const off = 6 + 4 * r();
  const corners = [[-off, -off], [W + off, -off], [W + off, D + off], [-off, D + off]];
  for (let k = 0; k < 4; k++) addLine(meander(corners[k], corners[(k + 1) % 4]));
  // 2) the field lattice over the whole apron
  const S = o.fieldSize ?? 56, x0 = -A, z0 = -A, nx = Math.ceil((W + 2 * A) / S), nz = Math.ceil((D + 2 * A) / S);
  const node = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) node.push([x0 + i * S + (r() - 0.5) * S * 0.45, z0 + j * S + (r() - 0.5) * S * 0.45]);
  const N = (i, j) => node[j * (nx + 1) + i];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    if (i < nx && r() > 0.16) addLine(meander(N(i, j), N(i + 1, j)));
    if (j < nz && r() > 0.16) addLine(meander(N(i, j), N(i, j + 1)));
  }
  return out;
}

/**
 * Earth-bank height field (pure): the bocage talus under each hedge — a flat-topped ridge (top ~1 m wide, base
 * ~3.4 m) of height `h`, cut by the gates. Bucketed segments (8 m) for fast lookups.
 * @param {{pts:number[][], gaps:number[][], h:number}[]} banks
 * @returns {((x:number, z:number) => number)|null} metres to add to the ground (0 off the banks)
 */
export function bankField(banks) {
  if (!banks?.length) return null;
  const B = 8, buckets = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const b of banks) {
    let s = 0;
    for (let i = 0; i + 1 < b.pts.length; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      const seg = { ax, az, bx, bz, L, s0: s, h: b.h, gaps: b.gaps };
      const i0 = Math.floor((Math.min(ax, bx) - 2) / B), i1 = Math.floor((Math.max(ax, bx) + 2) / B);
      const j0 = Math.floor((Math.min(az, bz) - 2) / B), j1 = Math.floor((Math.max(az, bz) + 2) / B);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) { const k = key(ii, j); (buckets.get(k) || buckets.set(k, []).get(k)).push(seg); }
      s += L;
    }
  }
  return (x, z) => {
    const list = buckets.get(key(Math.floor(x / B), Math.floor(z / B)));
    if (!list) return 0;
    let y = 0;
    for (const g of list) {
      const vx = g.bx - g.ax, vz = g.bz - g.az, t = Math.max(0, Math.min(1, ((x - g.ax) * vx + (z - g.az) * vz) / (g.L * g.L || 1)));
      const d = Math.hypot(x - g.ax - vx * t, z - g.az - vz * t);
      if (d > 1.8) continue;
      const at = g.s0 + t * g.L;
      let cut = 1;
      for (const [a, b] of g.gaps) cut = Math.min(cut, ss01(0, 1.2, Math.max(a - at, at - b))); // the gate cuts the bank
      y = Math.max(y, g.h * (1 - ss01(0.5, 1.7, d)) * cut);
    }
    return y;
  };
}
