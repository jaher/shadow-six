/**
 * M20 "Operation Valhalla" (Gundelfingen, 11 February 1945) second art pass: set dressing, kept in its own module so
 * the mission file only spreads it in (as art/m18-dressing.js). Every piece stands where the shipped solution's men
 * never come (≥ 3 m off every commando, guard and vehicle cell it visits) and off every sight line a guard's cone
 * could hold on a commando or a body (tests/unit/art-m20.test.mjs keeps them off the dossier's posts, beats and
 * routes). What blocks is drawn and what is drawn blocks: the log piles are B.LOW on their footprints, the rest are
 * measured on their drawn meshes (standing visuals: a man walks round them, a body is laid clear of them).
 *
 * - the NE corner outside the walls: two "Holzpolter" of spruce logs felled along the Black Forest edge, stacked on
 *   skids between stakes (the castle's stoves in the last winter of the war)
 * - the firing range: its works corner by the well and the fire-water basin — filled sandbags and a sand heap with a
 *   shovel and a barrow for mending the stops and the berm, and a rack of spare target frames by the third target
 * - the N rampart (T_n, y 10): the N Flak's ready ammunition on a pallet, its 1 m rangefinder on a tripod and the
 *   barrel-change cases
 * - the NE terrace (T_ne, y 4): a Luftschutz fire point against the N range's end wall (red buckets, sand box,
 *   shovel and beater, a water tub)
 * - the SE road: a Black Forest wayside cross under its little roof, on a sandstone pedestal
 * Builders: castle-kit Geo (merged per material, the castle's frost on what faces up); drawn by
 * missions/scripts/m20-art.js in place of the catalogue placeholder.
 * @module art/m20-dressing
 */
import { Geo, localFrame, segBox } from './castle-kit.js';
import { tube } from './field-guns.js';

const deg = (d) => (d * Math.PI) / 180;
const Y_N = 10, Y_NE = 4; // == m20_operation_valhalla.js Y.N / Y.NE
/** The forest edge (FOREST (118, 12) → (140, 24)) and its inward normal: the piles lie 5 m in from it, along it. */
const EDGE_A = [118, 12], EDGE_T = [22 / Math.hypot(22, 12), 12 / Math.hypot(22, 12)], EDGE_ROT = Math.atan2(12, 22);
const alongEdge = (s, off) => [+(EDGE_A[0] + EDGE_T[0] * s - EDGE_T[1] * off).toFixed(2), +(EDGE_A[1] + EDGE_T[1] * s + EDGE_T[0] * off).toFixed(2)];
export const LOGS_NE = [alongEdge(5, 5), alongEdge(12, 5)]; // (the second 3 m clear of rock rk_e1)

const piece = (id, variant, label, x, z, rot, w, d, h, extra = {}) => ({ id, type: 'crates', variant, label, x, z, rot, w, d, h, block: 0, fixed: true, ...extra });

export const M20_DRESSING = [
  // --- the NE corner: spruce log piles along the forest edge (B.LOW: a man lying behind one is hidden)
  ...LOGS_NE.map(([x, z], k) => piece(`logs_ne${k + 1}`, 'log_pile_spruce', 'Log pile', x, z, EDGE_ROT, 5.4, 2.2, 1.3,
    { block: 1, seed: 31 + k, alignFree: 'stacked along the Black Forest edge (28.6°) they were felled from, not the NE wall 9 m off' })),
  // --- the range's works corner between the well, the fire-water basin and the third target (B.LOW: cover for a man lying)
  piece('rng_sandbags', 'sandbag_point', 'Sandbags', 128.7, 80.6, deg(90), 3.0, 2.0, 0.8, { block: 1 }),
  piece('rng_targets', 'target_rack', 'Target rack', 127.3, 84.0, 0, 2.4, 1.0, 1.6, { block: 1 }),
  // --- the N rampart: the N Flak's ready ammunition, rangefinder and barrel cases (raised cells carry no block)
  piece('flak_n_ammo', 'flak_ammo_pallet', 'Ammunition', 84.0, 17.0, 0, 1.6, 1.4, 0.9, { baseY: Y_N }),
  piece('flak_n_rf', 'rangefinder_tripod', 'Rangefinder', 92.6, 16.6, deg(-40), 1.2, 1.2, 1.5, { baseY: Y_N }),
  piece('flak_n_barrels', 'barrel_cases', 'Barrel cases', 90.4, 15.4, 0, 1.8, 0.7, 0.45, { baseY: Y_N }),
  // --- the NE terrace: the fire point, its back to the N range's end wall
  piece('ls_fire', 'ls_fire_point', 'Fire point', 108.0, 37.0, 0, 2.0, 1.2, 1.5, { baseY: Y_NE }),
  // --- the SE road: the wayside cross 1.4 m off the road's N edge, facing it
  piece('cross_se', 'wayside_cross', 'Wayside cross', 130.5, 134.0, deg(-45), 0.9, 0.9, 3.0),
];
/** The raised pieces stand on their level's flags: those contacts are bonds (the mission's joinStructures pairs). */
export const M20_DRESSING_JOINS = M20_DRESSING.filter((s) => s.baseY).map((s) => [s.id, s.baseY === Y_N ? 't_n' : 't_ne']);
/** The variants this module draws (m20-art.js swaps their placeholders; building-props keeps them off the library). */
export const M20_DRESSING_VARIANTS = new Set(M20_DRESSING.map((s) => s.variant));

