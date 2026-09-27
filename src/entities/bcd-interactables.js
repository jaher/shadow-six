/**
 * BCD world mechanics (docs/bcd-plan.md §1.10) as data-driven interactables. A mission only gets one when its
 * `interactables[]` places it, and each checks its `world.rules.*` flag, so BEL never sees them.
 *   seaMine          MINASUB: a boat hull within 1.5 m sets it off (bomb blast, everyone aboard dies); swimmers
 *                    pass; any bullet / grenade detonates it from a distance
 *   pushable         VAGEMPUJ wagon on a rail polyline (`rail`) / DEPOSEMP fuel tank (free); GB and Driver push
 *                    (use): 0.8 / 0.6 m/s, level-1 noise (6 m); moving cover (dynamic LOS occluder); the tank
 *                    blows up (1.5× barrel) on an explosion or 3 bullets
 *   lift             ASCENSOR: `use` at either stop carries up to 4 men to the other stop in 6 s (creaks)
 *   drawbridge       PUENTE: a span (`rect` {x, z, w, d, rot}) that is a walkable deck when lowered;
 *   drawbridgeSwitch INTERRUPTOR: raises / lowers its `targets` drawbridges (5 s)
 *   knapsack         MOCHILA_*: the owner's H/use restores his BCD kit
 *   penGate          PUERTAAVESTRUCES: a gate door; open, the pen's ostriches roam (ai/animal-brain)
 * @module entities/bcd-interactables
 */

import * as THREE from 'three';
import { Interactable, INTERACTABLE_KINDS, BCD_ACTIVATABLE } from './interactables.js';
import { CONFIG } from '../config.js';
import { explode } from './projectile.js';
import { FIXED_KIT, BCD_KIT } from '../items.js';

const box = (w, h, d, color, x, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  return m;
};

export class SeaMine extends Interactable {
  constructor(o) {
    super({ ...o, interactKind: 'seaMine', label: 'Sea mine', destructible: true });
    this.exploded = false;
  }
  canUse() { return "Can't use that."; }
  takeDamage(amount, source) { if (!this.exploded) this.detonate(source); }
  detonate(source = null) {
    const w = this.world;
    if (this.exploded || !w) return;
    this.exploded = true;
    this.destroyed = true;
    if (this.object3d) this.object3d.visible = false;
    w.events.emit('bcd:mine', { mine: this, x: this.x, z: this.z });
    explode(w, this.x, this.z, 'bomb', source || this);
  }
  update(dt) {
    super.update?.(dt);
    const w = this.world;
    if (this.exploded || !w?.rules?.seaMines) return;
    for (const v of w.vehicles) {
      if (v.destroyed || v.removed || v.vehicleKind !== 'boat') continue;
      const r = Math.max(...(v.def?.size || [2, 1])) / 2;
      if (Math.hypot(v.x - this.x, v.z - this.z) > CONFIG.bcd.seaMine.trigger + r) continue;
      for (const u of [...(v.occupants || [])]) u.die?.('explosion', this);
      v.destroy?.(this, 'mine');
      this.detonate(this);
      return;
    }
  }
  serialize() { return { ...super.serialize(), exploded: this.exploded }; }
}

