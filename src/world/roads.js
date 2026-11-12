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
import { lineExtrasFor } from './line-extras.js';
import { crossingSource } from './edge-extend.js';

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
  const net = { theater, roads, areas, furniture };
  // visual-only side data (roads-and-tracks r1): the mission id lets the painters find its line extras
  // (world/line-extras.js); never enumerable, so JSON.stringify(net) — the splat cache key, the sim — is unchanged
  Object.defineProperty(net, 'missionId', { value: mission.id ?? null, enumerable: false, writable: true, configurable: true });
  NET_INFO.set(net, { size: Array.isArray(mission.size) ? [+mission.size[0], +mission.size[1]] : null });
  return net;
}

/** Per-network side data the painters read (map size); a WeakMap so the net itself carries nothing new. */
const NET_INFO = new WeakMap();
/** @returns {{size:number[]|null}|null} */
export function netInfo(net) { return (net && NET_INFO.get(net)) || null; }

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
    this.net = net; this.cell = cell; this.W = width; this.D = depth;
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

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const h2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
function vn(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Splat painter for createTerrain's `paint(x, z, w)` hook — the GAMEPLAY floats (unchanged from before the road model):
 * soft 3p roads re-weight towards their layer (ragged, noise-feathered verges); hard pavements put a gravel / verge layer
 * under their crumbling edges. The splat's floats are what the game reads (the guards' print visibility, the desert
 * scrub plan, grass and clutter placement), so they keep exactly this paint; the visual road model (roadLookPainter) is
 * laid over the splat's GPU bytes only (overlayRoadLookG) and paints the scenery apron's own (visual) splat.
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

// ------------------------------------------------------------------------------------------ visual road model
//
// Roads-and-tracks r1: every soft road, track and trodden path is drawn from ONE model, shared by the splat look
// (roadLookPainter: crowned carriageway, dark soft shoulders, wheel-lane wear, ragged edge, wandering verge, open-end
// taper, junction fillets, desert sand tongues and windrows), the pre-trampled ruts (pretrampleRoads: 1-4 wandering rut
// pairs, a packed centre, verge walkers, line extras) and, through roadRutLanes(), the pavement shader of the hard
// ribbons. Visual only: the net's roads / areas / furniture, their widths, surfaces and grid flags never change (the sim
// reads them: paintRoadGrid, RoadIndex, rail clearance, alignment), the splat's floats keep the gameplay paint
// (terrainPainter: the guards' print visibility and the desert scrub plan read them) and the look is laid over the splat's
// GPU bytes only (overlayRoadLookG). The look and the stamps are pure functions of world x, z (no grid reads, no clamping
// to the map), so the scenery apron's mirrored road crossings continue them without a seam. Per-mission visual data
// (desire lines, vehicle ruts, per-road options) lives in world/line-extras.js, keyed by the net's non-enumerable
// missionId.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const hashN = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** Integer lattice hashes → [0, 1) (no trig: the painter runs per splat texel). */
const ih1 = (i) => { let h = Math.imul(i | 0, 0x27d4eb2d) ^ 0x165667b1; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const ih2 = (i, j) => { let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** 1-D value noise (along a road's arc length) and a 3-octave sum, both in [0, 1). */
const vn1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = ih1(i); return a + (ih1(i + 1) - a) * u; };
const fbm1 = (x) => vn1(x) * 0.57 + vn1(x * 2.13 + 17.3) * 0.29 + vn1(x * 4.41 + 41.1) * 0.14;
/** 2-D value noise and a 3-octave sum (world-space), [0, 1). */
const vn2 = (x, z) => {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = ih2(i, j), b = ih2(i + 1, j), c = ih2(i, j + 1), d = ih2(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm2 = (x, z) => vn2(x, z) * 0.55 + vn2(x * 2.07 + 13.1, z * 2.07 - 7.7) * 0.3 + vn2(x * 4.3 - 31.4, z * 4.3 + 5.3) * 0.15;
/** Polynomial smooth minimum (fillet radius ~k): rounds the inside corners where two road edges meet. */
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** Wind the desert pistes' sand tongues and downwind verges follow (the terrain material's default, art/terrain/terrain.js). */
const WIND = (() => { const x = 1, z = 0.25, l = Math.hypot(x, z); return [x / l, z / l]; })();

/**
 * Per-theatre look tables: {layer: fraction} recipes the painter blends a texel toward (fractions of the texel's weight
 * sum). `core`: the carriageway per surface family; `crown`: the packed, lighter centre; `shoulder`: the darker soft
 * outer bands where the wheels run; `rut`: the wheel lanes themselves; `edge`: the crumbly last 0.4 m; `verge`: the band
 * outside the edge (`thin` scales the sward there); `spray`: blotches thrown off the wheels; `path`: trodden foot
 * paths; `cart`: a lone track's bed between its ruts; `sig`: the layers the gameplay paint puts on the old grid road,
 * recycled where the visual road no longer covers them. The palettes' own scans (assets/terrain/layers.json): temperate
 * 'dirt' is a cracked clay, so trodden ground is 'grassdry' (bare brown earth) with 'mud' and the 'road' trail; the snow
 * palette's 'ice' slot is a frozen-pond look (kept off roads) and its 'slush' slot a wet brown road.
 */
const RECIPES = {
  temperate: {
    // (the meadow's own tone is the grass tufts' season palette — beige in autumn, pale in the thaw — so trodden ground
    //  reads by being darker and earthier: damp 'mud' earth and the reddish stony 'road' trail, gravel on packed crowns)
    core: { dirt: { road: 0.44, mud: 0.26, gravel: 0.15, grassdry: 0.15 }, gravel: { gravel: 0.58, road: 0.24, mud: 0.1, grassdry: 0.08 },
      mud: { mud: 0.62, road: 0.26, grassdry: 0.12 }, road: { road: 0.44, mud: 0.26, gravel: 0.15, grassdry: 0.15 },
      slush: { mud: 0.55, road: 0.3, grassdry: 0.15 }, sand_road: { road: 0.5, gravel: 0.25, mud: 0.15, grassdry: 0.1 }, snow_packed: { road: 0.5, gravel: 0.25, mud: 0.15, grassdry: 0.1 } },
    crown: { gravel: 0.44, road: 0.36, grassdry: 0.2 }, median: { grass: 0.55, grassdry: 0.45 },
    shoulder: { mud: 0.5, road: 0.38, grassdry: 0.12 }, rut: { mud: 0.56, road: 0.44 }, edge: { grassdry: 0.42, mud: 0.33, road: 0.25 },
    verge: { mud: 0.3, road: 0.24, grassdry: 0.3, gravel: 0.16 }, thin: { grass: 0.6, leaves: 0.6 },
    spray: { mud: 0.85, road: 0.15 }, path: { mud: 0.42, road: 0.27, grassdry: 0.31 }, cart: { mud: 0.36, road: 0.24, grassdry: 0.4 },
    lineRut: { mud: 0.5, road: 0.3, grassdry: 0.2 },
    hard: { mud: 0.32, gravel: 0.32, grassdry: 0.2, road: 0.16 }, wash: { mud: 0.75, road: 0.25 }, ring: { mud: 0.36, grassdry: 0.36, road: 0.16, gravel: 0.12 },
    fan: { mud: 0.75, road: 0.18, gravel: 0.07 }, grit: { gravel: 0.6, road: 0.25, mud: 0.15 }, gravel: { gravel: 0.7, road: 0.15, grassdry: 0.15 },
    gravelPath: { gravel: 0.76, road: 0.12, grassdry: 0.12 }, gutter: { mud: 0.84, leaves: 0.16 }, firm: { gravel: 0.6, road: 0.25, mud: 0.15 },
    base: { grass: 0.65, grassdry: 0.35 }, sig: ['road'],
  },
  thaw: { // M6, Masi in May: the sward dead and pale, the ruts standing in water, the verge wet earth and dead grass
    shoulder: { mud: 0.58, road: 0.32, grassdry: 0.1 }, rut: { mud: 0.66, road: 0.34 }, verge: { mud: 0.36, grassdry: 0.38, road: 0.18, gravel: 0.08 },
    crown: { gravel: 0.36, road: 0.4, grassdry: 0.24 }, path: { mud: 0.5, road: 0.24, grassdry: 0.26 },
  },
  coast: { verge: { grassdry: 0.42, gravel: 0.34, wetsand: 0.24 }, thin: { grass: 0.55, wetsand: 0.4 } },
  desert: {
    // the pistes are compacted dust and gravel lag, greyer than the sand, never a red ribbon; the ruts darker, the crown
    // loose sand caught between them; the verge darkens the plain's own mix (sand2 / dirt) instead of a pale halo
    core: { sand_road: { gravel: 0.56, road: 0.2, dirt: 0.14, sand2: 0.1 }, dirt: { dirt: 0.34, gravel: 0.4, road: 0.16, sand2: 0.1 },
      gravel: { gravel: 0.66, sand2: 0.2, dirt: 0.14 }, mud: { mud: 0.6, dirt: 0.4 }, road: { gravel: 0.56, road: 0.2, dirt: 0.14, sand2: 0.1 } },
    crown: { sand2: 0.55, sand: 0.45 }, shoulder: { gravel: 0.46, road: 0.3, dirt: 0.24 }, rut: { gravel: 0.48, dirt: 0.3, road: 0.22 },
    edge: { sand2: 0.62, sand: 0.38 }, verge: { sand2: 0.6, dirt: 0.22, gravel: 0.18 }, thin: { sand: 0.45, grassdry: 0.6 },
    path: { dirt: 0.36, sand2: 0.34, gravel: 0.16, road: 0.14 }, cart: { sand2: 0.42, dirt: 0.3, gravel: 0.2, road: 0.08 },
    lineRut: { gravel: 0.4, dirt: 0.35, sand2: 0.25 },
    hard: { sand2: 0.5, gravel: 0.3, dirt: 0.2 }, wash: { dirt: 0.5, road: 0.3, sand2: 0.2 }, ring: { sand2: 0.55, gravel: 0.25, dirt: 0.2 },
    fan: { dirt: 0.45, gravel: 0.3, sand2: 0.25 }, grit: { gravel: 0.6, sand2: 0.25, dirt: 0.15 }, gravel: { gravel: 0.65, sand2: 0.35 },
    gravelPath: { gravel: 0.65, sand2: 0.35 }, gutter: { dirt: 0.6, sand2: 0.4 }, firm: { gravel: 0.55, sand2: 0.3, dirt: 0.15 },
    tongue: { sand: 0.78, sand2: 0.22 }, windrow: { sand: 0.62, sand2: 0.38 }, spray: null, base: { sand: 0.55, sand2: 0.45 }, sig: ['road'],
  },
  snow: {
    // a packed snow road is grey-white: compacted snow with two to four dark wet wheel lanes, a lighter glazed crown,
    // crumbly old-snow edges and a dirty spray fringe
    core: { snow_packed: { snowpack: 0.8, snowold: 0.2 }, slush: { snowpack: 0.55, slush: 0.3, mud: 0.15 }, gravel: { snowpack: 0.8, snowold: 0.2 },
      dirt: { snowpack: 0.8, snowold: 0.2 }, mud: { mud: 0.45, slush: 0.3, snowpack: 0.25 }, sand_road: { snowpack: 0.8, snowold: 0.2 }, road: { snowpack: 0.8, snowold: 0.2 } },
    crown: { snowpack: 0.72, snowold: 0.28 }, shoulder: { snowpack: 0.66, slush: 0.18, snowold: 0.16 }, rut: { slush: 0.5, mud: 0.16, snowpack: 0.34 },
    edge: { snowold: 0.6, snow: 0.22, snowpack: 0.18 }, verge: { snowold: 0.48, snow: 0.32, snowpack: 0.2 }, thin: { snow: 0.35, grassdry: 0.5 },
    spray: { mud: 0.5, slush: 0.35, snowold: 0.15 }, path: { snowpack: 0.72, snowold: 0.28 }, cart: { snowpack: 0.66, slush: 0.2, snowold: 0.14 },
    // one vehicle's tyre tracks across snow: compacted snow (the trail field cuts the tread and its blue shadow), not slush
    lineRut: { snowpack: 0.78, snowold: 0.22 },
    // wheel lanes polished by traffic (`glaze`): smooth grey compacted snow-ice rather than churned brown slush
    glazeRut: { snowpack: 0.58, slush: 0.42 },
    hard: { snowpack: 0.5, snowold: 0.32, mud: 0.18 }, wash: { slush: 0.42, snowpack: 0.38, mud: 0.2 }, ring: { snowpack: 0.6, snowold: 0.4 },
    fan: { slush: 0.45, mud: 0.3, snowpack: 0.25 }, grit: { mud: 0.36, snowpack: 0.34, rock: 0.14, slush: 0.16 },
    gravel: { snowpack: 0.5, rock: 0.2, mud: 0.2, snowold: 0.1 }, gravelPath: { snowpack: 0.7, snowold: 0.2, mud: 0.1 },
    gutter: { slush: 0.5, mud: 0.32, snowpack: 0.18 }, firm: { snowpack: 0.6, rock: 0.15, mud: 0.15, snowold: 0.1 },
    median: { snowold: 0.6, snow: 0.4 }, base: { snow: 0.6, snowold: 0.4 }, sig: ['snowpack', 'slush'],
  },
};
const FAMILY = (th) => (th === 'desert' || th === 'snow' ? th : 'temperate');

/** Visual defaults of a soft road course (overridable per road from the line extras). */
const COURSE_DEFAULTS = { smooth: 6, wander: 0.07, wanderL: 19, vergeW: [0.6, 1.2], taper: 7, fillet: 4.5, edgeRag: 0.32 };

/** Turn a polyline's corners into fillets of radius ~R (quadratic arcs inside the corner), then sample every `step` m. */
export function roundCorners(points, R = 6, step = 0.5) {
  const P = points.map(pt);
  if (P.length < 3 || !(R > 0)) return sampleCenterline(P, step, false);
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const p = P[i - 1], v = P[i], n = P[i + 1];
    const ax = v[0] - p[0], az = v[1] - p[1], L1 = Math.hypot(ax, az), bx = n[0] - v[0], bz = n[1] - v[1], L2 = Math.hypot(bx, bz);
    if (L1 < 1e-6 || L2 < 1e-6) continue;
    const th = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (L1 * L2))));
    if (th < 0.02) { out.push(v); continue; }
    const t = Math.min(R * Math.tan(th / 2), L1 * 0.45, L2 * 0.45);
    const a = [v[0] - ax / L1 * t, v[1] - az / L1 * t], b = [v[0] + bx / L2 * t, v[1] + bz / L2 * t];
    const k = Math.max(2, Math.ceil(t * th / 0.4));
    for (let j = 0; j <= k; j++) {
      const u = j / k, w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
      out.push([w0 * a[0] + w1 * v[0] + w2 * b[0], w0 * a[1] + w1 * v[1] + w2 * b[1]]);
    }
  }
  out.push(P[P.length - 1]);
  return sampleCenterline(out, step, false);
}

