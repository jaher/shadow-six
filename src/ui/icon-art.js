/**
 * Rendered HUD icons (tools/blender/icons → assets/ui/icons): knapsack items, top-right tools with their state
 * variants, portrait stamps and cursors. Each icon ships at several pixel densities over its reference box
 * (1×–6× ref px, stamps to 16×), lossless WebP. The tier is picked in JS by the pixels the icon covers: drawn CSS px
 * per ref px × devicePixelRatio, the smallest tier at or above that (pickTier). Not by `srcset`: Chrome's x-descriptor
 * choice takes the lower of two candidates up to their geometric mean (a 3× tier on a 3.4× need: 0.87 of the pixels).
 * The markup starts from the UI scale (`--u` × `mult`); once laid out, fitIcon() measures the real drawn size (touch
 * HUD scales --ut / --ub, a knapsack slot smaller than the ref box, the open notebook, a stamp over a portrait) and
 * switches the file (installIconFit: one ResizeObserver over every icon, and a DPR watch for zoom / a monitor
 * change). Never nearest-neighbour scaling (no pixelated image-rendering).
 * WebP first; if a file fails the image falls back to the PNG tier, then to the old inline SVG sketch.
 * @module ui/icon-art
 */

import { ICON_MANIFEST } from './icon-manifest.js';
import { ITEM_ICONS, GLYPHS, EYE_SVG } from './icons.js';
import { CURSORS, FORBIDDEN, SPARKLE } from './cursor-sprites.js';

export const ICON_BASE = 'assets/ui/icons/';
let base = ICON_BASE;
try {
  base = new URL('../../assets/ui/icons/', import.meta.url).href;
} catch { /* node without URL base: keep the relative path */ }

/** Knapsack item id → art id (items.js ids; the pistol is the Colt unless every man selected is the Spy). */
const ITEM_ART = { pistol: 'item/pistol.colt1911' };
/** Count glyphs (§6.4 "individual icons") per item. */
export const COUNT_ART = { grenade: 'item/grenade.mini', timeBomb: 'item/charge.mini', remoteBomb: 'item/charge.mini', sniperRifle: 'item/cartridge' };

/** Density of a tier key ('1p5x' → 1.5). */
export const tierDensity = (k) => Number(String(k).replace('x', '').replace('p', '.'));

/** Manifest entry for an art id ('item/knife'), or null. */
export function iconEntry(id) {
  return ICON_MANIFEST[id] || null;
}

/** Art id for a knapsack item id (`roles`: the selected men, for the per-man pistol). */
export function itemArt(itemId, roles = []) {
  if (itemId === 'pistol' && roles.length && roles.every((r) => r === 'spy')) return 'item/pistol.p38';
  const id = ITEM_ART[itemId] || `item/${itemId}`;
  return ICON_MANIFEST[id] ? id : null;
}

/** Tier keys of an entry, lowest density first. */
function tiers(e) {
  return Object.keys(e.t).sort((a, b) => tierDensity(a) - tierDensity(b));
}

/** Pixel rounding slack: a tier within 1 % of the need covers it (a 49.5-px box ships as 49 or 50 px). */
export const FIT_SLACK = 0.99;

/** Smallest tier whose density ≥ `need` (else the largest). `png`: only tiers with a PNG fallback. */
export function pickTier(id, need, png = false) {
  const e = ICON_MANIFEST[id];
  if (!e) return null;
  const ks = tiers(e).filter((k) => !png || e.t[k][2]);
  return ks.find((k) => tierDensity(k) >= need * FIT_SLACK - 1e-6) || ks[ks.length - 1] || null;
}

/** URL of one file. */
export function iconURL(id, tier, fmt = 'webp') {
  return `${base}${id}@${tier}.${fmt}`;
}

/** Density needed for an icon drawn at `scale` CSS px per ref px on a `dpr` screen (cursors too: they scale with the UI). */
export function needDensity(scale = 1, dpr = 1) {
  return Math.max(0.5, scale) * Math.max(1, dpr);
}

/** The tier for an icon drawn at `scale` CSS px per ref px on a `dpr` screen. */
export function tierFor(id, scale = 1, dpr = 1) {
  return pickTier(id, needDensity(scale, dpr));
}

