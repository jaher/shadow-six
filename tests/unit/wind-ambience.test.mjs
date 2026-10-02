/**
 * Subtle wind (user report 2026-10-02: "The wind sound is too intense as if in a terror movie, can you make it more
 * subtle"). The howling Freesound takes are gone (procedural soft air, tools/audio/procedural_beds.py `wind_*`), the
 * beds sit 13–17 dB under the in-mission music bed, follow the WindField by a few dB over seconds (audio/wind-bed.js)
 * instead of ×0.6…×1.9 within a second, the gust whoosh is rare, soft and short, and AMBIENCE has its own volume.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { MockAudioContext, EventBus } from './audio-mock.mjs';
import { createAudio } from '../../src/audio/audio.js';
import { AudioEngine } from '../../src/audio/engine.js';
import { SFX, AMBIENCE, ambienceFor } from '../../src/audio/manifest.js';
import { synth } from '../../src/audio/synth.js';
import { TENSION_TRIM } from '../../src/audio/music-director.js';
import { WIND_BED, GUST, windBedTargetDb, smoothWindDb, gustWhooshGain } from '../../src/audio/wind-bed.js';
import { WindField, resolveWind, WIND_PRESETS } from '../../src/world/wind.js';
import { OPTION_DEFAULTS, VOLUME_CHANNELS } from '../../src/ui/ui-config.js';
import { OPTION_ROWS, OPTION_HELP } from '../../src/ui/options-panel.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../assets/audio');
const sfxMan = JSON.parse(readFileSync(join(ROOT, 'sfx/manifest.json'), 'utf8'));
const dB = (g) => 20 * Math.log10(g);
/** The in-mission music bed: tension cues mastered at −22 LUFS (music-director.js TENSION_TRIM) on the default MUSIC 0.6. */
const MUSIC_BED_LUFS = -22 + dB(TENSION_TRIM) + dB(0.6);
const WIND_IDS = ['wind', 'wind_snow', 'wind_desert'];

function rig(theater = 'snow') {
  const events = new EventBus();
  const clock = { t: 0 };
  let ctx = null;
  const audio = createAudio(events, { createContext: () => (ctx = new MockAudioContext()), now: () => clock.t, rand: () => 0.5,
    storage: null, autoUnlock: false, loadAssets: false });
  audio.unlock();
  const wind = WindField.forMission({ theater }, { W: 200, D: 200 });
  const world = { clock: 0, commandos: [], alarm: null, wind };
  events.emit('mission:loaded', { mission: { id: 'mx', theater }, world });
  events.emit('game:state', { from: 'briefing', to: 'playing' });
  return { events, clock, audio, wind, get ctx() { return ctx; } };
}

test('wind beds: procedural soft air (no howling recordings), one per kind, mastered at a known loudness', () => {
  const cats = new Map(sfxMan.sounds.map((s) => [s.category, s]));
  for (const c of ['wind_air', 'wind_cold', 'wind_sand']) {
    const s = cats.get(c);
    assert.ok(s, `${c} shipped`);
    assert.equal(s.mode, 'bed');
    assert.equal(s.source.site, 'project', `${c} is project output (tools/audio/procedural_beds.py)`);
    assert.ok(Math.abs(s.lufs + 24) < 0.5, `${c} mastered at −24 LUFS (${s.lufs})`);
  }
  assert.ok(!sfxMan.sounds.some((s) => [185070, 608269, 402710].includes(s.source.id) || ['wind_snow', 'wind_desert'].includes(s.category)),
    'the howling / whistling Freesound wind takes are not shipped');
  assert.deepEqual(SFX.wind.alias, ['wind_air']);
  assert.deepEqual(SFX.wind_snow.alias, ['wind_cold']);
  assert.deepEqual(SFX.wind_desert.alias, ['wind_sand']);
  const eng = new AudioEngine(new MockAudioContext(), { fetch: null });
  eng.applyManifests({ sfx: sfxMan });
  for (const id of WIND_IDS) assert.ok(eng.files.get(id)?.length === 1 && SFX[id].bed, `${id}: one streamed procedural bed`);
});

