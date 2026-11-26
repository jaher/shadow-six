/**
 * LIGHTS OUT e07 "White Out": the mission's building kit (docs/expansion/e07.md §13). Procedural, castle-kit geometry
 * (one merged mesh per finish), visual only:
 *   - `snowBlanket`: lumpy roof snow (master's look: a thick, sculpted, wind-blown blanket with a rolled, drooping lip
 *     and icicles under it — never a flat slab);
 *   - `tyrolFarmhouse`: an Ötztal farmhouse (Einhof) — rubble plinth, whitewashed ground floor with grilled windows,
 *     dark larch log upper floor, the gable Söller and the hay-loft gallery, a wide low shingle roof on purlins,
 *     woodpile under the eaves, a bench, a sledge;
 *   - `onionChapel`: a wayside chapel with its west tower and shingled onion dome;
 *   - `stadel`: a log hay barn on rubble piers;
 *   - `ridgeFace`: a 30 m granite face whose relief goes into the rock (gullies, buttresses, benches) and never out
 *     over the walkable foot; `rimCornice`: the wind cornice along the plateau's lip.
 * @module art/e07-kit
 */
import * as THREE from 'three';
import { CASTLE_SETS, localFrame, segBox } from './castle-kit.js';
import { fbm, seedOf } from './dressing.js';
import { due, runSync } from '../engine/slice.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
/** Smooth minimum / maximum of a and b, blended over about k (no kink, so an eased line keeps its wander). */
const softMin = (a, b, k) => { const m = Math.min(a, b); return m - k * Math.log(Math.exp((m - a) / k) + Math.exp((m - b) / k)); };
const softMax = (a, b, k) => -softMin(-a, -b, k);
/** dressing.js fbm is zero-centred (about ±0.8): this maps it to 0…1. */
const f01 = (v) => clamp01(0.5 + 0.62 * v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// the kit's finishes (castle-kit material keys: vertex-toned, box-projected)
Object.assign(CASTLE_SETS, {
  e07Whitewash: ['plaster_rough', 0xf0ece2, 0xd9d2c2, 2.0, 0.8], // lime-washed rubble, greyed by weather
  e07LogsOld: ['log_hewn', 0x6e4c34, 0x3b2516, 1.5, 1.15], // sun-blackened larch (south walls)
  e07Boards: ['boards_weathered', 0x8a7058, 0x4e3a2a, 1.4, 1.1], // hay-loft boards
  e07Ice: ['glass_dirty', 0xdfeaf2, 0xb7c8d6, 0.6, 0.3],
  e07Icicle: ['snow_soft', 0xe2edf8, 0xc9d8e6, 0.8, 0.3], // icicles: pale, bluish ice (never a dark glass spike)
  // roof snow in master's roof-snow finish (the library 'snow' the snow-theatre stations, huts and barracks carry on
  // their roofs: wind-packed, with its fine crust lines), not the featureless soft snow
  e07RoofSnow: ['snow', 0xffffff, 0xf2f5fa, 2.4, 0.5],
  // the snow drifted against the buildings' wall feet (wallDrift): the dressing draws it in the map's own ground snow
  // (e07-dressing GROUND_SNOW); this finish only stands in before the terrain is up
  e07Drift: ['snow_soft', 0xffffff, 0xf2f5fa, 3.0, 0.4],
});

/** A quad wound so its face normal points along `n` (flips the order when it would face away). */
export function quadN(G, mat, a, b, c, d, n, tone = 1) {
  const f = cross(sub(b, a), sub(c, a));
  if (dot(f, n) >= 0) G.quad(mat, a, b, c, d, tone); else G.quad(mat, a, d, c, b, tone);
}
/** A triangle wound so its face normal points along `n`. */
export function triN(G, mat, a, b, c, n, tone = 1) {
  const f = cross(sub(b, a), sub(c, a));
  if (dot(f, n) >= 0) G.tri(mat, a, b, c, tone); else G.tri(mat, a, c, b, tone);
}
/**
 * Lumpy roof snow over the roof plane E0 → E1 (the eave) / R0 → R1 (the ridge), as master's sculpted snow assets carry it
 * (the user's reference: lumpy, thick, wind-blown, never a smooth even slab): a blanket of uneven lumps and pits that
 * thins towards its edges; bare melt patches where the shingles show through — a wind-scoured band along the ridge,
 * ragged holes, the verges bitten back unevenly, stretches of eave where a slab has slid off; a rolled lip over the
 * eave that sags in scallops, broken where the snow has gone; icicles hanging in clusters under the sags.
 * The outline is cut along a coverage field (metres from the nearest bare ground, + inside), so it wanders; a thin
 * skirt down to the shingles shows the snow's thickness at every edge. Coverage `bare` 0 … 1 (default 0.5) sets how
 * much roof shows; `slides` 0 … 1 how much of the eave has shed its snow.
 * @param {object} G castle-kit Geo
 * @param {number[]} E0 @param {number[]} E1 @param {number[]} R1 @param {number[]} R0 [x, y, z] roof corners
 * @param {{th?:number, lip?:number, droop?:number, verge?:number, seed?:string, icicles?:number, bare?:number,
 *   slides?:number, cell?:number, mat?:string, iceMat?:string, cover?:(p:number[], f:number, a:number, b:number)=>number}} [o]
 *   cover: the coverage (m) at world point p from the roof's own `f` (a drift patch on ice: its own outline); lip 0: none
 */
export function snowBlanket(G, E0, E1, R1, R0, o = {}) {
  const mat = o.mat ?? 'e07RoofSnow', s = seedOf(o.seed ?? 'snow') & 0xffff;
  const eDir = sub(E1, E0), Lu = len(eDir), tDir = sub(R0, E0), Lv = len(tDir);
  let N = norm(cross(eDir, tDir)); if (N[1] < 0) N = mul(N, -1);
  const out = norm([-tDir[0], 0, -tDir[2]]); // horizontal, away from the ridge (over the eave)
  const cell = o.cell ?? 0.42, nu = Math.max(4, Math.round(Lu / cell)), nv = Math.max(3, Math.round(Lv / cell));
  const th = o.th ?? 0.32, verge = o.verge ?? 0.14, bare = o.bare ?? 0.5, slides = o.slides ?? 1;
  const P = (a, b) => lerp3(lerp3(E0, E1, a), lerp3(R0, R1, a), b);
  const n2 = (x, y, k) => fbm(x, y, 0.37 + k * 0.11, s + k, 2);
  // coverage (m): + under snow, − bare; the minimum of the verges, the ridge band, the eave slides and the melt holes
  const cover = (a, b, p) => {
    const u = a * Lu, v = b * Lv;
    const bite = (k) => 0.55 * Math.max(0, n2(v * 0.32, 2.2, k) - 0.18) * 2.2;
    const dL = u - verge * (0.45 + 1.5 * f01(n2(v * 0.55, 1.3, 21))) - bite(23);
    const dR = Lu - u - verge * (0.45 + 1.5 * f01(n2(v * 0.55, 4.1, 22))) - bite(24);
    const dTop = Lv - v - (bare * (0.1 + 1.25 * f01(n2(u * 0.28, 4.4, 25)) ** 1.6) + 0.06);
    const dEave = v + 0.02 - slides * 2.4 * Math.max(0, n2(u * 0.36, 6.1, 27) - 0.22);
    const nh = fbm(p[0] * 0.42, p[1] * 0.2, p[2] * 0.42, s + 31, 3) + 0.45 * fbm(p[0] * 1.1, p[1] * 0.4, p[2] * 1.1, s + 33, 2);
    const dHole = (0.7 - 0.5 * bare - nh) * 1.5;
    const f = Math.min(dL, dR, dTop, dEave, dHole);
    return o.cover ? o.cover(p, f, a, b) : f;
  };
  // thickness: lumps at three scales, piled towards the eave, thinning to the edge
  const thick = (b, p, f) => {
    const lump = 1 + 0.62 * fbm(p[0] * 0.42, p[1] * 0.3, p[2] * 0.42, s + 41, 3) + 0.3 * fbm(p[0] * 1.3, p[1], p[2] * 1.3, s + 43, 2)
      + 0.12 * fbm(p[0] * 3.3, p[1], p[2] * 3.3, s + 45, 1);
    // (the edge feathers out to a few centimetres over 0.7 m: a melt hole or a bitten verge is a soft rounded rim
    // running down to the shingles, never a crisp vertical wall of snow)
    return th * Math.min(2.1, Math.max(0.3, lump)) * (1 + 0.3 * (1 - b) ** 2) * (0.07 + 0.93 * smooth(f / 0.7));
  };
  const EPS = 0.025; // (the edge stands this far off the shingles: never coplanar with them)
  const node = (a, b, fKnown) => {
    const p = P(a, b), f = fKnown ?? cover(a, b, p), t = f > 0 || fKnown === 0 ? thick(b, p, Math.max(0, f)) : 0;
    return { a, b, f, p, t, S: add(p, mul(N, EPS + t)), B: add(p, mul(N, 0.012)) };
  };
  const grid = [];
  for (let i = 0; i <= nu; i++) { grid.push([]); for (let j = 0; j <= nv; j++) grid[i].push(node(i / nu, j / nv)); }
  // one slow tone field over the blanket (by each triangle's centre): neighbours differ by a hair, so the lumps shade
  // by their normals, not as a patchwork of triangles a shade apart
  const tone = (A, B, C) => 0.975 + 0.03 * f01(fbm((A[0] + B[0] + C[0]) * 0.12, 0, (A[2] + B[2] + C[2]) * 0.12, s + 51, 1));
  const tri = (A, B, C) => {
    const q = [A, B, C], poly = [], cut = [];
    for (let k = 0; k < 3; k++) {
      const X = q[k], Y = q[(k + 1) % 3];
      if (X.f > 0) poly.push(X);
      if ((X.f > 0) !== (Y.f > 0)) {
        const t = X.f / (X.f - Y.f), Z = node(lerp(X.a, Y.a, t), lerp(X.b, Y.b, t), 0);
        poly.push(Z); cut.push(Z);
      }
    }
    if (poly.length < 3) return;
    for (let k = 1; k + 1 < poly.length; k++) triN(G, mat, poly[0].S, poly[k].S, poly[k + 1].S, N, tone(poly[0].S, poly[k].S, poly[k + 1].S));
    if (cut.length === 2) { // the snow's edge: a skirt down to the shingles, facing out of the covered part
      const [C0, C1] = cut, cIn = poly.reduce((m, Q) => add(m, mul(Q.p, 1 / poly.length)), [0, 0, 0]);
      const mid = mul(add(C0.p, C1.p), 0.5), o = sub(mid, cIn), oo = sub(o, mul(N, dot(o, N)));
      if (len(oo) > 1e-4) quadN(G, mat, C0.S, C1.S, C1.B, C0.B, norm(oo), 0.96);
    }
  };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const q00 = grid[i][j], q10 = grid[i + 1][j], q11 = grid[i + 1][j + 1], q01 = grid[i][j + 1];
    if ((i + j) % 2) { tri(q00, q10, q11); tri(q00, q11, q01); } else { tri(q00, q10, q01); tri(q10, q11, q01); }
  }
  // the lip over the eave: rolled and sagging in scallops (a pillow every metre or so), only where the eave holds snow,
  // pinched off at the ends of each stretch
  const lipOv = o.lip ?? 0.2, lipDr = o.droop ?? 0.28, per = 0.8 + 0.6 * f01(n2(1.7, 0.4, 61));
  const covered = grid.map((col) => lipOv > 0 && col[0].f > 0.12);
  const sags = [];
  for (let i0 = 0; i0 <= nu;) {
    if (!covered[i0]) { i0++; continue; }
    let i1 = i0; while (i1 + 1 <= nu && covered[i1 + 1]) i1++;
    if (i1 - i0 >= 2) {
      const rows = [];
      for (let i = i0; i <= i1; i++) {
        const q = grid[i][0], e = q.p, u = q.a * Lu;
        const ph = u / per + 0.35 * n2(u * 0.5, 7.3, 63), sc = Math.abs(Math.sin(Math.PI * ph)) ** 0.6;
        const k = 0.45 + 0.9 * f01(n2(u * 0.9, 0.3, 65)), end = 0.12 + 0.88 * smooth(Math.min(i - i0, i1 - i) / 2.2);
        const ov = lipOv * (0.55 + 0.75 * k) * end, dr = lipDr * (0.25 + 1.05 * sc) * k * end;
        if (sc > 0.93 && end > 0.6) sags.push([q, dr]);
        rows.push([
          q.S,
          add(add(e, mul(out, ov * 0.7)), mul(N, q.t * 0.9 + EPS)),
          add(add(e, mul(out, ov)), [0, q.t * 0.25 - dr * 0.35, 0]),
          add(add(e, mul(out, ov * 0.75)), [0, -dr, 0]),
          add(add(e, mul(out, 0.03)), [0, -Math.min(0.12, dr * 0.4) - 0.02, 0]),
        ]);
      }
      for (let i = 0; i + 1 < rows.length; i++) for (let r = 0; r < 4; r++) {
        const nOut = r < 2 ? norm(add(out, N)) : r < 3 ? out : norm(add(out, [0, -1, 0]));
        quadN(G, mat, rows[i][r], rows[i + 1][r], rows[i + 1][r + 1], rows[i][r + 1], nOut, 0.985 - r * 0.008);
      }
    }
    i0 = i1 + 1;
  }
  // icicles in clusters under the deepest sags (pale ice, longer on the sunny planes' drip line)
  let nIce = o.icicles ?? Math.round(Lu * 0.7);
  for (let k = 0; k < sags.length && nIce > 0; k++) {
    const [q, dr] = sags[k], m = 1 + Math.round(2 * f01(n2(k * 2.3, 0.2, 71)));
    for (let c = 0; c < m && nIce > 0; c++, nIce--) {
      const L = 0.08 + 0.7 * f01(n2(k * 1.7 + c * 3.1, 0.6, 73)) ** 1.5, off = (c - (m - 1) / 2) * 0.13;
      const base = add(add(q.p, mul(out, lipOv * 0.6)), add(mul(norm(eDir), off), [0, -dr * 0.85, 0]));
      G.cyl(o.iceMat ?? 'e07Icicle', base[0], base[1] - L, base[2], 0.004, 0.022 + 0.014 * (c % 2), L, 5, 1.0, { caps: false });
    }
  }
  return { N };
}

/**
 * The roll of snow over a ridge line R0 → R1 (covering the joint of two blankets): lumpy, and broken where the wind
 * has scoured the ridge bare — each stretch swells from nothing and pinches off again.
 */
