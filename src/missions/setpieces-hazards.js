/**
 * Device / hazard set-pieces (MISSIONS, design-spec §7.1): phones (M5), minefield (M5), fuel_valve (M17 oil
 * spill + fire), firing_range (M20), gate_control (M17 back-gate box, M20 lever with a flashing red light).
 * @module missions/setpieces-hazards
 */

import { CONFIG } from '../config.js';
import { B } from '../world/grid.js';
import { explode } from '../entities/projectile.js';
import { SetPiece, registerSetpiece, inArea, P } from './setpiece-base.js';
import { addDevice } from './setpiece-device.js';
import { fillArea } from './setpieces-structures.js';

/**
 * phones {phones:[{id, at:[x,z]}], links:{fromId: toId}}
 * Using a phone rings the phone it is linked to (§7.1 M5: the S phone rings the N one); a ringing phone pulses
 * 'phone' noise (CONFIG.stealth.noise.phone) for CONFIG.abilities.phoneRing s and lures the guards there.
 */
class Phones extends SetPiece {
  build(world) {
    this.ringing = {}; this.pulse = {};
    for (const ph of this.spec.phones || []) {
      addDevice(world, { ...P(ph.at), id: ph.id, label: 'Telephone', sfx: 'switch_throw', activation: 1.0, // the linked phone rings
        onUse: () => { this.ring((this.spec.links || {})[ph.id] ?? ph.id); } });
    }
  }
  ring(id) {
    this.ringing[id] = CONFIG.abilities.phoneRing ?? 10;
    this.pulse[id] = 0;
    const d = this.world.byId(id);
    this.world.events.emit('device', { id, sfx: 'telephone_ring', x: d?.x ?? this.x, z: d?.z ?? this.z, on: true });
  }
  tick(dt) {
    const N = CONFIG.stealth.noise.phone;
    for (const id of Object.keys(this.ringing)) {
      const d = this.world.byId(id);
      this.ringing[id] -= dt;
      this.pulse[id] -= dt;
      if (d && this.pulse[id] <= 0) { this.pulse[id] = N.pulse; this.world.emitNoise(d.x, d.z, N.radius, 'phone', d, N.level); }
      if (this.ringing[id] <= 0) { delete this.ringing[id]; this.world.events.emit('device', { id, sfx: 'telephone_ring', x: d?.x, z: d?.z, on: false }); }
    }
  }
  save() { return { ringing: { ...this.ringing }, pulse: { ...this.pulse } }; }
  load(s) { this.ringing = { ...(s.ringing || {}) }; this.pulse = { ...(s.pulse || {}) }; }
}
registerSetpiece('phones', Phones);

/**
 * minefield {mines:[[x,z]...], r?=0.7, cls?='grenade' ('mine': the 3 m lethal land-mine class), vehicles?=true}
 * Invisible anti-personnel mines (§7.1 M5 S approaches): a commando (or a vehicle driven by one) within r sets
 * one off. The garrison knows where they are: enemies never trigger them.
 */
class Minefield extends SetPiece {
  build() { this.live = (this.spec.mines || []).map(() => true); }
  tick() {
    const w = this.world, r = this.spec.r ?? 0.7;
    (this.spec.mines || []).forEach((m, k) => {
      if (!this.live[k]) return;
      const p = P(m);
      const man = w.commandos.find((c) => c.alive && c.state !== 'inVehicle' && c.stance !== 'swim' && c.stance !== 'dive' && (c.y || 0) < 0.5 && Math.hypot(c.x - p.x, c.z - p.z) <= r);
      const car = this.spec.vehicles !== false && w.vehicles.find((v) => !v.destroyed && v.operator && !v.isBoat && Math.hypot(v.x - p.x, v.z - p.z) <= r + Math.min(...v.def.size) / 2);
      if (!man && !car) return;
      this.live[k] = false;
      explode(w, p.x, p.z, this.spec.cls || 'grenade', this, {});
      if (man?.alive) man.die?.('explosion', null);
    });
  }
  save() { return { live: [...this.live] }; }
  load(s) { if (s.live) this.live = [...s.live]; }
}
registerSetpiece('minefield', Minefield);

/**
 * fuel_valve {valve:{at:[x,z], id?, roles?}, clicks?=3, spill:{x,z,r}, growTime?=8, burnTime?=90}
 * §7.1 M17: work the valve `clicks` times (each use opens it further) and oil pours out, spreading to `spill.r`.
 * A shot or explosion in the puddle (or `ignite()`) sets it ablaze: everyone inside burns while the tank feeds it.
 */
