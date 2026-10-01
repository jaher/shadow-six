/**
 * HELP: the field folder (docs/menus-art-direction.md S11, amendment B2: paper + print, leather only as the folder
 * edge). Three tabbed sections on card-stock index tabs — CONTROLS (typed key sheets built from the current
 * bindings), COMMANDOS (a dossier spread per man: typed PERSONNEL FILE + paper-clipped print + kit icons + MOST SECRET
 * stamp) and ENEMIES (silhouette prints + behaviour notes). LB/RB or ←→ turn pages; swipe on phones.
 * @module ui/help
 */

import { KEY_BINDINGS, CTRL_BINDINGS, SHIFT_BINDINGS } from '../engine/input.js';
import { getPortraitURL } from '../art/portraits.js';
import { el } from './dom.js';
import { photoPrint, stamp, cap, keyName } from './menu-kit.js';
import { ITEM_ICONS } from './icons.js';
import { iconHTML, itemArt } from './icon-art.js';
import { bcdHelpRows } from './bcd-ui.js';

/** Our own dossier text, from docs/character-bible.md §1 (names per the US manual). */
export const DOSSIERS = [
  { role: 'greenberet', no: 1, name: 'JERRY McHALE', code: 'TINY', born: '10 OCT 1909, DUBLIN', spec: 'GREEN BERET — CLOSE COMBAT', kit: ['knife', 'pistol', 'decoy', 'shovel'],
    notes: 'Former Army heavyweight champion and a sergeant. The strongest of the six: he carries bodies and barrels as if they were kit bags, climbs walls and poles, and digs into sand or snow. His knife is silent.' },
  { role: 'sniper', no: 2, name: 'SIR FRANCIS T. WOOLRIDGE', code: 'DUKE', born: '21 MAR 1909, SHEFFIELD', spec: 'SNIPER', kit: ['sniperRifle', 'pistol', 'firstAid'],
    notes: 'A patient marksman with a hunter\'s eye. His rifle reaches men nobody else can touch, but his rounds are few: every shot must count. He also carries the team\'s first-aid kit on most operations.' },
  { role: 'diver', no: 3, name: 'JAMES BLACKWOOD', code: 'FINS', born: '3 AUG 1911, MELBOURNE', spec: 'MARINE — WATER OPERATIONS', kit: ['knife', 'harpoon', 'divingGear', 'inflatableBoat'],
    notes: 'The youngest-looking of the six and at home in the water. He swims under the surface, rows the inflatable, and fires a harpoon gun silently from the shore.' },
  { role: 'sapper', no: 4, name: 'THOMAS HANCOCK', code: 'INFERNO', born: '14 JAN 1911, LIVERPOOL', spec: 'SAPPER — EXPLOSIVES', kit: ['timeBomb', 'remoteBomb', 'grenade', 'wireCutters', 'bearTrap'],
    notes: 'Explosives are his trade: time bombs, remote charges, grenades and traps. His wire cutters open a fence without a sound.' },
  { role: 'driver', no: 5, name: 'SID PERKINS', code: 'TREAD', born: '4 APR 1910, BROOKLYN', spec: 'DRIVER — VEHICLES AND GUNS', kit: ['smg', 'pistol', 'firstAid'],
    notes: 'He drives anything with an engine and mans any gun. His submachine gun is loud; his getaway driving is the team\'s way home.' },
  { role: 'spy', no: 6, name: 'RENÉ DUCHAMP', code: 'SPOOKY', born: '20 NOV 1911, LYON', spec: 'SPY — INFILTRATION', kit: ['uniform', 'lethalInjection', 'firstAid'],
    notes: 'In a borrowed uniform he walks among the enemy, talks soldiers into looking away and gives orders to the ones who believe him. Officers see through it; so does anyone who catches him acting strangely.' },
];

