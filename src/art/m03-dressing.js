/**
 * M3 Reverse Engineering (Sysendam, Eidfjord, March 1941) art pass: set dressing, kept in its own module so the
 * mission file (tuned by the M3 gameplay work) only spreads it in. Everything here is visual-first and stands on
 * rule-clean spots: ≥ 1.5 m off every route the solution (tools/solutions/m03.solution.mjs) and the guards walk,
 * clear of every post, cone-critical sight line and start (tests/unit/art-m03.test.mjs). What blocks is drawn and
 * what is drawn blocks (B.LOW piles, drums and carts, the farm's stabbur B.HIGH and skigard B.FENCE).
 *
 * - the station: a crate stack by the shed apron, firewood against the barracks' E gable, a parked Opel Blitz
 * - the E-bank camp: firewood piles against three cabins, a handcart off the camp track, a fuel-drum stack by the garrison cabin
 * - the S bank below the station (no route reaches it): a farm tun — the dwelling house (house_timber_b), a log byre
 *   (log_cabin_a), a stabbur on its posts (stabbur_no, the M1 Sola kit: tools/blender/norway/scripts/sola.py, its snow
 *   twin without ground drifts), firewood, a roundpole skigard field fence (art/skigard.js)
 *   from the station fence to the river bank, pines and boulders
 */
const deg = (d) => (d * Math.PI) / 180;
const logs = (id, x, z, r) => ({ id, type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', x, z, rot: deg(r), w: 3, d: 1.5, h: 1, block: 1, fixed: true });

export const M03_DRESSING = [
  // --- the power station (S bank)
  { id: 'crates_apron', type: 'crates', x: 34.6, z: 88.6, rot: deg(0), w: 2.2, d: 1.4, h: 1.2, block: 1, fixed: true },
  logs('logs_barr1', 23.0, 82, 90),
  // an Opel Blitz parked in the yard's SE corner between the second barracks and the fence (the escape lorry's model)
  { id: 'lorry_st', type: 'crates', variant: 'parked_lorry', x: 64.5, z: 119, rot: deg(90), w: 6.2, d: 2.3, h: 2.2, block: 2, vehicleArt: 'opel_blitz_cargo', fixed: true },
  // --- the German camp (E bank)
  logs('logs_cab1', 108, 58.1, 0), logs('logs_cab3', 133, 67.1, 0), logs('logs_cab4', 132, 77.8, 0),
  { id: 'cart_camp', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: 129.6, z: 76, rot: deg(30), w: 1.9, d: 1.4, h: 1, block: 1, fixed: true },
  { id: 'drums_camp', type: 'crates', variant: 'fuel_drums', x: 128.7, z: 57, rot: deg(90), w: 3.0, d: 1.4, h: 1.6, block: 1, fixed: true },
  // --- the farm on the S bank below the station (a tun: dwelling house, log byre and stabbur round a yard
  //     open to the river, its roundpole skigard field fence N from the station fence down to the bank)
  { id: 'farm_house', type: 'house', variant: 'timber_2storey', asset: 'house_timber_b', x: 85, z: 124, rot: 0, w: 9, d: 7, h: 8, snowRoof: true, enterable: false, fixed: true },
  { id: 'farm_byre', type: 'hut', variant: 'log_cabin', asset: 'log_cabin_a', x: 92.5, z: 113, rot: 0, w: 8, d: 4.1, h: 4.4, snowRoof: true, fixed: true },
  { id: 'stabbur', type: 'hut', variant: 'stabbur', asset: 'stabbur_no', x: 98.5, z: 123, rot: deg(-8), w: 4, d: 3.5, h: 4.6, nav: false, fixed: true },
  logs('logs_farm', 98.5, 113.6, 0),
  { id: 'skigard', type: 'fence', variant: 'skigard', points: [[70.6, 113.5], [79, 108.5], [90, 105.5], [100, 105.5]], h: 1.25, width: 0.3 },
  { id: 'rocks_farm1', type: 'rocks', x: 104.5, z: 111.5, r: 1.3, h: 1.0, block: 1 },
  { id: 'rocks_farm2', type: 'rocks', x: 76.5, z: 104, r: 1.1, h: 0.9, block: 1 },
  ...[[74.5, 120.5], [73.5, 128.5], [110.5, 127.5], [114.5, 130.5], [84, 100.5]].map(([x, z], k) => ({ id: `pine_farm${k + 1}`, type: 'pine', x, z, r: 0.6, h: 9 + (k % 4), seed: 431 + k })),
];
