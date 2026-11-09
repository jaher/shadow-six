/**
 * art/unit-model.js warms the Germans' ground curves on still screens (load: WARM_CLIPS; idle-warm: ALARM_CLIPS, also
 * for the barracks bodies built ahead): every clip a German's walk or run switches to by its speed (enemy_runtime GAIT)
 * and a blast's hit are among them — a clip left out is grounded the first time a guard plays it, mid-play: M6's blast
 * grounded ~30 run_slow / walk_fast / hit curves (0.5-3.5 ms each) in the frames that drew it.
 */
import { test, assert } from './lib.mjs';
import { GAIT } from '../../src/art/characters/enemies/enemy_runtime.js';
import { WARM_CLIPS, ALARM_CLIPS } from '../../src/art/unit-model.js';

test('alarm clips warm: every gait variant of a German walk / run is warmed', () => {
  const warmed = new Set([...WARM_CLIPS, ...ALARM_CLIPS]);
  const variants = Object.values(GAIT).flatMap((list) => list.map(([name]) => name));
  assert.ok(variants.length >= 5, `GAIT lists its variants (${variants.join(' ')})`);
  for (const n of variants) assert.ok(warmed.has(n), `gait variant '${n}' is warmed (WARM_CLIPS or ALARM_CLIPS)`);
  // (negative control: without ALARM_CLIPS the load list alone leaves the alarm's gaits to first use)
  const loadOnly = new Set(WARM_CLIPS);
  assert.ok(variants.some((n) => !loadOnly.has(n)), 'the load list alone misses some gait variants');
});

test('alarm clips warm: a blast\'s hit reaction is warmed, and nothing is listed twice', () => {
  assert.ok(ALARM_CLIPS.includes('hit'), 'hit');
  assert.equal(new Set(ALARM_CLIPS).size, ALARM_CLIPS.length, 'no duplicates');
  for (const n of ALARM_CLIPS) assert.ok(!WARM_CLIPS.includes(n), `${n} not already warmed at load`);
});
