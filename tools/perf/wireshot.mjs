#!/usr/bin/env node
/**
 * Barbed-wire frames + perf (docs/barbed-wire.md §9).
 *
 *   node tools/perf/wireshot.mjs --mission=gallery|m00|m02|m03 --out=docs/screenshots/wire-x [--theater=desert]
 *     [--views=zoom:x:z,zoom:x:z] [--preset=high] [--w=1280 --h=720] [--perf=1] [--cut=x:z] [--advance=2]
 *     [--night=1] [--def=mission.json]
 *
 * --mission=gallery loads src/missions/dev/wire-gallery.js (re-themed by --theater). --cut=x:z clears the fence
 * cells within 0.75 m of (x, z) like the Sapper's cutters and emits `fence-gap`. --perf prints the GPU-synced
 * frame time with the wire layer shown vs hidden, the draw calls and the layer stats.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', 'wireshot');
const h = await startHarness({});
const page = await h.newPage({ width: Number(arg('w', 1280)), height: Number(arg('h', 720)) });
page.on('console', (m) => { if (/^wire |\[wire\]|error/i.test(m.text())) console.log(m.text().slice(0, 800)); });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async ({ m, theater, night, cut, adv, dump, evalJs, defJson }) => {
  const g = window.__game, G = g.game;
  if (defJson) await G.loadMission(JSON.parse(defJson));   // e.g. a feat/missions map's wire structures (M10 budget)
  else if (m === 'gallery' || theater || night) {
    const base = m === 'gallery' ? (await import('/src/missions/dev/wire-gallery.js')).default : (await import('/src/missions/index.js')).MISSIONS?.[m] ?? null;
    const def = { ...(base || {}) };
    if (theater) def.theater = theater;
    if (night) { def.lighting = { ...(def.lighting || {}), hdri: 'night', sunElevDeg: 30, night: true }; delete def.lighting.kelvin; }
    await G.loadMission(base ? def : m);
  } else await g.loadMission(m);
  g.start();
  g.advance(0.5); G.render(1 / 60, 1);
  await G.mapHandle.ready;
  if (cut) {
    const [x, z] = cut.split(':').map(Number), W = G.world, gr = W.grid;
    for (let dz = -0.75; dz <= 0.75; dz += 0.25) for (let dx = -0.75; dx <= 0.75; dx += 0.25) {
      if (Math.hypot(dx, dz) > 0.76) continue;
      const c = gr.worldToCell(x + dx, z + dz), k = gr.idx(c.i, c.j);
      if (gr.block[k] === 3) gr.block[k] = 0;
    }
    gr.version++;
    W.events.emit('structure:destroyed', { id: 'fence', type: 'fence-gap', owner: null });
  }
  g.advance(adv);
  if (evalJs) await (new Function('G', 'return (async () => {' + evalJs + '})()'))(G);
  console.log('wire', JSON.stringify(G.mapHandle.wire?.stats ?? null));
  if (dump) console.log('wire ground', JSON.stringify([[31, 45.5], [31.5, 45], [30.5, 46], [50, 20], [29, 21]].map(([x, z]) => +G.world.terrain.heightAt(x, z).toFixed(2))));
  if (dump) {
    const P = G.mapHandle.wire.parts, v = new (G.world.scene.position.constructor)();
    const near = (P.inst.get('angleThin') || []).map((m) => v.setFromMatrixPosition(m).toArray().map((q) => +q.toFixed(2))).filter((q) => Math.hypot(q[0] - 31, q[2] - 45.5) < 4);
    console.log('wire brackets near', JSON.stringify(near));
    const it = P.items.filter((i) => Math.hypot(i.path[0][0] - 31, i.path[0][2] - 45.5) < 3).slice(0, 3).map((i) => i.path[0].map((q) => +q.toFixed(2)));
    console.log('wire strands near', JSON.stringify(it));
  }
  if (dump) for (const r of G.mapHandle.wire?.runs || []) console.log('wire run', r.key, r.type, JSON.stringify(r.run.p.map((q) => q.map((v) => +v.toFixed(1)))), r.brackets ? JSON.stringify(r.brackets.map((b) => [+b.d.toFixed(1), +b.top.toFixed(2)])) : '');
}, { defJson: arg('def', '') ? readFileSync(arg('def', ''), 'utf8') : '', evalJs: arg('eval', ''), dump: arg('dump', ''), m: arg('mission', 'gallery'), theater: arg('theater', ''), night: arg('night', ''), cut: arg('cut', ''), adv: Number(arg('advance', 0.5)) });
await page.waitForTimeout(1500);
const views = arg('views', '1:32:24').split(',');
for (const [i, v] of views.entries()) {
  const [zm, vx, vz] = v.split(':').map(Number);
  await page.evaluate(({ zm, vx, vz }) => { const G = window.__game.game; G.cameraController.setZoom(zm); G.cameraController.centerOn(vx, vz); window.__game.render(); }, { zm, vx, vz });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__game.render(); window.__game.render(); });
  const name = views.length > 1 ? `${out}-v${i}.png` : `${out}.png`;
  await page.screenshot({ path: name });
  console.log('saved', name);
}
if (arg('perf', '')) {
  // GPU timer medians (__game.bench), wire shown / hidden alternated 3× each (shared-GPU noise): best of each
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, Wg = G.mapHandle.wire?.group;
    const on = [], off = [];
    let callsOn = 0, callsOff = 0, trisOn = 0, trisOff = 0;
    for (let k = 0; k < 3; k++) {
      if (Wg) Wg.visible = true; const a = await g.bench(60); on.push(a.gpuMedian ?? a.wallMedian); callsOn = a.calls; trisOn = a.triangles;
      if (Wg) Wg.visible = false; const b = await g.bench(60); off.push(b.gpuMedian ?? b.wallMedian); callsOff = b.calls; trisOff = b.triangles;
    }
    if (Wg) Wg.visible = true;
    const min = (x) => Math.min(...x), med = (x) => [...x].sort((p, q) => p - q)[1];
    return { onMin: min(on), offMin: min(off), deltaMin: +(min(on) - min(off)).toFixed(3), deltaMed: +(med(on) - med(off)).toFixed(3),
      on, off, calls: callsOn - callsOff, tris: trisOn - trisOff, preset: G.renderer.presetName, stats: G.mapHandle.wire?.stats ?? null };
  });
  console.log('perf', JSON.stringify(r));
}
if (arg('iso', '')) {
  // isolated cost: the main scene with everything but the wire layer (and the lights) hidden, rendered straight to a
  // full-size target with GPU timer queries: median ms of the wire draws alone (incl. its shadow-map casters)
  const r = await page.evaluate(async () => {
    const G = window.__game.game, R = G.renderer, gl = R.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const scene = R.scene, cam = G.cameraController.camera, Wg = G.mapHandle.wire?.group;
    if (!Wg || !ext) return { error: !Wg ? 'no wire' : 'no timer' };
    const THREE = await import('three');
    const size = R.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    const hidden = [];
    const keep = new Set(); for (let o = Wg; o; o = o.parent) keep.add(o);
    scene.traverse((o) => { if (o.visible && !keep.has(o) && !o.isLight && !(o.parent && keep.has(o.parent) && o.parent !== Wg && !keep.has(o)) ) {} });
    const hideAll = (root) => { for (const c of root.children) { if (keep.has(c)) { if (c !== Wg) hideAll(c); continue; } if (c.isLight || c.isCamera) continue; if (c.visible) { c.visible = false; hidden.push(c); } } };
    hideAll(scene);
    const time = async (show) => {
      Wg.visible = show; const qs = [];
      R.renderer.setRenderTarget(rt);
      for (let i = 0; i < 5; i++) R.renderer.render(scene, cam);
      for (let i = 0; i < 60; i++) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); R.renderer.render(scene, cam); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      R.renderer.setRenderTarget(null);
      const out = [];
      for (let tries = 0; tries < 80 && qs.length; tries++) {
        await new Promise((ok) => setTimeout(ok, 25));
        for (let i = qs.length - 1; i >= 0; i--) if (gl.getQueryParameter(qs[i], gl.QUERY_RESULT_AVAILABLE)) { out.push(gl.getQueryParameter(qs[i], gl.QUERY_RESULT) / 1e6); gl.deleteQuery(qs[i]); qs.splice(i, 1); }
      }
      out.sort((a, b) => a - b);
      return { med: +out[out.length >> 1].toFixed(3), p10: +out[Math.floor(out.length * 0.1)].toFixed(3), calls: R.renderer.info.render.calls, tris: R.renderer.info.render.triangles };
    };
    const on = await time(true), off = await time(false), on2 = await time(true);
    for (const o of hidden) o.visible = true; Wg.visible = true; rt.dispose();
    return { size: [size.x, size.y], wireMs: +(Math.min(on.med, on2.med) - off.med).toFixed(3), wireP10: +(Math.min(on.p10, on2.p10) - off.p10).toFixed(3), on, off, on2 };
  });
  console.log('iso', JSON.stringify(r));
}
const errs = h.errors(page);
if (errs.length) console.log('ERRORS\n' + errs.slice(0, 8).join('\n'));
await page.close();
await h.close();
