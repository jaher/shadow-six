/**
 * Rail clearance analyzer (pure; Node tests and tools/layout/rail-report.mjs; user 2026-10-28: "Make sure no buildings
 * are on top of rails"). For every drawn rail line of a mission — `rail_track` structures (the Catmull-Rom centre line
 * art/kit-terrain.js buildRailTrack draws), `tram_track` runs, roads carrying embedded `rails` (world/roads.js), the
 * tracks trains / trams / mine carts run on (vehicle `track`) and pushable wagons' `rail` — a corridor around its
 * centre line:
 *   static   — the drawn track: ballast half-width (sleepers 2.5 m, bed max(2.6, width + 0.6)) + CLEAR.static;
 *   running  — a track a vehicle runs on: the moving hull's half-width (vehicle def size[1] / 2) + CLEAR.running,
 *              never less than the static corridor of the track drawn under it;
 * and every building / structure gameplay footprint (the grid-only build's footprints: library navParts, rings,
 * polygons, w × d rects, lines with their width) must stay out of it. Natural features (trees, rocks, cliffs) only
 * keep off the sleepers (CLEAR.natural past the sleeper ends): a cutting or a wood may come close to the line.
 * Things that stand on rails by design never count: rolling stock (`train_car`, the railway gun), the bridges that
 * carry the line, buffer stops, and any structure tagged `onRails: '<reason>'` (a slipway cradle, a mine adit portal).
 * A tag can also be narrow: `onRails: { <rail id>: '<reason>' }` lets a wall, fence or wire run OVER that one drawn
 * track (once, at 45° or more — `crossingOnly`), and nothing else: not another rail, not a line a vehicle runs on, not a
 * tram line, not a building (M4's barbed wire over the dead siding_a). The allowed crossings come back as `allowed`.
 * @module missions/rail-clearance
 */
import * as THREE from 'three';
import { normalizeRoadNetwork, sampleCenterline } from '../world/roads.js';
import { extendEnds } from '../art/props-extra.js';

/** Clearances (m) beyond the drawn bed / the moving hull. */
export const CLEAR = Object.freeze({ static: 0.3, running: 0.5, natural: 0.25 });
/** Sleeper half-length (m, buildRailTrack: 2.5 m sleepers). */
export const SLEEPER_HALF = 1.25;
/** Ballast half-width of a drawn rail_track of `width` (buildRailTrack: bw = max(2.6, width + 0.6)). */
export const bedHalf = (width = 2.4) => Math.max(2.6, width + 0.6) / 2;

/** Structure types that are the rails themselves, ground layers or rolling stock / rail-borne by design. */
const RAIL_TYPES = new Set(['rail_track', 'tram_track', 'rail_line']);
const SKIP_TYPES = new Set(['road', 'river', 'path', 'pavement', 'sea', 'lake', 'current', 'crater', 'minefield', 'shore',
  'train_car', 'railway_gun', 'rail_bridge']);
/** Variants that belong on the rails (buffer stops end a track; a hand trolley is rolling stock). */
const ON_RAIL_VARIANT = /buffer|handcar|hand_trolley/;
/** A parked prop drawn as rolling stock (`vehicleArt`: a hand trolley, a mine tub, a wagon, a locomotive). */
const ROLLING_ART = /handcar|mine_cart|mine_tipper|wagon|loco|tender|coach|railgun|tram/;
/** Natural features: kept off the sleepers only. */
const NATURAL_TYPES = new Set(['tree', 'pine', 'palm', 'bush', 'shrub', 'rocks', 'rock', 'boulder', 'cliff', 'hedge']);

const pt = (p) => (Array.isArray(p) ? [+p[0], +p[1]] : [+p.x, +p.z]);

