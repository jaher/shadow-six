#!/usr/bin/env node
/**
 * Art-direction / perf review pass (art integration 2): per mission × preset at 1920×1080 —
 * cold load time (fresh page), then the worst in-game case: 40 live enemies (brains on, half patrolling) + the
 * commandos around the camera, zoom 1. Frame = sim tick + full render, synced with a 1-px readPixels.
 *
 *   node tools/perf/review.mjs [--missions=m01,m02,m03] [--presets=low,medium,high,ultra] [--frames=120] [--out=file.json]
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const missions = arg('missions', 'm01,m02,m03').split(',');
const presets = arg('presets', 'low,medium,high,ultra').split(',');
const frames = Number(arg('frames', 120));
const h = await startHarness({ viewport: { width: 1920, height: 1080 } });
const rows = [];
for (const preset of presets) {
  for (const m of missions) {
    const page = await h.newPage({ width: 1920, height: 1080 });
    await page.goto(`${h.url}/index.html?test=1&preset=${preset}`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
    const cdp = arg('cpuprof', '') ? await page.context().newCDPSession(page) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); }
    page.on('console', (msg) => { if (cdp && msg.text() === 'PROF_START') cdp.send('Profiler.start'); });
    const r = await page.evaluate(async ({ m, frames, SERIES }) => {
      const g = window.__game, G = g.game;
      const t0 = performance.now();
      await g.loadMission(m);
      const loadMs = performance.now() - t0;
      g.start();
      const w = G.world;
      const { Enemy } = await import('/src/entities/enemy.js');
      const c0 = w.commandos[0], X = c0.x, Z = c0.z;
      const types = ['soldier', 'sentry', 'officer', 'mg'];
      let near = w.enemies.filter((e) => Math.hypot(e.x - X, e.z - Z) < 40).length;
      for (let k = 0; w.enemies.length < 40 + (w.enemies.length - near) && k < 60; k++) {
        const x = X - 16 + (k % 8) * 4, z = Z - 10 + Math.floor(k / 8) * 4;
        const route = k % 2 ? [{ x, z }, { x: x + 6, z: z + 2 }] : null;
        w.add(new Enemy({ id: 'rv' + k, soldierType: types[k % 4], x, z, heading: k, route }));
        near++;
        if (near >= 40) break;
      }
      await Promise.all(w.entities.filter((e) => e.model?.ready).map((e) => e.model.ready));
      g.centerOn(X, Z); g.setZoom(1);
      const gl = G.renderer.renderer.getContext(), px = new Uint8Array(4);
      for (let i = 0; i < 10; i++) { G.step(1 / 60); G.render(1 / 60, 1); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const prof = { path: 0, pathN: 0, brain: 0, perc: 0 };
      const fp = w.findPath.bind(w);
      w.findPath = (...a) => { const t = performance.now(); const r = fp(...a); prof.path += performance.now() - t; prof.pathN++; return r; };
      for (const e of w.enemies) if (e.brain) { const u = e.brain.update.bind(e.brain); e.brain.update = (...a) => { const t = performance.now(); const r = u(...a); prof.brain += performance.now() - t; return r; }; }
      const sim = [], all = [], spikes = [];
      console.log('PROF_START'); await new Promise((res) => setTimeout(res, 200));
      let lastProg = G.renderer.renderer.info.programs?.length || 0, lastGeo = G.renderer.renderer.info.memory.geometries, lastTex = G.renderer.renderer.info.memory.textures;
      for (let i = 0; i < frames; i++) {
        prof.path = prof.brain = prof.pathN = 0;
        const a = performance.now();
        G.step(1 / 60);
        const b = performance.now();
        G.render(1 / 60, 1);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sim.push(b - a); all.push(performance.now() - a);
        const np = G.renderer.renderer.info.programs?.length || 0;
        if (all[all.length - 1] > 30) spikes.push(`${i}:${Math.round(all[all.length - 1])}ms sim${Math.round(b - a)} path${Math.round(prof.path)}/${prof.pathN} brain${Math.round(prof.brain)} prog${np - lastProg} geo${G.renderer.renderer.info.memory.geometries - lastGeo} tex${G.renderer.renderer.info.memory.textures - lastTex}`);
        lastProg = np; lastGeo = G.renderer.renderer.info.memory.geometries; lastTex = G.renderer.renderer.info.memory.textures;
      }
      const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
      const bench = await g.bench(60);
      return { loadMs: Math.round(loadMs), warmMs: Math.round(G.warmMs || 0), enemies: w.enemies.length, real: w.enemies.filter((e) => e.model?.isReal).length,
        simMed: q(sim, 0.5), frameMed: q(all, 0.5), frameP95: q(all, 0.95), gpuMed: bench.gpuMedian, calls: bench.calls,
        tris: bench.triangles, spikes: spikes.join(", "), series: SERIES ? all.map((v) => Math.round(v)).join(' ') : undefined, alarm: !!w.alarm, state: G.state };
    }, { m, frames, SERIES: !!arg('series', '') });
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dt = profile.timeDeltas; const cnt = new Map();
      profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)));
      for (const [id, us] of cnt) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + us); }
      const par = new Map(); for (const n of profile.nodes) for (const c of n.children || []) par.set(c, n.id);
      const under = arg('under', '');
      if (under) {
        const st = new Map();
        for (const [id, us] of cnt) { const chain = []; let q = id; while (q) { const nn = byId.get(q); chain.push(`${nn.callFrame.functionName}:${nn.callFrame.url.split('/').pop()}:${nn.callFrame.lineNumber}`); q = par.get(q); }
          const i = chain.findIndex((c) => c.includes(under)); if (i < 0) continue; const k = chain.slice(Math.max(0, i - 6), i).reverse().join(' > '); st.set(k, (st.get(k) || 0) + us); }
        console.log([...st].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n'));
      }
      const want = arg('stack', '');
      if (want) {
        const st = new Map();
        for (const [id, us] of cnt) { let n = byId.get(id); if (n.callFrame.functionName !== want) continue; const chain = []; let q = par.get(id); while (q && chain.length < 12) { const nn = byId.get(q); chain.push(`${nn.callFrame.functionName}:${nn.callFrame.url.split('/').pop()}:${nn.callFrame.lineNumber}`); q = par.get(q); } const k = chain.join(' < '); st.set(k, (st.get(k) || 0) + us); }
        console.log([...st].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n'));
      }
      console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${(v / 1000).toFixed(0)}ms ${k}`).join('\n'));
    }
    const errs = h.errors(page);
    rows.push({ preset, m, ...r, errs: errs.length });
    console.log(preset, m, JSON.stringify(r), errs.length ? errs.slice(0, 2).join(' | ') : '');
    await page.close();
  }
}
if (arg('out', '')) writeFileSync(arg('out', ''), JSON.stringify(rows, null, 1));
await h.close();
