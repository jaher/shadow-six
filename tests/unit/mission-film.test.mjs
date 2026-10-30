/**
 * The mission films (tools/solutions/capture-video.mjs, film-opening.mjs, film-audio.mjs, film-mixer.mjs, mix-video.mjs):
 * the pure parts — the art opening's camera plan, the soundtrack plan (music chain, alert layer, ambience, effects with
 * the game's distance model), the software mixer — and the data every mission film leans on (each theatre's ambience beds
 * and every start / success cue have recorded assets).
 *   node tests/unit/run.mjs mission-film
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, near } from './lib.mjs';
import { planOpening, openingAt, cardAlpha, stopLabel, orderStops } from '../../tools/solutions/film-opening.mjs';
import { planSoundtrack, planMusic, planAmbience, planEffects, threatIntervals, timeMap, bedCap, LEVEL } from '../../tools/solutions/film-audio.mjs';
import { Mix, RATE, automation, seamless, SoundBank, renderPlan } from '../../tools/solutions/film-mixer.mjs';
import { SFX, AMBIENCE, MISSION_AMBIENCE, ambienceFor } from '../../src/audio/manifest.js';
import { spatialize } from '../../src/audio/engine.js';
import { MISSION_CHAIN, nextSegment, ThreatTracker, CALM_HOLD } from '../../src/audio/music-director.js';
import { startCueFor, CHAPTERS } from '../../src/audio/music-cues.js';
import { MISSIONS } from '../../src/missions/index.js';
import { findFfmpeg } from '../../tools/solutions/film-ffmpeg.mjs';
import { captionPlan, captionQueue, captionText, firstSentence, readingTime, READ_MIN, READ_MAX, CAPTION_MAX } from '../../tools/solutions/film-captions.mjs';
import { standHeight, waitPoints, waitFrame, WAIT_FRAME } from '../../tools/solutions/film-camera.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const musicManifest = JSON.parse(readFileSync(join(ROOT, 'assets/audio/music/manifest.json'), 'utf8'));
const sfxManifest = JSON.parse(readFileSync(join(ROOT, 'assets/audio/sfx/manifest.json'), 'utf8'));

// ---------------------------------------------------------------- the art opening
const M1 = [
  { kind: 'start', x: 45.7, z: 137.3, text: 'Officer, your 3 men go in here. Keep them together until you know the ground.' },
  { kind: 'objective', x: 12, z: 12, text: 'Your objective: destroy the relay station. I have circled it in red.' },
  { kind: 'danger', x: 17, z: 41, text: 'Watch this spot: 2 guards cover it. Study their cones before you move.' },
];
const M3 = [
  { kind: 'start', x: 107.3, z: 6.8, text: 'Officer, your 4 men go in here.' },
  { kind: 'objective', x: 10, z: 44, text: 'Your objective: destroy the dam bunker. I have circled it in red.' },
  { kind: 'objective', x: 40, z: 22, text: 'Your objective: demolish the dam. I have circled it in red.' },
  { kind: 'danger', x: 8.6, z: 99.3, text: 'Watch this spot: 5 guards cover it. Study their cones before you move.' },
];

test('opening: objectives first, then the danger, then the team where the solution begins', () => {
  const ord = orderStops(M1, { x: 16, z: 158 }).map((s) => s.kind);
  assert.deepEqual(ord, ['objective', 'danger', 'start']);
  const p = planOpening(M1, { start: { x: 16, z: 158 } });
  assert.deepEqual(p.stops.map((s) => s.kind), ['objective', 'danger', 'start']);
  assert.deepEqual(p.stops[2], { kind: 'start', x: 16, z: 158, label: 'The team goes in here' });
});

test('opening: at most 20 s, the title card over a zoom-2 close-up of the first objective, ending on the start at the film zoom', () => {
  for (const [stops, start] of [[M1, { x: 16, z: 158 }], [M3, { x: 103.5, z: 6.8 }], [[M1[0]], { x: 5, z: 5 }]]) {
    const p = planOpening(stops, { start });
    assert.ok(p.dur > 3 && p.dur <= 19.5 + 1e-9, `duration ${p.dur}`);
    const a = openingAt(p, 0), z = openingAt(p, p.dur);
    if (stops.length > 1) { assert.equal(a.zoom, 2); near(a.x, stops[1].x); near(a.z, stops[1].z); }
    near(z.x, start.x); near(z.z, start.z); near(z.zoom, 0.7);
    assert.equal(cardAlpha(p, 0), 1);
    assert.equal(cardAlpha(p, p.titleSec), 0);
    assert.ok(cardAlpha(p, p.titleSec - 0.5) > 0 && cardAlpha(p, p.titleSec - 0.5) < 1);
  }
});

test('opening: the camera never jumps (continuous in place and zoom) and the zoom stays within the game\'s levels', () => {
  for (const stops of [M1, M3]) {
    const p = planOpening(stops, { start: { x: 100, z: 10 } });
    let prev = openingAt(p, 0);
    for (let t = 1 / 30; t <= p.dur; t += 1 / 30) {
      const c = openingAt(p, t);
      assert.ok(Math.hypot(c.x - prev.x, c.z - prev.z) < 2.2, `jump of ${Math.hypot(c.x - prev.x, c.z - prev.z)} m at ${t}`); // 20 m/s eased peak ~1.5x → < 1 m per frame
      assert.ok(Math.abs(c.zoom - prev.zoom) < 0.15);
      assert.ok(c.zoom >= 0.5 && c.zoom <= 2);
      prev = c;
    }
  }
});

test('opening: a long map drops its optional stops to stay in the budget; a mission with only a start still opens', () => {
  const far = [{ kind: 'objective', x: 5, z: 5, text: 'Your objective: blow it.' }, { kind: 'danger', x: 140, z: 130 }, { kind: 'extraction', x: 5, z: 140, text: '' }, { kind: 'start', x: 140, z: 5 }];
  const p = planOpening(far, { start: { x: 140, z: 5 } });
  assert.ok(p.dur <= 19.5 + 1e-9);
  assert.equal(p.stops[0].kind, 'objective');
  assert.equal(p.stops[p.stops.length - 1].kind, 'start');
  const lone = planOpening([], { start: { x: 20, z: 30 } });
  assert.ok(lone.dur >= 3.5 && lone.stops.length === 1);
  near(openingAt(lone, lone.dur).zoom, 0.7);
  assert.equal(planOpening([], {}).dur, 0);
});

test('opening: labels read like captions', () => {
  assert.equal(stopLabel(M1[1]), 'Objective: Destroy the relay station');
  assert.equal(stopLabel(M1[2]), '2 guards cover this ground');
  assert.equal(stopLabel({ kind: 'extraction' }), 'Extraction: every man comes back here');
  assert.equal(stopLabel({ kind: 'start' }), 'The team goes in here');
  const p = planOpening(M1, { start: { x: 16, z: 158 } });
  assert.equal(openingAt(p, 2).label, 'Objective: Destroy the relay station');
});

test('opening: a cut that names its own stops (M12: the cell, the roofs, the mosque platform, the car) keeps their order, labels and holds, and the opening ends at the last', async () => {
  const { openingStops } = await import('../../tools/solutions/m12.cut.mjs');
  const tour = [{ kind: 'start', x: 31, z: 38, text: 'Officer, your 4 men go in here.' }, { kind: 'danger', x: 18.5, z: 36.3, text: 'Watch this spot: 7 guards cover it. Study their cones before you move.' }];
  const mine = openingStops(tour);
  assert.deepEqual(mine.map((s) => s.kind), ['objective', 'danger', 'danger', 'extraction']);
  assert.deepEqual(orderStops(mine, { x: 16, z: 44 }, true), mine); // kept as given: not objectives-first, no start added
  assert.equal(orderStops(mine, { x: 16, z: 44 }).at(-1).kind, 'start'); // (the tour's own list, by contrast, ends on the team)
  const p = planOpening(mine, { start: { x: 16, z: 44 }, ordered: true });
  assert.deepEqual(p.stops.map((s) => s.kind), ['objective', 'danger', 'danger', 'extraction']); // nothing dropped, nothing added
  assert.ok(p.dur > 12 && p.dur <= 19.5 + 1e-9, `duration ${p.dur}`);
  assert.equal(openingAt(p, 0).zoom, 2); // the title card over the close-up of the cell
  near(openingAt(p, 0).x, mine[0].x); near(openingAt(p, 0).z, mine[0].z);
  const end = openingAt(p, p.dur);
  near(end.x, mine.at(-1).x); near(end.z, mine.at(-1).z); near(end.zoom, 0.7); // it ends at the car, at the film's zoom
  assert.ok(p.labels.length === 4 && p.labels.every((l) => l.text.length <= 72), 'one label per stop, short enough for the stage title');
  assert.ok(p.labels.some((l) => /mosque platform/.test(l.text)) && p.labels.some((l) => /car on the quay/.test(l.text)));
  assert.equal(stopLabel({ kind: 'danger', label: 'Mine', text: '5 guards' }), 'Mine');
  const held = planOpening([{ kind: 'danger', x: 5, z: 5, dwell: 2.2 }, { kind: 'danger', x: 50, z: 5, dwell: 0.7 }], { ordered: true });
  const holds = held.segs.filter((g) => g.kind === 'hold');
  near(holds[1].t1 - holds[1].t0, 0.7); // (a cut's own `dwell`)
  assert.ok(planOpening([], { start: { x: 20, z: 30 }, ordered: true }).dur > 3, 'a cut with no stops still opens on the start');
});

test('m12.cut: the Spy\'s wait behind e6 is time-lapsed, captioned, and clear of the kill\'s real time', async () => {
  const { windows, notes } = await import('../../tools/solutions/m12.cut.mjs');
  const at = { D1: 151.2, D2: 334.6 }, cp = (k) => at[k];
  const ev = [{ t: 39, kind: 'kill', tag: 'e2' }, { t: 333.3, kind: 'kill', tag: 'e6' }, { t: 356.3, kind: 'kill', tag: 'e7' }];
  const W = windows(cp, () => undefined, ev), N = notes(cp, () => undefined, ev);
  assert.equal(W.length, 1);
  assert.ok(W[0].speed >= 32 && W[0].t0 > at.D1 + 15 && W[0].t1 < 333.3 - 6, 'fast, after the climb and the walk, before the director\'s ramp down to the injection (its real time starts 2.5 s before the kill)');
  assert.equal(N.length, 1);
  assert.ok(N[0].t0 < W[0].t0 && N[0].t1 > 333.3, 'the caption runs from the climb through the wait to the fall');
  assert.ok(N[0].text.length <= CAPTION_MAX);
  // film seconds on screen: the time-lapse, plus the generic kill window (1.25x from 2.5 s before the kill to 2 s after) and the Spy's walk at 4x
  const film = (W[0].t1 - W[0].t0) / W[0].speed + 4.5 / 1.25 + (W[0].t0 - N[0].t0) / 4;
  assert.ok(film >= readingTime(N[0].text), `the caption is on screen ${film.toFixed(1)} s`);
  assert.deepEqual(windows(cp, () => undefined, []), [], 'no kill of e6 in pass 1: no window');
  assert.deepEqual(notes(() => undefined, () => undefined, ev), []);
});

test('m14.cut: the wait framing is on, the alarm at gun 4 is explained, and the Sapper\'s two long waits on the turret roof are time-lapsed and captioned', async () => {
  const { FRAME_WAITS, windows, notes } = await import('../../tools/solutions/m14.cut.mjs');
  const at = { F2: 1690.4, F5: 1934.3, F7: 2322.9, G1: 2348.1, G2: 2649.0 }, cp = (k) => at[k];
  assert.equal(FRAME_WAITS, true);
  const W = windows(cp, () => undefined, []), N = notes(cp, () => undefined, []);
  assert.equal(W.length, 2);
  assert.ok(W.every((w) => w.speed >= 32 && w.t1 - w.t0 > 150), 'long waits, time-lapsed');
  assert.ok(W[0].t0 > at.F5 && W[0].t1 < at.F7, 'the first inside F5 → F7');
  assert.ok(W[1].t0 > at.G1 + 30 && W[1].t1 < at.G2, 'the second after the blast\'s real time, before the Sapper comes down');
  assert.equal(N.length, 3);
  assert.ok(N[0].t0 < at.F2 && N[0].t1 > at.F2 + 30 && /alarm/.test(N[0].text), 'the alarm note covers the moment the bodies are found');
  assert.ok(N[1].t0 < W[0].t0 && N[1].t1 > W[0].t1 - 20 && N[2].t0 < W[1].t0 && N[2].t1 > W[1].t1 - 60, 'each time-lapse is captioned');
  assert.ok(N.every((n) => n.text.length <= CAPTION_MAX), 'the captions fit the box');
  assert.deepEqual(windows(() => undefined, () => undefined, []), [], 'no checkpoints from pass 1: no window');
  assert.deepEqual(notes(() => undefined, () => undefined, []), []);
});

// ---------------------------------------------------------------- the soundtrack plan
const fileFor = (id) => ({ src: `file:/x/${id}.ogg`, category: SFX[id]?.alias?.[0] || id });
const env = (extra = {}) => ({
  SFX, spatialize, ThreatTracker, CALM_HOLD,
  music: (cue) => (musicManifest.cues[cue] ? musicManifest.meta[cue] || {} : null),
  nextSegment: (cur, has) => nextSegment(cur, has, MISSION_CHAIN),
  source: (id) => (SFX[id] ? fileFor(id) : null),
  ...extra,
});
/** a timeline: `open` s of opening (title card), then `play` s of frames at `speed`, then 5 s of end card; game time = film time × speed */
function timeline({ open = 15, play = 120, speed = 1, fps = 30, mission = {}, cues = [], threat = [], end = true } = {}) {
  const frames = [];
  for (let i = 0; i < open * fps; i++) frames.push({ t: 0, speed: 0, card: i < 100 ? 'title' : 'open', cx: 50, cz: 50, vw: 40 });
  for (let i = 0; i < play * fps; i++) frames.push({ t: (i / fps) * speed, speed, cx: 50, cz: 50, vw: 40 });
  const tEnd = play * speed;
  for (let i = 0; i < 5 * fps; i++) frames.push({ t: tEnd, speed: 0, card: 'end' });
  return {
    id: 'mx', fps, frames, mission: { id: 'mx', n: 1, theater: 'snow', startCue: 'start_1', night: false, ambience: [], yaw: 0.26, ...mission },
    audio: { cues, threat }, pass2: { events: end ? [{ t: tEnd, kind: 'end', state: 'won' }] : [] },
  };
}

