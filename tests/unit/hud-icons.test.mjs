/** Rendered HUD icons (assets/ui/icons): every inventory item / tool / cursor resolves to a real file at each DPR. */
import { test, assert } from './lib.mjs';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ITEMS, BCD_ITEMS } from '../../src/items.js';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { itemArt, pickTier, iconURL, tierFor, tierDensity, fallbackFor, COUNT_ART, toolHTML, iconHTML } from '../../src/ui/icon-art.js';
import { CURSOR_ART, cursorArt } from '../../src/ui/cursor-sprites.js';

const file = (url) => fileURLToPath(url);
const SCALES = [1, 1.5, 2, 2.5, 3]; // uiScale steps (480 → 1440 px tall and up)
const DPRS = [1, 1.25, 1.5, 2, 3];

test('every inventory item id resolves to a rendered image at every UI scale × DPR (webp, png fallback, svg fallback)', () => {
  const ids = [...Object.keys(ITEMS), ...Object.keys(BCD_ITEMS), 'detonator', 'decoyActivator'];
  for (const id of ids) {
    for (const roles of [[], ['spy']]) {
      const art = itemArt(id, roles);
      assert.ok(art && ICON_MANIFEST[art], `item ${id} has art (${art})`);
      for (const s of SCALES) {
        for (const d of DPRS) {
          const t = pickTier(art, s * d);
          assert.ok(existsSync(file(iconURL(art, t))), `${art}@${t}.webp exists`);
          if (s * d <= tierDensity(Object.keys(ICON_MANIFEST[art].t).pop())) assert.ok(tierDensity(t) >= s * d - 1e-6, `${art} tier ${t} is sharp enough for ${s}×${d}`);
          const p = pickTier(art, s * d, true);
          assert.ok(existsSync(file(iconURL(art, p, 'png'))), `${art}@${p}.png exists`);
        }
      }
      assert.ok(fallbackFor(art).startsWith('<svg'), `${art} keeps an SVG fallback`);
    }
  }
  assert.equal(itemArt('pistol', ['spy']), 'item/pistol.p38');
  assert.equal(itemArt('pistol', ['greenberet', 'spy']), 'item/pistol.colt1911');
  for (const a of Object.values(COUNT_ART)) assert.ok(ICON_MANIFEST[a], `count glyph ${a}`);
});

test('every manifest file exists, is small, and the tiers cover 1080p and 4K', () => {
  let bytes = 0, kit = 0, kit2 = 0, kit2left = 0;
  for (const [id, e] of Object.entries(ICON_MANIFEST)) {
    for (const [k, [w, h, png]] of Object.entries(e.t)) {
      const f = file(iconURL(id, k));
      assert.ok(existsSync(f), f);
      const n = statSync(f).size + (png ? statSync(file(iconURL(id, k, 'png'))).size : 0);
      if (id.startsWith('kit/')) { // the knapsack kit: its own budget (below)
        kit += n;
        if (k === '2x') { if (id.endsWith('.left')) kit2left += n; else kit2 += n; }
      } else bytes += n;
      assert.ok(Math.abs(w - e.b[0] * tierDensity(k)) <= 1 && Math.abs(h - e.b[1] * tierDensity(k)) <= 1, `${id}@${k} is ${w}×${h}`);
    }
    assert.ok(e.t[tierFor(id, 2, 1)], `${id} has a tier for 1080p`);
  }
  // lossless WebP 1×–6× (stamps to 16×) + PNG fallbacks for 2×/3× (cursors 1×/1.5×); a session loads one tier per icon
  assert.ok(bytes < 16e6, `icon set ${(bytes / 1e6).toFixed(2)} MB < 16 MB`);
  // the knapsack kit (pack + one layer per item and count unit, and the mirrored set for Tab; WebP only): loaded with the
  // mission's crew, one tier per layer; at 1080p (2×) a side's whole kit stays under the 400 KB the brief allowed
  assert.ok(kit < 7e6, `knapsack kit ${(kit / 1e6).toFixed(2)} MB < 7 MB`);
  assert.ok(kit2 < 300e3 && kit2left < 300e3, `knapsack kit at 2x: ${(kit2 / 1024).toFixed(0)} KB right, ${(kit2left / 1024).toFixed(0)} KB mirrored (< 300 KB)`);
  // 1080p: uiScale 2 at DPR 1 → the 2× tier; 4K: uiScale 3 at DPR 1 → 3×, or uiScale 2 at DPR 2 → 4×
  assert.equal(pickTier('item/knife', 2), '2x');
  assert.equal(pickTier('item/knife', 3), '3x');
  assert.equal(pickTier('item/knife', 4), '4x');
  assert.equal(pickTier('cursor/knife', 2), '2x');
});

