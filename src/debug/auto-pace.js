/**
 * Video mode AUTO speed (debug/walkthrough.js, the AUTO button): the pace of the solution films
 * (tools/solutions/capture-video.mjs + <id>.cut.mjs), worked out live. A film knew the future (a logic-only first pass
 * gave it the time of every kill and blast); a live walkthrough reads what is about to happen from the game instead:
 *  - dead time (walks, waits, long crawls) runs fast, at the films' cruise speeds (walk 4×, crawl 8×, everyone waiting
 *    16×) under the walkthrough's ceiling: 4×, or up to 8× (crawls 6×) while the frame rate holds (PerfCeiling);
 *  - a key action (a knife, a harpoon, a shot, a charge, the uniform, handcuffs, a switch, a decoy, a chat-up…) is eased
 *    into as the films eased into their windows, speed ≤ rate × (1 + seconds to go − 0.6): the seconds to go are the
 *    commando's walk-up to his target (his pending order), a guard's walk onto a bear trap; 1× at the stab, the
 *    clothesline take, a switch, a charge; 1.5× for a decoy or a chat-up; while the action runs and until it has
 *    visibly finished (debug/action-hold.js) the walkthrough holds AUTO at 1×;
 *  - after a kill, an objective, a capture, an alarm, a beat of the walkthrough: a moment at 1× (the films' +2 s), then
 *    eased back up the same way (two kills in a row stay slow);
 *  - blasts at ½× (from 0.8 s before the fuse runs out to 3 s after) and the climax — the escape after the last
 *    blast, in the last chapter — at ½× (the films' dam blast and escape, their speed floor);
 *  - the step's acting man closing in on the guard the step names (12 m: 4× … 3 m: 1.5×), a man at work within
 *    striking distance of an unaware guard (2×), a near miss — a guard who would see a man at work if his cone reached
 *    a few metres further, tried with the AI's own canSee (1.5× touching … 4× at 3 m; ×0.75 while the cone turns to
 *    him);
 *  - a new caption: at most 2.5× while it is read (its length sets the reading time).
 * The speed follows that target smoothly: a critically damped spring in log2 space (half-way in ~0.3 s down,
 * ~0.4 s up; a slow-down also holds the next speed-up for a moment, so it never pumps).
 * Pure: nothing here writes game state or draws (tests/unit/auto-pace.test.mjs; canSee only memoises a guard's post, as
 * the AI's own perception does every tick); the pacing changes wall time only — the same ticks run in the same order,
 * so the run and its win time are the scripted run's (tests/debug-walkthrough-sim.test.mjs).
 * @module debug/auto-pace
 */

import { coneAt, canSee, targetClass } from '../ai/perception.js';

