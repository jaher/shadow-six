/**
 * "Winter Quarters" art kit (LIGHTS OUT mission 3, docs/expansion/e03.md §13): the circus winter quarters' buildings
 * and props, drawn procedurally from the mission's own gameplay data so nothing a unit stands on, hides behind or walks
 * round moves. Geometry is accumulated per material in castle-kit `Geo` builders (one merged mesh per material per
 * group: few draw calls), textured from the shared library with box-projected world UVs and a grime / tone field.
 *
 *  - the riding hall (the intercept station): brick base and pilasters, dark timber boarding with tall windows, three
 *    sliding doors, a high hipped tile roof with a glazed lantern on the ridge, roof trusses, and inside the receivers on
 *    their trestles, the chief's table, the wall map and the stacked show jumps. Its roof and lantern fade out while a
 *    commando is inside (the interior reads from the game camera);
 *  - the big top, half raised: four king poles with bale rings and pennants, the north half of the striped canvas up on
 *    its side poles, the south half hauled only part way and bunched at the south king poles, the ring kerb (red and
 *    white boards round the sawdust), the bandstand;
 *  - painted living wagons (oxblood, mustard, cream; clerestory roofs, shutters, steps, stove pipes, posters), the lions'
 *    barred cage wagon, the menagerie and stable tents, the villa's timber veranda, the water tower, the landing stage,
 *    the rope ferry's punt and cable, and the small props (hay cart, trough, bales, trapeze, bicycle, hen coop, spares).
 * Node (unit tests): plain colours, no textures (castle-kit).
 * @module art/e03-kit
 */
import * as THREE from 'three';
import { Geo, CASTLE_SETS, localFrame, segBox, hipRoof } from './castle-kit.js';
import { rng, seedOf } from './dressing.js';

// ------------------------------------------------------------------ materials (library sets, e03 tints)
// [library set, tint, flat colour (node), metres per tile, normal strength]
Object.assign(CASTLE_SETS, {
  e03_brick: ['brick_red', 0xd9a48c, 0x8a4b32, 2.2, 1.2],
  e03_brickDark: ['brick_dark', 0xc7a090, 0x6a3a28, 2.2, 1.2],
  e03_board: ['timber_siding', 0x8a7058, 0x4a3524, 2.4, 1.0],
  e03_timber: ['timber_beam', 0x7c6450, 0x4a3524, 1.5, 1.0],
  e03_tiles: ['roof_tile_flat', 0xc08a72, 0x7a4636, 2.6, 1.0],
  e03_glass: ['glass_dirty', 0x8e9ca0, 0x3f4a50, 1.2, 0.3],
  e03_frame: ['wood_paint', 0xf2ede2, 0xe0dccf, 1.2, 0.5],
  e03_oxblood: ['wood_paint', 0xa8453c, 0x7a2e2a, 1.6, 0.7],
  e03_mustard: ['wood_paint', 0xe6c157, 0xc9a53a, 1.6, 0.7],
  e03_cream: ['wood_paint', 0xf4ead2, 0xe8dcc2, 1.6, 0.7],
  e03_green: ['wood_paint', 0x5e7a55, 0x3f5a3a, 1.6, 0.7],
  e03_blue: ['wood_paint', 0x4a6688, 0x2f4a6a, 1.6, 0.7],
  e03_gold: ['paint_metal', 0xd9b45a, 0xb8923a, 1.0, 0.4],
  e03_canvas: ['canvas', 0xf0e8d2, 0xd9d2b8, 3.0, 0.7],
  e03_canvasRed: ['canvas', 0xc04a3a, 0x9a2e26, 3.0, 0.7],
  e03_canvasGrey: ['canvas', 0xcfc8ae, 0xa8a58a, 3.0, 0.8],
  e03_door: ['door_planks', 0x9a8a70, 0x5a4a38, 1.6, 0.9],
  e03_zinc: ['corrugated_zinc', 0xc8ccc8, 0x8a8f8a, 1.6, 0.8],
  e03_zincRust: ['corrugated_zinc', 0xb88f6c, 0x7a5a40, 1.6, 0.8],   // a sheet gone to rust (the veranda's oldest)
  e03_sawdust: ['sand', 0xe6d2a0, 0xc9b584, 1.6, 0.6],
  e03_straw: ['roof_thatch', 0xe8d08a, 0xc9b06a, 1.4, 0.8],
  e03_steel: ['steel_galv', 0xa8aca8, 0x6a6e6a, 1.0, 0.5],
  e03_rope: ['hessian', 0xd8c8a0, 0xb0a07a, 0.5, 0.6],
  e03_black: ['paint_metal', 0x3a3a38, 0x222222, 1.0, 0.4],
  e03_white: ['wood_paint', 0xfaf6ee, 0xf0ece2, 1.6, 0.6],
  e03_render: ['plaster_white', 0xf2e6c8, 0xe6d8b8, 2.2, 0.8],
  e03_plinth: ['plaster_rough', 0xb8ab94, 0x8a8070, 2.0, 0.9],
  e03_shutter: ['wood_paint', 0x6f8a6a, 0x4f6a4a, 1.2, 0.6],
  e03_water: ['glass_dirty', 0x3d4436, 0x2c3328, 1.6, 0.2],  // standing water (node colour; the browser's: waterMaterial)
  e03_linen: ['canvas', 0xfff9ee, 0xece6d8, 0.7, 0.45],      // washing: worn linen, off-white
  e03_linenBlue: ['canvas', 0xaebfd4, 0x6f86a8, 0.7, 0.45],  // a faded blue work shirt, overalls
});

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
/** Local frame point → world [x, y, z]. */
const W = (F, u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
/** A small seeded random generator (mulberry32): the same irregularity every load. */
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Axis-aligned (in the frame) box: centre (u, w), bottom y, size su × sh × sw. */
function fb(G, mat, F, u, w, y, su, sh, sw, tone = 1) {
  segBox(G, mat, F, u - su / 2, u + su / 2, w - sw / 2, w + sw / 2, y, y + sh, tone);
}
/** A cylinder between two world points (a pole, a rope, a bar): `seg` sides, radius r. */
function rod(G, mat, a, b, r, seg = 6, tone = 1) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
  if (L < 1e-6) return;
  const k = [d[0] / L, d[1] / L, d[2] / L];
  let ux = [0, 1, 0];
  if (Math.abs(k[1]) > 0.9) ux = [1, 0, 0];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const nrm = (p) => { const l = Math.hypot(...p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
  const e1 = nrm(cross(k, ux)), e2 = cross(k, e1);
  const ring = (c) => Array.from({ length: seg }, (_, i) => {
    const t = (i / seg) * TAU, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
    return [c[0] + e1[0] * cs + e2[0] * sn, c[1] + e1[1] * cs + e2[1] * sn, c[2] + e1[2] * cs + e2[2] * sn];
  });
  const A = ring(a), B = ring(b);
  for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; G.quad(mat, A[i], A[j], B[j], B[i], tone); }
}
/** A catenary rope / cable between two world points sagging `sag` m: n segments of rod. */
function rope(G, mat, a, b, sag, r = 0.02, n = 8) {
  let p = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n, q = [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)];
    rod(G, mat, p, q, r, 4);
    p = q;
  }
}
/**
 * A patch laid on a grid surface (a mended roof patch, a water stain on canvas) that follows the surface's own triangles:
 * one flat quad over a sagging, creased grid dips into it somewhere and fights it. `grid[j][i]` are the surface's points
 * (drawn as quads a = [j][i], b = [j][i + 1], c = [j + 1][i + 1], d = [j + 1][i], split a–c when `diagAC`, else d–b);
 * `poly` is a convex polygon in grid units [[i, j], ...]. It is clipped to every triangle, mapped through it, lifted
 * `lift` m and drawn facing up.
 */
function drapePatch(G, mat, grid, poly, lift, tone, diagAC = true) {
  const clip = (pts, a, b) => { // keep the side of edge a→b where the triangle is (to its left)
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  const rows = grid.length - 1, cols = grid[0].length - 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const A = [i, j], B = [i + 1, j], C = [i + 1, j + 1], D = [i, j + 1];
    const P3 = { [A]: grid[j][i], [B]: grid[j][i + 1], [C]: grid[j + 1][i + 1], [D]: grid[j + 1][i] };
    for (const T of diagAC ? [[A, B, C], [A, C, D]] : [[D, C, B], [D, B, A]]) {
      // (counter-clockwise in grid units, so "left of each edge" is inside)
      const ccw = (T[1][0] - T[0][0]) * (T[2][1] - T[0][1]) - (T[1][1] - T[0][1]) * (T[2][0] - T[0][0]) > 0;
      const t = ccw ? T : [T[0], T[2], T[1]];
      let pts = poly;
      for (let e = 0; e < 3 && pts.length >= 3; e++) pts = clip(pts, t[e], t[(e + 1) % 3]);
      if (pts.length < 3) continue;
      const [p0, p1, p2] = t.map((v) => P3[v]);
      const det = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
      const map = ([x, y]) => { // barycentric in the grid triangle → the same point on the 3D triangle, lifted
        const l1 = ((x - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (y - t[0][1])) / det;
        const l2 = ((t[1][0] - t[0][0]) * (y - t[0][1]) - (x - t[0][0]) * (t[1][1] - t[0][1])) / det, l0 = 1 - l1 - l2;
        return [0, 1, 2].map((n) => p0[n] * l0 + p1[n] * l1 + p2[n] * l2 + (n === 1 ? lift : 0));
      };
      const w = pts.map(map);
      for (let k = 1; k + 1 < w.length; k++) {
        const a = w[0], b = w[k], c = w[k + 1];
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);   // y of (b − a) × (c − a)
        if (ny >= 0) G.tri(mat, a, b, c, tone); else G.tri(mat, a, c, b, tone);
      }
    }
  }
}
/** Spoked cart wheel in the plane of the frame's n axis (axle along w): centre (u, w), radius r. */
function wheel(G, F, u, w, r, { mat = 'e03_oxblood', tyre = 'e03_black', spokes = 10, t = 0.08 } = {}) {
  const c = W(F, u, w, r);
  const axis = [F.n[0], 0, F.n[1]];
  const e1 = [F.t[0], 0, F.t[1]], e2 = [0, 1, 0];
  const P = (rr, a, off) => [c[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * rr + axis[0] * off, c[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * rr, c[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * rr + axis[2] * off];
  const n = 18;
  for (let i = 0; i < n; i++) { // tyre band: outer face + both rims
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
    G.quad(tyre, P(r, a0, -t), P(r, a1, -t), P(r, a1, t), P(r, a0, t));
    G.quad(mat, P(r * 0.86, a0, t), P(r * 0.86, a1, t), P(r, a1, t), P(r, a0, t));
    G.quad(mat, P(r, a0, -t), P(r, a1, -t), P(r * 0.86, a1, -t), P(r * 0.86, a0, -t));
  }
  for (let s = 0; s < spokes; s++) { const a = (s / spokes) * TAU; rod(G, mat, P(r * 0.14, a, 0), P(r * 0.87, a, 0), 0.025, 4); }
  rod(G, 'e03_black', P(0, 0, -t * 1.6), P(0, 0, t * 1.6), r * 0.15, 8);
}

// ------------------------------------------------------------------ the riding hall

/**
 * The riding hall: walls on its gameplay lines (x0..x1 × z0..z1, 0.7 m thick), doors where the wall runs open.
 * Returns {group, roof} — `roof` (the tiles, the lantern) is faded out while a commando is inside.
 * @param {{x0:number,x1:number,z0:number,z1:number}} H @param {{W:number[],S:number[],E:number[]}} doors door centres
 */
export function buildRidingHall(H, doors, { operators = [], table = null, jumps = null } = {}) {
  const G = new Geo('e03:hall'), R = new Geo('e03:hall_roof');
  const cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2, hu = (H.x1 - H.x0) / 2, hw = (H.z1 - H.z0) / 2;
  const F = localFrame(cx, cz, 0); // u east, w south
  const T = 0.35, DOOR = 1.6, HEAD = 3.9, BRICK = 2.3, EAVE = 6.4, RIDGE = 12.8;
  // the four walls as runs along u (N, S) or w (W, E); `gaps` [c0, c1] where a door opens
  const walls = [
    { side: 'N', a: -hu, b: hu, at: -hw, gaps: [] },
    { side: 'S', a: -hu, b: hu, at: hw, gaps: [[doors.S[0] - cx - DOOR, doors.S[0] - cx + DOOR]] },
    { side: 'W', a: -hw, b: hw, at: -hu, gaps: [[doors.W[1] - cz - DOOR, doors.W[1] - cz + DOOR]] },
    { side: 'E', a: -hw, b: hw, at: hu, gaps: [[doors.E[1] - cz - DOOR, doors.E[1] - cz + DOOR]] },
  ];
  const along = (wl) => wl.side === 'N' || wl.side === 'S';
  // box over [s0, s1] of a wall run, wall thickness ±(T + d), heights y0..y1
  const run = (wl, s0, s1, y0, y1, mat, d = 0, tone = 1) => {
    if (along(wl)) segBox(G, mat, F, s0 - (s0 <= wl.a + 1e-6 ? T + d : 0), s1 + (s1 >= wl.b - 1e-6 ? T + d : 0), wl.at - T - d, wl.at + T + d, y0, y1, tone);
    else segBox(G, mat, F, wl.at - T - d, wl.at + T + d, s0, s1, y0, y1, tone);
  };
  const spans = (wl) => { // the solid spans of a run between its gaps
    const out = []; let s = wl.a;
    for (const [g0, g1] of wl.gaps) { out.push([s, g0]); s = g1; }
    out.push([s, wl.b]);
    return out;
  };
  const R0 = rng(seedOf('e03:hall'));
  for (const wl of walls) {
    for (const [s0, s1] of spans(wl)) {
      if (s1 - s0 < 0.05) continue;
      // (the courses overlap where they meet: abutting boxes let a thin line of sun through the shadow map — light
      // dashes on the hall's floor along every wall)
      run(wl, s0, s1, 0, BRICK + 0.08, 'e03_brick', 0, 0.95 + R0() * 0.08);   // brick base
      const j0 = s0 > wl.a + 1e-6 ? 0.03 : 0, j1 = s1 < wl.b - 1e-6 ? 0.03 : 0; // (past the brick at a door jamb)
      run(wl, s0 - j0, s1 + j1, BRICK, BRICK + 0.16, 'e03_brickDark', 0.06, 0.9);  // brick sill course
    }
    run(wl, wl.a, wl.b, BRICK + 0.08, EAVE + 0.1, 'e03_board', -0.04, 0.92);    // timber boarding to the eaves (over the doors too)
    for (const [g0, g1] of wl.gaps) { // over the door: the boarding (run over the gaps above) and the lintel beam
      // (a brick panel here was built upside down — HEAD to the sill — and only its upturned bottom showed, fighting
      // the sill course's top at the jambs)
      run(wl, g0 - 0.25, g1 + 0.25, HEAD - 0.28, HEAD, 'e03_timber', 0.07, 0.8);
    }
    // brick pilasters every ~5 m, proud of the face, up to the eaves; tall windows between them
    const L = wl.b - wl.a, n = Math.max(2, Math.round(L / 5)), step = L / n;
    const out = (wl.side === 'N' || wl.side === 'W') ? -1 : 1;
    for (let k = 0; k <= n; k++) {
      const s = wl.a + k * step;
      if (wl.gaps.some(([g0, g1]) => s > g0 - 0.6 && s < g1 + 0.6)) continue;
      if (along(wl)) fb(G, 'e03_brick', F, s, wl.at + out * (T + 0.12), 0, 0.62, EAVE - 0.05, 0.24, 0.93);
      else fb(G, 'e03_brick', F, wl.at + out * (T + 0.12), s, 0, 0.24, EAVE - 0.05, 0.62, 0.93);
    }
    for (let k = 0; k < n; k++) {
      const s = wl.a + (k + 0.5) * step;
      if (wl.gaps.some(([g0, g1]) => s > g0 - 1.4 && s < g1 + 1.4)) continue;
      const face = wl.at + out * (T + 0.005);
      // frame, glass, glazing bars (a tall window 1.5 × 2.5 m)
      const box = (mat, su, sh, y0, d) => (along(wl) ? fb(G, mat, F, s, face + out * d, y0, su, sh, 0.06) : fb(G, mat, F, face + out * d, s, y0, 0.06, sh, su));
      box('e03_frame', 1.66, 2.66, 3.06, 0.02);
      box('e03_glass', 1.44, 2.44, 3.17, 0.05);
      // (the glazing bars stop 2 cm inside the glass's edges: flush, their end faces fought the glass box's sides)
      // (the cross bars sit 1 cm behind the mullion's face: flush, their faces fought it where they cross)
      for (const dy of [0.81, 1.62]) box('e03_frame', 1.40, 0.05, 3.17 + dy, 0.06);
      box('e03_frame', 0.05, 2.40, 3.19, 0.07);
      box('e03_brickDark', 1.8, 0.12, 2.98, 0.06); // sill
    }
  }
  // the sliding doors: two plank leaves each, slid aside along the outer face on a top rail
  for (const wl of walls) for (const [g0, g1] of wl.gaps) {
    const out = (wl.side === 'N' || wl.side === 'W') ? -1 : 1, face = wl.at + out * (T + 0.16);
    // (the ledges stop 3 cm short of the leaf's edges: flush, their ends fought the leaf's edge faces)
    const leaf = (s0, s1) => {
      if (along(wl)) { segBox(G, 'e03_green', F, s0, s1, face - 0.05, face + 0.05, 0.05, HEAD - 0.1, 0.9); for (const y of [0.9, 2.5]) segBox(G, 'e03_green', F, s0 + 0.03, s1 - 0.03, face + out * 0.06 - 0.04, face + out * 0.06 + 0.04, y, y + 0.16, 0.75); }
      else { segBox(G, 'e03_green', F, face - 0.05, face + 0.05, s0, s1, 0.05, HEAD - 0.1, 0.9); for (const y of [0.9, 2.5]) segBox(G, 'e03_green', F, face + out * 0.06 - 0.04, face + out * 0.06 + 0.04, s0 + 0.03, s1 - 0.03, y, y + 0.16, 0.75); }
    };
    leaf(g0 - 1.75, g0 - 0.1); leaf(g1 + 0.1, g1 + 1.75);
    if (along(wl)) segBox(G, 'e03_black', F, g0 - 1.9, g1 + 1.9, face - 0.04, face + 0.04, HEAD + 0.02, HEAD + 0.12, 0.8);
    else segBox(G, 'e03_black', F, face - 0.04, face + 0.04, g0 - 1.9, g1 + 1.9, HEAD + 0.02, HEAD + 0.12, 0.8);
  }
  // eaves board all round; the trusses (seen when the roof fades), tie beams and king posts
  const nT = 8, OH = 0.55, inset = hw + T + OH, ridgeHalf = hu + T + OH - inset;
  // (under the hips the roof is lower than the ridge: an end truss stands as high as the roof over it, never through it)
  const underRoof = (u) => EAVE + (RIDGE - EAVE) * Math.min(1, (hu + T + OH - Math.abs(u)) / inset);
  for (let k = 1; k < nT; k++) {
    const u = -hu + (k * 2 * hu) / nT, top = underRoof(u) - 0.5;
    fb(G, 'e03_timber', F, u, 0, EAVE - 0.32, 0.26, 0.3, 2 * hw + 0.4, 0.8);           // tie beam
    fb(G, 'e03_timber', F, u, 0, EAVE, 0.22, top - EAVE - 0.1, 0.22, 0.75);           // king post
    rod(G, 'e03_timber', W(F, u, -hw, EAVE), W(F, u, 0, top), 0.12, 4, 0.8);          // rafters
    rod(G, 'e03_timber', W(F, u, hw, EAVE), W(F, u, 0, top), 0.12, 4, 0.8);
  }
  fb(G, 'e03_timber', F, 0, 0, RIDGE - 0.75, 2 * ridgeHalf - 0.6, 0.24, 0.24, 0.75);  // ridge purlin (under the ridge only)
  // the roof: tiles, hipped; the glazed lantern on the ridge with its own little hip roof
  weatheredHipRoof(R, F, -hu - T, hu + T, -hw - T, hw + T, EAVE, RIDGE - EAVE, { oh: OH, bay: (2 * hu) / 8, seed: 'e03:hall_roof' });
  // the ventilating lantern along the ridge: a boarded curb, posts every bay, glazed and louvred bays in turn (a pane
  // or two broken, a louvre slat gone), a top plate, its own little tiled hip roof with two vent cowls and a vane
  const LL = 2 * (hu - hw) - 2.5, LW = 1.4, LY0 = RIDGE - 0.6, LY1 = RIDGE + 1.0, LR = mulberry(seedOf('e03:hall_lantern'));
  segBox(R, 'e03_board', F, -LL / 2, LL / 2, -LW, LW, LY0, RIDGE - 0.15, 0.85);                      // curb (its foot in the roof)
  const nb = Math.max(4, Math.round(LL / 1.25)), bay = LL / nb;
  for (let k = 0; k <= nb; k++) for (const sd of [-1, 1]) fb(R, 'e03_timber', F, -LL / 2 + k * bay, sd * (LW - 0.06), RIDGE - 0.15, 0.14, LY1 - RIDGE + 0.15, 0.14, 0.75 + LR() * 0.1);
  for (let k = 0; k < nb; k++) for (const sd of [-1, 1]) {
    const u0 = -LL / 2 + k * bay + 0.07, u1 = u0 + bay - 0.14, um = (u0 + u1) / 2, w = sd * (LW - 0.06);
    if ((k + (sd > 0 ? 1 : 0)) % 2 === 0) {   // a glazed bay: two panes, a bar between; now and then one pane gone (dark)
      for (const [a, b] of [[u0, um - 0.02], [um + 0.02, u1]]) segBox(R, LR() < 0.12 ? 'e03_black' : 'e03_glass', F, a, b, w - 0.025, w + 0.025, RIDGE, LY1 - 0.08, 1);
      fb(R, 'e03_timber', F, um, w, RIDGE, 0.05, LY1 - 0.08 - RIDGE, 0.08, 0.7);
    } else {   // a louvred bay: slanted boards (one missing now and then) over the dark inside
      segBox(R, 'e03_black', F, u0, u1, w - sd * 0.06 - 0.01, w - sd * 0.06 + 0.01, RIDGE, LY1 - 0.08, 1);
      for (let y = RIDGE + 0.12; y < LY1 - 0.15; y += 0.2) {
        if (LR() < 0.08) continue;
        const P = (u, ww, yy) => W(F, u, ww, yy), wo = w + sd * 0.03, wi = w - sd * 0.05;
        const q = [P(u0, wo, y), P(u1, wo, y), P(u1, wi, y + 0.13), P(u0, wi, y + 0.13)];
        R.quad('e03_board', ...(sd > 0 ? q : q.slice().reverse()), 0.82 + LR() * 0.1);
      }
    }
  }
  for (const su of [-1, 1]) segBox(R, 'e03_board', F, su * LL / 2 - 0.05, su * LL / 2 + 0.05, -LW, LW, RIDGE - 0.15, LY1, 0.8);   // boarded ends
  segBox(R, 'e03_timber', F, -LL / 2 - 0.05, LL / 2 + 0.05, -LW - 0.02, LW + 0.02, LY1 - 0.06, LY1 + 0.08, 0.72);                 // top plate
  weatheredHipRoof(R, F, -LL / 2, LL / 2, -LW, LW, LY1 + 0.08, 0.95, { oh: 0.35, bay: LL / 3, seed: 'e03:hall_lantern_roof', sag: 0.4 });
  for (const su of [-0.32, 0.32]) {   // two vent cowls on the lantern's ridge
    const [cx, cz] = F.at(su * LL, 0);
    R.cyl('e03_zinc', cx, LY1 + 0.9, cz, 0.16, 0.16, 0.55, 10, 0.85, { caps: false });
    R.cyl('e03_zinc', cx, LY1 + 1.45, cz, 0.3, 0.02, 0.22, 10, 0.8);
  }
  const [vx, vz] = F.at(0, 0);
  rod(R, 'e03_black', [vx, LY1 + 1.0, vz], [vx, LY1 + 2.1, vz], 0.025, 5);
  R.box('e03_black', vx + 0.1, LY1 + 1.9, vz, 0.55, 0.18, 0.02, 0.4, 0.9);
  // the interior: receivers on trestles along the N wall, the chief's table, the wall map, the stacked jumps
  for (const [, x, z] of operators) {
    const u = x - cx, w = z - cz - 1.3; // the trestle 1.3 m N of the operator
    for (const du of [-1.9, 1.9]) for (const dw of [-0.45, 0.45]) rod(G, 'e03_timber', W(F, u + du, w + dw, 0), W(F, u + du * 0.85, w + dw * 0.7, 0.78), 0.04, 4, 0.7);
    fb(G, 'e03_timber', F, u, w, 0.76, 4.2, 0.06, 1.2, 0.85);
    for (const du of [-1.4, 0, 1.4]) { // three sets: grey cases with dials and a lamp of green paint
      fb(G, 'e03_black', F, u + du, w - 0.2, 0.82, 0.9, 0.42, 0.5, 0.9);
      fb(G, 'e03_steel', F, u + du, w - 0.2, 1.24, 0.92, 0.02, 0.52, 0.8);
      for (const dd of [-0.25, 0, 0.25]) fb(G, 'e03_white', F, u + du + dd, w + 0.06, 1.0, 0.09, 0.09, 0.02, 1);
      fb(G, 'e03_green', F, u + du, w - 0.2, 1.26, 0.5, 0.26, 0.36, 0.8);
    }
    rod(G, 'e03_black', W(F, u, w - 0.6, 1.2), W(F, u, -hw + 0.3, 5.8), 0.025, 4); // aerial lead up the wall
    for (const du of [-1.4, 0, 1.4]) fb(G, 'e03_timber', F, u + du, w + 1.2, 0, 0.42, 0.46, 0.42, 0.8); // stools
  }
  if (table) {
    const u = table[0] - cx, w = table[1] - cz;
    for (const du of [-0.95, 0.95]) for (const dw of [-0.45, 0.45]) fb(G, 'e03_timber', F, u + du, w + dw, 0, 0.08, 0.76, 0.08, 0.7);
    fb(G, 'e03_timber', F, u, w, 0.74, 2.2, 0.06, 1.1, 0.9);
    fb(G, 'e03_cream', F, u - 0.55, w + 0.05, 0.8, 0.6, 0.01, 0.42, 1);   // papers
    fb(G, 'e03_black', F, u + 0.75, w - 0.25, 0.8, 0.22, 0.12, 0.16, 1);  // telephone
    rod(G, 'e03_steel', W(F, u + 0.85, w + 0.3, 0.8), W(F, u + 0.7, w + 0.3, 1.25), 0.02, 4); // lamp
    G.cyl('e03_green', ...W(F, u + 0.62, w + 0.3, 1.12), 0.05, 0.14, 0.14, 10, 0.9, { caps: true });
    fb(G, 'e03_timber', F, u, w + 1.0, 0, 0.45, 0.48, 0.45, 0.8); // his chair
  }
  // the wall map on the E wall, inside (a board on two legs against it)
  fb(G, 'e03_timber', F, hu - T - 0.25, 6, 0.9, 0.06, 1.6, 2.6, 0.8);
  fb(G, 'e03_cream', F, hu - T - 0.3, 6, 1.0, 0.02, 1.4, 2.4, 1);
  for (const [dz, c] of [[-0.6, 'e03_canvasRed'], [0.3, 'e03_blue'], [0.8, 'e03_canvasRed']]) fb(G, c, F, hu - T - 0.32, 6 + dz, 1.5, 0.01, 0.06, 0.06, 1);
  // the hall's old show jumps, stacked out of the way ([x, z, rot°] each): painted wings leaning on one another, a
  // loose heap of striped poles on the floor and a straw bale — irregular, as men drop things
  for (const [k, j] of (jumps || []).entries()) {
    const J = localFrame(j[0], j[1], ((j[2] ?? 0) * Math.PI) / 180), rnd = mulberry(77 + k * 13);
    const L = k === 0 ? 4.0 : 2.5; // the stack's length along its own u
    for (let i = 0; i < 3; i++) { // wings: 0.3 m thick boards, 1.2–1.4 m high, each leaning a little
      const uu = -L / 2 + 0.3 + i * ((L - 0.6) / 2), lean = (rnd() - 0.5) * 0.25;
      const a = W(J, uu, -0.45, 0.02), b = W(J, uu + lean, -0.4, 1.25 + rnd() * 0.15);
      rod(G, i % 2 ? 'e03_blue' : 'e03_white', a, b, 0.14, 4, 0.92);
      const c = W(J, uu, 0.45, 0.02), d = W(J, uu + lean, 0.4, 1.2 + rnd() * 0.15);
      rod(G, 'e03_white', c, d, 0.14, 4, 0.9);
      rod(G, 'e03_timber', W(J, uu + lean * 0.5, -0.4, 0.7), W(J, uu + lean * 0.5, 0.4, 0.7), 0.04, 4);
    }
    for (let i = 0; i < 9; i++) { // poles: a heap, not a neat rack
      const y = 0.08 + Math.floor(i / 3) * 0.13 + rnd() * 0.04, q = -0.45 + (i % 3) * 0.42 + (rnd() - 0.5) * 0.12;
      const u0 = -L / 2 + 0.05 + rnd() * 0.25, u1 = L / 2 - 0.05 - rnd() * 0.25, dq = (rnd() - 0.5) * 0.3;
      rod(G, i % 3 === 1 ? 'e03_canvasRed' : i % 3 === 2 ? 'e03_blue' : 'e03_white', W(J, u0, q, y), W(J, u1, q + dq, y + (rnd() - 0.5) * 0.06), 0.05, 6, 0.9 + rnd() * 0.1);
    }
    // two poles leaning against the stack's end, and a straw bale at its foot
    rod(G, 'e03_white', W(J, L / 2 + 0.25, -0.3, 0.02), W(J, L / 2 - 0.15, -0.25, 1.35), 0.05, 6);
    rod(G, 'e03_canvasRed', W(J, L / 2 + 0.35, 0.2, 0.02), W(J, L / 2 - 0.1, 0.3, 1.3), 0.05, 6);
    G.box('e03_straw', ...W(J, -L / 2 + 0.55, 0.05, 0.23), 0.9, 0.45, 0.5, ((j[2] ?? 0) * Math.PI) / 180 + 0.2, 0.92, 0.1); // (centre height)
  }
  const group = new THREE.Group(); group.name = 'e03:riding_hall';
  group.add(G.build('e03:hall', { damp: 0.8 }));
  const roof = R.build('e03:hall_roof', { damp: 0, streaks: 0.1, moss: 0.25 });
  group.add(roof);
  return { group, roof };
}

/**
 * The riding hall's hipped tile roof, lived-in (castle-kit hipRoof is four flat planes: from the game camera a smooth
 * red slab): each face a grid that sags between the trusses (`bay` m apart) and a little down the slope, the ridge
 * dipping with it; tiles weathered unevenly — bleached and dark courses, a mossy band along the eaves (more on the
 * north face), patches of newer tiles where the roof was mended. Same footprint and pitch as hipRoof.
 */
function weatheredHipRoof(G, F, u0, u1, w0, w1, y, rh, { oh = 0.35, bay = 5, seed = 'roof', mat = 'e03_tiles', cap = 'e03_tiles', sag = 1 } = {}) {
  u0 -= oh; u1 += oh; w0 -= oh; w1 += oh;
  const hw = (w1 - w0) / 2, inset = Math.min(hw, (u1 - u0) / 2), wm = (w0 + w1) / 2, R = mulberry(seedOf(seed));
  const P = (u, w, yy) => { const [x, z] = F.at(u, w); return [x, yy, z]; };
  const flip = (F.t[0] * F.n[1] - F.t[1] * F.n[0]) < 0;
  const q = (a, b, c, d, t) => (flip ? G.quad(mat, a, b, c, d, t) : G.quad(mat, d, c, b, a, t));
  const u00 = u0 + inset; // the first truss line sits where the ridge starts
  const sagAt = (u, s) => { // sag (m) at u along the roof, s up the slope (0 eave, 1 ridge)
    const f = ((((u - u00) / bay) % 1) + 1) % 1;
    return sag * (0.1 + 0.04 * Math.sin(u * 1.7)) * Math.sin(Math.PI * f) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, s * 1.15)));
  };
  const NS = 5;
  // a face: at slope position s its edge runs from uv(s, 0) to uv(s, 1); `cols` columns
  const face = (uv, cols, toneK, mossK) => {
    const pt = (i, j) => { const s = i / NS, t = j / cols, [u, w] = uv(s, t); return P(u, w, y + rh * s - sagAt(u, s)); };
    for (let i = 0; i < NS; i++) {
      const course = 0.93 + R() * 0.12; // a whole course a shade apart
      for (let j = 0; j < cols; j++) {
        let t = toneK * course * (0.84 + R() * 0.24);
        if (i === 0) t *= mossK; // the mossy, grimy eave band
        const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
        q(a, b, c, d, t);
        if (R() < 0.18) { // mended: a patch of newer (brighter) or older, lichened tiles laid over
          // (draped on the cell's own two triangles: a flat patch over the sagging cell dipped into the tiles)
          const k = R() < 0.55 ? 1.26 : 0.64;
          const f0 = 0.18 + R() * 0.15, f1 = 0.82 - R() * 0.15;
          drapePatch(G, mat, [[a, b], [d, c]], [[f0, 0.2], [f1, 0.2], [f1, 0.75], [f0, 0.75]], 0.035, t * k, flip);
        }
      }
    }
  };
  const lerp = (a, b, f) => a + (b - a) * f;
  const colsLong = Math.max(8, Math.round((u1 - u0) / 2.2)), colsHip = 6;
  face((s, t) => [lerp(lerp(u1, u1 - inset, s), lerp(u0, u0 + inset, s), t), lerp(w1, wm, s)], colsLong, 1.0, 0.82);   // S face
  face((s, t) => [lerp(lerp(u0, u0 + inset, s), lerp(u1, u1 - inset, s), t), lerp(w0, wm, s)], colsLong, 0.94, 0.72);  // N face (mossier)
  face((s, t) => [lerp(u1, u1 - inset, s), lerp(lerp(w0, wm, s), lerp(w1, wm, s), t)], colsHip, 0.97, 0.8);           // E hip
  face((s, t) => [lerp(u0, u0 + inset, s), lerp(lerp(w1, wm, s), lerp(w0, wm, s), t)], colsHip, 0.97, 0.78);          // W hip
  // ridge and hip capping (half-round tiles), and the eave fascia
  rod(G, cap, P(u0 + inset, wm, y + rh + 0.08), P(u1 - inset, wm, y + rh + 0.08), 0.12, 6, 0.8);
  for (const [cu, cw] of [[u0, w0], [u1, w0], [u1, w1], [u0, w1]]) rod(G, cap, P(cu, cw, y + 0.06), P(cu < 0 ? u0 + inset : u1 - inset, wm, y + rh + 0.08), 0.1, 6, 0.8);
  // (the hip boards run between the long ones: overlapped at the corners, their faces fought)
  segBox(G, 'e03_timber', F, u0, u1, w0, w0 + 0.12, y - 0.22, y, 0.7); segBox(G, 'e03_timber', F, u0, u1, w1 - 0.12, w1, y - 0.22, y, 0.7);
  segBox(G, 'e03_timber', F, u0, u0 + 0.12, w0 + 0.12, w1 - 0.12, y - 0.22, y, 0.7); segBox(G, 'e03_timber', F, u1 - 0.12, u1, w0 + 0.12, w1 - 0.12, y - 0.22, y, 0.7);
}

