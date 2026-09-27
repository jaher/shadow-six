/**
 * Deterministic seeded noise helpers shared by terrain, grass, clutter and tree generation (CPU side).
 * @module terrain-b/noise
 */

/** Mulberry32 PRNG → function returning floats in [0,1). */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of (i, j, seed) → [0,1). */
export function hash2(i, j, seed = 0) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Value noise in [0,1). */
export function vnoise(x, z, seed = 0) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = fade(x - i), fz = fade(z - j);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Fractal value noise in ~[0,1). */
export function fbm(x, z, oct = 4, seed = 0) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(x * f, z * f, seed + o * 17);
    n += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

/** Tileable periodic value noise (period p cells) for GPU noise textures. */
export function pnoise(x, z, p, seed = 0) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = fade(x - i), fz = fade(z - j);
  const m = (v) => ((v % p) + p) % p;
  const a = hash2(m(i), m(j), seed), b = hash2(m(i + 1), m(j), seed);
  const c = hash2(m(i), m(j + 1), seed), d = hash2(m(i + 1), m(j + 1), seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Periodic fbm over a size×size texture with base period `p0` cells. */
export function pfbm(u, v, size, p0, oct, seed) {
  let s = 0, amp = 0.5, n = 0, p = p0;
  for (let o = 0; o < oct; o++) {
    s += amp * pnoise((u / size) * p, (v / size) * p, p, seed + o * 31);
    n += amp;
    amp *= 0.5;
    p *= 2;
  }
  return s / n;
}
