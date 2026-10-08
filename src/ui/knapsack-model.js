/**
 * Knapsack contents model (design-spec §6.4) — pure logic, no DOM, unit-tested.
 * - One man: his items. A group: only the items ALL of them carry (intersection), count = the smallest stack.
 * - Counts: sniper ammo = a row of cartridges, SMG = a stencilled number, grenades/bombs = individual icons,
 *   first aid = dose ticks; everything else is a single icon.
 * - Swaps: a sapper with a live remote bomb shows the detonator; a GB whose decoy is on the ground shows the activator.
 * - Occupant view: a man in a vehicle or building shows only his photo (click = exit).
 * - Buried (GB shovel): his kit with the shovel as the DIG OUT slot (`rise`), everything else locked.
 * - Disabled items carry a tooltip reason ("Only in shallow water").
 * @module ui/knapsack-model
 */

import { itemDef } from '../items.js';
import { ABILITIES, abilityInCampaign, groupIntersection, allAbilities } from '../abilities/index.js';
import { keyLabel } from '../engine/hotkeys.js';

/** Display mode per item id (§6.4 counts table). */
export const COUNT_DISPLAY = {
  sniperRifle: 'cartridges',
  smg: 'number',
  grenade: 'icons',
  timeBomb: 'icons',
  remoteBomb: 'icons',
  firstAid: 'ticks',
  cigarettes: 'number', // BCD §1.5 "CIGARETTES: n"
  leeEnfield: 'infinite', // BCD §1.7: hidden 50-round count, the HUD shows ∞ (stones: no count)
};

/** Knapsack draw order (roughly BEL's rucksack layout: weapons first, tools after). */
const ORDER = ['knife', 'pistol', 'sniperRifle', 'smg', 'harpoon', 'lethalInjection', 'grenade', 'timeBomb', 'remoteBomb', 'detonator',
  'bearTrap', 'wireCutters', 'decoy', 'shovel', 'inflatableBoat', 'divingGear', 'uniform', 'firstAid'];

/** Inventory of a commando as a plain {id: count} (Map or object). */
export function invOf(c) {
  const inv = c?.inventory;
  if (!inv) return {};
  if (inv instanceof Map) return Object.fromEntries(inv);
  return { ...inv };
}

function has(inv, id) {
  return (inv[id] ?? 0) > 0;
}

/**
 * Items shared by every commando in `units` → [{id, count}] in draw order.
 * @param {object[]} units
 */
export function kitIntersection(units) {
  const invs = units.map(invOf);
  if (!invs.length) return [];
  const ids = Object.keys(invs[0]).filter((id) => itemDef(id) && invs.every((inv) => has(inv, id)));
  ids.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return ids.map((id) => ({ id, count: Math.min(...invs.map((inv) => inv[id])) }));
}

/** Ability that an item arms (def.item === id, else the BEL hotkey), valid in the campaign. */
export function abilityForItem(itemId, campaign = 'BEL') {
  const key = itemDef(itemId)?.key?.toLowerCase();
  let best = null;
  for (const def of campaign === 'BEL' ? Object.values(ABILITIES) : allAbilities()) {
    if (!abilityInCampaign(def, campaign)) continue;
    if (def.item === itemId) return def;
    if (!best && key && String(def.hotkey || '').replace(/^Key/, '').toLowerCase() === key) best = def;
  }
  return best;
}

/** Terrain-gated reasons (§6.4 "Only in shallow water"). `groundAt` is world.groundAt. */
function itemReason(id, units, world) {
  const g = (u) => world?.groundAt?.(u.x, u.z) || {};
  if (id === 'inflatableBoat' && !units.every((u) => g(u).shallow || g(u).terrain === 'shallow')) return 'Only in shallow water';
  if (id === 'divingGear' && !units.every((u) => g(u).water || g(u).shallow || u.vehicle)) return 'Only in water or a boat';
  if (id === 'shovel' && !units.every((u) => ['sand', 'snow'].includes(g(u).terrain))) return 'Only on snow or sand';
  if (id === 'uniform' && units.some((u) => u.disguised)) return 'Already in uniform';
  return null;
}

