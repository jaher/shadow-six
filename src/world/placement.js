/**
 * Generic placement rules against object interpenetration (user report: "turrets crossing a fence"). Pure and
 * data-driven: runs on any mission's structures / items / interactables / spawns (missions 4-20, phase 3 street
 * furniture), called by map-builder before the meshes are built. Rules:
 *  (a) linear runs (walls, fences, palisades, wire, sandbag lines): the VISUAL run is cut where a solid stands ON it
 *      (building, tower, gate, bunker, bridge/dam, tent, big prop, a higher-ranked run: its body at wall height
 *      reaches the run's centreline; one merely touching the run's face never cuts it) with the cut end stopping
 *      `linearGap` short of it — the fence builder puts end posts there; the NAV footprint keeps the authored line,
 *      so no gap ever opens. Runs of one kind sharing an end are chained into one run (proper corners). A watchtower
 *      standing on a run is moved to the run's inner side with its legs against the fence (`onLine: 'gap'` keeps it
 *      in place and cuts the run instead); units posted on it follow.
 *  (b) point props (trees, bushes, rocks, crates, drums, poles, dressing, pickups): exclusion zones around solids
 *      (+ eaves / crown clearance per category), runs, bridges, vehicle routes, roads (trees/rocks), water, and each
 *      other (trees vs rocks/poles) → relocated to the nearest free spot within `maxMove` (seeded ring search,
 *      deterministic), else dropped (scenery) or kept with a log line (gameplay objects).
 *  (c) spawns: ground units standing inside a solid are pushed out; elevated units on a wall walk keep their body
 *      clear of the wall.
 * Structure hooks: `fixed: true` (never moved), `onLine: 'gap'|'attach'` (towers), `clipAllow: [id|type|category]`
 * (explicit join, never cut/moved against that item), `clip: false` (ignored by the rules).
 * @module world/placement
 */
import { rectPoly, circlePoly, polyDist, lineDist, inPoly, clipPolyline, sweepPoly, linePolys, inflatePoly, centroidOf, convexHull, segDist, boundsOf, polysOverlap } from './placement-geom.js';
import { categoryOf } from '../debug/clip-rules.js';

/** Tunables (metres). */
export const RULES = Object.freeze({
  linearGap: 0.06, // a cut visual run stops this far from the solid it meets
  towerGap: 0.08, // tower legs ↔ fence face
  step: 0.15, maxMove: 4.5, angles: 16, // relocation ring search
  unitR: 0.35, // character body radius
  eaves: 0.6, // roof overhang beyond a building's wall line (tall point props keep clear of it)
});

/** Categories a linear run is cut against (the solid wins). */
export const RUN_SOLIDS = new Set(['building', 'tower', 'gate', 'bridge', 'pier', 'tent', 'ruins', 'vehicle', 'emplacement']);
/** Linear categories and their rank: a lower-ranked run is cut where it crosses a higher (or earlier equal) one. */
export const RUN_RANK = { wall: 3, sandbags: 2, fence: 1, wire: 0 };
/** Interactable kinds that are part of a structure (gates in fences, bridges, lifts): run cutters, never moved. */
export const GATE_KIND = /gate|bridge|lift|door/i;
const GATE_R = 1.6; // a 3 m leaf + its posts
/** Interactables that never move (mechanisms, rails, switches, anything with its own rect). */
export const FIXED_INTERACTABLE = (it) => !!(it.rect || it.rail || it.targets || it.w != null)
  || /gate|bridge|lift|door|switch|ladder|pushable|extraction/i.test(String(it.interactKind ?? it.kind ?? ''));
/** Movable point categories. */
export const POINT_CATS = new Set(['prop', 'tree', 'pole', 'rocks', 'item']);
/** Max plan area (m²) of a movable point prop; bigger props are solids. */
export const POINT_MAX_AREA = 12;

/**
 * Clearance (m) a movable point keeps from an obstacle, by point category → obstacle category ('*' = default,
 * null = never an obstacle for that point = natural contact).
 */
export const CLEARANCE = {
  prop: { '*': 0.1, prop: null, rocks: null, tree: null, foliage: null, item: null, route: null, road: null },
  item: { '*': 0.2, prop: 0.05, rocks: 0.1, item: null, tree: 0.2, route: null, road: null },
  rocks: { '*': 0.15, rocks: null, cliff: null, ruins: null, tree: null, prop: null, item: null, road: 0.3, route: 0.6 },
  pole: { '*': 0.3, building: 0.3 + RULES.eaves, tree: null, prop: 0.1, item: null, route: 0.5, road: 0.2 },
  unit: { '*': 0.03, route: null, road: null, item: null, tree: 0.05 },
  // trees: the TRUNK keeps these; the crown is pruned / narrowed to clear what stands within its reach (pruneTree)
  tree: { '*': 0.3, building: 0.3 + RULES.eaves, tower: 0.6, pole: 0.5, tree: null, rocks: 0.25, prop: 0.3, item: null, route: 0.5, road: 0.6 },
};

/** Typical height (m) of an obstacle by category when its def has no `h` (crown pruning). */
export const OBSTACLE_H = { wall: 2.2, fence: 2.0, sandbags: 1.0, rocks: 1.5, rocks_big: 3, cliff: 8, building: 6, tower: 7, pole: 8, prop: 1.3, item: 0.5, bridge: 1.6, pier: 1.0, gate: 2.5, tent: 2.5, route: 2.6, vehicle: 3.2, emplacement: 1.2, ruins: 2.5 };

/**
 * Crown pruning (rule b, trees): obstacles within the crown's reach either lift the lowest branches above them
 * (`crownBase`, m — a pruned tree, as next to walls, rocks and boats) or, when they are too tall for that, narrow
 * the crown (`crownR`, m). Conifer reach ≈ 0.3 × height. Returns the hints (or null) for the tree generator.
 */
export function pruneTree(def, obstacles) {
  const H = def.h ?? 10, reach = 0.35 * H + 0.3, x = def.x ?? 0, z = def.z ?? 0;
  let base = 0, crownR = Infinity;
  for (const o of obstacles) {
    if (o.cat === 'tree' || o.cat === 'foliage' || o.cat === 'item' || o.cat === 'road' || o.def === def) continue;
    if (!bboxHit([x, z, x, z], o.bb, reach)) continue;
    let d = Infinity;
    for (const p of o.tall) d = Math.min(d, Math.max(0, polyDist(x, z, p)));
    if (d >= reach) continue;
    const h = o.def?.h ?? OBSTACLE_H[o.cat] ?? 2;
    if (h + 0.9 <= 0.55 * H) base = Math.max(base, h + 0.9); // + branch droop and hanging needle cards
    else crownR = Math.min(crownR, Math.max(1.2, d - 0.25));
  }
  if (!base && crownR === Infinity) return null;
  return { ...(base ? { crownBase: +base.toFixed(2) } : {}), ...(crownR < Infinity ? { crownR: +crownR.toFixed(2) } : {}) };
}

