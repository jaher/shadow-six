/** MUSIC CUES (src/audio/music-cues.js + assets/audio/music/manifest.json): cue per screen / theater, manifest validity. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { CHAPTERS, chapterOf, campaignTheme, startCueFor, briefingCueFor, endStinger, cueForState, cueForScreen, missionNumber,
  GENERIC_START, ONCE_THEN } from '../../src/audio/music-cues.js';
import { MUSIC } from '../../src/audio/manifest.js';
import { BED_THEN } from '../../src/audio/music-director.js';
import { BEL_CATALOGUE } from '../../src/ui/catalogue.js';

const DIR = new URL('../../assets/audio/music/', import.meta.url);
const MAN = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8'));
/** The BEL album structure (STYLE.md §2): every cue the front end and the stingers need. */
const BEL_CUES = ['menu', 'campaign_norway', 'campaign_africa', 'campaign_normandy', 'campaign_rhine', 'campaign_reich',
  'campaign_end', 'briefing_1', 'briefing_2', 'briefing_3', 'tutorial', 'credits', 'exit', 'debrief_promotion',
  ...[1, 2, 3, 4, 5, 6].map((i) => `start_${i}`), ...[1, 2, 3].map((i) => `success_${i}`), ...[1, 2, 3].map((i) => `fail_${i}`)];
const CATEGORIES = new Set(['menu', 'campaign', 'briefing', 'tutorial', 'credits', 'stinger_start', 'stinger_success',
  'stinger_fail', 'stinger_exit', 'stinger_promotion', 'mission', 'mission_alert']);

test('music cues: every BEL mission maps to its theater (Norway 1–7, Africa 8–12, Normandy 13–15, Rhine 16–18, Final Assault 19–20)', () => {
  const want = (n) => (n <= 7 ? 'norway' : n <= 12 ? 'africa' : n <= 15 ? 'normandy' : n <= 18 ? 'rhine' : 'reich');
  for (const c of BEL_CATALOGUE) {
    assert.equal(chapterOf(c).id, want(c.n), c.id);
    assert.equal(chapterOf(c.id).id, want(c.n), `${c.id} by id`);
    assert.equal(campaignTheme(c), `campaign_${want(c.n)}`);
    assert.equal(startCueFor({ id: c.id }), CHAPTERS.find((ch) => ch.id === want(c.n)).start);
  }
  assert.deepEqual(CHAPTERS.map((c) => c.start), ['start_1', 'start_2', 'start_3', 'start_4', 'start_5']);
  assert.equal(missionNumber('m07'), 7);
  assert.equal(missionNumber({ id: 'b00' }), null);
  assert.equal(chapterOf({ id: 'm00', theater: 'snow' }), null, 'the sandbox is not a campaign chapter');
  assert.equal(startCueFor({ id: 'm00', theater: 'snow' }), GENERIC_START, 'sandbox → covert start stinger');
  assert.equal(chapterOf({ id: 'b00', theater: 'desert' }).id, 'africa', 'unnumbered maps fall back to the terrain theater');
  assert.equal(startCueFor({ id: 'x', theater: 'nowhere' }), GENERIC_START);
  assert.equal(campaignTheme(null), 'campaign_norway');
  assert.match(startCueFor(null, () => 0.99), /^start_6$/);
  assert.equal(endStinger(true, () => 0), 'success_1');
  assert.equal(endStinger(false, () => 0.99), 'fail_3');
});

test('music cues: screen / flow state → cue (menu, map by theater, briefing loop, tutorial, credits, epilogue; debrief silent)', () => {
  assert.equal(cueForState('title'), 'menu');
  assert.equal(cueForState('select'), undefined, 'the map table picks the focused theater itself');
  assert.equal(cueForState('playing'), undefined, 'in-mission belongs to the director');
  assert.equal(cueForState('debrief'), null);
  assert.equal(cueForState('epilogue'), 'campaign_end');
  assert.equal(cueForState('briefing', { id: 'm01' }), 'briefing_1', 'STYLE §2.5: N rotates 1 → 2 → 3 from M1');
  assert.equal(briefingCueFor({ id: 'm02' }), 'briefing_2');
  assert.equal(cueForState('briefing', { id: 'm03' }), 'briefing_3');
  assert.equal(briefingCueFor({ id: 'm04' }), 'briefing_1');
  assert.equal(briefingCueFor({ id: 'm20' }), 'briefing_2');
  assert.equal(briefingCueFor({ id: 'm00' }), 'briefing_1', 'sandbox');
  assert.equal(ONCE_THEN.campaign_end, 'credits', 'STYLE §2.5: campaign_end → credits → menu');
  assert.equal(ONCE_THEN.credits, 'menu');
  for (const s of ['main', 'options', 'load', 'save', 'help']) assert.equal(cueForScreen(s), 'menu', s);
  assert.equal(cueForScreen('select', { id: 'm09' }), 'campaign_africa');
  assert.equal(cueForScreen('tutorials'), 'tutorial');
  assert.equal(cueForScreen('credits'), 'credits');
  assert.deepEqual(ONCE_THEN, BED_THEN, 'play-once beds hand over to the same bed in both modules');
});

