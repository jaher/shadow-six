/**
 * BCD brain extension (docs/bcd-plan.md §1.1–§1.3, §1.9): the per-step hooks EnemyBrain calls when its world
 * runs the BCD ruleset (`brain.bcd === true`; never under BEL).
 *
 *   bcdPre(brain, dt)   STUNNED (wake timer → alarm), BOUND, PUPPET (loss rules): consumes the step
 *   bcdScan(brain)      after perception: a comrade seen stunned/bound → REVIVE (alarm for a stunned man;
 *                       a bound man is freed first, then both raise the alarm)
 *   bcdOnSeen(brain, c) commando seen: zookeeper flees + alarm, snitch walks to a guard (REPORT)
 *   bcdState(brain, dt) awake BCD states: STONE, CIGS, LIPSTICK, REVIVE, FLEE, REPORT, BRIDGE
 *   startFlee(brain, …) a non-combatant (a prisoner, a rounded-up civilian) runs to a point and may leave the map
 *                       (spawn `flee: {to, when?, leave?}`, trigger action `flee`); a soldier kicked by a loose
 *                       animal runs clear of it and goes back to his post (fleeFrom)
 *   bridgeCheck(brain)  a route walker whose next leg crosses a raised drawbridge walks to its edge and waits
 *                       (BRIDGE) until it is down again
 * @module ai/bcd-brain
 */

import { CONFIG } from '../config.js';
import { angleTo } from '../core/math.js';
import { canSee, perceive } from './perception.js';
import { rouse, rearmStep } from './bcd-enemy.js';
import { stoneStep, cigsStep, lipstickStep, cigsAbort } from './bcd-reactions.js';
import { isAnimal, recognises } from './bcd-ranks.js';

/** States in which a comrade on the ground is noticed. */
const NOTICE = new Set(['IDLE', 'RETURN', 'INVESTIGATE', 'DECOY', 'SEARCH', 'STONE', 'CIGS', 'REINFORCE', 'BRIDGE']);
const NON_SOLDIERS = new Set(['zookeeper', 'snitch', 'pow', 'dog', 'officer', 'general', 'truckDriver']);

/**
 * His zone's alarm point (§1.1, §1.3): spawn `alarmPoint`, else the zone's `alarmPoint`, else the door of the
 * barracks that answers his zone's onSeen event, else the nearest barracks door. null = none (shout on the spot).
 */
