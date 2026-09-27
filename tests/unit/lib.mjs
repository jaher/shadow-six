/** Tiny registration API shared by unit test files. */
import assert from 'node:assert/strict';

export const cases = [];

/** Register a test case. @param {string} name @param {() => any} fn */
export function test(name, fn) {
  cases.push({ name, fn });
}

/** Assert |a - b| <= eps. */
export function near(a, b, eps = 1e-6, msg = '') {
  if (!(Math.abs(a - b) <= eps)) throw new assert.AssertionError({ message: `${msg} expected ${a} ≈ ${b} (±${eps})`, actual: a, expected: b });
}

export { assert };
