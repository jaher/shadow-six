/**
 * The one menu kit (docs/menus-art-direction.md §1.5, §1.6, §1.9 + amendments A1, B3, B4): MenuCard with MenuItem /
 * ToggleRow / Slider / SlotRow / key-binding rows, the bottom-pinned `(Y)ES (N)O` hotkey footer, the KeyHintBar,
 * `confirm()`, and the small material components (PhotoPrint, PaperSheet, Stamp, NameTape, MedalDisc, TypeField,
 * password cells). One input router serves keyboard, mouse (right-click = back), touch (swipe right = back) and the
 * Standard Gamepad, and switches the hint glyphs to the last device. Pure focus logic lives in menu-model.js.
 * Every front-end and in-mission menu instantiates cards from here (contract item 1: one card everywhere).
 * @module ui/menu-kit
 */

import { el } from './dom.js';
import { touchFirst } from './touch.js';
import {
  nextFocus, edgeFocus, firstEnabled, splitHotkey, hotkeyOf, codeForHotkey, stepSlider, crossedDetent, flipChoice,
  passwordChar, normalizePassword,
} from './menu-model.js';

export const LOCK_SVG = '<svg class="mk-lock" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 0 0-4 0z"/></svg>';
export const CLIP_SVG = '<svg class="clip" viewBox="0 0 12 30" aria-hidden="true"><path d="M3 26V6a3 3 0 0 1 6 0v18a1.6 1.6 0 0 1-3.2 0V8" fill="none" stroke="#c9a24a" stroke-width="1.6" stroke-linecap="round"/><path d="M3 26V6a3 3 0 0 1 6 0" fill="none" stroke="#fff3c2" stroke-width=".5" opacity=".7"/></svg>';

/** Pad glyphs for the last-device hint bar (Xbox layout; the label is the fallback for screen readers). */
const PAD = { Enter: ['A', 'a'], Escape: ['B', 'b'], KeyX: ['X', 'x'], KeyY: ['Y', 'y'], PageUp: ['LB', ''], PageDown: ['RB', ''] };

/** Render a label with its `(X)` hotkey letter underlined in brass (contract item 4). */
export function labelHTML(label) {
  const { pre, key, post } = splitHotkey(label);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return key ? `${esc(pre)}(<span class="mk-hk">${esc(key)}</span>)${esc(post)}` : esc(pre);
}

/** A typewriter keycap: cap('↵'), cap('A', 'pad a'). */
export function cap(text, cls = '') {
  const c = document.createElement('span');
  c.className = `mk-cap ${cls}`.trim();
  c.textContent = text;
  return c;
}

/** Friendly keycap text for a KeyboardEvent.code. */
export function keyName(code) {
  if (!code) return '—';
  const m = /^(Key|Digit|Numpad)(.+)$/.exec(code);
  if (m) return m[1] === 'Numpad' ? `NUM ${m[2].replace('Add', '+').replace('Subtract', '−').replace('Multiply', '*')}` : m[2];
  return ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'ESC', Enter: '↵', Space: 'SPACE', Backspace: '⌫', Equal: '=', Minus: '−', Tab: 'TAB', Home: 'HOME', End: 'END', Pause: 'PAUSE', BracketLeft: '[', BracketRight: ']', Backquote: '`', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Delete: 'DEL', PageUp: 'PG UP', PageDown: 'PG DN', ShiftLeft: 'SHIFT', ControlLeft: 'CTRL', AltLeft: 'ALT' })[code] || code.toUpperCase();
}

/** §1.5.10 PhotoPrint: an image in the deckled M4 border. opts: {src, grade:'gray'|'sepia', clip, caption, square, placeholder} */
export function photoPrint(parent, opts = {}) {
  const f = el('figure', `mk-print ${opts.grade || ''} ${opts.square ? 'square' : ''}`.trim(), parent);
  f.style.margin = '0';
  if (opts.src) {
    const im = el('img', null, f);
    im.alt = opts.alt || '';
    im.decoding = 'async';
    im.src = opts.src;
  } else {
    const ph = el('div', 'ph', f); // emblem placeholder print (§ S09 "missing thumbnail")
    const im = el('img', null, ph);
    im.alt = '';
    im.src = 'assets/ui/emblem.svg';
  }
  if (opts.clip) f.insertAdjacentHTML('afterbegin', CLIP_SVG);
  if (opts.caption) el('figcaption', 'cap', f, opts.caption);
  if (opts.rotate) f.style.transform = `rotate(${opts.rotate}deg)`;
  return f;
}

