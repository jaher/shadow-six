/**
 * Step 4w wind: WindField presets / determinism / gust fronts, the Verlet cloth (flags, laundry), clothing flutter
 * weights, the clothesline device and the canvas flap attribute.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { WindField, resolveWind, WIND_PRESETS, WIND_UNIFORMS, WIND_GLSL } from '../../src/world/wind.js';
import { World } from '../../src/world/world.js';
import { VerletCloth, CLOTHS } from '../../src/art/cloth.js';
import { makeFlag, tickFlags } from '../../src/art/flags.js';
import { computeFlutter } from '../../src/art/cloth-wind.js';
import { makeClothesline } from '../../src/art/clothesline.js';
import { buildTent } from '../../src/art/dressing.js';
import { normalizeMission } from '../../src/missions/schema.js';

test('presets: theater defaults, calm dawn, weather.wind overrides', () => {
  assert.equal(resolveWind({ theater: 'fjord' }).preset, 'fjord');
  assert.equal(resolveWind({ theater: 'desert' }).devils, 1);
  assert.equal(resolveWind({ theater: 'temperate', lighting: { sunElevDeg: 3 } }).preset, 'calm');
  assert.equal(resolveWind({ theater: 'snow', lighting: { sunElevDeg: 3 } }).preset, 'snow', 'snow keeps blowing at low sun');
  const o = resolveWind({ theater: 'coast', weather: { wind: { speed: 14, dirDeg: 90 } } });
  assert.equal(o.speed, 14); assert.equal(o.dirDeg, 90); assert.equal(o.gustiness, WIND_PRESETS.coast.gustiness);
  assert.ok(resolveWind({ theater: 'nowhere' }).preset === 'temperate');
  const m = normalizeMission({ id: 't', size: [20, 20], commandos: [], weather: { wind: { preset: 'calm' } } }, { quiet: true });
  assert.deepEqual(m.weather, { wind: { preset: 'calm' } });
});

test('deterministic pure field: same (x, z, t) → same sample; world.wind per mission; frame() publishes uniforms', () => {
  const a = WindField.forMission({ theater: 'fjord' }), b = WindField.forMission({ theater: 'fjord' });
  for (const [x, z, t] of [[3, 4, 0], [50, 12, 17.3], [120, 80, 999.9]]) assert.deepEqual(a.sample(x, z, t), b.sample(x, z, t));
  const w = new World({ size: [80, 60], mission: { theater: 'desert' } });
  assert.equal(w.wind.preset, 'desert');
  w.wind.frame(12.5, { x: 10, z: 10 });
  assert.equal(WIND_UNIFORMS.uWindA.value[3], 12.5);
  const snap = [...WIND_UNIFORMS.uWindA.value, ...WIND_UNIFORMS.uWindB.value];
  w.wind.frame(12.5, { x: 10, z: 10 }); // paused: sim time unchanged → nothing moves
  assert.deepEqual([...WIND_UNIFORMS.uWindA.value, ...WIND_UNIFORMS.uWindB.value], snap);
  assert.ok(/windSample/.test(WIND_GLSL) && /2\.31/.test(WIND_GLSL) && /0\.45/.test(WIND_GLSL), 'GLSL twin carries the same front constants');
});

test('gusts: coastal/fjord gusty, desert steady; fronts travel downwind; devils only in the desert', () => {
  const stats = (theater) => {
    const f = WindField.forMission({ theater }); let mn = 1e9, mx = 0, sum = 0, n = 0;
    for (let t = 0; t < 300; t += 0.25) { const s = f.sample(40, 40, t); mn = Math.min(mn, s.speed); mx = Math.max(mx, s.speed); sum += s.speed; n++; }
    return { mean: sum / n, ratio: mx / (sum / n), mn };
  };
  const fj = stats('fjord'), de = stats('desert'), calm = WindField.forMission({ theater: 'temperate', lighting: { sunElevDeg: 2 } });
  assert.ok(fj.ratio > de.ratio + 0.2, `fjord gust ratio ${fj.ratio.toFixed(2)} vs desert ${de.ratio.toFixed(2)}`);
  assert.ok(fj.mean > 5 && fj.mean < 11 && calm.p.speed < 2);
  // a gust front seen at x0 at time t reaches a point downwind later (cross-correlation lag ≈ distance / front speed)
  const f = new WindField({ speed: 8, gustiness: 1, turbulence: 0, dirDeg: 0 });
  const series = (x) => Array.from({ length: 400 }, (_, i) => f.front(x, 0, i * 0.1));
  const A = series(0), B = series(40);
  let best = 0, lag = 0;
  for (let L = 0; L < 150; L++) { let c = 0; for (let i = 0; i + L < 400; i++) c += A[i] * B[i + L]; if (c > best) { best = c; lag = L * 0.1; } }
  assert.ok(Math.abs(lag - 40 / f.p.frontSpeed) < 1.2, `lag ${lag.toFixed(1)} s vs ${(40 / f.p.frontSpeed).toFixed(1)} s`);
  const d = WindField.forMission({ theater: 'desert' }, { W: 100, D: 100 });
  let devils = 0; for (let t = 0; t < 200; t += 1) if (d.devil(t)) devils++;
  assert.ok(devils > 20 && !WindField.forMission({ theater: 'snow' }).devil(5));
});

function plane(w, h, sx, sy) {
  const g = new THREE.PlaneGeometry(w, h, sx, sy); g.translate(w / 2, -h / 2, 0); return g;
}

test('Verlet cloth: slack in a calm, streams in a gale, no stretch, deterministic, frozen at dt = 0', () => {
  const run = (ws, steps = 480) => {
    const g = plane(1.8, 1.2, 16, 8);
    const c = new VerletCloth(g.attributes, { nx: 17, ny: 9, pinned: (i) => i === 0 });
    for (let k = 0; k < steps; k++) c.advance(1 / 60, [ws, 0, 0], [0, -9.81, 0], 0.3);
    return { c, g };
  };
  const tip = (c) => { const o = (4 * 17 + 16) * 3; return [c.x[o], c.x[o + 1], c.x[o + 2]]; };
  const calm = tip(run(0.8).c), gale = tip(run(14).c);
  assert.ok(calm[1] < -1.2 && calm[0] < 1.0, `calm fly end hangs (${calm.map((v) => v.toFixed(2))})`);
  assert.ok(gale[0] > 1.4 && gale[1] > -1.1, `gale streams out (${gale.map((v) => v.toFixed(2))})`);
  assert.ok(Math.hypot(...gale) < 1.8 * 1.06 + 0.61, 'tethers stop over-stretch');
  assert.deepEqual(tip(run(8, 200).c), tip(run(8, 200).c));
  const { c } = run(6, 60), before = tip(c);
  c.advance(0, [30, 0, 0], [0, -9.81, 0]);
  assert.deepEqual(tip(c), before);
});

test('flags: tickFlags advances the cloth on sim time only (paused = frozen), emits a halyard clank on a gust', () => {
  CLOTHS.length = 0;
  const scene = new THREE.Scene(), f = makeFlag({ pole: true, h: 6 });
  scene.add(f); scene.updateMatrixWorld(true);
  const W = new WindField({ speed: 10, gustiness: 1, turbulence: 0.5, dirDeg: 30 }), ev = [];
  W.events = { emit: (n, e) => ev.push([n, e]) };
  const cloth = f.getObjectByName('flag_cloth'), P = cloth.geometry.attributes.position.array;
  for (let k = 0; k <= 2400; k++) { W.frame(k / 60); tickFlags(1 / 60, W); }
  const a = Float32Array.from(P);
  for (let k = 0; k < 30; k++) tickFlags(1 / 60, W); // paused: wind time does not move
  assert.deepEqual(Float32Array.from(P), a);
  assert.ok(Math.abs(a[(4 * 17 + 16) * 3 + 2]) + Math.abs(a[(4 * 17 + 16) * 3] - 1.8) > 0.05, 'the flag moved');
  assert.ok(ev.some(([n]) => n === 'wind:flag'), 'clank event');
});

function skinned() {
  // minimal UE-style skeleton in bind pose (mesh space = bone space, metres)
  const B = { root: [0, 0, 0], pelvis: [0, 1, 0], spine_01: [0, 1.1, 0], neck_01: [0, 1.5, 0], Head: [0, 1.62, 0],
    thigh_l: [0.1, 0.95, 0], calf_l: [0.1, 0.52, 0], foot_l: [0.1, 0.08, 0], thigh_r: [-0.1, 0.95, 0], calf_r: [-0.1, 0.52, 0], foot_r: [-0.1, 0.08, 0],
    upperarm_l: [0.2, 1.42, 0], lowerarm_l: [0.48, 1.42, 0], hand_l: [0.74, 1.42, 0], upperarm_r: [-0.2, 1.42, 0], lowerarm_r: [-0.48, 1.42, 0], hand_r: [-0.74, 1.42, 0] };
  const names = Object.keys(B), bones = names.map((n) => { const b = new THREE.Bone(); b.name = n; b.position.fromArray(B[n]); return b; });
  // vertices: trouser (hugging the calf), coat skirt (standing off both legs), bare skin, sleeve cuff
  const V = [[0.17, 0.6, 0], [0, 0.55, 0.22], [0.1, 0.4, 0.05], [0.72, 1.42, 0.07]];
  const bi = [names.indexOf('calf_l'), names.indexOf('thigh_l'), names.indexOf('calf_l'), names.indexOf('lowerarm_l')];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V.flat(), 3));
  g.setAttribute('_mask', new THREE.Float32BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bi.flatMap((i) => [i, 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(bi.flatMap(() => [1, 0, 0, 0]), 4));
  const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  m.name = 'LOD0';
  const inv = bones.map((b) => new THREE.Matrix4().makeTranslation(-b.position.x, -b.position.y, -b.position.z));
  m.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4()); // explicit bind matrix: keep the given inverses
  return m;
}

test('clothing: flutter weights from the bind pose (coat skirt ≫ trousers, skin 0, cuffs light)', () => {
  const w = computeFlutter(skinned());
  const [trouser, skirt, skin, cuff] = [0, 1, 2, 3].map((i) => w[i * 2]);
  assert.ok(skirt > 0.5 && skirt > trouser * 4, `skirt ${skirt.toFixed(2)} vs trousers ${trouser.toFixed(2)}`);
  assert.equal(skin, 0);
  assert.ok(cuff > 0.1 && cuff < 0.6, `cuff ${cuff.toFixed(2)}`);
});

test('clothesline (M3): uniform + laundry are simulated cloth; canvas tents carry flap weights', () => {
  CLOTHS.length = 0;
  const line = makeClothesline();
  const uni = line.getObjectByName('clothesline_uniform');
  assert.ok(uni && uni.children.length === 2, 'tunic + trousers');
  assert.equal(CLOTHS.length, 4, 'four pegged garments on the wind tick');
  const tent = buildTent({ w: 4, d: 4, h: 2.2 });
  let flap = null;
  tent.traverse((o) => { if (o.isMesh && o.geometry.attributes.aFlap) flap = o.geometry.attributes.aFlap; });
  assert.ok(flap, 'aFlap survives consolidate');
  let mx = 0; for (let i = 0; i < flap.count; i++) mx = Math.max(mx, flap.getX(i));
  assert.ok(mx > 0.6);
});
