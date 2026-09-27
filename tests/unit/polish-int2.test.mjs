/** Art integration 2 step 5 (polish): fire ramp, bounded wide-gamut sanitize, diorama path, briefing photo sets. */
import { existsSync, readFileSync } from 'node:fs';
import { test, assert } from './lib.mjs';
import { BLACKBODY } from '../../src/render/vfx/glsl.js';
import { SanitizeShader } from '../../src/engine/post-passes.js';
import { dioramaPath, samplePath } from '../../src/ui/menu-model.js';
import { briefingPhotos } from '../../src/ui/briefing.js';
import { MISSIONS } from '../../src/missions/index.js';

const ROOT = new URL('../../', import.meta.url);

test('polish: fire puffs and flame tongues use the display-fitted fire ramp', () => {
  assert.match(BLACKBODY, /vec3 fireEmit\(float T\)/);
  assert.match(BLACKBODY, /vec3\(1\.0, a, -0\.14\)/, 'negative blue cancels the AgX inset leak');
  const sh = readFileSync(new URL('src/render/vfx/shaders.js', ROOT), 'utf8');
  assert.equal((sh.match(/fireEmit\(Tl\)/g) || []).length, 2, 'puffs + flame tongues');
});

test('polish: sanitize keeps bounded negatives (wide-gamut fire) but still kills NaN/Inf', () => {
  const f = SanitizeShader.fragmentShader;
  assert.match(f, /isnan/);
  assert.match(f, /clamp\(c\.rgb, -0\.3 \* max\(hi, 0\.0\), uMax\)/);
});

test('polish: diorama path flies between buildings and stays off the map edge', () => {
  for (const def of MISSIONS) {
    const p = dioramaPath(def);
    const [w, d] = def.size;
    assert.ok(p.keys.length >= 3, `${def.id} keys`);
    for (const k of p.keys) {
      assert.ok(k.x >= Math.min(w * 0.2, w / 2) - 1e-9 && k.x <= w - Math.min(w * 0.2, w / 2) + 1e-9, `${def.id} x ${k.x}`);
      assert.ok(k.z >= Math.min(d * 0.2, d / 2) - 1e-9 && k.z <= d - Math.min(d * 0.2, d / 2) + 1e-9, `${def.id} z ${k.z}`);
    }
    const s = samplePath(p, 12.3);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z));
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
