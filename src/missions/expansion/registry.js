/**
 * LIGHTS OUT mission registry (docs/expansion/STATUS.md, "Mission registration contract"). LIGHTS OUT is SHADOW SIX's
 * own expansion campaign (internal campaign id 'BCD'): eight slots, e01 … e08. A mission module registers its def here
 * when it is imported (src/missions/expansion/index.js lists those imports, one line per slot), and everything else
 * reads this one live list: MISSIONS and CAMPAIGNS.BCD (src/missions/index.js), the LIGHTS OUT menus and map table,
 * the ?debug level select, the career and the passwords. A slot no mission has filled is IN PREPARATION.
 * Pure module: no imports, no DOM.
 * @module missions/expansion/registry
 */

/** Number of LIGHTS OUT missions (slots e01 … e08). */
export const EXPANSION_SLOTS = 8;

/** Mission id of slot `n` (1-based): 'e01' … 'e08'. */
export function slotId(n) {
  return `e${String(n).padStart(2, '0')}`;
}

const LIST = []; // registered defs, sorted by number (live: the menus and the campaign list read it)
const listeners = new Set();

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const text = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Why `def` cannot join the campaign ([] when it can): the id and number of a free slot, campaign 'BCD', the menu
 * info (title, place, ISO date, map pin, context) and the Easy / Hard data variants.
 * @param {object} def mission def
 * @param {object[]} [registered] the defs already in the campaign
 * @returns {string[]}
 */
export function expansionDefErrors(def, registered = LIST) {
  if (!def || typeof def !== 'object') return ['the def is not an object'];
  const e = [];
  const { id, number: n } = def;
  if (typeof id !== 'string' || !/^e0[1-8]$/.test(id)) e.push(`id ${JSON.stringify(id)} must be one of e01 … e08`);
  if (def.campaign !== 'BCD') e.push(`campaign must be 'BCD' (got ${JSON.stringify(def.campaign)})`);
  if (!Number.isInteger(n) || n < 1 || n > EXPANSION_SLOTS) e.push(`number must be an integer 1 … ${EXPANSION_SLOTS} (got ${JSON.stringify(n)})`);
  else if (typeof id === 'string' && id !== slotId(n)) e.push(`id ${id} does not match number ${n} (slot ${n} is ${slotId(n)})`);
  if (def.dev) e.push('a campaign mission is never `dev: true`');
  for (const k of ['title', 'place', 'context']) if (!text(def[k])) e.push(`${k} must be a non-empty string`);
  if (!ISO_DATE.test(String(def.date ?? ''))) e.push(`date must be ISO 'YYYY-MM-DD' (got ${JSON.stringify(def.date)})`);
  const pin = def.pin;
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lon) || Math.abs(pin.lat) > 90 || Math.abs(pin.lon) > 180) {
    e.push('pin must be {lat, lon} in degrees (the map-table and briefing-map position)');
  }
  const v = def.variants;
  if (!v || typeof v !== 'object' || !v.easy || typeof v.easy !== 'object' || !v.hard || typeof v.hard !== 'object') {
    e.push('variants must be {easy: {...}, hard: {...}} (docs/bcd-plan.md §1.12)');
  }
  for (const d of registered) {
    if (d === def) e.push(`${id} is already registered`);
    else if (d.id === id || d.number === n) e.push(`slot ${n} (${slotId(n)}) is already taken by ${d.id} "${d.title}"`);
  }
  return e;
}

/**
 * Add a mission to LIGHTS OUT. Called once by the mission's own module (`registerExpansionMission(def); export default
 * def;`). Throws on a def that breaks the contract, so a broken mission fails every test at import.
 * @param {object} def
 * @returns {object} def
 */
export function registerExpansionMission(def) {
  const errs = expansionDefErrors(def);
  if (errs.length) throw new Error(`[expansion] cannot register mission ${def?.id ?? '?'}:\n  ${errs.join('\n  ')}`);
  LIST.push(def);
  LIST.sort((a, b) => a.number - b.number);
  for (const fn of [...listeners]) fn({ type: 'register', def });
  return def;
}

/**
 * Take a mission out again (unit tests and in-page experiments only: a shipped mission never unregisters).
 * @param {string} id
 * @returns {boolean} whether it was registered
 */
export function unregisterExpansionMission(id) {
  const i = LIST.findIndex((d) => d.id === id);
  if (i < 0) return false;
  const [def] = LIST.splice(i, 1);
  for (const fn of [...listeners]) fn({ type: 'unregister', def });
  return true;
}

/** The registered LIGHTS OUT missions in number order (the live list: read it, never change it). */
export function expansionMissions() {
  return LIST;
}

/** The mission in slot `n` (1-based), or null while that slot is IN PREPARATION. */
export function expansionMission(n) {
  return LIST.find((d) => d.number === n) || null;
}

/** All eight slots, filled or not: [{n, id, def, ready}]. */
export function expansionSlots() {
  return Array.from({ length: EXPANSION_SLOTS }, (_, k) => {
    const def = expansionMission(k + 1);
    return { n: k + 1, id: slotId(k + 1), def, ready: !!def };
  });
}

/**
 * Be told when a mission registers or unregisters (src/missions/index.js keeps MISSIONS / CAMPAIGNS.BCD in step).
 * @param {(e: {type: 'register'|'unregister', def: object}) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onExpansionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
