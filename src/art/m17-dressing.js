/**
 * M17 Before Dawn (Riveauvillé, Alsace, 28 November 1944) second art pass: set dressing, kept in its own module so the
 * mission file only spreads it in (as M16's and M18's). Every piece that blocks stands ≥ 6 m off every guard's post and
 * beat, the patrols' and squads' runs and the vehicle routes, and off the spots the M17 solution work uses
 * (tests/unit/art-m17.test.mjs). What blocks is drawn and what is drawn blocks: the vineyard's trellis rows B.FENCE (they
 * stop feet, not eyes), the beet clamp B.LOW on its footprint; the ploughing and the paving are visual only.
 *
 * - the N bank: the E end of the rail-fenced field E of the Kommandantur is a vineyard — four rows of bare November
 *   vines on the high Alsatian trellis (art/vineyard.js), 2 m inside the fence
 * - the field W of the camp, between its W wall and the S road: ploughed for the winter (one soft-edged soil mesh draped
 *   on the drawn ground, its ridges a few cm high, art/field-clamp.js), the beet lifted and clamped at its S headland
 * - the Kommandantur's setts laid at its front door (they lay 4 m E of it, under the tree round the stores)
 * @module art/m17-dressing
 */
import { vineNavParts, VINE } from './vineyard.js';

const deg = (d) => (d * Math.PI) / 180;
/** A point in a frame (+x along `rot`, +z its door side) → world [x, z]. */
const local = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) - lz * Math.sin(rot), cz + lx * Math.sin(rot) + lz * Math.cos(rot)];
const r2 = (v) => Math.round(v * 100) / 100;

// --- the N bank vineyard: the E end of the rail-fenced field, x 58.5–68, its first row 2 m S of the fence along z 27. The
// field's W part stays grass: the M17 solution work draws e22 off his beat with a shot fired there (52, 33) and steps
// aside to (55, 31) (fix round 1: the rows ran x 44–68 over both spots)
const VROWS = 4, VX0 = 58.5, VX1 = 68, VW = VX1 - VX0;
const vineyard = { id: 'vineyard_n', type: 'crates', variant: 'vineyard', label: 'Vineyard', x: (VX0 + VX1) / 2, z: r2(29 + ((VROWS - 1) * VINE.gap) / 2), rot: 0,
  w: VW, d: r2((VROWS - 1) * VINE.gap + 1), h: VINE.h, rows: VROWS, block: 3, fixed: true };
vineyard.navParts = vineNavParts(vineyard);

// --- the ploughed field W of the camp: its long sides along the camp's W wall (62°, the furrows' heading; the E side 1.5 m
// off the wall), its ends on the headlands — the N one across the field, the S one along the beet clamp by the road.
// tree_12 stands at its W side, pole_3 off its SW corner. (fix round 1: the W side ran 18° across the furrows, so the
// ridges' square ends stepped down it in 2 m stairs)
const FD = deg(62), FO = [49.86, 149.88];
const F = (u, v) => [r2(FO[0] + u * Math.cos(FD) - v * Math.sin(FD)), r2(FO[1] + u * Math.sin(FD) + v * Math.cos(FD))];
/** NW, NE, SE, SW. */
export const FIELD_W = [F(-5.82, 12.2), F(0, 0), F(14.6, 0), F(10.37, 12.2)];
const clamp = { id: 'clamp_s', type: 'crates', variant: 'beet_clamp', label: 'Beet clamp', x: 46, z: 165.4, rot: deg(-9), w: 9, d: 2.4, h: 1.0, block: 1, fixed: true };
/** The clamp's ends (its axis) in the world. */
const clampEnds = [-1, 1].map((sg) => local(clamp.x, clamp.z, clamp.rot, (sg * clamp.w) / 2, 0).map(r2));
/** The ploughed field (art/field-clamp.js buildPloughedField): ridges along the field, headlands across its ends, the soil
 *  trodden flat round the clamp where the carts loaded; drawn by the mission's visuals. */
export const M17_FIELD = { poly: FIELD_W, dir: FD, spacing: 0.7, height: 0.085, head: 2.6, seed: 1944,
  aprons: [{ a: clampEnds[0], b: clampEnds[1], r: clamp.d / 2 + 1 }] };

export const M17_DRESSING = [
  vineyard,
  clamp, // the beet clamp along the field's S headland
];

/** The field's bare earth (terrain): the ploughing and the clamp's footprint (no grass through the soil). */
export const M17_TERRAIN = [{ type: 'poly', terrain: 'ground', points: FIELD_W },
  { type: 'poly', terrain: 'ground', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => local(clamp.x, clamp.z, clamp.rot, a * (clamp.w / 2 + 0.5), b * (clamp.d / 2 + 0.5)).map(r2)) }];

/** The Kommandantur's setts: from its front door (27.14, 44.14; the house faces 46°, SE) out to the HQ spur's end. */
const D = (lx, lz) => local(27.14, 44.14, deg(-44), lx, lz).map(r2);
export const M17_PAVE_HQ = [D(-2.4, 0.1), D(3.0, 0.1), D(4.6, 3.6), D(3.6, 5.2), D(-1.6, 3.4)];
