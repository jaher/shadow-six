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

/** In-mission HUD chrome a finger may rest on while the other one pinches the map. */
export const HUD_CHROME = '.hud-topbar, .hud-right, .hud-right-bottom, .hud-transport, .hud-speaker-card, .touch-menu, .touch-cancel';

/**
 * Momentum: velocity decays by e^(-friction·t); below stopPxS the coast ends. A tap that lands while the map coasts
 * (or within stopTapMs of the coast ending) only stops the map: it is used up and gives no order.
 */
export const TOUCH_PAN = { friction: 5, stopPxS: 20, maxPxS: 4000, stopTapMs: 150 };

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
    /** performance.now() when the map last coasted (-inf: never); the touch that stops a coast never taps. */
    this._coastT = -Infinity;
    this._stopTap = false;
    /** Touch pointers down on the HUD chrome: id → {x, y, joined (fed to the classifier as half of a pinch)}. */
    this._hudFingers = new Map();
    this._eatClickUntil = 0;
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
      const t = performance.now();
      this.touchDown(t);
      // a finger already resting on the HUD makes this one a pinch (it joins first, where it is now)
      for (const [id, p] of this._hudFingers) if (!p.joined && this.gestures.count < 2) {
        p.joined = true;
        this.handle(this.gestures.down(id, p.x, p.y, t));
      }
      this.handle(this.gestures.down(e.pointerId, e.clientX, e.clientY, t));
    });
    // fingers on the in-mission HUD chrome (bag, top bar, MENU …): a tap there stays the HUD's, but together with a
    // finger on the map it is the other half of a pinch (capture: the HUD buttons stop their pointerdowns)
    this._on(window, 'pointerdown', (e) => {
      if (!this.owns(e)) return;
      this._eatClickUntil = 0; // a new touch: the click left over from a pinch (if any) has passed
      if (e.target === el || !this._active || !e.target?.closest?.(HUD_CHROME)) return;
      const p = { x: e.clientX, y: e.clientY, joined: false };
      this._hudFingers.set(e.pointerId, p);
      if (this.gestures.count === 1) {
        p.joined = true;
        this.handle(this.gestures.down(e.pointerId, e.clientX, e.clientY, performance.now()));
      }
    }, { capture: true });
    this._on(window, 'pointermove', (e) => {
      if (!this.owns(e)) return;
      const p = this._hudFingers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      this.handle(this.gestures.move(e.pointerId, e.clientX, e.clientY, performance.now()));
    });
    this._on(window, 'pointerup', (e) => {
      if (!this.owns(e)) return;
      el.releasePointerCapture?.(e.pointerId);
      this._hudFingerUp(e.pointerId);
      this.handle(this.gestures.up(e.pointerId, e.clientX, e.clientY, performance.now()));
    });
    this._on(window, 'pointercancel', (e) => {
      if (!this.owns(e)) return;
      this._hudFingerUp(e.pointerId);
      this.handle(this.gestures.cancel(e.pointerId));
    });
    // the HUD finger of a pinch must not press the button it lifts from
    this._on(window, 'click', (e) => {
      if (performance.now() < this._eatClickUntil) { e.stopPropagation(); e.preventDefault(); this._eatClickUntil = 0; }
    }, { capture: true });
  }

  _hudFingerUp(id) {
    const p = this._hudFingers.get(id);
    if (!p) return;
    this._hudFingers.delete(id);
    if (p.joined) this._eatClickUntil = performance.now() + 600;
  }

  /** Act on classified gestures. */
  handle(events) {
    for (const ev of events) {
      const result = this[`_${ev.type}`]?.(ev);
      this.log.push({ type: ev.type, result: result ?? null, double: ev.double || undefined });
      if (this.log.length > 40) this.log.shift();
    }
  }

  /**
   * A finger is about to touch down (before the classifier sees it). The first finger on a coasting map stops it,
   * and a tap with that finger is then used up instead of becoming an order.
   */
  touchDown(t) {
    if (this.gestures.count) return;
    const v = this.velocity;
    this._stopTap = !!(v.x || v.y) || t - this._coastT < TOUCH_PAN.stopTapMs;
    if (this._stopTap) this._coastT = -Infinity; // stopped by the finger: the next touch is a fresh one
    v.x = v.y = 0;
  }

  get _active() {
    return !!this.game.input?.active;
  }

  _tap({ x, y, double }) {
    const input = this.game.input;
    if (!this._active || !input) return 'inactive';
    this.velocity.x = this.velocity.y = 0;
    if (this._stopTap) {
      // this tap stopped the coasting map: no order, and it does not start a double tap either
      this._stopTap = false;
      this.gestures._lastTap = null;
      return 'stop';
    }
    // multi-view: a tap on an inactive view only activates it (as a click does, §2.3)
    const rig = this.rig;
    if (rig && rig.count > 1) {
      const i = rig.viewAt(x, y);
      if (i >= 0 && i !== rig.activeIndex) { rig.activate(i); return 'activate'; }
    }
    const tool = this.game.hud?.cursor;
    if (tool?.mode && tool.toolAt) return tool.toolAt(x, y);
    return input.click(x, y, { double, touch: true });
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
    if (vx || vy) this._coastT = performance.now();
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
    this._coastT = performance.now();
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
    this._coastT = -Infinity;
    this._stopTap = false;
    this._hudFingers.clear();
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
  }
}
