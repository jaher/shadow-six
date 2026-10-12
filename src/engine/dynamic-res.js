/**
 * Dynamic resolution (optional; on by default on phones and tablets): holds a target frame rate by lowering the render
 * pixel ratio in steps when the GPU is the bottleneck, and raising it again when there is headroom. Pure controller:
 * the game feeds one sample per displayed frame (rAF interval, main-thread time of the frame, GPU time when timer
 * queries exist) and applies `scale` to the renderer (Renderer.setDynamicScale).
 *
 * Policy, per window of ~`windowFrames` frames (medians):
 *  - missing the target (interval > budget × 1.2) and GPU-bound — the GPU time is over 85 % of the budget, or without a
 *    GPU timer the main thread is idle more than 30 % of the interval — → one step down (never below `floor`);
 *    CPU-bound frames are left alone: fewer pixels would not help them.
 *  - on target below full scale: with a GPU timer, step up when the GPU time scaled to the next step's pixel count
 *    stays under 75 % of the budget; without one, probe one step up after `probeAfter` good windows and step back if the
 *    next window misses, doubling the wait each time a probe fails.
 *  - after every change one window is skipped (the resize settles).
 * @module engine/dynamic-res
 */

export const DYNRES_DEFAULTS = { target: 60, steps: [1, 0.85, 0.7], windowFrames: 45, probeAfter: 4 };

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

export class DynamicResolution {
  /** @param {{target?: number, steps?: number[], windowFrames?: number, probeAfter?: number, floor?: number}} [o] */
  constructor(o = {}) {
    const c = { ...DYNRES_DEFAULTS, ...o };
    this.target = c.target;
    this.steps = c.steps.filter((s) => s >= (c.floor ?? 0)).sort((a, b) => b - a);
    if (!this.steps.length || this.steps[0] !== 1) this.steps.unshift(1);
    this.windowFrames = c.windowFrames;
    this.probeAfter = c.probeAfter;
    this.level = 0;
    this._buf = { interval: [], cpu: [], gpu: [] };
    this._skip = 0;
    this._good = 0;
    this._probing = false;
    this._wait = c.probeAfter;
    this.changes = 0;
  }

  /** Current scale of the preset's pixel ratio (1 = full). */
  get scale() { return this.steps[this.level]; }

  get budget() { return 1000 / this.target; }

  /** Restart from full scale (new mission, preset change, option toggled). */
  reset() {
    this.level = 0;
    this._buf = { interval: [], cpu: [], gpu: [] };
    this._skip = 0; this._good = 0; this._probing = false; this._wait = this.probeAfter;
  }

  /**
   * One displayed frame. @param {number} intervalMs rAF delta @param {number} cpuMs main-thread time of the frame
   * @param {number|null} [gpuMs] GPU time of the frame (timer query), null when unavailable
   * @returns {number|null} the new scale when it changed, else null
   */
  sample(intervalMs, cpuMs, gpuMs = null) {
    if (!(intervalMs > 0) || intervalMs > 1000) return null; // tab switch, breakpoint: not a frame
    const b = this._buf;
    b.interval.push(intervalMs); b.cpu.push(cpuMs);
    if (gpuMs != null && gpuMs >= 0) b.gpu.push(gpuMs);
    if (b.interval.length < this.windowFrames) return null;
    const I = median(b.interval), C = median(b.cpu), G = b.gpu.length >= b.interval.length / 2 ? median(b.gpu) : null;
    this._buf = { interval: [], cpu: [], gpu: [] };
    if (this._skip > 0) { this._skip--; return null; }
    return this._decide(I, C, G);
  }

  _decide(I, C, G) {
    const B = this.budget, last = this.steps.length - 1;
    const missing = I > B * 1.2;
    if (missing) {
      this._good = 0;
      if (this._probing) { // the probe up failed: back down, wait longer next time
        this._probing = false;
        this._wait = Math.min(this._wait * 2, 64);
        return this._set(this.level + 1);
      }
      const gpuBound = G != null ? G > B * 0.85 : C < I * 0.7;
      if (gpuBound && this.level < last) return this._set(this.level + 1);
      return null;
    }
    this._probing = false;
    if (this.level === 0) { this._good = 0; return null; }
    if (I > B * 1.05) { this._good = 0; return null; }
    const next = this.steps[this.level - 1], cur = this.steps[this.level];
    if (G != null) {
      if (G * (next / cur) ** 2 < B * 0.75) return this._set(this.level - 1);
      return null;
    }
    if (++this._good >= this._wait) {
      this._good = 0;
      this._probing = true;
      return this._set(this.level - 1);
    }
    return null;
  }

  _set(level) {
    const l = Math.max(0, Math.min(this.steps.length - 1, level));
    if (l === this.level) return null;
    this.level = l;
    this._skip = 1;
    this.changes++;
    return this.scale;
  }
}
