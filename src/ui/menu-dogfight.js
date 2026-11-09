/**
 * Main-menu dogfight (user: "Can we have a dog fight between airplanes after planes pass by in the main menu",
 * 2026-11-08). A few seconds after the bombers' pass (menu-bombers.js) has gone and its booms have played, a short
 * fight crosses the theatre still's sky: Bf 109s and Spitfires in one of a few seeded choreographies
 * (dogfight-plan.js: a bounce from above, a head-on pass, a scissors; a turning fight, climbing turns, short bursts),
 * one 109 hit — a puff, then black smoke — diving away behind the skyline (a faint far flash, a thin column), the
 * rest breaking off out of the frame: 15-25 s. The planes are the turntable sprites of the Blender Spitfire and Bf 109
 * (assets/ui/keyart/fighters.webp, fetched at low priority only after a pass), picked by heading and bank — mirrored
 * for the other half of the circle, turned in the screen plane for pitch — at the scene's distance with depth (further
 * ones smaller, sinking toward the horizon, fading into the haze) and through the still's grade. The fight is seated
 * per form factor in the open sky (dogfight-plan.js place: never over the card's text, as little as can be behind the
 * badge) on a canvas inside the backdrop's scene, so the planes pass behind the badge and the column.
 * Sound, under the menu music through game.audio (volumes and mute apply; never before the audio is unlocked): a
 * distant engine drone panned with the fight, its pitch bent gently by the planes closing or opening (doppler), very
 * muffled MG bursts a moment after the tracers (the sound crosses the field slower), a faint dive whine.
 * Guards as the bombers': none under reduced motion or MENU BACKGROUND: STILL, in test / debug / walkthrough /
 * ?mission sessions, nor unless the front end shows its still; a mission load, leaving the front end, a new card or a
 * hidden tab ends a fight at once, its sounds included. Between fights: a 1x1 canvas and no timers but the next.
 * @module ui/menu-dogfight
 */

import { FIGHTER_ATLAS } from './fighter-atlas.js';
import { STILL_SCENES } from './menu-model.js';
import { puffSprites } from './menu-bombers.js';
import { D0, FIGHTS, FADE, LEN, plan, placing, project, regionOf, sample, view } from './dogfight-plan.js';

const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const DELAY = [3500, 5500];      // ms after the bombers' pass before the fight comes in
const ROUND = 0.085;             // s between visible rounds (tracers) in a burst
const U = 320;                   // m/s a tracer leaves the guns at (eased for the eye)
const TRACER_LIFE = 0.5;         // s
const STREAK = 0.03;             // s of a tracer's flight its streak shows
const PUFF_EVERY = 0.028;        // s between the hit plane's smoke puffs (they overlap into one trail)
const SMOKE_LIFE = 5.5;          // s a smoke puff lingers
const WIND = [2.6, 1.1, 0];      // m/s the smoke drifts (across, up)
const SOUND_LAG = 0.7;           // s from the muzzle flashes to the MG's rattle
const D0_OF = (r) => D0 / r;     // a plane's distance from its depth scale

export class MenuDogfight {
  /**
   * @param {HTMLCanvasElement} canvas the fight's layer inside the backdrop's scene
   * @param {{audio: () => object|null, still?: () => boolean, visible?: () => boolean, theater?: () => string|null,
   *   grade?: () => string, region?: () => object|null, done?: () => void}} o — region(): the screen as dogfight-plan
   *   regionOf() takes it ({w, h, k, ox, cols, rows, badge, text}: the canvas' CSS px), from the live badge and card;
   *   done(): a fight has run its course
   */
  constructor(canvas, o) {
    this.canvas = canvas;
    this.o = o;
    this.ctx = canvas.getContext('2d');
    this.alive = !!this.ctx;
    const q = new URLSearchParams(location.search);
    this.blocked = q.get('test') === '1' || q.has('debug') || q.has('walkthrough') || q.has('mission');
    this.running = false;
    this.fightNo = Math.floor(Math.random() * 3);
    this._timer = 0;
    this._raf = 0;
    this._sounds = [];
    this._img = null;
    this._ready = false;
    this._atlas = null;
    this._f = null;
  }

