#!/usr/bin/env node
/**
 * Mission (re)load timings on the web build, as a player sees them (real HUD paths, throttled network).
 *
 *   npm run build && node tools/perf/measure-restart.mjs [--mbit 20] [--json out.json] [--headed]
 *
 * Serves dist/ under /shadow-six/ the way GitHub Pages does (max-age=600 + ETag), throttles the page to --mbit,
 * then: first load M1 (?mission=m01) → RESTART MISSION → quick save + quick load → next mission (M2) → load the M1
 * save from M2 → reload the page (second visit: HTTP cache / service worker) → M1. Each row: wall time of the load
 * (loading screen up → ready, minus its 400 ms hold), asset requests that reached the network, bytes transferred,
 * how many came from the HTTP cache / service worker, and the per-stage split from 'mission:progress'.
 */
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, GPU_ARGS, findChrome } from '../../tests/harness.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MBIT = Number(opt('--mbit', 20));
const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
const pw = await import(pathToFileURL(join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
const server = await startServer({ port: 0, root: resolve(ROOT, opt('--root', 'dist')), base: '/shadow-six/', gzip: true, pages: true, mbit: MBIT, latencyMs: 20 });
const browser = await pw.chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: GPU_ARGS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const base = server.url.replace(/\/$/, '');
let net = null; // per-scenario counters
const rows = [];

async function attach(page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const urls = new Map();
  cdp.on('Network.responseReceived', (e) => {
    if (!net) return;
    const u = e.response.url;
    urls.set(e.requestId, u);
    if (!/\/assets\/|\/vendor\//.test(u)) return;
    if (e.response.fromServiceWorker) net.sw++;
    else if (e.response.fromDiskCache || e.response.fromPrefetchCache) net.disk++;
    else if (e.response.status === 304) net.revalidated++;
    else net.network++;
  });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console.error', m.text().slice(0, 200)); });
  return page;
}

/** Stage split + memory, read in the page after a load. */
const STAGES = () => {
  const g = window.shadowSix, r = g.renderer?.renderer || g.renderer;
  return { stages: window.__ssStages || [], last: g.lastLoad || null, mem: r?.info?.memory ? { ...r.info.memory } : null, programs: r?.info?.programs?.length ?? null };
};
const HOOK = () => {
  const g = window.shadowSix;
  window.__ssStages = [];
  if (window.__ssHooked) return;
  window.__ssHooked = true;
  let cur = null, t = 0;
  g.events.on('mission:progress', (e) => {
    if (e.stage === cur) return;
    const now = performance.now();
    if (cur) window.__ssStages.push([cur, Math.round(now - t)]);
    cur = e.stage === 'done' ? null : e.stage;
    t = now;
  });
};

async function scenario(page, name, fn) {
  net = { network: 0, disk: 0, sw: 0, revalidated: 0 };
  const st = server.stats, s0 = { ok: st.ok, nm: st.notModified, bytes: st.bytes, n: st.paths.length };
  await page.evaluate(HOOK).catch(() => {});
  const t0 = Date.now();
  const extra = (await fn()) || 0;
  const ms = Date.now() - t0 - extra;
  await page.waitForTimeout(300);
  const s = await page.evaluate(STAGES);
  // what reached the server (the page's own requests and the service worker's)
  const served = st.paths.slice(s0.n).filter((p) => /^\/(assets|vendor)\//.test(p));
  const card = await page.evaluate(() => window.shadowSix.hud?.loading?.lastRun?.card ?? null);
  const row = { name, ms, card, ...net, served: served.length, paths: served, notModified: st.notModified - s0.nm, mb: +((st.bytes - s0.bytes) / 1e6).toFixed(1), stages: s.stages, mem: s.mem, programs: s.programs };
  net = null;
  rows.push(row);
  console.log(`${name.padEnd(26)} ${String(ms).padStart(6)} ms ${card === false ? '(no card)' : ''} server: ${row.served} assets ${row.notModified}x304 ${row.mb} MB | page: net ${row.network} disk ${row.disk} sw ${row.sw}  ` +
    `geo ${s.mem?.geometries} tex ${s.mem?.textures} prog ${s.programs}  ${s.stages.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  return row;
}

const ready = (page) => page.waitForFunction(() => window.shadowSix?.state === 'briefing' || window.shadowSix?.state === 'playing', null, { timeout: 180000 });
const hud = (page, expr) => page.evaluate(async (src) => { const t = performance.now(); await (0, eval)(src); return performance.now() - t; }, expr);

console.log(`measure-restart: ${base} @ ${MBIT} Mbit/s`);
let page = await attach(await ctx.newPage());
await scenario(page, 'first load M1', async () => {
  await page.goto(`${base}/index.html?mission=m01`);
  await page.waitForFunction(() => window.shadowSix?.events, null, { timeout: 60000 });
  await page.evaluate(HOOK);
  await ready(page);
});
await page.evaluate(() => { const g = window.shadowSix; g.start(); g.hud?.briefing?.close?.(); });
await page.waitForTimeout(2000);
// startMission holds the finished loading screen 400 ms before continuing: not part of the load
// (a warm reload shows no card: no hold)
const viaHud = (expr) => async () => { await hud(page, expr); return (await page.evaluate(() => window.shadowSix.hud.loading.lastRun?.card)) === false ? 0 : 400; };
await scenario(page, 'restart M1', viaHud('window.shadowSix.hud.loading.restart()'));
await page.evaluate(() => { const g = window.shadowSix; g.start(); g.quickSave(); });
await scenario(page, 'quickload M1', viaHud('window.shadowSix.hud.loading.quickLoad()'));
await scenario(page, 'next mission M2', viaHud("window.shadowSix.hud.startMission('m02')"));
await scenario(page, 'load M1 save from M2', viaHud('window.shadowSix.hud.loading.quickLoad()'));
await scenario(page, 'restart M1 again', viaHud('window.shadowSix.hud.loading.restart()'));
await page.close();
page = await attach(await ctx.newPage());
await scenario(page, 'second visit M1', async () => {
  await page.goto(`${base}/index.html?mission=m01`);
  await page.waitForFunction(() => window.shadowSix?.events, null, { timeout: 60000 });
  await page.evaluate(HOOK);
  await ready(page);
});
if (opt('--json')) await import('node:fs').then((fs) => fs.writeFileSync(opt('--json'), JSON.stringify({ mbit: MBIT, rows }, null, 1)));
await browser.close();
await server.close();
