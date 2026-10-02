/**
 * Fuel-tank family (docs/fuel-tanks.md): which library model a `fueltank` structure (or an `oil_tanks_vertical`
 * barrels pair) resolves to, from its mission `variant`, footprint and theater, plus the explosion scale used by the fx
 * layer. Pure functions (node-testable); building-props.js asks `fuelTankAsset()` before its generic variant choice.
 *
 *   horizontal_cradle      → fuel_tank_h_cradle (stand at +X) or fuel_tank_h_cradle_m (stand at -X) so the stand sits
 *                            on the OUTER end of a pair (nearest fueltank of the same mission on the local +X side → _m)
 *   fuel_tank_horizontal   → deck block (w/d < 1.6: fuel_tank_farm_9x7 | _85x63), quay tank (coast/temperate, d ≥ 4:
 *                            fuel_tank_quay_12 | _11), else the cradle tank
 *   fuel_tank_elevated     → fuel_tank_elevated (M17, with the working oil valve)
 *   oil_tanks_vertical     → oil_tank_column | oil_tank_column_b (alternating by id hash; also for type `barrels`)
 *   (no variant)           → round footprint: oil_tank_column (desert) | fuel_tank_vertical_t (else); w × d: as fuel_tank_horizontal
 * @module art/fuel-tanks
 */

/** Variant names this module resolves (mission data → library family). */
export const FUEL_VARIANTS = Object.freeze(['horizontal_cradle', 'fuel_tank_horizontal', 'fuel_tank_elevated', 'oil_tanks_vertical']);

/**
 * A column-shaped footprint (round, or at least 5 m tall): M11's `oil_tanks_vertical` tanks (r 1.75, h 7). A low w × d
 * `barrels` dump with that variant (M8 drums_w1/w2: 6.5 × 7.5 × 2.2) is a drum pile, not a process column.
 */
export const isColumnFootprint = (s) => !!s && ((s.w == null && s.d == null) || (s.h ?? 0) >= 5);   // (a w × d wins over a default r)

/** Structure types the family can dress (and blow up as a fuel tank: fx `_structureBlast`). */
export const isFuelStructure = (s) => !!s && (s.type === 'fueltank' || s.type === 'fuel_tank' ||
  ((s.type === 'barrels' || s.type === 'oil_tank') && s.variant === 'oil_tanks_vertical' && isColumnFootprint(s)));

const h01 = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) / 4294967296; };

/**
 * Library asset (intact, non-snow base name) for a fuel structure, or null when the family has no model for it.
 * @param {object} p structure def ({id, type, variant, x, z, rot, w, d, r})
 * @param {{theater?: string, structures?: object[], has?: (name: string) => boolean}} [ctx] has = manifest lookup
 * @returns {string|null}
 */
export function fuelTankAsset(p = {}, ctx = {}) {
  if (!isFuelStructure(p)) return null;
  const th = ctx.theater === 'night' ? 'temperate' : (ctx.theater || 'temperate');
  const has = ctx.has || (() => true);
  const pick = (...names) => names.find((n) => n && has(n)) ?? null;
  const w = p.w ?? (p.r != null ? p.r * 2 : null), d = p.d ?? (p.r != null ? p.r * 2 : null);
  const horizontal = () => {
    if (w && d && Math.max(w, d) / Math.min(w, d) < 1.6) return pick(Math.max(w, d) >= 8.8 ? 'fuel_tank_farm_9x7' : 'fuel_tank_farm_85x63', 'fuel_tank_farm_9x7');
    if ((th === 'coast' || th === 'temperate') && d >= 4) return pick((w ?? 0) >= 11.5 ? 'fuel_tank_quay_12' : 'fuel_tank_quay_11', 'fuel_tank_quay_12');
    return cradle();
  };
  const cradle = () => pick(partnerOnPlusX(p, ctx.structures) ? 'fuel_tank_h_cradle_m' : 'fuel_tank_h_cradle', 'fuel_tank_h_cradle');
  switch (p.variant) {
    case 'horizontal_cradle': return cradle();
    case 'fuel_tank_horizontal': return horizontal();
    case 'fuel_tank_elevated': return pick('fuel_tank_elevated');
    case 'oil_tanks_vertical': if (!isColumnFootprint(p)) return null; return h01(String(p.id ?? `${p.x},${p.z}`)) < 0.5 ? pick('oil_tank_column', 'oil_tank_column_b') : pick('oil_tank_column_b', 'oil_tank_column');
    default:
      if (p.variant != null && p.variant !== '') return null;      // an unknown hint: leave it to the generic choice
      if (p.w == null && p.d == null) return th === 'desert' ? pick('oil_tank_column', 'fuel_tank_vertical_t') : pick('fuel_tank_vertical_t', 'oil_tank_column');
      return horizontal();
  }
}

