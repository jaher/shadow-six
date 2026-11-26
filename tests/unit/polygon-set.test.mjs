/**
 * core/math.js polygonSetTest: the bounding-box-first point test art/terrain.js groundExclude puts in front of a
 * mission's render-only `bareGround` (every grass tuft, litter and apron candidate asks it). It must answer exactly as
 * testing every polygon with the plain even-odd rule does — on every mission's own polygons, over the map and the
 * apron, on their vertices, edges and bounding-box lines (and just past them).
 */
import { test, assert } from './lib.mjs';
import { polygonSetTest, pointInPolygon } from '../../src/core/math.js';
import { MISSIONS } from '../../src/missions/index.js';

/** The plain answer groundExclude gave before: every polygon, even-odd. */
const plain = (polys) => (x, z) => polys.some((P) => pointInPolygon(x, z, P));
/** A small seeded RNG (mulberry32): the same points every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Points that sit exactly on what a polygon set is made of: vertices, edge points, box lines and just past them. */
function boundaryPoints(polys) {
  const out = [];
  for (const P of polys) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i], [xn, zn] = P[(i + 1) % P.length];
      out.push([x, z]);
      for (const t of [0.25, 0.5, 0.75]) out.push([x + (xn - x) * t, z + (zn - z) * t]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const e = 1e-9, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    for (const z of [z0, mz, z1, z0 - e, z1 + e]) for (const x of [x0, x0 - e, x0 + e, mx, x1, x1 - e, x1 + e]) out.push([x, z]);
  }
  return out;
}
const bareOf = (m) => (m.bareGround || []).map((b) => b.points || b).filter((p) => Array.isArray(p) && p.length >= 3);

test('polygonSetTest answers as the plain even-odd test on every mission\'s bareGround (map, apron, vertices, edges, box lines)', () => {
  const withBare = MISSIONS.filter((m) => bareOf(m).length);
  assert.ok(withBare.some((m) => m.id === 'e03'), 'e03 has its bare ground (the hall, the veranda, the tent, the puddles)');
  let checked = 0;
  for (const m of withBare) {
    const polys = bareOf(m), a = polygonSetTest(polys), b = plain(polys);
    const [W, D] = m.size || [150, 120];
    const r = rng(7 + checked);
    let ins = 0;
    for (let k = 0; k < 60000; k++) { // the map and 60 m of apron round it
      const x = -60 + r() * (W + 120), z = -60 + r() * (D + 120);
      const ab = b(x, z);
      assert.equal(a(x, z), ab, `${m.id}: (${x}, ${z})`);
      if (ab) ins++;
    }
    let onIn = 0, onOut = 0;
    for (const [x, z] of boundaryPoints(polys)) {
      const ab = b(x, z);
      assert.equal(a(x, z), ab, `${m.id}: boundary (${x}, ${z})`);
      if (ab) onIn++; else onOut++;
    }
    assert.ok(onIn > 0 && onOut > 0, `${m.id}: boundary points fall both in and out (${onIn} / ${onOut})`);
    if (m.id === 'e03') assert.ok(ins > 1000, `e03: random points inside its bare ground (${ins})`);
    checked++;
  }
  assert.ok(checked >= 1);
});

test('polygonSetTest: concave, collinear, flat-edged and overlapping polygons; a two-point one is no polygon', () => {
  const polys = [
    [[0, 0], [10, 0], [10, 10], [6, 10], [6, 3], [4, 3], [4, 10], [0, 10]], // a U (concave)
    [[20, 0], [25, 0], [30, 0], [30, 5], [30, 10], [20, 10]],              // collinear vertices, flat edges
    [[8, 8], [24, 8], [24, 12], [8, 12]],                                  // overlapping both
    [[50, 50], [60, 60]],                                                  // two points: not a polygon
  ];
  const a = polygonSetTest(polys), b = plain(polys.filter((P) => P.length >= 3));
  const r = rng(99);
  for (let k = 0; k < 40000; k++) { const x = -5 + r() * 70, z = -5 + r() * 70; assert.equal(a(x, z), b(x, z), `(${x}, ${z})`); }
  for (const [x, z] of boundaryPoints(polys.filter((P) => P.length >= 3))) assert.equal(a(x, z), b(x, z), `boundary (${x}, ${z})`);
  assert.equal(a(5, 5), false, 'inside the U\'s notch');
  assert.equal(a(2, 5), true, 'in the U\'s arm');
  assert.equal(a(55, 55), false, 'the two-point "polygon" is no polygon');
});
