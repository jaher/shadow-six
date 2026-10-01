/**
 * In-mission touch controls (phones / tablets). Fingers on the game canvas are classified by input/gestures.js:
 *
 *   TAP               = a left click (engine/input.js Input.click): select a commando, walk to the ground, use the
 *                       armed item on a target, get into a vehicle; with a HUD tool (eye / camera / hand) armed the
 *                       tap goes to that tool. DOUBLE TAP = double-click (run; melee items run to the target).
 *   LONG PRESS        = a commando: add / remove him from the selection (Ctrl+click); an enemy: his vision cone;
 *                       the ground: the probe marker (Shift+click).
 *   ONE-FINGER DRAG   = pan the map 1:1 under the finger, coasting on release (never an order).
 *   TWO FINGERS       = pinch to zoom about the fingers' midpoint (spread = zoom in); moving both pans.
 *
 * Mouse and pen pointers are left to Input / CameraRig (desktop controls are unchanged). Panning follows the same
 * rules as the other user scrolling (frozen by the faithful pause, CameraRig.panLocked); zoom always works.
 * @module input/touch-game
 */

import { GestureClassifier } from './gestures.js';

/** Momentum: velocity decays by e^(-friction·t); below stopPxS the coast ends. */
export const TOUCH_PAN = { friction: 5, stopPxS: 20, maxPxS: 4000 };

export class TouchGame {
  /**
   * @param {import('../game.js').Game} game
   * @param {HTMLElement} domElement the game canvas
   */
  constructor(game, domElement) {
    this.game = game;
    this.domElement = domElement;
    this.enabled = true;
    this.gestures = new GestureClassifier();
    /** Pan momentum, CSS px/s (screen space). */
    this.velocity = { x: 0, y: 0 };
    this._pinchZoom = 1;
    /** Last gestures handled (tests / debugging): [{type, result?}]. */
    this.log = [];
    this._listeners = [];
    if (domElement) this._attach();
  }

  /** Is this pointer event a finger this module owns? */
  owns(e) {
    return this.enabled && e?.pointerType === 'touch';
  }

  get rig() {
    return this.game.cameraRig;
  }

  get cam() {
    return this.game.cameraController;
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  _attach() {
    const el = this.domElement;
    this._on(el, 'pointerdown', (e) => {
      if (!this.owns(e)) return;
      e.preventDefault();
      el.focus?.({ preventScroll: true });
      el.setPointerCapture?.(e.pointerId);
      this.handle(this.gestures.down(e.pointerId, e.clientX, e.clientY, performance.now()));
    });
    this._on(window, 'pointermove', (e) => {
      if (this.owns(e)) this.handle(this.gestures.move(e.pointerId, e.clientX, e.clientY, performance.now()));
    });
    this._on(window, 'pointerup', (e) => {
      if (!this.owns(e)) return;
      el.releasePointerCapture?.(e.pointerId);
      this.handle(this.gestures.up(e.pointerId, e.clientX, e.clientY, performance.now()));
    });
    this._on(window, 'pointercancel', (e) => {
      if (this.owns(e)) this.handle(this.gestures.cancel(e.pointerId));
    });
  }

  /** Act on classified gestures. */
  handle(events) {
    for (const ev of events) {
      const result = this[`_${ev.type}`]?.(ev);
      this.log.push({ type: ev.type, result: result ?? null, double: ev.double || undefined });
      if (this.log.length > 40) this.log.shift();
    }
  }

  get _active() {
    return !!this.game.input?.active;
  }

  _tap({ x, y, double }) {
    const input = this.game.input;
    if (!this._active || !input) return 'inactive';
    this.velocity.x = this.velocity.y = 0;
    // multi-view: a tap on an inactive view only activates it (as a click does, §2.3)
    const rig = this.rig;
    if (rig && rig.count > 1) {
      const i = rig.viewAt(x, y);
      if (i >= 0 && i !== rig.activeIndex) { rig.activate(i); return 'activate'; }
    }
    const tool = this.game.hud?.cursor;
    if (tool?.mode && tool.toolAt) return tool.toolAt(x, y);
    return input.click(x, y, { double });
  }

  _longpress({ x, y }) {
    const input = this.game.input;
    if (!this._active || !input || input.targeting || input.mode || this.game.hud?.cursor?.mode) return 'ignored';
    globalThis.navigator?.vibrate?.(12);
    const man = input.pickEntity(x, y, (u) => u.kind === 'commando' && u.alive);
    if (man) {
      input.select([man], { toggle: true });
      return man.selected ? 'select' : 'deselect';
    }
    return input.click(x, y, { shift: true }); // enemy → cone, ground → probe (§4.2)
  }

  _panstart() {
    this.velocity.x = this.velocity.y = 0;
    const cam = this.cam;
    if (cam?.tracking && !this.rig?.panLocked) cam.untrack(); // the finger takes the camera back
  }

  _pan({ dx, dy }) {
    if (!this._active || this.rig?.panLocked) return 'locked';
    this.cam.panScreen(-dx, -dy);
    return 'pan';
  }

  _panend({ vx, vy }) {
    if (!this._active || this.rig?.panLocked) return;
    const m = TOUCH_PAN.maxPxS, s = Math.hypot(vx, vy);
    const k = s > m ? m / s : 1;
    this.velocity.x = vx * k;
    this.velocity.y = vy * k;
  }

  _pinchstart() {
    this.velocity.x = this.velocity.y = 0;
    this._pinchZoom = this.cam?.zoom || 1;
  }

  _pinch({ scale, cx, cy, dx, dy }) {
    if (!this._active) return 'inactive';
    const cam = this.cam;
    if (!this.rig?.panLocked) {
      if (cam.tracking && (dx || dy)) cam.untrack();
      cam.panScreen(-dx, -dy);
    }
    return cam.zoomAt(this._pinchZoom * scale, cx, cy);
  }

  /** Per frame (real time): long-press timing and pan momentum. */
  update(dt) {
    this.handle(this.gestures.tick(performance.now()));
    const v = this.velocity;
    if (!v.x && !v.y) return;
    if (!this._active || this.rig?.panLocked || this.gestures.count) { v.x = v.y = 0; return; }
    this.cam.panScreen(-v.x * dt, -v.y * dt);
    const f = Math.exp(-TOUCH_PAN.friction * dt);
    v.x *= f;
    v.y *= f;
    if (Math.hypot(v.x, v.y) < TOUCH_PAN.stopPxS) v.x = v.y = 0;
  }

  /** Mission loaded / unloaded. */
  reset() {
    this.gestures = new GestureClassifier(this.gestures.cfg);
    this.velocity.x = this.velocity.y = 0;
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
  }
}
