/**
 * S03 title splash: a distant fighter formation — Spitfires — that now and then crosses the sky behind the hero
 * and, mid-pass, puts its bombs on the far field. Each bomber lets go the 250 lb pair from under its wings (near
 * wing first): the bombs, drawn to the planes' scale, leave at the plane's speed, drop back as drag slows them and
 * pitch nose-down as gravity curves them to the ground. Each burst flashes on the cloud base above it (the sky
 * plate itself, lit up through a mask, so the clouds glow and the gaps stay dark), then a white-yellow flash, a
 * fireball, a fountain of earth with clods and sparks, and a smoke plume that lingers on the horizon, in the
 * burning tank's dusk palette. Canvas 2D on its own `.bt-l` layer, between the painted sky plate
 * and the light pass, so the hero always occludes it. The planes are prerendered sprites: a Spitfire LF Mk IX
 * modelled and rendered offline in the splash's dusk light (tools/ui/splash/spitfire: seen from below the
 * starboard side, three formation poses, each bombed-up, half and clean, plus the falling bomb;
 * assets/ui/keyart/spitfires.webp, layout and wing hardpoints in spitfire-atlas.js). The atlas is fetched at low
 * priority after the plate and hero, before the first pass, and scaled once per pass to the corridor's size; until
 * it is decoded (or if it fails) a pass flies the silhouette drawn in code below. Per frame it
 * is a handful of drawImage calls, and between passes
 * there is no per-frame cost at all — one timer schedules the next pass and the rAF loop runs only while a pass
 * or its smoke is alive. The corridor is measured off the live layout at every pass: below the wordmark block
 * to the open field left of the hero and is skipped only when the bursts would actually reach the figure
 * (the stick's right edge plus the fireball's reach is measured against the face box's left edge — an
 * earlier flat cutoff at 0.42 of the window width sat within a few px of that edge at squarish aspects
 * and flickered with the hero's idle animation, silently killing the drops). On a very short stage the
 * lane is retried with tight clearances rather than sitting the pass out. Under reduced
 * motion there are no passes, like the embers.
 * @module ui/splash-planes
 */

import { HERO_FACE } from './hero-art.js';
import { SPITFIRE_ATLAS } from './spitfire-atlas.js';

/** Formation slots behind the leader: [lengths back, lengths off the centreline, relative size, haze alpha]. Seen
 * from below, a Spitfire's elliptical wing makes each plane ~0.4 lengths tall, so the pairs open up vertically and
 * the far-side (lower) wingman of each pair trails a little: the planes stay distinct instead of merging into one
 * clump at 40-odd px. The whole formation spans the 1.36 units the corridor is sized for (_layout). */
const FORMATION = [
  [0.00, 0.00, 1.00, 0.90],
  [-1.00, -0.15, 0.97, 0.86],
  [-1.12, 0.15, 0.97, 0.86],
  [-2.00, -0.30, 0.94, 0.82],
  [-2.24, 0.30, 0.94, 0.82],
  [-3.00, -0.45, 0.91, 0.78],
  [-3.36, 0.45, 0.91, 0.78],
];
/** Layout units behind the leader's anchor where the last plane's tail ends (the pass is over past the edge). */
const END_LAG = 0.75 - Math.min(...FORMATION.map(([dx]) => dx));
/** Atlas pose of each slot (yaw / pitch / bank variants, so the formation is not seven clones). */
const POSE = ['a', 'b', 'c', 'c', 'a', 'b', 'c'];
/** The rendered Spitfire's length (spinner to rudder) in layout units — the drawn silhouette's span. */
const PLANE_LEN = 1.13;
/** ms after start() before the atlas is fetched: after the plate and hero, well before the first pass. */
const ATLAS_DELAY = 1200;
/** The drawn fallback silhouette is this much larger than the layout unit — at unit size the Spitfire's identifiers
 * (elliptical wing, prop, canopy) blur into a generic speck at full-screen video scale. */
const SPRITE_SCALE = 1.18;
/** Formation slots that carry bombs (the leader and the two inner pairs). */
const BOMBERS = [0, 1, 2, 3, 4];
/** Layout units below a slot where the sprite's anchor sits (the belly station under the wing centre section),
 * so the wing's bulk centres on the slot. */
const ANCHOR_DY = 0.12;
/** Bombs per bomber — the 250 lb pair under the wings, the near (starboard) one first — and their spacing (s),
 * so each pair lands as a short stick of two bursts. */
const STICK = 2, STICK_GAP = 0.18;
/** A falling bomb keeps the plane's speed at release and loses it to drag (1/s) while gravity curves it down. */
const DRAG = 0.45;
/** A burst's radius unit (fireball ~1.2 R, flash ~2 R) in layout units: a 250 lb burst at the formation's scale. */
const BURST_R = 0.7;
/** A 250 lb GP bomb with its tail (m) and the Spitfire (m), for drawing the falling bombs to the planes' scale. */
const BOMB_LEN = SPITFIRE_ATLAS.bombLen, PLANE_M = SPITFIRE_ATLAS.len;
/** Anchor impact points of the sticks, as fractions of the viewport width (the open field left of the hero). */
const IMPACTS = [0.13, 0.18, 0.23, 0.28, 0.325];
const FIRST_DELAY = 5000;               // ms after the splash is up before the first pass
const GAP_MIN = 55000, GAP_VAR = 55000; // idle gap between passes: 55–110 s
const PASS_TIME = 17;                   // s for the leader to cross the stage
const FALL_TIME = 1.9;                  // s a bomb falls from the corridor to the horizon
const HORIZON = 0.79;                   // horizon line of the sky plate, as a fraction of the layer height

