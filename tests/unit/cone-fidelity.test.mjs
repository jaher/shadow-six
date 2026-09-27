/**
 * design-spec §10.2 acceptance test (§10.5 behaviour test #13): the drawn cone IS the detection geometry.
 * 2,000 random points around a guard per pose: a standing dummy strictly outside the drawn FAR polygon (by
 * more than 0.25 m) is never detected and one strictly inside always is; the same for a crawling dummy
 * against the drawn NEAR polygon. Walls (axis-aligned + a diagonal staircase), a pillar field and a
 * vehicle in the dynamic occluder layer cut the cone; poses cover the sweep (elliptical range) and an
 * mg profile.
 */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { B } from '../../src/world/grid.js';
import { Rng } from '../../src/core/math.js';
import { makeVision } from '../../src/entities/enemy.js';
import { canSee } from '../../src/ai/perception.js';
import { coneFan, conePolygons } from '../../src/render/vision-cone.js';

function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDist(poly, x, z) {
  let m = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, z0] = poly[j], [x1, z1] = poly[i];
    const ex = x1 - x0, ez = z1 - z0, L2 = ex * ex + ez * ez;
    let u = L2 > 0 ? ((x - x0) * ex + (z - z0) * ez) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    m = Math.min(m, Math.hypot(x - (x0 + ex * u), z - (z0 + ez * u)));
  }
  return m;
}

function arena() {
  const w = new World({ size: [90, 90] });
  const g = w.grid;
  g.fillRect(52, 36, 3, 8, 'block', B.HIGH); // wall across the view
  g.fillRect(40, 52, 10, 2, 'block', B.HIGH); // wall on the right flank
  g.fillPoly([[58, 50], [66, 58], [65, 59], [57, 51]], 'block', B.HIGH); // diagonal staircase wall
  for (let k = 0; k < 6; k++) g.fillRect(60 + k * 2.5, 28 + (k % 2) * 3, 0.5, 0.5, 'block', B.HIGH); // pillars
  g.fillRect(30, 30, 4, 1, 'block', B.FENCE); // fence never blocks
  g.clearDynamic();
  g.stampDynamic(47, 30, 5, 2.2, 0.4, B.HIGH); // a truck (OCLU)
  return w;
}

function check(w, viewer, t, rng, n = 2000) {
  w.time = t;
  const fan = coneFan(viewer, w.grid, { t });
  const poly = conePolygons(fan);
  const R = fan.cone.far + 3;
  const st = { standIn: 0, standOut: 0, crawlIn: 0, crawlOut: 0, bad: [] };
  const g = w.grid;
  for (let k = 0; k < n; k++) {
    const x = viewer.x + rng.range(-R, R), z = viewer.z + rng.range(-R, R);
    const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
    if (!g.inBounds(i, j) || g.block[g.idx(i, j)] === B.HIGH || g.dynamicBlock[g.idx(i, j)] === B.HIGH) continue; // dummies stand on free ground
    const stand = canSee(viewer, { x, z, isLow: false, isVisibleToEnemies: true }, w);
    const crawl = canSee(viewer, { x, z, isLow: true, isVisibleToEnemies: true }, w);
    const dF = edgeDist(poly.far, x, z), inF = inside(poly.far, x, z);
    if (dF > 0.25) {
      if (inF) { st.standIn++; if (stand === 'none') st.bad.push(['stand-in', x, z, dF]); } else { st.standOut++; if (stand !== 'none') st.bad.push(['stand-out', x, z, dF]); }
    }
    const dN = edgeDist(poly.near, x, z), inN = inside(poly.near, x, z);
    if (dN > 0.25) {
      if (inN) { st.crawlIn++; if (crawl !== 'near') st.bad.push(['crawl-in', x, z, dN]); } else { st.crawlOut++; if (crawl !== 'none') st.bad.push(['crawl-out', x, z, dN]); }
    }
  }
  return st;
}

test('§10.2 acceptance: drawn cone == detection (2,000 points per pose, sweep + occluders)', () => {
  const w = arena();
  const rng = new Rng(20240626);
  const guard = { kind: 'enemy', id: 1, x: 40, z: 40, heading: 0, alive: true, world: w, vision: makeVision('soldier'), sweepActive: true };
  guard.vision.phase = 0.37;
  let total = { standIn: 0, standOut: 0, crawlIn: 0, crawlOut: 0 };
  for (const t of [0, 0.6, 1.25, 2.1, 3.3, 4.4]) { // θ over a full 5 s sweep period (elliptical far)
    const st = check(w, guard, t, rng);
    assert.equal(st.bad.length, 0, `t=${t}: ${JSON.stringify(st.bad.slice(0, 4))}`);
    for (const k of Object.keys(total)) total[k] += st[k];
  }
  for (const k of Object.keys(total)) assert.ok(total[k] > 150, `enough ${k} samples (${total[k]})`);
});

test('§10.2 acceptance: non-elliptical mg profile and a rotated guard', () => {
  const w = arena();
  const rng = new Rng(7);
  const mg = { kind: 'enemy', id: 2, x: 70, z: 45, heading: Math.PI * 0.9, alive: true, world: w, vision: makeVision('mg'), sweepActive: true };
  for (const t of [0, 1.7, 3.9]) {
    const st = check(w, mg, t, rng);
    assert.equal(st.bad.length, 0, `mg t=${t}: ${JSON.stringify(st.bad.slice(0, 4))}`);
    assert.ok(st.standIn > 20 && st.crawlIn > 5, JSON.stringify(st));
  }
});
