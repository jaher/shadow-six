/**
 * A climber who stops halfway over a wall (right-click: he hangs on it) and is then ordered on finishes the climb from
 * where he hangs (Unit._planFromClimb, as halfway up a ladder). Before: the new path started on the ground at the
 * link's foot, so he dropped back to it and climbed again from the bottom. M20's dossier: "The GB can stop mid-climb
 * ... and wait for e1" [P "click below and then above you"] (sol/m20).
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { getMission } from '../../src/missions/index.js';

test('climb: hanging halfway up the wall, a new move order finishes the climb from his height (no drop to the foot)', () => {
  const s = makeSim(getMission('m20'), { brains: false });
  const gb = s.cmd('greenberet');
  gb.issue({ type: 'move', x: 15, z: 75.9 });
  s.run(40, () => (gb.y || 0) > 6);
  assert.ok((gb.y || 0) > 6 && gb._climb, 'on the W wall, 6 m up');
  assert.ok(gb.issue({ type: 'cancel' }), 'right-click: he hangs on');
  const y0 = gb.y;
  s.run(3);
  assert.ok(gb.hanging && Math.abs(gb.y - y0) < 1e-6, 'he stays where he hangs');
  assert.ok(gb.issue({ type: 'move', x: 16, z: 74 }), 'ordered on');
  let low = gb.y;
  s.run(20, () => { low = Math.min(low, gb.y); return !gb.path; });
  assert.ok(low > y0 - 0.2, `never back down to the foot (lowest ${low.toFixed(2)} from ${y0.toFixed(2)})`);
  assert.ok(Math.abs(gb.y - 13) < 0.1 && Math.hypot(gb.x - 16, gb.z - 74) < 0.6, 'over the top and on to the click');
});
