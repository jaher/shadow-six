/**
 * Enemy — a soldier with vision, a patrol route or a guard post, an alert level and a brain.
 * The brain (ai/enemy-brain.js, AI owner) drives behaviour; this class holds the shared state.
 * Foundation owns this base; AI may extend it backwards-compatibly.
 * @module entities/enemy
 */

import { Unit } from './unit.js';
import { CONFIG, visionProfileFor } from '../config.js';
import { createBrain } from '../ai/enemy-brain.js';
import { bcdModelOpts, bcdEnemyInit, bcdSerialize, bcdDeserialize } from '../ai/bcd-enemy.js';
import { ANIMAL_TYPES } from '../ai/bcd-ranks.js';

export class Enemy extends Unit {
  /**
   * @param {object} spawn mission enemy entry:
   *   {soldierType, x, z, heading, route?:[{x,z,wait?,look?}], routeMode?:'loop'|'pingpong',
   *    post?:{scan?:[headings], period?}, vision?:{…}, weapon?, id?}
   */
  constructor(spawn) {
    const soldierType = spawn.soldierType || 'soldier';
    const bcd = bcdModelOpts(soldierType, spawn); // BCD unit types: placeholder tint / animal mesh ({} for BEL types)
    super({
      kind: 'enemy',
      faction: 'enemy',
      role: 'enemy',
      x: spawn.x,
      z: spawn.z,
      heading: spawn.heading ?? 0,
      tag: spawn.id ?? null,
      hp: spawn.hp,
      model: bcd.model,
      modelOpts: { soldierType, colors: spawn.colors, spawnId: spawn.id ?? null, squad: spawn.squad?.id ?? spawn.squad ?? null, x: spawn.x, z: spawn.z, ...(bcd.modelOpts || {}) },
    });
    this.soldierType = soldierType;
    /** Runtime vision (radians + metres), see makeVision() (§4.2, §10.4 #8). null = no cone (truckDriver). */
    this.vision = makeVision(soldierType, spawn);
    /** §4.5 nervousness N and threshold T (per spawn, default 50). Updated at 20 Hz by the AI. */
    this.nervousness = 0;
    this.nervThreshold = spawn.nervousness ?? CONFIG.ai.nervousness.T;
    /** §4.6 BODY: permanent once a body was seen. §4.3: saw a commando kill. */
    this.sawBody = false;
    this.sawKill = false;
    /** Current target (commando/vehicle) of CHALLENGE/HOLD/COMBAT, or null (test API `target`). */
    this.target = null;
    /** §4.3 witness memory {target, x, z, t} | null. */
    this.lastSeen = null;
    /** §7.3 behaviour flags: holdsPost | investigates, followsTracks, ignoresBodies, raisesAlarmOnSight, firesOnSight. */
    this.flags = { holdsPost: false, investigates: false, followsTracks: false, ignoresBodies: false, raisesAlarmOnSight: false, firesOnSight: false, ...(spawn.flags || {}) };
    /** §7.3 squad {id, leader, columns}, partner id, jail id, route VEL (m/s = vel × 0.9). */
    this.squad = spawn.squad ?? null;
    this.partner = spawn.partner ?? null;
    this.jail = spawn.jail ?? null;
    this.vel = spawn.route?.vel ?? spawn.vel ?? CONFIG.ai.defaultVel;
    if (spawn.y !== undefined) this.y = spawn.y;
    /** @type {{x:number, z:number, wait?:number, look?:number}[] | null} */
    const pts = Array.isArray(spawn.route) ? spawn.route : spawn.route?.points;
    this.route = pts && pts.length ? pts.map((p) => ({ ...p })) : null;
    /** 'loop' | 'pingpong' (§4.1 LOOP / PINGPONG; mission route.type is upper-case). */
    this.routeMode = (spawn.route?.type || spawn.routeMode || 'pingpong').toLowerCase();
    /** Static post for guards (also the "home" a patroller returns to is its route). */
    this.post = this.route
      ? null
      : {
          x: spawn.x,
          z: spawn.z,
          heading: spawn.post?.heading ?? spawn.heading ?? 0,
          sweep: spawn.post?.sweep ?? null, // degrees (§4.2) — null = profile default
          period: spawn.post?.period ?? null,
          scan: spawn.post?.scan ?? null,
          scanPeriod: spawn.post?.period ?? CONFIG.stealth.vision.soldier.period,
          giro: spawn.post?.giro ?? spawn.giro ?? null, // MG traverse (deg total) around `heading` (§4.1)
        };
    /** CONFIG.weapons key (§4.1 roster; null = unarmed). */
    this.weapon = spawn.weapon !== undefined ? spawn.weapon : (DEFAULT_WEAPON[soldierType] ?? 'rifle');
    /** 0 calm, 1 suspicious, 2 alerted (drives cone colour). */
    this.alertLevel = 0;
    /** Player toggled the cone display. */
    this.coneVisible = false;
    this.turnRate = CONFIG.units.enemyTurnRate;
    this.spawn = spawn;
    /** BCD (bcd-plan §1.1–§1.3): knock-out state 'stunned' | 'bound' | null, wake timer, puppet controller. */
    this.ko = null;
    this.koT = 0;
    this.puppetOf = null;
    this.brain = createBrain(this);
  }