/** A polyline's ends that touch the map rect [0,W]x[0,D] (within `near` m) run on `len` m past it (visual continuity). */
function pastEdges(P, W, D, near, len) {
  if (!(W > 0 && D > 0) || P.length < 2) return { points: P, start: false, end: false };
  const Q = P.map((p) => [p[0], p[1]]);
  const out = (p) => Math.min(p[0], p[1], W - p[0], D - p[1]) <= near;
  const ext = (ix, step) => {
    const a = Q[ix]; let k = ix;
    while (k + step >= 0 && k + step < Q.length && Math.hypot(Q[k][0] - a[0], Q[k][1] - a[1]) < 6) k += step;
    const b = Q[k], dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz) || 1;
    return [a[0] + dx / L * len, a[1] + dz / L * len];
  };
  const s = out(Q[0]), e = out(Q[Q.length - 1]);
  if (s) Q.unshift(ext(0, 1));
  if (e) Q.push(ext(Q.length - 1, -1));
  return { points: Q, start: s, end: e };
}

/** Does a road reference from the line extras ({id} | {near: [x, z]}) name this road? */
export function roadMatches(ref, r) {
  if (!ref) return false;
  if (ref.id != null && ref.id === r.id) return true;
  if (Array.isArray(ref.near)) {
    const L = sampleCenterline(r.points, 1, r.spline);
    for (let k = 0; k + 1 < L.length; k++) {
      const a = L[k], b = L[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const u = clamp01(((ref.near[0] - a.x) * dx + (ref.near[1] - a.z) * dz) / l2);
      if (Math.hypot(ref.near[0] - a.x - dx * u, ref.near[1] - a.z - dz * u) <= (ref.r ?? Math.max(2.5, r.width / 2 + 0.5))) return true;
    }
  }
  return false;
}

/** The per-road visual options the line extras give a road (merged in order), {} when none. */
function roadOptions(extras, r) {
  const o = {};
  for (const e of extras?.roads || []) if (roadMatches(e.match, r)) Object.assign(o, e);
  return o;
}

/**
 * Rut lanes of a soft road: 1-4 PAIRS of wheel lines (not a tiled tread across the whole width). Each pair: its centre
 * offset `off` (m, + = left of travel), `gauge` (m), `wear` (0..1, falls toward the edges: 1 - |u|²), and a wander
 * (±`amp` m along a `lambda` m noise) — the same numbers drive the look's wheel-lane wear, the stamped ruts and the
 * hard ribbons' film (pavement shader). Deterministic per road.
 * @returns {{off:number, gauge:number, wear:number, amp:number, lambda:number, seed:number, track?:boolean}[]}
 */
export function roadRutLanes(r, o = {}) {
  const w = o.visualWidth ?? r.width ?? 4, hw = w / 2, seed = (r.seed ?? 1) * 0.0137 + 3.1;
  const tracked = o.kind === 'tracked';
  const g0 = o.gauge ?? (tracked ? 2.45 : o.kind === 'cart' ? 1.35 : 1.72);
  let n = o.pairs ?? (w >= 5.6 ? 3 : w >= 3.6 ? 2 : 1);
  if (o.kind === 'cart' || o.kind === 'vehicle' || tracked) n = o.pairs ?? 1;
  const usable = Math.max(0, hw - g0 / 2 - 0.3);
  const lanes = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;                     // -1 … 1 across the carriageway
    const jit = (hashN(seed * 31 + k * 7.7) - 0.5) * 0.3;
    const off = n === 1 ? (hashN(seed * 13 + 1) - 0.5) * Math.min(0.4, usable) : t * usable * 0.82 + jit;
    const u = hw > 0 ? off / hw : 0;
    // the pair nearest the crown carries most of the traffic (everyone drives in the existing ruts); the outer pairs are
    // fainter, each its own share (a passing place, the lorries' line, the light cars')
    const share = n === 1 ? 1 : n === 2 ? (k === (hashN(seed * 29) < 0.5 ? 0 : 1) ? 1 : 0.45 + 0.25 * hashN(seed * 23 + k * 5.1)) : 0.62 + 0.38 * hashN(seed * 23 + k * 5.1);
    lanes.push({ off, gauge: g0 + (hashN(seed * 17 + k * 3.3) - 0.5) * (tracked ? 0.1 : 0.22), wear: Math.max(0.3, 1 - 1.5 * u * u) * share * (o.wear ?? 1),
      amp: o.wanderAmp ?? 0.3, lambda: 15 + 10 * hashN(seed * 5 + k * 1.9), seed: seed * 7 + k * 11.3, track: tracked });
  }
  // (the strongest lane is always full wear: the road's main ruts)
  const top = Math.max(...lanes.map((l) => l.wear));
  if (top > 0) for (const l of lanes) l.wear = Math.min(1, l.wear / top) * (o.wear ?? 1);
  return lanes;
}

/**
 * A lane's centre offset (m) at arc length s: its base offset + a wander along a `lambda` m noise (+ the swerve round
 * whatever stands in the road, laneDetours()).
 */
export function laneOffsetAt(lane, s) {
  const o = lane.off + lane.amp * (2 * fbm1(s / lane.lambda + lane.seed) - 1);
  return lane.shift ? o + sampleArc(lane.shift, s) : o;
}
/** 1 where a lane's wheels cannot get past what stands in the road (its ruts and worn tone stop), 0 elsewhere. */
export function laneCutAt(lane, s) { return lane.cut ? sampleArc(lane.cut, s) : 0; }
const DETOUR = { step: 0.5, margin: 0.3, tyre: 0.3, verge: 0.9, ramp: 3, rampK: 2, cutRamp: 1.5 };
function sampleArc(a, s) {
  const f = Math.max(0, s / DETOUR.step), i = Math.min(a.length - 2, Math.floor(f)), u = Math.min(1, f - i);
  return a[i] + (a[i + 1] - a[i]) * u;
}

// not obstacles to a wheel: what is driven / walked on or over, cut into the ground, or a line (walls, fences, rails)
const FLAT_TYPES = /^(road|pave|pier|bridge|truss_bridge|rail_bridge|mobile_bridge|launch_pad|firing_range|timber_platform|crater|dam|river|ravine|rail_track|tram_track|cliff|trench|sea_wall|battleship|uboat_tower|lock_gate|water_gate|gate|castle_gate|fence|wall|castle_wall|hedge)/;
/**
 * What stands on or beside a mission's carriageways that a wheel cannot run over or straddle — buildings, huts, tents,
 * wells, crates, drums, rocks, trees, posts, bollards, the road furniture's lamps and signs — as oriented boxes
 * {x, z, c, s, hw, hd} and discs {x, z, r}. Visual model only (laneDetours: the ruts swerve round them); the simulation
 * never reads it. Pure, node-safe.
 * @param {object} mission @param {object} [net] the normalized network (its furniture)
 */
export function roadObstacles(mission, net = null) {
  const out = [];
  for (const s of mission?.structures || []) {
    if (!Number.isFinite(s?.x) || !Number.isFinite(s?.z) || FLAT_TYPES.test(s.type || '') || (s.h ?? 1) < 0.3) continue;
    if (s.w > 0 && s.d > 0) { const r = s.rot || 0; out.push({ x: s.x, z: s.z, c: Math.cos(r), s: Math.sin(r), hw: s.w / 2, hd: s.d / 2 }); }
    else out.push({ x: s.x, z: s.z, r: /^(pine|palm|tree)/.test(s.type || '') ? Math.min(s.r ?? 0.3, 0.4) : s.r ?? 0.25 });
  }
  if (net) for (const f of expandFurniture(net).items) if (Number.isFinite(f.x) && Number.isFinite(f.z) && f.kind !== 'fence') out.push({ x: f.x, z: f.z, r: 0.22 });
  return out;
}

/**
 * Swerve a soft road's rut lanes round what stands on the carriageway (a well in the camp street, a hedgehog left on
 * the road, the bollards of a quay, a house flush with the lane): at every 0.5 m the lateral intervals the obstacles
 * block (their footprint + 0.3 m, cut along the road's normal) are kept clear of each lane's wheels (gauge + tyre) by
 * the smallest shift that fits within the road and its verge (+0.9 m), eased in and out over 3 m + 2 × the shift;
 * where nothing fits the lane's ruts and worn tone stop (ramped over 1.5 m). Writes lane.shift / lane.cut (per 0.5 m of
 * arc). Deterministic; the network is not touched.
 */
