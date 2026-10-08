/**
 * The living HUD eye (top-right vision-cone tool): a photoreal eye in the brass porthole (tools/blender/hud/eye) that
 * blinks every 3-6 s (about 200 ms: half, nearly shut, shut, back, over whatever it is looking at), makes small
 * saccades when idle, slowly dilates its pupil under the pointer and, while the vision tool is armed, looks towards
 * the cursor.
 * The frames are cells of one sprite sheet per pixel tier (eye-anim-data.js), drawn as a background over the porthole
 * window of the static tool render. The static images stay underneath as the fallback: no sheet (or a failed load),
 * reduced motion, and the pressed / disabled states show the plain renders.
 * @module ui/eye-anim
 */

import { EYE_ANIM } from './eye-anim-data.js';
import { ICON_BASE, needDensity, tierDensity } from './icon-art.js';

let base = ICON_BASE;
try {
  base = new URL('../../assets/ui/icons/', import.meta.url).href;
} catch { /* node: keep the relative path */ }

/**
 * Blink stages and how long each shows (ms), closing fast and opening a little slower (~210 ms in all). A blink keeps
 * the gaze and the pupil it starts from: 'b1' (lid 38 % down) and 'b2' (72 %) are rendered for every gaze, 'b1' for
 * both pupil sizes; 'b3' is the shut lid.
 */
export const BLINK_SEQ = [['b1', 30], ['b2', 30], ['b3', 55], ['b2', 40], ['b1', 55]];
export const BLINK_MS = BLINK_SEQ.reduce((s, [, ms]) => s + ms, 0);
/** Time between blinks (ms) and between idle saccades. */
export const BLINK_GAP = [3000, 6000];
export const SACCADE_GAP = [900, 3200];
/**
 * Pupil: hover → dilation after a physiological latency (ms), then eased over DILATE_MS (the dilated cell crossfades
 * over the normal one); it constricts back a little faster when the pointer leaves. Pointer distance (CSS px) at
 * which the armed eye looks fully aside.
 */
export const DILATE_DELAY = 250;
export const DILATE_MS = 700;
export const CONSTRICT_MS = 450;
export const LOOK_REACH = 260;

const FR = EYE_ANIM.frames;
const IDX = new Map(FR.map((f, i) => [f.name, i]));
const GAZE = FR.map((f, i) => ({ i, ...f })).filter((f) => f.name.startsWith('g'));

/** Sheet tier for a UI scale × DPR: the smallest whose density covers it, else the largest. */
export function eyeSheetTier(scale = 1, dpr = 1) {
  const ks = Object.keys(EYE_ANIM.tiers).sort((a, b) => tierDensity(a) - tierDensity(b));
  const need = needDensity(scale, dpr);
  return ks.find((k) => tierDensity(k) >= need - 1e-6) || ks[ks.length - 1];
}

export function eyeSheetURL(tier) {
  return `${base}tool/eye.anim@${tier}.webp`;
}

/** Index of the gaze frame nearest (gx, gy) with a normal or dilated pupil. */
export function gazeFrame(gx = 0, gy = 0, dilated = false) {
  const p = dilated ? 'd' : 'n';
  let best = -1, bd = Infinity;
  for (const f of GAZE) {
    if (f.p !== p) continue;
    const d = (f.gx - gx) ** 2 + (f.gy - gy) ** 2;
    if (d < bd) { bd = d; best = f.i; }
  }
  return best;
}

export function frameIndex(name) {
  return IDX.has(name) ? IDX.get(name) : -1;
}

/** Frame index of blink `stage` ('b1' | 'b2' | 'b3') over gaze frame `g` (its gaze, and its pupil where rendered). */
export function blinkFrame(stage, g) {
  const f = FR[g];
  if (stage === 'b3' || !f) return frameIndex('blink3');
  const want = stage === 'b1' ? `b1${f.name}` : `b2${f.name.slice(0, 3)}n`;
  const i = frameIndex(want);
  return i >= 0 ? i : frameIndex('blink3');
}

const ease = (q) => q * q * (3 - 2 * q);