export function ridgeRoll(G, R0, R1, { r = 0.32, seed = 'ridge', mat = 'e07RoofSnow', n, gaps = 0.35 } = {}) {
  const s = seedOf(seed) & 0xffff, L = len(sub(R1, R0)), steps = n ?? Math.max(6, Math.round(L / 0.35));
  const t = norm(sub(R1, R0)), side = norm(cross(t, [0, 1, 0]));
  const on = (c) => fbm(c[0] * 0.45, c[1] * 0.2, c[2] * 0.45, s + 7, 2) > (gaps - 0.5) * 0.6;
  const rings = [];
  for (let i = 0; i <= steps; i++) {
    const c = lerp3(R0, R1, i / steps);
    rings.push({ c, on: on(c), k: 1 + 0.55 * fbm(c[0] * 0.8, c[1], c[2] * 0.8, s, 2) + 0.2 * fbm(c[0] * 2.4, c[1], c[2] * 2.4, s + 3, 1) });
  }
  // stretch ends: the radius eases in over two rings either side of a gap
  const ease = rings.map((_, i) => {
    let d = 99;
    for (let j = 0; j <= steps; j++) if (!rings[j].on) d = Math.min(d, Math.abs(i - j));
    if (!rings[i].on) return 0;
    return smooth(Math.min(1, (d - 0.5) / 2.2)) * smooth(Math.min(i, steps - i) / 1.5 + 0.35);
  });
  const ring = (i) => {
    const { c, k } = rings[i], rr = r * k * ease[i];
    const pts = [];
    for (let a = 0; a <= 6; a++) {
      const ang = Math.PI * (a / 6), w = 1 + 0.25 * fbm(c[0] * 1.6 + a, c[1], c[2] * 1.6, s + 11, 1);
      pts.push(add(c, add(mul(side, Math.cos(ang) * rr * 1.6 * w), [0, Math.sin(ang) * rr * 0.75 * w + rr * 0.12 - 0.04 * (1 - ease[i]), 0])));
    }
    return pts;
  };
  const R = rings.map((_, i) => ring(i));
  for (let i = 0; i < steps; i++) {
    if (ease[i] < 1e-3 && ease[i + 1] < 1e-3) continue;
    for (let a = 0; a < 6; a++) {
      const p = R[i][a], q = R[i + 1][a], q1 = R[i + 1][a + 1], p1 = R[i][a + 1];
      const mid = mul(add(add(p, q), add(q1, p1)), 0.25), nrm = norm(sub(mid, add(lerp3(rings[i].c, rings[i + 1].c, 0.5), [0, -0.1, 0])));
      quadN(G, mat, p, q, q1, p1, nrm, 1.02);
    }
  }
}

/** A lumpy cap of snow over a flat top (a chimney's cap, a woodpile, a post): domed, overhanging a hand's breadth. */
export function snowMound(G, F, u0, u1, w0, w1, y, { th = 0.16, seed = 'mound', mat = 'e07RoofSnow', over = 0.04, n = 5, nu = n, nv = n } = {}) {
  const s = seedOf(seed) & 0xffff, cu = (u0 + u1) / 2, cw = (w0 + w1) / 2, hu = (u1 - u0) / 2 + over, hw = (w1 - w0) / 2 + over;
  const P = (u, w, yy) => { const [x, z] = F.at(u, w); return [x, yy, z]; };
  const pts = [];
  for (let i = 0; i <= nu; i++) {
    pts.push([]);
    for (let j = 0; j <= nv; j++) {
      const a = (i / nu) * 2 - 1, b = (j / nv) * 2 - 1, r = Math.min(1, (Math.abs(a) ** 4 + Math.abs(b) ** 4) ** 0.25);
      const u = cu + a * hu, w = cw + b * hw, [x, z] = F.at(u, w);
      const lump = 1 + 0.4 * fbm(x * 1.4, y, z * 1.4, s, 2);
      pts[i].push(P(u, w, y + 0.01 + th * Math.sqrt(Math.max(0, 1 - r ** 3)) * lump));
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) quadN(G, mat, pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1], [0, 1, 0], 1.0);
  const rim = [];
  for (let i = 0; i < nu; i++) rim.push([pts[i][0], pts[i + 1][0]], [pts[i + 1][nv], pts[i][nv]]);
  for (let j = 0; j < nv; j++) rim.push([pts[nu][j], pts[nu][j + 1]], [pts[0][j + 1], pts[0][j]]);
  for (const [p, q] of rim) {
    const d = norm([(p[0] + q[0]) / 2 - F.at(cu, cw)[0], 0, (p[2] + q[2]) / 2 - F.at(cu, cw)[1]]);
    quadN(G, mat, p, q, [q[0], y - 0.05, q[2]], [p[0], y - 0.05, p[2]], d, 0.94);
  }
}

/**
 * Snow banked against a wall foot along `line` ([x, z] points; going along it the wall is on the left, the drift on
 * the right): lumpy, its height and its reach wandering in lobes and bays, the crest run into the wall (`into` m: a
 * recessed rock face behind it shows no crevice), the toe dug in under the ground snow so it has no edge of its own,
 * the ends running out into the snowfield. Opt-in breakup: `scour` (0 … 1) how much of the run the wind has scoured
 * down to the ground, `clear` ([a, b] metres along the line) stretches dug out by hand (a door's way; the snow back
 * to full height `ramp` m beyond) — there the section sinks under the snowfield as at the ends: a break, never a cut
 * end; `rough` a second, finer scale of lumps. Its builder draws it in the map's own
 * ground snow (e07-dressing GROUND_SNOW) with smoothed normals: one snow with the ground it rises out of.
 */
export function footDrift(G, line, { h = 0.5, reach = 1.2, seed = 'drift', step = 0.28, into = 0.6, mat = 'e07Snow', scour = 0, clear = [], ramp = 0.6, rough = 0 } = {}) {
  const s = seedOf(seed) & 0xffff, pts = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  pts.push(line[line.length - 1]);
  let acc = 0;
  const along = pts.map((p, i) => (i ? (acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])) : 0)), Lt = acc;
  // (w / reach, y / h) from inside the wall out to the toe under the ground
  const prof = [[-1, 1.0], [0.05, 0.97], [0.2, 0.88], [0.4, 0.68], [0.6, 0.44], [0.78, 0.22], [0.92, 0.07], [1.08, -0.1]];
  const rows = pts.map(([x, z], i) => {
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / tl, tz = (b[1] - a[1]) / tl, nx = tz, nzz = -tx, at = along[i];
    let ends = smooth(Math.min(at, Lt - at) / 1.4);
    // (the scoured stretches and the dug-out ones go down like the ends)
    if (scour > 0) ends *= 1 - smooth((fbm(at * 0.21, 6.3, 0.4, s + 13, 2) - (0.62 - 0.9 * scour)) / 0.18);
    for (const [c0, c1] of clear) ends *= smooth(Math.max(c0 - at, at - c1) / ramp);
    const k = 0.4 + 1.1 * f01(fbm(at * 0.9, 1.3, 0.2, s, 2) + 0.4 * Math.sin(at * 1.6 + 1.7) + 0.25 * fbm(at * 2.6, 0.7, 1.9, s + 9, 1));
    const r = reach * (0.55 + 0.8 * f01(fbm(at * 0.3, 4.1, 0.6, s + 3, 2))) * (0.45 + 0.55 * ends), hh = h * k * ends;
    return prof.map(([fw, fy]) => {
      const w = fw < 0 ? -into : fw * r;
      const lump = fw > 0 && fw < 1 ? 1 + 0.28 * fbm(x * 1.6 + nx * w, 0.3, z * 1.6 + nzz * w, s + 7, 2) + (rough && rough * fbm((x + nx * w) * 3.6, 2.2, (z + nzz * w) * 3.6, s + 11, 2)) : 1;
      // (the whole section sinks under the snowfield towards the ends: never a sheet lying on the ground)
      const y = (fy < 0 ? fy : hh * fy * lump) - 0.16 * (1 - ends);
      return [x + nx * w, y, z + nzz * w];
    });
  });
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < prof.length; j++) {
    quadN(G, mat, rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], [0, 1, 0], 1);
  }
}

/**
 * Snow drifted against a building's wall foot: `footDrift` along u0 → u1 of frame F at w = `wall`, out on the `side`
 * side — lobes and bays, scoured down to the ground here and there, dug out over `clear` ([u0, u1] ranges of F: a
 * door's way) — in the `e07Drift` finish, which the dressing draws in the map's own ground snow (no tiled white wedge).
 */
export function wallDrift(G, F, u0, u1, wall, side, { h = 0.6, depth = 1.1, seed = 'drift', mat = 'e07Drift', into = 0.3, scour = 0.4, clear = [], rough = 0.12 } = {}) {
  const a = F.at(u0, wall), b = F.at(u1, wall);
  // (footDrift's drift lies on the right of its line: running u1 → u0 puts it on F's +w side)
  const toAlong = side > 0 ? ([c0, c1]) => [u1 - c1, u1 - c0] : ([c0, c1]) => [c0 - u0, c1 - u0];
  footDrift(G, side > 0 ? [b, a] : [a, b], { h, reach: depth, seed, mat, into, scour, clear: clear.map(toAlong), ramp: 1.1, rough });
}

// ---------------------------------------------------------------- windows, balconies (shared with the hotel)
/** A deep window: dark glass, a white frame and cross bar, shutters folded back (or one closed); bars when `grille`. */
export function windowBay(G, F, u, y0, h, w, depth, face, { shutters = true, grille = false, closed = 0, frame = 'e07Frame', shutter = 'e07Shutter' } = {}) {
  const wo = face * 0.02, wi = -face * depth;
  segBox(G, 'e07Glass', F, u - w / 2, u + w / 2, Math.min(wo, wi), Math.max(wo, wi), y0, y0 + h, 0.9);
  const fr = 0.07, f0 = face > 0 ? 0.01 : -0.07, f1 = face > 0 ? 0.07 : -0.01;
  for (const [a, b, c, d] of [[u - w / 2 - fr, u - w / 2, y0 - fr, y0 + h + fr], [u + w / 2, u + w / 2 + fr, y0 - fr, y0 + h + fr], [u - w / 2, u + w / 2, y0 - fr, y0], [u - w / 2, u + w / 2, y0 + h, y0 + h + fr]]) {
    segBox(G, frame, F, a, b, f0, f1, c, d, 1);
  }
  if (!grille) {
    segBox(G, frame, F, u - 0.03, u + 0.03, f0 * 0.6, f1 * 0.6, y0, y0 + h, 0.97);
    segBox(G, frame, F, u - w / 2, u + w / 2, f0 * 0.6, f1 * 0.85, y0 + h * 0.6 - 0.03, y0 + h * 0.6 + 0.03, 0.97); // (proud of the mullion)
  } else {
    for (let k = 1; k < 4; k++) segBox(G, 'iron', F, u - w / 2 + (k * w) / 4 - 0.015, u - w / 2 + (k * w) / 4 + 0.015, face > 0 ? 0.04 : -0.08, face > 0 ? 0.08 : -0.04, y0, y0 + h, 0.7);
    for (let k = 1; k < 3; k++) segBox(G, 'iron', F, u - w / 2, u + w / 2, face > 0 ? 0.05 : -0.09, face > 0 ? 0.09 : -0.05, y0 + (k * h) / 3 - 0.015, y0 + (k * h) / 3 + 0.015, 0.7);
  }
  if (shutters) for (const sd of [-1, 1]) {
    if (closed === sd) { // this leaf shut over half the window, a little proud of the frame
      segBox(G, shutter, F, sd < 0 ? u - w / 2 - 0.02 : u + 0.01, sd < 0 ? u - 0.01 : u + w / 2 + 0.02, face > 0 ? 0.07 : -0.11, face > 0 ? 0.11 : -0.07, y0 - 0.02, y0 + h + 0.02, 0.92);
      continue;
    }
    const a = u + sd * (w / 2 + fr), b = a + sd * (w / 2 + 0.04);
    segBox(G, shutter, F, Math.min(a, b), Math.max(a, b), face > 0 ? 0.02 : -0.08, face > 0 ? 0.08 : -0.02, y0 - 0.02, y0 + h + 0.02, 0.92 + 0.08 * sd);
  }
}

/** An alpine balcony (Söller): floor on brackets, cut-board balustrade, corner posts. */
export function soeller(G, F, u0, u1, y, depth, face, { mat = 'e07Trim', seed = 1, broken = -1 } = {}) {
  const w0 = face > 0 ? 0 : -depth, w1 = face > 0 ? depth : 0, out = face > 0 ? depth : -depth;
  segBox(G, mat, F, u0, u1, w0, w1, y - 0.12, y, 1);
  for (let u = u0 + 0.5; u < u1; u += 2.1) segBox(G, mat, F, u - 0.07, u + 0.07, face > 0 ? 0 : -depth * 0.9, face > 0 ? depth * 0.9 : 0, y - 0.55, y - 0.12, 0.85);
  const o0 = face > 0 ? out - 0.07 : out, o1 = face > 0 ? out : out + 0.07;
  segBox(G, mat, F, u0, u1, o0 - 0.01, o1 + 0.01, y + 0.9, y + 1.0, 0.92); // hand rail
  segBox(G, mat, F, u0, u1, o0, o1, y + 0.04, y + 0.13, 0.9);
  let k = 0;
  for (let u = u0 + 0.12; u < u1 - 0.06; u += 0.18, k++) {
    if (k === broken) continue; // one board gone
    const sag = ((k * 37 + seed * 11) % 7 === 0) ? 0.06 : 0; // and one hanging a little low
    segBox(G, mat, F, u - 0.06, u + 0.06, o0 + 0.01, o1 - 0.01, y + 0.13 - sag, y + 0.9 - sag * 0.5, 0.84 + (k % 3) * 0.06);
  }
  for (const u of [u0, u1]) segBox(G, mat, F, u - 0.06, u + 0.06, w0, w1, y, y + 1.0, 0.9);
}

// ---------------------------------------------------------------- the Ötztal farmhouse
/**
 * An Ötztal farmhouse over the footprint (x, z, w × d, rot): the ridge runs along the depth (d), the south gable front
 * faces +w (local). Stays inside the footprint below the eaves (the gameplay box is the def's).
 * @param {object} G castle-kit Geo
 * @param {{x:number, z:number, w:number, d:number, rot?:number, seed?:string, face?:number, h?:number}} p
 */
