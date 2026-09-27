#!/usr/bin/env node
/**
 * Front-end screenshots (real boot, not test mode, so the B1 live diorama runs):
 *   node tools/perf/menushot.mjs --out=dir [--what=menu,briefing] [--missions=m01,m02,m03] [--size=1280x720]
 * menu: skips the boot/splash, opens MAIN and waits for the live diorama (html.bd-live) → menu.png (+ menu-still.png
 * before the diorama arrives). briefing: hud.startMission(id) → loading → briefing part 1 → briefing-<id>-<slide>.png.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const out = arg('out', '.'), what = arg('what', 'menu,briefing').split(','), [W, H] = arg('size', '1280x720').split('x').map(Number);
mkdirSync(out, { recursive: true });
const h = await startHarness({});
const page = await h.newPage({ width: W, height: H });
await page.goto(`${h.url}/index.html?preset=${arg('preset', 'high')}`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 90000 });
// a profile (skips S04 NEW USER), then through the boot the normal way: wait for the splash, press a key
await page.evaluate(() => { const p = window.shadowSix.hud.profiles; if (!p.current) { p.create('TESTER'); p.firstRunDone = true; p.save(); } });
await page.waitForFunction(() => { const b = window.shadowSix.hud.boot; return !b || (b.phase === 'splash' && b.ready); }, null, { timeout: 90000 });
await page.waitForTimeout(600);
await page.evaluate(() => { const b = window.shadowSix.hud.boot; if (b?.phase === 'splash') b._go(); });
await page.waitForFunction(() => !!document.querySelector('.mk-host .mk-card'), null, { timeout: 20000 });
if (what.includes('menu')) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, 'menu-still.png') });
  const live = await page.waitForFunction(() => document.documentElement.classList.contains('bd-live'), null, { timeout: 45000 }).then(() => true, () => false);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, 'menu.png') });
  console.log('menu live diorama:', live);
}
if (what.includes('briefing')) {
  for (const m of arg('missions', 'm01,m02,m03').split(',')) {
    await page.evaluate((id) => { window.shadowSix.hud.kit.close?.(); void window.shadowSix.hud.startMission(id); }, m);
    await page.waitForFunction(() => window.shadowSix.state === 'briefing' && document.querySelector('.ui-briefing .slide.on img'), null, { timeout: 90000 });
    for (let s = 0; s < 2; s++) {
      await page.waitForTimeout(1600);
      await page.screenshot({ path: join(out, `briefing-${m}-${s}.png`) });
      await page.keyboard.press('ArrowRight');
    }
  }
}
const errs = h.errors(page);
if (errs.length) console.log(errs.slice(0, 5).join('\n'));
await h.close();
console.log('done');
