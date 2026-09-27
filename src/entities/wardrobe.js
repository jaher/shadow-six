/**
 * BCD Spy wardrobe (docs/bcd-plan.md §1.6): the typed list of uniforms the Spy holds. Dependency-free so both
 * the entities (clothesline, uniform pickups) and the abilities (hanger, U) can use it. Only called under the
 * BCD ruleset (`world.rules.spyUniformFromCaptives`).
 * @module entities/wardrobe
 */

/** Uniforms held, no duplicates (a BEL generic `uniform` item alone counts as a private's). */
export function wardrobeOf(c) {
  if (c.wardrobe?.length) return c.wardrobe;
  return c.has?.('uniform') ? ['soldier'] : [];
}

/** Add uniform `u` to the wardrobe (and the generic item the U button keys on). @returns {boolean} new entry */
export function addToWardrobe(c, u = 'soldier') {
  const before = wardrobeOf(c);
  const fresh = !before.includes(u);
  c.wardrobe = [...new Set([...before, u])];
  if (!c.has?.('uniform')) c.gainItem ? c.gainItem('uniform', 1) : c.inventory?.set('uniform', 1);
  return fresh;
}