test('music manifest: every BEL cue has its own OGG + MP3, valid meta, sample-accurate loops, loudness/true-peak targets', () => {
  for (const id of BEL_CUES) {
    const files = MAN.cues[id];
    assert.ok(files, `${id} listed`);
    assert.deepEqual(files, [`${id}.ogg`, `${id}.mp3`], `${id}: own files (no aliases), OGG first, MP3 for Safari`);
    assert.ok(MUSIC[id], `${id} in the MUSIC catalogue`);
  }
  for (const [id, files] of Object.entries(MAN.cues)) {
    const m = MAN.meta[id];
    assert.ok(m, `${id} meta`);
    assert.ok(CATEGORIES.has(m.category), `${id} category ${m.category}`);
    assert.ok(Number.isFinite(m.gain) && m.gain > 0 && m.gain <= 1.5, `${id} gain`);
    assert.ok(m.lengthSec > 0, `${id} length`);
    for (const f of files) assert.ok(existsSync(new URL(f, DIR)), `${f} exists`);
    assert.ok(files.some((f) => f.endsWith('.ogg')) && files.some((f) => f.endsWith('.mp3')), `${id}: OGG + MP3`);
    if (m.loopEnd != null) {
      assert.ok(m.loopStart >= 0 && m.loopEnd > m.loopStart + 10 && m.loopEnd <= m.lengthSec + 1e-6, `${id} loop ${m.loopStart}–${m.loopEnd}`);
      if (m.loopStartSample != null) {
        assert.ok(Math.abs(m.loopStartSample / m.sampleRate - m.loopStart) < 1e-5, `${id} loopStart sample-accurate`);
        assert.ok(Math.abs(m.loopEndSample / m.sampleRate - m.loopEnd) < 1e-5, `${id} loopEnd sample-accurate`);
      }
    } else assert.ok(m.once || m.endSec != null, `${id}: a loop or a one-shot`);
    if (m.category === 'stinger_start') assert.ok(m.endSec > 5 && m.endSec <= m.lengthSec, `${id} hand-over`);
    if (m.truePeakDbTP != null) assert.ok(m.truePeakDbTP <= -1.0, `${id} true peak ${m.truePeakDbTP} dBTP`);
  }
  const lufs = (id) => MAN.meta[id].lufs;
  assert.ok(Math.abs(lufs('menu') + 18) <= 0.5, 'menu ≈ −18 LUFS');
  for (const i of [1, 2, 3]) assert.ok(Math.abs(lufs(`briefing_${i}`) + 20) <= 0.5, `briefing_${i} ≈ −20 LUFS (under the voice)`);
  for (const id of BEL_CUES.filter((c) => /^(start|success|fail)_/.test(c))) assert.ok(Math.abs(lufs(id) + 16) <= 0.5, `${id} ≈ −16 LUFS`);
  assert.ok(MAN.meta.credits.once && MAN.meta.campaign_end.once, 'credits / campaign_end play once (then the menu)');
});

test('music assets: OGG + MP3 only (no WAV masters), per-file and total size budget', () => {
  let total = 0;
  for (const f of readdirSync(DIR)) {
    assert.ok(!/\.(wav|flac|aiff?)$/i.test(f), `${f}: masters stay out of the repo`);
    const s = statSync(new URL(f, DIR)).size;
    total += s;
    if (/\.(ogg|mp3)$/.test(f)) assert.ok(s < 5e6, `${f} ${(s / 1e6).toFixed(2)} MB`);
  }
  assert.ok(total < 80e6, `assets/audio/music ${(total / 1e6).toFixed(1)} MB (budget 80 MB)`);
  const listed = new Set(Object.values(MAN.cues).flat());
  for (const f of readdirSync(DIR).filter((x) => /\.(ogg|mp3)$/.test(x))) assert.ok(listed.has(f), `${f} is referenced by the manifest`);
});
