/** Conifer needle sprays (src/art/terrain/conifers.js, tools/render/build_needles.py): determinism, variety per seed and
 * theater, needle-card attributes (crown AO, snow catch on top faces only), wind flex, atlas layout and tri budget. */
import { test, assert } from './lib.mjs';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { generateTree, GeoAcc, TREE_QUALITY, SPECIES, useThree, NEEDLE_LAYERS } from '../../src/art/terrain/treegen.js';
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
