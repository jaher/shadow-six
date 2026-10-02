/**
 * Vegetation profile (docs/vegetation.md §3.0, §3.10): season and ground-cover mix from the mission's date, place and
 * theatre. Pure (no THREE) so unit tests and the grass / scrub builders share one source of truth.
 * @module terrain-b/veg-profile
 */

/** Ground-cover archetypes (index = instance type code `iScl.w` in grass-glsl.js). */
export const GRASS_TYPES = ['meadow', 'straw', 'forb', 'snowpoke', 'seedhead', 'tussock', 'flopped', 'marram', 'reed', 'drinn', 'wheat', 'stubble'];
export const GT = Object.fromEntries(GRASS_TYPES.map((k, i) => [k, i]));

/** Per-mission overrides where the theatre tag misleads (M06 Masi, Finnmark, 10 May: just past the thaw). */
const MISSION_HINTS = { m06: { season: 'thaw' } };

/**
 * Season from an ISO date ('1944-11-28') in the northern hemisphere. Late summer (Aug–Sep) is its own state: seed
 * heads, first yellowing. @returns {'spring'|'summer'|'late'|'autumn'|'winter'}
 */
export function seasonOf(date) {
  const m = +(String(date || '').split('-')[1] || 0);
  if (!m) return 'summer';
  if (m === 12 || m <= 2) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 7) return 'summer';
  if (m <= 9) return 'late';
  return 'autumn';
}

/**
 * Season state → scalar controls. dry 0 lush … 1 straw; flowers 0..1; seeds 0..1 (share of seed-head stems);
 * frost 0..1 (rime tint on upward faces); height multiplier.
 */
const SEASON = {
  spring: { dry: 0.04, flowers: 1, seeds: 0.25, frost: 0, height: 0.95 },
  summer: { dry: 0.18, flowers: 0.8, seeds: 0.8, frost: 0, height: 1.05 },
  late: { dry: 0.42, flowers: 0.45, seeds: 1, frost: 0, height: 1.1 },
  autumn: { dry: 0.62, flowers: 0.05, seeds: 0.45, frost: 0.1, height: 0.95 },
  winter: { dry: 0.86, flowers: 0, seeds: 0.25, frost: 0.45, height: 0.8 },
  thaw: { dry: 0.9, flowers: 0, seeds: 0.1, frost: 0.1, height: 0.7 },
};

/**
 * Tree state by season (pass 2, broadleaf.js): leafless crowns (twig tubes + sparse twig sprays), marcescence (marc:
 * brown-leaf density relative to a summer crown, ~0.5 → 10-20 % kept on the lower / inner branches; marcTrees: share
 * of oaks and beeches that keep any; young trees, hedges), autumn = share of leaf cards turned yellow/orange, dull = late-summer fading,
 * ivy = share of trunks with ivy (evergreen: shows most in winter).
 */
const TREE_SEASON = {
  spring: { leafless: false, marc: 0, autumn: 0, dull: 0, ivy: 0.12 },
  summer: { leafless: false, marc: 0, autumn: 0.02, dull: 0.12, ivy: 0.12 },
  late: { leafless: false, marc: 0, autumn: 0.06, dull: 0.3, ivy: 0.12, fruit: true },
  autumn: { leafless: true, marc: 0.5, marcTrees: 0.3, autumn: 0.5, dull: 0.5, ivy: 0.25 },
  winter: { leafless: true, marc: 0.5, marcTrees: 0.3, autumn: 0, dull: 0, ivy: 0.3 },
  thaw: { leafless: true, marc: 0, autumn: 0, dull: 0, ivy: 0 },
};

/** Tree state for a profile's season: October still in (turning) leaf, November on bare. */
export function treeSeason(season, date, src) {
  if (src === 'desert') return { leafless: false, marc: 0, autumn: 0, dull: 0.3, ivy: 0, dates: +(String(date || '').split('-')[1] || 0) >= 8 }; // ripe Aug–Dec
  if (src === 'snow') return { ...TREE_SEASON.winter, ivy: 0, marcTrees: 0.12 }; // Norway: birch country, few oaks keep leaves
  const t = { ...(TREE_SEASON[season] || TREE_SEASON.summer) };
  if (season === 'autumn' && +(String(date || '').split('-')[1] || 0) === 10) Object.assign(t, { leafless: false, marc: 0, autumn: 0.55, fruit: true });
  return t;
}

/**
 * Archetype weights per theatre and season (relative; placement multiplies them by per-archetype patch noise so
 * species form drifts, never a uniform mix). Reeds and marram are placed by their own masks (water band, dunes).
 */
