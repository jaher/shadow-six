/**
 * Structure set-pieces (MISSIONS, design-spec §7.1): lock_gate (M13), mobile_bridge (M17), collapse (M11 tunnel,
 * M19 watchtower base), multi_charge (M18 markers A/B/C).
 * @module missions/setpieces-structures
 */

import { B } from '../world/grid.js';
import { SetPiece, registerSetpiece, inArea, P } from './setpiece-base.js';
import { addDevice } from './setpiece-device.js';

/** Write `layer` = value over an area {rect:{x,z,w,d}} | {poly} | {x,z,r}. */
export function fillArea(grid, a, layer, value) {
  if (a.rect) grid.fillRect(a.rect.x, a.rect.z, a.rect.w, a.rect.d, layer, value);
  else if (a.poly) grid.fillPoly(a.poly, layer, value);
  else if (a.r != null) grid.fillCircle(a.x, a.z, a.r, layer, value);
}

const units = (w) => [...w.commandos, ...w.enemies].filter((u) => u.alive && !u.removed && u.state !== 'inVehicle' && u.state !== 'jailed');

/**
 * lock_gate {gate:{rect|poly} (water cells), open?=false, shack:{at:[x,z], id?}, operator?: enemyId,
 *            boat?: vehicleId, sides?:[[x,z],[x,z]] (waiting points either side), period?=45, openTime?=14, hornDelay?=3}
 * Closed = the gate cells block boats and swimmers. The supply boat waits `period` s at one side, sounds its horn
 * (noise 'horn', level `hornLevel`?=0 = routine, no guard reacts), the operator opens the gate (only while he lives), the boat crosses, the gate shuts after
 * `openTime`. Working the shack control (any commando) opens it for good (§7.1 M13; gap-4).
 */
class LockGate extends SetPiece {
  build(world) {
    this.open = !!this.spec.open;
    this.latched = false;
    this.phase = 'idle'; this.t = this.spec.period ?? 45; this.side = 0; this.closeT = 0;
    this._place();
    this._apply(world);
    const sh = this.spec.shack;
    if (sh) addDevice(world, { ...P(sh.at || sh), id: sh.id ?? `${this.tag}_control`, label: 'Lock control', sfx: 'switch_throw', activation: 1.5,
      // the first use latches the gate OPEN, even when it already stands open for the boat (a plain toggle shut it
      // for good then: replay m13, lever pulled while the gate stood open behind a dead operator); later uses toggle
      onUse: () => { if (this.latched) this.setOpen(!this.open); else { this.latched = true; this.setOpen(true); } } });
  }
  _apply(world = this.world) {
    fillArea(world.grid, this.spec.gate, 'block', this.open ? B.NONE : B.HIGH);
  }
  /** No `at` in the spec: the gate's own events (device / door → lock_gate sfx) sit at the gate's centre. */
  _place() {
    const a = this.spec.gate || {};
    if (this.spec.at) return;
    if (a.rect) { this.x = a.rect.x + a.rect.w / 2; this.z = a.rect.z + a.rect.d / 2; } else if (a.r != null) { this.x = a.x; this.z = a.z; }
  }
  setOpen(on) {
    if (this.open === !!on) return;
    this.open = !!on;
    this._apply();
    this.world.events.emit('device', { id: this.tag, sfx: 'lock_gate', x: this.x, z: this.z, on: this.open });
    this.world.events.emit('door', { id: this.tag, open: this.open });
  }
  get operatorAlive() {
    if (this.spec.operator == null) return true;
    const e = this.world.byId(this.spec.operator);
    return !!(e && e.alive);
  }
  tick(dt) {
    const boat = this.spec.boat != null ? this.world.byId(this.spec.boat) : null;
    if (this.closeT > 0 && (this.closeT -= dt) <= 0 && !this.latched && this.operatorAlive) this.setOpen(false);
    if (!boat || boat.destroyed || !this.spec.sides) return;
    const sides = this.spec.sides.map(P);
    this.t -= dt;
    if (this.phase === 'idle' && this.t <= 0) {
      this.phase = 'horn'; this.t = this.spec.hornDelay ?? 3;
      // audio: noise kind 'horn' → ship horn. The routine horn is no lure (level 0: guards ignore it, `hornLevel`
      // overrides); a latched-open gate needs no horn at all
      if (!this.latched) this.world.emitNoise(boat.x, boat.z, 30, 'horn', boat, this.spec.hornLevel ?? 0);
    } else if (this.phase === 'horn' && this.t <= 0) {
      if (this.open || this.operatorAlive) {
        this.setOpen(true);
        this.side = 1 - this.side;
        boat.followPath([sides[this.side]], { speed: this.spec.boatSpeed });
        this.phase = 'cross'; this.t = 60;
      } else { this.phase = 'idle'; this.t = this.spec.period ?? 45; } // nobody to open: the boat waits for good
    } else if (this.phase === 'cross' && ((!boat.goal && !boat.path) || this.t <= 0)) {
      this.closeT = this.spec.openTime ?? 14;
      this.phase = 'idle'; this.t = this.spec.period ?? 45;
    }
  }
  save() { return { open: this.open, latched: this.latched, phase: this.phase, t: this.t, side: this.side, closeT: this.closeT }; }
  load(s) { Object.assign(this, s); this._place(); this._apply(); }
}
registerSetpiece('lock_gate', LockGate);

