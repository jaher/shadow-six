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
export const HERO_FACE = { x0: 0.362, y0: 0.16, x1: 0.608, y1: 0.338 };

/**
 * The figure's silhouette, row by row: 24 bands down the image, each the [x0, x1] fractions of its opaque span (null:
 * empty), measured on the art's alpha. The splash's Spitfires keep their bursts out of it on every form factor
 * (splash-planes.js).
 */
export const HERO_ROWS = [null, null, null, null, [0.412, 0.583], [0.15, 0.588], [0.157, 0.593], [0.167, 0.582], [0.175, 0.72], [0.2, 0.798], [0.178, 0.82], [0.148, 0.827], [0.15, 0.83], [0.148, 0.83], [0.183, 0.815], [0.29, 0.815], [0.223, 0.813], [0.218, 0.813], [0.21, 0.818], [0.207, 0.822], [0.208, 0.82], [0.222, 0.803], [0.277, 0.722], [0.277, 0.722]];

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
