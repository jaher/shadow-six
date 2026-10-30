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

/** A live entity of its world (not a ghost, a vehicle's eye or a plain viewer record)? */
const isLive = (e) => e.world != null && e.world.byId?.(e.id) === e;

/**
 * Unit `e`'s mirror, refreshed: his own fields as they are now, his class's methods. Make ghosts of it with ghostOn.
 * Anything but a live entity (a ghost, a vehicle's eye, a plain viewer record) is its own mirror: ghosts of it are made
 * on it directly, as before (a throwaway object; nothing compiled for the units depends on its shape).
 */
export function mirrorOf(e) {
  if (!isLive(e)) return e;
  let m = MIRRORS.get(e);
  if (m === undefined) { m = Object.create(Object.getPrototypeOf(e)); MIRRORS.set(e, m); UNIT_OF.set(m, e); }
  return Object.assign(m, e);
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
