/**
 * BEL Mission 20 — "Operation Valhalla" (buildable layout: docs/missions/m20.md). Owned by MISSIONS.
 * Gundelfingen castle, north of Freiburg, 11 February 1945: the campaign's last mission and the only one with all
 * six men. An octagonal fortress on a crag, its floor stepping down from the château HQ (NW, y 13) through the
 * terraces and a continuous wall walk (y 7) to the courts. The Green Beret and the Spy start behind a rock under
 * the W wall (the castle's single climb spot); the Sniper, Marine, Sapper and Driver in the E fields. Blow up the
 * HQ (Sapper's charges only), destroy both V2s on their trailers, then all six leave in the Panzer III by the SW
 * gate. The firing range forgives pistol shots, a lever by a flashing red lamp opens the underwater water gate,
 * the Spy's uniform hangs on a line in the W quarter, and a fixed anti-tank gun covers the tank.
 *
 * Conventions: headings/rot in DEGREES in the dossier, converted with deg(); route `look` and `post.sweep` stay in
 * degrees (0 = E, 90 = S, 180 = W, 270 = N). All positions are TRUE plan positions (dossier §1: painted z +
 * 1.19·y already applied). Briefing text is our own wording (§7.3).
 *
 * Deviations from the dossier (see the commit message):
 *  - levels are `cliff` polygons raised cell by cell (the M5/M12 method), drawn as prisms by scripts/m20.js;
 *    stairs are `ladders[]` with kind 'stairs' (the M6/M9/M12 method); the wall walk crosses the two gate arches
 *    and the water gate on short plank links (a cell cannot be both a walk at y 7 and a passage at y 0);
 *  - the T_n rampart's SE corner is cut (104–108, 26–32) and the ammunition wagon moved to (84,58) so the Sniper's
 *    41 m shot from e44's post at the AT gunner is clear (§14 E6); the inner gatehouse's E stair (S_ge) is left
 *    out (nothing uses it); huts, crates and a few posts move ≤ 3 m off the roads and footprints;
 *  - the roof rule is switched off by `rules.roofRule: false` (§14 E1, read by ai/perception.js);
 *  - e55 is the atgun's linked gunner; scripts/m20.js marks him `elevated` so knife and syringe refuse him (§14 E5;
 *    the rifle, the pistol and a bomb do not) and fires the gun's cannon at the Panzer III while he lives and sees
 *    it move with a commando at its controls (the engine's linked gunner only fires his rifle): shoot him before
 *    the tank's first move;
 *  - the AT gun sits at (77, 50.5) and the tank at (83, 37): the cannon's 13.5 m minimum range, the Sniper's line
 *    (43.6 m) clear of blk_n, the crates and the first V2 (moved to (96, 50));
 *  - the whole-map zone fires RINT (the engine's siren event), the dossier's RALL;
 *  - the HQ is a bomb-only destructible; the engine's explosive-target radius (half its long side + 3 m) stands
 *    for "within 3 m of the footprint" (§14 E4, no marker).
 */

import { plateauWalkways, rectPoly } from './scripts/m05.js';
import { m20Script } from './scripts/m20.js';
import { joinStructures } from './schema.js';
import { M20_DRESSING, M20_DRESSING_JOINS } from '../art/m20-dressing.js';
import { churchFootprint } from '../art/m20-church.js';

const deg = (d) => (d * Math.PI) / 180;
const P = (x, z, wait = 0, look = null) => ({ x, z, wait, look }); // `look` stays in DEGREES (enemy-brain)

/** Level heights (dossier §4.3). */
export const Y = { WB: 4, NE: 4, NW: 7, BAT: 7, SW: 10, N: 10, HQ: 13, ROOF: 20, TUR: 26 };

// ---------------------------------------------------------------- levels (dossier §4.3, true metres)
/** The HQ terrace (y 13): the dossier's rect minus the château's footprint. */
export const T_HQ = [[4, 62], [26.5, 62], [26.5, 52], [38, 52], [38, 78], [4, 78]];
export const T_SW = [[22, 78], [38, 78], [38, 91], [34.90, 91], [33.89, 89.99], [31.99, 91.89], [31.50, 92.38], [31.50, 91], [22, 91]]; // (user 2026-11-15: S_sw's top corners bury into this edge — the flight meets it at 45°, so the centreline top 0.04 m short still leaves the top three steps' NE corners up to 0.87 m inside with a 0.65 m coping stub. Same fix class as S_ne3's deck re-cut: the S edge notches back along a diagonal parallel to the stair's top edge, 0.10 m beyond it (x+z=123.94 vs the top edge 124.08), with a short N-S jog back to the edge. The bite runs E to x=34.90 — the step-12 coping's near-end corners reach x≈34.76, past the 34.60 first tried (probe-all-stairs-top.mjs found 8 verts at x=34.73 still inside). The bite is 1.92 m2; the cw_sw wall's end face (x+z=124) stays 0.04 m clear of the diagonal, below the paving.) (user 2026-11-17, live screenshot: the top still doesn't coincide with the deck — the diagonal only ran to w=+0.04, so the SW 1.20 m of the top edge faced the z=91 edge at 45° with a wedge gap growing to 0.89 m at the SW coping corner (tread SW corner 0.66 m short; NE corner 0.08 m short; probe-ssw-top-gap.mjs). The diagonal now runs SW to (31.50,92.44), covering the SW coping corner (w=+1.24) with 0.84 m to spare, with a N-S jog back to z=91 at x=31.50. The whole top edge — tread and coping — now sits 0.06–0.08 m short of the deck, uniformly. The deck gains a 1.05 m2 triangle south of z=91; the diagonal stays on x+z=123.94, 0.04 m clear of the cw_sw end face. Jog at x=31.50, not 32.02: the 32.02 jog flipped the wire test's A* tie-break (spy→e67 1.1 m longer, the without-wire path taking a diagonal shortcut the with-wire path misses — the wire itself blocks nothing; see wire-check.mjs. The 31.50 jog keeps the wire test green.) (user 2026-11-17, live screenshot: the diagonal's NE extension cut a strange triangular dent in the deck beside the stair — 1.92 m2, 1.96 m deep at x=34.90, where the stair isn't. The notch now hugs the flight's own edges, offset 0.10 m out (probe-ssw-notch-narrow.mjs): NE edge from z=91 at (34.90,91) to the miter (33.89,89.99), the top edge to (31.99,91.89). Deepest point 1.01 m is the stair's own NE corner, not a sideways excavation; flight 0 verts inside, top gap 0.10 m uniform. The parapet through-cut (41beb2e3) is unchanged — it already hugs the flight∩strip region. The SW end keeps the old shape's south deck triangle: the top-edge diagonal continues past the miter to (31.50,92.38), then a N-S jog back to z=91 at x=31.50 — deck 207.93 m2. Returning the SW edge straight to z=91 (at 31.10, then at 31.50) flipped the wire test the same way the 32.02 jog did (spy→e67 1.1 m longer, suite 2859/1; the divergence is at the path's far end near (48,32), not at the stair — a global A* tie-break, debug-spy-e67.mjs); the south triangle restores it (delta 0.13 m, wire-placements 21/0).)
export const T_NW = [[38, 32], [56, 32], [56, 72], [38, 72]];
/** The N range roof / rampart (y 10), its SE corner cut for the Sniper's line (§14 E6). */
export const T_N = [[38, 14], [108, 14], [108, 20], [109.27, 20], [109.57, 20.57], [105.77, 26], [108, 26], [104, 32], [38, 32]];
// (user 2026-11-15: S_ne3 "intersects in a strange way with the top" — the flight meets the x=108 edge at 35°,
// so its NW top corners penetrated the terrace up to 0.66 m while the SE side stopped 0.71 m short, and the top
// cheek coping stood 0.45 m proud of the paving. The SE edge is re-cut so the deck meets the stair: the segment
// (109.97,20)->(105.77,26) is parallel to the stair's top edge and 0.10 m beyond it, so the whole top edge lands
// uniformly short of the deck; the deck gains a small landing shoulder east of x=108 and loses the triangle the
// stair used to penetrate. Stair itself unchanged.)
// (user 2026-11-15: the re-cut left a sharp 55° corner at (109.97,20) — chamfered 0.7 m on each leg to
// (109.27,20)/(109.57,20.57), so the spike becomes two 117.5° corners with a 0.65 m face. The diagonal's line
// is unchanged, only 0.7 m shorter at its NE end, clear of the stair's top edge (chamfer ends 1.6 m short of
// the nearest coping corner), so the 0.06 m coping clearance stands.)
/** The W bastion terrace (y 4) plus the inner gatehouse's W tower top. */
export const T_WB = [[56, 42], [69.2, 42], [69.2, 70], [64, 70], [64, 62], [56, 62]];
/** The NE terrace (y 4), clipped S of the rampart (z ≥ 32). */
export const T_NE = [[102, 32], [112, 32], [128, 45], [128, 51], [102, 51]];
/**
 * Parapets: raised one-cell strips 1.4 m above their level. The grid's 2.5D sight test lets a raised cell block
 * only when it is higher than both ends, so a bare terrace edge hides nobody from the ground; these strips stand
 * for the edge and its parapet [P "keep to the centre of the path"].
 *  - T_hq's S edge and its E edge where the W quarter's yard meets it (z ≥ 72.5), T_sw's E and S edges: the S strip
 *    of the HQ terrace (where e1 walks and the climb lands) and the SW bastion are out of sight of the W quarter
 *    (e29–e32), T_nw and the SW battlements (e7). The climbs and ladders cross them on their links. The forecourt
 *    stays open to the yard by T_nw's corner, so a tank there can still shell the door guards.
 *  - the balustrade (z 68.75, x 4–23 and 33.5–37.4, open between) between the château's forecourt and the S strip:
 *    the door guards (e35, e36, facing S) and e40 do not see e1 walk the strip's W half or his body there ("out of
 *    sight" [ooc]); e37's walk S and e40 do not see e2's post by the searchlight ("no need to hide the body" [ooc]).
 *    Through the opening a tank in the yard still reaches the door guards and e39.
 *  - T_n's S edge by e49's post: the N court (e50) does not see him knifed.
 * The turret (y 26) still sees and is seen over all of them [P "some of the soldiers below can see the tower"].
 */
export const PARAPET_H = 1.4;
/**
 * The forecourt screen (t_par_hq_b*) stands taller than the edge parapets: the sight line runs from a guard's eye
 * (1.65 m) to a standing man's chest (1.4 m: perception targetHeight), so a 1.4 m balustrade hid only men lying down —
 * the door guards and e40 saw e1's walk and a man on his feet anywhere on the strip's W half (Prima's "runs after
 * Soldier 1 and knifes him" was seen). Above eye height it hides a standing man too (sol/m20).
 */
