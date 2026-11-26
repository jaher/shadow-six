/**
 * BCD scripted errands (LIGHTS OUT missions, docs/expansion/MECHANICS.md): data-driven set-pieces for the expansion's
 * "quiet or lose" rules and the camp's alarm reactions. Each is a SetPiece (saved with the game, ticked at 20 Hz by
 * the director); they run under any ruleset, but only BCD missions place them. Registered on import.
 *
 *  bcd_errand {actor, item, itemId?, fetch?:[[x,z]…], to:[x,z], carry?:[[x,z]…], wait: s | {easy, hard}, events:[…],
 *              fail, objective?}
 *    "On alarm, he takes it away": when one of `events` fires and the pickup `item` still lies where the mission put
 *    it, `actor` runs to it (`fetch`, the last point beside the item), takes it, runs on (`carry`) to `to`, stands
 *    there `wait` s and the mission fails with `fail`. Nothing happens if he is down (dead, knocked out, cuffed, on
 *    strings, carried) when it fires; if he goes down carrying it, it drops at his feet; once a commando holds it (or
 *    `objective` is done) the errand is over. (e03: the chief drops the key-table binder down the camp well.)
 *  bcd_kennel {dogs:[ids], handler, gate:[x,z], events:[…], delay?: s | {easy, hard}, hunt?:[[x,z]…]}
 *    Dogs kept in a kennel (spawn `caged: true`: they only bark) until an alarm: `delay` s after one of `events`, the
 *    handler (alive and on his feet) walks to the kennel gate and opens it; the dogs run to where the alarm came from
 *    and hunt round it (or along `hunt`). With the handler down, the dogs stay kennelled.
 *  bcd_withdraw {units:[[id, [x,z], look°?]…], events:[…]}
 *    On one of `events` the listed men walk to their spots (indoors) and stay there.
 *  bcd_cable_ferry {vehicle, line:[[x,z],[x,z]], speed?}
 *    A boat on a cable (a rope ferry): it only moves along `line`, forward or back, never turning; its operator's
 *    move orders are taken to the nearest point of the line.
 *  bcd_item_objective {item, itemId, objective}
 *    `objective` (type 'script') is done once a commando holds `itemId` and the pickup `item` is gone from the map.
 * @module missions/setpieces-errands
 */

import { SetPiece, registerSetpiece } from './setpiece-base.js';
import { createPickup } from '../entities/interactables.js';
import { CONFIG } from '../config.js';

const xz = (p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z });
const pts = (list) => (list || []).map(xz);
/** A value per difficulty: a number, or {easy, hard} read by the mission's difficulty (default hard). */
export function byDifficulty(v, world, dflt = 0) {
  if (v == null) return dflt;
  if (typeof v === 'number') return v;
  const d = world?.mission?.difficulty === 'easy' ? 'easy' : 'hard';
  return v[d] ?? v.hard ?? dflt;
}
/** A man who cannot act: dead, gone, knocked out, cuffed, on puppet strings, carried. */
export function isDown(e) {
  return !e || !e.alive || e.removed || !!e.ko || !!e.puppetOf || !!e.carriedBy || e.state === 'carried' || !!e.incapacitated;
}
const pickupOf = (w, id) => (w.interactables || []).find((i) => i.interactKind === 'pickup' && (i.tag === id || i.spawn?.id === id) && !i.removed && i.count > 0) || null;
const heldByTeam = (w, itemId) => (w.commandos || []).some((c) => c.alive !== false && !c.removed && (c.inventory?.get?.(itemId) || 0) > 0);

// ------------------------------------------------------------------ bcd_errand

