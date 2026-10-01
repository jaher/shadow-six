#!/usr/bin/env node
/**
 * HUD crops of the top-right eye for docs/screenshots/hud-eye-before-after.jpg: the real game at 1920×1080 CSS px,
 * DPR 1 (1080p, uiScale 2) and DPR 2 (4K-class), pointer away from the bar.
 *   node tools/blender/hud/eye/hud-crops.mjs <out_dir> <tag>     (run once on the old assets, once on the new)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness } from '../../../../tests/harness.mjs';

const [out, tag] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const h = await startHarness({ headless: true });
try {
  for (const dpr of [1, 2]) {
    const page = await h.newPage({ width: 1920, height: 1080 }, { deviceScaleFactor: dpr });
    await h.openGame(page);
    await page.evaluate(async () => {
      const g = window.__game;
      await g.loadMission('m00');
      g.start();
      g.render();
      await g.game.hud.iconsReady;
    });
    await page.mouse.move(900, 600);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const a = window.__game.game.hud.topbar.eyeAnim; if (a) { a.blinkAt = 1e12; a.saccadeAt = 1e12; a.gaze = [0, 0]; } window.__game.game.hud.update(0.01); });
    const r = await page.locator('.hud-eye').boundingBox();
    const clip = { x: r.x - 150, y: Math.max(0, r.y - 6), width: r.width + 160, height: r.height + 12 };
    await page.screenshot({ path: join(out, `${tag}-dpr${dpr}.png`), clip });
    console.log('shot', tag, dpr, JSON.stringify(clip));
    await page.close();
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await h.close();
}
