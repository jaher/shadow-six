/**
 * EnemyBrain — owned by AI (design-spec §4.1, §4.3–§4.7, §4.10). Priority arbitration in the style of
 * BEL's CARISMA over the §4.6 states:
 *   IDLE | INVESTIGATE | DECOY | TRACKS | BODY | CHALLENGE | HOLD | ARREST | COMBAT | SEARCH | RETURN |
 *   DISTRACTED | ALARM_RUN | REINFORCE | DEAD
 *
 * Per sim step (60 Hz): perception (cone + LOS, perception.perceive), state behaviour, movement orders,
 * head control (enemy.sweepActive / headOffset, read by perception.coneAt and the drawn cone).
 * Per 20 Hz BEL tick (world.onBelTick via world.ai): the §4.5 nervousness rule N (decay, displacement²,
 * close range, sawBody bonus) and the N ≥ T → CHALLENGE transition.
 *
 * Public API (ARCHITECTURE "Cross-team interfaces"): state, hear(noise), distractBy(spy),
 * releaseDistraction(), notifyKill(victim, killer), isAware(), onBodyFound(body), attach(world), update(dt),
 * onAlarm(x, z, cause), onDeath(), serialize()/deserialize(). Extra hooks used by world.ai / alarm:
 * belTick(dt20), onHurt(src), onBoardSeen(vehicle, unit), onSuspiciousAct(spy), onTargetAttacked(unit),
 * onTargetGone(unit), reinforce(exitRoute, loop, {loopVel}), reacts().
 * @module ai/enemy-brain
 */

import { CONFIG, velToSpeed } from '../config.js';
import { hasObstacles, bodyGap, MOVE_MARGIN } from '../world/body-clearance.js';
import { angleTo, angleDiff, wrapAngle } from '../core/math.js';
import { perceive, canSee, hears, coneAt } from './perception.js';
import { archetypeOf, isPatrolMember } from './archetypes.js';
import { ensureAI } from './director.js';
import { BCD_BRAIN_STATES } from './bcd-enemy.js';
import { AnimalBrain } from './animal-brain.js';
import { ANIMAL_TYPES } from './bcd-ranks.js';
import { bcdPre, bcdScan, bcdOnSeen, bcdState, bcdExit, bcdOfficerLook } from './bcd-brain.js';
import { blocks as blocksUnit } from '../entities/avoidance.js';

/** A noise-driven turn needs this long (s) before what he now faces counts for a kill witness (notifyKill). */
const NOISE_WITNESS_DELAY = 0.3;

/** Spec brain states (design-spec §4.6). */
export const BRAIN_STATES = Object.freeze(['IDLE', 'INVESTIGATE', 'DECOY', 'TRACKS', 'BODY', 'CHALLENGE', 'HOLD',
  'ARREST', 'COMBAT', 'SEARCH', 'RETURN', 'DISTRACTED', 'ALARM_RUN', 'REINFORCE', 'DEAD']);

/** §4.6 priority arbitration values (highest runnable wins). */
export const BRAIN_PRIORITY = Object.freeze({ DEAD: 999, SPECIAL_SCRIPT: 600, COMBAT: 500, CHALLENGE: 500, HOLD: 500,
  ARREST: 500, RAISE_ALARM: 450, WATCH: 400, SEARCH: 300, INVESTIGATE: 300, DECOY: 300, BODY: 300, DISTRACTED: 250,
  ROUTE: 200, POST: 200, IDLE: 200, RETURN: 200, REINFORCE: 200, ALARM_RUN: 600, TRACKS: 100 });

const DEG = Math.PI / 180;
/** DECOY stand-off slots (unit separation): angular step between investigators and minimum gap (m). */
const DECOY_SLOT_ANGLE = 50 * DEG;
const DECOY_SLOT_GAP = 1.2;
const AWARE = new Set(['CHALLENGE', 'HOLD', 'ARREST', 'COMBAT', 'ALARM_RUN']);
/** States in which a newly seen body / wounded comrade / print may take over. */
const CALM = new Set(['IDLE', 'REINFORCE', 'RETURN', 'INVESTIGATE', 'DECOY', 'TRACKS', 'SEARCH', 'DISTRACTED']);
/** Player lure noises whose post-holder turn is flagged ('enemy:noise-turn'). */
const LURES = new Set(['decoy', 'phone', 'horn']);

/** States that ignore level-1/2 noises (already busy with something more important). */
const BUSY = new Set(['CHALLENGE', 'HOLD', 'ARREST', 'COMBAT', 'BODY', 'ALARM_RUN', 'DEAD']);
const ALERT_OF = { IDLE: 0, REINFORCE: 0, RETURN: 0, DISTRACTED: 0, INVESTIGATE: 1, DECOY: 1, TRACKS: 1, BODY: 1,
  SEARCH: 1, CHALLENGE: 1, HOLD: 1, ARREST: 1, COMBAT: 2, ALARM_RUN: 2, DEAD: 0 };


/** Unit direction of the last ≥ 0.5 m of a breadcrumb trail ending at e (falls back to e's heading). */
function trailDir(tr, e) {
  for (const p of tr) {
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
    if (d >= 0.5) return { x: dx / d, z: dz / d };
  }
  return { x: Math.cos(e.heading), z: Math.sin(e.heading) };
}
export class EnemyBrain {
  /** @param {import('../entities/enemy.js').Enemy} enemy */
  constructor(enemy) {
    this.enemy = enemy;
    this.arch = archetypeOf(enemy);
    /** Home state: IDLE, or REINFORCE for released barracks squads (§4.9). */
    this.idleState = 'IDLE';
    this.state = 'IDLE';
    this.t = 0; // time in state (s)
    this.phase = null; // sub-phase inside a state
    this.pt = 0; // time in phase (s)
    this.routeIndex = 0;
    this.routeDir = 1;
    this.waitT = 0;
    this.atWait = false;
    this.target = null;
    this.anchor = null; // held commando position (§4.5 0.3 m rule)
    this.aimT = 0;
    this.fireT = 0;
    this.burstLeft = 0;
    this.roundT = 0;
    this.lostT = 0;
    this.shoutT = -1e9;
    this.goal = null; // {x, z, ...} of INVESTIGATE / DECOY / BODY / TRACKS / SEARCH / ALARM_RUN
    this._trail = null; // {ownerId, t}: the trail last followed in TRACKS (its prints do not restart TRACKS)
    this.searchPts = null;
    this.noiseTurnT = 0; // holdsPost: sweep re-centred on a noise (§4.4) for 8 s
    this.alertT = 0; // holdsPost: alertLevel raised by a noise
    this.alertBoost = 0;
    // SHADOW SIX runningNoise: suspicion from heard running steps (+1 per step heard, decays stealth.runNoise.susp.decay/s)
    this.stepSusp = 0;
    this.stepT = null; // sim time of the last step heard
    this._stepBarkT = null; // last "Was war das?" at a step (one per susp.barkEvery s)
    this.glanceT = 0; // partner glance (§4.6)
    this.stuckT = 0; // panic unstick (§4.6)
    this.wanderT = 0;
    this.distractedBy = null;
    this.world = null;
    this._seen = [];
    this._stuckRef = null;
    this._repathT = 0;
  }

  /** Called when the enemy is added to the world. */
  attach(world) {
    this.world = world;
    /** BCD ruleset extension (bcd-brain.js): knock-outs, stones, packs, puppets… Never true under BEL. */
    this.bcd = world.rules?.id === 'BCD';
    const ai = ensureAI(world);
    const e = this.enemy;
    e.vision && (e.vision.phase = world.rng.next() * CONFIG.stealth.sweepPhaseMax); // §4.2 φ, seeded
    this.routeVel = e.vel;
    if (e.route) this._pickNearestWaypoint();
    if (this.routeType === 'STOPPED' || !e.route) this._home = { x: e.x, z: e.z };
    if (e.squad?.id) {
      const sq = ai.squad(e.squad.id);
      sq.members.add(e);
      const lead = e.squad.leader;
      if (lead === e.tag || lead === e.id || (!lead && !sq.leader && e.soldierType === 'sergeant')) sq.leader = e;
    }
    this.glanceT = CONFIG.ai.partnerGlance.every;
    this._applyHead();
  }

  get routeType() {
    return (this._routeType || this.enemy.spawn?.route?.type || this.enemy.routeMode || 'PINGPONG').toUpperCase();
  }

  /** Does this enemy react to commandos at all (§4.1: officers, generals, drivers do not)? */
  reacts() {
    return this.arch.reacts && this.enemy.alive;
  }

  _set(state, phase = null) {
    const e = this.enemy;
    const from = this.state;
    this.phase = phase;
    this.pt = 0;
    if (state === from) return;
    if (this.bcd) bcdExit(this, from, state);
    this.state = state;
    this.t = 0;
    if (!AWARE.has(state) && from !== state) {
      e.idleAnim = 'idle';
    }
    if ((from === 'CHALLENGE' || from === 'HOLD') && state !== 'CHALLENGE' && state !== 'HOLD') this._refreshHeld(this.target);
    if (state === 'IDLE' || state === 'REINFORCE' || state === 'RETURN') { this.target = null; e.target = null; }
    this._updateAlert();
    this.world?.events.emit('enemy:state', { enemy: e, from, to: state });
  }

  _updateAlert() {
    const e = this.enemy;
    let lvl = ALERT_OF[this.state] ?? 0;
    if (e.nervousness > 0 || this.alertT > 0) lvl = Math.max(lvl, this.alertT > 0 ? this.alertBoost : 1);
    if (this.world?.alarm?.active && this.state === 'REINFORCE') lvl = 2;
    if (!e.alive) lvl = 0;
    e.alertLevel = lvl;
  }

  /** Move with a given speed (m/s): the unit's speed getter reads vel × 0.9 (walk) or chaseSpeed (run). */
  _go(x, z, speed, opts = {}) {
    const e = this.enemy;
    const run = Math.abs(speed - CONFIG.ai.chaseSpeed) < 1e-6; // 'run' = the 3.8 m/s chase stride; other speeds walk at vel
    e.vel = speed / CONFIG.ai.velMul;
    const ok = e.moveTo(x, z, { run });
    this._stuckRef = { x: e.x, z: e.z, t: 0 };
    if (!ok && opts.fallback !== false) {
      const g = this.world.grid.nearestWalkable?.(x, z, 3);
      if (g) return e.moveTo(g.x, g.z, { run });
    }
    return ok;
  }

  /** Head control: sweep on/off (A rad, P s) or a fixed offset. */
  _sweep(on, A = null, P = null) {
    const e = this.enemy;
    e.sweepActive = !!on;
    e.sweepAmp = A ?? undefined;
    e.sweepPeriod = P ?? undefined;
    if (on) e.headOffset = e.headOffset || 0;
  }

  _look(offset = 0) {
    const e = this.enemy;
    e.sweepActive = false;
    e.headOffset = offset;
  }

  /** Default head behaviour for the idle state (posts sweep continuously; walkers only at waits). */
  _applyHead() {
    const e = this.enemy;
    if (!e.route || this.routeType === 'STOPPED') this._sweep(true);
    else this._look(0);
    e.headOffset = 0;
  }

  _dist(o) {
    return Math.hypot(o.x - this.enemy.x, o.z - this.enemy.z);
  }

  // ------------------------------------------------------------ public API: stimuli

  /**
   * A noise reached this enemy (world 'noise' payload {x, z, radius, kind, level, source}) (§4.4).
   * @param {object} n
   * @param {boolean} [relayed] passed on by a squad member who heard it (running steps: the leader reacts whatever
   *   his own distance to them)
   */
  hear(n, relayed = false) {
    const e = this.enemy;
    if (!e.alive || !this.world || !(relayed || hears(e, n))) return;
    const lvl = n.level ?? 1;
    const S = this.state;
    // BCD: REVIVE / FLEE / REPORT are busy at every level (a revive is never dropped for a comrade's alarm shout —
    // that re-queued the man on the ground for the next finder, a shout/revive livelock); lipstick breaks at ≥ 2
    if (this.bcd && (e.incapacitated || S === 'REVIVE' || S === 'FLEE' || S === 'REPORT' || (lvl < 2 && S === 'LIPSTICK'))) return;
    if (n.kind === 'decoy' && S === 'DECOY' && this.goal) { this.goal.lastPulse = this.world.time; return; }
    // a level-3 shock (explosion, alarm shout, burst) breaks a lure off and leaves the lured man deaf to lures for a
    // while (replay m08: one pulsing decoy held the whole camp through the depot's chain explosion)
    if (lvl >= 3 && S === 'DECOY') this._shockT = this.world.time;
    if (n.kind === 'decoy' && this._lureShocked()) return;
    // a running man's steps never make the engineer fire his charges or the general flee (runningNoise)
    if (this.arch.script === 'engineer' || this.arch.script === 'general') return n.kind === 'footsteps' ? undefined : this._scriptAlarm(n.x, n.z);
    if (!this.arch.reacts || BUSY.has(S) || lvl <= 0) return;
    // §4.9 a patrol sent on its alarm route (reactEvents) runs it through: noises do not turn it aside until it
    // reaches its loop (replay m09: pt_nw investigated the blast instead of running S past the lorry)
    if (this._committedRun && S === 'REINFORCE' && this.routeIndex < (this._loopStart ?? 0)) return;
    if (S === 'DISTRACTED') { // §4.4: level ≥ 2 breaks the distraction off
      if (lvl >= 2) { this.releaseDistraction(); this._reactNoise(n, lvl); }
      return;
    }
    if (S === 'DECOY' && lvl < 2) return; // at the decoy: ignores level 1
    // a patrol member defers to its squad leader (the leader investigates, the squad follows). Running steps are
    // short-range: the leader at the head of the file may be out of their reach while the tail man hears them, so the
    // tail man's hearing counts for the squad (other noises keep the leader's own range check)
    const lead = this._leader();
    if (lead && lead !== e && lead.alive) { lead.brain?.hear?.(n, n.kind === 'footsteps'); return; }
    this._reactNoise(n, lvl);
  }

