/**
 * Right column bottom (design-spec §6.4): the photo-real hand button (= H) and the knapsack: a closed olive rucksack
 * with the selected man's kit hanging from it in 3D (user 2026-11-08: "Items should be in 3d hanging from backpack"):
 * the pack render plus one pre-lit layer per item, each mounted where it is carried (tools/blender/icons/models/kit.py),
 * stacked by depth. An item's hit area is its visible silhouette (`.hit`, clip-path polygon): the topmost wins.
 * Contents come from `knapsackView` (group intersection, swaps, disabled reasons, occupant view). Tab moves the pack to
 * the left side and shows the mirrored renders (still lit from the upper left).
 * @module ui/knapsack
 */

import { getPortraitURL } from '../art/portraits.js';
import { ABILITIES } from '../abilities/index.js';
import { el, fromHTML, tip } from './dom.js';
import { GLYPHS, ITEM_ICONS } from './icons.js';
import { TAG, RISE_TAG, knapsackView, knapsackKit, pickKit } from './knapsack-model.js';
import { iconEntry, iconHTML, preloadIcons, toolHTML, wireToolStates } from './icon-art.js';
import { ICON_MANIFEST } from './icon-manifest.js';
import { CONFIG } from '../config.js';
import { isTouchUI } from './touch.js';

/** A finger tap on the bag between slots goes to the nearest slot within this many CSS px of the finger. */
export const BAG_TAP_SLOP = 28;
/** A mouse click just off an item's silhouette (its antialiased rim, a strap end) still means it: ref px of slop. */
export const BAG_CLICK_SLOP_REF = 2;

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
const BOX_W = 112, BOX_H = 149; // the knapsack's ref box (design-spec §6.4)
/** Gap (ref px) between the kit's visible bounds and the screen's corner once it is tucked in (user 2026-11-08: "If
 *  backpack can be a bit lower in the right bottom corner do so (in a way no items goes out of screen at all)"). */
export const TUCK_MARGIN = 3;

const tucks = new Map();
/**
 * Where the pack sits (user 2026-11-08: "Backpack itself should be in the same position for all commandos."): ONE shift
 * per side (ref px), from the worst case of every kit the pack can show: the union of every kit layer of that side (each
 * layer's drawn content, shadow included: manifest c) and the stencils' extents, put TUCK_MARGIN ref px from the bottom
 * and the screen's edge. The pack never moves between commandos; only what hangs on it changes.
 * @param {boolean} left Tab's mirrored side
 * @returns {{kx: number, ky: number, bounds: number[]}|null}
 */
export function packTuck(left = false) {
  if (tucks.has(left)) return tucks.get(left);
  let b = null;
  const add = (r) => { b = b ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] : r.slice(); };
  for (const [id, e] of Object.entries(ICON_MANIFEST)) {
    if (!id.startsWith('kit/') || id.endsWith('.left') !== left || !e.o) continue;
    const c = e.c || [0, 0, 1, 1];
    add([e.o[0] + c[0] * e.b[0], e.o[1] + c[1] * e.b[1], e.o[0] + c[2] * e.b[0], e.o[1] + c[3] * e.b[1]]);
    if (e.a) { // a stencilled count: up to four figures
      const ax = e.o[0] + e.a[0] * e.b[0], ay = e.o[1] + e.a[1] * e.b[1];
      add([ax - 13, ay - 6, ax + 13, ay + 6]);
    }
  }
  const t = b ? { kx: left ? TUCK_MARGIN - b[0] : BOX_W - TUCK_MARGIN - b[2], ky: BOX_H - TUCK_MARGIN - b[3], bounds: b } : null;
  tucks.set(left, t);
  return t;
}

export class Knapsack {
  constructor(hud, parent) {
    this.hud = hud;
    this.hand = tip(fromHTML(`<button type="button" class="hud-hand">${toolHTML('tool/hand') || GLYPHS.hand}<span class="lbl">Hand</span></button>`, null, parent), 'PICK UP / USE (H)');
    wireToolStates(this.hand);
    this.hand.addEventListener('click', () => hud.useHand());
    this.root = el('div', 'hud-knapsack', parent);
    this.left = false;
    this._packArt(); // the closed rucksack the kit hangs from
    this.passengers = el('div', 'passengers', this.root);
    this.pack = el('div', 'pack', this.root);
    // a click / tap on the pack off every silhouette: the nearest item within the slop (a fingertip is wide: BAG_TAP_SLOP)
    this.root.addEventListener('click', (e) => {
      if (e.target?.closest?.('button')) return;
      const k = this.root.getBoundingClientRect().width / 112 || 1;
      const hit = pickKit(this.hitAreas(), e.clientX, e.clientY, isTouchUI() ? BAG_TAP_SLOP : BAG_CLICK_SLOP_REF * k);
      if (hit) { e.stopPropagation(); hit.click(); }
    });
    this._preKey = '';
    this.sig = '';
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
    this._packArt();
  }