export const BALUSTRADE_H = 1.7;
export const PARAPETS = [
  ['t_par_hq_e', [[37.4, 72.5], [38, 72.5], [38, 78], [37.4, 78]], Y.HQ],
  ['t_par_hq_s', [[22, 77.5], [37.4, 77.5], [37.4, 78], [22, 78]], Y.HQ],
  ['t_par_sw_e', [[37.4, 78], [38, 78], [38, 91], [37.4, 91]], Y.SW],
  // (user 2026-11-22: shorten the wall with merlons parallel to the end of the stairs — the strip no longer
  // runs west past the stair exit at all. It ends at x 31.5, at the stair's west side, where its west end meets
  // the restored N-S jog return at the corner (31.5, 91) — the stick that jutted off the stair's SW cheek (the
  // merlon at x 31.6-32.8, and the whole west run to x 22) is gone because the wall ends at the stair, not
  // because one merlon was deleted mid-wall (306a8335 reverted in that sense). The west vertex 31.5 is
  // grid-aligned (31.5 = 22 + 5 x 1.9, the merlon pitch) so the two merlons east of the exit keep their exact
  // places (35.40-36.60, 37.30-38.00); the cut still opens only where the stair is. NOTE: the base wall under
  // the first merlon slot stays (see m20-art.js) — it is what hides the bastion from the BAT-level watcher at
  // (40, 98); the parapets test pins that sightline, and the bare base wall is what blocks it.)
  // (user 2026-11-23: NOT fixed — that bare base wall (x 31.5-33.03) still reaches mid landing: its east end
  // sits at the middle of S_sw's top edge. So the VISIBLE strip now starts at the stair gap (x 33.03) and the
  // wall ends where the jog starts, with nothing between the jog and the exit. The west stub survives ONLY as
  // t_par_sw_s_w, a grid-only cliff with no visual (m20-art.js skips it): removing it from the grid opens the
  // (40, 98) -> (31, 89.5) sightline (probe: that one assertion fails, all others hold). lineOfSight
  // blocks on grid elev > max(viewerY, targetY) + 1.0 = 11.0, so the blocker must stay at full parapet
  // height (grid elev 11.4) — a lowered stub does not block it. Trade-off, stated plainly: the stub is invisible in
  // the render but still blocks sight and movement in the grid for that 1.5 m of terrace edge.)
  ['t_par_sw_s', [[33.03, 90.4], [38, 90.4], [38, 91], [33.03, 91]], Y.SW],
  ['t_par_sw_s_w', [[31.5, 90.4], [33.03, 90.4], [33.03, 91], [31.5, 91]], Y.SW],
  // (user 2026-11-17: the merlon at u 9.6-10.8 in t_par_sw_s stood in the middle of S_sw's exit, past the
  // top tread — shifting it along the strip is impossible (neighbours both sides), so it moved OFF the strip
  // onto the triangular deck's N-S jog as a short parapet return: buildParapet lays one 1.2 m merlon centred
  // on the jog (31.72, 91.69), clear of the walk band. Flush inside the deck (west face on the jog edge,
  // x 31.50) so its 0.44 m width still covers the 0.5 m grid's cell centre (31.75, 91.75) — a straddling
  // return read as deck level in the grid, not parapet. User 2026-11-22: the 17106856 move of this return
  // west onto the deck made the perpendicular wall disappear — restored here to its pre-17106856 geometry,
  // untouched ("left the other perpendicular wall untouched"); the strip shortening above is what removes
  // the stick now, not a change to this return.)
  ['t_par_sw_jog', [[31.5, 91], [31.5, 92.38], [31.94, 92.38], [31.94, 91]], Y.SW],
  // (user 2026-11-14: the SW bastion's moat-facing west face was bare — a flat top edge with no merlons — while the
  // terrace's south parapet beside it carries a full row. The west edge never had a strip: the S and E edges do.)
  ['t_par_sw_w', [[22, 78], [22.6, 78], [22.6, 91], [22, 91]], Y.SW],
  ['t_par_hq_b', [[4, 68.5], [23, 68.5], [23, 69], [4, 69]], Y.HQ, BALUSTRADE_H],
  ['t_par_hq_b2', [[33.5, 68.5], [37.4, 68.5], [37.4, 69], [33.5, 69]], Y.HQ, BALUSTRADE_H],
  ['t_par_n', [[92, 31.4], [104, 31.4], [104, 32], [92, 32]], Y.N],
];
/**
 * The crag under the HQ and the W wall (impassable). Castle pass (user 2026-11-10, the moat all round): its W and N
 * faces stand in the moat ring (x 4, z 10), no longer at the map edge.
 */
const CRAG = [[4, 10], [40, 10], [40, 14], [38, 14], [38, 32], [27, 32], [27, 38], [4.5, 38], [4.5, 79], [22, 80], [22, 82], [4, 82]];
/** The Black Forest edge, cut back N of the moat's N legs (a strip of meadow on the counterscarp). */
const FOREST = [[0, 0], [157, 0], [157, 18], [140, 24], [118, 9.5], [110, 7.5], [44, 7.5], [41, 3.5], [0, 3.5]];

// ---------------------------------------------------------------- water and roads (dossier §4.5 T3–T5)
/** The moat: 4 m outside the curtain, from the SW bastion round S, SE and E to the pond. */
export const MOAT = [[31, 96], [49.8, 114.2], [55.1, 120.8], [60.7, 121.6], [97.7, 132.3], [101.2, 131.9], [141.7, 100.6], [143.5, 97], [143.5, 74]];
/**
 * Castle pass (user 2026-11-10: "M20 should look like a large castle, moat should circle all around castle"): the rest
 * of the ring, deep water like the S and E moat (Marine only), so the castle stands in water on every side:
 *  - the NE leg from the pond up the E face and along the NE wall (2.5-6.5 m off its line, as the E moat) to the N
 *    range's corner; the N legs along the N range's back (z 10-14) and the crag's N face (z 6-10); the W leg along the
 *    crag, the château's terrace and the outer ward (x 0.5-4; the map edge keeps a strip of bank);
 *  - the outer ward's S leg (z 94-98) from the W leg to the SW moat: the W pair start inside the ring, in the outer
 *    ward under the W wall (the climb spot as it was), and a plank footbridge carries the way S out of it (BR_W).
 * Nobody's beat, post or route crosses a new leg (the solution's men only the footbridge); rock rk_e3 stands 3 m out
 * of the NE leg. Polygons in true metres, inner edges on the masonry's outer faces.
 */
export const MOAT_RING = [
  { id: 'ne', points: [[104.5, 10], [138.24, 41.07], [145.5, 46.88], [145.5, 74], [141.5, 74], [141.5, 48.8], [135.63, 44.1], [108, 18.64], [108, 14], [104.5, 14]] },
  { id: 'n', points: [[40, 10], [108, 10], [108, 14], [40, 14]] },
  { id: 'nw', points: [[0.5, 6], [42.5, 6], [42.5, 10], [0.5, 10]] },
  { id: 'w', points: [[0.5, 6], [4, 6], [4, 98], [0.5, 98]] },
  { id: 'ward', points: [[0.5, 94], [30.5, 94], [32.4, 94.6], [29.6, 97.4], [0.5, 98]] },
];
/** The outer ward's plank footbridge over the S leg (on the way S out of it). */
export const BR_W = { x: 6, z: 96, w: 6, d: 1.8 };
export const POOL = { x: 131, z: 79, w: 4.5, d: 8 };
export const CHANNEL = { x: 135.5, z: 81, w: 6, d: 2.5 };
/** The water gate's wall cells (blocked while shut; the set-piece `wg_ctl`). */
export const WATER_GATE = { x: 136.5, z: 81, w: 5, d: 2.5 };
export const LEVER = [135.8, 75.5];
const ROAD_SW_OUT = [[54, 125.5], [48, 130], [32, 141], [0, 157]];
const ROAD_SE_OUT = [[124.5, 122.5], [140, 138], [157, 147]];
/**
 * Inside (castle pass layout audit, user 2026-11-10: "Make sure all buildings are well located inside the castle and dont
 * intersect paths"): the SW gate's cobbled lane along the Panzer III's way out — between the store and the guardhouse,
 * round the guardhouse's N side — to the junction below the inner gate (ROAD_IN_S, 3.2 m); the inner road on through the
 * tunnel to the N court (ROAD_IN_N); the SE street from the junction past the guardhouse's N corner to the SE gate; the
 * range road to the E road court (the church, on the NE terrace, is reached by the terrace's stairs). No building stands
 * on any of them (tests/unit/m20-castle.test.mjs layout test). Road cells only change a running man's step noise (the
 * solution never runs).
 */
// (the road bed is the tank's ground: its lane keeps the line the Panzer III was tuned on, under the guardhouse's eaves)
export const ROAD_IN_S = [[58, 110], [59.6, 107], [63.5, 105.15], [66.9, 103.4], [67.2, 100.5], [66.9, 96.6], [67.7, 93.2], [69.6, 92.1], [72.8, 89.4], [74.2, 86.5], [74, 82]];
export const ROAD_IN_N = [[74, 82], [72, 72], [72, 61.5]]; // (to the tunnel's N mouth: the N court beyond is all paved)
/** The whole inner road, SW gate to the N court (the art tests' tank road). */
export const ROAD_IN = [...ROAD_IN_S, ...ROAD_IN_N.slice(1)];
const ROAD_SE_IN = [[74.2, 86.5], [82.5, 87.6], [99.5, 96.5], [113.5, 111.5]];
const ROAD_E = [[82.5, 87.6], [95, 85], [104.6, 76.4], [106.8, 66.2]];
/**
 * The drawn roads where they meet the moat bridges and the gates (render-only, see TERRAIN): the approach roads start
 * square on the bridges' landings (scripts/m20-art.js BRIDGE_LANDING: 13.45 m out along the passage from the gates'
 * centres), as wide as the decks (4.5 m), the SW one straight on the bridge's axis for 2 m and round a 7 m bend onto its
 * line to the forest; the inner roads end square at the gate passages' floors (4.3 m in) and at the inner gate's
 * tunnel floor (z 70.2), never over them.
 */
const ROAD_ART = {
  swOut: { width: 4.5, spline: false, points: [[53.52, 126.99], [52.99, 128.97], [52.77, 129.64], [52.5, 130.28], [52.15, 130.88], [51.75, 131.46], [51.3, 131.99],
    [50.79, 132.47], [50.24, 132.89], [49.65, 133.27], [49.02, 133.58], [32, 141], [0, 157]] },
  seOut: { width: 4.5, spline: false, points: [[125.51, 123.51], [140, 138], [157, 147]] },
  inS: { spline: false, points: [[58.12, 109.84], [58.45, 108.59], ...ROAD_IN_S.slice(1)] },
  inN: { spline: false, points: [[74, 82], [72, 72], [72, 70.21]] },
  seIn: { spline: false, points: [...ROAD_SE_IN.slice(0, -1), [111.76, 109.76], [112.95, 110.95]] },
};
/**
 * The castle church (Burgkirche, castle pass: user 2026-11-10 "If the castle can have a church too") on its own plot:
 * the NE terrace (T_ne, y 4) W of the stair block, clear of the firing range (which it hid from the camera on the SE
 * ward) — its tower at the S end over the E road court, its portal on the terrace's S walk between the stairs S_e and
 * S_ne1, the nave and the apse N toward the N range. Its art (art/m20-church.js) is measured; the terrace's walk has a
 * hole for it as for the stair block. `plan`: the church's lengths (m) along its axis and half-widths across.
 */
export const CHURCH = { x: 108.6, z: 41.1, rot: -90, w: 15.0, d: 6.9, baseY: Y.NE,
  plan: { tower: [0, 5.0], towerH: 2.4, nave: [5.0, 11.8], naveH: 3.0, choir: [11.8, 13.2], choirH: 2.4, apseR: 2.3, buttressOut: 0.45, steps: 0.9,
    buttressU: [6.4, 8.4, 10.4], towerTop: 15.5, spireTop: 26.5, naveEave: 7.2, naveRidge: 11.6, choirEave: 6.4, choirRidge: 10.0, apseEave: 5.8 } };
export const RANGE = [[100, 68], [118, 68], [135, 72], [135, 106], [122, 106], [108, 104], [100, 98]];

const TERRAIN = [
  { type: 'poly', terrain: 'mud', points: RANGE },
  { type: 'rect', terrain: 'mud', x: 40, z: 74, w: 22, d: 30 }, // the W quarter's yards
  { type: 'rect', terrain: 'road', x: 70, z: 33, w: 32, d: 29 }, // the N court's cobbles
  { type: 'rect', terrain: 'road', x: 104, z: 52, w: 16, d: 14 }, // the E road court
  // art pass: the castle's roads are granite setts, the approach roads domed cobbles (pavement pipeline 3p)
  // (`art`: render-only centre lines — art/pavement/index.js — where the drawn road meets a bridge or a gate: squared
  // onto its axis and ending at its landing or its passage floor, user 2026-11-11 "Bridge and path overlap looks strange
  // in the castle"; the gameplay road — surfaces, footsteps, trails, ground — stays `points`/`width`)
  { type: 'path', terrain: 'road', width: 5, points: ROAD_SW_OUT, surface: 'belgian', art: ROAD_ART.swOut },
  { type: 'path', terrain: 'road', width: 5, points: ROAD_SE_OUT, surface: 'belgian', art: ROAD_ART.seOut },
  { type: 'path', terrain: 'road', width: 3.2, points: ROAD_IN_S, surface: 'setts', art: ROAD_ART.inS },
  { type: 'path', terrain: 'road', width: 5, points: ROAD_IN_N, surface: 'setts', art: ROAD_ART.inN },
  { type: 'path', terrain: 'road', width: 4, points: ROAD_SE_IN, surface: 'setts', art: ROAD_ART.seIn },
  { type: 'path', terrain: 'road', width: 4, points: ROAD_E, surface: 'setts' },
  // last: water over everything else
  { type: 'path', terrain: 'water', width: 4, points: MOAT },
  ...MOAT_RING.map((m) => ({ type: 'poly', terrain: 'water', points: m.points })),
  { type: 'circle', terrain: 'water', x: 143.5, z: 73, r: 3 },
  { type: 'rect', terrain: 'water', ...CHANNEL },
  { type: 'rect', terrain: 'water', ...POOL },
];