// ------------------------------------------------------------------ the big top (half raised) and the ring

/**
 * The big top over the ring: king poles at `poles`, side poles round radius `r` on the north half (`side`), the canvas
 * raised on the north half and hauled part way, bunched, at the two south king poles; the kerb boards round the ring.
 */
export function buildBigTop({ x, z, r, poles, sidePoles, ring: [rx, rz], ringR, kerbGap = 17, bandstand = null }) {
  const G = new Geo('e03:bigtop'), C = new Geo('e03:bigtop_canvas');
  const POLE = 13, BALE = 10.2, SIDE = 3.4;
  // king poles: steel, bale ring, pulley block, pennant
  for (const [px, pz] of poles) {
    G.cyl('e03_steel', px, 0, pz, 0.17, 0.13, POLE, 10, 0.85);
    G.ring('e03_steel', px, BALE - 0.15, pz, 0.16, 0.42, 0.3, 14, 0.8);
    G.cyl('e03_black', px, POLE, pz, 0.14, 0.02, 0.35, 8);
    const s = pz < z ? 1 : -1;
    C.quad('e03_canvasRed', [px, POLE - 0.1, pz], [px + 1.3, POLE - 0.35, pz + s * 0.15], [px + 1.3, POLE - 0.7, pz + s * 0.15], [px, POLE - 0.9, pz]);
    C.quad('e03_canvasRed', [px, POLE - 0.9, pz], [px + 1.3, POLE - 0.7, pz + s * 0.15], [px + 1.3, POLE - 0.35, pz + s * 0.15], [px, POLE - 0.1, pz]);
  }
  // side poles (north half), each with its stake rope going up to the eave
  for (const [sx, sz] of sidePoles) G.cyl('e03_timber', sx, 0, sz, 0.07, 0.06, SIDE + 0.25, 6, 0.8);
  // the raised canvas (north half): the eave ring at the side poles up to the bale rings, then the top between the
  // poles; gored panels alternate cream and red
  const nA = 36, a0 = Math.PI, a1 = TAU; // north half: angles 180°..360° (z < centre)
  const midR = 9.6, RB = mulberry(seedOf('e03:bigtop'));
  // (canvas, not a shell: the eave droops between the side poles, the cloth ripples a little, the gores fade unevenly)
  const poleA = sidePoles.map(([sx, sz]) => Math.atan2(sz - z, sx - x) + (Math.atan2(sz - z, sx - x) < 0 ? TAU : 0)).sort((p, q) => p - q);
  const droopAt = (a) => {
    let lo = a0, hi = a1;
    for (const pa of poleA) { if (pa <= a) lo = pa; else { hi = pa; break; } }
    const f = (a - lo) / Math.max(1e-6, hi - lo);
    return 0.42 * Math.sin(Math.PI * f) ** 1.3;
  };
  const ripple = (a, t) => 0.07 * Math.sin(a * 23 + t * 7) * Math.sin(a * 9 - t * 11) * Math.sin(Math.PI * t);
  const surf = (a, t) => { // t 0 → eave (r, SIDE), 1 → the top ring (midR, BALE)
    const rr = lerp(r, midR, t) + ripple(a, t), yy = lerp(SIDE, BALE, Math.pow(t, 0.85)) - 0.35 * Math.sin(t * Math.PI) - droopAt(a) * (1 - t) ** 2;
    return [x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr];
  };
  const goreTone = Array.from({ length: nA }, () => 0.8 + RB() * 0.24);
  for (let i = 0; i < nA; i++) {
    const A = lerp(a0, a1, i / nA), B = lerp(a0, a1, (i + 1) / nA), mat = i % 2 ? 'e03_canvas' : 'e03_canvasRed';
    for (let k = 0; k < 4; k++) {
      const t0 = k / 4, t1 = (k + 1) / 4, tone = goreTone[i] * (0.95 + RB() * 0.08) * (k === 0 ? 0.92 : 1);
      // underside drawn too (seen from below / the camera low)
      C.quad(mat, surf(A, t0), surf(B, t0), surf(B, t1), surf(A, t1), tone);
      C.quad(mat, surf(A, t1), surf(B, t1), surf(B, t0), surf(A, t0), 0.7 * tone);
    }
    // the scalloped valance under the eave
    const p0 = surf(A, 0), p1 = surf(B, 0), pm = surf((A + B) / 2, 0);
    C.tri(mat === 'e03_canvas' ? 'e03_canvasRed' : 'e03_canvas', p0, p1, [pm[0], pm[1] - 0.55, pm[2]]);
    C.tri(mat === 'e03_canvas' ? 'e03_canvasRed' : 'e03_canvas', [pm[0], pm[1] - 0.55, pm[2]], p1, p0, 0.7);
  }
  // the top sections of the north half, laced on: from the bale rings up to the peak over the ring's centre line;
  // the cut edge along the E-W diameter hangs in a roped hem (the south sections are not hauled up yet)
  const PEAK = BALE + 2.1;
  const topAt = (a, t) => { const rr = lerp(midR, 0.3, t), yy = lerp(BALE, PEAK, Math.sin((t * Math.PI) / 2)); return [x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr]; };
  for (let i = 0; i < nA; i++) {
    const A = lerp(a0, a1, i / nA), B = lerp(a0, a1, (i + 1) / nA), mat = i % 2 ? 'e03_canvas' : 'e03_canvasRed';
    for (let k = 0; k < 3; k++) {
      const t0 = k / 3, t1 = (k + 1) / 3, tone = goreTone[i] * (0.97 + RB() * 0.06);
      C.quad(mat, topAt(A, t0), topAt(B, t0), topAt(B, t1), topAt(A, t1), tone);
      C.quad(mat, topAt(A, t1), topAt(B, t1), topAt(B, t0), topAt(A, t0), 0.7 * tone);
    }
  }
  // the cut edge: a scalloped hem along the diameter, from the W eave over the peak to the E eave
  const edge = [];
  for (let k = 0; k <= 4; k++) edge.push(surf(Math.PI, k / 4));
  for (let k = 1; k <= 3; k++) edge.push(topAt(Math.PI, k / 3));
  for (let k = 3; k >= 0; k--) edge.push(topAt(0, k / 3).map((v, i) => (i === 0 ? 2 * x - (2 * x - v) : v)));
  for (let k = 4; k >= 0; k--) edge.push(surf(TAU, k / 4));
  for (let k = 0; k + 1 < edge.length; k++) {
    rod(C, 'e03_rope', edge[k], edge[k + 1], 0.05, 4);
    const m = edge[k].map((v, i) => (v + edge[k + 1][i]) / 2);
    C.tri(k % 2 ? 'e03_canvasRed' : 'e03_canvas', edge[k], edge[k + 1], [m[0], m[1] - 0.6, m[2] + 0.05]);
    C.tri(k % 2 ? 'e03_canvasRed' : 'e03_canvas', [m[0], m[1] - 0.6, m[2] + 0.05], edge[k + 1], edge[k], 0.7);
  }
  // the south half, hauled part way: canvas bunched up the two south king poles and lashed there
  for (const [px, pz] of poles.filter(([, pz]) => pz > z)) furledCanvas(C, G, px, pz, px < x ? -1 : 1, RB);
  // guys from the king-pole tops to the side-pole line (rigging), and the lacing ropes on the north eave
  for (const [px, pz] of poles.filter(([, pz]) => pz > z)) rope(G, 'e03_rope', [px, POLE - 0.3, pz], [x + (px - x) * 1.72, SIDE + 0.2, z + (pz - z) * 1.72], 0.4, 0.025, 6);
  // the ring kerb: boards painted red and white, 0.6 m, round the sawdust, open at the W gap
  const kR0 = ringR, kR1 = ringR + 0.42, gap = (kerbGap * Math.PI) / 180;
  const nK = 40;
  for (let i = 0; i < nK; i++) {
    const A = Math.PI + gap / 2 + ((TAU - gap) * i) / nK, arc = (TAU - gap) / nK;
    G.ring(i % 2 ? 'e03_white' : 'e03_oxblood', rx, 0, rz, kR0, kR1, 0.6, 2, 0.95, { a0: A, arc });
    G.ring('e03_gold', rx, 0.6, rz, kR0 - 0.02, kR1 + 0.02, 0.05, 2, 0.9, { a0: A, arc });
  }
  // the bandstand (S side, inside the canvas line): a plank stage on trestles, chairs, music stands, a bass drum
  if (bandstand) {
    const F = localFrame(bandstand.x, bandstand.z, 0);
    fb(G, 'e03_timber', F, 0, 0, 0, 6, 0.85, 2.6, 0.8);
    fb(G, 'e03_oxblood', F, 0, 1.32, 0.15, 6.05, 0.55, 0.04, 0.95); // the red skirt board
    for (let k = 0; k < 5; k++) {
      const u = -2.4 + k * 1.2;
      fb(G, 'e03_timber', F, u, -0.4, 0.85, 0.42, 0.45, 0.4, 0.75);
      rod(G, 'e03_black', W(F, u, -0.95, 0.85), W(F, u, -0.95, 1.95), 0.015, 4);
      fb(G, 'e03_black', F, u, -0.95, 1.85, 0.42, 0.28, 0.02, 1);
    }
    G.cyl('e03_cream', ...W(F, 2.4, 0.5, 0.85), 0.42, 0.42, 0.42, 14, 1);
  }
  const group = new THREE.Group(); group.name = 'e03:big_top';
  group.add(G.build('e03:bigtop', { damp: 0.2, moss: 0 }));
  group.add(C.build('e03:bigtop_canvas', { damp: 0, streaks: 0.08, moss: 0 }));
  return group;
}