  /** The rucksack render under the kit: `kit/pack`, or its mirrored render `kit/pack.left` once Tab moved the column left. */
  _packArt() {
    const id = this.left && iconEntry('kit/pack.left') ? 'kit/pack.left' : 'kit/pack';
    const cur = this.root.querySelector(':scope > .packart');
    if (cur?.dataset.icon === id || !iconEntry(id)) return;
    cur?.remove();
    this.root.insertAdjacentHTML('afterbegin', iconHTML(id, { cls: 'packart' }));
    this._place(this.root.firstElementChild, iconEntry(id));
    this.sig = ''; // the kit layers (and the tuck) follow the side
  }

  /** Position an element on its kit layer's box (manifest o / b, ref px of the 112 x 149 knapsack box; it may spill out). */
  _place(node, e, rel = null) {
    if (!node || !e) return;
    const o = e.o || [0, 0];
    Object.assign(node.style, { position: 'absolute', left: R(o[0] - (rel ? rel[0] : 0)), top: R(o[1] - (rel ? rel[1] : 0)), width: R(e.b[0]), height: R(e.b[1]) });
  }

  /** Every item's silhouette in client px, its stacking order and its button (pickKit's input). */
  hitAreas() {
    return [...this.pack.querySelectorAll(':scope > .item')].map((b) => {
      const e = iconEntry(b.dataset.icon), r = b.getBoundingClientRect(), p = e?.p || [];
      const poly = [];
      for (let i = 0; i + 1 < p.length; i += 2) poly.push([r.left + p[i] * r.width, r.top + p[i + 1] * r.height]);
      return { el: b, z: Number(b.style.zIndex) || 0, poly };
    });
  }

  /** Fetch the kit layers of every commando of this mission once (the knapsack swaps between them without a pop). */
  _preload(w) {
    const key = w ? `${w.missionId || w.id || ''}|${w.commandos.length}|${this.left}` : '';
    if (!w || key === this._preKey) return;
    this._preKey = key;
    const ids = new Set([this.left ? 'kit/pack.left' : 'kit/pack']);
    for (const c of w.commandos) {
      for (const k of knapsackKit(knapsackView([{ ...c, selected: true, state: 'idle', hidden: false, buried: false }], w), { left: this.left, has: (id) => !!iconEntry(id) })) {
        if (k.art) ids.add(k.art);
        for (const u of k.units) ids.add(u);
      }
    }
    preloadIcons(undefined, undefined, (id) => ids.has(id));
  }

