/**
 * S03 title splash: a distant bomber formation that now and then crosses the sky behind the hero and, mid-pass,
 * puts a small stick of bombs on the far field — a flash, a fireball bloom and a smoke plume that lingers on the
 * horizon, in the burning tank's dusk palette. Canvas 2D on its own `.bt-l` layer, between the painted sky plate
 * and the light pass, so the hero always occludes it. Silhouettes are prerendered sprites (a bomber profile drawn
 * in code, warm under-rim from the fires below); per frame it is a handful of drawImage calls, and between passes
 * there is no per-frame cost at all — one timer schedules the next pass and the rAF loop runs only while a pass
 * or its smoke is alive. The corridor is measured off the live layout at every pass: below the wordmark block
 * (.bt-top) and above the hero's face box (HERO_FACE), so the formation never crosses either; the bomb line keeps
 * to the open field left of the hero and is skipped outright on screens too narrow to hold it. Under reduced
 * motion there are no passes, like the embers.
 * @module ui/splash-planes
 */

import { HERO_FACE } from './hero-art.js';

/** Formation slots behind the leader: [lengths back, lengths off the centreline, relative size, haze alpha]. */
const FORMATION = [
  [0.00, 0.00, 1.00, 0.90],
  [-0.95, -0.13, 0.97, 0.86],
  [-0.95, 0.13, 0.97, 0.86],
  [-1.90, -0.26, 0.94, 0.82],
  [-1.90, 0.26, 0.94, 0.82],
  [-2.85, -0.38, 0.91, 0.78],
  [-2.85, 0.38, 0.91, 0.78],
];
/** Formation slots that carry a bomb (the leader and the two inner pairs — a five-bomb stick). */
const BOMBERS = [0, 1, 2, 3, 4];
/** Impact points of the stick, as fractions of the viewport width (the open field left of the hero). */
const IMPACTS = [0.13, 0.18, 0.23, 0.28, 0.325];
const FIRST_DELAY = 5000;               // ms after the splash is up before the first pass
const GAP_MIN = 55000, GAP_VAR = 55000; // idle gap between passes: 55–110 s
const PASS_TIME = 17;                   // s for the leader to cross the stage
const FALL_TIME = 1.9;                  // s a bomb falls from the corridor to the horizon
const HORIZON = 0.79;                   // horizon line of the sky plate, as a fraction of the layer height

/** Bomber silhouette (side profile, nose right) in a 240-unit box; origin at the fuselage centre. */
function bomberSprite() {
  const U = 240, SS = 2; // supersample
  const c = document.createElement('canvas');
  c.width = (U + 24) * SS; c.height = (0.62 * U + 24) * SS;
  const g = c.getContext('2d');
  g.scale(SS, SS);
  g.translate(12 + U / 2, 12 + 0.31 * U);
  const body = new Path2D();
  body.moveTo(120, 2);
  body.bezierCurveTo(120, -13, 100, -20, 79, -23);          // nose top
  body.bezierCurveTo(62, -28, 48, -28, 36, -24);            // cockpit hump
  body.lineTo(-67, -18);                                    // dorsal line
  body.bezierCurveTo(-86, -16, -96, -24, -100, -48);        // fin leading edge
  body.bezierCurveTo(-102, -63, -106, -65, -109, -62);      // fin top
  body.lineTo(-114, -7);                                    // rudder trailing edge
  body.bezierCurveTo(-115, 7, -110, 13, -96, 14);           // tail underside
  body.lineTo(67, 20);                                      // belly
  body.bezierCurveTo(101, 21, 120, 14, 120, 2);             // nose underside
  body.closePath();
  const wing = new Path2D();                                // near wing, edge-on wedge under the fuselage
  wing.moveTo(41, 7); wing.lineTo(5, 48); wing.lineTo(-14, 48); wing.lineTo(12, 5); wing.closePath();
  const tail = new Path2D();                                // tailplane wedge
  tail.moveTo(-120, 11); tail.lineTo(-79, 11); tail.lineTo(-86, 24); tail.lineTo(-116, 20); tail.closePath();
  const grad = g.createLinearGradient(0, -65, 0, 48);
  grad.addColorStop(0, '#252d36'); grad.addColorStop(0.55, '#0b0e13'); grad.addColorStop(1, '#05070a');
  g.fillStyle = grad;
  g.fill(body); g.fill(wing); g.fill(tail);
  const rim = g.createLinearGradient(0, -4, 0, 48);         // warm under-rim from the fires below
  rim.addColorStop(0, 'rgba(255,138,64,0)');
  rim.addColorStop(1, 'rgba(255,138,64,0.34)');
  const sheen = g.createLinearGradient(0, -65, 0, -24);     // faint cool sheen on the back and fin
  sheen.addColorStop(0, 'rgba(170,190,210,0.13)');
  sheen.addColorStop(1, 'rgba(170,190,210,0)');
  for (const part of [body, wing]) {                        // clip per part (a second clip() would intersect)
    g.save(); g.clip(part);
    g.fillStyle = rim; g.fillRect(-120, -4, 240, 52);
    g.fillStyle = sheen; g.fillRect(-120, -65, 240, 41);
    g.restore();
  }
  g.strokeStyle = 'rgba(255,150,80,0.30)';                  // lit lower edges only (clip to the belly half)
  g.lineWidth = 2.2;
  g.save(); g.beginPath(); g.rect(-122, 2, 244, 50); g.clip();
  g.stroke(body); g.stroke(wing); g.restore();
  g.fillStyle = 'rgba(200,212,224,0.10)';                   // prop blur: two faint discs on the wing line
  for (const [px, py, r] of [[37, 5, 38], [17, 12, 34]]) {
    g.beginPath(); g.ellipse(px, py, 3.2, r, 0, 0, Math.PI * 2); g.fill();
  }
  // anchor: fuselage centre sits at (12 + U/2, 12 + 0.31U) of (U + 24) x (0.62U + 24), in unscaled units
  return { c, ss: SS, ax: (12 + U / 2) / (U + 24), ay: (12 + 0.31 * U) / (0.62 * U + 24), ref: U };
}

