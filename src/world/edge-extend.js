/**
 * Rock massifs past the map edge (user request 2026-10-01 "When i slide to the side I still can see the boundary of
 * then the terrain ends, extend it so I don't see the boundary at all"): a `cliff` polygon that runs along a map
 * edge used to end in a straight wall ON that edge, which drew the map boundary across the apron. Its visual outline
 * is pushed out over the apron instead: every polygon edge lying on a map side moves `out` m outward, and the faces
 * that meet the side carry on in their own direction (or straight out when they meet it at a shallow angle).
 * Inside the map the outline is unchanged (nav grid, footprints and walkways use the mission points, never this).
 * Also: roads that cross the edge (edgeCrossings / crossingSource: the apron repeats their ruts and paint) and linear
 * scenery ending on an edge (edgeLineExtensions / edgeStructureRuns: walls, fences, wire, rails, telegraph lines).
 * Pure: no three.js / DOM.
 * @module world/edge-extend
 */

const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // outward normals: N (z = 0), E (x = W), S (z = D), W (x = 0)

/** Bit mask of the map sides a point lies on (within `tol` m, or past them). */
export function sidesOf([x, z], W, D, tol) {
  return (z <= tol ? 1 : 0) | (x >= W - tol ? 2 : 0) | (z >= D - tol ? 4 : 0) | (x <= tol ? 8 : 0);
}

const segX = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
/** True when no two non-adjacent edges of the closed polygon cross. */
export function isSimple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segX(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  return true;
}

/**
 * @param {number[][]} points polygon [[x, z], ...] in world metres (either winding)
 * @param {number} W map width (m)
 * @param {number} D map depth (m)
 * @param {number} out how far past the edge the outline goes (m)
 * @param {number} [tol] a vertex this close to a side (or past it) lies on it
 * @param {{dir?:(i:number)=>number[]|null|undefined}} [o] dir(i): the direction the face meeting the side at vertex i
 *   carries on in, instead of its own (a basin's shore following the rock that holds it)
 * @returns {number[][]} the extended polygon, or `points` itself when no edge lies on a map side
 */
export function extendPolygonPastEdges(points, W, D, out, tol = 1.6, o = {}) {
  const P = points.map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.z]));
  const n = P.length;
  if (n < 3 || !(out > 0)) return points;
  const S = P.map((p) => sidesOf(p, W, D, tol));
  // run[i]: the side (0..3) edge i → i+1 lies on, or -1
  const run = P.map((_, i) => {
    const m = S[i] & S[(i + 1) % n];
    if (!m || (m & (m - 1))) return -1; // none, or both ends in the same corner (degenerate)
    return Math.log2(m);
  });
  if (run.every((r) => r < 0)) return points;
  const build = (follow) => {
    const R = [];
    const ext = (V, d, s) => {
      const [nx, nz] = SIDES[s], l = Math.hypot(d[0], d[1]) || 1, dx = d[0] / l, dz = d[1] / l, dn = dx * nx + dz * nz;
      return follow && dn > 0.5 ? [V[0] + (dx * out) / dn, V[1] + (dz * out) / dn] : [V[0] + nx * out, V[1] + nz * out];
    };
    for (let i = 0; i < n; i++) {
      const V = P[i], p = run[(i - 1 + n) % n], q = run[i];
      if (p < 0 && q < 0) R.push(V);
      else if (p < 0) { const U = P[(i - 1 + n) % n]; R.push(V, ext(V, o.dir?.(i) || [V[0] - U[0], V[1] - U[1]], q)); }
      else if (q < 0) { const U = P[(i + 1) % n]; R.push(ext(V, o.dir?.(i) || [V[0] - U[0], V[1] - U[1]], p), V); }
      else if (p === q) R.push([V[0] + SIDES[p][0] * out, V[1] + SIDES[p][1] * out]);
      else {
        const [ax, az] = SIDES[p], [bx, bz] = SIDES[q];
        R.push([V[0] + ax * out, V[1] + az * out], [V[0] + (ax + bx) * out, V[1] + (az + bz) * out], [V[0] + bx * out, V[1] + bz * out]);
      }
    }
    return R;
  };
  const R = build(true);
  return isSimple(R) ? R : build(false);
}

