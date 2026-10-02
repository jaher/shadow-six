/**
 * Unit — humanoid base (commandos and soldiers): path following, turning, stances, speeds, running
 * footstep noise, health/damage/death, animation state, serialization.
 * See docs/ARCHITECTURE.md § Entities.
 * @module entities/unit
 */

import { settleBody, fallHeading, settleSolid } from '../world/placement.js';
import { Entity } from './entity.js';
import { createUnitModel } from '../art/unit-model.js';
import { CONFIG, velToSpeed } from '../config.js';
import { angleTo, turnTowardsAngle, angleDiff, dist } from '../core/math.js';
import { T, MAX_STEP } from '../world/grid.js';
import { plan as avoidPlan, priority, blocks, givesWay } from './avoidance.js';

/** Brain states in which a standing enemy steps aside for a mate who cannot get past him. */
const YIELD_STATES = new Set(['IDLE', 'REINFORCE', 'RETURN', 'INVESTIGATE', 'SEARCH', 'TRACKS', 'BODY']);
import { cornerOffset } from './path-curve.js';
import { bodyGap, clearPose, avoidMask, inflationTiers, hasObstacles, pushedBy, MOVE_MARGIN, STOP_MARGIN } from '../world/body-clearance.js';
import { pathLength } from '../world/pathfinding.js';
import { runNoiseStep } from '../ai/running-noise.js';

const LOW_STANCES = new Set(['crawl', 'swim', 'dive', 'downed']);
/** Every Unit.state value (§10.4 #2). BEL never enters 'stunned'/'bound' (BCD rulesets only). */
export const UNIT_STATES = Object.freeze(['active', 'dead', 'stunned', 'hidden', 'inVehicle', 'carried', 'busy', 'bound', 'held', 'captured', 'jailed', 'downed']);
/** A man stopped in place: not walking, not carried along on a conveyor belt (moved at the 20 Hz BEL tick: 3 sim steps). */
const stopped = (n, A, w) => Math.hypot(n.vx || 0, n.vz || 0) < A.moving && !(n._beltTick >= w.tick - 3);
/** (x, z) is in a burning wreck's flames or within 1 m of them (§3.6: a step aside never ends, or passes, there). */
const inFire = (w, x, z) => !!w?.vehicles?.some((v) => v.burning && !v.removed && v._inHull?.(x, z, CONFIG.vehicles.wreckFireRadius + 1));
const fireStep = (w, x0, z0, x, z) => inFire(w, x, z) || inFire(w, (x0 + x) / 2, (z0 + z) / 2);
/** States in which cones can never see the unit. */
/** States in which the unit cannot be ordered to move (captured units are walked by their escort). */
const IMMOBILE_STATES = new Set(['dead', 'inVehicle', 'carried', 'stunned', 'bound', 'jailed']);
const HIDDEN_STATES = new Set(['hidden', 'inVehicle', 'carried', 'jailed']);

/** Avoid masks per (sim time, inflation, ignored vehicle): every unit planning in the same step shares them. */
function cachedAvoid(w, inf, ignore) {
  const c = w._avoidCache && w._avoidCache.t === w.time ? w._avoidCache : (w._avoidCache = { t: w.time, m: new Map() });
  const key = `${inf}|${ignore ? [].concat(ignore).map((e) => e?.id ?? '').join(',') : ''}`;
  if (!c.m.has(key)) c.m.set(key, avoidMask(w, inf, ignore));
  return c.m.get(key);
}

export class Unit extends Entity {
  /**
   * @param {object} opts Entity options plus:
   * @param {'player'|'enemy'} opts.faction
   * @param {string} [opts.role]  commando role, or 'enemy'
   * @param {number} [opts.hp]
   * @param {object} [opts.model] prebuilt model (tests); otherwise createUnitModel(opts.modelOpts)
   * @param {object} [opts.modelOpts] passed to art/unit-model.js createUnitModel (real character or placeholder)
   */
  constructor(opts) {
    super(opts);
    this.faction = opts.faction;
    this.role = opts.role || (this.faction === 'enemy' ? 'enemy' : 'greenberet');
    this.maxHp = opts.hp ?? CONFIG.units.hp[this.role] ?? 100;
    this.hp = this.maxHp;
    /** @type {'stand'|'crawl'|'swim'|'dive'} */
    this.stance = 'stand';
    /** @type {'walk'|'run'} */
    this.moveMode = 'walk';
    /**
     * Life/control state — one of UNIT_STATES (see below; design-spec §10.4 #2).
     * @type {'active'|'dead'|'stunned'|'hidden'|'inVehicle'|'carried'|'busy'|'bound'|'held'|'captured'|'jailed'}
     */
    this.state = 'active';
    // ---- orthogonal flags (§10.4 #2, §3.4, §4.5) — combine with any state ----
    /** At gunpoint (CHALLENGE/HOLD, §4.5). The commando keeps obeying orders (option Indifferent). */
    this.held = false;
    /** Green Beret dug in with the shovel (§3.4): invisible to every cone, cannot move. */
    this.buried = false;
    /** Spy in German uniform (§3.4): cones ignore him except for suspicious-act checks. */
    this.disguised = false;
    /** Marine submerged (§3.4): invisible to cones (witness rule). */
    this.underwater = false;
    /** Hidden in a building/hideout (§4.2 band rule: never seen). Mirrors state 'hidden'. */
    this.hidden = false;
    /** Unit (GB/Spy) carrying this body/unit, or null (§4.7). */
    this.carriedBy = null;
    /** Body already reported by a guard (perception skips it). Persisted by serialize(). */
    this.bodyNoticed = false;
    /** Body hidden (e.g. in a bush/building); never noticed. Persisted by serialize(). */
    this.hiddenBody = false;
    /** bodies-design §A.4: settled ragdoll pose (model draws it), settle flag, sunk in deep water (not perceived). */
    this.bodyPose = null;
    this.settled = false;
    this.sunk = false;
    /** @type {{x:number, z:number}[] | null} */
    this.path = null;
    this.pathIndex = 0;
    this.moveTarget = null;
    this.canSwim = false;
    this.turnRate = CONFIG.units.turnRate;
    this.speedMul = 1;
    /** Local avoidance (avoidance.js): lane offset off the path track (m), its lateral speed, wait ramp, velocity. */
    this._laneX = 0; this._laneZ = 0; this._laneV = 0; this._curveX = 0; this._curveZ = 0; this._mdirX = 0; this._mdirZ = 0; this._avScale = 1; this._blockT = 0; this._ghostIds = null; this._holdFor = null; this._yieldAt = null; this._ghostT = null;
    this.vx = 0; this.vz = 0;
    this.radius = CONFIG.units.radius;
    this.pickRadius = CONFIG.units.pickRadius;
    this.killer = null;
    this.deathCause = null;
    this.deathTime = null;
    this._onArrive = null;
    this._footstepT = 0;
    this._stanceT = 0;
    this._pathGridVersion = -1;
    this._anim = null;
    this._animOverride = null; // {name, t}
    this._moving = false;

    this.model = opts.model || createUnitModel({ faction: this.faction, role: this.role, ...(opts.modelOpts || {}) });
    if (this.model && typeof this.model === 'object') this.model.unit = this; // real characters read stance/action/speed
    this.object3d = this.model.root;
    this.object3d.userData.entity = this;
    this._setAnim('idle');
  }

  // ------------------------------------------------------------ derived state

  /**
   * Current movement speed (m/s): design-spec §3.1 for commandos (walk 2.25, run by role, crawl 0.9,
   * swim 1.8), §4.1 for enemies (walk = VEL × 0.9 with `this.vel`, run = CONFIG.ai.chaseSpeed),
   * times `speedMul` (abilities/AI scale it, e.g. carrying). The spec has no terrain speed penalty:
   * snow, sand, mud and shallow water move at the full [EXE] speeds.
   */
  get speed() {
    const U = CONFIG.units;
    let s;
    if (this.stance === 'downed') s = CONFIG.bodies.downed.crawlSpeed; // bodies-design §C.6: a downed man crawls
    else if (this.stance === 'crawl') s = U.crawl;
    else if (this.stance === 'swim' || this.stance === 'dive') s = U.swim;
    else if (this.faction === 'enemy') s = this.moveMode === 'run' ? CONFIG.ai.chaseSpeed : velToSpeed(this.vel ?? CONFIG.ai.defaultVel);
    else s = this.moveMode === 'run' ? (U.run[this.role] ?? U.run.default) : U.walk;
    return s * this.speedMul;
  }

  /** Crawling/swimming/diving: counts as a low target for LOS (B.LOW cover hides it). */
  get isLow() {
    return LOW_STANCES.has(this.stance);
  }