test('time map: game time → film time over the solution\'s own frames only', () => {
  const T = timeline({ speed: 4, play: 60 });
  const tm = timeMap(T);
  near(tm.openEnd, 15);
  near(tm.vt(0), 15);
  near(tm.vt(4 * 10), 25, 0.04); // 10 s into the play at 4×
  near(tm.vt(1e9), tm.lastPlay / 30);
  assert.equal(tm.endCardAt, (15 + 60) * 30 / 30);
});

test('music: the Norway stinger, then the chain from the stinger\'s end, each segment at the previous body end', () => {
  const T = timeline({ play: 400, mission: { startCue: 'start_1' } });
  const m = planMusic(T, env(), timeMap(T));
  assert.equal(m.startCue, 'start_1');
  near(m.stinger.at, 0.25);
  const meta = musicManifest.meta;
  near(m.chain[0].at, 0.25 + meta.start_1.endSec, 1e-6);
  assert.equal(m.chain[0].cue, MISSION_CHAIN[0]);
  assert.equal(m.chain[0].offset, 0);
  assert.deepEqual(m.chain.slice(0, 4).map((c) => c.cue), MISSION_CHAIN.slice(0, 4));
  near(m.chain[1].at, m.chain[0].at + meta[m.chain[0].cue].loopEnd, 1e-6); // first segment: whole intro, then its body end
  assert.equal(m.chain[1].offset, meta[m.chain[1].cue].loopStart);
  near(m.chain[2].at, m.chain[1].at + meta[m.chain[1].cue].loopEnd - meta[m.chain[1].cue].loopStart, 1e-6);
  assert.ok(m.chain.every((c, i) => i === 0 || c.cue !== m.chain[i - 1].cue));
  assert.ok(m.chain[m.chain.length - 1].at < m.musicEnd);
  assert.equal(m.success.cue, 'success_2'); // n = 1: success_(1 + 1 % 3)
  near(m.success.at, m.musicEnd + 0.25);
});