function laneDetours(c, obstacles, lanes = c.lanes) {
  const st = DETOUR.step, n = Math.floor(c.L / st) + 2, m = DETOUR.margin;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of c.pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
  const reach = c.hw0 * 1.3 + DETOUR.verge + 3;
  const near = obstacles.filter((o) => {
    const r = (o.r ?? Math.hypot(o.hw, o.hd)) + reach;
    return o.x + r > x0 && o.x - r < x1 && o.z + r > z0 && o.z - r < z1;
  });
  if (!near.length) return;
  // the blocked lateral intervals (t, + = left as offsetPolyline) at each sample
  const blocked = new Array(n);
  let k = 0;
  const P = c.pts;
  for (let i = 0; i < n; i++) {
    const s = Math.min(c.L, i * st);
    while (k < P.length - 2 && P[k + 1].s < s) k++;
    const a = P[k], b = P[k + 1], u = clamp01((s - a.s) / ((b.s - a.s) || 1e-9));
    const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
    let tx = a.tx + (b.tx - a.tx) * u, tz = a.tz + (b.tz - a.tz) * u;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    let iv = null;
    for (const o of near) {
      let lo, hi;
      if (o.r != null) {
        const dx = o.x - x, dz = o.z - z, along = dx * tx + dz * tz, R = o.r + m;
        if (Math.abs(along) >= R) continue;
        const t = dx * nx + dz * nz, h = Math.sqrt(R * R - along * along);
        lo = t - h; hi = t + h;
      } else {
        // the normal line through the sample in the box's frame: (ax + bx·t, az + bz·t) within the box + margin
        const dx = x - o.x, dz = z - o.z;
        const ax = dx * o.c + dz * o.s, az = -dx * o.s + dz * o.c, bx = nx * o.c + nz * o.s, bz = -nx * o.s + nz * o.c;
        lo = -Infinity; hi = Infinity;
        for (const [A, B, H] of [[ax, bx, o.hw + m], [az, bz, o.hd + m]]) {
          if (Math.abs(B) < 1e-9) { if (Math.abs(A) > H) { lo = 1; hi = 0; } continue; }
          const t1 = (-H - A) / B, t2 = (H - A) / B;
          lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
        }
        if (!(lo < hi)) continue;
      }
      if (hi < -reach || lo > reach) continue;
      (iv ??= []).push([lo, hi]);
    }
    blocked[i] = iv;
  }
  for (const ln of lanes) {
    const g = ln.gauge / 2 + DETOUR.tyre, U = c.hw0 + DETOUR.verge - g;
    const hit = (iv, v) => iv.some(([lo, hi]) => v + g > lo && v - g < hi);
    const u0 = new Float32Array(n);
    for (let i = 0; i < n; i++) u0[i] = laneOffsetAt(ln, Math.min(c.L, i * st));
    // runs of road where the lane runs into something (gaps under 2 m joined): each run swerves to ONE side — the side
    // that clears it everywhere with the smaller swerve — so the lane never flips from one side to the other mid-run
    const runs = [];
    let a = -1, last = -1e9;
    for (let i = 0; i < n; i++) if (blocked[i] && hit(blocked[i], u0[i])) { if (i - last > 4) { if (a >= 0) runs.push([a, last]); a = i; } last = i; }
    if (a >= 0) runs.push([a, last]);
    if (!runs.length) continue;
    const sideShift = (i, dir) => {        // the least swerve toward dir (+1 left, -1 right) that clears sample i
      const iv = blocked[i];
      if (!iv || !hit(iv, u0[i])) return 0;
      let best = NaN;
      for (const [lo, hi] of iv) for (const v of [lo - g - 0.02, hi + g + 0.02]) {
        if ((v - u0[i]) * dir <= 0 || Math.abs(v) > U || hit(iv, v)) continue;
        if (Number.isNaN(best) || Math.abs(v - u0[i]) < Math.abs(best)) best = v - u0[i];
      }
      return best;
    };
    const need = new Float32Array(n), bad = new Uint8Array(n);
    for (const [r0, r1] of runs) {
      let pick = null;
      for (const dir of [1, -1]) {
        let mx = 0, fail = 0;
        const sh = [];
        for (let i = r0; i <= r1; i++) { const d = sideShift(i, dir); sh.push(d); if (Number.isNaN(d)) fail++; else mx = Math.max(mx, Math.abs(d)); }
        const score = fail * 100 + mx;
        if (!pick || score < pick.score) pick = { sh, score };
      }
      for (let i = r0; i <= r1; i++) { const d = pick.sh[i - r0]; if (Number.isNaN(d)) bad[i] = 1; else need[i] = d; }
    }
    // a smooth swerve: each needed shift held at its sample and eased in / out over 3 m + 2 × the shift; the shifts to
    // one side merge by max, a swerve one way and the next the other way add (an S between two things)
    const pos = new Float32Array(n), neg = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = need[i];
      if (!d) continue;
      const R = Math.max(1, Math.round((DETOUR.ramp + DETOUR.rampK * Math.abs(d)) / st));
      for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) {
        const v = d * (0.5 + 0.5 * Math.cos((Math.PI * Math.abs(j - i)) / (R + 1)));
        if (v > pos[j]) pos[j] = v; else if (v < neg[j]) neg[j] = v;
      }
    }
    // (and a 1 m box filter over it: the swerve of a chord that grows and shrinks past a round thing stays one curve)
    const raw = new Float32Array(n), shift = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = pos[i] + neg[i];
    for (let i = 0; i < n; i++) { let t = 0, k = 0; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { t += raw[j]; k++; } shift[i] = t / k; }
    ln.shift = shift;
    // what still collides (both sides blocked, or two swerves pulling apart) is cut: no rut, no worn tone there
    for (let i = 0; i < n; i++) if (blocked[i] && hit(blocked[i], u0[i] + shift[i])) bad[i] = 1;
    if (bad.some((v) => v)) {
      const cut = new Float32Array(n), Rc = Math.round(DETOUR.cutRamp / st);
      for (let i = 0; i < n; i++) if (bad[i]) for (let j = Math.max(0, i - Rc - 1); j <= Math.min(n - 1, i + Rc + 1); j++) cut[j] = Math.max(cut[j], 1 - Math.max(0, Math.abs(j - i) - 1) / (Rc + 1));
      ln.cut = cut;
    }
  }
}

/** The point (x, z, tangent) at arc length s of a course. */
function pointAtS(c, s) {
  const P = c.pts;
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s < s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], u = clamp01((s - a.s) / ((b.s - a.s) || 1e-9));
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, tx: a.tx, tz: a.tz, s };
}
/** Nearest point of a course's centre line to (x, z): {x, z, s, d}. */
function nearestOn(c, x, z) {
  let best = { x: c.pts[0].x, z: c.pts[0].z, s: 0, d: Infinity };
  for (let k = 0; k + 1 < c.pts.length; k++) {
    const a = c.pts[k], b = c.pts[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
    const u = clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2), px = a.x + dx * u, pz = a.z + dz * u, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, s: a.s + Math.sqrt(l2) * u, d };
  }
  return best;
}

/**
 * Chain soft road specs that continue one another: an end of one within 1.5 m of an end of another, their directions
 * there within ~40°, neither drawn as a foot path or along a custom course. Returns [{head, parts, raw, hw, rawHw}],
 * every spec in exactly one chain (raw: the joined polyline; hw: the length-weighted half width).
 */