export function tyrolFarmhouse(G, p) {
  const seed = p.seed ?? 'farm', S = seedOf(seed), R = (k) => ((Math.sin(S * 0.001 + k * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const F = localFrame(p.x, p.z, p.rot ?? 0), hw = p.w / 2 - 0.1, hd = p.d / 2 - 0.1;
  const PL = 0.55, GF = 3.0, EAVE = 5.7, pitch = (21 + R(1) * 4) * Math.PI / 180, ovS = 1.0, ovG = 1.3;
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  // plinth, the whitewashed ground floor (with patches where the wash has gone), the log upper floor
  segBox(G, 'rubble', F, -hw - 0.12, hw + 0.12, -hd - 0.12, hd + 0.12, 0, PL, 0.88);
  segBox(G, 'e07Whitewash', F, -hw, hw, -hd, hd, PL, GF, 1);
  for (let k = 0; k < 7; k++) { // bare rubble showing through the lime wash (proud by 2 cm: no coplanar faces)
    const side = k % 4, a = (R(10 + k) - 0.5) * (side < 2 ? 2 * hw - 1.6 : 2 * hd - 1.6), y = PL + 0.15 + R(20 + k) * 1.2, wdt = 0.4 + R(30 + k) * 0.7, ht = 0.25 + R(40 + k) * 0.45;
    if (side === 0) segBox(G, 'rubble', F, a - wdt / 2, a + wdt / 2, hd, hd + 0.025, y, y + ht, 0.82);
    else if (side === 1) segBox(G, 'rubble', F, a - wdt / 2, a + wdt / 2, -hd - 0.025, -hd, y, y + ht, 0.82);
    else if (side === 2) segBox(G, 'rubble', F, hw, hw + 0.025, a - wdt / 2, a + wdt / 2, y, y + ht, 0.82);
    else segBox(G, 'rubble', F, -hw - 0.025, -hw, a - wdt / 2, a + wdt / 2, y, y + ht, 0.82);
  }
  segBox(G, 'e07Trim', F, -hw - 0.1, hw + 0.1, -hd - 0.1, hd + 0.1, GF, GF + 0.22, 0.86); // sill beam
  segBox(G, 'e07LogsOld', F, -hw - 0.04, hw + 0.04, -hd - 0.04, hd + 0.04, GF + 0.22, EAVE, 1);
  for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { // the notched log ends at the corners
    for (let y = GF + 0.3, k = 0; y < EAVE - 0.1; y += 0.34, k++) {
      const l = 0.28 + 0.06 * ((k + su) % 2);
      segBox(G, 'e07LogsOld', F, su > 0 ? hw : -hw - l, su > 0 ? hw + l : -hw, sw > 0 ? hd - 0.15 : -hd - 0.03, sw > 0 ? hd + 0.03 : -hd + 0.15, y, y + 0.16, 0.82);
      segBox(G, 'e07LogsOld', F, su > 0 ? hw - 0.15 : -hw - 0.03, su > 0 ? hw + 0.03 : -hw + 0.15, sw > 0 ? hd : -hd - l, sw > 0 ? hd + l : -hd, y + 0.17, y + 0.33, 0.8);
    }
  }
  // the gables: logs to the collar, then the hay loft's boards with air gaps, under the ridge
  const yR = EAVE + hw * Math.tan(pitch);
  const yB = EAVE + 0.95, uB = hw - 0.95 / Math.tan(pitch); // (the log courses stop at the loft floor)
  for (const sw of [-1, 1]) {
    const w = sw * (hd + 0.04), nG = [F.n[0] * sw, 0, F.n[1] * sw];
    quadN(G, 'e07LogsOld', P(-hw - 0.04, w, EAVE), P(hw + 0.04, w, EAVE), P(Math.max(0.2, uB), w, yB), P(-Math.max(0.2, uB), w, yB), nG, 1);
    // the loft's dark inside, set back behind the boards
    const wb = sw * (hd - 0.25);
    triN(G, 'e07Glass', P(-uB - 0.2, wb, yB - 0.02), P(uB + 0.2, wb, yB - 0.02), P(0, wb, yR - 0.1), nG, 0.22);
    for (let u = -uB + 0.1, k = 0; u < uB - 0.05; u += 0.27, k++) { // boards, a finger's gap between them
      const top = yR - Math.abs(u) * Math.tan(pitch) - 0.05;
      if (top <= yB + 0.1) continue;
      segBox(G, 'e07Boards', F, u - 0.11, u + 0.11, sw > 0 ? w - 0.03 : w - 0.03, sw > 0 ? w + 0.03 : w + 0.03, yB, top, 0.84 + 0.1 * (k % 2) + 0.05 * ((k * 7) % 3 === 0));
    }
    segBox(G, 'e07Trim', F, -uB - 0.25, uB + 0.25, w - 0.06, w + 0.06, yB - 0.05, yB + 0.08, 0.8); // the loft floor beam
  }
  // the roof: two shingle planes on purlins, wide eaves; rafter tails and purlin heads
  const zS = hd + ovG, zN = -hd - ovG, uE = hw + ovS, yE = EAVE - ovS * Math.tan(pitch) + 0.15;
  for (const su of [-1, 1]) {
    const e0 = P(su * uE, zN, yE), e1 = P(su * uE, zS, yE), r1 = P(0, zS, yR + 0.15), r0 = P(0, zN, yR + 0.15);
    const nUp = norm(cross(sub(e1, e0), sub(r0, e0))), n = nUp[1] < 0 ? mul(nUp, -1) : nUp;
    quadN(G, 'e07Shingle', e0, e1, r1, r0, n, 1);
    quadN(G, 'e07Trim', add(e0, [0, -0.14, 0]), add(e1, [0, -0.14, 0]), add(r1, [0, -0.14, 0]), add(r0, [0, -0.14, 0]), mul(n, -1), 0.6);
    // fascia (the shingle edge's thickness) along the eave
    quadN(G, 'e07Trim', e0, e1, add(e1, [0, -0.14, 0]), add(e0, [0, -0.14, 0]), [F.t[0] * su, 0, F.t[1] * su], 0.8);
    for (let w = zN + 0.4; w < zS; w += 0.95) segBox(G, 'e07Trim', F, su > 0 ? hw : -uE + 0.02, su > 0 ? uE - 0.02 : -hw, w - 0.07, w + 0.07, EAVE - 0.3, EAVE - 0.12, 0.78); // rafter tails
    // snow: the blanket, thicker on the north (lee) plane
    snowBlanket(G, e0, e1, r1, r0, { seed: `${seed}:snow${su}`, th: 0.3 + (R(50 + su) * 0.12), lip: 0.22, droop: 0.32, verge: 0.18 });
  }
  ridgeRoll(G, P(0, zN + 0.15, yR + 0.2), P(0, zS - 0.15, yR + 0.2), { r: 0.3, seed: `${seed}:ridge` });
  for (const sw of [-1, 1]) { // verge boards and purlin heads under the gable eaves
    for (const su of [-1, 1]) quadN(G, 'e07Trim', P(su * uE, sw * (hd + ovG), yE), P(0, sw * (hd + ovG), yR + 0.15), P(0, sw * (hd + ovG), yR - 0.12), P(su * uE, sw * (hd + ovG), yE - 0.27), [F.n[0] * sw, 0, F.n[1] * sw], 0.85);
    for (const u of [-hw * 0.66, 0, hw * 0.66]) {
      const yy = yR - Math.abs(u) * Math.tan(pitch) - 0.45;
      segBox(G, 'e07Trim', F, u - 0.12, u + 0.12, sw > 0 ? hd : -hd - ovG + 0.1, sw > 0 ? hd + ovG - 0.1 : -hd, yy - 0.24, yy, 0.8);
    }
  }
  // the chimney through the north plane, its cap and its snow
  const cu = -hw * 0.35 + R(3) * 0.6, cw = -hd * 0.25;
  const yc = yR - Math.abs(cu) * Math.tan(pitch);
  segBox(G, 'rubble', F, cu - 0.36, cu + 0.36, cw - 0.32, cw + 0.32, EAVE - 0.2, yc + 1.25, 0.8);
  segBox(G, 'dressed', F, cu - 0.44, cu + 0.44, cw - 0.4, cw + 0.4, yc + 1.25, yc + 1.37, 0.75);
  snowMound(G, F, cu - 0.44, cu + 0.44, cw - 0.4, cw + 0.4, yc + 1.37, { th: 0.2, seed: `${seed}:chim` });
  // windows: the gable front (south), the long sides; the back gable is the stable's
  const front = 1;
  const Ff = localFrame(...F.at(0, hd), p.rot ?? 0), Fb = localFrame(...F.at(0, -hd), (p.rot ?? 0) + Math.PI);
  const nW = Math.max(2, Math.round((2 * hw) / 2.6));
  for (let k = 0; k < nW; k++) {
    const u = -hw + (2 * hw * (k + 0.5)) / nW;
    windowBay(G, Ff, u, 1.25, 0.85, 0.75, 0.32, front, { grille: k % 2 === 0, shutters: false });
    windowBay(G, Ff, u, GF + 0.85, 1.0, 0.8, 0.22, front, { closed: (k + Math.round(R(4) * 3)) % 4 === 0 ? 1 : 0 });
  }
  // the Söller across the front at the upper floor, the loft gallery under the gable
  soeller(G, Ff, -hw - 0.2, hw + 0.2, GF + 0.25, 1.05, front, { seed: S % 13, broken: Math.round(R(5) * 20) + 3 });
  soeller(G, Ff, -hw * 0.6, hw * 0.6, EAVE + 0.75, 0.8, front, { seed: S % 7, mat: 'e07Boards' });
  for (const su of [-1, 1]) {
    const Fs = localFrame(...F.at(su * hw, 0), (p.rot ?? 0) - su * Math.PI / 2); // (+w out of the long wall)
    const m = Math.max(1, Math.round((2 * hd) / 3.2));
    for (let k = 0; k < m; k++) {
      const u = -hd + (2 * hd * (k + 0.5)) / m;
      if (su > 0 && Math.abs(u - (hd - 1.6)) < 1.4) continue; // the door's bay
      windowBay(G, Fs, -su * u, 1.3, 0.75, 0.7, 0.3, 1, { grille: true, shutters: false });
      windowBay(G, Fs, -su * u, GF + 0.9, 0.95, 0.75, 0.2, 1, { closed: (k + su + 2) % 3 === 0 ? -1 : 0 });
    }
  }
  // the house door on the east long side under a little shingled hood, its stone step
  {
    const Fd = localFrame(...F.at(hw, hd - 1.6), (p.rot ?? 0) - Math.PI / 2);
    segBox(G, 'door', Fd, -0.55, 0.55, -0.1, 0.02, PL, PL + 2.0, 1);
    segBox(G, 'e07Trim', Fd, -0.68, 0.68, 0.0, 0.08, PL, PL + 2.15, 0.85);
    segBox(G, 'dressed', Fd, -0.8, 0.8, 0.0, 0.55, 0, PL - 0.05, 0.9);
    const Q = (u, w, y) => { const [x, z] = Fd.at(u, w); return [x, y, z]; };
    quadN(G, 'e07Shingle', Q(-0.9, 0.0, PL + 2.65), Q(0.9, 0.0, PL + 2.65), Q(0.9, 0.9, PL + 2.3), Q(-0.9, 0.9, PL + 2.3), [0, 1, 0], 0.9);
    snowBlanket(G, Q(-0.9, 0.9, PL + 2.3), Q(0.9, 0.9, PL + 2.3), Q(0.9, 0.05, PL + 2.65), Q(-0.9, 0.05, PL + 2.65), { seed: `${seed}:hood`, th: 0.16, lip: 0.08, droop: 0.12, verge: 0.06, icicles: 2 });
    for (const s of [-1, 1]) segBox(G, 'e07Trim', Fd, s * 0.8 - 0.05, s * 0.8 + 0.05, 0.75, 0.85, PL, PL + 2.3, 0.85);
  }
  // the stable door in the back gable, a manure heap under snow beside it would be too big: a hay-fork leaning instead
  segBox(G, 'e07Boards', Fb, -0.9, 0.9, -0.04, 0.06, PL, PL + 2.2, 0.8);
  segBox(G, 'iron', Fb, -0.8, 0.8, 0.06, 0.09, PL + 0.5, PL + 0.58, 0.6);
  segBox(G, 'iron', Fb, -0.8, 0.8, 0.06, 0.09, PL + 1.7, PL + 1.78, 0.6);
  // the woodpile under the west eave: split logs stacked to the window sills, end grain out
  {
    const Fw = localFrame(...F.at(-hw, 0), (p.rot ?? 0) + Math.PI / 2);
    const L0 = -hd + 0.8, L1 = hd - 1.0;
    segBox(G, 'bark', Fw, L0, L1, 0.02, 0.7, 0, 1.25, 0.9);
    for (let u = L0 + 0.12, k = 0; u < L1 - 0.1; u += 0.21, k++) for (let y = 0.12, j = 0; y < 1.2; y += 0.2, j++) {
      const [x, z] = Fw.at(u + (j % 2) * 0.08, 0.71);
      const r = 0.07 + 0.03 * ((k * 7 + j * 3) % 4) / 3;
      G.cyl('endgrain', x, y - r, z, r, r, 0.02, 6, 0.85 + 0.1 * ((k + j) % 3), { caps: true });
    }
    snowMound(G, Fw, L0, L1, 0.0, 0.74, 1.25, { th: 0.14, seed: `${seed}:wood`, n: 8 });
  }
  // a bench by the door, a hand sledge leaning on the front wall
  {
    const Fb2 = localFrame(...F.at(hw + 0.35, hd - 3.3), (p.rot ?? 0) + Math.PI / 2);
    segBox(G, 'e07Trim', Fb2, -0.8, 0.8, -0.15, 0.15, 0.42, 0.48, 0.9);
    for (const s of [-0.7, 0.7]) segBox(G, 'e07Trim', Fb2, s - 0.05, s + 0.05, -0.12, 0.12, 0, 0.42, 0.85);
    const Fs = localFrame(...F.at(hw * 0.55, hd + 0.18), p.rot ?? 0);
    for (const s of [-0.22, 0.22]) {
      const a = Fs.at(s, 0.35), b = Fs.at(s, 0.02);
      G.quad('e07Trim', [a[0] - 0.02, 0.02, a[1]], [a[0] + 0.02, 0.02, a[1]], [b[0] + 0.02, 1.3, b[1]], [b[0] - 0.02, 1.3, b[1]], 0.8);
    }
  }
  // snow drifted against the windward (north) gable, dug out before the stable door (its leaves: u ±0.9 of Fb)
  const Fn = localFrame(...F.at(0, -hd - 0.12), (p.rot ?? 0) + Math.PI);
  wallDrift(G, Fn, -hw, hw, 0, 1, { h: 0.7, depth: 1.0, seed: `${seed}:dn`, clear: [[-1.35, 1.35]] });
  return { ridgeY: yR, eaveY: EAVE };
}

// ---------------------------------------------------------------- the chapel
/** Lathe of `prof` ([r, y] bottom → top) about (x, z), `seg` sides, finish `mat`; snow on its upper shoulders. */
function lathe(G, mat, x, z, prof, seg = 14, tone = 1) {
  for (let k = 0; k + 1 < prof.length; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[k + 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p00 = [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], p10 = [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0];
      const p01 = [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], p11 = [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1];
      const n = norm([Math.cos(am), (r0 - r1) / Math.max(1e-3, y1 - y0) * 0.6, Math.sin(am)]);
      if (r0 < 1e-4) triN(G, mat, p00, p11, p01, n, tone);
      else if (r1 < 1e-4) triN(G, mat, p00, p10, p01, n, tone);
      else quadN(G, mat, p00, p10, p11, p01, n, /Snow$/.test(mat) ? tone : tone * (0.97 + 0.03 * (i % 2))); // (snow: no checker of tones)
    }
  }
}

/** A Tyrolean wayside chapel over (x, z, w × d): nave with an apse to the north, the tower at the south gable. */
export function onionChapel(G, p) {
  const F = localFrame(p.x, p.z, p.rot ?? 0), hw = p.w / 2 - 0.25, hd = p.d / 2 - 0.1, seed = p.seed ?? 'chapel';
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  const towerD = 2.4, n0 = -hd + 0.9, n1 = hd - towerD, WALL = 4.0, pitch = Math.PI / 4.2;
  // the nave: plinth, whitewash, the roof
  segBox(G, 'rubble', F, -hw - 0.08, hw + 0.08, n0 - 0.08, n1, 0, 0.45, 0.85);
  segBox(G, 'e07Whitewash', F, -hw, hw, n0, n1, 0.45, WALL, 1.02);
  const yR = WALL + hw * Math.tan(pitch);
  triN(G, 'e07Whitewash', P(-hw, n1, WALL), P(hw, n1, WALL), P(0, n1, yR + 0.05), [F.n[0], 0, F.n[1]], 1.02); // the south gable
  for (const su of [-1, 1]) { // the nave's eave sides
    const e0 = P(su * (hw + 0.45), n0 - 0.3, WALL - 0.45 * Math.tan(pitch)), e1 = P(su * (hw + 0.45), n1 + 0.2, WALL - 0.45 * Math.tan(pitch));
    const r1 = P(0, n1 + 0.2, yR + 0.1), r0 = P(0, n0 - 0.3, yR + 0.1);
    const n = norm(cross(sub(e1, e0), sub(r0, e0))), nn = n[1] < 0 ? mul(n, -1) : n;
    quadN(G, 'e07Shingle', e0, e1, r1, r0, nn, 0.95);
    quadN(G, 'e07Trim', add(e0, [0, -0.1, 0]), add(e1, [0, -0.1, 0]), add(r1, [0, -0.1, 0]), add(r0, [0, -0.1, 0]), mul(nn, -1), 0.6);
    snowBlanket(G, e0, e1, r1, r0, { seed: `${seed}:snow${su}`, th: 0.26, lip: 0.16, droop: 0.24, verge: 0.12 });
  }
  ridgeRoll(G, P(0, n0 - 0.15, yR + 0.12), P(0, n1, yR + 0.12), { r: 0.24, seed: `${seed}:ridge` });
  // the apse: a half-octagon at the north end under its own hipped roof
  {
    const c = F.at(0, n0), r = hw, segs = 4;
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI + (i / segs) * Math.PI, a1 = Math.PI + ((i + 1) / segs) * Math.PI;
      const A0 = F.at(Math.cos(a0) * r, n0 + Math.sin(a0) * r * 0.7), A1 = F.at(Math.cos(a1) * r, n0 + Math.sin(a1) * r * 0.7);
      const out = norm([(A0[0] + A1[0]) / 2 - c[0], 0, (A0[1] + A1[1]) / 2 - c[1]]);
      quadN(G, 'e07Whitewash', [A0[0], 0.45, A0[1]], [A1[0], 0.45, A1[1]], [A1[0], WALL, A1[1]], [A0[0], WALL, A0[1]], out, 1.0);
      quadN(G, 'rubble', [A0[0], 0, A0[1]], [A1[0], 0, A1[1]], [A1[0], 0.45, A1[1]], [A0[0], 0.45, A0[1]], out, 0.85);
      const top = [c[0], yR + 0.05, c[1]];
      const B0 = F.at(Math.cos(a0) * (r + 0.4), n0 + Math.sin(a0) * (r + 0.4) * 0.7), B1 = F.at(Math.cos(a1) * (r + 0.4), n0 + Math.sin(a1) * (r + 0.4) * 0.7);
      triN(G, 'e07Shingle', [B0[0], WALL - 0.3, B0[1]], [B1[0], WALL - 0.3, B1[1]], top, norm(add(out, [0, 1.2, 0])), 0.92);
      triN(G, 'e07RoofSnow', [B0[0] * 0.92 + top[0] * 0.08, WALL - 0.08, B0[1] * 0.92 + top[2] * 0.08], [B1[0] * 0.92 + top[0] * 0.08, WALL - 0.08, B1[1] * 0.92 + top[2] * 0.08], [top[0], yR + 0.32, top[2]], norm(add(out, [0, 1.2, 0])), 1.03);
    }
  }
  // arched windows along the nave
  for (const su of [-1, 1]) {
    const Fs = localFrame(...F.at(su * hw, 0), (p.rot ?? 0) - su * Math.PI / 2);
    for (const u of [n0 + 1.2, (n0 + n1) / 2 + 0.3]) {
      const uu = -su * u;
      segBox(G, 'e07Glass', Fs, uu - 0.32, uu + 0.32, -0.2, 0.02, 1.6, 2.9, 0.8);
      for (let k = 0; k < 6; k++) { const a0 = (k / 6) * Math.PI, a1 = ((k + 1) / 6) * Math.PI; segBox(G, 'e07Glass', Fs, uu - 0.32 * Math.cos(a0), uu - 0.32 * Math.cos(a1), -0.2, 0.02, 2.9, 2.9 + 0.32 * Math.sin((a0 + a1) / 2), 0.8); }
      segBox(G, 'dressed', Fs, uu - 0.42, uu + 0.42, 0, 0.06, 1.5, 1.6, 0.9);
    }
  }
  // the tower at the south gable: whitewash, corner quoins in grey, the belfry, the onion
  const tw = 1.25, tc = F.at(0, hd - towerD / 2), TH = 7.6;
  const Ft = localFrame(tc[0], tc[1], p.rot ?? 0);
  segBox(G, 'rubble', Ft, -tw - 0.08, tw + 0.08, -tw - 0.08, tw + 0.08, 0, 0.5, 0.85);
  segBox(G, 'e07Whitewash', Ft, -tw, tw, -tw, tw, 0.5, TH, 1.04);
  for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (let y = 0.6, k = 0; y < TH - 0.3; y += 0.45, k++) {
    const l = k % 2 ? 0.28 : 0.45;
    segBox(G, 'e07Concrete', Ft, su > 0 ? tw - l : -tw - 0.02, su > 0 ? tw + 0.02 : -tw + l, sw > 0 ? tw - 0.2 : -tw - 0.02, sw > 0 ? tw + 0.02 : -tw + 0.2, y, y + 0.4, 0.95);
  }
  for (const r of [0, 1, 2, 3]) { // belfry openings
    const Fo = localFrame(...Ft.at(...[[0, tw], [tw, 0], [0, -tw], [-tw, 0]][r]), (p.rot ?? 0) + [0, -Math.PI / 2, Math.PI, Math.PI / 2][r]);
    segBox(G, 'e07Glass', Fo, -0.35, 0.35, -0.3, 0.02, 5.6, 6.6, 0.3);
    for (let k = 0; k < 5; k++) { const a0 = (k / 5) * Math.PI, a1 = ((k + 1) / 5) * Math.PI; segBox(G, 'e07Glass', Fo, -0.35 * Math.cos(a0), -0.35 * Math.cos(a1), -0.3, 0.02, 6.6, 6.6 + 0.35 * Math.sin((a0 + a1) / 2), 0.3); }
  }
  segBox(G, 'e07Trim', Ft, -tw - 0.15, tw + 0.15, -tw - 0.15, tw + 0.15, TH, TH + 0.18, 0.85); // cornice
  // the onion: shingled, a neck, the bulb, the lantern spike, the cross
  const [cx, cz] = tc, b = TH + 0.18;
  lathe(G, 'e07Shingle', cx, cz, [[tw + 0.12, b], [tw * 0.95, b + 0.35], [tw * 0.7, b + 0.6], [tw * 0.78, b + 0.85], [tw * 1.08, b + 1.25], [tw * 1.15, b + 1.6], [tw * 0.98, b + 2.0], [tw * 0.6, b + 2.35], [tw * 0.22, b + 2.7], [0.1, b + 3.05], [0.1, b + 3.4], [0, b + 3.5]], 14, 0.9);
  lathe(G, 'e07RoofSnow', cx, cz, [[tw * 1.12, b + 1.75], [tw * 1.0, b + 2.05], [tw * 0.64, b + 2.4], [tw * 0.26, b + 2.75], [0.12, b + 2.98]], 14, 1.03);
  lathe(G, 'e07RoofSnow', cx, cz, [[tw + 0.17, b + 0.02], [tw * 0.98, b + 0.4], [tw * 0.74, b + 0.62]], 14, 1.0);
  segBox(G, 'iron', localFrame(cx, cz, p.rot ?? 0), -0.03, 0.03, -0.03, 0.03, b + 3.4, b + 4.4, 0.6);
  segBox(G, 'iron', localFrame(cx, cz, p.rot ?? 0), -0.26, 0.26, -0.03, 0.03, b + 4.0, b + 4.07, 0.6);
  // the door in the tower's south face, two steps
  const Fd = localFrame(...Ft.at(0, tw), p.rot ?? 0);
  segBox(G, 'door', Fd, -0.45, 0.45, -0.1, 0.02, 0.5, 2.3, 0.9);
  for (let k = 0; k < 4; k++) { const a0 = (k / 4) * Math.PI, a1 = ((k + 1) / 4) * Math.PI; segBox(G, 'door', Fd, -0.45 * Math.cos(a0), -0.45 * Math.cos(a1), -0.1, 0.02, 2.3, 2.3 + 0.45 * Math.sin((a0 + a1) / 2), 0.9); }
  segBox(G, 'dressed', Fd, -0.7, 0.7, 0, 0.5, 0, 0.25, 0.9);
  segBox(G, 'dressed', Fd, -0.6, 0.6, 0, 0.28, 0.25, 0.48, 0.9);
  wallDrift(G, localFrame(...F.at(0, n0 - 0.05), (p.rot ?? 0) + Math.PI), -hw, hw, 0, 1, { h: 0.55, depth: 0.9, seed: `${seed}:dn` });
}

// ---------------------------------------------------------------- the hay barn
/** A log hay barn (Stadel) over (x, z, w × d, rot): rubble piers, log walls with gaps, a board gable, the big doors. */
export function stadel(G, p) {
  const F = localFrame(p.x, p.z, p.rot ?? 0), hw = p.w / 2 - 0.15, hd = p.d / 2 - 0.15, seed = p.seed ?? 'stadel';
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  const PIER = 0.7, EAVE = 4.2, pitch = Math.PI / 7.5, ov = 0.8;
  for (const u of [-hw + 0.3, 0, hw - 0.3]) for (const w of [-hd + 0.3, hd - 0.3]) segBox(G, 'rubble', F, u - 0.35, u + 0.35, w - 0.35, w + 0.35, 0, PIER, 0.85);
  segBox(G, 'e07Trim', F, -hw, hw, -hd, hd, PIER, PIER + 0.22, 0.8);
  for (let y = PIER + 0.22, k = 0; y < EAVE - 0.1; y += 0.3, k++) { // the logs, a dark gap above each
    segBox(G, 'e07LogsOld', F, -hw, hw, -hd, hd, y, y + 0.24, 0.9 + 0.08 * (k % 2));
    segBox(G, 'e07Glass', F, -hw + 0.04, hw - 0.04, -hd + 0.04, hd - 0.04, y + 0.235, y + 0.305, 0.25);
  }
  const yR = EAVE + hd * Math.tan(pitch);
  for (const su of [-1, 1]) { // gables of boards
    const u = su * hw;
    for (let w = -hd + 0.1, k = 0; w < hd - 0.05; w += 0.24, k++) {
      const top = yR - Math.abs(w) * Math.tan(pitch) - 0.04;
      segBox(G, 'e07Boards', F, su > 0 ? u - 0.05 : u - 0.01, su > 0 ? u + 0.01 : u + 0.05, w, w + 0.22, EAVE, top, 0.84 + 0.1 * (k % 2));
    }
  }
  // the double door on the long south side
  const Fd = localFrame(...F.at(0, hd), p.rot ?? 0);
  segBox(G, 'e07Boards', Fd, -1.3, 1.3, -0.02, 0.06, PIER + 0.22, PIER + 2.6, 0.78);
  segBox(G, 'iron', Fd, -0.04, 0.04, 0.06, 0.09, PIER + 0.3, PIER + 2.5, 0.5);
  for (const sw of [-1, 1]) {
    const e0 = P(-hw - ov, sw * (hd + ov), EAVE - ov * Math.tan(pitch)), e1 = P(hw + ov, sw * (hd + ov), EAVE - ov * Math.tan(pitch));
    const r1 = P(hw + ov, 0, yR + 0.08), r0 = P(-hw - ov, 0, yR + 0.08);
    const n = norm(cross(sub(e1, e0), sub(r0, e0))), nn = n[1] < 0 ? mul(n, -1) : n;
    quadN(G, 'e07Shingle', e0, e1, r1, r0, nn, 0.9);
    quadN(G, 'e07Trim', add(e0, [0, -0.1, 0]), add(e1, [0, -0.1, 0]), add(r1, [0, -0.1, 0]), add(r0, [0, -0.1, 0]), mul(nn, -1), 0.6);
    snowBlanket(G, e0, e1, r1, r0, { seed: `${seed}:snow${sw}`, th: 0.34, lip: 0.24, droop: 0.34, verge: 0.16 });
  }
  ridgeRoll(G, P(-hw - ov + 0.15, 0, yR + 0.12), P(hw + ov - 0.15, 0, yR + 0.12), { r: 0.3, seed: `${seed}:ridge` });
  wallDrift(G, localFrame(...F.at(0, -hd), (p.rot ?? 0) + Math.PI), -hw, hw, 0, 1, { h: 0.7, depth: 1.2, seed: `${seed}:dn` });
}

// ---------------------------------------------------------------- the ridge: the face and the cornice
/**
 * The granite face from the foot line (y 0) to the rim line (y h), stations along z. The relief cuts into the rock:
 * gullies and chimneys between buttresses, benches every few metres (snow ledges), vertical jointing; nothing ever
 * stands west of the foot line (the walkable snow), and the rim row stays on the rim (the men stand at its lip).
 * @param {(z:number)=>number} footX @param {(z:number)=>number} rimX
 * @param {{z0:number, z1:number, h:number, n?:number, rows?:number, seed?:string, gullies?:number[][]}} o
 *   gullies: [z, halfWidth, depth] cut into the rock
 * @returns {THREE.BufferGeometry}
 */
export function ridgeFaceGeometry(footX, rimX, o) { return runSync(ridgeFaceGeometryG(footX, rimX, o)); }
/** ridgeFaceGeometry, sliced (engine/slice.js): the same geometry, its columns built a few dozen at a time. */
export function* ridgeFaceGeometryG(footX, rimX, o) {
  const { z0, z1 } = o, n = o.n ?? 220, rows = o.rows ?? 46;
  const X = ridgeFaceX(footX, rimX, o);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    if (i % 40 === 39 && due()) yield;
    const z = lerp(z0, z1, i / n);
    let slope = 0, prev = null;
    for (let r = 0; r <= rows + 1; r++) {
      // (the last row: the face's lip curled 0.3 m onto the plateau, 2 cm over its snow, covering the plateau's edge)
      const { x, y } = r <= rows ? X(z, r / rows) : { x: rimX(z) + 0.32, y: o.h + 0.02 };
      if (prev) slope += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
      pos.push(x, y, z); uv.push(z / 4, slope / 4);
    }
  }
  const W = rows + 2;
  for (let i = 0; i < n; i++) for (let r = 0; r < rows + 1; r++) {
    const a = i * W + r, b = (i + 1) * W + r;
    idx.push(a, b, a + 1, b, b + 1, a + 1); // (faces west: -x)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal');
  let sx = 0; for (let k = 0; k < nrm.count; k += 7) sx += nrm.getX(k);
  if (sx > 0) { geo.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); geo.computeVertexNormals(); }
  return geo;
}

/**
 * The face's surface as a function: (z, u = height fraction) → { x, y }. Relief into the rock only: vertical jointing,
 * big blocks, couloirs, and a few benches that wander in height and break off along the face (never one straight band).
 */
export function ridgeFaceX(footX, rimX, o) {
  const h = o.h, s = seedOf(o.seed ?? 'ridge') & 0xffff, gul = o.gullies ?? [];
  const benchY = [3.4, 7.1, 11.8, 15.6, 19.9, 23.8, 27.0];
  return (z, u) => {
    const y = h * u, fx = footX(z), rx = rimX(z);
    const env = Math.sin(Math.PI * Math.min(1, u * 1.02)) ** 0.7; // no relief on the foot and rim rows
    let x = lerp(fx, rx, Math.pow(u, 0.86));
    const joint = f01(fbm(z * 0.34, y * 0.04, 0.5, s, 4));
    const block = f01(fbm(z * 0.085, y * 0.09, 1.7, s + 3, 3));
    let d = (1.6 * joint + 1.5 * block - 1.25) * env;
    for (const [gz, gw, gd] of gul) d += gd * Math.exp(-(((z - gz) / gw) ** 2)) * env * (0.6 + 0.4 * Math.sin(u * 2.6 + gz));
    benchY.forEach((b0, k) => {
      const by = b0 + 2.2 * fbm(z * 0.022, k * 1.7, 0.3, s + 20 + k, 2);
      const on = smooth((f01(fbm(z * 0.05, k * 2.3, 1.1, s + 40 + k, 2)) - 0.48) * 5);
      const t = (y - by) / 0.75;
      if (on > 0 && t > -1 && t < 1) d += 0.65 * (1 - Math.abs(t)) * on * (0.5 + block) * env;
    });
    d += 0.25 * fbm(z * 1.1, y * 0.9, 3.3, s + 7, 2) * env;
    d = Math.max(0, d); // never out over the foot
    const yy = u > 0 && u < 1 ? y + 0.3 * fbm(z * 0.7, y * 0.2, 4.1, s + 9, 2) * env : y;
    return { x: x + d, y: yy };
  };
}

/**
 * The face as drawn: (z, u) → {x, y} on ridgeFaceGeometry's own triangles (the same columns, rows and diagonals), not on
 * the smooth function they sample — the face's relief at about a metre is finer than its 0.9 m columns, so what is laid
 * on the face (its snow) has to follow the triangles to lie on the rock and not hover off it or sink into it.
 * @param {(z:number)=>number} footX @param {(z:number)=>number} rimX
 * @param {{z0:number, z1:number, h:number, n?:number, rows?:number, seed?:string, gullies?:number[][]}} o (as ridgeFaceGeometry)
 * @returns {(z:number, u:number) => {x:number, y:number}}
 */
export function faceSurface(footX, rimX, o) {
  const X = ridgeFaceX(footX, rimX, o), n = o.n ?? 220, rows = o.rows ?? 46, { z0, z1 } = o, memo = new Map();
  const V = (i, r) => { const key = i * 4096 + r; let v = memo.get(key); if (!v) memo.set(key, (v = X(lerp(z0, z1, i / n), r / rows))); return v; };
  return (z, u) => {
    const fi = Math.min(n - 1e-9, Math.max(0, ((z - z0) / (z1 - z0)) * n)), fr = Math.min(rows - 1e-9, Math.max(0, u * rows));
    const i = Math.floor(fi), r = Math.floor(fr), s = fi - i, t = fr - r;
    const a = V(i, r), b = V(i + 1, r), a1 = V(i, r + 1), b1 = V(i + 1, r + 1);
    // (each quad is split along (i+1, r)–(i, r+1), as the face's index runs)
    if (s + t <= 1) return { x: a.x + s * (b.x - a.x) + t * (a1.x - a.x), y: a.y + s * (b.y - a.y) + t * (a1.y - a.y) };
    return { x: b1.x + (1 - s) * (a1.x - b1.x) + (1 - t) * (b.x - b1.x), y: b1.y + (1 - s) * (a1.y - b1.y) + (1 - t) * (b.y - b1.y) };
  };
}

/**
 * The snow's light terms at a corner, e07-snow's `e07` attribute: [ao, shade, wrap] — its sky occlusion (× the ground
 * material's own AO), a bluish darkening of its albedo (the wind scoop's tint: 0 none, < 0 a shade lighter), and how far
 * its light wraps round towards the sun where it stands steep (× the material's wrap). E_NONE draws it as the ground
 * draws its snow (the drift and the fans of round 11).
 */
export const E_NONE = Object.freeze([1, 0, 1]);
/**
 * A triangle wound along `n` with the snow's own surface coordinates at its corners (metres: [along its section, along
 * the face]; e07-snow reads the ground's look on them) and its light terms (`ea`, `eb`, `ec`: E_NONE when left out),
 * kept beside the Geo's own arrays (`G.parts.get(mat).e`, three a corner: e07-dressing's snow build reads them).
 * A triangle whose side has collapsed (a cap's last station, a row with no apron) is left out.
 */
function triU(G, mat, a, b, c, ua, ub, uc, n, tone = 1, ea = E_NONE, eb = E_NONE, ec = E_NONE) {
  const f = cross(sub(b, a), sub(c, a));
  if (len(f) < 1e-12) return;
  const A = G._arr(mat), E = A.e ?? (A.e = []);
  // (a part drawn before without its terms — another finish's caller — gets the plain ones, so the two stay in step)
  for (let k = E.length; k < A.pos.length; k++) E.push(E_NONE[k % 3]);
  const [p, q] = dot(f, n) >= 0 ? [eb, ec] : [ec, eb];
  if (dot(f, n) >= 0) G.tri(mat, a, b, c, tone, [ua, ub, uc]); else G.tri(mat, a, c, b, tone, [ua, uc, ub]);
  E.push(ea[0], ea[1], ea[2], p[0], p[1], p[2], q[0], q[1], q[2]);
}
/** quadN with the surface coordinates (triU) and the corners' light terms: a collapsed side leaves its one triangle. */
function quadU(G, mat, a, b, c, d, ua, ub, uc, ud, n, tone = 1, ea = E_NONE, eb = E_NONE, ec = E_NONE, ed = E_NONE) {
  triU(G, mat, a, b, c, ua, ub, uc, n, tone, ea, eb, ec);
  triU(G, mat, a, c, d, ua, uc, ud, n, tone, ea, ec, ed);
}

/** The unit icosahedron (12 corners, 20 faces) and once subdivided (42, 80): the clods' starting balls. */
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const V2 = V.slice(), F2 = [], mid = new Map();
  const m = (a, b) => { const k = Math.min(a, b) * 64 + Math.max(a, b); let i = mid.get(k); if (i === undefined) { i = V2.length; V2.push(norm(add(V[a], V[b]))); mid.set(k, i); } return i; };
  for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  return { lo: { V, F }, hi: { V: V2, F: F2 } };
})();

