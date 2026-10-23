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
 *    A def may pierce its ring with a doorway (`door: [deg, width, lintel]`): the shell then stands only above
 *    the lintel across the span, the talus is trodden flat for a threshold, the fill is notched into a cleared
 *    pocket, and the parts follow exactly -- the corridor is cut out of the disc and out of the ring's B.HIGH,
 *    so what is drawn is what blocks, and a man can walk in.
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
 * The tower's doorway, if its def carries one (`door: [deg, width, lintel]`): its centre and span (rad) and
 * lintel height -- the one place the drawing and the parts both read it from.
 */
export function towerDoorSpan(def) {
  if (!def.door) return null;
  const [deg, wDeg, lintel] = def.door, c = deg * DEG, half = (wDeg / 2) * DEG;
  return { c, a0: c - half, a1: c + half, lintel };
}
/** [a0, a1] minus a door span: the sub-ranges of a sector that stay solid, each with the overlap to add at
 * its ends (a hair past a sector boundary, never into the span). */
const clipSpan = (a0, a1, door) => {
  if (a1 <= door.a0 || a0 >= door.a1) return [[a0, a1, 0.002, 0.002]];
  const out = [];
  if (a0 < door.a0) out.push([a0, door.a0, 0.002, 0]);
  if (a1 > door.a1) out.push([door.a1, a1, 0, 0.002]);
  return out;
};
/** How far into the shell the doorway's cleared pocket runs (m from the axis): the fill's core inside it stays solid. */
const DOOR_POCKET_R = 0.95;

/**
 * Gameplay parts of a ruined tower (map-builder navParts, the def's own frame: x, z at the origin, no rot):
 * the disc to its battered foot and the fallen heaps B.LOW, then the ring's eye-high sectors B.HIGH. A def
 * with a doorway: the disc is pie wedges with the doorway's corridor cut out of it (in the span only the
 * fill's core inside the cleared pocket stays B.LOW) and the ring's B.HIGH stops at the span's edges.
 * @returns {{points: number[][], block: number}[]}
 */
