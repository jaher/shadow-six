/**
 * Explosion classes (design-spec §3.6) — owned by ABILITIES, usable by anyone (VEHICLES wreck blasts,
 * tank shells): `applyExplosion(world, x, z, cls, source)` applies the class's unit damage, vehicle and
 * structure destruction, barrel chain reaction, then emits `explosion` + a map-wide level-3 noise.
 *
 *   bomb     6.75 m instant death; destroys any destructible within 6.75 m (explosiveTarget markers:
 *            within 3 m); ignites barrels within 6.75 m
 *   barrel   5.0 m instant death, 6.75 m: 100 damage; destructibles within 6.75 m; chain 6.75 m after 0.2 s
 *   grenade  4.5 m: 200 damage, 6.75 m: 100; only `grenadeDestructible` props; barrels within 4.5 m
 *   vehicle  9 m: 180 damage; light props; chain
 *   shell    2.25 m instant death, 4.5 m: 150 damage; anything but bunkers; chain
 * @module abilities/explosions
 */

import { CONFIG, KILL, MAP_WIDE } from '../config.js';
import { explodeHook } from '../entities/interactables.js';
import { isBarrel, hitBarrel } from '../entities/projectile.js';

/** Largest radius the class touches (m). */
export function explosionReach(cls) {
  const E = CONFIG.weapons.explosions[cls];
  if (!E) return 0;
  return Math.max(E.lethal || 0, E.lethalRadius || 0, E.dmgRadius || 0, E.chain || 0);
}

/**
 * Damage a unit at distance d receives from class `cls` (KILL = instant death, 0 = none).
 * @param {string} cls
 * @param {number} d metres
 */
export function explosionDamage(cls, d) {
  const E = CONFIG.weapons.explosions[cls];
  if (!E) return 0;
  if (E.lethal && d <= E.lethal) return KILL;
  if (E.lethalRadius && d <= E.lethalRadius) return E.lethalDmg;
  if (E.dmgRadius && d <= E.dmgRadius) return E.dmg;
  return 0;
}

/** Does class `cls` destroy vehicle `v` inside its reach? (§3.6 / §3.7 vehicle table). */
export function explosionDestroysVehicle(cls, v) {
  const type = v.vehicleType || v.type;
  const V = CONFIG.vehicles;
  if (cls === 'bomb' || cls === 'shell') return true;
  if (cls === 'grenade' || cls === 'barrel') return !(V.grenadeImmune || []).includes(type);
  if (cls === 'vehicle') return !v.def?.armored;
  return false;
}

/**
 * Does class `cls` destroy destructible interactable/prop `it` whose centre is `dCenter` metres away?
 * `ctx` {world, x, z} (the blast point) enforces demolition markers (`it.marker` → `world.markers`).
 */
export function explosionDestroysStructure(cls, it, dCenter, ctx = null) {
  const E = CONFIG.weapons.explosions[cls];
  if (!E || !it.destructible || it.destroyed || it.indestructible || it.params?.indestructible) return false;
  const p = it.params || {};
  const bombOnly = it.bombOnly || p.bombOnly;
  const edge = Math.max(0, dCenter - (it.radius || 0));
  if (cls === 'bomb') {
    // demolition marker (§7.6 M3 `dam_charge`): the bomb must sit within the marker's r of its point
    const mk = it.marker && ctx?.world?.markers?.get?.(it.marker);
    if (mk && ctx.x != null) return Math.hypot(ctx.x - mk.x, ctx.z - mk.z) <= (mk.r ?? E.targetRadius);
    if (it.interactKind === 'explosiveTarget') return dCenter <= E.targetRadius + (it.radius || 0) || edge <= E.targetRadius;
    return edge <= E.lethal;
  }
  if (bombOnly) return false;
  const reach = Math.max(E.lethal || 0, E.lethalRadius || 0, E.dmgRadius || 0);
  if (edge > reach) return false;
  switch (E.structures) {
    case 'any': return true;
    case 'allButBunker': return !(p.bunker || it.bunker);
    case 'grenadeDestructible': return !!(it.grenadeDestructible || p.grenadeDestructible);
    case 'light': return !!(it.light || p.light || it.grenadeDestructible || p.grenadeDestructible);
    default: return false;
  }
}

/**
 * Apply an explosion of class `cls` at (x, z).
 * @param {import('../world/world.js').World} world
 * @param {number} x
 * @param {number} z
 * @param {'bomb'|'barrel'|'grenade'|'vehicle'|'shell'} cls
 * @param {any} [source] entity responsible (thrower/planter/barrel)
 * @param {{emit?: boolean, killer?: any, exclude?: any, accident?: boolean, silent?: boolean}} [opts] emit=false
 *   skips the explosion event/noise (caller emits); killer = unit credited with kills (default: source, or
 *   source.owner); exclude = entity untouched (the exploding vehicle); accident/silent = no noise
 * @returns {{killed: any[], damaged: any[], vehicles: any[], structures: any[], barrels: any[]}}
 */
