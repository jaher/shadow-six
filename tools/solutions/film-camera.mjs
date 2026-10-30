/**
 * Where the film camera looks (capture-video.mjs): the height of the ground under a point of interest.
 *
 * `world.groundY` is the terrain relief alone. Where the mission raises the ground on a deck — M5's summit (16 m), M3's dam
 * crest (7.3 m) — it says 0, and a view centred on (x, groundY, z) lands `y·cot(pitch)` metres (19 m for the summit) short of the
 * point: the barracks the film is about to blow up sat under the HUD, and the opening's "Destroy the barracks" stop showed
 * its shadow. A man on the deck carries the right `y` (his own); a structure does not (the interactable's `y` is an offset over
 * the surface, 0, and the grid has no walking surface inside its footprint), so the surface is sampled round the point.
 */

/** Rings (m) round the point where the walking surface is looked up: a barracks is some 10 m across. */
export const STAND_RINGS = [0, 3, 5, 8];

/**
 * The height of the surface to centre the view on at (x, z): the highest of the terrain relief there and the game's walking
 * surface (`world.grid.surfaceY`: terrain, decks, steps) at the point and on rings round it.
 * @param {{groundY?: (x:number, z:number) => number, grid?: {surfaceY?: (x:number, z:number) => number}}} world
 * @returns {number} metres
 */
export function standHeight(world, x, z, rings = STAND_RINGS) {
  let y = Number(world?.groundY?.(x, z));
  if (!Number.isFinite(y)) y = 0;
  const g = world?.grid;
  if (typeof g?.surfaceY !== 'function') return y;
  for (const r of rings) {
    const n = r > 0 ? 16 : 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const v = g.surfaceY(x + r * Math.cos(a), z + r * Math.sin(a));
      if (Number.isFinite(v) && v > y) y = v;
    }
  }
  return y;
}