/**
 * The south canvas hauled up a king pole at (px, pz) and furled round it: one lumpy bundle, not a stack of drums — it
 * bellies out between the lashings and pinches in under each rope, its creases run round it in a slow twist (the
 * striped gores wound up with it), its axis wanders off the pole's, and it sags towards `side` (±x: away from the ring).
 * Under the lowest lashing the cloth hangs in a ragged skirt; out of it one loose end of canvas hangs down, a narrow
 * tapering strip that twists and swings out a little as it falls, with a rope end beside it. Its top tucks in under the
 * bale ring.
 */
function furledCanvas(C, G, px, pz, side, R) {
  const N = 24, POLE_R = 0.15, Y0 = 5.62, Y1 = 9.86;
  const lash = [6.18, 7.02 + R() * 0.12, 7.92 + R() * 0.1, 8.74 + R() * 0.1, 9.42];
  const bulge = lash.map(() => 0.04 + R() * 0.11), pinch = lash.map(() => 0.17 + R() * 0.05);
  const ph = Array.from({ length: 4 }, () => R() * TAU), twist = 0.9 + R() * 0.5;
  // the bundle's girth at height y (between two lashings it bellies out, each bay its own; under a rope it is pinched,
  // one rope tighter than the next). Continuous through every rope: the skirt flares from the lowest, and above the
  // highest the cloth's last turn tapers into the pole (a step there drew a flat collar round the pole)
  const girth = (y) => {
    const L = lash.length - 1;
    if (y <= lash[0]) return pinch[0] + 0.14 * ((lash[0] - y) / (lash[0] - Y0)) ** 0.7; // the skirt flaring under the lowest rope
    if (y >= lash[L]) { const t = Math.min(1, (y - lash[L]) / (Y1 - lash[L])); return pinch[L] * (1 - t) + (POLE_R + 0.03) * t + 0.07 * Math.sin(Math.PI * t) ** 0.8; }
    let k = 0;
    while (y > lash[k + 1]) k++;
    const t = (y - lash[k]) / (lash[k + 1] - lash[k]);
    // (the cloth between two ties hangs: it sags below the middle of the bay, slack under the upper rope)
    return pinch[k] * (1 - t) + pinch[k + 1] * t + bulge[k] * Math.sin(Math.PI * (1 - t) ** 1.5) ** 0.9;
  };
  // (the cloth was gathered from the side the canvas came off: it bunches out there, thin on the far side)
  const outA = side > 0 ? 0 : Math.PI, lop = (a) => 1 + 0.24 * Math.cos(a - outA) + 0.06 * Math.cos(2 * a + ph[3]);
  // creases round it (three wavelengths, twisting with height), deepest where the cloth bellies
  // (gathered canvas: deep folds running down it, barely twisting — a curtain bunched and tied, not a turned baluster)
  const fold = (a, y) => 0.06 * Math.sin(5 * a + ph[0] + 0.25 * twist * y) + 0.035 * Math.sin(9 * a + ph[1] - 0.4 * y) + 0.018 * Math.sin(14 * a + ph[2] + 0.7 * y);
  const axis = (y) => [px + 0.05 * Math.sin(1.9 * y + ph[3]) + side * 0.05 * Math.max(0, 8.6 - y) / 3, pz + 0.045 * Math.sin(1.4 * y + ph[0])];
  const ys = [];
  for (let y = Y0; y < Y1 - 1e-6; y += 0.16) ys.push(y);
  ys.push(Y1);
  // the hem: the lowest ring is ragged (the cloth hangs lower here and there)
  const hem = Array.from({ length: N }, () => Y0 - 0.12 + R() * 0.24);
  const pt = (j, k) => {
    const a = (k / N) * TAU, y = j === 0 ? hem[k % N] : ys[j], g = girth(y);
    const r = Math.max(POLE_R + 0.02, POLE_R + (g - POLE_R) * lop(a) + fold(a, y) * Math.min(1, (g - POLE_R) / 0.18));
    const [cx, cz] = axis(y);
    return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  };
  const stripeOf = (a, y) => {
    const band = Math.floor((a / TAU) * 8 + y * 0.12 + 0.3 * Math.sin(a * 3 + 0.6 * y));   // (the panels' stripes run down the gathers)
    return ((band % 3) + 3) % 3 === 1 ? 'e03_canvasRed' : 'e03_canvas';
  };
  for (let j = 0; j + 1 < ys.length; j++) for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * TAU, y = ys[j], f = fold(a, y);
    const tone = (0.8 + 2.4 * f) * (j < 3 ? 0.88 : 1), m = stripeOf(a, y);
    const p00 = pt(j, k), p10 = pt(j + 1, k), p11 = pt(j + 1, k + 1), p01 = pt(j, k + 1);
    C.quad(m, p00, p10, p11, p01, tone);
    if (j < 3) C.quad(m, p01, p11, p10, p00, tone * 0.62); // (under the hem: its inside, seen from below)
  }
  // the lashings: a rope round each pinch, standing just proud of the cloth
  // (each ring follows the bundle's own round there — fuller on its gathered side — and sits into the cloth)
  for (const y of lash) {
    const [cx, cz] = axis(y), g = girth(y), M = 14;
    for (let k = 0; k < M; k++) {
      const a0 = (k / M) * TAU, a1 = ((k + 1) / M) * TAU;
      const r0 = POLE_R + (g - POLE_R) * lop(a0) + 0.02, r1 = POLE_R + (g - POLE_R) * lop(a1) + 0.02;
      rod(G, 'e03_rope', [cx + Math.cos(a0) * r0, y - 0.02, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r1, y - 0.02, cz + Math.sin(a1) * r1], 0.026, 4, 0.85);
    }
  }
  // the loose end: out from under the skirt on the outer side, a strip 0.34 m wide narrowing to 0.13, falling 2.2 m in
  // five lengths, swinging out a little and twisting half a turn as it hangs
  const az = Math.atan2(0.35 + R() * 0.2, side), out = [Math.cos(az), Math.sin(az)];
  const [ax0, az0] = axis(Y0), r0 = girth(Y0) - 0.03;
  const top = [ax0 + out[0] * r0, Y0 + 0.18, az0 + out[1] * r0];
  const n = 6, L = 2.2;
  const rows = [];
  for (let i = 0; i <= n; i++) {
    // across it the cloth is creased, not flat: its middle stands out in a fold (now one way, now the other, as it
    // twists) and its edges curl back a little — a hanging tongue of canvas, not a card
    const t = i / n, half = 0.17 * (1 - 0.62 * t) + (i > 0 ? (R() - 0.5) * 0.03 : 0);
    const swing = 0.16 * Math.sin(Math.PI * t * 0.9) + 0.05 * t, rot = az + Math.PI / 2 + 1.6 * t ** 1.2 + (R() - 0.5) * 0.2;
    const c = [top[0] + out[0] * swing, top[1] - L * t - 0.04 * Math.sin(Math.PI * t), top[2] + out[1] * swing];
    const wv = [Math.cos(rot) * half, Math.sin(rot) * half], nv = [-Math.sin(rot), Math.cos(rot)];
    const fold = (0.05 + 0.04 * Math.sin(2.3 * i + 0.7)) * (1 - 0.4 * t), curl = 0.035 * (1 - t);
    const dy = i === n ? 0.1 : 0; // (the ragged end: one corner hangs lower)
    rows.push([
      [c[0] - wv[0] - nv[0] * curl, c[1], c[2] - wv[1] - nv[1] * curl],
      [c[0] + nv[0] * fold, c[1] - 0.02, c[2] + nv[1] * fold],
      [c[0] + wv[0] - nv[0] * curl, c[1] - dy, c[2] + wv[1] - nv[1] * curl],
    ]);
  }
  for (let i = 0; i < n; i++) {
    const [a, m, b] = rows[i], [d, mm, c] = rows[i + 1], tone = 0.78 + R() * 0.16;
    for (const [p, q, r2, s2, tt] of [[a, m, mm, d, tone * 0.92], [m, b, c, mm, tone]]) {
      C.quad('e03_canvas', p, q, r2, s2, tt); C.quad('e03_canvas', s2, r2, q, p, tt * 0.72);
    }
  }
  // a lashing's rope end hanging beside it
  const re = [top[0] + Math.cos(az + 0.5) * 0.08, lash[0], top[2] + Math.sin(az + 0.5) * 0.08];
  rope(G, 'e03_rope', re, [re[0] + out[0] * 0.18, lash[0] - 1.3, re[2] + out[1] * 0.18], 0.03, 0.012, 4);
}

// ------------------------------------------------------------------ living wagons and the cage wagon

const PAINT = { oxblood: ['e03_oxblood', 'e03_mustard'], mustard: ['e03_mustard', 'e03_oxblood'], cream: ['e03_cream', 'e03_green'] };

/** A painted living wagon on its gameplay box (x, z, rot, w 7 × d 2.6 × h 3.4), door and steps at its +u end. */
export function addLivingWagon(G, s, R) {
  const F = localFrame(s.x, s.z, s.rot ?? 0), L = s.w, D = s.d, Hb = s.h;
  const [body, trim] = PAINT[s.paint] || PAINT.cream;
  const bodyL = L - 0.8, bu = -0.25;
  // chassis, axles, wheels (rear wheels bigger)
  fb(G, 'e03_black', F, bu, 0, 0.62, bodyL - 0.3, 0.16, D - 0.5, 0.8);
  for (const [u, rr] of [[bu - bodyL / 2 + 1.0, 0.62], [bu + bodyL / 2 - 1.1, 0.55]]) {
    for (const s2 of [-1, 1]) wheel(G, F, u, s2 * (D / 2 - 0.2), rr, { mat: trim, spokes: 12 });
    rod(G, 'e03_black', W(F, u, -D / 2 + 0.2, rr), W(F, u, D / 2 - 0.2, rr), 0.05, 6);
  }
  // body: panelled sides, a moulding at the waist and the roof line
  fb(G, body, F, bu, 0, 0.78, bodyL, Hb - 1.18, D - 0.2, 0.96 + (R() - 0.5) * 0.06);
  for (const s2 of [-1, 1]) {
    fb(G, trim, F, bu, s2 * (D / 2 - 0.08), 1.55, bodyL + 0.02, 0.07, 0.05, 0.9);
    fb(G, trim, F, bu, s2 * (D / 2 - 0.08), Hb - 0.48, bodyL + 0.02, 0.08, 0.05, 0.9);
    fb(G, trim, F, bu, s2 * (D / 2 - 0.08), 0.8, bodyL + 0.02, 0.07, 0.05, 0.9);
    for (let k = 0; k < 3; k++) { // windows with shutters folded back
      const u = bu - bodyL / 2 + 1.2 + k * ((bodyL - 2.4) / 2);
      fb(G, 'e03_glass', F, u, s2 * (D / 2 - 0.06), 1.75, 0.62, 0.72, 0.03, 1);
      fb(G, 'e03_frame', F, u, s2 * (D / 2 - 0.05), 2.12, 0.72, 0.05, 0.04, 1);
      for (const su of [-1, 1]) fb(G, trim, F, u + su * 0.52, s2 * (D / 2 - 0.04), 1.72, 0.32, 0.8, 0.03, 0.85);
    }
  }
  // clerestory roof: the main roof (zinc, slight overhang) and the raised lantern with little windows
  fb(G, 'e03_zinc', F, bu, 0, Hb - 0.4, bodyL + 0.3, 0.1, D + 0.12, 0.8);
  fb(G, body, F, bu, 0, Hb - 0.3, bodyL - 1.4, 0.32, 1.0, 0.9);
  for (const s2 of [-1, 1]) for (let k = 0; k < 4; k++) fb(G, 'e03_glass', F, bu - bodyL / 2 + 1.3 + k * ((bodyL - 2.6) / 3), s2 * 0.51, Hb - 0.24, 0.38, 0.18, 0.02, 1);
  fb(G, 'e03_zinc', F, bu, 0, Hb + 0.02, bodyL - 1.2, 0.06, 1.2, 0.8);
  G.cyl('e03_black', ...W(F, bu - bodyL / 2 + 0.9, 0.55, Hb - 0.3), 0.07, 0.07, 1.0, 8, 0.8); // stove pipe
  G.cyl('e03_black', ...W(F, bu - bodyL / 2 + 0.9, 0.55, Hb + 0.7), 0.13, 0.09, 0.12, 8, 0.8);
  // door at the +u end, its steps down to the ground, a porch board
  const eu = bu + bodyL / 2;
  fb(G, 'e03_door', F, eu + 0.02, -0.2, 0.85, 0.05, 1.85, 0.8, 0.9);
  fb(G, trim, F, eu + 0.03, -0.2, 2.7, 0.06, 0.08, 0.95, 0.9);
  for (let k = 0; k < 3; k++) fb(G, 'e03_timber', F, eu + 0.18 + k * 0.17, -0.2, 0.62 - k * 0.2, 0.32, 0.06, 0.8, 0.8);
  // shafts folded up at the front (−u end)
  for (const s2 of [-0.45, 0.45]) rod(G, 'e03_timber', W(F, bu - bodyL / 2 - 0.05, s2, 0.7), W(F, -L / 2 + 0.05, s2 * 0.7, 2.2), 0.045, 5);
  return { F, body, trim };
}

/**
 * The lions' cage wagon: a barred cage body on a red chassis, its sliding door towards +u (the ring). `open`: an empty
 * wagon in the menagerie tent — its barred door slid aside on the +w side, the gap open, old straw on its floor.
 */
export function addCageWagon(G, s, { open = false, R = null } = {}) {
  const F = localFrame(s.x, s.z, s.rot ?? 0), L = s.w, D = s.d;
  fb(G, 'e03_black', F, 0, 0, 0.6, L - 0.6, 0.16, D - 0.5, 0.8);
  for (const u of [-L / 2 + 1.1, L / 2 - 1.1]) for (const s2 of [-1, 1]) wheel(G, F, u, s2 * (D / 2 - 0.2), 0.55, { mat: 'e03_mustard', spokes: 12 });
  fb(G, 'e03_oxblood', F, 0, 0, 0.76, L - 0.4, 0.22, D - 0.15, 0.95); // floor
  fb(G, 'e03_oxblood', F, 0, 0, 2.7, L - 0.3, 0.3, D - 0.05, 0.95);   // roof frieze
  fb(G, 'e03_zinc', F, 0, 0, 3.0, L - 0.1, 0.06, D + 0.1, 0.8);
  for (const su of [-1, 1]) fb(G, 'e03_oxblood', F, su * (L / 2 - 0.35), 0, 0.98, 0.25, 1.72, D - 0.1, 0.9);
  const gap = open ? [-0.62, 0.62] : null; // the door's opening on the +w side (u)
  for (const s2 of [-1, 1]) for (let k = 0; k <= 22; k++) { // the bars
    const u = -L / 2 + 0.55 + (k * (L - 1.1)) / 22;
    if (gap && s2 > 0 && u > gap[0] && u < gap[1]) continue;
    rod(G, 'e03_black', W(F, u, s2 * (D / 2 - 0.12), 0.98), W(F, u, s2 * (D / 2 - 0.12), 2.7), 0.022, 4);
  }
  if (gap) { // the barred door slid aside along its runner, just outside the bars
    const w = D / 2 - 0.02;
    for (const y of [1.0, 2.62]) rod(G, 'e03_black', W(F, gap[1] - 0.05, w, y), W(F, gap[1] + 1.3, w, y), 0.024, 4);
    for (let k = 0; k <= 5; k++) rod(G, 'e03_black', W(F, gap[1] + 0.02 + k * 0.24, w, 1.0), W(F, gap[1] + 0.02 + k * 0.24, w, 2.62), 0.018, 4);
    rod(G, 'e03_steel', W(F, gap[0] - 0.1, D / 2 - 0.04, 2.66), W(F, gap[1] + 1.6, D / 2 - 0.04, 2.66), 0.02, 4, 0.7); // the runner rail
    const RR = R || mulberry(seedOf(`e03:cage:${s.x}`));
    for (let k = 0; k < 9; k++) { // old straw on the floor
      const [x, z] = F.at(-L / 2 + 0.8 + RR() * (L - 1.6), (RR() - 0.5) * (D - 0.8));
      strawTuft(G, [x, 0.99, z], [0, 1, 0], RR, { n: 8, len: [0.1, 0.22], spread: 1.4, tone: [0.75, 1.0] });
    }
  }
  for (const s2 of [-1, 1]) fb(G, 'e03_gold', F, 0, s2 * (D / 2 - 0.02), 2.78, L - 0.8, 0.12, 0.02, 1);
  return F;
}

/**
 * Washing hung between two wagons: a line from a roof corner of one to the next, sagging, pegged with shirts, a towel,
 * long johns and a striped costume of the ring, each a small sheet of cloth bellying in the breeze with creases down
 * it. High enough that a man walks under it (the line at ~2.9 m, the hems at ~2.1 m).
 */
export function addWashingLine(G, a, b, R) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), sag = 0.12 + 0.03 * L;
  const at = (t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)];
  rope(G, 'e03_rope', a, b, sag, 0.008, 10);
  const tx = (b[0] - a[0]) / L, tz = (b[2] - a[2]) / L, nx = -tz, nz = tx; // along the line; across it (the breeze)
  // shirts (white linen, a faded blue), a towel, long johns, a red-and-white striped ring costume, blue work trousers
  const KINDS = [
    { mat: 'e03_linen', w: 0.62, h: 0.66, shirt: true, k: 1.14 }, { mat: 'e03_linenBlue', w: 0.6, h: 0.7, shirt: true, k: 1.04 },
    { mat: 'e03_linen', w: 0.5, h: 0.42, k: 1.1 }, { mat: 'e03_canvasGrey', w: 0.42, h: 0.78, legs: true, k: 1.08 },
    { mat: 'e03_canvasRed', alt: 'e03_linen', w: 0.5, h: 0.64, stripes: 6, k: 1.02 }, { mat: 'e03_linenBlue', w: 0.38, h: 0.5, legs: true, k: 1.0 },
  ];
  let s = 0.25 + R() * 0.2;
  while (s < L - 0.45) {
    const K = KINDS[Math.floor(R() * KINDS.length)], gw = K.w * (0.9 + R() * 0.2), gh = K.h * (0.9 + R() * 0.2);
    if (s + gw > L - 0.2) break;
    const t0 = s / L, t1 = (s + gw) / L, belly = (R() < 0.5 ? -1 : 1) * (0.05 + R() * 0.07), ph = R() * TAU, tone = K.k * (0.92 + R() * 0.1);
    // a point of the cloth: fu across (0..1 along the line), fy down (0 at the pegs); it bellies in the breeze with a
    // crease or two down it, a shirt a little wider at its hem, the hem uneven
    const hemJ = Array.from({ length: 6 }, () => (R() - 0.5) * 0.04);
    const pt = (fu, fy) => {
      const top = at(lerp(t0, t1, fu)), flare = K.shirt ? (fu - 0.5) * 0.06 * fy : 0;
      const off = belly * Math.sin(Math.PI * fu) * fy ** 0.8 + 0.018 * Math.sin(fu * 9 + ph) * fy;
      const hem = fy > 0.99 ? hemJ[Math.min(5, Math.floor(fu * 5.99))] : 0;
      return [top[0] + tx * flare + nx * off, top[1] - 0.02 - gh * fy + hem, top[2] + tz * flare + nz * off];
    };
    // (one tone over the whole piece, barely varied: its folds shade it, not a mosaic of cells; the back of the cloth
    //  a little darker. liftClothNormals then tips its normals to the sky, so the sun lights it from either side.)
    const panel = (fu0, fu1, fy0, fy1, nu, nv) => {
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const u0 = lerp(fu0, fu1, i / nu), u1 = lerp(fu0, fu1, (i + 1) / nu), v0 = lerp(fy0, fy1, j / nv), v1 = lerp(fy0, fy1, (j + 1) / nv);
        const p00 = pt(u0, v0), p10 = pt(u1, v0), p11 = pt(u1, v1), p01 = pt(u0, v1), t = tone * (0.985 + 0.03 * Math.sin(i * 2.1 + j + ph));
        const mat = K.stripes && j % 2 ? K.alt : K.mat;
        G.quad(mat, p00, p10, p11, p01, t); G.quad(mat, p01, p11, p10, p00, t * 0.9);
      }
    };
    if (K.legs) { panel(0, 1, 0, 0.38, 4, 2); panel(0, 0.45, 0.38, 1, 2, 3); panel(0.55, 1, 0.38, 1, 2, 3); } // (two legs below the seat)
    else panel(0, 1, 0, 1, 4, K.stripes || 4);
    if (K.shirt) for (const fu of [0, 1]) { // the sleeves hanging at its sides
      const top = pt(fu, 0), sd = fu ? 1 : -1, sw = 0.11;
      const q = [top, [top[0] + tx * sd * sw, top[1] - 0.04, top[2] + tz * sd * sw], [top[0] + tx * sd * (sw + 0.02) + nx * belly * 0.4, top[1] - 0.42, top[2] + tz * sd * (sw + 0.02) + nz * belly * 0.4], [top[0] + nx * belly * 0.3, top[1] - 0.36, top[2] + nz * belly * 0.3]];
      if (sd > 0) { G.quad(K.mat, q[0], q[1], q[2], q[3], tone * 0.97); G.quad(K.mat, q[3], q[2], q[1], q[0], tone * 0.88); }
      else { G.quad(K.mat, q[3], q[2], q[1], q[0], tone * 0.97); G.quad(K.mat, q[0], q[1], q[2], q[3], tone * 0.88); }
    }
    for (const fu of [0.08, 0.92]) { const p = at(lerp(t0, t1, fu)); G.box('e03_timber', p[0], p[1] - 0.01, p[2], 0.022, 0.07, 0.016, Math.atan2(tz, tx), 0.7); } // pegs
    s += gw + 0.08 + R() * 0.22;
  }
}

