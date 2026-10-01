/**
 * Chimney smoke (E4) and the ambient-smoke readability rules (docs/vfx-pipeline.md §3 E4, §6.4): emission points at
 * the chimney tops of the actual building models, per-chimney variety, low emission budgets, ambient flags on the
 * persistent smoke sources, and the perceived-opacity limiter used by the FxPass composite.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { test, assert, near } from './lib.mjs';
import { FX } from '../../src/render/fx.js';
import { RECIPES } from '../../src/render/vfx/effects.js';
import { VFX_QUALITY } from '../../src/render/vfx/index.js';
import { AMBIENT_RULES, perceivedChange, capScale, displayValue, kneeCap } from '../../src/render/vfx/ambient.js';
import { loadBuildingLibrary, buildingMeta } from '../../src/art/building-library.js';
import { assetExtents } from '../../src/art/building-props.js';

const manifest = JSON.parse(readFileSync(new URL('../../assets/models/buildings/manifest.json', import.meta.url)));
await loadBuildingLibrary(null, { manifest });
const chimneyAnchors = (name) => buildingMeta(name).anchors.filter((a) => a.kind === 'chimney');

/** A placed library building like art/building-props.js libraryVisual: outer(x, z, rot) › fit(scale) › turn › model. */
function placed(name, { x = 40, z = 25, rot = 0.7, scale = [1.1, 1.05, 0.95], turn = 1, cx = 0.3, cz = -0.2 } = {}) {
  const outer = new THREE.Group(), fit = new THREE.Group(), turnG = new THREE.Group(), model = new THREE.Group();
  outer.position.set(x, 0, z); outer.rotation.y = -rot; fit.name = 'fit'; fit.scale.set(...scale);
  turnG.rotation.y = -turn * Math.PI / 2; model.position.set(-cx, 0, -cz); model.userData.building = name;
  outer.add(fit); fit.add(turnG); turnG.add(model);
  outer.updateMatrixWorld(true);
  return { outer, model };
}

test('chimney: emission points are the chimney anchors of the actual model, transformed by the placed instance', () => {
  const { outer, model } = placed('log_cabin_b_snow');
  const pts = FX.chimneyPoints(outer);
  const an = chimneyAnchors('log_cabin_b_snow');
  assert.equal(pts.length, an.length);
  const want = new THREE.Vector3(...an[0].pos).applyMatrix4(model.matrixWorld);
  near(pts[0].x, want.x, 1e-6, 'x'); near(pts[0].y, want.y, 1e-6, 'y (chimney top)'); near(pts[0].z, want.z, 1e-6, 'z');
  near(pts[0].y, an[0].pos[1] * 1.05, 1e-6, 'top scaled with the fitted height');
  // multi-chimney models smoke from each stack
  assert.equal(FX.chimneyPoints(placed('townhouse_row_a').outer).length, 3);
});

test('chimney: no smoke from roofs without a chimney, from ruins / destroyed variants; procedural huts → placeholder', () => {
  assert.equal(chimneyAnchors('guard_hut_b_snow').length, 0);
  assert.equal(FX.chimneyPoints(placed('guard_hut_b_snow').outer), null, 'library model without a chimney anchor');
  assert.equal(FX.chimneyPoints(placed('house_halftimber_c_ruin').outer), null, 'ruin');
  assert.equal(FX.chimneyPoints(placed('villa_hq_destroyed').outer), null, 'destroyed variant');
  const proc = new THREE.Group(); proc.add(new THREE.Mesh(new THREE.BoxGeometry(4, 3, 5)));
  assert.deepEqual(FX.chimneyPoints(proc), [], 'procedural: no library model → caller may add a stack');
});

test('chimney: instanced repeats (library node disposed, the batch draws it) keep the exact chimney tops', () => {
  // libraryVisual offsets the model by the asset extents' centre; batchLibraryRepeats then disposes the model node
  const { cx, cz } = assetExtents('log_cabin_a_snow'), o = { x: -12, z: 61, rot: 2.1, scale: [0.9, 1.1, 1.2], turn: 1, cx, cz };
  const want = FX.chimneyPoints(placed('log_cabin_a_snow', o).outer);
  const b = placed('log_cabin_a_snow', o);
  b.model.removeFromParent(); b.outer.userData.libraryAsset = 'log_cabin_a_snow';
  const got = FX.chimneyPoints(b.outer);
  assert.equal(got.length, want.length);
  for (let i = 0; i < want.length; i++) assert.ok(got[i].distanceTo(want[i]) < 1e-6, `stack ${i}: ${got[i].toArray()} vs ${want[i].toArray()}`);
});