/** Current UI scale (--u on :root) and device pixel ratio. */
export function currentScale() {
  if (typeof document === 'undefined') return 1;
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'));
  return u > 0 ? u : 1;
}
export const dprNow = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * `<img>` markup for an art id. Every class is sized in ref px (cursors included: 32 ref px, so they keep the HUD's scale).
 * `fb`: fallback key into FALLBACK_SVG (defaults to the art id). `v`: tool state variant name. `mult`: drawn size
 * over the ref box (a 16-px stamp stretched over a 40-px face → 2.5) so the tier stays sharp.
 */
export function iconHTML(id, { cls = '', fb = '', v = '', scale, mult = 1 } = {}) {
  const e = ICON_MANIFEST[id];
  if (!e) return fallbackFor(fb || id) || '';
  const cursor = id.startsWith('cursor/');
  const s = (scale ?? currentScale()) * mult;
  const t = tierFor(id, s, dprNow());
  const [w, h] = e.b;
  const attrs = [`class="ico${cls ? ` ${cls}` : ''}"`, `data-icon="${esc(id)}"`, `src="${esc(iconURL(id, t))}"`, `data-tier="${t}"`,
    `width="${w}" height="${h}"`, 'alt=""', 'draggable="false"', 'decoding="async"'];
  if (fb) attrs.push(`data-fb="${esc(fb)}"`);
  if (v) attrs.push(`data-v="${esc(v)}"`);
  if (mult !== 1) attrs.push(`data-mult="${mult}"`);
  if (cursor) attrs.push('data-cursor-art="1"');
  return `<img ${attrs.join(' ')}>`;
}

/** Tool button content: the base render + every state variant the manifest has (hover/pressed/active/disabled). */
export const TOOL_STATES = ['hover', 'pressed', 'active', 'disabled'];
export function toolHTML(id, { fb = '', cls = '' } = {}) {
  let h = iconHTML(id, { fb, cls, v: 'base' });
  for (const s of TOOL_STATES) if (ICON_MANIFEST[`${id}.${s}`]) h += iconHTML(`${id}.${s}`, { fb, cls, v: s });
  return h;
}

/** Fallback SVG registry: art id → the old inline SVG sketch (used only when both image formats fail). */
export const FALLBACK_SVG = {};
export function registerFallbacks(map, prefix = '') {
  for (const [k, svg] of Object.entries(map)) if (typeof svg === 'string') FALLBACK_SVG[prefix + k] = svg;
}
/** Fallback for an art id: exact, else drop trailing '.variant' segments ('tool/eye.open.hover' → 'tool/eye'). */
export function fallbackFor(id) {
  let k = String(id || '');
  while (k) {
    if (FALLBACK_SVG[k]) return FALLBACK_SVG[k];
    const i = k.lastIndexOf('.');
    if (i <= k.indexOf('/')) break;
    k = k.slice(0, i);
  }
  return FALLBACK_SVG['item/star'] && id.startsWith('item/') ? FALLBACK_SVG['item/star'] : '';
}
const HELP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 34" aria-hidden="true"><text x="9" y="27" text-anchor="middle" font-size="26" fill="#c9a24a">?</text></svg>';
registerFallbacks(ITEM_ICONS, 'item/');
registerFallbacks(GLYPHS, 'stamp/');
registerFallbacks({
  'item/leeEnfield': ITEM_ICONS.sniperRifle, 'item/beretta': ITEM_ICONS.pistol, 'item/grenade.mini': ITEM_ICONS.grenade,
  'item/charge.mini': ITEM_ICONS.timeBomb, 'item/star': GLYPHS.star, 'tool/camera': GLYPHS.camera, 'tool/hand': GLYPHS.hand,
  'tool/eye': EYE_SVG, 'tool/lamp': GLYPHS.lamp, 'tool/stance.crawl': GLYPHS.prone, 'tool/stance.stand': GLYPHS.stand,
  'tool/help': HELP_SVG, 'cursor/forbidden': FORBIDDEN, 'cursor/sparkle': SPARKLE, 'cursor/hand.open': CURSORS.hand.svg,
  'cursor/eye': CURSORS.eye.svg, 'cursor/scope': CURSORS.scope.svg, 'cursor/fist': CURSORS.grab.svg,
});
for (const [k, c] of Object.entries(CURSORS)) if (!FALLBACK_SVG[`cursor/${k}`]) FALLBACK_SVG[`cursor/${k}`] = c.svg;

/**
 * Image error → PNG tier → inline SVG. Installed once (capture phase: `error` does not bubble).
 * The PNG is the tier with a PNG file closest above the needed density.
 */
export function onIconError(img) {
  const id = img?.dataset?.icon;
  if (!id || !ICON_MANIFEST[id]) return false;
  const cursor = id.startsWith('cursor/');
  const need = needDensity(drawnScale(img) || (cursor ? 1 : currentScale()) * (Number(img.dataset.mult) || 1), dprNow());
  if (!img.dataset.png) {
    const t = pickTier(id, need, true);
    if (t) {
      img.dataset.png = '1';
      img.removeAttribute('srcset');
      img.src = iconURL(id, t, 'png');
      return true;
    }
  }
  const svg = fallbackFor(img.dataset.fb || id);
  if (!svg || !img.parentNode) return false;
  const tpl = document.createElement('template');
  tpl.innerHTML = svg.trim();
  const node = tpl.content.firstElementChild;
  if (!node) return false;
  node.setAttribute('class', `${img.getAttribute('class') || ''} ico-fallback`.trim());
  if (img.dataset.v) node.dataset.v = img.dataset.v;
  if (img.hidden) node.style.visibility = 'hidden';
  img.replaceWith(node);
  return true;
}

let installed = false;
/** Install the global fallback handler (idempotent). */
export function installIconFallback(doc = typeof document !== 'undefined' ? document : null) {
  if (installed || !doc) return;
  installed = true;
  doc.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset?.icon) onIconError(t);
  }, true);
}