const toXZ = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]);
const isLinearDef = (d) => !!(d.segments || (Array.isArray(d.points) && ['wall', 'fence', 'barbed_wire', 'wire', 'wire_fence', 'palisade', 'sandbag_line', 'railing'].includes(d.type)));
/** Runs ([[x, z], …][]) of a linear def. */
export function runsOf(d) {
  if (d.segments) return d.segments.map((r) => r.map(toXZ));
  if (Array.isArray(d.points)) return [d.points.map(toXZ)];
  return [];
}

/** Placement category of a def ('ground' / linear / solid / point categories; `item` for pickups). */
export function placeCat(d) {
  const c = categoryOf(d.type, d);
  if (c === 'prop' || c === 'rocks') {
    const w = d.w ?? (d.r != null ? d.r * 2 : 1), dd = d.d ?? (d.r != null ? d.r * 2 : 1);
    if (w * dd > POINT_MAX_AREA) return c === 'rocks' ? 'rocks_big' : 'building';
  }
  return c;
}

/** Data-shape margins by category: how far the typical visual reaches beyond the gameplay rect (tower legs splay). */
export const DATA_MARGIN = { tower: 0.8 };

/** Plan polygons of a def from its data (rect w × d at rot, circle r, poly points, line capsule). */
export function dataShape(d, cat = placeCat(d)) {
  if (isLinearDef(d)) return runsOf(d).flatMap((r) => linePolys(r, Math.max(0.1, (d.width ?? (cat === 'wall' ? 0.5 : 0.1)) / 2)));
  if (Array.isArray(d.points) && d.points.length >= 3) return [d.points.map(toXZ)];
  const x = d.x ?? 0, z = d.z ?? 0, m = DATA_MARGIN[cat] ?? 0;
  if (d.w != null && d.d != null) return [rectPoly(x, z, d.w, d.d, d.rot ?? 0, m)];
  if (d.ring) return [circlePoly(x, z, d.ring.r + 0.5)];
  if (d.r != null) return [circlePoly(x, z, d.r)];
  if (d.w != null) return [rectPoly(x, z, d.w, Math.min(d.w, 0.5), d.rot ?? 0)];
  const R = { tree: 0.4, pine: 0.4, pole: 0.25, item: 0.3, prop: 0.5 }[cat] ?? 0.5;
  return [circlePoly(x, z, R)];
}

/** Seeded [0, 1) generator (mulberry32). */
export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Stable 32-bit hash of a string. */
export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Stricter pairs while SEARCHING a new spot (a moved drum must not land in another drum; authored stacks stay). */
export const SEARCH_CLEARANCE = { prop: { prop: 0.03 }, item: { item: 0.1 } };

/** Clearance between a movable point of category `a` and an obstacle of category `b` (null = allowed contact). */
export function clearance(a, b, search = false) {
  if (search && SEARCH_CLEARANCE[a] && b in SEARCH_CLEARANCE[a]) return SEARCH_CLEARANCE[a][b];
  const t = CLEARANCE[a];
  const own = t ? (b in t ? t[b] : t['*']) : 0.1;
  const rev = CLEARANCE[b] && POINT_CATS.has(b) ? (a in CLEARANCE[b] ? CLEARANCE[b][a] : CLEARANCE[b]['*']) : undefined;
  if (own == null && rev == null) return null;
  return Math.max(own ?? 0, rev ?? 0);
}

const shift = (polys, dx, dz) => polys.map((p) => p.map(([x, z]) => [x + dx, z + dz]));
const bboxHit = (a, b, m) => a[0] - m <= b[2] && b[0] - m <= a[2] && a[1] - m <= b[3] && b[1] - m <= a[3];

/** Minimum clearance-violation test: does any vertex/edge of `mine` come within `clr` of an obstacle polygon? */
export function tooClose(mine, obs, clr) {
  for (const p of mine) for (const q of obs) {
    if (polysOverlap(p, q)) return true;
    for (const [x, z] of p) if (polyDist(x, z, q) < clr) return true;
    for (const [x, z] of q) if (polyDist(x, z, p) < clr) return true;
  }
  return false;
}

/**
 * Obstacles in conflict with a point shape `polys` of category `cat` (list of {id, cat, polys, bb}).
 * @returns {object[]}
 */
export function conflicts(polys, cat, obstacles, self = null, search = false) {
  const bb = boundsOf(polys), out = [];
  for (const o of obstacles) {
    if (o === self || (self && o.id != null && o.id === self.id)) continue;
    if (self && allowed(self, o)) continue;
    const clr = clearance(cat, o.cat, search);
    if (clr == null || !bboxHit(bb, o.bb, clr + 0.01)) continue;
    // hysteresis: detection tolerates 3 cm less than the search keeps (authored / rounded spots do not jitter)
    if (tooClose(polys, TALL_POINTS.has(cat) ? o.tall : o.polys, search ? clr : Math.max(0, clr - 0.03))) out.push(o);
  }
  return out;
}

/** Explicit join (`clipAllow` of either side names the other's id, type or category). */
export function allowed(a, b) {
  const names = (x) => [x.id, x.def?.type, x.cat].filter((v) => v != null).map(String);
  const la = a.def?.clipAllow || [], lb = b.def?.clipAllow || [];
  return la.some((v) => names(b).includes(String(v))) || lb.some((v) => names(a).includes(String(v)));
}

/**
 * Nearest free position for a point (ring search around its authored spot, seeded start angle).
 * @param {{x:number, z:number, polys:number[][][], cat:string, id?:string}} pt
 * @param {object[]} obstacles
 * @param {{isFree?: (x:number, z:number, cat:string) => boolean, maxMove?: number, seed?: number}} [o]
 * @returns {{x:number, z:number, moved:number}|null} null when no free spot within maxMove
 */
export function relocate(pt, obstacles, o = {}) {
  const step = RULES.step, maxMove = o.maxMove ?? RULES.maxMove, n = RULES.angles;
  const rnd = seeded(o.seed ?? hashStr(String(pt.id ?? `${pt.x},${pt.z}`)));
  const a0 = rnd() * 2 * Math.PI;
  const near = obstacles.filter((ob) => bboxHit(boundsOf(pt.polys), ob.bb, maxMove + 3));
  for (let ring = 1; ring * step <= maxMove + 1e-9; ring++) {
    const r = ring * step, m = Math.max(n, Math.ceil((2 * Math.PI * r) / step));
    for (let k = 0; k < m; k++) {
      const a = a0 + (2 * Math.PI * k) / m, dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      const x = pt.x + dx, z = pt.z + dz;
      if (o.isFree && !o.isFree(x, z, pt.cat, pt)) continue;
      if (!conflicts(shift(pt.polys, dx, dz), pt.cat, near, pt, true).length) return { x: +x.toFixed(3), z: +z.toFixed(3), moved: r };
    }
  }
  return null;
}

