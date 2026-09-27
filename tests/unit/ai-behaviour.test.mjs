/** design-spec §10.5 behaviour tests #1–#7 (headless sim, exact 60 Hz / 20 Hz time base). */
import { test, assert, near } from './lib.mjs';
import { makeWorld, addEnemy, addCommando, run, first } from './ai-harness.mjs';

// a guard at (20, 40) looking east with a fixed head (sweep 0): far 36 m, near 18 m
const GUARD = { id: 'g', soldierType: 'sentry', x: 20, z: 40, heading: 0, post: { heading: 0, sweep: 0 } };
const ZONE = { id: 'camp', poly: [[0, 0], [80, 0], [80, 80], [0, 80]], onSeen: 'RINT', onHeard: null };

function challengeTime(w, c) {
  const ch = first(w, 'enemy:challenge', (p) => p.target === c);
  return ch ? ch.t : null;
}

test('#1 walking commando in the far band → challenge in ≤ 0.35 s', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const c = addCommando(w, 'greenberet', 45, 36);
  run(w, 0.5); // settle (N = 0: standing still)
  const t0 = w.time;
  c.moveTo(45, 50);
  run(w, 1.0, () => challengeTime(w, c) != null);
  const dt = challengeTime(w, c) - t0;
  assert.ok(dt > 0 && dt <= 0.35, `challenged after ${dt.toFixed(3)} s`);
  assert.equal(w.enemies[0].brainState, 'CHALLENGE');
  assert.equal(c.held, true, 'target held (portrait flash)');
});

test('#2 crawling commando in the far band → never seen', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const c = addCommando(w, 'greenberet', 45, 36);
  c.setStance('crawl');
  run(w, 1);
  c.moveTo(45, 46);
  run(w, 12);
  assert.equal(challengeTime(w, c), null);
  assert.equal(w.enemies[0].nervousness, 0);
  assert.equal(w.enemies[0].alertLevel, 0);
});

test('#3 crawling commando in the near band → challenge in 2.5 s ± 0.2', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const c = addCommando(w, 'greenberet', 32, 34);
  c.setStance('crawl');
  run(w, 1);
  const t0 = w.time;
  c.moveTo(32, 46);
  run(w, 5, () => challengeTime(w, c) != null);
  const dt = challengeTime(w, c) - t0;
  near(dt, 2.5, 0.2, 'crawl challenge time');
});

test('#4 frozen commando never challenged; stopping once challenged = held forever, no fire, no zone event', () => {
  const w = makeWorld({ enemies: [GUARD], zones: [ZONE] });
  const c = addCommando(w, 'greenberet', 30, 40);
  run(w, 20);
  assert.equal(challengeTime(w, c), null, 'frozen: never challenged');
  assert.equal(first(w, 'shot'), null);
  // walk → challenged → stop at once (option Indifferent: the player stops him)
  w.events.on('enemy:challenge', (p) => { if (p.target === c) c.stop(); });
  c.moveTo(30, 50);
  run(w, 60);
  assert.ok(challengeTime(w, c) != null, 'challenged');
  assert.equal(w.enemies[0].brainState, 'HOLD');
  assert.equal(c.held, true);
  assert.equal(first(w, 'shot'), null, 'no fire');
  assert.equal(w.alarm.zonesFired.length, 0, 'no zone event');
  assert.equal(c.hp, c.maxHp);
  // moving more than 0.3 m now → COMBAT and fire (80 per rifle hit)
  c.moveTo(30, 45);
  run(w, 1.2);
  assert.equal(w.enemies[0].brainState, 'COMBAT');
  assert.ok(first(w, 'shot'), 'fires');
  assert.ok(c.hp < c.maxHp && (c.maxHp - c.hp) % 80 === 0, `rifle 80 per hit (hp ${c.hp})`);
  assert.equal(w.alarm.zonesFired[0]?.event, 'RINT', 'COMBAT inside the zone fires onSeen');
});

test('#5 pistol shot 15 m from a guard outside any zone → INVESTIGATE, no zone event', () => {
  const w = makeWorld({ enemies: [{ id: 's', soldierType: 'soldier', x: 20, z: 20, heading: Math.PI }], zones: [{ id: 'far', poly: [[60, 60], [79, 60], [79, 79], [60, 79]], onSeen: 'RINT', onHeard: 'RINT' }] });
  const e = w.enemies[0];
  run(w, 0.2);
  w.emitNoise(35, 20, 18, 'pistol', null);
  run(w, 0.1);
  assert.equal(e.brainState, 'INVESTIGATE');
  run(w, 12, () => e.brainState !== 'INVESTIGATE');
  assert.ok(Math.hypot(e.x - 35, e.z - 20) <= 1.6, 'walked to within 1.5 m');
  assert.equal(w.alarm.zonesFired.length, 0);
  assert.equal(e.brainState, 'RETURN');
  // a shot heard by a guard standing inside a zone trips its onHeard sensor (§4.9)
  const w2 = makeWorld({ enemies: [{ id: 's', soldierType: 'soldier', x: 20, z: 20, heading: 0 }], zones: [{ ...ZONE, onHeard: 'REXT' }] });
  w2.emitNoise(35, 20, 18, 'pistol', null);
  assert.equal(w2.alarm.zonesFired[0]?.event, 'REXT');
});

