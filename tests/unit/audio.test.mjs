/** AUDIO (design-spec §9, §4.9): event → sound scheduling on a mock AudioContext, music rules, voices, siren. */
import { test, assert, near } from './lib.mjs';
import { MockAudioContext, EventBus } from './audio-mock.mjs';
import { createAudio } from '../../src/audio/audio.js';
import { spatialize, AudioEngine } from '../../src/audio/engine.js';
import { SFX, MUSIC, BUSSES } from '../../src/audio/manifest.js';
import { SFX_EVENTS } from '../../src/audio/sfx-events.js';
import { engineRange } from '../../src/audio/event-map.js';
import M02 from '../../src/missions/m02_a_quiet_blow_up.js';
import { Vehicle } from '../../src/entities/vehicle.js';
import { synth } from '../../src/audio/synth.js';
import { VoiceDirector, LINES } from '../../src/audio/voice-lines.js';

// tag every started source with its sfx id / cue for assertions
const basePlay = AudioEngine.prototype.play;
AudioEngine.prototype.play = function (id, o) { const h = basePlay.call(this, id, o); if (h) h.src._id = id; return h; };

/** Fresh audio on a mock context with a controllable clock and RNG. */
function rig({ rand = () => 0.1, unlock = true, storage = null } = {}) {
  const events = new EventBus();
  const clock = { t: 0 };
  let ctx = null;
  const audio = createAudio(events, {
    createContext: () => (ctx = new MockAudioContext()), now: () => clock.t, rand, storage, autoUnlock: false, loadAssets: false,
  });
  if (unlock) audio.unlock();
  const world = { clock: 0, commandos: [], alarm: null };
  const srcs = (id) => ctx.started.filter((s) => s._id === id);
  return { events, clock, audio, world, get ctx() { return ctx; }, srcs };
}
const commando = (id, role, x = 0, z = 0) => ({ kind: 'commando', id, role, x, z, hp: 100, alive: true });
const enemy = (id, x = 0, z = 0) => ({ kind: 'enemy', id, x, z, hp: 200, alive: true });

test('catalog: every §9.3 id referenced by SFX_EVENTS exists and renders a placeholder', () => {
  for (const row of SFX_EVENTS) for (const id of row.sfx) assert.ok(SFX[id], `missing SFX "${id}" (${row.event})`);
  for (const id of ['step_snow', 'bomb_tick', 'siren', 'train_pass', 'stamp', 'cursor_forbidden', 'underwater_loop', 'dam_burst']) assert.ok(SFX[id], id);
  for (const d of Object.values(SFX)) { const b = synth(d.recipe, 8000, 1); assert.ok(b && b.length > 0 && !b.some(Number.isNaN), d.id); }
  for (const [id, c] of Object.entries(MUSIC)) assert.ok(synth(c.mood, 8000), id);
  assert.deepEqual([...BUSSES].sort(), ['ambience', 'music', 'sfx', 'ui', 'voice']);
});

test('spatialize: per-category distance model (§1.5.0 v2), not the 40 m AI hearing radius', () => {
  // default class 'mech': ref 8 m, max 80 m, inverse law, short taper before max
  near(spatialize({ x: 5, z: 0 }, 0, 0, 40).gain, 1);
  near(spatialize({ x: 16, z: 0 }, 0, 0, 40).gain, 0.5);
  near(spatialize({ x: 0, z: 40 }, 0, 0, 40).gain, 0.2);
  near(spatialize({ x: 75, z: 0 }, 0, 0, 40).gain, (8 / 75) * (5 / 12), 1e-9, 'taper over the last 15 %');
  assert.equal(spatialize({ x: 81, z: 0 }, 0, 0, 40).cull, true);
  assert.ok(spatialize({ x: -10, z: 0 }, 0, 0, 40).pan < 0 && spatialize({ x: 10, z: 0 }, 0, 0, 40).pan > 0);
  // pan follows the LIVE frustum half-width (zoom-aware)
  near(spatialize({ x: 10, z: 0 }, 0, 0, 40).pan, 0.4);
  near(spatialize({ x: 10, z: 0 }, 0, 0, 80).pan, 0.2, 1e-9, 'zoomed out: the same offset pans less');
  // classes: footsteps ~30 m, voices 60 m, small arms 400 m, MG/explosions 1.5 km
  assert.equal(spatialize({ x: 31, z: 0 }, 0, 0, 40, 0, 'foley').cull, true, 'a footstep 31 m away is not heard');
  near(spatialize({ x: 35, z: 0 }, 0, 0, 40, 0, 'small').gain, 25 / 35, 1e-9, 'a rifle at 35 m is still loud');
  assert.ok(spatialize({ x: 350, z: 0 }, 0, 0, 40, 0, 'small').gain > 0.05, 'small arms at 350 m');
  assert.ok(spatialize({ x: 1000, z: 0 }, 0, 0, 40, 0, 'heavy').gain > 0.03, 'an explosion 1 km away');
  assert.equal(spatialize({ x: 61, z: 0 }, 0, 0, 40, 0, 'voice').cull, true);
  // air absorption: 20 kHz at the listener → 3.5 kHz at 120 m and beyond
  near(spatialize({ x: 0, z: 0 }, 0, 0, 40).lp, 20000, 1e-6);
  near(spatialize({ x: 120, z: 0 }, 0, 0, 40, 0, 'heavy').lp, 3500, 1e-6);
  assert.ok(spatialize({ x: 60, z: 0 }, 0, 0, 40, 0, 'heavy').lp < 9000);
});

