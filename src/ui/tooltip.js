/**
 * Tooltips (design-spec §6.4): after 0.8 s over the same object, a black box with a thin light border and white
 * bold condensed uppercase text appears offset below-right. Sources: HUD elements with `data-tip`, and world
 * objects under the pointer (enemy type labels, vehicles, structures, "ESCAPE: TRUCK").
 * @module ui/tooltip
 */

import { el } from './dom.js';
import { UI } from './ui-config.js';
import { ENEMY_LABELS, THING_LABELS, ROLE_NAMES } from './catalogue.js';

/** Tooltip label for a world entity (null = none). */
export function entityLabel(e, world) {
  if (!e) return null;
  if (e.tooltip) return String(e.tooltip).toUpperCase();
  if (e.kind === 'enemy') return ENEMY_LABELS[e.soldierType] || ENEMY_LABELS[e.type] || ENEMY_LABELS[e.archetype] || 'SOLDIER';
  if (e.kind === 'commando') return (ROLE_NAMES[e.role] || e.nickname || 'COMMANDO').toUpperCase();
  const t = e.vehicleType || e.type || e.propType;
  const base = THING_LABELS[t] || (t ? String(t).replace(/[_-]/g, ' ').toUpperCase() : null);
  const ex = world?.extraction;
  if (base && ex && (ex.vehicleId === e.id || ex.vehicle === e.id || ex.target === e.tag)) return `ESCAPE: ${base}`;
  return base;
}

export class Tooltips {
  constructor(hud) {
    this.hud = hud;
    this.box = el('div', 'ui-tooltip', document.body);
    this.box.hidden = true;
    this.key = null;
    this.since = 0;
    this.x = 0;
    this.y = 0;
    this.target = null;
    this._move = (e) => {
      this.x = e.clientX;
      this.y = e.clientY;
      this.target = e.target;
    };
    window.addEventListener('pointermove', this._move, true);
  }

  /** What is under the pointer right now → {key, text}. */
  probe() {
    const t = this.target;
    const tipEl = t?.closest?.('[data-tip]');
    if (tipEl && (this.hud.root.contains(tipEl) || tipEl.closest('.ui-screen'))) return { key: tipEl, text: tipEl.dataset.tip };
    if (t?.tagName === 'CANVAS' && t.closest('#view') && this.hud.playing && !this.hud.cursor.mode) {
      let e = null;
      try {
        e = this.hud.game.input?.pickEntity?.(this.x, this.y, (q) => q.kind !== 'projectile' && !(q.kind === 'commando' && q.selected));
      } catch {
        e = null;
      }
      const text = entityLabel(e, this.hud.world);
      if (e && text) return { key: e, text };
    }
    return { key: null, text: '' };
  }

  update(dt) {
    const { key, text } = this.probe();
    if (key !== this.key || text !== this.text) {
      this.key = key;
      this.text = text;
      this.since = 0;
      this.box.hidden = true;
      return;
    }
    if (!key) return;
    this.since += dt;
    if (this.since >= UI.tooltipDelay && this.box.hidden) {
      this.box.textContent = text;
      this.box.hidden = false;
      const s = this.hud.scale || 1;
      const bw = this.box.offsetWidth, bh = this.box.offsetHeight;
      const x = Math.min(innerWidth - bw - 4, this.x + 14 * s), y = Math.min(innerHeight - bh - 4, this.y + 18 * s);
      this.box.style.left = `${Math.max(4, x)}px`;
      this.box.style.top = `${Math.max(4, y)}px`;
    }
  }

  /** Test hook: force the probe state (element with data-tip). */
  get visibleText() {
    return this.box.hidden ? '' : this.box.textContent;
  }

  dispose() {
    window.removeEventListener('pointermove', this._move, true);
    this.box.remove();
  }
}