test('wind levels: 13–17 dB under the music bed per theater; snow the most present, coast/urban the least', () => {
  const lufsOf = (id) => sfxMan.sounds.find((s) => s.category === SFX[id].alias[0]).lufs;
  const under = {};
  for (const [theater, layers] of Object.entries(AMBIENCE)) {
    const w = layers.filter(([id]) => WIND_IDS.includes(id));
    if (theater === 'summer') { assert.equal(w.length, 0, 'summer: no wind bed'); continue; }
    assert.equal(w.length, 1, `${theater}: one wind bed`);
    const [id, gain] = w[0];
    under[theater] = MUSIC_BED_LUFS - (lufsOf(id) + dB(gain));
    assert.ok(under[theater] >= 12 && under[theater] <= 18, `${theater} ${id}: ${under[theater].toFixed(1)} dB under the music bed`);
  }
  assert.equal(AMBIENCE.snow.find(([id]) => WIND_IDS.includes(id))[0], 'wind_snow', 'snow: the cold bed');
  assert.equal(AMBIENCE.desert.find(([id]) => WIND_IDS.includes(id))[0], 'wind_desert');
  for (const t of ['temperate', 'coast', 'fjord', 'desert', 'urban']) assert.ok(under.snow < under[t], `snow more present than ${t}`);
  assert.ok(under.desert > under.snow + 1, 'desert air lighter than the snow wind');
  assert.ok(under.coast >= under.temperate, 'coast: the wind sits under the surf');
  // even the strongest gust spell (+gustDb) leaves the snow bed ≥ 9 dB under the music bed
  assert.ok(under.snow - WIND_BED.gustDb >= 9, `snow at a gust peak: ${(under.snow - WIND_BED.gustDb).toFixed(1)} dB under`);
});

test('wind automation: ±2.5 dB around the bed level, glides over seconds (old law: ×0.6…×1.9 within a second)', () => {
  for (const theater of Object.keys(WIND_PRESETS)) {
    const W = new WindField(resolveWind({ theater }));
    const s = {}, fps = 30, out = [];
    let db = NaN, maxRate = 0, oldMin = Infinity, oldMax = 0;
    for (const [x, z] of [[50, 50], [120, 80], [10, 150]]) {
      for (let k = 0; k < 600 * fps; k++) {
        W.sample(x, z, k / fps, s);
        const prev = db;
        db = smoothWindDb(db, windBedTargetDb(s, W.p), 1 / fps);
        if (Number.isFinite(prev)) maxRate = Math.max(maxRate, Math.abs(db - prev) * fps);
        out.push(db);
        const k0 = Math.min(1.9, 0.3 + s.speed / 9 + s.gust * 0.5);
        oldMin = Math.min(oldMin, k0); oldMax = Math.max(oldMax, k0);
      }
    }
    out.sort((a, b) => a - b);
    const q = (p) => out[Math.floor(p * (out.length - 1))];
    assert.ok(q(0) >= WIND_BED.lullDb - 1e-9 && q(1) <= WIND_BED.gustDb + 1e-9, `${theater}: ${q(0).toFixed(2)}…${q(1).toFixed(2)} dB`);
    assert.ok(q(0.95) - q(0.05) <= 4, `${theater}: p5–p95 swing ${(q(0.95) - q(0.05)).toFixed(2)} dB`);
    assert.ok(maxRate <= 1.6, `${theater}: fastest change ${maxRate.toFixed(2)} dB/s (no sharp swells)`);
    if (theater === 'snow') assert.ok(dB(oldMax / oldMin) > 6, 'the old law swung the snow bed by more than 6 dB');
  }
  // the smoother: rises with tauUp, falls slower; a paused frame (dt 0) holds
  assert.equal(smoothWindDb(1, 2, 0), 1);
  const up = smoothWindDb(0, 2, 1), down = smoothWindDb(2, 0, 1);
  assert.ok(Math.abs(up - 2 * (1 - Math.exp(-1 / WIND_BED.tauUp))) < 1e-9 && 2 - down < up, 'rise faster than fall');
  assert.equal(smoothWindDb(0, 2, 30), smoothWindDb(0, 2, 1), 'a long frame (tab in the background) is clamped to 1 s');
});

test('audio.update: the snow bed follows the WindField within ±2.5 dB of its AMBIENCE gain, through glides', () => {
  const r = rig('snow');
  const layer = r.audio.ambience.find((l) => l.id === 'wind_snow');
  assert.ok(layer?.handle, 'snow wind bed playing');
  const g0 = ambienceFor({ theater: 'snow' }).find(([id]) => id === 'wind_snow')[1];
  const gains = [];
  for (let k = 1; k <= 120 * 20; k++) {
    r.clock.t = k / 20;
    r.wind.frame(k / 20);
    r.audio.update(100, 100, 40);
    gains.push(layer.handle.base);
  }
  const lo = Math.min(...gains), hi = Math.max(...gains);
  assert.ok(dB(lo / g0) >= WIND_BED.lullDb - 0.01 && dB(hi / g0) <= WIND_BED.gustDb + 0.01, `bed ${dB(lo / g0).toFixed(2)}…${dB(hi / g0).toFixed(2)} dB`);
  assert.ok(dB(hi / lo) > 0.5, 'but it does follow the wind');
  const steps = layer.handle.gainNode.gain.events.filter((e) => e[0] === 'value');
  assert.equal(steps.length, 1, 'only the initial value; every change is a glide (no zipper)'); // the fade-in start
});

