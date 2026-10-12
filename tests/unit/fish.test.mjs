/**
 * Visible fish (user: "You can add some fish in the water too"): species per theatre live where they show — small
 * shoals in the shallows near the banks, big fish cruising high, salmon / trout / mullet / carp leaping with
 * splashes, pike lurking and darting, shoals dimpling the surface; they scatter from swimmers; a drained reservoir
 * leaves no stranded fish drawn; the dam burst stuns a few; small fish get a light body; the sim stays cheap.
 */
import { test, assert } from './lib.mjs';
import { FishSim, fishPlan, FISH_SPECIES } from '../../src/world/fish-sim.js';
import { createFishMesh, writeFish, fishGeometry } from '../../src/art/fish-model.js';
import { createAmbientLife } from '../../src/render/ambient-life.js';
import { World } from '../../src/world/world.js';
import { T } from '../../src/world/grid.js';

/** 60 × 40 m water: shelving from 0.2 m at the banks to 1.6 m; optional current (m/s, +x). */
function water(type = 'river', flow = 0, o = {}) {
  const body = { o: { type } };
  return {
    body, bodies: [body], gone: o.gone || (() => false),
    sample(x, z) {
      if (x < 0 || x > 60 || z < 0 || z > 40 || this.gone(x, z)) return null;
      const shore = Math.min(z, 40 - z, x, 60 - x);
      return { depth: Math.min(1.6, 0.2 + shore * 0.25), shore, flow: [flow, 0], level: -0.1, ice: false, body };
    },
  };
}
const spots = []; for (let x = 3; x < 58; x += 2) for (let z = 3; z < 38; z += 2) spots.push([x, z]);
const plan = (type, theater, seed = 5) => fishPlan([{ type, preset: type === 'lake' ? 'lake' : type, spots, area: 2400 }], theater, seed);
const run = (sim, s, f) => { for (let k = 0; k < s * 30; k++) { sim.step(1 / 30); f?.(k); } };

test('small shoals keep to the shallows near the banks; big fish cruise high; everyone stays in the water', () => {
  const sim = new FishSim(plan('lake', 'temperate'), water('lake'), 3);
  run(sim, 60);
  const stat = (sp) => { const F = sim.fish.filter((f) => f.sp === sp); return { n: F.length, depth: F.reduce((a, f) => a + f.depth, 0) / F.length, under: F.reduce((a, f) => a + f.level - f.y, 0) / F.length }; };
  const mi = stat('minnow'), pe = stat('perch'), ca = stat('carp');
  assert.ok(mi.n >= 50 && ca.n >= 2, `minnows ${mi.n}, carp ${ca.n}`);
  assert.ok(mi.depth < pe.depth - 0.15, `minnows in the shallows (${mi.depth.toFixed(2)} m of water vs perch ${pe.depth.toFixed(2)})`);
  assert.ok(mi.under < 0.35 && ca.under < 0.55, `near the surface: minnows ${mi.under.toFixed(2)} m, carp ${ca.under.toFixed(2)} m down`);
  for (const f of sim.fish) assert.ok(sim.water.sample(f.x, f.z) && f.y < f.level && f.y > f.level - f.depth - 0.01, `${f.sp} in the water`);
  for (const sp of ['minnow', 'sprat', 'sandsmelt']) assert.ok(FISH_SPECIES[sp].small && FISH_SPECIES[sp].len[1] <= 0.13);
});

test('leaps: salmon and trout jump clear of the river and fall back in with a splash (out and in), never left in the air', () => {
  const sim = new FishSim(plan('river', 'snow'), water('river', 0.4), 8);
  let air = 0, top = 0;
  const outs = [], ins = [];
  run(sim, 240, () => {
    for (const f of sim.fish) if (f.y > f.level) { air++; top = Math.max(top, f.y - f.level); }
    for (const q of sim.splashes) (q.out ? outs : ins).push(q);
    sim.splashes.length = 0;
  });
  assert.ok(sim.stats.jumps >= 3, `leaps in 4 min: ${sim.stats.jumps}`);
  assert.ok(outs.length === sim.stats.jumps && ins.length >= sim.stats.jumps - 1, `splashes out ${outs.length}, in ${ins.length}`);
  assert.ok(top > 0.15 && top < 0.7, `clear of the water (top ${top.toFixed(2)} m)`);
  assert.ok(new Set(outs.map((q) => q.fish.sp)).size >= 1 && outs.every((q) => ['salmon', 'trout'].includes(q.fish.sp)), 'only the leapers');
  assert.ok(air > 10, `seen in the air (${air} frames)`);
  run(sim, 3);
  assert.ok(sim.fish.every((f) => f.jump || f.y < f.level), 'everyone back in');
});

