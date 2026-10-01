/**
 * Desktop with a mouse (no touch): the title splash says PRESS ANY KEY OR CLICK and a mouse click continues; the
 * dialogs keep their keyboard labels; no touch-only chrome (rotate hint, MENU button, touch bar) appears.
 */
export default async function touchDesktop(page, t) {
  const ctx = await t.harness.browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${t.harness.url}/index.html`);
    await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    t(await p.evaluate(() => !document.documentElement.classList.contains('mk-touch') && window.shadowSix.hud.kit.device !== 'touch'), 'desktop: not in touch mode');
    // the disclaimer / ident skip with a click too
    await p.waitForTimeout(1600);
    for (let i = 0; i < 6 && !(await p.evaluate(() => window.shadowSix?.hud?.boot?.phase === 'splash')); i++) {
      await p.mouse.click(640, 360);
      await p.waitForTimeout(350);
    }
    await p.waitForFunction(() => window.shadowSix?.hud?.boot?.phase === 'splash' && /PRESS ANY KEY OR CLICK/.test(document.querySelector('.bt-prompt')?.textContent || ''), null, { timeout: 30000 });
    await p.mouse.click(640, 300);
    await p.waitForFunction(() => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card === 'confirm-newuser', null, { timeout: 5000 });
    await p.locator('.mk-host .mk-card:not(.leaving) .mk-footer .mk-row').first().click(); // (Y)ES
    await p.waitForFunction(() => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card === 'name', null, { timeout: 5000 });
    const labels = await p.evaluate(() => [...document.querySelectorAll('.mk-host .mk-card:not(.leaving) .mk-footer .mk-row')].map((b) => b.textContent));
    t.equal(labels.join('|'), '(ENTER) CONFIRM|(ESC) BACK', 'desktop keeps the keyboard labels');
    // typing replaces the default name, Enter confirms (the keyboard flow is unchanged)
    await p.keyboard.type('ACE');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card === 'main', null, { timeout: 5000 });
    t.equal(await p.evaluate(() => window.shadowSix.hud.profiles.current), 'ACE', 'typed name replaces the default');
    const chrome = await p.evaluate(() => ({ rot: !document.querySelector('.rot-hint')?.hidden, menu: !document.querySelector('.touch-menu')?.hidden, bar: !!document.querySelector('.mk-hints.touch') }));
    t(!chrome.rot && !chrome.menu && !chrome.bar, `desktop: no touch chrome (${JSON.stringify(chrome)})`);
    t(errs.length === 0, `desktop: no page errors ${errs.join('; ')}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
