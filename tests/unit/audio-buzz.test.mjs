/**
 * "Vibrating sound during missions" (2026-10-01): the briefing's 16 mm projector bed — a looped UI sound (96 Hz hum +
 * noise chopped at 24 Hz) — was started fire-and-forget and never stopped, so it buzzed under every mission (one more
 * copy per briefing). And every moving positional voice was re-spatialized with per-frame steps (zipper noise).
 * These pin the lifecycle of UI beds and the smoothness of the per-frame spatial automation.
 */
import { test, assert } from './lib.mjs';
import { MockAudioContext, EventBus } from './audio-mock.mjs';
import { createAudio } from '../../src/audio/audio.js';
import { AudioEngine, GLIDE_TAU } from '../../src/audio/engine.js';
import { SFX } from '../../src/audio/manifest.js';
import { UiSound, UI_SOUNDS } from '../../src/ui/ui-sound.js';

const basePlay = AudioEngine.prototype.play;
if (!AudioEngine.prototype.play.__tagged) {
  AudioEngine.prototype.play = function (id, o) { const h = basePlay.call(this, id, o); if (h) h.src._id = id; return h; };
  AudioEngine.prototype.play.__tagged = true;
}

function rig() {
  const events = new EventBus();
  let ctx = null;
  const audio = createAudio(events, { createContext: () => (ctx = new MockAudioContext()), rand: () => 0.1, storage: null, autoUnlock: false, loadAssets: false });
  audio.unlock();
  const live = (id) => ctx.started.filter((s) => s._id === id && s.stopped == null);
  const uiLoops = () => ctx.playing().filter((s) => s.loop && ctx.busOf(s, audio.engine.bus) === 'ui');
  return { events, audio, get ctx() { return ctx; }, live, uiLoops };
}

test('UI beds: every looped UI sound is a keyed loop (never stacked, always stoppable)', () => {
  const loops = Object.entries(UI_SOUNDS).filter(([, d]) => SFX[d[0]]?.loop).map(([k]) => k);
  assert.deepEqual(loops, ['projector'], 'the projector is the one looped UI bed');
  const r = rig();
  const ui = new UiSound(() => r.audio);
  r.events.emit('game:state', { from: 'title', to: 'briefing' });
  ui.play('projector'); ui.loop('projector'); ui.play('projector'); // boot ident + briefing + a re-open
  assert.equal(r.live('ui_projector').length, 1, 'one projector however often it is asked for');
  assert.ok(r.audio.loops.has('ui:projector'), 'tracked as the keyed loop ui:projector');
  ui.stop('projector');
  assert.equal(r.live('ui_projector').length, 0, 'stop() fades it out (part 1 ends / the ident ends)');
  assert.equal(r.audio.loops.has('ui:projector'), false);
});

test('UI beds: nothing from the front end keeps looping once a mission plays (the projector buzz)', () => {
  const r = rig();
  const ui = new UiSound(() => r.audio);
  r.events.emit('mission:loaded', { mission: { id: 'm01', theater: 'snow' }, world: { clock: 0, commandos: [] } });
  r.events.emit('game:state', { from: 'title', to: 'briefing' });
  ui.play('projector'); // briefing part 1 bed
  r.audio.playSfx('ui_projector'); // and an untracked one (the old fire-and-forget path)
  assert.ok(r.uiLoops().length >= 1, 'the projector runs under the briefing (intended)');
  r.events.emit('game:state', { from: 'briefing', to: 'playing' }); // mission starts without the briefing's stop()
  assert.deepEqual(r.uiLoops(), [], 'no looping UI-bus voice survives into gameplay');
  // a second briefing (next mission) starts ONE fresh bed, which again ends with the mission start
  r.events.emit('game:state', { from: 'playing', to: 'briefing' });
  ui.stop('projector'); ui.play('projector');
  assert.equal(r.live('ui_projector').length, 1);
  r.events.emit('game:state', { from: 'briefing', to: 'playing' });
  assert.deepEqual(r.uiLoops(), []);
});

test('spatial automation glides: a moving listener / source never steps gain or pan per frame (zipper noise)', () => {
  const r = rig();
  const eng = r.audio.engine;
  const W = 120; // view width (m): the source stays inside the pan range
  r.audio.update(0, 0, W);
  r.ctx.currentTime = 1;
  const h = eng.play('truck_idle', { pos: { x: 40, z: 0 }, loop: true }); // beyond the 12 m reference: gain follows distance
  const g = h.gainNode.gain, p = h.panNode.pan;
  const n0 = [g.events.length, p.events.length];
  const T = (f) => 1.2 + f / 60;
  for (let f = 1; f <= 30; f++) { r.ctx.currentTime = T(f); r.audio.update(f * 0.3, f * 0.1, W); } // camera glides 9.5 m
  const ge = g.events.slice(n0[0]), pe = p.events.slice(n0[1]);
  assert.ok(ge.length >= 25 && pe.length >= 25, `re-spatialized every frame (${ge.length} gain, ${pe.length} pan events)`);
  assert.ok(ge.every((e) => e[0] === 'target') && pe.every((e) => e[0] === 'target'),
    `only setTargetAtTime glides — no .value steps, no ramp restarted from the lagging param.value: ${JSON.stringify([...new Set([...ge, ...pe].map((e) => e[0]))])}`);
  assert.ok(ge.every((e) => e[3] >= GLIDE_TAU * 0.99 && e[3] <= 0.1), 'glide time constant ≈ 30 ms');
  // a still listener schedules nothing (no automation churn)
  const n1 = g.events.length + p.events.length;
  for (let f = 31; f <= 45; f++) { r.ctx.currentTime = T(f); r.audio.update(9, 3, W); }
  assert.equal(g.events.length + p.events.length, n1, 'unchanged targets → no new events');
  // a follow loop moving with its vehicle glides too (gain, pan) once its fade-in is over
  const truck = { id: 't1', type: 'truck', x: 30, z: 0 };
  r.events.emit('vehicle:enter', { vehicle: truck, unit: { kind: 'commando', id: 'c', role: 'driver' } });
  const fh = r.audio.loops.get('veh:t1').handle;
  r.ctx.currentTime = T(46) + 1;
  const m0 = [fh.gainNode.gain.events.length, fh.panNode.pan.events.length];
  for (let f = 47; f <= 60; f++) { r.ctx.currentTime = T(f) + 1; truck.x += 0.5; r.audio.update(9, 3, W); }
  const fe = [...fh.gainNode.gain.events.slice(m0[0]), ...fh.panNode.pan.events.slice(m0[1])];
  assert.ok(fe.length >= 20 && fe.every((e) => e[0] === 'target'), `follow loop glides (${fe.length} events)`);
});

test('spatial automation keeps a fade-in: the first frame does not cut a 4 s bed fade to 30 ms', () => {
  const r = rig();
  const eng = r.audio.engine;
  r.ctx.currentTime = 1;
  const h = eng.play('waterfall', { pos: { x: 20, z: 0 }, loop: true, bus: 'ambience', fadeIn: 4 });
  r.ctx.currentTime = 1 + 1 / 60;
  r.audio.update(0.5, 0, 40);
  const t = h.gainNode.gain.events.filter((e) => e[0] === 'target');
  assert.ok(t.length === 1 && t[0][3] > 1, `fade-in continues over its remaining ~4 s (τ ${t[0]?.[3]?.toFixed(2)} s)`);
});