function chainRoads(specs) {
  const free = new Set(specs), out = [];
  const dirAt = (P, end) => { const a = end ? P[P.length - 1] : P[0], b = end ? P[Math.max(0, P.length - 2)] : P[Math.min(P.length - 1, 1)]; const dx = a[0] - b[0], dz = a[1] - b[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const len = (P) => { let L = 0; for (let k = 1; k < P.length; k++) L += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); return L; };
  const chainable = (q) => !q.o.foot && !q.o.course && !q.o.noChain;
  // extend `pts` at its end with another free spec (reversed when it meets end to end)
  const grow = (pts, parts) => {
    for (;;) {
      const e = pts[pts.length - 1], d = dirAt(pts, true);
      let pick = null;
      for (const q of free) {
        if (!chainable(q)) continue;
        for (const rev of [false, true]) {
          const P = rev ? q.raw.slice().reverse() : q.raw;
          if (Math.hypot(P[0][0] - e[0], P[0][1] - e[1]) > 1.5) continue;
          const d2 = dirAt(P, false);                    // points from P[1] back to P[0]: opposite of travel
          if (-(d[0] * d2[0] + d[1] * d2[1]) < 0.76) continue;
          pick = { q, P }; break;
        }
        if (pick) break;
      }
      if (!pick) return;
      free.delete(pick.q); parts.push(pick.q);
      for (let k = 1; k < pick.P.length; k++) pts.push(pick.P[k]);
    }
  };
  for (const s of specs) {
    if (!free.has(s)) continue;
    free.delete(s);
    const parts = [s];
    let pts = s.raw.map((p) => [p[0], p[1]]);
    if (chainable(s)) {
      grow(pts, parts);
      pts = pts.reverse(); grow(pts, parts); pts = pts.reverse();
    }
    let tl = 0, tw = 0, mw = 0;
    for (const q of parts) { const l = len(q.raw) || 1; tl += l; tw += l * q.r.width / 2; mw = Math.max(mw, q.r.width / 2); }
    out.push({ head: s, parts, raw: pts, hw: tw / tl, rawHw: mw });
  }
  return out;
}

/**
 * Build the visual courses of a network: soft roads (smoothed, extended past the map edge, width wander, rut lanes, end
 * kinds), hard ribbons (for their verge), the line extras' trodden paths / vehicle ruts. Pure.
 * @param {object} net normalized network (its non-enumerable missionId picks the line extras)
 * @param {number} W @param {number} D map size (m; 0 = unknown: nothing runs past an edge)
 * @param {object} [extrasIn] line extras to use instead of the mission's (tests, tools)
 * @returns {{courses:object[], theatre:string, theater:string, W:number, D:number, extras:object|null}}
 */
export function buildRoadModel(net, W, D, extrasIn, obstacles = null) {
  const extras = extrasIn !== undefined ? extrasIn : lineExtrasFor(net.missionId);
  return buildModel(net, W, D, extras, obstacles);
}

/** The line extras a painter / stamp job uses: `o.extras` if given, else the mission's (`o.missionId` or the net's). */
const extrasOf = (net, o = {}) => (o.extras !== undefined ? o.extras : lineExtrasFor(o.missionId ?? net.missionId));

function buildModel(net, W, D, extras, obstacles = null) {
  const fam = FAMILY(net.theater), courses = [];
  const soft = [], specs = [];
  net.roads.forEach((r, ri) => {
    const S = SURFACES[r.surface];
    const o = roadOptions(extras, r);
    if (o.skip) return;
    if (S.hard) {
      const L = sampleCenterline(r.points, 0.5, r.spline);
      courses.push({ id: r.id, ri, kind: 'hard', hard: true, road: r, pts: L, hw0: roadReach(r), o, seed: r.seed ?? ri + 1 });
      return;
    }
    specs.push({ r, ri, o, raw: r.points.map(pt) });
  });
  // soft roads that continue one another end to end (a station road becoming the works road) are ONE course: one crown,
  // one set of wandering lanes through the joint, instead of two sets of ruts ending on a line
  for (const ch of chainRoads(specs)) {
    const { r, ri, o } = ch.head, raw = ch.raw, one = ch.parts.length === 1;
    const hw = ch.hw;
    const ext = pastEdges(o.course ? o.course.map(pt) : raw, W, D, Math.max(1.5, hw + 1), 16);
    const L = r.spline && !o.course && one ? sampleCenterline(ext.points, 0.5, true) : roundCorners(ext.points, o.smooth ?? COURSE_DEFAULTS.smooth, 0.5);
    if (o.foot) { // a trodden foot path drawn as a road (M2's village path): walkers, no wheel lanes
      courses.push({ id: r.id, ri, kind: 'line', lineKind: 'foot', hard: false, road: r, raw, rawHw: hw, pts: L, hw0: hw, o,
        line: { kind: 'foot', passes: o.passes, strength: o.strength, recipe: o.recipe }, seed: r.seed ?? ri + 1, edge: [ext.start, ext.end], ends: [null, null] });
      continue;
    }
    const c = { id: ch.parts.map((q) => q.r.id).join('+'), ri, kind: 'road', hard: false, road: r, surface: r.surface, pts: L, raw, rawHw: ch.rawHw, hw0: hw, o,
      seed: r.seed ?? ri + 1, edge: [ext.start, ext.end], ends: [null, null] };
    soft.push(c); courses.push(c);
  }
  // the line extras' trodden paths, desire lines, cart / vehicle / tracked ruts (visual only: no grid, no record)
  (extras?.lines || []).forEach((l, li) => {
    if (!Array.isArray(l.pts) || l.pts.length < 2) return;
    const kind = l.kind || 'foot';
    const w = l.w ?? (kind === 'foot' ? 1.2 : kind === 'boot' ? 1.6 : kind === 'tracked' ? 3.1 : kind === 'cart' ? 1.9 : kind === 'sled' ? 1.4 : 2.4);
    const ext = pastEdges(l.pts.map(pt), W, D, w / 2 + 0.5, 12);
    const L = roundCorners(ext.points, l.smooth ?? 3, 0.5);
    courses.push({ id: l.id ?? `line${li}`, li, kind: 'line', lineKind: kind, hard: false, pts: L, hw0: w / 2, o: l, line: l, seed: l.seed ?? 900 + li * 37,
      edge: [ext.start, ext.end], ends: [null, null] });
  });
  // end kinds: an end on another soft road / line is a junction (no taper; its ruts merge), on the map edge it runs on,
  // anywhere else it is open: tapered and ragged over the last metres, its ruts stop short and spread
  const near = (p, c) => { let best = Infinity; for (let k = 0; k + 1 < c.pts.length; k += 1) { const a = c.pts[k], b = c.pts[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1; const u = clamp01(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2); best = Math.min(best, Math.hypot(p.x - a.x - dx * u, p.z - a.z - dz * u)); } return best; };
  for (const c of courses) {
    if (c.kind === 'hard') continue;
    for (const e of [0, 1]) {
      const p = e ? c.pts[c.pts.length - 1] : c.pts[0];
      const forced = c.o?.ends?.[e ? 'end' : 'start'];
      if (forced) { c.ends[e] = forced; continue; }
      if (c.edge[e]) { c.ends[e] = 'edge'; continue; }
      let joined = null;
      for (const q of courses) { if (q === c) continue; if (near(p, q) <= q.hw0 + (q.hard ? 1.2 : 0.8)) { joined = q; break; } }
      c.ends[e] = joined ? (joined.hard ? 'hard' : 'joined') : 'open';
      if (joined && !joined.hard && c.kind === 'road' && joined.kind === 'road') (c.joins ||= []).push({ e, q: joined });
    }
  }
  // worn corner fans: at every T where a road ends on another, the turning vehicles cut both inside corners
  for (const c of soft) for (const { e, q } of c.joins || []) {
    const P = e ? c.pts[c.pts.length - 1] : c.pts[0];
    c.L ??= c.pts[c.pts.length - 1].s; q.L ??= q.pts[q.pts.length - 1].s;
    const back = e ? pointAtS(c, Math.max(0, c.L - 7)) : pointAtS(c, Math.min(c.L, 7));
    const J = nearestOn(q, P.x, P.z);
    for (const sg of [-1, 1]) {
      const toS = J.s + sg * 7;
      if (toS < 0 || toS > q.L) continue;
      const B = pointAtS(q, toS), pts = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8, a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
        pts.push([a * back.x + b * J.x + d * B.x, a * back.z + b * J.z + d * B.z]);
      }
      const l = { kind: 'vehicle', pairs: 1, passes: 1, strength: 0.42, surface: false, fan: true, pts };
      courses.push({ id: `${c.id}~fan${sg}`, kind: 'line', lineKind: 'vehicle', hard: false, pts: sampleCenterline(pts, 0.5, false), hw0: 1.2, o: l, line: l,
        seed: (c.seed * 31 + (sg > 0 ? 7 : 13)) | 0, edge: [false, false], ends: ['joined', 'joined'] });
    }
  }
  // line extras that run from a point (a hut door) to the nearest road, whatever its id (roads another lane re-lays)
  const tr = extras?.toRoad;
  if (tr?.from?.length) {
    const roadsC = courses.filter((c) => c.kind === 'road' || c.kind === 'hard');
    tr.from.forEach((p, i) => {
      let best = null;
      for (const c of roadsC) { const q = nearestOn(c, p[0], p[1]); if (!best || q.d < best.d) best = q; }
      if (!best || best.d > 40 || best.d < 1.5) return;
      const mx = (p[0] + best.x) / 2, mz = (p[1] + best.z) / 2, nx = -(best.z - p[1]) / best.d, nz = (best.x - p[0]) / best.d;
      const bow = (hashN(i * 7.1 + 3) - 0.5) * Math.min(2, best.d * 0.12);
      const pts = [[p[0], p[1]], [mx + nx * bow, mz + nz * bow], [best.x, best.z]];
      const l = { kind: tr.kind || 'foot', w: tr.w ?? 1.1, strength: tr.strength ?? 0.75, pts };
      courses.push({ id: `toRoad${i}`, kind: 'line', lineKind: l.kind, hard: false, pts: roundCorners(pts, 3, 0.5), hw0: l.w / 2, o: l, line: l,
        seed: 1700 + i * 37, edge: [false, false], ends: ['open', 'joined'] });
    });
  }
  // per-course arc data: cumulative s is in pts[k].s; the visual width wander and the rut lanes
  for (const c of courses) {
    c.L = c.pts[c.pts.length - 1].s;
    if (c.kind === 'hard') continue;
    const o = c.o || {}, isLine = c.kind === 'line';
    c.widthRange = o.widthRange ?? null;
    c.wander = o.wander ?? (isLine ? 0.18 : COURSE_DEFAULTS.wander);
    c.taper = o.taper ?? (isLine ? 3 : COURSE_DEFAULTS.taper);
    c.vergeW = o.vergeW ?? (isLine ? [0.25, 0.6] : COURSE_DEFAULTS.vergeW);
    c.vergeSide = [o.vergeRight ?? null, o.vergeLeft ?? null];        // [side −1, side +1] caps (m)
    const lk = isLine ? c.lineKind : 'road';
    c.lanes = lk === 'foot' || lk === 'boot' || lk === 'drag' ? [] : roadRutLanes({ width: c.hw0 * 2, seed: c.seed }, { ...o, kind: lk, visualWidth: c.hw0 * 2 });
    // (a road's lanes swerve round what stands on it; the line extras are laid clear of everything by hand, unit-tested)
    if (c.kind === 'road' && c.lanes.length && obstacles?.length) laneDetours(c, obstacles);
    // a single vehicle's (cart's, tank's) tyre tracks tone a tyre's width, not a road's worn wheel lane (corner fans are traffic)
    c.rw = isLine && !o.fan ? ({ vehicle: 0.13, cart: 0.07, sled: 0.07, tracked: 0.26 })[lk] ?? null : null;
    c.strength = o.strength ?? 1;
    c.wearAt = Array.isArray(o.wearAt) ? o.wearAt : null;           // [[x, z, r, ×wear], …]: deeper near junctions / doors
  }
  return { courses, theatre: fam, theater: net.theater, W, D, extras };
}

/** Lane wear multiplier of a course at (x, z) from its `wearAt` zones (1 elsewhere). */
function wearMult(c, x, z) {
  if (!c.wearAt) return 1;
  let m = 1;
  for (const [wx, wz, r, k] of c.wearAt) { const d = Math.hypot(x - wx, z - wz); if (d < r) m += (k - 1) * sstep(r, r * 0.25, d); }
  return m;
}

/** Visual half-width of a course at arc length s (width wander, end taper). */
function courseHalfWidth(c, s) {
  let hw = c.hw0;
  if (c.widthRange) hw = lerp(c.widthRange[0], c.widthRange[1], fbm1(s / 21 + c.seed * 0.71)) / 2;
  else if (c.wander) hw *= 1 + c.wander * (2 * fbm1(s / 19 + c.seed * 0.53) - 1);
  return hw * courseEndFade(c, s, c.taper);
}

/** 0 at an open end … 1 `len` m in; 1 all along at joined / edge ends. */
function courseEndFade(c, s, len) {
  let f = 1;
  if (c.ends[0] === 'open') f *= sstep(0, len, s);
  if (c.ends[1] === 'open') f *= sstep(0, len, c.L - s);
  return f;
}

/** Samples per search chord of the course index (2 m): a texel tests the chords, then the 0.5 m segments of the nearest. */
const CHORD = 4;

/** How far past its centre line a course paints (m): carriageway + verge + ragged edge (+ the old grid paint it recycles). */
function courseReach(c) {
  if (c.hard) return c.hw0 + (c.o?.hardVerge?.[1] ?? 1.0) + 0.9;
  const hw = Math.max(c.hw0, (c.widthRange?.[1] ?? 0) / 2) * (1 + (c.wander || 0));
  if (c.kind === 'line') return Math.max(hw + 1.1 + (c.lanes.length ? 0.6 : 0), c.rawHw != null ? c.rawHw + 2.3 : 0);
  return Math.max(hw + (c.vergeW?.[1] ?? 1.2) * 1.6 + 1.8, (c.rawHw ?? 0) + 2.3);
}

/** Bucket index over course segments (3 m cells; 2 m search chords), each reaching its course's paint extent. */
function courseIndex(courses) {
  const cell = 3, map = new Map();
  const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  courses.forEach((c, ci) => {
    const reach = courseReach(c);
    for (let k = 0; k + 1 < c.pts.length; k += CHORD) {
      const a = c.pts[k], b = c.pts[Math.min(c.pts.length - 1, k + CHORD)];
      const i0 = Math.floor((Math.min(a.x, b.x) - reach) / cell), i1 = Math.floor((Math.max(a.x, b.x) + reach) / cell);
      const j0 = Math.floor((Math.min(a.z, b.z) - reach) / cell), j1 = Math.floor((Math.max(a.z, b.z) + reach) / cell);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = key(i, j);
        let arr = map.get(q);
        if (!arr) map.set(q, (arr = []));
        arr.push(ci, k);
      }
    }
  });
  return { cell, map, key };
}

/**
 * Nearest point of every course near (x, z): [{c, d, s, side, k}] (side +1 = left of travel), reused per texel.
 * @returns {number} hits written into `out`
 */
function nearCourses(model, x, z, out) {
  const { courses, idx } = model;
  const arr = idx.map.get(idx.key(Math.floor(x / idx.cell), Math.floor(z / idx.cell)));
  if (!arr) return 0;
  let n = 0;
  // 1. the nearest 2 m chord of each course
  for (let q = 0; q < arr.length; q += 2) {
    const ci = arr[q], k = arr[q + 1], c = courses[ci], a = c.pts[k], b = c.pts[Math.min(c.pts.length - 1, k + CHORD)];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
    const u = clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2);
    const d = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
    let h = -1;
    for (let m = 0; m < n; m++) if (out[m].c === c) { h = m; break; }
    if (h >= 0 && out[h].d <= d) continue;
    if (h < 0) { if (n >= out.length) out.push({}); h = n++; }
    out[h].c = c; out[h].d = d; out[h].k = k;
  }
  // 2. refine on the 0.5 m segments of (and next to) that chord
  for (let m = 0; m < n; m++) {
    const H = out[m], c = H.c, P = c.pts, k0 = Math.max(0, H.k - 2), k1 = Math.min(P.length - 2, H.k + CHORD + 1);
    let bd = Infinity;
    for (let k = k0; k <= k1; k++) {
      const a = P[k], b = P[k + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const u = clamp01(((x - a.x) * dx + (z - a.z) * dz) / l2);
      const d = Math.hypot(x - a.x - dx * u, z - a.z - dz * u);
      if (d < bd) { bd = d; H.k = k; H.s = a.s + Math.sqrt(l2) * u; H.side = dx * (z - a.z) - dz * (x - a.x) >= 0 ? 1 : -1; }
    }
    H.d = bd;
  }
  return n;
}

