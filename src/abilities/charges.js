/**
 * Placed and thrown devices (design-spec §3.3/§3.4) — owned by ABILITIES:
 *   Bomb     time bomb (explodes 10.0 s after release, `bomb:armed` tick loop) or remote bomb (detonator, oldest
 *            first, 0.2 s radio delay). Explosion class `bomb` (§3.6) + `bomb:exploded` {bomb, x, z, kind}.
 *            SHADOW SIX house rule `recoverCharges`: the Sapper takes it back (abilities/sapper.js takeCharge) —
 *            `take()` stops the clock and puts it back in his knapsack (`bomb:disarmed` {bomb, kind, unit, x, z}).
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
import { makeBearTrap } from '../art/bear-trap.js';
import { makeCharge, makeMillsBomb } from '../art/demolition-charge.js';

function blob(color, r = 0.18, h = 0.12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.position.y = h / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

/** tan 30°: the steepest ground a placed charge is drawn lying on (Bomb.syncTransform). */
const MAX_SLOPE = Math.tan(Math.PI / 6);

export class Bomb extends Interactable {
  /**
   * @param {{x, z, y?: number, heading?: number, bombKind:'time'|'remote', owner?: any, fuse?: number, fuse0?: number,
   *   seq?: number, insideOf?: string|null}} o heading: the planter's (the bundle's long side along it)
   */
  constructor(o) {
    // a real charge (art/demolition-charge.js: slabs, ties, detonator, the watch delay / the receiver), not a disc
    super({ interactKind: 'bomb', x: o.x, z: o.z, heading: o.heading ?? 0, dynamic: true, object3d: makeCharge(o.bombKind === 'time' ? 'time' : 'remote') });
    this.bombKind = o.bombKind;
    this.planter = o.owner ?? null;
    this.fuse = o.bombKind === 'time' ? o.fuse ?? CONFIG.weapons.timeBomb.fuse : Infinity;
    /** The fuse it was set with (the watch hand's full turn; visual only). */
    this.fuse0 = o.bombKind === 'time' ? o.fuse0 ?? Math.max(this.fuse, CONFIG.weapons.timeBomb.fuse) : Infinity;
    this.seq = o.seq ?? 0;
    this.exploded = false;
    /** Taken back by the Sapper (recoverCharges): disarmed, about to leave the world. */
    this.taken = false;
    /** Set inside this bunker (its tag, abilities/bunker-entry.js): taking it back means going in again. */
    this.insideOf = o.insideOf ?? null;
    // planted where the Sapper stands: on a roof / crest it sits on the roof, not inside the block (M14 review, g3)
    this.y = this.prevY = o.y ?? 0;
    this.object3d.position.set(this.x, this.y, this.z);
    // picked (hover hand, a click / tap to take it back) at the charge itself, low on the ground — not at a man's chest
    this.pickHeight = 0.1;
    this.pickRadius = 0.4;
  }

