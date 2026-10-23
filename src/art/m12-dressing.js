/**
 * M12 Up on the Roof (Tunis, March 1943) second art pass: set dressing kept in its own module so the mission file
 * (tuned by the M12 gameplay / solution work) only spreads it in. Every piece stands where nobody goes: the back yards
 * no street reaches, the quay's east yard ≥ 5 m off every route the solution (tools/solutions/m12.solution.mjs) and
 * the guards walk, clear of every post, ladder, stair and the car's drive (tests/unit/art-m12.test.mjs). What blocks is
 * drawn and what is drawn blocks (crates / carts / drums B.LOW, the lorry B.HIGH, palms a LOW trunk).
 *
 * - the harbour warehouse's back yard (x 0–20, z 16–37, walled in by the warehouse and the medina blocks): its loading
 *   yard, paved, with a handcart, sacks, a drum stack, a crate stack and a date palm in the corner
 * - the basin's east quay (x 46–58, z 50–82, under plank P2, shut off by the blind wall and the mosque platform):
 *   paved, with the fishermen's tarp stack, sacks, baskets and barrels against the houses
 * - the harbour command's east yard (x 64–76, z 86–98): a parked Opel Blitz, its fuel drums and a crate stack
 * @module art/m12-dressing
 */
const deg = (d) => (d * Math.PI) / 180;
const goods = (id, variant, x, z, w, d, h, rot = 0) => ({ id, type: 'crates', variant, x, z, rot, w, d, h, block: 1, fixed: true });

/** Ground pieces (y 0). */
export const M12_DRESSING = [
  // --- the warehouse's back yard (unreachable: the warehouse, house_nw, mid_block, w_block_rear and house_tile close it)
  { id: 'yard_cart', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: 7.6, z: 23.8, rot: deg(110), w: 1.9, d: 1.4, h: 1, block: 1, fixed: true },
  goods('yard_sacks', 'crates_sacks', 2.6, 33.4, 3, 2.4, 1.4),
  { id: 'yard_drums', type: 'barrels', variant: 'fuel_drum_stack', x: 1.9, z: 24.4, rot: 0, w: 2.8, d: 2.1, h: 1.9, block: 1, asset: 'drum_stack_ms', fixed: true },
  { id: 'yard_crates', type: 'crates', variant: 'crate_stack', x: 15.2, z: 19.6, rot: 0, w: 3.4, d: 3.4, h: 2.2, block: 2, asset: 'crate_stack_ms_d', fixed: true },
  goods('yard_bales', 'bale_cart', 6.8, 31.6, 2.6, 1.6, 1.6, deg(-90)), // (shafts N, square to the yard)
  { id: 'yard_palm', type: 'palm', variant: 'date_palm', x: 4.3, z: 28.2, r: 0.35, h: 8, seed: 1201, fixed: true },
  // --- the basin's east quay (unreachable: the blind wall N, the houses E, the mosque platform S, the water W)
  goods('eq_tarp', 'tarp_stack', 53.6, 55.2, 2.4, 1.8, 1.0, deg(90)),
  goods('eq_sacks', 'crates_sacks', 56.1, 59.4, 2.4, 2.0, 1.3, deg(90)),
  goods('eq_basket1', 'basket', 54.1, 58.2, 0.8, 0.8, 0.8),
  goods('eq_basket2', 'basket', 53.2, 57.6, 0.8, 0.8, 0.8),
  ...[[54.2, 72.6], [54.3, 73.5], [53.55, 73.05]].map(([x, z], k) => ({ id: `eq_barrel${k + 1}`, type: 'barrels', variant: 'barrel_wood', x, z, r: 0.35, h: 0.9, block: 1, fixed: true })),
  // --- the harbour command's east yard (E of the arcade house, S of house_e3): its lorry, fuel and stores
  { id: 'truck_e', type: 'crates', variant: 'truck_parked', label: 'Truck', x: 72.2, z: 89.4, rot: 0, w: 6, d: 2.3, h: 2.6, block: 2, vehicleArt: 'opel_blitz_cargo', fixed: true },
  { id: 'drums_e', type: 'barrels', variant: 'fuel_drum_stack', x: 66.4, z: 88.8, rot: 0, w: 2.8, d: 2.1, h: 1.9, block: 1, asset: 'drum_stack_ms', fixed: true },
  { id: 'crates_e', type: 'crates', variant: 'crate_stack', x: 73.2, z: 95.0, rot: 0, w: 3.5, d: 3.9, h: 2.2, block: 2, asset: 'crate_stack_ms_c', fixed: true },
];

/** Paving for the two back yards (visual only, grid: false: the nav keeps its codes); edges run under the wall bases. */
export const M12_PAVEMENTS = [
  { id: 'pave_yard', surface: 'setts', points: [[-6, 19.6], [10.4, 19.6], [10.4, 15.6], [20.4, 15.6], [20.4, 26.4], [10.4, 26.4], [10.4, 37.4], [-6, 37.4]],
    wear: 0.75, weeds: 0.45, cracks: 0.35, patches: 0, puddles: 0, grid: false },
  // the NE corner N of house_e1 / E of the terrace (its palms' yard) and the slot between the souk and house_e1
  { id: 'pave_ne', surface: 'setts', points: [[61.6, -8], [84, -8], [84, 22.4], [61.6, 22.4]], wear: 0.75, weeds: 0.45, cracks: 0.35, patches: 0, puddles: 0, grid: false },
  { id: 'pave_alley_e', surface: 'setts', points: [[55.1, 20.6], [61.6, 20.6], [61.6, 22.4], [65.4, 22.4], [65.4, 38.6]], wear: 0.8, weeds: 0.5, cracks: 0.35, patches: 0, puddles: 0, grid: false },
  { id: 'pave_eq', surface: 'setts', points: [[52, 52.4], [58, 50], [58.4, 50], [58.4, 66.4], [55.4, 66.4], [55.4, 83.2], [54.8, 83.2], [45.7, 67.3], [46, 67], [50, 60]],
    wear: 0.7, weeds: 0.4, cracks: 0.35, patches: 0, puddles: 0.05, grid: false, quay: { edges: [8, 9], bollards: 6, rings: true } },
];