/**
 * Fallback Spitfire silhouette (side profile, nose right) in a 240-unit box, flown until the rendered atlas is
 * decoded; origin at the fuselage centre. The identifiers are drawn to read at ~55 px on screen: the elliptical
 * wing slung under a slim fuselage, the single nose prop (blur disc + blade) with its pointed spinner, the bubble
 * canopy, and the rounded fin.
 */
function spitfireSprite() {
  const U = 240, SS = 2; // supersample
  const c = document.createElement('canvas');
  c.width = (U + 24) * SS; c.height = (0.62 * U + 24) * SS;
  const g = c.getContext('2d');
  g.scale(SS, SS);
  g.translate(12 + U / 2, 12 + 0.31 * U);
  const body = new Path2D();                                // slim fuselage + rounded fin, one outline
  body.moveTo(106, -6);
  body.bezierCurveTo(100, -13, 88, -16, 70, -16.5);         // cowling top
  body.bezierCurveTo(50, -17, 38, -15, 28, -13.5);          // to the windscreen base
  body.lineTo(-30, -10.5);                                  // dorsal line aft of the canopy
  body.bezierCurveTo(-48, -9.5, -58, -9, -66, -10);
  body.bezierCurveTo(-78, -12, -88, -22, -93, -31);         // fin leading edge, one smooth sweep
  body.bezierCurveTo(-96, -36, -103, -36.5, -106, -32);     // rounded fin top
  body.bezierCurveTo(-109, -26, -110, -14, -110, -4);       // rudder trailing edge
  body.bezierCurveTo(-110, 1, -106, 4, -98, 5);             // tail cone
  body.lineTo(-40, 7.5);                                    // underside
  body.bezierCurveTo(-16, 10, 2, 12.5, 20, 13);             // belly (radiator dip under the wing)
  body.bezierCurveTo(48, 13.5, 78, 11, 94, 8);              // cowling underside
  body.bezierCurveTo(100, 7, 104, 3, 106, -1);
  body.closePath();
  const wing = new Path2D();                                // the elliptical wing, slung low
  wing.ellipse(6, 15.5, 56, 10.5, -0.05, 0, Math.PI * 2);
  const tail = new Path2D();                                // elliptical tailplane
  tail.ellipse(-97, 3, 21, 5, 0.03, 0, Math.PI * 2);
  const canopy = new Path2D();                              // bubble canopy
  canopy.moveTo(28, -12.5);
  canopy.bezierCurveTo(24, -21, 12, -27, 0, -27.5);
  canopy.bezierCurveTo(-12, -28, -24, -20, -29, -11);
  canopy.closePath();
  const grad = g.createLinearGradient(0, -40, 0, 36);
  grad.addColorStop(0, '#252d36'); grad.addColorStop(0.55, '#0b0e13'); grad.addColorStop(1, '#05070a');
  g.fillStyle = grad;
  g.fill(wing); g.fill(body); g.fill(tail);                 // wing first: the fuselage paints over its root,
                                                            // so the ellipse tucks under the body as one
                                                            // silhouette instead of reading as a loose ring
  const rim = g.createLinearGradient(0, -4, 0, 36);         // warm under-rim from the fires below
  rim.addColorStop(0, 'rgba(255,138,64,0)');
  rim.addColorStop(1, 'rgba(255,138,64,0.34)');
  const sheen = g.createLinearGradient(0, -40, 0, -14);     // faint cool sheen on the back and fin
  sheen.addColorStop(0, 'rgba(170,190,210,0.13)');
  sheen.addColorStop(1, 'rgba(170,190,210,0)');
  for (const part of [body, tail]) {                       // clip per part (a second clip() would intersect);
    g.save(); g.clip(part);                                 // the wing stays unflooded — its warm cue is the
    g.fillStyle = rim; g.fillRect(-120, -4, 240, 40);       // lit lower-edge stroke below, or the whole
    g.fillStyle = sheen; g.fillRect(-120, -40, 240, 26);    // ellipse washes out as a glowing disc
    g.restore();
  }
  g.strokeStyle = 'rgba(255,150,80,0.30)';                  // lit lower edges only (clip to the belly half)
  g.lineWidth = 2.2;
  g.save(); g.beginPath(); g.rect(-122, 2, 244, 38); g.clip();
  g.stroke(body); g.restore();
  g.save(); g.beginPath(); g.rect(-122, 15, 244, 25); g.clip(); // the wing's arc only where it clears the
  g.stroke(wing); g.restore();                                  // belly — no outline across the fuselage
  const glass = g.createLinearGradient(0, -28, 0, -10);     // canopy glass: pale sky tone over the dome
  glass.addColorStop(0, 'rgba(150,180,205,0.7)');
  glass.addColorStop(1, 'rgba(24,32,42,0.9)');
  g.fillStyle = glass; g.fill(canopy);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.4; g.stroke(canopy);
  g.fillStyle = 'rgba(200,212,224,0.15)';                   // prop blur disc at the nose
  g.beginPath(); g.ellipse(116, -1, 3.4, 41, 0, 0, Math.PI * 2); g.fill();
  g.save();                                                 // one blade caught dark against the sky
  g.translate(116, -1); g.rotate(0.10);
  g.fillStyle = 'rgba(8,10,13,0.85)'; g.fillRect(-1.6, -38, 3.2, 76);
  g.restore();
  const spinner = new Path2D();                             // pointed spinner cone over the hub
  spinner.moveTo(124, 0);
  spinner.bezierCurveTo(118, -6, 110, -7.5, 102, -6);
  spinner.lineTo(102, 6);
  spinner.bezierCurveTo(110, 7.5, 118, 6, 124, 0);
  spinner.closePath();
  g.fillStyle = grad; g.fill(spinner);
  g.save(); g.clip(spinner);
  g.fillStyle = rim; g.fillRect(100, -4, 26, 12);
  g.restore();
  // anchor: fuselage centre sits at (12 + U/2, 12 + 0.31U) of (U + 24) x (0.62U + 24), in unscaled units
  return { c, ss: SS, ax: (12 + U / 2) / (U + 24), ay: (12 + 0.31 * U) / (0.62 * U + 24), ref: U };
}

