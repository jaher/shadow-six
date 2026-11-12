#!/usr/bin/env node
/**
 * Ruin review stills from the real game camera (pitch 40°, the default yaw, orthographic zoom): every ruined
 * structure of the listed missions (ruins, ruined walls, bombed shells, brick heaps — vehicle wrecks left out), each
 * at the given zooms, the HUD hidden. `--root` serves another checkout (master, for a before / after pair).
 *
 *   node tools/perf/ruinshot.mjs --missions=m04,m10 --out=dir [--tag=after] [--root=<checkout>] [--zooms=1,2]
 *        [--ids=rw1,ruin_s] [--size=1600x900] [--preset=high] [--at=m10:24:80:1.5]   (extra views: mission:x:z:zoom)
 *
 * Files: <out>/<mission>-<id>-z<zoom>-<tag>.jpg (quality 88). Prints the list it shot.
 */
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ROOT = resolve(arg('root', HERE));
const out = resolve(arg('out', 'ruinshots')), tag = arg('tag', 'shot');
const [W, H] = arg('size', '1600x900').split('x').map(Number);
const zooms = arg('zooms', '1,2').split(',').map(Number);
const only = arg('ids', '') ? new Set(arg('ids').split(',')) : null;
const extra = arg('at', '') ? arg('at').split(',').map((s) => s.split(':')) : [];
mkdirSync(out, { recursive: true });

const H_ = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H_.findChrome(), headless: true, args: H_.GPU_ARGS });
const missions = arg('missions', 'm10').split(',');
const shot = [];
try {
  for (const mid of missions) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.setDefaultTimeout(0);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 300)));
    await page.goto(`${server.url.replace(/\/$/, '')}/index.html?test=1&preset=${arg('preset', 'high')}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
    const targets = await page.evaluate(async (m) => {
      const g = window.__game, G = g.game;
      await g.loadMission(m); g.start();
      for (let i = 0; i < 30; i++) g.step();
      for (let i = 0; i < 600 && G.textureWarmer?.queue.length; i++) G.textureWarmer.step(50);
      const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
      for (const el of document.querySelectorAll('.ui-cursor,.ui-portraits,.ui-knapsack,.ui-notebook')) el.style.display = 'none';
      const { getMission } = await import('/src/missions/index.js');
      const RX = /ruin|bombed|rubble|brick_heap|burnt_walls|wall_stub|mudbrick_broken|arch_mud|stone_arch|brick_shell|tower_stub/i;
      const list = [];
      for (const s of getMission(m).structures || []) {
        const v = String(s.variant ?? ''), a = String(s.asset ?? '');
        if (s.vehicleArt || /wreck|bulldozer|tunnel|gantry|truck|aircraft|panzer|bridge/.test(v) || s.type === 'trench') continue;
        if (!(s.type === 'ruins' || RX.test(v) || RX.test(a) || s.destroyed || s.ruined)) continue;
        let x = s.x, z = s.z;
        if (s.points) { const P = s.points; x = P.reduce((q, p) => q + p[0], 0) / P.length; z = P.reduce((q, p) => q + p[1], 0) / P.length; }
        list.push({ id: s.id, x, z });
      }
      return list;
    }, mid);
    const views = [];
    for (const t of targets) if (!only || only.has(t.id)) for (const z of zooms) views.push({ id: t.id, x: t.x, z: t.z, zoom: z });
    for (const [m, x, z, zz] of extra) if (m === mid) views.push({ id: `at${(+x).toFixed(0)}_${(+z).toFixed(0)}`, x: +x, z: +z, zoom: +(zz || 1) });
    for (const v of views) {
      await page.evaluate(({ x, z, zoom }) => {
        const g = window.__game;
        g.setZoom(zoom); g.centerOn(x, z);
        for (let i = 0; i < 4; i++) g.step();
        g.render();
      }, v);
      await page.waitForTimeout(120);
      await page.evaluate(() => window.__game.render());
      const f = join(out, `${mid}-${v.id}-z${v.zoom}-${tag}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
      shot.push(f);
    }
    console.log(`${mid}: ${views.length} views (${targets.map((t) => t.id).join(' ')})${errs.length ? ` errors: ${errs.slice(0, 3).join(' | ')}` : ''}`);
    await page.close();
  }
} finally {
  await browser.close(); await server.close();
}
console.log(shot.length, 'stills in', out);
