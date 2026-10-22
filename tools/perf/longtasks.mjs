#!/usr/bin/env node
/**
 * Main-thread long tasks during play: the mission's walkthrough (debug VIDEO MODE, the solution played live in real
 * time) runs for `--secs`, recording every long task (PerformanceObserver 'longtask', > 50 ms), the rAF frame
 * intervals, and a CPU profile; each long task is attributed to the functions sampled inside it (self time).
 *
 *   node tools/perf/longtasks.mjs [--mission=m03] [--preset=high] [--secs=90] [--speed=1] [--root=<checkout>] [--phone]
 *        [--out=file.json] [--query=&extra=url&params]
 */
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const mission = arg('mission', 'm03'), preset = arg('preset', 'high'), secs = +arg('secs', 90);
const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const phone = process.argv.includes('--phone');
const ctx = await browser.newContext(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.33 Mobile Safari/537.36', viewport: { width: 839, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } : { viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(() => {
  window.__lt = { tasks: [], frames: [], on: false };
  try {
    new PerformanceObserver((l) => { if (window.__lt.on) for (const e of l.getEntries()) window.__lt.tasks.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: false });
  } catch { /* unsupported */ }
  // who links programs during play: the JS stack at gl.linkProgram (frames outside three)
  window.__lt.links = [];
  Error.stackTraceLimit = 60;
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (p) {
    if (window.__lt.on) {
      const st = (new Error().stack || '').split('\n').slice(1).map((l) => l.trim()).filter((l) => !/vendor\/|linkProgram/.test(l)).slice(0, 4).map((l) => l.replace(/^at /, '').replace(/https?:\/\/[^/]+\//, ''));
      window.__lt.links.push({ t: performance.now(), st });
    }
    return link.call(this, p);
  };
  let last = 0, nProg = -1;
  window.__lt.progs = [];
  const f = (now) => {
    if (window.__lt.on && last) window.__lt.frames.push(now - last);
    last = now;
    // programs created since the last frame (three compiles on first use): which shader, which material
    const P = window.shadowSix?.renderer?.renderer?.info?.programs;
    if (P) {
      if (window.__lt.on && nProg >= 0 && P.length > nProg) for (const p of P.slice(nProg)) window.__lt.progs.push({ t: now, name: p.name, key: String(p.cacheKey).slice(0, 160) });
      nProg = P.length;
    }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
await page.goto(`${server.url.replace(/\/$/, '')}/index.html?debug&walkthrough=${mission}&preset=${preset}${arg('query', '')}`, { timeout: 180000 });
await page.waitForFunction(() => window.shadowSix?.world && !window.shadowSix.building && window.shadowSix.state === 'playing', null, { timeout: 240000 });
await page.waitForTimeout(3000); // first frames (programs, uploads) are the loading screen's business
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
const pn0 = await page.evaluate(() => performance.now());
await cdp.send('Profiler.start');
await page.evaluate(() => { window.__lt.on = true; });
const t0 = await page.evaluate(() => performance.now());
await page.waitForTimeout(secs * 1000);
const lt = await page.evaluate(() => { window.__lt.on = false; return { tasks: window.__lt.tasks, frames: window.__lt.frames, progs: window.__lt.progs, links: window.__lt.links, state: window.shadowSix.state, time: window.shadowSix.world?.time }; });
const { profile } = await cdp.send('Profiler.stop');
// profile timestamps are µs on the same monotonic clock as performance.now() + timeOrigin (ms)
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
// profile clock (µs, monotonic) → page performance.now(): the profile starts right after pn0 was read
const off = profile.startTime / 1000 - pn0;
let ts = profile.startTime;
const samples = profile.samples.map((id, i) => { ts += profile.timeDeltas[i]; return { id, t: ts / 1000 - off }; });
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
/** First caller outside three / the browser (the game code responsible). */
const owner = (id) => { for (let p = id; p != null; p = parent.get(p)) { const n = byId.get(p); if (n.callFrame.url && !/vendor\//.test(n.callFrame.url)) return key(n); } return key(byId.get(id)); };
const attrib = (a, b) => {
  const m = new Map(), o = new Map();
  for (const s of samples) if (s.t >= a && s.t <= b) { const k = key(byId.get(s.id)); m.set(k, (m.get(k) || 0) + 1); const w = owner(s.id); o.set(w, (o.get(w) || 0) + 1); }
  return [...[...m].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ×${v}`), ...[...o].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `OWNER ${k} ×${v}`)];
};
// all long-task time by function and by file (self samples)
const inLong = (t) => lt.tasks.some((x) => t >= x.t && t <= x.t + x.d);
const byFn = new Map(), byFile = new Map();
let nLong = 0;
for (const s of samples) {
  if (!inLong(s.t)) continue;
  nLong++;
  const n = byId.get(s.id), k = key(n), f = n.callFrame.url.split('/').slice(-2).join('/') || n.callFrame.functionName;
  byFn.set(k, (byFn.get(k) || 0) + 1); byFile.set(f, (byFile.get(f) || 0) + 1);
}
const share = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${(100 * v / Math.max(1, nLong)).toFixed(1)}% ${k}`);
const fr = lt.frames.slice().sort((a, b) => a - b);
const q = (p) => (fr.length ? +fr[Math.min(fr.length - 1, Math.floor(fr.length * p))].toFixed(1) : null);
const rep = {
  mission, preset, phone, secs, root: ROOT, simTime: lt.time, state: lt.state,
  frames: { n: fr.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over50: fr.filter((x) => x > 50).length, over100: fr.filter((x) => x > 100).length },
  longTasks: { n: lt.tasks.length, total: +lt.tasks.reduce((s, x) => s + x.d, 0).toFixed(0), max: +Math.max(0, ...lt.tasks.map((x) => x.d)).toFixed(0) },
  inLongTasks: { byFile: share(byFile), byFunction: share(byFn) },
  programsCompiledDuringPlay: lt.progs.map((p) => `${((p.t - t0) / 1000).toFixed(1)}s ${p.name} | ${p.key}`),
  programLinksDuringPlay: lt.links.map((l) => `${((l.t - t0) / 1000).toFixed(1)}s ${l.st.join(' < ')}`),
  timeline: lt.tasks.map((x) => [+((x.t - t0) / 1000).toFixed(1), +x.d.toFixed(0), (() => { let c = 0, n = 0; for (const s of samples) if (s.t >= x.t && s.t <= x.t + x.d) { n++; if (/InfoLog|getProgramParameter|getShaderParameter/.test(byId.get(s.id).callFrame.functionName)) c++; } return n ? +(c / n).toFixed(2) : null; })()]),
  worst: lt.tasks.sort((a, b) => b.d - a.d).slice(0, 12).map((x) => ({ at: +((x.t - t0) / 1000).toFixed(1), ms: +x.d.toFixed(0), top: attrib(x.t, x.t + x.d) })),
  errors: errs.slice(0, 5),
};
console.log(JSON.stringify(rep, null, 1));
if (arg('out', '')) writeFileSync(arg('out'), JSON.stringify(rep, null, 1));
await browser.close(); await server.close();
