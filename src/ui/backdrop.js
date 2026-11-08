/**
 * Menu backgrounds (docs/menus-art-direction.md §1.10 + amendments A2, B12, and the user's realistic front end,
 * 2026-11-08: "Main menu stills needs work, more realistic please airplanes dont look good there"):
 *  - 'frontend' B1: the theatre the profile last reached as a lit, cinematic three-quarter view with a band of sky
 *    (the theatre's still, assets/ui/diorama/<theater>.webp, baked from the engine by tools/ui/bake_mission_stills.mjs),
 *    in the front end's one filmic grade over the still's own balance (an SVG filter baked into its canvas once per
 *    still and size: no CSS filter on a full-screen layer), drifting in a slow Ken Burns (a CSS transform on the compositor: no frame of ours, and the
 *    3D view is not drawn at all behind it); a dark band behind the emblem and the menu column; the solid lit badge
 *    with its 30 s light sweep. Now and then the title splash's Spitfires cross its sky and bomb its far ground
 *    (menu-bombers.js). Held still under reduced motion, the Low preset, low-memory devices and MENU BACKGROUND: STILL.
 *  - 'mission' B2: the frozen frame of the Esc press graded to the oxblood duotone; sharp inside, 20 % vignette,
 *    1.01× Ken Burns drift.
 *  - 'paper' B3 and 'off': the menu layer paints its own ground.
 * Consumes Game's renderer (B2's snapshot) and the 'mission:loading' event only; the simulation is never touched.
 * @module ui/backdrop
 */

import { el } from './dom.js';
import { MISSIONS } from '../missions/index.js';
import { oxbloodLUT, STILL_THEATERS, STILL_SCENES, theaterStillURL } from './menu-model.js';
import { MenuBombers } from './menu-bombers.js';

/** Theatres with a baked B1 still (assets/ui/diorama/<theater>.webp, tools/ui/bake_mission_stills.mjs). */
export { STILL_THEATERS };

/** The front end's grade where canvas filters cannot use SVG filters (a CSS filter string). */
export const STILL_GRADE = 'saturate(0.8) contrast(1.06) brightness(0.96)';

/**
 * The front end's one filmic grade for a theatre's still (and the Spitfires over it), as an inline SVG filter, made
 * once per theatre; its id. The still's own balance first (STILL_SCENES grade: gains to the same warm-neutral
 * highlights, saturation to the same muted level), then for every theatre the same gentle S-curve with cool shadows
 * and warm highlights: muted, natural colour — not black-and-white, not sepia.
 */
const GRADE_FILTERS = new Map();
export function menuGradeFilter(theater) {
  if (GRADE_FILTERS.has(theater)) return GRADE_FILTERS.get(theater);
  if (typeof document === 'undefined' || !document.body) return null;
  const g = STILL_SCENES[theater]?.grade || { gain: [1, 1, 1], sat: 1 }, id = `s6-menu-${theater}`;
  const curve = (k) => Array.from({ length: 17 }, (_, i) => {
    const x = i / 16, ws = 4 * x * (1 - x) * (1 - x), wh = 4 * x * (1 - x) * x, c = x - 0.045 * Math.sin(2 * Math.PI * x);
    return Math.min(1, Math.max(0, c + [-0.02 * ws + 0.03 * wh, 0.004 * wh, 0.045 * ws - 0.04 * wh][k])).toFixed(4);
  }).join(' ');
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML = `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="${g.gain[0]} 0 0 0 0  0 ${g.gain[1]} 0 0 0  0 0 ${g.gain[2]} 0 0  0 0 0 1 0"/>
    <feColorMatrix type="saturate" values="${g.sat}"/>
    <feComponentTransfer><feFuncR type="table" tableValues="${curve(0)}"/><feFuncG type="table" tableValues="${curve(1)}"/><feFuncB type="table" tableValues="${curve(2)}"/></feComponentTransfer>
  </filter>`;
  document.body.appendChild(svg);
  GRADE_FILTERS.set(theater, id);
  return id;
}

/**
 * The badge's disc in its own box (assets/ui/emblem-badge-height.svg, 640×480 r; tools/ui/make_emblem.py RING): the
 * centre as fractions of the box, the inner face's radius as a fraction of its width (158 × 1.02 of 1000 units, 2 per r).
 */
export const DISC = { x: 0.5, y: 0.375, r: (158 * 1.02) / 2 / 640 };

