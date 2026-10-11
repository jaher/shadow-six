/**
 * Debug SOLUTION replay: plays a mission's saved solution (debug/solutions.js → tools/solutions/<id>.solution.mjs)
 * live, in the real game loop, issuing the same player orders the regression test's driver issues.
 *
 * The replay owns the simulation clock while it runs: Game.manualTick is set (the game's own accumulator stops) and a
 * frame hook grants the driver `dt × speed / simDt` ticks per displayed frame (TickPacer); the driver's `step` runs a
 * granted tick at once or waits for the next frame. Speeds 1× / 2× / 4× / 8×, pause, and skip-to-stage (the mission is
 * reloaded and fast-forwarded — as fast as ~90 ms of ticks per frame allows — to the start of that stage, then plays
 * on at the chosen speed). The camera follows the commando the last order went to (his vehicle while he rides),
 * captions show the stage, the latest checkpoint and the latest order. Player orders (game.enqueue) are dropped while
 * it runs; Esc (or STOP) stops it and gives the game back to the player where it stands.
 *
 * While CAM follow is on, the camera is VIDEO MODE's (debug/walkthrough-director.js): a Director fed by this
 * replay's own composeShot() frames the acting commando with the mission's `pitchAt` tilt and a yaw swung away
 * from whatever building would hide the men — the plain follow track runs only until the director attaches
 * (the walkthrough data loads async); on stop, Director.detach hands the player's own pitch / yaw back.
 * @module debug/solution-replay
 */

import { ROLE_NAMES } from '../ui/catalogue.js';
import { CONFIG } from '../config.js';
import { loadWalkthrough } from './solutions.js';
import { normalizeWalkthrough } from './walkthrough-data.js';
import { Director, freeRect } from './walkthrough-director.js';

export const SPEEDS = Object.freeze([1, 2, 4, 8]);
/** Wall-clock ms of ticks per frame while fast-forwarding to a stage (the view still updates ~8 times a second). */
export const TURBO_MS = 90;

/**
 * Sim tick budget per displayed frame. Pure (no DOM / game): tests/unit/solution-replay.test.mjs.
 */
export class TickPacer {
  /**
   * @param {{simDt?: number, maxPerFrame?: number, speed?: number, speeds?: number[], turboMs?: number}} o
   *   speeds: the speeds setSpeed accepts; turboMs: wall-clock ms of ticks per frame while fast-forwarding
   */
  constructor({ simDt = 1 / 60, maxPerFrame = 8, speed = 1, speeds = SPEEDS, turboMs = TURBO_MS } = {}) {
    this.simDt = simDt;
    this.maxPerFrame = maxPerFrame;
    this.speeds = speeds;
    this.speed = speeds.includes(+speed) ? +speed : speeds.includes(1) ? 1 : speeds[0];
    this.turboMs = turboMs;
    /** Extra multiplier on top of the speed (the walkthrough's "skip waits"); 1 = none. */
    this.boost = 1;
    this.paused = false;
    this.turbo = false;
    this.budget = 0;
    this.deadline = 0;
  }

  /** A displayed frame of `dt` real seconds at wall time `now` (ms). */
  frame(dt, now) {
    if (this.paused) { this.budget = 0; return; }
    if (this.turbo) { this.deadline = now + this.turboMs; return; }
    const d = Math.max(0, Math.min(dt, CONFIG.render?.maxDelta ?? 0.25));
    const k = this.speed * this.boost;
    this.budget = Math.min(this.budget + (d * k) / this.simDt, this.maxPerFrame * Math.max(1, k));
  }

  /** May a tick run now? */
  canTick(now) {
    if (this.paused) return false;
    return this.turbo ? now < this.deadline : this.budget >= 1;
  }

  /** One granted tick used. */
  take() {
    if (!this.turbo) this.budget = Math.max(0, this.budget - 1);
  }

  setSpeed(s) {
    if (this.speeds.includes(+s)) this.speed = +s;
  }

