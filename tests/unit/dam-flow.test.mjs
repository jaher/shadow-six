/**
 * Flow field below the M3 dam (render/dam-flow.js, render/dam-water-pool.js): baked on the real m03 nav grid with an
 * analytic stand-in for the face (the arch's downstream foot, radius 16.3 m about a centre 20 m downstream).
 * Continuity, banks, the roller, the jet, eddies, foam carried downstream, determinism.
 */
import { test, assert } from './lib.mjs';
import { loadGrid } from './mission-check.mjs';
import { getMission } from '../../src/missions/index.js';
import { bakeDamFlow } from '../../src/render/dam-flow.js';
import { bakePool, poolSources } from '../../src/render/dam-water-pool.js';

const def = getMission('m03');
const dam = def.structures.find((s) => s.id === 'dam');
const c = Math.cos(dam.rot), s = Math.sin(dam.rot);
const F = {
  world: (u, v) => [dam.x + u * c - v * s, dam.z + u * s + v * c],
  v: (u) => (Math.abs(u) < 7.4 ? 20 - Math.sqrt(16.3 * 16.3 - u * u) : null),
};
const toDam = (x, z) => [(x - dam.x) * c + (z - dam.z) * s, -(x - dam.x) * s + (z - dam.z) * c];
const MID = F.v(0);
let cached = null;
const field = () => (cached ??= bakePool(loadGrid(def).world.grid, F, poolSources(MID)));

test('dam flow: the baked field conserves mass (div = sources) and nothing crosses a bank', () => {
  const f = field();
  let err = 0, n = 0, speed = 0, land = 0;
  for (let j = 1; j < f.nv - 1; j++) for (let i = 1; i < f.nu - 1; i++) {
    const d = f.div(i, j), k = j * f.nu + i;
    if (!d.water) { land = Math.max(land, Math.hypot(f.vel[k * 2], f.vel[k * 2 + 1])); continue; }
    if (d.out) continue;
    err += Math.abs(d.div - d.src); speed += Math.hypot(f.vel[k * 2], f.vel[k * 2 + 1]); n++;
  }
  assert.ok(n > 1500, `water cells ${n}`);
  const rel = err / n / (speed / n / f.h);
  assert.ok(rel < 0.01, `mean |div - src| is ${(rel * 100).toFixed(2)} % of |v|/h`);
  assert.equal(land, 0, 'no current on dry cells');
});

test('dam flow: the roller runs back to the face, the jet carries on downstream, faster in the core than at the banks', () => {
  const f = field();
  const roller = f.sample(0, MID + 0.6), jet = f.sample(0, MID + 7);
  assert.ok(roller.vv < -0.2, `surface current at the face foot runs back to the face (vv ${roller.vv.toFixed(2)})`);
  assert.ok(jet.vv > 0.6, `jet downstream (vv ${jet.vv.toFixed(2)})`);
  // across the river 25 m below the face: the fastest water is near the middle, the banks are slow
  let best = 0, edge = Infinity, wet = [];
  for (let u = -20; u <= 30; u += 0.5) { const q = f.sample(u, MID + 25), sp = Math.hypot(q.vu, q.vv); if (sp > 0.02) wet.push([u, sp]); }
  for (const [, sp] of wet) best = Math.max(best, sp);
  edge = Math.max(wet[0][1], wet[wet.length - 1][1]);
  assert.ok(best > 3 * edge, `core ${best.toFixed(2)} m/s vs bank ${edge.toFixed(2)} m/s`);
});

test('dam flow: eddies turn in the side pools beside the jet', () => {
  const f = field();
  let back = 0;
  for (let j = 0; j < f.nv; j++) for (let i = 0; i < f.nu; i++) {
    const k = j * f.nu + i, u = f.u0 + (i + 0.5) * f.h, v = f.v0 + (j + 0.5) * f.h;
    if (f.mask[k] && v > MID + 2.5 && Math.abs(u) > 4.5 && f.vel[k * 2 + 1] < -0.03) back++;
  }
  assert.ok(back > 12, `cells flowing back upstream beside the jet: ${back}`);
});

test('dam flow: foam is carried down the river, thinning with distance; aeration stays at the plunge', () => {
  const f = field();
  const line = dam.waterFx.downstream.map(([x, z]) => toDam(x, z));
  const along = line.map(([u, v]) => f.sample(u, v).foam);
  assert.ok(along[0] > 0.15, `foam on the river ${along.map((x) => x.toFixed(2))}`);
  for (let k = 1; k < along.length; k++) assert.ok(along[k] <= along[k - 1] + 0.02, `thins downstream ${along.map((x) => x.toFixed(2))}`);
  // the foam goes the way the water goes: more foam on the centreline 15 m down than 15 m off to the side
  const [u1, v1] = line[0];
  const side = Math.max(f.sample(-9, MID + 6).foam, f.sample(9, MID + 6).foam);
  assert.ok(f.sample(u1, v1).foam > 2 * side, `downstream ${f.sample(u1, v1).foam.toFixed(2)} vs side pool ${side.toFixed(2)}`);
  assert.ok(f.sample(0, MID + 1.6).aer > 0.8 && f.sample(0.5, MID + 16).aer < 0.1, 'aeration: white boil at the plunge, gone 16 m downstream');
});

test('dam flow: the bake is deterministic', () => {
  const box = { isWater: (u, v) => v > 1 && Math.abs(u) < 8, u0: -10, v0: 0, nu: 30, nv: 30, h: 0.7, steps: 40,
    sources: [{ u: 0, v: 3, ru: 2, rv: 1, q: 2, push: 1 }] };
  const a = bakeDamFlow(box), b = bakeDamFlow(box);
  assert.deepEqual(Array.from(a.vel), Array.from(b.vel));
  assert.deepEqual(Array.from(a.foam), Array.from(b.foam));
});