test('music: every theatre\'s start stinger is the game\'s own (Norway start_1 … Final Assault start_5, the covert start_6)', () => {
  for (const [id, start] of [['m01', 'start_1'], ['m03', 'start_1'], ['m08', 'start_2'], ['m13', 'start_3'], ['m16', 'start_4'], ['m19', 'start_5'], ['m00', 'start_6']]) {
    assert.equal(startCueFor({ id }), start, id);
    const T = timeline({ mission: { startCue: start } });
    assert.equal(planMusic(T, env(), timeMap(T)).stinger.cue, start);
  }
  // a missing cue falls back to the covert one rather than silence
  const T = timeline({ mission: { startCue: 'start_9' } });
  assert.equal(planMusic(T, env(), timeMap(T)).stinger.cue, 'start_6');
});

test('music: the alert layer follows the game\'s ThreatTracker (combat / search / alarm), quantised to bars, never a flicker', () => {
  // game time = film time here; an enemy goes COMBAT at 40 s and is shot at 44 s, the alarm runs 80–140 s
  const threat = [{ t: 40, k: 'e1', to: 'COMBAT' }, { t: 44, k: 'e1', drop: 1 }, { t: 80, alarm: 1 }, { t: 140, alarm: 0 }];
  const T = timeline({ play: 300, threat, cues: [] });
  const tm = timeMap(T), m = planMusic(T, env(), tm);
  const iv = threatIntervals(threat, ThreatTracker, CALM_HOLD, 300);
  assert.deepEqual(iv.map(([a, b]) => [a, +b.toFixed(1)]), [[40, 52], [80, 148]]); // calm hold 8 s after the last threat
  assert.equal(m.alert.length, 2);
  for (const a of m.alert) {
    assert.ok(a.off - a.on >= 2 * m.bar);
    near(((a.on - m.grid) / m.bar) % 1 < 0.5 ? ((a.on - m.grid) / m.bar) % 1 : 1 - (((a.on - m.grid) / m.bar) % 1), 0, 1e-6); // on a bar line
  }
  assert.ok(m.alert[0].on >= tm.openEnd + 40 - 1e-6 && m.alert[0].on < tm.openEnd + 40 + m.bar + 1e-6);
  // the chain is ducked under the alert: down over a bar at its start, back over two bars when it calms
  const g = automation(m.tension);
  assert.equal(g(0), 1);
  assert.equal(g(m.alert[0].on + m.bar), 0);
  assert.equal(g((m.alert[0].on + m.alert[0].off) / 2), 0);
  assert.equal(g(m.alert[0].off + 2 * m.bar + 0.01), 1);
});

test('music: a short fight at fast-forward still gets a proper alert stretch; two close ones merge', () => {
  const T = timeline({ play: 300, speed: 4, threat: [{ t: 400, k: 'e1', to: 'SEARCH' }, { t: 402, k: 'e1', drop: 1 }, { t: 420, k: 'e2', to: 'COMBAT' }, { t: 421, k: 'e2', drop: 1 }] });
  const m = planMusic(T, env(), timeMap(T));
  assert.equal(m.alert.length, 1);
  assert.ok(m.alert[0].off - m.alert[0].on >= 9);
});

test('music: a lost mission ends on a fail cue', () => {
  const T = timeline();
  T.pass2.events = [{ t: 100, kind: 'end', state: 'lost' }];
  assert.match(planMusic(T, env(), timeMap(T)).success.cue, /^fail_/);
});

test('ambience: the theatre\'s beds at the game\'s own gains, never louder than the cap; night / day layers; sparse barks off screen', () => {
  const T = timeline({ mission: { theater: 'snow', ambience: ambienceFor({ theater: 'snow', id: 'm01' }) } });
  const a = planAmbience(T, env({ source: (id) => (SFX[id] ? { src: `file:/x/${id}`, category: SFX[id].alias[0] } : null) }), timeMap(T));
  const wind = a.beds.find((b) => b.id === 'wind_snow');
  assert.ok(wind);
  near(wind.env[0][1], AMBIENCE.snow[0][1] * LEVEL.amb, 1e-6);
  assert.ok(wind.env.every(([, g]) => g <= bedCap('wind_cold') + 1e-9));
  assert.ok(a.shots.length >= 1 && a.shots.every((s) => s.id === 'dog_bark' && s.at > 15));
  // desert nights keep the crickets, days do not
  const des = (night) => planAmbience(timeline({ mission: { theater: 'desert', night, ambience: ambienceFor({ theater: 'desert', id: 'm08' }) } }), env({ source: (id) => ({ src: `file:/x/${id}`, category: id }) }), timeMap(timeline())).beds.map((b) => b.id);
  assert.ok(des(true).includes('crickets') && !des(false).includes('crickets'));
});

test('ambience: M3\'s waterfall follows the view, ends with the dam, and the river layers share one cap', () => {
  const amb = ambienceFor(MISSIONS.find((m) => m.id === 'm03'));
  assert.ok(amb.some(([id, , o]) => id === 'waterfall' && o.at && o.until === 'dam'));
  const T = timeline({ play: 200, mission: { id: 'm03', theater: 'snow', ambience: amb } });
  // the camera starts at the dam's foot and moves 200 m away over the run; the dam goes at 150 s of the play
  T.frames.forEach((f, i) => { if (!f.card) { f.cx = 40 + ((i - 450) / 30) * 1.2; f.cz = 25; } });
  T.audio.cues = [{ t: 150, destroyed: 'dam' }];
  const tm = timeMap(T), a = planAmbience(T, env({ source: (id) => ({ src: `file:/x/${id}`, category: id === 'waterfall' || id === 'rapids' || id === 'river' ? 'river' : id === 'waterfall_roar' ? 'surf' : 'wind_cold' }) }), tm);
  const fall = a.beds.find((b) => b.id === 'waterfall');
  assert.ok(fall.until <= tm.vt(150) + 2.5 + 1e-6 && fall.until >= tm.vt(150));
  const at = (b, t) => automation(b.env)(t);
  assert.ok(at(fall, 16) > at(fall, 100), 'louder at the foot than far away');
  // the three river layers together stay under one bed's cap (power sum)
  const rivers = a.beds.filter((b) => b.category === 'river');
  for (const t of [1, 16, 60, 120]) assert.ok(Math.sqrt(rivers.reduce((s, b) => s + (t <= b.until ? at(b, t) ** 2 : 0), 0)) <= bedCap('river') + 1e-6, `river sum at ${t}`);
});

