#!/usr/bin/env node
/**
 * A/B screenshots for the memory work: the same views of a mission from two checkouts (e.g. master's worktree and the
 * branch), at zoom 1 and 2, on a building and on the squad — deterministic test-mode frames (fixed sim steps).
 *
 *   node tools/perf/memshot.mjs --root=<checkout> --tag=before|after [--missions=m01,m05,m14] [--preset=high]
 *        [--out=<projects>/commandos-shots/memory/shots] [--w=1920 --h=1080] [--views=m13/quay:65:145,…]
 *        [--query=gpucompress=0]  (extra URL parameters) [--freeze-water] (same water phase in every run) [--zooms=1,2]
 * Writes <out>/<mission>-<preset>-<view>-z<zoom>-<tag>.png. Compare with tools/perf/memshot-diff.py.
 */
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL(join(HERE, 'node_modules/playwright-core/index.mjs')).href);
const OUT = arg('out', '<projects>/commandos-shots/memory/shots');
const tag = arg('tag', 'shot'), preset = arg('preset', 'high');
mkdirSync(OUT, { recursive: true });
const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
for (const m of arg('missions', 'm01,m05,m14').split(',')) {
  const page = await browser.newPage({ viewport: { width: +arg('w', 1920), height: +arg('h', 1080) } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${server.url.replace(/\/$/, '')}/index.html?test=1&preset=${preset}${arg('query', '') ? '&' + arg('query', '') : ''}`, { timeout: 180000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  const views = await page.evaluate(async (mid) => {
    const g = window.__game, G = g.game;
    await g.loadMission(mid);
    g.start();
    for (let k = 0; k < 20; k++) g.step();
    const c = G.world.commandos[0];
    // the building with the largest footprint near the squad's side of the map
    const bs = (G.missionDef.structures || []).filter((s) => /barrack|house|hut|cabin|villa|church|depot|hangar|warehouse|bunker|station|farm|barn/.test(s.type || ''));
    const b = bs.sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
    return { squad: [c.x, c.z], building: b ? [b.x, b.z] : [c.x + 10, c.z + 10] };
  }, m);
  // --views=m13/quay:65:145,m13/dock:45:40 : extra fixed views (mission/name:x:z)
  for (const v of arg('views', '').split(',').filter(Boolean)) { const [mn, rest] = v.split('/'); const [name, x, z] = rest.split(':'); if (mn === m) views[name] = [+x, +z]; }
  for (const [view, [x, z]] of Object.entries(views)) {
    for (const zoom of arg('zooms', '1,2').split(',').map(Number)) {
      await page.evaluate(({ x, z, zoom, freeze }) => {
        const g = window.__game, G = g.game;
        // --freeze-water: the same water phase in every run (its time otherwise depends on how many frames ran)
        const ws = freeze ? G.world?.water?.system : null;
        if (ws) { ws.time = 100; ws.update(0); }
        G.cameraController.setZoom(zoom);
        G.cameraController.centerOn(x, z);
        G.cameraController.zoom = zoom; G.cameraController.zoomTarget = zoom;
        for (let k = 0; k < 4; k++) g.render();
      }, { x, z, zoom, freeze: process.argv.includes('--freeze-water') });
      await page.waitForTimeout(400); // lazily uploaded textures / released images settle
      await page.evaluate((freeze) => {
        const ws = freeze ? window.__game.game.world?.water?.system : null;
        if (ws) { ws.time = 100; ws.update(0); }
        for (let k = 0; k < 2; k++) window.__game.render();
      }, process.argv.includes('--freeze-water'));
      const f = join(OUT, `${m}-${preset}-${view}-z${zoom}-${tag}.png`);
      await page.screenshot({ path: f });
      console.log('saved', f);
    }
  }
  if (errs.length) console.log(m, 'page errors:', errs.slice(0, 3));
  await page.close();
}
await browser.close();
await server.close();
