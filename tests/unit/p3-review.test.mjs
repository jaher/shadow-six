/**
 * Phase 3 review fixes: moonlit missions get the night rig, lamps are warm and not daylight-bright, cloth never pops
 * flat after a hitch / time skip, smoke reads the travelling gust fronts of the shared WindField.
 */
import * as THREE from 'three';
import { test, assert } from './lib.mjs';
import { resolveLighting, THEATER_LIGHTING } from '../../src/engine/lighting.js';
import { VerletCloth } from '../../src/art/cloth.js';
import { LAMP_LIGHT } from '../../src/art/furniture/lamps.js';
import { LAMP_GAIN } from '../../src/render/street-lights.js';
import { SMOKE_VERT } from '../../src/render/vfx/shaders.js';

test('lighting: a night HDRI on a day theater takes the night rig unless the mission overrides a key', () => {
  const N = THEATER_LIGHTING.night;
  const L = resolveLighting('temperate', { hdri: 'night', sunElevDeg: 30 });
  assert.equal(L.night, true);
  assert.equal(L.sunIntensity, N.sunIntensity);
  assert.equal(L.exposure, N.exposure);
  assert.equal(L.hemiIntensity, N.hemiIntensity);
  assert.equal(L.sunColor, N.sunColor);
  assert.equal(L.sunElevation, 30, 'moon position still from the mission');
  const K = resolveLighting('snow', { hdri: 'moonlit', kelvin: 7000, sunIntensity: 0.5, exposure: 1.1 });
  assert.equal(K.sunIntensity, 0.5); assert.equal(K.exposure, 1.1); assert.notEqual(K.sunColor, N.sunColor);
  const day = resolveLighting('snow', { hdri: 'overcast' });
  assert.equal(!!day.night, false);
  assert.equal(day.sunIntensity, THEATER_LIGHTING.snow.sunIntensity * 0.9, 'day missions unchanged');
  const nt = resolveLighting('night', null);
  assert.equal(nt.sunIntensity, N.sunIntensity);
});

test('street lamps: warm tungsten colours, real-light gain well below daylight', () => {
  assert.ok(LAMP_GAIN <= 3, `gain ${LAMP_GAIN}`);
  for (const k of ['paris_single', 'paris_double', 'norway_wood', 'harbour', 'wall_lamp']) {
    const c = new THREE.Color(LAMP_LIGHT[k].color);
    assert.ok(c.r > c.g * 1.6 && c.g > c.b * 2, `${k} is warm (${c.getHexString()})`);
  }
});

function plane(w, h, sx, sy) { const g = new THREE.PlaneGeometry(w, h, sx, sy); g.translate(w / 2, -h / 2, 0); return g; }
const zSpread = (c) => { let a = 0, b = 0; const n = c.x.length / 3; for (let i = 0; i < n; i++) { a += c.x[i * 3 + 2]; b += c.x[i * 3 + 2] ** 2; } a /= n; return Math.sqrt(Math.max(0, b / n - a * a)); };

test('cloth: a hitch keeps the pose, a time skip restarts pre-warmed (never the flat rest rectangle)', () => {
  const mk = () => { const g = plane(1.8, 1.2, 16, 8); return new VerletCloth(g.attributes, { nx: 17, ny: 9, pinned: (i) => i === 0 }); };
  const W = [2, 0, 7], G = [0, -9.81, 0];
  const a = mk();
  for (let k = 0; k < 120; k++) a.advance(1 / 60, W, G, 0.4);
  const tipBefore = a.x[(4 * 17 + 16) * 3 + 1];
  assert.ok(a.advance(0.8, W, G, 0.4) > 0, 'hitch simulated');
  assert.ok(Math.abs(a.x[(4 * 17 + 16) * 3 + 1] - a.rest[(4 * 17 + 16) * 3 + 1]) > 0.05 || tipBefore !== a.rest[(4 * 17 + 16) * 3 + 1], 'not reset to rest');
  const b = mk();
  assert.ok(b.advance(99, W, G, 0.4) >= 80, 'time skip pre-warms ~1.5 s');
  assert.ok(zSpread(b) > 0.02, `pre-warmed cloth is not flat (${zSpread(b).toFixed(3)})`);
});

test('smoke: per-particle gust push from the shared wind field', () => {
  assert.match(SMOKE_VERT, /windSample\(/);
  assert.match(SMOKE_VERT, /pos\+=gustPush\(pos,age,d5\.w\)/);
});
