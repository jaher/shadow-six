#!/usr/bin/env node
/**
 * Play a mission solution in the real game (headless GPU Chromium, ?test=1), to check the game agrees with the
 * headless harness. No frames are drawn here (logic only: __game.step()); the video capture renders every tick.
 *   node tools/solutions/run-browser.mjs m03 [--json out.json]
 */
import { startHarness } from '../../tests/harness.mjs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) || 'm03';
const jsonAt = args.indexOf('--json');
const h = await startHarness();
let report = null;
try {
  const page = await h.newPage({ width: 960, height: 540 });
  page.setDefaultTimeout(0);
  page.on('console', (m) => { const t = m.text(); if (/^(CHECKPOINT|==|  \[|DBG)/.test(t)) console.log(t); });
  await h.openGame(page, '?test=1');
  await page.evaluate(async (mid) => { await window.__game.loadMission(mid); window.__game.start(); }, id);
  const ji = args.indexOf('--jitter');
  const jitter = ji >= 0 ? +args[ji + 1] || 1 : 0; // robustness probe: seeded hesitation (0–0.6 s) before every move
  report = await page.evaluate(async ([mid, DBG, jitter]) => {
    const G = window.__game;
    if (DBG) globalThis.__M3DBG = true;
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
    const { boardPoint } = await import('/src/abilities/drive.js');
    // logic only: Game.step without a render (__game.step() = game.advance(dt), which also draws a frame)
    const dt = G.CONFIG.sim.dt;
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt });
    if (jitter) {
      let seed = jitter;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const go = D.go;
      D.go = async (...a) => { await D.wait(Math.round(rnd() * 36) * dt); return go(...a); };
    }
    let error = null;
    const t0 = performance.now();
    try { await solve(D, { boardPoint, onStage: (s, title) => console.log(`== stage ${s}: ${title} (t=${D.t.toFixed(1)})`) }); } catch (e) { error = String(e && e.message || e); }
    // let the game's own end check run (win screen state)
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const obj = Object.fromEntries(D.world.objectives.map((o) => [o.id, o.done]));
    return { error, time: D.t, objectives: obj, detections: D.detections(), exposures: D.exposureReport(), state: G.game.state, checkpoints: D.checkpoints,
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line), wallMs: performance.now() - t0 };
  }, [id, !!process.env.M3DBG, jitter]);
  report.errors = h.errors(page).slice(0, 20);
} finally {
  await h.close();
}
const ok = !report.error && Object.values(report.objectives).every(Boolean) && report.detections === 0 && !report.exposures.length;
console.log(`${ok ? 'WIN' : 'FAIL'} ${id} (browser) t=${report.time.toFixed(2)} state=${report.state} objectives=${JSON.stringify(report.objectives)} detections=${report.detections} error=${report.error} (${Math.round(report.wallMs)} ms)`);
for (const l of report.exposures) console.log(`EXPOSED ${l}`);
if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify({ ok, ...report }, null, 1));
process.exit(ok ? 0 : 1);
