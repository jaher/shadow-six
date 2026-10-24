/**
 * The ruined fieldstone watchtower and the broken dry-stone wall running from it (ruins variants `tower_ruin`,
 * `wall_dry_ruin`): M3's start cover (user 2026-10-17 / 10-21: "replace the low wall at the beginning with a tower on
 * the right side in ruins with a small wall with boulders (similar to the original game but with the tower on the
 * right side). Make it in a way commandos dont have to rush to crawl to not be seen. That structure should hide them").
 *
 * Both are drawn from their def's own data, and the same data gives their gameplay parts (navParts, world/map-builder.js),
 * so what is drawn is what blocks, in the browser and in the grid-only builds alike:
 *  - tower `{x, z, r, t, tops: [[deg, h], …], seed}` (deg: 0 = +x/E, 90 = +z/S; no `rot`): a round tower of fieldstone, outer
 *    radius r, walls t thick, its broken top `towerSectors` round its ring (a ragged head, stones gone), loose
 *    stones on the wall heads, a few arrow slits, the battered foot in a talus of fallen masonry, a rubble heap filling
 *    the shell (collapsed floors) and more fallen on the breach side. Parts: the disc out to the talus B.LOW (stops a walker; the
 *    shell is never entered), the ring of wall wherever it stands eye-high B.HIGH, the fallen heaps B.LOW.
 *    A def may pierce its ring with a doorway (`door: [deg, clear width (m), lintel]`): a straight tunnel of
 *    that width through the wall, its jamb planes parallel to its centre line -- the shell then stands only
 *    above the lintel across the opening, the talus is trodden flat for a threshold, the fill is notched into
 *    a cleared pocket, and the parts follow exactly -- the corridor is cut out of the disc and out of the
 *    ring's B.HIGH, so what is drawn is what blocks, and a man can walk in.
 *  - wall `{x, z, rot, w, t, tops: [[u, h], …], seed}` (u m along it from its W end, the def's frame as every prop's):
 *    a dry-stone wall w long and t thick, its broken top `wallColumns` (a ragged head), loose top stones and
 *    a footing course. Parts: its plan (out to a man's reach off its faces, WALL_REACH) B.LOW, the spans standing
 *    eye-high B.HIGH.
 * Eye-high: SIGHT_Y (art/boulder-row.js) — a guard's eye, so every ground sight line through such a part is cut.
 * @module art/ruin-tower
 */
import * as THREE from 'three';
import { Geo } from './castle-kit.js';
import { rng, seedOf, fbm } from './dressing.js';
import { SIGHT_Y, BODY_BAND, boulderRowSolidPolys } from './boulder-row.js';
import { B } from '../world/grid.js';

const DEG = Math.PI / 180;
/** Sectors round the tower's ring. */
const TOWER_SEG = 64;
/** Columns along the wall (m). */
const WALL_COL = 0.22;

/** Piecewise-linear profile [[s, v], …] (sorted by s) at s; `wrap` (a period): round a ring. */
function profile(P, s, wrap = 0) {
  if (!P?.length) return 0;
  if (wrap) {
    s = ((s % wrap) + wrap) % wrap;
    const Q = [[P[P.length - 1][0] - wrap, P[P.length - 1][1]], ...P, [P[0][0] + wrap, P[0][1]]];
    for (let i = 0; i + 1 < Q.length; i++) if (s <= Q[i + 1][0]) { const [a, va] = Q[i], [b, vb] = Q[i + 1]; return va + ((vb - va) * (s - a)) / (b - a || 1); }
    return P[0][1];
  }
  if (s <= P[0][0]) return P[0][1];
  for (let i = 0; i + 1 < P.length; i++) if (s <= P[i + 1][0]) { const [a, va] = P[i], [b, vb] = P[i + 1]; return va + ((vb - va) * (s - a)) / (b - a || 1); }
  return P[P.length - 1][1];
}
/**
 * A broken head at s (m along it): the profile, roughened by a smooth seeded noise and a stone missing here and there.
 */
const head = (h, s, seed, R) => Math.max(0.3, h + 0.2 * fbm(s * 1.3, 0.5, 0, seed, 3) + 0.13 * fbm(s * 4.7, 1.5, 0, seed + 7, 2)
  - (R() < 0.28 ? 0.08 + R() * 0.2 : 0) + (R() < 0.08 ? 0.12 : 0));

/**
 * The tower's sectors round its ring: [a0, a1 (rad, world), top (m: the lower of its two heads — its sight height),
 * head at a0, head at a1] — seeded, the same in every build.
 */
