/**
 * Owned by ABILITIES. Ability registry + every BEL ability (design-spec §3), one module per commando.
 *
 * def = {
 *   id, label, icon, hotkey,            // hotkey: 'x' or KeyboardEvent.code 'KeyX'
 *   roles: [...],                       // commando roles that have it by default
 *   item: 'knife' | null,               // inventory item required (consumed by the ability itself)
 *   targeting: 'none'|'point'|'unit'|'enemy'|'body'|'vehicle'|'interactable'|'self',
 *   range,                              // metres; the commando auto-walks into range first
 *   cursor,                             // cursor name while targeting
 *   order?,                             // action-panel sort key (lower first)
 *   campaigns?: ['BEL','BCD'] | null,   // null = all; BCD-only abilities never appear under BEL
 *   noiseRadius?: 0, noiseKind?,        // noise the act emits (§4.4; 0 = silent)
 *   visibleToEnemies?: true,            // suspicious act: unmasks a disguised Spy when seen (§3.4)
 *   group?: string | null,              // multi-selection group intersection key
 *   canUse(commando, target, world) → true | 'reason string',
 *   start(commando, target, world) → ActionTask { update(dt) → 'running'|'done'|'failed', cancel(), interruptible }
 * }
 * @module abilities/index
 */

export { ABILITIES, ABILITY_DEFAULTS, registerAbility, abilitiesForRole, abilityInCampaign, groupIntersection, allAbilities, abilityInHouse } from './registry.js';

// Built-in abilities register themselves on import. Owners add one file per ability here.
import './knife.js';
import './weapons.js';
import './shared.js';
import './bodies.js'; // bodies-design §C: drag / carryToggle (house rule dragBodies)
import './greenberet.js';
import './sapper.js';
import './marine.js';
import './spy.js';
import './drive.js'; // VEHICLES: enterVehicle / leaveVehicle
import './operate.js'; // VEHICLES: vehicleFire (Ctrl+click)
// Beyond the Call of Duty (docs/bcd-plan.md): every def is campaigns ['BCD'] — never offered under BEL
import './bcd-melee.js';
import './bcd-throw.js';
import './bcd-guns.js';
import './bcd-puppet.js';

export { applyExplosion, explosionDamage, explosionReach } from './explosions.js';
export { installAbilitySystems, unmaskSpy, suspiciousAct, witnessesOf } from './system.js';
export { Bomb, Trap, Decoy, Grenade } from './charges.js';
