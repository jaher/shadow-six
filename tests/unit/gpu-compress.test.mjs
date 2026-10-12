/**
 * Load-time GPU texture compression (src/engine/gpu-compress.js) — the parts that run without a GPU: the ASTC tables
 * (QUANT_192 unquantization, trit packing), which textures qualify, the in-place conversion (identity, clones, the
 * upload hook), the release / refill of the compressed levels (engine/texture-memory.js), byte accounting, the glTF
 * colour spaces and the render-target formats (16-bit shadow depth, 8-bit SMAA / AO targets).
 * The encoders themselves are checked on the GPU: tests/gpu-compress.test.mjs and tools/perf/gpu-compress-quality.mjs.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { astcUnq192, astcUnq48, astcUnq160, astcQuints, astcTrits, astcTables, astcPatterns2, astcSeedTable, astcSeedTableAsync, chooseTier, blockBytes, mipLevels, GpuCompressor, GpuCompressedTexture, applyCompressed, COMPRESSED_HOOKS, keepImage } from '../../src/engine/gpu-compress.js';
import { gltfColorSpaces, textureMemoryStats, reloadReleased } from '../../src/engine/texture-memory.js';
import { textureBytes } from '../../src/engine/scoped-assets.js';
import { slimShadowMap, eightBitTargets, dropShadowColour } from '../../src/engine/renderer.js';

test('ASTC QUANT_192: 192 distinct values spread over 0..255 (spec C.2.13 unquantization)', () => {
  const v = Array.from({ length: 192 }, (_, i) => astcUnq192(i));
  const sorted = [...new Set(v)].sort((a, b) => a - b);
  assert.equal(sorted.length, 192);
  assert.equal(sorted[0], 0); assert.equal(sorted[191], 255);
  for (let i = 0; i < 192; i++) assert.ok(Math.abs(sorted[i] - i * 255 / 191) <= 1, `value ${i}: ${sorted[i]}`);
  // the a-bit mirrors: bits = 1, trit 0 → 255; bits = 0, trit 0 → 0
  assert.equal(astcUnq192(1), 255); assert.equal(astcUnq192(0), 0);
});

test('ASTC QUANT_48: 48 distinct values spread over 0..255', () => {
  const sorted = [...new Set(Array.from({ length: 48 }, (_, i) => astcUnq48(i)))].sort((a, b) => a - b);
  assert.equal(sorted.length, 48);
  assert.equal(sorted[0], 0); assert.equal(sorted[47], 255);
  for (let i = 0; i < 48; i++) assert.ok(Math.abs(sorted[i] - i * 255 / 47) <= 1, `value ${i}: ${sorted[i]}`);
});

test('ASTC QUANT_160 (quint + 5 bits): 160 distinct values spread over 0..255; every 3-quint tuple packs and unpacks', () => {
  const sorted = [...new Set(Array.from({ length: 160 }, (_, i) => astcUnq160(i)))].sort((a, b) => a - b);
  assert.equal(sorted.length, 160);
  assert.equal(sorted[0], 0); assert.equal(sorted[159], 255);
  for (let i = 0; i < 160; i++) assert.ok(Math.abs(sorted[i] - i * 255 / 159) <= 2, `value ${i}: ${sorted[i]}`);
  // spot values from ARM astc-encoder's color_scrambled_pquant_to_uquant_q160 (the full tables match)
  assert.deepEqual([0, 1, 2, 3, 32, 33, 64, 65, 159].map(astcUnq160), [0,255,8,247,1,254,3,252,129]);
  const t = astcTables();
  for (let k = 0; k < 125; k++) assert.deepEqual(astcQuints(t[(3 * 256 + k) * 2]), [k % 5, Math.floor(k / 5) % 5, Math.floor(k / 25)], `tuple ${k}`);
  for (let x = 0; x < 256; x++) { const idx = t[(4 * 256 + x) * 2], val = t[(4 * 256 + x) * 2 + 1]; assert.ok(idx < 160 && astcUnq160(idx) === val && Math.abs(val - x) <= 1, `q160 x=${x}`); }
});

test('ASTC tables: every 8-bit value has a QUANT_192 code within 1; every 5-trit tuple packs and unpacks', () => {
  const t = astcTables();
  for (let x = 0; x < 256; x++) {
    const idx = t[x * 2], val = t[x * 2 + 1];
    assert.ok(idx < 192 && astcUnq192(idx) === val && Math.abs(val - x) <= 1, `x=${x}`);
  }
  for (let k = 0; k < 243; k++) {
    const T = t[(256 + k) * 2];
    const want = [k % 3, Math.floor(k / 3) % 3, Math.floor(k / 9) % 3, Math.floor(k / 27) % 3, Math.floor(k / 81) % 3];
    assert.deepEqual(astcTrits(T), want, `tuple ${k}`);
  }
  for (let x = 0; x < 256; x++) { const idx = t[(512 + x) * 2], val = t[(512 + x) * 2 + 1]; assert.ok(idx < 48 && astcUnq48(idx) === val && Math.abs(val - x) <= 3, `q48 x=${x}`); }
  // a partial group (one value) must only need the two low T bits
  for (let t0 = 0; t0 < 3; t0++) assert.ok(t[(256 + t0) * 2] < 4);
});

test('ASTC two-partition patterns = astc-encoder\'s (4×4, seeds 0..1023), the seed table picks the nearest', async () => {
  const pat = astcPatterns2();
  // the 1024 masks as ARM astc-encoder's partition tables compute them (bit = texel y·4+x in partition 1): a hash of
  // all of them and a few values
  let h = 0;
  for (const m of pat) h = (Math.imul(h, 31) + m) >>> 0;
  assert.equal(h, 1314382834);
  assert.deepEqual([1, 2, 3, 7, 100, 513, 1023].map((s) => pat[s]), [13174, 4403, 26317, 39299, 65219, 63507, 32802]);
  const t = astcSeedTable(), seedOf = (m) => t[m * 2] | (t[m * 2 + 1] << 8);
  const pc = (x) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
  const near = (m) => { const p = pat[seedOf(m)]; return Math.min(pc(m ^ p), 16 - pc(m ^ p)); };
  // a mask that is a pattern (or its complement) maps to a seed with that exact pattern; others to the fewest flips
  for (const s of [1, 2, 3, 7, 100, 513, 1023]) { assert.equal(near(pat[s]), 0); assert.equal(near(pat[s] ^ 0xffff), 0); }
  for (let m = 1; m < 65535; m += 997) {
    let best = 99;
    for (const p of pat) if (p && p !== 0xffff) best = Math.min(best, pc(m ^ p), 16 - pc(m ^ p));
    assert.equal(near(m), best, `mask ${m}`);
  }
  assert.ok(await astcSeedTableAsync() === t, 'one table');
});

test('ASTC QUANT_24 row: every 8-bit value has its nearest QUANT_24 code', () => {
  const t = astcTables(), Q24 = [0, 255, 33, 222, 66, 189, 99, 156, 11, 244, 44, 211, 77, 178, 110, 145, 22, 233, 55, 200, 88, 167, 121, 134];
  for (let x = 0; x < 256; x++) {
    const idx = t[(9 * 256 + x) * 2], val = t[(9 * 256 + x) * 2 + 1];
    assert.ok(idx < 24 && Q24[idx] === val, `q24 x=${x}`);
    assert.equal(Math.abs(val - x), Math.min(...Q24.map((v) => Math.abs(v - x))), `q24 nearest x=${x}`);
  }
});

test('encoder tier from the calibration: big GPUs full, phone-class fast / base, too slow → off', () => {
  // GPU time per Mtexel of the fast tier on noise (an RTX 5090 measures 1.2–3.6 under load, SwiftShader 120–200)
  assert.equal(chooseTier('bc7', 1.6, true), 2);
  assert.equal(chooseTier('bc7', 3.6, true), 2);
  assert.equal(chooseTier('bc7', 1.2, false), 2);
  assert.equal(chooseTier('bc7', 2, false), 1);
  assert.equal(chooseTier('bc7', 4, false), 0);
  assert.equal(chooseTier('astc', 0.5, false), 2);
  assert.equal(chooseTier('astc', 1, false), 1);
  assert.equal(chooseTier('astc', 5, false), 0);
  assert.equal(chooseTier('bc7', 12, false), null);
  assert.equal(chooseTier('astc', 120, true), null);
  assert.equal(chooseTier('astc', NaN, false), null);
});

test('block sizes and mip counts', () => {
  assert.equal(blockBytes(1024, 1024), 1024 * 1024);
  assert.equal(blockBytes(2, 1), 16);
  assert.equal(blockBytes(6, 6), 64);
  assert.equal(mipLevels(1024, 1024), 11);
  assert.equal(mipLevels(512, 2048), 12);
});

const fakeRenderer = () => ({ getContext: () => ({ isContextLost: () => false }), domElement: null, capabilities: { maxTextureSize: 4096 } });

test('compressible: 8-bit RGBA images, sides multiple of 4, linear filtering; not data / canvas / NEAREST maps', () => {
  const c = new GpuCompressor(fakeRenderer());
  assert.equal(c.codec, null, 'no WebGL2 in node: nothing is compressed');
  const img = { width: 1024, height: 512 };
  const t = new THREE.Texture(img);
  assert.equal(c.compressible(t), false);
  c.codec = 'bc7';
  assert.equal(c.compressible(t), true);
  assert.equal(c.compressible(new THREE.Texture({ width: 1022, height: 512 })), false, 'odd size');
  const n = new THREE.Texture(img); n.magFilter = n.minFilter = THREE.NearestFilter;
  assert.equal(c.compressible(n), false, 'pixel-exact (stone ids)');
  assert.equal(c.compressible(new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16)), false, 'procedural data');
  const f = new THREE.Texture(img); f.type = THREE.HalfFloatType;
  assert.equal(c.compressible(f), false);
  const opt = new THREE.Texture(img); opt.userData.noCompress = true;
  assert.equal(c.compressible(opt), false);
  const a = new THREE.DataArrayTexture(new Uint8Array(8 * 8 * 4 * 3), 8, 8, 3);
  assert.equal(c.compressibleArray(a), false, 'NEAREST by default (data)');
  a.minFilter = THREE.LinearMipmapLinearFilter; a.magFilter = THREE.LinearFilter; // layer strips (art/terrain/layer-image.js)
  assert.equal(c.compressibleArray(a), true);
  assert.equal(c.compressible(a), false, 'arrays go through compressArray');
});

/** A compressed texture as compress() leaves it (fake levels, the texture-memory release hooks). */
function compressedFixture(reload) {
  const t = new THREE.Texture({ width: 8, height: 8 });
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  const mipmaps = [8, 4, 2, 1].map((s) => ({ data: new Uint8Array(blockBytes(s, s)).fill(s), width: s, height: s }));
  const source = new THREE.TextureSource({ width: 8, height: 8 });
  COMPRESSED_HOOKS.track(source, { reload });
  return applyCompressed(t, THREE.RGBA_BPTC_Format, { source, mipmaps });
}

