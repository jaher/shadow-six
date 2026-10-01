/**
 * Firearms (design-spec §3.2 pistol, §3.3/§3.4 sniper rifle, SMG, harpoon) — owned by ABILITIES.
 *   pistol  G  all six: 13.5 m, 80 damage, unlimited, draw 0.2–0.3 s, ≥ 0.15 s per shot, pistol noise 18 m.
 *              Stays drawn (`armed='pistol'`: move orders refused) until right-click ({type:'cancel'}).
 *   sniper  R  Sniper: 45 m, kneel + aim 0.6 s, instant kill, 0.5 s bolt, limited rounds, silent; works from a boat.
 *   smg     M  Driver: 18 m, 5 rounds × 100 in a ±15° fan, burst 0.25 s, next after 0.8 s, smg noise; count = bursts.
 *   harpoon J  Marine: 9 m, silent kill, 3.0 s reload, unlimited; surfaces to fire from the water.
 * Hits emit `shot` {from, to, shooter, target, hit, weapon}; bullets that reach a barrel detonate it (§3.6).
 * @module abilities/weapons
 */

import { registerAbility } from './registry.js';
import { CONFIG, KILL } from '../config.js';
import { timedTask, enemyNear, freeToAct, bark, inReach, shotLosOpts } from './common.js';

const W = CONFIG.weapons;

/** Shooter eye/target LOS through the grid (static + dynamic occluders); `rifle`: through `shotThrough` planks. */
export function shotClear(world, from, to, rifle = false) {
  return world.grid.lineOfSight(from.x, from.z, to.x, to.z, shotLosOpts(from, to, world, rifle));
}

/** Resolve a clicked point/entity into a shot target: enemy near the point, barrel near the point, or the point. */
export function shotTarget(world, t) {
  if (!t) return null;
  if (t.kind === 'enemy' || t.kind === 'vehicle' || t.interactKind === 'barrel') return t;
  const e = enemyNear(world, t.x, t.z, 1.0);
  if (e) return e;
  const b = world.interactables.find((it) => it.interactKind === 'barrel' && !it.exploded && Math.hypot(it.x - t.x, it.z - t.z) < 0.8);
  return b || vehicleAtPoint(world, t.x, t.z) || { x: t.x, z: t.z };
}

/** An intact vehicle whose hull covers (x, z): a click on its body aims at it (§3.7 bullets vs hulls). */
function vehicleAtPoint(world, x, z) {
  for (const v of world.vehicles || []) {
    if (v.destroyed || v.removed || v.hiddenRail || !v.def?.size || v.def.kind === 'rail') continue;
    const dx = x - v.x, dz = z - v.z, c = Math.cos(v.heading || 0), s = Math.sin(v.heading || 0);
    if (Math.abs(dx * c + dz * s) <= v.def.size[0] / 2 && Math.abs(-dx * s + dz * c) <= v.def.size[1] / 2) return v;
  }
  return null;
}

/** Apply one bullet of `dmg` to target (unit/barrel/vehicle) and emit `shot`. */
export function fireBullet(world, shooter, target, dmg, weapon, cause = weapon) {
  const hit = !!target && (target.alive !== false || target.interactKind === 'barrel') && typeof target.takeDamage === 'function';
  world.stats.shots++;
  if (hit) {
    world.stats.shotsHit++;
    target.takeDamage(dmg, shooter, target.kind === 'vehicle' ? 'bullet' : cause);
  }
  world.events.emit('shot', { from: { x: shooter.x, z: shooter.z }, to: { x: target.x, z: target.z }, shooter, target: hit ? target : null, hit, weapon });
  return hit;
}

/** §3.3: a point/enemy shot is in reach (range; LOS when it resolves to an enemy, barrel or vehicle). */
function shotInReach(world, c, t, range) {
  const to = shotTarget(world, t);
  return inReach(world, c, to, range, !!to && (!!to.kind || !!to.interactKind));
}

/** Can a unit fire from where it is (on foot, or aboard a boat for the Sniper)? */
function canFireFrom(c, boatOk = false) {
  if (c.state === 'inVehicle') return boatOk && c.vehicle?.vehicleKind === 'boat' ? true : 'Get out first.';
  return freeToAct(c);
}

/** A fuel tanker (def.tanker, one bullet sets it off) that is still intact: rifle/harpoon may aim at it like a barrel. */
function isShootableTanker(t) {
  return !!t && t.kind === 'vehicle' && !!t.def?.tanker && !t.destroyed && !t.removed && !t.hiddenRail;
}

/** A loose or racked explosive barrel a bullet can set off (not yet exploded, not being carried). */
function isShootableBarrel(t) {
  return !!t && t.interactKind === 'barrel' && !t.exploded && !t.destroyed && !t.carriedBy && !t.removed;
}

