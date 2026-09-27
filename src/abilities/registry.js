/**
 * STUB — owned by ABILITIES. The registry storage, split from index.js so ability modules can import
 * registerAbility() without a circular-import TDZ error. Import from './index.js' elsewhere.
 * @module abilities/registry
 */

/** @type {Record<string, object>} id → def */
export const ABILITIES = {};

/**
 * Register (or replace) an ability definition.
 * @param {object} def
 * @returns {object} def
 */
export function registerAbility(def) {
  if (!def || !def.id) throw new Error('registerAbility: def.id required');
  const full = { ...ABILITY_DEFAULTS, ...def };
  // Campaign-only defs (e.g. campaigns ['BCD']) are stored NON-enumerable: every BEL enumeration of ABILITIES
  // (Object.keys/values) stays exactly the BEL set, while lookups by id work everywhere. allAbilities() and
  // abilitiesForRole(role, campaign) see them (docs/bcd-plan.md §0 hard rule).
  if (full.campaigns && !full.campaigns.includes('BEL')) {
    Object.defineProperty(ABILITIES, def.id, { value: full, enumerable: false, configurable: true, writable: true });
  } else ABILITIES[def.id] = full;
  return full;
}

/** Every registered def, campaign-only ones included, in registration order. */
export function allAbilities() {
  return Object.getOwnPropertyNames(ABILITIES).map((k) => ABILITIES[k]);
}

/**
 * Defaults for every def field (ARCHITECTURE "Cross-team interfaces" → Abilities):
 *  campaigns: null = every campaign, or ['BEL'] / ['BCD'] (BCD-only abilities never show under BEL);
 *  noiseRadius: metres of noise the action emits (0 = silent, §4.4); noiseKind: CONFIG.stealth.noise key;
 *  visibleToEnemies: the act is "suspicious" — a disguised Spy seen doing it is unmasked (§3.4, §4.2);
 *  group: multi-selection group — with several commandos selected, only abilities sharing a `group`
 *         (or the same id) across all of them are offered (group intersection, §5 action panel);
 *  hotkey: BEL key (§5.1); order: action-panel sort key;
 *  autoStand: a crawling commando first stands up (CONFIG.units.stanceUp, 0.6 s) and then approaches/acts
 *             instead of the order being refused (knife §3.3 "auto-walks", §3.4);
 *  ranged: a ranged ability (firearms, grenade, trap, vehicleFire) never auto-walks into range (§3.3
 *          "Auto-walk" is for melee abilities and `hand` only): its canUse refuses out-of-range / no-LOS
 *          targets (forbidden cursor), and a pending order whose target left range is dropped.
 *  firesOnTheMove: a gun that fires without halting (pistol, SMG — §3.2 "A unit already moving keeps
 *          moving and can fire when in range"): the current path is kept and the unit is not set busy.
 */
export const ABILITY_DEFAULTS = Object.freeze({
  targeting: 'none', range: 1, roles: [], item: null, cursor: 'target', order: 100,
  campaigns: null, noiseRadius: 0, noiseKind: null, visibleToEnemies: true, group: null,
  autoStand: false, ranged: false, firesOnTheMove: false,
});

/**
 * Abilities offered to a multi-selection: ids present for every commando, matched by `group` (or id).
 * @param {string[][]} idLists per-commando ability id lists
 * @returns {string[]} ids from the first list whose group/id every other list contains
 */
export function groupIntersection(idLists) {
  if (!idLists.length) return [];
  const key = (id) => ABILITIES[id]?.group || id;
  const sets = idLists.slice(1).map((l) => new Set(l.map(key)));
  return idLists[0].filter((id) => sets.every((st) => st.has(key(id))));
}

/** Campaigns an ability def is valid in (def.campaigns, default both). */
export function abilityInCampaign(def, campaign = 'BEL') {
  const c = typeof campaign === 'object' && campaign ? campaign.id : campaign || 'BEL';
  return !def?.campaigns || def.campaigns.includes(c);
}

/**
 * Default ability ids for a role, in action-panel order, limited to the active campaign's abilities.
 * @param {string} role
 * @param {string|{id:string}} [campaign='BEL'] campaign id or a ruleset object (world.rules)
 * @returns {string[]}
 */
export function abilitiesForRole(role, campaign = 'BEL') {
  const c = typeof campaign === 'object' && campaign ? campaign.id : campaign || 'BEL';
  return allAbilities()
    .filter((d) => d.roles.includes(role) && abilityInCampaign(d, c))
    .sort((a, b) => a.order - b.order)
    .map((d) => d.id);
}
