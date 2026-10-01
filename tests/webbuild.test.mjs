/**
 * Web build check. Meant for `SS_DIST=1 node tests/run.mjs webbuild` (dist/ served under /shadow-six/ like GitHub
 * Pages) but also passes on the dev tree: real boot → title splash (disclaimer) → MAIN menu, then M1 and M2
 * through the test API for 20 s of simulation each. The runner fails the test on any console error, page error or HTTP >= 400.
 */
export default async function webbuild(page, t) {
  const dist = !!process.env.SS_DIST;
  const requests = [];
  const onReq = (r) => requests.push(r.url());
  page.on('request', onReq);
  const t0 = Date.now();
  await page.goto(`${t.harness.url}/index.html`);
  await page.waitForFunction(() => window.shadowSix?.hud?.boot?.phase === 'splash' && /PRESS ANY KEY/.test(document.querySelector('.bt-prompt')?.textContent || ''), null, { timeout: 60000 });
  const splashMs = Date.now() - t0;
  const splash = await page.evaluate(() => ({ disclaimer: document.querySelector('.bt-disclaimer')?.textContent || '', build: window.__SS_BUILD__ || null }));
  t(/not affiliated/i.test(splash.disclaimer), 'title splash carries the fan-tribute disclaimer');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'confirm-newuser', null, { timeout: 10000 });
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'main', null, { timeout: 10000 });
  const menuMs = Date.now() - t0;
  const rows = await page.evaluate(() => [...document.querySelectorAll('.mk-host .mk-list .mk-row')].length);
  t(rows >= 5, `MAIN menu rendered (${rows} rows)`);
  await page.waitForTimeout(1000);   // the menu card fades in
  await t.shot('webbuild-menu');
  t.log(`title splash ${splashMs} ms, MAIN menu ${menuMs} ms, ${requests.length} requests`);
  if (dist) {
    t(splash.build && splash.build.v, 'build info present (window.__SS_BUILD__)');
    const base = t.harness.url + '/';
    const outside = requests.filter((u) => u.startsWith('http') && !u.startsWith(base));
    t.equal(outside.length, 0, `every request stays under the /shadow-six/ sub-path (${outside.slice(0, 3)})`);
    t(!requests.some((u) => u.startsWith(base + 'src/')), 'no unbundled src/ modules fetched');
  }

  await t.harness.openGame(page);
  for (const id of ['m01', 'm02']) {
    const s = await page.evaluate(async (mid) => {
      const g = window.__game;
      const s0 = await g.loadMission(mid);
      g.start();
      for (let i = 0; i < 20; i++) { g.advance(1); g.render(); }
      return { s0, s1: g.state() };
    }, id);
    t(s.s0.commandos.length > 0, `${id} has commandos`);
    t(s.s1.time >= 19.9, `${id} advanced 20 s (t=${s.s1.time})`);
    t(['playing', 'won', 'lost'].includes(s.s1.state), `${id} state ${s.s1.state}`);
    await t.shot(`webbuild-${id}`);
    t.log(`${id}: ${s.s1.commandos.length} commandos, ${s.s1.enemies.length} enemies, alarm=${s.s1.alarm}`);
  }
  // live play (real loop, no test mode): ?mission=m01 → briefing → playing, ~20 s of wall time
  await page.goto(`${t.harness.url}/index.html?mission=m01`);
  await page.waitForFunction(() => ['briefing', 'playing'].includes(window.shadowSix?.state), null, { timeout: 60000 });
  if (await page.evaluate(() => window.shadowSix.state === 'briefing')) {
    await page.locator('.ui-briefing .skip').click();
    await page.locator('.ui-briefing .tourhint.start').click();
  }
  await page.waitForFunction(() => window.shadowSix?.state === 'playing', null, { timeout: 10000 });
  const w0 = await page.evaluate(() => window.shadowSix.world.time);
  await page.mouse.click(640, 400);   // a click on the ground: moves the selection if any, else nothing
  await page.waitForTimeout(20000);
  const w1 = await page.evaluate(() => ({ time: window.shadowSix.world.time, state: window.shadowSix.state }));
  t(w1.time > w0 + 10, `live loop ran M1 (${w0.toFixed(1)} → ${w1.time.toFixed(1)} s, ${w1.state})`);
  await t.shot('webbuild-m01-live');
  if (dist) {
    const worker = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /treegen\.worker-/.test(e.name)));
    t.log(`tree worker bundle ${worker ? 'used' : 'not used (main-thread fallback)'}`);
  }
  page.off('request', onReq);
}