export function towerSectors(def) {
  const sd = seedOf(def.seed ?? `tower@${def.x},${def.z}`) & 0xffff, R = rng(sd), H = [];
  for (let k = 0; k < TOWER_SEG; k++) { const a = (k / TOWER_SEG) * Math.PI * 2; H.push(head(profile(def.tops, a / DEG, 360), def.r * a, sd, R)); }
  return H.map((h0, k) => { const h1 = H[(k + 1) % TOWER_SEG]; return [(k / TOWER_SEG) * Math.PI * 2, ((k + 1) / TOWER_SEG) * Math.PI * 2, Math.min(h0, h1), h0, h1]; });
}
/** The tower's head (m) at world angle `deg` (its sector's sight height). */
export function towerTop(def, deg) { const S = towerSectors(def), a = ((((deg * DEG) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)); return S[Math.min(S.length - 1, Math.floor((a / (2 * Math.PI)) * S.length))][2]; }

/** The wall's columns: [u0, u1 (m from its W end), top (the lower head), head at u0, head at u1] — seeded. */
export function wallColumns(def) {
  const sd = seedOf(def.seed ?? `wall@${def.x},${def.z}`) & 0xffff, R = rng(sd), n = Math.max(1, Math.round(def.w / WALL_COL)), du = def.w / n, H = [];
  for (let k = 0; k <= n; k++) H.push(head(profile(def.tops, k * du), k * du, sd, R));
  return Array.from({ length: n }, (_, k) => [k * du, (k + 1) * du, Math.min(H[k], H[k + 1]), H[k], H[k + 1]]);
}

/** Ring sector polygon (world x, z) between radii r0 < r1 and angles a0 < a1. */
const sectorPoly = (x, z, r0, r1, a0, a1, n = 2) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([x + Math.cos(a) * r1, z + Math.sin(a) * r1]); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; out.push([x + Math.cos(a) * r0, z + Math.sin(a) * r0]); }
  return out;
};
const circlePoly = (x, z, r, n = 28) => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * 2 * Math.PI) * r, z + Math.sin((i / n) * 2 * Math.PI) * r]);

/** Fallen masonry round the tower's foot: [x, z, sx, sy, sz, yaw] blocks (world), seeded from `def.fallen` heaps. */
export function towerFallen(def) {
  const R = rng(seedOf(`${def.seed ?? 'tower'}:fallen`)), out = [];
  for (const [deg, spread, count] of def.fallen || []) {
    for (let k = 0; k < count; k++) {
      const a = (deg + (R() - 0.5) * spread) * DEG, d = def.r + 0.1 + Math.pow(R(), 1.4) * 1.5, s = 0.2 + R() * 0.28;
      out.push([def.x + Math.cos(a) * d, def.z + Math.sin(a) * d, s * (1.2 + R() * 0.5), s * (0.32 + R() * 0.25), s, R() * Math.PI]);
    }
  }
  return out;
}
/** The rubble mound under each fallen heap: [x, z, r, h] (world) — the heap's own ground, a man does not walk over it. */
export function towerMounds(def) {
  return (def.fallen || []).map(([deg, spread]) => {
    const a = deg * DEG, d = def.r + 0.55, r = 0.75 + spread / 120;
    return [def.x + Math.cos(a) * d, def.z + Math.sin(a) * d, r, 0.38];
  });
}
/** The fallen heaps' plan outlines (their mounds), world. */
const fallenHulls = (def) => towerMounds(def).map(([x, z, r]) => circlePoly(x, z, r, 14));
/** Convex hull (Andrew), counter-clockwise. */
function convex(P) {
  const p = P.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** The tower's foot: the talus of fallen masonry round its base (outer radius + 0.62 m) — what stops a walker. */
const footR = (def) => def.r + 0.62;

/**
 * The tower's doorway, if its def carries one (`door: [deg, clear width (m), lintel]`): its centre (rad),
 * the passage's half width (m) and lintel height -- the one place the drawing and the parts both read it
 * from. The passage is a straight tunnel: its sides are planes parallel to the centre line at ±half, so
 * the opening's angular extent depends on the radius it is measured at -- `a0`/`a1` give it at the OUTER
 * face (asin(half / r) either side of the centre; at the inner face the same planes subtend the wider
 * asin(half / (r - t))). (The first cut clipped a constant angular span instead and drew a funnel:
 * 1.14 m clear at the outer face narrowing to 0.80 m at the inner -- a conic cut, the user 2026-10-23.)
 */
export function towerDoorSpan(def) {
  if (!def.door) return null;
  const [deg, w, lintel] = def.door, c = deg * DEG, half = w / 2, b = Math.asin(Math.min(1, half / def.r));
  return { c, a0: c - b, a1: c + b, lintel, half };
}
/** A local point's signed distance (m) from a doorway's centre plane (+ on the higher-angle side), and its
 * distance (m) along the centre line (outward from the axis +). The doorway's jamb planes are s = ±half. */
const doorS = (c, px, pz) => -Math.sin(c) * px + Math.cos(c) * pz;
const doorD = (c, px, pz) => Math.cos(c) * px + Math.sin(c) * pz;
/** Sutherland–Hodgman clip of a polygon (local [x, z] points) against a doorway jamb plane: the part with
 * doorS <= k (le) or doorS >= k. Crossing points are interpolated (and rounded like the parts' own points). */
const clipPlane = (poly, c, k, le) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], sp = doorS(c, P[0], P[1]), sq = doorS(c, Q[0], Q[1]);
    const ip = le ? sp <= k : sp >= k, iq = le ? sq <= k : sq >= k;
    if (ip) out.push(P);
    if (ip !== iq) { const t = (k - sp) / (sq - sp); out.push([+(P[0] + (Q[0] - P[0]) * t).toFixed(3), +(P[1] + (Q[1] - P[1]) * t).toFixed(3)]); }
  }
  return out;
};
/** The same clip for shell pieces: points [x, z, a, rr] (angle / radius carried for the head's slope). */
const clipPlaneA = (poly, c, k, le) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], sp = doorS(c, P[0], P[1]), sq = doorS(c, Q[0], Q[1]);
    const ip = le ? sp <= k : sp >= k, iq = le ? sq <= k : sq >= k;
    if (ip) out.push(P);
    if (ip !== iq) { const t = (k - sp) / (sq - sp); out.push(P.map((v, j) => v + (Q[j] - v) * t)); }
  }
  return out;
};
/** The blocked heart of a doorway's strip (local points): the strip out to the battered foot, less the
 * corridor itself -- what stays solid is the cleared pocket's core (inside DOOR_POCKET_R) and the strip
 * behind the tower. Its sides ride a hair (4 mm) past the jamb planes so it laps the clipped sector pies. */
