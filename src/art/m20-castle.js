/**
 * M20 "Operation Valhalla" castle pass (user 2026-11-10: "M20 should look like a large castle, moat should circle all
 * around castle. No buildings intersecting in strange ways ... Castle should have a medieval age style very detailed").
 * Gundelfingen is drawn as a high-medieval Breisgau castle on its crag, standing in water on every side:
 *  - the moat works: a dressed counterscarp (revetment + coping) round the whole ring, the outer ward's banks, and a
 *    battered scarp where the crag, the terraces and the N range meet the water;
 *  - flanking towers on the curtain and its corners: round and D-shaped, battered feet in the water, cross loops,
 *    string courses, machicolated parapets, steep slate cones with finials and vanes;
 *  - the gatehouses crowned (a roofed fighting gallery over each arch, pavilion roofs on the towers), the SW gate's
 *    bridge given its drawbridge (leaf, chains, the lifting beams in their slots);
 *  - no heraldry: the castle flies the period's flags (user 2026-11-10 "Nazi flags no medieval flags and so on": the flag
 *    system's, art/flags.js, following Options → INSIGNIA; placed by scripts/m20-art.js periodFlags).
 * Every piece here is scenery the gameplay never measures (added to the scene, not swapped into a structure): it
 * stands in the moat, on the crag, on outer faces or above head height, off every way, post and beat of the mission
 * (tests/unit/m20-castle.test.mjs keeps it so). Geometry is merged per material (castle-kit Geo): a handful of draws.
 * @module art/m20-castle
 */
import * as THREE from 'three';
import { Geo, segFrame, segBox, localFrame, archHead, archY, portcullis, wallLantern, hipRoof, flatPoly, bartizan, CASTLE_SETS } from './castle-kit.js';

// the castle pass's extra materials (castle-kit castleMaterial reads CASTLE_SETS at call time): Breisgau plain tiles,
// oak shingles, limewashed daub, dark oak framing, red Black Forest sandstone dressings, cobbles, door planks
Object.assign(CASTLE_SETS, {
  tiles: ['roof_tile_flat', 0xc9a08a, 0x8a5a44, 2.4, 1.0],
  shingle: ['roof_shingle', 0xa8977f, 0x5c4c3a, 2.2, 1.1],
  daub: ['plaster_limewash', 0xe8e0cc, 0xbdb39b, 2.4, 0.7],
  oak: ['timber_grey', 0x7d6a58, 0x3e3329, 1.6, 1.0],
  redstone: ['sandstone_ochre', 0xc08a78, 0x8a5548, 2.0, 1.0],
  cobbles: ['cobblestone', 0xb8b2a6, 0x6e6a62, 2.2, 1.1],
  doorboards: ['door_planks', 0x9a826a, 0x4f4034, 1.6, 1.0],
});

const HAS_DOM = typeof document !== 'undefined';
const TAU = Math.PI * 2;
/** Water surface and bed of the castle's deep water (terrain WATER_DEPTH carve, M20's moat is a little lower). */
export const WATER_Y = -0.25, BED_Y = -1.7;
/** The castle's centre (outward normals point away from it) — m20-art CASTLE_INSIDE. */
export const CASTLE_C = [88, 72];

// ---------------------------------------------------------------- small geometry helpers
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
/** Offset an open polyline by d along each segment's normal away from `inside` (mitred joints, capped mitres). */
export function offsetLine(points, d, inside = CASTLE_C) {
  const n = points.length, segN = [];
  for (let k = 0; k + 1 < n; k++) {
    const F = segFrame(points[k], points[k + 1], inside);
    segN.push(F.n);
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = segN[Math.max(0, k - 1)], b = segN[Math.min(segN.length - 1, k)];
    let m = norm([a[0] + b[0], a[1] + b[1]]);
    const cos = m[0] * b[0] + m[1] * b[1], s = d / Math.max(0.35, cos);
    out.push([points[k][0] + m[0] * s, points[k][1] + m[1] * s]);
  }
  return out;
}
/** Points along a polyline every `step` m (with the vertices). */
function resample(points, step) {
  const out = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < n; i++) out.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * A revetment along an open polyline (the water on its `wet` side): a battered stone face from the bed to the coping,
 * a dressed coping just proud of the ground, a few iron mooring rings and drain mouths. `ground(x, z)` the bank height.
 */
function revetment(G, pts, { wet = 1, ground = () => 0, mat = 'rubble', coping = 'dressed', batter = 0.35, top = 0.08, seed = 1, skip = null } = {}) {
  const R = G.R;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-t[1] * wet, t[0] * wet]; // n: towards the water
    const F = { t, n, L, rot: Math.atan2(t[1], t[0]), at: (u, w) => [a[0] + t[0] * u + n[0] * w, a[1] + t[1] * u + n[1] * w] };
    const g0 = ground(a[0], a[1]), g1 = ground(b[0], b[1]), gy = Math.max(g0, g1);
    const yTop = gy + top;
    // the face: battered (its foot further into the water), stones toned block by block
    for (let u = 0; u < L - 1e-3; u += 1.6) {
      const u1 = Math.min(L, u + 1.6), tn = 0.86 + R() * 0.22;
      if (skip?.(...F.at((u + u1) / 2, 0))) continue; // (a bridge's abutment stands there: its own masonry)
      const P = (uu, w, y) => { const [x, z] = F.at(uu, w); return [x, y, z]; };
      // face quad (towards the water: +w), from the bed (w = batter) to the coping (w = 0)
      const A = P(u, batter, BED_Y), B = P(u1, batter, BED_Y), C = P(u1, 0.02, yTop - 0.12), D = P(u, 0.02, yTop - 0.12);
      if (wet > 0) G.quad(mat, A, B, C, D, tn); else G.quad(mat, B, A, D, C, tn);
    }
    // coping slabs: dressed, alternate tones, a 6 cm lip over the face
    // (a continuous dressed coping, its stones 1-1.6 m long with hairline joints, weathered darker than new stone)
    for (let u = 0; u < L - 1e-3; u += 1.0 + R() * 0.6) {
      const u1 = Math.min(L, u + 1.0 + R() * 0.6);
      if (skip?.(...F.at((u + u1) / 2, -0.2))) continue;
      segBox(G, coping, F, u + 0.012, u1 - 0.012, -0.42, 0.06, yTop - 0.12, yTop, 0.7 + R() * 0.12);
    }
    // iron mooring rings / drain mouths now and then
    if (L > 4 && R() < 0.35) { const u = L * (0.3 + R() * 0.4); if (!skip?.(...F.at(u, 0))) segBox(G, 'iron', F, u - 0.12, u + 0.12, 0.03, 0.07, yTop - 0.55, yTop - 0.4, 0.3); }
  }
}

/** A battered scarp at the foot of a face standing in the water (rock or masonry), its outer edge on the polyline. */
function scarp(G, pts, { wet = 1, mat = 'rubble', top = 0.6, depth = 0.9 } = {}) {
  const R = G.R;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-t[1] * wet, t[0] * wet];
    const F = { t, n, L, rot: Math.atan2(t[1], t[0]), at: (u, w) => [a[0] + t[0] * u + n[0] * w, a[1] + t[1] * u + n[1] * w] };
    for (let u = -0.3; u < L + 0.29; u += 1.4) {
      const u1 = Math.min(L + 0.3, u + 1.4), tn = 0.8 + R() * 0.25, P = (uu, w, y) => { const [x, z] = F.at(uu, w); return [x, y, z]; };
      const A = P(u, depth, BED_Y), B = P(u1, depth, BED_Y), C = P(u1, 0.05, top), D = P(u, 0.05, top);
      if (wet > 0) G.quad(mat, A, B, C, D, tn); else G.quad(mat, B, A, D, C, tn);
    }
  }
}

// ---------------------------------------------------------------- the moat works
/** The ring's outer bank as one polyline (counter-clockwise round the castle), from the mission's moat terrain. */
export function moatOuterBank(m) {
  const path = (m.terrain || []).find((t) => t.type === 'path' && t.terrain === 'water');
  const ring = Object.fromEntries((m.moatRing || []).map((r) => [r.id, r.points]));
  const out = [];
  if (ring.ward && ring.w && ring.nw && ring.n && ring.ne) {
    // the outer ward's S leg, the W leg, the N legs, the NE leg down the E face (round the pond)
    out.push([29.6, 97.4], [0.5, 98], [0.5, 6], [42.5, 6], [42.5, 10], [104.5, 10], [138.24, 41.07], [145.5, 46.88], [145.5, 70.6]);
    for (let a = -0.75; a <= 0.751; a += 0.25) out.push([143.5 + 3 * Math.cos(a), 73 + 3 * Math.sin(a)]);
    out.push([145.5, 75.4]);
  }
  if (path) {
    // the S and E moat (a 4 m path): its outer edge, from the E face's S end round to the SW bastion
    const pts = path.points.slice().reverse(); // (143.5, 74) → … → (31, 96)
    const off = offsetLine(pts, (path.width ?? 4) / 2, CASTLE_C);
    out.push(...off.slice(1));
  }
  return out;
}

/**
 * Counterscarp and scarps of the moat ring, the outer ward's banks. `ground(x, z)`: the terrain height (world.groundY).
 * @returns {THREE.Group}
 */
export function buildMoatWorks(m, { ground = () => 0 } = {}) {
  const G = new Geo('m20:moat');
  // the bridges cross the bank on their own abutments: no coping or revetment under their decks
  const bridges = (m.structures || []).filter((s) => s.type === 'bridge').map((s) => ({ x: s.x, z: s.z, c: Math.cos(s.rot ?? 0), n: Math.sin(s.rot ?? 0), a: (s.w ?? 9) / 2 + 1.5, b: (s.d ?? 4) / 2 + 0.9 }));
  // (and round the flanking towers' battered feet, which stand in the water out to r + 0.75: the bank stops short)
  const feet = towerPlan(m).map((t) => { const [x, z] = t.kind === 'round' ? [t.x, t.z] : t.F.at(t.u, 2.5); return { x, z, r: t.r + 1.4 }; });
  const skip = (x, z) => bridges.some((B) => { const dx = x - B.x, dz = z - B.z; return Math.abs(dx * B.c + dz * B.n) < B.a && Math.abs(-dx * B.n + dz * B.c) < B.b; })
    || feet.some((f) => Math.hypot(x - f.x, z - f.z) < f.r);
  const outer = moatOuterBank(m);
  if (outer.length > 1) revetment(G, resample(outer, 6), { wet: -1, ground, mat: 'rubble', skip });
  const ring = Object.fromEntries((m.moatRing || []).map((r) => [r.id, r.points]));
  if (ring.w) {
    // the outer ward's banks (the W pair's pocket): its W and S edges
    revetment(G, [[4, 82.4], [4, 94], [30.5, 94]], { wet: -1, ground, mat: 'rubble', skip });
    // the crag's W and N faces, the château terrace's W face, the crag wall's end: a battered scarp into the water
    scarp(G, [[4, 82], [4, 6.5]], { wet: -1, mat: 'field', top: 0.9, depth: 1.1 });
    scarp(G, [[4, 10], [40, 10], [40, 14]], { wet: -1, mat: 'field', top: 0.9, depth: 1.1 });
    // the N range's back and the N rampart's corner (masonry)
    scarp(G, [[40, 14], [108, 14], [108, 18.64]], { wet: -1, mat: 'rubble', top: 0.7, depth: 0.8 });
  }
  return G.build('m20:moat', { ground: 0, damp: 1.6 });
}

// ---------------------------------------------------------------- towers
/** Iron cross loop (arrow slit) on a round face at angle a, centre height y: the slit, its cross arm along the face and
 *  a dressed sill under it. (`legacy`: the arm and the sill as first built — across the face, a hook standing out of
 *  the wall: review 2026-11-11; kept only as the keep's gameplay geometry, scripts/m20-art.js keep) */
function loopRound(G, x, z, r, a, y, h = 1.3, legacy = false) {
  G.box('iron', x + Math.cos(a) * (r + 0.01), y, z + Math.sin(a) * (r + 0.01), 0.05, h, 0.14, a + Math.PI / 2, 0.08);
  if (legacy) {
    G.box('iron', x + Math.cos(a) * (r + 0.01), y + h * 0.12, z + Math.sin(a) * (r + 0.01), 0.05, 0.12, 0.55, a + Math.PI / 2, 0.08);
    G.box('dressed', x + Math.cos(a) * (r + 0.03), y - h / 2 - 0.08, z + Math.sin(a) * (r + 0.03), 0.06, 0.12, 0.42, a + Math.PI / 2, 1.05);
    return;
  }
  // (box x is the face's tangent, z the radius: the arm 0.5 m along the face, 2 cm proud; the sill 5 cm proud)
  G.box('iron', x + Math.cos(a) * (r + 0.005), y + h * 0.12, z + Math.sin(a) * (r + 0.005), 0.5, 0.12, 0.05, a + Math.PI / 2, 0.08);
  G.box('dressed', x + Math.cos(a) * (r + 0.01), y - h / 2 - 0.08, z + Math.sin(a) * (r + 0.01), 0.42, 0.12, 0.1, a + Math.PI / 2, 1.05);
}

