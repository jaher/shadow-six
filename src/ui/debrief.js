/**
 * Mission end (design-spec §6.7; docs/menus-art-direction.md S19, S20 + amendments A1, A3, A8, B11).
 *  - S19 end cards on the B2 oxblood frozen frame: MISSION COMPLETED (any key after 1.2 s → debrief, or → TUTORIALS
 *    for a training mission), MISSION FAILED with the §8.1 reason and `(P)LAY AGAIN [(Q)UICK LOAD] (L)OAD GAME`
 *    (quick load only when a quicksave exists), and MISSION NOT COMPLETED for an early escape:
 *    `(C)ONTINUE (P)LAY AGAIN`. Hotkey rows sit on the bottom baseline (A1).
 *  - S20 debrief floating on black (A3): the olive canvas panel with red labels, enemy losses rolling up, silver and
 *    gold medal discs dropping in with ghost personal bests (B11), the merit bar, rank + PROMOTED stamp, the commando
 *    figure, the password luggage tag with (C)OPY, then `(N)EXT MISSION (P)LAY AGAIN`. Any key completes the
 *    choreography instantly.
 * Consumes the `mission:won` / `mission:lost` payload `{reason, stats, stars:{time, damage}, merit, rank, password}`.
 * @module ui/debrief
 */

import { CONFIG } from '../config.js';
import { el, fmtTime } from './dom.js';
import { labelHTML, medal, stamp } from './menu-kit.js';
import { hasQuickSave } from '../save.js';
import { isTouchUI } from './touch.js';

const REASONS = [
  [/all commandos dead|all.*(dead|captured)/i, 'ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.'],
  [/commando.*(died|dead)|man died|men died/i, 'ONE OR MORE OF YOUR MEN DIED…'],
];

/** §8.1 failure text for an internal reason string. */
export function failureText(reason) {
  const r = String(reason || '');
  for (const [re, txt] of REASONS) if (re.test(r)) return txt;
  return r ? r.toUpperCase().replace(/([^.!?…])$/, '$1.') : 'MISSION FAILED.';
}

/** Personal best for a mission from earlier wins (excluding the result just recorded). */
export function personalBest(results, missionId) {
  const wins = (results || []).filter((r) => r.missionId === missionId && r.won);
  const prev = wins.slice(0, -1);
  if (!prev.length) return null;
  return {
    time: Math.max(...prev.map((r) => r.stars?.time ?? 0)),
    damage: Math.max(...prev.map((r) => r.stars?.damage ?? 0)),
    merit: Math.max(...prev.map((r) => r.merit ?? 0)),
  };
}

/** Stamped-tin loss icons (soldier / vehicle / building). */
const TIN = {
  soldiers: '<path d="M12 5a3 3 0 1 1 0 6a3 3 0 0 1 0-6zM7 20l1-6 4-2 4 2 1 6z"/>',
  vehicles: '<path d="M4 15v-4l3-3h6l2 3h4v4zM7 17a1.6 1.6 0 1 0 0-.1zM16 17a1.6 1.6 0 1 0 0-.1z"/>',
  buildings: '<path d="M4 19V10l8-5 8 5v9h-5v-5h-6v5z"/>',
};

/**
 * S20 figure: the Green Beret ("Tiny") rendered offline from the character model (tools/ui/keyart → tiny-portrait
 * .webp), cropped by the panel's right edge, with the rank worn as cloth decals on his upper arm (chevrons; officer
 * pips on the shoulder). Returns markup for `.db-figure`.
 */
