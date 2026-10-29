/**
 * M6 Menace of the Leopold (Masi, Finnmark, May 1941) second art pass: set dressing, kept in its own module so the
 * mission file (tuned by the M6 gameplay and solution work) only spreads it in. Every piece stands on a rule-clean spot
 * (tests/unit/art-m06.test.mjs): ≥ 1.5 m off every beat, patrol, garrison exit / alarm loop and the armoured car's road,
 * ≥ 3 m off every post, and nowhere near the ways in the scripted solution takes (the W field, the S edge, the E side,
 * the gun corridor and the NE corner) — all of it in the compound's N half, at the HQ and by the chapel.
 * What blocks is drawn and what is drawn blocks (B.LOW piles, drums and timber; the parked lorry by its drawn body).
 *
 * - the central barracks (a log house): its stove wood stacked along the W gable
 * - the HQ: a fuel-drum cluster under the lean-to canopy against its W wall, by its cordwood (inside the canopy's LOW
 *   footprint, so the walk grid round it is unchanged)
 * - the tent lines: the cookhouse stores (crates and a drum cluster) between the tents and the S compound
 * - the S wedge of the "X" walls N of the barracks, out of the wind: the base's Opel Blitz parked across it, and the
 *   building timber it brought stacked beside it (the Sola timber stack)
 * - the chapel: an open woodshed with its cordwood NE of the tower
 */
const deg = (d) => (d * Math.PI) / 180;
const logs = (id, x, z, r, o = {}) => ({ id, type: 'crates', variant: 'log_pile', asset: 'log_pile_stack', label: 'Firewood', x, z, rot: deg(r), w: 3, d: 1.5, h: 1,
  block: 1, fixed: true, ...o });
/** A three-drum cluster (the drum kit draws 1.2 × 1.1 m: the LOW block is drawn to that). */
const drums = (id, x, z, r, o = {}) => ({ id, type: 'barrels', variant: 'fuel_drums', label: 'Fuel drums', x, z, rot: deg(r), w: 1.3, d: 1.2, h: 0.9, block: 1,
  fixed: true, ...o });

export const M06_ART2 = [
  // --- the central barracks (barr_c, x 52–66; its alarm loop runs round the other three sides): stove wood stacked
  //     along the W gable, a 1.55 m aisle off the logs (clear of the sod roof's verge: seen from the default camera)
  logs('logs_barr', 49.7, 49.0, 90),
  // --- the HQ lean-to (x 76–81, z 77.5–82.5, against the HQ's W wall; its own build stacks cordwood along its back):
  //     a fuel-drum cluster at its S front
  drums('fuel_hq', 77.4, 81.3, 0, { clipAllow: ['hq_leanto'] }),
  // --- the S wedge of the X (walls ≥ 2.2 m off its sides, p3's beat 2.9 m S of its tail): the base lorry parked
  //     across it, and the timber stack W of it
  { id: 'lorry_x', type: 'crates', variant: 'parked_lorry', label: 'Truck', x: 58.0, z: 35.0, rot: deg(0), w: 6.2, d: 2.3, h: 2.2, block: 2,
    vehicleArt: 'opel_blitz_cargo', fixed: true },
  { id: 'timber_x', type: 'crates', variant: 'timber_stack', asset: 'timber_stack_no', label: 'Timber', x: 51.7, z: 35.6, rot: 0, w: 2.8, d: 2.2, h: 0.6,
    block: 1, fixed: true },
  // --- the tent lines: the cookhouse stores on the island the p2 patrol walks round (≥ 2.8 m off its beat and the
  //     barracks' alarm loop, 9 m off e18's post): a crate stack and a drum cluster, LOW (cover, see-through)
  { id: 'crates_ck', type: 'crates', label: 'Crates', x: 58.6, z: 66.4, rot: 0, w: 2, d: 2, h: 1.2, block: 1, fixed: true },
  drums('fuel_ck', 61.4, 65.8, 0),
  // --- the chapel's woodshed NE of its tower (≥ 13 m off every beat and post: nobody's ground; 2.6 m W of pine (92,7)):
  //     the Masi lean-to on its own, its cordwood stacked along the back and crates under the roof (its own build), LOW
  //     like its footprint
  { id: 'shed_ch', type: 'hut', variant: 'woodshed_open', asset: 'lean_to_canopy', label: 'Woodshed', x: 88.0, z: 3.4, rot: 0, w: 4.6, d: 4.5, h: 3, block: 1,
    fixed: true },
];
