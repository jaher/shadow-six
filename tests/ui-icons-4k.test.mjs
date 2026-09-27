/**
 * Rendered HUD icons at 4K: a 3840×2160 window (uiScale 3, DPR 1 → the @3x files) and a 1920×1080 window at
 * DPR 2 (uiScale 2 → the @4x files). Every visible icon is a loaded image at its CSS box; full-HUD screenshots go
 * to tests/out/ui-icons-4k*.jpg, and with ICON_SHOTS=1 downscaled close-ups to docs/screenshots/icons-4k-*.jpg.
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';
import { kitUp, probeIcons, clipOf, shotJpg, checkProbe } from './ui-icons-lib.mjs';

const CASES = [
  { name: '4k', vp: { width: 3840, height: 2160 }, dpr: 1, scale: 3, tier: '3x' },
  { name: '4k-hidpi', vp: { width: 1920, height: 1080 }, dpr: 2, scale: 2, tier: '4x' },
];

export default async function uiIcons4k(page0, t) {
  const h = t.harness;
  for (const c of CASES) {
    const page = await h.newPage(c.vp, { deviceScaleFactor: c.dpr });
    try {
      await h.openGame(page);
      await page.evaluate(async () => {
        const g = window.__game;
        await g.loadMission('m00');
        g.start();
        g.render();
        await g.game.hud.iconsReady;
      });
      t.equal(await page.evaluate(() => window.__game.game.hud.scale), c.scale, `${c.name}: uiScale ${c.scale}`);
      for (const [role, inv] of [['sapper', { pistol: 1, bearTrap: 1, timeBomb: 3, grenade: 4, wireCutters: 1 }], ['sniper', { sniperRifle: 8, pistol: 1, firstAid: 6 }]]) {
        await kitUp(page, role, inv);
        checkProbe(t, await probeIcons(page), c.tier, `${c.name} ${role}`);
      }
      // the DPR-2 page must actually draw more pixels than 1080p: naturalWidth ≥ 2 × CSS width for items
      // (naturalWidth of a srcset image is already divided by its x-descriptor, so reload the chosen file bare)
      const dens = await page.evaluate(() => Promise.all([...document.querySelectorAll('.hud-knapsack .item img.ico')].map(async (i) => {
        const im = new Image();
        im.src = i.currentSrc;
        await im.decode();
        return im.naturalWidth / i.getBoundingClientRect().width;
      })));
      t(dens.length && dens.every((d) => d >= c.dpr - 0.05), `${c.name}: item bitmaps ≥ ${c.dpr}× their CSS size (${dens.map((d) => d.toFixed(2)).join(', ')})`);
      await page.mouse.move(c.vp.width * 0.4, c.vp.height * 0.6);
      await page.screenshot({ path: join(TESTS_DIR, 'out', `ui-icons-${c.name}.jpg`), type: 'jpeg', quality: 80, scale: 'css' });
      await shotJpg(page, t, `icons-${c.name}-topright`, await clipOf(page, '.hud-icons', 6, { bottom: 40, left: 12 }), 'device');
      await shotJpg(page, t, `icons-${c.name}-knapsack`, await clipOf(page, '.hud-right-bottom', 10, { left: 10 }), 'device');
    } finally {
      const errs = h.errors(page);
      await page.close();
      t(!errs.length, `${c.name} page clean (${errs.slice(0, 3).join(' | ')})`);
    }
  }
}
