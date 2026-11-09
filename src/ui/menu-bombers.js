/**
 * Main-menu flyover (user: "Option 1"; then "Main menu stills needs work, more realistic please airplanes dont look
 * good there", 2026-11-08). Now and then a section of four Spitfires crosses the sky band of the front end's theatre
 * still at the size the scene gives them (menu-model.js STILL_SCENES), seen from the side and a little below in the
 * still's daylight: the title splash's Blender Spitfire, relit (assets/ui/keyart/spitfires-day.webp: three poses,
 * each loaded / half / clean) and graded like the still. Three of them let their pairs go from the wing racks over
 * one of the still's far-ground patches, near wing first. The bombs leave at the plane's speed; drag slows them and
 * gravity takes them down nose first into bursts drawn to the same scale: a flash that lights the haze, a ragged
 * fireball, a fountain of earth, then dust and smoke that rise and drift. Each is heard 1-2.3 s later as a muffled
 * distant boom (`explosion_far`, low-passed and quiet, through game.audio so the volume settings and mute apply;
 * never before the audio is unlocked).
 * Canvas 2D inside the backdrop's scene (it drifts with the still, under the dark pool, the emblem and the menu); the
 * bursts keep clear of the card's text. In the front end the scene director (menu-director.js) calls each pass
 * (`directed`), toward the end of a ground fight; on its own it passes every 55-110 s. Between passes it costs a
 * 1x1 canvas; the rAF loop runs only
 * during a pass and its smoke. No passes under reduced motion or MENU BACKGROUND: STILL, in test / debug / walkthrough
 * / ?mission sessions, or unless the front end shows its still; a mission load, leaving the front end, a new card or
 * a hidden tab ends a pass at once, its pending booms included.
 * @module ui/menu-bombers
 */

import { SPITFIRE_DAY } from './spitfire-day.js';
import { STILL_SCENES } from './menu-model.js';

const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** Fireball colour by heat, 1 white-hot ... 0 cold smoke (the title splash's ramp). */
const HEAT = [[0, [42, 36, 31]], [0.16, [96, 50, 30]], [0.4, [212, 96, 36]], [0.68, [255, 182, 84]], [1, [255, 246, 218]]];
const heatRGB = (h) => {
  for (let i = 1; i < HEAT.length; i++) {
    if (h <= HEAT[i][0]) {
      const [h0, a] = HEAT[i - 1], [h1, c] = HEAT[i], f = (h - h0) / (h1 - h0);
      return a.map((v, j) => Math.round(v + (c[j] - v) * f));
    }
  }
  return HEAT[HEAT.length - 1][1];
};

/** The section behind its leader: [lengths back, lengths down, depth scale (further = smaller)]; and their poses. */
const FORMATION = [[0, 0, 1], [-1.6, 0.1, 0.93], [-3.3, -0.07, 1.04], [-4.9, 0.05, 0.96]];
const POSE = ['a', 'b', 'c', 'a'];
const BOMBERS = 3;                      // slots 0-2 carry a 250 lb bomb under each wing; slot 3 flies top cover, clean
const SPEED = 62;                       // m/s across the scene (a low-level run, eased a little for the eye)
const G = 9.81;                         // m/s²
const DRAG = 0.45;                      // 1/s: a bomb leaves at the plane's speed and loses it
const STICK_GAP = 0.18;                 // s between a bomber's near and far wing bombs
const BURST_M = 5;                      // m: a 250 lb burst's fireball radius
const SMOKE_LIFE = 8;                   // s a burst's dust and smoke linger
const FIRST_DELAY = 12000;              // ms after the front end comes up before the first pass
const GAP_MIN = 55000, GAP_VAR = 55000; // between passes: 55-110 s, as on the title splash
const BOOM_DELAY = [1.0, 2.3];          // s from flash to boom (the sound crosses the far field)
const CLEAR = 0.035;                    // the bursts' clearance around the card's text, fraction of the width

/**
 * One burst's seeded shape, in fireball radii R: the fireball's billows (white-hot to red-brown in ~0.4 s), the
 * column of earth, smoke and dust thrown up (puffs that climb fast, then slow, spread and drift downwind), the dust
 * skirt racing out along the ground, the clods and a few sparks, and an overall size — no two alike.
 */
function burstShape(seed) {
  const r = (i) => hash(seed + i * 7.31);
  const blobs = Array.from({ length: 5 + Math.floor(r(1) * 3) }, (_, i) => {
    const a = -Math.PI * (0.1 + 0.8 * r(10 + i)), d = 0.25 + 0.6 * r(20 + i);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8 - 0.15, r: 0.32 + 0.28 * r(30 + i), cool: 0.2 + 0.22 * r(40 + i) };
  });
  const lean = (r(2) - 0.5) * 0.5;
  const column = Array.from({ length: 9 }, (_, i) => ({
    delay: 0.02 + 0.045 * i + 0.03 * r(100 + i), h: 0.9 + 0.55 * i + 0.4 * r(110 + i), x: (r(120 + i) - 0.5) * (0.5 + 0.12 * i) + lean * i * 0.25,
    s0: 0.55 + 0.25 * r(130 + i), s1: 0.9 + 0.17 * i + 0.4 * r(140 + i), thin: 1 - 0.05 * i, rot: (r(150 + i) - 0.5) * 0.6, spin: (r(160 + i) - 0.5) * 0.12,
    k: Math.floor(r(170 + i) * 2), soil: 0.45 + 0.5 * r(180 + i),
  }));
  const skirt = Array.from({ length: 6 }, (_, i) => ({
    side: i % 2 ? 1 : -1, reach: 1.4 + 2.6 * r(200 + i), s1: 1.0 + 0.7 * r(210 + i), k: Math.floor(r(220 + i) * 2), rot: (r(230 + i) - 0.5) * 0.5,
  }));
  const tilt = (r(3) - 0.5) * 0.6;
  const spray = Array.from({ length: 14 + Math.floor(r(4) * 8) }, (_, i) => {
    const a = -Math.PI / 2 + tilt + (r(60 + i) - 0.5) * 2.0, v = 2.0 + 4.0 * r(70 + i);
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 0.5 + 1.1 * r(80 + i), hot: r(90 + i) < 0.2 };
  });
  return { size: 0.85 + 0.35 * r(5), blobs, column, skirt, spray };
}