export const ENEMIES = [
  ['SOLDIER', 'Walks his route or holds his post. Sees in two bands: crawling men only in the near one.'],
  ['SENTRY', 'Stands at gates and towers, turning his head. Towers see over low walls and crates.'],
  ['SERGEANT', 'Leads patrols. Investigates what he hears and finds, then walks back.'],
  ['OFFICER', 'Wanders and notices details. Sees through the Spy\'s uniform.'],
  ['MACHINE GUNNER', 'Holds a nest. Deadly in his cone; blind outside it.'],
  ['DOG', 'Smells and hears you before he sees you, and barks to raise the alarm.'],
  ['CREW', 'Drives trucks, tanks and boats. Engines give them away early.'],
];

const SILHOUETTE = '<svg viewBox="0 0 60 80"><rect width="60" height="80" fill="#cfc8b2"/><path d="M30 10c6 0 9 4 9 9s-3 9-9 9-9-4-9-9 3-9 9-9zm-13 7c3-6 23-6 26 0v3H17z" fill="#1b1a16"/><path d="M14 80l2-34c1-9 6-14 14-14s13 5 14 14l2 34z" fill="#1b1a16"/></svg>';

const GROUPS = [
  ['SELECTION', ['select1', 'select2', 'select3', 'select4', 'select5', 'select6', 'select7', 'selectAll', 'deselect', 'centerSelection']],
  ['MOVEMENT', ['crawl', 'stand', 'dragBody']],
  ['CAMERA', ['panUp', 'panDown', 'panLeft', 'panRight', 'zoomIn', 'zoomOut', 'zoomReset', 'views1', 'views2', 'views3']],
  ['TOOLS', ['knapsackSide', 'help', 'pause', 'cancel']],
  ['SAVING', ['quickSave', 'quickLoad']],
];

export class Help {
  constructor(hud) {
    this.hud = hud;
    this.section = 'controls';
    this.page = 0;
  }

  pages() {
    if (this.section === 'controls') return 2;
    if (this.section === 'commandos') return DOSSIERS.length;
    return 1;
  }

  open(section = this.section, page = 0) {
    const hud = this.hud, kit = hud.kit;
    this.section = section;
    this.page = Math.max(0, Math.min(this.pages() - 1, page));
    const turn = (d) => {
      const n = this.page + d;
      const order = ['controls', 'commandos', 'enemies'];
      if (n < 0 || n >= this.pages()) {
        const si = order.indexOf(this.section) + d;
        if (si < 0 || si >= order.length) return kit.sound.play('deny');
        this.section = order[si];
        this.page = d > 0 ? 0 : this.pages() - 1;
      } else this.page = n;
      kit.sound.play('paper');
      kit.pop();
      this.open(this.section, this.page);
    };
    const replace = kit.top?.spec.id === 'help';
    kit.open({
      id: 'help',
      title: 'HELP',
      bg: hud.world ? 'mission' : 'frontend',
      className: 'mk-help',
      scrim: false,
      rows: [],
      render: (box) => this._folder(box, turn),
      hints: [['Digit1', 'SECTION', null, '1–3'], ['BracketLeft', 'PAGE', () => turn(-1), '← →'], ['Escape', 'EXIT']],
      onSide: (d) => turn(d),
      onTab: (d) => turn(d),
      onSwipe: (d) => turn(d),
      // the index tabs are a roving-tabindex tablist: ↑↓ (or 1/2/3) switch sections, ←→ / [ ] turn pages
      onKey: (e) => {
        if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return false;
        const order = ['controls', 'commandos', 'enemies'];
        const i = order.indexOf(this.section) + (e.code === 'ArrowDown' ? 1 : -1);
        if (i >= 0 && i < order.length) this._goto(order[i]);
        else kit.sound.play('deny');
        return true;
      },
      focusEl: (card) => card.querySelector('.mk-indextab.on'),
      onDevice: (d, k) => this._pagerCaps(k.card, d),
      keys: { Digit1: () => this._goto('controls'), Digit2: () => this._goto('commandos'), Digit3: () => this._goto('enemies') },
      onBack: () => { kit.pop(); if (!kit.active) hud.menus.close(true); },
    }, { replace });
    if (!replace) kit.sound.play('paper');
  }

