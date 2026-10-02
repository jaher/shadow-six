/** Conifer needle sprays (src/art/terrain/conifers.js, tools/render/build_needles.py): determinism, variety per seed and
 * theater, needle-card attributes (crown AO, snow catch on top faces only), wind flex, atlas layout and tri budget. */
import { test, assert } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { generateTree, GeoAcc, TREE_QUALITY, SPECIES, useThree, NEEDLE_LAYERS, limbClearance } from '../../src/art/terrain/treegen.js';
import { treePlacement } from '../../src/art/terrain.js';

useThree(THREE);
const ROOT = new URL('../../', import.meta.url);
const CONIFERS = Object.keys(SPECIES).filter((k) => SPECIES[k].kind === 'conifer');
const gen = (sp, seed, q = 'high', at = {}) => {
  const b = new GeoAcc(), l = new GeoAcc(), n = new GeoAcc();
  const info = generateTree(sp, seed, TREE_QUALITY[q], b, l, { x: 0, y: 0, z: 0, ...at }, n);
  return { b, l, n, info };
};
const hash = (a) => { let h = 2166136261; for (const x of a) h = Math.imul(h ^ Math.round(x * 1000), 16777619); return h >>> 0; };

test('pines: same seed → identical tree; different seeds → different trees (every conifer species)', () => {
  for (const sp of CONIFERS) {
    const a = gen(sp, 4242), b = gen(sp, 4242), c = gen(sp, 4243);
    assert.equal(hash(a.n.p), hash(b.n.p), `${sp}: deterministic needles`);
    assert.equal(hash(a.b.p), hash(b.b.p), `${sp}: deterministic bark`);
    assert.deepEqual(a.n.ext, b.n.ext, `${sp}: deterministic AO / snow catch`);
    assert.notEqual(hash(a.n.p), hash(c.n.p), `${sp}: a neighbouring seed is a different tree`);
  }
  // 12 spruces: all distinct, heights and crown widths spread
  const trees = Array.from({ length: 12 }, (_, i) => gen('spruce', 100 + i));
  assert.equal(new Set(trees.map((t) => hash(t.n.p))).size, 12, 'all spruces unique');
  const hs = trees.map((t) => t.info.height), crs = trees.map((t) => t.info.crownRadius);
  assert.ok(Math.max(...hs) - Math.min(...hs) > 2, `heights vary (${Math.min(...hs).toFixed(1)}..${Math.max(...hs).toFixed(1)})`);
  assert.ok(Math.max(...crs) / Math.min(...crs) > 1.15, 'crown widths vary');
});

test('pines: conifer foliage goes to the needle accumulator; broadleaves keep their leaf cards', () => {
  for (const sp of CONIFERS) {
    const { l, n } = gen(sp, 7);
    assert.equal(l.count, 0, `${sp}: no broadleaf cards`);
    assert.ok(n.idx.length / 3 > 400, `${sp}: needle sprays (${n.idx.length / 3} tris)`);
    const layers = new Set(); for (let i = 0; i < n.count; i++) layers.add(n.info[i * 4]);
    for (const L of layers) assert.ok(L >= 0 && L < NEEDLE_LAYERS.length && Number.isInteger(L), `${sp}: needle layer ${L} in the atlas`);
  }
  const oak = gen('oak', 7);
  assert.equal(oak.n.count, 0, 'oak: no needles'); assert.ok(oak.l.count > 0, 'oak: leaves');
  const burnt = gen('spruce', 7, 'high', { burnt: true });
  assert.equal(burnt.n.count, 0, 'burnt spruce: bare');
});

test('pines: AO darkens the crown interior; snow catch sits on the top faces of the outer tiers', () => {
  for (const sp of ['spruce', 'scots_pine']) {
    const { n } = gen(sp, 31);
    let aoMin = 1, aoMax = 0, up = 0, upPos = 0, catchMax = -1, catchMin = 1, inner = [], outer = [];
    const H = Math.max(...n.p.filter((_, i) => i % 3 === 1));
    for (let i = 0; i < n.count; i++) {
      const ao = n.ext[i * 2], c = n.ext[i * 2 + 1];
      assert.ok(ao > 0 && ao <= 1 && Math.abs(c) <= 1 && Number.isFinite(ao + c), `${sp}: ext in range`);
      aoMin = Math.min(aoMin, ao); aoMax = Math.max(aoMax, ao); catchMax = Math.max(catchMax, c); catchMin = Math.min(catchMin, c);
      const rho = Math.hypot(n.p[i * 3], n.p[i * 3 + 2]), y = n.p[i * 3 + 1];
      if (y > H * 0.3 && y < H * 0.8) (rho < 0.8 ? inner : rho > 2 ? outer : []).push(ao);
    }
    assert.ok(aoMax - aoMin > 0.3, `${sp}: AO spans the crown (${aoMin.toFixed(2)}..${aoMax.toFixed(2)})`);
    assert.ok(catchMax > 0.6, `${sp}: some faces catch snow`);
    const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    if (inner.length && outer.length) assert.ok(avg(inner) < avg(outer), `${sp}: inner crown darker (${avg(inner).toFixed(2)} < ${avg(outer).toFixed(2)})`);
  }
  // spruce comb curtains hang vertically and never carry snow
  const { n } = gen('spruce', 31);
  const cur = NEEDLE_LAYERS.indexOf('spruce_curtain');
  let curtains = 0;
  for (let i = 0; i < n.count; i++) if (n.info[i * 4] === cur) { curtains++; assert.equal(n.ext[i * 2 + 1], 0, 'curtain: no snow catch'); }
  assert.ok(curtains > 0, 'spruce has hanging comb curtains');
});