test('chimney: per-building variety — cold / faint / normal / busy, more fires lit in cold theaters, seeded', () => {
  const count = (theater) => {
    const c = { 0: 0, 0.45: 0, 1: 0, 1.5: 0 };
    for (let i = 0; i < 2000; i++) c[FX.chimneyActivity(`house_${i}#0`, theater)]++;
    return c;
  };
  const snow = count('snow'), desert = count('desert');
  near(snow[0] / 2000, 0.15, 0.04, 'snow: ~15 % cold');
  near(desert[0] / 2000, 0.4, 0.05, 'desert: ~40 % cold');
  assert.ok(snow[1.5] > 100 && snow[1.5] < 300, `a few busy chimneys (${snow[1.5]})`);
  assert.equal(FX.chimneyActivity('cabA#0', 'snow'), FX.chimneyActivity('cabA#0', 'snow'), 'deterministic');
});

/** Minimal library stand-in: records emits, runs emitters at a fixed step. */
function mockVfx(wind = [0, 0, 0]) {
  const v = {
    u: { uWind: { value: new THREE.Vector3(...wind) } }, emitted: [], emitters: [], time: 0,
    n: (c) => c, emit(p) { this.emitted.push({ ...p, t: this.time }); return 0; }, at() {}, light: () => ({}), decal() {},
    heatSource: (h) => h, debris: { add() {} }, addShake() {}, blast() {}, addEmitter(e) { e.acc = 0; e.t0 = this.time; this.emitters.push(e); return e; },
    run(sec, dt = 1 / 60) {
      for (let s = 0; s < sec; s += dt) {
        this.time += dt;
        for (const e of this.emitters) { if (e.stopped) continue; const age = this.time - e.t0; e.acc += dt * (typeof e.rate === 'function' ? e.rate(age) : e.rate); while (e.acc >= 1) { e.acc -= 1; e.fn(age, e); } }
      }
    },
  };
  let seed = 7; v.rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return v;
}
/** Analytic particle position at age t (pool.js _pos: drag, buoyancy, wind; no curl / gusts). */
function posAt(p, t, wind) {
  const k = p.drag, e = Math.exp(-k * t), f1 = (1 - e) / k, f2 = (t - f1) / k;
  return { x: p.vx * f1 + k * wind[0] * p.wind * f2, y: p.vy * f1 + p.buoy * f2, z: p.vz * f1 + k * wind[2] * p.wind * f2 };
}

test('E4: many faint, small ambient wisps (a continuous thin plume) that dilute within ~6–10 m of rise (calm) and sooner in wind', () => {
  const calm = mockVfx([0, 0, 0]);
  RECIPES.chimney_smoke(calm, new THREE.Vector3(0, 6, 0), { activity: 1 }, calm.rng);
  calm.run(60);
  const rate = calm.emitted.length / 60;
  assert.ok(rate > 15 && rate < 45, `wisps/s ${rate.toFixed(1)} (dense enough that the stack exit never blinks)`);
  for (const p of calm.emitted) {
    assert.ok(p.ambient && p.aux === 1, 'ambient flag (own pool, capped composite)');
    assert.ok(p.s0 <= 0.45 && p.s1 <= 1.4, `small wisps (stack-sized at birth, thin plume) ${p.s0}→${p.s1}`);
    assert.ok(p.op <= 0.5, 'faint per wisp');
    assert.ok(p.y - 6 >= 0 && p.y - 6 < 0.2 && Math.hypot(p.x, p.z) < 0.1, 'born on the stack top');
  }
  const rise = calm.emitted.map((p) => posAt(p, p.life, [0, 0, 0]).y);
  const mean = rise.reduce((a, b) => a + b, 0) / rise.length;
  assert.ok(mean > 6 && mean < 10, `calm: dissipated after ${mean.toFixed(1)} m of rise`);
  const windy = mockVfx([4, 0, 1.5]);
  RECIPES.chimney_smoke(windy, new THREE.Vector3(0, 6, 0), { activity: 1 }, windy.rng);
  windy.run(30);
  const wr = windy.emitted.map((p) => posAt(p, p.life, [4, 0, 1.5]));
  const wy = wr.reduce((a, q) => a + q.y, 0) / wr.length, wx = wr.reduce((a, q) => a + q.x, 0) / wr.length;
  assert.ok(wy < mean * 0.75, `windy plume lies flatter (${wy.toFixed(1)} m rise)`);
  assert.ok(wx > 3 * wy * 0.5 && wx > 4, `bent downwind (${wx.toFixed(1)} m)`);
  // a cold chimney emits nothing; a busy one more than a faint one
  const cold = mockVfx(); assert.equal(RECIPES.chimney_smoke(cold, new THREE.Vector3(), { activity: 0 }, cold.rng), null);
  const n = (act) => { const m = mockVfx(); RECIPES.chimney_smoke(m, new THREE.Vector3(), { activity: act, vary: false }, m.rng); m.run(20); return m.emitted.reduce((a, p) => a + p.op, 0); };
  assert.ok(n(1.5) > n(1) && n(1) > n(0.45) * 1.5, 'activity scales the density');
});

