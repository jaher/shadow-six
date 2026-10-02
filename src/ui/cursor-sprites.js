/**
 * Software-cursor sprites (design-spec §5.3). The cursors are studio renders (assets/ui/icons/cursor, see
 * CURSOR_ART; hotspots from the render manifest, else the centre). The 32 px SVGs below (the scope is 88) are
 * the fallback if an image fails to load.
 * @module ui/cursor-sprites
 */

import { ICON_MANIFEST } from './icon-manifest.js';

/** Sprite id → rendered cursor art id. */
export const CURSOR_ART = {
  arrow: 'cursor/arrow', move: 'cursor/move', activate: 'cursor/activate', hand: 'cursor/hand.open', grab: 'cursor/grab',
  climb: 'cursor/climb', barrel: 'cursor/barrel', knife: 'cursor/knife', pistol: 'cursor/pistol', crosshair: 'cursor/crosshair',
  scope: 'cursor/scope.ok', syringe: 'cursor/syringe', cap: 'cursor/cap', harpoon: 'cursor/harpoon', grenade: 'cursor/grenade',
  pliers: 'cursor/pliers', trap: 'cursor/trap', bomb: 'cursor/bomb', eye: 'cursor/eye.open', track: 'cursor/track',
  target: 'cursor/target', fist: 'cursor/fist', 'fist.blackjack': 'cursor/fist.blackjack', 'fist.chloroform': 'cursor/fist.chloroform',
};
/** Second frame shown by a state class: the eye blinks (closed lid), the scope turns red out of range. */
export const CURSOR_ALT = { eye: 'cursor/eye.closed', scope: 'cursor/scope.bad' };

/**
 * Rendered cursor for a sprite id: art id, box [w, h] in CSS px at 32-px cursor size, hotspot in the same px.
 * @returns {{art:string, box:[number,number], hot:[number,number], alt?:string}|null}
 */
export function cursorArt(id) {
  const art = CURSOR_ART[id];
  const e = art && ICON_MANIFEST[art];
  if (!e) return null;
  const hot = e.h ? [...e.h] : [e.b[0] / 2, e.b[1] / 2];
  return { art, box: [...e.b], hot, ...(CURSOR_ALT[id] ? { alt: CURSOR_ALT[id] } : {}) };
}

