/**
 * Debug mode (`?debug`, `?debug=1`, `?debug=cones`, …): DEBUG LEVEL SELECT overlay (every mission of
 * missionList(), grouped BEL / BCD / test maps, keyboard + tap), inspection options (remembered in localStorage),
 * quick keys (F10 select, PageDown / PageUp next / previous level, Ctrl+R instant restart, F11 info HUD) and the
 * corner info HUD (mission; frame time, main-thread and render CPU, input → frame latency over a rolling 2 s / last 32
 * inputs; whole-frame draw calls and triangles; GPU memory from debug/gpu-mem-counter.js, three's object counts, JS heap;
 * cursor x/z, camera zoom / yaw: debug/debug-stats.js; a 15 s perf graph, debug/perf-graph.js; −/+ minimizes it to one
 * line), the SOLUTION replay
 * of missions with a saved solution (debug/solutions.js, debug/solution-replay.js: select section, in-game SOLUTION
 * button, F9; Esc stops it) and VIDEO MODE, the guided walkthrough of a solution (debug/walkthrough.js: the select's
 * "Watch walkthrough" section, the in-game ▶ VIDEO button, F8, `?debug&walkthrough=m03[&speed=4|auto]`, which is also what the
 * address bar shows in video mode, so it can be shared: the link opens on the title card, waiting for ▶ Start; Esc exits
 * to this menu).
 * main.js installs it only when the URL carries `debug`; nothing here exists otherwise. Pure logic: debug-options.js.
 * @module debug/debug-mode
 */

import {
  parseDebugParams, loadOptions, saveOptions, cycleOption, groupMissions, levelOrder, neighbourLevel, transformDef,
} from './debug-options.js';
import { getThumb, putThumb } from '../ui/thumbs.js';
import { hasSolution, solutionIds, loadSolution, loadCatalog, loadWalkthrough } from './solutions.js';
import { SolutionReplay } from './solution-replay.js';
import { RollingWindow, FrameDraws, InputLatency, statsLines } from './debug-stats.js';
import { installGpuMemCounter } from './gpu-mem-counter.js';
import { FrameSeries, GRAPH_SPAN, drawPerfGraph, compactLine } from './perf-graph.js';

/** Video mode is loaded on first use (a lazy chunk in the web build): nothing of it costs a normal debug session. */
const walkthroughModule = () => import('./walkthrough.js');
const closeCard = () => document.getElementById('wt-card')?.remove();
import { CONFIG } from '../config.js';

const THEATER_COLORS = {
  temperate: '#5f7a4a', snow: '#6f8599', coast: '#4f7c95', fjord: '#5d7f8f', desert: '#c49a5a', urban: '#857a6c', night: '#34446a',
};
const THEATER_ICONS = { temperate: '🌲', snow: '❄', coast: '⚓', fjord: '⛰', desert: '☀', urban: '🏛', night: '☾' };

