/**
 * design-spec §10.2 acceptance test (§10.5 behaviour test #13): the drawn cone IS the detection geometry.
 * 2,000 random points around a guard per pose: a standing dummy clearly outside the drawn cone (its stand region,
 * both shades; by more than 0.25 m) is never detected and one clearly inside always is; the same for a crawling dummy
 * against the dark near region (coneRegions; tests/unit/cone-check.mjs). Walls (axis-aligned + a diagonal staircase), a pillar field and a
 * vehicle in the dynamic occluder layer cut the cone; poses cover the sweep (elliptical range) and an
 * mg profile.
 */
import { test, assert } from './lib.mjs';
import { World } from '../../src/world/world.js';
import { B } from '../../src/world/grid.js';
import { Rng } from '../../src/core/math.js';
import { makeVision } from '../../src/entities/enemy.js';
import { check } from './cone-check.mjs';

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