const B = '#c9a24a', D = '#1c1a14', S2 = '#d9d4c4';
const S = (body, vb = 32) => `<svg viewBox="0 0 ${vb} ${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** id → {svg, hot:[x,y] in 32-px space, size?} */
export const CURSORS = {
  arrow: { hot: [2, 2], svg: S(`<path d="M3 2l20 12-9 2-4 9z" fill="#eee" stroke="${D}" stroke-width="1.5"/>`) },
  move: {
    hot: [3, 3],
    svg: S(`<path d="M3 3l14 5-5 2 9 9-3 3-9-9-2 5z" fill="${B}" stroke="${D}" stroke-width="1.3"/><path d="M11 3l14 5-5 2" fill="none" stroke="${B}" stroke-width="2"/><path d="M25 24l1.5 3 3 .4-2.3 2 .6 3-2.8-1.6-2.8 1.6.6-3-2.3-2 3-.4z" fill="#f4e2a0" stroke="${D}" stroke-width=".6"/>`),
  },
  activate: { hot: [12, 4], svg: S(`<rect x="16" y="3" width="4" height="16" fill="#777" stroke="${D}"/><circle cx="18" cy="3" r="3" fill="#b22"/><path d="M8 30c-2-4-3-8-2-11l4-2 3 1 4-1 3 2v6l-3 5z" fill="#e0bc98" stroke="${D}"/>`) },
  hand: { hot: [14, 12], svg: S(`<path d="M9 30c-3-4-6-9-6-12 0-2 2-2 3-1l3 4V6c0-2 3-2 3 0v9V3c0-2 3-2 3 0v12V4c0-2 3-2 3 0v11V7c0-2 3-2 3 0v13c0 4-2 8-4 10z" fill="#e0bc98" stroke="${D}"/>`) },
  // bodies-design §C.5: two hands pulling a collar backwards (the result would be a DRAG)
  hand_drag: { hot: [16, 12], svg: S(`<path d="M6 13c3-3 7-4 10-4s7 1 10 4l-2 4c-2-2-5-3-8-3s-6 1-8 3z" fill="#5b6233" stroke="${D}"/><path d="M5 18c-1-3 0-6 3-6h3c2 0 2 3 0 3h-1l1 2c1 2-1 4-3 4-2 0-3-1-3-3z" fill="#e0bc98" stroke="${D}"/><path d="M27 18c1-3 0-6-3-6h-3c-2 0-2 3 0 3h1l-1 2c-1 2 1 4 3 4 2 0 3-1 3-3z" fill="#e0bc98" stroke="${D}"/><path d="M16 23v7M12 27l4 3 4-3" stroke="${B}" stroke-width="2" fill="none" stroke-linecap="round"/>`) },
  grab: { hot: [14, 14], svg: S(`<path d="M8 30c-2-3-4-7-4-10 0-2 1-4 3-4h2v-3c0-2 3-2 3 0v-1c0-2 3-2 3 0v1c0-2 3-2 3 0v1c0-2 3-2 3 0v8c0 4-2 6-4 8z" fill="#e0bc98" stroke="${D}"/>`) },
  climb: { hot: [4, 4], svg: S(`<path d="M5 5l18 18" stroke="#6b4a2a" stroke-width="3.5"/><path d="M3 11c2-6 6-9 12-9-4 2-6 4-7 7z" fill="#aab" stroke="${D}"/>`) },
  barrel: { hot: [16, 16], svg: S(`<ellipse cx="16" cy="7" rx="9" ry="3" fill="#7a3a1a" stroke="${D}"/><path d="M7 7v18c0 2 18 2 18 0V7" fill="#8e4a22" stroke="${D}"/><path d="M7 13h18M7 20h18" stroke="${D}"/>`) },
  knife: { hot: [3, 3], svg: S(`<path d="M3 3l17 17-3 3L3 6z" fill="${S2}" stroke="${D}"/><path d="M19 22l4-4 7 7-4 4z" fill="#4a3322" stroke="${D}"/>`) },
  pistol: { hot: [3, 9], svg: S(`<path d="M2 7h24v6H14l-2 3v10H6l2-13H2z" fill="#34342e" stroke="#999" stroke-width=".8"/><path d="M12 13l1 4h-2" stroke="#999" fill="none"/>`) },
  crosshair: { hot: [16, 16], svg: S(`<circle cx="16" cy="16" r="9" fill="none" stroke="#e33" stroke-width="2"/><path d="M16 2v9M16 21v9M2 16h9M21 16h9" stroke="#e33" stroke-width="2"/>`) },
  scope: {
    hot: [44, 44], size: 88,
    svg: S(`<circle cx="44" cy="44" r="40" fill="rgba(200,220,255,.08)" stroke="#111" stroke-width="5"/><circle cx="44" cy="44" r="40" fill="none" stroke="var(--scope,#0d0e0c)" stroke-width="1.5"/><path d="M44 6v30M44 52v30M6 44h30M52 44h30" stroke="var(--scope,#0d0e0c)" stroke-width="1.5"/><circle cx="44" cy="44" r="2" fill="var(--scope,#0d0e0c)"/>`, 88),
  },
  syringe: { hot: [3, 29], svg: S(`<path d="M3 29l6-6" stroke="#bbb" stroke-width="1.5"/><rect x="9" y="9" width="7" height="17" transform="rotate(45 12 17)" fill="#cde" stroke="${D}"/><path d="M22 4l6 6M24 8l-3 3" stroke="${D}" stroke-width="2"/>`) },
  cap: { hot: [16, 20], svg: S(`<path d="M4 20c0-8 6-12 12-12s12 4 12 12z" fill="#51563f" stroke="${D}"/><path d="M2 20h28l-3 4H5z" fill="#1d1d18"/><path d="M13 12h6" stroke="${B}" stroke-width="2"/>`) },
  harpoon: { hot: [3, 3], svg: S(`<path d="M3 3l24 24" stroke="#999" stroke-width="2"/><path d="M3 3l8 2-6 6z" fill="#ccc" stroke="${D}"/>`) },
  grenade: { hot: [16, 18], svg: S(`<ellipse cx="16" cy="19" rx="8" ry="10" fill="#4f5a30" stroke="${D}"/><path d="M10 15h12M10 21h12M16 9V5h5" stroke="${D}"/>`) },
  pliers: { hot: [4, 4], svg: S(`<path d="M4 4l10 10M10 4L4 10" stroke="#aaa" stroke-width="3"/><path d="M13 13l8 16M13 13l16 8" stroke="#b22" stroke-width="4"/>`) },
  trap: { hot: [16, 16], svg: S(`<circle cx="16" cy="18" r="10" fill="none" stroke="#777" stroke-width="3"/><path d="M8 18l2-4 2 4 2-4 2 4 2-4 2 4 2-4 2 4" stroke="#bbb" fill="none"/>`) },
  bomb: { hot: [16, 16], svg: S(`<rect x="6" y="10" width="20" height="14" fill="#6b4a2a" stroke="${D}"/><circle cx="16" cy="17" r="4" fill="#ddd" stroke="${D}"/><path d="M16 17l2-2" stroke="${D}"/>`) },
  eye: { hot: [16, 16], svg: S(`<path d="M2 16Q16 4 30 16Q16 28 2 16z" fill="#efe6d6" stroke="${D}" stroke-width="1.5"/><circle cx="16" cy="16" r="6" fill="#4f6e5a"/><circle cx="16" cy="16" r="2.6" fill="#111"/><path class="lid" d="M2 16Q16 4 30 16Q16 28 2 16z" fill="#b58a6a" stroke="${D}"/>`) },
  track: { hot: [16, 16], svg: S(`<g fill="#f08a1c" stroke="${D}" stroke-width=".8"><path d="M16 1l5 6h-10z"/><path d="M16 31l5-6h-10z"/><path d="M1 16l6-5v10z"/><path d="M31 16l-6-5v10z"/></g><circle cx="16" cy="16" r="2" fill="#f08a1c"/>`) },
  target: { hot: [16, 16], svg: S(`<circle cx="16" cy="16" r="10" fill="none" stroke="${B}" stroke-width="2"/><path d="M16 3v8M16 21v8M3 16h8M21 16h8" stroke="${B}" stroke-width="2"/>`) },
};

/** Red forbidden overlay: circle + slash (§5.3). */
export const FORBIDDEN = S(`<circle cx="16" cy="16" r="12" fill="none" stroke="#e02020" stroke-width="3.5"/><path d="M7.5 7.5l17 17" stroke="#e02020" stroke-width="3.5"/>`);

/** 27-px twin-star destination sparkle (BEL ESTRELLA1/2). */
export const SPARKLE = S(`<path d="M11 1l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" fill="#fff4c0"/><path d="M23 13l1.3 4.2 4.2 1.3-4.2 1.3L23 24l-1.3-4.2-4.2-1.3 4.2-1.3z" fill="#ffe27a"/>`);

/**
 * Map an input/ability cursor name to a sprite id. Unknown names fall back by keyword.
 * @param {string} name
 */
export function spriteFor(name) {
  if (!name) return null;
  if (CURSORS[name]) return name;
  const n = String(name).toLowerCase();
  const table = [
    [/fist|punch|knock|club|blackjack|chloro/, 'fist'], [/talk|lipstick|seduc/, 'cap'], [/axe/, 'climb'],
    [/snip|scope|rifle/, 'scope'], [/smg|machine|gun|vehicle|cannon|shoot|fire/, 'crosshair'], [/pistol/, 'pistol'],
    [/knife|stab/, 'knife'], [/inject|syringe|firstaid|first-aid|heal/, 'syringe'], [/distract|cap|officer/, 'cap'],
    [/harpoon/, 'harpoon'], [/grenade|throw/, 'grenade'], [/cut|plier|wire/, 'pliers'], [/trap/, 'trap'],
    [/bomb|explos/, 'bomb'], [/climb|pick/, 'climb'], [/barrel/, 'barrel'], [/grab|carry|hand|pick/, 'hand'],
    [/use|activ|lever|switch|door/, 'activate'], [/eye|look/, 'eye'], [/track|camera/, 'track'], [/move|walk|run/, 'move'],
  ];
  for (const [re, id] of table) if (re.test(n)) return id;
  return 'target';
}
