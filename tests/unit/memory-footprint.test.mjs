import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { SessionCache, defaultSpare, sessionCache } from '../../src/engine/asset-cache.js';
import { screenDensity, tierFor } from '../../src/engine/texel-budget.js';
import { useLibDensity, setLibPreset, libTier } from '../../src/art/lib-tiers.js';
import { scopedMemo, touch, sceneBytes, disposeScene, textureBytes } from '../../src/engine/scoped-assets.js';
import { releaseDataAfterUpload, reloadReleased, releasedDataTextures, watchTexture } from '../../src/engine/texture-memory.js';
import { terrainTexRes } from '../../src/art/terrain.js';
import { slimShadowMap } from '../../src/engine/renderer.js';

let clock = 0;
const mk = (o = {}) => new SessionCache({ budget: 10000, spare: 0, now: () => clock++, ...o });

test('screen density: 40 CSS px/m × zoom 2 × the preset pixel-ratio cap', () => {
  assert.equal(screenDensity('low'), 80);
  assert.equal(screenDensity('medium'), 100);
  assert.equal(screenDensity('high'), 120);
  assert.equal(screenDensity('ultra'), 160);
});

test('tierFor: smallest power of two whose texels per metre still cover the screen', () => {
  assert.equal(tierFor(500, 1024, 120), 256); // 500 → 250 (512) → 125 (256) ≥ 120; 62.5 (128) is not
  assert.equal(tierFor(239, 1024, 120), 1024); // half would be 119.5 < 120
  assert.equal(tierFor(240, 1024, 120), 512);
  assert.equal(tierFor(5000, 1024, 100), 128, 'never below the floor');
  assert.equal(tierFor(null, 1024, 120), 1024, 'unknown density → full size');
  assert.equal(tierFor(500, 1024, 0), 1024, 'no preset → full size');
});

test('lib tiers: per map by density, ultra keeps 1k, low caps at 512, unlisted maps stay 1k', () => {
  useLibDensity({ maps: { 'a_diff.jpg': 600, 'b_diff.jpg': 150, 'c_nor.jpg': 300 } });
  setLibPreset('high');
  assert.equal(libTier('a_diff.jpg'), '256');
  assert.equal(libTier('b_diff.jpg'), '1k');
  assert.equal(libTier('c_nor.jpg'), '512');
  assert.equal(libTier('unknown.jpg'), '1k');
  setLibPreset('medium');
  assert.equal(libTier('b_diff.jpg'), '1k'); // 75 at 512 < 100
  setLibPreset('low');
  assert.equal(libTier('b_diff.jpg'), '512', 'low never above 512 (as before)');
  assert.equal(libTier('unknown.jpg'), '512');
  setLibPreset('ultra');
  assert.equal(libTier('a_diff.jpg'), '1k');
  setLibPreset(null);
  assert.equal(libTier('a_diff.jpg'), '1k');
  useLibDensity({});
});

test('terrain arrays: 512 on medium / high where every layer of the palette keeps the screen density', () => {
  assert.equal(terrainTexRes('low', 'snow'), 512);
  assert.equal(terrainTexRes('ultra', 'temperate'), 2048);
  assert.equal(terrainTexRes('medium', 'snow'), 512); // largest tile 5 m: 102 texels/m ≥ 100
  assert.equal(terrainTexRes('high', 'snow'), 1024); // 102 < 120
  assert.equal(terrainTexRes('high', 'temperate'), 512); // largest tile 3 m: 171 ≥ 120
  assert.equal(terrainTexRes('high', 'desert'), 1024);
  assert.equal(terrainTexRes('medium', 'desert'), 512);
});

