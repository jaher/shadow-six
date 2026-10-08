/**
 * Inline SVG sketches of the HUD icons (self-made). The HUD draws the studio renders from assets/ui/icons
 * (see icon-art.js); these SVGs are only the fallback when an image fails to load.
 * Every icon is a 32×32 viewBox string; colours lean on brass/olive/steel to sit on the canvas webbing.
 * @module ui/icons
 */

const S = (body, vb = '0 0 32 32') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const STEEL = '#b9bcb4', DARK = '#23221c', BRASS = '#c9a24a', OLIVE = '#5b6233', RED = '#a01c12';

/** Knapsack item icons (keys = items.js ids). */
export const ITEM_ICONS = {
  pistol: S(`<path d="M4 11h19l2 2v3H13l-2 9H6l2-9H4z" fill="${DARK}" stroke="${STEEL}" stroke-width="1"/><rect x="21" y="9" width="3" height="2" fill="${STEEL}"/>`),
  knife: S(`<path d="M3 20 L22 8 L25 9 L10 22z" fill="${STEEL}" stroke="#555" stroke-width=".8"/><rect x="22" y="18" width="7" height="3" rx="1" transform="rotate(-33 25 19)" fill="#5a3b22"/>`),
  decoy: S(`<rect x="10" y="8" width="12" height="16" rx="2" fill="${OLIVE}" stroke="${DARK}"/><circle cx="16" cy="14" r="3" fill="${DARK}"/><path d="M16 4v4M11 5l2 3M21 5l-2 3" stroke="${BRASS}" stroke-width="1.5"/>`),
  shovel: S(`<path d="M16 3v16" stroke="#6b4a2a" stroke-width="3"/><path d="M11 18h10l-1 8-4 3-4-3z" fill="${STEEL}" stroke="#555"/><rect x="12" y="2" width="8" height="3" rx="1.5" fill="#6b4a2a"/>`),
  sniperRifle: S(`<path d="M2 17h24l4-2v3l-4 1H14l-3 6H7l2-6H2z" fill="#5a3b22" stroke="${DARK}"/><rect x="11" y="12" width="9" height="3" rx="1.5" fill="${DARK}"/>`),
  harpoon: S(`<path d="M3 19h18" stroke="${STEEL}" stroke-width="2"/><path d="M21 15l8 4-8 4z" fill="${STEEL}"/><rect x="4" y="16" width="9" height="6" fill="${DARK}"/>`),
  inflatableBoat: S(`<path d="M3 15h26q-2 9-13 9T3 15z" fill="#3a3a30" stroke="${DARK}"/><path d="M6 15q10-3 20 0" stroke="#555" fill="none"/>`),
  divingGear: S(`<rect x="9" y="6" width="6" height="18" rx="3" fill="#6d6f6a" stroke="${DARK}"/><rect x="17" y="6" width="6" height="18" rx="3" fill="#6d6f6a" stroke="${DARK}"/><path d="M12 6q4-4 8 0" stroke="${DARK}" fill="none" stroke-width="1.5"/>`),
  // a long-spring jaw trap seen from above: springs, toothed jaws, pan, chain (was a plain circle)
  bearTrap: S(`<path d="M1.5 16l8.5-2v4z M30.5 16l-8.5-2v4z" fill="${STEEL}" stroke="${DARK}" stroke-width=".7"/><ellipse cx="16" cy="16" rx="7" ry="6" fill="none" stroke="${DARK}" stroke-width="3"/><ellipse cx="16" cy="16" rx="7" ry="6" fill="none" stroke="${STEEL}" stroke-width="1.6"/><path d="M10.6 13.4l1.2 1.6 1-2.6 1.1 2.4 1.1-2.7 1.1 2.7 1.1-2.7 1.1 2.4 1-2.6 1.2 1.6 M10.6 18.6l1.2-1.6 1 2.6 1.1-2.4 1.1 2.7 1.1-2.7 1.1 2.7 1.1-2.4 1 2.6 1.2-1.6" fill="none" stroke="${STEEL}" stroke-width=".8"/><circle cx="16" cy="16" r="2" fill="#6b4a2a" stroke="${DARK}" stroke-width=".5"/><path d="M5 17.5v3.2 M5 22.2v3.2 M4.6 27l1.6 3" stroke="#6b4a2a" stroke-width="1.1" fill="none"/>`),
  timeBomb: S(`<rect x="6" y="11" width="20" height="12" rx="2" fill="#7a3a22" stroke="${DARK}"/><circle cx="16" cy="17" r="4" fill="#ddd" stroke="${DARK}"/><path d="M16 17v-3M16 17h2" stroke="${DARK}"/>`),
  remoteBomb: S(`<rect x="6" y="11" width="20" height="12" rx="2" fill="#6a5a22" stroke="${DARK}"/><path d="M20 11V5" stroke="${STEEL}" stroke-width="1.5"/><circle cx="20" cy="4" r="1.5" fill="${RED}"/>`),
  detonator: S(`<rect x="7" y="14" width="18" height="12" fill="#4a3a22" stroke="${DARK}"/><path d="M16 14V5M11 5h10" stroke="${STEEL}" stroke-width="2"/>`),
  grenade: S(`<ellipse cx="16" cy="19" rx="7" ry="9" fill="${OLIVE}" stroke="${DARK}"/><path d="M9 16h14M9 21h14M16 10v18" stroke="${DARK}" stroke-width=".8"/><rect x="13" y="6" width="6" height="4" fill="${STEEL}"/>`),
  wireCutters: S(`<path d="M8 28l7-12M24 28l-7-12" stroke="#8a2a1a" stroke-width="3"/><path d="M15 16l2-12M17 16l-2-12" stroke="${STEEL}" stroke-width="2"/>`),
  smg: S(`<path d="M3 13h22v4H14l-2 8H8l2-8H3z" fill="${DARK}" stroke="${STEEL}" stroke-width=".8"/><rect x="15" y="17" width="3" height="9" fill="${DARK}"/>`),
  lethalInjection: S(`<rect x="7" y="13" width="16" height="6" fill="#cfe3e6" stroke="${DARK}"/><path d="M23 16h7M3 16h4M5 12v8" stroke="${STEEL}" stroke-width="1.5"/>`),
  uniform: S(`<path d="M9 6l7 3 7-3 5 6-4 3v12H8V15l-4-3z" fill="#56604a" stroke="${DARK}"/><circle cx="16" cy="14" r="1" fill="${BRASS}"/><circle cx="16" cy="19" r="1" fill="${BRASS}"/>`),
  firstAid: S(`<rect x="5" y="9" width="22" height="16" rx="2" fill="#e8e2d0" stroke="${DARK}"/><path d="M16 12v10M11 17h10" stroke="${RED}" stroke-width="3"/>`),
  cartridge: S(`<rect x="13" y="8" width="6" height="18" rx="1" fill="${BRASS}" stroke="#6b5520"/><path d="M13 12h6" stroke="#6b5520"/><path d="M13 8q3-6 6 0" fill="#b07a3a"/>`, '0 0 32 32'),
};

