/**
 * Debug VIDEO MODE ("Watch walkthrough"): a mission's saved solution played live in the real game as a guided film.
 * The engine is the SOLUTION replay's (debug/solution-replay.js: the same driver, the same player orders, the clock
 * granted tick by tick); on top of it:
 *  - a camera director (debug/walkthrough-director.js) that frames the acting commando with what matters to the step
 *    — his target, the guard he slips past and that guard's cone, the objective, the charge about to blow — in the
 *    part of the screen the walkthrough's UI and the HUD leave free;
 *  - narration from tools/solutions/<id>.walkthrough.mjs (docs/walkthrough-format.md): a chapter card at each stage,
 *    a caption per step saying who does what and why, finer beats on live events;
 *  - controls: play / pause, 0.5× / 1× / 2× / 4× and AUTO (the default: the films' pacing worked out live,
 *    debug/auto-pace.js — fast through walks and waits, eased down to 1× for the moments that matter, ½× for blasts
 *    and the escape), skip waits (fixed speeds: idle stretches run up to 4× faster), previous / next step and a chapter
 *    list (forward = fast-forward from here; back = the mission reloaded and fast-forwarded, the run being
 *    deterministic), captions on / off, free camera (the director lets go until it is switched back on), exit to the
 *    debug menu. A timeline under the bar scrubs the run: drag it (or step with ← / →, a second at a time, ten
 *    with Shift) to any moment — ahead fast-forwards from here, behind reloads and fast-forwards, as a chapter
 *    jump back does; its length and its chapter / checkpoint marks are the run's own measured times (a point's
 *    time lands as the run passes it), kept in localStorage between viewings. Paused stays paused on arrival.
 *    Desktop keys: Space, B / N, 1–4, 5 / A (AUTO), W, C, F, L, Esc.
 * An action is watched until it has visibly finished (debug/action-hold.js: the clothesline take, a knife, a charge…,
 * plus a beat): the camera stays on the man (an authored `shot` cue still wins), the caption on his step, the next
 * chapter's card waits for it, and AUTO plays it at 1×. Every order selects the man it goes to, as a portrait click
 * would: his portrait, knapsack, stance hand and ring (debug/solution-replay.js _selectActor).
 * Nothing here touches the simulation: the camera, the drawn cones, the captions and the pacing of wall time only.
 * @module debug/walkthrough
 */

import { SolutionReplay } from './solution-replay.js';
import { normalizeWalkthrough, currentStep, orderAction, targetTag, matchOn, cpId } from './walkthrough-data.js';
import { Director, freeRect, isActing, pickLive } from './walkthrough-director.js';
import { ROLE_NAMES } from '../ui/catalogue.js';
import { PERF } from '../engine/perf-flags.js';
import { AutoPace, PaceSensor, PerfCeiling, SteadyGrant, paceTarget, readTime, inClimax, isTrueWait } from './auto-pace.js';

export const WALK_SPEEDS = Object.freeze([0.5, 1, 2, 4]);
/** The speed of a fresh walkthrough (no `speed` in its link): AUTO. `speed=1` is a fixed 1×. */
export const DEFAULT_WALK_SPEED = 'auto';
/**
 * Wall-clock ms of ticks per frame while jumping (fast-forward), counted from the frame's start (a frame that draws
 * the view runs fewer): a jump keeps the screen alive — the clock and the progress bar move every frame, the view is
 * redrawn every WALK_TURBO_VIEW_MS — instead of freezing it in 0.2 s blocks.
 */
export const WALK_TURBO_MS = 14;
/** While jumping, the view is redrawn at most this often (ms; never more than 15 % of the wall time: TURBO_VIEW_SHARE). */
export const WALK_TURBO_VIEW_MS = 200;
/**
 * AUTO: a true wait (the solution waits for a guard, a gap, a timer; nobody acts) is skipped like a jump after this
 * many seconds of game time: its ticks run by wall time (WALK_TURBO_MS a frame, the view redrawn every
 * WALK_TURBO_VIEW_MS) under a "⏩ waiting: <what for>" tag, then a cut back to the play (user 2026-10-15: "Also no long
 * quiet periods, always action in the walkthrough").
 */
export const SKIP_AFTER = 0.3;
/** Wall-clock ms of ticks a frame while a wait is skipped (counted from the frame's start: a frame that draws runs fewer). */
export const SKIP_TICK_MS = 16;
/**
 * While a wait is skipped the view is redrawn every SKIP_VIEW_MS (≈15 a second; never more than TURBO_VIEW_SHARE of the
 * wall time): a fast-forward that keeps moving on screen, never a frozen picture, and no frame over ~20 ms.
 */
export const SKIP_VIEW_MS = 66;
/**
 * AUTO: a plan the solution searches for longer than this (wall ms; its sliced search, driver.mjs PLAN_SLICE_MS a frame:
 * the clock stands still meanwhile and nobody moves) is skipped like a wait — the search gets the skip's frame budget
 * (SKIP_TICK_MS, the view redrawn every SKIP_VIEW_MS) under a "⏩ waiting" tag instead of ~6 ms of every frame (M15's
 * crawls to the north-west road: ~35 s of planning, ~120 s on screen).
 */
export const THINK_SKIP_MS = 250;
/** The tag of a skipped plan. */
const PLAN_WAIT = 'a way past the guards';
/** AUTO's adaptive tick budget never goes under this (ms a frame): the run keeps moving under a heavy draw. */
export const MIN_TICK_MS = 1;
/** Always action: a man or a guard the camera turned to while the step's men wait is kept this long (ms) at least. */
export const LIVE_DWELL = 2500;
/** Skip waits: the most the pace is raised while every commando waits. */
export const SKIP_BOOST = 4;
/** Wall-clock ms of ticks a displayed frame may run (TickPacer.tickMs): costly stretches slow down, never stall. */
export const WALK_TICK_MS = 12;
/**
 * Wall-clock ms of ticks per frame while scrubbing to a time: the plain fast-forward's budget (the view is
 * still redrawn every WALK_TURBO_VIEW_MS, so the timeline's clock and fill move while the jump runs).
 */
export const WALK_SEEK_TURBO_MS = 90;
const ROLE_COLORS = { greenberet: '#8fd47a', sniper: '#d9c27a', diver: '#7ac4e8', sapper: '#e8a25c', driver: '#c7a0e8', spy: '#e87a8f' };

