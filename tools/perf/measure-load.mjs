#!/usr/bin/env node
/**
 * Transfer bytes per mission (fresh browser context = cold cache), grouped by folder.
 *
 *   node tools/perf/measure-load.mjs [--preset=high,low] [--missions=m01,m02] [--json=out.json] [--list] [--budget]
 *
 * Boot bytes (index.html → title) and mission bytes (loadMission + the talking portraits + the mission's sound pack,
 * with the audio unlocked as after a real click) are reported separately. Sizes are response body bytes (GitHub
 * Pages gzips text on top of this; binaries are sent as-is). --budget writes assets/load-budget.json (the loading
 * screen's expected bytes per mission and preset, engine/load-progress.js).
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const presets = arg('preset', 'high,low').split(',');
const missions = arg('missions', 'm00,m01,m02,m03').split(',');
const LIST = process.argv.includes('--list');
const h = await startHarness({});
const out = [];
const group = (u) => {
  const p = new URL(u).pathname.replace(/^\//, '');
  const s = p.split('/');
  return s[0] === 'assets' ? s.slice(0, 3).join('/') : s[0];
};
for (const preset of presets) {
  for (const id of missions) {
    const ctx = await h.browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const rec = [];
    let phase = 'boot';
    page.on('response', async (r) => {
      const ph = phase;
      try { const b = await r.body(); rec.push({ url: r.url(), bytes: b.length, phase: ph }); } catch { /* redirect */ }
    });
    const t0 = Date.now();
    await page.goto(`${h.url}/index.html?test=1&preset=${preset}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    await page.waitForTimeout(500);
    phase = 'mission';
    const t1 = Date.now();
    const inGame = await page.evaluate(async (m) => {
      const G = window.__game.game;
      G.audio?.unlock?.();
      await window.__game.loadMission(m);
      await Promise.race([Promise.all([G.hud?.portraitsReady, G.audio?.preloading].filter(Boolean)), new Promise((ok) => setTimeout(ok, 10000))]);
      return G.lastLoad || null;
    }, id);
    const loadMs = Date.now() - t1;
    await page.waitForTimeout(1500);
    const sum = (ph) => rec.filter((x) => x.phase === ph).reduce((a, x) => a + x.bytes, 0);
    const groups = {};
    for (const x of rec.filter((x) => x.phase === 'mission')) groups[group(x.url)] = (groups[group(x.url)] || 0) + x.bytes;
    // site-relative asset URLs of the mission phase: assets/mission-assets.json (engine/offline-cache.js prefetch)
    const base = new URL(h.url + '/').href;
    const assetUrls = [...new Set(rec.filter((x) => x.phase === 'mission').map((x) => x.url.replace(/[?#].*$/, '')).filter((u) => u.startsWith(base))
      .map((u) => u.slice(base.length)).filter((u) => /^(assets|vendor)\//.test(u)))].sort();
    const row = { assetUrls, inGameMB: inGame ? +(inGame.bytes / 1e6).toFixed(1) : null, preset, id, bootMB: +(sum('boot') / 1e6).toFixed(1), missionMB: +(sum('mission') / 1e6).toFixed(1), files: rec.length, loadMs, bootMs: t1 - t0, groups };
    out.push(row);
    console.log(`${preset.padEnd(5)} ${id}  boot ${row.bootMB} MB  mission ${row.missionMB} MB  total ${(row.bootMB + row.missionMB).toFixed(1)} MB  ${rec.length} files  load ${loadMs} ms  (loadMission saw ${row.inGameMB} MB)`);
    for (const [g, b] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${(b / 1e6).toFixed(2).padStart(7)} MB  ${g}`);
    if (LIST) for (const x of rec.sort((a, b) => b.bytes - a.bytes).slice(0, 40)) console.log(`        ${(x.bytes / 1e6).toFixed(2)} ${x.phase} ${new URL(x.url).pathname}`);
    await ctx.close();
  }
}
if (process.argv.includes('--budget')) {
  const b = { about: 'Expected transfer bytes per mission load (cold cache), by preset. Written by tools/perf/measure-load.mjs --budget; read by src/engine/load-progress.js for the loading bar. Missions not listed use default.', default: 90e6, missions: {} };
  for (const r of out) (b.missions[r.id] ||= {})[r.preset] = Math.round((r.inGameMB ?? r.missionMB) * 1e6); // what loadMission itself sees
  writeFileSync(join(ROOT, 'assets/load-budget.json'), JSON.stringify(b, null, 1) + '\n');
  console.log('wrote assets/load-budget.json');
  // what each mission downloads, for the background prefetch of the next campaign mission (merged: missions and
  // presets not measured this run keep their lists)
  const listFile = join(ROOT, 'assets/mission-assets.json');
  let L = null;
  try { L = JSON.parse(readFileSync(listFile, 'utf8')); } catch { L = null; }
  L = { about: 'Site-relative asset URLs each mission loads, by preset. Written by tools/perf/measure-load.mjs --budget; read by src/engine/offline-cache.js to prefetch the next campaign mission into the service worker cache.', presets: L?.presets || {} };
  for (const r of out) (L.presets[r.preset] ||= {})[r.id] = r.assetUrls;
  writeFileSync(listFile, JSON.stringify(L) + '\n');
  console.log('wrote assets/mission-assets.json');
}
const j = arg('json', '');
if (j) writeFileSync(j, JSON.stringify(out.map(({ assetUrls, ...r }) => ({ ...r, assets: assetUrls.length })), null, 1));
await h.close();