  /**
   * Drawn on the ground it was set on: the visual relief (world.groundY, Entity.syncTransform) under it, and tilted to
   * that slope (sampled once ±0.15 m round it; flat on decks, roofs and floors, where the relief is 0).
   */
  syncTransform(alpha = 1) {
    super.syncTransform(alpha);
    const o = this.object3d, w = this.world;
    if (!o || !w?.groundY) return;
    if (this._tilt === undefined) {
      const h = 0.15, gx = (w.groundY(this.x + h, this.z) - w.groundY(this.x - h, this.z)) / (2 * h);
      const gz = (w.groundY(this.x, this.z + h) - w.groundY(this.x, this.z - h)) / (2 * h);
      // (a charge does not lie on more than 30°: it would slide off; a rock edge in the relief must not stand it on end)
      const g = Math.hypot(gx, gz), k = g > MAX_SLOPE ? MAX_SLOPE / g : 1;
      const n = new THREE.Vector3(-gx * k, 1, -gz * k).normalize();
      this._tilt = n.y < 0.9999 ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n) : null;
    }
    if (this._tilt) o.quaternion.premultiply(this._tilt);
  }

  /** The armed cue (art/demolition-charge.js tick): the watch hand and its ticks, the receiver's pilot lamp. */
  renderUpdate() {
    if (!this.placed) return;
    this.object3d?.userData.charge?.tick({ time: this.world?.time ?? 0, fuse: this.fuse, fuse0: this.fuse0, detonating: this.detonating });
  }

  /** The knapsack item this charge was (and goes back to). */
  get chargeItem() { return this.bombKind === 'time' ? 'timeBomb' : 'remoteBomb'; }

  /** Still on the ground and live: neither gone off, taken back nor removed. */
  get placed() { return !this.exploded && !this.taken && !this.removed && this.alive !== false; }

  /** A remote charge whose detonator has been pressed (its 0.2 s radio delay running). */
  get detonating() { return this.bombKind !== 'time' && Number.isFinite(this.fuse); }

  /** Remote: detonate after the radio delay (§3.4). */
  detonate(delay = CONFIG.abilities.remoteDelay) {
    if (!this.placed) return false;
    this.fuse = Math.min(this.fuse, delay);
    return true;
  }

  /**
   * Taken back by `c` (house rule recoverCharges; abilities/sapper.js takeCharge checks who and when): a ticking clock
   * stops, the charge leaves the ground and its item goes back into his knapsack, all in the same instant, so it is
   * never both lost and kept. @returns {boolean} false when it is no longer there to take
   */
  take(c) {
    if (!this.placed || this.detonating) return false;
    const fuse = Number.isFinite(this.fuse) ? this.fuse : null;
    c.gainItem(this.chargeItem, 1);
    this.taken = true;
    this.alive = false;
    this.fuse = Infinity;
    const w = this.world;
    w?.events.emit('bomb:disarmed', { bomb: this, kind: this.bombKind, unit: c, x: this.x, z: this.z, fuse });
    w?.removeLater(this);
    return true;
  }

  explode() {
    if (this.exploded || this.taken) return;
    this.exploded = true;
    this.alive = false;
    const w = this.world;
    if (!w) return;
    applyExplosion(w, this.x, this.z, 'bomb', this, { killer: this.planter });
    w.events.emit('bomb:exploded', { bomb: this, x: this.x, z: this.z, kind: this.bombKind });
    w.removeLater(this);
  }

  update(dt) {
    if (this.exploded || this.taken) return;
    // the fuse starts on the step after release, so a time bomb goes off exactly `fuse` s after bomb:armed
    if (this._fresh === undefined) { this._fresh = false; return; }
    if (Number.isFinite(this.fuse)) {
      this.fuse -= dt;
      if (this.fuse <= 1e-9) this.explode();
    }
  }

  /**
   * May `c` take it back (hand / takeCharge)? Only the Sapper handles explosives (§3.2 pick-up table), only under the
   * house rule recoverCharges (the 1998 rules: a charge once set stays put), and only while it is there and not going off.
   */
  canUse(c) {
    if (!this.placed) return 'Nothing there.';
    if (!this.world?.house?.recoverCharges) return 'Leave it.';
    if (c?.role !== 'sapper') return 'Only the Sapper can handle explosives.';
    if (this.detonating) return "Too late — it's going off!";
    return true;
  }

  serialize() {
    return { ...super.serialize(), bombKind: this.bombKind, fuse: Number.isFinite(this.fuse) ? this.fuse : null, seq: this.seq, planter: this.planter?.id ?? null,
      // (optional: saves without them load as before)
      ...(this.insideOf != null ? { insideOf: this.insideOf } : null), ...(Number.isFinite(this.fuse0) ? { fuse0: this.fuse0 } : null) };
  }
}

export class Trap extends Interactable {
  constructor(o) {
    // a real jaw trap, half sunk in the ground while set (art/bear-trap.js; it was a flat dark disc), turned to the
    // setter's facing so its springs lie across his path
    super({ interactKind: 'trap', x: o.x, z: o.z, dynamic: true, object3d: makeBearTrap({ heading: o.heading ?? 0 }) });
    this.setter = o.owner ?? null;
    this.sprung = false;
    this.victim = null;
    this.jaw = 0; // 0 set → 1 shut (visual)
    this.trapHeading = o.heading ?? 0;
    this.object3d.position.set(this.x, 0, this.z);
  }

  onAdded(world) {
    super.onAdded?.(world);
    this.object3d?.userData.setGround?.(world?.mission?.theater || 'temperate');
  }

  update(dt = 0) {
    if (this.sprung && this.jaw < 1) { // the jaws snap shut in ~0.08 s
      this.jaw = Math.min(1, this.jaw + (dt || 1 / 60) / 0.08);
      this.object3d?.userData.setSprung?.(this.jaw);
    }
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

  serialize() { return { ...super.serialize(), sprung: this.sprung, planter: this.setter?.id ?? null, trapHeading: this.trapHeading }; }
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
    this.object3d = makeMillsBomb(); // a Mills bomb (No. 36), not a ball (art/demolition-charge.js)
  }

  /** Tumbling end over end in the air. */
  syncTransform(alpha = 1) {
    super.syncTransform(alpha);
    if (this.object3d) this.object3d.rotation.z = -this.t * 11;
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
