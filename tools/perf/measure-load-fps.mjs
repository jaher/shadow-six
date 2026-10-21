#!/usr/bin/env node
/**
 * Cold-load measurement with loading-screen smoothness (SHADOW SIX packs A/B harness).
 *
 *   node tools/perf/measure-load-fps.mjs [--preset=high] [--mission=m03] [--packs=off] [--label=before] [--json=out.json]
 *
 * Mirrors tools/perf/measure-load.mjs (same load: loadMission + talking portraits + the mission sound pack, audio
 * unlocked) and adds, for the mission phase only:
 *   - HTTP request count + response bytes (page-level, split boot/mission),
 *   - wall time to loadMission resolve and to the first frame drawn after it,
 *   - loading-screen frame rate: rAF cadence sampled inside the page (avg + worst per-second buckets),
 *   - long tasks (PerformanceObserver 'longtask'): counts > 50 ms / > 200 ms and the worst durations.
 * A fresh browser context per run = cold cache, every run.
 *
 * Browser: playwright-core + the cached Chromium, launched directly (not via tests/harness.mjs) because the
 * ANGLE backend is machine-specific: Vulkan on the DGX (GB10), GL on the RTX boxes (CHROME_GPU_ARGS overrides;
 * value is a comma list). SS_DIST=1 measures the web build (dist/, base /shadow-six/, gzip) like the harness.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const preset = arg('preset', 'high');
const mission = arg('mission', 'm03');
const packsOff = arg('packs', '') === 'off';
const label = arg('label', '');

const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
import os from 'node:os';
function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const base = join(os.homedir(), '.cache/ms-playwright');
  for (const v of ['chromium-1243', 'chromium-1223', 'chromium-1155', 'chromium-1148']) {
    for (const sub of ['chrome-linux-arm64', 'chrome-linux64', 'chrome-linux']) {
      const p = join(base, v, sub, 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
const GPU_ARGS = process.env.CHROME_GPU_ARGS
  ? process.env.CHROME_GPU_ARGS.split(',')
  : ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--enable-gpu'];

const dist = process.env.SS_DIST ? resolve(ROOT, /^(1|true)$/.test(process.env.SS_DIST) ? 'dist' : process.env.SS_DIST) : null;
if (dist && !existsSync(join(dist, 'index.html'))) throw new Error(`SS_DIST: no build at ${dist} (run npm run build)`);
const server = await startServer(dist ? { port: 0, root: dist, base: '/shadow-six/', gzip: true } : { port: 0 });
const baseUrl = server.url.replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: GPU_ARGS });

const PROBE = `
window.__probe = (() => {
  let times = [], long = [], t0 = 0, running = false;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (running) long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const loop = (t) => { if (running) times.push(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return {
    begin() { times = []; long = []; running = true; t0 = performance.now(); },
    end() {
      running = false;
      const dur = performance.now() - t0;
      const buckets = new Map();
      for (const t of times) { const b = Math.floor((t - t0) / 1000); buckets.set(b, (buckets.get(b) || 0) + 1); }
      const perSec = [...buckets.values()];
      const gaps = [];
      for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
      gaps.sort((a, b) => b - a);
      const ls = [...long].sort((a, b) => b - a);
      return {
        durMs: Math.round(dur), frames: times.length,
        fpsAvg: +(times.length / (dur / 1000)).toFixed(1),
        fpsMinSec: perSec.length ? Math.min(...perSec) : 0,
        fpsP10Sec: perSec.length ? [...perSec].sort((a, b) => a - b)[Math.floor(perSec.length * 0.1)] : 0,
        worstGapsMs: gaps.slice(0, 8).map(Math.round),
        longGt50: long.filter((d) => d > 50).length,
        longGt200: long.filter((d) => d > 200).length,
        longMaxMs: ls[0] || 0, longTopMs: ls.slice(0, 8),
      };
    },
  };
})();
`;

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push((e.stack || e.message).slice(0, 300)));
await page.addInitScript(PROBE);
const rec = [];
let phase = 'boot';
page.on('response', async (r) => {
  const ph = phase;
  try { const b = await r.body(); rec.push({ url: r.url(), bytes: b.length, phase: ph }); } catch { /* redirect / aborted */ }
});
page.on('requestfailed', (r) => { if (phase === 'mission') rec.push({ url: r.url(), bytes: 0, phase: 'failed' }); });