/**
 * A clod of snow — a sluff's debris, a lump fallen at the face's foot: a lumpy ball (an icosahedron, subdivided once
 * from 12 cm, every corner pushed in or out by lumps at two scales), settled flatter underneath, squashed, turned and
 * tipped — or, with `ball`, a rounder snowball rolled down the fan (smaller lumps, little squash). Closed, curved, no flat
 * face and no straight edge: its corners share the snow's soft normals (e07-dressing), each face its own coordinates on
 * its plane; what lies well under the snow it is sunk in is left out. Its lower half in its own shade (the `e07` light
 * terms: the sky it cannot see), its tone its own (`tone`: the shade term, ± a few %).
 */
function clod(G, mat, c, rx, ry, rz, seed, rot, tilt = 0, { ball = false, tone = 0 } = {}) {
  const { V, F } = Math.max(rx, rz) >= 0.12 ? ICO.hi : ICO.lo, s = (seed >>> 0) % 9973;
  const a1 = ball ? 0.06 : 0.3, a2 = ball ? 0.025 : 0.13, o1 = (s % 97) * 0.37, o2 = (s % 89) * 0.53;
  const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
  const P = V.map(([x, y, z]) => {
    // (two scales of lumps over the ball; settled: its underside drawn in flatter)
    const k = 1 + a1 * fbm(x * 1.5 + o1, y * 1.5, z * 1.5 - o2, s, 2) + a2 * fbm(x * 3.2 - o2, y * 3.2 + o1, z * 3.2, s + 7, 1);
    const X = x * rx * k, Y = y * ry * k * (y < 0 ? 0.78 : 1), Z = z * rz * k;
    const x1 = X * ct + Y * st, y1 = Y * ct - X * st;
    return [c[0] + x1 * cr - Z * sr, c[1] + y1, c[2] + x1 * sr + Z * cr];
  });
  // (the sky a corner sees: its underside, sunk against the snow, in shade; the top open)
  const E = V.map(([, y]) => [0.56 + 0.44 * smooth((y + 0.75) / 1.45), tone, 1]);
  for (const [a, b, d] of F) {
    if (V[a][1] < -0.6 && V[b][1] < -0.6 && V[d][1] < -0.6) continue; // (well under the snow it is sunk in)
    const pa = P[a], pb = P[b], pd = P[d], out = sub(mul(add(add(pa, pb), pd), 1 / 3), c);
    const n = cross(sub(pb, pa), sub(pd, pa)), ax = Math.abs(n[1]) >= Math.abs(n[0]) && Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : 2;
    const uv = (p) => (ax === 1 ? [p[0], p[2]] : ax === 0 ? [p[1] + 50, p[2]] : [p[0], p[1] + 50]);
    triU(G, mat, pa, pb, pd, uv(pa), uv(pb), uv(pd), out, 1, E[a], E[b], E[d]);
  }
}