export class Pushable extends Interactable {
  constructor(o) {
    const tank = o.variant === 'tank';
    super({ ...o, interactKind: 'pushable', label: tank ? 'Fuel tank' : 'Wagon', destructible: tank, dynamic: true });
    this.variant = tank ? 'tank' : 'wagon';
    this.size = o.size || (tank ? [3, 1.6] : [5, 2.4]);
    this.rail = o.rail ? o.rail.map((p) => ({ x: p.x ?? p[0], z: p.z ?? p[1] })) : null;
    this.goal = null;
    this.pusher = null;
    this.bulletHits = 0;
    this._noiseT = 0;
    this.roles = o.roles ?? ['greenberet', 'driver'];
  }
  get speed() { return this.variant === 'tank' ? CONFIG.bcd.push.tank : CONFIG.bcd.push.wagon; }
  canUse(c) {
    if (!this.world?.rules?.pushables) return "Can't use that.";
    if (this.destroyed) return 'Nothing there.';
    if (!this.roles.includes(c?.role)) return 'Too heavy for me.';
    return this.goal ? 'Already moving.' : true;
  }
  /** Start a push: a wagon rolls to the far rail end, a tank 5 m away from the pusher. */
  interact(c) {
    let g;
    if (this.rail) {
      const a = this.rail[0], b = this.rail[this.rail.length - 1];
      g = Math.hypot(a.x - this.x, a.z - this.z) > Math.hypot(b.x - this.x, b.z - this.z) ? a : b;
    } else {
      const dx = this.x - c.x, dz = this.z - c.z, n = Math.hypot(dx, dz) || 1;
      g = { x: this.x + (dx / n) * (this.params.pushDist ?? 5), z: this.z + (dz / n) * (this.params.pushDist ?? 5) };
    }
    this.goal = { x: g.x, z: g.z };
    this.pusher = c;
    this._off = { x: c.x - this.x, z: c.z - this.z };
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'push', x: this.x, z: this.z, on: true });
    return true;
  }
  update(dt) {
    super.update?.(dt);
    const w = this.world, g = this.goal;
    if (!g || !w || this.destroyed) return;
    const p = this.pusher;
    if (!p?.alive || p.isMoving || (p.currentAction && p.currentActionId !== 'use')) { this.goal = null; this.pusher = null; return; } // he let go
    const dx = g.x - this.x, dz = g.z - this.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, this.speed * dt);
    if (d > 1e-6) { this.x += (dx / d) * step; this.z += (dz / d) * step; this.heading = Math.atan2(dz, dx); }
    p.x = this.x + this._off.x; p.z = this.z + this._off.z;
    if ((this._noiseT -= dt) <= 0) { this._noiseT = 1; w.emitNoise(this.x, this.z, CONFIG.bcd.push.noiseRadius, 'push', p); }
    if (this.object3d) this.object3d.position.set(this.x, this.object3d.position.y, this.z);
    if (d <= 0.05) { this.goal = null; this.pusher = null; }
  }
  stampOccluder(grid) {
    if (!this.destroyed && !this.removed) grid.stampDynamic(this.x, this.z, this.size[0], this.size[1], this.heading);
  }
  takeDamage(amount, source, cause) {
    if (this.variant !== 'tank' || this.destroyed) return;
    const bullet = ['pistol', 'rifle', 'sniper', 'sniperRifle', 'smg', 'mg', 'bullet', 'shot', 'luger', 'mp40'].includes(cause);
    if (bullet && ++this.bulletHits < 3) return;
    this.destroyed = true;
    if (this.object3d) this.object3d.visible = false;
    this.world?.events.emit('structure:destroyed', { id: this.tag ?? this.id, type: 'pushable', owner: this.owner });
    explode(this.world, this.x, this.z, 'fuelTank', source, { exclude: this });
  }
  serialize() { return { ...super.serialize(), goal: this.goal, bulletHits: this.bulletHits }; }
}

export class Lift extends Interactable {
  constructor(o) {
    super({ ...o, interactKind: 'lift', label: 'Lift' });
    const P = (p) => ({ x: p.x ?? p[0], z: p.z ?? p[1], y: p.y ?? p[2] ?? 0 });
    this.stops = [P(o.a ?? [o.x, o.z]), P(o.b)];
    this.at = o.at ?? 0; // index of the stop the cage is at
    this.ride = null;
  }
  canUse(c) {
    if (!this.world?.rules?.lifts) return "Can't use that.";
    return this.ride ? 'The lift is moving.' : true;
  }
  /** Call the cage to the user's stop, or ride it (everyone within 1.5 m of the stop, up to 4). */
  interact(c) {
    const w = this.world;
    const near = (s) => Math.hypot(c.x - s.x, c.z - s.z);
    const from = near(this.stops[0]) <= near(this.stops[1]) ? 0 : 1;
    const to = 1 - from;
    const riders = [...w.commandos, ...w.enemies.filter((e) => e.puppetOf)]
      .filter((u) => u.alive && Math.hypot(u.x - this.stops[from].x, u.z - this.stops[from].z) <= 1.5)
      .slice(0, CONFIG.bcd.lift.capacity);
    this.ride = { t: this.at === from ? CONFIG.bcd.lift.travel : CONFIG.bcd.lift.travel * 2, riders, to };
    for (const u of riders) u.stop?.();
    w.emitNoise(this.x, this.z, 8, 'push', this); // creak: level 1
    w.events.emit('device', { id: this.tag ?? this.id, sfx: 'lift', x: this.x, z: this.z, on: true });
    return true;
  }
  update(dt) {
    super.update?.(dt);
    const r = this.ride;
    if (!r || (r.t -= dt) > 0) return;
    const s = this.stops[r.to];
    r.riders.forEach((u, k) => { if (u.alive) { u.x = s.x + (k % 2) * 0.6; u.z = s.z + Math.floor(k / 2) * 0.6; u.y = s.y; u.stop?.(); } });
    this.at = r.to;
    this.ride = null;
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'lift', x: s.x, z: s.z, on: false });
  }
}