/** Is the nearest other fueltank (within 16 m) on this tank's local +X side? (placement: local +X = (cos rot, sin rot)) */
export function partnerOnPlusX(p, structures = []) {
  let best = null, bd = 16;
  for (const s of structures || []) {
    if (s === p || (s.id != null && s.id === p.id) || !isFuelStructure(s)) continue;
    const dd = Math.hypot((s.x ?? 0) - (p.x ?? 0), (s.z ?? 0) - (p.z ?? 0));
    if (dd > 0.01 && dd < bd) { bd = dd; best = s; }
  }
  if (!best) return false;
  const r = p.rot ?? 0;
  return ((best.x - p.x) * Math.cos(r) + (best.z - p.z) * Math.sin(r)) > 0;
}

/**
 * Explosion scale for a fuel structure (fx `_structureBlast`): fireball and pool fire grow with the tank volume.
 * @returns {{fire: number, scale: number, smoke: number}} fire = pool-fire radius (m), scale = blast scale, smoke = column scale
 */
export function fuelBlastScale(def = {}) {
  const w = def.w ?? (def.r != null ? def.r * 2 : 4), d = def.d ?? (def.r != null ? def.r * 2 : 4), h = def.h ?? 4;
  const vol = Math.max(8, w * d * Math.min(h, 7) * 0.5);           // ~ m³ of stored fuel (half the bounding volume)
  const k = Math.cbrt(vol / 50);                                     // 1 at the M2 depot tank (~53 m³)
  return {
    fire: Math.min(7.5, Math.max(2.5, Math.max(w, d) * 0.42 * Math.min(1.25, k))),
    scale: Math.min(1.6, Math.max(0.7, k)),
    smoke: Math.min(1.6, Math.max(0.8, k * 1.1)),
  };
}

/**
 * §7 wreck navigation: a destroyed fuel structure keeps its footprint (the burst shell, the stand, the collapsed deck
 * still stand there; heights drop to ~60 % of h, still a HIGH obstacle for tanks of h ≥ 2.5). A deck block (M8: the
 * mission's `walkways` cover the top) loses its walkable deck: those cells drop to the ground and become the wreck's
 * footprint, LOW over the collapsed corner (local −X/+Z quarter, the buckled column) and HIGH elsewhere.
 * @param {object} def mission structure def
 * @returns {null|{block: 'HIGH'|'LOW', deck: boolean, lowQuarter: [number, number]|null}} null = not a fuel structure
 */
export function fuelWreckNav(def) {
  if (!isFuelStructure(def)) return null;
  const h = def.h ?? 4;
  const deck = Array.isArray(def.walkways) && def.walkways.length > 0;
  return { block: h * 0.6 >= 1.5 ? 'HIGH' : 'LOW', deck, lowQuarter: deck ? [-1, 1] : null };
}

/** Is world point (x, z) in the local quarter (sx, sz signs) of a w × d footprint (centre x, z, rot)? */
export function inLocalQuarter(def, x, z, [sx, sz]) {
  const r = def.rot ?? 0, dx = x - (def.x ?? 0), dz = z - (def.z ?? 0);
  const lx = dx * Math.cos(r) + dz * Math.sin(r), lz = -dx * Math.sin(r) + dz * Math.cos(r);
  const w = def.w ?? (def.r ?? 2) * 2, d = def.d ?? (def.r ?? 2) * 2;
  return Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2 && lx * sx > 0 && lz * sz > 0 && Math.abs(lx) >= w / 4 - 1e-6 && Math.abs(lz) >= d / 4 - 1e-6;
}
