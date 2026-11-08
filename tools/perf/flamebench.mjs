#!/usr/bin/env node
/**
 * Sustained-fire cost (art/realistic-flames): M1 open snow at the default camera, a burning truck, a burning building,
 * a fuel spill and a campfire burning together (6 s in, steady state); measures the FxPass GPU time (timer query
 * around the pass only: the whole frame is too noisy on the shared GPU), the library's CPU per sim tick (advance) and
 * per frame (frame: sort + uploads + lights), particles and draws, at zoom 1 and 2. Run on two trees and compare:
 *   node tools/perf/flamebench.mjs [--root=<tree>] [--preset=high] [--json=out.json]
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const h = await startHarness({});
if (arg('root')) h.server.setRoot(resolve(arg('root')));
const page = await h.newPage({ width: 1280, height: 720 });
await page.goto(`${h.url}/index.html?test=1&preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
const r = await page.evaluate(async ({ ev, scene }) => {
  const g = window.__game, G = g.game, m8 = scene === 'm8';
  await g.loadMission(m8 ? 'm08' : 'm01'); g.start(); G.stop?.(); G._checkEnd = () => {}; await G.mapHandle?.ready;
  for (let k = 0; k < 30; k++) g.step();
  const W = G.world, fx = W.fx, vfx = fx.vfx, c = m8 ? { x: 53, z: 60 } : { x: 46, z: 128 };
  if (ev) new Function('vfx', 'G', ev)(vfx, G); // look-dev / cost split, e.g. --eval="const e=vfx.emit.bind(vfx); vfx.emit=(p)=>p.mode===3?-1:e(p)"
  G.cameraController.setZoom(1, true); G.cameraController.centerOn(c.x, c.z);
  if (m8) {
    // the heaviest fire case: M8's whole depot going up at once — the six oil-barrel racks and their drums (one chain),
    // both fuel tanks (their blasts, spills and 90 s fires)
    // (measured 3 s in: the drums' 10 s spills and the tanks' fires all burning, the blasts' smoke still up)
    W.byId('rack_1').ignite?.(0); W.byId('tank_a').destroy(null, 'explosion'); W.byId('tank_b').destroy(null, 'explosion');
    for (let i = 0; i < 180; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
  } else {
    fx.spawn('burning_wreck', c.x - 3, c.z - 2, { size: [2.4, 6.3], h: 1.9, yaw: 1.18, dur: 1e6 });
    fx.spawn('burning_wreck', c.x + 7, c.z + 4, { size: [7.2, 7.2], h: 1.4, dur: 60, fuel: 'wood' });
    fx.spawn('fuel_pool_fire', c.x - 8, c.z + 4, { radius: 1.5, dur: 30 });
    fx.spawn('fire_small', c.x + 2, c.z - 6, { dur: 1e6 });
    for (let i = 0; i < 360; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
  }
  // CPU: the library's sim advance (per 1/60 s tick: events, emitters, debris) and per-frame work (sort, uploads,
  // lights), each timed over a batch of 600 calls (performance.now() is coarsened to 0.1 ms per call)
  const cpu = (fn) => { const ts = []; for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 120; i++) fn(); ts.push((performance.now() - t0) / 120); } return ts; };
  const ta = cpu(() => vfx.advance(1 / 60)), tf = cpu(() => vfx.frame());
  const gl = G.renderer.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), pass = vfx.pass, orig = pass.render;
  const sample = async (n) => {
    const qs = [], res = [];
    pass.render = function (...a) { const q = ext && gl.createQuery(); if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q); orig.apply(this, a); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); } };
    for (let i = 0; i < n; i++) { g.advance(1 / 60); G.render(1 / 60, 1); }
    pass.render = orig;
    for (let tries = 0; tries < 60 && qs.length; tries++) {
      await new Promise((res2) => setTimeout(res2, 25));
      for (let i = qs.length - 1; i >= 0; i--) if (gl.getQueryParameter(qs[i], gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) res.push(gl.getQueryParameter(qs[i], gl.QUERY_RESULT) / 1e6); gl.deleteQuery(qs[i]); qs.splice(i, 1); }
    }
    return res;
  };
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? +b[b.length >> 1].toFixed(3) : null; };
  const p90 = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? +b[Math.floor(b.length * 0.9)].toFixed(3) : null; };
  const out = { cpuAdvanceMs: med(ta), cpuFrameMs: med(tf), zoom: {} };
  for (const z of [1, 2]) {
    G.cameraController.setZoom(z, true); G.cameraController.centerOn(c.x, c.z);
    const gpu = [];
    for (let rep = 0; rep < 4; rep++) gpu.push(...await sample(30));
    out.zoom[z] = { fxGpu: med(gpu), fxGpuP90: p90(gpu), n: gpu.length, stats: fx.stats() };
  }
  return out;
}, { ev: arg('eval', ''), scene: arg('scene', 'm1') });
console.log(JSON.stringify(r));
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(r, null, 1));
const errs = h.errors(page);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await h.close();
