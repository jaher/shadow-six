/**
 * Debug VIDEO MODE on a phone (emulated Pixel 7, portrait then landscape, taps only): the walkthrough opens from the
 * debug select, its bar and caption fit the screen with finger-sized buttons, never overlap the HUD (top bar, the
 * knapsack corner, the MENU button) and leave the acting commando in view: the director frames him in the free part
 * of the screen. ½× / 2× / next step / chapter jump / free camera / captions / ✕ by tap. docs/walkthrough-format.md.
 */
import { DEVICES } from './touch-flow.mjs';

export const timeout = 420_000;
const IGNORED = [/GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i];

export default async function debugWalkthroughTouch(_page, t) {
  for (const landscape of [false, true]) {
    const tag = landscape ? 'landscape' : 'portrait';
    const dev = { ...DEVICES['Pixel 7'] };
    if (landscape) dev.viewport = { width: dev.viewport.height, height: dev.viewport.width };
    const ctx = await t.harness.browser.newContext(dev);
    const errs = [];
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(180000);
      page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message).slice(0, 300)));
      page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errs.push('console.error: ' + m.text().slice(0, 300)); });
      page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
      await page.addInitScript(() => { window.__keys = 0; addEventListener('keydown', () => { window.__keys++; }, true); });
      await page.goto(`${t.harness.url}/index.html?debug&preset=low`);
      await page.evaluate(() => localStorage.removeItem('shadowsix.debug.options'));
      await page.goto(`${t.harness.url}/index.html?debug&preset=low`);
      await page.waitForFunction(() => document.body.dataset.ready === '1' && !!document.querySelector('#dbg-select .dbg-wt'), null, { timeout: 90000 });
      const h = await page.evaluate(() => document.querySelector('#dbg-select .dbg-wt').getBoundingClientRect().height);
      t(h >= 44, `${tag}: the select's walkthrough button is finger-sized (${h})`);
      await page.locator('#dbg-select .dbg-wt[data-walkthrough="m03"]').tap();
      await page.waitForFunction(() => document.querySelector('#wt-card[data-kind=intro]'), null, { timeout: 150000 });
      const cardFits = await page.evaluate(() => { const b = document.querySelector('#wt-card .wt-box').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; });
      t(cardFits, `${tag}: the title card fits the screen`);
      await page.locator('#wt-card [data-act=start]').tap();
      // portrait: the game's own "plays best in landscape" hint is up over the map (the walkthrough's UI stays above it)
      if (await page.evaluate(() => !!document.querySelector('.rot-hint') && !document.querySelector('.rot-hint').hidden)) {
        await page.locator('.rot-hint .rot-ok').tap();
        await page.waitForFunction(() => document.querySelector('.rot-hint').hidden);
      }
      await page.waitForFunction(() => !document.getElementById('wt-card') && document.getElementById('wt-cap')?.dataset.mode === 'step' && window.shadowSix.world.time > 1, null, { timeout: 60000 });
      await page.locator('#wt-bar [data-act=next]').tap(); // A1 done: the Sapper and the Green Beret by the trap
      await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && r.doneCps.includes('A1') && !r.pacer.turbo; }, null, { timeout: 150000 });
      await page.waitForTimeout(3000);
      const m = await page.evaluate(() => {
        const R = (n) => { if (!n) return null; const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return null; const b = n.getBoundingClientRect(); return b.width && b.height ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
        const over = (a, b) => !!a && !!b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        const bar = R(document.getElementById('wt-bar')), cap = R(document.getElementById('wt-cap'));
        const hud = { topbar: R(document.querySelector('.hud-topbar')), pack: R(document.querySelector('.hud-right-bottom .pack')), menu: R(document.querySelector('.touch-menu')), notebook: R(document.querySelector('.hud-right')),
          speaker: R(document.querySelector('.hud-speaker-card')) }; // (the speaker card: while a man talks)
        const bs = [...document.querySelectorAll('#wt-bar button')].map((b) => b.getBoundingClientRect());
        const g = window.shadowSix, r = g.debug.mode.replay, cc = g.cameraController;
        const rect = r.safeRect();
        const men = g.world.commandos.filter((c) => c.alive && (r.step?.who?.length ? r.step.who.includes(c.role) : c === r.focus));
        const pts = men.map((c) => { const s = cc.worldToScreen(c.x, c.y || 0, c.z); return { role: c.role, x: Math.round(s.x), y: Math.round(s.y) }; });
        const covered = pts.filter((p) => [bar, cap].some((u) => u && p.x > u.l && p.x < u.r && p.y > u.t && p.y < u.b));
        const framed = pts.filter((p) => p.x >= rect.x - 4 && p.x <= rect.x + rect.w + 4 && p.y >= rect.y - 4 && p.y <= rect.y + rect.h + 4);
        return {
          vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, bar, cap,
          minW: Math.min(...bs.map((b) => b.width)), minH: Math.min(...bs.map((b) => b.height)),
          overlaps: Object.entries(hud).flatMap(([k, v]) => [over(bar, v) && `bar/${k}`, over(cap, v) && `caption/${k}`]).filter(Boolean).concat(over(bar, cap) ? ['bar/caption'] : []),
          pts, covered, framed: framed.length, rect,
        };
      });
      t.log(tag, JSON.stringify(m));
      t(m.bar.l >= 0 && m.bar.r <= m.vw && m.cap.l >= 0 && m.cap.r <= m.vw && m.cap.b <= m.vh && m.sw <= m.vw, `${tag}: bar and caption fit the screen, no sideways scroll`);
      t(m.minW >= 44 && m.minH >= 44, `${tag}: finger-sized walkthrough buttons (${m.minW}×${m.minH})`);
      t(m.overlaps.length === 0, `${tag}: the walkthrough UI covers none of the HUD (${m.overlaps})`);
      t(m.pts.length > 0 && m.covered.length === 0 && m.framed > 0, `${tag}: the acting men are framed in the free part of the screen, none under the UI (${JSON.stringify(m.pts)})`);
      t(m.rect.h >= (landscape ? 110 : 300), `${tag}: a real free view for the action (${Math.round(m.rect.w)}×${Math.round(m.rect.h)})`);
      await page.screenshot({ path: t.harness.shotPath(`debug-walkthrough-${tag}.png`) });
      // controls by tap
      await page.locator('#wt-bar [data-act="speed-2"]').tap();
      t.equal(await page.evaluate(() => window.shadowSix.debug.mode.replay.speed), 2, `${tag}: 2× by tap`);
      await page.locator('#wt-bar [data-act="speed-0.5"]').tap();
      t.equal(await page.evaluate(() => window.shadowSix.debug.mode.replay.speed), 0.5, `${tag}: ½× by tap`);
      await page.locator('#wt-bar [data-act=play]').tap();
      t(await page.evaluate(() => window.shadowSix.debug.mode.replay.paused), `${tag}: paused by tap`);
      await page.locator('#wt-bar [data-act=chapters]').tap();
      const menu = await page.evaluate(() => { const b = document.getElementById('wt-menu').getBoundingClientRect(); return { fits: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, n: document.querySelectorAll('#wt-menu [data-chapter]').length }; });
      t(menu.fits && menu.n === 10, `${tag}: the chapter list fits the screen (${JSON.stringify(menu)})`);
      await page.screenshot({ path: t.harness.shotPath(`debug-walkthrough-${tag}-chapters.png`) });
      await page.locator('#wt-menu [data-chapter="B"]').tap();
      await page.waitForFunction(() => { const r = window.shadowSix.debug.mode.replay; return r && r.chapterId === 'B' && !r.pacer.turbo; }, null, { timeout: 150000 });
      t(true, `${tag}: chapter B by tap`);
      await page.locator('#wt-bar [data-act=cam]').tap();
      t(await page.evaluate(() => window.shadowSix.debug.mode.replay.free && !window.shadowSix.cameraRig.scripted), `${tag}: free camera by tap`);
      await page.locator('#wt-bar [data-act=cam]').tap();
      await page.locator('#wt-bar [data-act=cc]').tap();
      t(await page.evaluate(() => document.getElementById('wt-cap').hidden), `${tag}: captions off by tap`);
      await page.locator('#wt-bar [data-act=exit]').tap();
      await page.waitForFunction(() => !document.getElementById('wt-bar') && !!document.getElementById('dbg-select'), null, { timeout: 30000 });
      t(true, `${tag}: ✕ back to the debug menu`);
      t.equal(await page.evaluate(() => window.__keys), 0, `${tag}: no keyboard event needed`);
      t(errs.length === 0, `${tag}: no page errors:\n  ${errs.slice(0, 5).join('\n  ')}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
}
