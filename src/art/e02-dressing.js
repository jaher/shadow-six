/**
 * LIGHTS OUT e02 "Curfew" (Quartiere Scirocco, Naples, 29 September 1943, blackout): the quarter's set dressing as
 * mission data (props that stand on the map: what blocks is drawn and what is drawn blocks) and the variant names the
 * mission's own art draws (missions/scripts/e02.js → art/e02-art.js), kept off the building library here so a Naples
 * tufa house never turns into a Norman farmhouse fitted onto its footprint.
 * @module art/e02-dressing
 */
import { VARIANT_HINTS } from './building-props.js';

const deg = (d) => (d * Math.PI) / 180;
const Y_B = 4, Y_C = 8, Y_ROOF = 16; // == e02_curfew.js Y

/** Every variant the mission's art module draws itself (the catalogue placeholder is hidden, no library pick). */
export const E02_VARIANTS = {
  house: ['tufa_townhouse', 'palazzo_wing', 'palazzo_screen', 'palazzo_rear_gate', 'church_baroque_med'],
  flat_roof_house: ['tufa_low_terrace', 'tufa_stair_landing'],
  watchtower: ['campanile_tufa', 'roof_platform'],
  ruins: ['aqueduct_stairhead'],
  wall: ['sea_wall_tufa', 'tufa_yard_wall'],
  crates: ['tram_burning', 'barricade_junk', 'motor_pool_tent', 'kennel_plank', 'handcart_naples', 'fish_stall', 'rifles_leaning', 'van_loop_rack'],
  well: ['fountain_statue'],
  generator: ['genset_wehrmacht'],
};
for (const [type, list] of Object.entries(E02_VARIANTS)) {
  VARIANT_HINTS[type] ||= {};
  for (const v of list) VARIANT_HINTS[type][v] = null;
}

const piece = (id, variant, label, x, z, rot, w, d, h, extra = {}) => ({ id, type: 'crates', variant, label, x, z, rot, w, d, h, block: 0, fixed: true, ...extra });

/**
 * Props that stand on the map. Positions keep clear of every beat, post and the shipped solution's walks; B.LOW pieces
 * are cover for a man lying behind them.
 */
export const E02_PROPS = [
  // --- level B: the generator in the courtyard's NW corner (its lever: scripts/e02.js), the fountain in the piazza
  { id: 'genset', type: 'generator', variant: 'genset_wehrmacht', label: 'Generator', x: 17.6, z: 53.2, rot: 0, w: 1.6, d: 1.1, h: 1.3, block: 1, level: 'B', baseY: Y_B },
  { id: 'fountain', type: 'well', variant: 'fountain_statue', label: 'Fountain', x: 50, z: 77, rot: 0, r: 2, h: 1.0, block: 1, level: 'B', baseY: Y_B },
  // --- level C: the motor pool (two lorries and a staff car parked, the crews' tent, the kennel)
  piece('mp_lorry1', 'opel_canvas', 'Lorry', 90, 4.6, deg(180), 6.6, 2.4, 2.9, { block: 2, vehicleArt: 'opel_blitz_cargo', level: 'C', baseY: Y_C }),
  piece('mp_lorry2', 'opel_canvas', 'Lorry', 90, 9.8, deg(180), 6.6, 2.4, 2.9, { block: 2, vehicleArt: 'opel_blitz_cargo', level: 'C', baseY: Y_C }),
  piece('mp_tent', 'motor_pool_tent', 'Tent', 82.6, 6, 0, 4, 5, 2.6, { block: 2, level: 'C', baseY: Y_C }),
  piece('mp_kennel', 'kennel_plank', 'Kennel', 98, 13.6, 0, 1.4, 1.4, 1.1, { block: 1, level: 'C', baseY: Y_C }),
  // --- level A: the insurgents' rifles against the tram, a handcart and a fish stall on Via Marina
  piece('barr_rifles', 'rifles_leaning', 'Rifles', 12.9, 127.5, 0, 0.5, 2.2, 1.2, { level: 'A' }),
  piece('cart_marina', 'handcart_naples', 'Handcart', 68.5, 119.4, deg(5), 2.4, 1.2, 1.0, { block: 1, level: 'A' }),
  piece('stall_marina', 'fish_stall', 'Stall', 40.5, 119.6, 0, 2.6, 1.3, 1.6, { block: 1, level: 'A' }),
];