  _goto(section) {
    this.hud.kit.pop();
    this.open(section, 0);
  }

  _folder(box, turn) {
    const folder = el('div', 'mk-folder', box);
    const tabs = el('div', 'mk-indextabs', folder);
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Help sections');
    tabs.setAttribute('aria-orientation', 'vertical');
    for (const [n, [id, label]] of [['controls', 'CONTROLS'], ['commandos', 'COMMANDOS'], ['enemies', 'ENEMIES']].entries()) {
      const t = el('button', `mk-indextab ${id === this.section ? 'on' : ''}`, tabs, label);
      t.type = 'button';
      t.id = `mk-help-${id}`;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(id === this.section));
      t.setAttribute('aria-controls', 'mk-help-spread');
      t.setAttribute('aria-keyshortcuts', String(n + 1));
      t.tabIndex = id === this.section ? 0 : -1;
      t.addEventListener('click', (e) => { e.stopPropagation(); this._goto(id); });
    }
    const spread = el('div', `mk-spread ${this.section}`, folder);
    spread.id = 'mk-help-spread';
    spread.setAttribute('role', 'tabpanel');
    spread.setAttribute('aria-labelledby', `mk-help-${this.section}`);
    const L = el('div', 'mk-page mk-paper left', spread);
    const R = el('div', 'mk-page mk-paper right', spread);
    if (this.section === 'controls') this._controls(L, R);
    else if (this.section === 'commandos') this._dossier(L, R, DOSSIERS[this.page]);
    else this._enemies(L, R);
    const nav = el('div', 'mk-pagenav', folder);
    const prev = el('button', 'mk-hint prev', nav);
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous page');
    prev.addEventListener('click', (e) => { e.stopPropagation(); turn(-1); });
    el('span', 'mk-pageno', nav, `${this.page + 1} / ${this.pages()}`);
    const next = el('button', 'mk-hint next', nav);
    next.type = 'button';
    next.setAttribute('aria-label', 'Next page');
    next.addEventListener('click', (e) => { e.stopPropagation(); turn(1); });
    this._pagerCaps(folder, this.hud.kit.device);
    if (!this.hud.kit.reducedMotion) spread.animate?.([{ transform: 'perspective(1200px) rotateY(-8deg)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.22,.8,.26,1)' });
  }

  /** PREV / NEXT caps for the device in use: LB / RB on a pad, [ ] on a keyboard, none (swipe) on touch. */
  _pagerCaps(root, device) {
    const prev = root?.querySelector('.mk-pagenav .prev'), next = root?.querySelector('.mk-pagenav .next');
    if (!prev || !next) return;
    const pad = device === 'pad', touch = device === 'touch';
    prev.replaceChildren();
    next.replaceChildren();
    if (!touch) prev.append(pad ? cap('LB', 'pad') : cap(keyName('BracketLeft')), ' ');
    prev.append('◂ PREV');
    next.append('NEXT ▸');
    if (!touch) next.append(' ', pad ? cap('RB', 'pad') : cap(keyName('BracketRight')));
  }