export class Drawbridge extends Interactable {
  constructor(o) {
    super({ ...o, interactKind: 'drawbridge', label: 'Drawbridge' });
    this.rect = o.rect || { x: o.x, z: o.z, w: 3, d: 8, rot: 0 };
    this.raised = !!o.raised;
    this.moving = 0;
  }
  canUse() { return "Can't use that."; }
  onAdded(world) { super.onAdded?.(world); this._apply(); }
  _apply() {
    const g = this.world?.grid, R = this.rect;
    if (!g) return;
    g.fillOrientedRect(R.x, R.z, R.w, R.d, R.rot ?? 0, 'bridge', this.raised ? 0 : 1);
    g.version++;
    if (this.object3d) this.object3d.rotation.z = this.raised ? Math.PI / 2.4 : 0;
  }
  /** Start raising / lowering (5 s; the deck stops carrying walkers as soon as it starts rising). */
  toggle() {
    if (this.moving > 0) return false;
    this.moving = CONFIG.bcd.drawbridge.time;
    this._target = !this.raised;
    if (this._target) { this.raised = true; this._apply(); }
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'drawbridge', x: this.x, z: this.z, on: this._target });
    return true;
  }
  update(dt) {
    super.update?.(dt);
    if (this.moving <= 0) return;
    if ((this.moving -= dt) > 0) return;
    this.raised = this._target;
    this._apply();
  }
  serialize() { return { ...super.serialize(), raised: this.raised, moving: this.moving }; }
}

export class DrawbridgeSwitch extends Interactable {
  constructor(o) { super({ ...o, interactKind: 'drawbridgeSwitch', label: 'Bridge switch' }); }
  canUse() { return this.world?.rules?.drawbridges ? true : "Can't use that."; }
  interact() {
    let ok = false;
    for (const it of this.world?.interactables || []) if (it instanceof Drawbridge && this.targets.includes(it.tag ?? it.id)) ok = it.toggle() || ok;
    return ok;
  }
}

export class Knapsack extends Interactable {
  constructor(o) { super({ ...o, interactKind: 'knapsack', label: 'Knapsack' }); this.ownerRole = o.ownerRole ?? 'greenberet'; }
  canUse(c) {
    if (this.removed || this.count <= 0) return 'Empty.';
    return c?.role === this.ownerRole ? true : 'Not my kit.';
  }
  interact(c) {
    const kit = { ...(FIXED_KIT[c.role] || {}), ...(BCD_KIT[c.role] || {}), ...(this.params.contents || {}) };
    for (const [id, n] of Object.entries(kit)) if (!c.has(id)) Interactable.give(c, id, n);
    this.count = 0;
    this.world?.removeLater?.(this);
    return true;
  }
}

const MESH = {
  seaMine: (s) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6 })); m.position.set(s.x, 0.2, s.z); return m; },
  pushable: (s) => (s.variant === 'tank' ? box(3, 1.8, 1.6, 0x4a5236, s.x, s.z) : box(5, 2.2, 2.4, 0x5a3a26, s.x, s.z)),
  lift: (s) => box(1.8, 2.4, 1.8, 0x585858, s.x, s.z),
  drawbridge: (s) => box((s.rect?.d ?? 8), 0.3, (s.rect?.w ?? 3), 0x6b5030, s.rect?.x ?? s.x, s.rect?.z ?? s.z),
  drawbridgeSwitch: (s) => box(0.4, 0.9, 0.3, 0xb0a040, s.x, s.z),
  knapsack: (s) => box(0.5, 0.35, 0.35, 0x4f5a34, s.x, s.z),
};
const CLASS = { seaMine: SeaMine, pushable: Pushable, lift: Lift, drawbridge: Drawbridge, drawbridgeSwitch: DrawbridgeSwitch, knapsack: Knapsack };

for (const [kind, C] of Object.entries(CLASS)) {
  INTERACTABLE_KINDS[kind] = (spec, opts = {}) => new C({ ...spec, object3d: opts.meshes === false ? null : MESH[kind]?.(spec) ?? null });
}
INTERACTABLE_KINDS.penGate = (spec, opts = {}) => new Interactable({ ...spec, interactKind: 'door', label: 'Pen gate', object3d: opts.meshes === false ? null : box(3, 1.6, 0.2, 0x6a5a3a, spec.x, spec.z) });
for (const k of ['pushable', 'lift', 'drawbridgeSwitch', 'knapsack']) BCD_ACTIVATABLE.add(k); // the BEL set stays untouched
