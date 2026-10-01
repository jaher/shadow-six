/**
 * Software cursor layer (design-spec §5.3). Draws the context cursor over the game view (the native cursor is
 * hidden there; over the HUD the plain arrow is used). Sources, highest priority first:
 *  1. UI tool modes: 'track' (camera icon, 4 orange arrows), 'eye' (eye icon or Shift; blinks 2 Hz over an
 *     enemy), 'hand' (H: open hand with forbidden overlay → animated grab over something to take);
 *  2. the input's targeting ability (knife, pistol, scope 88 px red/ok, crosshair, syringe, cap, …) with the
 *     red forbidden overlay when `input.cursor === 'forbidden'`;
 *  3. hover context with men selected: activation (operable thing), climbing pick (GB over a climbable), move.
 * Also shows the 0.6 s twin-star destination sparkle for 'ui:move-marker'.
 * @module ui/cursor
 */

import { perception } from '../ai/perception.js';
import { el } from './dom.js';
import { CURSORS, FORBIDDEN, SPARKLE, cursorArt, spriteFor } from './cursor-sprites.js';
import { iconEntry, iconHTML } from './icon-art.js';
import { UI } from './ui-config.js';

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
      return t ? { id: Math.floor(now * 4) % 2 ? 'grab' : 'hand' } : { id: 'hand', forbidden: true };
    }
    const tg = input?.targeting;
    if (tg) {
      let id = spriteFor(tg.def?.cursor && tg.def.cursor !== 'target' ? tg.def.cursor : tg.abilityId);
      if (id === 'fist') id = fistVariant(tg.abilityId); // BCD knock-outs: bare fist, the Driver's blackjack, the Spy's pad
      return { id, forbidden: input.cursor === 'forbidden' };
    }
    const sel = w?.commandos.filter((c) => c.selected && c.alive) || [];
    if (!sel.length) return { id: 'arrow', native: true };
    const hover = this.pick((q) => q.kind === 'interactable' || q.kind === 'vehicle');
    if (hover) {
      if (hover.climbable || hover.type === 'climbable') return sel.some((c) => c.role === 'greenberet') ? { id: 'climb' } : { id: 'climb', forbidden: true };
      return { id: 'activate' };
    }
    return { id: 'move' };
  }

  update() {
    const r = this.resolve();
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
      this.root.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
    } else this.current = 'arrow';
    this._markers();
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
