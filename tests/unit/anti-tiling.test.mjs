/** Anti-tiling (feat/anti-tiling): material classes, paving shuffle data, stone-ID maps, the material patch. */
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { test, assert } from './lib.mjs';
import * as THREE from 'three';
import { antiTilingClass, antiTile, setAntiTilingQuality, AT_UNIFORMS } from '../../src/art/anti-tiling.js';
import { SLAB_SRC, COURSES, STONES, HEX_MODE } from '../../src/art/pavement/pavement-material.js';
import { SURFACES } from '../../src/world/roads.js';

const P = (f) => new URL(`../../${f}`, import.meta.url);
const LIB = JSON.parse(readFileSync(P('assets/textures/lib/materials.json'))).materials;

/** Minimal PNG reader (8-bit RGB, no interlace): {w, h, px(x, y) → [r, g, b]}. */
function readPng(file) {
  const b = readFileSync(file);
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; assert.equal(d[8], 8); }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 2 ? 3 : ct === 6 ? 4 : assert.fail(`colour type ${ct}`), raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, up = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, bpp, px: (x, y) => [...out.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}

test('anti-tiling: every library finish has a class; atlases / glass / decals are never touched, plaster / sand hex-tile', () => {
  const kinds = { iso: 0, shift: 0, none: 0 };
  for (const n of Object.keys(LIB)) kinds[antiTilingClass(n).kind]++;
  assert.ok(kinds.iso >= 20 && kinds.shift >= 30 && kinds.none >= 10, JSON.stringify(kinds));
  for (const n of ['decals', 'signs', 'glass_dirty', 'interior_dark', 'foliage_atlas', 'fuel_grating']) assert.equal(antiTilingClass(n).kind, 'none', n);
  for (const n of ['brick_red', 'roof_slate', 'ashlar_limestone', 'corrugated_galv', 'boards_weathered']) assert.equal(antiTilingClass(n).kind, 'shift', n);
  assert.deepEqual(antiTilingClass('plaster_limewash_diff'), { kind: 'iso', rot: 1 });   // GLTF texture names
  assert.ok(antiTilingClass('sand').rot < 0.3, 'wind ripples keep their direction');
});

test('anti-tiling: the material patch chains, survives clone(), follows the preset through one shared uniform', () => {
  const m = new THREE.MeshStandardMaterial();
  let prevRan = 0;
  m.onBeforeCompile = () => { prevRan++; };
  const keyBefore = m.customProgramCacheKey();
  antiTile(m, { lib: 'plaster_white' });
  assert.equal(m.userData.antiTiling.kind, 'iso');
  assert.ok(m.customProgramCacheKey().startsWith(keyBefore) && /\|at:iso/.test(m.customProgramCacheKey()));
  const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  m.onBeforeCompile(sh, null);
  assert.equal(prevRan, 1, 'the previous hook still runs');
  assert.ok(sh.uniforms.uAtMode === AT_UNIFORMS.uAtMode && sh.uniforms.tAtNoise === AT_UNIFORMS.tAtNoise);
  assert.ok(/atSampleN/.test(sh.fragmentShader) && /vAtW/.test(sh.vertexShader));
  for (const inc of ['map_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_maps', 'aomap_fragment']) {
    assert.ok(sh.fragmentShader.includes(`// #include <${inc}>`), `${inc} anchor kept for later patches`);
  }
  assert.ok(/texture2D\( aoMap, vAoMapUv \)/.test(sh.fragmentShader), 'a baked AO map is sampled as authored');
  const c = m.clone();
  assert.equal(c.userData.antiTiling.kind, 'iso');
  assert.notEqual(c.onBeforeCompile, THREE.Material.prototype.onBeforeCompile, 'clones are patched too');
  assert.equal(antiTile(m), m, 'idempotent');
  setAntiTilingQuality('low'); assert.equal(AT_UNIFORMS.uAtMode.value, 0);
  setAntiTilingQuality('high'); assert.equal(AT_UNIFORMS.uAtMode.value, 1);
});

test('anti-tiling paving data: slab sources inside the repeat, courses ascending, stone sets ship their ID maps', () => {
  for (const [set, s] of Object.entries(SLAB_SRC)) {
    for (const a of [s.u, s.v]) {
      assert.equal(a.length, s.n);
      a.forEach((x, i) => { assert.ok(x >= 0 && x < 1, `${set} ${x}`); if (i) assert.ok(x - a[i - 1] > 2 * s.margin + 0.1, `${set} slab wide enough`); });
    }
  }
  for (const [set, b] of Object.entries(COURSES)) {
    assert.ok(b.length >= 6 && b.length <= 11, set);
    b.forEach((x, i) => { assert.ok(x >= 0 && x < 1); if (i) assert.ok(x > b[i - 1], `${set} ascending`); });
    assert.ok(STONES[set], `${set} has stone IDs`);
  }
  for (const set of Object.keys(STONES)) assert.ok(existsSync(P(`assets/textures/pavement/512/${set}_sid.png`)), set);
  assert.equal(HEX_MODE.low, 1); assert.equal(HEX_MODE.high, 2);
  assert.equal(SURFACES.quay.tex, 'flags', 'the quay shuffles the flag scan');
});

test('anti-tiling stone IDs: a stone that crosses the tile border keeps one key (wrap offsets agree)', () => {
  for (const set of Object.keys(STONES)) {
    const im = readPng(P(`assets/textures/pavement/512/${set}_sid.png`));
    assert.equal(im.bpp, 3, 'RGB: no alpha to premultiply');
    const dec = (x, y) => { const [r, g, b] = im.px(x, y), code = Math.floor(b / 25); return { id: r * 256 + g, du: Math.floor(code / 3) - 1, dv: (code % 3) - 1, lvl: b % 25 }; };
    let same = 0, ok = 0;
    for (let y = 0; y < im.h; y += 3) {             // across the u border: texel (w-1) in repeat i, texel 0 in repeat i+1
      const a = dec(im.w - 1, y), b = dec(0, y);
      if (a.id === b.id) { same++; if (a.du - b.du === 1) ok++; }
    }
    for (let x = 0; x < im.w; x += 3) {             // across the v border (image row 0 = top of the repeat)
      const a = dec(x, 0), b = dec(x, im.h - 1);
      if (a.id === b.id) { same++; if (a.dv - b.dv === 1) ok++; }
    }
    assert.ok(same > 50 && ok === same, `${set}: ${ok}/${same}`);
  }
});
