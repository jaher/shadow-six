/**
 * The solution planner's opt-ins added for LIGHTS OUT e02 (tools/solutions/sneak.mjs), each off unless a solution sets
 * it: `w.sneakHeld` (a post the Spy is talking to faces him: postHeadings), `w.sneakRunAxis` (a crawler keeps to a
 * stair run's axis, as pathfinding alignRuns makes him: planSneak) and `o.disguise` (a Spy in a tunic is a man only to
 * those who see through it — BCD ranks: planSneak's dummies).
 * Run with the unit suite: node tests/unit/run.mjs sneak-optins
 */
import { test, assert } from './lib.mjs';
import { postHeadings, planSneak } from '../../tools/solutions/sneak.mjs';
import { headlessDriver } from '../../tools/solutions/headless.mjs';
import '../../src/abilities/index.js';

/** The e02 quarter with only the guards named left in it (the planner is under test, not the garrison). */
async function quarter(keep = []) {
  const D = await headlessDriver('e02', { quiet: true, difficulty: 'hard' }), w = D.world;
  for (const e of [...w.enemies]) if (!keep.includes(e.tag)) w.remove(e);
  for (const v of [...(w.vehicles || [])]) if (v.crew?.length) v.crew.length = 0;
  return D;
}
const put = (D, role, x, z) => { const c = D.c(role), g = D.world.grid; c.x = x; c.z = z; c.y = g.elevAt(x, z); c.path = null; return c; };

test('sneakHeld: a post held by the Spy\'s talk (DISTRACTED) is planned facing him, else as his post turns', () => {
  const world = {};
  const e = { world, heading: 2.0, post: { heading: 0 }, brain: { state: 'DISTRACTED' } };
  const off = postHeadings(e);
  assert.ok(Array.isArray(off) && off.length > 1 && off.includes(0), `off: his heading now and his post's (${off})`);
  world.sneakHeld = true;
  assert.deepEqual(postHeadings(e), [2.0], 'on: only his heading now (he faces the Spy until the talk ends)');
  e.brain.state = 'IDLE';
  assert.deepEqual(postHeadings(e), off, 'not held: as before');
});

test('sneakRunAxis: a crawler\'s plan over the Scalinata keeps to its axis (off, it cuts across the steps)', async () => {
  const D = await quarter(), w = D.world, g = w.grid;
  const run = g.runs.find((R) => R.id === 'scalinata:scal');
  assert.ok(run?.align, 'the Scalinata is an aligned run');
  put(D, 'greenberet', 50, 98.5);
  const opt = { mode: 'crawl', role: 'greenberet', horizon: 60 };
  /** The farthest any point of a plan lies off the steps' axis while on them. */
  const worst = (path) => Math.max(0, ...path.map(([x, z]) => {
    const q = g.runLocal(run, x, z);
    return q.s < 0 || q.s > run.L || Math.abs(q.v) > run.w / 2 ? 0 : Math.abs(q.v);
  }));
  // (from the alley below to the square above, 2.8 m west of the stair's axis)
  const off = planSneak(D, 47.2, 86.6, opt);
  assert.ok(off && worst(off) > 1, `off: a plan, across the steps (${off && worst(off).toFixed(2)} m off the axis at most)`);
  w.sneakRunAxis = true;
  const on = planSneak(D, 47.2, 86.6, opt);
  assert.ok(on, 'on: a plan');
  assert.ok(worst(on) <= 0.6 + g.cell / 2, `on: up the steps' middle (${worst(on).toFixed(2)} m off the axis at most)`);
});

test('disguise: a Spy in a private\'s tunic is planned past a private, not past a sergeant; in a sergeant\'s past both', async () => {
  // (p2, a private, and p1, a sergeant, stand at the palazzo gate looking east over the square: the goal 8 m in front)
  const private_ = await quarter(['p2']);
  put(private_, 'spy', 48.2, 60.6);
  const o = { mode: 'walk', role: 'spy', horizon: 30, hold: 2 };
  assert.equal(planSneak(private_, 46.2, 60.6, o), null, 'no tunic: p2 sees him');
  assert.ok(planSneak(private_, 46.2, 60.6, { ...o, disguise: 'soldier' }), 'a private\'s tunic: p2 takes him for one of his own');
  const sergeant = await quarter(['p1']);
  put(sergeant, 'spy', 48.2, 55.6);
  assert.equal(planSneak(sergeant, 46.2, 55.6, { ...o, disguise: 'soldier' }), null, 'a private\'s tunic: the sergeant p1 sees through it');
  assert.ok(planSneak(sergeant, 46.2, 55.6, { ...o, disguise: 'sergeant' }), 'a sergeant\'s: p1 passes him');
});