  /** BCD: unconscious, cuffed or puppeted — no cone, no reactions (always false under BEL). */
  get incapacitated() {
    return !!this.ko || !!this.puppetOf || (!!this.knockedDown && (this.world?.time ?? 0) < this.knockedDown.until);
  }

  onAdded(world) {
    if (world.rules?.id === 'BCD') bcdEnemyInit(this, world);
    if (ANIMAL_TYPES.includes(this.soldierType) && !world.rules?.animals) this.brain = createBrain(this, world.rules ?? {}); // ruleset-gated AnimalBrain
    this.brain.attach?.(world);
  }

  /** Brain state name (for UI/tests). */
  get brainState() {
    return this.brain?.state ?? 'none';
  }

  update(dt) {
    if (this.alive) this.brain.update(dt);
    // held by a contact knife kill (abilities/knife.js): his brain runs, but he neither walks nor turns until the blade
    // goes in (transient: never saved; it lapses on its own)
    const H = this.knifeHold;
    if (H && this.alive) {
      if ((this.world?.time ?? 0) <= H.until) { if (this.path) this.stop(); this.x = H.x; this.z = H.z; this.heading = H.h; }
      else this.knifeHold = null;
    }
    super.update(dt);
  }

  die(cause, killer, o) {
    if (this.puppetOf) { this.puppetOf.puppet = null; this.puppetOf = null; } // BCD: a killed puppet / captive
    this.ko = null;
    this.knifeHold = null;
    super.die(cause, killer, o);
    this.alertLevel = 0;
    this.brain.onDeath?.(cause, killer);
  }

  serialize() {
    return {
      ...super.serialize(),
      soldierType: this.soldierType,
      alertLevel: this.alertLevel,
      nervousness: this.nervousness,
      sawBody: this.sawBody,
      sawKill: this.sawKill,
      targetId: this.target ? this.target.id : null,
      coneVisible: this.coneVisible,
      ...(this.knockedDown ? { knockedDown: { ...this.knockedDown } } : null), // bodies-design §A.5
      // §10.5 replay: movement speed and head control the brain set on the body (e.g. _go's 1.8 m/s investigate walk)
      vel: this.vel, routeMode: this.routeMode, idleAnim: this.idleAnim ?? null,
      headOffset: this.headOffset ?? 0, sweepActive: !!this.sweepActive,
      sweepAmp: this.sweepAmp ?? null, sweepPeriod: this.sweepPeriod ?? null,
      sweepW: this.sweepW ?? null, headCarry: this.headCarry || 0, // smooth turn: sweep weight, head carried round (perception)
      lastSeen: this.lastSeen ? { ...this.lastSeen, target: this.lastSeen.target?.id ?? null } : null,
      lastHurtBy: this.lastHurtBy ? { ...this.lastHurtBy } : null,
      brain: this.brain.serialize?.() ?? null,
      ...(this.world?.rules?.id === 'BCD' ? { bcd: bcdSerialize(this) } : null),
    };
  }

