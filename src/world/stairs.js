/**
 * Stair flights of the map: the stepped surfaces men walk up and down (user request 2026-10-07: "animate the commandos
 * climbing and going down stairs properly"). Pure data (no three.js): the sim walks a flight's NOSING LINE (a smooth
 * slope through the treads' front edges: no cell-by-cell height snaps), the view (art/stair-gait.js) puts the feet on
 * its real treads and lifts the body tread by tread.
 *
 * A flight is a straight run along a unit axis u (from its foot up to its top), `w` wide, described by its risers:
 *   risers[k] = arc length s (m, from the origin o along u) of the k-th riser, increasing,
 *   levels[k] = height of the walking surface just before risers[k] (levels[0] the floor at the foot), levels[n] the
 *               top (landing / deck / crest) after the last riser.
 * Every flight in the game is uniform (one rise, one tread), but nothing below relies on it.
 *
 * Sources (map-builder buildStairField): the structures' `ramps` (M3 dam stairs, art/dam-stairs.js), the access
 * platform stairs (M2 plat_sw, art/access-platform.js) and the `ladders[]` links of kind 'stairs' (M6, M9, M12, M20:
 * flights laid out like castle-kit buildStairFlight), which the sim walks as a link (`link`: only a man on that link
 * stands on them).
 * @module world/stairs
 */
import { stairTreads } from '../art/dam-stairs.js';

/** Gameplay pace on a flight (Unit._followPath): walking × walk, running (a careful jog) × run but ≤ runMax m/s and
 *  ≤ jog treads a second (3.75 strides of two treads: on M2's narrow 29 cm treads 2.2 m/s, on the M3 dam's 38 cm 2.9 m/s;
 *  M20's 42 cm keep runMax), crawling × crawl. */
export const STAIR_PACE = { walk: 0.85, run: 0.75, runMax: 3.0, jog: 7.5, crawl: 0.85 };

/**
 * One flight from its risers. @param {{id?:string, kind:string, ox:number, oz:number, ux:number, uz:number, w:number,
 * risers:number[], levels:number[], link?:object|null}} o
 */
export function makeFlight(o) {
  const n = o.risers.length;
  const L = Math.hypot(o.ux, o.uz) || 1;
  const f = { id: o.id ?? null, kind: o.kind, ox: o.ox, oz: o.oz, ux: o.ux / L, uz: o.uz / L, w: o.w, risers: o.risers.slice(), levels: o.levels.slice(), link: o.link ?? null };
  // the nosing line: through the treads' front edges (risers[k], levels[k + 1]); a single riser: its top edge
  const s0 = f.risers[0], s1 = f.risers[n - 1], y0 = f.levels[1], y1 = f.levels[n];
  f.slope = n > 1 ? (y1 - y0) / (s1 - s0) : 0;
  f.lineS0 = s0; f.lineY0 = y0;
  // the run of the flight (its treads) and the mean tread / rise (gait sizing)
  f.tread = n > 1 ? (s1 - s0) / (n - 1) : 0.3;
  f.rise = (f.levels[n] - f.levels[0]) / n;
  f.yMin = Math.min(f.levels[0], f.levels[n]); f.yMax = Math.max(f.levels[0], f.levels[n]);
  // the extent where the nosing line is the walking height: from where it meets the floor to the last riser
  f.sFoot = f.slope > 1e-6 ? s0 - (y0 - f.levels[0]) / f.slope : s0;
  f.sTop = s1;
  // world bounding box of the flight's rectangle (± w/2, from the foot of the line to the top), padded on use
  const ends = [f.sFoot - f.tread, f.sTop + f.tread], px = -f.uz * f.w / 2, pz = f.ux * f.w / 2;
  const xs = [], zs = [];
  for (const s of ends) for (const k of [-1, 1]) { xs.push(f.ox + f.ux * s + px * k); zs.push(f.oz + f.uz * s + pz * k); }
  f.box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  return f;
}

/** (s, v) of a world point in the flight's frame (s along u, v to its left: (−uz, ux)). */
export function flightLocal(f, x, z) {
  const dx = x - f.ox, dz = z - f.oz;
  return { s: dx * f.ux + dz * f.uz, v: -dx * f.uz + dz * f.ux };
}

/** World (x, z) of flight coordinates (s, v). */
export function flightWorld(f, s, v = 0) {
  return { x: f.ox + f.ux * s - f.uz * v, z: f.oz + f.uz * s + f.ux * v };
}

