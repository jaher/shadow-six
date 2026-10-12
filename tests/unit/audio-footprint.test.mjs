/**
 * Audio footprint (tools/audio/web_formats.py, audio/formats.js, audio/music-stream.js, engine lazy decoding):
 * one format per browser and no unused duplicate in the build; streamed music that holds a few chunks, loops
 * seamlessly and keeps its timeline; lazily decoded takes (deferred start, late one-shots dropped, LRU budget);
 * near-mono takes kept as one channel and played as two equal ones.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, near } from './lib.mjs';
import { MockAudioContext } from './audio-mock.mjs';
import { isWebKit, prefersOpus, pickAudio, aacTwin, setAudioExt, audioExt } from '../../src/audio/formats.js';
import { ChunkCue, StreamVoice, STREAM_AHEAD } from '../../src/audio/music-stream.js';
import { AudioEngine, LATE_DROP, lazySfx } from '../../src/audio/engine.js';
import { missionUrls } from '../../src/engine/offline-cache.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../assets/audio');
const walk = (d, rel = '') => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name), `${rel}${f.name}/`) : [`${rel}${f.name}`]));
const UA = {
  safari: { vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' },
  ipad: { vendor: 'Apple Computer, Inc.', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' },
  iosChrome: { vendor: 'Apple Computer, Inc.', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1' },
  chrome: { vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
  android: { vendor: 'Google Inc.', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' },
  firefox: { vendor: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0' },
};

test('formats: WebKit (Safari, every iOS browser, iPadOS) gets AAC, the others Opus; one file per sound', () => {
  for (const k of ['safari', 'ipad', 'iosChrome']) assert.equal(isWebKit(UA[k]), true, k);
  for (const k of ['chrome', 'android', 'firefox']) assert.equal(isWebKit(UA[k]), false, k);
  const Opus = class { canPlayType(t) { return /opus/.test(t) ? 'probably' : ''; } };
  const NoOpus = class { canPlayType() { return ''; } };
  assert.equal(prefersOpus(UA.chrome, Opus), true);
  assert.equal(prefersOpus(UA.safari, Opus), false, 'Safari reports Opus but decodes it unevenly: AAC');
  assert.equal(prefersOpus(UA.firefox, NoOpus), false, 'no Opus → AAC');
  setAudioExt('.m4a');
  assert.equal(pickAudio(['a/x.ogg', 'a/x.m4a'], 'sfx/'), 'sfx/a/x.m4a');
  setAudioExt('.ogg');
  assert.equal(pickAudio(['a/x.ogg', 'a/x.m4a'], 'sfx/'), 'sfx/a/x.ogg');
  assert.equal(aacTwin('voice/a.ogg'), 'voice/a.m4a');
  // the next-mission prefetch (service worker) downloads the client's format only
  const L = { presets: { high: { m01: ['assets/audio/sfx/a.ogg', 'assets/models/b.glb'] } } };
  setAudioExt('.m4a');
  assert.deepEqual(missionUrls(L, 'm01', 'high', 'https://x/'), ['https://x/assets/audio/sfx/a.m4a', 'https://x/assets/models/b.glb']);
  setAudioExt('.ogg');
  assert.deepEqual(missionUrls(L, 'm01', 'high', 'https://x/'), ['https://x/assets/audio/sfx/a.ogg', 'https://x/assets/models/b.glb']);
  assert.equal(audioExt(), '.ogg');
});

test('build: no duplicate formats — exactly one Opus and one AAC file per sound, no MP3, nothing unreferenced', () => {
  const files = walk(ROOT).filter((f) => /\.(ogg|m4a|mp3|wav|flac|aac|opus|webm)$/i.test(f));
  assert.deepEqual(files.filter((f) => !/\.(ogg|m4a)$/.test(f)), [], 'only .ogg (Opus) and .m4a (AAC)');
  const refs = new Set();
  const sfx = JSON.parse(readFileSync(join(ROOT, 'sfx/manifest.json'), 'utf8'));
  for (const s of sfx.sounds) for (const f of s.files) refs.add(`sfx/${f}`);
  const vox = JSON.parse(readFileSync(join(ROOT, 'voice/lines.json'), 'utf8'));
  for (const l of vox.lines) for (const f of [...(l.files || []), ...(l.alt || [])]) refs.add(`voice/${f}`);
  const nar = JSON.parse(readFileSync(join(ROOT, 'narration/manifest.json'), 'utf8'));
  for (const m of [...Object.values(nar.missions), nar.tour]) for (const l of m.lines) for (const f of l.files) refs.add(f);
  const mus = JSON.parse(readFileSync(join(ROOT, 'music/manifest.json'), 'utf8'));
  for (const c of Object.values(mus.cues)) for (const x of [...c.chunks, ...(c.wrap ? [c.wrap] : [])]) for (const e of ['.ogg', '.m4a']) refs.add(`music/${x.f}${e}`);
  assert.deepEqual(files.filter((f) => !refs.has(f)), [], 'every audio file is referenced by a manifest');
  const stems = new Map();
  for (const f of files) stems.set(f.slice(0, -4), (stems.get(f.slice(0, -4)) || 0) + 1);
  assert.deepEqual([...stems].filter(([, n]) => n !== 2).map(([s]) => s), [], 'each sound: its Opus file and its AAC twin');
  // what one client downloads: one of the two sets
  const set = (ext) => files.filter((f) => f.endsWith(ext)).reduce((a, f) => a + statSync(join(ROOT, f)).size, 0) / 1e6;
  assert.ok(set('.ogg') < 50, `Opus set ${set('.ogg').toFixed(1)} MB`);
  assert.ok(set('.m4a') < 65, `AAC set ${set('.m4a').toFixed(1)} MB`);
});

/** A streamed cue on the mock context: chunks of `d` s, an intro / loop body / tail, decoded on demand. */
function rig({ len = 40, loopStart = 8, loopEnd = 32, d = 8, o = 0.1, s = 0.4 } = {}) {
  const ctx = new MockAudioContext();
  const edges = [];
  for (const [a, b] of [[0, loopStart], [loopStart, loopEnd], [loopEnd, len]]) { const k = Math.max(1, Math.round((b - a) / d)); for (let i = 0; i < k; i++) edges.push([a + (b - a) * i / k, a + (b - a) * (i + 1) / k]); }
  const chunks = edges.map(([a, b], k) => ({ f: `c/${k}`, t: a, d: b - a, o: k < edges.length - 1 ? o : 0 }));
  const kLast = chunks.findIndex((c) => Math.abs(c.t + c.d - loopEnd) < 1e-9);
  const wrap = { k: kLast, f: `c/${kLast}w`, s, o };
  const loads = [];
  const load = async (f) => {
    loads.push(f);
    const c = f.endsWith('w') ? { d: s, o } : chunks[+f.split('/')[1]];
    return ctx.createBuffer(2, Math.round((c.d + c.o) * 32000), 32000);
  };
  const cue = new ChunkCue({ id: 'c', chunks, wrap, meta: { loopStart, loopEnd, lengthSec: len }, load });
  return { ctx, cue, chunks, wrap, loads };
}
const tick = () => new Promise((ok) => setTimeout(ok, 0));

