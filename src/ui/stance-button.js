/**
 * Stance button (bottom HUD, immediately left of the hand): one big toggle between standing and crawling for the
 * selection (= C / S). It shows the posture a click switches TO: a man crawling while the selection is upright, a
 * man standing while it crawls. Disabled when nothing is selected or nobody in the selection can change stance
 * (in a vehicle, hidden, buried, downed, carrying a body, mid uninterruptible action, diving gear on...).
 * @module ui/stance-button
 */

import { fromHTML, tip } from './dom.js';
import { GLYPHS } from './icons.js';
import { applyToolState, iconEntry, toolHTML, wireToolStates } from './icon-art.js';

export const STANCE_TIP = 'LIE DOWN / STAND UP (C / S)';

/** Can `c` switch to `stance` right now (mirrors Commando.issue('stance') / setStance refusals)? */
export function canTakeStance(c, stance) {
  if (!c || !c.alive || c.downed) return false;
  if (c.state === 'inVehicle' || c.vehicle || c.buried || c.hidden || c.state === 'jailed' || c.state === 'captured' || c.state === 'carried') return false;
  if (c.diving || c.stance === 'dive' || c.underwater) return false;
  if (c.currentAction && c.currentAction.interruptible === false) return false;
  if (stance === 'crawl' && (c.carrying || c.noCrawl)) return false;
  if (stance === 'crawl' && c.world?.groundAt) {
    const g = c.world.groundAt(c.x, c.z);
    if (g && (g.water || g.shallow)) return false; // can't lie down in water
  }
  return true;
}

/**
 * What the button shows for a selection (pure; unit-tested).
 * @param {object[]} sel selected, alive commandos
 * @returns {{to: 'crawl'|'stand', icon: string, disabled: boolean}} `to` = the stance a click asks for (same rule as
 *   HUD.togglePosture: everyone crawling → stand, else crawl); `icon` = the figure shown (the posture you switch TO)
 */
export function stanceButtonState(sel) {
  const list = (sel || []).filter((c) => c && c.alive);
  const to = list.length > 0 && list.every((c) => c.stance === 'crawl') ? 'stand' : 'crawl';
  const disabled = !list.some((c) => c.stance !== to && canTakeStance(c, to));
  return { to, icon: `tool/stance.${to}`, disabled };
}

export class StanceButton {
  /**
   * @param {import('./hud.js').HUD} hud
   * @param {HTMLElement} parent the bottom-right HUD cluster; the button goes first (left of the hand)
   */
  constructor(hud, parent) {
    this.hud = hud;
    this.el = tip(fromHTML('<button type="button" class="hud-stance"><span class="lbl">Stance</span></button>', null, parent), STANCE_TIP);
    parent.prepend(this.el);
    this.el.setAttribute('aria-label', 'Lie down / stand up');
    // a HUD button: never let the press fall through to the map (move order / pan on touch)
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.getAttribute('aria-disabled') === 'true') return;
      hud.togglePosture();
    });
    wireToolStates(this.el);
    this._icon = '';
    this.update();
  }

  update() {
    const s = stanceButtonState(this.hud.playing ? this.hud.selection : []);
    if (s.icon !== this._icon) {
      this._icon = s.icon;
      const lbl = this.el.querySelector('.lbl');
      this.el.innerHTML = iconEntry(s.icon) ? toolHTML(s.icon) : GLYPHS[s.to === 'crawl' ? 'prone' : 'stand'];
      if (lbl) this.el.append(lbl);
      this.el.dataset.to = s.to;
    }
    const dis = s.disabled ? 'true' : 'false';
    if (this.el.getAttribute('aria-disabled') !== dis || this._shown !== s.icon) {
      this.el.setAttribute('aria-disabled', dis);
      this._shown = s.icon;
      applyToolState(this.el); // only when the figure or the enabled state changes (pointer states re-apply themselves)
    }
  }
}
