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

/** Kit area of the rendered rucksack below the flap and its buckles (ref px of the 112×149 pack). */
export const PACK_AREA = Object.freeze({ x: 7, y: 39, w: 98, h: 99, gap: 2, rowGap: 0, cols: 2, minRows: 3 });

/**
 * Canonical slot order (review: the same item keeps the same place in every kit): long guns first (a full row each),
 * then the sidearm, the knife, and the rest of the kit in a fixed order. Unknown ids go last in DOM order.
 */
export const PACK_ORDER = ['sniperRifle', 'leeEnfield', 'smg', 'harpoon', 'pistol', 'beretta', 'knife', 'lethalInjection', 'uniform',
  'decoy', 'decoyActivator', 'shovel', 'divingGear', 'inflatableBoat', 'timeBomb', 'remoteBomb', 'detonator', 'grenade', 'bearTrap',
  'wireCutters', 'firstAid', 'stones', 'handcuffs', 'hanger', 'knuckles', 'blackjack', 'chloroform', 'cigarettes', 'lipstick', 'climbAxe'];

/**
 * Lay the item icons out on the pack in a fixed slot grid (2 columns, at least 3 rows): items take their slots in
 * PACK_ORDER, a long gun (span 2) fills a whole row, an odd last item is centred in its row. Each icon is scaled to
 * fit its slot (never above its own box, which already carries the equal-visual-mass size) and centred in it.
 * `boxes`: [[w, h]] ref-px boxes (icon + count foot) in DOM order; `spans`: 1|2 per item (default: 2 when w ≥ 60);
 * `ids`: item ids for PACK_ORDER (default: DOM order).
 * @returns {{x:number, y:number, w:number, h:number}[]} top-left + size in ref px, same order as `boxes`
 */
export function packLayout(boxes, area = PACK_AREA, spans = null, ids = null) {
  if (!boxes.length) return [];
  const cols = area.cols || 2;
  const span = (i) => Math.min(cols, spans?.[i] || (boxes[i][0] >= 60 ? 2 : 1));
  const rank = (i) => {
    const r = ids ? PACK_ORDER.indexOf(ids[i]) : -1;
    return r < 0 ? PACK_ORDER.length + i : r;
  };
  const order = boxes.map((_, i) => i).sort((a, b) => (span(b) >= cols) - (span(a) >= cols) || rank(a) - rank(b) || a - b);
  const rows = [];
  for (const i of order) {
    let r = rows.find((q) => q.used + span(i) <= cols && !(span(i) >= cols && q.used));
    if (!r || (span(i) >= cols && r.used)) rows.push((r = { items: [], used: 0 }));
    r.items.push(i);
    r.used += span(i);
  }
  const n = Math.max(area.minRows || 1, rows.length);
  const ch = (area.h - area.rowGap * (n - 1)) / n;
  const cw = (area.w - area.gap * (cols - 1)) / cols;
  const out = new Array(boxes.length);
  // fewer rows than the grid: spread the used rows over the area (no empty band at the bottom)
  const pitch = rows.length < n ? (area.h - ch * rows.length) / (rows.length + 1) : area.rowGap;
  let y = area.y + (rows.length < n ? pitch : 0);
  for (const r of rows) {
    const odd = r.used < cols;
    let x = area.x + (odd ? (area.w - cw * r.used - area.gap * (r.used - 1)) / 2 : 0);
    for (const i of r.items) {
      const sw = cw * span(i) + area.gap * (span(i) - 1);
      const k = Math.min(1.12, sw / boxes[i][0], ch / boxes[i][1]);
      const w = boxes[i][0] * k, h = boxes[i][1] * k;
      out[i] = { x: +(x + (sw - w) / 2).toFixed(2), y: +(y + (ch - h) / 2).toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
      x += sw + area.gap;
    }
    y += ch + pitch;
  }
  return out;
}
