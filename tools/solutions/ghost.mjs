/**
 * Ghosts of live units for the solution planners: a stand-in for `Object.create(e)` — his fields read through, the
 * planner's own pose (x, z, heading, head offsets…) written on top — that never makes the unit `e` a prototype.
 *
 * Why: an object V8 sees used as a prototype is given a hidden class (map) of its own, and every later change of that map
 * (a field first set in play, a whole-number field turning fractional) throws away all the optimised code that read
 * anything through a ghost of him ("dependent prototype chain changed": ~150 functions at a time, the bulk of the
 * ~1 000-1 900 deopts per 100 s of an M3 walkthrough, and the code space they recompile into fills the old generation).
 * Every unit a solution looked at once stayed so for the rest of the run, the unit code megamorphic.
 *
 * How: one mirror per unit, a plain object of his class (`Object.create` of his class's prototype: his methods) holding
 * a copy of his own fields, refreshed (`Object.assign`) whenever ghosts of him are made; a ghost is `Object.create` of
 * the mirror. The mirror is the prototype — a private object whose shape changes only when he gains a field — never the
 * unit. A ghost reads what an `Object.create(e)` ghost read as long as he does not change between the refresh and the
 * read: ghosts are made and read within one call, or within one plan, while the world stands still (the planners'
 * memos rely on the same). Units never lose a field (no `delete` on a unit: see Unit's declarations), so a mirror holds
 * exactly his fields.
 * @module tools/solutions/ghost
 */

const MIRRORS = new WeakMap(), UNIT_OF = new WeakMap();
/** mutable()'s stand-in value: an object no field keeps. */
const PROBE = Object.freeze({ probe: true });
/**
 * A new mirror's fields known to change from the start (V8): a mirror refreshed with the same value keeps a field a
 * constant — a unit's blast flags, a destroyed structure's state — and the first refresh after it changed (a blast) threw
 * away every optimised function that read a ghost of him (M8's final blast: ~130 at once for blastReact alone). Each field
 * written once more with another value of its kind, then its own: the same values, only how V8 tracks them differs.
 */
function mutable(m) {
  for (const k of Object.keys(m)) { const v = m[k]; m[k] = typeof v === 'number' ? v + 1 : PROBE; m[k] = v; }
}

/** A live entity of its world (not a ghost, a vehicle's eye or a plain viewer record)? */
const isLive = (e) => e.world != null && e.world.byId?.(e.id) === e;

/**
 * Unit `e`'s mirror, refreshed: his own fields as they are now, his class's methods. Make ghosts of it with ghostOn.
 * Anything but a live entity (a ghost, a vehicle's eye, a plain viewer record) is its own mirror: ghosts of it are made
 * on it directly, as before (a throwaway object; nothing compiled for the units depends on its shape).
 */
export function mirrorOf(e) {
  if (!isLive(e)) return e;
  return mirrorFor(e);
}

/**
 * The mirror of any long-lived object — a unit (mirrorOf), or a unit's brain — refreshed as mirrorOf refreshes a unit's.
 * (a brain made a prototype — M8's prediction of a man staring at a lure did `Object.create(brain)` — took a map of its
 * own, its fields constants again: the blast's first noise threw away the AI's optimised code, ~60 functions at once)
 */
export function mirrorFor(e) {
  let m = MIRRORS.get(e);
  if (m === undefined) { m = Object.create(Object.getPrototypeOf(e)); MIRRORS.set(e, m); UNIT_OF.set(m, e); Object.assign(m, e); mutable(m); }
  else if (fresh !== null && fresh.has(e)) return m; // (refreshed already in this look: withMirrors)
  else Object.assign(m, e);
  if (fresh !== null) fresh.add(e);
  return m;
}

/** The units whose mirrors were refreshed in the open withMirrors look (null: none open). */
let fresh = null;

/**
 * Run `fn` (synchronous) as one look at a world that stands still: each unit's mirror is refreshed by the first mirrorOf
 * of him in it and read as it is by the later ones (the refresh copies all his fields — half the time of a look-ahead
 * that asks a guard's ghosts some thousand questions: M8's shootSeq). Nothing in `fn` may change a unit (no tick, no
 * order): what it reads through his ghosts is then what a refresh per ghost read. A look inside another is part of it.
 */
export function withMirrors(fn) {
  if (fresh !== null) return fn();
  fresh = new Set();
  try { return fn(); } finally { fresh = null; }
}

/**
 * withMirrors for a look sliced over frames (driver runSliced's `around`): {enter, leave} open the look for each slice
 * and close it between them — the mirrors are refreshed again in the next slice (the world stood still: the same
 * fields). A look already open when it enters is left to its owner.
 */
export function mirrorScope() {
  let mine = false;
  return {
    enter() { if (fresh === null) { fresh = new Set(); mine = true; } },
    leave() { if (mine) { fresh = null; mine = false; } },
  };
}

/** A ghost on a mirror already refreshed (mirrorOf): several ghosts of one man in one call or one plan. */
export const ghostOn = (m) => Object.create(m);

/** `Object.create(e)` without making `e` a prototype (his mirror refreshed: one ghost now). */
export const ghost = (e) => Object.create(mirrorOf(e));

/**
 * What a read of `o` falls through to next, as through `Object.create(e)` ghosts: the prototype, a mirror standing for
 * its unit (records kept beside a man are found from his ghosts: sneak.mjs, m08).
 */
export function protoOf(o) {
  const p = Object.getPrototypeOf(o);
  return (p !== null && UNIT_OF.get(p)) || p;
}
