/**
 * Vegetation keeps off the water (user report 2026-10-08: "mission 1 there is  giant tree standing on the water, remove
 * it"). One rule for everything planted — the missions' own trees and bushes, forest fill and understorey, hedgerows,
 * orchards, the apron's scenery forest and bocage hedges, wildflowers and weed rosettes: its root (the trunk base)
 * keeps a strip of dry land between it and the waterline, so no trunk stands in the surf or on the shallows' ice rim.
 *
 * "Water" is the field the renderer draws: the continuous shore field (world/shore-field.js `wetAt`, signed metres,
 * > 0 in water) that carves the banks, paints the splat's wet line and masks the water surface — sea, lakes, rivers,
 * canals, the dam reservoir and frozen water / ice alike (they are all WATER / SHALLOW codes). Where that field is not
 * built yet (the placement pass) or failed, the nav grid's wet cells stand in (`cellWetAt`).
 * Pure (no three.js / DOM).
 * @module world/veg-shore
 */
import { T } from './grid.js';

/**
 * Dry land (m) a planted root keeps from the drawn waterline. The bank's carve starts 0.4 m inland of the line
 * (art/terrain/terrain.js), so 1 m keeps a trunk and its root flare on the level ground above it.
 */
export const SHORE_MARGIN = 1.0;
/**
 * The scenery forest past the map edge (art/apron.js): its trees are big impostors whose lowest skirt spreads ~2 m
 * round the trunk, and the 40° camera reads a conifer as standing where that skirt meets the ground; past the edge
 * nothing constrains them, so they keep their crowns off the water too.
 */
export const APRON_SHORE_MARGIN = 2.5;

/**
 * Ground plants (wildflowers, weed rosettes): dry land kept from the waterline — the bank's carve begins 0.4 m inland,
 * so they stop at its top. (Reeds are the exception: grass-place.js plants them in the shallows on purpose.)
 */
export const GROUND_SHORE_MARGIN = 0.5;

const isWet = (c) => c === T.WATER || c === T.SHALLOW;

/**
 * Approximate signed distance to the wet cells of a code grid (> 0 inside a wet cell, else minus the distance to the
 * nearest wet cell square, -reach when none is that close). For the placement pass (before the shore field exists)
 * and as the fallback when the shore field failed. Off the grid counts as dry.
 * @param {{cols:number, rows:number, cell:number, terrain:Uint8Array}} grid
 * @param {number} [reach] search radius (m)
 * @param {number} [ox] world x of the grid's (0, 0) corner @param {number} [oz]
 * @returns {(x:number, z:number) => number}
 */
export function cellWetAt(grid, reach = 4, ox = 0, oz = 0) {
  const { cols, rows, cell, terrain } = grid;
  const code = (i, j) => (i >= 0 && j >= 0 && i < cols && j < rows ? terrain[j * cols + i] : -1);
  const n = Math.ceil(reach / cell);
  return (x, z) => {
    const fx = (x - ox) / cell, fz = (z - oz) / cell, i0 = Math.floor(fx), j0 = Math.floor(fz);
    if (isWet(code(i0, j0))) {
      // inside: the distance to the nearest dry cell edge, at least a hair over 0 (the cell is water)
      let d = reach;
      for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
        const c = code(i, j);
        if (c < 0 || isWet(c)) continue;
        const dx = Math.max(i - fx, 0, fx - (i + 1)), dz = Math.max(j - fz, 0, fz - (j + 1));
        d = Math.min(d, Math.hypot(dx, dz) * cell);
      }
      return Math.max(1e-3, d);
    }
    let d = reach;
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      if (!isWet(code(i, j))) continue;
      const dx = Math.max(i - fx, 0, fx - (i + 1)), dz = Math.max(j - fz, 0, fz - (j + 1));
      d = Math.min(d, Math.hypot(dx, dz) * cell);
    }
    return -d;
  };
}

/**
 * The water field vegetation is checked against: the shore field's `wetAt` (world coordinates) when built, else the
 * grid's wet cells.
 * @param {{wetAt:(x:number,z:number)=>number}|null} shore world/shore-field.js result
 * @param {object} [grid] nav grid (fallback)
 */
export function vegetationWetAt(shore, grid = null) {
  if (shore?.wetAt) return shore.wetAt;
  return grid ? cellWetAt(grid) : () => -Infinity;
}

/** True when a root at (x, z) keeps `margin` m of dry land from the water. */
export const onDryLand = (wetAt, x, z, margin = SHORE_MARGIN) => wetAt(x, z) <= -margin;

/**
 * Drop the placements whose root stands in the water or within `margin` m of it.
 * @template {{x:number, z:number}} P
 * @param {P[]} list
 * @param {(x:number, z:number) => number} wetAt signed distance (> 0 in water)
 * @param {number} [margin]
 * @returns {P[]} the kept placements (the same array when nothing was dropped)
 */
export function keepOffWater(list, wetAt, margin = SHORE_MARGIN) {
  if (!wetAt || !list?.length) return list;
  const out = list.filter((p) => onDryLand(wetAt, p.x, p.z, margin));
  return out.length === list.length ? list : out;
}
