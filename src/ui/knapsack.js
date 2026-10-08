/**
 * Right column bottom (design-spec §6.4): the photo-real hand button (= H) and the olive knapsack with item
 * icons painted on the pack. Contents come from `knapsackView` (group intersection, swaps, disabled reasons,
 * occupant view). Tab mirrors the pack to the left side.
 * @module ui/knapsack
 */

import { getPortraitURL } from '../art/portraits.js';
import { ABILITIES } from '../abilities/index.js';
import { el, fromHTML, tip } from './dom.js';
import { GLYPHS, ITEM_ICONS } from './icons.js';
import { TAG, knapsackView, knapsackLayout, tagSpec } from './knapsack-model.js';
import { COUNT_ART, iconEntry, iconHTML, itemArt, toolHTML, wireToolStates } from './icon-art.js';
import { CONFIG } from '../config.js';
import { isTouchUI } from './touch.js';

/** A finger tap on the bag between slots goes to the nearest slot within this many CSS px of the finger. */
export const BAG_TAP_SLOP = 28;

/**
 * The button a finger tap at (x, y) on the bag means: the one under the finger, else the nearest one whose box is
 * within `slop` px (padded hit areas that split the gaps between slots, never overlapping a slot's own box).
 * @param {{el: any, left: number, top: number, right: number, bottom: number}[]} boxes
 */
export function nearestSlot(boxes, x, y, slop = BAG_TAP_SLOP) {
  let best = null, bd = slop;
  for (const b of boxes) {
    const dx = Math.max(b.left - x, 0, x - b.right), dy = Math.max(b.top - y, 0, y - b.bottom);
    const d = Math.hypot(dx, dy);
    if (d <= bd) { bd = d; best = b.el; if (!d) break; }
  }
  return best;
}

/**
 * bodies-design §C.5 context pair while one man transports another: Lift (shoulder) or Drag (collar), and Put down.
 * @returns {{mode:string, lift:{show:boolean, ok:boolean, tip:string}, drag:{show:boolean, tip:string}, put:{tip:string}}|null}
 */
export function transportButtons(c, world) {
  if (!c || !c.carrying || c.carrying.kind === 'interactable') return null;
  const B = CONFIG.bodies, shoulderOk = c.role === 'greenberet' || c.role === 'spy';
  const six = world?.house?.preset !== 'classic1998';
  const not = six ? ' ✦ Not in the 1998 original.' : '';
  const busy = c.currentActionId === 'carryToggle' || c.currentActionId === 'drop';
  return {
    mode: c.carryMode || 'shoulder', busy,
    lift: { show: c.carryMode === 'drag', ok: shoulderOk && !busy,
      tip: shoulderOk ? `LIFT (H) — shoulder carry, ${CONFIG.units.carry} m/s, ${B.drag.toShoulder} s to lift.` : 'Only the Green Beret and the Spy can shoulder a man.' },
    drag: { show: c.carryMode === 'shoulder' && !!world?.house?.dragBodies, ok: !busy,
      tip: `DRAG (SHIFT+H) — ${B.drag.speed} m/s, walks backwards, ${B.drag.toDrag} s to lower.${not}` },
    put: { tip: `PUT DOWN (RIGHT-CLICK) — ${c.carryMode === 'drag' ? B.drag.release : CONFIG.abilities.carry.drop} s.` },
  };
}

const R = (n) => `calc(${n} * var(--r))`;

export class Knapsack {
  constructor(hud, parent) {
    this.hud = hud;
    this.hand = tip(fromHTML(`<button type="button" class="hud-hand">${toolHTML('tool/hand') || GLYPHS.hand}<span class="lbl">Hand</span></button>`, null, parent), 'PICK UP / USE (H)');
    wireToolStates(this.hand);
    this.hand.addEventListener('click', () => hud.useHand());
    this.root = el('div', 'hud-knapsack', parent);
    if (iconEntry('tool/pack')) this.root.insertAdjacentHTML('afterbegin', iconHTML('tool/pack', { cls: 'packart' })); // rendered rucksack
    this.passengers = el('div', 'passengers', this.root);
    this.pack = el('div', 'pack', this.root);
    // a finger on the canvas between slots means the nearest slot (the slots are small for a fingertip)
    this.root.addEventListener('click', (e) => {
      if (!isTouchUI() || e.target?.closest?.('button')) return;
      const boxes = [...this.root.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { el: b, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }).filter((b) => b.right > b.left && b.bottom > b.top);
      const hit = nearestSlot(boxes, e.clientX, e.clientY);
      if (hit) { e.stopPropagation(); hit.click(); }
    });
    this.sig = '';
    this.left = false;
    this.transport = el('div', 'hud-transport', parent);
    this.transport.hidden = true;
    this._tsig = '';
  }

