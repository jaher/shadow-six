/**
 * Debug mode deep link: ?debug&mission=m00 enters the level directly with the remembered options, including the
 * on-launch ones (all commandos, dusk lighting, calm wind). README "Debug mode", design-spec §10.7.
 */
export default async function debugDeeplink(page, t) {
  const url = t.harness.url;
  // the harness page (?test=1) is same-origin: seed the remembered options there
  await page.evaluate(() => localStorage.setItem('shadowsix.debug.options', JSON.stringify({ invulnerable: true, allCommandos: true, timeOfDay: 'dusk', weather: 'calm' })));
  await page.goto(`${url}/index.html?debug&mission=m00`);
  await page.waitForFunction(() => window.shadowSix?.state === 'playing' && window.shadowSix.missionDef?.id === 'm00', null, { timeout: 70000 });
  t(await page.evaluate(() => window.shadowSix.world.debug?.invulnerable === true && !document.getElementById('dbg-select')), 'deep link: straight in, options remembered');
  const def = await page.evaluate(() => ({ roles: window.shadowSix.world.commandos.map((c) => c.role), kelvin: window.shadowSix.missionDef.lighting?.kelvin, wind: window.shadowSix.missionDef.weather?.wind?.preset }));
  for (const r of ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy']) t(def.roles.includes(r), `all commandos: ${r} (${def.roles})`);
  t(def.kelvin === 3100 && def.wind === 'calm', `time of day / wind override (${JSON.stringify(def)})`);
  await t.shot('debug-all-commandos-dusk');
  await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
}