/** Street furniture (world/roads.js): unlit lamps (blackout), the gate's two floodlights, a Morris column. */
export const E02_FURNITURE = [
  // Via Marina: unlit cast-iron lamps along the port wall, their glass painted blue
  ...[[32, 136.4], [56, 136.4], [74, 136.4]].map(([x, z], k) => ({ id: `lamp_m${k}`, type: 'lamp_post', variant: 'paris_single', x, z, rot: deg(270), lit: false, hooded: true, block: 0 })),
  // the piazza and Via Alta: dark lamps
  ...[[36.6, 88.8], [63.4, 66.2], [63.4, 88.8]].map(([x, z], k) => ({ id: `lamp_p${k}`, type: 'lamp_post', variant: 'paris_single', x, z, y: Y_B, rot: 0, lit: false, hooded: true, block: 0 })),
  ...[[33, 16.4], [60, 16.4]].map(([x, z], k) => ({ id: `lamp_a${k}`, type: 'lamp_post', variant: 'paris_single', x, z, y: Y_C, rot: deg(90), lit: false, hooded: true, block: 0 })),
  // the palazzo gate's floodlights (lit; the generator's lever puts them out)
  { id: 'flood_gn', type: 'floodlight', x: 36.9, z: 54.2, y: Y_B, rot: deg(150), lit: true, block: 0 },
  { id: 'flood_gs', type: 'floodlight', x: 36.9, z: 61.8, y: Y_B, rot: deg(210), lit: true, block: 0 },
  { id: 'morris_marina', type: 'morris_column', x: 30.5, z: 119.6, rot: 0 },
];

/** Searchlight on the palazzo's roof platform (c4's post; visual). */
export const E02_SEARCHLIGHT = { x: 31, z: 46.4, y: Y_ROOF };

// ---------------------------------------------------------------- builders (art/e02-art.js draws them in place of the placeholders)
/** The burning tram across Via Marina: a Naples motor coach, ochre below the windows and green above, charred by the
 *  fire, its windows gone, a trolley pole askew; laid along z (its footprint w × d, h). G: castle-kit Geo. */
export function buildTram(G, s) {
  const x = s.x, z = s.z, L = s.d, W = s.w, y = 0.62, len2 = L / 2;
  // bogies and wheels
  for (const k of [-1, 1]) {
    G.box('np_iron', x, 0.36, z + k * (len2 - 2.2), W * 0.7, 0.42, 2.6, 0, 0.7);
    for (const j of [-0.65, 0.65]) for (const sx of [-1, 1]) G.cyl('np_iron', x + sx * 0.62, 0.42, z + k * (len2 - 2.2) + j, 0.42, 0.42, 0.12, 10, 0.6);
  }
  // floor, lower panels (ochre, scorched), the window band (no glass left), upper panels and the roof (green)
  G.box('np_iron', x, y - 0.06, z, W, 0.12, L, Math.PI / 2, 0.6);
  for (const sx of [-1, 1]) {
    G.box('np_tramO', x + sx * (W / 2 - 0.03), y + 0.55, z, 0.06, 1.1, L, 0, 0.8);
    for (let k = 0; k < 7; k++) G.box('np_char', x + sx * (W / 2 - 0.02), y + 0.6 + (k % 3) * 0.2, z - len2 + 1 + k * 1.6, 0.07, 0.5 + (k % 2) * 0.3, 1.1 + (k % 3) * 0.3, 0, 0.9);
    for (let k = 0; k <= 8; k++) G.box('np_tramG', x + sx * (W / 2 - 0.03), y + 1.65, z - len2 + 0.4 + (k * (L - 0.8)) / 8, 0.08, 1.0, 0.16, 0, 0.75); // window posts
    G.box('np_tramG', x + sx * (W / 2 - 0.03), y + 2.4, z, 0.06, 0.5, L, 0, 0.7);
  }
  for (const k of [-1, 1]) {
    // (the ends between the sides: their corners were in the sides' outer planes)
    G.box('np_tramO', x, y + 0.55, z + k * len2, W - 0.12, 1.1, 0.06, 0, 0.75);
    G.box('np_char', x, y + 1.65, z + k * len2, W * 0.8, 1.0, 0.05, 0, 0.6);
    G.box('np_tramG', x, y + 2.4, z + k * len2, W - 0.12, 0.5, 0.06, 0, 0.7);
  }
  G.box('np_char', x, y + 2.72, z, W + 0.1, 0.14, L + 0.1, 0, 0.7); // roof, burned through in places
  G.box('np_tramG', x, y + 2.84, z - len2 * 0.4, W * 0.6, 0.1, L * 0.35, 0, 0.6);
  // the trolley pole fallen across the roof, the lamp in its dash
  slab3s(G, 'np_iron', [x, y + 2.95, z + 2], [x + 1.6, y + 3.3, z - 3.5], 0.06, 0.06);
  // the inside: charred seats and the dark of it
  G.box('np_char', x, y + 0.35, z, W - 0.3, 0.7, L - 0.4, 0, 0.5);
}

