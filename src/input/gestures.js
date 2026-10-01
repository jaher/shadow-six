/**
 * Touch gesture classifier (pure, no DOM): turns raw finger down / move / up samples into game gestures.
 *
 *   TAP        one finger, moved < tapMovePx, lifted within tapMaxMs  → {type:'tap', x, y, double}
 *              (double = a second tap within doubleTapMs and doubleTapPx of the previous one)
 *   LONG PRESS one finger held still ≥ longPressMs (reported by tick)  → {type:'longpress', x, y}
 *   PAN        one finger moved ≥ tapMovePx                            → 'panstart', 'pan' {dx, dy}, 'panend' {vx, vy}
 *   PINCH      two fingers                                             → 'pinchstart', 'pinch' {scale, cx, cy, dx, dy}, 'pinchend'
 *              scale = current finger distance / distance at pinch start (> 1 = spreading = zoom in);
 *              (cx, cy) = the fingers' midpoint, (dx, dy) = midpoint movement since the last sample.
 * A gesture that ever became a pan, a pinch or a long press can no longer end as a tap, so a finger that drags the
 * map or a pinch that lifts one finger first never issues an order. Times are in ms, positions in CSS px.
 * @module input/gestures
 */

export const TOUCH = {
  tapMovePx: 10, // movement that turns a touch into a drag
  tapMaxMs: 500, // a longer touch is not a tap
  doubleTapMs: 350,
  doubleTapPx: 32, // fingers are imprecise: the second tap may land this far from the first
  longPressMs: 550,
  velocityWindowMs: 90, // pan release velocity is measured over the last samples within this window
  minFlingPxS: 80, // slower releases do not coast
};

export class GestureClassifier {
  /** @param {Partial<typeof TOUCH>} [cfg] */
  constructor(cfg = {}) {
    this.cfg = { ...TOUCH, ...cfg };
    /** id → {x0, y0, x, y, t0} */
    this.pointers = new Map();
    /** 'idle' | 'press' | 'pan' | 'pinch' | 'held' (long press fired, or a pinch left one finger: no tap) */
    this.state = 'idle';
    this._lastTap = null; // {t, x, y}
    this._samples = []; // pan samples {t, x, y}
    this._pinch = null; // {d0, cx, cy}
  }

  get count() {
    return this.pointers.size;
  }

  _mid() {
    const [a, b] = [...this.pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  /** A finger touches. @returns {object[]} gestures */
  down(id, x, y, t) {
    const out = [];
    this.pointers.set(id, { x0: x, y0: y, x, y, t0: t });
    if (this.pointers.size === 1) {
      this.state = 'press';
    } else if (this.pointers.size === 2) {
      if (this.state === 'pan') out.push(this._panEnd(t, true));
      const m = this._mid();
      this._pinch = { d0: m.d, cx: m.cx, cy: m.cy };
      this.state = 'pinch';
      out.push({ type: 'pinchstart', cx: m.cx, cy: m.cy });
    }
    return out;
  }

  /** A finger moves. @returns {object[]} gestures */
  move(id, x, y, t) {
    const p = this.pointers.get(id);
    if (!p) return [];
    const px = p.x, py = p.y;
    p.x = x;
    p.y = y;
    const out = [];
    if (this.state === 'pinch' && this.pointers.size >= 2) {
      const m = this._mid(), pi = this._pinch;
      out.push({ type: 'pinch', scale: m.d / pi.d0, cx: m.cx, cy: m.cy, dx: m.cx - pi.cx, dy: m.cy - pi.cy });
      pi.cx = m.cx;
      pi.cy = m.cy;
      return out;
    }
    if (this.pointers.size !== 1) return out;
    if (this.state === 'press' || this.state === 'held') {
      if (Math.hypot(x - p.x0, y - p.y0) < this.cfg.tapMovePx) return out;
      // the drag starts from the touch-down point so the map follows the finger exactly
      this.state = 'pan';
      this._samples = [{ t, x, y }];
      out.push({ type: 'panstart', x: p.x0, y: p.y0 });
      out.push({ type: 'pan', dx: x - p.x0, dy: y - p.y0, x, y });
      return out;
    }
    if (this.state === 'pan') {
      this._samples.push({ t, x, y });
      while (this._samples.length > 2 && t - this._samples[0].t > this.cfg.velocityWindowMs) this._samples.shift();
      out.push({ type: 'pan', dx: x - px, dy: y - py, x, y });
    }
    return out;
  }

  /** A finger lifts. @returns {object[]} gestures */
  up(id, x, y, t) {
    const p = this.pointers.get(id);
    if (!p) return [];
    if (Number.isFinite(x)) { p.x = x; p.y = y; }
    const out = [];
    const wasPinch = this.state === 'pinch';
    this.pointers.delete(id);
    if (wasPinch) {
      if (this.pointers.size < 2) {
        out.push({ type: 'pinchend' });
        this._pinch = null;
        // the finger left on the glass may keep panning, but never taps
        this.state = this.pointers.size ? 'held' : 'idle';
        for (const q of this.pointers.values()) { q.x0 = q.x; q.y0 = q.y; }
      }
      return out;
    }
    if (this.state === 'pan') out.push(this._panEnd(t, false));
    else if (this.state === 'press' && t - p.t0 <= this.cfg.tapMaxMs && Math.hypot(p.x - p.x0, p.y - p.y0) < this.cfg.tapMovePx) {
      const l = this._lastTap;
      const double = !!l && t - l.t <= this.cfg.doubleTapMs && Math.hypot(p.x0 - l.x, p.y0 - l.y) <= this.cfg.doubleTapPx;
      this._lastTap = double ? null : { t, x: p.x0, y: p.y0 };
      out.push({ type: 'tap', x: p.x0, y: p.y0, double });
    }
    if (!this.pointers.size) this.state = 'idle';
    return out;
  }

  /** The browser took the touch away (pointercancel): end without a tap. */
  cancel(id) {
    if (!this.pointers.has(id)) return [];
    const out = [];
    if (this.state === 'pan') out.push({ type: 'panend', vx: 0, vy: 0 });
    if (this.state === 'pinch') out.push({ type: 'pinchend' });
    this.pointers.delete(id);
    this._pinch = null;
    this.state = this.pointers.size ? 'held' : 'idle';
    return out;
  }

  /** Time passes (per frame): a finger held still long enough becomes a long press. @returns {object[]} */
  tick(t) {
    if (this.state !== 'press' || this.pointers.size !== 1) return [];
    const p = this.pointers.values().next().value;
    if (t - p.t0 < this.cfg.longPressMs) return [];
    this.state = 'held';
    return [{ type: 'longpress', x: p.x0, y: p.y0 }];
  }

  _panEnd(t, interrupted) {
    const s = this._samples;
    this._samples = [];
    if (interrupted || s.length < 2) return { type: 'panend', vx: 0, vy: 0 };
    const a = s[0], b = s[s.length - 1];
    // a finger that stopped before lifting does not fling
    const dt = Math.max(1, b.t - a.t), idle = t - b.t;
    let vx = ((b.x - a.x) / dt) * 1000, vy = ((b.y - a.y) / dt) * 1000;
    if (idle > this.cfg.velocityWindowMs || Math.hypot(vx, vy) < this.cfg.minFlingPxS) vx = vy = 0;
    return { type: 'panend', vx, vy };
  }
}