export class Errand extends SetPiece {
  build() { this.phase = 'idle'; this.t = 0; this.carrying = false; this.armed = false; }
  init() {
    const s = this.spec;
    this.events = new Set(s.events || []);
    this.world.listen?.('alarm:zone', (p) => { if (this.phase === 'idle' && this.events.has(p.event)) this.armed = true; });
  }
  _actor() { return this.world.byId?.(this.spec.actor) || null; }
  _done() {
    const w = this.world, s = this.spec;
    const o = s.objective && (w.objectives || []).find((q) => q.id === s.objective);
    return !!(o?.done || (s.itemId && heldByTeam(w, s.itemId) && !pickupOf(w, s.item)));
  }
  _send(route) {
    const e = this._actor();
    if (!e?.brain?.reinforce || !route.length) return;
    e.brain.reinforce(route, []);
  }
  _drop(e) {
    const w = this.world;
    const p = createPickup(this.spec.itemId || 'documents', e.x, e.z, 1);
    p.tag = this.spec.item;
    if (w._spMeshes === false) p.object3d = null;
    w.add(p);
    if (p.object3d && w.scene && !p.object3d.parent) w.scene.add(p.object3d);
    this.carrying = false;
    w.events.emit('bcd:errand', { id: this.tag, kind: 'errand', phase: 'dropped', actor: e, x: e.x, z: e.z });
  }
  tick(dt) {
    const w = this.world, s = this.spec, e = this._actor();
    if (this.phase === 'over' || this.phase === 'failed') return;
    if (this._done()) { if (this.carrying && e) this._drop(e); this.phase = 'over'; return; }
    if (this.phase === 'idle') {
      if (!this.armed) return;
      this.armed = false;
      if (isDown(e) || !pickupOf(w, s.item)) { this.phase = 'over'; return; } // nobody to run it, or already gone
      this.phase = 'fetch';
      this._send(pts(s.fetch?.length ? s.fetch : [xz(pickupOf(w, s.item))]));
      w.events.emit('bcd:errand', { id: this.tag, kind: 'errand', phase: 'start', actor: e, x: e.x, z: e.z });
      return;
    }
    if (isDown(e)) { // he went down on the way: whatever he carries lies at his feet
      if (this.carrying && e?.alive !== undefined) this._drop(e);
      this.phase = 'over';
      return;
    }
    if (this.phase === 'fetch') {
      const it = pickupOf(w, s.item);
      if (!it) { this.phase = 'over'; return; } // a commando got there first
      const end = s.fetch?.length ? xz(s.fetch[s.fetch.length - 1]) : xz(it);
      if (Math.hypot(e.x - end.x, e.z - end.z) > 0.9 && (e.isMoving || e.path)) return;
      if (Math.hypot(e.x - it.x, e.z - it.z) > 2.2) { this._send([{ x: it.x, z: it.z }]); return; }
      it.count = 0; it.alive = false; w.removeLater?.(it); // he takes it
      this.carrying = true;
      this.phase = 'carry';
      this._send(pts([...(s.carry || []), s.to]));
      w.events.emit('bcd:errand', { id: this.tag, kind: 'errand', phase: 'taken', actor: e, x: e.x, z: e.z });
      return;
    }
    if (this.phase === 'carry') {
      const to = xz(s.to);
      if (Math.hypot(e.x - to.x, e.z - to.z) > 1.6) { if (!e.isMoving && !e.path) this._send([to]); return; }
      this.phase = 'wait';
      this.t = byDifficulty(s.wait, w, 8);
      e.stop?.();
      return;
    }
    if (this.phase === 'wait') {
      this.t -= dt;
      if (this.t > 0) return;
      this.carrying = false;
      this.phase = 'failed';
      w.events.emit('bcd:errand', { id: this.tag, kind: 'errand', phase: 'done', actor: e, x: e.x, z: e.z });
      this.director?.fail(s.fail || 'MISSION FAILED');
    }
  }
  save() { return { phase: this.phase, t: this.t, carrying: this.carrying, armed: this.armed }; }
  load(st) {
    this.phase = st.phase ?? 'idle'; this.t = st.t ?? 0; this.carrying = !!st.carrying; this.armed = !!st.armed;
    // (the actor's errand walk is his brain's route: restored with him)
  }
}
registerSetpiece('bcd_errand', Errand);