/** Falling bomb (body + box fins), drawn pointing +x (direction of travel), 48-unit box. */
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
  g.fillStyle = '#0a0c10';
  g.fill(body);
  g.fillRect(-21, -6.5, 5, 13);                             // box fin (vertical)
  g.fillRect(-21, -1.8, 5, 3.6);                            // box fin (horizontal)
  g.strokeStyle = 'rgba(255,150,80,0.35)';
  g.lineWidth = 1;
  g.save(); g.beginPath(); g.rect(-22, 0, 44, 7); g.clip(); g.stroke(body); g.restore();
  return { c, ss: SS, ref: 41 }; // ref: the body length in drawing units (x -21..20)
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
    this._raf = 0;
    try {
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) return;
      this._bomber = bomberSprite();
      this._bomb = bombSprite();
      this.alive = true;
    } catch (err) {
      console.warn('[splash-planes]', err);
    }
  }

  start() {
    if (!this.alive || this.o.still) return;
    this._timer = setTimeout(() => this.pass(), FIRST_DELAY);
  }

  /** Begin a pass now (also the capture/test hook: hud.boot.planes.pass()). */
  pass() {
    if (!this.alive || this.o.still || this._pass) return;
    clearTimeout(this._timer);
    const lay = this._layout();
    if (!lay) { this._schedule(); return; }
    this._lay = lay;
    this._pass = { t: 0, dropped: new Set() };
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
    cancelAnimationFrame(this._raf);
    this._pass = null;
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.pass(), GAP_MIN + Math.random() * GAP_VAR);
  }

  /**
   * Measure the stage off the live layout: the canvas' own box, the flight corridor (below .bt-top, above the
   * hero's face box), the horizon line and — when the screen is wide enough to hold it — the bomb line.
   * @returns {null | {w:number, h:number, dpr:number, cy:number, s:number, horizon:number, v:number, drops:null | {x:number, g:number}[]}}
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
    const corridorTop = top.bottom - cr.top + 8;
    const faceTop = iy + HERO_FACE.y0 * ih - cr.top - 8;
    const corridorH = faceTop - corridorTop;
    if (corridorH < 24) return null;                       // no clean lane on this screen: sit this pass out
    const size = Math.min(0.052 * ch, (corridorH - 6) / 1.36);
    const horizon = HORIZON * ch;
    // bomb line: only with open field left of the figure (proxied by the face box's left edge — the body's
    // parts stay within it at the horizon line) — never under the hero, and skipped on narrow screens
    let drops = null;
    const faceLeftVp = ix + HERO_FACE.x0 * iw;             // viewport px
    if (faceLeftVp > 0.42 * innerWidth) {
      const v = (1.38 * cw) / PASS_TIME;
      const g = 2 * (horizon - (corridorTop + corridorH / 2)) / (FALL_TIME * FALL_TIME);
      drops = IMPACTS.map((f) => {
        const ixC = f * innerWidth - cr.left + (Math.random() - 0.5) * 0.012 * cw;
        return { x: ixC, releaseX: ixC - v * FALL_TIME, g };
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
    // release: each bomber drops as it crosses its release line, so the stick walks along the field
    if (lay.drops) {
      FORMATION.forEach(([dx], i) => {
        const slot = BOMBERS.indexOf(i);
        if (slot < 0 || p.dropped.has(i)) return;
        const x = leadX + dx * lay.s;
        if (x >= lay.drops[slot].releaseX) {
          p.dropped.add(i);
          this._bombs.push({ x, y: lay.cy + FORMATION[i][1] * lay.s + lay.s * 0.12, vx: lay.v, vy: 0, t: 0, g: lay.drops[slot].g });
        }
      });
    }
    for (const b of this._bombs) {
      b.t += dt; b.vy += b.g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y >= lay.horizon) {
        this._booms.push({ x: b.x, t: 0, seed: Math.random() * 100, puffs: null });
        b.dead = true;
      }
    }
    this._bombs = this._bombs.filter((b) => !b.dead);
    for (const b of this._booms) b.t += dt;
    this._booms = this._booms.filter((b) => b.t < 6);
    this._draw(leadX);
    if (leadX - 3.4 * lay.s > lay.w && !this._bombs.length && !this._booms.length) {
      this._pass = null;
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
    const spr = this._bomber, t = this._pass.t;
    for (let i = FORMATION.length - 1; i >= 0; i--) {
      const [dx, dy, sf, haze] = FORMATION[i];
      const x = leadX + dx * lay.s, y = lay.cy + dy * lay.s + Math.sin(t * 0.9 + i * 1.7) * 1.6;
      const dw = (spr.c.width / spr.ss) * (lay.s * sf) / spr.ref, dh = (spr.c.height / spr.ss) * (lay.s * sf) / spr.ref;
      ctx.globalAlpha = haze;
      ctx.drawImage(spr.c, x - dw * spr.ax, y - dh * spr.ay, dw, dh);
    }
    ctx.globalAlpha = 1;
    const bs = this._bomb, bl = 15 * (lay.s / 54); // bomb body length in css px, scaled with the formation
    for (const b of this._bombs) {
      const dw = (bs.c.width / bs.ss) * bl / bs.ref, dh = (bs.c.height / bs.ss) * bl / bs.ref;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.drawImage(bs.c, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    for (const b of this._booms) this._boom(b);
  }

  /** One distant explosion: flash, fireball bloom, then a smoke plume that rises, drifts and fades (~6 s). */
  _boom(b) {
    const { ctx } = this, lay = this._lay, y = lay.horizon, R = lay.s * 0.62;
    const flick = 0.85 + 0.3 * Math.sin(b.seed + b.t * 41) * Math.sin(b.seed * 2.7 + b.t * 29);
    if (b.t < 1.2) { // ground glow while it burns
      const a = 0.22 * (1 - b.t / 1.2);
      ctx.save(); ctx.translate(b.x, y + 2); ctx.scale(1, 0.32);
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.4);
      gr.addColorStop(0, `rgba(255,140,50,${a})`); gr.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(0, 0, R * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (b.t < 0.14) { // the flash
      const r = R * (0.5 + b.t / 0.14) * flick;
      const gr = ctx.createRadialGradient(b.x, y - r * 0.3, 0, b.x, y - r * 0.3, r);
      gr.addColorStop(0, `rgba(255,240,205,${0.95 * (1 - b.t / 0.14)})`);
      gr.addColorStop(0.5, `rgba(255,170,80,${0.55 * (1 - b.t / 0.14)})`);
      gr.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(b.x, y - r * 0.3, r, 0, Math.PI * 2); ctx.fill();
    }
    if (b.t < 0.85) { // fireball bloom: three overlapping lobes in the tank-fire palette
      const k = b.t / 0.85, r = R * (0.35 + 0.75 * Math.sin(Math.min(1, k * 1.15) * Math.PI * 0.5)) * flick;
      const a = 0.88 * (1 - k * k);
      const lobes = [[0, -0.30, 0.78], [-0.42, -0.12, 0.55], [0.44, -0.10, 0.58]];
      for (const [ox, oy, orr] of lobes) {
        const gr = ctx.createRadialGradient(b.x + ox * r, y + oy * r, 0, b.x + ox * r, y + oy * r, r * orr);
        gr.addColorStop(0, `rgba(255,214,150,${a})`);
        gr.addColorStop(0.45, `rgba(242,110,38,${a * 0.85})`);
        gr.addColorStop(1, 'rgba(120,32,6,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(b.x + ox * r, y + oy * r, r * orr, 0, Math.PI * 2); ctx.fill();
      }
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
      const a = 0.34 * Math.sin(Math.min(1, life * 1.15) * Math.PI);
      const warm = Math.max(0, 1 - pt / 1.1);
      const gr = ctx.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, `rgba(${86 + 36 * warm},${64 + 16 * warm},${50},${a})`);
      gr.addColorStop(1, 'rgba(70,56,46,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
