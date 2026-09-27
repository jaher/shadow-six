/**
 * World — container for one running mission: entities, NavGrid, events, RNG, spatial queries,
 * noise and area damage. Deliberately free of three.js imports (the scene is passed in), so the
 * simulation can run in Node tests with a stub scene.
 * See docs/ARCHITECTURE.md § World.
 * @module world/world
 */

import { NavGrid, T_NAMES, T, B } from './grid.js';
import { findPath } from './pathfinding.js';
import { EventBus } from '../core/events.js';
import { Rng } from '../core/math.js';
import { CONFIG, rulesFor } from '../config.js';
import { WindField } from './wind.js';

/** Spatial hash bucket size (m). */
const HASH_CELL = 4;

export class World {
  /**
   * @param {object} opts
   * @param {object} [opts.game]      owning Game (null in unit tests)
   * @param {{add:Function, remove:Function}} [opts.scene] THREE.Scene (or a stub with add/remove)
   * @param {EventBus} [opts.events]  shared bus (created when omitted)
   * @param {[number, number]} opts.size [W, D] metres
   * @param {number} [opts.seed]
   * @param {object} [opts.mission]  mission definition this world was built from
   */
  constructor({ game = null, scene = null, events = null, size, seed = CONFIG.sim.seed, mission = null }) {
    this.game = game;
    this.scene = scene;
    this.events = events || new EventBus();
    this.mission = mission;
    /** Campaign id ('BEL' | 'BCD') and its ruleset (CONFIG.rulesets); systems check world.rules.* flags. */
    this.campaign = mission?.campaign || 'BEL';
    this.rules = rulesFor(this.campaign);
    this.width = size[0];
    this.depth = size[1];
    this.grid = new NavGrid(size[0], size[1]);
    this.rng = new Rng(seed);
    this.time = 0;
    this.tick = 0;
    /** Mission wind (step 4w): pure function of (x, z, sim time) — deterministic, frozen while paused. */
    this.wind = WindField.forMission(mission || {}, { W: size[0], D: size[1], seed: (seed >>> 0) % 997 + 1 });
    this.wind.events = this.events; // 'wind:flag' (halyard clank) etc.
    /** Mission clock (s) for scoring (§8.2): sim time spent in 'playing'; saved with the game. */
    this.clock = 0;
    /** Number of 20 Hz tick-integer rule ticks run so far (§10.1). */
    this.belTick = 0;
    this._belAcc = 0;
    this._belSubs = [];

    /** @type {import('../entities/entity.js').Entity[]} */
    this.entities = [];
    this.commandos = [];
    this.enemies = [];
    this.vehicles = [];
    this.projectiles = [];
    this.interactables = [];
    this.props = [];
    /** Mission objectives with runtime state: {...def, done, failed}. */
    this.objectives = [];
    this.stats = { kills: 0, alarms: 0, shots: 0, shotsHit: 0, startTime: 0, damageTaken: 0, knifeKills: 0 };
    /** Systems attached by the Game (may be null in unit tests). */
    this.fx = null;
    this.alarm = null;
    /** (spawn) → Vehicle; installed by the Game (see spawnVehicle). */
    this.vehicleFactory = null;
    this.extraction = null;

    this._byId = new Map();
    this._hash = new Map();
    this._subs = [];
    this._removals = [];
  }

  // ------------------------------------------------------------ events

  /**
   * Subscribe to the event bus for the lifetime of this world (auto-unsubscribed by dispose()).
   * @returns {() => void}
   */
  listen(type, fn) {
    const off = this.events.on(type, fn);
    this._subs.push(off);
    return off;
  }

  // ------------------------------------------------------------ entities

  /**
   * Add an entity: registers it in the typed lists, the id map and adds `entity.object3d` to the scene.
   * @template {import('../entities/entity.js').Entity} E
   * @param {E} entity
   * @returns {E}
   */
  add(entity) {
    entity.world = this;
    this.entities.push(entity);
    this._listFor(entity.kind)?.push(entity);
    this._byId.set(entity.id, entity);
    if (entity.tag) this._byId.set(entity.tag, entity);
    if (entity.object3d && this.scene) this.scene.add(entity.object3d);
    entity.onAdded?.(this);
    this._hashInsert(entity);
    return entity;
  }

  /**
   * Remove an entity immediately (object3d leaves the scene, entity.dispose() is called).
   * During a tick prefer `removeLater()`.
   */
  remove(entity) {
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    const list = this._listFor(entity.kind);
    if (list) {
      const j = list.indexOf(entity);
      if (j >= 0) list.splice(j, 1);
    }
    this._byId.delete(entity.id);
    if (entity.tag) this._byId.delete(entity.tag);
    if (entity.object3d && this.scene) this.scene.remove(entity.object3d);
    entity.dispose?.();
    entity.removed = true;
  }

  /** Queue removal at the end of the current tick. */
  removeLater(entity) {
    entity.removed = true;
    this._removals.push(entity);
  }