// ------------------------------------------------------------------ bcd_kennel

export class Kennel extends SetPiece {
  build() { this.phase = 'kennelled'; this.t = 0; this.at = null; }
  init() {
    const s = this.spec;
    this.events = new Set(s.events || []);
    this.world.listen?.('alarm:zone', (p) => {
      if (this.phase !== 'kennelled' || !this.events.has(p.event)) return;
      this.phase = 'pending';
      this.t = byDifficulty(s.delay, this.world, 0);
      this.at = { x: p.x ?? 0, z: p.z ?? 0 };
    });
  }
  _gate() {
    const g = xz(this.spec.gate);
    return (this.world.interactables || []).find((i) => i.interactKind === 'door' && Math.hypot(i.x - g.x, i.z - g.z) < 0.8) || null;
  }
  _dogs() { return (this.spec.dogs || []).map((id) => this.world.byId?.(id)).filter((d) => d && d.alive && !d.removed); }
  release() {
    const w = this.world, gate = this._gate();
    if (gate) { gate.locked = false; gate.setOpen?.(true); }
    const a = this.at || xz(this.spec.gate);
    const hunt = this.spec.hunt?.length ? pts(this.spec.hunt)
      : [[8, 0], [0, 8], [-8, 0], [0, -8]].map(([dx, dz]) => w.grid?.nearestWalkable?.(a.x + dx, a.z + dz, 4) || { x: a.x + dx, z: a.z + dz });
    for (const d of this._dogs()) {
      if (d.spawn) d.spawn = { ...d.spawn, caged: false };
      d.brain?.reinforce?.([a], hunt);
    }
    this.phase = 'released';
    w.events.emit('bcd:errand', { id: this.tag, kind: 'kennel', phase: 'released', x: a.x, z: a.z });
  }
  tick(dt) {
    const s = this.spec, w = this.world;
    if (this.phase === 'kennelled' || this.phase === 'released' || this.phase === 'stay') return;
    const h = w.byId?.(s.handler);
    if (isDown(h)) { this.phase = 'stay'; return; } // no handler, no release
    if (this.phase === 'pending') {
      this.t -= dt;
      if (this.t > 0) return;
      const g = xz(s.gate), side = s.handlerAt ? xz(s.handlerAt) : { x: g.x, z: g.z + 1.4 };
      h.brain?.reinforce?.([side], []);
      this.phase = 'handler';
      return;
    }
    if (this.phase === 'handler') {
      const g = xz(s.gate);
      if (Math.hypot(h.x - g.x, h.z - g.z) > 2.2) { if (!h.isMoving && !h.path) h.brain?.reinforce?.([s.handlerAt ? xz(s.handlerAt) : { x: g.x, z: g.z + 1.4 }], []); return; }
      this.release();
    }
  }
  save() { return { phase: this.phase, t: this.t, at: this.at }; }
  load(st) { this.phase = st.phase ?? 'kennelled'; this.t = st.t ?? 0; this.at = st.at ?? null; }
}
registerSetpiece('bcd_kennel', Kennel);

// ------------------------------------------------------------------ bcd_withdraw

export class Withdraw extends SetPiece {
  build() { this.gone = false; }
  init() {
    const ev = new Set(this.spec.events || []);
    this.world.listen?.('alarm:zone', (p) => { if (!this.gone && ev.has(p.event)) this.withdraw(); });
  }
  withdraw() {
    this.gone = true;
    for (const [id, at, look] of this.spec.units || []) {
      const e = this.world.byId?.(id);
      if (isDown(e) || !e.brain?.reinforce) continue;
      const p = xz(at);
      e.brain.reinforce([p], [{ x: p.x, z: p.z, wait: 1e6, look: look ?? null }]);
    }
    this.world.events.emit('bcd:errand', { id: this.tag, kind: 'withdraw', phase: 'done' });
  }
  save() { return { gone: this.gone }; }
  load(st) { this.gone = !!st.gone; }
}
registerSetpiece('bcd_withdraw', Withdraw);

