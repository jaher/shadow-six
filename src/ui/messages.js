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

/**
 * Replay an element's CSS pop animation: switch between `name` and `name`2 (the same keyframes under two names: a new
 * animation-name starts it over). The old way — class off, `offsetWidth`, class on — forced a whole page layout at each
 * call, in the middle of the sim tick that posted the message (M3's bunker blast: three messages, ~0.6 ms each).
 */
function restartPop(el, name) {
  const two = `${name}2`, next = el._popShown === name ? two : name;
  el.classList.remove(name, two);
  el.classList.add(next);
  el._popNext = next;
}
/** Called once a frame (Messages.update): what the page now shows, so the next restartPop switches away from it. */
function shownPop(el) { if (el._popNext) el._popShown = el._popNext; }

export class Messages {
  constructor(hud) {
    this.hud = hud;
    this.line = el('div', 'hud-message', hud.root);
    this.line.hidden = true;
    this.until = 0;
    this.tags = [];
    this.marks = []; // "?" over a guard who heard a running commando (house rule runningNoise)
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
    restartPop(this.line, 'pop');
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
    this._placeSoon(this.tags[this.tags.length - 1]);
    return res;
  }

  /**
   * Place a new tag now — or, from inside a sim tick (game.inStep), on the HUD's next update: its placement reads the
   * page layout (the speaker's screen point, the tags' sizes), and a read after the tick's DOM writes forces a whole
   * layout in the middle of the tick (M3's bunker blast: ~0.4 ms a bark). Hidden until then: a frame later, in place.
   */
  _placeSoon(t) {
    if (!this.hud.game?.inStep) return this._place(t);
    if (!t.unplaced) { t.unplaced = true; t.el.style.visibility = 'hidden'; }
  }

  _place(t) {
    const u = t.unit;
    const p = this.hud.game.cameraController?.worldToScreen?.(u.x, (u.y || 0) + 2.1, u.z);
    if (!p) { t._rect = null; return; }
    const r = this.hud.root.getBoundingClientRect();
    const px = p.x - r.left, py = p.y - r.top;
    let lift = 0;
    if (t.mark) {
      // a "?" mark sits above the guard's subtitle tag when he has one (above its stacked place too)
      const s = this.tags.find((s) => s.unit === u);
      lift = s ? (s._lift || 0) + s.el.offsetHeight : 0;
    } else {
      // Speech tags are centred on the speaker's head, and two men talking face to face (the Spy
      // distracting a guard, §3.4) stand 1.5 m apart: their tags land in the same band and cover each
      // other. Stack a tag above any other speaker's tag it would overlap — the same lift the "?" mark
      // takes over its own guard's tag, applied between speakers. update() places tags oldest first, so
      // the first speaker keeps the low slot and the stack is stable while both lines run.
      const w = t.el.offsetWidth, h = t.el.offsetHeight, x0 = px - w / 2, x1 = px + w / 2;
      for (let n = 0; n < this.tags.length; n++) {
        let raised = false;
        for (const s of this.tags) {
          if (s === t || s.unit === u || !s._rect) continue;
          if (x0 < s._rect.x1 && s._rect.x0 < x1 && py - lift - h < s._rect.bot && s._rect.top < py - lift) {
            lift = Math.max(lift, py - s._rect.top); raised = true;
          }
        }
        if (!raised) break;
      }
      t._rect = { x0, x1, top: py - lift - h, bot: py - lift };
    }
    t._lift = lift;
    t.el.style.transform = `translate(${px}px, ${py - lift}px) translate(-50%, -100%)`;
    if (t.unplaced) { t.unplaced = false; t.el.style.visibility = ''; }
  }

  /**
   * A "?" over `unit` for UI.markTime s (house rule runningNoise: a guard heard a running commando's step). One mark
   * per guard: a newer step restarts it.
   */
  mark(unit, text = '?') {
    if (!unit || unit.removed || unit.alive === false) return null;
    let m = this.marks.find((t) => t.unit === unit);
    if (!m) {
      m = { el: el('div', 'hud-mark', this.layer, text), unit, mark: true, until: 0 };
      this.marks.push(m);
    }
    restartPop(m.el, 'pop');
    m.until = this.hud.clock + UI.markTime;
    this._placeSoon(m);
    return m;
  }

  update() {
    const now = this.hud.clock;
    shownPop(this.line);
    for (const m of this.marks) shownPop(m.el);
    if (!this.line.hidden && now > this.until) this.line.hidden = true;
    this.tags = this.tags.filter((t) => {
      if (now > t.until || t.unit.removed) {
        t.el.remove();
        return false;
      }
      this._place(t);
      return true;
    });
    this.marks = this.marks.filter((t) => {
      if (now > t.until || t.unit.removed || t.unit.alive === false) {
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
    for (const t of this.marks) t.el.remove();
    this.tags = [];
    this.marks = [];
  }
}