/** Fallback falling bomb (body + box fins, flown with the drawn silhouette), pointing +x (direction of travel). */
function bombSprite() {
  const SS = 3;
  const c = document.createElement('canvas');
  c.width = 56 * SS; c.height = 24 * SS;
  const g = c.getContext('2d');
  g.scale(SS, SS);
  g.translate(28, 12);
  const body = new Path2D();
  body.moveTo(20, 0);
  body.bezierCurveTo(20, -4.4, 12, -5.6, 2, -5.6);
  body.lineTo(-13, -4.2);
  body.bezierCurveTo(-18, -4, -18, 4, -13, 4.2);
  body.lineTo(2, 5.6);
  body.bezierCurveTo(12, 5.6, 20, 4.4, 20, 0);
  body.closePath();
  g.fillStyle = '#04050a';
  g.fill(body);
  g.fillRect(-21, -6.5, 5, 13);                             // box fin (vertical)
  g.fillRect(-21, -1.8, 5, 3.6);                            // box fin (horizontal)
  g.strokeStyle = 'rgba(255,150,80,0.5)';
  g.lineWidth = 1;
  g.save(); g.beginPath(); g.rect(-22, 0, 44, 7); g.clip(); g.stroke(body); g.restore();
  g.strokeStyle = 'rgba(195,210,225,0.30)';                  // cool sheen along the back, so the falling
  g.save(); g.beginPath(); g.rect(-22, -7, 44, 7); g.clip(); g.stroke(body); g.restore(); // silhouette reads against dark sky too
  return { c, ss: SS, ref: 41 }; // ref: the body length in drawing units (x -21..20)
}

/**
 * One atlas cell scaled to `k` (device px per atlas px) by repeated halving, then once to size — a single large
 * drawImage step skips texels and shimmers the panel colours; each halving averages them. Done once per pass.
 * @returns {HTMLCanvasElement}
 */
function scaleCell(img, [x, y, w, h], k) {
  let src = img, sx = x, sy = y, sw = w, sh = h;
  const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
  for (;;) {
    const half = sw / 2 >= tw && sh / 2 >= th;
    const c = document.createElement('canvas');
    c.width = half ? Math.ceil(sw / 2) : tw;
    c.height = half ? Math.ceil(sh / 2) : th;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    if (!half) return c;
    src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
  }
}

/** Deterministic 0..1 noise for the per-burst layout. */
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** Fireball colour by heat, 1 white-hot ... 0 cold smoke: [heat, [r, g, b]]. */
const HEAT = [[0, [30, 25, 22]], [0.16, [88, 40, 22]], [0.4, [212, 88, 28]], [0.68, [255, 176, 72]], [1, [255, 246, 216]]];
const heatRGB = (h) => {
  for (let i = 1; i < HEAT.length; i++) {
    if (h <= HEAT[i][0]) {
      const [h0, a] = HEAT[i - 1], [h1, c] = HEAT[i], f = (h - h0) / (h1 - h0);
      return a.map((v, j) => Math.round(v + (c[j] - v) * f));
    }
  }
  return HEAT[HEAT.length - 1][1];
};

/**
 * One burst's seeded shape, in burst radii R: a ragged fireball of billows (offset, radius, how long each stays hot,
 * how fast it rises; the inner ones burn longest), a fan of earth and sparks thrown up and out (tilted a little
 * differently each time), and an overall size, so no two bursts match.
 */
