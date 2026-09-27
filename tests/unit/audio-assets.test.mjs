/**
 * Shipped audio assets (realism-pipeline v2 §1.5; tools/audio/build_assets.py): licence gate, credits,
 * size budget, manifest coverage of the §9.3 ids, voice packs matching the subtitle text, per-mission
 * loading (decode + evict + pinning), streamed beds, recorded MG bursts, far explosion layer, voice takes.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { MockAudioContext, EventBus } from './audio-mock.mjs';
import { createAudio } from '../../src/audio/audio.js';
import { AudioEngine } from '../../src/audio/engine.js';
import { SFX } from '../../src/audio/manifest.js';
import { LINES } from '../../src/audio/voice-lines.js';
import { missionAudio } from '../../src/audio/event-map.js';
import M01 from '../../src/missions/m01_baptism_of_fire.js';
import M02 from '../../src/missions/m02_a_quiet_blow_up.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../assets/audio');
const sfxMan = JSON.parse(readFileSync(join(ROOT, 'sfx/manifest.json'), 'utf8'));
const voxMan = JSON.parse(readFileSync(join(ROOT, 'voice/lines.json'), 'utf8'));
const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
const EXCLUDED = [177556, 410442, 387508, 390663]; // §1.5.1 provenance rejects

function du(dir) {
  let n = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) n += f.isDirectory() ? du(join(dir, f.name)) : statSync(join(dir, f.name)).size;
  return n;
}

/** Mock context that can decode (fake PCM sized by the file) and stream through a media element. */
class DecodingContext extends MockAudioContext {
  constructor() { super(); this.decodes = 0; this.streams = []; }
  async decodeAudioData(ab) { this.decodes++; const b = this.createBuffer(1, Math.max(1, ab.byteLength), 48000); return b; }
  createMediaElementSource(el) { const n = this.createGain(); n.kind = 'media'; n.el = el; this.streams.push(el); return n; }
}
class FakeMedia {
  constructor() { this.src = ''; this.paused = true; this.loop = false; }
  addEventListener() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(k) { if (k === 'src') this.src = ''; }
  load() {}
}
const diskFetch = async (url) => {
  const p = join(ROOT, url.replace(/^assets\/audio\//, ''));
  if (!existsSync(p)) return { ok: false, status: 404 };
  const buf = readFileSync(p);
  return { ok: true, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
};

test('licence gate: CC0 / project output only, the §1.5.1 rejects never ship, every source credited', () => {
  assert.ok(sfxMan.sounds.length > 200);
  for (const s of sfxMan.sounds) {
    assert.ok(['CC0-1.0'].includes(s.source.license), `${s.id}: ${s.source.license}`);
    assert.ok(!EXCLUDED.includes(s.source.id), `${s.id} is on the exclusion list`);
    assert.ok(credits.includes(s.source.url), `CREDITS.md lists ${s.source.url}`);
  }
  assert.ok(!sfxMan.sounds.some((s) => /voiceover/.test(s.id)), 'no Kenney announcer voices');
  const root = readFileSync(join(ROOT, '../../CREDITS.md'), 'utf8');
  assert.ok(/assets\/audio\/CREDITS\.md/.test(root), 'root CREDITS.md points at the audio credits');
});

test('files: every sound has an Opus/OGG file and an MP3 twin on disk; total audio ≤ 60 MB', () => {
  for (const s of sfxMan.sounds) {
    assert.ok(s.files.some((f) => f.endsWith('.ogg')) && s.files.some((f) => f.endsWith('.mp3')), `${s.id} ogg + mp3`);
    for (const f of s.files) assert.ok(statSync(join(ROOT, 'sfx', f)).size > 200, f);
  }
  for (const l of voxMan.lines) for (const f of [...l.files, ...(l.alt || []), l.timing]) assert.ok(existsSync(join(ROOT, 'voice', f)), f);
  const listed = new Set(sfxMan.sounds.flatMap((s) => s.files));
  const walk = (d, rel = '') => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name), `${rel}${f.name}/`) : [`${rel}${f.name}`]));
  const stray = walk(join(ROOT, 'sfx')).filter((f) => f !== 'manifest.json' && !listed.has(f));
  assert.deepEqual(stray, [], 'no shipped sfx file outside the manifest');
  const mb = du(ROOT) / 1e6;
  assert.ok(mb <= 60, `assets/audio ${mb.toFixed(1)} MB`);
});