  /** False when hidden, inside a vehicle, carried or diving underwater. */
  get isVisibleToEnemies() {
    return this.alive && !HIDDEN_STATES.has(this.state) && this.stance !== 'dive' && !this.buried && !this.underwater && !this.hidden;
  }

  /** True while following a path. */
  get isMoving() {
    return !!this.path;
  }

  /** Running right now (for accuracy/noise). */
  get isRunning() {
    return !!this.path && this.moveMode === 'run' && this.stance === 'stand';
  }

  // ------------------------------------------------------------ orders

  /**
   * Path to (x, z) and start moving.
   * @param {number} x
   * @param {number} z
   * @param {{run?: boolean, onArrive?: (u: Unit) => void}} [opts]
   * @returns {boolean} false when no path exists (or the unit can't move)
   */
  moveTo(x, z, { run = false, onArrive = null } = {}) {
    if (!this.alive || !this.world || IMMOBILE_STATES.has(this.state) || this.buried) return false;
    // from the path track: a dodging walker keeps its lane (avoidance.js), so re-paths do not shift the route
    const path = this._planPath(x, z);
    if (!path) return false;
    this._bodyBlockT = 0;
    this._bodyProg = null;
    this._settled = false;
    this._settleHeading = null;
    this.path = path;
    this.pathIndex = path.length > 1 ? 1 : 0;
    this.moveTarget = path[path.length - 1];
    this.moveMode = run && this.stance === 'stand' ? 'run' : 'walk';
    this._onArrive = onArrive;
    this._pathGridVersion = this.world.grid.version;
    if (this.state === 'hidden') this.state = 'active';
    return true;
  }

  /**
   * Steer straight at (x, z) without an A* query — for targets that move every tick (squad followers): the
   * path is one waypoint, re-aimed each tick, so the walker never "arrives", stops and restarts between
   * re-paths (the stutter of a moveTo every 0.25 s). The caller checks the straight line is walkable.
   * @returns {boolean}
   */
  steerTo(x, z) {
    if (!this.alive || !this.world || IMMOBILE_STATES.has(this.state) || this.buried) return false;
    const p = this.path;
    if (p && p.length === 1 && p[0].steer) { p[0].x = x; p[0].z = z; this.pathIndex = 0; return true; }
    this._bodyBlockT = 0;
    this._bodyProg = null;
    this._settled = false;
    this._settleHeading = null;
    this.path = [{ x, z, steer: true }];
    this.pathIndex = 0;
    this.moveTarget = this.path[0];
    this.moveMode = 'walk';
    this._onArrive = null;
    this._pathGridVersion = this.world.grid.version;
    return true;
  }

  /**
   * Walk (run) straight to (x, z) without path planning — the caller checked the line (a man stepping out of a
   * vehicle's way, vehicle.js). The step guard still keeps his body out of solids.
   * @returns {boolean}
   */
  walkStraight(x, z, { run = false, onArrive = null } = {}) {
    if (!this.alive || !this.world || IMMOBILE_STATES.has(this.state) || this.buried) return false;
    this._bodyBlockT = 0;
    this._bodyProg = null;
    this._settled = false;
    this._settleHeading = null;
    this.path = [{ x: this.x, z: this.z }, { x, z }];
    this._straight = this.path; // (no local avoidance on it: _avoidPlan)
    this.pathIndex = 1;
    this.moveTarget = this.path[1];
    this.moveMode = run && this.stance === 'stand' ? 'run' : 'walk';
    this._onArrive = onArrive;
    this._pathGridVersion = this.world.grid.version;
    return true;
  }

  /** Where he is on his path track (position minus the avoidance lane and corner curve): route progress. */
  get track() { return { x: this.x - this._laneX - this._curveX, z: this.z - this._laneZ - this._curveZ }; }

  /**
   * Path to (x, z) keeping the whole body clear of solid obstacles — vehicle hulls, wrecks, drums, pushables, crates,
   * rocks (world/body-clearance.js): each inflation tier of the stance in turn (a crawler first keeps room to turn
   * any way, then only to lie parallel), the tighter tier when it is much shorter or ends nearer the click, and the
   * bare grid path when the obstacles box him in (the step guard still keeps his body out of them).
   */
  _planPath(x, z) {
    const w = this.world, q = this.pathQuery(), tr = this.track; // (from his path track, see moveTo)
    if (!hasObstacles(w) || this.y > 1) return w.findPath(tr.x, tr.z, x, z, q);
    const ignore = this._bodyIgnore(true);
    let best = null;
    for (const inf of inflationTiers(this.stance)) {
      const avoid = cachedAvoid(w, inf, ignore);
      // a click on / under a hull: the free spot nearest it on the way from him (he stops on his side of it)
      const t = this._freeToward(x, z, avoid, q.swim);
      const p = w.findPath(tr.x, tr.z, t.x, t.z, { ...q, avoid, nearRadius: 3 + inf });
      if (!p) continue;
      const end = p[p.length - 1], miss = Math.hypot(end.x - x, end.z - z), len = pathLength(p);
      if (!best) { best = { p, miss, len }; continue; }
      if (miss < best.miss - 0.4 || len < best.len / 1.5 - 2) best = { p, miss, len };
    }
    return best ? best.p : w.findPath(tr.x, tr.z, x, z, q);
  }

  /**
   * Obstacles that are no obstacle to this man: the vehicle he is in / getting out of, the pushable he is pushing
   * and (`plan`: path planning only) the device / drum he is walking up to use or pick up — his path ends at it, the
   * step guard still stops his body short of it.
   * @returns {object[]|null}
   */
  _bodyIgnore(plan = false) {
    const out = [];
    if (this.vehicle) out.push(this.vehicle);
    const p = pushedBy(this.world, this);
    if (p) out.push(p);
    const t = plan ? this.pendingAbility?.target : null;
    if (t && t.kind === 'interactable') out.push(t);
    return out.length ? out : null;
  }

  /**
   * (x, z) if free in `avoid`; else, for a man on his feet, the free cell nearest it on his side of it (≤ 3 m: the
   * grid's own goal substitution, never past the click; a click on a fuel tank brings him up beside it); else (and
   * always for a crawler, whose body lies along his approach: arriving at a slant he would lie into the solid) the
   * first free point on the line from it back to him (≤ 6 m).
   */
  _freeToward(x, z, avoid, swim) {
    const g = this.world.grid, opts = { avoid, swim: !!swim };
    const free = (px, pz) => { const c = g.worldToCell(px, pz); return g.isWalkable(c.i, c.j, opts); };
    if (!avoid || free(x, z)) return { x, z };
    const d = Math.hypot(this.x - x, this.z - z);
    if (d < 1e-3) return { x, z };
    const ux = (this.x - x) / d, uz = (this.z - z) / d;
    const cs = g.cell, ci = Math.floor(x / cs), cj = Math.floor(z / cs), R = Math.ceil(3 / cs);
    let best = null, bd = Infinity;
    const prone = this.stance === 'crawl' || this.stance === 'downed';
    for (let j = cj - R; j <= cj + R && !prone; j++) {
      for (let i = ci - R; i <= ci + R; i++) {
        const p = g.cellCenter(i, j), dx = p.x - x, dz = p.z - z, dd = Math.hypot(dx, dz);
        if (dd >= bd || dd > 3 || dx * ux + dz * uz <= 0 || !g.isWalkable(i, j, opts)) continue;
        bd = dd; best = p;
      }
    }
    if (best) return { x: best.x, z: best.z };
    for (let r = 0.25; r <= Math.min(d, 6); r += 0.25) if (free(x + ux * r, z + uz * r)) return { x: x + ux * r, z: z + uz * r };
    return { x, z };
  }

  /** Options for this unit's NavGrid path queries (World.findPath); subclasses add restrictions. */
  pathQuery() {
    return { swim: this.canSwim, role: this.role };
  }

  /** Stop moving (keeps stance). */
  stop() {
    this._bakeLane();
    this.path = null;
    this.pathIndex = 0;
    this.moveTarget = null;
    this._onArrive = null;
  }

  /**
   * Change stance. Lying down takes CONFIG.units.stanceDown (0.5 s), standing up stanceUp (0.6 s): the unit does not
   * move meanwhile and the model plays go_prone / get_up over exactly that time (art/unit-model.js).
   * @param {'stand'|'crawl'|'swim'|'dive'} stance
   */
  setStance(stance) {
    if (!this.alive || stance === this.stance) return;
    if (stance === 'crawl' && this.world) {
      const g = this.world.groundAt(this.x, this.z);
      if (g.water || g.shallow) return; // can't lie down in water
    }
    const prev = this.stance;
    this.stance = stance;
    if (stance !== 'stand') this.moveMode = 'walk';
    if (prev === 'stand' && stance === 'crawl') this._stanceT = CONFIG.units.stanceDown;
    else if (prev === 'crawl' && stance === 'stand') this._stanceT = CONFIG.units.stanceUp;
    this.world?.events.emit('unit:stance', { unit: this, stance });
  }

