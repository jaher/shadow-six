/**
 * Input — design-spec §5 (keyboard, mouse, cursors) → selection, orders, targeting, camera. Owned by CORE2.
 *
 * Keys use KeyboardEvent.code (layout independent) except `+ - *`, which use event.key (§5). Every bound
 * key is preventDefault()-ed while the game has focus (F1 help, F5 reload, Tab focus, Ctrl+S/L/B).
 * Action keys A–X are routed to the ability registry by each def's `hotkey` (several defs may share a
 * key — D = diving gear (Marine) / distract (Spy) — the first def a selected man owns wins).
 *
 * Mouse (§5.2): left-click a commando selects him (click a selected man to deselect him; Ctrl/⌘+click
 * adds/removes); RIGHT-button drag draws the red selection box (replaces the selection, 6 px
 * threshold); left-click ground walks (formation offsets 1.2 m), double-click (350 ms, 6 px) runs;
 * an armed item cursor uses the item (weapons stay armed: one shot per click; G with a group = volley);
 * right-click cancels the item cursor (or asks the selected men to cancel their context action) and
 * never deselects; Shift+click an enemy/vehicle shows its cone (one at a time), Shift+click ground
 * places the probe marker; Alt+click a unit tracks it, Alt+click ground stops tracking; Ctrl+click as
 * the operator of an armed vehicle/gun fires a volley. Clicking an inactive view activates it.
 * Orders cannot be given while paused unless `game.options.activePause` (§5.2, §6.8).
 * @module engine/input
 */

import { ABILITIES, abilityInCampaign } from '../abilities/index.js';
import { CONFIG } from '../config.js';
import { abilitiesForKey, codeOf } from './hotkeys.js';
import { TouchGame } from '../input/touch-game.js';

/** Action → list of KeyboardEvent.code. Edit here to rebind. Chords (Ctrl+S/L/B) are in CTRL_BINDINGS. */
export const KEY_BINDINGS = {
  panUp: ['ArrowUp'],
  panDown: ['ArrowDown'],
  panLeft: ['ArrowLeft'],
  panRight: ['ArrowRight'],
  zoomIn: ['NumpadAdd', 'Equal'], // §5.1 numpad + (laptop alias = / +)
  zoomOut: ['NumpadSubtract', 'Minus'],
  zoomReset: ['NumpadMultiply', 'Backspace'], // numpad * (laptop alias Backspace)
  crawl: ['KeyC'], // C = lie down / crawl
  stand: ['KeyS'], // S = stand up
  select1: ['Digit1'],
  select2: ['Digit2'],
  select3: ['Digit3'],
  select4: ['Digit4'],
  select5: ['Digit5'],
  select6: ['Digit6'],
  select7: ['Digit7'], // guest
  selectAll: ['Digit8'],
  deselect: ['Digit0'],
  centerSelection: ['Home'],
  cancel: ['Escape'],
  pause: ['KeyP', 'Pause'],
  knapsackSide: ['Tab'],
  help: ['F1'],
  views1: ['F2'],
  views2: ['F3'],
  views3: ['F4'],
  views4: ['F5'],
  views5: ['F6'],
  views6: ['F7'],
  quickSave: ['F8'],
  quickLoad: ['F9'],
  dragBody: ['KeyH'], // held with Shift: the drag hand (bodies-design §C.5; plain H stays the `hand` hotkey)
};

/** Bindings that fire only with Shift held (their key alone keeps its normal meaning). */
export const SHIFT_BINDINGS = new Set(['dragBody']);

/** Ctrl (or ⌘) chords: code → action (§5.1). */
export const CTRL_BINDINGS = { KeyS: 'quickSave', KeyL: 'quickLoad', KeyB: 'notes' };

/** Mouse tuning (§5.2). */
export const MOUSE = {
  dragThresholdPx: 6, // right-button movement before it becomes a selection box
  doubleClickMs: 350,
  doubleClickPx: 6,
  minPickPx: 16, // minimum picking radius in pixels
  formationSpacing: 1.2, // m between men of a group move
  tooltipDelay: 0.8, // s of hover before the tooltip
};

/** Abilities whose cursor stays armed after a use (weapons: one shot/burst per click, §5.2). */
const WEAPON_IDS = new Set(['pistol', 'rifle', 'sniper', 'sniperRifle', 'smg', 'harpoon', 'grenade']);
/** Melee abilities: double-click runs to the target (§5.2). */
const isWeapon = (def) => !!(def.weapon ?? def.keepCursor ?? WEAPON_IDS.has(def.id));