/**
 * Full knapsack view for the current selection.
 * @param {object[]} selected selected living commandos
 * @param {object} [world]
 * @returns {{mode:'empty'|'occupant'|'items', buried?:boolean, rising?:boolean, units:object[],
 *   items:{id,count,display,disabled,reason,ability,swapped,rise?}[]}}
 */
export function knapsackView(selected, world) {
  const units = (selected || []).filter((u) => u && u.alive !== false);
  if (!units.length) return { mode: 'empty', units, items: [] };
  // buried in the snow / sand (§3.4 shovel): his own kit, the shovel turned into the DIG OUT button, the rest locked
  if (units.length === 1 && units[0].buried) return buriedView(units[0], world);
  if (units.length === 1 && (units[0].state === 'inVehicle' || units[0].state === 'hidden' || units[0].hidden)) {
    return { mode: 'occupant', units, items: [] };
  }
  const campaign = world?.campaign || world?.rules?.id || 'BEL';
  const shared = units.length > 1 ? new Set(groupIntersection(units.map((u) => u.abilities || []))) : null;
  const items = kitIntersection(units).map(({ id, count }) => {
    let shown = id, swapped = false;
    if (id === 'remoteBomb' && units.every((u) => u.remoteArmed > 0 || u.bombsPlaced?.length)) { shown = 'detonator'; swapped = true; }
    if (id === 'decoy' && units.every((u) => u.decoyPlaced || u.decoy)) { shown = 'decoyActivator'; swapped = true; }
    const def = abilityForItem(id, campaign);
    const infinite = !!itemDef(id)?.unlimited;
    let reason = itemReason(id, units, world);
    if (!reason && !infinite && count <= 0) reason = 'None left';
    if (!reason && def && shared && !shared.has(def.id)) reason = 'Not for the whole group';
    return {
      id: shown, item: id, count, swapped,
      display: COUNT_DISPLAY[id] || 'single',
      ability: def?.id || null,
      disabled: !!reason,
      reason,
      label: itemDef(id)?.label || id,
      key: world?.rules?.hotkeys && def ? keyLabel(def, world.rules) || itemDef(id)?.key || '' : itemDef(id)?.key || '', // BCD layout (bcd-plan §2)
    };
  });
  return { mode: 'items', units, items };
}

/**
 * Knapsack of a buried Green Beret: the shovel is the one live slot, in its 'rise' state (one click / tap digs him
 * out, like F or a right-click); while he is already rising it shows that and does nothing more. Every other item
 * waits until he is out.
 */
function buriedView(u, world) {
  const rising = u.currentActionId === 'shovel';
  const base = knapsackView([{ ...u, buried: false, state: 'active', selected: true, inventory: u.inventory, abilities: u.abilities }], world).items;
  const items = base.map((it) => it.item === 'shovel'
    ? { ...it, rise: true, label: rising ? 'Digging out' : 'Dig out', disabled: rising, reason: rising ? 'Digging out…' : null }
    : { ...it, disabled: true, reason: 'Dig out first (F)' });
  return { mode: 'items', buried: true, rising, units: [u], items };
}

/**
 * §6.4 count tag geometry (ref px), the same numbers as styles/ui.css `.hud-knapsack .count`: a stamped brass tag `h`
 * tall with `chrome` px of rivet ends and padding; its glyphs stand in it side by side (`w` + `gap`), the cartridges
 * `up` px above its top edge (a round in its loop). `max`: glyphs shown at most. Numbers are engraved text.
 */
