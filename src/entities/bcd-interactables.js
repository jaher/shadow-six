/**
 * BCD world mechanics (docs/bcd-plan.md §1.10) as data-driven interactables. A mission only gets one when its
 * `interactables[]` places it, and each checks its `world.rules.*` flag, so BEL never sees them.
 *   seaMine          MINASUB: a boat hull within 1.5 m sets it off (bomb blast, everyone aboard dies); swimmers
 *                    pass; any bullet / grenade detonates it from a distance
 *   pushable         VAGEMPUJ wagon on a rail polyline (`rail`; `variant: 'spoil'` draws a side-tipping colliery
 *                    wagon) / DEPOSEMP fuel tank (free); GB and Driver push
 *                    (use): 0.8 / 0.6 m/s, level-1 noise (6 m); moving cover (dynamic LOS occluder); the tank
 *                    blows up (1.5× barrel) on an explosion or 3 bullets
 *   lift             ASCENSOR: `use` at either stop carries up to 4 men to the other stop in 6 s (creaks); each stop
 *                    has its own height (`a: [x, z, y]`, `aY` / `bY`, else the ground there): two levels at different
 *                    heights (a cliff top and the beach, a pithead and its gallery) are two places on the map;
 *                    `winchOnly` (worked only from its winch: use at a stop is refused), `enclosed` (a high-sided
 *                    skip: carries its riders along a → b, unseen, in `travel` s; men lying in it at a stop are
 *                    unseen too)
 *   drawbridge       PUENTE: a span (`rect` {x, z, w, d, rot}) that is a walkable deck when lowered and closes the
 *                    channel to boats; raised, walkers cannot cross (a patrol whose route crosses waits at its edge:
 *                    ai/bcd-brain BRIDGE) and boats pass
 *   drawbridgeSwitch INTERRUPTOR: raises / lowers its `targets` drawbridges (5 s); a lift among its targets is sent to
 *                    its other stop
 *   winch            the same machine for a lift (a pithead winch, a hoist): `use` sends each target cage to its other
 *                    stop with whoever stands in it (a drawbridge target is raised / lowered)
 *   knapsack         MOCHILA_*: the owner's H/use restores his BCD kit
 *   penGate          PUERTAAVESTRUCES: a gate door in the gap world/placement cuts for it in its fence run (`rot`
 *                    along the run, `w` 3.2 m): shut, its leaf blocks the gap like the fence; open, the gap is clear
 *                    and the pen's ostriches roam (ai/animal-brain)
 * @module entities/bcd-interactables
 */

import * as THREE from 'three';
import { Interactable, INTERACTABLE_KINDS, BCD_ACTIVATABLE } from './interactables.js';
import { CONFIG } from '../config.js';
import { explode } from './projectile.js';
import { RULES } from '../world/placement.js';
import { bodyRectGap, bodyReach, unitStance } from '../world/body-clearance.js';
import { FIXED_KIT, BCD_KIT } from '../items.js';
import { dressingMaterial, boxUV } from '../art/dressing.js';
import { paintedMaterial } from '../art/kit-props.js';
import { T, B } from '../world/grid.js';

/**
 * Placeholder device: a Group at (x, 0, z) holding a w × h × d box standing ON the ground (`g.userData.inner` = the
 * box; w runs along world x). Dynamic devices (pushables) get the heading compensation from `faceHeading`.
 */
const box = (w, h, d, color, x, z, y0 = 0) => {
  const g = new THREE.Group();
  // placeholder-art pass: a textured kit finish (art/dressing.js sets) instead of a flat colour; `color` may be a material
  const mat = color?.isMaterial ? color : new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d).toNonIndexed(), 1), mat);
  m.position.y = y0 + h / 2;
  m.castShadow = true;
  g.add(m);
  g.position.set(x, 0, z);
  g.userData.inner = m;
  return g;
};
/** Entity.syncTransform turns a dynamic object3d by headingToRotY (model forward = +z): keep `w` along the heading. */
const faceHeading = (g) => { if (g?.userData.inner) g.userData.inner.rotation.y = -Math.PI / 2; return g; };
/**
 * Lift cage: a floor pad and four corner posts (riders stand inside it, not inside a solid block). Nothing blocks the
 * nav there, so any man may cross it on the ground: the pad is flush with the ground (a 6 cm slab whose top stands 1.5 cm
 * over it, not a 10 cm block a crawler or a boot sank into: b00 clipping seed 11, the diver crawling over its corner,
 * 5.7 cm) and the posts are slim (6 cm square: a limb through one is never 5 cm deep).
 */
const CAGE = { pad: 0.06, padTop: 0.015, post: 0.06 };
const cage = (x, z) => {
  const g = box(1.8, CAGE.pad, 1.8, dressingMaterial('galv'), x, z, CAGE.padTop - CAGE.pad);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(CAGE.post, 2.4, CAGE.post), g.userData.inner.material);
    post.position.set(sx * 0.85, 1.2, sz * 0.85); post.castShadow = true;
    g.add(post);
  }
  return g;
};

/**
 * Placement rule (e) for small standing devices (a switch post, a floating mine, a knapsack on the ground): solid
 * for walkers and swimmers (nav-only block over the body + RULES.bodyNav) while it stands, and approached from its
 * edge (commando targetPoint). `off` clears the stamp (picked up).
 */
function stampSolid(ent, w, d, off = false) {
  const g = ent.world?.grid, m = 2 * RULES.bodyNav;
  if (!g?.navStamp) return;
  g.navStamp(`dev:${ent.id}`, off || ent.destroyed || ent.removed ? [] : g.rectCells(ent.x, ent.z, w + m, d + m, ent.heading ?? 0));
}
/** Where a unit at `u` stands to reach a solid w × d body (heading h) centred on `o`: just outside its edge. */
function edgeApproach(o, u, w, d, h = 0, gap = 0.55) {
  const c = Math.cos(h), s = Math.sin(h), dx = u.x - o.x, dz = u.z - o.z;
  const hw = w / 2 + gap, hd = d / 2 + gap;
  let lu = Math.max(-hw, Math.min(hw, dx * c + dz * s)), lv = Math.max(-hd, Math.min(hd, -dx * s + dz * c));
  if (Math.abs(lu) < hw && Math.abs(lv) < hd) { if (hw - Math.abs(lu) < hd - Math.abs(lv)) lu = Math.sign(lu || 1) * hw; else lv = Math.sign(lv || 1) * hd; }
  return { x: o.x + lu * c - lv * s, z: o.z + lu * s + lv * c };
}

