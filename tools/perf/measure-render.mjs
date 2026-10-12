#!/usr/bin/env node
/**
 * Render cost per mission, view and preset: frame wall time (CPU + GPU, synced), main-thread render CPU time, whole-frame
 * GPU time (timer queries), draw calls and triangles, per post pass GPU/CPU time (the sun shadow map split out) and the
 * draws/triangles of each subsystem (terrain, grass, vegetation, buildings, wire, characters, water, decals, …) in each
 * pass. Uses tools/perf/render-probe.js in the page.
 *
 *   node tools/perf/measure-render.mjs [--missions=m01,m03|all] [--configs=desktop-high,phone-medium]
 *        [--views=default,z05,z2,yaw45] [--frames=60] [--out=dir] [--label=base] [--root=<checkout>] [--perdraw]
 *        [--menu] [--throttle=4]
 *
 * Configs: desktop-<preset> (1920×1080, DPR 1) · phone-<preset> (Pixel 7 landscape emulation: 839×412 @2.625, touch,
 * mobile UA; `--throttle=N` adds CDP CPU throttling ×N to the phone runs). Views: `default` = the squad recentred at
 * the default zoom and yaw (what the player sees after the briefing), `z05` / `z2` = same centre at zoom 0.5 / 2,
 * `yaw45` / `yaw0` = default zoom at that camera angle. `--menu` adds the title state (no mission loaded).
 * `--root` serves another checkout (A/B against master: run the same command with --root=<master worktree>).
 * Writes <out>/<label>-<config>.json and prints a markdown table.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const OUT = arg('out', '<projects>/commandos-shots/perf');
const LABEL = arg('label', 'run');
const FRAMES = +arg('frames', 60);
const VIEWS = arg('views', 'default,z05,yaw45').split(',');
const CONFIGS = arg('configs', 'desktop-high').split(',');
const THROTTLE = +arg('throttle', 0);
mkdirSync(OUT, { recursive: true });

const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const { chromium } = PW;
const server = await startServer({ port: 0, root: ROOT });
// the probe is served from this checkout even when --root points elsewhere
const probeSrc = (await import('node:fs')).readFileSync(join(HERE, 'tools/perf/render-probe.js'), 'utf8');
const BASE = server.url.replace(/\/$/, '');

const PIXEL7_LAND = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.33 Mobile Safari/537.36',
  viewport: { width: 839, height: 412 }, screen: { width: 915, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
};

async function launch(cfg) {
  const browser = await chromium.launch({ executablePath: H.findChrome(), headless: true, args: [...H.GPU_ARGS, '--autoplay-policy=no-user-gesture-required'] });
  const [dev, preset] = cfg.split('-');
  const opts = dev === 'phone' ? { ...PIXEL7_LAND } : { viewport: { width: +arg('w', 1920), height: +arg('h', 1080) }, deviceScaleFactor: +arg('dpr', 1) };
  const ctx = await browser.newContext(opts);
  // the probe as a blob module (works with --root on a checkout that lacks it)
  await ctx.addInitScript((src) => { window.__probeUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); }, probeSrc);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  if (dev === 'phone' && THROTTLE > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  await page.goto(`${BASE}/index.html?test=1&preset=${preset}`, { timeout: 180000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
  await page.evaluate(async () => {
    const { installRenderProbe } = await import(window.__probeUrl);
    window.__probe = installRenderProbe(window.__game.game, {});
    window.__probeD = null;
    window.__installProbeD = async () => { if (!window.__probeD) { window.__probe.uninstall(); window.__probeD = installRenderProbe(window.__game.game, { perDraw: true }); } };
  });
  return { browser, ctx, page, errs, preset };
}

/** One view's measurements (runs in the page). */
async function measureView(page, view, frames, perDraw) {
  return page.evaluate(async ({ view, frames, perDraw }) => {
    const g = window.__game, G = g.game, cc = G.cameraController, rig = G.cameraRig;
    if (view.yaw != null) rig.setYaw(view.yaw);
    if (view.zoom != null) cc.setZoom(view.zoom, true);
    if (view.center) cc.centerOn(view.center.x, view.center.z);
    for (let i = 0; i < 8; i++) G.render(1 / 60, 1);
    const gl = G.renderer.renderer.getContext(), px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // main-thread cost of a frame (not synced: GL calls are queued)
    const cpu = [];
    for (let i = 0; i < frames; i++) { const t0 = performance.now(); G.render(1 / 60, 1); cpu.push(performance.now() - t0); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const b = await g.bench(frames);
    const p = window.__probe;
    p.begin();
    for (let i = 0; i < Math.min(30, frames); i++) G.render(1 / 60, 1);
    const prob = await p.end();
    let d = null;
    if (perDraw) {
      await window.__installProbeD();
      window.__probeD.begin();
      for (let i = 0; i < 20; i++) G.render(1 / 60, 1);
      d = await window.__probeD.end();
    }
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };
    const st = G.renderer.stats();
    // reset the view for the next one
    if (view.yaw != null) rig.setYaw(G.CONFIG?.camera?.yawDeg ?? 15);
    return {
      view: view.name, size: st.size, pixelRatio: st.pixelRatio, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      wall: b.wallMedian, wallP95: b.wallP95, gpu: b.gpuMedian, gpuP95: b.gpuP95, cpu: med(cpu), calls: st.calls, tris: st.triangles,
      passes: prob.gpu, passesCpu: prob.cpu, draws: prob.draws, perDraw: d?.gpu || null,
    };
  }, { view, frames, perDraw });
}