/** A slate cone with an eave ring, a lead-capped finial, a vane, and a dormer lucarne facing `face`. */
function coneRoof(G, x, z, y, r, h, { face = Math.PI / 2, seg = 28, lucarne = true, vane = true } = {}) {
  G.cyl('timber', x, y - 0.25, z, r + 0.05, r + 0.05, 0.25, seg, 0.7, { caps: false });
  G.cyl('slate', x, y, z, r, 0.06, h, seg, 1.0);
  // a second, steeper skirt where the cone flares (bellcast eaves)
  G.cyl('slate', x, y - 0.05, z, r + 0.35, r * 0.88, 0.55, seg, 0.95, { caps: false });
  G.cyl('lead', x, y + h - 0.15, z, 0.16, 0.05, 0.6, 8, 0.8);
  G.cyl('iron', x, y + h + 0.3, z, 0.035, 0.035, 1.5, 6, 0.4);
  G.box('lead', x, y + h + 0.55, z, 0.22, 0.22, 0.22, 0, 0.9);
  if (vane) {
    const a = face + 0.6;
    G.box('iron', x + Math.cos(a) * 0.3, y + h + 1.45, z + Math.sin(a) * 0.3, 0.6, 0.32, 0.03, a, 0.35);
  }
  if (lucarne) {
    // a small gabled dormer on the cone facing `face`
    const rr = r * 0.62, dx = Math.cos(face), dz = Math.sin(face), cx = x + dx * rr, cz = z + dz * rr, yy = y + h * 0.3;
    G.box('ashlar', cx, yy + 0.45, cz, 0.95, 0.9, 0.9, face + Math.PI / 2, 1);
    G.box('iron', cx + dx * 0.46, yy + 0.45, cz + dz * 0.46, 0.5, 0.6, 0.04, face + Math.PI / 2, 0.15);
    const F = localFrame(cx, cz, face + Math.PI / 2);
    const P = (u, w, y2) => { const [px, pz] = F.at(u, w); return [px, y2, pz]; };
    G.quad('slate', P(-0.6, 0.6, yy + 0.9), P(0, 0.6, yy + 1.45), P(0, -0.6, yy + 1.45), P(-0.6, -0.6, yy + 0.9), 0.95);
    G.quad('slate', P(0, 0.6, yy + 1.45), P(0.6, 0.6, yy + 0.9), P(0.6, -0.6, yy + 0.9), P(0, -0.6, yy + 1.45), 0.95);
    G.tri('ashlar', P(-0.48, 0.47, yy + 0.9), P(0.48, 0.47, yy + 0.9), P(0, 0.47, yy + 1.35), 1);
  }
}

/**
 * Round flanking tower: battered foot from the bed, ashlar shaft with string courses and cross loops, a machicolated
 * fighting gallery (corbels, a projecting parapet pierced by small windows) under a bellcast slate cone.
 * o: {x, z, r, y0 = BED_Y, top (gallery floor), face (heading the loops and the lucarne favour), cone = 2.3 (× r)}
 */
export function roundTower(G, o) {
  const { x, z, r } = o, y0 = o.y0 ?? BED_Y, top = o.top, R = G.R, seg = 30, face = o.face ?? Math.PI / 2;
  G.cyl('rubble', x, y0, z, r + 0.75, r, Math.min(3.6, top - y0 - 2), seg, 0.92, { caps: false });   // battered foot
  G.cyl('dressed', x, y0 + Math.min(3.6, top - y0 - 2) - 0.05, z, r + 0.1, r + 0.1, 0.22, seg, 1.03, { caps: false });
  G.cyl('ashlar', x, y0, z, r, r, top - y0 - 0.9, seg, 1, { caps: false });
  for (const f of [0.42, 0.7]) G.cyl('dressed', x, y0 + (top - y0) * f, z, r + 0.09, r + 0.09, 0.2, seg, 1.04, { caps: false });
  // cross loops in staggered tiers, facing outwards (the castle side has none)
  for (let tier = 0; tier < 3; tier++) {
    const yy = y0 + 3.2 + tier * ((top - y0 - 5) / 3);
    for (let k = -1; k <= 1; k++) loopRound(G, x, z, r, face + k * 0.85 + (tier % 2) * 0.42, yy + 0.7, 1.3, o.legacyLoops);
  }
  // machicolations: paired corbels, the gallery wall on them, little square windows, a timber eave
  const nC = Math.max(12, Math.round((TAU * r) / 0.85));
  for (let k = 0; k < nC; k++) {
    const a = (k / nC) * TAU;
    G.box('dressed', x + Math.cos(a) * (r + 0.22), top - 0.55, z + Math.sin(a) * (r + 0.22), 0.36, 0.95, 0.24, a + Math.PI / 2, 0.95, 0.35);
  }
  G.cyl('dressed', x, top - 0.12, z, r + 0.5, r + 0.5, 0.14, seg, 1.02);
  G.cyl('ashlar', x, top, z, r + 0.45, r + 0.45, 1.75, seg, 0.98, { caps: false });
  for (let k = 0; k < 6; k++) {
    const a = face + (k - 2.5) * 0.62;
    G.box('iron', x + Math.cos(a) * (r + 0.47), top + 0.95, z + Math.sin(a) * (r + 0.47), 0.04, 0.55, 0.42, a + Math.PI / 2, 0.1);
  }
  coneRoof(G, x, z, top + 1.75, r + 0.75, (r + 0.75) * (o.cone ?? 2.3), { face, seg, lucarne: r > 2.4, vane: o.vane !== false });
  void R;
}

/**
 * D-shaped flanking tower on a curtain stretch (its back on the parapet, the half-round out over the moat): segment
 * frame F of the wall (n outward), at u along it, radius r, its gallery floor at `top`.
 */
export function dTower(G, F, u, r, o = {}) {
  const half = o.half ?? 2.5, back = half - 0.45, top = o.top ?? 11.5, y0 = o.y0 ?? BED_Y, seg = 26;
  const [cx, cz] = F.at(u, half), face = Math.atan2(F.n[1], F.n[0]);
  // the half-round body (arc on the outer side) and its straight flanks back to the parapet line
  const arc = Math.PI, a0 = face - Math.PI / 2;
  G.cyl('rubble', cx, y0, cz, r + 0.7, r, 3.4, seg, 0.92, { caps: false, a0, arc });
  G.cyl('ashlar', cx, y0, cz, r, r, top - y0 - 0.9, seg, 1, { caps: false, a0, arc });
  for (const s of [-1, 1]) segBox(G, 'ashlar', F, u + s * r - (s > 0 ? 0.6 : 0), u + s * r + (s > 0 ? 0 : 0.6), back, half + 0.02, y0, top - 0.9, 0.97);
  // its floor (closing the top over the parapet line) and the tower's inner face above the walk
  segBox(G, 'ashlar', F, u - r, u + r, back, back + 0.5, 9.0, top + 1.75, 0.95);
  G.cyl('dressed', cx, top - 0.12, cz, r + 0.5, r + 0.5, 0.14, seg, 1.02, { a0, arc });
  for (const f of [0.45, 0.72]) G.cyl('dressed', cx, y0 + (top - y0) * f, cz, r + 0.08, r + 0.08, 0.2, seg, 1.04, { caps: false, a0, arc });
  for (let tier = 0; tier < 2; tier++) for (let k = -1; k <= 1; k++) loopRound(G, cx, cz, r, face + k * 0.75 + tier * 0.37, y0 + 3.6 + tier * 3.4);
  const nC = Math.round((Math.PI * r) / 0.85);
  for (let k = 0; k <= nC; k++) {
    const a = a0 + (k / nC) * arc;
    G.box('dressed', cx + Math.cos(a) * (r + 0.22), top - 0.55, cz + Math.sin(a) * (r + 0.22), 0.36, 0.95, 0.24, a + Math.PI / 2, 0.95, 0.35);
  }
  G.cyl('ashlar', cx, top, cz, r + 0.45, r + 0.45, 1.75, seg, 0.98, { caps: false, a0, arc });
  for (const s of [-1, 1]) segBox(G, 'ashlar', F, u + s * (r + 0.45) - (s > 0 ? 0.5 : 0), u + s * (r + 0.45) + (s > 0 ? 0 : 0.5), back, half, top, top + 1.75, 0.98);
  for (let k = 0; k < 3; k++) { const a = face + (k - 1) * 0.7; G.box('iron', cx + Math.cos(a) * (r + 0.47), top + 0.95, cz + Math.sin(a) * (r + 0.47), 0.04, 0.55, 0.42, a + Math.PI / 2, 0.1); }
  // the roof: a half cone on the round and a hipped back to the wall line
  const yE = top + 1.75, rr = r + 0.75, h = rr * (o.cone ?? 2.0);
  G.cyl('slate', cx, yE, cz, rr, 0.06, h, seg, 1.0, { a0, arc, caps: false });
  const P = (uu, w, y) => { const [x, z] = F.at(uu, w); return [x, y, z]; };
  const apex = [cx, yE + h, cz];
  const flip = (F.t[0] * F.n[1] - F.t[1] * F.n[0]) < 0;
  const tri = (a, b, c) => (flip ? G.tri('slate', a, b, c) : G.tri('slate', c, b, a));
  tri(P(u - rr, half, yE), P(u - rr, back - 0.3, yE), apex);
  tri(P(u + rr, back - 0.3, yE), P(u + rr, half, yE), apex);
  tri(P(u - rr, back - 0.3, yE), P(u + rr, back - 0.3, yE), apex);
  G.cyl('lead', cx, yE + h - 0.15, cz, 0.15, 0.05, 0.55, 8, 0.8);
  G.cyl('iron', cx, yE + h + 0.3, cz, 0.035, 0.035, 1.3, 6, 0.4);
}

/** Square tower top for the corners: corner bartizans, machicolations, a steep pyramidal slate roof. */
function squareCrown(G, F, u0, u1, w0, w1, y, o = {}) {
  const R = G.R;
  for (const [ua, ub, wa, wb] of [[u0, u1, w1 - 0.3, w1 + 0.25], [u0, u1, w0 - 0.25, w0 + 0.3], [u0 - 0.25, u0 + 0.3, w0, w1], [u1 - 0.3, u1 + 0.25, w0, w1]]) {
    segBox(G, 'ashlar', F, ua, ub, wa, wb, y, y + 1.6, 0.97);
  }
  for (let u = u0 + 0.4; u < u1 - 0.2; u += 0.85) for (const w of [w1 + 0.12, w0 - 0.12]) segBox(G, 'dressed', F, u - 0.14, u + 0.14, w - 0.12, w + 0.12, y - 0.8, y, 0.95);
  hipRoof(G, F, u0 - 0.2, u1 + 0.2, w0 - 0.2, w1 + 0.2, y + 1.6, (o.rise ?? 1.4) * Math.max(u1 - u0, w1 - w0) / 2, 'slate', 0.3);
  void R;
}

/**
 * A crenellated parapet along an open edge of a walkable rampart (the N range's roof): merlons on a low wall, its
 * inner face `inset` m in from the edge, gaps where a stair lands. pts: the edge (x, z), y: the walk, out: outward sign.
 */
export function rampartParapet(G, pts, y, { inside = CASTLE_C, gaps = [], depth = 0.42 } = {}) {
  const R = G.R;
  for (let k = 0; k + 1 < pts.length; k++) {
    const F = segFrame(pts[k], pts[k + 1], inside), L = F.L;
    const open = (u) => gaps.some(([gx, gz, gr]) => { const [x, z] = F.at(u, 0); return Math.hypot(x - gx, z - gz) < gr; });
    for (let u = 0; u < L - 0.05; u += 0.5) {
      const u1 = Math.min(L, u + 0.5);
      if (open((u + u1) / 2)) continue;
      segBox(G, 'ashlar', F, u, u1, -depth, 0.02, y - 0.02, y + 0.95, 0.95 + R() * 0.06);
      segBox(G, 'dressed', F, u, u1, -depth - 0.04, 0.06, y + 0.95, y + 1.05, 1.03);
    }
    for (let u = 0.3; u + 1.05 < L; u += 1.85) {
      if (open(u + 0.5)) continue;
      segBox(G, 'ashlar', F, u, u + 1.05, -depth, 0.02, y + 1.05, y + 1.8, 0.93 + R() * 0.08);
      segBox(G, 'dressed', F, u - 0.03, u + 1.08, -depth - 0.03, 0.05, y + 1.8, y + 1.88, 1.04);
    }
  }
}

