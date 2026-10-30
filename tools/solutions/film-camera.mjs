/**
 * Where the film camera looks (capture-video.mjs): the height of the ground under a point of interest, and the picture of a wait.
 *
 * `world.groundY` is the terrain relief alone. Where the mission raises the ground on a deck — M5's summit (16 m), M3's dam
 * crest (7.3 m) — it says 0, and a view centred on (x, groundY, z) lands `y·cot(pitch)` metres (19 m for the summit) short of the
 * point: the barracks the film is about to blow up sat under the HUD, and the opening's "Destroy the barracks" stop showed
 * its shadow. A man on the deck carries the right `y` (his own); a structure does not (the interactable's `y` is an offset over
 * the surface, 0, and the grid has no walking surface inside its footprint), so the surface is sampled round the point.
 */

import { frameWithPriority } from '../../src/debug/walkthrough-director.js';

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

/**
 * The wait framing (capture-video.mjs `--frame-waits`, a cut's `FRAME_WAITS`). While everyone waits the film runs at 16x or
 * more and the man the camera follows lies still: the picture would be a still one, the guards he waits for pacing at its
 * edge. The user's standing request for the walkthrough ("Also no long quiet periods, always action", 2026-10-15; the game's
 * debug/walkthrough.js _liveShot) goes for the film too: the camera shows the waiting man together with the guards the step
 * names (`tags`: its `look` / `cones` in the walkthrough, the ones whose eyes the wait is about), else the walkers near him.
 * A guard counts by his whole beat (the ends of his route), so the framing sits still while he paces inside it; a long patrol
 * counts where it is.
 */
export const WAIT_FRAME = Object.freeze({
  named: 48,     // m: the step's guards count within this of the man
  walkers: 30,   // m: else the nearest walkers (at most `walkersMax`) within this
  walkersMax: 3,
  longBeat: 36,  // m: a beat longer than this in x or z is a patrol: its guard counts where he stands
  rect: Object.freeze({ x: 20, y: 80, w: 1190, h: 520 }), // view px: below the top bar, above the caption, left of the notebook
  opts: Object.freeze({ minSpan: [24, 14], minZoom: 0.45, maxZoom: 0.8 }), // never closer than the film's usual view, never wider than 0.45
});

/**
 * The points that frame a wait: the waiting man first, then each guard the wait is for (his beat's ends, or where he stands).
 * @param {{x:number, y?:number, z:number}} man
 * @param {{tag?:string, x:number, y?:number, z:number, alive?:boolean, removed?:boolean, vehicle?:any, route?:{x:number,z:number}[]|null}[]} enemies
 * @param {Set<string>} tags the guards the step names
 * @returns {{x:number, y:number, z:number}[]|null} null when no guard is worth showing
 */
export function waitPoints(man, enemies, tags = new Set(), cfg = WAIT_FRAME) {
  const live = (e) => e && e.alive !== false && !e.removed && !e.vehicle;
  const beatOf = (e) => { // a walker's beat (the box he stays in), null for a post guard or a patrol too long to hold in one picture
    const r = e.route;
    if (!(r?.length > 1)) return null;
    const xs = r.map((p) => p.x), zs = r.map((p) => p.z);
    return Math.max(...xs) - Math.min(...xs) > cfg.longBeat || Math.max(...zs) - Math.min(...zs) > cfg.longBeat ? null : r;
  };
  // (how near he comes: his beat's nearest end as well as where he is, so a walker at the edge of the range does not come and go)
  const reach = (e) => Math.min(Math.hypot(e.x - man.x, e.z - man.z), ...(beatOf(e) || []).map((p) => Math.hypot(p.x - man.x, p.z - man.z)));
  let gs = enemies.filter((e) => live(e) && tags.has(e.tag) && reach(e) < cfg.named);
  // (nobody named: the walkers near him — not a patrol on the move, which the camera would have to chase at 16x)
  if (!gs.length) gs = enemies.filter((e) => live(e) && beatOf(e) && reach(e) < cfg.walkers).sort((a, b) => reach(a) - reach(b)).slice(0, cfg.walkersMax);
  if (!gs.length) return null;
  const pts = [{ x: man.x, y: man.y ?? 0, z: man.z }];
  for (const e of gs) for (const p of beatOf(e) || [e]) pts.push({ x: p.x, y: e.y ?? 0, z: p.z });
  return pts;
}

/**
 * The camera for a wait: the target (a ground point: the heights are in the framing) and zoom that show the man and the guards
 * of the wait (the walkthrough camera's own maths, debug/walkthrough-director.js: the man first, the farthest guards dropped
 * when all do not fit), or null.
 * @param {{az:number, el:number, width:number, height:number, ppm1?:number}} view
 */
export function waitFrame(man, enemies, tags, view, cfg = WAIT_FRAME) {
  const pts = waitPoints(man, enemies, tags, cfg);
  return pts ? frameWithPriority(pts, 1, view, cfg.rect, cfg.opts) : null;
}
