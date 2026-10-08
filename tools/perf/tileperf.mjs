#!/usr/bin/env node
/**
 * Frame cost of the ground / building materials (anti-tiling A/B): GPU-synced bench medians for a few framings per
 * preset. Run it in two checkouts (before / after) and compare.
 *
 *   node tools/perf/tileperf.mjs [--presets=low,high] [--frames=120] [--reps=2]
 *
 * Framings: the pavement gallery (every paving at once, zoom 0.8), M12 Tunis rooftops (zoom 0.5), M13 docks (zoom 1),
 * M16 meadows (zoom 0.5). Prints one JSON line per framing and preset: wall / GPU medians (ms), best of the reps.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const VIEWS = [
  { m: 'gallery', zoom: 0.8, x: 40, z: 45 },
  { m: 'm12', zoom: 0.5, x: 38, z: 62 },
  { m: 'm13', zoom: 1, x: 48, z: 38 },
  { m: 'm16', zoom: 0.5, x: 50, z: 40 },
];
const h = await startHarness({});
for (const preset of arg('presets', 'low,high').split(',')) {
  for (const v of VIEWS) {
    const page = await h.newPage({ width: 1280, height: 720 });
    await page.goto(`${h.url}/index.html?test=1&preset=${preset}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    const r = await page.evaluate(async ({ v, frames, reps }) => {
      const g = window.__game, G = g.game;
      if (v.m === 'gallery') await G.loadMission((await import('/src/missions/dev/pavement-gallery.js')).default);
      else await g.loadMission(v.m);
      g.start(); g.advance(0.5); G.render(1 / 60, 1);
      await G.mapHandle?.ready;
      for (const e of G.world.enemies) if (e.brain) e.brain.update = () => {};
      G.cameraController.setZoom(v.zoom, true); G.cameraController.centerOn(v.x, v.z);
      for (let k = 0; k < 30; k++) G.render(1 / 60, 1);
      await new Promise((res) => setTimeout(res, 1500));
      const runs = [];
      for (let i = 0; i < reps; i++) runs.push(await g.bench(frames));
      const best = (k) => Math.min(...runs.map((b) => b[k] ?? Infinity));
      return { wall: best('wallMedian'), gpu: best('gpuMedian'), calls: runs[0].calls, size: runs[0].size };
    }, { v, frames: Number(arg('frames', 120)), reps: Number(arg('reps', 2)) });
    console.log(JSON.stringify({ preset, view: `${v.m}@${v.zoom}`, ...r }));
    const errs = h.errors(page);
    if (errs.length) console.log(errs.slice(0, 3).join('\n'));
    await page.close();
  }
}
await h.close();