test('in place: same object becomes a compressed texture; clones share the image and report their uploads', () => {
  let own = 0;
  const t = new THREE.Texture({ width: 8, height: 8 });
  t.onUpdate = () => { own++; };
  const mipmaps = [{ data: new Uint8Array(64), width: 8, height: 8 }];
  const before = t;
  applyCompressed(t, THREE.RGBA_ASTC_4x4_Format, { source: new THREE.TextureSource({ width: 8, height: 8 }), mipmaps });
  assert.equal(t, before);
  assert.ok(t instanceof GpuCompressedTexture && t.isCompressedTexture);
  assert.equal(t.format, THREE.RGBA_ASTC_4x4_Format);
  assert.equal(t.generateMipmaps, false); assert.equal(t.flipY, false);
  assert.ok(t.version > 0, 'needsUpdate');
  const c = t.clone();
  assert.ok(c instanceof GpuCompressedTexture && c.isCompressedTexture);
  assert.equal(c.source, t.source); assert.equal(c.mipmaps[0], t.mipmaps[0]);
  let hooked = 0;
  const prev = COMPRESSED_HOOKS.upload;
  COMPRESSED_HOOKS.upload = () => { hooked++; };
  try { t.onUpdate(t); c.onUpdate(c); } finally { COMPRESSED_HOOKS.upload = prev; }
  assert.equal(hooked, 2, 'both report to the release hook');
  assert.equal(own, 1, "the texture's own onUpdate still runs");
});