// ---------------------------------------------------------------- the tower layout
/** A curtain stretch's frame (outward normal away from the castle) by structure id and segment index. */
function wallFrame(m, id, seg = 0) {
  const s = (m.structures || []).find((q) => q.id === id);
  if (!s?.points || s.points.length < seg + 2) return null;
  return segFrame(s.points[seg], s.points[seg + 1], CASTLE_C);
}

/**
 * The flanking towers (scenery): [{kind: 'round'|'d', …}]. Positions follow the mission's wall lines; every one stands
 * outside the parapet line (its walk stays as it is) or on the crag, clear of the shot lines the solution takes.
 */
export function towerPlan(m) {
  const out = [];
  const d = (id, seg, f, r, top, extra = {}) => { const F = wallFrame(m, id, seg); if (F) out.push({ kind: 'd', F, u: F.L * f, r, top, ...extra }); };
  // the SW bastion's outer corner, in the outer ward's moat: the castle's big round tower over the W pair's start
  out.push({ kind: 'round', x: 20.4, z: 92.4, r: 3.4, top: 15.2, face: Math.PI * 0.75, cone: 2.4 });
  // D towers out over the moat on the long curtain stretches
  d('cw_sw', 0, 0.5, 2.7, 11.2);
  d('cw_s', 0, 0.36, 2.8, 11.4);
  d('cw_s', 0, 0.7, 2.8, 11.4);
  d('cw_e1', 0, 0.52, 2.7, 11.2);
  d('cw_e2', 0, 0.48, 2.9, 11.6);
  d('cw_e2', 2, 0.52, 3.0, 11.8);
  // the N range's two outer corners, in the N moat (round, rising over the N rampart)
  out.push({ kind: 'round', x: 38.4, z: 10.9, r: 3.0, top: 17.5, face: -Math.PI * 0.75, cone: 2.5 });
  out.push({ kind: 'round', x: 110.8, z: 12.0, r: 2.7, top: 16.5, face: -Math.PI * 0.25, cone: 2.5 });
  return out;
}

/** Build the towers of `towerPlan(m)` into G (one Geo for all). @returns {object[]} the plan */
export function buildTowers(m, G) {
  const plan = towerPlan(m);
  for (const t of plan) {
    if (t.kind === 'round') roundTower(G, t);
    else dTower(G, t.F, t.u, t.r, { top: t.top });
  }
  return plan;
}

// ---------------------------------------------------------------- the gatehouses' crowns and the drawbridge
/**
 * Over a twin-tower gatehouse (castle-kit buildTwinGatehouse: towers with walkable tops at walkY, the walk crossing the
 * arch on a plank): a timber-framed fighting gallery on the arch's outer face (corbelled out, slate penthouse roof),
 * slate pavilion roofs on corner posts over each tower top (the walk passes under them), machicolation corbels.
 * o: {x, z, rot, w, d, walkY, passage}
 */
export function gateCrown(G, o) {
  const F = localFrame(o.x, o.z, o.rot ?? 0), W2 = (o.w ?? 12) / 2, D2 = (o.d ?? 8) / 2, Y = o.walkY ?? 7, P2 = (o.passage ?? 4.5) / 2;
  // the fighting gallery (hourd) hung out over the arch's outer face: oak brackets, a boarded front with loops
  const g0 = Y + 2.05, g1 = Y + 3.9;
  for (let u = -P2 - 0.4; u <= P2 + 0.41; u += 0.9) segBox(G, 'timber', F, u - 0.1, u + 0.1, D2 + 0.2, D2 + 1.25, g0 - 0.65, g0, 0.7);
  segBox(G, 'planks', F, -P2 - 0.6, P2 + 0.6, D2 + 0.25, D2 + 1.3, g0 - 0.05, g0 + 0.06, 0.8);
  segBox(G, 'boards', F, -P2 - 0.6, P2 + 0.6, D2 + 1.18, D2 + 1.3, g0, g1, 0.85);
  for (const s of [-1, 1]) segBox(G, 'boards', F, s * (P2 + 0.6) - 0.06, s * (P2 + 0.6) + 0.06, D2 + 0.25, D2 + 1.3, g0, g1, 0.8);
  for (let u = -P2; u <= P2 + 0.01; u += 1.1) segBox(G, 'iron', F, u - 0.05, u + 0.05, D2 + 1.3, D2 + 1.33, g0 + 0.7, g0 + 1.4, 0.15);
  for (let u = -P2 - 0.5; u <= P2 + 0.51; u += (2 * P2 + 1) / 4) segBox(G, 'timber', F, u - 0.07, u + 0.07, D2 + 1.18, D2 + 1.32, g0, g1, 0.6);
  // its penthouse roof, falling outwards
  {
    const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
    const flip = (F.t[0] * F.n[1] - F.t[1] * F.n[0]) < 0;
    const q = (a, b, c, dd) => (flip ? G.quad('slate', a, b, c, dd) : G.quad('slate', dd, c, b, a));
    q(P(-P2 - 0.9, D2 - 0.2, g1 + 1.3), P(P2 + 0.9, D2 - 0.2, g1 + 1.3), P(P2 + 0.9, D2 + 1.65, g1 - 0.1), P(-P2 - 0.9, D2 + 1.65, g1 - 0.1));
  }
  // the gate's upper wall rising over the arch to carry it (between the towers' tops, on the arch's outer face)
  segBox(G, 'ashlar', F, -P2 - 0.02, P2 + 0.02, D2 - 0.55, D2, Y + 1.0, g1 + 1.35, 1);
  segBox(G, 'dressed', F, -P2 - 0.1, P2 + 0.1, D2 - 0.62, D2 + 0.07, g1 + 1.32, g1 + 1.45, 1.05);
  // its crenellated top: the gate's fighting front over the gallery's roof
  for (let u = -P2 + 0.05; u + 0.8 <= P2 + 0.06; u += 1.35) {
    segBox(G, 'ashlar', F, u, u + 0.8, D2 - 0.55, D2, g1 + 1.45, g1 + 2.2, 0.95);
    segBox(G, 'dressed', F, u - 0.03, u + 0.83, D2 - 0.6, D2 + 0.05, g1 + 2.2, g1 + 2.3, 1.04);
  }
  // the gate chamber's roof over the arch, between the towers' tops (the walk crosses the arch beneath it on its
  // plank): oak corner posts on the towers' inner edges, wall plates, a slate saddle roof, boarded gables
  for (const s of [-1, 1]) for (const ww of [-D2 + 0.35, D2 - 0.35]) segBox(G, 'timber', F, s * (P2 + 0.15) - 0.13, s * (P2 + 0.15) + 0.13, ww - 0.13, ww + 0.13, Y + 0.95, Y + 3.15, 0.7);
  for (const ww of [-D2 + 0.35, D2 - 0.35]) segBox(G, 'timber', F, -P2 - 0.35, P2 + 0.35, ww - 0.15, ww + 0.15, Y + 3.0, Y + 3.25, 0.7);
  {
    const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
    const flip = (F.t[0] * F.n[1] - F.t[1] * F.n[0]) < 0;
    const q = (mat, a, b, c, dd, tn = 1) => (flip ? G.quad(mat, a, b, c, dd, tn) : G.quad(mat, dd, c, b, a, tn));
    const t = (mat, a, b, c, tn = 1) => (flip ? G.tri(mat, a, b, c, tn) : G.tri(mat, c, b, a, tn));
    const ua = -P2 - 0.55, ub = P2 + 0.55, we = D2 + 0.25, yE = Y + 3.2, yR = Y + 5.6;
    q('slate', P(ua, 0, yR), P(ub, 0, yR), P(ub, we, yE), P(ua, we, yE));
    q('slate', P(ub, 0, yR), P(ua, 0, yR), P(ua, -we, yE), P(ub, -we, yE));
    for (const [uu, sg] of [[ua + 0.2, -1], [ub - 0.2, 1]]) {
      if (sg > 0) t('boards', P(uu, -we + 0.3, yE), P(uu, we - 0.3, yE), P(uu, 0, yR - 0.15), 0.8);
      else t('boards', P(uu, we - 0.3, yE), P(uu, -we + 0.3, yE), P(uu, 0, yR - 0.15), 0.8);
    }
    segBox(G, 'lead', F, ua, ub, -0.12, 0.12, yR - 0.05, yR + 0.12, 0.85);
    const [fx, fz] = F.at(0, 0);
    G.cyl('iron', fx, yR + 0.1, fz, 0.035, 0.035, 1.4, 6, 0.4);
  }
}

/**
 * The SW gate's drawbridge look over the timber bridge (castle-kit buildMoatBridge keeps the deck and its rails: the
 * gameplay measures them): the lowered leaf's iron-strapped oak frame along the deck's edges at the gate end, the
 * lifting chains from its outer corners to the gate's chain slots, and the two counterpoise beams out of their slots
 * above the arch. o: the bridge {x, z, rot, w, d}, the gate's outer face as `face` {x, z} and its walk height.
 */
export function drawbridge(G, o) {
  const F = localFrame(o.x, o.z, o.rot ?? 0), L2 = o.w / 2, D2 = o.d / 2, leaf = o.leaf ?? 4.2, Y = o.walkY ?? 7;
  // the bridge's gate end is u = -L2 (towards the gatehouse); the leaf spans from the gate's face (its hinge: the drawn
  // deck stops at the threshold there, bridgeEnds) to u -L2 + leaf
  const uf = o.faceU ?? -L2 + 1.0; // the gate's outer face along the bridge
  const u0 = uf, u1 = -L2 + leaf;
  for (const s of [-1, 1]) {
    const w = s * (D2 + 0.12);
    segBox(G, 'timber', F, u0, u1, w - 0.14, w + 0.14, -0.35, 0.18, 0.62);                      // the leaf's side beam
    for (let u = u0 + 0.3; u < u1; u += 0.7) segBox(G, 'iron', F, u - 0.05, u + 0.05, w - 0.16, w + 0.16, -0.36, 0.19, 0.3); // straps
    // the lifting beam (flèche) out of its slot over the arch, to above the leaf's outer end, and its chain down
    const wb = s * (D2 - 0.25), yb = Y - 0.55;
    segBox(G, 'timber', F, uf - 0.4, u1 + 0.15, wb - 0.16, wb + 0.16, yb - 0.16, yb + 0.16, 0.58);
    segBox(G, 'iron', F, u1 - 0.05, u1 + 0.15, wb - 0.18, wb + 0.18, yb - 0.18, yb + 0.18, 0.25);
    segBox(G, 'iron', F, uf - 0.12, uf + 0.06, wb - 0.32, wb + 0.32, yb - 0.6, yb + 0.6, 0.12);           // the slot
    const [ax, az] = F.at(u1 - 0.1, w), [bx, bz] = F.at(u1 + 0.05, wb), n = 12;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 0.6) / n;
      const p0 = [ax + (bx - ax) * t0, 0.2 + (yb - 0.25 - 0.2) * t0, az + (bz - az) * t0];
      const p1 = [ax + (bx - ax) * t1, 0.2 + (yb - 0.25 - 0.2) * t1, az + (bz - az) * t1];
      G.box('iron', (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, k % 2 ? 0.05 : 0.09, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), k % 2 ? 0.09 : 0.05, F.rot, 0.3);
    }
  }
}

/**
 * The moat bridges' ends (user 2026-11-11: "Bridge and path overlap looks strange in the castle"). At the outer (+u)
 * end a dressed stone landing the deck rests on, square across the bridge (between the lantern piers, or the deck's
 * width and a hand), where the approach road — drawn squared onto the bridge's axis (the mission's render-only `art`
 * road) — ends; at the gate end a stone threshold across the passage at the gate's face, where the drawn deck stops
 * (scripts/m20-art.js: the gameplay deck runs on under the passage floor, measured as built). Scenery, never measured.
 * o: the bridge {x, z, rot, w, d}, `half` the landing's half-width, `landing` its [u0, u1], `gate` the threshold's
 * [u0, u1] and `gateHalf` (the passage's half-width), `y` the deck's top.
 */