/** Obstacle record. */
export function obstacle(id, cat, polys, def = null, tall = null) {
  const t = tall || polys;
  return { id, cat, polys, tall: t, def, bb: boundsOf([...polys, ...t]) };
}
/** Point categories tall enough to meet eaves, bracing and branches: they test against the obstacles' tall shapes. */
export const TALL_POINTS = new Set(['tree', 'pole']);

/** Vehicle route corridors (half-width by vehicle type) as `route` obstacles. */
export const VEHICLE_HALF_WIDTH = { patrolboat: 1.8, boat: 1.8, raft: 1.2, truck: 1.4, car: 1.1, tank: 1.9, armoredCar: 1.4, halftrack: 1.4, motorbike: 0.7 };
export function routeObstacles(vehicles = []) {
  const out = [];
  for (const v of vehicles) {
    const pts = v.route?.points;
    if (!pts || pts.length < 2) continue;
    const hw = VEHICLE_HALF_WIDTH[v.vehicleType] ?? 1.5;
    out.push(obstacle(`${v.id}:route`, 'route', linePolys(pts.map(toXZ), hw), { type: 'route', id: v.id }));
  }
  return out;
}

/** Road / pavement terrain features as `road` obstacles (trees, rocks and poles keep off them). */
export function roadObstacles(terrain = []) {
  const out = [];
  for (const [k, t] of terrain.entries()) {
    if (!/^(road|pavement|sidewalk|rail)/.test(String(t.terrain))) continue;
    const polys = t.type === 'path' ? linePolys(t.points.map(toXZ), (t.width ?? 3) / 2)
      : t.type === 'rect' ? [rectPoly(t.x + t.w / 2, t.z + t.d / 2, t.w, t.d)]
        : t.type === 'poly' ? [t.points.map(toXZ)] : t.type === 'circle' ? [circlePoly(t.x, t.z, t.r)] : [];
    if (polys.length) out.push(obstacle(`terrain#${k}`, 'road', polys, { type: 'road' }));
  }
  return out;
}

const LINEAR_CATS = new Set(Object.keys(RUN_RANK));
const rankOf = (r) => RUN_RANK[r.cat] ?? 1;
const halfW = (r) => Math.max(0.05, (r.def.width ?? (r.cat === 'wall' ? 0.5 : r.cat === 'sandbags' ? 0.8 : 0.1)) / 2);
/** Top of a run's drawn body (palisade stakes stand up to ~5 % over `h`). */
const runTop = (r) => (r.def.h ?? 2) * 1.06 + 0.1;
/**
 * How far a run's drawn body overhangs its end points (art/dressing buildWall, props buildLinear): palisade stakes
 * are flush, fence posts 0.05 m, box walls / sandbags half their width.
 */
const endCap = (r) => (r.cat === 'wall' && /palisade|stockade|log/.test(String(r.def.variant ?? '')) ? 0 : r.cat === 'fence' ? 0.05 : halfW(r));
const polyLen = (r) => r.reduce((t, p, k) => (k ? t + Math.hypot(p[0] - r[k - 1][0], p[1] - r[k - 1][1]) : 0), 0);
const same = (p, q, e = 0.05) => Math.hypot(p[0] - q[0], p[1] - q[1]) < e;

/**
 * Rule (a) for towers: a watchtower standing on a linear run moves to the run's inner side, legs against the run
 * face (`onLine: 'gap'` → stays, the run is cut instead). Tries sliding along the run when the inner spot is taken.
 * @returns {{dx:number, dz:number}|null}
 */
export function attachTower(tower, run, lin, solids) {
  const hw = halfW(lin), hull = convexHull(tower.tall.flat());
  const hit = clipPolyline(run, [inflatePoly(hull, hw + RULES.towerGap + 0.35)], 0);
  if (hit.length === 1 && hit[0] === run) return null; // the run does not reach the tower (nor runs along its legs)
  const cx = tower.def.x ?? centroidOf(hull)[0], cz = tower.def.z ?? centroidOf(hull)[1];
  let best = null;
  for (let k = 0; k + 1 < run.length; k++) { const s = segDist(cx, cz, run[k], run[k + 1]); if (!best || s.d < best.d) best = { ...s, a: run[k], b: run[k + 1] }; }
  const L = Math.hypot(best.b[0] - best.a[0], best.b[1] - best.a[1]) || 1;
  const u = [(best.b[0] - best.a[0]) / L, (best.b[1] - best.a[1]) / L];
  let n = [-u[1], u[0]];
  const side = (px, pz) => (px - best.a[0]) * n[0] + (pz - best.a[1]) * n[1];
  let sgn = Math.sign(side(cx, cz));
  if (Math.abs(side(cx, cz)) < 0.1 || !sgn) { // centred on the line: the inner side = towards the run's centroid
    const all = runsOf(lin.def).flat(), c = centroidOf(all);
    sgn = Math.sign(side(c[0], c[1])) || 1;
  }
  n = [n[0] * sgn, n[1] * sgn];
  const minS = Math.min(...hull.map(([x, z]) => (x - best.a[0]) * n[0] + (z - best.a[1]) * n[1]));
  const off = hw + RULES.towerGap - minS;
  if (off <= 0.02) return { dx: 0, dz: 0 }; // already against the run: joined as is
  for (const slide of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]) {
    const dx = n[0] * off + u[0] * slide, dz = n[1] * off + u[1] * slide;
    const moved = [hull.map(([x, z]) => [x + dx, z + dz])];
    if (solids.some((s) => s !== tower && s !== lin && tooClose(moved, s.polys, s.linear ? 0.02 : 0.1))) continue;
    return { dx: +dx.toFixed(3), dz: +dz.toFixed(3) };
  }
  return null;
}

/** Chain runs of the same kind (type, variant, width, h) that share an end → [[rec, run], …] per rec. */
export function chainRuns(linears) {
  const items = [];
  for (const r of linears) for (const run of runsOf(r.def)) items.push({ r, run: run.map((p) => [...p]) });
  const key = (r) => [r.def.type, r.def.variant ?? '', r.def.width ?? '', r.def.h ?? ''].join('|');
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < items.length && !joined; i++) for (let j = 0; j < items.length && !joined; j++) {
      const A = items[i], Bi = items[j];
      if (i === j || A.r === Bi.r && A.r.def.segments || key(A.r) !== key(Bi.r) || A.r.k > Bi.r.k) continue;
      const a = A.run, b = Bi.run;
      if (same(a[0], a[a.length - 1]) || same(b[0], b[b.length - 1])) continue; // closed loops stay as they are
      let run = null;
      if (same(a[a.length - 1], b[0])) run = [...a, ...b.slice(1)];
      else if (same(a[a.length - 1], b[b.length - 1])) run = [...a, ...b.slice(0, -1).reverse()];
      else if (same(a[0], b[b.length - 1])) run = [...b, ...a.slice(1)];
      else if (same(a[0], b[0])) run = [...b.slice().reverse(), ...a.slice(1)];
      if (!run) continue;
      A.run = run; items.splice(j, 1); joined = true;
      A.chained = true;
    }
  }
  return items;
}

