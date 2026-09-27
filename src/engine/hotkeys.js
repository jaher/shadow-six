/**
 * Ruleset-aware ability hotkeys (docs/bcd-plan.md §2). BEL keeps every def's own `hotkey`; the BCD ruleset
 * carries a `{abilityId: key}` map (CONFIG.rulesets.BCD.hotkeys) that moves the most-used keys to the left of
 * the keyboard. Input, the HUD tooltips, the knapsack key labels and the help screen all read hotkeyFor().
 * @module engine/hotkeys
 */

import { ABILITIES, abilityInCampaign, abilitiesForRole, allAbilities } from '../abilities/index.js';

/** Normalise a hotkey ('x', 'X', 'KeyX') to a KeyboardEvent.code. */
export function codeOf(h) {
  if (!h) return null;
  if (h.length === 1) return /[0-9]/.test(h) ? `Digit${h}` : `Key${h.toUpperCase()}`;
  return h;
}

/**
 * Key of an ability under a ruleset: `rules.hotkeys[def.id]`, else the def's BEL `hotkey`.
 * @param {object|string} def ability def or id
 * @param {object} [rules] world.rules (CONFIG.rulesets entry)
 * @returns {string|null}
 */
export function hotkeyFor(def, rules = null) {
  const d = typeof def === 'string' ? ABILITIES[def] : def;
  if (!d) return null;
  const map = rules?.hotkeys;
  if (map && Object.prototype.hasOwnProperty.call(map, d.id)) return map[d.id];
  return d.hotkey ?? null;
}

/** Upper-case display label of an ability key ('X'), or '' when it has none. */
export function keyLabel(def, rules = null) {
  const h = hotkeyFor(def, rules);
  return h ? String(h).replace(/^Key/, '').toUpperCase() : '';
}

/**
 * Ability defs bound to a key code under a ruleset, in registry order, skipping defs of other campaigns.
 * @param {string} code KeyboardEvent.code
 * @param {object} [rules]
 */
export function abilitiesForKey(code, rules = null) {
  const campaign = rules?.id || 'BEL';
  const out = [];
  for (const def of allAbilities()) {
    if (!abilityInCampaign(def, campaign)) continue;
    if (codeOf(hotkeyFor(def, rules)) === code) out.push(def);
  }
  return out;
}

/**
 * Key map of one role under a ruleset: {abilityId: KEY} for every keyed ability the role has.
 * @param {string} role
 * @param {object} [rules]
 */
export function roleKeyMap(role, rules = null) {
  const out = {};
  for (const id of abilitiesForRole(role, rules || 'BEL')) {
    const k = keyLabel(ABILITIES[id], rules);
    if (k) out[id] = k;
  }
  return out;
}
