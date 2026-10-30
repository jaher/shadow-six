#!/usr/bin/env node
/**
 * Where a mission's scripted solution spends main-thread time between and inside its ticks (logic only, ?test=1, no
 * frames drawn): every tick's Game.step cost, and every GAP between two ticks — the driver's own synchronous work
 * (planSneak, clearAhead, routeClear… and the exposure watch) — with the sim time, the stage and the helper that took
 * it. In video mode at 4× a displayed frame runs several ticks and every gap between them: a 200 ms gap is a 200 ms
 * frame, a 6 ms tick is 24–96 ms of frame at 4× (16× while skip-waits boosts it).
 *
 *   node tools/perf/driver-gaps.mjs [m03] [--root=<checkout>] [--top=25] [--min=8] [--json=out.json] [--until=G]
 */
import { writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const id = args.find((a) => !a.startsWith('--')) || 'm03';
const ROOT = resolve(arg('root', HERE));
const H = await import(pathToFileURL(join(HERE, 'tests/harness.mjs')).href);
const { startServer } = await import(pathToFileURL(join(HERE, 'tools/serve.mjs')).href);
const PW = await import(pathToFileURL('<repo>/node_modules/playwright-core/index.mjs').href);
const server = await startServer({ port: 0, root: ROOT });
const browser = await PW.chromium.launch({ executablePath: H.findChrome(), headless: true, args: H.GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(0);
page.on('console', (m) => { const t = m.text(); if (/^(==|GAP)/.test(t)) console.log(t); });
await page.goto(`${server.url.replace(/\/$/, '')}/index.html?test=1`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
await page.evaluate(async (mid) => { await window.__game.loadMission(mid); window.__game.start(); }, id);
const prof = args.includes('--profile');
const cdp = prof ? await page.context().newCDPSession(page) : null;
let pn0 = 0;
if (prof) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  pn0 = await page.evaluate(() => performance.now());
  await cdp.send('Profiler.start');
}
const rep = await page.evaluate(async ([mid, minMs, until]) => {
  const G = window.__game;
  const { makeDriver } = await import('/tools/solutions/driver.mjs');
  const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
  const { boardPoint } = await import('/src/abilities/drive.js');
  const dt = G.CONFIG.sim.dt;
  const gaps = [], ticks = [];
  let stage = '-', lastEnd = -1, helper = new Map();
  const D = makeDriver(G.game.world, {
    dt, quiet: true, log: () => {}, skipEscape: () => G.game.skipExtraction(),
    step: () => {
      const a = performance.now();
      if (lastEnd >= 0 && a - lastEnd >= minMs) {
        gaps.push({ t: +G.game.world.time.toFixed(2), ms: +(a - lastEnd).toFixed(1), w0: lastEnd, w1: a, stage, by: [...helper].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(', ') });
      }
      helper = new Map();
      G.game.step(dt);
      const b = performance.now();
      ticks.push(b - a);
      if (b - a >= minMs) gaps.push({ t: +G.game.world.time.toFixed(2), ms: +(b - a).toFixed(1), w0: a, w1: b, stage, by: 'TICK (Game.step)' });
      lastEnd = performance.now();
    },
  });
  // time the look-ahead helpers (the synchronous work between ticks)
  for (const k of ['planSneak', 'planSneakAsync', 'clearAhead', 'routeClear', 'rowClear', 'planRow', 'seers']) {
    const f = D[k];
    if (typeof f !== 'function') continue;
    D[k] = function (...a) {
      const s = performance.now();
      try { return f.apply(this, a); } finally { const lab = k.startsWith('planSneak') ? `planSneak(${a[2]?.label || a[2]?.mode || ''}${a[2]?.shelter ? ' shelter' : ''})` : k; helper.set(lab, (helper.get(lab) || 0) + performance.now() - s); }
    };
  }
  const t0 = performance.now();
  let error = null;
  try { await solve(D, { boardPoint, until, onStage: (s, title) => { stage = s; console.log(`== stage ${s}: ${title} (t=${D.t.toFixed(1)})`); } }); } catch (e) { error = String(e?.message || e); }
  for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
  const ts = ticks.slice().sort((a, b) => a - b), q = (p) => +ts[Math.min(ts.length - 1, Math.floor(ts.length * p))].toFixed(2);
  return {
    error, time: +D.t.toFixed(2), state: G.game.state, detections: D.detections(), exposures: D.exposures().length,
    checkpoints: D.checkpoints.map((c) => `${c.name.split(' ')[0]}@${c.t}`), wallMs: Math.round(performance.now() - t0),
    ticks: { n: ts.length, p50: q(0.5), p99: q(0.99), max: q(1) }, gaps,
  };
}, [id, +arg('min', 8), arg('until', undefined)]);
if (prof) {
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  const off = profile.startTime / 1000 - pn0;
  let ts = profile.startTime;
  const samples = profile.samples.map((sid, i) => { ts += profile.timeDeltas[i]; return { id: sid, t: ts / 1000 - off }; });
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  // (--callers=<fn>: who calls that function, by samples under it — its callers up to 4 frames)
  if (arg('callers', '')) {
    const want = arg('callers'), byCaller = new Map(), nodeOf = new Map(profile.nodes.map((n) => [n.id, n]));
    const cnt = new Map(); for (const id of profile.samples) cnt.set(id, (cnt.get(id) || 0) + 1);
    const under = (n) => (cnt.get(n.id) || 0) + (n.children || []).reduce((a, c) => a + under(nodeOf.get(c)), 0);
    for (const n of profile.nodes) {
      if (n.callFrame.functionName !== want) continue;
      const chain = []; for (let p = parent.get(n.id), d = 0; p != null && d < 4; p = parent.get(p), d++) chain.push(key(nodeOf.get(p)));
      const k = chain.join(' < '); byCaller.set(k, (byCaller.get(k) || 0) + under(n));
    }
    console.log(`callers ${want}:\n  ` + [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${v} ${k}`).join('\n  '));
  }
  // (--lines=<fn>: hottest source lines of that function over the whole run, from the profile's position ticks)
  if (arg('lines', '')) {
    const want = arg('lines'), lt = new Map();
    for (const n of profile.nodes) if (n.callFrame.functionName === want && n.positionTicks) for (const pt of n.positionTicks) lt.set(pt.line, (lt.get(pt.line) || 0) + pt.ticks);
    console.log(`lineTicks ${want}: ` + [...lt].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([l, t]) => `L${l}:${t}`).join(' '));
  }
  for (const g of rep.gaps) {
    if (g.ms < +arg('pmin', 50)) continue;
    const self = new Map(), incl = new Map(); let tot = 0;
    for (const sm of samples) {
      if (sm.t < g.w0 || sm.t > g.w1) continue;
      tot++;
      const k = key(byId.get(sm.id)); self.set(k, (self.get(k) || 0) + 1);
      const seen = new Set();
      for (let p = sm.id; p != null; p = parent.get(p)) { const n = byId.get(p); if (!n.callFrame.url) continue; const kk = key(n); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) || 0) + 1); } }
    }
    g.prof = [...[...self].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `self ${(100 * v / (tot || 1)).toFixed(0)}% ${k}`),
      ...[...incl].sort((x, y) => y[1] - x[1]).slice(0, 18).map(([k, v]) => `incl ${(100 * v / (tot || 1)).toFixed(0)}% ${k}`)];
  }
}
await browser.close(); await server.close();
const top = +arg('top', 25);
console.log(`${rep.error ? 'ERROR ' + rep.error : 'done'} t=${rep.time} state=${rep.state} det=${rep.detections} exp=${rep.exposures} wall=${rep.wallMs} ms ticks=${JSON.stringify(rep.ticks)}`);
console.log(rep.checkpoints.join(' '));
console.log(`gaps >= ${arg('min', 8)} ms: ${rep.gaps.length}; total ${rep.gaps.reduce((s, g) => s + g.ms, 0).toFixed(0)} ms`);
for (const g of rep.gaps.slice().sort((a, b) => b.ms - a.ms).slice(0, top)) {
  console.log(`  ${String(g.ms).padStart(7)} ms  t=${g.t}  ${g.stage}  ${g.by}`);
  if (g.prof) for (const l of g.prof) console.log(`             ${l}`);
}
if (arg('json', '')) writeFileSync(arg('json'), JSON.stringify(rep, null, 1));
