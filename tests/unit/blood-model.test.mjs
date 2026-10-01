/**
 * bodies-design §E blood-model (pure data/logic, headless): the cause table (the syringe never bleeds; censored or
 * blood off spawns nothing), pool flow downhill + volume conservation, the snow halo channel and ×4 drying, the
 * colour/age curve, budget recycling, seeded re-simulation (save → load gives the same masks), bloody feet, and the
 * furrow regression (only a DRAG furrows: art/terrain.js stampWorld + terrain/game-adapter.js stampUnits).
 */
import { test, assert } from './lib.mjs';
import { CONFIG } from '../../src/config.js';
import {
  woundClass, poolVolume, bloodEnabled, bloodColor, bloodRoughness, recycleIndex, recycleStain, stepInPool, bloodyStep, poolWet, budgets, rng32, seedOf,
} from '../../src/render/blood/model.js';
import { PoolSim } from '../../src/render/blood/pool-sim.js';
import { stampWorld } from '../../src/art/terrain.js';
import { stampUnits, dragHeels } from '../../src/art/terrain/game-adapter.js';

test('blood-model: cause table — syringe/injection/poison/KO/drown/electric/fire never bleed; weapons resolve', () => {
  for (const c of ['syringe', 'injection', 'poison', 'chloroform', 'punch', 'drown', 'electric', 'fire']) assert.equal(woundClass(c), null, c);
  assert.equal(woundClass('sniperRifle').cls, 'shot');
  assert.equal(woundClass('pistol').cls, 'shot');
  assert.equal(woundClass('smg').cls, 'burst');
  assert.equal(woundClass('knife').cls, 'knife');
  assert.equal(woundClass('grenade').cls, 'explosion');
  assert.equal(woundClass('runover').cls, 'runover');
  // the user's 4y list wins over spec §4.7 for the harpoon and the bear trap (open point G1)
  assert.equal(woundClass('harpoon').cls, 'harpoon');
  assert.equal(woundClass('trap').cls, 'trap');
  assert.equal(poolVolume('knife'), 1.5); assert.equal(poolVolume('shot'), 0.8); assert.equal(poolVolume('explosion'), 0.6);
  assert.equal(poolVolume('syringe'), 0);
  assert.equal(woundClass('rifle', { lethal: false }).cls, 'nonLethal');
  assert.equal(woundClass('grenade', { lethal: false }), null, 'a blast survivor gets no wound decal');
  assert.equal(CONFIG.blood.causes.nonLethal.pool, 0, 'a non-lethal hit leaves a stain only');
});

test('blood-model: BLOOD off or CENSORED gives no blood', () => {
  assert.equal(bloodEnabled({ blood: true, censored: false }), true);
  assert.equal(bloodEnabled({ blood: false, censored: false }), false);
  assert.equal(bloodEnabled({ blood: true, censored: true }), false);
  assert.equal(bloodEnabled(undefined), true);
});

const sum = (a) => a.reduce((s, v) => s + v, 0);
/** Centre of mass (cells) of the liquid + soaked fields. */
function centroid(p) {
  let m = 0, cy = 0;
  for (let k = 0; k < p.h.length; k++) { const v = p.h[k] + p.s[k]; m += v; cy += v * Math.floor(k / p.n); }
  return cy / m;
}