// ---------------------------------------------------------------- art pass: paving, street furniture, vegetation
/** Paved courts (visual only: the grid keeps its road cells). */
const PAVEMENTS = [
  { id: 'n_court_setts', surface: 'setts', points: [[70, 33], [102, 33], [102, 62], [70, 62]], wear: 0.6, weeds: 0.25, puddles: 0.35, patches: 0.1, grid: false },
  { id: 'erc_setts', surface: 'setts', points: [[104, 52], [120, 52], [120, 66], [104, 66]], wear: 0.5, weeds: 0.3, puddles: 0.3, grid: false },
];
/**
 * Lamps, floodlights and signs (block: false: visual only, every route and sight line stays as tuned). Text only on
 * the Wehrmacht boards (no insignia).
 */
const FURNITURE = [
  { type: 'lamp', variant: 'platform', x: 65.6, z: 106.2, rot: deg(-135), block: false },
  { type: 'lamp', variant: 'platform', x: 83.0, z: 91.0, rot: deg(160), block: false },
  { type: 'lamp', variant: 'platform', x: 69.2, z: 77.5, rot: deg(20), block: false },
  { type: 'lamp', variant: 'platform', x: 110.5, z: 57.5, rot: deg(200), hooded: true, block: false },
  { type: 'lamp', variant: 'platform', x: 110.3, z: 104.0, rot: deg(135), block: false },
  { type: 'floodlight', x: 101.5, z: 58.5, rot: deg(200), block: false },
  { type: 'floodlight', x: 100.5, z: 69.5, rot: deg(120), block: false },
  { type: 'sign', variant: 'wehrmacht', x: 55.6, z: 129.7, rot: deg(-60), text: 'HALT!\nAUSWEIS VORZEIGEN', block: false }, // (by the drawn road, not on it)
  { type: 'sign', variant: 'wehrmacht', x: 124.5, z: 127.8, rot: deg(-135), text: 'HALT!\nSPERRGEBIET', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 101.5, z: 72.5, rot: deg(180), text: 'SCHIESSSTAND\nBETRETEN VERBOTEN', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 101.8, z: 45.5, rot: deg(180), text: 'RAUCHEN\nVERBOTEN', block: false },
  { type: 'sign', variant: 'fingerpost', x: 27.5, z: 146.5, rot: deg(-30), text: 'FREIBURG 9 km', block: false },
  { type: 'sign', variant: 'fingerpost', x: 145.5, z: 147.5, rot: deg(30), text: 'EMMENDINGEN 11 km', block: false },
  // the occupation layer's stencilled boards (castle pass: German, no insignia) and the junction's unit signpost
  { type: 'sign', variant: 'wehrmacht', x: 70.2, z: 107.8, rot: deg(-45), text: 'ACHTUNG!\nFEINDBEOBACHTUNG', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 78.6, z: 85.3, rot: deg(160), text: 'STAB\nEINTRITT VERBOTEN', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 121.6, z: 58.4, rot: deg(180), text: 'KFZ-PARK\nNUR MIT FAHRBEFEHL', block: false },
  { type: 'sign', variant: 'wehrmacht', x: 113.2, z: 106.6, rot: deg(135), text: 'MUNITIONSLAGER\nRAUCHEN VERBOTEN', block: false },
  { type: 'sign', variant: 'fingerpost', x: 77.4, z: 84.8, rot: deg(20), text: 'KOMMANDANTUR / FERNSPRECHER / KFZ-PARK', block: false },
  { type: 'bench', x: 47.5, z: 88.5, rot: deg(-30), block: false },
  { type: 'bench', x: 92.5, z: 98.0, rot: deg(-30), block: false },
];
/* Vegetation (art/terrain.js treePlacement + vegetation pass): the Black Forest edge in February — `pine_frost`
 * gives a mixed wood (Norway spruce / pines with ~30 % bare beech and oak); every third stand tree is a silver fir. */

// ---------------------------------------------------------------- structures (dossier §5)
const rock = (id, x, z, r, h = 2.5) => ({ id, type: 'rocks', variant: 'rock_limestone_frost', x, z, rot: 0, w: 2 * r, d: 2 * r, h, block: 2 });
const tree = (x, z, k) => ({ id: `pine_${k}`, type: 'pine', variant: 'pine_frost', ...(k % 3 === 2 ? { species: 'fir' } : {}), x, z, r: 0.45, h: 11 + (k % 4), seed: 2000 + k });
const level = (id, variant, points, y, holes = [], o = {}) => ({ id, type: 'cliff', variant, mat: 'stone', points, h: y, block: 2,
  walkways: plateauWalkways(points, holes, y), ...o });
/** A curtain stretch: 5 m of limestone, its whole top a wall walk at y 7 (dossier §4.3 BAT). */
const curtain = (id, points, h = Y.BAT, o = {}) => ({ id, type: 'castle_wall', variant: 'curtain_limestone_crenellated', points, width: 5, h, mat: 'stone',
  walkways: [{ points, width: 5, y: Y.BAT }], ...o });
/** Art: a thin wood-stove plume from the hut's modelled stovepipe (fx 'smoke' anchor) — only a few huts smoke, so the
 *  quarter stays readable (a plume per hut pooled into one smoke bank). */
// a hut's stovepipe (the model's 'smoke' anchor): always lit, faint (render/fx.js chimney activity)
const STOVE = { activity: 0.5 };
const hut = (id, x, z, rot, extra = {}) => ({ id, type: 'hut', variant: 'hut_timber_barrack', x, z, rot: deg(rot), w: 10, d: 6, h: 4, mat: 'planks', chimney: false, ...extra });
const crates = (id, x, z, w = 1.4, d = 1.4, extra = {}) => ({ id, type: 'crates', variant: 'crates_ammo', x, z, rot: 0, w, d, h: 1.1, block: 1, ...extra });
const bags = (id, x, z, rot, w) => ({ id, type: 'sandbags', x, z, rot: deg(rot), w, d: 0.8, h: 1.0 });
const POLE_WIRES = { 2: 'pole_0', 0: 'pole_1', 3: 'pole_4', 4: 'pole_5' }; // art pass: the two roadside lines carry wires
const pole = (x, z, k) => ({ id: `pole_${k}`, type: 'telegraph_pole', x, z, r: 0.2, h: 7, wireTo: POLE_WIRES[k] ?? null });
/** A gatehouse (two roofed towers, an open arch between them) with its tower tops on the wall walk. */
const gatehouse = (id, label, x, z, rot, o = {}) => {
  const r = deg(rot), c = Math.cos(r), s = Math.sin(r);
  const at = (lx, lz) => [+(x + lx * c - lz * s).toFixed(2), +(z + lx * s + lz * c).toFixed(2)];
  return { id, type: 'castle_gate', variant: 'gatehouse_twin_tower_slate', label, x, z, rot: r, w: 12, d: 8, h: 10, mat: 'stone',
    walkways: [-4, 4].map((lx) => ({ points: [at(lx, -3.5), at(lx, 3.5)], width: 3.5, y: Y.BAT })), ...o };
};

/** §5.1 the curtain, the gates, the retaining levels (listed before the terraces: a later raise wins). */
const CURTAIN = [
  // (user 2026-11-14: cw_sw meets gh_sw tilted (45 deg) and its end face sat
  // half out of the gatehouse — probe-junction.mjs: 3.33 m of the 5 m end face
  // outside the gate rect, worst corner 1.14 m past the face plane — while the
  // aligned cw_s sits 0.15 m inside uniformly. gateSeat seats the end 1.5 m
  // deeper (trimEnds), so the whole end face lands inside the gate rect like
  // the east side; the parapet/merlons already stop ~0.2-0.3 m short of the end,
  // so nothing extra stands on the gatehouse deck.)
  curtain('cw_sw', [[33, 91], [52.3, 110.3]], Y.BAT, { gateSeat: 1.5 }),
  // (user 2026-11-14: no merlons on the walls flanking the main entrance — the side
  // faces' crenellation comes off; the outer face and the arch keep theirs, gh_se untouched.)
  // (user 2026-11-14: the full-depth side parapets crossed the over-the-wall corridor
  // where the wall walk enters/exits the gatehouse (probe-corridor.mjs: 12 blocked
  // samples, parapet top y 8.0). Each side parapet is shortened to end at the
  // corridor's edge — Fs-u ranges = F-w along the face, from the walkway strips
  // (width 5) crossing the faces: west keeps the outer stub w 0.24..4, east keeps
  // the inner stub w -4..-0.28. No doorway cut; merlons stay outer-face only.)
  gatehouse('gh_sw', 'South-west gate', 57, 114, 15, { sideMerlons: false, sideParapet: { west: [0.24, 4], east: [-4, -0.28] } }),
  // (user 2026-11-14: splitParapet — cw_s seg 0's parapet collapsed under dropInside and 10 merlons
  // floated ~1.1 m; the per-merlon bays keep every surviving merlon on its support. No other wall sets it.)
  curtain('cw_s', [[61.5, 117.5], [99, 128], [112, 117.8]], Y.BAT, { splitParapet: true }), // (kerb flush at every joint now, buildCurtain 2026-11-15: the old per-wall kerbEndFlush only cut the END stub — the (99,128) start stub still crossed seg 0's walk to w -0.09, probe-slabs.mjs)
  // (user 2026-11-15: gh_se gets gh_sw's data-level treatment — the shared-builder fixes already cover it, but the two
  // gh_sw-only fixes were never applied here, and the corridor is blocked 13/134 (probe-corridor.mjs). sideMerlons:false
  // drops the 8 side merlons; the side parapets shorten to stubs at the corridor's edge, same ranges as gh_sw — the path
  // crosses the west face at w ≈ -0.2 and the east face at w ≈ +0.15, so west keeps the outer stub w 0.24..4 and east keeps
  // the inner stub w -4..-0.28. The parapet base alone blocks the soldier volume, so merlons off without the stubs would not clear it.)
  { ...gatehouse('gh_se', 'South-east gate', 116, 114, -45, { sideMerlons: false, sideParapet: { west: [0.24, 4], east: [-4, -0.28] } }),
    alignFree: 'the corner gate between cw_s (−38°) and cw_e1 (−35°), square to its bridge and road (45°)' },
  // the timber bridges over the moat, on each gate's axis
  { id: 'br_sw', type: 'bridge', variant: 'bridge_timber_moat_lanterns', x: 55.06, z: 121.25, rot: deg(105), w: 9, d: 4.5, h: 0.5 },
  { id: 'br_se', type: 'bridge', variant: 'bridge_timber_moat', x: 121.3, z: 119.3, rot: deg(45), w: 9, d: 4.5, h: 0.5 },
  // the outer ward's plank footbridge over the ring's S leg (castle pass)
  { id: 'br_w', type: 'bridge', variant: 'footbridge_timber', x: BR_W.x, z: BR_W.z, rot: deg(90), w: BR_W.w, d: BR_W.d, h: 0.4 },
  curtain('cw_e1', [[119.8, 110.3], [139, 97], [139, 83.6]]),
  curtain('cw_e2', [[139, 80.9], [139, 50], [134, 46], [106, 20.2]], Y.BAT,
    // (user 2026-11-15: the merlons in front of S_ne3 stand 0.33 m inside the
    // corridor — their inner faces at w=2.17, the wall face at w=2.5. Shift the
    // projecting parapet out 0.33 m so the merlons' inner faces sit flush with
    // the wall's outer face and the walk is clear to the face line. Whole
    // curtain: the parapet is one continuous assembly; a per-segment jog would
    // show a step at the (134,46) joint. parapetKerb (same day): with the
    // merlons on the face line the walk paving ran flush into their bases
    // with no visible junction — a low dressed kerb along the parapet foot,
    // mirroring the inner kerb, stops the paving at a deliberate line. The
    // merlon row does not move; walkable width between kerbs is 4.40 m.)
    // (user 2026-11-16: S_ne2 lands on this walk against the continuous inner
    // kerb — its top tread stops 0.04 m short of the walk's inner face with a
    // 0.12 m kerb lip across the step-off, the same 0.12 m that blocked the
    // corridor at the (99,128) joint. kerbGaps opens the kerb where the stair
    // lands, as stairGaps opens the parapet: seg 2, u 4.99..7.67 — S_ne2's
    // centreline crosses the kerb line (w -2.375) at u 6.33 (probe-sne2-kerb.mjs),
    // gap = coping half-width 1.24 + 0.10 m margin a side; the flight crosses
    // the kerb at 90 deg, so the along-wall extent is the coping width itself.)
    { parapetOut: 0.33, parapetKerb: true, kerbGaps: [[2, 4.99, 7.67]] }),
  { id: 'cw_w', type: 'castle_wall', variant: 'curtain_limestone_crag', points: [[4, 78.5], [22, 79.5]], width: 4, h: Y.HQ, mat: 'stone' },
  { id: 'bartizan_s', type: 'watchtower', variant: 'bartizan_round_decor', x: 99, z: 130.8, w: 1.2, d: 1.2, h: 8.5, deckY: 0.1 },
  // the inner gatehouse between the S courts and the N court (its W tower top belongs to T_wb)
  { id: 'gh_in', type: 'castle_gate', variant: 'gatehouse_inner_portcullis', label: 'Inner gate', x: 72, z: 66, rot: 0, w: 16, d: 8, h: 8, mat: 'stone' },
  { id: 'crag', type: 'cliff', variant: 'crag_limestone', mat: 'rock', points: CRAG, h: Y.HQ, block: 2 },
  { id: 'forest', type: 'pine', variant: 'forest', points: FOREST, h: 16, block: 2 },
];

