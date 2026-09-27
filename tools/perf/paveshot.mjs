#!/usr/bin/env node
/**
 * Pavement / street furniture frames + perf (step 3p).
 *
 *   node tools/perf/paveshot.mjs --mission=gallery|m01|m02|m03 --out=docs/screenshots/p3-pavement-x [--theater=snow]
 *     [--night=1] [--rain=1] [--preset=high] [--zoom=2] [--at=x:z] [--frames=1] [--gap=0.5] [--perf=1] [--w=1280 --h=720]
 *     [--drive=1] (a truck drives through the view between frames: tyre films on the setts)
 *
 * --mission=gallery loads src/missions/dev/pavement-gallery.js (re-themed by --theater, --night / --rain). --perf
 * prints the GPU-synced frame time with the pavement + furniture shown vs hidden at the current preset.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'paveshot');
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
page.on('console', (m) => { if (/^pave |\[pavement\]|error/i.test(m.text())) console.log(m.text().slice(0, 600)); });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const at = await page.evaluate(async ({ m, zoom, at, theater, night, rain }) => {
  const g = window.__game, G = g.game;
  if (m === 'gallery' || theater || night || rain) {
    const base = m === 'gallery' ? (await import('/src/missions/dev/pavement-gallery.js')).default : (await import(`/src/missions/index.js`)).MISSIONS?.[m] ?? null;
    const def = { ...(base || {}) };
    if (theater) def.theater = theater;
    if (night) { def.lighting = { ...(def.lighting || {}), hdri: 'night', sunElevDeg: 30, night: true }; delete def.lighting.kelvin; }
    if (rain) def.weather = { ...(def.weather || {}), rain: true };
    await G.loadMission(base ? def : m);
  } else await g.loadMission(m);
  g.start();
  g.advance(0.5); G.render(1 / 60, 1);
  await G.mapHandle.ready;
  let [x, z] = at ? at.split(':').map(Number) : [G.world.commandos[0].x, G.world.commandos[0].z];
  G.cameraController.setZoom(zoom);
  G.cameraController.centerOn(x, z);
  g.advance(0.5); g.render();
  console.log('pave', JSON.stringify({ stats: G.mapHandle.pavement?.stats ?? null, furniture: G.mapHandle.furniture?.stats ?? null }));
  return [x, z];
}, { m: arg('mission', 'gallery'), zoom: Number(arg('zoom', 2)), at: arg('at', ''), theater: arg('theater', ''), night: arg('night', ''), rain: arg('rain', '') });
await page.waitForTimeout(1500);
const views = arg('views', '');   // --views=zoom:x:z,zoom:x:z → <out>-v0.png, <out>-v1.png … (one session)
for (const [i, v] of (views ? views.split(',') : []).entries()) {
  const [zm, vx, vz] = v.split(':').map(Number);
  await page.evaluate(({ zm, vx, vz }) => { const G = window.__game.game; G.cameraController.setZoom(zm); G.cameraController.centerOn(vx, vz); window.__game.render(); }, { zm, vx, vz });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${out}-v${i}.png` });
  console.log('saved', `${out}-v${i}.png`);
}
if (arg('walk', '')) { // --walk=x:z[:unit] — the first commando runs there while the frames are taken
  const [wx, wz] = arg('walk', '').split(':').map(Number);
  await page.evaluate(({ wx, wz }) => { const g = window.__game, c = g.game.world.commandos[0]; g.order(c.id, { type: 'move', x: wx, z: wz, run: true }); }, { wx, wz });
}
const frames = Number(arg('frames', views ? 0 : 1)), gap = Number(arg('gap', 0.5));
for (let i = 0; i < frames; i++) {
  if (i) await page.evaluate((s) => window.__game.advance(s), gap);
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${out}${frames > 1 ? '-' + i : ''}.png` });
  console.log('saved', `${out}${frames > 1 ? '-' + i : ''}.png`);
}
if (arg('perf', '')) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, P = G.mapHandle.pavement?.group, F = G.mapHandle.furniture?.group;
    const run = async (show) => {
      if (P) P.visible = show; if (F) F.visible = show;
      const ms = [];
      for (let k = 0; k < 60; k++) {
        g.advance(1 / 60);
        const t0 = performance.now();
        G.render(1 / 60, 1);
        G.renderer.renderer.getContext().finish();
        ms.push(performance.now() - t0);
        await new Promise((ok) => requestAnimationFrame(ok));
      }
      ms.sort((a, b) => a - b);
      return +ms[30].toFixed(2);
    };
    const on1 = await run(true), off = await run(false), on2 = await run(true);
    return { on: Math.min(on1, on2), off, preset: G.renderer.presetName, info: G.renderer.renderer.info.render };
  });
  console.log('perf', JSON.stringify(r));
}
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