  _reactNoise(n, lvl) {
    const e = this.enemy;
    if (n.kind === 'footsteps') return this._hearSteps(n);
    // the cone before a noise swings him round: a kill in the same instant (the blast that made the noise)
    // is judged with it (notifyKill), there is no time to see who fired yet (M5 fix: barrel blast unmasking)
    const now = this.world.time;
    if (!this._preNoise || now - this._preNoise.t > NOISE_WITNESS_DELAY) this._preNoise = { t: now, cone: coneAt(e, now) };
    // §4.3: the run to a wounded comrade's shooter is not redirected by lesser noises (e.g. the comrade's own shots)
    if (this.state === 'INVESTIGATE' && this.phase === 'go' && this.goal?.priority === 'wounded' && lvl <= 2) return;
    if (e.flags.holdsPost || this.arch.script === 'crew' || this.arch.script === 'gunner' || e.soldierType === 'mg' || !e.flags.investigates) {
      // §4.4 holdsPost: turn to face it; the sweep re-centres on it for 8 s
      // an MG gunner turns only as far as his gun traverses (replay m01: e13 faced behind his nest for 8 s,
      // his cone — the gun's firing cone — pointing where the MG cannot fire)
      const h = this._clampTraverse(angleTo(e.x, e.z, n.x, n.z));
      // a lure (decoy / phone / horn) that swings a post-holder round is flagged so the UI can show his cone
      // turning (replay round 3, M3 e34: the bunker gunner is passed only by turning him with a decoy)
      const lure = LURES.has(n.kind) && (this.noiseTurnT <= 0 || Math.abs(angleDiff(e.heading, h)) > 0.2);
      e.heading = h;
      if (lure) this.world.events.emit('enemy:noise-turn', { enemy: e, x: n.x, z: n.z, kind: n.kind });
      this.noiseTurnT = CONFIG.ai.noiseTurnHold;
      if (lvl >= 2) { this.alertT = CONFIG.ai.noiseTurnHold; this.alertBoost = lvl >= 3 ? 2 : 1; }
      if (lvl >= 3) this.combatReady = true;
      this._updateAlert();
      return;
    }
    if (n.kind === 'decoy') return this._startDecoy(n);
    if (lvl >= 3) { this.alertT = CONFIG.ai.investigate.look + 10; this.alertBoost = 2; }
    // investigating already, a mate's noise close by (his shot within 8 m: he sees who fired) gives him nowhere new to
    // go: he keeps on (re-aiming at it turned him round on the spot: a file stalled where its own shots kept turning it)
    if (this.state === 'INVESTIGATE' && n.source?.faction === e.faction && Math.hypot(n.x - e.x, n.z - e.z) <= CONFIG.ai.investigate.mateShot) return;
    this._startInvestigate(n.x, n.z, lvl >= 3 ? CONFIG.ai.investigate.runSpeed : CONFIG.ai.investigate.speed);
  }

  /** Running-step suspicion now (decayed since the last step heard). */
  _stepSuspNow() {
    if (!(this.stepSusp > 0) || this.stepT == null) return 0;
    return Math.max(0, this.stepSusp - (this.world.time - this.stepT) * CONFIG.stealth.runNoise.susp.decay);
  }

  /**
   * SHADOW SIX house rule runningNoise: a running commando's step (level 1) reached this enemy. He turns at once to
   * the sound (head turns are instant in BEL): a post-holder / gunner / crew man faces it (his gun's traverse) and
   * sweeps around it for noiseTurnHold s; an investigator faces it and walks over (re-aimed at each newer step).
   * "Was war das?" at most every susp.barkEvery s. Repeated steps raise suspicion: alert level 1 at susp.alertAt; an
   * investigator who reached susp.searchAt SEARCHes around the last step when his look ends. Never alert level 2,
   * never an alarm, never combat-ready: being spotted still goes through the cone and the §4.5 nervousness rule
   * ("Halt!" first).
   */
  _hearSteps(n) {
    const e = this.enemy, w = this.world, now = w.time, SU = CONFIG.stealth.runNoise.susp;
    // §4.3: the run to a wounded comrade's shooter is not redirected by steps
    if (this.state === 'INVESTIGATE' && this.goal?.priority === 'wounded') return;
    // one step counts once: a leader is handed the same step by every squad member who heard it (and may hear it
    // himself); a step is one noise payload shared by every hearer, so the last one handled is enough to drop repeats
    if (this._stepNoise === n) return;
    this._stepNoise = n;
    this.stepSusp = this._stepSuspNow() + 1;
    this.stepT = now;
    const post = e.flags.holdsPost || this.arch.script === 'crew' || this.arch.script === 'gunner' || e.soldierType === 'mg' || !e.flags.investigates;
    const tracking = post ? this.noiseTurnT > 0 : this.state === 'INVESTIGATE' && !!this.goal?.steps;
    const h = post ? this._clampTraverse(angleTo(e.x, e.z, n.x, n.z)) : angleTo(e.x, e.z, n.x, n.z);
    const turn = !tracking || Math.abs(angleDiff(e.heading, h)) > 0.2;
    if (post) {
      e.heading = h;
      this.noiseTurnT = CONFIG.ai.noiseTurnHold;
    } else if (tracking) {
      const g = this.goal;
      g.x = n.x; g.z = n.z;
      if (this.phase === 'look') { // heard again while looking round: back on his feet towards the newest step
        this._set('INVESTIGATE', 'go');
        this._look(0);
        this._go(n.x, n.z, g.speed);
        g.repathT = now;
      } else if (now - (g.repathT ?? -Infinity) >= SU.repath) {
        this._go(n.x, n.z, g.speed);
        g.repathT = now;
      }
    } else {
      this._startInvestigate(n.x, n.z, CONFIG.ai.investigate.speed);
      this.goal.steps = true;
      this.goal.repathT = now;
    }
    if (!post) e.heading = h; // facing the sound now; the walk there keeps him facing it
    if (turn) w.events.emit('enemy:noise-turn', { enemy: e, x: n.x, z: n.z, kind: 'footsteps' });
    w.events.emit('enemy:heard-steps', { enemy: e, x: n.x, z: n.z, susp: this.stepSusp });
    if (this._stepBarkT == null || now - this._stepBarkT >= SU.barkEvery) {
      this._stepBarkT = now;
      w.events.emit('bark', { unit: e, line: 'ger_suspicious' });
    }
    if (this.stepSusp >= SU.alertAt) {
      this.alertT = Math.max(this.alertT, CONFIG.ai.noiseTurnHold);
      if (!(this.alertBoost >= 1)) this.alertBoost = 1;
    }
    // so many steps that he will search around the last one when his look round ends (not go home)
    if (!post && this.stepSusp >= SU.searchAt) this.goal.search = true;
    this._updateAlert();
  }

  /** Alarm reached this enemy (legacy hook from alarm.js; §4.9 reactEvents / scripted runners). */
  onAlarm(x, z, cause) { // eslint-disable-line no-unused-vars
    const e = this.enemy;
    if (!e.alive) return;
    if (this.arch.script === 'engineer' || this.arch.script === 'general') this._scriptAlarm(x, z);
  }

  onDeath(cause, killer) { // eslint-disable-line no-unused-vars
    const e = this.enemy;
    const t = this.target;
    this.target = null;
    e.target = null;
    this._refreshHeld(t);
    e.sweepActive = false;
    this._set('DEAD');
  }

  /** The Spy starts talking to this enemy (§3.4 distract): face the spy, no sweep, until released. */
  distractBy(spy) {
    const e = this.enemy;
    if (!e.alive || e.incapacitated || this.isAware() || BUSY.has(this.state)) return false;
    this.distractedBy = spy;
    e.stop();
    this._set('DISTRACTED');
    this._look(0);
    this.world?.events.emit('enemy:distracted', { enemy: e, spy, on: true });
    return true;
  }

  /** The Spy walks away / is unmasked: end the distraction (→ RETURN). */
  releaseDistraction() {
    const spy = this.distractedBy;
    if (!spy) return;
    this.distractedBy = null;
    this.world?.events.emit('enemy:distracted', { enemy: this.enemy, spy, on: false });
    if (this.state === 'DISTRACTED') this._set('RETURN');
  }

  /** Aware of the player (CHALLENGE/HOLD/COMBAT/ARREST/alarm run). */
  isAware() {
    return AWARE.has(this.state) || this.enemy.alertLevel >= 2;
  }

  /** Hook called when this enemy discovers `body` (BODY state, §4.6). */
  onBodyFound(body) { // eslint-disable-line no-unused-vars
  }

  /**
   * A commando killed `victim` (§4.3 kill seen): if this enemy saw the victim die (full cone) or sees the
   * killer, it sets sawKill, fights the killer and raises the alarm. A patrol member seeing one of its own
   * die raises the alarm immediately (§4.7).
   */
  notifyKill(victim, killer) {
    const e = this.enemy, w = this.world;
    if (!e.alive || e.blastDoomed || !w || victim === e || !this.arch.reacts || e.incapacitated) return false;
    // a noise that turned him a moment ago (the same blast) does not count yet: judge with the cone he had
    const pre = this._preNoise && w.time - this._preNoise.t <= NOISE_WITNESS_DELAY ? { cone: this._preNoise.cone } : {};
    const sawVictim = canSee(e, { x: victim.x, z: victim.z, y: victim.y || 0, kind: 'body', falling: true }, w, pre) !== 'none';
    const sawKiller = killer && killer.alive && canSee(e, killer, w, { ignoreDisguise: true, ...pre }) !== 'none';
    if (!sawVictim && !sawKiller) return false;
    e.sawKill = true;
    e.nervousness = 20 * e.nervThreshold;
    const at = sawKiller ? killer : victim;
    e.lastSeen = { target: killer, x: at.x, z: at.z, t: w.time };
    if (killer?.disguised && sawKiller) w.events.emit('enemy:unmasked-spy', { enemy: e, spy: killer });
    if (this.arch.alarms) this._raiseZone('kill', at.x, at.z);
    if (killer && killer.faction === 'player') this._enterCombat(killer, { seen: sawKiller });
    return true;
  }

  /** §4.1 wounded: screams ger_hurt, turns aggressive and hunts the shooter. */
  onHurt(src) {
    const e = this.enemy, w = this.world;
    if (!e.alive || !(e.hp > 0) || !w || !this.arch.reacts || e.incapacitated) return; // lethal hit: no reaction
    w.events.emit('bark', { unit: e, line: 'ger_hurt' });
    e.lastHurtBy = { x: src.x, z: src.z, t: w.time };
    if (this.state !== 'COMBAT') this._enterCombat(src, { seen: canSee(e, src, w, { ignoreDisguise: true }) !== 'none' });
  }

  /** §4.3 boarding seen: the vehicle is tainted (director) and fought. */
  onBoardSeen(vehicle, unit) { // eslint-disable-line no-unused-vars
    const e = this.enemy, w = this.world;
    w.events.emit('bark', { unit: e, line: 'ger_alarm' });
    e.lastSeen = { target: vehicle, x: vehicle.x, z: vehicle.z, t: w.time };
    this._enterCombat(vehicle, { seen: true });
  }

  /** A disguised Spy seen doing a suspicious act (§3.4): he is a commando now. */
  onSuspiciousAct(spy) {
    const e = this.enemy;
    if (e.incapacitated) return;
    e.nervousness = 20 * e.nervThreshold;
    if (this.state === 'DISTRACTED') this.releaseDistraction();
    this._enterCombat(spy, { seen: true });
  }

  /** §4.5 the held commando attacked (shot / kill / suspicious act) → COMBAT. */
  onTargetAttacked(unit) {
    if ((this.state === 'CHALLENGE' || this.state === 'HOLD' || this.state === 'ARREST') && this.target === unit) this._enterCombat(unit, { seen: true });
  }

  /** The current target died / was jailed. */
  onTargetGone(unit) {
    if (this.target !== unit) return;
    if (this.state === 'COMBAT') this._startSearch();
    else if (this.state === 'CHALLENGE' || this.state === 'HOLD') this._set('RETURN');
  }
  // ------------------------------------------------------------ §4.5 nervousness (20 Hz tick-integer rule)

