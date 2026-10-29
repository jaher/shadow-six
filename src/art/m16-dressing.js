/**
 * M16 Stop Wildfire (the Maas bridge north of Liège, 4 September 1944) second art pass: set dressing, kept in its own
 * module so the mission file (tuned by the M16 gameplay and solution work) only spreads it in. Every piece stands on a
 * rule-clean spot: ≥ 6 m off every guard's post and beat and the scripted solution's walks, drives and lines of fire
 * (tools/solutions/m16.solution.mjs; tests/unit/art-m16.test.mjs), ≥ 8 m off the start. What blocks is drawn and what
 * is drawn blocks (the lorry B.HIGH by its drawn body, the log piles, cart, drums, crates
 * and each wheat stook B.LOW, the picket fence B.FENCE: it stops feet, not eyes).
 *
 * - the NW town: the farmhouse nw_h3's picket-fenced kitchen garden off its E corner (between the house and the tent
 *   camp), the gate on the house side standing open, a handcart left by it; cordwood against the house's NE gable;
 *   setts in front of the garrison's door (nw_grey)
 * - the E village: setts round the fountain (visual only: Patrol 11 walks the square; the village and its farm have
 *   no free ground off the beats and the NE road for anything that blocks)
 * - the tent camp: the company's Opel Blitz parked on the grass N of the tents, its fuel drums and a stack of stores
 * - the bridge island: the sappers' boat drawn up on the S beach, keel up, and a drum of firing cable by the hut
 * - the fields SE of the village: the wheat is in — three rows of stooks drying on the stubble by the map's S edge
 */
import { stookNavParts } from './stook-layout.js';

const deg = (d) => (d * Math.PI) / 180;
/** A point in a frame (+x along `rot`, +z its door side) → world [x, z]. */
const local = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) - lz * Math.sin(rot), cz + lx * Math.sin(rot) + lz * Math.cos(rot)];
const R45 = deg(-45);
const logs = (id, [x, z], rot, o = {}) => ({ id, type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x, z, rot, w: 3, d: 1.5, h: 1, block: 1, fixed: true, ...o });

// --- the NW town: nw_h3's kitchen garden off the farmhouse's E corner (frame G, square to the house)
const G = [40.3, 4.3], GW = 4.8, GD = 3.4;
const g = (lx, lz) => local(G[0], G[1], R45, lx, lz);
/** The picket fence round the garden, open for the gate at the SW end (towards the house). */
export const GARDEN_FENCE = [g(-GW / 2, 0.55), g(-GW / 2, GD / 2), g(GW / 2, GD / 2), g(GW / 2, -GD / 2), g(-GW / 2, -GD / 2), g(-GW / 2, -0.55)];
/** The garden's dug beds (bare earth, terrain only). */
export const GARDEN_BEDS = [g(-GW / 2 + 0.4, -GD / 2 + 0.4), g(GW / 2 - 0.4, -GD / 2 + 0.4), g(GW / 2 - 0.4, GD / 2 - 0.4), g(-GW / 2 + 0.4, GD / 2 - 0.4)];
const stooks = (id, x, z, w) => {
  const p = { id, type: 'crates', variant: 'wheat_stooks', label: 'Wheat stooks', x, z, rot: 0, w, d: 1.3, h: 1.25, block: 1, fixed: true };
  return { ...p, navParts: stookNavParts(p) };
};

export const M16_DRESSING = [
  // --- the NW town
  { id: 'garden_fence', type: 'fence', variant: 'picket_garden', points: GARDEN_FENCE, h: 1.05, width: 0.3 },
  // the gate leaf, hung on the S post and swung 70° into the garden
  { id: 'garden_gate', type: 'fence', variant: 'picket_gate', points: [g(-GW / 2, 0.5), g(-GW / 2 + 0.94, 0.16)], h: 1.05, width: 0.3,
    clipAllow: ['garden_fence'] },
  { id: 'cart_garden', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: g(-GW / 2 - 1.8, 2.4)[0], z: g(-GW / 2 - 1.8, 2.4)[1], rot: deg(-75),
    w: 2, d: 1.2, h: 1, block: 1, fixed: true },
  // its beds of cabbages (ankle-high: no cover, block 0), clear of the gate's swing
  { id: 'garden_beds', type: 'crates', variant: 'garden_beds', label: 'Kitchen garden', x: g(0.55, 0)[0], z: g(0.55, 0)[1], rot: R45, w: GW - 1.6, d: GD - 0.6, h: 0.4, block: 0, fixed: true,
    clipAllow: ['garden_fence', 'garden_gate'] },
  logs('logs_h3', local(30, 6.5, R45, 5.35, 0), deg(45)),
  // --- the tent camp: the company's lorry, fuel and stores N of the tents
  { id: 'lorry_camp', type: 'crates', variant: 'parked_lorry', x: 64, z: 6.2, rot: deg(-25), w: 6.2, d: 2.3, h: 2.2, block: 2, vehicleArt: 'opel_blitz_cargo', fixed: true },
  { id: 'drums_camp', type: 'crates', variant: 'fuel_drums', x: 58.6, z: 3.2, rot: deg(-25), w: 3.0, d: 1.4, h: 1.6, block: 1, fixed: true },
  { id: 'crates_camp', type: 'crates', variant: 'crate_stack', label: 'Stores', x: local(64, 6.2, deg(-25), -5.4, 0.4)[0], z: local(64, 6.2, deg(-25), -5.4, 0.4)[1],
    rot: deg(-25), w: 2.2, d: 1.6, h: 1.4, block: 1, fixed: true },
  // --- the bridge island
  { id: 'boat_isl', type: 'crates', variant: 'boat_beached_overturned', x: 44.2, z: 101.6, rot: deg(-4), w: 4, d: 1.8, h: 1, block: 1, fixed: true,
    vehicleArt: 'rowboat', vehicleArtHide: ['oar_l', 'oar_r'] },
  { id: 'drum_isl', type: 'crates', variant: 'cable_drum', label: 'Firing cable', x: 48.2, z: 98.6, rot: deg(-30), w: 1.3, d: 1.1, h: 1.3, block: 1, fixed: true },
  // --- the harvested fields by the S edge: three rows of stooks
  stooks('stooks_a', 167, 142.9, 15),
  stooks('stooks_b', 185.5, 142.9, 15),
  stooks('stooks_c', 173, 145.6, 15),
];

/** Setts in front of the town garrison's door (nw_grey) and round the village fountain (visual only). */
const F = (lx, lz) => local(178.2, 95.8, R45, lx, lz);
export const M16_PAVEMENTS = [
  { id: 'pave_fountain', surface: 'belgian', points: [F(-4.5, -3.2), F(-3.2, -4.5), F(3.2, -4.5), F(4.5, -3.2), F(4.5, 3.2), F(3.2, 4.5), F(-3.2, 4.5), F(-4.5, 3.2)],
    wear: 0.6, weeds: 0.45, cracks: 0.3, puddles: 0.15, edge: 'ragged', grid: false },
  { id: 'pave_grey', surface: 'belgian', points: [local(17, 16.5, R45, -4.4, 4.1), local(17, 16.5, R45, 4.4, 4.1), local(17, 16.5, R45, 4.4, 8.6), local(17, 16.5, R45, -4.4, 8.6)],
    wear: 0.6, weeds: 0.5, cracks: 0.3, puddles: 0.1, edge: 'ragged', grid: false },
];

/** The garden's dug beds (terrain). */
export const M16_TERRAIN = [{ type: 'poly', terrain: 'ground', points: GARDEN_BEDS }];
