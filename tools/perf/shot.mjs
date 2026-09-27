#!/usr/bin/env node
/**
 * Deterministic in-game screenshot for asset A/B checks (image diff before/after a recompression).
 *
 *   node tools/perf/shot.mjs --mission=m01 --out=a.png [--preset=high] [--zoom=2] [--at=x,z] [--query=&chars=0]
 *
 * Loads the mission in test mode, centres the camera on the first commando (or --at), steps 0.5 s and saves a PNG.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const shots = arg('out', 'shot.png').split(',');
const missions = arg('mission', 'm01').split(',');
const h = await startHarness({});
for (let i = 0; i < missions.length; i++) {
  const page = await h.newPage({ width: 1280, height: 720 });
  await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}${arg('query', '')}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  await page.evaluate(async ({ m, zoom, at }) => {
    const g = window.__game, G = g.game;
    await g.loadMission(m);
    g.start();
    const c = G.world.commandos[0];
    const [x, z] = at ? at.split(':').map(Number) : [c.x, c.z];
    G.cameraController.setZoom(zoom);
    G.cameraController.centerOn(x, z);
    for (let k = 0; k < 30; k++) g.step();
    g.render();
  }, { m: missions[i], zoom: Number(arg('zoom', 1.6)), at: arg('at', '') });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: shots[i] || shots[0] });
  const errs = h.errors(page);
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
  await page.close();
  console.log('saved', shots[i] || shots[0]);
}
await h.close();
