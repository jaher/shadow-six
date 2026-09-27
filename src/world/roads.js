/**
 * Road & pavement network (PROGRESS step 3p) — pure data, no three.js (runs in Node tests).
 *
 * A mission describes its ground surfaces with three optional schema fields (all backwards compatible):
 *   roads[]      centre-line splines {surface, points, width, kerb?, sidewalk?, rails?, markings?, lamps?, …}
 *   pavements[]  areas {surface, points | x,z,w,d, angle?, raise?, kerb?, quay?, …} (squares, aprons, quays, platforms)
 *   furniture[]  street furniture {type:'lamp'|'bench'|'bollard'|'fence'|'sign'|'morris_column'|'telegraph'|'crossing'|…}
 * and legacy `terrain[]` path entries with terrain:'road' become roads too (surface = the theatre default, or the
 * entry's own `surface` field), so missions written before 3p keep their look and gain nothing they did not ask for.
 *
 * Surfaces are HARD (a pavement mesh with CC0 PBR + parallax: setts, blocks, pavé, brick, flags, asphalt, concrete,
 * quay granite) or SOFT (painted into the terrain splat and pre-trampled: gravel, dirt, mud, sand, packed snow, slush).
 * Trails respond per material through `SURFACES[*].print` / `tau` (none on stone; films drawn by the pavement shader).
 * @module world/roads
 */

/** Surface catalogue. grid: terrain code name written under the road; tex: pavement texture set (hard only). */
export const SURFACES = Object.freeze({
  setts: { label: 'Granite setts in courses', hard: true, tex: 'setts', grid: 'road', print: 0.02, tau: 300, sound: 'stone', tint: [0.88, 0.92, 1.0], pom: 0.045 },
  belgian: { label: 'Belgian blocks (worn, domed)', hard: true, tex: 'belgian', grid: 'road', print: 0.02, tau: 300, sound: 'stone', tint: [0.92, 0.9, 0.88], pom: 0.06 },
  pave_fan: { label: 'Fan-pattern pavé', hard: true, tex: 'pave_fan', grid: 'road', print: 0.02, tau: 300, sound: 'stone', tint: [1, 1, 1], pom: 0.04 },
  brick_herringbone: { label: 'Herringbone brick paving', hard: true, tex: 'brick', grid: 'road', print: 0.03, tau: 300, sound: 'stone', tint: [1, 0.97, 0.95], pom: 0.03 },
  flags: { label: 'Stone-flag pavement', hard: true, tex: 'flags', grid: 'road', print: 0.03, tau: 300, sound: 'stone', tint: [0.93, 0.93, 0.92], pom: 0.02 },
  asphalt: { label: 'Tar macadam (patched, tar seams)', hard: true, tex: 'asphalt', grid: 'road', print: 0.05, tau: 400, sound: 'hard', tint: [0.82, 0.82, 0.83], pom: 0.012, cracks: 0.55 },
  asphalt_cracked: { label: 'Cracked asphalt', hard: true, tex: 'asphalt_cracked', grid: 'road', print: 0.05, tau: 400, sound: 'hard', tint: [0.9, 0.9, 0.9], pom: 0.015, cracks: 0.8 },
  concrete: { label: 'Concrete slabs with expansion joints', hard: true, tex: 'concrete', grid: 'road', print: 0.04, tau: 400, sound: 'hard', tint: [1.0, 1.02, 1.04], sat: 0.4, pom: 0.012, slab: [5, 5], cracks: 0.35 },
  quay: { label: 'Granite quay slabs', hard: true, tex: 'flags', grid: 'road', print: 0.02, tau: 300, sound: 'stone', tint: [0.8, 0.83, 0.88], pom: 0.025, tileScale: 1.7, sat: 0.35 },
  gravel: { label: 'Gravel road', hard: false, grid: 'road', print: 0.08, tau: 600, sound: 'gravel', layer: { temperate: 'gravel', desert: 'gravel', snow: 'snowpack' } },
  dirt: { label: 'Dirt track (ruts, puddles)', hard: false, grid: 'road', print: 0.35, tau: 900, sound: 'dirt', layer: { temperate: 'dirt', desert: 'dirt', snow: 'snowpack' }, ruts: 1.2 },
  mud: { label: 'Mud track', hard: false, grid: 'mud', print: 0.9, tau: 1800, sound: 'mud', layer: { temperate: 'mud', desert: 'mud', snow: 'mud' }, ruts: 1.5 },
  sand_road: { label: 'Sand-drifted desert road', hard: false, grid: 'road', print: 0.6, tau: 420, sound: 'sand', layer: { temperate: 'road', desert: 'road', snow: 'snowpack' } },
  snow_packed: { label: 'Snow-packed road', hard: false, grid: 'road', print: 0.4, tau: 1800, sound: 'snow', layer: { temperate: 'road', desert: 'road', snow: 'snowpack' } },
  slush: { label: 'Slushy road', hard: false, grid: 'road', print: 0.5, tau: 900, sound: 'slush', layer: { temperate: 'mud', desert: 'mud', snow: 'slush' }, ruts: 1.3 },
});