/** Wheel-lane wear (0..1) of a course at lateral offset t (m, + = left) and arc s: the max over its lanes' wheels. */
function laneWear(c, t, s) {
  let best = 0;
  let ef = courseEndFade(c, s, c.taper + 3);
  // at a junction the lanes run out into the other road's over 4 m (no tone stripe ending on a line)
  if (c.ends[0] === 'joined') ef *= 0.35 + 0.65 * sstep(0, 4, s);
  if (c.ends[1] === 'joined') ef *= 0.35 + 0.65 * sstep(0, 4, c.L - s);
  for (const ln of c.lanes) {
    // wear varies along the lane (heavier where traffic bunches, the outer lanes come and go)
    const along = (0.55 + 0.45 * fbm1(s / 23 + ln.seed * 1.7)) * (ln.wear > 0.8 ? 1 : sstep(0.28, 0.62, fbm1(s / 31 + ln.seed * 2.3)));
    if (along < 0.02) continue;
    const cut = ln.cut ? laneCutAt(ln, s) : 0;
    if (cut >= 0.999) continue;
    const o = laneOffsetAt(ln, s), half = ln.gauge / 2, rw = (c.rw ?? (ln.track ? 0.36 : 0.24)) * (0.85 + 0.4 * vn1(s / 4.3 + ln.seed));
    for (const w of [-1, 1]) {
      const d = Math.abs(t - (o + w * half));
      if (d > rw * 2.2) continue;
      const v = sstep(rw * 2.2, rw * 0.5, d) * ln.wear * along * (1 - cut);
      if (v > best) best = v;
    }
  }
  return best * ef;
}

/** Add `amt` × S of a {layer: fraction} recipe into w (layer names resolved through `li`). */
function addMix(w, rec, amt, S, li) {
  if (!rec || amt <= 0) return;
  for (const name in rec) { const i = li(name); if (i >= 0) w[i] += rec[name] * amt * S; }
}
/** Blend w toward a recipe (normalised to the texel's sum) by k. */
function blendTo(w, rec, k, S, li) {
  if (!rec || k <= 0) return;
  if (k > 1) k = 1;
  let tot = 0;
  for (const name in rec) if (li(name) >= 0) tot += rec[name];
  if (!(tot > 0)) return;
  for (let q = 0; q < 8; q++) w[q] *= 1 - k;
  for (const name in rec) { const i = li(name); if (i >= 0) w[i] += rec[name] / tot * k * S; }
}
/** Scale layers by name: {grass: 0.5} multiplies the grass weight by 1 − 0.5·amt. */
function thinMix(w, thin, amt, li) {
  if (!thin || amt <= 0) return;
  for (const name in thin) { const i = li(name); if (i >= 0) w[i] *= 1 - thin[name] * Math.min(1, amt); }
}

/** Per-theatre recipe (with the mission's overrides: 'thaw', 'coast'). */
function recipeFor(model, extras) {
  const base = RECIPES[model.theatre];
  const over = extras?.recipe === 'thaw' ? RECIPES.thaw : model.theater === 'coast' ? RECIPES.coast : null;
  return over ? { ...base, ...over } : base;
}

const bbox = (P) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of P) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } return [x0, z0, x1, z1]; };

/**
 * The visual road look: a painter `(x, z, w) → painted?` over a texel's 8 layer weights (any sum: normalised splat
 * bytes or a splat build's raw weights). Soft roads (legacy grid roads and 3p soft roads alike): a crowned carriageway
 * (packed lighter centre ~40 %, darker soft shoulders where the wheels run), the wheel lanes' wear tone (so it persists
 * after the trail field fades and continues over the apron), a ragged crumbly edge, a noise-wandering verge 0.6-1.2 m wide
 * (temperate trodden earth and gravel with the sward thinned; desert sand2 / dirt from the plain's own mix — no pale
 * halo; snow old snow with a dirty spray fringe), open ends tapered over their last metres, junction fillets, desert sand
 * tongues and windrows. Hard ribbons and pavement areas: a worn shoulder / slab wash / pad ring outside (their own
 * surfaces are the pavement meshes'). Line extras: trodden desire lines, cart and vehicle ruts. Overlapping roads merge
 * by max, never by sum. Returns true when it changed the texel.
 * @param {RoadIndex} index @param {string} theater @param {string[]} layers the theatre palette's 8 layer names
 * @param {{extras?:object, missionId?:string}} [o] extras: line extras to use instead of the mission's (tools, tests);
 *   missionId: the mission whose line extras apply, when the index's network is a copy (art/terrain.js drawnRoads)
 * @returns {((x:number, z:number, w:Float32Array) => boolean)|null}
 */
