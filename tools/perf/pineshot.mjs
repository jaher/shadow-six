#!/usr/bin/env node
/**
 * Conifer look-dev frames + tree perf (pine-needle rework).
 *
 *   node tools/perf/pineshot.mjs --mission=m01 --at=x:z --zooms=1,2 --out=dir/prefix [--preset=high] [--perf=1] [--list=1]
 *   node tools/perf/pineshot.mjs --grove=snow:spruce,scots_pine [--forest=400] ...   (sandbox look-dev stand)
 *
 * Loads the mission in test mode, centres the camera at `at` (default: the densest conifer stand), freezes the sim
 * after a fixed advance (identical framings before/after), saves <out>-z<zoom>.png per zoom. --perf prints the mean
 * CPU render time over 60 frames, GPU-synced frame time, draw calls and the vegetation stats. --list prints conifers.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'pineshot');
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}${arg('query', '')}`, { timeout: 150000 });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180000 });
const info = await page.evaluate(async ({ m, at, list, grove, forest }) => {
  const g = window.__game, G = g.game;
  if (grove) { // sandbox re-themed with a row of each conifer species (look-dev): --grove=snow:spruce,scots_pine,...
    const [theater, list] = grove.split(':');
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    const sp = (list || 'spruce,fir,scots_pine,stone_pine,pine').split(',');
    const trees = sp.flatMap((s, i) => [0, 1].map((k) => ({ type: 'pine', species: s, x: 5 + i * 11 + k * 4, z: 40 + k * 12, seed: 900 + i * 17 + k })));
    if (forest) for (let k = 0; k < forest; k++) { // dense stand on the west bank: past the unique budget → impostors
      const h = Math.sin(k * 12.9898) * 43758.5453, u = h - Math.floor(h), v = (k * 0.618034) % 1;
      trees.push({ type: 'pine', species: sp[k % sp.length], x: 2 + u * 34, z: 2 + v * 24, seed: 3000 + k });
    }
    await G.loadMission({ ...base, id: 'm00', theater, structures: [...base.structures.filter((s) => !['tree', 'pine', 'bush', 'fence'].includes(s.type)), ...trees] });
    at = at || `${7 + (sp.length - 1) * 5.5}:40`;
  } else await g.loadMission(m);
  g.start();
  if (G.world.terrain?.ready) await G.world.terrain.ready;
  const v = G.world.terrain?.vegetation;
  const trees = (v?.trees || []).filter((t) => /spruce|fir|pine/.test(t.species));
  let x, z;
  if (at) [x, z] = at.split(':').map(Number);
  else { // densest conifer stand
    let best = -1;
    for (const t of trees) { const n = trees.filter((u) => Math.hypot(u.x - t.x, u.z - t.z) < 12).length; if (n > best) { best = n; x = t.x; z = t.z; } }
  }
  G.cameraController.setZoom(1);
  G.cameraController.centerOn(x, z);
  g.advance(2);
  return { x, z, stats: v?.stats, n: trees.length, list: list ? trees.map((t) => [t.species, +t.x.toFixed(1), +t.z.toFixed(1), +(t.height || 0).toFixed(1)]) : undefined };
}, { m: arg('mission', 'm01'), at: arg('at', ''), list: !!arg('list', ''), grove: arg('grove', ''), forest: Number(arg('forest', 0)) });
console.log('at', info.x.toFixed(1) + ':' + info.z.toFixed(1), 'conifers', info.n, 'stats', JSON.stringify(info.stats));
if (info.list) console.log(JSON.stringify(info.list));
for (const zoom of arg('zooms', '1,2').split(',').map(Number)) {
  await page.evaluate(({ zoom, x, z }) => { const g = window.__game, G = g.game; G.cameraController.setZoom(zoom); G.cameraController.centerOn(x, z); g.advance(0.05); g.render(); }, { zoom, x: info.x, z: info.z });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__game.render(); window.__game.render(); });
  await page.screenshot({ path: `${out}-z${zoom}.png` });
  console.log('saved', `${out}-z${zoom}.png`);
}
if (arg('perf', '')) {
  const r = await page.evaluate(async (NF) => {
    const g = window.__game, G = g.game, ms = [], gpu = [];
    const R = G.renderer.renderer, gl = R.getContext();
    const px = new Uint8Array(4);
    G.cameraController.setZoom(1);
    for (let k = 0; k < 70; k++) {
      g.advance(1 / 60);
      const t0 = performance.now();
      G.render(1 / 60, 1);
      const t1 = performance.now();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // GPU sync
      const t2 = performance.now();
      if (k >= 10) { ms.push(t1 - t0); gpu.push(t2 - t0); }
    }
    const med = (a) => { a = [...a].sort((p, q) => p - q); return +a[a.length >> 1].toFixed(2); };
    const v = G.world.terrain?.vegetation;
    let vegCalls = 0; v?.group.traverse((o) => { if (o.isMesh && o.visible) vegCalls++; });
    const calls = R.info.render.calls, tris = R.info.render.triangles;
    // tree cost: frames with the vegetation shown / hidden, interleaved (shared-machine load hits both alike);
    // GPU time from EXT_disjoint_timer_query_webgl2 when available
    const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const on = [], off = [], gOn = [], gOff = [];
    for (let k = 0; k < NF; k++) {
      const show = k % 2 === 0;
      if (v) v.group.visible = show;
      g.advance(1 / 60);
      let q = null;
      if (tq) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      const t0 = performance.now();
      G.render(1 / 60, 1);
      if (q) gl.endQuery(tq.TIME_ELAPSED_EXT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const dt = performance.now() - t0;
      if (k >= 20) (show ? on : off).push(dt);
      if (q) {
        for (let w = 0; w < 50 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); w++) await new Promise((ok) => setTimeout(ok, 1));
        if (k >= 20 && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(tq.GPU_DISJOINT_EXT)) (show ? gOn : gOff).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    }
    if (v) v.group.visible = true;
    return { cpuMed: med(ms), syncedMed: med(gpu), calls, tris, vegMeshes: vegCalls, vegTris: v?.stats.tris,
      treeMs: +(med(on) - med(off)).toFixed(2), frameOn: med(on), frameOff: med(off),
      gpuOn: gOn.length ? med(gOn) : null, gpuOff: gOff.length ? med(gOff) : null, gpuTreeMs: gOn.length && gOff.length ? +(med(gOn) - med(gOff)).toFixed(2) : null };
  }, Number(arg('frames', 120)));
  console.log('perf', JSON.stringify(r));
}
const errs = h.errors(page); if (errs.length) console.log('errors', JSON.stringify(errs.slice(0, 5)));
await h.close();
