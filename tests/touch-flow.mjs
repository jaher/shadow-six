/**
 * Shared phone flow for the touch tests (touch-pixel7 / touch-iphone14): a fresh emulated phone (touch only, no
 * keyboard events) goes disclaimer → title splash → NEW USER (YES) → the service book (default name, CONFIRM) →
 * MAIN → NEW GAME → SINGLE PLAYER → START CAMPAIGN → loading (NEXT TIP) → briefing (NEXT, CONTINUE) → the Colonel's
 * tour (NEXT, START MISSION) → playing → the touch MENU button opens the in-mission menu → BACK resumes. Every
 * step is a real tap (page.touchscreen.tap) on the centre of a visible element.
 */

/** Playwright device descriptors (as in playwright-core's devices list), inlined so the harness needs no import. */
export const DEVICES = {
  'Pixel 7': {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  },
  'iPhone 14': {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  },
};

const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

/**
 * @param {object} t the test's assert helper (t.harness = the harness)
 * @param {string} name key of DEVICES
 * @param {{landscape?: boolean}} [o]
 */
export async function phoneFlow(t, name, o = {}) {
  const dev = { ...DEVICES[name] };
  if (o.landscape) dev.viewport = { width: dev.viewport.height, height: dev.viewport.width };
  const ctx = await t.harness.browser.newContext(dev);
  const errs = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 400)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 400)); });
    page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    // count keyboard events: the phone flow must never need one
    await page.addInitScript(() => {
      window.__keys = 0;
      addEventListener('keydown', () => { window.__keys++; }, true);
    });
    const tag = `${name.replace(/\s+/g, '').toLowerCase()}${o.landscape ? '-land' : ''}`;
    const vp = dev.viewport;
    const shot = (n) => page.screenshot({ path: t.harness.shotPath(`${n}.png`) });
    const wait = (fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms });
    /** Tap the centre of the first visible element matching `sel` (its box must be inside the viewport). */
    const tap = async (sel, min = 0) => {
      const box = await page.evaluate((s) => {
        const e = [...document.querySelectorAll(s)].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !x.closest('[hidden], .leaving'); });
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
      }, sel);
      t(box, `${tag}: "${sel}" is on screen`);
      t(box.x >= 0 && box.x <= vp.width && box.y >= 0 && box.y <= vp.height, `${tag}: "${sel}" inside the viewport (${Math.round(box.x)},${Math.round(box.y)})`);
      if (min) t(box.h >= min - 0.5 && box.w >= min - 0.5, `${tag}: "${sel}" is a ≥ ${min} px target (${box.w.toFixed(0)}×${box.h.toFixed(0)})`);
      await page.touchscreen.tap(box.x, box.y);
    };
    const card = () => page.evaluate(() => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card || null);
    const waitCard = (id, ms) => wait((c) => document.querySelector('.mk-host .mk-card:not(.leaving)')?.dataset.card === c, id, ms);
    const row = (label) => `.mk-host .mk-card:not(.leaving) .mk-row[data-id="${label}"]`;

    await page.goto(`${t.harness.url}/index.html`);
    await wait(() => document.body.dataset.ready === '1', null, 30000);
    // viewport: no page zoom, safe areas, touch mode
    const meta = await page.evaluate(() => ({
      vp: document.querySelector('meta[name=viewport]')?.content || '',
      touch: document.documentElement.classList.contains('mk-touch'),
      device: window.shadowSix?.hud?.kit?.device,
    }));
    t(/user-scalable=no/.test(meta.vp) && /viewport-fit=cover/.test(meta.vp), `${tag}: viewport meta blocks page zoom and covers the notch (${meta.vp})`);
    t(meta.touch && meta.device === 'touch', `${tag}: touch mode on a phone (${meta.touch}, ${meta.device})`);
    // portrait phones: the landscape hint is up; it is dismissible with a tap and the game stays usable
    const rot = await page.evaluate(() => !document.querySelector('.rot-hint')?.hidden);
    t.equal(rot, !o.landscape, `${tag}: rotate-to-landscape hint only in portrait`);
    if (rot) {
      await tap('.rot-hint .rot-ok', 44);
      await wait(() => document.querySelector('.rot-hint').hidden);
    }
    // S01 disclaimer / ident: a tap skips (after the 1.5 s first-run lock)
    await page.waitForTimeout(1600);
    for (let i = 0; i < 6 && !(await page.evaluate(() => window.shadowSix?.hud?.boot?.phase === 'splash')); i++) {
      await page.touchscreen.tap(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(350);
    }
    await wait(() => window.shadowSix?.hud?.boot?.phase === 'splash' && /TAP TO CONTINUE/.test(document.querySelector('.bt-prompt')?.textContent || ''), null, 30000);
    await shot(`${tag}-1-title`);
    await page.touchscreen.tap(vp.width / 2, vp.height * 0.4); // anywhere on the title
    await waitCard('confirm-newuser');
    // S04: (Y)ES (N)O are real ≥ 44 px buttons
    await page.waitForTimeout(400);
    await shot(`${tag}-2-newuser`);
    await tap('.mk-host .mk-card:not(.leaving) .mk-footer .mk-row:first-child', 44);
    await waitCard('name');
    const typed = await page.evaluate(() => document.querySelector('.mk-servicebook .mk-typed .txt')?.textContent || '');
    t.equal(typed, 'COMMANDO',`${tag}: the service book comes with a default name`);
    const inp = await page.evaluate(() => {
      const i = document.querySelector('.mk-servicebook input.mk-typein');
      return i && { focused: document.activeElement === i, h: i.getBoundingClientRect().height };
    });
    t(inp && !inp.focused && inp.h >= 20, `${tag}: a native name input exists, unfocused until tapped (no keyboard pops up by itself)`);
    await page.waitForTimeout(400);
    await shot(`${tag}-3-name`);
    await tap(`${row('confirm')}`, 44);
    await waitCard('main', 8000);
    const prof = await page.evaluate(() => window.shadowSix.hud.profiles.current);
    t.equal(prof, 'COMMANDO', `${tag}: CONFIRM without typing enlists COMMANDO`);
    // MAIN → NEW GAME → SINGLE PLAYER → START CAMPAIGN: one tap each (no hover, no focus-then-select)
    await page.waitForTimeout(300);
    await shot(`${tag}-4-main`);
    await tap('.mk-host .mk-card:not(.leaving) .mk-list .mk-row:first-child');
    await waitCard('newgame');
    t(await page.evaluate(() => !!document.querySelector('.mk-host .mk-card:not(.leaving) .mk-touchbtn.back')), `${tag}: a visible BACK button on sub-menus`);
    await page.waitForTimeout(300);
    await tap('.mk-host .mk-card:not(.leaving) .mk-list .mk-row:first-child');
    await waitCard('bel');
    await page.waitForTimeout(300);
    await tap('.mk-host .mk-card:not(.leaving) .mk-list .mk-row:first-child');
    await waitCard('loading', 8000);
    await page.waitForTimeout(900); // the card's entrance animation settles before the tap
    const tip0 = await page.evaluate(() => document.querySelector('.mk-tiphost')?.textContent || '');
    if (await page.evaluate(() => window.shadowSix.hud.kit.top?.spec.id === 'loading' && !!document.querySelector('.mk-nexttip'))) {
      await tap('.mk-nexttip', 44);
      await page.waitForTimeout(500);
      const tip1 = await page.evaluate(() => ({ text: document.querySelector('.mk-tiphost')?.textContent || '', on: window.shadowSix.hud.loading.active && window.shadowSix.hud.kit.top?.spec.id === 'loading' }));
      // (a fast load may finish under the finger; the tip pool may repeat a tip only when it is exhausted)
      t(tip1.text !== tip0 || !tip0 || !tip1.on, `${tag}: NEXT TIP changes the tip (${tip0} → ${tip1.text})`);
    }
    await shot(`${tag}-5-loading`);
    await wait(() => window.shadowSix?.state === 'briefing' && !!document.querySelector('.ui-briefing.part1 .br-hints.touch'), null, 60000);
    await page.waitForTimeout(600);
    await shot(`${tag}-6-briefing`);
    const slide0 = await page.evaluate(() => window.shadowSix.hud.briefing.slide);
    await tap('.ui-briefing .br-hints .mk-touchbtn:nth-child(2)', 44); // NEXT ›
    await page.waitForTimeout(200);
    const slide1 = await page.evaluate(() => window.shadowSix.hud.briefing.slide);
    t(slide1 !== slide0, `${tag}: NEXT › turns the slide (${slide0} → ${slide1})`);
    await tap('.ui-briefing .br-hints .mk-touchbtn:first-child', 44); // ‹ PREV
    await page.waitForTimeout(200);
    t.equal(await page.evaluate(() => window.shadowSix.hud.briefing.slide), slide0, `${tag}: ‹ PREV goes back`);
    await tap('.ui-briefing .br-hints .mk-touchbtn.go', 44); // CONTINUE → the tour
    await wait(() => window.shadowSix.hud.briefing.part === 2);
    await page.waitForTimeout(700);
    await shot(`${tag}-7-tour`);
    const stop0 = await page.evaluate(() => window.shadowSix.hud.briefing.stopIx);
    await tap('.ui-briefing .tourhint:nth-child(2)', 44); // NEXT ›
    await page.waitForTimeout(200);
    t(await page.evaluate((s) => window.shadowSix.hud.briefing.stopIx !== s, stop0), `${tag}: the tour's NEXT › moves on`);
    await tap('.ui-briefing .tourhint.start', 44);
    await wait(() => window.shadowSix?.state === 'playing', null, 8000);
    // in the mission: the MENU button is the Esc of a phone; BACK resumes
    await wait(() => !document.querySelector('.touch-menu')?.hidden, null, 5000);
    await page.waitForTimeout(500);
    await shot(`${tag}-8-playing`);
    await tap('.touch-menu', 44);
    await waitCard('main', 5000);
    t(await page.evaluate(() => window.shadowSix.state !== 'playing'), `${tag}: the in-mission menu pauses the game`);
    await page.waitForTimeout(300);
    await shot(`${tag}-9-escmenu`);
    await tap('.mk-host .mk-card:not(.leaving) .mk-touchbtn.back', 44);
    await wait(() => window.shadowSix?.state === 'playing' && !window.shadowSix.hud.kit.active, null, 5000);
    t.equal(await card(), null, `${tag}: back in the mission`);
    if (o.endScreens) {
      // S19 win card → S20 debrief → (P)LAY AGAIN, by taps
      await page.evaluate(() => window.shadowSix._endMission(true, 'objectives complete'));
      await wait(() => /TAP TO CONTINUE/.test(document.querySelector('.ui-end.won .press')?.textContent || ''), null, 5000);
      await page.waitForTimeout(1400); // the card arms after 1.2 s
      await page.touchscreen.tap(vp.width / 2, vp.height / 2);
      await wait(() => window.shadowSix.hud.debrief.stage === 'debrief', null, 5000);
      await page.touchscreen.tap(vp.width / 2, vp.height * 0.3); // completes the roll-up
      await page.waitForTimeout(400);
      await shot(`${tag}-10-debrief`);
      await tap('.ui-end .mk-footer .mk-row:last-child', 44); // (P)LAY AGAIN
      await wait(() => window.shadowSix.state === 'briefing' || window.shadowSix.hud.loading.active, null, 10000);
    }
    t.equal(await page.evaluate(() => window.__keys), 0, `${tag}: no keyboard event was needed`);
    t(errs.length === 0, `${tag}: no page errors:\n  ${errs.slice(0, 6).join('\n  ')}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
