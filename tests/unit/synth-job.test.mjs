/**
 * synth.js synthJob: the sliced render of a placeholder (audio/engine.js warmSynth renders the mission's synth-only
 * sounds ahead of their first play in ~1 ms slices) gives exactly synth()'s buffer, sample for sample, for every recipe
 * and mood; and it hands control back between slices.
 */
import { test, assert } from './lib.mjs';
import { synth, synthJob, RECIPE_NAMES } from '../../src/audio/synth.js';

const run = (g) => { let r, n = 0; while (!(r = g.next()).done) n++; return { v: r.value, yields: n }; };

test('synthJob: every recipe and mood renders the identical buffer to synth(), in slices', () => {
  let sliced = 0;
  for (const name of RECIPE_NAMES) {
    for (const [sr, seed] of [[22050, 1], [8000, 977]]) {
      const a = synth(name, sr, seed), { v: b, yields } = run(synthJob(name, sr, seed, 512));
      assert.ok(a && b, name);
      assert.equal(b.length, a.length, `${name} length`);
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${name} @${sr}: sample ${i} ${b[i]} ≠ ${a[i]}`);
      assert.equal(yields, Math.floor(a.length / 512), `${name}: one yield per 512 samples`);
      if (yields) sliced++;
    }
  }
  assert.ok(sliced > RECIPE_NAMES.length, 'renders were sliced');
  assert.equal(run(synthJob('no_such_recipe')).v, null);
});

test('synthJob leaves synth() eager: a render after a job (and during one) is a buffer, not a deferred job', () => {
  const g = synthJob('wing_flurry', 22050, 3, 1024);
  g.next();
  const mid = synth('quack', 22050, 2);
  assert.ok(mid instanceof Float32Array, 'synth() mid-job renders at once');
  run(g);
  assert.ok(synth('wing_flurry', 22050, 3) instanceof Float32Array);
});
