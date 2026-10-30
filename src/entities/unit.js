/**
 * Unit — humanoid base (commandos and soldiers): path following, turning, stances, speeds, running
 * footstep noise, health/damage/death, animation state, serialization.
 * See docs/ARCHITECTURE.md § Entities.
 * @module entities/unit
 */

import { settleBody, fallHeading, settleSolid, settleHands, climbTrack, climbAt, ownerHeight, weaponRoom, proneClear } from '../world/placement.js';
import { Entity } from './entity.js';
import { createUnitModel } from '../art/unit-model.js';
import { CONFIG, velToSpeed } from '../config.js';
import { angleTo, turnTowardsAngle, angleDiff, wrapAngle, dist } from '../core/math.js';
import { doubleFields } from '../core/shapes.js';
import { T, B, MAX_STEP } from '../world/grid.js';
import { plan as avoidPlan, priority, blocks, givesWay, newPlan } from './avoidance.js';

/** A climb starts once he faces its way within this (rad): turned further away he turns on the spot first. */
export const CLIMB_TURN = 0.6;
/** Body reach (m) kept over a wall while climbing it: torso + pack / slung rifle. */
const CLIMB_R = 0.45;

/** Running stride (rule e): how far the boots reach from the body, and how high the heel rises on its own (m). */
const RUN_REACH = 0.6, RUN_HEEL = 0.12;
/** Walking stride (rule e): the trailing toe leaves a step about half a metre behind the body. */
const WALK_REACH = 0.5, WALK_HEEL = 0.04;
/** Lying down (rule e): where along the body (m from the hips, + ahead) the ground under it is sampled. */
const CRAWL_SAMPLES = [-0.9, -0.5, 0, 0.3, 0.6, 0.9, 1.2];
/** Lateral samples (m) where his elbows / hands rest beside his chest (0.3–0.6 m ahead of the hips). */
const CRAWL_ARMS = [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6];
/** …a low surface up to this high is lain over (a step, a kerb); anything higher is a wall the nav keeps him off. */
const STEP_RISE = 0.35;
/** Brain states in which a standing enemy steps aside for a mate who cannot get past him. */
const YIELD_STATES = new Set(['IDLE', 'REINFORCE', 'RETURN', 'INVESTIGATE', 'SEARCH', 'TRACKS', 'BODY']);
import { cornerOffset } from './path-curve.js';
import { BODY, bodyGap, clearPose, avoidMask, inflationTiers, hasObstacles, hullsNear, pushedBy, deadStance, staticNear, rectSDF, MOVE_MARGIN, STOP_MARGIN } from '../world/body-clearance.js';
import { pathLength } from '../world/pathfinding.js';
import { rockFacesNear, inRockFace, NO_FACES } from '../world/rock-faces.js';
import { gateLayout } from '../world/breakables.js';
import { runNoiseStep } from '../ai/running-noise.js';
import { footOf } from '../ai/footprints.js';
import { stairSpeed, linkWalkY, isLadderLeg, ladderTrack, ladderSpeed, onStairRun, nearStairRun, railShift, railPath, railRoom, railPoint } from './stair-walk.js';

const LOW_STANCES = new Set(['crawl', 'swim', 'dive', 'downed']);
/**
 * Boom barriers on the map (world/breakables.js gateLayout): their pole line in gate-local u (along the gate) from the
 * counterweight to past the fork rest, and the pole's rest height; cached per world.
 */
function boomLines(w) {
  if (w._boomLines && w._boomLines.src === w.structures) return w._boomLines.list;
  const list = [];
  for (const s of w.structures?.values?.() || []) {
    const d = s.def;
    if (s.type !== 'gate' || !d) continue;
    const L = gateLayout(d);
    if (L?.kind !== 'boom' || !L.pivot) continue;
    const xe = Math.max(...L.pieces.filter((p) => p.kind === 'pole').map((p) => p.c[0] + p.h[0]));
    list.push({ x: d.x ?? 0, z: d.z ?? 0, tx: Math.cos(d.rot ?? 0), tz: Math.sin(d.rot ?? 0), u0: L.pivot[0] - 0.9, u1: xe + 0.15, y: L.pivot[1] });
  }
  w._boomLines = { src: w.structures, list };
  return list;
}

/** How fast a man getting down edges aside to lie clear of a wall (m/s; Unit._lieDownStep). */
const LIE_SHIFT = 1.2;
/** How fast a lying man's shown body turns while he crawls (rad/s; art/prone-ground.js: 75°/s × 1.5). */
const PRONE_TURN = (112 * Math.PI) / 180;
/** Every Unit.state value (§10.4 #2). BEL never enters 'stunned'/'bound' (BCD rulesets only). */
export const UNIT_STATES = Object.freeze(['active', 'dead', 'stunned', 'hidden', 'inVehicle', 'carried', 'busy', 'bound', 'held', 'captured', 'jailed', 'downed']);
/** One-shot actions a man may play while still moving (a shot on the move, §3.2): his legs keep stepping. */
const MOVE_ACTIONS = new Set(['shoot', 'aim']);
/** A man stopped in place: not walking, not carried along on a conveyor belt (moved at the 20 Hz BEL tick: 3 sim steps). */
const stopped = (n, A, w) => Math.hypot(n.vx || 0, n.vz || 0) < A.moving && !(n._beltTick >= w.tick - 3);
const _LF = { clearance: 0.3, dynamic: true, elevRef: 0.5 };
/** The men standing within r of u whom he gives way to (entitiesInRadius with a module filter: no closure per call —
 *  every idle man asks every step). */
let _snU = null, _snA = null, _snW = null;
const standerFilter = (n) => n !== _snU && stopped(n, _snA, _snW) && blocks(_snU, n) && givesWay(_snU, n);
function standersNear(u, w, A, r) {
  _snU = u; _snA = A; _snW = w;
  try { return w.entitiesInRadius(u.x, u.z, r, standerFilter); } finally { _snU = null; _snA = null; _snW = null; }
}
/** (x, z) is in a burning wreck's flames or within 1 m of them (§3.6: a step aside never ends, or passes, there). */
const inFire = (w, x, z) => !!w?.vehicles?.some((v) => v.burning && !v.removed && v._inHull?.(x, z, CONFIG.vehicles.wreckFireRadius + 1));
const fireStep = (w, x0, z0, x, z) => inFire(w, x, z) || inFire(w, (x0 + x) / 2, (z0 + z) / 2);
/** States in which cones can never see the unit. */
/** States in which the unit cannot be ordered to move (captured units are walked by their escort). */
const IMMOBILE_STATES = new Set(['dead', 'inVehicle', 'carried', 'stunned', 'bound', 'jailed']);
const HIDDEN_STATES = new Set(['hidden', 'inVehicle', 'carried', 'jailed']);

/** Avoid masks per (sim time, inflation, ignored vehicle): every unit planning in the same step shares them. */
function cachedAvoid(w, inf, ignore, prone = false) {
  const c = w._avoidCache && w._avoidCache.t === w.time ? w._avoidCache : (w._avoidCache = { t: w.time, m: new Map() });
  const key = `${inf}|${prone ? 'p' : ''}|${ignore ? [].concat(ignore).map((e) => e?.id ?? '').join(',') : ''}`;
  if (!c.m.has(key)) c.m.set(key, avoidMask(w, inf, ignore, prone));
  return c.m.get(key);
}