export function bridgeEnds(G, o) {
  const F = localFrame(o.x, o.z, o.rot ?? 0), L2 = o.w / 2, D2 = o.d / 2, y = o.y ?? 0, R = G.R;
  const half = o.half ?? D2 + 0.15, [l0, l1] = o.landing ?? [L2 + 0.6, L2 + 1.5];
  // the landing: a course of big dressed slabs (joints across), its top a hand over the deck's, bedded on the
  // bridge's abutment (its top 0.12 under the deck) and in the bank — the deck's end and the piers' faces a hair off
  const n = Math.max(2, Math.round((2 * half) / 1.4));
  for (let k = 0; k < n; k++) {
    const w0 = -half + (2 * half * k) / n, w1 = -half + (2 * half * (k + 1)) / n;
    segBox(G, 'dressed', F, l0, l1, w0 + (k ? 0.012 : 0), w1, y - 0.1, y + 0.06, 0.9 + R() * 0.14);
  }
  if (o.gate) {
    const [g0, g1] = o.gate, gh = o.gateHalf ?? D2;
    segBox(G, 'dressed', F, g0, g1, -gh, gh, y - 0.06, y + 0.07, 1.04);              // the gate's threshold stone
  }
}

// ---------------------------------------------------------------- the keep (the HQ: objective o1)
/** A triangle fan over 3D points, wound so its normal points along `nrm` (any rough direction). */
export function fan(G, mat, pts, nrm, tone = 1) {
  if (pts.length < 3) return;
  const a = pts[0], b = pts[1], c = pts[2];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const ok = n[0] * nrm[0] + n[1] * nrm[1] + n[2] * nrm[2] >= 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    if (ok) G.tri(mat, pts[0], pts[i], pts[i + 1], tone); else G.tri(mat, pts[0], pts[i + 1], pts[i], tone);
  }
}
/** A face frame on an axis-aligned wall: 'S' (z = c, out +z), 'N' (z = c, out −z), 'E' (x = c, out +x), 'W'. */
function wallF(side, c) {
  if (side === 'S') return { t: [1, 0], n: [0, 1], at: (u, w) => [u, c + w] };
  if (side === 'N') return { t: [-1, 0], n: [0, -1], at: (u, w) => [-u, c - w] }; // (u = −x)
  if (side === 'E') return { t: [0, -1], n: [1, 0], at: (u, w) => [c + w, -u] }; // (u = −z)
  return { t: [0, 1], n: [-1, 0], at: (u, w) => [c - w, u] };                      // W (u = z)
}
export const fP = (Ff, u, w, y) => { const [x, z] = Ff.at(u, w); return [x, y, z]; };
export const fN = (Ff) => [Ff.n[0], 0, Ff.n[1]];
/** A straight timber (or iron) member from A to B: a box `t` thick, `wd` deep (its depth in the vertical plane through A-B). */
export function beam(G, mat, A, B, t = 0.12, wd = 0.2, tone = 0.7) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d) || 1, e = d.map((v) => v / L);
  // side: horizontal, square to the member; up: square to both (in the member's vertical plane)
  let sd = [-e[2], 0, e[0]]; const sl = Math.hypot(sd[0], sd[2]); sd = sl > 1e-6 ? [sd[0] / sl, 0, sd[2] / sl] : [1, 0, 0];
  const up = [e[1] * sd[2] - e[2] * sd[1], e[2] * sd[0] - e[0] * sd[2], e[0] * sd[1] - e[1] * sd[0]];
  const C = (P, a, b) => [P[0] + sd[0] * a + up[0] * b, P[1] + sd[1] * a + up[1] * b, P[2] + sd[2] * a + up[2] * b];
  const h = t / 2, v = wd / 2;
  const ring = (P) => [C(P, -h, -v), C(P, h, -v), C(P, h, v), C(P, -h, v)];
  const [a0, a1, a2, a3] = ring(A), [b0, b1, b2, b3] = ring(B), mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
  const face = (p, q, r, s2) => { const c = [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2, (p[2] + r[2]) / 2]; fan(G, mat, [p, q, r, s2], [c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]], tone); };
  face(a0, a1, b1, b0); face(a1, a2, b2, b1); face(a2, a3, b3, b2); face(a3, a0, b0, b3); face(a0, a3, a2, a1); face(b0, b1, b2, b3);
}

/** A gothic two-light window (bifora) on face Ff at u, sill y, light height h: dark lights, mullion, jambs, hood. */
function bifora(G, Ff, u, y, h = 1.9, wl = 0.42) {
  const half = wl + 0.06, tip = 0.42;
  for (const s of [-1, 1]) {
    const c = u + s * (wl / 2 + 0.06);
    segBox(G, 'iron', Ff, c - wl / 2, c + wl / 2, -0.02, 0.01, y, y + h, 0.12);
    fan(G, 'iron', [fP(Ff, c - wl / 2, 0.01, y + h), fP(Ff, c + wl / 2, 0.01, y + h), fP(Ff, c, 0.01, y + h + tip)], fN(Ff), 0.12);
  }
  segBox(G, 'dressed', Ff, u - 0.06, u + 0.06, 0, 0.07, y, y + h + 0.1, 1.05);                    // mullion
  for (const s of [-1, 1]) segBox(G, 'dressed', Ff, u + s * half - (s > 0 ? 0 : 0.14), u + s * half + (s > 0 ? 0.14 : 0), 0, 0.1, y - 0.05, y + h, 1.04); // jambs
  segBox(G, 'dressed', Ff, u - half - 0.2, u + half + 0.2, 0, 0.16, y - 0.2, y - 0.04, 1.0);      // sill
  // the pointed head's dressed surround and the hood-mould over it (two raking stones)
  for (const s of [-1, 1]) {
    const a = fP(Ff, u + s * (half + 0.14), 0.12, y + h), b = fP(Ff, u, 0.12, y + h + tip + 0.45);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ang = Math.atan2(Ff.t[1], Ff.t[0]);
    const g = new THREE.Object3D(); void g;
    // a raking dressed bar (box tilted in the face plane): built from its two ends
    const d = 0.13, P = (uu, yy, ww) => fP(Ff, uu, ww, yy);
    const u0 = u + s * (half + 0.14), u1 = u, y0 = y + h, y1 = y + h + tip + 0.45;
    const nx = -(y1 - y0), ny = (u1 - u0), nl = Math.hypot(nx, ny), ox = (nx / nl) * d, oy = (ny / nl) * d;
    const q = [P(u0 - ox, y0 - oy, 0.12), P(u1 - ox, y1 - oy, 0.12), P(u1 + ox, y1 + oy, 0.12), P(u0 + ox, y0 + oy, 0.12)];
    fan(G, 'dressed', q, fN(Ff), 1.06);
    void mx; void my; void mz; void L; void ang;
  }
  fan(G, 'ashlar', [fP(Ff, u - half - 0.06, 0.06, y + h), fP(Ff, u + half + 0.06, 0.06, y + h), fP(Ff, u, 0.06, y + h + tip + 0.32)], fN(Ff), 0.98); // tympanum
}
/** A narrow loop (arrow slit) with a dressed surround on face Ff. */
export function slit(G, Ff, u, y, h = 1.2) {
  segBox(G, 'iron', Ff, u - 0.07, u + 0.07, -0.02, 0.01, y, y + h, 0.1);
  segBox(G, 'dressed', Ff, u - 0.24, u + 0.24, 0, 0.06, y - 0.12, y, 1.04);
  segBox(G, 'dressed', Ff, u - 0.24, u + 0.24, 0, 0.06, y + h, y + h + 0.14, 1.04);
}
/** A small square window with a barred dark light and a chamfered dressed frame. */
function squareWin(G, Ff, u, y, s = 0.75) {
  segBox(G, 'iron', Ff, u - s / 2, u + s / 2, -0.02, 0.01, y, y + s, 0.14);
  for (let k = 1; k < 3; k++) segBox(G, 'iron', Ff, u - s / 2 + (k * s) / 3 - 0.02, u - s / 2 + (k * s) / 3 + 0.02, 0, 0.04, y, y + s, 0.35);
  segBox(G, 'dressed', Ff, u - s / 2 - 0.14, u + s / 2 + 0.14, 0, 0.08, y - 0.14, y, 1.03);
  segBox(G, 'dressed', Ff, u - s / 2 - 0.14, u + s / 2 + 0.14, 0, 0.08, y + s, y + s + 0.16, 1.05);
  for (const sg of [-1, 1]) segBox(G, 'dressed', Ff, u + sg * (s / 2) - (sg > 0 ? 0 : 0.14), u + sg * (s / 2) + (sg > 0 ? 0.14 : 0), 0, 0.08, y, y + s, 1.02);
}
/** Corbelled machicolation + crenellated parapet along face Ff from u0 to u1, its walk at y (as castle-kit's). */
function machParapet(G, Ff, u0, u1, y, R = Math.random, { crenels = [] } = {}) {
  for (let u = u0 + 0.35; u < u1 - 0.2; u += 0.8) segBox(G, 'dressed', Ff, u - 0.15, u + 0.15, 0, 0.55, y - 1.0, y - 0.05, 0.95, { taperOut: -0.35 });
  segBox(G, 'dressed', Ff, u0, u1, -0.05, 0.6, y - 0.12, y, 1.02);
  segBox(G, 'ashlar', Ff, u0, u1, 0.05, 0.6, y, y + 1.05, 0.97);
  segBox(G, 'dressed', Ff, u0, u1, 0.0, 0.65, y + 1.05, y + 1.15, 1.05);
  for (let u = u0 + 0.1; u + 1.15 < u1 + 0.01; u += 1.9) {
    if (crenels.some(([a, b]) => u < b && u + 1.15 > a)) continue;
    segBox(G, 'ashlar', Ff, u, u + 1.15, 0.05, 0.6, y + 1.15, y + 1.95, 0.93 + R() * 0.1);
    segBox(G, 'dressed', Ff, u - 0.03, u + 1.18, 0.0, 0.65, y + 1.95, y + 2.05, 1.04);
  }
}
/** A pointed-arched portal on face Ff at u: dark doorway, oak leaves, voussoirs, hood, steps out to `steps` m. */
export function portal(G, Ff, u, y, o2 = {}) {
  const { w = 1.8, h = 3.0, steps = 0.6 } = o2;
  const a = w / 2, spring = y + h - 0.9, rise = 1.1;
  for (let k = 0; k < 10; k++) {
    const u0 = -a + (2 * a * k) / 10, u1 = -a + (2 * a * (k + 1)) / 10;
    const top = Math.min(archY(u0, a, spring, rise), archY(u1, a, spring, rise));
    segBox(G, 'planks', Ff, u + u0, u + u1, -0.25, -0.18, y, top, 0.62 + (k % 2) * 0.06);
  }
  for (let yy = y + 0.6; yy < y + h - 0.6; yy += 0.75) segBox(G, 'iron', Ff, u - a, u + a, -0.18, -0.15, yy, yy + 0.07, 0.25);
  // the jambs and the voussoir ring (dressed), a hood-mould over it
  for (const s of [-1, 1]) segBox(G, 'dressed', Ff, u + s * a - (s > 0 ? 0 : 0.32), u + s * a + (s > 0 ? 0.32 : 0), -0.25, 0.12, y, spring, 1.05);
  const N = 14;
  for (let k = 0; k < N; k++) {
    const u0 = -a - 0.32 + ((2 * a + 0.64) * k) / N, u1 = -a - 0.32 + ((2 * a + 0.64) * (k + 1)) / N;
    const i0 = archY(Math.min(Math.abs(u0), a), a, spring, rise), i1 = archY(Math.min(Math.abs(u1), a), a, spring, rise);
    const o0 = archY(Math.min(Math.abs(u0), a + 0.32), a + 0.32, spring, rise + 0.32), o1 = archY(Math.min(Math.abs(u1), a + 0.32), a + 0.32, spring, rise + 0.32);
    fan(G, 'dressed', [fP(Ff, u + u0, 0.12, Math.max(i0, spring)), fP(Ff, u + u1, 0.12, Math.max(i1, spring)), fP(Ff, u + u1, 0.12, o1), fP(Ff, u + u0, 0.12, o0)], fN(Ff), k % 2 ? 1.07 : 0.98);
  }
  segBox(G, 'dressed', Ff, u - a - 0.55, u + a + 0.55, 0, 0.2, spring + rise + 0.45, spring + rise + 0.62, 1.04);
  // the steps (the porch flight in front of the door: within the château's stair footprint)
  // (the sill stands `rise` over the terrace: three steps up to it)
  const y0s = y - (o2.rise ?? 0.45);
  for (let k = 0; k < 3; k++) segBox(G, 'dressed', Ff, u - a - 0.6 + k * 0.08, u + a + 0.6 - k * 0.08, 0, steps - k * (steps / 3), y0s + k * 0.15, y0s + (k + 1) * 0.15, 0.95 + k * 0.03);
}

