/**
 * Texel budget: how many texels per metre the game can put on screen, and the smallest texture that still covers it.
 *
 * The game camera is orthographic with a fixed scale — CONFIG.camera.pxPerMeterAt1x CSS px per metre × zoom, never
 * past the largest CONFIG.camera.zoomLevels step — and every quality preset caps the device pixel ratio. A surface is
 * therefore never drawn at more than `screenDensity(preset)` physical px per metre (low 80, medium 100, high 120,
 * ultra 160). Orthographic projection never enlarges a length, so the texture footprint of a pixel is at least
 * (texels per metre ÷ px per metre) texels along its smaller axis, which is what picks the mip level (anisotropic
 * filtering samples the long axis): where a map keeps ≥ that many texels per metre on its most stretched surface,
 * its level 0 is never magnified, and a copy half the size whose density still clears the bar draws the same picture
 * (the levels below are the same picture). `tierFor` picks the smallest such power-of-two size; the densities come
 * from tools/perf/texel-density.mjs (assets/textures/lib/density.json).
 * @module engine/texel-budget
 */
import { CONFIG } from '../config.js';
import { QUALITY_PRESETS } from './renderer.js';

/** Most physical px per metre a preset can draw (closest zoom × its pixel-ratio cap). */
export function screenDensity(preset) {
  const cap = QUALITY_PRESETS[preset]?.pixelRatio ?? 2;
  const zoom = Math.max(...(CONFIG.camera.zoomLevels || [2]));
  return (CONFIG.camera.pxPerMeterAt1x || 40) * zoom * cap;
}

/**
 * Smallest power-of-two size (≥ `min`, ≤ `full`) whose texels per metre stay ≥ `need`.
 * @param {number|null|undefined} density texels per metre at `full` on the map's most stretched surfaces (null: unknown → full)
 */
export function tierFor(density, full, need, min = 128) {
  if (!(density > 0) || !(need > 0)) return full;
  let s = full;
  while (s / 2 >= min && (density * (s / 2)) / full >= need) s /= 2;
  return s;
}
