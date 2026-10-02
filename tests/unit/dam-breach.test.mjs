/**
 * M3 dam (design-spec §7.6): the burst (render/dam-breach.js — strength follows the reservoir's drain, surge front
 * down the river) and the crest stairs (art/dam-stairs.js stairTopAt = the grid's ramp cells = the drawn treads).
 */
import { test, assert, near } from './lib.mjs';
import { createBreach } from '../../src/render/dam-breach.js';
import { stairTopAt, STAIR_RISE } from '../../src/art/dam-stairs.js';
import { WATER_LEVEL } from '../../src/art/water.js';
import { getMission } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';

const DEF = { x: 40, z: 22, rot: (345 * Math.PI) / 180 };
const FX = { surge: [[44, 35], [52, 46], [60, 54]] };

test('dam breach: nothing before the dam falls; full torrent while the reservoir is high; gone once it is down', () => {
  const b = createBreach(DEF, FX, 5.8);
  assert.equal(b.frame(0.5, 5.8), 0, 'idle until start()');
  assert.equal(b.group.visible, false);
  b.start();
  assert.equal(b.group.visible, true);
  let a = 0;
  for (let k = 0; k < 20; k++) a = b.frame(0.1, 5.8);
  near(a, 1, 1e-6, 'full strength 2 s in with the head still up');
  assert.ok(b.active);
  near(b.surgeAt, 14, 0.05, 'the surge front runs 7 m/s down the river');
  const mid = b.frame(0.1, WATER_LEVEL + (5.8 - WATER_LEVEL) * 0.1);
  assert.ok(mid > 0.2 && mid < 0.6, `thinning as the reservoir drains (${mid})`);
  for (let k = 0; k < 40; k++) a = b.frame(0.1, WATER_LEVEL);
  assert.equal(a, 0, 'no head, no flow');
  assert.equal(b.active, false);
  assert.equal(b.group.visible, false);
  b.dispose();
});

test('dam breach: without a drain to read it follows its own 40 s curve', () => {
  const b = createBreach(DEF, FX, 5.8);
  b.start();
  let a = 0;
  for (let k = 0; k < 50; k++) a = b.frame(0.1, null);
  assert.ok(a > 0.9, `strong at 5 s (${a})`);
  for (let k = 0; k < 400; k++) a = b.frame(0.1, null);
  assert.equal(a, 0, 'done after the drain');
  b.dispose();
});

test('dam stairs: tread tops climb one rise per tread to a landing at the top', () => {
  const L = 12.7, y0 = 0.25, y1 = 7.28;
  assert.equal(stairTopAt(0, L, y0, y1), y0);
  near(stairTopAt(L, L, y0, y1), y1, 1e-9);
  near(stairTopAt(L - 0.05, L, y0, y1), y1, 1e-9, 'the top tread is the landing');
  let prev = y0;
  for (let s = 0; s <= L; s += 0.05) {
    const y = stairTopAt(s, L, y0, y1);
    assert.ok(y >= prev - 1e-9 && y - prev <= STAIR_RISE + 1e-9, `monotone, at most one rise per step (s ${s.toFixed(2)})`);
    prev = y;
  }
  near(stairTopAt(L - 1.5, L, y0, y1, 1.6), y1, 1e-9, 'a 1.6 m landing (the top under the deck) stands at the deck');
  assert.ok(stairTopAt(L - 1.7, L, y0, y1, 1.6) < y1, 'the treads end where the landing starts');
});

test('m03: the stair cells stand at the treads drawn over them; the crest at its snowy deck', () => {
  const { grid, def } = loadGrid(getMission('m03'));
  const dam = def.structures.find((s) => s.id === 'dam');
  for (const r of dam.ramps) {
    const [[ax, az], [bx, bz]] = r.points, L = Math.hypot(bx - ax, bz - az);
    for (const t of [0.1, 0.35, 0.6, 0.85, 0.97]) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const i = Math.floor(x / grid.cell), j = Math.floor(z / grid.cell);
      const cx = (i + 0.5) * grid.cell, cz = (j + 0.5) * grid.cell;
      const s = Math.max(0, Math.min(L, ((cx - ax) * (bx - ax) + (cz - az) * (bz - az)) / L));
      const want = stairTopAt(s, L, r.y0, r.y1, r.landing), got = grid.elev[j * grid.cols + i];
      assert.ok(got >= want - 1e-4, `${r.id} at ${t}: cell ${got.toFixed(2)} ≥ tread ${want.toFixed(2)}`);
      assert.ok(got - want < 0.3, `${r.id} at ${t}: cell ${got.toFixed(2)} not floating over tread ${want.toFixed(2)}`);
    }
  }
  near(dam.walkY, 7.28, 1e-9);
});