  /** One BEL tick (dt20 = 0.05 s), run by world.ai after every enemy updated this step. */
  belTick() {
    const e = this.enemy, w = this.world;
    if (!e.alive || !w) return;
    const NV = CONFIG.ai.nervousness;
    const T = e.nervThreshold;
    const held = 20 * T; // §4.5 close/held/deed value and cap: 20·T per spawn (.NERVIOSISMO); = NV.heldValue at T=50
    const before = e.nervousness;
    let N = Math.max(0, e.nervousness - NV.decayPerTick);
    let pick = null, best = -1;
    if (this.arch.reacts && this.arch.challenges) {
      const unit = CONFIG.sim.belUnit;
      for (const s of this._seen) {
        const c = s.unit;
        const dm = w.ai?.disp.get(c.id) ?? 0;
        const d = dm / unit; // BEL units
        let add = Math.floor(NV.dispMul * d * d);
        if (s.dist <= NV.closeRange || c.held || c.carrying || this._sawDeed(c)) add = Math.max(add, held);
        if (add >= held) N = Math.max(N, held);
        else N += add;
        if (add > best) { best = add; pick = c; }
      }
      // sawBody: +max(1, T/25) once per tick while any commando is seen (not once per commando).
      if (e.sawBody && this._seen.length > 0) N += Math.max(1, T / NV.bodyBonusDiv);
    }
    e.nervousness = Math.min(N, held);
    if (before !== e.nervousness) this._updateAlert();
    if (pick && e.nervousness >= T && !AWARE.has(this.state) && this.state !== 'BODY') this._enterChallenge(pick);
  }

  /** Commando seen killing / boarding recently (director stamps unit._deedT). */
  _sawDeed(c) {
    return c._deedT != null && this.world.time - c._deedT < 0.5;
  }

  // ------------------------------------------------------------ per-step update

  update(dt) {
    const e = this.enemy;
    const w = this.world;
    if (!e.alive || !w) return;
    this.t += dt;
    this.pt += dt;
    if (this.noiseTurnT > 0) this.noiseTurnT -= dt;
    if (this.alertT > 0 && (this.alertT -= dt) <= 0) this._updateAlert();
    if (e.state === 'inVehicle' && e.vehicle) { e.x = e.vehicle.x; e.z = e.vehicle.z; if (!this._crewHeading) e.heading = e.vehicle.heading; }
    if (this.bcd && bcdPre(this, dt)) return; // BCD: STUNNED / BOUND / PUPPET consume the step
    // bodies-design §A.5: blown off his feet — down, dazed, getting up; no perception, no fire, no movement
    if (e.knockedDown) {
      if (w.time < e.knockedDown.until) { if (e.isMoving) e.stop(); this.burstLeft = 0; return; }
      e.knockedDown = null;
    }
    this._perceive();
    if (!e.alive) return;
    // stepping out of a vehicle's way (vehicle.js _stepAside): an idle man finishes the step before his routine
    if (e.stepAside) {
      if (w.time < e.stepAside.until && e.path && (this.state === 'IDLE' || this.state === 'REINFORCE')) return;
      e.stepAside = null;
    }
    if (this.bcd && !AWARE.has(this.state)) bcdScan(this); // BCD: a comrade seen knocked out / cuffed
    switch (this.state) {
      case 'IDLE': case 'REINFORCE': this._idle(dt); break;
      case 'INVESTIGATE': this._investigate(dt); break;
      case 'DECOY': this._decoy(dt); break;
      case 'TRACKS': this._tracks(dt); break;
      case 'BODY': this._body(dt); break;
      case 'CHALLENGE': this._challenge(dt); break;
      case 'HOLD': this._hold(dt); break;
      case 'ARREST': this._arrest(dt); break;
      case 'COMBAT': this._combat(dt); break;
      case 'SEARCH': this._search(dt); break;
      case 'RETURN': this._return(dt); break;
      case 'DISTRACTED': this._distracted(dt); break;
      case 'ALARM_RUN': this._alarmRun(dt); break;
      default: if (this.bcd) bcdState(this, dt); break; // BCD: STONE, CIGS, LIPSTICK, REVIVE, FLEE, REPORT
    }
    this._unstick(dt);
  }

  /** §4.3 perception pass: seen list, witness memory, bodies, wounded comrades, prints, fire-on-sight. */
  _perceive() {
    const e = this.enemy, w = this.world;
    this._seen = [];
    if (this.bcd && !this.arch.reacts && e.soldierType === 'officer' && e.vision && e.state !== 'captured') { bcdOfficerLook(this); return; } // BCD §1.6
    if (!e.vision || !this.arch.reacts || e.state === 'captured') return;
    const S = this.state;
    const wantPrints = e.flags.followsTracks && (S === 'IDLE' || S === 'REINFORCE' || S === 'RETURN' || S === 'SEARCH');
    const res = perceive(e, w, { prints: wantPrints, bodies: !e.flags.ignoresBodies || this.arch.script === 'courier' });
    let seen = res.commandos.filter((s) => s.unit.state !== 'captured');
    if (this.arch.vehicleOnly) seen = [];
    this._seen = seen;
    for (const s of seen) {
      e.lastSeen = { target: s.unit, x: s.unit.x, z: s.unit.z, t: w.time };
    }
    if (seen.length) this._onCommandoSeen(seen);
    if (this.arch.script === 'gunner') this._gunnerLook();
    if (!e.alive || AWARE.has(this.state)) return;
    // bodies (full cone) and wounded comrades
    for (const b of res.bodies) {
      const u = b.unit;
      if (u.bodyNoticed || u.hiddenBody) continue;
      if (this.arch.script === 'courier') return this._startAlarmRun(u.x, u.z);
      if (this.arch.script === 'engineer') return this._scriptAlarm(u.x, u.z);
      if (u._claimedBy && u._claimedBy !== e && u._claimedBy.alive) { e.sawBody = true; continue; }
      if (CALM.has(this.state) && this.state !== 'BODY') return this._startBody(u);
    }
    if (CALM.has(this.state) && this.state !== 'INVESTIGATE') {
      const hurt = this._woundedComrade(res.cone);
      if (hurt) return this._startInvestigateWounded(hurt);
    }
    if (res.prints.length && (S === 'IDLE' || S === 'REINFORCE' || S === 'RETURN' || S === 'SEARCH')) {
      // prints of a trail this man already followed (older ones he walks past on RETURN included) do not
      // start TRACKS again — only a fresher print of that owner does (replay m03: trackers looped at the
      // trail end until the prints expired)
      const tr = this._trail;
      let newest = null;
      for (const p of res.prints) {
        if (tr && p.ownerId === tr.ownerId && p.t <= tr.t + 1e-6) continue;
        if (!newest || p.t > newest.t) newest = p;
      }
      if (newest && this._lastPrint !== newest.id) this._startTracks(newest);
    }
  }

  _onCommandoSeen(seen) {
    const e = this.enemy;
    const c = seen[0].unit;
    const scr = this.arch.script;
    if (this.bcd && bcdOnSeen(this, c)) return; // BCD: zookeeper flees, snitch reports
    if (scr === 'courier') return this._startAlarmRun(c.x, c.z);
    if (scr === 'engineer') return this._scriptAlarm(c.x, c.z);
    if (this.state === 'ALARM_RUN' || this.state === 'COMBAT' || this.state === 'ARREST') return;
    // bodies-design §C.6: a DOWNED commando is a body found (zone alarm, sawBody, once per downing: saved with the
    // downed state) AND a target — the guard closes in and covers him, and finishes him after `finishDelay` s
    const down = seen.find((s) => s.unit.downed)?.unit;
    if (down && seen.every((s) => s.unit.downed)) {
      e.sawBody = true;
      if (!down.downed.alarmed) { down.downed.alarmed = true; this._alarmShout('body', down.x, down.z); }
      if (this.state === 'CHALLENGE' || this.state === 'HOLD') return;
      return this._enterCombat(down, { seen: true });
    }
    // §4.5: mg, armour, dogs never challenge — fire on sight (dogs bark and attack)
    if (!this.arch.challenges || e.flags.firesOnSight || this.combatReady || (this.state === 'REINFORCE' && this.world.alarm?.active)) {
      if (this.state === 'CHALLENGE' || this.state === 'HOLD') return;
      if (e.soldierType === 'mg' && !this._traverseOk(angleTo(e.x, e.z, c.x, c.z))) return;
      return this._enterCombat(c, { seen: true });
    }
    // §4.5 HOLD: the first patrol whose cone sees a held man comes over and applies the patrol rule
    if (isPatrolMember(e) && CALM.has(this.state)) {
      for (const s of seen) {
        if (s.unit.held && !s.unit.captured) {
          const holder = this.world.enemies.find((q) => q !== e && q.alive && q.target === s.unit && q.brain?.state === 'HOLD');
          if (holder) return this._patrolRule(s.unit);
        }
      }
    }
  }

  /** §4.3 wounded comrade seen (alive, below max HP) in the cone. */
  _woundedComrade(cone) {
    const e = this.enemy, w = this.world;
    if (!cone) return null;
    for (const q of w.enemies) {
      if (q === e || !q.alive || q.hp >= q.maxHp || !q.lastHurtBy || q._hurtSeenBy?.has(e)) continue;
      if (Math.hypot(q.x - e.x, q.z - e.z) > cone.far + 1) continue;
      if (canSee(e, { x: q.x, z: q.z, y: q.y || 0, isLow: false, isVisibleToEnemies: true }, w, { cone }) !== 'none') return q;
    }
    return null;
  }
  // ------------------------------------------------------------ §4.5 CHALLENGE / HOLD

  /** Enter CHALLENGE against commando `c` ("Halt!"). `joined`: aiming along with another guard (no shout). */
  _enterChallenge(c, joined = false) {
    const e = this.enemy, w = this.world;
    if (!c || !c.alive) return;
    e.stop();
    this.target = c;
    e.target = c;
    this.anchor = { x: c.x, z: c.z };
    this.aimT = CONFIG.ai.aim;
    this.lostT = 0;
    this._set('CHALLENGE');
    this._look(0);
    e.faceTowards(c.x, c.z);
    e.idleAnim = 'aim';
    const wasHeld = c.held;
    c.held = true;
    if (!wasHeld) {
      w.events.emit('unit:held', { unit: c, by: this._holders(c), held: true });
      w.events.emit('ui:warning', { unit: c, kind: 'held' });
      if (CONFIG.ai.submissive && c.isMoving) c.stop(); // option Submissive (default Indifferent)
    }
    w.events.emit('enemy:spotted', { enemy: e, target: c });
    w.events.emit('enemy:challenge', { enemy: e, target: c });
    if (!joined) {
      this._shout('halt', 'ger_halt');
      // listeners who can see the same commando also aim at him (no N needed)
      const R = CONFIG.stealth.noise.halt.radius;
      for (const q of w.enemies) {
        if (q === e || !q.alive || !q.brain || AWARE.has(q.brain.state) || !q.brain.arch.challenges || !q.brain.arch.reacts) continue;
        if (Math.hypot(q.x - e.x, q.z - e.z) > R) continue;
        if (canSee(q, c, w) !== 'none') q.brain._enterChallenge(c, true);
      }
      if (e.flags.raisesAlarmOnSight && this.arch.alarms) this._alarmShout('seen', c.x, c.z); // by-the-book types
    }
  }

  /** Enemies currently aiming at (holding) commando c. */
  _holders(c) {
    return this.world.enemies.filter((q) => q.alive && q.target === c && (q.brain?.state === 'CHALLENGE' || q.brain?.state === 'HOLD'));
  }

  /** Recompute c.held after an aiming enemy left CHALLENGE/HOLD. */
  _refreshHeld(c) {
    if (!c || c.faction !== 'player' || !c.held) return;
    const still = this.world?.enemies.some((q) => q.alive && q !== this.enemy && q.target === c && (q.brain?.state === 'CHALLENGE' || q.brain?.state === 'HOLD'));
    if (!still || c.state === 'captured' || c.state === 'jailed' || !c.alive) {
      c.held = false;
      this.world?.events.emit('unit:held', { unit: c, by: [], held: false });
    }
  }

  _shout(kind, line, about = null) {
    const e = this.enemy, w = this.world;
    const N = CONFIG.stealth.noise[kind];
    this.shoutT = w.time;
    w.events.emit('bark', { unit: e, line });
    if (N) w.emitNoise(e.x, e.z, N.radius, kind, e, undefined, about ? { about } : null);
  }

  /** "Alarm!" (ger_alarm): alarmShout noise (level 3, 36 m) + the shouter's zone event (§4.9). */
  _alarmShout(cause, x, z) {
    if (!this.arch.alarms) return;
    const at = { x: x ?? this.enemy.x, z: z ?? this.enemy.z };
    this._shout('alarmShout', 'ger_alarm', at); // the noise carries what it is about (zone `ignoreFrom`, M18 islands)
    this._raiseZone(cause, at.x, at.z);
  }

  /** Fire the onSeen sensor of the zone this enemy stands in (§4.9; no zones → CONFIG fallback). */
  _raiseZone(cause, x, z) {
    const e = this.enemy, a = this.world.alarm;
    if (!a || !this.arch.alarms) return null;
    const zn = a.zoneAt(e.x, e.z);
    if (zn) return a.raise(zn.id, cause, x, z, { sensor: 'seen' });
    return a.raiseUnzoned?.(cause, x, z, 'seen') ?? null;
  }

