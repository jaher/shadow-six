/**
 * Building ↔ enclosure alignment analyzer (pure, no three.js; runs in Node tests and tools/layout/align-report.mjs).
 *
 * With the yawed camera (CONFIG.camera.yawDeg) a compound reads right only when its buildings run parallel to the
 * fence / wall / palisade around them (the BEL look). For every building-like structure (and parked ground
 * vehicle) this finds a reference line and the angular deviation of the structure's `rot` from it, modulo 90°:
 *   1. enclosure — the structure's centre lies inside a closed ring chained from wall/fence polylines (gate gaps
 *      ≤ ALIGN.closeGap m are bridged): the ring's wall segment nearest to the footprint;
 *   2. wall      — otherwise the nearest wall/fence segment within ALIGN.wallNear m of the footprint;
 *   (segments are ranked by distance from the footprint centre and gated by a clearance lower bound — centre distance
 *   minus half the longer side — so the reference never changes when the structure is turned to the suggestion);
 *   3. road      — otherwise the nearest road centre line (tangent) or pavement edge within ALIGN.roadNear m of the
 *      road/pavement edge (world/roads.js network: `roads`, legacy terrain road paths, `pavements`);
 *   4. none      — no reference: not checked.
 *   Rolling stock (RAIL_STOCK) first takes the nearest rail/tram track (or road with `rails`) within ALIGN.railNear m
 *   of its centre ('rail'): a wagon runs along its track whatever fence stands beside it.
 * Angles use the renderer's convention (art/props.js `placed`): `rot` rad maps local +X to (cos rot, sin rot) in
 * (x, z), so a segment a→b has angle atan2(bz − az, bx − ax); vehicles' `heading` uses the same convention.
 * Opt-out: a structure/vehicle carrying `alignFree: '<reason>'` is reported as 'free' and never a violation.
 * STRICT vs ADVISORY (user scope, 2026-09-27: "not all buildings need to be perfectly aligned, the tanks do"):
 *   strict   — fuel / storage / water tanks and cisterns (STRICT_TYPES, STRICT_VARIANT) and anything tagged
 *              `align: 'fence'`: more than ALIGN.tolDeg off the reference is a 'violation' (enforced by the unit test);
 *   advisory — everything else is an aesthetic call: 'ok' when parallel, 'near-miss' when tolDeg < |dev| ≤
 *              ALIGN.nearMissDeg (reads as a mistake on screen — make it parallel or clearly different, ≥ ~20°),
 *              'angled' when clearly different (a deliberate angle). Advisory items never fail a test.
 * Suggested rot = the reference angle + k·90° nearest to the current rot, so doors/fronts keep their side.
 * @module missions/alignment
 */
import { normalizeRoadNetwork, sampleCenterline, pointInPolygon } from '../world/roads.js';

/** Tunables (metres / degrees). */
export const ALIGN = Object.freeze({ tolDeg: 2, nearMissDeg: 15, wallNear: 12, roadNear: 10, closeGap: 12, railNear: 4 });

/** Structure types that are reference lines (wall-like linear props). */
export const WALL_TYPES = Object.freeze(['wall', 'fence', 'castle_wall', 'sea_wall', 'palisade']);

/** Structure types that are never checked: natural items, linear/area props, round props, water works, aimed guns. */
export const EXEMPT_TYPES = Object.freeze(new Set([
  'tree', 'pine', 'palm', 'bush', 'rocks', 'cliff', 'crater', 'lake', 'sea', 'river', 'ravine', 'current', 'minefield',
  'road', 'rail_track', 'rail_line', 'tram_track', 'trench', 'wall', 'fence', 'castle_wall', 'sea_wall', 'palisade',
  'barrels', 'well', 'radio_mast', 'lamp_post', 'telegraph_pole', 'telegraph', 'sign', 'searchlight', 'floodlight',
  'lighthouse', 'bridge', 'rail_bridge', 'truss_bridge', 'mobile_bridge', 'deck_underpass', 'pier', 'quay_edge',
  'dam', 'lock_gate', 'water_gate', 'uboat', 'battleship', 'plane', 'aa_gun', 'flak', 'railway_gun', 'cannon',
]));

