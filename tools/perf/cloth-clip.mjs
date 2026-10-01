#!/usr/bin/env node
/**
 * Canvas-cover motion clip frames: M2's truck at zoom 2, deterministic 60 fps sim stepping, parked for the first
 * half, then driving straight ahead at `--speed` m/s with the camera following. Writes <out>/f0000.png …
 *
 *   node tools/perf/cloth-clip.mjs --out=/tmp/frames [--t0=600] [--secs=6] [--speed=9] [--zoom=2] [--w=640 --h=720]
 *     [--yaw=deg] [--still=1]   (--still: one frame only, `--t0` + 2 s, for seam close-ups)
 */
import { mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'cloth-frames'), secs = Number(arg('secs', 6)), still = !!arg('still', '');
mkdirSync(out, { recursive: true });
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 640)), height: Number(arg('h', 720)) });
await page.goto(`${h.url}/index.html?test=1&preset=high`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async (o) => {
  const g = window.__game, G = g.game;
  await g.loadMission(o.mission); g.start();
  const v = G.world.entities.find((e) => e.kind === 'vehicle' && e.tag === 'truck');
  await v.model.ready;
  G.world.time = o.t0;
  for (const e of G.world.entities) if (e.kind === 'enemy' || e.kind === 'soldier') { e.update = () => {}; }
  window.__clip = { v, x0: v.x, z0: v.z, h: v.heading };
  const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden';
  G.cameraController.setZoom(o.zoom);
  if (Number.isFinite(o.yaw)) G.cameraController.setYaw(o.yaw);
  G.cameraController.centerOn(v.x, v.z);
  g.advance(0.5); g.render();
}, { mission: arg('mission', 'm02'), t0: Number(arg('t0', 600)), zoom: Number(arg('zoom', 2)), yaw: arg('yaw', '') === '' ? NaN : Number(arg('yaw')) });
const F = still ? 1 : Math.round(secs * 60), driveFrom = Math.round(F / 2), speed = Number(arg('speed', 9));
if (still) await page.evaluate(() => { for (let k = 0; k < 120; k++) window.__game.advance(1 / 60); });
for (let i = 0; i < F; i++) {
  await page.evaluate(({ i, driveFrom, speed }) => {
    const g = window.__game, G = g.game, c = window.__clip, v = c.v;
    if (i >= driveFrom) {
      const s = (speed * (i - driveFrom + 1)) / 60;
      v.prevX = v.x; v.prevZ = v.z;
      v.x = c.x0 + Math.cos(c.h) * s; v.z = c.z0 + Math.sin(c.h) * s; v.speed = speed;
    }
    g.advance(1 / 60);
    G.cameraController.centerOn(v.x, v.z);
    g.render();
  }, { i, driveFrom, speed });
  await page.screenshot({ path: join(out, `f${String(i).padStart(4, '0')}.png`) });
}
console.log('frames', F, 'in', out);
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
