/**
 * Enemy archetypes (design-spec §4.1 roster). Owned by AI. One row per `soldierType` describing how the
 * brain treats it; per-spawn `flags` (§7.3, schema.defaultFlags) still override holdsPost/investigates/…
 *
 *   reacts       reacts to commandos at all (officer/general/truckDriver: no — cone drawn, no reaction)
 *   challenges   uses nervousness + CHALLENGE "Halt!" (§4.5); false = fires on sight (mg, crew, dog)
 *   patrol       patrol member type (sergeant/trooper): ARREST with a jail, COMBAT without (§4.5)
 *   alarms       may raise the alarm (officer/general/truckDriver never do)
 *   vehicleOnly  fires only at vehicles (artillery gunner §4.1)
 *   script       special behaviour: 'courier' | 'engineer' | 'general' | 'dog' | 'crew' | 'gunner'
 * @module ai/archetypes
 */

const BASE = { reacts: true, challenges: true, patrol: false, alarms: true, vehicleOnly: false, script: null, blanks: false };

export const ARCHETYPES = Object.freeze({
  sentry: { ...BASE },
  soldier: { ...BASE },
  sergeant: { ...BASE, patrol: true },
  trooper: { ...BASE, patrol: true },
  mg: { ...BASE, challenges: false },
  officer: { ...BASE, reacts: false, alarms: false },
  truckDriver: { ...BASE, reacts: false, alarms: false, challenges: false },
  courier: { ...BASE, challenges: false, script: 'courier' },
  crew: { ...BASE, challenges: false, script: 'crew' },
  gunner: { ...BASE, challenges: false, vehicleOnly: true, script: 'gunner' },
  engineer: { ...BASE, challenges: false, script: 'engineer' },
  general: { ...BASE, reacts: false, alarms: false, script: 'general' },
  dog: { ...BASE, challenges: false, script: 'dog' },
  tutorial: { ...BASE, blanks: true },
  // BCD unit types (docs/bcd-plan.md §1.9); BEL missions never place them
  gestapo: { ...BASE },
  lieutenant: { ...BASE },
  zookeeper: { ...BASE, challenges: false, script: 'zookeeper' }, // unarmed: flees + alarm (bcd-brain)
  snitch: { ...BASE, challenges: false, alarms: false, script: 'snitch' }, // walks to a guard (bcd-brain)
  pow: { ...BASE, reacts: false, alarms: false, challenges: false, script: 'pow' },
  lion: { ...BASE, reacts: false, alarms: false, challenges: false, script: 'animal' },
  ostrich: { ...BASE, reacts: false, alarms: false, challenges: false, script: 'animal' },
  chicken: { ...BASE, reacts: false, alarms: false, challenges: false, script: 'animal' },
});

/** Archetype row of an enemy (unknown types behave like a soldier). */
export function archetypeOf(enemy) {
  return ARCHETYPES[enemy.soldierType] || ARCHETYPES.soldier;
}

/** Is this enemy a patrol member (sergeant/trooper, or any enemy in a squad)? */
export function isPatrolMember(enemy) {
  return archetypeOf(enemy).patrol || !!enemy.squad;
}
