/**
 * Front end (docs/menus-art-direction.md S03–S08, S12, S13; §7 reconciliation 1): BEL's MAIN → NEW GAME hierarchy on
 * the olive live-diorama background, built from the one MenuCard (menu-kit.js). MAIN: NEW GAME, SAVE GAME, LOAD GAME,
 * OPTIONS, CREDITS, HELP, QUIT GAME. NEW GAME: SINGLE PLAYER, MULTIPLAYER GAME, TUTORIALS, RESTART MISSION,
 * LOAD QUICK SAVED GAME, PASSWORD, EXIT. SINGLE PLAYER → BEHIND ENEMY LINES (continue / start / mission select) and the
 * locked BEYOND THE CALL OF DUTY. The in-mission Esc menu opens the same MAIN card on the oxblood frozen frame
 * (menus.js). Consumes game.flow and events only.
 * @module ui/screens
 */

import { CONFIG } from '../config.js';
import { MISSIONS } from '../missions/index.js';
import { hasQuickSave } from '../save.js';
import { el } from './dom.js';
import { photoPrint, passwordCells, typeField, stamp, nameTape } from './menu-kit.js';
import { profileNameChar, rankLabel } from './menu-model.js';
import { BEL_CATALOGUE, CAMPAIGN_TABS, catalogueEntry } from './catalogue.js';
import { CREDITS_INTRO, CREDITS_SECTIONS } from './credits-data.js';
import { MapTable } from './map-table.js';

import { DISCLAIMER } from './disclaimer.js';

export { DISCLAIMER };

/** Original-game tribute credit (S12 group 2): the studio, not its assets. */
const TRIBUTE = [
  ['ORIGINAL GAME', 'Commandos: Behind Enemy Lines, Pyro Studios (Madrid), 1998'],
  ['CREATED BY', 'Gonzo Suárez and the Pyro Studios team'],
  ['PUBLISHED BY', 'Eidos Interactive'],
];

const THEORY = ['MOVEMENT AND SELECTION', 'VISION CONES', 'THE KNAPSACK', 'STEALTH KILLS', 'CARRYING BODIES', 'VEHICLES', 'EXPLOSIVES'];
const TRAINING = ['TRAINING: SANDBOX', 'TRAINING: THE GREEN BERET', 'TRAINING: THE SNIPER', 'TRAINING: THE MARINE', 'TRAINING: THE SAPPER', 'TRAINING: THE DRIVER'];

export class Screens {
  constructor(hud) {
    this.hud = hud;
    this.map = new MapTable(this);
  }

  get kit() { return this.hud.kit; }
  get game() { return this.hud.game; }
  get flow() { return this.hud.game.flow; }
  get inMission() { return !!this.hud.world; }
  get bg() { return this.inMission ? 'mission' : 'frontend'; }

  /** Everything the front end has open. */
  hideAll() {
    if (!this.inMission) this.kit.close();
  }

  /** main.js hook (§6.8): the HUD owns the front end; #title only hosts the disclaimer for no-JS fallbacks. */
  buildTitle(menu) {
    menu?.replaceChildren();
    const title = document.getElementById('title');
    title?.classList.add('ui-title-kit');
    const disc = title?.querySelector('.disclaimer');
    if (disc) disc.textContent = DISCLAIMER;
    if (!this.hud.boot?.active) this.enter();
    return true;
  }

  /** Into the front end: S04 on first run (CREATE NEW USER?), else MAIN. */
  enter() {
    const prof = this.hud.profiles;
    if (prof && !prof.firstRunDone && !prof.current) {
      this.hud.backdrop?.setMode(this.bg);
      this.newUser(() => this.openMain());
    } else this.openMain();
  }

  // ---------------------------------------------------------------- S05 MAIN