  /** Face a point instantly. */
  faceTowards(x, z) {
    if (Math.abs(x - this.x) + Math.abs(z - this.z) > 1e-6) this.heading = angleTo(this.x, this.z, x, z);
  }

  /**
   * Turn towards a point at this unit's turn rate.
   * @returns {boolean} true when facing it (within ~3°)
   */
  turnTowards(x, z, dt) {
    const target = angleTo(this.x, this.z, x, z);
    this.heading = turnTowardsAngle(this.heading, target, this.turnRate * dt);
    return Math.abs(angleDiff(this.heading, target)) < 0.05;
  }

  /**
   * Turn towards a heading at this unit's turn rate.
   * @returns {boolean} true when reached
   */
  turnToHeading(h, dt) {
    this.heading = turnTowardsAngle(this.heading, h, this.turnRate * dt);
    return Math.abs(angleDiff(this.heading, h)) < 0.02;
  }

  /** Distance to another entity or point. */
  distTo(o) {
    return dist(this.x, this.z, o.x, o.z);
  }

  // ------------------------------------------------------------ health

  /**
   * @param {number} amount
   * @param {any} [source] entity responsible
   * @param {string} [cause] 'shot' | 'knife' | 'explosion' | …
   */
  takeDamage(amount, source = null, cause = 'damage') {
    if (!this.alive || amount <= 0) return;
    if (this.faction === 'player' && this.world?.debug?.invulnerable) return; // ?debug inspection option
    this.hp = Math.max(0, this.hp - amount);
    if (this.faction === 'player' && this.world) this.world.stats.damageTaken += amount;
    this.world?.events.emit('unit:damaged', { unit: this, amount, source, cause });
    if (this.hp <= 0) this.die(cause, source);
  }

