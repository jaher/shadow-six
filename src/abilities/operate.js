/**
 * Vehicle and emplacement weapons — owned by VEHICLES (design-spec §3.3 `vehicleFire`, §3.7 armed
 * vehicles, §3.4 Driver mans captured MG nests / cannons, §5.2 Ctrl+click).
 *
 * - Manning a gun = `enterVehicle` on an emplacement (MG nest / cannon; only its operator role, 0.8 s).
 * - `vehicleFire` (targeting 'point', Ctrl+click): the commando operating an armed vehicle or gun fires
 *   it at the clicked point / unit: MG bursts, tank MG (10 rounds at 10/s, 110 each), cannon `shell`
 *   (reload 1.5 s, min 13.5 m; closer targets get the MG), mini-sub torpedo straight ahead (2 aboard).
 * `fireFromVehicle(unit, target)` is the direct API for the input layer and tests.
 * @module abilities/operate
 */

import { registerAbility } from './registry.js';
import { RIDER_ROLES } from './drive.js';

/**
 * Ctrl+click: fire the weapon of the vehicle `unit` operates at `target` (entity or {x, z}).
 * @returns {true|string} true or the reason it can't fire
 */
export function fireFromVehicle(unit, target) {
  const v = unit?.vehicle;
  if (!v) return 'not in a vehicle';
  if (v.driver !== unit) return 'only the operator can fire';
  if (!v.def.weapons?.length) return 'this vehicle is unarmed';
  if (!target) return 'no target';
  if (v.fireAt(target)) return true;
  const d = Math.hypot(target.x - v.x, target.z - v.z);
  if (v.def.weapons[0] === 'torpedo' && v.torpedoes <= 0) return 'no torpedoes left';
  if (!v.weaponFor(d)) return 'out of range';
  if (!v.canTraverse(Math.atan2(target.z - v.z, target.x - v.x))) return 'the gun cannot turn that far';
  return 'reloading';
}

registerAbility({
  id: 'vehicleFire',
  label: 'Fire',
  icon: '💥',
  hotkey: null, // Ctrl+click (input.js)
  roles: RIDER_ROLES,
  targeting: 'point',
  range: Infinity, ranged: true, // fires from the vehicle; never walks (the weapon's own range is checked in canUse)
  cursor: 'target',
  order: 82,
  campaigns: null, noiseRadius: 0, visibleToEnemies: false, group: 'vehicle', // the weapon itself makes the noise

  canUse(commando, target) {
    const v = commando.vehicle;
    if (!v) return 'Not in a vehicle.';
    if (v.driver !== commando) return 'Only the operator can fire.';
    if (!v.def.weapons?.length) return 'This vehicle is unarmed.';
    if (!target) return 'Pick a target.';
    // §3.3 out-of-range feedback: forbidden cursor when no mounted weapon reaches the spot (per-weapon
    // range / min range, §4.1) or a traverse-limited gun cannot turn that far.
    if (typeof v.weaponFor === 'function') {
      const d = Math.hypot(target.x - v.x, target.z - v.z);
      const id = v.weaponFor(d);
      if (!id) return v.def.weapons[0] === 'torpedo' ? 'No torpedoes left.' : 'Out of range.';
      if (id !== 'torpedo' && typeof v.canTraverse === 'function' && !v.canTraverse(Math.atan2(target.z - v.z, target.x - v.x))) return 'The gun cannot turn that far.';
    }
    return true;
  },

  start(commando, target, world) {
    const r = fireFromVehicle(commando, target);
    if (r !== true) world.events.emit('message', { text: `${commando.nickname || commando.role}: ${r}.`, kind: 'warn', unit: commando });
    return null;
  },
});