  mainSpec() {
    const hud = this.hud, inM = this.inMission;
    return {
      id: 'main',
      title: 'MAIN MENU',
      bg: this.bg,
      rows: [
        { label: 'NEW GAME', id: 'newgame', onSelect: () => this.openNewGame() },
        { label: 'SAVE GAME', id: 'save', disabled: !inM, reason: 'NO MISSION IN PROGRESS', onSelect: () => hud.menus.showSlots('save') },
        { label: 'LOAD GAME', id: 'load', disabled: !inM && hud.menus?.hasAnySave?.() === false, reason: 'NO SAVED GAMES', onSelect: () => hud.menus.showSlots('load') },
        { label: 'OPTIONS', id: 'options', onSelect: () => hud.menus.showOptions() },
        { label: 'CREDITS', id: 'credits', onSelect: () => this.showCredits() },
        { label: 'HELP', id: 'help', onSelect: () => hud.menus.showHelp() },
        { label: 'QUIT GAME', id: 'quit', onSelect: () => this.quit() },
      ],
      // in mission: Esc / R / right-click / pad B resume; no RESUME row is added (contract item 8)
      hints: inM ? [['Escape', '(R)ESUME'], ['Enter', 'SELECT'], ['ArrowUp', 'MOVE']] : [['Enter', 'SELECT'], ['ArrowUp', 'MOVE']],
      onBack: inM ? () => hud.menus.close(true) : () => false,
      keys: inM ? { KeyR: () => hud.menus.close(true) } : { KeyC: () => this.continueCampaign(true) }, // (R)ESUME / (C)ONTINUE
      render: (box, kit, card) => this._profileTab(card),
      onStart: inM ? () => hud.menus.close(true) : () => this.continueCampaign(true),
    };
  }

  openMain() {
    this.hud.backdrop?.setMode(this.bg);
    this.kit.open(this.mainSpec(), { reset: true });
    this.hud.game.audio?.music?.('menu');
  }