export function alarmPoint(b) {
  const e = b.enemy, w = b.world, a = w.alarm;
  const P = (p) => (p ? { x: p.x ?? p[0], z: p.z ?? p[1] } : null);
  if (e.spawn?.alarmPoint) return P(e.spawn.alarmPoint);
  const zn = a?.zoneAt?.(e.x, e.z);
  if (zn?.alarmPoint) return P(zn.alarmPoint);
  const bars = Object.values(a?.barracks || {}).filter((q) => !q.destroyed && q.squads?.length);
  if (!bars.length || !a._barracksDoor) return null;
  const own = zn ? bars.filter((q) => q.squads.some((s) => s.event === zn.onSeen)) : [];
  let best = null, bd = Infinity;
  for (const q of own.length ? own : bars) {
    const d = a._barracksDoor(q), dd = Math.hypot(d.x - e.x, d.z - e.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

/** Run to the zone's alarm point, then shout "Alarm!" there (ALARM_RUN with a `shout` goal; BEL never sets it). */
export function alarmRun(b, cause) {
  const e = b.enemy, p = alarmPoint(b);
  if (!p || Math.hypot(p.x - e.x, p.z - e.z) < 2) { b._alarmShout(cause, e.x, e.z); return b._startSearch(); }
  b._set('ALARM_RUN', 'run');
  b.goal = { x: p.x, z: p.z, speed: CONFIG.ai.chaseSpeed, shout: cause, route: null };
  b._look(0);
  b._go(p.x, p.z, CONFIG.ai.chaseSpeed);
  return undefined;
}

/**
 * Wake a stunned man: he stands and raises the alarm (§1.1). Woken on his own or the puppet whose controller
 * was shot at: he runs to his zone's alarm point first (can be intercepted); the other puppet losses (LOS,
 * range, controller seen) shout on the spot.
 */
export function wake(b, why = 'wake') {
  const e = b.enemy, w = b.world;
  rouse(e, w, why);
  e.lastSeen = { target: null, x: e.x, z: e.z, t: w.time };
  w.events.emit('enemy:woke', { enemy: e, why });
  if (why === 'wake' || why === 'puppet:shot') return alarmRun(b, 'ko');
  b._alarmShout('ko', e.x, e.z);
  return b._startSearch();
}

/** Puppet control lost (§1.3): he frees himself and raises the alarm where he stands. */
export function losePuppet(b, why) {
  const e = b.enemy, c = e.puppetOf;
  if (c) { c.puppet = null; c.refreshAbilities?.(); }
  e.puppetOf = null;
  e.disguised = false;
  e._puppetJob = null;
  if (e._puppetTalk) { e._puppetTalk.brain?.releaseDistraction?.(); e._puppetTalk = null; }
  e.ko = 'bound'; // rouse() clears it
  wake(b, `puppet:${why}`);
}

/** Is the puppet's controller seen by any other awake enemy (either band)? */
function controllerSeen(b, c) {
  for (const q of b.world.enemies) {
    if (q === b.enemy || !q.alive || q.incapacitated || !q.vision || isAnimal(q)) continue;
    if (canSee(q, c, b.world) !== 'none') return true;
  }
  return false;
}

function puppetStep(b) {
  const e = b.enemy, c = e.puppetOf, w = b.world;
  if (b.state !== 'PUPPET') b._set('PUPPET');
  if (!c.alive) return losePuppet(b, 'controller');
  if (c._bcdAttackedT != null && c._bcdAttackedT >= (e._puppetSince ?? 0)) return losePuppet(b, 'shot');
  const range = CONFIG.bcd.puppet.range;
  if (Math.hypot(c.x - e.x, c.z - e.z) > range + 0.05) return losePuppet(b, 'range');
  if (c.hidden || c.state === 'hidden') return losePuppet(b, 'house'); // a controller inside a house is out of sight
  if (!w.grid.lineOfSight(c.x, c.z, e.x, e.z, { viewerY: c.y || 0, targetY: e.y || 0 })) return losePuppet(b, 'los');
  if (controllerSeen(b, c)) return losePuppet(b, 'seen');
  const tk = e._puppetTalk; // the talk ends when he walks off (the Spy's distract break-off distance)
  if (tk && (!tk.alive || Math.hypot(tk.x - e.x, tk.z - e.z) > CONFIG.abilities.distractBreak)) { tk.brain?.releaseDistraction?.(); e._puppetTalk = null; }
  // arrival at a queued device / vehicle (bcd-puppet ability)
  const job = e._puppetJob;
  if (job && !e.isMoving) {
    e._puppetJob = null;
    job.fn?.();
  }
}

/** STUNNED / BOUND / PUPPET: consumes the whole step (no perception, no cone). */
export function bcdPre(b, dt) {
  const e = b.enemy;
  if (e.puppetOf) { b._seen = []; puppetStep(b, dt); return true; }
  if (e.ko === 'stunned') {
    b._seen = [];
    if (b.state !== 'STUNNED') b._set('STUNNED');
    e.koT -= dt;
    if (e.koT <= 0) wake(b);
    return true;
  }
  if (e.ko === 'bound') {
    b._seen = [];
    if (b.state !== 'BOUND') b._set('BOUND');
    return true;
  }
  if (e._rearm) rearmStep(e, dt, b.world);
  if (e.spawn?.flee?.when != null && !b._fled && b.state !== 'FLEE') fleeWhen(b);
  return false;
}

// ------------------------------------------------------------ non-combatants who run (escort NPCs, loose animals)

const P2 = (p) => (p ? { x: p.x ?? p[0], z: p.z ?? p[1] } : null);

/**
 * Run to `to` (FLEE). `leave`: on arrival he leaves the map (removed; 'unit:fled' — a `deliver` objective counts him as
 * delivered there); `back`: on arrival he goes back to his post / route (RETURN). Plain FLEE (the zookeeper) stays put.
 */
export function startFlee(b, to, o = {}) {
  const e = b.enemy, w = b.world, p = P2(to);
  if (!e.alive || e.removed || e.incapacitated || !p) return false;
  b._fled = true;
  b.goal = { x: p.x, z: p.z, leave: !!o.leave, back: !!o.back, ...(o.from ? { fromAt: { x: o.from.x, z: o.from.z } } : null) };
  b.bcdEnter('FLEE', 'run');
  e.stop?.();
  b._go(p.x, p.z, o.walk ? CONFIG.ai.investigate.speed : CONFIG.ai.chaseSpeed);
  w.events.emit('enemy:flee', { enemy: e, from: o.from ?? null, to: p });
  return true;
}

/** Spawn `flee: {to, when, leave = true}`: he runs once the interactable `when` is open (a door, a gate), on or destroyed. */
function fleeWhen(b) {
  const e = b.enemy, f = e.spawn.flee, w = b.world;
  const it = w.byId?.(f.when) ?? (w.interactables || []).find((i) => (i.tag ?? i.id) === f.when);
  if (!it || !(it.open || it.on || it.destroyed)) return;
  startFlee(b, f.to, { leave: f.leave !== false, walk: !!f.walk });
}

/** A soldier kicked / clawed by a loose animal: he runs 7 m clear of it (no alarm: it is not the enemy), then goes back. */
export function fleeFrom(b, src) {
  const e = b.enemy, w = b.world;
  if (!e.alive || e.incapacitated || !src || AWARE_FLEE.has(b.state) || isAnimal(e) || e.soldierType === 'dog') return false;
  const dx = e.x - src.x, dz = e.z - src.z, n = Math.hypot(dx, dz) || 1;
  const to = w.grid.nearestWalkable?.(e.x + (dx / n) * 7, e.z + (dz / n) * 7, 3) || { x: e.x + (dx / n) * 7, z: e.z + (dz / n) * 7 };
  return startFlee(b, to, { back: true, from: src });
}
/** States a loose animal's kick does not interrupt (he is already fighting or raising the alarm). */
const AWARE_FLEE = new Set(['COMBAT', 'ALARM_RUN', 'CHALLENGE', 'HOLD', 'ARREST', 'STUNNED', 'BOUND', 'PUPPET', 'DEAD']);

function fleeStep(b, dt) {
  const e = b.enemy, g = b.goal, w = b.world;
  if (e.isMoving) return undefined;
  const there = g && Math.hypot(g.x - e.x, g.z - e.z) <= 2;
  if (g?.leave && there && !e.removed) {
    e.fled = true;
    if (w.ai) (w.ai.fled ||= new Set()).add(e.tag ?? e.id);
    w.events.emit('unit:fled', { unit: e, x: e.x, z: e.z });
    w.removeLater(e);
    return undefined;
  }
  if (g?.back) { // clear of the animal: he watches it a few seconds before he goes back
    if (g.waitT == null) { g.waitT = CONFIG.bcd.animals.scare ?? 4; if (g.fromAt) b._turnTo(angleTo(e.x, e.z, g.fromAt.x, g.fromAt.z)); }
    if ((g.waitT -= dt) > 0) return undefined;
    b._fled = false;
    return b._set('RETURN');
  }
  b._look(0);
  return undefined;
}

// ------------------------------------------------------------ drawbridges in a patrol's way

/** Where the walk (x0, z0) → (x1, z1) enters span rect R {x, z, w, d, rot} (Liang–Barsky): t in (0, 1], else null. */
export function spanEntry(R, x0, z0, x1, z1) {
  const c = Math.cos(R.rot ?? 0), s = Math.sin(R.rot ?? 0);
  const u0 = (x0 - R.x) * c + (z0 - R.z) * s, v0 = -(x0 - R.x) * s + (z0 - R.z) * c;
  const du = (x1 - R.x) * c + (z1 - R.z) * s - u0, dv = -(x1 - R.x) * s + (z1 - R.z) * c - v0;
  let t0 = 0, t1 = 1;
  for (const [pp, q] of [[-du, u0 + R.w / 2], [du, R.w / 2 - u0], [-dv, v0 + R.d / 2], [dv, R.d / 2 - v0]]) {
    if (Math.abs(pp) < 1e-9) { if (q < 0) return null; continue; }
    const r = q / pp;
    if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t0 > 0 ? t0 : null; // (already on the span: no wait)
}

/**
 * A route walker (IDLE) whose leg to his current waypoint crosses a drawbridge that is up (or moving) walks to the near
 * edge of the span and waits there (BRIDGE), watching, until it is down; then his route goes on. @returns {boolean}
 */
export function bridgeCheck(b) {
  const e = b.enemy, w = b.world, L = w._drawbridges;
  if (!L?.length || b.state !== 'IDLE' || b.atWait || !e.route?.length || e.squad && b._leader?.() !== e) return false;
  const wp = e.route[b.routeIndex];
  if (!wp) return false;
  for (const br of L) {
    if (br.down || br.removed) continue;
    const t0 = spanEntry(br.rect, e.x, e.z, wp.x, wp.z);
    if (t0 == null) continue;
    const dx = wp.x - e.x, dz = wp.z - e.z, len = Math.hypot(dx, dz) || 1, k = Math.max(0, t0 - 0.8 / len);
    b.goal = { x: e.x + dx * k, z: e.z + dz * k, bridge: br.tag ?? br.id, wp: { x: wp.x, z: wp.z } };
    b.bcdEnter('BRIDGE', 'go');
    e.vel = wp.speed ?? b.routeVel;
    if (Math.hypot(b.goal.x - e.x, b.goal.z - e.z) > 0.3) e.moveTo(b.goal.x, b.goal.z); else e.stop();
    w.events.emit('enemy:bridge-wait', { enemy: e, bridge: br });
    return true;
  }
  return false;
}

function bridgeStep(b) {
  const e = b.enemy, g = b.goal, w = b.world;
  const br = g && (w._drawbridges || []).find((q) => (q.tag ?? q.id) === g.bridge);
  if (!br || br.down || br.removed) return b._set('IDLE'); // down again: his route goes on
  if (b.phase === 'go' && !e.isMoving) {
    b.phase = 'wait';
    b._turnTo(angleTo(e.x, e.z, g.wp.x, g.wp.z));
    const PW = CONFIG.stealth.vision.patrolWatch;
    b._sweep(true, PW.sweep * Math.PI / 180, PW.period);
  }
  return undefined;
}

/** A comrade on the ground (stunned / bound, not carried, not a puppet) seen by this enemy → REVIVE. */
export function bcdScan(b) {
  const e = b.enemy, w = b.world;
  if (b.state === 'IDLE' && w._drawbridges?.length && bridgeCheck(b)) return;
  if (!NOTICE.has(b.state) || NON_SOLDIERS.has(e.soldierType) || isAnimal(e) || !b.arch.reacts) return;
  for (const q of w.enemies) {
    if (q === e || !q.alive || !q.ko || q.puppetOf || q.carriedBy || q.state === 'carried' || q._reviver) continue;
    if (Math.hypot(q.x - e.x, q.z - e.z) > (e.vision?.far ?? 0) + 1) continue;
    if (canSee(e, { x: q.x, z: q.z, y: q.y || 0, kind: 'body' }, w) === 'none') continue;
    cigsAbort(b);
    e.sawBody = true;
    q._reviver = e;
    b.goal = { x: q.x, z: q.z, victim: q, bound: q.ko === 'bound' };
    b.bcdEnter('REVIVE', 'go');
    const first = !q._koReported;
    q._koReported = true; // only the first finder reports / shouts (cleared when he stands up again)
    if (first) w.events.emit('enemy:ko-found', { enemy: e, victim: q });
    if (first && !b.goal.bound) b._alarmShout('body', q.x, q.z); // §1.1: a stunned man = a BEL body (alarm)
    b._go(q.x, q.z, CONFIG.ai.chaseSpeed);
    return;
  }
}

function reviveStep(b) {
  const e = b.enemy, g = b.goal, w = b.world;
  const q = g?.victim;
  if (!q || !q.alive || !q.ko) { if (q) q._reviver = null; return b._startSearch(); }
  if (b.phase === 'go') {
    if (b._dist(q) <= 1.3 || (!e.isMoving && b.pt > 0.3)) { e.stop(); b.phase = 'work'; b.pt = 0; b._turnTo(angleTo(e.x, e.z, q.x, q.z)); e.playAction('use', 1); }
    return;
  }
  const need = g.bound ? CONFIG.bcd.freeTime : CONFIG.bcd.reviveTime;
  if (b.pt < need) return;
  q._reviver = null;
  const bound = q.ko === 'bound';
  rouse(q, w, bound ? 'freed' : 'revived');
  w.events.emit(bound ? 'enemy:freed' : 'enemy:revived', { enemy: q, by: e });
  q.lastSeen = { target: null, x: q.x, z: q.z, t: w.time };
  if (bound) { b._alarmShout('body', q.x, q.z); q.brain?._alarmShout?.('body', q.x, q.z); } // §1.2: both raise the alarm
  q.brain?._startSearch?.();
  b._startSearch();
}

/** Commando seen by a BCD civilian type. @returns {boolean} handled */
export function bcdOnSeen(b, c) {
  const e = b.enemy, w = b.world;
  // §1.8: a Gestapo man sees through Grethe's civilian cover — from then on she is a commando to everyone
  if (e.soldierType === 'gestapo' && c.role === 'grethe' && c.disguised) {
    c.disguised = false;
    c.uniformType = null;
    w.events.emit('message', { text: `${c.nickname}'s cover is blown!`, kind: 'warn', unit: c });
  }
  if (e.soldierType === 'zookeeper') {
    if (b.state === 'FLEE') return true;
    b._alarmShout('seen', c.x, c.z);
    const to = e.spawn?.fleeTo ? { x: e.spawn.fleeTo[0] ?? e.spawn.fleeTo.x, z: e.spawn.fleeTo[1] ?? e.spawn.fleeTo.z }
      : { x: e.x + (e.x - c.x), z: e.z + (e.z - c.z) };
    b.goal = to;
    b.bcdEnter('FLEE', 'run');
    b._go(to.x, to.z, CONFIG.ai.chaseSpeed);
    w.events.emit('enemy:flee', { enemy: e, from: c });
    return true;
  }
  if (e.soldierType === 'snitch') {
    if (b.state === 'REPORT' || c.disguised) return true;
    let guard = null, gd = Infinity;
    for (const q of w.enemies) {
      if (q === e || !q.alive || q.incapacitated || !q.weapon || isAnimal(q) || q.soldierType === 'dog') continue;
      const d = Math.hypot(q.x - e.x, q.z - e.z);
      if (d < gd) { gd = d; guard = q; }
    }
    if (!guard) return true;
    b.goal = { x: guard.x, z: guard.z, guard, seen: { x: c.x, z: c.z } };
    b.bcdEnter('REPORT', 'go');
    b._go(guard.x, guard.z, CONFIG.ai.investigate.speed);
    return true;
  }
  return false;
}

/**
 * §1.6 an unarmed officer (BEL: never reacts) who sees through a disguise: after watching the Spy for
 * CONFIG.bcd.officerRecognise s (his detection meter) he shouts the alarm (his zone's onSeen sensor). He does
 * not react to undisguised commandos (BEL officer rule) — only to the recognition the rank table adds.
 */
export function bcdOfficerLook(b) {
  const e = b.enemy, w = b.world;
  if (!w.rules?.disguiseRanks || b.state !== 'IDLE' && b.state !== 'RETURN') return;
  const seen = perceive(e, w, { prints: false, bodies: false }).commandos.filter((s) => s.unit.disguised && s.unit.state !== 'captured' && recognises(e, s.unit, w));
  if (!seen.length) { b._recog = null; return; }
  const c = seen[0].unit;
  if (!b._recog || b._recog.id !== c.id) b._recog = { id: c.id, since: w.time };
  e.lastSeen = { target: c, x: c.x, z: c.z, t: w.time };
  e.faceTowards?.(c.x, c.z);
  if (w.time - b._recog.since < CONFIG.bcd.officerRecognise || b._recog.shouted) return;
  b._recog.shouted = true;
  w.events.emit('enemy:spotted', { enemy: e, target: c });
  b._shout('alarmShout', 'ger_alarm');
  const a = w.alarm, zn = a?.zoneAt(e.x, e.z);
  if (zn) a.raise(zn.id, 'seen', c.x, c.z, { sensor: 'seen' });
  else a?.raiseUnzoned?.('seen', c.x, c.z, 'seen');
}

function reportStep(b) {
  const e = b.enemy, g = b.goal;
  const guard = g?.guard;
  if (!guard?.alive || guard.incapacitated) return b._set('RETURN');
  if (b._dist(guard) > 2 && b.pt < CONFIG.bcd.snitchReport) { if (!e.isMoving) b._go(guard.x, guard.z, CONFIG.ai.investigate.speed); return; }
  e.stop();
  guard.brain?._alarmShout?.('snitch', g.seen.x, g.seen.z);
  b.world.events.emit('enemy:snitched', { enemy: e, guard });
  b._set('RETURN');
}

/** Awake BCD state behaviours (the EnemyBrain switch's default branch). */
export function bcdState(b, dt) {
  switch (b.state) {
    case 'STONE': return stoneStep(b, dt);
    case 'CIGS': return cigsStep(b, dt);
    case 'LIPSTICK': return lipstickStep(b, dt);
    case 'REVIVE': return reviveStep(b, dt);
    case 'REPORT': return reportStep(b, dt);
    case 'FLEE': return fleeStep(b, dt);
    case 'BRIDGE': return bridgeStep(b, dt);
    default: return undefined;
  }
}

/** Leaving a BCD state (EnemyBrain._set): restore a shortened cone, drop claims. */
export function bcdExit(b, from, to) {
  const g = b.goal;
  if (from === 'CIGS') { cigsAbort(b); if (g?.pack && g.pack.claimedBy === b.enemy) g.pack.claimedBy = null; }
  if (from === 'LIPSTICK' && to !== 'LIPSTICK') {
    const n = b.lipstickBy;
    if (n && n._lipstickTarget === b.enemy) n._lipstickTarget = null;
    b.lipstickBy = null;
  }
  if (from === 'REVIVE' && g?.victim && g.victim._reviver === b.enemy) g.victim._reviver = null;
}