/** §1.5.11 Stamp (M11): lands at scale 1.35 → 1 in 140 ms with a thump; `sound` plays `ui.stamp`. */
export function stamp(parent, text, opts = {}) {
  const s = el('span', `mk-stamp ${opts.black ? 'black' : ''}`.trim(), parent, text);
  s.style.setProperty('--rot', `${opts.rot ?? -8}deg`);
  if (opts.style) Object.assign(s.style, opts.style);
  opts.sound?.play('stamp');
  parent.classList.add('mk-shake');
  setTimeout(() => parent.classList.remove('mk-shake'), 200);
  return s;
}

export function nameTape(parent, text) {
  return el('span', 'mk-nametape', parent, text);
}

/** §1.5.11 MedalDisc: kind 'silver' | 'gold'; state 'empty' | 'filled' | 'ghost'. */
export function medal(parent, kind, state = 'filled') {
  const m = el('i', `mk-medal ${kind} ${state === 'filled' ? '' : state}`.trim(), parent);
  m.setAttribute('aria-hidden', 'true');
  return m;
}

/**
 * §1.5.7 TypeField: Special Elite glyph spans with a strike animation, a blinking block caret, and typewriter
 * sounds. Returns {el, value, set(v), key(e) → handled}.
 */
export function typeField(parent, opts = {}) {
  const wrap = el('span', `mk-typed ${opts.cls || ''}`.trim(), parent);
  const text = el('span', 'txt', wrap);
  el('span', 'mk-caret', wrap);
  const max = opts.max ?? 24;
  const accept = opts.accept || ((c) => (c.length === 1 ? c : null));
  // touch: a transparent native <input> over the glyphs; tapping it (only then) opens the phone keyboard.
  // Keyboard players never focus it, so their keys keep going through key() below.
  const inp = el('input', 'mk-typein', wrap);
  Object.assign(inp, { type: 'text', autocomplete: 'off', spellcheck: false, maxLength: max, enterKeyHint: 'done' });
  inp.setAttribute('autocapitalize', 'characters');
  inp.setAttribute('autocorrect', 'off');
  inp.setAttribute('aria-label', opts.label || 'Name');
  const filter = (v) => [...String(v || '')].map((c) => accept(c)).filter(Boolean).join('').slice(0, max);
  const f = {
    el: wrap,
    input: inp,
    value: '',
    /** A prefilled default: the first typed character (or Backspace) replaces it, like selected text. */
    fresh: false,
    set(v, strike = false) {
      this.value = String(v || '').slice(0, max);
      if (inp.value !== this.value) inp.value = this.value;
      text.replaceChildren();
      [...this.value].forEach((ch, i) => {
        const g = el('span', 'g', text, ch === ' ' ? ' ' : ch);
        g.style.transform = `translateY(${((i * 7919) % 7) / 10 - 0.3}px)`; // ±0.3 r jitter, stable per glyph
        g.style.opacity = String(0.9 + ((i * 104729) % 10) / 100);
        if (strike && i === this.value.length - 1) g.classList.add('strike');
      });
      wrap.classList.toggle('fresh', this.fresh && !!this.value);
      opts.onChange?.(this.value);
    },
    key(e) {
      if (e.code === 'Backspace') {
        if (this.fresh) { this.fresh = false; this.set(''); }
        else if (this.value) this.set(this.value.slice(0, -1));
        opts.sound?.play('typeBack');
        return true;
      }
      if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const c = accept(e.key);
        if (c && this.fresh) { this.fresh = false; this.value = ''; }
        if (c && this.value.length < max) {
          this.set(this.value + c, true);
          opts.sound?.play('type');
        } else opts.sound?.play('deny');
        return true;
      }
      return false;
    },
  };
  inp.addEventListener('focus', () => {
    wrap.classList.add('focus');
    if (f.fresh) setTimeout(() => inp.select(), 0);
  });
  inp.addEventListener('blur', () => wrap.classList.remove('focus'));
  inp.addEventListener('input', () => {
    const v = filter(inp.value);
    const grew = v.length > f.value.length;
    f.fresh = false;
    f.set(v, grew);
    opts.sound?.play(grew ? 'type' : 'typeBack');
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); opts.onEnter?.(f.value); }
  });
  inp.addEventListener('click', (e) => e.stopPropagation());
  f.fresh = !!opts.fresh && !!opts.value;
  f.set(opts.value || '');
  return f;
}

