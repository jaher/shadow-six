/**
 * M10 Operation Icarus (El Agheila, 14 November 1942) second art pass: set dressing, kept in its own module so the
 * mission file only spreads it in (as M16's / M18's). Every piece that blocks stands ≥ 6 m off every guard's post and
 * beat, the barracks squads' runs, the tanks' drives and the dossier's solution walks (the W map-edge run to the
 * compound's NW corner, the decoy at its SW corner, the Sniper's way along the outside of the S wall), and out of the
 * Junkers' take-off sweep (tests/unit/art-m10.test.mjs). What blocks is drawn and what is drawn blocks (the armoured
 * car B.HIGH by its drawn body, the dump's stacks by their library builds, the graves' plot B.LOW).
 *
 * - the airfield: the landing ground drawn on the shelf top at last (art/airstrip.js: its terrain paint lies under the
 *   shelf prism) — the rolled strip with whitewashed edge stones, the Junkers' take-off run and the Stukas' taxi
 *   tracks, the lorries' track up from the ramp head, the canvas landing T by the windsock, oil under the engines
 * - the E field below the escarpment: an SdKfz 231 eight-wheeler caught by the RAF on the way up, burnt out by the
 *   bomb crater that stopped it
 * - outside the apron's E fence: the camp's dump of fuel drums and stores, dispersed in the open out of the sheds' blast
 * - outside the compound's SW corner: the camp's own dead — a small plot of graves with timber crosses and helmets
 */
import { SHELF_Y } from '../missions/scripts/m10.js';

const deg = (d) => (d * Math.PI) / 180;
const FENCE_E = Math.atan2(46, 24); // fence_ap_e's heading (95,106) → (119,152)

/** The landing ground on the shelf (y 5): the decal's extent and what is drawn on it (art/airstrip.js). */
export const M10_AIRSTRIP = {
  area: { x0: 0, x1: 119, z0: 1, z1: 48.5 }, y: SHELF_Y - 0.008, seed: 19421114,
  strip: { z0: 8.5, z1: 26 },   // (its S edge 1 m short of the dugout's N wall)
  tracks: [
    // the Junkers' take-off run from its stand (91, 20) to the W edge (its exit (6, 14)): main wheels + tail wheel
    { pts: [[96, 20], [84, 19.6], [60, 17.6], [30, 15], [0, 13.4]], gauge: 5.4, w: 0.5, a: 0.34 },
    { pts: [[103, 20], [84, 19.6], [60, 17.6], [30, 15], [0, 13.4]], gauge: 0, w: 0.28, a: 0.16 },
    // older landing and take-off runs along the strip, fainter
    { pts: [[119, 16.2], [80, 16.8], [40, 16.4], [0, 15.6]], gauge: 5.4, w: 0.45, a: 0.16 },
    { pts: [[119, 22.6], [70, 22.2], [30, 21.6], [0, 21.8]], gauge: 3.1, w: 0.38, a: 0.18 },
    { pts: [[119, 24.6], [90, 25.2], [50, 24.4], [0, 23.6]], gauge: 3.1, w: 0.38, a: 0.12 },
    // the Stukas' taxi tracks from the strip to their stands (each stands nose to the strip)
    { pts: [[86, 25.5], [92, 27.5], [95.2, 31], [96.6, 35.5]], gauge: 3.1, w: 0.4, a: 0.3 },
    { pts: [[101, 24.5], [107, 26], [110.2, 29], [110.8, 33]], gauge: 3.1, w: 0.4, a: 0.3 },
    // the lorries: up the shelf road from the ramp head to the strip, and along the rim to the bomb dump and the bowser
    { pts: [[73.4, 48.2], [76.2, 45.6], [79.8, 38.5], [84, 30], [88.5, 26.6]], gauge: 1.8, w: 0.32, a: 0.3 },
    { pts: [[79.8, 38.5], [88, 40.4], [100, 40.6], [110, 39.7], [115.4, 40.8]], gauge: 1.8, w: 0.3, a: 0.24 },
    // the dugout's Kubelwagen to the strip
    { pts: [[8.5, 38.6], [9.2, 33], [13, 29], [22, 27.6]], gauge: 1.4, w: 0.26, a: 0.22 },
  ],
  stones: { every: 20, len: 2.4 },
  // the landing T beside the strip's N edge by the windsock (116, 4.5): its stem along the run, the bar at the W end
  landingT: { x: 103.5, z: 5.2, len: 7.5, span: 6, w: 1.3 },
  stains: [[84.2, 20, 1.6, 0.3], [86.4, 14.6, 1.3, 0.26], [86.4, 25.4, 1.3, 0.26], [95.6, 34.4, 1.1, 0.24], [110.6, 31, 1.1, 0.24], [115.4, 41.6, 1.5, 0.28]],
};

export const M10_DRESSING = [
  // --- the E field: the armoured car the RAF caught on its way up the road, burnt out beside the bomb crater
  { id: 'wreck_sdkfz', type: 'crates', variant: 'armoured_car_wreck', label: 'Burnt-out armoured car', x: 104.6, z: 81.2, rot: deg(-28),
    w: 5.9, d: 2.2, h: 2.35, block: 2, vehicleArt: 'sdkfz231_8rad', wreck: true, fixed: true },
  { id: 'crater_e', type: 'crater', x: 110.6, z: 78, r: 2.4 }, // (6.8 m ahead of it: its rim and clods (1.5 r) clear of the hull)
  // --- outside the apron's E fence (6–8 m off it): the camp's dump, dispersed in the open
  { id: 'dump_stores_e', type: 'crates', variant: 'supply_dump_desert', label: 'Supplies', asset: 'supply_dump_desert_b', nav: false, x: 108.4, z: 115.6, rot: FENCE_E,
    w: 3.2, d: 1.4, h: 1.2, block: 2, fixed: true },
  { id: 'dump_drums_e', type: 'barrels', variant: 'fuel_drum_stack', label: 'Fuel drums', asset: 'drum_stack_ms', nav: false, x: 110.6, z: 121.2, rot: FENCE_E,
    w: 2, d: 1.2, h: 1.8, block: 2, fixed: true }, // (B.HIGH: a 2 m stack hides a man, as M11's)
  { id: 'dump_crates_e', type: 'crates', variant: 'crate_stack', label: 'Stores', asset: 'crate_stack_ms_d', nav: false, x: 113.6, z: 127.6, rot: FENCE_E,
    w: 2.4, d: 2.6, h: 2.2, block: 2, fixed: true },
  // --- outside the compound's SW corner: the camp's graves (rows along the camp's grid, crosses at the N end)
  { id: 'graves_sw', type: 'crates', variant: 'field_graves', label: 'Graves', x: 11.6, z: 202.4, rot: deg(333), w: 6, d: 5.6, h: 1.2,
    block: 1, fixed: true, cols: [3, 4] },
];
