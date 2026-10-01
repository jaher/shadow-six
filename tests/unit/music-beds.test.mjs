/** MUSIC BEDS (music-director.js + audio.js + engine.mp3LeadFix): crossfades, play-once beds, briefing duck, gain trim,
 *  theater start stinger, exit, Safari MP3 lead compensation. */
import { test, assert, near } from './lib.mjs';
import { MockAudioContext } from './audio-mock.mjs';
import { MusicDirector, BED_FADE_OUT, BED_FADE_IN, BRIEFING_DUCK_GAIN, DUCK_GAIN, duckGainFor } from '../../src/audio/music-director.js';
import { mp3LeadFix } from '../../src/audio/engine.js';
import { createAudio } from '../../src/audio/audio.js';
import { EventBus } from '../../src/core/events.js';
import { LIB, fakeLoad, flush } from './music-director.test.mjs';

const BEDS = {
  ...LIB,
  campaign_norway: { len: 137.3, meta: { loopStart: 6.667, loopEnd: 133.333, bpm: 72 } },
  campaign_africa: { len: 77.8, meta: { loopStart: 2.308, loopEnd: 73.846, bpm: 104, gain: 0.8 } },
  briefing_2: { len: 100, meta: { loopStart: 5.333, loopEnd: 96, bpm: 90 } },
  credits: { len: 74, meta: { once: true, bpm: 96 } },
  tutorial: { len: 215.2, meta: { loopStart: 9.6, loopEnd: 211.2, bpm: 100 } },
  exit: { len: 8, meta: { once: true } },
  start_1: { len: 16.7, meta: { endSec: 15.2, once: true } },
  start_2: { len: 13.8, meta: { endSec: 12.3, once: true } },
};
const id = (d, s) => Object.keys(BEDS).find((k) => d.ready?.get(k)?.buffer === s.buffer);
function rig() {
  const ctx = new MockAudioContext();
  const d = new MusicDirector({ ctx, out: ctx.createGain(), load: fakeLoad(ctx, BEDS), has: (k) => !!BEDS[k] });
  return { ctx, d };
}

test('beds: changing cue crossfades (old fades out over BED_FADE_OUT, new fades in over BED_FADE_IN), loops are sample-accurate', async () => {
  const { ctx, d } = rig();
  assert.ok(BED_FADE_OUT >= 1.5 && BED_FADE_OUT <= 3 && BED_FADE_IN >= 1.5 && BED_FADE_IN <= 3, '1.5–3 s crossfades');
  d.playBed('menu'); await flush();
  const menu = ctx.started.find((s) => id(d, s) === 'menu');
  assert.ok(menu.loop); near(menu.loopStart, 10); near(menu.loopEnd, 160);
  assert.equal(menu.started >= 0 && menu.offset, 0, 'the intro plays once from 0, then the body loops');
  ctx.currentTime = 30;
  d.playBed('campaign_norway'); await flush();
  const nor = ctx.started.find((s) => id(d, s) === 'campaign_norway');
  near(nor.loopStart, 6.667); near(nor.loopEnd, 133.333);
  assert.ok(menu.stopped != null && Math.abs(menu.stopped - (30 + BED_FADE_OUT + 0.05)) < 1e-6, `menu stops after its fade (${menu.stopped})`);
  assert.equal(nor.stopped, null);
  d.playBed('campaign_norway'); await flush();
  assert.equal(ctx.started.filter((s) => id(d, s) === 'campaign_norway').length, 1, 'same bed again is a no-op (map focus moves within a theater)');
});

test('beds: credits play once then hand over to the menu theme; manifest gain trims the bed', async () => {
  const { ctx, d } = rig();
  const changes = [];
  d.onBedChange = (b) => changes.push(b);
  d.playBed('credits'); await flush();
  const cr = ctx.started.find((s) => id(d, s) === 'credits');
  assert.equal(cr.loop, false, 'credits do not loop');
  cr.onended(); await flush(); // natural end
  assert.equal(d.bed.id, 'menu');
  assert.deepEqual(changes, ['menu']);
  assert.ok(ctx.started.some((s) => id(d, s) === 'menu' && s.loop));
  // a stopped (not finished) once-bed never hands over
  d.playBed('credits'); await flush();
  d.playBed('tutorial'); await flush();
  assert.equal(d.bed.id, 'tutorial');
  d.playBed('campaign_africa'); await flush();
  const h = [...d.handles].find((x) => x.id === 'campaign_africa');
  assert.ok(h, 'africa handle');
  near(h.src.outputs[0].gain.value, 0.8, 1e-9, 'manifest gain 0.8 applied (trim node after the source)');
});

