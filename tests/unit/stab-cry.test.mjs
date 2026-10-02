/**
 * "Shout of the soldier when getting stabbed" (user request 2026-10-01): a knifed German cries out in his own voice at
 * the stab's hit frame (voice-lines CRY_KEYS.stab, recorded per guard voice in german_<n>/pain/cry_stab_<i>), positional
 * at his body on the voice bus, no subtitle — and the kill stays silent to the AI (no world noise; BEL rule, §3.3).
 * Shots, blasts and BCD knock-outs pick their own cry; variants rotate (never the same one twice in a row).
 */
import { test, assert } from './lib.mjs';
import { makeSim, guard } from './abilsim.mjs';
import { MockAudioContext, EventBus } from './audio-mock.mjs';
import { createAudio } from '../../src/audio/audio.js';
import { CONFIG } from '../../src/config.js';
import { LINES, RULES, CRY_KEYS, cryOf, VoiceDirector } from '../../src/audio/voice-lines.js';
import { QUIP_AFTER_CRY } from '../../src/audio/event-map.js';

/** Audio on the sim's own event bus (mock WebAudio), clocked by mission time. */
function withAudio(sim) {
  let ctx = null;
  const audio = createAudio(sim.world.events, { createContext: () => (ctx = new MockAudioContext()), now: () => sim.world.time,
    rand: () => 0.1, storage: null, autoUnlock: false, loadAssets: false });
  audio.unlock();
  const barks = [];
  sim.world.events.on('bark', (b) => barks.push({ line: b.line, unit: b.unit, speaker: b.speaker, text: b.text, subtitle: b.subtitle,
    variant: b.variant, rec: b.rec, suppressed: !!b.suppressed, t: sim.world.time }));
  return { audio, barks, get ctx() { return ctx; } };
}

test('knife kill: the victim cries (stab cry, his own voice) on the hit frame, positional, no subtitle, no AI noise', () => {
  const K = CONFIG.abilities.knife;
  // a second guard 7 m off, facing away: he must not react to the cry (the AI never hears audio, only world noise)
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }],
    enemies: [guard('e1', 12, 10, 0), guard('e2', 19, 10, 0)] });
  const A = withAudio(s);
  const gb = s.cmd('greenberet'), e = s.get('e1'), e2 = s.get('e2');
  let stabAt = null, killedAt = null;
  s.world.events.on('ability:start', (p) => { if (p.id === 'knife') stabAt = s.world.time; });
  s.world.events.on('unit:killed', (p) => { if (p.unit === e) killedAt = s.world.time; });
  assert.ok(gb.issue({ type: 'ability', id: 'knife', target: e }));
  s.run(4, () => !e.alive);
  assert.equal(e.alive, false, 'knifed');
  assert.equal(e.deathCause, 'knife');
  assert.ok(Math.abs(killedAt - stabAt - K.hit) <= 1 / 60 + 1e-9, `kill on the hit frame (${(killedAt - stabAt).toFixed(3)} s after the stab starts)`);
  const cry = A.barks.find((b) => b.line === CRY_KEYS.stab);
  assert.ok(cry, `a stab cry (${A.barks.map((b) => b.line)})`);
  assert.equal(cry.unit, e, 'in the victim\'s voice');
  assert.equal(cry.speaker, 'ger');
  assert.equal(cry.t, killedAt, 'voiced the same tick as the kill (the hit frame)');
  assert.equal(cry.text, '', 'non-verbal');
  assert.equal(cry.subtitle, false, 'no subtitle for a cry');
  assert.ok(/^cry_stab_[1-4]$/.test(cry.rec), cry.rec);
  const log = A.audio.log.filter((l) => l.type === 'voice' && l.name === CRY_KEYS.stab && !l.dropped);
  assert.equal(log.length, 1, 'played once');
  const v = A.audio.director.enemy.find((x) => x.key === CRY_KEYS.stab);
  assert.ok(v?.handle, 'a live voice');
  assert.equal(A.ctx.busOf(v.handle.src, A.audio.engine.bus), 'voice', 'voice bus (voice volume slider)');
  assert.deepEqual(v.handle.pos, { x: e.x, z: e.z }, 'positional at his body');
  assert.equal(v.handle.cls, 'voice', 'voice distance class (heard within 60 m of the view centre)');
  // gameplay unchanged: silent to the AI
  s.run(2);
  assert.equal(s.count('noise'), 0, 'no noise event: the cry is for the player\'s ears only');
  assert.ok(e2.alive && (e2.alertLevel || 0) === 0, `the guard 7 m off never noticed (alert ${e2.alertLevel})`);
  assert.ok(!['INVESTIGATE', 'COMBAT', 'ALARM_RUN', 'SEARCH'].includes(e2.brain.state), `guard 2 state ${e2.brain.state}`);
  // the killer's quip (when he has one) waits for the end of the stab, after the cry
  for (const b of A.barks.filter((x) => x.line === 'act_kill')) assert.ok(b.t >= killedAt + 0.25, `quip at +${(b.t - killedAt).toFixed(2)} s`);
});

