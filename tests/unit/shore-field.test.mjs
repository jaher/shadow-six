/**
 * Continuous shore field (world/shore-field.js; user request 2026-09-30 "make the edges of the shore more smooth and
 * less polygonal"): smoothed mission shapes → a sub-cell signed distance with no cell staircase, no octagons and no
 * polygon facets; the nav grid's wet cells still agree with the drawn shore everywhere but within a cell of it.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { MISSIONS, getMission } from '../../src/missions/index.js';
import { T } from '../../src/world/grid.js';
import { buildApronField } from '../../src/world/apron-field.js';
import { buildShoreField, smoothCurve, shoreNoise, maskSignedDistance } from '../../src/world/shore-field.js';
import { sampleCells } from '../../src/art/terrain/terrain.js';

const isWet = (c) => c === T.WATER || c === T.SHALLOW;
const cache = new Map();
/** The field the game builds (art/terrain.js buildTerrain): over the apron code grid, with its extended features. */
const fields = (id) => {
  if (!cache.has(id)) {
    const ctx = loadGrid(getMission(id)), ap = buildApronField(ctx.grid, ctx.def);
    const f = buildShoreField(ap.grid, ctx.def, { ox: ap.ox, oz: ap.oz, feats: ap.feats, W: ap.W, D: ap.D });
    cache.set(id, { ...ctx, ap, f });
  }
  return cache.get(id);
};

/** First zero crossing of f along o + t d, t in [t0, t1] (bisection), or null. */
function root(f, o, d, t0, t1) {
  const n = Math.ceil((t1 - t0) / 0.05), at = (t) => f(o[0] + d[0] * t, o[1] + d[1] * t);
  let a = t0, fa = at(a);
  for (let k = 1; k <= n; k++) {
    const b = t0 + (t1 - t0) * k / n, fb = at(b);
    if ((fa > 0) !== (fb > 0)) {
      let lo = a, hi = b;
      for (let q = 0; q < 30; q++) { const m = (lo + hi) / 2; if ((at(m) > 0) === (fa > 0)) lo = m; else hi = m; }
      const t = (lo + hi) / 2;
      return [o[0] + d[0] * t, o[1] + d[1] * t];
    }
    a = b; fa = fb;
  }
  return null;
}
/** Resample a polyline every s m of arc length. */
function resample(P, s) {
  const out = [P[0]];
  let acc = 0;
  for (let k = 1; k < P.length; k++) {
    let [ax, az] = P[k - 1]; const [bx, bz] = P[k];
    let L = Math.hypot(bx - ax, bz - az);
    while (acc + L >= s) { const t = (s - acc) / L; ax += (bx - ax) * t; az += (bz - az) * t; out.push([ax, az]); L = Math.hypot(bx - ax, bz - az); acc = 0; }
    acc += L;
  }
  return out;
}
/** Facet metric: the largest turn (deg) between consecutive 0.5 m chords of a shoreline (a smooth curve: small). */
function maxTurn(P) {
  const Q = resample(P, 0.5);
  let m = 0;
  for (let k = 1; k + 1 < Q.length; k++) {
    const a = Math.atan2(Q[k][1] - Q[k - 1][1], Q[k][0] - Q[k - 1][0]), b = Math.atan2(Q[k + 1][1] - Q[k][1], Q[k + 1][0] - Q[k][0]);
    let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, d);
  }
  return m * 180 / Math.PI;
}
const polar = (f, c, r0, r1, a0 = 0, a1 = 360) => {
  const P = [];
  for (let a = a0; a <= a1; a += 0.25) { const p = root(f, c, [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)], r0, r1); if (p) P.push(p); }
  return P;
};
const columns = (f, x0, x1, z0, z1) => { const P = []; for (let x = x0; x <= x1; x += 0.1) { const p = root(f, [x, z0], [0, 1], 0, z1 - z0); if (p) P.push(p); } return P; };