/** S08 password cells: 5 typewriter key-caps, auto-advance, O→0 / I→1, paste-friendly. */
export function passwordCells(parent, opts = {}) {
  const n = opts.n ?? 5;
  const row = el('div', 'mk-cells', parent);
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', opts.label || 'Password');
  const cells = Array.from({ length: n }, () => el('span', 'mk-cell', row));
  // touch: a transparent native input over the cells opens the phone keyboard when tapped
  const inp = el('input', 'mk-typein', row);
  Object.assign(inp, { type: 'text', autocomplete: 'off', spellcheck: false, maxLength: n, enterKeyHint: 'go' });
  inp.setAttribute('autocapitalize', 'characters');
  inp.setAttribute('autocorrect', 'off');
  inp.setAttribute('aria-label', opts.label || 'Password');
  const p = {
    el: row,
    input: inp,
    value: '',
    set(v) {
      this.value = normalizePassword(v, n);
      if (inp.value !== this.value) inp.value = this.value;
      cells.forEach((c, i) => {
        c.textContent = this.value[i] || '';
        c.classList.toggle('cur', i === this.value.length);
      });
      opts.onChange?.(this.value);
    },
    key(e) {
      if (e.code === 'Backspace') {
        this.set(this.value.slice(0, -1));
        opts.sound?.play('typeBack');
        return true;
      }
      const c = e.key?.length === 1 && passwordChar(e.key);
      if (c) {
        if (this.value.length < n) {
          this.set(this.value + c);
          cells[this.value.length - 1]?.animate?.([{ transform: 'translateY(-2px)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], 60);
          opts.sound?.play('type');
        }
        return true;
      }
      return false;
    },
    flash(ok) {
      row.classList.remove('ok', 'bad');
      void row.offsetWidth;
      row.classList.add(ok ? 'ok' : 'bad');
    },
  };
  inp.addEventListener('input', () => {
    const grew = normalizePassword(inp.value, n).length > p.value.length;
    p.set(inp.value);
    opts.sound?.play(grew ? 'type' : 'typeBack');
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); opts.onEnter?.(p.value); }
  });
  inp.addEventListener('focus', () => row.classList.add('focus'));
  inp.addEventListener('blur', () => row.classList.remove('focus'));
  inp.addEventListener('click', (e) => e.stopPropagation());
  p.set('');
  return p;
}

export { hotkeyOf, codeForHotkey, stepSlider, crossedDetent, flipChoice, nextFocus, edgeFocus, firstEnabled, PAD };

// ------------------------------------------------------------------ the kit: card stack + input router

const PAD_BUTTONS = { 0: 'Enter', 1: 'Escape', 2: 'KeyX', 3: 'KeyY', 4: 'BracketLeft', 5: 'BracketRight', 6: 'PageUp', 7: 'PageDown', 8: 'View', 9: 'Start', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
const REPEATABLE = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const PASS_KEYS = new Set(['F5', 'F11', 'F12']);

export class MenuKit {
  /**
   * @param {{parent:HTMLElement, sound?:object, prefs?:() => object}} o
   */
  constructor(o) {
    this.sound = o.sound || { play() {} };
    this.prefs = o.prefs || (() => ({}));
    this.layer = el('div', 'mk-layer', o.parent);
    this.layer.hidden = true;
    this.layer.setAttribute('data-bg', 'frontend');
    this.bgHost = el('div', 'mk-bghost', this.layer); // screen-specific backgrounds (map table, black paper…)
    this.scrim = el('div', 'mk-scrim', this.layer);
    this.grain = el('div', 'mk-grain', this.layer);
    this.host = el('div', 'mk-host', this.layer);
    this.live = el('div', 'mk-sr', this.layer);
    this.live.setAttribute('aria-live', 'polite');
    this.stack = [];
    this.device = touchFirst() ? 'touch' : 'kb'; // phones start with the big BACK / SELECT touch buttons
    this.seen = new Set(); // card ids already staggered this session (B4)
    this._pad = { held: {}, t: {}, connected: false };
    this._hoverRun = 0;
    this._listen();
  }

  get active() {
    return !this.layer.hidden && this.stack.length > 0;
  }

  get top() {
    return this.stack[this.stack.length - 1] || null;
  }

  /** Open a card on top of the stack (or replace the stack with `{reset:true}`). */
  open(spec, o = {}) {
    if (o.reset) this.stack = [];
    else if (o.replace) this.stack.pop();
    const entry = { spec, focus: -1 };
    this.stack.push(entry);
    this.layer.hidden = false;
    this._render(o.reset || this.stack.length === 1 ? 'fade' : 'in');
    return entry;
  }

  /** Esc / right-click / pad B. */
  back() {
    const t = this.top;
    if (!t) return false;
    this.sound.play('back');
    if (t.spec.onBack) return t.spec.onBack(this) !== false || true;
    this.pop();
    return true;
  }

  pop() {
    const t = this.stack.pop();
    t?.spec.onClose?.();
    if (!this.stack.length) {
      this.close();
      // the owner (e.g. the in-mission menus) learns the stack emptied, unless a card replaced it synchronously
      queueMicrotask(() => { if (!this.stack.length) this.onEmpty?.(); });
      return;
    }
    this._render('back');
  }

  close() {
    for (const t of this.stack.splice(0)) t.spec.onClose?.();
    this.host.replaceChildren();
    this.bgHost.replaceChildren();
    this.layer.hidden = true;
    this.card = null;
  }

  /** Re-render the top card in place (values changed), keeping focus. */
  refresh() {
    if (this.top) this._render('none');
  }

  /** Polite live-region announcement (§1.9 screen readers). */
  announce(text) {
    this.live.textContent = '';
    setTimeout(() => { this.live.textContent = text; }, 30);
  }

  /** Note line under the list; `err` turns it red and plays ui.error. */
  note(text, err = false) {
    if (!this.card) return;
    const n = this.card.querySelector('.mk-note');
    if (!n) return;
    n.textContent = text || '';
    n.classList.toggle('err', !!err);
    if (err) {
      this.sound.play('error');
      this.announce(text);
    }
  }

  setBg(mode) {
    this.layer.setAttribute('data-bg', mode);
  }

  applyPrefs(p = this.prefs()) {
    const rm = p.reducedMotion === 'on' || (p.reducedMotion !== 'off' && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.reducedMotion = !!rm;
    const root = document.documentElement;
    root.classList.toggle('mk-rm', this.reducedMotion);
    root.classList.toggle('mk-hc', !!p.highContrast);
    root.style.setProperty('--ts', String(p.textScale || 1));
    root.style.setProperty('--grain-a', p.grain === false || p.highContrast ? '0' : '0.025');
  }

  // ---------------------------------------------------------------- rendering

  _render(mode) {
    const entry = this.top;
    const spec = entry.spec;
    this.applyPrefs();
    if (spec.bg) this.setBg(spec.bg);
    this.scrim.hidden = spec.scrim === false;
    // §1.7: the outgoing card slides and fades (−12 r / +12 r, ~140 ms) while the new one is live on frame 0 (B4)
    const prevTitle = this.card?.querySelector('.mk-title')?.textContent || null;
    for (const old of [...this.host.children]) {
      if (mode === 'none' || this.reducedMotion || old.classList.contains('leaving')) { old.remove(); continue; }
      old.classList.remove('slide-in', 'slide-back', 'enter');
      old.classList.add('leaving', mode === 'back' ? 'to-right' : 'to-left');
      old.inert = true;
      old.setAttribute('aria-hidden', 'true');
      setTimeout(() => old.remove(), 150);
    }
    this.bgHost.replaceChildren();
    spec.background?.(this.bgHost, this);
    const card = el('section', `mk-card ${spec.className || ''}`.trim());
    this.host.prepend(card); // first in document order: queries for '.mk-card' find the live card
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.dataset.card = spec.id || '';
    this.card = card;
    const box = el('div', 'mk-box', card);
    if (spec.title) {
      const h = el('h2', 'mk-title', box);
      h.id = `mk-t-${spec.id || 'card'}`;
      const s = el('span', null, h, spec.title);
      s.dataset.text = spec.title;
      card.setAttribute('aria-labelledby', h.id);
      // the stamp lands only on a fresh stack; between cards the title cross-dissolves (same title: no change)
      if (mode !== 'none' && prevTitle == null) h.classList.add('stamp-in');
      else if (mode !== 'none' && prevTitle !== spec.title) h.classList.add('dissolve');
    }
    if (spec.lines?.length) {
      const lines = el('div', 'mk-lines', box);
      for (const l of spec.lines) el('p', typeof l === 'object' ? l.cls : null, lines, typeof l === 'object' ? l.text : l);
    }
    const rows = (spec.rows || []).filter((r) => !r.hidden);
    const footer = (spec.footer || []).filter((r) => !r.hidden).map((r) => ({ kind: 'hotkey', placement: 'footer', ...r }));
    entry.rows = [...rows, ...footer];
    const list = el('div', `mk-list ${spec.layout || ''}`.trim(), box);
    list.setAttribute('role', 'menu');
    if (spec.colw) card.style.setProperty('--colw', String(spec.colw));
    if (!rows.length) list.hidden = true;
    const foot = footer.length ? el('div', 'mk-footer', box) : null;
    entry.els = entry.rows.map((r, i) => this._row(r, i, r.placement === 'footer' ? foot : list));
    spec.render?.(box, this, card);
    el('p', 'mk-note', box, spec.note || '');
    if (spec.detail) entry.detailEl = el('aside', 'mk-detail', box);
    if (spec.hints !== false) this._hints(card, spec);
    if (mode === 'in') card.classList.add('slide-in');
    else if (mode === 'back') card.classList.add('slide-back');
    const id = spec.id || spec.title;
    if (mode !== 'none' && !this.seen.has(id)) {
      this.seen.add(id);
      card.classList.add('enter');
    }
    // §1.9 focus: first enabled row, the remembered row when coming back, or the spec's default (e.g. (N)O)
    let f = entry.focus;
    if (!(f >= 0 && f < entry.rows.length)) {
      f = spec.defaultFocus != null ? (typeof spec.defaultFocus === 'function' ? spec.defaultFocus(entry.rows) : spec.defaultFocus) : firstEnabled(entry.rows);
    }
    entry.focus = -1;
    if (f >= 0) this.focus(f, { silent: true });
    spec.onOpen?.(card, this);
    // no row to focus (help, credits, end cards…): the spec's element, else the card itself
    if (!card.contains(document.activeElement)) {
      const t = spec.focusEl?.(card, this) || card;
      if (t === card) card.tabIndex = -1;
      t.focus?.({ preventScroll: true });
    }
  }

  _row(r, i, parent) {
    const kind = r.kind || 'item';
    if (kind === 'rule') return el('div', 'mk-rule', parent);
    if (kind === 'head') return el('div', 'mk-head', parent, r.label);
    const tag = kind === 'slider' ? 'div' : 'button';
    const b = el(tag, `mk-row ${kind === 'toggle' || kind === 'slider' || kind === 'bind' ? 'opt' : ''} ${r.cls || ''}`.replace(/\s+/g, ' ').trim(), parent);
    if (tag === 'button') b.type = 'button';
    b.style.setProperty('--i', String(Math.min(i, 7)));
    b.tabIndex = -1;
    b.dataset.kind = kind;
    if (r.id) b.dataset.id = r.id;
    b.setAttribute('role', kind === 'slider' ? 'slider' : 'menuitem');
    const off = r.disabled || r.locked;
    if (off) b.setAttribute('aria-disabled', 'true');
    el('span', 'mk-tab', b);
    const lab = el('span', 'mk-label', b);
    let text = typeof r.labelFn === 'function' ? r.labelFn() : r.label;
    // touch: "(ENTER) CONFIRM" / "(ESC) BACK" name keys a phone does not have; the button is the action
    if (this.device === 'touch' && typeof text === 'string') text = text.replace(/^\((ENTER|ESC|SPACE)\)\s+/, '');
    lab.innerHTML = labelHTML(text);
    if (r.hotkey == null) r.hotkey = hotkeyOf(r.label);
    if (r.locked) b.insertAdjacentHTML('beforeend', LOCK_SVG);
    if (kind === 'toggle') this._toggleVal(b, r);
    else if (kind === 'slider') this._sliderVal(b, r);
    else if (kind === 'bind') b.append(cap(r.value ?? '—', 'mk-bindcap'));
    else if (r.value != null) el('span', 'mk-value', b, `: ${r.value}`);
    if (r.sub) el('span', 'mk-sub', b, r.sub);
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && this.device !== 'touch') this.focus(i, { via: 'mouse' });
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.focus(i, { via: 'mouse', silent: true });
      if ((kind === 'toggle' || kind === 'slider') && !r.onSelect) return; // handled on the value itself
      this.activate(i);
    });
    b.addEventListener('pointerdown', () => b.classList.add('press'));
    b.addEventListener('pointerup', () => b.classList.remove('press'));
    b.addEventListener('pointerleave', () => b.classList.remove('press'));
    return b;
  }

  _toggleVal(b, r) {
    const v = r.get();
    const wrap = el('span', 'mk-val', b);
    const prev = el('span', 'chev', wrap, '◂');
    const t = el('span', 'v', wrap, (r.format || fmtChoice)(v));
    const next = el('span', 'chev', wrap, '▸');
    if (r.def !== undefined && v !== r.def) el('i', 'mk-dot', wrap).title = 'Changed from default';
    const L = typeof r.labelFn === 'function' ? r.labelFn() : r.label;
    b.setAttribute('aria-label', t.textContent ? `${L}: ${t.textContent}` : L);
    prev.addEventListener('click', (e) => { e.stopPropagation(); this.change(r, -1, { el: t }); });
    next.addEventListener('click', (e) => { e.stopPropagation(); this.change(r, 1, { el: t }); });
    t.addEventListener('click', (e) => { e.stopPropagation(); this.change(r, 1, { el: t }); });
  }

  _sliderVal(b, r) {
    const min = r.min ?? 0, max = r.max ?? 1, v = r.get();
    const s = el('span', 'mk-slider', b);
    const track = el('span', 'mk-track', s);
    const fill = el('span', 'mk-fill', track);
    const knob = el('span', 'mk-knob', track);
    const num = el('span', 'mk-num', s);
    const paint = (x) => {
      const k = (x - min) / (max - min);
      fill.style.width = `${k * 100}%`;
      knob.style.left = `${k * 100}%`;
      num.textContent = r.format ? r.format(x) : String(Math.round(k * 100));
      b.setAttribute('aria-valuenow', String(Math.round(k * 100)));
      b.setAttribute('aria-valuetext', `${num.textContent} percent`);
    };
    b.setAttribute('aria-valuemin', '0');
    b.setAttribute('aria-valuemax', '100');
    paint(v);
    r._paint = paint;
    const fromX = (e) => {
      const rc = track.getBoundingClientRect();
      const k = Math.min(1, Math.max(0, (e.clientX - rc.left) / Math.max(1, rc.width)));
      return Math.round((min + k * (max - min)) / ((max - min) / 100)) * ((max - min) / 100);
    };
    track.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      track.setPointerCapture?.(e.pointerId);
      this.setValue(r, fromX(e));
      const mv = (ev) => this.setValue(r, fromX(ev));
      const up = () => {
        track.removeEventListener('pointermove', mv);
        track.removeEventListener('pointerup', up);
        r.sample?.();
      };
      track.addEventListener('pointermove', mv);
      track.addEventListener('pointerup', up);
    });
    b.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.change(r, e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  // ---------------------------------------------------------------- focus, activation, values

  focus(i, o = {}) {
    const t = this.top;
    if (!t || !t.els?.[i] || !t.rows[i]) return;
    const prev = t.focus;
    if (prev === i && !o.force) return;
    if (prev >= 0) t.els[prev]?.classList.remove('focus');
    t.focus = i;
    const b = t.els[i];
    b.classList.add('focus');
    if (o.via !== 'mouse') b.focus?.({ preventScroll: true });
    b.scrollIntoView?.({ block: 'nearest' });
    const r = t.rows[i];
    // note line: the disabled / locked reason, else the row's own note (§1.6)
    const n = this.card?.querySelector('.mk-note');
    if (n && !n.classList.contains('err')) n.textContent = (r.disabled || r.locked) ? (r.reason || (r.locked ? 'COMING LATER' : t.spec.note || '')) : (r.note || t.spec.note || '');
    if (t.detailEl) {
      t.detailEl.replaceChildren();
      const has = t.spec.detail(r, t.detailEl, this) !== false && t.detailEl.childNodes.length > 0;
      t.detailEl.classList.toggle('on', has);
    }
    r.onFocus?.(r, this);
    if (!o.silent && prev !== i) {
      // B10: pitch-graded hover tick, +1 semitone per row down, −1 up, at most 3 steps
      const dir = prev < 0 ? 0 : Math.sign(i - prev);
      this._hoverRun = dir === Math.sign(this._hoverRun) ? this._hoverRun + dir : dir;
      this._hoverRun = Math.max(-3, Math.min(3, this._hoverRun));
      this.sound.play('hover', { semi: this._hoverRun });
    }
  }

  activate(i = this.top?.focus) {
    const t = this.top;
    const r = t?.rows[i];
    if (!r) return;
    if (r.disabled || r.locked) {
      this.sound.play('deny');
      this.note(r.reason || (r.locked ? 'COMING LATER' : ''));
      return;
    }
    if ((r.kind === 'toggle' || r.kind === 'slider') && !r.onSelect) return this.change(r, 1);
    const b = t.els[i];
    b.classList.add('press');
    setTimeout(() => b.classList.remove('press'), 80);
    if (r.hold && this.prefs().holdConfirm) return this._hold(r, b);
    if (r.silent !== true) this.sound.play(r.sound || 'select');
    r.onSelect?.(r, this);
  }

  _hold(r, b) {
    const bar = b.querySelector('.mk-hold') || el('span', 'mk-hold', b.querySelector('.mk-label'));
    bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 800, fill: 'forwards' });
    clearTimeout(this._holdT);
    this._holding = r;
    this._holdT = setTimeout(() => {
      this._holding = null;
      this.sound.play('select');
      r.onSelect?.(r, this);
    }, 800);
  }

  _cancelHold() {
    if (!this._holding) return;
    clearTimeout(this._holdT);
    this._holding = null;
    this.card?.querySelectorAll('.mk-hold').forEach((h) => h.getAnimations?.().forEach((a) => a.cancel()));
  }

  /** ←→ on a toggle / slider (§1.5.5, §1.5.6). */
  change(r, dir, o = {}) {
    if (r.disabled) return this.sound.play('deny');
    if (r.kind === 'toggle') {
      const v = flipChoice(r.choices, r.get(), dir);
      r.set(v);
      this.sound.play('toggle');
      this.refresh();
      this.card?.querySelector('.mk-row.focus .v')?.classList.add('flip');
    } else if (r.kind === 'slider') {
      this.setValue(r, stepSlider(r.get(), dir, { min: r.min, max: r.max, fine: !!o.fine }));
      clearTimeout(r._sampleT);
      r._sampleT = setTimeout(() => r.sample?.(), 260); // the channel sample plays "on release"
    }
  }

  setValue(r, v) {
    const old = r.get();
    if (v === old) return;
    r.set(v);
    if (crossedDetent(old, v, r.min ?? 0, r.max ?? 1)) this.sound.play('detent');
    r._paint?.(v);
  }

  /** Bottom-right KeyHintBar; glyphs follow the last device; each cap is clickable (the phone's touch bar). */
  _hints(card, spec) {
    const bar = el('nav', 'mk-hints', card);
    bar.setAttribute('aria-label', 'Controls');
    const pad = this.device === 'pad', touch = this.device === 'touch';
    let hints = spec.hints || [['Enter', 'SELECT'], ['Escape', spec.backLabel || 'BACK'], ['ArrowUp', 'MOVE']];
    // phones: two large touch buttons (BACK bottom-left, SELECT bottom-right); keyboard-only actions drop out
    if (touch) {
      bar.classList.add('touch');
      hints = [hints.find((x) => x[0] === 'Escape'), hints.find((x) => x[0] === 'Enter')].filter(Boolean);
    }
    for (const [code, label, fn, capText] of hints) {
      const h = el('button', `mk-hint ${touch ? `mk-touchbtn ${code === 'Escape' ? 'back' : 'go'}` : ''}`.trim(), bar);
      h.type = 'button';
      h.dataset.code = code;
      const g = pad && PAD[code];
      if (!touch) h.append(g ? cap(g[0], `pad ${g[1]}`) : cap(capText || (code === 'ArrowUp' ? '↑↓' : keyName(code))));
      if (touch) h.append(String(label).replace(/\(([A-Z0-9])\)/i, '$1')); // a tap button has no hotkey letter
      else if (hotkeyOf(label)) h.insertAdjacentHTML('beforeend', labelHTML(label)); // '(R)ESUME': letter in brass
      else h.append(label);
      h.addEventListener('click', (e) => {
        e.stopPropagation();
        if (fn) fn(this);
        else this.key({ code, key: code, preventDefault() {}, synthetic: true });
      });
    }
  }

  // ---------------------------------------------------------------- input router

  /** Keyboard (or a synthetic pad / hint event). @returns {boolean} consumed */
  key(e) {
    const t = this.top;
    if (!t) return false;
    if (PASS_KEYS.has(e.code)) return false;
    const spec = t.spec;
    // WCAG 1.4.4: Ctrl/Cmd chords (zoom, reload, copy…) belong to the browser unless the card binds them
    if ((e.ctrlKey || e.metaKey) && !spec.ctrlKeys?.includes(e.code)) return false;
    if (!e.synthetic && !e.pad) this._setDevice('kb');
    if (this._holding && e.code !== 'KeyY' && e.code !== 'Enter') this._cancelHold();
    if (spec.onKey?.(e, this)) return true;
    const rows = t.rows;
    const r = rows[t.focus];
    const fine = !!e.shiftKey;
    const move = (dir) => {
      const k = nextFocus(rows, t.focus, dir);
      if (k >= 0) this.focus(k);
    };
    switch (e.code) {
      case 'ArrowDown': move(1); return true;
      case 'ArrowUp': move(-1); return true;
      case 'Tab': move(e.shiftKey ? -1 : 1); return true;
      case 'Home': this.focus(edgeFocus(rows, 1)); return true;
      case 'End': this.focus(edgeFocus(rows, -1)); return true;
      case 'ArrowLeft': case 'ArrowRight': {
        const dir = e.code === 'ArrowRight' ? 1 : -1;
        if (r && (r.kind === 'toggle' || r.kind === 'slider')) this.change(r, dir, { fine });
        else if (r?.placement === 'footer') move(dir);
        else if (spec.onSide) spec.onSide(dir, this);
        else if (r?.onRight && dir > 0) r.onRight(r, this);
        return true;
      }
      case 'Enter': case 'Space': case 'NumpadEnter':
        if (e.repeat) return true;
        this.activate();
        return true;
      case 'Escape': this.back(); return true;
      case 'PageUp': case 'PageDown': spec.onPage?.(e.code === 'PageDown' ? 1 : -1, this); return true;
      case 'BracketLeft': case 'BracketRight': spec.onTab?.(e.code === 'BracketRight' ? 1 : -1, this); return true;
      case 'Delete': case 'KeyX':
        if (spec.onContext && r) { spec.onContext(r, this); return true; }
        break;
      case 'Start': case 'View': spec.onStart?.(this) ?? this.back(); return true;
      default:
    }
    if (spec.keys?.[e.code]) {
      spec.keys[e.code](this, e);
      return true;
    }
    // hotkey letters: (Y)ES, (N)EXT MISSION… (contract item 4)
    const k = rows.findIndex((x) => x.hotkey && codeForHotkey(x.hotkey) === e.code);
    if (k >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.focus(k, { silent: true });
      this.activate(k);
      return true;
    }
    return false;
  }

  _setDevice(d) {
    if (this.device === d) return;
    const was = this.device;
    this.device = d;
    this.layer.classList.toggle('cursorless', d === 'kb' || d === 'pad');
    document.documentElement.classList.toggle('mk-keynav', d === 'kb' || d === 'pad');
    const fam = (x) => (x === 'pad' || x === 'touch' ? x : 'kb'); // mouse shares the keyboard glyphs
    if (fam(d) !== fam(was) && this.top) {
      this.card?.querySelector('.mk-hints')?.remove();
      if (this.top.spec.hints !== false) this._hints(this.card, this.top.spec);
      this.top.spec.onDevice?.(d, this);
    }
  }

  _listen() {
    const L = this.layer;
    L.addEventListener('contextmenu', (e) => { // [orig] the right button is back everywhere
      e.preventDefault();
      if (this.active) this.back();
    });
    L.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 0)) this._setDevice('mouse');
    });
    let sx = 0, sy = 0, st = 0;
    L.addEventListener('touchstart', (e) => {
      this._setDevice('touch');
      const p = e.touches[0];
      sx = p.clientX; sy = p.clientY; st = performance.now();
    }, { passive: true });
    L.addEventListener('touchend', (e) => { // swipe right = back; left/right also turn pages (spec.onSwipe)
      const p = e.changedTouches[0];
      const dx = p.clientX - sx, dy = p.clientY - sy;
      if (performance.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) {
        if (this.top?.spec.onSwipe) this.top.spec.onSwipe(dx > 0 ? -1 : 1, this);
        else if (dx > 0) this.back();
      }
    }, { passive: true });
    L.addEventListener('click', (e) => this.top?.spec.onClick?.(e, this));
    this._onKeyUp = (e) => {
      if (this._holding && (e.code === 'KeyY' || e.code === 'Enter')) this._cancelHold();
    };
    window.addEventListener('keyup', this._onKeyUp);
    this._onPad = (e) => {
      this._pad.connected = e.type === 'gamepadconnected';
      this.onPadChange?.(this._pad.connected);
    };
    window.addEventListener('gamepadconnected', this._onPad);
    window.addEventListener('gamepaddisconnected', this._onPad);
  }

  /** Per frame: poll the Standard Gamepad (repeat after 350 ms, then every 90 ms — §1.9). */
  update(dt = 0) {
    if (!this.active || !navigator.getGamepads) return;
    const gp = [...navigator.getGamepads()].find((g) => g && g.mapping === 'standard');
    if (!gp) return;
    const P = this._pad;
    const down = {};
    for (const [bi, code] of Object.entries(PAD_BUTTONS)) if (gp.buttons[bi]?.pressed) down[code] = true;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (ay < -0.55) down.ArrowUp = true;
    if (ay > 0.55) down.ArrowDown = true;
    if (ax < -0.55) down.ArrowLeft = true;
    if (ax > 0.55) down.ArrowRight = true;
    for (const code of new Set([...Object.keys(down), ...Object.keys(P.held)])) {
      if (down[code] && !P.held[code]) {
        P.held[code] = true;
        P.t[code] = 0.35;
        this._setDevice('pad');
        this.key({ code, key: code, pad: true, preventDefault() {} });
      } else if (down[code] && REPEATABLE.has(code)) {
        P.t[code] -= dt;
        if (P.t[code] <= 0) {
          P.t[code] = 0.09;
          this.key({ code, key: code, pad: true, repeat: false, preventDefault() {} });
        }
      } else if (!down[code]) delete P.held[code];
    }
  }

  // ---------------------------------------------------------------- S13 confirmation card

  /**
   * The one confirmation card (S13): question mid-screen, `(Y)ES (N)O` pinned at the bottom (A1), default focus on
   * (N)O, optional hold-to-confirm. @returns {Promise<boolean>}
   */
  confirm(o) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        this.pop();
        resolve(v);
      };
      this.open({
        id: `confirm-${o.id || o.title}`,
        title: o.title,
        className: 'mk-confirm',
        lines: o.lines || [],
        bg: o.bg,
        footer: [
          { label: o.yes || '(Y)ES', hold: o.hold !== false, onSelect: () => finish(true) },
          { label: o.no || '(N)O', onSelect: () => finish(false) },
        ],
        defaultFocus: (rows) => rows.length - 1,
        hints: [['Escape', 'NO']],
        onBack: () => finish(false),
      });
    });
  }

  dispose() {
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('gamepadconnected', this._onPad);
    window.removeEventListener('gamepaddisconnected', this._onPad);
    this.layer.remove();
  }
}

/** Default value text for a toggle: ON / OFF, else upper-case. */
export function fmtChoice(v) {
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  return String(v).toUpperCase();
}