/** The washing's materials (its triangles in them are counted by `clothMarks` before and after the lines are hung). */
export const CLOTH_MATS = ['e03_linen', 'e03_linenBlue', 'e03_canvasGrey', 'e03_canvasRed'];
/** How many vertices each cloth material holds in `G` so far (call before and after addWashingLine). */
export function clothMarks(G) { return CLOTH_MATS.map((m) => (G.parts.get(m)?.pos.length ?? 0) / 3); }

/**
 * Hanging cloth is thin: the sun shows through it, so the side away from the sun is not black. Built (`group` from
 * G.build(name)), the vertices each cloth material took between the marks `from` and `to` get their normals tipped up
 * to the sky (the face's own direction kept as a lean), so both faces of a shirt take the light from above.
 */
export function liftClothNormals(group, name, from, to, lean = 0.4, up = 1.2) {
  CLOTH_MATS.forEach((mat, k) => {
    const N = group.children.find((o) => o.name === `${name}:${mat}`)?.geometry.attributes.normal;
    if (!N) return;
    for (let i = from[k]; i < to[k]; i++) {
      const x = N.getX(i) * lean, y = N.getY(i) * lean + up, z = N.getZ(i) * lean, l = Math.hypot(x, y, z) || 1;
      N.setXYZ(i, x / l, y / l, z / l);
    }
    N.needsUpdate = true;
  });
}

/**
 * The trainer's things at the ring kerb: two galvanised feed buckets (one with meat in it), and his long whip, its
 * lash coiled on the ground and its stock laid across the kerb. `gy(x, z)`: the ground's height.
 */
export function addTrainerKit(G, { buckets, whip, kerb }, gy = () => 0) {
  for (const [x, z, meat] of buckets) {
    const y = gy(x, z), N = 12, r0 = 0.12, r1 = 0.155, H = 0.3;
    const P = (r, yy, k) => [x + Math.cos((k / N) * TAU) * r, yy, z + Math.sin((k / N) * TAU) * r];
    for (let k = 0; k < N; k++) {
      G.quad('e03_steel', P(r0, y, k), P(r1, y + H, k), P(r1, y + H, k + 1), P(r0, y, k + 1), 0.8);                 // outside
      G.quad('e03_steel', P(r0 - 0.008, y + 0.02, k + 1), P(r1 - 0.008, y + H, k + 1), P(r1 - 0.008, y + H, k), P(r0 - 0.008, y + 0.02, k), 0.62); // inside
    }
    G.ring('e03_steel', x, y + H - 0.012, z, r1 - 0.012, r1 + 0.008, 0.02, N, 0.9);    // the rolled rim
    G.cyl('e03_steel', x, y + 0.012, z, r0 - 0.008, r0 - 0.006, 0.012, N, 0.5);        // its floor
    let prev = null;
    for (let k = 0; k <= 6; k++) { // the wire bail, laid down over the rim
      const a = (k / 6) * Math.PI, p = [x + Math.cos(a) * (r1 + 0.01), y + H + 0.02 + Math.sin(a) * 0.05, z - Math.sin(a) * 0.04];
      if (prev) rod(G, 'e03_black', prev, p, 0.005, 3, 0.8);
      prev = p;
    }
    if (meat) for (let k = 0; k < 4; k++) G.box('e03_canvasRed', x + (k % 2 - 0.5) * 0.08, y + H - 0.07 + k * 0.012, z + (k > 1 ? 0.04 : -0.04), 0.1, 0.06, 0.08, k * 0.9, 0.55);
    else G.cyl('e03_glass', x, y + H - 0.08, z, r1 - 0.025, r1 - 0.022, 0.004, N, 0.55);   // water, a little below the rim
  }
  // the lash coiled on the grass in loose overlapping loops, the stock across the kerb top
  const [wx, wz] = whip, y0 = gy(wx, wz) + 0.012;
  let prev = null;
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * TAU * 2.6, rr = 0.2 + 0.07 * Math.sin(k * 0.37) + k * 0.0016;
    const p = [wx + Math.cos(a) * rr + k * 0.002, y0 + 0.006 * Math.sin(k * 1.3) + (k > 32 ? 0.008 : 0), wz + Math.sin(a) * rr];
    if (prev) rod(G, 'e03_black', prev, p, 0.006, 3, 0.75);
    prev = p;
  }
  const [k0, k1] = kerb;   // the stock: on the kerb's top rail, its end hanging over towards the coil
  rod(G, 'e03_timber', k0, k1, 0.016, 6, 0.55);
  rod(G, 'e03_black', k1, prev, 0.008, 4, 0.75);
}

// ------------------------------------------------------------------ tents

/** A ridge tent on its gameplay box (x, z, rot, w × d, h): two poles, sidewalls down, valance, guys to pegs. */
export function addRidgeTent(G, s, { roofMat = 'e03_canvasGrey', wallMat = 'e03_canvasGrey', stripe = 'e03_canvasRed', eave = 2.5, door = 'both', interior = false } = {}) {
  // canvas, not board: each wall is panels between side poles, bowed in between them, its hem wavy and mud-dark; the
  // roof sags in every bay; guy ropes run from each pole head to a stake; panels weather unevenly, a few are patched
  const F = localFrame(s.x, s.z, s.rot ?? 0), hu = s.w / 2, hw = s.d / 2, H = s.h, R = mulberry(seedOf(`e03:tent:${s.id ?? s.x}`));
  const P = (u, w, y) => W(F, u, w, y);
  const bays = Math.max(3, Math.round(s.w / 2.2)), bu = (2 * hu) / bays;
  const both = (mat, a, b, c, d, t) => { G.quad(mat, a, b, c, d, t); G.quad(mat, d, c, b, a, t * 0.74); };
  // the long walls: panels of 3 × 3 cells, each pulled in at its middle
  for (const s2 of [-1, 1]) for (let k = 0; k < bays; k++) {
    const u0 = -hu + k * bu, tone = 0.86 + R() * 0.16, bow = 0.08 + R() * 0.1, lift = R() < 0.25 ? 0.12 + R() * 0.1 : 0;
    const pt = (i, j) => {
      const fu = i / 3, fy = j / 3, inn = bow * Math.sin(Math.PI * fu) * Math.sin(Math.PI * Math.min(1, fy * 1.15));
      const y = j === 0 ? lift * Math.sin(Math.PI * fu) + (R() - 0.5) * 0.04 : fy * eave;
      return P(u0 + fu * bu, s2 * (hw - inn), Math.max(0, y));
    };
    const g = []; for (let j = 0; j <= 3; j++) { g.push([]); for (let i = 0; i <= 3; i++) g[j].push(pt(i, j)); }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const t = tone * (j === 0 ? 0.8 : 1) * (0.97 + R() * 0.06);
      if (s2 > 0) both(wallMat, g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i], t); else both(wallMat, g[j][i + 1], g[j][i], g[j + 1][i], g[j + 1][i + 1], t);
    }
    if (R() < 0.3) { // a patch sewn on: a slightly darker square standing just proud of the cloth
      const pu = u0 + bu * (0.25 + R() * 0.4), py = 0.6 + R() * (eave - 1.4), ps = 0.35 + R() * 0.3, ww = s2 * (hw + 0.012);
      both(wallMat, P(pu, ww, py), P(pu + ps, ww, py), P(pu + ps, ww, py + ps * 0.8), P(pu, ww, py + ps * 0.8), tone * 0.78);
    }
  }
  // side poles at the panel joints, a guy rope from each pole head to a stake in the grass
  // (the roof's eave reaches out over the poles, so each pole stops just under it and its guy leaves from the eave)
  for (const s2 of [-1, 1]) for (let k = 0; k <= bays; k++) {
    const u = -hu + k * bu, top = P(u, s2 * (hw + 0.24), eave + 0.27); // (the eave's edge at the pole: eave + 0.04 + LIFT)
    G.cyl('e03_timber', ...P(u, s2 * (hw + 0.06), 0), 0.055, 0.045, eave + 0.02, 6, 0.8);
    const out = 1.5 + R() * 0.4, st = P(u + (R() - 0.5) * 0.3, s2 * (hw + out), 0.0);
    rod(G, 'e03_rope', top, [st[0], 0.22, st[2]], 0.016, 3, 0.9);
    G.cyl('e03_timber', st[0], 0, st[2], 0.04, 0.03, 0.32, 5, 0.6);
  }
  // the roof: each bay sags in its middle (between the roof poles) and across; bays weather unevenly (some bleached,
  // some rain-darkened), with a laced seam over every roof pole, a ridge rope and water stains
  // (the eave reaches out over the valance and stands a little above it, so even sagging between the poles it never
  // dips into the valance's plane — it fought it all along the eave; a flat, unsagged eave row shaded a dark patch
  // into every bay)
  const sagAt = (fu, fw) => (0.3 + 0.08 * R()) * Math.sin(Math.PI * fu) * (0.55 + 0.45 * Math.sin(Math.PI * fw));
  const OV = 0.24, LIFT = 0.25;
  const roofY = (fu, fw) => eave + 0.04 + LIFT * (1 - fw) + (H - eave - 0.04 - LIFT) * fw - sagAt(fu, fw);
  for (let k = 0; k < bays; k++) {
    const u0 = -hu + k * bu, tone = 0.8 + R() * 0.24;
    for (const s2 of [-1, 1]) {
      const grid = [];
      for (let j = 0; j <= 3; j++) { grid.push([]); for (let i = 0; i <= 3; i++) { const fu = i / 3, fw = j / 3; grid[j].push(P(u0 + fu * bu, s2 * (hw + OV) * (1 - fw), roofY(fu, fw))); } }
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i], t = tone * (0.94 + R() * 0.1) * (j === 0 ? 0.93 : 1);
        if (s2 > 0) both(roofMat, a, b, c, d, t); else both(roofMat, d, c, b, a, t);
      }
      if (R() < 0.3) { // a water stain spreading down from the ridge (faint, each its own shade)
        // (draped on the bay's own cloth triangles: a flat quad over the sagging bay dipped into the canvas and fought it)
        const su = u0 + bu * (0.2 + R() * 0.5), fw0 = 0.35 + R() * 0.4, len = 0.9 + R() * 1.2, wid = 0.4 + R() * 0.5;
        const d2 = len / (2 * (hw + OV)), st = tone * (0.8 + R() * 0.12);
        const g = (du, dfw) => [((su + du - u0) / bu) * 3, Math.min(0.98, fw0 + dfw) * 3];   // grid units
        drapePatch(G, roofMat, grid, [g(0, 0), g(wid, 0), g(wid * 0.8, d2), g(wid * 0.1, d2)], 0.02, st, s2 > 0);
      }
    }
  }
  for (let k = 0; k <= bays; k++) for (const s2 of [-1, 1]) { // seams over the roof poles
    const u = -hu + k * bu;
    rod(G, 'e03_rope', P(u, s2 * (hw + OV), eave + 0.07 + LIFT), P(u, 0, H + 0.02), 0.02, 3, 0.75);
  }
  rod(G, 'e03_rope', P(-hu - 0.1, 0, H + 0.04), P(hu + 0.1, 0, H + 0.04), 0.03, 4, 0.8); // the ridge rope
  for (const su of [-1, 1]) for (const sw of [-0.6, 0.6]) { // the end poles' guys
    rod(G, 'e03_rope', P(su * hu, 0, H + 0.1), P(su * (hu + 2.6 + R() * 0.6), sw * hw, 0.2), 0.016, 3, 0.9);
    G.cyl('e03_timber', ...P(su * (hu + 2.6), sw * hw, 0), 0.04, 0.03, 0.32, 5, 0.6);
  }
  // gable ends; the door end's flap rolled up over a dark doorway
  for (const su of [-1, 1]) {
    const isDoor = door === 'both' || (door === 'east' && su > 0) || (door === 'west' && su < 0);
    const uu = su * hu, dw = Math.min(1.1, hw * 0.4), dh = Math.min(2.2, eave - 0.2);
    const a = P(uu, -hw, 0), b = P(uu, hw, 0), c = P(uu, hw, eave), d = P(uu, -hw, eave), t = P(uu, 0, H);
    const tone = 0.9 + R() * 0.1;
    if (!isDoor) { both(wallMat, a, b, c, d, tone); }
    else {
      both(wallMat, a, P(uu, -dw, 0), P(uu, -dw, eave), d, tone);
      both(wallMat, P(uu, dw, 0), b, c, P(uu, dw, eave), tone);
      both(wallMat, P(uu, -dw, dh), P(uu, dw, dh), P(uu, dw, eave), P(uu, -dw, eave), tone);
      // the dark inside (an `interior` tent shows its own: what stands in it, in the shade of its canvas)
      if (!interior) G.quad('e03_black', P(uu - su * 0.4, -dw, 0.01), P(uu - su * 0.4, dw, 0.01), P(uu - su * 0.4, dw, dh), P(uu - su * 0.4, -dw, dh), 0.5);
      rod(G, wallMat, P(uu + su * 0.08, -dw, dh + 0.12), P(uu + su * 0.08, dw, dh + 0.12), 0.13, 8, 0.85); // the rolled flap
      for (const sw of [-1, 1]) rod(G, 'e03_rope', P(uu + su * 0.1, sw * dw * 0.6, dh + 0.12), P(uu + su * 0.1, sw * dw * 0.6, dh + 0.5), 0.012, 3);
    }
    G.tri(wallMat, d, c, t, tone); G.tri(wallMat, t, c, d, tone * 0.74);
  }
  // the valance under the eaves (scalloped, faded red) and the ridge poles with their pennants
  for (const s2 of [-1, 1]) {
    // (the band and its scallops hang outside the side poles: in the poles' plane they fought the round timber)
    segBox(G, stripe, F, -hu - 0.05, hu + 0.05, s2 * (hw + 0.15) - 0.02, s2 * (hw + 0.15) + 0.02, eave - 0.4, eave, 0.9);
    const nv = Math.round(s.w / 1.0);
    for (let k = 0; k < nv; k++) {
      const u0 = -hu + k * (s.w / nv), u1 = u0 + s.w / nv, um = (u0 + u1) / 2, ww = s2 * (hw + 0.2), dip = 0.5 + R() * 0.15;
      G.tri(stripe, P(u0, ww, eave), P(u1, ww, eave), P(um, ww, eave - dip), 0.9);
      G.tri(stripe, P(um, ww, eave - dip), P(u1, ww, eave), P(u0, ww, eave), 0.7);
    }
  }
  for (const u of [-hu * 0.55, hu * 0.55]) {
    G.cyl('e03_timber', ...P(u, 0, H - 0.2), 0.07, 0.05, 1.0, 6, 0.8);
    G.quad('e03_canvasRed', P(u, 0, H + 0.75), P(u + 0.7, 0, H + 0.6), P(u + 0.7, 0, H + 0.4), P(u, 0, H + 0.3));
    G.quad('e03_canvasRed', P(u, 0, H + 0.3), P(u + 0.7, 0, H + 0.4), P(u + 0.7, 0, H + 0.6), P(u, 0, H + 0.75));
  }
  return F;
}

// ------------------------------------------------------------------ the owner's villa

/**
 * The owner's villa on its gameplay box (x, z, w × d): two storeys of cream render on a stone plinth with stone quoins,
 * a floor band and a cornice; a round bay rising as a three-storey corner tower with a bell-cast slate cap on the
 * garden (SE) corner, inside the box (the walls stop at it); sash windows with green shutters — most folded back, some
 * closed, one or two swung ajar — the French windows of the drawing room on the W face, the front door and its porch
 * on the N face, the kitchen door under a lean-to hood on the S face; a weathered slate hipped roof (mended patches, a
 * gentle sag) with two dormers on each long side, brick chimney stacks, half-round gutters and downpipes, a few patches
 * where the render has fallen and the brick shows.
 */
