/**
 * S06b MISSION SELECT: the map table (docs/menus-art-direction.md §1.10 B4, S06b). A top-down oak table under a
 * desk lamp; on it the cream Europe map (the briefing SVG style on paper) with brass pins for reached missions, a red
 * flag on the next one, grey dots for locked ones, and red string joining them in campaign order. Campaign tabs
 * (BEL | BCD locked "coming later"). The typed card on the right shows number, name, date, place and best medals.
 * Pins are the card's rows, so keyboard / pad / mouse / touch navigation is the kit's.
 * @module ui/map-table
 */

import { el } from './dom.js';
import { medal, LOCK_SVG } from './menu-kit.js';
import { BEL_CATALOGUE, CAMPAIGN_TABS } from './catalogue.js';
import { europeSVG, project } from './europe.js';

/** The part of Europe the BEL campaign covers (Norway → Libya). */
export const TABLE_VIEW = { lon0: -8, lon1: 30, lat0: 27, lat1: 71.5 };
const MAP_W = 1000, MAP_H = 1000;

const PIN_BRASS = '<svg viewBox="0 0 20 34" aria-hidden="true"><defs><radialGradient id="pb" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff4c0"/><stop offset=".45" stop-color="#c9a24a"/><stop offset="1" stop-color="#5a4314"/></radialGradient></defs><path d="M10 14 L10 33" stroke="#6b6b64" stroke-width="1.6"/><circle cx="10" cy="9" r="7.5" fill="url(#pb)" stroke="#3a2c0c" stroke-width=".8"/></svg>';
const PIN_FLAG = '<svg viewBox="0 0 26 38" aria-hidden="true"><path d="M5 3 L5 37" stroke="#4a4a44" stroke-width="1.8"/><path d="M6 4 Q14 1 22 6 Q15 10 6 14 Z" fill="#b3160f" stroke="#5a0804" stroke-width=".8"/><circle cx="5" cy="3" r="2.2" fill="#c9a24a"/></svg>';

/**
 * Pin label placement: each number goes right of its pin unless that collides with a pin or an earlier label, then
 * left, below or above (greedy, map units). Exact duplicates (Liège, M16 / M18) fan out first.
 * @returns {{x:number, y:number, side:'r'|'l'|'b'|'t'}[]}
 */
export function layoutPins(pts, lw = 38, lh = 22) {
  const seen = new Map();
  const P = pts.map(([x, y]) => {
    const key = `${Math.round(x / 12)},${Math.round(y / 12)}`;
    const k = seen.get(key) || 0;
    seen.set(key, k + 1);
    return { x: x + k * 22, y };
  });
  const boxes = P.map((p) => ({ x0: p.x - 16, x1: p.x + 16, y0: p.y - 54, y1: p.y + 2 }));
  const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const OFF = { r: [16, -54, lw, lh], l: [-16 - lw, -54, lw, lh], b: [-lw / 2, 2, lw, lh], t: [-lw / 2, -54 - lh, lw, lh] };
  return P.map((p) => {
    let best = 'r', bestN = 1e9;
    for (const side of ['r', 'l', 'b', 't']) {
      const [ox, oy, w, h] = OFF[side];
      const bx = { x0: p.x + ox, x1: p.x + ox + w, y0: p.y + oy, y1: p.y + oy + h };
      const n = boxes.filter((o) => hit(bx, o)).length;
      if (n < bestN) { best = side; bestN = n; }
      if (n === 0) break;
    }
    const [ox, oy, w, h] = OFF[best];
    boxes.push({ x0: p.x + ox, x1: p.x + ox + w, y0: p.y + oy, y1: p.y + oy + h });
    return { ...p, side: best };
  });
}

export class MapTable {
  constructor(screens) {
    this.s = screens;
    this.tab = 'BEL';
  }

  /** Best medals earned for a mission this career (flow.results). */
  best(id) {
    const res = (this.s.flow?.results || []).filter((r) => r.missionId === id && r.won);
    if (!res.length) return null;
    return {
      time: Math.max(...res.map((r) => r.stars?.time ?? 0)),
      damage: Math.max(...res.map((r) => r.stars?.damage ?? 0)),
      merit: Math.max(...res.map((r) => r.merit ?? 0)),
    };
  }

