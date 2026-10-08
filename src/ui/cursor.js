/**
 * Software cursor layer (design-spec §5.3). Draws the context cursor over the game view (the native cursor is
 * hidden there; over the HUD the plain arrow is used). Sources, highest priority first:
 *  1. UI tool modes: 'track' (camera icon, 4 orange arrows), 'eye' (eye icon or Shift; blinks 2 Hz over an
 *     enemy), 'hand' (H: open hand with forbidden overlay → animated grab over something to take);
 *  2. the input's targeting ability (knife, pistol, scope 88 px red/ok, crosshair, syringe, cap, …) with the
 *     red forbidden overlay when `input.cursor === 'forbidden'`;
 *  3. hover context: with the Sapper selected, the grabbing hand over a placed charge (click → he takes it back, house
 *     rule recoverCharges); the eye over an enemy soldier (click → his vision cone, with or without men selected); with
 *     men selected: activation (operable thing), climbing pick (GB over a climbable), move.
 * Also shows the 0.6 s twin-star destination sparkle for 'ui:move-marker'.
 * The sniper scope is a live 2× magnifier (render/scope-magnifier.js draws the world into the glass right after
 * the frame, from `lensState()`); this layer then swaps the scope sprite for the clear ring + the reticle and the
 * range read-out. The reticle is always dark; no shot shows as a dark circle-and-slash mark, greyed "NO SHOT" range
 * text and a dimmed, desaturated glass. Without WebGL the plain sprite stays.
 * @module ui/cursor
 */

import { perception } from '../ai/perception.js';
import { ABILITIES } from '../abilities/index.js';
import { el } from './dom.js';
import { CURSORS, FORBIDDEN, SPARKLE, cursorArt, spriteFor } from './cursor-sprites.js';
import { iconEntry, iconHTML } from './icon-art.js';
import { UI } from './ui-config.js';
import { boardingHint } from '../abilities/drive.js';
import { glassRadius } from '../render/scope-magnifier.js';

/** Scope reticle (88-unit box, glass r 36): BEL's three heavy posts, a fine cross with mil-dots and holdover marks.
 *  Always near-black like an etched optical reticle (never tinted by the shot state; user request 2026-09-30). */
export const RETICLE_INK = '#0d0e0c';
const RETICLE = (() => {
  const c = RETICLE_INK;
  let d = '';
  for (const k of [-10, -5, 5, 10]) d += `<circle cx="${44 + k}" cy="44" r="0.75"/><circle cx="44" cy="${44 + k}" r="0.75"/>`;
  const marks = [[49, 3], [54, 2.2], [58, 1.5]].map(([y, w]) => `<path d="M${44 - w} ${y}h${2 * w}"/>`).join('');
  return `<svg class="ret" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" fill="${c}" stroke="${c}">`
    + `<path d="M8 44h22M58 44h22M44 58v22" stroke-width="2.6" stroke-linecap="butt"/>`
    + `<path d="M30 44h28M44 8v50" stroke-width="0.7"/><g stroke-width="0.6">${marks}</g><g stroke="none">${d}<circle cx="44" cy="44" r="0.9"/></g>`
    // no shot: a small dark circle-and-slash etched in the lower-right of the glass (shown by .bad only)
    + `<g class="ns" fill="none" stroke-width="1.3"><circle cx="63" cy="63" r="4.2"/><path d="M60 66l6-6"/></g></svg>`;
})();
const isView = (t) => !!t && (t.tagName === 'CANVAS' && !!t.closest?.('#view'));

export class CursorLayer {
  constructor(hud) {
    this.hud = hud;
    this.mode = null; // 'eye' | 'track' | 'hand' | null
    this.root = el('div', 'ui-cursor', document.body);
    this.sprite = el('div', 'spr', this.root);
    this.forb = el('div', 'forb', this.root);
    this.forb.innerHTML = iconHTML('cursor/forbidden') || FORBIDDEN;
    this.root.hidden = true;
    this.markers = [];
    this.pos = { x: -1, y: -1, over: false };
    this.shift = false;
    this.current = 'arrow';
    this.lens = null; // scope magnifier DOM (ring, reticle, range), built on first use
    this._pre = null; // resolve() result computed for the magnifier earlier in this frame
    this._on(window, 'pointermove', (e) => {
      this.pos = { x: e.clientX, y: e.clientY, over: isView(e.target) };
    }, true);
    this._on(window, 'keydown', (e) => { if (e.key === 'Shift') this.shift = true; }, true);
    this._on(window, 'keyup', (e) => { if (e.key === 'Shift') this.shift = false; }, true);
    this._on(window, 'blur', () => { this.shift = false; });
    this._on(window, 'pointerdown', (e) => this._pointerDown(e), true);
    this._on(window, 'contextmenu', (e) => { if (this.mode && isView(e.target)) e.preventDefault(); }, true);
  }