export function figureHTML(rankIx) {
  const chev = Math.max(0, Math.min(3, rankIx));
  let marks = '';
  for (let i = 0; i < chev; i++) marks += `<path d="M4 ${6 + i * 7}l10 6 10-6" fill="none" stroke="#e3d6a0" stroke-width="3.2" stroke-linejoin="round"/>`;
  if (rankIx >= 4) marks += '<circle cx="9" cy="10" r="3.6" fill="#c9a24a"/><circle cx="19" cy="10" r="3.6" fill="#c9a24a"/>';
  const decal = marks ? `<svg class="db-rankdecal" viewBox="0 0 28 30" aria-hidden="true"><path d="M1 2h26v26l-13 3-13-3z" fill="#3c3a22" opacity=".85"/>${marks}</svg>` : '';
  return `<span class="db-fimg"><img class="db-portrait" src="assets/ui/keyart/tiny-portrait.webp" alt="" decoding="async">${decal}</span>`;
}

export class Debrief {
  constructor(hud) {
    this.hud = hud;
    this.root = el('div', 'ui-end', hud.root);
    this.root.hidden = true;
    this.stage = null; // 'card' | 'debrief' | 'failed' | 'escaped'
    this.keys = {};
    this._timers = [];
  }

  get active() {
    return !!this.stage;
  }

  close() {
    this._clear();
    this.stage = null;
    this.keys = {};
    this.root.hidden = true;
    this.root.replaceChildren();
    if (this.hud.backdrop?.mode === 'mission' && !this.hud.kit?.active) this.hud.backdrop.setMode('off');
    this.hud.menus?.sync(); // a pause the card covered shows its GAME PAUSED again
  }

