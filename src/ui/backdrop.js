/**
 * Menu backgrounds (docs/menus-art-direction.md §1.10 + amendments A2, A6, A7, B12):
 *  - 'frontend' B1: the live diorama (the real mission map built by the engine into the main scene: statics, terrain,
 *    water, weather; no units, no sim) seen through an olive duotone grade, the M1 wool camo scrim and the embossed
 *    emblem with its 30 s light sweep. Renders at half internal resolution, capped at 30 fps. B1s (static) when the
 *    option says STILL, reduced motion, the Low preset, low-memory devices, or until the diorama is built.
 *  - 'mission' B2: the frozen frame of the Esc press graded to the oxblood duotone; sharp inside, 20 % vignette,
 *    1.01× Ken Burns drift.
 *  - 'paper' B3 and 'off': the menu layer paints its own ground; the diorama is released.
 * Consumes Game's renderer / camera / 'mission:loading' event only; the simulation is never touched.
 * @module ui/backdrop
 */

import { el } from './dom.js';
import { CONFIG } from '../config.js';
import { MISSIONS } from '../missions/index.js';
import { normalizeMission } from '../missions/schema.js';
import { World } from '../world/world.js';
import { EventBus } from '../core/events.js';
import { assets } from '../engine/assets.js';
import * as MapBuilder from '../world/map-builder.js';
import { prepareMissionArt } from '../art/building-props.js';
import { oxbloodLUT, dioramaPath, samplePath } from './menu-model.js';

/** Theatres with a baked B1s still (assets/ui/diorama/<theater>.webp, tools/ui/bake_dioramas.mjs). */
export const STILL_THEATERS = ['temperate', 'snow']; // desert / night join when their missions ship (re-run the bake)

export class Backdrop {
  constructor(hud) {
    this.hud = hud;
    this.mode = 'off';
    this.root = el('div', 'bd', hud.root);
    hud.root.insertBefore(this.root, hud.kit.layer);
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    // B1 stack (review fix): the M1 moss camo blanket is the ground; the diorama (live, or its baked still) only
    // modulates it through a blurred grey `soft-light` pass, so it never out-shouts the badge (A7); A6 pin-pricks;
    // the badge as a pure emboss (highlight + shadow, no fill of its own) with a brass light sweep; vignette.
    // polish (art integration 2): the diorama was invisible under the blanket. It now shows through an opening in
    // the camo net: a sharp olive-duotone view (canvas-graded) under a camo layer whose mask thins it to a
    // light scrim in the middle; the blanket stays whole at the edges, the badge and the text scrim sit on top.
    this.view = el('canvas', 'bd-view', this.root);
    this.camo = el('div', 'bd-camo', this.root);
    this.grade = el('canvas', 'bd-grade', this.root);
    this.frozen = el('canvas', 'bd-frozen', this.root);
    this.speck = el('div', 'bd-speck', this.root);
    this.emblem = el('div', 'bd-emblem', this.root);
    this.emboss = el('canvas', 'bd-emboss', this.emblem);
    this.sheen = el('div', 'bd-sheen', this.emblem);
    this.vig = el('div', 'bd-vig', this.root);
    this.stillImg = null;
    this._onResize = () => { clearTimeout(this._rsT); this._rsT = setTimeout(() => { this._buildEmboss(); this._drawStill(); }, 150); };
    window.addEventListener('resize', this._onResize);
    this._buildEmboss();
    this.dio = null;
    this._timer = 0;
    this._frameT = 0;
    this._subs = [hud.game.events.on('mission:loading', () => this._release())];
    this._onVis = () => this._vis();
    document.addEventListener('visibilitychange', this._onVis);
  }

  get game() { return this.hud.game; }

  /** Whether B1 may run live (§1.10 fallback list). */
  get liveAllowed() {
    const o = this.hud.options || {};
    if (o.menuBg === 'still' || this.hud.kit?.reducedMotion) return false;
    if ((o.preset || this.game.renderer?.presetName) === 'low') return false;
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
    return !!this.game.renderer?.renderer && !this.game.manualTick;
  }

