/**
 * LIGHTS OUT, our own expansion campaign (internal id 'BCD'): its detail pane on the SINGLE PLAYER campaign choice and
 * on the LIGHTS OUT card (docs/menus-art-direction.md S06a). An original night print drawn here as inline SVG (no image
 * file, nothing from the 1998/1999 games): a hooded field lamp going dark over a harbour under an Alpine ridge, six
 * figures filing along the quay, LIGHTS OUT sprayed through a stencil. Below it the typed card: 8 MISSIONS ·
 * 1943–1945 · CAREER STARTS AT MAJOR · n OF 8 READY.
 * @module ui/lights-out-art
 */

import { el } from './dom.js';
import { CLIP_SVG } from './menu-kit.js';

let uid = 0;

/** Stencil letters of the title: [char, centre x]; a space is skipped. Bridges (the stencil's ties) cut O and G. */
const TITLE = [...'LIGHTS OUT'].map((ch, i) => [ch, 65.5 + 21 * i]).filter(([ch]) => ch !== ' ');
const BRIDGES = TITLE.filter(([ch]) => ch === 'O' || ch === 'G').map(([, x]) => x);

/** Six figures in single file on the quay: [x, scale]. */
const SIX = [[118, 1.5], [137, 1.46], [155, 1.53], [173, 1.43], [191, 1.5], [209, 1.47]];

/** One walking figure: head, coat, legs mid-stride, a rifle or a pack on alternate men (black against the haze). */
function figure(x, s, k) {
  const y = 129;
  const f = (v) => (+v.toFixed(2));
  const gear = k % 2 ? `<path d="M${f(x - 2.4 * s)} ${f(y - 9 * s)} l${f(-1.3 * s)} ${f(-4.8 * s)} l.8 -.2 l${f(1.7 * s)} ${f(4.8 * s)}z"/>`
    : `<rect x="${f(x - 3.5 * s)}" y="${f(y - 9.6 * s)}" width="${f(2.3 * s)}" height="${f(3.6 * s)}" rx=".7"/>`;
  return `<circle cx="${x}" cy="${f(y - 11.6 * s)}" r="${f(1.35 * s)}"/>`
    + `<path d="M${f(x - 1.9 * s)} ${f(y - 10.2 * s)} h${f(3.6 * s)} l${f(0.7 * s)} ${f(5.8 * s)} h${f(-5 * s)}z"/>`
    + `<path d="M${f(x - 1.3 * s)} ${f(y - 4.6 * s)} l${f(-1.8 * s)} ${f(4.6 * s)} h${f(1.1 * s)} l${f(1.5 * s)} ${f(-3.4 * s)} l${f(1.3 * s)} ${f(3.4 * s)} h${f(1.1 * s)} l${f(-1.4 * s)} ${f(-4.6 * s)}z"/>`
    + gear;
}

/**
 * The print's SVG (unique ids per call: two copies can be in the page while a card slides out).
 * @returns {string}
 */