test('coverage: the core §9.3 ids and every theater bed resolve to recorded files', () => {
  const eng = new AudioEngine(new MockAudioContext(), { fetch: null });
  eng.applyManifests({ sfx: sfxMan, voice: voxMan });
  const need = ['rifle_shot', 'pistol_shot', 'sniper_shot', 'smg_burst', 'mg_burst', 'explosion_small', 'explosion_big', 'explosion_far',
    'barrel_explode', 'step_snow', 'step_sand', 'step_grass', 'step_road', 'step_wood', 'crawl_rustle', 'knife_stab', 'body_drop',
    'splash_in', 'siren', 'dog_bark', 'bomb_tick', 'bullet_impact_flesh', 'bullet_impact_metal', 'gate_creak', 'truck_idle', 'tank_engine',
    'boat_engine', 'ui_click', 'knapsack_open', 'wind', 'wind_desert', 'surf', 'river', 'birds', 'crickets'];
  for (const id of need) assert.ok(eng.files.get(id)?.length, `${id} has recorded files`);
  for (const id of ['wind', 'wind_desert', 'surf', 'river', 'birds', 'crickets']) assert.ok(SFX[id].bed, `${id} is a streamed bed`);
});

test('voices: every recorded line in LINES has a take (6 commandos, 3 German voices) and the subtitle text matches', () => {
  const byKey = new Map();
  for (const l of voxMan.lines) {
    const k = `${l.speaker}|${l.rec}`;
    byKey.set(k, [...(byKey.get(k) || []), l]);
    const t = JSON.parse(readFileSync(join(ROOT, 'voice', l.timing), 'utf8'));
    assert.ok(t.visemes?.length && (l.nonverbal || t.words?.length), `${l.timing} has word + viseme timing`);
  }
  for (const [speaker, keys] of Object.entries(LINES)) {
    for (const lines of Object.values(keys)) {
      for (const line of lines) {
        if (!line.rec) continue;
        const takes = byKey.get(`${speaker}|${line.rec}`);
        assert.ok(takes?.length, `${speaker} ${line.rec}`);
        for (const tk of takes) assert.equal(tk.text, line.text, `${speaker} ${line.rec}: subtitle = recording`);
        if (speaker === 'ger') assert.equal(takes.length, 3, `3 German voices for ${line.rec}`);
        else if (line.nonverbal) assert.ok(takes.every((tk) => tk.nonverbal && tk.kind === 'pain_hit'), `${speaker} ${line.rec}: a recorded pain grunt`);
        else assert.ok(takes[0].alt, `${speaker} ${line.rec} has the urgent alt take`);
      }
    }
  }
});

