/**
 * HUD orchestrator (design-spec §5.3, §6; owned by UI). A DOM overlay over the canvas (#hud) laid out in BEL
 * reference px × uiScale. Parts: top bar with portraits, warnings, talking-portrait slots and the icon row
 * (topbar.js); right column with the notebook minimap (notebook.js), hand and knapsack (knapsack.js); software
 * cursor (cursor.js); tooltips; messages + subtitles; briefing (two parts); mission end / debrief; pause + Esc
 * menu + options; title / mission select / credits screens. Consumes game.flow + world state + events only.
 * @module ui/hud
 */

import { CONFIG } from '../config.js';
import { ABILITIES } from '../abilities/index.js';
import { el } from './dom.js';
import { computeUiScale, loadOptions, saveOptions, VOLUME_CHANNELS } from './ui-config.js';
import { TopBar } from './topbar.js';
import { Notebook } from './notebook.js';
import { Knapsack } from './knapsack.js';
import { StanceButton } from './stance-button.js';
import { CursorLayer } from './cursor.js';
import { installIconFallback, preloadIcons, refreshIcons } from './icon-art.js';
import { Tooltips } from './tooltip.js';
import { Messages } from './messages.js';
import { Briefing } from './briefing.js';
import { Debrief } from './debrief.js';
import { Menus } from './menus.js';
import { Screens } from './screens.js';
import { TalkingPortraits, themeFor } from './talking-portraits.js';
import { MenuKit } from './menu-kit.js';
import { UiSound } from './ui-sound.js';
import { Profiles } from './profiles.js';
import { Help } from './help.js';
import { Loading } from './loading.js';
import { Backdrop } from './backdrop.js';
import { Boot } from './boot.js';
import { installTouch, isTouchUI, touchHudScales } from './touch.js';
import { PRESET_CHOSEN_KEY } from '../engine/device.js';
import { KEY_BINDINGS } from '../engine/input.js';
import { setInsignia } from '../art/insignia.js';

