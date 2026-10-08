/**
 * M3 dam (design-spec §7.6): the burst (render/dam-breach.js — one flow surface from the reservoir through the slot and
 * down into the pool, shaped by the reservoir's level; strongest just after the blast, then a steady outflow; surge
 * front down the river) and the crest stairs (art/dam-stairs.js stairTopAt = the grid's ramp cells = the drawn treads).
 */
import { test, assert, near } from './lib.mjs';
import { createBreach, breachProfile, BREACH } from '../../src/render/dam-breach.js';
import { stairTopAt, STAIR_RISE } from '../../src/art/dam-stairs.js';
import { WATER_LEVEL, RESERVOIR_DRAWDOWN, DRAIN_S } from '../../src/art/water.js';
import { getMission } from '../../src/missions/index.js';
import { loadGrid } from './mission-check.mjs';

const DEF = { x: 40, z: 22, rot: (345 * Math.PI) / 180 };
const FX = { surge: [[44, 35], [52, 46], [60, 54]] };

test('dam breach: nothing before the dam falls; full torrent while the reservoir is high; gone if it ever ran dry', () => {
  const b = createBreach(DEF, FX, 5.8);
  assert.equal(b.frame(0.5, 5.8), 0, 'idle until start()');
  assert.equal(b.group.visible, false);
  b.start();
  assert.equal(b.group.visible, true);
  let a = 0;
  for (let k = 0; k < 20; k++) a = b.frame(0.1, 5.8);
  near(a, 1, 1e-6, 'full strength 2 s in with the head still up');
  assert.ok(b.active);
  near(b.surgeAt, 7 * (2 - 1.1), 0.05, 'the surge front leaves the landing once the water is there and runs 7 m/s down the river');
  const mid = b.frame(0.1, WATER_LEVEL + (5.8 - WATER_LEVEL) * 0.1);
  assert.ok(mid > 0.2 && mid < 0.6, `thinning with a tenth of the head left (${mid})`);
  for (let k = 0; k < 40; k++) a = b.frame(0.1, WATER_LEVEL);
  assert.equal(a, 0, 'no head, no flow');
  assert.equal(b.active, false);
  assert.equal(b.group.visible, false);
  b.dispose();
});

test('dam breach: on its own drawdown curve it settles into a strong steady outflow and never stops', () => {
  const b = createBreach(DEF, FX, 5.8);
  b.start();
  let a = 0;
  for (let k = 0; k < 30; k++) a = b.frame(0.1, null);
  const early = b.profile;
  assert.ok(a > 0.99, `strong at 3 s (${a})`);
  for (let k = 0; k < 10 * DRAIN_S * 3; k++) a = b.frame(0.1, null);
  near(a, 1, 1e-9, 'full strength two minutes on');
  near(b.profile.L, 5.8 - RESERVOIR_DRAWDOWN, 3e-3, 'the reservoir has dropped RESERVOIR_DRAWDOWN and holds');
  assert.ok(early.yLip > b.profile.yLip + 0.3, `strongest just after the blast: the lip ${early.yLip.toFixed(2)} → ${b.profile.yLip.toFixed(2)}`);
  assert.ok(b.profile.yLip - WATER_LEVEL > 3, `settled, the water still leaves the lip ${(b.profile.yLip - WATER_LEVEL).toFixed(2)} m over the pool`);
  // a save loaded with the dam already down: straight into the settled flow
  const c = createBreach(DEF, FX, 5.8);
  c.start(true);
  near(c.frame(1 / 60, null), 1, 1e-9, 'settled at once');
  near(c.profile.yLip, b.profile.yLip, 3e-3);
  b.dispose(); c.dispose();
});

test('dam breach profile: on the reservoir up to where its water ends, then down to the lip, landing in the pool', () => {
  for (const [L, w] of [[5.8, 1], [5.8, 0.4], [5.0, 0]]) {
    const P = breachProfile(L, w);
    near(P.ySlot(BREACH.vMouth), L + 0.05, 1e-9, 'the mouth sits on the reservoir');
    near(P.ySlot(BREACH.vEdge), L + 0.05, 1e-9, 'still on it where the reservoir\'s own water ends');
    near(P.ySlot(BREACH.vLip), P.yLip, 1e-9);
    let prev = Infinity;
    for (let v = BREACH.vMouth; v <= BREACH.vLip; v += 0.1) { const y = P.ySlot(v); assert.ok(y <= prev + 1e-9, 'never rising'); prev = y; }
    near(P.yJet(0), P.yLip, 1e-9, 'the jet leaves from the lip');
    near(P.yJet(P.xLand), WATER_LEVEL, 1e-6, 'and lands on the pool');
    assert.ok(P.xEnd > P.xLand && P.yJet(P.xEnd) < WATER_LEVEL - 0.4, 'its last rows run under the pool');
    // the slope leaving the slot is the jet's starting slope (no kink at the lip)
    const e = 1e-4;
    near((P.ySlot(BREACH.vLip) - P.ySlot(BREACH.vLip - e)) / e, P.slope, 2e-3, 'smooth over the lip');
  }
  assert.ok(breachProfile(5.8, 1).yLip > breachProfile(5.8, 0).yLip + 1, 'the dam-break wall stands higher in the gap');
});

test('dam breach mesh: one continuous surface from the funnel\'s rim to under the pool, the full width of the slot', () => {
  const b = createBreach(DEF, FX, 5.8);
  b.start();
  for (let k = 0; k < 120; k++) b.frame(0.1, null);
  const g = b.flowMesh.geometry, pos = g.getAttribute('position'), aux = g.getAttribute('aux'), P = b.profile;
  const cols = 17, rows = [];
  for (let q = 0; q < pos.count; q += cols) {
    if (aux.getY(q) > 0.5) break; // the side walls follow the surface
    const m = q + (cols >> 1);
    rows.push({ u0: pos.getX(q), u1: pos.getX(q + cols - 1), y: pos.getY(m), v: pos.getZ(m), z: aux.getX(m) });
  }
  near(rows[0].y, P.L + 0.05, 1e-6, 'the rim lies on the reservoir');
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], c = rows[i];
    const d = Math.hypot(c.v - a.v, c.y - a.y), lim = c.z < -1 ? 1.3 : 0.6; // (the flat funnel is coarser out on the lake)
    assert.ok(d < lim, `row ${i}: no gap along the flow (${d.toFixed(2)} m)`);
    assert.ok(c.z >= a.z - 1e-6, 'the zones run funnel → slot → jet');
  }
  const slot = rows.filter((r) => r.z > -1 && r.z < 0);
  assert.ok(slot.length > 15 && slot.every((r) => r.u0 <= -BREACH.hw && r.u1 >= BREACH.hw), 'the slot rows span the gap from cheek to cheek');
  assert.ok(rows.at(-1).y < WATER_LEVEL - 0.4, `the jet ends under the pool (${rows.at(-1).y.toFixed(2)})`);
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