export function buildVilla(s) {
  const G = new Geo('e03:villa');
  const F = localFrame(s.x, s.z, s.rot ?? 0), hu = s.w / 2, hw = s.d / 2, EAVE = 7.6, RH = 3.9, R0 = rng(seedOf('e03:villa'));
  const BR = 2.9, bu = hu - BR, bw = hw - BR, TE = EAVE + 3.2;   // the round bay: centre (frame), radius, its own eave
  const at = (u, w) => F.at(u, w);
  // a quad / triangle wound to face `want` (world): the caller gives its corners in any order round the outline
  const facing = (pts, want) => {
    const [a, b, c] = pts, e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    return n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0 ? pts.slice().reverse() : pts;
  };
  const quadF = (mat, pts, want, tone = 1) => { const q = facing(pts, want); G.quad(mat, q[0], q[1], q[2], q[3], tone); };
  const triF = (mat, pts, want, tone = 1) => { const q = facing(pts, want); G.tri(mat, q[0], q[1], q[2], tone); };
  const out = (side) => [F.n[0] * side, 0, F.n[1] * side];   // world direction of the frame's ±w
  const [tx, tz] = at(bu, bw);
  // the body: an L round the bay (one prism each: no faces inside faces), plinth, floor band, cornice
  const L = (p) => [at(-hu - p, -hw - p), at(hu + p, -hw - p), at(hu + p, bw), at(bu, bw), at(bu, hw + p), at(-hu - p, hw + p)];
  G.prism('e03_render', L(0), 0.55, EAVE, 0.97, { top: false });
  G.prism('e03_plinth', L(0.06), 0, 0.6, 0.9);
  G.prism('e03_plinth', L(0.08), 3.85, 4.05, 0.92);
  G.prism('e03_render', L(0.22), EAVE - 0.35, EAVE, 0.9);
  // the bay: render drum to its own eave, its plinth, bands and cornice as rings
  const SEG = 20;
  G.cyl('e03_render', tx, 0.55, tz, BR, BR, TE - 0.55, SEG, 0.96, { caps: false });
  G.ring('e03_plinth', tx, 0, tz, BR - 0.1, BR + 0.06, 0.6, SEG, 0.9);
  G.ring('e03_plinth', tx, 3.85, tz, BR - 0.1, BR + 0.08, 0.2, SEG, 0.92);
  G.ring('e03_plinth', tx, EAVE + 0.1, tz, BR - 0.1, BR + 0.07, 0.16, SEG, 0.92);
  G.ring('e03_render', tx, TE - 0.35, tz, BR - 0.1, BR + 0.2, 0.35, SEG, 0.9);
  // its cap: bell-cast slate (a flared skirt, then the cone), a lead finial and a weathervane
  G.ring('e03_timber', tx, TE - 0.04, tz, BR + 0.05, BR + 0.42, 0.14, SEG, 0.75);
  G.cyl('slate', tx, TE + 0.1, tz, BR + 0.45, BR * 0.72, 0.75, SEG, 1.0, { caps: false });
  G.cyl('slate', tx, TE + 0.85, tz, BR * 0.72, 0.03, 2.9, SEG, 0.96, { caps: false });
  rod(G, 'e03_black', [tx, TE + 3.6, tz], [tx, TE + 4.7, tz], 0.03, 5);
  G.cyl('e03_gold', tx, TE + 3.95, tz, 0.09, 0.09, 0.16, 8, 1);
  G.box('e03_black', tx + 0.12, TE + 4.45, tz, 0.62, 0.2, 0.02, 0.6, 0.9);
  // windows: [frame u, frame w] centre on the wall, outward normal, sill height and size
  const winBox = (mat, c, nrm, y, sw, sh, d) => {   // a flat box centred on wall point c, thin along the normal nrm (frame)
    const [x, z] = at(c[0] + nrm[0] * d, c[1] + nrm[1] * d);
    const t = [F.t[0] * -nrm[1] + F.n[0] * nrm[0], F.t[1] * -nrm[1] + F.n[1] * nrm[0]];   // the wall's tangent (world)
    G.box(mat, x, y + sh / 2, z, sw, sh, 0.06, Math.atan2(t[1], t[0]));
  };
  const addWindow = (c, nrm, y0, h, ww, kind) => {
    winBox('e03_frame', c, nrm, y0 - 0.1, ww + 0.2, h + 0.2, 0.02);
    winBox(kind === 'door' ? 'e03_door' : 'e03_glass', c, nrm, y0, ww, h, 0.05);
    if (kind !== 'door') {
      winBox('e03_frame', c, nrm, y0 + 0.02, 0.05, h - 0.04, 0.08);                         // (the bars stand inside the glass's edges)
      // the glazing bars sit 1 cm behind the mullion's face (flush, their faces fought it where they cross)
      for (const f of [0.34, 0.67]) winBox('e03_frame', c, nrm, y0 + h * f, ww - 0.04, 0.04, 0.07);
    }
    winBox('e03_plinth', c, nrm, y0 - 0.18, ww + 0.35, 0.1, 0.1);                             // sill
    winBox('e03_plinth', c, nrm, y0 + h + 0.1, ww + 0.3, 0.12, 0.07);                         // lintel
  };
  const shutters = (c, nrm, y0, h, ww) => {
    const tn = [-nrm[1], nrm[0]], r = R0();
    if (r < 0.1) {   // closed: two leaves over the glass
      for (const sd of [-1, 1]) winBox('e03_shutter', [c[0] + tn[0] * sd * ww / 4, c[1] + tn[1] * sd * ww / 4], nrm, y0, ww / 2 - 0.01, h, 0.11);
      return;
    }
    for (const sd of [-1, 1]) {
      const hinge = [c[0] + tn[0] * sd * (ww / 2 + 0.05), c[1] + tn[1] * sd * (ww / 2 + 0.05)];
      if (r < 0.22 && sd > 0) {   // one leaf swung ajar, 50°–70° off the wall
        const a = (50 + R0() * 20) * Math.PI / 180, dir = [tn[0] * Math.cos(a) + nrm[0] * Math.sin(a), tn[1] * Math.cos(a) + nrm[1] * Math.sin(a)];
        const mid = [hinge[0] + dir[0] * 0.26 + nrm[0] * 0.06, hinge[1] + dir[1] * 0.26 + nrm[1] * 0.06];
        const [x, z] = at(...mid), wd = [F.t[0] * dir[0] + F.n[0] * dir[1], F.t[1] * dir[0] + F.n[1] * dir[1]];
        G.box('e03_shutter', x, y0 + h / 2, z, 0.5, h, 0.05, Math.atan2(wd[1], wd[0]), 0.88 + R0() * 0.1);
        continue;
      }
      winBox('e03_shutter', [hinge[0] + tn[0] * sd * 0.27, hinge[1] + tn[1] * sd * 0.27], nrm, y0, 0.5, h, 0.07 + R0() * 0.02);
    }
  };
  // the four faces, each with the stretch of wall it has (the S and E faces stop at the bay)
  const faces = [   // [from point, to point (frame), outward normal]
    [[-hu, -hw], [hu, -hw], [0, -1]], [[-hu, hw], [bu, hw], [0, 1]], [[-hu, -hw], [-hu, hw], [-1, 0]], [[hu, -hw], [hu, bw], [1, 0]],
  ];
  const sw = [];   // window rectangles per face (for the patches of fallen render)
  for (const [a, b, nrm] of faces) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(len / 3.3)), step = len / n, d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const centre = Math.abs(nrm[1]) > 0 ? -a[0] : -a[1];   // where the face's centre line (u = 0 / w = 0) falls along it
    let doorK = -1, best = 1e9;
    for (let k = 0; k < n; k++) { const off = (k + 0.5) * step; if (Math.abs(off - centre) < best) { best = Math.abs(off - centre); doorK = k; } }
    for (let k = 0; k < n; k++) {
      const off = (k + 0.5) * step + (k > 0 && k < n - 1 ? (R0() - 0.5) * 0.25 : 0), c = [a[0] + d[0] * off, a[1] + d[1] * off];
      for (const [y0, h] of [[1.1, 2.1], [4.6, 2.0]]) {
        const ground = y0 < 2, mid = k === doorK;
        const french = ground && mid && nrm[0] < 0;                 // the drawing room's French windows (W face)
        const door = ground && mid && nrm[1] !== 0;                  // the front door (N), the kitchen door (S)
        const blind = !ground && !french && !door && R0() < 0.07;     // a blind window: rendered over, its surround kept
        const yy = french || door ? 0.62 : y0, hh = french || door ? 2.6 : h, ww = french ? 1.5 : door ? 1.2 : 1.05;
        if (blind) { winBox('e03_frame', c, nrm, yy - 0.1, ww + 0.2, hh + 0.2, 0.02); winBox('e03_render', c, nrm, yy, ww, hh, 0.035); winBox('e03_plinth', c, nrm, yy - 0.18, ww + 0.35, 0.1, 0.1); continue; }
        addWindow(c, nrm, yy, hh, ww, door ? 'door' : 'win');
        if (!french && !door) shutters(c, nrm, yy, hh, ww);
        sw.push({ c, nrm, y0: yy, h: hh, ww: ww + 1.2 });
      }
    }
  }
  // the bay's windows: on the facets facing the garden, three storeys
  // (G.cyl's facets are at world angles: facet k faces (k + 0.5) · 18°, its normal taken into the frame)
  const dF = BR * Math.cos(Math.PI / SEG);
  for (const [k, y0, h] of [[1, 1.1, 2.1], [3, 1.1, 2.1], [1, 4.6, 2.0], [3, 4.6, 2.0], [2, EAVE + 0.85, 1.45]]) {
    const a = (k + 0.5) * (TAU / SEG) + Math.atan2(F.t[1], F.t[0]), wx = Math.cos(a), wz = Math.sin(a);
    const nrm = [wx * F.t[0] + wz * F.t[1], wx * F.n[0] + wz * F.n[1]], c = [bu + nrm[0] * dF, bw + nrm[1] * dF];
    addWindow(c, nrm, y0, h, 0.8, 'win');
  }
  // quoins: long and short stones in turn up the three free corners
  for (const [cu, cw] of [[-hu, -hw], [hu, -hw], [-hu, hw]]) {
    const su = Math.sign(cu), sw2 = Math.sign(cw);
    for (let k = 0, y = 0.62; y + 0.36 < EAVE - 0.4; k++, y += 0.44) {
      const lu = k % 2 ? 0.32 : 0.62, lw = k % 2 ? 0.62 : 0.32, t = 0.86 + R0() * 0.12;
      if (y < 4.12 && y + 0.36 > 3.8) continue;   // (the floor band runs through here)
      segBox(G, 'e03_plinth', F, su > 0 ? cu - lu : cu - 0.05, su > 0 ? cu + 0.05 : cu + lu, sw2 > 0 ? cw - lw : cw - 0.05, sw2 > 0 ? cw + 0.05 : cw + lw, y, y + 0.36, t);
    }
  }
  // patches where the render has fallen and the brick shows (between the windows, never over one)
  for (const f of faces) {
    const [a, b, nrm] = f, len = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    for (let tries = 0; tries < 6; tries++) {
      if (R0() > 0.35) continue;
      const off = 1 + R0() * (len - 2), y = 0.8 + R0() * 5.6, pw = 0.4 + R0() * 0.5, ph = 0.3 + R0() * 0.5;
      const c = [a[0] + d[0] * off, a[1] + d[1] * off];
      const hit = sw.some((q) => q.nrm === nrm && Math.hypot(q.c[0] - c[0], q.c[1] - c[1]) < (q.ww + pw) / 2 && y + ph > q.y0 - 0.3 && y < q.y0 + q.h + 0.3);
      if (hit || (y > 3.7 && y < 4.2)) continue;   // (and off the floor band)
      winBox('e03_brickDark', c, nrm, y, pw, ph, 0.03);
    }
  }
  // the front porch: two columns and a little hipped roof over the N door, the steps
  for (const du of [-1.3, 1.3]) G.cyl('e03_render', ...W(F, du, -hw - 1.0, 0.4), 0.13, 0.12, 2.95, 10, 0.95);
  hipRoof(G, F, -1.7, 1.7, -hw - 1.35, -hw, 3.3, 0.6, 'slate', 0.15);
  for (let k = 0; k < 2; k++) fb(G, 'e03_plinth', F, 0, -hw - 0.85 + k * 0.3, 0, 3.2 - k * 0.3, 0.42 - k * 0.2, 0.9 - k * 0.3, 0.9);
  // the kitchen door's hood on the S face: a zinc lean-to on two brackets, a worn step
  const ku = sw.find((q) => q.nrm[1] > 0 && q.y0 < 1)?.c[0] ?? 0;
  for (const du of [-0.75, 0.75]) rod(G, 'e03_black', W(F, ku + du, hw, 2.6), W(F, ku + du, hw + 0.75, 3.3), 0.03, 4);
  quadF('e03_zinc', [W(F, ku - 0.95, hw + 0.95, 3.25), W(F, ku + 0.95, hw + 0.95, 3.25), W(F, ku + 0.95, hw + 0.05, 3.55), W(F, ku - 0.95, hw + 0.05, 3.55)], [0, 1, 0]);
  quadF('e03_zinc', [W(F, ku - 0.95, hw + 0.05, 3.53), W(F, ku + 0.95, hw + 0.05, 3.53), W(F, ku + 0.95, hw + 0.95, 3.23), W(F, ku - 0.95, hw + 0.95, 3.23)], [0, -1, 0], 0.7);
  fb(G, 'e03_plinth', F, ku + 0.05, hw + 0.25, 0, 1.6, 0.18, 0.5, 0.85);
  // the roof: weathered slate (mended patches, a gentle sag between the trusses), hips and ridge in lead-grey
  weatheredHipRoof(G, F, -hu - 0.22, hu + 0.22, -hw - 0.22, hw + 0.22, EAVE, RH, { oh: 0.35, bay: 4.2, seed: 'e03:villa_roof', mat: 'slate', cap: 'e03_steel', sag: 0.35 });
  const w0e = hw + 0.57, rise = RH / w0e;   // the long faces' slope (m up per m in)
  // dormers: two on each long side, their little gabled roofs dying into the slope
  for (const [du, side] of [[-6.2, -1], [1.0, -1], [-6.2, 1], [-1.8, 1]]) {
    const wf = side * (hw - 0.9), yF = EAVE + rise * (w0e - (hw - 0.9)) - 0.12, yT = yF + 1.15;
    const back = side * (w0e - (yT - EAVE) / rise), ridgeBack = side * (w0e - (yT + 0.55 - EAVE) / rise);   // (into the slope)
    fb(G, 'e03_render', F, du, wf - side * 0.6, yF - 0.3, 1.5, yT - yF + 0.3, 1.2, 0.95);   // front wall and cheeks (the back buried)
    addWindow([du, wf], [0, side], yF + 0.15, 0.8, 0.7, 'win');
    for (const sd of [-1, 1]) {   // the two roof planes: eave and ridge from the front overhang back into the slope
      quadF('slate', [W(F, du + sd * 0.92, wf + side * 0.25, yT), W(F, du + sd * 0.92, back, yT), W(F, du, ridgeBack, yT + 0.55), W(F, du, wf + side * 0.25, yT + 0.55)], [0, 1, 0], 0.95);
    }
    triF('e03_render', [W(F, du - 0.75, wf, yT), W(F, du + 0.75, wf, yT), W(F, du, wf, yT + 0.5)], out(side), 0.93);
  }
  // the chimney stacks: brick, corbelled caps, pots of different counts
  for (const [du, pots] of [[-4.2, 2], [4.2, 3]]) {
    fb(G, 'e03_brick', F, du, 0.5, EAVE + 1.2, 0.9, 4.0, 0.7, 0.92);
    fb(G, 'e03_brick', F, du, 0.5, EAVE + 5.05, 1.02, 0.14, 0.82, 0.86);
    fb(G, 'e03_plinth', F, du, 0.5, EAVE + 5.19, 0.94, 0.08, 0.74, 0.85);
    for (let k = 0; k < pots; k++) G.cyl('e03_brickDark', ...W(F, du + (k - (pots - 1) / 2) * 0.28, 0.5, EAVE + 5.27), 0.09, 0.075, 0.3 + R0() * 0.12, 8, 0.8);
  }
  // half-round gutters along the long eaves, downpipes (between the windows) with swan necks down to the plinth
  for (const side of [-1, 1]) {
    const wg = side * (w0e + 0.04);
    rod(G, 'e03_steel', W(F, -hu - 0.5, wg, EAVE - 0.12), W(F, hu + 0.5, wg, EAVE - 0.12), 0.07, 6, 0.75);
    const us = sw.filter((q) => q.nrm[1] === side && q.y0 < 2).map((q) => q.c[0]).sort((p, q) => p - q);
    const picks = us.length > 3 ? [(us[0] + us[1]) / 2, (us[us.length - 2] + us[us.length - 1]) / 2] : [];
    if (side < 0 && us.length > 5) picks.push((us[2] + us[3]) / 2);
    for (const du of picks) {
      const wwall = side * (hw + 0.1);
      rod(G, 'e03_steel', W(F, du, wg, EAVE - 0.14), W(F, du, wwall, EAVE - 0.6), 0.045, 5, 0.72);
      rod(G, 'e03_steel', W(F, du, wwall, EAVE - 0.6), W(F, du, wwall, 0.25), 0.045, 5, 0.72);
      for (let y = 1.4; y < EAVE - 0.8; y += 1.8) if (y < 3.75 || y > 4.15) fb(G, 'e03_black', F, du, side * (hw + 0.05), y, 0.14, 0.05, 0.1, 0.8);   // brackets
    }
  }
  return G.build('e03:villa', { damp: 0.9, streaks: 0.22 });
}

// ------------------------------------------------------------------ the villa's timber veranda

/** The veranda on the villa's W face: deck, posts, lean-to roof on brackets, balustrade on the rail lines, steps. */
export function buildVeranda(V, rails, { wallX }) {
  const G = new Geo('e03:veranda');
  const F = localFrame(0, 0, 0);
  const x0 = V.x0, x1 = wallX, z0 = V.z0, z1 = V.z1, Y = 0.12, HR = 3.1, HW = 3.7;
  segBox(G, 'e03_timber', F, x0, x1, z0, z1, 0, Y, 0.9);                                  // deck (flush)
  for (let k = 0; k <= 10; k++) fb(G, 'e03_timber', F, x0 + 0.3, z0 + ((z1 - z0) * k) / 10, Y, 0.08, 0.01, 0.06, 0.6); // plank joints
  const posts = [z0 + 0.12, z0 + 3.4, z1 - 3.4, z1 - 0.12];
  for (const z of posts) { fb(G, 'e03_cream', F, x0 + 0.12, z, Y, 0.18, HR - 0.3 - Y, 0.18, 0.95); fb(G, 'e03_cream', F, x0 + 0.12, z, HR - 0.3, 0.42, 0.06, 0.42, 0.9); }
  segBox(G, 'e03_cream', F, x0 - 0.05, x0 + 0.3, z0 - 0.2, z1 + 0.2, HR - 0.24, HR - 0.02, 0.9);  // beam
  // the lean-to roof: corrugated zinc in lapped courses from the wall (HW) down past the beam, on timber purlins; sheets
  // of different ages (one newer and brighter, a rusted one), a lead strip along the wall, a gutter and its downpipe
  const P = (x, z, y) => [x, y, z], R = mulberry(seedOf('e03:veranda_roof'));
  const xl = x0 - 0.4, yl = HR + 0.08, zA = z0 - 0.3, zB = z1 + 0.3;
  const plane = (x) => yl + ((HW - yl) * (x - xl)) / (x1 - xl);       // the roof's mid-surface height at x
  const AMP = 0.018, PITCH = 0.15, SHEET = 0.9, NC = 4, LAP = 0.14;
  const crs = (x1 - xl) / NC;
  for (let c = 0; c < NC; c++) {
    // (each course laps down over the one below it: the higher course lies on top, its lower edge past their joint)
    const xa = x1 - c * crs, xb = Math.max(xl, x1 - (c + 1) * crs - (c < NC - 1 ? LAP : 0)), dy = (NC - 1 - c) * 0.022;
    for (let zs = zA; zs < zB - 1e-6; zs += SHEET) {
      const ze = Math.min(zB, zs + SHEET), r = R(), tone = r < 0.06 ? 0.62 : r < 0.12 ? 1.16 : 0.86 + R() * 0.2, rusty = R() < 0.14;
      const n = Math.max(2, Math.round((ze - zs) / (PITCH / 2)));
      for (let i = 0; i < n; i++) {
        const za = zs + ((ze - zs) * i) / n, zb = zs + ((ze - zs) * (i + 1)) / n;
        const ya = AMP * Math.sin((TAU * (za - zA)) / PITCH) + dy, yb = AMP * Math.sin((TAU * (zb - zA)) / PITCH) + dy;
        G.quad(rusty ? 'e03_zincRust' : 'e03_zinc', P(xb, za, plane(xb) + ya), P(xb, zb, plane(xb) + yb), P(xa, zb, plane(xa) + yb), P(xa, za, plane(xa) + ya), tone);
      }
    }
  }
  G.quad('e03_zinc', P(x1, zA, HW - 0.03), P(x1, zB, HW - 0.03), P(xl, zB, yl - 0.03), P(xl, zA, yl - 0.03), 0.55);   // underside
  for (const f of [0.1, 0.45, 0.8]) {   // purlins (the first on the beam)
    const xp = lerp(xl, x1, f);
    segBox(G, 'e03_timber', F, xp - 0.05, xp + 0.05, zA + 0.05, zB - 0.05, Math.min(HR - 0.04, plane(xp) - 0.14), plane(xp) - 0.026, 0.8);
  }
  const lift = (NC - 1) * 0.022;   // (the top course's lift over the mid-surface)
  segBox(G, 'e03_steel', F, x1 - 0.32, x1, zA, zB, plane(x1 - 0.32) + lift + 0.03, plane(x1) + lift + 0.06, 0.7);   // lead flashing over the top course
  rod(G, 'e03_steel', P(xl - 0.06, zA, yl - 0.06), P(xl - 0.06, zB, yl - 0.06), 0.065, 6, 0.72);                 // gutter
  rod(G, 'e03_steel', P(xl - 0.06, zB - 0.1, yl - 0.08), P(x0 - 0.1, zB - 0.1, yl - 0.5), 0.04, 5, 0.7);        // downpipe at the S end
  rod(G, 'e03_steel', P(x0 - 0.1, zB - 0.1, yl - 0.5), P(x0 - 0.1, zB - 0.1, 0.2), 0.04, 5, 0.7);
  segBox(G, 'e03_green', F, xl - 0.02, xl + 0.05, zA, zB, yl - 0.26, yl - 0.04, 0.9);                            // fascia
  // balustrade on the rail lines: top rail, bottom rail, balusters (one per spot: where two runs meet each put one
  // there, the same box twice)
  const placed = new Set();
  for (const line of rails) for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.3) { fb(G, 'e03_cream', F, ax, az, Y, 0.14, 0.98, 0.14, 0.95); continue; }
    rod(G, 'e03_cream', [ax, 0.95, az], [bx, 0.95, bz], 0.05, 4, 0.95);
    rod(G, 'e03_cream', [ax, 0.22, az], [bx, 0.22, bz], 0.035, 4, 0.95);
    const n = Math.max(2, Math.round(L / 0.16));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = lerp(ax, bx, t), z = lerp(az, bz, t), key = `${Math.round(x * 50)}:${Math.round(z * 50)}`;
      if (placed.has(key)) continue;
      placed.add(key);
      fb(G, 'e03_cream', F, x, z, Y, 0.045, 0.83, 0.045, 0.95);
    }
  }
  // steps at the W opening and the N end
  for (let k = 0; k < 2; k++) fb(G, 'e03_timber', F, x0 - 0.25 - k * 0.3, (z0 + z1) / 2, 0, 0.3, 0.1 - k * 0.04, 2.6, 0.85);
  // the coffee table and two chairs at the S end, the gramophone on a stand at the N end
  G.cyl('e03_white', 112.7, 0.72, 66.25, 0.36, 0.36, 0.04, 14, 1);
  rod(G, 'e03_black', [112.7, Y, 66.25], [112.7, 0.72, 66.25], 0.03, 5);
  for (const dx of [-0.6, 0.6]) { fb(G, 'e03_black', F, 112.7 + dx, 66.3, Y, 0.42, 0.42, 0.42, 0.8); fb(G, 'e03_black', F, 112.7 + dx * 1.18, 66.3, 0.54, 0.06, 0.5, 0.42, 0.8); }
  fb(G, 'e03_timber', F, 113.1, 57.6, Y, 0.5, 0.75, 0.45, 0.85);
  fb(G, 'e03_oxblood', F, 113.1, 57.6, 0.87, 0.36, 0.14, 0.36, 0.9);
  G.cyl('e03_gold', 113.0, 1.02, 57.6, 0.04, 0.22, 0.32, 12, 1, { caps: false });
  return G.build('e03:veranda', { damp: 0.3 });
}

// ------------------------------------------------------------------ the water tower

/** The water tower: four steel legs braced, a plank deck with a rail at `deck` m, the riveted tank, the S ladder. */
export function buildWaterTower(x, z, deck, { tankR = 1.7, half = 2.0 } = {}) {
  const G = new Geo('e03:tower');
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    rod(G, 'e03_steel', [x + sx * (half + 0.15), 0, z + sz * (half + 0.15)], [x + sx * half * 0.92, deck, z + sz * half * 0.92], 0.12, 6, 0.85);
    G.box('e03_brickDark', x + sx * (half + 0.15), 0.15, z + sz * (half + 0.15), 0.55, 0.3, 0.55);
  }
  const corner = (sx, sz, y) => { const k = lerp(half + 0.15, half * 0.92, y / deck); return [x + sx * k, y, z + sz * k]; };
  for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
    for (const [y0, y1] of [[0.4, 4.0], [4.0, deck - 0.3]]) {
      rod(G, 'e03_steel', corner(...a, y0), corner(...b, y1), 0.04, 4, 0.8);
      rod(G, 'e03_steel', corner(...b, y0), corner(...a, y1), 0.04, 4, 0.8);
    }
    rod(G, 'e03_steel', corner(...a, 4.0), corner(...b, 4.0), 0.05, 4, 0.8);
  }
  G.box('e03_timber', x, deck - 0.1, z, 2 * half + 0.9, 0.2, 2 * half + 0.9, 0, 0.85);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) rod(G, 'e03_steel', [x + sx * (half + 0.4), deck, z + sz * (half + 0.4)], [x + sx * (half + 0.4), deck + 1.05, z + sz * (half + 0.4)], 0.03, 4);
  for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) for (const y of [0.5, 1.05]) {
    rod(G, 'e03_steel', [x + a[0] * (half + 0.4), deck + y, z + a[1] * (half + 0.4)], [x + b[0] * (half + 0.4), deck + y, z + b[1] * (half + 0.4)], 0.025, 4);
  }
  G.cyl('e03_steel', x, deck + 0.05, z, tankR, tankR, 3.0, 20, 0.9);
  for (const y of [0.6, 1.6, 2.6]) G.ring('e03_black', x, deck + 0.05 + y, z, tankR - 0.01, tankR + 0.03, 0.06, 20, 0.8);
  G.cyl('e03_zinc', x, deck + 3.05, z, tankR + 0.12, 0.25, 1.0, 20, 0.85);
  G.cyl('e03_steel', x, deck + 4.0, z, 0.2, 0.02, 0.4, 8);
  // the ladder down the S side
  const lz = z + half + 0.62;
  for (const dx of [-0.25, 0.25]) rod(G, 'e03_steel', [x + dx, 0, lz], [x + dx, deck + 1.0, lz - 0.05], 0.025, 4);
  for (let y = 0.3; y < deck; y += 0.32) rod(G, 'e03_steel', [x - 0.25, y, lz], [x + 0.25, y, lz], 0.016, 4);
  rod(G, 'e03_black', [x, deck + 0.3, z + tankR], [x, 0.4, z + tankR + 0.2], 0.08, 6); // the down pipe
  return G.build('e03:water_tower', { damp: 0.4 });
}

// ------------------------------------------------------------------ landing stage, ferry punt and cable

