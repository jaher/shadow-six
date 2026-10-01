/** MUSIC DIRECTOR (src/audio/music-director.js): chain order, threat state machine, bar-synced alert, pause, end. */
import { test, assert, near } from './lib.mjs';
import { MockAudioContext } from './audio-mock.mjs';
import { MusicDirector, ThreatTracker, nextSegment, MISSION_CHAIN, ALERT_CUE, CALM_HOLD, PAUSE_GAIN } from '../../src/audio/music-director.js';

const BAR = 240 / 84;
/** Fake cue library on the shipped grid: segments have a 1-bar intro, bodies of n bars and a 4 s tail. */
export const LIB = {
  start_1: { len: 15.43, meta: { endSec: 11.43, bpm: 84 } },
  mission_tension_a: { len: 126.86, meta: { loopStart: BAR, loopEnd: 43 * BAR, bpm: 84 } },
  mission_tension_b: { len: 155.43, meta: { loopStart: BAR, loopEnd: 53 * BAR, bpm: 84 } },
  mission_tension_c: { len: 155.43, meta: { loopStart: BAR, loopEnd: 53 * BAR, bpm: 84 } },
  mission_bridge_1: { len: 29.7, meta: { loopStart: BAR, loopEnd: 9 * BAR, bpm: 84 } },
  mission_bridge_2: { len: 29.7, meta: { loopStart: BAR, loopEnd: 9 * BAR, bpm: 84 } },
  mission_bridge_3: { len: 29.7, meta: { loopStart: BAR, loopEnd: 9 * BAR, bpm: 84 } },
  mission_alert: { len: 75.43, meta: { loopStart: BAR, loopEnd: 25 * BAR, bpm: 84 } },
  menu: { len: 164, meta: { loopStart: 10, loopEnd: 160, bpm: 96 } },
  success_1: { len: 15.9, meta: { endSec: 11.4 } },
};
export const flush = () => new Promise((r) => setTimeout(r, 0));
export function fakeLoad(ctx, lib = LIB) {
  return (id) => Promise.resolve(lib[id] ? { buffer: ctx.createBuffer(2, Math.round(lib[id].len * 100), 100), meta: { ...lib[id].meta } } : null);
}
function rig(lib = LIB) {
  const ctx = new MockAudioContext();
  const out = ctx.createGain();
  const d = new MusicDirector({ ctx, out, load: fakeLoad(ctx, lib), has: (id) => !!lib[id] });
  // tag sources with their cue id
  const orig = d._src.bind(d);
  d._src = (res, bus, at, o) => { const h = orig(res, bus, at, o); h.src._cue = res.id; return h; };
  return { ctx, d };
}
/** Advance the mock clock in steps, ticking the director (as the 250 ms timer does). */
async function run(r, until, step = 0.25) {
  while (r.ctx.currentTime < until) { r.ctx.currentTime = +(r.ctx.currentTime + step).toFixed(4); r.d.update(); await flush(); }
}

test('nextSegment: cycles the chain, skips missing cues, never repeats back-to-back', () => {
  assert.equal(nextSegment(null), MISSION_CHAIN[0]);
  for (let i = 0; i < MISSION_CHAIN.length; i++) assert.equal(nextSegment(MISSION_CHAIN[i]), MISSION_CHAIN[(i + 1) % MISSION_CHAIN.length]);
  const onlyTension = (id) => /tension/.test(id);
  assert.equal(nextSegment('mission_tension_a', onlyTension), 'mission_tension_b');
  assert.equal(nextSegment('mission_tension_c', onlyTension), 'mission_tension_a');
  assert.equal(nextSegment('mission_tension_a', (id) => id === 'mission_tension_a'), 'mission_tension_a', 'only one → it loops');
  assert.equal(nextSegment('mission_tension_a', () => false), null);
  // shipped lengths: one full cycle lasts ≥ 8 min before any exact repeat
  const total = MISSION_CHAIN.reduce((s, id) => s + LIB[id].meta.loopEnd - LIB[id].meta.loopStart, 0);
  assert.ok(total >= 480, `cycle ${total.toFixed(1)} s`);
});

test('ThreatTracker: alarm or hot enemies → alert; calm only after CALM_HOLD', () => {
  const t = new ThreatTracker();
  assert.equal(t.update(0), false);
  assert.equal(t.setEnemy('e1', 'COMBAT', 1), true);
  assert.equal(t.setEnemy('e1', 'IDLE', 2), true, 'held');
  assert.equal(t.update(2 + CALM_HOLD - 0.1), true);
  assert.equal(t.update(2 + CALM_HOLD + 0.1), false);
  assert.equal(t.setAlarm(true, 20), true);
  t.setEnemy('e2', 'SEARCH', 21); t.setAlarm(false, 22);
  assert.equal(t.update(40), true, 'a searching enemy keeps it up');
  t.drop('e2', 41);
  assert.equal(t.update(41 + CALM_HOLD + 0.01), false);
});

