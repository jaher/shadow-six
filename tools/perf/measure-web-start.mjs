#!/usr/bin/env node
/**
 * First-visit start-up time of the web build on a throttled connection (cold cache, GPU headless Chromium).
 *
 *   npm run build && node tools/perf/measure-web-start.mjs [--mbit=20] [--rtt=40] [--dev] [--repeat]
 *
 * Serves dist/ under /shadow-six/ (or the dev tree with --dev) and reports, from navigation start:
 *   paint   first contentful paint (index.html's own loading screen)
 *   boot    the game script ran (boot phase set: disclaimer on screen)
 *   ready   the menu preload finished (splash shows PRESS ANY KEY once the intro is over)
 *   menu    the MAIN menu is on screen: first visit plays the disclaimer + ident (≈ 8 s, skippable), so this is
 *           max(intro, ready); --repeat marks the intro as seen (returning player: disclaimer only)
 * plus the bytes transferred before `ready` and before `menu`.
 */
import { pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const mbit = Number(arg('mbit', '20')), rtt = Number(arg('rtt', '40'));
if (!process.argv.includes('--dev')) process.env.SS_DIST ||= '1';
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const h = await startHarness({});
try {
  const ctx = await h.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt,
    downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 });
  let bytes = 0, reqs = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; reqs++; });
  if (process.argv.includes('--repeat')) {
    await page.goto(`${h.url}/version.json`).catch(() => {});
    await page.evaluate(() => localStorage.setItem('shadowsix.intro.seen', '1'));
  }
  const t0 = Date.now();
  await page.goto(`${h.url}/index.html`, { waitUntil: 'commit' });
  const at = {}, mark = (k) => { at[k] = { ms: Date.now() - t0, mb: bytes / 1e6, reqs }; };
  const poll = async () => {
    for (;;) {
      const s = await page.evaluate(() => ({
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        boot: !!window.shadowSix?.hud?.boot?.phase,
        ready: !!window.shadowSix?.hud?.boot?.ready,
        splash: window.shadowSix?.hud?.boot?.phase === 'splash' && /PRESS ANY KEY/.test(document.querySelector('.bt-prompt')?.textContent || ''),
      })).catch(() => ({}));
      if (s.fcp != null && !at.paint) at.paint = { ms: Math.round(s.fcp), mb: null, reqs: null };
      if (s.boot && !at.boot) mark('boot');
      if (s.ready && !at.ready) mark('ready');
      if (s.splash && !at.splash) {
        mark('splash');
        await page.keyboard.press('Enter');
        await page.keyboard.press('KeyN');   // (N)O on the NEW USER card → MAIN
      }
      const main = await page.evaluate(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'main').catch(() => false);
      if (main) { mark('menu'); break; }
      if (Date.now() - t0 > 240000) throw new Error('timeout waiting for the menu');
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  await poll();
  console.log(`${process.env.SS_DIST ? 'dist (/shadow-six/)' : 'dev tree'} @ ${mbit} Mbit/s, ${rtt} ms RTT, cold cache${process.argv.includes('--repeat') ? ', intro seen' : ''}`);
  for (const [k, v] of Object.entries(at)) {
    console.log(`  ${k.padEnd(7)} ${(v.ms / 1000).toFixed(2).padStart(6)} s${v.mb != null ? `  ${v.mb.toFixed(1).padStart(6)} MB  ${String(v.reqs).padStart(4)} requests` : ''}`);
  }
  await ctx.close();
} finally {
  await h.close();
}