/** The drawn centre line of a rail_track run (buildRailTrack: centripetal Catmull-Rom + 0.38 m welded ends). */
export function trackCentreline(points, step = 0.25) {
  const cp = [];
  for (const q of points.map(pt)) if (!cp.length || Math.hypot(q[0] - cp[cp.length - 1][0], q[1] - cp[cp.length - 1][1]) > 1e-6) cp.push(q);
  if (cp.length < 2) return cp;
  const c = new THREE.CatmullRomCurve3(cp.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const L = c.getLength();
  const P = c.getSpacedPoints(Math.max(16, Math.ceil(L / step))).map((v) => [v.x, v.z]);
  const ext = (a, b) => { const dx = a[0] - b[0], dz = a[1] - b[1], m = Math.hypot(dx, dz) || 1; return [a[0] + dx / m * 0.38, a[1] + dz / m * 0.38]; };
  return [ext(P[0], P[1]), ...P, ext(P[P.length - 1], P[P.length - 2])];
}

/**
 * Rail lines of a mission def: {id, kind:'track'|'tram'|'road'|'run'|'pushable', vehicle?, half, sleeper, line}.
 * `half` = the corridor half-width obstacles keep out of; `sleeper` = the half-width natural features keep out of.
 * @param {object} def mission def (normalized or raw) @param {{vehicleSize?:(type:string)=>number[]|null}} [o]
 */
export function railLines(def, o = {}) {
  const out = [];
  const drawn = [];
  (def.structures || []).forEach((s, i) => {
    if (!s || (s.type !== 'rail_track' && s.type !== 'tram_track')) return;
    const id = s.id ?? `${s.type}#${i}`;
    for (const run of Array.isArray(s.segments) ? s.segments : Array.isArray(s.points) ? [s.points] : []) {
      if (run.length < 2) continue;
      if (s.type === 'rail_track') {
        const half = bedHalf(s.width ?? 2.4);
        const r = { id, kind: 'track', half: half + CLEAR.static, sleeper: SLEEPER_HALF + CLEAR.natural, line: trackCentreline(run) };
        out.push(r); drawn.push(r);
      } else {
        const half = (s.width ?? 2.2) / 2; // grooved rails flush in the setts, granite edging (art/props-extra.js)
        const r = { id, kind: 'tram', half: half + CLEAR.static, sleeper: 0.72 + 0.2 + CLEAR.natural, line: extendEnds(run.map(pt), s.drawEnds) };
        out.push(r); drawn.push(r);
      }
    }
  });
  for (const r of normalizeRoadNetwork(def).roads) {
    if (!r.rails) continue;
    const S = sampleCenterline(r.points, 0.25, !!r.spline).map((q) => [q.x, q.z]);
    // embedded dock / tram rails: a wagon (≈ 3 m wide) may stand anywhere on them
    out.push({ id: r.id, kind: 'road', half: 1.5 + CLEAR.static, sleeper: r.rails.gauge / 2 + 0.2 + CLEAR.natural, line: S });
  }
  for (const v of def.vehicles || []) {
    if (!Array.isArray(v.track) || v.track.length < 2 || v.vehicleType === 'cable_car') continue;
    const size = o.vehicleSize?.(v.vehicleType) || null;
    const hull = size ? size[1] / 2 : 1.7;
    // (its body reaches half its length past the track's ends, where it stops / turns back)
    const line = extendEnds(v.track.map(pt), [size ? size[0] / 2 : 5, size ? size[0] / 2 : 5]);
    // never less than the track drawn under it (the nearest drawn line within 2 m of the run's middle)
    out.push({ id: v.id ?? v.vehicleType, kind: 'run', vehicle: v.vehicleType, half: hull + CLEAR.running, sleeper: SLEEPER_HALF + CLEAR.natural, line });
  }
  for (const it of def.interactables || []) {
    if (!Array.isArray(it?.rail) || it.rail.length < 2) continue;
    out.push({ id: it.id ?? 'pushable', kind: 'pushable', half: 1.5 + CLEAR.static, sleeper: SLEEPER_HALF + CLEAR.natural, line: it.rail.map(pt) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ geometry

const segDist = (px, pz, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
};
function inPoly(x, z, P) {
  let o = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) o = !o;
  }
  return o;
}
function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** Closest distance between segment ab and cd (0 when they cross). */
function segSegDist(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(segDist(a[0], a[1], c, d), segDist(b[0], b[1], c, d), segDist(c[0], c[1], a, b), segDist(d[0], d[1], a, b));
}

/** The polyline with points at most `step` m apart (straight runs: a bridge cut needs points along them). */
function densify(line, step) {
  const out = [line[0]];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j <= n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}

/** A footprint as a closed polygon ([[x, z]…]) or an open polyline with a half-width: {poly} | {line, hw}. */
export function footprintShape(f) {
  if (!f) return null;
  if (f.shape === 'rect') {
    const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), hw = f.w / 2, hd = f.d / 2;
    return { poly: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [f.x + u * c - v * s, f.z + u * s + v * c]) };
  }
  if (f.shape === 'circle') {
    const P = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * Math.PI; P.push([f.x + Math.cos(a) * f.r, f.z + Math.sin(a) * f.r]); }
    return { poly: P };
  }
  if (f.shape === 'poly' && f.points?.length >= 3) return { poly: f.points.map(pt) };
  if (f.shape === 'line' && f.points?.length >= 2) return { line: f.points.map(pt), hw: (f.width ?? 0.5) / 2 };
  return null;
}