  /** §C.5 Lift / Drag / Put down buttons while the selected man transports someone. */
  _updateTransport(sel, w) {
    const c = sel.length === 1 ? sel[0] : null;
    const v = transportButtons(c, w);
    const sig = v ? `${c.id}|${v.mode}|${v.busy}|${w.house?.preset}` : '';
    if (sig === this._tsig) return;
    this._tsig = sig;
    this.transport.replaceChildren();
    this.transport.hidden = !v;
    if (!v) return;
    const btn = (cls, label, t, ok, fn) => {
      const b = tip(el('button', `hud-tbtn ${cls}`, this.transport), t);
      b.type = 'button';
      b.innerHTML = `${GLYPHS[cls === 'lift' ? 'carrying' : cls === 'drag' ? 'dragging' : 'downed'] || ''}<span>${label}</span>`;
      b.disabled = !ok;
      if (cls === 'drag') b.classList.add('not-original');
      b.addEventListener('click', () => { if (!b.disabled) this.hud.game.enqueue(fn); });
      return b;
    };
    if (v.lift.show) btn('lift', 'Lift', v.lift.tip, v.lift.ok, () => c.issue({ type: 'ability', id: 'carryToggle', target: c }));
    if (v.drag.show) btn('drag', 'Drag', v.drag.tip, v.drag.ok, () => c.issue({ type: 'ability', id: 'carryToggle', target: c }));
    btn('put', 'Put down', v.put.tip, !v.busy, () => c.issue({ type: 'cancel' }));
  }

  /** Tab: mirror the knapsack to the other side (§6.4). */
  swapSide() {
    this.left = !this.left;
    this.hud.root.classList.toggle('pack-left', this.left);
  }