/**
 * A ledge pillow's light round its section (its seven points: the back against the rock above, the top, the crest, the
 * front, the lip, the underside, back into the rock), as [ao, shade, wrap] (E_NONE's terms): the top open to the sky and
 * its light its own (no wrap: a level snowfield's sky), the front a little wrapped towards the sun, the lip and the
 * underside in the shade of the pillow itself, the back where it meets the rock in the rock's — so a pillow is a lit mound
 * over a shaded lip, not one flat tone. `tone` (its own shade term), `lump` 0…1 (a lump's crown sees more sky), `sag`
 * 0…1 (a drip's sag hangs in its own shade), `e` 0…1 (towards a cap the section closes into the rock: less sky).
 */
const PILLOW_AO = [0.84, 1.06, 1.06, 0.8, 0.56, 0.42, 0.36];
const PILLOW_WRAP = [0, 0, 0.08, 0.36, 0.14, 0, 0];
const PILLOW_SHADE = [0, -0.05, -0.04, 0.04, 0.09, 0.11, 0.1]; // (fresh and lighter on top, bluer in the shade under it)
function pillowLight(tone, lump, sag, e) {
  return PILLOW_AO.map((ao, j) => {
    let a = ao;
    if (j === 1 || j === 2) a = Math.min(1.1, a + 0.05 * lump);
    if (j === 3 || j === 4) a *= 1 - 0.22 * sag;
    return [a * (0.6 + 0.4 * e), tone + PILLOW_SHADE[j], PILLOW_WRAP[j]];
  });
}
/** A pillow's own tone (the shade term): from 4 % lighter to 12 % bluer and darker, most near the middle. */
function LEDGE_TONE(seed) {
  let q = (seed >>> 0) || 1;
  const r = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
  return -0.04 + 0.16 * (r() + r()) / 2;
}

/** Is the clod of seed `sd` a snowball (the share `p` of them)? Its own hash: the random streams stay as they were. */
const clodKind = (sd, p) => ((Math.imul(sd >>> 0, 2654435761) >>> 8) % 1000) / 1000 < p;
/** A clod's tone (its shade term): ±3.5 % about the snow's own. */
const clodTone = (sd) => (((Math.imul((sd >>> 0) ^ 0x9e37, 2246822519) >>> 8) % 1000) / 1000 - 0.5) * 0.07;
/**
 * A clod's height and depth from its width `rx` and two draws (`f1`, `f2`: the streams' own): a lump squashed to 45-75 %
 * of its width, a snowball nearly round; and its reach, the furthest its lumps stand out from its centre across the
 * ground, tipped and turned (the bound the callers keep the walkable edge clear by).
 */
function clodSize(rx, f1, f2, ball) {
  const ry = rx * (ball ? 0.84 + 0.12 * f1 : 0.45 + 0.3 * f1), rz = rx * (ball ? 0.9 + 0.18 * f2 : 0.7 + 0.5 * f2);
  return { ry, rz, reach: (ball ? 1.09 : 1.43) * Math.max(Math.hypot(rx, ry), rz) };
}
/** The spill's stations across it, as fractions of its reach from its toe (the drift's own toe at 1). */
const SPILL_S = [0, 0.07, 0.25, 0.5, 0.75, 0.92];
/**
 * The face's foot as built (faceSnowG's `footOut`: its rows every 0.25 m along the face, each from the spill's toe up
 * the drift), as a height: the top of the foot's snow at (x, z) — the spill, the apron or the drift —, or -Infinity
 * where it has none (past its toe, over its crest); between rows, the two rows' heights blended along z.
 * @param {{z0:number, dz:number, rows:number[][][]}} F @returns {(x:number, z:number) => number}
 */