export function towerNavParts(def) {
  const toLocal = ([x, z]) => [+(x - def.x).toFixed(3), +(z - def.z).toFixed(3)];
  const door = towerDoorSpan(def), low = [], high = [];
  if (!door) low.push({ points: circlePoly(def.x, def.z, footR(def)).map(toLocal), block: B.LOW });
  else {
    for (const [a0, a1] of towerSectors(def)) for (const [s0, s1, e0, e1] of clipSpan(a0, a1, door))
      low.push({ points: sectorPoly(def.x, def.z, 0, footR(def), s0 - e0, s1 + e1).map(toLocal), block: B.LOW });
    low.push({ points: sectorPoly(def.x, def.z, 0, DOOR_POCKET_R, door.a0, door.a1).map(toLocal), block: B.LOW });
  }
  low.push(...fallenHulls(def).map((h) => ({ points: h.map(toLocal), block: B.LOW })));
  for (const [a0, a1, h] of towerSectors(def)) {
    if (h <= SIGHT_Y) continue;
    if (!door) { high.push({ points: sectorPoly(def.x, def.z, def.r - def.t, def.r, a0 - 0.002, a1 + 0.002).map(toLocal), block: B.HIGH }); continue; }
    for (const [s0, s1, e0, e1] of clipSpan(a0, a1, door))
      high.push({ points: sectorPoly(def.x, def.z, def.r - def.t, def.r, s0 - e0, s1 + e1).map(toLocal), block: B.HIGH });
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
  // a doorway's worn threshold: the talus trodden flat across its span, feathered at the edges
  const door = towerDoorSpan(def), rel = Math.abs(Math.atan2(Math.sin(a - door.c), Math.cos(a - door.c))), half = (door.a1 - door.a0) / 2;
  const f = Math.min(1, Math.max(0, (rel - half) / 0.09));
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

/** The ruined tower, in the def's own frame (the caller places it: x, z at the origin). */
export function buildRuinTower(def) {
  const R = rng(seedOf(`${def.seed ?? 'tower'}:art`)), G = new Geo(def.seed ?? 'tower');
  const r = def.r, ri = def.r - def.t, x = 0, z = 0;
  const L = (wx, wz) => [wx - def.x, wz - def.z];
  const door = towerDoorSpan(def);
  // the shell: sector by sector up to its head, the courses of a break stepping down (end faces show the thickness)
  for (const [a0, a1, h, h0, h1] of towerSectors(def)) {
    const tone = 0.9 + R() * 0.12;
    if (!door || a1 <= door.a0 || a0 >= door.a1) {
      wedge(G, 'ruinStone', ri, r, a0, a1, h0, h1, tone);
    } else {
      // pierced by the doorway: full height outside the span, above the lintel only within it (the head
      // sloping on across the break, interpolated at the span's edges)
      const at = (a) => h0 + ((h1 - h0) * (a - a0)) / (a1 - a0), segs = [];
      if (a0 < door.a0) segs.push([a0, door.a0, 0]);
      segs.push([Math.max(a0, door.a0), Math.min(a1, door.a1), door.lintel]);
      if (a1 > door.a1) segs.push([door.a1, a1, 0]);
      for (const [s0, s1, base] of segs) wedge(G, 'ruinStone', ri, r, s0, s1, at(s0), at(s1), tone, base);
    }
    // a loose stone on the wall head here and there
    if (R() < 0.18) {
      const a = a0 + (a1 - a0) * R(), rr = ri + 0.15 + R() * (def.t - 0.3), s = 0.16 + R() * 0.12;
      stone(G, 'ruinStone', Math.cos(a) * rr, h - 0.02, Math.sin(a) * rr, s * 1.5, s * 0.5, s, a + R(), R, 0.3);
    }
  }
  if (door) {
    // the doorway itself: jamb faces at the span's edges, the lintel's underside, a worn threshold slab
    const P = (rr, a, y) => [Math.cos(a) * rr, y, Math.sin(a) * rr], Ld = door.lintel;
    G.quad('ruinStone', P(r, door.a0, 0), P(r, door.a0, Ld), P(ri, door.a0, Ld), P(ri, door.a0, 0), 0.94);
    G.quad('ruinStone', P(ri, door.a1, 0), P(ri, door.a1, Ld), P(r, door.a1, Ld), P(r, door.a1, 0), 0.94);
    G.quad('ruinStone', P(r, door.a0, Ld), P(r, door.a1, Ld), P(ri, door.a1, Ld), P(ri, door.a0, Ld), 0.8);
    G.box('ruinStone', Math.cos(door.c) * (r - def.t / 2), 0.035, Math.sin(door.c) * (r - def.t / 2), 1.05, 0.07, 0.8, door.c + Math.PI / 2, 0.95);
  }
  // the battered foot (a wider course of big stones round its base) and the talus of fallen masonry heaped round it
  if (door) G.cyl('rubble', x, -0.25, z, r + 0.22, r, 0.85, TOWER_SEG, 0.95, { caps: false, a0: door.a1, arc: Math.PI * 2 - (door.a1 - door.a0) });
  else G.cyl('rubble', x, -0.25, z, r + 0.22, r, 0.85, TOWER_SEG, 0.95, { caps: false });
  talus(G, def, R);
  for (let k = 0; k < 26; k++) {
    const a = R() * Math.PI * 2, d = r + 0.12 + R() * 0.5, s = 0.18 + R() * 0.18;
    if (door && a > door.a0 - 0.08 && a < door.a1 + 0.08) continue; // none strewn across the doorway
    stone(G, R() < 0.65 ? 'ruinStone' : 'rubble', Math.cos(a) * d, talusY(def, a, d) - s * 0.35, Math.sin(a) * d, s * 1.3, s * 0.7, s, R() * 3, R, 0.35);
  }
  // arrow slits on its standing side (dark recesses in the face)
  for (const [deg, y] of def.slits || []) {
    const a = deg * DEG;
    if (door && a > door.a0 && a < door.a1) continue; // (a slit never pierces the doorway's span)
    if (towerTop(def, deg) < y + 1.2) continue;
    G.box('iron', Math.cos(a) * (r + 0.005), y + 0.5, Math.sin(a) * (r + 0.005), 0.06, 1.0, 0.16, a, 0.2);
    G.box('ruinStone', Math.cos(a) * (r + 0.02), y - 0.06, Math.sin(a) * (r + 0.02), 0.12, 0.12, 0.42, a, 1.05); // sill
  }
  // the shell full of its fallen floors and upper walls: a rubble heap inside, blocks on it
  const fillH = def.fill ?? 1.3;
  if (door) {
    // the heap notched at the doorway: its slope runs round the rest of the shell, cut faces close the
    // notch's sides, and its top cap is fanned round the cleared pocket
    G.cyl('rubble', x, 0, z, ri - 0.02, 0.35, fillH, 18, 0.85, { a0: door.a1, arc: Math.PI * 2 - (door.a1 - door.a0) });
    for (const [ae, flip] of [[door.a0, false], [door.a1, true]]) {
      const A = [Math.cos(ae) * (ri - 0.02), 0, Math.sin(ae) * (ri - 0.02)], Bp = [Math.cos(ae) * 0.35, fillH, Math.sin(ae) * 0.35], C = [x, fillH, z], D = [x, 0, z];
      if (flip) G.quad('rubble', A, D, C, Bp, 0.85); else G.quad('rubble', A, Bp, C, D, 0.85);
    }
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2, b = ((k + 1) / 36) * Math.PI * 2, m = (a + b) / 2;
      if (m > door.a0 && m < door.a1) continue;
      G.tri('rubble', [x, fillH, z], [Math.cos(b) * 0.35, fillH, Math.sin(b) * 0.35], [Math.cos(a) * 0.35, fillH, Math.sin(a) * 0.35], 0.85);
    }
  } else G.cyl('rubble', x, 0, z, ri - 0.02, 0.35, fillH, 18, 0.85);
  for (let k = 0; k < 7; k++) {
    const a = R() * Math.PI * 2, d = R() * (ri - 0.5), s = 0.2 + R() * 0.2, y = fillH * (1 - d / ri) * 0.85;
    if (door && d > 0.5 && a > door.a0 - 0.05 && a < door.a1 + 0.05) continue; // none in the cleared pocket
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