/** The ferry landing: a plank stage on piles from the bank into the river, steps into the water at its W side. */
export function buildLandingStage(s) {
  const G = new Geo('e03:landing');
  const F = localFrame(s.x, s.z, s.rot ?? 0), hu = s.w / 2, hw = s.d / 2, Y = 0.42;
  fb(G, 'e03_timber', F, 0, 0, Y - 0.12, s.w, 0.12, s.d, 0.9);
  for (let k = 0; k < 9; k++) fb(G, 'e03_timber', F, -hu + 0.35 + k * ((s.w - 0.7) / 8), 0, Y - 0.32, 0.18, 0.2, s.d - 0.1, 0.75); // joists
  for (const u of [-hu + 0.2, 0, hu - 0.2]) for (const sw of [-1, 1]) G.cyl('e03_timber', ...W(F, u, sw * (hw - 0.15), -1.2), 0.11, 0.11, Y + 1.5, 8, 0.7);
  for (const sw of [-1, 1]) fb(G, 'e03_timber', F, 0, sw * (hw - 0.06), Y, s.w, 0.16, 0.12, 0.85); // kerb rail
  G.cyl('e03_black', ...W(F, hu - 0.4, -hw + 0.4, Y), 0.16, 0.13, 0.42, 10, 0.8);              // bollard
  for (let k = 0; k < 4; k++) fb(G, 'e03_timber', F, hu - 0.4 - k * 0.0, hw + 0.25 + k * 0.35, Y - 0.2 - k * 0.22, 1.2, 0.08, 0.35, 0.8); // steps down
  return G.build('e03:landing', { damp: 0.5, moss: 0.4 });
}

/** The rope ferry's punt (vehicle-local: +x bow along its heading): flat bottom, low sides, the rail, the haul block. */
export function buildFerryPunt({ L = 6.4, B = 2.8 } = {}) {
  const G = new Geo('e03:ferry');
  const F = localFrame(0, 0, 0), hl = L / 2, hb = B / 2;
  fb(G, 'e03_timber', F, 0, 0, -0.12, L - 0.6, 0.16, B - 0.2, 0.8);      // bottom
  for (const s of [-1, 1]) fb(G, 'e03_black', F, 0, s * (hb - 0.07), -0.12, L - 0.2, 0.62, 0.14, 0.85); // tarred sides
  for (const s of [-1, 1]) { // raked ends (ramps up to the banks)
    const a = W(F, s * hl, -hb, 0.5), b = W(F, s * hl, hb, 0.5), c = W(F, s * (hl - 0.6), hb, -0.12), d = W(F, s * (hl - 0.6), -hb, -0.12);
    if (s > 0) { G.quad('e03_timber', a, b, c, d); G.quad('e03_timber', d, c, b, a, 0.7); } else { G.quad('e03_timber', d, c, b, a); G.quad('e03_timber', a, b, c, d, 0.7); }
  }
  for (let k = 0; k < 7; k++) fb(G, 'e03_timber', F, -hl + 0.8 + k * ((L - 1.6) / 6), 0, 0.04, 0.14, 0.03, B - 0.3, 0.6); // deck battens
  for (const s of [-1, 1]) { // the hand rail on its stanchions
    for (let k = 0; k <= 4; k++) rod(G, 'e03_steel', W(F, -hl + 0.9 + k * ((L - 1.8) / 4), s * (hb - 0.1), 0.5), W(F, -hl + 0.9 + k * ((L - 1.8) / 4), s * (hb - 0.1), 1.25), 0.025, 4);
    rod(G, 'e03_steel', W(F, -hl + 0.9, s * (hb - 0.1), 1.25), W(F, hl - 0.9, s * (hb - 0.1), 1.25), 0.03, 4);
  }
  // the haul block on the W side: a post with two sheaves the cable runs through
  fb(G, 'e03_timber', F, 0, -hb + 0.25, 0.04, 0.3, 1.4, 0.3, 0.8);
  for (const u of [-0.45, 0.45]) G.cyl('e03_black', ...W(F, u, -hb - 0.02, 1.25), 0.12, 0.12, 0.12, 10, 0.8);
  const g = G.build('e03:ferry_punt', { damp: 0, moss: 0 });
  return g;
}

/** The ferry cable across the river: posts on both banks and the sagging wire at hand height. */
export function buildFerryCable(a, b, { x = a[0] } = {}) {
  const G = new Geo('e03:cable');
  for (const p of [a, b]) {
    G.cyl('e03_timber', p[0] - 1.3, 0, p[1], 0.16, 0.13, 2.3, 8, 0.75);
    G.cyl('e03_black', p[0] - 1.3, 1.9, p[1], 0.18, 0.18, 0.18, 10, 0.8);
  }
  rope(G, 'e03_steel', [x - 1.3, 1.95, a[1]], [x - 1.3, 1.95, b[1]], 0.5, 0.018, 16);
  return G.build('e03:ferry_cable', { damp: 0, moss: 0 });
}

// ------------------------------------------------------------------ small props

/**
 * Thin straw stalks standing out of a surface point: a tuft of `n` blades (both faces), each under 2 cm wide, light and
 * of mixed tones (the sun on their ends), splayed round `up` (a unit vector) by up to `spread` radians.
 */
function strawTuft(G, base, up, R, { n = 10, len = [0.12, 0.3], spread = 0.9, tone = [1.0, 1.3] } = {}) {
  const ref = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nz = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const e1 = nz(cr(up, ref)), e2 = cr(up, e1);
  for (let k = 0; k < n; k++) {
    const az = R() * TAU, el = R() * spread, s = Math.sin(el), c = Math.cos(el);
    const d = nz([up[0] * c + (e1[0] * Math.cos(az) + e2[0] * Math.sin(az)) * s, up[1] * c + (e1[1] * Math.cos(az) + e2[1] * Math.sin(az)) * s, up[2] * c + (e1[2] * Math.cos(az) + e2[2] * Math.sin(az)) * s]);
    const L = len[0] + R() * (len[1] - len[0]), wd = 0.004 + R() * 0.005, droop = 0.25 * L * R();
    const b0 = [base[0] + (R() - 0.5) * 0.05, base[1] - 0.02, base[2] + (R() - 0.5) * 0.05];
    const tip = [b0[0] + d[0] * L, b0[1] + d[1] * L - droop, b0[2] + d[2] * L];
    const sd = nz(cr(d, [0, 1, 0])), sx = Math.abs(sd[0]) + Math.abs(sd[2]) > 1e-3 ? sd : e1;
    const a = [b0[0] - sx[0] * wd, b0[1] - sx[1] * wd, b0[2] - sx[2] * wd], b = [b0[0] + sx[0] * wd, b0[1] + sx[1] * wd, b0[2] + sx[2] * wd];
    const t = tone[0] + R() * (tone[1] - tone[0]);
    G.tri('e03_straw', a, b, tip, t); G.tri('e03_straw', a, tip, b, t * 0.85);
  }
}

/** A quad wound to face away from `centre` (a point inside the solid it bounds). */
function outQuad(G, mat, a, b, c, d, centre, tone = 1) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const m = [(a[0] + c[0]) / 2 - centre[0], (a[1] + c[1]) / 2 - centre[1], (a[2] + c[2]) / 2 - centre[2]];
  if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) G.quad(mat, a, b, c, d, tone); else G.quad(mat, a, d, c, b, tone);
}
/** Piecewise-linear lookup in a [[x, y], …] table (x ascending), clamped at its ends. */
function table(T, x) {
  if (x <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (x <= T[i][0]) return lerp(T[i - 1][1], T[i][1], (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0]));
  return T[T.length - 1][1];
}
const sstepK = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * A hank of hay slid out over the rack's edge: a thick, flattened, lumpy clump of straw from `root` (inside the load)
 * out along `out` (a horizontal unit vector), bending down over the edge as it goes and ending ragged — blunt and
 * fraying into loose stalks, not tapering to a point. A closed solid (no doubled face). `len` m long, `wid` m wide.
 */
function hayHank(G, root, out, R, len, wid) {
  const side = [-out[2], 0, out[0]], S = 8, K = 5, rings = [];
  const twist = (R() - 0.5) * 0.5, curl = 0.8 + R() * 0.5, thick = 0.055 + R() * 0.035;
  const jit = Array.from({ length: (K + 1) * S }, () => 0.78 + R() * 0.42);   // (a lumpy section, not a tube)
  let tip = root;
  for (let k = 0; k <= K; k++) {
    const t = k / K, reach = 0.03 + len * 0.32 * Math.pow(t, 0.75), drop = len * curl * Math.pow(t, 1.5) * 0.95;
    const c = [root[0] + out[0] * reach + side[0] * twist * t * len * 0.35, root[1] - drop, root[2] + out[2] * reach + side[2] * twist * t * len * 0.35];
    // its section: wide across (side), thick along the hank's own normal (up, tipping out as it bends down)
    const hw = wid * 0.5 * (1 - 0.35 * t), ht = thick * (1 - 0.45 * t), dn = Math.min(0.7, 1.2 * curl * t);
    const nrm = [out[0] * dn, 1 - dn * 0.55, out[2] * dn], nl = Math.hypot(...nrm);
    rings.push(Array.from({ length: S }, (_, i) => {
      const a = (i / S) * TAU, j = jit[k * S + i], cs = Math.cos(a) * hw * j, sn = Math.sin(a) * ht * j;
      return [c[0] + side[0] * cs + nrm[0] / nl * sn, c[1] + nrm[1] / nl * sn, c[2] + side[2] * cs + nrm[2] / nl * sn];
    }));
    tip = c;
  }
  const mids = rings.map((r) => r.reduce((m, p) => [m[0] + p[0] / S, m[1] + p[1] / S, m[2] + p[2] / S], [0, 0, 0]));
  for (let k = 0; k < K; k++) {
    const mid = [(mids[k][0] + mids[k + 1][0]) / 2, (mids[k][1] + mids[k + 1][1]) / 2, (mids[k][2] + mids[k + 1][2]) / 2];
    for (let i = 0; i < S; i++) { const j = (i + 1) % S; outQuad(G, 'e03_straw', rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i], mid, 0.8 + R() * 0.26); }
  }
  // its blunt end closed (a fan, faced away from the hank's last stretch), then frayed into loose stalks
  const E = rings[K], back = mids[K - 1];
  for (let i = 0; i < S; i++) {
    const a = E[i], b = E[(i + 1) % S], n = [(a[1] - tip[1]) * (b[2] - tip[2]) - (a[2] - tip[2]) * (b[1] - tip[1]), (a[2] - tip[2]) * (b[0] - tip[0]) - (a[0] - tip[0]) * (b[2] - tip[2]), (a[0] - tip[0]) * (b[1] - tip[1]) - (a[1] - tip[1]) * (b[0] - tip[0])];
    const o = [tip[0] - back[0], tip[1] - back[1], tip[2] - back[2]];
    if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] >= 0) G.tri('e03_straw', tip, a, b, 0.86); else G.tri('e03_straw', tip, b, a, 0.86);
  }
  const dl = Math.hypot(out[0] * 0.45, 1.3, out[2] * 0.45);
  for (let m = 0; m < 3; m++) {
    const off = (m - 1) * wid * 0.3, p = [tip[0] + side[0] * off, tip[1] - 0.01, tip[2] + side[2] * off];
    strawTuft(G, p, [out[0] * 0.45 / dl, -1.3 / dl, out[2] * 0.45 / dl], R, { n: 6, len: [0.08, 0.2], spread: 0.6, tone: [0.9, 1.2] });
  }
}

/**
 * A ladder-sided hay wagon's load (frame F, the cart's half-length hu and half-width hw; `ups` the side ladders' upright
 * positions along it): built up the way a hay wagon is loaded — inside the side and end ladders at the bed, pressing
 * out between their uprights and squeezed in under their rails, then spilling out over the top rails and over the end
 * ladders (wider than the rack) before it rounds over in lumps and hollows to a wandering crown. Its corners rounded
 * and broken, hanks hanging over the rails and the ends, thin stalks everywhere, a fork left in it, a little hay
 * dropped round the cart. Clear of the wheels; inside the cart's footprint along its length. `ups` {-1: [u], 1: [u]}
 * the side ladders' uprights along each side.
 */
function hayLoad(G, F, hu, hw, ups, R) {
  const y0 = 0.74, ladW = (y) => hw - 0.14 + (y - 0.74) * 0.24;                          // the side ladders' plane
  const endU = (y) => hu - 0.4 + 0.12 * Math.min(1, Math.max(0, (y - 0.74) / 0.71));      // the end ladders' plane
  const endW = (y) => [-0.55, 0, 0.55].map((w) => w * (1 + 0.15 * Math.min(1, Math.max(0, (y - 0.74) / 0.71))));
  // the free outline (half-width b across, half-length a along) by height: in the rack, then out over it, then the crown
  const B = [[1.62, ladW(1.62) + 0.07], [1.72, 1.18], [1.84, 1.21], [1.96, 1.19], [2.07, 1.12], [2.17, 1.0], [2.25, 0.84], [2.31, 0.65], [2.36, 0.45], [2.4, 0.24], [2.415, 0.13]];
  const A = [[1.45, endU(1.45) + 0.06], [1.58, 1.84], [1.73, 1.89], [1.84, 1.9], [1.96, 1.88], [2.07, 1.8], [2.17, 1.68], [2.25, 1.5], [2.31, 1.27], [2.36, 0.96], [2.4, 0.6], [2.415, 0.4]];
  const bFree = (y) => (y <= 1.62 ? ladW(y) + 0.07 * sstepK(0.84, 1.3, y) : table(B, y));
  const aFree = (y) => (y <= 1.45 ? endU(y) + 0.06 * sstepK(0.84, 1.25, y) : table(A, y));
  // (rings close together over the crown: the forkfuls' creases need them)
  const Y = [0.725, 0.84, 0.95, 1.05, 1.11, 1.16, 1.21, 1.29, 1.38, 1.46, 1.53, 1.57, 1.61, 1.66, 1.74, 1.84, 1.92, 2.0, 2.07, 2.13, 2.19, 2.24, 2.28, 2.32, 2.355, 2.38, 2.4, 2.415];
  const N = 104;
  // the load's own unevenness: a few slow waves round it and up it (forkfuls pressed against the rails)
  const waves = Array.from({ length: 6 }, () => [1 + Math.floor(R() * 5), 2 + R() * 6, R() * TAU, 0.012 + R() * 0.02]);
  const wave = (ph, y) => waves.reduce((s, [f, g, p, a]) => s + a * Math.sin(f * ph + g * y + p), 0);
  // the shoulders and corners broken: a few bites out of them and a few forkfuls bulging out (by angle round the load
  // and height)
  const dents = Array.from({ length: 7 }, (_, k) => [(k < 4 ? (k + 0.5) * (TAU / 4) : R() * TAU) + (R() - 0.5) * 0.4, 1.75 + R() * 0.45, k % 2 ? 0.04 + R() * 0.03 : -(0.05 + R() * 0.05), 0.1 + R() * 0.12]);
  const dentAt = (ph, y) => dents.reduce((s, [p0, y0, a, w]) => s + a * Math.exp(-((Math.atan2(Math.sin(ph - p0), Math.cos(ph - p0)) / w) ** 2) - ((y - y0) / 0.16) ** 2), 0);
  // the load pitched up a forkful at a time: rounded clumps over the crown and down the shoulders, creased where two
  // meet (the union of their domes, not a sum: a sum is a smooth swell), hollows where none lies
  const outline = (y, ph) => {
    const n = lerp(5.2, 2.5, sstepK(1.5, 2.4, y)), c = Math.cos(ph), s = Math.sin(ph);
    return [aFree(y) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), bFree(y) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)];
  };
  const forks = [];
  for (let k = 0; k < 34; k++) {
    const y = k < 10 ? 2.25 + R() * 0.17 : 1.74 + R() * 0.56, [u, w] = k < 10 ? [(R() - 0.5) * 2.4, (R() - 0.5) * 0.9] : outline(y, R() * TAU);
    forks.push([u, w, y, 0.3 + R() * 0.24, 0.045 + R() * 0.06]);
  }
  const forkAt = (u, w, y) => {
    let m = 0;
    for (const [fu, fw, fy, r, h] of forks) {
      const d2 = ((u - fu) ** 2 + (w - fw) ** 2 + ((y - fy) * 1.5) ** 2) / (r * r);
      if (d2 < 1) m = Math.max(m, h * Math.pow(1 - d2, 0.55));
    }
    return m;
  };
  const rings = [], side = [], shoulder = [];
  for (const [k, y] of Y.entries()) {
    const n = lerp(5.2, 2.5, sstepK(1.5, 2.4, y)), aF = aFree(y), bF = bFree(y), ring = [];
    for (let j = 0; j < N; j++) {
      const ph = (j / N) * TAU, c = Math.cos(ph), s = Math.sin(ph);
      const eu = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), ew = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      // (a forkful swells the surface out along its normal: out over the shoulders, up over the crown)
      const fk = y > 1.62 ? forkAt(aF * eu, bF * ew, y) : 0, up = sstepK(2.0, 2.32, y);
      const g = k === 0 ? 1 : 1 + wave(ph, y) + (y > 1.62 ? dentAt(ph, y) : 0) + (R() - 0.5) * 0.018 + fk * (1 - up) / (Math.hypot(aF * eu, bF * ew) || 1);
      let u = aF * eu * g, w = bF * ew * g;
      // squeezed in at the side ladders' uprights and under their rails (never pushed out by it)
      if (y <= 1.66 && Math.abs(ew) > 0.5) {
        const pU = (ups[w < 0 ? -1 : 1] || []).reduce((m, uk) => Math.max(m, Math.exp(-(((u - uk) / 0.085) ** 2))), 0) * sstepK(0.73, 0.8, y);
        const pR = Math.max(Math.exp(-(((y - 1.16) / 0.05) ** 2)), Math.exp(-(((y - 1.6) / 0.05) ** 2)));
        const p = Math.max(pU, pR) * sstepK(0.5, 0.85, Math.abs(ew)), bIn = ladW(Math.min(y, 1.62)) - 0.045;
        if (Math.abs(w) > bIn) w = Math.sign(w) * lerp(Math.abs(w), bIn, p);
      }
      // and at the end ladders' uprights and their cross rail
      if (y <= 1.48 && Math.abs(eu) > 0.5) {
        const pW = endW(y).reduce((m, wk) => Math.max(m, Math.exp(-(((w - wk) / 0.085) ** 2))), 0) * sstepK(0.73, 0.8, y);
        const pR = Math.exp(-(((y - 1.38) / 0.05) ** 2));
        const p = Math.max(pW, pR) * sstepK(0.5, 0.85, Math.abs(eu)), aIn = endU(Math.min(y, 1.45)) - 0.045;
        if (Math.abs(u) > aIn) u = Math.sign(u) * lerp(Math.abs(u), aIn, p);
      }
      if (y < 1.06 && Math.abs(w) > 0.94) w = Math.sign(w) * 0.94;   // (clear of the wheels' inner faces)
      // (a hand past the cart's width at most, inside its length: men pass beside it, the shafts lie at its front)
      if (Math.abs(w) > hw + 0.22) w = Math.sign(w) * (hw + 0.22 - 0.02 * R());
      if (Math.abs(u) > hu - 0.03) u = Math.sign(u) * (hu - 0.03 - 0.02 * R());
      const yy = y + (k === 0 ? 0 : (R() - 0.5) * 0.024) + fk * (0.25 + 0.75 * up);
      ring.push([u, w, yy, fk]);
      // (stalks poke out between the uprights: not where a wheel turns just outside — its rim top is at 1.0 m)
      if (y >= 0.95 && y <= 1.5 && Math.abs(ew) > 0.8 && (y >= 1.1 || Math.abs(Math.abs(u) - 1.0) > 0.6)) side.push([u, w, yy, Math.sign(w)]);
      if (y >= 1.7 && y <= 1.96) shoulder.push([u, w, yy, ph]);
    }
    rings.push(ring);
  }
  // the crown: an off-centre top, just proud of the last ring
  const last = rings[rings.length - 1], cu0 = (R() - 0.5) * 0.3, cw0 = (R() - 0.5) * 0.1;
  const apex = [cu0, cw0, last.reduce((m, q) => m + q[2], 0) / last.length + 0.015 + forkAt(cu0, cw0, 2.42) * 0.5 + R() * 0.02];
  const P = rings.map((r) => r.map(([u, w, y]) => W(F, u, w, y))), top = W(F, ...apex.slice(0, 2), apex[2]);
  const centre = W(F, 0, 0, 1.55);
  for (let k = 0; k + 1 < P.length; k++) for (let j = 0; j < N; j++) {
    const j1 = (j + 1) % N;
    // (the forkfuls' tops catch the light, their creases darker)
    const fkm = (rings[k][j][3] + rings[k][j1][3] + rings[k + 1][j][3] + rings[k + 1][j1][3]) / 4;
    outQuad(G, 'e03_straw', P[k][j], P[k][j1], P[k + 1][j1], P[k + 1][j], centre, (k < 3 ? 0.66 : k < 12 ? 0.74 : 0.82) + R() * 0.2 + (fkm - 0.035) * 2.4);
  }
  const L = P[P.length - 1];
  for (let j = 0; j < N; j++) {
    const a = L[j], b = L[(j + 1) % N];
    const n = (b[2] - a[2]) * (top[0] - a[0]) - (b[0] - a[0]) * (top[2] - a[2]);   // (faces up)
    if (n >= 0) G.tri('e03_straw', a, b, top, 0.86 + R() * 0.18); else G.tri('e03_straw', a, top, b, 0.86 + R() * 0.18);
  }
  // hanks hanging over: at the four corners, the two ends and over the top rails
  const outAt = (u, w) => { const l = Math.hypot(u / 1.9, w / 1.2) || 1, ou = u / 1.9 / l, ow = w / 1.2 / l; return [F.t[0] * ou + F.n[0] * ow, 0, F.t[1] * ou + F.n[1] * ow]; };
  const hankAt = (ph0, spread, len, wid) => {
    const near = shoulder.filter((q) => Math.abs(Math.atan2(Math.sin(q[3] - ph0), Math.cos(q[3] - ph0))) < spread);
    if (!near.length) return;
    const [u, w, y] = near[Math.floor(R() * near.length)], o = outAt(u, w), ol = Math.hypot(o[0], o[2]) || 1;
    // (its reach kept within a hand of the cart's box: its centre line ends inside 0.24 m past the sides and 0.02 m past
    //  the ends — its body then within 0.36 m and 0.15 m of them: tests/unit/e03-kit.test.mjs)
    const lu = Math.abs(u / 1.9) / (Math.hypot(u / 1.9, w / 1.2) || 1), lw = Math.abs(w / 1.2) / (Math.hypot(u / 1.9, w / 1.2) || 1);
    const room = Math.min(lw > 0.05 ? (hw + 0.24 - Math.abs(w)) / lw : 9, lu > 0.05 ? (hu + 0.02 - Math.abs(u)) / lu : 9);
    const L = Math.min(len, (room - 0.03) / 0.32);
    if (L < 0.1) return;
    const sink = 0.06, [x, z] = F.at(u, w);
    hayHank(G, [x - o[0] / ol * sink, y - 0.02, z - o[2] / ol * sink], [o[0] / ol, 0, o[2] / ol], R, L, wid);
  };
  for (const ph of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) hankAt(ph + (R() - 0.5) * 0.3, 0.12, 0.26 + R() * 0.16, 0.32 + R() * 0.14);
  for (const ph of [0, Math.PI]) for (let m = 0; m < 2; m++) hankAt(ph + (R() - 0.5) * 0.5, 0.1, 0.22 + R() * 0.16, 0.28 + R() * 0.14);
  for (const ph of [Math.PI / 2, (3 * Math.PI) / 2]) for (let m = 0; m < 2; m++) hankAt(ph + (R() - 0.5) * 0.9, 0.06, 0.17 + R() * 0.1, 0.26 + R() * 0.12);
  // tufts standing proud of the crown (they break its outline) and thin stalks all over the shoulders
  const crown = rings.slice(15).flat();
  for (let k = 0; k < 12; k++) {
    const [u, w, y] = crown[Math.floor(R() * crown.length)], o = outAt(u, w);
    const d = [o[0] * 0.5, 1, o[2] * 0.5], l = Math.hypot(...d);
    strawTuft(G, W(F, u, w, y), [d[0] / l, d[1] / l, d[2] / l], R, { n: 16 + Math.floor(R() * 8), len: [0.2, 0.42], spread: 0.75, tone: [0.85, 1.15] });
  }
  for (let k = 0; k < 40; k++) {
    const [u, w, y] = (k % 3 ? crown : shoulder)[Math.floor(R() * (k % 3 ? crown.length : shoulder.length))], o = outAt(u, w);
    const d = [o[0] * 0.45, 0.9, o[2] * 0.45], l = Math.hypot(...d);
    strawTuft(G, W(F, u, w, y), [d[0] / l, d[1] / l, d[2] / l], R, { n: 8 + Math.floor(R() * 6), len: [0.1, 0.24], spread: 0.6 });
  }
  // stalks poking out between the side ladders' uprights
  for (let k = 0; k < 26 && side.length; k++) {
    const [u, w, y, sd] = side[Math.floor(R() * side.length)];
    strawTuft(G, W(F, u, w - sd * 0.01, y), [F.n[0] * sd, 0.3, F.n[1] * sd], R, { n: 6, len: [0.08, 0.2], spread: 0.7, tone: [0.95, 1.2] });
  }
  // a hay fork left stuck in the load, its shaft leaning out over the side
  const fu = 0.55, fw = -0.2, fy = 2.0;
  rod(G, 'e03_timber', W(F, fu, fw, fy), W(F, fu + 0.55, fw - 0.9, fy + 1.05), 0.025, 5, 0.8);
  for (const dt of [-0.07, 0, 0.07]) rod(G, 'e03_steel', W(F, fu + dt, fw, fy), W(F, fu + dt - 0.1, fw + 0.12, fy - 0.3), 0.008, 3, 0.7);
  // hay dropped round the cart: small loose heaps of stalks on the grass
  for (let k = 0; k < 5; k++) {
    const su = (R() < 0.5 ? -1 : 1) * (hu + 0.2 + R() * 0.6), sw = (R() - 0.5) * 2 * (hw + 0.4);
    for (let m = 0; m < 2; m++) {
      const [x, z] = F.at(su + (R() - 0.5) * 0.5, sw + (R() - 0.5) * 0.5);
      strawTuft(G, [x, 0.02, z], [0, 1, 0], R, { n: 14, len: [0.12, 0.26], spread: 1.35, tone: [0.9, 1.2] });
    }
  }
}

