/**
 * Small math helpers shared by simulation and rendering. Pure module (no three.js).
 *
 * Heading convention (docs/ARCHITECTURE.md): facing direction is (cos h, sin h) in (x, z);
 * h = 0 faces east (+X), h = π/2 faces south (+Z). Models are authored facing +Z, so
 * `object.rotation.y = headingToRotY(h)`.
 * @module core/math
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Euclidean distance between (ax,az) and (bx,bz). */
export const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

/** Squared distance between (ax,az) and (bx,bz). */
export const dist2 = (ax, az, bx, bz) => {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
};

/** Heading (radians) pointing from (ax,az) towards (bx,bz). */
export const angleTo = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax);

/**
 * Wrap an angle into (-π, π].
 * @param {number} a
 */
export function wrapAngle(a) {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a === -Math.PI ? Math.PI : a;
}

/** Signed shortest difference b - a, in (-π, π]. */
export const angleDiff = (a, b) => wrapAngle(b - a);

/** Interpolate between two angles along the shortest arc. */
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;

/**
 * Rotate `current` towards `target` by at most `maxStep` radians.
 * @returns {number} new angle (wrapped)
 */
export function turnTowardsAngle(current, target, maxStep) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxStep);
}

/** Heading → Object3D.rotation.y for a model authored facing +Z. */
export const headingToRotY = (h) => Math.PI / 2 - h;

/** Object3D.rotation.y → heading. */
export const rotYToHeading = (r) => wrapAngle(Math.PI / 2 - r);

/** Smoothstep on [e0, e1]. */
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Distance from point P to segment AB (2D, XZ).
 */
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Point-in-polygon (even-odd) for points [[x,z],...] or [{x,z},...]. */
export function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = Array.isArray(pts[i]) ? pts[i] : [pts[i].x, pts[i].z];
    const [xj, zj] = Array.isArray(pts[j]) ? pts[j] : [pts[j].x, pts[j].z];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Seeded deterministic RNG (mulberry32). Use `world.rng` in simulation code — never Math.random —
 * so replays, tests and quick-load behave identically.
 */
export class Rng {
  /** @param {number} [seed] */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** @returns {number} float in [0, 1) */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @returns {number} float in [a, b) */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** @returns {number} integer in [a, b] (inclusive) */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** @template T @param {T[]} arr @returns {T} */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** @returns {boolean} true with probability p */
  chance(p) {
    return this.next() < p;
  }

  /** Serializable state. */
  get snapshot() {
    return this.state;
  }

  set snapshot(s) {
    this.state = s >>> 0;
  }
}
