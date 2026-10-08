/**
 * HUD alarm lamp lifecycle (user 2026-10-07 "make sure the alarm icon is on whenever it should"): world.alarm.lamp is
 * lit by every alarm source — the siren (RINT), a non-siren zone event (M3 camp RCAMP), a heard explosion / gunshot
 * tripping a zone, a scripted alarm — stays lit while the enemy still answers the alarm (searches, investigations,
 * fights, exit runs) and goes dark once they are back to normal, never past lampMax. 'alarm:lamp' {on} marks every
 * switch. The topbar reads `lamp` (the old one read the siren only: dark 25 s after the M3 bunker blast while a dozen
 * soldiers still combed the south bank, and never lit for RCAMP at all).
 */
import { test, assert } from './lib.mjs';
import { makeWorld, addEnemy, DT } from './ai-harness.mjs';
import { CONFIG } from '../../src/config.js';
import { readFileSync } from 'node:fs';

const ZONES = [
  { id: 'z_s', poly: [[0, 0], [40, 0], [40, 40], [0, 40]], onSeen: 'RINT', onHeard: 'RINT' },
  { id: 'z_camp', poly: [[40, 0], [80, 0], [80, 40], [40, 40]], onSeen: 'RCAMP', onHeard: 'RCAMP' },
];

/** advance only the alarm (enemy brains are frozen so the test can pin their states) */
function tick(w, secs) {
  for (let i = 0, n = Math.round(secs / DT); i < n; i++) { w.alarm.update(DT); w.time += DT; }
}

function world() {
  const w = makeWorld({ zones: ZONES });
  w.lampLog = [];
  w.events.on('alarm:lamp', (p) => w.lampLog.push({ t: +w.time.toFixed(2), on: p.on }));
  return w;
}

test('alarm lamp: dark at the start; the siren (RINT) lights it, it goes dark with the siren when nobody answers', () => {
  const w = world();
  assert.equal(w.alarm.lamp, false);
  w.alarm.raise('z_s', 'seen', 10, 10);
  assert.equal(w.alarm.active, true);
  assert.equal(w.alarm.lamp, true, 'lit with the siren');
  tick(w, CONFIG.alarm.sirenDur - 1);
  assert.equal(w.alarm.lamp, true, 'still lit while the siren sounds');
  tick(w, 2);
  assert.equal(w.alarm.active, false);
  assert.equal(w.alarm.lamp, false, 'dark when the siren ends and no one answers');
  assert.deepEqual(w.lampLog.map((l) => l.on), [true, false], 'one on, one off');
});

test('alarm lamp: a non-siren zone event (M3 camp RCAMP) lights it — no siren', () => {
  const w = world();
  assert.equal(w.alarm.raise('z_camp', 'seen', 60, 10), 'RCAMP');
  assert.equal(w.alarm.active, false, 'no siren for RCAMP');
  assert.equal(w.alarm.lamp, true, 'the camp is on alarm: lamp lit');
  tick(w, CONFIG.alarm.lampHold + 0.5);
  assert.equal(w.alarm.lamp, false, 'dark after the hold');
});

test('alarm lamp: explosions and gunshots heard by a zone light it; an accident does not', () => {
  const w = world();
  w.events.emit('explosion', { x: 50, z: 10, accident: true });
  assert.equal(w.alarm.lamp, false, 'accident explosion: no alarm');
  w.events.emit('explosion', { x: 50, z: 10 });
  assert.equal(w.alarm.lamp, true, 'explosion heard: lamp lit');
  const w2 = world();
  w2.alarm.raise('z_s', 'heard', 5, 5, { sensor: 'heard' }); // a gunshot noise heard in the zone (director)
  assert.equal(w2.alarm.lamp, true, 'gunshot heard: lamp lit');
});

test('alarm lamp: scripted alarms (setpiece {event}) light it', async () => {
  const w = world();
  const { runAction } = await import('../../src/missions/setpiece-actions.js');
  runAction({ world: w }, { event: 'RINT', x: 3, z: 3 }, {});
  assert.equal(w.alarm.lamp, true);
  const w2 = world();
  runAction({ world: w2 }, { alarm: 'z_camp', x: 60, z: 3 }, {});
  assert.equal(w2.alarm.lamp, true);
});

