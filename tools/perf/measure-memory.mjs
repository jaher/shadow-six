#!/usr/bin/env node
/**
 * Memory footprint per mission: JS heap (+ ArrayBuffer backing stores), GPU memory (every live GL texture / buffer /
 * renderbuffer, counted at allocation by tools/perf/mem-probe.js, mip chains and formats included), decoded audio,
 * the session cache, renderer + GPU process PSS and the GPU process's VRAM (nvidia-smi), download bytes, load time
 * and frame time. Each mission runs in a fresh browser (so the GPU process holds that mission only).
 *
 *   node tools/perf/measure-memory.mjs [--missions=m01,m02|all] [--configs=desktop-high,desktop-medium,phone-medium]
 *        [--out=dir] [--label=before] [--cycle] [--top=40] [--dist]
 *
 * Configs: desktop-<preset> (1280×720, DPR 1) · phone-<preset> (Pixel 7 emulation: 412×839 @2.625, touch, mobile UA,
 * deviceMemory 4). `--cycle`: one browser, M1 → M2 → M3 → M1, memory after each (leak check).
 * Writes <out>/<label>-<config>.json (+ a markdown table on stdout).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const H = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const OUT = arg('out', '<projects>/commandos-shots/memory');
const LABEL = arg('label', 'run');
const TOP = +arg('top', 40);
mkdirSync(OUT, { recursive: true });

const PW = await (async () => {
  const local = join(ROOT, 'node_modules/playwright-core/index.mjs');
  return import(pathToFileURL(existsSync(local) ? local : '<repo>/node_modules/playwright-core/index.mjs').href);
})();
const { chromium, devices } = PW;
const PROBE = join(ROOT, 'tools/perf/mem-probe.js');
const dist = flag('dist') ? join(ROOT, 'dist') : null;
const server = await startServer(dist ? { port: 0, root: dist, base: '/shadow-six/', gzip: true } : { port: 0 });
const BASE = server.url.replace(/\/$/, '') + (dist ? '/shadow-six' : '');

// ------------------------------------------------------------------ process memory (/proc, nvidia-smi)
function procTree(rootPid) {
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = +s.slice(s.lastIndexOf(')') + 2).split(' ')[1];
      (kids.get(ppid) || kids.set(ppid, []).get(ppid)).push(+d);
    } catch { /* gone */ }
  }
  const out = [];
  const walk = (p) => { for (const c of kids.get(p) || []) { out.push(c); walk(c); } };
  walk(rootPid);
  return out;
}
function findBrowserPid(marker) {
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const c = readFileSync(`/proc/${d}/cmdline`, 'utf8'); if (c.includes(marker) && !c.includes('--type=')) return +d; } catch { /* gone */ }
  }
  return null;
}
function procMem(pid) {
  try {
    const r = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = (k) => +((new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(r) || [])[1] || 0);
    return { pss: kb('Pss') * 1024, rss: kb('Rss') * 1024 };
  } catch { return { pss: 0, rss: 0 }; }
}
function vramByPid() {
  try {
    const t = execFileSync('nvidia-smi', [], { encoding: 'utf8', timeout: 8000 });
    const m = new Map();
    for (const line of t.split('\n')) { const x = /\s(\d+)\s+[GC]\s+.*?(\d+)MiB/.exec(line); if (x) m.set(+x[1], +x[2] * 1048576); }
    return m;
  } catch { return new Map(); }
}
function processes(browserPid) {
  const all = procTree(browserPid);
  const out = { renderer: [], gpu: null, other: 0 };
  for (const p of all) {
    let c = '';
    try { c = readFileSync(`/proc/${p}/cmdline`, 'utf8'); } catch { continue; }
    const m = procMem(p);
    if (c.includes('--type=renderer')) out.renderer.push({ pid: p, ...m });
    else if (c.includes('--type=gpu-process')) out.gpu = { pid: p, ...m };
    else out.other += m.pss;
  }
  out.browser = procMem(browserPid);
  return out;
}