test('E4: slow variation over time (draught / stoking), deterministic per seed', () => {
  const m = mockVfx();
  RECIPES.chimney_smoke(m, new THREE.Vector3(), { activity: 1 }, m.rng);
  const e = m.emitters[0], r = [];
  for (let a = 0; a < 600; a += 5) r.push(e.rate(a));
  const lo = Math.min(...r), hi = Math.max(...r);
  assert.ok(hi / lo > 1.3, `rate varies ${lo.toFixed(1)}..${hi.toFixed(1)}`);
  assert.ok(Math.max(...r.slice(1).map((v, i) => Math.abs(v - r[i]))) < 0.25 * hi, 'slowly (no popping)');
});

test('ambient: only chimney smoke is ambient; fire, wreck, fuel-pool, column and campfire smoke keep their full strength', () => {
  const ambientOf = (kind, o = {}) => {
    const m = mockVfx(); RECIPES[kind](m, new THREE.Vector3(), o, m.rng); m.run(3);
    return m.emitted.filter((p) => !p.hot && (p.mode ?? 0) === 0).map((p) => !!p.ambient);
  };
  const ch = ambientOf('chimney_smoke', { activity: 1 });
  assert.ok(ch.length && ch.every(Boolean), 'chimney smoke ambient');
  for (const k of ['smoke_column', 'fire_small', 'burning_wreck', 'fire_large']) {
    const m = mockVfx(); if (!RECIPES[k]) continue;
    RECIPES[k](m, new THREE.Vector3(), {}, m.rng); m.run(3);
    assert.ok(m.emitted.length && !m.emitted.some((p) => p.ambient), `${k}: not ambient (not capped / masked)`);
  }
  const opt = ambientOf('smoke_column', { ambient: true });
  assert.ok(opt.length && opt.every(Boolean), 'smoke_column: ambient on request');
  const ex = mockVfx(); RECIPES.explosion_large(ex, new THREE.Vector3(), {}, ex.rng); ex.run(0.5);
  assert.ok(!ex.emitted.some((p) => p.ambient), 'explosion smoke stays dramatic (not capped)');
});

test('ambient: budgets per preset and per map (30 busy chimneys fit the high-preset ambient pool)', () => {
  for (const q of Object.values(VFX_QUALITY)) assert.ok(q.ambCap >= 1500 && q.ambCap <= q.smokeCap / 3, `ambCap ${q.ambCap}`);
  const m = mockVfx();
  RECIPES.chimney_smoke(m, new THREE.Vector3(), { activity: 1.5, vary: false }, m.rng);
  m.run(30);
  const live = m.emitted.filter((p) => p.t + p.life > m.time).length;
  assert.ok(live * 30 <= VFX_QUALITY.high.ambCap, `steady state ${live} wisps per busy chimney`);
});