export class SeaMine extends Interactable {
  constructor(o) {
    super({ ...o, interactKind: 'seaMine', label: 'Sea mine', destructible: true });
    this.exploded = false;
  }
  canUse() { return "Can't use that."; }
  onAdded(world) { super.onAdded?.(world); stampSolid(this, 1, 1); } // swimmers go round it
  approachFrom(u) { return edgeApproach(this, u, 1, 1); }
  takeDamage(amount, source) { if (!this.exploded) this.detonate(source); }
  detonate(source = null) {
    const w = this.world;
    if (this.exploded || !w) return;
    this.exploded = true;
    this.destroyed = true;
    stampSolid(this, 1, 1);
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

/**
 * Pushable rail wagon / fuel tank. Mission data beyond the catalogue's (all optional, BCD-only by construction: a
 * pushable exists only where a BCD mission places one):
 *   size: [length, width]         the body (m), length along its heading
 *   roles: [...]                  who may push it (default GB and Driver; [] = nobody: a locomotive)
 *   drop: {at: [x, z], noise?}    a rail wagon whose centre passes `at` (beyond the end of a lowered span, e06) tips off
 *                                 the rail: destroyed (a `destroy` objective counts it), a level-2 splash noise
 *   bombable: true                a charge destroys it (not bullets): a shunting engine
 * A drawbridge that is not fully down closes the rail across it: the push (or a haul) stops with the wagon's nose at the
 * span's edge (e06 link-span). `haul(to, speed, train)` moves it with nobody pushing (a locomotive coupling up).
 */
export class Pushable extends Interactable {
  constructor(o) {
    const tank = o.variant === 'tank';
    super({ ...o, interactKind: 'pushable', label: o.label ?? (tank ? 'Fuel tank' : 'Wagon'), destructible: tank || !!o.bombable, dynamic: true });
    this.variant = tank ? 'tank' : 'wagon';
    this.size = o.size || (tank ? [3, 1.6] : [5, 2.4]);
    this.rail = o.rail ? o.rail.map((p) => ({ x: p.x ?? p[0], z: p.z ?? p[1] })) : null;
    this.goal = null;
    this.pusher = null;
    this.bulletHits = 0;
    this._noiseT = 0;
    this.roles = o.roles ?? ['greenberet', 'driver'];
    this.dropped = false;
    this._haul = null; // scripted move {x, z, speed, train: [{p, dx, dz}]}
    this._hauledBy = null; // the pushable hauling this one (coupled)
  }
  get speed() { return this.variant === 'tank' ? CONFIG.bcd.push.tank : CONFIG.bcd.push.wagon; }
  /** Where a unit at `u` stands to push: just outside the body on its side (the body itself is solid). */
  approachFrom(u) { return edgeApproach(this, u, this.size[0], this.size[1], this.heading ?? 0); }
  /** At rest the wagon / tank is solid for walkers (grid nav-only block; placement rule e); rolling it is not. */
  onAdded(world) { super.onAdded?.(world); this._navRest(); }
  _navRest() {
    const g = this.world?.grid;
    if (!g?.navStamp) return;
    const moving = this.goal || this._haul || this._hauledBy;
    g.navStamp(`push:${this.id}`, this.destroyed || moving ? [] : g.rectCells(this.x, this.z, this.size[0] + 2 * RULES.bodyNav, this.size[1] + 2 * RULES.bodyNav, this.heading ?? 0));
    this._navAt = { x: this.x, z: this.z };
  }
  /**
   * A drawbridge that is not fully down (raised, or rising / lowering) across the way of this body moving to (x, z)
   * heading `h`: the middle and corners of its leading face are tested against every span's rect. @returns the span or null
   */
  spanAhead(x, z, h) {
    const spans = this.world?._drawbridges;
    if (!spans?.length) return null;
    const L = this.size[0] / 2 + 0.05, W = this.size[1] / 2 - 0.05, c = Math.cos(h), s = Math.sin(h);
    for (const b of spans) {
      if (b.down || b.removed) continue;
      const R = b.rect, rc = Math.cos(R.rot ?? 0), rs = Math.sin(R.rot ?? 0);
      for (const v of [0, W, -W]) {
        const px = x + L * c - v * s, pz = z + L * s + v * c, dx = px - R.x, dz = pz - R.z;
        if (Math.abs(dx * rc + dz * rs) <= R.w / 2 && Math.abs(-dx * rs + dz * rc) <= R.d / 2) return b;
      }
    }
    return null;
  }
  /** Does this body (where it stands now) lie over the rect of drawbridge `b`? (A span with a wagon on it stays down.) */
  overSpan(b) {
    const R = b.rect, rc = Math.cos(R.rot ?? 0), rs = Math.sin(R.rot ?? 0), h = this.heading ?? 0, c = Math.cos(h), s = Math.sin(h);
    const L = this.size[0] / 2, W = this.size[1] / 2;
    for (const [u, v] of [[0, 0], [L, W], [L, -W], [-L, W], [-L, -W]]) {
      const dx = this.x + u * c - v * s - R.x, dz = this.z + u * s + v * c - R.z;
      if (Math.abs(dx * rc + dz * rs) <= R.w / 2 && Math.abs(-dx * rs + dz * rc) <= R.d / 2) return true;
    }
    return false;
  }
  /**
   * Scripted move with nobody pushing (a shunting engine coupling up and pulling out, e06): rolls to `to` at `speed`
   * m/s, with `train` (other pushables) coupled at their present offsets. A span that is up still stops it.
   */
  haul(to, speed, train = []) {
    if (this.destroyed || this.removed) return false;
    this.goal = null; this.pusher = null;
    this._haul = { x: to.x ?? to[0], z: to.z ?? to[1], speed, train: train.filter((p) => p && p !== this && !p.destroyed).map((p) => ({ p, dx: p.x - this.x, dz: p.z - this.z })) };
    for (const t of this._haul.train) { t.p.goal = null; t.p.pusher = null; t.p._hauledBy = this; t.p._navRest(); }
    this._navRest();
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'haul', x: this.x, z: this.z, on: true });
    return true;
  }
  /** Is it being hauled, or hauling? */
  get hauling() { return !!(this._haul || this._hauledBy); }
  _endHaul() {
    const H = this._haul;
    this._haul = null;
    for (const t of H?.train || []) { t.p._hauledBy = null; t.p._navRest(); }
    this._navRest();
    this.world?.events.emit('pushable:hauled', { pushable: this, x: this.x, z: this.z });
  }
  _haulStep(dt) {
    const H = this._haul, dx = H.x - this.x, dz = H.z - this.z, d = Math.hypot(dx, dz);
    if (d <= 0.02) { this._endHaul(); return; }
    const step = Math.min(d, H.speed * dt), h = Math.atan2(dz, dx);
    const nx = this.x + (dx / d) * step, nz = this.z + (dz / d) * step;
    // the leading body of the consist: a span that is up stops it, a man on the rails holds it (it never runs him down)
    for (const q of [this, ...H.train.map((t) => t.p)]) {
      const qx = nx + (q === this ? 0 : q.x - this.x), qz = nz + (q === this ? 0 : q.z - this.z);
      if (q.spanAhead(qx, qz, h)) { this._endHaul(); return; }
      if (q._bodyInWay(qx, qz, q.heading ?? h)) return; // waits for the man to step off the track
    }
    this.x = nx; this.z = nz;
    for (const t of H.train) { t.p.x = this.x + t.dx; t.p.z = this.z + t.dz; }
    if ((this._noiseT -= dt) <= 0) { this._noiseT = 1; this.world?.emitNoise(this.x, this.z, CONFIG.bcd.push.noiseRadius, 'push', this); }
    if (d - step <= 0.02) this._endHaul();
  }
  /** The rail wagon's `drop` point: passed by the centre between `(px, pz)` and where it stands now (the push's heading). */
  _dropPassed(px, pz) {
    const D = this.params.drop;
    if (!D || this.variant !== 'wagon') return false;
    const ax = D.at?.[0] ?? D.x, az = D.at?.[1] ?? D.z, h = this.heading ?? 0, c = Math.cos(h), s = Math.sin(h);
    const before = (px - ax) * c + (pz - az) * s, now = (this.x - ax) * c + (this.z - az) * s;
    return before < 0 && now >= 0 && Math.abs(-(this.x - ax) * s + (this.z - az) * c) <= Math.max(1.5, this.size[1]);
  }
  /** Tip off the end of the rail into the water (e06): gone for good; a heavy splash, not a bang. */
  _drop() {
    const w = this.world, p = this.pusher;
    this.goal = null; this.pusher = null;
    this.dropped = true; this.destroyed = true;
    this._navRest();
    p?.stop?.();
    if (w) {
      w.emitNoise(this.x, this.z, this.params.drop?.noise ?? 20, 'splash', this, 2);
      w.events.emit('pushable:drop', { pushable: this, x: this.x, z: this.z, heading: this.heading ?? 0 });
      w.events.emit('structure:destroyed', { id: this.tag ?? this.id, type: 'pushable', owner: this.owner, cause: 'drop' });
    }
  }
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
    this._navRest();
    this._off = { x: c.x - this.x, z: c.z - this.z };
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'push', x: this.x, z: this.z, on: true });
    return true;
  }
  /**
   * After a load, once every entity is restored (save.js → bcdPostRestore): a haul saved mid-way re-couples its cars,
   * a push saved mid-way takes its man again — the state right after the load is the state that was saved, and a save
   * made straight after a load (still paused) keeps both. `update` calls it too, for a restore without that pass.
   */
  postRestore(w = this.world) {
    if (!w) return;
    if (this._haulLoad) {
      const L = this._haulLoad;
      this._haulLoad = null;
      const train = (L.train || []).map((id) => w.byId(id)).filter(Boolean);
      this._haul = { x: L.x, z: L.z, speed: L.speed, train: train.map((p) => ({ p, dx: p.x - this.x, dz: p.z - this.z })) };
      for (const t of this._haul.train) { t.p._hauledBy = this; t.p._navRest(); }
      this._navRest(); // (moving again: no rest block, as before the save)
    }
    if (this._pusherLoad != null) { this.pusher = w.byId(this._pusherLoad) || null; this._pusherLoad = null; }
  }
  update(dt) {
    super.update?.(dt);
    const w = this.world, g = this.goal;
    if (w && (this._haulLoad || this._pusherLoad != null)) this.postRestore(w);
    if (this._haul && !this.destroyed) { this._haulStep(dt); return; }
    if (this._hauledBy) return; // coupled: the engine moves it
    if (!g && !this.destroyed && (this._navAt?.x !== this.x || this._navAt?.z !== this.z)) this._navRest(); // moved by a load
    if (!g || !w || this.destroyed) return;
    const p = this.pusher;
    if (!p?.alive || p.isMoving || (p.currentAction && p.currentActionId !== 'use')) { this.goal = null; this.pusher = null; this._navRest(); return; } // he let go
    const dx = g.x - this.x, dz = g.z - this.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, this.speed * dt);
    // a man (standing, lying, dead) in its way: the wagon / tank stops against him — it never rolls through a body
    if (d > 1e-6 && this._bodyInWay(this.x + (dx / d) * step, this.z + (dz / d) * step, Math.atan2(dz, dx))) {
      this.goal = null; this.pusher = null; this._navRest();
      w.events.emit('device', { id: this.tag ?? this.id, sfx: 'push', x: this.x, z: this.z, on: false });
      return;
    }
    // a link-span that is up closes the rail: the wagon stops with its nose at the span's edge (e06)
    if (d > 1e-6 && this.rail && this.spanAhead(this.x + (dx / d) * step, this.z + (dz / d) * step, Math.atan2(dz, dx))) {
      this.goal = null; this.pusher = null; this._navRest();
      w.events.emit('device', { id: this.tag ?? this.id, sfx: 'push', x: this.x, z: this.z, on: false });
      w.events.emit('message', { text: 'The span is up.', kind: 'hint', unit: p });
      return;
    }
    const px = this.x, pz = this.z;
    if (d > 1e-6) { this.x += (dx / d) * step; this.z += (dz / d) * step; this.heading = Math.atan2(dz, dx); }
    p.x = this.x + this._off.x; p.z = this.z + this._off.z;
    if ((this._noiseT -= dt) <= 0) { this._noiseT = 1; w.emitNoise(this.x, this.z, CONFIG.bcd.push.noiseRadius, 'push', p); }
    if (this.object3d) this.object3d.position.set(this.x, this.object3d.position.y, this.z);
    if (this._dropPassed(px, pz)) { this._drop(); return; }
    if (d <= 0.05) { this.goal = null; this.pusher = null; this._navRest(); }
  }
  /**
   * Would the box placed at (x, z, h) take any man's body (world/body-clearance.js bodyRectGap: standing disc, lying
   * capsule with a crawler's limbs or a corpse's arms) to within 5 cm of it, or deeper than it is now? The pusher
   * himself never counts.
   */
  _bodyInWay(x, z, h) {
    const w = this.world;
    if (!w?.entitiesInRadius) return false;
    const R = { x, z, h, hl: this.size[0] / 2, hw: this.size[1] / 2 };
    const R0 = { x: this.x, z: this.z, h: this.heading ?? 0, hl: R.hl, hw: R.hw };
    const men = w.entitiesInRadius(x, z, Math.hypot(R.hl, R.hw) + bodyReach('dead') + 0.05, (u) => (u.kind === 'commando' || u.kind === 'enemy')
      && u !== this.pusher && !u.removed && !u.vehicle && u.state !== 'inVehicle' && u.state !== 'carried' && u.state !== 'hidden'
      && !((u.y || 0) > 1.5) && u.stance !== 'swim' && u.stance !== 'dive');
    for (const u of men) {
      const st = unitStance(u), g = bodyRectGap(u.x, u.z, u.heading, st, R);
      if (g < 0.05 && g < bodyRectGap(u.x, u.z, u.heading, st, R0) - 1e-3) return true;
    }
    return false;
  }
  stampOccluder(grid) {
    if (!this.destroyed && !this.removed) grid.stampDynamic(this.x, this.z, this.size[0], this.size[1], this.heading);
  }
  takeDamage(amount, source, cause) {
    if (this.destroyed) return;
    const bullet = ['pistol', 'rifle', 'sniper', 'sniperRifle', 'smg', 'mg', 'bullet', 'shot', 'luger', 'mp40', 'leeEnfield', 'harpoon'].includes(cause);
    if (this.variant !== 'tank') {
      // `bombable` (a shunting engine): a charge or a grenade wrecks it where it stands; bullets do not
      if (!this.params.bombable || bullet) return;
      this.destroyed = true;
      if (this._haul) this._endHaul();
      this._navRest();
      this.world?.events.emit('structure:destroyed', { id: this.tag ?? this.id, type: 'pushable', owner: this.owner, cause: cause ?? 'explosion' });
      return;
    }
    if (bullet && ++this.bulletHits < 3) return;
    this.destroyed = true;
    this._navRest();
    if (this.object3d) this.object3d.visible = false;
    this.world?.events.emit('structure:destroyed', { id: this.tag ?? this.id, type: 'pushable', owner: this.owner });
    explode(this.world, this.x, this.z, 'fuelTank', source, { exclude: this });
  }
  serialize() {
    const H = this._haul;
    // (a push in progress: its goal, the man pushing and where he stands on the body — a load resumes the push)
    // (links a load has not made yet — `postRestore` — are saved as they were loaded)
    return { ...super.serialize(), goal: this.goal, bulletHits: this.bulletHits, dropped: this.dropped,
      pusher: this.goal ? (this.pusher?.id ?? this._pusherLoad ?? null) : null, off: this.goal && this._off ? { ...this._off } : null,
      haul: H ? { x: H.x, z: H.z, speed: H.speed, train: H.train.map((t) => t.p.id) } : (this._haulLoad ? { ...this._haulLoad } : null) };
  }
  /**
   * The destroyed state a load restores (Interactable.deserialize): the look the live run left. A wagon that went off
   * the end of the rail (`dropped`, e06) lies at the bottom of the harbour: its body is hidden — live, the mission's art
   * tipped it off the span and sank it (art/e06-dressing.js wagonDrop) — and nothing of it stands or burns where it went
   * over (verifier r2: a load drew the sealed wagon back, charred, on the end of the lowered span).
   */
  _applyDestroyedState() {
    if (!this.dropped) { super._applyDestroyedState(); return; }
    this.destroyed = true;
    if (this.object3d) this.object3d.visible = false;
  }
  deserialize(d) {
    this.dropped = !!d.dropped; // (before the base restores `destroyed`: `_applyDestroyedState` reads it)
    super.deserialize?.(d);
    this.bulletHits = d.bulletHits ?? 0;
    this._haul = null;
    this._hauledBy = null; // (a car coupled in the run being left: its engine's saved haul couples it again, or not)
    this._haulLoad = d.haul ?? null; // re-coupled once every car is restored (`postRestore`)
    // a push saved mid-way: its goal and offset now, the pusher once every entity is back (`postRestore`: he may be
    // restored after this)
    this.goal = d.goal && d.pusher != null ? { x: d.goal.x, z: d.goal.z } : null;
    this._off = d.off ? { x: d.off.x, z: d.off.z } : (this.goal ? { x: 0, z: 0 } : this._off);
    this.pusher = null;
    this._pusherLoad = this.goal ? d.pusher : null;
    this._navRest();
  }
}