// ---------------------------------------------------------------- pistol (G)

registerAbility({
  id: 'pistol', label: 'Pistol', icon: '🔫', hotkey: 'g', roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  item: 'pistol', targeting: 'point', cursor: 'pistol', order: 20, group: 'pistol',
  noiseRadius: W.pistol.noise, noiseKind: 'pistol', visibleToEnemies: true,
  range: W.pistol.range, ranged: true, firesOnTheMove: true, // §3.2 a moving unit keeps walking and fires
  canUse(c, t, world) {
    const f = canFireFrom(c);
    if (f !== true) return f;
    if (c.stance === 'dive' || c.underwater) return 'Surface first.';
    if (!t) return 'Pick a target.';
    return shotInReach(world, c, t, W.pistol.range);
  },
  approachPoint(c, t, world) { return shotTarget(world, t); },
  start(c, t, world) {
    const target = shotTarget(world, t);
    const draw = c.armed === 'pistol' ? 0 : CONFIG.abilities.pistolDraw[c.role] ?? CONFIG.abilities.pistolDraw.default;
    c.armed = 'pistol';
    const wait = Math.max(0, (c._lastShotT ?? -1) + W.pistol.cadence - world.time);
    const at = Math.max(draw, wait);
    c.playAction('shoot', at + 0.15);
    return timedTask({
      dur: at + 0.05,
      steps: [{ at, fn: () => {
        c.faceTowards(target.x, target.z);
        c._lastShotT = world.time;
        const clear = shotClear(world, c, target);
        fireBullet(world, c, clear && target.takeDamage ? target : { x: target.x, z: target.z }, W.pistol.dmg, 'pistol', 'pistol');
        world.emitNoise(c.x, c.z, W.pistol.noise, 'pistol', c);
        return true;
      } }],
    });
  },
});

// ---------------------------------------------------------------- sniper rifle (R)

registerAbility({
  id: 'sniper', label: 'Sniper rifle', icon: '🎯', hotkey: 'r', roles: ['sniper'], item: 'sniperRifle',
  targeting: 'enemy', cursor: 'scope', order: 12, noiseRadius: 0, visibleToEnemies: true,
  range: W.sniper.range, ranged: true,
  hitsBarrels: true, hitsTankers: true, // §3.3 target "enemy/point": an explosive barrel in reach and in sight too (K's M8 finale)
  available: (c) => c.inventory.has('sniperRifle'),
  canUse(c, t, world) {
    const f = canFireFrom(c, true);
    if (f !== true) return f;
    if (!c.has('sniperRifle')) { bark(world, c, 'cant_noammo'); return 'No rounds left.'; }
    if (isShootableBarrel(t) || isShootableTanker(t)) return world.time < (c._boltT ?? -1) ? 'Reloading.' : inReach(world, c, t, W.sniper.range, true, true);
    if (!t || t.kind !== 'enemy' || !t.alive) return 'Pick an enemy.';
    if (t.covered || t.vehicle?.def?.covered || t.vehicle?.def?.armored) return "Can't hit him in there.";
    if (world.time < (c._boltT ?? -1)) return 'Reloading.';
    return inReach(world, c, t, W.sniper.range, true, true); // §3.4 lens red beyond 45 m or out of LOS
  },
  needsLOS: (c, t, world) => shotClear(world, c, t, true),
  start(c, t, world) {
    const A = W.sniper;
    c.playAction('aim', A.aim);
    return timedTask({
      dur: A.aim + 0.1, interruptible: true,
      steps: [{ at: A.aim, fn: () => {
        if (!(isShootableBarrel(t) || isShootableTanker(t) || t.alive) || Math.hypot(t.x - c.x, t.z - c.z) > A.range + 0.5 || !shotClear(world, c, t, true)) return false;
        if (!c.consume('sniperRifle')) return false;
        c.faceTowards(t.x, t.z);
        c.playAction('shoot', 0.3);
        fireBullet(world, c, t, KILL, 'sniper', 'sniperRifle'); // silent: no noise event (§3.4)
        c._boltT = world.time + A.reload;
        return true;
      } }],
    });
  },
});

// ---------------------------------------------------------------- SMG (M)

/** The five §3.3 fan rays (radians, relative to the aim). */
export function smgRays() {
  const S = W.smg, n = S.rounds, half = (S.fanDeg * Math.PI) / 180;
  return Array.from({ length: n }, (_, k) => (n === 1 ? 0 : -half + (2 * half * k) / (n - 1)));
}

