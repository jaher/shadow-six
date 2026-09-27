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
import { T } from '../world/grid.js';

const LOW_STANCES = new Set(['crawl', 'swim', 'dive']);
/** Every Unit.state value (§10.4 #2). BEL never enters 'stunned'/'bound' (BCD rulesets only). */
export const UNIT_STATES = Object.freeze(['active', 'dead', 'stunned', 'hidden', 'inVehicle', 'carried', 'busy', 'bound', 'held', 'captured', 'jailed']);
/** States in which cones can never see the unit. */
/** States in which the unit cannot be ordered to move (captured units are walked by their escort). */
const IMMOBILE_STATES = new Set(['dead', 'inVehicle', 'carried', 'stunned', 'bound', 'jailed']);
const HIDDEN_STATES = new Set(['hidden', 'inVehicle', 'carried', 'jailed']);

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
    /** @type {{x:number, z:number}[] | null} */
    this.path = null;
    this.pathIndex = 0;
    this.moveTarget = null;
    this.canSwim = false;
    this.turnRate = CONFIG.units.turnRate;
    this.speedMul = 1;
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
    if (this.stance === 'crawl') s = U.crawl;
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
    const path = this.world.findPath(this.x, this.z, x, z, this.pathQuery());
    if (!path) return false;
    this.path = path;
    this.pathIndex = path.length > 1 ? 1 : 0;
    this.moveTarget = path[path.length - 1];
    this.moveMode = run && this.stance === 'stand' ? 'run' : 'walk';
    this._onArrive = onArrive;
    this._pathGridVersion = this.world.grid.version;
    if (this.state === 'hidden') this.state = 'active';
    return true;
  }

  /** Options for this unit's NavGrid path queries (World.findPath); subclasses add restrictions. */
  pathQuery() {
    return { swim: this.canSwim, role: this.role };
  }

  /** Stop moving (keeps stance). */
  stop() {
    this.path = null;
    this.pathIndex = 0;
    this.moveTarget = null;
    this._onArrive = null;
  }

  /**
   * Change stance. Standing up / lying down takes CONFIG.units.stanceChangeTime.
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
    if ((prev === 'stand' && stance === 'crawl') || (prev === 'crawl' && stance === 'stand')) this._stanceT = CONFIG.units.stanceChangeTime;
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
      case 'swim': name = 'swim'; break;
      case 'dive': name = 'dive'; break;
      default: name = moving ? (this.moveMode === 'run' ? 'run' : 'walk') : this.idleAnim || 'idle';
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
    if (this._stanceT > 0) {
      this._stanceT -= dt;
    } else if (this.path && (this.state === 'active' || this.state === 'hidden' || this.state === 'captured')) {
      this._followPath(dt);
    }
    this._updateAnim(dt);
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
    let step = this.speed * dt;
    let dirX = 0, dirZ = 0;
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
    this._moving = true;
    // Surface height (§10.2 elev): raised areas are reached only through links, so snapping is safe.
    // The ABILITIES team animates link traversal (climb/ladder waypoints carry `link`, see findPath).
    if (w) { const e = w.grid.elevAt(this.x, this.z); if (e > 0 || this.y > 0) this.y = e; }
    if (dirX || dirZ) this.heading = turnTowardsAngle(this.heading, Math.atan2(dirZ, dirX), this.turnRate * dt);
    // Swimmers switch stance automatically in deep water.
    if (this.canSwim && w) {
      const g = w.groundAt(this.x, this.z);
      if (g.water && this.stance !== 'swim' && this.stance !== 'dive') this.setStance('swim');
      else if (!g.water && (this.stance === 'swim' || this.stance === 'dive')) this.setStance('stand');
    }
    // Movement is silent in BEL (§4.4). Footprints (§4.8): every walkStep/runStep metres on SNOW/SAND
    // (and visual-only MUD) a 'footprint' event is emitted; the AI team keeps the gameplay list.
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
  }

  _arrive() {
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
      path: this.path ? this.path.map((p) => ({ x: p.x, z: p.z })) : null,
      pathIndex: this.pathIndex,
      deathCause: this.deathCause,
      deathTime: this.deathTime,
      bodyNoticed: !!this.bodyNoticed,
      hiddenBody: !!this.hiddenBody,
      held: this.held, buried: this.buried, disguised: this.disguised, underwater: this.underwater, hidden: this.hidden,
      carriedBy: this.carriedBy ? this.carriedBy.id : null,
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
    this._anim = null;
    this._animOverride = null;
    if (!this.alive) this._setAnim('dead');
  }
}