export const TAG = Object.freeze({ h: 9, chrome: 12.4, minW: 20, digit: 4.4 });
export const TAG_GLYPHS = Object.freeze({
  cartridges: { w: 3.6, gap: 1, up: 2, max: 12 },
  'item/grenade.mini': { w: 7, gap: 1, up: 0.875, max: 8 },
  'item/charge.mini': { w: 8, gap: 1, up: 0, max: 8 },
  icons: { w: 4, gap: 1, up: 0, max: 8 }, // plain dots when an item has no glyph render
  ticks: { w: 1, gap: 1.6, up: 0, max: 8 },
});
/** The buried Green Beret's DIG OUT / RISING tag under the shovel (styles/ui.css `.rise-tag`). */
export const RISE_TAG = Object.freeze({ w: 38, h: 12 });

/**
 * Size of an item's count tag (or DIG OUT tag): {w, h, up, n, gw, gap, glyph} in ref px, or null (no count).
 * `glyph`: the count glyph's art id (COUNT_ART: cartridge, grenade / charge minis), when the item has one.
 */
export function tagSpec(it, glyph = null) {
  if (it?.rise) return { w: RISE_TAG.w, h: RISE_TAG.h, up: 0, n: 0, kind: 'rise' };
  if (!it || it.display === 'single' || !it.display || it.count == null) return null;
  if (it.display === 'number' || it.display === 'infinite') {
    const chars = it.display === 'infinite' ? 1 : String(it.count).length;
    return { w: Math.max(TAG.minW, TAG.chrome + chars * TAG.digit), h: TAG.h, up: 0, n: 0, kind: it.display };
  }
  const g = TAG_GLYPHS[it.display === 'cartridges' ? 'cartridges' : it.display === 'ticks' ? 'ticks' : glyph && TAG_GLYPHS[glyph] ? glyph : 'icons'];
  const n = Math.max(0, Math.min(it.count, g.max));
  const w = Math.max(TAG.minW, TAG.chrome + n * g.w + Math.max(0, n - 1) * g.gap);
  return { w, h: TAG.h, up: g.up, n, gw: g.w, gap: g.gap, kind: it.display };
}

/**
 * The pack's kit area and spacing (ref px of the 112×149 rendered rucksack): `gap` between any two things drawn on it
 * (items, count tags), `attach` between an item and its own tag (it hangs right under its weapon), `kMax` the most an
 * icon is enlarged over its box.
 */
export const PACK_LAYOUT = Object.freeze({ x: 7, y: 39, w: 98, h: 99, gap: 2.5, attach: 0.75, kMax: 1.12, cols: 2 });

/**
 * Lay the kit out on the pack with nothing drawn over anything else (user 2026-10-08: "The bullets of sniper rifle
 * overlap gun?"). Rows as PACK_ORDER gives them (a long gun fills a row, then two items a row, an odd last one centred);
 * each item is sized by its DRAWN box (the render's visible pixels, `content` fractions of its icon box, shadow
 * included) with its count tag right under it, inside its own column. Rows are as tall as their tallest item + tag and
 * `gap` apart; the whole kit shrinks by one common factor only when the rows would not fit the pack, and the spare
 * height is spread evenly above, between and below the rows.
 * @param {{id?:string, box:number[], content?:number[], span?:number, tag?:{w:number,h:number,up:number}|null}[]} entries
 * @returns {{item:Rect, icon:Rect, tag:Rect|null, slot:Rect, k:number}[]} item = drawn box, icon = the full image box,
 *   tag = the tag's drawn box (glyphs standing above it included); Rect = {x, y, w, h} in ref px; same order as entries
 */