/** The drawn plan of a structure def without a blocking footprint: w × d at rot, a radius, an area polygon, a run. */
function defShape(s) {
  if (!s) return null;
  if (Array.isArray(s.points) && s.points.length >= 2) {
    return s.points.length >= 3 && s.x == null && !s.width ? { poly: s.points.map(pt) } : { line: s.points.map(pt), hw: (s.width ?? 0.5) / 2 };
  }
  if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) return null;
  if (s.w > 0 && s.d > 0) return footprintShape({ shape: 'rect', x: s.x, z: s.z, w: s.w, d: s.d, rot: s.rot ?? 0 });
  if (s.r > 0) return footprintShape({ shape: 'circle', x: s.x, z: s.z, r: s.r });
  return null;
}

/** Smallest distance (m) from a footprint shape to a rail centre line (0 when the line runs into / under it). */
export function shapeLineDist(sh, line) {
  let d = Infinity;
  if (sh.poly) {
    const P = sh.poly;
    for (const q of line) if (inPoly(q[0], q[1], P)) return 0;
    for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      for (let j = 0; j + 1 < line.length; j++) d = Math.min(d, segSegDist(a, b, line[j], line[j + 1]));
    }
    return d;
  }
  const L = sh.line;
  for (let k = 0; k + 1 < L.length; k++) for (let j = 0; j + 1 < line.length; j++) d = Math.min(d, segSegDist(L[k], L[k + 1], line[j], line[j + 1]));
  return Math.max(0, d - sh.hw);
}

// ------------------------------------------------------------------------------------------------ analysis

/** Is a structure exempt (stands on the rails by design)? @returns {string|null} the reason */
export function onRailsReason(s) {
  if (!s) return 'none';
  if (s.onRails && typeof s.onRails !== 'object') return String(s.onRails);   // (an object tag is per rail: railAllowance)
  if (RAIL_TYPES.has(s.type)) return 'rail';
  if (SKIP_TYPES.has(s.type)) return s.type === 'train_car' || s.type === 'railway_gun' ? 'rolling stock' : s.type === 'rail_bridge' ? 'carries the line' : 'ground';
  if (typeof s.variant === 'string' && ON_RAIL_VARIANT.test(s.variant)) return 'belongs on the track';
  if (typeof s.vehicleArt === 'string' && ROLLING_ART.test(s.vehicleArt)) return 'rolling stock';
  return null;
}

/**
 * Does the wall / fence / wire `s` (`points` or `segments`) cross the rail line `r` in one clean pass: one visit to its
 * corridor, entering on one side of the centre line and leaving on the other, the way through no longer than a 45°
 * crossing's (so not along the track, not a post in it, not a run that ends on it)? Pure; the line is sampled 0.1 m.
 */