/** Plan shapes and categories of every structure (`shapeOf` = visual shapes, e.g. library sidecars). */
export function structureRecords(structures, shapeOf = null) {
  return structures.map((def, k) => {
    const cat = placeCat(def);
    const linear = isLinearDef(def) && (LINEAR_CATS.has(cat) || cat === 'fence' || cat === 'wall');
    const id = String(def.id ?? `${def.type}#${k}`);
    const ignored = def.clip === false || cat === 'ground';
    const data = ignored ? [] : dataShape(def, cat);
    const vis = (band) => (ignored || linear ? null : shapeOf?.(def, k, band)) || null;
    // body: what stands at wall height (0.3–1.8 m; no flat snow skirts / decals) — the shape that cuts runs
    const polys = vis('low') || data, tall = vis('tall') || polys, body = vis('body') || polys;
    // bodyTo(h): the body up to a tall run's top (h > 2.2: eaves / porch roofs over a 3 m palisade), visual only
    const bodyTo = shapeOf && !ignored && !linear ? (h) => (h > 2.2 ? vis(`body:${+h.toFixed(2)}`) : null) : null;
    return { k, def, id, cat, linear, ignored, polys, tall, body, bodyTo, bb: boundsOf(polys.length ? polys : [[[def.x ?? 0, def.z ?? 0]]]) };
  });
}

/**
 * Resolve a mission's placement (rules a–b). Never mutates the input; returns new defs.
 * @param {object[]} structures mission structures
 * @param {{shapeOf?: (def:object, k:number) => (number[][][]|null), isFree?: (x:number, z:number, cat:string) => boolean,
 *   vehicles?: object[], terrain?: object[], items?: object[], interactables?: object[], points?: boolean}} [o]
 *   points: move point props (default: only when `shapeOf` gives the visual shapes)
 * @returns {{structures: object[], items: object[], interactables: object[], moves: Map<string, {dx:number, dz:number}>,
 *   dropped: string[], log: string[], records: object[]}}
 */