  /** Is the held target still where he was told to freeze / visible? */
  _heldViolated(dt) {
    const c = this.target, w = this.world;
    if (Math.hypot(c.x - this.anchor.x, c.z - this.anchor.z) > CONFIG.ai.halt.moveTol) return true;
    if (canSee(this.enemy, c, w) === 'none') {
      this.lostT += dt;
      if (this.lostT > CONFIG.ai.holdLost) return true; // fled out of sight
    } else this.lostT = 0;
    return false;
  }

  _challenge(dt) {
    const e = this.enemy, c = this.target;
    if (!c || !c.alive || c.state === 'captured' || c.state === 'jailed') return this._set('RETURN');
    e.faceTowards(c.x, c.z);
    this.aimT -= dt;
    // before the aim completes, the target may still settle; re-shout (3 s cooldown) when he keeps moving
    if (Math.hypot(c.x - this.anchor.x, c.z - this.anchor.z) > CONFIG.ai.halt.moveTol) {
      this.anchor = { x: c.x, z: c.z };
      if (this.world.time - this.shoutT >= CONFIG.ai.halt.cooldown) this._shout('halt', 'ger_halt');
    }
    if (this.aimT > 0) return;
    this.anchor = { x: c.x, z: c.z };
    // §4.5 resolution table
    if (e.sawBody || e.sawKill || e.flags.firesOnSight || this.world.alarm?.active) return this._enterCombat(c, { seen: true });
    if (isPatrolMember(e)) return this._patrolRule(c);
    this._set('HOLD');
    this.lostT = 0;
    this.world.events.emit('enemy:held', { enemy: e, target: c });
  }

  /** §4.5 patrol rule: ARREST when the map has a jail, else COMBAT. */
  _patrolRule(c) {
    const jail = this._jailId();
    if (jail != null && this.world.ai?.jailDoor?.(jail)) return this._startArrest(c, jail);
    return this._enterCombat(c, { seen: true });
  }

  _jailId() {
    const e = this.enemy;
    return e.jail ?? this.world.mission?.jails?.[0] ?? null;
  }

  _hold(dt) {
    const e = this.enemy, c = this.target;
    if (!c || !c.alive || c.state === 'jailed') return this._set('RETURN');
    if (c.state === 'captured') return this._set('RETURN'); // a patrol took him
    e.faceTowards(c.x, c.z);
    e.idleAnim = 'aim';
    if (this._heldViolated(dt)) this._enterCombat(c, { seen: canSee(e, c, this.world) !== 'none' });
  }
  // ------------------------------------------------------------ COMBAT (§4.6) + firing (§4.1, §4.11)

  /** Enter COMBAT against a commando or vehicle. Fires the zone's onSeen sensor (§4.9). */
  _enterCombat(t, { seen = true } = {}) {
    const e = this.enemy, w = this.world;
    if (!t || e.blastDoomed) return; // dying in the blast being resolved (explosions.js)
    if (this.state === 'COMBAT' && this.target === t) return;
    const prev = this.target;
    const wasCombat = this.state === 'COMBAT';
    if (this.distractedBy) this.releaseDistraction();
    this.target = t;
    e.target = t;
    if (seen || !e.lastSeen) e.lastSeen = { target: t, x: t.x, z: t.z, t: w.time };
    this.lostT = 0;
    this.aimT = CONFIG.weapons[e.weapon]?.aim ?? CONFIG.ai.aim;
    this.burstLeft = 0;
    this.fireT = 0;
    if (!wasCombat && e.soldierType !== 'mg' && !e.flags.holdsPost) e.stop();
    this._set('COMBAT');
    this._look(0);
    if (prev && prev !== t) this._refreshHeld(prev);
    // spotted / the "seen" warning only when he actually sees the commando: a guard who saw a comrade die fights
    // towards the body, not the unseen killer (replay m06: 'spotted sapper' logged from 60 m after the gun blast)
    if (t.faction === 'player') {
      if (seen) {
        w.events.emit('enemy:spotted', { enemy: e, target: t });
        w.events.emit('ui:warning', { unit: t, kind: 'seen' });
      }
      if (this.arch.script === 'dog') this._shout('bark', 'dog_bark');
    }
    if (seen && this.arch.alarms) {
      if (isPatrolMember(e) && e.sawKill) this._alarmShout('kill', t.x, t.z);
      else this._raiseZone('seen', t.x, t.z);
    }
  }

  _combat(dt) {
    const e = this.enemy, w = this.world, t = this.target;
    // crews fire their vehicle's gun (tank MG 110 per hit, §4.11); emplacement gunners likewise
    const vw = e.state === 'inVehicle' ? CONFIG.weapons[e.vehicle?.def?.weapon] : null;
    const W = CONFIG.weapons[e.weapon] || (vw && vw.dmg ? vw : null);
    const gone = !t || t.alive === false || t.destroyed || t.state === 'jailed';
    if (gone) return this._startSearch();
    const isVeh = t.kind === 'vehicle';
    const vis = canSee(e, t, w, { ignoreDisguise: true, dynamic: !isVeh }) !== 'none';
    const d = Math.hypot(t.x - e.x, t.z - e.z);
    const fixed = e.soldierType === 'mg' || this.arch.script === 'crew' || this.arch.script === 'gunner' || e.state === 'inVehicle' || !!e.spawn?.caged;
    if (vis) {
      this.lostT = 0;
      e.lastSeen = { target: t, x: t.x, z: t.z, t: w.time };
    } else {
      this.lostT += dt;
      if (this.lostT >= CONFIG.ai.lostTarget) return this._startSearch();
      // target handed over without a sighting (vehicle-ai tainted vehicle, quickload): head for where it is
      if (!e.lastSeen) e.lastSeen = { target: t, x: t.x, z: t.z, t: w.time };
    }
    const h = angleTo(e.x, e.z, vis ? t.x : e.lastSeen.x, vis ? t.z : e.lastSeen.z);
    if (fixed) {
      if (this._traverseOk(h)) e.heading = h; // MG traverse limited to ±giro/2 (§4.1)
    } else if (!e.isMoving || vis) e.turnTowards(vis ? t.x : e.lastSeen.x, vis ? t.z : e.lastSeen.z, dt);
    // §4.1 artillery gunner at his emplacement: fires its gun (210 mm / AT: a shell that kills any vehicle in one hit,
    // 13.5 m minimum) at vehicles only, never his fallback rifle (replay m07: g22 plinked the rowboat 30 times)
    const emp = this.arch.script === 'gunner' ? this._emplacement() : null;
    if (emp) {
      this.burstLeft = 0;
      if (!vis || !isVeh || !this._traverseOk(h)) return;
      e.idleAnim = 'aim';
      if (this.aimT > 0) { this.aimT -= dt; return; }
      emp.fireAt(t);
      return;
    }
    const range = this.arch.script === 'dog' ? CONFIG.weapons.dogBite.range : W?.range ?? 0;
    if (this.arch.script === 'dog' && e.spawn?.caged) { // caged dogs only bark (§4.1)
      this.fireT -= dt;
      if (vis && this.fireT <= 0) { this.fireT = 1.5; this._shout('bark', 'dog_bark'); }
      return;
    }
    // bodies-design §C.6: a DOWNED man is not shot on sight: the guard walks up to him and covers him; only after
    // `finishDelay` s of covering (any guard, once per tick) does the finishing shot come — the window for a rescue
    const dn = t.downed && !isVeh && w.house?.buddyRescue ? t.downed : null;
    if (dn && vis && W && this.arch.script !== 'dog' && !fixed && d > CONFIG.bodies.downed.coverRange) {
      this._repathT -= dt;
      if (!e.isMoving || this._repathT <= 0) { this._repathT = 0.5; this._go(t.x, t.z, CONFIG.ai.chaseSpeed * 0.6); }
      return;
    }
    if (vis && W && d <= range + (this.arch.script === 'dog' ? 0.3 : 0) && (!fixed || this._traverseOk(h))) {
      if (e.isMoving) e.stop();
      e.idleAnim = 'aim';
      if (dn) {
        if (dn.coverTick !== w.tick) { dn.coverTick = w.tick; dn.covered = (dn.covered || 0) + dt; }
        if (dn.covered < CONFIG.bodies.downed.finishDelay) return;
      }
      if (this.aimT > 0) { this.aimT -= dt; return; }
      this._fire(dt, t, W, isVeh);
      return;
    }
    this.burstLeft = 0;
    if (fixed || !W) return;
    // out of range or out of sight: run toward the last seen position (3.8 m/s); walkers abandon the route
    const goal = vis ? t : e.lastSeen;
    this._repathT -= dt;
    if ((!e.isMoving || this._repathT <= 0) && Math.hypot(goal.x - e.x, goal.z - e.z) > 0.8) {
      this._repathT = 0.5;
      this._go(goal.x, goal.z, CONFIG.ai.chaseSpeed);
    }
  }

  /** Deterministic fire (§4.1): every round at a target in range and LOS at the moment of firing hits. */
  _fire(dt, t, W, isVeh) {
    const e = this.enemy, w = this.world;
    const rounds = W.rounds || 1;
    const gap = e.weapon === 'mg' ? W.cadence : CONFIG.ai.fire.roundGap;
    if (this.burstLeft > 0) {
      this.roundT -= dt;
      if (this.roundT > 0) return;
      this._round(t, W, isVeh);
      this.burstLeft--;
      this.roundT = gap;
      return;
    }
    this.fireT -= dt;
    if (this.fireT > 0) return;
    // start a burst: one noise per burst (level/radius from the weapon's noise kind, §4.4)
    if (W.noise && W.noiseKind) w.emitNoise(e.x, e.z, CONFIG.stealth.noise[W.noiseKind]?.radius ?? W.noise, W.noiseKind, e);
    if (this.arch.script === 'dog') { // a dog barks rather than shoots
      const B = CONFIG.stealth.noise.bark;
      w.emitNoise(e.x, e.z, B.radius, 'bark', e);
    }
    this._round(t, W, isVeh);
    this.burstLeft = rounds - 1;
    this.roundT = gap;
    this.fireT = (rounds - 1) * gap + (W.cadence ?? 1);
  }

  _round(t, W, isVeh) {
    const e = this.enemy, w = this.world;
    if (t.alive === false || t.destroyed) { this.burstLeft = 0; return; }
    const hit = Math.hypot(t.x - e.x, t.z - e.z) <= (W.range ?? 0) + 0.3 && canSee(e, t, w, { ignoreDisguise: true, dynamic: !isVeh }) !== 'none';
    w.stats.enemyShots = (w.stats.enemyShots || 0) + 1;
    e.playAction(this.arch.script === 'dog' ? 'punch' : 'shoot', 0.2);
    if (this.arch.script !== 'dog') {
      w.events.emit('shot', { from: { x: e.x, z: e.z }, to: { x: t.x, z: t.z }, shooter: e, target: t, hit, weapon: e.weapon });
    }
    if (!hit || this.arch.blanks) return;
    if (isVeh) {
      if (e.state === 'inVehicle' && e.vehicle?.fireAt) e.vehicle.fireAt(t);
      else t.takeDamage?.(1, e, 'shot'); // bullets count as hits against vehicle.hits
      return;
    }
    w.events.emit('hit', { x: t.x, z: t.z, surface: 'flesh', target: t, weapon: e.weapon });
    t.takeDamage(W.dmg, e, this.arch.script === 'dog' ? 'bite' : 'shot');
  }

  /** MG traverse: heading h within ±giro/2 of the post heading (spawn.giro deg: 90 or 180, §4.1). */
  _traverseOk(h) {
    return Math.abs(angleDiff(h, this._clampTraverse(h))) < 1e-6;
  }

  /** The armed emplacement this soldier mans (spawn `emplacement: <vehicle id>`), or null once it is gone. */
  _emplacement() {
    const id = this.enemy.spawn?.emplacement;
    const v = id != null ? this.world.byId?.(id) : null;
    return v && v.kind === 'vehicle' && !v.destroyed && v.def?.weapons?.length ? v : null;
  }

  /**
   * `h` clamped into the MG traverse (post heading ± giro/2; mission data `post.giro` or spawn `giro`). An
   * artillery gunner with a `giro` is held to it too (m07: a gun cannot swing round at a half-track parked behind it).
   */
  _clampTraverse(h) {
    const e = this.enemy;
    const giro = e.spawn?.giro ?? e.post?.giro;
    if ((e.soldierType !== 'mg' && this.arch.script !== 'gunner') || !giro || giro >= 360 || !e.post) return h;
    const half = (giro * DEG) / 2, d = angleDiff(e.post.heading, h);
    return Math.abs(d) <= half + 1e-6 ? h : e.post.heading + Math.sign(d) * half;
  }

  // ------------------------------------------------------------ ARREST + jail (§4.10)

  _startArrest(c, jailId) {
    const e = this.enemy;
    this.target = c;
    e.target = c;
    this.goal = { jailId };
    this.anchor = { x: c.x, z: c.z };
    this._set('ARREST', 'approach');
    this._look(0);
    this._go(c.x, c.z, CONFIG.ai.arrest.escortSpeed);
  }

