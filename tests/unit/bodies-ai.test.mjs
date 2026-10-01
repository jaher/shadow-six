/** bodies-design §C.9, §C.6, §E: guards react to men moving bodies (both modes) and to DOWNED commandos. */
import { CONFIG } from '../../src/config.js';
import { test, assert } from './lib.mjs';
import { makeWorld, addCommando, run, first } from './ai-harness.mjs';
import { takeLoad } from '../../src/abilities/bodies.js';
import { canSee } from '../../src/ai/perception.js';
import { T } from '../../src/world/grid.js';
import { makeSim } from './abilsim.mjs';

// a guard at (20, 40) looking east with a fixed head (sweep 0): far 36 m, near 18 m
const GUARD = { id: 'g', soldierType: 'sentry', x: 20, z: 40, heading: 0, post: { heading: 0, sweep: 0 } };
const ZONE = { id: 'camp', poly: [[0, 0], [80, 0], [80, 80], [0, 80]], onSeen: 'RINT', onHeard: null };
const VICTIM = { id: 'v', soldierType: 'soldier', x: 70, z: 70, heading: 0 };

test('seen dragging (standing still, far band) → N = 20·T at once and a CHALLENGE, as for a shoulder carry', () => {
  for (const mode of ['drag', 'shoulder', null]) {
    const w = makeWorld({ enemies: [GUARD, VICTIM] });
    const g = w.enemies[0], v = w.enemies[1];
    v.die('knife', null);
    const c = addCommando(w, mode === 'shoulder' ? 'greenberet' : 'sniper', 45, 36);
    if (mode) takeLoad(c, v, mode);
    run(w, 1);
    if (mode) {
      assert.ok(first(w, 'enemy:challenge', (p) => p.target === c), `${mode}: challenged`);
      assert.ok(['CHALLENGE', 'HOLD'].includes(g.brainState), g.brainState);
    } else assert.equal(first(w, 'enemy:challenge'), null, 'a still man with no load is not challenged');
  }
});

test('the disguised Spy seen dragging is unmasked (like carrying)', () => {
  const w = makeWorld({ enemies: [GUARD, VICTIM] });
  const v = w.enemies[1];
  v.die('knife', null);
  const spy = addCommando(w, 'spy', 30, 40);
  spy.setDisguise(true);
  run(w, 0.5);
  assert.equal(spy.disguised, true, 'unseen as a German');
  takeLoad(spy, v, 'drag');
  run(w, 0.5);
  assert.equal(spy.disguised, false, 'unmasked');
});

test('a transported body (either mode) is not BODY-discoverable', () => {
  for (const mode of ['drag', 'shoulder']) {
    const w = makeWorld({ enemies: [GUARD, { id: 'v', soldierType: 'soldier', x: 40, z: 40, heading: 0 }] });
    const g = w.enemies[0], v = w.enemies[1];
    const c = addCommando(w, 'greenberet', 41, 40);
    v.die('knife', null);
    takeLoad(c, v, mode);
    c._updateCarried();
    assert.equal(canSee(g, v, w), 'none', mode);
  }
});

test('a seen DOWNED commando = body found (zone alarm, once) + covered, finished only after the rescue window', () => {
  const w = makeWorld({ enemies: [GUARD], zones: [ZONE] });
  const g = w.enemies[0];
  const c = addCommando(w, 'sniper', 32, 40);
  addCommando(w, 'spy', 5, 5); // someone who could still help (no "nobody left" shortcut needed here)
  c.takeDamage(c.hp, null, 'shot');
  assert.equal(c.state, 'downed');
  const P = CONFIG.bodies.downed;
  run(w, P.finishDelay * 0.7);
  assert.equal(g.sawBody, true);
  assert.ok(w.alarm.zonesFired.some((z) => z.cause === 'body'), 'zone alarm (body)');
  assert.equal(w.alarm.zonesFired.filter((z) => z.cause === 'body').length, 1, 'one body alarm');
  assert.equal(c.alive, true, 'covered, not shot on sight: a comrade can still act');
  assert.ok(Math.hypot(g.x - c.x, g.z - c.z) <= P.coverRange + 0.6, 'the guard closed in');
  assert.ok(c.downed.alarmed, 'the alarm flag lives in the (saved) downed state');
  run(w, 20, () => !c.alive);
  assert.equal(c.alive, false, 'finished after the window');
});

test('the dragger leaves normal gameplay prints on snow (heading reversed); guards read prints, never blood', () => {
  const s = makeSim({ baseTerrain: 'snow', commandos: [{ role: 'sniper', x: 29, z: 30, heading: 0 }], enemies: [{ id: 'v', soldierType: 'soldier', x: 30, z: 30 }] }, { brains: false });
  const w = s.world, c = s.cmd('sniper'), v = s.get('v');
  v.die('shot', null);
  takeLoad(c, v, 'drag');
  const prints = [];
  w.events.on('footprint', (p) => prints.push(p));
  c.moveTo(10, 30);
  s.run(6);
  assert.equal(w.groundAt(c.x, c.z).terrainCode, T.SNOW);
  assert.ok(prints.length > 0, 'prints');
  assert.ok(prints.every((p) => p.aiVisible === true));
  assert.ok(prints.slice(1).every((p) => Math.cos(p.heading) > 0.95), 'facing +x while walking −x');
});
