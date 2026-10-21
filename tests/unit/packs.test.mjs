/**
 * Mission packs + audio sprites (tools/packs/build-packs.mjs, src/engine/mission-pack.js, src/audio/sprite-source.js):
 * the ZIP writer's index must slice byte-exact copies out of the archive (that contract is all the runtime uses),
 * the sprite source must serve exact clip bytes and miss cleanly, and the audio engine must consult sprites
 * before fetching. When real packs are built in assets/packs/, their indexes are cross-checked against the
 * source files on disk; without them those cases pass vacuously (packs are build artifacts, not fixtures).
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { crc32, writeZip, planParts, PART_MAX } from '../../tools/packs/build-packs.mjs';
import { SpriteSource } from '../../src/audio/sprite-source.js';
import { openMissionPack } from '../../src/engine/mission-pack.js';
import { AudioEngine } from '../../src/audio/engine.js';
import { MockAudioContext } from './audio-mock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('packs: crc32 matches the ZIP check vector', () => {
  assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('packs: writeZip index slices byte-exact entries out of a valid stored ZIP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-pack-'));
  const file = join(dir, 't.zip');
  const big = new Uint8Array(200_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31 + (i >> 8)) & 0xff;
  const entries = [
    { name: 'assets/audio/sfx/a.ogg', data: Buffer.from([1, 2, 3, 4]) },
    { name: 'assets/models/big.glb', data: Buffer.from(big) },
    { name: 'assets/empty.bin', data: Buffer.alloc(0) },
  ];
  const index = await writeZip(file, entries);
  const zip = readFileSync(file);
  assert.equal(index.length, 3);
  for (let i = 0; i < entries.length; i++) {
    const [name, off, size] = index[i];
    assert.equal(name, entries[i].name);
    assert.equal(size, entries[i].data.length);
    assert.deepEqual(new Uint8Array(zip.subarray(off, off + size)), new Uint8Array(entries[i].data), `entry ${name} slices byte-exact`);
    // a real ZIP reader finds the local header just before the data: sig + name
    const lh = off - 30 - Buffer.byteLength(name);
    assert.equal(zip.readUInt32LE(lh), 0x04034b50, 'local header signature');
    assert.equal(zip.readUInt32LE(off + size === zip.length ? 0 : lh + 14), crc32(entries[i].data), 'crc in local header');
  }
  const eo = zip.length - 22;
  assert.equal(zip.readUInt32LE(eo), 0x06054b50, 'end-of-central-directory signature');
  assert.equal(zip.readUInt16LE(eo + 10), 3, 'central directory entry count');
});

test('packs: planParts keeps every part under the per-file ceiling', () => {
  assert.ok(PART_MAX < 50e6, 'part cap respects the repo 50 MB rule');
  assert.deepEqual(planParts([30e6, 30e6, 30e6], 44e6), [[0], [1], [2]]);
  assert.deepEqual(planParts([10e6, 10e6, 10e6, 10e6, 10e6], 44e6), [[0, 1, 2, 3], [4]]);
  assert.deepEqual(planParts([60e6, 1e6], 44e6), [[0], [1]], 'an oversize entry goes alone, never split');
  assert.deepEqual(planParts([], 44e6), []);
});

test('packs: openMissionPack outside a browser resolves null without probing', async () => {
  // node has no window.fetch to wrap: the loader must stay out of the way entirely (dev fallback contract)
  assert.equal(await openMissionPack('m03', 'high'), null);
});

test('sprites: bytes() serves exact clip slices, misses unknown clips and unloaded groups', async () => {
  const sfx = new Uint8Array([10, 11, 12, 13, 14]).buffer; // clip a = [10,11,12], clip b = [13,14]
  const idx = {
    sprites: { sfx: { file: 'x-sfx.sprite', bytes: 5, clips: 2 }, voice: { file: 'x-voice.sprite', bytes: 2, clips: 1 } },
    entries: { 'sfx/a.ogg': ['sfx', 0, 3], 'sfx/b.ogg': ['sfx', 3, 2], 'voice/c.ogg': ['voice', 0, 2] },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('-audio.json')) return { ok: true, json: async () => idx };
    if (String(url).endsWith('x-sfx.sprite')) return { ok: true, arrayBuffer: async () => sfx.slice(0) };
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; // the voice sprite 404s
  };
  try {
    const s = new SpriteSource();
    assert.equal(await s.open('mX', 'high'), true, 'one loaded group is enough');
    assert.deepEqual(new Uint8Array(s.bytes('sfx/a.ogg')), new Uint8Array([10, 11, 12]));
    assert.deepEqual(new Uint8Array(s.bytes('sfx/b.ogg')), new Uint8Array([13, 14]));
    assert.equal(s.bytes('voice/c.ogg'), null, 'a group that failed to load misses, clip falls back to fetch');
    assert.equal(s.bytes('sfx/nope.ogg'), null, 'an unlisted clip misses');
    assert.equal(s.hits, 2);
    assert.equal(s.misses, 2);
    // the returned bytes are a copy: mutating them must not corrupt the sprite
    const got = s.bytes('sfx/a.ogg');
    new Uint8Array(got)[0] = 99;
    assert.deepEqual(new Uint8Array(s.bytes('sfx/a.ogg')), new Uint8Array([10, 11, 12]));
  } finally { globalThis.fetch = realFetch; }
});

test('sprites: the audio engine decodes and packs from sprites without fetching', async () => {
  const ctx = new MockAudioContext();
  ctx.decodeAudioData = async (ab) => ({ duration: ab.byteLength / 1000, byteLength: ab.byteLength });
  let fetches = 0;
  const fetchStub = async () => { fetches++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(7000) }; };
  const eng = new AudioEngine(ctx, { fetch: fetchStub, jitter: false });
  const clip = new Uint8Array(4000).buffer;
  eng.sprites = { hits: 0, misses: 0, bytes: (u) => (u === 'sfx/hit.ogg' ? clip.slice(0) : null) };
  const buf = await eng._fetchDecode('sfx/hit.ogg');
  assert.ok(buf, 'decoded from the sprite');
  assert.equal(buf.byteLength, 4000);
  assert.equal(fetches, 0, 'no fetch for a sprite-held clip');
  const buf2 = await eng._fetchDecode('sfx/other.ogg');
  assert.ok(buf2, 'a sprite miss still decodes');
  assert.equal(fetches, 1, 'a sprite miss falls back to fetch');
  await eng._pack('sfx/hit.ogg');
  assert.equal(eng.packed.get('sfx/hit.ogg')?.byteLength, 4000, '_pack keeps the sprite bytes');
  assert.equal(fetches, 1, '_pack of a sprite-held clip does not fetch');
});

test('packs: built m03 artifacts (when present) slice back to the source files', () => {
  const idxPath = join(ROOT, 'assets/packs/high-m03.json');
  if (!existsSync(idxPath)) return; // packs are build artifacts; a fresh clone has none
  const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
  const partBufs = idx.parts.map((n) => readFileSync(join(ROOT, 'assets/packs', n)));
  for (const b of partBufs) assert.ok(b.length < 50e6, 'every pack part under the 50 MB Pages rule');
  assert.equal(idx.entries.length, idx.files);
  for (const i of [0, 1, Math.floor(idx.files / 2), idx.files - 1]) {
    const [p, part, off, size] = idx.entries[i];
    assert.deepEqual(new Uint8Array(partBufs[part].subarray(off, off + size)), new Uint8Array(readFileSync(join(ROOT, p))), `pack slice == source ${p}`);
  }
  const aIdx = JSON.parse(readFileSync(join(ROOT, 'assets/packs/high-m03-audio.json'), 'utf8'));
  const keys = Object.keys(aIdx.entries);
  assert.ok(keys.length > 500, `m03 sprite index covers its clips (${keys.length})`);
  const groups = {};
  for (const k of [keys[0], keys[keys.length - 1]]) {
    const [g, off, len] = aIdx.entries[k];
    groups[g] ??= readFileSync(join(ROOT, 'assets/packs', aIdx.sprites[g].file));
    assert.deepEqual(new Uint8Array(groups[g].subarray(off, off + len)), new Uint8Array(readFileSync(join(ROOT, 'assets/audio', k))), `sprite slice == source ${k}`);
  }
});