/** First hittable thing along a ray from c (enemy, barrel or vehicle) within range with clear LOS. */
function rayHit(world, c, ang, range) {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  let best = null, bt = Infinity;
  const cands = world.entitiesInRadius(c.x, c.z, range + 2, (e) => (e.kind === 'enemy' && e.alive && e.state !== 'inVehicle') || (e.interactKind === 'barrel' && !e.exploded && !e.carriedBy) || (e.kind === 'vehicle' && !e.destroyed));
  for (const e of cands) {
    const rx = e.x - c.x, rz = e.z - c.z;
    const along = rx * dx + rz * dz;
    if (along <= 0 || along > range) continue;
    const perp = Math.abs(rx * dz - rz * dx);
    const r = e.kind === 'vehicle' ? Math.max(...(e.def?.size || [2, 1])) / 2 : 0.5;
    if (perp > r || along >= bt) continue;
    if (!shotClear(world, c, e)) continue;
    best = e; bt = along;
  }
  return best;
}

registerAbility({
  id: 'smg', label: 'Submachine gun', icon: '💥', hotkey: 'm', roles: ['driver'], item: 'smg',
  targeting: 'point', cursor: 'smg', order: 14, noiseRadius: W.smg.noise, noiseKind: 'smg', visibleToEnemies: true,
  range: W.smg.range, ranged: true, firesOnTheMove: true,
  available: (c) => c.inventory.has('smg'),
  canUse(c, t, world) {
    const f = canFireFrom(c);
    if (f !== true) return f;
    if (!c.has('smg')) return 'No bursts left.';
    if (!t) return 'Pick a target.';
    return shotInReach(world, c, t, W.smg.range);
  },
  approachPoint(c, t, world) { return shotTarget(world, t); },
  start(c, t, world) {
    const S = W.smg;
    const wait = Math.max(0, (c._burstT ?? -1) + S.cadence - world.time);
    const target = shotTarget(world, t);
    return timedTask({
      dur: wait + S.burstDur,
      steps: [{ at: wait, fn: () => {
        if (!c.consume('smg')) return false;
        c.faceTowards(target.x, target.z);
        c.playAction('shoot', S.burstDur);
        c._burstT = world.time;
        const aim = Math.atan2(target.z - c.z, target.x - c.x);
        for (const off of smgRays()) {
          const hit = rayHit(world, c, aim + off, S.range);
          if (hit) fireBullet(world, c, hit, S.dmg, 'smg', 'smg');
          else world.events.emit('shot', { from: { x: c.x, z: c.z }, to: { x: c.x + Math.cos(aim + off) * S.range, z: c.z + Math.sin(aim + off) * S.range }, shooter: c, target: null, hit: false, weapon: 'smg' });
        }
        world.emitNoise(c.x, c.z, S.noise, 'smg', c);
        return true;
      } }],
    });
  },
});

// ---------------------------------------------------------------- harpoon (J)

registerAbility({
  id: 'harpoon', label: 'Harpoon gun', icon: '🔱', hotkey: 'j', roles: ['diver'], item: 'harpoon',
  targeting: 'enemy', cursor: 'harpoon', order: 13, noiseRadius: 0, visibleToEnemies: true,
  range: W.harpoon.range, ranged: true, hitsTankers: true,
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (isShootableBarrel(t)) return world.time < (c._boltT ?? -1) ? 'Reloading.' : inReach(world, c, t, W.sniper.range, true);
    if (isShootableTanker(t)) return world.time < (c._harpoonT ?? -1) ? 'Reloading.' : inReach(world, c, t, W.harpoon.range, true);
    if (!t || t.kind !== 'enemy' || !t.alive) return 'Pick an enemy.';
    if (world.time < (c._harpoonT ?? -1)) return 'Reloading.';
    if (t.covered || t.vehicle?.def?.armored) return "Can't hit him in there.";
    return inReach(world, c, t, W.harpoon.range, true);
  },
  needsLOS: (c, t, world) => shotClear(world, c, t),
  start(c, t, world) {
    const wasUnder = !!c.underwater;
    if (wasUnder) { c.underwater = false; world.events.emit('unit:water', { unit: c, what: 'surface' }); }
    c.playAction('shoot', 0.4);
    return timedTask({
      dur: 0.4,
      steps: [{ at: 0.2, fn: () => {
        if (!(t.alive || isShootableTanker(t)) || !shotClear(world, c, t)) return false;
        c.faceTowards(t.x, t.z);
        fireBullet(world, c, t, KILL, 'harpoon', 'harpoon');
        world.events.emit('hit', { x: t.x, z: t.z, surface: t.kind === 'vehicle' ? 'metal' : 'flesh', target: t, weapon: 'harpoon' });
        c._harpoonT = world.time + W.harpoon.reload;
        return true;
      } }],
      onEnd: () => {
        // submerge again automatically if he is still in dive mode (§3.4)
        if (wasUnder && c.stance === 'dive') { c.underwater = true; world.events.emit('unit:water', { unit: c, what: 'dive' }); }
      },
      onCancel: () => { if (wasUnder && c.stance === 'dive') c.underwater = true; },
    });
  },
});