test('blood-model: pools conserve volume and run downhill (flat → round, slope → tongue)', () => {
  const flat = new PoolSim({ seed: 7, surface: 'hard', volume: 0.8, grow: 30, slope: 0 });
  const slope = new PoolSim({ seed: 7, surface: 'hard', volume: 0.8, grow: 30, slope: 0.08 });
  for (const p of [flat, slope]) {
    p.advanceTo(15); const half = p.mass();
    assert.ok(Math.abs(half + p.left - p.total) / p.total < 1e-4, 'bled + left = total while bleeding');
    p.advanceTo(60);
    assert.ok(Math.abs(p.mass() - p.total) / p.total < 1e-4, `volume conserved: ${p.mass()} vs ${p.total}`);
  }
  const extent = (p) => { let y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1; p.h.forEach((v, k) => { if (v > 0.05) { const j = Math.floor(k / p.n), i = k % p.n; y0 = Math.min(y0, j); y1 = Math.max(y1, j); x0 = Math.min(x0, i); x1 = Math.max(x1, i); } }); return { w: x1 - x0 + 1, l: y1 - y0 + 1 }; };
  const ef = extent(flat), es = extent(slope);
  assert.ok(Math.abs(ef.l / ef.w - 1) < 0.45, `flat pool roughly round (${ef.w}×${ef.l})`);
  assert.ok(es.l / es.w > ef.l / ef.w * 1.15, `slope → elongated downhill (${es.w}×${es.l})`);
  assert.ok(centroid(slope) > slope.src[1] + 3, 'the liquid moved downhill (+y) of its source');
  // area of a 0.8 L pool on a hard floor: a realistic 0.25–0.7 m² (film ≈ 1–3 mm)
  const wetArea = flat.h.filter((v) => v > 0.05).length * flat.cell ** 2;
  assert.ok(wetArea > 0.25 && wetArea < 0.7, `wet area ${wetArea.toFixed(2)} m²`);
});

test('blood-model: snow soaks in with a darker core and a faint halo (3× diffusion) well beyond it; it dries ×4 slower', () => {
  const p = new PoolSim({ seed: 11, surface: 'snow', volume: 0.8, grow: 30 });
  p.advanceTo(80);
  assert.ok(Math.abs(p.mass() - p.total) / p.total < 1e-4, 'snow conserves volume');
  const core = p.s.filter((v) => v > 0.3).length, halo = p.g.filter((v) => v > 0.02).length;
  assert.ok(core > 150, `soaked core ${core} cells`);
  const rc = Math.sqrt(core / Math.PI), rh = Math.sqrt(halo / Math.PI);
  assert.equal(CONFIG.blood.surfaces.snow.halo, 3, 'the halo channel diffuses 3× faster than the soaked core');
  assert.ok(rh > rc * 1.4, `halo radius ${rh.toFixed(1)} ≫ core ${rc.toFixed(1)} cells`);
  assert.ok(sum([...p.g]) < sum([...p.s]) * 0.6, 'the halo is low density');
  const dirt = new PoolSim({ seed: 11, surface: 'soil', volume: 0.8, grow: 30 }); dirt.advanceTo(80);
  assert.equal(dirt.g.filter((v) => v > 0).length, 0, 'no halo off snow');
  // ×4 drying: a snow pool at 4t matches a dirt pool at t on the colour curve
  for (const t of [60, 180, 400, 800]) {
    const a = bloodColor(t * 4, 'snow').wet, b = bloodColor(t, 'soil').wet;
    assert.ok(Math.abs(a - b) < 1e-9, `wetness snow@${t * 4} = dirt@${t}`);
  }
  assert.ok(poolWet(500, 'snow') && !poolWet(500, 'soil'), 'fresh for 10 min on snow, 3 min elsewhere');
});

test('blood-model: colour/age curve — fresh red → maroon (2–4 min) → dried brown (10–15 min); gloss → matte', () => {
  const f = bloodColor(0).rgb, m = bloodColor(240).rgb, d = bloodColor(900).rgb;
  assert.ok(f[0] > m[0] && m[0] > d[0] * 0.9, 'darkens');
  assert.ok(Math.abs(f[0] - 0x6e / 255) < 0.01 && Math.abs(d[0] - 0x2a / 255) < 0.01 && Math.abs(d[2] - 0x08 / 255) < 0.01, 'reference hexes');
  assert.ok(d[1] > m[1], 'dried blood turns brown (green rises)');
  assert.ok(bloodRoughness(0) < 0.1 && bloodRoughness(900) > 0.7, 'wet gloss 0.06 → dry 0.75');
  assert.ok(bloodColor(0, 'snow').rgb[0] > f[0], 'a more vivid core on snow');
});

