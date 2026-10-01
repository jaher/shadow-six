/**
 * Transport set-pieces (MISSIONS, design-spec §7.1): rail_line (M4/M16/M18 trains, damaged track),
 * cable_car (M5), conveyor (M19), current (M19 fast river). Also registers the rail vehicle types
 * `cable_car` and `mine_cart` (harmless rail: no kill box, never blocked).
 * @module missions/setpieces-transport
 */

import { registerVehicleType } from '../entities/vehicle.js';
import { SetPiece, registerSetpiece, inArea, P } from './setpiece-base.js';
import { addDevice } from './setpiece-device.js';

registerVehicleType('cable_car', { kind: 'rail', model: 'cable_car', speed: 'rail', hits: 0, armor: 'heavy', size: [3, 2.2], occludes: false, rail: true, harmless: true, seats: 6 });
registerVehicleType('mine_cart', { kind: 'rail', model: 'mine_cart', speed: 'rail', hits: 0, armor: 'heavy', size: [2, 1.2], occludes: false, rail: true, harmless: true, seats: 1 });

/** Distance from (x, z) to a polyline. */
export function distToPolyline(pts, x, z) {
  let best = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = P(pts[k - 1]), b = P(pts[k]);
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

/**
 * rail_line {track:[[x,z]...], width?=3, stopBy?:['grenade','bomb'], blockR?=1.5}
 * An explosion of a listed class on the rails damages the track: every train stops short of it for the rest
 * of the mission (§7.1 M18 "a grenade on the track stops trains"); the stopped train is cover (occluder).
 */
class RailLine extends SetPiece {
  build(world) {
    this.blocks = [];
    world.railBlocks ||= [];
    const stopBy = new Set(this.spec.stopBy || ['grenade', 'bomb']);
    world.listen('explosion', (e) => {
      if (!stopBy.has(e.kind) || distToPolyline(this.spec.track, e.x, e.z) > (this.spec.width ?? 3) / 2 + 0.5) return;
      if (this.blocks.some((b) => Math.hypot(b.x - e.x, b.z - e.z) < 3)) return;
      this._addBlock({ x: e.x, z: e.z, r: this.spec.blockR ?? 1.5, active: true });
      world.events.emit('message', { text: 'The track is damaged.', kind: 'info' });
    });
  }
  _addBlock(b) { this.blocks.push(b); this.world.railBlocks.push(b); }
  save() { return { blocks: this.blocks.map((b) => ({ ...b })) }; }
  load(s) {
    this.world.railBlocks = this.world.railBlocks.filter((b) => !this.blocks.includes(b));
    this.blocks = [];
    for (const b of s.blocks || []) this._addBlock({ ...b });
  }
}
registerSetpiece('rail_line', RailLine);

/**
 * cable_car {vehicle: id, stations:[{at:[x,z], y?, exit:[x,z]}, …], keepAboard?}
 * The cabin is a `cable_car` rail vehicle shuttling (pingpong) between the stations; board it while it is
 * docked. Riders step out automatically at the other station, onto its exit point at the station height.
 * `keepAboard: true` (M5, the on-demand cabin): riders stay aboard at the far station until they get out
 * (or ride back when someone boards there); `freshAboard()` tells the mission whether a man boarded at the
 * current station. A rider who gets out of a docked cabin lands on that station's exit point at its height;
 * nobody gets out between stations. Helper `cableCar()` builds the vehicle + set-piece pair.
 */
class CableCar extends SetPiece {
  build() { this.boarded = {}; this.arrived = {}; }
  init() {
    const v = this.v = this.world.byId(this.spec.vehicle);
    if (!v) return;
    // a manual exit steps onto the docked station's exit point (at its height); none between stations
    // (the original method is kept once per vehicle, so a re-initialised set-piece rewraps it)
    const exit = v._cableExitOrig || (v._cableExitOrig = v.exit.bind(v));
    // whoever gets out starts afresh (a rider may step out and back in within one tick)
    this.world.listen?.('vehicle:exit', ({ vehicle, unit }) => { if (vehicle === this.v && unit) { delete this.boarded[unit.id]; delete this.arrived[unit.id]; } });
    v.exit = (u, x, z, o = {}) => {
      if (v.destroyed || o.force) return exit(u, x, z, o);
      const k = this._docked();
      if (k < 0) return false;
      const st = this.spec.stations[k], ex = P(st.exit || st.at);
      const n = v.occupants.indexOf(u);
      if (!exit(u, ex.x + (n > 0 ? (n % 2 ? 1 : -1) * 0.8 * Math.ceil(n / 2) : 0), ex.z, { force: true })) return false;
      u.y = this.world.grid.elevAt?.(u.x, u.z) || (st.y ?? 0);
      return true;
    };
  }
  _stationAt(x, z) {
    return (this.spec.stations || []).findIndex((s) => Math.hypot(P(s.at).x - x, P(s.at).z - z) < 2.5);
  }
  _docked() { return this.v && this.v.speed === 0 ? this._stationAt(this.v.x, this.v.z) : -1; }
  /** A rider boarded at the station the cabin is docked at (not one who only rode in). */
  freshAboard() {
    const k = this._docked();
    return (this.v?.occupants || []).some((u) => (u.faction === 'player' || u.kind === 'commando') && !this.arrived[u.id] && (this.boarded[u.id] == null || this.boarded[u.id] === k));
  }
  tick() {
    const v = this.v;
    if (!v || v.destroyed) return;
    const k = this._docked();
    if (k < 0) this.arrived = {}; // under way: everybody aboard rides
    for (const u of [...v.occupants]) {
      const id = u.id;
      if (this.boarded[id] == null) { this.boarded[id] = k >= 0 ? k : 0; continue; }
      if (k < 0 || k === this.boarded[id]) continue;
      if (this.spec.keepAboard) {
        this.boarded[id] = k; this.arrived[id] = true;
        this.world.events.emit('message', { text: 'Cable car station. Get out, or stay aboard for the ride back.', kind: 'info', unit: u });
        continue;
      }
      const st = this.spec.stations[k];
      const ex = P(st.exit || st.at);
      if (v.exit(u, ex.x, ex.z, { force: true })) {
        u.y = this.world.grid.elevAt?.(u.x, u.z) || (st.y ?? 0);
        delete this.boarded[id];
        this.world.events.emit('message', { text: 'Cable car station.', kind: 'info', unit: u });
      }
    }
    for (const id of Object.keys(this.boarded)) if (!v.occupants.some((u) => String(u.id) === id)) { delete this.boarded[id]; delete this.arrived[id]; }
  }
  save() { return { boarded: { ...this.boarded }, arrived: { ...this.arrived } }; }
  load(s) { this.boarded = { ...(s.boarded || {}) }; this.arrived = { ...(s.arrived || {}) }; }
}
registerSetpiece('cable_car', CableCar);

/** Author helper: the cabin vehicle spawn + the set-piece for a two-station cable car. */
export function cableCar({ id = 'cablecar', a, b, speed = 3, dwell = 10, delay = dwell }) {
  const A = P(a), B = P(b);
  return {
    vehicle: { vehicleType: 'cable_car', id, x: A.x, z: A.z, track: [{ x: A.x, z: A.z, y: A.y }, { x: B.x, z: B.z, y: B.y }], schedule: { mode: 'pingpong', speed, endWait: dwell, delay } },
    setpiece: { type: 'cable_car', id: `${id}_line`, vehicle: id, stations: [{ at: [A.x, A.z], y: A.y, exit: a.exit ?? [A.x, A.z + 2] }, { at: [B.x, B.z], y: B.y, exit: b.exit ?? [B.x, B.z + 2] }] },
  };
}

/**
 * conveyor {points:[[x,z],[x,z]], width?=1.6, speed?=1.2, dir?=1, switch?:{x,z|at,id?,light?,blink?}, carries?:'crawl'|'all', exit?:[x,z]}
 * §7.1 M19: the belt carries men lying on it (crawling, not walking on their own) along its direction; the
 * switch reverses it. A man reaching the far end is set down at `exit` (e.g. inside the mine building).
 */
class Conveyor extends SetPiece {
  build(world) {
    this.dir = this.spec.dir ?? 1;
    const sw = this.spec.switch;
    if (sw) addDevice(world, { ...P(sw.at || sw), id: sw.id ?? `${this.tag}_switch`, label: 'Conveyor switch', sfx: 'switch_throw', light: !!sw.light, blink: !!sw.blink, onUse: () => { this.reverse(); } });
  }
  reverse() { this.dir = -this.dir; this.say(this.dir > 0 ? 'Conveyor running forward.' : 'Conveyor reversed.'); }
  tick(dt) {
    const [a, b] = this.spec.points.map(P);
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const half = (this.spec.width ?? 1.6) / 2, v = (this.spec.speed ?? 1.2) * this.dir;
    for (const u of [...this.world.commandos, ...this.world.enemies]) {
      if (!u.alive || u.state === 'inVehicle' || u.path) continue;
      if (this.spec.carries !== 'all' && u.stance !== 'crawl') continue;
      const t = (u.x - a.x) * ux + (u.z - a.z) * uz, off = Math.abs(-(u.x - a.x) * uz + (u.z - a.z) * ux);
      if (off > half || t < -0.2 || t > L + 0.2) continue;
      const nt = t + v * dt;
      if (nt >= L && this.dir > 0 && this.spec.exit) { const e = P(this.spec.exit); u.setPosition(e.x, e.z); continue; }
      const c = Math.max(0, Math.min(L, nt));
      u.x = a.x + ux * c + (u.x - a.x - ux * t);
      u.z = a.z + uz * c + (u.z - a.z - uz * t);
    }
  }
  save() { return { dir: this.dir }; }
  load(s) { this.dir = s.dir ?? this.dir; }
}
registerSetpiece('conveyor', Conveyor);

/**
 * current {area:{poly}|{x,z,r}, velocity?=2, angleDeg?=0 (flow heading, 0 = +x, 90 = +z), noUpstream?=true, drift?=true}
 * §7.1 M19 fast river: boats may not be ordered upstream (driveRules), idle boats and swimmers drift downstream.
 */
class Current extends SetPiece {
  build(world) {
    const h = ((this.spec.angleDeg ?? 0) * Math.PI) / 180;
    this.fx = Math.cos(h); this.fz = Math.sin(h);
    if (this.spec.noUpstream === false) return;
    (world.driveRules ||= []).push((v, x, z) => {
      if (!v.isBoat || !inArea(this.spec.area, v.x, v.z)) return true;
      const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz) || 1;
      const up = (dx * this.fx + dz * this.fz) / d < -0.25;
      if (up) world.events.emit('message', { text: 'The current is too strong to row upstream.', kind: 'warn' });
      return !up;
    });
  }
  tick(dt) {
    if (this.spec.drift === false) return;
    const w = this.world, s = (this.spec.velocity ?? 2) * dt, g = w.grid;
    const move = (e) => {
      const nx = e.x + this.fx * s, nz = e.z + this.fz * s;
      const { i, j } = g.worldToCell(nx, nz);
      if (g.inBounds(i, j) && g.isWater(i, j)) { e.x = nx; e.z = nz; }
    };
    for (const v of w.vehicles) if (v.isBoat && !v.destroyed && !v.goal && !v.path && inArea(this.spec.area, v.x, v.z)) move(v);
    for (const u of w.commandos) if (u.alive && (u.stance === 'swim' || u.stance === 'dive') && !u.path && inArea(this.spec.area, u.x, u.z)) move(u);
  }
}
registerSetpiece('current', Current);