/** §4.3 the raised levels (prisms drawn by scripts/m20.js); the turret after T_hq (its deck wins). */
const LEVELS = [
  // blk_ne and the castle church stand on it (the church's walls, buttresses, choir and apse: its own footprint)
  // (dressing: false on t_n + t_ne — user 2026-11-15: the moss rings and drain grates read as black
  // blotches on camera by the S_ne3 stair; bare gutter channel on these two decks only, every other
  // terrace keeps its dressing. The flag is plumbed through m20-art.js into buildTerrace/flagTop.)
  level('t_ne', 'terrace_limestone', T_NE, Y.NE, [{ poly: rectPoly(119, 42, 10, 6, deg(42.7)) },
    ...churchFootprint({ x: CHURCH.x, z: CHURCH.z, rot: deg(CHURCH.rot), w: CHURCH.w, church: CHURCH.plan }).filter((f) => f.id !== 'steps').map((f) => ({ poly: f.poly }))], { dressing: false }),
  level('t_wb', 'terrace_limestone', T_WB, Y.WB),
  level('t_nw', 'terrace_limestone', T_NW, Y.NW),
  level('t_n', 'range_roof_rampart', T_N, Y.N, [], { dressing: false }),
  level('t_sw', 'bastion_limestone', T_SW, Y.SW),
  level('t_hq', 'terrace_limestone', T_HQ, Y.HQ),
  // parapets and the forecourt balustrade (1.4 m stone, one cell): edge cover for the terraces [P "keep to the centre"]
  ...PARAPETS.map(([id, poly, y, ph = PARAPET_H]) => ({ id, type: 'cliff', variant: 'parapet_limestone', mat: 'stone', points: poly, h: y + ph, block: 0,
    walkways: plateauWalkways(poly, [], y + ph) })),
  { id: 'turret', type: 'watchtower', variant: 'turret_round_crenellated', label: 'Turret', x: 29, z: 57, rot: 0, w: 5, d: 5, h: Y.TUR, deckY: Y.TUR },
];

/** §5.2 buildings. The château (o1) is lifted onto its terrace by the script. */
export const HQ = { id: 'hq', type: 'house', variant: 'chateau_hq', label: 'Headquarters', x: 15.5, z: 50, rot: 0, w: 22, d: 24, h: 20,
  mat: 'stone', roof: 'roofSlate', flag: true, destructible: true, bombOnly: true, baseY: Y.HQ,
  walkways: [{ points: [[19.5, 60], [26, 60]], width: 3, y: Y.ROOF }], // the roof ledge under the turret (NL "the ladder up")
  // art pass 2: the porch steps' baked AO came out black at both ends of the flight (two black slabs at the door from
  // the default camera): the dressed-stone trim keeps the live AO only
  dropAo: 'kit:limestone_smooth' };
const BUILDINGS = [
  HQ,
  { id: 'hq_wing', type: 'house', variant: 'chateau_wing', x: 32.25, z: 42, rot: 0, w: 11.5, d: 20, h: 8, mat: 'stone', roof: 'roofSlate', baseY: Y.HQ },
  { id: 'n_range', type: 'house', variant: 'castle_range_block', x: 71, z: 23, rot: 0, w: 66, d: 18, h: Y.N, mat: 'stone' }, // T_n is its roof
  { id: 'blk_n', type: 'house', variant: 'stair_tower', x: 90, z: 35.5, rot: 0, w: 8, d: 5, h: Y.N + 2, mat: 'stone', roof: 'roofSlate', shaft: [-1.0, 2.0] }, // (shaft, user 2026-11-15: the tower is a stair tower — S_n climbs inside it through a cut stairwell shaft, u -1.0..2.0 (x 89.0..92.0), open S and N full-height. +2 m (user 2026-11-17: the stair crossed under the roof with ~0.5 m headroom at the N mouth; 12 m gives >=2.2 m over the flight). Routing the flight outside the tower proved impossible: every due-north line in the N court hits the tank, its way out, P57, the AT gun's wire, the jerrycans or the T_wb terrace — four tried placements (x=84, 74, 68, 77) each failed a different probe or test. See buildStairTower.)
  { id: 'blk_ne', type: 'house', variant: 'stair_block', label: 'Stair block', x: 119, z: 42, rot: deg(42.7), w: 10, d: 6, h: 3.5, mat: 'stone',
    roof: 'roofSlate', baseY: Y.NE, enterable: true, door: deg(90) },
  { id: 'bk_e', type: 'barracks', variant: 'house_half_timber_turret', label: 'Range barracks', x: 126, z: 62.5, rot: 0, w: 12, d: 11, h: 12,
    mat: 'plaster', roof: 'roofSlate', flag: true, garrison: true, door: deg(90), destructible: true },
  { id: 'bk_s', type: 'barracks', variant: 'hut_timber_barrack', label: 'Barracks', x: 76, z: 97, rot: deg(-30), w: 11, d: 7, h: 4.5,
    mat: 'planks', flag: true, garrison: true, door: deg(270), destructible: true, chimney: STOVE,
    alignFree: 'square to the S court and the SW lane\'s first bend; the lane swings 10° past its N corner toward the junction' },
  { id: 'h_st', type: 'house', variant: 'house_half_timber_steeple', x: 66, z: 86, rot: deg(-20), w: 10, d: 7, h: 7, mat: 'plaster', roof: 'roofSlate', chimney: false,
    alignFree: 'the chapel keeps its liturgical orientation (altar to the east), not the lane\'s' },
  // (h_w3 ∥ cw_sw, 6 m long: 2 m shorter at its SW end than first drawn, its NE end and NW face where they were — the
  // Panzer III turns into the SW gate's mouth past its S corner; e24's beat round it is unchanged)
  hut('h_w1', 54, 82, -30, { chimney: STOVE }), hut('h_w2', 50, 97, -45, { artOffset: [0.5, -0.5] }), hut('h_w3', 60.71, 99.79, -45, { w: 6, d: 5 }),
  hut('h_s1', 88, 106, -30, { chimney: STOVE }), hut('h_s2', 72, 110, -30),
  // (castle pass layout audit: the steward's house and its stair turret 0.5 m N off the S curtain, a lane behind them;
  // the brewhouse h_s4 that overlapped the bakehouse's corner is gone; the gate warden's lodge stands free of the SE
  // gatehouse and the curtain, its door on the SE street)
  hut('h_s3', 88.13, 117.52, 15.6, { label: 'Hut', enterable: true, door: deg(270) }), // ∥ cw_s
  hut('h_s5', 102.5, 112.8, 20, { w: 8, d: 5 }),
  { id: 'h_tur', type: 'house', variant: 'house_turret_small', x: 95.13, z: 118.02, rot: 0, w: 4, d: 4, h: 8, mat: 'plaster', roof: 'roofSlate', chimney: false },
  // the castle church (castle pass): its own art, measured (scripts/m20-art.js church); this box is its logic footprint
  // on the NE terrace (its tower's face to the choir's end; the apse's tip, the buttresses and the steps are the art's)
  { id: 'church', type: 'house', variant: 'castle_church', label: 'Castle church', x: CHURCH.x, z: CHURCH.z, rot: deg(CHURCH.rot), w: CHURCH.w, d: CHURCH.d, h: 11,
    baseY: CHURCH.baseY, church: CHURCH.plan, mat: 'stone', roof: 'roofSlate', chimney: false },
  { id: 'outhouse', type: 'hut', variant: 'outhouse', x: 44, z: 78.5, rot: 0, w: 1.5, d: 1.5, h: 2.5, mat: 'planks', chimney: false },
  { id: 'shelter', type: 'hut', variant: 'open_shed_bench', x: 104.5, z: 89, rot: deg(-42.7), w: 4, d: 8, h: 3, mat: 'planks', block: 1, chimney: false },
];

/** §5.3 the two V2s on their trailers (o2) and the N court's hardware. */
export const V2S = ['v2a', 'v2b'];
const v2 = (id, x, z) => ({ id, type: 'v2_rocket', variant: 'v2_meillerwagen_lying', label: 'V2 rocket', x, z, rot: deg(30), w: 14, d: 3, h: 3,
  destructible: true, grenadeDestructible: true });
