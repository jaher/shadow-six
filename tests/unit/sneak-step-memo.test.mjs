/**
 * planSneakGen's step memo (sneak.mjs stepMemo: two bits a step in words of 32, a window asked a word at a time) gives
 * the answers of the byte-per-(cell, step) memo it replaces and calls fresh() for the same (cell, step)s in the same
 * order — so a plan's search is the same search (perf/m13: M13's failing crawl into the crates' shadow, ~10 M memo
 * lookups a search). Checked against that byte memo, verbatim, on random answer tables and query streams: windows of 1
 * to 80 steps from below 0, across word edges, up to and past KS (a step past KS shares the next cell's memo slot in
 * both, the last cell's is not kept).
 */
import { test, assert } from './lib.mjs';
import { stepMemo } from '../../tools/solutions/sneak.mjs';

/** The memo as planSneakGen had it (2026-11-08 master): a byte per (cell, step), clear() step by step. */
function byteMemo(cells, KS, fresh) {
  const seenMemo = new Uint8Array(cells * KS);
  const seen = (c, k) => {
    const key = c * KS + k;
    const m = seenMemo[key]; if (m) return m === 2;
    const s = fresh(c, k);
    seenMemo[key] = s ? 2 : 1;
    return s;
  };
  const clear = (c, k0, k1) => { for (let k = Math.max(0, k0); k <= k1; k++) if (seen(c, k)) return false; return true; };
  return { seen, clear };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('stepMemo: the same answers and the same fresh() calls, in order, as the byte memo (random tables and windows)', () => {
  let queries = 0, calls = 0, falses = 0;
  for (const [seed, cells, KS, density] of [[1, 7, 70, 0.1], [2, 5, 96, 0.5], [3, 9, 33, 0.02], [4, 3, 200, 0.85], [5, 12, 64, 0.25], [6, 4, 31, 0.3]]) {
    const r = rng(seed);
    // the answer table, with runs (a guard's cone passing): more steps than KS (a window past it)
    const T = Array.from({ length: cells }, () => { const row = new Uint8Array(KS + 120); let on = false; for (let k = 0; k < row.length; k++) { if (r() < 0.15) on = r() < density; row[k] = on ? 1 : 0; } return row; });
    const logA = [], logB = [];
    const A = stepMemo(cells, KS, (c, k) => { logA.push(c * 100000 + k); return T[c][k] === 1; });
    const B = byteMemo(cells, KS, (c, k) => { logB.push(c * 100000 + k); return T[c][k] === 1; });
    for (let n = 0; n < 4000; n++) {
      const c = Math.floor(r() * cells);
      if (r() < 0.2) {
        const k = Math.floor(r() * (KS + 100));
        assert.equal(A.seen(c, k), B.seen(c, k), `seen(${c}, ${k}) seed ${seed}`);
      } else {
        const k0 = Math.floor(r() * (KS + 40)) - 6, k1 = k0 + Math.floor(r() * 80);
        const a = A.clear(c, k0, k1), b = B.clear(c, k0, k1);
        assert.equal(a, b, `clear(${c}, ${k0}, ${k1}) seed ${seed}`);
        if (!a) falses++;
      }
      queries++;
      assert.equal(logA.length, logB.length, `fresh() calls after query ${n} seed ${seed}`);
    }
    assert.deepEqual(logA, logB, `fresh() asked of the same steps in the same order (seed ${seed})`);
    calls += logA.length;
  }
  assert.ok(queries === 24000 && calls > 5000 && falses > 2000 && falses < 20000, `exercised (${queries} queries, ${calls} fresh calls, ${falses} windows seen)`);
});