/** A slab3 without importing naples-kit at module scope (the dressing data stay node-light). */
function slab3s(G, mat, a, b, w, t) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-3;
  const n = Math.max(1, Math.ceil(L / 0.6));
  for (let i = 0; i < n; i++) {
    const f0 = i / n, f1 = (i + 1) / n;
    // (every other piece 1 cm thicker: consecutive pieces overlap at their ends, their sides in one plane)
    G.box(mat, a[0] + dx * (f0 + f1) / 2, a[1] + dy * (f0 + f1) / 2, a[2] + dz * (f0 + f1) / 2, Math.hypot(dx, dz) / n + 0.02, Math.max(t, Math.abs(dy) / n) + (i % 2) * 0.01, w + (i % 2) * 0.01, Math.atan2(dz, dx), 0.75);
  }
}

/** The insurgents' barricade junk: crates, a wardrobe on its back, mattresses, barrels, sandbags, torn-up setts. */
export function buildBarricade(G, s) {
  const R = mulberry(s.seed ?? (s.x * 31 + s.z));
  const x0 = s.x - s.w / 2, z0 = s.z - s.d / 2;
  const n = Math.max(3, Math.round((s.w * s.d) / 0.9));
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.4 + R() * (s.w - 0.8), z = z0 + 0.4 + R() * (s.d - 0.8), k = R();
    if (k < 0.35) G.box('np_timber', x, 0.3 + R() * 0.25, z, 0.6 + R() * 0.4, 0.55 + R() * 0.3, 0.5 + R() * 0.4, R() * 3, 0.7 + R() * 0.3);
    else if (k < 0.55) G.cyl('np_rust', x, 0, z, 0.3, 0.3, 0.9, 10, 0.7 + R() * 0.2);
    else if (k < 0.75) G.box('np_sack', x, 0.02 + (0.3 + (i % 5) * 0.012) / 2, z, 0.75, 0.3 + (i % 5) * 0.012, 0.45, R() * 3, 0.85); // (heights differ: two overlapping had one top)
    else if (k < 0.88) G.box('np_cloth', x, 0.15 + R() * 0.4, z, 1.8, 0.2, 0.9, R() * 3, 0.65);
    else G.box('np_basalt', x, (0.22 + (i % 5) * 0.012) / 2, z, 0.5, 0.22 + (i % 5) * 0.012, 0.5, R() * 3, 0.8);
  }
  G.box('np_door', s.x, Math.min(s.h, 1.4) * 0.45, s.z, Math.min(s.w, 1.9), 0.5, Math.min(s.d, 0.9), 0.3, 0.7); // a wardrobe on its back
}