test('music stream: chunks back to back on the context clock, crossfaded over their overlap, the whole cue played once', async () => {
  const { ctx, cue, chunks } = rig();
  assert.ok(await cue.prefetch(0));
  const v = new StreamVoice(ctx, cue, { at: 1, offset: 0, loop: false });
  let ended = false;
  v.onended = () => { ended = true; };
  for (let t = 0; t < 45; t += 0.25) { ctx.currentTime = t; v.pump(); await tick(); }
  const srcs = ctx.started.filter((x) => x.kind === 'source');
  assert.equal(srcs.length, chunks.length, 'each chunk once');
  srcs.forEach((x, k) => {
    near(x.started, 1 + chunks[k].t, 1e-9, `chunk ${k} start`);
    near(x.offset, 0, 1e-9);
    const g = x.outputs[0].gain.events; // fade in over the previous overlap, fade out over its own
    if (k > 0) assert.ok(g.some((e) => e[0] === 'ramp' && e[1] === 1 && Math.abs(e[2] - (1 + chunks[k].t + chunks[k - 1].o)) < 1e-9), `chunk ${k} fades in`);
    if (chunks[k].o) assert.ok(g.some((e) => e[0] === 'ramp' && e[1] === 0 && Math.abs(e[2] - (1 + chunks[k].t + chunks[k].d + chunks[k].o)) < 1e-9), `chunk ${k} fades out`);
  });
  for (const x of srcs) x.onended?.();
  assert.ok(ended, 'onended after the last chunk');
});