  /** Bottom-left NameTape → LAST OPERATION PhotoPrint tab (amendment B5; hidden on first run). */
  _profileTab(card) {
    if (this.inMission) return;
    const prof = this.hud.profiles;
    const last = prof?.last;
    const next = this.nextMission();
    const rank = rankLabel(CONFIG.mission.ranks, this.flow?.rank ?? 0);
    if (last && next) {
      const b = el('button', 'mk-lastop', card);
      b.type = 'button';
      photoPrint(b, { src: last.thumb || null, grade: 'sepia' });
      const t = el('span', 'txt', b);
      el('span', null, t, 'LAST OPERATION');
      el('b', null, t, `MISSION ${next.n}: ${next.title.toUpperCase()}`);
      el('span', null, t, `${prof.current || ''} · ${rank}`);
      el('span', null, t).innerHTML = '(<span class="mk-hk">C</span>)ONTINUE';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.continueCampaign(true); });
    } else if (prof?.current) {
      const b = el('button', 'mk-lastop', card);
      b.type = 'button';
      nameTape(b, `${prof.current} · ${rank}`);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.hud.menus.showOptions(); });
    }
  }

  /** Highest unlocked BEL mission that exists (the campaign's "continue"). */
  nextMission() {
    const f = this.flow;
    if (!f) return null;
    let best = null;
    for (const m of f.missions) if (f.unlocked(m.id)) best = m;
    if (!best) return null;
    const c = catalogueEntry(best) || {};
    return { id: best.id, n: f.numberOf(best.id), title: best.title || c.title || best.id };
  }

  get hasProgress() {
    const f = this.flow;
    return !!f && (f.gold > 0 || f.missions.filter((m) => f.unlocked(m.id)).length > 1 || f.results.length > 0);
  }

  continueCampaign(fromTab = false) {
    const n = this.nextMission();
    if (!n || (fromTab && !this.hud.profiles?.last && !this.hasProgress)) return;
    this.hud.startMission(n.id);
  }

  // ---------------------------------------------------------------- S06 NEW GAME

  openNewGame() {
    const hud = this.hud, inM = this.inMission, q = hasQuickSave();
    this.kit.open({
      id: 'newgame',
      title: 'NEW GAME',
      bg: this.bg,
      rows: [
        { label: 'SINGLE PLAYER', onSelect: () => this.openSinglePlayer() },
        { label: 'MULTIPLAYER GAME', disabled: true, reason: 'NOT AVAILABLE IN THIS TRIBUTE' },
        { label: 'TUTORIALS', onSelect: () => this.openTutorials() },
        { label: 'RESTART MISSION', disabled: !inM, reason: 'NO MISSION IN PROGRESS', onSelect: () => this.restartMission() },
        { label: 'LOAD QUICK SAVED GAME', id: 'quickload', disabled: !q, reason: 'NO QUICK SAVE', onSelect: () => hud.loading.quickLoad() },
        { label: 'PASSWORD', onSelect: () => this.openPassword() },
        { label: 'EXIT', onSelect: () => this.kit.pop() },
      ],
      detail: (r, pane) => (r.id === 'quickload' && q ? hud.menus.quickDetail(pane) : false),
    });
  }

  async restartMission() {
    const ok = await this.kit.confirm({ id: 'restart', title: 'RESTART MISSION', lines: ['RESTART THE CURRENT MISSION?', 'PROGRESS SINCE YOUR LAST SAVE WILL BE LOST.'] });
    if (ok) this.hud.loading.restart();
  }

  // ---------------------------------------------------------------- S06a SINGLE PLAYER → BEHIND ENEMY LINES

  /**
   * SINGLE PLAYER: BEL went straight to the briefing. While BEYOND THE CALL OF DUTY is locked the campaign-choice card
   * adds nothing, so SINGLE PLAYER opens BEHIND ENEMY LINES directly (focus CONTINUE, or START CAMPAIGN on a fresh
   * profile): Enter, Enter reaches the briefing.
   */
  openSinglePlayer() {
    if (CAMPAIGN_TABS.find((t) => t.id === 'BCD')?.locked !== false) return this.openBEL();
    return this.openCampaigns();
  }

  /** The campaign choice (BEL | BCD), once BCD ships. */
  openCampaigns() {
    this.kit.open({
      id: 'single',
      title: 'SINGLE PLAYER',
      bg: this.bg,
      rows: [
        { label: 'BEHIND ENEMY LINES', onSelect: () => this.openBEL() },
        { label: 'BEYOND THE CALL OF DUTY', locked: true, reason: 'COMING LATER' },
        { label: 'EXIT', onSelect: () => this.kit.pop() },
      ],
    });
  }

  openBEL() {
    const n = this.nextMission();
    const prog = this.hasProgress && n;
    this.kit.open({
      id: 'bel',
      title: 'BEHIND ENEMY LINES',
      bg: this.bg,
      rows: [
        { label: prog ? `CONTINUE — MISSION ${n.n}: ${n.title.toUpperCase()}` : 'CONTINUE', hidden: !prog, sub: rankLabel(CONFIG.mission.ranks, this.flow?.rank ?? 0), onSelect: () => this.continueCampaign() },
        { label: 'START CAMPAIGN', onSelect: () => this.startCampaign() },
        { label: 'MISSION SELECT', onSelect: () => this.map.open('BEL') },
        { label: 'EXIT', onSelect: () => this.kit.pop() },
      ],
    });
  }

  async startCampaign() {
    const first = this.flow?.missions?.[0];
    if (!first) return;
    if (this.hasProgress) {
      const ok = await this.kit.confirm({ id: 'startcampaign', title: 'START CAMPAIGN', lines: ['START THE CAMPAIGN FROM MISSION 1?', 'YOUR PASSWORDS STILL OPEN LATER MISSIONS.'] });
      if (!ok) return;
    }
    this.hud.startMission(first.id);
  }

  // ---------------------------------------------------------------- S07 TUTORIALS (BEL's 13-row rhythm)

  openTutorials() {
    const sandbox = MISSIONS.find((m) => m.id === 'm00');
    const later = [...THEORY, ...TRAINING.slice(1)];
    const rows = [{ kind: 'head', label: 'TRAINING MISSIONS' }];
    if (sandbox) {
      rows.push({
        label: TRAINING[0], id: 'sandbox', onSelect: () => this.hud.startMission('m00', { tutorial: true }),
        help: 'A quiet stretch of snow with a relay station to blow: move, crawl, use the knife and the knapsack, and try every order without an alarm sounding.',
      });
    }
    // the unbuilt drills wait behind one row instead of a wall of padlocks
    rows.push({ label: 'MORE DRILLS — COMING LATER', id: 'later', locked: true, reason: `${later.length} THEORY SESSIONS AND TRAINING MISSIONS IN PREPARATION`, help: later.join(' · ') });
    rows.push({ kind: 'rule' }, { label: 'EXIT', onSelect: () => this.kit.pop() });
    this.kit.open({
      id: 'tutorials', title: 'TUTORIALS', bg: this.bg, rows, className: 'mk-compact mk-tutorials', colw: 240,
      detail: (r, pane) => {
        if (!r.help) return false;
        el('div', 'desc', pane, r.help);
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- S08 PASSWORD

  openPassword() {
    const hud = this.hud, kit = this.kit;
    let cells = null;
    let busy = false;
    const accept = () => {
      if (busy) return;
      if (cells.value.length < 5) return kit.note('ENTER ALL FIVE CHARACTERS', true);
      const id = this.flow?.enterPassword(cells.value);
      if (!id) {
        cells.flash(false);
        kit.note('WRONG PASSWORD', true);
        busy = true;
        setTimeout(() => { busy = false; cells.set(''); }, 400);
        return;
      }
      busy = true;
      cells.flash(true);
      kit.sound.play('bell');
      const n = this.flow.numberOf(id);
      kit.note(`MISSION ${n} — ${rankLabel(CONFIG.mission.ranks, this.flow.rank)}`);
      kit.announce(`Password accepted. Mission ${n}.`);
      setTimeout(() => hud.startMission(id), 600);
    };
    kit.open({
      id: 'password',
      title: 'PASSWORD',
      bg: this.bg,
      lines: [{ text: 'ENTER THE PASSWORD FOR YOUR MISSION', cls: 'cream' }],
      render: (box) => {
        const w = el('div', 'mk-pwwrap', box);
        cells = passwordCells(w, { sound: kit.sound, onChange: () => kit.note(''), onEnter: () => accept() });
        w.addEventListener('paste', (e) => cells.set(e.clipboardData?.getData('text') || ''));
        this.pw = cells;
      },
      footer: [
        { label: '(ENTER) ACCEPT', hotkey: '', onSelect: accept, silent: true },
        { label: '(ESC) EXIT', hotkey: '', onSelect: () => kit.pop() },
      ],
      hints: false,
      onKey: (e) => {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { accept(); return true; }
        if (e.code === 'Escape') return false;
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
          navigator.clipboard?.readText?.().then((t) => cells.set(t)).catch(() => {});
          return true;
        }
        return !busy && cells.key(e);
      },
    });
    return cells;
  }

  // ---------------------------------------------------------------- S12 CREDITS

  showCredits() {
    const kit = this.kit;
    let scroller = null, y = 0, speed = 1, raf = 0, last = 0, page = 0, hold = 0;
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const paged = () => kit.reducedMotion;
    const step = (now) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      if (!scroller?.isConnected) return stop();
      const r = Math.min(innerWidth / 640, innerHeight / 480);
      const end = scroller.scrollHeight - scroller.parentElement.clientHeight * 0.5;
      if (y >= end) {
        hold += dt;
        if (hold > 3) { stop(); kit.pop(); }
        return;
      }
      y = Math.max(0, y + 24 * r * speed * dt);
      scroller.style.transform = `translateY(${-y}px)`;
    };
    kit.open({
      id: 'credits',
      title: 'CREDITS',
      bg: this.bg,
      className: 'mk-credits',
      scrim: true,
      render: (box) => {
        const vp = el('div', 'mk-roll', box);
        vp.tabIndex = 0; // the focusable scroll region: screen readers read the roll, the focus ring shows
        vp.setAttribute('role', 'region');
        vp.setAttribute('aria-label', 'Credits. Down arrow speeds up, Escape returns.');
        scroller = el('div', 'mk-rollin', vp);
        this._creditsContent(scroller);
        this.game.audio?.music?.('credits');
        if (!paged()) raf = requestAnimationFrame(step);
      },
      hints: [['ArrowDown', 'FASTER'], ['Escape', 'BACK']],
      focusEl: (card) => card.querySelector('.mk-roll'),
      onKey: (e) => {
        if (e.code === 'ArrowDown' || e.code === 'PageDown') {
          if (paged()) this._page(scroller, ++page);
          else speed = e.code === 'PageDown' ? 12 : 4;
          return true;
        }
        if (e.code === 'ArrowUp' || e.code === 'PageUp') {
          if (paged()) this._page(scroller, page = Math.max(0, page - 1));
          else speed = -4;
          return true;
        }
        if (e.code === 'Enter' || e.code === 'Space') {
          if (paged()) this._page(scroller, ++page);
          else speed = speed === 1 ? 4 : 1;
          return true;
        }
        return false;
      },
      onClose: () => { stop(); this.game.audio?.music?.('menu'); },
    });
  }

  _page(sc, n) {
    const h = sc.parentElement.clientHeight * 0.85;
    sc.style.transform = `translateY(${-Math.min(n * h, Math.max(0, sc.scrollHeight - h))}px)`;
  }

  _creditsContent(sc) {
    const sect = (title, rows) => {
      const s = el('section', null, sc);
      el('h3', null, s, title);
      for (const [role, name, extra] of rows) {
        const p = el('p', null, s);
        el('span', 'role', p, role);
        el('span', 'name', p, name);
        if (extra) el('span', 'lic', p, extra);
      }
    };
    el('div', 'mk-wm mk-rollmark', sc).setAttribute('aria-label', 'SHADOW SIX');
    sect('SHADOW SIX', [['GAME, CODE AND TEXT', 'The SHADOW SIX team, built with Claude'], ['ENGINE', 'three.js (MIT licence)']]);
    sect('A TRIBUTE TO', TRIBUTE);
    const byTitle = Object.fromEntries(CREDITS_SECTIONS.map((s) => [s.title, s]));
    const fonts = byTitle.FONTS?.rows || [];
    sect('TYPEFACES', fonts.filter((r) => !/woff2 \(menu subsets/.test(r[0])).map((r) => [r[0].replace(/assets\/fonts\/|\(.*\)/g, '').trim(), r[2], r[3].replace(/\(.*\)/, '').trim()]));
    sect('CC0 AND PUBLIC-DOMAIN ASSETS', (byTitle['ART ASSETS']?.rows || []).map((r) => [r[0].replace(/assets\/ui\/(tex\/)?|\(.*\)/g, '').trim(), `${r[1]} · ${r[2]}`, r[3]]));
    sect('CODE', (byTitle.CODE?.rows || []).map((r) => [r[0], r[1], r[2]]));
    sect('AUDIO', (byTitle.AUDIO?.rows || []).filter((r) => r[1] !== '—').map((r) => [r[0].replace(/\(.*\)/, '').trim(), r[1], r[3]]));
    sect('GENERATED ART', [['FLUX.1-schnell (Apache-2.0)', 'reserved for briefing stills and dossier portraits; none shipped yet']]);
    const d = el('section', 'disc', sc);
    el('h3', null, d, 'DISCLAIMER');
    el('p', null, d, CREDITS_INTRO || DISCLAIMER);
    el('img', 'mk-rollemblem', sc).src = 'assets/ui/emblem.svg';
  }

  // ---------------------------------------------------------------- S13 quit

  async quit() {
    const hud = this.hud, kit = this.kit;
    if (this.inMission) {
      const ok = await kit.confirm({ id: 'quitmission', title: 'QUIT MISSION', lines: ['QUIT THE MISSION?', 'ALL PROGRESS SINCE YOUR LAST SAVE WILL BE LOST.'] });
      if (ok) {
        hud.quitToTitle();
        this.openMain();
      }
      return;
    }
    const ok = await kit.confirm({ id: 'quitgame', title: 'QUIT GAME', lines: ['ARE YOU SURE YOU WANT TO QUIT?'] });
    if (!ok) return;
    this.game.audio?.music?.('exit');
    kit.open({ id: 'mundane', bg: 'black', scrim: false, hints: false, lines: [{ text: 'RETURNING YOU TO MUNDANE REALITY…', cls: 'cream' }], onKey: () => true, onBack: () => true }, { reset: true });
    hud.backdrop?.setMode('off');
    setTimeout(() => hud.boot?.showSplash({ ready: true }), 1800);
  }

  // ---------------------------------------------------------------- S04 NEW USER / SELECT USER

  /** First run: "CREATE NEW USER? (Y)ES (N)O"; (N)O creates COMMANDO. `done` runs once a profile exists. */
  async newUser(done) {
    const prof = this.hud.profiles;
    const yes = await this.kit.confirm({ id: 'newuser', title: 'NEW USER', lines: [{ text: 'CREATE NEW USER?', cls: 'cream' }], hold: false, bg: this.bg });
    if (!yes) {
      if (prof.create('COMMANDO') === 'exists') prof.select('COMMANDO');
      prof.firstRunDone = true;
      prof.save();
      return done?.();
    }
    this.enterName({ title: 'NEW USER', onDone: done });
  }

  /** The service-book page with a typewriter name field (max 12: A–Z, 0–9, space, '-'). */
  enterName(o = {}) {
    const kit = this.kit, prof = this.hud.profiles;
    let field = null, sheet = null, done = false;
    const confirm = () => {
      if (done) return;
      const name = field.value.trim();
      const res = o.rename ? prof.rename(name) : prof.create(name);
      if (res === 'empty') return kit.note('ENTER A NAME', true);
      if (res === 'exists') return kit.note('THIS NAME ALREADY EXISTS', true);
      if (res === 'full') return kit.note('EIGHT SOLDIERS ALREADY ENLISTED — DELETE ONE FIRST', true);
      done = true;
      prof.firstRunDone = true;
      prof.save();
      kit.sound.play('bell');
      stamp(sheet, o.rename ? 'AMENDED' : 'ENLISTED', { sound: kit.sound, rot: -9, style: { right: '8%', top: '38%' } });
      kit.announce(`${name} enlisted.`);
      setTimeout(() => (o.onDone ? o.onDone() : kit.pop()), 700);
    };
    kit.open({
      id: 'name',
      title: o.title || 'NEW USER',
      bg: this.bg,
      render: (box) => {
        sheet = el('div', 'mk-paper mk-servicebook', box);
        el('div', 'mk-letterhead', sheet, "SOLDIER'S SERVICE AND PAY BOOK");
        const f = el('div', 'fld', sheet);
        el('span', 'k', f, 'NAME:');
        // a default name (COMMANDO, COMMANDO 2…) so CONFIRM works without a keyboard; the first key replaces it
        const def = o.rename ? prof.current : defaultProfileName(prof);
        field = typeField(f, { max: 12, accept: profileNameChar, sound: kit.sound, value: def, fresh: !o.rename, label: 'Soldier name', onEnter: () => confirm(), onChange: (v) => {
          kit.note('');
          const ok = kit.top?.els?.find((b) => b.dataset.id === 'confirm');
          ok?.setAttribute('aria-disabled', v.trim() ? 'false' : 'true');
        } });
        const r = el('div', 'fld', sheet);
        el('span', 'k', r, 'RANK:');
        el('span', 'mk-typed', r, rankLabel(CONFIG.mission.ranks, this.flow?.rank ?? 0));
        sheet.animate?.([{ transform: 'translateY(40%) rotate(-0.8deg)', opacity: 0 }, { transform: 'rotate(-0.8deg)', opacity: 1 }], { duration: kit.reducedMotion ? 120 : 320, easing: 'cubic-bezier(.22,.8,.26,1)' });
        kit.sound.play('paper');
      },
      footer: [
        { label: '(ENTER) CONFIRM', id: 'confirm', hotkey: '', onSelect: confirm, silent: true },
        { label: '(ESC) BACK', hotkey: '', onSelect: () => kit.back() },
      ],
      hints: false,
      onBack: o.onBack || (() => { kit.pop(); }),
      onKey: (e) => {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { confirm(); return true; }
        if (e.code === 'Escape' || /^Arrow/.test(e.code)) return false;
        return field.key(e);
      },
    });
  }

  /** More than one profile: SELECT USER (up to 8 names), NEW USER, DELETE USER. */
  selectUser(done) {
    const kit = this.kit, prof = this.hud.profiles;
    const rows = prof.list.map((p) => ({ kind: 'slot', label: p.name, cls: p.name === prof.current ? 'current' : '', sub: p.name === prof.current ? 'CURRENT' : '', onSelect: () => { prof.select(p.name); kit.pop(); done?.(); } }));
    rows.push({ kind: 'rule' }, { label: 'NEW USER', disabled: prof.list.length >= 8, reason: 'EIGHT SOLDIERS ALREADY ENLISTED', onSelect: () => this.enterName({ title: 'NEW USER', onDone: () => { kit.pop(); kit.pop(); done?.(); } }) },
      { label: 'DELETE USER', disabled: prof.list.length < 2, reason: 'THE LAST SOLDIER CANNOT BE DELETED', onSelect: () => this._deleteUser(done) },
      { label: 'EXIT', onSelect: () => kit.pop() });
    kit.open({ id: 'selectuser', title: 'SELECT USER', bg: this.bg, layout: 'slots', rows });
  }

  async _deleteUser(done) {
    const kit = this.kit, prof = this.hud.profiles;
    const name = prof.current;
    const ok = await kit.confirm({ id: 'deluser', title: 'DELETE USER', lines: [`DELETE ${name}?`, 'THIS SOLDIER\'S NAME WILL BE STRUCK FROM THE ROLL.'] });
    if (!ok) return;
    prof.remove(name);
    kit.pop();
    this.selectUser(done);
  }
}

/** The first free default soldier name: COMMANDO, COMMANDO 2, COMMANDO 3… */
function defaultProfileName(prof) {
  for (let i = 1; i < 99; i++) {
    const n = i === 1 ? 'COMMANDO' : `COMMANDO ${i}`;
    if (!prof?.exists?.(n)) return n;
  }
  return '';
}