  /** Flush queued removals (called by the Game at the end of each tick). */
  flushRemovals() {
    if (!this._removals.length) return;
    const list = this._removals;
    this._removals = [];
    for (const e of list) this.remove(e);
  }

  _listFor(kind) {
    switch (kind) {
      case 'commando': return this.commandos;
      case 'enemy': return this.enemies;
      case 'vehicle': return this.vehicles;
      case 'projectile': return this.projectiles;
      case 'interactable': return this.interactables;
      case 'prop': return this.props;
      default: return null;
    }
  }

  /**
   * Look up an entity by numeric id or by mission tag (string id from mission data).
   * @param {number|string} id
   */
  byId(id) {
    return this._byId.get(id) ?? (typeof id === 'string' && /^\d+$/.test(id) ? this._byId.get(Number(id)) : undefined) ?? null;
  }

  // ------------------------------------------------------------ spatial hash

  /** Collision-free bucket key (XOR hashing could merge buckets and report an entity twice). */
  _key(ix, iz) {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  _hashInsert(e) {
    const k = this._key(Math.floor(e.x / HASH_CELL), Math.floor(e.z / HASH_CELL));
    let b = this._hash.get(k);
    if (!b) this._hash.set(k, (b = []));
    b.push(e);
  }

  /** Rebuild the coarse spatial hash (once per tick, before entity updates). */
  rebuildSpatial() {
    for (const b of this._hash.values()) b.length = 0;
    for (const e of this.entities) if (!e.removed) this._hashInsert(e);
  }

  /**
   * Entities whose position is within r of (x, z). Positions are as of the last rebuildSpatial()
   * bucket assignment, distances use current positions.
   * @param {(e: any) => boolean} [filterFn]
   * @returns {any[]}
   */
  entitiesInRadius(x, z, r, filterFn) {
    const out = [];
    const r2 = r * r;
    const pad = 1; // entities may have moved up to a bucket since the last rebuild
    const i0 = Math.floor((x - r) / HASH_CELL) - pad, i1 = Math.floor((x + r) / HASH_CELL) + pad;
    const j0 = Math.floor((z - r) / HASH_CELL) - pad, j1 = Math.floor((z + r) / HASH_CELL) + pad;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > this.entities.length * 2) {
      for (const e of this.entities) {
        const dx = e.x - x, dz = e.z - z;
        if (!e.removed && dx * dx + dz * dz <= r2 && (!filterFn || filterFn(e))) out.push(e);
      }
      return out;
    }
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = this._hash.get(this._key(i, j));
        if (!b) continue;
        for (const e of b) {
          const dx = e.x - x, dz = e.z - z;
          if (!e.removed && dx * dx + dz * dz <= r2 && (!filterFn || filterFn(e))) out.push(e);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ spawning

  /**
   * Spawn a vehicle / emplacement (VEHICLES API). Uses `world.vehicleFactory(spawn)` (set by the Game
   * from entities/vehicle.js createVehicle/Vehicle; the world itself stays free of three.js imports).
   * @param {string} type VEHICLE_DEFAULTS key ('truck', 'tank', 'patrolboat', 'mgNest', 'cannon', …)
   * @param {object} [opts] mission vehicle spawn fields {x, z, heading, id, crew, driveable, …}
   * @returns {import('../entities/vehicle.js').Vehicle}
   */
  spawnVehicle(type, opts = {}) {
    if (!this.vehicleFactory) throw new Error('world.vehicleFactory not set');
    const v = this.vehicleFactory({ ...opts, vehicleType: type });
    this.add(v);
    return v;
  }

  // ------------------------------------------------------------ time base (§10.1)

  /**
   * Subscribe to the BEL tick-integer scheduler: `fn(dt20, belTick)` runs once every 1/belTickHz s of
   * sim time (every 3rd step at 60 Hz / 20 Hz) with dt20 = 0.05, AFTER enemies/perception update in
   * Game.step. Use it for the nervousness update (§4.5), N decay and decoy pulse cadence.
   * @param {(dt20: number, belTick: number) => void} fn
   * @returns {() => void} unsubscribe
   */
  onBelTick(fn) {
    this._belSubs.push(fn);
    return () => {
      const i = this._belSubs.indexOf(fn);
      if (i >= 0) this._belSubs.splice(i, 1);
    };
  }

  /** Advance the BEL tick scheduler by one sim step (called by Game.step). @returns {number} ticks run */
  runBelTicks(dt) {
    const dt20 = 1 / CONFIG.sim.belTickHz;
    this._belAcc += dt;
    let n = 0;
    while (this._belAcc >= dt20 - 1e-9) {
      this._belAcc -= dt20;
      this.belTick++;
      n++;
      for (const fn of [...this._belSubs]) {
        try { fn(dt20, this.belTick); } catch (err) { console.error('[world] belTick handler failed', err); }
      }
    }
    return n;
  }

  /**
   * Rewrite the grid's dynamic occluder layer (§4.2 OCLU): clear it, then every vehicle/entity with
   * `stampOccluder(grid)` stamps its footprint (grid.stampDynamic). Called by Game.step before any update.
   */
  refreshDynamicOccluders() {
    this.grid.clearDynamic();
    for (const e of this.entities) if (!e.removed && e.stampOccluder) e.stampOccluder(this.grid);
  }

  // ------------------------------------------------------------ queries

  /**
   * Path from (fromX, fromZ) to (toX, toZ) on the NavGrid.
   * @param {{swim?: boolean, allowWater?: boolean, maxNodes?: number, role?: string, dynamic?: boolean, noLinks?: boolean}} [opts]
   *   role: who walks (off-grid climb/ladder links are role-gated, see NavGrid.linkAllowed)
   *   noLinks: ignore every off-grid link (grid steps only; e.g. a commando carrying a body, §3.4)
   * @returns {{x:number, z:number, y?:number, link?:{id:number, kind:string}}[] | null}
   */
  findPath(fromX, fromZ, toX, toZ, opts = {}) {
    return findPath(this.grid, fromX, fromZ, toX, toZ, {
      role: opts.role,
      dynamic: !!opts.dynamic,
      noLinks: !!opts.noLinks,
      swim: !!(opts.swim || opts.allowWater),
      maxNodes: opts.maxNodes ?? Math.max(40000, this.grid.size),
      smooth: opts.smooth,
    });
  }

  /**
   * Ground info at a world point.
   * @returns {{terrain: string, terrainCode: number, block: number, walkable: boolean, water: boolean,
   *   shallow: boolean, bridge: boolean, height: number}}
   */
  groundAt(x, z) {
    const g = this.grid;
    const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
    if (!g.inBounds(i, j)) {
      return { terrain: 'ground', terrainCode: T.GROUND, block: B.HIGH, walkable: false, water: false, shallow: false, bridge: false, height: 0 };
    }
    const k = g.idx(i, j);
    const t = g.terrain[k];
    const bridge = !!g.bridge[k];
    return {
      terrain: T_NAMES[t],
      terrainCode: t,
      block: g.block[k],
      walkable: g.isWalkable(i, j),
      water: t === T.WATER && !bridge,
      shallow: t === T.SHALLOW && !bridge,
      bridge,
      height: bridge ? (this.mission?.bridgeDeckHeight ?? 0) : 0,
    };
  }

  // ------------------------------------------------------------ noise & damage

  /**
   * Emit a noise event (§4.4). Perception decides who hears it (distance only, no occlusion).
   * Payload: {x, z, radius, kind, level, source}. `level` (1..3) defaults from CONFIG.stealth.noise[kind]
   * (legacy kinds: 'shot' → 2, 'explosion' → 3, others → 1).
   * @param {number} x
   * @param {number} z
   * @param {number} radius metres (MAP_WIDE for explosions)
   * @param {string} kind a CONFIG.stealth.noise key: 'pistol'|'rifle'|'smg'|'mg'|'explosion'|'decoy'|'halt'|
   *   'mandown'|'alarmShout'|'bark'|'spyUnmask'|'phone'|'horn' (legacy: 'shot', 'footsteps', …)
   * @param {any} [source] entity that made the noise
   * @param {number} [level]
   */
  emitNoise(x, z, radius, kind, source = null, level) {
    const lv = level ?? CONFIG.stealth.noise[kind]?.level ?? (kind === 'explosion' ? 3 : kind === 'shot' ? 2 : 1);
    this.events.emit('noise', { x, z, radius, kind, level: lv, source });
  }

  /**
   * Apply area damage (explosions). Linear falloff from full damage at the centre to 25% at the edge.
   * Affects living units, vehicles and destructible interactables/props with takeDamage().
   * @returns {any[]} entities damaged
   */
  damageRadius(x, z, radius, damage, source = null, kind = 'explosion') {
    const hit = this.entitiesInRadius(x, z, radius, (e) => typeof e.takeDamage === 'function' && e.alive !== false);
    for (const e of hit) {
      const d = Math.hypot(e.x - x, e.z - z);
      const amount = damage * (1 - 0.75 * Math.min(1, d / radius));
      e.takeDamage(amount, source, kind);
    }
    return hit;
  }

  // ------------------------------------------------------------ lifecycle

  /** Snapshot every entity for save games. */
  serialize() {
    return {
      campaign: this.campaign,
      time: this.time,
      tick: this.tick,
      clock: this.clock,
      belTick: this.belTick,
      belAcc: this._belAcc,
      rng: this.rng.snapshot,
      stats: { ...this.stats },
      objectives: this.objectives.map((o) => ({ id: o.id, done: !!o.done, failed: !!o.failed })),
      entities: this.entities.filter((e) => e.kind !== 'prop').map((e) => e.serialize()),
      grid: this.grid.serialize(),
    };
  }

  /** Dispose every entity and unsubscribe world-scoped listeners. */
  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
    for (const e of [...this.entities]) this.remove(e);
    this._hash.clear();
  }
}