/** What perception reads for a man riding an enclosed cage (`insideStructure` with no owner: nobody sees him). */
const IN_CAGE = Object.freeze({ owner: 0, cage: true });

export class Lift extends Interactable {
  constructor(o) {
    super({ ...o, interactKind: 'lift', label: o.label ?? 'Lift' });
    const P = (p, y) => ({ x: p.x ?? p[0], z: p.z ?? p[1], y: y ?? p.y ?? p[2] ?? null });
    this.stops = [P(o.a ?? [o.x, o.z], o.aY), P(o.b, o.bY)];
    this.at = o.at ?? 0; // index of the stop the cage is at
    this.ride = null;
    // `winchOnly`: the cage moves only when its winch (or a bridge switch) sends it: `use` at a stop is refused with
    // `winchMsg` (an incline's skip, worked from the winding house). `enclosed`: a high-sided cage (a spoil skip) — its
    // riders crouch below the sides, nobody sees them while it travels, and it carries them along the line a → b (the
    // cage and the men in it are drawn on the way, not teleported at the end). `travel` s per trip, `creak` m of noise,
    // `capacity` men, `boardR` m round a stop that counts as aboard. `locked`: a reason the winch refuses (scripts).
    this.winchOnly = !!o.winchOnly;
    this.enclosed = !!o.enclosed;
    this.travel = o.travel ?? null;
    this.creak = o.creak ?? 8;
    this.capacity = o.capacity ?? null;
    this.boardR = o.boardR ?? 1.5;
    this.locked = null;
  }
  onAdded(world) {
    super.onAdded?.(world);
    // a stop with no authored height stands on the ground there (riders arrive on the cliff top, the gallery floor)
    const g = world?.grid;
    for (const s of this.stops) if (s.y == null) s.y = g?.surfaceY ? g.surfaceY(s.x, s.z) : g?.elevAt ? g.elevAt(s.x, s.z) : 0;
    this._placeCage(this.at, 0);
  }
  canUse(c) {
    if (!this.world?.rules?.lifts) return "Can't use that.";
    if (this.winchOnly) return this.params.winchMsg ?? 'It is worked from the winch.';
    return this.ride ? 'The lift is moving.' : true;
  }
  /** Seconds per trip (`travel`, else CONFIG.bcd.lift.travel). */
  get tripTime() { return this.travel ?? CONFIG.bcd.lift.travel; }
  /** Call the cage to the user's stop, or ride it (everyone within `boardR` of the stop, up to the capacity). */
  interact(c) {
    if (this.ride || this.winchOnly) return false; // (a puppet's order reaches here without canUse)
    const near = (s) => Math.hypot(c.x - s.x, c.z - s.z);
    const from = near(this.stops[0]) <= near(this.stops[1]) ? 0 : 1;
    return this._start(from, this.at === from ? this.tripTime : this.tripTime * 2);
  }
  /** Worked from a winch / switch away from the stops: the cage goes from where it is to the other stop with whoever stands in it. */
  send() {
    if (this.ride || !this.world?.rules?.lifts || this.locked) return false;
    return this._start(this.at, this.tripTime);
  }
  /** Who stands at stop `i` to ride: commandos and puppets within `boardR`, up to the capacity. */
  ridersAt(i) {
    const w = this.world, s = this.stops[i];
    return [...w.commandos, ...w.enemies.filter((e) => e.puppetOf)]
      .filter((u) => u.alive && u.state !== 'inVehicle' && u.state !== 'jailed' && !u.scripted && Math.hypot(u.x - s.x, u.z - s.z) <= this.boardR)
      .slice(0, this.capacity ?? CONFIG.bcd.lift.capacity);
  }
  _start(from, t) {
    const w = this.world;
    const riders = this.ridersAt(from);
    // an enclosed cage called from the far stop runs there empty first (nobody rides that leg); the men waiting there
    // board it when it comes. An open lift keeps its rule: the riders reach the other stop after both legs' time.
    if (this.enclosed && this.at !== from) this.ride = { t: this.tripTime, T: this.tripTime, riders: [], to: from, from: this.at, call: riders };
    else this.ride = { t, T: t, riders, to: 1 - from, from, call: null };
    for (const u of this.ride.riders) u.stop?.();
    w.emitNoise(this.x, this.z, this.creak, 'push', this); // creak: level 1
    w.events.emit('device', { id: this.tag ?? this.id, sfx: 'lift', x: this.x, z: this.z, on: true });
    return true;
  }
  /** Where the cage is `f` (0…1) of the way from stop `from` to the other one. */
  cageAt(from, f) {
    const a = this.stops[from], b = this.stops[1 - from];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + (b.y - a.y) * f };
  }
  /** The cage's model at stop `from` + fraction `f` of the trip (enclosed cages travel; an open lift's cage stays put). */
  _placeCage(from, f) {
    const o = this.object3d;
    if (!o || !this.enclosed) return;
    const p = this.cageAt(from, f), a = this.stops[0], b = this.stops[1];
    o.position.set(p.x, p.y, p.z);
    const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    o.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), Math.atan2(b.y - a.y, run), 'YZX'); // along the line, pitched to its slope
  }
  /**
   * An enclosed cage at rest (a spoil skip at its stop): men lying in it (prone, within `boardR` of the stop, at its
   * height) are below its sides — nobody sees them; a man who stands up or climbs out is seen again.
   */
  _shelter() {
    const w = this.world;
    if (!w?.rules?.lifts) return;
    const s = this.stops[this.at];
    for (const u of w.commandos) {
      const low = u.stance === 'crawl' || u.stance === 'crouch' || !!u.isLow;
      const inSkip = u.alive && low && u.state !== 'inVehicle' && Math.hypot(u.x - s.x, u.z - s.z) <= this.boardR && Math.abs((u.y || 0) - s.y) < 1.5;
      if (inSkip && !u.insideStructure) u.insideStructure = IN_CAGE;
      else if (!inSkip && u.insideStructure === IN_CAGE && !u.scripted?.cage) u.insideStructure = null;
    }
  }
  /** Riders of an enclosed cage: carried along with it, below its sides (nobody sees them), until it stops. */
  _carry(r, f) {
    const p = this.cageAt(r.from, f);
    r.riders.forEach((u, k) => {
      if (!u.alive) { if (u.scripted?.cage) u.scripted = null; if (u.insideStructure === IN_CAGE) u.insideStructure = null; return; }
      u.scripted = { moving: false, cage: true };
      u.insideStructure = IN_CAGE;
      u.x = p.x + ((k % 2) - 0.5) * 0.6; u.z = p.z + (Math.floor(k / 2) - 0.5) * 0.6; u.y = p.y;
    });
  }
  update(dt) {
    super.update?.(dt);
    if (this._rideLoad) { // a ride saved mid-way: its riders are restored by now
      const d = this._rideLoad;
      this._rideLoad = null;
      const ids = (l) => (l || []).map((id) => this.world?.byId(id)).filter(Boolean);
      this.ride = { t: d.t, T: d.T ?? d.t, to: d.to, from: d.from ?? 1 - d.to, riders: ids(d.riders), call: d.call ? ids(d.call) : null };
    }
    const r = this.ride;
    if (!r) { if (this.enclosed) this._shelter(); return; }
    r.t -= dt;
    if (this.enclosed && r.t > 0) {
      const f = Math.max(0, Math.min(1, 1 - r.t / (r.T || 1)));
      this._placeCage(r.from, f);
      this._carry(r, f);
      return;
    }
    if (r.t > 0) return;
    const s = this.stops[r.to];
    r.riders.forEach((u, k) => {
      if (u.scripted?.cage) u.scripted = null;
      if (u.insideStructure === IN_CAGE) u.insideStructure = null;
      if (u.alive) { u.x = s.x + (k % 2) * 0.6; u.z = s.z + Math.floor(k / 2) * 0.6; u.y = s.y; u.stop?.(); }
    });
    this.at = r.to;
    this.ride = null;
    this._placeCage(this.at, 0);
    this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'lift', x: s.x, z: s.z, on: false });
    this.world?.events.emit('lift:arrived', { lift: this, at: this.at, riders: r.riders });
    // called to a far stop: the cage has come; the men waiting there now ride it back (an enclosed cage's call)
    if (r.call?.length && this.enclosed) this._start(this.at, this.tripTime);
  }
  serialize() {
    const r = this.ride;
    return { ...super.serialize(), at: this.at, locked: this.locked,
      ride: r ? { t: r.t, T: r.T, to: r.to, from: r.from, riders: r.riders.map((u) => u.id), call: r.call ? r.call.map((u) => u.id) : null } : null };
  }
  deserialize(d) {
    super.deserialize(d);
    this.at = d.at ?? this.at;
    this.locked = d.locked ?? null;
    this.ride = null;
    this._rideLoad = d.ride ?? null;
    this._placeCage(this.at, 0);
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
  onAdded(world) {
    super.onAdded?.(world);
    (world.surfaces ||= []).push(this); // walkers' feet on its boards (world.groundY, map-builder)
    (world._drawbridges ||= []).push(this); // patrols wait at a raised span (ai/bcd-brain bridgeCheck)
    this._apply();
  }
  /** Walking height on the lowered span (its boards' top), null off it or while raised. */
  heightAt(x, z) {
    if (this.raised || this.removed) return null;
    const R = this.rect, c = Math.cos(R.rot ?? 0), s = Math.sin(R.rot ?? 0), dx = x - R.x, dz = z - R.z;
    return Math.abs(dx * c + dz * s) <= R.w / 2 && Math.abs(-dx * s + dz * c) <= R.d / 2 ? DRAWBRIDGE_TOP : null;
  }
  _apply() {
    const g = this.world?.grid, R = this.rect;
    if (!g) return;
    g.fillOrientedRect(R.x, R.z, R.w, R.d, R.rot ?? 0, 'bridge', this.raised ? 0 : 1);
    // lowered, the span closes the channel to boats; raised, it opens (grid.boatBlock: read by Vehicle.passableAt for
    // boats, created by the first drawbridge, never in a BEL world)
    const bb = g.boatBlock || (g.boatBlock = new Uint8Array(g.cols * g.rows));
    for (const k of g.rectCells(R.x, R.z, R.w, R.d, R.rot ?? 0)) bb[k] = this.raised ? 0 : 1;
    // lowered: swimmers keep off its sides (a 0.35 m band of water cells along the span; placement rule e)
    if (g.navStamp) {
      const band = [];
      if (!this.raised) {
        const inner = new Set(g.rectCells(R.x, R.z, R.w, R.d, R.rot ?? 0));
        for (const k of g.rectCells(R.x, R.z, R.w - 1, R.d + 0.7, R.rot ?? 0)) if (!inner.has(k) && !g.bridge[k] && (g.terrain[k] === T.WATER || g.terrain[k] === T.SHALLOW)) band.push(k);
      }
      g.navStamp(`span:${this.id}`, band);
    }
    g.version++;
    if (this.object3d) this.object3d.rotation.z = this.raised ? Math.PI / 2.4 : 0;
  }
  /** Start raising / lowering (5 s; the deck stops carrying walkers as soon as it starts rising). */
  toggle() {
    if (this.moving > 0) return false;
    // a wagon standing on the lowered span holds it down (a link-span is never lifted under a load, e06)
    if (!this.raised && (this.world?.interactables || []).some((p) => p instanceof Pushable && !p.destroyed && !p.removed && p.overSpan(this))) return false;
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
    if (!this.raised) this.downAt = this.world?.time ?? 0; // (a keeper's timer reads how long it has been down: e06)
    this._apply();
  }
  /** Fully down (a walkable deck, the channel closed to boats)? */
  get down() { return !this.raised && !(this.moving > 0); }
  serialize() { return { ...super.serialize(), raised: this.raised, moving: this.moving, target: this._target ?? null, downAt: this.downAt ?? null }; }
  deserialize(d) {
    super.deserialize(d);
    this.raised = !!d.raised;
    this.moving = d.moving ?? 0;
    this._target = d.target ?? this._target;
    this.downAt = d.downAt ?? null;
    this._apply();
  }
}