test('unlock builds master + five busses and resumes; nothing is audible before unlock', () => {
  const r = rig({ unlock: false });
  r.events.emit('shot', { from: { x: 1, z: 1 }, weapon: 'pistol' });
  assert.equal(r.ctx, null, 'no AudioContext before the first gesture');
  assert.ok(r.audio.log.some((l) => l.name === 'pistol_shot'), 'still logged');
  r.audio.unlock();
  assert.equal(r.ctx.resumed, 1);
  assert.deepEqual(Object.keys(r.audio.engine.bus).sort(), ['ambience', 'music', 'sfx', 'ui', 'voice']);
  near(r.audio.engine.master.gain.value, r.audio.volumes.master);
  r.audio.unlock();
  assert.equal(r.ctx.resumed, 2, 'idempotent (re-resumes, one context)');
});

test('event → SFX scheduling: weapon, impact, explosion kind, positional gain and bus', () => {
  const r = rig();
  r.audio.update(0, 0, 40);
  r.events.emit('shot', { from: { x: 50, z: 0 }, weapon: 'pistol' });
  const [s] = r.srcs('pistol_shot');
  assert.ok(s, 'pistol_shot started');
  assert.equal(r.ctx.busOf(s, r.audio.engine.bus), 'sfx');
  const g = s.outputs[0];
  near(g.gain.value, 0.5 * SFX.pistol_shot.gain, 1e-9, 'small arms: ref 25 m → ×0.5 at 50 m');
  assert.ok(g.outputs[0].pan.value > 0, 'panned right');
  r.events.emit('explosion', { x: 0, z: 0, kind: 'grenade' });
  r.events.emit('explosion', { x: 30, z: 0, kind: 'barrel' });
  r.events.emit('hit', { x: 2, z: 2, target: enemy('e1', 2, 2) });
  r.events.emit('hit', { x: 3, z: 3, surface: 'metal' });
  for (const id of ['explosion_small', 'barrel_explode', 'bullet_impact_flesh', 'bullet_impact_metal']) assert.equal(r.srcs(id).length, 1, id);
  r.events.emit('ui:click', { sfx: 'knapsack_open' });
  assert.equal(r.ctx.busOf(r.srcs('knapsack_open')[0], r.audio.engine.bus), 'ui');
});

test('duplicate id at the same spot in the same instant collapses (bomb:exploded + explosion)', () => {
  const r = rig();
  r.events.emit('bomb:exploded', { bomb: { id: 'b1', x: 5, z: 5 }, x: 5, z: 5 });
  r.events.emit('explosion', { x: 5, z: 5, kind: 'bomb' });
  assert.equal(r.srcs('explosion_big').length, 1);
  r.clock.t = 1;
  r.events.emit('explosion', { x: 5, z: 5, kind: 'bomb' });
  assert.equal(r.srcs('explosion_big').length, 2);
});

