/**
 * Debug SOLUTION replay on a phone (emulated Pixel 7, portrait, taps only): the select's "play the solution" starts
 * it, the replay bar fits the width with finger-sized buttons, 8× / STEPS / STOP work by tap. README "Debug mode".
 */
import { DEVICES } from './touch-flow.mjs';

export const timeout = 180_000;
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

export default async function debugSolutionTouch(_page, t) {
  const ctx = await t.harness.browser.newContext(DEVICES['Pixel 7']);
  const errs = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
    await page.addInitScript(() => { window.__keys = 0; addEventListener('keydown', () => { window.__keys++; }, true); });
    await page.goto(`${t.harness.url}/index.html?debug&preset=low`);
    await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
    await page.goto(`${t.harness.url}/index.html?debug&preset=low`);
    await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-sol'), null, { timeout: 60000 });
    const sb = await page.evaluate(() => document.querySelector('#dbg-select .dbg-sol').getBoundingClientRect().height);
    t(sb >= 44, `the select's solution button is finger-sized (${sb})`);
    await page.locator('#dbg-select .dbg-sol[data-solution="m03"]').tap();
    await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.stage?.id === 'A' && window.shadowSix.state === 'playing', null, { timeout: 120000 });
    const m = await page.evaluate(() => {
      const bar = document.getElementById('dbg-sol-bar').getBoundingClientRect();
      const bs = [...document.querySelectorAll('#dbg-sol-bar button')].map((b) => b.getBoundingClientRect());
      return { vw: innerWidth, sw: document.documentElement.scrollWidth, left: bar.left, right: bar.right, minW: Math.min(...bs.map((b) => b.width)), minH: Math.min(...bs.map((b) => b.height)) };
    });
    t(m.left >= 0 && m.right <= m.vw && m.sw <= m.vw, `the replay bar fits the phone width (${JSON.stringify(m)})`);
    t(m.minW >= 44 && m.minH >= 44, `finger-sized replay buttons (${m.minW}x${m.minH})`);
    await page.locator('#dbg-sol-bar [data-act="speed-8"]').tap();
    t.equal(await page.evaluate(() => window.shadowSix.debug.mode.replay.speed), 8, '8x by tap');
    await page.locator('#dbg-sol-bar [data-act="steps"]').tap();
    const fits = await page.evaluate(() => { const r = document.getElementById('dbg-sol-steps').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    t(fits, 'the steps menu fits the width');
    await page.locator('#dbg-sol-steps [data-stage="B"]').tap();
    await page.waitForFunction(() => window.shadowSix.debug.mode.replay?.stage?.id === 'B', null, { timeout: 90000 });
    await page.screenshot({ path: t.harness.shotPath('debug-solution-touch.png') });
    await page.locator('#dbg-sol-bar [data-act="stop"]').tap();
    await page.waitForFunction(() => !window.shadowSix.debug.mode.replay && !document.getElementById('dbg-sol-bar'), null, { timeout: 5000 });
    t.equal(await page.evaluate(() => window.shadowSix.state), 'playing', 'the player has the mission');
    t.equal(await page.evaluate(() => window.__keys), 0, 'no keyboard event needed');
    t(errs.length === 0, `no page errors:\n  ${errs.slice(0, 5).join('\n  ')}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
