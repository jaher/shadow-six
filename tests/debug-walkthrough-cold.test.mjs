/**
 * A walkthrough opened from a COLD link plays the tested run, tick for tick (user 2026-10-22: the walkthroughs are
 * watched from cold links — "a live run that diverges from the tested run can end differently (detections, a failed
 * mission), so the live run must be identical to the logic run checkpoint for checkpoint, at every speed and preset").
 *
 * The reference is the regression run: a fresh page (?test=1, its own browser context: nothing cached), the mission
 * loaded and its solution (tools/solutions/<id>.solution.mjs) played logic-only, as tests/<id>-solution.test.mjs does.
 * The live runs: a fresh page opening the cold link `?debug&walkthrough=<id>` — the LOADING screen, the art arriving as
 * fast as the link allows, the title card, then the walkthrough with its frames, AUTO's pacing, the action holds and
 * the director — each tick hashed (debug/sim-trace.js: RNG, alarm, every unit, vehicle and objective). Both must agree
 * at every tick, end at the same tick in the same state, with the same checkpoints at the same game times, the same
 * detections and exposures; the static gameplay world at tick 0 (debug/gameplay-fingerprint.js: nav layers, solids,
 * heights, structures) must be the same; and the scripted run must end where the game does (no tick past the win: a
 * live walkthrough stops there — M1, M13 and M14 used to wait / row on 0.3, 1.2 and 1.45 s, their last checkpoints
 * never shown).
 *
 * Runs (side by side, a page each): M2 cold at AUTO (the link that showed it); M3 cold at preset=low, AUTO (the long
 * one, and the preset that once drifted); M2 again at 4× with its art arriving late, as over a slow link — the library
 * buildings' models 30 s late, the terrain's textures 70 s late (the page's requests held back by Playwright routes:
 * no connection is held meanwhile, the rest loads on). The load used to race them (25 s for the buildings, 20 + 60 s
 * for the trees' gun-arc stamp) and play on, the map stamped on buildings still loading: 10-13 gameplay fields off at
 * tick 0 and another run (D1 at 293.17 instead of 293.37; this run ended at 1201.60, not 1201.90 — a 4 Mbit/s link did
 * the same); now the load waits for them (engine/gameplay-inputs.js). SS_COLDWT=m02 (or m02,m03, or late) restricts the
 * runs; SS_COLDWT=m04@4 (or m07@auto…) plays another mission's cold link at that speed instead (M4 at 4×: ~9 min).
 * ~15 min (M3 at AUTO).
 */

export const timeout = 3_300_000;