/** A log's end: a disc facing along `t` (+1) or against it (−1), centre c, radius r. */
function endDisc(G, c, t, r, sgn, seg, tone) {
  const u = [-t[2], 0, t[0]], v = [0, 1, 0];
  const p = (k) => { const a = (k / seg) * Math.PI * 2; return [c[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, c[1] + Math.sin(a) * r, c[2] + (u[2] * Math.cos(a)) * r]; };
  for (let k = 0; k < seg; k++) if (sgn > 0) G.tri('endgrain', c, p(k + 1), p(k), tone); else G.tri('endgrain', c, p(k), p(k + 1), tone);
}
/** One log along the frame's u from u0 to u1 at (w, y), radius r (bark sides, end grain at both ends). */
function log(G, F, u0, u1, w, y, r, tone = 1) {
  const [ax, az] = F.at(u0, w), [bx, bz] = F.at(u1, w), t = [F.t[0], 0, F.t[1]];
  tube(G, 'bark', [ax, y, az], [bx, y, bz], r, r * 0.94, 9, tone);
  endDisc(G, [ax, y, az], t, r, -1, 9, 0.9 + 0.2 * tone);
  endDisc(G, [bx, y, bz], t, r * 0.94, 1, 9, 0.9 + 0.2 * tone);
}

/** Holzpolter: spruce logs stacked 5-4-3 on two skids between four stakes, ends ragged. Footprint w × d. */
export function buildLogPile(o) {
  const G = new Geo(o.seed ?? 31), R = G.R, F = localFrame(o.x, o.z, o.rot ?? 0), L = (o.w ?? 5.4) - 0.3, W2 = (o.d ?? 2.2) / 2;
  for (const u of [-L * 0.32, L * 0.32]) segBox(G, 'timber', F, u - 0.09, u + 0.09, -W2 + 0.05, W2 - 0.05, 0, 0.16, 0.7); // skids
  let y = 0.16;
  for (const [n, k] of [[5, 0], [4, 1], [3, 2]]) {
    const r = (W2 * 2 - 0.2) / 10 * (1 - k * 0.04);
    y += k ? r * 1.62 : r;
    for (let i = 0; i < n; i++) {
      const w = (i - (n - 1) / 2) * 2 * r * 1.01, j0 = (R() - 0.5) * 0.25, j1 = (R() - 0.5) * 0.25;
      log(G, F, -L / 2 + j0, L / 2 + j1, w, y + (R() - 0.5) * 0.02, r * (0.9 + R() * 0.12), 0.82 + R() * 0.3);
    }
  }
  for (const u of [-L * 0.32, L * 0.32]) for (const s of [-1, 1]) segBox(G, 'timber', F, u - 0.06, u + 0.06, s * (W2 - 0.02) - 0.06, s * (W2 - 0.02) + 0.06, 0, y + 0.35, 0.65); // stakes
  return G.build(o.name || 'log_pile', { ground: 0, damp: 0.3, streaks: 0, moss: 0.25 });
}

/** A filled sandbag (pillow box, slightly tapered top) at local (u, w), base y, heading `a` in the frame. */
function bag(G, F, u, w, y, a, tone) {
  const [x, z] = F.at(u, w);
  G.box('burlap', x, y + 0.075, z, 0.58, 0.15, 0.32, F.rot + a, tone, 0.08);
}

/** The range's sandbag point: a stack of filled bags, the sand heap with a shovel in it, a barrow. Frame u along w. */
export function buildSandbagPoint(o) {
  const G = new Geo(o.seed ?? 'sandbags'), R = G.R, F = localFrame(o.x, o.z, o.rot ?? 0), L2 = (o.w ?? 3) / 2, W2 = (o.d ?? 1.8) / 2;
  // the stack (u −L2 … −0.2): three courses, stretchers then headers
  for (let c = 0; c < 3; c++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const u = -L2 + 0.35 + i * 0.62 + (c % 2) * 0.12, w = -W2 + 0.3 + j * 0.36;
    bag(G, F, u, w, c * 0.15, (c % 2) * 0.12 + (R() - 0.5) * 0.12, 0.85 + R() * 0.25);
  }
  bag(G, F, -0.35, 0.02, 0, 0.3, 0.9);                                   // one dropped beside the stack
  // the sand heap (u 0.2 … L2): a low cone, a smaller one on it
  const [hx, hz] = F.at(L2 - 0.8, -0.1);
  G.cyl('sand', hx, 0, hz, 0.78, 0.42, 0.3, 14, 0.95);                 // a mound: steep flanks, a rounded crown
  G.cyl('sand', hx, 0.3, hz, 0.42, 0.12, 0.3, 14, 1.0);
  const [lx, lz] = F.at(L2 - 0.45, 0.4);
  G.cyl('sand', lx, 0, lz, 0.32, 0.08, 0.26, 10, 0.9);                   // the spill shovelled off it
  // the shovel driven into it, its haft leaning back towards the stack
  const blade = [hx - 0.1, 0.42, hz + 0.05], top = [hx - 0.5 * F.t[0], 1.0, hz - 0.5 * F.t[1]];
  tube(G, 'timber', blade, top, 0.022, 0.02, 6, 0.8);
  G.box('iron', blade[0], 0.36, blade[2], 0.22, 0.16, 0.03, F.rot + Math.PI / 2, 0.5);
  // the barrow along the stack's open side (w +0.55), its wheel to the stack's end: steel tray, one wheel, handles, legs
  const B = localFrame(...F.at(-0.6, 0.55), F.rot + Math.PI);
  segBox(G, 'paint', B, -0.35, 0.35, -0.28, 0.28, 0.32, 0.36, 0.7);    // tray floor
  for (const s of [-1, 1]) segBox(G, 'paint', B, -0.38, 0.38, s * 0.3 - 0.02, s * 0.3 + 0.02, 0.34, 0.6, 0.75);
  segBox(G, 'paint', B, 0.36, 0.4, -0.3, 0.3, 0.34, 0.62, 0.7); segBox(G, 'paint', B, -0.4, -0.36, -0.3, 0.3, 0.34, 0.56, 0.7);
  const [wx, wz] = B.at(0.55, 0), ax = [B.n[0] * 0.05, 0, B.n[1] * 0.05];
  tube(G, 'rubber', [wx - ax[0], 0.2, wz - ax[2]], [wx + ax[0], 0.2, wz + ax[2]], 0.2, 0.2, 10, 0.6);
  for (const s of [-1, 1]) {
    const [a0, b0] = B.at(0.6, s * 0.2), [a1, b1] = B.at(-0.95, s * 0.27);
    tube(G, 'timber', [a0, 0.24, b0], [a1, 0.55, b1], 0.025, 0.025, 6, 0.75);
    const [lx, lz] = B.at(-0.3, s * 0.24);
    segBox(G, 'iron', localFrame(lx, lz, B.rot), -0.02, 0.02, -0.02, 0.02, 0, 0.34, 0.5);
  }
  return G.build(o.name || 'sandbag_point', { ground: 0, damp: 0.2, streaks: 0, moss: 0.1 });
}

/** A rack of spare target frames: two trestles, a top rail, three boards leaning on it (silhouettes out). */
export function buildTargetRack(o) {
  const G = new Geo(o.seed ?? 'targets'), F = localFrame(o.x, o.z, o.rot ?? 0), L2 = (o.w ?? 2.4) / 2, H = 1.45;
  for (const u of [-L2 + 0.35, L2 - 0.35]) for (const s of [-1, 1]) {
    const [x0, z0] = F.at(u, s * 0.42), [x1, z1] = F.at(u, 0);
    tube(G, 'timber', [x0, 0, z0], [x1, H, z1], 0.04, 0.035, 6, 0.75);
  }
  const [r0x, r0z] = F.at(-L2, 0), [r1x, r1z] = F.at(L2, 0);
  tube(G, 'timber', [r0x, H - 0.03, r0z], [r1x, H - 0.03, r1z], 0.045, 0.045, 6, 0.7);
  [-0.68, 0, 0.68].forEach((u, k) => {
    // a board 0.62 wide, 1.1 tall, leaning on the rail from 0.55 m out on the +w side
    const lean = 0.42 + k * 0.03, base = 0.58;
    const Fb = localFrame(...F.at(u, base - lean / 2), F.rot);
    const q = (uu, ww, yy) => { const [x, z] = Fb.at(uu, ww); return [x, yy, z]; };
    const a = q(-0.31, lean / 2, 0.02), b = q(0.31, lean / 2, 0.02), c = q(0.31, -lean / 2, 1.12), d = q(-0.31, -lean / 2, 1.12);
    G.quad('boards', a, b, c, d, 1.15 - k * 0.08); G.quad('boards', b, a, d, c, 0.8);
    const onBoard = (uu, y) => q(uu, lean / 2 - (lean * (y - 0.02)) / 1.1 + 0.012, y); // a point on its face, just proud
    const sil = (half, y0, y1) => G.quad('iron', onBoard(-half, y0), onBoard(half, y0), onBoard(half, y1), onBoard(-half, y1), 0.12);
    sil(0.2, 0.2, 0.75); sil(0.07, 0.75, 0.8); sil(0.1, 0.8, 0.98);       // torso, neck, head (black)
  });
  const [px, pz] = F.at(L2 - 0.17, 0.3);
  G.cyl('iron', px, 0, pz, 0.14, 0.15, 0.3, 10, 0.55); // the paste pail
  return G.build(o.name || 'target_rack', { ground: 0, damp: 0.2, streaks: 0, moss: 0.1 });
}

/** The Flak's ready ammunition: a plank pallet, steel 2 cm boxes stacked 3 × 2 × 2, magazines stood in a row. */
export function buildFlakAmmo(o) {
  const G = new Geo(o.seed ?? 'flak_ammo'), R = G.R, F = localFrame(o.x, o.z, o.rot ?? 0), L2 = (o.w ?? 1.6) / 2, W2 = (o.d ?? 1.2) / 2;
  const P0 = -W2, P1 = W2 - 0.4;                                         // the pallet's depth; the magazines stand in front
  for (const w of [P0 + 0.1, (P0 + P1) / 2, P1 - 0.1]) segBox(G, 'timber', F, -L2, L2, w - 0.05, w + 0.05, 0, 0.08, 0.7);
  for (let u = -L2 + 0.06; u < L2; u += 0.19) segBox(G, 'planks', F, u, u + 0.15, P0, P1, 0.08, 0.11, 0.85);
  for (let c = 0; c < 2; c++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const u0 = -L2 + 0.05 + i * 0.46, w0 = P0 + 0.08 + j * 0.34, y0 = 0.11 + c * 0.27, t = 0.75 + R() * 0.2;
    segBox(G, 'paint', F, u0, u0 + 0.42, w0, w0 + 0.3, y0, y0 + 0.25, t);
    segBox(G, 'iron', F, u0 + 0.16, u0 + 0.26, w0 + 0.13, w0 + 0.17, y0 + 0.25, y0 + 0.28, 0.5);   // handle
  }
  for (let k = 0; k < 4; k++) segBox(G, 'paint', F, -L2 + 0.2 + k * 0.2, -L2 + 0.27 + k * 0.2, W2 - 0.3, W2 - 0.08, 0, 0.32, 0.6); // magazines
  return G.build(o.name || 'flak_ammo', { ground: o.y0 ?? 0, damp: 0, streaks: 0, moss: 0 });
}

/** 1 m rangefinder (Em 34 type) on its tripod: three legs, the head, the tube with its end hoods and eyepiece. */
export function buildRangefinder(o) {
  const G = new Geo(o.seed ?? 'rangefinder'), F = localFrame(o.x, o.z, o.rot ?? 0), y = 1.25;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.3, [fx, fz] = F.at(Math.cos(a) * 0.55, Math.sin(a) * 0.55);
    tube(G, 'timber', [o.x, y - 0.1, o.z], [fx, 0, fz], 0.025, 0.02, 6, 0.75);
  }
  G.cyl('paint', o.x, y - 0.14, o.z, 0.07, 0.06, 0.16, 8, 0.75);
  const [ax, az] = F.at(0, -0.5), [bx, bz] = F.at(0, 0.5);              // the tube across the line of sight (u)
  tube(G, 'paint', [ax, y + 0.06, az], [bx, y + 0.06, bz], 0.05, 0.05, 8, 0.85);
  for (const s of [-1, 1]) { const [hx, hz] = F.at(0.02, s * 0.53); G.box('paint', hx, y + 0.06, hz, 0.14, 0.13, 0.1, F.rot, 0.7); }
  const [ex, ez] = F.at(-0.1, 0);
  G.box('iron', ex, y + 0.1, ez, 0.12, 0.07, 0.16, F.rot, 0.4);          // eyepiece and headrest
  return G.build(o.name || 'rangefinder', { ground: o.y0 ?? 0, damp: 0, streaks: 0, moss: 0 });
}

