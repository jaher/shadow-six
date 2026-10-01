/**
 * Rendered HUD icons (tools/blender/icons → assets/ui/icons): knapsack items, top-right tools with their state
 * variants, portrait stamps and cursors. Each icon ships at several pixel densities over its reference box
 * (items/tools/stamps 2×–6× ref px, cursors 1×–3× CSS px); `<img srcset>` lists them as x-descriptors for the
 * current UI scale, so the browser picks the tier for the screen's DPR (1080p, 1440p, 4K, zoom).
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

/** Smallest tier whose density ≥ `need` (else the largest). `png`: only tiers with a PNG fallback. */
export function pickTier(id, need, png = false) {
  const e = ICON_MANIFEST[id];
  if (!e) return null;
  const ks = tiers(e).filter((k) => !png || e.t[k][2]);
  return ks.find((k) => tierDensity(k) >= need - 1e-6) || ks[ks.length - 1] || null;
}

/** URL of one file. */
export function iconURL(id, tier, fmt = 'webp') {
  return `${base}${id}@${tier}.${fmt}`;
}

/** Density needed for an icon drawn at `scale` CSS px per ref px on a `dpr` screen (cursors too: they scale with the UI). */
export function needDensity(scale = 1, dpr = 1) {
  return Math.max(0.5, scale) * Math.max(1, dpr);
}

/** srcset (x-descriptors relative to CSS px at `scale`) + default src for an art id. */
export function srcsetFor(id, scale = 1, dpr = 1) {
  const e = ICON_MANIFEST[id];
  if (!e) return null;
  const s = Math.max(0.5, scale);
  const set = tiers(e).map((k) => `${iconURL(id, k)} ${+(tierDensity(k) / s).toFixed(3)}x`).join(', ');
  return { src: iconURL(id, pickTier(id, needDensity(s, dpr))), srcset: set };
}

/** Current UI scale (--u on :root) and device pixel ratio. */
export function currentScale() {
  if (typeof document === 'undefined') return 1;
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'));
  return u > 0 ? u : 1;
}
const dprNow = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);

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
  const { src, srcset } = srcsetFor(id, s, dprNow());
  const [w, h] = e.b;
  const attrs = [`class="ico${cls ? ` ${cls}` : ''}"`, `data-icon="${esc(id)}"`, `src="${esc(src)}"`, `srcset="${esc(srcset)}"`,
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
  const need = needDensity((cursor ? 1 : currentScale()) * (Number(img.dataset.mult) || 1), dprNow());
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

/** Re-point every rendered icon under `root` at the tiers for a new UI scale (x-descriptors depend on it). */
export function refreshIcons(root, scale = currentScale()) {
  if (!root?.querySelectorAll) return 0;
  let n = 0;
  for (const img of root.querySelectorAll('img.ico[data-icon]')) {
    if (img.dataset.png || img.dataset.cursorArt) continue;
    const r = srcsetFor(img.dataset.icon, scale * (Number(img.dataset.mult) || 1), dprNow());
    if (!r || img.getAttribute('srcset') === r.srcset) continue;
    img.setAttribute('srcset', r.srcset);
    img.src = r.src;
    n++;
  }
  return n;
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
