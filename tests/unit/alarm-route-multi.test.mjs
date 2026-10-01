/**
 * alarmRoutePlan: `alarmRoute.run` may be a list of points (a multi-leg alarm run, M9 pt_nw / pt_se); the loop is joined
 * where the LAST run point ends. A single `run` point behaves as before.
 */
import { test, assert } from './lib.mjs';
import { alarmRoutePlan } from '../../src/ai/alarm.js';

const LOOP = { type: 'LOOP', vel: 1.8, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }] };

test('alarmRoutePlan: single run point unchanged (speed from vel, loop joined at the run point)', () => {
  const p = alarmRoutePlan({ run: { x: 9, z: 1, vel: 2.7 }, loop: LOOP });
  assert.deepEqual(p.exit, [{ x: 9, z: 1, speed: 2.7 }]);
  assert.deepEqual([p.loop[0].x, p.loop[0].z], [10, 0]);
  assert.equal(p.loopVel, 1.8);
});

test('alarmRoutePlan: a list of run points is the whole exit leg; the loop joins at the last one', () => {
  const p = alarmRoutePlan({ run: [{ x: -5, z: 20, vel: 2.7 }, [1, 12], { x: 1, z: 11, vel: 3 }], loop: LOOP });
  assert.equal(p.exit.length, 3);
  assert.deepEqual(p.exit.map((q) => [q.x, q.z]), [[-5, 20], [1, 12], [1, 11]]);
  assert.equal(p.exit[0].speed, 2.7);
  assert.equal(p.exit[2].speed, 3);
  assert.deepEqual([p.loop[0].x, p.loop[0].z], [0, 10]);
});