export function lightsOutSVG() {
  const id = `lo${++uid}`;
  const stars = [[22, 18], [41, 34], [66, 12], [92, 26], [118, 9], [139, 31], [176, 15], [205, 28], [231, 10], [262, 22], [284, 38], [303, 14], [12, 46], [154, 44]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.55 : 0.85}" opacity="${0.35 + (i % 4) * 0.12}"/>`).join('');
  const letters = TITLE.map(([ch, x], i) => `<text x="${x}" y="64" transform="rotate(${((i * 37) % 7) - 3} ${x} 52)">${ch}</text>`).join('');
  const bridges = BRIDGES.map((x) => `<rect x="${x - 0.9}" y="34" width="1.8" height="34" fill="#000"/>`).join('');
  return `<svg class="mk-lo-svg" viewBox="0 0 320 180" role="img" aria-label="Lights Out: a field lamp going dark over a night harbour under the Alps, six men filing along the quay">
<defs>
  <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04070b"/><stop offset=".62" stop-color="#121c29"/><stop offset="1" stop-color="#22303d"/></linearGradient>
  <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1922"/><stop offset="1" stop-color="#03060a"/></linearGradient>
  <linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".30"/><stop offset=".55" stop-color="#ffb24a" stop-opacity=".08"/><stop offset="1" stop-color="#ffb24a" stop-opacity="0"/></linearGradient>
  <radialGradient id="${id}h" cx=".5" cy=".85" r=".6"><stop offset="0" stop-color="#4b6078" stop-opacity=".75"/><stop offset="1" stop-color="#4b6078" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd58a" stop-opacity=".85"/><stop offset=".35" stop-color="#ff9a3a" stop-opacity=".35"/><stop offset="1" stop-color="#ff7a20" stop-opacity="0"/></radialGradient>
  <filter id="${id}r" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter>
  <filter id="${id}b" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>
  <mask id="${id}m"><rect width="320" height="180" fill="#fff"/>${bridges}</mask>
</defs>
<rect width="320" height="180" fill="url(#${id}s)"/>
<g fill="#dfe6ef">${stars}</g>
<path d="M282 22a9 9 0 1 0 6 15a7 7 0 1 1-6-15z" fill="#cfd6dc" opacity=".55"/>
<path d="M0 121 L18 108 L31 113 L52 90 L63 97 L84 70 L97 83 L112 76 L129 94 L150 66 L163 77 L178 72 L196 90 L214 74 L231 86 L251 69 L268 88 L288 80 L305 92 L320 86 L320 134 L0 134 Z" fill="#1a2431"/>
<path d="M78 76 L84 70 L90 77 M144 72 L150 66 L156 72 M245 75 L251 69 L257 76 M47 95 L52 90 L56 94 M208 79 L214 74 L219 79" fill="none" stroke="#a9b8c8" stroke-width="1.3" stroke-linejoin="round" opacity=".55"/>
<path d="M0 128 L26 118 L47 123 L70 111 L92 120 L120 113 L146 122 L171 115 L199 121 L228 112 L256 120 L284 114 L320 121 L320 136 L0 136 Z" fill="#101720"/>
<rect x="88" y="100" width="150" height="31" fill="url(#${id}h)"/>
<rect y="134" width="320" height="46" fill="url(#${id}w)"/>
<g stroke="#7f97b0" stroke-linecap="round" opacity=".22"><path d="M196 147h22M226 152h12M171 158h18M240 163h20M205 170h14M118 165h16"/></g>
<path d="M98 129 H320 V136 H96 Z" fill="#06090d"/>
<path d="M262 129 V96 M262 98 L296 92 M262 98 L246 104 M286 93.5 V112" stroke="#05080c" stroke-width="2" fill="none"/>
<path d="M286 112 l-1.5 4 h3z" fill="#05080c"/>
<path d="M215 129 l4 -7 h22 l3 7z M224 122 v-6 h7 v6" fill="#05080c"/>
<g fill="#020305">${SIX.map(([x, s], k) => figure(x, s, k)).join('')}</g>
<polygon points="60,88 68,88 104,180 18,180" fill="url(#${id}c)"/>
<path d="M45 180 V74 M45 76 H62" stroke="#020305" stroke-width="2.6" fill="none"/>
<path d="M55 79 h14 l3.5 9 h-21z" fill="#05080b" stroke="#2a3644" stroke-width=".6"/>
<circle cx="64" cy="90.5" r="7" fill="url(#${id}g)"/>
<ellipse cx="64" cy="89.4" rx="2.4" ry="1.4" fill="#ffcf86" opacity=".9"/>
<g font-family="Staatliches, Oswald, 'Arial Narrow', sans-serif" font-size="34" text-anchor="middle" letter-spacing="0" mask="url(#${id}m)">
  <g fill="#e8dca0" filter="url(#${id}b)" opacity=".28">${letters}</g>
  <g fill="#e8dca0" filter="url(#${id}r)" opacity=".94">${letters}</g>
</g>
<rect x="60" y="73" width="200" height="1.6" fill="#b3160f" opacity=".85" filter="url(#${id}r)"/>
</svg>`;
}

/**
 * Fill a detail pane: the print with its brass clip, then the typed card.
 * @param {HTMLElement} pane the card's detail pane
 * @param {{ready: number, total: number, start: string}} info registered missions, slots, the career's first rank
 * @returns {true}
 */
export function lightsOutPane(pane, info) {
  const f = el('figure', 'mk-print mk-lo-print', pane);
  f.style.margin = '0';
  f.insertAdjacentHTML('afterbegin', CLIP_SVG);
  f.insertAdjacentHTML('beforeend', lightsOutSVG());
  const card = el('div', 'card mk-lo-card', pane);
  el('div', 'mk-lo-line', card, `${info.total} MISSIONS · 1943–1945`);
  el('div', 'mk-lo-line', card, `CAREER STARTS AT ${String(info.start).toUpperCase()}`);
  const r = el('div', 'mk-lo-line mk-lo-ready', card);
  el('b', null, r, `${info.ready} OF ${info.total}`);
  r.append(' READY');
  return true;
}
