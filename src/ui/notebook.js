/**
 * Notebook minimap (design-spec §6.4): a spiral-bound strip under the eye that unfolds leftward after a 0.25 s
 * hover (or a click) and folds back 0.4 s after the pointer leaves (no pinning). Shows the mission sketch with
 * the camera view (black rectangle), primary objectives (red circles), commandos (blue) and enemies (red dots).
 * Click = jump the view there; mouse wheel = zoom the sketch (it then scrolls with the camera). The folded corner
 * (or Ctrl+B) opens the Briefing Notes page, which pauses the game until any key or click.
 * @module ui/notebook
 */

import { forcedRuleLines } from '../core/house-rules.js';
import { el, tip } from './dom.js';
import { iconEntry, iconHTML, toolHTML, wireToolStates } from './icon-art.js';
import { drawSketch } from './sketch.js';
import { UI } from './ui-config.js';
import { catalogueEntry, formatMissionDate } from './catalogue.js';

const RES = 2; // canvas px per ref px

export class Notebook {
  constructor(hud, parent) {
    this.hud = hud;
    this.root = el('div', 'hud-notebook', parent);
    this.spiral = el('div', 'spiral', this.root);
    this.page = el('div', 'page', this.root);
    if (iconEntry('tool/notebook')) { // rendered binding (steel coil + tucked pencil) and paper page, like the other tools
      this.root.classList.add('rendered');
      this.spiral.innerHTML = toolHTML('tool/notebook');
      wireToolStates(this.spiral);
      if (iconEntry('tool/notebook.page')) this.page.insertAdjacentHTML('afterbegin', iconHTML('tool/notebook.page', { cls: 'paper' }));
    }
    this.cv = el('canvas', 'sketch', this.page);
    this.ov = el('canvas', 'marks', this.page);
    const [ow, oh] = UI.notebook.open;
    for (const c of [this.cv, this.ov]) {
      c.width = ow * RES;
      c.height = oh * RES;
    }
    this.corner = tip(el('button', 'corner', this.root), 'BRIEFING NOTES (CTRL+B)');
    this.corner.type = 'button';
    this.zoom = 1;
    this.open = false;
    this._hoverT = null;
    this._leaveT = null;
    this._paper = null; // cached sketch canvas at full map size
    this.root.addEventListener('pointerenter', () => {
      clearTimeout(this._leaveT);
      this._hoverT = setTimeout(() => this.setOpen(true), UI.notebook.openDelay * 1000);
    });
    this.root.addEventListener('pointerleave', () => {
      clearTimeout(this._hoverT);
      this._leaveT = setTimeout(() => this.setOpen(false), UI.notebook.closeDelay * 1000);
    });
    this.spiral.addEventListener('click', () => this.setOpen(!this.open));
    this.page.addEventListener('click', (e) => {
      if (!this.open) return this.setOpen(true);
      const p = this.toWorld(e);
      if (p) hud.game.cameraController?.centerOn(p.x, p.z);
    });
    this.page.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.5 : 1 / 1.5));
    }, { passive: false });
    this.corner.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showNotes();
    });
    this.notes = el('div', 'ui-notes', hud.root);
    this.notes.hidden = true;
    this.notes.addEventListener('click', () => this.hideNotes());
  }

  setZoom(z) {
    this.zoom = Math.max(1, Math.min(4, z));
    this.root.dataset.zoom = this.zoom.toFixed(2);
  }

  setOpen(on) {
    if (this.open === on) return;
    this.open = on;
    this.root.classList.toggle('open', on);
    if (on) this.redraw();
  }

  /** New mission: rebuild the cached sketch. */
  build(def) {
    this.def = def;
    this.zoom = 1;
    const [W, D] = def?.size || [60, 60];
    const k = Math.min(8, 1400 / Math.max(W, D)); // px per metre for the cached paper
    const paper = document.createElement('canvas');
    paper.width = Math.round(W * k);
    paper.height = Math.round(D * k);
    drawSketch(paper.getContext('2d'), def, paper.width, paper.height);
    this._paper = paper;
    this.redraw();
  }

  /** Visible world window of the sketch → {x0, z0, w, d}. */
  window() {
    const [W, D] = this.def?.size || [60, 60];
    const w = W / this.zoom, d = D / this.zoom;
    const cam = this.hud.game.cameraController;
    const cx = cam?.target?.x ?? W / 2, cz = cam?.target?.z ?? D / 2;
    const x0 = Math.max(0, Math.min(W - w, cx - w / 2)), z0 = Math.max(0, Math.min(D - d, cz - d / 2));
    return { x0, z0, w, d };
  }

  toWorld(e) {
    const r = this.page.getBoundingClientRect();
    if (!r.width) return null;
    const v = this.window();
    return { x: v.x0 + ((e.clientX - r.left) / r.width) * v.w, z: v.z0 + ((e.clientY - r.top) / r.height) * v.d };
  }

  redraw() {
    const ctx = this.cv.getContext('2d');
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!this._paper || !this.def) return;
    const [W, D] = this.def.size;
    const v = this.window();
    const kx = this._paper.width / W, kz = this._paper.height / D;
    ctx.drawImage(this._paper, v.x0 * kx, v.z0 * kz, v.w * kx, v.d * kz, 0, 0, this.cv.width, this.cv.height);
    this._win = `${v.x0.toFixed(1)},${v.z0.toFixed(1)},${this.zoom}`;
  }

  /** Overlays: camera rectangle, objectives, commandos, enemies. */
  update() {
    const w = this.hud.world;
    if (!w || !this.open) return;
    const v = this.window();
    if (`${v.x0.toFixed(1)},${v.z0.toFixed(1)},${this.zoom}` !== this._win) this.redraw();
    const ctx = this.ov.getContext('2d');
    const cw = this.ov.width, ch = this.ov.height;
    const map = (x, z) => [((x - v.x0) / v.w) * cw, ((z - v.z0) / v.d) * ch];
    ctx.clearRect(0, 0, cw, ch);
    const fp = this.hud.game.cameraController?.groundFootprint?.(0) || [];
    if (fp.length === 4) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      fp.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...map(p.x, p.z)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = '#b01818';
    ctx.lineWidth = 2.5;
    for (const p of this.objectivePoints(w)) {
      ctx.beginPath();
      ctx.arc(...map(p.x, p.z), 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    const dot = (list, color, r) => {
      ctx.fillStyle = color;
      for (const u of list) {
        if (u.alive === false || u.removed || u.state === 'inVehicle') continue;
        ctx.beginPath();
        ctx.arc(...map(u.x, u.z), r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    dot(w.enemies || [], '#c41e1e', 3);
    dot((w.commandos || []).filter((c) => !c.downed), '#1d4fd8', 4);
    // bodies-design §C.7: a pulsing red dot for a downed man
    const down = (w.commandos || []).filter((c) => c.downed && c.alive);
    if (down.length) dot(down, `rgba(214, 30, 22, ${(0.55 + 0.45 * Math.abs(Math.sin((w.time || 0) * Math.PI))).toFixed(2)})`, 5);
  }

  objectivePoints(w) {
    const out = [];
    const structs = this.def?.structures || [];
    for (const o of w.objectives || this.def?.objectives || []) {
      if (o.done || o.hidden || o.required === false) continue;
      for (const id of o.targets || []) {
        const s = structs.find((q) => q.id === id) || w.interactables?.find?.((q) => q.id === id || q.tag === id);
        if (s && s.x != null) out.push({ x: s.x, z: s.z });
      }
      if (o.type === 'escape' && w.extraction) out.push(w.extraction);
    }
    return out;
  }

  // ----------------------------------------------------------- Briefing Notes (§6.4 folded corner)

  showNotes() {
    const g = this.hud.game;
    if (!this.def) return;
    this._resume = g.state === 'playing';
    if (this._resume) g.pause(true);
    this.hud.menus?.suppressPauseCard(true);
    const c = catalogueEntry(this.def) || {};
    this.notes.replaceChildren();
    // S17: the spiral notebook (stained olive paper, red labels, "- " ink bullets, ticks on completed objectives)
    const pad = el('div', 'nb-pad', this.notes);
    pad.classList.toggle('rm', !!this.hud.kit?.reducedMotion);
    const loops = Array.from({ length: 30 }, (_, i) => `<g transform="translate(${10 + i * 20} 0)"><path d="M0 22 C0 4 10 4 10 14" fill="none" stroke="#0c0c0a" stroke-width="3.2" stroke-linecap="round"/><path d="M1.2 19 C1.5 7 8.5 7 9 13" fill="none" stroke="#9a9a92" stroke-width="1" stroke-linecap="round" opacity=".7"/><ellipse cx="5" cy="23.5" rx="3.3" ry="2.2" fill="#15150f"/></g>`).join('');
    pad.insertAdjacentHTML('beforeend', `<svg class="nb-spiral" viewBox="0 0 610 28" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="nb-ink" x="-2%" y="-20%" width="104%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="0.6"/><feMorphology operator="dilate" radius=".25"/></filter></defs>${loops}</svg>`);
    const page = el('div', 'ruled nb-paper', pad);
    const head = el('dl', 'head', page);
    for (const [k, v] of [['DATE', formatMissionDate(this.def.date || c.date) || '—'], ['LOCATION', this.def.location || c.place || '—'], ['MISSION', (this.def.title || '').toUpperCase()]]) {
      el('dt', null, head, `${k}:`);
      el('dd', null, head, String(v).toUpperCase());
    }
    const seen = (this._ticked ||= new Set());
    const ul = el('ul', 'obj', page);
    for (const o of this.hud.world?.objectives || this.def.objectives || []) {
      if (o.hidden) continue;
      const li = el('li', o.done ? 'done' : o.failed ? 'failed' : '', ul);
      el('span', 'txt', li, String(o.text).toUpperCase());
      if (o.done) {
        li.insertAdjacentHTML('beforeend', '<svg class="tick" viewBox="0 0 24 20" aria-hidden="true"><path pathLength="100" d="M2 11 L9 17 L22 2"/></svg>');
        const key = o.id ?? o.text;
        if (seen.has(key)) li.classList.add('seen');
        seen.add(key);
      } else if (o.failed) el('span', 'cross', li, '✕');
    }
    const hints = this.def.briefing?.hints || this.def.hints || [];
    if (hints.length) {
      const hl = el('ul', 'hints', page);
      for (const h of hints) el('li', null, hl, String(h).toUpperCase());
    } else if (this.def.briefing?.text) el('p', 'hint', page, this.def.briefing.text);
    const rules = forcedRuleLines(this.def); // forced house rules (bodies-design §0.3)
    if (rules.length) {
      const rl = el('ul', 'hints rules', page);
      for (const r of rules) el('li', null, rl, r.toUpperCase());
    }
    [...page.querySelectorAll('li, dd, .hint')].forEach((n, i) => n.style.setProperty('--rot', `${(((i * 37) % 7) - 3) * 0.1}deg`));
    el('p', 'close', this.notes, 'ANY KEY / CLICK CLOSES');
    this.hud.sound?.play('paper');
    this.notes.hidden = false;
  }

  get notesOpen() {
    return !this.notes.hidden;
  }

  hideNotes() {
    if (this.notes.hidden) return;
    this.notes.hidden = true;
    this.hud.menus?.suppressPauseCard(false);
    if (this._resume) this.hud.game.pause(false);
    this._resume = false;
  }
}
