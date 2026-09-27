/** §4.2 band rule, roof rule, disguise, emplacement operators, §4.3 seen list; misc brain hooks. */
import { test, assert, near } from './lib.mjs';
import { makeWorld, addEnemy, addCommando, run, first } from './ai-harness.mjs';
import { canSee, perceive, targetClass, sweepOffset } from '../../src/ai/perception.js';
import { B } from '../../src/world/grid.js';

const GUARD = { id: 'g', soldierType: 'sentry', x: 20, z: 40, heading: 0, post: { heading: 0, sweep: 0 } };
const T = (o) => ({ isLow: false, isVisibleToEnemies: true, ...o });

test('§4.2 band rule: standing full cone; crawler/footprint near only; body full; hidden/buried never', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const g = w.enemies[0];
  assert.equal(canSee(g, T({ x: 45, z: 40 }), w), 'far');
  assert.equal(canSee(g, T({ x: 30, z: 40 }), w), 'near');
  assert.equal(canSee(g, T({ x: 45, z: 40, isLow: true }), w), 'none');
  assert.equal(canSee(g, T({ x: 30, z: 40, isLow: true }), w), 'near');
  assert.equal(canSee(g, { x: 45, z: 40, kind: 'body' }, w), 'far', 'bodies: full cone [EXE]');
  assert.equal(canSee(g, { x: 45, z: 40, kind: 'footprint' }, w), 'none');
  assert.equal(canSee(g, { x: 30, z: 40, kind: 'footprint' }, w), 'near');
  assert.equal(canSee(g, { x: 30, z: 40, kind: 'footprint', aiVisible: false }, w), 'none', 'MUD / enemy prints');
  assert.equal(canSee(g, T({ x: 30, z: 40, isVisibleToEnemies: false }), w), 'none', 'buried / submerged / hidden');
  assert.equal(canSee(g, T({ x: 30, z: 40, disguised: true }), w), 'none', 'disguised spy ignored');
  assert.equal(canSee(g, T({ x: 30, z: 40, disguised: true }), w, { ignoreDisguise: true }), 'near', 'suspicious-act check');
  assert.equal(canSee(g, { x: 30, z: 40, isVisibleToEnemies: false, state: 'inVehicle', vehicle: { vehicleKind: 'emplacement' } }, w), 'near', 'manning a gun is seen');
  assert.equal(canSee(g, { x: 30, z: 40, kind: 'body', hiddenBody: true }, w), 'none', 'body under a barrel');
  assert.equal(targetClass({ kind: 'body', state: 'carried', alive: false, hp: 0 }), null);
  assert.equal(canSee(g, T({ x: 15, z: 40 }), w), 'none', 'behind');
});

test('§4.2 occlusion: B.HIGH blocks all, B.LOW hides low targets from ground viewers only, FENCE never', () => {
  const w = makeWorld({ enemies: [GUARD, { id: 'tower', soldierType: 'sentry', x: 20, z: 60, heading: 0, elevated: true, post: { heading: 0, sweep: 0 } }] });
  const [g, tw] = w.enemies;
  w.grid.fillRect(25, 39, 1, 2, 'block', B.LOW);
  assert.equal(canSee(g, T({ x: 30, z: 40 }), w), 'near', 'standing over sandbags');
  assert.equal(canSee(g, T({ x: 30, z: 40, isLow: true }), w), 'none', 'crawler behind sandbags');
  assert.equal(canSee(g, { x: 30, z: 40, kind: 'body' }, w), 'none', 'body behind sandbags');
  w.grid.fillRect(25, 59, 1, 2, 'block', B.LOW);
  assert.equal(canSee(tw, T({ x: 30, z: 60, isLow: true }), w), 'near', 'elevated viewer sees over low cover');
  w.grid.fillRect(27, 38, 1, 4, 'block', B.FENCE);
  assert.equal(canSee(g, T({ x: 35, z: 40 }), w), 'near', 'fence');
  w.grid.stampDynamic(40, 40, 3, 2, 0, B.HIGH);
  assert.equal(canSee(g, T({ x: 45, z: 40 }), w), 'none', 'vehicle occluder (OCLU)');
});

test('§4.2 roof rule: y ≥ 2.5 m hides from viewers > 2 m lower, and vice versa', () => {
  const w = makeWorld({ enemies: [GUARD] });
  const g = w.enemies[0];
  assert.equal(canSee(g, T({ x: 30, z: 40, y: 3 }), w), 'none');
  g.y = 3;
  assert.equal(canSee(g, T({ x: 30, z: 40, y: 3 }), w), 'near', 'same roof level');
  assert.equal(canSee(g, T({ x: 30, z: 40, y: 0 }), w), 'none', 'from the roof to the ground');
  g.y = 0;
  assert.equal(canSee(g, T({ x: 30, z: 40, y: 1.5 }), w), 'near', 'low platform');
});

test('§4.2 sweep: θ = A·sin(2π(t+φ)/P), phase seeded per enemy', () => {
  const w = makeWorld({ enemies: [{ id: 'a', soldierType: 'sentry', x: 10, z: 10 }, { id: 'b', soldierType: 'sentry', x: 30, z: 10 }] });
  const [a, b] = w.enemies;
  assert.notEqual(a.vision.phase, b.vision.phase);
  assert.ok(a.vision.phase >= 0 && a.vision.phase < 1);
  near(sweepOffset(a, 1.25 - a.vision.phase), (50 * Math.PI) / 180, 1e-9);
  assert.equal(a.sweepActive, true, 'posts sweep continuously');
});