/** Smooth value noise in 0..1 (three octaves), for the puffs' torn edges. */
function fbm(x, y, seed) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 3; o++, amp *= 0.5, f *= 2.1) {
    const X = x * f + seed * 17.1 * (o + 1), Y = y * f - seed * 9.7, xi = Math.floor(X), yi = Math.floor(Y), u = X - xi, v = Y - yi;
    const n = (i, j) => hash(i * 157.1 + j * 311.7 + o * 71.3);
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    sum += amp * ((n(xi, yi) * (1 - su) + n(xi + 1, yi) * su) * (1 - sv) + (n(xi, yi + 1) * (1 - su) + n(xi + 1, yi + 1) * su) * sv);
  }
  return sum / 0.875;
}

/**
 * Puffs of smoke and dust as small sprites, made once per theatre: torn, lumpy edges (noise), lit from above (the
 * high sun: a pale cap, a shaded underside), in two shapes for soil-dark smoke and for the theatre's dust.
 * @returns {{dark: HTMLCanvasElement[], dust: HTMLCanvasElement[]}}
 */
export function puffSprites(dust) {
  const N = 64, make = (rgb, seed) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, n = fbm(u * 2.2 + 3, v * 2.2 + 3, seed);
        const a = Math.max(0, Math.min(1, (1 - Math.hypot(u, v * 1.06)) * 1.9 + (n - 0.5) * 1.5)) ** 1.4;
        const lit = 1.2 - 0.45 * (v + 1) / 2 + (n - 0.5) * 0.3, i = (y * N + x) * 4;
        d[i] = Math.min(255, rgb[0] * lit); d[i + 1] = Math.min(255, rgb[1] * lit); d[i + 2] = Math.min(255, rgb[2] * lit); d[i + 3] = a * 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  };
  return { dark: [make([74, 66, 58], 1.3), make([84, 75, 66], 2.9)], dust: [make(dust, 4.1), make(dust.map((v) => v * 0.88), 5.7)] };
}