export function resolvePlacement(structures = [], o = {}) {
  const log = [], moves = new Map(), dropped = [], gateRot = new Map(), attached = new Set();
  const recs = structureRecords(structures.map((d) => ({ ...d })), o.shapeOf);
  // gate-like interactables (pen gates, drawbridges, lifts…) are solids: runs are cut at them
  for (const [k, it] of (o.interactables || []).entries()) {
    const kind = String(it.interactKind ?? it.kind ?? '');
    if (!GATE_KIND.test(kind) || it.x == null) continue;
    const polys = it.rect ? [rectPoly(it.rect.x, it.rect.z, it.rect.w, it.rect.d, it.rect.rot ?? 0)] : [circlePoly(it.x, it.z, it.r ?? GATE_R)];
    recs.push({ k: -1 - k, def: { ...it, type: kind }, id: String(it.id ?? `${kind}#${k}`), cat: 'gate', linear: false, ignored: false, polys, tall: polys, body: polys, bb: boundsOf(polys), extra: true });
    // a gate leaf without its own heading lines up with the run it sits in (else it would cross the fence)
    if (it.rot == null && !it.rect) {
      let best = null;
      for (const r of recs) if (isLinearDef(r.def) && !r.extra) for (const run of runsOf(r.def)) for (let q = 0; q + 1 < run.length; q++) {
        const sd = segDist(it.x, it.z, run[q], run[q + 1]);
        if (sd.d < 1.0 && (!best || sd.d < best.d)) best = { d: sd.d, rot: Math.atan2(run[q + 1][1] - run[q][1], run[q + 1][0] - run[q][0]) };
      }
      if (best) { gateRot.set(k, +best.rot.toFixed(4)); log.push(`gate ${it.id ?? kind}: aligned with its run (${(best.rot * 180 / Math.PI).toFixed(0)}°)`); }
    }
  }
  const live = recs.filter((r) => !r.ignored);
  const linears = live.filter((r) => r.linear);
  const solids = live.filter((r) => !r.linear && !POINT_CATS.has(r.cat));
  // (a1) towers standing on a run
  for (const t of solids.filter((r) => r.cat === 'tower' && r.def.onLine !== 'gap' && !r.def.fixed)) {
    for (const lin of linears) {
      if (allowed(t, lin)) continue;
      for (const run of runsOf(lin.def)) {
        const mv = attachTower(t, run, lin, [...solids, ...linears.filter((l) => l !== lin)]);
        if (!mv) continue;
        attached.add(`${lin.id}|${t.id}`);
        if (!mv.dx && !mv.dz) continue;
        t.def.x = +((t.def.x ?? 0) + mv.dx).toFixed(3); t.def.z = +((t.def.z ?? 0) + mv.dz).toFixed(3);
        t.polys = shift(t.polys, mv.dx, mv.dz); t.tall = shift(t.tall, mv.dx, mv.dz); t.body = shift(t.body, mv.dx, mv.dz); t.bb = boundsOf(t.polys);
        t.mx = (t.mx ?? 0) + mv.dx; t.mz = (t.mz ?? 0) + mv.dz; // bodyTo() shapes come from the unmoved build
        const prev = moves.get(t.id) || { dx: 0, dz: 0 };
        moves.set(t.id, { dx: +(prev.dx + mv.dx).toFixed(3), dz: +(prev.dz + mv.dz).toFixed(3) });
        log.push(`tower ${t.id} on ${lin.id}: moved (${mv.dx}, ${mv.dz}) m, legs against the run`);
      }
    }
  }
  // (a2) visual runs: chained, then cut where they meet solids / higher-ranked runs (nav keeps the authored line)
  const chained = chainRuns(linears);
  for (const lin of linears) {
    const mine = chained.filter((c) => c.r === lin);
    const hw = halfW(lin);
    const cutters = [
      ...solids.filter((s) => RUN_SOLIDS.has(s.cat) && !allowed(lin, s) && !attached.has(`${lin.id}|${s.id}`)).map((s) => ({ id: s.id, polys: s.body, s })),
      ...linears.filter((m) => m !== lin && !allowed(lin, m) && (rankOf(m) > rankOf(lin) || (rankOf(m) === rankOf(lin) && m.k < lin.k)))
        .map((m) => ({ id: m.id, polys: chained.filter((c) => c.r === m).flatMap((c) => linePolys(c.run, halfW(m))) })),
    ].flatMap((c) => c.polys.map((p) => ({ id: c.id, s: c.s, raw: inflatePoly(p, RULES.linearGap), p: inflatePoly(p, hw + RULES.linearGap) })));
    for (const c of cutters) c.bb = boundsOf([c.p]);
    // what a cut must clear: the solid up to the run's own height (a 3 m palisade under a barracks' eaves), once it
    // is known to stand on the line (the body at 0.3–1.8 m decides that, so eaves over a wall beside it never cut)
    const runH = runTop(lin);
    const clearOf = (qs) => [...new Set(qs.map((q) => q.s ?? q))].flatMap((s) => {
      if (!s.def) return [s.raw];
      const up = s.bodyTo?.(runH);
      return up ? shift(up, s.mx ?? 0, s.mz ?? 0).map((p) => inflatePoly(p, RULES.linearGap)) : qs.filter((q) => q.s === s).map((q) => q.raw);
    });
    // only a shape that stands ON the line cuts it (its footprint reaches the run's centreline): a building or
    // sentry box beside the wall whose skirt / eaves merely touch the wall face leaves the run whole — cutting
    // there opened a see-through hole in M2's camp palisade while the nav line stayed blocked (user report)
    const onLine = (run, q) => { const r = clipPolyline(run, [q.raw], 0); return r.length !== 1 || r[0] !== run; };
    const runs = [], by = new Set();
    let changedWalk = false;
    let cut = false, before = 0, after = 0;
    for (const c of mine) {
      const rb = boundsOf([c.run]);
      const near = cutters.filter((q) => bboxHit(q.bb, rb, 0.01) && onLine(c.run, q));
      // the run's drawn body is swept over each segment (±hw across, ±its end overhang along): its ends stop
      // `linearGap` short of a solid's face — a palisade meets a gate filling its declared opening post-to-post
      const cap = endCap(lin), sweep = (qs) => { const raws = clearOf(qs); return (a, b) => raws.map((p) => sweepPoly(p, a, b, hw, cap)); };
      const parts = near.length ? clipPolyline(c.run, sweep(near), 0.3) : [c.run];
      if (parts.length !== 1 || parts[0] !== c.run) {
        cut = true;
        for (const q of near) { const r = clipPolyline(c.run, sweep([q]), 0); if (r.length !== 1 || r[0] !== c.run) by.add(q.id); }
      }
      before += polyLen(c.run); after += parts.reduce((t, r) => t + polyLen(r), 0);
      runs.push(...parts);
    }
    // wall walks: the visual deck is cut the same way (nav keeps the authored walkway)
    if (lin.def.walkways?.length) {
      const vw = [];
      for (const w of lin.def.walkways) {
        const pts = w.points.map(toXZ), m = (w.width ?? 1.2) / 2 + RULES.linearGap;
        const deckCut = solids.filter((q) => RUN_SOLIDS.has(q.cat) && !attached.has(`${lin.id}|${q.id}`)).flatMap((q) => q.polys).map((p) => inflatePoly(p, m));
        const parts = clipPolyline(pts, deckCut.filter((p) => bboxHit(boundsOf([p]), boundsOf([pts]), 0.01)), 0.5);
        if (parts.length !== 1 || parts[0] !== pts) { changedWalk = true; log.push(`walkway ${w.id ?? lin.id}: deck cut at solids (${parts.length} piece(s))`); }
        for (const run of parts) vw.push({ ...w, points: run });
      }
      if (changedWalk) lin.def.visualWalkways = vw;
    }
    const nOrig = runsOf(lin.def).length;
    if (cut || mine.length !== nOrig || mine.some((c) => c.chained)) {
      lin.def.visualRuns = runs;
      log.push(`run ${lin.id}: ${nOrig} → ${runs.length} visual run(s)${cut ? ` (cut ${(before - after).toFixed(1)} m at ${[...by].join(', ')})` : ''}${mine.some((c) => c.chained) ? ' (chained)' : ''}`);
    }
  }
  // (b) point props, then pickups/interactables: exclusion zones → relocate / drop
  const obstacles = [
    ...solids.map((s) => obstacle(s.id, s.cat, s.polys, s.def, s.tall)),
    ...linears.map((l) => obstacle(l.id, l.cat, l.polys, l.def)),
    ...routeObstacles(o.vehicles), ...roadObstacles(o.terrain),
    ...(o.vehicles || []).filter((v) => !v.route && v.x != null).map((v) => obstacle(String(v.id), 'vehicle', [rectPoly(v.x, v.z, v.vehicleType === 'mgNest' ? 1.4 : 6, v.vehicleType === 'mgNest' ? 1.4 : 2.6, v.heading ?? 0)], v)),
  ];
  const points = live.filter((r) => !r.linear && POINT_CATS.has(r.cat));
  for (const p of points.filter((q) => q.def.fixed)) obstacles.push(obstacle(p.id, p.cat, p.polys, p.def, p.tall));
  // point rules need the visual shapes (the data footprints of rocks / dressing are only approximations): without
  // them (grid-only unit tests) points are checked (log) but not moved, unless `o.points` forces it
  const doPoints = o.points ?? !!o.shapeOf;
  const place = (p, keep) => {
    const hit = conflicts(p.polys, p.cat, obstacles, p);
    if (hit.length && !doPoints) { log.push(`check ${p.cat} ${p.id}: near ${hit.slice(0, 3).map((h) => h.id).join(', ')} (data shapes; not moved)`); hit.length = 0; }
    if (hit.length) {
      const to = relocate({ ...p, x: p.def.x ?? 0, z: p.def.z ?? 0 }, obstacles, { isFree: o.isFree });
      const why = hit.slice(0, 3).map((h) => h.id).join(', ');
      if (to) {
        const dx = to.x - (p.def.x ?? 0), dz = to.z - (p.def.z ?? 0);
        p.def.x = to.x; p.def.z = to.z; p.polys = shift(p.polys, dx, dz); if (p.tall) p.tall = shift(p.tall, dx, dz);
        moves.set(p.id, { dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
        log.push(`${p.cat} ${p.id}: clear of ${why}, moved ${to.moved.toFixed(2)} m`);
      } else if (!keep) {
        p.def.placementDropped = true; dropped.push(p.id);
        log.push(`${p.cat} ${p.id}: no free spot near ${why} within ${RULES.maxMove} m, dropped`);
        return;
      } else log.push(`WARN ${p.cat} ${p.id}: overlaps ${why}, no free spot within ${RULES.maxMove} m (kept)`);
    }
    obstacles.push(obstacle(p.id, p.cat, p.polys, p.def, p.tall));
  };
  // scenery (unnamed trees / rocks / bushes) may be dropped; named or gameplay objects are always kept
  const keepOf = (d) => d.id != null || !['tree', 'rocks'].includes(placeCat(d));
  for (const p of points.filter((q) => !q.def.fixed)) place(p, keepOf(p.def));
  const extra = (list, kind) => (list || []).map((it, k) => {
    if (it.x == null || it.z == null || it.fixed || FIXED_INTERACTABLE(it)) return it;
    const d = { ...it };
    const rec = { k, def: d, id: String(it.id ?? `${kind}#${k}`), cat: 'item', polys: [circlePoly(it.x, it.z, it.r ?? 0.35)] };
    place(rec, true);
    return d;
  });
  const items = extra(o.items, 'item');
  const interactables = extra(o.interactables, 'interactable').map((it, k) => (gateRot.has(k) ? { ...it, rot: gateRot.get(k) } : it));
  for (const p of points.filter((q) => q.cat === 'tree' && !q.def.placementDropped)) {
    const hint = pruneTree(p.def, obstacles.filter((ob) => ob.id !== p.id));
    if (hint) { Object.assign(p.def, hint); log.push(`tree ${p.id}: crown ${hint.crownBase ? `lifted to ${hint.crownBase} m` : ''}${hint.crownR ? ` narrowed to ${hint.crownR} m` : ''}`); }
  }
  return { structures: recs.filter((r) => !r.extra).map((r) => r.def), items, interactables, moves, dropped, log, records: recs };
}

/**
 * Rule (c) spawns: a unit standing inside a solid / run / prop is moved to the nearest free spot; a unit posted on a
 * moved tower follows it. Vehicles' crews, garrisons and units inside things are left alone.
 * @param {object} spawn enemy / commando spawn def
 * @param {{moves: Map, records: object[]}|null} placement world.placement
 * @param {(x:number, z:number, spawn:object) => boolean} [isFree] e.g. walkable at the spawn's elevation
 * @returns {object} the spawn (a moved copy when it changed)
 */
export function placeSpawn(spawn, placement, isFree = null) {
  if (!placement || spawn.x == null || spawn.z == null) return spawn;
  let out = spawn;
  const mv = spawn.tower != null && placement.moves?.get(String(spawn.tower));
  if (mv) out = { ...spawn, x: +(spawn.x + mv.dx).toFixed(3), z: +(spawn.z + mv.dz).toFixed(3) };
  // elevated posts (wall walks, decks) are authored against their deck edges (perception deck-edge rule): the
  // mission places them; ground spawns are pushed out of solids here
  if (spawn.vehicle || spawn.emplacement || spawn.tower != null || spawn.inside || spawn.hidden || spawn.elevated || (spawn.y ?? 0) > 0.6) return out;
  const obs = (placement.records || []).filter((r) => !r.ignored && !r.def.placementDropped)
    .map((r) => obstacle(r.id, r.cat, r.polys, r.def));
  const me = { id: String(spawn.id ?? 'unit'), x: out.x, z: out.z, cat: 'unit', polys: [circlePoly(out.x, out.z, RULES.unitR, 10)] };
  if (!conflicts(me.polys, 'unit', obs).length) return out;
  const to = relocate(me, obs, { isFree: isFree ? (x, z) => isFree(x, z, out) : null, maxMove: 2.5 });
  if (!to) return out;
  placement.log?.push(`spawn ${me.id}: out of ${conflicts(me.polys, 'unit', obs).slice(0, 2).map((o) => o.id).join(', ')}, moved ${to.moved.toFixed(2)} m`);
  return { ...out, x: to.x, z: to.z };
}

/** Categories whose data footprints must not overlap or crowd each other (roof eaves cross within `gap`). */
export const FOOTPRINT_CATS = new Set(['building', 'tower', 'tent']);
/**
 * Rule (c) for mission data (missions/schema.js validateMission warns): building / tower / tent footprints that
 * overlap, or stand closer than `gap` m (default 2 × eaves: their roofs would cross), and buildings sunk into a
 * bridge / dam deck. An explicit `clipAllow` between the two silences it (a deliberate join).
 * @returns {{a:string, b:string, kind:'overlap'|'tight', gap:number}[]}
 */
export function footprintConflicts(structures = [], gap = 2 * RULES.eaves) {
  const recs = structureRecords(structures).filter((r) => !r.ignored && !r.linear && (FOOTPRINT_CATS.has(r.cat) || r.cat === 'bridge'));
  const out = [];
  for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++) {
    const A = recs[i], Bj = recs[j];
    const bridge = A.cat === 'bridge' || Bj.cat === 'bridge';
    if ((A.cat === 'bridge' && Bj.cat === 'bridge') || allowed(A, Bj)) continue;
    if (!bboxHit(A.bb, Bj.bb, gap)) continue;
    const pa = A.polys[0], pb = Bj.polys[0];
    if (polysOverlap(pa, pb)) { out.push({ a: A.id, b: Bj.id, kind: 'overlap', gap: 0 }); continue; }
    const roofed = (r) => FOOTPRINT_CATS.has(categoryOf(r.def.type, r.def));
    if (bridge || !roofed(A) || !roofed(Bj)) continue;
    let d = Infinity;
    for (const [x, z] of pa) d = Math.min(d, polyDist(x, z, pb));
    for (const [x, z] of pb) d = Math.min(d, polyDist(x, z, pa));
    if (d < gap - 1e-6) out.push({ a: A.id, b: Bj.id, kind: 'tight', gap: +d.toFixed(2) });
  }
  return out;
}

/**
 * Closed-enclosure check (user report "Level 2 the fence is not fully closed"): every authored run of every wall /
 * fence / wire line must be DRAWN (its visual runs, pooled over chained runs) except where a solid or another run
 * actually stands on it — its body shape (browser: fitted to the mesh, no diagonal cell padding) reaches the run's
 * centreline and the uncovered stretch lies within that shape's cut reach (+ `linearGap`, swept ±half-width across
 * the run and ±its end overhang along it — so a gate in line with a palisade explains no slot beside its posts).
 * Declared openings are gaps between authored runs, so they never count. Nav always blocks the authored line, so an unexplained stretch is a see-through hole that still blocks.
 * @param {object[]} records `resolvePlacement(...).records` (browser: visual body shapes; node: data shapes)
 * @param {{step?: number, tol?: number, minLen?: number}} [o]
 * @returns {{id: string, from: number[], to: number[], len: number}[]} unexplained gaps (≥ `minLen` m)
 */
export function enclosureGaps(records, o = {}) {
  const step = o.step ?? 0.1, tol = o.tol ?? 0.03, minLen = o.minLen ?? 0.15;
  const live = records.filter((r) => !r.ignored);
  const linears = live.filter((r) => r.linear);
  const drawn = linears.flatMap((r) => r.def.visualRuns || runsOf(r.def));
  const shapes = [
    ...live.filter((r) => !r.linear && RUN_SOLIDS.has(r.cat)).map((r) => ({ id: r.id, rec: r, polys: r.body || r.polys })),
    ...linears.map((m) => ({ id: m.id, lin: m, polys: runsOf(m.def).flatMap((r) => linePolys(r, halfW(m))) })),
  ];
  const gaps = [];
  for (const lin of linears) {
    const hw = halfW(lin), cap = endCap(lin);
    for (const run of runsOf(lin.def)) {
      const occ = []; // shapes standing on the run, at the cut's own reach (swept ±hw across, ±cap along)
      for (const sh of shapes) {
        if (sh.lin === lin) continue;
        const on = sh.polys.map((p) => inflatePoly(p, RULES.linearGap + tol)).filter((raw) => { const hit = clipPolyline(run, [raw], 0); return hit.length !== 1 || hit[0] !== run; });
        if (!on.length) continue;
        // a solid standing on the run is cleared up to the run's height (as the cut does: eaves over a palisade)
        const up = sh.rec?.bodyTo?.(runTop(lin));
        occ.push(...(up ? shift(up, sh.rec.mx ?? 0, sh.rec.mz ?? 0).map((p) => inflatePoly(p, RULES.linearGap + tol)) : on));
      }
      let open = null;
      const close = () => { if (open && open.len >= minLen) gaps.push({ id: lin.id, from: open.from, to: open.to, len: +open.len.toFixed(2) }); open = null; };
      for (let k = 0; k + 1 < run.length; k++) {
        const [ax, az] = run[k], [bx, bz] = run[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
        const reach = occ.map((p) => sweepPoly(p, run[k], run[k + 1], hw, cap));
        for (let i = k ? 1 : 0; i <= n; i++) {
          const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
          const ok = drawn.some((r) => lineDist(x, z, r) <= tol) || reach.some((p) => inPoly(x, z, p));
          if (ok) { close(); continue; }
          const pt = [+x.toFixed(2), +z.toFixed(2)];
          if (!open) open = { from: pt, to: pt, len: 0 };
          else { open.len += Math.hypot(x - open.to[0], z - open.to[1]); open.to = pt; }
        }
      }
      close();
    }
  }
  return gaps;
}

/**
 * Rule (e) bodies: a unit dying next to a wall / building would lie half inside it. Returns the nearest spot
 * (≤ `maxMove` m, same surface height) where a disc of radius `r` (the lying body) touches no structure cell
 * (grid block or navBlock), or null when the body is already clear (or nothing better is found).
 * @param {import('./grid.js').NavGrid} grid
 */
export function settleBody(grid, x, z, r = 1.0, maxMove = 1.2) {
  if (!grid?.block) return null;
  const c = grid.cell, y0 = grid.elevAt ? grid.elevAt(x, z) : 0;
  const solid = (px, pz) => {
    const i = Math.floor(px / c), j = Math.floor(pz / c);
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return false;
    const k = j * grid.cols + i;
    return grid.block[k] !== 0 || !!(grid.navBlock && grid.navBlock[k]);
  };
  const clear = (px, pz) => {
    if (solid(px, pz)) return false;
    for (let a = 0; a < 16; a++) {
      const ca = Math.cos((a * Math.PI) / 8), sa = Math.sin((a * Math.PI) / 8);
      for (const rr of [r * 0.5, r]) if (solid(px + ca * rr, pz + sa * rr)) return false;
    }
    return true;
  };
  if (clear(x, z)) return null;
  for (let d = 0.1; d <= maxMove + 1e-9; d += 0.1) for (let a = 0; a < 24; a++) {
    const px = x + Math.cos((a * Math.PI) / 12) * d, pz = z + Math.sin((a * Math.PI) / 12) * d;
    if (grid.elevAt && Math.abs(grid.elevAt(px, pz) - y0) > 0.1) continue;
    if (grid.isWalkable && !grid.isWalkable(Math.floor(px / c), Math.floor(pz / c), { swim: true })) continue;
    if (clear(px, pz)) return { x: +px.toFixed(3), z: +pz.toFixed(3), moved: +d.toFixed(2) };
  }
  return null;
}

/**
 * Rule (e) bodies vs standing visuals (grid.solidAt: stakes along a wall walk, railings, crates — finer than the
 * nav grid): the lying body (a `len` m line along heading `h` — both ways, or `likely` 1 forward / -1 backward —
 * `halfW` m to each side) must not cross
 * them. Returns the nearest shift (≤ `maxMove` m, same surface height, walkable) that clears it, or null when it
 * is already clear or nothing better is found.
 * @param {import('./grid.js').NavGrid} grid
 */
export function settleSolid(grid, x, z, h, o = {}) {
  if (!grid?.solidAt || !grid.solid) return null;
  const len = o.len ?? 1.5, halfW = o.halfW ?? 0.4, maxMove = o.maxMove ?? 0.6, c = grid.cell;
  const ca = Math.cos(h), sa = Math.sin(h), y0 = grid.elevAt ? grid.elevAt(x, z) : 0;
  // the body's extent along the heading: both ways, or mostly the `likely` one (legs reach 0.5 m the other way)
  const u0 = o.likely > 0 ? -0.5 : -len, u1 = o.likely < 0 ? 0.5 : len;
  const hits = (px, pz) => {
    let n = 0;
    for (let u = u0; u <= u1 + 1e-9; u += 0.125) for (let v = -halfW; v <= halfW + 1e-9; v += halfW / 3) {
      if (grid.solidAt(px + ca * u - sa * v, pz + sa * u + ca * v)) n++;
    }
    return n;
  };
  const n0 = hits(x, z);
  if (!n0) return null;
  let best = null, bn = n0;
  for (let d = 0.1; d <= maxMove + 1e-9; d += 0.1) {
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a * Math.PI) / 8) * d, pz = z + Math.sin((a * Math.PI) / 8) * d;
      if (grid.elevAt && Math.abs(grid.elevAt(px, pz) - y0) > 0.1) continue;
      if (grid.isWalkable && !grid.isWalkable(Math.floor(px / c), Math.floor(pz / c), { swim: true })) continue;
      const n = hits(px, pz);
      if (n < bn) { bn = n; best = { x: +px.toFixed(3), z: +pz.toFixed(3), moved: +d.toFixed(2), left: n }; }
    }
    if (best && best.left === 0) return best;
  }
  return best;
}

