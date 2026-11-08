/**
 * The title splash's plate as the stage shows it, on every form factor (user, 2026-11-08, on a foldable phone: "the
 * first in the intro screen is shifted away from the tank" — the fire — and "I dont see the bombs on the phone but I
 * do on the computer. The coordinates should adjust to form factor").
 * The plate (assets/ui/keyart/sky-*.{webp,avif}: the field, the dusk sky and the burning Panzer IV, 16:9) is
 * `.bt-l.sky`: the stage grown 3 % on every side (inset -3 %, 106 %), the plate cover-fitted into that box. On a
 * stage narrower than 16:9 the cover crops the plate's sides; its crop then slides (plateFocusX, from the live
 * layout: no per-device numbers) so the burning tank's deck stands just clear of the hero instead of behind him or
 * off screen. boot.js sets it as `--plate-x` (styles/menus.css object-position) on every change of the stage's
 * shape (resize, fold / unfold, rotation, DPR) and every layer tied to the plate maps plate space through this one
 * transform with the same focus: the fire, its smoke and its light (splash-fx.js), the Spitfires' horizon, bomb line
 * and sky flash (splash-planes.js), the painted fallback fire (boot.js).
 * Plate space: (u, v) in 0..1 from the plate's top-left corner. Pure; tests/unit/splash-plate.test.mjs.
 * @module ui/splash-plate
 */

import { HERO_ROWS } from './hero-art.js';

/** The plate's aspect (width / height). */
export const PLATE_ASPECT = 16 / 9;

/** The cover crop's default anchor (x, y fractions; `.bt-l.sky` object-position, x from `--plate-x`). */
export const PLATE_FOCUS = [0.5, 0.5];

/** The burning engine deck (the main fire source, splash-fx.js FIRE.src[0]) on the plate, (u, v). */
export const DECK = [(0.6426 + 0.03) / 1.06, 1 - (0.254 + 0.03) / 1.06];

/** The burning Panzer IV on the plate, gun included: [u0, v0, u1, v1] (measured on sky-1600.webp). */
export const TANK_BOX = [0.59, 0.665, 0.815, 0.842];

/**
 * The tank's silhouette on the plate ((u, v) points: hull, turret, cupola, gun; traced on sky-1600.webp): the bursts
 * on the far field behind it are clipped by it, so it stands in front of them (splash-planes.js).
 */
export const TANK_POLY = [[0.5925, 0.7724], [0.6, 0.7464], [0.6625, 0.7464], [0.6625, 0.702], [0.682, 0.698], [0.6833, 0.6664],
  [0.6992, 0.6664], [0.7, 0.6908], [0.75, 0.6983], [0.8125, 0.6946], [0.8133, 0.7072], [0.75, 0.7146], [0.75, 0.7464],
  [0.7875, 0.7487], [0.8104, 0.7872], [0.8092, 0.8132], [0.7917, 0.8406], [0.6, 0.8406], [0.5925, 0.8169]];

/** The far field's line on the plate (v), where the Spitfires' bombs burst: the foot of the distant hills. */
export const HORIZON_V = 0.79;

/**
 * The plate's drawn rect in stage px for a W x H stage: cover-fitted into the 106 % box, anchored at `focus`.
 * @returns {{x:number, y:number, w:number, h:number}} top-left corner and size
 */
export function plateRect(W, H, focus = PLATE_FOCUS) {
  const bx = -0.03 * W, by = -0.03 * H, bw = 1.06 * W, bh = 1.06 * H;
  const h = Math.max(bh, bw / PLATE_ASPECT), w = h * PLATE_ASPECT;
  return { x: bx + (bw - w) * focus[0], y: by + (bh - h) * focus[1], w, h };
}

/**
 * The hero as styles/menus.css draws him on a W x H stage (`.bt-l.hero`: the full height, at most 92 % of the
 * width, centred, his feet 12 % below the bottom edge; the art is 2:3). @returns {{x:number, y:number, w:number, h:number}}
 */
export function heroLayout(W, H) {
  const w = Math.min((H * 2) / 3, 0.92 * W), h = w * 1.5;
  return { x: (W - w) / 2, y: 1.12 * H - h, w, h };
}

/**
 * The crop's x anchor for a W x H stage (0.5..0.75): when the plate is wider than its box, the burning deck is set
 * just clear of the hero's silhouette at its height (HERO_ROWS), never past 0.86 of the width; 0.5 when the plate
 * fits the box's width (16:9 and wider) or no slide is needed. `hero` is his drawn rect (heroLayout), stage px.
 */
export function plateFocusX(W, H, hero = heroLayout(W, H)) {
  const bx = -0.03 * W, bw = 1.06 * W, bh = 1.06 * H, h = Math.max(bh, bw / PLATE_ASPECT), w = h * PLATE_ASPECT;
  if (w - bw < 1) return 0.5;
  const dy = -0.03 * H + (bh - h) / 2 + DECK[1] * h;
  const row = HERO_ROWS[Math.floor(((dy - hero.y) / hero.h) * HERO_ROWS.length)];
  const right = row ? hero.x + row[1] * hero.w : hero.x;
  const target = Math.min(right + 0.06 * W, 0.86 * W);
  return Math.min(0.75, Math.max(0.5, (target - bx - DECK[0] * w) / (bw - w)));
}

/** A plate point (u, v from the top-left) in stage px. @returns {[number, number]} */
export function plateToStage(u, v, W, H, r = plateRect(W, H)) {
  return [r.x + u * r.w, r.y + v * r.h];
}

/** A stage point (px) in plate space. @returns {[number, number]} */
export function stageToPlate(x, y, W, H, r = plateRect(W, H)) {
  return [(x - r.x) / r.w, (y - r.y) / r.h];
}

/**
 * The plate rect as the fx shader's uniform: its origin and size in the canvas' uv (x from the left, y from the
 * bottom), so the shader turns its stage uv into plate uv. @returns {[number, number, number, number]}
 */
export function plateUniform(W, H, r = plateRect(W, H)) {
  return [r.x / W, 1 - (r.y + r.h) / H, r.w / W, r.h / H];
}