  /** @param {'frontend'|'mission'|'paper'|'off'} mode */
  setMode(mode) {
    const was = this.mode;
    this.mode = mode;
    const R = this.root;
    R.dataset.mode = mode;
    R.hidden = mode === 'off' || mode === 'paper';
    const kitLayer = this.hud.kit.layer;
    kitLayer.classList.toggle('live', mode === 'frontend' || mode === 'mission');
    if (mode !== 'frontend' && this.dio) this._release();
    if (mode !== 'mission') this.frozen.classList.remove('on');
    if (mode === 'frontend') {
      this._still();
      clearTimeout(this._timer);
      if (this.liveAllowed && !this.game.world && !this.dio) {
        // loads after the first menu paint (§1.10 cost budget); the still crossfades out when it arrives
        this._timer = setTimeout(() => this._build(), was === 'frontend' ? 0 : 350);
      }
    } else if (mode === 'mission' && !this.frozen.classList.contains('on')) this.freeze();
    document.documentElement.classList.toggle('bd-live', mode === 'frontend' && !!this.dio);
  }

  /** B1s: the baked still of the theatre the profile last reached (painted camo alone when none is baked). */
  _still() {
    const def = this.dioramaMission();
    const url = this.stillURL(def?.theater || 'temperate');
    if (this.stillImg?.dataset.url === url) return this._drawStill();
    const im = new Image();
    im.dataset.url = url;
    im.onload = () => { if (this.stillImg === im) this._drawStill(); };
    im.src = url;
    this.stillImg = im;
    this._compose(null);
  }

  _drawStill() {
    if (!this.dio && this.stillImg?.complete && this.stillImg.naturalWidth) this._compose(this.stillImg);
  }

  /**
   * The diorama through the B1 grade: grey, heavily blurred, contrast-compressed around mid-grey (`soft-light`
   * neutral), quarter resolution. `src` null = neutral (the camo alone).
   */
  _compose(src) {
    const c = this.grade;
    const w = Math.max(2, Math.min(640, Math.round(innerWidth / 3))), h = Math.max(2, Math.round(w * innerHeight / Math.max(1, innerWidth)));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.filter = 'none';
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    const sw = src ? src.naturalWidth || src.width : 0, sh = src ? src.naturalHeight || src.height : 0;
    this._view(src, sw, sh);
    if (!sw || !sh) return;
    const k = Math.max(w / sw, h / sh);
    g.filter = `grayscale(1) blur(${Math.max(1.5, w / 260).toFixed(1)}px) contrast(0.42) brightness(${this.dio ? 1.12 : 1})`;
    try {
      g.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
    } catch { /* tainted or lost context: stay neutral */ }
    g.filter = 'none';
  }

