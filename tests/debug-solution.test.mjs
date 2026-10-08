/**
 * Debug SOLUTION replay (src/debug/solution-replay.js, docs README "Debug mode"): in ?debug the level select offers
 * "play the solution" for missions with a saved solution (tools/solutions/m03.solution.mjs); it loads the mission
 * fresh and plays the solution live in the real game loop — 1× by default (sim time ≈ wall time), 2× / 4× / 8×,
 * pause, skip to a step (fast-forward, or reload + fast-forward for an earlier step) — with the camera on the acting
 * commando and step captions. Player orders are held while it runs; Esc stops it and the game is the player's again.
 */
export const timeout = 240_000;

export default async function debugSolution(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  const R = () => page.evaluate(() => {
    const m = window.shadowSix.debug.mode, r = m.replay, g = window.shadowSix, w = g.world;
    const cc = g.cameraController, f = r?.focus;
    const ft = f ? (f.vehicle || f) : null;
    return {
      on: !!r, stage: r?.stage?.id ?? null, speed: r?.speed ?? null, ff: r?.fastForward ?? null, time: w?.time ?? 0, state: g.state,
      manualTick: g.manualTick, checkpoints: r?.driver?.checkpoints.map((c) => c.name.split(' ')[0]) ?? [],
      detections: r?.driver?.detections() ?? null, cap: document.getElementById('dbg-sol-cap')?.textContent || '',
      bar: !!document.getElementById('dbg-sol-bar'), mission: g.missionDef?.id ?? null, last: m.lastReplay ?? null,
      camDist: ft && cc ? Math.hypot(cc.target.x - ft.x, cc.target.z - ft.z) : null, focus: f?.role ?? null,
      solBtn: !document.getElementById('dbg-sol-btn')?.hidden,
    };
  });
  /** sim seconds per wall second over `ms` */
  const rate = async (ms = 2000) => {
    const a = await page.evaluate(() => [window.shadowSix.world.time, performance.now()]);
    await page.waitForTimeout(ms);
    const b = await page.evaluate(() => [window.shadowSix.world.time, performance.now()]);
    return (b[0] - a[0]) / ((b[1] - a[1]) / 1000);
  };
  const fps = () => page.evaluate(() => window.shadowSix.fps || 0);

  step('1. level select offers the solution');
  await page.goto(`${url}/index.html?debug`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  await page.goto(`${url}/index.html?debug`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-tile'), null, { timeout: 60000 });
  const sols = await page.evaluate(() => [...document.querySelectorAll('#dbg-select .dbg-sol')].map((b) => b.dataset.solution));
  t(sols.includes('m03'), `the select lists the M3 solution (${sols})`);
  // the select's toggles do not leak into a replay: it plays the mission as authored
  await page.locator('#dbg-select .dbg-opt[data-opt="noDetect"]').click();
  await page.locator('#dbg-select .dbg-sol[data-solution="m03"]').click();
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay && window.shadowSix.state === 'playing' && window.shadowSix.missionDef?.id === 'm03'
    && document.getElementById('dbg-sol-cap')?.dataset.stage === 'A', null, { timeout: 90000 });
  let r = await R();
  t(r.on && r.bar && r.mission === 'm03' && r.stage === 'A', `replay running on a fresh M3, stage A (${JSON.stringify(r)})`);
  t(r.time < 10, `fresh mission (t=${r.time.toFixed(1)} s)`);
  t(/Step A/.test(r.cap), `caption names the step (${r.cap})`);
  t(await page.evaluate(() => !window.shadowSix.debug.flags.noDetect), 'enemies see during the replay even with "blind & deaf" on');

  step('2. 1x is real time; player orders are held');
  const f1 = await fps();
  const r1 = await rate(2500);
  t.log(`1x: ${r1.toFixed(2)} sim s / s at ${f1.toFixed(0)} fps`);
  t(r1 > 0.25 && r1 < 1.15, `1x plays at about real time (${r1.toFixed(2)})`);
  await page.evaluate(() => { window.__ran = 0; window.shadowSix.enqueue(() => { window.__ran = 1; }); });
  await page.waitForTimeout(300);
  t.equal(await page.evaluate(() => window.__ran), 0, 'a player order is held while the replay plays');
  await t.shot('debug-solution-1x');

  step('3. 8x');
  await page.locator('#dbg-sol-bar [data-act="speed-8"]').click();
  const r8 = await rate(2500);
  t.log(`8x: ${r8.toFixed(2)} sim s / s`);
  t(r8 > r1 * 3 && r8 < 8.6, `8x is much faster than 1x, never above 8x (${r8.toFixed(2)} vs ${r1.toFixed(2)})`);
  t.equal(await page.evaluate(() => document.querySelector('#dbg-sol-bar [data-act="speed-8"]').getAttribute('aria-pressed')), 'true', '8x pressed');

  step('4. skip to step B (fast-forward through A)');
  await page.locator('#dbg-sol-bar [data-act="steps"]').click();
  const items = await page.evaluate(() => [...document.querySelectorAll('#dbg-sol-steps [data-stage]')].map((b) => b.dataset.stage).join(''));
  t.equal(items, 'ABCDEFGHIJ', 'the steps menu lists every stage');
  await page.locator('#dbg-sol-steps [data-stage="B"]').click();
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.stage?.id === 'B', null, { timeout: 120000 });
  r = await R();
  t.log(`at B: t=${r.time.toFixed(1)} checkpoints ${r.checkpoints.join(',')}`);
  for (const k of ['A1', 'A2', 'A3', 'A4']) t(r.checkpoints.includes(k), `checkpoint ${k} on the way`);
  t.equal(r.detections, 0, 'nobody spotted on the way');
  t(r.ff === false && r.speed === 8, `back to 8x after the jump (${r.ff} ${r.speed})`);
  t.equal(await page.evaluate(() => document.querySelector('#dbg-sol-bar [data-act="speed-8"]').getAttribute('aria-pressed')), 'true', '8x shown pressed again');

  step('5. B1 at 8x, camera on the acting commando');
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.driver?.checkpoints.some((c) => c.name.startsWith('B1')), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  r = await R();
  t(r.checkpoints.includes('B1') && r.detections === 0, `B1 e5 knifed, 0 detections (${r.checkpoints})`);
  t(r.focus && r.camDist != null && r.camDist < 6, `the camera follows the acting commando (${r.focus}, ${r.camDist?.toFixed(2)} m)`);
  await t.shot('debug-solution-b1');

  step('6. pause');
  await page.locator('#dbg-sol-bar [data-act="pause"]').click();
  const rp = await rate(800);
  t(Math.abs(rp) < 1e-6 && (await R()).state === 'paused', `paused: the sim holds (${rp})`);
  await page.locator('#dbg-sol-bar [data-act="pause"]').click();
  t(await rate(800) > 0.5, 'resumed');

  step('7. skip back to A: reload + fast-forward');
  const w0 = await page.evaluate(() => { window.__w0 = window.shadowSix.world; return window.shadowSix.world.time; });
  await page.locator('#dbg-sol-bar [data-act="steps"]').click();
  await page.locator('#dbg-sol-steps [data-stage="A"]').click();
  await page.waitForFunction(() => window.shadowSix.world && window.shadowSix.world !== window.__w0 && window.shadowSix.debug.mode.replay?.stage?.id === 'A', null, { timeout: 90000 });
  r = await R();
  t(r.time < w0 && r.time < 30 && r.speed === 8, `M3 reloaded and replaying from A (t=${r.time.toFixed(1)}, ${r.speed}x)`);

  step('8. Esc stops: the game is the player\'s');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.shadowSix.debug.mode.replay && !document.getElementById('dbg-sol-bar'), null, { timeout: 5000 });
  r = await R();
  t(!r.manualTick && r.state === 'playing' && r.mission === 'm03', `game running normally (${JSON.stringify({ m: r.manualTick, s: r.state })})`);
  t.equal(r.last?.outcome, 'stopped', 'the replay reports it was stopped');
  const rn = await rate(1500);
  t(rn > 0.25 && rn < 1.15, `the normal game loop runs the sim (${rn.toFixed(2)})`);
  await page.evaluate(() => { window.__ran = 0; window.shadowSix.enqueue(() => { window.__ran = 1; }); });
  await page.waitForFunction(() => window.__ran === 1, null, { timeout: 5000 });
  t(true, 'player orders reach the game again');
  t(r.solBtn || (await R()).solBtn, 'the in-game SOL button is back');
  t(await page.evaluate(() => window.shadowSix.debug.flags.noDetect), 'the select\'s "blind & deaf" is back after the replay');
  await page.evaluate(() => window.shadowSix.debug.mode.setOption('noDetect', false));

  step('9. F9 replays again; skip to the last step: the live replay wins M3 unseen');
  await page.keyboard.press('F9');
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.stage?.id === 'A' && window.shadowSix.world.time < 5, null, { timeout: 90000 });
  await page.evaluate(() => { window.__end = null; window.shadowSix.events.on('debug:replay-end', (r) => { window.__end = r; }); });
  await page.locator('#dbg-sol-bar [data-act="steps"]').click();
  await page.locator('#dbg-sol-steps [data-stage="J"]').click();
  await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.stage?.id === 'J', null, { timeout: 150000 });
  step('   at J');
  await page.waitForFunction(() => !!window.__end, null, { timeout: 60000 });
  const end = await page.evaluate(() => ({ ...window.__end, state: window.shadowSix.state, manualTick: window.shadowSix.manualTick }));
  t.log(`end: ${JSON.stringify({ ...end, checkpoints: end.checkpoints.length })}`);
  t.equal(end.outcome, 'done', 'the replay ran to its end');
  t.equal(end.state, 'won', 'M3 won');
  t.equal(end.detections, 0, 'never seen');
  for (const k of ['C3', 'E3', 'G3', 'I3', 'J2']) t(end.checkpoints.some((c) => c.startsWith(k)), `checkpoint ${k}`);
  t(!end.manualTick, 'the game loop has its clock back');
}