  /** Pin status of a catalogue mission: 'reached' | 'next' | 'locked' | 'unbuilt'. */
  status(c) {
    const flow = this.s.flow, hud = this.s.hud;
    const def = flow?.missions?.find((m) => m.id === c.id);
    if (!def) return 'unbuilt';
    const open = flow.unlocked(c.id) || hud.devUnlock;
    if (!open) return 'locked';
    const next = this.s.nextMission();
    return next?.id === c.id ? 'next' : 'reached';
  }

  open(tab = this.tab) {
    this.tab = tab;
    const s = this.s, hud = s.hud, kit = s.kit;
    const pins = BEL_CATALOGUE.map((c) => ({ c, st: this.status(c) }));
    const focusIx = Math.max(0, pins.findIndex((p) => p.st === 'next'));
    const open = (p, direct) => {
      if (p.st === 'locked' || p.st === 'unbuilt') return;
      if (direct) hud.loading.startDirect(p.c.id);
      else hud.startMission(p.c.id);
    };
    const cur = () => pins[kit.top?.focus] || pins[0];
    kit.open({
      id: 'missionselect',
      title: 'MISSION SELECT',
      bg: 'frontend',
      className: 'mk-maptable',
      scrim: false,
      background: (host) => {
        el('div', 'mk-oak', host);
        el('div', 'mk-lamp', host);
      },
      rows: pins.map((p) => ({
        kind: 'item',
        id: p.c.id,
        label: `${p.c.n} · ${p.c.title.toUpperCase()}`,
        cls: `mk-pin ${p.st}`,
        disabled: p.st === 'locked' || p.st === 'unbuilt',
        reason: p.st === 'unbuilt' ? 'NOT YET BUILT' : 'LOCKED',
        note: '',
        onSelect: () => open(p, false),
      })),
      defaultFocus: focusIx,
      detail: (r, pane) => this._card(pins.find((p) => p.c.id === r.id), pane),
      footer: [
        { label: '(B)RIEFING', onSelect: () => open(cur(), false) },
        { label: '(S)TART WITHOUT BRIEFING', onSelect: () => open(cur(), true) },
        { label: '(ESC) EXIT', hotkey: '', onSelect: () => kit.back() },
      ],
      hints: false,
      onSide: (dir) => {
        const t = kit.top;
        if (t.focus >= pins.length) return kit.focus(Math.max(0, Math.min(t.rows.length - 1, t.focus + dir)));
        kit.focus(Math.max(0, Math.min(pins.length - 1, t.focus + dir)));
      },
      onTab: (dir) => this._switchTab(dir),
      render: (box) => this._table(box, pins),
      onOpen: () => {
        kit.sound.play('lamp');
        s.flow?.openSelect?.();
      },
      onClose: () => {
        if (s.flow?.state === 'select') s.flow.setState('title');
      },
    });
  }

  _switchTab(dir) {
    const i = CAMPAIGN_TABS.findIndex((t) => t.id === this.tab);
    const t = CAMPAIGN_TABS[(i + dir + CAMPAIGN_TABS.length) % CAMPAIGN_TABS.length];
    if (t.locked) {
      this.s.kit.sound.play('deny');
      this.s.kit.note(`${t.label.toUpperCase()} — ${String(t.note || 'LOCKED').toUpperCase()}`);
    }
  }