/** background-position (percent) of frame `i` in the sheet grid. */
export function framePos(i) {
  const { cols, rows } = EYE_ANIM;
  const c = i % cols, r = Math.floor(i / cols);
  const px = cols > 1 ? (c / (cols - 1)) * 100 : 0, py = rows > 1 ? (r / (rows - 1)) * 100 : 0;
  return `${+px.toFixed(4)}% ${+py.toFixed(4)}%`;
}

/** Gaze (-1..1 each, +y up) towards a screen point from the eye's centre: direction of the pointer, reach by distance. */
export function lookAt(ex, ey, px, py, reach = LOOK_REACH) {
  const dx = px - ex, dy = py - ey, d = Math.hypot(dx, dy);
  if (d < 1) return [0, 0];
  const k = Math.min(1, d / reach);
  return [(dx / d) * k, (-dy / d) * k];
}

const rnd = (r, a, b) => a + (b - a) * r();

/**
 * Drives one eye button. `opts.reducedMotion()` → stay static; `opts.armed()` → the vision tool is on;
 * `opts.random` for tests. Call tick(nowMs) every frame and refresh(scale) when the UI scale changes.
 */
export class EyeAnimator {
  constructor(btn, opts = {}) {
    this.btn = btn;
    this.random = opts.random || Math.random;
    this.reducedMotion = opts.reducedMotion || (() => false);
    this.armed = opts.armed || (() => btn?.classList?.contains('armed'));
    this.dpr = opts.dpr || (() => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1));
    this.ready = false;
    this.frame = -1;
    this.gaze = [0, 0];
    this.pointer = null;
    this.blinkAt = 0;
    this.blinkStart = -1;
    this.saccadeAt = 0;
    this.hoverSince = -1;
    this.dil = 0;            // pupil dilation progress 0..1 (eased into the overlay's opacity)
    this.dilT = -1;
    this.blinkGaze = -1;
    this.view = null;
    this.el = null;
    this.el2 = null;
    if (!btn || typeof document === 'undefined' || !FR.length) return;
    const [x0, y0, x1, y1] = EYE_ANIM.cell, [bw, bh] = EYE_ANIM.box;
    const el = document.createElement('span');
    el.className = 'eye-anim';
    el.setAttribute('aria-hidden', 'true');
    // the cell in percent of the button box (the tool box is the button), so it follows --r without a resize hook
    Object.assign(el.style, {
      left: `${(x0 / bw) * 100}%`, top: `${(y0 / bh) * 100}%`, width: `${((x1 - x0) / bw) * 100}%`, height: `${((y1 - y0) / bh) * 100}%`,
      backgroundSize: `${EYE_ANIM.cols * 100}% ${EYE_ANIM.rows * 100}%`,
    });
    btn.appendChild(el);
    this.el = el;
    // the dilated-pupil cell of the same gaze, crossfaded over the normal one while the pupil eases open or shut
    const el2 = el.cloneNode ? el.cloneNode(false) : null;
    if (el2) {
      el2.classList?.add('dil');
      el2.style.opacity = '0';
      btn.appendChild(el2);
      this.el2 = el2;
    }
    btn.addEventListener('pointerenter', () => { this.hoverSince = this._now(); });
    btn.addEventListener('pointerleave', () => { this.hoverSince = -1; });
    this._onMove = (e) => { this.pointer = [e.clientX, e.clientY]; };
    globalThis.addEventListener?.('pointermove', this._onMove, { passive: true });
  }

  _now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  /** Point the sheet at the tier for the size the eye is drawn at (the button is the 52×41 tool box: its measured
   *  width over 52 when laid out, which follows the touch bar scale --ut too; else `scale`); the eye animates once that
   *  sheet has loaded. */
  refresh(scale = 1) {
    if (!this.el) return null;
    const w = this.btn?.clientWidth;
    const tier = eyeSheetTier(w > 0 ? w / EYE_ANIM.box[0] : scale, this.dpr());
    if (tier === this.tier) return tier;
    this.tier = tier;
    const url = eyeSheetURL(tier);
    const show = () => {
      if (this.tier !== tier) return;
      this.el.style.backgroundImage = `url("${url}")`;
      if (this.el2) this.el2.style.backgroundImage = `url("${url}")`;
      this.ready = true;
      this._sync();
    };
    if (typeof Image === 'undefined') { show(); return tier; }
    const im = new Image();
    im.onload = show;
    im.onerror = () => { if (this.tier === tier) { this.ready = false; this._sync(); } };   // static renders stay
    im.src = url;
    return tier;
  }

  _sync() {
    const on = this.ready && !this.reducedMotion();
    this.btn.classList.toggle('eye-live', on);
    this.btn.classList.toggle('eye-rm', !!this.reducedMotion());
    return on;
  }

  /** Pupil dilation progress at `now`: after DILATE_DELAY under the pointer it rises over DILATE_MS, else falls. */
  _pupil(now) {
    const want = this.hoverSince >= 0 && now - this.hoverSince >= DILATE_DELAY ? 1 : 0;
    const dt = this.dilT < 0 ? 0 : Math.max(0, Math.min(250, now - this.dilT));
    this.dilT = now;
    if (want > this.dil) this.dil = Math.min(1, this.dil + dt / DILATE_MS);
    else if (want < this.dil) this.dil = Math.max(0, this.dil - dt / CONSTRICT_MS);
    return ease(this.dil);
  }

  /**
   * What the eye shows at `now` (ms); also advances the blink / saccade / pupil timers. Returns the index of the
   * dominant frame and sets `view` = { n, d, mix }: the normal-pupil frame, the dilated-pupil frame over it and the
   * overlay's opacity.
   */
  pick(now) {
    if (!this.blinkAt) this.blinkAt = now + rnd(this.random, ...BLINK_GAP);
    if (!this.saccadeAt) this.saccadeAt = now + rnd(this.random, ...SACCADE_GAP);
    const mix = this._pupil(now);
    if (this.blinkStart < 0 && now >= this.blinkAt) {
      this.blinkStart = now;
      this.blinkGaze = gazeFrame(this.gaze[0], this.gaze[1], false);          // the lid closes over the current gaze
    }
    if (this.blinkStart >= 0) {
      let t = now - this.blinkStart;
      for (const [stage, ms] of BLINK_SEQ) {
        if (t < ms) {
          const g = this.blinkGaze, gd = gazeFrame(FR[g].gx, FR[g].gy, true);
          this.view = { n: blinkFrame(stage, g), d: blinkFrame(stage, gd), mix };
          return mix >= 0.5 ? this.view.d : this.view.n;
        }
        t -= ms;
      }
      this.blinkStart = -1;
      this.blinkAt = now + rnd(this.random, ...BLINK_GAP);
    }
    if (this.armed() && this.pointer && this.btn.getBoundingClientRect) {
      const r = this.btn.getBoundingClientRect();
      this.gaze = lookAt(r.left + r.width / 2, r.top + r.height / 2, this.pointer[0], this.pointer[1]);
    } else if (now >= this.saccadeAt) {
      // idle: mostly back to the front, sometimes a glance aside, now and then a full look
      const u = this.random();
      if (u < 0.45) this.gaze = [0, 0];
      else {
        const a = this.random() * Math.PI * 2, k = u < 0.9 ? 0.5 : 1;
        this.gaze = [Math.cos(a) * k, Math.sin(a) * k * 0.8];
      }
      this.saccadeAt = now + rnd(this.random, ...SACCADE_GAP);
    }
    this.view = { n: gazeFrame(this.gaze[0], this.gaze[1], false), d: gazeFrame(this.gaze[0], this.gaze[1], true), mix };
    return mix >= 0.5 ? this.view.d : this.view.n;
  }

  tick(now = this._now()) {
    if (!this.el || !this._sync()) return -1;
    const i = this.pick(now);
    const { n, d, mix } = this.view;
    if (n !== this.frame && n >= 0) {
      this.frame = n;
      this.el.style.backgroundPosition = framePos(n);
    }
    if (this.el2) {
      if (d !== this.frame2 && d >= 0) { this.frame2 = d; this.el2.style.backgroundPosition = framePos(d); }
      const o = String(Math.round(mix * 50) / 50);
      if (o !== this.el2.style.opacity) this.el2.style.opacity = o;
    }
    // the frame the eye shows (the dominant layer), for tests and debugging
    if (i >= 0 && this.el.dataset.frame !== FR[i].name) this.el.dataset.frame = FR[i].name;
    return i;
  }

  dispose() {
    globalThis.removeEventListener?.('pointermove', this._onMove);
    this.el?.remove();
    this.el2?.remove();
  }
}