const doorCorePoly = (def, door) => {
  const F = footR(def), hE = door.half + 0.004, out = [];
  const pt = (s, d) => [+(Math.cos(door.c) * d - Math.sin(door.c) * s).toFixed(3), +(Math.sin(door.c) * d + Math.cos(door.c) * s).toFixed(3)];
  const aF = Math.asin(Math.min(1, hE / DOOR_POCKET_R)), aB = Math.asin(Math.min(1, hE / F));
  for (let k = 0; k <= 8; k++) { const a = -aF + (2 * aF * k) / 8; out.push(pt(DOOR_POCKET_R * Math.sin(a), DOOR_POCKET_R * Math.cos(a))); }
  out.push(pt(hE, -Math.sqrt(F * F - hE * hE)));
  for (let k = 1; k <= 24; k++) { const a = Math.PI - aB + (Math.PI * k) / 24; out.push(pt(F * Math.sin(a), F * Math.cos(a))); }
  return out;
};
/** How far into the shell the doorway's cleared pocket runs (m from the axis): the fill's core inside it stays solid. */
const DOOR_POCKET_R = 0.95;

/**
 * Gameplay parts of a ruined tower (map-builder navParts, the def's own frame: x, z at the origin, no rot):
 * the disc to its battered foot and the fallen heaps B.LOW, then the ring's eye-high sectors B.HIGH. A def
 * with a doorway: the disc is pie wedges with the doorway's straight corridor cut out of it (in the strip
 * only the fill's core inside the cleared pocket stays B.LOW) and the ring's B.HIGH stops at the jamb planes.
 * @returns {{points: number[][], block: number}[]}
 */