test('smoothCurve: corners round off within ~0.5 m, sides stay straight, coarse outlines lose their facets', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const S = smoothCurve(sq, { closed: true });
  let dev = 0, out = 0;
  for (const [x, z] of S) {
    out = Math.max(out, -x, -z, x - 10, z - 10);
    if (Math.min(...sq.map(([cx, cz]) => Math.hypot(x - cx, z - cz))) > 3.5) dev = Math.max(dev, Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(z), Math.abs(z - 10)));
  }
  assert.ok(out < 0.05, `never outside the outline (${out.toFixed(3)} m)`);
  assert.ok(dev < 0.05, `the sides stay straight away from the corners (max off-side ${dev.toFixed(3)} m)`);
  let cut = 0;
  for (const [cx, cz] of sq) cut = Math.max(cut, Math.min(...S.map(([x, z]) => Math.hypot(x - cx, z - cz))));
  assert.ok(cut > 0.3 && cut < 0.6, `corners rounded by ${cut.toFixed(2)} m (nav cells keep agreeing)`);
  assert.ok(maxTurn([...S, S[0]]) < 55, `a right angle becomes a fillet: max turn ${maxTurn([...S, S[0]]).toFixed(1)} deg per 0.5 m`);
  // a coarse authored outline (an octagonal pond, 45 deg corners every ~6 m) reads as a smooth curve
  const oct = Array.from({ length: 8 }, (_, k) => [8 * Math.cos(k * Math.PI / 4), 8 * Math.sin(k * Math.PI / 4)]);
  const O = smoothCurve(oct, { closed: true });
  assert.ok(maxTurn([...O, O[0]]) < 22, `octagon: max turn ${maxTurn([...O, O[0]]).toFixed(1)} deg per 0.5 m (was 45 at each corner)`);
  // open curves interpolate an extra coordinate (a width) with no overshoot
  const P = smoothCurve([[0, 0, 4], [5, 1, 10], [10, 0, 4]]);
  assert.ok(P.every((p) => p[2] >= 4 - 1e-9 && p[2] <= 10 + 1e-9), 'widths stay within their keys');
  assert.deepEqual(P[0], [0, 0, 4]); assert.deepEqual(P.at(-1), [10, 0, 4]);
});

test('shore noise is gentle (|n| < 0.3 m) and smooth', () => {
  let m = 0, g = 0;
  for (let x = 0; x < 60; x += 0.37) for (let z = 0; z < 60; z += 0.41) {
    const n = shoreNoise(x, z); m = Math.max(m, Math.abs(n));
    g = Math.max(g, Math.abs(shoreNoise(x + 0.05, z) - n) / 0.05);
  }
  assert.ok(m < 0.3, `amplitude ${m.toFixed(3)} m`);
  assert.ok(g < 0.5, `slope ${g.toFixed(3)}`);
});

test('M2: the river banks and both islets are continuous, smooth curves (the old cell field had facets)', () => {
  const { f, grid } = fields('m02');
  // the raw cell staircase (exact distance of the wet cell mask; art/terrain cellSignedDistance now evens it out
  // along the edge, but its contour still follows the cells): the metric must see its facets
  const old = sampleCells(maskSignedDistance(grid.terrain.map((c) => (isWet(c) ? 1 : 0)), grid.cols, grid.rows, grid.cell), grid);
  // continuity: a 1-Lipschitz-ish field (distance + gentle noise), no jumps anywhere around the islets and banks
  let lip = 0;
  for (let x = 4; x < 56; x += 0.07) for (let z = 50; z < 95; z += 0.5) {
    const v = f.wetAt(x, z);
    if (Math.abs(v) < 2.5) lip = Math.max(lip, Math.abs(f.wetAt(x + 0.07, z) - v) / 0.07); // (saturates at ±margin)
  }
  assert.ok(lip < 1.5, `|grad| <= ${lip.toFixed(2)}`);
  for (const [name, c] of [['islet 1', [16.9, 63.7]], ['islet 2', [40.6, 83.0]]]) {
    const P = polar(f.wetAt, c, 0.3, 6), Q = polar(old, c, 0.3, 6);
    assert.equal(P.length, 1441, `${name}: one closed shoreline around it`);
    const r = P.map(([x, z]) => Math.hypot(x - c[0], z - c[1])), rMin = Math.min(...r), rMax = Math.max(...r);
    // review 2026-09-30: a perfect disc reads machine-made — the islets are authored lobed (m02 islet()): an irregular
    // but smooth outline, neither a circle nor the old cell octagon
    assert.ok(rMax - rMin > 0.5 && rMax - rMin < 1.6, `${name}: natural lobed outline (r ${rMin.toFixed(2)}–${rMax.toFixed(2)} m), not a disc`);
    const t = maxTurn([...P, P[0]]), t0 = maxTurn([...Q, Q[0]]);
    assert.ok(t < 22, `${name}: max turn ${t.toFixed(1)} deg / 0.5 m (cell field: ${t0.toFixed(1)})`);
    assert.ok(t0 > 35, `${name}: the metric sees the old cell facets (${t0.toFixed(1)} deg)`);
  }
});