/** Even-odd point-in-polygon test ([[x, z], ...]). */
export function inPolygon(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * Outlines (world [[x, z], ...]) of the mission's rock massifs that reach past a map edge, extended over the apron;
 * used by the cliff dressing (art/props.js) and to keep apron trees out of the rock (art/apron.js).
 */
export function edgeCliffOutlines(structures, W, D, out) {
  const res = [];
  for (const s of structures || []) {
    if (s?.type !== 'cliff' || !(s.points?.length >= 3)) continue;
    const e = extendPolygonPastEdges(s.points, W, D, out);
    if (e !== s.points) res.push({ id: s.id, points: e });
  }
  return res;
}

/**
 * Where polylines (roads, tracks) cross the map boundary, for the apron's ground to continue what lies on them
 * (art/apron.js: wheel ruts and road paint carry on past the edge instead of stopping on a straight line).
 * A crossing is the segment that leaves the map (either direction along the line): `e` its point on the boundary,
 * `d` the unit direction away from the map, `side` 0..3 (N, E, S, W; SIDES), `cos` = d · side normal, `hw` the
 * half width of the band that carries on. Lines leaving at a grazing angle (cos < minCos) are skipped.
 * @param {{points:number[][], width?:number, spread?:number}[]} lines
 * @returns {{e:number[], d:number[], side:number, cos:number, hw:number}[]}
 */
export function edgeCrossings(lines, W, D, o = {}) {
  const minCos = o.minCos ?? 0.25, out = [];
  const inMap = (p) => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= D;
  for (const ln of lines || []) {
    const P = (ln.points || []).map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.z]));
    // the ruts wander up to 1.5 x spread off the centre line; a truck's wheels, their berms and the walkers' prints
    // reach ~2 m beyond (the band fades out over its last metre)
    const hw = Math.max((ln.width ?? 3) / 2 + 1.5, 1.5 * (ln.spread ?? 0.7) + 2) + 1.2;
    for (let k = 0; k + 1 < P.length; k++) {
      let a = P[k], b = P[k + 1];
      if (inMap(a) === inMap(b)) continue;
      if (!inMap(a)) [a, b] = [b, a];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      // first boundary hit from a (inside) towards b (outside)
      let t = 1, side = -1;
      const hit = (tt, s) => { if (tt >= 0 && tt < t) { t = tt; side = s; } };
      if (dz < 0) hit(-a[1] / dz, 0);
      if (dx > 0) hit((W - a[0]) / dx, 1);
      if (dz > 0) hit((D - a[1]) / dz, 2);
      if (dx < 0) hit(-a[0] / dx, 3);
      if (side < 0) continue;
      const d = [dx / L, dz / L], cos = d[0] * SIDES[side][0] + d[1] * SIDES[side][1];
      if (cos < minCos) continue;
      out.push({ e: [a[0] + dx * t, a[1] + dz * t], d, side, cos, hw });
    }
  }
  return out;
}

/**
 * The map point whose ground an apron point (x, z) repeats along a crossing (edgeCrossings), or null when (x, z)
 * is not on one. Along the line the source mirrors back and forth over the last `period` m inside the map (a
 * triangle wave: continuous at the boundary, no seam where it turns), keeping the lateral offset; so ruts and verges
 * run on in the line's own direction.
 * @returns {{x:number, z:number, w:number}|null} w = 1 on the band, falling to 0 over its last metre
 */
export function crossingSource(x, z, crossings, W, D, period = 14) {
  for (const c of crossings) {
    const l = -(x - c.e[0]) * c.d[1] + (z - c.e[1]) * c.d[0];
    if (Math.abs(l) > c.hw) continue;
    const past = c.side === 0 ? -z : c.side === 1 ? x - W : c.side === 2 ? z - D : -x;
    const u = past / c.cos; // distance past the edge along the line
    if (u < 0) continue;
    const t = period - Math.abs((u % (2 * period)) - period);
    return { x: x - (u + t) * c.d[0], z: z - (u + t) * c.d[1], w: Math.min(1, c.hw - Math.abs(l)) };
  }
  return null;
}

/**
 * Linear scenery (walls, fences, wire runs, telegraph lines) that ends on a map side carries on over the apron:
 * for each end of the polyline lying within `tol` m of a side (or past it) and heading out of the map (the direction
 * from a point >= 6 m back, at least `minCos` off the side), a straight run [end, end + len * dir]. Visual only: the
 * mission's own points keep the nav grid / footprints.
 * @returns {number[][][]} extension polylines (two points each), [] when nothing ends on an edge
 */