/**
 * A hexahedron in a local frame: corners [u, w, y], the bottom ring then the top ring in segBox's order
 * ((u0, w0), (u0, w1), (u1, w1), (u1, w0)), wound for the frame's handedness as segBox winds them.
 */
function frameHexa(G, mat, F, c, tone = 1) {
  const P = c.map(([u, w, y]) => W(F, u, w, y));
  if (F.t[0] * F.n[1] - F.t[1] * F.n[0] > 0) G.hexa(mat, P, tone);
  else G.hexa(mat, [P[3], P[2], P[1], P[0], P[7], P[6], P[5], P[4]], tone);
}

/**
 * A level sheet of still water in a frame (half-extents uw × ww at height yw) for the still-water shader: 3 × 3
 * patches, the outer ring `inset` m wide, its `uv.x` 0 along the edge and 1 from `inset` inside it (the shader dims the
 * sky along the boards standing over the water; Geo.build divides the uv by the set's metres per tile). Faces up.
 */
function waterSheet(G, F, uw, ww, yw, inset = 0.14) {
  const T = CASTLE_SETS.e03_water[3];
  const us = [-uw, -uw + inset, uw - inset, uw], ws = [-ww, -ww + inset, ww - inset, ww];
  const ramp = (i, j) => (i === 0 || i === 3 || j === 0 || j === 3 ? 0 : T);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let c = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
    const P = (q) => W(F, us[q[0]], ws[q[1]], yw);
    const [a, b, d] = [P(c[0]), P(c[1]), P(c[2])];
    if ((b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]) < 0) c = [c[0], c[3], c[2], c[1]];   // (face up)
    G.quadUV('e03_water', ...c.map(P), c.map((q) => [ramp(...q), 0]));
  }
}

/**
 * A stable's water trough (its gameplay box s: w long, d wide, h to the rim): an OPEN box of heavy boards — a floor on
 * two skids, long sides splayed a little outward, end boards standing proud of the rim — two iron straps round it,
 * and the water standing 0.1 m below the rim, its surface run a few millimetres into the boards (no seam, no face
 * against a face). The boards meet by overlapping (none ends flush on another's face).
 */
function waterTrough(G, F, s, R) {
  const hu = s.w / 2, hw = s.d / 2, rim = s.h, t = 0.06, y0 = 0.1;
  const ue = hu - t;                                   // the end boards' inner faces
  // the long sides' inner / outer faces at the foot and at the rim (splayed: 3.5 cm wider at the rim)
  const wi0 = hw - t - 0.055, wo0 = hw - 0.055, wi1 = hw - t - 0.02, wo1 = hw - 0.02;
  const wIn = (y) => lerp(wi0, wi1, (y - y0) / (rim - y0)), wOut = (y) => lerp(wo0, wo1, (y - y0) / (rim - y0));
  // skids under the ends, a little wider than the trough, rough-sawn
  for (const su of [-1, 1]) {
    const u = su * (hu - 0.42) + (R() - 0.5) * 0.04;
    fb(G, 'e03_timber', F, u, (R() - 0.5) * 0.02, 0, 0.15, 0.12, s.d + 0.1, 0.62 + R() * 0.08);
  }
  // the floor (into the sides and the ends)
  fb(G, 'e03_board', F, 0, 0, y0, 2 * (ue + 0.03), 0.075, 2 * (wi0 + 0.03), 0.6);
  // the long sides: one heavy board each (the siding's own plank lines), the rim a little uneven, run into the ends
  for (const sw of [-1, 1]) {
    const dy = [(R() - 0.5) * 0.025, (R() - 0.5) * 0.025], uE = ue + 0.035;
    const c = [[-uE, sw * wIn(y0), y0], [-uE, sw * wOut(y0), y0], [uE, sw * wOut(y0), y0], [uE, sw * wIn(y0), y0],
      [-uE, sw * wIn(rim + dy[0]), rim + dy[0]], [-uE, sw * wOut(rim + dy[0]), rim + dy[0]], [uE, sw * wOut(rim + dy[1]), rim + dy[1]], [uE, sw * wIn(rim + dy[1]), rim + dy[1]]];
    frameHexa(G, 'e03_board', F, sw > 0 ? c : [c[1], c[0], c[3], c[2], c[5], c[4], c[7], c[6]], 0.66 + R() * 0.1);
  }
  // the end boards, standing 4 cm proud of the rim and a little wider than the sides
  for (const su of [-1, 1]) fb(G, 'e03_board', F, su * (ue + t / 2), (R() - 0.5) * 0.01, y0 - 0.02, t, rim - y0 + 0.06, 2 * wo1 + 0.05, 0.58 + R() * 0.1);
  // two iron straps round the body (their inner faces inside the boards, the outer 7 mm proud)
  for (const su of [-1, 1]) {
    const u = su * (hu * 0.46) + (R() - 0.5) * 0.06, bw = 0.05;
    for (const sw of [-1, 1]) {
      const yA = y0 + 0.02, yB = rim - 0.035, o = (y) => wOut(y) + 0.007, i = (y) => wOut(y) - 0.006;
      const c = [[u - bw / 2, sw * i(yA), yA], [u - bw / 2, sw * o(yA), yA], [u + bw / 2, sw * o(yA), yA], [u + bw / 2, sw * i(yA), yA],
        [u - bw / 2, sw * i(yB), yB], [u - bw / 2, sw * o(yB), yB], [u + bw / 2, sw * o(yB), yB], [u + bw / 2, sw * i(yB), yB]];
      frameHexa(G, 'e03_black', F, sw > 0 ? c : [c[1], c[0], c[3], c[2], c[5], c[4], c[7], c[6]], 0.7);
    }
  }
  // the water: 0.1 m below the rim, a flat sheet run 4 mm into the boards all round (its edge hidden in them)
  const yw = rim - 0.1, uw = ue + 0.004, ww = wIn(yw) + 0.004;
  waterSheet(G, F, uw, ww, yw);
  // a little straw floating at one end, lifted clear of the water
  for (let k = 0; k < 2; k++) {
    const [x, z] = F.at((R() < 0.5 ? -1 : 1) * (ue - 0.18 - R() * 0.3), (R() - 0.5) * wi1);
    strawTuft(G, [x, yw + 0.032, z], [0, 1, 0], R, { n: 5, len: [0.1, 0.2], spread: 1.5, tone: [0.75, 0.95] });
  }
}

/** A small prop by its gameplay box (`variant`). Returns false when the variant is not one of e03's. */
export function addSmallProp(G, s, R) {
  const F = localFrame(s.x, s.z, s.rot ?? 0), hu = s.w / 2, hw = s.d / 2;
  switch (s.variant) {
    case 'hay_cart': {
      // a ladder-sided hay wagon: four spoked wheels clear of its load, the bed on them, the side ladders leaning
      // out (uprights, a middle and a top rail), a ladder at each end; the hay heaped inside the rack, its shafts down
      for (const u of [-1.0, 1.0]) for (const sw of [-1, 1]) wheel(G, F, u, sw * (hw + 0.02), 0.5, { mat: 'e03_timber', spokes: 10 });
      fb(G, 'e03_timber', F, 0, 0, 0.62, s.w - 0.6, 0.12, s.d - 0.3, 0.85);
      const RK = mulberry(seedOf(`e03:hayrack:${s.id ?? s.x}`)), ladW = (y) => hw - 0.14 + (y - 0.74) * 0.24;   // (the ladders lean out)
      const ups = { '-1': [], 1: [] };   // (each side's uprights, for the load to squeeze in at)
      for (const sw of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const u = -hu + 0.42 + k * ((s.w - 0.84) / 6) + (RK() - 0.5) * 0.06;
          ups[sw].push(u);
          rod(G, 'e03_timber', W(F, u, sw * ladW(0.74), 0.74), W(F, u + (RK() - 0.5) * 0.04, sw * ladW(1.62), 1.62), 0.028, 4, 0.75 + RK() * 0.2);
        }
        for (const [y, r] of [[1.16, 0.026], [1.6, 0.034]]) rod(G, 'e03_timber', W(F, -hu + 0.36, sw * ladW(y), y), W(F, hu - 0.36, sw * ladW(y), y + (RK() - 0.5) * 0.04), r, 5, 0.8);
      }
      for (const su of [-1, 1]) { // the end ladders
        const u = su * (hu - 0.4);
        for (const sw of [-0.55, 0, 0.55]) rod(G, 'e03_timber', W(F, u, sw, 0.74), W(F, u + su * 0.12, sw * 1.15, 1.45), 0.024, 4, 0.75);
        rod(G, 'e03_timber', W(F, u + su * 0.1, -0.72, 1.38), W(F, u + su * 0.1, 0.72, 1.38), 0.026, 4, 0.8);
      }
      hayLoad(G, F, hu, hw, ups, mulberry(seedOf(`e03:hay:${s.id ?? s.x}`)));
      rod(G, 'e03_timber', W(F, -hu + 0.3, -0.35, 0.66), W(F, -hu - 0.9, -0.2, 0.25), 0.05, 5);
      rod(G, 'e03_timber', W(F, -hu + 0.3, 0.35, 0.66), W(F, -hu - 0.9, 0.2, 0.25), 0.05, 5);
      return true;
    }
    case 'straw_litter': { // a handful of loose straw on the ground (a tent's floor): two or three thin tufts lying flat
      const y = s.y ?? 0;
      for (let k = 0; k < 3; k++) {
        const [x, z] = F.at((R() - 0.5) * hu * 2, (R() - 0.5) * hw * 2);
        strawTuft(G, [x, y + 0.015, z], [0, 1, 0], R, { n: 10, len: [0.12, 0.3], spread: 1.45, tone: [0.7, 1.0] });
      }
      return true;
    }
    case 'water_trough':
      waterTrough(G, F, s, mulberry(seedOf(`e03:trough:${s.id ?? s.x}`)));
      return true;
    case 'hay_bales':
      for (let k = 0; k < 3; k++) G.box('e03_straw', ...W(F, -hu + 0.45 + k * 0.85, 0, 0.3), 0.8, 0.6, s.d - 0.1, (s.rot ?? 0) + (R() - 0.5) * 0.1, 0.95);
      for (let k = 0; k < 2; k++) G.box('e03_straw', ...W(F, -hu + 0.85 + k * 0.85, 0.05, 0.9), 0.8, 0.6, s.d - 0.2, (s.rot ?? 0) + (R() - 0.5) * 0.15, 0.9);
      return true;
    case 'practice_trapeze':
      // an A-frame each end, its two legs stopping apart under a cap block (run into one apex, their faces lay almost
      // in one plane near it and fought)
      for (const su of [-1, 1]) {
        rod(G, 'e03_timber', W(F, su * hu, -0.2, 0), W(F, su * (hu - 0.15), -0.09, s.h - 0.12), 0.07, 6);
        rod(G, 'e03_timber', W(F, su * hu, 0.2, 0), W(F, su * (hu - 0.15), 0.09, s.h - 0.12), 0.07, 6);
        fb(G, 'e03_timber', F, su * (hu - 0.15), 0, s.h - 0.24, 0.22, 0.3, 0.38, 0.75);
      }
      rod(G, 'e03_steel', W(F, -hu + 0.1, 0, s.h - 0.05), W(F, hu - 0.1, 0, s.h - 0.05), 0.05, 6);
      for (const du of [-0.5, 0.5]) rod(G, 'e03_rope', W(F, du, 0, s.h - 0.05), W(F, du, 0.15, 1.8), 0.015, 4);
      rod(G, 'e03_mustard', W(F, -0.55, 0.15, 1.8), W(F, 0.55, 0.15, 1.8), 0.03, 6);
      return true;
    case 'bicycle':
      for (const du of [-0.55, 0.55]) wheel(G, F, du, 0, 0.34, { mat: 'e03_steel', spokes: 16, t: 0.02 });
      rod(G, 'e03_black', W(F, -0.55, 0, 0.34), W(F, 0, 0, 0.78), 0.022, 4);
      rod(G, 'e03_black', W(F, 0.55, 0, 0.34), W(F, 0.35, 0, 0.88), 0.022, 4);
      rod(G, 'e03_black', W(F, 0, 0, 0.78), W(F, 0.35, 0, 0.88), 0.022, 4);
      rod(G, 'e03_black', W(F, 0.35, -0.25, 0.98), W(F, 0.35, 0.25, 0.98), 0.018, 4);
      fb(G, 'e03_black', F, -0.05, 0, 0.82, 0.22, 0.05, 0.1, 1);
      return true;
    case 'hen_coop': {
      fb(G, 'e03_board', F, 0, 0, 0.3, s.w, s.h - 0.6, s.d, 0.8);
      for (const su of [-1, 1]) for (const sw of [-1, 1]) fb(G, 'e03_timber', F, su * (hu - 0.08), sw * (hw - 0.08), 0, 0.1, 0.35, 0.1, 0.7);
      const a = W(F, -hu - 0.1, -hw - 0.1, s.h - 0.3), b = W(F, hu + 0.1, -hw - 0.1, s.h - 0.3), c = W(F, hu + 0.1, hw + 0.1, s.h - 0.55), d = W(F, -hu - 0.1, hw + 0.1, s.h - 0.55);
      G.quad('e03_zinc', a, b, c, d); G.quad('e03_zinc', d, c, b, a, 0.6);
      rod(G, 'e03_timber', W(F, 0.4, hw, 0.3), W(F, 0.4, hw + 0.9, 0), 0.06, 4); // hen ladder
      return true;
    }
    case 'dog_kennel': { // a tarred plank kennel with a pitched felt roof and a round-topped door hole on its long side
      fb(G, 'e03_board', F, 0, 0, 0.08, s.w - 0.1, s.h - 0.55, s.d - 0.1, 0.65);
      for (const su of [-1, 1]) for (const sw of [-1, 1]) fb(G, 'e03_timber', F, su * (hu - 0.1), sw * (hw - 0.1), 0, 0.12, 0.12, 0.12, 0.6);
      const y0 = s.h - 0.47, yr = s.h, o = 0.12;
      const a = W(F, -hu - o, -hw - o, y0), b = W(F, hu + o, -hw - o, y0), c = W(F, hu + o, 0, yr), d = W(F, -hu - o, 0, yr);
      const e = W(F, hu + o, hw + o, y0), f = W(F, -hu - o, hw + o, y0);
      G.quad('e03_black', d, c, b, a); G.quad('e03_black', f, e, c, d); // both pitches (felt)
      for (const su of [-1, 1]) G.tri('e03_board', W(F, su * (hu - 0.05), -hw + 0.05, y0), W(F, su * (hu - 0.05), hw - 0.05, y0), W(F, su * (hu - 0.05), 0, yr - 0.05));
      fb(G, 'e03_black', F, 0, hw - 0.04, 0.12, 0.42, 0.55, 0.04, 1); // the door hole
      fb(G, 'e03_steel', F, hu - 0.25, hw + 0.15, 0, 0.26, 0.08, 0.26, 0.9); // the water bowl
      return true;
    }
    case 'radio_spares':
      for (let k = 0; k < 3; k++) fb(G, k % 2 ? 'e03_black' : 'e03_green', F, -hu + 0.45 + k * 0.85, 0, 0, 0.8, 0.55 + (k % 2) * 0.2, s.d - 0.2, 0.85);
      G.cyl('e03_black', ...W(F, 0.4, 0, 0.75), 0.35, 0.35, 0.12, 12, 0.8);
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ straw (a canvas texture, browser only)

let STRAW_MAT = null;
/**
 * Loose straw and hay: thousands of thin stalks in light golden tones over a darker tangle, drawn once on a tiling
 * canvas (the library's reed thatch is a dark weathered roof: a cart's load in it read as a brown tarpaulin). The
 * vertex tones of the kit still shade it (the crown lighter, the underside darker). null in node.
 */
export function strawMaterial() {
  if (STRAW_MAT !== null) return STRAW_MAT;
  if (typeof document === 'undefined') return (STRAW_MAT = false);
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = rng(seedOf('e03:straw'));
  g.fillStyle = '#6f5527'; g.fillRect(0, 0, S, S);
  const stalk = (x, y, len, ang, wd, col, a) => {
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = wd; g.lineCap = 'round';
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { // (tiling: a stalk across an edge comes in on the other side)
      if (x + ox + Math.max(0, dx) < -2 || x + ox + Math.min(0, dx) > S + 2 || y + oy + Math.max(0, dy) < -2 || y + oy + Math.min(0, dy) > S + 2) continue;
      g.beginPath(); g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + dx * 0.5 + (r() - 0.5) * 6, y + oy + dy * 0.5 + (r() - 0.5) * 6, x + ox + dx, y + oy + dy); g.stroke();
    }
  };
  // (stored hay in spring: golden under a weathered grey-brown skin, dark hollows between the hanks, pale stalk ends)
  const DARK = ['#3f301a', '#4c3a1e', '#352a17', '#55452a'], MID = ['#8c6d30', '#9a7934', '#7f6430', '#8f7d55', '#a3833c'];
  const LIGHT = ['#bf9b4e', '#c9a85a', '#d2b466', '#b39250', '#cdb98a'];
  for (let k = 0; k < 1600; k++) stalk(r() * S, r() * S, 18 + r() * 60, r() * Math.PI * 2, 2 + r() * 3, DARK[Math.floor(r() * DARK.length)], 0.6);
  for (let k = 0; k < 2600; k++) stalk(r() * S, r() * S, 24 + r() * 90, -0.6 + r() * 1.2 + (r() < 0.25 ? Math.PI / 2 : 0), 1.4 + r() * 2, MID[Math.floor(r() * MID.length)], 0.8);
  for (let k = 0; k < 1500; k++) stalk(r() * S, r() * S, 30 + r() * 110, -0.5 + r() * 1.0 + (r() < 0.3 ? r() * Math.PI : 0), 1 + r() * 1.6, LIGHT[Math.floor(r() * LIGHT.length)], 0.85);
  for (let k = 0; k < 350; k++) stalk(r() * S, r() * S, 10 + r() * 30, r() * Math.PI * 2, 0.8 + r(), '#e2cc8e', 0.45); // sun on the stalk ends
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  STRAW_MAT = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, metalness: 0, vertexColors: true, name: 'e03:straw' });
  return STRAW_MAT;
}
/** The kit's straw meshes (castle:e03_straw) drawn with the straw material instead. */
export function strawify(root) {
  const m = strawMaterial();
  if (!m) return;
  root.traverse((o) => { if (o.isMesh && o.material?.name === 'castle:e03_straw') o.material = m; });
}