/** The piazza's fountain: a piperno basin on two steps, dark water, a pedestal with a stucco figure pouring a jar. */
export function buildFountain(G, s, y) {
  const r = s.r ?? 2;
  G.cyl('np_piperno', s.x, y, s.z, r + 0.15, r + 0.15, 0.18, 24, 0.9);
  G.cyl('np_piperno', s.x, y + 0.18, s.z, r, r - 0.05, 0.62, 24, 0.95, { caps: false });
  G.cyl('np_marble', s.x, y + 0.8, s.z, r + 0.05, r + 0.05, 0.12, 24, 0.95, { caps: false });
  G.cyl('np_glass', s.x, y + 0.55, s.z, r - 0.15, r - 0.15, 0.02, 24, 0.5); // the water
  G.cyl('np_piperno', s.x, y + 0.55, s.z, 0.55, 0.42, 1.4, 10, 0.9);
  G.cyl('np_marble', s.x, y + 1.95, s.z, 0.6, 0.6, 0.18, 10, 0.95);
  // the figure: a woman pouring from a jar (stacked forms, stucco white, weathered)
  G.cyl('np_marble', s.x, y + 2.13, s.z, 0.26, 0.2, 0.75, 8, 0.95);
  G.cyl('np_marble', s.x, y + 2.88, s.z, 0.2, 0.16, 0.55, 8, 0.95);
  G.cyl('np_marble', s.x, y + 3.43, s.z, 0.11, 0.11, 0.2, 8, 0.95);
  G.cyl('np_marble', s.x + 0.02, y + 3.55, s.z, 0.13, 0.04, 0.24, 8, 0.95);
  G.box('np_marble', s.x + 0.2, y + 3.05, s.z, 0.12, 0.42, 0.12, 0.6, 0.9);
  G.cyl('np_marble', s.x + 0.32, y + 3.15, s.z + 0.1, 0.15, 0.1, 0.3, 8, 0.9); // the jar
}

/** A Wehrmacht field generator on its two-wheeled trailer, the lever box on its frame (field grey). */
export function buildGenerator(G, s, y) {
  const c = Math.cos(s.rot ?? 0), sn = Math.sin(s.rot ?? 0);
  G.box('np_paint', s.x, y + 0.75, s.z, s.w * 0.85, 0.85, s.d * 0.8, s.rot ?? 0, 0.85);
  G.box('np_iron', s.x - c * s.w * 0.36, y + 0.78, s.z - sn * s.w * 0.36, 0.06, 0.6, s.d * 0.6, s.rot ?? 0, 0.6); // radiator grille
  G.box('np_paint', s.x, y + 1.25, s.z, s.w * 0.9, 0.12, s.d * 0.85, s.rot ?? 0, 0.8);
  for (const k of [-1, 1]) G.cyl('np_iron', s.x - sn * k * s.d * 0.48, y + 0.32, s.z + c * k * s.d * 0.48, 0.32, 0.32, 0.14, 10, 0.6);
  G.cyl('np_iron', s.x + c * s.w * 0.3, y + 1.31, s.z + sn * s.w * 0.3, 0.05, 0.05, 0.5, 6, 0.6); // exhaust
}

/** A ridge tent of field canvas on poles (the motor pool's crew tent). */
export function buildTent(G, s, y) {
  const w = s.w, d = s.d, h = s.h, x = s.x, z = s.z;
  const e = [[x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2], [x + w / 2, y, z + d / 2], [x - w / 2, y, z + d / 2]];
  const r0 = [x, y + h, z - d / 2], r1 = [x, y + h, z + d / 2];
  // both windings: the canvas is seen from outside and, through the open flap, from inside
  for (const [p, tone] of [[[e[0], r0, r1, e[3]], 0.62], [[e[2], r1, r0, e[1]], 0.58]]) { G.quad('np_cloth', ...p, tone); G.quad('np_cloth', p[3], p[2], p[1], p[0], tone * 0.8); }
  for (const [p, tone] of [[[e[1], r0, e[0]], 0.55], [[e[3], r1, e[2]], 0.55]]) { G.tri('np_cloth', ...p, tone); G.tri('np_cloth', p[2], p[1], p[0], tone * 0.8); }
  for (const zz of [z - d / 2, z + d / 2]) G.box('np_timber', x, y + h / 2, zz, 0.06, h, 0.06, 0, 0.7);
}