/**
 * A machine worked with `use` (by a commando, or by a puppet: bcd-puppet DEVICES): its `targets` drawbridges are raised /
 * lowered, its target lifts sent to their other stop. Kinds `drawbridgeSwitch` ("Bridge switch") and `winch` ("Winch").
 */
export class DrawbridgeSwitch extends Interactable {
  constructor(o) {
    const winch = (o.interactKind || o.kind) === 'winch';
    super({ ...o, interactKind: winch ? 'winch' : 'drawbridgeSwitch', label: o.label ?? (winch ? 'Winch' : 'Bridge switch') });
  }
  onAdded(world) { super.onAdded?.(world); stampSolid(this, 0.4, 0.3); } // the post is solid (placement rule e)
  approachFrom(u) { return edgeApproach(this, u, 0.4, 0.3); }
  canUse() {
    const R = this.world?.rules;
    if (!(this.interactKind === 'winch' ? R?.lifts : R?.drawbridges)) return "Can't use that.";
    // a lift a script has stopped (Lift.locked: the winchman stopped the incline) refuses with its reason
    const stopped = this.interactKind === 'winch' && (this.world?.interactables || []).find((it) => it instanceof Lift && it.locked && this.targets.includes(it.tag ?? it.id));
    return stopped ? stopped.locked : true;
  }
  interact() {
    let ok = false;
    for (const it of this.world?.interactables || []) {
      if (!this.targets.includes(it.tag ?? it.id)) continue;
      if (it instanceof Drawbridge) ok = it.toggle() || ok;
      else if (it instanceof Lift) ok = it.send() || ok;
    }
    if (ok) this.world?.events.emit('device', { id: this.tag ?? this.id, sfx: 'switch_throw', x: this.x, z: this.z, on: true });
    return ok;
  }
}