test('music stream: a loop goes intro → body → seam → body, sample for sample, holding a few chunks at a time', async () => {
  const { ctx, cue, chunks, wrap } = rig({ len: 60, loopStart: 8, loopEnd: 48 });
  assert.ok(await cue.prefetch(0));
  const v = new StreamVoice(ctx, cue, { at: 0, offset: 0, loop: true });
  cue.unpin(0); // as the director does once a bed has started
  let maxHeld = 0;
  const live = new Set();
  for (let t = 0; t < 130; t += 0.25) {
    ctx.currentTime = t;
    for (const x of ctx.started) if (x.kind === 'source' && !x._done && x.started + x.buffer.duration < t) { x._done = true; x.onended?.(); }
    v.pump(); await tick();
    for (const x of ctx.started) if (!x._done) live.add(x);
    maxHeld = Math.max(maxHeld, cue.bytes());
  }
  const srcs = ctx.started.filter((x) => x.kind === 'source');
  const files = srcs.map((x) => x.buffer.duration);
  // timeline: every source starts where the music it plays belongs (cue time → context time, loops add the body length)
  const body = 48 - 8;
  const seam = srcs.filter((x) => Math.abs(x.buffer.duration - (wrap.s + wrap.o)) < 1e-6);
  assert.ok(seam.length >= 2, `the seam plays at every pass (${seam.length})`);
  seam.forEach((x, i) => near(x.started, 48 - wrap.s + i * body, 1e-9, `seam ${i}`));
  const firstBody = srcs.filter((x) => Math.abs(x.started - (8 + body)) < 1e-9);
  assert.equal(firstBody.length, 1, 'the body starts again exactly one body length later');
  assert.ok(!srcs.some((x) => x.started > 48 - wrap.s + 1e-6 && x.started < 48 + body - wrap.s - 1e-6 && Math.abs(x.buffer.duration - (chunks.at(-1).d)) < 1e-6),
    'the tail never plays while looping');
  const chunkBytes = 8 * 32000 * 2 * 4;
  assert.ok(maxHeld <= 3.2 * chunkBytes, `about three 8 s chunks decoded at most (${(maxHeld / chunkBytes).toFixed(2)}); STREAM_AHEAD ${STREAM_AHEAD} s`);
  assert.ok(files.length > chunks.length);
  v.stop(ctx.currentTime);
});

test('music stream: a chunk that decodes late keeps the timeline (joins mid-chunk, short fade), never shifts the music', async () => {
  const { ctx, cue, chunks } = rig();
  let release = null;
  const slow = cue.load;
  cue.load = (f) => (f === 'c/1' ? new Promise((ok) => { release = () => ok(slow(f)); }) : slow(f));
  assert.ok(await cue.prefetch(0));
  const v = new StreamVoice(ctx, cue, { at: 0, offset: 0 });
  ctx.currentTime = 0.5; v.pump(); await tick();
  ctx.currentTime = chunks[1].t + 1.0; // a stall: chunk 1 should have started a second ago
  release(); await tick(); await tick();
  v.pump(); // the next frame / timer tick after the stall
  const s1 = ctx.started.filter((x) => x.kind === 'source')[1];
  assert.ok(s1, 'chunk 1 scheduled once decoded');
  near(s1.started - s1.offset, chunks[1].t, 0.02, 'context time − offset = the chunk\'s place on the timeline');
});

