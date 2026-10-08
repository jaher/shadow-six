/**
 * Debug VIDEO MODE never changes the simulation (src/debug/walkthrough.js): the M3 walkthrough, watched with the
 * director camera, the step cones, captions, pauses, speed changes, free camera, a jump back (reload + fast-forward)
 * and jumps ahead, wins exactly like the scripted run (tools/solutions/m03.solution.mjs played logic-only, as
 * tests/m03-solution.test.mjs does): the same checkpoints at the same game times, the same end time, 0 detections,
 * nobody ever inside a live cone (the driver's exposure watch). (The node harness, tools/solutions/run-headless.mjs,
 * is only an approximation of the game — its grid lacks the library meshes — so the reference is the game's own
 * logic-only run, in the same browser.)
 */
export const timeout = 900_000;

export default async function debugWalkthroughSim(page, t) {
  page.setDefaultTimeout(600000);
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);

  step('1. the scripted run, logic only (the reference)');
  const ref = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m03');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m03.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e?.message || e); }
    for (let i = 0; i < 600 && G.game.state === 'playing'; i++) G.game.step(dt);
    const w = G.game.world;
    return { error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposures?.().length ?? null,
      marks: D.checkpoints.map((c) => ({ name: c.name, t: c.t })) };
  });
  t.log(`reference: ${ref.state} t=${ref.time.toFixed(2)} detections=${ref.detections} exposures=${ref.exposures} checkpoints=${ref.marks.length} error=${ref.error}`);
  t(!ref.error && ref.state === 'won' && ref.detections === 0, `the scripted run wins unseen (${ref.state}, ${ref.detections}, ${ref.error})`);

  step('2. the walkthrough, watched: director, cones, captions, pauses, speeds, free camera, jumps');
  await page.goto(`${t.harness.url}/index.html?debug&preset=low&walkthrough=m03`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]'), null, { timeout: 180000 });
  // (a jump back stops the running walkthrough — outcome 'stopped' — and starts another: the run that counts ends 'done')
  await page.evaluate(() => { window.__end = null; window.shadowSix.events.on('debug:walkthrough-end', (r) => { if (r.outcome !== 'stopped') window.__end = r; }); });
  t.equal(await page.evaluate(() => window.shadowSix.world.time), 0, 'tick 0 waits for the title card');
  const click = (sel) => page.locator(sel).click();
  const wk = (fn) => page.waitForFunction(fn, null, { timeout: 600000 });
  await click('#wt-card [data-act=start]');
  await click('#wt-bar [data-act="speed-4"]');
  // stage A with the director at work; a pause, captions off and on, free camera and back
  await wk(() => window.shadowSix.debug.mode.replay?.doneCps.includes('A1'));
  await click('#wt-bar [data-act=play]');
  await page.waitForTimeout(800);
  await click('#wt-bar [data-act=play]');
  await click('#wt-bar [data-act=cc]');
  await click('#wt-bar [data-act=cam]');
  await page.evaluate(() => window.shadowSix.cameraController.panBy(-20, 15));
  await page.waitForTimeout(600);
  await click('#wt-bar [data-act=cam]');
  await click('#wt-bar [data-act=cc]');
  await wk(() => window.shadowSix.debug.mode.replay?.doneCps.includes('A3'));
  // a jump back: chapter A again (reload + fast-forward), then on to F by fast-forward
  await page.evaluate(() => { window.__w0 = window.shadowSix.world; });
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-chapter="A"]');
  await wk(() => { const r = window.shadowSix.debug.mode.replay; return r && window.shadowSix.world !== window.__w0 && !r.pacer.turbo; });
  t(true, 'jumped back to chapter A (mission reloaded)');
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-chapter="F"]');
  await wk(() => { const r = window.shadowSix.debug.mode.replay; return r?.chapterId === 'F' && !r.pacer.turbo; });
  step('   F: watched at 4×, skip waits');
  await wk(() => window.shadowSix.debug.mode.replay?.doneCps.includes('F2'));
  await click('#wt-bar [data-act="speed-2"]');
  await click('#wt-bar [data-act=next]');
  await wk(() => { const r = window.shadowSix.debug.mode.replay; return r?.doneCps.includes('F3') && !r.pacer.turbo; });
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-chapter="I"]');
  await wk(() => { const r = window.shadowSix.debug.mode.replay; return r?.chapterId === 'I' && !r.pacer.turbo; });
  step('   I and J: the charges and the escape, watched at 4×');
  await click('#wt-bar [data-act="speed-4"]');
  await wk(() => !!window.__end);
  const run = await page.evaluate(() => ({ ...window.__end, gameState: window.shadowSix.state, card: document.getElementById('wt-card')?.dataset.kind || null,
    cardText: document.getElementById('wt-card')?.textContent || '' }));
  t.log(`walkthrough: ${run.outcome} ${run.state} t=${run.time.toFixed(2)} detections=${run.detections} exposures=${run.exposures} checkpoints=${run.marks.length} error=${run.error}`);

  step('3. the same run');
  t.equal(run.outcome, 'done', 'the walkthrough ran to its end');
  t.equal(run.state, 'won', 'M3 won');
  t.equal(run.detections, 0, '0 detections');
  t.equal(run.exposures, ref.exposures, `seen in a cone: ${run.exposures} (scripted run: ${ref.exposures})`);
  t.equal(run.marks.map((m) => m.name).join(' | '), ref.marks.map((m) => m.name).join(' | '), 'the same checkpoints, in the same order');
  const off = run.marks.map((m, i) => [m.name.split(' ')[0], m.t - (ref.marks[i]?.t ?? NaN)]).filter(([, d]) => !(Math.abs(d) < 1e-6));
  t(off.length === 0, `every checkpoint at the same game time (${off.slice(0, 6).map(([k, d]) => `${k} ${d.toFixed(3)}`).join(', ') || 'all equal'})`);
  t(Math.abs(run.time - ref.time) < 1e-6, `the same end time (${run.time.toFixed(3)} vs ${ref.time.toFixed(3)})`);
  t(run.card === 'end' && /Mission complete/.test(run.cardText), `the closing card (${run.cardText.slice(0, 100)})`);
  await page.screenshot({ path: t.harness.shotPath('debug-walkthrough-end.png') });
}