export function crossingOnly(s, r) {
  const runs = Array.isArray(s?.segments) ? s.segments : Array.isArray(s?.points) ? [s.points] : [];
  if (!runs.length || !r.line?.length) return false;
  const near = (q) => {   // the nearest centre-line segment: distance and which side of it q lies
    let best = { d: Infinity, side: 0 };
    for (let k = 0; k + 1 < r.line.length; k++) {
      const a = r.line[k], b = r.line[k + 1], d = segDist(q[0], q[1], a, b);
      if (d < best.d) best = { d, side: Math.sign((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) };
    }
    return best;
  };
  const step = 0.1, hw = (s.width ?? 0.5) / 2, maxLen = 2 * (r.half + hw) * Math.SQRT2 + step;
  let visits = 0;
  for (const run of runs) {
    let entry = null, last = null, len = 0;
    const close = () => { if (!entry || !last || entry.side * last.side >= 0 || len > maxLen) return false; entry = null; len = 0; return true; };
    for (const q of densify(run.map(pt), step)) {
      const n = near(q);
      if (n.d < r.half) { if (!entry) { entry = n; visits++; } last = n; len += step; } else if (entry && !close()) return false;
    }
    if (entry && !close()) return false;   // the run ends inside the corridor
  }
  return visits === 1;
}

/**
 * The reason a structure may run over the rail line `r` (its `onRails: { <rail id>: '<reason>' }`), or null. Only for a
 * drawn rail_track (kind 'track': never a line a vehicle runs on — that is its own line —, a tram line, a road's rails
 * or a pushable's), and only for a wall / fence / wire that crosses it once (crossingOnly). Pure.
 */
export function railAllowance(s, r) {
  const t = s?.onRails;
  if (!t || typeof t !== 'object' || r.kind !== 'track' || typeof t[r.id] !== 'string' || !t[r.id]) return null;
  return crossingOnly(s, r) ? t[r.id] : null;
}

/**
 * A model-space plan polygon of a library visual (art/building-props.js libraryVisual: its sidecar footprints and roof
 * outlines — walls, eaves, porches, a pier's T head) placed as the game draws it: centred on the model's body
 * (`ext.cx / cz`), quarter-turned (`turn`), scaled by the footprint fit (`sx`, `sz`), at the structure (x, z +
 * artOffset, rot + artRot). @param {number[][]} pts [[x, z]…] model space @returns {{poly:number[][]}}
 */
export function drawnPoly(s, pts, ext, turn, sx, sz) {
  const rot = (s.rot ?? 0) + (s.artRot ?? 0), c = Math.cos(rot), sn = Math.sin(rot);
  const tc = Math.cos(turn * Math.PI / 2), ts = Math.sin(turn * Math.PI / 2);
  const x0 = (s.x ?? 0) + (s.artOffset?.[0] ?? 0), z0 = (s.z ?? 0) + (s.artOffset?.[1] ?? 0);
  return { poly: pts.map(([mx, mz]) => {
    const u0 = mx - ext.cx, v0 = mz - ext.cz, u = (u0 * tc - v0 * ts) * sx, v = (u0 * ts + v0 * tc) * sz;
    return [x0 + u * c - v * sn, z0 + u * sn + v * c];
  }) };
}

/**
 * Every building / structure / natural footprint within its rail corridor.
 * @param {object} def mission def (normalized)
 * @param {Map<string, {type:string, def:object, footprints:object[]}>} structures grid-only build (map-builder handle.structures)
 * @param {{vehicleSize?:Function, near?:number, drawn?:Map<string, {poly:number[][]}[]>}} [o] near: also list items up to this
 *   far past the corridor (report); drawn: the drawn plans of library visuals (drawnPlan) by structure id
 * @returns {{rails: object[], hits: {id:string, type:string, variant:string, rail:string, kind:string, natural:boolean, dist:number, need:number, overlap:number}[],
 *   allowed: object[]}} allowed: the same rows (+ `why`) for what an `onRails: { <rail id>: … }` tag lets run over its one track
 */
export function railClearance(def, structures, o = {}) {
  const rails = railLines(def, o);
  const hits = [], allowed = [];
  if (!rails.length) return { rails, hits, allowed };
  // a line over a rail bridge runs on its deck, above whatever stands below it (rock rims, the gorge, its piers)
  const decks = (def.structures || []).filter((s) => s?.type === 'rail_bridge' && Number.isFinite(s.x) && s.w > 0 && s.d > 0)
    .map((s) => footprintShape({ shape: 'rect', x: s.x, z: s.z, w: s.w + 1, d: s.d + 1, rot: s.rot ?? 0 }).poly);
  const pieces = (line) => {
    if (!decks.length) return [line];
    const out = [];
    let cur = [];
    for (const q of line) {
      if (decks.some((P) => inPoly(q[0], q[1], P))) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(q);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  const runs = rails.map((r) => ({ r, parts: pieces(densify(r.line, 0.5)) }));
  for (const [id, b] of structures) {
    const s = b.def || {};
    if (onRailsReason({ ...s, type: b.type ?? s.type }) != null) continue;
    const natural = NATURAL_TYPES.has(b.type ?? s.type);
    let shapes = (b.footprints || []).filter((f) => f.block || f.bridge || f.elev > 0).map(footprintShape).filter(Boolean);
    // visual-only dressing (block / grid false: parked machines, stacks, carts): the drawn w × d (or r) of its def
    if (!shapes.length) shapes = [defShape(s)].filter(Boolean);
    // the drawn model's plan where the caller knows it (a library building's eaves, porches, a pier's T head)
    if (o.drawn?.has(id)) shapes = [...shapes, ...o.drawn.get(id)];
    if (!shapes.length) continue;
    for (const { r, parts } of runs) {
      // (a drawn shape may be loose debris — a ruin's rubble heap: kept off the sleepers only, like a rock)
      const needOf = (sh) => (natural || sh.natural ? r.sleeper : r.half);
      let dist = Infinity, need = natural ? r.sleeper : r.half;
      for (const sh of shapes) for (const part of parts) {
        const d = shapeLineDist(sh, part);
        if (d - needOf(sh) < dist - need) { dist = d; need = needOf(sh); }
      }
      if (dist < need + (o.near ?? 0)) {
        const row = { id, type: b.type ?? s.type, variant: String(s.variant ?? ''), rail: r.id, kind: r.kind, natural,
          dist: +dist.toFixed(3), need: +need.toFixed(3), overlap: +(need - dist).toFixed(3) };
        const why = dist < need ? railAllowance(s, r) : null;   // (per-rail tag: this wire over this dead siding)
        if (why) allowed.push({ ...row, why }); else hits.push(row);
      }
    }
  }
  // street furniture (world/roads.js `furniture`: lamps, signs, benches, milestones): a post or a small plan
  for (const f of normalizeRoadNetwork(def).furniture) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) continue;
    const sh = f.w > 0 && f.d > 0 ? footprintShape({ shape: 'rect', x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot ?? 0 })
      : footprintShape({ shape: 'circle', x: f.x, z: f.z, r: f.r ?? FURNITURE_R });
    for (const { r, parts } of runs) {
      let dist = Infinity;
      for (const part of parts) dist = Math.min(dist, shapeLineDist(sh, part));
      if (dist < r.half + (o.near ?? 0)) hits.push({ id: f.id, type: f.type, variant: String(f.variant ?? ''), rail: r.id, kind: r.kind, natural: false,
        dist: +dist.toFixed(3), need: +r.half.toFixed(3), overlap: +(r.half - dist).toFixed(3) });
    }
  }
  hits.sort((a, b) => b.overlap - a.overlap);
  return { rails, hits, allowed };
}

/**
 * The drawn track beds of a mission for the wire layer (art/wire-obstacles.js `rails`): {id, line, half} — a rail_track's
 * centre line and its static corridor (ballast + CLEAR.static), which the posts of a wire over it stand outside.
 */
export function railBeds(def) {
  return railLines(def).filter((r) => r.kind === 'track').map(({ id, line, half }) => ({ id, line, half }));
}

/** Plan radius (m) of a street-furniture item without its own size (a lamp post, a sign, a milestone). */
const FURNITURE_R = 0.35;

/** Default heights (m) by type when a def gives none (advisory view check only). */
const H_DEFAULT = { barracks: 5, house: 7, flat_roof_house: 5, hut: 3.5, bunker: 2.5, minaret: 8, tent: 2.5, ruins: 5, wall: 2, fence: 1.5, hangar: 9 };

/**
 * Advisory (tools/layout/rail-report.mjs --view): structures whose drawn height covers the rail heads from the default
 * camera (orthographic, pitch `pitchDeg` below the horizon, yaw `yawDeg`): a top at height h is drawn h·cot(pitch)
 * up-screen of its foot, so a building on the camera's side of a track hides the rails behind it when its footprint,
 * swept that far along the view, reaches them. @returns {{id, rail, cover:number, h:number}[]} cover = m of the sweep
 * past the near rail head (> 0 = rails hidden)
 */
export function viewCover(def, structures, o = {}) {
  const yaw = ((o.yawDeg ?? 15) * Math.PI) / 180, cot = 1 / Math.tan(((o.pitchDeg ?? 40) * Math.PI) / 180);
  const dir = [-Math.sin(yaw), -Math.cos(yaw)]; // the view's horizontal direction (yaw 0: north, -z, is up-screen)
  const rails = railLines(def, o).filter((r) => r.kind !== 'run');
  const out = [];
  for (const [id, b] of structures) {
    const s = b.def || {}, type = b.type ?? s.type;
    if (onRailsReason({ ...s, type }) != null || NATURAL_TYPES.has(type)) continue;
    const h = s.h ?? H_DEFAULT[type] ?? 0;
    if (!(h > 1.5)) continue;
    let shapes = (b.footprints || []).filter((f) => f.block).map(footprintShape).filter((q) => q?.poly);
    if (!shapes.length) shapes = [defShape(s)].filter((q) => q?.poly);
    const L = h * cot;
    for (const r of rails) {
      let best = -Infinity;
      for (const sh of shapes) {
        // the swept plan: the polygon's points stepped along the view (convex enough for a clearance estimate)
        for (let k = 0; k <= 8; k++) {
          const P = sh.poly.map(([x, z]) => [x + dir[0] * L * k / 8, z + dir[1] * L * k / 8]);
          best = Math.max(best, 0.8 - shapeLineDist({ poly: P }, r.line));
        }
      }
      if (best > 0) out.push({ id, type, rail: r.id, h, cover: +best.toFixed(2) });
    }
  }
  return out.sort((a, b) => b.cover - a.cover);
}