  _controls(L, R) {
    const binds = { ...KEY_BINDINGS, ...(this.hud.options.bindings || {}) };
    const groups = this.page === 0 ? GROUPS.slice(0, 2) : GROUPS.slice(2);
    el('div', 'mk-letterhead', L, 'FIELD MANUAL — CONTROLS');
    const put = (page, title, list) => {
      el('h4', null, page, title);
      const dl = el('dl', 'mk-keys', page);
      for (const a of list) {
        if (!binds[a]) continue;
        const dt = el('dt', null, dl);
        dt.append(cap((SHIFT_BINDINGS.has(a) ? 'SHIFT+' : '') + keyName(binds[a][0])));
        el('dd', 'mk-typed', dl, a.replace(/([A-Z])/g, ' $1').replace(/(\d)/, ' $1').toUpperCase());
      }
    };
    put(L, groups[0][0], groups[0][1]);
    if (this.page === 0) {
      put(L, groups[1][0], groups[1][1]);
      el('h4', null, R, 'MOUSE');
      const dl = el('dl', 'mk-keys', R);
      for (const [k, v] of [['LEFT', 'SELECT · MOVE · USE'], ['DOUBLE', 'RUN'], ['RIGHT', 'CANCEL · DESELECT'], ['DRAG', 'SELECT A GROUP'], ['SHIFT', 'WHO WATCHES THIS SPOT'], ['WHEEL', 'ZOOM']]) {
        el('dt', null, dl).append(cap(k));
        el('dd', 'mk-typed', dl, v);
      }
      el('h4', null, R, 'CHORDS');
      const dl2 = el('dl', 'mk-keys', R);
      for (const [code, a] of Object.entries(CTRL_BINDINGS)) {
        el('dt', null, dl2).append(cap(`CTRL+${keyName(code)}`));
        el('dd', 'mk-typed', dl2, a === 'notes' ? 'BRIEFING NOTES' : a.replace(/([A-Z])/g, ' $1').toUpperCase());
      }
    } else {
      put(R, groups[1][0], groups[1][1]);
      put(R, groups[2][0], groups[2][1]);
      // BCD (bcd-plan §2): the expansion's key layout, read from the ruleset map (nothing under BEL)
      const bcd = bcdHelpRows(this.hud.game?.world?.rules);
      if (bcd.length) {
        el('h4', null, R, 'BEYOND THE CALL OF DUTY');
        const dl = el('dl', 'mk-keys', R);
        for (const [k, v] of bcd) {
          el('dt', null, dl).append(cap(k));
          el('dd', 'mk-typed', dl, v.toUpperCase());
        }
      }
    }
  }

  _dossier(L, R, d) {
    el('div', 'mk-letterhead', L, `PERSONNEL FILE  No. ${d.no}`);
    const dl = el('dl', 'mk-fields', L);
    for (const [k, v] of [['NAME', d.name], ['CODENAME', d.code], ['BORN', d.born], ['SPECIALITY', d.spec]]) {
      el('dt', null, dl, `${k}:`);
      el('dd', 'mk-typed', dl, v);
    }
    el('p', 'mk-typed notes', L, d.notes);
    stamp(L, 'MOST SECRET', { rot: 12, style: { right: '6%', top: '8%' } });
    photoPrint(R, { src: d.role === 'greenberet' ? 'assets/ui/keyart/tiny-portrait.webp' : getPortraitURL(d.role, { size: 256 }), grade: 'gray', clip: true, caption: `"${d.code[0]}${d.code.slice(1).toLowerCase()}"`, square: true, rotate: 2 });
    const kit = el('div', 'mk-kit', R);
    el('span', 'k', kit, 'KIT:');
    for (const id of d.kit) {
      const art = itemArt(id, [d.role]);
      if (art || ITEM_ICONS[id]) kit.insertAdjacentHTML('beforeend', `<i class="mk-kiticon" title="${id}">${art ? iconHTML(art, { scale: 1, fb: `item/${id}` }) : ITEM_ICONS[id]}</i>`);
    }
  }

  _enemies(L, R) {
    el('div', 'mk-letterhead', L, 'ENEMY FORCES — RECOGNITION');
    const half = Math.ceil(ENEMIES.length / 2);
    for (const [i, [name, note]] of ENEMIES.entries()) {
      const page = i < half ? L : R;
      const row = el('div', 'mk-enemy', page);
      row.insertAdjacentHTML('beforeend', `<span class="sil">${SILHOUETTE}</span>`);
      const t = el('div', null, row);
      el('b', null, t, name);
      el('p', 'mk-typed', t, note);
    }
  }
}