test('beds: briefing ducks −8 dB under the Colonel, the mission score −5 dB under voices', async () => {
  near(duckGainFor('briefing_1'), BRIEFING_DUCK_GAIN);
  near(20 * Math.log10(BRIEFING_DUCK_GAIN), -8, 0.1);
  near(duckGainFor(null), DUCK_GAIN);
  const { d } = rig();
  d.playBed('briefing_2'); await flush();
  d.setDuck(true);
  near(d.duckNode.gain.value, BRIEFING_DUCK_GAIN);
  d.setDuck(false);
  near(d.duckNode.gain.value, 1);
  d.startMission({ stinger: null }); await flush();
  d.setDuck(true);
  near(d.duckNode.gain.value, DUCK_GAIN);
});

test('mp3LeadFix: Safari decoders that ignore the LAME header shift loop points and hand-over by the lead', () => {
  const meta = { lengthSec: 164, loopStart: 10, loopEnd: 160, mp3LeadSec: 1105 / 48000 };
  assert.equal(mp3LeadFix(meta, 164.0, true), meta, 'gapless decode: unchanged');
  assert.equal(mp3LeadFix(meta, 164.04, false), meta, 'OGG: unchanged');
  const m = mp3LeadFix(meta, 164 + (1105 + 431) / 48000, true);
  near(m.loopStart, 10 + 1105 / 48000); near(m.loopEnd, 160 + 1105 / 48000);
  const s = mp3LeadFix({ lengthSec: 16.7, endSec: 15.2, mp3LeadSec: 0.023 }, 16.75, true);
  near(s.endSec, 15.223);
});

test('audio: theater start stinger, campaign map theme, tutorial, exit fades the bed, epilogue → campaign_end', async () => {
  let ctx = null;
  const events = new EventBus();
  const lib = { ...BEDS, campaign_end: { len: 85, meta: { once: true } }, briefing_3: BEDS.briefing_2 };
  const audio = createAudio(events, { createContext: () => (ctx = new MockAudioContext()), rand: () => 0.5, storage: null, autoUnlock: false,
    loadAssets: false, musicLoad: (k) => fakeLoad(ctx, lib)(k), musicHas: (k) => !!lib[k] });
  audio.unlock();
  const tick = async (n = 3) => { for (let i = 0; i < n; i++) { audio.update(); await flush(); } };
  events.emit('game:state', { from: 'boot', to: 'title' });
  await tick();
  assert.equal(audio.musicDir.bed.id, 'menu');
  events.emit('flow:state', { from: 'title', to: 'select' });
  audio.music('campaign_africa'); // the map table, focused on an Africa pin
  await tick();
  assert.equal(audio.musicDir.bed.id, 'campaign_africa', 'select keeps the theme the map asked for');
  audio.music('tutorial'); await tick();
  assert.equal(audio.musicDir.bed.id, 'tutorial');
  audio.music('menu'); await tick();
  events.emit('mission:loaded', { mission: { id: 'm09', theater: 'desert' }, world: { clock: 0, commandos: [] } });
  assert.equal(audio._startCue(), 'start_2', 'North Africa → start_2');
  events.emit('mission:loaded', { mission: { id: 'm02', theater: 'snow' }, world: { clock: 0, commandos: [] } });
  assert.equal(audio._startCue(), 'start_1', 'Norway → start_1');
  events.emit('game:state', { from: 'title', to: 'briefing' });
  await tick();
  assert.equal(audio.musicDir.bed.id, 'briefing_2', 'M2 → briefing_2 (STYLE §2.5 rotation)');
  events.emit('game:state', { from: 'briefing', to: 'playing' });
  await tick();
  assert.ok(audio.log.some((l) => l.type === 'music' && l.name === 'start_1' && l.stinger), 'Norway start stinger');
  events.emit('mission:won', { promoted: true });
  events.emit('game:state', { from: 'playing', to: 'won' });
  events.emit('flow:state', { from: 'playing', to: 'debrief' });
  await tick();
  assert.equal(audio.musicDir.bed, null, 'debrief: silence after the end stinger');
  assert.ok(audio.log.some((l) => l.type === 'music' && l.name === 'debrief_promotion'), 'promotion fanfare on the debrief');
  events.emit('flow:state', { from: 'debrief', to: 'epilogue' });
  await tick();
  assert.equal(audio.musicDir.bed.id, 'campaign_end', 'End of WWII theme on the epilogue');
  events.emit('flow:state', { from: 'epilogue', to: 'title' });
  await tick();
  assert.equal(audio.musicDir.bed.id, 'menu');
  audio.music('exit'); await tick();
  assert.equal(audio.musicDir.bed, null, 'exit: the menu bed fades');
  assert.ok(audio.log.some((l) => l.type === 'music' && l.name === 'exit' && l.stinger), 'exit stinger');
});