export function footSurfaceAt(F) {
  const rowAt = (row, x) => {
    for (let j = 0; j + 1 < row.length; j++) {
      const [x0, y0] = row[j], [x1, y1] = row[j + 1];
      if (x1 - x0 > 1e-6 && x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return -Infinity;
  };
  return (x, z) => {
    const f = (z - F.z0) / F.dz, i = Math.floor(f), t = f - i;
    if (i < 0 || i + 1 >= F.rows.length) return -Infinity;
    const a = rowAt(F.rows[i], x), b = rowAt(F.rows[i + 1], x);
    if (a === -Infinity || b === -Infinity) return Math.max(a, b);
    return a + (b - a) * t;
  };
}

/** faceSnowG run straight through (tools, tests). */
export function faceSnow(G, footX, rimX, o) { return runSync(faceSnowG(G, footX, rimX, o)); }

/**
 * Snow lying on the face, on its drawn triangles (faceSurface), every triangle with the snow's own surface coordinates
 * (metres round its section and along the face: e07-snow draws the ground's snow on them, its texture standing on a
 * pillow's front and a fan's steep face as it lies on the snowfield):
 *  - on the ledges, runs of snow broken where the rock shows through (a gap of 0.2-0.7 m every 0.9-3.2 m), each run a
 *    pillow following its stratum (dipping, jogging) and rounded off at both ends (the whole section shrinks into the
 *    rock over its last 0.15-0.5 m: a cap, never a knife point). Along a run the snow swells and necks at 0.5-2 m (its
 *    thickness and its lip's reach off the rock each on their own noise), with one to three lumps on it, and its lip
 *    sags over the edge in drips every 0.25-0.7 m; a ledge's snow is thick or thin as a whole. Its section leans on the
 *    rock behind, runs over a crest and a shoulder to the lip and back under it into the rock;
 *  - over the face's foot, a drift no steeper than a drift stands (the face is plumb over the walkable edge, and the
 *    drift's toe never crosses that edge): stretches banked into a fillet, others scoured, and through the scoured ones
 *    pillows of 1-3 m with the bare rock between (no long run of clean crease); its crest's height wanders at a metre or
 *    two. Under each couloir a lopsided sluff fan, its top smoothed along the face (no single row's spike) and ragged at
 *    0.3-1 m, runnels down it, angular debris half sunk in its lower slope and its coarsest along its toe (the rock's
 *    foot row holds the toe itself to the walkable edge); it spills out over the walkable snow as a low apron (a few
 *    centimetres, never more than `apronT` + 3.5 cm) whose toe runs out in lobes and dives under the ground's snow, on
 *    the drawn ground (`ground`) — none where `apronOK` is 0 (the tarn's own snow);
 *  - on the rock's toe, snow plastered in patches up to 1.3 m high with small ones between (its outline ragged at
 *    0.3 m, the skin 2.5-7 cm thick with lumps and banked out at its foot, running into the rock at its edges and down
 *    under the ground), none behind a fan over 1 m;
 *  - clumps of snow fallen at the foot, angular, every 1.5-4.5 m in ones and twos.
 * Drawn in the map's own ground snow on the surface coordinates (e07-dressing) with soft normals; the chunks in their
 * own finish (`chunkMat`), not smoothed. `part` 'ledges' or 'foot' draws only that half (the same triangles: the ledges'
 * random stream and the foot's are their own), so a sliced load can build them as two meshes; sliced (engine/slice.js).
 * @param {object} o ridgeFaceGeometry's options (+ ledges, skip: [z0, z1] couloirs kept bare, part, ground(x, z),
 *   apronOK(x, z), chunkMat, plaster: [z0, z1]; G2 + split: z from which the triangles go to the second Geo `G2`)
 */
export function* faceSnowG(G, footX, rimX, o) {
  const S = faceSurface(footX, rimX, o), s = seedOf((o.seed ?? 'ridge') + ':snow') >>> 0, h = o.h, sf = s & 0xffff;
  const mat = 'e07Snow', chunkMat = o.chunkMat ?? 'e07SnowChunk';
  // (`G2`: what lies south of z `split` goes there — two meshes, each built in a slice of its own)
  const at = (z) => (o.G2 && z >= o.split ? o.G2 : G);
  let q = s;
  const rnd = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
  // ---- the ledges
  const guide = [[-0.3, 1, 0], [-0.5, 1, 0], [-1, 0.6, 0], [-1, -0.2, 0], [-0.6, -1, 0], [-0.2, -1, 0]];
  const bump = (x, B) => { let v = 0; for (const [c, w, a] of B) v += a * Math.exp(-(((x - c) / w) ** 2)); return v; };
  for (let k = 0; k < (o.part === 'foot' ? 0 : o.ledges ?? 46); k++) {
    const za = lerp(o.z0 + 4, o.z1 - 4, rnd()), L = 2 + rnd() * 7, u = 0.15 + rnd() * 0.78, cap = 0.3 + 0.25 * rnd();
    if ((o.skip ?? []).some(([a, b]) => za + L > a && za < b)) continue;
    const dip = ((rnd() - 0.5) * 0.05) / L, kink = rnd() * L, Gk = at(za + L / 2);
    // (this ledge's own stream: its breaks, lumps and drips; the ledges stand where round 10 put them)
    let qk = (seedOf(`${o.seed ?? 'ridge'}:ledge${k}`) >>> 0) || 1;
    const rk = () => ((qk = (qk * 1664525 + 1013904223) >>> 0) / 4294967296);
    const base = 0.75 + 0.5 * rk();
    const runs = [];
    for (let t = rk() * 0.3; t < L - 0.45;) {
      const ln = Math.min(L - t, 0.9 + 2.3 * rk());
      if (ln >= 0.45) runs.push([t, t + ln]);
      t += ln + 0.2 + 0.5 * rk();
    }
    for (const [r0, r1] of runs) {
      const Ls = r1 - r0, capS = Math.min(cap * (0.55 + 0.45 * rk()), Ls * 0.42), n = Math.max(8, Math.ceil(Ls * 9.5));
      const lumps = [], drips = [];
      for (let i = 0, m = 1 + Math.floor(rk() * 2.6); i < m; i++) lumps.push([r0 + capS + rk() * Math.max(0, Ls - 2 * capS), 0.16 + 0.26 * rk(), 0.3 + 0.6 * rk()]);
      for (let i = 0, m = Math.floor(Ls * (0.4 + 0.5 * rk())); i < m; i++) lumps.push([r0 + capS + rk() * Math.max(0, Ls - 2 * capS), 0.12 + 0.12 * rk(), -0.35 * rk()]);
      for (let t = r0 + capS * 0.6 + rk() * 0.3; t < r1 - capS * 0.6; t += 0.25 + 0.45 * rk()) drips.push([t, 0.12 + 0.12 * rk(), 0.05 + 0.13 * rk()]);
      // (each pillow its own tone: a shade bluer or a shade lighter than its neighbours; from a stream of its own, so the
      // ledges stand where round 11 put them)
      const tone = LEDGE_TONE(seedOf(`${o.seed ?? 'ridge'}:pillow${k}:${r0.toFixed(2)}`));
      const rows = [], us = [], es = [], sh = [];
      for (let i = 0; i <= n; i++) {
        // (stations closer towards the ends: the caps are rounded, not cut)
        const zr = (Ls * (1 - Math.cos((Math.PI * i) / n))) / 2, zl = r0 + zr, z = za + zl, de = Math.min(zr, Ls - zr);
        const e = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, de / capS)) ** 2));
        // (the ledge's jog up its stratum a ramp over 0.9 m, not a step: no straight riser in the pillow's outline)
        const uu = Math.min(0.97, Math.max(0.04, u + dip * zl + 0.012 * smooth((zl - kink) / 0.9 + 0.5) + 0.006 * fbm(z * 0.9, u * 7, 0.2, sf + 3, 1)));
        const p = S(z, uu), lump = bump(zl, lumps), sag = bump(zl, drips);
        const th = Math.max(0.04, base * (0.06 + 0.22 * f01(fbm(z * 0.95, u * 9, 0.4, sf, 2)) + 0.11 * fbm(z * 2.6, u * 5, 1.4, sf + 5, 1)) * (1 + lump));
        const fo = Math.max(0.05, (0.08 + 0.22 * f01(fbm(z * 1.55, u * 7, 2.3, sf + 21, 2)) + 0.05 * fbm(z * 3.7, u * 3, 0.8, sf + 27, 1)) * (0.75 + 0.25 * base) * (1 + 0.6 * lump));
        const backX = S(z, Math.min(0.99, uu + (th * 1.45) / h)).x + 0.05, under = 0.06 + 0.05 * f01(fbm(z * 1.9, u * 3, 0.7, sf + 23, 1));
        const full = [[backX, p.y + th * 1.45], [p.x + 0.02, p.y + th * 1.15], [p.x - fo * 0.45, p.y + th * (1 + 0.12 * fbm(z * 3.4, u * 2, 0.9, sf + 25, 1))],
          [p.x - fo * 0.9, p.y + th * 0.62 - sag * 0.3], [p.x - fo - 0.25 * sag, p.y + th * 0.15 - sag], [p.x - fo * 0.55, p.y - under - sag * 0.6], [p.x + 0.04, p.y - 0.1]];
        // (towards an end the section shrinks to a point 4 cm inside the rock at the ledge: a cap closing into the face)
        const ax = p.x + 0.04, ay = p.y - 0.01;
        const row = full.map(([x, y]) => [ax + (x - ax) * e, ay + (y - ay) * e ** 0.7, z]);
        let acc = 1000 + 37.3 * k;
        const ur = [[acc, z]];
        for (let j = 1; j < row.length; j++) { acc += Math.hypot(row[j][0] - row[j - 1][0], row[j][1] - row[j - 1][1]); ur.push([acc, z]); }
        // its light round the section (pillowLight): the top in the sky, the front a little wrapped, the lip and the
        // underside in shade; a lump's crown in more of the sky, a drip's sag and a cap closing into the rock in less
        const mot = 0.035 * fbm(z * 1.4, u * 5, 3.3, sf + 91, 2);
        rows.push(row); us.push(ur); es.push(pillowLight(tone + mot, Math.min(1, lump), Math.min(1, sag / 0.18), e));
        // (and the rock's shade under it: the sky the pillow takes from the rock below its underside, a strip on the
        // face's drawn triangles from just above where the underside meets the rock down 0.16-0.3 m, 2 cm out from the
        // rock, deepest at the top and under the deeper lips and the drips — e07-dressing draws it, a tint on the rock)
        if (o.shade) {
          const hs = 0.16 + 0.14 * Math.min(1, (fo + under) / 0.35), k0 = e * (0.7 + 0.3 * Math.min(1, fo / 0.25)) * (1 + 0.3 * Math.min(1, sag / 0.15));
          const at3 = (f) => { const q = S(z, Math.max(0.002, uu - (0.06 + hs * f) / h)); return [q.x - 0.02, q.y, z]; };
          sh.push([at3(0), at3(0.4), at3(1), Math.min(1.2, k0)]);
        }
      }
      for (let i = 0; i < n; i++) for (let r = 0; r < 6; r++) {
        quadU(Gk, mat, rows[i][r], rows[i + 1][r], rows[i + 1][r + 1], rows[i][r + 1], us[i][r], us[i + 1][r], us[i + 1][r + 1], us[i][r + 1], guide[r], 1,
          es[i][r], es[i + 1][r], es[i + 1][r + 1], es[i][r + 1]);
      }
      if (o.shade) o.shade.push(sh);
    }
    if (due()) yield;
  }
  if (o.part === 'ledges') return;
  // ---- the drift over the foot. The face stands plumb over the walkable edge (the rock is 0.1-0.3 m back from the toe
  // a metre up) and the toe may not cross that edge (the team crawls along it), so the drift is held to the steepest a
  // drift stands — no taller than `ratio` (1.2-1.55) × its reach from the toe to the rock at its own height. A concave
  // section, gentle at the toe and steepening to the rock, its crest 5 cm into the rock, lumped at two scales.
  const ground = o.ground ?? (() => 0), apronOK = o.apronOK ?? (() => 1), apronT = o.apronT ?? 0.03;
  const gul = o.gullies ?? [], NR = 8, NA = SPILL_S.length, D = [];
  const fans = gul.map(([gz, gw], k) => {
    const a = fbm(gz * 0.37, 1.3, k * 0.71, sf + 17, 1), b = fbm(gz * 0.53, 2.9, k * 1.3, sf + 19, 1);
    return { z: gz + 0.35 * gw * a, l: gw * (0.8 + 0.35 * b), r: gw * (0.8 - 0.35 * b), top: 0, rows: [] };
  });
  // pass 1: each row's numbers (every 0.25 m: a metre's wobble is never caught on alternate sides)
  for (let z = o.z0; z <= o.z1 + 1e-6; z += 0.25) {
    let fan = 0, Fz = null;
    for (const F of fans) { const d = z - F.z, w = d < 0 ? F.l : F.r, e = Math.exp(-((d / w) ** 2)); if (e > fan) { fan = e; Fz = F; } }
    const A = f01(fbm(z * 0.07, 0.2, 2.9, sf, 3)), B = f01(fbm(z * 0.31, 3.3, 0.1, sf + 5, 2)), C = fbm(z * 1.05, 1.1, 0.4, sf + 7, 2);
    const J = fbm(z * 0.85, 2.4, 0.6, sf + 21, 2);
    // (banked stretches; and through the scoured ones, pillows of 1-3 m with the bare rock between)
    const lob = smooth((f01(fbm(z * 0.47, 4.1, 0.3, sf + 41, 2)) - 0.46) / 0.1);
    const bank = Math.min(1, Math.max(smooth((A - 0.34) / 0.4) * (0.3 + 0.85 * B ** 1.5) + 0.08 * C, lob * (0.3 + 0.45 * f01(fbm(z * 1.1, 0.7, 2.2, sf + 43, 1)))));
    const fanAmt = Math.min(1, fan ** 0.8 * (0.72 + 0.38 * B) * (1 + 0.32 * J) + 0.06 * C);
    // (the drift's toe 8 cm out from the rock's foot for its height; drawn, it wanders 5-15 cm in and out at 0.4-1 m, eased
    // off the walkable edge and off the rock — the toe is the crease the eye follows along the foot, and where the rock's
    // foot runs straight for a few metres the toe must not)
    const x8 = Math.max(104.66, footX(z) - 0.08), ratio = 1.2 + 0.35 * B;
    // (lobes 0.8-1.3 m apart, never fewer than one a stride, 4-9 cm out, over a finer wander)
    const lobe = (0.045 + 0.045 * f01(fbm(z * 0.5, 1.9, 4.4, sf + 109, 1))) * Math.sin(2 * Math.PI * (z / 1.05 + 0.3 * fbm(z * 0.27, 5.1, 3.2, sf + 111, 2)));
    const wig = lobe + 0.06 * fbm(z * 1.3, 3.7, 8.1, sf + 103, 1) + 0.035 * fbm(z * 2.3, 6.2, 2.4, sf + 105, 1);
    const xT = softMax(104.66, softMin(footX(z) - 0.025, x8 + wig, 0.02), 0.015);
    let cap = 3;
    for (let k = 0; k < 8; k++) cap = Math.min(3, Math.max(0.04, ratio * (S(z, cap / h).x - x8)));
    D.push({ z, fan, Fz, xT, cap, bank, fanAmt });
    if (due()) yield;
  }
  // pass 2: the crest's height. A fan's top is smoothed along the face (a single row's room no longer pokes up a spike)
  // and ragged at 0.3-1 m; the drift's crest wanders at a metre or two
  for (let i = 0; i < D.length; i++) {
    const d = D[i];
    let sw = 0, sv = 0;
    for (let j = Math.max(0, i - 8); j <= Math.min(D.length - 1, i + 8); j++) { const w = Math.exp(-(((j - i) / 4) ** 2)); sw += w; sv += w * D[j].cap; }
    d.capS = sv / sw;
    if (d.Fz && d.fan > 0.5) d.Fz.capMax = Math.max(d.Fz.capMax ?? 0, d.capS);
  }
  for (let i = 0; i < D.length; i++) {
    const d = D[i];
    // (a fan's top: the smoothed room, cut off a quarter below its highest — a shoulder, not an apex — then ragged)
    // (the rag after the room's limit: where the room holds the fan down its top still breaks into lumps and bites)
    const rag = 1 + 0.22 * fbm(d.z * 1.6, 0.4, 3.1, sf + 45, 2) + 0.12 * fbm(d.z * 3.1, 1.8, 0.2, sf + 49, 1);
    const fanTop = Math.min(d.cap, d.capS * Math.min(1, d.fanAmt * 1.3), (d.Fz?.capMax ?? 3) * 0.74) * rag;
    const drift = d.bank * d.cap * (0.62 + 0.38 * f01(fbm(d.z * 0.85, 2.7, 1.1, sf + 51, 2)));
    d.top = Math.max(0.02, drift, fanTop);
    d.amt = Math.min(1, d.top / Math.max(0.04, d.cap));
  }
  if (due()) yield;
  // pass 3: the rows, from the spill's toe (or the drift's, dug in) to the crest, their unfolded coordinates and their
  // light terms
  const rowsF = [], usF = [], esF = [];
  for (let i = 0; i < D.length; i++) {
    const d = D[i], { z, xT, fan, Fz, top } = d, amt = d.amt;
    // (scoured: the whole section sinks under the ground's snow, the rock's foot bare)
    const sink = 0.09 * (1 - smooth(amt / 0.3)), small = Math.min(1, top / 0.25), lumpA = (0.03 + 0.1 * Math.min(1.5, top)) * small;
    // (runnels down a fan: grooves along the fall line about a metre apart, irregularly spaced)
    const run = fan * (0.04 + 0.035 * Math.min(2, top)), ph = 2 * Math.PI * (z / 1.15) + 2.2 * fbm(z * 0.4, 0.3, 1.9, sf + 25, 2);
    // the spill over the walkable snow (render-only: a skin over the drawn ground, which keeps its heights, its paint and
    // its prints): a fan's apron, a few centimetres, its toe in lobes; and along the whole foot where the drift stands
    // banked, the drift's own spill — 0.3-1.5 m out in lobes at 0.5-2 m, 2-5 cm up at the drift, thinning out to its toe
    // (concave or bluff by turns) — so the drift rises out of it where the rock's foot holds the drift's own toe to the
    // walkable edge: no crease ruled along the face. Its toe dives 6 mm under the ground; 4-10 cm in it stands 8 mm or
    // more over it, and never under that again (no skin lying in the ground's own depth). None on the tarn's snow.
    const ok = apronOK(xT - 0.6, z);
    const alFan = ok * smooth((fan - 0.12) / 0.4) * (0.45 + 0.85 * f01(fbm(z * 0.95, 2.6, 1.7, sf + 47, 2))) * Math.min(1.3, 0.4 + 0.55 * top);
    const on = ok * smooth((amt - 0.12) / 0.3);
    const alFoot = on * (0.3 + 1.2 * f01(fbm(z * 0.55, 6.3, 0.9, sf + 81, 3)) + 0.12 * fbm(z * 2.3, 0.4, 4.1, sf + 83, 1));
    const fanW = smooth((alFan - 0.2) / 0.25), al = Math.max(alFan, alFoot);
    const tFan = alFan > 0.25 ? apronT + 0.035 * smooth((fan - 0.2) / 0.6) * (0.5 + 0.5 * f01(fbm(z * 2.4, 7.3, 0.6, sf + 107, 1))) : 0;
    const tFoot = Math.max(0.012, 0.02 + 0.03 * f01(fbm(z * 0.8, 1.9, 5.3, sf + 85, 2)) + 0.012 * fbm(z * 2.5, 4.2, 0.7, sf + 99, 1)) * Math.min(1, on * 1.4);
    const tA = al > 0.25 ? Math.min(apronT + 0.035, Math.max(tFan, tFoot)) : 0;
    const pw = lerp(Math.max(0.8, 1.1 + 1.1 * f01(fbm(z * 0.7, 3.1, 2.2, sf + 87, 2)) + 0.4 * fbm(z * 2.2, 5.6, 1.4, sf + 101, 1)), 0.7, fanW);
    // (its tone: where the drift rises out of the spill, patches a shade bluer — the scoop's trough tone carried up the
    // drift's foot and out over the spill at 0.5-2 m, fading 10-40 % of the way up — and the steep snow's wrapped light
    // coming on 3-25 % of the way up, by turns: no tone line ruled along the face either)
    const dB = 0.11 * f01(fbm(z * 0.9, 4.4, 2.8, sf + 95, 2)) ** 1.6, tm = 0.1 + 0.3 * f01(fbm(z * 1.2, 0.9, 7.1, sf + 97, 1));
    const t0 = (0.03 + 0.22 * f01(fbm(z * 0.62, 7.7, 1.3, sf + 89, 2))) * (1 - 0.7 * fanW), tw = 0.12 + 0.25 * f01(fbm(z * 1.3, 2.2, 6.1, sf + 93, 1));
    const row = [], er = [];
    if (tA > 0) {
      const x0 = xT - al, g = (x) => ground(x, z);
      SPILL_S.forEach((s, k) => {
        const x = x0 + s * al;
        row.push([x, g(x) + (k ? Math.max(0.008, tA * s ** pw) : -0.006), z]);
        er.push([1, dB * smooth((s - 0.35) / 0.65), 0]);
      });
    } else for (let a = 0; a < NA; a++) { row.push([xT, -0.05 - sink, z]); er.push(E_NONE); }
    const lift = tA > 0 ? ground(xT, z) + tA : 0;
    for (let r = 0; r <= NR; r++) {
      const t = r / NR, p = S(z, (top / h) * t), room = p.x - xT, bulge = Math.sin(Math.PI * t), w = 1 - (1 - t) ** 2;
      const lump = Math.min(0.5 * room * w, (lumpA * fbm(z * 1.3, t * 4.1, 1.7, sf + 11, 2) + 0.4 * lumpA * fbm(z * 3.1, t * 6.3, 0.3, sf + 13, 1)
        + run * Math.sin(ph + 1.7 * t)) * bulge);
      if (r === 0) row.push(tA > 0 ? [xT, lift, z] : [xT, -0.05 - sink, z]);
      else row.push([xT + room * w + 0.05 * smooth((t - 0.8) / 0.2) - lump, p.y + 0.03 * small * fbm(z * 1.7, t * 7, 0.9, sf + 15, 1) * bulge - sink + lift * (1 - t) ** 2, z]);
      er.push([1, dB * (1 - smooth(t / tm)), smooth((t - t0) / tw)]);
    }
    let acc = row[0][0];
    const ur = [[acc, z]];
    for (let j = 1; j < row.length; j++) { acc += Math.hypot(row[j][0] - row[j - 1][0], row[j][1] - row[j - 1][1]); ur.push([acc, z]); }
    rowsF.push(row); usF.push(ur); esF.push(er);
    if (Fz && fan > 0.35) { Fz.top = Math.max(Fz.top, top); Fz.rows.push(i); }
    if (due()) yield;
  }
  // (the foot's surface, for what is laid over it: e07-dressing drapes the wind scoop's tint on it — footSurfaceAt)
  if (o.footOut) Object.assign(o.footOut, { z0: o.z0, dz: 0.25, rows: rowsF });
  const W = NA + NR + 1;
  for (let i = 0; i + 1 < rowsF.length; i++) {
    const Gi = at(D[i].z), E0 = esF[i], E1 = esF[i + 1];
    for (let r = 0; r + 1 < W; r++) {
      // (the diagonals alternate: no grain; what lies wholly under the ground's snow is not drawn)
      const A = rowsF[i][r], B = rowsF[i + 1][r], C = rowsF[i + 1][r + 1], Dd = rowsF[i][r + 1];
      if (Math.max(A[1], B[1], C[1], Dd[1]) < -0.03) continue;
      const a = usF[i][r], b = usF[i + 1][r], c = usF[i + 1][r + 1], dd = usF[i][r + 1];
      const ea = E0[r], eb = E1[r], ec = E1[r + 1], ed = E0[r + 1];
      if ((i + r) % 2) { triU(Gi, mat, A, B, C, a, b, c, [-1, 0.6, 0], 1, ea, eb, ec); triU(Gi, mat, A, C, Dd, a, c, dd, [-1, 0.6, 0], 1, ea, ec, ed); }
      else { triU(Gi, mat, A, B, Dd, a, b, dd, [-1, 0.6, 0], 1, ea, eb, ed); triU(Gi, mat, B, C, Dd, b, c, dd, [-1, 0.6, 0], 1, eb, ec, ed); }
    }
    if (due()) yield;
  }
  // ---- snow plastered on the rock's toe: patches up to 1.1 m high, none on the fans (a skin over the face's own
  // triangles, west of the rock by its thickness; where the thickness goes negative it is inside the rock: the patch's
  // edge is where it runs into the rock, ragged at 0.3 m)
  const [pz0, pz1] = o.plaster ?? [o.z0, o.z1], PY = 13;
  let prev = null;
  for (let i = 0; i < D.length; i++) {
    const { z, fan } = D[i];
    if (z < pz0 - 1e-6 || z > pz1 + 1e-6) { prev = null; continue; }
    const a = f01(fbm(z * 0.38, 7.7, 1.3, sf + 61, 3)), b = fbm(z * 1.35, 2.2, 0.4, sf + 63, 2);
    // (and small patches between the big ones, a metre or so apart: no clean stretch of the rock's foot left)
    const a2 = 0.38 * Math.max(0, fbm(z * 0.95, 5.1, 2.6, sf + 73, 2) + 0.12);
    // (none where a big fan stands in front of the rock: there it would only hide behind the fan's slope)
    const H = Math.max(0, ((a - 0.3) * 2.2 + 0.3 * b) * 1.15, a2) * (1 - smooth((D[i].top - 0.7) / 0.6)), tm = 0.025 + 0.045 * f01(fbm(z * 0.8, 3.9, 0.2, sf + 65, 1));
    // (its foot creeps out over the snowfield 3-45 cm in lobes at 0.4-2 m, 1-2 cm up — render-only, as the drift's spill —
    // so where it meets the snow it wanders with the rock's toe and its own lobes; above that it keeps off the walkable
    // edge by easing its bank in as it nears it, never pressed flat against a clamp: a clamp leaves a ruled line)
    const creep = Math.max(0.03, 0.04 + 0.26 * f01(fbm(z * 0.9, 8.3, 4.7, sf + 77, 2)) ** 1.3 + 0.12 * smooth((fbm(z * 1.5, 6.4, 2.9, sf + 87, 1) + 0.05) / 0.3) + 0.06 * fbm(z * 2.6, 1.1, 6.6, sf + 79, 1));
    // (and how far out its bank may ease: itself wandering 0-11 cm at 0.5-1.5 m, so the eased bank is no ruled line either)
    const floorX = 104.63 + 0.07 * f01(fbm(z * 2.1, 9.2, 3.3, sf + 83, 1)) + 0.04 * f01(fbm(z * 0.8, 2.8, 7.7, sf + 85, 1));
    const row = [], ur = [];
    for (let j = 0; j < PY; j++) {
      // (its edge ragged at 0.3 m; holes where the rock's bosses stand through it; lumps on it)
      const y = -0.08 + j * 0.1, hole = 0.22 * Math.max(0, fbm(z * 1.6, y * 2.4, 4.4, sf + 71, 2) - 0.12) * smooth(y / 0.25);
      const c = H - y + 0.12 * fbm(z * 3.3, y * 3.3, 1.7, sf + 67, 2) - hole;
      const bank = 0.12 * (1 - smooth(y / 0.4)) * smooth(c / 0.2) * (0.55 * f01(fbm(z * 0.7, 6.1, 0.3, sf + 75, 1)) + 0.45 * f01(fbm(z * 2.6, 3.4, y * 2, sf + 81, 1)));
      const t = Math.max(-0.05, Math.min(tm, 0.45 * c) + bank + 0.03 * Math.max(0, fbm(z * 2.3, y * 2.3, 0.6, sf + 69, 1)) * smooth(c / 0.12));
      const rx = S(z, Math.max(0, y) / h).x, room = Math.max(0.005, rx - floorX);
      if (y < 0.05) {
        const x = rx - t - creep * smooth(c / 0.15) * (j ? 1 : 1.15), g = ground(x, z);
        row.push([x, j ? Math.max(y, g + 0.012) : Math.min(y, g - 0.06), z, t]);
      } else row.push([rx - (t > 0 ? room * Math.tanh(t / room) : t), y, z, t]);
      // (its surface coordinates: 300 m on, then the length up its section — the crept foot is not stretched)
      const q = row[j], pq = row[j - 1];
      ur.push([j ? ur[j - 1][0] + Math.hypot(q[0] - pq[0], q[1] - pq[1]) : 300, z]);
    }
    if (prev) for (let j = 0; j + 1 < PY; j++) {
      const A = prev.row[j], B = row[j], C = row[j + 1], Dd = prev.row[j + 1];
      if (Math.max(A[3], B[3], C[3], Dd[3]) < -0.002) continue; // (wholly inside the rock)
      quadU(at(z), mat, A.slice(0, 3), B.slice(0, 3), C.slice(0, 3), Dd.slice(0, 3), prev.ur[j], ur[j], ur[j + 1], prev.ur[j + 1], [-1, 0, 0]);
    }
    prev = { row, ur };
    if (due()) yield;
  }
  // ---- the sluffs' debris on the big fans: clods of snow (0.07-0.25 m), lumpy, squashed and tipped, more than half
  // buried in the fan's lower slope, and snowballs rolled down it sitting higher on it (none over the walkable edge)
  let qd = (s ^ 0x5bd1e995) >>> 0;
  const rd = () => ((qd = (qd * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const F of fans) {
    if (F.top < 0.5 || F.rows.length < 4) continue;
    for (let k = 0, n = Math.round(6 + 12 * Math.min(2, F.top)); k < n; k++) {
      const i = F.rows[Math.floor(rd() * F.rows.length)], t = 0.12 + 0.55 * rd() ** 1.2, P = rowsF[i][NA + Math.round(t * NR)];
      const sd = sf + 31 + k * 7, ball = clodKind(sd, 0.3), f1 = rd(), f2 = rd();
      const rx = (0.08 + 0.17 * rd()) * (0.8 + (0.2 * Math.min(2, F.top)) / 2);
      const { ry, rz, reach } = clodSize(rx, f1, f2, ball);
      if (P[0] + 0.15 * rx - reach < 104.61 || P[1] < 0.05) continue;
      clod(at(P[2]), chunkMat, [P[0] + 0.15 * rx, P[1] - (ball ? 0.25 : 0.45) * ry, P[2]], rx, ry, rz, sd, rd() * Math.PI, (rd() - 0.5) * 0.7, { ball, tone: clodTone(sd) });
    }
  }
  // ---- clumps fallen at the foot, every 2-6 m, on the drift or the ground at the rock's toe
  const rowY = (row, x) => {
    for (let j = NA; j + 1 < row.length; j++) {
      const [x0, y0] = row[j], [x1, y1] = row[j + 1];
      if ((x - x0) * (x - x1) <= 0 && Math.abs(x1 - x0) > 1e-6) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return 0;
  };
  for (let z = Math.max(o.z0, pz0) + rd() * 2; z < Math.min(o.z1, pz1); z += 1.5 + 3 * rd()) {
    for (let m = 0, nm = 1 + Math.floor(rd() * 2.6); m < nm; m++) {
      const zz = z + (rd() - 0.5) * 1.2, i = Math.max(0, Math.min(D.length - 1, Math.round((zz - o.z0) / 0.25))), d = D[i];
      if (d.fan > 0.5) continue;
      // (it stays behind the walkable edge by its own reach: its lumps at their widest, tipped and turned)
      const sd = sf + 977 + Math.round(zz * 31) + m, ball = clodKind(sd, 0.15);
      const r = 0.08 + 0.18 * rd() ** 1.3, { ry, rz, reach } = clodSize(r, rd(), rd(), ball);
      const x = Math.max(104.61 + reach, d.xT + 0.04 + 0.3 * rd()), y = Math.max(0, rowY(rowsF[i], x));
      clod(at(zz), chunkMat, [x, y + 0.12 * r, zz], r, ry, rz, sd, rd() * Math.PI, (rd() - 0.5) * 0.6, { ball, tone: clodTone(sd) });
    }
  }
  // ---- and along each big fan's toe, where the sluffs' coarsest debris runs out: chunks every 0.4-1.6 m in ones, twos and
  // threes, sunk where the fan's face rises out of its apron. The rock's foot holds the fan's toe to the walkable edge
  // (the face has no relief on its foot row), so the toe itself cannot wander; its debris breaks it up instead of one line
  // ruled along the face. (Their own stream: the clumps above stay where they were; each kept behind the walkable edge
  // by its own reach — its box's corners at their widest, tipped and turned, and its faces' pyramids.)
  let qt = (s ^ 0x27d4eb2f) >>> 0;
  const rt = () => ((qt = (qt * 1664525 + 1013904223) >>> 0) / 4294967296);
  const surfY = (row, x) => {
    // (the row's surface at x, its apron included; 0 past its ends)
    for (let j = 0; j + 1 < row.length; j++) {
      const [x0, y0] = row[j], [x1, y1] = row[j + 1];
      if ((x - x0) * (x - x1) <= 0 && Math.abs(x1 - x0) > 1e-6) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return 0;
  };
  for (const F of fans) {
    if (F.top < 0.5 || F.rows.length < 4) continue;
    const za = D[F.rows[0]].z, zb = D[F.rows[F.rows.length - 1]].z;
    for (let z = za + rt() * 0.8; z < zb; z += 0.4 + 1.2 * rt()) {
      for (let m = 0, nm = 1 + Math.floor(rt() * 2.4); m < nm; m++) {
        const zz = z + (rt() - 0.5) * 0.5, j = Math.max(0, Math.min(D.length - 1, Math.round((zz - o.z0) / 0.25)));
        if (D[j].fan < 0.35) continue;
        const sd = sf + 2311 + Math.round(zz * 37) + m, ball = clodKind(sd, 0.25);
        const rx = 0.05 + 0.11 * rt() ** 1.3, { ry, rz, reach } = clodSize(rx, rt(), rt(), ball);
        const x = Math.max(104.61 + reach, D[j].xT + 0.03 + 0.25 * rt() ** 1.5);
        // (sunk to the lowest of the surface under it: no open underside shows on the downhill side)
        const y = Math.min(surfY(rowsF[j], x - 0.7 * rx), surfY(rowsF[j], x)) - 0.2 * ry;
        clod(at(zz), chunkMat, [x, y, zz], rx, ry, rz, sd, rt() * Math.PI, (rt() - 0.5) * 0.8, { ball, tone: clodTone(sd) });
      }
    }
  }
}

/**
 * The plateau's snow over the ridge top (y 30): broad wind pillows, sastrugi ridges across the wind, small lumps —
 * always a little above the walking height (feet sink into it, never float over it), flatter along the lip where the
 * ridge path runs. Fine near the map, coarse out over the apron.
 * `berms` [{x0, x1, z0, z1, h, L, open}]: snow banked against a building's walls (the OP dugout's earth-and-snow cover):
 * up to `h` m against the box [x0..x1]×[z0..z1], falling away over `L` m in a concave, lumpy slope whose foot feathers
 * into the pillows (the reach and the height vary along the walls), none along the `open` side ('n': its z0 face, the
 * entrance) — part of this one surface, so it has the ground's own snow and no edge of its own.
 * @param {(z:number)=>number} rimX @returns {THREE.BufferGeometry}
 */
export function plateauSnowGeometry(rimX, o = {}) { return runSync(plateauSnowGeometryG(rimX, o)); }

/** plateauSnowGeometry as a sliced job (engine/slice.js): the same geometry, pausing between its rows' heights. */
export function* plateauSnowGeometryG(rimX, o = {}) {
  const F = o.H ? o : plateauSnowField(rimX, o), pos = [], idx = [], rows = [];
  for (const z of F.rowsZ) { rows.push(F.xs(z).map((x) => [x, F.H(x, z), z])); if (due()) yield; }
  const n = rows[0].length;
  for (const r of rows) for (let k = 0; k < n; k++) pos.push(...r[k]);
  for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k + 1 < n; k++) {
    const a = i * n + k, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3] / 4; uv[i * 2 + 1] = pos[i * 3 + 2] / 4; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/**
 * The plateau snow's field (plateauSnowGeometry's options): H(x, z) its height, rowsZ its rows (every 0.6 m, 0.4 m over
 * `fine`), xs(z) a row's columns (fine from the rim to x 123, coarse beyond).
 */
export function plateauSnowField(rimX, { y, z0, z1, x1 = 180, seed = 'plateau', clear = [], berms = [], fine = null } = {}) {
  const S = seedOf(seed) & 0xffff;
  const nf = fine ? 40 : 26, nc = Math.ceil((x1 - 123) / 3);
  const xs = (z) => { const r = rimX(z) + 0.2, out = []; for (let k = 0; k < nf; k++) out.push(r + ((123 - r) * k) / nf); for (let k = 0; k <= nc; k++) out.push(123 + ((x1 - 123) * k) / nc); return out; };
  const berm = (x, z) => {
    let h = 0;
    for (const b of berms) {
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1), out = Math.hypot(dx, dz);
      const depth = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z); // > 0 inside the box
      const n1 = fbm(x * 0.33, 5.1, z * 0.33, S + 31, 2), n2 = fbm(x * 1.05, 2.3, z * 1.05, S + 37, 2), n3 = fbm(x * 2.7, 0.6, z * 2.7, S + 41, 1);
      const L = b.L * (1 + 0.38 * n1);
      // (concave bank: steep against the wall, a long feathered foot; full height a cell's width into the wall, where
      // the wall hides it, so the bank always meets the wall)
      const t = out > 0 ? Math.min(1, out / L) : 0;
      let f = out > 0 ? (1 - t) ** 1.7 : depth < 0.8 ? 1 : Math.max(0, 1 - (depth - 0.8) / 0.4);
      if (b.open === 'n') f *= smooth((z - b.z0 - 0.15 + 0.5 * n2) / 0.9);
      if (f <= 0) continue;
      const top = b.h * (1 + 0.16 * n1 + 0.07 * n2);
      h = Math.max(h, top * f + (0.16 * n2 + 0.06 * n3) * f * (1 - f) * 4);
    }
    return h;
  };
  const H = (x, z) => {
    const near = smooth((x - rimX(z) - 0.6) / 3.5);
    // (drifts tall and short enough to shade under the hard sun at the game camera; sastrugi as sharp-crested ridges)
    const pillow = Math.max(0, fbm(x * 0.15, 0.3, z * 0.15, S, 3) + 0.1) * 1.25 + Math.max(0, fbm(x * 0.4, 2.1, z * 0.4, S + 9, 2)) * 0.3;
    const sast = 0.2 * Math.max(0, Math.sin(x * 0.55 + z * 1.35 + 3 * fbm(x * 0.2, 1, z * 0.2, S + 3, 2))) ** 3 * (0.4 + 0.6 * f01(fbm(x * 0.07, 4, z * 0.07, S + 7, 2)));
    const lump = 0.09 * fbm(x * 1.3, 0.7, z * 1.3, S + 5, 2);
    // (flattened round the ridge's buildings and guns — [x, z, r] — so no drift buries a door, a crate or a gun's floor)
    let keep = 1;
    for (const [cx, cz, r] of clear) keep = Math.min(keep, smooth((Math.hypot(x - cx, z - cz) - r) / 2.5));
    const base = y + 0.045 + Math.max(0, (pillow * (0.25 + 0.75 * near) + sast) * keep + lump * (0.3 + 0.7 * keep));
    return berms.length ? Math.max(base, y + 0.045 + berm(x, z)) : base;
  };
  // (rows every 0.6 m; 0.4 m over the `fine` band [z0, z1], where a bank needs the resolution)
  const rowsZ = [];
  for (let z = z0; z <= z1 + 1e-6; z += fine && z >= fine[0] - 1e-6 && z < fine[1] ? 0.4 : 0.6) rowsZ.push(z);
  return { H, rowsZ, xs };
}

/**
 * The plateau snow as drawn (its own rows, columns and diagonals: linear between its points, not the field H it samples):
 * (x, z) → height, for what has to go under it or stand on it (the rim cornice's back). West of its first column the
 * first column's height; off its ends the end row's.
 */
export function plateauSnowSurface(F) {
  const Z = F.rowsZ, memo = new Map();
  const row = (i) => { let r = memo.get(i); if (!r) { const z = Z[i], xs = F.xs(z); r = { xs, hs: xs.map((x) => F.H(x, z)) }; memo.set(i, r); } return r; };
  return (x, z) => {
    let lo = 0, hi = Z.length - 1;
    if (z <= Z[0]) hi = 1; else if (z >= Z[hi]) lo = hi - 1; else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Z[m] <= z) lo = m; else hi = m; }
    const t = Math.min(1, Math.max(0, (z - Z[lo]) / (Z[hi] - Z[lo]))), A = row(lo), B = row(hi), n = A.xs.length;
    const cx = (k) => lerp(A.xs[k], B.xs[k], t);
    let k = 0;
    if (x <= cx(0)) k = 0; else { while (k + 2 < n && cx(k + 1) <= x) k++; }
    const s = Math.min(1, Math.max(0, (x - cx(k)) / (cx(k + 1) - cx(k))));
    // (each quad is split along (row lo, column k+1)–(row hi, column k), as the plateau's index runs)
    const a = A.hs[k], b = A.hs[k + 1], c = B.hs[k], d = B.hs[k + 1];
    return s + t <= 1 ? a + s * (b - a) + t * (c - a) : d + (1 - s) * (c - d) + (1 - t) * (b - d);
  };
}