test('effects: the game\'s gains and distance model, de-duplication, and footsteps only in the real-time stretches', () => {
  const cues = [
    { t: 10, id: 'pistol_shot', x: 52, z: 50 }, { t: 10.03, id: 'pistol_shot', x: 52.2, z: 50 }, // within 80 ms at the same spot: one
    { t: 12, id: 'rifle_shot', x: 50, z: 50 + 600 }, // far beyond its audible range: culled
    { t: 14, id: 'knife_stab', x: 51, z: 50, g: 1 },
    { t: 16, id: 'step_snow', x: 50, z: 50, g: 0.8 },
  ];
  const T = timeline({ play: 60, speed: 1, cues });
  const fx = planEffects(T, env(), { ...timeMap(T) });
  const ids = fx.shots.map((s) => s.id);
  assert.equal(ids.filter((i) => i === 'pistol_shot').length, 1);
  assert.ok(!ids.includes('rifle_shot'));
  assert.ok(ids.includes('step_snow'));
  const k = fx.shots.find((s) => s.id === 'knife_stab');
  near(k.vol, Math.min(1, SFX.knife_stab.gain * LEVEL.sfx * spatialize({ x: 51, z: 50 }, 50, 50, 40, undefined, SFX.knife_stab.cls, 0.26).gain), 1e-9);
  // the same footstep at 8× is dropped
  const fast = timeline({ play: 60, speed: 8, cues: [{ t: 80, id: 'step_snow', x: 50, z: 50 }, { t: 80, id: 'knife_stab', x: 50, z: 50 }] });
  const f2 = planEffects(fast, env(), timeMap(fast));
  assert.deepEqual(f2.shots.map((s) => s.id), ['knife_stab']);
  // a shot left of the view pans left
  const left = planEffects(timeline({ cues: [{ t: 5, id: 'pistol_shot', x: 40, z: 50 }] }), env(), timeMap(timeline()));
  assert.ok(left.shots[0].pan < 0);
});

test('effects: one recording is never played twice at once (a blast that is an explosion, a collapse and a bomb); the ducks and fish only in real time', () => {
  const same = { source: (id) => ({ src: id === 'collapse' || id === 'explosion_big' ? 'file:/x/explosion_large.ogg' : `file:/x/${id}.ogg`, category: id }) };
  const cues = [{ t: 20, id: 'explosion_big', x: 50, z: 50 }, { t: 20, id: 'collapse', x: 51, z: 50 }, { t: 20.02, id: 'explosion_big', x: 52, z: 50 }, { t: 22, id: 'eider_coo', x: 50, z: 50 }, { t: 23, id: 'fish_splash', x: 50, z: 50 }];
  const T = timeline({ play: 60, speed: 1, cues });
  const fx = planEffects(T, env(same), timeMap(T));
  assert.equal(fx.shots.filter((s) => s.src === 'file:/x/explosion_large.ogg').length, 1);
  assert.equal(fx.shots.filter((s) => s.id === 'eider_coo' || s.id === 'fish_splash').length, 2, 'at 1× the nature is heard');
  const fast = timeline({ play: 60, speed: 8, cues: [{ t: 160, id: 'eider_coo', x: 50, z: 50 }, { t: 170, id: 'duck_takeoff', x: 50, z: 50 }] });
  assert.equal(planEffects(fast, env(same), timeMap(fast)).shots.length, 0, 'at 8× it is not');
});

test('effects: loops pair their starts and stops; a time bomb ticks 2 Hz speeding to 4 Hz; the siren fades; unfinished loops run to the end', () => {
  const cues = [
    { t: 5, id: 'truck_drive', loop: 'veh:truck', on: 1, x: 60, z: 10 }, { t: 25, id: 'truck_drive', loop: 'veh:truck', on: 0 },
    { t: 30, id: 'bomb_tick', loop: 'bomb:b1', on: 1, fuse: 10, x: 50, z: 50 }, { t: 40, id: 'bomb_tick', loop: 'bomb:b1', on: 0 },
    { t: 50, siren: 1, x: 50, z: 50 }, { t: 100, siren: 0 },
    { t: 60, id: 'fire_loop', loop: 'fire:1', on: 1, x: 50, z: 50 },
  ];
  const T = timeline({ play: 120, cues });
  const tm = timeMap(T), fx = planEffects(T, env(), tm);
  const truck = fx.loops.find((l) => l.id === 'truck_drive');
  near(truck.until - truck.at, 20, 0.05);
  assert.ok(fx.loops.some((l) => l.id === 'fire_loop' && l.until > 100));
  const ticks = fx.ticks.map((t) => t.at);
  assert.ok(ticks.length >= 20 && ticks.length <= 32, `${ticks.length} ticks`);
  assert.ok(ticks[1] - ticks[0] > ticks[ticks.length - 1] - ticks[ticks.length - 2], 'speeds up');
  assert.equal(fx.sirens.length, 1);
  near(fx.sirens[0].until - fx.sirens[0].at, 25, 0.1); // 25 s of game time at 1×
});

test('plan: a whole timeline plans to a plain JSON-able object', () => {
  const T = timeline({ mission: { ambience: ambienceFor({ theater: 'coast', id: 'm14' }) }, cues: [{ t: 20, id: 'explosion_big', x: 50, z: 50 }] });
  const plan = planSoundtrack(T, env());
  assert.ok(plan.V > 130 && plan.music.chain.length && plan.beds.length && plan.shots.some((s) => s.id === 'explosion_big'));
  assert.doesNotThrow(() => JSON.stringify(plan));
});

// ---------------------------------------------------------------- the mixer
test('mixer: a sound lands on the right sample at the right gain; pan is equal power; a loop wraps; automation interpolates', () => {
  const imp = { l: new Float32Array([1, 0, 0, 0]), r: new Float32Array([1, 0, 0, 0]), len: 4 };
  const m = new Mix(2);
  m.add(imp, 0.5, { vol: 0.5 });
  assert.equal(m.l[RATE / 2], 0.5); assert.equal(m.r[RATE / 2], 0.5);
  assert.equal(m.l[RATE / 2 + 1], 0);
  const p = new Mix(1); p.add(imp, 0, { pan: -1 });
  near(p.l[0], Math.SQRT2, 1e-6); near(p.r[0], 0, 1e-6);
  const c = new Mix(1); c.add(imp, 0, { pan: 0 });
  near(c.l[0], 1, 1e-6); near(c.r[0], 1, 1e-6);
  const saw = { l: new Float32Array([1, 2, 3, 4]), r: new Float32Array([1, 2, 3, 4]), len: 4 };
  const lp = new Mix(0.001); lp.add(saw, 0, { loop: { from: 0, to: 4 / RATE }, len: 12 / RATE });
  assert.deepEqual([...lp.l.slice(0, 12)], [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4].slice(0, lp.n >= 12 ? 12 : lp.n));
  const g = automation([[0, 0], [10, 1], [20, 1], [30, 0]]);
  near(g(5), 0.5); near(g(15), 1); near(g(25), 0.5); near(g(40), 0);
  const s = seamless({ l: new Float32Array(1000).fill(1), r: new Float32Array(1000).fill(1), len: 1000 }, 100 / RATE);
  assert.equal(s.len, 900);
  assert.ok(s.l.every((v) => Math.abs(v - 1) < 1e-6), 'a constant bed stays constant across the seam');
});

test('mixer: renders a plan through a bank of stand-in sounds, fades the chain at the mission end and rings the success cue', () => {
  const T = timeline({ play: 40, mission: { startCue: 'start_1' } });
  const plan = planSoundtrack(T, env({ source: () => null }));
  const tone = (n, v = 0.1) => ({ l: new Float32Array(n).fill(v), r: new Float32Array(n).fill(v), len: n });
  const bank = { cue: (id) => ({ ...tone(Math.round(((musicManifest.meta[id]?.lengthSec) || 10) * RATE)), meta: musicManifest.meta[id] || {} }), pcm: () => tone(RATE), bed: () => tone(RATE) };
  const mix = renderPlan(plan, bank);
  const at = (s) => Math.abs(mix.l[Math.round(s * RATE)]);
  assert.ok(at(1) > 0 && at(20) > 0, 'the stinger and the chain play');
  assert.ok(mix.n >= plan.V * RATE);
  const end = plan.music.musicEnd;
  assert.ok(at(end + 0.9) < at(end - 1) + 1e-9 || at(end + 0.9) < 0.12, 'the score fades at the end');
});

