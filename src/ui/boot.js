/**
 * Boot (docs/menus-art-direction.md S01, S03 + amendments A5, B10, B12): the fan-tribute disclaimer on black paper,
 * our 16 mm film-leader ident (3·2·1 sweep, burn-through to the embossed emblem and wordmark), then the title splash:
 * one frontal hero in three parallax layers before the burning emplacement, ≤ 30 embers, the worn wordmark, the red
 * tagline and "LOADING…" over a filling brass rule that turns into a pulsing "PRESS ANY KEY". The first input also
 * unlocks Web Audio and fades the menu loop in (B10). S02 (the newsreel) hooks in here once its film exists.
 * @module ui/boot
 */

import { el } from './dom.js';
import { DISCLAIMER } from './screens.js';
import { SplashFx } from './splash-fx.js';
import { pressPrompt, isTouchUI } from './touch.js';

const SEEN_KEY = 'shadowsix.intro.seen';
const VERSION = 'v0.9';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Boot {
  constructor(hud) {
    this.hud = hud;
    this.root = el('div', 'bt', hud.root);
    this.root.hidden = true;
    this.active = false;
    this.phase = null;
    this._skip = null;
    this._enter = null;
    this.ready = false;
  }

  get firstRun() {
    try { return !localStorage.getItem(SEEN_KEY); } catch { return true; }
  }

  /** Any key / click / tap while the boot owns the screen. @returns {boolean} consumed */
  key(e) {
    if (!this.active) return false;
    if (e?.code && /^(F5|F11|F12)$/.test(e.code)) return false;
    if (this.phase === 'splash') {
      if (this.ready) this._go();
    } else this._skip?.();
    return true;
  }

  /** S01: disclaimer (≥ 1.5 s on first run) → ident (Video → Intro: first / always / never). */
  async start() {
    const first = this.firstRun;
    const mode = this.hud.options?.intro || 'first';
    this.active = true;
    this.root.hidden = false;
    this.root.className = 'bt';
    if (!this._pointer) {
      this._pointer = true;
      this.root.addEventListener('pointerdown', (e) => { e.preventDefault(); this.key({}); });
    }
    // 1) the disclaimer
    this.phase = 'disclaimer';
    const disc = el('div', 'bt-disc', this.root);
    el('p', null, disc, 'AN UNOFFICIAL, NON-COMMERCIAL FAN TRIBUTE TO');
    el('p', 'big', disc, 'COMMANDOS: BEHIND ENEMY LINES (1998)');
    el('p', null, disc, 'Pyro Studios / Eidos Interactive. Not affiliated with Pyro Studios, Eidos, Square Enix or Kalypso Media.');
    requestAnimationFrame(() => disc.classList.add('on'));
    await this._beat(2500, first ? 1500 : 0);
    disc.classList.remove('on');
    await wait(this.hud.kit.reducedMotion ? 60 : 300);
    disc.remove();
    // 2) the ident
    if (mode === 'always' || (mode === 'first' && first)) await this._ident();
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
    this.showSplash({ ready: this.ready });
  }

  /** Wait `ms`, or less once the skip lock (`lock` ms) has passed and a key arrives. */
  _beat(ms, lock = 0) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const done = () => { clearTimeout(tm); this._skip = null; resolve(); };
      const tm = setTimeout(done, ms);
      this._skip = () => { if (performance.now() - t0 >= lock) { this._skipped = true; done(); } };
    });
  }

  async _ident() {
    this.phase = 'ident';
    this._skipped = false;
    const rm = this.hud.kit.reducedMotion;
    const id = el('div', `bt-ident ${rm ? 'rm' : ''}`.trim(), this.root);
    id.innerHTML = `<svg class="bt-leader" viewBox="0 0 400 300" aria-hidden="true">
      <rect x="0" y="0" width="400" height="300" fill="#1a1813"/>
      <circle cx="200" cy="150" r="118" fill="none" stroke="#d8d2bd" stroke-width="3"/>
      <circle cx="200" cy="150" r="96" fill="none" stroke="#d8d2bd" stroke-width="1.5"/>
      <path class="sweep" d="M200 150 L200 32 A118 118 0 1 1 199.9 32 Z" fill="#d8d2bd" opacity=".16"/>
      <path d="M0 150H400M200 0V300" stroke="#d8d2bd" stroke-width="1.5" opacity=".7"/>
      <text class="num" x="200" y="150" text-anchor="middle" dominant-baseline="central">3</text>
    </svg><div class="bt-dust"></div><div class="bt-burn"><img src="assets/ui/emblem.svg" alt=""><div class="mk-wm wm" role="img" aria-label="SHADOW SIX"></div></div>`;
    this.hud.sound?.play('projector');
    const num = id.querySelector('.num');
    let skipped = false;
    for (const n of ['3', '2', '1']) {
      num.textContent = n;
      id.classList.remove('tick');
      void id.offsetWidth;
      id.classList.add('tick');
      await this._beat(rm ? 450 : 1000);
      if (this._skipped) { skipped = true; break; }
    }
    id.classList.add('burn'); // 400 ms radial luminance wipe, the key light sweeps once
    if (!skipped) await this._beat(rm ? 900 : 1900);
    id.classList.add('out');
    await wait(rm ? 80 : 400);
    id.remove();
  }

  /** S03: the title splash; `ready:false` shows LOADING… with the brass rule. */
  showSplash({ ready = false } = {}) {
    this.phase = 'splash';
    this.active = true;
    this.root.hidden = false;
    this.hud.kit.close();
    this.hud.backdrop?.setMode('off');
    this.root.replaceChildren();
    const sp = el('div', 'bt-splash', this.root);
    const art = el('div', 'bt-art', sp);
    const sky = el('img', 'bt-l sky', art);
    sky.alt = '';
    sky.src = 'assets/ui/keyart/sky.svg';
    // live fire + volumetric searchlight (WebGL2); the painted fire is the fallback
    const fxc = el('canvas', 'bt-l fx', art);
    this.fx?.dispose();
    this.fx = new SplashFx(fxc, { still: this.hud.kit.reducedMotion, fireAt: [0.745, 0.215], fireW: 0.21 });
    if (this.fx.alive) this.fx.start();
    else {
      fxc.remove();
      const f = el('img', 'bt-l fire', art);
      f.alt = '';
      f.src = 'assets/ui/keyart/fire.svg';
    }
    // the hero: an offline render of the Green Beret model (tools/ui/keyart); the SVG only if it fails to load
    const hero = el('img', 'bt-l hero', art);
    hero.alt = 'A commando stands before a burning gun emplacement';
    hero.decoding = 'async';
    hero.addEventListener('error', () => { if (!hero.src.endsWith('.svg')) { hero.classList.add('svg'); hero.src = 'assets/ui/keyart/hero.svg'; } }, { once: true });
    hero.src = 'assets/ui/keyart/hero.webp';
    const embers = el('div', 'bt-embers', art);
    if (!this.hud.kit.reducedMotion) {
      for (let i = 0; i < 30; i++) { // B12: ≤ 30 sprites
        const e = el('i', null, embers);
        e.style.cssText = `--x:${(i * 37) % 100}%;--d:${2.4 + ((i * 13) % 17) / 6}s;--delay:${-((i * 7) % 23) / 5}s;--dx:${((i * 29) % 21) - 10}px`;
      }
    }
    const top = el('div', 'bt-top', sp);
    const wm = el('div', 'mk-wm bt-wordmark', top); // worn-steel fill clipped to the wordmark outlines
    wm.setAttribute('role', 'img');
    wm.setAttribute('aria-label', 'SHADOW SIX');
    el('p', 'bt-tagline', top, 'SIX SPECIALISTS. BEHIND ENEMY LINES.');
    const pr = el('div', 'bt-prompt', sp);
    this.promptEl = el('span', null, pr, 'LOADING…');
    const rule = el('div', 'bt-rule', pr);
    this.ruleFill = el('i', null, rule);
    el('p', 'bt-disclaimer', sp, DISCLAIMER);
    el('span', 'bt-ver', sp, VERSION);
    this._parallax(art);
    requestAnimationFrame(() => sp.classList.add('on'));
    if (ready) this.setReady();
    else this.progress(this._p || 0);
  }

  _parallax(art) {
    if (this.hud.kit.reducedMotion) return;
    const move = (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      art.style.setProperty('--px', x.toFixed(3));
      art.style.setProperty('--py', y.toFixed(3));
      art.classList.add('mouse');
    };
    this.root.addEventListener('pointermove', move);
  }

  /** Asset preload progress (0..1) → the brass rule. */
  progress(f) {
    this._p = Math.max(0, Math.min(1, f));
    if (this.ruleFill) this.ruleFill.style.transform = `scaleX(${this._p})`;
  }

  /** Loading done: "PRESS ANY KEY OR CLICK" / "TAP TO CONTINUE" (220 ms crossfade); `onEnter` runs on the first input. */
  setReady(onEnter) {
    this.ready = true;
    if (onEnter) this._enter = onEnter;
    this.progress(1);
    const p = this.promptEl;
    if (!p) return;
    p.classList.add('swap');
    setTimeout(() => {
      p.textContent = pressPrompt(isTouchUI());
      p.classList.remove('swap');
      p.classList.add('mk-press');
      p.parentElement.classList.add('ready');
    }, 110);
  }

  _go() {
    if (this.phase !== 'splash') return;
    this.phase = null;
    const a = this.hud.game.audio;
    try { a?.unlock?.(); } catch { /* audio is optional */ }
    this.hud.sound?.play('select');
    a?.music?.('menu');
    this.root.classList.add('leaving');
    this.active = false; // B4: input goes straight to the first card while the splash fades out
    this.root.style.pointerEvents = 'none';
    setTimeout(() => this.hide(), this.hud.kit.reducedMotion ? 60 : 250);
    const go = this._enter;
    this._enter = null;
    (go || (() => this.hud.screens.enter()))();
  }

  hide() {
    this.active = false;
    this.root.style.pointerEvents = '';
    this.phase = null;
    this.root.hidden = true;
    this.fx?.dispose();
    this.fx = null;
    this.root.replaceChildren();
    this.root.className = 'bt';
    this.promptEl = this.ruleFill = null;
  }
}