function grassMix(src, theater, season) {
  if (src === 'desert') return { drinn: 0.55, straw: 0.45 };
  if (src === 'snow') return { snowpoke: 1 };
  const w = { meadow: 1, tussock: 0.32, forb: 0.22, seedhead: 0.12, straw: 0.08, flopped: 0 };
  if (season === 'spring') Object.assign(w, { forb: 0.3, seedhead: 0.06, straw: 0.03 });
  if (season === 'late') Object.assign(w, { meadow: 0.75, seedhead: 0.45, straw: 0.3 });
  if (season === 'autumn') Object.assign(w, { meadow: 0.45, seedhead: 0.2, straw: 0.5, flopped: 0.35, forb: 0.12 });
  if (season === 'winter' || season === 'thaw') Object.assign(w, { meadow: 0.12, tussock: 0.4, forb: 0.06, seedhead: 0.08, straw: 0.55, flopped: 0.85 });
  if (theater === 'coast') w.tussock *= 1.4;
  return w;
}

/**
 * Build the profile for a mission (or none: theatre defaults).
 * @param {object|null} mission mission def (id, date, theater, vegetation?)
 * @param {string} theater terrain theatre (desert|temperate|snow|coast|night)
 * @param {string} [src] source palette theatre (desert|temperate|snow)
 */
export function vegetationProfile(mission, theater = 'temperate', src) {
  src = src || (theater === 'coast' || theater === 'night' ? 'temperate' : theater);
  const hint = { ...(MISSION_HINTS[mission?.id] || {}), ...(mission?.vegetation || {}) };
  let season = hint.season || (src === 'snow' ? 'winter' : src === 'desert' ? 'autumn' : seasonOf(mission?.date));
  const S = { ...SEASON[season] };
  if (src === 'desert') Object.assign(S, { dry: 0.92, flowers: 0, seeds: 0.2, frost: 0 });
  if (src === 'snow') Object.assign(S, { dry: 0.95, flowers: 0, frost: 0.25 });
  // reeds want fresh water: rivers, ponds, oases. A coast mission's water is the sea (salt, surf) unless it says so
  const water = hint.reeds ?? (src !== 'snow' && theater !== 'coast');
  return {
    season, src, theater, ...S,
    mix: hint.grassMix || grassMix(src, theater, season),
    reeds: water,                                       // reed stands on the water band (any liquid water)
    dunes: hint.dunes ?? (theater === 'coast'),         // marram on coast sand
    scrub: src === 'desert',                            // 3D desert shrubs replace the flat rosettes
    trees: { ...treeSeason(season, mission?.date, src), ...(hint.trees || {}) },
  };
}

/** Deterministic weighted pick from {key: weight} with a 0..1 random. Returns the key (null when all weights 0). */
export function pickWeighted(weights, r) {
  let s = 0; for (const k in weights) s += Math.max(0, weights[k]);
  if (s <= 0) return null;
  let t = r * s;
  for (const k in weights) { t -= Math.max(0, weights[k]); if (t <= 0) return k; }
  return Object.keys(weights).pop();
}

/** Season tint of the meadow ground layers (the sward under the tufts browns with the blades). */
const GROUND_TINT = {
  spring: [1, 1.02, 1], summer: [1, 1, 0.97], late: [1.04, 0.98, 0.84], autumn: [1.0, 0.9, 0.72],
  winter: [1.0, 0.86, 0.6], thaw: [1.0, 0.86, 0.58],
};
/** @returns {[number, number, number]} albedo multiplier for terrain layer `layer` under profile `prof`. */
export function groundTint(prof, layer) {
  if (prof?.src !== 'temperate' || (layer !== 'grass' && layer !== 'grassdry')) return [1, 1, 1];
  const t = GROUND_TINT[prof.season] || [1, 1, 1];
  return layer === 'grass' ? t : t.map((v) => 1 + (v - 1) * 0.5);
}

/** Dead sward on the grass terrain layers by season: [dryness 0..1 (toward the tufts' olive / straw), matted dead
 * patches 0..1]. Desert sand has no sward; the snow theatre's grass shows through as dead straw. */
const SWARD = { spring: [0, 0], summer: [0, 0], late: [0.18, 0.1], autumn: [0.45, 0.4], winter: [0.82, 0.75], thaw: [0.78, 0.85] };
/** @returns {[number, number]} */
export function swardOf(prof, date) {
  if (!prof || prof.src === 'desert') return [0, 0];
  if (prof.season === 'autumn' && +(String(date || '').split('-')[1] || 0) === 11) return [0.7, 0.65]; // November: dead
  return SWARD[prof.season] || [0, 0];
}
