/**
 * Top bar (design-spec §6.1–6.3): portraits packed from the left at a 65 ref-px pitch (frame 62×44, face 40×40,
 * recessed 9×37 health slot with a 6×34 rgb(104,0,0) fill draining from the top, skull at HP 0, greyscale when
 * unselected, state glyphs), warning flashes (§6.2), the talking-portrait slot + speaker card (§6.3) and the
 * right-hand icons: posture toggle, "?", movie camera (tracking), eye (cone tool) and the siren lamp.
 * @module ui/topbar
 */

import { getPortraitURL } from '../art/portraits.js';
import { perception } from '../ai/perception.js';
import { CONFIG } from '../config.js';
import { el, fromHTML, tip } from './dom.js';
import { GLYPHS, EYE_SVG } from './icons.js';
import { applyToolState, iconEntry, iconHTML, toolHTML, wireToolStates } from './icon-art.js';
import { UI } from './ui-config.js';
import { ROLE_NAMES } from './catalogue.js';
import { CommandoWarnings } from './bcd-ui.js';

/** Portrait state glyph for a commando (§6.1 table). */
export function portraitGlyph(c) {
  if (c.state === 'jailed' || c.state === 'captured') return 'bars';
  if (c.state === 'inVehicle' || c.vehicle) return 'vehicle';
  if (c.state === 'hidden' || c.hidden) return 'house';
  if (c.buried) return 'shovel';
  if (c.underwater || c.stance === 'dive') return 'bubbles';
  return '';
}

export class TopBar {
  /** @param {import('./hud.js').HUD} hud */
  constructor(hud) {
    this.hud = hud;
    this.root = el('div', 'hud-topbar', hud.root);
    this.row = el('div', 'hud-portraits', this.root);
    this.icons = el('div', 'hud-icons', this.root);
    this.card = el('div', 'hud-speaker-card', hud.root);
    this.card.hidden = true;
    this.cardImg = el('img', null, this.card);
    this.cardName = el('span', 'name', this.card);
    this.cardMouth = el('i', 'mouth', this.card);
    this.cards = new Map(); // unit → {p, ...}
    this.warn = new Map(); // unit id → {kind, until}
    this._seenT = 0;
    this._seen = new Set();
    this._buildIcons();
  }