  /** Heal up to maxHp. */
  heal(amount) {
    if (!this.alive) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /**
   * Kill this unit. The body stays in the world (alive = false, state 'dead').
   * @param {string} [cause]
   * @param {any} [killer]
   */
  die(cause = 'damage', killer = null) {
    if (!this.alive) return;
    // the death clip falls forward from a run (die_run), backward from a stand / walk (placement rule e)
    const fall = /^(run|sprint|walk_fast)/.test(this._anim || '') ? 1 : /^(crawl|prone|swim)/.test(this._anim || '') ? 0 : -1;
    this.alive = false;
    this.hp = 0;
    this.state = 'dead';
    this.killer = killer;
    this.deathCause = cause;
    this.deathTime = this.world ? this.world.time : 0;
    this.stop();
    this._animOverride = null;
    this._setAnim('die', { loop: false });
    const w = this.world;
    // placement rule (e): the body lies clear of walls / buildings (slides ≤ 1.2 m off them, same surface)
    if (w?.grid && !this.vehicle && this.state === 'dead') {
      // …and falls away from a wall / deck edge in front of it (the corpse turns, its spot stays)
      const fh = fallHeading(w.grid, this.x, this.z, this.heading, 1.6, fall);
      if (fh !== this.heading) { this.heading = fh; this.prevHeading = fh; }
      const to = settleBody(w.grid, this.x, this.z);
      if (to) { this.x = to.x; this.z = to.z; }
      // …and clear of the standing visuals the nav grid does not see (stakes along a wall walk, railings)
      const off = settleSolid(w.grid, this.x, this.z, this.heading, { likely: fall });
      if (off) { this.x = off.x; this.z = off.z; }
      // …and never under a vehicle hull (world/body-clearance.js); a man run over lies where the wheels caught him
      if (cause !== 'runover' && cause !== 'train' && hasObstacles(w) && bodyGap(w, this.x, this.z, this.heading, 'dead') < STOP_MARGIN) {
        const cp = clearPose(w, this.x, this.z, this.heading, 'dead', { sweep: false, maxDist: 1.5 });
        if (cp) { this.x = cp.x; this.z = cp.z; this.heading = cp.heading; this.prevHeading = cp.heading; }
      }
    }
    if (w) {
      if (this.faction === 'enemy' && killer?.faction === 'player') {
        w.stats.kills++;
        if (cause === 'knife') w.stats.knifeKills++;
      }
      w.events.emit('unit:killed', { unit: this, killer, cause });
    }
  }

  // ------------------------------------------------------------ animation

  _setAnim(name, opts) {
    if (this._anim === name) return;
    this._anim = name;
    this.model.setAnim?.(name, opts || { loop: name !== 'die' });
  }

  /**
   * Play a one-shot animation that overrides locomotion for `duration` seconds (abilities use this).
   * @param {string} name e.g. 'stab', 'shoot', 'throw'
   */
  playAction(name, duration) {
    this._animOverride = { name, t: duration };
    this._anim = null;
    this._setAnim(name, { loop: false, restart: true });
  }

  _updateAnim(dt) {
    if (!this.alive) {
      if (this._anim === 'die' && this.world && this.world.time - this.deathTime > 1.2) this._setAnim('dead');
      return;
    }
    if (this._animOverride) {
      this._animOverride.t -= dt;
      if (this._animOverride.t > 0) return;
      this._animOverride = null;
    }
    let name;
    const moving = this._moving;
    switch (this.stance) {
      case 'crawl': name = moving ? 'crawl' : 'crawl_idle'; break;
      case 'downed': name = moving ? 'downed_crawl' : this.reviving ? 'revive_receive' : 'downed_idle'; break;
      case 'swim': name = 'swim'; break;
      case 'dive': name = 'dive'; break;
      // a commando holding a load keeps its carry / drag clip (Commando._holdAnim): never walk ⇄ carry_walk per tick
      default: name = this._holdAnim?.(moving) || (moving ? (this.moveMode === 'run' ? 'run' : 'walk') : this.idleAnim || 'idle');
    }
    this._setAnim(name);
  }

  // ------------------------------------------------------------ update

  /** Fixed-step update: movement along the path, footsteps, animation state. */
  update(dt) {
    if (!this.alive) {
      this._updateAnim(dt);
      return;
    }
    this._moving = false;
    this.vx = 0; this.vz = 0; this.trackV = 0;
    if (this._stanceT > 0) {
      this._stanceT -= dt;
    } else if (this.path && (this.state === 'active' || this.state === 'hidden' || this.state === 'captured' || this.state === 'downed')) {
      this._followPath(dt);
    } else if (!this.path && this.world) {
      if (this.world.tick % 15 === 0) this._settle();
      if (!this.path) this._nudge(dt);
    }
    this._walkAnim = this._moving;
    this._guardBody(dt);
    if (!this._moving) this._runNoiseD = null; // a new run starts its running-noise counter afresh
    this._updateAnim(dt);
  }

  /**
   * Body vs solid obstacles (world/body-clearance.js: vehicle hulls, wrecks, drums, pushables, crates, rocks), once
   * per step after every writer of x / z / heading (path following, actions, the brain): a step or a turn that would
   * push the body (a crawler's legs and head too) deeper into one is undone, sliding without the turn, pivoting about
   * the front or sliding along the obstacle (the step turned up to 70°) when that keeps him clear. Lying down next to
   * one turns him parallel to it. A path blocked that way re-plans after 0.5 s (a vehicle parked in the way since)
   * and gives up after three tries. A vehicle or a pushed wagon that moved into him is its own business.
   */
  _guardBody(dt) {
    const w = this.world;
    const P = this._bodyPrev;
    const st = this.stance;
    const skip = !hasObstacles(w) || !this.alive || HIDDEN_STATES.has(this.state) || this.vehicle || this.y > 1
      || st === 'swim' || st === 'dive';
    if (skip) { this._bodyPrev = null; return; }
    const ign = this._bodyIgnore();
    const g = bodyGap(w, this.x, this.z, this.heading, st, ign);
    const keep = () => { this._bodyPrev = { x: this.x, z: this.z, heading: this.heading, stance: this.stance }; };
    if (g === Infinity) { this._bodyBlockT = 0; return keep(); }
    if (P && P.stance !== st && g < STOP_MARGIN) {
      // lying down (or getting up) here: the body falls along the heading, so pick the nearest clear one
      const cp = clearPose(w, this.x, this.z, this.heading, st, { sweep: false, maxDist: 1.5, ignore: ign });
      if (cp) { this.x = cp.x; this.z = cp.z; this.heading = cp.heading; this.prevHeading = cp.heading; }
      return keep();
    }
    if (g >= MOVE_MARGIN || !P) return keep();
    // a jump no step makes (setPosition, a script or a load placing him): not a step to undo — placed inside a solid,
    // he is put at the nearest pose clear of it
    if (Math.hypot(this.x - P.x, this.z - P.z) > 1.5) {
      const cp = g < 0 && clearPose(w, this.x, this.z, this.heading, st, { sweep: false, maxDist: 1.5, ignore: ign });
      if (cp) { this.x = cp.x; this.z = cp.z; this.heading = cp.heading; this.prevHeading = cp.heading; }
      return keep();
    }
    const gPrev = bodyGap(w, P.x, P.z, P.heading, st, ign);
    if (g >= gPrev - 1e-3) return keep(); // not deeper (a vehicle came to him, or he is getting out)
    const need = Math.min(MOVE_MARGIN, gPrev);
    const c = Math.cos(P.heading), s = Math.sin(P.heading), front = st === 'crawl' || st === 'downed' ? 0.6 : 0;
    const cands = [
      [this.x, this.z, P.heading, true],
      // a prone traverse rotates about the elbows: the legs sweep, the chest stays (crawl-animation.md §3.6)
      [P.x + c * front - Math.cos(this.heading) * front, P.z + s * front - Math.sin(this.heading) * front, this.heading, false],
      [P.x, P.z, this.heading, false],
    ];
    // sliding along it: the same step turned 35° / 70° either way (lying down the body turns with it); not for
    // ever — 3 s of sliding without getting 0.3 m nearer the goal and he counts as blocked (re-plan)
    const sx = this.x - P.x, sz = this.z - P.z, sl = Math.hypot(sx, sz), mt = this.moveTarget;
    const pr = this._bodyProg;
    if (sl > 1e-4 && this.path && mt && !(pr && pr.t > 3)) {
      for (const a of [0.61, -0.61, 1.22, -1.22]) {
        const ca = Math.cos(a), sa = Math.sin(a), dx = sx * ca - sz * sa, dz = sx * sa + sz * ca;
        cands.push([P.x + dx, P.z + dz, front ? Math.atan2(dz, dx) : this.heading, true, true]);
      }
    }
    let pick = null;
    for (const [x, z, h, moved, slide] of cands) {
      if (moved || front) { if (!w.grid.walkableAt(x, z)) continue; }
      if (slide && !w.grid.walkableLine?.(P.x, P.z, x, z)) continue;
      if (bodyGap(w, x, z, h, st, ign) >= need) { pick = [x, z, h, moved, slide]; break; }
    }
    if (pick?.[4]) {
      const d = Math.hypot(mt.x - pick[0], mt.z - pick[1]);
      if (!pr || d < pr.best - 0.3) this._bodyProg = { best: d, t: 0 }; else pr.t += dt;
    }
    const blockedMove = !pick || !pick[3];
    if (pick) { this.x = pick[0]; this.z = pick[1]; this.heading = pick[2]; } else { this.x = P.x; this.z = P.z; this.heading = P.heading; }
    const t = this.moveTarget;
    if (blockedMove && this.path && t && Math.hypot(t.x - this.x, t.z - this.z) < 1.2) {
      this._arrive(); // the hull is in the way of his last steps: he stops here (and settles clear of it)
    } else if (blockedMove && this.path && (Math.hypot(this.x - P.x, this.z - P.z) < 1e-4)) {
      this._bodyBlockT = (this._bodyBlockT || 0) + dt;
      if (this._bodyBlockT > 0.5) {
        this._bodyBlockT = 0;
        this._bodyRepaths = (this._bodyRepaths || 0) + 1;
        const cb = this._onArrive, run = this.moveMode === 'run', n = this._bodyRepaths;
        if (n > 3 || !t || !this.moveTo(t.x, t.z, { run, onArrive: cb })) {
          this.stop();
          this._bodyRepaths = 0;
          const cp = st === 'crawl' || st === 'downed' ? clearPose(w, this.x, this.z, this.heading, st, { maxDist: 0, ignore: ign }) : null;
          if (cp) this.heading = cp.heading; // given up: at least lie clear of it where he is
        }
        else this._bodyRepaths = n;
      }
    }
    keep();
  }

  _followPath(dt) {
    const w = this.world;
    // Re-path if the grid changed under us (door closed, bridge destroyed…).
    if (w && this._pathGridVersion !== w.grid.version && this.moveTarget) {
      const t = this.moveTarget, cb = this._onArrive, run = this.moveMode === 'run';
      if (!this.moveTo(t.x, t.z, { run, onArrive: cb })) {
        this.stop();
        return;
      }
    }
    // local avoidance (avoidance.js): plan on the actual position, walk the path track, layer the lane on top
    const x0 = this.x, z0 = this.z;
    const av = this._avoidPlan(dt);
    if (av?.arrive) { this._arrive(); this._settle(); return; } // (stopped inside a man: a step off him)
    const lx0 = this._laneX + this._curveX, lz0 = this._laneZ + this._curveZ, cx0 = this._curveX, cz0 = this._curveZ;
    this.x -= lx0; this.z -= lz0; this._curveX = this._curveZ = 0;
    this._trackOff = { x: lx0, z: lz0 }; // (an arrival this step puts it back: _arrive)
    let step = this.speed * dt * this._avScale;
    this.trackV = step / dt; // pace along the path (route progress; the lane and curve ride on top)
    const stride = step, running = this.moveMode === 'run'; // (an arrival this step resets moveMode / path)
    let dirX = 0, dirZ = 0;
    const sp = this.path.length === 1 && this.path[0].steer ? this.path[0] : null;
    if (sp && step > 1e-9) { // steering at a moving slot: the walk direction turns at a body's rate (no kinks)
      const dx = sp.x - this.x, dz = sp.z - this.z, d = Math.hypot(dx, dz);
      let mx = this._mdirX, mz = this._mdirZ;
      if (d > 1e-6) {
        const tx = dx / d, tz = dz / d;
        if (!(mx || mz) || d < 0.25) { mx = tx; mz = tz; } else {
          const ang = Math.atan2(mx * tz - mz * tx, mx * tx + mz * tz), lim = CONFIG.units.avoid.steerTurn * dt;
          const a = Math.max(-lim, Math.min(lim, ang)), c = Math.cos(a), s2 = Math.sin(a);
          [mx, mz] = [mx * c - mz * s2, mx * s2 + mz * c];
        }
        this._mdirX = mx; this._mdirZ = mz; dirX = mx; dirZ = mz;
        if (d <= step && mx * dx + mz * dz > 0.9 * d) { this.x = sp.x; this.z = sp.z; this._arrive(); }
        else { this.x += mx * Math.min(step, d); this.z += mz * Math.min(step, d); }
      } else this._arrive();
      step = 0;
    } else { this._mdirX = 0; this._mdirZ = 0; }
    while (step > 1e-9 && this.path) {
      const wp = this.path[this.pathIndex];
      const dx = wp.x - this.x, dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) { dirX = dx / d; dirZ = dz / d; }
      if (d <= step) {
        this.x = wp.x;
        this.z = wp.z;
        if (wp.y !== undefined) this.y = wp.y;
        step -= d;
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) {
          this._arrive();
          break;
        }
      } else {
        this.x += (dx / d) * step;
        this.z += (dz / d) * step;
        step = 0;
      }
    }
    if (!dirX && !dirZ && av) { dirX = av.fx; dirZ = av.fz; }
    if (this._trackOff) { // (no arrival this step: an arrival baked the lane into where he stopped, _arrive)
      this._trackOff = null;
      if (this.path) {
        this._applyCurve(dt);
        // a curve that ends abruptly (a re-path mid-corner, a patrol's next leg) hands its offset to the lane, which
        // eases it out: the body never jumps
        if (Math.hypot(this._curveX - cx0, this._curveZ - cz0) > 0.02) { this._laneX += cx0 - this._curveX; this._laneZ += cz0 - this._curveZ; }
        this._applyLane(av, dt);
      } else { this.x += lx0; this.z += lz0; }
    }
    this.vx = (this.x - x0) / dt; this.vz = (this.z - z0) / dt;
    // waiting: he shows walking while he still moves (hysteresis — a pace hovering near zero, or a sidestep while he
    // waits, must not flick walk / idle every few frames)
    const vNow = Math.hypot(this.vx, this.vz);
    this._moving = !av?.wait || (this._walkAnim ? this._avScale > 0.03 || vNow > 0.1 : this._avScale > 0.15 || vNow > 0.3);
    // Surface height (§10.2 elev): raised areas are reached only through links, so snapping is safe.
    // The ABILITIES team animates link traversal (climb/ladder waypoints carry `link`, see findPath).
    // On a stair (grid ramps) he follows its slope rather than the cell steps, and steps on / off it (from the wall walk
    // beside it, the landing, the floor) ease over ~0.15 s instead of snapping a cell's height in one tick.
    // (On arrival he stands at the surface height.)
    if (w) {
      const g = w.grid, e = g.surfaceY ? g.surfaceY(this.x, this.z) : g.elevAt(this.x, this.z);
      if (e > 0 || this.y > 0) {
        const d = e - this.y;
        this.y = this.path && g.ramps && Math.abs(d) > 0.06 && Math.abs(d) <= MAX_STEP + 1e-3 && g.nearRamp(this.x, this.z) ? this.y + Math.sign(d) * Math.min(Math.abs(d), 4 * dt) : e;
      }
    }
    // a sidestep turns the body a little toward it (from the accel-limited lane speed: smooth, no twitch from the
    // lane's clamps); waiting keeps the path heading
    // (a crawler's body follows his edge aside fully: his elbows are planted, a crab would drag them sideways)
    // (from the lane speed low-passed over ~0.2 s: a lane controller dithering by a hair must not wobble the body)
    this._leanV = (this._leanV || 0) + ((this._laneV || 0) - (this._leanV || 0)) * Math.min(1, dt / 0.2);
    if (Math.abs(this._leanV) < 1e-4) this._leanV = 0;
    // (a crawler's body follows his real edge aside, unsmoothed: his elbows are planted, a lagging body slides them)
    const lv = this.stance === 'stand' ? this._leanV : this._laneV;
    const lean = lv && this.trackV > 0.1 ? Math.max(-0.4, Math.min(0.4, (this.stance === 'stand' ? 0.6 : 1) * Math.atan2(lv, this.trackV))) : 0;
    // moveHeadingOffset: a dragger walks backwards (π, bodies-design §C.2); moveTurnRate caps turning with a load
    if (dirX || dirZ) this.heading = turnTowardsAngle(this.heading, Math.atan2(dirZ, dirX) + lean + (this.moveHeadingOffset || 0), (this.moveTurnRate ?? this.turnRate) * dt);
    // Swimmers switch stance automatically in deep water.
    if (this.canSwim && w) {
      const g = w.groundAt(this.x, this.z);
      if (g.water && this.stance !== 'swim' && this.stance !== 'dive') this.setStance('swim');
      else if (!g.water && (this.stance === 'swim' || this.stance === 'dive')) this.setStance('stand');
    }
    // Movement is silent in BEL (§4.4 [manual]; the CLASSIC 1998 house rules keep it so). Footprints (§4.8): every
    // walkStep/runStep metres on SNOW/SAND (and visual-only MUD) a 'footprint' event is emitted; the AI team keeps the
    // gameplay list.
    if (w && this.stance === 'stand') {
      this._footstepT += this.speed * dt;
      const F = CONFIG.stealth.footprint;
      const step = this.moveMode === 'run' ? F.runStep : F.walkStep;
      if (this._footstepT >= step) {
        this._footstepT = 0;
        // groundAt().terrain is the NAME ('snow'); compare the numeric terrainCode with T.* (the payload keeps
        // the name — audio's stepSfx and the trail renderer key on it).
        const g = w.groundAt(this.x, this.z), c = g.terrainCode;
        if (c === T.SNOW || c === T.SAND || c === T.MUD) {
          w.events.emit('footprint', { x: this.x, z: this.z, heading: this.heading, t: w.time, owner: this, aiVisible: (c !== T.MUD || !!w.rules?.mudTracks) && this.faction === 'player' && !this.disguised, terrain: g.terrain }); // §4.8: a disguised Spy's boot prints read as a German's; BCD §1.10: soft paths leave tracks
        }
      }
    }
    // SHADOW SIX house rule runningNoise (§4.4 amendment): a commando running upright is heard by nearby guards
    if (w) runNoiseStep(this, stride - Math.max(0, step), w, running);
  }

  /**
   * This tick's local-avoidance plan (avoidance.js) along the current leg, or null (avoidance off, a link /
   * ladder leg, swimming, downed): then any lane is baked into the track. Also runs the wait ramp and the
   * ghost timer (a man that cannot be got round is walked through after CONFIG.units.avoid.ghostAfter s).
   * @returns {{fx:number, fz:number, shift:number, wait:boolean, calm:boolean, arrive?:boolean}|null}
   */
  _avoidPlan(dt) {
    const A = CONFIG.units.avoid, w = this.world, wp = this.path && this.path[this.pathIndex];
    // (a man getting out of a vehicle's way runs straight there, walkStraight: no waiting on his mates)
    const off = !A.on || !w || !wp || wp.link || this.stance === 'swim' || this.stance === 'dive' || this.state === 'downed' || this.state === 'captured' || this.carriedBy
      || (this._straight && this._straight === this.path);
    const tx = this.x - this._laneX - this._curveX, tz = this.z - this._laneZ - this._curveZ;
    const dx = off ? 0 : wp.x - tx, dz = off ? 0 : wp.z - tz, d = Math.hypot(dx, dz);
    // (the lane is baked into the track by _applyLane(null): zeroing it here would jump the body back onto the track)
    if (off || d < 1e-6) { this._laneV = 0; this._avScale = 1; this._blockT = 0; return null; }
    if (this._ghostIds) { // men he squeezes past: forgotten once he is past them (or after a while: never two men
      // walking on inside each other — the avoidance takes them apart again)
      const old = w.time - (this._ghostT ?? w.time) > 2 * A.ghostAfter;
      this._ghostIds = old ? [] : this._ghostIds.filter((id) => {
        const g = w.byId?.(id);
        if (!g) return false;
        const gx = g.x - this.x, gz = g.z - this.z, gd = Math.hypot(gx, gz);
        return gd <= A.clear + 0.3 || (gd <= A.look && gx * dx + gz * dz > 0); // still beside or ahead of me
      });
      if (!this._ghostIds.length) { this._ghostIds = null; this._ghostT = null; }
    }
    const fx = dx / d, fz = dz / d;
    const side = this._laneSide(fx, fz);
    const pl = avoidPlan(this, fx, fz, this.speed, side ? -Math.sign(side) * Math.min(Math.abs(side), 0.15) : 0);
    // ordered onto a spot a standing man holds: stop beside him (formation) instead of walking into him
    const last = this.pathIndex === this.path.length - 1;
    if (last && pl.block && priority(this) < 3 && Math.hypot(pl.block.x - this.x, pl.block.z - this.z) < A.clear + 0.05
      && Math.hypot(pl.block.x - wp.x, pl.block.z - wp.z) < A.clear) return { fx, fz, arrive: true };
    // sent to a spot another man holds (or reaches first): stop beside it, a body width off
    if (pl.claim && priority(this) !== 3 && Math.hypot(pl.claim.x - this.x, pl.claim.z - this.z) < A.clear + 0.05 && this._pathLeft(3) < 3) return { fx, fz, arrive: true };
    // a standing man ahead whom the lane cannot get round (a doorway, a gap between walls), or the man ahead in a
    // file through one: wait short of him instead of squeezing past through his body — an idle teammate standing
    // in the gap steps aside (Unit._yieldFor), anybody else is walked through after the ghost timer
    let cantPass = false, queued = false;
    const v = this.speed * this._avScale, stopD = (v * v) / (2 * A.brake);
    // (only when his way goes on past the man: stopping short of him needs no room)
    if (pl.block && pl.shift && priority(this) < 4 && pl.blockAhead < A.clear + stopD + 0.25 && this._pathLeft(pl.blockAhead + 1) > pl.blockAhead + 0.5) {
      const at = this._trackAhead(Math.max(0, pl.blockAhead)) || { x: tx, z: tz }, s = side + pl.shift;
      cantPass = !this._laneFits(at.x + this._curveX, at.z + this._curveZ, -fz * s, fx * s);
    }
    if (pl.queue && priority(this) < 4 && pl.queueAhead < A.clear + stopD + 0.1) { // no room beside him: file behind him
      const q = pl.queue, c = A.clear;
      queued = !this._laneFits(q.x, q.z, -fz * c, fx * c) && !this._laneFits(q.x, q.z, fz * c, -fx * c);
    }
    // meeting a man in a gap too narrow to pass (a doorway, a bridge): the one giving way waits where there is
    // room for his lane (it keeps opening while he stands), until the other man is past him
    let held = false;
    if (this._holdFor != null) {
      const h = w.byId?.(this._holdFor);
      const hx = h ? h.x - this.x : 0, hz = h ? h.z - this.z : 0, hd = Math.hypot(hx, hz);
      // released once he is past me, or walking off ahead of me (a file through the gap)
      if (!h || !h.path || hx * fx + hz * fz < 0 || hd > A.look || (hd > A.clear + 0.6 && hx * (h.vx || 0) + hz * (h.vz || 0) > 0)) this._holdFor = null;
      else held = true;
    }
    if (!held && !cantPass && !queued && pl.meetN && pl.shift && priority(this) < 4) {
      // the gap where we meet is too narrow for both half-dodges: one of us holds where he has room for his lane
      // (it keeps opening while he stands) — the man giving way, unless only I have room here
      const n = pl.meetN, s = side + pl.shift, sx = -fz * pl.shift, sz = fx * pl.shift, nt = Math.min(pl.meetT, A.horizon);
      const D = Math.max(0.3, v * nt), nvx = n.vx || 0, nvz = n.vz || 0, nv = Math.hypot(nvx, nvz);
      let narrow = false; // anywhere between here and where we meet (a doorway on the way)
      for (let d = Math.min(0.5, D); !narrow && d <= D + 1e-6; d += 0.5) {
        const at = this._trackAhead(d) || { x: tx, z: tz }, k = nv > 1e-6 ? Math.min(d, nv * nt) / nv : 0;
        narrow = !this._laneFits(at.x + this._curveX, at.z + this._curveZ, -fz * s, fx * s) || (!!n._laneFits && !n._laneFits(n.x + nvx * k, n.z + nvz * k, -sx, -sz));
      }
      if (narrow && this._laneFits(this.x, this.z, sx, sz) && (givesWay(this, n) || (n._laneFits && !n._laneFits(n.x, n.z, -sx, -sz)))) { this._holdFor = n.id; held = true; }
    }
    if (cantPass && pl.block._yieldFor?.(this)) this._holdFor = pl.block.id;
    // a standing man right ahead and not yet beside me (setting off next to him): stand while the lane opens
    const tight = this.stance === 'stand' && !!pl.block && pl.blockAhead > 0 && pl.blockAhead < A.clear && Math.abs((pl.block.x - this.x) * -fz + (pl.block.z - this.z) * fx) < 0.9 * A.clear;
    const stuck = pl.wait || cantPass || tight || (pl.block && Math.abs(this._laneSide(fx, fz)) >= A.laneMax - 1e-3);
    this._blockT = stuck ? this._blockT + dt : 0;
    // held up a while by teammates standing round him (a formation he has to cross): one of them steps aside
    // before he would walk through them
    // (and he waits for him to get clear)
    if (stuck && this._blockT > 0.5) for (const b of pl.blockers) if (!b.path && b._yieldFor?.(this)) { this._blockT = 0; this._holdFor = b.id; break; }
    // (never a man standing on the spot I am sent to: I stop beside him — walking through him would end on top of him)
    if (this._blockT > A.ghostAfter) {
      const end = this.path[this.path.length - 1];
      // (and only men standing in the way: a man on the move gets out of it — squeezing past a runner is running inside him)
      const ghost = pl.blockers.filter((n) => Math.hypot(n.vx || 0, n.vz || 0) <= A.moving && (end.steer || Math.hypot(n.x - end.x, n.z - end.z) >= A.clear)).map((n) => n.id);
      this._ghostIds = [...new Set([...(this._ghostIds || []), ...ghost])]; this._blockT = 0; this._ghostT = w.time;
    }
    const want = pl.wait || cantPass || queued || held || tight ? 0 : pl.slow ? A.dropBack : 1;
    // braking is a walker's (≤ CONFIG.units.avoid.brake m/s²), not a car's: no hard stop on a dodge or a wait
    this._avScale = want > this._avScale ? Math.min(want, this._avScale + 3 * dt) : Math.max(want, this._avScale - Math.min(5, A.brake / Math.max(0.3, this.speed)) * dt);
    // a patrol dodging a man who stands by its waypoint keeps the lane open to the end (the lane is baked in)
    return { fx, fz, shift: pl.shift, wait: want === 0, calm: pl.calm, hold: (!!pl.block || !pl.calm) && priority(this) === 4 }; // (wait: any stop — the gait stops with him)
  }

  /** Round the corner ahead / behind (path-curve.js): a stateless offset off the track, kept on walkable ground. */
  _applyCurve(dt = 1 / 60) {
    const A = CONFIG.units.avoid;
    if (!A.on || !A.cornerR || !this.world || this.stance === 'swim' || this.stance === 'dive' || (this.y || 0) > 0.3) return; // (raised: see _applyLane)
    const o = cornerOffset(this.path, this.pathIndex, null, this.x, this.z, A.cornerR);
    if (!o) return;
    // by a wall: as much of the curve as fits, the share eased at 3/s (all or nothing would pop it on and off frame
    // to frame: a one-frame sideways hop)
    let f = 1;
    while (f > 0 && !this._laneFits(this.x, this.z, o.x * f, o.z * f)) f = Math.max(0, f - 0.25);
    const f0 = this._curveF ?? 1;
    this._curveF = Math.hypot(o.x, o.z) < 0.01 ? f : f > f0 ? Math.min(f, f0 + 3 * dt) : Math.max(f, f0 - 3 * dt);
    if (!this._curveF) return;
    this._curveX = o.x * this._curveF; this._curveZ = o.z * this._curveF;
    this.x += this._curveX; this.z += this._curveZ;
  }

  /**
   * Can the body stand offset (ax, az) from the track point (px, pz)? The line out to it, a body radius
   * (CONFIG.units.avoid.wallR) beyond it and 0.3 m either side of it must be walkable ground on his level.
   */
  _laneFits(px, pz, ax, az) {
    const L = Math.hypot(ax, az);
    if (L < 1e-6) return true;
    const g = this.world.grid, k = 1 + CONFIG.units.avoid.wallR / L;
    return g.walkableLine(px, pz, px + ax * k, pz + az * k, { clearance: 0.3, dynamic: true, elevRef: g.elevAt(px, pz) });
  }

  /** Path length (m) still to walk from his track point, counted up to `cap`. */
  _pathLeft(cap = Infinity) {
    const P = this.path;
    if (!P) return 0;
    let x = this.x - this._laneX - this._curveX, z = this.z - this._laneZ - this._curveZ, L = 0;
    for (let i = this.pathIndex; i < P.length && L < cap; i++) { L += Math.hypot(P[i].x - x, P[i].z - z); x = P[i].x; z = P[i].z; }
    return L;
  }

  /** The point `d` m further along his path from where he is (stops at a link leg / the end), or null. */
  _trackAhead(d) {
    const P = this.path;
    if (!P || d <= 0) return null;
    let x = this.x, z = this.z, left = d;
    for (let i = this.pathIndex; i < P.length && left > 1e-6; i++) {
      const wp = P[i];
      if (wp.link) break;
      const dd = Math.hypot(wp.x - x, wp.z - z);
      if (dd >= left) { x += (wp.x - x) * (left / dd); z += (wp.z - z) * (left / dd); left = 0; break; }
      x = wp.x; z = wp.z; left -= dd;
    }
    return { x, z };
  }

  /**
   * A man standing in the way of a mate who cannot get round him (a doorway, a gap between walls) steps aside — an
   * idle commando, or a calm enemy (YIELD_STATES): to the nearest free spot (0.5–2.5 m off) a body width clear of the walker's way ahead.
   * @returns {boolean} he is stepping aside
   */
  _yieldFor(u) {
    const w = this.world, A = CONFIG.units.avoid, g = w?.grid;
    if (!g || this.path || !u.path || this.faction !== u.faction || this.state !== 'active' || (this.y || 0) > 0.3) return false; // (raised: see _applyLane)
    // an enemy steps aside only standing calm (on his post, a halt, a search stop) — never one aiming or fighting
    if (this.faction !== 'player' && !YIELD_STATES.has(this.brain?.state)) return false;
    if ((this.stance !== 'stand' && this.stance !== 'crouch') || this.pendingAbility || this.carrying || this.carriedBy) return false;
    if (this._yieldAt != null && w.time - this._yieldAt < 1) return false;
    this._yieldAt = w.time;
    // the walker's way: from his track point along his path, 6 m
    const way = [[u.x - (u._laneX || 0) - (u._curveX || 0), u.z - (u._laneZ || 0) - (u._curveZ || 0)]]; // (his track, not his dodge)
    for (let i = u.pathIndex, L = 0; i < u.path.length && L < 6; i++) { const p = u.path[i], q = way[way.length - 1]; L += Math.hypot(p.x - q[0], p.z - q[1]); way.push([p.x, p.z]); }
    const offWay = (x, z) => {
      let m = Infinity;
      for (let i = 1; i < way.length; i++) {
        const [ax, az] = way[i - 1], [bx, bz] = way[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        m = Math.min(m, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
      return m;
    };
    const fx = way[1] ? way[1][0] - way[0][0] : 1, fz = way[1] ? way[1][1] - way[0][1] : 0, fl = Math.hypot(fx, fz) || 1;
    const o = { clearance: 0.3, dynamic: true, elevRef: g.elevAt(this.x, this.z) };
    const others = w.entitiesInRadius(this.x, this.z, 3).filter((n) => n !== this && blocks(this, n));
    let best = null;
    for (const r of [0.5, 0.8, 1.1, 1.5, 2.0, 2.5]) {
      for (const a of [90, 60, 120, 45, 135, 30, 150]) for (const sg of [1, -1]) {
        const c = Math.cos((a * Math.PI) / 180), sn = Math.sin((a * Math.PI) / 180) * sg;
        const dx = (fx / fl) * c - (fz / fl) * sn, dz = (fz / fl) * c + (fx / fl) * sn; // a° off the walker's heading
        const x = this.x + dx * r, z = this.z + dz * r;
        // off his way, and away from him (stepping aside is never a step into the man he makes room for)
        if (offWay(x, z) < A.clear + 0.15 || Math.hypot(x - u.x, z - u.z) < Math.hypot(this.x - u.x, this.z - u.z) + 0.3 || !g.walkableLine(this.x, this.z, x, z, o) || fireStep(w, this.x, this.z, x, z)) continue;
        if (w.entitiesInRadius(x, z, A.clear).some((n) => n !== this && blocks(this, n))) continue;
        // nor a step towards anybody else close by (on the way there either)
        if (others.some((n) => { const d0 = Math.hypot(n.x - this.x, n.z - this.z); return Math.hypot(n.x - x, n.z - z) < d0 || [0.25, 0.5, 0.75].some((k) => Math.hypot(n.x - this.x - (x - this.x) * k, n.z - this.z - (z - this.z) * k) < Math.min(d0, A.clear)); })) continue;
        best = { x, z }; break;
      }
      if (best) break;
    }
    return !!best && !!this.moveTo(best.x, best.z);
  }

  /**
   * Standing inside another standing man (two men stopped on one spot — a pile on a chase point, two men sent to one
   * post): the one giving way (avoidance.givesWay) takes a short step to the nearest free spot (4 Hz check).
   */
  _settle() {
    const A = CONFIG.units.avoid, w = this.world, g = w.grid;
    if (!A.on || this.state !== 'active' || (this.stance !== 'stand' && this.stance !== 'crouch') || this.pendingAbility || this.carrying || this.carriedBy || (this.y || 0) > 0.3) return;
    const on = w.entitiesInRadius(this.x, this.z, 0.8, (n) => n !== this && stopped(n, A, w) && blocks(this, n) && givesWay(this, n));
    if (!on.length) return;
    const n = on[0], ax = this.x - n.x, az = this.z - n.z, al = Math.hypot(ax, az);
    const a0 = al > 1e-3 ? Math.atan2(az, ax) : 0, o = { clearance: 0.3, dynamic: true, elevRef: g.elevAt(this.x, this.z) };
    for (const r of [0.6, 0.9, 1.2]) for (const da of [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
      const a = a0 + (da * Math.PI) / 180, x = n.x + Math.cos(a) * (r + 0.35), z = n.z + Math.sin(a) * (r + 0.35);
      if (!g.walkableLine(this.x, this.z, x, z, o) || fireStep(w, this.x, this.z, x, z)) continue;
      if (w.entitiesInRadius(x, z, 0.9 * A.clear, (q) => q !== this && blocks(this, q)).length) continue;
      if (this.moveTo(x, z)) return;
    }
  }

  /**
   * Still inside a standing man after that (a man held in place by his brain — a shooter, a guard on his post): the
   * one giving way is eased off him at a shuffle's pace (0.6 m/s) until they are a body width apart, on walkable
   * ground on his level only.
   */
  _nudge(dt) {
    const A = CONFIG.units.avoid, w = this.world, g = w.grid;
    if (!A.on || this.state === 'dead' || this.carriedBy || this.vehicle || (this.stance !== 'stand' && this.stance !== 'crouch')) return;
    const on = w.entitiesInRadius(this.x, this.z, 0.6, (n) => n !== this && stopped(n, A, w) && blocks(this, n) && givesWay(this, n));
    if (!on.length) return;
    const n = on[0], ax = this.x - n.x, az = this.z - n.z, al = Math.hypot(ax, az), step = Math.min(0.6 * dt, 0.62 - al);
    let a0 = al > 1e-3 ? Math.atan2(az, ax) : 0;
    const e0 = g.elevAt(this.x, this.z), same = (x, z) => g.walkableAt(x, z, { dynamic: true }) && Math.abs(g.elevAt(x, z) - e0) <= 0.3 && !inFire(w, x, z);
    if ((this.y || 0) > 0.3) { // raised (a wall walk): only along the deck — its nav cells do not see the parapet
      let best = -1, axis = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 8, c = Math.cos(a), sn = Math.sin(a);
        let run = 0;
        for (let r = 0.25; r <= 2; r += 0.25) { if (!same(this.x + c * r, this.z + sn * r) || !same(this.x - c * r, this.z - sn * r)) break; run = r; }
        if (run > best) { best = run; axis = a; }
      }
      a0 = Math.cos(axis) * Math.cos(a0) + Math.sin(axis) * Math.sin(a0) >= 0 ? axis : axis + Math.PI;
      const x = this.x + Math.cos(a0) * step, z = this.z + Math.sin(a0) * step;
      if (same(x, z)) { this.x = x; this.z = z; }
      return;
    }
    for (const da of [0, 45, -45, 90, -90]) {
      const a = a0 + (da * Math.PI) / 180, x = this.x + Math.cos(a) * step, z = this.z + Math.sin(a) * step;
      if (!same(x, z)) continue;
      this.x = x; this.z = z;
      return;
    }
  }

  /** Lateral component (m, + = left of travel fx, fz) of the current lane offset. */
  _laneSide(fx, fz) { return -this._laneX * fz + this._laneZ * fx; }

  /** Move the lane (rate- and accel-limited, kept on walkable ground) and put the body back on track + lane. */
  _applyLane(av, dt) {
    if (!av) { this.x += this._laneX; this.z += this._laneZ; this._laneX = this._laneZ = this._laneV = 0; return; } // baked
    const A = CONFIG.units.avoid, low = this.stance !== 'stand'; // a crawler edges aside slowly, body square to his way
    const maxV = A.laneRate * this.speed * (low ? 0.35 : 1), acc = A.laneAccel * (low ? 0.2 : 1);
    const lx = -av.fz, lz = av.fx;
    let side = this._laneSide(av.fx, av.fz), fwd = this._laneX * av.fx + this._laneZ * av.fz;
    // the lane closes as he nears his goal, so he stops on the spot he was sent to (not a dodge off it): a soft
    // cap the lane is steered inside (accel-limited), a hard one twice as wide only as a backstop
    const end = this.path[this.path.length - 1], lastLeg = this.pathIndex === this.path.length - 1;
    const dEnd = lastLeg && !end.steer ? Math.hypot(end.x - this.x, end.z - this.z) : Infinity;
    // (not while a patrol is still dodging a man by its waypoint, or closing would walk it into him: it stops off the spot)
    const keep = av.hold;
    // on raised ground (a wall walk, a dam, a bridge deck: elev > 0.3 m) he keeps to the walk's middle — the nav cells
    // of a narrow deck do not see its parapet, a lane would push him into it
    const raised = (this.y || 0) > 0.3;
    const soft = raised ? 0 : keep ? A.laneMax : Math.min(A.laneMax, 0.3 * dEnd), cap = raised ? 0 : keep ? A.laneMax : Math.min(A.laneMax, 0.6 * dEnd);
    let want = 0;
    if (av.shift && !raised) want = Math.sign(av.shift) * Math.min(maxV, Math.sqrt(2 * acc * Math.abs(av.shift)));
    else if (Math.abs(side) > 1e-4 && av.calm) want = -Math.sign(side) * Math.min(maxV * 0.6, Math.sqrt(2 * acc * Math.abs(side)));
    if (Math.abs(side) > soft && av.calm) want = -Math.sign(side) * Math.min(maxV, Math.max(Math.abs(want), (Math.abs(side) - soft) * 3 + 0.3 * this.speed));
    // brake before the lane limit instead of stopping dead on it (a lateral stop reads as a hitch)
    if (want * side > 0 && Math.abs(side) > soft - 0.3) want = Math.sign(want) * Math.min(Math.abs(want), Math.sqrt(2 * acc * Math.max(0, soft - Math.abs(side))));
    const dv = acc * dt;
    this._laneV = Math.max(this._laneV - dv, Math.min(this._laneV + dv, want));
    side += this._laneV * dt;
    // the backstop closes the lane at a quick sidestep (CONFIG.units.avoid.laneOut m/s), never in one jump
    if (Math.abs(side) > cap) { const t = Math.max(cap, Math.abs(side) - A.laneOut * dt); side = Math.sign(side) * t; if (this._laneV * side > 0) this._laneV = 0; }
    if (Math.abs(side) < 1e-4 && !want) { side = 0; this._laneV = 0; }
    // corner residue (a lateral lane that the turn made fore/aft): eases out, never fast enough to stall or rush him
    if (fwd * fwd > 1e-8) fwd = Math.sign(fwd) * Math.max(0, Math.abs(fwd) - Math.min(Math.abs(fwd) / 0.8, 0.25 * this.speed) * dt);
    else fwd = 0;
    let nx = lx * side + av.fx * fwd, nz = lz * side + av.fz * fwd;
    const ox = this._laneX, oz = this._laneZ;
    if (nx || nz || ox || oz) {
      // a wall, water, a vehicle or a ledge here or half a second on (body radius kept clear of it): the lane is
      // cut back to what fits — at a sidestep's pace, never in one jump (a lane jump reads as a twitch)
      const ah = this._trackAhead(Math.min(1.2, 0.5 * this.speed * this._avScale));
      const ok = (f) => this._laneFits(this.x, this.z, nx * f, nz * f) && (!ah || this._laneFits(ah.x, ah.z, nx * f, nz * f));
      let f = 1;
      while (f > 0 && !ok(f)) f = Math.max(0, f - 0.1);
      if (f < 1) {
        const hard = !this._laneFits(this.x, this.z, ox, oz); // already too close: ease out quicker, still no jump
        const lim = (hard ? A.laneOut : Math.max(maxV, 0.6)) * dt;
        // (sideways at most `lim`; along his way less — that part adds to his pace: a lurch)
        const dx = nx * f - ox, dz = nz * f - oz, fl = Math.min(lim, 0.3 * this.speed * dt);
        const dLat = Math.max(-lim, Math.min(lim, dx * lx + dz * lz)), dFwd = Math.max(-fl, Math.min(fl, dx * av.fx + dz * av.fz));
        nx = ox + lx * dLat + av.fx * dFwd; nz = oz + lz * dLat + av.fz * dFwd;
        this._laneV = Math.max(-maxV, Math.min(maxV, dLat / dt)); // the lean follows the real sidestep
      }
    }
    this._laneX = nx; this._laneZ = nz;
    this.x += nx; this.z += nz;
  }

  /** Standing still: the lane offset becomes part of the position (no path track any more). */
  _bakeLane() { this._laneX = this._laneZ = this._laneV = this._curveX = this._curveZ = 0; this._avScale = 1; this._blockT = 0; this._holdFor = null; }

  _arrive() {
    this._bakeLane();
    // arriving mid-step (_followPath walks the bare track): the lane / curve offset becomes part of where he stops now,
    // so whatever runs from here (the settle below, an onArrive re-path) starts from his body
    const off = this._trackOff;
    if (off) { this._trackOff = null; this.x += off.x; this.z += off.z; }
    // a man lying down stops with the whole body clear of vehicle hulls: turned parallel in place when the turn
    // sweeps clear, else a short crawl to the nearest free spot first
    const w = this.world, st = this.stance;
    if (!this._settled && (st === 'crawl' || st === 'downed') && hasObstacles(w) && !(this.y > 1)
      && bodyGap(w, this.x, this.z, this.heading, st, this._bodyIgnore()) < STOP_MARGIN) {
      this._settled = true;
      const cp = clearPose(w, this.x, this.z, this.heading, st, { maxDist: 1.5 });
      if (cp && !cp.moved) this.heading = cp.heading;
      else if (cp) {
        this.path = [{ x: this.x, z: this.z }, { x: cp.x, z: cp.z }];
        this.pathIndex = 1;
        this.moveTarget = this.path[1];
        this._settleHeading = cp.heading;
        return;
      }
    }
    if (this._settleHeading != null) {
      const h = this._settleHeading;
      this._settleHeading = null;
      if (w && bodyGap(w, this.x, this.z, h, st) >= bodyGap(w, this.x, this.z, this.heading, st)) this.heading = h;
    }
    this._bodyRepaths = 0;
    const cb = this._onArrive;
    this.path = null;
    this.moveTarget = null;
    this._onArrive = null;
    this.moveMode = 'walk';
    cb?.(this);
  }

  /** Per-frame visual update (real time; dt = 0 while paused). */
  renderUpdate(dt) {
    this.model.update?.(dt, this);
  }

  // ------------------------------------------------------------ persistence

  serialize() {
    return {
      ...super.serialize(),
      faction: this.faction,
      role: this.role,
      hp: this.hp,
      maxHp: this.maxHp,
      stance: this.stance,
      moveMode: this.moveMode,
      state: this.state,
      path: this.path ? this.path.map((p) => (p.steer ? { x: p.x, z: p.z, steer: true } : { x: p.x, z: p.z })) : null,
      pathIndex: this.pathIndex,
      // step counters (footprints, running noise): a load mid-run keeps the same steps as the run it interrupted
      ...(this._footstepT ? { footstepT: this._footstepT } : null),
      ...(this._runNoiseD != null ? { runNoiseD: this._runNoiseD } : null),
      deathCause: this.deathCause,
      deathTime: this.deathTime,
      bodyNoticed: !!this.bodyNoticed,
      hiddenBody: !!this.hiddenBody,
      held: this.held, buried: this.buried, disguised: this.disguised, underwater: this.underwater, hidden: this.hidden,
      carriedBy: this.carriedBy ? this.carriedBy.id : null,
      ...(this._laneX || this._laneZ || this._curveX || this._curveZ || this.vx || this.vz || this._avScale !== 1 || this._ghostIds || this._blockT || this._mdirX || this._mdirZ || this._holdFor != null || this._yieldAt != null || this._leanV || this.trackV || this._curveF != null
        ? { avoid: [this._laneX, this._laneZ, this._laneV, this._avScale, this.vx, this.vz, this._blockT, this._ghostIds, this._curveX, this._curveZ, this._mdirX, this._mdirZ, this._holdFor, this._yieldAt, this._ghostT, this._leanV, this.trackV, this._curveF ?? null] } : null),
      // bodies-design §A.4 / §D.1 (optional): the settled ragdoll pose + flags
      ...(this.bodyPose ? { bodyPose: this.bodyPose } : null),
      ...(this.settled ? { settled: true } : null),
      ...(this.sunk ? { sunk: true } : null),
    };
  }

  deserialize(d) {
    super.deserialize(d);
    this.hp = d.hp;
    this.maxHp = d.maxHp;
    this.stance = d.stance;
    this.moveMode = d.moveMode;
    this.state = d.state;
    this.path = d.path;
    this.pathIndex = d.pathIndex;
    [this._laneX, this._laneZ, this._laneV, this._avScale, this.vx, this.vz, this._blockT, this._ghostIds, this._curveX = 0, this._curveZ = 0, this._mdirX = 0, this._mdirZ = 0, this._holdFor = null, this._yieldAt = null, this._ghostT = null, this._leanV = 0, this.trackV = 0, this._curveF = null] = d.avoid || [0, 0, 0, 1, 0, 0, 0, null];
    if (this._curveF == null) this._curveF = undefined; // (never curved yet: eases in from full, as on a fresh start)
    this._footstepT = d.footstepT ?? 0;
    this._runNoiseD = d.runNoiseD ?? null;
    this.moveTarget = d.path ? d.path[d.path.length - 1] : null;
    this._onArrive = null;
    this._pathGridVersion = this.world ? this.world.grid.version : -1;
    this.deathCause = d.deathCause;
    this.deathTime = d.deathTime;
    this.bodyNoticed = !!d.bodyNoticed;
    this.hiddenBody = !!d.hiddenBody;
    this.held = !!d.held; this.buried = !!d.buried; this.disguised = !!d.disguised;
    this.underwater = !!d.underwater; this.hidden = !!d.hidden;
    /** Entity id of the carrier; resolved to the entity lazily by whoever needs it (world.byId). */
    this._carriedById = d.carriedBy ?? null;
    this.bodyPose = d.bodyPose ?? null;
    this.settled = !!d.settled;
    this.sunk = !!d.sunk;
    this._rd = null;
    this._anim = null;
    this._animOverride = null;
    if (!this.alive) this._setAnim('dead');
  }
}
