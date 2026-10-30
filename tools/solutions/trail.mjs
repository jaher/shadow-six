#!/usr/bin/env node
/**
 * Record and measure the commandos' trails through a mission solution (the walkthrough plays the same orders):
 *   node tools/solutions/trail.mjs m03 [--headless] [--out trail.json] [--from s] [--to s] [--every n]
 * Plays the solution in the real game (headless GPU Chromium, logic only, as run-browser.mjs; `--headless`: the node
 * sim, approximate), records every commando each tick, every order and every path the game planned (trail-rec.mjs),
 * then prints the straightness metrics (trail-metrics.mjs): turns per 10 m walked, the mean straight leg, walked /
 * straight per order, move orders per minute, pauses — and where the turns come from (order boundaries, corners of the
 * planned paths, the game's re-paths, steering). `--out`: the raw trail (for trail-plot.py).
 * `node tools/solutions/trail.mjs --measure trail.json` measures a saved trail again.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeTrail } from './trail-rec.mjs';
import { measureTrail, attributeTurns, plannedPathStats } from './trail-metrics.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const id = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'm03';
const OUT = opt('out', null);
const every = +opt('every', 1);
let raw;

if (args.includes('--measure')) {
  raw = JSON.parse(readFileSync(opt('measure'), 'utf8'));
} else if (args.includes('--headless')) {
  const { headlessMission } = await import('./headless.mjs');
  const { makeDriver } = await import('./driver.mjs');
  const { attachTrail, tagDriver } = await import('./trail-rec.mjs');
  const { boardPoint } = await import('../../src/abilities/drive.js');
  const { solve } = await import(`./${id}.solution.mjs`);
  const S = headlessMission(id);
  const rec = attachTrail(S.world, { every });
  const D2 = makeDriver(S.world, { step: () => { S.step(); rec.tick(); }, dt: S.dt, quiet: true, log: () => {}, skipEscape: S.skipEscape });
  tagDriver(D2);
  let error = null;
  const t0 = Date.now();
  try { await solve(D2, { boardPoint }); } catch (e) { error = String(e?.message || e); }
  const obj = Object.fromEntries(D2.world.objectives.map((o) => [o.id, o.done]));
  const optional = D2.world.objectives.filter((o) => o.required === false).map((o) => o.id);
  raw = { mission: id, mode: 'headless', error, time: D2.t, objectives: obj, optional, detections: D2.detections(), exposures: D2.exposureReport(), checkpoints: D2.checkpoints.map((c) => [c.name.split(' ')[0], c.t]), wallMs: Date.now() - t0, ...rec.result() };
} else {
  const { startHarness } = await import('../../tests/harness.mjs');
  const h = await startHarness();
  try {
    const page = await h.newPage({ width: 960, height: 540 });
    page.setDefaultTimeout(0);
    await h.openGame(page, '?test=1');
    await page.evaluate(async (mid) => { await window.__game.loadMission(mid); window.__game.start(); }, id);
    raw = await page.evaluate(async ([mid, every]) => {
      const G = window.__game, dt = G.CONFIG.sim.dt;
      const { makeDriver } = await import('/tools/solutions/driver.mjs');
      const { attachTrail, tagDriver } = await import('/tools/solutions/trail-rec.mjs');
      const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
      const { boardPoint } = await import('/src/abilities/drive.js');
      const rec = attachTrail(G.game.world, { every });
      const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); rec.tick(); }, dt, quiet: true, log: () => {}, skipEscape: () => G.game.skipExtraction() });
      tagDriver(D);
      let error = null;
      const t0 = performance.now();
      try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
      for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
      const obj = Object.fromEntries(D.world.objectives.map((o) => [o.id, o.done]));
      const optional = D.world.objectives.filter((o) => o.required === false).map((o) => o.id);
      return { mission: mid, mode: 'browser', error, state: G.game.state, time: D.t, objectives: obj, optional, detections: D.detections(), exposures: D.exposureReport(), checkpoints: D.checkpoints.map((c) => [c.name.split(' ')[0], c.t]), wallMs: performance.now() - t0, ...rec.result() };
    }, [id, every]);
    raw.errors = h.errors(page).slice(0, 20);
  } finally { await h.close(); }
}

if (OUT) writeFileSync(OUT, JSON.stringify(raw));
const tr = decodeTrail(raw);
const from = +opt('from', -Infinity), to = +opt('to', Infinity);
const m = measureTrail(tr, { from, to });
const at = attributeTurns(tr, m.turnList);
const byHelper = {};
for (const q of tr.orders) if (q.type === 'move') byHelper[q.by ?? 'other'] = (byHelper[q.by ?? 'other'] || 0) + 1;
// (the game's own win rule, as run-headless.mjs: every REQUIRED objective done — an optional one may stay undone)
const ok = !raw.error && Object.entries(raw.objectives || {}).every(([k, done]) => done || raw.optional?.includes(k)) && raw.detections === 0 && !(raw.exposures || []).length;
console.log(`${ok ? 'WIN' : 'FAIL'} ${raw.mission} (${raw.mode}) t=${(+raw.time).toFixed(1)} detections=${raw.detections} exposures=${(raw.exposures || []).length} error=${raw.error} (${Math.round(raw.wallMs)} ms)`);
for (const l of (raw.exposures || []).slice(0, 8)) console.log(`  EXPOSED ${l}`);
const { per, turnList, ...summary } = m;
console.log('STRAIGHTNESS', JSON.stringify(summary));
for (const p of per) console.log('  ', JSON.stringify(p));
console.log('TURN SOURCES', JSON.stringify(at.counts), 'move orders by helper', JSON.stringify(byHelper));
console.log('PLANNED PATHS (orders)', JSON.stringify(plannedPathStats(tr, { cause: 'order', from, to })), '(game re-paths)', JSON.stringify(plannedPathStats(tr, { cause: 'game', from, to })));
process.exitCode = ok ? 0 : 1;