const WAGON_LINE = 'parked in line with the V2 trailers (30°); the inner road ends beside them at its own bend';
const MILITARY = [
  v2('v2a', 96, 50), v2('v2b', 94, 65),
  { id: 'wagon_ammo', type: 'train_car', variant: 'covered_wagon_shells', x: 84, z: 58, rot: deg(30), w: 5, d: 2.5, h: 2.5, block: 2, alignFree: WAGON_LINE },
  { id: 'wagon_crate', type: 'train_car', variant: 'covered_wagon', x: 85, z: 50, rot: deg(30), w: 5, d: 2.5, h: 2.5, block: 2, alignFree: WAGON_LINE },
  crates('crates_n1', 93.5, 42.5), crates('crates_n2', 96, 43),
  { id: 'flak_court', type: 'aa_gun', variant: 'flak38_quad_towed', x: 86, z: 73.5, rot: 0, w: 4, d: 2.5, h: 2.2, block: 1 },
  { id: 'flak_road', type: 'aa_gun', variant: 'flak38_quad_towed', x: 111, z: 66.5, rot: 0, w: 4, d: 2.5, h: 2.2, block: 1 },
  // the AT gun's sandbag half-ring, open to the N (the gun faces the tank)
  { ...bags('atgun_bag_w', 74.8, 51.5, 80, 2.6), alignFree: 'the half-ring\'s W flank, splayed 10° round the gun' },
  bags('atgun_bag_s', 77, 52.9, 0, 2.6),
  { ...bags('atgun_bag_e', 79.2, 51.5, 100, 2.6), alignFree: 'the half-ring\'s E flank, splayed 10° round the gun' },
  // (castle pass layout audit: off the SE street, against the gate warden's lodge, square to it)
  { ...bags('sandbag_se', 106.6, 109.2, 20, 3), alignFree: 'square to the gate warden\'s lodge (20°) it stands by, off the SE street' }, // the SE gate's inner side [fd]
  // on the terraces (visual only: lifted by the script; raised cells carry no block)
  { id: 'flak_hq', type: 'flak', variant: 'flak38_quad_round_emplacement', x: 35.5, z: 55, r: 2.2, h: 1, block: 0, baseY: Y.HQ },
  { id: 'flak_n', type: 'flak', variant: 'flak38_quad_round_emplacement', x: 88, z: 19, r: 2.2, h: 1, block: 0, baseY: Y.N },
  { id: 'gun_hq', type: 'aa_gun', variant: 'towed_field_gun', x: 22, z: 70, rot: 0, w: 3, d: 2, h: 1.6, block: 0, baseY: Y.HQ },
  crates('crates_hq1', 27, 66, 1.4, 1.4, { block: 0, baseY: Y.HQ }), crates('crates_hq2', 29, 67.5, 1.4, 1.4, { block: 0, baseY: Y.HQ }),
  crates('crates_n3', 64, 28, 1.4, 1.4, { block: 0, baseY: Y.N }),
  // (art pass 2: authored at (66, 30), the browser's placement pushed its drawn stack 2.9 m S, over the N range's
  // cornice, 9.5 m up in the air; it stands on the rampart beside where it was drawn, 0.6 m in from the edge, pinned)
  crates('crates_n4', 66.9, 30.75, 1.4, 1.2, { block: 0, baseY: Y.N, fixed: true }),
  { id: 'sl_hq', type: 'searchlight', x: 36.8, z: 74.8, r: 0.6, h: 1.8, block: 0, baseY: Y.HQ }, // (clear of L_in's head at (36.5, 77): whoever came up it walked through it)
  { id: 'sl_t', type: 'searchlight', x: 30, z: 58.5, r: 0.6, h: 1.8, block: 0, baseY: Y.TUR },
  { id: 'sl_n', type: 'searchlight', x: 93, z: 30, r: 0.6, h: 1.8, block: 0, baseY: Y.N },
  // the poles stand ≥ 4 m off the roads' centrelines (pole_1 off the SW exit road: the tank's way out)
  ...[[22, 140], [10, 147], [34, 130], [124, 128], [137, 134], [148, 142]].map(([x, z], k) => pole(x, z, k)),
  { id: 'lamp_rng', type: 'lamp_post', x: 108, z: 84.5, r: 0.2, h: 4 },
];

/**
 * The occupation layer's solid pieces (castle pass, user 2026-11-10: "Just make sure th3 castle is a medieval castle in
 * the nazi era"): the painted sentry boxes at the gates (art/m20-occupation.js, swapped in by scripts/m20-art.js) and the
 * vehicle park against the NE terrace's retaining wall in the E road court — an Opel Blitz, the staff car (Horch), a
 * Kübelwagen and an R75 with its sidecar (library models: art/static-vehicles.js `vehicleArt`). Off every road, route
 * and the tank's way (tests/unit/m20-castle.test.mjs layout test); nobody's walk comes near them.
 */
const sentryBox = (id, x, z, rot, extra = {}) => ({ id, type: 'hut', variant: 'sentry_box_m20', label: 'Sentry box', x, z, rot: deg(rot), w: 1.3, d: 1.3, h: 2.8, block: 2, chimney: false, flag: false, ...extra });
const parked = (id, x, z, rot, w, d, h, art, label) => ({ id, type: 'crates', variant: 'vehicle_parked', label, x, z, rot: deg(rot), w, d, h, block: 2, fixed: true, vehicleArt: art });
export const OCCUPATION = [
  sentryBox('gbox_sw', 60.9, 128.9, 15), sentryBox('gbox_se', 126.2, 118.6, -45, { alignFree: 'square to the SE bridge and its road (45°), whose head it guards' }), sentryBox('gbox_in', 77.7, 71.3, 0),
  // (either side of the stairs S_e up to the NE terrace, which stay clear)
  parked('vp_truck', 116.3, 54.6, -90, 6.2, 2.3, 2.9, 'opel_blitz_cargo', 'Lorry'),
  parked('vp_staff', 119.0, 54.0, -90, 4.7, 1.8, 1.8, 'horch901', 'Staff car'),
  parked('vp_kubel', 110.2, 53.4, -90, 3.8, 1.7, 1.7, 'kubelwagen', 'Kübelwagen'),
  parked('vp_moto', 107.6, 53.2, -90, 2.4, 1.7, 1.1, 'r75_sidecar', 'Motorcycle'),
];

/** §5.4 the firing range, the well, the pool and the water gate. */
const RANGE_PROPS = [
  { id: 'range', type: 'firing_range', variant: 'firing_range_targets', x: 120, z: 74, rot: 0, w: 14, d: 4, h: 1.2 },
  // (castle pass layout audit: the old silhouette frames in the firing line's lanes and behind its back, and the three
  // bullet stops — through the berm, against the curtain, behind the line's back — are gone; a range shoots one way, the
  // berm is the backstop)
  ...[[124, 83, 3], [127, 88, 4]].map(([x, z, k]) =>
    ({ id: `tgt_${k}`, type: 'sign', variant: 'target_frame_silhouette', x, z, rot: 0, w: 1, d: 0.3, h: 1.8, block: 1 })),
  // the firing line's ring targets (castle pass), one per lane, in front of the earth backstop
  ...[114.5, 117.0, 119.5].map((x, k) => ({ id: `tgt_${8 + k}`, type: 'sign', variant: 'target_board_bullseye', x, z: 77.6, rot: 0, w: 1.1, d: 0.3, h: 1.9, block: 1 })),
  { id: 'well', type: 'well', x: 128, z: 77.5, r: 0.9, h: 1, block: 1 },
  { id: 'water_gate', type: 'water_gate', variant: 'water_gate_grated_arch', x: 139, z: 82.25, rot: deg(90), w: 2.7, d: 5, h: 3 },
  { id: 'lever_box', type: 'lever', variant: 'lever_box_red_lamp', x: LEVER[0], z: LEVER[1], rot: 0 },
];

/** §4.5 T8/T9 rocks and single pines. `rk_w1` covers the W group, `rk_e2` the E group, `rk_e7` the SE bridge. */
const NATURE = [
  rock('rk_w1', 10.5, 87, 3), rock('rk_w2', 20, 115, 3), rock('rk_w3', 14, 122, 1.5), rock('rk_w4', 15, 141, 2.5),
  rock('rk_w5', 46, 140.5, 2.5), rock('rk_w6', 42, 150, 2),
  rock('rk_e1', 130, 27, 1.8), rock('rk_e2', 148, 34, 3), rock('rk_e3', 140, 38, 2.5), rock('rk_e4', 149, 50, 1.5), // (rk_e3: 3 m off the NE moat leg)
  rock('rk_e5', 150, 68, 2.5), rock('rk_e6', 150, 98, 2.5), rock('rk_e7', 130, 128, 2.5),
  ...[[33, 118], [39, 125], [146, 60], [152, 88], [134, 150], [152, 108], [145, 26], [153, 22], [6, 105]].map(([x, z], k) => tree(x, z, k)),
];

// (art pass 2 set dressing: the forest-edge log piles, the range's works corner, the N Flak's ammunition and rangefinder,
// the NE terrace's fire point, the SE road's wayside cross: art/m20-dressing.js)
const STRUCTURES = [...CURTAIN, ...LEVELS, ...BUILDINGS, ...MILITARY, ...OCCUPATION, ...RANGE_PROPS, ...NATURE, ...M20_DRESSING];

// ---------------------------------------------------------------- links (dossier §6.1): climbs (GB), ladders + stairs (everyone)
/** The castle's single climb spot: the W wall below the HQ [P][DE "only one possibility"][NL][ooc]. */
export const CLIMB_W = { id: 'cl_w', a: [15, 76.5, Y.HQ], b: [15, 83, 0], roles: ['greenberet'] };
const CLIMBS = [
  CLIMB_W,
  { id: 'cl_in', a: [30, 77, Y.HQ], b: [30, 80, Y.SW], roles: ['greenberet'] }, // "the drainpipe" [fd]: T_hq → the SW bastion
];
const ladder = (id, bottom, top, heading, extra = {}) => ({ id, x: bottom[0], z: bottom[1], y: bottom[2] ?? 0, top, raised: false, heading: deg(heading), ...extra });
// (`solid`: castle-kit's stone flights are masonry down to the ground: nobody walks beside a flight's run under it —
// map-builder stampSolidFlights; the pathfinder took those cells for open ground and the stair walk shoved a man
// there back for ever, sol/m20)
const stairs = (id, bottom, top, heading) => ladder(id, bottom, top, heading, { kind: 'stairs', solid: true });
const plank = (id, a, b, heading) => ladder(id, a, b, heading, { kind: 'plank' });
/** The Sniper's firing point (e44's post) and the AT gunner (§14 E6: 41 m, inside the rifle's 45 m). */
export const SNIPER_POST = { x: 114, z: 27.5, y: Y.BAT };
export const TANK_AT = { x: 83, z: 37 };
export const ATGUN = { x: 77, z: 50.5 }; // ≥ 13.5 m (the cannon's minimum range) from the tank
export const L_RNG = ladder('L_rng', [134.5, 71, 0], [138.5, 71, Y.BAT], 0); // "the ladder down into the firing range" [P]
const LADDERS = [
  ladder('L_in', [36.5, 80, Y.SW], [36.5, 77, Y.HQ], 270), // everyone's way between the SW bastion and T_hq (the Sapper's)
  ladder('L_hq1', [25.1, 63.5, Y.HQ], [25.1, 60.5, Y.ROOF], 270), // T_hq → the HQ roof ledge (up to a crenel of the château's parapet, x 24.8–25.4: at 24.5 it leant on a merlon and the way onto the roof went through it)
  ladder('L_hq2', [25.5, 60, Y.ROOF], [27.8, 58, Y.TUR], 315), // the roof ledge → the turret deck ("the small ladder")
  L_RNG,
  // (user 2026-11-15: the tilted stairs — S_sw ran diagonally across the cw_sw walk, 27° off parallel, and all
  // three flights below died 0.6-1.2 m short of their landing, their top steps buried in the level face: stopAt
  // cuts the run at the level edge but the rise stays spread over the full run. S_sw is re-seated parallel to
  // cw_sw on its centreline (w 0); all three tops sit 5 cm short of the level edge. The tops sit AT their
  // landings by the link/flight convention: the data's top endpoint IS the landing — the grid link's b.y and the
  // flight's nosing line both end there, so a walker arrives at the landing height (a top one riser below the
  // paving leaves the walker stepping up 0.2 m past the link end, and the sim test fails). The mesh's last tread
  // then tops out flush with the paving and ends 3 cm short of the deck edge — the tread runs 2 cm past the data
  // top — so there is no overlap with the paving and no penetration of the level face.)
  stairs('S_sw', [37.25, 95.25, Y.BAT], [33.04, 91.04, Y.SW], 225), // T_sw → the SW battlements
  stairs('S_nw2', [46.06, 63, Y.NW], [38.10, 63, Y.HQ], 180), // T_nw → T_hq ("the stairs in front of the flak" [NL]) (user 2026-11-15: the old top sat 1.5 m inside T_hq with a 1.80 m gap and a 48° pitch on 0.180 m treads. Re-seated due W so the top edge is parallel to the T_hq E edge: top at the edge, 0.10 m short, at its paving; the foot moves E along z=63 so the run is 7.96 — pitch 37.0°, tread 0.265, the S_n3 family.)
  stairs('S_n3', [47.5, 36, Y.NW], [47.5, 32.10, Y.N], 270), // T_nw ↔ T_n (user 2026-11-15: the left-side stair of the inner gate, mirror of S_ne3 — its top sat 1.5 m inside T_n with the cheek copings 0.65 m proud across the full width, and stopAt cut it 1.20 m short. Top at the T_n S edge, 0.10 m short, at its paving; the foot moves 2.0 m S along the same line because top-at-the-edge on the old foot is a 57.7 deg ladder (run 1.90, tread 0.127). Run 3.90, pitch 37.6 deg, tread 0.260 — the S_ne3 family.)
  stairs('S_nw1', [60.08, 50, Y.WB], [56.10, 50, Y.NW], 180), // T_wb ↔ T_nw (user 2026-11-15: the old top sat 1.5 m inside T_nw, 1.00 m short. Top at the T_nw E edge, 0.10 m short, at its paving; the foot moves E so the run is 3.98 — pitch 37.0°, tread 0.265, the S_n3 family.)
  stairs('S_gw', [62, 67.41, 0], [62, 62.10, Y.WB], 270), // the W quarter ↔ T_wb: "the stairs by 32's post" [P] (user 2026-11-15: re-routed — the old top sat inside the inner gatehouse footprint, so the flight climbed to a wall, not an open edge. The T_wb edge facing the W quarter (z=70) only runs x 64..69.2, under the gatehouse; at x=62 the terrace ends at z=62, facing the gatehouse forecourt pocket (x 56..64, z 62..70). The flight now stands in that pocket and climbs N to that edge, top 0.10 m short of z=62 at its paving; the foot is 2 m W of the gatehouse face and 11 m from 32's post. Pitch 37.0°, tread 0.266.)
  stairs('S_n', [90.5, 42.60, 0], [90.5, 32.10, Y.N], 270), // blk_n: the N court ↔ T_n ("the big stairs" [DE]) (user 2026-11-15: climbs inside the stair tower through its cut shaft (blk_n shaft [-1.0, 2.0]) — the tower is a stair tower, and routing the flight outside it proved impossible (tank, its way out, P57, the AT gun's wire, the jerrycans, the T_wb terrace each blocked a tried line: x=84, 74, 68, 77). The flight starts outside, S of the tower, enters the shaft at y 4.38 through its open S face and emerges onto T_n; the foot sits 1.10 m N of the V2a trailer's SW corner (the layout audit bands every stair 1.5 m past its foot, so z=45.37 overlapped the trailer by 2.52 m² and z=44.70 still by 1.36 m²). Top at the T_n S edge, 0.10 m short, at its paving; run 10.50 — pitch 43.6°, tread 0.210. Steeper than the S_n3 family's 37° because the foot is boxed in: v2a bars it going S, and the wire test's pathfinder smoothing trips on the intermediate feet (z=42.90–43.80 each fail a different commando→e67/e33 leg by 1.2–1.7 m — the wire itself blocks nothing on T_n; the T_n-only path is identical with and without it). Still a real stair, not the old 48° on 0.180 m treads, and no longer 5 m hidden in solid masonry.)
  stairs('S_ne1', [97.40, 42, 0], [101.90, 42, Y.NE], 0), // the N court ↔ T_ne (the Driver's way to the tank) (user 2026-11-15: the old top sat 1.0 m inside T_ne, 0.80 m short. Top at the T_ne W edge, 0.10 m short on the approach side, at its paving; the whole flight shifts W 1.10 m with the run kept at 4.50 — pitch 41.6°, tread 0.225 — because a 37° foot would land 0.09 m from crates_n2; at this foot it stays 0.7 m clear.)
  stairs('S_e', [113.5, 58, 0], [113.5, 51.10, Y.NE], 270), // the E road court ↔ T_ne (user 2026-11-15: the old top sat 1.0 m inside T_ne, 0.40 m short, with the last cheek coping 0.25 m proud of the paving. Top at the T_ne S edge, 0.10 m short, at its paving; the foot stays, so the run is 6.90 — pitch 30.1°, tread 0.345 — and the coping ends flush.)
  stairs('S_ne2', [125, 46.5, Y.NE], [127.62, 43.59, Y.BAT], 315), // T_ne ↔ the NE battlements (by blk_ne): top at the cw_e2 band edge, at the walk
  stairs('S_ne3', [111, 25, Y.BAT], [108.04, 22.93, Y.N], 215), // the NE battlements ↔ T_n: top at the T_n edge, at its paving
  // the wall walk over the two gate arches and the water gate (the passages below stay at ground level)
  plank('P_gsw', [54.07, 113.26, Y.BAT], [59.93, 114.74, Y.BAT], 15),
  plank('P_gse', [113.9, 116.1, Y.BAT], [118.1, 111.9, Y.BAT], 315),
  plank('P_wg', [139, 85, Y.BAT], [139, 79.5, Y.BAT], 270),
];