/**
 * The keep (the HQ, x0..x1 × z0..z1 on its terrace at y0): a tall square donjon at the back (machicolated parapet,
 * corner bartizans, a steep slate pyramid), the hall range in front (gothic two-light windows, the pointed portal and
 * its steps, a corbelled parapet, a saddle roof with dormers), the low E block whose roof terrace is the roof ledge
 * (parapet with crenels where the ladders cross), the round SW corner tower rising from the moat, a garderobe on the
 * W face over the water, the plinth down into the moat. o: {x0, x1, z0, z1, y0, tower: [x, z, r], seed}
 * The grid keeps the château's footprints (the library sidecar): the walls stand on them.
 */
export function buildKeep(o) {
  const G = new Geo(o.seed ?? 'keep'), R = G.R;
  const { x0, x1, z0, z1, y0 } = o, xm = o.xm ?? 19.5, zh = o.zh ?? 53, zE = o.zE ?? 48.5;
  const yHall = y0 + 13, yDon = y0 + 20, yE = y0 + 7;            // wall tops: hall range, donjon, E block terrace
  const [tx, tz, tr] = o.tower ?? [5.9, 59.6, 2.8];
  // ---- the plinth: the W face down into the moat (battered rubble, a dressed offset at the terrace)
  segBox(G, 'rubble', wallF('W', x0), z0, z1, -0.02, 0.5, BED_Y, 3.0, 0.9, { taperOut: 0.45 });
  segBox(G, 'ashlar', wallF('W', x0), z0, z1, -0.02, 0.5, 2.9, y0 - 0.4, 0.96);
  segBox(G, 'dressed', wallF('W', x0), z0, z1, -0.02, 0.62, y0 - 0.45, y0 - 0.2, 1.03);
  // ---- the bodies (solid ashlar boxes; the faces carry the details)
  const body = (bx0, bx1, bz0, bz1, top, tone = 1) => G.prism('ashlar', [[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1]], y0 - 0.4, top, tone, { top: false });
  body(x0, xm, zh, z1, yHall, 1.0);            // hall range
  body(x0, xm, z0, zh, yDon, 0.97);            // donjon
  body(xm, x1, z0, z1, yE, 1.02);              // E block (its roof terrace: the roof ledge)
  // the plinth course and the string courses on the visible faces
  // (flush with the faces: nothing stands proud of the footprint at body height — bodies are laid against these walls,
  // M20 e40 under the SE corner; the porch flight is the château's stair footprint)
  for (const [side, c, ua, ub] of [['S', z1, x0, x1], ['E', x1, -z1, -z0]]) {
    const Ff = wallF(side, c);
    segBox(G, 'rubble', Ff, ua, ub, -0.02, 0.012, y0 - 0.4, y0 + 0.55, 0.9);
    segBox(G, 'dressed', Ff, ua, ub, -0.02, 0.015, y0 + 0.5, y0 + 0.66, 1.03);
  }
  for (const yy of [y0 + 4.6, y0 + 9.4]) segBox(G, 'dressed', wallF('S', z1), x0, xm, -0.02, 0.12, yy, yy + 0.16, 1.04);
  for (const yy of [y0 + 4.6, y0 + 9.4, y0 + 14.4]) for (const [side, c, ua, ub] of [['W', x0, z0, z1], ['E', xm, -zh, -z0], ['N', z0, -xm, -x0]]) segBox(G, 'dressed', wallF(side, c), ua, ub, -0.02, 0.12, yy, yy + 0.16, 1.04);
  // quoins: alternating long and short dressed stones at the donjon's and the hall's outer corners
  for (const [qx, qz] of [[x0, z0], [xm, z0], [xm, zh], [x1, z1], [x1, z0]]) {
    const top = qz === z0 && qx !== x1 ? yDon : qx === x1 ? yE : yHall;
    for (let yy = y0 + 2.1, k = 0; yy < top - 0.3; yy += 0.42, k++) {
      const l = k % 2 ? 0.55 : 0.95;
      G.box('dressed', qx, yy + 0.2, qz, (k % 2 ? l : 0.36) + 0.06, 0.4, (k % 2 ? 0.36 : l) + 0.06, 0, 1.02 + R() * 0.04);
    }
  }
  // ---- the hall range's S face: the portal, three gothic two-light windows on the hall floor, loops and squares
  const S = wallF('S', z1);
  portal(G, S, o.door ?? 12, y0 + 0.45, { w: 1.8, h: 3.2, steps: 0.62, rise: 0.45 });
  for (const u of [9.0, 16.6]) squareWin(G, S, u, y0 + 2.2, 0.7);
  for (const u of [7.6, 11.9, 16.2]) bifora(G, S, u, y0 + 5.4, 2.1);
  for (const u of [6.7, 9.8, 13.9, 17.0]) squareWin(G, S, u, y0 + 10.2, 0.6);
  machParapet(G, S, x0 + 2.6, xm + 0.6, yHall, R);
  // the hall's saddle roof (ridge along x) behind its parapet, three dormers on its S slope
  {
    const yr0 = yHall + 0.2, rise = 6.4, zc = (zh + z1) / 2, ov = 0.15;
    const A = [x0 + 0.4, yr0, z1 - 0.7 + ov], B = [xm + 0.1, yr0, z1 - 0.7 + ov], C = [xm + 0.1, yr0 + rise, zc], D = [x0 + 0.4, yr0 + rise, zc];
    fan(G, 'slate', [A, B, C, D], [0, 1, 1]);
    const A2 = [xm + 0.1, yr0, zh + 0.5], B2 = [x0 + 0.4, yr0, zh + 0.5];
    fan(G, 'slate', [A2, B2, D, C], [0, 1, -1]);
    // the gables: the E one over the E block's terrace (a loop), the W one over the moat behind the SW tower
    fan(G, 'ashlar', [[xm, yr0 - 0.2, zh + 0.5], [xm, yr0 - 0.2, z1 - 0.7], [xm, yr0 + rise - 0.1, zc]], [1, 0, 0], 0.98);
    fan(G, 'ashlar', [[x0 + 0.4, yr0 - 0.2, zh + 0.5], [x0 + 0.4, yr0 - 0.2, z1 - 0.7], [x0 + 0.4, yr0 + rise - 0.1, zc]], [-1, 0, 0], 0.96);
    slit(G, wallF('E', xm), -zc, yr0 + 1.4, 1.4);
    segBox(G, 'lead', localFrame(0, 0, 0), x0 + 0.4, xm + 0.1, zc - 0.12, zc + 0.12, yr0 + rise - 0.05, yr0 + rise + 0.12, 0.85);
    for (const u of [8.4, 12.0, 15.6]) {
      const zf = z1 - 2.4, yb = yr0 + (rise * (z1 - 0.7 - zf)) / (z1 - 0.7 - zc);
      G.box('ashlar', u, yb + 0.75, zf + 0.25, 1.3, 1.5, 0.5, 0, 0.98);
      segBox(G, 'iron', S, u - 0.32, u + 0.32, -2.2, -2.14, yb + 0.25, yb + 1.15, 0.14);
      fan(G, 'slate', [[u - 0.85, yb + 1.5, zf + 0.6], [u + 0.85, yb + 1.5, zf + 0.6], [u, yb + 2.35, zf + 0.6]], [0, 0, 1], 0.95);
      fan(G, 'slate', [[u - 0.85, yb + 1.5, zf + 0.6], [u, yb + 2.35, zf + 0.6], [u, yb + 2.35, zf - 1.1], [u - 0.85, yb + 1.5, zf - 1.1]], [-1, 1, 0], 0.95);
      fan(G, 'slate', [[u + 0.85, yb + 1.5, zf + 0.6], [u + 0.85, yb + 1.5, zf - 1.1], [u, yb + 2.35, zf - 1.1], [u, yb + 2.35, zf + 0.6]], [1, 1, 0], 0.95);
    }
  }
  // ---- the donjon: loops, paired windows high up, the machicolated parapet, corner bartizans, the slate pyramid
  for (const [side, c, ua, ub] of [['S', zh, x0, xm], ['E', xm, -zh, -z0], ['W', x0, z0, zh], ['N', z0, -xm, -x0]]) {
    const Ff = wallF(side, c), L = ub - ua, ys = side === 'E' ? y0 + 9.2 : y0 + 3;
    if (side !== 'S') for (let k = 0; k < 3; k++) slit(G, Ff, ua + (L * (k + 0.5)) / 3, ys + (k % 2) * 3.0, 1.3);
    for (let k = 0; k < 2; k++) bifora(G, Ff, ua + (L * (k + 1)) / 3, y0 + 14.6, 1.7, 0.36);
    machParapet(G, Ff, ua - 0.3, ub + 0.3, yDon, R);
  }
  for (const [bx, bz, a] of [[xm + 0.3, z0 - 0.3, -Math.PI / 4], [x0 - 0.3, z0 - 0.3, -Math.PI * 0.75], [xm + 0.3, zh + 0.3, Math.PI / 4], [x0 - 0.3, zh + 0.3, Math.PI * 0.75]]) {
    bartizan(G, bx, bz, yDon + 1.15, 1.35, 20);
    void a;
  }
  {
    const inset = 1.0, yr0 = yDon + 0.9, ax = (x0 + xm) / 2, az = (z0 + zh) / 2, hgt = 9.5;
    const c0 = [x0 + inset, yr0, z0 + inset], c1 = [xm - inset, yr0, z0 + inset], c2 = [xm - inset, yr0, zh - inset], c3 = [x0 + inset, yr0, zh - inset], ap = [ax, yr0 + hgt, az];
    fan(G, 'slate', [c3, c2, ap], [0, 1, 1]); fan(G, 'slate', [c1, c0, ap], [0, 1, -1]);
    fan(G, 'slate', [c2, c1, ap], [1, 1, 0]); fan(G, 'slate', [c0, c3, ap], [-1, 1, 0]);
    G.cyl('lead', ax, yr0 + hgt - 0.3, az, 0.22, 0.06, 0.9, 8, 0.8);
    G.cyl('iron', ax, yr0 + hgt + 0.4, az, 0.04, 0.04, 2.2, 6, 0.4);
    G.box('iron', ax + 0.32, yr0 + hgt + 2.1, az, 0.7, 0.36, 0.03, 0.4, 0.35);
    // lucarnes on the pyramid's S and W faces
    for (const [lx, lz, f] of [[ax, zh - inset - 1.9, Math.PI / 2], [x0 + inset + 1.9, az, Math.PI], [xm - inset - 1.9, az, 0]]) {
      const yb = yr0 + 2.3, dx = Math.cos(f), dz = Math.sin(f);
      G.box('ashlar', lx, yb + 0.6, lz, Math.abs(dx) > 0.5 ? 0.6 : 1.2, 1.2, Math.abs(dx) > 0.5 ? 1.2 : 0.6, 0, 0.98);
      G.box('iron', lx + dx * 0.31, yb + 0.6, lz + dz * 0.31, Math.abs(dx) > 0.5 ? 0.02 : 0.6, 0.7, Math.abs(dx) > 0.5 ? 0.6 : 0.02, 0, 0.14);
      G.cyl('slate', lx, yb + 1.2, lz, 0.85, 0.05, 1.0, 4, 0.95, { a0: Math.PI / 4 });
    }
  }
  // the chimney stacks, where the château's flues smoke (render/fx.js reads its model's smoke anchors: o.chimneys
  // [[x, z, y]], the smoke rising from y inside each stack): through the donjon's roof, against its S face over the hall
  // range, and the kitchen stack on the E block's terrace
  // (through the donjon's slate pyramid, a stack clears its slope by a metre)
  const pyramidAt = (x, z) => { const ax = (x0 + xm) / 2, az = (z0 + zh) / 2, h = (xm - x0) / 2 - 1.0; return yDon + 0.9 + 9.5 * Math.max(0, 1 - Math.max(Math.abs(x - ax), Math.abs(z - az)) / h); };
  for (const [cx, cz, cy] of o.chimneys ?? []) {
    const inDon = cz < zh && cx < xm, base = inDon ? yDon : cz < zh + 9 && cx < xm ? yHall : yE;
    const top = Math.max(cy + 0.9, base + 1.5, inDon ? pyramidAt(cx, cz) + 1.0 : -Infinity);
    G.box('ashlar', cx, (base + top) / 2, cz, 1.0, top - base, 1.0, 0, 0.92);
    G.box('dressed', cx, top + 0.09, cz, 1.2, 0.18, 1.2, 0, 1.0);
    for (const ox of [-0.25, 0.25]) G.box('rubble', cx + ox, top + 0.42, cz, 0.28, 0.5, 0.28, 0, 0.7); // clay pots
  }
  // the garderobe on the donjon's W face, corbelled out over the moat, its chute down the plinth
  {
    const W = wallF('W', x0), u = (z0 + zh) / 2 + 2, yb = y0 + 8.0;
    for (const du of [-0.6, 0, 0.6]) segBox(G, 'dressed', W, u + du - 0.15, u + du + 0.15, 0, 0.9, yb - 1.0, yb, 0.95, { taperOut: -0.6 });
    segBox(G, 'ashlar', W, u - 0.9, u + 0.9, 0, 1.1, yb, yb + 2.4, 0.97);
    hipRoof(G, W, u - 0.9, u + 0.9, 0, 1.1, yb + 2.4, 0.7, 'slate', 0.15);
    segBox(G, 'iron', W, u - 0.25, u + 0.25, 1.1, 1.12, yb + 0.9, yb + 1.6, 0.14);
    segBox(G, 'rubble', W, u - 0.5, u + 0.5, 0.45, 0.95, BED_Y + 0.2, yb - 1.0, 0.7);
  }
  // ---- the E block: its roof terrace (the roof ledge: flags, parapets with crenels where the ladders cross); its E
  // face meets the wing (z < 52) and the turret (z 54.5-59.5): nothing proud of it at body height
  {
    const top = yE, Sx = wallF('S', z1), Ex = wallF('E', x1), Nx = wallF('N', z0);
    flatPoly(G, 'flags', [[xm, z0], [x1, z0], [x1, z1], [xm, z1]], top - 0.02, 1);
    const cren = o.crenels ?? [[24.55, 25.65]];
    const wallRun = (Ff, ua, ub, crenels = []) => {
      segBox(G, 'ashlar', Ff, ua, ub, -0.45, 0.08, top, top + 1.05, 0.97);
      segBox(G, 'dressed', Ff, ua, ub, -0.5, 0.12, top + 1.05, top + 1.15, 1.04);
      for (let u = ua + 0.2; u + 1.0 < ub - 0.1; u += 1.75) {
        if (crenels.some(([a, b]) => u < b && u + 1.0 > a)) continue;
        segBox(G, 'ashlar', Ff, u, u + 1.0, -0.45, 0.08, top + 1.15, top + 1.9, 0.94 + R() * 0.08);
      }
    };
    wallRun(Sx, xm, x1, cren);                                                   // the S parapet: a crenel at L_hq1
    for (const [za, zb] of [[z0, 52.0], [52.0, 55.4], [60.5, z1]]) wallRun(Ex, -zb, -za); // open where L_hq2 crosses to the turret
    wallRun(Nx, -x1, -xm);
    for (const u of [20.7, 23.0]) bifora(G, Sx, u, y0 + 2.7, 2.0, 0.34);
    slit(G, Ex, -61.0, y0 + 3.2, 1.2);
    slit(G, Ex, -53.2, y0 + 3.2, 1.2);
  }
  // ---- the round SW tower: from the moat's bed to its gallery over the hall's eaves, a tall slate cone
  roundTower(G, { x: tx, z: tz, r: tr, y0: BED_Y, top: yHall + 3.6, face: Math.PI * 0.8, cone: 2.6, legacyLoops: o.legacyLoops });
  return G.build(o.name || 'm20:keep', { ground: y0 });
}

