/**
 * In-mission menus (docs/menus-art-direction.md S05 in mission, S09, S13, S18; §7 reconciliation 2): P shows the
 * stamped-steel "GAME PAUSED" on the live frozen game (the HUD stays); Esc opens the SAME MAIN card as the front end on
 * the oxblood frozen frame (B2) — Esc / right-click / pad B resume, no RESUME row. SAVE GAME / LOAD GAME: BEL's ten
 * text-only slots ("-- UNUSED SLOT --") with a detail pane (sepia print + typed card), save-in-place typewriter names,
 * overwrite / delete confirmations, QUICK & AUTO tab, export / import. Options and Help open from here too.
 * @module ui/menus
 */

import { CONFIG } from '../config.js';
import { hasQuickSave, listSlots, saveSlot as storeSlot, deleteSlot, exportSave, importSave, SLOT_COUNT, AUTOSAVE_KEY } from '../save.js';
import { el, fmtTime } from './dom.js';
import { photoPrint, typeField, stamp, cap, labelHTML } from './menu-kit.js';
import { rankLabel } from './menu-model.js';
import { catalogueEntry } from './catalogue.js';
import { buildOptions } from './options-panel.js';
import { putThumb, getThumb, delThumb } from './thumbs.js';
import { SKILL_CHOICES } from './bcd-ui.js';

const META_KEY = (i) => `shadowsix.slotmeta.v1.${i}`;
const UNUSED = '-- UNUSED SLOT --';