test('§4.3 seen list: commandos first, capped at 16', () => {
  const w = makeWorld({ enemies: [GUARD] });
  for (let k = 0; k < 18; k++) addCommando(w, 'greenberet', 30 + (k % 6) * 2, 36 + Math.floor(k / 6) * 3);
  for (let k = 0; k < 3; k++) w.ai.extraBodies.push({ kind: 'body', x: 28, z: 40 + k });
  const r = perceive(w.enemies[0], w);
  assert.equal(r.commandos.length, 16);
  assert.equal(r.bodies.length, 0);
});

test('§3.4 spy: distraction freezes the guard facing him; a suspicious act in view unmasks him', () => {
  const w = makeWorld({ enemies: [GUARD, { id: 'h', soldierType: 'sentry', x: 40, z: 45, heading: Math.PI, post: { heading: Math.PI, sweep: 0 } }] });
  const [g, h] = w.enemies;
  const spy = addCommando(w, 'spy', 24, 40);
  spy.disguised = true;
  run(w, 1);
  assert.equal(g.brainState, 'IDLE', 'disguised spy ignored');
  assert.equal(g.brain.distractBy(spy), true);
  assert.equal(g.brainState, 'DISTRACTED');
  run(w, 0.5);
  near(g.heading, 0, 0.05, 'faces the spy (east of him)');
  const unmasked = [];
  w.events.on('enemy:unmasked-spy', (p) => unmasked.push(p));
  w.events.emit('ability:start', { unit: spy, id: 'knife', target: null });
  assert.ok(unmasked.length, 'unmasked');
  assert.equal(g.brainState, 'COMBAT');
});

test('§4.1 wounded soldier hunts the shooter; a comrade seeing him investigates at a run', () => {
  const w = makeWorld({ enemies: [GUARD, { id: 'w2', soldierType: 'soldier', x: 34, z: 42, heading: Math.PI }] });
  const [g, s] = w.enemies;
  const c = addCommando(w, 'sniper', 70, 70);
  c.hidden = true;
  s.takeDamage(80, c, 'shot');
  assert.equal(s.brainState, 'COMBAT');
  assert.ok(first(w, 'bark', (p) => p.line === 'ger_hurt'));
  run(w, 0.1);
  assert.equal(g.brainState, 'IDLE', 'a sentry holds its post…');
  assert.equal(g.alertLevel, 2, '…but turns to the shooter, COMBAT-ready');
  near(g.heading, Math.atan2(30, 50), 0.01);
  assert.equal(s.alive, true);
});

test('§4.3 wounded comrade seen: viewer runs (3.8) to the shooter at alertLevel 2; the comrade\'s own shots do not redirect it', () => {
  const w = makeWorld({ enemies: [
    { id: 'a', soldierType: 'soldier', x: 40, z: 40, heading: Math.PI, flags: { investigates: true }, post: { heading: Math.PI, sweep: 0 } },
    { id: 'b', soldierType: 'soldier', x: 30, z: 40, heading: 0, flags: { investigates: true }, post: { heading: 0, sweep: 0 } }] });
  const [A, B] = w.enemies;
  const c = addCommando(w, 'sniper', 40, 70);
  run(w, 0.2);
  const noises = [];
  w.events.on('noise', (n) => noises.push(n.level));
  A.takeDamage(80, c, 'shot');
  run(w, 0.1);
  assert.equal(B.brainState, 'INVESTIGATE');
  assert.equal(B.alertLevel, 2, 'alertLevel 2 from the start of the run');
  assert.equal(B.brain.goal.speed, 3.8);
  for (let i = 0; i < 90 && B.brainState === 'INVESTIGATE'; i++) {
    run(w, 1 / 60);
    assert.equal(B.alertLevel, 2);
    assert.equal(B.brain.goal.speed, 3.8, `still running at t=${w.time.toFixed(2)}`);
    near(B.brain.goal.z, 70, 1e-6, 'goal stays the shooter position');
  }
  assert.ok(noises.some((l) => l === 2), 'the comrade fired (level-2 noise) during the run');
});

test('§4.1 courier: sees a commando → ALARM_RUN along his exit route at 9 m/s → fires REXT', () => {
  const w = makeWorld({ enemies: [{ id: 'cour', soldierType: 'courier', x: 20, z: 40, heading: 0, vision: { sweep: 0 }, exitRoute: [[20, 50], [20, 70]] }] });
  const e = w.enemies[0];
  addCommando(w, 'greenberet', 30, 40);
  run(w, 0.1);
  assert.equal(e.brainState, 'ALARM_RUN');
  run(w, 5);
  assert.equal(w.alarm.zonesFired.at(-1)?.event, 'REXT');
});

test('§4.1 dog: follows its handler; sees a commando → barks and bites (25)', () => {
  const w = makeWorld({ enemies: [{ id: 'hd', soldierType: 'soldier', x: 20, z: 40, heading: Math.PI, route: { type: 'STOPPED', points: [{ x: 20, z: 40 }] } },
    { id: 'dog', soldierType: 'dog', x: 25, z: 45, heading: 0, handler: 'hd', vision: { sweep: 0 } }] });
  const dog = w.enemies[1];
  run(w, 4);
  assert.ok(Math.hypot(dog.x - 21.5, dog.z - 40) < 1.2, `heels (${dog.x.toFixed(1)}, ${dog.z.toFixed(1)})`);
  const c = addCommando(w, 'greenberet', 10, 40.5);
  dog.heading = Math.PI;
  run(w, 5);
  assert.ok(first(w, 'bark', (p) => p.line === 'dog_bark'), 'barks');
  assert.ok(c.hp < c.maxHp && (c.maxHp - c.hp) % 25 === 0 || c.hp < c.maxHp, `bitten (hp ${c.hp})`);
});