test('positional loops follow their entity and re-spatialize with the listener', () => {
  const r = rig();
  const truck = { id: 'v1', type: 'truck', x: 0, z: 0 };
  r.events.emit('vehicle:enter', { vehicle: truck, unit: commando('c', 'driver') });
  assert.equal(r.srcs('truck_start').length, 1);
  const [idle] = r.srcs('truck_idle');
  assert.ok(idle && idle.loop);
  truck.x = 16;
  r.audio.update(0, 0, 40);
  near(idle.outputs[0].gain.value, (12 / 16) * SFX.truck_idle.gain, 1e-9, 'vehicle class: ref 12 m');
  r.audio.update(16, 0, 40);
  near(idle.outputs[0].gain.value, SFX.truck_idle.gain, 1e-9, 'listener moved onto it');
  r.events.emit('vehicle:move', { vehicle: truck, speed: 8 });
  assert.ok(idle.stopped != null && r.srcs('truck_drive').length === 1, 'idle → drive loop');
  truck.destroyed = true;
  r.audio.update(16, 0, 40);
  assert.ok(r.srcs('truck_drive')[0].stopped != null, 'destroyed vehicle loop stops');
});

test('spatialize: a per-sound audible range replaces the view-width falloff (silent beyond it)', () => {
  near(spatialize({ x: 16, z: 0 }, 0, 0, 40, 60).gain, 0.5);
  near(spatialize({ x: 50, z: 0 }, 0, 0, 40, 60).gain, 8 / 50, 1e-9, 'beyond 1.2 × view width but inside range: still the inverse law');
  const out = spatialize({ x: 61, z: 0 }, 0, 0, 40, 60);
  assert.equal(out.gain, 0);
  assert.equal(out.cull, true);
  near(spatialize({ x: 50, z: 0 }, 0, 0, 40).gain, 8 / 50, 1e-9, 'no range → the class max (mech 80 m)');
  assert.equal(spatialize({ x: 50, z: 0 }, 0, 0, 40, 30).cull, true, 'range tighter than the class max');
});

test('§7.5 M2 pboat: engine loop uses spawn.engineAudible (60 m) as its audible radius', () => {
  const spawn = M02.vehicles.find((v) => v.id === 'pboat');
  assert.equal(spawn.engineAudible, 60);
  const boat = new Vehicle(spawn);
  assert.equal(engineRange(boat), 60);
  assert.equal(engineRange({ type: 'truck' }), undefined);
  const r = rig();
  r.audio.update(0, 0, 40);
  boat.x = 0; boat.z = 50;
  r.events.emit('vehicle:move', { vehicle: boat, speed: 2.5 });
  const [loop] = r.srcs('boat_engine');
  assert.ok(loop && loop.loop, 'boat engine loop started');
  near(loop.outputs[0].gain.value, (12 / 50) * SFX.boat_engine.gain, 1e-9, 'audible at 50 m (inside 60 m)');
  boat.z = 70;
  r.audio.update(0, 0, 40);
  near(loop.outputs[0].gain.value, 0, 1e-9, 'silent beyond 60 m');
  boat.z = 55;
  r.audio.update(0, 0, 40);
  assert.ok(loop.outputs[0].gain.value > 0.1 * SFX.boat_engine.gain, 'audible again at 55 m');
  // a vehicle without engineAudible keeps its class falloff (vehicle: ref 12 m, max 300 m)
  const truck = { id: 't', type: 'truck', x: 0, z: 70 };
  r.events.emit('vehicle:move', { vehicle: truck, speed: 8 });
  near(r.srcs('truck_drive')[0].outputs[0].gain.value, (12 / 70) * SFX.truck_drive.gain, 1e-9);
});

test('§9.1 no music during missions: menu/briefing beds, silence in play, stingers at start/end', () => {
  const r = rig();
  const music = () => r.ctx.playing().filter((s) => r.ctx.busOf(s, r.audio.engine.bus) === 'music' && s.loop).map((s) => s._id);
  r.events.emit('game:state', { from: 'boot', to: 'title' });
  assert.deepEqual(music(), ['menu']);
  r.events.emit('mission:loaded', { mission: { id: 'm02', theater: 'snow' }, world: r.world });
  r.events.emit('game:state', { from: 'title', to: 'briefing' });
  assert.deepEqual(music(), ['briefing_3'], JSON.stringify(music()));
  r.events.emit('game:state', { from: 'briefing', to: 'playing' });
  r.audio.music('snow'); // what Game.start() asks for
  assert.deepEqual(music(), [], 'no music bed while playing');
  assert.equal(r.ctx.started.filter((s) => /^start_\d$/.test(s._id)).length, 1, 'one start stinger');
  r.audio.music('menu');
  r.audio.music('snow');
  r.events.emit('game:state', { from: 'playing', to: 'paused' });
  r.events.emit('game:state', { from: 'paused', to: 'playing' });
  assert.deepEqual(music(), [], 'still silent (explicit menu request refused, pause too)');
  assert.equal(r.ctx.started.filter((s) => /^start_\d$/.test(s._id)).length, 1, 'stinger not repeated');
  assert.ok(r.audio.log.some((l) => l.type === 'music' && l.name === 'menu' && l.refused));
  r.audio.setOption('cinematicAmbience', true);
  assert.deepEqual(music(), ['drone'], 'optional cinematic drone is the only in-mission bed');
  r.audio.setOption('cinematicAmbience', false);
  r.events.emit('game:state', { from: 'playing', to: 'won' });
  assert.equal(r.ctx.started.filter((s) => /^success_\d$/.test(s._id)).length, 1);
  r.events.emit('game:state', { from: 'won', to: 'title' });
  assert.deepEqual(music(), ['menu']);
});