const CSS = `
#dbg-select{position:fixed;inset:0;z-index:9000;overflow:auto;background:rgba(10,12,14,.94);color:#e8e2d0;
  font:14px/1.3 system-ui,sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px 24px;box-sizing:border-box}
#dbg-select h1{font:700 20px/1.2 system-ui,sans-serif;letter-spacing:.12em;margin:0 0 4px;color:#ffcf4a}
#dbg-select .dbg-hint{opacity:.7;margin:0 0 12px;font-size:12px}
#dbg-select h2{font:600 13px/1 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px;opacity:.85}
.dbg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.dbg-tile{all:unset;box-sizing:border-box;display:flex;flex-direction:column;min-height:64px;border-radius:6px;cursor:pointer;
  background:#22262a;border:2px solid transparent;overflow:hidden;touch-action:manipulation}
.dbg-tile:focus,.dbg-tile:hover{border-color:#ffcf4a;outline:none}
.dbg-tile.current{box-shadow:inset 0 0 0 2px #6fd36f}
.dbg-thumb{height:72px;background:var(--th,#555) center/cover no-repeat;position:relative}
.dbg-thumb span{position:absolute;left:6px;top:4px;font:700 22px/1 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000}
.dbg-thumb i{position:absolute;right:6px;top:4px;font-style:normal;font-size:16px;text-shadow:0 1px 3px #000}
.dbg-meta{padding:5px 7px 7px}
.dbg-meta b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dbg-meta small{opacity:.6;font-size:11px}
.dbg-opts{display:flex;flex-wrap:wrap;gap:6px}
.dbg-opt{all:unset;box-sizing:border-box;min-height:40px;padding:8px 12px;border-radius:20px;background:#2b3035;cursor:pointer;
  font-size:13px;touch-action:manipulation;border:2px solid transparent}
.dbg-opt[aria-pressed=true]{background:#5b4a14;color:#ffdf7a}
.dbg-opt:focus,.dbg-opt:hover{border-color:#ffcf4a}
.dbg-bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.dbg-act{all:unset;min-height:44px;padding:10px 18px;border-radius:6px;background:#3a4046;cursor:pointer;font-weight:600}
.dbg-act:focus,.dbg-act:hover{background:#4c545b}
/* the debug corner (DEBUG / ▶ SOL / ▶ VIDEO, the info HUD above them) on a 16 px gutter. With a finger the game's
   bottom-left touch stack (MENU, CANCEL, TURN: 10..122 px wide, up to 182 px high, styles/menus.css) keeps its place:
   the corner goes right of it (landscape) or above it (a phone held upright: the stance hand and the bag fill the
   bottom row) */
:root{--dbg-x:calc(16px + env(safe-area-inset-left));--dbg-y:calc(8px + env(safe-area-inset-bottom))}
html.mk-touch{--dbg-x:calc(130px + env(safe-area-inset-left))}
@media (orientation:portrait){html.mk-touch{--dbg-x:calc(16px + env(safe-area-inset-left));--dbg-y:calc(190px + env(safe-area-inset-bottom))}}
/* any narrow upright window: the bottom row is the stance hand and the bag (wide there), so above it as well */
@media (orientation:portrait) and (max-width:600px){:root{--dbg-y:calc(190px + env(safe-area-inset-bottom))}}
#dbg-info{position:fixed;left:var(--dbg-x);bottom:calc(var(--dbg-y) + 44px);z-index:8000;pointer-events:none;box-sizing:border-box;
  width:min(366px,calc(100vw - var(--dbg-x) - 16px - env(safe-area-inset-right)));padding:5px 8px;border-radius:4px;
  font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e4ffde;background:rgba(0,0,0,.4);
  text-shadow:0 1px 1px #000,0 0 3px rgba(0,0,0,.85)}
#dbg-info .dbg-txt{white-space:pre-wrap}
#dbg-info .dbg-graph{display:block;width:100%;height:72px;margin-top:4px}
/* −/+ : the only part of the panel that takes input (the game keeps every other click and tap) */
#dbg-info .dbg-tog{all:unset;position:absolute;top:3px;right:3px;box-sizing:border-box;width:26px;height:22px;pointer-events:auto;cursor:pointer;
  display:flex;align-items:center;justify-content:center;border-radius:3px;border:1px solid #d6ffd066;background:rgba(0,0,0,.35);
  color:#e4ffde;font:700 14px/1 system-ui,sans-serif;touch-action:manipulation}
#dbg-info .dbg-tog:hover{border-color:#ffcf4a;color:#ffcf4a}
/* minimized: one line; the whole pill is the + button */
#dbg-info.min{width:auto;max-width:calc(100vw - var(--dbg-x) - 16px - env(safe-area-inset-right));padding-right:34px;white-space:nowrap}
#dbg-info.min .dbg-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#dbg-info.min .dbg-graph{display:none}
#dbg-info.min .dbg-tog{top:0;right:0;bottom:0;left:0;width:auto;height:auto;justify-content:flex-end;padding-right:9px;border-color:transparent;background:none}
html.mk-touch #dbg-info .dbg-tog{width:44px;height:36px;top:2px;right:2px}
html.mk-touch #dbg-info.min{min-height:40px;display:flex;align-items:center;padding-right:44px}
html.mk-touch #dbg-info.min .dbg-tog{top:0;right:0;bottom:0;left:0;width:auto;height:auto}
#dbg-btn,#dbg-sol-btn{position:fixed;left:var(--dbg-x);bottom:var(--dbg-y);z-index:8001;min-width:56px;min-height:36px;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:.1em;color:#ffcf4a;background:rgba(0,0,0,.6);border:1px solid #ffcf4a88;
  border-radius:4px;cursor:pointer;touch-action:manipulation}
#dbg-sol-btn{left:calc(var(--dbg-x) + 64px);min-width:44px;color:#9fe39a;border-color:#9fe39a88}
#dbg-wt-btn{position:fixed;left:calc(var(--dbg-x) + 122px);bottom:var(--dbg-y);z-index:8001;min-width:44px;min-height:36px;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em;color:#7fd6ff;background:rgba(0,0,0,.6);border:1px solid #7fd6ff88;
  border-radius:4px;cursor:pointer;touch-action:manipulation}
#dbg-select .dbg-wt{background:#1f3442}
#dbg-select .dbg-wt:focus,#dbg-select .dbg-wt:hover{background:#2a475a}
#dbg-select .dbg-wt-none{all:unset;box-sizing:border-box;min-height:40px;padding:8px 12px;border-radius:20px;background:#22262a;cursor:pointer;
  font-size:12px;opacity:.75;touch-action:manipulation;border:2px solid transparent}
#dbg-select .dbg-wt-none:focus,#dbg-select .dbg-wt-none:hover{border-color:#7fd6ff;opacity:1}
body.dbg-video #dbg-btn,body.dbg-video #dbg-sol-btn,body.dbg-video #dbg-wt-btn{display:none}
/* video mode: the info HUD minimized in the corner (the DEBUG buttons are hidden), F11 hides / shows it; a capture run
   (?test=1, clean) keeps it hidden (DebugMode._syncInfo). Never over a walkthrough card (title, end, no walkthrough). */
body.dbg-video #dbg-info{bottom:var(--dbg-y)}
body.dbg-video:not(.dbg-video-info) #dbg-info{display:none}
body:has(#wt-card) #dbg-info{display:none}
#dbg-select .dbg-sol{background:#24402a}
#dbg-select .dbg-sol:focus,#dbg-select .dbg-sol:hover{background:#2f5636}
`;

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Label of an option button for its current value. */
function optLabel(key, o) {
  switch (key) {
    case 'skipBriefing': return 'Skip briefing';
    case 'allCommandos': return 'All commandos';
    case 'invulnerable': return 'Invulnerable';
    case 'noDetect': return 'Enemies blind & deaf';
    case 'cones': return 'All vision cones';
    case 'freeCamera': return 'Free camera';
    case 'infoHud': return 'Info HUD (F11)';
    case 'timeScale': return `Time ×${o.timeScale}`;
    case 'timeOfDay': return `Time of day: ${o.timeOfDay}`;
    case 'weather': return `Wind: ${o.weather}`;
    default: return key;
  }
}
/** Rolling window of the info HUD's frame numbers (ms): a spike stays in the max this long. */
const STATS_SPAN = 2000;
/** Discrete inputs timed to the next drawn frame (moves fire every frame and would swamp the average). */
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel'];
const TOGGLES = ['skipBriefing', 'allCommandos', 'invulnerable', 'noDetect', 'cones', 'freeCamera', 'infoHud'];
const CYCLERS = ['timeScale', 'timeOfDay', 'weather'];
/** Options that only take effect on the next launch (they change the mission def). */
const ON_LAUNCH = new Set(['allCommandos', 'timeOfDay', 'weather']);