/** Point every rendered icon under `root` at the tier for a new UI scale: by its measured drawn size when laid out
 *  (fitIcon), else by `scale` × its `mult`. */
export function refreshIcons(root, scale = currentScale()) {
  if (!root?.querySelectorAll) return 0;
  let n = 0;
  for (const img of root.querySelectorAll('img.ico[data-icon]')) {
    if (img.dataset.png) continue;
    if (drawnScale(img)) { if (fitIcon(img)) n++; continue; }
    if (img.dataset.cursorArt) continue; // the cursor layer re-renders its sprite for a new scale
    if (setTier(img, tierFor(img.dataset.icon, scale * (Number(img.dataset.mult) || 1), dprNow()))) n++;
  }
  return n;
}

/** Show tier `t` of an icon <img> (no-op when it already does). */
function setTier(img, t) {
  if (!t || img.dataset.tier === t) return false;
  img.dataset.tier = t;
  img.removeAttribute('srcset');
  img.src = iconURL(img.dataset.icon, t);
  return true;
}

/** Content box of a laid-out element in CSS px, or null: the larger of its layout box and its box on screen (an
 *  enlarging transform counts; a card still scaling in from 0.96 does not shrink it, as nothing re-measures after). */
function contentBox(el) {
  const r = el?.getBoundingClientRect?.();
  const w = Math.max(r?.width || 0, el?.offsetWidth || 0), h = Math.max(r?.height || 0, el?.offsetHeight || 0);
  if (!(w > 0 && h > 0)) return null;
  const cs = getComputedStyle(el);
  const pw = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const ph = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return w - pw > 0 && h - ph > 0 ? [w - pw, h - ph] : null;
}

/**
 * CSS px per ref px at which an icon <img> draws its art: its content box over the manifest ref box, by its
 * object-fit (contain: the smaller ratio; cover / fill: the larger, so a stretched axis is never short of pixels).
 * A state variant that is not laid out (`hidden`) takes the box of a laid-out sibling with the same ref box (the
 * button's other states); null when neither is laid out.
 */
export function drawnScale(img) {
  const e = ICON_MANIFEST[img?.dataset?.icon];
  if (!e || typeof getComputedStyle !== 'function') return null;
  let box = contentBox(img);
  if (!box) {
    for (const sib of img.parentElement?.children || []) {
      const se = sib !== img && ICON_MANIFEST[sib.dataset?.icon];
      if (se && se.b[0] === e.b[0] && se.b[1] === e.b[1] && (box = contentBox(sib))) break;
    }
  }
  if (!box) return null;
  const kx = box[0] / e.b[0], ky = box[1] / e.b[1];
  const fit = getComputedStyle(img).objectFit;
  const k = fit === 'contain' || fit === 'scale-down' ? Math.min(kx, ky) : Math.max(kx, ky);
  return k > 0 && Number.isFinite(k) ? k : null;
}

/**
 * Show the tier that covers every device pixel the icon is drawn over (drawnScale × DPR). Returns true when the file
 * changed. Until the new file has loaded the browser keeps showing the old one (no blank frame).
 */
export function fitIcon(img) {
  const id = img?.dataset?.icon;
  if (!id || img.dataset.png || !ICON_MANIFEST[id]) return false;
  const k = drawnScale(img);
  if (!k) return false;
  img.dataset.fit = k.toFixed(3);
  return setTier(img, tierFor(id, k, dprNow()));
}