/** Normalise an ability hotkey ('x', 'X', 'KeyX') to a KeyboardEvent.code. */
export function hotkeyToCode(h) {
  if (!h) return null;
  if (h.length === 1) return /[0-9]/.test(h) ? `Digit${h}` : `Key${h.toUpperCase()}`;
  return h;
}

/**
 * §4.10 selection rules [manual]: may this man be part of a multi-selection? Not while captured,
 * jailed, or held under fire (`held`).
 */
export function multiSelectable(c) {
  return !!c && !c.held && c.state !== 'held' && c.state !== 'captured' && c.state !== 'jailed';
}

export class Input {
  /**
   * @param {import('../game.js').Game} game
   * @param {HTMLElement} domElement canvas
   */
  constructor(game, domElement) {
    this.game = game;
    this.domElement = domElement;
    this.bindings = KEY_BINDINGS;
    this.held = new Set();
    /** Active targeting: {abilityId, def, commando, commandos[]} | null */
    this.targeting = null;
    /** 'track' after clicking the HUD camera icon: the next unit click is tracked (§2.3). */
    this.mode = null;
    this.cursor = '';
    this.enabled = true;
    this.mods = { shift: false, ctrl: false, alt: false };
    this._press = null; // right-button press {x, y, box}
    this._lastClick = null; // {t, x, y}
    this._boxEl = null;
    this._hover = { x: 0, y: 0, t: 0, shown: false, inside: false };
    this._listeners = [];
    /** Fingers on the canvas (tap / drag-pan / pinch-zoom, input/touch-game.js); mouse and pen stay here. */
    this.touch = domElement ? new TouchGame(game, domElement) : null;
    if (domElement) this._attach();
  }