/** Default surface of a legacy `terrain[]` road path per theatre (keeps the pre-3p look: splat road + ruts). */
export const THEATER_ROAD = Object.freeze({ snow: 'snow_packed', desert: 'sand_road', temperate: 'dirt', coast: 'dirt', night: 'dirt' });

/** Road defaults by surface family. */
const ROAD_DEFAULTS = { width: 6, spline: true, edge: 'ragged', wear: 0.5, patches: 0, cracks: null, weeds: 0.3, puddles: 0.3 };
const KERB_DEFAULTS = { h: 0.14, w: 0.25, side: 'both', paint: null, gutter: true, drains: 24 };
const SIDEWALK_DEFAULTS = { w: 2, surface: 'flags', side: 'both' };
const RAIL_DEFAULTS = { gauge: 1.435, tracks: 1, spacing: 3.3, kind: 'tram', embedded: true, offset: 0 };

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pt = (p) => (Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.z]);
const surf = (s, theater) => (SURFACES[s] ? s : THEATER_ROAD[theater] || 'dirt');

/** Rect {x, z (NW corner), w, d} → polygon. */
export function rectPolygon(r) {
  return [[r.x, r.z], [r.x + r.w, r.z], [r.x + r.w, r.z + r.d], [r.x, r.z + r.d]];
}

/** Validation messages for the 3p fields (schema.validateMission appends them as warnings). */
export function validateRoads(def) {
  const out = [];
  (def.roads || []).forEach((r, i) => {
    if (!Array.isArray(r.points) || r.points.length < 2) out.push(`roads[${i}]: needs ≥ 2 points`);
    if (r.surface && !SURFACES[r.surface]) out.push(`roads[${i}]: unknown surface "${r.surface}"`);
  });
  (def.pavements || []).forEach((a, i) => {
    if (!(Array.isArray(a.points) && a.points.length >= 3) && !(a.w > 0 && a.d > 0)) out.push(`pavements[${i}]: needs points (≥ 3) or x,z,w,d`);
    if (a.surface && !SURFACES[a.surface]) out.push(`pavements[${i}]: unknown surface "${a.surface}"`);
  });
  (def.furniture || []).forEach((f, i) => { if (!f || !f.type) out.push(`furniture[${i}]: needs a type`); });
  return out;
}

/** One normalized road. */
function normRoad(r, i, theater, legacy = false) {
  const surface = surf(r.surface, theater), S = SURFACES[surface];
  const out = {
    ...ROAD_DEFAULTS, ...r, kind: 'road', id: r.id ?? `road${i}`, surface, legacy,
    points: r.points.map(pt), width: num(r.width, legacy ? 3 : ROAD_DEFAULTS.width),
    kerb: r.kerb ? { ...KERB_DEFAULTS, ...(r.kerb === true ? {} : r.kerb) } : null,
    sidewalk: r.sidewalk ? { ...SIDEWALK_DEFAULTS, ...(r.sidewalk === true ? {} : r.sidewalk) } : null,
    rails: r.rails ? { ...RAIL_DEFAULTS, ...(r.rails === true ? {} : r.rails) } : null,
    markings: r.markings ?? null, craters: Array.isArray(r.craters) ? r.craters.map((c) => [+c[0], +c[1], num(c[2], 2)]) : [],
    manholes: num(r.manholes, S.hard && r.kerb ? 38 : 0), lamps: r.lamps ?? null, seed: num(r.seed, 1 + i * 7919),
  };
  if (out.cracks == null) out.cracks = S.cracks ?? 0.2;
  if (out.sidewalk && !out.kerb) out.kerb = { ...KERB_DEFAULTS };
  if (out.kerb) out.edge = 'kerb';
  return out;
}

