/**
 * Render cost regression (perf/render-efficiency): every mission at its default view (squad recentred, zoom 1, the
 * default yaw), preset high, 1280×720 — draw calls and triangles per frame (whole frame: sun shadow, world, AO prepass,
 * water mirror, x-ray, post; averaged over frames because the mirror refreshes every other frame with a still camera)
 * and the frame's main-thread time (median of synced frames), against tests/render-budgets.json.
 *
 * Budgets were measured on the culled / chunked pipeline (engine/chunking.js, engine/shadow-cull.js, the water mirror
 * window) with headroom for art changes: calls and triangles may grow by `slack` (25 %) before the test fails; the
 * frame time is checked against a loose cap (`msSlack` ×, machine load varies a lot). A mission without a budget only
 * logs its numbers. Refresh after an intended change: RENDER_BUDGET_WRITE=1 node tests/run.mjs render-budget
 * (writes the measured values). RENDER_BUDGET_MISSIONS=m01,m03 limits the run.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

export const timeout = 2_400_000; // ~21 mission loads on a shared GPU
const FILE = join(ROOT, 'tests/render-budgets.json');

export default async function (page, t) {
  const budgets = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { missions: {} };
  const slack = budgets.slack ?? 1.25, msSlack = budgets.msSlack ?? 3;
  let ids = await page.evaluate(async () => (await import('/src/missions/index.js')).MISSIONS.filter((m) => !m.dev && m.campaign !== 'BCD').map((m) => m.id));
  if (process.env.RENDER_BUDGET_MISSIONS) ids = process.env.RENDER_BUDGET_MISSIONS.split(',');
  const out = {};
  const fails = [];
  for (const id of ids) {
    const r = await page.evaluate(async (m) => {
      const g = window.__game, G = g.game;
      G.stop(); // explicit frames only
      g.setPreset('high');
      await g.loadMission(m);
      G.stop();
      g.start();
      G.focusSquad?.();
      for (let i = 0; i < 30; i++) g.advance(1 / 30);
      for (let i = 0; i < 600 && G.textureWarmer?.queue.length; i++) G.textureWarmer.step(50);
      G.focusSquad?.();
      if (G.selection) G.selection.pulseT = 0.3;
      for (let i = 0; i < 8; i++) G.render(1 / 60, 1);
      let calls = 0, tris = 0;
      const N = 8;
      for (let i = 0; i < N; i++) { G.render(1 / 60, 1); const s = G.renderer.stats(); calls += s.calls; tris += s.triangles; }
      const gl = G.renderer.renderer.getContext(), px = new Uint8Array(4), ms = [];
      for (let i = 0; i < 24; i++) {
        const t0 = performance.now();
        G.render(1 / 60, 1);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      return { calls: Math.round(calls / N), tris: Math.round(tris / N), ms: +ms[ms.length >> 1].toFixed(2), chunks: G.chunkStats?.chunks ?? 0, lost: gl.isContextLost() };
    }, id);
    out[id] = { calls: r.calls, tris: r.tris, ms: r.ms };
    const b = budgets.missions?.[id];
    t.log(`${id}: ${r.calls} draws, ${(r.tris / 1e6).toFixed(2)} M tris, ${r.ms} ms${b ? ` (budget ${b.calls} / ${(b.tris / 1e6).toFixed(2)} M / ${b.ms} ms)` : ' (no budget)'}, ${r.chunks} terrain chunks`);
    t.ok(!r.lost, `${id}: context lost`);
    if (!b || process.env.RENDER_BUDGET_WRITE) continue;
    if (r.calls > b.calls * slack) fails.push(`${id} draw calls ${r.calls} > ${b.calls} × ${slack}`);
    if (r.tris > b.tris * slack) fails.push(`${id} triangles ${r.tris} > ${b.tris} × ${slack}`);
    if (r.ms > b.ms * msSlack) fails.push(`${id} frame ${r.ms} ms > ${b.ms} × ${msSlack}`);
  }
  if (process.env.RENDER_BUDGET_WRITE) {
    const merged = { ...budgets, preset: 'high', viewport: [1280, 720], slack, msSlack, measured: new Date().toISOString().slice(0, 10), missions: { ...(budgets.missions || {}), ...out } };
    writeFileSync(FILE, JSON.stringify(merged, null, 1) + '\n');
    t.log(`wrote ${FILE}`);
  }
  t.ok(!fails.length, fails.join('; '));
}
