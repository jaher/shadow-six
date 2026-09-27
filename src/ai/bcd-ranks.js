/**
 * BCD rank table (docs/bcd-plan.md §1.3, §1.6, §1.8): rank levels of disguises and viewers, disguise
 * recognition, and who may be distracted by whom. Pure functions; every entry point checks the ruleset flag
 * (`world.rules.disguiseRanks`) so nothing here changes BEL behaviour.
 *
 *   levels: private 0, sergeant 1, officer 2, Gestapo 3 (CONFIG.bcd.rankOfViewer / rankOfUniform)
 *   recognises(viewer, target): viewerLevel > uniformLevel, or the viewer is Gestapo (always)
 *   Natasha's civilian cover is a "disguise" of level ∞: only the Gestapo see through it.
 * @module ai/bcd-ranks
 */

import { CONFIG } from '../config.js';

/** Unit types that ignore disguises entirely (dogs, wild animals) — they react to anyone. */
export const ANIMAL_TYPES = Object.freeze(['lion', 'ostrich', 'chicken']);

/** Is this enemy a wild animal (BCD)? */
export function isAnimal(e) {
  return !!e && ANIMAL_TYPES.includes(e.soldierType);
}

/** Rank level of a viewer (enemy soldierType; patrol leaders count as sergeants). */
export function viewerRank(e) {
  if (!e) return 0;
  const R = CONFIG.bcd.rankOfViewer;
  let r = R[e.soldierType] ?? 0;
  if (e.squad && (e.squad.leader === e.tag || e.squad.leader === e.id || e.squad.leader === true)) r = Math.max(r, 1);
  return r;
}

/** Rank level of the uniform a disguised unit wears ('civilian' = Natasha's cover: Gestapo only). */
export function uniformRank(target) {
  const u = target?.uniformType || target?.disguise || 'soldier';
  if (u === 'civilian') return Infinity;
  return CONFIG.bcd.rankOfUniform[u] ?? 0;
}

/**
 * Does `viewer` see through `target`'s disguise (§1.6 table)? False under BEL (flag off), for animals and
 * dogs (they ignore disguises: the caller treats them separately) and for undisguised targets.
 */
export function recognises(viewer, target, world = viewer?.world) {
  if (!world?.rules?.disguiseRanks || !target?.disguised || !viewer) return false;
  if (viewer.soldierType === 'gestapo') return true;
  if (viewer.soldierType === 'dog') return uniformRank(target) !== Infinity; // dogs see through uniforms, not Natasha's civilian cover (§1.8)
  return viewerRank(viewer) > uniformRank(target);
}

/** May a puppet of `puppetRank` distract `target` (§1.3 table)? Gestapo never. */
export function puppetCanDistract(puppet, target) {
  if (!target || target.soldierType === 'gestapo') return false;
  const pr = viewerRank(puppet), tr = viewerRank(target);
  const patrol = !!target.squad || target.soldierType === 'trooper';
  if (pr >= 2) return true;
  if (pr >= 1) return tr <= 1 || patrol;
  return tr === 0 && !patrol;
}

/** Can the Spy's distract (D) / Natasha's lipstick work on `target` at all? Gestapo never (§1.6, §1.8). */
export function distractable(target, world = target?.world) {
  if (!world?.rules?.disguiseRanks) return true;
  return target?.soldierType !== 'gestapo' && !isAnimal(target);
}