/** An inline SVG filter doing freeze()'s oxblood grade (luminance 54/183/19 ÷ 256 → oxbloodLUT), made once; its id. */
let OX_FILTER = null;
export function oxbloodFilterId() {
  if (OX_FILTER) return OX_FILTER;
  if (typeof document === 'undefined' || !document.body) return null;
  const lut = oxbloodLUT(), ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const k = [54 / 256, 183 / 256, 19 / 256].map((v) => v.toFixed(6)).join(' ');
  const tab = (c) => Array.from({ length: 256 }, (_, y) => (lut[y * 3 + c] / 255).toFixed(5)).join(' ');
  svg.innerHTML = `<filter id="s6-oxblood" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="${k} 0 0  ${k} 0 0  ${k} 0 0  0 0 0 1 0"/>
    <feComponentTransfer><feFuncR type="table" tableValues="${tab(0)}"/><feFuncG type="table" tableValues="${tab(1)}"/><feFuncB type="table" tableValues="${tab(2)}"/></feComponentTransfer>
  </filter>`;
  document.body.appendChild(svg);
  OX_FILTER = 's6-oxblood';
  return OX_FILTER;
}

export class Backdrop {
  constructor(hud) {
    this.hud = hud;
    this.mode = 'off';
    this.root = el('div', 'bd', hud.root);
    hud.root.insertBefore(this.root, hud.kit.layer);
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    // B1 stack, back to front: the scene (the graded still, and the Spitfires' layer in it, so both drift together
    // under the Ken Burns), the dark band behind the emblem and the column, B2's frozen frame, the badge, vignette
    this.scene = el('div', 'bd-scene', this.root);
    this.still = el('canvas', 'bd-still', this.scene);
    this.planes = el('canvas', 'bd-planes', this.scene);
    this.bombers = new MenuBombers(this.planes, {
      audio: () => this.game.audio, still: () => !!this.hud.kit?.reducedMotion || this.hud.options?.menuBg === 'still',
      visible: () => this.mode === 'frontend' && this.ready && !this.game.world,
      theater: () => this.theater, grade: () => this._grade(), avoid: () => this._textRects(),
    });
    hud.kit.onScreen = (id, mode) => { // a new card ends a pass in flight; every render re-seats the column on the disc
      if (mode !== 'none') this.bombers.interrupt();
      this._discSoon();
    };
    this.shade = el('div', 'bd-shade', this.root);
    this.frozen = el('canvas', 'bd-frozen', this.root);
    this.emblem = el('div', 'bd-emblem', this.root);
    this.emboss = el('canvas', 'bd-emboss', this.emblem);
    this.sheen = el('div', 'bd-sheen', this.emblem);
    this.vig = el('div', 'bd-vig', this.root);
    this.stillImg = null;
    this.theater = null;
    this.ready = false; // the still is graded and showing
    this._onResize = () => { clearTimeout(this._rsT); this._rsT = setTimeout(() => { this._buildEmboss(); this._drawStill(); this._discLayout(); }, 150); };
    // the column's seat changes with the input mode (a phone's 44 px finger rows: html.mk-touch) and the fonts
    this._classMO = typeof MutationObserver === 'function' ? new MutationObserver(() => this._discSoon()) : null;
    this._classMO?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.fonts?.ready?.then(() => this._discSoon());
    window.addEventListener('resize', this._onResize);
    this._buildEmboss();
    this._subs = [
      hud.game.events.on('mission:loading', () => this.bombers.stop()),
    ];
    this._onVis = () => this._vis();
    document.addEventListener('visibilitychange', this._onVis);
  }

  get game() { return this.hud.game; }

  /** The front end holds still (no Ken Burns): MENU BACKGROUND STILL, reduced motion, the Low preset, low memory. */
  get stillOnly() {
    const o = this.hud.options || {};
    if (o.menuBg === 'still' || this.hud.kit?.reducedMotion) return true;
    if ((o.preset || this.game.renderer?.presetName) === 'low') return true;
    return !!(navigator.deviceMemory && navigator.deviceMemory < 4);
  }