/**
 * Rule (d) turrets / emplacement guns: for every traverse angle (world, `step`°) the barrel elevation (rad) needed
 * to pass over the static obstacles within its reach, or Infinity when even `maxLift` does not clear them (that
 * arc is closed: the gun never swings its barrel through a wall, fence or building).
 * @param {import('./grid.js').NavGrid} grid
 * @param {number} x @param {number} z pivot (world)
 * @param {{len:number, h:number, heightOf?: (k:number) => (number|null), step?: number, maxLift?: number,
 *   skip?: (k:number) => boolean, r0?: number, y0?: number}} o len = barrel reach from the pivot (m), h = barrel
 *   height (m above the ground under the pivot, y0 world). Open cells under eaves / porch roofs / boughs
 *   (grid.overLo, softLo) that come down to the barrel or turret roof (h + 0.3) close the angle;
 *   `housing` {hl, hw, top}: the turret box, whose angle closes when an overhang comes down below its roof.
 * @returns {Float32Array}
 */
export function turretArc(grid, x, z, o) {
  const step = o.step ?? 5, n = Math.round(360 / step), out = new Float32Array(n), maxLift = o.maxLift ?? (25 * Math.PI) / 180;
  const c = grid.cell, DEFAULT_H = { 1: 1.0, 2: 2.5, 3: 2.0 }, y0 = o.y0 ?? 0; // y0: ground (world y) under the pivot
  for (let a = 0; a < n; a++) {
    const ang = (a * step * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    let lift = 0;
    // along the barrel and 0.2 m either side of it: a diagonal wall's cell staircase leaves corner gaps a single
    // line of samples slips through
    for (let d = o.r0 ?? 0.35, q = 0; d <= o.len + 0.15 + 1e-9; q = (q + 1) % 3, d += q === 0 ? 0.15 : 0) {
      const lat = (q - 1) * 0.2, i = Math.floor((x + ca * d - sa * lat) / c), j = Math.floor((z + sa * d + ca * lat) / c);
      if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
      const k = j * grid.cols + i;
      if (o.skip?.(k)) continue;
      let top = -Infinity;
      if (grid.block[k]) {
        top = o.heightOf?.(k) ?? DEFAULT_H[grid.block[k]] ?? 2;
        if (grid.blockTop?.[k] > 0 && grid.blockTop[k] - y0 > top) top = grid.blockTop[k] - y0; // measured visual
      }
      else if (grid.navBlock?.[k]) top = o.heightOf?.(k) ?? 1.5;
      // eaves / porch roofs / low boughs over open ground coming down to the barrel or turret roof: that angle is
      // closed (a roof rises inward, lifting over its edge would drive the barrel through the slope behind it)
      if (grid.overLo && Math.min(grid.overLo[k], grid.softLo[k]) - y0 < o.h + 0.3) { lift = Infinity; break; }
      if (grid.elev?.[k] > top) top = grid.elev[k];
      if (top > o.h - 0.05) lift = Math.max(lift, Math.atan2(top + 0.12 - o.h, d));
    }
    // the turret housing turned to this angle (half length hl along it, hw across) under an overhang lower than
    // its roof: that angle is closed (the housing cannot lift)
    const H = o.housing;
    if (H && grid.overLo && lift <= maxLift) {
      for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, 0, 1]) {
        const px = x + ca * u * H.hl - sa * v * H.hw, pz = z + sa * u * H.hl + ca * v * H.hw;
        const i = Math.floor(px / c), j = Math.floor(pz / c);
        if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
        const kk = j * grid.cols + i;
        if (Math.min(grid.overLo[kk], grid.softLo[kk]) - y0 < H.top + 0.05) { lift = Infinity; break; }
      }
    }
    out[a] = lift > maxLift ? Infinity : lift;
  }
  return out;
}