test('#6 body in the far band → BODY → RINT (siren 25 s)', () => {
  const w = makeWorld({ enemies: [GUARD, { id: 'v', soldierType: 'soldier', x: 48, z: 40, heading: 0 }], zones: [ZONE] });
  const g = w.enemies[0], v = w.enemies[1];
  v.die('knife', null);
  run(w, 0.1);
  assert.equal(g.brainState, 'BODY');
  assert.equal(g.sawBody, true);
  run(w, 5, () => w.alarm.active);
  assert.equal(w.alarm.zonesFired[0].event, 'RINT');
  assert.equal(w.alarm.zonesFired[0].cause, 'body');
  near(w.alarm.siren.gain, 0.75, 0.01);
  assert.ok(first(w, 'enemy:body-found'), 'body-found');
  assert.equal(v.bodyNoticed, true);
  run(w, 24.5);
  assert.equal(w.alarm.active, true);
  run(w, 0.6);
  assert.equal(w.alarm.active, false, 'siren over after 25 s');
});

test('#7 decoy on → nearest investigating guard walks to 2 m and stares; off → returns after 5 s', () => {
  const w = makeWorld({ enemies: [{ id: 's', soldierType: 'soldier', x: 20, z: 20, heading: Math.PI }] });
  const e = w.enemies[0];
  const decoy = { id: 'decoy', on: true };
  const pulse = () => w.emitNoise(30, 26, 13.5, 'decoy', decoy);
  let next = 0;
  for (let i = 0; i < 60 * 12; i++) {
    if (w.time >= next) { pulse(); next += 1.5; }
    run(w, 1 / 60);
  }
  assert.equal(e.brainState, 'DECOY');
  const d = Math.hypot(e.x - 30, e.z - 26);
  assert.ok(d <= 2.05 && d >= 1.0, `stands ~2 m from the decoy (${d.toFixed(2)})`);
  near(Math.atan2(26 - e.z, 30 - e.x), e.heading, 0.05, 'stares at it');
  assert.equal(e.sweepActive, false);
  decoy.on = false;
  const t0 = w.time;
  run(w, 8, () => e.brainState !== 'DECOY');
  near(w.time - t0, 5.0, 0.1, 'gives up after 5 s');
  assert.equal(e.brainState, 'RETURN');
});

// Regression (gp fix "unit separation"): two guards drawn to one decoy stacked on the same point (s1: e1/e2 at
// 11.6,93.3 DECOY/1). Each investigator takes his own stand-off slot on the 2 m ring and still stares at it.
test('#7b decoy: two investigators take separate stand-off slots, both ~2 m out, both staring', () => {
  const w = makeWorld({ enemies: [
    { id: 'a', soldierType: 'soldier', x: 20, z: 20, heading: Math.PI },
    { id: 'b', soldierType: 'soldier', x: 20.4, z: 20.3, heading: Math.PI },
  ] });
  const decoy = { id: 'decoy', on: true };
  let next = 0;
  for (let i = 0; i < 60 * 12; i++) {
    if (w.time >= next) { w.emitNoise(30, 26, 13.5, 'decoy', decoy); next += 1.5; }
    run(w, 1 / 60);
  }
  const [a, b] = w.enemies;
  for (const e of [a, b]) {
    assert.equal(e.brainState, 'DECOY', e.id);
    const d = Math.hypot(e.x - 30, e.z - 26);
    assert.ok(d <= 2.05 && d >= 1.0, `${e.id} stands ~2 m from the decoy (${d.toFixed(2)})`);
    near(Math.atan2(26 - e.z, 30 - e.x), e.heading, 0.05, `${e.id} stares at it`);
  }
  const gap = Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(gap >= 1.0, `not stacked (${gap.toFixed(2)} m apart)`);
});

// Regression (gp fix "alarm on a zone-less map (m1)"): an explicit `zones: []` (M1, §7.4 "the entire map is
// safe") must not fall back to the map-wide RINT zone — bodies and sightings only cause local reactions.
function bodyScene(extra) {
  const w = makeWorld({ enemies: [GUARD, { id: 'v', soldierType: 'soldier', x: 48, z: 40, heading: 0 }], ...extra });
  w.enemies[1].die('knife', null);
  run(w, 6);
  return w;
}
function sightScene(extra) {
  const w = makeWorld({ enemies: [GUARD], ...extra });
  const c = addCommando(w, 'greenberet', 30, 40); // 10 m straight ahead: near band
  c.moveTo(30, 45);
  run(w, 2);
  return w;
}

