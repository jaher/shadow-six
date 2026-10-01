/**
 * Blood model (docs/bodies-design.md §B): the pure, headless part of the blood system — the per-cause wound table,
 * the on/off switch, surface classes, the colour/age curve, budgets and recycling, bloody feet, and the deterministic
 * pool flow simulation (pool-sim.js). No three.js here: node unit tests drive it directly.
 * Blood is presentation only: nothing in this folder writes simulation state or is read by the AI (§B.0).
 * @module render/blood/model
 */
import { CONFIG } from '../../config.js';
import { T } from '../../world/grid.js';

/** Deterministic PRNG (mulberry32) — every random blood choice comes from a stream keyed by entity id (§0.2). */
export function rng32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit key of (entity id, salt). */
export function seedOf(id, salt = 0) {
  let h = 2166136261 ^ salt;
  const s = String(id ?? 0);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (Math.imul(h ^ (h >>> 13), 0x5bd1e995) ^ salt * 7919) >>> 0;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const range = (r, [a, b]) => a + (b - a) * r();

/** §B.0: BLOOD off or CENSORED on → no blood at all. Missing options = on (defaults). */
export function bloodEnabled(options) {
  return !options || (options.blood !== false && !options.censored);
}

/**
 * §B.1 wound class of a damage/death cause, or null when the cause never bleeds (syringe, injection, poison, KO,
 * drowning, electricity, fire). Weapon ids (pistol, sniperRifle, mp40…) resolve through CONFIG.blood.alias.
 * @param {string} cause
 * @param {{lethal?:boolean}} [o] non-lethal hits use the light `nonLethal` class (a puff, droplets and a stain)
 * @returns {{cls:string, spec:object}|null}
 */
export function woundClass(cause, { lethal = true } = {}) {
  const C = CONFIG.blood;
  if (!cause || C.none.includes(cause)) return null;
  const cls = C.alias[cause] || null;
  if (!cls) return null;
  if (!lethal) {
    if (cls === 'explosion' || cls === 'runover') return null; // survivors of a blast / near miss: no wound here
    return { cls: 'nonLethal', spec: C.causes.nonLethal, from: cls };
  }
  return { cls, spec: C.causes[cls] };
}

/** Pool volume (L) of a cause (0 = none). */
export function poolVolume(cause) {
  const w = woundClass(cause);
  return w ? w.spec.pool || 0 : 0;
}

// --------------------------------------------------------------------------------------------- surfaces (§B.3)

const HARD_LAYERS = new Set(['road', 'rock', 'concrete']);
const LAYER_SURF = {
  snow: 'snow', snowold: 'snow', snowpack: 'snow', slush: 'mud', ice: 'ice', mud: 'mud', wetsand: 'soil',
  sand: 'soil', sand2: 'soil', dirt: 'soil', gravel: 'gravel', grass: 'grass', grassdry: 'grass', leaves: 'grass',
  rock: 'hard', road: 'soil',
};
const TERRAIN_SURF = { [T.SAND]: 'soil', [T.SNOW]: 'snow', [T.GRASS]: 'grass', [T.MUD]: 'mud', [T.ROAD]: 'road', [T.GROUND]: 'soil' };

/**
 * Surface class under (x, z): 'water' | 'snow' | 'soil' | 'gravel' | 'grass' | 'mud' | 'hard' (rock) | 'road' | 'paved' |
 * 'wood' | 'metal' | 'ice'. Roofs and raised floors are 'paved', bridge decks 'wood', frozen water 'ice'; otherwise the
 * dominant terrain splat layer, then the grid terrain code.
 */
export function surfaceAt(world, x, z) {
  const g = world?.grid;
  if (!g?.inBounds) return 'soil';
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (!g.inBounds(i, j)) return 'soil';
  const k = g.idx(i, j);
  if (g.bridge?.[k]) return world.mission?.water?.frozen ? 'ice' : 'wood';
  if (g.isWater?.(i, j)) return world.mission?.water?.frozen ? 'ice' : 'water';
  if ((g.elev?.[k] || 0) > 0.05) return 'paved';                 // roofs, platforms, raised floors (blockers may be trees)
  const mat = world.terrain?.materialAt?.(x, z);
  if (mat?.name) {
    if (HARD_LAYERS.has(mat.name)) return 'hard';
    if ((mat.snow ?? 0) > 0.6) return 'snow';
    if (g.terrain?.[k] === T.ROAD) return 'road';                  // packed track / paving: little absorption, glossy
    return LAYER_SURF[mat.name] || 'soil';
  }
  return TERRAIN_SURF[g.terrain?.[k]] || (world.mission?.theater === 'snow' ? 'snow' : 'soil');
}

/** Numeric surface code for shaders (index into SURFACES). */
export const SURFACES = ['soil', 'snow', 'gravel', 'grass', 'mud', 'hard', 'wood', 'metal', 'ice', 'road', 'paved'];
export const surfaceCode = (s) => Math.max(0, SURFACES.indexOf(s));
export const surfaceSpec = (s) => CONFIG.blood.surfaces[s] || CONFIG.blood.surfaces.soil;

// --------------------------------------------------------------------------------------------- colour / age (§B.2)

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/**
 * Blood albedo (sRGB 0..1) of a pool `age` s old on surface `s`: fresh arterial red → dark maroon after 2–4 min →
 * dried brown after 10–15 min. Snow slows it ×4 (dryMul) and keeps a more saturated core.
 * @returns {{rgb:number[], wet:number}} wet: 1 fresh … 0 dry (drives roughness 0.06 → 0.75)
 */
export function bloodColor(age, s = 'soil') {
  const C = CONFIG.blood, m = surfaceSpec(s).dryMul || 1;
  const a = age / m;
  const fresh = hex(s === 'snow' ? C.colors.snowCore : C.colors.fresh), dark = hex(C.colors.dark), dry = hex(C.colors.dry);
  const d = clamp01((a - C.age.dark[0] * 0.25) / (C.age.dark[1] - C.age.dark[0] * 0.25));
  const y = clamp01((a - C.age.dry[0]) / (C.age.dry[1] - C.age.dry[0]));
  const rgb = [0, 1, 2].map((k) => lerp(lerp(fresh[k], dark[k], d), dry[k], y));
  return { rgb, wet: 1 - clamp01(a / C.age.dry[0]) };
}

/** Roughness of blood `age` s old (0.06 fresh … 0.75 dry). */
export function bloodRoughness(age, s = 'soil') {
  return lerp(0.06, 0.75, 1 - bloodColor(age, s).wet);
}

/** Is a pool this old still wet enough to print boots (§B.5: 3 min, 10 min on snow)? */
export function poolWet(age, s = 'soil') {
  const w = s === 'snow' ? surfaceSpec('snow').wetAge : CONFIG.blood.trail.wetAge;
  return age < w;
}

// --------------------------------------------------------------------------------------------- budgets (§B.6)

/** Budgets for a quality preset name. */
export function budgets(preset = 'high') {
  return CONFIG.blood.budgets[preset] || CONFIG.blood.budgets.high;
}

/**
 * Index of the pool to recycle when the budget is full: the oldest DRY pool first (stopped + past the dry age),
 * else the oldest stopped pool, else the oldest pool. Ties break on the lower id (deterministic).
 * @param {{id:number, t0:number, age:number, stopped:boolean, surface:string}[]} pools
 */
export function recycleIndex(pools) {
  let best = -1, bk = null;
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    const dry = p.stopped && 1 - bloodColor(p.age, p.surface).wet >= 0.999;
    const key = [dry ? 0 : p.stopped ? 1 : 2, -p.age, p.id];
    if (!bk || key[0] < bk[0] || (key[0] === bk[0] && (key[1] < bk[1] || (key[1] === bk[1] && key[2] < bk[2])))) { best = i; bk = key; }
  }
  return best;
}

/** Stain slot to recycle: the oldest, then smallest (§B.4). */
export function recycleStain(slots) {
  let best = 0;
  for (let i = 1; i < slots.length; i++) {
    const a = slots[i], b = slots[best];
    if (a.t0 < b.t0 || (a.t0 === b.t0 && a.radius < b.radius)) best = i;
  }
  return best;
}

// --------------------------------------------------------------------------------------------- bloody feet (§B.5)

/** A foot landing on a fresh pool: the counter goes to 6 (never down). */
export function stepInPool(unit) { unit.bloodyFeet = Math.max(unit.bloodyFeet || 0, CONFIG.blood.trail.bloodyFeet); }

/** One footfall: returns the print opacity (bloodyFeet / 6) and decrements, or 0 when the feet are clean. */
export function bloodyStep(unit) {
  const n = unit.bloodyFeet || 0;
  if (n <= 0) return 0;
  unit.bloodyFeet = n - 1;
  return n / CONFIG.blood.trail.bloodyFeet;
}