test('pines: wind flex grows from the trunk to the branch tips (branch-tier sway)', () => {
  const { n } = gen('spruce', 55);
  let nearF = [], farF = [];
  for (let i = 0; i < n.count; i++) {
    const rho = Math.hypot(n.p[i * 3], n.p[i * 3 + 2]), f = n.info[i * 4 + 2];
    assert.ok(f >= 0 && f <= 1, 'flex 0..1');
    (rho < 0.7 ? nearF : rho > 2 ? farF : []).push(f);
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(avg(farF) > avg(nearF) + 0.25, `tips flex more (${avg(nearF).toFixed(2)} → ${avg(farF).toFixed(2)})`);
});

test('pines: species per theater (snow: Norway spruce + Scots pine; coast: stone/Aleppo; desert: Aleppo)', () => {
  const by = (theater) => { const s = new Map(); for (let k = 0; k < 200; k++) { const p = treePlacement({ type: 'pine', x: k * 3.1, z: k * 1.7 }, theater, k); s.set(p.species, (s.get(p.species) || 0) + 1); } return s; };
  const snow = by('snow'), coast = by('coast'), desert = by('desert'), temp = by('temperate');
  assert.deepEqual([...snow.keys()].sort(), ['scots_pine', 'spruce'], 'snow: spruce + Scots pine');
  assert.ok(snow.get('spruce') > snow.get('scots_pine'), 'snow: spruce dominant');
  assert.ok(coast.has('stone_pine') && !coast.has('spruce'), 'coast: umbrella pines');
  assert.deepEqual([...desert.keys()], ['pine'], 'desert: Aleppo pine');
  assert.ok(temp.size >= 3, 'temperate: mixed conifers');
  for (const sp of ['spruce', 'scots_pine', 'stone_pine', 'pine', 'fir']) assert.equal(SPECIES[sp].kind, 'conifer', `${sp} is a conifer (wind, snow puffs)`);
});

test('pines: tri budget per quality and the baked needle atlas matches the layer list', () => {
  const tris = (t) => (t.n.idx.length + t.b.idx.length) / 3;
  for (const sp of CONIFERS) {
    const avg = (q) => Array.from({ length: 8 }, (_, i) => tris(gen(sp, 9 + i * 37, q))).reduce((a, b) => a + b, 0) / 8;
    const lo = avg('low'), hi = avg('high'), ul = avg('ultra');
    assert.ok(lo < hi * 0.85, `${sp}: low cheaper than high (${lo | 0} / ${hi | 0})`);
    assert.ok(hi < 7000, `${sp}: high-quality tree averages under 7k tris (${hi | 0})`);
    assert.ok(ul < 9000, `${sp}: ultra-quality tree averages under 9k tris (${ul | 0})`);
  }
  const meta = JSON.parse(readFileSync(new URL('assets/terrain/needles.json', ROOT), 'utf8'));
  assert.deepEqual(meta.layers, NEEDLE_LAYERS, 'needles.json layers = NEEDLE_LAYERS');
  for (const f of ['needles.webp', 'needles_n.webp']) assert.ok(existsSync(new URL(`assets/terrain/${f}`, ROOT)), f);
});

// User report 2026-10-02 ("they are not rendering the same way they used to with all detail"): the clip-2 walk-under
// clearance dropped the outer, snow-carrying spray of every spruce / fir limb (it was measured against a cut at the
// tip: f1 1.12 > 1) and every needle of the low tiers, and its skipped rng calls made every tree a different one.
const WALK = [{ y: 1.95, r: 0.35, wood: true }]; // terrain.js treePlacement: walk-under floor (wood only)

test('pines: every spruce / fir limb keeps all its sprays — the needle cards of the pine-needle look-dev (7a0994bb)', () => {
  // needle tris per tree at 7a0994bb (full detail); the broken build had 3978 / 2388 / 1206 / 1914 / 688
  const LOOKDEV = { 'spruce/11/high': 5586, 'spruce/4242/high': 3548, 'spruce/90001/low': 1358, 'fir/11/high': 3394, 'fir/90001/high': 1752, 'scots_pine/11/high': 4604 };
  for (const [k, want] of Object.entries(LOOKDEV)) {
    const [sp, seed, q] = k.split('/');
    assert.equal(gen(sp, Number(seed), q).n.idx.length / 3, want, `${k}: needle tris as at the look-dev`);
    assert.equal(gen(sp, Number(seed), q, { clear: WALK }).n.idx.length / 3, want, `${k}: the walk-under clearance keeps them`);
  }
});

test('pines: the walk-under clearance binds the limb wood only (needles, lean and yaw unchanged); no wood under head height', () => {
  const lowWood = (b) => { let k = 0; for (let i = 0; i < b.count; i++) { const y = b.p[i * 3 + 1]; if (y > 0.25 && y < 1.6 && Math.hypot(b.p[i * 3], b.p[i * 3 + 2]) > 0.7) k++; } return k; };
  for (const sp of ['spruce', 'fir', 'scots_pine']) for (const seed of [11, 4242, 90001]) {
    const a = gen(sp, seed), c = gen(sp, seed, 'high', { clear: WALK });
    assert.equal(hash(c.n.p), hash(a.n.p), `${sp} ${seed}: same needle cards (same tree)`);
    assert.deepEqual(c.n.ext, a.n.ext, `${sp} ${seed}: same AO / snow catch`);
    assert.equal(lowWood(c.b), 0, `${sp} ${seed}: no limb wood under head height beyond the trunk`);
    if (sp !== 'scots_pine') assert.ok(lowWood(a.b) > 0 && c.b.count < a.b.count, `${sp} ${seed}: the low limbs' wood is what goes`);
  }
});

test('pines: a hard floor (crown lifted over an obstacle) lifts a sagging limb with its sprays; the crown above is the same tree', () => {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const sag = [V3(0, 4.1, 0), V3(0.8, 3.9, 0), V3(1.6, 3.6, 0), V3(2.4, 3.3, 0), V3(3.0, 3.2, 0)];
  const floor = [{ y: 3.45, r: 0.35 }];
  const L = limbClearance(sag, [...WALK, ...floor], 0.1);
  assert.ok(L.lifted && !L.drop, 'lifted, not dropped');
  assert.deepEqual(L.pts.slice(0, 3).map((p) => p.y), [4.1, 3.9, 3.6], 'points above the floor stay');
  for (const p of L.pts.slice(3)) assert.ok(Math.abs(p.y - 3.55) < 1e-9, `lifted onto the floor + margin (${p.y})`);
  assert.deepEqual(L.pts.map((p) => p.x), sag.map((p) => p.x), 'the limb keeps its reach');
  assert.equal(L.woodN, 4, 'its wood is whole');
  const born = limbClearance([V3(0, 3, 0), V3(0.8, 2.9, 0), V3(1.6, 2.7, 0)], floor);
  assert.ok(born.drop, 'a limb born under the floor is dropped');
  const walk = limbClearance([V3(0, 2.3, 0), V3(0.6, 2.0, 0), V3(1.2, 1.7, 0), V3(1.8, 1.5, 0)], WALK);
  assert.ok(!walk.lifted && !walk.drop && walk.pts[3].y === 1.5 && walk.woodN === 1, 'walk-under: needles stay where they grew, the wood ends at the break');
  // a whole spruce under a 4 m floor: the crown above it is unchanged (dropped limbs keep the rng stream)
  for (const seed of [11, 4242]) {
    const a = gen('spruce', seed), c = gen('spruce', seed, 'high', { clear: [{ y: 4, r: 0.35 }] });
    const above = (n) => n.p.filter((_, i) => i % 3 === 1 && n.p[i] > 7.5);
    assert.ok(above(a.n).length > 500, 'crown above 7.5 m');
    assert.deepEqual(above(c.n), above(a.n), `spruce ${seed}: same crown above the floor`);
    let under = 0;
    for (let i = 0; i < c.b.count; i++) { const y = c.b.p[i * 3 + 1]; if (y > 0.25 && y < 3.7 && Math.hypot(c.b.p[i * 3], c.b.p[i * 3 + 2]) > 0.7) under++; }
    assert.equal(under, 0, `spruce ${seed}: no wood under the floor beyond the trunk`);
  }
});
