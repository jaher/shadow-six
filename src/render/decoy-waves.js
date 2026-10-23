/**
 * Decoy sound waves (user 2026-10-22: "When decoy beeps can we have some transparent air blast animation around it",
 * "Like sound wave"; then "For decoy I would rather have the air bend / refract with a spherical sound wave around the
 * decoy"): every beep of the Green Beret's radio decoy sends three spherical shells of bent air out from the radio. The
 * leader travels out to the decoy's real hearing radius (CONFIG.stealth.noise.decoy.radius, the radius of the 'noise'
 * event itself) and fades there, so the player reads how far the beep carries; the two behind it die out sooner (0.8 R,
 * 0.6 R), the way a sound thins with distance. Nothing is painted: the picture behind each shell is refracted
 * (render/decoy-refraction.js, a post pass that shifts the scene colour along the shell's outward direction, strongest in
 * a soft band at the shell's rim where the line of sight runs through most of it, a little more where more of the world
 * lies behind the shell), so the wave is read from the bending itself.
 *
 * This module is the WAVE STATE and CLOCK: the pool (one slot per decoy, ≤ 4), the pure shape of a pulse, and the numbers
 * the pass draws from. It reads the 'noise' event the sim already emits (kind 'decoy': the beep sound plays from the same
 * event, so wave and beep start together) and never touches the sim. The clock is the interpolated SIM time, so a pause
 * freezes the waves and video mode's 2× / 4× runs them faster with the beeps. Off under reduced motion (like the noise
 * rings). No cost while no decoy beeps: the pass returns at once, nothing is allocated or drawn.
 * @module render/decoy-waves
 */
import { reducedMotion } from './fx.js';
import { RefractionPass } from './decoy-refraction.js';
import { CONFIG } from '../config.js';

/** The three shells of one pulse: start delay (s), share of the hearing radius they reach, strength of the bend. */
export const WAVE_RINGS = Object.freeze([
  Object.freeze({ delay: 0, reach: 1, gain: 1 }),
  Object.freeze({ delay: 0.14, reach: 0.8, gain: 0.8 }),
  Object.freeze({ delay: 0.28, reach: 0.6, gain: 0.6 }),
]);
export const WAVE_TRAVEL = 1.0; // s a shell takes from the radio to its reach (eased out: it slows and settles)
export const WAVE_LIFE = WAVE_RINGS[WAVE_RINGS.length - 1].delay + WAVE_TRAVEL; // s until the last shell is gone (< the 1.5 s pulse)
export const WAVE_R0 = 0.32; // m: a shell starts at the radio's case
export const WAVE_SIGMA0 = 0.35, WAVE_SIGMA1 = 0.45; // m: the shell's soft thickness at the start / the added thickness at the end
export const WAVE_BEND = 0.7; // m: how far (in the view plane) the picture behind the leader's rim is shifted at the strongest
export const WAVE_CENTRE_H = 0.3; // m above the ground: the radio's middle (the shells are spheres round it)
const POOL = 4;

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Normalised progress of shell k at `age` s since the pulse (0 before it starts, 1 once it has run its course). */
export function ringU(age, k) {
  const u = (age - WAVE_RINGS[k].delay) / WAVE_TRAVEL;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Radius (m) of shell k at `age` for a hearing radius R; -1 while it is not there (before / after). */
export function ringFront(age, k, R) {
  const u = ringU(age, k);
  if (u <= 0 || u >= 1) return -1;
  const e = 1 - (1 - u) * (1 - u);
  return WAVE_R0 + (R * WAVE_RINGS[k].reach - WAVE_R0) * e;
}

/** Strength envelope (0..1, × the shell's gain) of shell k at `age`: quick fade-in, holds, fades over its last 30 % (it has all but reached its radius by then). */
export function ringAlpha(age, k) {
  const u = ringU(age, k);
  if (u <= 0 || u >= 1) return 0;
  return WAVE_RINGS[k].gain * sstep(0, 0.06, u) * (1 - sstep(0.7, 1, u));
}

/** Soft thickness (m) of shell k at `age`: the front spreads and softens as it travels. */
export function ringSigma(age, k) {
  return WAVE_SIGMA0 + WAVE_SIGMA1 * ringU(age, k);
}

/**
 * The shape of the whole pulse at `age`: {rings: [{r, a, w}…] (r −1 = not there), lo, hi} where [lo, hi] is the radial band
 * (m, in the view plane round the radio) that holds every shell's bend (hi < lo: nothing to draw). Pure (unit-tested);
 * fills `out` if given (no allocation then).
 */
export function waveShape(age, R, out = null) {
  const o = out || { rings: WAVE_RINGS.map(() => ({ r: -1, a: 0, w: 0 })), lo: 1, hi: 0 };
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < WAVE_RINGS.length; k++) {
    const r = ringFront(age, k, R), q = o.rings[k];
    q.r = r; q.a = r < 0 ? 0 : ringAlpha(age, k); q.w = r < 0 ? 0 : ringSigma(age, k);
    if (r >= 0) { lo = Math.min(lo, r - 3 * q.w); hi = Math.max(hi, r + 3 * q.w); }
  }
  o.lo = lo === Infinity ? 1 : Math.max(0, lo);
  o.hi = hi === -Infinity ? 0 : hi;
  return o;
}

