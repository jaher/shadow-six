/**
 * Shared helpers for the rendered-icon browser tests (ui-icons*.test.mjs): kit a commando, wait for the icons to
 * decode, probe every visible HUD icon (loaded, right density tier, no fallback, drawn at its CSS box).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TESTS_DIR } from './harness.mjs';

export const SHOT_DIR = join(TESTS_DIR, '..', 'docs', 'screenshots');

/** Per-commando showcase kits (BEL standard kit with counts, plus the BCD extras on the last two). */
export const KITS = [
  ['greenberet', { knife: 1, pistol: 1, decoy: 1, shovel: 1 }],
  ['sniper', { sniperRifle: 5, pistol: 1, firstAid: 4 }],
  ['diver', { knife: 1, harpoon: 1, pistol: 1, divingGear: 1, inflatableBoat: 1 }],
  ['sapper', { pistol: 1, bearTrap: 1, timeBomb: 3, grenade: 4, wireCutters: 1 }],
  ['driver', { pistol: 1, smg: 20, firstAid: 6 }],
  ['spy', { pistol: 1, lethalInjection: 1, uniform: 1, firstAid: 3 }],
  ['bcd-driver', { leeEnfield: 50, stones: 50, cigarettes: 3, remoteBomb: 2 }],
  ['bcd-spy', { handcuffs: 1, hanger: 1, stones: 50, beretta: 1, lipstick: 1 }],
];

/** Load m00, start, select the first commando dressed as `role` with inventory `inv`; resolves after decode. */
export async function kitUp(page, role, inv) {
  return page.evaluate(async ([role, inv]) => {
    const g = window.__game, G = g.game, w = G.world, hud = G.hud;
    const c = w.commandos[0];
    c.role = role.replace(/^bcd-/, '');
    c.inventory = new Map(Object.entries(inv));
    g.select([c.id]);
    hud.knapsack.sig = '';
    hud.update(0.01);
    g.render();
    // each icon then switches to the file for the size it is drawn at (icon-art.js fitIcon, after layout): let that
    // settle and the new files decode
    for (let k = 0; k < 4; k++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const imgs = [...document.querySelectorAll('.ui-hud img.ico')];
      await Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => null) : null)));
      if (imgs.every((i) => i.complete)) break;
    }
    return [...document.querySelectorAll('.hud-knapsack .item')].map((b) => b.dataset.icon);
  }, [role, inv]);
}

/** Every visible HUD icon: load state, chosen file, drawn size vs its box. */
export async function probeIcons(page) {
  return page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll('.ui-hud img.ico, .ui-hud .ico-fallback')) {
      const r = img.getBoundingClientRect();
      if (img.hidden || !r.width || getComputedStyle(img).visibility === 'hidden') continue;
      const box = img.parentElement.getBoundingClientRect();
      const cs = getComputedStyle(img);
      const cw = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ch = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const nw = img.naturalWidth, nh = img.naturalHeight;
      // drawn size of the art inside the box (object-fit), and how many bitmap px it has per device px drawn
      const k = !nw ? 0 : cs.objectFit === 'contain' ? Math.min(cw / nw, ch / nh) : cs.objectFit === 'cover' ? Math.max(cw / nw, ch / nh) : 0;
      const dw = k ? nw * k : cw, dh = k ? nh * k : ch;
      out.push({
        icon: img.dataset?.icon || '', tag: img.tagName, fallback: img.classList.contains('ico-fallback'), mult: Number(img.dataset?.mult || 1),
        ok: img.tagName === 'IMG' && img.complete && img.naturalWidth > 0, src: img.currentSrc || img.src || '',
        w: r.width, h: r.height, pw: box.width, ph: box.height, nat: [nw, nh], tier: img.dataset?.tier || '',
        // a knapsack item's button is its drawn box: the render hangs over it by its transparent margins (knapsackLayout)
        pack: !!img.closest('.hud-knapsack .item'), covers: r.left <= box.left + 0.5 && r.top <= box.top + 0.5 && r.right >= box.right - 0.5 && r.bottom >= box.bottom - 0.5,
        cover: nw ? Math.min(nw / (dw * devicePixelRatio), nh / (dh * devicePixelRatio)) : 0,
      });
    }
    return out;
  });
}

