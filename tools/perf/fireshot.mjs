#!/usr/bin/env node
/**
 * Fireball look-dev screenshots at the game camera: node tools/perf/fireshot.mjs --out=dir [--theater=snow|desert]
 *   [--kind=explosion_large] [--times=0.15,0.45,1.0] [--mission=m01]
 * Spawns the effect next to the first commando and saves one PNG per time offset.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', '.'), theater = arg('theater', 'snow'), kinds = arg('kind', 'explosion_large').split(',');
const times = arg('times', '0.15,0.45,1.0').split(',').map(Number);
const h = await startHarness({});
const page = await h.newPage({ width: 1280, height: 720 });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async ({ m, theater, ev }) => {
  const g = window.__game, G = g.game;
  const mod = await import('/src/missions/index.js');
  const def = mod.MISSIONS.find((x) => x.id === m);
  await g.loadMission(theater === 'desert' ? { ...def, theater: 'desert', lighting: { ...(def.lighting || {}), snow: 0 } } : def);
  g.start();
  await G.mapHandle?.ready;
  const c = G.world.commandos[0];
  G.cameraController.setZoom(1.6); G.cameraController.centerOn(c.x + 8, c.z + 4);
  for (let k = 0; k < 30; k++) g.step();
  if (ev) new Function('G', ev)(G); // look-dev tweak, e.g. --eval="G.world.fx.vfx.u.uFireGain.value=6"
}, { m: arg('mission', 'm01'), theater, ev: arg('eval', '') });
for (const kind of kinds) {
  let t0 = 0;
  await page.evaluate(({ kind }) => { const G = window.__game.game, c = G.world.commandos[0]; G.world.fx.spawn(kind, c.x + 8, c.z + 4, {}); }, { kind });
  for (const t of times) {
    await page.evaluate(({ dt }) => { const g = window.__game, G = g.game; const n = Math.round(dt * 60); for (let i = 0; i < n; i++) { g.advance(1 / 60); G.render(1 / 60, 1); } }, { dt: t - t0 });
    t0 = t;
    await page.screenshot({ path: join(out, `${theater}-${kind}-${t}.png`) });
  }
  await page.evaluate(() => { const g = window.__game, G = g.game; for (let i = 0; i < 600; i++) g.advance(1 / 60); G.render(1 / 60, 1); });
}
const errs = h.errors(page);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await h.close();
console.log('done');