test('the decoded image is closed once its texture went compressed, unless a plain sibling still uploads it', () => {
  const closed = [];
  const bmp = (n) => ({ width: 8, height: 8, close() { closed.push(n); } });
  // node: no ImageBitmap class, so applyCompressed's close only runs in browsers; check the keep bookkeeping instead
  const a = new THREE.Texture(bmp('a')), b = new THREE.Texture(bmp('b'));
  keepImage(b.source);
  const mk = () => ({ source: new THREE.TextureSource({ width: 8, height: 8 }), mipmaps: [{ data: new Uint8Array(64), width: 8, height: 8 }] });
  const srcB = b.source;
  applyCompressed(a, THREE.RGBA_BPTC_Format, mk());
  applyCompressed(b, THREE.RGBA_BPTC_Format, mk());
  assert.equal(srcB.data.width, 8, 'the kept source still has its image');
  assert.deepEqual(closed, [], 'nothing closed without ImageBitmap (node)');
});

test('compressed levels leave page memory after the upload and come back for an upload without them', async () => {
  let reloads = 0;
  const t = compressedFixture(async () => { reloads++; return [8, 4, 2, 1].map((s) => new Uint8Array(blockBytes(s, s)).fill(9)); });
  const r0 = textureMemoryStats.compressedReleased;
  t.onUpdate(t); // three uploaded it
  assert.equal(textureMemoryStats.compressedReleased, r0 + 1);
  assert.equal(t.mipmaps[0].data, null);
  assert.equal(t.source.dataReady, false);
  assert.equal(t.mipmaps.length, 4, 'level sizes stay (three allocates from them)');
  // another sampler variant (its own GL texture) uploads after the release: allocated empty → encoded again
  const c = t.clone(); c.wrapS = THREE.ClampToEdgeWrapping;
  const v = c.version;
  c.onUpdate(c);
  await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(reloads, 1);
  assert.equal(t.mipmaps[0].data?.[0], 9, 'shared level objects: both see the data');
  assert.equal(t.source.dataReady, true);
  assert.ok(c.version > v, 'the waiting texture uploads again');
  c.onUpdate(c);
  assert.equal(t.mipmaps[0].data, null, 'released again once nothing waits');
  // a restored context: every released compressed texture is encoded again
  await reloadReleased();
  assert.equal(reloads, 2);
  assert.equal(t.source.dataReady, true);
});