test('settle: once a mission has loaded, what it did not use is freed (beyond spare), the history keeps it alone', () => {
  const c = mk();
  const gone = [];
  const o = (k, bytes = 100) => ({ bytes, dispose: () => gone.push(k) });
  c.beginMission('m01'); c.set('m01:a', 1, o('m01:a')); c.set('shared', 1, o('shared'));
  c.settle();
  assert.deepEqual(gone, []);
  c.beginMission('m02');
  c.get('shared'); c.set('m02:a', 1, o('m02:a'));
  assert.deepEqual(gone, [], 'the last mission stays while the next one loads (it may reuse it)');
  c.settle();
  assert.deepEqual(gone, ['m01:a'], 'after the load: m01-only data goes');
  assert.ok(c.has('shared') && c.has('m02:a'));
  assert.deepEqual(c.missions, ['m02']);
  // restart of the same mission keeps everything
  c.beginMission('m02'); c.settle();
  assert.deepEqual(gone, ['m01:a']);
  // spare: unpinned entries up to `spare` bytes stay (least recently used go first)
  const d = mk({ spare: 150 });
  d.beginMission('a'); d.set('a1', 1, o('a1')); d.set('a2', 1, o('a2'));
  d.beginMission('b'); d.set('b1', 1, o('b1')); d.settle();
  assert.ok(!d.has('a1') && d.has('a2') && d.has('b1'), 'one 100-byte leftover fits the 150-byte spare (the newer one)');
  assert.equal(defaultSpare({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', deviceMemory: 4 }), 0, 'phones keep no spare');
  assert.ok(defaultSpare({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', deviceMemory: 8 }) > 0);
});

test('scopedMemo: a hit tags the entry and what it was built from; eviction removes it from the module map', () => {
  const saved = { m: [...sessionCache.missions], spare: sessionCache.spare };
  const TEX = new Map(), MAT = new Map(), freed = [];
  const tex = (n) => scopedMemo('t:test', TEX, n, () => ({ n }), { bytes: 10, free: (v) => freed.push('tex:' + v.n) });
  const mat = (n) => scopedMemo('t:mat', MAT, n, () => ({ n, map: tex(n + '_diff') }), { free: (v) => freed.push('mat:' + v.n) });
  try {
    sessionCache.spare = 0;
    sessionCache.beginMission('t1');
    const a = mat('stone');
    assert.equal(mat('stone'), a, 'memoised');
    sessionCache.settle();
    sessionCache.beginMission('t2');
    mat('stone'); // a hit: the material and (through its deps) its texture now belong to t2 too
    mat('wood');
    sessionCache.settle();
    assert.deepEqual(freed, [], 'everything used by t2 stays');
    sessionCache.beginMission('t3');
    mat('wood');
    sessionCache.settle();
    assert.deepEqual(freed.sort(), ['mat:stone', 'tex:stone_diff']);
    assert.ok(!MAT.has('stone') && !TEX.has('stone_diff') && MAT.has('wood') && TEX.has('wood_diff'));
    touch('t:mat:wood');
  } finally {
    for (const k of [...sessionCache.entries.keys()]) if (k.startsWith('t:')) sessionCache.delete(k);
    sessionCache.missions = saved.m; sessionCache.spare = saved.spare;
  }
});

test('sceneBytes / disposeScene: owned textures counted once per image, shared ones left to their own entry', () => {
  const img = { width: 256, height: 256 };
  const own = new THREE.Texture(img), shared = new THREE.Texture({ width: 1024, height: 1024 }), clone = shared.clone();
  const g = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: own, normalMap: clone })));
  root.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: own.clone() })));
  const isSharedImage = (t) => t.source === shared.source;
  const geo = Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength * 2, 0) + g.index.array.byteLength * 2;
  assert.equal(sceneBytes(root, isSharedImage), geo + textureBytes(own));
  const disposed = new Set();
  for (const t of [own, shared, clone]) t.addEventListener('dispose', () => disposed.add(t));
  disposeScene(root, (t) => t === shared);
  assert.ok(disposed.has(own) && disposed.has(clone) && !disposed.has(shared), 'the clone goes, the shared original stays');
});

test('data textures drop their array after the upload and are refilled after a restored context', async () => {
  const t = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2);
  let reloads = 0;
  releaseDataAfterUpload(t, async () => { reloads++; return { data: new Uint8Array(4 * 4 * 4 * 2).fill(7) }; });
  t.onUpdate(t); // what three calls after the upload
  assert.equal(t.image.data, null);
  assert.equal(t.source.dataReady, false);
  assert.equal(t.image.width, 4); assert.equal(t.image.depth, 2);
  assert.ok(releasedDataTextures().includes(t));
  const v = t.version;
  await reloadReleased();
  assert.equal(reloads, 1);
  assert.equal(t.image.data[0], 7);
  assert.equal(t.source.dataReady, true);
  assert.ok(t.version > v, 'uploads again (three checks the texture version)');
  t.onUpdate(t);
  assert.equal(t.image.data, null, 'released again after that upload');
  // three uploads it again although its array is gone (disposed by an eviction while still drawn): it refills itself
  t.onUpdate(t);
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(reloads, 2);
  assert.equal(t.image.data?.[0], 7);
  assert.equal(t.source.dataReady, true);
  // only textures decoded by EncodedBitmapLoader are watched (node: no ImageBitmap at all)
  const plain = new THREE.Texture({ width: 2, height: 2 });
  watchTexture(plain);
  assert.equal(plain.onUpdate, null);
});

test('shadow map render targets get a one-byte colour attachment (depth is what PCF samples)', () => {
  const shadow = new THREE.DirectionalLight().shadow;
  slimShadowMap(shadow);
  shadow.map = new THREE.WebGLRenderTarget(64, 64);
  assert.equal(shadow.map.texture.format, THREE.RedFormat);
  shadow.map = null;
  assert.equal(shadow.map, null);
});