// ---------------------------------------------------------------- enemies (dossier §8; `prima` = Prima's soldier number)
// Nobody arrests in the castle (no cells): jail false everywhere. Heights: `y` = the level the man stands on.
const at = (y) => (y ? { y } : {});
/**
 * Sweep period per post, 9–12 s from the id: the engine's random phase is under a second, so equal periods would
 * keep every sentry's sweep in step for the whole mission and some blind windows would never open.
 */
export const sweepPeriod = (id) => 9 + ([...id].reduce((n, ch) => n * 31 + ch.charCodeAt(0), 7) % 7) / 2;
/** Post guard: holds his post and investigates bodies only (§8 default). */
const sentry = (id, prima, x, z, y, h, sweep, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'sentry', x, z, ...at(y), heading: deg(h), jail: false,
  flags: { holdsPost: true, investigates: false }, post: { heading: deg(h), sweep, period: sweepPeriod(id) }, ...extra,
});
/** Lone walker: PINGPONG over `pts` (1.0 m/s) from the first point, facing the second. */
const walker = (id, prima, y, pts, extra = {}) => ({
  id, ...(prima ? { prima } : {}), soldierType: 'soldier', x: pts[0].x, z: pts[0].z, ...at(y), jail: false,
  heading: Math.atan2(pts[1].z - pts[0].z, pts[1].x - pts[0].x), flags: { investigates: true }, route: { type: 'PINGPONG', vel: 1.0, points: pts }, ...extra,
});
/** A patrol: sergeant `ids[0]` + troopers in file on one LOOP route. */
const patrol = (ids, prima, sq, points) => ids.map((id, k) => ({
  id, ...(prima ? { prima } : {}), soldierType: k ? 'trooper' : 'sergeant', x: points[0].x, z: points[0].z + 1.2 * k, jail: false,
  heading: Math.atan2(points[1].z - points[0].z, points[1].x - points[0].x),
  flags: { investigates: true, followsTracks: !k }, squad: { id: sq, leader: ids[0], columns: 1 }, route: { type: 'LOOP', vel: 1.0, points },
}));

const HQ_MEN = [ // §8.1 the HQ terrace and the SW bastion (Prima Phase 1: the GB alone)
  walker('e1', 1, Y.HQ, [P(32, 73, 4, 90), P(7, 73, 4, 180)]),
  sentry('e2', 2, 35.5, 75.5, Y.HQ, 60, 60), // "the guard by the searchlight" [ooc]
  sentry('e3', 3, 29.5, 56.5, Y.TUR, 135, 120), // atop the turret [P][NL][fd]
  walker('e4', 4, Y.SW, [P(24, 84, 3, 180), P(36, 86, 3, 0)]),
  sentry('e5', 5, 27, 89.5, Y.SW, 80, 40), sentry('e6', 6, 31, 89.5, Y.SW, 100, 40), // "the two looking south" [ooc]
];
const WALL_MEN = [ // §8.2 the battlements, counter-clockwise (Prima Phase 2)
  walker('e7', 7, Y.BAT, [P(40, 98, 3, 225), P(84, 123.5, 3, 90)]), // over the SW gate [DE]
  sentry('e63', null, 97.5, 127.5, Y.BAT, 70, 30, { partner: 'e64' }), // the S corner: leave them alive (T3)
  sentry('e64', null, 100.5, 127, Y.BAT, 110, 30, { partner: 'e63' }),
  sentry('e8', 8, 106, 122, Y.BAT, 120, 40),
  sentry('e9', 9, 124, 108.5, Y.BAT, 135, 40), // in view of the range below [P]
  walker('e10', 10, Y.BAT, [P(139, 95, 4, 0), P(139, 86.5, 4, 0)]), // watches the E field and the moat [NL]
  // on the walk's inner half: from its middle his near band (18 m) reached the E map edge (157), so the E group could not
  // crawl S out of the NE fields at all (sol/m20); from here a 1.5 m lane along the edge stays beyond it
  sentry('e11', 11, 137.2, 62, Y.BAT, 0, 90),
];
const RANGE_MEN = [ // §8.3 the firing range (Prima Phase 3)
  sentry('e12', 12, 132, 73.5, 0, 200, 40),
  walker('e13', 13, 0, [P(127, 70.5, 3, 0), P(108, 70.5, 3, 180)]),
  sentry('e14', 14, 123.6, 80.2, 0, 135, 40), // (castle pass: 2.7 m E, clear of the firing line's targets)
  sentry('e18', 18, 110, 80, 0, 0, 60, { post: { heading: 0, sweep: 60, period: 12 } }), // watches the ladder corner [P]
  sentry('e15', 15, 128.5, 88.5, 0, 180, 40), // "15's post", 4 m from the pool
  sentry('e16', 16, 125.2, 89.6, 0, 270, 30), // (castle pass: by the firing line's E end, watching the range from behind it)
  sentry('e17', 17, 122.8, 89.2, 0, 180, 40), // (castle pass: 3.8 m E, at the firing line's E end)
  walker('e19', 19, 0, [P(108, 95, 12, 0), P(115, 97, 5, 0)]), // the shooter, "checking his target" [P]
  sentry('e20', 20, 113, 101.5, 0, 90, 40),
  sentry('e21', 21, 105, 100.5, 0, 225, 30),
  sentry('e62', null, 102, 108.5, 0, 45, 30), // "the soldier across the street" [P]
];
/** Patrol 26 (4 men): through the SW gate, the junction, the SE gate and back round the S field outside [P][ooc][DE]. */
// (the halt by the barracks' S corner at (81, 92.2): the game draws the barracks wider than its footprint, and at (80, 93)
// the four never reached their halt — their walks ended 1.3 m short, past the route's tolerance — and stood re-planning)
// (castle pass layout audit: the pass-through corners where the four walked round the guardhouse's W and N corners and
// the workshop's N corner anyway — the route as walked, clear of every building)
export const P26_ROUTE = [P(36, 140, 5, 0), P(54, 127.5), P(57, 114), P(70, 101), P(67.9, 96.6), P(78.9, 89.85), P(80.3, 89.95),
  P(81, 92.2, 4, 0), P(98, 99), P(100.2, 99.6), P(116, 114), P(124.5, 123), P(110, 140, 5, 90), P(70, 145)];
/**
 * The firing line (castle pass, user 2026-11-10: "shooting range with soldiers actively shooting inside the castle"):
 * three riflemen at practice — lying, kneeling, standing — on their lanes N to ring targets (tgt_8-10) in front of the
 * range's earth backstop (the berm `range`), their NCO pacing behind them. While the castle is calm they shoot at their
 * targets (scripts/m20-range.js: aimed rounds, a fresh clip now and then); a man alarmed, sent to look or fighting is a
 * soldier like any other. Their practice is why a pistol shot on the range goes unnoticed (set-piece range_sp `live`:
 * only while one of them is still at it). Their cones look N down the lanes; the NCO watches his men (his sight 22 m).
 */
