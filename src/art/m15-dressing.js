/**
 * M15 The End of the Butcher (Compiègne, 26 August 1944) second art pass: set dressing, kept in its own module so the
 * mission file (tuned by the M15 gameplay and solution work) only spreads it in. Every piece stands on a rule-clean
 * spot: ≥ 1.5 m off every ground-level beat, patrol and the scripted solution's walks (tools/solutions/m15.solution.mjs;
 * tests/unit/art-m15.test.mjs), clear of posts, starts and the vehicles' drives. What blocks is drawn and what is
 * drawn blocks (B.LOW heaps, tombs, the handcart; the parked Kübelwagen and the R75 by their drawn bodies).
 *
 * - the burned-out house (S ruins): its upper floors lie in brick heaps against the W wall and at the open S end,
 *   charred joists run out of them (art/brick-rubble.js)
 * - the S street by the shattered garden wall stub: the bricks swept into a heap, a handcart left by the clearers
 * - the E square by the park: a despatch riders' stand of the Feldkommandantur — a Kübelwagen with its hood up and an
 *   R75 combination parked on the setts
 * - the W basin: a rowing boat moored along its wall (W1 has no stairs: nobody's water, so it is drawn only)
 * - the cemetery: more graves (chest tombs) in the open W strip, the N row run on to the W and a middle row under the
 *   chapel, so the rows read as a town cemetery and not three scattered stones
 */
const deg = (d) => (d * Math.PI) / 180;
const heap = (id, x, z, w, d, h, rot) => ({ id, type: 'ruins', variant: 'brick_heap', x, z, w, d, h, rot: deg(rot), block: 1, fixed: true });
const tomb = (id, x, z, rot = 15) => ({ id, type: 'crates', variant: 'sarcophagus', x, z, rot: deg(rot), w: 2, d: 1, h: 1.1 });

export const M15_DRESSING = [
  // --- the burned-out house (walls (5,123)–(24,139)): heaps against the W wall and at the open S end
  heap('heap_ruin_w', 7.6, 136.1, 4, 2.6, 0.85, 90),
  heap('heap_ruin_s', 13.6, 137.6, 3, 1.8, 0.7, 0),
  heap('heap_ruin_nw', 6.6, 129.6, 2.6, 1.6, 0.6, 90),
  // --- the S street: the garden wall stub's bricks swept into a heap, and the clearers' handcart
  heap('heap_stub', 51.6, 136.4, 3.6, 2.2, 0.75, 20.56),
  { id: 'cart_stub', type: 'crates', variant: 'handcart', asset: 'handcart_wood', x: 55.9, z: 134.4, rot: deg(-25), w: 1.9, d: 1.4, h: 1, block: 1, fixed: true },
  // --- the E square: the Feldkommandantur's despatch riders' stand (by the Morris column, off the p10 round)
  { id: 'kubel_esq', type: 'crates', variant: 'parked_car', x: 77.3, z: 105.0, rot: deg(279.4), w: 3.8, d: 1.6, h: 1.6, block: 1, vehicleArt: 'kubelwagen', paint: 'grey_top', fixed: true },
  { id: 'r75_esq', type: 'crates', variant: 'parked_motorcycle', x: 79.6, z: 104.0, rot: deg(279.4), w: 2.4, d: 1.7, h: 1.1, block: 1, vehicleArt: 'r75_sidecar', fixed: true },
  // --- the W basin (walled all round, no stairs: nobody's water): a rowing boat moored along its E quay (drawn only)
  { id: 'boat_w1', type: 'crates', variant: 'boat_moored', x: 8.2, z: 97.5, rot: deg(98.79), w: 4, d: 1.8, h: 0.6, block: 0, fixed: true,
    vehicleArt: 'rowboat', vehicleArtHide: ['oar_l', 'oar_r'], vehicleArtY: -0.12 },
  // --- the cemetery: the N row on to the W, the open W strip inside the railing, a middle row S of the chapel
  ...[50.2, 52.7, 55.2].map((x, k) => tomb(`tomb_nw${k + 1}`, x, 1.2)),
  tomb('tomb_ws1', 47.1, 9.4, 105), tomb('tomb_ws2', 45.9, 16.4, 105),
  ...[64.6, 67.1].map((x, k) => tomb(`tomb_m${k + 1}`, x, 16.3)),
];
