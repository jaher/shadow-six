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

import { CONFIG } from '../config.js';
import { angleTo, angleDiff, wrapAngle } from '../core/math.js';
import { perceive, canSee, hears } from './perception.js';
import { archetypeOf, isPatrolMember } from './archetypes.js';
import { ensureAI } from './director.js';
import { BCD_BRAIN_STATES } from './bcd-enemy.js';
import { AnimalBrain } from './animal-brain.js';
import { ANIMAL_TYPES } from './bcd-ranks.js';
import { bcdPre, bcdScan, bcdOnSeen, bcdState, bcdExit, bcdOfficerLook } from './bcd-brain.js';

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

  /** A noise reached this enemy (world 'noise' payload {x, z, radius, kind, level, source}) (§4.4). */
  hear(n) {
    const e = this.enemy;
    if (!e.alive || !this.world || !hears(e, n)) return;
    const lvl = n.level ?? 1;
    const S = this.state;
    // BCD: REVIVE / FLEE / REPORT are busy at every level (a revive is never dropped for a comrade's alarm shout —
    // that re-queued the man on the ground for the next finder, a shout/revive livelock); lipstick breaks at ≥ 2
    if (this.bcd && (e.incapacitated || S === 'REVIVE' || S === 'FLEE' || S === 'REPORT' || (lvl < 2 && S === 'LIPSTICK'))) return;
    if (n.kind === 'decoy' && S === 'DECOY' && this.goal) { this.goal.lastPulse = this.world.time; return; }
    if (this.arch.script === 'engineer' || this.arch.script === 'general') return this._scriptAlarm(n.x, n.z);
    if (!this.arch.reacts || BUSY.has(S) || lvl <= 0) return;
    if (S === 'DISTRACTED') { // §4.4: level ≥ 2 breaks the distraction off
      if (lvl >= 2) { this.releaseDistraction(); this._reactNoise(n, lvl); }
      return;
    }
    if (S === 'DECOY' && lvl < 2) return; // at the decoy: ignores level 1
    // a patrol member defers to its squad leader (the leader investigates, the squad follows)
    const lead = this._leader();
    if (lead && lead !== e && lead.alive) { lead.brain?.hear?.(n); return; }
    this._reactNoise(n, lvl);
  }

  _reactNoise(n, lvl) {
    const e = this.enemy;
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
    this._startInvestigate(n.x, n.z, lvl >= 3 ? CONFIG.ai.investigate.runSpeed : CONFIG.ai.investigate.speed);
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
    const sawVictim = canSee(e, { x: victim.x, z: victim.z, y: victim.y || 0, kind: 'body', falling: true }, w) !== 'none';
    const sawKiller = killer && killer.alive && canSee(e, killer, w, { ignoreDisguise: true }) !== 'none';
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
    this._perceive();
    if (!e.alive) return;
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

  _shout(kind, line) {
    const e = this.enemy, w = this.world;
    const N = CONFIG.stealth.noise[kind];
    this.shoutT = w.time;
    w.events.emit('bark', { unit: e, line });
    if (N) w.emitNoise(e.x, e.z, N.radius, kind, e);
  }

  /** "Alarm!" (ger_alarm): alarmShout noise (level 3, 36 m) + the shouter's zone event (§4.9). */
  _alarmShout(cause, x, z) {
    if (!this.arch.alarms) return;
    this._shout('alarmShout', 'ger_alarm');
    this._raiseZone(cause, x ?? this.enemy.x, z ?? this.enemy.z);
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
    if (t.faction === 'player') {
      w.events.emit('enemy:spotted', { enemy: e, target: t });
      w.events.emit('ui:warning', { unit: t, kind: 'seen' });
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
    const range = this.arch.script === 'dog' ? CONFIG.weapons.dogBite.range : W?.range ?? 0;
    if (this.arch.script === 'dog' && e.spawn?.caged) { // caged dogs only bark (§4.1)
      this.fireT -= dt;
      if (vis && this.fireT <= 0) { this.fireT = 1.5; this._shout('bark', 'dog_bark'); }
      return;
    }
    if (vis && W && d <= range + (this.arch.script === 'dog' ? 0.3 : 0) && (!fixed || this._traverseOk(h))) {
      if (e.isMoving) e.stop();
      e.idleAnim = 'aim';
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

  /** `h` clamped into the MG traverse (post heading ± giro/2; mission data `post.giro` or spawn `giro`). */
  _clampTraverse(h) {
    const e = this.enemy;
    const giro = e.spawn?.giro ?? e.post?.giro;
    if (e.soldierType !== 'mg' || !giro || giro >= 360 || !e.post) return h;
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
      if (this._dist(g) <= I.arrive || !e.isMoving) {
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
    if (this.pt >= I.look) this._set('RETURN');
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

  _decoy(dt) {
    const e = this.enemy, D = CONFIG.ai.decoy, g = this.goal, w = this.world;
    const src = g.source;
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
  _startSearch() {
    const e = this.enemy, w = this.world, S = CONFIG.ai.search;
    const t = this.target;
    this._set('SEARCH', 'go');
    this.target = null;
    e.target = null;
    if (t) this._refreshHeld(t);
    const c = e.lastSeen || { x: e.x, z: e.z };
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
      if (e.isMoving && this.pt < 15) return;
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
    if (this._dist(home) <= 0.5) {
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
      if (Math.hypot(wp.x - e.x, wp.z - e.z) > 0.3) {
        this._look(0);
        if (!e.isMoving) {
          const v = wp.speed ?? this.routeVel;
          e.vel = v;
          if (!e.moveTo(wp.x, wp.z)) this._advanceWaypoint();
        }
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

  _recordTrail() {
    const e = this.enemy, sq = this.world.ai.squads.get(e.squad.id);
    const tr = sq.trail;
    if (!tr.length || Math.hypot(tr[0].x - e.x, tr[0].z - e.z) >= 0.3) {
      tr.unshift({ x: e.x, z: e.z });
      if (tr.length > 80) tr.length = 80;
    }
  }

  /** Breadcrumb point of this member: k·1.2 m behind the leader along its trail, in `columns` columns. */
  _followPoint(lead) {
    const e = this.enemy, sq = this.world.ai.squads.get(e.squad.id);
    const members = [...sq.members].filter((m) => m.alive && m !== lead && !m.removed);
    const k = members.indexOf(e);
    if (k < 0) return null;
    const cols = Math.max(1, e.squad.columns || 1);
    const rank = Math.floor(k / cols) + 1, col = k % cols;
    const want = rank * CONFIG.ai.squadSpacing;
    let acc = 0, prev = { x: lead.x, z: lead.z };
    let pt = null;
    for (const p of sq.trail) {
      const seg = Math.hypot(p.x - prev.x, p.z - prev.z);
      if (acc + seg >= want) { const f = seg > 0 ? (want - acc) / seg : 0; pt = { x: prev.x + (p.x - prev.x) * f, z: prev.z + (p.z - prev.z) * f }; break; }
      acc += seg;
      prev = p;
    }
    if (!pt) pt = { x: prev.x - Math.cos(lead.heading) * (want - acc), z: prev.z - Math.sin(lead.heading) * (want - acc) };
    if (cols > 1) { const off = (col - (cols - 1) / 2) * 1.2; pt.x += -Math.sin(lead.heading) * off; pt.z += Math.cos(lead.heading) * off; }
    return pt;
  }

  _follow(dt, lead) {
    const e = this.enemy;
    // a frozen squad faces its (distracted) leader (§4.6)
    if (lead.brain?.state === 'DISTRACTED') { e.stop(); e.faceTowards(lead.x, lead.z); this._look(0); return; }
    const pt = this._followPoint(lead);
    if (!pt) return;
    const d = Math.hypot(pt.x - e.x, pt.z - e.z);
    this._repathT -= dt;
    if (d > 0.4 && this._repathT <= 0) {
      this._repathT = 0.25;
      e.vel = Math.max(this.routeVel, lead.vel || this.routeVel) * (d > 2 ? 1.5 : 1.1);
      if (!e.moveTo(pt.x, pt.z)) e.stop();
    } else if (d <= 0.2 && e.isMoving) e.stop();
    if (!e.isMoving) e.turnToHeading(lead.heading, dt);
    if (lead.brain?.atWait) this._sweep(true, CONFIG.stealth.vision.patrolWatch.sweep * DEG, CONFIG.stealth.vision.patrolWatch.period);
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
        if (v.destroyed || v.vehicleType !== 'car') continue;
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
  reinforce(exitRoute = [], loop = [], { loopVel } = {}) {
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
      route: this.idleState === 'REINFORCE' ? this.enemy.route : null, distractedBy: ref(this.distractedBy),
      wanderT: this.wanderT, stuckRef: this._stuckRef ? { ...this._stuckRef } : null, // §4.6 panic unstick (§10.5 replay)
      lastPrint: this._lastPrint ?? null, trail: this._trail ? { ...this._trail } : null,
      ...(this.bcd ? { lipstickBy: ref(this.lipstickBy) } : null),
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