export function roadLookPainter(index, theater, layers, o = {}) {
  const net = index.net;
  const model = buildModel(net, index.W, index.D, extrasOf(net, o), o.obstacles);
  const th = model.theatre, R = recipeFor(model, model.extras);
  const li = (n) => layers.indexOf(n);
  const fans = (model.extras?.fans || []).map((f) => { const d = Math.hypot(f.dir?.[0] ?? 1, f.dir?.[1] ?? 0) || 1; return { ...f, dx: (f.dir?.[0] ?? 1) / d, dz: (f.dir?.[1] ?? 0) / d }; });
  const areaOpt = model.extras?.areas || {};
  // slab wash / pad ring per hard area (its bounding box kept here: the net is never written to)
  const areaBand = net.areas.map((a) => {
    const ao = areaOpt[a.id] || null, hard = SURFACES[a.surface]?.hard;
    const ring = hard ? ao?.ring ?? 0 : 0;
    const wash = hard ? ao?.wash ?? (th === 'temperate' && /^(concrete|asphalt|asphalt_cracked)$/.test(a.surface) ? 0.25 : 0) : 0;
    return { a, ring, wash, reach: Math.max(ring, wash) + 0.9, bb: bbox(a.points) };
  }).filter((b) => b.ring > 0 || b.wash > 0);
  if (!model.courses.length && !areaBand.length && !fans.length) return null;
  model.idx = courseIndex(model.courses);
  const sig = (R.sig || []).map(li).filter((i) => i >= 0);
  const shoreSig = [...new Set([...sig, li('mud'), li('wetsand')])].filter((i) => i >= 0);
  const hits = [];
  const isDesert = th === 'desert', isSnow = th === 'snow';
  const hardAny = net.roads.some((r) => SURFACES[r.surface]?.hard) || net.areas.some((a) => SURFACES[a.surface]?.hard);

  const paint = (x, z, w) => {
    // hard surfaces (setts, tar, concrete, quays, pads) are their pavement meshes': the look leaves them alone
    if (hardAny && index.covers(x, z)) return false;
    let S = 0;
    for (let q = 0; q < 8; q++) S += w[q];
    if (!(S > 0)) S = 1;
    let painted = false;
    // (1) the outside of hard areas: an oil / dirt wash at slab edges, a worn ring round pads; mud / grit fans
    if (areaBand.length && areaBands(x, z, w, S)) painted = true;
    for (const f of fans) {
      const dx = x - f.x, dz = z - f.z;
      if (Math.abs(dx) > f.r * 2.2 || Math.abs(dz) > f.r * 2.2) continue;
      const u = dx * f.dx + dz * f.dz, v = -dx * f.dz + dz * f.dx;
      const d = Math.hypot((u - f.r * 0.25) / (f.r * 1.25), v / f.r) + (fbm2(x * 0.9 + 1.7, z * 0.9 - 5.3) - 0.5) * 0.5;
      const k = sstep(1, 0.35, d) * (0.65 + 0.35 * vn2(x * 2.1, z * 2.1));
      if (k > 0.01) { blendTo(w, R[f.recipe] || R.fan, k * 0.8, S, li); painted = true; }
    }
    const n = nearCourses(model, x, z, hits);
    if (!n) return painted;
    // (2) soft courses: the nearest edge distance (smooth-min: junction fillets), the dominant course for the profile
    let E = Infinity, dom = null, domE = Infinity, laneMax = 0, crownMax = 0, shoulderMax = 0, hardE = Infinity, hardC = null;
    let lineE = Infinity, lineC = null, lineLane = 0, cleanup = 0, lineCleanup = 0;
    for (let m = 0; m < n; m++) {
      const H = hits[m], c = H.c;
      if (c.hard) { const e = H.d - c.hw0; if (e < hardE) { hardE = e; hardC = H; } continue; }
      // the old grid ROAD paint around the raw polyline (cell-shaped, warped): recycled where the visual road is not
      if (c.raw && H.d < c.rawHw + 2.2) { if (c.kind === 'line') lineCleanup = 1; else cleanup = 1; }
      const hw = courseHalfWidth(c, H.s);
      if (!(hw > 0.05)) continue;
      const t = H.d * H.side, u = H.d / hw;
      if (c.kind === 'line') {
        const e = H.d - hw;
        if (e < lineE) { lineE = e; lineC = H; }
        if (c.lanes.length && u < 1.4) lineLane = Math.max(lineLane, laneWear(c, t, H.s) * c.strength);
        continue;
      }
      const e = H.d - hw;
      // junction fillets: the smooth minimum rounds the inside corners where roads MEET; roads that run along each other
      // (an overlap, a doubled paint) merge by a plain minimum (max-not-sum: no widening, no double tone)
      if (E === Infinity) E = e;
      else {
        const p = c.pts[H.k], q = dom ? dom.c.pts[dom.k] : null;
        const par = q ? Math.abs(p.tx * q.tx + p.tz * q.tz) > 0.94 : false;
        E = par ? Math.min(E, e) : smin(E, e, c.o.fillet ?? COURSE_DEFAULTS.fillet);
      }
      if (e < domE) { domE = e; dom = H; dom.hw = hw; dom.u = u; dom.t = t; }
      if (u < 1.25) {
        laneMax = Math.max(laneMax, Math.min(1, laneWear(c, t, H.s) * (c.o.wear ?? 1) * wearMult(c, x, z)));
        crownMax = Math.max(crownMax, sstep(0.46, 0.14, u) * courseEndFade(c, H.s, c.taper));
        shoulderMax = Math.max(shoulderMax, sstep(0.3, 0.58, u) * sstep(1.06, 0.8, u));
      }
    }
    if (dom && paintRoad(x, z, w, S, E, dom, laneMax, crownMax, shoulderMax, cleanup)) painted = true;
    if (hardC && paintHardVerge(x, z, w, S, hardE, hardC)) painted = true;
    if (lineC && paintLine(x, z, w, S, lineE, lineC, lineLane, lineCleanup)) painted = true;
    return painted;
  };
  paint.model = model;
  return paint;

  // ---- the soft road cross-section -------------------------------------------------------------------------
  function paintRoad(x, z, w, S, E, H, lane, crown, shoulder, cleanup) {
    const c = H.c, o = c.o || {};
    // ragged edge at four scales: a 12 m wander and a 5 m one push tongues of the field in and of the road out, a 1.4 m
    // one roughens, a 0.3 m one crumbles (on desert pistes the wind-streak threshold adds: the edge wanders 0.3-1.2 m)
    let rag = (fbm2(x * 0.085 - 1.3, z * 0.085 + 6.1) - 0.5) * 1.0 + (fbm2(x * 0.2 + 4.7, z * 0.2 - 2.9) - 0.5) * 1.3
      + (fbm2(x * 0.7, z * 0.7) - 0.5) * 2 * (o.edgeRag ?? COURSE_DEFAULTS.edgeRag) + (vn2(x * 3.3, z * 3.3) - 0.5) * 0.3;
    let streak = 0;
    if (isDesert) {
      const q = x * WIND[0] + z * WIND[1], p = -x * WIND[1] + z * WIND[0];
      streak = fbm2(q / 9, p / 1.6);                     // stretched along the wind
      rag += (streak - 0.5) * 0.9;
    }
    const core = sstep(0.36, -0.3, E + rag);              // 1 on the carriageway
    // verge width: 0.6-1.2 m from a 6-14 m noise (never ruler-straight); one side may be capped (per-road option); on a
    // desert piste the downwind verge is wider
    const vW = c.vergeW, side = H.side;
    let vw = lerp(vW[0], vW[1], fbm2(x / 9.5 + 3.1, z / 9.5 - 1.7));
    const cap = c.vergeSide[side > 0 ? 1 : 0];
    if (cap != null) vw = Math.min(vw, cap);
    if (isDesert) {
      const dir = H.k < c.pts.length - 1 ? c.pts[H.k] : c.pts[c.pts.length - 2];
      const nx = -dir.tz * side, nz = dir.tx * side;              // outward normal on this side
      vw *= 1 + 0.6 * clamp01(nx * WIND[0] + nz * WIND[1]);       // downwind side wider
    }
    vw *= courseEndFade(c, H.s, 10);                                // the verge fades out over 10 m at open ends
    // patchy, never a continuous band: worn bare in places, the sward closing over it in others (no picture frame)
    const patch = 0.45 + 0.55 * sstep(0.3, 0.66, fbm2(x / 2.7 + 9.1, z / 2.7 - 3.3));
    const capped = cap != null ? cap : 9;
    const verge = (1 - core) * sstep(Math.min(vw + 0.35, capped + 0.15), vw * 0.25, E + rag * (cap != null ? 0.3 : 0.8)) * patch;
    if (core <= 0.001 && verge <= 0.01 && !cleanup) return false;
    // (a) the gameplay paint's road layers the visual road no longer covers (its cell-shaped band): back to the verge /
    //     the base ground (a road that wins over the shore band also takes back the bank's mud / wet sand in its corridor)
    const sigL = o.shoreWin ? shoreSig : sig;
    if (cleanup > 0 && core < 1 && sigL.length) {
      let r = 0;
      for (const i of sigL) { r += w[i]; w[i] = 0; }
      r *= 1 - core;
      if (r > 0) addMix(w, verge > 0.05 ? R.verge : R.base, r / S * (verge > 0.05 ? 1 : 0.92), S, li);
    }
    // (b) verge: trodden earth and gravel with the sward thinned (snow: old snow with a dirty fringe; desert: the
    //     plain's own sand darkened); a firm gravel edge where the road runs along the water
    if (verge > 0.01) {
      thinMix(w, R.thin, verge, li);
      blendTo(w, o.shoreWin ? R.firm : R.verge, verge * 0.85 * c.strength, S, li);
    }
    // spray: blotches of mud / dirty slush thrown off the wheels just past the edge (thicker near it), never a band
    if (R.spray && o.spray !== false) {
      const sp = (1 - core * 0.6) * sstep(1.1 + vw * 0.5, -0.25, E) * sstep(0.58, 0.76, vn2(x * 2.6 + 1.3, z * 2.6 - 4.4) * 0.65 + vn2(x * 6.3 - 2.1, z * 6.3 + 0.7) * 0.35);
      if (sp > 0.01) blendTo(w, R.spray, sp * 0.65 * (o.spray ?? 1), S, li);
    }
    // desert piste: a low, broken windrow of pale loose sand pushed out just past the edge
    if (isDesert && o.windrow && E + rag * 0.5 > -0.1) {
      const wr = sstep(-0.1, 0.12, E + rag * 0.5) * sstep(0.75, 0.3, E + rag * 0.5) * sstep(0.35, 0.62, fbm2(x / 3.4 - 6.1, z / 3.4 + 2.3));
      if (wr > 0.01) blendTo(w, R.windrow, wr * 0.6, S, li);
    }
    if (core <= 0.001) return true;
    // (c) the carriageway: blended toward its surface mix (a road is a road from any zoom), with long stretches wetter
    //     (more mud in the lanes and shoulders) or stonier (gravel on the crown) along a 10-30 m noise
    const coreRec = (R.core && (R.core[c.surface] || R.core.road || R.core.dirt)) || null;
    blendTo(w, coreRec, core * (o.shoreWin ? 0.96 : isDesert ? 0.94 : 0.9), S, li);
    const ef = courseEndFade(c, H.s, c.taper);
    const wet = sstep(0.42, 0.72, fbm1(H.s / 17 + c.seed * 0.37)), stony = sstep(0.5, 0.78, fbm1(H.s / 13 + c.seed * 1.13 + 7));
    // the packed centre: lighter (temperate gravel crown, snow polish); on a piste loose sand caught between the ruts in
    // patches; a lightly used track keeps a strip of grass / snow along its crown (`median`)
    const crownPatch = isDesert ? sstep(0.5, 0.8, fbm2(x / 2.2 + 5.5, z / 2.2 - 8.1)) : 0.55 + 0.45 * sstep(0.3, 0.6, fbm2(x / 1.9 + 5.5, z / 1.9 - 8.1));
    // (`glaze`, snow roads: how far traffic has polished the packed lanes: a brighter crown, cleaner, more even lanes)
    const gz = isSnow ? (o.glaze ?? 0) : 0;
    // (on a piste the loose sand between the ruts lies in patches: a lighter touch, the compacted band must still read)
    blendTo(w, R.crown, crown * core * (isDesert ? 0.3 : 0.6) * crownPatch * (1 - lane) * (0.75 + 0.5 * stony) * (1 + 0.4 * gz), S, li);
    if (o.median && R.median) {
      const md = o.median * crown * core * (1 - lane) * sstep(0.3, 0.6, fbm2(x / 1.7 - 2.2, z / 1.7 + 3.9));
      if (md > 0.01) blendTo(w, R.median, md * 0.8, S, li);
    }
    // the darker soft shoulders where the wheels run, then the wheel lanes themselves (dark, wet: the mud layer's
    // puddles open in the stamped ruts)
    blendTo(w, R.shoulder, shoulder * core * (0.38 + 0.25 * wet), S, li);
    const laneK = lane * core * (isSnow ? 0.55 + 0.2 * wet + 0.15 * gz : 0.5 + 0.25 * wet) * ef;
    if (gz > 0 && R.glazeRut) { blendTo(w, R.rut, laneK * (1 - gz), S, li); blendTo(w, R.glazeRut, laneK * gz, S, li); }
    else blendTo(w, R.rut, laneK, S, li);
    // crumbly edge: the last 0.4 m broken by noise
    const edge = core * sstep(-0.75, -0.05, E + rag * 0.5) * (0.5 + 0.5 * vn2(x * 2.3 + 7, z * 2.3 - 3));
    blendTo(w, R.edge, edge * 0.5, S, li);
    if (isDesert && o.tongues !== false) { // drift sand tongues across the piste every 6-15 m (streak-thresholded)
      const tg = sstep(0.6, 0.78, streak) * sstep(0.45, 0.8, vn1(H.s / 12.5 + c.seed * 1.37));
      if (tg > 0.01) blendTo(w, R.tongue, tg * 0.62 * core, S, li);
    }
    return true;
  }

  // ---- hard ribbons: a worn shoulder outside the setts / tarmac -------------------------------------------------
  function paintHardVerge(x, z, w, S, e, H) {
    const c = H.c, o = c.o || {};
    const vr = o.hardVerge ?? (th === 'temperate' ? [0.5, 1.0] : [0.3, 0.6]);
    if (e < -0.05) return false;
    const rag = (fbm2(x * 0.8 + 5.1, z * 0.8 - 2.2) - 0.5) * 0.7 + (vn2(x * 3.7, z * 3.7) - 0.5) * 0.25;
    const vw = lerp(vr[0], vr[1], fbm2(x / 8 - 3.3, z / 8 + 1.9));
    const v = sstep(vw + 0.45, vw * 0.55, e + rag * 0.5) * (0.55 + 0.45 * sstep(0.3, 0.6, fbm2(x / 2.4 + 1.1, z / 2.4 - 7.3)));
    if (v <= 0.01) return false;
    thinMix(w, R.thin, v, li);
    blendTo(w, R.hard, v * 0.85, S, li);
    if (o.gutter) { // gutter streaks: wet mud washed off the setts in broken lines along the kerb
      const g = sstep(0.42, 0.08, e + rag * 0.3) * sstep(0.45, 0.7, fbm2(x / 1.7 + 3.3, z / 1.7 - 8.1));
      if (g > 0.01) blendTo(w, R.gutter, g * 0.7, S, li);
    }
    return true;
  }

  // ---- line extras: trodden paths and ruts -------------------------------------------------------------------
  function paintLine(x, z, w, S, e, H, lane, cleanup) {
    const c = H.c, l = c.line, k = l.kind || 'foot';
    if (l.paint === false) return false;
    const rag = (fbm2(x * 1.1 + 2.7, z * 1.1 - 8.3) - 0.5) * 0.7 + (vn2(x * 4.1, z * 4.1) - 0.5) * 0.3;
    const a = sstep(0.32, -0.3, e + rag * Math.min(0.9, c.hw0)) * c.strength * courseEndFade(c, H.s, c.taper);
    if (cleanup && sig.length && a < 1) { // a road path drawn as a foot path: its old grid paint back to the base ground
      let r = 0;
      for (const i of sig) { r += w[i]; w[i] = 0; }
      if (r > 0) addMix(w, R.base, r / S * (1 - a), S, li);
    }
    if (a <= 0.01 && lane <= 0.01) return !!cleanup;
    const rec = l.recipe ? (typeof l.recipe === 'string' ? R[l.recipe === 'gravel' ? 'gravelPath' : l.recipe] : l.recipe) : k === 'foot' || k === 'boot' || k === 'drag' ? R.path : R.cart;
    if (l.surface === false) { blendTo(w, R.rut, lane * 0.45, S, li); return true; }   // corner fans: only their wheel lanes
    // trodden ground: patchy at its margin (stray prints, the sward closing over it), solid down the middle
    const patch = 0.65 + 0.35 * sstep(0.3, 0.62, fbm2(x / 1.6 + 2.2, z / 1.6 - 4.1));
    if (k === 'foot' || k === 'boot' || k === 'drag') { thinMix(w, R.thin, a, li); blendTo(w, rec, a * 0.82 * patch, S, li); }
    else {
      // a vehicle's track across open ground: the sward pressed and scuffed between the wheels, the tyre tracks themselves a
      // little darker and broken along their length (the trail field cuts them; this keeps them after it fades)
      const along = 0.6 + 0.4 * sstep(0.25, 0.7, fbm2(x / 3.1 - 1.7, z / 3.1 + 5.2));
      thinMix(w, R.thin, a * 0.5, li); blendTo(w, rec, a * 0.22 * patch, S, li); blendTo(w, R.lineRut ?? R.rut, lane * 0.55 * along, S, li);
    }
    return true;
  }

  // ---- areas: slab wash / pad ring outside the outline ------------------------------------------------------
  function areaBands(x, z, w, S) {
    let any = false;
    for (const { a, ring, wash, reach, bb } of areaBand) {
      if (x < bb[0] - reach || x > bb[2] + reach || z < bb[1] - reach || z > bb[3] + reach) continue;
      if (pointInPolygon(x, z, a.points)) continue;
      const { d } = polygonEdgeDistance(x, z, a.points);
      const rag = (fbm2(x * 0.9 + 1.3, z * 0.9 + 4.4) - 0.5) * 0.8;
      if (wash > 0) { const v = sstep(wash + 0.2, wash * 0.3, d + rag * 0.25); if (v > 0.01) { blendTo(w, R.wash, v * 0.75, S, li); any = true; } }
      if (ring > 0) { const v = sstep(ring + 0.6, ring * 0.35, d + rag); if (v > 0.01) { thinMix(w, R.thin, v * 0.75, li); blendTo(w, R.ring, v * 0.6, S, li); any = true; } }
    }
    return any;
  }
}

/**
 * Lay a look painter (roadLookPainter) over a finished splat's GPU bytes: per texel, its 8 bytes as weights, the
 * painter, the result written back (normalised) where it painted. The splat's floats (`f32`: the gameplay ground) are
 * never touched. A sliced job (engine/slice.js `due`).
 * @param {{res:number, w:number, h:number, a:Uint8Array, b:Uint8Array}} splat
 * @param {(x:number, z:number, w:Float32Array) => boolean} paint
 * @param {{origin?:number[], due?:() => boolean, skip?:(x:number, z:number) => boolean}} [o]
 * @returns {Generator<void, number>} texels written
 */