function burstShape(seed) {
  const r = (i) => hash(seed + i * 7.31);
  const n = 7 + Math.floor(r(1) * 4), tilt = (r(2) - 0.5) * 0.6;
  const blobs = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI * (0.04 + 0.92 * r(10 + i)), d = 0.3 + 0.7 * r(20 + i);
    return { x: Math.cos(a) * d * 1.15, y: Math.sin(a) * d * 0.85 - 0.1, r: 0.26 + 0.3 * r(30 + i), e: 0.6 + 0.8 * r(35 + i),
      cool: (0.28 + 0.4 * r(40 + i)) * (1.15 - 0.5 * d), rise: 0.3 + 0.7 * r(50 + i) };
  });
  blobs.push({ x: 0.05 * (r(5) - 0.5), y: -0.3, r: 0.5, e: 1, cool: 0.8, rise: 0.35 }); // the white-hot heart
  const spray = Array.from({ length: 18 + Math.floor(r(3) * 10) }, (_, i) => {
    const a = -Math.PI / 2 + tilt + (r(60 + i) - 0.5) * 2.0, v = 2.0 + 4.0 * r(70 + i);
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 0.5 + 1.1 * r(80 + i), hot: r(90 + i) < 0.25 };
  });
  return { size: 0.85 + 0.4 * r(4), blobs, spray };
}

/**
 * The sky plate as the splash shows it (cover-fit over the layer's box, like the plate's own <img>), above the
 * horizon, at quarter size, grey, brightened x4.6 and tinted orange-white: the cloud base lit by a burst, which _flash shows
 * through a mask.
 * Built once per pass; null until the plate has decoded.
 * @returns {null | {c: HTMLCanvasElement, k: number}}
 */
function litSky(lay) {
  const img = document.querySelector('.bt-l.sky');
  if (!img?.complete || !img.naturalWidth) return null;
  const k = 0.25, c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(lay.w * k)); c.height = Math.max(2, Math.round(lay.horizon * k));
  const g = c.getContext('2d');
  const sc = Math.max(lay.w / img.naturalWidth, lay.h / img.naturalHeight) * k;
  const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
  // grey (a white flash lights the clouds, whatever colour the dusk gave them) and blurred (the plate's own soft
  // steps must not light up as edges); browsers without canvas filters keep the colour, which still reads
  g.filter = 'blur(5px) grayscale(1)';
  g.drawImage(img, (lay.w * k - dw) / 2, (lay.h * k - dh) / 2, dw, dh);
  g.filter = 'none';
  const base = document.createElement('canvas');           // x3: the plate added onto itself twice
  base.width = c.width; base.height = c.height;
  base.getContext('2d').drawImage(c, 0, 0);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) g.drawImage(base, 0, 0);
  g.globalAlpha = 0.6;
  g.drawImage(base, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#ffd6a8';
  g.fillRect(0, 0, c.width, c.height);
  return { c, k };
}

