/**
 * §4.6 BODY, the alarmed reaction to a mate's body (user 2026-11-09: "When enemies see dead bodies of their mates they
 * should act a bit more alarmed. Eventually they should raise the alarm like in the original"; CONFIG.ai.body):
 * startle → run → kneel + "man down" → look round, weapon up → "Alarm!" (his zone's event) → an alarmed search; mates
 * who hear him are on edge and search round the body; escalation (second body, alarm up); the rules kept (alarms:false,
 * hidden / carried bodies, ignoreFrom, the claim).
 */
import { CONFIG } from '../../src/config.js';
import { test, assert, near } from './lib.mjs';
import { makeWorld, addCommando, run, first, DT } from './ai-harness.mjs';

const B = CONFIG.ai.body;
const ZONE = { id: 'camp', poly: [[0, 0], [80, 0], [80, 80], [0, 80]], onSeen: 'RINT', onHeard: null };
// an investigating soldier at (20, 40) facing east; his mate's body 14 m ahead
const FINDER = { id: 'g', soldierType: 'soldier', x: 20, z: 40, heading: 0, flags: { investigates: true, holdsPost: false } };
const VICTIM = { id: 'v', soldierType: 'soldier', x: 34, z: 40, heading: 0 };
// a post (sentry, fixed head) at (20, 40) facing east
const POST = { id: 'g', soldierType: 'sentry', x: 20, z: 40, heading: 0, post: { heading: 0, sweep: 0 } };

/** World + the victim killed (no killer: nobody saw it). Also logs every noise. */
function scene(enemies, extra = {}) {
  const w = makeWorld({ enemies, ...extra });
  w.events.on('noise', (n) => w.log.push({ t: w.time, type: 'noise', p: n }));
  w.byId('v').die('knife', null);
  return w;
}
const barks = (w, id) => w.log.filter((l) => l.type === 'bark' && (l.p.unit?.tag ?? l.p.unit?.id) === id).map((l) => l.p.line);
const zoneEvents = (w) => w.alarm.zonesFired.map((z) => `${z.event}/${z.cause}`);

test('BODY: startle (stop, cry, weapon up) → RUN to the body → kneel + "man down" → look round → "Alarm!" → alarmed search', () => {
  const w = scene([FINDER, VICTIM], { zones: [ZONE] });
  const g = w.byId('g'), v = w.byId('v'), T = g.nervThreshold;
  run(w, 2 * DT);
  assert.equal(g.brainState, 'BODY');
  assert.equal(g.brain.phase, 'startle', 'he stops dead first');
  assert.equal(g.isMoving, false);
  assert.equal(g.idleAnim, 'aim', 'weapon up');
  assert.equal(g.alertLevel, 2, 'alert level 2 at once (alertBoost; the cone tint with alertTint)');
  assert.ok(g.nervousness < T, `not yet jumpy while he deals with the body (the player's window): N ${g.nervousness}`);
  assert.deepEqual(barks(w, 'g'), ['ger_startle'], 'a startled cry, not yet the alarm');
  const cry = first(w, 'noise', (n) => n.kind === 'startle');
  assert.ok(cry && cry.p.level === 1 && cry.p.body && cry.p.about, 'the startle noise: level 1, about the body');
  assert.deepEqual(zoneEvents(w), [], 'no zone event on sight');
  // the startle over: he runs (chase speed) to the body
  run(w, B.startle);
  assert.equal(g.brain.phase, 'go');
  run(w, 0.3);
  const sp = Math.hypot(g.vx, g.vz);
  near(sp, B.run, 0.25, 'runs at the chase speed');
  assert.equal(g.moveMode, 'run');
  run(w, 10, () => g.brain.phase === 'kneel');
  assert.equal(g.brain.phase, 'kneel');
  assert.ok(Math.hypot(g.x - v.x, g.z - v.z) <= B.arrive + 0.15, 'kneels by the body');
  const tKneel = w.time;
  run(w, 3, () => !!first(w, 'enemy:body-found'));
  near(first(w, 'enemy:body-found').t - tKneel, B.kneel, 2 * DT, 'kneels kneel s');
  assert.equal(v.bodyNoticed, true);
  assert.equal(g.brain.phase, 'look');
  assert.deepEqual(barks(w, 'g'), ['ger_startle', 'ger_mandown']);
  assert.deepEqual(zoneEvents(w), [], 'still no alarm while he looks round');
  // the look round: he turns about, weapon up, then raises the alarm
  const h0 = g.heading, tLook = w.time;
  let swing = 0;
  run(w, B.look + 0.5, () => { swing = Math.max(swing, Math.abs(Math.atan2(Math.sin(g.heading - h0), Math.cos(g.heading - h0)))); assert.equal(g.idleAnim, 'aim'); return w.alarm.zonesFired.length > 0; });
  assert.ok(swing > 1.5, `he turns about (max ${(swing * 180 / Math.PI).toFixed(0)}° off the body)`);
  near(w.time - tLook, B.look, 2 * DT, 'the alarm after the look round');
  assert.deepEqual(zoneEvents(w), ['RINT/body'], 'his zone event: siren + reinforcements');
  assert.equal(w.alarm.active, true);
  assert.deepEqual(barks(w, 'g'), ['ger_startle', 'ger_mandown', 'ger_alarm']);
  assert.ok(g.nervousness > (B.nervous - 1) * T, `nervous from his alarm on: N ${g.nervousness}`);
  // an alarmed search round the body, then home — still on edge, sawBody for good
  run(w, DT);
  assert.equal(g.brainState, 'SEARCH');
  assert.equal(g.brain.searchT, B.search.time);
  assert.equal(g.brain.searchArmed, true);
  const tS = w.time;
  run(w, B.search.time + 1, () => g.brainState !== 'SEARCH');
  near(w.time - tS, B.search.time, 0.05, 'searches search.time s');
  assert.equal(g.brainState, 'RETURN');
  assert.equal(g.alertLevel, 2, 'still alert (alertHold)');
  assert.equal(g.sawBody, true);
  assert.equal(v._claimedBy, null, 'the claim is released');
});