  /** The net opening: the diorama (live frame or baked still) drawn sharp at ≤ 960 px wide, olive duotone. */
  _view(src, sw, sh) {
    const v = this.view;
    const on = !!(sw && sh);
    this.root.classList.toggle('viewing', on);
    if (!on) return;
    const w = Math.max(2, Math.min(960, Math.round(innerWidth * 0.75))), h = Math.max(2, Math.round(w * innerHeight / Math.max(1, innerWidth)));
    if (v.width !== w || v.height !== h) { v.width = w; v.height = h; }
    const k = Math.max(w / sw, h / sh);
    const g = v.getContext('2d');
    // olive duotone, kept dark enough for the badge and the text scrim (in the canvas, not a CSS filter: §1 rule
    // "no CSS filter on full-screen layers")
    g.filter = 'grayscale(1) sepia(.6) hue-rotate(8deg) saturate(1.1) contrast(1.35) brightness(.6)';
    try {
      g.drawImage(src, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
    } catch { this.root.classList.remove('viewing'); }
    g.filter = 'none';
  }

  /**
   * The badge (assets/ui/emblem-badge-height.svg, laid out in 640×480 r) lit as an emboss from the upper left: a soft
   * normal-map term plus a crisp 0.75 r "tin-plate" edge (A6); highlight ≈ +12 L, shadow #121309, no fill. The
   * highlight alone becomes the mask of the slow brass light sweep.
   */
  async _buildEmboss() {
    const run = (this._embossRun = (this._embossRun || 0) + 1);
    const r = Math.min(innerWidth / 640, innerHeight / 480);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(64, Math.min(1600, Math.round(640 * r * dpr))), h = Math.round(w * 0.75);
    const pr = w / 640; // px per r
    let img = this._badgeImg;
    if (!img) {
      img = new Image();
      img.src = 'assets/ui/emblem-badge-height.svg';
      this._badgeImg = img;
    }
    try { await img.decode(); } catch { return; }
    if (run !== this._embossRun) return;
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const a = mk(), b = mk();
    const ga = a.getContext('2d', { willReadFrequently: true }), gb = b.getContext('2d', { willReadFrequently: true });
    ga.drawImage(img, 0, 0, w, h);
    const blur = Math.max(1, 1.6 * pr);
    gb.filter = `blur(${blur.toFixed(1)}px)`;
    gb.drawImage(img, 0, 0, w, h);
    let A, B;
    try {
      A = ga.getImageData(0, 0, w, h).data;
      B = gb.getImageData(0, 0, w, h).data;
    } catch { return; }
    const out = new ImageData(w, h), hi = new ImageData(w, h);
    const O = out.data, HI = hi.data;
    const ks = 1 / (70 / blur), kc = 1 / 70; // soft / crisp gradient normalisers (0..255 height steps)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const dx = 4, dy = w * 4;
        // light from the upper left: a slope rising toward +x / +y faces it
        const s = ((B[i + dx] - B[i - dx]) + (B[i + dy] - B[i - dy])) * 0.3536 * ks;
        const e = ((A[i + dx] - A[i - dx]) + (A[i + dy] - A[i - dy])) * 0.3536 * kc;
        const lit = Math.min(1, Math.max(0, s)) * 0.11 + Math.min(1, Math.max(0, e)) * 0.2;
        const dark = Math.min(1, Math.max(0, -s)) * 0.5 + Math.min(1, Math.max(0, -e)) * 0.45;
        if (lit >= dark) {
          O[i] = 214; O[i + 1] = 222; O[i + 2] = 170; O[i + 3] = Math.round(Math.min(0.34, lit) * 255);
          HI[i] = HI[i + 1] = HI[i + 2] = 255; HI[i + 3] = Math.round(Math.min(1, lit * 4) * 255);
        } else {
          O[i] = 0x12; O[i + 1] = 0x13; O[i + 2] = 0x09; O[i + 3] = Math.round(Math.min(0.72, dark) * 255);
        }
      }
    }
    const c = this.emboss;
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(out, 0, 0);
    const m = mk();
    m.getContext('2d').putImageData(hi, 0, 0);
    m.toBlob?.((blob) => {
      if (!blob || run !== this._embossRun) return;
      if (this._sheenURL) URL.revokeObjectURL(this._sheenURL);
      this._sheenURL = URL.createObjectURL(blob);
      this.sheen.style.setProperty('--sheen-mask', `url('${this._sheenURL}')`);
    });
    this.embossReady = true;
  }

  /** @returns {string|null} baked still for a theatre */
  stillURL(theater) {
    const t = STILL_THEATERS.includes(theater) ? theater : 'temperate';
    return `assets/ui/diorama/${t}.webp`;
  }

  /** The mission the profile last reached (M1 on first run). */
  dioramaMission() {
    const last = this.hud.profiles?.last?.missionId;
    const next = this.hud.screens?.nextMission?.()?.id;
    return MISSIONS.find((m) => m.id === last) || MISSIONS.find((m) => m.id === next) || MISSIONS[0] || null;
  }

  // ---------------------------------------------------------------- B1 live diorama

  async _build() {
    const g = this.game, r = g.renderer;
    if (this.mode !== 'frontend' || g.world || this.dio || !r || this._building) return;
    let def;
    try {
      def = normalizeMission(this.dioramaMission());
    } catch {
      return;
    }
    const t0 = performance.now();
    // the real building / bridge models of that map (polish: the diorama showed placeholder boxes); the same
    // cached fetches the mission load reuses, so this doubles as a preload of the likely next mission
    this._building = true;
    try {
      const q = r.presetName === 'ultra' ? 'ultra' : r.presetName === 'low' ? 'low' : 'default';
      await prepareMissionArt(def, { assets, quality: q });
    } catch (err) {
      console.warn('[backdrop] diorama art', err);
    } finally {
      this._building = false;
    }
    if (this.mode !== 'frontend' || g.world || this.dio) return; // a mission started / the menu left meanwhile
    const world = new World({ game: g, scene: r.scene, events: new EventBus(), size: def.size, seed: def.seed ?? CONFIG.sim.seed, mission: def });
    let handle = null;
    try {
      r.setTheater?.(def.theater || 'temperate', def.lighting || null);
      r.setMapBounds?.(def.size[0], def.size[1]);
      g.cameraRig.reset();
      g.cameraRig.setBounds(def.size[0], def.size[1]);
      const build = MapBuilder.buildMap;
      handle = build(world, def, { theater: def.theater, renderer: r, scene: r.scene, assets });
      world.rebuildSpatial?.();
    } catch (err) {
      console.warn('[backdrop] diorama build failed', err);
      try { handle?.dispose?.(); world.dispose(); } catch { /* ignore */ }
      return;
    }
    const cc = g.cameraController;
    this.dio = { world, handle, def, t: 0, path: dioramaPath(def), zoom: cc?.zoom ?? 1, buildMs: performance.now() - t0 };
    // §1.10 cost budget: 50 % internal resolution and 30 fps while the diorama is the only thing drawn
    this._savedPreset = r.preset;
    r.preset = { ...r.preset, pixelRatio: Math.min(r.preset.pixelRatio ?? 1, 0.5 * (devicePixelRatio || 1)) };
    r.resize();
    this._origRender = r.render;
    r.render = (dt) => {
      if (this._frameT > 0) return;
      this._frameT = 1 / 30 - 0.004;
      this._origRender.call(r, dt);
      if (this.dio) this._compose(r.domElement); // same task: the drawing buffer is still valid
    };
    cc?.setZoom?.(CONFIG.camera.zoomLevels?.[0] ?? 0.5);
    this._place(0);
    document.documentElement.classList.add('bd-live');
  }

  /** Camera along the 90 s loop (§1.10: eased keys, the standard game angle). */
  _place(t) {
    const cc = this.game.cameraController;
    if (!cc || !this.dio) return;
    const p = samplePath(this.dio.path, t);
    cc.centerOn(p.x, p.z);
  }

  _release() {
    clearTimeout(this._timer);
    const d = this.dio;
    if (!d) return;
    this.dio = null;
    const r = this.game.renderer;
    try { d.handle?.dispose?.(); } catch (err) { console.warn('[backdrop] dispose', err); }
    try { d.world.dispose(); } catch { /* ignore */ }
    if (this._origRender) r.render = this._origRender;
    this._origRender = null;
    if (this._savedPreset) r.preset = this._savedPreset;
    this._savedPreset = null;
    r.resize();
    this.game.cameraController?.setZoom?.(d.zoom);
    document.documentElement.classList.remove('bd-live');
    if (this.mode === 'frontend') this._still();
  }

  _vis() {
    if (document.hidden) this._frameT = 1e9; // rendering stops while the tab is hidden
    else this._frameT = 0;
  }

  /** Per frame (hud.update): the camera loop and the 30 fps gate. */
  update(dt = 0) {
    if (!this.dio) return;
    if (this._frameT < 1e8) this._frameT -= dt;
    this.dio.t += dt;
    this._place(this.dio.t);
  }

  // ---------------------------------------------------------------- B2 oxblood frozen frame

  /** Draw the current game frame (HUD is DOM, so the canvas never carries it) into a 2D canvas. */
  _grab(maxW = 1920) {
    const r = this.game.renderer;
    const src = r?.domElement;
    if (!src || !src.width) return null;
    try {
      (this._origRender || r.render).call(r, 0); // render now: the drawing buffer is only valid in this task
    } catch { /* fall through with whatever is on the canvas */ }
    const s = Math.min(1, maxW / src.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s));
    c.height = Math.max(1, Math.round(src.height * s));
    try {
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    } catch {
      return null;
    }
    return c;
  }

  /** B2 + A2: snapshot → luminance → the three measured oxblood stops, sharp, 20 % vignette (CSS), 1.01× drift. */
  freeze() {
    const shot = this._grab(1920);
    const f = this.frozen;
    if (!shot) {
      f.classList.remove('on');
      return;
    }
    f.width = shot.width;
    f.height = shot.height;
    const ctx = f.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(shot, 0, 0);
    try {
      const img = ctx.getImageData(0, 0, f.width, f.height);
      const d = img.data, lut = oxbloodLUT();
      for (let i = 0; i < d.length; i += 4) {
        const y = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;
        const k = y * 3;
        d[i] = lut[k]; d[i + 1] = lut[k + 1]; d[i + 2] = lut[k + 2];
      }
      ctx.putImageData(img, 0, 0);
    } catch { /* tainted: keep the colour frame under the CSS tint */ }
    this._lastShot = shot;
    f.classList.remove('on');
    void f.offsetWidth; // restart the crossfade + Ken Burns
    f.classList.add('on');
  }

  /** Save thumbnail (S09): 320×180 JPEG of the frame under the menu. @returns {string|null} data URL */
  thumb() {
    const src = this._lastShot || this._grab(640);
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d');
    const a = src.width / src.height, b = 16 / 9;
    const sw = a > b ? src.height * b : src.width, sh = a > b ? src.height : src.width / b;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 320, 180);
    try {
      return c.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  dispose() {
    this._release();
    window.removeEventListener('resize', this._onResize);
    if (this._sheenURL) URL.revokeObjectURL(this._sheenURL);
    for (const off of this._subs) off?.();
    document.removeEventListener('visibilitychange', this._onVis);
    this.root.remove();
  }
}