export function towerNavParts(def) {
  const toLocal = ([x, z]) => [+(x - def.x).toFixed(3), +(z - def.z).toFixed(3)];
  const door = towerDoorSpan(def), low = [], high = [];
  if (!door) low.push({ points: circlePoly(def.x, def.z, footR(def)).map(toLocal), block: B.LOW });
  else {
    // the disc and the ring with the doorway's straight corridor cut out of them: the sectors the passage
    // reaches (its strip, at its widest at the inner face) are clipped against the jamb planes; every other
    // sector stands whole -- the strip's planes run through the tower's back too, where the ring is solid
    const bI = Math.asin(Math.min(1, door.half / (def.r - def.t)));
    for (const [a0, a1] of towerSectors(def)) {
      const pie = sectorPoly(def.x, def.z, 0, footR(def), a0 - 0.002, a1 + 0.002).map(toLocal);
      if (a1 <= door.c - bI || a0 >= door.c + bI) { low.push({ points: pie, block: B.LOW }); continue; }
      for (const part of [clipPlane(pie, door.c, -door.half, true), clipPlane(pie, door.c, door.half, false)])
        if (part.length >= 3) low.push({ points: part, block: B.LOW });
    }
    low.push({ points: doorCorePoly(def, door), block: B.LOW });
    low.push(...fallenHulls(def).map((h) => ({ points: h.map(toLocal), block: B.LOW })));
    for (const [a0, a1, h] of towerSectors(def)) {
      if (h <= SIGHT_Y) continue;
      const sec = sectorPoly(def.x, def.z, def.r - def.t, def.r, a0 - 0.002, a1 + 0.002).map(toLocal);
      if (a1 <= door.c - bI || a0 >= door.c + bI) { high.push({ points: sec, block: B.HIGH }); continue; }
      for (const part of [clipPlane(sec, door.c, -door.half, true), clipPlane(sec, door.c, door.half, false)])
        if (part.length >= 3) high.push({ points: part, block: B.HIGH });
    }
    return [...low, ...high];
  }
  low.push(...fallenHulls(def).map((h) => ({ points: h.map(toLocal), block: B.LOW })));
  for (const [a0, a1, h] of towerSectors(def)) {
    if (h <= SIGHT_Y) continue;
    high.push({ points: sectorPoly(def.x, def.z, def.r - def.t, def.r, a0 - 0.002, a1 + 0.002).map(toLocal), block: B.HIGH });
  }
  return [...low, ...high];
}
/** The lowest head of the tower's ring (its sight height). */
export const towerHeight = (def) => Math.min(...towerSectors(def).map((s) => s[2]));

/**
 * A man's reach off the wall's long faces (m): its B.LOW plan runs this far out each side (not past its ends). A man
 * lying along it swings his limbs and kit up to ~1 m off his line (his posed body, clip-audit) — further than the body
 * clearance model's knees — so the cell beside the face is not his (the old 1.6 m stub's footprint ran 0.4 m past its
 * stones on each side, for the same reason). Its sight stays its masonry's own (B.HIGH exactly the eye-high runs).
 */
export const WALL_REACH = 0.4;
/**
 * Gameplay parts of a ruined wall (map-builder navParts, its own frame: +x along it from its middle): its plan, out to
 * a man's reach off its faces, B.LOW; the runs of columns standing eye-high B.HIGH.
 */
export function wallNavParts(def) {
  const W = def.w, t = def.t ?? 0.75, rect = (u0, u1, hw) => [[u0 - W / 2, -hw], [u1 - W / 2, -hw], [u1 - W / 2, hw], [u0 - W / 2, hw]];
  const out = [{ points: rect(0, W, t / 2 + WALL_REACH), block: B.LOW }];
  let run = null;
  for (const [u0, u1, h] of wallColumns(def)) {
    if (h > SIGHT_Y) { if (run) run[1] = u1; else run = [u0, u1]; continue; }
    if (run) { out.push({ points: rect(run[0], run[1], t / 2), block: B.HIGH }); run = null; }
  }
  if (run) out.push({ points: rect(run[0], run[1], t / 2), block: B.HIGH });
  return out;
}
/** The lowest head of the wall's eye-high runs (its sight height). */
export const wallHeight = (def) => Math.min(...wallColumns(def).map((c) => c[2]).filter((h) => h > SIGHT_Y));

// ---------------------------------------------------------------- the art (castle-kit Geo: fieldstone, one mesh per material)

/** A loose stone on a wall head or fallen in the snow: a block turned `yaw` and tipped `tip` (rad) about its long axis. */
function stone(G, mat, x, y, z, sx, sy, sz, yaw, R, tip = 0) {
  const e = new THREE.Euler(tip * (R() - 0.5), yaw, tip * (R() - 0.5), 'YXZ'), q = new THREE.Quaternion().setFromEuler(e), v = new THREE.Vector3();
  const P = (lx, ly, lz) => { v.set(lx, ly, lz).applyQuaternion(q); return [x + v.x, y + sy / 2 + v.y, z + v.z]; };
  const hx = sx / 2, hy = sy / 2, hz = sz / 2, k = 0.85 + R() * 0.1; // (its top a little smaller: a weathered block)
  G.hexa(mat, [P(-hx, -hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, -hy, -hz),
    P(-hx * k, hy, -hz * k), P(-hx * k, hy, hz * k), P(hx * k, hy, hz * k), P(hx * k, hy, -hz * k)], 0.78 + R() * 0.3);
}

/** One sector of the tower's shell: outer and inner faces, its broken head sloping from h0 (at a0) to h1 (at a1). */
function wedge(G, mat, ri, ro, a0, a1, h0, h1, tone, y0 = 0) {
  const P = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  G.quad(mat, P(ro, a0, y0), P(ro, a0, h0), P(ro, a1, h1), P(ro, a1, y0), tone);        // outer (as Geo.ring)
  G.quad(mat, P(ri, a0, y0), P(ri, a1, y0), P(ri, a1, h1), P(ri, a0, h0), tone * 0.92); // inner, facing the centre
  G.quad(mat, P(ro, a0, h0), P(ri, a0, h0), P(ri, a1, h1), P(ro, a1, h1), tone);      // the head
}