test('BODY: a post takes it in where he stands (no run, no kneel): startle → "man down" → look round → alarm', () => {
  const w = scene([POST, VICTIM], { zones: [ZONE] });
  const g = w.byId('g');
  run(w, B.startle + B.look + 0.5, () => w.alarm.zonesFired.length > 0);
  near(first(w, 'enemy:body-found').t, B.startle, 3 * DT, 'man down after the startle');
  near(w.alarm.zonesFired[0].t, B.startle + B.look, 3 * DT, 'alarm after the look round');
  assert.ok(Math.hypot(g.x - 20, g.z - 40) < 1e-6, 'never left his post');
  run(w, 2);
  assert.equal(g.brainState, 'SEARCH');
  assert.equal(g.brain.phase, 'look', 'a post searches with his eyes');
});

test('BODY: a fast player can still silence the finder — killed while he looks round, no alarm', () => {
  const w = scene([FINDER, VICTIM], { zones: [ZONE] });
  const g = w.byId('g');
  run(w, 15, () => g.brain.phase === 'look');
  assert.equal(g.brain.phase, 'look');
  run(w, B.look * 0.5);
  g.die('knife', null);
  run(w, 10);
  assert.deepEqual(zoneEvents(w), [], 'no zone event');
  assert.equal(w.alarm.active, false);
  assert.ok(!barks(w, 'g').includes('ger_alarm'));
});

test('BODY escalation: a second body, or a body seen while the alarm is up → "Alarm!" at once', () => {
  // he found a body before (his own memory: a body somebody else found across the map does not count)
  const w0 = scene([FINDER, VICTIM, { id: 'old', soldierType: 'soldier', x: 70, z: 75, heading: 0 }], { zones: [ZONE] });
  w0.byId('old').die('knife', null);
  w0.byId('old').bodyNoticed = true;
  run(w0, 3 * DT);
  assert.deepEqual(zoneEvents(w0), [], 'a body found by somebody else: the usual startle');
  const w = scene([FINDER, VICTIM], { zones: [ZONE] });
  w.byId('g').brain.bodiesFound = 1;
  run(w, 3 * DT);
  assert.equal(w.byId('g').brainState, 'BODY');
  assert.deepEqual(zoneEvents(w), ['RINT/body'], 'the alarm on sight');
  assert.deepEqual(barks(w, 'g'), ['ger_alarm'], 'no startled cry: the alarm');
  // the alarm already up (a zone event a moment ago)
  const w2 = makeWorld({ enemies: [FINDER, VICTIM], zones: [ZONE] });
  w2.alarm.fireEvent('RINT', { zoneId: 'camp', cause: 'test', x: 5, z: 5 });
  w2.byId('v').die('knife', null);
  run(w2, 3 * DT);
  assert.deepEqual(zoneEvents(w2), ['RINT/test', 'RINT/body']);
  // two fresh bodies in view, apart: he takes the first, the second is the alarm at once
  const w3 = scene([FINDER, VICTIM, { id: 'v2', soldierType: 'soldier', x: 40, z: 47, heading: 0 }], { zones: [ZONE] });
  w3.byId('v2').die('knife', null);
  run(w3, 0.2);
  assert.equal(w3.byId('g').brainState, 'BODY');
  assert.deepEqual(zoneEvents(w3), ['RINT/body']);
  // ... but men cut down together (within body.scene m) are one find: the usual startle, the alarm after the look round
  const w4 = scene([FINDER, VICTIM, { id: 'v2', soldierType: 'soldier', x: 36, z: 42, heading: 0 }], { zones: [ZONE] });
  w4.byId('v2').die('knife', null);
  run(w4, 0.5);
  assert.deepEqual(zoneEvents(w4), [], 'one find: no alarm on sight');
  assert.deepEqual(barks(w4, 'g'), ['ger_startle']);
  run(w3, 20, () => w3.byId('g').brainState !== 'BODY');
  assert.equal(w3.alarm.zonesFired.filter((z) => z.cause === 'body').length, 1, 'one alarm for the first body, not one per phase');
  // his first body done, he goes to the second: the alarm (still up) is raised again on sight of it — each find is one
  run(w3, 60, () => w3.byId('v2').bodyNoticed);
  assert.equal(w3.byId('v').bodyNoticed && w3.byId('v2').bodyNoticed, true, 'both found');
  assert.equal(w3.alarm.zonesFired.filter((z) => z.cause === 'body').length, 2);
});