export const RANGE_LANES = [
  { id: 'e68', pose: 'prone', at: [114.5, 89.5], target: [114.5, 77.6] },
  { id: 'e69', pose: 'kneel', at: [117.0, 89.5], target: [117.0, 77.6] },
  { id: 'e70', pose: 'stand', at: [119.5, 89.5], target: [119.5, 77.6] },
];
export const RANGE_NCO = [P(113.5, 92.6, 5, 270), P(120.5, 92.6, 5, 270)];
const RANGE_LINE = [
  ...RANGE_LANES.map((l, k) => sentry(l.id, null, l.at[0], l.at[1], 0, 270, 10,
    { range: { pose: l.pose, target: l.target, seed: k + 1 }, flags: { holdsPost: true, investigates: false } })),
  // (the NCO keeps to his line like his men: no noise draws him off it — only the alarm, a body or a man in his sight)
  walker('e71', null, 0, RANGE_NCO, { soldierType: 'sergeant', range: { nco: true }, vision: { near: 12, far: 22 }, flags: { investigates: false } }),
];
const SW_MEN = [ // §8.4 the SW gate and the W quarter (Prima Phase 4)
  ...patrol(['p26', 'p26b', 'p26c', 'p26d'], 26, 'p26', P26_ROUTE),
  sentry('s25a', 25, 55.5, 115.7, 0, 105, 20), sentry('s25b', 25, 57.5, 116.2, 0, 105, 20), // rear pair, in the arch
  sentry('s25c', 25, 52.5, 127.5, 0, 105, 30), sentry('s25d', 25, 58, 128.5, 0, 105, 30), // front pair, beyond the bridge
  sentry('e22', 22, 60, 107.5, 0, 60, 40),
  sentry('e23', 23, 51, 103, 0, 300, 40),
  walker('e24', 24, 0, [P(55, 101, 3, 270), P(55.5, 99.4), P(60.5, 94.6), P(61.9, 94.65), P(66, 96, 3, 0)]), // (round the store's W and N corners, as he walked)
  sentry('e27', 27, 69, 97, 0, 225, 40),
  sentry('e65', null, 73, 104, 0, 225, 40), // "the soldier across the street from 27" [P]
  sentry('e28', 28, 48, 91, 0, 300, 40),
  walker('e29', 29, 0, [P(48, 75, 4, 270), P(58.2, 75.4), P(58, 76.5, 4, 0)]), // (his E halt reached from the N, round the stable's corner)
  sentry('e30', 30, 47, 84, 0, 180, 40), // watches the clothesline [P]
  sentry('e31', 31, 45.5, 80.5, 0, 90, 40), // by the outhouse [fd]
  sentry('e32', 32, 61, 78.5, 0, 180, 60), // at the foot of S_gw: "the stairs by 32's post" [P]
  sentry('e33', 33, 47, 70.5, Y.NW, 60, 50, { flags: { holdsPost: true, investigates: true } }), // "at the top of the castle": comes down [P]
  sentry('e34', 34, 53, 70.5, Y.NW, 80, 40, { flags: { holdsPost: true, investigates: true } }), // faces T_wb, his back to the HQ strip
];
const HQ_GUARD = [ // §8.5 the HQ (Prima Phase 5: the Spy in uniform)
  sentry('e35', 35, 10, 64.5, Y.HQ, 90, 40), sentry('e36', 36, 15, 64.5, Y.HQ, 90, 40), // "the 2 outside the HQ" [fd]
  // "the guard above the flak ... patrols now and then" [NL]; at his S end he looks E over T_nw, not W down the strip
  walker('e37', 37, Y.HQ, [P(35, 59, 20, 0), P(36, 66, 6, 0)]),
  sentry('e38', 38, 37, 70, Y.HQ, 0, 40),
  sentry('e39', 39, 17, 67, Y.HQ, 270, 30),
  // watches e35 and e39 (sweep 60, not the dossier's 100: his S extreme would look down on e2's post)
  sentry('e40', 40, 29, 63, Y.HQ, 180, 60, { flags: { holdsPost: true, investigates: true }, post: { heading: deg(180), sweep: 60, period: 8 } }),
];
const TANK_MEN = [ // §8.6 the tank corner (Prima Phase 6)
  sentry('e42', 42, 117.5, 69.5, 0, 180, 40), // lured by the decoy by bk_e [P]
  sentry('e43', 43, 115.5, 46.5, Y.NE, 225, 40), // at blk_ne's door
  sentry('e44', 44, SNIPER_POST.x, SNIPER_POST.z, Y.BAT, 200, 40), // his post is the Sniper's firing point
  walker('e45', 45, Y.BAT, [P(116, 29.5, 3, 180), P(131, 43.5, 4, 0)]),
  sentry('e46', 46, 106, 62, 0, 180, 40),
  sentry('e47', 47, 111, 55, 0, 90, 40),
  sentry('e48', 48, 114, 69, 0, 90, 30), // by flak_road
  sentry('e49', 49, 103, 29, Y.N, 90, 60, { flags: { holdsPost: true, investigates: true } }), // "decides to come down" [P]
  sentry('e50', 50, 104, 53.5, 0, 270, 30),
  sentry('e51', 51, 99, 59, 0, 0, 40),
  sentry('e52', 52, 100, 45, 0, 180, 40),
  walker('e53', 53, 0, [P(97.5, 74, 4, 90), P(101.5, 68.2), P(101.4, 66.8), P(88.4, 47.6), P(89.6, 44), P(96.8, 45.2, 4, 270)]), // (round the V2 trailers' ends, as he walked) (sol/m20-v2, 2026-11-18: his N end, (97.5, 40) by way of (92.6, 40.7), lay in the court's NE corner that the re-seated S_n and S_ne1 (user 2026-11-15) and the crates by them now wall in — reachable only up S_e, over the NE terrace and down S_ne1, a 65 m round he searched for each lap (16-18 ms): he halts S of the crates instead, looking N past them)
  sentry('e54', 54, 93, 57, 0, 180, 60), // between the V2s
  { id: 'e55', prima: 55, soldierType: 'gunner', x: ATGUN.x, z: ATGUN.z, heading: deg(294), emplacement: 'atgun', elevated: true, jail: false,
    post: { heading: deg(294), sweep: 40, giro: 180 } }, // the AT gunner: shoot him (knife/syringe refused)
  sentry('e56', 56, 86, 41.5, 0, 0, 40), // beside the tank
  ...patrol(['p57', 'p57b', 'p57c'], 57, 'p57', [P(74, 42, 4, 90), P(73.25, 50.8), P(74, 56), P(76, 76), P(100, 77), P(111, 71, 3, 0), P(107.4, 67.8), P(104, 58), P(84, 55)]), // (past the AT gun's bags and the E court's Flak, as walked)
];
const OTHER_MEN = [ // §8.7 the SE gate and the rest
  sentry('e58', null, 116.7, 116.1, 0, 45, 20), sentry('e59', null, 118.1, 114.7, 0, 45, 20), // rear pair, in the SE arch
  sentry('e60', null, 120.5, 126, 0, 45, 30), sentry('e61', null, 126.5, 125, 0, 45, 30), // front pair, beyond the bridge
  sentry('e66', null, 88, 22.5, Y.N, 90, 60), // the N Flak's crewman
  walker('e67', null, Y.N, [P(60, 26, 6, 90), P(100, 26, 6, 90)]),
];

// (the firing line last: every other man keeps his place in the roster)
const ENEMIES = [...HQ_MEN, ...WALL_MEN, ...RANGE_MEN, ...SW_MEN, ...HQ_GUARD, ...TANK_MEN, ...OTHER_MEN, ...RANGE_LINE];

// ---------------------------------------------------------------- vehicles (dossier §6.2)
const VEHICLES = [
  // the Panzer III, vacant: the Driver drives, all six ride; heavy armour (bombs and shells only)
  { id: 'pz3', vehicleType: 'panzer3', label: 'Panzer III', x: TANK_AT.x, z: TANK_AT.z, heading: deg(180), driveable: true, operators: ['driver'], seats: 6, suspicious: false },
  // the fixed anti-tank gun (never manned by us); its gunner e55 fires on the tank once a commando is at the controls
  { id: 'atgun', vehicleType: 'atgunM20', label: 'Anti-tank gun', x: ATGUN.x, z: ATGUN.z, heading: deg(294), gunner: 'e55', driveable: false },
];

// ---------------------------------------------------------------- commandos (§3.8 row 20, exact; §3.8 team order): prone behind their rocks
const COMMANDOS = [
  // the W group lies W of rk_w1: at the dossier's (9,91.5)/(12,92.5), S of the rock, e4 on the SW bastion saw them
  // prone from his W halt (near band, 0.7 s in); W of the rock they are beyond his near band and under the rock
  { role: 'greenberet', x: 4.5, z: 87, heading: deg(270), stance: 'crawl', inventory: { knife: 1, pistol: 1, decoy: 1 } },
  { role: 'sniper', x: 152.5, z: 31, heading: deg(180), stance: 'crawl', inventory: { pistol: 1, sniperRifle: 5 } },
  { role: 'diver', x: 154.5, z: 32.5, heading: deg(180), stance: 'crawl', inventory: { knife: 1, pistol: 1, harpoon: 1, divingGear: 1, inflatableBoat: 0 } },
  { role: 'sapper', x: 152.5, z: 35, heading: deg(180), stance: 'crawl', inventory: { pistol: 1, bearTrap: 1, grenade: 2, remoteBomb: 2 } },
  { role: 'driver', x: 154.5, z: 36.5, heading: deg(180), stance: 'crawl', inventory: { pistol: 1, firstAid: 6 } }, // the medic
  { role: 'spy', x: 4.5, z: 89.5, heading: deg(270), stance: 'crawl', inventory: { pistol: 1, lethalInjection: 1 } }, // no uniform
];

// ---------------------------------------------------------------- zones and garrisons (dossier §9)
export const Z_ALL = [[0, 0], [157, 0], [157, 162], [0, 162]];
const squad = (exitRoute, loop) => ({ event: 'RINT', size: 3, exitVel: 2.7, exitRoute, loopVel: 1.8, loop });
const BARRACKS = {
  bk_e: { pool: 6, squads: [squad([P(124, 70), P(116, 71)], [P(116, 71), P(106, 72), P(104, 58), P(110, 62)])] },
  bk_s: { pool: 6, squads: [squad([P(78, 88)], [P(78, 88), P(80, 93), P(70, 101), P(60, 109), P(70, 101)])] },
};

/** On the SW road's last stretch, clear of the map edge so a straight drive order to its centre is accepted. */
export const EXIT = { x: 4, z: 154, r: 6 };
/** The soft-lock guard (T7): both charges spent (none in hand, none armed) and the HQ still standing. */
export const NO_CHARGES_FAIL = 'WITHOUT EXPLOSIVES THE HEADQUARTERS CANNOT BE DESTROYED.';
export const TANK_FAIL = 'THE TANK HAS BEEN DESTROYED. THERE IS NO OTHER WAY OUT.';

/** T2: the Spy is dressed once he has put the uniform on (the clothesline only puts it in his kit). */
export const spyDressed = (w) => w.commandos?.some((c) => c.role === 'spy' && c.alive !== false && c.disguised === true);

// ---------------------------------------------------------------- barbed wire (docs/barbed-wire.md §12)
/** The M4–M20 wire pass: see-through, uncrossable (B.FENCE) runs added where the wire belongs; none crosses a route
 *  or lengthens an approach (tests/unit/wire-placements.test.mjs). Drawn by the map's wire layer (art/wire-obstacles.js). */
const WIRE_PASS = [
  // a concertina in front of the anti-tank gun: an arc ~4.3 m out, centred on the muzzle (heading 294°); its W end
  // stops short of the diagonal walk past the nest's front to the court (driver → p57b stays as short as without it)
  { id: 'wx_atgun', type: 'fence', variant: 'concertina', points: [[78.3, 46.4], [79.6, 46.9], [80.6, 47.9], [81.2, 49.1]], h: 1.2 },
];