/** Portrait-state glyphs and HUD pictograms. */
export const GLYPHS = {
  skull: S(`<path d="M16 3C9 3 5 8 5 14c0 4 2 6 4 7v5h14v-5c2-1 4-3 4-7 0-6-4-11-11-11z" fill="#d8d2c0" stroke="#111"/><circle cx="11.5" cy="15" r="3" fill="#111"/><circle cx="20.5" cy="15" r="3" fill="#111"/><path d="M16 18l-2 3h4zM12 26v-3M16 26v-3M20 26v-3" stroke="#111" fill="#111"/>`),
  vehicle: S(`<path d="M3 20V12h14l3 4h8v4z" fill="${BRASS}"/><circle cx="9" cy="22" r="3" fill="${DARK}"/><circle cx="23" cy="22" r="3" fill="${DARK}"/>`),
  house: S(`<path d="M4 16L16 5l12 11v11H4z" fill="${BRASS}"/><rect x="13" y="19" width="6" height="8" fill="${DARK}"/>`),
  bars: S(`<path d="M6 3v26M12 3v26M18 3v26M24 3v26M3 8h26M3 24h26" stroke="#8a8f88" stroke-width="2.5"/>`),
  shovel: S(`<path d="M16 3v14" stroke="${BRASS}" stroke-width="3"/><path d="M11 16h10l-1 8-4 4-4-4z" fill="${BRASS}"/>`),
  bubbles: S(`<circle cx="10" cy="22" r="4" fill="none" stroke="#9cd" stroke-width="2"/><circle cx="19" cy="13" r="3" fill="none" stroke="#9cd" stroke-width="2"/><circle cx="24" cy="5" r="2" fill="none" stroke="#9cd" stroke-width="2"/>`),
  star: S(`<path d="M16 2l4.2 9.2 10 1-7.5 6.8 2.2 9.8L16 23.8 7.1 28.8l2.2-9.8L1.8 12.2l10-1z"/>`),
  prone: S(`<circle cx="26" cy="12" r="3" fill="#d8cfb4"/><path d="M4 16h19l3-2" stroke="#d8cfb4" stroke-width="4" stroke-linecap="round" fill="none"/>`, '0 0 32 22'),
  stand: S(`<circle cx="11" cy="5" r="3.5" fill="#d8cfb4"/><path d="M11 10v14M11 24l-4 10M11 24l4 10M11 12l-5 8M11 12l5 8" stroke="#d8cfb4" stroke-width="3.5" stroke-linecap="round" fill="none"/>`, '0 0 22 36'),
  camera: S(`<rect x="4" y="12" width="17" height="12" rx="2" fill="#2b2a24" stroke="${BRASS}"/><circle cx="9" cy="7" r="4.5" fill="#2b2a24" stroke="${BRASS}"/><circle cx="18" cy="7" r="4.5" fill="#2b2a24" stroke="${BRASS}"/><path d="M21 15l7-4v14l-7-4z" fill="#2b2a24" stroke="${BRASS}"/>`),
  hand: S(`<path d="M9 30c-3-4-6-9-6-12 0-2 2-2 3-1l3 4V6c0-2 3-2 3 0v9-12c0-2 3-2 3 0v12-11c0-2 3-2 3 0v11-8c0-2 3-2 3 0v14c0 5-2 8-4 9z" fill="#c9a07c" stroke="#5a3b22"/>`),
  // bodies-design §C.5 / §C.7 (feat/hud-icons may repaint these): a man lying down, on a shoulder, dragged by the collar
  downed: S(`<path d="M3 24h26" stroke="${RED}" stroke-width="2"/><circle cx="7" cy="19" r="3" fill="#d8cfb4"/><path d="M10 20h13l4 3" stroke="#d8cfb4" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M17 8v7M13.5 11.5h7" stroke="${RED}" stroke-width="2.5"/>`),
  carrying: S(`<circle cx="13" cy="6" r="3" fill="${BRASS}"/><path d="M13 10v11l-3 9M13 21l3 9" stroke="${BRASS}" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M5 11h19l3 4" stroke="#d8cfb4" stroke-width="3.5" stroke-linecap="round" fill="none"/>`),
  dragging: S(`<circle cx="24" cy="7" r="3" fill="${BRASS}"/><path d="M24 11l-2 9 3 9M22 20l-4 9M23 13l-7 5" stroke="${BRASS}" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M15 19l-5 4H3" stroke="#d8cfb4" stroke-width="3.5" stroke-linecap="round" fill="none"/>`),
  carried: S(`<path d="M5 11h19l3 4" stroke="#d8cfb4" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M13 14v14" stroke="${BRASS}" stroke-width="3" opacity=".6"/>`),
  dragged: S(`<path d="M24 12l-8 8H3" stroke="#d8cfb4" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M4 27h24" stroke="#6b5a40" stroke-width="2" stroke-dasharray="3 2"/>`),
  revive: S(`<circle cx="16" cy="16" r="12" fill="#e8e2d0" stroke="${DARK}"/><path d="M16 9v14M9 16h14" stroke="${RED}" stroke-width="3.5"/>`),
  lamp: S(`<rect x="7" y="24" width="18" height="6" fill="#333" stroke="#111"/><path d="M9 24V14a7 7 0 0 1 14 0v10z" fill="currentColor" stroke="#111"/>`, '0 0 32 32'),
};

/** Photo-real-ish eye (§6.1) as layered SVG; `.lid` is animated for the 2-frame blink. */
export const EYE_SVG = S(`<defs><radialGradient id="ir" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#1a1a1a"/><stop offset=".35" stop-color="#1a1a1a"/><stop offset=".4" stop-color="#4f6e5a"/><stop offset="1" stop-color="#27392c"/></radialGradient></defs>
<path d="M2 16Q16 3 30 16Q16 29 2 16z" fill="#efe6d6" stroke="#3a2a1e" stroke-width="1.2"/><circle cx="16" cy="16" r="6.5" fill="url(#ir)"/><circle cx="18" cy="14" r="1.5" fill="#fff" opacity=".8"/>
<path class="lid" d="M2 16Q16 3 30 16Q16 12 2 16z" fill="#b58a6a" stroke="#3a2a1e" stroke-width="1"/>`);
