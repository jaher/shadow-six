/**
 * Memory footprint (docs/ARCHITECTURE.md § Asset cache / texture memory): per-mission budgets and no growth over a
 * mission cycle. GPU bytes are counted at allocation by tools/perf/mem-probe.js (every live GL texture, buffer and
 * renderbuffer, mip chains included), the page side by the probe (live ImageBitmaps) and CDP (ArrayBuffer stores).
 *  - after M1 loads (preset medium, the phone default): the decoded GLB images that are on the GPU have left page
 *    memory (engine/texture-memory.js), the layer arrays too, and the GPU holds no more than the budget;
 *  - M1 → M2 → M3 → M1 with no spare: the last M1 holds what the first did (art libraries and module texture caches
 *    are scoped to the missions that use them, engine/scoped-assets.js), and the restart of M1 stays warm;
 *  - a lost and restored WebGL context draws the mission again (released arrays are decoded again, compressed maps
 *    encoded again).
 */
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

export const timeout = 600_000;
const MB = 1048576;
/**
 * Budgets (preset medium, 1280×720) + headroom. History: master before the memory work GPU ≈ 1.4 GB, bitmaps 757 MB,
 * ArrayBuffers 371 MB; after it (texel tiers, released decodes) GPU ≈ 1.0 GB; with the GPU texture compression and the
 * slimmer render targets (perf/gpu-memory: engine/gpu-compress.js) GPU ≈ 400 MB, of which textures ≈ 345 MB.
 * The texture budget only applies where the GPU samples BC7 or ASTC (else the maps stay RGBA8, as before).
 */
const BUDGET = { gpu: 1400 * MB, gpuCompressed: 600 * MB, texCompressed: 480 * MB, bitmaps: 200 * MB, backing: 260 * MB };

