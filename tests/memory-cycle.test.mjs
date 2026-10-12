/**
 * No GPU growth over a whole campaign in one session (perf/gpu-memory): M16 fresh, then every map in turn (b00, M0…M20),
 * then M16 again — with no spare cache (sessionCache.spare = 0: what one mission keeps is the mechanism, not the desktop
 * convenience of keeping ~1/32 of RAM of other missions' data). GPU bytes counted at allocation by
 * tools/perf/mem-probe.js. History: before the fixes M16 went from 820 MB (99 MB of buffers) to 1151 MB (290 MB) at
 * desktop high with the default spare — terrain / apron chunk rows never disposed (their vertex arrays kept the whole
 * map's buffers), chunked indices replaced after the water bakes had uploaded them, the theatre HDRs and module
 * canvases kept on the GPU.
 */
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

export const timeout = 2_400_000;
const MB = 1048576;
/** The last M16 may hold this much more than the first (shared library maps first loaded by other missions). */
const MARGIN = { ratio: 1.05, abs: 8 * MB };

export default async function (page, t) {
  await page.addInitScript({ path: join(ROOT, 'tools/perf/mem-probe.js') });
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  const ids = await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    window.__memProbe.hookThree(THREE, { GLTFLoader });
    window.__game.setPreset('medium');
    const { sessionCache } = await import('/src/engine/asset-cache.js');
    sessionCache.spare = 0;
    return (await import('/src/missions/index.js')).MISSIONS.map((m) => m.id);
  });
  const cdp = await page.context().newCDPSession(page);
  const measure = async (id) => {
    await page.evaluate(async (m) => {
      await window.__game.loadMission(m);
      const G = window.__game.game;
      for (let i = 0; i < 3; i++) G.render(0.016, 1);
    }, id);
    await page.waitForTimeout(1000);
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    return page.evaluate(() => window.__memProbe.report({ top: 1 }).gpu);
  };
  const a = await measure('m16');
  t.log(`M16 fresh: GPU ${(a.total / MB).toFixed(0)} MB (tex ${(a.tex / MB).toFixed(0)}, buffers ${(a.buf / MB).toFixed(0)})`);
  let peakBuf = a.buf;
  for (const id of ids) { const g = await measure(id); peakBuf = Math.max(peakBuf, g.buf); }
  const z = await measure('m16');
  t.log(`M16 after ${ids.length} maps: GPU ${(z.total / MB).toFixed(0)} MB (tex ${(z.tex / MB).toFixed(0)}, buffers ${(z.buf / MB).toFixed(0)}); largest buffer total on the way ${(peakBuf / MB).toFixed(0)} MB`);
  const lim = (x) => x * MARGIN.ratio + MARGIN.abs;
  t.ok(z.buf <= lim(a.buf), `buffers ${(a.buf / MB).toFixed(0)} → ${(z.buf / MB).toFixed(0)} MB (≤ ${(lim(a.buf) / MB).toFixed(0)})`);
  t.ok(z.total <= lim(a.total), `GPU total ${(a.total / MB).toFixed(0)} → ${(z.total / MB).toFixed(0)} MB (≤ ${(lim(a.total) / MB).toFixed(0)})`);
}