/** One normalized paved area (square, apron, quay, platform). */
function normArea(a, i, theater) {
  const surface = surf(a.surface ?? 'flags', theater);
  const points = (Array.isArray(a.points) && a.points.length >= 3 ? a.points : rectPolygon(a)).map(pt);
  return {
    kind: 'area', edge: 'ragged', wear: 0.3, patches: 0, cracks: SURFACES[surface].cracks ?? 0.2, weeds: 0.35, puddles: 0.3,
    ...a, id: a.id ?? `pavement${i}`, surface, points, angle: num(a.angle, 0), raise: num(a.raise, 0),
    kerb: a.kerb ? { ...KERB_DEFAULTS, ...(a.kerb === true ? {} : a.kerb) } : null,
    quay: a.quay ? { edges: [0], bollards: 12, coping: true, rings: true, ...(a.quay === true ? {} : a.quay) } : null,
    craters: Array.isArray(a.craters) ? a.craters.map((c) => [+c[0], +c[1], num(c[2], 2)]) : [], seed: num(a.seed, 101 + i * 7919),
  };
}

/**
 * Normalize a mission's 3p fields (+ legacy terrain road paths) into one network.
 * @param {object} mission (raw or normalized) @returns {{theater:string, roads:object[], areas:object[], furniture:object[]}}
 */
export function normalizeRoadNetwork(mission = {}) {
  const theater = mission.theater || 'temperate';
  const roads = [];
  (mission.terrain || []).forEach((t) => {
    if (t.type === 'path' && t.terrain === 'road' && Array.isArray(t.points) && t.points.length > 1) {
      roads.push(normRoad({ ...t, spline: t.spline ?? false }, roads.length, theater, !t.surface));
    }
  });
  (mission.roads || []).forEach((r) => { if (Array.isArray(r.points) && r.points.length > 1) roads.push(normRoad(r, roads.length, theater)); });
  const areas = (mission.pavements || []).map((a, i) => normArea(a, i, theater));
  const furniture = (mission.furniture || []).filter((f) => f && f.type).map((f, i) => ({ id: f.id ?? `furn${i}`, rot: 0, ...f }));
  return { theater, roads, areas, furniture };
}

// ------------------------------------------------------------------------------------------ centre-line geometry

/**
 * Sample a centre line every ~`step` m: centripetal Catmull-Rom through the points (spline) or the polyline.
 * @returns {{x:number, z:number, s:number, tx:number, tz:number}[]} s = arc length, (tx, tz) unit tangent
 */