test('mixer: loops, bomb ticks, the siren and a positional bed all render (stand-in sounds), the siren fading as it goes', () => {
  const cues = [
    { t: 5, id: 'truck_drive', loop: 'veh:truck', on: 1, x: 50, z: 50 }, { t: 25, id: 'truck_drive', loop: 'veh:truck', on: 0 },
    { t: 30, id: 'bomb_tick', loop: 'bomb:b1', on: 1, fuse: 10, x: 50, z: 50 }, { t: 40, id: 'bomb_tick', loop: 'bomb:b1', on: 0 },
    { t: 50, siren: 1, x: 50, z: 50 }, { t: 100, siren: 0 },
    { t: 60, id: 'mg_burst', loop: 'burst:mg', on: 1, x: 50, z: 50 }, { t: 61, id: 'mg_burst', loop: 'burst:mg', on: 0 },
  ];
  const T = timeline({ play: 120, cues, mission: { theater: 'snow', ambience: [['river', 0.3], ['waterfall', 0.6, { at: { x: 50, z: 50 }, until: 'dam' }]] } });
  const plan = planSoundtrack(T, env({ source: (id) => (SFX[id] ? { src: `file:/x/${id}`, category: id === 'river' || id === 'waterfall' ? 'river' : id } : null) }));
  assert.ok(plan.loops.length >= 2 && plan.ticks.length > 10 && plan.sirens.length === 1 && plan.beds.length === 2);
  const tone = (n, v = 0.1) => ({ l: new Float32Array(n).fill(v), r: new Float32Array(n).fill(v), len: n });
  const bank = { cue: (id) => ({ ...tone(RATE), meta: musicManifest.meta[id] || {} }), pcm: () => tone(RATE / 2), bed: () => tone(RATE) };
  const mix = renderPlan(plan, bank);
  const at = (t) => Math.abs(mix.l[Math.round(t * RATE)]);
  const siren = plan.sirens[0];
  assert.ok(at(siren.at + 1) > 0, 'the siren is up');
  assert.ok(at(siren.at + 1) > at(siren.until - 1), 'and fades as it goes');
  const truck = plan.loops.find((l) => l.id === 'truck_drive');
  assert.ok(at((truck.at + truck.until) / 2) > 0, 'the engine runs');
  assert.ok(at(truck.until + 2) < at((truck.at + truck.until) / 2) + 1e-9);
  assert.ok(mix.l.every(Number.isFinite) && mix.r.every(Number.isFinite), 'no NaN');
});

// ---------------------------------------------------------------- the data the films lean on
test('assets: every start, success and fail cue and the whole mission score have recorded chunks on disk', () => {
  const ids = [...CHAPTERS.map((c) => c.start), 'start_6', 'success_1', 'success_2', 'success_3', 'fail_1', 'fail_2', 'fail_3', ...MISSION_CHAIN, 'mission_alert'];
  for (const id of ids) {
    const cue = musicManifest.cues[id];
    assert.ok(cue?.chunks?.length, `${id} has chunks`);
    assert.ok(musicManifest.meta[id] && Number.isFinite(musicManifest.meta[id].lengthSec), `${id} has meta`);
    for (const ch of cue.chunks) assert.ok(existsSync(join(ROOT, 'assets/audio/music', ch.f + '.ogg')), `${ch.f}.ogg`);
  }
  for (const id of MISSION_CHAIN.concat('mission_alert')) assert.ok(Number.isFinite(musicManifest.meta[id].loopStart) && Number.isFinite(musicManifest.meta[id].loopEnd), `${id} loop points`);
});

test('assets: every theatre\'s ambience beds (and the river / waterfall layers) resolve to a recorded take', () => {
  const takes = new Set(sfxManifest.sounds.map((s) => s.category));
  const layers = [...Object.entries(AMBIENCE).flatMap(([t, l]) => l.map((x) => [t, x[0]])), ...Object.entries(MISSION_AMBIENCE).flatMap(([m, l]) => l.map((x) => [m, x[0]]))];
  for (const [where, id] of layers) {
    const def = SFX[id];
    assert.ok(def, `${where}: ${id} is a known sound`);
    assert.ok((def.alias || []).some((c) => takes.has(c)), `${where}: ${id} has a recorded take (${(def.alias || []).join(', ')})`);
    for (const cat of def.alias || []) if (takes.has(cat)) assert.ok(Number.isFinite(bedCap(cat)) && bedCap(cat) > 0.05, `${cat} has a loudness for the bed cap`);
  }
});

test('assets: every mission\'s start stinger exists and every mission def gives the mix a theatre', () => {
  for (const m of MISSIONS) {
    const cue = startCueFor(m);
    assert.ok(musicManifest.cues[cue], `${m.id}: ${cue}`);
    assert.ok(ambienceFor(m).length >= 1, `${m.id}: ambience layers`);
  }
});

test('assets: the sound bank decodes a recorded take through ffmpeg when one is installed, else the check is skipped', async () => {
  let FF;
  try { FF = findFfmpeg(); } catch { return; } // (no ffmpeg here: nothing to decode with)
  const { synth } = await import('../../src/audio/synth.js');
  const bank = new SoundBank({ ff: FF, root: ROOT, synth, musicManifest });
  const w = bank.pcm(`file:${join(ROOT, 'assets/audio/sfx/knife_stab/knife_stab_344404_0.ogg')}`);
  assert.ok(w.len > 2000 && Math.max(...w.l.slice(0, 20000)) > 0.01);
  const s = bank.pcm('synth:whoosh');
  assert.ok(s.len > 1000);
  const c = bank.cue('success_1'); // chunks stitched back to the cue's length
  near(c.len / RATE, musicManifest.meta.success_1.lengthSec, 0.01);
  let peak = 0; for (let i = 0; i < c.len; i += 97) peak = Math.max(peak, Math.abs(c.l[i]));
  assert.ok(peak > 0.05, 'the cue has sound in it');
});