/** A Catmull-Rom point between p1 and p2 (p0, p3 their outer neighbours) at t (0…1), for one coordinate. */
const cmr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

/**
 * The wind cornice along the plateau's lip: a lumpy snow roll whose lee side hangs a little over the face; broken where
 * `gaps` ([z0, z1]) let the granite rim show and where lumps of it have fallen. Its cross-section — back on the plateau,
 * over the crest, out to the overhang and back under it to the rim — is a smooth curve through seven key points, tried
 * every `step` m along z and `sub` times between two key points, every point pushed out along the section's normal by
 * lumps at three scales (world anchored, none at its two edges): no triangle over a quarter of a square metre, never a
 * flat plate. Every stretch swells out of the plateau's snow and sinks back into it: its height and its reach back over
 * the plateau grow from nothing over its first 5.5 m and die away over its last, its overhang later and slower (the end
 * a low wind ridge running out, never a hanging nose or a blunt loaf), and over the last 1.6 m every point closes on a
 * point 8 cm under the plateau at the rim (no end cap to see). `ground` (x, z) → the plateau snow's drawn height (e07-kit
 * plateauSnowSurface): the section's back runs down under it over its last 0.4 m, its back edge 7 cm under the plateau's
 * snow — the plateau's snow and the cornice one surface to the eye (drawn in the same ground snow, read at the same
 * place).
 * Its normals are left to be smoothed (e07-dressing softSnow) and the map's own ground snow is drawn on it (GROUND_SNOW).
 */
