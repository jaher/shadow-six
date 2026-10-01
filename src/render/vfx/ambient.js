// Ambient smoke readability rules (chimneys, smouldering wrecks, campfires, fires after the blast): shared by the
// library (vfx.ambient), the FxPass composite and the tests. No WebGL here (unit-testable).
import * as THREE from 'three';

/**
 * Readability rules for AMBIENT smoke (chimneys; `smoke_column` on request). It lives in its own particle pool and
 * accumulation target; the FxPass composite then limits, per pixel, how much it may change what is on screen:
 *  - `cap`      max PERCEIVED change where it overlaps the ground plane (the playfield), e.g. 0.35 = the displayed
 *               value of the ground moves by at most ~35 % (darker or brighter); soft knee from 60 % of the cap;
 *  - `capRoof`  the same over roofs / tall geometry (the plume near the stack may read denser there);
 *  - `maskUnit` multiplier of `cap` over units, enemies, bodies, doors, pickups (screen capsules) → their silhouettes
 *               are never hidden; `maskCone` the same over the vision cones on show → cones/rings are not tinted;
 *  - `toneMin` / `toneMax` band of the smoke's own lit luminance relative to the (robust, blurred-min) background, so
 *               a plume never turns into a black stain or a white sheet when the VFX lights disagree with the ground's;
 *  - an alpha ceiling on the accumulated layer (linear to 0.6, soft to 0.92).
 * Explosion, fire and wreck smoke is not ambient (dramatic) and is not limited.
 */
export const AMBIENT_RULES = { cap: 0.35, capRoof: 0.5, maskUnit: 0.1, maskCone: 0.12, toneMin: 0.5, toneMax: 1.8, maxEntities: 64, maxCones: 24 };

/**
 * Why "perceived": smoke blends in linear HDR before the tone curve, and AgX (log2 encoded) compresses a darkening
 * veil over bright snow (alpha 0.2 of black smoke moves snow by only ~5 % on screen) while it expands changes in dark
 * areas (the same veil crushes a dark road or a dark uniform). The composite therefore limits the change of the
 * DISPLAYED value: perceived = |D(Lo) − D(Lb)| / max(D(Lb), 0.3), D = the tone curve applied to a grey.
 */
/** Displayed value (0..1) of a grey of linear luminance L: AgX log2 encoding + contrast polynomial, else gamma. */
export function displayValue(L, toneMapping = THREE.AgXToneMapping, exposure = 1) {
  if (toneMapping === THREE.AgXToneMapping) {
    const x = Math.min(1, Math.max(0, (Math.log2(Math.max(L * exposure, 1e-10)) + 12.47393) / 16.5)), x2 = x * x, x4 = x2 * x2;
    return Math.min(1, Math.max(0, 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232));
  }
  return Math.min(1, Math.max(0, L * exposure)) ** (1 / 2.2);
}

/** Perceived change when a pixel's linear luminance goes from Lb to Lo (the composite's model). */
export function perceivedChange(Lb, Lo, toneMapping = THREE.AgXToneMapping, exposure = 1) {
  const db = displayValue(Lb, toneMapping, exposure);
  return Math.abs(displayValue(Lo, toneMapping, exposure) - db) / Math.max(db, 0.3);
}

/** Soft knee of the cap (shader kneeCap): changes under 60 % of the cap d pass untouched, above it they approach d. */
export function kneeCap(p, d) { const k0 = 0.6 * d, r = Math.max(d - k0, 1e-4); return p <= k0 ? p : k0 + r * (1 - Math.exp(-(p - k0) / r)); }

/**
 * The composite's limiter: scale k ∈ [0, 1] of the ambient layer (premultiplied luminance Ls, alpha a) over a pixel of
 * luminance Lb so that perceivedChange(Lb, Lb·(1 − k·a) + k·Ls) ≤ kneeCap(p₁, d) (p₁ = the unlimited change; bisection,
 * 8 steps like the shader).
 */
export function capScale(Lb, Ls, a, d, toneMapping = THREE.AgXToneMapping, exposure = 1) {
  const P = (k) => perceivedChange(Lb, Lb * (1 - k * a) + k * Ls, toneMapping, exposure);
  const p1 = P(1), t = kneeCap(p1, d); // soft knee, like the shader
  if (p1 <= t + 1e-4) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 8; i++) { const k = (lo + hi) / 2; if (P(k) > t) hi = k; else lo = k; }
  return lo;
}
