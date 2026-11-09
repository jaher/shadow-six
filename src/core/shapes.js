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

/** A value of its own hidden class, never kept: anyFields' first write. */
const OTHER_KIND = new Uint8Array(0);
/**
 * Give object `o` fields `keys` holding `v` (null, undefined, an object…), written in play with values of more than one
 * kind — null then an array, a function, a set: each takes two kinds here, so it is a field of any type that is written
 * to (V8: neither a constant nor of one class) from the start. A field's first write in play that changes either widens
 * it for every object of the class's shape and throws away the optimised code that counted on it — M14's barrel blast
 * re-made the crawlers' step cells (the grid's crawlStep, first rewritten there) and every optimised reader of the grid
 * was thrown out mid-blast, its next ticks' searches unoptimised. The same values, read the same.
 * @param {object} o @param {*} v @param {...string} keys
 */
export function anyFields(o, v, ...keys) {
  for (let i = 0; i < keys.length; i++) { const k = keys[i]; o[k] = OTHER_KIND; o[k] = null; o[k] = v; }
}
