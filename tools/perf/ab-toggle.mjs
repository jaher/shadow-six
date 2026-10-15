#!/usr/bin/env node
/**
 * Same-page A/B of a runtime switch (src/engine/perf-flags.js, `window.__perf`): the walkthrough plays from a checkpoint
 * and the switch flips every --period s, so both sides share the moment, the view and the machine's load. Per side:
 * frame interval, render CPU (Game.render), sim CPU (Game.step), GPU time of the draw (EXT_disjoint_timer_query_webgl2),
 * draw calls, frames over 50 ms; the first --settle s after each flip are left out.
 *
 *   node tools/perf/ab-toggle.mjs --flag=adaptiveTicks [--cp=H2] [--speed=auto|4] [--secs=120] [--period=4]
 *        [--settle=0.5] [--size=1920x1080] [--root=<checkout>] [--json=out.json]
 */
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flags = arg('flag', '').split(',').filter(Boolean), cp = arg('cp', 'H2'), speed = arg('speed', 'auto');
const secs = +arg('secs', 120), period = +arg('period', 4), settle = +arg('settle', 0.5);
const [vw, vh] = arg('size', '1920x1080').split('x').map(Number);
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const server = await startServer({ port: 0, root: resolve(arg('root', HERE)) });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
page.setDefaultTimeout(0);
await page.goto(`${server.url.replace(/\/$/, '')}/index.html?debug&walkthrough=m03${speed === 'auto' ? '' : `&speed=${speed}`}`);
await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay && window.__perf, null, { timeout: 300000 });
// (the title card a few seconds, as a user: the idle warm-up queue drains)
await page.waitForTimeout(+arg('title', 6) * 1000);
if (cp !== 'start') {
  await page.evaluate((c) => window.shadowSix.debug.mode.replay.jumpTo({ kind: 'cp', id: c }), cp);
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && !r.pacer.turbo && !r._introOn; }, null, { timeout: 900000 });
} else await page.locator('#wt-card [data-act=start]').click();
const out = await page.evaluate(async ({ flags, secs, period, settle, speed }) => {
  const g = window.shadowSix, r = g.debug.mode.replay, R = g.renderer.renderer, gl = R.getContext();
  r.hold = null; if (speed === 'auto') r.setAuto?.(true); else r.setSpeed?.(+speed);
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const set = (on) => { for (const f of flags) window.__perf[f] = on; };
  const rows = []; let side = true, flipAt = performance.now(), cur = null, last = 0;
  const pend = [];
  const step = g.step, render = g.render;
  g.step = function (...a) { const s = performance.now(); try { return step.apply(this, a); } finally { if (cur) cur.sim += performance.now() - s; } };
  g.render = function (...a) {
    const s = performance.now(); let q = null;
    if (ext && cur && !cur.q) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    try { return render.apply(this, a); } finally {
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); cur.q = true; pend.push([q, cur]); }
      if (cur) { cur.render += performance.now() - s; cur.draws = R.info.render.calls; }
      for (let i = pend.length - 1; i >= 0; i--) { const [qq, c] = pend[i]; if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) { if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) c.gpu = gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(qq); pend.splice(i, 1); } }
    }
  };
  set(side);
  await new Promise((done) => {
    const t0 = performance.now();
    const f = (now) => {
      // (a frame counts for its side when it started --settle s after that side's flip; its interval ends now)
      if (cur) { cur.dt = now - cur.at; if (cur.at - flipAt > settle * 1000 && cur.side === side) rows.push(cur); }
      last = now;
      if (r.hold) r.hold = null;
      if (now - flipAt > period * 1000) { side = !side; set(side); flipAt = now; }
      cur = { side, dt: 0, sim: 0, render: 0, draws: 0, gpu: -1, t: g.world.time, at: now };
      if (now - t0 > secs * 1000 || g.state !== 'playing') { done(); return; }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  g.step = step; g.render = render; set(true);
  return rows.filter((x) => x.dt > 0);
}, { flags, secs, period, settle, speed });
await browser.close(); await server.close();
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const stat = (rows) => {
  const g = rows.filter((x) => x.gpu >= 0).map((x) => x.gpu);
  return { frames: rows.length, frameP50: +q(rows.map((x) => x.dt), 0.5).toFixed(1), frameP99: +q(rows.map((x) => x.dt), 0.99).toFixed(1), frameMax: +Math.max(...rows.map((x) => x.dt)).toFixed(1),
    over50: rows.filter((x) => x.dt > 50).length, over50pct: +(100 * rows.filter((x) => x.dt > 50).length / Math.max(1, rows.length)).toFixed(2),
    renderMean: +mean(rows.map((x) => x.render)).toFixed(2), renderP50: +q(rows.map((x) => x.render), 0.5).toFixed(2), renderP99: +q(rows.map((x) => x.render), 0.99).toFixed(2),
    simMean: +mean(rows.map((x) => x.sim)).toFixed(2), simP99: +q(rows.map((x) => x.sim), 0.99).toFixed(2), workP99: +q(rows.map((x) => x.sim + x.render), 0.99).toFixed(1),
    gpuP50: +q(g, 0.5).toFixed(2), gpuP99: +q(g, 0.99).toFixed(2), drawsMean: +mean(rows.map((x) => x.draws)).toFixed(1),
    simSpan: rows.length ? `${Math.min(...rows.map((x) => x.t)).toFixed(0)}–${Math.max(...rows.map((x) => x.t)).toFixed(0)}` : '' };
};
const rep = { flags, cp, speed, size: `${vw}x${vh}`, secs, period, on: stat(out.filter((x) => x.side)), off: stat(out.filter((x) => !x.side)) };
console.log(JSON.stringify(rep, null, 1));
if (arg('json', '')) writeFileSync(arg('json'), JSON.stringify({ ...rep, rows: out }));
