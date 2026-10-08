/**
 * Debug VIDEO MODE on the desktop (src/debug/walkthrough.js, docs/walkthrough-format.md): the debug select offers
 * "Watch walkthrough" for every mission with a saved solution and "No walkthrough yet" for the rest; M3 opens on its
 * title card, then plays live with the director camera on the acting commando, the narration of the step, the step's
 * cones; pause, ½× / 1× / 2× / 4×, next / previous step, the chapter list (a jump ahead fast-forwards, a jump back
 * reloads), captions off / on, free camera and back, and ✕ back to the debug menu with the game's camera, clock and
 * input restored.
 */
export const timeout = 420_000;

export default async function debugWalkthrough(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  page.setDefaultTimeout(180000);
  const S = () => page.evaluate(() => {
    const g = window.shadowSix, m = g.debug.mode, r = m.replay, w = g.world, cc = g.cameraController;
    const cap = document.getElementById('wt-cap'), bar = document.getElementById('wt-bar');
    return {
      on: !!r?.isWalkthrough, mission: g.missionDef?.id ?? null, state: g.state, time: w?.time ?? 0, manualTick: g.manualTick,
      chapter: r?.chapterId ?? null, step: r?.step?.cp ?? null, ff: r?.pacer.turbo ?? null, speed: r?.speed ?? null, paused: r?.paused ?? null,
      free: r?.free ?? null, captions: r?.captions ?? null, done: r?.doneCps.slice() ?? [], detections: r?.driver?.detections() ?? null,
      cap: cap?.textContent || '', capMode: cap?.dataset.mode || '', capHidden: cap ? cap.hidden : null, bar: bar ? { ...bar.dataset } : null,
      scripted: !!g.cameraRig?.scripted, forced: [...(g.cones?.forced || [])].map((e) => e.tag), select: !!document.getElementById('dbg-select'),
      card: document.getElementById('wt-card')?.dataset.kind || null, target: cc ? [cc.target.x, cc.target.z] : null, zoom: cc?.zoom ?? null,
    };
  });
  /** sim seconds per wall second over `ms` */
  const rate = async (ms = 2000) => {
    const a = await page.evaluate(() => [window.shadowSix.world.time, performance.now()]);
    await page.waitForTimeout(ms);
    const b = await page.evaluate(() => [window.shadowSix.world.time, performance.now()]);
    return (b[0] - a[0]) / ((b[1] - a[1]) / 1000);
  };
  /** the acting commando's screen point inside the director's free rect (the UI does not cover him) */
  const framed = () => page.evaluate(() => {
    const g = window.shadowSix, r = g.debug.mode.replay, cc = g.cameraController;
    const who = r.step?.who?.length ? r.step.who : [r.focus?.role];
    const u = g.world.commandos.find((c) => c.alive && who.includes(c.role)) || r.focus;
    const q = u.vehicle || u;
    const s = cc.worldToScreen(q.x, q.y || 0, q.z), rect = r.safeRect();
    const inside = s.x >= rect.x - 4 && s.x <= rect.x + rect.w + 4 && s.y >= rect.y - 4 && s.y <= rect.y + rect.h + 4;
    return { role: u.role, x: Math.round(s.x), y: Math.round(s.y), rect, inside };
  });
  const click = (sel) => page.locator(sel).click();

  step('1. the select: watch walkthrough for M3, "no walkthrough yet" for the rest');
  await page.goto(`${url}/index.html?debug`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  await page.goto(`${url}/index.html?debug`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-wt'), null, { timeout: 90000 });
  const listed = await page.evaluate(() => ({
    wt: [...document.querySelectorAll('#dbg-select .dbg-wt')].map((b) => b.dataset.walkthrough),
    none: [...document.querySelectorAll('#dbg-select .dbg-wt-none')].map((b) => b.dataset.walkthrough),
  }));
  t(listed.wt.includes('m03'), `M3 has a walkthrough (${listed.wt})`);
  t(listed.none.includes('m01') && !listed.none.includes('m03'), `M1 is listed without one (${listed.none.length} missions)`);
  await click('#dbg-select .dbg-wt-none[data-walkthrough="m01"]');
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=none]'));
  t(/No walkthrough yet/.test(await page.locator('#wt-card').textContent()), 'M1: "No walkthrough yet"');
  await click('#wt-card [data-act=ok]');
  await page.waitForFunction(() => !document.getElementById('wt-card') && !!document.getElementById('dbg-select'));
  t(true, 'OK goes back to the debug menu');

  step('2. M3: title card, then the walkthrough plays');
  await click('#dbg-select .dbg-wt[data-walkthrough="m03"]');
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix.missionDef?.id === 'm03', null, { timeout: 120000 });
  let s = await S();
  t(s.on && s.time < 1 && s.chapter === 'A', `fresh M3 waiting on its title card (t=${s.time.toFixed(2)}, chapter ${s.chapter})`);
  const intro = await page.locator('#wt-card').textContent();
  t(/Reverse Engineering/.test(intro) && /10 chapters/.test(intro), `title card: mission and chapters (${intro.slice(0, 90)}…)`);
  t(Math.abs(await rate(1200)) < 1e-6, 'the clock waits for the title card');
  await t.shot('debug-walkthrough-intro');
  await click('#wt-card [data-act=start]');
  await page.waitForFunction(() => !document.getElementById('wt-card') && window.shadowSix.world.time > 0.5, null, { timeout: 30000 });
  s = await S();
  t(s.state === 'playing' && s.manualTick && s.scripted, `playing; the walkthrough owns the clock and the camera (${JSON.stringify({ st: s.state, m: s.manualTick, sc: s.scripted })})`);
  t(s.step === 'A1' && /Sapper/.test(s.cap) && /bear trap/.test(s.cap), `caption: step A1, who and what (${s.cap.slice(0, 120)})`);
  t(['e1', 'e2', 'e3'].every((e) => s.forced.includes(e)), `the step's cones are drawn (${s.forced})`);
  await page.evaluate(() => { window.__ran = 0; window.shadowSix.enqueue(() => { window.__ran = 1; }); });
  await page.waitForTimeout(300);
  t.equal(await page.evaluate(() => window.__ran), 0, 'a player order is held while the walkthrough plays');

  step('3. speeds (skip waits off to measure)');
  await click('#wt-bar [data-act=skip]');
  t.equal((await S()).bar.skip, '0', 'skip waits off');
  const r1 = await rate(2500);
  await click('#wt-bar [data-act="speed-4"]');
  const r4 = await rate(2500);
  await click('#wt-bar [data-act="speed-0.5"]');
  const rh = await rate(2500);
  t.log(`rates: 1x ${r1.toFixed(2)}, 4x ${r4.toFixed(2)}, 0.5x ${rh.toFixed(2)} sim s / s`);
  t(r1 > 0.3 && r1 < 1.15, `1x is about real time (${r1.toFixed(2)})`);
  t(r4 > r1 * 2 && r4 < 4.3, `4x is faster, never above 4x (${r4.toFixed(2)})`);
  t(rh > 0.1 && rh < 0.6 && rh < r1, `0.5x is slower than 1x (${rh.toFixed(2)})`);
  t.equal(await page.evaluate(() => document.querySelector('#wt-bar [data-act="speed-0.5"]').getAttribute('aria-pressed')), 'true', '½× shown pressed');
  await click('#wt-bar [data-act="speed-4"]');
  await click('#wt-bar [data-act=skip]');

  step('4. pause / play');
  await click('#wt-bar [data-act=play]');
  t(Math.abs(await rate(1000)) < 1e-6 && (await S()).paused, 'paused: the sim holds');
  t(/paused/i.test((await S()).cap), 'the caption says paused');
  await click('#wt-bar [data-act=play]');
  t(await rate(1200) > 0.5, 'playing again');

  step('5. next step: fast-forward to the end of A1');
  await click('#wt-bar [data-act=next]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && r.doneCps.includes('A1') && !r.pacer.turbo; }, null, { timeout: 120000 });
  s = await S();
  t(s.step === 'A2' && s.detections === 0, `on step A2, never seen (${s.step}, ${s.detections})`);
  t.equal(s.speed, 4, 'the chosen speed stays');
  await page.waitForTimeout(2500);
  let f = await framed();
  t(f.inside, `the director frames the acting man (${f.role}) in the free part of the screen (${JSON.stringify(f)})`);
  await t.shot('debug-walkthrough-a2');

  step('6. chapter list: C ahead (fast-forward), then B behind (reload)');
  await click('#wt-bar [data-act=chapters]');
  const items = await page.evaluate(() => ({ ch: [...document.querySelectorAll('#wt-menu [data-chapter]')].map((b) => b.dataset.chapter).join(''), st: document.querySelectorAll('#wt-menu [data-step]').length }));
  t(items.ch === 'ABCDEFGHIJ' && items.st >= 30, `the chapter list: every chapter and its steps (${items.ch}, ${items.st} steps)`);
  await t.shot('debug-walkthrough-chapters');
  const w0 = await page.evaluate(() => { window.__w0 = window.shadowSix.world; return 1; });
  await click('#wt-menu [data-chapter="C"]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && r.chapterId === 'C' && !r.pacer.turbo && document.getElementById('wt-cap')?.dataset.mode === 'chapter'; }, null, { timeout: 180000 });
  s = await S();
  t(await page.evaluate(() => window.shadowSix.world === window.__w0) && ['B1', 'B2', 'B3'].every((k) => s.done.includes(k)), `C reached by fast-forward, same run (${s.done.join(',')})`);
  t(s.capMode === 'chapter' && /uniform/i.test(s.cap), `the chapter card (${s.cap.slice(0, 80)})`);
  t.equal(s.detections, 0, 'never seen on the way');
  await click('#wt-bar [data-act=chapters]');
  await click('#wt-menu [data-chapter="B"]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && window.shadowSix.world !== window.__w0 && r.chapterId === 'B' && !r.pacer.turbo; }, null, { timeout: 180000 });
  s = await S();
  t(s.time > 200 && s.time < 330 && !s.done.includes('B1') && s.done.includes('A4'), `B by reload + fast-forward (t=${s.time.toFixed(1)}, ${s.done.join(',')})`);
  t(s.speed === 4 && s.captions, 'speed and captions carried over the reload');

  step('7. previous step: back to the start of this step (reload)');
  await page.waitForTimeout(6500); // (the chapter card, then more than 4 s into the step: ⏮ restarts it)
  const wB = await page.evaluate(() => { window.__w1 = window.shadowSix.world; return window.shadowSix.debug.mode.replay.step.cp; });
  await click('#wt-bar [data-act=prev]');
  await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && window.shadowSix.world !== window.__w1 && !r.pacer.turbo; }, null, { timeout: 180000 });
  s = await S();
  t.equal(s.step, wB, `back at the start of step ${wB}`);

  step('8. captions off / on; free camera and back');
  await click('#wt-bar [data-act=cc]');
  s = await S();
  t(s.capHidden && s.bar.cc === '0', 'captions hidden');
  await click('#wt-bar [data-act=cc]');
  t(!(await S()).capHidden, 'captions back');
  await click('#wt-bar [data-act=cam]');
  s = await S();
  t(s.free && !s.scripted, 'free camera: the director lets go, scrolling is the user\'s');
  const c0 = s.target;
  await page.evaluate(() => window.shadowSix.cameraController.panBy(25, 10));
  await page.waitForTimeout(1500);
  const c1 = (await S()).target;
  t(Math.hypot(c1[0] - c0[0] - 25, c1[1] - c0[1] - 10) < 3, `the view stays where the user put it (${c0.map((v) => v.toFixed(1))} → ${c1.map((v) => v.toFixed(1))})`);
  await click('#wt-bar [data-act=cam]');
  await page.waitForTimeout(2500);
  s = await S();
  f = await framed();
  t(!s.free && s.scripted && f.inside, `director back on the acting man (${JSON.stringify(f)})`);

  step('9. ✕ exits to the debug menu, the game restored');
  await click('#wt-bar [data-act=exit]');
  await page.waitForFunction(() => !document.getElementById('wt-bar') && !!document.getElementById('dbg-select'), null, { timeout: 30000 });
  s = await S();
  t(!s.on && !s.manualTick && !s.scripted && s.forced.length === 0, `walkthrough gone: clock, camera and cones restored (${JSON.stringify({ m: s.manualTick, sc: s.scripted, f: s.forced })})`);
  t(s.state === 'title' && !s.mission, `back at the debug menu with no mission loaded (${s.state})`);
  t.equal(await page.evaluate(() => window.shadowSix.debug.mode.lastWalkthrough?.outcome), 'stopped', 'the walkthrough reports it was stopped');
  t(!(await page.evaluate(() => document.body.classList.contains('dbg-video'))), 'the debug corner buttons are back');
}
