/**
 * Debug VIDEO MODE ("Watch walkthrough"): a mission's saved solution played live in the real game as a guided film.
 * The engine is the SOLUTION replay's (debug/solution-replay.js: the same driver, the same player orders, the clock
 * granted tick by tick); on top of it:
 *  - a camera director (debug/walkthrough-director.js) that frames the acting commando with what matters to the step
 *    — his target, the guard he slips past and that guard's cone, the objective, the charge about to blow — in the
 *    part of the screen the walkthrough's UI and the HUD leave free;
 *  - narration from tools/solutions/<id>.walkthrough.mjs (docs/walkthrough-format.md): a chapter card at each stage,
 *    a caption per step saying who does what and why, finer beats on live events;
 *  - controls: play / pause, 0.5× / 1× / 2× / 4×, skip waits (idle stretches run up to 4× faster), previous / next
 *    step and a chapter list (forward = fast-forward from here; back = the mission reloaded and fast-forwarded, the
 *    run being deterministic), captions on / off, free camera (the director lets go until it is switched back on),
 *    exit to the debug menu. Desktop keys: Space, B / N, 1–4, W, C, F, L, Esc.
 * Nothing here touches the simulation: the camera, the drawn cones, the captions and the pacing of wall time only.
 * @module debug/walkthrough
 */

import { SolutionReplay } from './solution-replay.js';
import { normalizeWalkthrough, currentStep, orderAction, targetTag, matchOn, cpId } from './walkthrough-data.js';
import { Director, freeRect } from './walkthrough-director.js';
import { ROLE_NAMES } from '../ui/catalogue.js';