test('§4.9 siren: 0.75 → 0 over 25 s of mission time, positional + 30 % bed, RINT restarts, alarm:end stops', () => {
  const r = rig();
  r.events.emit('mission:loaded', { mission: { id: 'm01', theater: 'snow' }, world: r.world });
  r.events.emit('game:state', { from: 'briefing', to: 'playing' });
  r.events.emit('alarm:start', { x: 16, z: 0, cause: 'test', event: 'RINT' });
  const sir = r.srcs('siren');
  assert.equal(sir.length, 2, 'positional + bed');
  r.audio.update(0, 0, 40);
  const gains = sir.map((s) => s.outputs[0].gain.value).sort();
  near(gains[1], 0.75, 1e-9, 'positional, 16 m away (inside the 40 m heavy reference)');
  near(gains[0], 0.75 * 0.3, 1e-9, 'non-positional 30 % bed');
  r.world.clock = 10; r.audio.update(0, 0, 40);
  near(r.audio.debug().siren.gain, 0.45, 1e-9);
  r.world.clock = 20; r.events.emit('alarm:start', { x: 16, z: 0, event: 'RINT' });
  r.audio.update(0, 0, 40);
  near(r.audio.siren.gain, 0.75, 1e-9, 'restarted');
  assert.equal(r.srcs('siren').length, 2, 'no extra voices on restart');
  r.world.clock = 45.1; r.audio.update(0, 0, 40);
  assert.equal(r.audio.siren.active, false, 'silent after 25 s');
  assert.ok(sir.every((s) => s.stopped != null));
  // when the AI alarm object exists, its gain is authoritative; alarm:end stops at once
  r.world.alarm = { siren: { active: true, gain: 0.6, t: 5 } };
  r.events.emit('alarm:start', { x: 0, z: 0 });
  r.audio.update(0, 0, 40);
  near(r.audio.siren.gain, 0.6, 1e-9);
  r.events.emit('alarm:end', {});
  assert.equal(r.audio.siren.active, false);
});

test('§9.4 select: 70 % chance, 6 s per-man cooldown; laconic mutes select/ack', () => {
  let roll = 0.5;
  const r = rig({ rand: () => roll });
  const tiny = commando('c1', 'greenberet');
  const barks = [];
  r.events.on('bark', (e) => barks.push(e));
  r.events.emit('unit:selected', { units: [tiny] });
  assert.equal(barks.length, 1);
  assert.ok(LINES.greenberet.select.some((l) => l.text === barks[0].text), 'stamped text');
  assert.equal(barks[0].subtitle, false, 'no subtitle for selection chatter');
  r.clock.t = 3; r.events.emit('unit:selected', { units: [tiny] });
  assert.equal(barks.length, 1, 'cooldown');
  r.clock.t = 7; roll = 0.95; r.events.emit('unit:selected', { units: [tiny] });
  assert.equal(barks.length, 1, '30 % miss');
  r.clock.t = 14; roll = 0.2; r.events.emit('unit:selected', { units: [tiny] });
  assert.equal(barks.length, 2);
  r.audio.setOption('laconic', true);
  r.clock.t = 30;
  r.events.emit('unit:selected', { units: [tiny] });
  r.events.emit('unit:order', { unit: tiny, order: { type: 'move', x: 1, z: 1 } });
  assert.equal(barks.length, 2, 'laconic');
  r.events.emit('unit:damaged', { unit: tiny, amount: 10 });
  assert.equal(barks.at(-1).line, 'hurt', 'hurt is never muted');
});

