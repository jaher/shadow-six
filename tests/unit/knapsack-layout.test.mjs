/**
 * Knapsack layout (user 2026-10-08, on the iPhone close-up: "The bullets of sniper rifle overlap gun?"): in every kit a
 * player can see (tests/knapsack-kits.mjs: every commando in every mission, BEL and BCD, the kits that change in play,
 * the largest counts, two men selected together) the drawn boxes of the items (their visible pixels, shadow included),
 * their count tags (the cartridges standing above the plate included) and the DIG OUT tag never touch: at least
 * PACK_LAYOUT.gap apart, each tag right under its own item, everything on the pack's kit area. The browser check of the
 * same rule on desktop and phones at DPR 1–3 is tests/knapsack-layout.test.mjs.
 */
import { test, assert } from './lib.mjs';
import { knapsackView, knapsackLayout, tagSpec, rectsOverlap, PACK_LAYOUT, TAG } from '../../src/ui/knapsack-model.js';
import { ICON_MANIFEST } from '../../src/ui/icon-manifest.js';
import { itemArt, COUNT_ART } from '../../src/ui/icon-art.js';
import { knapsackKits } from '../knapsack-kits.mjs';

/** The knapsack.js render's input for a kit: its view items, their art and the layout. */
export function layoutKit(kit) {
  const units = kit.units.map((u, i) => ({ id: i + 1, role: u.role, alive: true, selected: true, x: 0, z: 0, inventory: new Map(Object.entries(u.inv)), ...(u.state || {}) }));
  const world = { campaign: kit.campaign, rules: kit.campaign === 'BCD' ? { id: 'BCD' } : undefined, groundAt: () => ({}) };
  const view = knapsackView(units, world);
  const roles = units.map((u) => u.role);
  const arts = view.items.map((it) => itemArt(it.id, roles) || itemArt(it.item, roles));
  const specs = view.items.map((it) => tagSpec(it, COUNT_ART[it.item || it.id] || null));
  const L = knapsackLayout(view.items.map((it, i) => {
    const e = ICON_MANIFEST[arts[i]];
    return { id: it.item || it.id, box: e?.b || [34, 34], content: e?.c || null, span: e?.s || 1, tag: specs[i] };
  }));
  return { view, arts, specs, L };
}

const gapOf = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

test('every icon the knapsack draws knows its drawn box (manifest c: visible pixels as fractions of the box)', () => {
  for (const [id, e] of Object.entries(ICON_MANIFEST)) {
    if (!id.startsWith('item/')) continue;
    assert.ok(Array.isArray(e.c) && e.c.length === 4, `${id} has c`);
    const [x0, y0, x1, y1] = e.c;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x1 - x0 > 0.3 && y1 - y0 > 0.3, `${id} c ${e.c}`);
  }
});

test('nothing on the pack overlaps: items, count tags and DIG OUT tags stay apart in every kit', () => {
  const kits = knapsackKits();
  assert.ok(kits.length > 60, `${kits.length} kits`);
  const A = PACK_LAYOUT, bad = [];
  let tags = 0;
  for (const kit of kits) {
    const { view, L } = layoutKit(kit);
    if (view.mode !== 'items') continue;
    const things = [];
    view.items.forEach((it, i) => {
      things.push({ what: `${it.id}`, owner: i, r: L[i].item, tag: false });
      if (L[i].tag) { things.push({ what: `${it.id} tag`, owner: i, r: L[i].tag, tag: true }); tags++; }
    });
    for (const t of things) {
      const r = t.r;
      if (r.x < A.x - 1e-6 || r.y < A.y - 1e-6 || r.x + r.w > A.x + A.w + 1e-6 || r.y + r.h > A.y + A.h + 1e-6) bad.push(`${kit.name}: ${t.what} leaves the kit area ${JSON.stringify(r)}`);
    }
    for (let a = 0; a < things.length; a++) {
      for (let b = a + 1; b < things.length; b++) {
        const p = things[a], q = things[b], own = p.owner === q.owner;
        const need = own ? A.attach : A.gap;
        if (rectsOverlap(p.r, q.r, 0.01) || gapOf(p.r, q.r) < need - 0.01) bad.push(`${kit.name}: ${p.what} / ${q.what} ${gapOf(p.r, q.r).toFixed(2)} px apart (need ${need})`);
      }
    }
  }
  assert.ok(tags > 50, `${tags} count tags checked`);
  assert.ok(!bad.length, `${bad.length} overlaps, e.g.\n  ${bad.slice(0, 12).join('\n  ')}`);
});