/**
 * mobile_bridge {deck:{rect|poly}, extended?=true, lever:{at:[x,z], id?} | levers:[…], moveTime?=3, crushArea?:{…}}
 * §7.1 M17: a lever slides the bridge over the ravine or back. Retracted deck cells block (a gap); anyone on the
 * deck when it retracts falls; anyone in `crushArea` when it slides out is crushed.
 */
class MobileBridge extends SetPiece {
  build(world) {
    this.extended = this.spec.extended !== false;
    this.moving = 0;
    this._apply(world);
    const levers = this.spec.levers || (this.spec.lever ? [this.spec.lever] : []);
    levers.forEach((l, k) => addDevice(world, { ...P(l.at || l), id: l.id ?? `${this.tag}_lever${k}`, label: 'Bridge lever', sfx: 'switch_throw',
      canUseFn: () => (this.moving > 0 ? 'The bridge is moving.' : true), onUse: () => this.toggle() }));
  }
  _apply(world = this.world) {
    const g = world.grid;
    fillArea(g, this.spec.deck, 'block', this.extended ? B.NONE : B.HIGH);
    fillArea(g, this.spec.deck, 'bridge', this.extended ? 1 : 0);
  }
  toggle() {
    if (this.moving > 0) return false;
    this.moving = this.spec.moveTime ?? 3;
    this.target = !this.extended;
    this.world.events.emit('device', { id: this.tag, sfx: 'gate_creak', x: this.x, z: this.z, on: this.target });
    return true;
  }
  tick(dt) {
    if (!(this.moving > 0) || (this.moving -= dt) > 0) return;
    this.moving = 0;
    this.extended = this.target;
    const w = this.world;
    const doomed = units(w).filter((u) => (!this.extended && inArea(this.spec.deck, u.x, u.z))
      || (this.extended && this.spec.crushArea && inArea(this.spec.crushArea, u.x, u.z)));
    this._apply();
    for (const u of doomed) u.die?.(this.extended ? 'crushed' : 'fall', null);
    w.events.emit('door', { id: this.tag, open: this.extended });
  }
  save() { return { extended: this.extended, moving: this.moving, target: this.target }; }
  load(s) { Object.assign(this, s); this._apply(); }
}
registerSetpiece('mobile_bridge', MobileBridge);

/**
 * collapse {at:[x,z], r?=3, by?:['bomb'], block?:{rect|poly|x,z,r}, kill?:{area}, structure?: id, event?, message?}
 * An explosion of a listed class within r of `at` brings it down once: `block` cells become impassable (the M11
 * tunnel stops the half-track), everyone in `kill` dies (the M19 watchtower gunner), `structure` is destroyed.
 */
class Collapse extends SetPiece {
  build(world) {
    this.done = false;
    const by = new Set(this.spec.by || ['bomb']);
    const at = P(this.spec.at);
    world.listen('explosion', (e) => {
      if (this.done || !by.has(e.kind) || Math.hypot(e.x - at.x, e.z - at.z) > (this.spec.r ?? 3)) return;
      this.collapse(e.source);
    });
  }
  collapse(source = null) {
    if (this.done) return;
    this.done = true;
    const w = this.world, S = this.spec;
    if (S.block) fillArea(w.grid, S.block, 'block', B.HIGH);
    if (S.kill) for (const u of units(w)) if (inArea(S.kill, u.x, u.z)) u.die?.('explosion', source?.owner ?? source ?? null);
    if (S.structure != null) w.byId(S.structure)?.destroy?.(source, 'explosion');
    if (S.event) w.alarm?.fireEvent(S.event, { cause: 'collapse', x: this.x, z: this.z });
    w.events.emit('structure:destroyed', { id: this.tag, type: 'collapse', owner: 0 });
    if (S.message) this.say(S.message);
  }
  save() { return { done: this.done }; }
  load(s) { this.done = !!s.done; }
}
registerSetpiece('collapse', Collapse);

/**
 * multi_charge {target: structureId, markers:['A','B','C'], window?=2, by?:['bomb']}
 * §7.1 M18: the target falls only when every marker (mission `markers[]`) takes a charge within `window`
 * seconds — three remote charges detonated together. Mark the target structure `indestructible: true`.
 */
class MultiCharge extends SetPiece {
  build(world) {
    this.hits = {}; this.done = false;
    const by = new Set(this.spec.by || ['bomb']);
    world.listen('explosion', (e) => {
      if (this.done || !by.has(e.kind)) return;
      for (const id of this.spec.markers) {
        const m = world.markers?.get(id);
        if (m && Math.hypot(e.x - m.x, e.z - m.z) <= (m.r ?? 3)) this.hits[id] = world.time;
      }
      const ts = this.spec.markers.map((id) => this.hits[id]);
      if (ts.every((t) => t != null) && Math.max(...ts) - Math.min(...ts) <= (this.spec.window ?? 2)) {
        this.done = true;
        const t = world.byId(this.spec.target);
        if (t && !t.destroyed) t.destroy?.(e.source, 'explosion');
      }
    });
  }
  save() { return { hits: { ...this.hits }, done: this.done }; }
  load(s) { this.hits = { ...(s.hits || {}) }; this.done = !!s.done; }
}
registerSetpiece('multi_charge', MultiCharge);
