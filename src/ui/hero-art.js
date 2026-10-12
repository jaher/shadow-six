/**
 * The title splash hero (S03 key art, tools/ui/keyart/herohd): an offline Cycles render shipped in four heights,
 * 2:3, as AVIF with a WebP fallback. The splash shows it at the full viewport height (styles/menus.css .bt-l.hero), so
 * the variant is the smallest one at least as tall as the viewport in device pixels, capped at the 2700 px master:
 * a 1080p screen gets 1350, 1440p 1800, 4K (and phone portrait, ~2400 px) 2700. Behind him, the background plate
 * (the burning tank in its field over the sky, tools/ui/keyart/herohd/backdrop.py) comes in two widths; sky.svg is
 * the fallback of both.
 * @module ui/hero-art
 */

/** Variant heights (px); widths are 2/3 of these. */
export const HERO_HEIGHTS = [900, 1350, 1800, 2700];

/**
 * The head in the art (beret top to chin, the beret's overhang to the far ear), as fractions of the image (0..1, y
 * down; tools/ui/keyart/herohd/facebox.py): the splash layout
 * keeps the wordmark, tagline and prompt off it (tests/ui-hero.test.mjs).
 */
export const HERO_FACE = { x0: 0.331, y0: 0.15, x1: 0.612, y1: 0.338 };

/**
 * @param {number} cssHeight viewport height in CSS px
 * @param {number} [dpr] devicePixelRatio
 * @returns {number} the variant height to load
 */
export function heroHeight(cssHeight, dpr = 1) {
  const need = Math.min(HERO_HEIGHTS[HERO_HEIGHTS.length - 1], Math.round(cssHeight * (dpr > 0 ? dpr : 1)));
  return HERO_HEIGHTS.find((h) => h >= need) ?? HERO_HEIGHTS[HERO_HEIGHTS.length - 1];
}

/** Splash background plate widths (16:9, the rendered ground and burning tank over the SVG sky). */
export const SKY_WIDTHS = [1600, 3200];

/**
 * The plate is drawn 'cover' at 106 % of the viewport (parallax margin), so it needs max(w, h * 16/9) * 1.06 device px.
 * @returns {number} the plate width to load
 */
export function skyWidth(cssWidth, cssHeight, dpr = 1) {
  const need = Math.max(cssWidth, cssHeight * 16 / 9) * 1.06 * (dpr > 0 ? dpr : 1);
  return SKY_WIDTHS.find((w) => w >= need) ?? SKY_WIDTHS[SKY_WIDTHS.length - 1];
}

/** @returns {string} the asset URL of a variant ('avif' | 'webp') */
export function heroUrl(height, format = 'webp') {
  return `assets/ui/keyart/hero-${height}.${format}`;
}

/** @returns {string} the asset URL of a background plate ('avif' | 'webp') */
export function skyUrl(width, format = 'webp') {
  return `assets/ui/keyart/sky-${width}.${format}`;
}

/** @returns {number} the variant height named in a hero URL (0 if none) */
export function heroHeightOf(url) {
  const m = /hero-(\d+)\.(?:avif|webp)(?:[?#].*)?$/.exec(url || '');
  return m ? +m[1] : 0;
}