  _table(box, pins) {
    const kit = this.s.kit;
    const tabs = el('div', 'mk-tabs', box);
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Campaign');
    for (const t of CAMPAIGN_TABS) {
      const b = el('button', `mk-tabbtn ${t.id === this.tab ? 'on' : ''} ${t.locked ? 'locked' : ''}`.trim(), tabs);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.campaign = t.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === this.tab));
      b.textContent = t.label.toUpperCase();
      if (t.locked) {
        b.insertAdjacentHTML('beforeend', LOCK_SVG);
        b.setAttribute('aria-disabled', 'true');
        b.title = t.note || 'Locked';
        const n = el('small', null, b, String(t.note || 'LOCKED').toUpperCase());
        n.className = 'mk-tabnote';
      }
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.locked) this._switchTab(1);
      });
    }
    const sheet = el('div', 'mk-mapsheet', box);
    const svg = `<svg class="mk-mapsvg" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none" aria-hidden="true">${europeSVG(MAP_W, MAP_H, TABLE_VIEW)}</svg>`;
    sheet.insertAdjacentHTML('beforeend', svg);
    // red string through the pins in campaign order (reached ones solid, the rest faint)
    const pts = pins.map((p) => project(p.c.lon, p.c.lat, MAP_W, MAP_H, TABLE_VIEW));
    const reached = pins.map((p) => p.st === 'reached' || p.st === 'next');
    let solid = '', faint = '';
    for (let i = 1; i < pts.length; i++) {
      const seg = `M${pts[i - 1][0].toFixed(1)} ${pts[i - 1][1].toFixed(1)} L${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} `;
      if (reached[i] && reached[i - 1]) solid += seg;
      else faint += seg;
    }
    sheet.insertAdjacentHTML('beforeend', `<svg class="mk-string" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="none" aria-hidden="true"><path d="${faint}" stroke="#8a1a12" stroke-opacity=".25" stroke-width="1.2" stroke-dasharray="4 5" fill="none" vector-effect="non-scaling-stroke"/><path d="${solid}" stroke="#a3140c" stroke-width="1.8" fill="none" vector-effect="non-scaling-stroke"/></svg>`);
    // relocate the pin rows onto the map; the numbers dodge each other (Norway and France clusters)
    const els = kit.top.els;
    const placed = layoutPins(pts);
    pins.forEach((p, i) => {
      const b = els[i];
      const { x, y, side } = placed[i];
      b.style.left = `${(x / MAP_W) * 100}%`;
      b.style.top = `${(y / MAP_H) * 100}%`;
      b.insertAdjacentHTML('afterbegin', `<i class="mk-pinicon">${p.st === 'next' ? PIN_FLAG : p.st === 'reached' ? PIN_BRASS : p.st === 'locked' ? LOCK_SVG : ''}</i>`);
      b.querySelector('.mk-label').classList.add('mk-sr');
      el('span', `mk-pinnum ${side}`, b, String(p.c.n));
      sheet.appendChild(b);
    });
    const leg = el('div', 'mk-legend', sheet); // the map key, printed in the sheet's corner
    leg.setAttribute('aria-hidden', 'true');
    leg.innerHTML = `<span><i class="lg reached">${PIN_BRASS}</i>REACHED</span><span><i class="lg next">${PIN_FLAG}</i>NEXT</span><span><i class="lg locked">${LOCK_SVG}</i>LOCKED</span><span><i class="lg unbuilt"></i>IN PREPARATION</span>`;
  }

  _card(p, pane) {
    if (!p) return false;
    const card = el('div', 'mk-paper mk-mapcard', pane);
    el('div', 'k', card, `MISSION ${p.c.n}`);
    el('div', 'mk-maptitle', card, p.c.title);
    el('div', 'mk-typed', card, p.c.date);
    el('div', 'mk-typed', card, p.c.place);
    const st = el('div', 'mk-typed st', card);
    if (p.st === 'locked') st.textContent = 'LOCKED — FINISH THE MISSIONS BEFORE IT, OR USE ITS PASSWORD';
    else if (p.st === 'unbuilt') st.textContent = 'IN PREPARATION — NOT YET BUILT';
    else {
      const b = this.best(p.c.id);
      const m = el('div', 'medals', st);
      el('span', 'k', m, 'BEST');
      // three groups of three (time, damage, merit), one line at every size
      for (const [kind, v] of [['silver', b?.time], ['silver', b?.damage], ['gold', b?.merit]]) {
        const g = el('span', 'grp', m);
        for (let i = 0; i < 3; i++) medal(g, kind, b && i < v ? 'filled' : 'empty');
      }
    }
    card.animate?.([{ transform: 'translateY(6px) rotate(-1.5deg)', opacity: 0.4 }, { transform: 'rotate(-0.8deg)', opacity: 1 }], { duration: 160, easing: 'ease-out' });
    return true;
  }
}
