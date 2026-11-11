/**
 * Wall-clock bounds that hold on any machine. Not a *.test.mjs file: imported by the unit tests that bound a cost
 * (tests/unit/wire-placements.test.mjs, barbed-wire.test.mjs).
 *
 * A fixed millisecond bound is a property of the machine it was written on: the same code costs 2-4x more on a shared
 * CI runner, 4-9x more the first time it runs in a process (cold JIT), and any single run can swallow a GC pause or a
 * descheduled second. A bound loose enough for all of that checks nothing; a tight one fails the public CI at random
 * (wire-placements m10: 116 ms and 207 ms in two public CI runs of the same wire code, bound 150).
 *
 * So the cost is measured in units of a reference workload timed right beside it (the same machine, the same load, the
 * same minute), warm, and as the best of several runs: noise only ever adds time, so the minimum is the cost, and what
 * is left is a ratio that moves with the code, not with the host. Use a generous limit (several times the worst ratio
 * measured on a loaded host): the point is to catch a build that became several times more expensive, not a few per cent.
 */

let sink = 0;
const ring = new Array(256);

/**
 * One run of the reference workload (ms): small arrays allocated and filled with trigonometry and square roots, the
 * mix the geometry builders spend their time on. A few ms on a desktop.
 * @param {number} [iters]
 */
export function referenceMs(iters = 3e5) {
  const t = performance.now();
  let s = 0;
  for (let i = 0; i < iters; i++) {
    const p = [Math.sin(i * 0.01), Math.cos(i * 0.013), Math.sqrt(i)];
    ring[i & 255] = p; // escapes: the arrays really are allocated
    s += p[0] * p[1] + p[2];
  }
  sink += s;
  return performance.now() - t;
}

/**
 * The cost of `fn` in reference workloads: the best of `runs` timed runs of `fn` over the best of `runs` runs of the
 * reference workload, taken alternately (a load that comes and goes slows both). If that is over `limit`, measure again,
 * up to `rounds` rounds, and keep the best round: a real slowdown is over the limit every time, a stall is not.
 * `fn` should already be warm (run it once first: the first run in a process pays for the JIT).
 * @param {() => unknown} fn
 * @param {{ runs?: number, rounds?: number, limit?: number }} [o]
 * @returns {{ units: number, ms: number, refMs: number, rounds: number }} the best round, and how many were measured
 */
export function costUnits(fn, { runs = 5, rounds = 3, limit = Infinity } = {}) {
  let best = null, n = 0;
  while (n < rounds && !(best && best.units <= limit)) {
    n++;
    let ms = Infinity, ref = Infinity;
    for (let k = 0; k < runs; k++) {
      ref = Math.min(ref, referenceMs());
      const t = performance.now();
      fn();
      ms = Math.min(ms, performance.now() - t);
    }
    if (!best || ms / ref < best.units) best = { units: ms / ref, ms, refMs: ref, rounds: n };
  }
  best.rounds = n;
  return best;
}