// ------------------------------------------------------------------ bcd_cable_ferry

/** Nearest point of segment A-B to (x, z), as the fraction along it (0..1). */
export function lineT(A, B, x, z) {
  const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
  return Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2));
}

export class CableFerry extends SetPiece {
  init() {
    const v = this.v = this.world.byId?.(this.spec.vehicle);
    if (!v || v._cableFerry) return;
    v._cableFerry = this;
    const [A, B] = pts(this.spec.line);
    this.A = A; this.B = B;
    const sp = this.spec.speed ?? 1.4;
    v.def = { ...v.def, slow: sp, fast: sp, speed: sp };
    v.maxSpeed = sp;
    this.heading = Math.atan2(B.z - A.z, B.x - A.x); // the punt lies along its cable and never turns
    v.heading = this.heading;
    const at = (t) => ({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t });
    this.snap();
    // the operator's click: the nearest point of the cable; the punt hauled there, bow or stern first
    v.canDriveTo = (x, z) => !v.destroyed && v.driveable !== false && Math.abs(lineT(A, B, x, z) - lineT(A, B, v.x, v.z)) * Math.hypot(B.x - A.x, B.z - A.z) >= 0.3;
    v.driveTo = (x, z) => {
      if (v.destroyed) return false;
      const t = lineT(A, B, x, z), p = at(t);
      if (Math.hypot(p.x - v.x, p.z - v.z) < 0.3) { v.stop?.(); return true; }
      v.path = null;
      v.goal = { ...p, strict: true, cable: t };
      v.maxSpeed = sp;
      return true;
    };
    v._updateDrive = (dt) => {
      const g = v.goal;
      if (!g) return;
      const tv = lineT(A, B, v.x, v.z), L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const left = (g.cable - tv) * L;
      if (Math.abs(left) < 0.05) { v.speed = 0; v.goal = null; this.world.events.emit('vehicle:stop', { vehicle: v }); return; }
      const was = v.speed || 0;
      v.speed = Math.min(sp, was + sp * dt);
      const step = Math.min(Math.abs(left), v.speed * dt) * Math.sign(left);
      const p = at(Math.max(0, Math.min(1, tv + step / L)));
      v.x = p.x; v.z = p.z; v.heading = this.heading;
      if (was === 0 && v.speed > 0) this.world.events.emit('vehicle:move', { vehicle: v, speed: sp });
    };
  }
  /** Keep the punt on its cable (a load, a nudge). */
  snap() {
    const v = this.v;
    if (!v || v.destroyed) return;
    const t = lineT(this.A, this.B, v.x, v.z);
    v.x = this.A.x + (this.B.x - this.A.x) * t; v.z = this.A.z + (this.B.z - this.A.z) * t;
    v.heading = this.heading;
  }
  tick() { if (this.v && !this.v.goal) this.snap(); }
}
registerSetpiece('bcd_cable_ferry', CableFerry);

// ------------------------------------------------------------------ bcd_item_objective

export class ItemObjective extends SetPiece {
  tick() {
    const w = this.world, s = this.spec;
    const o = (w.objectives || []).find((q) => q.id === s.objective);
    if (!o || o.done || o.failed) return;
    if (pickupOf(w, s.item) || !heldByTeam(w, s.itemId)) return;
    o.done = true; o.hidden = false;
    w.events.emit('objective:update', { objective: o });
  }
}
registerSetpiece('bcd_item_objective', ItemObjective);

/** CONFIG hook kept here so the errand's run speed is the reinforcement run (CONFIG.ai.reinforceVel.exit). */
export const ERRAND_RUN = () => CONFIG.ai.reinforceVel?.exit ?? 2.7;
