/**
 * House rules (docs/bodies-design.md §0.3): the `world.house` layer for rules that are not in the 1998 original.
 * `world.rules` stays the campaign ruleset (bel-lock pins it); `world.house` is resolved once at mission load from a
 * preset (CONFIG.houseRules.presets) + the player's per-rule overrides + the mission's forced overrides, and is saved
 * with the game so a load restores the rules (and the physics tier) it was made with.
 * @module core/house-rules
 */

import { CONFIG } from '../config.js';

/** Physics quality tiers (bodies-design §A.9: caps come from the tier stored in the house layer, never the camera). */
export const PHYSICS_TIERS = Object.freeze(['low', 'medium', 'high', 'ultra']);

/** Flag names a preset defines. */
export function houseFlags() {
  const H = CONFIG.houseRules;
  return Object.keys(H.presets[H.default]);
}

/**
 * Renderer preset name → physics tier ('high' when unknown). The tier only scales VISUAL extras (debris); the caps that
 * decide which bodies and props are simulated are one fixed set (CONFIG.physics.gameplayCaps, §0.2 determinism).
 */
export function tierFromPreset(presetName) {
  return PHYSICS_TIERS.includes(presetName) ? presetName : 'high';
}

/**
 * Resolve the house layer.
 * @param {{preset?: string, options?: object, mission?: object, tier?: string}} [o]
 *   preset: 'shadowSix' | 'classic1998' (default CONFIG.houseRules.default, or options.rulesPreset);
 *   options: player options (per-rule booleans override the preset); mission: its `houseRules` object wins;
 *   tier: physics tier (quality preset at mission load)
 * @returns {{preset: string, physicsTier: string, dragBodies: boolean, buddyRescue: boolean, dropWhenShot: boolean,
 *   ragdollAllDeaths: boolean, physicsGameplay: boolean, runningNoise: boolean, recoverCharges: boolean}}
 */
export function resolveHouseRules(o = {}) {
  const H = CONFIG.houseRules;
  const opts = o.options || {};
  let preset = o.preset || opts.rulesPreset || H.default;
  if (!H.presets[preset]) preset = H.default;
  const out = { preset, physicsTier: PHYSICS_TIERS.includes(o.tier) ? o.tier : 'high', ...H.presets[preset] };
  for (const k of houseFlags()) if (typeof opts[k] === 'boolean' && opts[k] !== out[k]) { out[k] = opts[k]; out.preset = 'custom'; }
  const forced = o.mission?.houseRules;
  if (forced && typeof forced === 'object') for (const k of houseFlags()) if (typeof forced[k] === 'boolean') out[k] = forced[k];
  return out;
}

/** Restore a saved house layer over the current defaults (old saves without one keep the current preset). */
export function restoreHouseRules(saved, current) {
  if (!saved || typeof saved !== 'object') return current;
  const out = { ...current };
  for (const k of [...houseFlags(), 'preset', 'physicsTier']) if (saved[k] !== undefined) out[k] = saved[k];
  if (!PHYSICS_TIERS.includes(out.physicsTier)) out.physicsTier = 'high';
  return out;
}

/** Briefing wording of a forced house rule (on / off). */
const FORCED_TEXT = {
  dragBodies: ['Any man may drag a body.', 'Only the Green Beret and the Spy may move a body.'],
  buddyRescue: ['A man who falls can be saved: drag him to cover and use the first aid kit.', 'A man who falls is lost.'],
  dropWhenShot: ['A man who is hit drops what he carries.', 'A man who is hit keeps his load.'],
  ragdollAllDeaths: ['The dead fall where they are struck.', 'The dead lie as they fell.'],
  physicsGameplay: ['A blast can throw bodies and shift cover.', 'Bodies and cover stay where they were.'],
  runningNoise: ['The guards hear a man running near them.', 'The guards cannot hear a man running.'],
  recoverCharges: ['The Sapper can take a charge he has set back before it goes off.', 'A charge once set stays where it is.'],
};

/**
 * The house rules a mission forces (its `houseRules` object), as short briefing lines (bodies-design §0.3: the
 * briefing and the notebook print them so the player knows before the mission starts).
 * @returns {string[]}
 */
export function forcedRuleLines(mission) {
  const f = mission?.houseRules;
  if (!f || typeof f !== 'object') return [];
  return houseFlags().filter((k) => typeof f[k] === 'boolean' && FORCED_TEXT[k]).map((k) => FORCED_TEXT[k][f[k] ? 0 : 1]);
}