/** Two barrel-change cases (long steel boxes with end handles) on a pair of bearers. */
export function buildBarrelCases(o) {
  const G = new Geo(o.seed ?? 'barrels'), F = localFrame(o.x, o.z, o.rot ?? 0), L2 = (o.w ?? 1.8) / 2;
  for (const u of [-L2 * 0.6, L2 * 0.6]) segBox(G, 'timber', F, u - 0.05, u + 0.05, -0.3, 0.3, 0, 0.07, 0.7);
  for (const [w, t] of [[-0.15, 0.8], [0.15, 0.7]]) {
    segBox(G, 'paint', F, -L2 + 0.05, L2 - 0.05, w - 0.12, w + 0.12, 0.07, 0.3, t);
    for (const s of [-1, 1]) segBox(G, 'iron', F, s * (L2 - 0.02) - 0.03, s * (L2 - 0.02) + 0.03, w - 0.04, w + 0.04, 0.15, 0.22, 0.45);
  }
  return G.build(o.name || 'barrel_cases', { ground: o.y0 ?? 0, damp: 0, streaks: 0, moss: 0 });
}

/** Luftschutz fire point: a bucket rack (three red buckets), the sand box with its shovel, a beater, a water tub. */
export function buildFirePoint(o) {
  const G = new Geo(o.seed ?? 'fire_point'), F = localFrame(o.x, o.z, o.rot ?? 0), L2 = (o.w ?? 2) / 2, W2 = (o.d ?? 1.2) / 2;
  const back = -W2 + 0.12;                                               // the rack stands against the wall (−w)
  for (const u of [-L2 + 0.1, 0.25]) segBox(G, 'timber', F, u - 0.05, u + 0.05, back - 0.05, back + 0.05, 0, 1.45, 0.7);
  segBox(G, 'timber', F, -L2 + 0.05, 0.3, back - 0.04, back + 0.04, 1.2, 1.28, 0.75);
  for (const u of [-L2 + 0.35, -L2 + 0.7, -L2 + 1.05]) {
    const [bx, bz] = F.at(u, back + 0.16);
    G.cyl('signal', bx, 0.78, bz, 0.12, 0.15, 0.3, 10, 0.9);             // bucket hung from its hook
    G.cyl('iron', bx, 1.08, bz, 0.01, 0.01, 0.14, 4, 0.4);
  }
  segBox(G, 'planks', F, 0.45, L2 - 0.05, back, back + 0.5, 0, 0.42, 0.8);  // the sand box
  segBox(G, 'sand', F, 0.5, L2 - 0.1, back + 0.05, back + 0.45, 0.36, 0.4, 1.0);
  segBox(G, 'signal', F, 0.45, L2 - 0.05, back - 0.02, back, 0.1, 0.32, 0.7); // its red front band, on the wall side
  const [sx, sz] = F.at(L2 - 0.25, back + 0.25), [tx, tz] = F.at(L2 - 0.15, back + 0.02);
  tube(G, 'timber', [sx, 0.4, sz], [tx, 1.35, tz], 0.02, 0.02, 6, 0.8);  // shovel leaning on the wall
  G.box('iron', sx, 0.33, sz, 0.2, 0.14, 0.03, F.rot, 0.5);
  const [px, pz] = F.at(0.36, back + 0.04);                              // the beater (Feuerpatsche)
  tube(G, 'timber', [px, 0.08, pz], [px, 1.7, pz], 0.018, 0.018, 6, 0.75);
  G.box('canvas', px, 0.25, pz, 0.32, 0.34, 0.03, F.rot, 0.6);
  const [wx, wz] = F.at(-0.35, W2 - 0.36);                               // the water tub, a staved half-barrel
  G.cyl('planks', wx, 0, wz, 0.34, 0.38, 0.55, 14, 0.75, { caps: false });
  G.cyl('lead', wx, 0.48, wz, 0.33, 0.33, 0.01, 14, 0.35);
  for (const y of [0.12, 0.44]) G.cyl('iron', wx, y, wz, 0.352 + y * 0.07, 0.355 + y * 0.07, 0.04, 14, 0.45, { caps: false });
  return G.build(o.name || 'fire_point', { ground: o.y0 ?? 0, damp: 0.2, streaks: 0, moss: 0 });
}