// ------------------------------------------------------------------ standing water (still water: the trough, the puddles)

/**
 * The still-water shader (a MeshStandardMaterial patched at compile time, so the sun, its shadows, the fog and the
 * scene's environment all reach it). The game camera is orthographic: a flat mirror under it shows ONE direction of the
 * sky everywhere, which is why the round-3 puddles and the trough read as a flat grey-blue tint. Here the water shows
 * the sky as it would: wind ripples (a world-anchored height field, a few degrees of slope) tilt the mirror so the sky's
 * gradient moves across it, a cloud deck 80 m up is seen in it (the reflected ray's point on the deck: world-anchored,
 * so the clouds stay put on the water as the camera pans) and the Fresnel term — boosted from the physical 3 % at the
 * camera's 40° (art direction: the water must read as water at a glance) — mixes that sky over the water's own body:
 * dark and silty where it is deep, the mud bed showing through in the shallows.
 *  - puddle (`aSw` = radius fraction r: 0 middle, 1 the nominal edge, 1 → 2 the rim band; per-puddle seed): the edge
 *    ragged at two scales round the nominal outline, clods and trodden straw breaking the surface in the shallows, and a
 *    rim of soaked, darker mud round the water (and the clods) fading out raggedly 0.15–0.3 m beyond it; alpha blended
 *    (the decal treatment of buildPuddles' mesh);
 *  - trough (`uv.x` 0 at the boards → 1 a hand inside them, waterSheet): opaque, the sky dimmed along the boards (they
 *    stand over the water: what lies under them sees board, not sky), smaller ripples (it is sheltered).
 */
const SW_PARS = /* glsl */ `
varying vec3 vSwW;
varying vec3 vSwP;
float swH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float swN(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(swH(i), swH(i + vec2(1.0, 0.0)), u.x), mix(swH(i + vec2(0.0, 1.0)), swH(i + vec2(1.0, 1.0)), u.x), u.y);
}
float swF(vec2 p) { return 0.5 * swN(p) + 0.3 * swN(p * 2.03 + 7.13) + 0.2 * swN(p * 4.11 - 3.71); }
float swRip(vec2 q) { return (0.62 * swN(q * 3.4 + 1.7) + 0.38 * swN(q * 7.9 - 4.3)) * SW_RIP; }
`;
const SW_VERT = /* glsl */ `
vSwW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef SW_TROUGH
vSwP = vec3(uv, 0.0);
#else
vSwP = aSw;
#endif
`;
const SW_SURFACE = /* glsl */ `
vec2 swQ = vSwW.xz;
float swSeed = vSwP.y * 31.7;
#ifdef SW_TROUGH
float swWater = 1.0, swWet = 0.0;
float swEdge = clamp(vSwP.x, 0.0, 1.0);
float swDepth = 0.35 + 0.65 * swEdge;
#else
float swR = vSwP.x;
// the water's edge: the nominal outline pushed in and out at two scales (no clean oval, no polygon line)
float swM = swR + (swF(swQ * 2.3 + swSeed) - 0.5) * 0.46 + (swN(swQ * 9.0 - swSeed) - 0.5) * 0.12;
float swWater = 1.0 - smoothstep(0.88, 0.98, swM);
// clods breaking the surface in the shallows: a drier crest, its foot soaked
float swIslN = (swF(swQ * 4.6 + swSeed * 1.7) - 0.6) * smoothstep(0.4, 0.85, swR);
swWater *= 1.0 - smoothstep(0.02, 0.05, swIslN);
float swCrest = smoothstep(0.06, 0.11, swIslN);
float swDepth = clamp(1.0 - swM, 0.0, 1.0);
// the soaked rim round the water and the clods: dark wet mud, its outer edge ragged and crumbly, thin or gone in places
float swRimEnd = 0.95 + 1.0 * swF(swQ * 1.4 - swSeed * 0.7) + (swN(swQ * 7.0 + swSeed) - 0.5) * 0.25;
float swWet = (1.0 - smoothstep(swRimEnd - 0.25, swRimEnd, swM)) * (1.0 - swWater);
swWet = max(swWet, step(0.001, swIslN) * (1.0 - swWater));
#endif
float swSilt = swF(swQ * 3.1 + 11.0);
vec3 swBody = mix(SW_SHAL, SW_DEEP, smoothstep(0.04, 0.55, swDepth)) * (0.82 + 0.36 * swSilt);
vec3 swMud = SW_MUD * (0.75 + 0.5 * swN(swQ * 6.0 + 3.0));
#ifndef SW_TROUGH
swMud = mix(swMud, SW_MUD * 2.4, swCrest);   // (a clod's crest: drier, lighter mud)
#endif
diffuseColor.rgb = mix(swMud, swBody, swWater);
#ifdef SW_TROUGH
diffuseColor.a = 1.0;
#else
diffuseColor.a = max(swWater * 0.97, swWet * SW_RIMA * (0.72 + 0.4 * swN(swQ * 3.3 - swSeed)));
#endif
`;
const SW_SKY = /* glsl */ `
{
  vec3 swV = isOrthographic ? normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2])) : normalize(cameraPosition - vSwW);
  float swE = 0.03, swH0 = swRip(swQ);
  vec3 swNw = normalize(vec3(-(swRip(swQ + vec2(swE, 0.0)) - swH0) / swE, 1.0, -(swRip(swQ + vec2(0.0, swE)) - swH0) / swE));
  vec3 swRw = reflect(-swV, swNw); swRw.y = abs(swRw.y);
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
  vec3 swSky = textureCubeUV(envMap, envMapRotation * swRw, 0.0).rgb * envMapIntensity;
  vec3 swZen = textureCubeUV(envMap, envMapRotation * vec3(0.0, 1.0, 0.0), 0.7).rgb * envMapIntensity;
  #else
  vec3 swSky = vec3(0.42, 0.48, 0.56), swZen = vec3(0.5, 0.55, 0.62);
  #endif
  // the cloud deck 80 m up, where the reflected ray meets it: bright cloud over a deeper clear sky
  vec2 swC = swQ + swRw.xz / max(swRw.y, 0.25) * SW_DECK;
  float swCl = smoothstep(0.47, 0.74, swF(swC * SW_CLF + 4.1));
  swSky = mix(swSky * SW_CLEAR * vec3(0.82, 0.92, 1.06), max(swZen, swSky) * SW_CLOUD, swCl) * SW_SKYK;
  float swFr = 0.02 + 0.98 * pow(1.0 - clamp(dot(swNw, swV), 0.0, 1.0), 5.0);
  swFr = clamp(swFr * SW_FK + SW_F0, 0.0, 0.8) * swWater;
  #ifdef SW_TROUGH
  swFr *= 0.15 + 0.85 * swEdge;
  #endif
  outgoingLight = outgoingLight * (1.0 - swFr) + swSky * swFr;
}
`;

// (the soaked rim is darker than the mud round it, never a pale halo: most of its sheen goes — under the orthographic
//  camera the environment's specular is one flat lift over the whole rim)
const SW_RIMSPEC = /* glsl */ `
reflectedLight.directSpecular *= 1.0 - 0.75 * (1.0 - swWater);
reflectedLight.indirectSpecular *= 1.0 - 0.75 * (1.0 - swWater);
`;

const STILL_WATER = { puddle: null, trough: null };
/**
 * The still-water material: 'puddle' (alpha-blended decal: the caller sets its depth treatment) or 'trough' (opaque).
 * Created in node too (no textures): the unit tests read its flags.
 */
export function stillWaterMaterial(kind = 'puddle') {
  if (STILL_WATER[kind]) return STILL_WATER[kind];
  const trough = kind === 'trough';
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, name: `e03:${trough ? 'water' : 'puddle'}`,
    transparent: !trough });
  const defs = { SW_RIP: trough ? '0.004' : '0.009', SW_FK: trough ? '2.0' : '3.5', SW_F0: trough ? '0.03' : '0.07', SW_SKYK: '1.0',
    SW_CLEAR: '0.65', SW_CLOUD: '2.6', SW_DECK: '45.0', SW_CLF: '0.028',
    SW_DEEP: trough ? 'vec3(0.012, 0.012, 0.011)' : 'vec3(0.016, 0.016, 0.014)', SW_SHAL: 'vec3(0.05, 0.039, 0.028)',
    SW_MUD: 'vec3(0.024, 0.018, 0.013)', SW_RIMA: '0.75' };
  m.onBeforeCompile = (sh) => {
    sh.defines = { ...(sh.defines || {}), ...defs, ...(trough ? { SW_TROUGH: '' } : {}) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${trough ? '' : 'attribute vec3 aSw;\n'}varying vec3 vSwW;\nvarying vec3 vSwP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SW_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${SW_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SW_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.42, 0.9, swWater);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${SW_RIMSPEC}`)
      .replace('#include <opaque_fragment>', `${SW_SKY}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `e03-still-water:${kind}`;
  return (STILL_WATER[kind] = m);
}

/** The trough's water: still, dark, the sky in it (stillWaterMaterial 'trough'). null in node (the kit's plain colour). */
export function waterMaterial() {
  if (typeof document === 'undefined') return null;
  return stillWaterMaterial('trough');
}
/** The kit's water meshes (castle:e03_water) drawn with the water material instead. */
export function waterify(root) {
  const m = waterMaterial();
  if (!m) return;
  root.traverse((o) => { if (o.isMesh && o.material?.name === 'castle:e03_water') o.material = m; });
}

/** How far past the water's nominal outline the puddle's mesh reaches: its rim of soaked mud (m). */
export const PUDDLE_RIM = 0.36;

/**
 * The puddles' shapes (the same every load): per spot [x, z, half-length, half-width, rotation°] a lobed ring (three
 * harmonics and a little jitter on its radius, `rad`, N = 28) and, now and then, a satellite — the water running on
 * along the hollow. buildPuddles draws them; puddleOutlines gives the ground cover their footprint to keep off.
 */
function puddleShapes(spots, seed = 'e03:puddles') {
  const R = mulberry(seedOf(seed)), out = [], N = 28;
  const shape = (x, z, a, b, rot) => {
    const ph = [R() * TAU, R() * TAU, R() * TAU], am = [0.14 + R() * 0.1, 0.08 + R() * 0.07, 0.04 + R() * 0.03];
    const rad = Array.from({ length: N }, (_, i) => {
      const t = (i / N) * TAU;
      return 1 + am[0] * Math.sin(2 * t + ph[0]) + am[1] * Math.sin(3 * t + ph[1]) + am[2] * Math.sin(5 * t + ph[2]) + (R() - 0.5) * 0.08;
    });
    out.push({ x, z, a, b, rot, rad });
  };
  for (const [x, z, a, b, rotDeg = 0] of spots || []) {
    const rot = (rotDeg * Math.PI) / 180;
    shape(x, z, a, b, rot);
    if (a > 0.5 && R() < 0.6) {
      const side = R() < 0.5 ? -1 : 1, d = a * (1.25 + R() * 0.3), sc = 0.28 + R() * 0.18;
      shape(x + Math.cos(rot) * d * side, z + Math.sin(rot) * d * side, a * sc, b * sc * 1.2, rot + (R() - 0.5) * 0.8);
    }
  }
  return out;
}

/** A puddle's point at parameter angle t: the nominal outline scaled by `f` (0 → 1) plus `pad` m beyond it. */
const puddlePoint = ({ x, z, a, b, rot, rad }, i, f, pad = 0) => {
  const t = (i / rad.length) * TAU, c = Math.cos(rot), s = Math.sin(rot);
  const lx = Math.cos(t) * (a * rad[i] * f + pad), lz = Math.sin(t) * (b * rad[i] * f + pad);
  return [x + lx * c - lz * s, z + lx * s + lz * c];
};

/**
 * The puddles' footprints — the water and its rim of soaked mud — grown by `pad` m past the rim, as polygons
 * [[x, z], …]: for the mission's render-only `bareGround`, so no grass tuft or litter of the ground cover stands up
 * through the water or its rim (art/terrain.js groundExclude).
 */
export function puddleOutlines(spots, { pad = 0.08, seed = 'e03:puddles' } = {}) {
  return puddleShapes(spots, seed).map((p) => p.rad.map((_, i) => puddlePoint(p, i, 1, PUDDLE_RIM + pad)));
}

/**
 * Puddles standing where a gate or a trough has poached the ground (render only), drawn by the still-water shader:
 * each a lobed outline (three low harmonics and a little jitter: no two alike, no clean ovals) that the shader breaks
 * up further — a ragged edge, clods in the shallows, the sky and the clouds in the water, a rim of soaked mud round it —
 * now and then a satellite running on beside it. Draped on the drawn ground: every vertex `lift` m over the highest
 * ground within 0.25 m of it (the trodden berms the trail field raises — a few centimetres on mud — never poke
 * through), and drawn as the ground decals are (no depth write, a polygon offset, before the other transparent things,
 * out of the AO prepass). `spots` [[x, z, a, b, rotDeg]] (half-axes a, b m). Attribute `aSw`: (r, seed, 0) — r the
 * radius fraction (1 at the nominal outline), past it 1 + (metres beyond) / PUDDLE_RIM.
 * @returns {THREE.Mesh|null}
 */
export function buildPuddles(spots, heightAt = () => 0, { lift = 0.06, seed = 'e03:puddles' } = {}) {
  if (!spots?.length) return null;
  const pos = [], sw = [], idx = [];
  const ground = (x, z) => {
    let h = -Infinity;
    for (const [dx, dz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.18, 0.18], [-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18]]) h = Math.max(h, heightAt(x + dx, z + dz) || 0);
    return h;
  };
  // rings out from the middle: the water's to its nominal outline (fractions), then the rim band's (metres beyond it)
  const WATER = [0.4, 0.7, 0.88, 1.0], RIM = [0.5 * PUDDLE_RIM, PUDDLE_RIM];
  const shapes = puddleShapes(spots, seed), R = mulberry(seedOf(`${seed}:tone`));
  for (const p of shapes) {
    const N = p.rad.length, base = pos.length / 3, pk = R();
    const put = ([px, pz], r) => { pos.push(px, ground(px, pz) + lift, pz); sw.push(r, pk, 0); };
    put([p.x, p.z], 0);
    for (const f of WATER) for (let i = 0; i < N; i++) put(puddlePoint(p, i, f), f);
    for (const d of RIM) for (let i = 0; i < N; i++) put(puddlePoint(p, i, 1, d), 1 + d / PUDDLE_RIM);
    for (let i = 0; i < N; i++) idx.push(base, base + 1 + ((i + 1) % N), base + 1 + i);   // (the middle fan: faces up)
    for (let k = 1; k < WATER.length + RIM.length; k++) {
      const r0 = base + 1 + (k - 1) * N, r1 = base + 1 + k * N;
      for (let i = 0; i < N; i++) { const j = (i + 1) % N; idx.push(r0 + i, r0 + j, r1 + j, r0 + i, r1 + j, r1 + i); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSw', new THREE.Float32BufferAttribute(sw, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = stillWaterMaterial('puddle');
  Object.assign(mat, { depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'e03:puddles';
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.renderOrder = -1;
  mesh.userData.aoExclude = true;   // (a flat decal: nothing for the AO prepass)
  return mesh;
}

// ------------------------------------------------------------------ circus posters (canvas textures, browser only)

const POSTERS = [
  { bg: '#e7d6a6', ink: '#7a2e2a', band: '#c9a53a', title: 'ZIRKUS ADRIA', sub: 'LÖWEN · STRAUSSE · REITER', icon: 'lion' },
  { bg: '#d9c48a', ink: '#2f4a6a', band: '#7a2e2a', title: 'CIRKUS ADRIA', sub: 'VELKÉ PŘEDSTAVENÍ', icon: 'rider' },
  { bg: '#efe2c0', ink: '#3a3a38', band: '#a8453c', title: 'ADRIA', sub: 'WINTERQUARTIER · DOLNÍ LHOTA', icon: 'ostrich' },
];
let POSTER_MATS = null;
/** Poster materials (one per design): drawn once on a 2D canvas. null in node. */
export function posterMaterials() {
  if (POSTER_MATS !== null) return POSTER_MATS;
  if (typeof document === 'undefined') return (POSTER_MATS = []);
  POSTER_MATS = POSTERS.map((p) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 384;
    const g = c.getContext('2d');
    g.fillStyle = p.bg; g.fillRect(0, 0, 256, 384);
    g.fillStyle = p.band; g.fillRect(0, 0, 256, 54); g.fillRect(0, 330, 256, 54);
    g.fillStyle = p.ink; g.font = 'bold 34px Georgia, serif'; g.textAlign = 'center';
    g.fillText(p.title, 128, 40);
    g.font = 'bold 15px Georgia, serif'; g.fillStyle = p.bg; g.fillText(p.sub, 128, 362);
    g.fillStyle = p.ink;
    g.beginPath();
    if (p.icon === 'lion') { // a rearing lion on a tub
      g.ellipse(128, 190, 52, 40, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(150, 140, 34, 0, TAU); g.fill();
      g.fillStyle = p.band; g.beginPath(); g.arc(150, 140, 20, 0, TAU); g.fill();
      g.fillStyle = p.ink; g.fillRect(84, 220, 14, 60); g.fillRect(160, 220, 14, 60); g.fillRect(90, 280, 80, 20);
    } else if (p.icon === 'rider') { // a horse with a rider standing on its back
      g.ellipse(128, 220, 64, 26, 0, 0, TAU); g.fill();
      g.fillRect(80, 230, 10, 50); g.fillRect(170, 230, 10, 50); g.fillRect(186, 182, 16, 44);
      g.beginPath(); g.arc(122, 128, 13, 0, TAU); g.fill(); g.fillRect(116, 140, 12, 54); g.fillRect(96, 146, 52, 6);
    } else { // an ostrich
      g.ellipse(120, 210, 46, 32, 0, 0, TAU); g.fill();
      g.fillRect(156, 110, 9, 92); g.beginPath(); g.arc(162, 104, 11, 0, TAU); g.fill();
      g.fillRect(104, 236, 7, 60); g.fillRect(128, 236, 7, 60);
    }
    g.globalAlpha = 0.12; g.fillStyle = '#3a2a18';
    const r = rng(seedOf(p.title));
    for (let k = 0; k < 140; k++) g.fillRect(r() * 256, r() * 384, 2 + r() * 6, 1 + r() * 3); // weathering
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0, name: `e03:poster:${p.title}` });
  });
  return POSTER_MATS;
}

/** One merged poster mesh per design: quads (world corners) grouped by design index. */
export function posterMeshes(quads) {
  const mats = posterMaterials();
  if (!mats.length || !quads.length) return null;
  const g = new THREE.Group(); g.name = 'e03:posters';
  mats.forEach((m, k) => {
    const mine = quads.filter((q) => q.k % mats.length === k);
    if (!mine.length) return;
    const pos = [], uv = [];
    for (const { c } of mine) {
      const [a, b, cc, d] = c;
      pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; mesh.name = `e03:posters:${k}`;
    g.add(mesh);
  });
  return g;
}

// ------------------------------------------------------------------ the masts' rigging

/**
 * The lattice masts' rigging (the masts themselves are the shared lattice prop): three steel guys from two heights of
 * each mast to concrete anchor blocks, and the antenna wires slung mast to mast with their insulator strings. `masts`
 * [{id, x, z, h, guyAz?}] (guyAz, radians: the first guy's bearing; the others at 120° from it). Two groups: the main
 * mast's own (its guys and the spans tied to it: hidden when it falls, fadeE03Roofs) and the rest.
 */
export function buildMastWires(masts, mainId = 'mast_c') {
  const S = new Geo('e03:mast_wires'), M = new Geo('e03:mast_main_wires');
  for (const m of masts) {
    const G = m.id === mainId ? M : S, R = mulberry(seedOf(`e03:guys:${m.id}`));
    for (let k = 0; k < 3; k++) {
      const az = (m.guyAz ?? 0) + (k * 2 * Math.PI) / 3, d = m.h * (0.36 + R() * 0.04);
      const ax = m.x + Math.cos(az) * d, azz = m.z + Math.sin(az) * d;
      G.box('e03_plinth', ax, 0.1, azz, 0.62, 0.3, 0.62, az + (R() - 0.5) * 0.3, 0.55 + R() * 0.12); // the anchor block, half sunk, weathered
      for (const f of [0.48, 0.88]) rope(G, 'e03_black', [m.x + Math.cos(az) * 0.4, m.h * f, m.z + Math.sin(az) * 0.4], [ax, 0.26, azz], 0.15 + R() * 0.1, 0.022, 10);
    }
  }
  // the antenna: two spans from the main mast to the others, an insulator string at each end
  const main = masts.find((m) => m.id === mainId);
  if (main) for (const o of masts) {
    if (o === main) continue;
    const ya = main.h * 0.94, yb = o.h * 0.94, a = [main.x, ya, main.z], b = [o.x, yb, o.z];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), ux = (b[0] - a[0]) / L, uz = (b[2] - a[2]) / L;
    const a1 = [a[0] + ux * 1.2, ya - 0.1, a[2] + uz * 1.2], b1 = [b[0] - ux * 1.2, yb - 0.1, b[2] - uz * 1.2];
    rope(M, 'e03_black', a1, b1, L * 0.06, 0.02, 18);
    for (const [p, q] of [[a, a1], [b, b1]]) { rod(M, 'e03_black', p, q, 0.012, 4); M.box('e03_white', (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, 0.16, 0.16, 0.16, 0, 0.9); }
  }
  const g = new THREE.Group(); g.name = 'e03:rigging';
  g.add(S.build('e03:mast_wires', { damp: 0, moss: 0 }));
  const main3 = M.build('e03:mast_main_wires', { damp: 0, moss: 0 }); g.add(main3);
  return { group: g, main: main3 };
}
