/**
 * Debug mode (`?debug`, `?debug=1`, `?debug=cones`, …): DEBUG LEVEL SELECT overlay (every mission of
 * missionList(), grouped BEL / BCD / test maps, keyboard + tap), inspection options (remembered in localStorage),
 * quick keys (F10 select, PageDown / PageUp next / previous level, Ctrl+R instant restart, F11 info HUD) and the
 * corner info HUD (mission, FPS, frame ms, draw calls, triangles, cursor x/z, camera zoom / yaw).
 * main.js installs it only when the URL carries `debug`; nothing here exists otherwise. Pure logic: debug-options.js.
 * @module debug/debug-mode
 */

import {
  parseDebugParams, loadOptions, saveOptions, cycleOption, groupMissions, levelOrder, neighbourLevel, transformDef,
} from './debug-options.js';
import { getThumb, putThumb } from '../ui/thumbs.js';
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
#dbg-info{position:fixed;left:8px;bottom:calc(52px + env(safe-area-inset-bottom));z-index:8000;pointer-events:none;font:11px/1.35 ui-monospace,monospace;
  color:#d6ffd0;background:rgba(0,0,0,.62);padding:5px 8px;border-radius:4px;white-space:pre}
#dbg-btn{position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:8001;min-width:56px;min-height:36px;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:.1em;color:#ffcf4a;background:rgba(0,0,0,.6);border:1px solid #ffcf4a88;
  border-radius:4px;cursor:pointer;touch-action:manipulation}
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
    /** Live flags read by the sim (world.debug): mutated in place so a running world follows the toggles. */
    this.flags = { invulnerable: false, noDetect: false };
    this.game = null;
    this.hooks = {};
    this.overlay = null;
    this.stats = { cpuMs: 0, calls: 0, tris: 0 };
    this.pointer = { x: -1, y: -1 };
    this._frozen = null;
    this._style = el('style', null, document.head, CSS);
    this._style.id = 'dbg-style';
    this._onKey = (e) => this.key(e);
    // registered before the Game (and its HUD) exist: this capture listener runs first and can swallow keys
    window.addEventListener('keydown', this._onKey, true);
    this._onMove = (e) => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; };
    window.addEventListener('pointermove', this._onMove, { passive: true });
    this._syncFlags();
  }

  /** Hook the Game: def transform + flags, render stats, per-load option application, the corner widgets. */
  attach(game, hooks = {}) {
    this.game = game;
    this.hooks = hooks;
    game.debug = { flags: this.flags, transformDef: (def) => transformDef(def, this.options), mode: this };
    const r = game.renderer?.renderer;
    const render = game.render.bind(game); // renderer.info already holds whole-frame stats (Renderer.render)
    game.render = (dt, alpha) => {
      const t0 = performance.now();
      const out = render(dt, alpha);
      this.stats.cpuMs = this.stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
      if (r?.info) { this.stats.calls = r.info.render.calls; this.stats.tris = r.info.render.triangles; }
      this._frameApply();
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
    this.info.hidden = !this.options.infoHud;
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

  _syncFlags() {
    this.flags.invulnerable = !!this.options.invulnerable;
    this.flags.noDetect = !!this.options.noDetect;
  }

  /** Options that act on a running mission: time scale, camera, info HUD (cones follow in _frameApply). */
  _applyLive() {
    const g = this.game;
    if (!g) return;
    if (this._frozen == null) g.timeScale = this.options.timeScale;
    if (this.info) this.info.hidden = !this.options.infoHud;
    this._applyCamera();
    this._conesFor = null;
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
  async launch(id, { instant = false } = {}) {
    const g = this.game;
    if (!g || !id) return false;
    if (this._launching) { this._pending = [id, { instant }]; return false; } // runs once the current load is done
    this.close();
    this._launching = true;
    this._lastId = id;
    try {
      try {
        const u = new URL(location.href);
        u.searchParams.set('mission', id);
        this.history?.replaceState?.(this.history.state, '', u.href);
      } catch { /* sandboxed history */ }
      const hud = g.hud;
      const brief = !this.options.skipBriefing;
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

  // ------------------------------------------------------------ keys (window capture, ahead of the HUD and Input)

  key(e) {
    if (!this.game || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    const consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'F10') { consume(); if (!e.repeat) this.toggle(); return; }
    if (e.code === 'F11') { consume(); if (!e.repeat) this.setOption('infoHud', !this.options.infoHud); return; }
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
    const items = [...this.overlay.querySelectorAll('.dbg-tile, .dbg-opt, .dbg-act')];
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
    const cc = g.cameraController, s = this.stats, fps = g.fps || 0;
    let cur = '-';
    if (cc?.screenToGround && this.pointer.x >= 0 && g.world) {
      const p = cc.screenToGround(this.pointer.x, this.pointer.y);
      if (p) cur = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
    }
    const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
    const o = this.options;
    const flags = [o.invulnerable && 'INVULN', o.noDetect && 'BLIND', o.cones && 'CONES', o.freeCamera && 'FREECAM'].filter(Boolean).join(' ');
    const id = this.currentId;
    box.dataset.mission = id || '';
    box.textContent = [
      `${id || 'no mission'}  ${g.state}  x${g.timeScale}`,
      `FPS ${fps.toFixed(0)}  frame ${fps > 0 ? (1000 / fps).toFixed(1) : '-'} ms  cpu ${s.cpuMs.toFixed(1)} ms`,
      `draws ${s.calls}  tris ${k(s.tris)}`,
      `cursor ${cur}`,
      `zoom ${(cc?.zoom ?? 0).toFixed(2)}  yaw ${(cc?.yawDeg ?? 0).toFixed(0)}°`,
      flags,
    ].filter(Boolean).join('\n');
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