/** The talus round the tower's foot: its height (m) at angle a, distance d from the tower's axis (a lumpy heap). */
function talusY(def, a, d) {
  const sd = seedOf(`${def.seed ?? 'tower'}:talus`) & 0xffff, out = footR(def) + 0.12 * fbm(a * 2.1, 0.3, 0, sd, 2);
  const t = Math.min(1, Math.max(0, (d - def.r) / (out - def.r)));
  const lump = 1 + 0.45 * fbm(Math.cos(a) * d * 2.2, Math.sin(a) * d * 2.2, 0.7, sd + 5, 3);
  const y = Math.max(0, 0.46 * Math.pow(1 - t, 1.3) * lump + 0.05 * fbm(Math.cos(a) * d * 7, Math.sin(a) * d * 7, 1.1, sd + 9, 2) * (1 - t));
  if (!def.door) return y;
  // a doorway's worn threshold: the talus trodden flat across its passage (the strip between the jamb
  // planes), feathered over 0.25 m at its edges
  const door = towerDoorSpan(def), px = Math.cos(a) * d, pz = Math.sin(a) * d;
  const f = doorD(door.c, px, pz) <= 0 ? 1 : Math.min(1, Math.max(0, (Math.abs(doorS(door.c, px, pz)) - door.half) / 0.25));
  return y * (0.1 + 0.9 * f * f * (3 - 2 * f));
}
/** The talus mesh: a lumpy heap of fallen fieldstone round the foot, feathered into the snow at its rim. */
function talus(G, def, R) {
  const NA = 72, NR = 6, r0 = def.r - 0.02, r1 = footR(def) + 0.2;
  const P = (i, j) => { const a = (i / NA) * Math.PI * 2, d = r0 + ((r1 - r0) * j) / NR; return [Math.cos(a) * d, talusY(def, a, d) - (j === NR ? 0.06 : 0), Math.sin(a) * d]; };
  for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
    const tone = 0.82 + R() * 0.12;
    G.quad('rubble', P(i, j + 1), P(i, j), P(i + 1, j), P(i + 1, j + 1), tone); // (up-facing: Geo.ring's head winding)
  }
}

/** One piece of a doorway-pierced sector's shell (its ring quad clipped by the jamb planes): the vertical
 * faces on its ring edges -- outer / inner, in wedge's own windings and tones -- and its head fanned over
 * the plan at the sector's sloping head heights (at: angle -> head). Cut edges get no face: below the
 * lintel the doorway's jamb quads close them; above it the piece is inside the wall. */
function shellPiece(G, poly, at, tone, y0, ri, ro) {
  const P = (rr, a, y) => [Math.cos(a) * rr, y, Math.sin(a) * rr], n = poly.length;
  for (let i = 0; i < n; i++) {
    const A = poly[i], Bp = poly[(i + 1) % n];
    if (Math.abs(A[3] - Bp[3]) > 1e-9) continue; // a cut or sector edge: no face
    const lo = Math.min(A[2], Bp[2]), hi = Math.max(A[2], Bp[2]);
    if (Math.abs(A[3] - ro) < 1e-9) G.quad('ruinStone', P(ro, lo, y0), P(ro, lo, at(lo)), P(ro, hi, at(hi)), P(ro, hi, y0), tone);
    else if (Math.abs(A[3] - ri) < 1e-9) G.quad('ruinStone', P(ri, lo, y0), P(ri, hi, y0), P(ri, hi, at(hi)), P(ri, lo, at(lo)), tone * 0.92);
  }
  for (let i = 1; i + 1 < n; i++)
    G.tri('ruinStone', [poly[0][0], at(poly[0][2]), poly[0][1]], [poly[i][0], at(poly[i][2]), poly[i][1]], [poly[i + 1][0], at(poly[i + 1][2]), poly[i + 1][1]], tone);
}

/** The rubble fill's slope with a doorway (a cone: base ri - 0.02 -> 0.35 at fillH), notched by the
 * doorway's straight slot: built as rings of points, and a ring point inside the slot is slid along its
 * ring onto the nearer jamb plane (or, where the ring is narrower than the slot, onto the slot's side
 * line), so the slope's cut edge lies exactly on the planes; cells wholly inside the slot are skipped.
 * Flat faces close the notch: its cheeks on the jamb planes and its back on the centre plane -- the
 * heap's cross-sections the slot cuts away. */
