/** Renderer lighting + grade pure helpers (design-spec §2.4, realism-pipeline §1.1.5 / §3.4). */
import { test, assert, near } from './lib.mjs';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { THEATER_LIGHTING, HDRI, resolveLighting, resolveHdriId, kelvinToColor, analyzeHDR, autoEnvIntensity, SUN_AZIMUTH_NW } from '../../src/engine/lighting.js';
import { GRADES, gradeColor, bakeLUTData, gradeToCube } from '../../src/engine/grade.js';
import { MANIFEST } from '../../src/engine/manifest.js';
import { MISSIONS } from '../../src/missions/index.js';

const ROOT = new URL('../../', import.meta.url);

test('every theater lights from the NW (screen upper-left, shadows fall down-right)', () => {
  for (const [k, L] of Object.entries(THEATER_LIGHTING)) assert.equal(L.sunAzimuth, SUN_AZIMUTH_NW, k);
  assert.equal(SUN_AZIMUTH_NW, 315);
});

test('mission lighting keys map onto the renderer (M1: 15°, 6000 K, overcast → snow HDRI, fog 150, norway LUT)', () => {
  const L = resolveLighting('snow', { sunElevDeg: 15, sunAzimuthDeg: 315, kelvin: 6000, hdri: 'overcast', fog: 150, lut: 'norway' });
  assert.equal(L.sunElevation, 15);
  assert.equal(L.sunAzimuth, 315);
  assert.equal(L.hdriId, 'overcast_snow');
  assert.equal(L.hdriUrl, HDRI.overcast_snow.url);
  assert.equal(L.lut, 'norway');
  assert.equal(L.fog.far, 600);
  assert.ok(L.autoEnv);
  // null fields keep the theater default; false turns fog off
  const D = resolveLighting('desert', { fog: null, lut: null, hdri: null });
  assert.equal(D.hdriId, 'desert_noon');
  assert.equal(D.lut, 'desert');
  assert.deepEqual(D.fog, THEATER_LIGHTING.desert.fog);
  assert.equal(resolveLighting('temperate', { fog: false }).fog, null);
  assert.equal(resolveHdriId('overcast', 'temperate'), 'overcast_temperate');
  assert.equal(resolveHdriId('nope', 'snow'), null);
});

test('every mission lighting block resolves (hdri + lut known)', () => {
  for (const m of MISSIONS) {
    const L = resolveLighting(m.theater || 'temperate', m.lighting || null);
    assert.ok(Number.isFinite(L.sunElevation) && L.sunElevation > 0, `${m.id} elevation`);
    if (L.hdri) assert.ok(L.hdriId, `${m.id}: hdri "${L.hdri}" resolves`);
    assert.ok(GRADES[L.lut] || String(L.lut).endsWith('.cube'), `${m.id}: lut "${L.lut}" known`);
  }
});

test('kelvinToColor: 6500 K ≈ white, lower is warmer, higher is bluer', () => {
  const w = kelvinToColor(6500);
  assert.ok(w.r > 0.95 && w.g > 0.9 && w.b > 0.88, JSON.stringify(w));
  const warm = kelvinToColor(3500), cold = kelvinToColor(9000);
  assert.ok(warm.r / warm.b > 1.5);
  assert.ok(cold.b >= cold.r);
});

test('HDRIs: vendored 1k files exist, are in the manifest and credited', () => {
  const credits = readFileSync(new URL('CREDITS.md', ROOT), 'utf8');
  for (const [id, h] of Object.entries(HDRI)) {
    assert.ok(existsSync(new URL('assets/' + h.url, ROOT)), h.url);
    assert.equal(MANIFEST.hdr[id]?.url, h.url, `manifest hdr.${id}`);
    assert.ok(credits.includes(h.url.split('/').pop()), `CREDITS lists ${h.url}`);
  }
});

test('analyzeHDR clamps the sun (idempotent), auto fill gives a 4:1 sun:sky for skyFrac 0.2', () => {
  const w = 64, h = 32, data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 1; data[i * 4 + 3] = 1; }
  const sun = (8 * w + 16) * 4;
  data[sun] = data[sun + 1] = data[sun + 2] = 5000;
  data[4] = NaN;
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  const a = analyzeHDR(tex, 24);
  assert.equal(a.clamped, 1);
  near(data[sun], 24, 1e-3);
  assert.equal(data[4], 0, 'NaN texel zeroed');
  near(a.E1, Math.PI + 0.12, 0.05); // uniform radiance 1 → irradiance π, plus the clamped sun texel
  assert.equal(analyzeHDR(tex), a);
  const env = autoEnvIntensity({ sunIntensity: 3, sunElevation: 90, skyFrac: 0.2 }, a);
  near(env * a.E1, 0.75, 1e-6); // sky = 0.25 × sun
});

test('grades: neutral is identity, theater grades stay low-saturation and in range', () => {
  const o = gradeColor([0.3, 0.5, 0.7], GRADES.neutral);
  near(o[0], 0.3, 1e-9); near(o[2], 0.7, 1e-9);
  for (const [id, g] of Object.entries(GRADES)) {
    const red = gradeColor([0.8, 0.2, 0.2], g);
    const s = (Math.max(...red) - Math.min(...red)) / Math.max(...red);
    assert.ok(s <= 0.76, `${id}: tames saturated red (${s.toFixed(2)})`);
    const grey = gradeColor([0.46, 0.46, 0.46], g);
    for (const v of grey) assert.ok(v > 0.35 && v < 0.6, `${id}: mid grey stays mid (${grey})`);
  }
});

test('LUT lattice: N³ RGBA8, red fastest; .cube export matches the lattice', () => {
  const N = 8, d = bakeLUTData(GRADES.neutral, N);
  assert.equal(d.length, N * N * N * 4);
  assert.equal(d[4], Math.round(255 / 7)); // (r=1,g=0,b=0)
  assert.equal(d[(N * N) * 4 + 2], Math.round(255 / 7)); // (0,0,1)
  const cube = gradeToCube(GRADES.norway, 5).trim().split('\n');
  assert.ok(cube.includes('LUT_3D_SIZE 5'));
  assert.equal(cube.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l)).length, 125);
});

test('baked .cube files in assets/luts match engine/grade.js (re-run tools/render/bake-luts.mjs)', () => {
  for (const id of Object.keys(GRADES)) {
    const u = new URL(`assets/luts/${id}.cube`, ROOT);
    assert.ok(existsSync(u), `assets/luts/${id}.cube`);
    assert.equal(readFileSync(u, 'utf8'), gradeToCube(GRADES[id], 17, `SHADOW SIX ${id}`), `${id}.cube is stale`);
  }
});