  _arrest(dt) {
    const e = this.enemy, w = this.world, c = this.target;
    if (!c || !c.alive) return this._set('RETURN');
    const A = CONFIG.ai.arrest;
    if (this.phase === 'approach') {
      if (Math.hypot(c.x - this.anchor.x, c.z - this.anchor.z) > CONFIG.ai.halt.moveTol) return this._enterCombat(c, { seen: true });
      const d = this._dist(c);
      if (d > A.arrive) {
        if (!e.isMoving) this._go(c.x, c.z, A.escortSpeed);
        return;
      }
      e.stop();
      e.faceTowards(c.x, c.z);
      const door = w.ai.jailDoor(this.goal.jailId);
      c.stop?.();
      c.state = 'captured';
      c.held = false;
      c.captured = true;
      c.playAction?.('surrender', 2);
      c._escortMul = c.speedMul;
      const cs = c.speed / (c.speedMul || 1);
      c.speedMul = cs > 0 ? A.escortSpeed / cs : 1;
      c.moveTo(door.x, door.z);
      w.events.emit('unit:captured', { unit: c, by: e, jailId: this.goal.jailId });
      w.events.emit('unit:held', { unit: c, by: [], held: false });
      w.events.emit('bark', { unit: e, line: 'ger_arrest' });
      this.goal.door = door;
      this.phase = 'escort';
      return;
    }
    // escort: the prisoner walks to the jail door at 1.8 m/s, the leader follows 1.5 m behind
    const door = this.goal.door;
    if (c.state !== 'captured') return this._set('RETURN');
    if (!c.isMoving && Math.hypot(c.x - door.x, c.z - door.z) > 0.6) c.moveTo(door.x, door.z);
    this._repathT -= dt;
    if (this._repathT <= 0 && this._dist(c) > A.arrive) { this._repathT = 0.4; this._go(c.x, c.z, A.escortSpeed * 1.2); }
    if (Math.hypot(c.x - door.x, c.z - door.z) <= 0.6) this._jail(c);
  }

  _jail(c) {
    const e = this.enemy, w = this.world;
    const jailId = this.goal.jailId;
    c.stop();
    c.state = 'jailed';
    c.captured = false;
    c.jailId = jailId;
    c.speedMul = c._escortMul ?? 1;
    if (c.object3d) c.object3d.visible = false;
    for (const item of w.mission?.jailStrips || []) c.inventory?.delete?.(item); // M17 marine loses diving gear
    w.events.emit('unit:jailed', { unit: c, jailId });
    this.target = null;
    e.target = null;
    this._set('RETURN');
  }
  // ------------------------------------------------------------ BODY (§4.6, §4.7)

  _startBody(body) {
    const e = this.enemy, w = this.world;
    e.sawBody = true;
    body._claimedBy = e;
    this.goal = { body, x: body.x, z: body.z };
    e.lastSeen = { target: body, x: body.x, z: body.z, t: w.time };
    this._set('BODY', 'go');
    this._look(0);
    // a patrol member finding a body raises the alarm immediately (§4.7)
    if (isPatrolMember(e)) { this.goal.shouted = true; this._alarmShout('body', body.x, body.z); }
    if (e.flags.holdsPost || !e.flags.investigates) { this.phase = 'kneel'; e.faceTowards(body.x, body.z); }
    else this._go(body.x, body.z, CONFIG.ai.investigate.speed);
  }

  _body() {
    const e = this.enemy, w = this.world, g = this.goal, B = CONFIG.ai.body;
    const b = g.body;
    if (this.phase === 'go') {
      if (this._dist(b) <= B.arrive + 0.1 || (!e.isMoving && this.pt > 0.2)) { e.stop(); this.phase = 'kneel'; this.pt = 0; e.faceTowards(b.x, b.z); e.playAction('use', B.kneel); }
      return;
    }
    if (this.phase === 'kneel' && this.pt >= B.kneel) {
      b.bodyNoticed = true;
      b.discovered = true;
      this._shout('mandown', 'ger_mandown');
      w.events.emit('enemy:body-found', { enemy: e, body: b });
      this.onBodyFound(b);
      this.phase = 'shout';
      this.pt = 0;
      return;
    }
    if (this.phase === 'shout' && this.pt >= B.alarmDelay) {
      if (!g.shouted) this._alarmShout('body', b.x, b.z);
      b._claimedBy = null;
      this._startSearch();
    }
  }

  // ------------------------------------------------------------ INVESTIGATE / DECOY / TRACKS

  _startInvestigateWounded(q) {
    q._hurtSeenBy = q._hurtSeenBy || new Set();
    q._hurtSeenBy.add(this.enemy);
    const e = this.enemy;
    if (e.flags.holdsPost || !e.flags.investigates) { // posts only turn toward it, COMBAT-ready (§4.1 holdsPost)
      return this._reactNoise({ x: q.lastHurtBy.x, z: q.lastHurtBy.z, kind: 'wounded', level: 3 }, 3);
    }
    // §4.3: alertLevel 2 for the whole run — set the boost before the state change, and refresh it
    // explicitly (_set skips _updateAlert when the viewer is already in INVESTIGATE)
    this.alertT = CONFIG.ai.investigate.look + 10;
    this.alertBoost = 2;
    this._set('INVESTIGATE', 'go');
    this.goal = { x: q.lastHurtBy.x, z: q.lastHurtBy.z, speed: CONFIG.ai.chaseSpeed, priority: 'wounded' };
    this._updateAlert();
    this._go(this.goal.x, this.goal.z, this.goal.speed);
  }

  _investigate() {
    const e = this.enemy, I = CONFIG.ai.investigate, g = this.goal;
    if (this.phase === 'go') {
      if (this._dist(g) <= I.arrive || !e.isMoving || this._nearFire()) {
        e.stop();
        this.phase = 'look';
        this.pt = 0;
        this.world.events.emit('bark', { unit: e, line: 'ger_suspicious' });
      }
      return;
    }
    // look around 4 s: θ sweeps ±90° over the 4 s
    e.sweepActive = false;
    e.headOffset = I.lookSweep * DEG * Math.sin((2 * Math.PI * this.pt) / I.look);
    if (this.pt >= I.look) {
      // runningNoise: many steps heard → search around the last one instead of going home
      if (g?.steps && g.search) return this._startSearch({ x: g.x, z: g.z });
      this._set('RETURN');
    }
  }

  /**
   * A burning wreck (§3.6: fire within CONFIG.vehicles.wreckFireRadius of its hull) is 1 m or less ahead: an
   * investigator or searcher stops at its edge rather than walking into the flames (replay m06: the armoured-car
   * bomb's map-wide noise drew every investigator into the burning wreck, and each death seen was a zone alarm).
   */
  _nearFire() {
    const e = this.enemy, vs = this.world?.vehicles;
    if (!vs) return false;
    const R = CONFIG.vehicles.wreckFireRadius + 1;
    for (const v of vs) if (v.burning && !v.removed && v._inHull?.(e.x, e.z, R)) return true;
    return false;
  }

  _startDecoy(n) {
    const e = this.enemy;
    this._set('DECOY', 'go');
    this.goal = { x: n.x, z: n.z, source: n.source ?? null, lastPulse: this.world.time, offT: 0 };
    const slot = this._decoySlot(n);
    if (slot) { this.goal.sx = slot.x; this.goal.sz = slot.z; }
    this._look(0);
    if (slot) this._go(slot.x, slot.z, CONFIG.ai.investigate.speed);
    else this._go(n.x, n.z, CONFIG.ai.investigate.speed);
    e.faceTowards(n.x, n.z);
  }