export const WALK_SPEEDS = Object.freeze([0.5, 1, 2, 4]);
/** Wall-clock ms of ticks per frame while jumping (fast-forward). */
export const WALK_TURBO_MS = 220;
/** Skip waits: the most the pace is raised while every commando waits. */
export const SKIP_BOOST = 4;
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
#wt-card button:hover,#wt-card button:focus-visible{outline:2px solid #ffcf4a}
#wt-card ul{list-style:none;padding:0;margin:8px 0;font-size:16px;line-height:1.6}
@media (max-height:480px){#wt-cap{font-size:14px;line-height:1.3;padding:5px 10px 7px}#wt-cap .wt-head{font-size:10px;margin-bottom:2px}
  #wt-cap.chapter .wt-title{font-size:17px;margin:0 0 2px}#wt-cap .wt-who{font-size:10px;padding:2px 5px}}
@media (max-width:480px){#wt-cap{font-size:15px;line-height:1.33}}
body.dbg-video .hud-speaker-card{transform:translateY(var(--wt-card-shift,0px))}
#wt-flash{position:fixed;z-index:8650;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.75);
  color:#ffe9a8;font:600 13px/1.3 system-ui,sans-serif;pointer-events:none;max-width:calc(100vw - 24px);text-align:center}
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

export class Walkthrough extends SolutionReplay {
  /**
   * @param {object} game the Game (mission freshly loaded, playing)
   * @param {object} sol loadSolution() result
   * @param {object|null} wtFile the mission's WALKTHROUGH (or null: chapters / captions from the solution itself)
   * @param {{speed?: number, toMarker?: {kind: string, id: string}|null, isFrozen?: () => boolean, onEnd?: Function,
   *   onSkip?: (marker: object, settings: object) => void, onExit?: () => void, captions?: boolean, skipWaits?: boolean,
   *   free?: boolean, intro?: boolean}} o  onSkip: reload + fast-forward to that marker (a jump back);
   *   intro: show the opening card (a fresh start)
   */
  constructor(game, sol, wtFile, o = {}) {
    super(game, sol, { ...o, speeds: WALK_SPEEDS, turboMs: o.turboMs ?? WALK_TURBO_MS, onSkip: null });
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
    this._jumpFrom = this.toMarker ? -1 : null;
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
  }

  // ------------------------------------------------------------ state

  get paused() { return this.pacer.paused || this.game.state === 'paused'; }
  get free() { return !this.director.on; }
  get stepIndex() { return this.step ? this.wt.steps.indexOf(this.step) : -1; }
  /** Settings a reload (jump back) carries over. */
  get settings() { return { speed: this.speed, captions: this.captions, skipWaits: this.skipWaits, free: this.free }; }

  _held() {
    return !!this.hold && !this.pacer.turbo && performance.now() < this.hold.until;
  }

  _animScale() {
    if (this.pacer.paused || this._held()) return 0;
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
    this.director.attach();
    if (this.showIntro) { this._introOn = true; this.hold = { until: performance.now() + 1e9, kind: 'intro' }; }
    const done = super.start(); // (runs the solution up to its first tick: stage A starts in here)
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
    super._onOrder(role, u, o);
    const tgt = o?.type === 'ability' && o.target && o.target !== u && typeof o.target === 'object' ? o.target : null;
    if (tgt && (Number.isFinite(tgt.x) || tgt.kind)) this._action = { u, t: tgt, until: this.world.time + 6 };
    this._event({ kind: 'order', role, action: orderAction(u, o), target: tgt ? targetTag(tgt) : null });
  }

  _onCheckpoint(cp) {
    const id = cpId(cp.name);
    if (!this.doneCps.includes(id)) this.doneCps.push(id);
    this._calm(2.5);
    this._marker('cp', id);
    super._onCheckpoint(cp);
    this._syncStep();
  }

  _onStage(id, title) {
    this.chapterId = id;
    this._marker('stage', id);
    super._onStage(id, title);
    this._syncStep();
    if (!this.pacer.turbo && !this._introOn) this._chapterCard();
  }

  _marker(kind, id) {
    const i = this._markerIdx({ kind, id });
    if (i >= 0) this.markerIndex = i;
    // a fast-forward whose marker never came (a checkpoint the solution sets only sometimes) ends at the next one
    const want = this.pacer.turbo ? this._markerIdx(this.toMarker) : -1;
    if (want >= 0 && i > want) { this.toMarker = null; this.pacer.setTurbo(false); this._fastForwardDone(kind, id); }
  }

  _fastForwardDone(kind) {
    this._jumpFrom = null;
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
        this._capKey = null;
        return;
      }
    }
  }

  _frame(dt) {
    super._frame(dt);
    if (this.stopped) return;
    this._pace(dt);
    this.director.update(dt);
  }

  /** Skip waits: while every commando waits (nobody moves or acts, nothing just happened) the pace rises to 4×. */
  _pace(dt) {
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
    let lead = units.includes(this.focus) ? this.focus : units[0] || this.focus || w.commandos.find((c) => c.alive);
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
    const zoom = cue?.zoom || this.step?.zoom;
    const frame = zoom === 'close' ? { minSpan: [10, 6], maxZoom: 1.7 } : zoom === 'wide' ? { minSpan: [30, 18] } : { minSpan: [16, 10] };
    const look = (cue?.look || []).map((r) => this.resolve(r)).filter(Boolean);
    if (cue?.shot && look.length) return { pts: look, must: 1, frame, pitch: this._pitch(look), cut };
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

  /** The guards whose cones are drawn now: the step's (or beat's) `cones`, else the ones that matter near the actor. */
  conesNow() {
    const w = this.world;
    if (this.pacer.turbo) return [];
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

  setSpeed(s) {
    this.pacer.setSpeed(s);
    this._syncBar();
  }

  setCaptions(on) {
    this.captions = !!on;
    if (this._cap) this._cap.hidden = !this.captions;
    this._safe = null;
    this._syncBar();
  }

  setSkipWaits(on) {
    this.skipWaits = !!on;
    if (!this.skipWaits) this.pacer.boost = 1;
    this._syncBar();
  }

  /** Free camera (the director lets go: the user scrolls, drags, zooms) or the director back on. */
  setFree(on) {
    this.director.setOn(!on);
    if (on) this._flashMsg('Free camera: look around. Press CAM (F) to give the camera back to the director.');
    this._syncBar();
  }

  /** Jump to a marker: ahead → fast-forward from here; behind → the mission reloads and fast-forwards. */
  jumpTo(m) {
    const i = this._markerIdx(m);
    if (i < 0 || this.stopped) return false;
    this._showMenu(false);
    this.hold = null;
    if (this._introOn) this._endIntro(true);
    if (i > this.markerIndex) {
      this.toMarker = { kind: m.kind, id: m.id };
      this._jumpFrom = this.markerIndex;
      this.pacer.setTurbo(true);
      this.pacer.paused = false;
      this._syncBar();
      return true;
    }
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
      KeyW: () => this.setSkipWaits(!this.skipWaits), KeyC: () => this.setCaptions(!this.captions), KeyF: () => this.setFree(!this.free),
      KeyL: () => this._showMenu(!this._menu),
    };
    if (map[k]) { if (!e.repeat) map[k](); return true; }
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
      paras: [this.wt.intro || m?.briefing?.objectivesSummary || '', `${chapters} chapters${this.wt.steps.length ? `, ${this.wt.steps.length} steps` : ''}. The solution plays live in the game: pause, change the speed, skip to any step.`],
      actions: [['▶ Start', () => this._endIntro(), true], ['Chapters', () => { this._endIntro(true); this.setPaused(true); this._showMenu(true); }], ['Exit', () => this.exit()]],
    });
    this._introTimer = setTimeout(() => { if (this._introOn) this._endIntro(); }, 9000);
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
    const op = el('div', 'wt-grp', bar);
    btn(op, 'skip', '⏩', 'Skip waits: idle stretches play up to 4× faster (W)', () => this.setSkipWaits(!this.skipWaits));
    btn(op, 'cc', 'CC', 'Captions on / off (C)', () => this.setCaptions(!this.captions));
    btn(op, 'cam', 'CAM', 'Director camera on / off: off = free camera (F)', () => this.setFree(!this.free));
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
    for (const s of WALK_SPEEDS) bar.querySelector(`[data-act="speed-${s}"]`)?.setAttribute('aria-pressed', String(!this.pacer.turbo && this.pacer.speed === s));
    const p = bar.querySelector('[data-act=play]');
    if (p) { p.textContent = this.paused ? '▶' : '❚❚'; p.setAttribute('aria-pressed', String(this.paused)); }
    bar.querySelector('[data-act=skip]')?.setAttribute('aria-pressed', String(this.skipWaits));
    bar.querySelector('[data-act=cc]')?.setAttribute('aria-pressed', String(this.captions));
    bar.querySelector('[data-act=cam]')?.setAttribute('aria-pressed', String(!this.free));
    bar.querySelector('[data-act=chapters]')?.setAttribute('aria-pressed', String(!!this._menu));
    Object.assign(bar.dataset, { speed: String(this.pacer.speed), paused: this.paused ? '1' : '0', ff: this.pacer.turbo ? '1' : '0',
      free: this.free ? '1' : '0', cc: this.captions ? '1' : '0', skip: this.skipWaits ? '1' : '0' });
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
    const wt = this.wt, st = this.step, ch = wt.chapters.find((c) => c.id === this.chapterId);
    const chapterMode = this._held() && this.hold?.kind === 'chapter' && ch;
    const n = wt.steps.length;
    let pos = st ? `${st.cp} · ${wt.steps.indexOf(st) + 1}/${n}` : ch ? `${ch.id}` : '';
    pos += ` · ${fmtTime(this.world.time)}`;
    let status = '';
    if (this.pacer.turbo) {
      const target = this.toMarker ? this._markerIdx(this.toMarker) : -1;
      status = `⏩ jumping to ${this.toMarker?.id ?? ''}`;
      cap.dataset.progress = target > 0 ? String(Math.max(0, Math.min(1, (this.markerIndex + 1) / (target + 1)))) : '0';
    } else if (this.paused) status = '❚❚ paused';
    else if (this.pacer.boost > 1.05) status = `⏩ waiting ×${(this.pacer.speed * this.pacer.boost).toFixed(1)}`;
    const head = ch ? `${ch.id} · ${ch.title}` : this.stage ? `${this.stage.id} · ${this.stage.title}` : 'Walkthrough';
    let say, who = [];
    if (chapterMode) say = ch.say || '';
    else if (this.beat?.say) { say = this.beat.say; who = st?.who || []; }
    else if (st) { say = st.say; who = st.who; }
    else say = this.lastOrder || '';
    const key = [head, pos.replace(/ · \d+:\d\d$/, ''), status, say, who.join(), chapterMode ? 1 : 0, Math.floor(this.world.time)].join('|');
    if (key === this._capKey) return;
    this._capKey = key;
    cap.className = chapterMode ? 'chapter' : '';
    cap.dataset.step = st?.cp || '';
    cap.dataset.chapter = this.chapterId || '';
    cap.dataset.mode = chapterMode ? 'chapter' : this.pacer.turbo ? 'jump' : 'step';
    cap.textContent = '';
    const h = el('div', 'wt-head', cap);
    el('span', null, h, chapterMode ? `Chapter ${ch.id}` : head);
    const r = el('span', 'wt-pos', h);
    if (status) el('span', 'wt-ff', r, status + '  ');
    r.append(pos);
    if (chapterMode) el('span', 'wt-title', cap, ch.title);
    if (this.pacer.turbo) {
      el('div', 'wt-say', cap, 'Fast-forwarding through the solution to the chosen step…');
      const pg = el('div', 'wt-prog', cap);
      el('i', null, pg).style.width = `${Math.round(+cap.dataset.progress * 100)}%`;
      return;
    }
    for (const role of who) {
      const chip = el('span', 'wt-who', cap, ROLE_NAMES[role] || role);
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
    if (this._introOn) { this._introOn = false; closeCard(); }
    this.director.detach();
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