function fillNotched(G, door, ri, fillH) {
  const NA = 72, NY = 6, rb = ri - 0.02, rt = 0.35, half = door.half;
  const rhoJ = (j) => rb + ((rt - rb) * j) / NY, yJ = (j) => (fillH * j) / NY;
  const rel = (a) => Math.atan2(Math.sin(a - door.c), Math.cos(a - door.c));
  const inside = (a, rho) => { const q = rel(a); return Math.cos(q) > 0 && Math.abs(Math.sin(q)) * rho < half; };
  const P = (j, i) => {
    const rho = rhoJ(j); let a = (i / NA) * Math.PI * 2;
    if (inside(a, rho)) { const lim = rho >= half ? Math.asin(half / rho) : Math.PI / 2; a = door.c + (rel(a) < 0 ? -lim : lim); }
    return [Math.cos(a) * rho, yJ(j), Math.sin(a) * rho];
  };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) {
    const i1 = (i + 1) % NA, a0 = (i / NA) * Math.PI * 2, a1 = ((i + 1) / NA) * Math.PI * 2;
    if (inside(a0, rhoJ(j)) && inside(a1, rhoJ(j)) && inside(a0, rhoJ(j + 1)) && inside(a1, rhoJ(j + 1))) continue; // the slot's own cells
    G.quad('rubble', P(j, i), P(j + 1, i), P(j + 1, i1), P(j, i1), 0.85);
  }
  const Q = (s, d, y) => [Math.cos(door.c) * d - Math.sin(door.c) * s, y, Math.sin(door.c) * d + Math.cos(door.c) * s];
  const yTop = (fillH * (rb - half)) / (rb - rt); // where the slope's surface crosses a jamb plane's centre line
  for (const sgn of [-1, 1]) {
    const V = [];
    for (let j = 0; j <= NY; j++) { const rho = rhoJ(j); if (rho > half) V.push(Q(sgn * half, Math.sqrt(rho * rho - half * half), yJ(j))); }
    V.push(Q(sgn * half, 0, yTop), Q(sgn * half, 0, 0));
    for (let k = 1; k + 1 < V.length; k++) { if (sgn < 0) G.tri('rubble', V[0], V[k], V[k + 1], 0.85); else G.tri('rubble', V[0], V[k + 1], V[k], 0.85); }
  }
  const BV = [[-half, 0], [half, 0], [half, yTop], [rt, fillH], [-rt, fillH], [-half, yTop]].map(([s, y]) => Q(s, 0, y));
  for (let k = 1; k + 1 < BV.length; k++) G.tri('rubble', BV[0], BV[k + 1], BV[k], 0.85);
}