/** Slot directory merged with the menu's metadata: [{slot, name, mission, savedAt, title, n, clock, rank, profile} | null]. */
export function readSlots(storage = globalThis.localStorage) {
  return listSlots().map((s, i) => {
    if (!s) return null;
    let meta = {};
    try {
      meta = JSON.parse(storage?.getItem(META_KEY(i)) || '{}') || {};
    } catch { /* ignore */ }
    return { ...s, ...meta, name: s.name };
  });
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(d.getDate()).padStart(2, '0')} ${M[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export class Menus {
  constructor(hud) {
    this.hud = hud;
    // S18 GAME PAUSED: the stamped-steel title on the live frozen game (the HUD stays visible)
    this.pauseCard = el('div', 'ui-paused', hud.root);
    el('div', 'band', this.pauseCard); // a soft letterbox band of shade so the steel reads on any ground (3:1)
    const t = el('h2', 'mk-title', this.pauseCard);
    el('span', null, t, 'GAME PAUSED').dataset.text = 'GAME PAUSED';
    this.pauseHint = el('p', 'hint', this.pauseCard);
    this.pauseHint.append(cap('P'));
    this.pauseHintText = el('span', null, this.pauseHint, 'RESUME');
    // a click / tap on the hint resumes, like P (phones have no P)
    this.pauseHint.addEventListener('click', (e) => {
      e.stopPropagation();
      const g = hud.game;
      if (g.state === 'paused') g.togglePause();
    });
    this.pauseCard.hidden = true;
    this.view = null; // 'esc' | 'save' | 'load' | 'options' | 'help'
    this._suppress = false;
    this.tab = 'slots';
  }

  get kit() { return this.hud.kit; }

  get open() {
    return !!this.view && this.kit.active;
  }

  suppressPauseCard(on) {
    this._suppress = on;
    this.sync();
  }

  /** Show the right pause visuals for the game state. */
  sync() {
    const paused = this.hud.game.state === 'paused';
    const show = paused && !this.open && !this._suppress && !!this.hud.world && !this.hud.debrief?.active; // not under an end card
    this.pauseCard.hidden = !show;
    document.documentElement.classList.toggle('s6-paused', show); // S18: 30 % desaturation + vignette on the live frame
    const active = !!this.hud.game.options?.activePause;
    this.pauseCard.classList.toggle('active', active);
    // BEL grammar: (R)ESUME — R resumes as well as P (key() below); the word alone read as an R hotkey to players
    this.pauseHintText.innerHTML = labelHTML(active ? '(R)ESUME  ·  ORDERS ENABLED' : '(R)ESUME');
    if (!paused && this.view && this._pausedByMenu) this.close(false);
  }

  /**
   * Keys for the S18 pause card (P pause, no menu card open; HUD capture phase, before Input): R = (R)ESUME.
   * Consumed, so R never also reaches the game (R is an ability key: sniper rifle / BCD puppet).
   * @returns {boolean} consumed
   */
  key(e) {
    if (this.pauseCard.hidden || e.code !== 'KeyR' || e.ctrlKey || e.metaKey || e.altKey) return false;
    const g = this.hud.game;
    if (!e.repeat && g.state === 'paused') g.togglePause();
    return true;
  }

  _pause() {
    const g = this.hud.game;
    if (g.state === 'playing') {
      g.pause(true);
      this._pausedByMenu = true;
    }
  }

  /** Esc in mission: snapshot → oxblood duotone → the MAIN card (S05 in mission, B2). */
  showEsc() {
    this._pause();
    this.view = 'esc';
    if (this.hud.world) this.hud.backdrop?.freeze();
    this.hud.screens.openMain();
    this.sync();
  }

  /** Enter a sub-view from MAIN (keeps the stack so Esc goes back one level). */
  _sub(view) {
    this._pause();
    this.view = this.view || view;
    if (this.hud.world && !this.kit.active) this.hud.backdrop?.freeze();
    if (!this.kit.active) this.hud.backdrop?.setMode(this.hud.world ? 'mission' : 'frontend');
  }

  showOptions() {
    this._sub('options');
    buildOptions(this.hud);
    this.sync();
  }

  showHelp() {
    this._sub('help');
    this.hud.help.open();
    this.sync();
  }

  /**
   * BCD Skill screen (docs/bcd-plan.md §1.12): after New Game → BCD, "Easy — for Rookies" / "Difficult — for
   * Veterans". The choice goes to the BCD career (flow.setDifficulty) and the next mission load. Never under BEL.
   * @param {import('../core/flow.js').Flow} flow the BCD campaign flow
   * @param {(difficulty: string) => void} [onPick]
   */
  showSkill(flow, onPick = () => {}) {
    if (!flow || !CONFIG.rulesets[flow.campaign]?.difficulty) return false;
    this.kit.open({
      id: 'skill',
      title: 'SKILL',
      rows: SKILL_CHOICES.map((c) => ({ label: c.label.toUpperCase(), id: c.id, onSelect: () => { flow.setDifficulty(c.id); this.kit.pop(); onPick(c.id); } })),
    });
    return true;
  }

  // ---------------------------------------------------------------- S09 SAVE GAME / LOAD GAME

  showSlots(mode) {
    this._sub(mode);
    const kit = this.kit, hud = this.hud;
    const slots = readSlots();
    const none = slots.every((x) => !x);
    // LOAD with every slot empty: start on QUICK & AUTO when it holds something
    if (mode === 'load' && none && this.tab === 'slots' && !kit.top?.spec.id?.startsWith('slots-') && (hasQuickSave() || this._readAuto())) this.tab = 'auto';
    const tab = mode === 'load' ? this.tab : 'slots';
    const rows = [];
    if (tab === 'slots') {
      slots.forEach((s, i) => rows.push({
        kind: 'slot', id: `slot${i}`, slot: i, label: s ? s.name.toUpperCase() : UNUSED, cls: s ? '' : 'unused',
        disabled: mode === 'load' && !s, reason: '', // S09: an empty slot shows nothing
        onSelect: () => (mode === 'save' ? this._saveInto(i, s) : this.loadSlot(i)),
      }));
    } else {
      const auto = this._readAuto();
      rows.push({ kind: 'slot', id: 'quick', label: 'QUICK SAVE', disabled: !hasQuickSave(), reason: 'NO QUICK SAVE', onSelect: () => hud.loading.quickLoad() });
      rows.push({ kind: 'slot', id: 'auto', label: auto ? `AUTOSAVE — ${String(auto.name || auto.mission).toUpperCase()}` : 'AUTOSAVE', disabled: !auto, reason: 'NO AUTOSAVE', onSelect: () => hud.loading.autoLoad() });
    }
    const hints = [['Enter', mode === 'save' ? 'SAVE' : 'LOAD'], ['Escape', 'BACK'], ['KeyX', 'DELETE']];
    if (mode === 'save' && hud.world) hints.push(['KeyE', 'EXPORT…', () => this._export()]);
    if (mode === 'load') hints.push(['KeyI', 'IMPORT…', () => this._import()]);
    kit.open({
      id: `slots-${mode}`,
      title: mode === 'save' ? 'SAVE GAME' : 'LOAD GAME',
      bg: hud.world ? 'mission' : 'frontend',
      className: 'mk-slots',
      layout: 'slots',
      rows,
      note: mode === 'load' && tab === 'slots' && none ? 'NO OPERATIONS ON FILE' : '', // the typed empty state
      detail: (r, pane) => this._detail(r, pane, slots),
      hints,
      onContext: (r) => r.slot != null && slots[r.slot] && this._delete(r.slot, slots[r.slot]),
      onTab: mode === 'load' ? (dir) => { this.tab = this.tab === 'slots' ? 'auto' : 'slots'; kit.pop(); this.showSlots('load'); } : null,
      keys: { KeyE: () => mode === 'save' && this._export(), KeyI: () => mode === 'load' && this._import() },
      render: mode === 'load' ? (box) => {
        const t = el('div', 'mk-tabs', box);
        for (const [id, label] of [['slots', 'SLOTS'], ['auto', 'QUICK & AUTO']]) {
          const b = el('button', `mk-tabbtn ${tab === id ? 'on' : ''}`, t, label);
          b.type = 'button';
          b.addEventListener('click', (e) => { e.stopPropagation(); if (tab !== id) { this.tab = id; kit.pop(); this.showSlots('load'); } });
        }
      } : null,
    }, { replace: kit.top?.spec.id?.startsWith('slots-') });
  }

  /** Anything to load at all (a slot, the quick save or the autosave)? MAIN dims LOAD GAME otherwise. */
  hasAnySave() {
    return readSlots().some(Boolean) || hasQuickSave() || !!this._readAuto();
  }

  _readAuto() {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  }

  /** Detail pane (S09): sepia print + typed card; empty slots show nothing (BEL's sparse look). */
  _detail(r, pane, slots) {
    const s = r.slot != null ? slots[r.slot] : null;
    if (!s) return false;
    const c = catalogueEntry(s.mission) || {};
    const print = photoPrint(pane, { grade: 'sepia', clip: true, src: null });
    getThumb(`slot${r.slot}`).then((url) => {
      if (url && print.isConnected) {
        print.querySelector('.ph')?.remove();
        const im = el('img', null, print);
        im.alt = '';
        im.src = url;
      }
    });
    const card = el('div', 'card', pane);
    const n = s.n ?? c.n;
    el('div', null, card).innerHTML = `<b>MISSION ${n ?? '—'}</b> · ${String(s.title || c.title || s.mission).toUpperCase()}`;
    el('div', null, card, fmtDate(s.savedAt));
    if (s.clock != null) el('div', null, card, `MISSION TIME ${fmtTime(s.clock)}`);
    if (s.played != null) el('div', null, card, `PLAYED ${Math.floor(s.played / 3600)} H ${Math.floor((s.played % 3600) / 60)} MIN`);
    if (s.profile) el('div', null, card, `${s.profile} · ${s.rank || ''}`);
    return true;
  }

  /** The row becomes a TypeField in place, prefilled with the mission name; Enter saves (ui.bell). */
  async _saveInto(i, existing) {
    const kit = this.kit;
    if (existing) {
      const ok = await kit.confirm({ id: 'overwrite', title: 'SAVE GAME', lines: [`OVERWRITE '${existing.name.toUpperCase()}'?`] });
      if (!ok) return;
    }
    const t = kit.top;
    const ix = t.rows.findIndex((r) => r.slot === i);
    const row = t.els[ix];
    const lab = row.querySelector('.mk-label');
    lab.replaceChildren();
    row.classList.add('typing');
    const def = (this.hud.def?.title || 'SAVE').toUpperCase();
    const f = typeField(lab, { max: 24, value: def, cls: 'mk-slotfield', sound: kit.sound, accept: (c) => (/^[\w .,'!?&-]$/.test(c) ? c.toUpperCase() : null), label: 'Save name', onEnter: () => t.spec.onKey?.({ code: 'Enter' }) });
    const prevKey = t.spec.onKey;
    t.spec.onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        t.spec.onKey = prevKey;
        kit.sound.play('bell');
        this.saveSlot(i, f.value.trim() || def);
        return true;
      }
      if (e.code === 'Escape') {
        t.spec.onKey = prevKey;
        kit.refresh();
        return true;
      }
      if (/^Arrow/.test(e.code)) return true;
      return f.key(e);
    };
  }

  /** Save into slot i (0..9) with `name`. Keeps the menu open on the SAVE card when it is up. */
  saveSlot(i, name) {
    const g = this.hud.game, kit = this.kit;
    const ok = !!g.world && storeSlot(g, i, name || `${g.missionDef?.title || 'Save'} ${i + 1}`);
    if (!ok) {
      if (kit.top?.spec.id === 'slots-save') kit.note('COULD NOT SAVE — STORAGE UNAVAILABLE', true);
      this.hud.message('SAVE FAILED.', 'warn');
      return false;
    }
    const c = catalogueEntry(g.missionDef) || {};
    const meta = {
      title: g.missionDef?.title, n: g.flow?.numberOf(g.missionDef?.id) || c.n || null, clock: g.world?.clock ?? 0,
      played: g.world?.clock ?? 0, profile: this.hud.profiles?.current || '', rank: rankLabel(CONFIG.mission.ranks, g.flow?.rank ?? 0),
    };
    try {
      localStorage.setItem(META_KEY(i), JSON.stringify(meta));
    } catch { /* metadata is optional */ }
    const thumb = this.hud.backdrop?.thumb?.();
    if (thumb) putThumb(`slot${i}`, thumb);
    this.hud.profiles?.setLast({ missionId: g.missionDef?.id, title: g.missionDef?.title, thumb });
    kit.announce(`Saved to slot ${i + 1}`);
    this.hud.toast?.('GAME SAVED');
    if (kit.top?.spec.id === 'slots-save') {
      this.showSlots('save');
      const t = kit.top;
      const ix = t.rows.findIndex((r) => r.slot === i);
      kit.focus(ix, { silent: true });
      t.els[ix]?.classList.add('saved');
      const pane = t.detailEl?.querySelector('.mk-print');
      if (pane) stamp(pane, 'SAVED', { sound: kit.sound, rot: -10, style: { right: '6%', top: '30%' } });
    }
    return true;
  }

  async loadSlot(i) {
    const s = readSlots()[i];
    if (!s) return false;
    return this.hud.loading.loadSlot(i, s);
  }

  async _delete(i, s) {
    const ok = await this.kit.confirm({ id: 'delete', title: 'DELETE', lines: [`DELETE '${s.name.toUpperCase()}'?`] });
    if (!ok) return;
    deleteSlot(i);
    try { localStorage.removeItem(META_KEY(i)); } catch { /* ignore */ }
    delThumb(`slot${i}`);
    this.kit.announce(`Slot ${i + 1} deleted`);
    this.showSlots(this.kit.top?.spec.id === 'slots-load' ? 'load' : 'save');
  }

  _export() {
    const json = exportSave(this.hud.game);
    if (!json) return this.kit.note('NO MISSION IN PROGRESS', true);
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `shadowsix-${this.hud.def?.id || 'save'}-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.kit.announce('Save exported');
    } catch {
      this.kit.note('EXPORT FAILED', true);
    }
  }

  _import() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const text = await f.text();
      this.close(false);
      const ok = await this.hud.loading.run({ title: 'IMPORTED GAME' }, () => importSave(this.hud.game, text));
      if (!ok) this.hud.message('IMPORT FAILED.', 'warn');
    };
    inp.click();
  }

  /** NEW GAME → LOAD QUICK SAVED GAME focus: the quicksave's print and mission (S06). */
  quickDetail(pane) {
    let q = null;
    try { q = JSON.parse(localStorage.getItem('shadowsix.quicksave.v1') || 'null'); } catch { q = null; }
    if (!q) return false;
    const c = catalogueEntry(q.mission) || {};
    photoPrint(pane, { grade: 'sepia', clip: true });
    const card = el('div', 'card', pane);
    el('div', null, card).innerHTML = `<b>QUICK SAVE</b> · ${String(c.title || q.mission).toUpperCase()}`;
    el('div', null, card, fmtDate(q.savedAt));
    return true;
  }

  // ---------------------------------------------------------------- close / back

  /** Close every menu; `resume` un-pauses when the menu paused the game. */
  close(resume = true) {
    const g = this.hud.game;
    this.view = null;
    if (this.hud.world) {
      this.kit.close();
      this.hud.backdrop?.setMode('off');
    }
    if (resume && g.state === 'paused') g.pause(false);
    this._pausedByMenu = false;
    this.sync();
  }

  /** Esc inside a menu: back one level / resume. @returns {boolean} consumed */
  back() {
    if (!this.open) return false;
    this.kit.back();
    return true;
  }
}
