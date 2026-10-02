/**
 * Debug mode on a phone (emulated Pixel 7, portrait, taps only): the level select fits the width, its targets are
 * finger-sized, a tap launches a level, the DEBUG button reopens the select and RESUME closes it.
 * README "Debug mode", design-spec §10.7.
 */
import { DEVICES } from './touch-flow.mjs';

const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

export default async function debugTouch(_page, t) {
  const ctx = await t.harness.browser.newContext(DEVICES['Pixel 7']);
  const errs = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
    await page.addInitScript(() => { window.__keys = 0; addEventListener('keydown', () => { window.__keys++; }, true); });
    await page.goto(`${t.harness.url}/index.html?debug&preset=low`); // low preset: a phone-sized canvas at 2.6x DPR loads slowly
    await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-tile'), null, { timeout: 60000 });
    const m = await page.evaluate(() => {
      const r = (s) => [...document.querySelectorAll(s)].map((n) => n.getBoundingClientRect());
      return {
        sw: document.documentElement.scrollWidth, vw: innerWidth,
        tileH: Math.min(...r('#dbg-select .dbg-tile').map((b) => b.height)), tileW: Math.min(...r('#dbg-select .dbg-tile').map((b) => b.width)),
        optH: Math.min(...r('#dbg-select .dbg-opt').map((b) => b.height)), right: Math.max(...r('#dbg-select .dbg-tile').map((b) => b.right)),
      };
    });
    t(m.sw <= m.vw && m.right <= m.vw, `fits the phone width (${JSON.stringify(m)})`);
    t(m.tileH >= 44 && m.tileW >= 44 && m.optH >= 40, `finger-sized targets (${JSON.stringify(m)})`);
    await page.screenshot({ path: t.harness.shotPath('debug-touch-select.png') });
    await page.locator('#dbg-select .dbg-tile[data-mission="m00"]').tap();
    await page.waitForFunction(() => window.shadowSix.state === 'playing' && !window.shadowSix.debug.mode._launching && window.shadowSix.missionDef?.id === 'm00', null, { timeout: 70000 });
    await page.locator('#dbg-btn').tap();
    await page.waitForSelector('#dbg-select .dbg-tile.current[data-mission="m00"]');
    await page.locator('#dbg-select .dbg-act', { hasText: 'Resume' }).tap();
    await page.waitForFunction(() => !document.getElementById('dbg-select') && window.shadowSix.state === 'playing');
    t.equal(await page.evaluate(() => window.__keys), 0, 'no keyboard event needed');
    t(errs.length === 0, `no page errors:\n  ${errs.slice(0, 5).join('\n  ')}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