  _clear() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
  }

  _later(ms, fn) {
    this._timers.push(setTimeout(fn, ms));
  }

  get _rm() {
    return !!this.hud.kit?.reducedMotion;
  }

  /** An S19 card (or the S20 page) in the 640×480 r reference box. */
  _show(stage, cls, bg = 'mission') {
    this._clear();
    this.stage = stage;
    this.keys = {};
    this.root.hidden = false;
    this.root.className = `ui-end ${cls}${this._rm ? ' rm' : ''}`;
    this.root.replaceChildren();
    this.root.onclick = null;
    this.hud.backdrop?.setMode(bg === 'mission' ? 'mission' : 'off');
    this.hud.menus?.sync(); // the card covers GAME PAUSED (its (R)ESUME is not live here)
    const box = el('div', 'endbox', this.root);
    return box;
  }

  _title(box, text) {
    const h = el('h2', 'mk-title stamp-in', box);
    const s = el('span', null, h, text);
    s.dataset.text = text;
    return h;
  }

  _lines(box, lines) {
    const w = el('div', 'mk-lines', box);
    for (const l of lines) el('p', typeof l === 'object' ? l.cls : null, w, typeof l === 'object' ? l.text : l);
    return w;
  }

  /** A1 footer of hotkey rows; `rows` = [[label, code, fn]]. */
  _footer(box, rows) {
    const f = el('div', 'mk-footer', box);
    for (const [label, code, fn] of rows) {
      const b = el('button', 'mk-row', f);
      b.type = 'button';
      b.innerHTML = `<span class="mk-label">${labelHTML(label)}</span>`;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.hud.sound?.play('select'); fn(); });
      b.addEventListener('pointerenter', () => { f.querySelector('.focus')?.classList.remove('focus'); b.classList.add('focus'); });
      if (code) this.keys[code] = b;
    }
    f.firstElementChild?.classList.add('focus');
    return f;
  }

  /** Win → MISSION COMPLETED; the prompt appears after 1.2 s so a key held from play cannot skip it. */
  won(p) {
    this.payload = p || {};
    const tutorial = /^m00/.test(this.hud.def?.id || '');
    const box = this._show('card', 'won');
    this._title(box, 'MISSION COMPLETED');
    const lines = [tutorial ? 'YOU HAVE SUCCESSFULLY COMPLETED THE TUTORIAL MISSION.' : 'YOU HAVE SUCCESSFULLY COMPLETED THE MISSION.'];
    const pw = String(p?.password || '').toUpperCase();
    if (pw && !tutorial) lines.push({ text: `YOUR PASSWORD FOR THE NEXT MISSION IS ${pw}`, cls: 'pw' }); // [orig] string
    this._lines(box, lines);
    const f = el('div', 'mk-footer', box);
    const press = el('p', 'press', f, isTouchUI() ? 'TAP TO CONTINUE' : 'PRESS ANY KEY TO CONTINUE');
    this._armAt = performance.now() + (this.hud.game.manualTick ? 0 : 1200);
    this._later(this.hud.game.manualTick ? 0 : 1200, () => press.classList.add('on', 'mk-press'));
    this.root.onclick = () => this.stage === 'card' && performance.now() >= this._armAt && this._continue();
    this.hud.game.audio?.sfx?.('stinger_success');
  }

  _continue() {
    if (/^m00/.test(this.hud.def?.id || '') && this.hud.screens?.openTutorials && !this.hud.game.manualTick) {
      this.close();
      this.hud.quitToTitle();
      this.hud.screens.openMain?.();
      this.hud.screens.openTutorials();
      return;
    }
    this.debrief();
  }

  lost(p) {
    this.payload = p || {};
    const box = this._show('failed', 'failed');
    this._title(box, 'MISSION FAILED');
    this._lines(box, [failureText(p?.reason)]);
    const rows = [['(P)LAY AGAIN', 'KeyP', () => this.hud.restartMission()]];
    if (hasQuickSave()) rows.push(['(Q)UICK LOAD', 'KeyQ', () => this.hud.quickLoad()]); // A8: only when one exists
    rows.push(['(L)OAD GAME', 'KeyL', () => this._loadGame()]);
    this._footer(box, rows);
    this.hud.game.audio?.sfx?.('stinger_fail');
  }

  _loadGame() {
    this.close();
    this.hud.menus?.showSlots?.('load');
  }

  /** §8.1 "escaped before the objectives were done" (A8: (C)ONTINUE (P)LAY AGAIN). */
  escapedEarly(onContinue) {
    const g = this.hud.game;
    const was = g.state === 'playing';
    if (was) g.pause(true);
    const box = this._show('escaped', 'escaped');
    this._title(box, 'MISSION NOT COMPLETED');
    this._lines(box, ["YOU MANAGED TO ESCAPE, BUT YOU DIDN'T DESTROY THE TARGETS…"]);
    this._footer(box, [
      ['(C)ONTINUE', 'KeyC', () => {
        this.close();
        if (was) g.pause(false);
        onContinue?.();
      }],
      ['(P)LAY AGAIN', 'KeyP', () => this.hud.restartMission()],
    ]);
  }

  /** S20: the debrief floating on black (A3), with the skippable choreography. */
  debrief() {
    const p = this.payload || {};
    const flow = this.hud.game.flow;
    const C = CONFIG.mission, per = C.starsPerRank;
    const box = this._show('debrief', 'debrief', 'black');
    this.root.onclick = () => this._finish?.(); // a tap anywhere completes the roll-up, like any key
    const gold = flow?.gold ?? 0;
    const rankIx = (g) => Math.min(C.ranks.length - 1, Math.floor(Math.max(0, g) / per));
    const beforeIx = rankIx(gold - (p.merit || 0)), nowIx = rankIx(gold);
    const rankNow = String(p.rank || C.ranks[nowIx] || '').toUpperCase();
    const rankBefore = String(C.ranks[beforeIx] || rankNow).toUpperCase();
    const promoted = !!p.rank && nowIx > beforeIx;
    const best = personalBest(flow?.results, this.hud.def?.id);
    const panel = el('div', 'db-panel', box);
    el('h2', 'db-mission', panel, this.hud.def?.title || 'Mission');
    const L = el('div', 'db-left', panel);
    const R = el('div', 'db-right', panel);
    // enemy losses
    el('div', 'db-lab', L, 'ENEMY LOSSES');
    const losses = this.hud.losses();
    const counts = [];
    for (const [k, v] of [['soldiers', losses.soldiers], ['vehicles', losses.vehicles], ['buildings', losses.buildings]]) {
      const row = el('div', `db-loss ${k}`, L);
      row.insertAdjacentHTML('beforeend', `<i class="tin"><svg viewBox="0 0 24 24">${TIN[k]}</svg></i>`);
      el('span', 'k', row, k.toUpperCase());
      const n = el('b', 'v', row, '0');
      counts.push([n, Number(v) || 0]);
    }
    el('div', 'db-rule', L);
    // medal rows (B11 ghost personal bests)
    const rows = [];
    const medalRow = (label, n, kind, bestN, extra) => {
      const row = el('div', 'db-medals', L);
      el('span', 'db-lab', row, label);
      if (extra) el('span', 'db-time', row, extra);
      const discs = el('span', 'discs', row);
      const ds = [];
      for (let i = 0; i < 3; i++) {
        const slot = el('span', 'slot', discs);
        if (bestN != null && i < bestN) medal(slot, kind, 'ghost');
        ds.push(medal(slot, kind, i < n ? 'filled' : 'empty'));
        if (i < n) ds[i].classList.add('pending');
      }
      if (bestN != null && n > bestN) el('span', 'db-newbest', row, 'NEW BEST');
      rows.push({ ds, n, kind, row });
      return row;
    };
    medalRow('MISSION TIME', p.stars?.time ?? 0, 'silver', best?.time, fmtTime(this.hud.world?.clock ?? p.stats?.time ?? 0));
    medalRow('SUSTAINED DAMAGE', p.stars?.damage ?? 0, 'silver', best?.damage);
    medalRow('MISSION MERIT', p.merit ?? 0, 'gold', best?.merit);
    // merit bar
    const mb = el('div', 'db-merit', L);
    el('span', 'db-lab', mb, 'MERIT');
    const slots = el('span', 'discs', mb);
    const filled = promoted ? per : gold % per;
    const bar = [];
    for (let i = 0; i < per; i++) bar.push(medal(slots, 'gold', 'empty'));
    const nextRank = C.ranks[Math.min(C.ranks.length - 1, nowIx + 1)];
    if (nextRank && nowIx < C.ranks.length - 1) el('span', 'db-to', mb, `(TO ${String(nextRank).toUpperCase()})`);
    if (best) el('p', 'db-replay', L, 'GOLD STARS ARE RE-CREDITED ON REPLAY');
    // right: rank + figure, password tag
    const rk = el('div', 'db-rank', R);
    const rname = el('span', 'name', rk, promoted ? rankBefore : rankNow);
    const fig = el('div', 'db-figure', R);
    fig.innerHTML = figureHTML(promoted ? beforeIx : nowIx);
    const tag = el('div', 'db-pw', L); // BEL: PASSWORD is the last red-label row inside the panel
    el('span', 'db-lab', tag, 'PASSWORD');
    const cells = el('span', 'mk-cells db-tagcells', tag);
    const pw = String(p.password || '').toUpperCase();
    const cellEls = Array.from({ length: 5 }, () => el('span', 'mk-cell', cells));
    const copy = el('button', 'db-copy', tag);
    copy.type = 'button';
    copy.innerHTML = labelHTML('(C)OPY');
    copy.addEventListener('click', (e) => { e.stopPropagation(); this._copy(pw, tag); });
    // footer (A1): below the panel
    const next = this.hud.nextMissionId();
    const foot = [];
    if (next) foot.push(['(N)EXT MISSION', 'KeyN', () => this.hud.startMission(next)]);
    foot.push(['(P)LAY AGAIN', 'KeyP', () => this.hud.restartMission()]);
    this._footer(box, foot);
    this.keys.KeyC = copy;
    // choreography (S20 table); `finish` jumps to the end state
    const snd = this.hud.sound;
    const done = { counts: false, rows: [false, false, false], bar: false, pw: false, rank: false };
    const doCounts = () => { counts.forEach(([n, v]) => { n.textContent = String(v); }); done.counts = true; };
    const doRow = (i, quiet) => {
      if (done.rows[i]) return;
      done.rows[i] = true;
      const r = rows[i];
      r.ds.forEach((d, k) => {
        if (!d.classList.contains('pending')) return;
        const drop = () => { d.classList.remove('pending'); if (!quiet) { d.classList.add('drop'); snd?.play(r.kind === 'gold' ? 'clinkGold' : 'clink'); } };
        if (quiet) drop();
        else this._later(k * 150, drop);
      });
    };
    const doBar = () => { bar.forEach((d, i) => d.classList.toggle('empty', i >= filled)); done.bar = true; };
    const doPw = () => { cellEls.forEach((c, i) => { c.textContent = pw[i] || '–'; }); done.pw = true; }; // training missions carry no password
    const doRank = () => {
      if (done.rank) return;
      done.rank = true;
      if (!promoted) return;
      rname.textContent = rankNow;
      fig.innerHTML = figureHTML(nowIx);
      fig.classList.add('glint');
      stamp(rk, 'PROMOTED', { rot: -8, sound: snd, style: { left: '50%', top: '-6px' } });
    };
    this._finish = () => {
      this._clear();
      if (!done.counts) doCounts();
      rows.forEach((_, i) => doRow(i, true));
      if (!done.bar) doBar();
      if (!done.pw) doPw();
      doRank();
      this._finish = null;
    };
    if (this._rm || this.hud.game.manualTick) return this._finish();
    this._later(300, () => this._roll(counts, () => { done.counts = true; }));
    this._later(1100, () => doRow(0));
    this._later(1800, () => doRow(1));
    this._later(2500, () => doRow(2));
    this._later(3200, doBar);
    this._later(3800, () => { doPw(); snd?.play('type'); });
    this._later(4300, () => { doRank(); this._finish = null; });
  }

  /** Enemy counts roll up (600 ms each, 150 ms stagger). */
  _roll(counts, end) {
    const t0 = performance.now();
    const tick = () => {
      if (this.stage !== 'debrief') return;
      const t = performance.now() - t0;
      let all = true;
      counts.forEach(([n, v], i) => {
        const u = Math.min(1, Math.max(0, (t - i * 150) / 600));
        if (u < 1) all = false;
        n.textContent = String(Math.round(v * (1 - (1 - u) ** 3)));
      });
      if (all) end();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _copy(pw, tag) {
    if (!pw) return;
    try { navigator.clipboard?.writeText?.(pw).catch(() => {}); } catch { /* no clipboard */ }
    tag.querySelector('.mk-stamp')?.remove();
    stamp(tag, 'COPIED', { rot: -6, sound: this.hud.sound, style: { right: '4%', top: '-8px' } });
  }

  /** Keyboard: accelerator letters; any key on the card. @returns {boolean} consumed */
  key(e) {
    if (!this.stage) return false;
    if (this.stage === 'card') {
      if (performance.now() >= (this._armAt || 0)) this._continue();
      return true;
    }
    if (this._finish) { // any key completes the choreography first
      this._finish();
      return true;
    }
    const b = this.keys[e.code];
    if (b) {
      b.click();
      return true;
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      this.root.querySelector('.mk-footer .mk-row.focus')?.click();
      return true;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const rows = [...this.root.querySelectorAll('.mk-footer .mk-row')];
      const i = rows.findIndex((r) => r.classList.contains('focus'));
      const j = Math.max(0, Math.min(rows.length - 1, i + (e.code === 'ArrowLeft' ? -1 : 1)));
      rows.forEach((r, k) => r.classList.toggle('focus', k === j));
      this.hud.sound?.play('hover');
      return true;
    }
    return e.code === 'Escape' || e.code === 'KeyP'; // swallow pause keys while the end screen is up
  }
}