  update() {
    const w = this.hud.world;
    const sel = w ? w.commandos.filter((c) => c.selected && c.alive) : [];
    this._updateTransport(sel, w);
    const view = knapsackView(sel, w);
    const tgt = this.hud.game.input?.targeting?.abilityId || '';
    const sig = `${view.mode}|${sel.map((u) => u.id).join(',')}|${view.items.map((i) => `${i.id}:${i.count}:${i.disabled}:${i.rise ? 1 : 0}`).join()}|${tgt}|${this._crewSig(sel)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.view = view;
    this.render(view, tgt);
  }

  _crewSig(sel) {
    const v = sel.length === 1 ? sel[0].vehicle : null;
    return v ? (v.crew || []).map((c) => c.id).join('.') : '';
  }

  render(view, targeting) {
    this.pack.replaceChildren();
    this.passengers.replaceChildren();
    this.root.dataset.mode = view.mode;
    this.root.classList.toggle('buried', !!view.buried); // §3.4: a buried GB's pack (the shovel is the DIG OUT slot)
    if (view.mode === 'occupant') {
      const u = view.units[0];
      const b = tip(el('button', 'occupant', this.pack), 'CLICK TO GET OUT');
      b.type = 'button';
      const img = el('img', null, b);
      img.src = getPortraitURL(u.role, { size: 80 });
      img.alt = u.role;
      b.addEventListener('click', () => this.hud.exitShelter(u));
      const crew = (u.vehicle?.crew || []).filter((c) => c !== u);
      for (const c of crew) {
        const p = el('img', 'passenger', this.passengers);
        p.src = getPortraitURL(c.role, { size: 40 });
        p.alt = c.role;
      }
      return;
    }
    // rendered icons keep their own proportions (long guns are long); nothing drawn on the pack overlaps anything else:
    // each item by its drawn box with its count tag right under it (knapsack-model.js knapsackLayout)
    const roles = view.units.map((u) => u.role);
    const arts = view.items.map((it) => itemArt(it.id, roles) || itemArt(it.item, roles));
    const specs = view.items.map((it) => tagSpec(it, COUNT_ART[it.item || it.id] || null));
    const layout = knapsackLayout(view.items.map((it, i) => {
      const e = iconEntry(arts[i]);
      return { id: it.item || it.id, box: e?.b || [34, 34], content: e?.c || null, span: e?.s || 1, tag: specs[i] };
    }));
    view.items.forEach((it, i) => {
      const L = layout[i], at = (r) => ({ left: R(+(r.x - L.item.x).toFixed(3)), top: R(+(r.y - L.item.y).toFixed(3)) });
      // the button is the item's drawn box (its hit area is what you see); the render hangs over it by its margins
      const b = el('button', 'item', this.pack);
      b.type = 'button';
      Object.assign(b.style, { left: R(L.item.x), top: R(L.item.y), width: R(L.item.w), height: R(L.item.h) });
      b.dataset.item = it.id;
      b.dataset.display = it.display;
      if (arts[i]) b.dataset.icon = arts[i];
      b.disabled = false; // keep hover tooltips on disabled items; `aria-disabled` + class instead
      b.classList.toggle('disabled', it.disabled);
      b.setAttribute('aria-disabled', String(it.disabled));
      if (it.ability && it.ability === targeting) b.classList.add('armed');
      b.innerHTML = arts[i] ? iconHTML(arts[i], { fb: `item/${it.id}` }) : ITEM_ICONS[it.id] || ITEM_ICONS[it.item] || GLYPHS.star;
      const art = b.firstElementChild;
      if (art) Object.assign(art.style, { position: 'absolute', ...at(L.icon), width: R(L.icon.w), height: R(L.icon.h) });
      el('span', 'lbl', b, it.label);
      if (it.rise) { // §3.4 shovel while buried: a stamped DIG OUT tag under the slot, one click / tap rises
        b.classList.add('rise');
        b.dataset.rise = it.disabled ? 'rising' : 'ready';
        const t = el('span', 'rise-tag', b, it.disabled ? 'RISING' : 'DIG OUT');
        Object.assign(t.style, { ...at(L.tag), width: R(L.tag.w), height: R(L.tag.h) });
      }
      tip(b, it.rise && !it.disabled ? `DIG OUT${it.key ? ` (${it.key})` : ''} — COME OUT OF THE ${view.units[0]?.dig?.surface === 'sand' ? 'SAND' : 'SNOW'}`
        : it.disabled ? `${it.label.toUpperCase()}: ${it.reason.toUpperCase()}` : `${it.label.toUpperCase()}${it.key ? ` (${it.key})` : ''}`);
      if (!it.rise) this._count(b, it, specs[i], L);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(it);
      });
    });
  }

  /**
   * §6.4 counts on a stamped brass tag hanging right under the item (its own column, clear of every other item):
   * cartridges row, engraved number, individual icons, dose notches. A row wider than the column closes up (the
   * glyphs overlap a little) instead of reaching into the next item.
   */
  _count(b, it, spec, L) {
    if (!spec || !L.tag) return;
    const c = el('span', `count tag ${it.display}`, b);
    // the plate sits `up` below the tag box's top (the cartridges stand that much above it)
    Object.assign(c.style, { left: R(+(L.tag.x - L.item.x).toFixed(3)), top: R(+(L.tag.y + spec.up - L.item.y).toFixed(3)), width: R(L.tag.w) });
    if (it.display === 'number') {
      c.textContent = String(it.count);
      return;
    }
    if (it.display === 'infinite') { // BCD Lee-Enfield (§1.7): the count is hidden
      c.textContent = '∞';
      return;
    }
    const glyph = COUNT_ART[it.item || it.id];
    const close = spec.n > 1 && L.tag.w < spec.w - 1e-6 ? (L.tag.w - TAG.chrome - spec.gw) / (spec.n - 1) - spec.gw : null; // margin between glyphs
    if (close != null) c.style.gap = '0';
    for (let k = 0; k < spec.n; k++) {
      if (glyph) c.insertAdjacentHTML('beforeend', iconHTML(glyph, { fb: it.display === 'cartridges' ? 'item/cartridge' : '' }));
      else if (it.display === 'cartridges') c.insertAdjacentHTML('beforeend', ITEM_ICONS.cartridge);
      else el('i', null, c);
      if (close != null && k) c.lastElementChild.style.marginLeft = R(+close.toFixed(3));
    }
  }

  /** Click / hotkey: act at once or arm a cursor (via the ability's targeting). */
  activate(it) {
    if (it.disabled) {
      this.hud.message(it.reason, 'warn');
      return false;
    }
    const input = this.hud.game.input;
    if (!it.ability || !ABILITIES[it.ability]) {
      this.hud.message(`${it.label}: not available yet.`, 'info');
      return false;
    }
    if (input?.targeting?.abilityId === it.ability) {
      input.cancelTargeting();
      return true;
    }
    return !!input?.beginTargeting(it.ability);
  }
}
