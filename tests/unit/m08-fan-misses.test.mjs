// fanMisses (tools/solutions/m08.solution.mjs): sees() skips a viewer's head offsets at a pose only when no cone of
// them can hold the point — checked here against the real coneAt + pointInCone (src/ai/perception.js) over random
// viewers, poses, head-offset fans and points: whenever fanMisses says so, every cone says null.
import { test, assert } from './lib.mjs';
import { coneAt, pointInCone } from '../../src/ai/perception.js';
import { fanMisses } from '../../tools/solutions/m08.solution.mjs';

/** a seeded random (mulberry32) */
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const viewer = (r) => {
  const elliptical = r() < 0.5;
  const v = { far: 8 + r() * 40, fov: (40 + r() * 100) * Math.PI / 180, near: 4 + r() * 8, elliptical, phase: r() * 3, sweep: 0.8, period: 2.5 };
  if (elliptical && r() < 0.5) v.ellipseRatio = 0.2 + r() * 0.6;
  return { vision: v, headCarry: r() < 0.3 ? (r() - 0.5) * 0.6 : 0, y: r() < 0.2 ? 4 : 0, sweepAmp: undefined };
};
const fanOf = (r) => {
  const k = r();
  if (k < 0.3) return Array.from({ length: 11 }, (_, i) => (50 * Math.PI / 180) * (i / 5 - 1)); // a halt's whole sweep
  if (k < 0.6) return [0, 0.17, -0.17, 0.35, -0.35]; // a leg, fanned
  if (k < 0.8) return [0, 0.07, -0.07];
  if (k < 0.9) return [0];
  return [0, (r() - 0.5) * 1.6, (r() - 0.5) * 1.6, (r() - 0.5) * 1.6];
};
/** what sees() asks for each offset: the cone of his ghost at the pose, sweep off, head turned by the offset */
const anyHolds = (e, pos, hd, offs, x, z, tAbs) => offs.some((off) => {
  const g = Object.create(e); g.x = pos.x; g.z = pos.z; g.heading = hd; g.sweepActive = false; g.headOffset = off;
  return pointInCone(coneAt(g, tAbs), x, z) !== null;
});

test('m08 fanMisses: never true while a cone of the fan holds the point (60 000 random cases, half of them misses)', () => {
  const r = rng(808);
  let misses = 0, n = 0;
  for (let k = 0; k < 60000; k++) {
    const e = viewer(r), pos = { x: r() * 100, z: r() * 100 }, hd = (r() - 0.5) * 4 * Math.PI, offs = fanOf(r);
    // (points near the edges of the cones most of the time: just beyond the reach, or by the sector's sides)
    const ang = hd + (r() - 0.5) * 2 * Math.PI, d = r() < 0.3 ? e.vision.far * (0.98 + r() * 0.04) : r() * e.vision.far * 1.2;
    const x = pos.x + Math.cos(ang) * d, z = pos.z + Math.sin(ang) * d;
    const miss = fanMisses(e, pos, hd, offs, x, z);
    n++;
    if (miss) { misses++; assert.ok(!anyHolds(e, pos, hd, offs, x, z, 12.3), `case ${k}: fanMisses said no cone holds (${x.toFixed(3)},${z.toFixed(3)})`); }
  }
  assert.ok(misses > n * 0.3, `it skips often enough to matter (${misses} of ${n})`);
});

test('m08 fanMisses: the same bound without the fan\'s spread (negative control) would skip cones that hold the point', () => {
  const r = rng(77);
  // (a bound on the middle offset alone — what a wrong fanMisses would do — misses points the outer offsets see)
  let wrong = 0;
  for (let k = 0; k < 20000; k++) {
    const e = viewer(r), pos = { x: 50, z: 50 }, hd = r() * 2 * Math.PI, offs = Array.from({ length: 11 }, (_, i) => (50 * Math.PI / 180) * (i / 5 - 1));
    const ang = hd + (r() - 0.5) * 2 * Math.PI, d = r() * e.vision.far * 0.5;
    const x = pos.x + Math.cos(ang) * d, z = pos.z + Math.sin(ang) * d;
    if (fanMisses(e, pos, hd, [0], x, z) && anyHolds(e, pos, hd, offs, x, z, 0)) wrong++;
  }
  assert.ok(wrong > 100, `the spread matters: ${wrong} points a one-offset bound would wrongly skip`);
});

test('m08 fanMisses: unsure cases are never skipped (no fov, the point on the viewer, no vision)', () => {
  const e = { vision: { far: 20, elliptical: false }, headCarry: 0 };
  assert.equal(fanMisses(e, { x: 0, z: 0 }, 0, [0], -5, 0), false, 'no fov: no angle test');
  const e2 = { vision: { far: 20, fov: 1, elliptical: false }, headCarry: 0 };
  assert.equal(fanMisses(e2, { x: 0, z: 0 }, 0, [0], 0, 0), false, 'the point on him');
  assert.equal(fanMisses({ vision: null }, { x: 0, z: 0 }, 0, [0], 50, 0), false);
  assert.equal(fanMisses(e2, { x: 0, z: 0 }, 0, [0], 25, 0), true, 'beyond his reach');
  assert.equal(fanMisses(e2, { x: 0, z: 0 }, 0, [0], -5, 0), true, 'behind him');
});