  /** Sim seconds per real second right now (fast-forward: an estimate). */
  get rate() {
    return this.turbo ? 8 : this.speed * this.boost;
  }

  setTurbo(on) {
    this.turbo = !!on;
    this.budget = 0;
    this.deadline = 0;
  }
}

/** Caption text of a player order (`unit` the commando, `o` the order as the driver issued it). */
export function describeOrder(unit, o) {
  const who = ROLE_NAMES[unit?.role] || unit?.tag || unit?.role || 'Commando';
  if (!o) return who;
  if (o.type === 'move') return `${who}: ${o.run ? 'run' : unit?.stance === 'crawl' ? 'crawl' : 'move'} to ${(+o.x).toFixed(0)}, ${(+o.z).toFixed(0)}`;
  if (o.type === 'stance') return `${who}: ${o.stance === 'crawl' ? 'down on the belly' : o.stance === 'stand' ? 'stand up' : o.stance}`;
  if (o.type === 'stop') return `${who}: stop`;
  if (o.type === 'ability') {
    const words = String(o.id || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const t = o.target && o.target !== unit ? (o.target.tag || o.target.spawn?.id || o.target.vehicleType || o.target.role || null) : null;
    return `${who}: ${words}${t ? ` → ${t}` : ''}`;
  }
  return `${who}: ${o.type}`;
}

const CSS = `
#dbg-sol-bar{position:fixed;left:50%;transform:translateX(-50%);top:calc(56px + env(safe-area-inset-top));z-index:8500;
  display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:6px;
  background:rgba(8,10,12,.78);border:1px solid #ffcf4a66;border-radius:8px;font:600 12px/1 system-ui,sans-serif;color:#e8e2d0}
#dbg-sol-bar button{all:unset;box-sizing:border-box;min-width:44px;min-height:44px;padding:0 10px;display:inline-flex;align-items:center;
  justify-content:center;border-radius:6px;background:#2b3035;cursor:pointer;touch-action:manipulation;border:2px solid transparent;letter-spacing:.06em}
#dbg-sol-bar button:hover,#dbg-sol-bar button:focus-visible{border-color:#ffcf4a}
#dbg-sol-bar button[aria-pressed=true]{background:#5b4a14;color:#ffdf7a}
#dbg-sol-bar .sol-tag{align-self:center;padding:0 6px;color:#ffcf4a;letter-spacing:.12em}
#dbg-sol-bar [data-act=stop]{background:#5a1f1a}
#dbg-sol-steps{position:fixed;left:50%;transform:translateX(-50%);top:calc(116px + env(safe-area-inset-top));z-index:8600;
  width:min(440px,calc(100vw - 16px));max-height:calc(100vh - 136px - env(safe-area-inset-top));overflow:auto;box-sizing:border-box;padding:6px;background:rgba(8,10,12,.92);
  border:1px solid #ffcf4a88;border-radius:8px;font:13px/1.25 system-ui,sans-serif;color:#e8e2d0}
#dbg-sol-steps button{all:unset;box-sizing:border-box;display:block;width:100%;min-height:44px;padding:8px 10px;border-radius:5px;cursor:pointer;
  touch-action:manipulation}
#dbg-sol-steps button:hover,#dbg-sol-steps button:focus-visible{background:#3a4046}
#dbg-sol-steps button.done{opacity:.55}
#dbg-sol-steps button.now{box-shadow:inset 3px 0 0 #ffcf4a}
#dbg-sol-steps b{color:#ffcf4a;margin-right:8px}
#dbg-sol-cap{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:8400;
  width:max-content;max-width:calc(100vw - 24px);box-sizing:border-box;padding:8px 14px;text-align:center;pointer-events:none;
  background:rgba(0,0,0,.66);border-radius:6px;color:#fff;font:600 16px/1.3 system-ui,sans-serif;text-shadow:0 1px 2px #000}
#dbg-sol-cap small{display:block;font:500 13px/1.35 system-ui,sans-serif;color:#ffe9a8;opacity:.95}
#dbg-sol-cap .sol-ff{color:#7fd6ff}
`;

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export class SolutionReplay {
  /**
   * @param {object} game the Game (mission already loaded fresh and playing)
   * @param {object} sol loadSolution() result
   * @param {{speed?: number, toStage?: string|null, isFrozen?: () => boolean, onEnd?: (r: object) => void,
   *   onSkip?: (stageId: string) => void}} o  isFrozen: the debug select is open (no ticks); onSkip: reload + fast-forward
   */
  constructor(game, sol, { speed = 1, toStage = null, toMarker = null, speeds = SPEEDS, turboMs = TURBO_MS, isFrozen = () => false, onEnd = null, onSkip = null, manualTickAfter = null } = {}) {
    this.game = game;
    this.sol = sol;
    this.world = game.world;
    this.simDt = CONFIG.sim.dt;
    this.pacer = new TickPacer({ simDt: this.simDt, maxPerFrame: CONFIG.sim.maxStepsPerFrame, speed, speeds, turboMs });
    this.isFrozen = isFrozen;
    this.onEnd = onEnd;
    this.onSkip = onSkip;
    /** Game.manualTick to restore at the end (the launcher may hold the clock from the load on: tick 0 is the solution's). */
    this.manualTickAfter = manualTickAfter;
    /** Fast-forward target: {kind: 'stage'|'cp', id} — the replay plays on normally right after that marker. */
    this.toMarker = toMarker || (toStage ? { kind: 'stage', id: toStage } : null);
    this.stopped = false;
    this.finished = null;
    this.stage = null; // {id, title}
    this.stageIndex = -1;
    this.lastCheckpoint = null;
    this.lastOrder = '';
    this.follow = true;
    this.focus = null;
    /** The mission's walkthrough data (normalizeWalkthrough), once _smartCam loads it: its pitchAt tilts the camera. */
    this.wt = null;
    /** The smart camera (a Director, as in VIDEO MODE) once attached; `_smart` marks it as this class's own. */
    this.director = null;
    this._smart = false;
    /** The last ability order's target ({u, t, until}), a subject of the shot while the action runs. */
    this._action = null;
    this._dt = 0;
    this._safe = null;
    this._safeAt = 0;
    this._waiter = null;
    this.ticks = 0;
    this.dropped = 0;
  }

  get speed() { return this.pacer.speed; }
  /** (the stage a fast-forward runs to, or null) */
  get toStage() { return this.toMarker?.kind === 'stage' ? this.toMarker.id : null; }
  /** Paused = the game's own pause (P / the bar's ❚❚): the pause card shows and no tick runs. */
  get paused() { return this.game.state === 'paused'; }
  get fastForward() { return this.pacer.turbo; }
  get stepsOpen() { return !!this._steps; }

  /** Take the clock, build the UI, play. Resolves when the solution ends (won / failed / stopped). */
  start() {
    const g = this.game;
    this._saved = { manualTick: this.manualTickAfter ?? g.manualTick, frame: Object.prototype.hasOwnProperty.call(g, 'frame') ? g.frame : undefined,
      enqueue: Object.prototype.hasOwnProperty.call(g, 'enqueue') ? g.enqueue : undefined };
    const frame = (this._saved.frame || Object.getPrototypeOf(g).frame);
    g.manualTick = true;
    g.accumulator = 0;
    g.frame = (dt) => {
      this._frame(dt);
      // animation time follows the sim speed (legs keep pace with the ground covered at 8×)
      return frame.call(g, dt * this._animScale());
    };
    g.enqueue = () => { this.dropped++; this._flash = performance.now() + 2500; }; // the replay plays: player orders wait
    if (this.toMarker) this.pacer.setTurbo(true);
    this._buildUi();
    const D = this.sol.makeDriver(this.world, {
      step: () => this._step(), dt: this.simDt, quiet: true, log: () => {},
      aborted: () => this.stopped,
      onOrder: (role, u, o) => this._onOrder(role, u, o),
      onCheckpoint: (cp) => this._onCheckpoint(cp),
    });
    this.driver = D;
    this.done = this._run(D);
    this._smartCam();
    return this.done;
  }

  /**
   * Load the mission's walkthrough data and hand the camera to a Director fed by this replay's composeShot().
   * Async: the plain follow track runs until it attaches. VIDEO MODE (the Walkthrough subclass) brings its own
   * director and is skipped — its camera behaviour is unchanged.
   */
  async _smartCam() {
    if (this.isWalkthrough || this.director) return;
    let wtFile = null;
    try { wtFile = await loadWalkthrough(this.sol.id); } catch { wtFile = null; }
    if (this.stopped || this._released || this.director) return;
    this.wt = normalizeWalkthrough(wtFile, { id: this.sol.id, stages: this.sol.stages, missionTitle: this.game.missionDef?.title });
    const d = new Director(this);
    d.on = this.follow;
    this.director = d;
    this._smart = true;
    d.attach();
  }

  async _run(D) {
    let outcome = 'done', error = null;
    try {
      await this.sol.solve(D, { ...this.sol.ctx, onStage: (id, title) => this._onStage(id, title) });
      // let the game's own end check run (the win screen), as the regression test does
      for (let i = 0; i < 600 && this.game.state === 'playing' && !this.stopped; i++) await D.wait(this.simDt);
    } catch (e) {
      if (this.game.state === 'won' || this.game.state === 'lost') outcome = 'done'; // the game ended it
      else if (e instanceof this.sol.SolutionAborted || this.stopped) outcome = 'stopped';
      else { outcome = 'error'; error = String(e?.message || e); console.warn('[debug] solution replay failed:', error); }
    }
    this.finished = { outcome, error, state: this.game.state, time: this.world.time, detections: D.detections(), checkpoints: D.checkpoints.map((c) => c.name),
      marks: D.checkpoints.map((c) => ({ name: c.name, t: c.t })), exposures: D.exposures?.().length ?? null };
    this._release();
    this.onEnd?.(this.finished);
    return this.finished;
  }

  /** Animation time per real second of the displayed frame (the sim's pace). */
  _animScale() {
    return this.pacer.turbo ? 8 : this.pacer.speed;
  }

  _onOrder(role, u, o) {
    this.focus = u;
    this.lastOrder = describeOrder(u, o);
    const tgt = o?.type === 'ability' && o.target && o.target !== u && typeof o.target === 'object' ? o.target : null;
    if (tgt && (Number.isFinite(tgt.x) || tgt.kind)) this._action = { u, t: tgt, until: this.world.time + 6 };
  }

  _onCheckpoint(cp) {
    this.lastCheckpoint = { name: cp.name, t: cp.t };
    this._reached('cp', String(cp.name).trim().split(/\s+/)[0]);
  }

  _onStage(id, title) {
    this.stageIndex = this.sol.stages.findIndex((s) => s.id === id);
    this.stage = { id, title };
    this._reached('stage', id);
    this._syncBar();
    this._renderSteps();
  }

  /** A marker was passed: the end of a fast-forward to it. */
  _reached(kind, id) {
    const m = this.toMarker;
    if (m && m.kind === kind && m.id === id) { this.toMarker = null; this.pacer.setTurbo(false); this._fastForwardDone?.(kind, id); }
  }

  /** The driver's tick: run it now when the frame budget allows, else on a later frame. */
  _step() {
    if (this.stopped) throw new this.sol.SolutionAborted();
    if (this._ready()) { this._tick(); return undefined; }
    return new Promise((res, rej) => { this._waiter = { res, rej }; }).then(() => this._tick());
  }

  _ready() {
    return this.game.state === 'playing' && this.game.world === this.world && !this.isFrozen() && this.pacer.canTick(performance.now());
  }

  _tick() {
    if (this.stopped) throw new this.sol.SolutionAborted();
    this.pacer.take();
    this.game.step(this.simDt);
    this.ticks++;
  }

  /** Per displayed frame (before the game's own frame): grant ticks, wake the driver, camera, captions. */
  _frame(dt) {
    const g = this.game;
    if (this.stopped) return;
    if (g.world !== this.world) { this.stop(); return; } // another mission was launched / quit to the title
    if (g.state === 'won' || g.state === 'lost') {
      // the game is over: wake the driver so its end loop sees it
    } else if (g.state === 'playing' && !this.isFrozen()) this.pacer.frame(dt, performance.now());
    const w = this._waiter;
    if (w && (this._ready() || g.state === 'won' || g.state === 'lost')) {
      this._waiter = null;
      if (g.state === 'won' || g.state === 'lost') w.rej(new this.sol.SolutionAborted());
      else w.res();
    }
    this._dt = dt;
    this._camera();
    if (this._wasPaused !== this.paused) { this._wasPaused = this.paused; this._syncBar(); } // P pauses too
    this._caption();
  }

  _camera() {
    // the smart camera owns the view while it is attached (its Director restores the player's camera at the end)
    if (this._smart && this.director) { if (this.follow) this.director.update(this._dt); return; }
    const cc = this.game.cameraController;
    if (!cc || !this.follow || !this.focus) return;
    const t = this.focus.vehicle && !this.focus.vehicle.removed ? this.focus.vehicle : this.focus;
    if (t.removed) return;
    if (this._tracked !== t) {
      this._tracked = t;
      cc.untrack?.();
      cc.recenterOn?.(t.x, t.z, 0.45);
      this._trackPending = t;
    } else if (this._trackPending && !cc.tweening) {
      cc.track?.(this._trackPending);
      this._trackPending = null;
    } else if (!this._trackPending && cc.tracking !== t) cc.track?.(t);
  }

  // ------------------------------------------------------------ what the smart camera frames

  /** A camera point for a unit (his vehicle while he rides), `unseen` when hidden by design — as the walkthrough's resolve(). */
  _pointOf(u) {
    const w = this.world;
    const e = u?.vehicle && !u.vehicle.removed ? u.vehicle : u;
    if (!e || e.removed) return null;
    const p = { x: e.x, z: e.z, y: e.y ?? (w.grid?.elevAt?.(e.x, e.z) ?? 0) };
    if (u.insideStructure || u.buried || u.underwater || u.diving || u.object3d?.visible === false) p.unseen = true;
    return p;
  }

  /** The acting commandos' points: the last ordered man, plus the men near him (the walkthrough's _actors shape). */
  _actors() {
    const w = this.world;
    let lead = this.focus && !this.focus.removed && this.focus.alive !== false ? this.focus : null;
    if (!lead) lead = w.commandos.find((c) => c.alive) || (this.focus && !this.focus.removed ? this.focus : null);
    if (!lead) return [];
    const lp = this._pointOf(lead);
    if (!lp) return [];
    const out = [lp];
    for (const c of w.commandos) {
      if (c === lead || !c.alive) continue;
      const q = this._pointOf(c);
      if (q && Math.hypot(q.x - lp.x, q.z - lp.z) < 26) out.push(q);
    }
    return out;
  }

  /** The walkthrough's pitchAt at the points' centroid (degrees), or null (keep the player's own pitch). */
  _pitch(pts) {
    const f = this.wt?.pitchAt;
    if (!f || !pts.length) return null;
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const v = +f(x, z);
    return Number.isFinite(v) ? v : null;
  }

  /** What the smart camera should show now: the acting commando, the men near him, and his order's target. */
  composeShot() {
    const w = this.world, now = w.time;
    if (this.pacer.turbo) {
      const a = this._actors();
      return a.length ? { pts: a, must: a.length, cut: true, frame: { minSpan: [26, 16] }, pitch: this._pitch(a) } : null;
    }
    const actors = this._actors();
    const pts = [...actors];
    const a0 = actors[0];
    const act = this._action;
    if (act && now <= act.until && !act.u.removed) {
      const busy = act.u.currentAction || act.u.pendingAbility || now < act.until - 4;
      const p = busy && act.t && Number.isFinite(act.t.x) ? { x: act.t.x, z: act.t.z, y: act.t.y ?? 0 } : null;
      if (p && (!a0 || Math.hypot(p.x - a0.x, p.z - a0.z) < 40)) pts.push(p);
    }
    if (!pts.length) return null;
    return { pts, must: Math.max(1, actors.length), frame: { minSpan: [16, 10] }, pitch: this._pitch(actors.length ? actors : pts) };
  }

  /** The free part of the view (view px) for the director: below the replay bar, above its caption. */
  safeRect() {
    const now = performance.now();
    if (this._safe && now - this._safeAt < 300) return this._safe;
    this._safeAt = now;
    const cc = this.game.cameraController;
    const canvas = this.game.renderer?.domElement?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const W = cc?.width || innerWidth, H = cc?.height || innerHeight;
    const ox = canvas.left + (cc?.rect?.x || 0), oy = canvas.top + (cc?.rect?.y || 0);
    const rectOf = (e) => { const r = e?.getBoundingClientRect?.(); return r && (r.width || r.height) ? r : null; };
    let top = Math.max(0, this.game.cameraRig?.hudTop?.() || 0);
    const bar = rectOf(this._ui);
    if (bar) top = Math.max(top, bar.bottom - oy);
    let bottom = 0;
    const cap = rectOf(this._cap);
    if (cap) bottom = Math.max(bottom, H - (cap.top - oy));
    const r = freeRect({ width: W, height: H, top: top + 6, bottom: bottom + 6, left: 6, right: 6 });
    this._safe = r;
    return r;
  }

  setFollow(on) {
    this.follow = !!on;
    this._tracked = null;
    this._trackPending = null;
    if (this._smart && this.director) this.director.setOn(this.follow); // follow off: no smart framing (free camera)
    if (!this.follow) this.game.cameraController?.untrack?.();
    this._syncBar();
  }

  setSpeed(s) {
    this.pacer.setSpeed(s);
    this._syncBar();
  }

  togglePause() {
    const g = this.game;
    if (g.state === 'playing' || g.state === 'paused') g.togglePause();
    this.pacer.budget = 0;
    this._syncBar();
  }

  /** Jump to stage `id`: ahead of the current one → fast-forward; else reload the mission and fast-forward (onSkip). */
  skipTo(id) {
    const i = this.sol.stages.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this._showSteps(false);
    if (i > this.stageIndex) {
      this.toMarker = { kind: 'stage', id };
      this.pacer.setTurbo(true);
      this._syncBar();
      return true;
    }
    this.onSkip?.(id);
    return true;
  }

  /** Stop playing: no tick or order of the solution runs after this; the player has the game where it stands. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const w = this._waiter;
    this._waiter = null;
    w?.rej(new this.sol.SolutionAborted());
    this._release();
  }

  _release() {
    if (this._released) return;
    this._released = true;
    this.stopped = true;
    const g = this.game, s = this._saved;
    if (s) {
      g.manualTick = s.manualTick;
      if (s.frame) g.frame = s.frame; else delete g.frame;
      if (s.enqueue) g.enqueue = s.enqueue; else delete g.enqueue;
      g.accumulator = 0;
    }
    if (this._smart && this.director) { this.director.detach(); this.director = null; } // the player's pitch / yaw / bounds back
    if (this._trackPending || this._tracked) g.cameraController?.untrack?.();
    this._ui?.remove();
    this._steps?.remove();
    this._cap?.remove();
    this._ui = this._steps = this._cap = null;
  }

  // ------------------------------------------------------------ UI

  _buildUi() {
    if (!document.getElementById('dbg-sol-style')) { const st = el('style', null, document.head, CSS); st.id = 'dbg-sol-style'; }
    const bar = el('div', null, document.body);
    bar.id = 'dbg-sol-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Solution replay');
    bar.dataset.mission = this.sol.id;
    el('span', 'sol-tag', bar, `SOLUTION ${this.sol.id.toUpperCase()}`);
    const btn = (act, label, title, fn) => {
      const b = el('button', null, bar, label);
      b.type = 'button';
      b.dataset.act = act;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    btn('stop', '■ STOP', 'Stop the replay and take control (Esc)', () => this.stop());
    btn('pause', '❚❚', 'Pause / play the replay', () => this.togglePause());
    for (const s of SPEEDS) btn(`speed-${s}`, `${s}×`, `Replay at ${s}× speed`, () => this.setSpeed(s));
    btn('steps', 'STEPS ▾', 'Skip to a step of the solution', () => this._showSteps(!this._steps));
    btn('follow', 'CAM', 'Camera follows the acting commando', () => this.setFollow(!this.follow));
    for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) bar.addEventListener(ev, (e) => e.stopPropagation());
    this._ui = bar;
    const cap = el('div', null, document.body);
    cap.id = 'dbg-sol-cap';
    cap.setAttribute('aria-live', 'polite');
    this._cap = cap;
    this._syncBar();
  }

  _syncBar() {
    const bar = this._ui;
    if (!bar) return;
    for (const s of SPEEDS) bar.querySelector(`[data-act="speed-${s}"]`)?.setAttribute('aria-pressed', String(!this.pacer.turbo && this.pacer.speed === s));
    const p = bar.querySelector('[data-act=pause]');
    if (p) { p.textContent = this.paused ? '▶' : '❚❚'; p.setAttribute('aria-pressed', String(this.paused)); }
    bar.querySelector('[data-act=follow]')?.setAttribute('aria-pressed', String(this.follow));
    bar.dataset.speed = String(this.pacer.speed);
    bar.dataset.paused = this.paused ? '1' : '0';
    bar.dataset.ff = this.pacer.turbo ? '1' : '0';
  }

  _showSteps(on) {
    if (this._cap) this._cap.hidden = !!on; // the menu may reach down to the caption
    if (!on) { this._steps?.remove(); this._steps = null; return; }
    if (this._steps) return;
    const box = el('div', null, document.body);
    box.id = 'dbg-sol-steps';
    box.setAttribute('role', 'menu');
    for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) box.addEventListener(ev, (e) => e.stopPropagation());
    this._steps = box;
    this._renderSteps();
    box.querySelector('button')?.focus();
  }

  _renderSteps() {
    const box = this._steps;
    if (!box) return;
    box.textContent = '';
    this.sol.stages.forEach((s, i) => {
      const b = el('button', i < this.stageIndex ? 'done' : i === this.stageIndex ? 'now' : '', box);
      b.type = 'button';
      b.dataset.stage = s.id;
      b.setAttribute('role', 'menuitem');
      el('b', null, b, s.id);
      b.append(s.title);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.skipTo(s.id); });
    });
  }

  _caption() {
    const cap = this._cap;
    if (!cap) return;
    const now = performance.now();
    if (this._capAt && now - this._capAt < 120) return;
    this._capAt = now;
    const st = this.stage;
    const head = st ? `Step ${st.id} · ${st.title}` : 'Solution replay';
    let sub;
    if (this.pacer.turbo) sub = `⏩ fast-forward to step ${this.toMarker?.id ?? ''}…`;
    else if (this._flash && now < this._flash) sub = 'The replay is playing — Esc / STOP to take control';
    else if (this.lastCheckpoint && this.world.time - this.lastCheckpoint.t < 6) sub = `✔ ${this.lastCheckpoint.name}`;
    else sub = this.lastOrder || '';
    if (this.paused) sub = `❚❚ paused${sub ? ' · ' + sub : ''}`;
    const key = head + '|' + sub;
    if (key === this._capKey) return;
    this._capKey = key;
    cap.textContent = head;
    const s = el('small', this.pacer.turbo ? 'sol-ff' : null, cap, sub);
    s.dataset.sub = '1';
    cap.dataset.stage = st?.id || '';
  }
}
