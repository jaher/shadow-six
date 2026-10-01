/**
 * Owned by MISSIONS (see docs/ARCHITECTURE.md). Ordered mission list. m00 is the sandbox test
 * map; then the BEL campaign: m01 Baptism of Fire, m02 A Quiet Blow-Up, m03 Reverse Engineering (§7.4–§7.6).
 * @module missions/index
 */

import m00 from './m00_sandbox.js';
import m01 from './m01_baptism_of_fire.js';
import m02 from './m02_a_quiet_blow_up.js';
import m03 from './m03_reverse_engineering.js';
import m04 from './m04_restore_pride.js';
import m05 from './m05_blind_justice.js';
import m06 from './m06_menace_of_the_leopold.js';
import m07 from './m07_chase_of_the_wolves.js';
import m08 from './m08_pyrotechnics.js';
import m09 from './m09_a_courtesy_call.js';
import m10 from './m10_operation_icarus.js';
import m11 from './m11_in_the_soup.js';
import m12 from './m12_up_on_the_roof.js';
import m13 from './m13_david_and_goliath.js';
import m14 from './m14_d_day_kick_off.js';
import m15 from './m15_the_end_of_the_butcher.js';
import m16 from './m16_stop_wildfire.js';
import m17 from './m17_before_dawn.js';
import m18 from './m18_the_force_of_circumstance.js';
import m19 from './m19_frustrate_retaliation.js';
import m20 from './m20_operation_valhalla.js';
import b00 from './m00_bcd_sandbox.js'; // BCD sandbox (dev/test map, docs/bcd-plan.md §3 N13)

/** Ordered list of all mission definitions (sandbox first, then BEL M1–M20 in campaign order, then BCD). */
export const MISSIONS = [m00, m01, m02, m03, m04, m05, m06, m07, m08, m09, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, b00];

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