/** The ruined tower, in the def's own frame (the caller places it: x, z at the origin). */
export function buildRuinTower(def) {
  const R = rng(seedOf(`${def.seed ?? 'tower'}:art`)), G = new Geo(def.seed ?? 'tower');
  const r = def.r, ri = def.r - def.t, x = 0, z = 0;
  const L = (wx, wz) => [wx - def.x, wz - def.z];
  const door = towerDoorSpan(def);
  // the shell: sector by sector up to its head, the courses of a break stepping down (end faces show the thickness)
  const bI = door ? Math.asin(Math.min(1, door.half / ri)) : 0; // the jamb planes' half-angle at the inner face (their widest)
  for (const [a0, a1, h, h0, h1] of towerSectors(def)) {
    const tone = 0.9 + R() * 0.12;
    if (!door || a1 <= door.c - bI || a0 >= door.c + bI) {
      wedge(G, 'ruinStone', ri, r, a0, a1, h0, h1, tone);
    } else {
      // pierced by the doorway: the sector's ring quad clipped by the jamb planes -- solid to the ground
      // either side of the passage, above the lintel only across it (the head sloping on across the break,
      // interpolated at the cut edges)
      const at = (a) => h0 + ((h1 - h0) * (a - a0)) / (a1 - a0);
      const Q = [[r, a0], [ri, a0], [ri, a1], [r, a1]].map(([rr, a]) => [Math.cos(a) * rr, Math.sin(a) * rr, a, rr]);
      const pieces = [[clipPlaneA(Q, door.c, -door.half, true), 0], [clipPlaneA(Q, door.c, door.half, false), 0],
        [clipPlaneA(clipPlaneA(Q, door.c, -door.half, false), door.c, door.half, true), door.lintel]];
      for (const [poly, base] of pieces) if (poly.length >= 3) shellPiece(G, poly, at, tone, base, ri, r);
    }
    // a loose stone on the wall head here and there
    if (R() < 0.18) {
      const a = a0 + (a1 - a0) * R(), rr = ri + 0.15 + R() * (def.t - 0.3), s = 0.16 + R() * 0.12;
      stone(G, 'ruinStone', Math.cos(a) * rr, h - 0.02, Math.sin(a) * rr, s * 1.5, s * 0.5, s, a + R(), R, 0.3);
    }
  }
  if (door) {
    // the doorway itself: jamb faces on the two parallel planes, the lintel's underside between them, a
    // worn threshold slab -- a straight rectangular hole through the wall
    const Ld = door.lintel, dIn = Math.sqrt(ri * ri - door.half * door.half), dOut = Math.sqrt(r * r - door.half * door.half);
    const Q = (s, d, y) => [Math.cos(door.c) * d - Math.sin(door.c) * s, y, Math.sin(door.c) * d + Math.cos(door.c) * s];
    G.quad('ruinStone', Q(-door.half, dOut, 0), Q(-door.half, dOut, Ld), Q(-door.half, dIn, Ld), Q(-door.half, dIn, 0), 0.94);
    G.quad('ruinStone', Q(door.half, dIn, 0), Q(door.half, dIn, Ld), Q(door.half, dOut, Ld), Q(door.half, dOut, 0), 0.94);
    G.quad('ruinStone', Q(-door.half, dOut, Ld), Q(door.half, dOut, Ld), Q(door.half, dIn, Ld), Q(-door.half, dIn, Ld), 0.8);
    G.box('ruinStone', Math.cos(door.c) * (r - def.t / 2), 0.035, Math.sin(door.c) * (r - def.t / 2), 0.86, 0.07, 0.8, door.c + Math.PI / 2, 0.95);
  }
  // the battered foot (a wider course of big stones round its base) and the talus of fallen masonry heaped round it
  if (door) G.cyl('rubble', x, -0.25, z, r + 0.22, r, 0.85, TOWER_SEG, 0.95, { caps: false, a0: door.a1, arc: Math.PI * 2 - (door.a1 - door.a0) });
  else G.cyl('rubble', x, -0.25, z, r + 0.22, r, 0.85, TOWER_SEG, 0.95, { caps: false });
  talus(G, def, R);
  for (let k = 0; k < 26; k++) {
    const a = R() * Math.PI * 2, d = r + 0.12 + R() * 0.5, s = 0.18 + R() * 0.18;
    if (door && doorD(door.c, Math.cos(a) * d, Math.sin(a) * d) > 0 && Math.abs(doorS(door.c, Math.cos(a) * d, Math.sin(a) * d)) < door.half + 0.3) continue; // none strewn across the doorway
    stone(G, R() < 0.65 ? 'ruinStone' : 'rubble', Math.cos(a) * d, talusY(def, a, d) - s * 0.35, Math.sin(a) * d, s * 1.3, s * 0.7, s, R() * 3, R, 0.35);
  }
  // arrow slits on its standing side (dark recesses in the face)
  for (const [deg, y] of def.slits || []) {
    const a = deg * DEG;
    if (door && Math.abs(doorS(door.c, Math.cos(a) * r, Math.sin(a) * r)) < door.half + 0.08) continue; // (a slit never pierces the doorway)
    if (towerTop(def, deg) < y + 1.2) continue;
    G.box('iron', Math.cos(a) * (r + 0.005), y + 0.5, Math.sin(a) * (r + 0.005), 0.06, 1.0, 0.16, a, 0.2);
    G.box('ruinStone', Math.cos(a) * (r + 0.02), y - 0.06, Math.sin(a) * (r + 0.02), 0.12, 0.12, 0.42, a, 1.05); // sill
  }
  // the shell full of its fallen floors and upper walls: a rubble heap inside, blocks on it
  const fillH = def.fill ?? 1.3;
  if (door) {
    // the heap notched by the doorway's straight slot: its slope clipped on the jamb planes, cut faces
    // closing the notch's sides and back, and its top cap fanned round the cleared pocket
    fillNotched(G, door, ri, fillH);
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2, b = ((k + 1) / 36) * Math.PI * 2, m = (a + b) / 2;
      if (doorD(door.c, Math.cos(m), Math.sin(m)) > 0) continue; // (the cap's front half is the slot's: the heap's top ring is narrower than the passage)
      G.tri('rubble', [x, fillH, z], [Math.cos(b) * 0.35, fillH, Math.sin(b) * 0.35], [Math.cos(a) * 0.35, fillH, Math.sin(a) * 0.35], 0.85);
    }
  } else G.cyl('rubble', x, 0, z, ri - 0.02, 0.35, fillH, 18, 0.85);
  for (let k = 0; k < 7; k++) {
    const a = R() * Math.PI * 2, d = R() * (ri - 0.5), s = 0.2 + R() * 0.2, y = fillH * (1 - d / ri) * 0.85;
    if (door && d > 0.5 && doorD(door.c, Math.cos(a) * d, Math.sin(a) * d) > 0 && Math.abs(doorS(door.c, Math.cos(a) * d, Math.sin(a) * d)) < door.half + 0.05) continue; // none in the cleared pocket
    stone(G, 'ruinStone', Math.cos(a) * d, y - 0.1, Math.sin(a) * d, s * 1.4, s * 0.45, s, R() * 3, R, 0.6);
  }
  // fallen masonry round its foot (the breach side): a low mound of rubble and stones lying on and round it, half sunk
  for (const [wx, wz, mr, mh] of towerMounds(def)) { const [lx, lz] = L(wx, wz); G.cyl('rubble', lx, -0.04, lz, mr, mr * 0.35, mh, 14, 0.85); }
  for (const [wx, wz, sx, sy, sz, yaw] of towerFallen(def)) {
    const [lx, lz] = L(wx, wz);
    stone(G, R() < 0.7 ? 'ruinStone' : 'rubble', lx, -sy * 0.3, lz, sx, sy * 1.3, sz, yaw, R, 0.35);
  }
  const g = G.build(def.id || 'tower_ruin', { ground: 0, damp: 0.9, streaks: 0.28, moss: 0.4 });
  g.name = 'ruins:tower_ruin';
  return g;
}