export const AUTO_PACE = Object.freeze({
  min: 0.5,
  /** The ceiling: the top fixed speed. */
  max: 4,
  /** Dead time may go this fast while the frame rate holds (PerfCeiling). */
  turboMax: 8,
  /**
   * A skipped true wait (debug/walkthrough.js): a time-lapse drawn every frame, as fast as the frame budget allows
   * (PerfCeiling.rateFor) up to this, eased in and out like any other speed.
   */
  skipMax: 24,
  /** The films' cruise (walk 4×, crawl 8×, idle 16×) under the 4× ceiling, and above it while the frame rate holds. */
  cruise: Object.freeze({ walk: 4, crawl: 4, idle: 4 }),
  turboCruise: Object.freeze({ walk: 4, crawl: 6, idle: 8 }),
  /** The ease into a key moment: speed ≤ rate × (1 + lead × (seconds to go − preroll)) (the films: lead 1, from 6 s
   * ahead); the preroll (s) lets the eased speed arrive at the rate by the moment itself. */
  lead: 1, preroll: 0.6,
  /** After an event's window the speed comes back up twice as fast as it eased in (no dead air after the moment). */
  tailLead: 2,
  /** A charge: ½× from `blastPre` s before it goes off, for `blastPost` s after. */
  blast: 0.5, blastPre: 0.8, blastPost: 3,
  /** The climax (inClimax): the escape after the last blast, as the films' dam blast + escape, ½× for `climaxFor` s. */
  climax: 0.5, climaxFor: 15, climaxBlastLead: 10,
  /** A new caption is read at no more than 2.5×: 1 s + 1 s per 26 characters (2.5–7 s, wall). */
  read: 2.5, readBase: 1, readPerChar: 1 / 26, readMin: 2.5, readMax: 7,
  /** Striking distance (m) of a commando to an unaware guard: at most `near`×. */
  near: 2, nearDist: 3.5,
  /** The step's man at work closing in on the guard it names: from 4× at `subjectFar` m down to `subjectRate`× at `subjectNear` m. */
  subjectFar: 12, subjectNear: 3, subjectRate: 1.5,
  /** The step's man within `objectNear` m of the thing it names (the clothesline, a switch, the bunker's door): about to act on it. */
  objectNear: 3, objectRate: 1.5,
  /** A cone within `coneDist` m of a man it could see: from `coneRate`× (touching) up to 4× (at coneDist); turning to him: ×0.75. */
  coneDist: 3, coneRate: 1.5, turning: 0.75,
  /** The spring (rad/s of the critically damped response, log2 space): faster down than up. */
  wDown: 6, wUp: 4.5,
  /** A slow-down holds the next speed-up for this long (s, wall). */
  upHold: 0.5,
});

/**
 * The rate each key action is watched at (its moment: the stab, the shot, the charge set, the switch). Abilities not
 * listed (move-like ones: dig in, dive, climb, drop, board…) are not key moments.
 */
export const ACTION_RATE = Object.freeze({
  knife: 1, harpoon: 1, pistol: 1, rifle: 1, sniper: 1, smg: 1, grenade: 1, syringe: 1, hanger: 1, lipstick: 1,
  handcuff: 1, timeBomb: 1, remoteBomb: 1, detonate: 1, uniform: 1, vehicleFire: 1,
  use: 1, cutters: 1, trap: 1, // (the clothesline take, a switch, the wire, a bear trap: watched as a kill is, M3 review)
  decoyToggle: 1.5, distract: 1.5, puppet: 1.5, puppetDistract: 1.5, stone: 1.5,
  cigarettes: 1.5, takeCharge: 1.5, firstAid: 1.5, enterVehicle: 1.5,
  raft: 1, // (the Marine inflating / folding the raft: watched)
  hand: 2, carryToggle: 2, drag: 2, decoyDrop: 2,
});
/** An action keeps its rate this long after it starts (s, sim); then it is under way (a long chat-up is not a moment). */
export const ACTION_HOLD = 1.5;

