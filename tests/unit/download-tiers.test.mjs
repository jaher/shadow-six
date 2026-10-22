/**
 * perf/download-speed-2 — what a mission downloads before its briefing:
 *  - character body GLBs embed half-size atlases; the originals sit in hd/ (tools/perf/char_tex_tiers.py via
 *    tools/perf/glb_gzip.mjs) and replace them in place after the loading screen (engine/hd-textures.js);
 *  - downloads that wait for the loading screen (engine/post-load.js): the spoken lines / loops (audio engine
 *    preload({packAfter}), prefetchUrls({lazy})) and the portraits' talking clips (TalkingPortraits.preloadFiles parts).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { glbJson, readGlb } from '../../tools/glb-io.mjs';
import { registerHdTexture, startHdTextures, hdTexturesIdle, pendingHdTextures, resetHdTextures, hdTextureStats } from '../../src/engine/hd-textures.js';
import { afterLoadScreen, loadScreenUp, loadScreenDown, isLoadScreenDown, loadGeneration } from '../../src/engine/post-load.js';
import { TalkingPortraits } from '../../src/ui/talking-portraits.js';
import { AudioEngine } from '../../src/audio/engine.js';
import { missionAudio } from '../../src/audio/event-map.js';
import { setAudioExt } from '../../src/audio/formats.js';
import { MockAudioContext } from './audio-mock.mjs';
import { MISSIONS } from '../../src/missions/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CH = join(ROOT, 'assets/characters');

/** Width / height of a JPEG from its SOF marker. */
function jpegSize(b) {
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

test('char tiers: every body GLB embeds half-size atlases and names its HD originals (hd/, recorded size)', () => {
  let n = 0;
  for (const g of ['enemies', 'commandos', 'guests']) {
    for (const f of readdirSync(join(CH, g)).filter((x) => x.endsWith('.glb'))) {
      const path = join(CH, g, f);
      const b = readGlb(path), j = glbJson(b);
      const bin = b.subarray(20 + b.readUInt32LE(12) + 8);
      const atlas = (j.textures || []).map((t) => ({ t, im: j.images[t.source] })).filter(({ im }) => /_(albedo|normal|orm)$/.test(im.name || ''));
      if (f === 'colonel_bust.glb') { assert.ok(atlas.every(({ t }) => !t.extras?.hd), 'the briefing bust keeps its full atlas'); continue; }
      assert.equal(atlas.length, 3, `${g}/${f}: albedo, normal, ORM`);
      for (const { t, im } of atlas) {
        assert.ok(t.extras?.hd && Array.isArray(t.extras.hdSize), `${g}/${f} ${im.name}: extras.hd`);
        const hd = join(CH, g, t.extras.hd);
        assert.ok(existsSync(hd), `${hd} exists`);
        assert.deepEqual(jpegSize(readFileSync(hd)), t.extras.hdSize, `${t.extras.hd} is ${t.extras.hdSize}`);
        const bv = j.bufferViews[im.bufferView];
        const emb = jpegSize(bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
        assert.deepEqual(emb, t.extras.hdSize.map((v) => v / 2), `${g}/${f} ${im.name}: embedded at half size`);
      }
      n++;
    }
  }
  assert.ok(n >= 115, `${n} body GLBs`);
});

test('hd-textures: registered textures upgrade after the loading screen, in order, in place (same Texture object)', async () => {
  resetHdTextures();
  loadScreenUp();
  const mk = (w) => { const t = new THREE.Texture({ width: w, height: w }); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const base = 'https://x/assets/characters/';
  const a = mk(512), b = mk(512), c = mk(256), d = mk(512);
  registerHdTexture(a, base + 'enemies/hd/winter_v00_normal.jpg', { size: [1024, 1024] });
  registerHdTexture(b, base + 'commandos/hd/spy_orm.jpg', { size: [1024, 1024] });
  registerHdTexture(c, base + 'enemies/hd/winter_v00_albedo.jpg', { size: [512, 512] });
  registerHdTexture(d, base + 'commandos/hd/spy_albedo.jpg', { size: [1024, 1024] });
  registerHdTexture(d, base + 'commandos/hd/spy_albedo.jpg', { size: [1024, 1024] }); // twice: once
  assert.deepEqual(pendingHdTextures().map((u) => u.slice(base.length)), ['commandos/hd/spy_albedo.jpg', 'commandos/hd/spy_orm.jpg', 'enemies/hd/winter_v00_albedo.jpg', 'enemies/hd/winter_v00_normal.jpg'],
    'commandos before enemies; albedo, normal, ORM');
  const fetched = [];
  const size = (u) => (/winter_v00_albedo/.test(u) ? 512 : 1024);
  let disposed = 0;
  for (const t of [a, b, c, d]) t.addEventListener('dispose', () => disposed++);
  const sources = [a, b, c, d].map((t) => t.source);
  startHdTextures({ deps: { fetch: async (u) => { fetched.push(u); return { size: 10, u }; }, decode: async (blob) => ({ width: size(blob.u), height: size(blob.u) }), idle: async () => {} } });
  await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(fetched.length, 0, 'nothing while the loading screen is up');
  loadScreenDown();
  await hdTexturesIdle();
  assert.equal(fetched.length, 4);
  assert.equal(hdTextureStats.upgraded, 4);
  for (const [i, t] of [a, b, c, d].entries()) {
    assert.notEqual(t.source, sources[i], 'new image source');
    assert.equal(t.image.width, i === 2 ? 512 : 1024);
    assert.ok(t.version > 0, 'uploaded again at its next use');
  }
  assert.equal(disposed, 4, 'each old GPU copy freed once');
  assert.deepEqual(pendingHdTextures(), []);
  resetHdTextures();
});

test('hd-textures: a texture disposed by its owner is dropped; a wrong HD size keeps the embedded image; a new load pauses', async () => {
  resetHdTextures();
  loadScreenUp();
  const t1 = new THREE.Texture({ width: 512, height: 512 }), t2 = new THREE.Texture({ width: 512, height: 512 }), t3 = new THREE.Texture({ width: 512, height: 512 });
  registerHdTexture(t1, 'https://x/a_albedo.jpg', { size: [1024, 1024] });
  registerHdTexture(t2, 'https://x/b_albedo.jpg', { size: [1024, 1024] });
  registerHdTexture(t3, 'https://x/c_albedo.jpg', { size: [1024, 1024] });
  t1.dispose(); // template freed
  assert.deepEqual(pendingHdTextures(), ['https://x/b_albedo.jpg', 'https://x/c_albedo.jpg']);
  const s2 = t2.source;
  let gate = null;
  startHdTextures({ deps: {
    fetch: async (u) => ({ size: 1, u }),
    decode: async (bl) => ({ width: /b_/.test(bl.u) ? 1000 : 1024, height: 1024 }),
    idle: () => new Promise((ok) => { gate = ok; }),
  } });
  loadScreenDown();
  await new Promise((ok) => setTimeout(ok, 5));
  assert.equal(t2.source, s2, 'a size mismatch keeps the embedded image');
  assert.equal(hdTextureStats.failed, 1);
  loadScreenUp(); // a new mission load starts while the upgrades idle
  gate();
  await hdTexturesIdle();
  assert.equal(t3.image.width, 512, 'paused: the load has the link');
  assert.deepEqual(pendingHdTextures(), ['https://x/c_albedo.jpg']);
  loadScreenDown();
  await new Promise((ok) => setTimeout(ok, 5));
  for (let i = 0; i < 5 && t3.image.width !== 1024; i++) { gate?.(); await new Promise((ok) => setTimeout(ok, 5)); await hdTexturesIdle(); }
  assert.equal(t3.image.width, 1024, 'resumed after that load');
  resetHdTextures();
});

test('post-load: work queued during a load runs once the loading screen is down; at once otherwise', () => {
  loadScreenDown();
  const log = [];
  afterLoadScreen(() => log.push('now'));
  assert.deepEqual(log, ['now']);
  const g = loadGeneration();
  loadScreenUp();
  assert.ok(!isLoadScreenDown() && loadGeneration() === g + 1);
  afterLoadScreen(() => log.push('a'));
  afterLoadScreen(() => log.push('b'));
  assert.deepEqual(log, ['now']);
  loadScreenDown();
  loadScreenDown(); // idempotent
  assert.deepEqual(log, ['now', 'a', 'b']);
});

test('portraits: the first set (idle loop + stills) and the rest (talking / flinch clips) partition the preload', () => {
  const man = JSON.parse(readFileSync(join(ROOT, 'assets/portraits/manifest.json'), 'utf8'));
  for (const [c, e] of Object.entries(man.characters)) {
    const all = TalkingPortraits.preloadFiles(e, 'webm'), first = TalkingPortraits.preloadFiles(e, 'webm', 'first'), rest = TalkingPortraits.preloadFiles(e, 'webm', 'rest');
    assert.deepEqual([...first, ...rest].sort(), [...all].sort(), `${c}: first + rest = all`);
    assert.ok(first.includes(e.idle.clip + '.webm') && !rest.some((f) => first.includes(f)), `${c}: idle first, no overlap`);
  }
});

test('audio: prefetchUrls({lazy}) splits the instant set from the takes kept compressed; preload({packAfter}) packs them after it', async () => {
  const A = join(ROOT, 'assets/audio');
  const sfx = JSON.parse(readFileSync(join(A, 'sfx/manifest.json'), 'utf8'));
  const voice = JSON.parse(readFileSync(join(A, 'voice/lines.json'), 'utf8'));
  setAudioExt('.ogg');
  const ctx = new MockAudioContext();
  ctx.decodeAudioData = async () => ctx.createBuffer(1, 4800, 48000);
  const fetched = [];
  const eng = new AudioEngine(ctx, { fetch: async (u) => { fetched.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; }, base: 'assets/audio/', rand: () => 0.3, media: () => ({}) });
  eng.applyManifests({ sfx, voice });
  const { ids, speakers } = missionAudio(MISSIONS.find((m) => m.id === 'm03'));
  const all = eng.prefetchUrls(ids, { speakers }), inst = eng.prefetchUrls(ids, { speakers, lazy: false }), lazy = eng.prefetchUrls(ids, { speakers, lazy: true });
  assert.deepEqual([...inst, ...lazy].sort(), [...all].sort(), 'instant + lazy = all');
  assert.ok(lazy.length > 100 && lazy.every((u) => eng._isLazy(u.slice('assets/audio/'.length))), `${lazy.length} lazy takes`);
  const firstGer = lazy.findIndex((u) => /voice\/german_/.test(u)), lastSquad = lazy.map((u) => /voice\/(?!german_)/.test(u)).lastIndexOf(true);
  assert.ok(firstGer > lastSquad, 'the squad\'s lines before the guards\'');
  let open;
  const gate = new Promise((ok) => { open = ok; });
  await eng.preload(ids, { speakers, packAfter: gate });
  assert.equal(eng.packed.size, 0, 'nothing kept compressed before the gate');
  assert.ok(!fetched.some((u) => lazy.includes(u)), 'no lazy take fetched before the gate');
  assert.ok([...eng.decoded.values()].some((v) => v && v !== 'pending'), 'the instant set is decoded');
  open();
  await eng.packing;
  assert.ok(eng.packed.size > 100, `${eng.packed.size} takes downloaded after the gate`);
});

test('start tiers: a library map loads the smallest copy that covers the default zoom, then its libTier copy', async () => {
  const { useLibDensity, setLibPreset, libTier, libStartTier } = await import('../../src/art/lib-tiers.js');
  const { startDensity, screenDensity } = await import('../../src/engine/texel-budget.js');
  for (const p of ['low', 'medium', 'high']) assert.equal(startDensity(p) * 2, screenDensity(p), `${p}: zoom 1 is half the closest zoom (zoom 2)`);
  useLibDensity({ maps: { 'a_diff.jpg': 600, 'b_diff.jpg': 150, 'c_nor.jpg': 300, 'd_diff.jpg': 100 } });
  setLibPreset('high'); // 120 px/m closest, 60 at zoom 1
  assert.deepEqual(['a_diff.jpg', 'b_diff.jpg', 'c_nor.jpg', 'd_diff.jpg', 'x.jpg'].map((f) => [libTier(f), libStartTier(f)]),
    [['256', '128'], ['1k', '512'], ['512', '256'], ['1k', null], ['1k', null]], 'one tier down when it still clears 60 px/m; unlisted maps stay');
  setLibPreset('low'); // ≤ 512, 80 closest, 40 at zoom 1
  assert.deepEqual(['a_diff.jpg', 'b_diff.jpg', 'd_diff.jpg'].map((f) => [libTier(f), libStartTier(f)]), [['256', '128'], ['512', null], ['512', null]],
    'b: 512 holds 75 texels/m at the 40 px/m of zoom 1 but 256 would hold 37.5: no smaller copy');
  setLibPreset('ultra');
  assert.equal(libStartTier('b_diff.jpg'), null, 'ultra keeps its copy');
  setLibPreset(null);
});

test('start tiers: terrain arrays load at 512 where 512 covers zoom 1 (snow at high), else at their full size', async () => {
  const { terrainTexRes, terrainLoadRes } = await import('../../src/art/terrain.js');
  for (const th of ['temperate', 'snow', 'desert']) for (const q of ['low', 'medium', 'high', 'ultra']) {
    const full = terrainTexRes(q, th), load = terrainLoadRes(q, th);
    assert.ok(load <= full && (load === full || (full === 1024 && load === 512)), `${th} ${q}: ${load} of ${full}`);
  }
  assert.equal(terrainTexRes('high', 'snow'), 1024);
  assert.equal(terrainLoadRes('high', 'snow'), 512, 'snow at high: 512 first');
});

test('vegetation strips: every colour / bark tree strip has its half-size copy (made from this version of it)', () => {
  const T = join(ROOT, 'assets/terrain');
  const rec = JSON.parse(readFileSync(join(T, 'strip-tiers.json'), 'utf8'));
  for (const n of ['foliage', 'bark_albedo', 'bark_normal', 'needles']) {
    const half = join(T, `${n}.half.webp`);
    assert.ok(existsSync(half), `${n}.half.webp`);
    const sha = createHash('sha1').update(readFileSync(join(T, `${n}.webp`))).digest('hex');
    assert.equal(rec[n]?.source, sha, `${n}.half.webp made from this ${n}.webp (node tools/perf/glb_gzip.mjs assets/terrain)`);
    const dim = (b) => { const t = b.toString('latin1', 12, 16); if (t === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; } if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]; return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]; };
    const [w, h] = dim(readFileSync(join(T, `${n}.webp`))), [hw, hh] = dim(readFileSync(half));
    assert.deepEqual([hw, hh], [w / 2, h / 2], `${n}: ${hw}x${hh} is half of ${w}x${h}`);
  }
});

test('vegetation strips: the alpha-tested coverage maps have no half copy (always full size)', () => {
  const T = join(ROOT, 'assets/terrain');
  for (const n of ['foliage_n', 'needles_n']) assert.ok(!existsSync(join(T, `${n}.half.webp`)), `${n}.half.webp must not exist`);
});