export default {
  id: 'm20',
  campaign: 'BEL',
  title: 'Operation Valhalla',
  subtitle: 'Gundelfingen castle, north of Freiburg, Germany · 11 February 1945',
  date: '1945-02-11',
  place: 'Gundelfingen castle, north of Freiburg, Germany',
  theater: 'temperate',
  variant: 'frost',
  coneColors: 'green',
  size: [157, 162],
  seed: 1945_0211,
  // farmland fringe (art/terrain/bocage.js): field hedges, crops and orchards on the clear map edges, hedges
  // backing walls (visual only: laid out clear of every gameplay point and route)
  // reeds: false — the castle's water is masonry-lined (the moat runs deep to the walls, the fire-water pool is a cut-stone
  // basin): no reed beds on it (they hid the pool and the lever corner)
  vegetation: { farmland: { crops: 'none', orchards: 0.5 }, reeds: false },
  briefing: {
    historical: 'February 1945. The Red Army is in East Prussia and the end of the Reich is in sight. But a coded signal has shaken Allied headquarters: an enemy agent has stolen plans from the Manhattan Project, our atomic bomb programme. They lie in Gundelfingen castle, north of Freiburg, waiting to go east to a hidden German laboratory.',
    text: 'Officer, this is the most important job we have ever handed you, and I can tell you almost nothing about it. You will be on your own. Get inside that fortress and leave nothing standing: the headquarters, and the two rockets parked in its courtyard. Then take the tank they keep there and drive out through the south-west gate. Do this and the war may be over. Fail, and heaven help us all. Every eye in London is on you and your men. Good luck, son.',
    objectivesSummary: 'Blow up the headquarters and destroy both V2 rockets, then everyone into the Panzer III and out through the south-west gate.',
    // the Colonel's tour as it was before the castle pass (its narrated captions are recorded: art/ui tour.js would now
    // count the firing line's men round the range's busiest spot); the same stops, in the same words
    tour: [
      { kind: 'start', x: 103.83, z: 51.92, text: 'Officer, your 6 men go in here. Keep them together until you know the ground.' },
      { kind: 'objective', x: 15.5, z: 50, text: 'Your objective: blow up the headquarters. I have circled it in red.' },
      { kind: 'objective', x: 96, z: 50, text: 'Your objective: destroy both V2 rockets. I have circled it in red.' },
      { kind: 'danger', x: 120.5, z: 79.5, text: 'Watch this spot: 6 guards cover it. Study their cones before you move.' },
    ],
    hints: [
      'Four sentries stand at each gate. There is only one place on the walls a climber can get up: the west wall, below the headquarters.',
      'The firing range is at practice all day: there a pistol shot is just one more round. The guards may come to look, but nobody sounds the alarm for it - as long as the riflemen are still shooting.',
      'A lever under a flashing red lamp, inside the east wall, opens an underwater gate from the moat.',
      'A German uniform hangs on a line in the west quarter.',
      'The two sentries standing together at the south corner of the walls watch each other. Kill either one and the whole castle hears of it.',
      'A tank stands in the north courtyard. A fixed anti-tank gun covers it, and its crewman cannot be reached with a knife. One hit from that gun and the tank is finished.',
      'The headquarters is stone: only the Sapper\'s charges will bring it down, and he has two. Place one close against its walls.',
    ],
  },
  lighting: { sunElevDeg: 15, sunAzimuthDeg: 200, kelvin: 6800, hdri: 'overcast', fog: 170, lut: 'temperate_frost' },
  water: { velocity: 0, angleDeg: 0, turbulence: 0.1, color: '#1d4a4c' },
  shoreShallowWidth: 0.5, // the moat and the pool are deep to the walls: only the Marine goes in
  rules: { roofRule: false }, // §4.4 / §14 E1: the wall walks and terraces are open ground, not roofs
  baseTerrain: 'grass',
  terrain: TERRAIN,
  // render-only: no grass tufts or ground litter under the bridges' decks and landings (tufts poked up between the
  // planks) or on the paved terraces (dark litter along their parapets: a kept castle), review 2026-11-11
  bareGround: [...STRUCTURES.filter((q) => q.type === 'bridge').map((b) => {
    const c = Math.cos(b.rot ?? 0), n = Math.sin(b.rot ?? 0), L = b.w / 2 + 2.2, H = b.d / 2 + 1.2;
    return [[-L, -H], [L, -H], [L, H], [-L, H]].map(([u, w]) => [+(b.x + c * u - n * w).toFixed(2), +(b.z + n * u + c * w).toFixed(2)]);
  }), ...STRUCTURES.filter((q) => q.type === 'cliff' && /^t_/.test(q.id) && q.points).map((q) => q.points),
  // (and the curtains' wall walks: litter specks lay on their paving too)
  ...STRUCTURES.filter((q) => q.type === 'castle_wall' && q.points).flatMap((q) => q.points.slice(1).map((b, k) => {
    const a = q.points[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, h = (q.width ?? 5) / 2 + 0.3;
    return [[a[0] + nx * h, a[1] + nz * h], [b[0] + nx * h, b[1] + nz * h], [b[0] - nx * h, b[1] - nz * h], [a[0] - nx * h, a[1] - nz * h]].map((p) => p.map((v) => +v.toFixed(2)));
  }))],
  moatRing: MOAT_RING, // (the castle art's counterscarp follows it: art/m20-castle.js)
  pavements: PAVEMENTS,
  furniture: FURNITURE,
  // placement rule (c): deliberate compound joins (wings, towers, party walls) — joinStructures
  structures: joinStructures([...STRUCTURES, ...WIRE_PASS], [['gh_sw', 'br_sw'], ['gh_se', 'br_se'], ['turret', 'hq'], ['turret', 'flak_hq'], ['hq', 'hq_wing'], ['hq_wing', 'n_range'], ['hq_wing', 'flak_hq'], ['n_range', 'blk_n'], ['n_range', 'flak_n'], ['h_s3', 'h_tur'],
    // art pass: the masonry is one compound — curtains bond into the gatehouses, terraces abut the buildings and walls
    // they retain, props stand on the levels (castle-kit draws each face once; these contacts are the bonds)
    ['cw_sw', 'gh_sw'], ['cw_s', 'gh_sw'], ['cw_s', 'gh_se'], ['cw_e1', 'gh_se'], ['cw_w', 'crag'], ['cw_w', 't_hq'],
    ['cw_w', 't_sw'], ['cw_w', 't_par_hq_s'], ['cw_sw', 't_sw'], ['cw_e2', 't_n'], ['crag', 'n_range'], ['gh_in', 't_wb'],
    ['blk_ne', 't_ne'], ['n_range', 't_n'], ['n_range', 't_ne'], ['n_range', 't_nw'], ['n_range', 't_par_n'], ['hq', 't_hq'],
    ['hq_wing', 't_hq'], ['turret', 't_hq'], ['flak_hq', 't_hq'], ['flak_n', 't_n'], ['sl_hq', 't_par_hq_e'], ['sl_t', 'turret'],
    ...M20_DRESSING_JOINS, // (art pass 2: the N Flak's ammunition, rangefinder and barrel cases on T_n, the fire point on T_ne)
    // castle pass (tests/unit/m20-castle.test.mjs: every overlap of solids is a declared join): the SW curtain runs into
    // the bastion's corner under its parapet; the HQ terrace, its forecourt screen and the château's wing stand on the
    // crag; the N rampart's parapet on its edge; the range's E bullet stop is built against the curtain's inner face, its
    // N one runs through the target berm (the berm's art stops short of it: m20-art crossingStops)
    ['cw_sw', 't_par_sw_s'], ['cw_w', 't_par_sw_w'], ['crag', 't_hq'], ['crag', 't_par_hq_b'], ['crag', 'hq_wing'], ['t_n', 't_par_n'],
    // layout audit: the smithy is built against the SW curtain (its W gable stands on the curtain's inner face); the
    // inner gate's sentry box stands against its S face, E of the arch
    ['h_w2', 'cw_sw'], ['gh_in', 'gbox_in']]),
  items: [],
  // §3.4 the Spy's uniform on the clothesline in the W quarter ('use' it: the uniform goes in his kit; he then puts it on)
  interactables: [{ id: 'uniform_line', interactKind: 'clothesline', x: 42.5, z: 87.5 }],
  vehicles: VEHICLES,
  commandos: COMMANDOS,
  enemies: ENEMIES,
  // one zone for the whole castle and its approaches [§7.1 "whole castle alarm"]: seen or heard → the siren
  zones: [{ id: 'z_all', poly: Z_ALL, onSeen: 'RINT', onHeard: 'RINT', siren: true }],
  jails: [],
  barracks: BARRACKS,
  climbLinks: CLIMBS,
  ladders: LADDERS,
  triplines: [],
  objectives: [
    { id: 'o1', text: 'Blow up the headquarters', type: 'destroy', targets: ['hq'], required: true },
    { id: 'o2', text: 'Destroy both V2 rockets', type: 'destroy', targets: V2S, required: true },
    { id: 'o3', text: 'Then everyone into the tank and out through the south-west gate', type: 'escape', required: true, vehicleId: 'pz3' },
  ],
  setpieces: [
    // pistol shots inside the range are routine: guards may look, the siren never sounds for them
    // (castle pass: while the firing line is at practice — its fire is why a pistol shot passes for one more round)
    { type: 'firing_range', id: 'range_sp', kinds: ['pistol'], area: { poly: RANGE }, live: 'range' },
    // the lever under the flashing red lamp opens the underwater water gate for good
    { type: 'gate_control', id: 'wg_ctl', once: true, open: false, area: { rect: WATER_GATE },
      control: { at: LEVER, id: 'lever_wg', label: 'Lever', blink: true, roles: null } },
  ],
  triggers: [
    { on: 'start', do: [{ message: 'Gundelfingen. The headquarters, both rockets, then out in their tank.', kind: 'info' }] },
    // T1 the water gate
    { on: 'device', match: { id: 'lever_wg' }, do: [{ message: 'The water gate is open. The Marine can swim in from the moat.', kind: 'info' }] },
    // T2 the uniform
    { on: 'tick', when: (p, w) => spyDressed(w), do: [{ message: 'The Spy is in German uniform.', kind: 'info' }] },
    // T3 the S-corner pair must be left alive (§7.1, Prima Phase 2): either death sounds the siren
    { on: 'unit:killed', match: { unit: ['e63', 'e64'] }, do: [{ alarm: 'global', cause: 'scorner', x: 99, z: 127 }] },
    // T4 the tank
    { on: 'vehicle:enter', match: { vehicle: 'pz3', unit: 'driver' },
      do: [{ message: 'Panzer III. While the anti-tank gun is manned, one hit will finish it.', kind: 'warn' }] },
    // T5 progress
    { on: 'structure:destroyed', match: { id: 'hq' }, do: [{ message: 'The headquarters is gone.', kind: 'objective' }] },
    { on: 'structure:destroyed', match: { id: V2S }, once: false,
      do: [{ run: (w) => { const n = V2S.filter((id) => w.byId(id)?.destroyed).length; if (n < 2) w.events.emit('message', { text: 'One rocket destroyed.', kind: 'info' }); } }] },
    { on: 'objective', match: { status: 'done' }, when: (p, w) => ['o1', 'o2'].every((id) => w.objectives?.find((o) => o.id === id)?.done),
      do: [{ message: 'Everyone into the tank. Out through the south-west gate.', kind: 'objective' }] },
    // T6 the tank is the only way out
    { on: 'vehicle:destroyed', match: { vehicle: 'pz3' }, do: [{ fail: TANK_FAIL }] },
    // T7 soft-lock guard: no charge left and the HQ still standing
    { on: 'bomb:exploded', once: false, delay: 0.5, do: [{ run: (w, dir) => checkCharges(w, dir) }] },
  ],
  // mission glue: the prone start, the terrace prisms and stairs, lifted terrace props
  script: m20Script,
  // the player drives the tank out: all living men aboard, o1 + o2 done, inside the SW road's exit
  extraction: { vehicleId: 'pz3', exit: EXIT },
  // (the Panzer III clears what the castle draws, not the walkers' clearance round it — grid.hullBlocked: through the
  // SW gate's 4.5 m passage and between h_w3 and the barracks, design E9)
  hullDrawn: true,
  alarmFail: null,
  par: { time: 1080 },
  cameraStart: { x: 20, z: 88, zoom: 1 },
  startDisguised: [],
  flags: { shovel: false },
};

/** T7: fail when the Sapper has no bomb left, none is armed on the map and the HQ stands. */
export function checkCharges(w, dir) {
  const hq = w.byId?.('hq');
  if (!hq || hq.destroyed) return false;
  const left = (w.commandos || []).filter((c) => c.alive !== false).reduce((n, c) => n + (c.inventory?.get?.('remoteBomb') ?? 0) + (c.inventory?.get?.('timeBomb') ?? 0), 0);
  const armed = (w.interactables || []).some((i) => i.interactKind === 'bomb' && !i.removed && !i.exploded)
    || (w.projectiles || []).some((p) => !p.removed && (p.projKind === 'remoteBomb' || p.projKind === 'timeBomb'));
  if (left || armed) return false;
  if (dir?.fail) dir.fail(NO_CHARGES_FAIL);
  return true;
}
