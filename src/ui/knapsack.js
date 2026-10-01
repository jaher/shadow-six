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
import { knapsackView, packLayout } from './knapsack-model.js';
import { COUNT_ART, iconEntry, iconHTML, itemArt, toolHTML, wireToolStates } from './icon-art.js';
import { CONFIG } from '../config.js';

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

/**
 * Foot [min width, height] in ref px a count badge needs under its icon (§6.4 counts). Every count sits on the same
 * stamped brass tag (review: one period treatment): engraved digits, engraved dose notches, or the rendered minis
 * (cartridges, grenades, charges) resting on it.
 */
export function countFoot(it) {
  if (it.display === 'single' || it.count == null || !it.display) return [0, 0];
  const n = Math.min(it.count, it.display === 'cartridges' ? 12 : 8);
  // the tag hangs over the lower edge of the icon (like a tag tied on the kit): it reserves only a little height,
  // so a counted item (rifle + rounds, SMG + bursts) is drawn as large as the same item without a count
  switch (it.display) {
    case 'cartridges': return [n * 4.2 + 9, 4];
    case 'icons': return [n * 8 + 9, 4];
    case 'ticks': return [n * 3 + 10, 3];
    default: return [20, 3]; // number / infinite
  }
}

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
    const sig = `${view.mode}|${sel.map((u) => u.id).join(',')}|${view.items.map((i) => `${i.id}:${i.count}:${i.disabled}`).join()}|${tgt}|${this._crewSig(sel)}`;
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
    // rendered icons keep their own proportions (long guns are long): shelf-pack their ref boxes on the pack
    const roles = view.units.map((u) => u.role);
    const arts = view.items.map((it) => itemArt(it.id, roles) || itemArt(it.item, roles));
    // each slot reserves a foot under the icon for its count badge (cartridge row, glyphs, number, ticks)
    const icons = arts.map((a) => iconEntry(a)?.b || [34, 34]);
    const feet = view.items.map((it) => countFoot(it));
    const spans = arts.map((a) => iconEntry(a)?.s || 1);
    const layout = packLayout(icons.map(([w, h], i) => [Math.max(w, feet[i][0]), h + feet[i][1]]), undefined, spans, view.items.map((it) => it.item || it.id));
    view.items.forEach((it, i) => {
      const L = layout[i], k = L.h / (icons[i][1] + feet[i][1]);
      const w = icons[i][0] * k, h = icons[i][1] * k;
      const b = el('button', 'item', this.pack);
      b.type = 'button';
      Object.assign(b.style, { left: R(+(L.x + (L.w - w) / 2).toFixed(2)), top: R(L.y), width: R(+w.toFixed(2)), height: R(+h.toFixed(2)) });
      b.dataset.item = it.id;
      b.dataset.display = it.display;
      if (arts[i]) b.dataset.icon = arts[i];
      b.disabled = false; // keep hover tooltips on disabled items; `aria-disabled` + class instead
      b.classList.toggle('disabled', it.disabled);
      b.setAttribute('aria-disabled', String(it.disabled));
      if (it.ability && it.ability === targeting) b.classList.add('armed');
      b.innerHTML = arts[i] ? iconHTML(arts[i], { fb: `item/${it.id}` }) : ITEM_ICONS[it.id] || ITEM_ICONS[it.item] || GLYPHS.star;
      el('span', 'lbl', b, it.label);
      tip(b, it.disabled ? `${it.label.toUpperCase()}: ${it.reason.toUpperCase()}` : `${it.label.toUpperCase()}${it.key ? ` (${it.key})` : ''}`);
      this._count(b, it);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(it);
      });
    });
  }

  /** §6.4 counts on a stamped brass tag: cartridges row, engraved number, individual icons, dose notches. */
  _count(b, it) {
    if (it.display === 'single' || it.count == null) return;
    const c = el('span', `count tag ${it.display}`, b);
    if (it.display === 'number') {
      c.textContent = String(it.count);
      return;
    }
    if (it.display === 'infinite') { // BCD Lee-Enfield (§1.7): the count is hidden
      c.textContent = '∞';
      return;
    }
    const n = Math.min(it.count, it.display === 'cartridges' ? 12 : 8);
    const glyph = COUNT_ART[it.item || it.id];
    for (let k = 0; k < n; k++) {
      if (glyph) c.insertAdjacentHTML('beforeend', iconHTML(glyph, { fb: it.display === 'cartridges' ? 'item/cartridge' : '' }));
      else if (it.display === 'cartridges') c.insertAdjacentHTML('beforeend', ITEM_ICONS.cartridge);
      else el('i', null, c);
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