/** Nearest open traverse angle to `h` (rad) on an arc from turretArc (h itself when open or when all is closed). */
export function clampTraverse(arc, h, step = 5) {
  const n = arc.length, st = (step * Math.PI) / 180;
  const norm = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), i0 = Math.round(norm / st) % n;
  if (arc[i0] !== Infinity) return h;
  for (let k = 1; k <= n / 2; k++) for (const s of [1, -1]) {
    const i = (i0 + s * k + n) % n;
    if (arc[i] !== Infinity) return h + s * k * st - (norm - i0 * st);
  }
  return h;
}

/** Barrel lift (rad) for world heading `h` on an arc (0 when open ground, Infinity when closed). */
export function liftAt(arc, h, step = 5) {
  const st = (step * Math.PI) / 180, norm = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return arc[Math.round(norm / st) % arc.length];
}

/**
 * Obstacle top height by grid cell (turretArc heightOf): the structure owning the cell (def.h, else OBSTACLE_H by
 * category), cached per world. Owners come from map-builder (STRUCTURE_OWNER_BASE + index in world.structures).
 */
export function ownerHeight(world) {
  if (world._ownerH && world._ownerH.src === world.structures) return world._ownerH.fn;
  const byOwner = new Map();
  for (const s of world.structures?.values?.() || []) {
    if (s.owner == null) continue;
    const cat = placeCat({ type: s.type, ...s.def });
    byOwner.set(s.owner, s.def?.h ?? OBSTACLE_H[cat] ?? 2);
  }
  const fn = (k) => { const o = world.grid?.owner?.[k]; return o ? byOwner.get(o) ?? null : null; };
  world._ownerH = { src: world.structures, fn };
  return fn;
}