/** Fill 4 floats per shell at `out[at…]` — radius, softness, bend (m), phase — for the pulse at `age` (zeros: no shell). */
export function packShells(age, R, shape, out, at) {
  waveShape(age, R, shape);
  for (let k = 0; k < WAVE_RINGS.length; k++) {
    const q = shape.rings[k], i = at + k * 4;
    out[i] = Math.max(q.r, 0); out[i + 1] = q.w; out[i + 2] = q.r < 0 ? 0 : q.a * WAVE_BEND; out[i + 3] = k;
  }
}

export class DecoyWaves {
  constructor() {
    this.world = null;
    /**
     * One per decoy. `rings`: 2 pulses × 3 shells × (radius, softness, bend, phase) for the pass's uniforms; `band`: the
     * view-plane radii [lo, hi] (m) that hold a shell; (cx, cy, cz): the radio's middle in the world.
     * @type {{src: any, x: number, z: number, R: number, cx: number, cy: number, cz: number, live: boolean, visible: boolean,
     *   t0: number, t1: number, age: number, lo: number, hi: number, rings: Float32Array, shape: object, shape1: object}[]}
     */
    this.slots = [];
    /** The slots drawn this frame (the pass reads it; rebuilt by update() without allocating). */
    this.drawn = [];
    this._off = null;
    this.enabled = true;
    this.pass = null;
    this._unhook = null;
  }

  /** Put the refraction pass into the renderer's post chain (after the world, before AO). Survives preset changes (the chain is rebuilt with it). */
  install(eng) {
    this.uninstall();
    this._unhook = eng.addPostHook('afterWorld', (composer, passes) => {
      this.pass = new RefractionPass(eng, this);
      passes.decoyRefraction = this.pass;
      return this.pass;
    });
  }

  uninstall() {
    this._unhook?.();
    this._unhook = null;
    this.pass = null;
  }

  attach(world) {
    this.detach();
    this.world = world;
    // (every decoy pulse is a 'noise' event of kind 'decoy': the beep sound plays from the same event)
    this._off = world.events.on('noise', (n) => { if (n?.kind === 'decoy') this.spawn(n.x, n.z, n.radius, n.source ?? null); });
  }

  detach() {
    this._off?.();
    this._off = null;
    this.world = null;
    this.drawn.length = 0;
    for (const s of this.slots) { s.live = false; s.visible = false; s.src = null; }
  }