/** Index k of the level at arc length s: the number of risers at or before s (0 = the floor at the foot). */
export function levelIndex(f, s) {
  const R = f.risers;
  let lo = 0, hi = R.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (R[m] <= s) lo = m + 1; else hi = m; }
  return lo;
}

/** Stepped walking surface at s (the tread, the floor before the flight or its top). */
export const levelAt = (f, s) => f.levels[levelIndex(f, s)];

/** The [s0, s1) span of level k (−∞ / +∞ for the floor and the top). */
export function levelSpan(f, k) {
  return [k > 0 ? f.risers[k - 1] : -Infinity, k < f.risers.length ? f.risers[k] : Infinity];
}

/** Nosing-line height at s, clamped to the floor and the top. */
export function lineAt(f, s) {
  const y = f.lineY0 + (s - f.lineS0) * f.slope;
  return Math.min(f.yMax, Math.max(f.yMin, y));
}

/**
 * Flight builders.
 */
/** A structure `ramps` entry (M3 dam stairs: art/dam-stairs.js stairTreads / stairTopAt), one flight per straight leg. */
export function damFlights(r) {
  const P = (r.points || []).map((q) => (Array.isArray(q) ? q : [q.x, q.z]));
  const out = [];
  let total = 0;
  const segs = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    if (l > 1e-6) { segs.push({ a: P[i], b: P[i + 1], s0: total, l }); total += l; }
  }
  if (!(total > 0) || !(r.y1 > 0)) return out;
  const y0 = r.y0 ?? 0, y1 = r.y1, { N, run, landing } = stairTreads(total, y0, y1, r.landing);
  // tread k (0..N-2) spans [k run, (k+1) run) at y0 + (y1 - y0) k / (N - 1); the landing (k = N-1) from L - landing
  const top = (k) => y0 + ((y1 - y0) * k) / (N - 1);
  const allR = [], allL = [0];
  if (y0 > 0.02) { allR.push(0); allL.push(y0); } else allL[0] = y0;
  for (let k = 1; k < N; k++) { allR.push(k < N - 1 ? k * run : total - landing); allL.push(top(k)); }
  for (const g of segs) {
    const ux = (g.b[0] - g.a[0]) / g.l, uz = (g.b[1] - g.a[1]) / g.l;
    // the risers on this leg (in the leg's own arc length), the level before the first of them
    const risers = [], levels = [];
    let k0 = allR.findIndex((s) => s >= g.s0 - 1e-9);
    if (k0 < 0) continue;
    levels.push(allL[k0]);
    for (let k = k0; k < allR.length && allR[k] <= g.s0 + g.l + 1e-9; k++) { risers.push(allR[k] - g.s0); levels.push(allL[k + 1]); }
    if (!risers.length) continue;
    out.push(makeFlight({ id: r.id ?? null, kind: 'dam', ox: g.a[0], oz: g.a[1], ux, uz, w: r.width ?? 1.6, risers, levels }));
  }
  return out;
}

/**
 * The stair of an access platform (art/access-platform.js stairOf), from its grid ramp footprint: top a (the deck's
 * edge, y ya) → foot b (yb), `stairs` {n, rise, tread}: risers every tread from the foot, the deck after the last.
 */
export function platformFlight(ramp, id = null) {
  const S = ramp.stairs;
  if (!S) return null;
  const ox = ramp.bx, oz = ramp.bz, dx = ramp.ax - ramp.bx, dz = ramp.az - ramp.bz, L = Math.hypot(dx, dz);
  if (!(L > 0.1)) return null;
  const risers = [], levels = [ramp.yb];
  const rise = (ramp.ya - ramp.yb) / S.n;
  for (let m = 1; m <= S.n; m++) { risers.push(m * S.tread); levels.push(ramp.yb + rise * m); }
  return makeFlight({ id, kind: 'platform', ox, oz, ux: dx / L, uz: dz / L, w: ramp.w, risers, levels });
}

/**
 * A stair link (`ladders[]` kind 'stairs'): a flight from its foot a to its top b laid out like castle-kit
 * buildStairFlight (n = ceil(rise / 0.2) steps, the first riser at the foot point, the last tread ending at b). The
 * ends default to the link's (snapped onto walkable cells); the mission's own ends are where its mesh stands.
 */
