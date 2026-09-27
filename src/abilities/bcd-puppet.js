/**
 * BCD puppet (docs/bcd-plan.md §1.3) — R, every commando (not the guests), `campaigns: ['BCD']`:
 *   R + click a CUFFED soldier within 13.5 m and in sight: he stands and obeys. While he is active, R + click:
 *     ground        → he walks there (plain move orders of the controller go to him too: Commando.issue)
 *     a door/device → he walks over and works it (doors, switches, levers, the drawbridge switch, lifts)
 *     a vehicle     → he walks over and gets in (the Driver boards after him to drive)
 *     a soldier     → he talks to him (the soldier freezes and faces him) if his rank allows (bcd-ranks)
 *     the puppet    → release: he sits down again, still cuffed (right-click does the same)
 *   Loss rules (range, LOS, controller seen / shot / inside a house) run in ai/bcd-brain every step.
 * @module abilities/bcd-puppet
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { instantTask, freeToAct, inReach, say } from './common.js';
import { takePuppet, releasePuppet } from '../ai/bcd-enemy.js';
import { puppetCanDistract } from '../ai/bcd-ranks.js';

const DEVICES = new Set(['door', 'switch', 'lever', 'valve', 'lift', 'drawbridgeSwitch', 'gate', 'penGate']);

/** Route one order to the puppet `p` of controller `c`. @returns {boolean} */
export function puppetOrder(c, p, t, world) {
  if (p._puppetTalk && p._puppetTalk !== t) { p._puppetTalk.brain?.releaseDistraction?.(); p._puppetTalk = null; }
  p._puppetJob = null;
  if (!t || t === p) return releasePuppet(c, world);
  if (t.kind === 'enemy') return puppetTalk(c, p, t, world);
  if (t.kind === 'interactable' && DEVICES.has(t.interactKind)) {
    p.moveTo(t.x, t.z);
    p._puppetJob = { fn: () => { if (Math.hypot(t.x - p.x, t.z - p.z) < 2.5) (t.puppetUse ? t.puppetUse(p) : t.interact(p)); } };
    return true;
  }
  if (t.kind === 'vehicle') {
    p.moveTo(t.x, t.z);
    p._puppetJob = { fn: () => { if (t.canEnter?.(p) === true) t.enter(p); } };
    return true;
  }
  return p.moveTo(t.x, t.z);
}

/** Distance at which the puppet talks (the Spy's distract reach, §1.3 "like the Spy's distract"). */
const TALK = () => (CONFIG.abilities.distractRange ?? 1.5) + 0.5;

/**
 * §1.3 the puppet talks to soldier `t`: he walks up to him (the Spy's distract reach) and then the soldier
 * freezes and faces him. Refused if his rank does not allow it or the soldier is beyond the puppet range.
 */
export function puppetTalk(c, p, t, world, tries = 3) {
  if (!t.alive || t.incapacitated || t.kind !== 'enemy') return false;
  if (!puppetCanDistract(p, t)) { say(world, c, 'He outranks him.'); return false; }
  if (Math.hypot(t.x - c.x, t.z - c.z) > CONFIG.bcd.puppet.range) { say(world, c, 'Too far.'); return false; }
  if (Math.hypot(t.x - p.x, t.z - p.z) > TALK()) {
    if (tries <= 0) return false;
    const d = Math.hypot(t.x - p.x, t.z - p.z), k = (d - (TALK() - 0.4)) / d;
    p.moveTo(p.x + (t.x - p.x) * k, p.z + (t.z - p.z) * k);
    p._puppetJob = { fn: () => puppetTalk(c, p, t, world, tries - 1) };
    return true;
  }
  const ok = t.brain?.distractBy?.(p);
  if (ok) p._puppetTalk = t;
  p.stop();
  p.faceTowards(t.x, t.z);
  return !!ok;
}

registerAbility({
  id: 'puppetDistract', label: 'Puppet: talk', icon: '🗣', hotkey: null, roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  targeting: 'enemy', cursor: 'talk', order: 63, campaigns: ['BCD'], ranged: true, range: CONFIG.bcd.puppet.range,
  visibleToEnemies: false, group: 'puppet',
  puppetKey: 'd', // D while a puppet is active (bcd-plan §1.3): input routes it here first (no fixed key: D is the Diver's dive)
  available: (c) => !!c.puppet, // refreshed on take / release / loss
  approachPoint: (c) => ({ x: c.x, z: c.z }), // the controller stays put
  canUse(c, t, world) {
    if (!world.rules?.puppet) return 'Not in this campaign.';
    if (!c.puppet) return 'No puppet.';
    if (!t || t.kind !== 'enemy' || !t.alive || t === c.puppet) return 'Pick a soldier.';
    return true;
  },
  start(c, t, world) {
    return instantTask(() => {
      const p = c.puppet;
      if (!p) return false;
      if (p._puppetTalk && p._puppetTalk !== t) { p._puppetTalk.brain?.releaseDistraction?.(); p._puppetTalk = null; }
      p._puppetJob = null;
      return puppetTalk(c, p, t, world);
    });
  },
});

registerAbility({
  id: 'puppet', label: 'Puppet', icon: '🎭', hotkey: null, roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  targeting: 'point', cursor: 'target', order: 62, campaigns: ['BCD'], ranged: true, range: CONFIG.bcd.puppet.range,
  visibleToEnemies: false, group: 'puppet',
  approachPoint: (c, t) => (c.puppet ? { x: c.x, z: c.z } : t), // orders to an active puppet never move the controller
  canUse(c, t, world) {
    if (!world.rules?.puppet) return 'Not in this campaign.';
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.puppet) return true;
    if (!t || t.kind !== 'enemy' || !t.alive || t.ko !== 'bound' || t.puppetOf) return 'Pick a cuffed soldier.';
    if (t.carriedBy || t.state === 'carried') return 'Put him down first.';
    if (c.hidden) return 'Not from inside.';
    return inReach(world, c, t, CONFIG.bcd.puppet.range, true);
  },
  start(c, t, world) {
    return instantTask(() => (c.puppet ? puppetOrder(c, c.puppet, t, world) : takePuppet(t, c, world)));
  },
});
