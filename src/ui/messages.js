/**
 * Messages and subtitles (design-spec §6.5): one system message line top-centre under the bar (4 s), and bark
 * subtitles as small speech tags above the speaker for the line's duration (option "Subtitles", default ON).
 * German lines show the German text with an English gloss in italics. Commando barks also drive the talking
 * portrait + speaker card (§6.3); Laconic mode mutes acknowledgement barks and their animations.
 * @module ui/messages
 */

import { el } from './dom.js';
import { UI } from './ui-config.js';
import { ACK_KEYS, barkText } from './bark-lines.js';

export class Messages {
  constructor(hud) {
    this.hud = hud;
    this.line = el('div', 'hud-message', hud.root);
    this.line.hidden = true;
    this.until = 0;
    this.tags = [];
    this.layer = el('div', 'hud-subs', hud.root);
    this._n = 0;
    this.history = []; // last messages (tests / debugging)
  }

  /** System message line (4 s). */
  show(text, kind = 'info') {
    if (!text) return;
    this.line.textContent = String(text);
    this.line.dataset.kind = kind;
    this.line.hidden = false;
    this.line.classList.remove('pop');
    void this.line.offsetWidth;
    this.line.classList.add('pop');
    this.until = this.hud.clock + UI.messageTime;
    this.history.push({ text: String(text), kind, t: this.hud.clock });
    if (this.history.length > 20) this.history.shift();
  }

  /** `bark` event → subtitle tag + talking portrait. */
  bark(b) {
    if (b?.suppressed) return null; // AUDIO's voice director dropped it (cooldown / anti-spam): no subtitle
    const unit = b?.unit;
    const key = typeof b?.line === 'string' ? b.line : b?.line?.key;
    if (this.hud.options.voice === 'laconic' && ACK_KEYS.has(key) && unit?.faction !== 'enemy') return null;
    const res = barkText(b, this._n++);
    const words = res?.text ? res.text.split(/\s+/).length : 2;
    const dur = b?.duration || b?.line?.duration || Math.max(UI.barkMin, (res?.text?.length || 8) / UI.barkCharsPerSec, words * 0.35);
    if (unit && unit.faction !== 'enemy') this.hud.topbar.speak(unit, dur, b?.level ?? 1);
    if (!res || !this.hud.options.subtitles || !unit) return res;
    const tag = el('div', `hud-sub${res.german ? ' german' : ''}${unit.faction === 'enemy' ? ' enemy' : ''}`, this.layer);
    el('span', 'txt', tag, res.text);
    if (res.gloss) el('i', 'gloss', tag, res.gloss);
    // one tag per speaker
    this.tags = this.tags.filter((t) => {
      if (t.unit !== unit) return true;
      t.el.remove();
      return false;
    });
    this.tags.push({ el: tag, unit, until: this.hud.clock + dur });
    this._place(this.tags[this.tags.length - 1]);
    return res;
  }

  _place(t) {
    const u = t.unit;
    const p = this.hud.game.cameraController?.worldToScreen?.(u.x, (u.y || 0) + 2.1, u.z);
    if (!p) return;
    const r = this.hud.root.getBoundingClientRect();
    t.el.style.transform = `translate(${p.x - r.left}px, ${p.y - r.top}px) translate(-50%, -100%)`;
  }

  update() {
    const now = this.hud.clock;
    if (!this.line.hidden && now > this.until) this.line.hidden = true;
    this.tags = this.tags.filter((t) => {
      if (now > t.until || t.unit.removed) {
        t.el.remove();
        return false;
      }
      this._place(t);
      return true;
    });
  }

  clear() {
    this.line.hidden = true;
    for (const t of this.tags) t.el.remove();
    this.tags = [];
  }
}
