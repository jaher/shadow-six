#!/usr/bin/env node
/**
 * Wind frame sequences + perf (step 4w).
 *
 *   node tools/perf/windshot.mjs --mission=m01 --out=docs/screenshots/p3-wind-m01 [--frames=4] [--gap=0.5]
 *     [--preset=high] [--zoom=2] [--at=x:z] [--wind=coast|{"speed":12,...}] [--perf=1] [--query=&chars=0] [--theater=desert]
 *
 * Loads the mission in test mode, centres the camera, advances the SIM by `gap` seconds between PNG frames
 * (<out>-0.png …). --wind overrides the mission wind (preset name or JSON params). --perf prints the mean
 * CPU frame time (game.render) over 40 frames and the WindField/cloth counters.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'windshot');
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
page.on('console', (m) => { if (/^flags /.test(m.text())) console.log(m.text()); });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}${arg('query', '')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async ({ m, zoom, at, wind, theater }) => {
  const g = window.__game, G = g.game;
  if (theater) { // sandbox map re-themed (e.g. --mission=m00 --theater=desert)
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    await G.loadMission({ ...base, id: 'm00', theater, vehicles: [{ id: 'tA', vehicleType: 'opel_blitz', x: 22, z: 26, heading: 0.4 }] });
  } else await g.loadMission(m);
  g.start();
  if (wind) {
    const W = await import('/src/world/wind.js');
    const p = wind.startsWith('{') ? JSON.parse(wind) : { preset: wind };
    const ev = G.world.wind.events;
    G.world.wind = new W.WindField(W.resolveWind({ theater: G.missionDef.theater, weather: { wind: p } }), { W: G.world.width, D: G.world.depth });
    G.world.wind.events = ev;
  }
  const c = G.world.commandos[0];
  const devil = at === 'devil';
  if (devil) { // desert: advance to a strong dust devil and frame it
    for (let k = 0; k < 240 && !(G.world.wind.devil(G.world.time)?.s > 0.6); k++) g.advance(0.5);
    const d = G.world.wind.devil(G.world.time) || { x: c.x, z: c.z };
    at = `${d.x + 2}:${d.z + 3}`;
  }
  const [x, z] = at ? at.split(':').map(Number) : [c.x, c.z];
  G.cameraController.setZoom(zoom);
  G.cameraController.centerOn(x, z);
  g.advance(devil ? 0.3 : 3);
  g.render();
  const fl = [];
  G.renderer.scene.traverse((o) => { if (o.name === 'flag_cloth' && o.isMesh) { const e = o.matrixWorld.elements; fl.push([+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1), o.visible]); } });
  console.log('flags', JSON.stringify(fl));
}, { m: arg('mission', 'm01'), zoom: Number(arg('zoom', 1.6)), at: arg('at', ''), wind: arg('wind', ''), theater: arg('theater', '') });
await page.waitForTimeout(400);
const frames = Number(arg('frames', 4)), gap = Number(arg('gap', 0.5));
for (let i = 0; i < frames; i++) {
  if (i) await page.evaluate((s) => { window.__game.advance(s); }, gap);
  await page.evaluate(() => window.__game.render());
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${out}-${i}.png` });
  console.log('saved', `${out}-${i}.png`);
}
if (arg('perf', '')) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, ms = [];
    for (let k = 0; k < 40; k++) {
      g.advance(1 / 60);
      const t0 = performance.now();
      G.render(1 / 60, 1);
      ms.push(performance.now() - t0);
      await new Promise((ok) => requestAnimationFrame(ok));
    }
    ms.sort((a, b) => a - b);
    const w = G.world.wind;
    return { cpuMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), p50: +ms[20].toFixed(2), preset: w.preset,
      speed: +w.p.speed.toFixed(1), strength: +w.strength.toFixed(2), gust: +(w.gust || 0).toFixed(2), calls: G.renderer.renderer.info.render.calls };
  });
  console.log('perf', JSON.stringify(r));
}
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