let fitRO = null;
/**
 * Fit every rendered icon in the document to its drawn size, now and whenever it is added or resized (UI scale,
 * touch HUD scales, the notebook opening, a knapsack re-layout) or the DPR changes (browser zoom, another monitor).
 * One ResizeObserver + one MutationObserver (idempotent). Swapping the file never changes layout (every icon has
 * width/height attributes and a CSS box), so there is no resize loop.
 */
export function installIconFit(doc = typeof document !== 'undefined' ? document : null) {
  if (fitRO || !doc?.documentElement || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return false;
  const refit = (img) => {
    fitIcon(img);
    // hidden state variants share the button box: they follow the laid-out one
    for (const sib of img.parentElement?.children || []) if (sib !== img && sib.tagName === 'IMG' && sib.dataset?.icon) fitIcon(sib);
  };
  fitRO = new ResizeObserver((entries) => { for (const en of entries) refit(en.target); });
  const each = (n, fn) => {
    if (n?.nodeType !== 1) return;
    if (n.matches('img.ico[data-icon]')) fn(n);
    else if (n.firstElementChild) for (const i of n.querySelectorAll('img.ico[data-icon]')) fn(i);
  };
  const watch = (img) => fitRO.observe(img);
  const unwatch = (img) => fitRO.unobserve(img);
  new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.removedNodes) if (!n.isConnected) each(n, unwatch);
      for (const n of r.addedNodes) if (n.isConnected) each(n, watch);
    }
  }).observe(doc.documentElement, { childList: true, subtree: true });
  each(doc.documentElement, watch);
  // a DPR change (zoom, a window dragged to another screen) resizes nothing in CSS px: refit everything on it
  const watchDpr = () => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(`(resolution: ${dprNow()}dppx)`);
    const on = () => {
      mq.removeEventListener?.('change', on);
      for (const img of doc.querySelectorAll('img.ico[data-icon]')) refit(img);
      watchDpr();
    };
    mq.addEventListener?.('change', on);
  };
  watchDpr();
  return true;
}

const keep = new Map(); // url → HTMLImageElement (kept alive so the cache holds the decoded bitmaps)
/**
 * Preload the tier each icon will use at this scale/DPR (all classes, all state variants), so nothing pops in
 * when the knapsack or a tool state changes. Resolves when every image decoded (or failed).
 */
export function preloadIcons(scale = currentScale(), dpr = dprNow(), filter = null) {
  if (typeof Image === 'undefined') return Promise.resolve([]);
  const jobs = [];
  for (const id of Object.keys(ICON_MANIFEST)) {
    if (filter && !filter(id)) continue;
    const url = iconURL(id, pickTier(id, needDensity(id.startsWith('cursor/') ? 1 : scale, dpr)));
    if (keep.has(url)) {
      jobs.push(keep.get(url)._p);
      continue;
    }
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
    im._p = (im.decode ? im.decode() : Promise.resolve()).then(() => true, () => false);
    keep.set(url, im);
    jobs.push(im._p);
  }
  return Promise.all(jobs);
}

/**
 * Tool button states (§6.1 icons): base / hover / pressed / active (armed tool) / disabled, each a separate render.
 * Priority: disabled > pressed > active > hover > base; a missing variant falls back to the base image.
 */
export function applyToolState(btn) {
  const dis = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled');
  const s = dis ? 'disabled' : btn._press ? 'pressed' : btn.classList.contains('armed') ? 'active' : btn._hover ? 'hover' : 'base';
  const imgs = [...btn.querySelectorAll(':scope > .ico[data-v]')];
  const want = imgs.some((i) => i.dataset.v === s) ? s : 'base';
  for (const i of imgs) {
    const on = i.dataset.v === want;
    if (i.tagName === 'IMG') i.hidden = !on;
    else i.style.visibility = on ? '' : 'hidden';
  }
  btn.dataset.state = s;
  return s;
}

/** Wire pointer states on a tool button (idempotent). */
export function wireToolStates(btn) {
  if (btn._toolWired) return btn;
  btn._toolWired = true;
  const set = (k, v) => () => { btn[k] = v; applyToolState(btn); };
  btn.addEventListener('pointerenter', set('_hover', true));
  btn.addEventListener('pointerleave', () => { btn._hover = false; btn._press = false; applyToolState(btn); });
  btn.addEventListener('pointerdown', set('_press', true));
  btn.addEventListener('pointerup', set('_press', false));
  btn.addEventListener('pointercancel', set('_press', false));
  applyToolState(btn);
  return btn;
}
