/**
 * Mission scoring (design-spec §8.2) — pure module (no three.js, no DOM).
 *
 * Kills are irrelevant. Two silver-star ratings (time vs par, sustained damage) → gold merit
 * = floor((time + damage) / 2). Career gold stars → rank (one per 6, max Field-Marshal).
 * All thresholds live in CONFIG.mission.
 * @module core/scoring
 */

import { CONFIG } from '../config.js';

/** Silver stars for mission time `t` vs par `P` (§8.2: ≤P → 3, ≤1.5P → 2, ≤2.5P → 1, else 0). */
export function timeStars(t, P) {
  const k = CONFIG.mission.timeStars;
  if (!(P > 0)) return 3;
  return t <= P * k[0] ? 3 : t <= P * k[1] ? 2 : t <= P * k[2] ? 1 : 0;
}

/** True for guests (McRae, the Informer, Gilbert) — excluded from the damage rating. */
export function isGuest(c) {
  return c?.role === 'guest' || c?.guest === true || c?.isGuest === true;
}

/**
 * Damage loss fraction Σ(maxHP − HP) / Σ maxHP over the mission's commandos (guests excluded, §8.2).
 * Dead men count as a full loss; healing before the end counts.
 * @param {{hp:number, maxHp:number, role:string}[]} commandos
 */
export function damageLoss(commandos) {
  let lost = 0, max = 0;
  for (const c of commandos || []) {
    if (isGuest(c)) continue;
    const m = c.maxHp ?? c.hp ?? 0;
    max += m;
    lost += m - Math.max(0, Math.min(m, c.alive === false ? 0 : c.hp ?? 0));
  }
  return max > 0 ? lost / max : 0;
}

/** Silver stars for a damage loss fraction (§8.2: ≤10% → 3, ≤30% → 2, ≤60% → 1). */
export function damageStars(loss) {
  const k = CONFIG.mission.damageStars;
  return loss <= k[0] + 1e-9 ? 3 : loss <= k[1] + 1e-9 ? 2 : loss <= k[2] + 1e-9 ? 1 : 0;
}

/** Gold merit = floor((time stars + damage stars) / 2) (§8.2). */
export function merit(timeS, damageS) {
  return Math.floor((timeS + damageS) / 2);
}

/** Rank index (0..10) for a gold-star total (§8.2: one rank per 6, max Field-Marshal). */
export function rankIndex(gold) {
  return Math.min(CONFIG.mission.ranks.length - 1, Math.floor(Math.max(0, gold) / CONFIG.mission.starsPerRank));
}

/** Rank name for a gold-star total. */
export function rankName(gold) {
  return CONFIG.mission.ranks[rankIndex(gold)];
}

/** Gold stars toward the next rank (the password's `stars` field, 0..31). */
export function partialStars(gold) {
  const per = CONFIG.mission.starsPerRank;
  const r = rankIndex(gold);
  return Math.max(0, Math.min(31, Math.floor(gold) - r * per));
}

/** Career gold total from a (rank, partial stars) pair (password decode → career). */
export function goldFrom(rank, stars) {
  return rank * CONFIG.mission.starsPerRank + stars;
}

/** §8.2 M20 gate: Operation Valhalla needs Captain (rank index CONFIG.mission.m20MinRank) or higher. */
export function meetsM20Gate(gold) {
  return rankIndex(gold) >= CONFIG.mission.m20MinRank;
}

/**
 * Score a finished mission world (§8.2). Uses the mission clock (sim time in 'playing').
 * @param {{clock?:number, time:number, commandos:object[]}} world
 * @param {{time?:number}} [par]
 * @returns {{time: number, stars: {time: number, damage: number}, loss: number, merit: number}}
 */
export function scoreMission(world, par) {
  const time = world.clock ?? world.time;
  const t = timeStars(time, par?.time ?? 0);
  const loss = damageLoss(world.commandos);
  const d = damageStars(loss);
  return { time, stars: { time: t, damage: d }, loss, merit: merit(t, d) };
}