export function sampleCenterline(points, step = 0.5, spline = true) {
  const P = points.map(pt), out = [];
  const push = (x, z) => {
    const L = out[out.length - 1];
    if (L && Math.hypot(x - L.x, z - L.z) < 1e-4) return;
    out.push({ x, z, s: L ? L.s + Math.hypot(x - L.x, z - L.z) : 0, tx: 1, tz: 0 });
  };
  for (let k = 0; k < P.length - 1; k++) {
    const p1 = P[k], p2 = P[k + 1], L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(L / step));
    if (!spline || P.length < 3) {
      for (let j = 0; j < n; j++) push(p1[0] + (p2[0] - p1[0]) * j / n, p1[1] + (p2[1] - p1[1]) * j / n);
      continue;
    }
    const p0 = P[k - 1] || [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]], p3 = P[k + 2] || [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const tj = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    for (let j = 0; j < n; j++) {
      const t = t1 + (t2 - t1) * j / n, c = [0, 1].map((d) => {
        const A1 = (t1 - t) / t1 * p0[d] + t / t1 * p1[d];
        const A2 = (t2 - t) / (t2 - t1) * p1[d] + (t - t1) / (t2 - t1) * p2[d];
        const A3 = (t3 - t) / (t3 - t2) * p2[d] + (t - t2) / (t3 - t2) * p3[d];
        const B1 = (t2 - t) / t2 * A1 + t / t2 * A2, B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        return (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
      });
      push(c[0], c[1]);
    }
  }
  const last = P[P.length - 1];
  push(last[0], last[1]);
  for (let k = 0; k < out.length; k++) {
    const a = out[Math.max(0, k - 1)], b = out[Math.min(out.length - 1, k + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    out[k].tx = dx / L; out[k].tz = dz / L;
  }
  return out;
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(x, z, P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the polygon boundary (and the nearest edge index). */
export function polygonEdgeDistance(x, z, P) {
  let best = Infinity, edge = -1;
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; edge = i; }
  }
  return { d: best, edge };
}

/** Outer half-extent of a road cross-section: carriageway + kerb + sidewalk. */
export function roadReach(r) {
  const hw = r.width / 2;
  return hw + (r.kerb ? r.kerb.w : 0) + (r.sidewalk ? r.sidewalk.w : 0);
}

/**
 * Spatial index over a normalized network: surface / elevation queries for gameplay, trails, footsteps and entity
 * ground height. Buckets are `cell` m squares holding road segments and areas that reach into them.
 */
export class RoadIndex {
  constructor(net, width, depth, cell = 4) {
    this.net = net; this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell)); this.rows = Math.max(1, Math.ceil(depth / cell));
    this.buckets = new Map();
    this.lines = net.roads.map((r) => sampleCenterline(r.points, 1, r.spline));
    net.roads.forEach((r, ri) => {
      const L = this.lines[ri], reach = roadReach(r) + 0.5;
      for (let k = 0; k < L.length - 1; k++) {
        const a = L[k], b = L[k + 1];
        this._addBox(Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach, Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach, [0, ri, k]);
      }
    });
    net.areas.forEach((a, ai) => {
      const xs = a.points.map((p) => p[0]), zs = a.points.map((p) => p[1]), m = (a.kerb ? a.kerb.w : 0) + 0.5;
      this._addBox(Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m, [1, ai, 0]);
    });
  }
  _addBox(x0, z0, x1, z1, item) {
    const c = this.cell;
    for (let j = Math.max(0, Math.floor(z0 / c)); j <= Math.min(this.rows - 1, Math.floor(z1 / c)); j++) {
      for (let i = Math.max(0, Math.floor(x0 / c)); i <= Math.min(this.cols - 1, Math.floor(x1 / c)); i++) {
        const k = j * this.cols + i;
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        if (!b.some((q) => q[0] === item[0] && q[1] === item[1] && q[2] === item[2])) b.push(item);
      }
    }
  }
  /**
   * Surface under (x, z), or null (plain terrain).
   * @returns {{surface:string, zone:'road'|'kerb'|'sidewalk'|'area', id:string, s:number, t:number, raise:number}|null}
   */
  at(x, z) {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return null;
    const b = this.buckets.get(j * this.cols + i);
    if (!b) return null;
    let best = null;
    const near = new Map(); // road index → nearest centre-line point (one cross-section per road)
    const take = (hit) => { if (hit && (!best || hit.raise > best.raise || (hit.raise === best.raise && (hit.d ?? 0) < (best.d ?? 0)))) best = hit; };
    for (const [type, idx, k] of b) {
      if (type === 1) {
        const a = this.net.areas[idx];
        if (pointInPolygon(x, z, a.points)) take({ surface: a.surface, zone: 'area', id: a.id, s: x, t: z, raise: a.raise + (a.kerb ? a.kerb.h : 0) });
        continue;
      }
      const A = this.lines[idx][k], B = this.lines[idx][k + 1];
      const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2));
      const d = Math.hypot(x - A.x - dx * u, z - A.z - dz * u);
      const q = near.get(idx);
      if (!q || d < q.d) near.set(idx, { d, s: A.s + Math.sqrt(L2) * u, side: (dx * (z - A.z) - dz * (x - A.x)) >= 0 ? 1 : -1 });
    }
    for (const [idx, q] of near) {
      const r = this.net.roads[idx], { d, s, side } = q, t = d * side;   // side +1 = left of travel
      const hw = r.width / 2, kw = r.kerb ? r.kerb.w : 0, sw = r.sidewalk ? r.sidewalk.w : 0;
      const onSide = (o) => !o || o.side === 'both' || (o.side === 'left') === (side > 0);
      let hit = null;
      if (d <= hw) hit = { surface: r.surface, zone: 'road', id: r.id, s, t, raise: 0 };
      else if (r.kerb && onSide(r.kerb) && d <= hw + kw) hit = { surface: 'flags', zone: 'kerb', id: r.id, s, t, raise: r.kerb.h };
      else if (r.sidewalk && onSide(r.sidewalk) && d <= hw + kw + sw) hit = { surface: r.sidewalk.surface, zone: 'sidewalk', id: r.id, s, t, raise: r.kerb.h };
      if (hit) { hit.d = d; take(hit); }
    }
    return best;
  }
  /** True where a hard pavement surface (carriageway, kerb, sidewalk, area) covers the terrain (grass / clutter mask). */
  covers(x, z) {
    const h = this.at(x, z);
    if (!h || !SURFACES[h.surface]?.hard) return false;
    if (h.zone !== 'road') return true;
    const r = this.net.roads.find((q) => q.id === h.id);
    return !r || r.edge !== 'ragged' || Math.abs(h.t) < r.width / 2 - 0.3;
  }
  /** Surface name at (x, z) or null. */
  surfaceAt(x, z) { return this.at(x, z)?.surface ?? null; }
  /** Walking-surface elevation above the terrain (sidewalks, kerbs, raised quays / platforms), m. */
  raiseAt(x, z) { return this.at(x, z)?.raise ?? 0; }
  /** Trail response: {print visibility, tau, hard} of the surface at (x, z), or null (terrain decides). */
  trailInfo(x, z) {
    const h = this.at(x, z);
    if (!h) return null;
    const S = SURFACES[h.surface];
    return { surface: h.surface, visible: S.print, tau: S.tau, hard: !!S.hard, sound: S.sound };
  }
}