test('BODY: a patrol member still raises the alarm at once (§4.7), then goes to the body', () => {
  const w = scene([{ id: 'g', soldierType: 'trooper', x: 20, z: 40, heading: 0 }, VICTIM], { zones: [ZONE] });
  run(w, 3 * DT);
  assert.deepEqual(zoneEvents(w), ['RINT/body']);
  run(w, 10, () => !!first(w, 'enemy:body-found'));
  assert.ok(first(w, 'enemy:body-found'), 'and still kneels over it');
  run(w, B.look + 1);
  assert.equal(w.alarm.zonesFired.filter((z) => z.cause === 'body').length, 1, 'no second alarm after the look round');
});

test('BODY: alarms:false — the whole reaction, never an alarm; non-reacting types never react at all', () => {
  const w = scene([FINDER, VICTIM], { zones: [ZONE] });
  const g = w.byId('g');
  g.brain.arch = { ...g.brain.arch, alarms: false };
  run(w, 20);
  assert.ok(first(w, 'enemy:body-found'), 'he finds it');
  assert.ok(barks(w, 'g').includes('ger_startle'));
  assert.ok(!barks(w, 'g').includes('ger_alarm'), 'no alarm shout');
  assert.deepEqual(zoneEvents(w), [], 'no zone event');
  assert.equal(g.brainState, 'SEARCH', 'searches all the same');
  // an officer (reacts: false, alarms: false) does not react to a body at all
  const w2 = scene([{ ...FINDER, soldierType: 'officer' }, VICTIM], { zones: [ZONE] });
  run(w2, 10);
  assert.equal(first(w2, 'enemy:state', (p) => p.to === 'BODY'), null);
  assert.deepEqual(zoneEvents(w2), []);
});

test('BODY: hidden (under a barrel) or carried bodies are never found', () => {
  for (const hide of [(v) => { v.hiddenBody = true; }, (v) => { v.state = 'carried'; }]) {
    const w = makeWorld({ enemies: [FINDER, VICTIM], zones: [ZONE] });
    const v = w.byId('v');
    v.die('knife', null);
    hide(v);
    run(w, 10);
    assert.equal(first(w, 'enemy:state', (p) => p.to === 'BODY'), null);
    assert.equal(w.byId('g').sawBody, false);
    assert.deepEqual(zoneEvents(w), []);
  }
});

test('BODY: the first finder claims the body — a second guard who sees it only gets sawBody (one kneels, one alarm)', () => {
  const w = scene([FINDER, { ...FINDER, id: 'h', x: 20, z: 43 }, VICTIM], { zones: [ZONE] });
  run(w, 25);
  const entered = w.log.filter((l) => l.type === 'enemy:state' && l.p.to === 'BODY').map((l) => l.p.enemy.tag ?? l.p.enemy.id);
  assert.equal(entered.length, 1, `one finder (${entered})`);
  assert.equal(w.byId('g').sawBody && w.byId('h').sawBody, true, 'both saw it');
  assert.equal(w.log.filter((l) => l.type === 'enemy:body-found').length, 1);
  assert.equal(w.alarm.zonesFired.filter((z) => z.cause === 'body').length, 1);
});