/** A plank kennel with a pitched roof and a chain staple. */
export function buildKennel(G, s, y) {
  G.box('np_timber', s.x, y + 0.35, s.z, s.w * 0.9, 0.7, s.d * 0.9, 0, 0.8);
  G.box('np_glass', s.x - s.w * 0.45, y + 0.3, s.z, 0.03, 0.45, 0.4, 0, 0.3);
  const r0 = [s.x - s.w / 2, y + 0.7, s.z], r1 = [s.x + s.w / 2, y + 0.7, s.z];
  for (const sz of [-1, 1]) {
    const p = [[s.x - s.w / 2, y + 0.65, s.z + sz * s.d / 2], [s.x - s.w / 2, y + 1.05, s.z], [s.x + s.w / 2, y + 1.05, s.z], [s.x + s.w / 2, y + 0.65, s.z + sz * s.d / 2]];
    G.quad('np_timber', ...p, 0.7); G.quad('np_timber', p[3], p[2], p[1], p[0], 0.6);
  }
  void r0; void r1;
}

/** A Neapolitan handcart: a plank bed on two big wheels, shafts on the ground, a few crates aboard. */
export function buildHandcart(G, s) {
  const rot = s.rot ?? 0, c = Math.cos(rot), sn = Math.sin(rot);
  G.box('np_timber', s.x, 0.7, s.z, s.w * 0.75, 0.08, s.d * 0.9, rot, 0.8);
  for (const k of [-1, 1]) {
    G.cyl('np_timber', s.x - sn * k * s.d * 0.5, 0.0, s.z + c * k * s.d * 0.5, 0.06, 0.06, 0.02, 4, 0.7);
    G.box('np_timber', s.x - sn * k * s.d * 0.48, 0.5, s.z + c * k * s.d * 0.48, 1.0, 1.0, 0.07, rot, 0.6); // wheel (flat disc stand-in)
    G.box('np_timber', s.x + c * s.w * 0.55 - sn * k * 0.35, 0.38, s.z + sn * s.w * 0.55 + c * k * 0.35, 1.3, 0.06, 0.06, rot - 0.45, 0.75); // shafts to the ground
  }
  G.box('np_timber', s.x, 0.92, s.z, 0.6, 0.36, 0.5, rot + 0.2, 0.75);
}

/** A fish stall shut for the night: trestles, a board, crates, an oilcloth thrown over. */
export function buildStall(G, s) {
  G.box('np_timber', s.x, 0.85, s.z, s.w, 0.06, s.d, s.rot ?? 0, 0.75);
  for (const k of [-0.4, 0.4]) G.box('np_timber', s.x + k * s.w, 0.42, s.z, 0.08, 0.84, s.d * 0.9, s.rot ?? 0, 0.6);
  G.box('np_clothB', s.x, 1.05, s.z, s.w + 0.2, 0.3, s.d + 0.2, s.rot ?? 0, 0.55);
  G.box('np_timber', s.x + s.w * 0.25, 0.2, s.z + 0.1, 0.55, 0.4, 0.4, 0, 0.7);
}

/** Rifles leaning against the tram (the insurgents'): a few thin stocks and barrels. */
export function buildRifles(G, s) {
  for (let k = 0; k < 4; k++) {
    const zz = s.z - s.d / 2 + 0.3 + k * (s.d - 0.6) / 3;
    slab3s(G, 'np_timber', [s.x, 0.02, zz], [s.x + 0.32, 1.05, zz + 0.05], 0.05, 0.05);
  }
}

/** Seeded random (the dressing's own; dressing.js rng is the art's). */
function mulberry(a) {
  let t = Math.floor(a * 1000) >>> 0;
  return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
