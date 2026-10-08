/**
 * Owned by ART (see docs/ARCHITECTURE.md). Commando portraits: the photo stills of the talking-portrait set
 * (registered at runtime by ui/talking-portraits.js from assets/portraits/manifest.json), with procedural canvas
 * portraits (a shaded head silhouette with the role's headgear on a coloured backdrop) as the fallback and for
 * the disguised / dead variants.
 * @module art/portraits
 */

const ROLE_LOOK = {
  greenberet: { bg: '#34402a', skin: '#c49373', hat: '#2f6b2f', hatShape: 'beret', label: 'GB' },
  sniper: { bg: '#4a4330', skin: '#d2a386', hat: '#6b5a3a', hatShape: 'cap', label: 'SN' },
  diver: { bg: '#23323a', skin: '#c9977a', hat: '#1c1c1c', hatShape: 'hood', label: 'MA' },
  sapper: { bg: '#3f3f2e', skin: '#c08d6e', hat: '#4a4f3a', hatShape: 'helmet', label: 'SA' },
  driver: { bg: '#4d4032', skin: '#cf9f80', hat: '#3f3a30', hatShape: 'cap', label: 'DR' },
  spy: { bg: '#2d2e35', skin: '#d6ab90', hat: '#2a2a2e', hatShape: 'peaked', label: 'SP' },
};

/**
 * Draw a portrait into a 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} role
 * @param {{size?:number, disguised?:boolean, dead?:boolean}} [opts]
 */
export function drawPortrait(ctx, role, opts = {}) {
  const s = opts.size ?? ctx.canvas.width;
  const L = ROLE_LOOK[role] || ROLE_LOOK.greenberet;
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, L.bg);
  g.addColorStop(1, '#111');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // shoulders
  ctx.fillStyle = opts.disguised ? '#6a6e66' : '#3b3f2c';
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 1.02, s * 0.45, s * 0.3, 0, Math.PI, 0);
  ctx.fill();
  // head
  const hg = ctx.createRadialGradient(s * 0.44, s * 0.45, s * 0.04, s / 2, s * 0.5, s * 0.26);
  hg.addColorStop(0, L.skin);
  hg.addColorStop(1, '#5a3d2c');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 0.52, s * 0.2, s * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#1a1512';
  ctx.fillRect(s * 0.4, s * 0.5, s * 0.06, s * 0.025);
  ctx.fillRect(s * 0.54, s * 0.5, s * 0.06, s * 0.025);
  // headgear
  ctx.fillStyle = opts.disguised ? '#3a3d3a' : L.hat;
  ctx.beginPath();
  const shape = opts.disguised ? 'peaked' : L.hatShape;
  if (shape === 'beret') ctx.ellipse(s * 0.46, s * 0.33, s * 0.24, s * 0.09, -0.2, 0, Math.PI * 2);
  else if (shape === 'helmet') ctx.ellipse(s / 2, s * 0.36, s * 0.25, s * 0.16, 0, Math.PI, 0);
  else if (shape === 'hood') ctx.ellipse(s / 2, s * 0.42, s * 0.24, s * 0.2, 0, Math.PI * 0.95, Math.PI * 0.05);
  else if (shape === 'peaked') { ctx.ellipse(s / 2, s * 0.32, s * 0.24, s * 0.08, 0, 0, Math.PI * 2); ctx.rect(s * 0.3, s * 0.34, s * 0.4, s * 0.04); }
  else ctx.ellipse(s / 2, s * 0.34, s * 0.21, s * 0.08, 0, Math.PI, 0);
  ctx.fill();
  // label
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `bold ${Math.round(s * 0.14)}px sans-serif`;
  ctx.fillText(L.label, s * 0.06, s * 0.18);
  if (opts.dead) {
    ctx.fillStyle = 'rgba(80,0,0,0.55)';
    ctx.fillRect(0, 0, s, s);
  }
}

const _cache = new Map();
const _photos = new Map(); // role -> photo still URL (talking-portrait poster frames, docs/talking-portraits.md)

/**
 * Register a photo still for `role` (ui/talking-portraits.js does this from assets/portraits/manifest.json).
 * getPortraitURL then returns it for the plain variant; the procedural portrait stays the fallback.
 * @param {string} role game role id ('greenberet', 'diver', …)
 * @param {string|null} url image URL (null unregisters)
 */
export function registerPortraitPhoto(role, url) {
  if (url) _photos.set(role, url);
  else _photos.delete(role);
}

/** Registered photo still for `role`, or null. */
export function portraitPhotoURL(role) {
  return _photos.get(role) || null;
}

/** Procedural portrait bitmap: `size` × this, at most PORTRAIT_MAX_PX (the photo portraits are 256 px). */
export const PORTRAIT_SUPERSAMPLE = 3;
export const PORTRAIT_MAX_PX = 384;

/**
 * Portrait as a data URL (cached per role/size/variant). Returns '' outside the browser.
 * @param {string} role
 * @param {{size?:number, disguised?:boolean, dead?:boolean, procedural?:boolean}} [opts]
 */
export function getPortraitURL(role, opts = {}) {
  if (typeof document === 'undefined') return '';
  if (!opts.disguised && !opts.dead && !opts.procedural && _photos.has(role)) return _photos.get(role);
  const size = opts.size ?? 96;
  const key = `${role}|${size}|${!!opts.disguised}|${!!opts.dead}`;
  if (_cache.has(key)) return _cache.get(key);
  // `size` is the HUD's nominal px (the 40-ref-px face at uiScale 2); the bitmap carries PORTRAIT_SUPERSAMPLE × that so
  // the face stays sharp at uiScale 3 or on a 2-3× screen (a size-px canvas there was upscaled 1.5-3×: pixelated)
  const px = Math.min(PORTRAIT_MAX_PX, Math.round(size * PORTRAIT_SUPERSAMPLE));
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.scale(px / size, px / size);
  drawPortrait(ctx, role, { ...opts, size });
  const url = c.toDataURL('image/png');
  _cache.set(key, url);
  return url;
}

export default getPortraitURL;
