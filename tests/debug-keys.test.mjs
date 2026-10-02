/**
 * Debug mode quick keys: deep link ?debug&mission=m00, PageDown / PageUp cycle the select order, Ctrl+R restarts.
 * README "Debug mode", design-spec §10.7. Split in five files so each stays well inside the 90 s per-test budget.
 */
export default async function debugKeys(page, t) {
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

  step('4.');
  // 4. PageDown → the next level in the select's order
  const next = sel.tiles[(sel.tiles.indexOf('m00') + 1) % sel.tiles.length];
  await page.keyboard.press('PageDown');
  await page.waitForFunction((id) => window.shadowSix.state === 'playing' && !window.shadowSix.debug.mode._launching && window.shadowSix.missionDef?.id === id, next, { timeout: 80000 });
  t.log(`PageDown m00 → ${next}`);
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => window.shadowSix.state === 'playing' && !window.shadowSix.debug.mode._launching && window.shadowSix.missionDef?.id === 'm00', null, { timeout: 80000 });

  step('5.');
  // 5. Ctrl+R: instant restart (a new world, same mission)
  await page.evaluate(() => { window.__w0 = window.shadowSix.world; });
  await page.keyboard.press('Control+KeyR');
  await page.waitForFunction(() => window.shadowSix.world && window.shadowSix.world !== window.__w0 && window.shadowSix.state === 'playing' && !window.shadowSix.debug.mode._launching, null, { timeout: 60000 });
  t.equal(await page.evaluate(() => window.shadowSix.missionDef.id), 'm00', 'restart keeps the mission');

}
