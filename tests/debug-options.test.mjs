/**
 * Debug mode options: F10 in game freezes the sim; options act live and are remembered; remembered (deep link: debug-deeplink).
 * README "Debug mode", design-spec §10.7. Split in five files so each stays well inside the 90 s per-test budget.
 */
export default async function debugOptions(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  const absent = () => page.evaluate(() => ({
    overlay: !!document.getElementById('dbg-select'), btn: !!document.getElementById('dbg-btn'),
    info: !!document.getElementById('dbg-info'), debug: window.shadowSix?.debug ?? null,
  }));
  // fresh options, then straight into m00 through the deep link
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options')); // harness page: same origin
  await page.goto(`${url}/index.html?debug&mission=m00`);
  await page.waitForFunction(() => window.shadowSix?.state === 'playing' && !window.shadowSix.debug.mode._launching && window.shadowSix.missionDef?.id === 'm00', null, { timeout: 60000 });
  const sel = { tiles: await page.evaluate(() => window.shadowSix.debug.mode.order()) };

  step('6.');
  // 6. F10 in game: select opens (sim frozen), an option toggles live and is remembered; Esc resumes
  await page.keyboard.press('F10');
  await page.waitForSelector('#dbg-select .dbg-tile.current[data-mission="m00"]');
  t.equal(await page.evaluate(() => window.shadowSix.timeScale), 0, 'sim frozen while the select is open');
  t.log('m00 thumbnail cached:', await page.evaluate(() => /url\(/.test(document.querySelector('#dbg-select .dbg-tile[data-mission="m00"] .dbg-thumb').style.backgroundImage)));
  await page.locator('#dbg-select .dbg-opt[data-opt="invulnerable"]').click();
  const opt = await page.evaluate(() => ({ live: window.shadowSix.world.debug?.invulnerable, saved: JSON.parse(localStorage.getItem('shadowsix.debug.options') || '{}').invulnerable }));
  t(opt.live === true && opt.saved === true, `invulnerable live + remembered (${JSON.stringify(opt)})`);
  const hp = await page.evaluate(() => { const c = window.shadowSix.world.commandos[0]; const h = c.hp; c.takeDamage(50, null, 'shot'); return [h, c.hp]; });
  t.equal(hp[1], hp[0], 'invulnerable commando takes no damage');
  for (const k of ['noDetect', 'cones', 'freeCamera', 'timeScale']) await page.locator(`#dbg-select .dbg-opt[data-opt="${k}"]`).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('dbg-select') && window.shadowSix.timeScale === 2);
  await page.waitForTimeout(200);
  const live = await page.evaluate(() => {
    const g = window.shadowSix, w = g.world;
    return { cones: g.cones?.showAll, zooms: g.cameraController.cfg.zoomLevels, blind: w.debug.noDetect };
  });
  t(live.cones === true && live.blind === true && Math.max(...live.zooms) >= 4, `cones / blind / free camera live (${JSON.stringify(live)})`);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shadowsix.debug.options') || '{}'));
  t(saved.invulnerable && saved.noDetect && saved.cones && saved.freeCamera && saved.timeScale === 2, `all toggles remembered (${JSON.stringify(saved)})`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
}