export function applyExplosion(world, x, z, cls, source = null, opts = {}) {
  const E = CONFIG.weapons.explosions[cls];
  const out = { killed: [], damaged: [], vehicles: [], structures: [], barrels: [] };
  if (!E || !world) return out;
  const reach = explosionReach(cls);
  const cands = world.entitiesInRadius(x, z, reach + 8, (e) => !e.removed);
  const killer = opts.killer ?? (source?.faction ? source : source?.owner?.faction ? source.owner : null);
  // Mark every unit this blast kills before any of them dies: a victim's unit:killed runs the witness
  // reactions (director → brain.notifyKill) synchronously, and a guard dying in the same blast must not
  // react to his neighbour's death first (no same-tick spotted / bark / COMBAT — replay round 2).
  const doomed = [];
  for (const e of cands) {
    if (e === opts.exclude || e.alive === false || e.state === 'inVehicle' || e.state === 'jailed' || e.vehicle) continue;
    if (e.kind !== 'commando' && e.kind !== 'enemy') continue;
    if (explosionDamage(cls, Math.hypot(e.x - x, e.z - z)) >= (e.hp ?? Infinity)) { e.blastDoomed = true; doomed.push(e); }
  }
  try {
  for (const e of cands) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (e === opts.exclude) continue;
    if (e.kind === 'commando' || e.kind === 'enemy' || (e.hp != null && typeof e.takeDamage === 'function' && !['interactable', 'prop', 'vehicle', 'projectile'].includes(e.kind))) {
      if (e.alive === false || e.state === 'inVehicle' || e.state === 'jailed' || e.vehicle) continue; // occupants: the hull decides
      const dmg = explosionDamage(cls, d);
      if (dmg <= 0) continue;
      // bodies-design §C.6: a point-blank blast (inside 0.5 × R_k) is never downable — the unit reads this context
      if (e.kind === 'commando') e._blastCtx = { d, rk: Math.max(E.lethal || 0, E.lethalRadius || 0) };
      try { e.takeDamage(dmg, killer, cls === 'barrel' || cls === 'vehicle' ? 'explosion' : cls); } finally { if (e._blastCtx) e._blastCtx = null; }
      (e.alive ? out.damaged : out.killed).push(e);
    } else if (e.kind === 'vehicle') {
      if (e.destroyed) continue;
      const half = Math.max(...(e.def?.size || [2, 1])) / 2;
      const r = Math.max(E.lethal || 0, E.lethalRadius || 0, E.dmgRadius || 0);
      if (e.hiddenRail || d - half > r) continue;
      // the vehicle's own §3.7 armour table (entities/vehicle.js) decides when it has one
      if (typeof e.explosionHit === 'function') { if (e.explosionHit(cls, killer ?? source)) out.vehicles.push(e); continue; }
      if (!explosionDestroysVehicle(cls, e)) continue;
      if (e.destroy) e.destroy(killer, cls); else e.takeDamage?.(KILL, killer, 'explosion');
      out.vehicles.push(e);
    } else if (e.kind === 'interactable') {
      if (e.interactKind === 'barrel') {
        if (e === source || e.exploded || e.carriedBy) continue;
        if (d <= (E.chain || 0)) { e.ignite?.(E.chainDelay || 0, killer); out.barrels.push(e); }
      } else if (explosionDestroysStructure(cls, e, d, { world, x, z })) {
        e.destroy(killer, cls);
        out.structures.push(e);
      }
    } else if (isBarrel(e)) {
      // barrel-flagged props (VEHICLES' duck-typed barrels, e.g. propType 'barrels')
      if (e !== source && d <= (E.chain || 0)) { hitBarrel(world, e, killer ?? source, E.chainDelay || 0); out.barrels.push(e); }
    } else if (e.kind === 'prop' && !e.destroyed && (e.destructible || typeof e.explosionHit === 'function')) {
      const edge = Math.max(0, d - (e.radius || 0));
      if (edge > reach) continue;
      if (typeof e.explosionHit === 'function') { if (e.explosionHit(cls, source, d)) out.structures.push(e); continue; }
      if (explosionDestroysStructure(cls, e, d, { world, x, z })) { (e.destroy ? e.destroy(killer, cls) : e.takeDamage?.(KILL, killer, cls)); out.structures.push(e); }
    }
  }
  } finally { for (const e of doomed) delete e.blastDoomed; }
  // carried barrels explode with their carrier's position
  for (const b of world.interactables) {
    if (b.interactKind === 'barrel' && b.carriedBy && !b.exploded && Math.hypot(b.x - x, b.z - z) <= (E.chain || 0)) {
      b.ignite?.(E.chainDelay || 0, killer);
      out.barrels.push(b);
    }
  }
  if (opts.emit !== false) {
    world.events.emit('explosion', { x, z, radius: reach, kind: cls, source, accident: !!opts.accident });
    // accidents (M15 scripted blast) and the tanker's second (barrel) blast make no extra noise
    if (!opts.silent && !opts.accident) world.emitNoise(x, z, MAP_WIDE, 'explosion', killer, 3);
  }
  return out;
}

// Barrels (entities/interactables.js) explode through this hook.
explodeHook.fn = (world, x, z, cls, src, killer) => applyExplosion(world, x, z, cls, src, { killer });
