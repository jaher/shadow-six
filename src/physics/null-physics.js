/**
 * Null physics (bodies-design §A.1): the object `world.physics` holds when Rapier is absent or failed to initialise.
 * Every call is a no-op; bodies use the canned death clip and props never move. Kills never depend on physics, but
 * with the `physicsGameplay` house rule on a thrown body's resting place and a toppled prop's footprint do feed
 * gameplay, so a game without physics plays like the 1998 rules there (bodies stay where they died, cover stays put).
 * A save records whether physics ran (`world.physics.isNull`), and a replay should run with the same availability.
 * @module physics/null-physics
 */

const noop = () => {};

/** @type {object} frozen no-op physics */
export const NULL_PHYSICS = Object.freeze({
  isNull: true,
  enabled: false,
  step: noop,
  queueBlast: noop,
  activeCounts: () => ({ ragdolls: 0, props: 0, debris: 0 }),
  ragdollOf: () => null,
  lyingFits: () => true,
  moving: () => false,
  serialize: () => null,
  restore: noop,
  dispose: noop,
  stats: () => ({ ms: 0, bodies: 0 }),
});