/**
 * The keep after the Sapper's charge: the hall range and the E block gutted to jagged wall stumps, the donjon's upper
 * storeys fallen in (a broken crown), every roof gone, charred beams, rubble banks inside and along the walls, the SW
 * tower's top torn off. Same footprints. o: as buildKeep
 */
export function buildKeepRuin(o) {
  const G = new Geo(`${o.seed ?? 'keep'}:ruin`), R = G.R;
  const { x0, x1, z0, z1, y0 } = o, xm = o.xm ?? 19.5, zh = o.zh ?? 53, zE = o.zE ?? 48.5;
  const [tx, tz, tr] = o.tower ?? [5.9, 59.6, 2.8];
  segBox(G, 'rubble', wallF('W', x0), z0, z1, -0.02, 0.5, BED_Y, 3.0, 0.75, { taperOut: 0.45 });
  segBox(G, 'ashlar', wallF('W', x0), z0, z1, -0.02, 0.5, 2.9, y0 - 0.4, 0.8);
  /** A wall (thickness 0.9) along a face from ua to ub, its top a jagged line between lo and hi. */
  const stump = (side, c, ua, ub, lo, hi) => {
    const Ff = wallF(side, c);
    for (let u = ua; u < ub - 1e-3; u += 0.9) {
      const u1 = Math.min(ub, u + 0.9), top = y0 + lo + (hi - lo) * Math.pow(R(), 0.8);
      segBox(G, 'ashlar', Ff, u, u1, -0.9, 0, y0 - 0.4, top, 0.62 + R() * 0.2);
      if (R() < 0.35) segBox(G, 'rubble', Ff, u, u1, -0.9, 0, top - 0.02, top + 0.3, 0.45);
    }
  };
  stump('S', z1, x0, xm, 3, 9); stump('S', z1, xm, x1, 1.5, 5); stump('E', x1, -z1, -z0, 1.5, 6);
  stump('W', x0, z0, z1, 4, 14); stump('N', z0, -x1, -x0, 5, 15); stump('E', xm, -zh, -z0, 6, 16); stump('S', zh, x0 + 3, xm, 4, 12);
  // rubble banks and fallen blocks inside the footprint, charred beams across them
  for (let k = 0; k < 26; k++) {
    const x = x0 + 1 + R() * (x1 - x0 - 2), z = z0 + 1 + R() * (z1 - z0 - 2), s = 1.2 + R() * 2.4;
    G.box('rubble', x, y0 + s * 0.25, z, s, s * 0.55, s * (0.7 + R() * 0.6), R() * 3, 0.5 + R() * 0.25, 0.45);
  }
  for (let k = 0; k < 9; k++) {
    const x = x0 + 2 + R() * (x1 - x0 - 4), z = z0 + 2 + R() * (z1 - z0 - 4);
    G.box('timber', x, y0 + 1.1 + R() * 1.4, z, 4 + R() * 3, 0.3, 0.3, R() * 3, 0.18, 0);
  }
  // the SW tower, its top torn off
  G.cyl('rubble', tx, BED_Y, tz, tr + 0.75, tr, 3.6, 24, 0.8, { caps: false });
  for (let k = 0; k < 14; k++) {
    const a0 = (k / 14) * TAU, h = 9 + R() * 9;
    G.cyl('ashlar', tx, BED_Y, tz, tr, tr, h - BED_Y + y0 * 0, 3, 0.62 + R() * 0.2, { caps: false, a0, arc: TAU / 14 });
  }
  return G.build(`${o.name || 'm20:keep'}:ruin`, { ground: y0, moss: 0 });
}

// ---------------------------------------------------------------- the bailey's medieval buildings
/**
 * A saddle roof over local rect u0..u1 × w0..w1 (ridge along u) from eave height ye to ridge yr, overhanging `oh`,
 * with optional hips at the ends (`hip` 0..1 of the half-width) and a ridge capping. Wound for any frame handedness.
 */
export function saddle(G, F, u0, u1, w0, w1, ye, yr, mat = 'tiles', { oh = 0.45, ohU0 = oh, ohU1 = oh, hip = 0, gables = true, gableMat = 'daub', cap = 'lead' } = {}) {
  const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
  // (ohU0 / ohU1: the verge at each gable end — 0 where the gable stands against a curtain)
  const wm = (w0 + w1) / 2, ua = u0 - ohU0, ub = u1 + ohU1, wa = w0 - oh, wb = w1 + oh;
  const hu = hip * (w1 - w0) / 2, yeo = ye - oh * (yr - ye) / ((w1 - w0) / 2); // the eave drops with the overhang
  const up = [0, 1, 0];
  const n0 = [-F.n[0], 0.9, -F.n[1]], n1 = [F.n[0], 0.9, F.n[1]], t0 = [-F.t[0], 0.9, -F.t[1]], t1 = [F.t[0], 0.9, F.t[1]];
  void up;
  fan(G, mat, [P(ua, wa, yeo), P(ub, wa, yeo), P(ub - hu, wm, yr), P(ua + hu, wm, yr)], n0);
  fan(G, mat, [P(ub, wb, yeo), P(ua, wb, yeo), P(ua + hu, wm, yr), P(ub - hu, wm, yr)], n1);
  if (hu > 0) {
    fan(G, mat, [P(ua, wb, yeo), P(ua, wa, yeo), P(ua + hu, wm, yr)], t0);
    fan(G, mat, [P(ub, wa, yeo), P(ub, wb, yeo), P(ub - hu, wm, yr)], t1);
  } else if (gables) {
    fan(G, gableMat, [P(u0, w0, ye), P(u0, w1, ye), P(u0, wm, yr - 0.05)], t0, 0.97);
    fan(G, gableMat, [P(u1, w1, ye), P(u1, w0, ye), P(u1, wm, yr - 0.05)], t1, 0.97);
    // barge boards along the gables' raking edges
    for (const u of [ua + 0.02, ub - 0.02]) for (const [wA, wB] of [[wa, wm], [wb, wm]]) beam(G, 'oak', P(u, wA, yeo + 0.02), P(u, wB, yr + 0.06), 0.1, 0.24, 0.7);
  }
  if (cap) segBox(G, cap, F, ua + hu, ub - hu, wm - 0.13, wm + 0.13, yr - 0.06, yr + 0.1, 0.8);
}

/** Timber framing (Fachwerk) on a wall face: sill and head beams, posts every ~1.2 m, braces, a rail at mid height. */
function fachwerk(G, Ff, u0, u1, y0, y1, R, { braces = true } = {}) {
  const w = 0.04;
  segBox(G, 'oak', Ff, u0, u1, 0, w + 0.03, y0, y0 + 0.22, 0.7);
  segBox(G, 'oak', Ff, u0, u1, 0, w + 0.03, y1 - 0.22, y1, 0.7);
  const ym = y0 + (y1 - y0) * 0.5;
  segBox(G, 'oak', Ff, u0, u1, 0, w, ym - 0.08, ym + 0.08, 0.68);
  const n = Math.max(2, Math.round((u1 - u0) / 1.25)), du = (u1 - u0) / n;
  for (let i = 0; i <= n; i++) segBox(G, 'oak', Ff, u0 + i * du - 0.1, u0 + i * du + 0.1, 0, w + 0.02, y0 + 0.2, y1 - 0.2, 0.66 + R() * 0.08);
  if (!braces) return;
  for (let i = 0; i < n; i++) {
    if ((i + Math.floor(R() * 2)) % 3) continue;
    const ua = u0 + i * du + 0.1, ub = u0 + (i + 1) * du - 0.1, flip = R() < 0.5;
    const A = fP(Ff, flip ? ua : ub, w * 0.5, y0 + 0.22), B = fP(Ff, flip ? ub : ua, w * 0.5, ym - 0.08);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), ang = Math.atan2(Ff.t[1], Ff.t[0]);
    const g = new THREE.Object3D(); void g; void ang;
    // a brace: a thin box between A and B in the face plane, built as a quad pair (front + edge suffice at range)
    const ex = 0.09, nx = -(B[1] - A[1]) / L, du2 = ((flip ? 1 : -1) * (ub - ua)) / L;
    const off = (p, s) => fP(Ff, (p === A ? (flip ? ua : ub) : (flip ? ub : ua)) + s * ex * nx, w * 0.5 + 0.02, (p === A ? y0 + 0.22 : ym - 0.08) + s * ex * du2);
    fan(G, 'oak', [off(A, -1), off(B, -1), off(B, 1), off(A, 1)], fN(Ff), 0.64);
  }
}

