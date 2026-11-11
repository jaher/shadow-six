/**
 * driver.mjs goalReachable with the planner's own further goal test (`ok`: sneak.mjs passes its `goalOk`, an arrival only
 * at given moments): a search can end only on a goal state the cell stays unseen from for the hold AND that `ok` accepts,
 * so with no such state it returns the planner's null at once (M20: the e27 crawl's two moment states, neither with the
 * corner unwatched for the 14 s hold, each search ~40 000 states for its null). Here the answer must be exactly "is there
 * a step k in [k0, kMax] with ok(c, k) and the cell unseen from k to k + holdK", brute-forced over random watch patterns.
 */
import { test, assert } from './lib.mjs';
import { goalReachable } from '../../tools/solutions/driver.mjs';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** One goal cell (raft: no neighbours), watched at the steps in `watched`. */
function args(watched, { k0 = 0, kMax = 60, holdK = 8, ok = null } = {}) {
  const seen = (c, k) => watched.has(k);
  return { s1: 0, tx: 0.5, tz: 0.5, W: 1, H: 1, x0: 0, z0: 0, cx: () => 0.5, cz: () => 0.5, k0, holdK, kMax, seen, raft: true, ok };
}

function brute(watched, { k0 = 0, kMax = 60, holdK = 8, ok = null } = {}) {
  for (let k = Math.max(0, k0); k <= kMax; k++) {
    if (ok && !ok(0, k)) continue;
    let clear = true;
    for (let j = k; j <= k + holdK; j++) if (watched.has(j)) { clear = false; break; }
    if (clear) return true;
  }
  return false;
}

test('goalReachable: a stay counts only from a step the goal test accepts (moments), as a search would end', () => {
  const r = rng(30102026);
  let yes = 0, no = 0, withoutOk = 0;
  for (let n = 0; n < 3000; n++) {
    const watched = new Set(), p = r() * 0.4, k0 = Math.floor(r() * 5), kMax = 20 + Math.floor(r() * 60), holdK = 1 + Math.floor(r() * 12);
    for (let k = 0; k <= kMax + holdK + 2; k++) if (r() < p) watched.add(k);
    const moments = new Set(); const m = Math.floor(r() * 4);
    for (let i = 0; i < m; i++) moments.add(Math.floor(r() * (kMax + 5)));
    const ok = (c, k) => moments.has(k);
    const o = { k0, kMax, holdK, ok };
    const want = brute(watched, o);
    assert.equal(goalReachable(args(watched, o)), want, `case ${n}`);
    if (want) yes++; else no++;
    // (no goal test: any stay that begins in [k0, kMax], as before)
    assert.equal(goalReachable(args(watched, { k0, kMax, holdK })), brute(watched, { k0, kMax, holdK }), `case ${n} without ok`);
    if (brute(watched, { k0, kMax, holdK }) && !want) withoutOk++;
  }
  assert.ok(yes > 100 && no > 100, `both answers covered: ${yes} / ${no}`);
  assert.ok(withoutOk > 100, `the moments rule out stays the plain test accepts: ${withoutOk}`);
});
