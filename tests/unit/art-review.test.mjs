/** Art-integration review fixes (terrain snow drifts / prints, x-ray rim silhouette, grenade in snow). Headless. */
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { undulation } from '../../src/art/terrain/terrain-layers.js';
import { TrailSystem } from '../../src/art/terrain/trails.js';
import { XRayPass, xrayMatcap } from '../../src/engine/post-passes.js';
import { RECIPES } from '../../src/render/vfx/effects.js';

test('snow drifts: shallow and warped, so the low Norwegian sun does not paint map-wide light/dark stripes', () => {
  // Lambert term under M1's 15° NW sun over a 120 × 160 m field; the straight T-A ridges gave cv 0.155, max 0.59 m
  const sun = [-0.683, 0.259, -0.683];
  const lit = [];
  let max = 0;
  for (let z = 0; z < 160; z += 1) {
    for (let x = 0; x < 120; x += 1) {
      const h = undulation('snow', x, z);
      const gx = (undulation('snow', x + 0.5, z) - h) / 0.5, gz = (undulation('snow', x, z + 0.5) - h) / 0.5;
      max = Math.max(max, Math.abs(h));
      lit.push((-sun[0] * -gx + sun[1] + -sun[2] * -gz) / Math.hypot(gx, 1, gz));
    }
  }
  const m = lit.reduce((a, b) => a + b, 0) / lit.length;
  const cv = Math.sqrt(lit.reduce((a, b) => a + (b - m) ** 2, 0) / lit.length) / m;
  assert.ok(max < 0.45, `drift height ${max.toFixed(3)} m`);
  assert.ok(cv < 0.1, `sun-lit variation cv ${cv.toFixed(3)}`);
  // desert dunes keep their full ripple amplitude (only the snow branch changed)
  let dmax = 0;
  for (let x = 0; x < 200; x += 2) dmax = Math.max(dmax, Math.abs(undulation('desert', x, 37)));
  assert.ok(dmax > 0.05, `desert ripples ${dmax}`);
});

/** Run TrailSystem._steps on a stub (no GL) and return the pushed boot-print quads. */
function prints(mat, n = 12) {
  const pushed = [];
  const stub = { sources: new Map(), stats: { stamps: 0 }, _record() {}, _push(kind, x, z, c, s, len, qw, fw) { pushed.push({ kind, len, qw, fw }); } };
  for (let i = 0; i < n; i++) TrailSystem.prototype._steps.call(stub, 'walk', i * 0.25, 0, 0, { id: 'u1' }, mat);
  return pushed;
}

test('boot prints: widened in deep soft snow (resolvable on the trail RT), unchanged on firm ground', () => {
  const snow = prints({ snow: 0.97, soft: 0.157, coh: 0.88 });
  const firm = prints({ snow: 0, soft: 0.02, coh: 0.7 });
  assert.ok(snow.length >= 3 && firm.length >= 3);
  for (const p of firm) { assert.equal(p.kind, 2); assert.equal(p.fw, 0.2); assert.equal(p.len, 0.34); }
  for (const p of snow) { assert.ok(p.fw > 0.28 && p.fw <= 0.3 + 1e-9, `snow print width ${p.fw}`); assert.ok(Math.abs(p.len / p.fw - 1.7) < 1e-9); }
  // shallow snow (soft 0.06) scales proportionally
  const pack = prints({ snow: 0.75, soft: 0.06, coh: 0.9 });
  assert.ok(pack[0].fw > 0.2 && pack[0].fw < snow[0].fw);
});

test('x-ray silhouette: dark team-green fill with a bright, opaque rim; depth-tested behind geometry only', () => {
  const tex = xrayMatcap(0x1d3d12, 0xc8ff90, { size: 32 });
  const d = tex.image.data, at = (i, j) => { const o = (j * 32 + i) * 4; return [d[o], d[o + 1], d[o + 2], d[o + 3]]; };
  const c = at(16, 16), e = at(31, 16);
  assert.ok(c[1] > c[0] && c[1] > c[2], `fill is green ${c}`);
  assert.ok(e[0] + e[1] + e[2] > 2 * (c[0] + c[1] + c[2]), `rim brighter than fill ${e} vs ${c}`);
  assert.ok(e[3] > c[3] && e[3] >= 240, `rim opaque ${e[3]} > ${c[3]}`);
  const p = new XRayPass(new THREE.Scene(), new THREE.OrthographicCamera(), () => []);
  assert.ok(p.material.isMeshMatcapMaterial);
  assert.equal(p.material.depthFunc, THREE.GreaterDepth);
  assert.equal(p.material.depthWrite, false);
  p.dispose();
});

/** Minimal effect-library host: records particles and decals; every other call is a no-op. */
function mockVfx() {
  const rec = { parts: [], decals: [] };
  const base = {
    time: 0, quality: { density: 1, smokeCap: 1e9, hotCap: 1e9 }, pressure: 1,
    n: (k) => k, at: (_d, fn) => fn(), emit: (p) => { rec.parts.push(p); return p; }, decal: (pos, r, kind, o) => rec.decals.push({ kind, r, o }),
    rand: () => Math.random,
  };
  const noop = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop });
  const vfx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
  return { vfx, rec };
}

test('grenade in snow: a white snow-powder column with a little frozen soil, a dirty-snow bowl (no black scorch)', () => {
  // bodies review 2026-09-27 supersedes the earlier "dark soil + black smoke + scorch" art note: on snow the column
  // is mostly white powder, some grey-brown soil keeps it readable, and the crater is not an ink blot
  let s = 7;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const dark = (p) => p.r !== undefined && p.r + p.g + p.b < 0.9 && !p.temp;
  const light = (p) => p.r !== undefined && p.r + p.g + p.b > 1.8 && !p.temp;
  const run = (surface) => { const { vfx, rec } = mockVfx(); RECIPES.grenade(vfx, new THREE.Vector3(10, 0, 10), { surface }, rng); return rec; };
  const snow = run('snow'), dirt = run('dirt');
  const nd = snow.parts.filter(dark).length, nl = snow.parts.filter(light).length;
  assert.ok(nl > 3 * nd, `mostly white powder in snow (${nl} light vs ${nd} dark)`);
  assert.ok(nd > 0, 'a little frozen soil');
  assert.ok(!snow.decals.some((d) => d.kind === 'scorch'), 'no black scorch decal on snow');
  assert.ok(snow.decals.some((d) => d.kind === 'crater' && (d.o?.opacity ?? 1) < 0.5), 'only a faint powder burn');
  assert.ok(!dirt.decals.some((d) => d.kind === 'scorch'), 'dirt keeps the crater decal only');
});
