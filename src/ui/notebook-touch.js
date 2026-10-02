/**
 * Fingers on the notebook minimap (design-spec §6.4, §5.4). A phone has no hover: pointerenter / pointerleave fire
 * on finger down / up, so the desktop "hover opens, leaving closes" rule would keep the notebook open only while the
 * finger is held. With a finger (or pen) the notebook is a toggle instead:
 *
 *   CLOSED  any one-finger touch that lifts opens it; it STAYS open after the finger lifts.
 *   OPEN    TAP (moves < tapPx)  = close it again ("tap again hides it");
 *           ONE-FINGER DRAG       = move the view: the black view rectangle follows the finger (never closes);
 *           TWO FINGERS           = pinch to zoom the sketch (never zooms the page, never closes).
 *
 * A gesture that ever became a drag or a pinch can no longer end as a tap. The dog-ear (BRIEFING NOTES) is a plain
 * button and is not fed here. Pure (no DOM): Notebook turns the returned actions into setOpen / camera pans / zoom.
 * @module ui/notebook-touch
 */

/** A movement above tapPx CSS px turns a touch on the open page into a drag. */
export const NB_TOUCH = { tapPx: 10 };

/** Is this pointer a finger or a pen (no hover to rely on)? */
export function isFingerPointer(e) {
  return e?.pointerType === 'touch' || e?.pointerType === 'pen';
}

export class NotebookFingers {
  constructor(cfg = NB_TOUCH) {
    this.cfg = cfg;
    /** id → {x, y, x0, y0} */
    this.ptrs = new Map();
    /** null | 'press' | 'drag' | 'pinch' (the current gesture; 'spent' after a pinch until every finger lifts) */
    this.mode = null;
    this._dist = 0;
  }

  get count() {
    return this.ptrs.size;
  }

  _spread() {
    const [a, b] = [...this.ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  /**
   * A finger lands. @param {boolean} open is the notebook open now? @returns {Array<object>} actions
   */
  down(id, x, y, open) {
    if (this.ptrs.size >= 2) return []; // a third finger is ignored
    this.ptrs.set(id, { x, y, x0: x, y0: y });
    if (this.ptrs.size === 1) this.mode = 'press';
    else {
      this.mode = 'pinch';
      this._dist = this._spread();
    }
    return [];
  }

  /** A finger moves. @returns {Array<{type:'pan', dx, dy}|{type:'zoom', k}>} */
  move(id, x, y, open) {
    const p = this.ptrs.get(id);
    if (!p) return [];
    const dx = x - p.x, dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.mode === 'pinch') {
      if (this.ptrs.size < 2 || !open) return [];
      const d = this._spread(), k = d / this._dist;
      this._dist = d;
      return k !== 1 ? [{ type: 'zoom', k }] : [];
    }
    if (this.mode === 'press' && Math.hypot(x - p.x0, y - p.y0) > this.cfg.tapPx) {
      this.mode = 'drag';
      // the whole way from where the finger landed, so the rectangle stays under it
      return open ? [{ type: 'pan', dx: x - p.x0, dy: y - p.y0 }] : [];
    }
    if (this.mode === 'drag' && open && (dx || dy)) return [{ type: 'pan', dx, dy }];
    return [];
  }

  /** A finger lifts. @returns {Array<{type:'open'}|{type:'close'}>} */
  up(id, x, y, open) {
    if (!this.ptrs.has(id)) return [];
    const mode = this.mode;
    this.ptrs.delete(id);
    if (this.ptrs.size) {
      if (mode === 'pinch') this.mode = 'spent'; // the finger left after a pinch never taps
      return [];
    }
    this.mode = null;
    if (!open) return mode === 'press' || mode === 'drag' ? [{ type: 'open' }] : [];
    return mode === 'press' ? [{ type: 'close' }] : [];
  }

  /** The browser took the touch (pointercancel): nothing happens. */
  cancel(id) {
    if (!this.ptrs.delete(id)) return [];
    this.mode = this.ptrs.size ? 'spent' : null;
    return [];
  }

  reset() {
    this.ptrs.clear();
    this.mode = null;
  }
}
