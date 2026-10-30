/**
 * Hidden-class hygiene for the long-lived simulation objects (units, brains, the world). Pure module.
 * @module core/shapes
 */

/**
 * Give object `o` number fields `keys` holding `v`, stored as double-valued fields from the start (V8). A field whose
 * first value is a whole number is kept as a small integer; the first fractional value written to it later rebuilds the
 * class's hidden-class tree below that field (a unit's: 100-120 maps at a time) and throws away the optimised code that
 * used them — the start of an M3 walkthrough rebuilt ~6 000 maps in its first 20 s, with ~900 deopts. The same values,
 * read the same: only how V8 stores them differs.
 * @param {object} o @param {number} v @param {...string} keys
 */
export function doubleFields(o, v, ...keys) {
  for (let i = 0; i < keys.length; i++) { const k = keys[i]; o[k] = 0.5; o[k] = v; }
}