/** Black Forest wayside cross: a sandstone pedestal on a plinth, the timber cross under a little gable roof. */
export function buildWaysideCross(o) {
  const G = new Geo(o.seed ?? 'cross'), F = localFrame(o.x, o.z, o.rot ?? 0);
  segBox(G, 'dressed', F, -0.42, 0.42, -0.42, 0.42, 0, 0.18, 0.75);
  segBox(G, 'dressed', F, -0.3, 0.3, -0.3, 0.3, 0.18, 1.0, 0.95);
  segBox(G, 'dressed', F, -0.34, 0.34, -0.34, 0.34, 1.0, 1.1, 0.85);
  segBox(G, 'iron', F, -0.18, 0.18, 0.3, 0.31, 0.45, 0.75, 0.35);       // the tin plaque on the road face (+w)
  segBox(G, 'timber', F, -0.06, 0.06, -0.06, 0.06, 1.1, 2.95, 0.55);
  segBox(G, 'timber', F, -0.48, 0.48, -0.05, 0.05, 2.28, 2.4, 0.55);
  for (const s of [-1, 1]) {                                             // the roof: two boards over the head, ridge along u
    const q = (u, w, y) => { const [x, z] = F.at(u, w); return [x, y, z]; };
    const a = q(-0.2, 0, 3.1), b = q(0.2, 0, 3.1), c = q(0.2, s * 0.24, 2.9), d = q(-0.2, s * 0.24, 2.9);
    if (s > 0) { G.quad('boards', a, d, c, b, 0.7); G.quad('boards', a, b, c, d, 0.5); } else { G.quad('boards', a, b, c, d, 0.7); G.quad('boards', a, d, c, b, 0.5); }
  }
  return G.build(o.name || 'wayside_cross', { ground: 0, damp: 0.5, streaks: 0.3, moss: 0.4 });
}

/** variant → builder (missions/scripts/m20-art.js). */
export const M20_DRESSING_BUILDERS = {
  log_pile_spruce: buildLogPile, sandbag_point: buildSandbagPoint, target_rack: buildTargetRack, flak_ammo_pallet: buildFlakAmmo,
  rangefinder_tripod: buildRangefinder, barrel_cases: buildBarrelCases, ls_fire_point: buildFirePoint, wayside_cross: buildWaysideCross,
};
