#!/usr/bin/env node
/**
 * Main-thread long tasks during a COLD mission load (fresh browser = empty HTTP cache and GPU program cache): the
 * walkthrough link (`?debug&walkthrough=m03`, up to its intro card), a normal mission start through the LOADING screen
 * (`?debug&mission=m01`), or the in-place reload of a walkthrough chapter jump back (`--mode=jump`: open the link,
 * start, then jump back to the first chapter and measure the reload + fast-forward).
 *
 * Records a Chrome trace (task boundaries + V8 CPU samples on one clock) and the in-page Long Tasks API; every main-thread
 * task over --min ms (default 50) is attributed to the functions sampled inside it (self time), the game code that owns
 * them (first frame outside vendor/), and the load stage it fell in (Game.loadMission 'mission:progress' stages, plus
 * boot / settle / walkthrough phases).
 *
 *   node tools/perf/load-longtasks.mjs [--mission=m03] [--mode=walkthrough|debug|jump] [--preset=high] [--root=<checkout>]
 *        [--out=report.json] [--shot=graph.png] [--min=50] [--size=1920x1080] [--keep-trace=trace.json]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const mission = arg('mission', 'm03'), mode = arg('mode', 'walkthrough'), preset = arg('preset', 'high'), MIN = +arg('min', 50);
const [vw, vh] = arg('size', '1920x1080').split('x').map(Number);

const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
await ctx.addInitScript(() => {
  const L = (window.__lt = { tasks: [], frames: [], marks: [], stages: [], t0: performance.now() });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) L.tasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  const mark = (name) => { L.marks.push([performance.now(), name]); try { performance.mark('lt:' + name); } catch { /* ignore */ } };
  L.mark = mark;
  mark('init');
  // who links programs (and when): the JS stack at gl.linkProgram, frames outside three
  L.links = [];
  Error.stackTraceLimit = 40;
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (prog) {
    const st = (new Error().stack || '').split('\n').slice(1).map((l) => l.trim()).filter((l) => !/vendor\/|linkProgram/.test(l)).slice(0, 5).map((l) => l.replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').replace(/\?[^:)]*/, ''));
    L.links.push([performance.now(), st.join(' < ')]);
    return link.call(this, prog);
  };
  let hooked = false, loadingOn = false, card = false;
  const f = (now) => {
    L.frames.push(now);
    const g = window.shadowSix;
    if (g && !hooked && g.events?.on) {
      hooked = true;
      mark('game');
      g.events.on('mission:loading', () => mark('mission:loading'));
      g.events.on('mission:progress', (e) => { const s = L.stages[L.stages.length - 1]; if (!s || s[1] !== e.stage) L.stages.push([performance.now(), e.stage, e.p]); });
      g.events.on('mission:loaded', () => mark('mission:loaded'));
    }
    const ld = !!document.querySelector('.mk-loading');
    if (ld !== loadingOn) { loadingOn = ld; mark(ld ? 'loading-screen:on' : 'loading-screen:off'); }
    const c = document.getElementById('wt-card');
    const ck = c ? (c.dataset.kind || c.className || 'card') : '';
    if ((ck || false) !== card) { card = ck || false; mark(ck ? `card:${ck}` : 'card:off'); }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
page.on('console', (m) => { const t = m.text(); if (/^\[load\]|\[loadresp\]/.test(t)) console.error('  page:', t); });
const base = server.url.replace(/\/$/, '');

const CATS = ['toplevel', 'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'devtools.timeline', '__metadata'];
if (mode !== 'jump') await browser.startTracing(page, { categories: CATS });
const tNav = Date.now();
const url = mode === 'debug' ? `${base}/index.html?debug&mission=${mission}&preset=${preset}`
  : `${base}/index.html?debug&walkthrough=${mission}&preset=${preset}`;
await page.goto(url, { timeout: 240000 });
let endName;
if (mode === 'debug') {
  await page.waitForFunction(() => window.shadowSix?.lastLoad && !window.shadowSix.hud?.loading?.active && (window.shadowSix.state === 'playing' || window.shadowSix.state === 'briefing'), null, { timeout: 400000, polling: 200 });
  endName = 'loaded';
} else {
  await page.waitForFunction(() => document.getElementById('wt-card') && window.shadowSix?.lastLoad && !window.shadowSix.hud?.loading?.active, null, { timeout: 400000, polling: 200 });
  endName = 'intro card';
}
const loadWall = Date.now() - tNav;
await page.evaluate(() => window.__lt.mark('end'));
let shot = arg('shot', '');
if (shot && mode !== 'jump') {
  // the graph covers the last 15 s of the load: wait one HUD refresh, then grab the panel (and the whole view)
  await page.waitForTimeout(400);
  mkdirSync(dirname(resolve(shot)), { recursive: true });
  const box = await page.evaluate(() => { const b = document.querySelector('#dbg-info, .dbg-info'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  if (box && box.width > 10) await page.screenshot({ path: shot, clip: box, timeout: 60000 }).catch((e) => console.error('shot failed', e.message));
  await page.screenshot({ path: shot.replace(/\.png$/, '-full.png'), timeout: 60000 }).catch(() => {});
}
let jump = null;
if (mode === 'jump') {
  // start the walkthrough, let it play a few seconds, then jump back to its first chapter: reload in place + fast-forward
  await page.evaluate(() => window.__lt.mark('start'));
  await page.evaluate(() => document.querySelector('#wt-card button.wt-go')?.click());
  await page.waitForFunction(() => !document.getElementById('wt-card') && (window.shadowSix?.world?.time || 0) > 2, null, { timeout: 120000, polling: 200 });
  await page.waitForTimeout(2500);
  // ahead to chapter --ahead (default the 3rd: fast-forward from here), then back to chapter --back (default the 2nd):
  // the mission reloads in place and fast-forwards to it (debug-mode.js startWalkthrough toMarker)
  const ahead = +arg('ahead', 2), back = +arg('back', 1);
  await page.evaluate((k) => { const r = window.shadowSix.debug.mode.replay; const st = r.markers.filter((m) => m.kind === 'stage'); r.jumpTo(st[Math.min(k, st.length - 1)]); }, ahead);
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && !r.toMarker && !r.pacer?.turbo; }, null, { timeout: 400000, polling: 200 });
  await page.waitForTimeout(1500);
  await browser.startTracing(page, { categories: CATS });
  await page.evaluate(() => window.__lt.mark('init2'));
  await page.evaluate((k) => {
    const r = window.shadowSix.debug.mode.replay;
    const st = r.markers.filter((m) => m.kind === 'stage');
    window.__lt.mark('jump');
    window.__lt.jumpT0 = performance.now();
    window.__lt.jumpTo = st[k];
    window.__lt.oldReplay = r;
    r.jumpTo(st[k]);
  }, back);
  await page.waitForFunction(() => {
    const r = window.shadowSix?.debug?.mode?.replay;
    return r && r !== window.__lt.oldReplay && !r.toMarker && !r.pacer?.turbo && !window.shadowSix.building;
  }, null, { timeout: 400000, polling: 200 });
  await page.evaluate(() => window.__lt.mark('jump:done'));
  jump = await page.evaluate(() => ({ ms: Math.round(performance.now() - window.__lt.jumpT0), to: window.__lt.jumpTo }));
  if (shot) {
    const box = await page.evaluate(() => { const b = document.querySelector('#dbg-info, .dbg-info'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    if (box && box.width > 10) await page.screenshot({ path: shot, clip: box, timeout: 60000 }).catch(() => {});
    await page.screenshot({ path: shot.replace(/\.png$/, '-full.png'), timeout: 60000 }).catch(() => {});
  }
}
await page.waitForTimeout(mode === 'jump' ? 500 : 3000); // the first frames after the load (texture warmer, programs)
const lt = await page.evaluate(() => { window.__lt.mark('stop'); return { links: window.__lt.links, tasks: window.__lt.tasks, frames: window.__lt.frames, marks: window.__lt.marks, stages: window.__lt.stages, lastLoad: window.shadowSix?.lastLoad || null, warm: { frame: window.shadowSix?.warmFrameMs, units: window.shadowSix?.warmMs, textures: window.shadowSix?.textureWait || null }, chunk: window.shadowSix?.chunkStats ? { n: window.shadowSix.chunkStats.meshes ?? null } : null, loadresp: window.shadowSix?.loadStats || null }; });
const buf = await browser.stopTracing();
if (arg('keep-trace', '')) writeFileSync(arg('keep-trace'), buf);
const trace = JSON.parse(buf.toString('utf8'));
const evs = trace.traceEvents || trace;

// ---- the renderer main thread: the pid that carries our user-timing marks, its CrRendererMain thread
const ALIGN = mode === 'jump' ? 'init2' : 'init';
const align = evs.find((e) => e.name === `lt:${ALIGN}` && e.cat?.includes('blink.user_timing'));
const pid = align?.pid;
const threadNames = new Map();
for (const e of evs) if (e.ph === 'M' && e.name === 'thread_name' && e.pid === pid) threadNames.set(e.tid, e.args?.name);
const tid = [...threadNames].find(([, n]) => n === 'CrRendererMain')?.[0];
// trace clock (µs) → page performance.now() (ms): the 'init' mark's both stamps
const initPN = lt.marks.find((m) => m[1] === ALIGN)[0];
const toPN = (ts) => (ts - align.ts) / 1000 + initPN;

// ---- top-level tasks on the main thread
const tasks = [];
for (const e of evs) {
  if (e.pid !== pid || e.tid !== tid || e.ph !== 'X') continue;
  if (e.name !== 'ThreadControllerImpl::RunTask' && e.name !== 'RunTask') continue;
  tasks.push({ t: toPN(e.ts), d: (e.dur || 0) / 1000, cpu: e.tdur != null ? e.tdur / 1000 : null });
}
tasks.sort((a, b) => a.t - b.t);
// nested RunTask (RunTask inside ThreadControllerImpl::RunTask): keep the outermost
const top = [];
for (const x of tasks) { const p = top[top.length - 1]; if (p && x.t >= p.t && x.t + x.d <= p.t + p.d + 0.01) continue; top.push(x); }

// ---- CPU samples (Profile + ProfileChunk events of the main thread's V8 profiler)
const nodes = new Map(), parent = new Map();
const samples = [];
const profIds = new Set(evs.filter((e) => e.name === 'Profile' && e.pid === pid && e.tid === tid).map((e) => e.id));
const profStart = new Map(evs.filter((e) => e.name === 'Profile' && e.pid === pid).map((e) => [e.id, e.args.data.startTime]));
const chunks = evs.filter((e) => e.name === 'ProfileChunk' && e.pid === pid && (profIds.has(e.id) || !profIds.size)).sort((a, b) => a.ts - b.ts);
const clock = new Map();
for (const c of chunks) {
  const d = c.args.data, cp = d.cpuProfile || {};
  for (const n of cp.nodes || []) { nodes.set(`${c.id}:${n.id}`, n.callFrame); if (n.parent != null) parent.set(`${c.id}:${n.id}`, `${c.id}:${n.parent}`); }
  let ts = clock.get(c.id) ?? profStart.get(c.id) ?? c.ts;
  const sm = cp.samples || [], dt = d.timeDeltas || [];
  for (let i = 0; i < sm.length; i++) { ts += dt[i] || 0; samples.push({ id: `${c.id}:${sm[i]}`, t: toPN(ts) }); }
  clock.set(c.id, ts);
}
samples.sort((a, b) => a.t - b.t);
const shortUrl = (u) => (u || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '');
const fkey = (cf) => `${cf.functionName || '(anon)'}${cf.url ? ` ${shortUrl(cf.url).split('/').slice(-2).join('/')}:${cf.lineNumber + 1}` : ''}`;
const isGame = (cf) => cf?.url && !/vendor\//.test(cf.url) && /\/src\//.test(cf.url);
const owner = (id) => { for (let p = id; p != null; p = parent.get(p)) { const cf = nodes.get(p); if (isGame(cf)) return fkey(cf); } return fkey(nodes.get(id) || {}); };
/** The game frames of a sample, outermost first (the load stage → the function that runs). */
const gameChain = (id) => { const out = []; for (let p = id; p != null; p = parent.get(p)) { const cf = nodes.get(p); if (isGame(cf)) out.push(cf.functionName || '(anon)'); } return out.reverse(); };

const stageAt = (t) => {
  let s = 'boot';
  for (const m of lt.marks) if (m[0] <= t) { if (m[1] === 'mission:loading') s = 'mission:start'; else if (m[1] === 'mission:loaded') s = 'settle'; else if (/^card:/.test(m[1]) && m[1] !== 'card:off') s = 'card'; else if (m[1] === 'jump') s = 'jump'; else if (m[1] === 'start') s = 'play'; }
  if (s === 'mission:start' || s === 'jump') for (const x of lt.stages) if (x[0] <= t && x[1] !== 'done') s = (s === 'jump' ? 'jump:' : '') + x[1]; else if (x[0] <= t && x[1] === 'done') s = 'settle';
  return s;
};
const endT = lt.marks.find((m) => m[1] === 'end')?.[0] ?? Infinity;
const startT = lt.marks.find((m) => m[1] === 'init')?.[0] ?? 0;
const winLo = mode === 'jump' ? lt.marks.find((m) => m[1] === 'jump')[0] : startT;
const winHi = mode === 'jump' ? lt.marks.find((m) => m[1] === 'jump:done')[0] : endT;

let si = 0;
const attrib = (a, b) => {
  const self = new Map(), own = new Map(), chains = new Map();
  let n = 0;
  while (si > 0 && samples[si - 1].t >= a) si--;
  while (si < samples.length && samples[si].t < a) si++;
  for (let k = si; k < samples.length && samples[k].t <= b; k++) {
    const s = samples[k], cf = nodes.get(s.id) || {};
    if (cf.functionName === '(idle)') continue;
    n++;
    const sk = fkey(cf); self.set(sk, (self.get(sk) || 0) + 1);
    const o = owner(s.id); own.set(o, (own.get(o) || 0) + 1);
    const ch = gameChain(s.id).slice(0, 7).join(' > '); chains.set(ch, (chains.get(ch) || 0) + 1);
  }
  const topk = (m, k) => [...m].sort((x, y) => y[1] - x[1]).slice(0, k).map(([kk, v]) => `${Math.round((100 * v) / Math.max(1, n))}% ${kk}`);
  const out = { samples: n, self: topk(self, 5), owner: topk(own, 4), chain: topk(chains, 3) };
  if (b - a > 400) { // a long one: inclusive time per game function (what to slice)
    const inc = new Map();
    for (let k = si; k < samples.length && samples[k].t <= b; k++) {
      const s = samples[k], seen = new Set();
      if ((nodes.get(s.id) || {}).functionName === '(idle)') continue;
      for (let p = s.id; p != null; p = parent.get(p)) { const cf = nodes.get(p); if (isGame(cf)) { const kk = fkey(cf); if (!seen.has(kk)) { seen.add(kk); inc.set(kk, (inc.get(kk) || 0) + 1); } } }
    }
    out.inclusive = topk(inc, 30);
  }
  return out;
};

const long = top.filter((x) => x.d > MIN && x.t + x.d >= winLo && x.t <= winHi + (mode === 'jump' ? 0 : 3000));
// (cpu: the main thread's own CPU time in the task — on a busy host the rest of `ms` is time the OS gave other processes)
const rows = long.map((x) => ({ at: +((x.t - winLo) / 1000).toFixed(2), ms: +x.d.toFixed(0), cpu: x.cpu != null ? +x.cpu.toFixed(0) : null, stage: stageAt(x.t + x.d / 2), ...attrib(x.t, x.t + x.d) }));
// frames (rAF) inside the measured window
const fr = [];
for (let i = 1; i < lt.frames.length; i++) if (lt.frames[i] >= winLo && lt.frames[i] <= winHi) fr.push([lt.frames[i], lt.frames[i] - lt.frames[i - 1]]);
const fd = fr.map((x) => x[1]).sort((a, b) => a - b);
const q = (p) => (fd.length ? +fd[Math.min(fd.length - 1, Math.floor(fd.length * p))].toFixed(1) : null);
const apiLong = lt.tasks.filter(([t, d]) => t + d >= winLo && t <= winHi);
const inWin = top.filter((x) => x.t >= winLo && x.t <= winHi);
const busy = inWin.reduce((s, x) => s + x.d, 0);
// per load stage: wall time, main-thread busy (tasks) and CPU, and where its CPU samples went (game call chains, 4
// deep): what makes a stage longer than in another checkout
const stageStat = new Map();
const sst = (s) => { let v = stageStat.get(s); if (!v) stageStat.set(s, (v = { busy: 0, cpu: 0, samples: 0, chains: new Map() })); return v; };
for (const x of inWin) { const v = sst(stageAt(x.t + x.d / 2)); v.busy += x.d; v.cpu += x.cpu || 0; }
for (const s of samples) {
  if (s.t < winLo || s.t > winHi) continue;
  const cf = nodes.get(s.id) || {};
  if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
  const v = sst(stageAt(s.t)); v.samples++;
  const ch = gameChain(s.id).slice(0, 4).join(' > ') || `(${fkey(cf)})`;
  v.chains.set(ch, (v.chains.get(ch) || 0) + 1);
}
const stages = Object.fromEntries([...stageStat].map(([s, v]) => [s, { busyMs: Math.round(v.busy), cpuMs: Math.round(v.cpu), samples: v.samples,
  top: [...v.chains].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${n} ${k}`) }]));
const rep = {
  mission, mode, preset, root: ROOT, size: `${vw}x${vh}`, loadavg: (await import('node:os')).loadavg().map((x) => +x.toFixed(1)),
  wallMs: mode === 'jump' ? jump?.ms : Math.round(winHi - winLo), endName: mode === 'jump' ? 'jump done' : endName, navWallMs: loadWall,
  lastLoad: lt.lastLoad, warm: lt.warm, jump,
  phases: lt.marks.map((m) => [+((m[0] - winLo) / 1000).toFixed(2), m[1]]).concat(lt.stages.map((s) => [+((s[0] - winLo) / 1000).toFixed(2), `stage:${s[1]}`])).sort((a, b) => a[0] - b[0]),
  stages,
  mainThread: { tasks: inWin.length, busyMs: Math.round(busy), cpuOver50: inWin.filter((x) => x.cpu > 50).length, cpuMax: Math.round(Math.max(0, ...inWin.map((x) => x.cpu || 0))), over50: inWin.filter((x) => x.d > 50).length, over33: inWin.filter((x) => x.d > 33).length, over100: inWin.filter((x) => x.d > 100).length, maxMs: Math.round(Math.max(0, ...inWin.map((x) => x.d))), sumOver50: Math.round(inWin.filter((x) => x.d > 50).reduce((s, x) => s + x.d, 0)) },
  longTasksApi: { n: apiLong.length, max: Math.round(Math.max(0, ...apiLong.map((x) => x[1]))), sum: Math.round(apiLong.reduce((s, x) => s + x[1], 0)) },
  frames: { n: fd.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over50: fd.filter((x) => x > 50).length, over100: fd.filter((x) => x > 100).length, frozenMs: Math.round(fd.filter((x) => x > 50).reduce((s, x) => s + x, 0)) },
  frameTimeline: fr.map((x) => [+((x[0] - winLo) / 1000).toFixed(3), +x[1].toFixed(1)]),
  longTasks: rows,
  programLinks: { n: lt.links.length, all: lt.links.map(([t, st]) => `${((t - winLo) / 1000).toFixed(2)}s [${stageAt(t)}] ${st}`), afterLoad: lt.links.filter(([t]) => t >= (lt.marks.find((m) => m[1] === 'mission:loaded')?.[0] ?? Infinity)).map(([t, st]) => `${((t - winLo) / 1000).toFixed(2)}s ${st}`) },
  errors: errs.slice(0, 5),
};
const out = arg('out', '');
if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, JSON.stringify(rep, null, 1)); }
const brief = { ...rep };
delete brief.frameTimeline;
brief.longTasks = rows.map((r) => `${r.at}s ${r.ms}ms [${r.stage}] ${r.chain[0] || ''} | ${r.self.slice(0, 2).join(', ')}`);
console.log(JSON.stringify(brief, null, 1));
await browser.close();
await server.close();
