/**
 * Rendered HUD icons at 1080p (uiScale 2, DPR 1 → the @2x files): every commando's knapsack, the top-right tools
 * and their states (hover / pressed / active / disabled), count badges, cursors, the WebP → PNG → SVG fallback,
 * and no layout shift while the images arrive (icon requests are delayed on purpose).
 * ICON_SHOTS=1 writes docs/screenshots/icons-*.jpg (else tests/out/).
 */
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';
import { KITS, kitUp, probeIcons, hostRects, clipOf, shotJpg, checkProbe } from './ui-icons-lib.mjs';

export default async function uiIcons(page0, t) {
  const h = t.harness;
  const page = await h.newPage({ width: 1920, height: 1080 });
  // slow icon delivery: layout must not wait for (or move with) the images
  await page.route('**/assets/ui/icons/**', async (route) => {
    await new Promise((r) => setTimeout(r, 150));
    await route.continue();
  });
  try {
    await h.openGame(page);
    await page.evaluate(async () => {
      const g = window.__game;
      await g.loadMission('m00');
      g.start();
      g.render();
    });
    const scale = await page.evaluate(() => window.__game.game.hud.scale);
    t.equal(scale, 2, '1080p → uiScale 2');
    // layout shift: host boxes right after the knapsack renders (images still in flight) vs after decode
    const before = await page.evaluate(() => {
      const g = window.__game, w = g.game.world;
      g.select([w.commandos[0].id]);
      g.game.hud.update(0.01);
      return [...document.querySelectorAll('.hud-icon, .hud-hand, .hud-knapsack .item')].map((e) => {
        const r = e.getBoundingClientRect();
        return [e.className, Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10].join(' ');
      });
    });
    await page.evaluate(() => window.__game.game.hud.iconsReady);
    await page.waitForTimeout(400);
    t.equal(JSON.stringify(await hostRects(page)), JSON.stringify(before), 'no layout shift when the icons arrive');

    for (const [role, inv] of KITS) {
      const arts = await kitUp(page, role, inv);
      t.equal(arts.filter(Boolean).length, Object.keys(inv).length, `${role}: every item drawn from a render (${arts.join(', ')})`);
      const probe = await probeIcons(page);
      checkProbe(t, probe, '2x', `1080p ${role}`);
      const counts = await page.evaluate(() => [...document.querySelectorAll('.hud-knapsack .count')].map((c) => {
        const r = c.getBoundingClientRect(), p = document.querySelector('.hud-knapsack').getBoundingClientRect();
        return { cls: c.className, n: c.children.length, txt: c.textContent, inside: r.left >= p.left - 2 && r.right <= p.right + 2 && r.bottom <= p.bottom + 2, h: r.height };
      }));
      for (const c of counts) t(c.inside && c.h >= 8, `${role}: count badge ${c.cls} (${c.txt || c.n}) readable on the pack`);
      if (role === 'sniper') t(counts.some((c) => c.cls.includes('cartridges') && c.n === 5), 'sniper: 5 rendered cartridges');
      if (role === 'sapper') t(counts.some((c) => c.cls.includes('icons') && c.n === 4), 'sapper: 4 grenade glyphs');
      if (role === 'spy') t(arts.includes('item/pistol.p38'), 'spy carries the P38 render');
      const clip = await clipOf(page, '.hud-right-bottom', 10, { left: 10 });
      await shotJpg(page, t, `icons-knapsack-${role}`, clip);
    }

    await page.screenshot({ path: join(TESTS_DIR, 'out', 'ui-icons-1080p.jpg'), type: 'jpeg', quality: 80 });
    // top-right tools: base, then hover / pressed / active / disabled
    const st = async (sel) => page.evaluate((s) => {
      const b = document.querySelector(s);
      const v = [...b.querySelectorAll(':scope > .ico[data-v]')].filter((i) => !i.hidden).map((i) => i.dataset.v);
      return { state: b.dataset.state, shown: v.join(',') };
    }, sel);
    await page.mouse.move(900, 600);
    t.equal(JSON.stringify(await st('.hud-camera')), JSON.stringify({ state: 'base', shown: 'base' }), 'camera: base render');
    const cam = await page.locator('.hud-camera').boundingBox();
    await page.mouse.move(cam.x + cam.width / 2, cam.y + cam.height / 3);
    t.equal((await st('.hud-camera')).shown, 'hover', 'camera: hover render');
    await page.mouse.down();
    t.equal((await st('.hud-camera')).shown, 'pressed', 'camera: pressed render');
    await page.mouse.up();
    await page.mouse.move(900, 600);
    await page.evaluate(() => { const hud = window.__game.game.hud; hud.cursor.setMode('eye'); hud.update(0.01); });
    t.equal((await st('.hud-eye')).shown, 'active', 'eye: active render while the eye tool is armed');
    t.equal((await st('.hud-camera')).shown, 'base', 'camera: back to base');
    const dis = await page.evaluate(async () => {
      const { applyToolState } = await import('./src/ui/icon-art.js');
      const b = document.querySelector('.hud-help');
      b.setAttribute('aria-disabled', 'true');
      applyToolState(b);
      const v = [...b.querySelectorAll(':scope > .ico[data-v]')].filter((i) => !i.hidden).map((i) => i.dataset.v).join();
      b.removeAttribute('aria-disabled');
      applyToolState(b);
      return v;
    });
    t.equal(dis, 'disabled', 'help: disabled render');
    await page.evaluate(() => { const G = window.__game.game; G.world.alarm = { ...(G.world.alarm || {}), active: true }; G.hud.update(0.01); });
    t(await page.evaluate(() => document.querySelector('.hud-lamp').classList.contains('on')), 'alarm lamp lit');
    const tr = await clipOf(page, '.hud-icons', 6, { bottom: 40, left: 12 });
    await shotJpg(page, t, 'icons-topright-states', tr);
    await page.evaluate(() => { const G = window.__game.game; G.world.alarm.active = false; G.hud.cursor.setMode(null); G.hud.update(0.01); });
    await page.waitForTimeout(50);
    await shotJpg(page, t, 'icons-topright', tr);

    // cursors: rendered sprite + hotspot; scope ok/bad frames; the fallback chain webp → png → svg
    const cur = await page.evaluate(async () => {
      const { onIconError } = await import('./src/ui/icon-art.js');
      const hud = window.__game.game.hud;
      hud.cursor._sprite('scope');
      const scope = [...hud.cursor.sprite.querySelectorAll('img.ico')].map((i) => i.dataset.icon);
      hud.cursor._sprite('pistol');
      const img = hud.cursor.sprite.querySelector('img.ico');
      const first = onIconError(img) && img.src.endsWith('.png');
      const second = onIconError(img);
      const svg = hud.cursor.sprite.querySelector('svg.ico-fallback');
      hud.cursor.current = '';
      const { ICON_MANIFEST } = await import('./src/ui/icon-manifest.js');
      const want = `${ICON_MANIFEST['cursor/pistol'].h[0] * hud.scale}px`;
      return { scope, first, second, svg: !!svg, hx: hud.cursor.root.style.getPropertyValue('--hx'), want, cw: hud.cursor.root.style.getPropertyValue('--cw') };
    });
    t.equal(JSON.stringify(cur.scope), JSON.stringify(['cursor/scope.ok', 'cursor/scope.bad']), 'scope cursor: in-range + out-of-range renders');
    t(cur.first && cur.second && cur.svg, 'fallback: webp → png → inline SVG');
    t.equal(cur.hx, cur.want, 'pistol cursor hotspot from the render manifest (scaled with the HUD)');
    t.equal(cur.cw, '64px', '1080p: the 32-ref-px cursor is drawn at the HUD scale (64 px)');
  } finally {
    const errs = h.errors(page);
    await page.close();
    t(!errs.length, `1080p page clean (${errs.slice(0, 3).join(' | ')})`);
  }
}