test('ambient: perceived-opacity limiter — never above the cap, darkening or brightening, bright or dark ground', () => {
  const R = AMBIENT_RULES;
  assert.ok(R.cap <= 0.35 && R.capRoof > R.cap && R.capRoof <= 0.5 && R.cap * R.maskUnit <= 0.05 && R.cap * R.maskCone <= 0.05, 'rule set');
  assert.ok(R.toneMin > 0.3 && R.toneMin < 1 && R.toneMax > 1 && R.toneMax <= 2, 'tone band around the background');
  // soft knee: faint smoke passes untouched (no flattening of the plume's structure), dense parts approach the cap
  for (const d of [R.cap, R.capRoof]) {
    for (const p of [0.01, 0.1 * d, 0.5 * d, 0.6 * d]) assert.ok(Math.abs(kneeCap(p, d) - p) < 1e-9, `knee: ${p} untouched`);
    let prev = 0; for (let p = 0; p < 3 * d; p += d / 50) { const t = kneeCap(p, d); assert.ok(t >= prev - 1e-12 && t < d, 'monotonic, below the cap'); prev = t; }
  }
  let worst = 0, seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) {
    const Lb = 10 ** (rnd() * 4 - 3.5), a = rnd() * 0.85, Ls = a * 10 ** (rnd() * 3 - 2.5), d = [R.cap, R.capRoof, R.cap * R.maskUnit][i % 3];
    const k = capScale(Lb, Ls, a, d);
    const p = perceivedChange(Lb, Lb * (1 - k * a) + k * Ls);
    worst = Math.max(worst, p - d);
    assert.ok(k >= 0 && k <= 1);
  }
  assert.ok(worst < 0.004, `limit holds (worst excess ${worst})`);
  // the model: AgX log curve is monotonic; a black veil of alpha 0.5 over snow stays ≤ the cap after limiting
  for (let L = 1e-4; L < 10; L *= 1.5) assert.ok(displayValue(L * 1.5) >= displayValue(L));
  const k = capScale(0.15, 0, 0.5, R.cap);
  assert.ok(k < 1 && perceivedChange(0.15, 0.15 * (1 - 0.5 * k)) <= R.cap + 1e-3);
});

test('chimney: map scan (headless) — anchors of the placed models, a seated stack on procedural huts, mission overrides', () => {
  const subs = new Map();
  const roof = new THREE.Group(); // procedural hut: 4×5 m box body + gable roof prism up to 4.2 m
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 5)); body.position.y = 1.3; roof.add(body);
  const gable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.6, 1.6, 4, 1)); gable.position.y = 3.4; gable.rotation.y = Math.PI / 4; roof.add(gable);
  roof.position.set(70, 0, 10); roof.updateMatrixWorld(true);
  const structures = new Map([
    ['cab', { type: 'hut', def: {}, owner: 1, object3d: placed('log_cabin_b_snow', { x: 10, z: 10, rot: 0 }).outer }],
    ['guard', { type: 'hut', def: {}, owner: 2, object3d: placed('guard_hut_b_snow', { x: 30, z: 10 }).outer }],
    ['off', { type: 'house', def: { chimney: false }, owner: 3, object3d: placed('house_timber_c_snow', { x: 50, z: 10 }).outer }],
    ['proc', { type: 'hut', def: { chimney: true }, owner: 4, object3d: roof }],
  ]);
  const world = { mission: { theater: 'snow' }, structures, game: { options: {} }, groundY: () => 0,
    listen(ev, fn) { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(fn); return () => {}; } };
  const fx = new FX(world, new THREE.Scene());
  fx.update(1 / 60);
  const ids = fx._chimneys.map((c) => c.id);
  assert.deepEqual(ids.sort(), ['cab', 'proc'], `chimneys ${ids}`);
  const cab = fx._chimneys.find((c) => c.id === 'cab');
  const an = chimneyAnchors('log_cabin_b_snow')[0];
  near(cab.pos.y, an.pos[1] * 1.05, 1e-6, 'emission exactly at the stack top');
  const proc = fx._chimneys.find((c) => c.id === 'proc');
  const top = proc.mesh.position.y + proc.mesh.scale.y / 2, base = proc.mesh.position.y - proc.mesh.scale.y / 2;
  assert.ok(base < 4.2 && base > 2.0, `stack seated on the roof (${base.toFixed(2)})`);
  near(proc.pos.y, top + 0.02, 1e-6, 'smoke at the stack top');
  assert.ok(proc.activity > 0, 'mission chimney: true is lit');
  const lit = fx._chimneys.filter((c) => c.activity > 0).length;
  assert.equal(fx.items.filter((r) => r.kind === 'chimney_smoke').length, lit, 'one emitter per lit chimney');
  world.structures = null; fx.dispose();
});