export class SplashPlanes {
  /** @param {HTMLCanvasElement} canvas @param {{still?: boolean}} o */
  constructor(canvas, o = {}) {
    this.canvas = canvas;
    this.o = o;
    this.alive = false;
    this._bombs = [];
    this._booms = [];
    this._pass = null;
    this._timer = 0;
    this._loadT = 0;
    this._raf = 0;
    this._atlas = null;   // the decoded sprite atlas (null: fly the drawn silhouette)
    this._sprites = null; // this pass's scaled cells, by pose and load state
    this._lit = null;     // this pass's lit sky plate (the bursts' flash on the cloud base)
    this._scratch = null; // the flash mask's offscreen canvas
    try {
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) return;
      this._fighter = spitfireSprite();
      this._bomb = bombSprite();
      this.alive = true;
    } catch (err) {
      console.warn('[splash-planes]', err);
    }
  }

  start() {
    if (!this.alive || this.o.still) return;
    this._timer = setTimeout(() => this.pass(), FIRST_DELAY);
    this._loadT = setTimeout(() => this._load(), ATLAS_DELAY);
  }

  /** True once the rendered Spitfires are decoded (passes before that fly the drawn silhouette). */
  get ready() {
    return !!this._atlas;
  }

  /** Fetch + decode the sprite atlas at low priority (never ahead of the plate and the hero). */
  _load() {
    if (!this.alive || this._img) return;
    const img = new Image();
    this._img = img;
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = SPITFIRE_ATLAS.url;
    const done = () => { if (this.alive && this._img === img) this._atlas = img; };
    if (img.decode) img.decode().then(done, () => {});
    else img.onload = done;
  }

  /**
   * The atlas cells scaled for this pass's corridor (layout px): {pose: {loaded, half, clean, hp}, bomb}, a cell being
   * {c, w, h, ax, ay}; hp the near / far wing hardpoints relative to the anchor; bomb the falling 250 lb bomb.
   */
  _scaleSprites(lay) {
    const A = SPITFIRE_ATLAS, k = (PLANE_LEN * lay.s) / (A.len * A.pxm), out = {};
    const cell = (r) => ({ c: scaleCell(this._atlas, r, k * lay.dpr), w: r[2] * k, h: r[3] * k, ax: r[4] * k, ay: r[5] * k });
    for (const [pose, cells] of Object.entries(A.cells)) {
      out[pose] = { hp: cells.hp.map(([x, y]) => [x * k, y * k]) };
      for (const state of ['loaded', 'half', 'clean']) out[pose][state] = cell(cells[state]);
    }
    out.bomb = cell(A.bomb);
    return out;
  }

  /** Where slot i's wing bombs hang right now: [[x, y], [x, y]] (near, far) in layout px. */
  _hardpoints(i, leadX) {
    const lay = this._lay, [dx, dy, sf] = FORMATION[i], spr = this._sprites;
    const x = leadX + dx * lay.s, y = lay.cy + dy * lay.s + this._bob(i) + ANCHOR_DY * lay.s;
    if (!spr) return [[x, y], [x, y]];
    return spr[POSE[i]].hp.map(([hx, hy]) => [x + hx * sf, y + hy * sf]);
  }

  /** The gentle formation-keeping bob of slot i (layout px). */
  _bob(i) {
    return Math.sin(this._pass.t * 0.9 + i * 1.7) * 1.6;
  }

  /** Begin a pass now (also the capture/test hook: hud.boot.planes.pass()). */
  pass() {
    if (!this.alive || this.o.still || this._pass) return;
    clearTimeout(this._timer);
    const lay = this._layout();
    if (!lay) { this._schedule(); return; }
    this._lay = lay;
    this._sprites = null;
    if (this._atlas) {
      try { this._sprites = this._scaleSprites(lay); } catch (err) { console.warn('[splash-planes]', err); }
    }
    this._lit = null;
    if (lay.drops) {
      try { this._lit = litSky(lay); } catch (err) { console.warn('[splash-planes]', err); }
    }
    this._pass = { t: 0, sticks: new Map() };
    this._bombs = [];
    this._booms = [];
    let last = performance.now(), acc = 1;
    const tick = (now) => {
      if (!this.alive) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 1 / 30) { this._step(acc); acc = 0; }
      if (this._pass) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  dispose() {
    this.alive = false;
    clearTimeout(this._timer);
    clearTimeout(this._loadT);
    cancelAnimationFrame(this._raf);
    this._pass = null;
    this._img = this._atlas = this._sprites = this._lit = this._scratch = null;
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.pass(), GAP_MIN + Math.random() * GAP_VAR);
  }

  /**
   * Measure the stage off the live layout: the canvas' own box, the flight corridor (below .bt-top, above the
   * hero's face box), the horizon line and — when the screen is wide enough to hold it — the bomb line.
   * @returns {null | {w:number, h:number, dpr:number, cy:number, s:number, horizon:number, v:number, drops:null | {x:number, releaseX:number}[]}}
   */
  _layout() {
    const c = this.canvas, cw = c.clientWidth, ch = c.clientHeight;
    if (cw < 50 || ch < 50) return null;
    const cr = c.getBoundingClientRect();
    const top = document.querySelector('.bt-top')?.getBoundingClientRect();
    const hero = document.querySelector('.bt-l.hero');
    if (!top || !hero || !hero.naturalWidth) return null;
    const b = hero.getBoundingClientRect();
    const s = Math.min(b.width / hero.naturalWidth, b.height / hero.naturalHeight); // object-fit: contain
    const iw = hero.naturalWidth * s, ih = hero.naturalHeight * s;
    const ix = b.x + (b.width - iw) / 2, iy = b.y + (b.height - ih);                 // object-position: 50% 100%
    const corridorTopRaw = top.bottom - cr.top;
    const faceTopRaw = iy + HERO_FACE.y0 * ih - cr.top;
    let corridorTop = corridorTopRaw + 8;
    let faceTop = faceTopRaw - 8;
    let corridorH = faceTop - corridorTop;
    if (corridorH < 24) {                                  // very short stage: retry with tight clearances
      corridorTop = corridorTopRaw + 3;                    // rather than no pass at all — the lane still
      faceTop = faceTopRaw - 3;                            // clears the wordmark and the face box, just
      corridorH = faceTop - corridorTop;                   // with less air around the formation
      if (corridorH < 16) return null;                     // genuinely no lane on this screen: sit it out
    }
    const size = Math.min(0.052 * ch, (corridorH - 6) / 1.36);
    const horizon = HORIZON * ch;
    // bomb line: only with open field left of the figure (proxied by the face box's left edge — the body's
    // parts stay within it at the horizon line) — never under the hero. Judged on the actual geometry:
    // the stick's right edge plus the burst's reach must clear that edge (the gap at ordinary landscape
    // sizes is then 60+ px, far beyond the hero rect's idle-animation drift, so the verdict is stable)
    let drops = null;
    const faceLeftVp = ix + HERO_FACE.x0 * iw;             // viewport px
    const stickRightVp = IMPACTS[IMPACTS.length - 1] * innerWidth + 0.006 * cw; // rightmost burst centre + jitter
    if (faceLeftVp - stickRightVp > 1.5 * (size * BURST_R)) { // 1.5x the burst radius R = size * BURST_R (_burst)
      const v = (1.38 * cw) / PASS_TIME;
      // a bomb leaves at the plane's speed and slows (DRAG) through its FALL_TIME drop: it lands `travel` ahead of
      // where it let go, so a bomber releases that far short of its impact point (the impacts stay where they were)
      const travel = v * (1 - Math.exp(-DRAG * FALL_TIME)) / DRAG;
      drops = IMPACTS.map((f) => {
        const ixC = f * innerWidth - cr.left + (Math.random() - 0.5) * 0.012 * cw;
        return { x: ixC, releaseX: ixC - travel };
      });
    }
    return {
      w: cw, h: ch, dpr: Math.min(devicePixelRatio || 1, 2880 / cw),
      cy: corridorTop + corridorH / 2 + (Math.random() - 0.5) * corridorH * 0.2,
      s: size, horizon, v: (1.38 * cw) / PASS_TIME, drops,
    };
  }

  _step(dt) {
    const p = this._pass, lay = this._lay;
    p.t += dt;
    const leadX = -0.30 * lay.w + lay.v * p.t;
    // release: as each bomber's near wing bomb crosses its release line it drops the pair, near wing first and the
    // far one STICK_GAP later, each from its hardpoint on the sprite; the plane flies on 'half', then 'clean'
    if (lay.drops) {
      FORMATION.forEach((_, i) => {
        const slot = BOMBERS.indexOf(i);
        if (slot < 0) return;
        let st = p.sticks.get(i);
        if (!st) {
          if (this._hardpoints(i, leadX)[0][0] < lay.drops[slot].releaseX) return;
          st = { left: STICK, next: p.t };
          p.sticks.set(i, st);
        }
        while (st.left > 0 && p.t >= st.next) {
          const [x0, y0] = this._hardpoints(i, leadX)[STICK - st.left];
          st.left -= 1; st.next += STICK_GAP;
          // the fall is timed to FALL_TIME from wherever it starts; x follows the drag decay, y plain gravity
          this._bombs.push({ x0, y0, x: x0, y: y0, t: 0, g: 2 * (lay.horizon - y0) / (FALL_TIME * FALL_TIME) });
        }
      });
    }
    for (const b of this._bombs) {
      b.t += dt;
      const decay = Math.exp(-DRAG * b.t);
      b.x = b.x0 + lay.v * (1 - decay) / DRAG; b.y = b.y0 + 0.5 * b.g * b.t * b.t;
      b.a = Math.atan2(b.g * b.t, lay.v * decay); // finned: the nose follows the path, pitching down as it falls
      if (b.y >= lay.horizon) {
        this._booms.push({ x: b.x, t: 0, seed: Math.random() * 100, puffs: null, shape: null, peak: 0.85 + 0.3 * Math.random() });
        b.dead = true;
      }
    }
    this._bombs = this._bombs.filter((b) => !b.dead);
    for (const b of this._booms) b.t += dt;
    this._booms = this._booms.filter((b) => b.t < 6);
    this._draw(leadX);
    if (leadX - END_LAG * lay.s > lay.w && !this._bombs.length && !this._booms.length) {
      this._pass = null;
      this._lit = this._scratch = null;
      const { ctx, canvas: c } = this;
      ctx.clearRect(0, 0, c.width, c.height);
      this._schedule();
    }
  }

  _draw(leadX) {
    const { ctx, canvas: c } = this, lay = this._lay;
    const w = Math.max(2, Math.round(c.clientWidth * lay.dpr)), h = Math.max(2, Math.round(c.clientHeight * lay.dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.setTransform(w / lay.w, 0, 0, h / lay.h, 0, 0); // layout coords, stretched over the layer's current box
    ctx.clearRect(0, 0, lay.w, lay.h);
    for (const b of this._booms) this._flash(b);    // the bursts light the cloud base behind the formation
    const spr = this._fighter, sprites = this._sprites, sticks = this._pass.sticks;
    for (let i = FORMATION.length - 1; i >= 0; i--) {
      const [dx, dy, sf, haze] = FORMATION[i];
      const x = leadX + dx * lay.s, y = lay.cy + dy * lay.s + this._bob(i);
      ctx.globalAlpha = haze;
      if (sprites) { // rendered Spitfire: bombed-up, 'half' once the near wing bomb is away, then clean
        const st = sticks.get(i), gone = st ? STICK - st.left : 0;
        const cell = sprites[POSE[i]][!lay.drops || !BOMBERS.includes(i) ? 'clean' : ['loaded', 'half', 'clean'][gone]];
        ctx.drawImage(cell.c, x - cell.ax * sf, y + ANCHOR_DY * lay.s - cell.ay * sf, cell.w * sf, cell.h * sf);
        continue;
      }
      const dw = (spr.c.width / spr.ss) * (lay.s * sf) / spr.ref * SPRITE_SCALE, dh = (spr.c.height / spr.ss) * (lay.s * sf) / spr.ref * SPRITE_SCALE;
      ctx.drawImage(spr.c, x - dw * spr.ax, y - dh * spr.ay, dw, dh);
    }
    // the falling bombs, to the planes' scale (a 250 lb bomb is ~1/7 of a Spitfire), nose along the path
    const bc = sprites?.bomb, fb = this._bomb, len = BOMB_LEN * (PLANE_LEN * lay.s) / PLANE_M;
    ctx.globalAlpha = 1;
    for (const b of this._bombs) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a || 0);
      if (bc) ctx.drawImage(bc.c, -bc.ax, -bc.ay, bc.w, bc.h);
      else {
        const dw = (fb.c.width / fb.ss) * len / fb.ref, dh = (fb.c.height / fb.ss) * len / fb.ref;
        ctx.drawImage(fb.c, -dw / 2, -dh / 2, dw, dh);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    for (const b of this._booms) this._burst(b);
  }

  /**
   * A burst lights the cloud base above it: the sky plate itself, brightened and warmed (litSky), shows through an
   * ellipse over the impact — the clouds glow orange-white, the gaps stay dark — peaking in ~40 ms and gone in ~0.9 s,
   * plus the flash's own bloom low over the field. Each impact adds its own, so a stick ripples across the sky.
   */
  _flash(b) {
    const t = b.t;
    if (t > 1.2) return;
    const { ctx } = this, lay = this._lay, hz = lay.horizon, lit = this._lit;
    const env = (t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) / 0.27)) * b.peak * (t < 0.18 ? 0.85 + 0.15 * Math.sin(b.seed + t * 70) : 1);
    if (lit) {
      // the lit patch: an ellipse over the impact, centred on the cloud base a little above the horizon
      const ry = 0.32 * lay.h, rx = 1.3 * ry, cy = hz - 0.14 * lay.h, k = lit.k;
      const x0 = Math.max(0, b.x - rx), x1 = Math.min(lay.w, b.x + rx), y0 = Math.max(0, cy - ry);
      const sw = Math.floor((x1 - x0) * k), sh = Math.floor((hz - y0) * k);
      if (sw > 1 && sh > 1) {
        const g = this._scratchCtx(sw, sh);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, sw, sh);
        g.save();
        g.translate((b.x - x0) * k, (cy - y0) * k);
        g.scale(1.3, 1);
        const m = g.createRadialGradient(0, 0, 0, 0, 0, ry * k);
        m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.4, 'rgba(0,0,0,0.7)');
        m.addColorStop(0.75, 'rgba(0,0,0,0.25)'); m.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = m;
        g.fillRect(-ry * k, -ry * k, 2 * ry * k, (hz - cy + ry) * k);
        g.restore();
        g.globalCompositeOperation = 'source-in';               // keep the lit plate where the mask is
        g.drawImage(lit.c, x0 * k, y0 * k, sw, sh, 0, 0, sw, sh);
        ctx.globalAlpha = Math.min(1, env);
        ctx.drawImage(g.canvas, 0, 0, sw, sh, x0, y0, sw / k, sh / k);
        ctx.globalAlpha = 1;
      }
    }
    const gy = hz - 0.025 * lay.h, gr0 = 0.17 * lay.h; // the flash's own light in the low haze
    const gr = ctx.createRadialGradient(b.x, gy, 0, b.x, gy, gr0);
    gr.addColorStop(0, `rgba(255,236,206,${0.6 * env})`);
    gr.addColorStop(0.35, `rgba(255,170,90,${0.26 * env})`);
    gr.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(b.x - gr0, gy - gr0, 2 * gr0, 2 * gr0);
  }

  /** A reusable offscreen 2D context at least w x h (the sky flash's mask). */
  _scratchCtx(w, h) {
    const old = this._scratch;
    if (old && old.width >= w && old.height >= h) return old.getContext('2d');
    const c = this._scratch = document.createElement('canvas');
    c.width = Math.max(w, old?.width || 0); c.height = Math.max(h, old?.height || 0);
    return c.getContext('2d');
  }
  /**
   * One 250 lb burst on the far field, at the formation's scale (burstShape: no two alike): a sharp white flash that
   * also races along the ground, a ragged fireball of billows (white-hot heart, orange body, red-brown rim) that
   * swell, rise and cool into black smoke, a fountain of earth and a fan of clods and sparks thrown up and out, a
   * ground glow, then the smoke that lingers (~6 s).
   */
  _burst(b) {
    const { ctx } = this, lay = this._lay, y = lay.horizon, t = b.t;
    const S = b.shape ||= burstShape(b.seed), R = lay.s * BURST_R * S.size;
    if (t < 1.6) { // ground glow while it burns
      const a = 0.45 * (1 - t / 1.6);
      ctx.save(); ctx.translate(b.x, y + 2); ctx.scale(1, 0.3);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 3.2);
      gr.addColorStop(0, `rgba(255,160,70,${a})`); gr.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = gr; ctx.fillRect(-R * 3.2, -R * 3.2, R * 6.4, R * 6.4);
      ctx.restore();
    }
    if (t > 0.03 && t < 1.3) { // the fountain of earth: a dark column punched up, falling back
      const q = (t - 0.03) / 1.27, hgt = R * 2.4 * Math.sin(Math.min(1, q * 2.4) * Math.PI / 2) * (1 - 0.35 * q * q);
      const wid = R * (0.26 + 0.34 * q);
      ctx.save(); ctx.translate(b.x, y - hgt / 2); ctx.scale(wid / hgt, 1);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, hgt / 2);
      gr.addColorStop(0, `rgba(36,26,20,${0.8 * (1 - q)})`); gr.addColorStop(0.7, `rgba(36,26,20,${0.5 * (1 - q)})`);
      gr.addColorStop(1, 'rgba(36,26,20,0)');
      ctx.fillStyle = gr; ctx.fillRect(-hgt / 2, -hgt / 2, hgt, hgt);
      ctx.restore();
    }
    if (t < 2.2) { // the fireball: billows swell fast, rise and cool white -> orange -> red-brown -> black smoke
      const grow = 1 - Math.exp(-t / 0.07);
      for (const pass of [0, 1]) {   // 0: the darker, cooler skin of each billow; 1: its hot heart on top
        for (const k of S.blobs) {  // each billow flies out at its own pace, so the outline stays ragged
          const g = Math.min(1, grow * k.e) * (1 + 0.5 * t), heat = Math.max(0, 1 - t / k.cool);
          const cx = b.x + k.x * R * g, cy = y - R * 0.1 + (k.y * g - k.rise * t) * R;
          const r = k.r * R * Math.min(1, grow * (0.6 + 0.4 * k.e)) * (1 + 0.6 * t);
          if (pass === 1 && heat <= 0.05) continue;
          const c = heatRGB(pass ? heat : heat * 0.45), a = pass ? Math.min(1, 0.4 + heat) : 0.85 * Math.max(0, 1 - t / 2.2);
          if (a <= 0.01) continue;
          const rr = pass ? r * (0.5 + 0.38 * heat) : r * 1.12;
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
          gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
          gr.addColorStop(0.62, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.8})`);
          gr.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
          ctx.fillStyle = gr; ctx.fillRect(cx - rr, cy - rr, 2 * rr, 2 * rr);
        }
      }
    }
    if (t < 1.4) { // the fan of earth: clods as short streaks along their flight, a few glowing sparks
      for (const d of S.spray) {
        const px = b.x + d.vx * R * t, py = y - R * 0.15 + (d.vy * t + 4.6 * t * t) * R;
        // clods show once clear of the fireball (thrown out of it), sparks at once
        if (py > y + 1 || (d.hot && t > 0.55) || (!d.hot && t < 0.09)) continue;
        const vx = d.vx, vy = d.vy + 9.2 * t, sp = Math.hypot(vx, vy) || 1, ln = Math.min(3.2, 0.05 * sp * R) + d.w;
        ctx.strokeStyle = d.hot ? `rgba(255,${Math.round(220 - 150 * t)},${Math.round(120 - 90 * t)},${1 - t / 0.55})`
          : `rgba(28,20,15,${Math.min(0.95, 1.6 - t)})`;
        ctx.lineWidth = Math.max(1, d.w * lay.s / 40);
        ctx.beginPath(); ctx.moveTo(px - vx / sp * ln, py - vy / sp * ln); ctx.lineTo(px, py); ctx.stroke();
      }
    }
    if (t < 0.11) { // the flash: a white-hot ball and a sheet of light along the ground, added on top
      const q = t / 0.11, r = R * (0.8 + 1.2 * q), cy = y - R * 0.2;
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(b.x, cy, 0, b.x, cy, r);
      gr.addColorStop(0, `rgba(255,255,250,${1 - q})`); gr.addColorStop(0.25, `rgba(255,240,180,${0.9 * (1 - q)})`);
      gr.addColorStop(0.6, `rgba(255,170,70,${0.4 * (1 - q)})`); gr.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = gr; ctx.fillRect(b.x - r, cy - r, 2 * r, 2 * r);
      ctx.save(); ctx.translate(b.x, y); ctx.scale(1, 0.12);
      const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 4.5);
      gl.addColorStop(0, `rgba(255,230,190,${0.75 * (1 - q)})`); gl.addColorStop(1, 'rgba(255,180,100,0)');
      ctx.fillStyle = gl; ctx.fillRect(-R * 4.5, -R * 4.5, R * 9, R * 9);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
    // smoke: puffs spawned through the first second, rising and drifting with the wind, gone by ~6 s
    if (!b.puffs) {
      b.puffs = Array.from({ length: 5 }, (_, i) => ({
        dx: (Math.sin(b.seed * (i + 3)) * 0.5) * R * 0.5, delay: i * 0.16,
        rise: R * (1.1 + 0.35 * Math.cos(b.seed * (i + 1))), drift: R * (0.35 + 0.1 * i),
        r0: R * 0.32, r1: R * (0.95 + 0.16 * i),
      }));
    }
    for (const pf of b.puffs) {
      const pt = b.t - pf.delay;
      if (pt < 0 || pt > 5) continue;
      const life = pt / 5, ease = 1 - Math.pow(1 - life, 2);
      const px = b.x + pf.dx + pf.drift * ease, py = y - R * 0.25 - pf.rise * ease;
      const r = pf.r0 + (pf.r1 - pf.r0) * ease;
      const a = 0.42 * Math.sin(Math.min(1, life * 1.15) * Math.PI);
      const warm = Math.max(0, 1 - pt / 1.1);  // black smoke off the fireball, greying into dust
      const gr = ctx.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, `rgba(${Math.round(52 + 34 * warm + 26 * life)},${Math.round(42 + 12 * warm + 22 * life)},${Math.round(36 + 20 * life)},${a})`);
      gr.addColorStop(1, 'rgba(60,52,46,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
