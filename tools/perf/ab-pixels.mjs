#!/usr/bin/env node
/**
 * Same-page pixel check of a runtime switch (src/engine/perf-flags.js, `window.__perf`): the M3 walkthrough plays to each
 * checkpoint, the game loop stops, and the same still frame is drawn with the switch on (A), off (B) and on again (A2):
 * A↔A2 is the renderer's own noise floor, A↔B what the switch changes. Per checkpoint: pixels that differ at all, by
 * > 2 and > 8 levels (max over RGB), the largest difference, the mean; `still`: A↔B over the pixels A and A2 agree on
 * exactly (what moves on its own — snowfall, particles — left out). --png writes A, B, |A−B|×8 and S (the `still`
 * differences white over a dimmed A) per checkpoint.
 *
 *   node tools/perf/ab-pixels.mjs --flag=grassMerge [--cps=C1,F3,H2,I2] [--play=3] [--size=1920x1080] [--root=<checkout>]
 *        [--png=<dir>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flags = arg('flag', '').split(',').filter(Boolean), cps = arg('cps', 'C1,F3,H2,I2').split(','), play = +arg('play', 3);
const [vw, vh] = arg('size', '1920x1080').split('x').map(Number), png = arg('png', '');
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const server = await startServer({ port: 0, root: resolve(arg('root', HERE)) });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(0);
await page.goto(`${server.url.replace(/\/$/, '')}/index.html?debug&walkthrough=m03`);
await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay && window.__perf, null, { timeout: 300000 });
if (png) mkdirSync(png, { recursive: true });
const rows = [];
for (const cp of cps) {
  await page.evaluate((c) => window.shadowSix.debug.mode.replay.jumpTo({ kind: 'cp', id: c }), cp);
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && !r.pacer.turbo && !r._introOn; }, null, { timeout: 900000 });
  await page.evaluate(() => { const r = window.shadowSix.debug.mode.replay; r.hold = null; r.setAuto?.(true); });
  await page.waitForTimeout(play * 1000);
  const out = await page.evaluate(({ flags, png }) => {
    const g = window.shadowSix, R = g.renderer.renderer, gl = R.getContext();
    g.stop();
    const W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
    const shot = (on) => {
      for (const f of flags) window.__perf[f] = on;
      for (let i = 0; i < 4; i++) g.render(0, 1); // (a switch's first frame may build; the mirror alternates levels)
      const px = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const A = shot(true), B = shot(false), A2 = shot(true);
    const cmp = (x, y) => {
      let any = 0, gt2 = 0, gt8 = 0, max = 0, sum = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
        if (d) { any++; sum += d; if (d > 2) gt2++; if (d > 8) gt8++; if (d > max) max = d; }
      }
      return { any, gt2, gt8, max, mean: +(sum / (x.length / 4)).toFixed(5) };
    };
    const img = (px, f = (i) => px[i]) => {
      const c = document.createElement('canvas'); c.width = W; c.height = Hh;
      const cx = c.getContext('2d'), id = cx.createImageData(W, Hh);
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W * 4; x++) id.data[(Hh - 1 - y) * W * 4 + x] = (x & 3) === 3 ? 255 : f(y * W * 4 + x);
      cx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    };
    const still = (() => {
      let n = 0, any = 0, gt2 = 0, max = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (A[i] !== A2[i] || A[i + 1] !== A2[i + 1] || A[i + 2] !== A2[i + 2]) continue;
        n++;
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d) { any++; if (d > 2) gt2++; if (d > max) max = d; }
      }
      return { pixels: n, any, gt2, max };
    })();
    const res = { t: +g.world.time.toFixed(1), calls: R.info.render.calls, AB: cmp(A, B), AA: cmp(A, A2), still };
    if (png) {
      const q = (i) => i - (i & 3);
      const st = (i) => { const k = q(i); return A[k] === A2[k] && A[k + 1] === A2[k + 1] && A[k + 2] === A2[k + 2] && (A[k] !== B[k] || A[k + 1] !== B[k + 1] || A[k + 2] !== B[k + 2]) ? 255 : A[i] >> 3; };
      res.png = { A: img(A), B: img(B), D: img(A, (i) => Math.min(255, Math.abs(A[i] - B[i]) * 8)), S: img(A, st) };
    }
    for (const f of flags) window.__perf[f] = true;
    g.run();
    return res;
  }, { flags, png });
  if (out.png) for (const k of ['A', 'B', 'D', 'S']) writeFileSync(join(png, `${cp}-${k}.png`), Buffer.from(out.png[k].split(',')[1], 'base64'));
  delete out.png;
  rows.push({ cp, ...out });
  console.log(cp, JSON.stringify(out));
}
await browser.close(); await server.close();