export class MenuBombers {
  /**
   * @param {HTMLCanvasElement} canvas the layer inside the backdrop's scene (its box is the viewport's)
   * @param {{audio: () => object|null, still?: () => boolean, visible?: () => boolean, theater?: () => string|null,
   *   grade?: string, avoid?: () => {left:number, top:number, right:number, bottom:number}[], passed?: () => void,
   *   directed?: boolean}} o — passed(): once a pass is over — the section gone, every bomb burst and its boom heard
   *   (menu-dogfight.js follows); directed: no timer of its own (menu-director.js calls pass())
   */
  constructor(canvas, o) {
    this.canvas = canvas;
    this.o = o;
    this.ctx = canvas.getContext('2d');
    this.alive = !!this.ctx;
    const q = new URLSearchParams(location.search);
    this.blocked = q.get('test') === '1' || q.has('debug') || q.has('walkthrough') || q.has('mission');
    this.running = false;
    this._timer = 0;
    this._raf = 0;
    this._bombs = [];
    this._booms = [];
    this._sounds = [];
    this._img = null;
    this._ready = false;
    this._sprites = null;
    this._pass = null;
  }

  /** Arm the passes (the front end's still is up). Idempotent; under reduced motion / STILL it stands down. */
  start() {
    if (this.o.still?.()) { this.stop(); return; }
    if (!this.alive || this.blocked || this.running) return;
    this.running = true;
    this._load();
    if (!this.o.directed) this._schedule(FIRST_DELAY);   // directed: menu-director.js calls pass()
  }