test('without a way to make them again, the levels stay (no blank textures)', () => {
  const t = compressedFixture(null);
  t.onUpdate(t);
  assert.ok(t.mipmaps[0].data, 'kept');
  assert.equal(t.source.dataReady, true);
});

test('textureBytes: compressed = 16 bytes per 4×4 block per level (× layers)', () => {
  const t = compressedFixture(null);
  assert.equal(textureBytes(t), blockBytes(8, 8) + blockBytes(4, 4) + blockBytes(2, 2) + blockBytes(1, 1));
  const plain = new THREE.Texture({ width: 8, height: 8 });
  assert.equal(textureBytes(plain), 8 * 8 * 4 * 4 / 3);
});

test('glTF colour spaces: base colour / emissive / specular colour are sRGB, the rest linear, shared both ways → mixed', () => {
  const json = { materials: [
    { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 2 }, occlusionTexture: { index: 1 }, emissiveTexture: { index: 3 } },
    { extensions: { KHR_materials_specular: { specularColorTexture: { index: 4 }, specularTexture: { index: 5 } } } },
    { pbrMetallicRoughness: { baseColorTexture: { index: 6 } }, normalTexture: { index: 6 } },
  ] };
  const cs = gltfColorSpaces(json);
  assert.equal(cs.get(0), THREE.SRGBColorSpace);
  assert.equal(cs.get(1), THREE.NoColorSpace);
  assert.equal(cs.get(2), THREE.NoColorSpace);
  assert.equal(cs.get(3), THREE.SRGBColorSpace);
  assert.equal(cs.get(4), THREE.SRGBColorSpace);
  assert.equal(cs.get(5), THREE.NoColorSpace);
  assert.equal(cs.get(6), 'mixed');
  assert.equal(cs.get(7), undefined);
});

