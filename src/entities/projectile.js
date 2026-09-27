/**
 * Non-hitscan projectiles, placed charges and the §3.6 explosion model — owned by VEHICLES
 * (docs/ARCHITECTURE.md; design-spec §3.3, §3.6, §3.7, §7.1 M13).
 *   grenade    — ballistic arc to the target point (clears walls), explodes on landing (`grenade` class)
 *   harpoon    — fast straight bolt (9 m), silent one-shot kill on the first living unit; stops at walls
 *   tracer     — visual-only sniper tracer (the hit was resolved hitscan by the shooter)
 *   shell      — tank / cannon shell: straight flight, explodes at the aim point or the first wall (`shell`)
 *   torpedo    — mini-sub torpedo: runs STRAIGHT on water along the launch heading; explodes on the first
 *                hull or non-water cell (`bomb` class, emits `hit` with weapon 'torpedo')
 *   timeBomb   — placed charge, explodes after CONFIG.weapons.timeBomb.fuse s (`bomb`)
 *   remoteBomb — placed charge, explodes when detonate() is called (`bomb`)
 *   blast      — invisible delayed explosion (barrel chain reactions, §3.6 chainDelay)
 * `explode(world, x, z, cls, source)` applies an explosion class to units, vehicles, structures and
 * barrels, emits `explosion` and the map-wide explosion noise (unless `accident`).
 * @module entities/projectile
 */

import { applyExplosion } from '../abilities/explosions.js';
import * as THREE from 'three';
import { Entity } from './entity.js';
import { CONFIG, KILL } from '../config.js';
import { distToSegment } from '../core/math.js';
import { B, T } from '../world/grid.js';

/** Flight speeds (m/s); grenade speed derives from CONFIG.weapons.grenade.flight. */
const SPEED = { grenade: 12, harpoon: 30, tracer: 120, shell: 60, torpedo: 8 };
const LOOK = {
  grenade: { color: 0x3a3f2a, r: 0.09 },
  harpoon: { color: 0x8a8a80, r: 0.04 },
  tracer: { color: 0xffe0a0, r: 0.05 },
  shell: { color: 0xffc070, r: 0.08 },
  torpedo: { color: 0x303838, r: 0.12 },
  timeBomb: { color: 0x7a2020, r: 0.18 },
  remoteBomb: { color: 0x20207a, r: 0.18 },
  blast: { color: 0x000000, r: 0.01 },
};
/** Projectile kind → §3.6 explosion class. */
const CLASS_OF = { grenade: 'grenade', timeBomb: 'bomb', remoteBomb: 'bomb', shell: 'shell', torpedo: 'bomb' };

/** Bullet / round causes (anything else hitting a vehicle is an explosion). */
export const BULLET_CAUSES = new Set(['bullet', 'shot', 'pistol', 'luger', 'rifle', 'sniper', 'sniperRifle', 'smg', 'mp40', 'mg', 'tankMg']);

/** Is `e` a fuel barrel (duck-typed: interactables / props flagged `barrel` or interactKind 'barrel')? */
export function isBarrel(e) {
  return !!e && !e.destroyed && !e.removed && (e.barrel === true || e.interactKind === 'barrel' || e.propType === 'barrels');
}

/**
 * A bullet or vehicle weapon hit a barrel (§3.6): it detonates (after `delay` s for chain reactions).
 * Barrels may provide their own `ignite(source, delay)`; otherwise the barrel is flagged destroyed and a
 * `barrel` explosion is applied at its position.
 */
export function hitBarrel(world, b, source = null, delay = 0) {
  if (!isBarrel(b) || b._igniting) return;
  if (typeof b.ignite === 'function') { b.ignite(delay, source); return; } // interactables Barrel.ignite(delay, by)
  b._igniting = true;
  const go = () => {
    b.destroyed = true;
    b._applyDestroyedState?.();
    explode(world, b.x, b.z, 'barrel', source, { exclude: b });
  };
  if (delay > 0) world.add(new Projectile('blast', { from: { x: b.x, z: b.z }, delay, source, onExplode: go }));
  else go();
}

/**
 * Apply a §3.6 explosion class at (x, z).
 * - units: inside `lethal` → instant death; grenade 4.5 m → 200; then the outer ring's damage
 * - vehicles: the hull within reach gets explosionHit(cls) (armour rules in entities/vehicle.js)
 * - structures (interactables with destructible/takeDamage): per the class' `structures` rule,
 *   within the lethal / damage radius (bombs: 6.75 m); `explosionHit(cls, source, d)` wins when present
 * - barrels within `chain` ignite after `chainDelay`
 * Emits `explosion` {x, z, radius, kind: cls, source, accident} and the map-wide noise (not for accidents).
 * @param {object} world @param {number} x @param {number} z @param {string} cls bomb|barrel|grenade|vehicle|shell
 * @param {any} [source] @param {{exclude?: any, accident?: boolean, silent?: boolean}} [o]
 * @returns {{killed: any[], damaged: any[], vehicles: any[], structures: any[]}}
 */
