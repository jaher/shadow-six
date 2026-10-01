/**
 * Alarm, silent zones, the siren and barracks reinforcements (design-spec §4.9). Owned by AI.
 * Public API (ARCHITECTURE "Cross-team interfaces"):
 *
 *   world.alarm.raise(zoneId | 'global', cause, x, z, {sensor?})  → fired event name | null
 *   world.alarm.fireEvent(eventName, {zoneId?, cause?, x?, z?})     → releases barracks squads / siren on 'RINT'
 *   world.alarm.zoneAt(x, z) → zone | null        world.alarm.zones  [{id, poly, onSeen, onHeard, reach?, heardLocal?, ignoreFrom?}]
 *   world.alarm.active (siren sounding)           world.alarm.siren {active, gain, t}
 *   world.alarm.zonesFired [{zone, event, cause, t}]  (every zone event, in order)
 *   world.alarm.raiseUnzoned(cause, x, z, sensor)  sensor outside every zone: nothing — except on maps
 *        without any zones that opt in (mission.noZonesFallback, default: `zones` key absent — never an
 *        explicit `zones: []` like M1), where CONFIG.alarm.noZonesFallback acts as one map-wide zone
 *   world.alarm.barracks  {id: {pool, destroyed, squads:[{event, size, exitRoute, loop, door?, regen?, released, members, regenT}]}}
 *
 * Events: 'alarm:zone' {zone, event, cause, x, z} for every event; 'alarm:start' {x, z, cause, event} when
 * the siren starts ('RINT' only; a new RINT restarts the 25 s fade); 'alarm:end' when it fades out;
 * 'reinforcements' {barracksId, squad, units} when a barracks releases a squad. No global all-clear.
 * @module ai/alarm
 */

import { CONFIG } from '../config.js';
import { ensureAI } from './director.js';
import { Enemy } from '../entities/enemy.js';