test('shadow map: one-byte colour attachment and a 16-bit depth texture', () => {
  const shadow = new THREE.DirectionalLight().shadow;
  slimShadowMap(shadow);
  shadow.map = new THREE.WebGLRenderTarget(64, 64);
  shadow.map.depthTexture = new THREE.DepthTexture(64, 64, THREE.UnsignedIntType); // what three's WebGLShadowMap does
  assert.equal(shadow.map.texture.format, THREE.RedFormat);
  assert.equal(shadow.map.depthTexture.type, THREE.UnsignedShortType);
  assert.equal(shadow.map.depthTexture.renderTarget, shadow.map, 'the RenderTarget accessor still runs');
  const vsm = new THREE.DepthTexture(64, 64, THREE.FloatType);
  const rt2 = new THREE.WebGLRenderTarget(64, 64); shadow.map = rt2; shadow.map.depthTexture = vsm;
  assert.equal(vsm.type, THREE.FloatType, 'other depth types are left alone');
});

test('shadow map: its unused colour attachment is detached and freed once three set the target up', () => {
  const calls = [], props = new WeakMap(), FB = { fb: 1 }, TEX = { tex: 1 };
  let status = 0x8CD5; // FRAMEBUFFER_COMPLETE
  const gl = {
    FRAMEBUFFER: 0x8D40, COLOR_ATTACHMENT0: 0x8CE0, TEXTURE_2D: 0x0DE1, FRAMEBUFFER_COMPLETE: 0x8CD5,
    isContextLost: () => false, bindFramebuffer: (...a) => calls.push(['bind', ...a]), checkFramebufferStatus: () => status,
    framebufferTexture2D: (...a) => calls.push(['attach', a[3]]), deleteTexture: (t) => calls.push(['delete', t]),
  };
  const R = { getContext: () => gl, properties: { get: (o) => { if (!props.has(o)) props.set(o, {}); return props.get(o); } }, resetState: () => calls.push(['reset']) };
  const shadow = new THREE.DirectionalLight().shadow;
  assert.equal(dropShadowColour(R, shadow), false, 'no map yet');
  shadow.map = new THREE.WebGLRenderTarget(64, 64); shadow.map.depthTexture = new THREE.DepthTexture(64, 64);
  assert.equal(dropShadowColour(R, shadow), false, 'not set up by three yet');
  R.properties.get(shadow.map).__webglFramebuffer = FB; R.properties.get(shadow.map.texture).__webglTexture = TEX;
  assert.equal(dropShadowColour(R, shadow), true);
  assert.deepEqual(calls.filter((c) => c[0] !== 'bind'), [['attach', null], ['delete', TEX], ['reset']]);
  assert.equal(R.properties.get(shadow.map.texture).__webglTexture, undefined);
  assert.equal(dropShadowColour(R, shadow), false, 'once per framebuffer');
  // a new framebuffer (resized map, restored context) whose depth-only form would be incomplete: kept as it is
  calls.length = 0; status = 0x8CD6;
  R.properties.get(shadow.map).__webglFramebuffer = { fb: 2 }; R.properties.get(shadow.map.texture).__webglTexture = TEX;
  assert.equal(dropShadowColour(R, shadow), false);
  assert.deepEqual(calls.filter((c) => c[0] === 'attach'), [['attach', null], ['attach', TEX]]);
  assert.ok(!calls.some((c) => c[0] === 'delete'));
});

test('post targets holding 0..1 factors go 8-bit (SMAA edges / weights, GTAO)', () => {
  const a = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }), b = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType });
  eightBitTargets(a, b, null);
  assert.equal(a.texture.type, THREE.UnsignedByteType);
  assert.equal(b.texture.type, THREE.FloatType, 'only half floats are touched');
});
