/**
 * Knife (BEL hotkey X) — Green Beret and Marine (not the Marine in M7: no knife in his kit) [§3.3, §3.4].
 * Click an enemy: he walks up and stabs; double-click (run order) = the sprint-kill. Stab 0.6 s, kill at 0.3 s,
 * blood (`hit` flesh), silent (no noise event): the victim's choked cry (audio/event-map.js, voice-lines CRY_KEYS.stab)
 * is for the player's ears only, and the killer's quip waits for the end of the stab so it does not talk over it.
 * Only living enemies on foot at ground level: not tower/bunker crews, vehicle crews or gunners behind armour.
 * The Marine can knife from the water (surfaces for 0.6 s).
 * From a crawl (`autoStand`) he crawls up to the enemy and stands up (0.6 s) only within
 * CONFIG.abilities.crawlStandLead (1 m) of reach, then steps in and stabs — never refused. A deliberate change from
 * BEL (which stood him up at the click), at the user's request 2026-10-01; a double-click (run order) still stands
 * him up at once and runs in.
 * @module abilities/knife
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { freeToAct } from './common.js';

/** Can a melee attacker reach this enemy at all (§3.4)? @returns {true|string} */
export function meleeReachable(c, target) {
  if (!target || target.kind !== 'enemy') return 'Select an enemy soldier.';
  if (!target.alive) return 'Already dead.';
  if (target.state === 'inVehicle' || target.vehicle) return "Can't reach him in there.";
  if (target.elevated || target.covered || Math.abs((target.y || 0) - (c.y || 0)) > 0.6) return "Can't reach him up there.";
  // a bunker's crew sits behind concrete (as spy.js Distract refuses him): no silent no-op walk-round
  if (target.soldierType === 'crew' && (target.spawn?.structure || target.structure)) return 'He is shut in his post.';
  return true;
}

registerAbility({
  id: 'knife',
  label: 'Knife',
  icon: '🗡',
  hotkey: 'x',
  roles: ['greenberet', 'diver'], // BEL: the Marine carries the same knife (characters.md §3.3)
  item: 'knife',
  targeting: 'enemy',
  range: CONFIG.abilities.knife.reach,
  cursor: 'knife',
  order: 10,
  campaigns: null, noiseRadius: 0, visibleToEnemies: true, group: 'melee', // §3.3: silent; a suspicious act
  autoStand: true, // §3.3/§3.4: clicked from a crawl he crawls in, stands up only when close, then stabs

  canUse(commando, target) {
    const f = freeToAct(commando);
    if (f !== true) return f;
    if (commando.carrying) return 'Drop it first.';
    return meleeReachable(commando, target);
  },

  start(commando, target, world) {
    const K = CONFIG.abilities.knife;
    const surfaced = !!commando.underwater;
    if (surfaced) { commando.underwater = false; world.events.emit('unit:water', { unit: commando, what: 'surface' }); }
    let t = 0;
    let struck = false;
    let quip = false;
    const resubmerge = () => {
      if (surfaced && commando.stance === 'dive') { commando.underwater = true; world.events.emit('unit:water', { unit: commando, what: 'dive' }); }
    };
    commando.playAction('stab', K.dur);
    const dur = surfaced ? Math.max(K.dur, CONFIG.abilities.surfaceTime) : K.dur;
    return {
      interruptible: false,
      update(dt) {
        t += dt;
        if (!struck && t >= K.hit) {
          struck = true;
          if (!target.alive) { resubmerge(); return 'failed'; }
          if (Math.hypot(target.x - commando.x, target.z - commando.z) > K.reach + 0.6) { resubmerge(); return 'failed'; }
          target.die('knife', commando);
          world.events.emit('hit', { x: target.x, z: target.z, surface: 'flesh', target, weapon: 'knife' }); // blood spray + pool
          quip = !!world.rng?.chance?.(0.5); // drawn at the hit (same RNG order); said as the stab ends, after the victim's cry
        }
        if (t >= dur) {
          if (quip) world.events.emit('bark', { unit: commando, line: 'act_kill' });
          resubmerge();
          return 'done';
        }
        return 'running';
      },
      cancel() { resubmerge(); },
    };
  },
});
