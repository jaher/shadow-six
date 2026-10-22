/**
 * Texture-library tiers: assets/textures/lib/{1k,512,256,128} hold the same maps at four sizes. Per map the loaders
 * take the smallest copy that still covers the closest view of the current quality preset (engine/texel-budget.js):
 * `assets/textures/lib/density.json` lists, per 1k file, the texels per metre on its most stretched surfaces in every
 * mission (tools/perf/texel-density.mjs → tools/perf/lib-density.mjs). A map that is not listed, and every map on
 * 'ultra', stays 1k; 'low' never goes above 512 (as before). Same picture, a quarter (or less) of the memory, download
 * and decode for most maps.
 *
 *   await loadLibDensity(base); setLibPreset('high');
 *   libTier('granite_diff.jpg')   // → '256' | '512' | '1k' …
 * @module art/lib-tiers
 */
import { screenDensity, startDensity, tierFor } from '../engine/texel-budget.js';

const S = { density: null, loading: null, preset: null, need: 0, start: 0 };

/** Fetch the density table once (missing / offline → every map stays at its preset's default size). */
export function loadLibDensity(base = 'assets/') {
  if (S.density) return Promise.resolve(S.density);
  if (typeof fetch !== 'function') return Promise.resolve(null);
  S.loading ||= fetch(`${base}textures/lib/density.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => { S.density = j?.maps || {}; return S.density; });
  return S.loading;
}

/** Use an already parsed table (node tests / tools). */
export function useLibDensity(table) { S.density = table?.maps || table || {}; }

/** Quality preset the next loads are for ('low' | 'medium' | 'high' | 'ultra'; null = keep the 1k default). */
export function setLibPreset(preset) {
  S.preset = preset || null;
  S.need = preset && preset !== 'ultra' ? screenDensity(preset) : 0;
  S.start = preset && preset !== 'ultra' ? startDensity(preset) : 0;
}

/** Current preset (null when none was set). */
export const libPreset = () => S.preset;

/**
 * Library folder for a 1k file name under the current preset: '1k' | '512' | '256' | '128'.
 * @param {string} file e.g. 'granite_diff.jpg' (after aliases)
 * @param {{low?: boolean}} [o] low: the 'low' set's 512 cap (legacy callers that know only 'low')
 */
export function libTier(file, { low = S.preset === 'low' } = {}) {
  if (S.preset === 'ultra') return '1k';
  let size = tierFor(S.density?.[file], 1024, S.need, 128);
  if (low) size = Math.min(size, 512);
  return size >= 1024 ? '1k' : String(size);
}

/**
 * The smaller copy a map can load first (perf/download-speed-2): the smallest that covers the DEFAULT zoom — never
 * magnified before the player zooms in — while its `libTier` copy streams in after the loading screen and replaces it
 * in place (engine/hd-textures.js). null when there is none (the same tier, an unlisted map, 'ultra').
 * @param {string} file @param {{low?: boolean}} [o]
 * @returns {'512'|'256'|'128'|null}
 */
export function libStartTier(file, { low = S.preset === 'low' } = {}) {
  if (!S.preset || S.preset === 'ultra' || !(S.density?.[file] > 0) || !(S.start > 0)) return null;
  const full = libTier(file, { low }), fullSize = full === '1k' ? 1024 : Number(full);
  const size = Math.min(fullSize, tierFor(S.density[file], 1024, S.start, 128));
  return size < fullSize ? String(size) : null;
}