test('beds: the outgoing bed keeps playing until the incoming one is decoded (true crossfade, no gap); A→B→A keeps A', async () => {
  const ctx = new MockAudioContext();
  const load = fakeLoad(ctx, BEDS), gates = new Map();
  const gated = (k) => new Promise((r) => gates.set(k, () => r(load(k))));
  const d = new MusicDirector({ ctx, out: ctx.createGain(), load: gated, has: (k) => !!BEDS[k] });
  const live = () => [...d.handles].filter((h) => !h.ended).map((h) => h.id);
  d.playBed('menu'); gates.get('menu')(); await flush();
  assert.deepEqual(live(), ['menu']);
  d.playBed('campaign_norway'); await flush();
  assert.deepEqual(live(), ['menu'], 'the menu still sounds while Norway decodes');
  assert.equal(d.bed.id, 'campaign_norway');
  gates.get('campaign_norway')(); await flush();
  assert.deepEqual(live(), ['campaign_norway'], 'decoded: the menu fades out as Norway fades in');
  const menuH = [...d.handles].find((h) => h.id === 'menu');
  assert.ok(menuH && menuH.ended, 'the menu handle is fading (stopped after BED_FADE_OUT)');
  // A → B (pending) → A: the bed that never stopped stays, nothing restarts
  const norway = [...d.handles].find((h) => h.id === 'campaign_norway');
  d.playBed('tutorial'); await flush();
  d.playBed('campaign_norway'); await flush();
  assert.equal(d.bed.h, norway, 'back to the same Norway handle');
  gates.get('tutorial')(); await flush();
  assert.deepEqual(live(), ['campaign_norway'], 'the superseded tutorial never starts');
  // pending → null: the audible bed fades
  d.playBed('credits'); await flush();
  d.playBed(null);
  assert.deepEqual(live(), [], 'null stops the bed that was still sounding');
});

test('beds: campaign_end → credits → menu (STYLE §2.5), the next bed decoded before the hand-over', async () => {
  const lib = { ...BEDS, campaign_end: { len: 85, meta: { once: true } } };
  const ctx = new MockAudioContext();
  const d = new MusicDirector({ ctx, out: ctx.createGain(), load: fakeLoad(ctx, lib), has: (k) => !!lib[k] });
  const seen = [];
  d.onBedChange = (b) => seen.push(b);
  d.playBed('campaign_end'); await flush();
  assert.ok(d.isReady('credits'), 'credits decoded while campaign_end plays');
  [...d.handles].find((h) => h.id === 'campaign_end').src.onended(); await flush();
  assert.equal(d.bed.id, 'credits');
  assert.ok(d.isReady('menu'), 'menu decoded while the credits play');
  [...d.handles].find((h) => h.id === 'credits').src.onended(); await flush();
  assert.equal(d.bed.id, 'menu');
  assert.deepEqual(seen, ['credits', 'menu']);
});