export function* overlayRoadLookG(splat, paint, o = {}) {
  if (!splat || typeof paint !== 'function') return 0;
  const { res, w: W, h: H, a, b } = splat, ox = o.origin?.[0] ?? 0, oz = o.origin?.[1] ?? 0;
  const due = o.due || (() => false), skip = o.skip || null;
  const w = new Float32Array(8);
  let n = 0;
  for (let j = 0; j < H; j++) {
    const z = oz + (j + 0.5) / res;
    for (let i = 0; i < W; i++) {
      const x = ox + (i + 0.5) / res;
      if (skip && skip(x, z)) continue;
      const p = j * W + i, q = p * 4;
      w[0] = a[q] / 255; w[1] = a[q + 1] / 255; w[2] = a[q + 2] / 255; w[3] = a[q + 3] / 255;
      w[4] = b[q] / 255; w[5] = b[q + 1] / 255; w[6] = b[q + 2] / 255; w[7] = b[q + 3] / 255;
      if (paint(x, z, w) !== true) continue;
      let S = 0;
      for (let k = 0; k < 8; k++) { if (!(w[k] > 0)) w[k] = 0; S += w[k]; }
      const sc = S > 1e-5 ? 255 / S : 0;
      a[q] = Math.round(w[0] * sc); a[q + 1] = Math.round(w[1] * sc); a[q + 2] = Math.round(w[2] * sc); a[q + 3] = Math.round(w[3] * sc);
      b[q] = Math.round(w[4] * sc); b[q + 1] = Math.round(w[5] * sc); b[q + 2] = Math.round(w[6] * sc); b[q + 3] = Math.round(w[7] * sc);
      n++;
    }
    if ((j & 7) === 7 && due()) yield;
  }
  return n;
}

/**
 * The road lines the scenery apron continues past the map edge (world/edge-extend.js edgeCrossings): each soft road's
 * centre line, width and rut spread exactly as before the visual model (legacy roads raw, 3p roads sampled every 2 m),
 * so the apron's own splat floats — what its grass tufts are planted from — and its crossing bands stay the gameplay
 * paint's; the look reaches the apron's drawn bytes only (overlayApronLookG).
 * @param {object} net normalized network @returns {{points:number[][], width:number, spread:number, near:number}[]}
 */
export function roadEdgeLines(net) {
  const out = [];
  for (const r of net?.roads || []) {
    if (SURFACES[r.surface]?.hard) continue;
    if (r.legacy) { out.push({ points: r.points.map((p) => [p[0], p[1]]), width: r.width ?? 3, spread: Math.min(1.2, (r.width ?? 3) * 0.2), near: (r.width ?? 3) / 2 + 2 }); continue; }
    out.push({ points: sampleCenterline(r.points, 2, r.spline).map((p) => [p.x, p.z]), width: r.width, spread: Math.min(1.4, r.width * 0.2), near: r.type === 'path' ? r.width / 2 + 2 : 1.5 });
  }
  return out;
}

/**
 * The road look over the scenery apron's splat bytes, once the apron is built (its floats and its tufts keep the
 * gameplay paint, as on the map): past the map edge each road crossing carries the look on from the map's last metres
 * (world/edge-extend.js crossingSource, as the apron's own road paint does), box-filtered 2 × 2 over the apron's coarse
 * texel. A sliced job; returns the texels painted (their textures flagged for upload).
 * @param {{crossings:object[], uniforms:object}} apron art/apron.js createApronG's handle @param {Function} look
 *   roadLookPainter @param {{W:number, D:number, period?:number, due?:Function}} o
 */
export function* overlayApronLookG(apron, look, o) {
  const U = apron?.uniforms, X = apron?.crossings || [];
  const tA = U?.tSplatA?.value, tB = U?.tSplatB?.value;
  if (typeof look !== 'function' || !X.length || !tA?.image?.data || !tB?.image?.data || !U.uMap || !U.uOrigin) return 0;
  const W = o.W, D = o.D, period = o.period ?? 14;
  const w = tA.image.width, h = tA.image.height, res = w / U.uMap.value.x;
  const q4 = 0.25 / res, SUB = [[-q4, -q4], [q4, -q4], [-q4, q4], [q4, q4]];
  const v = new Float32Array(8), acc = new Float32Array(8);
  const paint = (x, z, wt) => {
    if (x >= 0 && z >= 0 && x <= W && z <= D) return false; // under the map: the apron is not drawn there
    let hit = false;
    acc.fill(0);
    for (const [dx, dz] of SUB) {
      const q = crossingSource(x + dx, z + dz, X, W, D, period);
      v.set(wt);
      if (q && look(q.x, q.z, v) === true) { hit = true; for (let k = 0; k < 8; k++) acc[k] += wt[k] + (v[k] - wt[k]) * q.w; }
      else for (let k = 0; k < 8; k++) acc[k] += wt[k];
    }
    if (!hit) return false;
    for (let k = 0; k < 8; k++) wt[k] = acc[k] / SUB.length;
    return true;
  };
  const n = yield* overlayRoadLookG({ res, w, h, a: tA.image.data, b: tB.image.data }, paint, { origin: [U.uOrigin.value.x, U.uOrigin.value.y], due: o.due });
  if (n) { tA.needsUpdate = true; tB.needsUpdate = true; }
  return n;
}

/** Version of the road look (bump when the look's output changes: a cached splat painted by an older look is redone). */
const LOOK_VERSION = 'rt1.4';
/**
 * Identity of a network's road look (the overlay's mark on a cached splat): the network, the mission's line extras and
 * the look's version. A string; '' when the net cannot be serialised.
 */