class FuelValve extends SetPiece {
  build(world) {
    this.opened = 0; this.puddle = 0; this.burnT = 0;
    const v = this.spec.valve;
    addDevice(world, { ...P(v.at || v), id: v.id ?? `${this.tag}_valve`, label: 'Fuel valve', sfx: 'valve_turn', roles: v.roles ?? null, activation: 0.8,
      onUse: () => { this.opened++; if (this.opened === (this.spec.clicks ?? 3)) this.say('The fuel pours onto the ground.'); } });
    const hitsPuddle = (x, z) => this.puddle > 0.5 && Math.hypot(x - this.spec.spill.x, z - this.spec.spill.z) <= this.puddle;
    world.listen('shot', (s) => { const t = s.to || s.target; if (t && hitsPuddle(t.x, t.z)) this.ignite(); });
    world.listen('explosion', (e) => { if (hitsPuddle(e.x, e.z) || (this.puddle > 0.5 && Math.hypot(e.x - this.spec.spill.x, e.z - this.spec.spill.z) <= this.puddle + (e.radius || 0) / 2)) this.ignite(); });
  }
  get flowing() { return !this.spent && this.opened >= (this.spec.clicks ?? 3); } // the tank burns dry once
  ignite() {
    if (this.burnT > 0 || this.puddle <= 0.5) return;
    this.burnT = this.spec.burnTime ?? 90;
    const S = this.spec.spill;
    this.world.events.emit('fire', { x: S.x, z: S.z, on: true });
    this.world.fx?.spawn?.('fire', S.x, S.z, { r: this.puddle, duration: this.burnT });
  }
  tick(dt) {
    const S = this.spec.spill;
    if (this.flowing && this.puddle < S.r) this.puddle = Math.min(S.r, this.puddle + (S.r / (this.spec.growTime ?? 8)) * dt);
    if (!(this.burnT > 0)) return;
    this.burnT -= dt;
    for (const u of [...this.world.commandos, ...this.world.enemies]) {
      if (u.alive && u.state !== 'inVehicle' && Math.hypot(u.x - S.x, u.z - S.z) <= this.puddle) u.die?.('fire', null);
    }
    if (this.burnT <= 0) { this.puddle = 0; this.spent = true; this.world.events.emit('fire', { x: S.x, z: S.z, on: false }); }
  }
  save() { return { opened: this.opened, puddle: this.puddle, burnT: this.burnT, spent: !!this.spent }; }
  load(s) { Object.assign(this, s); }
}
registerSetpiece('fuel_valve', FuelValve);

/**
 * firing_range {area:{poly|x,z,r|rect}, kinds?:['pistol']}
 * §7.1 M20: shots of the listed noise kinds fired inside the range are routine — guards may come and look
 * (level 1), but the zone's "heard" alarm never fires (level < CONFIG.stealth.zoneHeardLevel).
 */
class FiringRange extends SetPiece {
  build(world) {
    const kinds = new Set(this.spec.kinds || ['pistol']);
    const orig = world.emitNoise.bind(world);
    world.emitNoise = (x, z, radius, kind, source = null, level) => {
      if (kinds.has(kind) && inArea(this.spec.area, x, z)) level = Math.min(level ?? CONFIG.stealth.noise[kind]?.level ?? 2, CONFIG.stealth.zoneHeardLevel - 1);
      return orig(x, z, radius, kind, source, level);
    };
  }
}
registerSetpiece('firing_range', FiringRange);

/**
 * gate_control {control:{at:[x,z], id?, label?, blink?, light?, roles?}, doors?:[ids], area?:{rect|poly}, open?=false, once?=false}
 * A control box / lever that opens (and shuts) gates: `doors` are door interactables, `area` a set of grid cells
 * (a water gate) blocked while shut. `blink` = the flashing red light of M20's range lever.
 */
class GateControl extends SetPiece {
  build(world) {
    this.open = !!this.spec.open;
    if (this.spec.area) fillArea(world.grid, this.spec.area, 'block', this.open ? B.NONE : B.HIGH);
    const c = this.spec.control;
    addDevice(world, { ...P(c.at || c), id: c.id ?? `${this.tag}_control`, label: c.label ?? 'Gate control', blink: !!c.blink, light: !!c.light, roles: c.roles ?? null, sfx: 'switch_throw',
      canUseFn: () => (this.spec.once && this.open ? 'Already open.' : true), onUse: () => this.set(!this.open) });
  }
  set(on) {
    this.open = !!on;
    const w = this.world;
    if (this.spec.area) fillArea(w.grid, this.spec.area, 'block', this.open ? B.NONE : B.HIGH);
    for (const id of this.spec.doors || []) w.byId(id)?.setOpen?.(this.open);
    w.events.emit('door', { id: this.tag, open: this.open });
  }
  save() { return { open: this.open }; }
  load(s) { this.open = !!s.open; }
}
registerSetpiece('gate_control', GateControl);
