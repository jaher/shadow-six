/**
 * BCD close-quarters gadgets (docs/bcd-plan.md §1.1, §1.2, §1.6) — `campaigns: ['BCD']`, never under BEL:
 *   knockoutFist        X  Green Beret: punch from behind, 0.6 s
 *   knockoutClub        X  Driver: blackjack, 0.6 s (rules.driverClub)
 *   knockoutChloroform  X  Spy: rag over the mouth, 1.2 s (rules.spyChloroform)
 *   handcuff            J  GB, Spy: cuff a stunned man, 1.5 s; his cigarette pack goes to the cuffer
 *   hanger              T  Spy: take a stunned/bound man's uniform into the wardrobe, 2.0 s
 * Knock-outs are unlimited, silent and suspicious; they only land on unaware men (bcd-enemy.koLands); an
 * aware target takes the swing and nothing happens. Patrols, dogs and animals are immune.
 * @module abilities/bcd-melee
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { timedTask, freeToAct, bark, say } from './common.js';
import { meleeReachable } from './knife.js';
import { koImmune, koLands, knockOut, cuff } from '../ai/bcd-enemy.js';
import { wardrobeOf, addToWardrobe } from '../entities/wardrobe.js';

const BCD = ['BCD'];

/** Uniform key a soldier's clothes give the Spy's wardrobe (§1.6). */
export function uniformOf(e) {
  const t = e?.soldierType;
  if (t === 'sergeant') return 'sergeant';
  if (t === 'officer' || t === 'lieutenant' || t === 'general' || t === 'gestapo') return 'officer';
  if (t === 'zookeeper') return 'zookeeper';
  return 'soldier';
}

/** Witnesses of a knock-out react as to a kill seen (§1.1 "a suspicious act … as with the knife"). */
function witnessed(world, victim, by) {
  by._deedT = world.time;
  for (const q of world.enemies) if (q !== victim && q.alive && !q.removed) q.brain?.notifyKill?.(victim, by, 'ko');
}

function koDef(id, label, role, variant, flag) {
  const B = CONFIG.bcd;
  registerAbility({
    id, label, icon: variant === 'chloroform' ? '🧪' : variant === 'blackjack' ? '🏏' : '👊', hotkey: null,
    roles: [role], targeting: 'enemy', range: B.koReach, cursor: 'fist', order: 9, campaigns: BCD,
    noiseRadius: 0, visibleToEnemies: true, group: 'knockout', autoStand: true,
    canUse(c, t, world) {
      if (!world.rules?.[flag]) return 'Not in this campaign.';
      const f = freeToAct(c);
      if (f !== true) return f;
      if (c.carrying) return 'Drop it first.';
      const im = koImmune(t);
      if (im) return im;
      return meleeReachable(c, t);
    },
    start(c, t, world) {
      const dur = B.koTime[variant];
      const at = variant === 'chloroform' ? dur : B.koHit;
      c.playAction(variant === 'chloroform' ? 'use' : 'punch', dur);
      return timedTask({
        dur, interruptible: false,
        steps: [{ at, fn: () => {
          if (!t.alive || Math.hypot(t.x - c.x, t.z - c.z) > B.koReach + 0.6) return false;
          if (!koLands(t, c, world)) { // aware: the swing plays and misses (§1.1)
            world.events.emit('enemy:ko-missed', { enemy: t, by: c });
            say(world, c, 'He saw me coming!');
            return true;
          }
          knockOut(t, c, world);
          witnessed(world, t, c);
          return true;
        } }],
      });
    },
  });
}

koDef('knockoutFist', 'Fist', 'greenberet', 'fist', 'knockouts');
koDef('knockoutClub', 'Blackjack', 'driver', 'blackjack', 'driverClub');
koDef('knockoutChloroform', 'Chloroform', 'spy', 'chloroform', 'spyChloroform');

/** A knocked-out man within reach (stunned or bound, not carried). */
function downed(t, states) {
  if (!t || t.kind !== 'enemy' || !t.alive) return 'Pick an unconscious soldier.';
  if (!states.includes(t.ko) || t.puppetOf) return t.ko === 'bound' ? 'Already cuffed.' : 'Only an unconscious soldier.';
  if (t.carriedBy || t.state === 'carried') return 'Put him down first.';
  return true;
}

registerAbility({
  id: 'handcuff', label: 'Handcuffs', icon: '⛓', hotkey: null, roles: ['greenberet', 'spy'], item: 'handcuffs',
  targeting: 'enemy', range: CONFIG.bcd.koReach, cursor: 'hand', order: 13, campaigns: BCD, visibleToEnemies: true,
  autoStand: true,
  canUse(c, t, world) {
    if (!world.rules?.handcuffs) return 'Not in this campaign.';
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.carrying) return 'Drop it first.';
    return downed(t, ['stunned']);
  },
  start(c, t, world) {
    const T = CONFIG.bcd.cuffTime;
    c.playAction('use', T);
    return timedTask({ dur: T, steps: [{ at: T, fn: () => {
      if (downed(t, ['stunned']) !== true) return false;
      cuff(t, c, world);
      bark(world, c, 'act_ok');
      return true;
    } }] });
  },
});

/** The Spy's wardrobe (§1.6): see entities/wardrobe.js. */
export { wardrobeOf };

registerAbility({
  id: 'hanger', label: 'Hanger', icon: '🧥', hotkey: null, roles: ['spy'], item: 'hanger', targeting: 'enemy',
  range: CONFIG.bcd.koReach, cursor: 'hand', order: 14, campaigns: BCD, visibleToEnemies: true, autoStand: true,
  canUse(c, t, world) {
    if (!world.rules?.spyUniformFromCaptives) return 'Not in this campaign.';
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.carrying) return 'Drop it first.';
    if (!t || t.kind !== 'enemy' || !t.alive || !t.ko || t.puppetOf) return 'Only an unconscious or cuffed soldier.';
    if (t.carriedBy || t.state === 'carried') return 'Put him down first.';
    if (t.uniformTaken) return 'Nothing left to take.';
    return true;
  },
  start(c, t, world) {
    const T = CONFIG.bcd.hangerTime;
    c.playAction('use', T);
    return timedTask({ dur: T, steps: [{ at: T, fn: () => {
      if (!t.alive || !t.ko || t.uniformTaken) return false;
      const u = uniformOf(t);
      addToWardrobe(c, u);
      t.uniformTaken = true;
      t.model?.setColors?.({ body: 0xd8d2c4, hat: 0xd8d2c4 }); // underclothes (placeholder tint)
      world.events.emit('message', { text: `${c.nickname}: took a${/^[aeiou]/.test(u) ? 'n' : ''} ${u}'s uniform.`, kind: 'info', unit: c });
      return true;
    } }] });
  },
});

