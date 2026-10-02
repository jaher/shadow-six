/**
 * The newsreel narrator (docs/narration.md): every mission's briefing has a narration clip per line whose text is
 * exactly the on-screen text; the timeline reveals words in step; the narrator plays through its own gain into the
 * voice bus and ducks the music; Options carry NARRATION (on by default) and its volume.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { MockAudioContext, EventBus } from './audio-mock.mjs';
import { MISSIONS } from '../../src/missions/index.js';
import { briefingNarrationLines, briefingParagraphs, briefingHeadline, briefingHistory } from '../../src/ui/briefing-text.js';
import { NarrationTrack, narrationAudible, TOUR_TIMING } from '../../src/ui/briefing-narration.js';
import { tourStops, tourNarrationLines, TOUR_SIGNOFF } from '../../src/ui/tour.js';
import { missionTourLines, tourClipId } from '../../tools/audio/narration/tour-world.mjs';
import { Narrator, pickNarrationFile } from '../../src/audio/narration.js';
import { createAudio } from '../../src/audio/audio.js';
import { OPTION_DEFAULTS } from '../../src/ui/ui-config.js';
import { OPTION_ROWS, OPTION_HELP } from '../../src/ui/options-panel.js';

const ROOT = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('assets/audio/narration/manifest.json', ROOT), 'utf8'));

test('manifest covers every mission briefing: one clip per line, text identical to the screen, both formats on disk', () => {
  let clips = 0;
  for (const def of MISSIONS) {
    const want = briefingNarrationLines(def);
    if (!want.length) continue;
    const got = manifest.missions[def.id]?.lines;
    assert.ok(got, `${def.id} has narration`);
    assert.deepEqual(got.map((l) => l.id), want.map((l) => l.id), `${def.id} line ids`);
    got.forEach((l, i) => {
      assert.equal(l.text, want[i].text, `${def.id}/${l.id} narration text = on-screen text`);
      assert.equal(l.files.length, 2);
      assert.ok(l.files.some((f) => f.endsWith('.ogg')) && l.files.some((f) => f.endsWith('.mp3')), `${def.id}/${l.id} ogg + mp3`);
      for (const f of l.files) {
        const p = new URL(`assets/audio/${f}`, ROOT);
        assert.ok(existsSync(p) && statSync(p).size > 1000, `${f} exists`);
      }
      assert.ok(l.duration > 0.8 && l.duration < 60, `${def.id}/${l.id} duration ${l.duration}`);
      assert.ok(l.words.length >= 2, `${def.id}/${l.id} word timings`);
      for (let k = 1; k < l.words.length; k++) assert.ok(l.words[k].s >= l.words[k - 1].s - 1e-6, 'word starts are in order');
      assert.ok(l.words.at(-1).e <= l.duration + 1e-3, 'words end inside the clip');
      clips++;
    });
  }
  assert.ok(clips >= 80, `${clips} clips`);
});

test('every BEL mission opens with the title card, then its wartime background; the paragraphs are the briefing screen\'s', () => {
  const bel = MISSIONS.filter((m) => m.campaign === 'BEL' && m.id !== 'm00');
  assert.equal(bel.length, 20);
  for (const def of bel) {
    const lines = briefingNarrationLines(def);
    assert.equal(lines[0].id, 'head');
    assert.match(lines[0].text, /^Mission \d+\. .+\. .+\. [A-Z][a-z]+ \d{1,2}, 19\d\d\.$/, lines[0].text);
    // the history paragraph lives in briefing.historical (the screen used to look for briefing.history and never showed it)
    assert.equal(lines[1].id, 'hist', `${def.id}: the background is read right after the title card`);
    assert.equal(lines[1].text, def.briefing.historical.trim());
    assert.equal(briefingHistory(def), lines[1].text);
    const words = lines[1].text.split(/\s+/).length;
    assert.ok(words >= 20 && words <= 65, `${def.id}: a short background (${words} words)`);
    assert.match(lines[1].text, /^(January|February|March|April|May|June|July|August|September|October|November|December) 19(4[0-5])\. /, `${def.id}: opens with its month and year`);
    assert.equal(lines[1].text.slice(-1), '.', `${def.id}: ends a sentence`);
    assert.deepEqual(lines.filter((l) => /^p\d$/.test(l.id)).map((l) => l.text), briefingParagraphs(def));
    assert.ok(!briefingParagraphs(def).includes(lines[1].text), 'the background is not also a paragraph');
  }
  assert.equal(briefingHistory({ briefing: { text: 'x' } }), '', 'no background, no line');
  assert.ok(!briefingNarrationLines({ id: 'x', briefing: { text: 'Go.' } }).some((l) => l.id === 'hist'));
  assert.equal(briefingHeadline({ id: 'm00', title: 'Sandbox' }), '', 'no title card for the sandbox');
});

test('the Colonel\'s tour: every caption of every mission has a narrator clip with exactly its text', () => {
  const pool = manifest.tour?.lines || [];
  const byText = new Map(pool.map((l) => [l.text, l]));
  assert.equal(byText.size, pool.length, 'one clip per distinct caption');
  const used = new Set();
  let stops = 0;
  for (const def of MISSIONS) {
    const lines = missionTourLines(def);
    assert.ok(lines.length >= 2, `${def.id}: a tour`);
    assert.equal(lines.at(-1).text, TOUR_SIGNOFF, 'the sign-off closes every tour');
    for (const l of lines) {
      const clip = byText.get(l.text);
      assert.ok(clip, `${def.id}/${l.id} "${l.text}" is recorded`);
      assert.equal(clip.id, tourClipId(l.text));
      assert.deepEqual(clip.files, [`narration/tour/${clip.id}.ogg`, `narration/tour/${clip.id}.mp3`]);
      for (const f of clip.files) assert.ok(statSync(new URL(`assets/audio/${f}`, ROOT)).size > 1000, `${f} exists`);
      assert.ok(clip.duration > 0.8 && clip.duration < 20 && clip.words.length >= 2, `${clip.id} duration / words`);
      used.add(l.text);
      stops++;
    }
  }
  assert.deepEqual(pool.filter((l) => !used.has(l.text)).map((l) => l.text), [], 'no orphan tour clips');
  assert.ok(stops >= 60, `${stops} narrated tour captions`);
});

test('tour captions: proper nouns keep their capitals; the narrator lines are the stops plus the sign-off', () => {
  const def = { size: [60, 60], structures: [{ type: 'hut', id: 'hq', x: 30, z: 30 }, { type: 'hut', id: 'v2', x: 40, z: 30 }],
    objectives: [{ id: 'a', text: 'Destroy the German headquarters.', targets: ['hq'] }, { id: 'b', text: 'V2 rockets: destroy both', targets: ['v2'] }] };
  const world = { commandos: [{ x: 5, z: 5 }], enemies: [], objectives: def.objectives };
  const s = tourStops(world, def);
  assert.equal(s[1].text, 'Your objective: destroy the German headquarters. I have circled it in red.');
  assert.equal(s[2].text, 'Your objective: V2 rockets: destroy both. I have circled it in red.');
  const lines = tourNarrationLines(world, def);
  assert.deepEqual(lines.map((l) => l.id), ['t0', 't1', 't2', 'end']);
  assert.deepEqual(lines.slice(0, 3).map((l) => l.text), s.map((x) => x.text));
  assert.equal(tourClipId('That is all, officer. Good luck.'), tourClipId(TOUR_SIGNOFF));
  assert.notEqual(tourClipId('a'), tourClipId('b'));
  assert.ok(TOUR_TIMING.gap > 0 && TOUR_TIMING.minStop > 0 && TOUR_TIMING.wait > 0);
});

test('the briefing never calls the browser\'s speech synthesis: the tour is read by the narrator', () => {
  const src = readFileSync(new URL('src/ui/briefing.js', ROOT), 'utf8');
  assert.ok(!/speechSynthesis|SpeechSynthesisUtterance/.test(src));
});

test('speech-recognition check passed for every shipped clip (or is listed in qa-accept.json with a reason)', () => {
  const accept = JSON.parse(readFileSync(new URL('tools/audio/narration/qa-accept.json', ROOT), 'utf8'));
  for (const [mid, m] of [...Object.entries(manifest.missions), ['tour', manifest.tour]]) {
    for (const l of m.lines) {
      const ok = l.wer != null && (l.wer <= 0.1 || l.asrErrors <= 1); // package.mjs's rule
      assert.ok(ok || accept[`${mid}_${l.id}`], `${mid}/${l.id} WER ${l.wer}`);
    }
  }
});

test('NarrationTrack: the text share follows the word timings and never runs backwards', () => {
  const tr = new NarrationTrack([{ id: 'p0', text: 'Hello world.', duration: 2, words: [{ w: 'Hello', s: 0.2, e: 0.6 }, { w: 'world', s: 0.7, e: 1.2 }] }], { ahead: 0 });
  assert.equal(tr.share(0, 0), 0);
  near(tr.share(0, 0.4), 0.25, 1e-9);
  near(tr.share(0, 0.65), 0.5, 1e-9);
  assert.equal(tr.share(0, 1.5), 1);
  let prev = 0;
  for (let t = 0; t < 2; t += 0.05) { const s = tr.share(0, t); assert.ok(s >= prev); prev = s; }
  const text = 'Regroup at the north-west corner, 1941.';
  const sw = NarrationTrack.screenWords(text);
  assert.equal(sw.map((w) => w.text).join(''), text, 'spans keep the exact text');
  assert.ok(sw.every((w, i) => i === 0 || w.at > sw[i - 1].at));
});

test('Narrator: decodes a mission\'s clips, plays them into the voice bus via its own gain, ducks the music', async () => {
  let ctx = null;
  const events = new EventBus();
  const lines = [{ id: 'head', text: 'Mission 1.', files: ['narration/m01/head.ogg', 'narration/m01/head.mp3'], duration: 1, words: [] }];
  const tour = [{ id: 't1', text: 'Watch this spot.', files: ['narration/tour/t1.ogg', 'narration/tour/t1.mp3'], duration: 1, words: [] }];
  const fetch = async (url) => ({
    ok: true,
    json: async () => ({ missions: { m01: { lines } }, tour: { lines: tour } }),
    arrayBuffer: async () => new ArrayBuffer(8),
    url,
  });
  const audio = createAudio(events, { createContext: () => {
    ctx = new MockAudioContext();
    ctx.decodeAudioData = async () => ctx.createBuffer(1, 48000, 48000);
    return ctx;
  }, fetch, rand: () => 0.1, storage: null, autoUnlock: false, loadAssets: false });
  audio.unlock();
  const n = audio.narrator;
  assert.ok(n instanceof Narrator);
  assert.equal(await n.prefetch('m01'), true);
  assert.equal(pickNarrationFile(lines[0].files, true), 'narration/m01/head.ogg');
  assert.equal(pickNarrationFile(lines[0].files, false), 'narration/m01/head.mp3');
  const h = n.play('m01', 0);
  assert.ok(h && n.speaking, 'speaking');
  assert.equal(ctx.busOf(h.src, { narration: n.gain }), 'narration');
  assert.ok(n.gain.outputs.includes(audio.engine.bus.voice), 'narration gain → voice bus');
  audio._musicTick();
  assert.equal(audio.musicDir.ducked, true, 'music ducks under the narrator');
  audio.setVolume('narration', 0.4);
  near(n.gain.gain.value, 0.4, 1e-9, 'NARRATION VOLUME');
  ctx.currentTime = 2;
  assert.equal(n.speaking, false, 'clip over');
  audio._musicTick();
  assert.equal(audio.musicDir.ducked, false, 'music back up');
  n.session = true; // a briefing reading between two lines: no clip sounds, the music stays down (no pumping)
  audio._musicTick();
  assert.equal(audio.musicDir.ducked, true, 'still ducked in the pause between lines');
  n.session = false;
  audio._musicTick();
  assert.equal(audio.musicDir.ducked, false, 'up again once the reading ends');
  // the next line of a reading does not end the reading: the music stays down from line to line
  n.session = true;
  n.play('m01', 0);
  assert.equal(n.session, true, 'playing the next line keeps the session');
  // the tour's captions: found by text, decoded with the mission's clips, played the same way
  assert.equal(n.tourLine('Watch this spot.'), tour[0]);
  assert.equal(n.tourLine('Not recorded.'), null);
  assert.equal(n.lineState(tour[0]), 'none');
  assert.equal(await n.prefetchTour(['Watch this spot.', 'Not recorded.']), 1);
  assert.equal(n.lineState(tour[0]), 'ready');
  assert.equal(await n.prefetch('m01'), true);
  assert.equal(n.lineState(tour[0]), 'ready', 'the briefing\'s tour clips survive its own prefetch');
  const th = n.playLine(tour[0]);
  assert.ok(th && n.speaking);
  assert.equal(ctx.busOf(th.src, { narration: n.gain }), 'narration', 'tour clips go through NARRATION VOLUME too');
  n.stop();
  assert.equal(n.speaking, false);
  assert.equal(n.ducking, false, 'stop ends the reading');
  assert.equal(n.play('m99', 0), null, 'no clip, no sound');
});

test('narrationAudible: muted, or MASTER / VOICES / NARRATION at 0, means nobody hears him (the text shows at once)', () => {
  const vol = { master: 0.8, voice: 1, narration: 1 };
  assert.equal(narrationAudible({ muted: false, volumes: vol }), true);
  assert.equal(narrationAudible({ muted: true, volumes: vol }), false, 'muted');
  for (const k of ['master', 'voice', 'narration']) assert.equal(narrationAudible({ muted: false, volumes: { ...vol, [k]: 0 } }), false, k);
  assert.equal(narrationAudible(null), false);
});

test('Options → Sound: NARRATION on by default, with its own volume and help text', () => {
  assert.equal(OPTION_DEFAULTS.narration, true);
  assert.equal(OPTION_DEFAULTS.volNarration, 1);
  const keys = OPTION_ROWS.map((r) => r[0]);
  const sound = keys.slice(keys.indexOf('h') + 1, keys.indexOf('h', keys.indexOf('h') + 1));
  assert.ok(sound.includes('narration') && sound.includes('volNarration'), 'in the SOUND group');
  assert.ok(OPTION_HELP.narration && OPTION_HELP.volNarration);
});