const CSS = `
#wt-bar{position:fixed;z-index:8600;display:flex;flex-wrap:wrap;justify-content:center;gap:4px;box-sizing:border-box;padding:4px;
  background:rgba(10,11,12,.82);border:1px solid #ffcf4a55;border-radius:10px;font:700 13px/1 system-ui,sans-serif;color:#efe7d2;
  max-width:calc(100vw - 12px);touch-action:manipulation;-webkit-user-select:none;user-select:none}
#wt-bar button{all:unset;box-sizing:border-box;min-width:44px;height:44px;padding:0 8px;display:inline-flex;align-items:center;
  justify-content:center;border-radius:7px;background:#262a2e;cursor:pointer;border:2px solid transparent;letter-spacing:.04em;white-space:nowrap}
#wt-bar button:hover,#wt-bar button:focus-visible{border-color:#ffcf4a}
#wt-bar button[aria-pressed=true]{background:#5b4a14;color:#ffdf7a}
#wt-bar button:disabled{opacity:.4;cursor:default}
#wt-bar [data-act=exit]{background:#4a1d19}
#wt-bar .wt-grp{display:inline-flex;gap:2px;padding:0;border-radius:8px}
#wt-bar .wt-grp button{min-width:44px;padding:0 4px;font-size:12px}
#wt-bar button[hidden]{display:none}
#wt-bar [data-act=speed-auto]{flex-direction:column;gap:3px;min-width:48px;line-height:1}
#wt-bar [data-act=speed-auto] .wt-k{font-size:11px;letter-spacing:.08em}
#wt-bar [data-act=speed-auto] .wt-v{font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:0}
#wt-bar [data-act=speed-auto] .wt-v:empty{display:none}
#wt-bar .wt-tag{align-self:center;padding:0 6px 0 4px;color:#ffcf4a;font-size:11px;letter-spacing:.14em}
#wt-cap{position:fixed;z-index:8500;box-sizing:border-box;padding:8px 12px 10px;background:rgba(12,11,9,.80);border-radius:8px;
  border:1px solid #ffffff1a;color:#f3ead2;pointer-events:auto;font:16px/1.38 Georgia,'Times New Roman',serif;text-shadow:0 1px 2px #000;cursor:default}
#wt-cap .wt-head{display:flex;gap:8px;align-items:baseline;justify-content:space-between;font:700 11px/1.2 system-ui,sans-serif;
  letter-spacing:.12em;text-transform:uppercase;color:#ffcf4a;margin-bottom:4px}
#wt-cap .wt-head .wt-pos{color:#cfc6b0;font-weight:600;letter-spacing:.06em;white-space:nowrap}
#wt-cap .wt-head .wt-ff{color:#7fd6ff}
#wt-cap .wt-who{display:inline-block;font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:3px 6px;
  border-radius:4px;margin-right:6px;vertical-align:2px;color:#111;text-shadow:none}
#wt-cap .wt-say{display:inline}
#wt-cap.chapter{border-color:#ffcf4a88}
#wt-cap.chapter .wt-title{display:block;font:700 22px/1.15 Georgia,serif;color:#ffe9a8;margin:2px 0 4px}
#wt-cap .wt-prog{height:3px;margin-top:6px;background:#ffffff22;border-radius:2px;overflow:hidden}
#wt-cap .wt-prog i{display:block;height:100%;background:#7fd6ff;width:0}
#wt-menu{position:fixed;z-index:8700;box-sizing:border-box;overflow:auto;padding:6px;background:rgba(10,11,12,.95);border:1px solid #ffcf4a88;
  border-radius:9px;font:14px/1.3 system-ui,sans-serif;color:#e8e2d0;overscroll-behavior:contain}
#wt-menu .wt-ch{all:unset;box-sizing:border-box;display:block;width:100%;min-height:44px;padding:8px 10px;border-radius:6px;cursor:pointer}
#wt-menu .wt-ch b{color:#ffcf4a;margin-right:8px}
#wt-menu .wt-ch small{display:block;opacity:.7;font-size:12px;margin-top:2px}
#wt-menu .wt-st{all:unset;box-sizing:border-box;display:block;width:100%;min-height:36px;padding:6px 10px 6px 30px;border-radius:5px;cursor:pointer;
  font-size:13px;opacity:.9}
#wt-menu .wt-st b{color:#cfc6b0;margin-right:6px;font-weight:600}
#wt-menu button:hover,#wt-menu button:focus-visible{background:#3a4046}
#wt-menu .done{opacity:.5}
#wt-menu .now{box-shadow:inset 3px 0 0 #ffcf4a;background:#2a2f34}
#wt-card{position:fixed;inset:0;z-index:8800;display:flex;align-items:center;justify-content:center;background:rgba(8,8,10,.72);
  color:#f3ead2;font-family:Georgia,serif;text-align:center;padding:16px;box-sizing:border-box}
#wt-card .wt-box{max-width:min(720px,100%);max-height:100%;overflow:auto}
#wt-card .wt-k{font:700 13px/1 system-ui,sans-serif;letter-spacing:.3em;color:#ffcf4a;opacity:.9}
#wt-card h2{font:400 clamp(24px,min(6vw,7.5vh),46px)/1.1 Georgia,serif;margin:10px 0 8px}
#wt-card p{font-size:clamp(14px,min(2.4vw,3.6vh),19px);line-height:1.42;margin:0 0 8px;opacity:.95}
#wt-card{z-index:8900}
#wt-card .wt-acts{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:18px}
#wt-card button{all:unset;min-height:44px;padding:0 20px;border-radius:7px;background:#3a4046;cursor:pointer;font:700 14px/44px system-ui,sans-serif;
  letter-spacing:.08em;color:#f3ead2}
#wt-card button.wt-go{background:#5b4a14;color:#ffdf7a}
#wt-card button:hover,#wt-card button:focus-visible{outline:2px solid #ffcf4a;outline-offset:-2px}
#wt-card ul{list-style:none;padding:0;margin:8px 0;font-size:16px;line-height:1.6}
@media (max-height:480px){#wt-cap{font-size:14px;line-height:1.3;padding:5px 10px 7px}#wt-cap .wt-head{font-size:10px;margin-bottom:2px}
  #wt-cap.chapter .wt-title{font-size:17px;margin:0 0 2px}#wt-cap .wt-who{font-size:10px;padding:2px 5px}}
@media (max-width:480px){#wt-cap{font-size:15px;line-height:1.33}}
body.dbg-video .hud-speaker-card{transform:translateY(var(--wt-card-shift,0px))}
#wt-rewind{position:fixed;z-index:8950;left:50%;top:50%;transform:translate(-50%,-50%);min-width:min(360px,calc(100vw - 32px));box-sizing:border-box;
  padding:14px 18px;background:rgba(10,11,12,.88);border:1px solid #7fd6ff88;border-radius:10px;color:#efe7d2;font:600 14px/1.35 system-ui,sans-serif;pointer-events:none}
#wt-rewind .wt-k{color:#7fd6ff;letter-spacing:.08em}
#wt-rewind .wt-sub{font-weight:500;opacity:.85;margin-top:2px}
#wt-rewind .wt-prog{height:4px;margin-top:10px;background:#ffffff22;border-radius:2px;overflow:hidden}
#wt-rewind .wt-prog i{display:block;height:100%;background:#7fd6ff;width:0;transition:width .15s linear}
#wt-skip{position:fixed;z-index:8660;left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:7px;background:rgba(10,11,12,.86);
  border:1px solid #7fd6ff88;color:#7fd6ff;font:700 14px/1.3 system-ui,sans-serif;letter-spacing:.03em;pointer-events:none;max-width:calc(100vw - 24px);
  text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wt-flash{position:fixed;z-index:8650;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.75);
  color:#ffe9a8;font:600 13px/1.3 system-ui,sans-serif;pointer-events:none;max-width:calc(100vw - 24px);text-align:center}
#wt-tl{flex:1 1 100%;display:flex;align-items:center;gap:8px;padding:0 4px;box-sizing:border-box}
#wt-tl .wt-tl-clock{font:700 12px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#efe7d2;white-space:nowrap}
#wt-tl-track{position:relative;flex:1;height:16px;border-radius:8px;background:#ffffff1f;cursor:pointer;touch-action:none}
/* (the 16px track stays slim to look at; its touch target is the row's full 44px: 14px more above and below it) */
#wt-tl-track::after{content:'';position:absolute;left:0;right:0;top:-14px;bottom:-14px}
#wt-tl-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:8px;background:#7fd6ff;pointer-events:none}
#wt-tl-fill.seeking{background:#ffcf4a}
#wt-tl .wt-tl-mark{position:absolute;top:3px;width:2px;height:10px;margin-left:-1px;border-radius:1px;background:#ffffff70;pointer-events:none}
#wt-tl .wt-tl-mark.stage{top:1px;height:14px;background:#ffcf4a}
#wt-bar #wt-tl button{min-width:44px;height:44px;padding:0 6px;font-size:12px}
`;

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
const stop = (e) => e.stopPropagation();
const guard = (node) => { for (const ev of ['pointerdown', 'pointerup', 'wheel', 'contextmenu', 'click', 'touchstart']) node.addEventListener(ev, stop, { passive: true }); };
const rectOf = (q) => {
  const n = typeof q === 'string' ? document.querySelector(q) : q;
  if (!n || n.hidden) return null;
  const cs = getComputedStyle(n);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  const r = n.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
/** What a wait is for, as the solution says it (its until label), kept short for the caption. */
const waitText = (s) => { const t = String(s ?? '').trim(); return t.length > 72 ? `${t.slice(0, 70)}…` : t; };

function installStyle() {
  if (document.getElementById('wt-style')) return;
  const st = el('style', null, document.head, CSS);
  st.id = 'wt-style';
}

/**
 * A full-screen card (title, no walkthrough yet, the end): `actions` = [[label, fn, primary?]]. Any tap on the dim
 * background runs the primary action. @returns {HTMLElement}
 */
export function showCard({ kicker = '', title = '', paras = [], list = [], actions = [], kind = 'info' } = {}) {
  installStyle();
  document.getElementById('wt-card')?.remove();
  const card = el('div', null, document.body);
  card.id = 'wt-card';
  card.dataset.kind = kind;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', title || kicker);
  guard(card);
  const box = el('div', 'wt-box', card);
  if (kicker) el('div', 'wt-k', box, kicker);
  if (title) el('h2', null, box, title);
  for (const p of paras) if (p) el('p', null, box, p);
  if (list.length) { const ul = el('ul', null, box); for (const li of list) el('li', null, ul, li); }
  const acts = el('div', 'wt-acts', box);
  let primary = null;
  for (const [label, fn, main] of actions) {
    const b = el('button', main ? 'wt-go' : null, acts, label);
    b.type = 'button';
    b.dataset.act = label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    if (main && !primary) primary = fn;
  }
  card.addEventListener('click', (e) => { if (e.target === card && primary) primary(); });
  (acts.querySelector('.wt-go') || acts.querySelector('button'))?.focus();
  return card;
}

export function closeCard() {
  document.getElementById('wt-card')?.remove();
}

/**
 * A jump back rebuilds the mission (then fast-forwards): this panel shows it happening — the load's own progress
 * (`mission:progress`) on a bar — instead of a frozen picture. The next walkthrough takes it away as its jump starts.
 */
export function showRewind(game, label) {
  installStyle();
  hideRewind();
  const box = el('div', null, document.body);
  box.id = 'wt-rewind';
  box.setAttribute('role', 'status');
  el('div', 'wt-k', box, `⏪ Back to ${label}`);
  el('div', 'wt-sub', box, 'Rebuilding the mission, then fast-forwarding…');
  const bar = el('i', null, el('div', 'wt-prog', box));
  const off = game?.events?.on?.('mission:progress', (e) => { bar.style.width = `${Math.round(Math.max(0, Math.min(1, e?.p ?? 0)) * 100)}%`; });
  box._off = typeof off === 'function' ? off : null;
  return box;
}

export function hideRewind() {
  const b = document.getElementById('wt-rewind');
  if (!b) return;
  b._off?.();
  b.remove();
}

export class Walkthrough extends SolutionReplay {
  /**
   * @param {object} game the Game (mission freshly loaded, playing)
   * @param {object} sol loadSolution() result
   * @param {object|null} wtFile the mission's WALKTHROUGH (or null: chapters / captions from the solution itself)
   * @param {{speed?: number|'auto', toMarker?: {kind: string, id: string}|null, isFrozen?: () => boolean, onEnd?: Function,
   *   onSkip?: (marker: object, settings: object) => void, onExit?: () => void, captions?: boolean, skipWaits?: boolean,
   *   free?: boolean, intro?: boolean, introWait?: boolean, onSpeed?: (s: number|'auto') => void}} o  speed: a fixed
   *   speed or 'auto' (the default); onSkip: reload + fast-forward to that marker (a jump back); intro: show the opening
   *   card (a fresh start); introWait: the card waits for ▶ Start (a shared link: nobody may be watching yet, and the
   *   click lets the sound play); onSpeed: speed changed (a fixed speed or 'auto')
   */
  constructor(game, sol, wtFile, o = {}) {
    const auto = String(o.speed ?? DEFAULT_WALK_SPEED).toLowerCase() === 'auto';
    super(game, sol, { ...o, speed: auto ? 1 : o.speed, speeds: WALK_SPEEDS, turboMs: o.turboMs ?? WALK_TURBO_MS, turboViewMs: o.turboViewMs ?? WALK_TURBO_VIEW_MS, tickMs: o.tickMs ?? WALK_TICK_MS, onSkip: null });
    this.isWalkthrough = true;
    this.onJumpBack = o.onSkip || null;
    this.onExit = o.onExit || null;
    const outer = this.isFrozen;
    this.isFrozen = () => outer() || this._held();
    this.wt = normalizeWalkthrough(wtFile, { id: sol.id, stages: sol.stages, missionTitle: game.missionDef?.title });
    this.markers = this._buildMarkers();
    this.markerIndex = -1;
    this.chapterId = null;
    this.doneCps = [];
    this.step = null;
    this.stepWall = performance.now();
    this.beat = null;
    this.beatIdx = 0;
    this.captions = o.captions ?? true;
    this.skipWaits = o.skipWaits ?? true;
    this.director = new Director(this);
    this.director.on = !o.free;
    this.hold = null;
    this.showIntro = o.intro ?? !o.toMarker;
    this.introWait = !!o.introWait;
    this.onSpeed = o.onSpeed || null;
    this._jumpFrom = this.toMarker ? -1 : null;
    // the time scrub (the timeline row under the bar): a jump back to a clock time waiting for the first tick,
    // a seek in flight (its target, and whether to pause again on arrival), and the run's measured timeline
    this._toTime = o.toTime ?? null;
    this._toTimePause = !!o.toTimePause;
    this._seekT = null;
    this._seekPause = false;
    this._seekBackSent = false;
    this._turboMsBase = this.pacer.turboMs;
    this._tl = this._tlLoad();
    this._tlKey = null;
    this._tlDragT = null;
    this._bombs = [];
    this._blasts = [];
    this._objHold = null;
    this._action = null;
    this._calmUntil = 0;
    this._idleSince = null;
    this._motion = { t: -1, pos: new Map(), moving: true };
    this._safe = null;
    this._safeAt = 0;
    this._doneObj = new Set();
    // AUTO speed (debug/auto-pace.js): pacer.speed stays 1× and pacer.boost carries the eased speed
    this.auto = auto;
    this._fixedSpeed = this.pacer.speed; // (where AUTO off goes back to)
    this.autoPace = new AutoPace(1);
    this.autoCeiling = new PerfCeiling({ simDt: this.simDt });
    this.sensor = new PaceSensor(this.world);
    this._grant = new SteadyGrant();
    this.autoWhy = '';
    this._readUntil = 0;
    this._lastChapterT0 = null;
    this._cardDeferred = false;
    this._burst = { frame: 0, prev: 0, ms: 0, ticks: 0 };
    this._frameNo = 0;
  }

  // ------------------------------------------------------------ state

  get paused() { return this.pacer.paused || this.game.state === 'paused'; }
  get free() { return !this.director.on; }
  get stepIndex() { return this.step ? this.wt.steps.indexOf(this.step) : -1; }
  /** The speed setting: a fixed speed, or 'auto'. */
  get speedSetting() { return this.auto ? 'auto' : this.pacer.speed; }
  /** Sim seconds per real second now (AUTO: its eased speed). */
  get rate() { return this.pacer.speed * this.pacer.boost; }
  /** Settings a reload (jump back) carries over. */
  get settings() { return { speed: this.speedSetting, captions: this.captions, skipWaits: this.skipWaits, free: this.free }; }

  _held() {
    return !!this.hold && !this.pacer.turbo && performance.now() < this.hold.until;
  }

  _animScale() {
    if (this.pacer.paused || this._held() || this._thinking) return 0;
    return this.pacer.turbo ? 8 : this.pacer.speed * this.pacer.boost;
  }

  /** [{kind: 'stage'|'cp', id, chapter}] in play order: each chapter's start, then its checkpoints. */
  _buildMarkers() {
    const out = [];
    for (const c of this.wt.chapters) {
      out.push({ kind: 'stage', id: c.id, chapter: c.id });
      for (const s of this.wt.steps) if (s.chapter === c.id) out.push({ kind: 'cp', id: s.cp, chapter: c.id });
    }
    return out;
  }

  _markerIdx(m) {
    return m ? this.markers.findIndex((x) => x.kind === m.kind && x.id === m.id) : -1;
  }

  /** The marker step `i` starts at: the previous step's checkpoint, or its chapter's start. */
  startMarkerOf(i) {
    const s = this.wt.steps[i];
    if (!s) return null;
    const prev = this.wt.steps[i - 1];
    return !prev || prev.chapter !== s.chapter ? { kind: 'stage', id: s.chapter } : { kind: 'cp', id: prev.cp };
  }

  // ------------------------------------------------------------ engine hooks

  start() {
    const w = this.world;
    const on = (name, fn) => w.events?.on?.(name, fn);
    this._offs = [
      on('unit:killed', (p) => { this._event({ kind: 'kill', tag: targetTag(p.unit) }); this._calm(2.5); }),
      on('enemy:state', (p) => {
        this._event({ kind: 'state', tag: targetTag(p.enemy), state: p.to });
        if (/^(DECOY|DISTRACTED|ALERT|COMBAT|SEARCH|INVESTIGATE)/.test(p.to || '') && this._nearView(p.enemy)) this._calm(2);
      }),
      on('bomb:armed', (p) => { if (p?.bomb) { this._bombs.push(p.bomb); this._lastBomb = p.bomb; } }),
      on('explosion', (p) => this._blast(p)),
      on('bomb:exploded', (p) => this._blast(p?.bomb || p)),
      on('alarm:start', () => { this._event({ kind: 'alarm', on: true }); this._calm(3); }),
      on('alarm:end', () => this._event({ kind: 'alarm', on: false })),
    ].filter(Boolean);
    this.sensor.attach();
    this.sensor.onEvent = () => this._endSkip(); // (a kill, a blast, a guard turning…: back to the play)
    this._offs.push(w.events?.on?.('ability:start', () => this._endSkip()));
    this.director.attach();
    hideRewind(); // (a jump back's rebuild is done: this walkthrough's own fast-forward shows the rest)
    // (a scrub back reloaded the mission for one moment: no intro card; the fast-forward to it starts at once)
    if (this._toTime != null) {
      this.showIntro = false;
      this._seekT = this._toTime;
      this._seekPause = this._toTimePause;
      this.pacer.turboMs = WALK_SEEK_TURBO_MS;
      this.pacer.setTurbo(true);
      this._jumpFrom = -1;
    }
    if (this.showIntro) { this._introOn = true; this.hold = { until: performance.now() + 1e9, kind: 'intro' }; }
    const done = super.start(); // (runs the solution up to its first tick: stage A starts in here)
    // (the run's measured length completes the timeline — this viewing's bar, and the next one's from the
    // start. Only a run that played to the win measures it: the replay promise also resolves for a stopped,
    // lost or errored run, at whatever the clock had then reached — and every jump back stops the instance
    // it replaces the same way — so an early clock must never become (or shrink) the bar's length)
    done.then((res) => {
      if (res?.outcome === 'done' && res?.state === 'won' && Number.isFinite(res.time) && res.time > (this._tl.total ?? 0)) {
        this._tl.total = res.time; this._tlSave();
      }
      this._syncTimeline();
    }, () => {});
    if (this.showIntro) this._intro();
    return done;
  }

  _blast(p) {
    const x = p?.x ?? p?.position?.x, z = p?.z ?? p?.position?.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this._blasts.push({ x, z, y: p.y ?? 0, until: this.world.time + 4.5 });
    this._calm(5);
  }

  _calm(sec) {
    this._calmUntil = Math.max(this._calmUntil, this.world.time + sec);
  }

  _onOrder(role, u, o) {
    this._endSkip();
    (this._orderT ||= new Map()).set(u, this.world.time);
    super._onOrder(role, u, o);
    const tgt = o?.type === 'ability' && o.target && o.target !== u && typeof o.target === 'object' ? o.target : null;
    if (tgt && (Number.isFinite(tgt.x) || tgt.kind)) this._action = { u, t: tgt, until: this.world.time + 6 };
    this._event({ kind: 'order', role, action: orderAction(u, o), target: tgt ? targetTag(tgt) : null });
    this.sensor.order(u, o, this.world.time);
  }

  _onCheckpoint(cp) {
    this._endSkip();
    const id = cpId(cp.name);
    if (!this.doneCps.includes(id)) this.doneCps.push(id);
    this._tlMark('cp', id, cp.t);
    this._calm(2.5);
    this.sensor.checkpoint(this.world.time);
    this._marker('cp', id);
    super._onCheckpoint(cp);
    this._syncStep();
  }

  _onStage(id, title) {
    this._endSkip();
    this.chapterId = id;
    this._tlMark('stage', id, this.world.time);
    // AUTO: a chapter starts at 1× (after its card); the last one's blast and escape are the climax
    this._lastChapterT0 = this.wt.chapters[this.wt.chapters.length - 1]?.id === id ? this.world.time : null;
    if (this.auto && !this.pacer.turbo) this._autoReset(1);
    this._marker('stage', id);
    super._onStage(id, title);
    this._syncStep();
    // (the card waits until an action of the last chapter has visibly finished: the Spy's clothesline take, M3 C3)
    if (!this.pacer.turbo && !this._introOn) { if (this.holdNow()) this._cardDeferred = true; else this._chapterCard(); }
  }

  _holdMeta() { return { step: this.step, chapterId: this.chapterId }; }

  _marker(kind, id) {
    const i = this._markerIdx({ kind, id });
    if (i >= 0) this.markerIndex = i;
    // a fast-forward whose marker never came (a checkpoint the solution sets only sometimes) ends at the next one
    const want = this.pacer.turbo ? this._markerIdx(this.toMarker) : -1;
    if (want >= 0 && i > want) { this.toMarker = null; this.pacer.setTurbo(false); this._fastForwardDone(kind, id); }
  }

  _fastForwardDone(kind) {
    this._jumpFrom = null;
    this._cardDeferred = false;
    this._autoReset(1);
    this._camCut = true;
    this.stepWall = performance.now();
    if (kind === 'stage') this._chapterCard();
    this._syncBar();
  }

  /** The step on screen follows the checkpoints; a new step resets its beats. */
  _syncStep() {
    const s = this.wt.steps.length ? currentStep(this.wt, this.chapterId, this.doneCps) : null;
    if (s !== this.step) {
      this.step = s;
      this.beat = null;
      this.beatIdx = 0;
      this.stepWall = performance.now();
      this._capKey = null;
      this._renderMenu();
    }
  }

  /** A live event: the next beat of the step that matches it fires. */
  _event(ev) {
    const s = this.step;
    if (!s?.beats?.length) return;
    for (let i = this.beatIdx; i < s.beats.length; i++) {
      const b = s.beats[i];
      if (b.parsed && matchOn(b.parsed, ev)) {
        this.beatIdx = i + 1;
        this.beat = { ...b, until: b.hold > 0 ? this.world.time + b.hold : null };
        this._calm(Math.max(2, b.hold || 0));
        this.sensor.beat(this.world.time, b.hold);
        this._capKey = null;
        return;
      }
    }
  }

  /**
   * Ms of ticks this frame may run without pushing it into the next vsync step: what the draw (an average of the last
   * frames' views) leaves of the slot it needs — a 25 ms draw is a 33.3 ms frame, so ~6.8 ms of ticks; a 10 ms draw,
   * ~5.2 ms; a 14 ms draw, ~1.2 ms. Never under MIN_TICK_MS (the run keeps moving), never over the walkthrough's cap.
   */
  _tickBudget() {
    const v = 1000 / 60, draw = this._drawMs || 0;
    const slot = v * Math.max(1, Math.ceil((draw + 1.5) / v));
    return Math.max(MIN_TICK_MS, slot - draw - 1.5);
  }

  _frame(dt) {
    this._frameNo++;
    // (the view's draw time, smoothed: _viewMs is the last drawn frame's Game.frame, ticks excluded)
    if (this._viewMs > 0 && !this.pacer.turbo) this._drawMs = this._drawMs ? this._drawMs * 0.85 + this._viewMs * 0.15 : this._viewMs;
    this._tickMsBase ??= this.pacer.tickMs;
    // (AUTO only: its pace is its own to set; a fixed speed — 4× — keeps its tick cap and plays at the speed it shows)
    this.pacer.tickMs = PERF.adaptiveTicks && this.auto && this._drawMs ? Math.min(this._tickMsBase, this._tickBudget()) : this._tickMsBase;
    // AUTO grants ticks for a steady frame time: one long frame (a hitch, a shader compile) is not paid back with a
    // burst of ticks on the next — at most 1.25× a usual frame's worth, the rest of the lag is let go (the pace is
    // wall time only) — so the ticks per frame follow the eased speed and never pile up into a second hitch
    const g = this._grant.frame(dt);
    super._frame(this.auto && !this.pacer.turbo ? g : dt);
    if (this.stopped) return;
    if (this._cardDeferred && (this.pacer.turbo || !this.holdNow())) { this._cardDeferred = false; if (!this.pacer.turbo) this._chapterCard(); }
    this._pace(dt);
    this.director.update(dt);
  }

  /** Skip waits: while every commando waits (nobody moves or acts, nothing just happened) the pace rises to 4×. */
  _pace(dt) {
    if (this.auto) { this._autoStep(dt); return; }
    const w = this.world, t = w.time, p = this.pacer;
    if (this.pacer.turbo || this.paused) { p.boost = 1; return; }
    const m = this._motion;
    if (t - m.t >= 0.25 || t < m.t) {
      let moving = false;
      for (const c of w.commandos) {
        if (!c.alive) continue;
        const q = c.vehicle || c, last = m.pos.get(c);
        if (last && Math.hypot(q.x - last.x, q.z - last.z) > 0.1 * Math.max(0.25, t - m.t)) moving = true;
        if (c.currentAction || c.pendingAbility || c.carrying) moving = true;
        m.pos.set(c, { x: q.x, z: q.z });
      }
      m.moving = moving;
      m.t = t;
    }
    const armed = this._bombs.some((b) => !b.removed && !b.exploded);
    const busy = m.moving || armed || t < this._calmUntil || this._held();
    if (busy || !this.skipWaits) this._idleSince = null;
    else if (this._idleSince == null) this._idleSince = t;
    const want = this._idleSince != null && t - this._idleSince > 1.0 ? SKIP_BOOST : 1;
    if (want < p.boost) p.boost = want; // back to the chosen pace at once
    else if (want > p.boost) p.boost = Math.min(want, p.boost * Math.pow(2.2, Math.min(dt, 0.1))); // ramps up
    if (Math.abs(p.boost - 1) < 0.02) p.boost = 1;
  }

  /**
   * AUTO (debug/auto-pace.js): what is about to happen (PaceSensor) → the speed wanted (paceTarget, under the frame
   * rate's ceiling) → eased (AutoPace) → pacer.boost on top of a 1× pacer. Paused, held on a card or fast-forwarding:
   * the speed holds.
   */
  _autoStep(dt) {
    const p = this.pacer, w = this.world;
    this.autoDt = dt; // (the frame time the speed was eased over: tests measure the ramps by it)
    // (a skipped wait goes on while the solution waits, or plans its next move, and nobody acts)
    if (this._skip) { if ((this.waitLabel || this._thinking) && !this._anyBusy()) { this._skipTag(); return; } this._endSkip(); }
    if (p.turbo) return;
    const b = this._burst; // ms of ticks per tick on the last frames (the game step and the solution's own planning)
    const msPerTick = b.ticks ? b.ms / b.ticks : null;
    b.ms = 0; b.ticks = 0;
    const ceiling = this.autoCeiling.frame(dt, msPerTick);
    if (this.paused || this._held()) { p.boost = this.autoPace.rate; this._thinkSince = null; return; }
    // a long plan, nobody acting: skipped like a wait (THINK_SKIP_MS)
    if (this._thinking && !this._anyBusy()) {
      const now = performance.now();
      if (this._thinkSince == null) this._thinkSince = now;
      else if (now - this._thinkSince >= THINK_SKIP_MS) { this._thinkSince = null; this._startSkip(PLAN_WAIT); return; }
    } else this._thinkSince = null;
    const t = w.time;
    const sig = this.sensor.sample(t, this._paceCtx(), performance.now());
    const reading = this.captions ? (this._readUntil - performance.now()) / 1000 : 0;
    const climax = inClimax(t, this._lastChapterT0, this.sensor.blastT);
    const held = this.holdNow();
    if (held) sig.windows.push({ rate: 1, why: held.id, left: 1 }); // (an action watched until it has visibly finished: 1×)
    const tg = paceTarget(sig, { ceiling, reading, climax });
    // a true wait (the solution waits for a guard, a gap, a timer; nobody acts; nothing to slow for — a caption needs no
    // slow play when nothing happens: it stays up after the skip) is skipped like a jump once it has lasted SKIP_AFTER s;
    // anything that happens (an order, an event, an action) ends the skip at once
    const tq = reading > 0 ? paceTarget(sig, { ceiling, reading: 0, climax }) : tg, busyNow = this._anyBusy();
    const quiet = isTrueWait(sig, tq, { waiting: this.waitLabel, busy: busyNow });
    // (why a wait is not skipped, for tests and tuning: a man acting, a man moving, what AUTO slows for)
    this.waitWhy = !this.waitLabel ? null : quiet ? 'skip' : busyNow ? 'busy' : (sig.motion || 'idle') !== 'idle' ? `moving (${sig.motion})` : tq.why;
    if (!quiet) this._quietSince = null;
    else if (this._quietSince == null) this._quietSince = t;
    else if (t - this._quietSince >= SKIP_AFTER) { this._startSkip(); return; }
    p.boost = this.autoPace.step(tg.rate, dt, ceiling);
    this.autoWhy = tg.why;
    this._autoLabel();
  }

  /** A man acting: on the move (his path, his vehicle's), walking up to an order, an action under way (a chat-up held
   * for long is no action). */
  _anyBusy() {
    return this.world.commandos.some((c) => c.alive && (!!c.path || !!c.vehicle?.path || c.pendingAbility || (c.currentAction && c.currentActionId !== 'distract')));
  }

  /** Skip a true wait like a jump: ticks by wall time, the view redrawn now and then, a "waiting" tag. */
  _startSkip(label = this.waitLabel) {
    if (this._skip || this.pacer.turbo || !this.auto) return;
    this._skip = { label, t0: this.world.time, wall: performance.now(), turboMs: this.pacer.turboMs, viewMs: this.turboViewMs };
    this.pacer.turboMs = SKIP_TICK_MS;
    this.turboViewMs = SKIP_VIEW_MS;
    this.pacer.setTurbo(true);
    this.autoWhy = 'wait';
    this._capKey = null;
    this._skipTag();
    this._syncBar();
  }

  /** The skip is over (the wait ended, an order, an event, an action): a cut back to the play, AUTO on from 2×. */
  _endSkip() {
    const s = this._skip;
    if (!s) return;
    this._skip = null;
    this.turboViewMs = s.viewMs;
    if (this._seekT == null && !this.toMarker) { this.pacer.turboMs = s.turboMs; if (this.pacer.turbo) this.pacer.setTurbo(false); }
    (this.skips ||= []).push({ label: s.label, game: this.world.time - s.t0, wall: (performance.now() - s.wall) / 1000 });
    this._quietSince = null;
    this._camCut = true;
    this.autoPace.reset(2);
    this.pacer.boost = this.autoPace.rate;
    this._capKey = null;
    document.getElementById('wt-skip')?.remove();
    this._syncBar();
  }

  /** The "⏩ waiting: <what for>" tag under the bar while a wait is skipped. */
  _skipTag() {
    let tag = document.getElementById('wt-skip');
    if (!tag) { installStyle(); tag = el('div', null, document.body); tag.id = 'wt-skip'; tag.setAttribute('role', 'status'); }
    // (a skipped plan that runs on into a wait shows what it waits for now)
    const txt = `⏩ waiting: ${waitText((this._skip?.label === PLAN_WAIT && !this._thinking && this.waitLabel) || this._skip?.label || this.waitLabel || '')}`;
    if (tag.textContent !== txt) tag.textContent = txt;
    const bar = rectOf(this._ui);
    tag.style.top = `${Math.round((bar?.bottom ?? 60) + 8)}px`;
  }

  _onWait(label) {
    super._onWait(label);
    if (!label) this._endSkip(); // (the wait is over: the ticks of this frame stop here, the play goes on at AUTO's pace)
  }

  /** The step's acting men and the guards it (or its beat) names: the sensor's "closing in". Cached per step / beat. */
  _paceCtx() {
    const key = `${this.step?.cp}|${this.beatIdx}|${this.focus?.role}`;
    if (this._paceKey === key && this._paceCtxV) return this._paceCtxV;
    const w = this.world;
    const who = this.step?.who?.length ? this.step.who.map((r) => w.commandos.find((c) => c.role === r)).filter(Boolean) : this.focus ? [this.focus] : [];
    const refs = [...(this.step?.look || []), ...(this.beat?.look || [])].filter((r) => typeof r === 'string');
    const subjects = refs.map((r) => w.enemies.find((e) => e.tag === r)).filter(Boolean);
    const objects = refs.map((r) => w.interactables.find((i) => !i.removed && (i.tag === r || i.spawn?.id === r || i.switchId === r))).filter(Boolean);
    this._paceKey = key;
    this._paceCtxV = { actors: who, subjects, objects };
    return this._paceCtxV;
  }

  _autoReset(rate = 1) {
    this.autoPace.reset(Math.min(rate, this.autoPace.rate));
    if (this.auto) this.pacer.boost = this.autoPace.rate;
  }

  /** The AUTO button shows the speed it plays at (4 times a second at most). */
  _autoLabel(force = false) {
    const v = this._autoVal;
    if (!v) return;
    const now = performance.now();
    if (!force && now - (this._autoLabelAt || 0) < 250) return;
    this._autoLabelAt = now;
    const txt = this.auto ? ` ${this._skip ? '⏩' : this._fmtRate(this.rate)}` : ''; // (textContent "AUTO 3.2×"; the space is not drawn)
    if (v.textContent !== txt) v.textContent = txt;
    if (this._ui) { this._ui.dataset.rate = this.rate.toFixed(2); this._ui.dataset.why = this.auto ? this.autoWhy : ''; }
  }

  _fmtRate(r) {
    return r < 0.75 ? '½×' : r >= 9.95 ? `${Math.round(r)}×` : `${r.toFixed(1)}×`;
  }

  _tick() {
    // (AUTO's frame-rate ceiling: the wall time a tick takes, the solution's own planning since the frame's last tick
    // included)
    const b = this._burst, t0 = performance.now();
    if (b.frame !== this._frameNo) { b.frame = this._frameNo; b.prev = t0; }
    super._tick();
    const t1 = performance.now();
    b.ms += t1 - b.prev;
    b.prev = t1;
    b.ticks++;
    // (a scrub lands on its tick: from here the state on screen is the state at the scrubbed time)
    if (this._seekT != null && this.world.time >= this._seekT) this._seekDone();
    // (the clock ran past the stored length: that length was no complete run's — drop it and let this play
    // measure its own, instead of pinning the bar full for the rest of the mission)
    if (this._tl.total != null && this.world.time > this._tl.total) { this._tl.total = null; this._tlSave(); this._syncTimeline(); }
  }

  _nearView(e) {
    const cc = this.game.cameraController;
    if (!cc || !e) return false;
    return Math.hypot(e.x - cc.target.x, e.z - cc.target.z) < 30;
  }

  // ------------------------------------------------------------ what the director frames

  /** A world point for a `look` / `who` reference (see docs/walkthrough-format.md), or null. */
  resolve(ref) {
    const w = this.world;
    const P = (x, z, y = null) => (Number.isFinite(x) && Number.isFinite(z) ? { x, z, y: y ?? (w.grid?.elevAt?.(x, z) ?? 0) } : null);
    const ent = (e) => {
      const p = e && !e.removed ? P(e.x, e.z, e.y) : null;
      // (a man inside a bunker, dug into the snow or under water is hidden by design: no yaw swing for him)
      if (p && (e.insideStructure || e.buried || e.underwater || e.diving || e.object3d?.visible === false)) p.unseen = true;
      return p;
    };
    if (Array.isArray(ref)) return P(+ref[0], +ref[1]);
    if (typeof ref !== 'string') return null;
    if (ref === 'decoy') {
      const gb = w.commandos.find((c) => c.role === 'greenberet');
      const d = gb?.decoy && !gb.decoy.removed ? gb.decoy : w.interactables.find((i) => i.interactKind === 'decoy' && !i.removed);
      return ent(d);
    }
    if (ref === 'charge') {
      const b = this._lastBomb;
      return b && !b.removed && !b.exploded ? ent(b) : null;
    }
    const c = w.commandos.find((u) => u.role === ref || u.tag === ref);
    if (c) return ent(c.vehicle && !c.vehicle.removed ? c.vehicle : c);
    const e = w.enemies.find((u) => u.tag === ref);
    if (e) return ent(e);
    const v = w.vehicles.find((u) => !u.removed && (u.tag === ref || u.spawn?.id === ref || u.id === ref || u.vehicleType === ref));
    if (v) return ent(v);
    const it = w.interactables.find((i) => !i.removed && (i.tag === ref || i.spawn?.id === ref || i.switchId === ref || i.def?.id === ref));
    if (it) return ent(it);
    const mk = w.markers?.get?.(ref);
    if (mk) return P(mk.x, mk.z);
    const st = w.structures?.get?.(ref);
    const d = st?.def || st;
    if (d && Number.isFinite(d.x)) return P(d.x, d.z);
    if (d?.points?.length) return P(d.points.reduce((s, q) => s + (q[0] ?? q.x), 0) / d.points.length, d.points.reduce((s, q) => s + (q[1] ?? q.z), 0) / d.points.length);
    return null;
  }

  /** The acting commandos' points: the step's `who` (those near the lead), else the last ordered man. */
  _actors() {
    const w = this.world;
    const who = this.step?.who || [];
    const units = who.map((r) => w.commandos.find((c) => c.role === r)).filter((c) => c && c.alive);
    // (the lead is the one at work: a step's man standing by while the other walks is framed beside him, not first)
    const focus = units.includes(this.focus) ? this.focus : null;
    let lead = (focus && isActing(focus) ? focus : units.find(isActing)) || focus || units[0] || this.focus || w.commandos.find((c) => c.alive);
    if (!lead) return [];
    const pt = (c) => this.resolve(c.role);
    const lp = pt(lead);
    const out = lp ? [lp] : [];
    for (const u of units) {
      if (u === lead) continue;
      const q = pt(u);
      if (q && lp && Math.hypot(q.x - lp.x, q.z - lp.z) < 26) out.push(q);
    }
    return out;
  }

  _pitch(pts) {
    const f = this.wt.pitchAt;
    if (!f || !pts.length) return null;
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const v = +f(x, z);
    return Number.isFinite(v) ? v : null;
  }

  /** What the camera should show now: {pts, shot?, cut?, frame?, pitch?}. */
  composeShot() {
    const w = this.world, now = w.time;
    const cut = this._camCut;
    this._camCut = false;
    // a skipped wait: what the men wait for, moving fast (the guard, another man), else the men themselves
    if (this._skip) { const l = this._liveShot(false); if (l) return { ...l, cut: true, frame: { minSpan: [24, 15] } }; }
    if (this.pacer.turbo) {
      const a = this._actors();
      return { pts: a, must: a.length, cut: true, frame: { minSpan: [26, 16] }, pitch: this._pitch(a) };
    }
    // a charge in its last seconds, a blast: the explosion is the shot
    const bomb = this._bombs.find((b) => !b.removed && !b.exploded && Number.isFinite(b.fuse) && b.fuse <= 4.5);
    this._blasts = this._blasts.filter((b) => b.until > now);
    if (bomb || this._blasts.length) {
      const pts = bomb ? [this.resolve([bomb.x, bomb.z])] : this._blasts.map((b) => ({ x: b.x, y: b.y, z: b.z }));
      return { pts, must: 1, frame: { minSpan: [26, 16], maxZoom: 0.9 }, pitch: this._pitch(pts), cut, stiff: 2.6 };
    }
    // an objective just done: a moment on it
    for (const o of w.objectives) {
      if (!o.done || this._doneObj.has(o.id)) continue;
      this._doneObj.add(o.id);
      const ref = o.targets?.[0] || o.vehicleId || o.def?.targets?.[0];
      const p = ref ? this.resolve(ref) : null;
      if (p) this._objHold = { pts: [p], until: now + 3 };
    }
    if (this._objHold && this._objHold.until > now) return { pts: this._objHold.pts, frame: { minSpan: [24, 15] }, pitch: this._pitch(this._objHold.pts), cut };
    const b = this.beat && (this.beat.until == null || now <= this.beat.until) ? this.beat : null;
    const cue = b?.look ? b : this.step;
    // an action is watched until it has visibly finished (and its beat), unless the walkthrough asks for a `shot`
    const held = cue?.shot && cue.look?.length ? null : this.holdNow();
    if (held) { const s = this.holdShot(held, cut); if (s) return s; }
    const zoom = cue?.zoom || this.step?.zoom;
    const frame = zoom === 'close' ? { minSpan: [10, 6], maxZoom: 1.7 } : zoom === 'wide' ? { minSpan: [30, 18] } : { minSpan: [16, 10] };
    const look = (cue?.look || []).map((r) => this.resolve(r)).filter(Boolean);
    if (cue?.shot && look.length) return { pts: look, must: 1, frame, pitch: this._pitch(look), cut };
    // always action: the step's men stand idle — then another man at work, else the guard they wait for
    const live = this._liveShot(cut);
    if (live) return live;
    const actors = this._actors();
    const pts = [...actors];
    const a0 = actors[0];
    const nearA = (p) => !a0 || Math.hypot(p.x - a0.x, p.z - a0.z) < 40;
    for (const p of look) if (nearA(p)) pts.push(p);
    const act = this._action;
    if (act && now <= act.until && !act.u.removed) {
      const busy = act.u.currentAction || act.u.pendingAbility || now < act.until - 4;
      const p = busy ? this.resolve([act.t.x, act.t.z]) : null;
      if (p && nearA(p)) pts.push(p);
    }
    if (!pts.length) return null;
    return { pts, must: Math.max(1, actors.length), frame, pitch: this._pitch(actors.length ? actors : pts), cut };
  }

  /**
   * The shot while the step's men stand idle (waiting their moment): another commando at work (the one ordered last),
   * else a guard on the move the step names (look / cones), else the nearest one walking within 35 m — with the waiting
   * man beside him when he is close. A pick is kept LIVE_DWELL ms (no ping-pong); null: the step's men act, or nothing
   * else moves (then the usual shot). User 2026-10-15: "Also no long quiet periods, always action in the walkthrough".
   */
  _liveShot(cut) {
    const w = this.world, now = performance.now();
    const who = this._paceCtx().actors.filter((u) => u && u.alive !== false && !u.removed);
    if (!who.length || who.some(isActing)) { this._live = null; return null; }
    let pick = this._live && now < this._live.until && isActing(this._live.unit) ? this._live : null;
    if (!pick) {
      const tags = new Set([...(this.step?.cones || []), ...(this.step?.look || [])].filter((r) => typeof r === 'string'));
      const unit = pickLive({ who, commandos: w.commandos, enemies: w.enemies, tags, orderT: this._orderT });
      if (!unit) { this._live = null; return null; }
      pick = this._live = { unit, until: now + LIVE_DWELL };
    }
    const p = this._pointOf(pick.unit);
    if (!p) return null;
    const pts = [p];
    if (pick.unit.kind !== 'commando') {
      const a = this._pointOf(who[0]);
      if (a && Math.hypot(a.x - p.x, a.z - p.z) < 30) pts.push(a);
    }
    return { pts, must: 1, frame: { minSpan: [18, 11] }, pitch: this._pitch(pts), cut, live: pick.unit.role || pick.unit.tag };
  }

  /** The guards whose cones are drawn now: the step's (or beat's) `cones`, else the ones that matter near the actor. */
  conesNow() {
    const w = this.world;
    if (this.pacer.turbo && !this._skip) return []; // (a skipped wait shows the cones it waits on)
    const b = this.beat && (this.beat.until == null || w.time <= this.beat.until) ? this.beat : null;
    const live = (e) => e && e.alive !== false && !e.removed && e.vision;
    const tags = b?.cones ?? this.step?.cones ?? null;
    if (tags) return tags.map((t) => w.enemies.find((e) => e.tag === t)).filter(live);
    const out = new Set();
    for (const r of this.step?.look || []) { if (typeof r === 'string') { const e = w.enemies.find((u) => u.tag === r); if (live(e)) out.add(e); } }
    const a = this._actors()[0];
    if (a) {
      const near = w.enemies.filter(live).map((e) => [e, Math.hypot(e.x - a.x, e.z - a.z) - (e.vision.far ?? 20)]).filter(([, d]) => d < 6).sort((p, q) => p[1] - q[1]);
      for (const [e] of near.slice(0, 3)) out.add(e);
    }
    return [...out];
  }

  /** The free part of the view (view px) for the director: below the bar, above the caption, clear of the HUD. */
  safeRect() {
    const now = performance.now();
    if (this._safe && now - this._safeAt < 300) return this._safe;
    this._safeAt = now;
    const cc = this.game.cameraController;
    const canvas = this.game.renderer?.domElement?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const W = cc?.width || innerWidth, H = cc?.height || innerHeight;
    const ox = canvas.left + (cc?.rect?.x || 0), oy = canvas.top + (cc?.rect?.y || 0);
    let top = Math.max(0, this.game.cameraRig?.hudTop?.() || 0);
    const bar = rectOf(this._ui);
    if (bar) top = Math.max(top, bar.bottom - oy);
    const menu = this._menu && rectOf(this._menu);
    let bottom = 0;
    const cap = this.captions && rectOf(this._cap);
    if (cap) bottom = Math.max(bottom, H - (cap.top - oy));
    const hr = rectOf('.hud-right');
    const right = hr ? Math.max(0, W - (hr.left - ox)) : 0;
    const hb = rectOf('.hud-right-bottom');
    const block = hb ? { x: hb.left - ox, y: hb.top - oy, w: hb.width, h: hb.height } : null;
    let r = freeRect({ width: W, height: H, top: top + 6, bottom: bottom + 6, left: 6, right: right + 6, block });
    if (menu && menu.left - ox < r.x + r.w / 2) r = { ...r, x: Math.min(r.x + r.w - 120, menu.right - ox + 6), w: Math.max(120, r.x + r.w - (menu.right - ox + 6)) };
    this._safe = r;
    return r;
  }

  // ------------------------------------------------------------ controls

  togglePause() {
    if (this._introOn) { this._endIntro(); return; }
    this.pacer.paused = !this.pacer.paused;
    this.pacer.budget = 0;
    this._syncBar();
  }

  setPaused(on) {
    if (!!on !== this.pacer.paused) this.togglePause();
  }

  /** A fixed speed (leaves AUTO). */
  setSpeed(s) {
    this._endSkip();
    const was = this.auto;
    this.auto = false;
    this.pacer.setSpeed(s);
    this._fixedSpeed = this.pacer.speed;
    if (was) this.pacer.boost = 1;
    this._syncBar();
    this.onSpeed?.(this.pacer.speed);
  }

  /** AUTO on (the speed follows the action) or off (back to the last fixed speed). */
  setAuto(on) {
    on = !!on;
    if (on === this.auto) return;
    if (!on) { this.setSpeed(this._fixedSpeed); return; }
    const from = this.rate;
    this._fixedSpeed = this.pacer.speed;
    this.auto = true;
    this.pacer.setSpeed(1);
    this.autoPace.reset(from); // (eases on from the speed it was playing at)
    this.pacer.boost = this.autoPace.rate;
    this._syncBar();
    this.onSpeed?.('auto');
  }

  setCaptions(on) {
    this.captions = !!on;
    if (this._cap) this._cap.hidden = !this.captions;
    this._safe = null;
    this._syncBar();
  }

  setSkipWaits(on) {
    this.skipWaits = !!on;
    if (!this.skipWaits && !this.auto) this.pacer.boost = 1;
    this._syncBar();
  }

  /** Free camera (the director lets go: the user scrolls, drags, zooms) or the director back on. */
  setFree(on) {
    this.director.setOn(!on);
    if (on) this._flashMsg('Free camera: look around. Press CAM (F) to give the camera back to the director.');
    this._syncBar();
  }

  // ------------------------------------------------------------ the timeline (time scrub)

  /** The measured timeline kept between viewings ({total, marks: [{kind, id, t}]}), or a fresh one. */
  _tlLoad() {
    try {
      const v = JSON.parse(localStorage.getItem(`ss-wt-timeline:${this.sol.id}`) || 'null');
      if (v && Array.isArray(v.marks)) {
        const marks = v.marks.filter((m) => m && Number.isFinite(m.t));
        // (a stored length under a point the run demonstrably reached cannot be a complete run's length —
        // it is a partial viewing's clock, kept from before the guard above: this play measures its own)
        const total = Number.isFinite(v.total) && marks.every((m) => m.t <= v.total) ? v.total : null;
        return { total, marks };
      }
    } catch { /* no storage: this play measures its own */ }
    return { total: null, marks: [] };
  }

  _tlSave() {
    try { localStorage.setItem(`ss-wt-timeline:${this.sol.id}`, JSON.stringify(this._tl)); } catch { /* private mode */ }
  }

  /** A point of the run was reached: its time joins the timeline (the run is deterministic: the same every play). */
  _tlMark(kind, id, t) {
    if (!Number.isFinite(t) || !id) return;
    const m = this._tl.marks.find((x) => x.kind === kind && x.id === id);
    if (m) { if (m.t === t) return; m.t = t; } else this._tl.marks.push({ kind, id, t });
    this._tlSave();
  }

  /** The bar's length: the measured run, or (during a first play) the furthest point reached so far. */
  tlTotal() {
    let max = this.world?.time || 0;
    for (const m of this._tl.marks) max = Math.max(max, m.t);
    return this._tl.total ?? max;
  }

  /**
   * Scrub to sim time `t` (seconds): ahead → fast-forward from here; behind → the mission reloads and
   * fast-forwards, as a chapter jump back does. `pause` says whether to be paused on arrival (the default
   * keeps the state the scrub started from). @returns {boolean} the scrub started (or was already there)
   */
  seekTo(t, { pause = this.paused } = {}) {
    if (this.stopped || this.finished || !Number.isFinite(t)) return false;
    t = Math.max(0, this._tl.total != null ? Math.min(t, this._tl.total) : t);
    this._showMenu(false);
    this.hold = null;
    if (this._introOn) this._endIntro(true);
    if (t < this.world.time - this.simDt) {
      if (!this.onJumpBack) return false;
      if (this._seekBackSent) return true; // (the reload is already on its way)
      this._seekBackSent = true;
      showRewind(this.game, fmtTime(t));
      this.onJumpBack({ kind: 'time', t, pause: !!pause }, this.settings);
      return true;
    }
    if (t <= this.world.time) return true; // (already there)
    if (this._skip) { this.turboViewMs = this._skip.viewMs; this._skip = null; document.getElementById('wt-skip')?.remove(); } // (a scrub supersedes a skipped wait)
    this.toMarker = null;
    this._seekT = t;
    this._seekPause = !!pause;
    this.pacer.turboMs = WALK_SEEK_TURBO_MS;
    this.pacer.setTurbo(true);
    this.pacer.paused = false;
    this._syncBar();
    this._syncTimeline();
    return true;
  }

  /** Scrub `dt` seconds from here (the ← / → keys, the −1s / +1s buttons). */
  seekBy(dt) { return this.seekTo(this.world.time + dt); }

  /** A time fast-forward landed: the jump's state clears, the normal play (or the pause) resumes. */
  _seekDone() {
    const pause = this._seekPause;
    this._seekT = null;
    this._seekPause = false;
    this.pacer.turboMs = this._turboMsBase;
    this.pacer.setTurbo(false);
    this._jumpFrom = null;
    this._cardDeferred = false;
    this._autoReset(1);
    this._camCut = true;
    this.stepWall = performance.now();
    if (pause) { this.pacer.paused = true; this.pacer.budget = 0; }
    this._syncBar();
    this._syncTimeline();
  }

  /** The timeline row follows the clock; a drag previews its landing time in the clock without seeking yet. */
  _syncTimeline() {
    const track = this._tlTrack;
    if (!track) return;
    const total = this.tlTotal();
    const now = this._tlDragT ?? this.world.time;
    const f = total > 0 ? Math.max(0, Math.min(1, now / total)) : 0;
    if (this._tlFill) {
      this._tlFill.style.width = `${(f * 100).toFixed(2)}%`;
      this._tlFill.classList.toggle('seeking', this._seekT != null);
    }
    if (this._tlClock) this._tlClock.textContent = `${fmtTime(now)} / ${this._tl.total != null ? fmtTime(this._tl.total) : '–:––'}`;
    track.dataset.time = String(Math.floor(this.world.time));
    track.dataset.total = this._tl.total != null ? String(this._tl.total) : '';
    const key = `${total.toFixed(1)}|${this._tl.marks.length}|${this._tl.total != null ? 1 : 0}`;
    if (key !== this._tlKey) {
      this._tlKey = key;
      track.querySelectorAll('.wt-tl-mark').forEach((n) => n.remove());
      if (total > 0) for (const m of this._tl.marks) {
        const d = el('div', `wt-tl-mark${m.kind === 'stage' ? ' stage' : ''}`, track);
        d.style.left = `${(Math.max(0, Math.min(1, m.t / total)) * 100).toFixed(2)}%`;
        d.title = `${m.id} · ${fmtTime(m.t)}`;
      }
    }
  }

  /** Jump to a marker: ahead → fast-forward from here; behind → the mission reloads and fast-forwards. */
  jumpTo(m) {
    const i = this._markerIdx(m);
    if (i < 0 || this.stopped) return false;
    this._showMenu(false);
    this.hold = null;
    if (this._skip) { this.turboViewMs = this._skip.viewMs; this._skip = null; this.pacer.setTurbo(false); document.getElementById('wt-skip')?.remove(); } // (a jump supersedes a skipped wait)
    this._seekT = null; // (a marker jump supersedes a scrub in flight)
    this.pacer.turboMs = this._turboMsBase;
    if (this._introOn) this._endIntro(true);
    if (i > this.markerIndex) {
      this.toMarker = { kind: m.kind, id: m.id };
      this._jumpFrom = this.markerIndex;
      this.pacer.setTurbo(true);
      this.pacer.paused = false;
      this._syncBar();
      return true;
    }
    if (this.onJumpBack) showRewind(this.game, m.id);
    this.onJumpBack?.({ kind: m.kind, id: m.id }, this.settings);
    return true;
  }

  jumpChapter(id) {
    return this.jumpTo({ kind: 'stage', id });
  }

  /** Jump to the start of step `i` (index in wt.steps). */
  jumpStep(i) {
    const m = this.startMarkerOf(i);
    return m ? this.jumpTo(m) : false;
  }

  nextStep() {
    if (!this.wt.steps.length) { const k = this.wt.chapters.findIndex((c) => c.id === this.chapterId); const c = this.wt.chapters[k + 1]; return c ? this.jumpChapter(c.id) : false; }
    if (this.hold && this._held()) { this.hold = null; return true; } // a chapter card: on with the play
    const i = this.stepIndex;
    return this.jumpStep(Math.max(0, i + 1));
  }

  /** Back to the start of this step, or (within its first seconds) of the previous one. */
  prevStep() {
    if (!this.wt.steps.length) { const k = this.wt.chapters.findIndex((c) => c.id === this.chapterId); const c = this.wt.chapters[Math.max(0, (performance.now() - this.stepWall > 4000) ? k : k - 1)]; return c ? this.jumpChapter(c.id) : false; }
    const i = Math.max(0, this.stepIndex);
    const into = (performance.now() - this.stepWall) / 1000;
    return this.jumpStep(into > 4 || i === 0 ? i : i - 1);
  }

  exit() {
    this.stop();
    this.onExit?.();
  }

  /** Desktop keys (DebugMode routes them here while the walkthrough runs). @returns {boolean} consumed */
  key(e) {
    const k = e.code;
    if (k === 'Escape') { if (this._menu) this._showMenu(false); else if (this._introOn) this._endIntro(); else this.exit(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const map = {
      Space: () => this.togglePause(), KeyP: () => this.togglePause(), KeyN: () => this.nextStep(), KeyB: () => this.prevStep(),
      Digit1: () => this.setSpeed(0.5), Digit2: () => this.setSpeed(1), Digit3: () => this.setSpeed(2), Digit4: () => this.setSpeed(4),
      Digit5: () => this.setAuto(!this.auto), KeyA: () => this.setAuto(!this.auto),
      KeyW: () => this.setSkipWaits(!this.skipWaits), KeyC: () => this.setCaptions(!this.captions), KeyF: () => this.setFree(!this.free),
      KeyL: () => this._showMenu(!this._menu),
    };
    if (map[k]) { if (!e.repeat) map[k](); return true; }
    // (← / → scrub the run: a second at a time, ten with Shift; a free camera keeps its scroll keys)
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !this.free) { this.seekBy((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); return true; }
    if (/^Arrow/.test(k) && !this.free) { this.setFree(true); return false; } // arrows scroll: the user takes the camera
    return false;
  }

  // ------------------------------------------------------------ intro / chapter cards

  _intro() {
    this._introOn = true;
    this.hold = { until: performance.now() + 1e9, kind: 'intro' };
    const m = this.game.missionDef;
    const n = m?.id?.match(/^m(\d\d)$/) ? `Mission ${+m.id.slice(1)}` : (m?.id || '').toUpperCase();
    const chapters = this.wt.chapters.length;
    showCard({
      kind: 'intro', kicker: 'SHADOW SIX · WALKTHROUGH', title: `${n} · ${this.wt.title}`,
      paras: [this.wt.intro || m?.briefing?.objectivesSummary || '', `${chapters} chapters${this.wt.steps.length ? `, ${this.wt.steps.length} steps` : ''}. The solution plays live in the game: pause, change the speed (AUTO paces it like a film), skip to any step.`],
      actions: [['▶ Start', () => this._endIntro(), true], ['Chapters', () => { this._endIntro(true); this.setPaused(true); this._showMenu(true); }], ['Exit', () => this.exit()]],
    });
    if (!this.introWait) this._introTimer = setTimeout(() => { if (this._introOn) this._endIntro(); }, 9000);
  }

  _endIntro(silent = false) {
    if (!this._introOn) return;
    this._introOn = false;
    clearTimeout(this._introTimer);
    closeCard();
    this.hold = null;
    if (!silent && this.chapterId) this._chapterCard();
    this._syncBar();
  }

  /** The title card, a chapter card held on screen, or a jump's fast-forward: nothing plays that a 20–40 ms frame
   *  would show (a jump to a later chapter drains the queue on its way: the bodies built ahead are there when it lands). */
  _stillScreen() {
    return this.pacer.turbo || this._introOn || (this.hold?.kind === 'chapter' && this._held());
  }

  _chapterCard() {
    const c = this.wt.chapters.find((x) => x.id === this.chapterId);
    if (!c) return;
    this.hold = { until: performance.now() + Math.min(5200, 2400 + (c.say || '').length * 22), kind: 'chapter' };
    this._capKey = null;
  }

  _flashMsg(text, ms = 3500) {
    installStyle();
    let f = document.getElementById('wt-flash');
    if (!f) { f = el('div', null, document.body); f.id = 'wt-flash'; }
    f.textContent = text;
    const bar = rectOf(this._ui);
    f.style.top = `${Math.round((bar?.bottom ?? 60) + 8)}px`;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => f.remove(), ms);
  }

  // ------------------------------------------------------------ UI

  _buildUi() {
    installStyle();
    const bar = el('div', null, document.body);
    bar.id = 'wt-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Walkthrough');
    bar.dataset.mission = this.sol.id;
    guard(bar);
    const btn = (parent, act, label, title, fn) => {
      const b = el('button', null, parent, label);
      b.type = 'button';
      b.dataset.act = act;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const tr = el('div', 'wt-grp', bar);
    btn(tr, 'exit', '✕', 'Exit the walkthrough to the debug menu (Esc)', () => this.exit());
    btn(tr, 'prev', '⏮', 'Previous step (B)', () => this.prevStep());
    btn(tr, 'play', '❚❚', 'Pause / play (Space)', () => this.togglePause());
    btn(tr, 'next', '⏭', 'Next step (N)', () => this.nextStep());
    btn(tr, 'chapters', '☰', 'Chapters and steps (L)', () => this._showMenu(!this._menu));
    const sp = el('div', 'wt-grp', bar);
    for (const [s, k] of [[0.5, 1], [1, 2], [2, 3], [4, 4]]) btn(sp, `speed-${s}`, `${s === 0.5 ? '½' : s}×`, `Play at ${s}× speed (${k})`, () => this.setSpeed(s));
    // (AUTO over the speed it plays at: as narrow as a speed button, so the bar keeps its rows on a phone)
    this._autoBtn = btn(sp, 'speed-auto', '', 'AUTO speed: fast through walks and waits, slow for the moments that matter (5 / A)', () => this.setAuto(!this.auto));
    el('span', 'wt-k', this._autoBtn, 'AUTO');
    this._autoVal = el('span', 'wt-v', this._autoBtn, '');
    const op = el('div', 'wt-grp', bar);
    btn(op, 'skip', '⏩', 'Skip waits: idle stretches play up to 4× faster (W; fixed speeds: AUTO paces the waits itself)', () => this.setSkipWaits(!this.skipWaits));
    btn(op, 'cc', 'CC', 'Captions on / off (C)', () => this.setCaptions(!this.captions));
    btn(op, 'cam', 'CAM', 'Director camera on / off: off = free camera (F)', () => this.setFree(!this.free));
    // the scrub row: the run's measured timeline — drag (or click) to any moment, −1s / +1s to step
    const tl = el('div', null, bar);
    tl.id = 'wt-tl';
    const tlBtn = (label, title, fn) => {
      const b = el('button', null, tl, label);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    tlBtn('−1s', 'Step back 1 second (←; with Shift: 10 seconds)', () => this.seekBy(-1));
    this._tlClock = el('span', 'wt-tl-clock', tl, '0:00 / –:––');
    const track = el('div', null, tl);
    track.id = 'wt-tl-track';
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Timeline: drag to scrub through the run');
    this._tlFill = el('div', null, track);
    this._tlFill.id = 'wt-tl-fill';
    this._tlTrack = track;
    tlBtn('+1s', 'Step forward 1 second (→; with Shift: 10 seconds)', () => this.seekBy(1));
    // (a drag previews its landing time in the clock; the scrub itself starts on release — one jump, not a storm)
    const fracOf = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))); };
    let dragOn = false;
    track.addEventListener('pointerdown', (e) => { e.stopPropagation(); dragOn = true; track.setPointerCapture?.(e.pointerId); this._tlDragT = fracOf(e) * this.tlTotal(); this._syncTimeline(); });
    track.addEventListener('pointermove', (e) => { if (!dragOn) return; this._tlDragT = fracOf(e) * this.tlTotal(); this._syncTimeline(); });
    track.addEventListener('pointerup', (e) => { if (!dragOn) return; dragOn = false; const t = fracOf(e) * this.tlTotal(); this._tlDragT = null; this.seekTo(t); });
    track.addEventListener('pointercancel', () => { dragOn = false; this._tlDragT = null; this._syncTimeline(); });
    this._ui = bar;
    const cap = el('div', null, document.body);
    cap.id = 'wt-cap';
    cap.setAttribute('aria-live', 'polite');
    guard(cap);
    cap.addEventListener('click', () => { if (this._held() && this.hold?.kind === 'chapter') this.hold = null; });
    cap.hidden = !this.captions;
    this._cap = cap;
    // a drag or the wheel over the map takes the camera (free camera); the director comes back with CAM
    const canvas = this.game.renderer?.domElement;
    if (canvas) {
      let down = null;
      const pd = (e) => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
      const pm = (e) => { if (down && e.pointerId === down.id && !this.free && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) { down = null; this.setFree(true); } };
      const pu = () => { down = null; };
      const wh = () => { if (!this.free) this.setFree(true); };
      canvas.addEventListener('pointerdown', pd, true);
      window.addEventListener('pointermove', pm, true);
      window.addEventListener('pointerup', pu, true);
      canvas.addEventListener('wheel', wh, { capture: true, passive: true });
      this._domOffs = [() => canvas.removeEventListener('pointerdown', pd, true), () => window.removeEventListener('pointermove', pm, true),
        () => window.removeEventListener('pointerup', pu, true), () => canvas.removeEventListener('wheel', wh, { capture: true })];
    }
    this._onResize = () => { this._layout(); this._safe = null; };
    window.addEventListener('resize', this._onResize);
    this._layout();
    this._syncBar();
    this._syncTimeline();
    this._layoutT = setInterval(() => this._layout(), 500); // the HUD settles / rotates
  }

  /** Bar under the HUD's top bar, caption at the bottom clear of the HUD's corners. */
  _layout() {
    const bar = this._ui, cap = this._cap;
    if (!bar || !cap) return;
    const vw = innerWidth, vh = innerHeight;
    const top = rectOf('.hud-topbar');
    const hr = rectOf('.hud-right');
    const rightEdge = hr ? hr.left - 6 : vw - 6;
    bar.style.top = `${Math.round((top ? top.bottom : 0) + 4)}px`;
    bar.style.maxWidth = `${Math.round(Math.max(200, rightEdge - 6))}px`; // (wraps rather than cover the notebook)
    const bw = bar.getBoundingClientRect().width;
    bar.style.left = `${Math.round(Math.max(6, Math.min((vw - bw) / 2, rightEdge - bw)))}px`;
    this._cardShift();
    const hb = rectOf('.hud-right-bottom');
    const menuBtn = rectOf('.touch-menu');
    let left = 8, right = vw - 8, bottom = 8;
    if (menuBtn && menuBtn.top > vh * 0.6) left = Math.max(left, menuBtn.right + 8);
    if (hb && hb.left - left >= 300) right = Math.min(right, hb.left - 8);
    else if (hb) { bottom = vh - hb.top + 6; left = 8; }
    // the debug stats (bottom left: minimized by default in video mode, or expanded): beside it, else above it
    const dbg = rectOf('#dbg-info');
    if (dbg) {
      const capH = cap.getBoundingClientRect().height || 60;
      if (dbg.bottom > vh - bottom - capH - 4 && dbg.top < vh - bottom) {
        if (right - (dbg.right + 8) >= 300) left = Math.max(left, dbg.right + 8);
        else bottom = Math.max(bottom, vh - dbg.top + 6);
      }
    }
    const w = Math.min(780, right - left);
    cap.style.width = `${Math.round(w)}px`;
    cap.style.left = `${Math.round(left + (right - left - w) / 2)}px`;
    cap.style.bottom = `calc(${Math.round(bottom)}px + env(safe-area-inset-bottom))`;
    if (this._menu) this._placeMenu();
  }

  /** The HUD's speaker card (top left, while a man talks) goes below the bar where they would overlap (phones). */
  _cardShift() {
    const card = document.querySelector('.hud-speaker-card'), bar = this._ui;
    if (card && bar) {
      // (screen rects: the HUD is scaled; the card's own top is its rect less the shift already applied)
      const b = bar.getBoundingClientRect(), r = card.getBoundingClientRect();
      const cur = parseFloat(document.body.style.getPropertyValue('--wt-card-shift')) || 0;
      const top0 = r.top - cur;
      const over = r.width > 0 && r.left < b.right && r.right > b.left && top0 < b.bottom;
      const shift = over ? Math.round(b.bottom + 4 - top0) : 0;
      if (shift !== cur) document.body.style.setProperty('--wt-card-shift', `${shift}px`);
    }
  }

  _syncBar() {
    const bar = this._ui;
    if (!bar) return;
    for (const s of WALK_SPEEDS) bar.querySelector(`[data-act="speed-${s}"]`)?.setAttribute('aria-pressed', String(!this.pacer.turbo && !this.auto && this.pacer.speed === s));
    bar.querySelector('[data-act=speed-auto]')?.setAttribute('aria-pressed', String(this.auto && (!this.pacer.turbo || !!this._skip)));
    const skip = bar.querySelector('[data-act=skip]');
    if (skip && skip.hidden !== this.auto) { skip.hidden = this.auto; this._safe = null; } // (AUTO paces the waits itself)
    const p = bar.querySelector('[data-act=play]');
    if (p) { p.textContent = this.paused ? '▶' : '❚❚'; p.setAttribute('aria-pressed', String(this.paused)); }
    bar.querySelector('[data-act=skip]')?.setAttribute('aria-pressed', String(this.skipWaits));
    bar.querySelector('[data-act=cc]')?.setAttribute('aria-pressed', String(this.captions));
    bar.querySelector('[data-act=cam]')?.setAttribute('aria-pressed', String(!this.free));
    bar.querySelector('[data-act=chapters]')?.setAttribute('aria-pressed', String(!!this._menu));
    Object.assign(bar.dataset, { speed: String(this.speedSetting), auto: this.auto ? '1' : '0', paused: this.paused ? '1' : '0', ff: this.pacer.turbo && !this._skip ? '1' : '0', wait: this._skip ? '1' : '0',
      free: this.free ? '1' : '0', cc: this.captions ? '1' : '0', skip: this.skipWaits ? '1' : '0' });
    this._autoLabel(true);
  }

  _caption() {
    const cap = this._cap;
    if (!cap) return;
    if (this._wasPaused !== this.paused) { this._wasPaused = this.paused; this._syncBar(); }
    if (this._lastFF !== this.pacer.turbo) { this._lastFF = this.pacer.turbo; this._syncBar(); }
    const now = performance.now();
    if (!this._cardAt || now - this._cardAt > 150) { this._cardAt = now; this._cardShift(); } // (it moves to the speaker)
    if (this._capAt && now - this._capAt < 100) return;
    this._capAt = now;
    this._syncTimeline();
    // (while an action is watched to its end, its step stays on screen: the next one starts after it)
    const hd = this.holdNow();
    const st = hd?.meta?.step && hd.meta.step !== this.step ? hd.meta.step : this.step;
    const chId = st === this.step ? this.chapterId : hd.meta.chapterId ?? this.chapterId;
    const wt = this.wt, ch = wt.chapters.find((c) => c.id === chId);
    const chapterMode = this._held() && this.hold?.kind === 'chapter' && ch;
    const n = wt.steps.length;
    let pos = st ? `${st.cp} · ${wt.steps.indexOf(st) + 1}/${n}` : ch ? `${ch.id}` : '';
    pos += ` · ${fmtTime(this.world.time)}`;
    let status = '';
    if (this._skip) status = `⏩ waiting: ${waitText(this._skip.label)}`;
    else if (this.pacer.turbo) {
      if (this._seekT != null) {
        status = `⏩ jumping to ${fmtTime(this._seekT)}`;
        cap.dataset.progress = String(Math.max(0, Math.min(1, this.world.time / Math.max(1, this._seekT))));
      } else {
        const target = this.toMarker ? this._markerIdx(this.toMarker) : -1;
        status = `⏩ jumping to ${this.toMarker?.id ?? ''}`;
        cap.dataset.progress = target > 0 ? String(Math.max(0, Math.min(1, (this.markerIndex + 1) / (target + 1)))) : '0';
      }
    } else if (this.paused) status = '❚❚ paused';
    else if (!this.auto && this.pacer.boost > 1.05) status = `⏩ waiting ×${(this.pacer.speed * this.pacer.boost).toFixed(1)}`;
    const head = ch ? `${ch.id} · ${ch.title}` : this.stage ? `${this.stage.id} · ${this.stage.title}` : 'Walkthrough';
    let say, who = [];
    if (chapterMode) say = ch.say || '';
    else if (st === this.step && this.beat?.say) { say = this.beat.say; who = st?.who || []; }
    else if (st) { say = st.say; who = st.who; }
    else say = this.lastOrder || '';
    // AUTO: a new caption is read at no more than 2.5×, from when it shows with the clock running (a card holds the clock
    // itself; a fast-forward's captions are not read)
    if (st && !this._held() && !this.pacer.turbo && say !== this._readSay) { this._readSay = say; this._readUntil = performance.now() + readTime(say) * 1000; }
    const key = [head, pos.replace(/ · \d+:\d\d$/, ''), status, say, who.join(), chapterMode ? 1 : 0, Math.floor(this.world.time)].join('|');
    if (key === this._capKey) return;
    this._capKey = key;
    cap.className = chapterMode ? 'chapter' : '';
    cap.dataset.step = st?.cp || '';
    cap.dataset.chapter = chId || '';
    cap.dataset.mode = chapterMode ? 'chapter' : this._skip ? 'wait' : this.pacer.turbo ? 'jump' : 'step';
    cap.textContent = '';
    const h = el('div', 'wt-head', cap);
    el('span', null, h, chapterMode ? `Chapter ${ch.id}` : head);
    const r = el('span', 'wt-pos', h);
    if (status) el('span', 'wt-ff', r, status + '  ');
    r.append(pos);
    if (chapterMode) el('span', 'wt-title', cap, ch.title);
    if (this.pacer.turbo && !this._skip) {
      el('div', 'wt-say', cap, 'Fast-forwarding through the solution to the chosen step…');
      const pg = el('div', 'wt-prog', cap);
      el('i', null, pg).style.width = `${Math.round(+cap.dataset.progress * 100)}%`;
      return;
    }
    for (const role of who) {
      const unit = ROLE_NAMES[role] ? null : this.world.commandos.find((c) => c.role === role);
      const chip = el('span', 'wt-who', cap, ROLE_NAMES[role] || unit?.nickname || unit?.name || role);
      chip.style.background = ROLE_COLORS[role] || '#ddd';
    }
    el('span', 'wt-say', cap, say);
  }

  _showMenu(on) {
    if (!on) {
      this._menu?.remove();
      this._menu = null;
      this._safe = null;
      this._syncBar();
      return;
    }
    if (this._menu) return;
    const box = el('div', null, document.body);
    box.id = 'wt-menu';
    box.setAttribute('role', 'menu');
    guard(box);
    this._menu = box;
    this._renderMenu();
    this._placeMenu();
    this._safe = null;
    this._syncBar();
    (box.querySelector('.now') || box.querySelector('button'))?.focus?.({ preventScroll: true });
    box.querySelector('.now')?.scrollIntoView?.({ block: 'center' });
  }

  _placeMenu() {
    const box = this._menu, bar = rectOf(this._ui);
    if (!box) return;
    const vw = innerWidth, vh = innerHeight;
    const top = (bar?.bottom ?? 60) + 6;
    const cap = this.captions ? rectOf(this._cap) : null;
    const bottom = Math.max(top + 160, (cap && cap.left < vw / 2 + 200 ? cap.top : vh) - 8);
    const w = Math.min(440, vw - 12);
    box.style.top = `${Math.round(top)}px`;
    box.style.width = `${Math.round(w)}px`;
    box.style.left = `${Math.round(Math.max(6, Math.min((bar?.left ?? 6), vw - w - 6)))}px`;
    box.style.maxHeight = `${Math.round(Math.min(vh - top - 6, bottom - top))}px`;
  }

  _renderMenu() {
    const box = this._menu;
    if (!box) return;
    box.textContent = '';
    const wt = this.wt, cur = this.step;
    const chIdx = wt.chapters.findIndex((c) => c.id === this.chapterId);
    wt.chapters.forEach((c, ci) => {
      const b = el('button', `wt-ch${ci < chIdx ? ' done' : ''}`, box);
      b.type = 'button';
      b.dataset.chapter = c.id;
      b.setAttribute('role', 'menuitem');
      el('b', null, b, c.id);
      b.append(c.title);
      if (c.say) el('small', null, b, c.say);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.jumpChapter(c.id); });
      for (const s of wt.steps) {
        if (s.chapter !== c.id) continue;
        const i = wt.steps.indexOf(s);
        const done = this.doneCps.includes(s.cp) && s !== cur;
        const sb = el('button', `wt-st${done ? ' done' : ''}${s === cur ? ' now' : ''}`, box);
        sb.type = 'button';
        sb.dataset.step = s.cp;
        sb.setAttribute('role', 'menuitem');
        el('b', null, sb, s.cp);
        sb.append(s.say.length > 74 ? `${s.say.slice(0, 72)}…` : s.say);
        sb.addEventListener('click', (e) => { e.stopPropagation(); this.jumpStep(i); });
      }
    });
  }

  _renderSteps() { this._renderMenu(); }

  _camera() { /* the director (walkthrough-director.js) runs from _frame */ }

  _release() {
    if (this._released) return;
    super._release();
    clearTimeout(this._introTimer);
    clearInterval(this._layoutT);
    document.body.style.removeProperty('--wt-card-shift');
    window.removeEventListener('resize', this._onResize);
    for (const off of this._domOffs || []) off();
    for (const off of this._offs || []) off?.();
    this._menu?.remove();
    this._menu = null;
    document.getElementById('wt-flash')?.remove();
    document.getElementById('wt-skip')?.remove();
    if (this._introOn) { this._introOn = false; closeCard(); }
    this.director.detach();
    this.sensor.detach();
    this.pacer.boost = 1;
  }
}

/** The closing card after the run: the result, then watch again / chapters / exit. */
export function endCard(wk, res, { onAgain, onExit } = {}) {
  const w = wk.world, won = res?.state === 'won';
  const kills = (wk.driver?.events || []).filter((e) => e.name === 'unit:killed').length;
  const exp = wk.driver?.exposures?.().length;
  const list = (w?.objectives || []).map((o) => `${o.done ? '✔' : '✘'} ${o.text}`);
  return showCard({
    kind: 'end', kicker: won ? 'WALKTHROUGH COMPLETE' : 'WALKTHROUGH STOPPED', title: won ? 'Mission complete' : `Stopped: ${res?.error || res?.state || ''}`,
    paras: [won ? wk.wt.outro : '', `Game time ${fmtTime(res?.time ?? w?.time ?? 0)} · detections ${res?.detections ?? '?'}${exp != null ? ` · seen in a cone ${exp}` : ''} · enemies killed ${kills}`],
    list,
    actions: [['Watch again', onAgain, true], ['Exit', onExit]],
  });
}
