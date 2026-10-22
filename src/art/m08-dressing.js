/**
 * M8 Pyrotechnics (Tell el Eisa, October 1942) second art pass: set dressing kept in its own module so the mission
 * file (tuned by the M8 gameplay / solution work) only spreads it in. Everything stands on rule-clean spots: ≥ 1.5 m
 * off every route the solution (tools/solutions/m08.solution.mjs) and the guards walk, clear of every post, ladder,
 * climb link and the jeep's drive (tests/unit/art-m08.test.mjs). What blocks is drawn and what is drawn blocks:
 * crates and stubs B.LOW, the wreck B.HIGH, palms a LOW trunk; the plateau pieces get walkway holes (PLATEAU_HOLES)
 * so their cells keep their block under the 4 m shelf's walkway strips, and are lifted to y 4 by scripts/m08.js.
 *
 * - the plateau: the 210 mm gun's ammunition (Afrika Korps shell / charge boxes, the M9 desert library stacks) in the
 *   NE corner behind the gun pit; a fallen roof's beams and planks in a ruined yard
 * - the SE yard below the S tank: a date-palm garden of the village (three palms, a broken mud-brick garden wall; the
 *   dossier's rubble_se becomes its fallen corner, in the mission file)
 * - the E desert beyond the wadi: a burnt-out Opel Blitz strafed on the track, and two outcrops
 * @module art/m08-dressing
 */
const deg = (d) => (d * Math.PI) / 180;

/** Plateau pieces (y 4): [structure, hole w, hole d] — the hole is the footprint + 0.2 m all round. */
export const M08_PLATEAU_DRESSING = [
  { id: 'ammo_g1', type: 'crates', variant: 'ammo_boxes', asset: 'ammo_boxes_bq_a', label: 'Ammunition', x: 67.6, z: 3.4, rot: 0, w: 2, d: 2.3, h: 1.1, block: 1, fixed: true },
  // a fallen palm-log roof in the yard inside rw5 / rw6 (nobody's beat crosses it: the N lane runs S of rw5)
  { id: 'roof_fall', type: 'crates', variant: 'timber_debris', x: 16, z: 11.6, rot: deg(20), w: 2.6, d: 1.6, h: 0.5, block: 1, fixed: true },
  { id: 'ammo_g2', type: 'crates', variant: 'ammo_boxes', asset: 'ammo_boxes_bq_b', label: 'Ammunition', x: 70.6, z: 4.6, rot: 0, w: 2, d: 2.3, h: 1.1, block: 1, fixed: true },
];

/** Ground pieces (y 0). */
export const M08_DRESSING = [
  // --- the village's date-palm garden in the SE yard (breathing room: ≥ 7 m from the houses and e21 / e22's beats)
  ...[[59.5, 84.5, 8], [64, 89, 7], [66.5, 82.5, 9]].map(([x, z, h], k) => ({ id: `palm_se${k + 1}`, type: 'palm', variant: 'date_palm', x, z, r: 0.35, h, seed: 841 + k, fixed: true })),
  // its broken mud-brick garden wall, square to wire_e (alignment): the N run (S of tank_b's ladder, ≥ 3.5 m off its
  // foot) and the E run (≥ 2 m inside wire_e)
  { id: 'gwall_se1', type: 'ruins', variant: 'ruins_mudbrick_low', mat: 'stone', x: 61.4, z: 82, rot: deg(8.13), w: 6, d: 0.6, h: 1.1, block: 1, fixed: true },
  { id: 'gwall_se2', type: 'ruins', variant: 'ruins_mudbrick_low', mat: 'stone', x: 68.7, z: 85.2, rot: deg(98.13), w: 4.6, d: 0.6, h: 0.9, block: 1, fixed: true },
  // --- the E desert: a lorry strafed on the track, pushed off it and burnt out; two outcrops
  { id: 'wreck_e', type: 'crates', variant: 'lorry_wreck_burnt', label: 'Burnt-out lorry', x: 108.8, z: 44, rot: deg(72), w: 6.2, d: 2.3, h: 2.2, block: 2,
    vehicleArt: 'opel_blitz_cargo', wreck: true, fixed: true },
  { id: 'rocks_e1', type: 'rocks', x: 103.8, z: 74, r: 1.2, h: 0.9, block: 1, fixed: true },
  { id: 'rocks_e2', type: 'rocks', x: 109.6, z: 19, r: 1.0, h: 0.8, block: 1, fixed: true },
];