export function linkFlight(link, { width = 1.8, id = null, a = link.a, b = link.b } = {}) {
  // (foot = the lower end; buildStairFlight steps from `a`: a first riser at `a` when it is the foot, the last one at
  // `a` when it is the top)
  const up = (a.y ?? 0) <= (b.y ?? 0), [lo, hi] = up ? [a, b] : [b, a];
  const dx = hi.x - lo.x, dz = hi.z - lo.z, run = Math.hypot(dx, dz), rise = (hi.y ?? 0) - (lo.y ?? 0);
  if (!(run > 0.2) || !(rise > 0.1)) return null;
  const n = Math.max(2, Math.ceil(rise / 0.2)), tr = run / n;
  const risers = [], levels = [lo.y ?? 0];
  for (let i = 0; i < n; i++) { risers.push((up ? i : i + 1) * tr); levels.push((lo.y ?? 0) + (rise * (i + 1)) / n); }
  return makeFlight({ id, kind: 'link', ox: lo.x, oz: lo.z, ux: dx / run, uz: dz / run, w: width, risers, levels, link });
}

/** Every flight of a map, with point queries. */
export class StairField {
  /** @param {object[]} flights makeFlight results */
  constructor(flights = []) { this.flights = flights.filter(Boolean); }

  get size() { return this.flights.length; }

  /** Flights whose (padded) box holds (x, z). */
  *near(x, z, pad = 0) {
    for (const f of this.flights) {
      const b = f.box;
      if (x >= b[0] - pad && x <= b[2] + pad && z >= b[1] - pad && z <= b[3] + pad) yield f;
    }
  }

  /**
   * The flight a man at (x, z) standing at height y is on: within its width (+ `side`), between `pad` m before the
   * foot of its nosing line and `pad` m past its top riser, and at its height there (|y − line| ≤ tol: not a man on
   * the wall walk beside it or under it). A link flight's run only for a man walking that link (`link`: its id); its
   * ends (the floor at its foot, its top) for anybody there.
   * @returns {{f:object, s:number, v:number}|null}
   */
  flightAt(x, z, y, { pad = 0.6, side = 0.15, tol = 0.45, link = null } = {}) {
    let best = null;
    for (const f of this.near(x, z, pad + side)) {
      const { s, v } = flightLocal(f, x, z);
      // (a stair link's flight for a man walking that link — or about to, or just off it: at its foot or its top)
      if (f.link && f.link.id !== link && s > f.sFoot + 0.2 && s < f.sTop - 0.2) continue;
      if (Math.abs(v) > f.w / 2 + side || s < f.sFoot - pad || s > f.sTop + pad) continue;
      const d = Math.abs(lineAt(f, s) - y);
      if (d > tol) continue;
      if (!best || d < best.d) best = { f, s, v, d };
    }
    return best;
  }

  /**
   * Walking height of the sim on a (non-link) flight: its nosing line, where (x, z) is on the sloped part of it
   * (between the foot of the line and the top riser, and half a metre on: the floor / the top there, which graded
   * cells straddling the end riser get wrong by a tread) within its width — or within 0.25 m beside it where the
   * grid's own cell height `e` is within `maxStep` of it (a graded cell that spills over its side; not the wall walk or
   * the ground beside the stair). @returns {number|null}
   */
  simY(x, z, e, maxStep = 0.6) {
    for (const f of this.near(x, z, 0.8)) {
      if (f.link) continue;
      const { s, v } = flightLocal(f, x, z);
      if (Math.abs(v) > f.w / 2 + 0.25 || s <= f.sFoot - 0.5 || s >= f.sTop + 0.5) continue;
      const y = lineAt(f, s);
      if (Math.abs(v) <= f.w / 2 || Math.abs(y - e) <= maxStep) return y;
    }
    return null;
  }

  /** Is (x, z) on or within `m` m of a (non-link) flight's run? */
  nearRun(x, z, m = 1) {
    for (const f of this.near(x, z, m)) {
      if (f.link) continue;
      const { s, v } = flightLocal(f, x, z);
      if (Math.abs(v) <= f.w / 2 + m && s >= f.sFoot - m && s <= f.sTop + m) return true;
    }
    return false;
  }

  /** The flight of a stair link (by link id), or null. */
  ofLink(id) { return this.flights.find((f) => f.link && f.link.id === id) || null; }
}