/**
 * Variants that are scattered debris / field obstacles whatever their catalogue type (a `crates` or `ruins` prop
 * dressed as a wreck, timber debris, rubble, Czech hedgehogs, beach tetrahedra, dragon's teeth): never checked.
 */
export const EXEMPT_VARIANT = /wreck|burnt|burned|debris|rubble|hedgehog|dragons_teeth|tetrahedron|collapsed/;

/** Structure types held to the strict rule (tanks: cylinders / cisterns always run parallel to their fence). */
export const STRICT_TYPES = Object.freeze(new Set(['fueltank', 'fuel_tank', 'water_tank', 'storage_tank', 'oil_tank',
  'gas_tank', 'tank_farm', 'cistern', 'gasometer']));
/** Variants that make any structure a strict tank (a `crates`/`generator` prop dressed as a tank or cistern). */
export const STRICT_VARIANT = /cistern|(fuel|water|oil|storage|gas|petrol)_?tank|tank_(row|pair|farm|cradle)/;

/** Vehicle types that are checked when parked (no route): ground vehicles only. */
export const ALIGN_VEHICLES = Object.freeze(new Set(['truck', 'car', 'halftrack', 'horch', 'kubelwagen', 'motorcycle',
  'opel_blitz_tanker', 'sdkfz', 'van', 'willys', 'tank', 'jeep']));

/** Footprint defaults (w along rot, d across) mirroring art/props.js PROP_DEFAULTS for oriented types. */
const SIZE = { barracks: [12, 6], house: [8, 7], hut: [4, 4], bunker: [5, 5], hangar: [20, 16], ruins: [8, 8],
  train_car: [10, 2.8], tent: [4, 3], sandbags: [3, 0.8], crates: [2, 2], generator: [2, 1.4], gate: [4, 0.3],
  watchtower: [3, 3] };
const VEH_SIZE = { truck: [7, 2.5], opel_blitz_tanker: [7, 2.5], halftrack: [6, 2.3], sdkfz: [6, 2.3], motorcycle: [2.2, 0.8] };

const DEG = 180 / Math.PI;
const pt = (p) => (Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.z]);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Signed deviation in degrees of `rot` from `ref` (both rad), modulo 90°, in [-45, 45). */
export function modDev(rot, ref) {
  const d = ((rot - ref) * DEG) % 90;
  return ((d + 135) % 90 + 90) % 90 - 45;
}

/** Degrees normalized to [0, 360). */
export const norm360 = (d) => ((d % 360) + 360) % 360;

// ------------------------------------------------------------------------------------------------- geometry

function pointSegDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function segSegDist(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a[0], a[1], c, d), pointSegDist(b[0], b[1], c, d),
    pointSegDist(c[0], c[1], a, b), pointSegDist(d[0], d[1], a, b));
}

/** Oriented rect corners (w along rot, d across). */
export function rectCorners(x, z, w, d, rot) {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [x + u * c - v * s, z + u * s + v * c]);
}

/** Exact distance from an oriented rect footprint {corners} to segment a–b (0 when they touch/overlap) — for clearance checks. */
export function rectSegDist(fp, a, b) {
  const C = fp.corners;
  if (pointInPolygon(a[0], a[1], C) || pointInPolygon(b[0], b[1], C)) return 0;
  let m = Infinity;
  for (let k = 0; k < 4; k++) m = Math.min(m, segSegDist(C[k], C[(k + 1) % 4], a, b));
  return m;
}

