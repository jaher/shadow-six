#!/usr/bin/env node
/**
 * Cold first-visit download + start-up timeline of a mission, as a player sees it (perf/download-speed).
 *
 *   node tools/perf/measure-download.mjs [--root=dist | --site=https://jaher.github.io/shadow-six/]
 *        [--mbit=25] [--rtt=40] [--missions=m01,m03,m20] [--presets=low,high] [--runs=1] [--json=out.json] [--menu]
 *        [--after=12] [--q=extra=url&params] [--menu-wait=0]
 *
 * --root serves a web build (default dist/, `npm run build`) under /shadow-six/ the way GitHub Pages does: HTTP/2 over
 * TLS (tools/serve.mjs h2, self-signed — Chromium runs with --ignore-certificate-errors), text gzipped, max-age=600 —
 * through ONE shared link of --mbit with --rtt ms before each response (tools/serve.mjs throttle: it also covers the
 * service worker's fetches, which DevTools throttling of the page does not; the worker installs during the menu and
 * then fetches every mission asset). Bytes and files come from the server's log of what crossed the link.
 * --site measures a live deployment instead (read-only): DevTools-protocol throttling of the page, service worker
 * blocked (so every request is the page's own and is throttled), bytes = the protocol's encoded data length.
 * Each run is a fresh browser context: cold HTTP cache, no service worker yet.
 *
 * Timeline (seconds): menu = navigation → MAIN menu (intro marked seen: the disclaimer only; --menu also times a first
 * visit with the full intro, skipped at the splash); then from the click on a mission (hud.startMission, as the map
 * table does): card = loading screen up, brief = briefing open (load done, the card's settle included), play = first
 * frame drawn in 'playing' after START MISSION is pressed at once (no reading time); plus what downloads during the
 * first --after seconds of play. Top contributors by type / folder and the largest files of the mission phase.
 * Main-thread long tasks (PerformanceObserver 'longtask', > 50 ms) are counted on the menu (from MAIN to the click) and
 * during the load (click → briefing); --menu-wait=S stays S seconds on the menu first (its live diorama: downloads +
 * build) — the menu must never freeze. --eager clicks the mission as soon as MAIN shows (no wait for the menu's own
 * downloads: a player who picks a mission at once — the menu's background work then competes with the load).
 */
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const H = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(ROOT, 'tools/serve.mjs')).href);
const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules/playwright-core/index.mjs')).href);

const mbit = +arg('mbit', 25), rtt = +arg('rtt', 40), runs = +arg('runs', 1), after = +arg('after', 12), menuWait = +arg('menu-wait', 0);
const missions = arg('missions', 'm01,m03,m20').split(',');
const presets = arg('presets', 'low,high').split(',');
const extraQ = arg('q', '');
const site = arg('site', '');
let base = site, server = null;
if (!site) {
  server = await startServer({ port: 0, root: resolve(ROOT, arg('root', 'dist')), base: '/shadow-six/', gzip: true, pages: true, h2: true, log: true, mbit, latencyMs: rtt });
  base = server.url;
}
if (!base.endsWith('/')) base += '/';
const browser = await chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--ignore-certificate-errors'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kindOf = (p) => (p.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '?';
const folderOf = (p) => {
  const s = p.split('/');
  return s[0] === 'assets' ? s.slice(0, Math.min(3, s.length - 1)).join('/') : s.length === 1 ? '(root)' : s[0];
};