export class Knapsack extends Interactable {
  constructor(o) { super({ ...o, interactKind: 'knapsack', label: 'Knapsack' }); this.ownerRole = o.ownerRole ?? 'greenberet'; }
  /** The pack on the ground is walked round, not through (placement rule e), and reached from its edge. */
  onAdded(world) { super.onAdded?.(world); stampSolid(this, 0.5, 0.35); }
  approachFrom(u) { return edgeApproach(this, u, 0.5, 0.35, this.heading ?? 0); }
  canUse(c) {
    if (this.removed || this.count <= 0) return 'Empty.';
    return c?.role === this.ownerRole ? true : 'Not my kit.';
  }
  interact(c) {
    const kit = { ...(FIXED_KIT[c.role] || {}), ...(BCD_KIT[c.role] || {}), ...(this.params.contents || {}) };
    for (const [id, n] of Object.entries(kit)) if (!c.has(id)) Interactable.give(c, id, n);
    this.count = 0;
    stampSolid(this, 0.5, 0.35, true);
    this.world?.removeLater?.(this);
    return true;
  }
}

const DRAWBRIDGE_TOP = 0.03; // the span's boards (MESH.drawbridge: 0.3 m thick from -0.27)

/** Moored contact mine: painted steel sphere with its Hertz horns and lifting eye. */
function seaMineMesh(s) {
  const paint = paintedMaterial('steel', 0x2a2a26), m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), paint);
  m.position.set(s.x, 0.2, s.z);
  for (const [a, b] of [[0, 0], [0, 1.2], [2.1, 1.2], [4.2, 1.2], [1.05, 0.55], [3.15, 0.55], [5.25, 0.55]]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 8), dressingMaterial('castIron'));
    const dir = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a));
    h.position.copy(dir).multiplyScalar(0.53); h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); m.add(h);
  }
  m.castShadow = true;
  return m;
}
/** Pushable rail wagon (planked goods wagon) or tank wagon (olive steel), wheels and buffers on the inner box. */
function pushableMesh(s) {
  const tank = s.variant === 'tank', [w, h, d] = tank ? [3, 1.8, 1.6] : [5, 2.2, 2.4];
  const g = faceHeading(box(w, h, d, tank ? paintedMaterial('steel', 0x4a5236) : paintedMaterial('weatherboard', 0x6a4a34), s.x, s.z));
  const inner = g.userData.inner, iron = dressingMaterial('castIron');
  for (const sx of [-0.3, 0.3]) for (const sz of [-1, 1]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 14), iron); wh.rotation.x = Math.PI / 2;
    wh.position.set(sx * w, 0.4 - h / 2, sz * (d / 2 + 0.06)); inner.add(wh);
  }
  for (const sx of [-1, 1]) for (const sz of [-0.3, 0.3]) {
    const bf = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 10), iron); bf.rotation.z = Math.PI / 2;
    bf.position.set(sx * (w / 2 + 0.15), 0.9 - h / 2, sz * d); inner.add(bf);
  }
  return g;
}