  _on() {
    return this.enabled && this.world && !reducedMotion(this.world.game?.options?.reducedMotion);
  }

  /** The sim clock at this draw: the tick's time wound back by the part of a tick the frame has not reached yet. */
  _now(alpha) {
    return this.world.time - (1 - Math.min(1, Math.max(0, alpha))) * CONFIG.sim.dt;
  }

  _make() {
    const s = {
      src: null, x: 0, z: 0, R: 0, cx: 0, cy: 0, cz: 0, live: false, visible: false, t0: -Infinity, t1: -Infinity, age: 0, lo: 1, hi: 0,
      rings: new Float32Array(24), shape: waveShape(0, 1), shape1: waveShape(0, 1),
    };
    this.slots.push(s);
    return s;
  }

  /** A pulse at (x, z) for hearing radius R from `src` (the decoy). Cheap: it only notes the moment and the place. */
  spawn(x, z, R, src = null) {
    if (!this._on() || !(R > 0)) return null;
    let s = src ? this.slots.find((q) => q.src === src) : null;
    if (!s) s = this.slots.find((q) => !q.live && !q.src) || this.slots.find((q) => !q.live);
    if (!s && this.slots.length < POOL) s = this._make();
    if (!s) s = this.slots.reduce((a, b) => (b.t0 < a.t0 ? b : a)); // the longest-quiet decoy's slot
    const w = this.world, now = w.time;
    s.t1 = s.live && now - s.t0 < WAVE_LIFE ? s.t0 : -Infinity; // (an overlapping earlier pulse keeps going)
    const gy = (typeof w.groundY === 'function' ? w.groundY(x, z) || 0 : 0) + (typeof w.grid?.elevAt === 'function' ? w.grid.elevAt(x, z) || 0 : 0);
    Object.assign(s, { src, x, z, R, cx: x, cy: gy + WAVE_CENTRE_H, cz: z, live: true, t0: now });
    s.visible = false; // (shown by update())
    return s;
  }

  /**
   * Per-frame refresh (render time): each live pulse's age on the sim clock, its shells' numbers for the pass.
   * @param {number} dt frame delta (s; unused: the waves follow the sim clock)
   * @param {number} [alpha] interpolation factor between the previous and current tick
   */
  update(dt, alpha = 1) {
    const w = this.world;
    this.drawn.length = 0;
    if (!w) return;
    const on = this._on();
    let now = 0, haveNow = false;
    for (const s of this.slots) {
      if (!s.live) continue;
      if (!on) { s.live = false; s.visible = false; continue; }
      if (!haveNow) { now = this._now(alpha); haveNow = true; }
      const a0 = Math.max(0, now - s.t0);
      let a1 = now - s.t1;
      if (!(a1 < WAVE_LIFE)) { s.t1 = -Infinity; a1 = -1; }
      if (a0 >= WAVE_LIFE) { // (this pulse is over; a picked-up decoy lets go of its slot)
        s.live = false; s.visible = false;
        if (s.src && (s.src.removed || s.src.alive === false)) s.src = null;
        continue;
      }
      packShells(a0, s.R, s.shape, s.rings, 0);
      let lo = s.shape.lo, hi = s.shape.hi;
      if (a1 >= 0) { // (the previous pulse's tail, if it still runs: three more shells)
        packShells(a1, s.R, s.shape1, s.rings, 12);
        const q = s.shape1;
        if (q.hi > q.lo) { lo = hi > lo ? Math.min(lo, q.lo) : q.lo; hi = Math.max(hi, q.hi); }
      } else s.rings.fill(0, 12);
      s.age = a0; s.lo = lo; s.hi = hi;
      s.visible = hi > lo;
      if (s.visible) this.drawn.push(s);
    }
  }

  /** Waves currently drawn (tests). */
  get active() {
    return this.drawn.length;
  }

  dispose() {
    this.uninstall();
    this.detach();
    this.slots = [];
  }
}