export class DebugMode {
  /**
   * @param {{search?: string, storage?: Storage|null, missions: () => object[], history?: History|null}} o
   */
  constructor({ search = '', storage = null, missions, history = null } = {}) {
    this.params = parseDebugParams(search);
    this.storage = storage;
    this.missions = missions;
    this.history = history;
    this.options = loadOptions(storage, this.params.cones ? { cones: true } : {});
    /** The running SOLUTION replay (SolutionReplay), or null. */
    this.replay = null;
    this._replayLaunch = false;
    /** Live flags read by the sim (world.debug): mutated in place so a running world follows the toggles. */
    this.flags = { invulnerable: false, noDetect: false };
    this.game = null;
    this.hooks = {};
    this.overlay = null;
    // info HUD numbers: GPU bytes are counted from the first allocation on (the counter wraps the WebGL2 prototype
    // before the Game creates its context); the frame / input samples only while the HUD is shown (_statsOn)
    try { this.gpuMem = installGpuMemCounter(); } catch (err) { this.gpuMem = null; console.warn('[debug] GPU memory counter', err); }
    this.win = { frame: new RollingWindow(STATS_SPAN), cpu: new RollingWindow(STATS_SPAN), render: new RollingWindow(STATS_SPAN), calls: new RollingWindow(STATS_SPAN),
      tris: new RollingWindow(STATS_SPAN), preCalls: new RollingWindow(STATS_SPAN), preTris: new RollingWindow(STATS_SPAN) };
    this.draws = new FrameDraws();
    this.latency = new InputLatency();
    /** Latest info HUD numbers (plain object; also for tests). */
    this.stats = null;
    this._statsOn = false;
    this._lastFrameT = 0;
    /** A capture run (?test=1, ?debug=clean): video mode keeps the info HUD hidden. */
    this.capture = !!(this.params.clean || this.params.test);
    this._videoInfo = !this.capture; // video mode: shown (minimized) unless capturing; F11 toggles
    this._videoExpanded = false; // video mode: the panel expanded (this walkthrough only)
    /** Perf graph: per-frame frame / main-CPU ms, GPU MB at the HUD's 4 Hz (the graph draws from these). */
    this.series = new FrameSeries(4096);
    this.gpuSeries = new FrameSeries(256);
    this._colF = new Float32Array(1024); this._colC = new Float32Array(1024); this._colG = new Float32Array(1024); this._colS = new Float32Array(1024);
    this.pointer = { x: -1, y: -1 };
    this._frozen = null;
    this._style = el('style', null, document.head, CSS);
    this._style.id = 'dbg-style';
    // input → frame latency: registered ahead of the key handler below (which may stop a key's propagation)
    this._onInput = (e) => { if (this._statsOn) this.latency.input(e.timeStamp, performance.now()); };
    for (const type of INPUT_EVENTS) window.addEventListener(type, this._onInput, { capture: true, passive: true });
    // a hidden tab gets no frames: its gap is not a frame time, its inputs no frame latency
    document.addEventListener('visibilitychange', () => { this._lastFrameT = 0; this.latency.drop(); });
    this._onKey = (e) => this.key(e);
    // registered before the Game (and its HUD) exist: this capture listener runs first and can swallow keys
    window.addEventListener('keydown', this._onKey, true);
    this._onMove = (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerdown', this._onMove, { passive: true }); // a tap moves no pointer first
    this._syncFlags();
    // the solution catalog (tools/solutions/: listed by the dev server, baked into the web build)
    this.catalogReady = loadCatalog().then(() => { if (this.overlay) this._renderSolutions(); });
  }

  /** Hook the Game: def transform + flags, render stats, per-load option application, the corner widgets. */
  attach(game, hooks = {}) {
    this.game = game;
    this.hooks = hooks;
    game.debug = { flags: this.flags, transformDef: (def) => transformDef(def, this.effectiveOptions()), mode: this };
    const W = this.win;
    // Game.render: render CPU ms, whole-frame draws / triangles (FrameDraws: Renderer.render resets renderer.info at its
    // start, after the water mirror / FFT / trail passes of the map frame), and the end of the frame for input latency
    const render = game.render.bind(game);
    game.render = (dt, alpha, draw) => {
      if (!this._statsOn) {
        const out = render(dt, alpha, draw);
        this._frameApply();
        return out;
      }
      const info = game.renderer?.renderer?.info;
      if (info && info !== this.draws.info) this.draws.attach(info); // three makes a new info on a restored context
      this.draws.begin();
      const t0 = performance.now();
      const out = render(dt, alpha, draw);
      const t1 = performance.now();
      const d = this.draws.end();
      W.render.push(t1, t1 - t0);
      W.calls.push(t1, d.calls);
      W.tris.push(t1, d.tris);
      W.preCalls.push(t1, d.preCalls);
      W.preTris.push(t1, d.preTris);
      if (draw !== false) this.latency.frame(t1); // the view covered by a menu draws nothing: not a reaction yet
      this._frameApply();
      return out;
    };
    // Game.frame (one per requestAnimationFrame): the interval between frames and the main-thread ms of each
    // (sim ticks + render + texture uploads)
    const frame = game.frame.bind(game);
    game.frame = (dt) => {
      if (!this._statsOn) { this._lastFrameT = 0; return frame(dt); }
      const t0 = performance.now(), last = this._lastFrameT;
      if (last) W.frame.push(t0, t0 - last);
      this._lastFrameT = t0;
      const out = frame(dt);
      const t1 = performance.now();
      W.cpu.push(t1, t1 - t0);
      if (last) this.series.push(t0, t0 - last, t1 - t0); // the graph's ring (3 typed-array writes)
      return out;
    };
    game.events.on('mission:loaded', () => this._onLoaded());
    this.button = el('button', null, document.body, 'DEBUG');
    this.button.id = 'dbg-btn';
    this.button.type = 'button';
    this.button.title = 'Debug level select (F10)';
    this.button.addEventListener('click', () => this.toggle());
    this.info = el('div', null, document.body);
    this.info.id = 'dbg-info';
    this.infoText = el('div', 'dbg-txt', this.info);
    this.graph = el('canvas', 'dbg-graph', this.info);
    this.graph.width = 1; this.graph.height = 1; // sized to its box when first drawn
    this.infoTog = el('button', 'dbg-tog', this.info);
    this.infoTog.type = 'button';
    this.infoTog.tabIndex = -1; // never keeps the keyboard: Enter / Space stay the game's
    // its own clicks and taps only: nothing reaches the game, the walkthrough or the touch gestures
    for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart']) {
      this.infoTog.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); }, { passive: ev !== 'contextmenu' });
    }
    this.infoTog.addEventListener('click', () => this.toggleStatsMin());
    this._syncInfo();
    this.solBtn = el('button', null, document.body, '▶ SOL');
    this.solBtn.id = 'dbg-sol-btn';
    this.solBtn.type = 'button';
    this.solBtn.title = 'Replay the saved solution of this mission (F9)';
    this.solBtn.hidden = true;
    this.solBtn.addEventListener('click', () => this.startReplay(this.currentId));
    this.wtBtn = el('button', null, document.body, '▶ VIDEO');
    this.wtBtn.id = 'dbg-wt-btn';
    this.wtBtn.type = 'button';
    this.wtBtn.title = 'Video mode: watch the walkthrough of this mission (F8)';
    this.wtBtn.hidden = true;
    this.wtBtn.addEventListener('click', () => this.startWalkthrough(this.currentId));
    this._infoTimer = setInterval(() => this._updateInfo(), 250);
    return this;
  }

  /** Level ids in the select's order (PageDown / PageUp order). */
  order() {
    return levelOrder(this.missions());
  }

  get currentId() {
    return this.game?.world ? this.game.missionDef?.id ?? null : null;
  }

  setOption(key, value) {
    this.options = { ...this.options, [key]: value };
    saveOptions(this.storage, this.options);
    this._syncFlags();
    this._applyLive();
    if (this.overlay) this._renderOptions();
  }

  /**
   * The options in force: a SOLUTION replay plays the mission as authored (no extra commandos, normal time of day and
   * wind, enemies that see and hit), whatever the select's toggles say; they come back when it stops.
   */
  effectiveOptions() {
    if (!this.replay && !this._replayLaunch) return this.options;
    return { ...this.options, allCommandos: false, invulnerable: false, noDetect: false, timeOfDay: 'mission', weather: 'mission' };
  }

  _syncFlags() {
    const o = this.effectiveOptions();
    this.flags.invulnerable = !!o.invulnerable;
    this.flags.noDetect = !!o.noDetect;
  }

  /** Options that act on a running mission: time scale, camera, info HUD (cones follow in _frameApply). */
  _applyLive() {
    const g = this.game;
    if (!g) return;
    if (this._frozen == null) g.timeScale = this.options.timeScale;
    this._syncInfo();
    this._applyCamera();
    this._conesFor = null;
  }

  /**
   * Info HUD shown or not: the F11 option, except in video mode, where it starts hidden (clean recordings) and F11
   * shows it for that walkthrough only. Sampling (frame / input / draw windows) runs only while it is shown.
   */
  _syncInfo() {
    const box = this.info;
    if (!box) return;
    const video = document.body.classList.contains('dbg-video');
    const show = video ? this._videoInfo : !!this.options.infoHud;
    const min = video ? !this._videoExpanded : !!this.options.statsMin;
    if (document.body.classList.contains('dbg-video-info') !== (video && show)) document.body.classList.toggle('dbg-video-info', video && show);
    if (box.hidden === show) box.hidden = !show;
    if (box.classList.contains('min') !== min) box.classList.toggle('min', min);
    const t = this.infoTog;
    if (t && t.dataset.min !== String(min)) {
      t.dataset.min = String(min);
      t.textContent = min ? '+' : '−';
      t.title = min ? 'Show all stats and the perf graph' : 'Minimize the stats to one line';
      t.setAttribute('aria-label', min ? 'Expand debug stats' : 'Minimize debug stats');
      t.setAttribute('aria-expanded', String(!min));
    }
    if (show && !this._statsOn) {
      for (const w of Object.values(this.win)) w.clear();
      this.series.clear(); this.gpuSeries.clear();
      this.latency.drop(); this._lastFrameT = 0;
    }
    this._statsOn = show;
    if (show) this._updateInfo();
    this.replay?._layout?.(); // video mode: the caption makes room at once
  }

  /** −/+ : the full panel + graph or one line. Remembered (debug options); in video mode for this walkthrough only. */
  toggleStatsMin() {
    if (document.body.classList.contains('dbg-video')) { this._videoExpanded = !this._videoExpanded; this._syncInfo(); }
    else this.setOption('statsMin', !this.options.statsMin);
    this.game?.renderer?.domElement?.focus?.({ preventScroll: true });
  }


  _applyCamera() {
    const g = this.game, def = g?.missionDef;
    if (!g || !def?.size) return;
    const free = !!this.options.freeCamera;
    for (const v of g.cameraRig?.views || []) {
      if (!v.cfg) continue;
      v.cfg.zoomLevels = free ? [0.125, 0.25, 0.5, 1, 2, 4] : CONFIG.camera.zoomLevels;
      v.cfg.boundsMargin = free ? Math.max(def.size[0], def.size[1]) : CONFIG.camera.boundsMargin;
      v.setBounds?.(def.size[0], def.size[1]);
      const L = v.cfg.zoomLevels, lo = Math.min(...L), hi = Math.max(...L);
      if (!free && (v.zoomTarget > hi || v.zoomTarget < lo)) v.setZoom?.(Math.min(hi, Math.max(lo, v.zoomTarget)));
    }
  }

  _onLoaded() {
    this._applyLive();
    this._thumbAt = performance.now() + 2500; // a cached live thumbnail once the map has settled
  }

  /** Per rendered frame: cone visibility, the pending thumbnail capture. */
  _frameApply() {
    const g = this.game;
    if (g.cones && this._conesFor !== g.cones) {
      this._conesFor = g.cones;
      g.cones.showAll = !!this.options.cones;
    }
    if (this.solBtn) {
      const show = !this.replay && !this._replayLaunch && !!g.world && (g.state === 'playing' || g.state === 'paused') && hasSolution(this.currentId);
      if (this.solBtn.hidden === show) this.solBtn.hidden = !show;
    }
    if (this.wtBtn) { // any mission: one without a solution says "No walkthrough yet"
      const show = !this.replay && !this._replayLaunch && !!g.world && (g.state === 'playing' || g.state === 'paused');
      if (this.wtBtn.hidden === show) this.wtBtn.hidden = !show;
    }
    const video = !!this.replay?.isWalkthrough;
    if (document.body.classList.contains('dbg-video') !== video) {
      document.body.classList.toggle('dbg-video', video);
      this._syncInfo();
    }
    if (this._thumbAt && g.state === 'playing' && g.world && performance.now() > this._thumbAt) {
      this._thumbAt = 0;
      this._captureThumb(g.missionDef?.id);
    }
  }

  _captureThumb(id) {
    try {
      const src = this.game.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 135;
      const s = Math.min(src.width / 16, src.height / 9);
      c.getContext('2d').drawImage(src, (src.width - 16 * s) / 2, (src.height - 9 * s) / 2, 16 * s, 9 * s, 0, 0, 240, 135);
      if (id) putThumb(`dbg:${id}`, c.toDataURL('image/jpeg', 0.7));
    } catch { /* tainted / lost context: no thumbnail */ }
  }

  // ------------------------------------------------------------ level select overlay

  toggle() {
    if (this.overlay) this.close();
    else this.open();
  }

  /** Show DEBUG LEVEL SELECT (freezes a running mission until it closes). */
  open() {
    if (this.overlay) return this.overlay;
    const g = this.game;
    if (g?.world && g.state === 'playing') { this._frozen = g.timeScale; g.timeScale = 0; }
    const root = el('section', null, document.body);
    root.id = 'dbg-select';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Debug level select');
    el('h1', null, root, 'DEBUG LEVEL SELECT');
    el('p', 'dbg-hint', root, 'Arrows + Enter or tap to launch · Esc closes · in game: F10 this screen, PgDn / PgUp next / previous level, Ctrl+R restart, F11 info');
    this.overlay = root;
    const cur = this.currentId;
    for (const grp of groupMissions(this.missions())) {
      el('h2', null, root, `${grp.label} (${grp.missions.length})`);
      const grid = el('div', 'dbg-grid', root);
      grid.dataset.group = grp.id;
      for (const m of grp.missions) {
        const b = el('button', 'dbg-tile', grid);
        b.type = 'button';
        b.dataset.mission = m.id;
        if (m.id === cur) b.classList.add('current');
        const th = el('div', 'dbg-thumb', b);
        th.style.setProperty('--th', THEATER_COLORS[m.theater] || '#555');
        el('span', null, th, m.n != null ? String(m.n) : m.id.toUpperCase());
        el('i', null, th, THEATER_ICONS[m.theater] || '');
        const meta = el('div', 'dbg-meta', b);
        el('b', null, meta, m.title);
        el('small', null, meta, `${m.id} · ${m.theater}`);
        b.title = m.subtitle || m.title;
        b.addEventListener('click', () => this.launch(m.id));
        getThumb(`dbg:${m.id}`).then((url) => { if (url) th.style.backgroundImage = `url("${url}")`; }).catch(() => {});
      }
    }
    this.solsEl = el('div', 'dbg-sols-host', root);
    this._renderSolutions();
    el('h2', null, root, 'Options');
    this.optsEl = el('div', 'dbg-opts', root);
    this._renderOptions();
    const bar = el('div', 'dbg-bar', root);
    const act = (label, fn) => { const b = el('button', 'dbg-act', bar, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    if (g?.world) act('Resume', () => this.close());
    act('Main menu', () => this.toMainMenu());
    const focus = root.querySelector('.dbg-tile.current') || root.querySelector('.dbg-tile');
    focus?.focus();
    return root;
  }

  /** The select's "Watch walkthrough" and "Solution replays" sections (filled once the catalog is loaded). */
  _renderSolutions() {
    const host = this.solsEl;
    if (!host) return;
    host.textContent = '';
    const sols = solutionIds();
    const all = this.missions();
    el('h2', null, host, `Watch walkthrough · video mode (${sols.length})`);
    const vbar = el('div', 'dbg-bar dbg-wts', host);
    vbar.style.marginTop = '0';
    for (const id of sols) {
      const m = all.find((x) => x.id === id);
      const b = el('button', 'dbg-act dbg-wt', vbar, `▶ ${m?.n != null ? `M${m.n} ` : ''}${m?.title || id} — watch the walkthrough`);
      b.type = 'button';
      b.dataset.walkthrough = id;
      b.title = 'Guided film of the saved solution, live in the game: director camera, narration per step, chapters; pause, ½×–4×, previous / next step';
      b.addEventListener('click', () => this.startWalkthrough(id));
    }
    const none = all.filter((m) => !sols.includes(m.id) && !m.dev);
    if (none.length) {
      el('p', 'dbg-hint', host, 'No walkthrough yet:').style.margin = '10px 0 6px';
      const nb = el('div', 'dbg-opts dbg-wt-nones', host);
      for (const m of none) {
        const b = el('button', 'dbg-wt-none', nb, m.n != null ? `M${m.n}` : m.id.toUpperCase());
        b.type = 'button';
        b.dataset.walkthrough = m.id;
        b.title = `${m.title}: no walkthrough yet`;
        b.addEventListener('click', () => this.startWalkthrough(m.id));
      }
    }
    if (!sols.length) return;
    el('h2', null, host, `Solution replays (${sols.length})`);
    const bar = el('div', 'dbg-bar dbg-sols', host);
    bar.style.marginTop = '0';
    const byId = new Map(this.missions().map((m) => [m.id, m]));
    for (const id of sols) {
      const m = byId.get(id);
      const b = el('button', 'dbg-act dbg-sol', bar, `▶ ${m?.title || id} — play the solution`);
      b.type = 'button';
      b.dataset.solution = id;
      b.title = 'Load the mission fresh and play its saved solution live (2× / 4× / 8×, pause, skip to a step; Esc stops)';
      b.addEventListener('click', () => this.startReplay(id));
    }
  }

  _renderOptions() {
    const host = this.optsEl;
    if (!host) return;
    host.textContent = '';
    for (const k of [...TOGGLES, ...CYCLERS]) {
      const b = el('button', 'dbg-opt', host, optLabel(k, this.options) + (ON_LAUNCH.has(k) ? ' *' : ''));
      b.type = 'button';
      b.dataset.opt = k;
      if (TOGGLES.includes(k)) b.setAttribute('aria-pressed', String(!!this.options[k]));
      b.addEventListener('click', () => {
        this.setOption(k, TOGGLES.includes(k) ? !this.options[k] : cycleOption(this.options, k, 1));
        host.querySelector(`[data-opt="${k}"]`)?.focus();
      });
    }
    el('small', 'dbg-hint', host, '* applies on the next launch');
  }

  close() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.optsEl = null;
    this.solsEl = null;
    if (this._frozen != null && this.game) { this._frozen = null; this.game.timeScale = this.options.timeScale; }
    this._frozen = null;
    this.game?.renderer?.domElement?.focus?.();
  }

  /** Leave debug select (and any mission) for the normal title / main menu. */
  toMainMenu() {
    this.close();
    if (this.game?.world) this.game.hud?.quitToTitle ? this.game.hud.quitToTitle() : this.game.quitToTitle();
    else this.hooks.showTitle?.();
  }

  // ------------------------------------------------------------ launching

  /**
   * Load mission `id` with the current options (loading screen unless `instant`), then skip the briefing when asked.
   * The URL becomes `?debug…&mission=<id>` so a reload / shared link lands on the same level.
   */
  async launch(id, { instant = false, brief: forceBrief = null } = {}) {
    const g = this.game;
    if (!g || !id) return false;
    if (this._launching) { this._pending = [id, { instant, brief: forceBrief }]; return false; } // runs once the current load is done
    if (this.replay && !this._replayLaunch) this.stopReplay(); // another level: the replay ends here
    this.close();
    this._launching = true;
    this._lastId = id;
    try {
      this._setUrl((q) => { q.set('mission', id); q.delete('walkthrough'); q.delete('speed'); }); // video mode sets its own after
      const hud = g.hud;
      const brief = forceBrief ?? !this.options.skipBriefing;
      const load = () => (g.flow ? g.flow.startMission(id) : g.loadMission(id)).then(() => true);
      let ok;
      if (!hud && this.hooks.startMission) ok = await this.hooks.startMission(id, { brief });
      else {
        hud?.closeAll?.();
        hud?.hideScreens?.();
        ok = hud?.loading && !instant ? await hud.loading.run({ missionId: id, auto: true, brief }, load) : await load();
      }
      if (!ok || !g.world) throw new Error(`mission ${id} did not load`);
      if (!brief && g.state === 'briefing') {
        if (g.flow?.begin) g.flow.begin();
        else g.start();
        document.getElementById('briefing-fallback')?.setAttribute('hidden', '');
      }
      this._applyLive();
      g.renderer?.domElement?.focus?.();
      return true;
    } catch (err) {
      console.warn('[debug] launch failed', err);
      this.open();
      return false;
    } finally {
      this._launching = false;
      const next = this._pending;
      this._pending = null;
      if (next) this.launch(...next);
    }
  }

  // ------------------------------------------------------------ SOLUTION replay

  /**
   * Load mission `id` fresh (briefing skipped, options as authored) and play its saved solution live. `toStage`:
   * fast-forward to the start of that stage first. @returns {Promise<SolutionReplay|null>}
   */
  async startReplay(id, { toStage = null, speed = null } = {}) {
    if (!hasSolution(id) || this._replayLaunch) return null;
    const keepSpeed = speed ?? this.replay?.speed ?? 1;
    this.stopReplay();
    this._replayLaunch = true;
    this._syncFlags();
    const mt = this.game.manualTick;
    this.game.manualTick = true; // (tick 0 is the solution's: no frame ticks the fresh mission before the replay)
    let started = false;
    try {
      const sol = await loadSolution(id);
      const ok = await this.launch(id, { instant: true, brief: false });
      if (!ok || !this.game.world || this.currentId !== id) throw new Error(`mission ${id} did not load`);
      if (this.game.state === 'paused') this.game.pause(false);
      const r = new SolutionReplay(this.game, sol, {
        speed: keepSpeed, toStage, manualTickAfter: mt,
        isFrozen: () => !!this.overlay,
        onSkip: (stage) => { this.startReplay(id, { toStage: stage, speed: r.speed }); },
        onEnd: (res) => {
          if (this.replay === r) this.replay = null;
          this._syncFlags();
          this.lastReplay = res;
          if (res.outcome === 'error') this.game.hud?.message?.(`SOLUTION REPLAY STOPPED: ${res.error}`, 'warn');
          this.game.events?.emit?.('debug:replay-end', res);
        },
      });
      this.replay = r;
      this._replayLaunch = false;
      this._syncFlags();
      r.start();
      started = true;
      // the address bar is now a shareable video-mode link: ?debug&mission=m03&walkthrough=m03[&speed=4]
      this._setUrl((q) => { q.set('walkthrough', id); if (r.pacer.speed === 1) q.delete('speed'); else q.set('speed', String(r.pacer.speed)); });
      this.game.renderer?.domElement?.focus?.();
      return r;
    } catch (err) {
      console.warn('[debug] solution replay failed to start', err);
      return null;
    } finally {
      if (!started) this.game.manualTick = mt;
      this._replayLaunch = false;
      this._syncFlags();
    }
  }

  // ------------------------------------------------------------ VIDEO MODE (walkthrough)

  /**
   * Video mode: load mission `id` fresh (as authored) and play its solution as a guided walkthrough
   * (debug/walkthrough.js). A mission without a solution gets the "No walkthrough yet" card. `toMarker`: fast-forward
   * to that chapter / checkpoint first (a jump back reloads); `settings`: speed (a fixed one or 'auto'; none: AUTO), captions,
   * skip waits, free camera.
   * @returns {Promise<Walkthrough|null>}
   */
  async startWalkthrough(id, { toMarker = null, settings = null, introWait = false } = {}) {
    if (!id || this._replayLaunch) return null;
    closeCard();
    this.close();
    const [W] = await Promise.all([walkthroughModule(), loadCatalog()]);
    if (!hasSolution(id)) { this._noWalkthrough(W, id); return null; }
    const keep = settings || {};
    this.stopReplay();
    if (!toMarker) { this._videoInfo = !this.capture; this._videoExpanded = false; } // a fresh start: minimized (a jump back keeps F11 / +)
    this._replayLaunch = true;
    this._syncFlags();
    // the clock is held from the load on: the walkthrough's first tick is the mission's first (the scripted run's)
    const mt = this.game.manualTick;
    this.game.manualTick = true;
    let started = false;
    try {
      const [sol, wtFile] = await Promise.all([loadSolution(id), loadWalkthrough(id).catch((e) => { console.warn(`[debug] ${id}.walkthrough.mjs failed to load`, e); return null; })]);
      // a fresh start shows the LOADING screen and its progress bar (a shared link opens on a cold load: user
      // 2026-10-12 "Add a quick way to see the state of loading with a loading bar when sending that link");
      // a jump back reloads instantly (warm, from the session cache) and fast-forwards
      const ok = await this.launch(id, { instant: !!toMarker, brief: false });
      if (!ok || !this.game.world || this.currentId !== id) throw new Error(`mission ${id} did not load`);
      if (this.game.state === 'paused') this.game.pause(false);
      const r = new W.Walkthrough(this.game, sol, wtFile, {
        speed: keep.speed ?? W.DEFAULT_WALK_SPEED, captions: keep.captions ?? true, skipWaits: keep.skipWaits ?? true, free: !!keep.free,
        toMarker, intro: !toMarker, introWait, manualTickAfter: mt,
        // (always in the link: no speed means AUTO, so a fixed 1× is speed=1; AUTO is speed=auto)
        onSpeed: (s) => this._setUrl((q) => q.set('speed', String(s))),
        isFrozen: () => !!this.overlay,
        onSkip: (marker, s) => { this.startWalkthrough(id, { toMarker: marker, settings: s }); },
        onExit: () => this.exitWalkthrough(),
        onEnd: (res) => {
          if (this.replay === r) this.replay = null;
          this._syncFlags();
          this.lastReplay = res;
          this.lastWalkthrough = res;
          this.game.events?.emit?.('debug:walkthrough-end', res);
          if (res.outcome !== 'stopped') W.endCard(r, res, { onAgain: () => this.startWalkthrough(id, { settings: r.settings }), onExit: () => this.exitWalkthrough() });
        },
      });
      this.replay = r;
      this._replayLaunch = false;
      this._syncFlags();
      r.start();
      started = true;
      // the address bar is now a shareable video-mode link: ?debug&mission=m03&walkthrough=m03&speed=auto|4|…
      this._setUrl((q) => { q.set('walkthrough', id); q.set('speed', String(r.speedSetting)); });
      this.game.renderer?.domElement?.focus?.();
      return r;
    } catch (err) {
      console.warn('[debug] walkthrough failed to start', err);
      W.hideRewind?.(); // (a jump back's overlay)
      return null;
    } finally {
      if (!started) this.game.manualTick = mt;
      this._replayLaunch = false;
      this._syncFlags();
    }
  }

  /** Edit the page URL's query in place (no reload, no history entry): `edit(searchParams)`. */
  _setUrl(edit) {
    try {
      const u = new URL(location.href);
      edit(u.searchParams);
      if (u.href !== location.href) this.history?.replaceState?.(this.history.state, '', u.href);
    } catch { /* sandboxed history */ }
  }

  /** Leave video mode for the debug menu (the mission is unloaded). */
  exitWalkthrough() {
    closeCard();
    if (this.replay?.isWalkthrough) this.stopReplay();
    this._setUrl((q) => { q.delete('walkthrough'); q.delete('speed'); });
    if (this.game?.world) { if (this.game.hud?.quitToTitle) this.game.hud.quitToTitle(); else this.game.quitToTitle(); }
    this.open();
  }

  _noWalkthrough(W, id) {
    const m = this.missions().find((x) => x.id === id);
    W.showCard({
      kind: 'none', kicker: 'VIDEO MODE', title: m ? `${m.n != null ? `Mission ${m.n} · ` : ''}${m.title}` : id,
      paras: ['No walkthrough yet.', 'This mission has no saved solution to play (tools/solutions/<id>.solution.mjs).'],
      actions: [['OK', () => { closeCard(); if (!this.game?.world) this.open(); }, true]],
    });
  }

  /** Stop the running replay (the player takes over where it stands). */
  stopReplay() {
    const r = this.replay;
    this.replay = null;
    r?.stop();
    this._syncFlags();
    if (this.game) this._applyLive();
  }

  // ------------------------------------------------------------ keys (window capture, ahead of the HUD and Input)

  key(e) {
    if (!this.game || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    const consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'F10') { consume(); if (!e.repeat) this.toggle(); return; }
    if (e.code === 'F11') {
      consume();
      if (e.repeat) return;
      if (document.body.classList.contains('dbg-video')) { this._videoInfo = !this._videoInfo; this._syncInfo(); } // this walkthrough only
      else this.setOption('infoHud', !this.options.infoHud);
      return;
    }
    const card = document.getElementById('wt-card');
    if (card && !this.overlay) { // a walkthrough card (intro, end, no walkthrough yet) has the keys
      if (e.code === 'Escape') { consume(); if (this.replay?.isWalkthrough) this.replay.key(e); else if (card.dataset.kind === 'end') this.exitWalkthrough(); else closeCard(); }
      else if (e.code === 'Enter' || e.code === 'Space') { consume(); (card.querySelector('.wt-go') || card.querySelector('button'))?.click(); }
      return;
    }
    if (this.replay?.isWalkthrough && !this.overlay) {
      if (this.replay.key(e)) consume();
      else if (/^(Digit|Numpad|Key[A-Z]$|F\d)/.test(e.code) && e.code !== 'F11') e.stopImmediatePropagation(); // no game hotkey reaches the HUD
      return;
    }
    if (e.code === 'F8' && !this.overlay) {
      consume();
      if (!e.repeat && this.currentId) this.startWalkthrough(this.currentId);
      return;
    }
    if (e.code === 'F9' && !this.overlay) {
      consume();
      if (!e.repeat) { if (this.replay) this.stopReplay(); else if (hasSolution(this.currentId)) this.startReplay(this.currentId); }
      return;
    }
    if (this.replay && !this.overlay && e.code === 'Escape') {
      consume();
      if (this.replay.stepsOpen) this.replay._showSteps(false); else this.stopReplay();
      return;
    }
    if (this.overlay) {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
      if (e.code === 'Escape') { consume(); if (this.game.world) this.close(); else this.toMainMenu(); }
      else if (dir) { consume(); this._moveFocus(dir[0], dir[1]); }
      else if (e.code === 'PageDown' || e.code === 'PageUp') return; // scrolls the list
      else e.stopImmediatePropagation(); // Enter / Space click the focused button; nothing reaches the game
      return;
    }
    if (e.code === 'PageDown' || e.code === 'PageUp') {
      consume();
      if (!e.repeat) this.launch(neighbourLevel(this.missions(), this.currentId ?? this._lastId, e.code === 'PageDown' ? 1 : -1));
      return;
    }
    if (e.code === 'KeyR' && (e.ctrlKey || e.metaKey) && !e.shiftKey && this.currentId) {
      consume();
      if (!e.repeat) this.launch(this.currentId, { instant: true });
    }
  }

  /** Arrow navigation: the nearest focusable in that direction (tiles, options, actions). */
  _moveFocus(dx, dy) {
    const items = [...this.overlay.querySelectorAll('.dbg-tile, .dbg-opt, .dbg-act')]; // (.dbg-sol buttons are .dbg-act)
    if (!items.length) return;
    const cur = items.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { items[0].focus(); return; }
    const c = (n) => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const a = c(cur);
    let best = null, bestS = Infinity;
    for (const n of items) {
      if (n === cur) continue;
      const b = c(n), px = (b.x - a.x) * dx + (b.y - a.y) * dy, sx = Math.abs((b.x - a.x) * dy) + Math.abs((b.y - a.y) * dx);
      if (px <= 4) continue;
      const s = px + sx * 2.5;
      if (s < bestS) { bestS = s; best = n; }
    }
    (best || cur).focus();
    (best || cur).scrollIntoView?.({ block: 'nearest' });
  }

  // ------------------------------------------------------------ info HUD

  _updateInfo() {
    const g = this.game, box = this.info;
    if (!g || !box || box.hidden) return;
    const cc = g.cameraController;
    let cur = '-';
    if (cc?.screenToGround && this.pointer.x >= 0 && g.world) {
      const p = cc.screenToGround(this.pointer.x, this.pointer.y);
      if (p) cur = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
    }
    const o = this.options;
    const fo = this.effectiveOptions();
    const flags = [fo.invulnerable && 'INVULN', fo.noDetect && 'BLIND', o.cones && 'CONES', o.freeCamera && 'FREECAM'].filter(Boolean).join(' ');
    const r = this.replay;
    const rep = r ? `REPLAY ${r.sol.id} step ${r.stage?.id ?? '-'} ${r.fastForward ? 'FF' : r.auto ? `AUTO x${r.rate.toFixed(1)}` : `x${r.speed}`}${r.paused ? ' paused' : ''} t=${(g.world?.time ?? 0).toFixed(0)}s` : '';
    const id = this.currentId;
    const s = this.sampleStats();
    const now = performance.now();
    if (s.gpu) this.gpuSeries.push(now, s.gpu.total / 1048576);
    box.dataset.mission = id || '';
    if (box.classList.contains('min')) { this.infoText.textContent = compactLine(s); return; } // (no graph work)
    this.infoText.textContent = [
      `${id || 'no mission'}  ${g.state}  x${g.timeScale}`,
      ...statsLines(s),
      `cursor ${cur}  zoom ${(cc?.zoom ?? 0).toFixed(2)}  yaw ${(cc?.yawDeg ?? 0).toFixed(0)}°`,
      rep,
      flags,
    ].filter(Boolean).join('\n');
    this._drawGraph(now);
  }

  /** The perf graph (expanded panel only): the rings bucketed into one column per CSS px, drawn at the HUD's refresh. */
  _drawGraph(now) {
    const cv = this.graph;
    const w = cv?.clientWidth || 0, h = cv?.clientHeight || 0;
    if (!(w > 0 && h > 0)) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = (this._gctx ||= cv.getContext('2d'));
    if (!ctx) return;
    const cols = Math.max(1, Math.min(this._colF.length, Math.floor(w)));
    this.series.columns(now, GRAPH_SPAN, cols, this._colF, this._colC);
    this.gpuSeries.columns(now, GRAPH_SPAN, cols, this._colG, null);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = this.gpuSeries.last();
    this.graphInfo = drawPerfGraph(ctx, w, h, { frame: this._colF, cpu: this._colC, gpu: this._colG, cols, gpuNowMB: g ? g.a : null, scratch: this._colS });
    this.graphDraws = (this.graphDraws || 0) + 1;
  }

  /**
   * The info HUD's numbers now (also `this.stats`): frame interval, main-thread and render ms, draws and triangles of
   * the whole frame (+ the offscreen part) over the last STATS_SPAN ms; input → frame latency of the last inputs; GPU
   * bytes (gpu-mem-counter), three's live geometry / texture counts, the JS heap (Chromium only).
   */
  sampleStats() {
    const now = performance.now(), W = this.win, g = this.game;
    const pc = W.preCalls.stats(now), pt = W.preTris.stats(now);
    const mem = g?.renderer?.renderer?.info?.memory;
    const pm = typeof performance !== 'undefined' ? performance.memory : null;
    let gpu = null;
    try { gpu = this.gpuMem?.totals() || null; } catch { gpu = null; }
    this.stats = {
      span: STATS_SPAN,
      frame: W.frame.stats(now), cpu: W.cpu.stats(now), render: W.render.stats(now),
      input: this.latency.stats(),
      calls: W.calls.stats(now), tris: W.tris.stats(now), pre: pc && pt ? { calls: pc.avg, tris: pt.avg } : null,
      gpu,
      three: mem ? { textures: mem.textures, geometries: mem.geometries } : null,
      heap: pm && pm.usedJSHeapSize > 0 ? { used: pm.usedJSHeapSize, total: pm.totalJSHeapSize, limit: pm.jsHeapSizeLimit } : null,
    };
    return this.stats;
  }
}

/**
 * main.js entry: a DebugMode when the URL asks for it, else null (and nothing is installed).
 * @param {{search: string, storage?: Storage|null, missions: () => object[], history?: History|null}} o
 */
export function installDebugMode(o) {
  if (!parseDebugParams(o?.search || '').enabled) return null;
  return new DebugMode(o);
}