/** A plank door with strap hinges and a stone threshold on face Ff (u centre, width dw, height dh, sill y). */
function plankDoor(G, Ff, u, y, dw = 1.1, dh = 2.0, { arch = 0 } = {}) {
  segBox(G, 'doorboards', Ff, u - dw / 2, u + dw / 2, -0.05, 0.03, y, y + dh, 0.75);
  for (const yy of [y + 0.35, y + dh - 0.4]) segBox(G, 'iron', Ff, u - dw / 2 + 0.05, u + dw * 0.25, 0.03, 0.05, yy, yy + 0.07, 0.25);
  segBox(G, 'oak', Ff, u - dw / 2 - 0.16, u - dw / 2, 0, 0.08, y, y + dh + 0.12, 0.62);
  segBox(G, 'oak', Ff, u + dw / 2, u + dw / 2 + 0.16, 0, 0.08, y, y + dh + 0.12, 0.62);
  segBox(G, 'oak', Ff, u - dw / 2 - 0.2, u + dw / 2 + 0.2, 0, 0.1, y + dh, y + dh + 0.18, 0.62);
  if (arch) fan(G, 'dressed', [fP(Ff, u - dw / 2 - 0.2, 0.09, y + dh + 0.18), fP(Ff, u + dw / 2 + 0.2, 0.09, y + dh + 0.18), fP(Ff, u, 0.09, y + dh + 0.18 + arch)], fN(Ff), 1.0);
}
/** A small shuttered window: dark light, oak frame, one shutter folded back. */
function shutterWin(G, Ff, u, y, s = 0.6, R = Math.random) {
  segBox(G, 'iron', Ff, u - s / 2, u + s / 2, -0.02, 0.01, y, y + s * 1.15, 0.14);
  segBox(G, 'oak', Ff, u - s / 2 - 0.08, u + s / 2 + 0.08, 0, 0.07, y - 0.08, y, 0.62);
  segBox(G, 'oak', Ff, u - s / 2 - 0.08, u + s / 2 + 0.08, 0, 0.07, y + s * 1.15, y + s * 1.15 + 0.08, 0.62);
  const side = R() < 0.5 ? -1 : 1;
  segBox(G, 'doorboards', Ff, u + side * (s / 2 + 0.06) - (side > 0 ? 0 : s * 0.55), u + side * (s / 2 + 0.06) + (side > 0 ? s * 0.55 : 0), 0.04, 0.08, y, y + s * 1.15, 0.7);
}
/** A stone chimney stack at local (u, w) rising from below the roof to yTop. */
function chimneyStack(G, F, u, w, y0, yTop, mat = 'rubble') {
  const [x, z] = F.at(u, w);
  G.box(mat, x, (y0 + yTop) / 2, z, 0.85, yTop - y0, 0.85, F.rot ?? Math.atan2(F.t[1], F.t[0]), 0.9);
  G.box('dressed', x, yTop + 0.08, z, 1.0, 0.16, 1.0, F.rot ?? Math.atan2(F.t[1], F.t[0]), 1.02);
  G.box('iron', x, yTop + 0.2, z, 0.45, 0.1, 0.45, 0, 0.1);
}

/**
 * A medieval bailey building on local rect u0..u1 × w0..w1 (frame at x, z, rot: u along the ridge), eaves at ye, ridge
 * at yr. o.kind: 'stable' (Fachwerk over a stone plinth, stable doors, a hay loft with its hoist), 'smithy' (stone, the
 * forge's lean-to open at the +u end with its hood and anvil), 'guard' (stone, red sandstone dressings, a bell-cote),
 * 'house' (stone ground floor, jettied Fachwerk front), 'store' (Fachwerk on staddle stones), 'workshop' (Fachwerk),
 * 'lodge' (stone lean-to). o.doors: [[face 'S'|'N', u]], o.chimney: u | null, o.roof: material.
 */
export function bailyBuilding(G, o) {
  const F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R;
  const { u0, u1, w0, w1 } = o, ye = o.ye ?? 2.5, yr = o.yr ?? 5.4, k = o.kind ?? 'workshop', roof = o.roof ?? 'tiles';
  const stone = k === 'smithy' || k === 'guard' || k === 'lodge';
  // faces in this frame: S = +w side, N = −w side, E = +u end, W = −u end
  const face = (f) => {
    if (f === 'S') return { t: F.t, n: F.n, at: (u, w) => F.at(u, w1 + w) };
    if (f === 'N') return { t: [-F.t[0], -F.t[1]], n: [-F.n[0], -F.n[1]], at: (u, w) => F.at(-u, w0 - w) };
    if (f === 'E') return { t: F.n, n: F.t, at: (u, w) => F.at(u1 + w, u) };
    return { t: [-F.n[0], -F.n[1]], n: [-F.t[0], -F.t[1]], at: (u, w) => F.at(u0 - w, -u) };
  };
  const len = { S: [u0, u1], N: [-u1, -u0], E: [w0, w1], W: [-w1, -w0] };
  // the body: plinth, walls (stone or framed daub), the eave plate
  const plinthTop = stone ? ye : 0.55;
  segBox(G, k === 'guard' ? 'ashlar' : 'rubble', F, u0, u1, w0, w1, -0.1, plinthTop, 0.95);
  if (!stone) segBox(G, 'daub', F, u0 + 0.02, u1 - 0.02, w0 + 0.02, w1 - 0.02, plinthTop, ye, 1.0);
  for (const f of ['S', 'N', 'E', 'W']) {
    const Ff = face(f), [a, b] = len[f];
    if (!stone) fachwerk(G, Ff, a, b, plinthTop, ye, R, { braces: f === 'S' || f === 'N' });
    else if (k === 'guard') { for (const [qa] of [[a], [b - 0.5]]) for (let yy = 0.3, j = 0; yy < ye - 0.2; yy += 0.4, j++) segBox(G, 'redstone', Ff, qa + (j % 2 ? 0.1 : 0), qa + 0.5, 0, 0.03, yy, yy + 0.38, 0.95 + R() * 0.08); }
  }
  // gable ends: daub with framing (or stone), a loft door / louvre
  const oh = o.oh ?? 0.45;
  saddle(G, F, u0, u1, w0, w1, ye, yr, roof, { oh, ohU0: o.wallEnd === 'W' ? 0 : oh, ohU1: o.wallEnd === 'E' ? 0 : oh, hip: o.hip ?? 0, gableMat: stone ? 'rubble' : 'daub' });
  if (!(o.hip > 0)) for (const f of ['E', 'W']) {
    const Ff = face(f), wm = (w0 + w1) / 2 * (f === 'E' ? 1 : -1);
    if (!stone) {
      segBox(G, 'oak', Ff, wm - 0.1, wm + 0.1, 0, 0.06, ye, yr - 0.3, 0.66);
      // the collar: as wide as the gable is at its height (it ran the full face and stood out through the roof's
      // raking edges, review 2026-11-11)
      const yc = ye + (yr - ye) * 0.45, span = ((len[f][1] - len[f][0]) / 2) * (1 - 0.45) - 0.15;
      segBox(G, 'oak', Ff, wm - span, wm + span, 0, 0.06, yc, yc + 0.16, 0.66);
    }
    if (k === 'stable' && f === 'E') { plankDoor(G, Ff, wm, ye + 0.15, 0.9, 1.0); const [hx, hz] = Ff.at(wm, 0.5); G.box('oak', hx, yr - 0.6, hz, 1.3, 0.18, 0.18, Math.atan2(Ff.n[1], Ff.n[0]), 0.62); } // the hoist beam out of the loft
    else segBox(G, 'iron', Ff, wm - 0.18, wm + 0.18, 0, 0.02, ye + 0.7, ye + 1.2, 0.14);
  }
  // doors and windows on the long faces
  for (const [f, u, kind] of o.doors ?? [['S', (u0 + u1) / 2]]) {
    const Ff = face(f), uu = f === 'S' ? u : -u;
    if (kind === 'stable') { plankDoor(G, Ff, uu, 0.05, 1.5, 2.1); segBox(G, 'oak', Ff, uu - 0.75, uu + 0.75, 0.04, 0.09, 1.05, 1.13, 0.6); }
    else plankDoor(G, Ff, uu, 0.05, 1.05, 2.0, { arch: stone ? 0.3 : 0 });
    segBox(G, 'dressed', Ff, uu - 0.75, uu + 0.75, 0, 0.35, -0.08, 0.05, 0.92); // threshold stone
  }
  for (const f of ['S', 'N']) {
    const Ff = face(f), [a, b] = len[f], n = Math.max(1, Math.floor((b - a) / 2.6));
    for (let i = 0; i < n; i++) {
      const u = a + ((b - a) * (i + 0.5)) / n;
      if ((o.doors ?? [['S', (u0 + u1) / 2]]).some(([df, du]) => df === f && Math.abs((f === 'S' ? du : -du) - u) < 1.3)) continue;
      if (k === 'stable') segBox(G, 'iron', Ff, u - 0.35, u + 0.35, -0.02, 0.01, 1.55, 1.85, 0.14);
      else shutterWin(G, Ff, u, 1.1, 0.55, R);
    }
  }
  // style extras
  if (k === 'smithy') {
    // the forge's open lean-to at the +u end: posts, a tiled pent roof, the hearth with its hood, an anvil on a stump
    const ua = u1, ub = o.annex ?? u1 + 2.2;
    for (const w of [w0 + 0.2, w1 - 0.2]) segBox(G, 'oak', F, ub - 0.3, ub - 0.1, w - 0.1, w + 0.1, 0, ye - 0.2, 0.62);
    const P = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
    fan(G, roof, [P(ua, w0 - 0.3, ye + 0.3), P(ub + 0.3, w0 - 0.3, ye - 0.5), P(ub + 0.3, w1 + 0.3, ye - 0.5), P(ua, w1 + 0.3, ye + 0.3)], [F.t[0], 1, F.t[1]]);
    segBox(G, 'rubble', F, ua, ua + 1.2, w0 + 0.6, w0 + 2.0, 0, 0.9, 0.8);               // the hearth
    segBox(G, 'iron', F, ua + 0.1, ua + 1.1, w0 + 0.7, w0 + 1.9, 0.9, 0.95, 0.2);
    G.box('dressed', ...(() => { const [x, z] = F.at(ua + 1.7, (w0 + w1) / 2 + 0.6); return [x, 0.35, z]; })(), 0.5, 0.7, 0.5, 0, 0.7);
    G.box('iron', ...(() => { const [x, z] = F.at(ua + 1.7, (w0 + w1) / 2 + 0.6); return [x, 0.78, z]; })(), 0.7, 0.18, 0.25, F.rot, 0.25);
    chimneyStack(G, F, ua + 0.5, w0 + 1.3, ye - 0.5, yr + 0.9, 'rubble');
  }
  if (k === 'guard') {
    // a little bell-cote on the ridge at the −u end
    const [bx, bz] = F.at(u0 + 1.0, (w0 + w1) / 2);
    for (const s of [-1, 1]) { const [px, pz] = F.at(u0 + 1.0, (w0 + w1) / 2 + s * 0.45); G.box('ashlar', px, yr + 0.3, pz, 0.25, 1.7, 0.25, F.rot ?? 0, 0.95); } // (feet in the roof)
    G.box('ashlar', bx, yr + 1.25, bz, 0.4, 0.25, 1.15, Math.atan2(F.t[1], F.t[0]), 0.95);
    G.cyl('iron', bx, yr + 0.55, bz, 0.12, 0.2, 0.42, 10, 0.35);
    G.cyl('slate', bx, yr + 1.35, bz, 0.55, 0.04, 0.8, 4, 0.95, { a0: Math.PI / 4 });
  }
  if (k === 'house') {
    // a jettied upper front: the framed upper storey sails out 0.4 m over the N face (the lane) on joist ends
    const Ff = face('N'), [a, b] = len.N;
    for (let u = a + 0.3; u < b - 0.1; u += 0.6) segBox(G, 'oak', Ff, u - 0.07, u + 0.07, 0, 0.4, ye - 0.45, ye - 0.3, 0.6);
  }
  // (a chimney [u, w, top]: where the library model's stovepipe smokes — render/fx.js reads its anchor — or a cold one)
  if (o.chimney != null) { const [cu, cw, ct] = Array.isArray(o.chimney) ? o.chimney : [o.chimney, (w0 + w1) / 2 + (w1 - w0) * 0.18, yr + 0.8]; chimneyStack(G, F, cu, cw, ye, Math.max(ct ?? yr + 0.8, yr + 0.3), 'rubble'); }
  // staddle stones under a store
  if (k === 'store') for (const u of [u0 + 0.5, (u0 + u1) / 2, u1 - 0.5]) for (const w of [w0 + 0.4, w1 - 0.4]) {
    const [x, z] = F.at(u, w); G.cyl('rubble', x, -0.05, z, 0.28, 0.18, 0.4, 8, 0.85); G.cyl('dressed', x, 0.33, z, 0.4, 0.4, 0.1, 8, 1.0);
  }
}

/** A chapel nave on local rect (ridge along u): stone walls with buttresses, pointed windows, a W portal under a rose,
 *  an open bell-cote on the W gable and an iron cross on the E gable's apex. */
