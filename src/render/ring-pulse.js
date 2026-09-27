/**
 * Chess-style selection pulse (ported from the author's 3d_chess highlight shader, shader.cpp highlight_fs_src +
 * board_renderer.cpp): a soft ring whose radius/brightness pulse from the moment of selection.
 *
 *   phase = fmod(t, 1.2) / 1.2;  p = 1 − phase;  pulse = p²(3 − 2p)          (1 → 0 over each 1.2 s cycle)
 *   selected piece:  inner 0.28 + 0.10·pulse, outer 0.40 + 0.08·pulse, alpha 0.50 + 0.40·pulse
 *   valid-move disc: inner 0.22 + 0.08·pulse, outer 0.36 + 0.06·pulse, alpha 0.40 + 0.30·pulse
 * (chess square units; `scale` maps them to metres). The fragment profile (RING_PROFILE_GLSL) is the chess one:
 * ring = 1 − smoothstep(0, half_w, |d − mid|), glow = exp(−3 (|d − mid| / half_w)²), alpha = max(0.8 ring, 0.35 glow)·a.
 * Pure module (no three.js) so the maths is unit-tested in Node.
 * @module render/ring-pulse
 */

export const PULSE_CYCLE = 1.2; // s

/** Chess radii at pulse 0 / slope per unit pulse, and alpha. */
export const CHESS_RING = Object.freeze({ inner: 0.28, innerK: 0.10, outer: 0.40, outerK: 0.08, alpha: 0.5, alphaK: 0.4 });
export const CHESS_MARKER = Object.freeze({ inner: 0.22, innerK: 0.08, outer: 0.36, outerK: 0.06, alpha: 0.4, alphaK: 0.3 });

/**
 * Pulse value (1 at the moment of selection, eases to 0 at the end of each cycle, then snaps back to 1).
 * @param {number} t seconds since this selection (negative → 0)
 */
export function ringPulse(t) {
  const phase = ((Math.max(0, t) % PULSE_CYCLE) + PULSE_CYCLE) % PULSE_CYCLE / PULSE_CYCLE;
  const p = 1 - phase;
  return p * p * (3 - 2 * p);
}

/**
 * Ring shape at time t.
 * @param {number} t s since selection (ignored when `still`)
 * @param {typeof CHESS_RING} spec CHESS_RING or CHESS_MARKER
 * @param {number} scale metres per chess unit
 * @param {boolean} [still] reduced motion: the resting ring (pulse 0)
 * @returns {{pulse: number, inner: number, outer: number, alpha: number}}
 */
export function ringShape(t, spec, scale, still = false) {
  const pulse = still ? 0 : ringPulse(t);
  return {
    pulse,
    inner: (spec.inner + spec.innerK * pulse) * scale,
    outer: (spec.outer + spec.outerK * pulse) * scale,
    alpha: spec.alpha + spec.alphaK * pulse,
  };
}

/** Fragment alpha of the chess profile at radius d (for tests / CPU checks). */
export function ringAlpha(d, inner, outer, a) {
  const mid = (inner + outer) / 2, hw = (outer - inner) / 2, x = Math.abs(d - mid);
  const s = Math.min(1, Math.max(0, x / hw)), ring = 1 - s * s * (3 - 2 * s);
  const glow = Math.exp(-3 * (x / hw) ** 2);
  const al = Math.max(ring * 0.8, glow * 0.35) * a;
  return al < 0.01 ? 0 : al;
}

/** GLSL for the same profile: expects `vRingXZ`, `uRingInner`, `uRingOuter`; multiplies diffuseColor.a. */
export const RING_PROFILE_GLSL = `
  {
    float rd = length( vRingXZ );
    float rMid = ( uRingInner + uRingOuter ) * 0.5;
    float rHalf = max( ( uRingOuter - uRingInner ) * 0.5, 1e-4 );
    float rx = abs( rd - rMid );
    float rRing = 1.0 - smoothstep( 0.0, rHalf, rx );
    float rGlow = exp( -3.0 * pow( rx / rHalf, 2.0 ) );
    diffuseColor.a *= max( rRing * 0.8, rGlow * 0.35 );
    if ( diffuseColor.a < 0.01 ) discard;
  }`;