test('blood-model: budgets and recycling order (oldest dry pool first, then oldest stopped, then oldest)', () => {
  assert.deepEqual([budgets('low').pools, budgets('high').pools, budgets('ultra').pools], [16, 48, 64]);
  assert.deepEqual([budgets('low').decals, budgets('high').decals, budgets('ultra').decals], [128, 256, 512]);
  assert.deepEqual([budgets('low').smear, budgets('high').smear, budgets('ultra').smear], [60, 200, 400]);
  assert.deepEqual([budgets('low').stains, budgets('high').stains], [4, 8]);
  const pools = [
    { id: 1, age: 50, stopped: false, surface: 'soil' },
    { id: 2, age: 2000, stopped: true, surface: 'soil' },   // dry
    { id: 3, age: 1500, stopped: true, surface: 'snow' },   // older than 4 but not dry on snow (×4)
    { id: 4, age: 1200, stopped: true, surface: 'soil' },   // dry, younger than 2
  ];
  assert.equal(pools[recycleIndex(pools)].id, 2);
  const rest = pools.filter((p) => p.id !== 2 && p.id !== 4);
  assert.equal(rest[recycleIndex(rest)].id, 3, 'then the oldest stopped');
  assert.equal(pools[recycleIndex([pools[0]])].id, 1);
  const slots = [{ t0: 5, radius: 0.1 }, { t0: 2, radius: 0.12 }, { t0: 2, radius: 0.05 }];
  assert.equal(recycleStain(slots), 2, 'stain: oldest, then smallest');
});

test('blood-model: save → load re-simulates the same pool masks from (seed, age)', () => {
  const o = { seed: seedOf(42, 3), surface: 'snow', volume: 1.0, grow: 40, slope: 0.04, x: 31.2, z: 18.7, rot: 0.8 };
  const a = new PoolSim(o); a.advanceTo(25);                          // live: stepped in small frame-sized chunks
  for (let t = 25.5; t <= 70; t += 0.5) a.advanceTo(t, 3);
  a.advanceTo(70);
  const b = new PoolSim(o); b.advanceTo(70);                           // loaded: fast-forward from the seed
  const ta = a.writeTile(new Uint8Array(64 * 64 * 4)), tb = b.writeTile(new Uint8Array(64 * 64 * 4));
  assert.equal(Buffer.compare(Buffer.from(ta), Buffer.from(tb)), 0, 'identical RGBA masks');
  assert.ok(ta.some((v, i) => i % 4 === 2 && v > 0), 'halo channel written on snow');
  const r1 = rng32(seedOf(9)), r2 = rng32(seedOf(9));
  assert.equal(r1(), r2(), 'rng streams keyed by entity id');
});

test('blood-model: bloody feet — stepping in a fresh pool gives 6 fading prints', () => {
  const u = {};
  assert.equal(bloodyStep(u), 0);
  stepInPool(u); assert.equal(u.bloodyFeet, 6);
  const ops = []; for (let i = 0; i < 8; i++) ops.push(bloodyStep(u));
  assert.deepEqual(ops.map((v) => +v.toFixed(3)), [1, 0.833, 0.667, 0.5, 0.333, 0.167, 0, 0]);
});

test('blood-model: only a DRAG furrows the ground (terrain.js stampWorld / game-adapter stampUnits regression)', () => {
  const body = { kind: 'enemy', x: 9.05, z: 10, alive: false, state: 'carried' };
  const mk = (carryMode) => ({ id: 1, alive: true, path: [{ x: 20, z: 10 }], x: 10, z: 10, heading: 0, y: 0, stance: 'stand', carrying: body, carryMode });
  const grid = { cell: 1, cols: 64, rows: 64, terrain: new Uint8Array(64 * 64) };
  for (const [mode, want] of [['shoulder', 0], [undefined, 0], ['drag', 1]]) {
    const calls = [];
    const t = { stampTrail: (k, x, z) => calls.push([k, x, z]) };
    stampWorld(t, { commandos: [mk(mode)], enemies: [], vehicles: [] }, grid);
    assert.equal(calls.filter((c) => c[0] === 'drag').length, want, `stampWorld carryMode=${mode}`);
    const c2 = []; stampUnits({ stampTrail: (k) => c2.push(k) }, [mk(mode)]);
    assert.equal(c2.filter((k) => k === 'drag').length, want, `stampUnits carryMode=${mode}`);
  }
  const h = dragHeels(mk('drag'));
  assert.ok(h.x < body.x - 0.5, 'the heels trail behind the body, away from the dragger');
});
