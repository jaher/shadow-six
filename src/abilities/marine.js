/**
 * Marine: Fins (design-spec §3.4) — owned by ABILITIES. Harpoon: abilities/weapons.js; knife from the water:
 * abilities/knife.js; packing the raft: the hand (abilities/shared.js).
 *   dive  D  diving gear on/off (1.5 s). Only in SHALLOW water or aboard a boat. Submerged (`underwater`) he is
 *            invisible except to witnesses (enemies whose cone held him as he went under keep him, near band).
 *            He moves through WATER/SHALLOW only (1.8 m/s); gear off only in shallow water.
 *   raft  T  deploys the inflatable raft (2.0 s) — SHALLOW water only — as a `raft` vehicle (VEHICLES API) and
 *            boards it; only he rows it (§3.7 operator rules in shared.js `board`).
 * @module abilities/marine
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { timedTask, freeToAct, inShallow } from './common.js';
import { recordWitnesses } from './system.js';

const A = CONFIG.abilities;

function inBoat(c) {
  return c.state === 'inVehicle' && c.vehicle?.vehicleKind === 'boat';
}

registerAbility({
  id: 'dive', label: 'Diving gear', icon: '🤿', hotkey: 'd', roles: ['diver'], item: 'divingGear', targeting: 'self',
  order: 50, visibleToEnemies: true,
  canUse(c, t, world) {
    if (c.carrying) return 'Drop it first.';
    if (c.diving) return inShallow(world, c) ? true : 'Only in shallow water.';
    if (inBoat(c)) return true;
    const f = freeToAct(c);
    if (f !== true) return f;
    return inShallow(world, c) ? true : 'Only in shallow water or aboard a boat.';
  },
  start(c, t, world) {
    const on = !c.diving;
    c.playAction('use', A.dive);
    return timedTask({ dur: A.dive, steps: [{ at: A.dive, fn: () => {
      if (on) {
        if (inBoat(c)) { const v = c.vehicle; v.exit(c); c.setPosition(v.x, v.z); }
        recordWitnesses(world, c);
        c.diving = true;
        c.stance = 'dive';
        c.underwater = true;
        world.events.emit('unit:stance', { unit: c, stance: 'dive' });
        world.events.emit('unit:water', { unit: c, what: 'dive' });
      } else {
        c.diving = false;
        c.underwater = false;
        c.witnesses = null;
        c.stance = 'stand';
        world.events.emit('unit:stance', { unit: c, stance: 'stand' });
        world.events.emit('unit:water', { unit: c, what: 'surface' });
      }
      return true;
    } }] });
  },
});

registerAbility({
  id: 'raft', label: 'Inflatable raft', icon: '🛶', hotkey: 't', roles: ['diver'], item: 'inflatableBoat', targeting: 'self',
  order: 51, visibleToEnemies: true,
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.diving) return 'Take the gear off first.';
    if (!inShallow(world, c)) return 'Only in shallow water.';
    if (!world.vehicleFactory) return "Can't deploy here.";
    return true;
  },
  start(c, t, world) {
    c.playAction('use', A.raftDeploy);
    return timedTask({ dur: A.raftDeploy, steps: [{ at: A.raftDeploy, fn: () => {
      if (!c.has('inflatableBoat')) return false;
      c.loseItem('inflatableBoat');
      const raft = world.spawnVehicle('raft', { x: c.x, z: c.z, heading: c.heading });
      raft.deployedBy = c;
      raft.used = true; // §3.4: an unattended raft that has been used is suspicious to enemies
      raft.enter(c);
      world.events.emit('unit:water', { unit: c, what: 'row' });
      return true;
    } }] });
  },
});