/** Even-odd point-in-polygon test for [[x,z],...]. */
export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to polygon `poly` (0 inside). */
export function distToPoly(x, z, poly) {
  if (pointInPoly(x, z, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

const P = (p) => ({ x: p.x ?? p[0], z: p.z ?? p[1], ...(p.event ? { event: p.event } : {}) });

/**
 * §4.9 an existing patrol's alarm route, from any of the mission forms:
 *  - an array of points / { points } → run to the first point, then loop them all (reinforce defaults);
 *  - { run: {x, z, vel}, loop: {type, vel, points} } → run there at `vel`, then loop `loop` at its own vel
 *    (M2 p4);
 *  - { run, resume: true } → run there, then resume the patrol's own route (`ownRoute`) at its own vel,
 *    starting from the waypoint nearest the run point (M3 p5). A PINGPONG route loops out and back.
 * @returns {{exit: any[], loop: any[], loopVel?: number}} points with x/z (+wait/look/speed)
 */
export function alarmRoutePlan(r, ownRoute) {
  const pt = (p) => ({ ...p, x: p.x ?? p[0], z: p.z ?? p[1] });
  if (!r) return { exit: [], loop: [] };
  if (Array.isArray(r) || (Array.isArray(r.points) && !r.run)) {
    const pts = (Array.isArray(r) ? r : r.points).map(P);
    return { exit: pts.slice(0, 1), loop: pts };
  }
  // `run` is one point {x, z, vel} or a list of them (a multi-leg run, e.g. M9 pt_nw down the W side)
  const run = (Array.isArray(r.run) ? r.run : r.run ? [r.run] : []).map((q) => ({ x: q.x ?? q[0], z: q.z ?? q[1], speed: q.vel ?? CONFIG.ai.reinforceVel.exit }));
  const src = r.loop || (r.resume ? ownRoute : null);
  let loop = (src?.points || (Array.isArray(src) ? src : [])).map(pt);
  if (loop.length > 1 && loop[0].x === loop.at(-1).x && loop[0].z === loop.at(-1).z) loop.pop(); // closed polyline
  if (src?.type === 'PINGPONG' && loop.length > 2) loop = [...loop, ...loop.slice(1, -1).reverse()];
  if (run.length && loop.length) { // join the loop where the run ends
    let k = 0, best = Infinity;
    const end = run.at(-1);
    loop.forEach((p, i) => { const d = Math.hypot(p.x - end.x, p.z - end.z); if (d < best) { best = d; k = i; } });
    loop = [...loop.slice(k), ...loop.slice(0, k)];
  }
  return { exit: run, loop, loopVel: src?.vel };
}

export class Alarm {
  /** @param {import('../world/world.js').World} world */
  constructor(world) {
    this.world = world;
    const m = world.mission || {};
    /** @type {{id:string, poly:number[][], onSeen:string|null, onHeard:string|null}[]} */
    this.zones = (m.zones || []).map((z) => ({ onSeen: null, onHeard: null, ...z }));
    /** map-wide fallback zone: opt-in (mission.noZonesFallback), or implied by a mission with no `zones` key */
    this.noZonesFallback = !!(m.noZonesFallback ?? m.zones === undefined);
    this.zonesFired = [];
    this.siren = { active: false, gain: 0, t: 0 };
    this.origin = null;
    this.cause = null;
    this._lastFire = new Map(); // `${zone}|${event}` → time (dedupe: one event per zone per step)
    /** §4.9 barracks: structure id → {pool, destroyed, squads} */
    this.barracks = {};
    for (const [id, b] of Object.entries(m.barracks || {})) {
      this.barracks[id] = {
        id, pool: b.pool ?? 5, destroyed: false,
        squads: (b.squads || []).map((s, k) => ({ k, event: 'RINT', size: 2, exitRoute: [], loop: [], ...s, released: false, members: [], regenT: null })),
      };
    }
    world.listen('explosion', (e) => {
      if (e.accident) return; // §4.9 per-mission accident exception
      for (const z of this.zones) if (z.onHeard) this.raise(z.id, 'explosion', e.x, e.z, { sensor: 'heard' });
      if (!this.zones.length) this.raiseUnzoned('explosion', e.x, e.z, 'heard');
    });
    world.listen('structure:destroyed', (p) => { if (this.barracks[p.id]) this.barracks[p.id].destroyed = true; });
    ensureAI(world);
  }

  /** Siren sounding (the HUD lamp / legacy "alarm active"). */
  get active() {
    return this.siren.active;
  }

  /** Zone containing (x, z), or null (first match in mission order). */
  zoneAt(x, z) {
    for (const zn of this.zones) if (pointInPoly(x, z, zn.poly)) return zn;
    return null;
  }

  /**
   * Trip a zone's sensor (or the global alarm). Legacy form raise(x, z, cause) == raise('global', cause, x, z).
   * @param {string} zoneId zone id, or 'global' (fires CONFIG.alarm.sirenEvent)
   * @param {string} cause 'seen' | 'kill' | 'body' | 'shout' | 'heard' | 'explosion' | …
   * @param {{sensor?: 'seen'|'heard', about?: {x: number, z: number}}} [opts] which zone sensor; default 'heard' for
   *   heard/explosion causes; `about`: what a heard alarm shout was about (zone `ignoreFrom`)
   * @returns {string|null} the event fired
   */
  raise(zoneId, cause, x, z, opts = {}) {
    if (typeof zoneId === 'number') return this.raise('global', z, zoneId, cause); // legacy (x, z, cause)
    if (zoneId === 'global') return this.fireEvent(CONFIG.alarm.sirenEvent, { zoneId: null, cause, x, z });
    const zn = this.zones.find((q) => q.id === zoneId);
    if (!zn) return null;
    // optional zone `reach` (m): its sensors ignore a source that far outside the polygon — a guard standing in
    // the zone who hears / sees something across the M4 fjord reacts on his own, the zone stays quiet.
    // Explosions keep their map-wide reach (§4.9).
    if (zn.reach != null && cause !== 'explosion' && Number.isFinite(x) && Number.isFinite(z) && distToPoly(x, z, zn.poly) > zn.reach) return null;
    const sensor = opts.sensor || (cause === 'heard' || cause === 'explosion' ? 'heard' : 'seen');
    // optional zone `heardLocal` (M11 D1): its heard sensor fires only for a noise whose source lies inside it
    if (zn.heardLocal && sensor === 'heard' && Number.isFinite(x) && Number.isFinite(z) && !pointInPoly(x, z, zn.poly)) return null;
    if (zn.ignoreFrom && cause !== 'explosion' && this._fromIgnored(zn, sensor, cause, x, z, opts.about)) return null;
    const evt = sensor === 'heard' ? zn.onHeard : zn.onSeen;
    if (!evt) return null;
    const key = `${zoneId}|${evt}`;
    if (this._lastFire.get(key) === this.world.time) return evt; // same zone event already fired this step
    this._lastFire.set(key, this.world.time);
    return this.fireEvent(evt, { zoneId, cause, x, z });
  }

  /**
   * Optional zone `ignoreFrom: [zoneId]` (M18 islands: "cries there reach no one"): this zone's heard sensor ignores a
   * noise made inside one of those zones, or an alarm shout about something inside them; a body lying inside them is
   * found and investigated but trips nothing. Sightings of the team and explosions are unaffected.
   */
  _fromIgnored(zn, sensor, cause, x, z, about) {
    const polys = zn.ignoreFrom.map((id) => this.zones.find((q) => q.id === id)?.poly).filter(Boolean);
    const inside = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && polys.some((poly) => pointInPoly(p.x, p.z, poly));
    if (sensor === 'heard') return inside({ x, z }) || inside(about);
    return cause === 'body' && inside({ x, z });
  }

  /**
   * A sensor tripped outside every zone: nothing escalates (§4.9), unless the map has no zones at all and uses
   * the fallback (sandbox/test maps; never a map declaring `zones: []` such as M1 — §7.4 "the entire map is safe").
   */
  raiseUnzoned(cause, x, z, sensor = 'seen') {
    if (this.zones.length || !this.noZonesFallback) return null;
    const fb = CONFIG.alarm.noZonesFallback;
    const evt = fb && (sensor === 'heard' ? fb.onHeard : fb.onSeen);
    if (!evt) return null;
    const key = `*|${evt}`;
    if (this._lastFire.get(key) === this.world.time) return evt;
    this._lastFire.set(key, this.world.time);
    return this.fireEvent(evt, { zoneId: null, cause, x, z });
  }

  /**
   * Fire a mission event (RINT, REXT, RPER, custom). Only RINT starts/restarts the siren. Every event
   * releases the barracks squads tied to it and switches patrols with `reactEvents` (§4.9).
   */
  fireEvent(event, { zoneId = null, cause = null, x = 0, z = 0 } = {}) {
    const w = this.world;
    this.zonesFired.push({ zone: zoneId, event, cause, t: w.time });
    w.events.emit('alarm:zone', { zone: zoneId, event, cause, x, z });
    if (event === CONFIG.alarm.sirenEvent) {
      const was = this.siren.active;
      this.siren = { active: true, gain: CONFIG.alarm.sirenGain, t: CONFIG.alarm.sirenDur };
      this.origin = { x, z };
      this.cause = cause;
      if (!was) {
        w.stats.alarms++;
        w.events.emit('alarm:start', { x, z, cause, event });
        w.events.emit('message', { text: 'ALARM!', kind: 'warn' });
      }
      for (const e of w.enemies) if (e.alive && !e.removed) e.brain?.onAlarm?.(x, z, cause);
    }
    this._release(event);
    this._reactPatrols(event);
    return event;
  }

  // ------------------------------------------------------------ barracks (§4.9)

  _release(event) {
    for (const b of Object.values(this.barracks)) {
      if (this._razed(b)) continue; // a destroyed barracks releases nothing more
      for (const s of b.squads) if (s.event === event && !s.released) this._spawnSquad(b, s);
    }
  }

  /**
   * Barracks razed? The event-fed flag, or the structure entity itself: a charge that destroys the building
   * emits its explosion (→ onHeard RINT → release) before 'structure:destroyed', so the same-tick release
   * must read the entity's own `destroyed` flag (§7.5 barr_out: the E-corner charge razes the garrison).
   */
  _razed(b) {
    if (b.destroyed) return true;
    const w = this.world;
    for (const list of [w.interactables, w.props]) {
      for (const e of list || []) {
        if (e.destroyed && e.interactKind !== 'door' && (e.tag ?? e.id) === b.id) return (b.destroyed = true); // doors share the tag
        // razed by the blast being applied right now (explosions.js marks it before any victim dies)
        if (e.blastDoomed && e.interactKind !== 'door' && (e.tag ?? e.id) === b.id) return true;
      }
    }
    return false;
  }

  _barracksDoor(b) {
    const w = this.world;
    const s = (w.mission?.structures || []).find((q) => q.id === b.id);
    const first = b.squads.find((q) => q.exitRoute?.length)?.exitRoute?.[0];
    const reg = w.barracks?.get?.(b.id)?.door; // map-builder registry: the structure's door side (§7.3)
    const p = first ? P(first) : reg ? reg : s ? { x: s.x, z: s.z + (s.d ?? 6) / 2 + 1 } : { x: 0, z: 0 };
    return w.grid.nearestWalkable?.(p.x, p.z, 4) || p;
  }

  _spawnSquad(b, s) {
    const w = this.world;
    const n = Math.min(s.size, b.pool);
    s.released = true;
    if (n <= 0) return [];
    b.pool -= n;
    // optional per-squad exit `door` [x, z]: squads of one garrison released together leave by their own doors
    // instead of stacking on the first squad's exit point (M10 dugout: 9 men on 3 spots, one grenade)
    const sd = s.door ? P(s.door) : null;
    const door = sd ? (w.grid.nearestWalkable?.(sd.x, sd.z, 4) || sd) : this._barracksDoor(b);
    const squadId = `${b.id}#${s.k}`;
    const units = [];
    for (let k = 0; k < n; k++) {
      const e = new Enemy({
        soldierType: k === 0 ? 'sergeant' : 'trooper', x: door.x, z: door.z, heading: 0,
        id: `${squadId}.${s.gen ?? 0}.${k}`, squad: { id: squadId, leader: k === 0 ? undefined : null, columns: s.columns ?? 1 },
        flags: { investigates: true, followsTracks: true, firesOnSight: false }, jail: s.jail ?? null,
      });
      w.add(e);
      if (k === 0) { const sq = w.ai.squad(squadId); sq.leader = e; }
      e.brain.reinforce((s.exitRoute || []).map(P), (s.loop || []).map(P));
      units.push(e);
    }
    s.members = units;
    s.regenT = null;
    w.events.emit('reinforcements', { barracksId: b.id, squad: squadId, units });
    return units;
  }

  /** §4.9 existing patrols with reactEvents switch to their alarm route at 2.7 m/s, then loop. */
  _reactPatrols(event) {
    for (const e of this.world.enemies) {
      if (!e.alive || e.removed || e._reacted?.has(event)) continue;
      const rx = e.spawn?.reactEvents;
      if (!rx || !rx.includes(event)) continue;
      (e._reacted ||= new Set()).add(event);
      const r = e.spawn.alarmRoute || e.spawn.reactRoute;
      const plan = alarmRoutePlan(r, e.spawn.route);
      const pts = plan.exit.length ? plan.exit : plan.loop;
      if (e.brain?.reinforce && pts.length) e.brain.reinforce(plan.exit, plan.loop, { loopVel: plan.loopVel, committed: true });
      // tank depots (M9, M10, M13): a crewed vehicle drives to the first point
      if (e.state === 'inVehicle' && e.vehicle?.driveTo && pts.length) e.vehicle.driveTo(pts[0].x, pts[0].z, true);
    }
  }

  /** world.ai hook: an enemy died → start a squad's regeneration timer when its last member is gone. */
  onEnemyKilled(unit) {
    for (const b of Object.values(this.barracks)) {
      for (const s of b.squads) {
        if (!s.members.includes(unit)) continue;
        // `regen: false` (M4 r4/r6, dossier §8.3): released once, never rebuilt from the pool
        if (s.members.every((m) => !m.alive) && s.regen !== false) s.regenT = CONFIG.alarm.regen;
      }
    }
  }

  update(dt) {
    for (const b of Object.values(this.barracks)) {
      for (const s of b.squads) {
        if (s.regenT == null) continue;
        s.regenT -= dt;
        if (s.regenT > 0) continue;
        s.regenT = null;
        if (this._razed(b) || b.pool <= 0) continue;
        s.gen = (s.gen ?? 0) + 1;
        this._spawnSquad(b, s); // rebuilt from the pool 20 s after the last member died
      }
    }
    const s = this.siren;
    if (!s.active) return;
    s.t -= dt;
    s.gain = Math.max(0, s.gain - CONFIG.alarm.sirenFadePerSec * dt);
    if (s.t <= 0) {
      s.active = false;
      s.gain = 0;
      const o = this.origin || { x: 0, z: 0 };
      this.world.events.emit('alarm:end', { x: o.x, z: o.z, cause: this.cause });
    }
  }

  serialize() {
    const barracks = {};
    for (const [id, b] of Object.entries(this.barracks)) {
      barracks[id] = { pool: b.pool, destroyed: b.destroyed, squads: b.squads.map((s) => ({ released: s.released, regenT: s.regenT, gen: s.gen ?? 0, members: s.members.map((m) => m.id) })) };
    }
    return { siren: { ...this.siren }, zonesFired: this.zonesFired.map((f) => ({ ...f })), origin: this.origin, cause: this.cause, barracks };
  }

  /** Restore state without side effects (no stats change). Emits 'alarm:end' {restored:true} when the
   *  restored siren is off so HUD/audio listeners reset any alarm state they keep. */
  deserialize(d) {
    if (d.siren) this.siren = { ...d.siren };
    else this.siren = { active: !!d.active, gain: d.active ? CONFIG.alarm.sirenGain : 0, t: d.timer ?? 0 }; // v1 saves
    this.zonesFired = (d.zonesFired || []).map((f) => ({ ...f }));
    this.origin = d.origin ?? null;
    this.cause = d.cause ?? null;
    for (const [id, sb] of Object.entries(d.barracks || {})) {
      const b = this.barracks[id];
      if (!b) continue;
      b.pool = sb.pool; b.destroyed = !!sb.destroyed;
      sb.squads.forEach((ss, k) => {
        const s = b.squads[k];
        if (!s) return;
        s.released = ss.released; s.regenT = ss.regenT; s.gen = ss.gen;
        s.members = ss.members.map((mid) => this.world.byId?.(mid)).filter(Boolean);
      });
    }
    if (!this.siren.active) {
      const o = this.origin || { x: 0, z: 0 };
      this.world?.events?.emit('alarm:end', { x: o.x, z: o.z, cause: this.cause, restored: true });
    }
  }
}
