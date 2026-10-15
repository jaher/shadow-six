#!/usr/bin/env node
/**
 * The walkthrough as the user watches it: a cold browser opens `?debug&walkthrough=<id>` (AUTO by default) on the live
 * site or a local checkout and plays it from the first byte to the end card — the load, the title card (it starts by
 * itself after 9 s, as for the user), every chapter card, the action holds, the fast waits, the blasts. Recorded:
 * every displayed frame (wall interval, what it spent on ticks / the draw / the solution driver between ticks, the GPU
 * time of its draw with --gpu), the phase on screen, every long task, a CPU profile of the whole run, and the shader
 * programs linked after the title card. Every frame over --over ms (50) is listed with its phase and what ran in it.
 *
 *   node tools/perf/wt-user.mjs [--url=https://jaher.github.io/shadow-six/] [--root=<checkout>] [--mission=m03]
 *        [--speed=auto|4|…] [--size=1920x1080] [--headed] [--gpu] [--over=50] [--interval=1000] [--json=out.json]
 *        [--secs=N (stop after N s of play)] [--noprofile]
 * Headless (the GPU through ANGLE/GL) unless --headed (DISPLAY: the machine's screen; on a locked or blanked screen
 * Chrome draws no frames and the load stalls).
 */
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => argv.includes(`--${k}`);
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const mission = arg('mission', 'm03'), speed = arg('speed', 'auto'), over = +arg('over', 50), secs = +arg('secs', 0);
const [vw, vh] = arg('size', '1920x1080').split('x').map(Number);
let server = null, base = arg('url', '');
if (!base) {
  const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
  server = await startServer({ port: 0, root: resolve(arg('root', HERE)) });
  base = server.url;
}
base = base.replace(/\/$/, '').replace(/\/index\.html$/, '');
const url = `${base}/${server ? 'index.html' : ''}?debug&walkthrough=${mission}${speed === 'auto' ? '' : `&speed=${speed}`}`;
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: !has('headed'), args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
const gpu = has('gpu');
await ctx.addInitScript((gpuOn) => {
  const P = (window.__wu = { frames: [], longs: [], progs: [], links: [], last: 0, cur: null, nProg: -1, gpu: [] });
  globalThis.__simT = () => window.shadowSix?.world?.time ?? -1; // (for instrumented builds: globalThis.__clipLog etc.)
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longs.push([+e.startTime.toFixed(1), +e.duration.toFixed(1), +(window.shadowSix?.world?.time ?? 0).toFixed(2)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  const phase = () => {
    const g = window.shadowSix, r = g?.debug?.mode?.replay;
    if (document.querySelector('#wt-card[data-kind=end]')) return 'end';
    if (!r) return g?.world ? 'nowalk' : 'load';
    if (r._introOn) return 'title';
    if (r.pacer?.turbo) return 'ff';
    if (r.hold && r._held?.() && r.hold.kind === 'chapter') return 'card';
    if (r.hold && r._held?.()) return `hold:${r.hold.kind}`;
    if (r.actionHold?.active || r._actionHeld?.()) return 'action';
    return 'play';
  };
  const f = (now) => {
    const g = window.shadowSix, r = g?.debug?.mode?.replay;
    if (P.last && P.cur) {
      const c = P.cur;
      P.frames.push([+now.toFixed(1), +(now - P.last).toFixed(2), phase(), +c.sim.toFixed(2), c.n, +c.render.toFixed(2), +c.gap.toFixed(2),
        +(g?.world?.time ?? 0).toFixed(2), r?.chapterId ?? '-', r?.step?.cp ?? '-', r ? (r.auto ? 'A' : r.pacer?.speed) : '-', +(r?.pacer?.boost ?? 1).toFixed(2), -1, c.t0]);
    }
    P.last = now;
    P.cur = { sim: 0, n: 0, render: 0, gap: 0, lastEnd: -1, t0: +now.toFixed(1) };
    const progs = g?.renderer?.renderer?.info?.programs;
    if (progs) {
      if (P.nProg >= 0 && progs.length > P.nProg) for (const p of progs.slice(P.nProg)) P.progs.push({ t: +now.toFixed(1), sim: +(g.world?.time ?? 0).toFixed(2), phase: phase(), key: String(p.cacheKey).slice(0, 100) });
      P.nProg = progs.length;
    }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  Error.stackTraceLimit = 40;
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (prog) {
    const st = (new Error().stack || '').split('\n').slice(1).map((l) => l.trim()).filter((l) => !/vendor\/|three\.module|linkProgram/.test(l)).slice(0, 4).map((l) => l.replace(/^at /, '').replace(/https?:\/\/[^/]+\//, ''));
    P.links.push({ t: +performance.now().toFixed(1), sim: +(window.shadowSix?.world?.time ?? 0).toFixed(2), st });
    return link.call(this, prog);
  };
  const hook = setInterval(() => {
    const g = window.shadowSix;
    if (!g || g.__wuHooked || typeof g.step !== 'function' || !g.renderer?.renderer) return;
    g.__wuHooked = true;
    const step = g.step, render = g.render;
    g.step = function (...a) {
      const s = performance.now(), c = P.cur;
      if (c && c.lastEnd >= 0) c.gap = Math.max(c.gap, s - c.lastEnd);
      try { return step.apply(this, a); } finally { const e = performance.now(); if (c) { c.sim += e - s; c.n++; c.lastEnd = e; } }
    };
    // GPU time of the frame's draw (EXT_disjoint_timer_query_webgl2), read back a few frames later
    const gl = g.renderer.renderer.getContext(), ext = gpuOn ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null, pend = [];
    g.render = function (...a) {
      const s = performance.now(), c = P.cur;
      let q = null;
      if (ext && !P.qBusy) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); P.qBusy = true; }
      try { return render.apply(this, a); } finally {
        if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); P.qBusy = false; pend.push([q, c]); }
        if (c) c.render += performance.now() - s;
        for (let i = pend.length - 1; i >= 0; i--) {
          const [qq, cc] = pend[i];
          if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && cc) P.gpu.push([cc.t0, +(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6).toFixed(2)]); gl.deleteQuery(qq); pend.splice(i, 1); }
        }
      }
    };
    clearInterval(hook);
  }, 5);
}, gpu);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.setDefaultTimeout(0);
const cdp = await ctx.newCDPSession(page);
const profile = !has('noprofile');
if (profile) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: +arg('interval', 1000) });
  await cdp.send('Profiler.start');
}
const tNav = Date.now();
await page.goto(url, { timeout: 300000 });
// the run: the title card starts by itself; to the end card (or --secs of play)
let playFrom = 0, titleAt = 0, lastLog = 0;
for (;;) {
  // (the title card: a user reads it a moment, then presses Start — it also starts by itself unless the link waits)
  const title = await page.evaluate(() => !!window.shadowSix?.debug?.mode?.replay?._introOn).catch(() => false);
  if (title && !titleAt) titleAt = Date.now();
  if (title && Date.now() - titleAt > +arg('read', 4) * 1000) await page.locator('#wt-card [data-act=start]').click({ timeout: 5000 }).catch(() => {});
  const s = await page.evaluate(() => {
    const g = window.shadowSix, r = g?.debug?.mode?.replay;
    return { end: !!document.querySelector('#wt-card[data-kind=end]') || g?.state === 'won' || g?.state === 'lost', playing: !!r && !r._introOn, t: g?.world?.time ?? 0, gone: !!g?.debug?.mode?.lastWalkthrough && !r };
  }).catch(() => ({ end: false }));
  if (s.playing && !playFrom) playFrom = Date.now();
  if (Date.now() - lastLog > 30000) { lastLog = Date.now(); process.stderr.write(`[wt-user] ${((Date.now() - tNav) / 1000).toFixed(0)} s: ${title ? 'title' : s.playing ? `play t=${(+s.t).toFixed(1)}` : 'loading'}\n`); }
  if (s.end || s.gone) { await page.waitForTimeout(4000); break; }
  if (secs > 0 && playFrom && Date.now() - playFrom > secs * 1000) break;
  if (Date.now() - tNav > 3600_000) break;
  await page.waitForTimeout(1000);
}
const lt = await page.evaluate(() => ({ probe: globalThis.__clipLog || null, gpu: window.__wu.gpu, frames: window.__wu.frames, longs: window.__wu.longs, progs: window.__wu.progs, links: window.__wu.links, res: window.shadowSix?.debug?.mode?.lastWalkthrough || null, time: window.shadowSix?.world?.time }));
let attrib = () => [];
let windowTop = null;
if (profile) {
  // sample times are the profiler's monotonic µs; the page's performance.now() is the same clock less its origin: the
  // last sample is taken as the moment of the performance.now() read just before Profiler.stop
  const nowMs = await page.evaluate(() => performance.now()).catch(() => 0);
  const { profile: prof } = await cdp.send('Profiler.stop');
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  let ts = prof.startTime;
  const samples = prof.samples.map((id, i) => { ts += prof.timeDeltas[i]; return { id, t: ts / 1000 }; });
  const delta = samples.length ? samples[samples.length - 1].t - nowMs : 0;
  for (const s of samples) s.t -= delta;
  const parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const chain = (id) => { const out = []; for (let p = id; p != null; p = parent.get(p)) { const n = byId.get(p); if (n.callFrame.url && !/vendor\/|three\.module/.test(n.callFrame.url)) out.push(n); } return out; };
  attrib = (a, b, nSelf = 4, nIncl = 8) => {
    const self = new Map(), incl = new Map();
    let tot = 0;
    for (const s of samples) {
      if (s.t < a || s.t > b) continue;
      tot++;
      const k = key(byId.get(s.id)); self.set(k, (self.get(k) || 0) + 1);
      const seen = new Set();
      for (const n of chain(s.id)) { const kk = key(n); if (seen.has(kk)) continue; seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + 1); }
    }
    if (!tot) return [];
    return [...[...self].sort((x, y) => y[1] - x[1]).slice(0, nSelf).map(([k, v]) => `self ${(100 * v / tot).toFixed(0)}% ${k}`),
      ...[...incl].sort((x, y) => y[1] - x[1]).slice(0, nIncl).map(([k, v]) => `incl ${(100 * v / tot).toFixed(0)}% ${k}`)];
  };
  const self = new Map();
  for (const s of samples) { const k = key(byId.get(s.id)); self.set(k, (self.get(k) || 0) + 1); }
  windowTop = [...self].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${(100 * v / samples.length).toFixed(1)}% ${k}`);
}
await browser.close(); if (server) await server.close();
// frames: [now, interval, phase, simMs, ticks, renderMs, gapMs, simTime, chapter, cp, speed, boost, gpuMs, frameStart]
const F = lt.frames;
{ const gm = new Map(lt.gpu.map(([t, ms]) => [t, ms])); for (const f of F) { const v = gm.get(f[13]); if (v !== undefined) f[12] = v; } }
const stats = (arr) => { const a = arr.slice().sort((x, y) => x - y), q = (p) => (a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : null); return { n: a.length, mean: a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null, p50: q(0.5), p99: q(0.99), max: q(1), over33: a.filter((x) => x > 33.4).length, over50: a.filter((x) => x > 50).length }; };
const byPhase = {}, byChapter = {};
let titleSeen = false;
for (const f of F) {
  if (f[2] === 'title') titleSeen = true;
  (byPhase[f[2]] ||= []).push(f[1]);
  if (titleSeen && f[2] !== 'title' && f[2] !== 'load') (byChapter[f[8]] ||= []).push(f[1]);
}
const afterTitle = [];
{ let seen = false, past = false; for (const f of F) { if (f[2] === 'title') seen = true; else if (seen) past = true; if (past && f[2] !== 'load') afterTitle.push(f); } }
const slow = afterTitle.filter((f) => f[1] > over).map((f) => ({ at: +((f[0]) / 1000).toFixed(2), ms: f[1], phase: f[2], sim: f[3], ticks: f[4], render: f[5], gap: f[6], gpu: f[12], t: f[7], ch: f[8], cp: f[9], speed: f[10], boost: f[11], top: attrib(f[0] - f[1], f[0], 3, 6) }));
const longs = lt.longs.slice().sort((a, b) => b[1] - a[1]);
const rep = {
  url, size: `${vw}x${vh}`, headless: !has('headed'), speed, simTime: lt.time,
  result: lt.res && { outcome: lt.res.outcome, state: lt.res.state, time: lt.res.time, detections: lt.res.detections, exposures: lt.res.exposures },
  afterTitle: stats(afterTitle.map((f) => f[1])),
  afterTitleGpu: stats(afterTitle.filter((f) => f[12] >= 0).map((f) => f[12])),
  phases: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, stats(v)])),
  chapters: Object.fromEntries(Object.entries(byChapter).map(([k, v]) => [k, stats(v)])),
  longTasks: { n: longs.length, over100: longs.filter((x) => x[1] > 100).length, max: longs[0]?.[1] ?? 0, worst: longs.slice(0, 25).map((x) => ({ at: +(x[0] / 1000).toFixed(2), ms: x[1], t: x[2], top: attrib(x[0], x[0] + x[1], 3, 6) })) },
  slowFrames: slow,
  programsAfterTitle: lt.progs.filter((p) => p.phase !== 'load' && p.phase !== 'title').map((p) => `${(p.t / 1000).toFixed(1)}s sim ${p.sim} ${p.phase} ${p.key}`),
  linksAfterLoad: lt.links.filter((l) => l.sim > 0).slice(0, 40).map((l) => `${(l.t / 1000).toFixed(1)}s sim ${l.sim} ${l.st.join(' < ')}`),
  cpuTop: windowTop, errors: errs.slice(0, 8), probe: lt.probe,
};
console.log(JSON.stringify({ ...rep, slowFrames: rep.slowFrames.slice(0, 30), longTasks: { ...rep.longTasks, worst: rep.longTasks.worst.slice(0, 12) } }, null, 1));
if (arg('json', '')) writeFileSync(arg('json'), JSON.stringify({ ...rep, frameLog: F, longLog: lt.longs }, null, 0));