/** A part: geometry `geo` in material `mat` at (x, y, z) in `g` (rotations optional). */
function part(g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
/**
 * Side-tipping colliery spoil wagon (`variant: 'spoil'`, 4 × 2.2 m by default; the e04 tub tramway): a riveted V
 * hopper on its trunnions over a short underframe, four spoked wheels, dumb buffers, a heaped load of wet shale.
 * Authored along +x (faceHeading turns it onto the push heading).
 */
let _spoilLoad = null;
/** Wet shale for the spoil wagons' loads (vertex colours; one material for all of them). */
function spoilLoadMaterial() {
  return (_spoilLoad ??= new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0, name: 'bcd:spoil-load' }));
}
function spoilWagonMesh(s) {
  const [L, W] = s.size || [4, 2.2], g = new THREE.Group(), inner = new THREE.Group();
  g.add(inner); g.userData.inner = inner; g.position.set(s.x, 0, s.z);
  const steel = paintedMaterial('steel', 0x4b4038), iron = dressingMaterial('castIron'), load = paintedMaterial('tarPaper', 0x1d1b1a);
  part(inner, boxUV(new THREE.BoxGeometry(L * 0.86, 0.22, W * 0.55).toNonIndexed(), 1), iron, 0, 0.62, 0); // underframe
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { // wheels on the narrow-gauge axles
    part(inner, new THREE.CylinderGeometry(0.31, 0.31, 0.09, 14), iron, sx * L * 0.27, 0.31, sz * W * 0.3, Math.PI / 2);
    part(inner, new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8), iron, sx * L * 0.27, 0.31, sz * W * 0.34, Math.PI / 2);
  }
  for (const sx of [-1, 1]) {
    part(inner, boxUV(new THREE.BoxGeometry(0.16, 0.22, W * 0.62).toNonIndexed(), 1), iron, sx * L * 0.45, 0.62, 0); // headstocks
    part(inner, new THREE.CylinderGeometry(0.1, 0.12, 0.22, 10), iron, sx * (L * 0.45 + 0.17), 0.66, 0, 0, 0, Math.PI / 2); // dumb buffer
    part(inner, boxUV(new THREE.BoxGeometry(0.12, 0.5, 0.18).toNonIndexed(), 1), iron, sx * L * 0.36, 0.95, 0); // trunnion post
  }
  // the V hopper: two sloped side plates and two end plates
  const hw = W * 0.46, hb = W * 0.12, y0 = 0.8, y1 = 2.0, slope = Math.atan2(hw - hb, y1 - y0), side = Math.hypot(hw - hb, y1 - y0);
  for (const sz of [-1, 1]) part(inner, boxUV(new THREE.BoxGeometry(L * 0.8, side, 0.06).toNonIndexed(), 1), steel, 0, (y0 + y1) / 2, sz * (hw + hb) / 2, sz * slope);
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape([new THREE.Vector2(-hb, y0), new THREE.Vector2(hb, y0), new THREE.Vector2(hw, y1), new THREE.Vector2(-hw, y1)]);
    const end = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
    part(inner, boxUV(end.toNonIndexed(), 1), steel, sx * L * 0.4 - 0.03, 0, 0, 0, Math.PI / 2);
  }
  for (const sz of [-1, 1]) part(inner, boxUV(new THREE.BoxGeometry(L * 0.82, 0.07, 0.07).toNonIndexed(), 1), iron, 0, y1, sz * hw); // top rails
  // the load: wet shale heaped above the rim in a slumped, lumpy ridge (a heightfield over the hopper's mouth), loose
  // fragments lying on it; near-black with a few rusty and grey pieces (vertex colours)
  const nu = 16, nv = 8, lx = L * 0.78, lz = hw * 1.9, lp = [], lc = [], li = [];
  const surf = (u, v) => {
    const ridge = Math.max(0, (1 - Math.pow(Math.abs(v) * 2, 1.5)) * (1 - Math.pow(Math.abs(u) * 2, 3)));
    const n = Math.sin(u * 23.1 + v * 7.7) * Math.cos(v * 19.3 - u * 5.1) * 0.5 + Math.sin(u * 51 + v * 37) * 0.25;
    return { y: y1 - 0.08 + ridge * (0.4 + 0.12 * n) + 0.04 * n * Math.min(1, ridge * 4), n };
  };
  for (let j2 = 0; j2 <= nv; j2++) for (let i2 = 0; i2 <= nu; i2++) {
    const u = i2 / nu - 0.5, v = j2 / nv - 0.5, { y, n } = surf(u, v), c = 0.08 + 0.035 * n;
    lp.push(u * lx, y, v * lz); lc.push(c, c * 0.96, c * 0.92);
  }
  for (let j2 = 0; j2 < nv; j2++) for (let i2 = 0; i2 < nu; i2++) { const a = j2 * (nu + 1) + i2, b = a + 1, c = a + nu + 1, d = c + 1; li.push(a, c, b, b, c, d); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
  lg.setIndex(li); lg.computeVertexNormals();
  const shale = spoilLoadMaterial();
  part(inner, lg, shale, 0, 0, 0);
  for (let k = 0; k < 14; k++) {
    const r1 = Math.sin(k * 12.9898) * 43758.5453, r2 = Math.sin(k * 78.233) * 12345.678, fu = r1 - Math.floor(r1), fv = r2 - Math.floor(r2);
    const u = (fu - 0.5) * 0.8, v = (fv - 0.5) * 0.7, sc = 0.07 + 0.09 * ((k * 7) % 5) / 4, fr = new THREE.IcosahedronGeometry(sc, 0);
    const tone = k % 7 === 3 ? [0.28, 0.15, 0.1] : k % 5 === 1 ? [0.2, 0.2, 0.19] : [0.09, 0.087, 0.084];
    fr.setAttribute('color', new THREE.Float32BufferAttribute(new Array(fr.attributes.position.count).fill(tone).flat(), 3));
    const piece = part(inner, fr, shale, u * lx, surf(u, v).y + sc * 0.3, v * lz, k, k * 2.1, k * 0.7);
    piece.scale.set(1.3, 0.55, 1);
  }
  return faceHeading(g);
}
/**
 * The skip of an enclosed lift (`enclosed: true`; e04's incline): a high-sided steel spoil skip on a wheeled
 * carriage, authored along +x (Lift._placeCage turns it along the line a → b and pitches it to the incline), its
 * floor at the stop's height. Riders crouch inside; its 1.2 m sides hide them.
 */