test('zones: [] (M1) — a found body or a sighting fires no zone event, no siren, no alarm stat', () => {
  const wb = bodyScene({ zones: [] });
  assert.ok(first(wb, 'enemy:body-found'), 'body still found (local reaction)');
  assert.deepEqual(wb.alarm.zonesFired, []);
  assert.equal(wb.alarm.active, false);
  assert.equal(wb.stats.alarms, 0);
  assert.equal(first(wb, 'alarm:start'), null);
  const ws = sightScene({ zones: [] });
  assert.equal(ws.enemies[0].brainState, 'COMBAT', 'guard still engages locally');
  assert.deepEqual(ws.alarm.zonesFired, []);
  assert.equal(ws.stats.alarms, 0);
  // explosions too (onHeard): nothing escalates
  ws.events.emit('explosion', { x: 30, z: 40 });
  assert.deepEqual(ws.alarm.zonesFired, []);
});

test('no `zones` key (sandbox/tests) or noZonesFallback: true keeps the map-wide RINT fallback', () => {
  for (const extra of [{}, { zones: [], noZonesFallback: true }]) {
    const wb = bodyScene(extra);
    assert.equal(wb.alarm.zonesFired[0]?.event, 'RINT', JSON.stringify(extra));
    assert.equal(wb.alarm.zonesFired[0]?.cause, 'body');
    assert.equal(wb.stats.alarms, 1);
    const ws = sightScene(extra);
    assert.equal(ws.alarm.zonesFired[0]?.event, 'RINT');
    assert.equal(ws.stats.alarms, 1);
  }
});

// regression: 'unit:damaged' fires before die(), so a lethal silent kill used to run onHurt on the dying man
test('silent instant kill (harpoon/knife KILL) → no COMBAT, no spotted/seen flash, no bark from the dead man', () => {
  for (const cause of ['harpoon', 'knife']) {
    const w = makeWorld({ enemies: [GUARD] });
    const c = addCommando(w, 'diver', 18, 40);
    run(w, 0.2);
    for (const t of ['unit:killed', 'enemy:spotted', 'ui:warning']) w.events.on(t, (p) => w.log.push({ t: w.time, type: t, p }));
    const e = w.enemies[0];
    const n0 = w.log.length;
    e.takeDamage(1e5, c, cause);
    const log = w.log.slice(n0);
    assert.equal(e.alive, false, cause);
    assert.ok(log.some((l) => l.type === 'unit:killed' && l.p.unit === e), `${cause}: killed`);
    assert.notEqual(e.brainState, 'COMBAT', `${cause}: dead man entered COMBAT`);
    for (const l of log) {
      assert.ok(!(l.type === 'enemy:state' && l.p?.to === 'COMBAT'), `${cause}: enemy:state → COMBAT`);
      assert.ok(l.type !== 'enemy:spotted', `${cause}: enemy:spotted`);
      assert.ok(l.type !== 'ui:warning', `${cause}: ui:warning`);
      assert.ok(!(l.type === 'bark' && l.p?.unit === e), `${cause}: bark ${l.p?.line}`);
    }
  }
});

test('a non-lethal hit still makes the wounded enemy hunt the shooter (§4.1)', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const c = addCommando(w, 'greenberet', 30, 40);
  run(w, 0.2);
  const e = w.enemies[0];
  e.takeDamage(1, c, 'shot');
  assert.equal(e.alive, true);
  assert.ok(first(w, 'bark', (p) => p.unit === e && p.line === 'ger_hurt'), 'hurt bark');
  assert.equal(e.brainState, 'COMBAT');
});

test('§4.1 route `look` is in degrees: a walker waiting at a point with look 180 faces west (heading ≈ π)', () => {
  const w = makeWorld({ enemies: [{ id: 'wk', soldierType: 'soldier', x: 20, z: 40, heading: 0, vision: { sweep: 0 },
    route: { type: 'PINGPONG', points: [{ x: 20, z: 40 }, { x: 30, z: 40, wait: 8, look: 180 }] } }] });
  const e = w.enemies[0];
  run(w, 30, () => e.brain.atWait && Math.hypot(e.x - 30, e.z - 40) < 1);
  assert.ok(e.brain.atWait, 'reached the wait point');
  run(w, 1.5);
  assert.ok(e.brain.atWait, 'still waiting');
  const d = Math.atan2(Math.sin(e.heading - Math.PI), Math.cos(e.heading - Math.PI));
  assert.ok(Math.abs(d) < 0.35, `heading ${(e.heading * 180 / Math.PI).toFixed(1)}° (want ≈ 180°)`);
});