test('§9.4 one commando voice at a time: replace after 0.4 s, higher priority interrupts', () => {
  const r = rig();
  const duke = commando('c2', 'sniper'), fins = commando('c3', 'diver');
  r.events.emit('unit:order', { unit: duke, order: { type: 'move' } });
  r.clock.t = 0.2;
  r.events.emit('unit:order', { unit: fins, order: { type: 'move' } });
  assert.equal(r.audio.log.at(-1).dropped, 'busy');
  const first = r.ctx.started.find((s) => s._id === 'voice:ack_move');
  r.clock.t = 0.5;
  r.events.emit('unit:order', { unit: fins, order: { type: 'move' } });
  assert.ok(first.stopped != null, 'older line replaced after 0.4 s');
  r.clock.t = 0.6;
  r.events.emit('unit:damaged', { unit: duke, amount: 5 });
  assert.equal(r.audio.debug().voices.commando, 'hurt', 'hurt interrupts at once');
  assert.equal(r.ctx.busOf(r.ctx.started.at(-1), r.audio.engine.bus), 'voice');
});

test('German barks: AI bark gets text + gloss subtitle, challenge duplicate suppressed, squad anti-spam', () => {
  const r = rig();
  const e1 = enemy('e1', 10, 0), e2 = enemy('e2', 12, 0), e3 = enemy('e3', 14, 0);
  const seen = [];
  r.events.on('bark', (e) => seen.push({ ...e }));
  r.events.emit('bark', { unit: e1, line: 'halt' }); // legacy name from the placeholder brain
  const b = seen[0];
  assert.equal(b.line, 'ger_halt');
  assert.ok(LINES.ger.ger_halt.some((l) => l.text === b.text && l.gloss === b.gloss), `${b.text} / ${b.gloss}`);
  assert.equal(b.subtitle, true);
  const v = r.ctx.started.at(-1);
  assert.equal(v._id, 'voice:ger_halt');
  near(v.outputs[0].gain.value, 6 / 10, 1e-9, 'enemy voice is positional (voice class: ref 6 m)');
  r.events.emit('enemy:challenge', { enemy: e1, target: commando('c1', 'spy') });
  assert.equal(seen.length, 1, 'same guard, same bark within cooldown: no second line');
  r.events.emit('enemy:challenge', { enemy: e2 });
  assert.equal(seen.length, 1, 'squad-wide 0.6 s cooldown on Halt!');
  r.clock.t = 0.7;
  r.events.emit('enemy:state', { enemy: e2, from: 'IDLE', to: 'INVESTIGATE' });
  r.events.emit('enemy:state', { enemy: e3, from: 'IDLE', to: 'COMBAT' });
  assert.deepEqual(seen.map((s) => s.line), ['ger_halt', 'ger_suspicious', 'ger_combat']);
  assert.equal(r.audio.debug().voices.enemy.length, 2, 'max two enemy voices');
  const drop = { unit: enemy('e4'), line: 'ger_giveup' };
  r.events.emit('bark', drop);
  assert.equal(drop.suppressed, true, 'lower priority than both active voices → flagged for the UI');
  r.events.emit('unit:killed', { unit: e3, killer: commando('c1', 'greenberet'), cause: 'knife' });
  assert.ok(!seen.some((s) => s.line === 'ger_death'), 'silent kill: no death cry');
});

test('§9.2 ambience beds per theater on the ambience bus; "Nature sounds" toggle; far sweeteners', () => {
  const r = rig({ rand: () => 0 });
  r.events.emit('mission:loaded', { mission: { id: 'm02', theater: 'temperate' }, world: r.world });
  assert.equal(r.srcs('wind').length, 0, 'not before the mission is playing');
  r.events.emit('game:state', { from: 'briefing', to: 'playing' });
  const loops = r.ctx.playing().filter((s) => r.ctx.busOf(s, r.audio.engine.bus) === 'ambience').map((s) => s._id).sort();
  assert.deepEqual(loops, ['birds', 'river', 'wind'], 'temperate wind + daylight birds + M2 river');
  r.clock.t = 20; r.audio.update(0, 0, 40);
  const dog = r.audio.log.filter((l) => l.name === 'dog_bark');
  assert.equal(dog.length, 1, 'a distant dog sweetener');
  assert.ok(Math.hypot(dog[0].x, dog[0].z) >= 90, 'placed 90–160 m from the listener');
  r.audio.setOption('natureSounds', false);
  assert.equal(r.ctx.playing().filter((s) => s.loop && r.ctx.busOf(s, r.audio.engine.bus) === 'ambience').length, 0);
  r.audio.setOption('natureSounds', true);
  assert.equal(r.srcs('wind').filter((s) => s.stopped == null).length, 1);
  r.events.emit('game:state', { from: 'playing', to: 'lost' });
  assert.equal(r.ctx.playing().filter((s) => s.loop && r.ctx.busOf(s, r.audio.engine.bus) === 'ambience').length, 0, 'off after the mission');
});

