#!/usr/bin/env node
/**
 * Video mode frame times (debug walkthrough played live, the way the user watches it): opens
 * `?debug&walkthrough=<id>&speed=<s>`, starts it (optionally jumping to a checkpoint first), and records every displayed
 * frame — its wall interval, the sim time, the step on screen, how many ticks ran in it and what the frame spent on
 * them (Game.step), on the draw (Game.render) and on the rest (the solution driver's own look-ahead between ticks, the
 * director) — plus a CPU profile to name what the slowest frames ran, and the programs three compiled during play.
 *
 *   node tools/perf/wt-frames.mjs [--mission=m03] [--speed=4] [--from=G3] [--to=G5|--secs=120] [--root=<checkout>]
 *        [--size=1920x1080] [--json=out.json] [--top=20] [--noprofile] [--shots=<dir>] [--preset=medium] [--phone]
 *        [--ramp=1,4 --rampSec=6] [--interval=500]
 *
 * --from: a checkpoint (G3) or chapter (stage:G) to jump to first (fast-forward, not measured); --to: stop at that
 * checkpoint / chapter (default: --secs of wall time, or the walkthrough's end).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const mission = arg('mission', 'm03'), speed = arg('speed', '4') === 'auto' ? 'auto' : +arg('speed', 4), secs = +arg('secs', 0), from = arg('from', ''), to = arg('to', '');
const [vw, vh] = arg('size', '1920x1080').split('x').map(Number);
const marker = (s) => (!s ? null : s.startsWith('stage:') ? { kind: 'stage', id: s.slice(6) } : { kind: 'cp', id: s });
const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const phone = argv.includes('--phone'), preset = arg('preset', '');
const ctx = await browser.newContext(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.33 Mobile Safari/537.36', viewport: { width: 839, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } : { viewport: { width: vw, height: vh } });
await ctx.addInitScript(() => {
  const P = (window.__wf = { on: false, frames: [], progs: [], last: 0, nProg: -1, cur: null, longs: [] });
  // long tasks (anything holding the main thread > 50 ms, inside or between frames: GC, decode, a stall)
  try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.longs.push([+e.startTime.toFixed(1), +e.duration.toFixed(1), +(window.shadowSix?.world?.time ?? 0).toFixed(2)]); }).observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
  const f = (now) => {
    const g = window.shadowSix;
    if (P.on && P.last && P.cur) {
      const c = P.cur, r = g?.debug?.mode?.replay;
      P.frames.push([+(now - P.last).toFixed(2), +c.sim.toFixed(2), c.n, +c.render.toFixed(2), +c.gap.toFixed(2), +(g?.world?.time ?? 0).toFixed(2), r?.step?.cp ?? r?.chapterId ?? '-', r?.pacer?.turbo ? 1 : 0, +(r?.pacer?.boost ?? 1).toFixed(2), +performance.now().toFixed(1), r?.chapterId ?? '-', r?._introOn ? 1 : 0]);
    }
    P.last = now;
    P.cur = { sim: 0, n: 0, render: 0, gap: 0, lastEnd: -1 };
    const progs = g?.renderer?.renderer?.info?.programs;
    if (progs) {
      if (P.on && P.nProg >= 0 && progs.length > P.nProg) {
        // which drawn objects use the new programs (renderer.properties: a material's current program)
        const fresh = new Set(progs.slice(P.nProg)), who = new Map(), R = g.renderer.renderer, props = R.properties;
        const scenes = [g.renderer.scene, g.renderer.decalScene, g.renderer.xrayScene].filter(Boolean);
        for (const sc of scenes) sc.traverse((o) => {
          for (const m of [].concat(o.material || [])) {
            const pr = m && props.get(m)?.currentProgram;
            if (pr && fresh.has(pr) && !who.has(pr)) {
              const chain = []; for (let q = o; q && chain.length < 4; q = q.parent) chain.push(q.name || q.type);
              who.set(pr, `${m.type}${m.name ? ':' + m.name : ''} on ${chain.join(' < ')}`);
            }
          }
        });
        for (const p of progs.slice(P.nProg)) P.progs.push({ t: now, name: p.name, key: String(p.cacheKey).slice(0, 120), who: who.get(p) || '?' });
      }
      P.nProg = progs.length;
    }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  // who links shader programs during play (the JS stack at gl.linkProgram, outside three)
  P.links = [];
  Error.stackTraceLimit = 40;
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (prog) {
    if (P.on) {
      const st = (new Error().stack || '').split('\n').slice(1).map((l) => l.trim()).filter((l) => !/vendor\/|linkProgram|wt-frames/.test(l)).slice(0, 5).map((l) => l.replace(/^at /, '').replace(/https?:\/\/[^/]+\//, ''));
      const sc = P.curScene, kids = sc ? sc.children.slice(0, 6).map((c) => c.name || c.type).join(',') : '';
      P.links.push({ t: +(window.shadowSix?.world?.time ?? 0).toFixed(2), st: [`[scene ${sc?.name || sc?.type || '?'}: ${kids}]`, ...st] });
    }
    return link.call(this, prog);
  };
  // wrap the game's step / render once it exists (instance properties: the walkthrough calls this.game.step)
  const hook = setInterval(() => {
    const g = window.shadowSix;
    if (!g || g.__wfHooked || typeof g.step !== 'function') return;
    g.__wfHooked = true;
    const step = g.step, render = g.render;
    g.step = function (...a) {
      const s = performance.now(), c = P.cur;
      if (c && c.lastEnd >= 0) c.gap = Math.max(c.gap, s - c.lastEnd);
      try { return step.apply(this, a); } finally { const e = performance.now(); if (c) { c.sim += e - s; c.n++; c.lastEnd = e; } }
    };
    const R = g.renderer?.renderer, rr = R?.render;
    if (rr) R.render = function (scene, cam) { const prev = P.curScene; P.curScene = scene; try { return rr.call(this, scene, cam); } finally { P.curScene = prev; } };
    g.render = function (...a) {
      const s = performance.now();
      try { return render.apply(this, a); } finally { if (P.cur) P.cur.render += performance.now() - s; }
    };
    clearInterval(hook);
  }, 5);
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.setDefaultTimeout(0);
await page.goto(`${server.url.replace(/\/$/, '')}/index.html?debug&walkthrough=${mission}&speed=${speed}${preset ? `&preset=${preset}` : ''}`, { timeout: 180000 });
await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay, null, { timeout: 240000 });
await page.waitForTimeout(1500);
const m0 = marker(from);
if (m0) {
  await page.evaluate((m) => window.shadowSix.debug.mode.replay.jumpTo(m), m0);
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && !r.pacer.turbo && window.shadowSix.world.time > 1; }, null, { timeout: 900000 });
}
// the CPU profiler starts before the measured window (starting it stalls the page for a moment)
const profile = !argv.includes('--noprofile');
const cdp = await ctx.newCDPSession(page);
let pn0 = 0;
if (profile) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: +arg('interval', 500) });
  pn0 = await page.evaluate(() => performance.now());
  await cdp.send('Profiler.start');
}
await page.waitForTimeout(300);
if (!m0) await page.locator('#wt-card [data-act=start]').click();
const t0 = await page.evaluate(() => { const r = window.shadowSix.debug.mode.replay; r.hold = null; const sp = new URL(location.href).searchParams.get('speed'); if (sp === 'auto') r.setAuto?.(true); else r.setSpeed?.(+sp || 1); return performance.now(); });
// (after a jump: the first `settle` s are the cut's own business — chapter card, catch-up — not play)
const settle = m0 ? +arg('settle', 2) : 0;
await page.evaluate((ms) => { setTimeout(() => { window.__wf.on = true; window.__wf.last = 0; }, ms); }, settle * 1000);
const shotsDir = arg('shots', '');
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const m1 = marker(to);
const deadline = Date.now() + (secs > 0 ? secs * 1000 : 3600_000);
let lastShot = 0, nShot = 0;
// (--ramp=1,4[,…] [--rampSec=6]: the speed steps through those every rampSec s — AUTO's ramps between 1× and 4×)
const ramp = arg('ramp', '') ? arg('ramp').split(',').map((v) => (v === 'auto' ? v : +v)) : null, rampSec = +arg('rampSec', 6);
let rampAt = Date.now(), rampI = 0;
for (;;) {
  if (ramp && Date.now() - rampAt > rampSec * 1000) { rampAt = Date.now(); rampI = (rampI + 1) % ramp.length; await page.evaluate((v) => { const r = window.shadowSix.debug.mode.replay; if (v === 'auto') r?.setAuto?.(true); else r?.setSpeed?.(+v); }, ramp[rampI]); }
  const s = await page.evaluate((m) => {
    const g = window.shadowSix, r = g.debug.mode.replay;
    const done = !r || r.stopped || g.state === 'won' || g.state === 'lost' || !!document.querySelector('#wt-card[data-kind=end]');
    const hit = m && r && (m.kind === 'cp' ? r.doneCps.includes(m.id) : r.chapterId === m.id);
    return { done, hit, t: g.world?.time ?? 0, step: r?.step?.cp ?? null };
  }, m1);
  if (s.done || s.hit || Date.now() > deadline) break;
  if (shotsDir && Date.now() - lastShot > 1000) { lastShot = Date.now(); await page.screenshot({ path: join(shotsDir, `f${String(nShot++).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 70 }); }
  await page.waitForTimeout(500);
}
const audio = await page.evaluate(() => { const c = window.shadowSix?.audio?.engine?.ctx; const p = c?.playoutStats; return c ? { state: c.state, sampleRate: c.sampleRate, baseLatency: c.baseLatency, playout: p ? { fallbackFramesEvents: p.fallbackFramesEvents, fallbackFramesDuration: p.fallbackFramesDuration, totalFramesDuration: p.totalFramesDuration, underrunEvents: p.underrunEvents, underrunDuration: p.underrunDuration } : null } : null; });
const lt = await page.evaluate(() => { window.__wf.on = false; const r = window.shadowSix.debug.mode.replay || window.shadowSix.debug.mode.lastWalkthrough; return { frames: window.__wf.frames, progs: window.__wf.progs, links: window.__wf.links, longs: window.__wf.longs, time: window.shadowSix.world?.time, res: window.shadowSix.debug.mode.lastWalkthrough || null }; });
let attrib = () => [];
if (profile) {
  const { profile: prof } = await cdp.send('Profiler.stop');
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  const off = prof.startTime / 1000 - pn0;
  let ts = prof.startTime;
  const samples = prof.samples.map((id, i) => { ts += prof.timeDeltas[i]; return { id, t: ts / 1000 - off }; });
  const parent = new Map(); for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
  // the stack of game-code functions (outside vendor/) a sample ran under, innermost first
  const chain = (id) => { const out = []; for (let p = id; p != null; p = parent.get(p)) { const n = byId.get(p); if (n.callFrame.url && !/vendor\//.test(n.callFrame.url)) out.push(n); } return out; };
  // (whole window: self time by function and by file, and inclusive time of the game's main phases)
  {
    const self = new Map(), files = new Map(), incl = new Map();
    for (const sm of samples) {
      const n = byId.get(sm.id), k = key(n), f = n.callFrame.url.split('/').slice(-2).join('/') || n.callFrame.functionName;
      self.set(k, (self.get(k) || 0) + 1); files.set(f, (files.get(f) || 0) + 1);
      const seen = new Set();
      for (const m of chain(sm.id)) { const kk = key(m); if (seen.has(kk)) continue; seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + 1); }
    }
    const tot = samples.length || 1, top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(100 * v / tot).toFixed(1)}% ${k}`);
    globalThis.__window = { self: top(self, 30), files: top(files, 20), incl: top(incl, 40) };
  }
  attrib = (a, b) => {
    const self = new Map(), incl = new Map();
    for (const s of samples) {
      if (s.t < a || s.t > b) continue;
      const k = key(byId.get(s.id)); self.set(k, (self.get(k) || 0) + 1);
      const seen = new Set();
      for (const n of chain(s.id)) { const kk = key(n); if (seen.has(kk)) continue; seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + 1); }
    }
    const tot = [...self.values()].reduce((x, y) => x + y, 0) || 1;
    return [...[...self].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `self ${(100 * v / tot).toFixed(0)}% ${k}`),
      ...[...incl].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `incl ${(100 * v / tot).toFixed(0)}% ${k}`)];
  };
}
await browser.close(); await server.close();
// frames: [interval, simMs, ticks, renderMs, maxGapMs, simTime, step, turbo, boost, endWall]
const play = lt.frames.filter((f) => !f[7] && !f[11]);
const fr = play.map((f) => f[0]).sort((a, b) => a - b);
const q = (p) => (fr.length ? +fr[Math.min(fr.length - 1, Math.floor(fr.length * p))].toFixed(1) : null);
const top = +arg('top', 20);
const worst = play.slice().sort((a, b) => b[0] - a[0]).slice(0, top).map((f) => ({ ms: f[0], sim: f[1], ticks: f[2], render: f[3], gap: f[4], t: f[5], step: f[6], boost: f[8], at: +((f[9] - t0) / 1000).toFixed(1), top: attrib(f[9] - f[0], f[9]) }));
// per chapter (played frames: no fast-forward, not the title card)
const chapters = {};
for (const f of lt.frames) {
  if (f[7] || f[11]) continue;
  const c = (chapters[f[10]] ||= []);
  c.push(f[0]);
}
const chStats = Object.fromEntries(Object.entries(chapters).map(([k, v]) => {
  const a = v.slice().sort((x, y) => x - y), qq = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return [k, { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p99: +qq(0.99).toFixed(1), max: +a[a.length - 1].toFixed(1), over33: a.filter((x) => x > 33.4).length }];
}));
const longs = (lt.longs || []).slice().sort((a, b) => b[1] - a[1]);
const longTasks = { n: longs.length, over100: longs.filter((x) => x[1] > 100).length, max: longs[0]?.[1] ?? 0, total: +longs.reduce((a, x) => a + x[1], 0).toFixed(0),
  worst: longs.slice(0, 12).map((x) => ({ ms: x[1], t: x[2], top: attrib(x[0], x[0] + x[1]).slice(0, 8) })) };
const rep = {
  mission, speed, from, to, secs, preset: preset || 'default', phone, ramp, chapters: chStats, audio, window: globalThis.__window || null, longTasks,
  linksDuringPlay: (lt.links || []).map((l) => `t=${l.t} ${l.st.join(' < ')}`), size: `${vw}x${vh}`, root: ROOT, simTime: lt.time, result: lt.res && { outcome: lt.res.outcome, state: lt.res.state, time: lt.res.time, detections: lt.res.detections, exposures: lt.res.exposures },
  frames: { n: fr.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over33: fr.filter((x) => x > 33.4).length, over50: fr.filter((x) => x > 50).length, over100: fr.filter((x) => x > 100).length },
  worst,
  programsDuringPlay: lt.progs.map((p) => `${((p.t - t0) / 1000).toFixed(1)}s ${p.name} | ${p.who} | ${p.key}`),
  errors: errs.slice(0, 5),
};
console.log(JSON.stringify({ ...rep, worst: rep.worst.slice(0, 8) }, null, 1));
if (arg('json', '')) writeFileSync(arg('json'), JSON.stringify({ ...rep, frameLog: lt.frames }, null, 0));