  update() {
    const w = this.hud.world;
    const sel = w ? w.commandos.filter((c) => c.selected && c.alive) : [];
    this._updateTransport(sel, w);
    this._preload(w);
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
    if (view.mode === 'occupant') { // only his photograph, pinned on the pack (click = get out)
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
      this._tuck();
      return;
    }
    const kit = knapsackKit(view, { left: this.left, has: (id) => !!iconEntry(id) });
    kit.forEach(({ it, art, units, tag }, i) => {
      const e = art ? iconEntry(art) : null;
      const b = el('button', 'item', this.pack);
      b.type = 'button';
      b.dataset.item = it.id;
      b.dataset.display = it.display;
      b.disabled = false; // keep hover tooltips on disabled items; `aria-disabled` + class instead
      b.classList.toggle('disabled', it.disabled);
      b.setAttribute('aria-disabled', String(it.disabled));
      if (it.ability && it.ability === targeting) b.classList.add('armed');
      if (e) {
        b.dataset.icon = art;
        this._place(b, e);
        b.style.zIndex = String(e.z ?? 1);
        b.insertAdjacentHTML('beforeend', iconHTML(art, { fb: `item/${it.item || it.id}` }));
        for (const uid of units) { // the extra rounds / bombs / charges, each its own pre-lit layer
          b.insertAdjacentHTML('beforeend', iconHTML(uid, { cls: 'unit' }));
          this._place(b.lastElementChild, iconEntry(uid), e.o);
        }
        // the hit area: the visible silhouette of the object (topmost wins where items overlap)
        const p = e.p || [];
        const hit = el('span', 'hit', b);
        if (p.length >= 6) hit.style.clipPath = `polygon(${Array.from({ length: p.length / 2 }, (_, k) => `${(p[2 * k] * 100).toFixed(2)}% ${(p[2 * k + 1] * 100).toFixed(2)}%`).join(', ')})`;
      } else { // no kit render for this item: its inline sketch in a corner of the pack (fallback only)
        Object.assign(b.style, { left: R(8 + (i % 3) * 32), top: R(110), width: R(28), height: R(28), zIndex: '20' });
        b.classList.add('sketch');
        b.innerHTML = ITEM_ICONS[it.item || it.id] || GLYPHS.star;
        el('span', 'hit', b);
      }
      el('span', 'lbl', b, it.label);
      if (it.rise) { // §3.4 shovel while buried: a stamped DIG OUT tag under it, one click / tap rises
        b.classList.add('rise');
        b.dataset.rise = it.disabled ? 'rising' : 'ready';
        this._tagAt(b, e, el('span', 'rise-tag', b, it.disabled ? 'RISING' : 'DIG OUT'), RISE_TAG.w, RISE_TAG.h);
      }
      tip(b, it.rise && !it.disabled ? `DIG OUT${it.key ? ` (${it.key})` : ''} — COME OUT OF THE ${view.units[0]?.dig?.surface === 'sand' ? 'SAND' : 'SNOW'}`
        : it.disabled ? `${it.label.toUpperCase()}: ${it.reason.toUpperCase()}` : `${it.label.toUpperCase()}${it.key ? ` (${it.key})` : ''}`);
      if (tag && !it.rise) this._count(b, e, tag);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.activate(it);
      });
    });
    this._tuck();
  }

  /**
   * Tuck the pack into the corner: move it and everything on it (not the knapsack box, so the hand and the notebook keep
   * their places) by the side's fixed shift (packTuck): the same place for every commando, every kit on screen.
   */
  _tuck() {
    const t = packTuck(this.left && !!iconEntry('kit/pack.left'));
    if (!t) return;
    this.root.style.setProperty('--kx', String(+t.kx.toFixed(2)));
    this.root.style.setProperty('--ky', String(+t.ky.toFixed(2)));
    this.tuck = t;
  }

  /**
   * Place a tag under the item's visible object (its hit polygon's bounding box), inside the knapsack box: `w` x `h` ref px.
   */
  _tagAt(b, e, t, w, h) {
    const o = e?.o || [0, 0], bw = e?.b?.[0] || 28, bh = e?.b?.[1] || 28, p = e?.p || [0, 0, 1, 1];
    let x0 = 1, x1 = 0, y1 = 0;
    for (let k = 0; k + 1 < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); y1 = Math.max(y1, p[k + 1]); }
    let x = o[0] + ((x0 + x1) / 2) * bw - w / 2, y = o[1] + y1 * bh + 0.5;
    x = Math.max(1, Math.min(BOX_W - 1 - w, x));
    y = Math.max(1, Math.min(BOX_H - 1 - h, y));
    Object.assign(t.style, { left: R(+(x - o[0]).toFixed(2)), top: R(+(y - o[1]).toFixed(2)), width: R(w), height: R(h) });
    return t;
  }

  /**
   * §6.4 counts that are not physical units (SMG bursts, first-aid doses, cigarettes, the Lee-Enfield's ∞, more rounds /
   * bombs / charges than the pack holds): the number is stencilled on the kit itself where the render says (manifest `a`:
   * the magazine pouch, the first-aid pouch, the webbing past the last loop, the charge's wrapper, the rifle's butt), in
   * paint that suits the surface (`pt`). A layer without an anchor falls back to the brass-on-leather tag under it.
   */
  _count(b, e, tag) {
    const text = tag.kind === 'infinite' ? '∞' : String(tag.n);
    if (e?.a) {
      const c = el('span', `count stencil ${tag.kind}`, b, text);
      c.dataset.paint = e.pt || 'dark';
      Object.assign(c.style, { left: R(+(e.a[0] * e.b[0]).toFixed(2)), top: R(+(e.a[1] * e.b[1]).toFixed(2)) });
      return;
    }
    const c = el('span', `count tag ${tag.kind === 'ticks' ? 'number' : tag.kind}`, b, text);
    this._tagAt(b, e, c, Math.max(TAG.minW, TAG.chrome + text.length * TAG.digit), TAG.h);
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