test('engine: lazy takes start when decoded; a one-shot later than LATE_DROP is dropped; the lazy set stays within its budget', async () => {
  const ctx = new MockAudioContext();
  let gate = null;
  ctx.decodeAudioData = (ab) => new Promise((ok) => { gate = () => ok(ctx.createBuffer(1, ab.byteLength, 48000)); });
  const fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(48000 * 2) });
  const eng = new AudioEngine(ctx, { fetch, lazyBudget: 48000 * 4 * 5, media: null });
  eng.applyManifests({ sfx: { sounds: [
    { category: 'tank_engine', mode: 'loop', files: ['t/a.ogg', 't/a.m4a'], duration: 8 },
    { category: 'siren_airraid', mode: 'long', files: ['s/a.ogg', 's/a.m4a'], duration: 30 },
    { category: 'rifle_m1', mode: 'shot', files: ['r/a.ogg', 'r/a.m4a'], duration: 1 },
  ] } });
  assert.ok(lazySfx(eng.meta.get('sfx/t/a.ogg')) && lazySfx(eng.meta.get('sfx/s/a.ogg')) && !lazySfx(eng.meta.get('sfx/r/a.ogg')), 'loops / sirens lazy, shots instant');
  const h = eng.play('tank_engine', { loop: true });
  assert.ok(h?.deferred && !h.real, 'deferred handle');
  h.setGain(0.3);
  await tick(); gate(); await tick(); await tick();
  assert.ok(h.real && !h.ended && h.real.base === 0.3, 'started once decoded, with the gain set meanwhile (as setGain on a live handle)');
  // a one-shot whose decode finishes too late is dropped (no late gunshot)
  eng.decoded.clear(); eng.lazy.clear();
  const r = eng.play('rifle_shot', {});
  assert.ok(r?.deferred);
  ctx.currentTime += LATE_DROP.sfx + 0.1;
  await tick(); gate(); await tick(); await tick();
  assert.ok(r.ended && r.dropped && !r.real, 'late one-shot dropped');
  // LRU: the oldest lazy take goes beyond the budget
  ctx.decodeAudioData = async (ab) => ctx.createBuffer(1, 48000 * 3, 48000);
  await eng._decode('sfx/t/a.ogg', { lazy: true });
  ctx.currentTime += 1;
  await eng._decode('sfx/s/a.ogg', { lazy: true });
  assert.ok(!eng.decoded.has('sfx/t/a.ogg') && eng.decoded.has('sfx/s/a.ogg'), 'least recently used evicted');
  assert.ok(eng.memory().lazyBytes <= eng.lazyBudget);
});

test('engine: a near-mono stereo take keeps one channel, played as two equal channels (same panning as before)', async () => {
  const ctx = new MockAudioContext();
  ctx.decodeAudioData = async () => { const b = ctx.createBuffer(2, 4800, 48000); b.getChannelData = () => new Float32Array(4800).fill(0.5); return b; };
  const fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
  const eng = new AudioEngine(ctx, { fetch, media: null });
  eng.applyManifests({ sfx: { sounds: [{ category: 'rifle_m1', mode: 'shot', files: ['r/a.ogg', 'r/a.m4a'], duration: 0.1, mono: true }] } });
  const b = await eng._decode('sfx/r/a.ogg');
  assert.equal(b.numberOfChannels, 1, 'one channel decoded');
  const h = eng.play('rifle_shot', { pos: { x: 5, z: 0 }, buffer: b });
  assert.equal(h.gainNode.channelCount, 2);
  assert.equal(h.gainNode.channelCountMode, 'explicit', 'up-mixed to stereo before the panner');
});