test('BODY: mates who hear him — they turn to the startled cry (and stay put); "man down" puts them on edge; they come and search round the body', () => {
  const w = scene([FINDER, VICTIM,
    { id: 'c', soldierType: 'soldier', x: 22, z: 50, heading: Math.PI / 2, flags: { investigates: true, holdsPost: false } }, // 10 m off, facing away
    { id: 'p', soldierType: 'sentry', x: 26, z: 30, heading: -Math.PI / 2, post: { heading: -Math.PI / 2, sweep: 0 } }], { zones: [] });
  const c = w.byId('c'), p = w.byId('p'), g = w.byId('g');
  run(w, 3 * DT);
  assert.equal(c.brainState, 'INVESTIGATE');
  assert.equal(c.brain.phase, 'turn', 'the investigator turns to the cry');
  const c0 = { x: c.x, z: c.z };
  run(w, 1.2);
  assert.equal(c.brain.phase, 'look', 'and looks that way where he stands');
  assert.ok(Math.hypot(c.x - c0.x, c.z - c0.z) < 0.05, 'the startled cry alone does not bring him over');
  const toG = Math.atan2(g.z - p.z, g.x - p.x);
  assert.ok(Math.abs(Math.atan2(Math.sin(p.heading - toG), Math.cos(p.heading - toG))) < 0.2, 'the post faces the cry');
  run(w, 15, () => !!first(w, 'enemy:body-found'));
  run(w, 2 * DT);
  assert.equal(c.alertLevel, 2, 'on edge after "man down"');
  assert.ok(c.nervousness > (B.nervous - 1) * c.nervThreshold, 'nervous: a seen commando is challenged at once');
  assert.equal(p.alertLevel, 2);
  // the investigator comes over and searches round the body (no look-and-home, no "just the wind")
  let returned = false;
  run(w, 30, () => { if (c.brainState === 'RETURN') returned = true; return c.brainState === 'SEARCH'; });
  assert.equal(c.brainState, 'SEARCH');
  assert.equal(returned, false, 'never went home first');
  assert.equal(c.brain.searchArmed, true);
  const v = w.byId('v');
  assert.ok(c.brain.searchPts.concat(c.brain.goal ? [c.brain.goal] : []).every((q) => Math.hypot(q.x - v.x, q.z - v.z) <= B.search.radius + 3.5), 'round the body');
  assert.deepEqual(zoneEvents(w), [], 'zones: [] (M1): local reactions only, no siren');
});

test('BODY: a commando he sees while busy with the body is challenged (BODY no longer blinds him), and fought (sawBody)', () => {
  const w = scene([FINDER, VICTIM], { zones: [ZONE] });
  const g = w.byId('g');
  run(w, 15, () => g.brain.phase === 'kneel');
  // a Green Beret walks across beyond the body, in front of the kneeling man
  const c = addCommando(w, 'greenberet', g.x + 9, g.z - 3);
  c.moveTo(g.x + 9, g.z + 4);
  run(w, 1.5, () => !!first(w, 'enemy:challenge'));
  assert.ok(first(w, 'enemy:challenge'), 'challenged');
  assert.ok(first(w, 'enemy:state', (p) => p.enemy === g && p.from === 'BODY' && p.to === 'CHALLENGE'), 'from the BODY state');
  run(w, 1);
  assert.equal(g.brainState, 'COMBAT', 'sawBody: fire, no hold');
  assert.equal(w.byId('v')._claimedBy, null, 'the body is free for the next finder');
});

test('BODY: ignoreFrom (M18 islands) — a body lying in an ignored zone trips nothing, the finder still searches', () => {
  const zones = [
    { id: 'isl', poly: [[30, 30], [50, 30], [50, 50], [30, 50]], onSeen: null, onHeard: null },
    { id: 'all', poly: [[0, 0], [80, 0], [80, 80], [0, 80]], onSeen: 'RINT', onHeard: 'RINT', ignoreFrom: ['isl'] },
  ];
  const w = scene([FINDER, VICTIM], { zones });
  run(w, 25);
  assert.ok(first(w, 'enemy:body-found'));
  assert.ok(barks(w, 'g').includes('ger_alarm'), 'he cries the alarm');
  assert.deepEqual(zoneEvents(w), [], 'about an island body: nobody on the banks answers');
  assert.equal(w.byId('g').brainState, 'SEARCH');
});

test('BODY: save/load mid look-round and mid alarmed search keeps the phase, the goal and the search', () => {
  const w = scene([FINDER, VICTIM], { zones: [ZONE] });
  const g = w.byId('g');
  run(w, 15, () => g.brain.phase === 'look');
  const d = JSON.parse(JSON.stringify(g.brain.serialize()));
  g.brain.deserialize(d);
  assert.equal(g.brainState, 'BODY');
  assert.equal(g.brain.phase, 'look');
  assert.equal(g.brain.goal.body, w.byId('v'));
  run(w, B.look + 1);
  assert.equal(g.brainState, 'SEARCH');
  const s = JSON.parse(JSON.stringify(g.brain.serialize()));
  assert.equal(s.searchT, B.search.time);
  g.brain.searchT = 1; g.brain.searchArmed = false;
  g.brain.deserialize(s);
  assert.equal(g.brain.searchT, B.search.time);
  assert.equal(g.brain.searchArmed, true);
});