/**
 * Rule (e) bodies: a dying unit drops along its heading line (~1.6 m, forward or backward). When that line meets a
 * wall / building / a deck edge (elevation drop), the corpse turns to the nearest free direction (sideways, diagonals).
 * @returns {number} the heading to fall along (the input when it is already clear or nothing is free)
 */
export function fallHeading(grid, x, z, h, len = 1.6, likely = 0) {
  if (!grid?.block) return h;
  const c = grid.cell, y0 = grid.elevAt ? grid.elevAt(x, z) : 0;
  const bad = (px, pz) => {
    const i = Math.floor(px / c), j = Math.floor(pz / c);
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return true;
    const k = j * grid.cols + i;
    return grid.block[k] !== 0 || !!(grid.navBlock && grid.navBlock[k]) || !!grid.solidAt?.(px, pz) || Math.abs((grid.elev ? grid.elev[k] : 0) - y0) > 0.3;
  };
  // the fall line both ways through the unit's spot (the death clips drop the body forward or backward)
  const clear = (a) => {
    const ca = Math.cos(a), sa = Math.sin(a), px = -sa * 0.25, pz = ca * 0.25;
    for (let d = 0.3; d <= len + 1e-9; d += 0.25) for (const f of [1, -1]) for (const s of [-1, 0, 1]) if (bad(x + f * ca * d + px * s, z + f * sa * d + pz * s)) return false;
    return true;
  };
  for (const off of [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
    if (clear(h + off)) return h + off;
  }
  // nowhere fully free (a narrow wall walk, a deck, a corner): the line that stays clear longest, both ways —
  // a wall / building in the way costs 3× a deck edge (a corpse may hang over a drop, never through stakes);
  // `likely` (1 forward: a running fall, -1 backward: the standing death clip) weighs the other way at 0.35
  const solid = (px, pz) => {
    const i = Math.floor(px / c), j = Math.floor(pz / c);
    if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return true;
    const k = j * grid.cols + i;
    return grid.block[k] !== 0 || !!(grid.navBlock && grid.navBlock[k]) || !!grid.solidAt?.(px, pz);
  };
  const cost = (a) => {
    const ca = Math.cos(a), sa = Math.sin(a), px = -sa * 0.25, pz = ca * 0.25;
    let sum = 0;
    for (const f of [1, -1]) for (const s of [-1, 0, 1]) {
      const wf = !likely || f === likely ? 1 : 0.35;
      for (let d = 0.3; d <= len + 1e-9; d += 0.1) {
        const qx = x + f * ca * d + px * s, qz = z + f * sa * d + pz * s;
        if (!bad(qx, qz)) continue;
        sum += (len + 0.1 - d) * (solid(qx, qz) ? 3 : 1) * (s === 0 ? 1.5 : 1) * wf;
        break;
      }
    }
    return sum;
  };
  let best = h, bc = cost(h);
  for (let k = 1; k < 32; k++) {
    const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 16);
    const cc = cost(h + off);
    if (cc < bc - 1e-6) { bc = cc; best = h + off; }
  }
  return best;
}