  /**
   * Stand-off slot for a second (third...) investigator of the same decoy: the first walks straight at it
   * and stops at standOff; each later one takes a free point on the standOff ring, angled away (±50°,
   * ±100°...) from where the others stand, so two guards never stack on one point. null = first / no room.
   */
  _decoySlot(n) {
    const e = this.enemy, w = this.world, D = CONFIG.ai.decoy;
    const spots = [];
    for (const o of w.enemies || []) {
      const b = o?.brain;
      if (o === e || !o.alive || !b || b.state !== 'DECOY' || !b.goal) continue;
      if (Math.hypot(b.goal.x - n.x, b.goal.z - n.z) > 1) continue;
      if (b.goal.sx != null) spots.push({ x: b.goal.sx, z: b.goal.sz });
      else { // the first investigator: where he stands, or will stand on his approach line
        const a = Math.atan2(o.z - n.z, o.x - n.x), r = Math.min(D.standOff, Math.hypot(o.x - n.x, o.z - n.z));
        spots.push({ x: n.x + Math.cos(a) * r, z: n.z + Math.sin(a) * r });
      }
    }
    if (!spots.length) return null;
    const base = Math.atan2(e.z - n.z, e.x - n.x), r = D.standOff * 0.9, g = w.grid;
    for (let k = 0; k <= 7; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * DECOY_SLOT_ANGLE;
      const p = { x: n.x + Math.cos(a) * r, z: n.z + Math.sin(a) * r };
      if (g?.walkableAt && !g.walkableAt(p.x, p.z)) continue;
      if (spots.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= DECOY_SLOT_GAP)) return p;
    }
    return null;
  }

  /** Within CONFIG.ai.decoy.shockIgnore s of a level-3 shock or a broken-off lure: lures are ignored. */
  _lureShocked() {
    const hold = CONFIG.ai.decoy.shockIgnore ?? 0;
    return hold > 0 && this._shockT != null && this.world.time - this._shockT < hold;
  }

  _decoy(dt) {
    const e = this.enemy, D = CONFIG.ai.decoy, g = this.goal, w = this.world;
    const src = g.source;
    // the siren starting (RINT) breaks the lure off; so does a mission's dwell cap (rules.decoyMaxDwell, s)
    const siren = !!w.alarm?.active;
    if (g.siren == null) g.siren = siren;
    const maxDwell = w.mission?.rules?.decoyMaxDwell ?? D.maxDwell ?? null;
    if ((siren && !g.siren) || (maxDwell != null && this.t >= maxDwell)) {
      this._shockT = w.time;
      this._set('RETURN');
      return;
    }
    const off = (src && (src.on === false || src.active === false || src.removed)) || w.time - g.lastPulse > D.pulse + 0.25;
    if (this.phase === 'go') {
      const there = g.sx != null ? Math.hypot(g.sx - e.x, g.sz - e.z) <= 0.3 : this._dist(g) <= D.standOff;
      if (there || !e.isMoving) { e.stop(); this.phase = 'stare'; }
    } else {
      e.faceTowards(g.x, g.z);
      this._look(0);
    }
    if (off) {
      g.offT += dt;
      if (g.offT >= D.giveUp) {
        if (e.spawn?.alarmOnDecoyGiveUp) this._alarmShout('decoy', g.x, g.z);
        this._set('RETURN');
      }
    } else g.offT = 0;
  }

  _startTracks(p) {
    this._lastPrint = p.id;
    this._trail = { ownerId: p.ownerId ?? null, t: p.t };
    this._set('TRACKS', 'go');
    this.goal = { print: p, x: p.x, z: p.z, dist: 0, from: { x: this.enemy.x, z: this.enemy.z } };
    this._look(0);
    this._go(p.x, p.z, CONFIG.ai.investigate.speed);
  }

  _tracks() {
    const e = this.enemy, g = this.goal, F = CONFIG.stealth.footprint, w = this.world;
    if (this.phase === 'go') {
      if (this._dist(g) > 0.7 && e.isMoving) return;
      g.dist += Math.hypot(e.x - g.from.x, e.z - g.from.z);
      g.from = { x: e.x, z: e.z };
      const next = w.ai.footprints.trailFrom(g.print, F.trailFollow);
      if (next && g.dist < F.trailMax) {
        g.print = next; g.x = next.x; g.z = next.z; this._lastPrint = next.id;
        if (this._trail) this._trail.t = Math.max(this._trail.t, next.t);
        this._go(next.x, next.z, CONFIG.ai.investigate.speed);
        return;
      }
      e.stop();
      this.phase = 'look';
      this.pt = 0;
      return;
    }
    e.headOffset = CONFIG.ai.investigate.lookSweep * DEG * Math.sin((2 * Math.PI * this.pt) / CONFIG.ai.investigate.look);
    if (this.pt >= CONFIG.ai.investigate.look) this._set('RETURN');
  }
  // ------------------------------------------------------------ SEARCH / RETURN / DISTRACTED

  /** SEARCH (§4.6): 3 seeded random points within 8 m of lastSeen, 2 s look at each, 20 s total. */
  _startSearch(centre = null) {
    const e = this.enemy, w = this.world, S = CONFIG.ai.search;
    const t = this.target;
    this._set('SEARCH', 'go');
    this.target = null;
    e.target = null;
    if (t) this._refreshHeld(t);
    const c = centre || e.lastSeen || { x: e.x, z: e.z };
    this.searchPts = [];
    if (e.flags.holdsPost || e.soldierType === 'mg' || e.state === 'inVehicle') { this.searchPts = []; this.phase = 'look'; return; }
    for (let k = 0; k < S.points; k++) {
      const a = w.rng.next() * Math.PI * 2, r = w.rng.next() * S.radius;
      const p = w.grid.nearestWalkable?.(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 3);
      if (p) this.searchPts.push({ x: p.x, z: p.z });
    }
    this._nextSearchPoint();
  }

  _nextSearchPoint() {
    const p = this.searchPts.shift();
    if (!p) { this.phase = 'look'; this.pt = 0; return; }
    this.goal = p;
    this.phase = 'go';
    this.pt = 0;
    this._look(0);
    this._go(p.x, p.z, CONFIG.ai.investigate.speed);
  }

  _search() {
    const e = this.enemy, S = CONFIG.ai.search;
    if (this.t >= S.time) return this._set('RETURN');
    if (this.phase === 'go') {
      if (e.isMoving && this.pt < 15 && !this._nearFire()) return;
      e.stop();
      this.phase = 'lookpt';
      this.pt = 0;
      return;
    }
    e.headOffset = CONFIG.ai.investigate.lookSweep * DEG * Math.sin((2 * Math.PI * this.pt) / S.look);
    e.sweepActive = false;
    if (this.phase === 'lookpt' && this.pt >= S.look) this._nextSearchPoint();
  }

  /** RETURN (§4.6): back to the post or the nearest route waypoint at 1.8 m/s → IDLE. */
  _return(dt) {
    const e = this.enemy;
    this._look(0);
    const home = this._homePoint();
    // home, or beside it when another man stands on it (Unit._avoidPlan stops a walker beside a man on his goal)
    if (this._dist(home) <= 0.5 || (!e.isMoving && this._homeTaken(home))) {
      e.stop();
      e.vel = this.routeVel;
      this._set(this.idleState);
      this._applyHead();
      if (e.route) this.waitT = 0;
      return;
    }
    this._repathT -= dt;
    if (!e.isMoving && this._repathT <= 0) {
      this._repathT = 1;
      if (!this._go(home.x, home.z, CONFIG.ai.investigate.speed, { fallback: false })) { this._set(this.idleState); this._applyHead(); }
    }
  }

  /** Another man standing on `home` with this enemy already beside it (a body width off). */
  _homeTaken(home) {
    const e = this.enemy, w = this.world, c = CONFIG.units.avoid.clear;
    if (this._dist(home) > c + 0.15 || !w.entitiesInRadius) return false;
    return w.entitiesInRadius(home.x, home.z, c, (n) => n !== e && !n.path && blocksUnit(e, n)).length > 0;
  }

  /** Post position, or the nearest route waypoint (route index updated). */
  _homePoint() {
    const e = this.enemy;
    const lead = this._leader();
    if (lead && lead !== e && lead.alive) return this._followPoint(lead) || lead;
    if (e.route && this.routeType !== 'STOPPED') {
      this._pickNearestWaypoint();
      return e.route[this.routeIndex];
    }
    return e.post || this._home || { x: e.x, z: e.z };
  }

  _distracted() {
    const e = this.enemy, s = this.distractedBy;
    if (!s || !s.alive || s.disguised === false) { this.releaseDistraction(); return; }
    e.faceTowards(s.x, s.z);
    this._look(0);
  }

  // ------------------------------------------------------------ IDLE: post / route / squad (§4.1, §4.6)

  _idle(dt) {
    const e = this.enemy;
    if (this.combatReady && this.alertT <= 0) this.combatReady = false;
    const lead = this._leader();
    if (lead && lead !== e && lead.alive) return this._follow(dt, lead);
    if (this.arch.script === 'dog' && e.spawn?.handler != null) return this._heel(dt);
    if (this._partnerGlance(dt)) return;
    if (!e.route || this.routeType === 'STOPPED') return this._post(dt);
    this._route(dt);
  }

  _post(dt) {
    const e = this.enemy;
    const p = e.post || this._home;
    if (p && Math.hypot(p.x - e.x, p.z - e.z) > 0.6) return this._set('RETURN');
    if (this.noiseTurnT > 0) { this._sweep(true); return; } // sweep re-centred on the noise heading
    if (e.post) e.turnToHeading(e.post.heading, dt);
    this._sweep(true);
  }

  _route(dt) {
    const e = this.enemy, r = e.route;
    const wp = r[this.routeIndex];
    if (this._isLeader()) this._recordTrail();
    if (!this.atWait) {
      const tk = e.track || e; // route progress is measured on the path track (not the dodge lane / corner curve)
      if (Math.hypot(wp.x - tk.x, wp.z - tk.z) > 0.3) {
        this._look(0);
        if (!e.isMoving) {
          const v = wp.speed ?? this.routeVel;
          e.vel = v;
          if (!e.moveTo(wp.x, wp.z)) this._advanceWaypoint();
        }
        return;
      }
      // a pass-through waypoint (no wait, look or event): walk straight on to the next one — the one-tick stop
      // there flashed the idle pose at every corner of a patrol (playtest: "soldiers jerking" on M1)
      if (!(wp.wait > 0) && wp.look == null && !wp.event && r.length > 1) {
        this._advanceWaypoint();
        let nx = r[this.routeIndex];
        // a LOOP closes on its first point: skip the duplicate too (still pass-through)
        for (let k = 0; k < r.length && Math.hypot(nx.x - tk.x, nx.z - tk.z) <= 0.3 && !(nx.wait > 0) && nx.look == null && !nx.event; k++) { this._advanceWaypoint(); nx = r[this.routeIndex]; }
        if (nx !== wp && Math.hypot(nx.x - tk.x, nx.z - tk.z) > 0.3) {
          e.vel = nx.speed ?? this.routeVel;
          if (e.moveTo(nx.x, nx.z)) return;
        }
        e.stop();
        return;
      }
      e.stop();
      this.atWait = true;
      this.waitT = wp.wait ?? 0;
      if (this.waitT > 0) this._sweep(true, CONFIG.stealth.vision.patrolWatch.sweep * DEG, CONFIG.stealth.vision.patrolWatch.period);
    }
    if (wp.look != null) e.turnToHeading(wp.look * DEG, dt); // `look` heading in degrees (§4.1)
    this.waitT -= dt;
    if (this.waitT > 0) return;
    this.atWait = false;
    this._look(0);
    if (wp.event && this.world.alarm) this.world.alarm.fireEvent(wp.event, { cause: 'route', x: wp.x, z: wp.z }); // §4.9 follow-up events
    this._advanceWaypoint();
  }

  _advanceWaypoint() {
    const e = this.enemy, r = e.route;
    if (r.length < 2) return;
    if (this.routeType === 'LOOP' || e.routeMode === 'loop') {
      this.routeIndex = this.routeIndex + 1 < r.length ? this.routeIndex + 1 : Math.min(this._loopStart ?? 0, r.length - 1);
    } else {
      if (this.routeIndex + this.routeDir >= r.length || this.routeIndex + this.routeDir < 0) this.routeDir *= -1;
      this.routeIndex += this.routeDir;
    }
  }

  /** The waypoint the route goes to after the current one (no state change), or null without a route. */
  _nextWaypoint() {
    const r = this.enemy.route;
    if (!r || r.length < 2) return null;
    let i = this.routeIndex;
    if (this.routeType === 'LOOP' || this.enemy.routeMode === 'loop') i = i + 1 < r.length ? i + 1 : Math.min(this._loopStart ?? 0, r.length - 1);
    else i += i + this.routeDir >= r.length || i + this.routeDir < 0 ? -this.routeDir : this.routeDir;
    return r[i] || null;
  }

  _pickNearestWaypoint() {
    const e = this.enemy;
    let best = 0, bd = Infinity;
    e.route.forEach((p, k) => {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) { bd = d; best = k; }
    });
    this.routeIndex = best;
  }

  /** §4.6 partner glance: every 25 s the sentry turns to its partner for 2.5 s. */
  _partnerGlance(dt) {
    const e = this.enemy, w = this.world, G = CONFIG.ai.partnerGlance;
    if (!e.partner) return false;
    this.glanceT -= dt;
    if (this.glanceT > 0) return false;
    const p = w.byId(e.partner);
    if (this.glanceT > -dt) { // glance starts: a missing, dead or carried-off partner → INVESTIGATE his post
      if (!p || !p.alive || p.state === 'carried' || p.removed) {
        this.glanceT = G.every;
        const post = p?.post || p?.spawn || null;
        if (post) this._startInvestigate(post.x, post.z);
        return true;
      }
    }
    if (p) { e.faceTowards(p.x, p.z); this._look(0); }
    if (this.glanceT <= -G.dur) { this.glanceT = G.every; this._applyHead(); }
    return true;
  }
  _startInvestigate(x, z, speed = CONFIG.ai.investigate.speed) {
    this._set('INVESTIGATE', 'go');
    this.goal = { x, z, speed };
    this._look(0);
    this._go(x, z, speed);
  }

  // ------------------------------------------------------------ squads (§4.1 patrols)

  /** Squad leader entity of this enemy's squad (or null). */
  _leader() {
    const id = this.enemy.squad?.id;
    if (!id || !this.world?.ai) return null;
    const sq = this.world.ai.squads.get(id);
    if (!sq) return null;
    if (sq._leaderId !== undefined) { sq.leader = (sq._leaderId != null && this.world.byId(sq._leaderId)) || sq.leader; delete sq._leaderId; }
    if (!sq.leader || !sq.leader.alive) { // promote the next living member
      sq.leader = [...sq.members].find((m) => m.alive && !m.removed) || null;
      sq.trail.length = 0;
    }
    return sq.leader;
  }

  _isLeader() {
    const l = this._leader();
    return l === this.enemy;
  }

  /**
   * Leader breadcrumbs (newest first, 0.3 m apart). A route halt or a reversal starts a fresh leg: the trail is
   * cut to the halt point, so the followers close up there and fall in behind the leader on the new leg instead
   * of walking the old leg back through him (playtest: "without crossing each other").
   */
  _recordTrail() {
    const e = this.enemy, sq = this.world.ai.squads.get(e.squad.id);
    const tr = sq.trail;
    if (this._routeHalt()) {
      if (!sq.halt || sq.halt.x !== e.x || sq.halt.z !== e.z) { // frozen at entry: he turns to `look` while he waits
        const dir = trailDir(tr, e), nx = this._nextWaypoint();
        const nl = nx ? Math.hypot(nx.x - e.x, nx.z - e.z) : 0;
        const next = nl > 0.5 ? { x: (nx.x - e.x) / nl, z: (nx.z - e.z) / nl } : null;
        const turn = next ? dir.x * next.x + dir.z * next.z : 1; // cos of the turn onto the next leg
        sq.halt = { x: e.x, z: e.z, dir, next, turn };
        // about turn: the file faces the other way, so its tail becomes its head (nobody overtakes a mate)
        if (turn < -0.5) sq.flip = !sq.flip;
      }
      if (tr.length !== 1 || tr[0].x !== e.x || tr[0].z !== e.z) { tr.length = 0; tr.push({ x: e.x, z: e.z }); }
      return;
    }
    sq.halt = null;
    if (!tr.length || Math.hypot(tr[0].x - e.x, tr[0].z - e.z) >= 0.3) {
      if (tr.length >= 2) { // an about turn without a halt (> 120°): the old leg is behind the followers, not the leader
        const a = trailDir(tr.slice(1), tr[0]), bx = e.x - tr[0].x, bz = e.z - tr[0].z;
        if (a.x * bx + a.z * bz < -0.5 * Math.hypot(bx, bz)) { tr.length = 1; sq.flip = !sq.flip; }
      }
      tr.unshift({ x: e.x, z: e.z });
      if (tr.length > 80) tr.length = 80;
    }
  }

  /** Straight walkable line from this man to p (same level, body clearance): steer at it without A*. */
  _steerable(p) {
    const e = this.enemy, w = this.world, g = w.grid;
    if (!g.walkableLine(e.x, e.z, p.x, p.z, { clearance: 0.3, elevRef: g.elevAt(e.x, e.z) })) return false;
    // nor through a solid the grid does not hold (a vehicle hull, a wreck, a crate: body-clearance.js) — those he
    // paths round (Unit._planPath); steering straight walked a file into a passing half-track's way (M11)
    if (!hasObstacles(w) || (e.y || 0) > 1) return true;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz), h = Math.atan2(dz, dx), n = Math.ceil(d / 0.5), ign = e._bodyIgnore?.() ?? null;
    for (let k = 1; k <= n; k++) if (bodyGap(w, e.x + (dx * k) / n, e.z + (dz * k) / n, h, e.stance, ign) < MOVE_MARGIN) return false;
    return true;
  }

  /** Standing at a route waypoint's wait (IDLE on his route; a stale flag from before an alarm does not count). */
  _routeHalt() { return this.state === 'IDLE' && this.atWait && this.waitT > 0 && !this.enemy.isMoving; }

  /** Live squad mates of this enemy other than the leader, in squad order (their rank order). */
  _mates(lead) {
    const sq = this.world.ai.squads.get(this.enemy.squad.id);
    const out = [...sq.members].filter((m) => m.alive && m !== lead && !m.removed);
    return sq.flip ? out.reverse() : out;
  }

  /**
   * Breadcrumb point of this member: k·1.2 m behind the leader along its trail, in `columns` columns.
   * @param {number} [ahead] metres further up the trail (the pure-pursuit aim point that smooths merges and corners)
   */
  _followPoint(lead, ahead = 0) {
    const e = this.enemy, sq = this.world.ai.squads.get(e.squad.id);
    const k = this._mates(lead).indexOf(e);
    if (k < 0) return null;
    const cols = Math.max(1, e.squad.columns || 1);
    const rank = Math.floor(k / cols) + 1, col = cols > 1 ? this._column(lead, k, cols) : 0;
    const want = Math.max(0.3, rank * CONFIG.ai.squadSpacing - ahead);
    let acc = 0, prev = { x: lead.x, z: lead.z };
    let pt = null;
    for (const p of sq.trail) {
      const seg = Math.hypot(p.x - prev.x, p.z - prev.z);
      if (acc + seg >= want) { const f = seg > 0 ? (want - acc) / seg : 0; pt = { x: prev.x + (p.x - prev.x) * f, z: prev.z + (p.z - prev.z) * f }; break; }
      acc += seg;
      prev = p;
    }
    // trail shorter than the slot (fresh leg after a halt): fall in diagonally, `want` short of the leader on the
    // straight line from this man (no detour back to the halt point, never ahead of the leader)
    if (!pt && sq.trail.length) {
      const dx = lead.x - e.x, dz = lead.z - e.z, dl = Math.hypot(dx, dz) || 1;
      // still ahead of a leader walking off past him (an about turn): hold until he has gone by
      // (his walk, not his still turning body; setting off, the way his path goes — a follower must not step off
      // towards a leader about to walk past him, then stop again)
      let lvx = lead.vx || 0, lvz = lead.vz || 0, ls = Math.hypot(lvx, lvz);
      const lw = ls <= 0.1 && lead.path ? lead.path[lead.pathIndex] : null;
      if (lw) { lvx = lw.x - lead.x; lvz = lw.z - lead.z; ls = Math.hypot(lvx, lvz); if (ls < 0.3) ls = 0; }
      if (ls > 0.1 && -(dx * lvx + dz * lvz) / ls > -0.6) pt = { x: e.x, z: e.z, hold: true };
      else pt = { x: lead.x - (dx / dl) * want, z: lead.z - (dz / dl) * want };
    }
    if (!pt) pt = { x: prev.x - Math.cos(lead.heading) * (want - acc), z: prev.z - Math.sin(lead.heading) * (want - acc) };
    if (cols > 1) { // after an odd number of about turns the leader faces the other way: each man keeps his world side
      const off = (col - (cols - 1) / 2) * 1.2 * (sq.flip ? -1 : 1);
      pt.x += -Math.sin(lead.heading) * off; pt.z += Math.cos(lead.heading) * off;
    }
    return pt;
  }

  /**
   * Column of this man in a multi-column squad, fixed per rank the first time it is asked from where the men
   * stand (rightmost of the rank → column 0 …), so nobody crosses the leader's line to reach his column.
   */
  _column(lead, k, cols) {
    const e = this.enemy, sq = this.world.ai.squads.get(e.squad.id);
    const n = this._mates(lead).length;
    if (!sq.cols || sq.colsN !== n) { sq.cols = new Map(); sq.colsN = n; } // a man fell: re-form the ranks
    if (!sq.cols.has(e.id)) {
      const mates = this._mates(lead), r0 = Math.floor(k / cols) * cols;
      const rank = mates.slice(r0, r0 + cols);
      const lx = -Math.sin(lead.heading), lz = Math.cos(lead.heading), f = sq.flip ? -1 : 1;
      const lat = (m) => ((m.x - lead.x) * lx + (m.z - lead.z) * lz) * f;
      const sorted = [...rank].sort((a, b) => lat(a) - lat(b) || (a.id < b.id ? -1 : 1));
      // a short last rank: each man takes the outermost column on his own side
      sorted.forEach((m, c) => { if (!sq.cols.has(m.id)) sq.cols.set(m.id, rank.length < cols && lat(m) >= 0 ? cols - rank.length + c : c); });
    }
    return sq.cols.get(e.id) ?? k % cols;
  }

  /**
   * Halt slot: during a route halt before a sharp turn / about turn, each man sidesteps to ≥ 1 m off the
   * leader's line at his own place along it, so the leader's next leg never runs through the file.
   * Null when the next leg goes on ahead, or neither side is walkable (he keeps the breadcrumb slot).
   */
  _besidePoint(lead) {
    const e = this.enemy, sq = this.world.ai.squads.get(e.squad.id), g = this.world.grid, H = sq.halt;
    // only when the next leg turns back past the file (> 60°): straight on, the file just waits behind him
    if (!H || H.turn > 0.5) return null;
    const d = H.dir, px = -d.z, pz = d.x; // left of the arrival direction
    const rx = e.x - lead.x, rz = e.z - lead.z;
    const back = Math.max(0.35, -(rx * d.x + rz * d.z)), lat = rx * px + rz * pz;
    // side: a single file stands outside the turn; a multi-column squad keeps each man's own side
    let pref = lat >= 0 ? 1 : -1;
    if ((e.squad.columns || 1) <= 1 && H.next) { const sd = H.next.x * px + H.next.z * pz; if (Math.abs(sd) > 0.25) pref = sd > 0 ? -1 : 1; }
    const off = Math.max(1.0, Math.abs(lat));
    for (const s of [pref, -pref]) { // a sidestep at his own place along the line: the file keeps its order
      const x = lead.x + px * s * off - d.x * back, z = lead.z + pz * s * off - d.z * back;
      if (g.walkableLine(lead.x, lead.z, x, z, { clearance: 0.3, elevRef: g.elevAt(lead.x, lead.z) })) return { x, z };
    }
    return null;
  }

  /**
   * Make way: the leader is walking back at this man (an about turn or a sharp corner without a halt) and
   * would pass within a body width — sidestep to 1 m off his line, on the side he already stands.
   * @returns {{x:number, z:number}|null}
   */
  _makeWay(lead) {
    const e = this.enemy, g = this.world.grid;
    const sp = Math.hypot(lead.vx || 0, lead.vz || 0);
    if (sp < 0.1) return null;
    const fx = lead.vx / sp, fz = lead.vz / sp, rx = e.x - lead.x, rz = e.z - lead.z;
    const along = rx * fx + rz * fz, lat = -rx * fz + rz * fx;
    if (along <= 0 || along > 3 || Math.abs(lat) >= 0.85) return null; // (sidestep to 1.05: hysteresis, no dither)
    const pref = lat >= 0 ? 1 : -1;
    for (const s of [pref, -pref]) {
      const x = lead.x + fx * along - fz * s * 1.05, z = lead.z + fz * along + fx * s * 1.05;
      if (g.walkableLine(e.x, e.z, x, z, { clearance: 0.3, elevRef: g.elevAt(e.x, e.z) })) return { x, z };
    }
    return null;
  }

  /**
   * Squad member in IDLE: walks his slot behind the leader with a speed controller (the leader's pace plus a
   * braking catch-up term, accel-limited) instead of re-pathing to a moving point and stopping on it every
   * 0.25 s — the stop-start stutter of the M1 south patrol. He never closes in on a mate ahead (≥ 0.9 m).
   */
  _follow(dt, lead) {
    const e = this.enemy, lb = lead.brain;
    // a frozen squad faces its (distracted) leader (§4.6)
    if (lb?.state === 'DISTRACTED') { e.stop(); this._fv = 0; e.faceTowards(lead.x, lead.z); this._look(0); return; }
    if (lb?.squadTrail !== false) lb?._recordTrail?.();
    // making way for the leader walking by: a sidestep once begun is walked to its end (an aborted one is a shuffle)
    let way = this._makeWay(lead);
    if (way) this._wayPt = { x: way.x, z: way.z, t: 1.2 };
    else if (this._wayPt && (this._wayPt.t -= dt) > 0 && Math.hypot(this._wayPt.x - this.enemy.x, this._wayPt.z - this.enemy.z) > CONFIG.ai.squadFollow.stop) way = this._wayPt;
    else this._wayPt = null;
    const halted = !!way || (!!lb?._routeHalt?.() && !lead.isMoving);
    const pt = way || (halted && this._besidePoint(lead)) || this._followPoint(lead);
    if (!pt) return;
    const F = CONFIG.ai.squadFollow;
    const d = Math.hypot(pt.x - e.x, pt.z - e.z);
    const base = lead.isMoving ? lead.speed : 0;
    // catching up: half again a walking pace, a quarter more than a running leader (a soldier, not a sprinter)
    const walk = velToSpeed(this.routeVel), top = Math.max(walk * F.catchUp, base * (base > walk * 1.2 ? 1.25 : F.catchUp));
    // signed slot error along the line to the leader: ahead of his slot he eases off instead of turning back
    const dl = Math.hypot(lead.x - e.x, lead.z - e.z);
    const err = !halted && dl > 1e-6 ? ((pt.x - e.x) * (lead.x - e.x) + (pt.z - e.z) * (lead.z - e.z)) / dl : d;
    const x = Math.max(0, Math.abs(err) - F.arrive);
    // his real pace last tick caps the controller's memory (he may have reached his slot and stood since)
    // (his own pace, before the avoidance's brake on top of it: the two would compound into a hard stop)
    const v0 = Math.min(this._fv ?? 0, (e.path ? (e.trackV ?? 0) / Math.max(0.05, e._avScale ?? 1) : 0) + F.accel * dt);
    let want;
    if (pt.hold) want = 0;
    else if (base > 0) { // keeping station on a walking leader: braking curve, linear near the slot (no limit cycle)
      const fix = Math.min(Math.sqrt(2 * F.decel * x), F.gain * x);
      // behind the leader's back with his slot still behind him (fresh leg): stand until the slot comes up
      want = err >= 0 ? Math.min(top, base + fix) : v0 < 0.05 ? 0 : Math.max(0, base - fix);
    } else { // walking up to a standing slot: constant-deceleration stop, no creeping at a crawl
      // standing still he starts only for a real step (2 × stop): no stop-go dither on a slot that creeps
      want = d < (v0 < 0.05 ? 2 * F.stop : F.stop) || err < 0 ? 0 : Math.min(top, Math.max(F.minWalk, Math.sqrt(2 * F.decel * d)));
    }
    if (!halted) { // keep clear of the mates ahead of him in the file (and the leader)
      const mates = this._mates(lead), k = mates.indexOf(e);
      // only men in front of him on his way (one beside him is the avoidance lane's business)
      const ux = pt.x - e.x, uz = pt.z - e.z, ul = Math.hypot(ux, uz) || 1;
      const inFront = (m) => ((m.x - e.x) * ux + (m.z - e.z) * uz) / ul > 0.3;
      let gap = inFront(lead) ? Math.hypot(lead.x - e.x, lead.z - e.z) : Infinity;
      for (let j = 0; j < k; j++) if (inFront(mates[j])) gap = Math.min(gap, Math.hypot(mates[j].x - e.x, mates[j].z - e.z));
      // standing behind a mate he waits for a real gap (minGap + gapHyst) before he steps off: a file moving off
      // after a halt does not stop-start at a crawl (walk / idle flicker)
      want = v0 < 0.05 && gap < F.minGap + F.gapHyst ? 0 : Math.min(want, Math.max(0, (gap - F.minGap) * F.gapGain));
    }
    // standing, he steps off only for a real walk (≥ minWalk, wanted for F.startT s): a creeping slot or a hold
    // that comes and goes is no reason for a one-frame walk (walk / idle flicker)
    if (v0 < 0.05) {
      this._goT = want >= F.minWalk ? (this._goT || 0) + dt : 0;
      if (this._goT < F.startT && !way) want = 0;
    } else this._goT = 0;
    const v = want > v0 ? Math.min(want, v0 + F.accel * dt) : Math.max(want, v0 - F.decel * dt);
    this._fv = v;
    // (holding for a leader walking by: he brakes at a walker's rate first — a dead stop from a walk reads as a jerk)
    if (want === 0 && (v < 0.02 || (pt.hold && v < 0.3) || (base === 0 && d < F.stop))) { // standing (or holding for a leader walking by): a clean stop
      this._fv = 0;
      if (e.isMoving) e.stop();
      if (!lead.isMoving) e.turnToHeading(lead.heading, dt); // held up behind a moving file: keep facing the way on
    } else {
      e.vel = v / CONFIG.ai.velMul;
      this._repathT -= dt;
      // pure pursuit: aim a little further up the trail than the slot (rounded corners, smooth merge after a halt)
      const mv = Math.hypot(e.vx || 0, e.vz || 0), bd = (v * v) / (2 * F.decel) + 0.05; // braking to a hold: on his way, a stop's length
      const aim = pt.hold && mv > 0.05 ? { x: e.x + (e.vx / mv) * bd, z: e.z + (e.vz / mv) * bd } : halted || pt.hold ? pt : this._followPoint(lead, F.lookahead) || pt;
      if (this._steerable(aim)) e.steerTo(aim.x, aim.z);
      // (no straight line: a path to the aim point, renewed before its end while the slot moves on — arriving on a
      // stale slot point at a walk would stop him dead for a tick)
      else if (this._repathT <= 0 || !e.isMoving || (base > 0 && e._pathLeft && e._pathLeft(1) < v * 0.4 + 0.1)) {
        this._repathT = 0.25;
        if (!e.moveTo(aim.x, aim.z) && (aim === pt || !e.moveTo(pt.x, pt.z))) { e.stop(); this._fv = 0; }
      }
    }
    if (lb?.atWait) this._sweep(true, CONFIG.stealth.vision.patrolWatch.sweep * DEG, CONFIG.stealth.vision.patrolWatch.period);
    else this._look(0);
  }

  /** §4.1 dog: follows its handler, 1.5 m behind (a dead handler leaves it at its post). */
  _heel(dt) {
    const e = this.enemy;
    const h = this.world.byId(e.spawn.handler);
    if (!h || !h.alive) return this._post(dt);
    const bx = h.x - Math.cos(h.heading) * 1.5, bz = h.z - Math.sin(h.heading) * 1.5;
    this._repathT -= dt;
    const d = Math.hypot(bx - e.x, bz - e.z);
    if (d > 0.6 && this._repathT <= 0) { this._repathT = 0.3; e.vel = (h.vel || this.routeVel) * (d > 3 ? 2 : 1.2); e.moveTo(bx, bz); }
    if (!e.isMoving) e.turnToHeading(h.heading, dt);
    this._sweep(true);
  }

  // ------------------------------------------------------------ special scripts (§4.1 roster)

  /** Engineer / general: at the slightest alarm or suspicion run to the detonator / the nearest car. */
  _scriptAlarm(x, z) { // eslint-disable-line no-unused-vars
    const e = this.enemy, w = this.world;
    if (!e.alive || this.state === 'ALARM_RUN') return;
    let goal = null, speed = CONFIG.ai.engineerRun, evt = e.spawn?.onArrive;
    if (this.arch.script === 'engineer') {
      const d = e.spawn?.detonator;
      if (d) goal = { x: d.x ?? d[0], z: d.z ?? d[1] };
      evt = evt || 'DETONATE';
    } else if (this.arch.script === 'general') {
      let best = null, bd = Infinity;
      for (const v of w.vehicles) {
        // any staff car (car, citroen15, horch, kubelwagen …: registry model 'car'); spawn.cars limits the choice
        if (v.destroyed || !(v.vehicleType === 'car' || v.def?.model === 'car')) continue;
        if (e.spawn?.cars && !e.spawn.cars.includes(v.tag ?? v.id)) continue;
        const dd = this._dist(v);
        if (dd < bd) { bd = dd; best = v; }
      }
      if (best) goal = { x: best.x, z: best.z, vehicle: best };
      speed = CONFIG.ai.chaseSpeed;
      evt = evt || 'GENERAL_ESCAPED';
    }
    if (!goal) return;
    this._set('ALARM_RUN', 'run');
    this.goal = { ...goal, speed, event: evt, route: null };
    this._look(0);
    this._go(goal.x, goal.z, speed);
  }

  /** Courier (M4): mounts and rides his EXIT route to the barracks, then fires that zone's event. */
  _startAlarmRun(x, z) {
    const e = this.enemy;
    if (this.state === 'ALARM_RUN') return;
    const pts = (e.spawn?.exitRoute || (this.routeType === 'EXIT' ? e.route : null) || []).map((p) => ({ x: p.x ?? p[0], z: p.z ?? p[1] }));
    if (!pts.length) pts.push({ x: e.x, z: e.z });
    e.lastSeen = { target: null, x, z, t: this.world.time };
    this._set('ALARM_RUN', 'run');
    this.goal = { route: pts, idx: 0, speed: CONFIG.ai.courierSpeed, event: e.spawn?.alarmEvent || 'REXT', ...pts[0] };
    this._look(0);
    this._go(pts[0].x, pts[0].z, this.goal.speed);
  }

  _alarmRun() {
    const e = this.enemy, g = this.goal, w = this.world;
    if (this._dist(g) > 1.2 && e.isMoving) return;
    if (g.route && g.idx < g.route.length - 1) {
      g.idx++;
      Object.assign(g, g.route[g.idx]);
      this._go(g.x, g.z, g.speed);
      return;
    }
    if (this._dist(g) > 1.2 && this.pt < 0.5) return;
    if (!g.fired) {
      g.fired = true;
      if (g.shout) { this._alarmShout(g.shout, e.x, e.z); return this._startSearch(); } // BCD §1.1 woken man at the alarm point
      const zn = w.alarm?.zoneAt(e.x, e.z);
      w.alarm?.fireEvent(g.event, { zoneId: zn?.id ?? null, cause: this.arch.script || 'courier', x: e.x, z: e.z });
      if (g.vehicle && g.vehicle.canEnter?.(e) === true) g.vehicle.enter(e);
    }
  }

  /** Artillery gunner (§4.1): fires on sight at vehicles only (commando-driven or tainted). */
  _gunnerLook() {
    const e = this.enemy, w = this.world;
    if (this.state === 'COMBAT') return;
    for (const v of w.vehicles) {
      if (v.destroyed || !(v.operator || v.tainted)) continue;
      if (canSee(e, v, w) !== 'none') return this._enterCombat(v, { seen: true });
    }
  }

  // ------------------------------------------------------------ panic unstick (§4.6)

  _unstick(dt) {
    const e = this.enemy, P = CONFIG.ai.panic;
    if (this.wanderT > 0) {
      this.wanderT -= dt;
      if (this.wanderT <= 0) { e.stop(); this._stuckRef = null; }
      return;
    }
    if (!e.isMoving) { this._stuckRef = null; return; }
    const r = this._stuckRef || (this._stuckRef = { x: e.x, z: e.z, t: 0 });
    if (Math.hypot(e.x - r.x, e.z - r.z) >= P.minMove) { r.x = e.x; r.z = e.z; r.t = 0; return; }
    r.t += dt;
    if (r.t < P.stuck) return;
    const w = this.world, a = w.rng.next() * Math.PI * 2;
    const p = w.grid.nearestWalkable?.(e.x + Math.cos(a) * 3, e.z + Math.sin(a) * 3, 3);
    this._stuckRef = null;
    if (p) { e.moveTo(p.x, p.z); this.wanderT = P.wander; }
  }

  // ------------------------------------------------------------ reinforcements (§4.9)

  /**
   * Released barracks squad member / reacting patrol: run the exit route at 2.7 m/s, then loop `loop`
   * at 1.8 m/s for the rest of the mission (state REINFORCE; normal patrol rules apply).
   */
  reinforce(exitRoute = [], loop = [], { loopVel, committed = false } = {}) {
    const e = this.enemy;
    const pts = (loop.length ? loop : exitRoute.slice(-1)).map((p) => ({ x: p.x ?? p[0], z: p.z ?? p[1], wait: p.wait ?? 0, look: p.look ?? null }));
    const vExit = CONFIG.ai.reinforceVel.exit;
    const exit = exitRoute.map((p) => ({ x: p.x ?? p[0], z: p.z ?? p[1], wait: 0, event: p.event ?? p[2]?.event, speed: p.speed ?? vExit }));
    // No real exit leg (empty list, or it ends where the squad spawned — the door): the run from the door to
    // the first loop waypoint is the exit at 2.7 m/s; the loop proper then starts on that same waypoint.
    // (4 m = the door's nearestWalkable snap radius in alarm._barracksDoor.)
    const end = exit.at(-1) ?? e;
    if (pts.length && loop.length && Math.hypot(end.x - e.x, end.z - e.z) <= 4) exit.push({ x: pts[0].x, z: pts[0].z, wait: 0, speed: vExit });
    e.route = [...exit, ...pts];
    e.routeMode = 'loop';
    this._loopStart = exit.length;
    this._committedRun = !!committed && exit.length > 0; // deaf to noises on the exit leg (reacting patrols, §4.9)
    this.routeVel = loopVel ?? CONFIG.ai.reinforceVel.loop;
    this._routeType = 'LOOP';
    this.idleState = 'REINFORCE';
    this.routeIndex = 0;
    this.atWait = false;
    e.stop();
    this._set('REINFORCE');
    this._look(0);
  }
  /** Enter a BCD brain state (bcd-brain.js); a plain _set, exposed for the BCD modules. */
  bcdEnter(state, phase = null) {
    this._set(state, phase);
  }

  // ------------------------------------------------------------ save / load

  serialize() {
    const ref = (o) => (o && o.id != null ? o.id : null);
    // entity links by id; a TRACKS print by its footprint id (Director saves the prints with their ids)
    const src = this.goal?.source;
    const g = this.goal ? { ...this.goal, body: ref(this.goal.body), source: src && src.kind ? ref(src) : null,
      print: this.goal.print?.id ?? null, vehicle: ref(this.goal.vehicle) } : null;
    if (g && this.bcd) for (const k of ['pack', 'victim', 'guard']) if (k in g) g[k] = ref(this.goal[k]); // BCD goal refs
    return {
      state: this.state, idleState: this.idleState, phase: this.phase, t: this.t, pt: this.pt,
      routeIndex: this.routeIndex, routeDir: this.routeDir, waitT: this.waitT, atWait: this.atWait,
      targetId: ref(this.target), anchor: this.anchor, aimT: this.aimT, fireT: this.fireT, lostT: this.lostT,
      goal: g, searchPts: this.searchPts, noiseTurnT: this.noiseTurnT, alertT: this.alertT, alertBoost: this.alertBoost,
      glanceT: this.glanceT, routeVel: this.routeVel, routeType: this._routeType ?? null, loopStart: this._loopStart ?? null,
      committedRun: !!this._committedRun, route: this.idleState === 'REINFORCE' ? this.enemy.route : null, distractedBy: ref(this.distractedBy),
      wanderT: this.wanderT, stuckRef: this._stuckRef ? { ...this._stuckRef } : null, // §4.6 panic unstick (§10.5 replay)
      lastPrint: this._lastPrint ?? null, trail: this._trail ? { ...this._trail } : null,
      ...(this.bcd ? { lipstickBy: ref(this.lipstickBy) } : null),
      // cadence timers (squad follow re-path, shouts, lure shock) so a load replays the same future (§8.4)
      repathT: this._repathT ?? null, shoutT: this.shoutT ?? null, shockT: this._shockT ?? null, combatReady: !!this.combatReady,
      // squad follower pace (speed, start delay, the doorway / corner point he holds to)
      ...(this._fv || this._goT || this._wayPt ? { follow: [this._fv ?? 0, this._goT ?? 0, this._wayPt ? { ...this._wayPt } : null] } : null),
      stepSusp: this.stepSusp, stepT: this.stepT, stepBarkT: this._stepBarkT, // runningNoise suspicion memory
    };
  }

  deserialize(d) {
    const w = this.world;
    const byId = (id) => (id != null ? w?.byId(id) ?? null : null);
    for (const k of ['state', 'idleState', 'phase', 't', 'pt', 'routeIndex', 'routeDir', 'waitT', 'atWait', 'anchor', 'aimT',
      'fireT', 'lostT', 'searchPts', 'noiseTurnT', 'alertT', 'alertBoost', 'glanceT', 'routeVel', 'wanderT']) if (d[k] !== undefined) this[k] = d[k];
    if (!BRAIN_STATES.includes(this.state) && !BCD_BRAIN_STATES.includes(this.state)) this.state = 'IDLE'; // placeholder-brain saves (lowercase states)
    if (!this.idleState) this.idleState = 'IDLE';
    this._routeType = d.routeType ?? undefined;
    this._loopStart = d.loopStart ?? undefined;
    this._committedRun = !!d.committedRun;
    this._stuckRef = d.stuckRef ? { ...d.stuckRef } : null;
    if (d.route) this.enemy.route = d.route;
    this.target = byId(d.targetId);
    this.enemy.target = this.target;
    this.distractedBy = byId(d.distractedBy);
    const print = d.goal?.print != null ? w?.ai?.footprints?.get?.(d.goal.print) ?? null : null;
    this.goal = d.goal ? { ...d.goal, body: byId(d.goal.body), vehicle: byId(d.goal.vehicle), source: byId(d.goal.source), print } : null;
    if (this.goal) for (const k of ['pack', 'victim', 'guard']) if (k in this.goal) { // BCD goal refs
      const id = this.goal[k];
      this.goal[k] = byId(id);
      if (id != null) (this._bcdGoalIds ??= {})[k] = id; // re-resolved by bcdPostRestore (entities restored later)
    }
    if (d.lipstickBy !== undefined) { this.lipstickBy = byId(d.lipstickBy); this._lipstickById = d.lipstickBy; }
    if (this.goal && this.state === 'BODY' && !this.goal.body) this.state = 'RETURN';
    if (this.goal && this.state === 'TRACKS' && !print) this.phase = 'look'; // older save / print expired
    this._lastPrint = d.lastPrint ?? undefined;
    this._trail = d.trail ? { ...d.trail } : null;
    if (d.repathT != null) this._repathT = d.repathT;
    [this._fv, this._goT, this._wayPt] = d.follow ? [d.follow[0], d.follow[1], d.follow[2] ? { ...d.follow[2] } : null] : [0, 0, null];
    if (d.shoutT != null) this.shoutT = d.shoutT;
    if (d.shockT != null) this._shockT = d.shockT;
    if (d.stepSusp != null) { this.stepSusp = d.stepSusp; this.stepT = d.stepT ?? null; this._stepBarkT = d.stepBarkT ?? null; }
    if (d.combatReady !== undefined) this.combatReady = !!d.combatReady;
    this.burstLeft = 0;
  }
}

/**
 * Factory used by entities/enemy.js.
 * @param {import('../entities/enemy.js').Enemy} enemy
 */
export function createBrain(enemy, rules = null) {
  // BCD wild animals (§1.9); a world whose ruleset has no animals (BEL) gets the plain brain (Enemy.onAdded)
  if (ANIMAL_TYPES.includes(enemy.soldierType) && (!rules || rules.animals)) return new AnimalBrain(enemy);
  return new EnemyBrain(enemy);
}
