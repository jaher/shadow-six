/** Rendered HUD icons (assets/ui/icons): every inventory item / tool / cursor resolves to a real file at each DPR. */
import { test, assert } from './lib.mjs';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ITEMS, BCD_ITEMS } from '../../src/items.js';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { itemArt, pickTier, iconURL, tierFor, tierDensity, fallbackFor, COUNT_ART, toolHTML, iconHTML } from '../../src/ui/icon-art.js';
import { packLayout, PACK_AREA } from '../../src/ui/knapsack-model.js';
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
  let bytes = 0;
  for (const [id, e] of Object.entries(ICON_MANIFEST)) {
    for (const [k, [w, h, png]] of Object.entries(e.t)) {
      const f = file(iconURL(id, k));
      assert.ok(existsSync(f), f);
      bytes += statSync(f).size;
      if (png) bytes += statSync(file(iconURL(id, k, 'png'))).size;
      assert.ok(Math.abs(w - e.b[0] * tierDensity(k)) <= 1 && Math.abs(h - e.b[1] * tierDensity(k)) <= 1, `${id}@${k} is ${w}×${h}`);
    }
    assert.ok(e.t[tierFor(id, 2, 1)], `${id} has a tier for 1080p`);
  }
  // lossless WebP 1×–6× (stamps to 16×) + PNG fallbacks for 2×/3× (cursors 1×/1.5×); a session loads one tier per icon
  assert.ok(bytes < 16e6, `icon set ${(bytes / 1e6).toFixed(2)} MB < 16 MB`);
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

test('knapsack layout: icons stay on the pack, do not overlap, keep their aspect', () => {
  const B = { knife: [44, 20], pistol: [44, 32], harpoon: [66, 20], div: [40, 36], boat: [52, 28], stones: [32, 24], trap: [40, 30],
    tb: [36, 28], gr: [22, 30], wc: [22, 42], fa: [34, 26], sn: [72, 24], unif: [40, 34], cap: [36, 28] };
  const sets = [['knife', 'pistol', 'harpoon', 'div', 'boat', 'stones'], ['pistol', 'gr', 'tb', 'trap', 'wc', 'fa', 'stones'], ['sn', 'pistol', 'fa'],
    ['pistol', 'knife', 'unif', 'fa', 'cap', 'stones', 'gr', 'tb']];
  for (const set of sets) {
    const boxes = set.map((k) => B[k]);
    const L = packLayout(boxes);
    L.forEach((r, i) => {
      assert.ok(r.x >= PACK_AREA.x - 0.01 && r.x + r.w <= PACK_AREA.x + PACK_AREA.w + 0.01, `${set[i]} inside horizontally`);
      assert.ok(r.y >= PACK_AREA.y - 0.01 && r.y + r.h <= PACK_AREA.y + PACK_AREA.h + 0.01, `${set[i]} inside vertically`);
      assert.ok(Math.abs(r.w / r.h - boxes[i][0] / boxes[i][1]) < 0.02, `${set[i]} aspect`);
      for (let j = 0; j < i; j++) {
        const q = L[j];
        assert.ok(r.x >= q.x + q.w || q.x >= r.x + r.w || r.y >= q.y + q.h || q.y >= r.y + r.h, `${set[i]} / ${set[j]} overlap`);
      }
    });
  }
});

test('knapsack: one visual-mass rule, long guns span two slots, the same item keeps the same slot in every kit', () => {
  const E = (id) => ICON_MANIFEST[`item/${id}`];
  for (const id of ['sniperRifle', 'leeEnfield', 'smg', 'harpoon']) assert.equal(E(id).s, 2, `${id} spans two slots`);
  for (const id of ['knife', 'pistol.colt1911', 'firstAid', 'stones', 'lipstick', 'grenade']) assert.equal(E(id).s, 1, `${id} one slot`);
  const place = (ids) => {
    const arts = ids.map((i) => itemArt(i));
    return packLayout(arts.map((a) => ICON_MANIFEST[a].b), PACK_AREA, arts.map((a) => ICON_MANIFEST[a].s || 1), ids);
  };
  const cx = (r) => r.x + r.w / 2;
  // the pistol is the first one-slot item: left column of the first free row, in any DOM order
  const gb = place(['shovel', 'decoy', 'pistol', 'knife']), sp = place(['firstAid', 'lethalInjection', 'pistol']);
  assert.ok(cx(gb[2]) < PACK_AREA.x + PACK_AREA.w / 2 && cx(sp[2]) < PACK_AREA.x + PACK_AREA.w / 2, 'pistol in the left column');
  const cy = (r) => r.y + r.h / 2;
  assert.ok(Math.abs(cy(gb[2]) - cy(gb[3])) < 0.01 && cy(gb[2]) < cy(gb[1]), 'pistol (with the knife) on the first row without a long gun');
  // a long gun takes the whole first row, the pistol comes right under it
  const sn = place(['pistol', 'sniperRifle', 'firstAid']);
  assert.ok(sn[1].w > PACK_AREA.w * 0.7 && sn[1].y < sn[0].y, 'rifle spans the top row');
  // slot sizes are the same whatever the kit (3-row grid): the pistol is drawn at one size
  assert.ok(Math.abs(gb[2].h - sp[2].h) < 0.01 && Math.abs(gb[2].h - sn[0].h) < 0.01, 'pistol drawn at the same size in every kit');
  assert.ok(ICON_MANIFEST['tool/pack'] && ICON_MANIFEST['tool/tag'], 'rendered rucksack + brass count tag ship');
});