export function knapsackLayout(entries, area = PACK_LAYOUT) {
  if (!entries.length) return [];
  const cols = area.cols || 2;
  const span = (i) => Math.min(cols, entries[i].span || (entries[i].box[0] >= 60 ? 2 : 1));
  const rank = (i) => {
    const r = PACK_ORDER.indexOf(entries[i].id);
    return r < 0 ? PACK_ORDER.length + i : r;
  };
  const order = entries.map((_, i) => i).sort((a, b) => (span(b) >= cols) - (span(a) >= cols) || rank(a) - rank(b) || a - b);
  const rows = [];
  for (const i of order) {
    let r = rows.find((q) => q.used + span(i) <= cols && !(span(i) >= cols && q.used));
    if (!r || (span(i) >= cols && r.used)) rows.push((r = { items: [], used: 0 }));
    r.items.push(i);
    r.used += span(i);
  }
  const colW = (area.w - area.gap * (cols - 1)) / cols;
  const slotW = (i) => colW * span(i) + area.gap * (span(i) - 1);
  const cbox = (i) => {
    const [bw, bh] = entries[i].box, c = entries[i].content || [0, 0, 1, 1];
    return { w: bw * (c[2] - c[0]), h: bh * (c[3] - c[1]), c };
  };
  const foot = (i) => (entries[i].tag ? area.attach + entries[i].tag.up + entries[i].tag.h : 0);
  const kOf = (i, s) => s * Math.min(area.kMax, slotW(i) / cbox(i).w);
  const rowH = (r, s) => Math.max(...r.items.map((i) => cbox(i).h * kOf(i, s) + foot(i)));
  const total = (s) => rows.reduce((t, r) => t + rowH(r, s), 0) + area.gap * (rows.length - 1);
  let s = 1;
  if (total(1) > area.h) { // one common factor for the whole kit (the tags keep their size)
    let lo = 0.2, hi = 1;
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (total(m) <= area.h) lo = m; else hi = m; }
    s = lo;
  }
  const spare = Math.max(0, area.h - total(s)) / (rows.length + 1);
  const out = new Array(entries.length);
  const r2 = (v) => Math.round(v * 1000) / 1000;
  const rect = (x, y, w, h) => ({ x: r2(x), y: r2(y), w: r2(w), h: r2(h) });
  let y = area.y + spare;
  for (const r of rows) {
    const h = rowH(r, s);
    let x = area.x + (r.used < cols ? (area.w - colW * r.used - area.gap * (r.used - 1)) / 2 : 0);
    for (const i of r.items) {
      const sw = slotW(i), k = kOf(i, s), cb = cbox(i), [bw, bh] = entries[i].box;
      const dw = cb.w * k, dh = cb.h * k, top = y + (h - dh - foot(i)) / 2;
      const ix = x + (sw - dw) / 2;
      const t = entries[i].tag;
      let tag = null;
      if (t) {
        const tw = Math.min(t.w, sw);
        const tx = Math.max(x, Math.min(x + sw - tw, ix + dw / 2 - tw / 2));
        tag = rect(tx, top + dh + area.attach, tw, t.up + t.h);
      }
      out[i] = {
        k: r2(k), slot: rect(x, y, sw, h), item: rect(ix, top, dw, dh), tag,
        icon: rect(ix - cb.c[0] * bw * k, top - cb.c[1] * bh * k, bw * k, bh * k),
      };
      x += sw + area.gap;
    }
    y += h + area.gap + spare;
  }
  return out;
}

/** Do two rects overlap (touching edges do not)? */
export function rectsOverlap(a, b, eps = 1e-6) {
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

/**
 * Canonical slot order (review: the same item keeps the same place in every kit): long guns first (a full row each),
 * then the sidearm, the knife, and the rest of the kit in a fixed order. Unknown ids go last in DOM order.
 */
export const PACK_ORDER = ['sniperRifle', 'leeEnfield', 'smg', 'harpoon', 'pistol', 'beretta', 'knife', 'lethalInjection', 'uniform',
  'decoy', 'decoyActivator', 'shovel', 'divingGear', 'inflatableBoat', 'timeBomb', 'remoteBomb', 'detonator', 'grenade', 'bearTrap',
  'wireCutters', 'firstAid', 'stones', 'handcuffs', 'hanger', 'knuckles', 'blackjack', 'chloroform', 'cigarettes', 'lipstick', 'climbAxe'];
