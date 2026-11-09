/**
 * The blast's path code kept compiled (a still screen's cache fill, engine/idle-warm.js). A blast changes the walk grid
 * and sends the whole camp searching in its tick: the static layers patched, a fresh area labelling flooded over the
 * map, a few dozen searches and their smoothing. That code runs rarely — a labelling only after the grid changes — and
 * a long walkthrough lets the engine drop its compiled form: M8's final blast ran its labelling flood cold, ~5 ms of its
 * tick, where the same flood compiled takes ~1. Here the same functions run on a scratch copy of the mission's grid:
 * nothing of the mission is read back or written (its layers copied; links, stair runs, ramps and stamps shared, read
 * only), the search count put back — the same answers in play whether this ran or not, only sooner.
 * @module world/path-warm
 */
import { NavGrid } from './grid.js';
import { findPath, warmAreas, staticLayersOf, searchStats } from './pathfinding.js';

/** The fields a scratch grid shares with its mission grid (never written by what runs on it). */
const SHARED = new Set(['links', '_linkIndex', 'ramps', 'runs', '_navStamps', '_overStamps', '_hullStamps', '_solidStamps']);

/** A copy of `grid` for the warm-up: its typed layers copied, the rest shared (see SHARED). */
function scratchOf(grid) {
  const s = new NavGrid(grid.width, grid.depth);
  for (const k of Object.keys(grid)) {
    const v = grid[k];
    if (ArrayBuffer.isView(v)) s[k] = v.slice();
    else if (SHARED.has(k)) s[k] = v;
  }
  s.version = 1;
  return s;
}

/** The rule sets the mission's men search under (one of each). */
function rulesOf(world) {
  const rules = new Map();
  for (const u of [...(world.enemies || []), ...(world.commandos || [])]) {
    if (u.removed || typeof u.pathQuery !== 'function') continue;
    const q = u.pathQuery() || {};
    rules.set(`${q.role}|${!!q.noLinks}|${!!q.noWalkLinks}|${!!(q.swim || q.allowWater)}`, q);
  }
  return [...rules.values()];
}

/** Long searches between living guards far apart: the n-th pair (every 5th man and the one 13 on), null past the end. */
function pairOf(world, n) {
  const men = (world.enemies || []).filter((e) => e.alive !== false && !e.removed && typeof e.pathQuery === 'function');
  const i = 5 * n;
  return i < men.length ? [men[i], men[(i + 13) % men.length]] : null;
}
const SEARCHES = 6;

/**
 * The warm-up as a list of small tasks for a still screen's share of a frame (engine/idle-warm.js runs them in order, a
 * few a frame): the scratch copy; each static layer; each rule set's labelling; the row-patched rebuild and the floods
 * again; each long search; the copy let go. One call of it all was a 20-60 ms frame on the walkthrough's first cards
 * (the code still cold there). A task that finds the mission's grid changed since the copy (a door, a stamp: the copy no
 * longer stands for it, the shared parts may have moved) ends the rest, and `cancel()` drops what is left (a newer card's
 * warm-up supersedes it). Each task puts the search count back.
 * @returns {Array<() => void> & {cancel: () => void, ran: () => number}} the tasks in order ([] for a world without a grid)
 */
export function blastPathTasks(world) {
  const grid = world?.grid, T = [];
  const st = { s: null, v: -1, dead: false, ran: 0 };
  T.cancel = () => { st.dead = true; st.s = null; };
  T.ran = () => st.ran;   // tasks that did their work (tests)
  if (!grid?.size || !grid.cols) return T;
  const rules = rulesOf(world);
  const run = (fn) => () => {
    if (st.dead) return;
    if (st.s && (world.grid !== grid || grid.version !== st.v)) { T.cancel(); return; }
    const e0 = searchStats.expanded;
    try { fn(st.s); st.ran++; } catch (e) { T.cancel(); throw e; } finally { searchStats.expanded = e0; }
  };
  const layers = () => T.push(run((s) => staticLayersOf(s, false)), run((s) => staticLayersOf(s, true)));
  const floods = () => { for (const q of rules) T.push(run((s) => warmAreas(s, q))); };
  T.push(run(() => { st.s = scratchOf(grid); st.v = grid.version; }));
  layers(); floods();
  // a change confined to known rows (a blast's stamps): the layers patched over them, the labellings flooded again
  T.push(run((s) => { const k0 = (s.rows >> 1) * s.cols + (s.cols >> 1); s.navStamp('warm', [k0, k0 + 1, k0 + s.cols]); }));
  layers(); floods();
  // long searches (their own rules, a smoothed path each) between living guards far apart
  for (let n = 0; n < SEARCHES; n++) T.push(run((s) => { const p = pairOf(world, n); if (p) findPath(s, p[0].x, p[0].z, p[1].x, p[1].z, { ...p[0].pathQuery(), maxNodes: 8000, memo: -1 }); }));
  T.push(() => { st.s = null; st.dead = true; });
  return T;
}

/**
 * Run the blast's path code on a scratch copy of `world`'s grid at once (blastPathTasks, every task in turn): static
 * layers (whole and row-patched), the area labellings of every rule set its men search under, and a few long searches.
 * @returns {boolean} it ran
 */
export function warmBlastPaths(world) {
  const T = blastPathTasks(world);
  for (const t of T) t();
  return T.length > 0;
}
