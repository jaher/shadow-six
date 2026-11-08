#!/usr/bin/env node
/**
 * Capture the title splash mid-pass of the Spitfire formation (src/ui/splash-planes.js): stills, a zoomed crop of
 * the formation, or a screencast of one full pass (frames + timestamps for ffmpeg). Math.random is seeded, so two
 * builds captured at the same pass time show the same corridor, sticks and bursts (before/after pairs).
 *
 *   node tools/ui/splash/capture_planes.mjs --url=http://127.0.0.1:8080/ --out=/tmp/shot --w=1920 --h=1080 --dpr=1 \
 *        [--t=6.5 | --at=release | --at=impact[:n[:seconds after it]] | --strip=n] [--touch] [--clip=<dir>] [--ready] [--before=<git ref>]
 *   --strip=n: three crops of the n-th impact (before / flash peak / +0.5 s) as <out>.s1-3.png, + <out>.peak.png;
 *   --clip records the whole pass as JPEG frames + frames.txt instead (--clipw: frame width, default 1280);
 *   --ready waits for the sprite atlas;
 *   --before flies that revision's src/ui/splash-planes.js (before/after pairs from one checkout).
 *
 * Writes <out>.png (full view), <out>.crop.png (the formation box) and <out>.json (leader box, layout).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const W = +(arg.w || 1920), H = +(arg.h || 1080), DPR = +(arg.dpr || 1), T = +(arg.t || 6.5);
const touch = !!arg.touch, url = arg.url || 'http://127.0.0.1:8080/', out = arg.out || '/tmp/splash';
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({
  executablePath: process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`,
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: touch, hasTouch: touch });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('shadowsix.intro.seen', '1'); } catch { /* private */ }
    let s = 0x9e3779b9; // mulberry32, reseeded right before the pass: same corridor / sticks / bursts on every capture
    window.__reseed = () => { s = 0x9e3779b9; };
    Math.random = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  });
  if (arg.before) { // --before=<git ref>: fly that revision's splash-planes.js (the before shots) on today's page
    const { execFileSync } = await import('node:child_process');
    const body = execFileSync('git', ['-C', ROOT, 'show', `${arg.before}:src/ui/splash-planes.js`]);
    await ctx.route('**/src/ui/splash-planes.js', (r) => r.fulfill({ body, contentType: 'text/javascript' }));
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('pageerror', e.message));
  await p.goto(url);
  // skip the disclaimer (a click once its lock has passed), then wait for the splash, its hero and plate
  for (let i = 0; i < 40; i++) {
    const ph = await p.evaluate(() => window.shadowSix?.hud?.boot?.phase);
    if (ph === 'splash') break;
    if (ph === 'disclaimer' || ph === 'ident') await p.mouse.click(W / 2, H / 2).catch(() => {});
    await p.waitForTimeout(250);
  }
  await p.waitForFunction(() => { const i = document.querySelector('.bt-l.hero'), s = document.querySelector('.bt-l.sky'); return i?.complete && i.naturalHeight > 0 && s?.complete && s.naturalWidth > 0; }, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  if (arg.ready) await p.waitForFunction(() => window.shadowSix.hud.boot.planes?.ready !== false, null, { timeout: 20000 }).catch(() => {});
  const cdp = arg.clip ? await ctx.newCDPSession(p) : null;
  const frames = [];
  if (cdp) {
    mkdirSync(arg.clip, { recursive: true });
    cdp.on('Page.screencastFrame', async (f) => {
      const n = frames.length;
      writeFileSync(join(arg.clip, `f${String(n).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
      frames.push(f.metadata.timestamp);
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: +(arg.clipw || 1280), maxHeight: +(arg.clipw || 1280), everyNthFrame: 1 });
    await p.waitForTimeout(600);
  }
  await p.evaluate(() => { const pl = window.shadowSix.hud.boot.planes; clearTimeout(pl._timer); window.__reseed(); pl.pass(); });
  if (cdp) {
    await p.waitForFunction(() => !window.shadowSix.hud.boot.planes._pass, null, { timeout: 60000, polling: 250 });
    await p.waitForTimeout(400);
    await cdp.send('Page.stopScreencast');
    // frames can arrive slightly out of order: list them by timestamp (concat wants positive durations)
    const order = frames.map((ts, i) => [ts, i]).sort((a, b) => a[0] - b[0]);
    const name = (i) => `f${String(i).padStart(5, '0')}.jpg`;
    const lines = order.map(([ts, i], k) => `file '${name(i)}'\nduration ${Math.max(0.001, (order[k + 1]?.[0] ?? ts + 1 / 30) - ts).toFixed(4)}`);
    writeFileSync(join(arg.clip, 'frames.txt'), lines.join('\n') + `\nfile '${name(order.at(-1)[1])}'\n`);
    console.log(`clip: ${frames.length} frames over ${(frames.at(-1) - frames[0]).toFixed(1)} s -> ${arg.clip}`);
  } else if (arg.strip) {
    // the n-th impact as three exact frames: run until its bomb is ~0.12 s from the ground, then cancel the layer's
    // rAF and step it by hand (30 Hz, as its own loop does): before / the flash at its peak / 0.5 s later
    const n = +arg.strip, step = (until) => p.evaluate(([n, until]) => {
      const pl = window.shadowSix.hud.boot.planes;
      for (let i = 0; i < 300 && !(pl._booms.length >= n && pl._booms[n - 1].t >= until); i++) pl._step(1 / 30);
      const b = pl._booms[n - 1];
      return { t: pl._pass.t, boomT: b?.t };
    }, [n, until]);
    await p.waitForFunction((n) => { const pl = window.shadowSix.hud.boot.planes; return pl._booms?.length === n - 1 && pl._bombs.some((b) => b.t >= 1.78); }, n, { timeout: 60000, polling: 'raf' });
    const box = await p.evaluate(() => {
      const pl = window.shadowSix.hud.boot.planes; cancelAnimationFrame(pl._raf);
      const lay = pl._lay, bx = pl._bombs.reduce((a, b) => (b.t > a.t ? b : a)).x, r = pl.canvas.getBoundingClientRect(), sx = r.width / lay.w, sy = r.height / lay.h;
      const x0 = bx - 0.16 * lay.w, y0 = lay.horizon - 0.42 * lay.h;
      return { x: Math.max(0, r.left + x0 * sx), y: Math.max(0, r.top + y0 * sy), width: 0.32 * lay.w * sx, height: 0.47 * lay.h * sy };
    });
    const clip = { ...box, width: Math.min(W - box.x, box.width), height: Math.min(H - box.y, box.height) };
    const frames = [];
    for (const [k, until] of [['s1', -1], ['s2', 0.05], ['s3', 0.55]]) {
      if (until >= 0) frames.push(await step(until));
      await p.waitForTimeout(80);
      await p.screenshot({ path: `${out}.${k}.png`, clip });
      if (k === 's2') await p.screenshot({ path: `${out}.peak.png` });
    }
    writeFileSync(`${out}.json`, JSON.stringify({ box: clip, frames }, null, 1));
    console.log(JSON.stringify({ box: clip, frames }));
  } else {
    // run to the moment (pass time T, a release, or the n-th impact), then freeze the layer (cancel its rAF) so the
    // shot and the crop agree. --at=release: the leader's pair just off its wings; --at=impact[:n]: n-th burst's flash
    const at = String(arg.at || ''), nth = +(at.split(':')[1] || 1), bt = +(at.split(':')[2] || 0.09);
    await p.waitForFunction(([T, at, nth, bt]) => {
      const pl = window.shadowSix.hud.boot.planes;
      if (at === 'release') return pl._bombs?.length >= 2 && pl._bombs[1].t >= 0.14;
      if (at.startsWith('impact')) return pl._booms?.length >= nth && pl._booms[nth - 1].t >= bt;
      return (pl._pass?.t || 0) >= T;
    }, [T, at, nth, bt], { timeout: 60000, polling: 'raf' });
    const info = await p.evaluate(([at, nth]) => {
      const pl = window.shadowSix.hud.boot.planes; cancelAnimationFrame(pl._raf);
      const lay = pl._lay, t = pl._pass.t, lead = -0.30 * lay.w + lay.v * t;
      const r = pl.canvas.getBoundingClientRect(), sx = r.width / lay.w, sy = r.height / lay.h;
      let x0 = lead - 4.2 * lay.s, x1 = lead + 0.8 * lay.s, y0 = lay.cy - 1.0 * lay.s, y1 = lay.cy + 1.0 * lay.s;
      if (at === 'release') { x0 = lead - 1.6 * lay.s; x1 = lead + 0.9 * lay.s; y0 = lay.cy - 0.7 * lay.s; y1 = lay.cy + 1.3 * lay.s; }
      if (at.startsWith('impact')) {
        const bx = pl._booms[nth - 1].x;
        x0 = bx - 0.16 * lay.w; x1 = bx + 0.16 * lay.w; y0 = lay.horizon - 0.42 * lay.h; y1 = lay.horizon + 0.05 * lay.h;
      }
      return { t, s: lay.s, cy: lay.cy, lead, drops: !!lay.drops, bombs: pl._bombs.length, booms: pl._booms.length,
        box: { x: r.left + x0 * sx, y: r.top + y0 * sy, width: (x1 - x0) * sx, height: (y1 - y0) * sy } };
    }, [at, nth]);
    await p.waitForTimeout(120);
    await p.screenshot({ path: `${out}.png` });
    const b = info.box, cx = Math.max(0, b.x), cy = Math.max(0, b.y);
    await p.screenshot({ path: `${out}.crop.png`, clip: { x: cx, y: cy, width: Math.min(W - cx, b.width - (cx - b.x)), height: Math.min(H - cy, b.height - (cy - b.y)) } });
    writeFileSync(`${out}.json`, JSON.stringify(info, null, 1));
    console.log(JSON.stringify(info));
  }
} finally {
  await browser.close();
}