  /** Stop everything at once: timers, the pass, smoke, pending booms; the layer cleared and its store freed. */
  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._end();
  }

  /** A new card: the pass in flight ends at once (its pending booms too); the next comes after the usual gap. */
  interrupt() {
    if (!this._pass) return;
    this._end();
    if (this.running) this._schedule();
  }

  dispose() {
    this.stop();
    this.alive = false;
  }

  _end() {
    cancelAnimationFrame(this._raf);
    for (const t of this._sounds) clearTimeout(t);
    this._sounds = [];
    this._pass = null;
    this._bombs = [];
    this._booms = [];
    this._sprites = null;
    this.canvas.width = this.canvas.height = 1; // clears it and frees the backing store between passes
  }

  _schedule(ms = GAP_MIN + Math.random() * GAP_VAR) {
    clearTimeout(this._timer);
    if (this.o.directed) return;
    this._timer = setTimeout(() => this.pass(), ms);
  }

  /** The daylight atlas, fetched at low priority and decoded off the main thread before the first pass. */
  _load() {
    if (this._img) return;
    const img = this._img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = SPITFIRE_DAY.url;
    const ok = () => { if (this._img === img) this._ready = true; };
    if (img.decode) img.decode().then(ok, () => {});
    else img.onload = ok;
  }

  /**
   * Begin a pass now (also the capture / test hook: hud.backdrop.bombers.pass(true)). The section enters off one edge
   * of the scene, crosses its sky band and leaves by the other; its bombers each target one point of a far-ground
   * patch whose bursts clear the card's text (none: it flies over clean).
   */
  pass(force = false) {
    if (!this.alive || this._pass || (!force && (!this.running || !this._ready || document.hidden || !this.o.visible?.()))) {
      if (this.running && !this._pass) this._schedule();
      return;
    }
    const lay = this._ready ? this._layout() : null;
    if (!lay) { if (this.running) this._schedule(); return; }
    this._lay = lay;
    try {
      this._sprites = this._scale(lay);
      const th = this.o.theater?.() || 'temperate';
      if (this._puffFor !== th) { this._puffSet = puffSprites(lay.dust); this._puffFor = th; }
    } catch (err) { console.warn('[menu-bombers]', err); this._schedule(); return; }
    this._pass = { t: 0, dropped: new Array(FORMATION.length).fill(0), next: new Array(FORMATION.length).fill(0) };
    this._bombs = [];
    this._booms = [];
    let last = performance.now(), acc = 1 / 30; // the first frame draws at once, a frame's time in
    const tick = (now) => {
      if (!this._pass) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 1 / 30) { this._step(acc); acc = 0; }
      if (this._pass) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  /** This pass's geometry, in the canvas' CSS px (its box is the viewport; the still covers it, anchored at the top). */
  _layout() {
    const c = this.canvas, w = c.clientWidth, h = c.clientHeight;
    if (w < 200 || h < 150) return null;
    const S = STILL_SCENES[this.o.theater?.()] || STILL_SCENES.temperate;
    const k = Math.max(w / 1920, h / 1080), ox = (w - 1920 * k) / 2;
    const P = (u, v) => [ox + u * 1920 * k, v * 1080 * k];
    const [f0, f1] = S.fly, cy = (f0 + Math.random() * (f1 - f0)) * 1080 * k;
    const m = CLEAR * w, avoid = (this.o.avoid?.() || []).map((r) => [r.left - m, r.top - m, r.right + m, r.bottom + m]);
    // a patch whose bursts (fireball, dust skirt, the smoke column and its drift) all clear the card's text
    let zone = null, pts = null;
    for (const z of [...S.zones].sort(() => Math.random() - 0.5)) {
      const R = BURST_M * z.pxm * k;
      const xs = Array.from({ length: BOMBERS }, (_, j) => z.x[0] + (z.x[1] - z.x[0]) * (j + 0.5 + (Math.random() - 0.5) * 0.5) / BOMBERS);
      const at = xs.map((u) => P(u, z.y));
      if (at.every(([x, y]) => !avoid.some(([l, t, r, b]) => x + 5 * R > l && x - 5 * R < r && y - 9 * R < b && y + 1.5 * R > t))) {
        zone = z; pts = at; break;
      }
    }
    // the run comes in over the scene towards its patch: its racks open over open sky, ahead of the bursts
    const dir = zone ? ((zone.x[0] + zone.x[1]) / 2 < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? 1 : -1);
    const pxm = (zone || S.zones[0]).pxm * k, L = SPITFIRE_DAY.len * pxm, v = SPEED * pxm;
    const lay = { w, h, k, dir, cy, pxm, L, v, g: G * pxm, R: BURST_M * pxm, zone, P, dust: S.dust || [132, 120, 100],
      dpr: Math.min(devicePixelRatio || 1, 2, 2880 / w), x0: dir > 0 ? -1.5 * L : w + 1.5 * L,
      wind: (zone && P((zone.x[0] + zone.x[1]) / 2, 0)[0] < w / 2 ? -1 : 1) * 0.9 * pxm, // smoke drifts away from the card
      clip: zone?.clip?.map(([u, y]) => P(u, y)) || null, targets: [] };
    if (!zone) return lay;
    // each bomber lets its near-wing bomb go where, falling from its rack with drag, it lands on its point
    const order = dir > 0 ? pts : pts.reverse();
    for (let j = 0; j < BOMBERS; j++) {
      const [x, yg] = order[j], [, hy] = this._rackOffset(j, 0, lay);
      const drop = Math.max(4, yg - (cy + FORMATION[j][1] * L + hy)), T = Math.sqrt(2 * drop / lay.g);
      lay.targets.push({ x, yg: yg + (Math.random() - 0.5) * 0.15 * lay.R, release: x - dir * v * (1 - Math.exp(-DRAG * T)) / DRAG });
    }
    // the section starts far enough back that every rack meets its release line in flight, none behind it already
    const back = Math.min(...lay.targets.map((tg, j) => tg.release * dir - FORMATION[j][0] * L - this._rackOffset(j, 0, lay)[0] * dir));
    lay.x0 = dir * Math.min(lay.x0 * dir, back - 0.5 * L);
    return lay;
  }

  /**
   * The atlas cells scaled once per pass to the section's length (repeated halving, then to size, so the panel
   * colours average instead of shimmering), through the still's grade: {pose: {loaded, half, clean, hp}, bomb}.
   */
  _scale(lay) {
    const A = SPITFIRE_DAY, k = lay.L / (A.len * A.pxm), d = lay.dpr, out = {};
    const cell = ([x, y, cw, ch, ax, ay]) => {
      let src = this._img, sx = x, sy = y, sw = cw, sh = ch;
      const tw = Math.max(1, Math.round(cw * k * d)), th = Math.max(1, Math.round(ch * k * d));
      for (;;) {
        const half = sw / 2 >= tw && sh / 2 >= th, cv = document.createElement('canvas');
        cv.width = half ? Math.ceil(sw / 2) : tw; cv.height = half ? Math.ceil(sh / 2) : th;
        const g = cv.getContext('2d');
        g.imageSmoothingQuality = 'high';
        if (!half && this.o.grade) g.filter = typeof this.o.grade === 'function' ? this.o.grade() : this.o.grade;
        g.drawImage(src, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        src = cv; sx = 0; sy = 0; sw = cv.width; sh = cv.height;
        if (!half) break;
      }
      return { c: src, w: cw * k, h: ch * k, ax: ax * k, ay: ay * k };
    };
    for (const [pose, cells] of Object.entries(A.cells)) {
      out[pose] = { hp: cells.hp.map(([x, y]) => [x * k, y * k]) };
      for (const st of ['loaded', 'half', 'clean']) out[pose][st] = cell(cells[st]);
    }
    out.bomb = cell(A.bomb);
    out.bombLen = A.bombLen * lay.pxm;
    return out;
  }

  /** Slot i's anchor (the belly station) at pass time t, CSS px: the section's line plus a gentle formation bob. */
  _slot(i, t, lay = this._lay) {
    const [dx, dy, s] = FORMATION[i];
    return [lay.x0 + lay.dir * (lay.v * t + dx * lay.L), lay.cy + dy * lay.L + Math.sin(t * 1.1 + i * 1.9) * 0.05 * lay.L * s];
  }

  /** Slot i's wing rack (k 0 near / starboard, 1 far / port) relative to its anchor; mirrored when heading left. */
  _rackOffset(i, k, lay = this._lay) {
    const A = SPITFIRE_DAY, [hx, hy] = A.cells[POSE[i]].hp[k], s = FORMATION[i][2] * lay.L / (A.len * A.pxm);
    return [lay.dir * hx * s, hy * s];
  }

  _step(dt) {
    const p = this._pass, lay = this._lay;
    p.t += dt;
    // the racks: a bomber's near-wing bomb goes as its rack crosses the release line, the far one STICK_GAP later
    for (let i = 0; i < lay.targets.length; i++) {
      const tg = lay.targets[i];
      while (p.dropped[i] < 2) {
        const [x, y] = this._slot(i, p.t), [rx, ry] = this._rackOffset(i, p.dropped[i]);
        if (p.dropped[i] === 0 ? (x + rx - tg.release) * lay.dir < 0 : p.t < p.next[i]) break;
        p.dropped[i] += 1; p.next[i] = p.t + STICK_GAP;
        this._bombs.push({ x0: x + rx, y0: y + ry, x: x + rx, y: y + ry, t: 0, a: 0, yg: tg.yg + (p.dropped[i] - 1) * 0.06 * lay.R });
      }
    }
    for (const b of this._bombs) {   // drag on the forward speed, plain gravity; finned, the nose follows the path
      b.t += dt;
      const decay = Math.exp(-DRAG * b.t);
      b.x = b.x0 + lay.dir * lay.v * (1 - decay) / DRAG;
      b.y = b.y0 + 0.5 * lay.g * b.t * b.t;
      b.a = Math.atan2(lay.g * b.t, lay.v * decay);
      if (b.y >= b.yg) { b.dead = true; this._impact(b.x, b.yg); }
    }
    this._bombs = this._bombs.filter((b) => !b.dead);
    for (const b of this._booms) b.t += dt;
    this._booms = this._booms.filter((b) => b.t < SMOKE_LIFE);
    this._draw();
    const [tail] = this._slot(FORMATION.length - 1, p.t);
    const gone = lay.dir > 0 ? tail - 1.5 * lay.L > lay.w : tail + 1.5 * lay.L < 0;
    if (gone && !p.over && !this._bombs.length && !this._sounds.length) { p.over = true; this.o.passed?.(); }
    if (gone && !this._bombs.length && !this._booms.length) {
      this._end();
      if (this.running) this._schedule();
    }
  }

  /** A burst: its seeded shape for the picture, and its boom a moment later (the sound crosses the field slower). */
  _impact(x, y) {
    const seed = Math.random() * 100;
    this._booms.push({ x, y, t: 0, seed, shape: burstShape(seed), peak: 0.8 + 0.3 * Math.random() });
    const a = this.o.audio?.();
    if (!a?.unlocked || !a.playSfx) return;
    const delay = (BOOM_DELAY[0] + Math.random() * (BOOM_DELAY[1] - BOOM_DELAY[0])) * 1000;
    const t = setTimeout(() => {
      this._sounds = this._sounds.filter((s) => s !== t);
      if (this._pass) a.playSfx('explosion_far', null, { gain: 0.32, rate: 0.84 + Math.random() * 0.2, muffle: true, dedupe: 0 });
    }, delay);
    this._sounds.push(t);
  }

  _draw() {
    const { ctx, canvas: c } = this, lay = this._lay, d = lay.dpr;
    const w = Math.max(2, Math.round(lay.w * d)), h = Math.max(2, Math.round(lay.h * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, lay.w, lay.h);
    for (const b of this._booms) this._flash(b);          // the haze lit behind everything
    if (this._booms.length) {                              // the bursts, behind a nearer wall when the patch has one
      ctx.save();
      if (lay.clip) { // everything above the wall's top edge (and its level carried on past its ends)
        const c = lay.clip, far = 4 * Math.max(lay.w, lay.h);
        ctx.beginPath(); ctx.moveTo(-far, -far); ctx.lineTo(-far, c[0][1]);
        for (const [x, y] of c) ctx.lineTo(x, y);
        ctx.lineTo(far, c[c.length - 1][1]); ctx.lineTo(far, -far); ctx.closePath(); ctx.clip();
      }
      for (const b of this._booms) this._burst(b);
      ctx.restore();
    }
    for (const b of this._bombs) this._bomb(b);
    const order = FORMATION.map((f, i) => i).sort((a, b) => FORMATION[a][2] - FORMATION[b][2]); // further first
    for (const i of order) this._plane(i);
  }

  /** Slot i: bombed-up, 'half' once its near-wing bomb is away, then clean (top cover always clean); hazed by depth. */
  _plane(i) {
    const { ctx } = this, lay = this._lay, p = this._pass, [x, y] = this._slot(i, p.t), s = FORMATION[i][2];
    const cell = this._sprites[POSE[i]][i >= BOMBERS || !lay.zone ? 'clean' : ['loaded', 'half', 'clean'][p.dropped[i]]];
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(lay.dir * s, s);
    ctx.globalAlpha = Math.min(1, 0.55 + 0.45 * s);
    ctx.drawImage(cell.c, -cell.ax, -cell.ay, cell.w, cell.h);
    ctx.restore();
  }

  /** A falling 250 lb bomb, nose along its path (a dark speck at this range: it reads against the bright haze). */
  _bomb(b) {
    const { ctx } = this, lay = this._lay, bc = this._sprites.bomb;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(lay.dir, 1);
    ctx.rotate(b.a);
    ctx.drawImage(bc.c, -bc.ax, -bc.ay, bc.w, bc.h);
    ctx.restore();
  }

  /** The burst lights the haze around it: a warm bloom over the impact, peaking in ~40 ms and gone in ~0.8 s. */
  _flash(b) {
    const t = b.t;
    if (t > 0.8) return;
    const { ctx } = this, R = this._lay.R * b.shape.size;
    const env = (t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) / 0.16)) * b.peak, cx = b.x, cy = b.y - 2.5 * R, r = 15 * R;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, `rgba(255,238,206,${0.62 * env})`); gr.addColorStop(0.25, `rgba(255,220,170,${0.3 * env})`);
    gr.addColorStop(1, 'rgba(255,205,150,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gr; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * One 250 lb burst on the far ground, to the scene's scale (burstShape: no two alike): the dust skirt racing out
   * along the ground; the column of earth and smoke punched up, climbing, spreading and greying into the theatre's
   * dust as it drifts downwind (sunlit puffs with torn edges); the fireball's billows, white-hot to red-brown in
   * ~0.4 s; clods and a few sparks; a white flash on top.
   */
  _burst(b) {
    const { ctx } = this, lay = this._lay, S = b.shape, R = lay.R * S.size, t = b.t, y = b.y, P = this._puffSet;
    const puff = (img, x, yy, size, rot, a) => {
      if (a <= 0.004 || size < 1) return;
      ctx.save(); ctx.translate(x, yy); ctx.rotate(rot); ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    };
    const fade = (t0, life) => Math.min(1, t / t0) * Math.max(0, 1 - Math.max(0, t - life * 0.45) / (life * 0.55));
    for (const k of S.skirt) { // the dust skirt
      const q = 1 - Math.exp(-t * 2.4), x = b.x + k.side * k.reach * R * q + lay.wind * t * 0.5;
      puff(P.dust[k.k], x, y - R * (0.25 + 0.3 * q), R * k.s1 * (0.8 + 1.6 * q), k.rot, 0.65 * fade(0.15, 5.5));
    }
    for (const c of S.column) { // the column: soil-dark first, then the theatre's dust, climbing fast then slowly
      const pt = t - c.delay;
      if (pt <= 0) continue;
      const climb = 1 - Math.exp(-pt * 2.2), up = c.h * R * climb + 0.35 * R * pt, drift = lay.wind * pt * (0.3 + 0.12 * c.h);
      const x = b.x + c.x * R + drift, yy = y - 0.4 * R - up, size = R * (c.s0 + (c.s1 - c.s0) * climb) * (1 + 0.06 * pt) * 2;
      const a = Math.min(1, pt / 0.1) * Math.max(0, 1 - Math.max(0, pt - SMOKE_LIFE * 0.4) / (SMOKE_LIFE * 0.6 - c.delay)) * 0.9 * c.thin;
      const dark = c.soil * Math.max(0, 1 - pt / 2.4), rot = c.rot + c.spin * pt;
      puff(P.dust[c.k], x, yy, size, rot, a * (1 - dark));
      puff(P.dark[c.k], x, yy, size, rot, a * dark);
    }
    if (t < 0.5) { // the fireball: each billow's cooler skin, then its hot heart
      const grow = 1 - Math.exp(-t / 0.05);
      for (const hot of [false, true]) {
        for (const k of S.blobs) {
          const heat = Math.max(0, 1 - t / k.cool), r = k.r * R * grow * (1 + 1.2 * t);
          if (hot && heat <= 0.05) continue;
          const cx = b.x + k.x * R * grow, cy = y - R * 0.2 + (k.y * grow - 0.8 * t) * R, rr = hot ? r * (0.5 + 0.4 * heat) : r * 1.1;
          const c = heatRGB(hot ? heat : heat * 0.5), al = hot ? Math.min(1, 0.4 + heat) : 0.9 * Math.max(0, 1 - t / 0.5);
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
          gr.addColorStop(0, `rgba(${c},${al})`); gr.addColorStop(0.6, `rgba(${c},${al * 0.75})`); gr.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = gr; ctx.fillRect(cx - rr, cy - rr, 2 * rr, 2 * rr);
        }
      }
    }
    if (t < 1.4) { // clods as short streaks along their flight, a few sparks
      for (const d of S.spray) {
        const px = b.x + d.vx * R * t, py = y - R * 0.15 + (d.vy * t + 4.6 * t * t) * R;
        if (py > y + 1 || (d.hot && t > 0.45) || (!d.hot && t < 0.08)) continue;
        const vy = d.vy + 9.2 * t, sp = Math.hypot(d.vx, vy) || 1, ln = Math.min(3.2, 0.05 * sp * R) + d.w;
        ctx.strokeStyle = d.hot ? `rgba(255,${Math.round(220 - 150 * t)},${Math.round(120 - 90 * t)},${1 - t / 0.45})` : `rgba(40,32,25,${Math.min(0.9, 1.5 - t)})`;
        ctx.lineWidth = Math.max(0.8, d.w * R / 26);
        ctx.beginPath(); ctx.moveTo(px - d.vx / sp * ln, py - vy / sp * ln); ctx.lineTo(px, py); ctx.stroke();
      }
    }
    if (t < 0.1) { // the flash: a white-hot ball and a sheet of light along the ground, added on top
      const q = t / 0.1, r = R * (0.8 + 1.2 * q);
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(b.x, y - R * 0.2, 0, b.x, y - R * 0.2, r);
      gr.addColorStop(0, `rgba(255,250,232,${1 - q})`); gr.addColorStop(0.3, `rgba(255,236,190,${0.8 * (1 - q)})`); gr.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = gr; ctx.fillRect(b.x - r, y - R * 0.2 - r, 2 * r, 2 * r);
      ctx.save(); ctx.translate(b.x, y); ctx.scale(1, 0.12);
      const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 4.5);
      gl.addColorStop(0, `rgba(255,232,196,${0.7 * (1 - q)})`); gl.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = gl; ctx.fillRect(-R * 4.5, -R * 4.5, R * 9, R * 9);
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