test('gust whoosh: strong fronts only, at most one per 45 s, soft (gain ≤ manifest), short and dark', () => {
  assert.equal(gustWhooshGain({ gust: GUST.minGust - 0.01 }, 100), 0, 'weak front: nothing');
  assert.equal(gustWhooshGain({ gust: 0.9 }, 100, 100 - GUST.gap + 1), 0, 'too soon after the last one');
  assert.ok(gustWhooshGain({ gust: GUST.minGust }, 100) >= GUST.gainMin && gustWhooshGain({ gust: 5 }, 100) <= GUST.gainMax);
  const r = rig('fjord');
  const plays = [];
  const play = r.audio.engine.play.bind(r.audio.engine);
  r.audio.engine.play = (id, o = {}) => { if (id === 'wind_gust') plays.push({ t: r.clock.t, gain: o.gain }); return play(id, o); };
  for (let t = 0; t <= 300; t += 4) { r.clock.t = t; r.events.emit('wind:gust', { x: 0, z: 0, gust: 0.8, speed: 14 }); }
  assert.ok(plays.length >= 5 && plays.length <= 7, `${plays.length} whooshes in 5 min of back-to-back fronts`);
  for (let i = 1; i < plays.length; i++) assert.ok(plays[i].t - plays[i - 1].t >= GUST.gap);
  assert.ok(plays.every((p) => p.gain <= 1), 'never above the manifest gain');
  r.audio.setOption('natureSounds', false);
  r.clock.t = 1000; r.events.emit('wind:gust', { gust: 1 });
  assert.equal(plays.length <= 7 && plays.at(-1).t < 1000, true, 'Nature sounds off: no whoosh');
  // the recipe: ≤ 2.5 s, reaches its peak within 1 s, dark (centroid < 700 Hz); at full gain far below a footstep
  const sr = 22050, pcm = synth('gust', sr, 7);
  assert.ok(pcm.length / sr <= 2.5, `${(pcm.length / sr).toFixed(2)} s`);
  const win = Math.round(0.05 * sr), env = [];
  for (let i = 0; i + win <= pcm.length; i += win) { let s = 0; for (let k = i; k < i + win; k++) s += pcm[k] ** 2; env.push(Math.sqrt(s / win)); }
  const peakAt = env.indexOf(Math.max(...env)) * 0.05;
  assert.ok(peakAt <= 1.0, `swell peaks at ${peakAt.toFixed(2)} s`);
  let num = 0, den = 0; // spectral centroid via a plain DFT on a 4096-sample stretch around the peak
  const N = 4096, o = Math.max(0, Math.round(peakAt * sr) - N / 2);
  for (let k = 1; k < N / 2; k += 2) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const a = (2 * Math.PI * k * n) / N, w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)); re += pcm[o + n] * w * Math.cos(a); im -= pcm[o + n] * w * Math.sin(a); }
    const p = re * re + im * im; num += p * (k * sr / N); den += p;
  }
  assert.ok(num / den < 700, `centroid ${(num / den).toFixed(0)} Hz`);
  const peakDb = dB(Math.max(...env) * SFX.wind_gust.gain * GUST.gainMax);
  assert.ok(peakDb <= -40, `gust peak (50 ms RMS) ${peakDb.toFixed(1)} dBFS at full gain — a footstep at the view peaks ≈ −26 dBFS`);
});

test('Options → Sound: AMBIENCE volume (default 100 %) drives the ambience bus', () => {
  assert.equal(OPTION_DEFAULTS.volAmbience, 1);
  assert.equal(VOLUME_CHANNELS.volAmbience, 'ambience');
  for (const [k, ch] of Object.entries(VOLUME_CHANNELS)) assert.ok(k in OPTION_DEFAULTS && ['master', 'sfx', 'voice', 'music', 'ambience', 'narration'].includes(ch), k);
  const keys = OPTION_ROWS.map((r) => r[0]);
  const sound = keys.slice(keys.indexOf('h') + 1, keys.indexOf('h', keys.indexOf('h') + 1));
  assert.ok(sound.includes('volAmbience') && sound.indexOf('volAmbience') === sound.indexOf('nature') + 1, 'next to NATURE SOUNDS');
  assert.ok(OPTION_ROWS.find((r) => r[0] === 'volAmbience')[2] === 'vol' && OPTION_HELP.volAmbience);
  const r = rig('snow');
  r.audio.setVolume('ambience', 0.25);
  const ev = r.audio.engine.bus.ambience.gain.events.at(-1);
  assert.ok(ev && Math.abs(ev[1] - 0.25) < 1e-9, 'ambience bus ramps to the slider value');
  assert.equal(r.audio.volumes.ambience, 0.25);
});