// ------------------------------------------------------------------------------------------ grid + terrain glue

/**
 * Write the 3p roads / areas into the nav grid's terrain layer (legacy terrain paths are already painted by the
 * map builder). Carriageways get their surface's grid code, kerbs + sidewalks and paved areas 'road'.
 * @param {object} grid NavGrid @param {object} net normalized network @param {(name:string)=>number} code terrainCode
 */
export function paintRoadGrid(grid, net, code) {
  for (const r of net.roads) {
    if (r.legacy || r.grid === false) continue;   // grid:false = visual only (a trodden path that stays snow)
    const pts = sampleCenterline(r.points, 1, r.spline).map((p) => [p.x, p.z]);
    const outer = 2 * roadReach(r);
    if (outer > r.width + 0.01) grid.fillLine(pts, outer, 'terrain', code('road'));
    grid.fillLine(pts, r.width, 'terrain', code(SURFACES[r.surface].grid));
  }
  for (const a of net.areas) if (a.grid !== false) grid.fillPoly(a.points, 'terrain', code(SURFACES[a.surface].grid));
}

/** Pre-trampled polylines for the terrain (worn ruts, slush, puddles) — soft roads only; legacy roads unchanged. */
export function pretrampleRoads(net) {
  const out = [];
  net.roads.forEach((r, i) => {
    const S = SURFACES[r.surface];
    if (S.hard) return;
    if (r.legacy) {
      out.push({ points: r.points.map((p) => [p[0], p[1]]), passes: 7, walkers: 3, seed: i + 1, spread: Math.min(1.2, (r.width ?? 3) * 0.2) });
      return;
    }
    const pts = sampleCenterline(r.points, 2, r.spline).map((p) => [p.x, p.z]);
    out.push({ points: pts, passes: Math.round(7 * (S.ruts ?? 1) * (0.5 + r.wear)), walkers: 3, seed: i + 1, spread: Math.min(1.4, r.width * 0.2), load: 1.1 * (S.ruts ?? 1) });
  });
  return out;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const h2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
function vn(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Splat painter for createTerrain's `paint(x, z, w)` hook: soft roads re-weight towards their layer (ragged,
 * noise-feathered verges); hard pavements put a gravel/verge layer under their crumbling edges.
 * @param {RoadIndex} index @param {string} theater @param {string[]} layers the theatre palette's 8 layer names
 * @returns {((x:number, z:number, w:Float32Array) => void)|null}
 */
export function terrainPainter(index, theater, layers) {
  const net = index.net;
  if (!net.roads.some((r) => !r.legacy) && !net.areas.length) return null;
  const th = theater === 'desert' || theater === 'snow' ? theater : 'temperate';
  const li = (n) => layers.indexOf(n);
  const verge = li(th === 'snow' ? 'snowpack' : 'gravel') >= 0 ? li(th === 'snow' ? 'snowpack' : 'gravel') : li('road');
  return (x, z, w) => {
    const h = index.at(x, z);
    if (!h) return;
    const ragged = (vn(x * 0.9, z * 0.9) - 0.5) * 0.8 + (vn(x * 3.1, z * 3.1) - 0.5) * 0.3;
    const road = h.zone === 'road' ? net.roads.find((r) => r.id === h.id) : null;
    if (road?.legacy) return;
    const S = SURFACES[h.surface];
    let k = 1;
    if (road) k = smooth(-0.2, 0.9, road.width / 2 - Math.abs(h.t) + ragged);
    const idx = S.hard ? verge : li(S.layer?.[th] ?? 'road');
    if (idx < 0 || k <= 0) return;
    for (let q = 0; q < w.length; q++) w[q] *= 1 - k;
    w[idx] += k;
    if (!S.hard && h.surface === 'sand_road') { const a = li('sand'); if (a >= 0) w[a] += 0.6 * smooth(0.45, 0.75, vn(x / 3, z / 9) + ragged * 0.3); }
  };
}

// ------------------------------------------------------------------------------------------ street furniture

/** Lamp variants by furniture type shortcut. */
const LAMP_TYPES = { lamp: null, lamp_post: 'paris_single', street_lamp: 'paris_single', floodlight: 'floodlight', searchlight_pole: 'searchlight', wall_lamp: 'wall_lamp' };
/** Gameplay footprint radius (m) of posts that block a nav cell (0 = walk-through). */
export const FURNITURE_BLOCK = { lamp: 0.2, bollard: 0.15, morris_column: 0.7, telegraph: 0.2, sign: 0.1, bench: 0, fence: 0, crossing: 0, milestone: 0.2 };

/**
 * Expand a network's furniture into concrete placements: explicit items, lamps along roads (`road.lamps`),
 * telegraph lines (`{type:'telegraph', points, spacing}` → poles + wire spans), fences along points.
 * @returns {{items: object[], lines: {poles: object[], h: number, wires: number}[]}}
 */
export function expandFurniture(net) {
  const items = [], lines = [];
  const lampOf = (f) => ({ kind: 'lamp', variant: f.variant || LAMP_TYPES[f.type] || 'paris_single', hooded: !!f.hooded, damaged: !!f.damaged,
    lean: f.lean ?? (f.damaged ? 8 : 0), lit: f.lit, x: f.x, z: f.z, rot: f.rot ?? 0, y: f.y ?? null, id: f.id, block: f.block });
  for (const f of net.furniture) {
    if (f.type in LAMP_TYPES) items.push(lampOf(f));
    else if (f.type === 'telegraph' && Array.isArray(f.points) && f.points.length > 1) {
      const line = sampleCenterline(f.points, 1, f.spline ?? false), sp = f.spacing ?? 35, poles = [];
      const L = line[line.length - 1].s, n = Math.max(1, Math.round(L / sp));
      for (let k = 0; k <= n; k++) {
        const p = line.find((q) => q.s >= (L * k) / n - 1e-6) || line[line.length - 1];
        poles.push({ kind: 'telegraph', x: p.x, z: p.z, rot: Math.atan2(p.tz, p.tx) + Math.PI / 2, h: f.h ?? 7, block: f.block });
      }
      lines.push({ poles, h: f.h ?? 7, wires: f.wires ?? 4 });
      items.push(...poles);
    } else if (f.type === 'fence' && Array.isArray(f.points)) items.push({ kind: 'fence', variant: f.variant || 'picket', points: f.points.map(pt), h: f.h ?? 1.1, id: f.id, block: f.block });
    else items.push({ kind: f.type, variant: f.variant ?? null, x: f.x, z: f.z, rot: f.rot ?? 0, text: f.text ?? null, w: f.w, gauge: f.gauge, id: f.id, block: f.block });
  }
  // lamps along roads: at the sidewalk kerb (kerbed) or on the verge, arms over the carriageway
  net.roads.forEach((r) => {
    const o = r.lamps;
    if (!o) return;
    const line = sampleCenterline(r.points, 1, r.spline), L = line[line.length - 1].s;
    const sp = o.spacing ?? 22, hw = r.width / 2, off = r.kerb ? hw + r.kerb.w + 0.45 : hw + 0.9;
    let k = 0;
    for (let s = o.start ?? sp / 2; s < L; s += sp, k++) {
      const p = line.find((q) => q.s >= s) || line[line.length - 1];
      const sides = o.side === 'left' ? [1] : o.side === 'right' ? [-1] : o.side === 'both' ? [1, -1] : [k % 2 ? -1 : 1];
      for (const side of sides) {
        const x = p.x - p.tz * off * side, z = p.z + p.tx * off * side;
        items.push(lampOf({ variant: o.variant, hooded: o.hooded, lit: o.lit, x, z, rot: Math.atan2(-p.tx * side, p.tz * side), damaged: o.damaged?.includes?.(k), block: o.block }));
      }
    }
  });
  return { items, lines };
}