function ensureStylesheet() {
  for (const [key, href] of [['uiCss', 'styles/ui.css'], ['menusCss', 'styles/menus.css'], ['screensCss', 'styles/menus-screens.css']]) {
    if (document.querySelector(`link[data-${key.replace('Css', '-css')}]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.dataset[key] = '1';
    document.head.appendChild(l);
  }
}

export class HUD {
  /**
   * @param {import('../game.js').Game} game
   * @param {HTMLElement} root #hud element
   */
  constructor(game, root) {
    this.game = game;
    this.root = root;
    /** main.js skips its fallback briefing / title when true. */
    this.showsBriefing = true;
    this.showsTitle = true;
    ensureStylesheet();
    installIconFallback();
    root.classList.add('ui-hud');
    // keep the Game's defaults (edgeScrollOverHud, warnings, cheats…) and overlay the saved §6.8 options
    this.options = Object.assign(game.options || {}, loadOptions());
    game.options = this.options; // other systems read §6.8 options here (halt behaviour, voice, blood…)
    this._applyGameOptions();
    this.devUnlock = /[?&](unlock|dev)=1\b/.test(globalThis.location?.search || '');
    this.clock = 0;
    this.world = null;
    this.def = null;
    this.tracked = null;
    this._losses = { soldiers: 0, vehicles: 0, buildings: 0 };
    this.topbar = new TopBar(this);
    /** §6.3 talking portraits (docs/talking-portraits.md): per-mission TalkingPortraits, null while off / loading. */
    this.portraits = null;
    this.portraitsBase = 'assets/portraits/';
    // photo stills for the briefing / knapsack / top bar as early as possible (clips load per mission)
    if (typeof document !== 'undefined' && this.options.talkingPortraits !== false) TalkingPortraits.probe({ base: this.portraitsBase });
    this.right = el('div', 'hud-right', root);
    this.strap = el('div', 'strap', this.right);
    this.notebook = new Notebook(this, this.right);
    this.bottom = el('div', 'hud-right-bottom', root);
    this.knapsack = new Knapsack(this, this.bottom);
    this.stance = new StanceButton(this, this.bottom); // first in the cluster: immediately left of the hand
    this.cursor = new CursorLayer(this);
    this.tooltips = new Tooltips(this);
    this.messages = new Messages(this);
    this.briefing = new Briefing(this);
    this.debrief = new Debrief(this);
    // docs/menus-art-direction.md: one menu kit for every card, UI sounds, profiles, S01–S03, S11, S14, backdrops
    this.sound = new UiSound(() => this.game.audio);
    this.profiles = new Profiles();
    this.kit = new MenuKit({ parent: root, sound: this.sound, prefs: () => this.options });
    this.kit.applyPrefs();
    this.kit.onEmpty = () => { if (this.world && this.menus?.view) this.menus.close(true); }; // Esc out of the last card resumes
    this.menus = new Menus(this);
    this.screens = new Screens(this);
    this.help = new Help(this);
    this.loading = new Loading(this);
    this.backdrop = new Backdrop(this);
    this.boot = new Boot(this);
    if (typeof window !== 'undefined' && typeof document !== 'undefined') this.touch = installTouch(this); // phones: taps everywhere
    this.toastEl = el('div', 'mk-toast', root);
    this.toastEl.hidden = true;
    this._applyScale();
    this._onResize = () => this._applyScale();
    window.addEventListener('resize', this._onResize);
    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey, true);
    this._subs = [];
    this._listen();
    this._syncVisibility();
  }

  // ------------------------------------------------------------ state helpers

  get playing() {
    return !!this.world && (this.game.state === 'playing' || this.game.state === 'paused');
  }

  /** CSS px the §6.1 top bar covers at the top of the screen (45 ref px + 2 px border, × UI scale); the camera clears it. */
  get topBarHeight() {
    return 47 * (this.scale || 1);
  }

  _applyScale() {
    const byH = computeUiScale(innerHeight, this.options.uiScale);
    const byW = Math.max(0.6, innerWidth / 600); // phone-width tolerance: the bar must fit
    this.scale = Math.min(byH, byW);
    const rs = document.documentElement.style;
    rs.setProperty('--u', String(this.scale));
    // a finger: the top bar and the bag get finger-sized (--ut / --ub, html.mk-touch only; styles/ui.css)
    const touch = isTouchUI(), men = this.topbar?.row?.childElementCount || 3;
    this._touchKey = `${touch}|${men}`;
    let iconScale = this.scale;
    if (touch) {
      const { ut, ub } = touchHudScales({ u: this.scale, byH, w: innerWidth, h: innerHeight, men });
      rs.setProperty('--ut', String(ut));
      rs.setProperty('--ub', String(ub));
      iconScale = ut; // the icon tier follows the bar (the bag's ~1.15× needs no heavier tier preloaded at boot)
    } else {
      rs.removeProperty('--ut');
      rs.removeProperty('--ub');
    }
    // rendered icons: srcset x-descriptors depend on the UI scale; preload the tiers this scale × DPR will use
    const key = `${iconScale}|${globalThis.devicePixelRatio || 1}`;
    if (key !== this._iconKey) {
      this._iconKey = key;
      refreshIcons(this.root, iconScale);
      this.topbar?.eyeAnim?.refresh(iconScale);
      this.iconsReady = preloadIcons(iconScale);
    }
  }

  /** Push the §6.8 options other systems read as plain fields (camera, AI halt behaviour). */
  _applyGameOptions() {
    const o = this.options, g = this.game;
    if (g.cameraRig) {
      g.cameraRig.edgeScroll = o.edgeScroll !== false;
      g.cameraRig.wheelZoom = o.wheelZoom !== false;
      g.cameraRig.setYaw?.(Number.isFinite(o.cameraAngle) ? o.cameraAngle : CONFIG.camera.yawDeg); // Options → CAMERA ANGLE
    }
    CONFIG.ai.submissive = o.halt === 'submissive'; // §4.5 Submissive / Indifferent
    setInsignia(o.insignia); // Options → INSIGNIA: enemy flag layout (art/flags.js repaints live flags)
    // OPTIONS → CONTROLS rebinding: overrides on top of engine/input.js KEY_BINDINGS
    if (g.input && 'bindings' in g.input) g.input.bindings = { ...KEY_BINDINGS, ...(o.bindings || {}) };
    // AUDIO (§9.2 / §9.4 / §6.5) keeps its own option names
    const a = g.audio;
    if (a?.setOption && a.options) {
      const want = { laconic: o.voice === 'laconic', natureSounds: o.nature !== false, subtitles: o.subtitles !== false,
        missionMusic: o.missionMusic !== 'classic' };
      for (const [k, v] of Object.entries(want)) if (k in a.options && a.options[k] !== v) a.setOption(k, v);
    }
  }

  /** Write one option (persisted) and apply it. `quiet` skips the click (the menu kit plays its own sounds). */
  setOption(key, value, o = {}) {
    this.options[key] = value;
    saveOptions(this.options);
    this._applyGameOptions();
    const a = this.game.audio;
    const vol = VOLUME_CHANNELS[key];
    if (vol) a?.setVolume?.(vol, value);
    if (key === 'uiScale') this._applyScale();
    if (key === 'preset') {
      this.game.renderer?.setPreset?.(value);
      try { globalThis.localStorage?.setItem(PRESET_CHOSEN_KEY, '1'); } catch { /* private mode */ } // engine/device.js
    }
    if (/^(textScale|highContrast|reducedMotion|grain)$/.test(key)) this.kit.applyPrefs();
    if (key === 'menuBg' || key === 'reducedMotion') this.backdrop?.setMode(this.backdrop.mode);
    if (!o.quiet) this.game.events.emit('ui:click', { sfx: 'ui_click' });
  }

  /** S22 toast: a small typed slip bottom-centre for 2.4 s (GAME SAVED, QUICK SAVE…). */
  toast(text) {
    const t = this.toastEl;
    t.textContent = text;
    t.hidden = false;
    t.classList.remove('on');
    void t.offsetWidth;
    t.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.hidden = true; }, 2400);
  }

  message(text, kind = 'info') {
    this.messages.show(text, kind);
  }

  _syncVisibility() {
    const inMission = this.playing;
    this.root.classList.toggle('in-mission', inMission);
    this.root.classList.toggle('paused', this.game.state === 'paused');
  }

  _listen() {
    const on = (t, fn) => this._subs.push(this.game.events.on(t, fn));
    const isCommando = (u) => u && (u.kind === 'commando' || u.faction === 'player');
    on('message', (m) => m?.kind !== 'bark' ? this.message(m?.text, m?.kind) : this.messages.bark({ unit: m.unit, text: m.text }));
    on('bark', (b) => this.messages.bark(b));
    on('enemy:heard-steps', (p) => this.messages.mark(p?.enemy)); // house rule runningNoise: "?" over the guard
    on('mission:refused', (p) => this.message(p?.reason || 'ALL YOUR MEN MUST ESCAPE.', 'warn'));
    on('ui:warning', (p) => this.topbar.flag(p?.unit, p?.kind || 'seen'));
    on('unit:held', (p) => p?.held !== false && this.topbar.flag(p?.unit, 'held', 1.5));
    on('shot', (p) => isCommando(p?.target) && this.topbar.flag(p.target, 'hurt'));
    on('unit:damaged', (p) => isCommando(p?.unit) && this.topbar.flag(p.unit, 'hurt'));
    on('ui:move-marker', (p) => p && this.cursor.marker(p.x, p.z));
    on('unit:killed', (p) => {
      if (p?.unit?.kind === 'enemy' || p?.unit?.faction === 'enemy') this._losses.soldiers++;
    });
    on('vehicle:destroyed', () => this._losses.vehicles++);
    on('structure:destroyed', (e) => { if (e?.type !== 'fence-gap') this._losses.buildings++; }); // (a hole cut in the wire is no building)
    on('objective:update', ({ objective } = {}) => objective?.done && !objective.hidden && this.message(`OBJECTIVE COMPLETED: ${objective.text}`.toUpperCase(), 'info'));
    on('game:state', ({ to } = {}) => this.onState(to));
    on('mission:won', (p) => this.debrief.won(p));
    on('mission:lost', (p) => this.debrief.lost(p));
    // CORE2 §8.1: escaped with targets left → dialog; (C)ONTINUE gives the objectives 15 s (game.continueEscape)
    on('mission:escaped', () => this.debrief.escapedEarly(() => this.game.continueEscape?.()));
    // CORE2 §8.1: a loss condition started its 5 s countdown — say why on the message line
    on('mission:countdown', (p) => p?.reason && this.message(String(p.reason).toUpperCase(), 'warn'));
  }

  /** Game state changes → which overlay is up. */
  onState(to) {
    if (to === 'playing' || to === 'paused') {
      if (this.briefing.active) this.briefing.close();
      this.debrief.close();
    }
    if (to === 'title') this.closeAll();
    if (to === 'paused' && this.notebook.notesOpen) this.menus.suppressPauseCard(true);
    this.menus.sync();
    this._syncVisibility();
  }

  closeAll() {
    this.briefing.close();
    this.debrief.close();
    this.menus.close(false);
    this.notebook.hideNotes?.();
    this.messages.clear();
    this.cursor.setMode(null);
    this.tracked = null;
  }

  /** Called by Game.loadMission (state is already 'briefing'). */
  onMissionLoaded(world, def) {
    this.world = world;
    this.def = def;
    this._losses = { soldiers: 0, vehicles: 0, buildings: 0 };
    // S14: while the loading screen owns the kit (load / quick load / start without briefing) it stays up and
    // closes itself; the briefing is skipped
    const viaLoading = !!this.loading?.active;
    if (viaLoading) {
      this.briefing.close();
      this.debrief.close();
      this.notebook.hideNotes?.();
      this.messages.clear();
    } else {
      this.closeAll();
      this.hideScreens();
    }
    this.topbar.build(world);
    this._mountPortraits(world, def);
    this.notebook.build(def);
    this.knapsack.sig = '';
    if (this.game.state === 'briefing' && !viaLoading) this.briefing.open(def);
    this._syncVisibility();
  }

  /** §6.3: talking portraits into the fresh portrait slots + speaker card; the stills stay if they cannot play. */
  _mountPortraits(world, def) {
    this.portraits?.dispose();
    this.portraits = null;
    if (typeof document === 'undefined' || this.options.talkingPortraits === false) return null;
    const tp = new TalkingPortraits({ events: this.game.events, hud: this, audio: this.game.audio || null, base: this.portraitsBase });
    tp.setTheme(themeFor(def));
    this.portraits = tp;
    this.portraitsReady = tp.load(world?.commandos || []).then((ok) => {
      if (this.portraits !== tp) return false;
      if (!ok) { tp.dispose(); this.portraits = null; }
      return ok;
    });
    return this.portraitsReady;
  }

  // ------------------------------------------------------------ cross-team hooks

  /**
   * DOM element hosting commando `unitId`'s portrait (§6.3 talking portraits): other systems may append a
   * <canvas>/<video> to it; the static face shows through when the slot is empty.
   * @param {number} unitId
   * @returns {HTMLElement|null}
   */
  portraitSlot(unitId) {
    return this.topbar.portraitSlot(unitId);
  }

  // ------------------------------------------------------------ flow actions (menus, debrief, title)

  hideScreens() {
    this.screens.hideAll();
    for (const s of document.querySelectorAll('#app > .screen')) s.hidden = true;
  }

  /** main.js hook: fill the title menu (§6.8). @returns {boolean} handled */
  buildTitle(menu) {
    return this.screens.buildTitle(menu);
  }

  /** New campaign / next mission / map table / restart: the loading screen (real progress), then the briefing. */
  async startMission(id) {
    this.closeAll();
    this.hideScreens();
    const load = () => (this.game.flow ? this.game.flow.startMission(id) : this.game.loadMission(id)).then(() => true);
    const ok = this.loading ? await this.loading.run({ missionId: id, brief: true }, load) : await load().catch((err) => {
      console.error('[hud] mission load failed', err);
      return false;
    });
    if (!ok) this.game.quitToTitle?.();
  }

  restartMission() {
    const id = this.def?.id ?? this.game.missionDef?.id;
    if (id != null) this.startMission(id);
  }

  async quickLoad() {
    this.closeAll();
    this.hideScreens();
    const ok = await this.game.quickLoad();
    if (!ok && !this.world) this.game.quitToTitle?.();
    return ok;
  }

  /** End of the campaign (debrief → EPILOGUE): back to the title, the End of WWII theme, the credits roll. */
  epilogue() {
    this.quitToTitle();
    this.screens.openMain?.();
    this.game.flow?.setState('epilogue'); // music: campaign_end → credits → menu (after openMain's menu request)
    this.screens.showCredits?.({ epilogue: true });
  }

  quitToTitle() {
    this.closeAll();
    this.world = null;
    this.game.quitToTitle?.();
    this._syncVisibility();
  }

  nextMissionId() {
    const list = this.game.flow?.missions || [];
    const i = list.findIndex((m) => m.id === this.def?.id);
    return i >= 0 && list[i + 1] ? list[i + 1].id : null;
  }

  /** Enemy losses for the debrief (stats when the owners provide them, else counted from events). */
  losses() {
    const s = this.world?.stats || {};
    return {
      soldiers: s.enemiesKilled ?? Math.max(this._losses.soldiers, s.kills ?? 0),
      vehicles: s.vehiclesDestroyed ?? this._losses.vehicles,
      buildings: s.structuresDestroyed ?? this._losses.buildings,
    };
  }

  // ------------------------------------------------------------ in-mission actions

  get selection() {
    return this.world ? this.world.commandos.filter((c) => c.selected && c.alive) : [];
  }

  /** §6.1 portrait click: select; Ctrl = add/remove; a man in a vehicle/building centres on it. */
  selectFromPortrait(c, e) {
    const input = this.game.input;
    if (!c.alive || !this.playing || !input) return;
    const ctrl = !!(e?.ctrlKey || e?.metaKey);
    const at = c.vehicle || (c.hidden && (c.building || c.hideout)) || null;
    // CORE2 selectUnit applies the §2.3 recentre rule (only if off-screen); a portrait click on an
    // already-selected man deselects him, like a map click (§5.2 row 1)
    if (input.selectUnit) input.selectUnit(c, { ctrl, portrait: true });
    else if (ctrl || c.selected) input.select([c], { toggle: true });
    else input.select([c]);
    if (at && c.selected) this.game.cameraController?.centerOn(at.x, at.z);
    this.game.events.emit('ui:click', { sfx: 'ui_click' });
  }

  togglePosture() {
    const sel = this.selection;
    if (!sel.length) return;
    const stance = sel.every((c) => c.stance === 'crawl') ? 'stand' : 'crawl';
    for (const c of sel) this.game.enqueue(() => c.issue({ type: 'stance', stance }));
  }

  hideCones() {
    for (const e of this.world?.enemies || []) this.game.toggleCone?.(e, false);
  }

  /** Camera tracking tool: follow `u` until cancelled (arrow keys, death). */
  track(u) {
    this.tracked = u;
  }

  /** Hand button / H: the registry's pick-up ability when there is one, else the hand cursor tool. */
  useHand() {
    const sel = this.selection;
    const def = Object.values(ABILITIES).find((d) => String(d.hotkey || '').replace(/^Key/, '').toUpperCase() === 'H' && sel.some((c) => c.abilities?.includes(d.id)))
      || (sel.some((c) => c.abilities?.includes('handGuest')) ? ABILITIES.handGuest : null); // BCD guests (bcd-plan §1.8)
    if (def && this.game.input?.beginTargeting(def.id)) return true;
    if (!sel.length) return false;
    this.cursor.setMode(this.cursor.mode === 'hand' ? null : 'hand');
    return true;
  }

  handOn(target) {
    const sel = this.selection;
    // ABILITIES' `hand` (H: pick up / carry / hand over, §3.2) first; any pick-up style ability otherwise
    const owns = (d) => d && sel.some((c) => c.abilities?.includes(d.id));
    const def = owns(ABILITIES.hand) ? ABILITIES.hand : owns(ABILITIES.handGuest) ? ABILITIES.handGuest : Object.values(ABILITIES).find((d) => /pick|grab|carry|take/i.test(d.id) && owns(d));
    // the man the target is for first (a placed charge: the Sapper, not the first of the group), else the first owner
    const c = def && (sel.find((u) => u.abilities.includes(def.id) && def.canUse?.(u, target, this.world) === true) || sel.find((u) => u.abilities.includes(def.id)));
    if (c) this.game.enqueue(() => c.issue({ type: 'ability', id: def.id, target }));
    else this.message("Can't do that.", 'info');
  }

  /** Occupant view click: leave the vehicle / building. */
  exitShelter(u) {
    // VEHICLES leaveVehicle (warns "can't get out here" mid-river); buildings: the commando {type:'exit'} order
    if (u.vehicle && u.abilities?.includes('leaveVehicle')) this.game.enqueue(() => u.issue({ type: 'ability', id: 'leaveVehicle', target: u }));
    else this.game.enqueue(() => u.issue?.({ type: 'exit' }));
  }

  // ------------------------------------------------------------ keyboard (capture phase, before Input)

  _key(e) {
    const consume = () => {
      e.preventDefault();
      e.stopImmediatePropagation(); // also stops Input's window listener when the event targets window itself
    };
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
    if (typing && e.code !== 'Escape') return;
    if (this.boot.active) {
      if (this.boot.key(e)) consume();
      return;
    }
    const g = this.game;
    if (this.notebook.notesOpen) return consume(this.notebook.hideNotes()); // any key closes the notes
    if (this.debrief.active) {
      if (this.debrief.key(e)) consume();
      else e.stopImmediatePropagation(); // an end card owns the keyboard: no unit select / ability / quick save behind it
      return;
    }
    if (this.briefing.active) {
      if (e.code === 'Escape' || e.code === 'Enter') {
        consume();
        this.briefing.next();
      } else if (this.briefing.part === 1 && (e.code === 'Space' || e.code === 'ArrowRight')) {
        consume();
        this.briefing.advance(); // S15: Space / → advance a slide
      } else if (e.code === 'KeyN') {
        consume();
        this.briefing.toggleNarration(); // the newsreel narrator on / off (Options → Sound → NARRATION), both parts
      } else if (this.briefing.part === 1 && e.code === 'ArrowLeft') {
        consume();
        this.briefing.back(); // ← the previous slide
      } else if (this.briefing.part === 2 && (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
        consume();
        const b = this.briefing; // S16: Space / → next stop, ← previous
        b.gotoStop(e.code === 'ArrowLeft' ? Math.max(0, b.stopIx - 1) : Math.min(b.stops.length, b.stopIx + 1));
      }
      return;
    }
    // every card (front end, Esc menu, options, save/load, help, loading, confirmations) routes through the kit
    if (this.kit.active) {
      if (this.kit.key(e)) consume();
      else e.stopImmediatePropagation(); // not for the game either; the browser keeps its default (zoom, reload)
      return;
    }
    if (!this.playing) return;
    if (this.menus.key(e)) return consume(); // the P pause card's (R)ESUME
    if (e.code === 'F1') {
      consume();
      this.menus.showHelp();
    } else if (e.code === 'Escape') {
      if (g.input?.targeting) return; // Input cancels the armed ability
      consume();
      if (g.skipExtraction?.()) return; // §7.6 ESC skips the escape truck's drive-off
      if (this.cursor.mode) this.cursor.setMode(null);
      else this.menus.showEsc();
    } else if (e.code === 'Tab') {
      consume();
      this.knapsack.swapSide();
    } else if (e.code === 'KeyB' && (e.ctrlKey || e.metaKey)) {
      consume();
      this.notebook.showNotes();
    } else if (e.code === 'KeyH' && !e.repeat && g.state === 'playing') {
      if (this.useHand()) consume();
    } else if (/^Arrow/.test(e.code)) this.tracked = null;
  }

  // ------------------------------------------------------------ per frame

  /** Per-frame refresh (Game.render → hud.update(dt), real seconds). */
  update(dt = 0) {
    this.clock += dt;
    if (this.world !== this.game.world) {
      if (!this.game.world) this.world = null;
      this._syncVisibility();
    }
    this.briefing.update(dt);
    if (this.world) {
      const t = this.tracked;
      if (t && (t.removed || t.alive === false)) this.tracked = null;
      else if (t && this.game.state === 'playing') this.game.cameraController?.centerOn(t.x, t.z);
      this.topbar.update(dt);
      this.knapsack.update();
      this.stance.update();
      // touch mode toggled or the roster changed: refit the finger-sized HUD (cheap check, no layout read)
      if (`${isTouchUI()}|${this.topbar.row?.childElementCount || 3}` !== this._touchKey) this._applyScale();
      this._nbT = (this._nbT || 0) - dt;
      if (this._nbT <= 0) {
        this._nbT = 0.1;
        this.notebook.update();
      }
      this.messages.update();
    }
    this.cursor.update();
    this.tooltips.update(dt);
    this.kit.update(dt);
    this.backdrop.update(dt);
    this.touch?.update();
  }

  dispose() {
    this.portraits?.dispose();
    this.portraits = null;
    for (const off of this._subs) off?.();
    this._subs.length = 0;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey, true);
    this.cursor.dispose();
    this.tooltips.dispose();
    this.briefing.stopVoice();
    this.backdrop.dispose();
    this.kit.dispose();
    this.root.replaceChildren();
  }
}

/** Factory used by Game (pick(HudMod, 'createHud')). */
export function createHud(game, root) {
  return new HUD(game, root);
}

export default createHud;