  // ------------------------------------------------------------ helpers

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  /** Is any key bound to `action` currently held? */
  isDown(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.held.has(c)) return true;
    return false;
  }

  /** Action name for a key code, or null. */
  actionFor(code) {
    for (const [action, codes] of Object.entries(this.bindings)) if (codes.includes(code)) return action;
    return null;
  }

  get world() {
    return this.game.world;
  }

  get active() {
    const s = this.game.state;
    return this.enabled && this.world && (s === 'playing' || s === 'paused');
  }

  /** May orders be given now? Not while paused in faithful mode (§5.2). */
  get canOrder() {
    return this.active && (this.game.state === 'playing' || !!this.game.options?.activePause);
  }

  /** May vision cones be inspected now (Shift+click, plain click, eye tool, probe)? Same rule as orders:
   *  faithful pause forbids cone inspection; only the ⚑ active-pause option allows it (§6.8). */
  get canInspect() {
    return this.canOrder;
  }

  /** Currently selected commandos (live, alive). */
  get selection() {
    return this.world ? this.world.commandos.filter((c) => c.selected && c.alive) : [];
  }

  setCursor(cursor) {
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    if (typeof document !== 'undefined') document.body.dataset.cursor = cursor || '';
    this.game.events?.emit('ui:cursor', { cursor });
  }

  // ------------------------------------------------------------ selection

  /**
   * Select commandos.
   * @param {any[]} units
   * @param {{add?: boolean, toggle?: boolean}} [opts]
   */
  select(units, opts = {}) {
    const w = this.world;
    if (!w) return;
    const pickable = units.filter((u) => u && u.kind === 'commando' && u.alive && u.state !== 'dead');
    const next = new Set(opts.add || opts.toggle ? w.commandos.filter((c) => c.selected && c.alive) : []);
    for (const u of pickable) {
      if (opts.toggle && next.has(u)) next.delete(u);
      else next.add(u);
    }
    // §4.10: a captured or jailed man, or one held under fire, cannot be multi-selected — he can
    // only be selected alone (portrait, key, a click, or a box that holds nobody else).
    if (next.size > 1) for (const c of [...next]) if (!multiSelectable(c)) next.delete(c);
    for (const c of w.commandos) c.selected = next.has(c);
    if (this.targeting) {
      this.targeting.commandos = this.targeting.commandos.filter((c) => c.selected);
      if (!this.targeting.commandos.length) this.cancelTargeting();
      else this.targeting.commando = this.targeting.commandos[0];
    }
    w.events.emit('unit:selected', { units: this.selection });
  }

  deselectAll() {
    this.select([]);
  }

  /** Commando for select key n (1–6 by role, 7 = guest), or null when not deployed/alive. */
  commandoForKey(n) {
    const w = this.world;
    if (!w) return null;
    // BCD guests (bcd-plan §2): 7 = Skopje, 8 = Natasha
    if (w.rules?.guests && (n === 7 || n === 8)) return w.commandos.find((c) => c.alive && c.role === (n === 7 ? 'skopje' : 'natasha')) || null;
    if (n === 7) return w.commandos.find((c) => c.alive && (c.role === 'guest' || c.guest || c.isGuest)) || null;
    const role = CONFIG.units.selectOrder[n - 1];
    return w.commandos.find((c) => c.role === role && c.alive) || null;
  }

  /**
   * Select one man by key 1–7 or his portrait (§2.3, §5.1): recentres (0.35 s) only if he is
   * off-screen; pressing the KEY of an already-selected man always recentres. Ctrl adds/removes him.
   * A portrait click on an already-selected man deselects him, as a map click does (§5.2 row 1).
   * @param {any} c
   * @param {{ctrl?: boolean, portrait?: boolean}} [opts]
   * @returns {boolean}
   */
  selectUnit(c, { ctrl = false, portrait = false } = {}) {
    if (!c || !c.alive) return false;
    const cam = this.game.cameraController;
    const already = c.selected;
    if (ctrl || (portrait && already)) this.select([c], { toggle: true });
    else this.select([c]);
    if (!c.selected) return true;
    if (already || !cam.isOnScreen(c.x, c.z, 0, 0.9)) cam.recenterOn(c.x, c.z);
    return true;
  }

  // ------------------------------------------------------------ picking

  _pxPerMeter() {
    return this.game.cameraController.pxPerMeter();
  }

  /**
   * Entity under a client-space point (screen-space proximity to the unit's body centre).
   * @param {number} clientX
   * @param {number} clientY
   * @param {(e: any) => boolean} [filter]
   */
  pickEntity(clientX, clientY, filter) {
    const w = this.world;
    if (!w) return null;
    const cam = this.game.cameraController;
    const ppm = this._pxPerMeter();
    let best = null, bestD = Infinity;
    for (const e of w.entities) {
      if (e.removed || e.kind === 'prop' || e.kind === 'projectile') continue;
      if (filter && !filter(e)) continue;
      const midY = e.pickHeight ?? (e.isLow || e.alive === false ? 0.25 : 0.9);
      const p = cam.worldToScreen(e.x, (e.y || 0) + midY, e.z);
      const r = Math.max(MOUSE.minPickPx, (e.pickRadius ?? CONFIG.units.pickRadius) * ppm);
      // Standing humanoids: accept a vertical capsule from feet to head.
      const dx = clientX - p.x;
      const halfH = e.kind === 'commando' || e.kind === 'enemy' ? (e.isLow || !e.alive ? 0.3 : 0.9) * ppm : 0;
      const dy = Math.max(0, Math.abs(clientY - p.y) - halfH);
      const d = Math.hypot(dx, dy);
      if (d <= r && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  /**
   * Resolve a target for an ability's targeting kind at a screen point.
   * @returns {any|null} entity, {x, z} point, or null
   */
  resolveTarget(def, clientX, clientY, commando) {
    const cam = this.game.cameraController;
    switch (def.targeting) {
      case 'none':
      case 'self':
        return commando;
      case 'point':
        return cam.screenToGround(clientX, clientY);
      case 'enemy':
        return this.pickEntity(clientX, clientY, (e) => (e.kind === 'enemy' && e.alive)
          || (!!def.hitsBarrels && e.interactKind === 'barrel' && !e.exploded && !e.carriedBy)
          || (!!def.hitsTankers && e.kind === 'vehicle' && !!e.def?.tanker && !e.destroyed));
      case 'unit':
        return this.pickEntity(clientX, clientY, (e) => (e.kind === 'enemy' || e.kind === 'commando') && e.alive);
      case 'body':
        return this.pickEntity(clientX, clientY, (e) => (e.kind === 'enemy' || e.kind === 'commando') && !e.alive);
      case 'vehicle':
        return this.pickEntity(clientX, clientY, (e) => e.kind === 'vehicle');
      case 'interactable':
        return this.pickEntity(clientX, clientY, (e) => e.kind === 'interactable');
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ targeting (item cursors)

  /**
   * Arm an ability cursor (hotkey or HUD button). Abilities with targeting 'none'/'self' are issued
   * immediately. G (pistol) with several men selected arms all of them: each click is a volley.
   * @param {string} abilityId
   * @returns {boolean} true if targeting started or the order was issued
   */
  beginTargeting(abilityId) {
    const def = ABILITIES[abilityId];
    if (!def || !this.canOrder) return false;
    if (!abilityInCampaign(def, this.game.world?.campaign)) return false; // not in this campaign's ruleset
    const owners = this.selection.filter((c) => c.abilities?.includes(abilityId));
    if (!owners.length) return false;
    // bodies-design §C.5: H while dragging lifts, Shift+H while shouldering lowers (def.redirect → a self order)
    const red = def.redirect?.(owners[0]);
    if (red) {
      const c = owners[0];
      this.game.enqueue(() => c.issue({ type: 'ability', id: red.id, target: red.target }));
      return true;
    }
    const group = def.id === 'pistol' || def.groupFire === true;
    const commandos = group ? owners : [owners[0]];
    if (def.targeting === 'none' || def.targeting === 'self') {
      for (const c of commandos) this.game.enqueue(() => c.issue({ type: 'ability', id: abilityId, target: c }));
      return true;
    }
    this.targeting = { abilityId, def, commando: commandos[0], commandos };
    // §3.4: the Spy moving with the syringe cursor up is a suspicious act (ABILITIES reads commando.armed).
    // The pistol sets `armed` itself when drawn (its draw time depends on it), so only the syringe here.
    if (abilityId === 'syringe') for (const c of commandos) c.armed = 'syringe';
    for (const c of commandos) c.readyTool = abilityId;   // view only: a crawling Green Beret shows the knife in his fist
    this.mode = null;
    this.setCursor(def.cursor || 'target');
    return true;
  }

  cancelTargeting() {
    if (!this.targeting) return;
    for (const c of this.targeting.commandos || []) { if (c.armed === 'syringe') c.armed = null; c.readyTool = null; }
    this.targeting = null;
    this.setCursor(this.selection.length ? 'move' : '');
  }

  /** Enter the HUD camera-icon mode: the next unit click is tracked (§2.3). */
  beginTrackPick() {
    this.cancelTargeting();
    this.mode = 'track';
    this.setCursor('track');
  }

  _updateTargetCursor(clientX, clientY) {
    const t = this.targeting;
    if (!t) return;
    const target = this.resolveTarget(t.def, clientX, clientY, t.commando);
    if (!target) {
      this.setCursor(t.def.targeting === 'point' ? t.def.cursor || 'target' : 'forbidden');
      return;
    }
    const ok = t.def.canUse ? t.def.canUse(t.commando, target, this.world) : true;
    // def.cursorFor: a target-dependent cursor (H over a body a non-GB/Spy would drag → hand_drag, §C.5)
    this.setCursor(ok === true ? t.def.cursorFor?.(t.commando, target, this.world) || t.def.cursor || 'target' : 'forbidden');
  }

  _tryIssueTargeted(clientX, clientY, run) {
    const t = this.targeting;
    const target = this.resolveTarget(t.def, clientX, clientY, t.commando);
    if (!target) return false;
    let issued = 0;
    for (const c of t.commandos) {
      const ok = t.def.canUse ? t.def.canUse(c, target, this.world) : true;
      if (ok !== true) {
        if (t.commandos.length === 1) this.world.events.emit('message', { text: typeof ok === 'string' ? ok : "Can't do that", kind: 'warn', unit: c });
        continue;
      }
      const id = t.abilityId;
      this.game.enqueue(() => c.issue({ type: 'ability', id, target, run }));
      issued++;
    }
    if (issued && !isWeapon(t.def)) {
      // a second click within the double-click window upgrades the walk to a run (§5.2 melee double-click)
      this._lastIssue = { t: performance.now(), id: t.abilityId, target, commandos: t.commandos.slice() };
      this.cancelTargeting();
    }
    return issued > 0;
  }

  // ------------------------------------------------------------ orders

  /**
   * Move the selection to a ground point (§5.2): each man paths independently; a group spreads around
   * the click point with 1.2 m formation offsets (first man on the point, the rest on 1.2 m rings).
   * @returns {object[]} the orders issued
   */
  orderMove(x, z, run = false) {
    const sel = this.selection;
    const orders = [];
    const s = MOUSE.formationSpacing;
    sel.forEach((c, k) => {
      let ox = 0, oz = 0;
      if (k > 0) {
        const ring = k <= 6 ? 1 : 2;
        const slots = ring === 1 ? Math.min(6, sel.length - 1) : Math.max(1, sel.length - 7);
        const idx = ring === 1 ? k - 1 : k - 7;
        const a = (idx / slots) * Math.PI * 2;
        ox = Math.cos(a) * s * ring;
        oz = Math.sin(a) * s * ring;
      }
      const order = { type: 'move', x: x + ox, z: z + oz, run };
      orders.push(order);
      this.game.enqueue(() => c.issue(order));
    });
    return orders;
  }

  /** Ability defs bound to a key code (§5.1 A–X), in registry order. */
  abilitiesForCode(code) {
    const rules = this.game.world?.rules;
    // BCD (bcd-plan §2): the ruleset's key map; BEL keeps each def's own hotkey (unchanged)
    if (rules?.hotkeys) {
      const out = abilitiesForKey(code, rules);
      // BCD §1.3: while a selected man controls a puppet, the def's `puppetKey` (D: talk) takes the key first
      if (this.selection.some((c) => c.puppet)) for (const def of Object.values(ABILITIES)) if (def.puppetKey && codeOf(def.puppetKey) === code) out.unshift(def);
      return out;
    }
    const out = [];
    for (const def of Object.values(ABILITIES)) if (hotkeyToCode(def.hotkey) === code) out.push(def);
    return out;
  }

  // ------------------------------------------------------------ keyboard

  _attach() {
    const el = this.domElement;
    this._on(window, 'keydown', (e) => this._keyDown(e));
    this._on(window, 'keyup', (e) => this._keyUp(e));
    this._on(window, 'blur', () => { this.held.clear(); this.mods = { shift: false, ctrl: false, alt: false }; });
    this._on(el, 'contextmenu', (e) => e.preventDefault());
    this._on(el, 'pointerdown', (e) => this._pointerDown(e));
    this._on(window, 'pointermove', (e) => this._pointerMove(e));
    this._on(window, 'pointerup', (e) => this._pointerUp(e));
    this._on(el, 'pointerleave', () => { this._hover.inside = false; this._hideTooltip(); });
  }

  _setMods(e) {
    this.mods = { shift: !!e.shiftKey, ctrl: !!(e.ctrlKey || e.metaKey), alt: !!e.altKey };
  }

  _keyUp(e) {
    this.held.delete(e.code);
    this._setMods(e);
    this._refreshCursor();
  }

  /** Resolve the action of a key event (Ctrl chords, event.key for + − *, then codes). */
  keyAction(e) {
    const ctrl = !!(e.ctrlKey || e.metaKey);
    if (ctrl && CTRL_BINDINGS[e.code]) return CTRL_BINDINGS[e.code];
    if (e.key === '+') return 'zoomIn';
    if (e.key === '*') return 'zoomReset';
    if (e.key === '-' && e.code !== 'Minus') return 'zoomOut';
    const a = this.actionFor(e.code);
    if (ctrl && a && /^Key/.test(e.code)) return null; // Ctrl+letter is never an action key
    return a;
  }

  _keyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    this.held.add(e.code);
    this._setMods(e);
    const g = this.game;
    if (!this.world) return;
    let action = this.keyAction(e);
    const ctrl = this.mods.ctrl;
    const defs = !ctrl && !e.altKey ? this.abilitiesForCode(e.code) : [];
    // §5: preventDefault on every bound key (F1 help, F5 reload, Tab focus, Ctrl+S/L/B, page scroll…)
    if (action || defs.length || /^F\d+$/.test(e.code)) e.preventDefault();
    this._refreshCursor();
    const cam = g.cameraController;
    switch (action) {
      case 'pause':
        if (!e.repeat && (g.state === 'playing' || g.state === 'paused')) g.togglePause();
        return;
      case 'cancel':
        if (e.repeat) return;
        if (this.targeting || this.mode) { this.cancelTargeting(); this.mode = null; this._refreshCursor(); }
        else if (g.state === 'playing' && this.selection.some((c) => c.puppet)) { // BCD §1.3: Esc releases the puppet
          for (const c of this.selection) if (c.puppet) g.enqueue(() => c.releaseBcdPuppet());
        } else if (g.state === 'briefing') (g.flow?.begin ? g.flow.begin() : g.start());
        else if (g.state === 'playing' || g.state === 'paused') this.toggleMenu();
        return;
      case 'zoomIn': cam.zoomStep(1); return;
      case 'zoomOut': cam.zoomStep(-1); return;
      case 'zoomReset': cam.zoomReset(); return;
      case 'quickSave': if (!e.repeat) g.quickSave(); return;
      case 'quickLoad': if (!e.repeat) g.quickLoad(); return;
      case 'notes': case 'help': case 'knapsackSide':
        if (!e.repeat) g.events.emit('ui:command', { command: action === 'knapsackSide' ? 'knapsack-side' : action });
        return;
      case 'centerSelection': {
        const s = this.selection;
        if (s.length) cam.recenterOn(s.reduce((a, c) => a + c.x, 0) / s.length, s.reduce((a, c) => a + c.z, 0) / s.length);
        return;
      }
      default:
        break;
    }
    if (action && action.startsWith('views')) {
      if (!e.repeat) g.cameraRig.setViews(Number(action.slice(5)));
      return;
    }
    if (!this.active || e.repeat) return;
    if (SHIFT_BINDINGS.has(action) && !e.shiftKey) action = null; // a Shift binding's key alone keeps its meaning
    if (action === 'dragBody') { this.beginTargeting('drag'); return; } // Shift+H (§C.5)
    if (action && /^select\d$/.test(action)) {
      this.selectUnit(this.commandoForKey(Number(action.slice(6))));
      return;
    }
    switch (action) {
      case 'deselect': this.deselectAll(); return;
      case 'selectAll':
        if (this.world.rules?.guests) { this.selectUnit(this.commandoForKey(8)); return; } // BCD: 8 = Natasha
        this.select(this.world.commandos.filter((c) => c.alive)); return;
      case 'crawl':
      case 'stand': {
        if (!this.canOrder) return;
        const stance = action === 'crawl' ? 'crawl' : 'stand';
        for (const c of this.selection) g.enqueue(() => c.issue({ type: 'stance', stance }));
        return;
      }
      default:
        break;
    }
    // Action hotkeys A–X (registry-driven; the first def a selected man owns wins).
    for (const def of defs) if (this.beginTargeting(def.id)) return;
  }

  /** Esc: open/close the game menu (pauses; closing resumes if the menu paused the game). */
  toggleMenu(open = !this.menuOpen) {
    const g = this.game;
    if (open === !!this.menuOpen) return;
    this.menuOpen = open;
    if (open) {
      this._menuPaused = g.state === 'playing';
      g.pause(true);
    } else if (this._menuPaused) {
      g.pause(false);
      this._menuPaused = false;
    }
    g.events.emit('ui:command', { command: 'menu', open });
  }

  // ------------------------------------------------------------ mouse

  _pointerDown(e) {
    if (this.touch?.owns(e)) return; // fingers: input/touch-game.js
    this.domElement.focus?.({ preventScroll: true });
    this._setMods(e);
    if (!this.active || (e.button !== 0 && e.button !== 2)) return;
    // Multi-view: clicking an inactive view only activates it (§2.3).
    const rig = this.game.cameraRig;
    if (rig && rig.count > 1) {
      const i = rig.viewAt(e.clientX, e.clientY);
      if (i >= 0 && i !== rig.activeIndex) {
        rig.activate(i);
        this._swallow = e.button;
        return;
      }
    }
    this._swallow = -1;
    this._press = { x: e.clientX, y: e.clientY, button: e.button, box: false };
    this.domElement.setPointerCapture?.(e.pointerId);
  }

  _pointerMove(e) {
    if (this.touch?.owns(e)) return;
    const h = this._hover;
    if (h.shown && (Math.abs(e.clientX - h.x) > 2 || Math.abs(e.clientY - h.y) > 2)) this._hideTooltip();
    h.x = e.clientX;
    h.y = e.clientY;
    h.t = 0;
    h.inside = e.target === this.domElement;
    this._setMods(e);
    if (!this.active) return;
    const p = this._press;
    if (p && p.button === 2) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.box && Math.hypot(dx, dy) > MOUSE.dragThresholdPx) p.box = true;
      if (p.box) this._drawBox(p.x, p.y, e.clientX, e.clientY);
      return;
    }
    this._refreshCursor();
  }

  _pointerUp(e) {
    if (this.touch?.owns(e)) return;
    if (e.button !== 0 && e.button !== 2) return;
    if (this._swallow === e.button) { this._swallow = -1; return; }
    const p = this._press;
    this._press = null;
    this.domElement.releasePointerCapture?.(e.pointerId);
    this._hideBox();
    if (!p || p.button !== e.button || !this.active) return;
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    if (e.button === 2) {
      if (p.box) this.boxSelect(p.x, p.y, e.clientX, e.clientY);
      else this.rightClick();
      return;
    }
    this.click(e.clientX, e.clientY, mods);
  }

  /** Units that can be tracked / Alt+clicked (§2.3: commandos, enemies and vehicles). */
  _pickTrackable(x, y) {
    return this.pickEntity(x, y, (u) => u.kind === 'commando' || u.kind === 'enemy' || u.kind === 'vehicle');
  }

  /** A selected commando operating an armed vehicle / manned gun (Ctrl+click volley). */
  _operator() {
    return this.selection.find((c) => c.vehicle && c.vehicle.operator === c && c.vehicle.def?.weapons?.length) || null;
  }

  /**
   * Handle a left click at a client-space point (also used by tests).
   * @param {number} clientX
   * @param {number} clientY
   * @param {{shift?: boolean, ctrl?: boolean, alt?: boolean, double?: boolean}} [mods] `double` overrides the
   *   double-click detection (touch: the gesture classifier's double tap, with a finger-sized radius)
   * @returns {string} what the click did (for tests): 'track'|'untrack'|'ability'|'volley'|'select'|
   *   'deselect'|'cone'|'probe'|'move'|'run'|'refused'|'none'
   */
  click(clientX, clientY, mods = {}) {
    const now = performance.now();
    const last = this._lastClick;
    const isDouble = typeof mods.double === 'boolean' ? mods.double : !!last && now - last.t <= MOUSE.doubleClickMs && Math.hypot(clientX - last.x, clientY - last.y) <= MOUSE.doubleClickPx;
    this._lastClick = isDouble ? null : { t: now, x: clientX, y: clientY };
    const g = this.game;
    const cam = g.cameraController;
    const li = this._lastIssue;
    this._lastIssue = null;
    if (isDouble && li && now - li.t <= MOUSE.doubleClickMs && this.canOrder) {
      for (const c of li.commandos) g.enqueue(() => c.issue({ type: 'ability', id: li.id, target: li.target, run: true }));
      return 'ability';
    }
    if (this.mode === 'track' || mods.alt) {
      const u = this._pickTrackable(clientX, clientY);
      this.mode = null;
      this._refreshCursor();
      if (u) { cam.track(u); return 'track'; }
      if (mods.alt) { cam.untrack(); return 'untrack'; }
      return 'none';
    }
    if (this.targeting) {
      if (!this.canOrder) return 'refused';
      return this._tryIssueTargeted(clientX, clientY, isDouble) ? 'ability' : 'none';
    }
    if (mods.ctrl) {
      const op = this._operator();
      // VEHICLES §3.7: the operator fires the vehicle / emplacement weapon (vehicleFire ability) at the
      // enemy / vehicle under the cursor, else at the ground point.
      const target = op && (this.pickEntity(clientX, clientY, (e) => (e.kind === 'enemy' && e.alive) || (e.kind === 'vehicle' && e !== op.vehicle && !e.destroyed))
        || cam.screenToGround(clientX, clientY));
      if (op && target && this.canOrder) {
        g.enqueue(() => op.issue({ type: 'ability', id: 'vehicleFire', target }));
        return 'volley';
      }
    }
    const commando = this.pickEntity(clientX, clientY, (u) => u.kind === 'commando' && u.alive);
    if (commando) {
      // A map click never recentres (§2.3). Click a selected man → deselect him; Ctrl → add/remove.
      const was = commando.selected;
      if (mods.ctrl || was) this.select([commando], { toggle: true });
      else this.select([commando]);
      return commando.selected ? 'select' : 'deselect';
    }
    if (mods.shift) {
      if (!this.canInspect) return 'refused'; // §6.8: no cone inspection / probe while paused (faithful)
      const t = this.pickEntity(clientX, clientY, (u) => (u.kind === 'enemy' && u.alive) || (u.kind === 'vehicle' && u.vision));
      if (t) {
        g.showOnlyCone(t.coneVisible ? null : t);
        return 'cone';
      }
      const gp = cam.screenToGround(clientX, clientY);
      if (gp) g.probe(gp.x, gp.z);
      return 'probe';
    }
    if (this.canOrder && this._vehicleClick(clientX, clientY)) return 'board'; // VEHICLES: click a vehicle = get in
    const enemy = this.pickEntity(clientX, clientY, (u) => u.kind === 'enemy' && u.alive);
    if (enemy && !this.selection.length) {
      if (!this.canInspect) return 'refused'; // §6.8
      g.toggleCone(enemy);
      return 'cone';
    }
    const ground = cam.screenToGround(clientX, clientY);
    if (!ground || !this.selection.length) return 'none';
    if (!this.canOrder) return 'refused';
    this.orderMove(ground.x, ground.z, isDouble);
    this.world.events.emit('ui:move-marker', { x: ground.x, z: ground.z, run: isDouble });
    return isDouble ? 'run' : 'move';
  }

  /**
   * Right-click (§5.2): cancel the item cursor (weapons are holstered); otherwise each selected man
   * cancels his context action (drop body/barrel, rise from the snow, end distraction, hang) through
   * the optional `commando.rightClickCancel()` hook. Never deselects.
   * @returns {string} 'cancel'|'context'|'none'
   */
  rightClick() {
    if (this.targeting) {
      const t = this.targeting;
      this.cancelTargeting();
      // holster (§3.2): the commando's {type:'cancel'} order puts a drawn pistol away
      if (isWeapon(t.def)) for (const c of t.commandos) if (c.armed) this.game.enqueue(() => (c.holster ? c.holster() : c.issue?.({ type: 'cancel' })));
      return 'cancel';
    }
    if (this.mode) {
      this.mode = null;
      this._refreshCursor();
      return 'cancel';
    }
    // context cancel (drop body/barrel, rise, end distraction, hang, holster): commando {type:'cancel'} order
    const cancellable = (c) => !!(c.armed || c.carrying || c.buried || c.currentAction || c.pendingAbility || c.path?.[c.pathIndex]?.link?.kind === 'climb');
    const sel = this.selection.filter((c) => typeof c.rightClickCancel === 'function' || (typeof c.issue === 'function' && cancellable(c)));
    for (const c of sel) this.game.enqueue(() => (c.rightClickCancel ? c.rightClickCancel() : c.issue({ type: 'cancel' })));
    return sel.length ? 'context' : 'none';
  }


  /**
   * VEHICLES (§3.7, §5.2): a plain click on a vehicle sends the selected commandos on foot to get in
   * (enterVehicle). Ctrl+click fire is handled in click() through _operator().
   * @returns {boolean} handled
   */
  _vehicleClick(clientX, clientY) {
    const sel = this.selection;
    if (!sel.length) return false;
    const veh = this.pickEntity(clientX, clientY, (e) => e.kind === 'vehicle' && !e.destroyed);
    const walkers = sel.filter((c) => !c.vehicle && c.abilities.includes('enterVehicle'));
    if (!veh || !walkers.length) return false;
    for (const c of walkers) this.game.enqueue(() => c.issue({ type: 'ability', id: 'enterVehicle', target: veh }));
    return true;
  }

  /** Right-drag box (§5.2): REPLACES the selection with the commandos inside the client rectangle. */
  boxSelect(x0, y0, x1, y1) {
    const cam = this.game.cameraController;
    const [minX, maxX] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [minY, maxY] = [Math.min(y0, y1), Math.max(y0, y1)];
    const inside = this.world.commandos.filter((c) => {
      if (!c.alive) return false;
      const p = cam.worldToScreen(c.x, (c.y || 0) + 0.5, c.z);
      return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    });
    this.select(inside);
    return inside;
  }

  // ------------------------------------------------------------ cursor + tooltip (§5.3)

  /** Context cursor from the pointer, modifiers and mode (the software cursor itself is UI's). */
  _refreshCursor() {
    if (!this.world) return;
    const h = this._hover;
    if (this.targeting) {
      this._updateTargetCursor(h.x, h.y);
      return;
    }
    let c;
    if (this.mode === 'track') c = 'track';
    else if (this.mods.shift) c = 'eye';
    else if (this.mods.ctrl && this._operator()) c = 'gunsight';
    else if (!h.inside || !this.selection.length) c = 'arrow';
    else c = 'move';
    this.setCursor(c);
  }

  /**
   * Per-frame (real time) update from Game.render: hover tooltip after 0.8 s (§5.2).
   * @param {number} dt
   */
  update(dt) {
    this.touch?.update(dt);
    const h = this._hover;
    if (!this.world || !h.inside || h.shown || this._press) return;
    h.t += dt;
    if (h.t < MOUSE.tooltipDelay) return;
    h.shown = true;
    const e = this._pickTrackable(h.x, h.y) || this.pickEntity(h.x, h.y, (u) => u.kind === 'interactable');
    if (!e) return;
    const text = e.nickname || e.label || e.name || e.soldierType || e.vehicleType || e.kind;
    this.game.events.emit('ui:tooltip', { text, x: h.x, y: h.y, entity: e });
  }

  _hideTooltip() {
    const h = this._hover;
    if (!h.shown) return;
    h.shown = false;
    h.t = 0;
    this.game.events?.emit('ui:tooltip', { text: null });
  }

  // ------------------------------------------------------------ selection box (red, §5.2)

  _drawBox(x0, y0, x1, y1) {
    if (!this._boxEl) {
      this._boxEl = document.createElement('div');
      this._boxEl.className = 'select-box';
      Object.assign(this._boxEl.style, {
        position: 'fixed', boxSizing: 'border-box', border: '2px solid rgb(220,0,0)',
        background: 'rgba(220,0,0,0.25)', pointerEvents: 'none', zIndex: '6',
      });
      document.body.appendChild(this._boxEl);
    }
    const s = this._boxEl.style;
    s.display = 'block';
    s.left = `${Math.min(x0, x1)}px`;
    s.top = `${Math.min(y0, y1)}px`;
    s.width = `${Math.abs(x1 - x0)}px`;
    s.height = `${Math.abs(y1 - y0)}px`;
  }

  _hideBox() {
    if (this._boxEl) this._boxEl.style.display = 'none';
  }

  /** Called when a mission is loaded/unloaded. */
  reset() {
    this.targeting = null;
    this.mode = null;
    this.menuOpen = false;
    this._menuPaused = false;
    this._press = null;
    this._lastClick = null;
    this._lastIssue = null;
    this.touch?.reset();
    this.setCursor('');
    this._hideBox();
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
    this.touch?.dispose();
    this._boxEl?.remove();
  }
}
