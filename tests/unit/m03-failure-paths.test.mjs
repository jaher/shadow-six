/**
 * M3 failure paths (design-spec §4.9 zones, §7.6 intended solution steps 3, 4 and 6). The scripted play review
 * found three ways to lose M3 that come straight from the rules, not from bugs. These tests pin the rules down
 * so the stealth route stays winnable and the punishments stay in place:
 *  (a) the Diver RUNNING to the raft at (64,45) is challenged by e17 across the river. When he then boards, e17
 *      (standing in z_south) goes to COMBAT: RINT, siren, squads. CRAWLING there is unseen, with no alarm.
 *  (b) the bunker blast (step 6) breaks the Spy's Distract on e18, and e18 and the camp walkers converge on the
 *      dam. A Sapper still crawling on the crest ~17 m from the blast is shot; one who already left it is not.
 *  (c) the Spy injecting e18 at the N gate right after leaving e17 is witnessed (e17 in the review, p5 here —
 *      timing decides who): COMBAT, alarm, the Spy dies.
 *      Walking past e18 in uniform (step 4) raises nothing.
 * Headless: full M3 with brains + Alarm; step 1–3 kills (p1, e4–e6, e14) done by removal, as in the review.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';
import { Alarm } from '../../src/ai/alarm.js';
import { applyExplosion } from '../../src/abilities/explosions.js';

function m03Sim() {
  const s = makeSim(getMission('m03'));
  const w = s.world;
  w.alarm = new Alarm(w); // Game.loadMission installs it; step it after the entities like Game.step
  const step = s.step;
  s.step = (dt = 1 / 60) => { step(dt); w.alarm.update(dt); };
  for (const id of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e14']) w.remove(s.get(id));
  w.flushRemovals();
  s.alarms = [];
  s.challenges = [];
  s.squads = 0;
  s.combat = [];
  w.events.on('alarm:zone', (p) => s.alarms.push({ t: w.time, zone: p.zone?.id ?? p.zone ?? p.id, event: p.event }));
  w.events.on('enemy:challenge', (p) => s.challenges.push({ t: w.time, by: p.enemy?.tag, target: p.target }));
  w.events.on('reinforcements', () => s.squads++);
  w.events.on('enemy:state', (p) => { if (p.to === 'COMBAT') s.combat.push({ t: w.time, by: p.enemy?.tag, target: p.enemy?.brain?.target }); });
  return s;
}
const place = (u, x, z) => { u.x = x; u.z = z; u.y = 0; u.path = null; };

for (const mode of ['run', 'crawl']) {
  test(`m03 (a) §4.9: Diver ${mode === 'run' ? 'RUNNING' : 'CRAWLING'} to the raft at (64,45) ${mode === 'run' ? 'is challenged by e17 → z_south RINT + siren + squads' : 'stays unseen, no alarm'}`, () => {
    const s = m03Sim(), w = s.world, d = s.cmd('diver'), e17 = s.get('e17');
    place(d, 72, 36);
    if (mode === 'crawl') d.issue({ type: 'stance', stance: 'crawl' });
    assert.ok(d.issue({ type: 'move', x: 65.5, z: 43.5, run: mode === 'run' }));
    s.run(20);
    assert.ok(Math.hypot(d.x - 65.5, d.z - 43.5) < 0.5, 'reached the bank by the raft');
    d.issue({ type: 'move', x: 64, z: 45.5 }); // step onto the raft
    s.run(10);
    if (mode === 'run') {
      assert.ok(s.challenges.some((c) => c.by === 'e17' && c.target === d), 'e17 challenges the Diver across the river');
      assert.ok(Math.hypot(e17.x - d.x, e17.z - d.z) > 28, 'from ~30 m, on the far bank');
      assert.equal(w.alarm.zoneAt(e17.x, e17.z)?.id, 'z_south', 'e17 stands in z_south');
      assert.ok(s.alarms.some((a) => a.zone === 'z_south' && a.event === 'RINT'), 'RINT fired by z_south');
      assert.ok(w.alarm.active, 'siren on');
      assert.ok(s.squads >= 2, `barracks release squads (${s.squads})`);
    } else {
      assert.equal(s.challenges.length, 0, 'nobody challenges a crawling Diver');
      assert.equal(s.alarms.length, 0, 'no alarm');
      assert.equal(w.alarm.active, false);
    }
  });
}

const WALKERS = ['e7', 'e8', 'e10', 'e11', 'e13'];
for (const where of ['crest', 'off']) {
  test(`m03 (b) §7.6 step 6: the bunker blast breaks the Distract on e18; a Sapper ${where === 'crest' ? 'still on the crest is shot' : 'already off the crest is safe'}`, () => {
    const s = m03Sim(), w = s.world, spy = s.cmd('spy'), sap = s.cmd('sapper'), e18 = s.get('e18');
    place(spy, 26, 62.5);
    spy.disguised = true;
    s.run(1);
    assert.ok(e18.brain.distractBy(spy), 'the Spy holds e18 in Distract');
    const [sx, sz] = where === 'crest' ? [28, 37] : [52, 15]; // crest: ~17 m from the charge; off: the N road
    place(sap, sx, sz);
    sap.issue({ type: 'stance', stance: 'crawl' });
    s.run(1);
    const hits = [];
    w.events.on('unit:damaged', (p) => { if (p.unit === sap && (p.source || p.by)?.faction === 'enemy') hits.push(w.time); });
    const from = Object.fromEntries(WALKERS.map((t) => [t, [s.get(t).x, s.get(t).z]]));
    applyExplosion(w, 17, 49.8, 'bomb', null); // charge one behind the bunker (o1)
    const states = [];
    s.run(40, () => { const st = e18.brain.state; if (states.at(-1) !== st) states.push(st); return false; });
    assert.equal(states[0], 'INVESTIGATE', `e18 drops the Distract and investigates (${states.join('>')})`);
    assert.ok(e18.brain.distractedBy == null, 'distraction released');
    assert.ok(s.alarms.some((a) => a.zone === 'z_south' && a.event === 'RINT'), 'the blast sounds the alarm (step 6)');
    const walked = WALKERS.map((t) => Math.hypot(s.get(t).x - from[t][0], s.get(t).z - from[t][1]));
    assert.ok(walked.every((m) => m > 60), `the camp walkers converge on the dam (${walked.map((m) => m.toFixed(0))} m)`);
    if (where === 'crest') {
      assert.ok(hits.length > 0, 'the crawling Sapper on the crest is shot');
      assert.equal(sap.alive, false);
    } else {
      assert.equal(hits.length, 0, 'nobody fires on the Sapper off the crest');
      assert.equal(sap.alive, true);
    }
  });
}

for (const act of ['inject', 'walk']) {
  test(`m03 (c) §7.6 step 4: after leaving e17, the Spy ${act === 'inject' ? 'injecting e18 at the N gate is seen → COMBAT, alarm, the Spy dies' : 'walking past e18 in uniform raises nothing'}`, () => {
    const s = m03Sim(), w = s.world, spy = s.cmd('spy'), e17 = s.get('e17'), e18 = s.get('e18');
    w.fencePower.set('st_fence', false); // the switch is off (step 4)
    place(spy, 48.5, 72.5);
    spy.disguised = true;
    s.run(0.5);
    assert.ok(spy.issue({ type: 'ability', id: 'distract', target: e17 }));
    s.run(5);
    assert.equal(e17.brain.state, 'DISTRACTED', 'e17 distracted');
    spy.issue({ type: 'stop' });
    s.run(0.5);
    assert.ok(e17.brain.distractedBy == null, 'released when the Spy leaves');
    if (act === 'inject') {
      assert.ok(spy.issue({ type: 'ability', id: 'syringe', target: e18 }));
      s.run(40, () => !spy.alive);
      assert.equal(e18.alive, false, 'e18 injected');
      assert.ok(s.combat.some((c) => c.target === spy), 'a witness goes to COMBAT against the Spy');
      assert.ok(s.alarms.some((a) => a.zone === 'z_south' && a.event === 'RINT'), 'z_south RINT');
      assert.equal(spy.alive, false, 'the Spy is shot');
    } else {
      assert.ok(spy.issue({ type: 'move', x: 26, z: 57 }));
      s.run(40);
      assert.ok(Math.hypot(spy.x - 26, spy.z - 57) < 1, 'the Spy reached the N gate path');
      assert.equal(e18.alive, true);
      assert.equal(s.combat.length, 0, 'nobody fights');
      assert.equal(s.alarms.length, 0, 'no alarm');
      assert.equal(spy.alive, true);
    }
  });
}
