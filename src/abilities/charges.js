/**
 * Placed and thrown devices (design-spec §3.3/§3.4) — owned by ABILITIES:
 *   Bomb     time bomb (explodes 10.0 s after release, `bomb:armed` tick loop) or remote bomb (detonator, oldest
 *            first, 0.2 s radio delay). Explosion class `bomb` (§3.6) + `bomb:exploded` {bomb, x, z, kind}.
 *   Trap     bear trap: invisible to enemies; the first ENEMY within 0.5 m dies silently (`trap:sprung`); then
 *            sprung (player-visible) until the Sapper picks it up (H) and sets it again.
 *   Decoy    acoustic decoy: `on` → a decoy noise (13.5 m, level 1) every 1.5 s (BEL-tick cadence, system.js).
 *   Grenade  thrown: 1.0 s arc over walls to the target point, then explosion class `grenade`.
 * Bomb/Trap/Decoy are Interactables (the hand can pick them up; saved with the world); Grenade is a projectile.
 * @module abilities/charges
 */

import * as THREE from 'three';
import { Entity } from '../entities/entity.js';
import { Interactable } from '../entities/interactables.js';
import { CONFIG, KILL } from '../config.js';
import { applyExplosion } from './explosions.js';
import { systemsOf } from './system.js';

function blob(color, r = 0.18, h = 0.12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.position.y = h / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export class Bomb extends Interactable {
  /** @param {{x, z, bombKind:'time'|'remote', owner?: any, fuse?: number, seq?: number}} o */
  constructor(o) {
    super({ interactKind: 'bomb', x: o.x, z: o.z, dynamic: true, object3d: blob(o.bombKind === 'time' ? 0x7a2020 : 0x20207a) });
    this.bombKind = o.bombKind;
    this.planter = o.owner ?? null;
    this.fuse = o.bombKind === 'time' ? o.fuse ?? CONFIG.weapons.timeBomb.fuse : Infinity;
    this.seq = o.seq ?? 0;
    this.exploded = false;
    this.object3d.position.set(this.x, 0, this.z);
  }

  /** Remote: detonate after the radio delay (§3.4). */
  detonate(delay = CONFIG.abilities.remoteDelay) {
    if (this.exploded) return false;
    this.fuse = Math.min(this.fuse, delay);
    return true;
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true;
    this.alive = false;
    const w = this.world;
    if (!w) return;
    applyExplosion(w, this.x, this.z, 'bomb', this, { killer: this.planter });
    w.events.emit('bomb:exploded', { bomb: this, x: this.x, z: this.z, kind: this.bombKind });
    w.removeLater(this);
  }

  update(dt) {
    if (this.exploded) return;
    // the fuse starts on the step after release, so a time bomb goes off exactly `fuse` s after bomb:armed
    if (this._fresh === undefined) { this._fresh = false; return; }
    if (Number.isFinite(this.fuse)) {
      this.fuse -= dt;
      if (this.fuse <= 1e-9) this.explode();
    }
  }

  canUse() { return 'Leave it.'; }

  serialize() { return { ...super.serialize(), bombKind: this.bombKind, fuse: Number.isFinite(this.fuse) ? this.fuse : null, seq: this.seq, planter: this.planter?.id ?? null }; }
}

export class Trap extends Interactable {
  constructor(o) {
    super({ interactKind: 'trap', x: o.x, z: o.z, dynamic: true, object3d: blob(0x404040, 0.25, 0.05) });
    this.setter = o.owner ?? null;
    this.sprung = false;
    this.victim = null;
    this.object3d.position.set(this.x, 0, this.z);
  }

  update() {
    if (this.sprung || !this.world) return;
    const r = CONFIG.abilities.trap.trigger;
    for (const e of this.world.entitiesInRadius(this.x, this.z, r + 0.5, (u) => u.kind === 'enemy' && u.alive && u.state !== 'inVehicle')) {
      if (Math.hypot(e.x - this.x, e.z - this.z) > r) continue;
      this.sprung = true;
      this.victim = e;
      e.takeDamage(KILL, this.setter, 'trap'); // silent (CEPO): no noise event
      this.world.events.emit('trap:sprung', { trap: this, victim: e });
      break;
    }
  }

  canUse(c) {
    if (c.role !== 'sapper') return "Can't pick that up.";
    return true;
  }

  /** H (1.0 s): back into the knapsack, ready to set again. */
  pickUp(c) {
    c.gainItem('bearTrap', 1);
    this.alive = false;
    this.world?.removeLater(this);
    return true;
  }

  serialize() { return { ...super.serialize(), sprung: this.sprung, planter: this.setter?.id ?? null }; }
}

export class Decoy extends Interactable {
  constructor(o) {
    super({ interactKind: 'decoy', x: o.x, z: o.z, dynamic: true, object3d: blob(0x556b2f, 0.12, 0.2) });
    this.planter = o.owner ?? null;
    this.on = false;
    this.onTick = 0;
    this.pulses = 0;
    this.object3d.position.set(this.x, 0, this.z);
  }

  onAdded(world) {
    systemsOf(world).decoys.add(this);
  }

  /** I: toggle beeping. The first pulse sounds at once, then every 1.5 s (§3.4, BEEP technique). */
  setOn(on) {
    const w = this.world;
    this.on = !!on;
    this.onTick = w?.belTick ?? 0;
    if (this.on) this.pulse();
    w?.events.emit('device', { id: this.id, sfx: 'decoy_beep', x: this.x, z: this.z, on: this.on });
  }

  pulse() {
    const N = CONFIG.stealth.noise.decoy;
    this.pulses++;
    this.world?.emitNoise(this.x, this.z, N.radius, 'decoy', this, N.level);
  }

  canUse(c) { return c.role === 'greenberet' ? true : "Can't pick that up."; }

  /** H: pick it up again → the Q item returns, the activator goes (§3.4). */
  pickUp(c) {
    this.on = false;
    c.loseItem('decoyActivator');
    c.gainItem('decoy', 1);
    c.decoy = null;
    this.alive = false;
    this.world && systemsOf(this.world).decoys.delete(this);
    this.world?.removeLater(this);
    return true;
  }

  dispose() {
    if (this.world) systemsOf(this.world).decoys.delete(this);
    super.dispose?.();
  }

  // the planter too: after a load the Green Beret must still own it (toggle / pick up, replay m03)
  serialize() { return { ...super.serialize(), on: this.on, onTick: this.onTick, pulses: this.pulses, planter: this.planter?.id ?? null }; }
}

/** Thrown grenade (§3.4): ballistic arc over walls, lands after `flight` s, explodes as class `grenade`. */
export class Grenade extends Entity {
  constructor({ from, to, thrower }) {
    super({ kind: 'projectile', x: from.x, z: from.z, y: 1.4 });
    this.projKind = 'grenade';
    this.from = { x: from.x, z: from.z };
    this.to = { x: to.x, z: to.z };
    this.thrower = thrower ?? null;
    this.flight = CONFIG.weapons.grenade.flight;
    this.t = 0;
    this.object3d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a3f2a }));
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    const f = Math.min(1, this.t / this.flight);
    const d = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z);
    this.x = this.from.x + (this.to.x - this.from.x) * f;
    this.z = this.from.z + (this.to.z - this.from.z) * f;
    this.y = 1.4 * (1 - f) + Math.sin(f * Math.PI) * Math.max(2.5, d * 0.35);
    if (f >= 1) {
      this.alive = false;
      const w = this.world;
      if (!w) return;
      w.events.emit('projectile:bounce', { projectile: this, x: this.x, z: this.z });
      applyExplosion(w, this.x, this.z, 'grenade', this, { killer: this.thrower });
      w.removeLater(this);
    }
  }

  serialize() { return { ...super.serialize(), projKind: 'grenade', t: this.t, from: this.from, to: this.to }; }
}