export function edgeLineExtensions(points, W, D, len, tol = 1.6, minCos = 0.25) {
  const P = (points || []).map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.z]));
  if (P.length < 2 || !(len > 0)) return [];
  const out = [];
  const end = (ix, step) => {
    const a = P[ix], s = sidesOf(a, W, D, tol);
    if (!s) return;
    let k = ix;
    while (k + step >= 0 && k + step < P.length && Math.hypot(P[k][0] - a[0], P[k][1] - a[1]) < 6) k += step;
    const b = P[k], dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz);
    if (L < 1e-6) return;
    const d = [dx / L, dz / L];
    let best = -1;
    for (let q = 0; q < 4; q++) if (s & (1 << q)) best = Math.max(best, d[0] * SIDES[q][0] + d[1] * SIDES[q][1]);
    if (best < minCos) return;
    out.push([[a[0], a[1]], [a[0] + d[0] * len, a[1] + d[1] * len]]);
  };
  end(0, 1);
  end(P.length - 1, -1);
  return out;
}

/** Linear structure types whose runs carry on past the map edge (art/props.js LINEAR_PROPS minus roads / rivers). */
export const EDGE_RUN_TYPES = ['wall', 'fence', 'rail_track', 'trench']; // rivers: the apron's own water carries them on
const BARRIER = new Set(['wall', 'fence']);

/**
 * Visual continuations of the mission's linear structures (walls, fences, wire, rails, trenches) that end on a map
 * edge (edgeLineExtensions): the full `len` for boundary-like runs, a short broken-off stub for ruins / broken
 * fences, none for building walls (sheds). The mission's own runs, nav grid and footprints are untouched.
 * @returns {{def:object, points:number[][], id:string}[]}
 */
export function edgeStructureRuns(structures, W, D, len) {
  const out = [];
  for (const s of structures || []) {
    if (!EDGE_RUN_TYPES.includes(s?.type)) continue;
    const v = String(s.variant ?? '');
    if (/shed|hangar|house|barn/.test(v)) continue;
    const L = /ruin|burnt|broken/.test(v) ? 9 : len;
    const runs = s.segments || (s.points ? [s.points] : []);
    let k = 0;
    for (const run of runs) for (const e of edgeLineExtensions(run, W, D, L)) out.push({ def: s, points: e, id: `${s.id ?? s.type}:edge${k++}` });
  }
  // two walls / fences that cross out there: the one that gets there later stops at the other (a railing meets a
  // canal's parapet instead of carrying on through it and across the water: M15 ruins_nw_rail / parapet_w1)
  const cut = out.map((r) => r.points[1]);
  for (let i = 0; i < out.length; i++) for (let j = 0; j < out.length; j++) {
    if (i === j || !BARRIER.has(out[i].def.type) || !BARRIER.has(out[j].def.type)) continue; // rails / trenches run on
    const [a, b] = out[i].points, [c, d] = out[j].points;
    const t = segParam(a, cut[i], c, cut[j]), u = segParam(c, cut[j], a, cut[i]);
    if (t == null || u == null || t < 1e-3 || u < 1e-3) continue; // (runs leaving from one end point: no cut)
    const li = Math.hypot(b[0] - a[0], b[1] - a[1]) * t, lj = Math.hypot(d[0] - c[0], d[1] - c[1]) * u;
    if (li <= lj) continue;
    const back = Math.min(1, (out[j].def.width ?? 0.5) / 2 + 0.3) / (Math.hypot(cut[i][0] - a[0], cut[i][1] - a[1]) || 1);
    const k = Math.max(0, t - back);
    cut[i] = [a[0] + (cut[i][0] - a[0]) * k, a[1] + (cut[i][1] - a[1]) * k];
  }
  return out.map((r, i) => ({ ...r, points: [r.points[0], cut[i]] })).filter((r) => Math.hypot(r.points[1][0] - r.points[0][0], r.points[1][1] - r.points[0][1]) > 0.5);
}