function skipMesh(s) {
  const g = new THREE.Group();
  const steel = paintedMaterial('steel', 0x3f3a35), iron = dressingMaterial('castIron');
  part(g, boxUV(new THREE.BoxGeometry(2.9, 0.2, 1.8).toNonIndexed(), 1), iron, 0, 0.25, 0); // carriage
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, new THREE.CylinderGeometry(0.26, 0.26, 0.1, 12), iron, sx * 1.05, 0.26, sz * 0.82, Math.PI / 2);
  part(g, boxUV(new THREE.BoxGeometry(2.7, 0.08, 1.7).toNonIndexed(), 1), steel, 0, 0.4, 0); // floor
  for (const sz of [-1, 1]) part(g, boxUV(new THREE.BoxGeometry(2.7, 1.2, 0.07).toNonIndexed(), 1), steel, 0, 1.0, sz * 0.82); // sides
  for (const sx of [-1, 1]) part(g, boxUV(new THREE.BoxGeometry(0.07, 1.2, 1.7).toNonIndexed(), 1), steel, sx * 1.33, 1.0, 0); // ends
  for (const sz of [-1, 1]) part(g, boxUV(new THREE.BoxGeometry(2.8, 0.08, 0.1).toNonIndexed(), 1), iron, 0, 1.62, sz * 0.84); // top rails
  part(g, new THREE.TorusGeometry(0.22, 0.04, 6, 12), iron, 1.5, 0.5, 0, 0, Math.PI / 2); // the rope shackle
  g.position.set(s.x, 0, s.z);
  return g;
}