async function missionIds(page) {
  return page.evaluate(async () => (await import('/src/missions/index.js')).MISSIONS.filter((m) => !m.dev && m.campaign !== 'BCD').map((m) => m.id));
}

function viewSpec(name, yaw0) {
  if (name === 'default') return { name };
  if (name === 'z05') return { name, zoom: 0.5 };
  if (name === 'z2') return { name, zoom: 2 };
  if (/^yaw\d+$/.test(name)) return { name, yaw: +name.slice(3) };
  throw new Error('unknown view ' + name);
}

const results = {};
const summary = [];
for (const cfg of CONFIGS) {
  results[cfg] = [];
  let run = await launch(cfg);
  let ids = arg('missions', 'm01,m02,m03');
  ids = ids === 'all' ? await missionIds(run.page) : ids.split(',');
  if (flag('menu')) {
    const r = await measureView(run.page, { name: 'menu' }, FRAMES, false);
    r.mission = 'menu';
    results[cfg].push(r);
    summary.push({ cfg, ...r });
    console.log(`${cfg} menu wall ${r.wall} cpu ${r.cpu} gpu ${r.gpu} calls ${r.calls} tris ${r.tris}`);
  }
  for (const id of ids) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!run) run = await launch(cfg);
        const t0 = Date.now();
        await run.page.evaluate(async (m) => {
          const g = window.__game, G = g.game;
          await g.loadMission(m);
          g.start();
          G.focusSquad?.();
          for (let i = 0; i < 30; i++) g.advance(1 / 30);
          // the texture warmer uploads a few textures per real frame: let it finish (steady state)
          for (let i = 0; i < 400 && G.textureWarmer?.queue.length; i++) { G.frame(1 / 60); await new Promise((ok) => setTimeout(ok, 0)); }
          G.focusSquad?.();
        }, id);
        const loadMs = Date.now() - t0;
        for (const vn of VIEWS) {
          const r = await measureView(run.page, viewSpec(vn), FRAMES, flag('perdraw'));
          r.mission = id; r.loadMs = loadMs;
          results[cfg].push(r);
          summary.push({ cfg, ...r });
          console.log(`${cfg} ${id} ${vn} wall ${r.wall} cpu ${r.cpu} gpu ${r.gpu} calls ${r.calls} tris ${r.tris}`);
        }
        // a fresh page per mission: no carry-over of the previous mission's GPU memory / caches
        await run.browser.close();
        run = null;
        break;
      } catch (e) {
        console.log(`${cfg} ${id} attempt ${attempt} failed: ${e.message.split('\n')[0]}`);
        await run?.browser.close().catch(() => {});
        run = null;
      }
    }
  }
  if (run) { if (run.errs.length) console.log('page errors:', run.errs.slice(0, 5)); await run.browser.close(); }
  writeFileSync(join(OUT, `${LABEL}-${cfg}.json`), JSON.stringify(results[cfg], null, 1));
}
await server.close();

// markdown summary
console.log('\n| config | mission | view | wall ms | cpu ms | gpu ms | calls | tris (k) | shadow gpu | main gpu | ao gpu |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const pick = (o, re) => +Object.entries(o || {}).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0).toFixed(3);
for (const r of summary) {
  console.log(`| ${r.cfg} | ${r.mission} | ${r.view} | ${r.wall} | ${r.cpu} | ${r.gpu} | ${r.calls} | ${Math.round(r.tris / 1000)} | ${pick(r.passes, /^shadow/)} | ${pick(r.passes, /^0:RenderPass/)} | ${pick(r.passes, /GTAO/)} |`);
}