/** Where segment ab meets segment cd, as the parameter along ab (0..1), or null. */
function segParam(a, b, c, d) {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

const rnd01 = (a, b) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Box building types whose row carries on past the map edge (plain placeholder boxes, no library visual). */
export const EDGE_BUILDING_TYPES = ['flat_roof_house'];

/**
 * A street of flat-roofed houses that ends flush on a map side (M12 house_e1..e3 on x = W: "a block cut at the
 * edge") carries on past it: the town continues as rows of plain houses behind that face — a first row against it
 * stepping up and down around its height, a lane, then rows that get lower and sparser (yards, gaps) — instead of
 * a straight wall with bare ground beyond. Visual only (art/edge-buildings.js); the map, nav grid and footprints
 * are untouched. Axis-aligned box houses (rot a multiple of 90°) whose face lies within `tol` m of a side.
 * @param {object[]} structures mission structures
 * @param {{reach?:number, tol?:number, library?:(s:object)=>boolean}} [o] reach: how far past the edge (m) the town goes
 * @returns {{x:number, z:number, w:number, d:number, h:number, kind:'house'|'yard'}[]} world boxes (centre x/z, extents w along x, d along z)
 */
export function edgeBuildingRows(structures, W, D, o = {}) {
  const tol = o.tol ?? 0.6, reach = o.reach ?? 44;
  const faces = [[], [], [], []]; // per side: [a, b, h] intervals along the side
  for (const s of structures || []) {
    if (!EDGE_BUILDING_TYPES.includes(s?.type) || o.library?.(s)) continue;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !(s.w > 0) || !(s.d > 0)) continue;
    const q = (((s.rot ?? 0) / (Math.PI / 2)) % 2 + 2) % 2;
    if (Math.abs(q - Math.round(q)) > 1e-3) continue;
    const sw = Math.round(q) % 2 ? s.d : s.w, sd = Math.round(q) % 2 ? s.w : s.d, h = s.h ?? 4;
    const x0 = s.x - sw / 2, x1 = s.x + sw / 2, z0 = s.z - sd / 2, z1 = s.z + sd / 2;
    if (z0 <= tol) faces[0].push([x0, x1, h]);
    if (x1 >= W - tol) faces[1].push([z0, z1, h]);
    if (z1 >= D - tol) faces[2].push([x0, x1, h]);
    if (x0 <= tol) faces[3].push([z0, z1, h]);
  }
  const out = [];
  for (let side = 0; side < 4; side++) {
    const F = faces[side].sort((p, q) => p[0] - q[0]);
    // spans of faces touching each other (a continuous street front), each with its mean height
    const spans = [];
    for (const f of F) {
      const s = spans[spans.length - 1];
      if (s && f[0] <= s.b + 1.5) { s.b = Math.max(s.b, f[1]); s.hs.push(f); } else spans.push({ a: f[0], b: f[1], hs: [f] });
    }
    const along = side === 0 || side === 2 ? W : D;
    for (const sp of spans) {
      if (sp.b - sp.a < 10) continue; // a lone shed on the edge: the apron forest / ground does
      const hAt = (u) => { let best = sp.hs[0][2], bd = Infinity; for (const [a, b, h] of sp.hs) { const d = u < a ? a - u : u > b ? u - b : 0; if (d < bd) { bd = d; best = h; } } return best; };
      // rows outward: [offset from the edge, depth, height factor, how much of the span it covers, gap chance]
      const rows = [[0, 9, 1, 0, 0], [12, 10, 0.8, 4, 0.12], [25, 9, 0.6, 8, 0.3], [37, 8, 0.45, 12, 0.5]];
      let seed = side * 7919 + Math.round(sp.a * 13);
      for (const [off, dep0, hk, shrink, gap] of rows) {
        if (off >= reach) break;
        // each row starts / ends at its own jittered place (no rectangle of blocks), shorter outward
        let u = sp.a + shrink * rnd01(seed, 1) - (shrink ? 0 : 0.2), end = sp.b - shrink * rnd01(seed, 2) + (shrink ? 0 : 0.2);
        u = Math.max(u, -reach * 0.3); end = Math.min(end, along + reach * 0.3);
        let k = 0;
        while (u < end - 3) {
          const r1 = rnd01(seed, 10 + k), r2 = rnd01(seed, 50 + k), r3 = rnd01(seed, 90 + k);
          const len = Math.min(end - u, 6 + 7 * r1), dep = dep0 * (0.75 + 0.45 * r2);
          if (r3 >= gap) {
            // heights step up and down around the street's own (one storey ~ 3 m), never under a single storey
            const h = Math.max(3.4, hAt(u + len / 2) * hk + (Math.round(r3 * 4) - 2) * 1.1);
            out.push(box(side, W, D, u, len, off, dep, h, 'house'));
          } else if (r2 > 0.4) out.push(box(side, W, D, u, len, off + dep - 0.5, 0.5, 2.2, 'yard')); // a yard wall where a house is missing
          u += len + (r1 > 0.8 ? 2.5 : 0); // now and then a passage between houses
          k++;
        }
        seed += 101;
      }
    }
  }
  return out;
}

/** A box `len` along side `side` from u, `dep` deep starting `off` m past the edge → world centre / extents. */
function box(side, W, D, u, len, off, dep, h, kind) {
  const c = u + len / 2, n = off + dep / 2;
  if (side === 0) return { x: c, z: -n, w: len, d: dep, h, kind };
  if (side === 1) return { x: W + n, z: c, w: dep, d: len, h, kind };
  if (side === 2) return { x: c, z: D + n, w: len, d: dep, h, kind };
  return { x: -n, z: c, w: dep, d: len, h, kind };
}
