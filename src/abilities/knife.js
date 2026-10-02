/**
 * Knife (BEL hotkey X) — Green Beret and Marine (not the Marine in M7: no knife in his kit) [§3.3, §3.4].
 * Click an enemy: he walks up and stabs; double-click (run order) = the sprint-kill. Stab 0.6 s, kill at 0.3 s,
 * blood (`hit` flesh), silent (no noise event): the victim's choked cry (audio/event-map.js, voice-lines CRY_KEYS.stab)
 * is for the player's ears only, and the killer's quip waits for the end of the stab so it does not talk over it.
 * Contact kill (abilities/knife-contact.js, art/knife-kill.js; user 2026-10-02): at reach he steps in to body contact
 * (0.1–0.3 s) and the victim is held: from behind (within ±70° of his back) a hand over his mouth, the blade driven into
 * the front of his throat from his right side and drawn across it, he sags, drops to his knees and pitches forward
 * onto his face; from the front (he turns to face the blade), a hand on his collar and the blade in under his ribs at no
 * distance, he doubles over, is pushed off and falls back. The kill comes 0.3 s after the step. No room for contact (a
 * wall or prop at the spot or in the step, nowhere to fall, water, another level, a dog): the classic stab at arm's length.
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
import { contactPlan, knifeTimes, stepAt, CONTACT } from './knife-contact.js';

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
    // contact kill (abilities/knife-contact.js): he steps in to body contact and the victim is held where he stands;
    // no room for it (a wall, a prop, water, another level): the classic stab at arm's length
    const plan = surfaced ? null : contactPlan(world, commando, target);
    const T = knifeTimes(plan);
    if (plan) {
      target.knifeHold = { by: commando.id, x: target.x, z: target.z, h: target.heading, until: world.time + T.hit + 0.05 };
      target.stop?.();
      // what art/knife-kill.js draws (visual only, transient): t0 = world time at which the action's own t is 0 as
      // drawn after a tick
      const kills = (world.knifeKills ||= []);
      for (let i = kills.length - 1; i >= 0; i--) if (kills[i].a === commando || kills[i].v === target) kills.splice(i, 1);
      kills.push({ a: commando, v: target, side: plan.side, plan, t0: world.time + CONFIG.sim.dt, ...T });
      commando.knifeShow = world.time + T.dur + 0.4; // the drawn knife stays in his fist while his hands come off the victim
    }
    commando.playAction('stab', T.dur);
    const dur = surfaced ? Math.max(T.dur, CONFIG.abilities.surfaceTime) : T.dur;
    return {
      interruptible: false,
      update(dt) {
        t += dt;
        if (plan && !struck) { const p = stepAt(plan, t); commando.x = p.x; commando.z = p.z; commando.heading = p.h; }
        if (!struck && t >= T.hit) {
          struck = true;
          if (!target.alive) { resubmerge(); return 'failed'; }
          if (!plan && Math.hypot(target.x - commando.x, target.z - commando.z) > K.reach + 0.6) { resubmerge(); return 'failed'; }
          const hx = target.x, hz = target.z; // the throat is where he was held
          if (plan) {
            target.heading = plan.vh; // a frontal kill: he had turned to face the blade
            if (plan.side === 'behind') {
              // he pitches forward onto his face, away from the attacker: the corpse lies ahead of where he stood
              target.x += Math.cos(plan.fall) * CONTACT.fall; target.z += Math.sin(plan.fall) * CONTACT.fall; target.heading = plan.fall;
            } else if (plan.back) {
              // pushed off the blade he staggers back before he falls on his back (his heels clear of the attacker's)
              target.x -= Math.cos(plan.vh) * plan.back; target.z -= Math.sin(plan.vh) * plan.back;
            }
          }
          target.die('knife', commando, plan ? { fall: plan.side === 'behind' ? 1 : -1, prone: plan.side === 'behind' } : null);
          world.events.emit('hit', { x: hx, z: hz, surface: 'flesh', target, weapon: 'knife' }); // blood spray + pool
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