test('per-mission loading: decode only what M1 needs, one siren take, no beds; M2 evicts and adds its boat', async () => {
  const ctx = new DecodingContext();
  const eng = new AudioEngine(ctx, { fetch: diskFetch, base: 'assets/audio/', rand: () => 0.3, media: () => new FakeMedia() });
  await eng.loadManifests();
  const a1 = missionAudio(M01);
  assert.ok(!a1.ids.includes('tank_engine') && !a1.ids.includes('step_sand'), 'no tanks / sand in M1');
  assert.deepEqual(a1.speakers.sort(), ['diver', 'driver', 'ger', 'greenberet']);
  const m1 = await eng.preload(a1.ids, { speakers: a1.speakers });
  const urls = [...eng.decoded.keys()];
  assert.ok(m1.buffers > 50 && m1.buffers === urls.length, `${m1.buffers} buffers`);
  assert.ok(!urls.some((u) => /^sfx\/(wind_|surf|river|birds|crickets|artillery)/.test(u)), `beds are streamed, never decoded (${urls.filter((u) => /^sfx\/(wind_|surf|river|birds|crickets|artillery)/.test(u))})`);
  assert.equal(urls.filter((u) => /^sfx\/siren_/.test(u)).length, 1, 'one siren take pinned for the mission');
  assert.ok(urls.some((u) => u.includes('voice/green_beret/')) && !urls.some((u) => u.includes('voice/sniper/')), 'voice packs of the squad only');
  const a2 = missionAudio(M02);
  await eng.preload(a2.ids, { speakers: a2.speakers });
  const urls2 = [...eng.decoded.keys()];
  assert.ok(urls2.some((u) => /truck_engine/.test(u)), 'M2 patrol boat engine decoded');
  assert.ok(!urls2.some((u) => u.includes('voice/driver/')) || a2.speakers.includes('driver'), 'evicted packs not in M2');
  // beds stream through a media element into the ambience bus
  const h = eng.play('surf', { gain: 0.4, loop: true });
  assert.ok(h.stream && /sfx\/surf\//.test(h.stream.src) && !h.stream.paused, 'surf bed streamed');
  h.stop(0);
  assert.equal(ctx.streams.length, 1);
});

/** Audio rig on the mock context with the real manifests indexed and every file "decoded". */
function assetRig() {
  const events = new EventBus();
  const clock = { t: 0 };
  let ctx = null;
  const audio = createAudio(events, { createContext: () => (ctx = new MockAudioContext()), now: () => clock.t, rand: () => 0.1,
    storage: null, autoUnlock: false, loadAssets: false });
  audio.unlock();
  const eng = audio.engine;
  eng.applyManifests({ sfx: sfxMan, voice: voxMan });
  const fake = (u) => { const b = ctx.createBuffer(1, 4800, 48000); b.url = u; return b; };
  for (const urls of eng.files.values()) for (const u of urls) eng.decoded.set(u, fake(u));
  for (const takes of eng.voiceRec.values()) for (const t of takes) { eng.decoded.set(t.url, fake(t.url)); if (t.alt) eng.decoded.set(t.alt, fake(t.alt)); }
  const world = { clock: 0, commandos: [], alarm: null };
  events.emit('mission:loaded', { mission: { id: 'm01', theater: 'snow' }, world });
  events.emit('game:state', { from: 'briefing', to: 'playing' });
  return { events, clock, audio, eng, get ctx() { return ctx; } };
}

test('voice packs: recorded lines are chosen, German voice stable per soldier, silent (subtitle only) without a take', () => {
  const r = assetRig();
  const seen = [];
  r.events.on('bark', (e) => seen.push(e));
  const sn = { kind: 'commando', id: 'c1', role: 'sniper', x: 0, z: 0, alive: true };
  r.audio.say(sn, 'ack_move', { force: true });
  assert.ok(LINES.sniper.ack_move.find((l) => l.text === seen[0].text).rec, `recorded ack (${seen[0].text})`);
  assert.equal(seen[0].take, 'primary');
  const buf = r.ctx.started.at(-1).buffer;
  assert.ok(/voice\/sniper\/primary\//.test(buf.url), buf.url);
  const g = { kind: 'enemy', id: 'e7', x: 5, z: 0, alive: true };
  r.clock.t = 10; r.events.emit('bark', { unit: g, line: 'ger_halt' });
  const u1 = r.ctx.started.at(-1).buffer.url;
  r.clock.t = 20; r.events.emit('bark', { unit: g, line: 'ger_suspicious' });
  const u2 = r.ctx.started.at(-1).buffer.url;
  assert.equal(u1.split('/')[1], u2.split('/')[1], `same guard, same voice (${u1} / ${u2})`);
  const n = r.ctx.started.length;
  r.clock.t = 30; r.events.emit('bark', { unit: g, line: 'ger_giveup' });
  assert.equal(r.ctx.started.length, n, 'no babble for an unrecorded line');
  assert.ok(seen.at(-1).subtitle && seen.at(-1).text, 'subtitle still shown');
  // urgent context → alt take
  r.events.emit('alarm:start', { x: 0, z: 0 });
  r.clock.t = 40; r.audio.say(sn, 'ack_move', { force: true });
  const alt = r.ctx.started.filter((s) => s.buffer?.url?.includes('voice/')).at(-1).buffer.url;
  assert.ok(/voice\/sniper\/alt\//.test(alt), `alt take while the alarm is up (${alt})`);
});

test('recorded MG bursts: one sustained take per shooter while rounds come, fades after the last; far explosions', () => {
  const r = assetRig();
  const gunner = { kind: 'enemy', id: 'mg1', x: 20, z: 0 };
  for (let k = 0; k < 5; k++) { r.clock.t = k * 0.25; r.events.emit('shot', { from: { x: 20, z: 0 }, shooter: gunner, weapon: 'mg' }); r.audio.update(0, 0, 40); }
  const bursts = r.ctx.started.filter((s) => s.buffer?.url && /mg_/.test(s.buffer.url));
  assert.equal(bursts.length, 1, 'one burst source for five rounds');
  assert.ok(bursts[0].loop && bursts[0].stopped == null);
  r.clock.t = 1.0 + 0.5; r.audio.update(0, 0, 40);
  assert.ok(bursts[0].stopped != null, 'stops after the burst tail');
  r.events.emit('explosion', { x: 400, z: 0, kind: 'bomb' });
  const far = r.ctx.started.at(-1);
  assert.ok(/explosion_distant/.test(far.buffer.url), `distant recording at 400 m (${far.buffer.url})`);
  r.clock.t = 3; r.events.emit('explosion', { x: 20, z: 0, kind: 'bomb' });
  assert.ok(/explosion_(large|grenade)/.test(r.ctx.started.at(-1).buffer.url), 'close one is the full blast');
});