await page.goto(`${baseUrl}/index.html?test=1&preset=${preset}${packsOff ? '&packs=0' : ''}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await page.waitForTimeout(500);
phase = 'mission';
const srv0 = { requests: server.stats.requests, bytes: server.stats.bytes, paths: server.stats.paths.length };
const res = await page.evaluate(async (m) => {
  const G = window.__game.game;
  G.audio?.unlock?.();
  window.__probe.begin();
  const t0 = performance.now();
  await window.__game.loadMission(m);
  const tLoad = performance.now();
  await Promise.race([Promise.all([G.hud?.portraitsReady, G.audio?.preloading].filter(Boolean)), new Promise((ok) => setTimeout(ok, 10000))]);
  const tSettle = performance.now();
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const tFrame = performance.now();
  const probe = window.__probe.end();
  const pk = G.missionPack;
  const sp = G.audio?.engine?.sprites;
  return {
    loadMs: Math.round(tLoad - t0), settleMs: Math.round(tSettle - t0), firstFrameMs: Math.round(tFrame - t0), probe, lastLoad: G.lastLoad || null,
    pack: pk ? { files: pk.files, MB: +(pk.bytes / 1e6).toFixed(2), fetchHits: pk.hits, blobHits: pk.blobHits } : null,
    sprites: sp ? { hits: sp.hits, misses: sp.misses, groups: sp.groups?.size ?? 0 } : null,
  };
}, mission);
await page.waitForTimeout(1000);
const srv1 = { requests: server.stats.requests, bytes: server.stats.bytes, paths: server.stats.paths.slice(srv0.paths) };
const srvMission = {
  requests: srv1.requests - srv0.requests, MB: +((srv1.bytes - srv0.bytes) / 1e6).toFixed(2),
  topPaths: Object.entries(srv1.paths.reduce((a, p) => { a[p] = (a[p] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10),
};

const sum = (ph) => rec.filter((x) => x.phase === ph).reduce((a, x) => a + x.bytes, 0);
const cnt = (ph) => rec.filter((x) => x.phase === ph).length;
const groups = {};
for (const x of rec.filter((x) => x.phase === 'mission')) {
  if (x.url.startsWith('blob:')) { // a load the pack served as a blob URL (no network): counted apart
    groups['pack-blob'] = groups['pack-blob'] || { files: 0, bytes: 0 };
    groups['pack-blob'].files++; groups['pack-blob'].bytes += x.bytes;
    continue;
  }
  const p = new URL(x.url).pathname.replace(/^\//, '').replace(/^shadow-six\//, '');
  const s = p.split('/');
  const g = s[0] === 'assets' ? s.slice(0, 3).join('/') : s[0];
  groups[g] = groups[g] || { files: 0, bytes: 0 };
  groups[g].files++; groups[g].bytes += x.bytes;
}
const row = {
  label, preset, mission, packs: packsOff ? 'off' : 'on', dist: !!dist,
  boot: { files: cnt('boot'), MB: +(sum('boot') / 1e6).toFixed(2) },
  missionPhase: { files: cnt('mission'), MB: +(sum('mission') / 1e6).toFixed(2) },
  failedRequests: cnt('failed'),
  loadMs: res.loadMs, settleMs: res.settleMs, firstFrameMs: res.firstFrameMs,
  inGame: res.lastLoad ? { MB: +(res.lastLoad.bytes / 1e6).toFixed(2), files: res.lastLoad.files, ms: res.lastLoad.ms } : null,
  probe: res.probe,
  pack: res.pack, sprites: res.sprites, serverMission: srvMission,
  groups: Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].bytes - a[1].bytes).map(([k, v]) => [k, { files: v.files, MB: +(v.bytes / 1e6).toFixed(2) }])),
  pageErrors: pageErrors.slice(0, 5),
};
console.log(JSON.stringify(row, null, 1));
const j = arg('json', '');
if (j) writeFileSync(j, JSON.stringify(row, null, 1) + '\n');
await ctx.close();
await browser.close().catch(() => {});
await server.close().catch(() => {});