test('per-mission budget: every mission decodes at most 44 MB of SFX + voices up front (desktop rate), the rest on demand', async () => {
  const { MISSIONS } = await import('../../src/missions/index.js');
  const { missionAudio } = await import('../../src/audio/event-map.js');
  const sfx = JSON.parse(readFileSync(join(ROOT, 'sfx/manifest.json'), 'utf8'));
  const voice = JSON.parse(readFileSync(join(ROOT, 'voice/lines.json'), 'utf8'));
  // fake decoder: the fetched bytes name the file; the buffer gets that file's length and channels (manifest)
  const info = new Map();
  for (const s of sfx.sounds) info.set(`sfx/${s.files[0]}`, { d: s.duration || 0.5, ch: s.mode === 'shot' || s.mono ? 1 : 2, sr: 48000 });
  for (const l of voice.lines) for (const f of [...(l.files || []), ...(l.alt || [])].filter((x) => x.endsWith('.ogg'))) info.set(`voice/${f}`, { d: l.duration || 1, ch: 1, sr: 32000 });
  const urls = [...info.keys()];
  const ctx = new MockAudioContext();
  ctx.decodeAudioData = async (ab) => { const x = info.get(urls[ab.byteLength - 1]); return ctx.createBuffer(x.ch, Math.round(x.d * x.sr), x.sr); };
  const fetch = async (u) => { const k = urls.indexOf(u.replace(/^assets\/audio\//, '')); return k < 0 ? { ok: false } : { ok: true, arrayBuffer: async () => new ArrayBuffer(k + 1) }; };
  setAudioExt('.ogg');
  const eng = new AudioEngine(ctx, { fetch, base: 'assets/audio/', rand: () => 0.3, media: () => ({}) });
  eng.applyManifests({ sfx, voice });
  const rows = [];
  for (const def of MISSIONS) {
    const { ids, speakers } = missionAudio(def);
    const m = await eng.preload(ids, { speakers });
    rows.push(`${def.id} ${(m.bytes / 1048576).toFixed(1)} MB (${m.buffers} takes, ${(m.packedBytes / 1048576).toFixed(1)} MB kept compressed)`);
    assert.ok(m.bytes < 44 * 1048576, `${def.id}: ${(m.bytes / 1048576).toFixed(1)} MB decoded at load (was 110–120 MB with every take decoded)`);
    assert.equal(m.lazyBytes, 0, 'nothing lazy decoded before it is played');
  }
  console.log(`      instant set per mission: ${rows.join('; ')}`);
});

test('engine: a positional loop of bed takes (the M3 dam\'s falling water) streams through a media element, never decoded', async () => {
  const ctx = new MockAudioContext();
  ctx.createMediaElementSource = (el) => { const n = ctx.createGain(); n.kind = 'media'; n.el = el; return n; };
  ctx.createBiquadFilter = () => { const n = ctx.createGain(); n.kind = 'lp'; n.frequency = { value: 0 }; n.Q = { value: 0 }; return n; };
  let decodes = 0;
  ctx.decodeAudioData = async () => { decodes++; return ctx.createBuffer(2, 48000, 48000); };
  const media = () => ({ src: '', paused: true, addEventListener() {}, play() { this.paused = false; return Promise.resolve(); }, pause() {}, removeAttribute() {}, load() {} });
  const eng = new AudioEngine(ctx, { fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }), media });
  eng.applyManifests({ sfx: { sounds: [{ category: 'river', mode: 'bed', files: ['river/r.ogg', 'river/r.m4a'], duration: 24 }] } });
  await eng.preload(['waterfall']);
  assert.equal(decodes, 0, 'not decoded at mission load');
  const h = eng.play('waterfall', { pos: { x: 10, z: 0 }, loop: true, bus: 'ambience' });
  assert.ok(h?.stream && /river\/r\.ogg$/.test(h.stream.src), 'streamed');
  assert.ok(h.panNode && h.lpNode && h.pos, 'positional: panned and air-filtered like a decoded voice');
  near(h.panNode.pan.value, h.applied.pan, 1e-9);
  assert.equal(decodes, 0);
});
