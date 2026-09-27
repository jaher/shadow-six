/**
 * BCD-only UI logic (docs/bcd-plan.md §1.11, §2): the help screen's BCD key rows and the "Commando Warnings"
 * portrait state (blue while seen, red while attacked). Pure functions + one tracker; nothing here runs under
 * BEL (every entry point checks the ruleset flag first).
 * @module ui/bcd-ui
 */

import { CONFIG } from '../config.js';
import { ABILITIES } from '../abilities/index.js';
import { keyLabel } from '../engine/hotkeys.js';

/** BCD Skill screen choices (§1.12) [MAN]. */
export const SKILL_CHOICES = Object.freeze([
  { id: 'easy', label: 'Easy — for Rookies' },
  { id: 'hard', label: 'Difficult — for Veterans' },
]);

/** Help-screen rows `[key, text]` for the BCD layout (empty under BEL). */
export function bcdHelpRows(rules) {
  if (!rules?.hotkeys) return [];
  const rows = [['7 / 8', 'Select Skopje / Natasha']];
  const seen = new Set();
  for (const id of Object.keys(rules.hotkeys)) {
    const def = ABILITIES[id];
    if (!def || seen.has(def.label)) continue;
    seen.add(def.label);
    rows.push([keyLabel(def, rules), def.label]);
  }
  return rows;
}

/**
 * "Commando Warnings" (§1.11): per-commando portrait state from perception and damage events.
 *   'red'  while attacked: for `warnings.redHold` s after each hit / near miss (flashes at redHz)
 *   'blue' while inside any enemy cone (either band, detection meter above 0)
 *   null   otherwise, or when the ruleset / option is off.
 */
export class CommandoWarnings {
  /** @param {import('../world/world.js').World} world */
  constructor(world) {
    this.world = world;
    this.enabled = !!world.rules?.commandoWarnings;
    /** commando id → sim time of the last attack */
    this.attackedAt = new Map();
    this._offs = [];
    if (!this.enabled) return;
    const hit = (u) => { if (u && u.faction === 'player') this.attackedAt.set(u.id, world.time); };
    this._offs.push(world.events.on('unit:damaged', (p) => hit(p.unit)));
    this._offs.push(world.events.on('shot', (p) => {
      if (p.shooter?.faction !== 'enemy') return;
      if (p.target) hit(p.target);
      // near miss: a player unit within 1.5 m of the bullet's end point
      for (const c of world.commandos) if (c.alive && Math.hypot(c.x - p.to.x, c.z - p.to.z) < 1.5) hit(c);
    }));
  }

  /** Is `c` seen by any enemy (cone, either band) — or held / nervousness above 0 on him? */
  seen(c) {
    for (const e of this.world.enemies) {
      if (!e.alive || !e.brain?._seen) continue;
      if (e.brain._seen.some((s) => s.unit === c)) return true;
    }
    return false;
  }

  /** Portrait state of commando `c`: 'red' | 'blue' | null. `optionOn` = Options → Commando Warnings. */
  state(c, optionOn = true) {
    if (!this.enabled || !optionOn || !c || c.alive === false) return null;
    const W = CONFIG.bcd.warnings;
    const t = this.attackedAt.get(c.id);
    if (t != null && this.world.time - t <= W.redHold) return 'red';
    return this.seen(c) ? 'blue' : null;
  }

  /** Red flash phase (on/off at redHz) for the renderer. */
  flashOn() {
    return Math.floor(this.world.time * CONFIG.bcd.warnings.redHz * 2) % 2 === 0;
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs = [];
  }
}