/** Post-event windows: [sim seconds, rate]. */
export const EVENT_WINDOWS = Object.freeze({
  kill: [1.5, 1], objective: [2, 1], capture: [1.5, 1], alarm: [3, 1], alert: [2, 1], distracted: [1.2, 1.5],
  armed: [1, 1.5], checkpoint: [0.7, 2], beat: [1.5, 1.5], commandoDown: [3, 1],
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LOG_MIN = Math.log2(AUTO_PACE.min), LOG_MAX = Math.log2(AUTO_PACE.skipMax);
/** Is commando `c` aboard a vehicle that is going somewhere (rowed, driven: a goal or a route; turning on the spot too)? */
export const underWay = (c) => { const v = c?.vehicle; return !!v && !v.removed && !!(v.goal || v.path); };
const ALERT_RE = /^(ALERT|COMBAT|SEARCH|INVESTIGATE|ALARM)/;
const DISTRACT_RE = /^(DECOY|DISTRACTED)/;
/** The geometry (moves, striking distance, near misses, traps) is refreshed no more often than this (wall ms). */
export const GEO_WALL_MS = 45;
/** A near miss: a man at work within this many metres of the band of a cone he would be seen in (a man lying still: half). */
const NEAR_MISS = 3;
/** A guard this far (m) from a set trap, heading for it, is watched walking onto it; beyond 10 m only one passing within TRAP_MISS m of it. */
export const TRAP_LOOK = 25, TRAP_MISS = 2.5;
/** A guard following footprints (TRACKS) within this many metres of a set trap is watched whichever way he faces. */
export const TRAP_TRACKS = 15;
/** A cone `M` m bigger all round (both bands' reach, its aperture by M at distance d). */
const grown = (k, M, d) => ({ ...k, far: k.far + M, near: k.near + M, halfFov: Math.min(Math.PI, k.halfFov + Math.asin(Math.min(1, M / Math.max(d, M)))) });

/**
 * The climax (½×): the last chapter is on (it began at `lastChapterT0`, game s), a blast went off in it or at most
 * climaxBlastLead s before it (at `blastT`), and it is no more than climaxFor s since: M3's dam blast and the truck.
 */
export function inClimax(t, lastChapterT0, blastT) {
  const P = AUTO_PACE;
  return lastChapterT0 != null && blastT != null && t >= lastChapterT0 && blastT >= lastChapterT0 - P.climaxBlastLead && t - blastT < P.climaxFor;
}

/** Reading time (wall s) of a caption of `text`. */
export function readTime(text) {
  const P = AUTO_PACE;
  const n = String(text ?? '').trim().length;
  return n ? clamp(P.readBase + n * P.readPerChar, P.readMin, P.readMax) : 0;
}

/**
 * The speed AUTO wants now. `sig`: a PaceSensor.sample(); `o`: {ceiling (4, or up to 8 while the frame rate holds),
 * reading (wall s left to read the caption), climax (the last chapter is on), skip (a skipped true wait: its
 * time-lapse speed, up to skipMax — the cruise of the wait; every ease below still applies: a guard walking onto a
 * trap brings it down as smoothly as any other moment)}. Returns {rate, why}.
 */
export function paceTarget(sig = {}, o = {}) {
  const P = AUTO_PACE;
  const skip = o.skip > 0 ? clamp(o.skip, P.min, P.skipMax) : 0;
  const ceil = skip || clamp(o.ceiling ?? P.max, P.min, P.turboMax);
  const cruise = ceil > P.max ? P.turboCruise : P.cruise;
  const motion = sig.motion || 'idle';
  let rate = Math.min(ceil, skip || (cruise[motion] ?? P.max)), why = skip ? 'wait' : motion;
  const cap = (v, w) => { if (v < rate) { rate = v; why = w; } };
  const ease = (r, eta) => r * (1 + P.lead * Math.max(0, eta));
  if (sig.action) cap(ease(sig.action.rate, sig.action.eta - P.preroll), sig.action.id);
  if (Number.isFinite(sig.fuse)) cap(ease(P.blast, sig.fuse - P.blastPre), 'charge');
  if (sig.blastAgo != null && sig.blastAgo >= 0) cap(sig.blastAgo <= P.blastPost ? P.blast : ease(P.blast, sig.blastAgo - P.blastPost), 'blast');
  if (Number.isFinite(sig.trapEta)) cap(ease(1, sig.trapEta - P.preroll), 'trap');
  for (const w of sig.windows || []) cap(w.rate * (1 + P.tailLead * Math.max(0, -(w.left ?? 1))), w.why); // (then eased back up, briskly: no pumping between two kills, no dead air after one)
  if (sig.near != null && sig.near <= P.nearDist) cap(P.near, 'close');
  if (sig.cone != null && sig.cone <= P.coneDist) cap((P.coneRate + (P.max - P.coneRate) * (sig.cone / P.coneDist)) * (sig.turning ? P.turning : 1), sig.turning ? 'cone turning' : 'cone');
  if (sig.object != null && sig.object <= P.objectNear) cap(P.objectRate, 'at it');
  if (sig.subject != null && sig.subject <= P.subjectFar) cap(P.subjectRate + (P.max - P.subjectRate) * clamp((sig.subject - P.subjectNear) / (P.subjectFar - P.subjectNear), 0, 1), 'closing in');
  if (o.climax) cap(P.climax, 'climax');
  if (o.reading > 0) cap(P.read, 'caption');
  return { rate: clamp(rate, P.min, ceil), why };
}

/**
 * The eased AUTO speed: step(target, dtWall) moves it toward `target` like a critically damped spring in log2 space
 * (no jump in speed, no overshoot on a step), faster down than up; a slow-down holds the next speed-up for upHold s.
 */
export class AutoPace {
  constructor(rate = 1) { this.reset(rate); }

  get rate() { return 2 ** this.x; }

  reset(rate = 1) {
    this.x = Math.log2(clamp(rate, AUTO_PACE.min, AUTO_PACE.skipMax));
    this.v = 0;
    this.hold = 0;
    this.target = this.rate;
  }

  /**
   * One displayed frame of `dt` wall seconds; returns the speed. `max`: the ceiling now — the speed never rises above
   * it, and eases down under it when it falls (the frame rate dropped).
   */
  step(target, dt, max = AUTO_PACE.turboMax) {
    const P = AUTO_PACE;
    const g = Math.min(Math.log2(clamp(target, P.min, P.skipMax)), Math.log2(clamp(max, P.min, P.skipMax)));
    this.target = 2 ** g;
    if (!(dt > 0)) return this.rate;
    if (g < this.x - 0.03) this.hold = P.upHold;
    else this.hold = Math.max(0, this.hold - dt);
    const goal = g > this.x && this.hold > 0 ? this.x : g;
    const w = goal < this.x ? P.wDown : P.wUp;
    // (sub-steps: a long frame stays stable)
    const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = w * w * (goal - this.x) - 2 * w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    if (this.x > LOG_MAX) { this.x = LOG_MAX; this.v = Math.min(0, this.v); }
    if (this.x < LOG_MIN) { this.x = LOG_MIN; this.v = Math.max(0, this.v); }
    return this.rate;
  }
}

/**
 * How fast dead time may go: 4× (AUTO_PACE.max), up to 8× while the frame rate holds. frame(dtWall, msPerTick):
 * msPerTick = wall ms one sim tick costs here (the game step and the solution's own planning). The ceiling rises
 * (½× a second) only while frames come at 50 fps or better and 8 ms of ticks per frame reach that speed; below 38 fps
 * it falls back to 4× at once (AutoPace eases the speed down under it).
 */
export class PerfCeiling {
  constructor({ simDt = 1 / 60 } = {}) {
    this.simDt = simDt;
    this.fdt = 1 / 60;
    this.tickMs = 0;
    this.ceiling = AUTO_PACE.max;
  }

  frame(dt, msPerTick = null) {
    const P = AUTO_PACE;
    if (!(dt > 0)) return this.ceiling;
    const d = Math.min(dt, 0.25);
    this.fdt += (d - this.fdt) * (1 - Math.exp(-d / 1.0));
    if (Number.isFinite(msPerTick) && msPerTick > 0) this.tickMs = this.tickMs ? this.tickMs + (msPerTick - this.tickMs) * (1 - Math.exp(-d / 2.0)) : msPerTick;
    // the sim speed whose ticks take 8 ms of each displayed frame
    const room = this.tickMs > 0 ? (8 / this.tickMs) * (this.simDt / Math.max(this.fdt, 1 / 120)) : P.max;
    if (this.fdt > 1 / 38) this.ceiling = P.max;
    else if (this.fdt < 1 / 50) {
      const want = clamp(room, P.max, P.turboMax);
      this.ceiling = want < this.ceiling ? want : Math.min(want, this.ceiling + d * 0.5); // up by ½× a second
    }
    return this.ceiling;
  }

  /**
   * The sim speed whose ticks (at the recent wall ms a tick costs, the solution's planning between ticks included) take
   * `budgetMs` of a displayed frame at the recent frame time: what a frame can run without falling behind — or
   * Infinity before any tick was timed. A speed above it would leave ticks owed at every frame's end (paid back in a
   * burst, or let go: uneven steps either way).
   */
  rateFor(budgetMs, frameMs = this.fdt * 1000) {
    if (!(this.tickMs > 0)) return Infinity;
    return (Math.max(0, budgetMs) / this.tickMs) * (this.simDt / Math.max(frameMs / 1000, 1 / 120));
  }
}

/** Is this a true wait? `sig`/`tg`: PaceSensor sample and paceTarget result; o: {waiting (the solution's wait label), busy (a man acts)}. */
export function isTrueWait(sig, tg, { waiting = null, busy = false } = {}) {
  return !!waiting && !busy && (sig?.motion || 'idle') === 'idle' && tg?.why === 'idle';
}

/**
 * AUTO's tick grant follows a steady frame time: frame(dt) returns the dt to grant ticks for — at most `slack` × the
 * usual frame time (an average of the last ~10 frames), so one long frame (a hitch, a shader compile) is not paid back
 * with a burst of ticks on the next one (the lag is let go: the pace is wall time only) and the ticks per frame follow
 * the eased speed.
 */
export class SteadyGrant {
  constructor(slack = 1.25) {
    this.slack = slack;
    this.usual = 0;
  }

  frame(dt) {
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (!this.usual) this.usual = Math.min(d || 1 / 60, 1 / 30);
    const g = Math.min(Math.max(dt || 0, 0), this.slack * this.usual); // (the usual frame before this one counts)
    this.usual += (d - this.usual) * 0.1;
    return g;
  }
}

/**
 * What is about to happen, read from the game (no writes). attach() listens to the world's events (kills, blasts,
 * charges, alarms, guards' brain states, actions); order() / checkpoint() / beat() are the walkthrough's hooks;
 * sample(t, ctx) returns the signals paceTarget reads. The geometry (who moves, striking distance, cones near a man,
 * guards walking onto traps) is refreshed every `every` s of game time.
 */
export class PaceSensor {
  constructor(world, { every = 0.2 } = {}) {
    this.world = world;
    /** Called on every event the sensor hears (the walkthrough ends a skipped wait on it). */
    this.onEvent = null;
    this.every = every;
    this.windows = [];
    this.blastT = null;
    this.acts = new Map(); // unit → {id, t} (a key action under way)
    this.objDone = new Set((world?.objectives || []).filter((o) => o.done).map((o) => o.id));
    this._geoT = -Infinity;
    this._geo = { motion: 'idle', near: Infinity, cone: Infinity, turning: false, trapEta: Infinity };
    this._mot = { t: -Infinity, pos: new Map(), moving: new Set() };
    this._ang = new Map();
    this._offs = [];
  }

  attach() {
    const ev = this.world?.events;
    if (!ev?.on) return this;
    const T = () => this.world.time;
    const on = (n, fn) => { const off = ev.on(n, fn); if (typeof off === 'function') this._offs.push(off); };
    on('unit:killed', (p) => this.event(p?.unit?.kind === 'commando' ? 'commandoDown' : 'kill', T()));
    on('explosion', () => this.blast(T()));
    on('bomb:exploded', () => this.blast(T()));
    on('bomb:armed', () => this.event('armed', T()));
    on('alarm:start', () => this.event('alarm', T()));
    on('unit:captured', () => this.event('capture', T()));
    on('enemy:cuffed', () => this.event('capture', T()));
    on('enemy:state', (p) => {
      const to = String(p?.to || '');
      if (!this._nearMen(p?.enemy, 35)) return;
      if (ALERT_RE.test(to)) this.event('alert', T());
      else if (DISTRACT_RE.test(to)) this.event('distracted', T());
    });
    on('ability:start', (p) => { if (p?.unit?.kind === 'commando' && ACTION_RATE[p.id] != null) this.acts.set(p.unit, { id: p.id, t: T() }); });
    on('ability:end', (p) => { if (p?.unit) this.acts.delete(p.unit); });
    return this;
  }

  detach() {
    for (const off of this._offs) off();
    this._offs = [];
  }

  /** A post-event window (EVENT_WINDOWS kind) from game time t. */
  event(kind, t, dur = null) {
    const k = EVENT_WINDOWS[kind];
    if (!k) return;
    this.onEvent?.(kind);
    this.windows.push({ until: t + (dur ?? k[0]), rate: k[1], why: kind });
  }

  blast(t) {
    this.blastT = t;
    this.onEvent?.('blast');
  }

  /** The walkthrough's hooks: a checkpoint reached, a beat fired (hold: its seconds on screen). */
  checkpoint(t) { this.event('checkpoint', t); }
  beat(t, hold = 0) { this.event('beat', t, Math.max(EVENT_WINDOWS.beat[0], hold || 0)); }

  /** A player order: a ranged key action (a shot, a harpoon) fires at once — its moment is now. */
  order(u, o, t) {
    if (o?.type === 'ability' && ACTION_RATE[o.id] != null && u) this._ordered = { u, id: o.id, t };
  }

  /** A man at work: moving (over the last half second), walking up to an order, acting (not a long chat-up), at the oars or the wheel of a vehicle under way. */
  _busy(c) {
    return this._mot.moving.has(c) || !!c.pendingAbility || (!!c.currentAction && c.currentActionId !== 'distract') || underWay(c);
  }

  _nearMen(e, r) {
    if (!e) return false;
    for (const c of this.world.commandos || []) if (c.alive && Math.hypot(c.x - e.x, c.z - e.z) < r) return true;
    return false;
  }

  /**
   * Signals at game time t: {motion, action: {id, rate, eta}|null, fuse, blastAgo, trapEta, windows, near, cone, turning,
   * subject, object}. ctx (the walkthrough's step): {actors: the step's acting commandos, subjects: the guards it names,
   * objects: the things it names (interactables)}.
   * `wallMs` (performance.now()): the geometry is refreshed every `every` s of game time but no more often than every
   * GEO_WALL_MS of wall time (at 8× that is every third frame, not every one).
   */
  sample(t, ctx = {}, wallMs = null) {
    const w = this.world;
    this.windows = this.windows.filter((x) => x.rate * (1 + AUTO_PACE.tailLead * (t - x.until)) < AUTO_PACE.turboMax);
    if (t < this._geoT || (t - this._geoT >= this.every && (wallMs == null || !(wallMs - this._geoWall < GEO_WALL_MS)))) {
      this._geoWall = wallMs;
      const c0 = typeof performance !== 'undefined' ? performance.now() : 0;
      this._geometry(t);
      if (c0) this.cost = Math.max((this.cost ?? 0) * 0.98, performance.now() - c0); // (the slowest refresh lately, ms)
    }
    // the most urgent key action: one under way (its first ACTION_HOLD s), a ranged one just ordered, a walk-up to one
    let action = null;
    const consider = (id, eta) => {
      const rate = ACTION_RATE[id];
      if (rate == null) return;
      if (!action || rate * (1 + eta) < action.rate * (1 + action.eta)) action = { id, rate, eta };
    };
    for (const [u, a] of this.acts) {
      if (!u.alive || u.removed || u.currentActionId !== a.id) { this.acts.delete(u); continue; }
      if (t - a.t <= ACTION_HOLD) consider(a.id, 0);
    }
    const od = this._ordered;
    if (od && t - od.t <= 0.5 && !od.u.pendingAbility) consider(od.id, 0);
    for (const c of w.commandos || []) {
      const p = c.alive ? c.pendingAbility : null;
      const id = p?.def?.id;
      if (!p || ACTION_RATE[id] == null) continue;
      const tp = p.lastTp || p.click || (p.target && Number.isFinite(p.target.x) ? p.target : null) || p.selfTp;
      const d = tp ? Math.max(0, Math.hypot(tp.x - c.x, tp.z - c.z) - 1) : 0;
      const sp = p.crawlIn || c.stance === 'crawl' ? 0.9 : p.run ? 4.5 : 2.25;
      consider(id, d / sp + (c._stanceT > 0 ? c._stanceT : 0));
    }
    // charges: the nearest fuse (a time bomb's, a remote one set off)
    let fuse = Infinity;
    for (const b of w.interactables || []) if (b.interactKind === 'bomb' && !b.removed && !b.exploded && Number.isFinite(b.fuse) && b.fuse < fuse) fuse = b.fuse;
    // the step's man at work closing in on the guard the step is about (the harpoon from the water, the knife, the chat-up)
    let subject = Infinity;
    const subs = (ctx.subjects || []).filter((e) => e && e.alive !== false && !e.removed);
    if (subs.length) {
      for (const c of ctx.actors?.length ? ctx.actors : []) {
        if (!c?.alive || !this._busy(c)) continue;
        for (const e of subs) subject = Math.min(subject, Math.hypot(e.x - c.x, e.z - c.z));
      }
    }
    // the step's man beside the thing it names (ctx.objects: the clothesline, a switch, the bunker): his moment is next
    let object = Infinity;
    for (const o of ctx.objects || []) {
      if (!o || o.removed || !Number.isFinite(o.x)) continue;
      for (const c of ctx.actors || []) if (c?.alive) object = Math.min(object, Math.hypot(o.x - c.x, o.z - c.z));
    }
    const g = this._geo;
    return {
      t, motion: g.motion, action, fuse, blastAgo: this.blastT == null ? null : t - this.blastT, trapEta: g.trapEta,
      windows: this.windows.map((x) => ({ rate: x.rate, why: x.why, left: x.until - t })), near: g.near, cone: g.cone, turning: g.turning, subject, object,
    };
  }

  _geometry(t) {
    const w = this.world, g = this._geo;
    const dtg = Math.max(1e-6, t - this._geoT);
    this._geoT = t;
    // who moves (the films' sense(): how the men actually moved over the last half second): walk / crawl / idle
    const m = this._mot;
    if (t - m.t >= 0.5 || t < m.t) {
      let walk = false, crawl = false;
      const span = t - m.t;
      m.moving = new Set();
      for (const c of w.commandos || []) {
        if (!c.alive) continue;
        const p = c.vehicle && !c.vehicle.removed ? c.vehicle : c, q = m.pos.get(c);
        // (a vehicle under way counts the whole time it goes somewhere: a raft turning on the spot at a waypoint of its
        // crossing too — M2, ~1 s still between legs, read as nobody moving and skipped as a wait, the whole crossing)
        if ((q && span < 5 && Math.hypot(p.x - q.x, p.z - q.z) > 0.12 * span) || underWay(c)) {
          m.moving.add(c);
          if (!c.vehicle && c.stance === 'crawl') crawl = true; else walk = true;
        }
        m.pos.set(c, { x: p.x, z: p.z });
      }
      m.t = t;
      g.motion = walk ? 'walk' : crawl ? 'crawl' : 'idle';
    }
    const guards = (w.enemies || []).filter((e) => e.alive && !e.removed && !e.incapacitated && e.state !== 'inVehicle');
    const men = (w.commandos || []).filter((c) => c.alive && !c.removed);
    // the men at work: moving (over the last half second), walking up to an order, acting (not a long chat-up), rising
    // from the snow; a man lying still waiting for his moment is dead time (the films ran those waits at 8–16×)
    const busy = (c) => this._busy(c);
    // striking distance: a man at work (not the Spy in uniform: she talks to them) beside a guard who does not know
    let near = Infinity;
    for (const c of men) {
      if (c.disguised || !busy(c)) continue;
      for (const e of guards) {
        if (e.brain?.isAware?.()) continue;
        const d = Math.hypot(e.x - c.x, e.z - c.z);
        if (d < near) near = d;
      }
    }
    g.near = near;
    // a near miss: a guard who would see a man at work if his cone reached 3 m further (the AI's own rule — bands,
    // stance, uniform, snow, water, roofs, line of sight — tried on the cone grown that much) and whether the cone is
    // turning to him; a man lying still counts only when a cone turns to within 1.5 m of him
    let cone = Infinity, turning = false;
    const ang = new Map();
    for (const e of guards) {
      if (!e.vision) continue;
      const reach = (e.vision.far ?? 36) + NEAR_MISS + 1;
      let k;
      for (const c of men) {
        if (c.disguised) continue;
        const dx = c.x - e.x, dz = c.z - e.z;
        if (dx * dx + dz * dz > reach * reach) continue;
        if (k === undefined) k = coneAt(e, t);
        if (!k) break;
        const d = Math.hypot(c.x - k.x, c.z - k.z);
        let a = Math.atan2(c.z - k.z, c.x - k.x) - k.heading;
        a -= Math.PI * 2 * Math.round(a / (Math.PI * 2));
        const off = Math.abs(a) - k.halfFov; // > 0: outside the aperture
        const key = `${e.id ?? e.tag}|${c.id ?? c.role}`;
        const prev = this._ang.get(key);
        ang.set(key, off);
        const closing = prev != null && off > -0.02 && off < prev - 0.004 * Math.min(1, dtg / 0.2);
        const moving = busy(c);
        if (!moving && !closing) continue;
        // how far the band he would be seen in (the near band only for a low man) is from him, then the AI's own
        // rule once, on the cone grown by that much: bands, roof and deck edges, line of sight
        const cls = targetClass(c, {}, e);
        if (!cls) continue;
        const R = cls === 'near' ? k.near : k.far;
        const margin = Math.hypot(Math.max(0, d - R), off > 0 ? d * Math.sin(Math.min(off, Math.PI / 2)) : 0);
        const lim = moving ? NEAR_MISS : NEAR_MISS / 2;
        if (margin > lim || margin > cone || (margin === cone && !closing)) continue; // (only a closer call needs the check)
        if (canSee(e, c, w, { cone: grown(k, lim, d) }) === 'none') continue;
        cone = margin;
        turning = closing;
      }
    }
    this._ang = ang;
    g.cone = cone;
    g.turning = turning;
    g.trapEta = trapEta(w, guards);
  }
}

/**
 * Seconds until a guard walks onto a set bear trap (Infinity: none coming): one within 10 m heading roughly its way, or
 * (TRAP_LOOK) farther off heading straight for it (passing within TRAP_MISS m) — a skipped wait's time-lapse is brought
 * down from there, in a few seconds of wall time, to 1× at the snap (M2: the trap used to go off inside a 50× skip).
 * `guards`: the living, free guards (default: all of the world's).
 */
export function trapEta(w, guards = null) {
  let eta = Infinity;
  for (const tr of w?.interactables || []) {
    if (tr.interactKind !== 'trap' || tr.sprung || tr.removed) continue;
    for (const e of guards || w.enemies || []) {
      if (!guards && (!e.alive || e.removed || e.incapacitated || e.state === 'inVehicle')) continue;
      const d = Math.hypot(e.x - tr.x, e.z - tr.z);
      if (d > TRAP_LOOK || !e.isMoving) continue;
      const h = Math.atan2(tr.z - e.z, tr.x - e.x) - e.heading, c = Math.cos(h);
      // (a guard following footprints near a trap goes where they lead — the trail laid over it: M2's e1 and e3 turn
      // through the palisade's gap onto it only metres before it)
      const tracking = e.brain?.state === 'TRACKS' && d <= TRAP_TRACKS;
      if (!tracking && (d > 10 ? c < 0.5 || d * Math.abs(Math.sin(h)) > TRAP_MISS : c < 0.7)) continue;
      const sp = Number.isFinite(e.speed) && e.speed > 0.3 ? e.speed : 1.5;
      eta = Math.min(eta, d / sp);
    }
  }
  return eta;
}