  /** @param {'frontend'|'mission'|'paper'|'off'} mode */
  setMode(mode) {
    this.mode = mode;
    const R = this.root;
    R.dataset.mode = mode;
    R.hidden = mode === 'off' || mode === 'paper';
    this.hud.kit.layer.classList.toggle('live', mode === 'frontend' || mode === 'mission');
    R.classList.toggle('held', this.stillOnly);
    if (mode !== 'mission') this.frozen.classList.remove('on');
    if (mode === 'frontend') this._still();
    else if (mode === 'mission' && !this.frozen.classList.contains('on')) this.freeze();
    if (mode === 'frontend' && !document.hidden) this.bombers.start(); else this.bombers.stop();
    this._discSoon();
  }

  /** The front end's still: the theatre the profile last reached (temperate stands in for one without its own). */
  _still() {
    const th = this.dioramaMission()?.theater || 'temperate';
    const url = this.stillURL(th);
    this.theater = STILL_THEATERS.includes(th) ? th : 'temperate';
    if (this.stillImg?.dataset.url === url) return this._drawStill();
    this.ready = false;
    this.root.classList.remove('viewing');
    this.bombers.stop(); // a pass over the old theatre's sky ends with it
    const im = new Image();
    im.dataset.url = url;
    im.decoding = 'async';
    im.onload = () => { if (this.stillImg === im) this._drawStill(); };
    im.src = url;
    this.stillImg = im;
    if (this.mode === 'frontend' && !document.hidden) this.bombers.start();
  }

  /**
   * The still graded into its canvas at the size it shows at (cover over the viewport, ≤ its own 1920 px, ≤ 2× the
   * CSS size, ≤ 1280 px on low-memory devices), once per still and size; CSS fits it (object-fit: cover, anchored at
   * the top so the sky band stays).
   */
  _drawStill() {
    const im = this.stillImg;
    if (!im?.complete || !im.naturalWidth) return;
    const iw = im.naturalWidth, ih = im.naturalHeight;
    const cap = navigator.deviceMemory && navigator.deviceMemory < 4 ? 0.67 : 1; // ≤ 1280 px on low-memory devices
    const k = Math.min(cap, Math.max(innerWidth / iw, innerHeight / ih) * Math.min(2, devicePixelRatio || 1));
    const w = Math.max(2, Math.round(iw * k)), h = Math.max(2, Math.round(ih * k));
    const c = this.still;
    if (c.width === w && c.height === h && c.dataset.url === im.dataset.url) return;
    c.width = w; c.height = h;
    c.dataset.url = im.dataset.url;
    const g = c.getContext('2d');
    g.filter = this._grade();
    try { g.drawImage(im, 0, 0, w, h); } catch { return; }
    g.filter = 'none';
    this.ready = true;
    this.root.classList.add('viewing');
  }

