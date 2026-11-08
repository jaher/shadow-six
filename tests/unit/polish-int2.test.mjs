/** Art integration 2 step 5 (polish): fire ramp, bounded wide-gamut sanitize, the front end's still scenes, briefing photo sets. */
import { existsSync, readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { BLACKBODY } from '../../src/render/vfx/glsl.js';
import { SanitizeShader } from '../../src/engine/post-passes.js';
import { STILL_SCENES, STILL_THEATERS } from '../../src/ui/menu-model.js';
import { briefingPhotos } from '../../src/ui/briefing.js';
import { MISSIONS } from '../../src/missions/index.js';

const ROOT = new URL('../../', import.meta.url);

test('polish: fire puffs and flame tongues use the display-fitted fire ramp', () => {
  assert.match(BLACKBODY, /vec3 fireEmit\(float T\)/);
  assert.match(BLACKBODY, /vec3\(1\.0, a, -0\.14\)/, 'negative blue cancels the AgX inset leak');
  const sh = readFileSync(new URL('src/render/vfx/shaders.js', ROOT), 'utf8');
  assert.equal((sh.match(/fireEmit\(Tl\)/g) || []).length, 3, 'puffs + flame tongues + sustained-fire volumes (art/realistic-flames)');
});

test('polish: sanitize keeps bounded negatives (wide-gamut fire) but still kills NaN/Inf', () => {
  const f = SanitizeShader.fragmentShader;
  assert.match(f, /isnan/);
  assert.match(f, /clamp\(c\.rgb, -0\.3 \* max\(hi, 0\.0\), uMax\)/);
});

test('front end: every theatre still has a sky band for the flyover above far-ground patches for its bombs', () => {
  for (const th of STILL_THEATERS) {
    const S = STILL_SCENES[th];
    assert.ok(S && S.zones.length, `${th}: scene`);
    const [f0, f1] = S.fly;
    assert.ok(f0 >= 0.03 && f0 < f1 && f1 <= 0.15, `${th}: the flight band sits in the still's sky (${S.fly})`);
    for (const z of S.zones) {
      assert.ok(z.x[0] >= 0 && z.x[0] < z.x[1] && z.x[1] <= 1, `${th}: zone x ${z.x}`);
      assert.ok(z.y > f1 + 0.08 && z.y < 0.4, `${th}: the ground line (${z.y}) is well below the planes and in the far ground`);
      assert.ok(z.pxm >= 3 && z.pxm <= 10, `${th}: a believable scale (${z.pxm} px/m: a Spitfire ${(9.47 * z.pxm).toFixed(0)} px at 1920)`);
      // the bursts keep clear of the centred menu column
      assert.ok(z.x[1] <= 0.44 || z.x[0] >= 0.55, `${th}: zone ${z.x} clear of the menu column`);
      for (const [x, y] of z.clip || []) assert.ok(x >= 0 && x <= 1 && y < z.y + 0.02 && y > f1, `${th}: clip point ${x},${y}`);
    }
  }
});

test('polish: M1-M3 briefings show Norway photos only, every file exists', () => {
  const africa = ['stuka', 'desert'];
  const seen = new Set();
  for (const id of ['m01', 'm02', 'm03']) {
    const def = MISSIONS.find((m) => m.id === id);
    const set = briefingPhotos(def, 1);
    assert.equal(set.length, 3);
    for (const f of set) {
      assert.ok(!africa.includes(f), `${id} uses ${f}`);
      assert.ok(existsSync(new URL(`assets/ui/briefing/${f}.webp`, ROOT)), `${f}.webp`);
    }
    seen.add(set.join());
  }
  assert.equal(seen.size, 3, 'each mission has its own set');
  // other theatres keep working (missions 4-20 on feat/missions)
  for (const th of ['snow', 'desert', 'temperate', 'urban']) {
    for (const f of briefingPhotos({ id: 'm99', theater: th }, 4)) assert.ok(existsSync(new URL(`assets/ui/briefing/${f}.webp`, ROOT)), `${th}: ${f}`);
  }
  assert.ok(!briefingPhotos({ id: 'm99', theater: 'snow' }).some((f) => africa.includes(f)), 'snow fallback is Norway');
  const credits = readFileSync(new URL('CREDITS.md', ROOT), 'utf8');
  for (const f of ['norway-airfield', 'norway-commandos', 'norway-prisoners', 'lofoten-craft', 'norway-snow']) assert.ok(credits.includes(f), `CREDITS lists ${f}`);
});