export function explode(world, x, z, cls, source = null, o = {}) {
  // One implementation of the §3.6 classes: ABILITIES' applyExplosion (vehicles use their explosionHit()).
  return applyExplosion(world, x, z, cls, source, { exclude: o.exclude, accident: o.accident, silent: o.silent, killer: o.killer });
}

export class Projectile extends Entity {
  /**
   * @param {string} projKind grenade|harpoon|tracer|shell|torpedo|timeBomb|remoteBomb|blast
   * @param {{from:{x,z}, to?:{x,z}, source?:any, damage?:number, radius?:number, delay?:number,
   *   hitFilter?:Function, vehicle?:any, explosion?:string, onExplode?:Function, accident?:boolean}} o
   */
  constructor(projKind, o) {
    const placed = projKind === 'timeBomb' || projKind === 'remoteBomb' || projKind === 'blast';
    super({ kind: 'projectile', x: o.from.x, z: o.from.z, y: placed ? 0.1 : projKind === 'torpedo' ? -0.2 : 1.2 });
    this.projKind = projKind;
    this.source = o.source ?? null;
    this.vehicle = o.vehicle ?? null;
    this.from = { x: o.from.x, z: o.from.z };
    this.to = o.to ? { x: o.to.x, z: o.to.z } : { ...this.from };
    const W = CONFIG.weapons;
    const wdef = W[projKind] || {};
    this.damage = o.damage ?? wdef.dmg ?? wdef.damage ?? KILL;
    this.radius = o.radius ?? wdef.radius ?? 0;
    this.explosion = o.explosion ?? CLASS_OF[projKind] ?? null;
    this.onExplode = o.onExplode ?? null;
    this.accident = !!o.accident;
    this.timer = o.delay ?? (projKind === 'timeBomb' ? (W.timeBomb.fuse ?? W.timeBomb.delay) : placed ? (projKind === 'blast' ? 0 : Infinity) : 0);
    this.hitFilter = o.hitFilter || ((u) => u !== this.source);
    this.dist = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z);
    if (projKind === 'harpoon') this.dist = Math.min(this.dist || W.harpoon.range, W.harpoon.range);
    this.speed = projKind === 'grenade' ? Math.max(SPEED.grenade, this.dist / (W.grenade.flight || 1))
      : projKind === 'shell' ? CONFIG.vehicles.shellSpeed ?? SPEED.shell
        : projKind === 'torpedo' ? CONFIG.vehicles.torpedo?.speed ?? SPEED.torpedo : SPEED[projKind] ?? 0;
    this.travelled = 0;
    this.landed = !(projKind in SPEED);
    this.heading = Math.atan2(this.to.z - this.from.z, this.to.x - this.from.x);
    if (projKind === 'harpoon' && this.dist > 0) {
      this.to = { x: this.from.x + Math.cos(this.heading) * this.dist, z: this.from.z + Math.sin(this.heading) * this.dist };
    }
    const L = LOOK[projKind] || LOOK.grenade;
    this.object3d = new THREE.Mesh(new THREE.SphereGeometry(L.r, 8, 6), new THREE.MeshStandardMaterial({ color: L.color, emissive: projKind === 'tracer' || projKind === 'shell' ? L.color : 0x000000 }));
    this.object3d.visible = projKind !== 'blast';
    if (projKind === 'harpoon' || projKind === 'tracer' || projKind === 'shell') this.object3d.scale.set(1, 1, 8);
    if (projKind === 'torpedo') this.object3d.scale.set(1, 1, 14);
  }

  /** Remote bombs: blow up now (also works for any charge). */
  detonate() {
    if (!this.alive) return;
    this.explode();
  }

  /** Blow up with this projectile's explosion class (§3.6) — or run the custom onExplode (chains). */
  explode() {
    if (!this.alive) return;
    this.alive = false;
    const w = this.world;
    if (!w) return;
    if (this.onExplode) this.onExplode(this);
    else if (this.explosion) {
      explode(w, this.x, this.z, this.explosion, this.source, { exclude: this.vehicle, accident: this.accident });
      if (this.projKind === 'timeBomb' || this.projKind === 'remoteBomb') {
        w.events.emit('bomb:exploded', { bomb: this, x: this.x, z: this.z, kind: this.projKind === 'timeBomb' ? 'time' : 'remote' });
      }
    }
    w.removeLater(this);
  }

  update(dt) {
    if (!this.alive) return;
    if (!this.landed) { this._fly(dt); return; }
    this.timer -= dt;
    if (this.timer <= 0) this.explode();
  }

  _fly(dt) {
    const w = this.world;
    const px = this.x, pz = this.z;
    this.travelled = Math.min(this.dist, this.travelled + this.speed * dt);
    const f = this.dist > 0 ? this.travelled / this.dist : 1;
    this.x = this.from.x + (this.to.x - this.from.x) * f;
    this.z = this.from.z + (this.to.z - this.from.z) * f;
    const k = this.projKind;
    this.y = k === 'grenade' ? 0.2 + Math.sin(f * Math.PI) * Math.max(2, this.dist * 0.35) : k === 'torpedo' ? -0.2 : 1.2;
    if (w && (k === 'harpoon' || k === 'shell' || k === 'torpedo')) {
      if (this._straightHit(w, px, pz)) return;
    }
    if (this.travelled >= this.dist) {
      this.landed = true;
      if (k === 'grenade') {
        this.y = 0.1;
        w?.events.emit('projectile:bounce', { projectile: this, x: this.x, z: this.z });
        this.explode();
        return;
      }
      if (k === 'shell') { this.explode(); return; }
      if (k === 'harpoon' || k === 'tracer' || k === 'torpedo') {
        if (k === 'torpedo' && w) w.events.emit('hit', { x: this.x, z: this.z, surface: 'water', target: null, weapon: 'torpedo' });
        this.alive = false;
        w?.removeLater(this);
      }
    }
  }

  /** Straight flyers: walls stop harpoons/shells; torpedoes need water; first unit / hull hit. @returns {boolean} consumed */
  _straightHit(w, px, pz) {
    const k = this.projKind;
    const g = w.grid;
    const { i, j } = g.worldToCell(this.x, this.z);
    const inb = g.inBounds(i, j);
    const cellK = inb ? g.idx(i, j) : -1;
    if (k === 'torpedo') {
      const water = inb && (g.terrain[cellK] === T.WATER || g.terrain[cellK] === T.SHALLOW) && g.block[cellK] !== B.HIGH;
      const hull = w.vehicles.find((v) => v !== this.vehicle && !v.removed && !v.destroyed && !v.hiddenRail && v._inHull(this.x, this.z, 0.3));
      const struct = (w.interactables || []).find((o) => !o.destroyed && (o.torpedoTarget || o.explosiveTarget) && Math.hypot(o.x - this.x, o.z - this.z) <= (o.radius || 2));
      if (!water || hull || struct) {
        w.events.emit('hit', { x: this.x, z: this.z, surface: hull ? 'metal' : 'shore', target: hull || struct || null, weapon: 'torpedo' });
        this.explode();
        return true;
      }
      return false;
    }
    if (!inb || g.block[cellK] === B.HIGH) {
      if (k === 'shell') { this.explode(); return true; }
      w.events.emit('hit', { x: this.x, z: this.z, surface: 'wall', target: null, weapon: k });
      this.alive = false;
      w.removeLater(this);
      return true;
    }
    if (k === 'harpoon') {
      const hit = w.entitiesInRadius(this.x, this.z, this.speed / 30 + 1, (u) => u.alive && u.hp != null && u.kind !== 'vehicle' && !u.vehicle && this.hitFilter(u)
        && distToSegment(u.x, u.z, px, pz, this.x, this.z) < 0.5);
      if (hit.length) {
        hit[0].takeDamage(this.damage, this.source, 'harpoon');
        w.events.emit('shot', { from: this.from, to: { x: hit[0].x, z: hit[0].z }, shooter: this.source, target: hit[0], hit: true, weapon: 'harpoon' });
        w.events.emit('hit', { x: hit[0].x, z: hit[0].z, surface: 'flesh', target: hit[0], weapon: 'harpoon' });
        this.alive = false;
        w.removeLater(this);
        return true;
      }
    }
    if (k === 'shell') {
      const hull = w.vehicles.find((v) => v !== this.vehicle && !v.removed && !v.destroyed && !v.hiddenRail && v._inHull(this.x, this.z, 0.2));
      if (hull) { this.explode(); return true; }
    }
    return false;
  }

  serialize() {
    return { ...super.serialize(), projKind: this.projKind, timer: this.timer, to: this.to, from: this.from, travelled: this.travelled, landed: this.landed };
  }
}

export default Projectile;