function polyArea(P) {
  let s = 0;
  for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

// ---------------------------------------------------------------------------------------------- references

const isWallType = (t) => WALL_TYPES.includes(t);

/**
 * Wall/fence polylines of a mission: structure `points` / `segments`, rect-shaped wall props (long axis), and
 * street-furniture fences (`furniture[{type:'fence', points}]`) and quay faces (`setpieces[{type:'quay_edge', rings, lines}]`).
 * @returns {{id: string, pts: number[][]}[]}
 */
export function wallPolylines(def) {
  const out = [];
  (def.structures || []).forEach((s, i) => {
    if (!s || !isWallType(s.type)) return;
    const id = s.id ?? `${s.type}#${i}`;
    if (Array.isArray(s.segments)) for (const seg of s.segments) { if (seg.length > 1) out.push({ id, pts: seg.map(pt) }); }
    else if (Array.isArray(s.points) && s.points.length > 1) out.push({ id, pts: s.points.map(pt) });
    else if (s.x != null && s.z != null && s.w != null) {
      const rot = num(s.rot, 0), w = num(s.w, 0), d = num(s.d, 0);
      const a = w >= d ? rot : rot + Math.PI / 2, L = Math.max(w, d) / 2;
      out.push({ id, pts: [[s.x - Math.cos(a) * L, s.z - Math.sin(a) * L], [s.x + Math.cos(a) * L, s.z + Math.sin(a) * L]] });
    }
  });
  (def.furniture || []).forEach((f, i) => {
    if (f && f.type === 'fence' && Array.isArray(f.points) && f.points.length > 1) out.push({ id: f.id ?? `furniture#${i}`, pts: f.points.map(pt) });
  });
  // quay faces (the `quay_edge` set-piece, M13): each quay outline is the "wall" its depot, sheds and tanks line up with
  (def.setpieces || []).forEach((sp, i) => {
    if (!sp || sp.type !== 'quay_edge') return;
    const id = sp.id ?? `quay_edge#${i}`;
    for (const r of sp.rings || []) if (r.length > 2) out.push({ id, pts: [...r.map(pt), pt(r[0])] });
    for (const l of sp.lines || []) if (l.length > 1) out.push({ id, pts: l.map(pt) });
  });
  return out;
}

/**
 * Chain wall polylines end-to-end (gaps ≤ closeGap bridged, polylines reversed as needed) and keep the chains that
 * close into a ring. Each enclosure: {ids, ring (polygon points), segs (real wall segments only), area}.
 */
export function findEnclosures(polys, closeGap = ALIGN.closeGap) {
  const pool = polys.map((p) => ({ id: p.id, pts: p.pts.slice() }));
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const out = [];
  while (pool.length) {
    const first = pool.shift();
    const chain = first.pts.slice(), ids = new Set([first.id]);
    const segs = [];
    const addSegs = (P) => { for (let k = 0; k + 1 < P.length; k++) segs.push({ id: first.id, a: P[k], b: P[k + 1] }); };
    addSegs(first.pts);
    for (;;) {
      let best = null;
      pool.forEach((p, k) => {
        const h = chain[0], t = chain[chain.length - 1], A = p.pts[0], B = p.pts[p.pts.length - 1];
        for (const [dist, mode] of [[d2(t, A), 'tA'], [d2(t, B), 'tB'], [d2(h, B), 'hB'], [d2(h, A), 'hA']]) {
          if (dist <= closeGap && (!best || dist < best.dist)) best = { k, dist, mode };
        }
      });
      if (!best) break;
      const p = pool.splice(best.k, 1)[0];
      ids.add(p.id);
      for (let k = 0; k + 1 < p.pts.length; k++) segs.push({ id: p.id, a: p.pts[k], b: p.pts[k + 1] });
      const P = best.mode === 'tA' || best.mode === 'hB' ? p.pts : p.pts.slice().reverse();
      if (best.mode[0] === 't') chain.push(...P); else chain.unshift(...P);
    }
    const closed = chain.length >= 4 && d2(chain[0], chain[chain.length - 1]) <= closeGap;
    const ring = closed ? chain.filter((q, k) => k === 0 || d2(q, chain[k - 1]) > 1e-6) : null;
    if (ring && ring.length >= 3 && polyArea(ring) > 1) out.push({ ids: [...ids], ring, segs, area: polyArea(ring) });
  }
  return out;
}

/** Rail types: reference lines for rolling stock (a train car runs along its track, not the nearest fence). */
export const RAIL_TYPES = Object.freeze(['rail_track', 'rail_line', 'tram_track']);
/** Rolling-stock types that reference the nearest rail within ALIGN.railNear m (centre → track). */
export const RAIL_STOCK = Object.freeze(new Set(['train_car', 'locomotive', 'tram', 'wagon', 'flatcar']));

/** Rail centre lines: rail/tram track structures (`points` / `segments`) and roads carrying `rails`. */
export function railSegs(def) {
  const out = [];
  const add = (id, P) => { for (let k = 0; k + 1 < P.length; k++) out.push({ id, a: pt(P[k]), b: pt(P[k + 1]) }); };
  (def.structures || []).forEach((s, i) => {
    if (!s || !RAIL_TYPES.includes(s.type)) return;
    const id = s.id ?? `${s.type}#${i}`;
    if (Array.isArray(s.segments)) for (const seg of s.segments) add(id, seg);
    else if (Array.isArray(s.points)) add(id, s.points);
  });
  for (const r of normalizeRoadNetwork(def).roads) {
    if (r.rails) { const S = sampleCenterline(r.points, 1, !!r.spline); add(r.id, S.map((q) => [q.x, q.z])); }
  }
  return out;
}

/** Road centre lines (sampled, with tangents) and pavement polygons from the world/roads.js network. */
export function roadRefs(def) {
  const net = normalizeRoadNetwork(def);
  return {
    roads: net.roads.map((r) => ({ id: r.id, half: r.width / 2, samples: sampleCenterline(r.points, 1, !!r.spline) })),
    areas: net.areas.map((a) => ({ id: a.id, poly: a.points })),
  };
}

// ---------------------------------------------------------------------------------------------- candidates

/**
 * Checkable items of a mission: building-like structures (oriented footprint) and parked ground vehicles.
 * Skipped structures are returned too, with `skip` = reason (never violations).
 */
export function candidates(def) {
  const out = [];
  (def.structures || []).forEach((s, i) => {
    if (!s) return;
    const id = s.id ?? `${s.type}#${i}`;
    const strict = s.align === 'fence' || STRICT_TYPES.has(s.type) || (typeof s.variant === 'string' && STRICT_VARIANT.test(s.variant));
    const base = { id, type: s.type, what: 'structure', x: s.x, z: s.z, rot: num(s.rot, 0), strict, alignFree: s.alignFree ?? null };
    let skip = null;
    if (EXEMPT_TYPES.has(s.type)) skip = 'exempt type';
    else if (typeof s.variant === 'string' && EXEMPT_VARIANT.test(s.variant)) skip = 'debris/obstacle variant';
    else if (s.x == null || s.z == null) skip = 'no position';
    else if (Array.isArray(s.points) || Array.isArray(s.segments)) skip = 'polyline/area prop';
    else if (s.ring) skip = 'sandbag ring';
    let w = s.w, d = s.d;
    if (!skip && (w == null || d == null)) {
      const S = SIZE[s.type];
      if (S) { w = w ?? S[0]; d = d ?? S[1]; } else if (s.r != null) skip = 'round prop';
      else { w = w ?? 2; d = d ?? 2; }
    }
    out.push(skip ? { ...base, skip } : { ...base, w, d });
  });
  (def.vehicles || []).forEach((v, i) => {
    if (!v) return;
    const id = v.id ?? `vehicle${i}`, t = v.vehicleType || v.type || 'truck';
    const base = { id, type: t, what: 'vehicle', x: v.x, z: v.z, rot: num(v.heading, 0), strict: v.align === 'fence', alignFree: v.alignFree ?? null };
    let skip = null;
    if (!ALIGN_VEHICLES.has(t)) skip = 'non-ground vehicle';
    else if (v.route) skip = 'moving (route)';
    else if (v.x == null || v.z == null) skip = 'no position';
    const S = VEH_SIZE[t] || [4.5, 1.9];
    out.push(skip ? { ...base, skip } : { ...base, w: S[0], d: S[1] });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------- analysis

/**
 * Rotation-invariant distances, so the reference does not change when the structure is turned to the suggestion:
 * `c` = footprint centre → segment, `dist` = clearance lower bound (c − half the footprint's longer side, ≥ 0).
 */
const segDist = (fp, a, b) => {
  const c = pointSegDist(fp.x, fp.z, a, b);
  return { c, dist: Math.max(0, c - fp.reach) };
};

function nearestSeg(fp, segs) {
  let best = null;
  for (const s of segs) {
    const m = segDist(fp, s.a, s.b);
    if (!best || m.c < best.c - 1e-9) best = { ...s, ...m };
  }
  return best;
}

/**
 * Reference line for one footprint {x, z, w, d, rot, reach}.
 * @returns {{kind:'rail'|'enclosure'|'wall'|'road'|'pavement', id:string, a:number[], b:number[], angle:number, dist:number}|null}
 */
export function referenceFor(fp, ctx, opts = {}) {
  const O = { ...ALIGN, ...opts };
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (fp.rail && ctx.rails?.length) {
    const r = nearestSeg(fp, ctx.rails);
    if (r && r.c <= O.railNear) return { kind: 'rail', id: r.id, a: r.a, b: r.b, angle: ang(r.a, r.b), dist: r.c };
  }
  const inside = ctx.enclosures.filter((e) => pointInPolygon(fp.x, fp.z, e.ring)).sort((p, q) => p.area - q.area);
  if (inside.length) {
    let s = nearestSeg(fp, inside[0].segs);
    if (s && s.dist > O.wallNear) {
      // deep inside the compound (no wall within wallNear): any of its wall directions will do — the best-matching
      // one (ties → the longest wall), so an irregular ring (a chamfered corner) does not dictate the whole yard
      const len = (q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);
      for (const q of inside[0].segs) {
        const dq = Math.abs(modDev(fp.rot, ang(q.a, q.b))), ds = Math.abs(modDev(fp.rot, ang(s.a, s.b)));
        if (dq < ds - 1e-6 || (Math.abs(dq - ds) <= 1e-6 && len(q) > len(s))) s = { ...q, ...segDist(fp, q.a, q.b) };
      }
    }
    if (s) return { kind: 'enclosure', id: s.id, a: s.a, b: s.b, angle: ang(s.a, s.b), dist: s.dist };
  }
  const s = nearestSeg(fp, ctx.wallSegs);
  if (s && s.dist <= O.wallNear) return { kind: 'wall', id: s.id, a: s.a, b: s.b, angle: ang(s.a, s.b), dist: s.dist };
  let best = null;
  for (const r of ctx.roads) {
    for (let k = 0; k + 1 < r.samples.length; k++) {
      const p = r.samples[k], q = r.samples[k + 1];
      const m = segDist(fp, [p.x, p.z], [q.x, q.z]), dist = Math.max(0, m.dist - r.half);
      if (dist <= O.roadNear && (!best || m.c - r.half < best.c)) best = { kind: 'road', id: r.id, a: [p.x, p.z], b: [q.x, q.z], angle: Math.atan2(q.z - p.z, q.x - p.x), dist, c: m.c - r.half };
    }
  }
  for (const A of ctx.areas) {
    const P = A.poly, inArea = pointInPolygon(fp.x, fp.z, P);
    for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      const { c, dist } = segDist(fp, a, b);
      if ((inArea || dist <= O.roadNear) && (!best || c < best.c)) best = { kind: 'pavement', id: A.id, a, b, angle: ang(a, b), dist, c };
    }
  }
  return best;
}

/**
 * Analyze one mission def (raw or normalized).
 * @param {object} def
 * @param {{tolDeg?:number, wallNear?:number, roadNear?:number, closeGap?:number}} [opts]
 * @returns {{id:string, entries:object[], violations:object[], advisories:object[], nearMisses:object[], enclosures:object[]}}
 *   entries: every candidate with {id, type, what, strict, x, z, rotDeg, status, ref, devDeg, suggestedDeg, skip?,
 *   alignFree?}; status 'ok'|'violation' (strict only)|'near-miss'|'angled' (advisory only)|'free'|'noref'|'skip'.
 *   violations = strict items off by more than tolDeg; advisories = non-strict items off (near-misses + angled).
 */
export function analyzeMission(def, opts = {}) {
  const O = { ...ALIGN, ...opts };
  const polys = wallPolylines(def);
  const enclosures = findEnclosures(polys, O.closeGap);
  const wallSegs = [];
  for (const p of polys) for (let k = 0; k + 1 < p.pts.length; k++) wallSegs.push({ id: p.id, a: p.pts[k], b: p.pts[k + 1] });
  const ctx = { enclosures, wallSegs, rails: railSegs(def), ...roadRefs(def) };
  const entries = candidates(def).map((c) => {
    const e = { id: c.id, type: c.type, what: c.what, strict: !!c.strict, x: c.x, z: c.z, rotDeg: +norm360(c.rot * DEG).toFixed(2), ref: null, devDeg: null, suggestedDeg: null };
    if (c.skip) return { ...e, status: 'skip', skip: c.skip };
    const fp = { x: c.x, z: c.z, w: c.w, d: c.d, rot: c.rot, reach: Math.max(c.w, c.d) / 2, rail: RAIL_STOCK.has(c.type) };
    const ref = referenceFor(fp, ctx, O);
    if (!ref) return { ...e, status: c.alignFree ? 'free' : 'noref', alignFree: c.alignFree };
    const dev = modDev(c.rot, ref.angle);
    const out = {
      ...e, ref: { kind: ref.kind, id: ref.id, a: ref.a.map((v) => +v.toFixed(2)), b: ref.b.map((v) => +v.toFixed(2)),
        angleDeg: +(ref.angle * DEG).toFixed(2), dist: +ref.dist.toFixed(2) },
      devDeg: +dev.toFixed(2), suggestedDeg: +norm360(c.rot * DEG - dev).toFixed(2),
    };
    if (c.alignFree) return { ...out, status: 'free', alignFree: c.alignFree };
    const a = Math.abs(dev);
    if (a <= O.tolDeg) return { ...out, status: 'ok' };
    if (c.strict) return { ...out, status: 'violation' };
    return { ...out, status: a <= O.nearMissDeg ? 'near-miss' : 'angled' };
  });
  return {
    id: def.id ?? '?', entries, enclosures,
    violations: entries.filter((e) => e.status === 'violation'),
    advisories: entries.filter((e) => e.status === 'near-miss' || e.status === 'angled'),
    nearMisses: entries.filter((e) => e.status === 'near-miss'),
  };
}

/** Plain-text table of an analysis (the CLI output). `all` also lists skipped / unreferenced items. */
export function formatReport(res, { all = false } = {}) {
  const rows = res.entries.filter((e) => all || (e.status !== 'skip' && e.status !== 'noref'));
  const head = ['id', 'type', 'rule', 'rot°', 'reference', 'dist', 'dev°', 'suggest°', 'status'];
  const body = rows.map((e) => [e.id, e.type, e.strict ? 'STRICT' : 'advisory', e.rotDeg.toFixed(1),
    e.ref ? `${e.ref.kind}:${e.ref.id} (${e.ref.a.join(',')})→(${e.ref.b.join(',')}) ${e.ref.angleDeg.toFixed(1)}°` : '-',
    e.ref ? e.ref.dist.toFixed(1) : '-', e.devDeg == null ? '-' : e.devDeg.toFixed(1),
    e.suggestedDeg == null ? '-' : e.suggestedDeg.toFixed(1),
    e.status === 'violation' ? 'VIOLATION' : e.status === 'near-miss' ? 'near-miss (warn)' : e.status + (e.skip ? ` (${e.skip})` : e.alignFree ? ` (${e.alignFree})` : '')]);
  const W = head.map((h, k) => Math.max(h.length, ...body.map((r) => String(r[k]).length)));
  const line = (r) => '| ' + r.map((v, k) => String(v).padEnd(W[k])).join(' | ') + ' |';
  const counts = ['ok', 'violation', 'near-miss', 'angled', 'free', 'noref', 'skip'].map((s) => `${s} ${res.entries.filter((e) => e.status === s).length}`).join(', ');
  const nm = res.nearMisses?.length ?? 0;
  return [`## ${res.id} — ${res.violations.length} violation(s), ${nm} near-miss warning(s) (${counts}; ${res.enclosures.length} enclosure(s))`, '',
    line(head), '|' + W.map((w) => '-'.repeat(w + 2)).join('|') + '|', ...body.map(line)].join('\n');
}
