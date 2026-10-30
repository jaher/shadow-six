import { test, assert } from './lib.mjs';
import { hypot2, hypot3, dist } from '../../src/core/math.js';

// hypot2 / hypot3 must return Math.hypot's double exactly (a different last bit would change a deterministic run)
const SPECIAL = [NaN, Infinity, -Infinity, 0, -0, 1, -1, 3, 4, 0.1, 1e-200, 5e-324, 1.7976931348623157e308, 1e300, -2.5e-310];
function rnd(r) {
  const k = r();
  if (k < 0.08) return 0;
  if (k < 0.12) return -0;
  if (k < 0.18) return (r() - 0.5) * 1e-310; // subnormal
  if (k < 0.24) return (r() - 0.5) * 1e300;
  if (k < 0.32) return Math.round((r() - 0.5) * 200);
  return (r() - 0.5) * Math.pow(10, Math.floor(r() * 9) - 3);
}

test('hypot2 / hypot3 / dist return Math.hypot\'s double bit for bit (special values and 600k random triples)', () => {
  let bad = 0, n = 0;
  const check = (got, want, args) => { n++; if (!Object.is(got, want)) { bad++; if (bad < 4) console.log('  mismatch', args, got, want); } };
  for (const a of SPECIAL) for (const b of SPECIAL) {
    check(hypot2(a, b), Math.hypot(a, b), [a, b]);
    for (const c of SPECIAL) check(hypot3(a, b, c), Math.hypot(a, b, c), [a, b, c]);
  }
  let s = 0x2545F491;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 600000; i++) {
    const a = rnd(r), b = rnd(r), c = rnd(r), d = rnd(r);
    check(hypot2(a, b), Math.hypot(a, b), [a, b]);
    check(hypot3(a, b, c), Math.hypot(a, b, c), [a, b, c]);
    check(dist(a, b, c, d), Math.hypot(c - a, d - b), [a, b, c, d]);
  }
  // (and what Math.hypot does with what is not a number: ToNumber, in order)
  check(hypot2('3', 4), Math.hypot('3', 4), ['3', 4]); check(hypot2(undefined, 1), Math.hypot(undefined, 1), [undefined, 1]);
  check(hypot3(null, 2, '2'), Math.hypot(null, 2, '2'), [null, 2, '2']);
  assert.equal(bad, 0, `${bad} of ${n} differ`);
});