  deserialize(d) {
    super.deserialize(d);
    this.alertLevel = d.alertLevel ?? 0;
    this.nervousness = d.nervousness ?? 0;
    this.sawBody = !!d.sawBody;
    this.sawKill = !!d.sawKill;
    this._targetId = d.targetId ?? null; // resolved by the brain via world.byId after load
    this.coneVisible = !!d.coneVisible;
    this.knockedDown = d.knockedDown ? { ...d.knockedDown } : null;
    if (d.vel !== undefined) this.vel = d.vel;
    if (d.routeMode) this.routeMode = d.routeMode;
    if (d.idleAnim !== undefined) this.idleAnim = d.idleAnim ?? undefined;
    if (d.headOffset !== undefined) this.headOffset = d.headOffset;
    if (d.sweepActive !== undefined) this.sweepActive = d.sweepActive;
    if (d.sweepAmp !== undefined) this.sweepAmp = d.sweepAmp ?? undefined;
    if (d.sweepPeriod !== undefined) this.sweepPeriod = d.sweepPeriod ?? undefined;
    if (d.sweepW !== undefined) this.sweepW = d.sweepW ?? undefined;
    if (d.headCarry !== undefined) this.headCarry = d.headCarry || 0;
    if (d.lastSeen !== undefined) {
      const ls = d.lastSeen;
      this.lastSeen = ls ? { ...ls, target: ls.target != null ? this.world?.byId(ls.target) ?? null : null } : null;
    }
    if (d.lastHurtBy !== undefined) this.lastHurtBy = d.lastHurtBy ? { ...d.lastHurtBy } : null;
    if (d.brain) this.brain.deserialize?.(d.brain);
    if (d.bcd) bcdDeserialize(this, d.bcd);
  }
}

const DEG = Math.PI / 180;

/** §4.1 roster weapons per soldierType (null = unarmed; crews/gunners use their vehicle's weapons). */
export const DEFAULT_WEAPON = {
  sentry: 'rifle', soldier: 'rifle', sergeant: 'luger', trooper: 'mp40', mg: 'mg', officer: null,
  truckDriver: null, courier: null, crew: null, gunner: null, engineer: null, general: null, dog: 'dogBite',
  tutorial: null,
};

/**
 * Build an enemy's runtime vision from its soldierType profile (CONFIG.stealth.vision, degrees) and the
 * spawn overrides (§4.2, §7.3). Angles are RADIANS at runtime (`fov` = full aperture, `sweep` = amplitude);
 * `fovDeg`/`sweepDeg` keep the degree values. `range`/`nearRange` are legacy aliases of far/near.
 * Spawn overrides: `vision:{fov°, near, far, sweep°, period, elliptical}`, `post:{sweep°, period}`,
 * `elevated`, `overlooks` (a balcony sentry who sees down past the roof rule, M12), `overWalls` (an MG gunner on an
 * open platform sees over walls lower than his sight line, M2), `y`. ellipseMode 'short' scales ranges by CONFIG.stealth.shortRangeMul.
 * @param {string} soldierType
 * @param {object} [spawn]
 * @returns {object|null}
 */
export function makeVision(soldierType, spawn = {}) {
  const S = CONFIG.stealth;
  const prof = visionProfileFor(soldierType);
  if (!prof) return null;
  const o = spawn.vision || {};
  const fovDeg = o.fov ?? prof.fov;
  const sweepDeg = spawn.post?.sweep ?? o.sweep ?? prof.sweep;
  const mul = S.ellipseMode === 'short' ? S.shortRangeMul : 1;
  const far = (o.far ?? prof.far) * mul;
  const near = (o.near ?? prof.near) * mul;
  return {
    profile: S.profileByType[soldierType] ?? 'soldier',
    fov: fovDeg * DEG, fovDeg,
    near, far, range: far, nearRange: near,
    sweep: sweepDeg * DEG, sweepDeg,
    period: spawn.post?.period ?? o.period ?? prof.period,
    elliptical: o.elliptical ?? prof.elliptical,
    ellipseRatio: S.ellipseMode === 'wide' ? 1 : S.ellipseRatio,
    eyeHeight: S.eyeHeight,
    elevated: !!(spawn.elevated ?? o.elevated ?? false),
    overlooks: !!(spawn.overlooks ?? o.overlooks ?? false),
    overWalls: !!(spawn.overWalls ?? o.overWalls ?? false), // sees (and fires) over walls under his sight line (open MG platforms)
    phase: 0, // φ (s): the AI seeds it from world.rng on attach (§4.2)
  };
}