export default async function (page, t) {
  await page.addInitScript({ path: join(ROOT, 'tools/perf/mem-probe.js') });
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    window.__memProbe.hookThree(THREE, { GLTFLoader });
    window.__game.setPreset('medium');
    const { sessionCache } = await import('/src/engine/asset-cache.js');
    sessionCache.spare = 0; // leftovers of other missions are allowed by design on desktop: test the mechanism strictly
  });
  const cdp = await page.context().newCDPSession(page);
  const measure = async (id) => {
    await page.evaluate(async (m) => {
      await window.__game.loadMission(m);
      const G = window.__game.game;
      for (let i = 0; i < 3; i++) G.render(0.016, 1);
    }, id);
    await page.waitForTimeout(1500); // released images settle (the <img> stand-ins load asynchronously)
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const heap = await cdp.send('Runtime.getHeapUsage').catch(() => ({}));
    const r = await page.evaluate(() => {
      const rep = window.__memProbe.report({ top: 5 });
      return { gpu: rep.gpu, bitmaps: rep.bitmaps, cache: window.__game.cache.stats(), info: { ...window.__game.game.renderer.renderer.info.memory } };
    });
    r.backing = heap.backingStorageSize ?? null;
    t.log(`${id}: GPU ${(r.gpu.total / MB).toFixed(0)} MB (tex ${(r.gpu.tex / MB).toFixed(0)}, ${r.gpu.ntex} textures), bitmaps ${(r.bitmaps.bytes / MB).toFixed(0)} MB, ArrayBuffers ${r.backing == null ? '—' : (r.backing / MB).toFixed(0)} MB, cache ${r.cache.entries} entries ${(r.cache.bytes / MB).toFixed(0)} MB ${JSON.stringify(r.cache.missions)}`);
    return r;
  };
  const a = await measure('m01');
  const codec = await page.evaluate(async () => (await import('/src/engine/gpu-compress.js')).gpuCompressor()?.codec ?? null);
  const gpuBudget = codec ? BUDGET.gpuCompressed : BUDGET.gpu;
  t.ok(a.gpu.total <= gpuBudget, `M1 GPU ${(a.gpu.total / MB).toFixed(0)} MB ≤ ${gpuBudget / MB} MB (textures ${codec || 'uncompressed'})`);
  if (codec) t.ok(a.gpu.tex <= BUDGET.texCompressed, `M1 textures ${(a.gpu.tex / MB).toFixed(0)} MB ≤ ${BUDGET.texCompressed / MB} MB (${codec})`);
  t.ok(a.bitmaps.bytes <= BUDGET.bitmaps, `M1 decoded images kept ${(a.bitmaps.bytes / MB).toFixed(0)} MB ≤ ${BUDGET.bitmaps / MB} MB (before: 757 MB)`);
  if (a.backing != null) t.ok(a.backing <= BUDGET.backing, `M1 ArrayBuffers ${(a.backing / MB).toFixed(0)} MB ≤ ${BUDGET.backing / MB} MB`);
  await measure('m02');
  await measure('m03');
  const z = await measure('m01');
  t.ok(z.gpu.tex <= a.gpu.tex * 1.05 + 32 * MB, `no GPU growth over M1 → M2 → M3 → M1: textures ${(a.gpu.tex / MB).toFixed(0)} → ${(z.gpu.tex / MB).toFixed(0)} MB`);
  t.ok(z.gpu.total <= a.gpu.total * 1.05 + 48 * MB, `GPU total ${(a.gpu.total / MB).toFixed(0)} → ${(z.gpu.total / MB).toFixed(0)} MB`);
  t.ok(z.bitmaps.bytes <= a.bitmaps.bytes + 32 * MB, `decoded images ${(a.bitmaps.bytes / MB).toFixed(0)} → ${(z.bitmaps.bytes / MB).toFixed(0)} MB`);
  if (a.backing != null && z.backing != null) t.ok(z.backing <= a.backing * 1.1 + 32 * MB, `ArrayBuffers ${(a.backing / MB).toFixed(0)} → ${(z.backing / MB).toFixed(0)} MB`);
  t.equal(JSON.stringify(z.cache.missions), '["m01"]', 'only the mission on screen stays in the cache history');
  // the mission on screen is warm: a restart fetches nothing
  const reqs = [];
  page.on('request', (r) => { if (/\/(assets|vendor)\//.test(new URL(r.url()).pathname)) reqs.push(r.url()); });
  const ms = await page.evaluate(async () => { const t0 = performance.now(); await window.__game.loadMission('m01'); return performance.now() - t0; });
  t.log(`restart M1: ${ms.toFixed(0)} ms, ${reqs.length} asset requests`);
  t.equal(reqs.length, 0, `restart of the mission on screen fetches nothing (${reqs.slice(0, 3)})`);
  // a lost and restored WebGL context: the released layer arrays are decoded again, the images re-upload from their
  // bytes, the environment light is filtered again and the trails stamped again — the frame comes back as it was
  // (before the refill: black terrain, luma ~45 of ~140; without the environment light ~14 % darker)
  const lost = await page.evaluate(async () => {
    const g = window.__game, G = g.game, R = G.renderer.renderer;
    const frames = async (n) => { for (let i = 0; i < n; i++) { G.render(0.016, 1); await new Promise((ok) => requestAnimationFrame(ok)); } };
    await frames(30);
    const before = g.frameStats().luma;
    const ext = R.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return null;
    ext.loseContext();
    await new Promise((ok) => setTimeout(ok, 300));
    ext.restoreContext();
    await new Promise((ok) => setTimeout(ok, 300));
    await frames(90);
    await new Promise((ok) => setTimeout(ok, 2500)); // the layer strips decode again
    const TM = await import('/src/engine/texture-memory.js');
    const GC = await import('/src/engine/gpu-compress.js');
    const t0 = performance.now();
    // compressed maps (engine/gpu-compress.js) are encoded again as three re-uploads them: draw until nothing is left
    for (let i = 0; i < 40; i++) {
      await frames(5);
      await TM.compressedRefillsIdle();
      await GC.gpuCompressor()?.idle();
    }
    await frames(10);
    return { before, after: g.frameStats().luma, reloaded: TM.textureMemoryStats.reloaded, refills: TM.textureMemoryStats.compressedRefills, refillMs: performance.now() - t0 };
  });
  if (lost) {
    t.log(`context restored: luma ${lost.before} → ${lost.after}, ${lost.reloaded} arrays decoded again, ${lost.refills} compressed maps encoded again (${lost.refillMs.toFixed(0)} ms)`);
    t.ok((lost.reloaded > 0 || lost.refills > 0) && Math.abs(lost.after - lost.before) <= lost.before * 0.03, `the frame comes back after a lost context (luma ${lost.before} → ${lost.after})`);
  }
}
