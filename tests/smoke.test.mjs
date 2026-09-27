/**
 * Smoke: boot → title splash → front end → sandbox via the menus (live loop) → then, in test mode, every mission loads,
 * advances 20 s of simulation without errors and is screenshotted to tests/out/.
 */
export default async function smoke(page, t) {
  // 1) Real boot path (no test mode): S01 disclaimer → S03 title splash → any key → S04 NEW USER → MAIN →
  //    NEW GAME → TUTORIALS → TRAINING: SANDBOX → briefing (part 1 → part 2) → playing.
  await page.goto(`${t.harness.url}/index.html`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
  const disc = await page.evaluate(() => document.querySelector('.bt')?.textContent || '');
  await page.waitForFunction(() => window.shadowSix?.hud?.boot?.phase === 'splash' && /PRESS ANY KEY/.test(document.querySelector('.bt-prompt')?.textContent || ''), null, { timeout: 20000 });
  const splash = await page.evaluate(() => ({ tagline: document.querySelector('.bt-tagline')?.textContent, disclaimer: document.querySelector('.bt-disclaimer')?.textContent }));
  t(/fan tribute/i.test(disc) || /fan tribute/i.test(splash.disclaimer), 'fan-tribute disclaimer at boot');
  t(/not affiliated/i.test(splash.disclaimer || ''), 'title splash carries the disclaimer');
  await t.shot('smoke-title');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'confirm-newuser', null, { timeout: 5000 });
  await page.keyboard.press('KeyN'); // (N)O → the COMMANDO profile
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'main', null, { timeout: 5000 });
  const title = await page.evaluate(() => ({
    visible: !document.querySelector('.mk-layer').hidden,
    buttons: [...document.querySelectorAll('.mk-host .mk-list .mk-row')].map((b) => b.textContent),
  }));
  t(title.visible, 'MAIN menu visible');
  t(title.buttons.length === 7, 'MAIN has its 7 rows');
  await page.keyboard.press('Enter'); // NEW GAME
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'newgame', null, { timeout: 5000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // TUTORIALS
  await page.waitForFunction(() => document.querySelector('.mk-host .mk-card')?.dataset.card === 'tutorials', null, { timeout: 5000 });
  await page.locator('.mk-row[data-id="sandbox"]').click();
  await page.waitForFunction(() => window.shadowSix?.state === 'briefing', null, { timeout: 20000 });
  await page.locator('.ui-briefing .skip').click();
  await page.locator('.ui-briefing .tourhint.start').click();
  await page.waitForFunction(() => window.shadowSix?.state === 'playing', null, { timeout: 5000 });
  const veil = await page.evaluate(() => [...document.querySelectorAll('#hud *, #app > *')]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8 && e.id !== 'view' && e.tagName !== 'CANVAS' && getComputedStyle(e).display !== 'none' && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'; })
    .map((e) => e.className || e.id));
  t.equal(veil.length, 0, `no full-screen overlay covers the view while playing (${veil})`);
  const t0 = await page.evaluate(() => window.shadowSix.world.time);
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(() => window.shadowSix.world.time);
  t(t1 > t0 + 0.5, `live loop advances sim time (${t0.toFixed(2)} → ${t1.toFixed(2)})`);

  // 2) Deterministic test mode: every mission loads and runs 20 s.
  await t.harness.openGame(page);
  const ids = await page.evaluate(async () => (await import('./src/missions/index.js')).MISSIONS.map((m) => m.id));
  t(ids.includes('m00'), 'sandbox mission registered');
  const aspect = await page.evaluate(() => {
    const c = window.__game.game.cameraController.camera;
    return { cam: (c.right - c.left) / (c.top - c.bottom), view: innerWidth / innerHeight };
  });
  t.near(aspect.cam, aspect.view, 0.01, 'camera frustum aspect matches the canvas (no stretching)');
  for (const id of ids) {
    const s = await page.evaluate(async (mid) => {
      const g = window.__game;
      const s0 = await g.loadMission(mid);
      g.start();
      g.advance(20);
      g.render();
      return { s0, s1: g.state() };
    }, id);
    t(s.s0.commandos.length > 0, `${id}: has commandos`);
    t(s.s1.time >= 19.9, `${id}: advanced 20 s (t=${s.s1.time})`);
    t(['playing', 'won', 'lost'].includes(s.s1.state), `${id}: state ${s.s1.state}`);
    await t.shot(`smoke-${id}`);
    t.log(`${id}: ${s.s1.commandos.length} commandos, ${s.s1.enemies.length} enemies, alarm=${s.s1.alarm}`);
  }
}
