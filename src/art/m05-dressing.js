/**
 * M5 Blind Justice (Herdla, May 1941) art pass 2: set dressing, kept in its own module so the mission file (tuned by the
 * M5 solution work) only spreads it in. Every piece stands on a rule-clean spot ≥ 3.5 m off the solution's recorded
 * trail (tools/solutions/m05.solution.mjs, browser run), ≥ 3 m off every patrol beat, post, start and alarm route and
 * clear of the trees and other structures; what blocks is drawn and what is drawn blocks (tests/unit/art-m05.test.mjs).
 *
 * - behind the start house: the farm's stabbur on its posts (stabbur_no, the M1 Sola kit with its snow twin) in the
 *   clearing between the spruces north of the round-pole fence;
 * - in the village square between h2, h3 and h4: the village well (the kit's fieldstone well, its windlass under a
 *   shingle roof), clear of e5's beat and pm's N end;
 * - on the summit (y 16: lifted by scripts/m05.js and cut out of the plateau walkways like every summit footprint, so
 *   nobody walks through them): the autogyro's windsock on the open snow west of its parking spot, and granite
 *   outcrops round it by the west rim above the valley, where no beat or route runs.
 */
const deg = (d) => (d * Math.PI) / 180;

/** Ground-level pieces (the mission spreads them into its structures). */
export const M05_DRESSING = [
  { id: 'stabbur', type: 'hut', variant: 'stabbur', asset: 'stabbur_no', x: 21.2, z: 7, rot: deg(328), w: 4, d: 3.5, h: 4.6, nav: false, fixed: true },
  { id: 'well_v', type: 'well', x: 25, z: 52.5, rot: deg(328), r: 0.8, h: 0.9, block: 1, fixed: true },
];

/** Summit pieces (the mission spreads them into SUMMIT: walkway holes, lifted to y 16). */
export const M05_SUMMIT = [
  { id: 'windsock_top', type: 'crates', variant: 'vehicle_parked', label: 'Windsock', vehicleArt: 'windsock', x: 68, z: 22, rot: 0, w: 0.6, d: 0.6, h: 6, block: 1, fixed: true },
  // (half as high as they are long: low granite domes whose flanks show bare rock under the snow caps; in the band the
  // default camera shows of the summit — its north strip, z < ~18, stays above the top of the view at every zoom, and the
  // top station's roof hides the ~10 m north of it — and off the way round the station's north corner)
  ...[[62.2, 18.5, 3.4, 2.8, 1.8, 60], [62.6, 26.2, 3.6, 2.8, 2, -30], [73.5, 20.5, 3.2, 2.6, 1.6, 20]]
    .map(([x, z, w, d, h, r], k) => ({ id: `rock_top_${k + 1}`, type: 'rocks', x, z, rot: deg(r), w, d, h, fixed: true })),
];
