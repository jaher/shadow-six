/**
 * A shared VIDEO MODE link (user 2026-10-12: "allow me to share the url in video mode … add something to the url to
 * directly go to video mode, showing the screen where you have to click start video" + "also speed should be
 * configurable in the url"):
 *  - `?debug&walkthrough=m03&speed=4` loads M3 behind the LOADING screen and its progress bar ("Add a quick way to see
 *    the state of loading with a loading bar when sending that link"), then opens its title card and waits there for
 *    ▶ Start (no auto-start), clock at 0;
 *  - ▶ Start plays at 4×; the speed buttons keep `speed=` in the address bar up to date;
 *  - entering video mode from the debug select puts `walkthrough=<id>` in the address bar (the link to share);
 *  - ✕ back to the debug menu takes `walkthrough` / `speed` out again.
 */
export const timeout = 420_000;

export default async function debugVideoLink(page, t) {
  const url = t.harness.url;
  page.setDefaultTimeout(180000);
  const q = () => page.evaluate(() => Object.fromEntries(new URL(location.href).searchParams));
  const click = (sel) => page.locator(sel).click();

  await page.goto(`${url}/index.html?debug&preset=low&walkthrough=m03&speed=4`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  // the cold load behind the link shows the LOADING screen with its progress bar ("…a loading bar when sending that link")
  await page.waitForFunction(() => document.querySelector('.mk-loadbar .fill'), null, { timeout: 60000 });
  const bar = await page.evaluate(() => document.querySelector('.mk-loadbar .pct')?.textContent || '');
  t(/LOADING \d+%/.test(bar), `the link loads behind the LOADING bar (${bar})`);
  await t.shot('debug-video-link-loading');
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.missionDef?.id === 'm03', null, { timeout: 180000 });
  await page.waitForTimeout(11000); // the in-app title card goes on by itself after 9 s; a shared link's must not
  const held = await page.evaluate(() => ({ card: document.getElementById('wt-card')?.dataset.kind || null, time: window.shadowSix.world.time }));
  t(held.card === 'intro' && held.time === 0, `the shared link waits on the title card (${held.card}, t=${held.time})`);
  let p = await q();
  t(p.walkthrough === 'm03' && p.speed === '4', `the address bar is the video link (${JSON.stringify(p)})`);
  await t.shot('debug-video-link-card');

  await click('#wt-card [data-act=start]');
  await page.waitForFunction(() => window.shadowSix.world.time > 2, null, { timeout: 60000 });
  const sp = await page.evaluate(() => window.shadowSix.debug.mode.replay?.speed ?? null);
  t.equal(sp, 4, 'plays at the speed of the link (4×)');
  await click('#wt-bar [data-act="speed-2"]');
  p = await q();
  t.equal(p.speed, '2', 'speed 2× → speed=2 in the address bar');
  await click('#wt-bar [data-act="speed-1"]');
  p = await q();
  t(!('speed' in p) && p.walkthrough === 'm03', `1× → no speed= (${JSON.stringify(p)})`);

  // ✕ back to the debug menu: no video link any more; ▶ VIDEO from the select puts it back
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('dbg-select'), null, { timeout: 60000 });
  p = await q();
  t(!('walkthrough' in p) && !('speed' in p), `back in the debug menu: no walkthrough / speed (${JSON.stringify(p)})`);
  await click('#dbg-select .dbg-wt[data-walkthrough="m03"]');
  await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix.debug.mode.replay?.isWalkthrough, null, { timeout: 180000 });
  p = await q();
  t(p.walkthrough === 'm03' && p.mission === 'm03', `video mode from the select: the address bar is the video link (${JSON.stringify(p)})`);
}
