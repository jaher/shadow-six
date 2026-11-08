#!/usr/bin/env node
/**
 * Flicker detector for a mission's opening (the loading screen → first frame → title card → play): every frame the
 * game draws is captured as a small box-filtered thumbnail (tools/perf/flicker-probe.js, real requestAnimationFrame
 * pacing, no stall) and searched for A-B-A blinks (tools/perf/flicker-detect.mjs); optionally the composited page too
 * (CDP screencast: DOM layers included), saved as JPEG frames for strips and clips.
 *
 *   node tools/perf/flicker.mjs --mission=m02 [--speed=auto|1|4|none] [--size=1280x720 | --phone] [--secs=40]
 *        [--ui] [--start=3] [--play] [--base=https://jaher.github.io/shadow-six/] [--root=<checkout>] [--sc]
 *        [--out=<dir>] [--tag=name] [--T=16] [--quiet] [--after=<s>] [--maxW=80] [--nocones]
 *
 * --ui: open it the way a user does (?debug, the level select's "watch the walkthrough"); default the link
 * ?debug&walkthrough=<id>&speed=<s>. --start: click Start that many s after the title card shows (default: its own 9 s
 * timer). --after: stop that many s after play starts (else after --secs). --play: normal play (?mission=<id>, no debug). --base: a deployed build instead of the checkout.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flickerProbe } from './flicker-probe.js';
import { detectFlicker, describe } from './flicker-detect.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => argv.includes(`--${k}`);

/**
 * One capture. @returns {Promise<{frames, outside, events, alternating, stats, sc, errs, err}>}
 * @param {object} o {mission, speed, size: [w, h], phone, secs, ui, start, play, base, root, sc: dir|null, T}
 */