test('tool buttons carry every state variant; markup has intrinsic size (no layout shift)', () => {
  for (const t of ['camera', 'hand', 'help', 'notebook', 'stance.crawl', 'stance.stand', 'eye.open']) {
    const h = toolHTML(`tool/${t}`);
    for (const v of ['base', 'hover', 'pressed', 'active', 'disabled']) assert.ok(h.includes(`data-v="${v}"`), `${t} ${v}`);
  }
  const img = iconHTML('item/sniperRifle', { scale: 2 });
  const [bw, bh] = ICON_MANIFEST['item/sniperRifle'].b;
  assert.match(img, new RegExp(`width="${bw}" height="${bh}"`));
  assert.match(img, /src="[^"]*sniperRifle@2x\.webp" data-tier="2x"/, 'uiScale 2 at DPR 1: the 2× file (fitIcon then follows the drawn size)');
  // one slot height on the top bar (41 ref px): nothing hangs over the game view
  for (const t of ['camera', 'help', 'eye.open', 'eye.closed', 'lamp.off', 'lamp.on']) {
    assert.equal(ICON_MANIFEST[`tool/${t}`].b[1], 41, `${t} is 41 ref px tall`);
  }
  // the stance toggle moved to the bottom HUD (left of the hand): its two figures share one box (no shift on toggle)
  assert.deepEqual(ICON_MANIFEST['tool/stance.crawl'].b, ICON_MANIFEST['tool/stance.stand'].b, 'stance states share one box');
  // cursors are authored in ref px and ship a tier for uiScale 2 at DPR 2 (and uiScale 3 at DPR 2: 6×)
  assert.equal(pickTier('cursor/knife', 4), '4x');
  assert.equal(pickTier('cursor/knife', 6), '6x');
  assert.equal(tierFor('cursor/knife', 2, 2), '4x');
  assert.match(iconHTML('cursor/knife', { scale: 2 }), /knife@2x\.webp/);
});

test('cursor sprites map to rendered cursors with hotspots inside the sprite', () => {
  for (const [id, art] of Object.entries(CURSOR_ART)) {
    const e = ICON_MANIFEST[art];
    assert.ok(e, `cursor ${id} → ${art}`);
    const [hx, hy] = cursorArt(id).hot;
    assert.ok(hx >= 0 && hy >= 0 && hx <= e.b[0] && hy <= e.b[1], `${id} hotspot in box`);
  }
});

test('the item renders keep one visual-mass rule (Help dossier); the knapsack rucksack and its brass tag ship', () => {
  const E = (id) => ICON_MANIFEST[`item/${id}`];
  for (const id of ['sniperRifle', 'leeEnfield', 'smg', 'harpoon']) assert.equal(E(id).s, 2, `${id} spans two slots`);
  for (const id of ['knife', 'pistol.colt1911', 'firstAid', 'stones', 'lipstick', 'grenade']) assert.equal(E(id).s, 1, `${id} one slot`);
  assert.ok(ICON_MANIFEST['kit/pack'] && ICON_MANIFEST['tool/tag'], 'rendered rucksack + brass count tag ship');
});