test('mix-video: a tiny synthetic capture encodes to an MP4 that decodes cleanly and carries the soundtrack', async () => {
  let FF;
  try { FF = findFfmpeg(); } catch { return; }
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'film-'));
  try {
    mkdirSync(join(dir, 'frames'));
    const g = spawnSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10', '-frames:v', '120', join(dir, 'frames/%06d.jpg')]);
    assert.equal(g.status, 0);
    const T = timeline({ open: 3, play: 4, fps: 10, mission: { theater: 'snow', ambience: ambienceFor({ theater: 'snow', id: 'm01' }) }, cues: [{ t: 1, id: 'knife_stab', x: 50, z: 50 }, { t: 2, id: 'explosion_big', x: 52, z: 50 }, { t: 3, id: 'harpoon_fire', x: 50, z: 50 }] });
    T.pass2.events = [{ t: 3.9, kind: 'end', state: 'won' }];
    assert.equal(T.frames.length, 120);
    writeFileSync(join(dir, 'timeline.json'), JSON.stringify(T));
    const out = join(dir, 'film.mp4');
    const r = spawnSync(process.execPath, [join(ROOT, 'tools/solutions/mix-video.mjs'), dir, out, '--ffmpeg', FF, '--crf', '35'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(statSync(out).size > 5000);
    const dec = spawnSync(FF, ['-v', 'error', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(dec.status, 0);
    assert.equal(dec.stderr.trim(), '');
    const info = spawnSync(FF, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr;
    assert.match(info, /Video: h264/);
    assert.match(info, /Audio: aac/);
    const vol = spawnSync(FF, ['-hide_banner', '-nostats', '-i', out, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    assert.ok(+/max_volume: (-?[\d.]+) dB/.exec(vol)[1] > -30, 'the film has sound in it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('film-ffmpeg: finds an ffmpeg that can encode H.264 + AAC (or says so), and honours --ffmpeg', async () => {
  const { spawnSync } = await import('node:child_process');
  let bin;
  try { bin = findFfmpeg(); } catch (e) { assert.match(e.message, /no ffmpeg with libx264/); return; }
  const enc = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout;
  assert.match(enc, /libx264/);
  assert.equal(findFfmpeg(bin), bin);
  assert.equal(findFfmpeg('/nonexistent/ffmpeg'), bin, 'a bad request falls back rather than failing');
});

// ---------------------------------------------------------------- the cuts (tools/solutions/<id>.cut.mjs)
test('m01.cut: the raft\'s wait is filmed from the beach; windows, shots and notes line up with the checkpoints and the captions can be read', async () => {
  const { shots, windows, notes, CAPTIONS } = await import('../../tools/solutions/m01.cut.mjs');
  const at = { D2: 259.6, D3: 694.5 }, cp = (k) => at[k];
  const W = windows(cp), S = shots(cp), N = notes(cp);
  assert.ok(W.length >= 4);
  for (let i = 1; i < W.length; i++) near(W[i].t0, W[i - 1].t1, 1e-9, 'the windows run on from one another');
  assert.ok(W[0].t0 > at.D2 && W[0].speed >= 32, 'the wait is a time-lapse, not a parked raft at 16×');
  assert.ok(W.slice(1).every((x) => x.speed <= 6), 'the gap, the dash, the landing and e4\'s return are slow enough to follow');
  assert.ok(W[W.length - 1].t1 > at.D3, 'e4\'s return, after the dig-in, is filmed too');
  assert.ok(S.every((s) => s.t0 >= at.D2 && s.t1 > s.t0 && Number.isFinite(s.x) && Number.isFinite(s.z) && s.zoom > 0.3 && s.zoom < 1.3), 'shots lie in the stretch and frame something');
  assert.ok(S[0].z < 60, 'the first shot is on the north beach, not on the raft (z 81)');
  for (let i = 1; i < N.length; i++) assert.ok(N[i].t0 >= N[i - 1].t1 - 1e-9, 'notes do not overlap');
  for (const n of N) {
    assert.ok(n.text.length <= 150, 'a note fits the caption box');
    let film = 0; // film seconds the note is on screen: each window's share of it, at that window's speed
    for (const w of W) film += Math.max(0, Math.min(n.t1, w.t1) - Math.max(n.t0, w.t0)) / w.speed;
    assert.ok(film >= n.text.length / 15, `"${n.text.slice(0, 30)}…" is on screen ${film.toFixed(1)} s: too short to read at 15 characters a second`);
  }
  for (const c of Object.values(CAPTIONS)) assert.ok(c.length <= 150);
  assert.deepEqual([windows(() => undefined), shots(() => undefined), notes(() => undefined)], [[], [], []], 'a run without those checkpoints gets no cut');
});

test('m11.cut: the Sapper\'s three charges are filmed in real time and the camera visits the rigs the quarry burst left out of the picture', async () => {
  const { shots, windows, notes, TITLES } = await import('../../tools/solutions/m11.cut.mjs');
  const at = { G2: 941.9 }, cp = (k) => at[k];
  const ev = [ // (pass 1's events: the yard rig's charge, the tunnel mouth's, the valley rig's; a kill and a blast are not charges)
    { t: 299.6, kind: 'plant', what: 'remote', by: 'sapper', x: 31.5, y: 0, z: 84.2 },
    { t: 120, kind: 'kill', tag: 'e21', x: 80, y: 0, z: 90 },
    { t: 596.2, kind: 'plant', what: 'remote', by: 'sapper', x: 51.3, y: 6, z: 32.6 },
    { t: 745.4, kind: 'plant', what: 'remote', by: 'sapper', x: 89.5, y: 0, z: 80.5 },
    { t: 941.9, kind: 'blast', what: 'structure', x: 80, y: 6, z: 33 },
  ];
  const W = windows(cp, () => undefined, ev), S = shots(cp, () => undefined, ev), N = notes(cp, () => undefined, ev);
  assert.equal(W.length, 4, 'one window per charge, one for the visit');
  assert.ok(W.every((w) => w.speed <= 1.5 && w.t1 > w.t0), 'real time: nobody is a dot at 8×');
  for (const [i, p] of ev.filter((e) => e.kind === 'plant').entries()) assert.ok(W[i].t0 < p.t && W[i].t1 > p.t + 1, `charge ${i + 1}: from before his hand goes down (1 s) to after the bomb is there`);
  const plantShots = S.slice(0, 3);
  assert.deepEqual(plantShots.map((s) => [s.x, s.z]), [[31.5, 84.2], [51.3, 32.6], [89.5, 80.5]], 'each charge is filmed where it was set');
  const tour = S.slice(3);
  assert.equal(tour.length, 3);
  assert.ok(tour[0].t0 >= at.G2 + 5 - 1e-9, 'the visit starts after the director\'s own quarry shot (5 s after the burst)');
  for (let i = 1; i < tour.length; i++) near(tour[i].t0, tour[i - 1].t1, 1e-9, 'the shots of the visit run on from one another');
  assert.ok(tour[0].z > 80 && tour[0].x < 40, 'first the yard rig (30.5, 89)');
  assert.ok(tour[1].z < 40 && tour[1].x > 45 && tour[1].x < 60, 'then the tunnel mouth (53, 30)');
  assert.ok(tour[2].x > 90 && tour[2].z > 75, 'then the valley rig (95, 81.5)');
  assert.ok(S.every((s) => s.t1 > s.t0 && Number.isFinite(s.x) && Number.isFinite(s.z) && s.zoom > 0.3 && s.zoom < 1.3), 'shots frame something');
  assert.ok(tour.every((s) => (s.prio ?? 0) >= 1), 'the visit wins over a kill shot that overlaps it');
  near(W[3].t0, tour[0].t0, 1e-9, 'the visit\'s window covers its shots'); near(W[3].t1, tour[2].t1, 1e-9);
  assert.equal(N.length, 6);
  for (let i = 1; i < N.length; i++) assert.ok(N[i].t0 >= N[i - 1].t1 - 1e-9, 'notes do not overlap');
  for (const n of N) {
    assert.ok(n.text.length <= CAPTION_MAX, 'a note fits the caption box');
    let film = 0; // film seconds the note is on screen: each window's share of it, at that window's speed
    for (const w of W) film += Math.max(0, Math.min(n.t1, w.t1) - Math.max(n.t0, w.t0)) / w.speed;
    assert.ok(film >= readingTime(n.text), `"${n.text.slice(0, 30)}…" is on screen ${film.toFixed(1)} s: less than its reading time`);
  }
  assert.match(TITLES.H, /^H · /, 'the stage title that runs through the visit still names its stage');
  const noPlants = notes(cp, () => undefined, []);
  assert.equal(noPlants.length, 3, 'without the charges the step captions are left alone (only the visit is worded)');
  assert.deepEqual([windows(() => undefined, () => undefined, []), shots(() => undefined, () => undefined, []), notes(() => undefined, () => undefined, [])], [[], [], []], 'a run without those checkpoints or charges gets no cut');
});

test('m08.cut: the Sniper\'s 16-minute wait is filmed from a wide shot of the store at 36×, ending before the first shot; the start yard\'s wait likewise; the notes can be read', async () => {
  const { shots, windows, notes } = await import('../../tools/solutions/m08.cut.mjs');
  const at = { A1: 145.3, Q2: 2658.4, Q3: 3633.1 }, cp = (k) => at[k]; // (the checkpoints of the film's run; the first of the three shots is ~7 s before Q3, its scope show a few seconds before that)
  const W = windows(cp), S = shots(cp), N = notes(cp);
  assert.equal(W.length, 2);
  assert.ok(W.every((x) => x.t1 > x.t0 && x.speed >= 32), 'the waits are time-lapses, not a parked Sniper at 16×');
  assert.ok(W[0].t1 < at.A1 - 5, 'the start yard\'s window ends before the scope show of the first shot');
  assert.ok(W[1].t0 > at.Q2 && W[1].t1 <= at.Q3 - 15, 'the store\'s window ends before the first of the three shots');
  assert.equal(S.length, 1);
  assert.ok(S[0].t0 > at.Q2 && S[0].t1 <= at.Q3 - 10 && S[0].t1 > S[0].t0, 'the shot lies in the wait and hands over to the kills\' own shots');
  assert.ok(S[0].zoom <= 0.55, 'a wide shot (64 m across at zoom 0.5): the road, the decoy, the walkers, the roof and the tank decks in one picture');
  assert.ok(Math.abs(S[0].x - 46) < 8 && S[0].z > 44 && S[0].z < 56, 'centred on the north side of the store');
  for (let i = 1; i < N.length; i++) assert.ok(N[i].t0 >= N[i - 1].t1 - 1e-9, 'notes do not overlap');
  for (const n of N) {
    assert.ok(n.text.length <= CAPTION_MAX, 'a note fits the caption box');
    let film = 0; // film seconds the note is on screen: each window's share of it, at that window's speed
    for (const w of W) film += Math.max(0, Math.min(n.t1, w.t1) - Math.max(n.t0, w.t0)) / w.speed;
    assert.ok(film >= readingTime(n.text), `"${n.text.slice(0, 30)}…" is on screen ${film.toFixed(1)} s: too short to read`);
  }
  assert.deepEqual([windows(() => undefined), shots(() => undefined), notes(() => undefined)], [[], [], []], 'a run without those checkpoints gets no cut');
});

// ---------------------------------------------------------------- the camera's ground and the step captions
test('m13.cut: the wait framing is on, the Sapper\'s charge and the fuel tanks\' blast are filmed in real time (the rest is the generic director\'s)', async () => {
  const { FRAME_WAITS, shots, windows, notes } = await import('../../tools/solutions/m13.cut.mjs');
  assert.equal(FRAME_WAITS, true);
  const objAt = { o_ship: 2897.1, o_fuel: 2897.3 }, objT = (o) => objAt[o], cp = () => undefined;
  const ev = [ // (pass 1's events: the Sapper's remote charge under the tanks' cradle; a kill is not a charge)
    { t: 2295.7, kind: 'kill', tag: 'e16', x: 65.5, y: 0, z: 34.6 },
    { t: 2315.9, kind: 'plant', what: 'remote', by: 'sapper', x: 76.3, y: 4.4, z: 43.8 },
  ];
  const W = windows(cp, objT, ev), S = shots(cp, objT, ev), N = notes(cp, objT, ev);
  assert.deepEqual([W.length, S.length, N.length], [2, 2, 2], 'the charge and the visit to the tanks');
  assert.ok(W.every((w) => w.speed <= 1.5 && w.t1 > w.t0), 'real time: the Sapper is a dot at 8x');
  assert.ok(W[0].t0 < 2315.9 - 1 && W[0].t1 > 2315.9 + 1, 'the charge: from before his hand goes down (1 s) to after the bomb is there');
  assert.deepEqual([S[0].x, S[0].y, S[0].z], [76.3, 4.4, 43.8], 'the charge is filmed where it was set');
  // the visit: after the director\'s own shot of the torpedo\'s blast (5 s after it), on the two tanks (76, 33.5) and (77.5, 38.2)
  assert.ok(S[1].t0 >= 2897.3 + 5 - 1e-9 && S[1].t1 > S[1].t0, 'the visit starts after the director\'s shot of the ship');
  assert.ok(Math.hypot(S[1].x - 76.75, S[1].z - 35.85) < 3, 'centred on the two tanks');
  assert.ok(S[1].zoom >= 0.5 && S[1].zoom <= 0.8 && (S[1].prio ?? 0) >= 1, 'a medium shot that wins over a kill shot that overlaps it');
  near(W[1].t0, S[1].t0, 1e-9, 'the visit\'s window covers its shot'); near(W[1].t1, S[1].t1, 1e-9);
  for (let i = 1; i < N.length; i++) assert.ok(N[i].t0 >= N[i - 1].t1 - 1e-9, 'notes do not overlap');
  for (const n of N) {
    assert.ok(n.text.length <= CAPTION_MAX, 'a note fits the caption box');
    let film = 0; // film seconds the note is on screen: each window\'s share of it, at that window\'s speed
    for (const w of W) film += Math.max(0, Math.min(n.t1, w.t1) - Math.max(n.t0, w.t0)) / w.speed;
    assert.ok(film >= readingTime(n.text), `"${n.text.slice(0, 30)}…" is on screen ${film.toFixed(1)} s: less than its reading time`);
  }
  assert.deepEqual([windows(cp, () => undefined, []), shots(cp, () => undefined, []), notes(cp, () => undefined, [])], [[], [], []], 'a run without the charge or the objectives gets no cut');
  assert.deepEqual(Object.keys(await import('../../tools/solutions/m13.cut.mjs')).sort(), ['FRAME_WAITS', 'notes', 'shots', 'windows'], 'nothing else is overridden: titles, captions and cards stay the generic ones');
});

test('m15.cut: only the wait framing is switched on (the rest is the generic director\'s)', async () => {
  const cut = await import('../../tools/solutions/m15.cut.mjs');
  assert.equal(cut.FRAME_WAITS, true, 'a stealth mission of waits: the camera shows the guards the wait is for');
  assert.deepEqual(Object.keys(cut), ['FRAME_WAITS'], 'nothing else is overridden: titles, captions, cards, shots and speeds stay the generic ones');
});

test('film-camera: the view is centred on the walking surface (a deck), not on the terrain relief under it', () => {
  // M5: the summit is a 16 m deck; the barracks' footprint (a 6 m radius here) has no walking surface and the relief under it says 0.5
  const world = { groundY: () => 0.5, grid: { surfaceY: (x, z) => (Math.hypot(x - 100, z - 50) < 6 ? 0 : 16) } };
  near(standHeight(world, 100, 50), 16, 1e-9, 'the barracks\' centre sits on the deck');
  near(standHeight(world, 80, 50), 16, 1e-9, 'beside it too');
  near(standHeight({ groundY: () => 0.3, grid: { surfaceY: () => 0 } }, 5, 5), 0.3, 1e-9, 'flat land keeps the terrain relief');
  near(standHeight({ groundY: () => 0.3 }, 5, 5), 0.3, 1e-9, 'a world without the grid keeps it too');
  near(standHeight({ grid: { surfaceY: () => NaN } }, 5, 5), 0, 1e-9, 'nothing usable: the ground');
  near(standHeight(null, 5, 5), 0, 1e-9, 'no world: the ground');
});

test('film-camera: a wait is framed on the waiting man and the guards the step names, each by his whole beat', () => {
  const man = { x: 50, y: 0, z: 100 };
  const walker = (tag, x0, z0, x1, z1) => ({ tag, x: x0, z: z0, route: [{ x: x0, z: z0 }, { x: x1, z: z1 }] });
  const e6 = walker('e6', 81, 108, 74, 108), e7 = walker('e7', 70, 108, 46, 106), sentry = { tag: 'e3', x: 58, z: 96 };
  // the named guards: the man, then each beat's two ends (a sentry where he stands)
  const pts = waitPoints(man, [e6, e7, sentry, walker('e9', 5, 80, 9, 84)], new Set(['e6', 'e7', 'e3']));
  assert.deepEqual(pts.map((p) => [p.x, p.z]), [[50, 100], [81, 108], [74, 108], [70, 108], [46, 106], [58, 96]], 'man, e6\'s beat, e7\'s beat, the sentry');
  assert.ok(pts.every((p) => p.y === 0), 'heights are carried (the framing maths uses them)');
  // a guard of the step beyond 48 m does not count; with none left the walkers near the man do (nearest three)
  assert.equal(waitPoints(man, [walker('e1', 120, 100, 124, 100)], new Set(['e1'])), null, 'named but far, and not near enough to be a walker either');
  const four = [walker('a', 60, 100, 64, 100), walker('b', 40, 100, 36, 100), walker('c', 50, 110, 54, 110), walker('d', 50, 120, 54, 120)];
  assert.equal(waitPoints(man, four, new Set(['zz'])).length, 1 + 3 * 2, 'no named guard near: the three nearest walkers, by their beats');
  assert.equal(waitPoints(man, [sentry], new Set()), null, 'a sentry is no walker: with nothing named there is nothing to show');
  // the dead, the removed and men on vehicles are not shown
  assert.equal(waitPoints(man, [{ ...e6, alive: false }, { ...e7, removed: true }, { ...sentry, vehicle: {} }], new Set(['e6', 'e7', 'e3'])), null, 'nobody live to show');
  // a long patrol counts where it is, not by its 60 m beat; and it is no walker to show when nobody is named
  const patrol = { ...walker('p11a', 66, 108, 62, 48), x: 66, z: 100 };
  assert.deepEqual(waitPoints(man, [patrol], new Set(['p11a'])).slice(1).map((p) => [p.x, p.z]), [[66, 100]], 'a named patrol: where he stands');
  assert.equal(waitPoints(man, [patrol], new Set()), null, 'a patrol on the move is not chased: with nobody else near there is no wait framing');
  // a walker at the edge of the range does not come and go as he paces: his beat's nearest end counts
  const edge = (x) => ({ ...walker('e7', 97, 100, 99, 100), x }); // the man is 47 to 49 m from the beat
  assert.ok(waitPoints(man, [edge(97)], new Set(['e7'])) && waitPoints(man, [edge(99)], new Set(['e7'])), 'in range from his beat\'s nearest end, wherever he is on it (49 m off at the far end)');
});

test('film-camera: the wait framing keeps the man in the picture, between his guards and a medium shot, never closer than the film\'s usual view', () => {
  const view = { az: 0, el: (40 * Math.PI) / 180, width: 1280, height: 720, ppm1: 40 };
  const man = { x: 50, y: 0, z: 100 };
  const g = (tag, x, z, x1 = x + 3, z1 = z) => ({ tag, x, z, route: [{ x, z }, { x: x1, z: z1 }] });
  const f = waitFrame(man, [g('e6', 70, 106), g('e7', 46, 108)], new Set(['e6', 'e7']), view);
  assert.ok(f.zoom >= WAIT_FRAME.opts.minZoom && f.zoom <= WAIT_FRAME.opts.maxZoom, `zoom ${f.zoom} within the wait range`);
  assert.ok(f.x > 46 && f.x < 73 && f.z > 98 && f.z < 110, 'centred between the man and his guards');
  // a close guard: no tighter than the usual view
  const close = waitFrame(man, [g('e6', 53, 101)], new Set(['e6']), view);
  assert.ok(close.zoom <= WAIT_FRAME.opts.maxZoom + 1e-9, 'a man and one guard close by: the usual view at the closest');
  // a guard too far to fit with the man (the widest zoom): the man wins, the guard is left out
  const wide = waitFrame(man, [g('e6', 50, 100 + 46, 50, 100 + 47)], new Set(['e6']), view);
  assert.ok(wide.zoom >= WAIT_FRAME.opts.minZoom - 1e-9 && Math.hypot(wide.x - man.x, wide.z - man.z) < 30, 'the man stays in the picture');
  assert.equal(waitFrame(man, [], new Set(['e6']), view), null, 'no guard: no wait framing (the usual view of the man)');
});

test('film-captions: a step is its first sentence, and the next ones while they fit; a long one is cut at a word', () => {
  assert.equal(captionText('One. Two. Three.'), 'One. Two. Three.');
  assert.equal(captionText('e8 still looks out over the camp. In uniform the Spy walks up behind him and injects him.'), 'e8 still looks out over the camp. In uniform the Spy walks up behind him and injects him.');
  const long = 'A '.repeat(60).trim() + '. Next sentence that would not fit the box.';
  assert.ok(captionText(long).length <= CAPTION_MAX && !captionText(long).includes('Next'), 'the second sentence is left out when it does not fit');
  const one = 'word '.repeat(60).trim() + '.';
  const cut = captionText(one);
  assert.ok(cut.length <= CAPTION_MAX && cut.endsWith('…') && !/\s…$/.test(cut), 'one long sentence is cut at a word with an ellipsis');
  assert.equal(captionText(''), '');
  assert.equal(firstSentence('Short one. Another one.'), 'Short one.', 'the cut-based films keep the first sentence alone');
  assert.ok(readingTime('x') === READ_MIN && readingTime('x'.repeat(1000)) === READ_MAX && readingTime('x'.repeat(96)) > READ_MIN, 'reading time is bounded');
});

test('film-captions: without a cut a step\'s text goes up when the step begins and stays until its checkpoint; a cut of its own keeps its convention', () => {
  const names = ['A1 crawls to e4', 'A2 knifes e4', 'B1 takes the uniform'];
  const steps = [{ cp: 'A1', say: 'He crawls round the kennel.' }, { cp: 'A2', say: 'He stands and knifes e4.' }];
  const lead = captionPlan({ names, steps });
  assert.equal(lead.lead, true);
  assert.deepEqual([0, 1, 2, 3].map((i) => lead.at(i)), ['He crawls round the kennel.', 'He stands and knifes e4.', 'takes the uniform', ''], 'step k is up from checkpoint k-1 to k; a step the walkthrough lacks has its checkpoint\'s name; nothing after the last');
  const own = captionPlan({ names, steps, cutCaptions: { A1: 'a', A2: 'b', B1: 'c' } });
  assert.equal(own.lead, false);
  assert.deepEqual([0, 1, 2, 3].map((i) => own.at(i)), ['', 'a', 'b', 'c'], 'a cut\'s captions go up AT their checkpoint');
  const mend = captionPlan({ names, steps, cutCaptions: { B1: 'mended' } });
  assert.equal(mend.lead, true, 'a cut that words one step (M1\'s D4) leaves the rest to the walkthrough');
  assert.equal(mend.at(2), 'mended');
  assert.equal(mend.textOf('A2 knifes e4'), 'He stands and knifes e4.');
});

test('film-captions: the queue gives each caption its reading time, drops a caption a later one overtakes, and clears at the end', () => {
  const q = captionQueue();
  q.due('first caption', 0);
  assert.equal(q.text, 'first caption', 'the first goes up at once');
  q.due('second', 1);
  q.tick(1);
  assert.equal(q.text, 'first caption', 'still being read');
  q.due('third', 1.5);
  q.tick(1.5);
  assert.equal(q.text, 'first caption');
  q.tick(READ_MIN - 0.01 + 0);
  assert.equal(q.text, 'first caption');
  q.tick(READ_MIN + 0.01);
  assert.equal(q.text, 'third', 'the second was overtaken and is dropped; the third goes up when the first has been read');
  q.due('third', 9);
  assert.equal(q.text, 'third', 'the same text again changes nothing');
  q.due('', 9.1);
  assert.equal(q.text, '', 'an empty text clears (after the last checkpoint)');
  q.due('late', 9.2);
  assert.equal(q.text, 'late', 'an empty screen takes the next caption at once');
  const lag = captionQueue();
  lag.due('x'.repeat(160), 0);
  lag.due('next', 0.5);
  lag.tick(READ_MAX - 0.1);
  assert.equal(lag.text.length, 160);
  lag.tick(READ_MAX + 0.01);
  assert.equal(lag.text, 'next', 'a long caption holds the next for at most READ_MAX');
});

test('film-captions: every walkthrough in the repository gives captions that fit the box, one per checkpoint it names', async () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../tools/solutions');
  const files = (await import('node:fs')).readdirSync(dir).filter((f) => /^m\d+\.walkthrough\.mjs$/.test(f));
  assert.ok(files.length >= 8, 'the walkthroughs are found');
  for (const f of files) {
    const { WALKTHROUGH: W } = await import(join(dir, f));
    const plan = captionPlan({ names: W.steps.map((x) => `${x.cp} name`), steps: W.steps });
    for (let i = 0; i < W.steps.length; i++) {
      const t = plan.at(i);
      assert.ok(t.length > 0 && t.length <= CAPTION_MAX + 1, `${f} ${W.steps[i].cp}: ${t.length} characters`);
    }
    assert.equal(plan.at(W.steps.length), '');
  }
});
