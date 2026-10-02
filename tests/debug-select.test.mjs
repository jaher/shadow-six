/**
 * Debug mode: ?debug goes straight to DEBUG LEVEL SELECT listing every mission of missionList(); a tap launches it (briefing skipped), info HUD + F11.
 * README "Debug mode", design-spec §10.7. Split in five files so each stays well inside the 90 s per-test budget.
 */
export default async function debugSelect(page, t) {
  const url = t.harness.url;
  const T0 = Date.now();
  const step = (n) => t.log(`${n} @${((Date.now() - T0) / 1000).toFixed(1)} s`);
  const absent = () => page.evaluate(() => ({
    overlay: !!document.getElementById('dbg-select'), btn: !!document.getElementById('dbg-btn'),
    info: !!document.getElementById('dbg-info'), debug: window.shadowSix?.debug ?? null,
  }));
  step('2.');
  // 2. ?debug: straight to the level select, every mission of missionList grouped
  await page.goto(`${url}/index.html?debug`);
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
  await page.goto(`${url}/index.html?debug`);
  await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-tile'), null, { timeout: 60000 });
  const sel = await page.evaluate(() => ({
    tiles: [...document.querySelectorAll('#dbg-select .dbg-tile')].map((b) => b.dataset.mission),
    groups: [...document.querySelectorAll('#dbg-select .dbg-grid')].map((g) => g.dataset.group),
    list: window.shadowSix.debug.mode.missions().map((m) => m.id),
    splash: window.shadowSix.hud?.boot?.phase || null,
  }));
  t.equal(sel.tiles.length, sel.list.length, 'one tile per missionList entry');
  t.equal([...sel.tiles].sort().join(), [...sel.list].sort().join(), 'the tiles are exactly missionList');
  t(sel.groups[0] === 'BEL' && sel.groups.includes('TEST'), `grouped BEL first, test maps present (${sel.groups})`);
  const bel = sel.tiles.filter((id) => /^m(0[1-9]|[1-9]\d)$/.test(id));
  t.equal(bel.join(), [...bel].sort().join(), 'BEL tiles in campaign-number order');
  t(sel.splash !== 'splash', 'boot splash skipped');
  await t.shot('debug-select');

  t.equal(sel.tiles.join(), (await page.evaluate(() => window.shadowSix.debug.mode.order())).join(), 'PageDown order = the select order');

  step('3.');
  // 3. tap m00 → playing (briefing skipped), URL deep link updated, info HUD shows it
  await page.locator('#dbg-select .dbg-tile[data-mission="m00"]').click();
  await page.waitForFunction(() => window.shadowSix.state === 'playing' && !window.shadowSix.debug.mode._launching && window.shadowSix.missionDef?.id === 'm00', null, { timeout: 60000 });
  t(/[?&]mission=m00\b/.test(page.url()), `URL carries the mission (${page.url()})`);
  t(!(await page.evaluate(() => !!document.getElementById('dbg-select'))), 'overlay closed after launch');
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => ({ text: document.getElementById('dbg-info')?.textContent || '', hidden: document.getElementById('dbg-info')?.hidden }));
  t(!info.hidden && /m00/.test(info.text) && /FPS/.test(info.text) && /draws \d+/.test(info.text), `info HUD (${info.text})`);
  await t.shot('debug-ingame');
  await page.keyboard.press('F11');
  t(await page.evaluate(() => document.getElementById('dbg-info').hidden), 'F11 hides the info HUD');
  await page.keyboard.press('F11');

}
