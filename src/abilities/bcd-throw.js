/**
 * BCD throwables (docs/bcd-plan.md §1.4, §1.5) — `campaigns: ['BCD']`, never under BEL:
 *   stone       Y  all six + Skopje (not Natasha): 12 m arc, 0.6 s flight, a small click soldiers within 4 m
 *                  look at; the 3rd stone in 20 s makes a walker investigate (ai/bcd-reactions). Hidden count 50.
 *   cigarettes  V  all six + both guests: 10 m arc; the pack lands as a pickup and lures the nearest soldier
 *                  whose NEAR band holds it (walk over, kneel 3 s, pocket it, walk back).
 * Neither is a suspicious act. Both lob over low walls (range only, no LOS), like the grenade.
 * @module abilities/bcd-throw
 */

import * as THREE from 'three';
import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { Entity } from '../entities/entity.js';
import { createPickup } from '../entities/interactables.js';
import { timedTask, freeToAct, inReach, enemyNear } from './common.js';
import { stoneLanded, packLanded } from '../ai/bcd-reactions.js';

const BCD = ['BCD'];
const THROW_TIME = 0.4;

/** A thrown stone / pack: arc from→to over `flight` s, then onLand(x, z). */
export class Thrown extends Entity {
  constructor({ from, to, thrower, flight, what, onLand }) {
    super({ kind: 'projectile', x: from.x, z: from.z, y: 1.4 });
    this.projKind = what;
    this.from = { x: from.x, z: from.z };
    this.to = { x: to.x, z: to.z };
    this.thrower = thrower ?? null;
    this.flight = flight;
    this.onLand = onLand;
    this.t = 0;
    this.object3d = new THREE.Mesh(
      what === 'stone' ? new THREE.SphereGeometry(0.05, 6, 4) : new THREE.BoxGeometry(0.09, 0.03, 0.06),
      new THREE.MeshStandardMaterial({ color: what === 'stone' ? 0x77736a : 0xd8d0b0 }),
    );
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    const f = Math.min(1, this.t / this.flight);
    const d = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z);
    this.x = this.from.x + (this.to.x - this.from.x) * f;
    this.z = this.from.z + (this.to.z - this.from.z) * f;
    this.y = 1.4 * (1 - f) + Math.sin(f * Math.PI) * Math.max(1.2, d * 0.2);
    if (f < 1) return;
    this.alive = false;
    const w = this.world;
    if (!w) return;
    w.events.emit('projectile:bounce', { projectile: this, x: this.x, z: this.z });
    this.onLand?.(this.x, this.z, w);
    w.removeLater(this);
  }

  serialize() { return { ...super.serialize(), projKind: this.projKind, t: this.t, from: this.from, to: this.to }; }
}

function throwCanUse(c, t, world, flag, range) {
  if (!world.rules?.[flag]) return 'Not in this campaign.';
  const f = freeToAct(c);
  if (f !== true) return f;
  if (c.stance === 'dive' || c.underwater || c.stance === 'swim') return 'Not from the water.';
  if (c.carrying) return 'Drop it first.';
  if (!t) return 'Pick a spot.';
  return inReach(world, c, t, range);
}

registerAbility({
  id: 'stone', label: 'Stones', icon: '🪨', hotkey: null, roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'skopje'],
  item: 'stones', targeting: 'point', cursor: 'grenade', order: 60, campaigns: BCD, ranged: true,
  range: CONFIG.bcd.stones.range, noiseRadius: CONFIG.bcd.stones.noiseRadius, visibleToEnemies: false, group: 'stone',
  canUse(c, t, world) { return throwCanUse(c, t, world, 'stones', CONFIG.bcd.stones.range); },
  start(c, t, world) {
    const S = CONFIG.bcd.stones;
    c.playAction('throw', THROW_TIME);
    const to = { x: t.x, z: t.z };
    const hitUnit = t.kind === 'enemy' ? t : null;
    return timedTask({ dur: THROW_TIME, steps: [{ at: THROW_TIME, fn: () => {
      if (!c.consume('stones')) return false;
      c.faceTowards(to.x, to.z);
      world.add(new Thrown({ from: c, to, thrower: c, flight: S.flight, what: 'stone',
        onLand: (x, z, w) => stoneLanded(w, x, z, c, hitUnit || enemyNear(w, x, z, 0.5)) }));
      return true;
    } }] });
  },
});

registerAbility({
  id: 'cigarettes', label: 'Cigarettes', icon: '🚬', hotkey: null,
  roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'natasha', 'skopje'],
  item: 'cigarettes', targeting: 'point', cursor: 'grenade', order: 61, campaigns: BCD, ranged: true,
  range: CONFIG.bcd.cigarettes.range, visibleToEnemies: false, group: 'cigarettes',
  canUse(c, t, world) { return throwCanUse(c, t, world, 'cigarettes', CONFIG.bcd.cigarettes.range); },
  start(c, t, world) {
    const C = CONFIG.bcd.cigarettes;
    c.playAction('throw', THROW_TIME);
    const to = { x: t.x, z: t.z };
    return timedTask({ dur: THROW_TIME, steps: [{ at: THROW_TIME, fn: () => {
      if (!c.consume('cigarettes')) return false;
      c.faceTowards(to.x, to.z);
      world.add(new Thrown({ from: c, to, thrower: c, flight: C.flight, what: 'pack',
        onLand: (x, z, w) => {
          const pack = createPickup('cigarettes', x, z, 1, { label: 'Cigarettes', pack: true });
          if (!w.scene) pack.object3d = null; // headless worlds (tests) carry no meshes
          w.add(pack);
          packLanded(w, pack);
        } }));
      return true;
    } }] });
  },
});