  /**
   * The badge (assets/ui/emblem-badge-height.svg, laid out in 640×480 r: the raven over the ring, no plate) as a solid
   * iron badge lit from the upper left — the parts' heights, a soft normal-map term, darkened grooves and a crisp
   * bright "tin-plate" edge (A6) — over a soft drop shadow: the scene never shows through it (review of the realistic
   * front end). Its highlight alone becomes the mask of the slow brass light sweep.
   */
  async _buildEmboss() {
    const run = (this._embossRun = (this._embossRun || 0) + 1);
    const r = (this.emblem.offsetWidth || 640 * Math.min(innerWidth / 640, innerHeight / 480)) / 640 * (this._embossK || 1);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(64, Math.min(2048, Math.round(640 * r * dpr))), h = Math.round(w * 0.75);
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
        const cov = A[i + 3] / 255;
        if (cov < 0.01) continue;
        // solid gunmetal: the sunken disc behind the rows dark, the ring and the raven lighter; the soft relief lit
        // from the upper left, grooves darkened, and a crisp brass-bright edge where a part faces the light (A6)
        const edge = Math.min(1, Math.max(0, e)), groove = Math.min(1, Math.max(0, -e));
        const v = (18 + 0.19 * A[i]) * (1 + 1.5 * Math.max(-0.6, Math.min(1, s))) * (1 - 0.45 * groove), hl = 160 * edge ** 1.2;
        O[i] = Math.min(255, v + hl); O[i + 1] = Math.min(255, v * 1.01 + hl * 0.93); O[i + 2] = Math.min(255, v * 1.05 + hl * 0.76); O[i + 3] = Math.round(cov * 245);
        if (lit > 0.01) { HI[i] = HI[i + 1] = HI[i + 2] = 255; HI[i + 3] = Math.round(Math.min(1, lit * 4) * 255); }
      }
    }
    const c = this.emboss, solid = mk();
    solid.getContext('2d').putImageData(out, 0, 0);
    c.width = w;
    c.height = h;
    const gc = c.getContext('2d');
    gc.filter = `blur(${(3 * pr).toFixed(1)}px) brightness(0)`;   // its drop shadow on the scene, lower right
    gc.globalAlpha = 0.6;
    gc.drawImage(img, 1.5 * pr, 2.5 * pr, w, h);
    gc.filter = 'none';
    gc.globalAlpha = 1;
    gc.drawImage(solid, 0, 0);
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
    return theaterStillURL(theater);
  }

  /** The mission the profile last reached (M1 on first run). */
  dioramaMission() {
    const last = this.hud.profiles?.last?.missionId;
    const next = this.hud.screens?.nextMission?.()?.id;
    return MISSIONS.find((m) => m.id === last) || MISSIONS.find((m) => m.id === next) || MISSIONS[0] || null;
  }

  /** Re-seat the column on the disc after this frame's layout, and again once a card's entrance has settled. */
  _discSoon() {
    cancelAnimationFrame(this._discRaf);
    this._discRaf = requestAnimationFrame(() => this._discLayout());
    clearTimeout(this._discT);
    this._discT = setTimeout(() => this._discLayout(), 450);
  }

  /**
   * The menu column on the badge's disc (user: "Center the menu around the circle better"): a card's plain list is
   * centred on the disc's inner face, its rows centred on it (two columns on a landscape phone: equal, an odd last row
   * centred across both), and kept inside the face with a margin — a long row
   * shrinks the type (to 72 %); a column still too big for the face (a phone's 44 px finger rows) grows the badge
   * about its disc, which slides down when the column would reach the card's title. All from the laid-out geometry
   * (the badge, the card, the rows), on every card render, resize and input-mode change: no per-device numbers.
   */
  _discLayout() {
    const em = this.emblem, card = this.hud.kit?.card, list = card?.querySelector('.mk-box > .mk-list');
    const plain = !!list && !list.hidden && list.children.length > 0 && !/\b(centred|wide|slots)\b/.test(list.className) && !list.querySelector('.opt');
    if (this.mode !== 'frontend' || this.root.hidden || !plain || !em.offsetWidth) {
      list?.classList.remove('disc');
      this._seat(1, 0);
      this.disc = null;
      return;
    }
    list.classList.add('disc');
    const rows = [...list.children].filter((e) => e.getClientRects().length);
    for (const e of rows) { e.style.zoom = ''; e.style.gridColumn = e.style.gridRow = e.style.justifySelf = ''; }
    list.style.gridTemplateRows = list.style.gridAutoColumns = '';
    if (getComputedStyle(list).display === 'grid') { // a landscape phone's two columns of finger rows: symmetric
      const n = rows.length, half = Math.floor(n / 2);   // about the disc — equal columns, an odd last row centred across both
      list.style.gridAutoColumns = '1fr';
      list.style.gridTemplateRows = n % 2 ? `repeat(${half}, auto) auto` : `repeat(${half}, auto)`;
      if (n % 2) Object.assign(rows[n - 1].style, { gridColumn: '1 / span 2', gridRow: String(half + 1), justifySelf: 'center' });
    }
    const W = this.root.clientWidth, H = this.root.clientHeight, ew = em.offsetWidth, eh = em.offsetHeight;
    const cx = W / 2 + (DISC.x - 0.5) * ew, cy0 = H / 2 + (DISC.y - 0.5) * eh, r0 = DISC.r * ew, margin = Math.max(8, 0.08 * r0);
    const reach = () => { // the farthest row corner from the column's centre, and the column's height
      const lr = list.getBoundingClientRect(), mx = (lr.left + lr.right) / 2, my = (lr.top + lr.bottom) / 2;
      let m = 0;
      for (const e of rows) { const q = e.getBoundingClientRect(); m = Math.max(m, Math.hypot(Math.max(mx - q.left, q.right - mx), Math.max(my - q.top, q.bottom - my))); }
      return [m, lr.height];
    };
    let [m, lh] = reach(), fit = 1;
    // finger rows (a phone's 44 px targets, touch mode or the portrait layout) never shrink: the badge grows instead
    const finger = document.documentElement.classList.contains('mk-touch') || rows.some((e) => parseFloat(getComputedStyle(e).minHeight) >= 43.5);
    if (m + margin > r0 && !finger) {
      fit = Math.max(0.72, (r0 - margin) / m);
      for (const e of rows) e.style.zoom = fit.toFixed(3);
      [m, lh] = reach();
    }
    const k = Math.max(1, (m + margin) / r0);
    // between the card's title and its foot: the disc slides down when the column would reach the title
    const t = card.querySelector('.mk-title')?.getBoundingClientRect();
    const feet = [...card.querySelectorAll('.mk-footer, .mk-hints')].map((e) => e.getBoundingClientRect()).filter((q) => q.height);
    const top = t?.height ? t.bottom + margin : 0, bottom = Math.min(H, ...feet.map((q) => q.top)) - margin;
    let dy = Math.max(0, top - (cy0 - lh / 2));
    if (cy0 + dy + lh / 2 > bottom) dy = Math.max(top - (cy0 - lh / 2), bottom - lh / 2 - cy0);
    this._seat(k, dy);
    // the column's centre on the disc, in its card box's coordinates (the box's layout place, not its slide-in)
    const box = list.parentElement, cr = card.getBoundingClientRect();
    list.style.setProperty('--disc-x', `${(cx - cr.left - box.offsetLeft).toFixed(1)}px`);
    list.style.setProperty('--disc-y', `${(cy0 + dy - cr.top - box.offsetTop).toFixed(1)}px`);
    this.disc = { cx, cy: cy0 + dy, r: r0 * k, k, fit };
  }

  /** The badge grown by k about its disc and slid down by dy (px); its emboss is rebuilt sharper when it grows. */
  _seat(k, dy) {
    const em = this.emblem;
    if (k === 1 && !dy) { em.style.removeProperty('--disc-k'); em.style.removeProperty('--disc-dy'); }
    else { em.style.setProperty('--disc-k', k.toFixed(3)); em.style.setProperty('--disc-dy', `${dy.toFixed(1)}px`); }
    if (Math.abs(k - (this._embossK || 1)) > 0.12) { this._embossK = k; this._buildEmboss(); }
  }

  /** The canvas filter grading this theatre's still (and the planes over it): its SVG grade, else the CSS one. */
  _grade() {
    const id = menuGradeFilter(this.theater || 'temperate');
    return id ? `url(#${id})` : STILL_GRADE;
  }

  /** The live card's text, one rect per text run (viewport px): what the flyover's bursts keep clear of. */
  _textRects() {
    const box = this.hud.kit?.card?.querySelector('.mk-box');
    if (!box) return [];
    const out = [], walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), r = document.createRange();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.data.trim()) continue;
      r.selectNodeContents(n);
      const b = r.getBoundingClientRect();
      if (b.width && b.height) out.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    }
    return out;
  }

  /** The front end's scene stops while the tab is hidden: no passes (nor booms) behind it. */
  _vis() {
    if (document.hidden) this.bombers.stop();
    else if (this.mode === 'frontend') this.bombers.start();
  }

  // ---------------------------------------------------------------- B2 oxblood frozen frame

  /** Draw the current game frame (HUD is DOM, so the canvas never carries it) into a 2D canvas. */
  _grab(maxW = 1920) {
    const r = this.game.renderer;
    const src = r?.domElement;
    if (!src || !src.width) return null;
    try {
      r.render(0); // render now: the drawing buffer is only valid in this task
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
    const ctx = f.getContext('2d');
    // the oxblood grade on the GPU (an SVG filter: the same luminance weights, the LUT as a 256-entry table — ±1 of the
    // CPU loop's rounding): the read-back + per-pixel loop + write-back of a 1920 px frame held the main thread ~40 ms
    // (the debrief's freeze at a walkthrough's end, the pause menu)
    const fid = 'filter' in ctx ? oxbloodFilterId() : null;
    if (fid) {
      ctx.filter = `url(#${fid})`;
      ctx.drawImage(shot, 0, 0);
      ctx.filter = 'none';
    } else ctx.drawImage(shot, 0, 0);
    if (!fid) try {
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
    this.bombers.dispose();
    if (this.hud.kit?.onScreen) this.hud.kit.onScreen = null;
    this._classMO?.disconnect();
    cancelAnimationFrame(this._discRaf);
    clearTimeout(this._discT);
    window.removeEventListener('resize', this._onResize);
    if (this._sheenURL) URL.revokeObjectURL(this._sheenURL);
    for (const off of this._subs) off?.();
    document.removeEventListener('visibilitychange', this._onVis);
    this.root.remove();
  }
}
