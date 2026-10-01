/** Art integration 2 step 4: real load progress, the load budget, the recompressed assets and GitHub Pages limits. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, assert } from './lib.mjs';
import { createLoadProgress, expectedBytes, LOAD_STAGES } from '../../src/engine/load-progress.js';

const ROOT = new URL('../../', import.meta.url);
const P = (p) => new URL(p, ROOT);

test('loading: stage weights sum to 1 and progress is monotonic, ending at 1', () => {
  const sum = LOAD_STAGES.reduce((a, [, w]) => a + w, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum ${sum}`);
  const seen = [];
  const events = { emit: (t, e) => { if (t === 'mission:progress') seen.push(e.p); } };
  const prog = createLoadProgress({ events, id: 'mX', preset: 'high', budget: null });
  for (const [n] of LOAD_STAGES) { prog.stage(n); prog.stage(n, 0.5); }
  prog.stage('lighting'); // going back never lowers the bar
  const r = prog.done();
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `p ${seen[i]} after ${seen[i - 1]}`);
  assert.equal(seen[seen.length - 1], 1);
  assert.equal(prog.p, 1);
  assert.ok(r.ms >= 0 && r.bytes === 0 && r.expected === 90e6);
});

test('loading: expected bytes per mission and preset, with fallbacks', () => {
  const b = { default: 50e6, missions: { m01: { high: 80e6, low: 60e6 } } };
  assert.equal(expectedBytes(b, 'm01', 'low'), 60e6);
  assert.equal(expectedBytes(b, 'm01', 'ultra'), 80e6); // ultra/medium → high entry when missing
  assert.equal(expectedBytes(b, 'm01', 'medium'), 80e6);
  assert.equal(expectedBytes(b, 'm09', 'high'), 50e6); // missions 4-20 not measured yet → default
  assert.equal(expectedBytes(null, 'm01', 'high'), 90e6);
});

test('loading: the checked-in budget covers the built missions and meets the size targets', () => {
  const b = JSON.parse(readFileSync(P('assets/load-budget.json'), 'utf8'));
  for (const id of ['m01', 'm02', 'm03']) {
    const m = b.missions[id];
    assert.ok(m?.high && m?.low, `${id} measured`);
    assert.ok(m.high <= 115e6, `${id} high ${(m.high / 1e6).toFixed(1)} MB ≤ 120 MB with boot`);
    assert.ok(m.low < m.high, `${id} low ${(m.low / 1e6).toFixed(1)} < high ${(m.high / 1e6).toFixed(1)} MB`);
  }
});

test('loading: terrain strips are WebP (1K, 2K grid, 512 for low); no JPEG/PNG strips left', () => {
  for (const th of ['temperate', 'desert', 'snow']) {
    for (const k of ['albedo', 'normal']) for (const s of ['', '_2k', '_512']) assert.ok(existsSync(P(`assets/terrain/${th}_${k}${s}.webp`)), `${th}_${k}${s}`);
    assert.ok(existsSync(P(`assets/terrain/${th}_data.webp`)));
  }
  const left = readdirSync(P('assets/terrain')).filter((f) => /\.(jpg|png)$/.test(f));
  assert.deepEqual(left, []);
  const src = readFileSync(P('src/art/terrain/terrain.js'), 'utf8') + readFileSync(P('src/art/terrain/vegetation.js'), 'utf8');
  assert.ok(!/\.jpg'|\.png'|\.jpg`/.test(src), 'terrain code asks for WebP only');
});

test('loading: character GLBs are meshopt-compressed and every character loader registers the decoder', () => {
  const dir = P('assets/characters/');
  for (const g of ['enemies', 'commandos', 'anims']) {
    const f = readdirSync(new URL(g + '/', dir)).find((n) => n.endsWith('.glb'));
    const b = readFileSync(new URL(`${g}/${f}`, dir));
    const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    assert.ok(json.extensionsRequired?.includes('EXT_meshopt_compression'), `${g}/${f}`);
  }
  const rt = P('src/art/characters/');
  for (const f of ['pipeline/charkit.js', 'commandos_b/charkit.js', 'guests/charkit.js', 'pipeline/weapons.js', 'commandos_b/weapons.js', 'guests/weapons.js', 'guests/dogkit.js']) {
    assert.ok(/setMeshoptDecoder\(MeshoptDecoder\)/.test(readFileSync(new URL(f, rt), 'utf8')), f);
  }
});

test('loading: building textures — 512 set for low, byte-identical maps aliased away', () => {
  const man = JSON.parse(readFileSync(P('assets/models/buildings/manifest.json'), 'utf8'));
  assert.equal(man.textures.low, '512');
  // the vehicle library (art/vehicle-library.js) loads the shared maps without the building aliases: a map one of its
  // GLBs (or its manifest's paint swaps) still names stays on disk (wood_paint_* on the fishing boats / covered wagon)
  const vehRefs = (() => {
    const out = [], walk = (d) => { for (const e of readdirSync(P(d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}${e.name}/`); else if (/\.(glb|json)$/.test(e.name)) out.push(readFileSync(P(d + e.name)).toString('latin1'));
    } };
    if (existsSync(P('assets/models/vehicles/'))) walk('assets/models/vehicles/');
    return (name) => out.some((b) => b.includes(name));
  })();
  for (const [gone, kept] of Object.entries(man.textures.aliases)) {
    assert.ok(!existsSync(P(`assets/textures/lib/1k/${gone}`)) || vehRefs(gone), `${gone} removed`);
    assert.ok(existsSync(P(`assets/textures/lib/1k/${kept}`)) && existsSync(P(`assets/textures/lib/512/${kept}`)), `${kept} kept`);
  }
  const k1 = readdirSync(P('assets/textures/lib/1k')), k5 = new Set(readdirSync(P('assets/textures/lib/512')));
  assert.deepEqual(k1.filter((f) => !k5.has(f) && !vehRefs(f)), [], 'every building 1k map has its 512 twin (vehicles load 1k only)');
});

test('loading: GitHub Pages limits — no asset file over 50 MB, assets well under 1 GB', () => {
  let total = 0, biggest = ['', 0];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = statSync(p).size; total += s; if (s > biggest[1]) biggest = [p, s]; }
    }
  };
  walk(P('assets').pathname);
  assert.ok(biggest[1] < 50e6, `${biggest[0]} ${(biggest[1] / 1e6).toFixed(1)} MB`);
  assert.ok(total < 700e6, `assets ${(total / 1e6).toFixed(0)} MB`);
});
