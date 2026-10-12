#!/usr/bin/env node
/**
 * Mission load time A/B: two checkouts, alternating runs (fresh browser each, cold HTTP cache), so a busy machine
 * hits both alike. Reports loadMission() wall time per run and the median; for a tree with engine/gpu-compress.js,
 * the compressor's main-thread time and texture count too.
 *
 *   node tools/perf/load-ab.mjs --a=<checkout> --b=<checkout> [--missions=m01,m04] [--runs=3] [--preset=high]
 *        [--qa=…] [--qb=gpumode1=1]   (extra URL parameters per side)
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const { chromium } = await import(pathToFileURL(join(HERE, 'node_modules/playwright-core/index.mjs')).href);
const sides = { a: { root: resolve(arg('a')), q: arg('qa', '') }, b: { root: resolve(arg('b', HERE)), q: arg('qb', '') } };
for (const s of Object.values(sides)) s.server = await startServer({ port: 0, root: s.root });
const preset = arg('preset', 'high'), runs = +arg('runs', 3);
const out = {};
for (const m of arg('missions', 'm01').split(',')) {
  for (let r = 0; r < runs; r++) for (const k of r % 2 ? ['b', 'a'] : ['a', 'b']) {
    const s = sides[k];
    const browser = await chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`${s.server.url}index.html?test=1&preset=${preset}${s.q ? '&' + s.q : ''}`, { timeout: 180000 });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
    const res = await page.evaluate(async (mid) => {
      const t0 = performance.now();
      await window.__game.loadMission(mid);
      const ms = performance.now() - t0;
      const GC = await import('/src/engine/gpu-compress.js').catch(() => null);
      const c = GC?.gpuCompressor?.();
      return { ms, stats: c ? { ...c.stats, mode1: c.mode1 } : null };
    }, m);
    ((out[m] ||= { a: [], b: [] })[k]).push(res);
    console.log(`${m} ${k} run ${r}: ${(res.ms / 1000).toFixed(1)} s${res.stats ? ` (compressor: ${res.stats.textures} textures + ${res.stats.arrays} arrays, main thread ${res.stats.mainMs.toFixed(0)} ms (upload ${res.stats.uploadMs?.toFixed(0)}, readback ${res.stats.readMs?.toFixed(0)}), mode1 ${res.stats.mode1})` : ''}`);
    await browser.close();
  }
  const med = (v) => { const x = v.map((o) => o.ms).sort((p, q) => p - q); return x[x.length >> 1] / 1000; };
  console.log(`${m}: median a ${med(out[m].a).toFixed(1)} s, b ${med(out[m].b).toFixed(1)} s`);
}
for (const s of Object.values(sides)) await s.server.close();
