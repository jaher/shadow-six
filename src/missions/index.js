/**
 * Owned by MISSIONS (see docs/ARCHITECTURE.md). Ordered mission list. m00 is the sandbox test
 * map; then the BEL campaign: m01 Baptism of Fire, m02 A Quiet Blow-Up, m03 Reverse Engineering (§7.4–§7.6).
 * @module missions/index
 */

import m00 from './m00_sandbox.js';
import m01 from './m01_baptism_of_fire.js';
import m02 from './m02_a_quiet_blow_up.js';
import m03 from './m03_reverse_engineering.js';
import b00 from './m00_bcd_sandbox.js'; // BCD sandbox (dev/test map, docs/bcd-plan.md §3 N13)

/** Ordered list of all mission definitions (sandbox first, then BEL, then BCD). */
export const MISSIONS = [m00, m01, m02, m03, b00];

/**
 * Campaigns as ordered mission lists (ARCHITECTURE.md "Campaigns & rulesets"). Every def declares
 * `campaign: 'BEL' | 'BCD'`; the sandbox m00 is BEL-ruled but not part of the campaign list.
 * Mission select shows these as tabs (BCD locked / "coming later").
 */
export const CAMPAIGNS = {
  BEL: MISSIONS.filter((m) => m.campaign === 'BEL' && m.id !== 'm00'),
  BCD: MISSIONS.filter((m) => m.campaign === 'BCD' && !m.dev), // the BCD sandbox (b00) is dev-only
};

/** Campaign id of a mission def (default 'BEL'). */
export function campaignOf(def) {
  return def?.campaign || 'BEL';
}

/**
 * Look up a mission by id ('m00') or index.
 * @param {string|number} idOrIndex
 * @returns {object|null}
 */
export function getMission(idOrIndex) {
  if (typeof idOrIndex === 'number') return MISSIONS[idOrIndex] ?? null;
  return MISSIONS.find((m) => m.id === idOrIndex) ?? null;
}

/** Index of a mission id (−1 when unknown). */
export function missionIndex(id) {
  return MISSIONS.findIndex((m) => m.id === id);
}

export default MISSIONS;