test('M1 coast and M3 reservoir shores have no polygon / cell facets', () => {
  const m1 = fields('m01');
  const coast = columns(m1.f.wetAt, 1, 33, 30, 50);
  assert.ok(coast.length > 300, 'the fjord shore is found along the camp coast');
  assert.ok(maxTurn(coast) < 15, `M1 coast: max turn ${maxTurn(coast).toFixed(1)} deg / 0.5 m`);
  const m3 = fields('m03');
  // the reservoir's natural E and SW shores (the dam's abutments between them are a structure and keep their corners)
  for (const [name, a0, a1] of [['E', -16, 2], ['SW', 60, 128]]) {
    const res = polar(m3.f.wetAt, [15, 15], 10, 45, a0, a1);
    assert.ok(res.length > (a1 - a0) * 3.5, `the reservoir's ${name} shore is found (${res.length})`);
    assert.ok(maxTurn(res) < 20, `M3 reservoir ${name}: max turn ${maxTurn(res).toFixed(1)} deg / 0.5 m`);
  }
});

test('every map: nav wet cells agree with the drawn shore beyond ~one cell of it (gameplay unchanged)', () => {
  for (const def of MISSIONS) {
    const { f, grid } = fields(def.id);
    let shore = 0, off = 0, worst = 0, deepBad = 0;
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.cols; i++) {
      const c = grid.terrain[j * grid.cols + i], x = (i + 0.5) * grid.cell, z = (j + 0.5) * grid.cell, v = f.wetAt(x, z);
      if (Math.abs(v) < 1) shore++;
      if (isWet(c) !== v > 0) { off++; worst = Math.max(worst, Math.abs(v)); }
      const d = f.deepAt(x, z);
      if ((c === T.WATER) !== d > 0 && Math.abs(d) > 0.8) deepBad++;
    }
    assert.ok(worst < 0.5, `${def.id}: every disagreeing cell centre is within ${worst.toFixed(2)} m of the drawn shore`);
    assert.ok(off <= Math.max(4, shore * 0.12), `${def.id}: ${off} of ${shore} shore cells on the other side of the drawn line`);
    assert.equal(deepBad, 0, `${def.id}: deep (swim) / shallow (wade) cells agree with the drawn deep line`);
  }
});

test('the field covers the apron: rivers and the fjord continue past the map edges with smooth banks', () => {
  const { f, ap } = fields('m02');
  assert.ok(f.ox === -ap.A && f.nx * f.res >= ap.grid.width - 1e-6, 'lattice spans the apron');
  const wetPath = ap.feats.find((q) => q.type === 'path' && q.c === T.WATER);
  const [[ax, az], [bx, bz]] = wetPath.points; // the extension segment, 10 m past the W edge
  const t = (-10 - ax) / (bx - ax), x0 = -10, z0 = az + (bz - az) * t;
  assert.ok(ax < -10 && f.wetAt(x0, z0) > 3, `the M2 river runs on past the W edge (${f.wetAt(x0, z0).toFixed(1)} m from its banks)`);
  const m1 = fields('m01');
  assert.ok(m1.f.wetAt(70, 45) > 1, 'the M1 fjord leaves the map to the east');
  assert.ok(m1.f.foreignCells > 0 && cache.get('m01').f.ms >= 0, 'extruded apron shores use the smoothed cell fallback');
});