export async function captureOpening(o) {
  const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
  const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
  let server = null, base = o.base;
  if (!base) { const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href); server = await startServer({ port: 0, root: resolve(o.root || HERE) }); base = server.url; }
  base = base.replace(/\/(index\.html)?$/, '/');
  const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
  try {
    const [vw, vh] = o.size || [1280, 720];
    const ctx = await browser.newContext(o.phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.33 Mobile Safari/537.36', viewport: { width: 839, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } : { viewport: { width: vw, height: vh } });
    await ctx.addInitScript(flickerProbe, { maxW: o.maxW || 80 });
    // --nocones: the vision cones left out of the picture (a cone turning with its guard's head or sliding with a walker
    // crosses 16-px cells in a frame or two: motion) and judged by their mechanism instead — every shown cone's drawn
    // window inside its sector, each drawn frame (render/vision-cone.js: a window outside it is a slice missing)
    if (o.nocones) await ctx.addInitScript(() => {
      const W = (window.__coneCut = { frames: 0, cut: 0, worst: 0, at: [] });
      const hook = setInterval(() => {
        const C = window.shadowSix?.cones;
        if (!C || C.__flkCones || typeof C.update !== 'function' || !C.cones) return;
        C.__flkCones = true;
        const up = C.update;
        C.update = function (...a) {
          const r = up.apply(this, a);
          W.frames++;
          for (const [e, c] of C.cones) {
            c.nearMesh.layers.set(31); c.farMesh.layers.set(31);
            const S = c._sector;
            if (!S || !c.group.visible || !c.drawnWindow) continue;
            const d = c.drawnWindow(), dw = d.heading - (S.a0 + S.a1) / 2;
            const out = Math.abs(dw - 2 * Math.PI * Math.round(dw / (2 * Math.PI))) + d.halfFov - (S.a1 - S.a0) / 2;
            if (out > 1e-6) { W.cut++; W.worst = Math.max(W.worst, out); if (W.at.length < 8) W.at.push(`e${e.id} t${(window.shadowSix.world?.time ?? 0).toFixed(2)} ${(out * 57.3).toFixed(1)}°`); }
          }
          return r;
        };
      }, 50);
      window.__coneCutHook = hook;
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    page.setDefaultTimeout(0);
    let sc = null;
    if (o.sc) {
      mkdirSync(o.sc, { recursive: true });
      const cdp = await ctx.newCDPSession(page);
      sc = { n: 0, list: [] };
      cdp.on('Page.screencastFrame', (f) => {
        const k = sc.n++;
        writeFileSync(join(o.sc, `${String(k).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
        sc.list.push([k, f.metadata.timestamp, Date.now()]);
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: o.scq || 75, everyNthFrame: 1 });
    }
    const sp = o.speed === 'none' || o.speed == null ? '' : `&speed=${o.speed}`;
    const url = o.play ? `${base}index.html?mission=${o.mission}` : o.ui ? `${base}index.html?debug` : `${base}index.html?debug&walkthrough=${o.mission}${sp}`;
    const t0 = Date.now();
    await page.goto(url, { timeout: 180000 });
    if (o.ui && !o.play) {
      const b = page.locator(`#dbg-select .dbg-wt[data-walkthrough="${o.mission}"]`);
      await b.waitFor({ timeout: 120000 });
      await page.waitForTimeout(400);
      await b.click();
    }
    if (!o.play && o.start != null && o.start >= 0) {
      await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]'), null, { timeout: 240000 });
      await page.waitForTimeout(o.start * 1000);
      await page.locator('#wt-card [data-act=start]').click().catch(() => {});
    }
    if (o.play) {
      // normal play: the loading screen, the briefing (its tour over the live map), then Esc — START MISSION — as a player
      await page.waitForFunction(() => window.shadowSix?.world && !window.shadowSix.building && window.shadowSix.state === 'briefing', null, { timeout: 300000 }).catch(() => {});
      await page.waitForTimeout((o.start ?? 3) * 1000);
      for (let i = 0; i < 6 && (await page.evaluate(() => window.shadowSix.state)) !== 'playing'; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(800); }
    }
    if (o.after != null) {
      // until play has run `after` s of wall time (the sim clock past its first tick), or `secs` in all
      await page.waitForFunction(() => (window.shadowSix?.world?.time ?? 0) > 0 && window.shadowSix.state === 'playing', null, { timeout: 240000 }).catch(() => {});
      await page.waitForTimeout(o.after * 1000);
    } else {
      const left = o.secs * 1000 - (Date.now() - t0);
      if (left > 0) await page.waitForTimeout(left);
    }
    // the last frames' readbacks land in a frame or two
    await page.waitForTimeout(300);
    const res = await page.evaluate(() => { const P = window.__flk; P.on = false; return { frames: P.frames.filter((f) => f.px), outside: P.outside, err: P.err, n: P.n, origin: performance.timeOrigin, cloth: P.cloth, coneCut: window.__coneCut || null }; });
    if (sc) writeFileSync(join(o.sc, 'index.json'), JSON.stringify({ origin: res.origin, frames: sc.list }));
    // (the grid: the thumbnail's own pixels — 80 × 45 at 1280 × 720, a phone's canvas halves to its own size)
    const f0 = res.frames[0], grid = o.grid || (f0 ? [f0.w, f0.h] : [80, 45]);
    const det = detectFlicker(res.frames, { grid, T: o.T ?? 16, hidden: (m) => m.ld >= 0.99 || m.b === 1 });
    return { ...res, ...det, errs, url, sc: sc ? { dir: o.sc, n: sc.n } : null };
  } finally {
    await browser.close();
    await server?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mission = arg('mission', 'm02');
  const size = arg('size', '1280x720').split('x').map(Number);
  const tag = arg('tag', `${mission}-${arg('speed', 'auto')}${has('phone') ? '-phone' : ''}${has('ui') ? '-ui' : ''}${has('play') ? '-play' : ''}`);
  const out = resolve(arg('out', join(HERE, 'tests/out/flicker')));
  mkdirSync(out, { recursive: true });
  const r = await captureOpening({
    mission, speed: arg('speed', 'auto'), size, phone: has('phone'), secs: +arg('secs', 40), ui: has('ui'), start: arg('start', null) == null ? null : +arg('start'),
    play: has('play'), base: arg('base', ''), root: arg('root', ''), sc: has('sc') ? join(out, `${tag}-sc`) : null, T: +arg('T', 16),
    after: arg('after', null) == null ? null : +arg('after'), maxW: +arg('maxW', 80), grid: arg('grid', '') ? arg('grid').split('x').map(Number) : null, nocones: has('nocones'),
  });
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(r));
  const tot = r.frames.length, ivs = r.frames.slice(1).map((f, i) => f.t - r.frames[i].t).sort((a, b) => a - b);
  console.log(`${tag}: ${tot} frames (game frames ${r.n}), interval p50 ${ivs[ivs.length >> 1]?.toFixed(1)} p95 ${ivs[Math.floor(ivs.length * 0.95)]?.toFixed(1)} max ${ivs.at(-1)?.toFixed(1)} ms; ${r.events.length} flicker events; cloth velocity max ${r.cloth?.max} m/s (${r.cloth?.n} uploads > 30);${r.coneCut ? ` cones: ${r.coneCut.cut} cone-frames with a slice missing of ${r.coneCut.frames} frames${r.coneCut.at.length ? ` (${r.coneCut.at.join(', ')})` : ''};` : ''} ${r.outside.length} draws outside frames; alternating cells ${JSON.stringify(r.alternating)}${r.err ? ` probe error ${r.err}` : ''}${r.errs.length ? ` page errors ${r.errs.length}: ${r.errs[0]}` : ''}`);
  if (!has('quiet')) for (const e of r.events.slice(0, 40)) console.log('  ' + describe(e, r.stats.grid[1]));
  if (r.outside.length) for (const d of r.outside.slice(0, 8)) console.log(`  outside ${d.kind} frame ${d.frame} t ${d.t}: ${d.st}`);
}
