/**
 * The living HUD eye at 1080p (uiScale 2, DPR 1 → the @2x sheet) and on a 4K-class screen (DPR 2 → @4x): the sheet
 * overlays the porthole window exactly, blinks, dilates under the pointer, looks towards the cursor while armed,
 * keeps the hotkey / click / hit area, and goes static (the plain renders) under reduced motion or a failed sheet.
 * EYE_SHOTS=1 also writes tests/out/eye-*.png crops (docs/screenshots/hud-eye-before-after.jpg is built from them).
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';

const frameOf = (page) => page.evaluate(() => document.querySelector('.hud-eye > .eye-anim')?.dataset.frame || '');

async function boot(h, size, dpr = 1, block = false) {
  const page = await h.newPage(size, { deviceScaleFactor: dpr });
  if (block) await page.route('**/eye.anim@*', (r) => r.abort());
  await h.openGame(page);
  await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    g.start();
    g.render();
    await g.game.hud.iconsReady;
  });
  return page;
}

export const timeout = 240_000;

export default async function uiEye(page0, t) {
  const h = t.harness;
  const page = await boot(h, { width: 1920, height: 1080 });
  try {
    await page.waitForFunction(() => document.querySelector('.hud-eye')?.classList.contains('eye-live'), null, { timeout: 8000 });
    const geo = await page.evaluate(() => {
      const b = document.querySelector('.hud-eye'), o = b.querySelector('.eye-anim');
      const rb = b.getBoundingClientRect(), ro = o.getBoundingClientRect();
      return { b: [rb.x, rb.y, rb.width, rb.height], o: [ro.x, ro.y, ro.width, ro.height], bg: getComputedStyle(o).backgroundImage, vis: getComputedStyle(o).visibility };
    });
    t(geo.bg.includes('eye.anim@2x.webp'), `1080p uses the @2x sheet (${geo.bg})`);
    t.equal(geo.vis, 'visible', 'overlay visible');
    t.equal(Math.round(geo.b[2]), 104, 'button keeps its 52×41 ref box (104 px at uiScale 2)');
    t(geo.o[0] >= geo.b[0] - 0.5 && geo.o[1] >= geo.b[1] - 0.5 && geo.o[0] + geo.o[2] <= geo.b[0] + geo.b[2] + 0.5 && geo.o[1] + geo.o[3] <= geo.b[1] + geo.b[3] + 0.5, 'overlay inside the porthole');
    // a blink, forced now and stepped at 10 ms (headless frame pacing is irregular): half / shut / back in ~210 ms
    const seen = await page.evaluate(() => {
      const a = window.__game.game.hud.topbar.eyeAnim, out = [];
      const t0 = performance.now() + 1000;
      a.blinkAt = t0;
      for (let k = 0; k <= 30; k++) { a.tick(t0 + k * 10); out.push(document.querySelector('.hud-eye > .eye-anim').dataset.frame); }
      return out;
    });
    const lid = seen.filter((n) => n.startsWith('b'));
    t(seen.includes('blink3') && seen[0].startsWith('b1g') && seen.some((n) => n.startsWith('b2g')), `blink frames shown (${[...new Set(seen)].join(' ')})`);
    t(lid.length * 10 >= 150 && lid.length * 10 <= 250, 'blink lasts 150-250 ms');
    // hover: the pupil dilates after a latency, easing in (the dilated cell crossfades over the normal one)
    const eye = await page.locator('.hud-eye').boundingBox();
    await page.mouse.move(eye.x + eye.width / 2, eye.y + eye.height / 2);
    const ops = [];
    for (let k = 0; k < 16; k++) {
      await page.waitForTimeout(80);
      ops.push(await page.evaluate(() => { window.__game.game.hud.update(0.01); return +document.querySelector('.hud-eye > .eye-anim.dil').style.opacity; }));
    }
    t(ops[ops.length - 1] === 1 && ops.some((o) => o > 0 && o < 1), `pupil eases open (${ops.join(' ')})`);
    t((await frameOf(page)).endsWith('d'), `hover dilates the pupil (${await frameOf(page)})`);
    t.equal(await page.evaluate(() => document.querySelector('.hud-eye').dataset.state), 'hover', 'hover state');
    // click arms the eye tool (behaviour unchanged); the armed eye looks towards the cursor (lower-left of it)
    await page.mouse.click(eye.x + eye.width / 2, eye.y + eye.height / 2);
    t.equal(await page.evaluate(() => window.__game.game.hud.cursor.mode), 'eye', 'click arms the vision tool');
    await page.mouse.move(400, 900);
    await page.evaluate(() => { const a = window.__game.game.hud.topbar.eyeAnim; a.blinkAt = 1e12; window.__game.game.hud.update(0.01); });
    const f = await frameOf(page);
    const fr = await page.evaluate(async (n) => (await import('./src/ui/eye-anim-data.js')).EYE_ANIM.frames.find((x) => x.name === n), f);
    t(fr && fr.gx < 0 && fr.gy < 0, `armed: looks down-left at the cursor (${f})`);
    t.equal(await page.evaluate(() => document.querySelector('.hud-eye').dataset.state), 'active', 'active render underneath');
    if (process.env.EYE_SHOTS === '1') {
      await page.evaluate(() => { const a = window.__game.game.hud.topbar.eyeAnim; a.pointer = null; a.gaze = [0, 0]; window.__game.game.hud.cursor.setMode(null); window.__game.game.hud.update(0.01); });
      await page.mouse.move(900, 600);
      await page.evaluate(() => window.__game.game.hud.update(0.01));
      const r = await page.locator('.hud-icons').boundingBox();
      await page.screenshot({ path: join(TESTS_DIR, 'out', 'eye-1080p.png'), clip: { x: r.x + r.width - 330, y: 0, width: 330, height: r.y + r.height + 8 } });
    }
    // reduced motion: static renders only
    await page.evaluate(() => { const hud = window.__game.game.hud; hud.kit.reducedMotion = true; hud.update(0.01); });
    t(await page.evaluate(() => !document.querySelector('.hud-eye').classList.contains('eye-live')), 'reduced motion → static eye');
    t.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.hud-eye > .eye-anim')).visibility), 'hidden', 'overlay hidden');
    t.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.hud-eye > .ico.lid')).animationName), 'none', 'no CSS blink either');
    await page.evaluate(() => { const hud = window.__game.game.hud; hud.kit.reducedMotion = false; hud.update(0.01); });
  } finally {
    await page.close();
  }
  // failed sheet: the static renders stay (no error, no overlay)
  const p2 = await boot(h, { width: 1920, height: 1080 }, 1, true);
  try {
    await p2.waitForTimeout(500);
    const s = await p2.evaluate(() => { window.__game.game.hud.update(0.01); const b = document.querySelector('.hud-eye'); return { live: b.classList.contains('eye-live'), base: !b.querySelector('.ico[data-v="base"]').hidden }; });
    t(!s.live && s.base, 'sheet blocked → static open-eye render');
  } finally {
    await p2.close();
  }
  // 4K-class: 1920×1080 CSS at DPR 2 → uiScale 2 × 2 → the @4x sheet
  const p3 = await boot(h, { width: 1920, height: 1080 }, 2);
  try {
    await p3.waitForFunction(() => document.querySelector('.hud-eye')?.classList.contains('eye-live'), null, { timeout: 8000 });
    const bg = await p3.evaluate(() => getComputedStyle(document.querySelector('.hud-eye > .eye-anim')).backgroundImage);
    t(bg.includes('eye.anim@4x.webp'), `DPR 2 → @4x sheet (${bg})`);
    if (process.env.EYE_SHOTS === '1') {
      await p3.mouse.move(900, 600);
      const r = await p3.locator('.hud-icons').boundingBox();
      await p3.screenshot({ path: join(TESTS_DIR, 'out', 'eye-4k.png'), clip: { x: r.x + r.width - 330, y: 0, width: 330, height: r.y + r.height + 8 } });
    }
  } finally {
    await p3.close();
  }
}