/** Is (x, z) in the grid's `noWalk` area `nw`? (Unit._followPath, every step: no closure, no cell object) */
function noWalkAt(g, nw, x, z) {
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  return g.inBounds(i, j) && nw[g.idx(i, j)] === 1;
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
    // (these numbers turn fractional in play: double-valued fields from the start — core/shapes.js)
    doubleFields(this, 0, '_laneX', '_laneZ', '_laneV', '_curveX', '_curveZ', '_mdirX', '_mdirZ'); doubleFields(this, 1, '_avScale'); doubleFields(this, 0, '_blockT');
    this._ghostIds = null; this._holdFor = null; this._yieldAt = null; this._ghostT = null;
    doubleFields(this, 0, 'vx', 'vz');
    this.radius = CONFIG.units.radius;
    this.pickRadius = CONFIG.units.pickRadius;
    this.killer = null;
    this.deathCause = null;
    this.deathTime = null;
    this._onArrive = null;
    doubleFields(this, 0, '_footstepT', '_stanceT');
    this._pathGridVersion = -1;
    this._anim = null;
    this._animOverride = null; // {name, t}
    this._moving = false;

    // Fields the unit's own methods and other modules set later (steps, avoidance, carrying, weapons, blood…), declared
    // here, undefined until first set — exactly as when absent (nothing tests them with `in` or lists his keys): every
    // unit of a class keeps one hidden-class shape (V8) whatever he does. A field first added in play reshaped him and
    // threw away the optimised code of everything that handles units (~100 functions at a time; ~2 000 such deopts in
    // an M3 walkthrough, and the unit code megamorphic by the end: 4 commandos in 4 shapes, 31 shapes for 34 enemies).
    this._lift = undefined; this.trackV = undefined; this._walkAnim = undefined; this._bodyBlockT = undefined;
    this._bodyPrevO = undefined; this._bodyPrev = undefined; this._runNoiseD = undefined; this._toeT = undefined;
    this._weaponBack = undefined; this._weaponAtX = undefined; this._weaponAtZ = undefined;
    this._weaponV = undefined; this._bodyProg = undefined; this._bodyRepaths = undefined; this._settled = undefined;
    this._settleHeading = undefined; this._planO = undefined; this._avRes = undefined; this._trackOffO = undefined;
    this._trackOff = undefined; this._pivoting = undefined; this._apartHeld = undefined; this._leanV = undefined;
    this._curveF = undefined; this._lieDown = undefined; this._pitched = undefined; this._turnInPlace = undefined;
    this._straight = undefined; this._ladder = undefined; this._climb = undefined; this.bloodyFeet = undefined;
    this.blastReact = undefined; this.idleAnim = undefined; this.vehicle = undefined; this._rd = undefined;
    this.pendingLift = undefined; this._preCarryState = undefined; this._rdCarried = undefined;
    this.carryDrop = undefined; this.helmetOff = undefined; this.lastHurtBy = undefined;
    this.blastDoomed = undefined; this._blastKill = undefined; // (blast flags: cleared after, never deleted — explosions.js, world-physics)
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

  /** Crawling/swimming/diving: counts as a low target for LOS (B.LOW cover hides it). A Sniper up on one knee to fire
   * (`kneeling`, the rifle's aim and shot) counts as standing (§3.4), whatever stance he fires from. */
  get isLow() {
    return LOW_STANCES.has(this.stance) && !this.kneeling;
  }

  /**
   * False when hidden, inside a closed vehicle, carried or diving underwater. A man aboard an OPEN boat (raft,
   * rowboat, a boat's deck) is in plain view (§4.2): his own stance (a diver who hoisted himself in) does not hide him.
   */
  get isVisibleToEnemies() {
    if (this.state === 'inVehicle' && this.vehicle?.isOpenBoat) return this.alive && !this.hidden;
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
  moveTo(x, z, { run = false, onArrive = null, bare = false } = {}) {
    if (!this.alive || !this.world || IMMOBILE_STATES.has(this.state) || this.buried) return false;
    // from the path track: a dodging walker keeps its lane (avoidance.js), so re-paths do not shift the route
    // (halfway up / down a ladder: planned from its end, which he climbs on to first; halfway over a wall on a climb
    // link the same: he finishes the climb from where he hangs)
    let path = this._onLadder() ? this._planFromLadder(x, z, bare) : this._onClimb() ? this._planFromClimb(x, z, bare) : this._planPath(x, z, null, bare);
    if (!path) return false;
    path = railPath(this, path, { x, z }); // (up / down a stair head-on, its middle between the rails: user 2026-10-11)
    this._bodyBlockT = 0;
    this._bodyProg = null;
    this._bodyRepaths = 0; // (a fresh order gets its three tries; the step guard's own re-path sets its count after)
    this._settled = false;
    this._settleHeading = null;
    this.path = path;
    this.pathIndex = path.length > 1 && path[0] !== this._ladder?.wp && path[0] !== this._climb?.wp ? 1 : 0;
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
    if (this._onLadder()) return true; // (he climbs on to the ladder's end first)
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
    if (this._onLadder()) return false;
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

  /** Is the next leg of his path a ladder's, its foot (the waypoint before it) within `r` m of him? */
  _toLadderFoot(r) {
    const p = this.path;
    if (!p) return false;
    for (let k = this.pathIndex; k < Math.min(p.length, this.pathIndex + 2); k++) {
      if (!isLadderLeg(p[k])) continue;
      const f = k > this.pathIndex ? p[k - 1] : { x: this.x, z: this.z };
      return Math.hypot(f.x - this.x, f.z - this.z) < r;
    }
    return false;
  }

  /** Is he halfway up / down a ladder (entities/stair-walk.js)? */
  _onLadder() { const L = this._ladder; return !!(L && this.path?.[this.pathIndex] === L.wp); }

  /** A path to (x, z) that first climbs on to the end of the ladder he is on (moveTo mid-ladder). */
  _planFromLadder(x, z, bare = false) {
    const L = this._ladder, at = { x: this.x, z: this.z, y: this.y };
    this.x = L.wp.x; this.z = L.wp.z; this.y = L.wp.y ?? this.y;
    let p;
    try { p = this._planPath(x, z, null, bare); } finally { this.x = at.x; this.z = at.z; this.y = at.y; }
    return p ? [L.wp, ...p.slice(1)] : null;
  }

  /** Is he halfway over a wall on a climb link (the GB's climb: `_climb`, placement.climbTrack)? */
  _onClimb() { const C = this._climb; return !!(C && this.path?.[this.pathIndex] === C.wp); }

  /**
   * A path to (x, z) that first finishes the climb he is on (moveTo while hanging on a wall: the dossier's "stop
   * mid-climb and wait"): planned from the link's far end, the climb kept (it goes on from his height).
   */
  _planFromClimb(x, z, bare = false) {
    const C = this._climb, at = { x: this.x, z: this.z, y: this.y };
    this.x = C.wp.x; this.z = C.wp.z; this.y = C.wp.y ?? this.y;
    let p;
    try { p = this._planPath(x, z, null, bare); } finally { this.x = at.x; this.z = at.z; this.y = at.y; }
    return p ? [C.wp, ...p.slice(1)] : null;
  }

  /** Where he is on his path track (position minus the avoidance lane and corner curve): route progress. */
  get track() { return { x: this.x - this._laneX - this._curveX, z: this.z - this._laneZ - this._curveZ }; }

  /**
   * Path to (x, z) keeping the whole body clear of solid obstacles — vehicle hulls, wrecks, drums, pushables, crates,
   * rocks (world/body-clearance.js): each inflation tier of the stance in turn (a crawler first keeps room to turn
   * any way, then only to lie parallel), the tighter tier when it is much shorter or ends nearer the click, and the
   * bare grid path when the obstacles box him in — or at once when `bare` is set (the step guard still
   * keeps his body out of them).
   */
  _planPath(x, z, from = null, bare = false) {
    const w = this.world, q = this.pathQuery(), tr = from || this.track; // (from his path track, see moveTo)
    if (bare) return w.findPath(tr.x, tr.z, x, z, q);
    // (a crawler also goes round steps, porches and plinths: his body would lie into their sides, grid.crawlStep)
    const prone = this.stance === 'crawl' && !!w.grid?.crawlStep;
    if ((!hasObstacles(w) && !prone) || this.y > 1) return w.findPath(tr.x, tr.z, x, z, q);
    const ignore = this._bodyIgnore(true);
    let best = null;
    for (const inf of inflationTiers(this.stance)) {
      const avoid = cachedAvoid(w, inf, ignore, prone);
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
   * The path a move order to (x, z) would give him if he stood on his feet / lay at (fx, fz) now, in his stance (the
   * order's own planning: _planPath + railPath). For look-ahead only (tools/solutions: the driver checks that a leg it
   * is about to click is walked straight); nothing about him changes. @returns {object[]|null}
   */
  planFrom(fx, fz, x, z) {
    if (!this.world) return null;
    const p = this._planPath(x, z, { x: fx, z: fz });
    return p ? railPath(this, p, { x, z }) : null;
  }

  /**
   * Obstacles that are no obstacle to this man: the vehicle he is in / getting out of, the pushable he is pushing
   * and (`plan`: path planning only) the device / drum he is walking up to use or pick up — his path ends at it, the
   * step guard still stops his body short of it.
   * @returns {object[]|null}
   */
  _bodyIgnore(plan = false) {
    let out = null; // (a list only when there is something in it: asked every step for every man)
    if (this.vehicle) (out ||= []).push(this.vehicle);
    const p = pushedBy(this.world, this);
    if (p) (out ||= []).push(p);
    const t = plan ? this.pendingAbility?.target : null;
    if (t && t.kind === 'interactable') (out ||= []).push(t);
    return out;
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
    let found = false, bx = 0, bz = 0, bd = Infinity;
    const prone = this.stance === 'crawl' || this.stance === 'downed';
    for (let j = cj - R; j <= cj + R && !prone; j++) {
      for (let i = ci - R; i <= ci + R; i++) {
        // (cellCenter written out: an object per cell of the 13 x 13 search)
        const px = (i + 0.5) * g.cell, pz = (j + 0.5) * g.cell, dx = px - x, dz = pz - z, dd = Math.hypot(dx, dz);
        if (dd >= bd || dd > 3 || dx * ux + dz * uz <= 0 || !g.isWalkable(i, j, opts)) continue;
        bd = dd; bx = px; bz = pz; found = true;
      }
    }
    if (found) return { x: bx, z: bz };
    for (let r = 0.25; r <= Math.min(d, 6); r += 0.25) if (free(x + ux * r, z + uz * r)) return { x: x + ux * r, z: z + uz * r };
    return { x, z };
  }

  /** Options for this unit's NavGrid path queries (World.findPath); subclasses add restrictions. */
  pathQuery() {
    // (`lying`: a crawler comes on and off ramps and stairs head-on and keeps to their middle, pathfinding alignRuns)
    return { swim: this.canSwim, role: this.role, lying: this.stance === 'crawl' };
  }

  /** Stop moving (keeps stance). Halfway up / down a ladder he climbs on to its end first (art/ladder-climb.js). */
  stop() {
    this._bakeLane();
    const L = this._ladder;
    if (L && this.alive && this.path?.[this.pathIndex] === L.wp) { // (not hanging off it in mid-air)
      this.path = [L.wp]; this.pathIndex = 0; this.moveTarget = L.wp; this._onArrive = null;
      return;
    }
    this._ladder = null;
    this.path = null;
    this._climb = null;
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
    // getting down on his belly: the body falls along his heading, so where that would put his head, hands, knees or
    // feet in a wall he turns (or edges aside) to lie where all of him fits, while he gets down (stanceDown; from a
    // crouch, as long as the turn or the edging takes) (clipping seeds 7 / 11, M3: the Diver and the Green Beret lying
    // down at their starts, 0.95 m from start_wall and facing it, 0.11 m into it)
    this._lieDown = stance === 'crawl' && (prev === 'stand' || prev === 'crouch') ? { to: null } : null;
    if (this._lieDown && !(this._stanceT > 0)) {
      // (from a crouch he is down at once — unless he must turn or edge aside first: then as long as that takes)
      const L = this._lieDown, to = (L.to = this._lieDownPose() || { none: true });
      L.px = this.x; L.pz = this.z;
      if (to.none) this._lieDown = null;
      else this._stanceT = Math.min(CONFIG.units.stanceDown, Math.max(Math.abs(angleDiff(this.heading, to.heading)) / this.turnRate, Math.hypot(to.x - this.x, to.z - this.z) / LIE_SHIFT) + 1 / 60);
    }
    if (stance === 'crawl') this._crawlRepath();
    this.world?.events.emit('unit:stance', { unit: this, stance });
  }

  /**
   * Where a man getting down lies (placement proneClear: his whole lying body clear of walls, the standing visuals and
   * ledges; world/body-clearance.js: of hulls and solid props): here as he faces when that fits, else facing the way
   * his path goes when that fits, else the nearest heading that does, else the nearest spot (≤ 0.5 m) where one does.
   * Null: as he is (it fits, or nothing does; on a ramp / stair run its own rules hold).
   * @returns {{x:number, z:number, heading:number}|null}
   */
  _lieDownPose() {
    const w = this.world, g = w?.grid;
    if (!g || this.vehicle || this._lyingRun() || onStairRun(this)) return null;
    const ign = this._bodyIgnore(), solids = hasObstacles(w);
    const fits = (x, z, h) => proneClear(g, x, z, h);
    const free = (x, z, h) => fits(x, z, h) && (!solids || bodyGap(w, x, z, h, 'crawl', ign) >= STOP_MARGIN);
    if (free(this.x, this.z, this.heading)) return null;
    const wp = this.path?.[this.pathIndex];
    if (wp && Math.hypot(wp.x - this.x, wp.z - this.z) > 0.05) {
      const want = Math.atan2(wp.z - this.z, wp.x - this.x);
      if (free(this.x, this.z, want)) return { x: this.x, z: this.z, heading: want };
    }
    return clearPose(w, this.x, this.z, this.heading, 'crawl', { sweep: false, maxDist: 0.5, ignore: ign, fits,
      walkable: (x, z) => g.walkableAt(x, z) && Math.abs(g.elevAt(x, z) - g.elevAt(this.x, this.z)) <= 0.1 });
  }

  /**
   * One step of getting down (Unit.setStance `_lieDown`): turn (at his standing turn rate) and edge (LIE_SHIFT) toward
   * the pose _lieDownPose picks on the first step (by then his order's path is known; picked again when something
   * else has moved him since); `final`: the last step.
   */
  _lieDownStep(dt, final = false) {
    const L = this._lieDown;
    if (!L) return;
    // put somewhere else meanwhile (a script, a test, a load placing him): planned again from where he is
    if (L.to && (Math.abs(this.x - L.px) > 1e-3 || Math.abs(this.z - L.pz) > 1e-3)) L.to = null;
    if (!L.to) L.to = this._lieDownPose() || { none: true };
    const to = L.to;
    if (!to.none) {
      const dx = to.x - this.x, dz = to.z - this.z, d = Math.hypot(dx, dz);
      // (never a jump: the last step finishes a short way only; else he lies here, turned only if that fits here)
      const snap = final && d <= LIE_SHIFT * dt + 0.05;
      const step = snap ? d : Math.min(d, LIE_SHIFT * dt);
      if (d > 1e-6) { this.x += (dx / d) * step; this.z += (dz / d) * step; }
      if (!final || snap || proneClear(this.world.grid, this.x, this.z, to.heading)) {
        this.heading = final ? wrapAngle(to.heading) : turnTowardsAngle(this.heading, to.heading, this.turnRate * dt);
      }
      if (final) { this.prevHeading = this.heading; this._bodyPrev = null; }
    }
    L.px = this.x; L.pz = this.z;
    if (final) this._lieDown = null;
  }

  /**
   * A man lying down on his way: when the rest of his path runs across the side of a step, a porch or a plinth
   * (grid.crawlStep: a crawler's body follows the ground, not a stair), he is re-pathed round it to the same goal.
   */
  _crawlRepath() {
    const w = this.world, P = this.path, cs = w?.grid?.crawlStep, runs = w?.grid?.runs?.filter((R) => R.align);
    if ((!cs && !runs?.length) || !P?.length || P[0].steer) return;
    // (or onto / along a ramp or stair: a crawler comes on head-on and keeps to its middle, pathfinding alignRuns)
    const g = w.grid, near = (x, z) => {
      if (runs?.length && g.runAt(x, z, 1.0)) return true;
      if (!cs) return false;
      for (let dz = -0.5; dz <= 0.5; dz += 0.25) for (let dx = -0.5; dx <= 0.5; dx += 0.25) {
        const i = Math.floor((x + dx) / g.cell), j = Math.floor((z + dz) / g.cell);
        if (g.inBounds(i, j) && cs[g.idx(i, j)]) return true;
      }
      return false;
    };
    let ax = this.x, az = this.z, hit = false;
    for (let k = Math.max(0, this.pathIndex); k < P.length && !hit; k++) {
      const L = Math.hypot(P[k].x - ax, P[k].z - az), n = Math.max(1, Math.ceil(L / 0.25));
      for (let q = 1; q <= n && !hit; q++) hit = near(ax + ((P[k].x - ax) * q) / n, az + ((P[k].z - az) * q) / n);
      ax = P[k].x; az = P[k].z;
    }
    if (!hit) return;
    const goal = P[P.length - 1], p = this._planPath(goal.x, goal.z);
    if (!p) return;
    this.path = p; this.pathIndex = p.length > 1 ? 1 : 0; this.moveTarget = p[p.length - 1];
    this._pathGridVersion = w.grid.version;
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
   * @param {{fall?: number, prone?: boolean}} [o] how he goes down when the killer decides it (abilities/knife.js
   *   contact kill): fall 1 forward / -1 backward; prone: he ends on his face (a crawler's corpse: dead_prone clip,
   *   prone settle ragdoll, prone body shape)
   */
  die(cause = 'damage', killer = null, o = null) {
    if (!this.alive) return;
    // the death clip falls forward from a run (die_run), backward from a stand / walk (placement rule e)
    const fall = o?.fall ?? (/^(run|sprint|walk_fast)/.test(this._anim || '') ? 1 : /^(crawl|prone|swim)/.test(this._anim || '') ? 0 : -1);
    if (o?.prone && this.stance === 'stand') this.stance = 'crawl'; // pitched onto his face: he lies like a crawler
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
      // …and, fallen on his back, his hands flung out past his head clear of a building's foot (a plinth, a skirt)
      if (fall < 0 && deadStance(this.stance) === 'dead') {
        const A = BODY.dead.arms, hd = settleHands(w.grid, this.x, this.z, this.heading, { at: A.at, half: A.half, r: A.r });
        if (hd) { this.x = hd.x; this.z = hd.z; }
      }
      // …and never under a vehicle hull (world/body-clearance.js); a man run over lies where the wheels caught him
      const ds = deadStance(this.stance); // on his back (his hands flung out past his head), or on his belly
      if (cause !== 'runover' && cause !== 'train' && hasObstacles(w) && bodyGap(w, this.x, this.z, this.heading, ds) < STOP_MARGIN) {
        const cp = clearPose(w, this.x, this.z, this.heading, ds, { sweep: false, maxDist: 1.5 });
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
    // a shot on the move (§3.2): his legs keep their stepping clip (Unit._updateAnim brings the pose if he stops)
    if (MOVE_ACTIONS.has(name) && this._moving && this.alive) { this._animOverride.walked = true; return; }
    this._anim = null;
    this._setAnim(name, { loop: false, restart: true });
  }

  _updateAnim(dt) {
    if (!this.alive) {
      if (this._anim === 'die' && this.world && this.world.time - this.deathTime > 1.2) this._setAnim('dead');
      return;
    }
    const moving = this._moving;
    if (this._animOverride) {
      const o = this._animOverride;
      o.t -= dt;
      if (o.t > 0) {
        // §3.2 a man who fires on the move keeps walking (crawling, running): his legs keep their stepping clip while
        // the shot goes off (the shoot / aim pose over a gliding body read as "he does not walk"); standing still
        // again inside the window, the pose comes back
        if (!MOVE_ACTIONS.has(o.name)) return;
        if (moving) { o.walked = true; this._setAnim(this._locoAnim(true, dt)); }
        else if (o.walked && this._anim !== o.name) { o.walked = false; this._setAnim(o.name, { loop: false, restart: true }); }
        return;
      }
      this._animOverride = null;
    }
    this._setAnim(this._locoAnim(moving, dt));
  }

  /** Locomotion / idle clip name for his stance (a commando's load first: Commando._holdAnim). */
  _locoAnim(moving, dt) {
    let name;
    switch (this.stance) {
      case 'crawl': name = moving ? 'crawl' : 'crawl_idle'; break;
      case 'downed': name = moving ? 'downed_crawl' : this.reviving ? 'revive_receive' : 'downed_idle'; break;
      case 'swim': name = 'swim'; break;
      case 'dive': name = 'dive'; break;
      // a commando holding a load keeps its carry / drag clip (Commando._holdAnim): never walk ⇄ carry_walk per tick
      default: {
        // (no headway — waiting, a lane sidestep while he waits — and a solid where his leading boot lands: he stands
        // instead of striding in place into it, held a moment so the gait does not flick)
        this._toeT = Math.max(0, (this._toeT || 0) - dt);
        if (moving && !this._toeT && (this.trackV || 0) < 0.3 && this._toeBlocked()) this._toeT = 0.3;
        const step = moving && !this._toeT;
        name = this._holdAnim?.(moving) || (step ? (this.moveMode === 'run' && !this._heelBlocked() ? 'run' : 'walk') : this.idleAnim || 'idle');
      }
    }
    return name;
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
    // moved by an ability task, off the grid (abilities/bunker-entry.js: into a bunker under its roof cells)
    if (this.scripted) {
      if (this._stanceT > 0) this._stanceT -= dt;
      this._moving = this._walkAnim = !!this.scripted.moving;
      this._updateAnim(dt);
      return;
    }
    if (this._stanceT > 0) {
      this._stanceT -= dt;
      if (this._lieDown) this._lieDownStep(dt, !(this._stanceT > 0));
    } else if (this.path && (this.state === 'active' || this.state === 'hidden' || this.state === 'captured' || this.state === 'downed')) {
      this._followPath(dt);
    } else if (!this.path && this.world) {
      if (this.world.tick % 15 === 0) this._settle();
      if (!this.path) this._nudge(dt);
    }
    this._walkAnim = this._moving;
    this._guardBody(dt);
    // on a flight of stairs his body stays between its rails (a dodge, a crowd or his path's corner never takes it over)
    const rs = this.world?.grid?.flights?.size ? railShift(this) : null;
    if (rs) {
      this.x += rs.x; this.z += rs.z;
      // (and the point he walks to, when a re-plan left it out there: no walking on the spot against a rail)
      const wp = this.path?.[this.pathIndex];
      if (wp && !wp.link) { const q = railPoint(this, wp, this.pathIndex === this.path.length - 1); if (q !== wp) this.path[this.pathIndex] = q; }
    }
    if (!this._moving) this._runNoiseD = null; // a new run starts its running-noise counter afresh
    this._updateAnim(dt);
    // (also while the aim is his idle pose on a way his boot is blocked on — a soldier in COMBAT stood at a pine on M3's
    // W edge, his rifle up into its trunk: _locoAnim's toe block)
    if (this._anim === 'aim' || this._anim === 'shoot') this._keepWeaponRoom(dt);
    else { this._weaponBack = 0; this._weaponAtX = null; this._weaponV = 0; }
  }

  /**
   * Placement rule (e) stride: the boots reach RUN_REACH (WALK_REACH) m before and behind the body: where the ground
   * there is a step higher than the heel's own lift, the body rides up the difference so the boot clears the step
   * instead of kicking through its edge (the feet ring of world.groundY covers the soles and the short stride).
   */
  syncTransform(alpha = 1) {
    super.syncTransform(alpha);
    const o = this.object3d, w = this.world;
    if (o && this._pitched) { o.rotation.x = 0; this._pitched = false; }
    if (o && (this.stance === 'crawl' || this.stance === 'downed') && this.alive && typeof w?.groundY === 'function' && !this.vehicle) { this._lift = null; return this._crawlOverSteps(o, w); }
    if (!o || typeof w?.groundY !== 'function' || LOW_STANCES.has(this.stance) || this._climb || this._ladder || this.vehicle) { this._lift = null; return; }
    if (this._moving) {
      const run = this.moveMode === 'run', reach = run ? RUN_REACH : WALK_REACH, heel = run ? RUN_HEEL : WALK_HEEL;
      const x = o.position.x, z = o.position.z, c = Math.cos(this.heading), s = Math.sin(this.heading), g0 = w.groundY(x, z) || 0;
      let lift = 0;
      for (const d of [-reach, reach]) lift = Math.max(lift, (w.groundY(x + c * d, z + s * d) || 0) - g0 - heel);
      if (lift > 0) o.position.y += Math.min(lift, 0.3);
    }
    this._easeLift(o, alpha);
  }

  /**
   * The body's lift off the sim's height (the low surfaces under his feet, the stride's ride up a step) eased: at most
   * 1.8 m/s up, 3 m/s down. Walking up to a 0.35 m plinth — M11's tanks — the boot's reach found its top in one frame
   * and he rose 30 cm in it; the feet ring's own rings step it 0.23 / 0.29 / 0.35 m. A jump (a placing) starts afresh.
   */
  _easeLift(o, alpha) {
    const t = (this.world?.time ?? 0) - (1 - alpha) * CONFIG.sim.dt, simY = this.prevY + (this.y - this.prevY) * alpha;
    const off = o.position.y - simY, L = this._lift;
    if (L && Math.hypot(o.position.x - L.x, o.position.z - L.z) < 1 && t >= L.t) {
      const dt = t - L.t, v = dt > 0 ? Math.max(L.off - 3 * dt, Math.min(L.off + 1.8 * dt, off)) : L.off;
      o.position.y = simY + v;
      this._lift = { t, off: v, x: o.position.x, z: o.position.z };
      return;
    }
    this._lift = { t, off, x: o.position.x, z: o.position.z };
  }

  /**
   * Placement rule (e) walking stride: the leading boot lands up to ~0.6 m ahead of the body. Is a wall, a structure's
   * solid footprint, a solid prop (with the reach body-clearance gives it: a gate post, a crate) or a hull there?
   * A man making no headway with one there stands rather than stride into it (M2 `barr_out` holding for a mate
   * beside `gate_se`'s fork rest, sidestepping in a walk: his toe 6.6 cm into the rest, clipping seed 11).
   */
  _toeBlocked() {
    const w = this.world, g = w?.grid;
    if (!g) return false;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    for (const d of [0.35, 0.5, 0.65]) for (const v of [-0.12, 0, 0.12]) {
      const x = this.x + c * d - s * v, z = this.z + s * d + c * v, { i, j } = g.worldToCell(x, z);
      if (g.inBounds(i, j) && (g.block[g.idx(i, j)] !== B.NONE || g.solidAt?.(x, z))) return true;
      if (hullsNear(w, x, z, 0, this.vehicle || null).some((R) => rectSDF(x, z, R) < 0)) return true;
    }
    return false;
  }

  /**
   * Placement rule (e) running stride: the trailing heel kicks up to 0.85 m behind a runner; while a wall, a stake
   * or a building stands there (running off a post with his back to the palisade: M2 e5), his first strides are shown
   * as a walk at the same pace. Up / down a flight of stairs a run is a careful jog (STAIR_PACE), shown as a brisk
   * walk, two treads a stride (art/stair-gait.js: a run's flight phase has no tread to land on).
   */
  _heelBlocked() {
    const g = this.world?.grid;
    if (!g) return false;
    if (g.flights?.size && nearStairRun(this)) return true; // (from a stride before the flight: stair-walk nearStairRun)
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    for (const d of [0.45, 0.65, 0.85]) for (const v of [-0.15, 0, 0.15]) {
      const x = this.x - c * d - s * v, z = this.z - s * d + c * v, { i, j } = g.worldToCell(x, z);
      if (!g.inBounds(i, j)) continue;
      const k = g.idx(i, j);
      if (g.block[k] !== B.NONE || g.solidAt?.(x, z)) return true;
    }
    return false;
  }

  /**
   * Placement rule (e) for a man lying down: his body reaches 1.2 m ahead (head, the weapon), his elbows 0.6 m to
   * the sides and his boots 0.9 m behind (CRAWL_SAMPLES / CRAWL_ARMS), so beside a door's steps, a kerb or a plinth
   * (a low surface ≤ STEP_RISE m up) the hips stay on the ground while his head or an arm would go into its side.
   * The body rises and pitches (≤ 12°, about his hips) just enough that every sample lies on what is under it.
   */
  _crawlOverSteps(o, w) {
    const g = w.grid, x = o.position.x, z = o.position.z, h = this.heading, c = Math.cos(h), s = Math.sin(h);
    const surf = (px, pz) => (g?.elevAt ? g.elevAt(px, pz) || 0 : 0) + (w.groundY(px, pz) || 0);
    const y0 = surf(x, z), need = [];
    let up = false;
    for (const a of CRAWL_SAMPLES) for (const v of a > 0.2 && a < 0.7 ? CRAWL_ARMS : [-0.25, 0, 0.25]) {
      const r = surf(x + c * a - s * v, z + s * a + c * v) - y0;
      if (r > STEP_RISE) continue; // (a wall: the nav keeps him off it)
      need.push([a, r]); // (every sample: the tilt never puts his boots or head below the ground either)
      if (r > 0.03) up = true;
    }
    if (!up) return;
    let best = null;
    for (let d = -12; d <= 12; d++) {
      const sn = Math.sin((d * Math.PI) / 180);
      let L = 0;
      for (const [a, r] of need) L = Math.max(L, r - a * sn);
      if (!best || L < best.L - 1e-4 || (Math.abs(L - best.L) <= 1e-4 && Math.abs(d) < Math.abs(best.d))) best = { L, d };
    }
    o.position.y += Math.min(best.L, STEP_RISE);
    if (best.d) {
      o.rotation.order = 'YXZ';
      o.rotation.x = (-best.d * Math.PI) / 180; // (model forward is local +Z: a negative x tilt lifts the head)
      this._pitched = true;
    }
  }

  /**
   * Placement rule (e) weapons: standing (or kneeling) and aiming, the unit steps back (≤ 0.6 m, a quick half step at 1.6 m/s or faster: done within 0.15 s, before the rifle is up) until the
   * shouldered barrel is out of the wall or building in front of it (placement.weaponRoom); no room: stays put.
   */
  _keepWeaponRoom(dt) {
    const w = this.world;
    if (!w?.grid || LOW_STANCES.has(this.stance) || this.vehicle || this._climb || this._ladder) return;
    // (≤ 0.6 m back in all per aim — net: a step he took forward since, closing in while he aims in COMBAT, gives that
    // much back; spent on cumulative half steps, an M3 trooper at st_barr1's corner had his rifle 9 cm into it)
    if (this._weaponAtX != null && this._weaponBack > 0) {
      const adv = (this.x - this._weaponAtX) * Math.cos(this.heading) + (this.z - this._weaponAtZ) * Math.sin(this.heading);
      if (adv > 0) this._weaponBack = Math.max(0, this._weaponBack - adv);
    }
    this._weaponAtX = this.x; this._weaponAtZ = this.z;
    const left = 0.6 - (this._weaponBack || 0); // per aim (≤ 0.6 m in all)
    const faces = rockFacesNear(w, this.x, this.z, 2.2); // (the barrel reaches 1.15 m, a step back 0.5 m, ± 0.25 m across)
    // parked hulls and wagons count too (taller than the shoulder: a vehicle's own height, a wagon's box)
    const solidAt = (x, z, y) => (w.vehicles || []).some((v) => v !== this.vehicle && !v.removed && !v.hiddenRail && v._inHull?.(x, z, 0) && (v.hullHeight?.() ?? 2) > y)
      || (w.interactables || []).some((it) => it.interactKind === 'pushable' && !it.destroyed && it.size && Math.abs((x - it.x) * Math.cos(it.heading ?? 0) + (z - it.z) * Math.sin(it.heading ?? 0)) <= it.size[0] / 2 + 0.05
        && Math.abs(-(x - it.x) * Math.sin(it.heading ?? 0) + (z - it.z) * Math.cos(it.heading ?? 0)) <= it.size[1] / 2 + 0.05)
      // and the solid props (body clearance: a fuel tank, a crate stack) whose visual reaches past their footprint
      || staticNear(w, x, z, 0.05).some((R) => (R.top ?? 2) > y - (this.y || 0) && rectSDF(x, z, R) < 0.05)
      // and a massif's plumb face where it meets built work (M3's E stair: its cells can be half rock and open; 5 cm kept)
      || (faces !== NO_FACES && inRockFace(faces, x, z, y, 0.05))
      // and a boom barrier's pole line above its rest height: the pole swings up through it whenever the gate opens
      || boomLines(w).some((L) => { const px = x - L.x, pz = z - L.z, u = px * L.tx + pz * L.tz, v = -px * L.tz + pz * L.tx;
        return Math.abs(v) < 0.15 && u > L.u0 && u < L.u1 && y - (this.y || 0) > L.y; });
    const b = left > 1e-3 ? weaponRoom(w.grid, this.x, this.z, this.heading, this.y ?? 0, { heightOf: ownerHeight(w), max: Math.min(0.5, left), solidAt }) : null;
    if (!b) return;
    // (a quick half step, done before the rifle is up — the pose blends in over ~0.2 s: at 1.6 m/s, or faster when it
    // has farther to go, all of it within 0.15 s of the aim. M2 e7 stopped 1 m short of a gate post and raised his
    // rifle into it while a 0.4 m step back at 1.6 m/s still went on)
    if (!(this._weaponV > 0)) this._weaponV = Math.max(1.6, b / 0.15);
    const st = Math.min(b, this._weaponV * dt), nx = this.x - Math.cos(this.heading) * st, nz = this.z - Math.sin(this.heading) * st;
    // (never back into a solid prop, hull or crate: the step guard has already run this step)
    if (hasObstacles(w)) {
      const ig = this._bodyIgnore(), g0 = bodyGap(w, this.x, this.z, this.heading, this.stance, ig);
      if (bodyGap(w, nx, nz, this.heading, this.stance, ig) < Math.min(MOVE_MARGIN, g0)) return;
    }
    this._weaponBack = (this._weaponBack || 0) + st;
    this.x = nx; this.z = nz;
    this._weaponAtX = nx; this._weaponAtZ = nz;
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
    // (on a ladder he goes up its line, the wall it stands against before him: a ladder's top a step inside a wall's
    // body — M17's, M19's, M11's — had him stopped at its foot the first frame up)
    // (nor his last 1.5 m to a ladder's foot, the ladder his next leg: the structure it is built onto — M2's MG
    // platforms, whose solid takes in their ladder — stopped him short of it, climbable only from that very spot)
    const skip = !hasObstacles(w) || !this.alive || HIDDEN_STATES.has(this.state) || this.vehicle || this.y > 1
      || st === 'swim' || st === 'dive' || this._ladder || this._toLadderFoot(1.5);
    if (skip) { this._bodyPrev = null; return; }
    const ign = this._bodyIgnore();
    const g = bodyGap(w, this.x, this.z, this.heading, st, ign);
    if (g === Infinity) { this._bodyBlockT = 0; return this._keepBodyPrev(); }
    if (P && P.stance !== st && g < STOP_MARGIN) {
      // lying down (or getting up) here: the body falls along the heading, so pick the nearest clear one
      const cp = clearPose(w, this.x, this.z, this.heading, st, { sweep: false, maxDist: 1.5, ignore: ign });
      if (cp) { this.x = cp.x; this.z = cp.z; this.heading = cp.heading; this.prevHeading = cp.heading; }
      return this._keepBodyPrev();
    }
    if (g >= MOVE_MARGIN || !P) return this._keepBodyPrev();
    // a jump no step makes (setPosition, a script or a load placing him): not a step to undo — placed inside a solid,
    // he is put at the nearest pose clear of it
    if (Math.hypot(this.x - P.x, this.z - P.z) > 1.5) {
      const cp = g < 0 && clearPose(w, this.x, this.z, this.heading, st, { sweep: false, maxDist: 1.5, ignore: ign });
      if (cp) { this.x = cp.x; this.z = cp.z; this.heading = cp.heading; this.prevHeading = cp.heading; }
      return this._keepBodyPrev();
    }
    const gPrev = bodyGap(w, P.x, P.z, P.heading, st, ign);
    if (g >= gPrev - 1e-3) return this._keepBodyPrev(); // not deeper (a vehicle came to him, or he is getting out)
    const need = Math.min(MOVE_MARGIN, gPrev);
    const c = Math.cos(P.heading), s = Math.sin(P.heading), front = st === 'crawl' || st === 'downed' ? 0.6 : 0;
    const cands = [[this.x, this.z, P.heading, true]];
    const turns = [
      // a prone traverse rotates about the elbows: the legs sweep, the chest stays (crawl-animation.md §3.6)
      [P.x + c * front - Math.cos(this.heading) * front, P.z + s * front - Math.sin(this.heading) * front, this.heading, false],
      [P.x, P.z, this.heading, false],
    ];
    // (only a real turn of a lying body: on his feet the body is a disc, and with no turn this step either way the "turn"
    // is standing still — always as clear as where he stood — so it comes after the slides below, or a man whose way
    // grazes a solid never slid along it: blocked, re-planned the same way three times, stopped. Stuck-orders soak, M2:
    // the Marine between gate_se's boom post and fork rest on his feet, and crawling past the two drums by the dock)
    const turning = !!front && Math.abs(angleDiff(this.heading, P.heading)) > 1e-4;
    if (turning) cands.push(...turns);
    // sliding along it: the same step turned 35° / 70° either way (lying down the body turns with it); not for
    // ever — 3 s of sliding without getting 0.3 m nearer the goal and he counts as blocked (re-plan)
    const sx = this.x - P.x, sz = this.z - P.z, sl = Math.hypot(sx, sz), mt = this.moveTarget;
    const pr = this._bodyProg;
    if (sl > 1e-4 && this.path && mt && !(pr && pr.t > 3)) {
      for (const a of [0.61, -0.61, 1.22, -1.22]) {
        const ca = Math.cos(a), sa = Math.sin(a), dx = sx * ca - sz * sa, dz = sx * sa + sz * ca;
        // (a crawler's body turns toward the slide no faster than it is shown turning, art/prone-ground.js: the shown
        // body lags a heading that jumps, and swept through what he slid along — b00 Sapper's hands in the fuel tank)
        cands.push([P.x + dx, P.z + dz, front ? turnTowardsAngle(P.heading, Math.atan2(dz, dx), PRONE_TURN * dt) : this.heading, true, true]);
      }
    }
    // edging off it to turn: a man facing well away from his way on, whose turn toward it swings his head or legs into
    // the solid (lying with his head at a sandbag line, the way east behind him: both ways round sweep the bags), gives
    // ground first — a step straight away from it (the gap's gradient), turning as far as that leaves room, else not
    // turning. Without it no step or turn was ever clear: the order was taken and he never moved (stuck-orders soak,
    // m00 seed 3, the Sapper south of the compound sandbags). Counted as a slide (the 3 s no-progress rule).
    const wp = this.path?.[this.pathIndex];
    if (wp && mt && !(pr && pr.t > 3)) {
      const want = Math.atan2(wp.z - P.z, wp.x - P.x) + (this.moveHeadingOffset || 0);
      if (Math.hypot(wp.x - P.x, wp.z - P.z) > 0.05 && Math.abs(angleDiff(P.heading, want)) > 0.35) {
        const e = 0.05, gg = (dx, dz) => bodyGap(w, P.x + dx, P.z + dz, P.heading, st, ign);
        const gx = gg(e, 0) - gg(-e, 0), gz = gg(0, e) - gg(0, -e), gl = Math.hypot(gx, gz), bs = Math.max(sl, this.speed * dt);
        if (gl > 1e-4) {
          const bx = P.x + (gx / gl) * bs, bz = P.z + (gz / gl) * bs;
          cands.push([bx, bz, this.heading, true, true], [bx, bz, P.heading, true, true]);
        }
      }
    }
    if (!turning) cands.push(...turns);
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
          if (cp) { this.heading = cp.heading; this._turnInPlace = true; } // given up: at least lie clear of it where he is
          // a commando's walk order that ends here says so (never a man who just stops: "can't get there", Commando.issue)
          if (this.faction === 'player' && !this.pendingAbility && !this.currentAction) w.events?.emit('message', { text: `${this.nickname || this.role}: can't get there.`, kind: 'warn', unit: this });
        }
        else this._bodyRepaths = n;
      }
    }
    this._keepBodyPrev();
  }

  /** _guardBody's record of this step's pose: one object per man, refilled (P, the last one, is read before it). */
  _keepBodyPrev() {
    const o = this._bodyPrevO || (this._bodyPrevO = { x: 0.5, z: 0.5, heading: 0.5, stance: null });
    o.x = this.x; o.z = this.z; o.heading = this.heading; o.stance = this.stance;
    this._bodyPrev = o;
  }

  _followPath(dt) {
    const w = this.world;
    // Re-path if the grid changed under us (door closed, bridge destroyed…).
    // (not halfway over a wall: the climb finishes first)
    if (w && this._pathGridVersion !== w.grid.version && this.moveTarget && !this._climb && !this._ladder) {
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
    // (an arrival this step puts it back: _arrive) — one object per man, refilled (it is cleared before any next use)
    const to = this._trackOffO || (this._trackOffO = { x: 0.5, z: 0.5 });
    to.x = lx0; to.z = lz0;
    this._trackOff = to;
    // (on a flight of stairs a little slower, a careful jog when running; up / down a ladder at the ladder pace:
    // entities/stair-walk.js)
    // (a man with a heavy load turns before he walks off: Commando.pivotScale — 0 while he turns round on the spot)
    const pivot = this.pivotScale ? this.pivotScale() : 1;
    let step = (isLadderLeg(this.path[this.pathIndex]) ? ladderSpeed(this) : stairSpeed(this, this.speed)) * dt * this._avScale * pivot;
    this.trackV = step / dt; // pace along the path (route progress; the lane and curve ride on top)
    const stride = step, running = this.moveMode === 'run'; // (an arrival this step resets moveMode / path)
    let dirX = 0, dirZ = 0;
    let climbing = false, climbTurn = false;
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
      if (isLadderLeg(wp) && w) {
        // §3.2 ladders: up / down the ladder's line (the link's foot → its top) at the ladder pace, facing the ladder
        // all the way (going down he backs down it); the view puts his hands and feet on its rungs
        let C = this._ladder;
        if (!C || C.wp !== wp) C = this._ladder = ladderTrack(this, wp);
        const Le = C.Leff ?? C.len, use = Math.max(0, Math.min(step, Le - C.s));
        C.s += use; step -= use;
        const t = Le > 1e-6 ? C.s / Le : 1;
        this.x = C.from.x + (C.to.x - C.from.x) * t; this.z = C.from.z + (C.to.z - C.from.z) * t; this.y = C.from.y + (C.to.y - C.from.y) * t;
        dirX = C.fx; dirZ = C.fz;
        climbing = true;
        if (C.s < Le - 1e-9) break;
        this.x = wp.x; this.z = wp.z;
        if (wp.y !== undefined) this.y = wp.y;
        this._ladder = null; climbing = false;
        if (++this.pathIndex >= this.path.length) { this._arrive(); break; }
        continue;
      }
      if (wp.link?.kind === 'climb' && w) {
        // rule (e) climbs: over the wall's real top (placement.climbTrack), same duration as the flat crossing
        let C = this._climb;
        // (he starts the climb facing the wall: turned away from it — back the way he came over it — he turns round on
        // the spot first at his turn rate, not about in one frame as the climb began)
        if ((!C || C.wp !== wp) && Math.hypot(wp.x - this.x, wp.z - this.z) > 1e-3 && !LOW_STANCES.has(this.stance)) {
          const want = Math.atan2(wp.z - this.z, wp.x - this.x);
          if (Math.abs(angleDiff(this.heading, want)) > CLIMB_TURN) { dirX = Math.cos(want); dirZ = Math.sin(want); step = 0; climbTurn = true; break; }
        }
        if (!C || C.wp !== wp) {
          const T = climbTrack(w.grid, { x: this.x, z: this.z, y: this.y }, wp, { heightOf: ownerHeight(w), r: CLIMB_R });
          // (the leg's length at the climb pace: the flat crossing's — or, for a link whose climb that is far too quick
          // for (mission `climbLinks[].climbTime`, s: M2's palisade), its own time)
          const lk = w.grid.links?.find((l) => l.id === wp.link.id), tc = lk?.climbTime ?? wp.link.climbTime;
          C = this._climb = { wp, x: this.x, z: this.z, s: 0, T, Leff: Math.max(T.L, (tc ?? 0) * CONFIG.abilities.climbSpeed) };
        }
        const L = C.T.L, Le = C.Leff ?? L, use = Math.min(step, Le - C.s);
        C.s += Math.max(0, use); step -= Math.max(0, use);
        if (L > 1e-6) { dirX = (wp.x - C.x) / L; dirZ = (wp.z - C.z) / L; }
        const p = climbAt(C.T, Le > 1e-6 ? C.s / Le : 1);
        this.x = C.x + dirX * p.d; this.z = C.z + dirZ * p.d; this.y = p.y;
        climbing = true;
        // over the top he turns round and climbs down facing the wall (back and rifle away from it)
        if (p.d > C.T.L / 2 && p.y > (wp.y ?? 0) + 0.05) { dirX = -dirX; dirZ = -dirZ; }
        if (C.s < Le - 1e-9) break;
        this.x = wp.x; this.z = wp.z;
        if (wp.y !== undefined) this.y = wp.y;
        this._climb = null; climbing = false;
        if (++this.pathIndex >= this.path.length) { this._arrive(); break; }
        continue;
      }
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
    if (!dirX && !dirZ && pivot < 1 && this.path) { // turning round on the spot: toward his waypoint
      const wp = this.path[this.pathIndex], dx = wp.x - this.x, dz = wp.z - this.z, d = Math.hypot(dx, dz);
      if (d > 1e-6) { dirX = dx / d; dirZ = dz / d; }
    }
    if (this._trackOff) { // (no arrival this step: an arrival baked the lane into where he stopped, _arrive)
      this._trackOff = null;
      if (this.path) {
        this._applyCurve(dt);
        // a curve that ends abruptly (a re-path mid-corner, a patrol's next leg) hands its offset to the lane, which
        // eases it out: the body never jumps
        if (Math.hypot(this._curveX - cx0, this._curveZ - cz0) > 0.02) { this._laneX += cx0 - this._curveX; this._laneZ += cz0 - this._curveZ; }
        this._applyLane(av, dt);
        this._keepApart(av, x0, z0, stride, dt);
      } else { this.x += lx0; this.z += lz0; }
    }
    // a mission `noWalk` area (M3: the foot of the dam) is never stepped into, not even by a hair over a deck's edge: a
    // squad follower steered at a slot 2 mm past the E crest stair's landing dropped 7 m onto the ground in front of
    // the dam. The step is undone; a goal that lies in it counts as reached.
    const nw = w?.grid?.noWalk;
    if (nw && !climbing) {
      const g = w.grid;
      if (noWalkAt(g, nw, this.x, this.z) && !noWalkAt(g, nw, x0, z0)) {
        this.x = x0; this.z = z0;
        const goal = this.path?.[this.path.length - 1];
        if (this.path && (!goal || noWalkAt(g, nw, goal.x, goal.z))) this._arrive();
      }
    }
    // lying on a ramp / stair run (grid.addRun): his body never edges out toward its sides beyond where it clears them
    // (a crawler sent along a line that is not its axis — a captive led off it, a lane dodge — slid his legs over the
    // M3 E stair's side into the abutment rock); toward its middle he may (user 2026-10-08, "In the video the rapper
    // crosses the slide when crawling, fix to make it work properly")
    if ((this.stance === 'crawl' || this.stance === 'downed') && w?.grid?.runs) {
      const R = this._lyingRun();
      if (R) {
        const g = w.grid, q0 = g.runLocal(R, x0, z0), q1 = g.runLocal(R, this.x, this.z);
        const lim = Math.max(Math.abs(q0.v), R.lane / 2 - BODY.prone.r - 0.05);
        // (from on it only: a man lying beside it with his feet over its edge crawls off any way he likes)
        const on = q0.s >= 0 && q0.s <= R.L && Math.abs(q0.v) <= R.w / 2;
        if (on && Math.abs(q1.v) > lim && q1.s >= -BODY.prone.front && q1.s <= R.L + BODY.prone.front) { const p = g.runPoint(R, q1.s, Math.sign(q1.v) * lim); this.x = p.x; this.z = p.z; }
      }
    }
    this.vx = (this.x - x0) / dt; this.vz = (this.z - z0) / dt;
    // waiting: he shows walking while he still moves (hysteresis — a pace hovering near zero, or a sidestep while he
    // waits, must not flick walk / idle every few frames)
    const vNow = Math.hypot(this.vx, this.vz);
    this._moving = !av?.wait || (this._walkAnim ? this._avScale > 0.03 || vNow > 0.1 : this._avScale > 0.15 || vNow > 0.3);
    if (climbTurn) this._moving = false; // (turning on the spot before a climb: he stands and turns, no stride)
    // Surface height (§10.2 elev): raised areas are reached only through links, so snapping is safe.
    // The ABILITIES team animates link traversal (climb/ladder waypoints carry `link`, see findPath).
    // On a stair (grid ramps) he follows its slope rather than the cell steps, and steps on / off it (from the wall walk
    // beside it, the landing, the floor) ease over ~0.15 s instead of snapping a cell's height in one tick.
    // (On arrival he stands at the surface height.)
    // A walked link (a flight of stairs, a plank: entities/stair-walk.js) has its own line; a flight's nosing line is
    // the grid's surfaceY (world/stairs.js), eased onto / off like a ramp's.
    if (w && !climbing) {
      const g = w.grid, lw = this.path ? linkWalkY(this, this.path[this.pathIndex]) : null;
      const e = lw ?? (g.surfaceY ? g.surfaceY(this.x, this.z) : g.elevAt(this.x, this.z));
      if (e > 0 || this.y > 0) {
        const d = e - this.y;
        const slope = lw != null || (g.ramps && g.nearRamp(this.x, this.z)) || g.flights?.nearRun(this.x, this.z);
        this.y = this.path && slope && Math.abs(d) > 0.06 && Math.abs(d) <= MAX_STEP + 1e-3 ? this.y + Math.sign(d) * Math.min(Math.abs(d), 4 * dt) : e;
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
    // (a crawler turns no faster than his body is shown turning, art/prone-ground.js: a shown body lagging a quick turn
    // swept its legs through what the sim had checked clear — M2 diver at the barrier's pivot post)
    const tRate = this.moveTurnRate ?? this.turnRate, lying = this.stance === 'crawl' || this.stance === 'downed';
    if (dirX || dirZ) {
      const want = Math.atan2(dirZ, dirX) + lean + (this.moveHeadingOffset || 0), rate = (lying ? Math.min(tRate, PRONE_TURN) : tRate) * dt;
      let h = turnTowardsAngle(this.heading, want, rate);
      // lying on raised ground (a dam crest, a wall walk: _guardBody does not watch up there) he turns only with his
      // head and feet over the walk — about the other way when the short way swings his head over the parapet (an
      // about-turn on the M3 crest, clipping seed 7), not at all while neither way is clear. On a ramp / stair run
      // (grid.addRun: the M3 barn ramp, between its curbs) only as far as his whole body stays between its sides: sent
      // back the way he came, he goes feet first until he is off it (user 2026-10-08, "In the video the rapper crosses
      // the slide when crawling, fix to make it work properly")
      const run = lying ? this._lyingRun() : null;
      if (run) {
        // (the whole turn, not just this step: no heading on the way round may put any of him over a side)
        if (h !== this.heading && this._lyingOnRun(this.heading, run)) {
          const d = angleDiff(this.heading, want);
          const clear = (sgn, span) => { for (let a = 0; ; a = Math.min(span, a + Math.PI / 36)) { if (!this._lyingOnRun(this.heading + sgn * a, run)) return false; if (a >= span) return true; } };
          if (!clear(Math.sign(d), Math.abs(d))) h = clear(-Math.sign(d), 2 * Math.PI - Math.abs(d)) ? wrapAngle(this.heading - Math.sign(d) * rate) : this.heading;
        }
      } else if (lying && (this.y || 0) > 1 && h !== this.heading && this._lyingOnDeck(this.heading)) {
        h = this._deckTurnHeading(want, rate, h);
      } else if (lying && w?.grid && h !== this.heading && proneClear(w.grid, this.x, this.z, this.heading)) {
        // on the ground likewise: placement proneClear — his head, hands and feet off walls, fences, the standing
        // visuals and ledges (a man lying along a wall whose way turns back or away: his feet or head would swing into it)
        h = this._groundTurn(want, rate, h);
      } else if (lying && (this.y || 0) > 1 && h !== this.heading) {
        // (his heading is already off the deck's walkable cells — stepped off a stair run, where only his sides were
        // watched, onto a crest narrower than he is long: turning on toward his way would sweep his head over the
        // parapet, M3 seed 11: the Sapper's hand 14 cm into it) he turns back to the nearest heading with head and feet
        // over it, and from there the turn above goes on only as far as they stay over it
        h = this._deckEscape(want, rate, h);
      }
      this.heading = h;
    }
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
        // (never on a climb or a ladder: hands and boots on the rock face or the rungs print nothing in the snow below —
        // M5's east-face climb left a line of ground prints up the cliff that Patrol 19 followed from the field; the
        // pace keeps counting, so the prints before and after fall where they did)
        if (!climbing && (c === T.SNOW || c === T.SAND || c === T.MUD)) {
          w.events.emit('footprint', { x: this.x, z: this.z, heading: this.heading, t: w.time, owner: this, aiVisible: (c !== T.MUD || !!w.rules?.mudTracks) && this.faction === 'player' && !this.disguised, terrain: g.terrain, foot: footOf(this) }); // §4.8: a disguised Spy's boot prints read as a German's; BCD §1.10: soft paths leave tracks; a guard dog's paws are its own side's
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
    // (the plan into this man's own record: read only below, within this call)
    const pl = avoidPlan(this, fx, fz, this.speed, side ? -Math.sign(side) * Math.min(Math.abs(side), 0.15) : 0, this._planO || (this._planO = newPlan()));
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
    // (held off a man by the hard floor, _keepApart, counts too: a man standing in the way is walked through in the end)
    const stuck = pl.wait || cantPass || tight || this._apartHeld || (pl.block && Math.abs(this._laneSide(fx, fz)) >= A.laneMax - 1e-3);
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
    // (wait: any stop — the gait stops with him) — the man's own result record, refilled: read within this step's
    // _followPath only (its lane and its keep-apart)
    const r = this._avRes || (this._avRes = { fx: 0.5, fz: 0.5, shift: 0.5, wait: false, calm: true, hold: false });
    r.fx = fx; r.fz = fz; r.shift = pl.shift; r.wait = want === 0; r.calm = pl.calm; r.hold = (!!pl.block || !pl.calm) && priority(this) === 4;
    return r;
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
    // (one options object refilled: walkableLine only reads it while it runs — asked many times a step per man)
    _LF.elevRef = g.elevAt(px, pz);
    return g.walkableLine(px, pz, px + ax * k, pz + az * k, _LF);
  }

  /**
   * The hard floor between the commandos of a group (CONFIG.units.avoid.sep), after the plan, the walls' cut of the
   * lane and the corner curve: this tick's step may not take a commando nearer than `sep` to a teammate he keeps clear
   * of (avoidance.blocks; not one he squeezes past, _ghostIds), and he closes in on one no faster than he can stop short
   * of that floor at a walker's braking (CONFIG.units.avoid.brake) — the part of the step towards the man is cut to
   * that, the part round him kept. Along his way it is walked less (the track gives it back, the pace eases off with
   * it), across it the lane takes it. A dodge cut back by a wall, a lane reversing too late or a mate overtaken on a
   * narrow deck never walks one man of a group into another (m00 bridge between its end posts, clip-2). The enemy's
   * walkers keep their own tuned coordination (patrol timing, squads out of a door, couriers: mission scripts).
   */
  _keepApart(av, x0, z0, stride, dt) {
    const A = CONFIG.units.avoid, w = this.world, sep = A.sep;
    this._apartHeld = false;
    if (!av || !sep || this.faction !== 'player' || !w?.entitiesInRadius) return;
    let mx = this.x - x0, mz = this.z - z0;
    const m = Math.hypot(mx, mz);
    if (m < 1e-6) return;
    const ghosts = this._ghostIds || [], v = m / dt;
    const near = w.entitiesInRadius(x0, z0, sep + (v * v) / (2 * A.brake) + m + 0.05, (n) => n.faction === this.faction && blocks(this, n) && !ghosts.includes(n.id));
    if (!near.length) return;
    let hit = false;
    for (const n of near) {
      const rx = x0 - n.x, rz = z0 - n.z, r0 = Math.hypot(rx, rz);
      if (r0 < 1e-6) continue;
      // (inside the floor already: no closer at all)
      const ux = rx / r0, uz = rz / r0, rad = mx * ux + mz * uz, gap = Math.max(0, r0 - sep);
      const allow = -Math.min(gap, Math.sqrt(2 * A.brake * gap) * dt);
      if (rad >= allow) continue;
      mx += (allow - rad) * ux; mz += (allow - rad) * uz;
      hit = true;
    }
    if (!hit) return;
    const cx = x0 + mx - this.x, cz = z0 + mz - this.z, along = cx * av.fx + cz * av.fz;
    this.x += cx; this.z += cz;
    this._laneX += cx - along * av.fx; this._laneZ += cz - along * av.fz; // (the along part: the track walked less)
    if (along < 0 && stride > 1e-6) {
      const kept = Math.max(0, 1 + along / stride);
      this._avScale *= kept; this.trackV *= kept;
      this._apartHeld = kept < 0.5;
    }
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
    const on = standersNear(this, w, A, 0.8);
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
    // (a Green Beret dug in with the shovel cannot move: §3.4 — he was shoved through the snow by men walking over him)
    if (!A.on || this.state === 'dead' || this.carriedBy || this.vehicle || this.buried || (this.stance !== 'stand' && this.stance !== 'crouch')) return;
    const on = standersNear(this, w, A, 0.6);
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
      // (his body, not just his centre, stays on the deck: on a stair the level run is across the treads, and a man
      // eased that way stopped with his centre on the last tread cell's edge and his shoulder in the rock beside the M3
      // dam's E stair — clipping seed 7)
      const reach = BODY.stand.r + STOP_MARGIN;
      if (same(x, z) && same(x + Math.cos(a0) * reach, z + Math.sin(a0) * reach)) { this.x = x; this.z = z; }
      return;
    }
    for (const da of [0, 45, -45, 90, -90]) {
      const a = a0 + (da * Math.PI) / 180, x = this.x + Math.cos(a) * step, z = this.z + Math.sin(a) * step;
      if (!same(x, z)) continue;
      this.x = x; this.z = z;
      return;
    }
  }

  /**
   * Lying at heading h on raised ground, are his head and feet (BODY.prone front / back) over walkable cells of his
   * deck (no drop of a metre or more: a stair's slope passes, the crest's edge over the dam face does not)?
   */
  _lyingOnDeck(h) {
    const g = this.world?.grid;
    if (!g) return true;
    const S = BODY.prone, e0 = g.elevAt(this.x, this.z), c = Math.cos(h), s = Math.sin(h);
    for (const d of [S.front, -S.back]) {
      const x = this.x + c * d, z = this.z + s * d;
      if (!g.walkableAt(x, z) || Math.abs(g.elevAt(x, z) - e0) >= 1) return false;
    }
    return true;
  }

  /**
   * Lying on raised ground with head and feet over the deck at his heading, the heading for this step's turn toward
   * `want` (`h`: the plain step at `rate`) through headings where they stay over it (_lyingOnDeck; the whole turn, not
   * just this step — a turn begun and turned back at the first blocked step swung him from side to side the whole
   * length of the M3 crest): the short way, else the long way round, else his body along his way feet first (want + π)
   * when that turn fits, else he keeps his heading until his crawl takes him where one does (the ground's _groundTurn).
   */
  _deckTurnHeading(want, rate, h) {
    const H = this.heading;
    const clear = (sgn, span) => { for (let a = 0; ; a = Math.min(span, a + Math.PI / 36)) { if (!this._lyingOnDeck(H + sgn * a)) return false; if (a >= span) return true; } };
    const d = angleDiff(H, want);
    if (clear(Math.sign(d), Math.abs(d))) return h;
    if (clear(-Math.sign(d), 2 * Math.PI - Math.abs(d))) return wrapAngle(H - Math.sign(d) * rate);
    const db = angleDiff(H, want + Math.PI);
    if (Math.abs(db) > 1e-4 && clear(Math.sign(db), Math.abs(db))) return turnTowardsAngle(H, want + Math.PI, rate);
    return H;
  }

  /**
   * Lying on raised ground with head or feet off the deck's walkable cells at his heading (_lyingOnDeck): this step's
   * heading — a step of `rate` toward the nearest heading (either way round, up to half a turn) at which both are over
   * it; `h` (the plain step toward his way) when there is none.
   */
  _deckEscape(want, rate, h) {
    const H = this.heading;
    for (let a = Math.PI / 36; a <= Math.PI + 1e-9; a += Math.PI / 36) {
      const ccw = this._lyingOnDeck(H + a), cw = this._lyingOnDeck(H - a);
      if (!ccw && !cw) continue;
      // (both: the way nearer his own)
      const sgn = ccw && cw ? Math.sign(angleDiff(H, want)) || 1 : ccw ? 1 : -1;
      return wrapAngle(H + sgn * Math.min(rate, a));
    }
    return h;
  }

  /**
   * Lying on the ground, the heading for this step's turn toward `want` (`h`: the plain step at `rate`), through
   * headings where all of him fits only (placement proneClear; the whole turn, not just this step): the short way,
   * else the long way round, else his body along his way feet first (want + π) when that turn fits, else he keeps his
   * heading until his crawl takes him where one does (M3 start: lying along start_wall 0.95 m off it, sent back the
   * other way — there is no room to turn round; the precedent: a crawler sent back down a ramp, feet first).
   */
  _groundTurn(want, rate, h) {
    const g = this.world.grid, H = this.heading;
    const clear = (sgn, span) => { for (let a = 0; ; a = Math.min(span, a + Math.PI / 36)) { if (!proneClear(g, this.x, this.z, H + sgn * a)) return false; if (a >= span) return true; } };
    const d = angleDiff(H, want);
    if (clear(Math.sign(d), Math.abs(d))) return h;
    if (clear(-Math.sign(d), 2 * Math.PI - Math.abs(d))) return wrapAngle(H - Math.sign(d) * rate);
    const db = angleDiff(H, want + Math.PI);
    if (Math.abs(db) > 1e-4 && clear(Math.sign(db), Math.abs(db))) return turnTowardsAngle(H, want + Math.PI, rate);
    return H;
  }

  /** The ramp / stair run (grid.addRun, `align`) any of his lying body is on — pelvis, head or feet — or null. */
  _lyingRun() {
    const g = this.world?.grid;
    if (!g?.runs) return null;
    const S = BODY.prone, c = Math.cos(this.heading), s = Math.sin(this.heading);
    for (const d of [0, S.front, -S.back]) { const R = g.runAt(this.x + c * d, this.z + s * d); if (R?.align) return R; }
    return null;
  }

  /**
   * Lying at heading h on ramp / stair run R (grid.addRun), is his whole body — head, feet and both sides of them
   * (BODY.prone) — between its sides (within its lane: the M3 barn ramp's curbs)? Parts past its foot or head are clear.
   */
  _lyingOnRun(h, R) {
    const g = this.world.grid, S = BODY.prone, c = Math.cos(h), s = Math.sin(h), half = R.lane / 2 + 0.02;
    for (const d of [S.front - S.r, -(S.back - S.r)]) for (const k of [-S.r, 0, S.r]) {
      const q = g.runLocal(R, this.x + c * d - s * k, this.z + s * d + c * k);
      if (q.s >= 0 && q.s <= R.L && Math.abs(q.v) > half) return false;
    }
    return true;
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
    // (a flight of stairs too: two men meeting on it go by as on a narrow walk — entities/stair-walk.js railShift keeps
    // each between its rails; low on it, a lane is no wider than his band there)
    const room = this.world?.grid?.flights?.size ? railRoom(this) : null;
    const raised = (this.y || 0) > 0.3, laneMax = room != null ? Math.min(A.laneMax, room) : A.laneMax;
    const soft = raised ? 0 : keep ? laneMax : Math.min(laneMax, 0.3 * dEnd), cap = raised ? 0 : keep ? laneMax : Math.min(laneMax, 0.6 * dEnd);
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
      let f = 1;
      while (f > 0 && !(this._laneFits(this.x, this.z, nx * f, nz * f) && (!ah || this._laneFits(ah.x, ah.z, nx * f, nz * f)))) f = Math.max(0, f - 0.1);
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
      // (_turnInPlace: the shown body pivots about his hips like the sweep checked here, not about the chest)
      if (cp && !cp.moved) { this.heading = cp.heading; this._turnInPlace = true; }
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
      if (w && bodyGap(w, this.x, this.z, h, st) >= bodyGap(w, this.x, this.z, this.heading, st)) { this.heading = h; this._turnInPlace = true; }
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
        ? { avoid: [this._laneX, this._laneZ, this._laneV, this._avScale, this.vx, this.vz, this._blockT, this._ghostIds, this._curveX, this._curveZ, this._mdirX, this._mdirZ, this._holdFor, this._yieldAt, this._ghostT, this._leanV, this.trackV, this._curveF ?? null, !!this._apartHeld] } : null),
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
    [this._laneX, this._laneZ, this._laneV, this._avScale, this.vx, this.vz, this._blockT, this._ghostIds, this._curveX = 0, this._curveZ = 0, this._mdirX = 0, this._mdirZ = 0, this._holdFor = null, this._yieldAt = null, this._ghostT = null, this._leanV = 0, this.trackV = 0, this._curveF = null, this._apartHeld = false] = d.avoid || [0, 0, 0, 1, 0, 0, 0, null];
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
