/**
 * The layout of a row of wheat stooks (art/wheat-stooks.js draws it): pure data, shared by the mission data (the
 * gameplay footprints) and the drawing, with no three.js import.
 * @module art/stook-layout
 */
/** One stook's footprint (m, local x × z) and crest height. */
export const STOOK = { w: 1.0, d: 1.3, h: 1.25 };
// (its ridge along local z: the pairs of sheaves lean together across it, in x)

/** Stooks in a row of length w (one every ~3 m unless `n` says otherwise). */
export const stookCount = (p) => p.n ?? Math.max(1, Math.round(p.w / 3));

/** Local x of stook k of n along a row of length w (evenly spaced, centred). */
export const stookX = (k, n, w) => (n === 1 ? 0 : -w / 2 + STOOK.w / 2 + (k * (w - STOOK.w)) / (n - 1));

/** The row's gameplay footprints: one B.LOW rect per stook (structure frame, before `rot`). */
export function stookNavParts(p) {
  const n = stookCount(p);
  return Array.from({ length: n }, (_, k) => ({ x: stookX(k, n, p.w), z: 0, w: STOOK.w, d: STOOK.d, block: 1 }));
}