test('pike lurk still at the margins and dart now and then; the small fish round a dart scatter', () => {
  const sim = new FishSim(plan('lake', 'temperate', 2), water('lake'), 4), P = sim.fish.filter((f) => f.sp === 'pike');
  assert.ok(P.length >= 1, 'a pike');
  let slow = 0, n = 0, fast = 0;
  run(sim, 120, () => { for (const f of P) { const v = Math.hypot(f.vx, f.vz); n++; if (v < 0.15) slow++; if (v > 2) fast++; } });
  assert.ok(slow / n > 0.7, `lurking still ${(100 * slow / n).toFixed(0)} % of the time`);
  assert.ok(fast > 0, 'darts');
  assert.ok(P.every((f) => f.shore < 4), `at the margins (${P.map((f) => f.shore.toFixed(1))} m from the bank)`);
});

test('a swimmer scatters a minnow shoal; shoals riding high dimple the surface', () => {
  const sim = new FishSim(plan('river', 'snow', 6), water('river'), 5);
  run(sim, 20);
  let dimples = 0;
  run(sim, 20, () => { dimples += sim.rings.filter((q) => q.dimple).length; sim.rings.length = 0; });
  assert.ok(dimples > 20, `nervous water: ${dimples} dimples in 20 s`);
  const sch = sim.schools.filter((q) => q.sp === 'minnow').sort((a, b) => b.members.length - a.members.length)[0];
  const d0 = sch.members.reduce((a, f) => a + Math.hypot(f.x - sch.cx, f.z - sch.cz), 0) / sch.members.length;
  sim.setThreats([{ x: sch.cx, z: sch.cz, r: 3.5, s: 1 }]);
  run(sim, 0.7);
  const d1 = sch.members.reduce((a, f) => a + Math.hypot(f.x - sch.cx, f.z - sch.cz), 0) / sch.members.length;
  assert.ok(sim.stats.scared > 10 && d1 > d0 + 0.3, `scattered: ${sim.stats.scared} scared, spread ${d0.toFixed(2)} → ${d1.toFixed(2)} m`);
});

test('a drained reservoir leaves no stranded fish drawn; small fish get a light body', () => {
  let dry = false;
  const W = water('lake', 0, { gone: (x) => dry && x < 45 }), sim = new FishSim(plan('lake', 'snow'), W, 7);
  run(sim, 5);
  dry = true;
  run(sim, 6);
  const left = sim.fish.filter((f) => !f.gone);
  assert.ok(sim.fish.some((f) => f.gone), 'stranded fish leave the sim');
  assert.ok(left.every((f) => W.sample(f.x, f.z)), 'the rest are in the water left');
  const sp = 'minnow', h = createFishMesh(sp, sim.fish.length, { segs: 7, ring: 6 });
  assert.equal(writeFish(h, sim.fish.filter((f) => f.sp === sp), null), sim.fish.filter((f) => f.sp === sp && !f.gone).length, 'gone fish are not drawn');
  assert.ok(fishGeometry(FISH_SPECIES.minnow, 7, 6).index.count / 3 < 120, 'light body for the small fish');
});

test('the dam burst stuns a few fish by the breach (director: structure:destroyed of a draining body)', () => {
  const w = new World({ size: [60, 60], mission: { id: 't', theater: 'snow', seed: 5, lighting: { sunElevDeg: 15, hdri: 'overcast' } } });
  w.grid.fillRect(0, 0, 60, 40, 'terrain', T.WATER);
  const W = water('lake');
  w.water = { ...W, sample: W.sample.bind(W), disturb() {}, wakes: { onSplash: null, splash() {} }, drains: [{ id: 'dam' }] };
  w.byId = (id) => (id === 'dam' ? { id, x: 30, z: 20 } : null);
  const L = createAmbientLife(w, null);
  for (let k = 0; k < 30; k++) { w.wind.t += 1 / 30; L.frame(1 / 30, null); }
  w.events.emit('structure:destroyed', { id: 'dam', type: 'dam' });
  assert.ok(L.fish.stunned >= 1, `stunned ${L.fish.stunned}`);
  L.dispose();
});

test('cheap: a lowland lake full of fish steps in well under a millisecond', () => {
  const sim = new FishSim(plan('lake', 'temperate'), water('lake'), 9);
  run(sim, 5);
  const t0 = performance.now();
  for (let k = 0; k < 600; k++) sim.step(1 / 60);
  const ms = (performance.now() - t0) / 600;
  assert.ok(sim.fish.length > 200, `${sim.fish.length} fish`);
  assert.ok(ms < 0.8, `${ms.toFixed(3)} ms per 60 Hz step`);
});

test('no fish in puddles; a small pond gets fewer species (no pike), a big lake the lot', () => {
  const sp = (area) => [...new Set(fishPlan([{ type: 'lake', preset: 'lake', spots, area }], 'temperate', 3).map((p) => p.sp))];
  assert.equal(sp(120).length, 0, 'a puddle');
  assert.ok(sp(350).length >= 2 && sp(350).length <= 4 && !sp(350).includes('pike'), `a pond: ${sp(350)}`);
  assert.equal(sp(2400).length, 5, 'a lake');
  assert.equal(fishPlan([{ type: 'lake', frozen: true, spots, area: 2400 }], 'snow', 3).length, 0, 'frozen over');
});