  _on(t, type, fn, capture) {
    t.addEventListener(type, fn, capture);
    (this._offs ||= []).push(() => t.removeEventListener(type, fn, capture));
  }

  setMode(mode) {
    this.mode = mode || null;
    document.body.dataset.uiTool = this.mode || '';
    if (mode) this.hud.game.input?.cancelTargeting?.();
  }

  /** Entity under the pointer (via the input's picker), optionally filtered. */
  pick(filter) {
    if (!this.pos.over) return null;
    try {
      return this.hud.game.input?.pickEntity?.(this.pos.x, this.pos.y, filter) || null;
    } catch {
      return null;
    }
  }

  _pointerDown(e) {
    // CORE2 Input owns Shift+click (enemy → its cone; ground → game.probe: red ring + covering cone, §4.2/§5.2)
    if (!this.mode && e.shiftKey && e.button === 0 && typeof this.hud.game.probe === 'function') return;
    if (!this.mode && e.shiftKey && e.button === 0 && isView(e.target) && this.hud.playing && !this.hud.game.input?.targeting) {
      // §4.2 probe marker: Shift+click shows the cone of the first enemy whose cone covers that ground point
      if (this.hud.game.input?.canInspect === false) return; // §6.8
      const gp = this.hud.game.cameraController?.screenToGround?.(e.clientX, e.clientY);
      const en = gp && this.hud.world ? perception.probe(this.hud.world, gp.x, gp.z) : null;
      if (en) {
        e.stopPropagation();
        e.preventDefault();
        this.hud.game.toggleCone?.(en, true);
      }
      return;
    }
    if (!this.mode || !isView(e.target) || !this.hud.playing) return;
    // a finger may still pan / pinch with a tool armed: input/touch-game.js calls toolAt() on a TAP
    if (e.pointerType === 'touch' && this.hud.game.input?.touch?.enabled) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.button === 2) return this.setMode(null); // right-click leaves the tool
    this.toolAt(e.clientX, e.clientY);
  }

  /** Use the armed UI tool (eye / track / hand) at a client point (a click, or a tap on a touch screen). */
  toolAt(x, y) {
    if (!this.mode || !this.hud.playing) return 'none';
    const g = this.hud.game;
    this.pos = { x, y, over: true };
    if (this.mode === 'eye') {
      if (g.input && g.input.canInspect === false) return 'refused'; // §6.8: no cone inspection while paused (faithful)
      const en = this.pick((q) => q.kind === 'enemy' && q.alive !== false);
      if (en) g.toggleCone?.(en);
      return en ? 'cone' : 'none';
    } else if (this.mode === 'track') {
      const u = this.pick((q) => (q.kind === 'enemy' || q.kind === 'commando' || q.kind === 'vehicle') && q.alive !== false);
      if (u) {
        this.hud.track(u);
        this.setMode(null);
      }
      return u ? 'track' : 'none';
    } else if (this.mode === 'hand') {
      const t = this.pick(grabbable);
      if (!t) this.hud.message('There is nothing to pick up there.', 'info');
      else this.hud.handOn(t);
      this.setMode(null);
      return t ? 'hand' : 'none';
    }
    return 'none';
  }

  /** Sprite id + forbidden flag for the current frame. */
  resolve() {
    const g = this.hud.game, input = g.input, w = this.hud.world;
    const now = this.hud.clock;
    if (!this.pos.over || !this.hud.playing) return { id: 'arrow', native: true };
    const mode = this.mode || (this.shift ? 'eye' : null);
    if (mode === 'track') return { id: 'track' };
    if (mode === 'eye') {
      const on = !!this.pick((q) => q.kind === 'enemy' && q.alive !== false);
      return { id: 'eye', blink: on && Math.floor(now * UI.eyeBlinkHz * 2) % 2 === 1 };
    }
    if (mode === 'hand') {
      const t = this.pick(grabbable);
      // a placed charge: only a selected Sapper may take it back (house rule recoverCharges)
      const ok = t && (t.interactKind !== 'bomb' || (w?.commandos || []).some((c) => c.selected && c.alive && ABILITIES.takeCharge?.canUse?.(c, t, w) === true));
      return ok ? { id: Math.floor(now * 4) % 2 ? 'grab' : 'hand' } : { id: 'hand', forbidden: true };
    }
    const tg = input?.targeting;
    if (tg) {
      let id = spriteFor(tg.def?.cursor && tg.def.cursor !== 'target' ? tg.def.cursor : tg.abilityId);
      if (id === 'fist') id = fistVariant(tg.abilityId); // BCD knock-outs: bare fist, the Driver's blackjack, the Spy's pad
      return { id, forbidden: input.cursor === 'forbidden' };
    }
    // over a placed charge with the Sapper selected (house rule recoverCharges): the grabbing hand — a click sends him to
    // take it back (engine/input.js chargeAt; the same order as H on it); refused (forbidden overlay) when he can't now
    const ch = input?.chargeAt?.(this.pos.x, this.pos.y);
    if (ch) {
      const ok = ABILITIES.takeCharge?.canUse?.(ch.sapper, ch.charge, w);
      return ok === true ? { id: Math.floor(now * 4) % 2 ? 'grab' : 'hand' } : { id: 'hand', forbidden: true };
    }
    // over an enemy soldier with no item armed: the eye — a click shows his vision cone (user 2026-10-07 "there should
    // be an eye icon, when mouse is positioned over a soldier (the same way there is for knife, gun, etc)").
    // Refused (forbidden overlay) where cone inspection is (§6.8 paused).
    if (this.pick((q) => q.kind === 'enemy' && q.alive !== false)) return { id: 'eye', look: true, forbidden: input?.canInspect === false };
    const sel = w?.commandos.filter((c) => c.selected && c.alive) || [];
    if (!sel.length) return { id: 'arrow', native: true };
    // (a charge is no lever: without the Sapper a click on it only walks there)
    const hover = this.pick((q) => (q.kind === 'interactable' && q.interactKind !== 'bomb') || q.kind === 'vehicle');
    if (hover) {
      if (hover.climbable || hover.type === 'climbable') return sel.some((c) => c.role === 'greenberet') ? { id: 'climb' } : { id: 'climb', forbidden: true };
      // a vehicle nobody selected may get into (the Marine must board the raft first, full, crewed): refused cursor
      if (hover.kind === 'vehicle') { const h = boardingHint(hover, sel, w); return { id: 'activate', forbidden: !!h && !h.ok }; }
      return { id: 'activate' };
    }
    return { id: 'move' };
  }

  /**
   * Scope magnifier input for this frame (game.render calls it right after the world frame, before the HUD
   * update): null unless the sniper scope cursor is up over the game view. Valid shot → the enemy under the
   * cursor is passed for the highlight. Touch (long-press aim) only needs `pos` set, like the pointer.
   * @returns {{x:number, y:number, radius:number, bad:boolean, target:any, time:number, sway:boolean, range:number|null}|null}
   */
  lensState() {
    const r = (this._pre = this.resolve());
    if (r.id !== 'scope' || r.native) return (this._lens = null);
    const input = this.hud.game.input, tg = input?.targeting;
    let target = null;
    try { target = tg ? input.resolveTarget?.(tg.def, this.pos.x, this.pos.y, tg.commando) || null : null; } catch { target = null; }
    if (target && target.kind !== 'enemy') target = null;
    const c = tg?.commando;
    const gp = target || this.hud.game.cameraController?.screenToGround?.(this.pos.x, this.pos.y);
    const range = c && gp ? Math.hypot(gp.x - c.x, gp.z - c.z) : null;
    return (this._lens = {
      x: this.pos.x, y: this.pos.y, radius: glassRadius(this.hud.scale || 1), bad: !!r.forbidden, target, range,
      time: this.hud.clock || 0, sway: !this.hud.kit?.reducedMotion,
    });
  }

  /**
   * Aim point from a non-mouse source (touch long-press aim, gamepad): the scope, its magnifier and the hover
   * cursors all read `pos`, so this is the whole API. @param {number} x client px @param {number} y client px
   */
  setAim(x, y, over = true) {
    this.pos = { x, y, over: !!over };
  }

  /** Lens DOM: the clear scope ring, the reticle and the range read-out (shown while the magnifier draws). */
  _lensDom() {
    const s = this.hud.scale || 1;
    if (this.lens?.scale === s) return this.lens;
    this.lens?.root.remove(); // HUD scale changed: rebuild for the right ring srcset
    const root = el('div', 'lens', this.root);
    root.innerHTML = (iconHTML('cursor/scope.ring', { scale: s }) || '') + RETICLE;
    const rng = el('div', 'rng', root);
    this.lens = { root, rng, text: '', scale: s };
    return this.lens;
  }

  update() {
    const r = this._pre || this.resolve();
    this._pre = null;
    const show = !r.native;
    this.root.hidden = !show;
    document.body.classList.toggle('ui-softcursor', show);
    if (show) {
      if (this.current !== r.id || this._scale !== (this.hud.scale || 1)) {
        this.current = r.id;
        this._sprite(r.id);
      }
      const scope = r.id === 'scope';
      this.root.classList.toggle('bad', !!r.forbidden);
      this.forb.hidden = !r.forbidden || scope; // the scope turns red instead
      this.root.classList.toggle('blink', !!r.blink);
      this._lensUpdate(scope);
      this.root.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
    } else {
      this.current = 'arrow';
      this._lensUpdate(false);
    }
    this._markers();
  }

  /** Magnifier on: ring + reticle replace the opaque scope sprite; range / NO SHOT read-out. */
  _lensUpdate(scope) {
    const L = this._lens, on = !!(scope && L && this.hud.game.scopeMagnifier?.stats?.drawn);
    this.root.classList.toggle('lens', on);
    if (!on) {
      if (this.lens) this.lens.root.hidden = true;
      return;
    }
    const d = this._lensDom();
    d.root.hidden = false;
    const m = L.range == null ? '' : `${Math.round(L.range)} m`;
    const text = L.bad && L.target ? `NO SHOT${m ? ` · ${m}` : ''}` : m;
    if (text !== d.text) d.rng.textContent = d.text = text;
  }

  /** Show sprite `id`: the rendered cursor (+ its blink / out-of-range frame), else the SVG sketch. */
  _sprite(id) {
    const art = cursorArt(id) || cursorArt('target');
    // cursors are 32 ref px (the scope 88), scaled with the HUD (review: a fixed 32-CSS-px cursor was half the HUD's
    // scale at 1080p and a third of it at 4K)
    const s = (this._scale = this.hud.scale || 1);
    const k = (UI.cursorSize / 32) * s;
    this.root.dataset.cursor = id;
    this.root.style.setProperty('--cs', String(s));
    if (art) {
      this.sprite.innerHTML = iconHTML(art.art, { fb: `cursor/${id}`, scale: s }) + (art.alt ? iconHTML(art.alt, { cls: 'alt', scale: s }) : '');
      this.root.style.setProperty('--cw', `${art.box[0] * k}px`);
      this.root.style.setProperty('--ch', `${art.box[1] * k}px`);
      this.root.style.setProperty('--hx', `${art.hot[0] * k}px`);
      this.root.style.setProperty('--hy', `${art.hot[1] * k}px`);
      return;
    }
    const spec = CURSORS[id] || CURSORS.target;
    const size = (spec.size || UI.cursorSize) * s;
    this.sprite.innerHTML = spec.svg;
    this.root.style.setProperty('--cw', `${size}px`);
    this.root.style.setProperty('--ch', `${size}px`);
    this.root.style.setProperty('--hx', `${(spec.hot[0] / (spec.size || 32)) * size}px`);
    this.root.style.setProperty('--hy', `${(spec.hot[1] / (spec.size || 32)) * size}px`);
  }

  /** §5.3 destination sparkle at a world point for 0.6 s (two rendered frames, BEL ESTRELLA1/2). */
  marker(x, z) {
    const m = el('div', 'ui-sparkle', this.hud.root);
    m.innerHTML = iconEntry('cursor/sparkle.a') ? iconHTML('cursor/sparkle.a', { fb: 'cursor/sparkle' }) + iconHTML('cursor/sparkle.b', { cls: 'alt', fb: 'cursor/sparkle' }) : SPARKLE;
    this.markers.push({ m, x, z, until: this.hud.clock + UI.moveMarkerTime });
  }

  _markers() {
    const now = this.hud.clock;
    this.markers = this.markers.filter((k) => {
      if (now > k.until) {
        k.m.remove();
        return false;
      }
      const p = this.hud.game.cameraController?.worldToScreen?.(k.x, 0, k.z);
      if (p) k.m.style.transform = `translate(${p.x}px, ${p.y}px)`;
      k.m.classList.toggle('alt', Math.floor(now * 10) % 2 === 0);
      return true;
    });
  }

  dispose() {
    for (const off of this._offs || []) off();
    this.root.remove();
    document.body.classList.remove('ui-softcursor');
  }
}

/** Knock-out cursor per BCD ability (rendered fist variants). */
export function fistVariant(abilityId = '') {
  if (/club|blackjack/i.test(abilityId)) return 'fist.blackjack';
  if (/chloro/i.test(abilityId)) return 'fist.chloroform';
  return 'fist';
}

/** Things the hand can take or operate (§5.3 pick-up hand). */
export function grabbable(q) {
  if (q.kind === 'interactable') return q.type !== 'climbable';
  if (q.kind === 'enemy' || q.kind === 'commando') return q.alive === false || q.state === 'stunned' || q.state === 'bound';
  return false;
}
