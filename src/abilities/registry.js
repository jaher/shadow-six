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
  // House-rule abilities (bodies-design §0.3: `houseRule: 'dragBodies'`) are stored non-enumerable too, so every BEL
  // enumeration (bel-lock) stays the pinned 1998 set; abilitiesForRole(role, campaign, house) adds them when the rule is on.
  if ((full.campaigns && !full.campaigns.includes('BEL')) || full.houseRule) {
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
 *  autoStand: ordered from a crawl, the commando crawls in and stands up (CONFIG.units.stanceUp, 0.6 s) only
 *             within CONFIG.abilities.crawlStandLead of reach, then acts — instead of the order being refused
 *             (knife §3.3 "auto-walks", §3.4); a run order (double-click) stands him up at once and runs in;
 *  ranged: a ranged ability (firearms, grenade, trap, vehicleFire) never auto-walks into range (§3.3
 *          "Auto-walk" is for melee abilities and `hand` only): its canUse refuses out-of-range / no-LOS
 *          targets (forbidden cursor), and a pending order whose target left range is dropped.
 *  firesOnTheMove: a gun that fires without halting (pistol, SMG — §3.2 "A unit already moving keeps
 *          moving and can fire when in range"): the current path is kept and the unit is not set busy.
 */
export const ABILITY_DEFAULTS = Object.freeze({
  targeting: 'none', range: 1, roles: [], item: null, cursor: 'target', order: 100,
  campaigns: null, noiseRadius: 0, noiseKind: null, visibleToEnemies: true, group: null,
  autoStand: false, ranged: false, firesOnTheMove: false, houseRule: null, houseRoles: null,
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
 * Is a def offered under the house rules (bodies-design §0.3)? `houseRule` defs need their rule on; `houseRoles`
 * ({rule: roles[]}) extends a def to more roles while that rule is on (e.g. `drop` for every dragger).
 * @param {object} def
 * @param {object|null} house world.house (null = no house rules: the 1998 lists)
 * @param {string} [role]
 */
export function abilityInHouse(def, house, role = null) {
  if (def?.houseRule && !house?.[def.houseRule]) return false;
  if (role != null && !def.roles.includes(role)) {
    const extra = def.houseRoles && Object.entries(def.houseRoles).some(([rule, roles]) => house?.[rule] && roles.includes(role));
    return !!extra;
  }
  return true;
}

/**
 * Default ability ids for a role, in action-panel order, limited to the active campaign's abilities.
 * @param {string} role
 * @param {string|{id:string}} [campaign='BEL'] campaign id or a ruleset object (world.rules)
 * @param {object|null} [house] world.house: house-rule abilities are included only when their rule is on
 * @returns {string[]}
 */
export function abilitiesForRole(role, campaign = 'BEL', house = null) {
  const c = typeof campaign === 'object' && campaign ? campaign.id : campaign || 'BEL';
  return allAbilities()
    .filter((d) => abilityInCampaign(d, c) && abilityInHouse(d, house, role))
    .sort((a, b) => a.order - b.order)
    .map((d) => d.id);
}