test('each count tag hangs right under its own item and fits its column; the rifle and its rounds stay readable', () => {
  for (const kit of knapsackKits({ pairs: false })) {
    const { view, specs, L } = layoutKit(kit);
    if (view.mode !== 'items') continue;
    view.items.forEach((it, i) => {
      const t = L[i].tag, r = L[i].item;
      if (!t) return;
      assert.ok(Math.abs(t.y - (r.y + r.h + PACK_LAYOUT.attach)) < 0.01, `${kit.name} ${it.id}: tag right under the item`);
      assert.ok(t.x >= L[i].slot.x - 1e-6 && t.x + t.w <= L[i].slot.x + L[i].slot.w + 1e-6, `${kit.name} ${it.id}: tag inside its column`);
      assert.ok(t.x < r.x + r.w && t.x + t.w > r.x, `${kit.name} ${it.id}: tag under the item, not beside it`);
      assert.ok(t.h >= TAG.h && t.w >= Math.min(specs[i].w, L[i].slot.w) - 1e-6, `${kit.name} ${it.id}: full-size tag`);
    });
    // no icon shrinks below 55 % of its box, whatever the kit (six items and two tags: 0.59; the mission kits: 0.8 and up)
    view.items.forEach((it, i) => assert.ok(L[i].k >= 0.55, `${kit.name} ${it.id}: drawn at ${L[i].k.toFixed(2)} of its box`));
    if (/^m\d\d /.test(kit.name)) view.items.forEach((it, i) => assert.ok(L[i].k >= 0.8, `${kit.name} ${it.id}: a mission kit drawn at ${L[i].k.toFixed(2)}`));
  }
  // the Sniper (the report): the rifle on top with its five rounds under it, the pistol below, clear of both
  const sn = layoutKit({ name: 'sniper', campaign: 'BEL', units: [{ role: 'sniper', inv: { sniperRifle: 5, pistol: 1, firstAid: 6 } }] });
  const i = (id) => sn.view.items.findIndex((x) => x.id === id);
  const rifle = sn.L[i('sniperRifle')], pistol = sn.L[i('pistol')];
  assert.ok(rifle.item.w > 70, `rifle ${rifle.item.w.toFixed(1)} px wide`);
  assert.ok(rifle.tag.y + rifle.tag.h + PACK_LAYOUT.gap <= pistol.item.y + 1e-6, 'the rounds end above the pistol');
  assert.ok(rifle.tag.y >= rifle.item.y + rifle.item.h, 'the rounds start below the rifle (and its shadow)');
});

test('the same item is drawn at the same size in every kit that fits the pack at full size', () => {
  const size = new Map();
  for (const kit of knapsackKits({ pairs: false })) {
    const { view, arts, L } = layoutKit(kit);
    if (view.mode !== 'items') continue;
    view.items.forEach((it, i) => {
      if (L[i].k < 0.999 * Math.min(PACK_LAYOUT.kMax, L[i].slot.w / (L[i].item.w / L[i].k))) return; // a crowded kit shrank
      const s = size.get(arts[i]);
      if (s == null) size.set(arts[i], L[i].item.h);
      else assert.ok(Math.abs(s - L[i].item.h) < 0.01, `${arts[i]} ${s.toFixed(2)} vs ${L[i].item.h.toFixed(2)} (${kit.name})`);
    });
  }
  assert.ok(size.has('item/pistol.colt1911') && size.has('item/sniperRifle'), 'checked');
});