export function roadLookKey(net, extras = lineExtrasFor(net?.missionId)) {
  try {
    const s = `${LOOK_VERSION}|${net?.missionId ?? ''}|${JSON.stringify(net)}|${JSON.stringify(extras ?? null)}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return `${LOOK_VERSION}:${s.length}:${h.toString(16)}`;
  } catch { return ''; }
}

// ------------------------------------------------------------------------------------------ pre-trampled ruts

/** Sample a course's offset line (lane wheel at offset fn(s)) between s0 and s1 every `step` m → [[x, z], …]. */
function offsetPolyline(c, offAt, s0, s1, step) {
  const out = [], P = c.pts;
  let k = 0;
  for (let s = Math.max(0, s0); s <= Math.min(c.L, s1) + 1e-6; s += step) {
    while (k < P.length - 2 && P[k + 1].s < s) k++;
    const a = P[k], b = P[k + 1], seg = b.s - a.s || 1e-9, u = clamp01((s - a.s) / seg);
    const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, tx = a.tx + (b.tx - a.tx) * u, tz = a.tz + (b.tz - a.tz) * u, l = Math.hypot(tx, tz) || 1;
    const o = offAt(s);
    out.push([x - (tz / l) * o, z + (tx / l) * o]);
  }
  return out;
}

/**
 * Load multipliers along a stamped polyline where it runs onto a hard surface (setts, tar, a slab): the wheels carry mud
 * a couple of metres onto it (a fading film: the pavement shader draws the trail field there), then nothing — no rut
 * ploughed through stone, no washed-out film over a whole pavé road. 1 off hard ground.
 */
function hardFade(pts, covers, carry = 2.5) {
  if (!covers) return null;
  const n = pts.length, on = new Uint8Array(n), cum = new Float64Array(n);
  let any = false;
  for (let k = 0; k < n; k++) {
    on[k] = covers(pts[k][0], pts[k][1]) ? 1 : 0; any ||= !!on[k];
    if (k) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  }
  if (!any) return null;
  const into = new Float64Array(n).fill(Infinity);
  let last = -Infinity;
  for (let k = 0; k < n; k++) { if (!on[k]) last = cum[k]; else into[k] = cum[k] - last; }
  last = Infinity;
  for (let k = n - 1; k >= 0; k--) { if (!on[k]) last = cum[k]; else into[k] = Math.min(into[k], last - cum[k]); }
  const out = new Array(n);
  for (let k = 0; k < n; k++) out[k] = on[k] ? 0.45 * Math.max(0, 1 - into[k] / carry) : 1;
  return out;
}

/**
 * Pre-trampled polylines for the terrain (worn ruts, slush, puddles at mission start), stamped by trails.js with no
 * gameplay record and re-applied after a lost context. Soft roads, legacy and 3p alike: per rut pair a few passes per
 * wheel line (±10 cm jitter round the wandering lane), wear × (1 − |u|²), stopping 2-4 m short of open ends (and
 * spreading there), merging into the other road at a junction (no end caps across its verge); a packed centre ('flatten');
 * 2-3 walkers along one verge. Then the line extras' desire lines (boot / foot passes), cart, vehicle and tracked ruts and
 * static stamps. Where a line runs onto a hard surface its ruts become a short fading film. Every job keeps `points`
 * (its centre line: the apron's crossings repeat its ruts past the edge).
 * @param {object} net normalized network @param {{extras?:object, missionId?:string, W?:number, D?:number}} [o] extras:
 *   line extras to use instead of the mission's (tools, tests); missionId: the mission whose line extras apply when the
 *   network is a copy; W / D: the map size (else the network's)
 */
export function pretrampleRoads(net, o = {}) {
  const info = netInfo(net), W = o.W ?? info?.size?.[0] ?? 0, D = o.D ?? info?.size?.[1] ?? 0;
  const model = buildModel(net, W, D, extrasOf(net, o), o.obstacles);
  const out = [];
  const fam = model.theatre;
  // hard surfaces the ruts must not plough through (the pavement meshes draw them; their films come from the trail field)
  const hardNet = net.roads.some((r) => SURFACES[r.surface]?.hard) || net.areas.some((a) => SURFACES[a.surface]?.hard);
  const hidx = hardNet ? new RoadIndex(net, Math.max(1, W || 1024), Math.max(1, D || 1024)) : null;
  const covers = hidx ? (x, z) => hidx.covers(x, z) : null;
  const dropHard = (pts) => (covers ? pts.filter((p) => !covers(p[0], p[1])) : pts);
  model.courses.forEach((c, ci) => {
    if (c.hard) {
      if (c.o?.rutsPast) out.push(hardEndRuts(c, ci, o.obstacles));
      if (c.o?.hardRuts) out.push(hardRuts(c, ci, c.o.hardRuts, o.obstacles));
      return;
    }
    const isLine = c.kind === 'line', k = isLine ? c.lineKind : 'road';
    if (isLine && c.line.ruts === false) return;
    const job = { points: c.pts.map((p) => [p.x, p.z]), width: c.hw0 * 2, seed: c.seed, near: c.hw0 + 2, spread: 0.3, lines: [], walkers: [], flatten: null, legacy: false };
    const step = 1;
    const strength = (c.o?.wear ?? 1) * (c.strength ?? 1);
    const short0 = c.ends[0] === 'open' ? (isLine ? 1.2 : 2 + 2 * hashN(c.seed * 3.1)) : 0;
    const short1 = c.ends[1] === 'open' ? (isLine ? 1.2 : 2 + 2 * hashN(c.seed * 5.3)) : 0;
    const s0 = short0, s1 = c.L - short1;
    if (s1 - s0 < 1.5) return;
    const rnd = seeded(c.seed * 977 + 13);
    if (k === 'foot' || k === 'boot' || k === 'drag') {
      // trodden lanes: walkers spread over the path's width (boot lanes: ~40 passes in deep snow), each with its own
      // stride, phase, depth and drift, so the prints churn into a trodden band instead of falling into ranks
      const passes = c.line.passes ?? (k === 'boot' ? 40 : k === 'drag' ? 2 : 6);
      const deep = k === 'boot' ? 0.55 : 0.6;
      for (let p = 0; p < passes; p++) {
        const off0 = (rnd() - 0.5) * c.hw0 * 1.4, ph = rnd() * 6.28, lam = 5 + rnd() * 6, amp = c.hw0 * (0.15 + 0.2 * rnd());
        const a0 = s0 + rnd() * Math.min(4, (s1 - s0) * 0.15), a1 = s1 - rnd() * Math.min(4, (s1 - s0) * 0.15);
        if (a1 - a0 < 1) continue;
        const pts = c.road ? dropHard(offsetPolyline(c, (s) => off0 + Math.sin(s / lam + ph) * amp, a0, a1, 0.5)) : offsetPolyline(c, (s) => off0 + Math.sin(s / lam + ph) * amp, a0, a1, 0.5);
        if (pts.length < 2) continue;
        job.walkers.push({ pts, seed: Math.floor(rnd() * 1e6), kind: k === 'drag' ? 'drag' : 'walker', stride: 0.62 + 0.18 * rnd(), phase: rnd(), depth: deep * (0.75 + 0.4 * rnd()) });
      }
      out.push(job);
      return;
    }
    // (a road's wheel lane is a trough the traffic has worn 0.35-0.45 m wide — wheels never run in one track — so its walls
    //  slope gently; on temperate ground, where the lanes are wet mud whose sheen draws a steep sunlit wall as a bright
    //  ruled line, it is broader still and a little shallower: 0.6 m, ×0.85; a single vehicle's line keeps its tyre's width)
    const wetMud = fam === 'temperate';
    const tireW = k === 'tracked' ? 0.5 : k === 'cart' ? 0.12 : k === 'sled' ? 0.1 : isLine ? 0.26 : (c.o?.rutW ?? (wetMud ? 0.6 : 0.4));
    const kind = k === 'tracked' ? 'track' : 'tire';
    for (const ln of c.lanes) {
      const passes = c.line?.passes ?? Math.max(1, Math.round((isLine ? 2 : 2 + 3 * ln.wear) * (c.o?.passes ?? 1)));
      for (const wsd of [-1, 1]) {
        for (let p = 0; p < passes; p++) {
          // each pass its own line through the lane: a jitter, a slow drift of its own (the bundle braids, widens and
          // narrows) and a small steering wobble
          const jit = (rnd() - 0.5) * (isLine ? 0.08 : 0.2), wob = rnd() * 6.28, dph = rnd() * 50, dam = isLine ? 0.04 : 0.11 + 0.08 * rnd();
          const half = ln.gauge / 2;
          // at open ends the lanes spread out (vehicles turn round, park, pull off)
          const spreadAt = (s) => {
            let sp = 0;
            if (c.ends[0] === 'open') sp += (1 - sstep(0, 6, s - s0)) * (rnd2(p, wsd, 1) - 0.5) * 1.6;
            if (c.ends[1] === 'open') sp += (1 - sstep(0, 6, s1 - s)) * (rnd2(p, wsd, 2) - 0.5) * 1.6;
            return sp;
          };
          const pts = offsetPolyline(c, (s) => laneOffsetAt(ln, s) + wsd * half + jit + dam * (2 * fbm1(s / 11 + dph) - 1) + 0.04 * Math.sin(s / 3.1 + wob) + spreadAt(s), s0, s1, step);
          // depth: the lane's wear, ramping in / out over the ends (2-4 m), a little per-pass variation
          // (a glazed snow road's lanes are polished rather than cut: shallower)
          const load = (kind === 'track' ? 1.05 : 1.0) * ln.wear * strength * (0.8 + 0.4 * rnd()) * (fam === 'snow' ? (isLine ? 0.85 : 0.7 * (1 - 0.3 * (c.o?.glaze ?? 0))) : isLine ? 1 : 0.9) * (isLine ? 1 : (c.o?.rutLoad ?? (wetMud ? 0.85 : 1)));
          // (a vehicle / cart / tank line too: the pavement shader turns any trail into a full film, so a lorry's line
          //  across a slab would print as two dark ruled stripes; its tyres only carry the soil a couple of metres on)
          const hf = hardFade(pts, covers, (isLine ? c.line.hardCarry : c.o?.hardCarry) ?? 2.5), ls = rnd() * 40;
          // the rut deepens and shallows along its length (heavy loads, soft patches, a wheel slipping off the crown), so
          // a lane is never one even stripe; deeper near junctions and doors (`wearAt`); a film only onto hard ground
          const loads = pts.map((q, i) => (0.3 + 0.7 * sstep(0.22, 0.78, fbm1((s0 + i * step) / 8.5 + ls))) * (c.wearAt ? Math.min(1.6, wearMult(c, q[0], q[1])) : 1) * (hf ? hf[i] : 1) * (ln.cut ? 1 - laneCutAt(ln, s0 + i * step) : 1));
          if (loads.every((v) => v <= 0.002)) continue;
          // a road's ruts are packed troughs (no ridge of pushed-up spoil along them); a lone rut over grass / sand keeps
          // most of its berm
          const berm = isLine ? (c.line.berm ?? 0.8) : (c.o?.berm ?? (fam === 'desert' ? 0.4 : 0.22));
          // ends: an open end's ruts fade over 3 m (and spread), a joined end's over 3.5 m into the other road's lanes, at a
          // hard surface over 1.5 m, at the map edge they run on
          const endFade = (e) => (e === 'open' ? 3 : e === 'joined' ? 3.5 : e === 'hard' ? 1.5 : 0.6);
          // a road's ruts are troughs worn by traffic (rounded walls, smeared tread: no ruled lip for the low sun to catch); a
          // lone line of a few passes keeps more of its print
          const worn = isLine ? (c.line.worn ?? (k === 'tracked' ? 0.25 : k === 'cart' ? 0.5 : 0.4)) : (c.o?.worn ?? 0.85);
          job.lines.push({ pts, kind, width: tireW * (0.92 + 0.16 * rnd()), load, loads, berm, worn, fade: [endFade(c.ends[0]), endFade(c.ends[1])] });
        }
      }
    }
    if (!isLine) {
      // the packed centre (grass pushed down, snow polished), then a few walkers along one verge
      const fl = dropHard(offsetPolyline(c, () => 0, s0, s1, 1.2));
      if (fl.length) job.flatten = { pts: fl, width: Math.max(1, c.hw0 * 1.1) };
      const nw = 2 + Math.floor(rnd() * 2), sideW = rnd() < 0.5 ? -1 : 1;
      for (let q = 0; q < nw; q++) {
        const off = sideW * (c.hw0 + 0.25 + rnd() * 0.5);
        const pts = dropHard(offsetPolyline(c, (s) => off + 0.25 * Math.sin(s / 6 + q * 2.1), s0 + 1, s1 - 1, 0.5));
        if (pts.length >= 2) job.walkers.push({ pts, seed: Math.floor(rnd() * 1e6), kind: 'walker' });
      }
    }
    out.push(job);
  });
  // static stamps from the line extras (track-link marks under a wreck, outrigger drags at a gun pit, …)
  const stamps = model.extras?.stamps || [];
  if (stamps.length) out.push({ points: [], width: 0, seed: 77, lines: stamps.map((st) => ({ pts: st.pts.map(pt), kind: st.kind || 'track', width: st.width ?? 0.5, load: st.load ?? 0.8, fade: [0.3, 0.3] })), walkers: [], legacy: false, near: 0 });
  return out;
}

/** Ruts that run a few metres onto / past a hard ribbon's ends (setts ramps, junctions): films on the setts. */
function hardEndRuts(c, ci, obstacles) {
  const lanes = roadRutLanes({ width: c.road.width, seed: c.seed }, { pairs: 2 });
  if (obstacles?.length) laneDetours(c, obstacles, lanes);
  const lines = [];
  const len = c.o.rutsPast;
  for (const e of [0, 1]) {
    const s0 = e ? Math.max(0, c.L - len) : 0, s1 = e ? c.L : Math.min(c.L, len);
    for (const ln of lanes) for (const wsd of [-1, 1]) {
      const pts = offsetPolyline(c, (s) => laneOffsetAt(ln, s) + wsd * ln.gauge / 2, s0, s1, 1);
      lines.push({ pts, kind: 'tire', width: 0.26, load: 0.7 * ln.wear, fade: e ? [len * 0.8, 0.3] : [0.3, len * 0.8], ...(ln.cut ? { loads: pts.map((_, i) => 1 - laneCutAt(ln, s0 + i)) } : {}) });
    }
  }
  return { points: [], width: 0, seed: 400 + ci, lines, walkers: [], legacy: false, near: 0 };
}

/** Wheel lanes along a whole hard ribbon (frozen / wet films in the setts' wheel paths: the pavement shader reads them). */
function hardRuts(c, ci, load, obstacles) {
  const lanes = roadRutLanes({ width: c.road.width, seed: c.seed }, { pairs: 2 }), lines = [], rnd = seeded(ci * 131 + 7);
  if (obstacles?.length) laneDetours(c, obstacles, lanes);
  for (const ln of lanes) for (const wsd of [-1, 1]) for (let p = 0; p < 2; p++) {
    const jit = (rnd() - 0.5) * 0.14;
    const pts = offsetPolyline(c, (s) => laneOffsetAt(ln, s) + wsd * ln.gauge / 2 + jit, 0, c.L, 1);
    lines.push({ pts, kind: 'tire', width: 0.28, load: load * ln.wear * (0.8 + 0.4 * rnd()), fade: [0.5, 0.5], ...(ln.cut ? { loads: pts.map((_, i) => 1 - laneCutAt(ln, i)) } : {}) });
  }
  return { points: [], width: 0, seed: 600 + ci, lines, walkers: [], legacy: false, near: 0 };
}

/** Mulberry32 (deterministic pre-trample jitter). */
function seeded(seed) {
  let a = (Math.floor(seed) >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd2 = (p, w, k) => hashN(p * 13.7 + w * 5.1 + k * 91.3);

// ------------------------------------------------------------------------------------------ street furniture

/** Lamp variants by furniture type shortcut. */
const LAMP_TYPES = { lamp: null, lamp_post: 'paris_single', street_lamp: 'paris_single', floodlight: 'floodlight', searchlight_pole: 'searchlight', wall_lamp: 'wall_lamp' };
/** Gameplay footprint radius (m) of posts that block a nav cell (0 = walk-through). */
export const FURNITURE_BLOCK = { lamp: 0.2, bollard: 0.15, morris_column: 0.7, telegraph: 0.2, sign: 0.1, bench: 0, fence: 0, crossing: 0, milestone: 0.2, capstan: 0.45, lifebuoy: 0.1 };

/**
 * Expand a network's furniture into concrete placements: explicit items, lamps along roads (`road.lamps`),
 * telegraph lines (`{type:'telegraph', points, spacing}` → poles + wire spans), fences along points.
 * @returns {{items: object[], lines: {poles: object[], h: number, wires: number}[]}}
 */
export function expandFurniture(net) {
  const items = [], lines = [];
  const lampOf = (f) => ({ kind: 'lamp', variant: f.variant || LAMP_TYPES[f.type] || 'paris_single', hooded: !!f.hooded, damaged: !!f.damaged,
    lean: f.lean ?? (f.damaged ? 8 : 0), lit: f.lit, x: f.x, z: f.z, rot: f.rot ?? 0, y: f.y ?? null, id: f.id, block: f.block });
  // (line extras: non-blocking poles slid along their line, clear of what stands on it — visual only, the sim never sees
  //  a block:false pole)
  const poleSlides = lineExtrasFor(net.missionId)?.poles || [];
  let tIdx = -1;
  for (const f of net.furniture) {
    if (f.type in LAMP_TYPES) items.push(lampOf(f));
    else if (f.type === 'telegraph' && Array.isArray(f.points) && f.points.length > 1) {
      tIdx++;
      const line = sampleCenterline(f.points, 1, f.spline ?? false), sp = f.spacing ?? 35, poles = [];
      const L = line[line.length - 1].s, n = Math.max(1, Math.round(L / sp));
      const slide = f.block === false ? poleSlides.find((q) => q.line === tIdx)?.slide : null;
      for (let k = 0; k <= n; k++) {
        const sk = Math.max(0, Math.min(L, (L * k) / n + (slide?.[k] ?? 0)));
        const p = line.find((q) => q.s >= sk - 1e-6) || line[line.length - 1];
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