// ------------------------------------------------------------------ browser per run
const CONFIGS = arg('configs', 'desktop-high,desktop-medium,phone-medium').split(',');
async function launch(cfg) {
  const marker = `--ss-memprobe-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const browser = await chromium.launch({ executablePath: H.findChrome(), headless: true,
    args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', marker] });
  const [dev, preset] = cfg.split('-');
  const opts = dev === 'phone' ? { ...devices['Pixel 7'] } : { viewport: { width: +arg('w', 1920), height: +arg('h', 1080) }, deviceScaleFactor: +arg('dpr', 1) };
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript({ path: PROBE });
  if (dev === 'phone') await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 4, configurable: true }); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable').catch(() => {});
  const pid = findBrowserPid(marker);
  const rec = [];
  let phase = 'boot';
  page.on('response', async (r) => { const ph = phase; if (!/^https?:/.test(r.url())) return; try { const b = await r.body(); rec.push({ url: r.url(), bytes: b.length, phase: ph }); } catch { /* redirect / aborted */ } });
  await page.goto(`${BASE}/index.html?test=1${preset ? '&preset=' + preset : ''}`, { timeout: 180000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  await page.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    window.__memProbe.hookThree(THREE, { GLTFLoader });
  }).catch((e) => console.warn('hookThree failed (bundled build?)', e.message));
  return { browser, ctx, page, cdp, pid, rec, errs, setPhase: (p) => { phase = p; }, cfg, preset };
}

async function gc(cdp, page) {
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await page.waitForTimeout(120); }
}

/** Upload everything the scene references (textures of hidden / culled objects too) and draw one unculled frame. */
async function fullUpload(page) {
  return page.evaluate(() => {
    const G = window.__game.game, R = G.renderer.renderer, scene = G.renderer.scene;
    const culled = [];
    scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    G.render(0.016, 1);
    for (const o of culled) o.frustumCulled = true;
    const seen = new Set();
    scene.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) for (const k in m) { const t = m[k]; if (t?.isTexture && !seen.has(t)) { seen.add(t); try { R.initTexture(t); } catch { /* ignore */ } } } });
    G.render(0.016, 1);
    return seen.size;
  });
}

async function snapshot(run, label) {
  const { page, cdp } = run;
  await gc(cdp, page);
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => ({}));
  const pageSide = await page.evaluate(async (top) => {
    const G = window.__game.game, R = G.renderer.renderer;
    const { sessionCache } = await import('/src/engine/asset-cache.js').catch(() => ({}));
    if (sessionCache) window.__memProbe.tagCache(sessionCache);
    window.__memProbe.tagScene(G.renderer.scene);
    const rep = window.__memProbe.report({ top });
    const mus = G.audio?.musicDirector || G.audio?.music_ || null;
    return { rep, info: { ...R.info.memory, programs: R.info.programs?.length }, cache: window.__game.cache.stats(), perf: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null, music: !!mus };
  }, TOP);
  const pr = run.pid ? processes(run.pid) : null;
  const vram = pr?.gpu ? vramByPid().get(pr.gpu.pid) ?? null : null;
  const rend = pr ? pr.renderer.reduce((a, r) => (r.pss > a.pss ? r : a), { pss: 0, rss: 0 }) : null;
  return { label, heap, ...pageSide, proc: pr ? { rendererPss: rend.pss, rendererRss: rend.rss, gpuPss: pr.gpu?.pss ?? null, gpuRss: pr.gpu?.rss ?? null, browserPss: pr.browser.pss, vram } : null };
}

async function loadMission(run, id) {
  const { page } = run;
  run.setPhase('mission:' + id);
  // poll process memory while loading: the peak matters on phones (decode buffers, canvases)
  let peak = { rendererPss: 0, gpuPss: 0, vram: 0, heap: 0 }, polling = true;
  const poll = (async () => {
    while (polling) {
      try {
        const pr = processes(run.pid);
        const rend = pr.renderer.reduce((a, r) => Math.max(a, r.pss), 0);
        peak.rendererPss = Math.max(peak.rendererPss, rend);
        peak.gpuPss = Math.max(peak.gpuPss, pr.gpu?.pss || 0);
        const v = pr.gpu ? vramByPid().get(pr.gpu.pid) : 0;
        peak.vram = Math.max(peak.vram, v || 0);
        const h = await run.cdp.send('Runtime.getHeapUsage').catch(() => null);
        if (h) peak.heap = Math.max(peak.heap, (h.usedSize || 0) + (h.backingStorageSize || 0));
      } catch { /* ignore */ }
      await new Promise((ok) => setTimeout(ok, 400));
    }
  })();
  const t0 = Date.now();
  const r = await page.evaluate(async (m) => {
    const G = window.__game.game;
    G.audio?.unlock?.();
    const t = performance.now();
    await window.__game.loadMission(m);
    const loadMs = performance.now() - t;
    await Promise.race([Promise.all([G.hud?.portraitsReady, G.audio?.preloading].filter(Boolean)), new Promise((ok) => setTimeout(ok, 10000))]);
    return { loadMs, lastLoad: G.lastLoad || null };
  }, id);
  r.wallMs = Date.now() - t0;
  // play: the mission music starts, the sim runs a little (lazy SFX decodes, first frames)
  await page.evaluate(() => { window.__game.start(); for (let i = 0; i < 30; i++) { window.__game.advance(1 / 30); window.__game.render(); } });
  await page.waitForTimeout(3000);
  polling = false;
  await poll;
  const bytes = run.rec.filter((x) => x.phase === 'mission:' + id).reduce((a, x) => a + x.bytes, 0);
  return { ...r, peak, downloadBytes: bytes, files: run.rec.filter((x) => x.phase === 'mission:' + id).length };
}

async function bench(page) {
  return page.evaluate(async () => {
    const g = window.__game;
    const s = g.state();
    const b1 = await g.bench(60);
    g.setZoom(0.5); // zoomed out: more of the map on screen
    const b2 = await g.bench(60);
    g.setZoom(1);
    return { z1: { wall: b1.wallMedian, p95: b1.wallP95, gpu: b1.gpuMedian, calls: b1.calls, tris: b1.triangles }, z05: { wall: b2.wallMedian, p95: b2.wallP95, gpu: b2.gpuMedian, calls: b2.calls }, mission: s.mission };
  });
}

const MB = (b) => (b == null ? '—' : (b / 1048576).toFixed(0));
function row(cfg, id, s, l, b) {
  const h = s.heap || {};
  return { cfg, id, jsHeap: h.usedSize, backing: h.backingStorageSize, gpu: s.rep.gpu.total, gpuTex: s.rep.gpu.tex, gpuBuf: s.rep.gpu.buf, gpuRb: s.rep.gpu.rb + s.rep.gpu.canvas, audio: s.rep.audio.total, bitmaps: s.rep.bitmaps?.bytes,
    cache: s.cache.bytes, cacheEntries: s.cache.entries, rendererPss: s.proc?.rendererPss, gpuPss: s.proc?.gpuPss, vram: s.proc?.vram, peak: l?.peak, download: l?.downloadBytes, loadMs: l?.loadMs, frame: b?.z1?.wall, frameZ05: b?.z05?.wall, gpuMs: b?.z1?.gpu, bitmaps: s.rep.bitmaps?.bytes, ntex: s.rep.gpu.ntex, infoTex: s.info.textures, infoGeo: s.info.geometries };
}
function printRow(r) {
  console.log(`| ${r.cfg} | ${r.id} | ${MB(r.jsHeap)} | ${MB(r.backing)} | ${MB(r.startGpu)} | ${MB(r.gpu)} (${MB(r.gpuTex)}/${MB(r.gpuBuf)}/${MB(r.gpuRb)}) | ${MB(r.audio)} | ${MB(r.bitmaps)} | ${MB(r.cache)} | ${MB(r.rendererPss)} | ${MB(r.vram)} | ${MB(r.peak?.rendererPss)}/${MB(r.peak?.vram)} | ${(r.download / 1e6).toFixed(1)} | ${(r.loadMs / 1000).toFixed(1)} | ${r.frame ?? '—'}/${r.frameZ05 ?? '—'} |`);
}
const HEADER = '| config | mission | JS heap MB | ArrayBuffers MB | GPU@start MB | GPU full MB (tex/buf/rt) | audio MB | bitmaps MB | cache MB | renderer PSS MB | VRAM MB | peak PSS/VRAM | download MB | load s | frame ms z1/z0.5 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

// ------------------------------------------------------------------ main
async function missionIds() {
  const run = await launch('desktop-low');
  const ids = await run.page.evaluate(async () => (await import('/src/missions/index.js')).MISSIONS.map((m) => m.id));
  await run.browser.close();
  return ids;
}

const wantM = arg('missions', 'm01,m02,m03');
const ids = wantM === 'all' ? await missionIds() : wantM.split(',');

if (flag('cycle')) {
  for (const cfg of CONFIGS) {
    const run = await launch(cfg);
    const seq = arg('seq', 'm01,m02,m03,m01').split(',');
    const out = { cfg, steps: [] };
    if (arg('spare', '') !== '') await run.page.evaluate(async (sp) => { const { sessionCache } = await import('/src/engine/asset-cache.js'); sessionCache.spare = sp; }, +arg('spare', '0') * 1048576);
    out.steps.push({ id: 'boot', ...(await snapshot(run, 'boot')) });
    for (const id of seq) {
      const l = await loadMission(run, id);
      l.uploaded = await fullUpload(run.page);
      const s = await snapshot(run, id);
      out.steps.push({ id, l, s: row(cfg, id, s, l, null), rep: s.rep });
      printRow(row(cfg, id, s, l, null));
    }
    writeFileSync(join(OUT, `${LABEL}-cycle-${cfg}.json`), JSON.stringify(out, null, 1));
    await run.browser.close();
  }
} else {
  for (const cfg of CONFIGS) {
    const rows = [], details = {};
    console.log(`\n### ${cfg}\n\n${HEADER}`);
    for (const id of ids) for (let attempt = 0; attempt < 2; attempt++) {
      let run;
      try {
        run = await launch(cfg);
        const boot = await snapshot(run, 'boot');
        const l = await loadMission(run, id);
        const s0 = await snapshot(run, id + '@start'); // what the first view uploaded
        const b = await bench(run.page);
        l.uploaded = await fullUpload(run.page); // every texture / mesh of the scene on the GPU (worst case of a long session)
        await run.page.waitForTimeout(1500); // released images settle (engine/texture-memory.js swaps are async)
        const s = await snapshot(run, id);
        const r = row(cfg, id, s, l, b);
        r.bootGpu = boot.rep.gpu.total; r.bootHeap = boot.heap?.usedSize; r.startGpu = s0.rep.gpu.total; r.startTex = s0.rep.gpu.tex;
        rows.push(r);
        details[id] = { bitmaps: s.rep.bitmaps, buckets: s.rep.buckets, topTex: s.rep.topTex, topBuf: s.rep.topBuf, dups: s.rep.dups, audio: s.rep.audio, info: s.info, cache: s.cache, errs: run.errs, bench: b, lastLoad: l.lastLoad };
        printRow(r);
        break;
      } catch (e) {
        console.log(`| ${cfg} | ${id} | FAILED${attempt ? '' : ' (retrying)'} ${String(e.message).slice(0, 120)} |`);
      } finally {
        await run?.browser.close().catch(() => {});
      }
    }
    writeFileSync(join(OUT, `${LABEL}-${cfg}.json`), JSON.stringify({ cfg, rows, details }, null, 1));
  }
}
await server.close();