export function rimCornice(G, rimX, { z0, z1, y, seed = 'cornice', gaps = [], step = 0.5, sub = 2, ground = null } = {}) {
  const s = seedOf(seed) & 0xffff, segs = [];
  let cur = [];
  for (let z = z0; z <= z1 + 1e-6; z += step) {
    // (the listed gaps, and short breaks where a slab of the cornice has fallen)
    const fallen = fbm(z * 0.16, 2.7, 0.9, s + 11, 2) > 0.34;
    if (fallen || gaps.some(([a, b]) => z >= a && z <= b)) { if (cur.length > 1) segs.push(cur); cur = []; continue; }
    cur.push(z);
  }
  if (cur.length > 1) segs.push(cur);
  for (const zs of segs) {
    const rows = zs.map((z, i) => {
      // (a stretch grows out of the plateau's snow over its first 5.5 m and dies back into it over its last: its height
      // and its reach back over the plateau first, its overhang later and slower — the end a low wind ridge running out,
      // never a hanging nose — and over the last 1.6 m the whole section closes on its buried anchor)
      const d = Math.min(i, zs.length - 1 - i) * step, e = smooth(d / 5.5), eo = smooth((d - 0.5) / 6.5) ** 1.3, ec = smooth(d / 1.6);
      const k = f01(fbm(z * 0.21, 0.4, 1.1, s, 3));
      const lump = 0.26 * fbm(z * 0.95, 2.2, 0.3, s + 5, 2) + 0.1 * fbm(z * 2.6, 0.7, 1.9, s + 7, 1);
      const sc = Math.abs(Math.sin(z / 1.2 + 1.8 * fbm(z * 0.15, 3.1, 0.2, s + 9, 1))) ** 0.7; // (lobes along the lip)
      const over = Math.max(0.05, 0.2 + 0.55 * k + 0.4 * sc + lump) * eo, hh = Math.max(0.12, 0.35 + 0.65 * f01(fbm(z * 0.33, 1.4, 0.2, s + 3, 2)) + lump * 0.9) * e;
      const back = (1.2 + 1.6 * k + lump * 2) * e;
      const rx = rimX(z), ax = rx + 0.2, ay = y - 0.08; // (the point a section closes on: under the plateau at the rim)
      // (x, y) key points, counter-clockwise seen from +z: over the top westwards, round the lip, back under it; where the
      // overhang has shrunk the lip and the underside are drawn in under the plateau (no skin hugging the rock below the
      // rim), and the whole section towards the anchor by ec
      const full = [[rx + back, y + 0.02], [rx + back * 0.45, y + hh * 0.9], [rx + 0.1, y + hh], [rx - over * 0.7, y + hh * 0.55], [rx - over, y - 0.12], [rx - over * 0.35, y - 0.45], [rx + 0.15, y - 0.25]];
      const lip = smooth(eo / 0.35);
      const key = full.map(([x, yy], j) => { const f = ec * (j >= 4 ? lip : 1); return [ax + (x - ax) * f, ay + (yy - ay) * f]; });
      const P = [];
      let jc = 0; // (the crest's index in P)
      for (let j = 0; j + 1 < key.length; j++) {
        const a = key[Math.max(0, j - 1)], b = key[j], c = key[j + 1], d = key[Math.min(key.length - 1, j + 2)];
        if (j === 2) jc = P.length;
        // (the back, a metre or more over the plateau, taken a step finer: it runs down under the plateau's snow)
        const m = j < 2 ? sub + 1 : sub;
        for (let t = 0; t < m; t++) { const f = t / m; P.push([cmr(a[0], b[0], c[0], d[0], f), cmr(a[1], b[1], c[1], d[1], f)]); }
      }
      P.push(key[key.length - 1]);
      const n = P.length, xb = key[0][0], xc = key[2][0], Lf = Math.min(0.4, 0.6 * (xb - xc));
      return P.map(([x, yy], j) => {
        // the section's outward normal (its tangent turned clockwise) and the lumps along it
        const pa = P[Math.max(0, j - 1)], pb = P[Math.min(n - 1, j + 1)], tx = pb[0] - pa[0], ty = pb[1] - pa[1], L = Math.hypot(tx, ty) || 1;
        const nx = ty / L, ny = -tx / L, wgt = Math.sin(Math.PI * (j / (n - 1))) ** 0.7 * e;
        const r = (0.19 * fbm(x * 0.55, z * 0.5, yy * 0.6, s + 31, 3) + 0.075 * fbm(x * 1.3, z * 1.2, yy * 1.1, s + 37, 2) + 0.03 * fbm(x * 2.6, z * 2.3, yy * 1.9, s + 41, 1)) * wgt;
        let px = x + nx * r, py = yy + ny * r;
        // (the back's last 0.4 m runs down under the plateau's snow, its edge 7 cm under it: a steep crossing, never a
        // skin lying a centimetre over that snow)
        if (ground && Lf > 0.02 && j < jc && px > xb - Lf) {
          const f = smooth((px - (xb - Lf)) / Lf), under = ground(px, z) - 0.07;
          if (py > under) py = lerp(py, under, f);
        }
        return { p: [px, py, z], n: [nx, ny, 0] };
      });
    });
    for (let i = 0; i + 1 < rows.length; i++) for (let r = 0; r + 1 < rows[i].length; r++) {
      const A = rows[i][r], B = rows[i + 1][r], C = rows[i + 1][r + 1], D = rows[i][r + 1];
      const nOut = norm(add(add(A.n, B.n), add(C.n, D.n)));
      // (the diagonals alternate: no ruled grain; the tone is the build's own slow field; none of zero area — an end
      // row is one point)
      const t3 = (a, b, c) => {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        if (len(cross(u, v)) > 1e-7) triN(G, 'e07Snow', a, b, c, nOut);
      };
      if ((i + r) % 2) { t3(A.p, B.p, C.p); t3(A.p, C.p, D.p); } else { t3(A.p, B.p, D.p); t3(B.p, C.p, D.p); }
    }
    // (no end caps: a stretch's end rows have closed on their buried anchor — e is 0 there)
  }
}