/** The ruined wall, in the def's own frame (+x along it from its middle; the caller places and turns it). */
export function buildRuinWall(def) {
  const R = rng(seedOf(`${def.seed ?? 'wall'}:art`)), G = new Geo(def.seed ?? 'wall');
  const W = def.w, t = def.t ?? 0.75;
  // footing course, a little proud of the faces
  G.box('rubble', 0, 0.12, 0, W + 0.1, 0.36, t + 0.12, 0, 0.92);
  for (const [u0, u1, h, h0, h1] of wallColumns(def)) {
    const cx = (u0 + u1) / 2 - W / 2, x0 = u0 - W / 2, x1 = u1 - W / 2 + 0.005, hz = t / 2;
    G.hexa('ruinStone', [[x0, 0, -hz], [x0, 0, hz], [x1, 0, hz], [x1, 0, -hz], [x0, h0, -hz], [x0, h0, hz], [x1, h1, hz], [x1, h1, -hz]], 0.9 + R() * 0.12);
    // the head: a loose stone or two
    if (R() < 0.2) { const s = 0.15 + R() * 0.12; stone(G, 'ruinStone', cx + (R() - 0.5) * 0.2, h - 0.02, (R() - 0.5) * (t - 0.3), s * 1.5, s * 0.5, s, (R() - 0.5) * 0.6, R, 0.3); }
  }
  // stones fallen from its notches, on its S side (+z)
  for (const [u, n] of def.fallen || []) for (let k = 0; k < n; k++) {
    const s = 0.16 + R() * 0.2;
    stone(G, R() < 0.6 ? 'ruinStone' : 'rubble', u - W / 2 + (R() - 0.5) * 1.2, -s * 0.18, t / 2 + 0.25 + R() * 0.9, s * 1.4, s * 0.4, s, R() * 3, R, 0.7);
  }
  const g = G.build(def.id || 'wall_ruin', { ground: 0, damp: 0.8, streaks: 0.25, moss: 0.4 });
  g.name = 'ruins:wall_dry_ruin';
  return g;
}

/** Is this def one of these procedural ruins (its parts from its own data)? */
export const isProcRuin = (p) => p?.type === 'ruins' && (p.variant === 'tower_ruin' || p.variant === 'wall_dry_ruin');
/** navParts of a procedural ruin def (map-builder), in its own frame. */
export const procRuinNavParts = (p) => (p.variant === 'tower_ruin' ? towerNavParts(p) : wallNavParts(p));

/**
 * A procedural def's solid plan at body height (world polygons) and its top: a boulder row's rock, a ruin's B.LOW
 * parts (its masonry's plan, the rubble round it) — what a grid-only build stamps for the drawn shapes (map-builder).
 * @returns {{polys: number[][][], top: number}|null}
 */
export function procSolids(def) {
  if (Array.isArray(def?.boulders)) return { polys: boulderRowSolidPolys(def), top: Math.max(...def.boulders.map((b) => b[4] ?? 0)) };
  if (!isProcRuin(def)) return null;
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), x0 = def.x ?? 0, z0 = def.z ?? 0;
  const polys = procRuinNavParts(def).filter((p) => p.block === B.LOW).map((p) => p.points.map(([u, v]) => [x0 + u * c - v * s, z0 + u * s + v * c]));
  const top = def.variant === 'tower_ruin' ? Math.max(...towerSectors(def).map((q) => Math.max(q[3], q[4]))) : Math.max(...wallColumns(def).map((q) => Math.max(q[3], q[4])));
  return { polys, top };
}