test('alarm lamp: stays lit while the enemy still answers the alarm, dark once they are back to normal', () => {
  const w = world();
  const e = addEnemy(w, { id: 'g1', soldierType: 'trooper', x: 20, z: 20 });
  const d = addEnemy(w, { id: 'g2', soldierType: 'trooper', x: 22, z: 20 });
  w.alarm.raise('z_s', 'explosion', 10, 10, { sensor: 'heard' });
  e.brain.state = 'INVESTIGATE'; // goes to look at the blast
  d.brain.state = 'DECOY'; // a radio decoy never holds the lamp
  tick(w, CONFIG.alarm.sirenDur + 5);
  assert.equal(w.alarm.active, false, 'siren over');
  assert.equal(w.alarm.lamp, true, 'lamp still lit: g1 is investigating the blast');
  e.brain.state = 'SEARCH';
  tick(w, 10);
  assert.equal(w.alarm.lamp, true, 'still lit: searching');
  e.brain.state = 'RETURN';
  tick(w, DT * 2);
  assert.equal(w.alarm.lamp, false, 'dark: the search is called off (DECOY does not count)');
  assert.deepEqual(w.lampLog.map((l) => l.on), [true, false]);
});

test('alarm lamp: a released squad on its exit run holds it; never lit past lampMax', () => {
  const w = world();
  const e = addEnemy(w, { id: 'r1', soldierType: 'trooper', x: 20, z: 20 });
  w.alarm.fireEvent('RCAMP', { zoneId: 'z_camp', cause: 'seen', x: 60, z: 5 });
  e.brain.reinforce([{ x: 30, z: 30 }, { x: 35, z: 30 }], [{ x: 35, z: 35 }, { x: 30, z: 35 }]);
  tick(w, CONFIG.alarm.lampHold + 1);
  assert.equal(w.alarm.lamp, true, 'exit run under way');
  e.brain.routeIndex = e.brain._loopStart; // on his loop now: a normal patrol again
  tick(w, DT * 2);
  assert.equal(w.alarm.lamp, false, 'dark once the squad patrols its loop');
  const w2 = world();
  const s = addEnemy(w2, { id: 's1', soldierType: 'trooper', x: 20, z: 20 });
  w2.alarm.raise('z_camp', 'seen', 60, 10);
  s.brain.state = 'COMBAT'; // stuck answering for ever
  tick(w2, CONFIG.alarm.lampMax - 1);
  assert.equal(w2.alarm.lamp, true);
  tick(w2, 2);
  assert.equal(w2.alarm.lamp, false, 'capped at lampMax after the last event');
});

test('alarm lamp: a new event restarts the hold; save / load keeps the lamp', () => {
  const w = world();
  w.alarm.raise('z_camp', 'seen', 60, 10);
  tick(w, CONFIG.alarm.lampHold - 2);
  w.alarm.raise('z_camp', 'seen', 60, 10);
  tick(w, 5);
  assert.equal(w.alarm.lamp, true, 'second event restarted the hold');
  const snap = JSON.parse(JSON.stringify(w.alarm.serialize()));
  const w2 = world();
  w2.alarm.deserialize(snap);
  assert.equal(w2.alarm.lamp, true, 'restored lit');
  tick(w2, CONFIG.alarm.lampHold);
  assert.equal(w2.alarm.lamp, false, 'and goes dark on the restored hold');
  const w3 = world();
  w3.alarm.deserialize({ siren: { active: false, gain: 0, t: 0 }, zonesFired: [] }); // a save from before the lamp
  assert.equal(w3.alarm.lamp, false);
});

test('alarm lamp: the HUD topbar reads alarm.lamp (not the siren alone)', () => {
  const src = readFileSync(new URL('../../src/ui/topbar.js', import.meta.url), 'utf8');
  assert.match(src, /this\.lamp\.classList\.toggle\('on',[^\n]*alarm\?\.lamp/);
});