  /** Arm (the front end's still is up): fights follow the bombers' passes. Under reduced motion / STILL: none. */
  start() {
    if (this.o.still?.()) { this.stop(); return; }
    if (!this.alive || this.blocked) return;
    this.running = true;
  }

  /** Stop everything at once: the pending fight, the one in flight and its sounds; the layer freed. */
  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._end();
  }

  /** A new card: the fight in flight ends at once, sounds and all. */
  interrupt() {
    clearTimeout(this._timer);
    this._end();
  }

  dispose() {
    this.stop();
    this.alive = false;
  }

  /** The screen changed shape: a fight seated for the old one ends (a phone's toolbar sliding in and out does not). */
  resized(w, h) {
    const f = this._f;
    if (f && (Math.abs(w - f.w) > 1 || Math.abs(h - f.h) > 0.12 * f.h)) this.interrupt();
  }

  /** The bombers' pass is over (its booms played): fetch the sprites now, and fight a few seconds later. */
  after(ms = DELAY[0] + Math.random() * (DELAY[1] - DELAY[0])) {
    if (!this.running || this._f) return;
    this._load();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.fight(), ms);
  }

  _end() {
    cancelAnimationFrame(this._raf);
    for (const t of this._sounds) clearTimeout(t);
    this._sounds = [];
    const f = this._f;
    this._f = null;
    this._prep = null;
    if (f) for (const h of [f.drone, f.whine]) h?.stop?.(0.25);
    this.canvas.width = this.canvas.height = 1; // clears it and frees the backing store between fights
  }

  /** The fighter atlas, fetched at low priority and decoded off the main thread; graded once per theatre. */
  _load() {
    if (this._img) return;
    const img = this._img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = FIGHTER_ATLAS.url;
    const ok = () => { if (this._img === img) this._ready = true; };
    if (img.decode) img.decode().then(ok, () => {});
    else img.onload = ok;
  }

  /**
   * Fight now (also the capture / test hook: hud.backdrop.dogfight.fight(true, seed, name)): the next choreography in
   * turn that can be seated on this screen (placed a piece at a time, so a phone's frames stay smooth), then flown on
   * the animation clock; seek(t) draws any moment of it instead (tests, stills).
   * @returns {Promise<boolean>} whether a fight began
   */
  async fight(force = false, seed = null, name = null) {
    const ok = () => force || (this.running && !document.hidden && !!this.o.visible?.());
    if (!this.alive || this._f || this._prep || !ok()) return false;
    this._load();
    const prep = this._prep = {}, live = () => this._prep === prep;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; !this._ready && i < 60 && live(); i++) await wait(100);
    const R = live() && this._ready ? this.o.region?.() : null;
    if (!R) { if (live()) this._prep = null; return false; }
    this._graded();                                     // the graded atlas and puffs, a task of their own
    await wait(0);
    if (!live()) return false;
    const S = STILL_SCENES[this.o.theater?.()] || STILL_SCENES.temperate;
    const region = regionOf({ ...R, sky: S.sky, pxm: S.zones.reduce((a, z) => a + z.pxm, 0) / S.zones.length });
    // the next choreography in turn, unless this screen hides too much of it: then the one it shows best
    const names = Object.keys(FIGHTS), sd = seed ?? Math.floor(Math.random() * 2 ** 31);
    let best = null;
    for (let j = 0; j < names.length && !(best && best.at.open >= 0.7); j++) {
      const p = plan(sd, name || names[(this.fightNo + j) % names.length]), it = placing(p, region);
      let r, t0 = performance.now();
      while (!(r = it.next()).done) {
        if (performance.now() - t0 > 6) { await wait(0); if (!live()) return false; t0 = performance.now(); }
      }
      if (r.value && (!best || r.value.open > best.at.open + 0.05)) best = { p, at: r.value };
      if (name) break;
    }
    await wait(0);                                      // the fight's timeline: a task of its own
    if (!live()) return false;
    this._prep = null;
    if (!best || !ok()) return false;
    this.fightNo = names.indexOf(best.p.name) + 1;  // the next fight flies the next choreography
    this._f = this._setup(best.p, best.at, region);
    this._sound(this._f);
    this._run(this._f);
    return true;
  }

  /** The fight on the animation clock, at 30 frames a second like the bombers (from where seek() left it). */
  _run(f) {
    let last = performance.now(), acc = 1 / 30;
    f.paused = false;
    const tick = (now) => {
      if (this._f !== f || f.paused) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 1 / 30) { f.t += acc; acc = 0; this._frame(f); }
      if (this._f === f && !f.paused) this._raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(tick);
  }

  /** Let a fight held by seek() fly on from there (tests). */
  resume() { if (this._f) this._run(this._f); }

  /** Draw the fight at time t (s) and hold it there (tests, captures); null: none in flight. */
  seek(t) {
    const f = this._f;
    if (!f) return null;
    f.paused = true;
    cancelAnimationFrame(this._raf);
    f.t = t;
    this._draw(f, t);
    return f;
  }

  /** One frame on the clock: draw, keep the sounds with the planes, end when the last smoke has gone. */
  _frame(f) {
    if (f.t >= f.end) { this._end(); this.o.done?.(); return; }
    this._draw(f, f.t);
    this._audio(f, f.t);
  }

  /**
   * A placed fight's timeline: the planes, every round of every burst, the hit plane's smoke puffs (born at its engine,
   * then drifting), the moment it drops behind the skyline (and where), the end; the canvas sized to the fight's box.
   */
  _setup(p, at, region) {
    const c = p.cast, w = region.w, h = region.h, cols = region.cols, cw = w / cols, sky = region.sky;
    const skyAt = (x) => { const u = Math.max(0, Math.min(cols - 1e-6, x / cw)), i = Math.floor(u); return sky[i] + (sky[i + 1] - sky[i]) * (u - i); };
    const planes = c.planes.map((q, i) => ({ q, i })).filter((e) => !e.q.ghost);
    const f = { p, at, w, h, t: at.t0 || 0, skyAt, planes, kill: c.kill, rounds: [], smoke: [], gone: null, paused: false,
      dpr: Math.min(devicePixelRatio || 1, 2, 2880 / w), seed: p.seed };
    for (const b of c.bursts) {
      const last = c.kill && b.s === c.kill.s && b.g === c.kill.g;  // the killing bursts end in the 109
      for (let i = 0; i * ROUND < b.dur; i++) f.rounds.push({ ...b, te: b.t0 + i * ROUND, i, last });
    }
    if (c.kill) {
      const g = c.planes[c.kill.g];
      for (let t = c.kill.t + 0.1; t < p.dur; t += 1 / 30) {           // where it drops behind the far ground
        const v = view(g, at, t), off = v.x < -v.len || v.x > w + v.len || v.y < -v.len || v.r < FADE[0];
        if (off || v.y - 0.3 * v.len > skyAt(v.x)) { f.gone = { t, x: v.x, y: skyAt(v.x), seen: !off }; break; }
      }
      const tEnd = Math.min(p.dur, (f.gone?.t ?? c.kill.t + 7) + 0.3);
      for (let te = c.kill.t + 0.12, j = 0; te < tEnd; te += PUFF_EVERY, j++) {
        const q = sample(g, te), L = 0.32 * LEN.bf109;
        f.smoke.push({ te, j, x: q.x + Math.cos(q.cl) * Math.cos(q.hd) * L, y: q.y + Math.sin(q.cl) * L, z: q.z + Math.cos(q.cl) * Math.sin(q.hd) * L });
      }
    }
    f.end = Math.max(p.dur, f.gone?.seen ? f.gone.t + 8 : 0, c.kill ? Math.min(p.dur + 2, c.kill.t + SMOKE_LIFE + 1) : 0);
    // the canvas covers the fight: every plane's track on screen, its smoke's growth, the far column; within the screen
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const { q } of planes) {
      for (let t = f.t; t <= p.dur; t += 0.25) {
        const v = view(q, at, t), m = 1.6 * v.len + 0.25 * 70 * at.s * (at.c ?? 1); // a quarter second's flight more
        if (v.x < -m || v.x > w + m || v.y < -m || v.y > h + m) continue;
        x0 = Math.min(x0, v.x - m); x1 = Math.max(x1, v.x + m); y0 = Math.min(y0, v.y - m); y1 = Math.max(y1, Math.min(v.y + m, skyAt(v.x) + m));
      }
    }
    for (const rd of f.rounds) {                        // the tracers' reach
      const [hx, hy] = this._round(f, rd, rd.te + TRACER_LIFE) || [];
      if (hx === undefined || hx < 0 || hx > w || hy < 0 || hy > h) continue;
      x0 = Math.min(x0, hx - 4); x1 = Math.max(x1, hx + 4); y0 = Math.min(y0, hy - 4); y1 = Math.max(y1, hy + 4);
    }
    if (f.gone?.seen) { const m = 4 * LEN.bf109 * at.s; x0 = Math.min(x0, f.gone.x - m); x1 = Math.max(x1, f.gone.x + 2 * m); y0 = Math.min(y0, f.gone.y - 3 * m); }
    f.box = { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)) };
    f.box.w = Math.max(2, Math.min(w, Math.ceil(x1)) - f.box.x); f.box.h = Math.max(2, Math.min(h, Math.ceil(y1)) - f.box.y);
    const cs = this.canvas.style;
    cs.left = `${f.box.x}px`; cs.top = `${f.box.y}px`; cs.width = `${f.box.w}px`; cs.height = `${f.box.h}px`;
    this.canvas.width = Math.round(f.box.w * f.dpr); this.canvas.height = Math.round(f.box.h * f.dpr);
    // the sky above the far ground: the hit plane, its smoke and the far column are drawn into it only
    const clip = new Path2D();
    clip.moveTo(-10, -10);
    for (let j = 0; j <= cols; j++) clip.lineTo(j * cw, sky[j]);
    clip.lineTo(w + 10, sky[cols]); clip.lineTo(w + 10, -10); clip.closePath();
    f.sky = clip;
    f.atlas = this._graded();
    return f;
  }

  _draw(f, t) {
    const { ctx } = this, d = f.dpr;
    ctx.setTransform(d, 0, 0, d, -f.box.x * d, -f.box.y * d);
    ctx.clearRect(f.box.x, f.box.y, f.box.w, f.box.h);
    if (f.kill && t >= f.kill.t) {                       // the hit plane's smoke and the far column, behind the far ground
      ctx.save(); ctx.clip(f.sky);
      if (f.gone?.seen) this._column(f, t);               // it went down in view: the far flash and column
      this._smoke(f, t);
      ctx.restore();
    }
    const vs = f.planes.map((e) => ({ e, v: view(e.q, f.at, t) })).sort((a, b) => a.v.r - b.v.r); // the further first
    for (const { e, v } of vs) {
      const down = f.kill && e.i === f.kill.g && t >= f.kill.t;
      if (down) { ctx.save(); ctx.clip(f.sky); }
      this._plane(f, e, v, t);
      if (down) ctx.restore();
    }
    this._tracers(f, t);
    if (f.kill && t >= f.kill.t && t < f.kill.t + 1.4) this._hit(f, t);
  }

  /** How much of a plane the haze leaves at depth scale r: none past FADE[0], a veil further than the stage. */
  _haze(r) { return clamp01((r - FADE[0]) / (FADE[1] - FADE[0])) * (0.74 + 0.26 * clamp01((r - 0.8) / 0.4)); }

  /** A plane's sprite: its turntable cell by heading and bank (two headings cross-faded), mirrored, turned for pitch. */
  _plane(f, e, v, t) {
    const a = this._haze(v.r), m = v.len;
    if (a <= 0.01 || v.x < f.box.x - m || v.x > f.box.x + f.box.w + m || v.y < f.box.y - m || v.y > f.box.y + f.box.h + m) return;
    const A = FIGHTER_ATLAS, hit = f.kill && e.i === f.kill.g && t >= f.kill.t, kind = hit ? 'bf109x' : e.q.kind;
    const ys = hit ? A.xyaw : A.yaw, bs = hit ? A.xbank : A.bank, cells = A.cells[kind];
    const fy = Math.max(0, Math.min(ys.length - 1, (v.yaw - ys[0]) / (ys[1] - ys[0])));
    const ib = Math.round(Math.max(0, Math.min(bs.length - 1, (v.bank - bs[0]) / (bs[1] - bs[0]))));
    const y0 = Math.floor(fy), y1 = Math.min(ys.length - 1, y0 + 1), u = fy - y0, k = v.len / (LEN[e.q.kind] * A.pxm), { ctx } = this;
    ctx.save();
    ctx.translate(v.x, v.y);
    if (v.flip) ctx.scale(-1, 1);
    ctx.rotate(-v.pitch * Math.PI / 180);
    ctx.scale(k, k);
    const draw = (iy, al) => {
      const c = cells[iy * bs.length + ib];
      ctx.globalAlpha = al;
      ctx.drawImage(f.atlas, c[0], c[1], c[2], c[3], -c[4], -c[5], c[2], c[3]);
    };
    if (u < 0.5) { draw(y0, a); if (u > 0.2) draw(y1, a * (u - 0.2) / 0.6); }   // the nearer heading, the next fading in
    else { draw(y1, a); if (u < 0.8) draw(y0, a * (0.8 - u) / 0.6); }
    ctx.restore();
    v.cell = cells[Math.round(fy) * bs.length + ib];
    v.k = k;
  }

  /** A point of a drawn plane's cell (atlas px from its anchor: nose, tail, engine) on the screen. */
  _pt(v, px, py) {
    const th = v.pitch * Math.PI / 180, x = px * v.k, y = py * v.k;
    const rx = x * Math.cos(th) + y * Math.sin(th), ry = -x * Math.sin(th) + y * Math.cos(th);
    return [v.x + (v.flip ? -rx : rx), v.y + ry];
  }

  /**
   * The bursts: each round a thin, short streak from the guns along the shooter's nose bent toward its target (the
   * pilot's lead), fading as it goes; the killing bursts end in the 109. Muzzle flashes flicker at the guns.
   */
  _tracers(f, t) {
    const { ctx } = this, at = f.at, cs = f.p.cast.planes;
    ctx.lineCap = 'round';
    for (const rd of f.rounds) {
      const a = t - rd.te;
      if (a < 0 || a > TRACER_LIFE) continue;
      const fl = this._round(f, rd, t);
      if (!fl) continue;
      const [hx, hy, r, tx, ty] = fl, al = (1 - a / TRACER_LIFE) * this._haze(r);
      ctx.strokeStyle = `rgba(255,104,34,${0.62 * al})`; ctx.lineWidth = Math.max(1.8, 0.4 * at.s * r);   // reddish in daylight
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.strokeStyle = `rgba(255,214,148,${al})`; ctx.lineWidth = Math.max(1.0, 0.16 * at.s * r);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const b of f.p.cast.bursts) {                    // muzzle flashes at the guns while a burst lasts
      if (t < b.t0 || t > b.t0 + b.dur || hash(Math.floor(t * 30) * 7.1 + b.s) < 0.3) continue;
      const v = view(cs[b.s], at, t), c = this._cellOf(cs[b.s].kind, v), k = v.len / (LEN[cs[b.s].kind] * FIGHTER_ATLAS.pxm);
      v.k = k;
      const gun = cs[b.s].kind === 'spit' ? 0.45 : 0.9, [mx, my] = this._pt(v, c[6] * gun, c[7] * gun), rr = Math.max(1.5, 0.22 * v.len);
      const gr = ctx.createRadialGradient(mx, my, 0, mx, my, rr);
      gr.addColorStop(0, `rgba(255,240,190,${0.9 * this._haze(v.r)})`); gr.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = gr; ctx.fillRect(mx - rr, my - rr, 2 * rr, 2 * rr);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Where a round is at time t (its streak's head and tail on the screen, and its depth), or null once a killing
   * burst's round has reached the 109: fired from the guns along the shooter's nose bent toward the target.
   */
  _round(f, rd, t) {
    const cs = f.p.cast.planes, a = t - rd.te, S = rd.S || (rd.S = sample(cs[rd.s], rd.te)), G = rd.G || (rd.G = sample(cs[rd.g], rd.te + 0.2));
    const F = [Math.cos(S.cl) * Math.cos(S.hd), Math.sin(S.cl), Math.cos(S.cl) * Math.sin(S.hd)];
    const gx = G.x - S.x, gy = G.y - S.y, gz = G.z - S.z, dist = Math.hypot(gx, gy, gz) || 1;
    if (rd.last && U * a > dist + 6) return null;         // into the 109
    const j = (n) => (hash(rd.te * 91.7 + n) - 0.5) * 0.05;
    let dx = F[0] + 1.4 * gx / dist + j(1), dy = F[1] + 1.4 * gy / dist + j(2), dz = F[2] + 1.4 * gz / dist + j(3);
    const dn = Math.hypot(dx, dy, dz); dx /= dn; dy /= dn; dz /= dn;
    const o = 0.5 * LEN[cs[rd.s].kind], ox = S.x + F[0] * o, oy = S.y + F[1] * o, oz = S.z + F[2] * o;
    const a0 = Math.max(0, a - STREAK), vx = dx * U + F[0] * S.v, vy = dy * U + F[1] * S.v, vz = dz * U + F[2] * S.v;
    const [hx, hy, r] = project(f.at, ox + vx * a, oy + vy * a, oz + vz * a), [tx, ty] = project(f.at, ox + vx * a0, oy + vy * a0, oz + vz * a0);
    return [hx, hy, r, tx, ty];
  }

  /** The cell a plane shows (for its points), as _plane picks it. */
  _cellOf(kind, v) {
    const A = FIGHTER_ATLAS, ys = A.yaw, bs = A.bank;
    const iy = Math.round(Math.max(0, Math.min(ys.length - 1, (v.yaw - ys[0]) / (ys[1] - ys[0]))));
    const ib = Math.round(Math.max(0, Math.min(bs.length - 1, (v.bank - bs[0]) / (bs[1] - bs[0]))));
    return A.cells[kind][iy * bs.length + ib];
  }

  /** The hit: a flash at the 109's engine, a burst of grey and white, bits flying off, and a flicker of flame. */
  _hit(f, t) {
    const { ctx } = this, a = t - f.kill.t, g = f.p.cast.planes[f.kill.g], at = f.at, s = at.s;
    const v = view(g, at, t), c = this._cellX(v), k = v.len / (LEN.bf109 * FIGHTER_ATLAS.pxm);
    v.k = k;
    const [ex, ey] = this._pt(v, c[10], c[11]), q = sample(g, f.kill.t);
    if (a < 0.12) {
      const rr = 0.8 * v.len, gr = ctx.createRadialGradient(ex, ey, 0, ex, ey, rr);
      gr.addColorStop(0, `rgba(255,246,214,${1 - a / 0.12})`); gr.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(ex - rr, ey - rr, 2 * rr, 2 * rr);
      ctx.globalCompositeOperation = 'source-over';
    }
    for (let i = 0; i < 5; i++) {                        // the burst of smoke and glycol where it was hit
      const d = (2 + 7 * (1 - Math.exp(-a / 0.35))), an = hash(f.seed + i * 3.7) * 6.283;
      const [px, py, r] = project(at, q.x + Math.cos(an) * d, q.y + Math.sin(an) * d * 0.7 + 0.8 * a, q.z);
      const sz = (2.4 + 5 * (1 - Math.exp(-a / 0.4))) * s * r, al = 0.75 * (1 - a / 1.4) * this._haze(r);
      this._puff(this._puffLight[i % 2], px, py, sz, an, al);
    }
    ctx.fillStyle = `rgba(36,32,28,${0.9 * (1 - a / 1.4)})`;
    for (let i = 0; i < 7; i++) {                        // bits of it, falling away
      const an = hash(f.seed + 11 + i) * 6.283, sp = 6 + 14 * hash(f.seed + 21 + i);
      const [px, py] = project(at, q.x + Math.cos(an) * sp * a, q.y + Math.sin(an) * sp * a - 4.9 * a * a, q.z + 0.3 * sp * a);
      const r0 = Math.max(0.7, 0.05 * s * (1 + hash(i)));
      ctx.fillRect(px - r0, py - r0, 2 * r0, 2 * r0);
    }
    if (a < 1.4 && hash(Math.floor(t * 30) + 3) > 0.25) { // a flicker of flame at the engine
      const rr = Math.max(1.5, 0.14 * v.len), gr = ctx.createRadialGradient(ex, ey, 0, ex, ey, rr);
      gr.addColorStop(0, 'rgba(255,214,120,0.95)'); gr.addColorStop(1, 'rgba(255,110,30,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(ex - rr, ey - rr, 2 * rr, 2 * rr);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** The hit 109's cell (its own, smaller grid) for its points. */
  _cellX(v) {
    const A = FIGHTER_ATLAS, ys = A.xyaw, bs = A.xbank;
    const iy = Math.round(Math.max(0, Math.min(ys.length - 1, (v.yaw - ys[0]) / (ys[1] - ys[0]))));
    const ib = Math.round(Math.max(0, Math.min(bs.length - 1, (v.bank - bs[0]) / (bs[1] - bs[0]))));
    return A.cells.bf109x[iy * bs.length + ib];
  }

  _puff(img, x, y, size, rot, a) {
    if (a <= 0.004 || size < 0.8) return;
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /**
   * The hit 109's trail: puffs born at its engine every PUFF_EVERY s, black at first, growing, greying and thinning
   * as they drift downwind; smaller and fainter the further off they were born.
   */
  _smoke(f, t) {
    const at = f.at, P = this._puffs;
    for (const p of f.smoke) {
      const a = t - p.te;
      if (a < 0) break;
      if (a > SMOKE_LIFE) continue;
      const h1 = hash(p.j * 1.37 + f.seed), h2 = hash(p.j * 2.71 + f.seed), sp = 0.25 + 0.55 * a;
      const [x, y, r] = project(at, p.x + WIND[0] * a + (h1 - 0.5) * 2 * sp, p.y + WIND[1] * a + (h2 - 0.5) * 2 * sp, p.z + WIND[2] * a);
      const size = (2.4 + 5.6 * (1 - Math.exp(-a / 1.4))) * at.s * r;
      const al = 0.42 * Math.min(1, a / 0.05) * Math.exp(-a / 2.2) * (1 - clamp01((a - (SMOKE_LIFE - 1.6)) / 1.6)) * this._haze(r);
      const grey = clamp01(a / 2.5), rot = h1 * 6.283 + 0.25 * a;
      this._puff(P.dust[p.j % 2], x, y, size, rot, al * (1 - grey));
      this._puff(P.dark[p.j % 2], x, y, size, rot, al * grey);
    }
  }

  /** Where it went down, far off: a faint flash over the skyline, then a thin column of smoke drifting up from it. */
  _column(f, t) {
    const { ctx } = this, g = f.gone, t0 = g.t + 1.0, a = t - t0, L = LEN.bf109 * f.at.s;
    if (a < 0) return;
    if (a < 0.8) {
      const env = a < 0.05 ? a / 0.05 : Math.exp(-(a - 0.05) / 0.22), rr = 5 * L, gr = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rr);
      gr.addColorStop(0, `rgba(255,226,180,${0.42 * env})`); gr.addColorStop(1, 'rgba(255,200,150,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(g.x - rr, g.y - rr, 2 * rr, 2 * rr);
      ctx.globalCompositeOperation = 'source-over';
    }
    for (let i = 0; i < 26; i++) {                       // thin and faint: it is far off
      const b = a - i * 0.18;
      if (b < 0 || b > 6) continue;
      const rise = (1 - Math.exp(-b / 2.6)) * 3.2 * L + 0.2 * L * b, x = g.x + 0.1 * L * b * (1 + hash(i)) + (hash(i * 3.1) - 0.5) * 0.2 * L;
      const sz = (0.3 + 0.8 * (1 - Math.exp(-b / 2.4))) * L, al = 0.16 * Math.min(1, b / 0.4) * (1 - b / 6) * (1 - i / 30);
      this._puff(this._puffs.dark[i % 2], x, g.y + 0.2 * L - rise, sz, hash(i) * 6.283, al);
    }
  }

  /** The fight's sounds begin with it: the drone (silent until planes show); the rest follow the planes per frame. */
  _sound(f) {
    const a = this.o.audio?.();
    if (!a?.unlocked || !a.playSfx) return;
    f.audio = a;
    f.drone = a.playSfx('plane_engine', null, { loop: true, gain: 0.0001, rate: 1.6, muffle: true }) || null;
    f.heard = new Set();
  }

  /**
   * Per frame: the drone's level from the planes in view (their size), its pan from where they are and its pitch from
   * whether they close or open on the viewer (a gentle doppler); each burst's rattle SOUND_LAG s after its flashes,
   * very muffled; the hit 109's whine rising as it dives, gone with it behind the far ground.
   */
  _audio(f, t) {
    const a = f.audio;
    if (!a) return;
    let loud = 0, px = 0, n = 0, vz = 0;
    for (const { q } of f.planes) {
      const v = view(q, f.at, t), w = this._haze(v.r) * v.r * v.r;
      if (w <= 0.01 || v.x < 0 || v.x > f.w || v.y < -v.len || v.y > f.skyAt(v.x)) continue;
      const v0 = view(q, f.at, t - 0.1);
      loud += w; px += v.x * w; n += w; vz += (D0_OF(v0.r) - D0_OF(v.r)) / 0.1 * w;
    }
    const h = f.drone, live = h?.real || h, ctxT = live?.src?.context?.currentTime; // a deferred voice: its real one
    if (h && !h.ended) {
      const g = 0.04 * Math.min(1, loud / 2.2);           // ~6 dB under the menu music at its loudest
      if (Math.abs(g - (f.g ?? -1)) > 0.004) { h.setGain(g); f.g = g; }
      if (n > 0 && Number.isFinite(ctxT)) {
        live.panNode?.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, (px / n / f.w * 2 - 1) * 0.8)), ctxT, 0.3);
        live.src.playbackRate.setTargetAtTime?.(1.6 * 343 / (343 - 0.5 * vz / n), ctxT, 0.3);
      }
    }
    for (const b of f.p.cast.bursts) {
      if (f.heard.has(b) || t < b.t0 + SOUND_LAG) continue;
      f.heard.add(b);
      if (t < b.t0 + SOUND_LAG + 0.5) a.playSfx('mg_burst', null, { gain: 0.1, rate: 0.85 + 0.2 * hash(b.t0), muffle: true, dedupe: 0 });
    }
    const k = f.kill;
    if (!k) return;
    if (!f.whine && t > k.t + 0.4 && t < k.t + 1.5) f.whine = a.playSfx('plane_engine', null, { loop: true, gain: 0.0001, rate: 2.2, muffle: true }) || 1;
    const wh = f.whine;
    if (wh && wh !== 1 && !wh.ended) {
      const v = view(f.p.cast.planes[k.g], f.at, t), out = f.gone ? clamp01((t - f.gone.t + 0.3) / 0.8) : clamp01((t - k.t - 6) / 1);
      const g = 0.035 * this._haze(v.r) * (1 - out) * clamp01((t - k.t - 0.4) / 0.6);
      if (Math.abs(g - (f.wg ?? -1)) > 0.002) { wh.setGain(g); f.wg = g; }
      const ws = (wh.real || wh).src;
      if (Number.isFinite(ws?.context?.currentTime)) ws.playbackRate.setTargetAtTime?.(2.2 + 1.2 * clamp01((t - k.t - 0.4) / 3), ws.context.currentTime, 0.3);
      if (out >= 1) { wh.stop(0.3); f.whine = 1; }
    }
  }

  /** The atlas through the still's grade (once per theatre: the planes carry the scene's one filmic look). */
  _graded() {
    const th = this.o.theater?.() || 'temperate';
    if (this._atlas && this._atlasFor === th) return this._atlas;
    const c = document.createElement('canvas');
    c.width = FIGHTER_ATLAS.w; c.height = FIGHTER_ATLAS.h;
    const g = c.getContext('2d');
    const f = this.o.grade?.();
    if (f) g.filter = f;
    g.drawImage(this._img, 0, 0);
    this._atlas = c;
    this._atlasFor = th;
    this._puffs = this._puffs || puffSprites([46, 42, 38]);
    this._puffLight = this._puffLight || puffSprites([214, 210, 202]).dust;
    return c;
  }
}