test('cry categories: cause → stab / shot / blast / ko; dogs and animals stay silent', () => {
  for (const c of ['knife', 'injection', 'harpoon', 'trap']) assert.equal(cryOf(c), 'stab', c);
  for (const c of ['pistol', 'rifle', 'sniper', 'mg', 'smg', 'tank_mg', 'shot', 'bullet', undefined]) assert.equal(cryOf(c), 'shot', String(c));
  for (const c of ['explosion', 'grenade', 'timeBomb', 'remoteBomb', 'mine', 'tank_cannon', 'fire', 'runover', 'train']) assert.equal(cryOf(c), 'blast', c);
  assert.equal(cryOf('ko'), 'ko');
  for (const [cat, key] of Object.entries(CRY_KEYS)) {
    const lines = LINES.ger[key];
    assert.ok(lines.length >= 3 && lines.length <= 5, `${cat}: ${lines.length} variants`);
    assert.ok(lines.every((l) => l.nonverbal && l.text === '' && l.rec === `cry_${cat}_${lines.indexOf(l) + 1}`), cat);
    assert.equal(RULES[key].sub, false, `${cat}: no subtitle`);
  }
  // every category through the event map
  const events = new EventBus();
  const clock = { t: 0 };
  const audio = createAudio(events, { createContext: () => new MockAudioContext(), now: () => clock.t, rand: () => 0.1, storage: null,
    autoUnlock: false, loadAssets: false });
  audio.unlock();
  const seen = [];
  events.on('bark', (b) => seen.push(b.line));
  const gb = { kind: 'commando', id: 'c1', role: 'greenberet', x: 0, z: 0, alive: true, hp: 100 };
  const man = (id, extra = {}) => ({ kind: 'enemy', id, x: 5, z: 0, alive: false, hp: 0, soldierType: 'soldier', ...extra });
  events.emit('unit:killed', { unit: man('a'), killer: gb, cause: 'rifle' });
  events.emit('unit:killed', { unit: man('b'), killer: gb, cause: 'grenade' });
  clock.t = 5; events.emit('unit:damaged', { unit: { ...man('c'), alive: true, hp: 120 }, amount: 80, cause: 'pistol', source: gb });
  clock.t = 10; events.emit('enemy:ko', { enemy: { ...man('d'), alive: true, hp: 200 }, by: gb, fresh: true });
  clock.t = 15; events.emit('unit:killed', { unit: man('dog', { soldierType: 'dog' }), killer: gb, cause: 'knife' });
  events.emit('unit:killed', { unit: man('hen', { soldierType: 'chicken' }), killer: gb, cause: 'knife' });
  assert.deepEqual(seen, [CRY_KEYS.shot, CRY_KEYS.blast, CRY_KEYS.shot, CRY_KEYS.ko], 'shot kill, blast kill, wound, knock-out; no dog / animal cry');
});

test('cry variants rotate: no variant twice in a row, all of them over a run of kills', () => {
  const d = new VoiceDirector({ rand: () => 0.99 });
  const n = LINES.ger[CRY_KEYS.stab].length, got = [];
  for (let k = 0; k < 2 * n; k++) {
    const r = d.request({ speaker: 'ger', speakerId: `g${k}`, key: CRY_KEYS.stab, now: k, commando: false, force: true });
    assert.ok(r.ok, `kill ${k}: ${r.reason}`);
    d.started({ speakerId: `g${k}`, key: CRY_KEYS.stab, now: k }, 0.5, r.replaces);
    got.push(r.n);
  }
  for (let k = 1; k < got.length; k++) assert.notEqual(got[k], got[k - 1], `no back-to-back repeat (${got})`);
  assert.equal(new Set(got).size, n, `every variant used (${got})`);
});

test('a dying man\'s cry cuts his own line at once (not a free voice slot)', () => {
  const s = makeSim({ commandos: [{ role: 'greenberet', x: 10, z: 10 }], enemies: [guard('e1', 12, 10, 0)] }, { brains: false });
  const A = withAudio(s);
  const e = s.get('e1');
  s.world.events.emit('bark', { unit: e, line: 'ger_suspicious' }); // "Was war das?"
  const what = A.ctx.started.at(-1);
  assert.equal(what.stopped, null);
  s.world.time = 0.2;
  e.die('knife', s.cmd('greenberet'));
  assert.ok(what.stopped != null, 'his "Was war das?" is cut by the cry');
  assert.deepEqual(A.audio.debug().voices.enemy, [CRY_KEYS.stab], 'one voice: the cry');
  // the silent killer's quip comes after the cry
  const k0 = A.barks.length;
  A.audio.update(0, 0, 40);
  assert.ok(!A.barks.slice(k0).some((b) => b.line === 'act_kill'), 'no quip on the kill tick');
  s.world.time = 0.2 + QUIP_AFTER_CRY + 0.01; A.audio.update(0, 0, 40);
  assert.ok(A.audio.log.some((l) => l.type === 'voice' && l.name === 'act_kill'), 'quip requested after the cry');
});