/** Rects of the HUD's icon hosts (layout-shift check). */
export async function hostRects(page) {
  return page.evaluate(() => [...document.querySelectorAll('.hud-icon, .hud-hand, .hud-knapsack .item')].map((e) => {
    const r = e.getBoundingClientRect();
    return [e.className, Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10].join(' ');
  }));
}

/** Clip rect around a selector's box (+pad px), clamped to the viewport. */
export async function clipOf(page, sel, pad = 8, extra = {}) {
  const b = await page.locator(sel).first().boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, b.x - pad - (extra.left || 0)), y = Math.max(0, b.y - pad - (extra.top || 0));
  return { x, y, width: Math.min(vp.width - x, b.width + 2 * pad + (extra.left || 0) + (extra.right || 0)), height: Math.min(vp.height - y, b.height + 2 * pad + (extra.top || 0) + (extra.bottom || 0)) };
}

/** Screenshot to docs/screenshots/<name>.jpg when ICON_SHOTS=1 (else tests/out/<name>.jpg). */
export async function shotJpg(page, t, name, clip, scale = 'css') {
  const dir = process.env.ICON_SHOTS === '1' ? SHOT_DIR : join(TESTS_DIR, 'out');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.jpg`), clip, type: 'jpeg', quality: 86, scale });
}

/** Common assertions over a probe: all loaded, no fallback, the expected tier, drawn at the host box. */
export function checkProbe(t, probe, tier, label) {
  t(probe.length >= 8, `${label}: ${probe.length} icons visible`);
  const bad = probe.filter((p) => !p.ok || p.fallback);
  t(!bad.length, `${label}: every icon loaded as an image (bad: ${JSON.stringify(bad.slice(0, 3))})`);
  // top-bar / bottom tools are drawn at their ref box × the UI scale: exactly the @tier file; knapsack items sit in
  // smaller slots and take the smallest tier that covers the size they are drawn at (icon-art.js fitIcon)
  const tools = probe.filter((p) => /^tool\/(camera|help|lamp|eye|hand|stance|pack)/.test(p.icon) && !p.fallback);
  const wrong = tools.filter((p) => !p.src.includes(`@${tier}.`));
  t(tools.length >= 5 && !wrong.length, `${label}: tools use the @${tier} files (${tools.length} checked; wrong: ${wrong.map((p) => p.src.split('/').pop()).join(', ')})`);
  const low = probe.filter((p) => p.ok && !p.fallback && p.cover < 0.98);
  t(!low.length, `${label}: every icon has ≥ the device px it covers (low: ${low.map((p) => `${p.src.split('/').pop()} ${p.cover.toFixed(2)}`).join(', ')})`);
  // the notebook page is one full-size sheet clipped by the folding page element (by design)
  const off = probe.filter((p) => !p.pack && p.pw && Math.abs(p.w - p.pw) > 1.5 && !/count/.test(p.icon) && !p.icon.includes('.mini') && !p.icon.includes('cartridge') && !p.icon.startsWith('stamp/') && p.icon !== 'tool/notebook.page');
  t(!off.length, `${label}: icons fill their CSS box (no intrinsic-size layout) ${JSON.stringify(off.slice(0, 2))}`);
  const pack = probe.filter((p) => p.pack && p.ok && !p.icon.includes('.mini') && !p.icon.includes('cartridge'));
  const loose = pack.filter((p) => !p.covers || Math.abs(p.w / p.h - p.nat[0] / p.nat[1]) > 0.03);
  t(pack.length && !loose.length, `${label}: knapsack renders cover their item's drawn box at their own aspect ${JSON.stringify(loose.slice(0, 2))}`);
}