const MESH = {
  seaMine: seaMineMesh,
  pushable: (s) => (s.variant === 'spoil' ? spoilWagonMesh(s) : pushableMesh(s)),
  lift: (s) => (s.enclosed ? skipMesh(s) : cage(s.x, s.z)),
  // the span matches its nav rect (w along `rot`, d across): the deck lies across the water, not along it, its
  // boards flush with the banks (walkers' feet stay on top)
  drawbridge: (s) => { const m = box((s.rect?.w ?? 3), 0.3, (s.rect?.d ?? 8), dressingMaterial('planks'), s.rect?.x ?? s.x, s.rect?.z ?? s.z, -0.27); m.rotation.y = -(s.rect?.rot ?? 0); return m; },
  drawbridgeSwitch: (s) => box(0.4, 0.9, 0.3, paintedMaterial('steel', 0x8a7a30), s.x, s.z),
  winch: (s) => box(0.4, 0.9, 0.3, paintedMaterial('steel', 0x5a5f52), s.x, s.z),
  knapsack: (s) => box(0.5, 0.35, 0.35, paintedMaterial('canvas', 0x4f5a34), s.x, s.z),
};
const CLASS = { seaMine: SeaMine, pushable: Pushable, lift: Lift, drawbridge: Drawbridge, drawbridgeSwitch: DrawbridgeSwitch, winch: DrawbridgeSwitch, knapsack: Knapsack };

for (const [kind, C] of Object.entries(CLASS)) {
  INTERACTABLE_KINDS[kind] = (spec, opts = {}) => new C({ ...spec, object3d: opts.meshes === false ? null : MESH[kind]?.(spec) ?? null });
}
/** Commando roles that may carry papers away (guests carry nothing: bcd-plan §1.8). */
const PAPER_ROLES = new Set(['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy']);
/**
 * Mission papers (`kind: 'documents'`: a bearing archive, a key-table binder): taken with the hand (H) by any commando,
 * they are an objective's item, not kit — no knapsack slot. `inside: '<structure id>'` puts them in a building with a
 * walk-in (abilities/bunker-entry.js `entry`: he walks in, takes them, walks out). Taking them emits
 * 'documents:taken' {item, by}; a script may also hand them to an enemy (`takeBy(enemy)`: the papers leave with him) and
 * put them down again (`dropAt(x, z)`). The commando who has them carries `documents: [id]`.
 */
export class Documents extends Interactable {
  constructor(o) {
    super({ ...o, interactKind: 'documents', label: o.label ?? 'Documents' });
    this.takenBy = null;
  }
  onAdded(world) { super.onAdded?.(world); if (this.params.inside == null) stampSolid(this, 0.6, 0.45); }
  approachFrom(u) { return this.params.inside != null ? { x: this.x, z: this.z } : edgeApproach(this, u, 0.6, 0.45); }
  canUse(c) {
    if (this.takenBy || this.removed) return 'Nothing there.';
    return PAPER_ROLES.has(c?.role) ? true : "Can't take that.";
  }
  interact(c) {
    if (this.takenBy || !c) return false;
    this.takenBy = c.id;
    c.documents = [...(c.documents || []), this.tag ?? this.id];
    this._gone();
    const w = this.world;
    w?.events.emit('documents:taken', { item: this, by: c });
    w?.events.emit('message', { text: `${c.nickname || 'Commando'} has the ${String(this.label || 'documents').toLowerCase()}.`, kind: 'objective', unit: c });
    return true;
  }
  /** An enemy takes the papers (a script: the station chief carrying the archive away). */
  takeBy(e) {
    if (this.takenBy || !e) return false;
    this.takenBy = e.id;
    this._gone();
    this.world?.events.emit('documents:taken', { item: this, by: e });
    return true;
  }
  /** Put the papers down again at (x, z) (their carrier fell): back on the ground, to be taken. */
  dropAt(x, z) {
    this.takenBy = null;
    this.x = x; this.z = z;
    this.params = { ...this.params, inside: null };
    this.alive = true; this.removed = false;
    if (this.object3d) { this.object3d.visible = true; this.object3d.position.set(x, 0, z); }
    stampSolid(this, 0.6, 0.45);
  }
  _gone() {
    if (this.object3d) this.object3d.visible = false;
    stampSolid(this, 0.6, 0.45, true);
  }
  serialize() { return { ...super.serialize(), takenBy: this.takenBy, x: this.x, z: this.z }; }
  deserialize(d) {
    super.deserialize(d);
    this.takenBy = d.takenBy ?? null;
    if (this.takenBy) this._gone();
  }
}
/** A box file of bearing sheets on a ledger: a small, readable prop (unseen inside a building). */
function documentsMesh(s) {
  const g = new THREE.Group();
  const board = paintedMaterial('weatherboard', 0x6b5236), paper = paintedMaterial('canvas', 0xd8d2bf), cloth = paintedMaterial('canvas', 0x37442e);
  part(g, boxUV(new THREE.BoxGeometry(0.6, 0.06, 0.45).toNonIndexed(), 1), board, 0, 0.03, 0);
  part(g, boxUV(new THREE.BoxGeometry(0.42, 0.08, 0.3).toNonIndexed(), 1), cloth, -0.05, 0.1, 0);
  part(g, boxUV(new THREE.BoxGeometry(0.34, 0.05, 0.26).toNonIndexed(), 1), paper, 0.1, 0.17, 0.02, 0, 0.35, 0);
  g.position.set(s.x, 0, s.z);
  return g;
}
INTERACTABLE_KINDS.documents = (spec, opts = {}) => new Documents({ ...spec, object3d: opts.meshes === false ? null : documentsMesh(spec) });

/** A pen gate: a door whose leaf fills the gap of its fence run (blocked like the fence while shut, clear while open). */
export class PenGate extends Interactable {
  constructor(o) { super({ ...o, interactKind: 'door', label: o.label ?? 'Pen gate' }); }
  onAdded(world) { super.onAdded?.(world); this._leaf(); }
  _leaf() {
    const g = this.world?.grid;
    if (!g) return;
    if (!this._cells) {
      this._cells = g.rectCells(this.x, this.z, this.params.w ?? 3.2, 1.0, this.params.rot ?? 0); // (1 m across: both cells of the fence line)
      this._was = this._cells.map((k) => g.block[k]);
    }
    this._cells.forEach((k, q) => { g.block[k] = this.open ? B.NONE : (this._was[q] || B.FENCE); });
    g.version++;
  }
  setOpen(open, quiet = false) {
    const ok = super.setOpen(open, quiet);
    if (ok) this._leaf();
    return ok;
  }
}
INTERACTABLE_KINDS.penGate = (spec, opts = {}) => {
  // the leaf lies along its fence line (`rot`, set by world/placement.js from the nearest run when not authored)
  const leaf = opts.meshes === false ? null : box(3, 1.6, 0.2, dressingMaterial('planks'), spec.x, spec.z);
  if (leaf) leaf.rotation.y = -(spec.rot ?? 0);
  return new PenGate({ ...spec, object3d: leaf });
};
for (const k of ['pushable', 'lift', 'drawbridgeSwitch', 'winch', 'knapsack']) BCD_ACTIVATABLE.add(k); // the BEL set stays untouched