const RUNS = [
  { key: 'm02', id: 'm02', speed: 'auto', preset: null },
  { key: 'm03', id: 'm03', speed: 'auto', preset: 'low' },
  { key: 'late', id: 'm02', speed: '4', preset: null, late: [[/\/assets\/models\/buildings\//, 30000], [/\/assets\/terrain\//, 70000]] },
];

/** The static world fields that must match at tick 0 (entities / interactables may differ by the start trigger's and the selection's timing).
 * Not grid.dynamicBlock: the vehicles' per-tick stamp, cleared and stamped again by every step — and by a solution's
 * look-ahead (sneak.mjs withoutMovers), which a walkthrough runs before its intro card is dismissed (M4: 179 cells). */
const STATIC = /^(grid\.(?!dynamicBlock)|ground\.|bodySolids|stairs|structures|ladders|water|links)/;

async function logicRun(h, id) {
  const p = await h.newPage();
  try {
    p.setDefaultTimeout(0);
    await h.openGame(p, '?test=1');
    return await p.evaluate(async (mid) => {
      const G = window.__game, g = G.game, dt = G.CONFIG.sim.dt;
      await G.loadMission(mid);
      G.start();
      const { gameplayFingerprint } = await import('/src/debug/gameplay-fingerprint.js');
      const { simRecorder } = await import('/src/debug/sim-trace.js');
      const { makeDriver } = await import('/tools/solutions/driver.mjs');
      const { solve } = await import(`/tools/solutions/${mid}.solution.mjs`);
      const { boardPoint } = await import('/src/abilities/drive.js');
      const w = g.world, rec = simRecorder();
      const fp = gameplayFingerprint(w, { game: g });
      let end = null;
      const onEnd = (state) => () => { end ??= { state, t: w.time }; };
      g.events.on('mission:won', onEnd('won'));
      g.events.on('mission:lost', onEnd('lost'));
      const D = makeDriver(w, { step: () => { g.step(dt); rec.snap(w); }, dt, quiet: true, log: () => {}, skipEscape: () => g.skipExtraction() });
      let error = null;
      try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
      const solT = w.time;
      for (let i = 0; i < 600 && g.state === 'playing'; i++) { g.step(dt); rec.snap(w); }
      return { fp, error, state: g.state, time: w.time, end, solT, detections: D.detections(), exposures: D.exposures().length,
        marks: D.checkpoints.map((c) => ({ name: c.name.split(' ')[0], t: c.t })), rec: rec.data() };
    }, id);
  } finally { await p.close().catch(() => {}); }
}

async function liveRun(h, base, run) {
  const p = await h.newPage();
  try {
    p.setDefaultTimeout(0);
    const q = `?debug${run.preset ? `&preset=${run.preset}` : ''}&walkthrough=${run.id}&speed=${run.speed}`;
    for (const [re, ms] of run.late || []) await p.route((u) => re.test(u.pathname), async (route) => { await new Promise((ok) => setTimeout(ok, ms)); await route.continue().catch(() => {}); });
    const t0 = Date.now();
    await p.goto(`${base}/index.html${q}`);
    await p.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.debug?.mode?.replay?.isWalkthrough, null, { timeout: 1_200_000, polling: 500 });
    const loadS = (Date.now() - t0) / 1000;
    const fp = await p.evaluate(async () => {
      const g = window.shadowSix, w = g.world;
      const { gameplayFingerprint } = await import('/src/debug/gameplay-fingerprint.js');
      const { simRecorder } = await import('/src/debug/sim-trace.js');
      const rec = (window.__rec = simRecorder());
      window.__end = null;
      g.events.on('debug:walkthrough-end', (r) => { if (r.outcome !== 'stopped') window.__end = r; });
      // every tick the walkthrough runs (it ticks through Game.step: debug/solution-replay.js _tick)
      const step = g.step;
      g.step = function (dt) { const r = step.call(this, dt); if (this.world === w) rec.snap(w); return r; };
      return gameplayFingerprint(w, { game: g });
    });
    const meta = await p.evaluate(() => ({ preset: window.shadowSix.renderer?.presetName, cardClock: window.shadowSix.world.time }));
    await p.locator('#wt-card [data-act=start]').click();
    await p.waitForFunction(() => !!window.__end, null, { timeout: 3_000_000, polling: 2000 });
    const r = await p.evaluate(() => {
      const x = window.__end;
      return { outcome: x.outcome, error: x.error, state: x.state, time: x.time, detections: x.detections, exposures: x.exposures,
        marks: (x.marks || []).map((m) => ({ name: m.name.split(' ')[0], t: m.t })), rec: window.__rec.data() };
    });
    return { ...r, fp, loadS, wallS: (Date.now() - t0) / 1000, ...meta };
  } finally { await p.close().catch(() => {}); }
}

export default async function debugWalkthroughCold(page, t) {
  const h = t.harness;
  const only = (process.env.SS_COLDWT || '').split(',').map((s) => s.trim()).filter(Boolean);
  const extra = only.filter((s) => /^m\d\d@(auto|[\d.]+)$/.test(s)).map((s) => ({ key: s, id: s.split('@')[0], speed: s.split('@')[1], preset: null }));
  const runs = [...RUNS.filter((r) => !only.length || only.includes(r.key) || only.includes(r.id)), ...extra];
  const { compareRecordings } = await import('../src/debug/sim-trace.js');
  const { diffFingerprints } = await import('../src/debug/gameplay-fingerprint.js');
  const ids = [...new Set(runs.map((r) => r.id))];
  const refs = {};
  const live = {};
  await Promise.all([
    ...ids.map(async (id) => { refs[id] = await logicRun(h, id); }),
    ...runs.map(async (r) => { live[r.key] = await liveRun(h, h.url, r); }),
  ]);
  for (const id of ids) {
    const ref = refs[id];
    t.log(`${id} logic: ${ref.state} at t=${ref.end?.t.toFixed(2)} (solution done at ${ref.solT.toFixed(2)}), ${ref.marks.length} checkpoints, det ${ref.detections}, exp ${ref.exposures}, ${ref.rec.hashes.length} ticks, error ${ref.error}`);
    t(!ref.error && ref.state === 'won' && ref.detections === 0, `${id}: the scripted run wins unseen (${ref.state}, ${ref.error})`);
    t(ref.end && Math.abs(ref.solT - ref.end.t) < 1e-6, `${id}: the scripted run ends where the game does, not a tick past the win (solution ${ref.solT.toFixed(2)}, game ${ref.end?.t.toFixed(2)})`);
  }
  for (const r of runs) {
    const ref = refs[r.id], L = live[r.key], tag = `${r.id} cold at ${r.speed}${r.preset ? ` ${r.preset}` : ''}${r.late ? ' (buildings\' models 30 s late, terrain 70 s)' : ''}`;
    t.log(`${tag}: loaded in ${L.loadS.toFixed(0)} s (preset ${L.preset}, clock ${L.cardClock} at the title card), ${L.outcome} ${L.state} at t=${(+L.time).toFixed(2)} after ${L.wallS.toFixed(0)} s, ${L.marks.length} checkpoints, det ${L.detections}, exp ${L.exposures}, ${L.rec.hashes.length} ticks`);
    t.equal(L.cardClock, 0, `${tag}: the clock waits at 0 on the title card`);
    t.equal(L.preset, r.preset || 'high', `${tag}: at the link's preset`);
    const fd = diffFingerprints(L.fp, ref.fp), fs = fd.filter((x) => STATIC.test(x.field));
    const c = compareRecordings(ref.rec, L.rec);
    // (both reported before either is asserted: a failure names the tick-0 fields AND the first tick that differs)
    if (fd.length) t.log(`  tick-0 fingerprint fields differing: ${fd.map((x) => x.field).join(', ')}`);
    if (!c.same) t.log(`  first tick that differs: ${c.first != null ? `${c.first + 1} (t=${((c.first + 1) / 60).toFixed(2)}): ${c.units.join(', ')}` : `none (${c.n.join(' / ')} ticks)`}; checkpoints ${L.marks.map((m) => `${m.name}@${m.t.toFixed(2)}`).join(' ')}`);
    t.equal(fs.length, 0, `${tag}: the same gameplay world at tick 0${fs.length ? ` (${fs.map((x) => x.field).join(', ')})` : ''}`);
    t(c.same, `${tag}: the same state at every tick (${c.n[0]} / ${c.n[1]} ticks${c.first != null ? `; first differs at tick ${c.first + 1} (t=${((c.first + 1) / 60).toFixed(2)}): ${c.units.slice(0, 8).join(', ')}` : ''})`);
    t.equal(L.outcome, 'done', `${tag}: the walkthrough ran to its end`);
    t.equal(L.state, ref.state, `${tag}: the game ends the same (${L.state})`);
    t(Math.abs(L.time - (ref.end?.t ?? NaN)) < 1e-6, `${tag}: the same end tick (${(+L.time).toFixed(2)} vs ${ref.end?.t.toFixed(2)})`);
    t.equal(L.marks.map((m) => m.name).join(' '), ref.marks.map((m) => m.name).join(' '), `${tag}: the same checkpoints, in the same order`);
    const off = L.marks.map((m, i) => [m.name, m.t - (ref.marks[i]?.t ?? NaN)]).filter(([, d]) => !(Math.abs(d) < 1e-6));
    t(off.length === 0, `${tag}: every checkpoint at the same game time (${off.slice(0, 6).map(([k, d]) => `${k} ${d.toFixed(3)}`).join(', ') || 'all equal'})`);
    t.equal(L.detections, ref.detections, `${tag}: detections ${L.detections}`);
    t.equal(L.exposures, ref.exposures, `${tag}: exposures ${L.exposures}`);
  }
}