/** One cold run: the timeline + the requests that crossed the link, each tagged with the phase it started in. */
async function coldRun(mission, preset, { fullIntro = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true, serviceWorkers: site ? 'block' : 'allow' });
  await ctx.addInitScript(() => {
    window.__dlLT = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__dlLT.push([performance.timeOrigin + e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push((e.message || String(e)).slice(0, 200)));
  const T0 = Date.now();
  const now = () => (Date.now() - T0) / 1000;
  const marks = []; // [s, phase]
  let phase = 'pre';
  const setPhase = (p) => { phase = p; marks.push([now(), p]); };
  const cdpReqs = new Map();
  if (site) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (10 * 1e6) / 8 });
    cdp.on('Network.requestWillBeSent', (e) => { if (!cdpReqs.has(e.requestId)) cdpReqs.set(e.requestId, { url: e.request.url, t0: now(), bytes: 0 }); });
    cdp.on('Network.responseReceived', (e) => { const r = cdpReqs.get(e.requestId); if (r) r.status = e.response.status; });
    cdp.on('Network.loadingFinished', (e) => { const r = cdpReqs.get(e.requestId); if (r) { r.t1 = now(); r.bytes = e.encodedDataLength; } });
    cdp.on('Network.loadingFailed', (e) => { const r = cdpReqs.get(e.requestId); if (r) { r.t1 = now(); r.failed = e.errorText; } });
  }
  const log0 = server ? server.stats.log.length : 0;
  const at = {};
  if (!fullIntro) {
    // (an origin page to write localStorage on; retried: a slow first response can still be navigating)
    for (let i = 0; i < 5; i++) {
      await page.goto(`${base}version.json`, { waitUntil: 'load' }).catch(() => {});
      if (await page.evaluate(() => { localStorage.setItem('shadowsix.intro.seen', '1'); return true; }).catch(() => false)) break;
      await sleep(500);
    }
  }
  setPhase('menu');
  const tNav = now();
  await page.goto(`${base}index.html?preset=${preset}${extraQ ? '&' + extraQ : ''}`, { waitUntil: 'commit', timeout: 120000 });
  // menu: splash ready → Enter → (N)O on the new-user card → MAIN
  for (let pressed = false; ;) {
    const s = await page.evaluate(() => ({
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
      ready: !!window.shadowSix?.hud?.boot?.ready,
      splash: window.shadowSix?.hud?.boot?.phase === 'splash' && /PRESS ANY KEY/.test(document.querySelector('.bt-prompt')?.textContent || ''),
      main: document.querySelector('.mk-host .mk-card')?.dataset.card === 'main',
    })).catch(() => ({}));
    if (s.fcp != null && at.fcp == null) at.fcp = s.fcp / 1000;
    if (s.ready && at.ready == null) at.ready = now() - tNav;
    if (s.splash && !pressed) { pressed = true; at.splash = now() - tNav; await page.keyboard.press('Enter'); await sleep(150); await page.keyboard.press('KeyN'); }
    if (s.main) { at.menu = now() - tNav; break; }
    if (now() - tNav > 300) throw new Error('timeout waiting for the menu');
    await sleep(50);
  }
  const tMain = Date.now();
  if (menuWait > 0) await sleep(menuWait * 1000);
  // the menu's own background loads (title diorama, menu sounds, the service worker's install) finish first, so they
  // are not billed to the mission
  for (let quiet = 0, t = now(); !process.argv.includes('--eager') && now() - t < 40 && quiet < 2;) {
    await sleep(250);
    const busy = server ? server.stats.log.slice(log0).some((e) => e.t1 == null) : [...cdpReqs.values()].some((r) => r.t1 == null);
    quiet = busy ? 0 : quiet + 0.25;
  }
  const tClick = Date.now();
  setPhase('load');
  const tS = now();
  // stage changes of the load (Game.loadMission 'mission:progress'), in seconds from the click
  await page.evaluate((m) => {
    const t0 = performance.now(), st = (window.__dlStages = []);
    window.shadowSix.events.on('mission:progress', (e) => { if (!st.length || st[st.length - 1][1] !== e.stage) st.push([(performance.now() - t0) / 1000, e.stage]); });
    window.shadowSix.events.on('mission:loaded', () => st.push([(performance.now() - t0) / 1000, 'loaded']));
    // the moment the briefing opens, stamped in the page (epoch ms): the phase boundary 'load' | 'play' is exact, not
    // the next 50 ms poll (downloads that start as the briefing opens belong to the briefing)
    const b = window.shadowSix.hud.briefing, open = b.open;
    b.open = function (...a) { if (window.__dlBriefAt == null) window.__dlBriefAt = performance.timeOrigin + performance.now(); return open.apply(this, a); };
    window.shadowSix.hud.startMission(m);
  }, mission);
  for (;;) {
    const s = await page.evaluate(() => {
      const G = window.shadowSix;
      const b = document.querySelector('.ui-briefing');
      return { card: !!document.querySelector('.mk-loading'), brief: !!b && !b.hidden && G.hud?.briefing?.part > 0 };
    }).catch(() => ({}));
    if (s.card && at.card == null) at.card = now() - tS;
    if (s.brief) { at.brief = now() - tS; break; }
    if (now() - tS > 900) throw new Error('timeout waiting for the briefing');
    await sleep(50);
  }
  const briefAt = await page.evaluate(() => window.__dlBriefAt ?? null).catch(() => null);
  if (briefAt != null && briefAt - T0 > 0) { at.brief = (briefAt - T0) / 1000 - tS; phase = 'play'; marks.push([(briefAt - T0) / 1000, 'play']); }
  else setPhase('play');
  await page.evaluate(() => window.shadowSix.hud.briefing.finish());
  await page.waitForFunction(() => window.shadowSix.state === 'playing', null, { timeout: 120000 });
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  at.play = now() - tS;
  setPhase('after');
  await sleep(after * 1000);
  const lt = await page.evaluate(() => window.__dlLT || []).catch(() => []);
  const ltIn = (a, b) => lt.filter(([t]) => t >= a && t < b).map(([, d]) => Math.round(d));
  const tBriefEpoch = T0 + (tS + at.brief) * 1000;
  const longTasks = { menu: ltIn(tMain, tClick), load: ltIn(tClick, tBriefEpoch) };
  const info = await page.evaluate(() => ({ lastLoad: window.shadowSix.lastLoad || null, sw: !!navigator.serviceWorker?.controller, stages: window.__dlStages, early: globalThis.__ssEarlyFetch ? { ...globalThis.__ssEarlyFetch } : null })).catch(() => ({}));
  await ctx.close();
  setPhase('end');
  const phaseAt = (t) => { let p = 'pre'; for (const [s, q] of marks) if (t >= s) p = q; return p; };
  const list = server
    ? server.stats.log.slice(log0).map((e) => ({ path: e.rel.replace(/^\//, ''), t0: (e.t0 - T0) / 1000, t1: e.t1 != null ? (e.t1 - T0) / 1000 : null, bytes: e.bytes }))
    : [...cdpReqs.values()].filter((r) => /^https?:/.test(r.url)).map((r) => ({ ...r, path: decodeURIComponent(new URL(r.url).pathname).replace(/^\/shadow-six\//, '').replace(/^\//, '') }));
  for (const r of list) r.phase = phaseAt(r.t0);
  if (process.env.MD_DUMP) writeFileSync(`${process.env.MD_DUMP}-${mission}-${preset}.json`, JSON.stringify({ at, tS, list }));
  return { mission, preset, at, list, tS, tB: tS + at.brief, errs, longTasks, menuSecs: (tClick - tMain) / 1000, sw: info.sw, lastLoad: info.lastLoad, stages: info.stages || [], early: info.early || null };
}

function summarize(run) {
  const by = (ph) => run.list.filter((r) => r.phase === ph);
  const sum = (l) => l.reduce((a, r) => a + (r.bytes || 0), 0);
  const ph = {};
  for (const p of ['menu', 'load', 'play', 'after']) ph[p] = { MB: +(sum(by(p)) / 1e6).toFixed(2), reqs: by(p).length };
  const load = [...by('load'), ...by('play')];
  const groups = {}, kinds = {};
  for (const r of load) {
    const g = folderOf(r.path) + ' .' + kindOf(r.path), k = kindOf(r.path);
    (groups[g] ||= { MB: 0, n: 0 }).MB += (r.bytes || 0) / 1e6; groups[g].n++;
    (kinds[k] ||= { MB: 0, n: 0 }).MB += (r.bytes || 0) / 1e6; kinds[k].n++;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1].MB - a[1].MB).slice(0, n).map(([k, v]) => [k, +v.MB.toFixed(2), v.n]);
  // link busy share during the load (click → briefing): bytes that crossed the link / what the link could carry
  const inLoad = run.list.filter((r) => r.t0 >= run.tS && r.t0 <= run.tB);
  const util = sum(inLoad) / ((run.tB - run.tS) * mbit * 125000);
  // when the last byte of the load phase arrived, relative to the click (network-bound part of the load)
  const lastByte = Math.max(0, ...inLoad.map((r) => (r.t1 ?? r.t0) - run.tS));
  return {
    mission: run.mission, preset: run.preset, sw: run.sw,
    at: Object.fromEntries(Object.entries(run.at).map(([k, v]) => [k, +v.toFixed(2)])),
    phases: ph, linkUse: +util.toFixed(2), lastByte: +lastByte.toFixed(1),
    // per load stage: when it started (s from the click) and the MB that crossed the link while it ran
    stages: run.stages.map(([t, name], i) => {
      const t1 = run.stages[i + 1]?.[0] ?? run.at.brief;
      const mb = run.list.filter((r) => r.t0 - run.tS >= t && r.t0 - run.tS < t1).reduce((a, r) => a + (r.bytes || 0), 0) / 1e6;
      return [name, +t.toFixed(1), +mb.toFixed(1)];
    }),
    byKind: top(kinds, 12), byFolder: top(groups, 16),
    topFiles: load.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 15).map((r) => [r.path, +((r.bytes || 0) / 1e6).toFixed(2)]),
    failed: run.list.filter((r) => r.failed || r.status >= 400).map((r) => `${r.status || r.failed} ${r.path}`).slice(0, 10),
    errs: run.errs.slice(0, 5),
    early: run.early,
    longTasks: Object.fromEntries(Object.entries(run.longTasks || {}).map(([k, v]) => [k, { n: v.length, max: v.length ? Math.max(...v) : 0, total: v.reduce((a, x) => a + x, 0), over200: v.filter((x) => x > 200).length }])),
    menuSecs: +(run.menuSecs || 0).toFixed(1),
    lastLoad: run.lastLoad && { MB: +(run.lastLoad.bytes / 1e6).toFixed(1), files: run.lastLoad.files, s: +((run.lastLoad.ms || 0) / 1000).toFixed(1) },
  };
}

const out = { base, mode: site ? 'live, DevTools throttle, SW blocked' : 'local h2, server link throttle', mbit, rtt, date: new Date().toISOString(), runs: [] };
try {
  if (process.argv.includes('--menu')) {
    const s = summarize(await coldRun(missions[0], presets[0], { fullIntro: true }));
    out.menu = s;
    console.log(`first visit (full intro, Enter at the splash): fcp ${s.at.fcp?.toFixed(2)} s, preload done ${s.at.ready?.toFixed(2)} s, splash ${s.at.splash?.toFixed(2)} s, MAIN ${s.at.menu?.toFixed(2)} s; ${s.phases.menu.MB} MB / ${s.phases.menu.reqs} requests`);
  }
  for (const m of missions) {
    for (const p of presets) {
      for (let i = 0; i < runs; i++) {
        const s = summarize(await coldRun(m, p));
        out.runs.push(s);
        console.log(`${m} ${p} #${i}: menu ${s.at.menu.toFixed(1)} s ${s.phases.menu.MB} MB/${s.phases.menu.reqs} | card ${s.at.card?.toFixed(2)} s, briefing ${s.at.brief.toFixed(1)} s, playing ${s.at.play.toFixed(1)} s (last load byte ${s.lastByte} s) | load ${s.phases.load.MB} MB/${s.phases.load.reqs}, at start +${s.phases.play.MB} MB, ${after} s of play +${s.phases.after.MB} MB/${s.phases.after.reqs} | link use ${Math.round(s.linkUse * 100)} %${s.sw ? ' (sw)' : ''}`);
        console.log('   stages (start s, MB requested):', s.stages.map(([n, t, mb]) => `${n}@${t} ${mb}`).join('  '));
        console.log('   kinds:', s.byKind.map(([k, mb, n]) => `${k} ${mb}MB/${n}`).join('  '));
        console.log('   folders:', s.byFolder.slice(0, 12).map(([k, mb, n]) => `${k} ${mb}/${n}`).join('  '));
        console.log('   top:', s.topFiles.slice(0, 8).map(([k, mb]) => `${k.split('/').slice(-2).join('/')} ${mb}`).join('  '));
        if (s.early) console.log('   early fetch:', JSON.stringify(s.early));
        console.log(`   long tasks: menu (${s.menuSecs} s) ${JSON.stringify(s.longTasks.menu)}  load ${JSON.stringify(s.longTasks.load)}`);
        if (s.failed.length || s.errs.length) console.log('   !!', s.failed.join(' | '), s.errs.join(' | '));
      }
    }
  }
} finally {
  const j = arg('json', '');
  if (j) writeFileSync(j, JSON.stringify(out, null, 1) + '\n');
  await browser.close().catch(() => {});
  await server?.close().catch(() => {});
}