test('director: start stinger flows straight into the tension chain; segments chain with no gap', async () => {
  const r = rig();
  r.d.startMission({ stinger: 'start_1' });
  await flush(); await flush();
  const st = r.ctx.started.find((s) => s._cue === 'start_1');
  const a = r.ctx.started.find((s) => s._cue === 'mission_tension_a');
  assert.ok(st && a, 'stinger and segment A scheduled');
  near(a.started - st.started, 11.43, 1e-6, 'A starts at the stinger hand-over point');
  assert.equal(a.offset, 0, 'first segment plays its intro bar');
  await run(r, 140);
  const b = r.ctx.started.find((s) => s._cue === 'mission_bridge_1');
  assert.ok(b, 'bridge 1 chained');
  near(b.started, a.started + 43 * BAR, 1e-6, 'bridge starts exactly at A\'s loop end (no gap, no overlap)');
  near(b.offset, BAR, 1e-6, 'chained segments skip their intro bar');
  await run(r, 700, 0.5);
  const order = r.d.history;
  assert.deepEqual(order.slice(0, 7), [...MISSION_CHAIN, MISSION_CHAIN[0]], order.join());
  for (let i = 1; i < order.length; i++) assert.notEqual(order[i], order[i - 1], 'no back-to-back repeat');
});

test('director: alert layer crossfades in on a bar line and back out after calm; pause lowers, end stinger stops', async () => {
  const r = rig();
  r.d.startMission({ stinger: 'start_1' });
  await flush(); await flush();
  await run(r, 30);
  r.d.setAlarm(true);
  r.d.update(); await flush(); r.d.update(); await flush();
  const al = r.ctx.started.find((s) => s._cue === ALERT_CUE);
  assert.ok(al, 'alert layer started');
  const k = (al.started - r.d.grid.origin) / BAR;
  near(k, Math.round(k), 1e-6, 'alert enters on a bar line of the tension grid');
  assert.equal(al.loop, true); near(al.loopEnd, 25 * BAR, 1e-9);
  assert.equal(r.d.debug().alert, true);
  near(r.d.alertBus.gain.value, 1); near(r.d.tensionBus.gain.value, 0);
  r.d.setAlarm(false);
  await run(r, r.ctx.currentTime + CALM_HOLD + 1);
  assert.equal(r.d.debug().alert, false, 'calm → alert leaves');
  near(r.d.tensionBus.gain.value, 1, 1e-9, 'tension back');
  await run(r, r.ctx.currentTime + 3 * BAR);
  assert.ok(r.ctx.started.some((s) => /tension|bridge/.test(s._cue) && s.stopped == null), 'tension never stopped');
  r.d.setPaused(true);
  near(r.d.master.gain.value, PAUSE_GAIN, 1e-9, 'paused: reduced, not silent');
  r.d.setPaused(false);
  near(r.d.master.gain.value, 1);
  r.d.endMission('success_1');
  await flush();
  assert.equal(r.d.state, 'ended');
  assert.ok(r.ctx.started.filter((s) => /tension|bridge|alert/.test(s._cue)).every((s) => s.stopped != null), 'score stopped');
  assert.ok(r.ctx.started.some((s) => s._cue === 'success_1'), 'end stinger');
});

test('director: a cue without a recorded file is silence (no placeholder), a missing next segment repeats instead of a gap', async () => {
  const lib = { mission_tension_a: LIB.mission_tension_a };
  const r = rig(lib);
  r.d.playBed('menu');
  await flush();
  assert.equal(r.ctx.started.length, 0, 'no menu file → nothing plays');
  r.d.startMission({ stinger: 'start_1' });
  await flush(); await flush();
  await run(r, 130);
  assert.deepEqual(r.d.history, ['mission_tension_a', 'mission_tension_a']);
});

test('ThreatTracker: REINFORCE (released squads keep it all mission) is not a threat once the alarm is over', () => {
  const t = new ThreatTracker();
  t.setAlarm(true, 0);
  for (let i = 0; i < 11; i++) t.setEnemy(`e${i}`, 'REINFORCE', 1);
  assert.equal(t.update(10), true, 'the alarm holds the alert');
  t.setAlarm(false, 50);
  assert.equal(t.update(50 + CALM_HOLD + 0.1), false, 'calm after the siren despite 11 REINFORCE enemies');
});

test('director: a stalled clock (past LOOKAHEAD) re-bases the next segment on the next bar — no overlap, on grid', async () => {
  const r = rig();
  r.d.startMission({ stinger: 'start_1' });
  await flush(); await flush();
  await run(r, 20);
  const a = r.d.seg;
  r.ctx.currentTime = a.endAt + 22; // 60 s tick style stall: way past A's body end
  r.d.update(); await flush();
  const b = r.d.seg;
  assert.equal(b.id, 'mission_bridge_1');
  assert.ok(b.at >= r.ctx.currentTime, `starts now or later (${b.at.toFixed(2)} vs ${r.ctx.currentTime})`);
  assert.ok(b.endAt > r.ctx.currentTime + 10, 'endAt re-based into the future');
  const k = (b.at - r.d.grid.origin) / r.d.grid.bar;
  near(k, Math.round(k), 1e-6, 'on a bar line of the grid');
  r.d.update(); await flush();
  assert.equal(r.d.seg, b, 'no immediate second chain (no overlapping segments)');
  await run(r, b.endAt + 1);
  const c = r.d.seg;
  assert.equal(c.id, 'mission_tension_b');
  near(c.at, b.endAt, 1e-6, 'back to gapless chaining');
});

test('director: the tension chain sits under a trim; the alert layer does not', () => {
  const r = rig();
  assert.ok(r.d.tensionTrim.gain.value < 0.5 && r.d.tensionTrim.gain.value > 0.3, 'tension ≈ -6..-9 dB');
  assert.equal(r.d.alertBus.gain.value, 0);
});
