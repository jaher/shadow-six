/**
 * Knapsack contents model (design-spec §6.4) — pure logic, no DOM, unit-tested.
 * - One man: his items. A group: only the items ALL of them carry (intersection), count = the smallest stack.
 * - Counts: sniper ammo = a round in the bandolier per round, grenades / bombs = one Mills bomb / charge each (knapsackKit),
 *   SMG bursts, first-aid doses, cigarettes, overflow = a number stencilled on the kit; everything else is the item alone.
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
 * §6.4 count tag geometry (ref px), the same numbers as styles/ui.css `.hud-knapsack .count`: a stamped brass plate on a
 * leather strip `h` tall with `chrome` px of rivet ends and padding; numbers are engraved text (`digit` px each), dose
 * notches 1 px with 1.6 px between.
 */
export const TAG = Object.freeze({ h: 9, chrome: 12.4, minW: 20, digit: 4.4 });
/** The buried Green Beret's DIG OUT / RISING tag under the shovel (styles/ui.css `.rise-tag`). */
export const RISE_TAG = Object.freeze({ w: 38, h: 12 });

/**
 * The knapsack is one physical object (user 2026-11-08: "Backpack doesn't look nice, look at original", then "Items should
 * be in 3d hanging from backpack"): a closed rucksack render (`kit/pack`) with each item rendered IN PLACE on it, hanging
 * or strapped where kit is carried (tools/blender/icons/models/kit.py), one pre-lit layer per item. Counts are physical
 * where they can be: one brass round in the bandolier per sniper round, one Mills bomb clipped to the webbing per grenade,
 * one charge strapped on per bomb (up to KIT_UNITS; beyond that, and for SMG bursts, first-aid doses, cigarettes and the
 * Lee-Enfield's ∞, the number stencilled on the kit: knapsack.js _count).
 */
export const KIT_UNITS = Object.freeze({ cartridges: { art: 'round', from: 1, max: 10 }, grenade: { art: 'grenade', from: 2, max: 5 },
  timeBomb: { art: 'charge', from: 2, max: 4 }, remoteBomb: { art: 'charge', from: 2, max: 4 } });

/**
 * Art for each knapsack item as kit layers. `has(id)`: is that art shipped (ICON_MANIFEST). `left`: Tab's mirrored set.
 * @param {{items: object[], units?: object[]}} view knapsackView() output
 * @returns {{it: object, art: string|null, units: string[], tag: object|null}[]} art = the item's layer, units = the extra
 *   unit layers (rounds, bombs, charges) shown with it, tag = {kind, n} for the brass tag (null: none)
 */
export function knapsackKit(view, { left = false, has = () => true } = {}) {
  const roles = (view.units || []).map((u) => u.role);
  const side = (id) => (left && has(`${id}.left`) ? `${id}.left` : id);
  return (view.items || []).map((it) => {
    let id = it.id;
    if (it.item === 'pistol' || id === 'pistol') id = roles.length && roles.every((r) => r === 'spy') ? 'pistol.p38' : 'pistol.colt1911';
    if (it.swapped && it.id === 'detonator') id = 'detonator@charge'; // the detonator in the charges' place once they are out
    const art = has(`kit/${id}`) ? side(`kit/${id}`) : null;
    const units = [];
    let tag = null;
    const u = it.display === 'cartridges' ? KIT_UNITS.cartridges : !it.swapped ? KIT_UNITS[it.item || it.id] : null;
    if (u && it.count > 0) {
      for (let k = u.from; k <= Math.min(it.count, u.max); k++) if (has(`kit/${u.art}.${k}`)) units.push(side(`kit/${u.art}.${k}`));
      if (it.count > u.max) tag = { kind: 'number', n: it.count };
    } else if (it.display === 'ticks' || it.display === 'number' || it.display === 'infinite') {
      tag = { kind: it.display, n: it.count };
    }
    return { it, art, units, tag };
  });
}

/** Is (x, y) inside polygon `p` ([[x, y], ...])? (even-odd) */
export function inPolygon(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Distance from (x, y) to polygon `p` (0 inside). */
export function polygonDistance(p, x, y) {
  if (inPolygon(p, x, y)) return 0;
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, ay] = p[j], [bx, by] = p[i], dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return d;
}

/**
 * Which kit item a pointer at (x, y) means: the topmost (highest z, then the later one) whose silhouette contains it,
 * else the nearest silhouette within `slop` (a finger on the bag between items). `items`: [{el, z, poly: [[x, y], ...]}]
 * in the same px as x, y.
 */
export function pickKit(items, x, y, slop = 0) {
  let best = null, bz = -Infinity, bi = -1;
  items.forEach((k, i) => {
    if (k.poly.length > 2 && inPolygon(k.poly, x, y) && (k.z > bz || (k.z === bz && i > bi))) { best = k.el; bz = k.z; bi = i; }
  });
  if (best || !slop) return best;
  let bd = slop;
  for (const k of items) {
    const d = k.poly.length > 2 ? polygonDistance(k.poly, x, y) : Infinity;
    if (d <= bd) { bd = d; best = k.el; }
  }
  return best;
}