test('time bomb ticks 2 Hz speeding to 4 Hz on mission time; stops when it explodes', () => {
  const r = rig();
  const bomb = { id: 'b1', x: 0, z: 0 };
  r.events.emit('bomb:armed', { bomb, kind: 'time', fuse: 10 });
  const ticks = [];
  for (let k = 0; k <= 1000; k++) { r.world.clock = k * 0.01; r.audio.world = r.world; r.audio.update(0, 0, 40); }
  for (const l of r.audio.log) if (l.name === 'bomb_tick') ticks.push(l);
  assert.ok(ticks.length >= 28 && ticks.length <= 32, `~30 ticks over 10 s (${ticks.length})`);
  r.events.emit('bomb:exploded', { bomb, x: 0, z: 0 });
  const n = r.audio.log.filter((l) => l.name === 'bomb_tick').length;
  r.world.clock = 11; r.audio.update(0, 0, 40);
  assert.equal(r.audio.log.filter((l) => l.name === 'bomb_tick').length, n);
});

test('drop-in assets: R&D sfx manifest categories map to §9.3 ids; decoded files win over the synth', () => {
  const eng = new AudioEngine(new MockAudioContext(), { fetch: null });
  const n = eng.applyManifests({
    sfx: { sounds: [{ id: 'fs_snow/a', category: 'fs_snow', files: ['fs_snow/a.ogg', 'fs_snow/a.mp3'] },
      { id: 'siren/x', category: 'siren_airraid', files: ['siren_airraid/x.ogg'] }] },
    music: { cues: { menu: ['menu.ogg'] } },
    voice: { lines: [{ speaker: 'ger', key: 'ger_halt', n: 0, file: 'ger/ger_halt_0.ogg' }] },
  });
  assert.deepEqual(n, { sfx: 2, music: 1, voice: 1 });
  assert.deepEqual(eng.files.get('step_snow'), ['sfx/fs_snow/a.ogg']);
  assert.deepEqual(eng.files.get('siren'), ['sfx/siren_airraid/x.ogg']);
  const rec = eng.ctx.createBuffer(1, 10, 22050);
  eng.decoded.set('sfx/fs_snow/a.ogg', rec);
  assert.equal(eng.bufferFor('step_snow'), rec);
  assert.notEqual(eng.bufferFor('step_sand'), rec, 'no file → synth placeholder');
  eng.decoded.set('voice/ger/ger_halt_0.ogg', rec);
  assert.equal(eng.voiceBuffer('ger', 'ger_halt', 0, 'Halt!'), rec);
});

test('volumes, mute and options persist; mute zeroes the master bus', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const r = rig({ storage });
  r.audio.setVolume('voice', 0.3);
  r.audio.setMuted(true);
  r.audio.setOption('natureSounds', false);
  near(r.audio.engine.master.gain.value, 0);
  near(r.audio.engine.bus.voice.gain.value, 0.3);
  const r2 = rig({ storage });
  assert.equal(r2.audio.muted, true);
  assert.equal(r2.audio.volumes.voice, 0.3);
  assert.equal(r2.audio.options.natureSounds, false);
});

test('VoiceDirector alone: cooldown map and force bypass', () => {
  const d = new VoiceDirector({ rand: () => 0 });
  const req = (now, extra = {}) => ({ speaker: 'spy', speakerId: 's', key: 'hurt', now, commando: true, ...extra });
  assert.ok(d.request(req(0)).ok);
  d.started(req(0), 0.3, null);
  assert.equal(d.request(req(1)).reason, 'cooldown');
  assert.ok(d.request(req(1, { force: true })).ok);
  assert.equal(d.request(req(0, { key: 'nope' })).reason, 'no-line');
});