export function chapel(G, o) {
  const F = localFrame(o.x, o.z, o.rot ?? 0), R = G.R, { u0, u1, w0, w1 } = o, ye = o.ye ?? 4.2, yr = o.yr ?? 8.2;
  segBox(G, 'ashlar', F, u0, u1, w0, w1, -0.1, ye, 1.0);
  segBox(G, 'rubble', F, u0 - 0.05, u1 + 0.05, w0 - 0.05, w1 + 0.05, -0.1, 0.5, 0.9);
  const S = { t: F.t, n: F.n, at: (u, w) => F.at(u, w1 + w) }, N = { t: [-F.t[0], -F.t[1]], n: [-F.n[0], -F.n[1]], at: (u, w) => F.at(-u, w0 - w) };
  const Wf = { t: [-F.n[0], -F.n[1]], n: [-F.t[0], -F.t[1]], at: (u, w) => F.at(u0 - w, -u) };
  for (const [Ff, a, b] of [[S, u0, u1], [N, -u1, -u0]]) {
    for (let u = a + 1.6; u < b - 1.2; u += 2.6) {
      segBox(G, 'ashlar', Ff, u + 1.15, u + 1.6, 0, 0.55, -0.1, ye - 0.6, 0.97, { taperOut: -0.35 }); // buttress
      bifora(G, Ff, u, 1.6, 1.7, 0.3);
    }
  }
  saddle(G, F, u0, u1, w0, w1, ye, yr, 'slate', { oh: 0.3, gableMat: 'ashlar', cap: 'lead' });
  // the W front: portal, a rose (dark disc with dressed ring), the bell-cote over the gable
  const wm = -(w0 + w1) / 2;
  portal(G, Wf, wm, 0.15, { w: 1.3, h: 2.5, steps: 0.4, rise: 0.15 });
  // the rose: a dark disc in the gable's plane in a ring of dressed voussoirs (it was a flat disc standing out of the
  // gable like a shelf, review 2026-11-11)
  const rc = ye + 0.9, rose = [];
  for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; rose.push(fP(Wf, wm + Math.cos(a) * 0.5, 0.025, rc + Math.sin(a) * 0.5)); }
  fan(G, 'iron', rose, fN(Wf), 0.14);
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * Math.PI * 2, cu = wm + Math.cos(a) * 0.6, cy = rc + Math.sin(a) * 0.6;
    segBox(G, 'dressed', Wf, cu - 0.11, cu + 0.11, 0, 0.06, cy - 0.11, cy + 0.11, 1.05);
  }
  const [cx, cz] = F.at(u0 + 0.1, (w0 + w1) / 2);
  // (the piers rise out of the gable's head, their feet below the roof's slopes: review 2026-11-11, they stood on air)
  for (const s of [-1, 1]) { const [px, pz] = F.at(u0 + 0.1, (w0 + w1) / 2 + s * 0.55); G.box('ashlar', px, yr + 0.3, pz, 0.35, 2.5, 0.3, Math.atan2(F.t[1], F.t[0]), 0.97); }
  G.box('ashlar', cx, yr + 1.7, cz, 0.35, 0.35, 1.5, Math.atan2(F.t[1], F.t[0]), 0.97);
  G.cyl('iron', cx, yr + 0.85, cz, 0.16, 0.26, 0.55, 12, 0.35);
  G.cyl('slate', cx, yr + 1.85, cz, 0.62, 0.04, 1.4, 4, 0.95, { a0: Math.PI / 4 });
  // (no flèche on the ridge any more: a second dark spire on the little roof read as a tip poking up through it beside
  // the bell-cote, review 2026-11-11 — the bell-cote is the chapel's; a cross on the E gable's apex instead)
  const [fx, fz] = F.at(u1 + 0.05, (w0 + w1) / 2);
  G.box('iron', fx, yr + 0.45, fz, 0.07, 0.9, 0.07, 0, 0.35);
  G.box('iron', fx, yr + 0.62, fz, 0.07, 0.07, 0.42, Math.atan2(F.t[1], F.t[0]), 0.35); // (its arms in the gable's plane)
  void R;
}

/**
 * The bailey's buildings (castle pass): each library hut / house the gameplay measured stays as its invisible proxy
 * (scripts/m20-art.js hideProxy: its footprints, nav and body stamps exactly as before) and is drawn as a medieval
 * building on the extents the library model drew (u along its rot, w across; body band 0.3-1.8 m from the probe of
 * commandos-shots/m20castle/tools/p-hutbox.js), its ridge at the model's height — trimmed (layout audit, user 2026-11-10
 * "Make sure all buildings are well located inside the castle and dont intersect paths") to where the gameplay's own
 * walkers and the Panzer III actually pass: the guardhouse's corners, the chapel's E end, the workshop's W end by the S
 * curtain. The smithy is built against the SW curtain (its W gable on the curtain's face: no verge there, `wallEnd`);
 * the steward's house carries its round stair turret (h_tur) at its E gable; every door opens onto a lane.
 */
export const BAILEY_PLAN = {
  h_w1: { kind: 'stable', u0: -5.85, u1: 5.81, w0: -3.44, w1: 3.42, ye: 2.45, yr: 5.3, roof: 'shingle', doors: [['S', -2.6, 'stable'], ['S', 1.6, 'stable'], ['N', 0]], chimney: [-2.8, -0.9, 5.9] },
  h_w2: { kind: 'smithy', u0: -5.28, u1: 5.2, w0: -3.42, w1: 3.13, annex: 7.58, ye: 2.6, yr: 5.6, roof: 'tiles', doors: [['S', -1.5], ['N', -2]], chimney: null, wallEnd: 'W' },
  h_w3: { kind: 'store', u0: -3.75, u1: 3.72, w0: -2.83, w1: 2.58, ye: 2.3, yr: 4.75, roof: 'shingle', doors: [['S', 0.8]], oh: 0.3 },
  h_s1: { kind: 'workshop', u0: -5.85, u1: 5.81, w0: -3.45, w1: 3.39, ye: 2.55, yr: 5.7, roof: 'tiles', doors: [['N', -1.2], ['S', -3]], chimney: [-2.8, -0.9, 6.3] },
  h_s2: { kind: 'workshop', u0: -5.2, u1: 5.81, w0: -3.44, w1: 3.42, ye: 2.45, yr: 5.3, roof: 'shingle', doors: [['S', -1.5], ['N', 2.2]], chimney: 3.0 },
  h_s3: { kind: 'house', u0: -5.85, u1: 6.4, w0: -3.42, w1: 3.13, ye: 2.7, yr: 5.85, roof: 'tiles', doors: [['N', 0.5], ['N', -3.5]], chimney: -3.5 },
  h_s5: { kind: 'lodge', u0: -4.85, u1: 4.81, w0: -2.92, w1: 2.66, ye: 2.5, yr: 5.15, roof: 'slate', doors: [['N', -1.5]], hip: 0.6 },
  bk_s: { kind: 'guard', u0: -5.8, u1: 6.0, w0: -3.75, w1: 3.75, ye: 2.9, yr: 6.4, roof: 'slate', doors: [['N', 1.0], ['S', -2.5]], chimney: [-3.08, -1.05, 7.0] },
  h_st: { kind: 'chapel', u0: -5.06, u1: 5.0, w0: -3.61, w1: 3.4, ye: 4.3, yr: 8.4, buttress: [-3.4, 3.4, 0.55] },
};

/** Build the bailey's medieval buildings into G for the mission structures named in BAILEY_PLAN. */
export function buildBailey(m, G) {
  const S = (id) => (m.structures || []).find((s) => s.id === id);
  const built = [];
  for (const [id, p] of Object.entries(BAILEY_PLAN)) {
    const s = S(id);
    if (!s) continue;
    const o = { x: s.x, z: s.z, rot: s.rot ?? 0, ...p };
    if (p.kind === 'chapel') chapel(G, o); else bailyBuilding(G, o);
    built.push(id);
  }
  return built;
}

/** The guardhouse (bk_s, a destructible garrison) burnt out: its walls to jagged stumps, no roof, charred beams. */
export function buildGuardRuin(m) {
  const s = (m.structures || []).find((q) => q.id === 'bk_s');
  const G = new Geo('bk_s:ruin'), R = G.R;
  if (!s) return G.build('m20:bk_s:ruin');
  const p = BAILEY_PLAN.bk_s, F = localFrame(s.x, s.z, s.rot ?? 0);
  for (const [ua, ub, wa, wb] of [[p.u0, p.u1, p.w0, p.w0 + 0.5], [p.u0, p.u1, p.w1 - 0.5, p.w1], [p.u0, p.u0 + 0.5, p.w0, p.w1], [p.u1 - 0.5, p.u1, p.w0, p.w1]]) {
    for (let u = ua; u < ub - 1e-3; u += 0.8) segBox(G, 'ashlar', F, u, Math.min(ub, u + 0.8), wa, wb, -0.1, 0.6 + R() * 1.6, 0.45 + R() * 0.2);
  }
  for (let k = 0; k < 6; k++) { const [x, z] = F.at(p.u0 + 1 + R() * (p.u1 - p.u0 - 2), p.w0 + 1 + R() * (p.w1 - p.w0 - 2)); G.box('timber', x, 0.4 + R() * 0.5, z, 3 + R() * 2, 0.25, 0.25, R() * 3, 0.15); }
  for (let k = 0; k < 8; k++) { const [x, z] = F.at(p.u0 + 1 + R() * (p.u1 - p.u0 - 2), p.w0 + 1 + R() * (p.w1 - p.w0 - 2)); G.box('rubble', x, 0.25, z, 1.4, 0.5, 1.2, R() * 3, 0.4, 0.4); }
  return G.build('m20:bk_s:ruin', { ground: 0, moss: 0 });
}

// ---------------------------------------------------------------- the firing line's targets
let RING_MAT = null;
/** A ring target face (Ringscheibe): white card, black rings, the black centre with its white 10-ring (canvas). */
function ringMaterial() {
  if (RING_MAT) return RING_MAT;
  let map = null;
  if (HAS_DOM) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#e9e4d6'; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = '#1b1b1b'; x.lineWidth = 2;
    for (let r = 58; r > 8; r -= 8) { x.beginPath(); x.arc(64, 64, r, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = '#151515'; x.beginPath(); x.arc(64, 64, 26, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#e9e4d6'; for (const r of [18, 10]) { x.beginPath(); x.arc(64, 64, r, 0, Math.PI * 2); x.stroke(); }
    // shot holes and a few repair patches
    x.fillStyle = '#2a2a2a'; for (let k = 0; k < 14; k++) { const a = k * 2.4, rr = 6 + ((k * 37) % 40); x.beginPath(); x.arc(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr, 1.6, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = 'rgba(215,200,160,0.9)'; x.fillRect(82, 30, 9, 9); x.fillRect(35, 78, 8, 8);
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  }
  RING_MAT = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0xdedad0, map, roughness: 0.95, metalness: 0 });
  RING_MAT.name = 'm20:ringTarget';
  return RING_MAT;
}

/**
 * A ring-target board on two oak posts, its face towards the firing line (heading `face`), its card centre at 1.15 m;
 * a sand-filled foot. o: {x, z, face, w = 1.1, seed}
 */
export function buildRingTarget(o) {
  const G = new Geo(o.seed ?? 'tgt'), F = localFrame(o.x, o.z, (o.face ?? Math.PI) + Math.PI / 2), W2 = (o.w ?? 1.1) / 2;
  for (const s of [-1, 1]) segBox(G, 'oak', F, s * W2 - 0.06, s * W2 + 0.06, -0.06, 0.06, -0.3, 1.85, 0.65);
  segBox(G, 'planks', F, -W2 + 0.05, W2 - 0.05, 0.04, 0.09, 0.55, 1.75, 0.85);
  segBox(G, 'oak', F, -W2 - 0.1, W2 + 0.1, -0.08, 0.08, 1.82, 1.92, 0.6);
  segBox(G, 'sand', F, -W2 - 0.2, W2 + 0.2, -0.35, 0.35, -0.05, 0.25, 0.9);
  const g = G.build(o.name || 'm20:ringTarget', { ground: 0 });
  // the card: one quad facing the line
  const [cx, cz] = F.at(0, -0.0), n = [Math.cos(o.face ?? Math.PI), Math.sin(o.face ?? Math.PI)], t = [-n[1], n[0]];
  const ox = cx + n[0] * 0.05, oz = cz + n[1] * 0.05, s2 = 0.52;
  const geo = new THREE.BufferGeometry();
  const P = (a, b) => [ox + t[0] * a, 1.15 + b, oz + t[1] * a];
  const v = [P(-s2, -s2), P(s2, -s2), P(s2, s2), P(-s2, s2)];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  // wind it to face along n
  const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const nx = e1[1] * e2[2] - e1[2] * e2[1], nz = e1[0] * e2[1] - e1[1] * e2[0];
  geo.setIndex(nx * n[0] + nz * n[1] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  const card = new THREE.Mesh(geo, ringMaterial());
  card.name = 'm20:ringTarget:card'; card.castShadow = true; card.receiveShadow = true;
  g.add(card);
  return g;
}