  _buildIcons() {
    const h = this.hud;
    const i = this.icons;
    this.posture = wireToolStates(tip(el('button', 'hud-icon hud-posture', i), 'LIE DOWN / STAND UP (C / S)'));
    this.posture.addEventListener('click', () => h.togglePosture());
    this.help = wireToolStates(tip(iconEntry('tool/help') ? fromHTML(`<button class="hud-icon hud-help">${toolHTML('tool/help')}<span class="lbl">?</span></button>`, null, i) : el('button', 'hud-icon hud-help', i, '?'), 'HELP (F1)'));
    this.help.addEventListener('click', () => h.menus.showHelp());
    this.camera = wireToolStates(tip(fromHTML(`<button class="hud-icon hud-camera">${toolHTML('tool/camera') || GLYPHS.camera}</button>`, null, i), 'TRACKING CAMERA'));
    this.camera.addEventListener('click', () => h.cursor.setMode(h.cursor.mode === 'track' ? null : 'track'));
    const lamp = iconEntry('tool/lamp.off') ? iconHTML('tool/lamp.off', { v: 'off' }) + iconHTML('tool/lamp.on', { v: 'on' }) : GLYPHS.lamp;
    this.lamp = tip(fromHTML(`<div class="hud-icon hud-lamp">${lamp}</div>`, null, i), 'ALARM');
    // the eye blinks (§6.1): the closed-lid render fades over the open eye and its state variants
    const eye = iconEntry('tool/eye.open') ? toolHTML('tool/eye.open') + iconHTML('tool/eye.closed', { cls: 'lid' }) : EYE_SVG;
    this.eye = wireToolStates(tip(fromHTML(`<button class="hud-icon hud-eye">${eye}</button>`, null, i), 'EYE: SHOW A VISION CONE'));
    this.eye.addEventListener('click', () => h.cursor.setMode(h.cursor.mode === 'eye' ? null : 'eye'));
    this.eye.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      h.hideCones();
    });
    for (const b of i.querySelectorAll('button')) b.type = 'button';
  }

  /** (Re)build portraits for the world's commandos (then guests). */
  build(world) {
    this.row.replaceChildren();
    this.cards.clear();
    this.warn.clear();
    const order = CONFIG.units.selectOrder || [];
    const list = [...(world?.commandos || [])].sort((a, b) => {
      const ga = a.role === 'guest' || a.guest ? 1 : 0, gb = b.role === 'guest' || b.guest ? 1 : 0;
      return ga - gb || (order.indexOf(a.role) - order.indexOf(b.role));
    });
    for (const c of list) {
      const p = el('div', 'hud-portrait', this.row);
      p.dataset.unitId = String(c.id);
      p.dataset.role = c.role;
      tip(p, `${(ROLE_NAMES[c.role] || c.name || 'Guest').toUpperCase()}${c.nickname ? ` "${c.nickname.toUpperCase()}"` : ''}`);
      const face = el('div', 'face', p);
      const img = el('img', null, face);
      img.alt = c.nickname || c.role;
      img.src = getPortraitURL(c.role, { size: 80 });
      const mouth = el('i', 'mouth', face);
      const skull = fromHTML(`<div class="skull">${iconHTML('stamp/skull', { mult: 2.5 }) || GLYPHS.skull}</div>`, null, face);
      const glyph = el('div', 'glyph', face);
      const slot = el('div', 'hud-portrait-slot', face); // §6.3 talking-portrait host (cross-team hook)
      slot.dataset.unitId = String(c.id);
      const hp = el('div', 'hp', p);
      const fill = el('i', null, hp);
      const key = order.indexOf(c.role);
      el('span', 'key', p, key >= 0 ? String(key + 1) : '7');
      p.addEventListener('click', (e) => this.hud.selectFromPortrait(c, e));
      this.cards.set(c, { p, img, fill, skull, glyph, slot, mouth, sig: '', glyphKey: '' });
    }
  }

  portraitSlot(unitId) {
    for (const [c, r] of this.cards) if (c.id === unitId) return r.slot;
    return null;
  }

  portraitEl(unitId) {
    for (const [c, r] of this.cards) if (c.id === unitId) return r.p;
    return null;
  }

  /** Event-driven warning (ui:warning / unit:held / shot at). */
  flag(unit, kind, ttl = UI.warningTTL) {
    if (!unit) return;
    const now = this.hud.clock;
    const cur = this.warn.get(unit.id);
    const rank = { seen: 1, hurt: 2, held: 2 };
    if (cur && cur.until > now && rank[cur.kind] > rank[kind]) return;
    this.warn.set(unit.id, { kind, until: now + ttl });
  }

  /** Commandos currently seen by any enemy (§6.2 blue glow; band rule via perception.canSee). */
  _computeSeen(world) {
    this._seen.clear();
    for (const c of world.commandos) {
      if (!c.alive || c.isVisibleToEnemies === false) continue;
      for (const e of world.enemies) {
        if (!e.alive || !e.vision) continue;
        let r = 'none';
        try {
          r = perception.canSee(e, c, world);
        } catch {
          r = 'none';
        }
        if (r !== 'none') {
          this._seen.add(c.id);
          break;
        }
      }
    }
  }

  /** Speaking animation for `unit` over `dur` seconds (§6.3 placeholder: mouth/level animation). */
  speak(unit, dur, level = 1) {
    const r = [...this.cards].find(([c]) => c === unit || c.id === unit?.id)?.[1];
    if (!r) return false;
    r.talkUntil = this.hud.clock + dur;
    r.p.classList.add('talking');
    r.p.style.setProperty('--talk', String(Math.max(0.3, Math.min(1, level))));
    this.card.hidden = false;
    this.card.classList.add('on');
    this.cardImg.src = r.img.src;
    this.cardName.textContent = (ROLE_NAMES[unit.role] || unit.nickname || '').toUpperCase();
    this.cardUnit = unit;
    this.cardUntil = this.hud.clock + dur + UI.speakerLinger;
    const x = r.p.offsetLeft;
    this.card.style.left = `${x}px`;
    return true;
  }

  /** Armed tool (eye / camera mode on) → its "active" render. */
  _armed(btn, on) {
    if (btn.classList.contains('armed') === on) return;
    btn.classList.toggle('armed', on);
    applyToolState(btn);
  }

  update(dt) {
    const hud = this.hud, w = hud.world, now = hud.clock;
    if (!w) return;
    const warnOn = hud.options.warnings;
    this._seenT -= dt;
    if (warnOn && this._seenT <= 0) {
      this._seenT = 0.2;
      this._computeSeen(w);
    }
    // BCD "Commando Warnings" (docs/bcd-plan.md §1.11): blue while seen, red flash while attacked (shots, hits)
    if (w.rules?.commandoWarnings && this._bcdWarn?.world !== w) { this._bcdWarn?.dispose(); this._bcdWarn = new CommandoWarnings(w); }
    for (const [c, r] of this.cards) {
      const f = Math.max(0, Math.min(1, c.hp / c.maxHp));
      const dead = !c.alive || c.hp <= 0;
      const ev = this.warn.get(c.id);
      let warn = '';
      if (warnOn && !dead) {
        if (c.held || (ev && ev.until > now && (ev.kind === 'held' || ev.kind === 'hurt'))) warn = 'held';
        else if (this._seen.has(c.id) || (ev && ev.until > now && ev.kind === 'seen')) warn = 'seen';
        const bcd = this._bcdWarn?.world === w ? this._bcdWarn.state(c, warnOn) : null;
        if (bcd === 'red') warn = 'held';
        else if (bcd === 'blue' && !warn) warn = 'seen';
      }
      const g = dead ? '' : portraitGlyph(c);
      const sig = `${Math.round(f * 34)}|${c.selected ? 1 : 0}|${dead ? 1 : 0}|${warn}|${g}`;
      if (sig !== r.sig) {
        r.sig = sig;
        r.fill.style.setProperty('--hp', f.toFixed(3)); // drains from the top, anchored at the bottom
        r.p.dataset.hp = f.toFixed(3);
        r.p.classList.toggle('selected', !!c.selected);
        r.p.classList.toggle('dead', dead);
        r.p.classList.toggle('warn-seen', warn === 'seen');
        r.p.classList.toggle('warn-held', warn === 'held');
        if (g !== r.glyphKey) {
          r.glyphKey = g;
          r.glyph.innerHTML = g ? iconHTML(`stamp/${g}`, { mult: g === 'bars' ? 2.5 : 1 }) || GLYPHS[g] : '';
          r.p.dataset.glyph = g;
        }
      }
      if (r.talkUntil && now > r.talkUntil) {
        r.talkUntil = 0;
        r.p.classList.remove('talking');
      }
    }
    if (this.cardUntil && now > this.cardUntil) {
      this.cardUntil = 0;
      this.card.classList.remove('on');
      this.card.hidden = true;
    }
    // Posture icon shows the posture you can switch TO (§6.1).
    const sel = w.commandos.filter((c) => c.selected && c.alive);
    const toStand = sel.length > 0 && sel.every((c) => c.stance === 'crawl');
    const want = toStand ? 'stand' : 'prone';
    if (this._posture !== want) {
      this._posture = want;
      this.posture.innerHTML = iconEntry(`tool/posture.${want}`) ? toolHTML(`tool/posture.${want}`) : GLYPHS[want];
      this.posture.dataset.to = want;
      applyToolState(this.posture);
    }
    this.lamp.classList.toggle('on', !!w.alarm?.active);
    this._armed(this.eye, hud.cursor.mode === 'eye');
    this._armed(this.camera, hud.cursor.mode === 'track');
  }
}
