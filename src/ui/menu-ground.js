/**
 * Main-menu ground fight (user: "Can we have rhe soldiers fighting and maybe a tank crossing the bridge shooting",
 * 2026-11-08). In the theatre still's own scene a small battle plays (ground-plan.js): the game's commandos work up a
 * bank in bounds against Germans behind sandbags and an MG in a pillbox, and on the river still a Panzer IV crosses
 * the bridge, stops, traverses and fires on them. The actors are the game's own soldiers and tank rendered through
 * the still's camera in its light and print grade (tools/ui/ground/: assets/ui/keyart/ground-<theatre>.webp), placed
 * by projecting their world positions through that camera (so scale and perspective are the still's), and hidden
 * pixel by pixel behind whatever the still has nearer — sandbags, the truss's members, the tree — from the depth of
 * the same render (ground-<theatre>-depth-<n>.webp). Effects to the scene's scale: muzzle flicks, a few thin MG
 * tracers, dust kicks where rounds land, the tank gun's flash, blast dust and smoke, the shell's burst of earth.
 * Sound, under the menu music through game.audio (volumes and mute apply; never before the audio is unlocked):
 * distant rifle and MG crackle, the tank's engine and tracks while it moves, its gun, the shell's crump, each
 * delayed by its distance. Canvas 2D on a layer of the backdrop's scene; the sprites and depth are fetched once the
 * menu is up, never before. Nothing fades or pops in view ("Tank should get offscreen not disappear mid screen"): the
 * fight is staged as soon as its sprites are in (its first frame drawn: the defenders at their posts), men join from
 * off the screen, the tank comes on and goes off beyond its edge and the fight runs until it has; then the field stays
 * as it stands — the dead down, the living at their posts — drawn once, until the scene changes (a new card, a
 * reshape, leaving the front end), with no new fight over it. The menu's director (menu-director.js) decides when it plays.
 * Guards as the bombers': nothing in test / debug / walkthrough / ?mission sessions, under reduced motion or
 * MENU BACKGROUND: STILL; a new card, a mission load, leaving the front end, a hidden tab or a reshape end it.
 * @module ui/menu-ground
 */

import { STILL_SCENES } from './menu-model.js';
import { puffSprites } from './menu-bombers.js';
import { SEAT_MIN, variantOrder, FIRE, SWAY, GAITS, MG_BURST, behindBadge, groundPlan, seatGround, soldierAt, tankAt } from './ground-plan.js';

const DATA = {
  temperate: () => import('./ground-data/temperate.js'),
  snow: () => import('./ground-data/snow.js'),
  desert: () => import('./ground-data/desert.js'),
  coast: () => import('./ground-data/coast.js'),
};
const hash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const MASK_W = 1024, MASK_H = 512;    // the masked sprites' cache (a man's pose at his place): device px
const DIE_FALL = 0.3;            // the share of a hit man's 1.3 s that is his fall (the rest: the arms go slack)
/** An act a look was not rendered in falls back to the nearest one it was (the unit tests keep the plans to their looks). */
const FALLBACK = { stand: ['kneel', 'prone'], kneel: ['stand', 'prone'], prone: ['kneel', 'stand'], mg: ['prone'], cover: ['kneel', 'stand'],
  watch: ['cover', 'stand', 'kneel'], reload: ['stand', 'kneel'], throw: ['stand', 'kneel'], point: ['stand', 'kneel'],
  sprint: ['run'], crouch: ['run'], hit: ['die', 'dead'], down: ['prone'] };
const TOL = 0.35;                // m: what is nearer than the actor by more than this hides him
const SOUND = 343;               // m/s: each report is heard its distance later
const MG_RATE = 0.075;           // s between MG rounds; every third a tracer
const ROUND_V = 260;             // m/s a tracer flies (eased for the eye: a few frames across the field)
const MUZZLE = { long: 0.3, smg: 0.24, pistol: 0.15, mg: 0.36 };   // m: a muzzle flash's radius by weapon class
const REPORT = { ally: { long: 'rifle_shot', smg: 'smg_burst', pistol: 'pistol_shot' }, axis: { long: 'rifle_shot', smg: 'mp40_burst', pistol: 'pistol_shot' } };

export class MenuGround {
  /**
   * @param {HTMLCanvasElement} canvas the fight's layer inside the backdrop's scene
   * @param {{audio: () => object|null, still?: () => boolean, visible?: () => boolean, theater?: () => string|null,
   *   grade?: () => string, region?: () => object|null, done?: () => void}} o — region(): {w, h, k, ox, cols, rows,
   *   badge, text} as the dogfight's; grade(): the still's menu grade; done(): a fight has run its course
   */
  constructor(canvas, o) {
    this.canvas = canvas;
    this.o = o;
    this.ctx = canvas.getContext('2d');
    this.alive = !!this.ctx;
    const q = new URLSearchParams(location.search);
    this.blocked = q.get('test') === '1' || q.has('debug') || q.has('walkthrough') || q.has('mission');
    this.running = false;
    this._raf = 0;
    this._f = null;
    this._prep = null;
    this._sets = {};            // per theatre: { data, atlas (image), depth: [{rect, z0, z1, q (Uint8Array), w, h, min}] }
  }

  /** Arm (the front end's still is up). Under reduced motion / STILL: none. */
  start() {
    if (this.o.still?.()) { this.stop(); return; }
    if (!this.alive || this.blocked) return;
    this.running = true;
  }

  stop() {
    this.running = false; this._end();
    if (this._mk?.c) { this._mk.c.width = this._mk.c.height = 1; this._mk = null; }   // the mask cache and scratch go
    this._scratch = null;                                                               // with the front end
  }

  /** The mask cache (a GPU canvas, made at the prefetch: no allocation in a fight's first frame). */
  _maskCache() {
    const M = this._mk || (this._mk = { c: null, g: null, x: 0, y: 0, row: 0, f: null });
    if (!M.c) { M.c = document.createElement('canvas'); M.c.width = MASK_W; M.c.height = MASK_H; M.g = M.c.getContext('2d'); M.f = null; }
    return M;
  }

  /**
   * A new card (or a reshape): the fight in flight ends at once, sounds and all, and so does a staged fight or the field
   * a finished one left; under the change, the next is staged (its first frame: nobody pops in when it starts).
   */
  interrupt() {
    this._end();
    if (this.running) requestAnimationFrame(() => requestAnimationFrame(() => this.stage()));
  }

  dispose() { this.stop(); this.alive = false; }

  resized(w, h) { const f = this._f; if (f && (Math.abs(w - f.w) > 1 || Math.abs(h - f.h) > 0.12 * f.h)) this.interrupt(); }

  /** Whether this theatre has a ground fight at all. */
  has(theater) { return !!DATA[theater]; }

  _end() {
    cancelAnimationFrame(this._raf);
    const f = this._f;
    this._f = null;
    this._prep = null;
    if (f) for (const h of [f.engine, f.tracks]) h?.stop?.(0.4);
    this.canvas.width = this.canvas.height = 1;
    this.canvas.style.visibility = '';
    if (this._mk) this._mk.f = null;                       // (the mask cache is kept for the next fight, cleared then)
  }

  /** Prefetch the theatre's sprites and depth (the director calls this once the menu is up), then stage a fight. */
  prefetch() {
    const th = this.o.theater?.();
    if (th && DATA[th] && !this.blocked) this._load(th).then(() => this.stage(), () => {});
  }

  /**
   * Stage the next fight (the sprites are in, nothing on the field): its plan seated on this screen and its first frame
   * drawn — the defenders at their posts from the moment they could first be drawn, so nobody pops in when it starts.
   */
  stage() {
    if (!this.running || this._f || this._prep || this.o.still?.() || document.hidden || !this.o.visible?.()) return;
    const th = this.o.theater?.();
    if (!DATA[th] || !this._sets[th]?.data) return;
    this._stage(null, false).catch(() => {});
  }

  /**
   * Fight now (also the capture / test hook: hud.backdrop.ground.fight(true, seed)): the staged fight, else the
   * theatre's plan for the seed seated through its still camera on this screen; flown on the animation clock (seek(t)
   * draws any moment instead). A screen that shows too little of it (a portrait phone's badge over the whole bank) or
   * would put an actor over the card's text does not get it; nor does a field a finished fight left (until the scene
   * changes: a new card, a reshape, leaving the front end) — a forced one replaces it.
   * @returns {Promise<boolean>} whether a fight began
   */
  async fight(force = false, seed = null) {
    const ok = () => force || (this.running && !document.hidden && !!this.o.visible?.());
    const th = this.o.theater?.();
    if (!this.alive || this._prep || !DATA[th] || !ok()) return false;
    const g = this._f;
    if (g) {
      if (g.state === 'staged' && !force && (seed == null || seed === g.seed)) {
        // (seated again on the screen as it is now: a card that moved its text since gets a fight staged afresh)
        const R = this.o.region?.(), st = R && seatGround(g.p, g.set.data, R);
        if (st && !st.why && st.seen >= SEAT_MIN && R.w === g.w && R.h === g.h && R.k === g.k && R.ox === g.ox) { this._go(g); return true; }
      } else if (g.state !== 'staged' && !force) return false;   // one in flight, or the field the last one left
      this._end();                                         // (a staged one for another seed: the capture hook's)
    }
    const f = await this._stage(seed, true);
    if (!f || !ok() || this._f !== f) return false;
    this._go(f);
    return true;
  }

  /** Seat a plan for the seed (the seed's variant, else the next that sits; the fallbacks last) and draw its first frame. */
  async _stage(seed, now) {
    const th = this.o.theater?.();
    const prep = this._prep = {}, live = () => this._prep === prep;
    let set;
    try { set = await this._load(th); } catch { if (live()) this._prep = null; return null; }
    const R = live() ? this.o.region?.() : null;
    if (!R) { if (live()) this._prep = null; return null; }
    const sd = seed ?? Math.floor(Math.random() * 2 ** 31);
    let f = null;
    for (const vi of variantOrder(th, sd)) if ((f = this._setup(groundPlan(th, sd, vi), set, R))) break;
    if (!live()) return null;
    this._prep = null;
    if (!f) return null;
    f.state = 'staged';
    this._f = f;
    if (now) this._draw(f, 0);
    else this._reveal(f);
    return f;
  }

  /**
   * The staged first frame, its masks made a few a frame (no long task) with the layer hidden, shown once whole.
   */
  _reveal(f) {
    this.canvas.style.visibility = 'hidden';
    f.cap = 3;
    const step = () => {
      if (this._f !== f || f.state !== 'staged') return;
      this._draw(f, 0);
      if (f.pending) { this._raf = requestAnimationFrame(step); return; }
      f.cap = Infinity;
      this.canvas.style.visibility = '';
    };
    this._raf = requestAnimationFrame(step);
  }

  _go(f) {
    f.state = 'live'; f.cap = Infinity;
    this.canvas.style.visibility = '';
    this._sound(f);
    this._run(f);
  }

  _run(f) {
    let last = performance.now(), acc = 1 / 30;
    f.paused = false;
    const tick = (now) => {
      if (this._f !== f || f.paused) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 1 / 30) { f.t += acc; acc = 0; this._frame(f); }
      if (this._f === f && !f.paused && f.state === 'live') this._raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(tick);
  }

  resume() { if (this._f && this._f.state !== 'over') { this._f.state = 'live'; this._run(this._f); } }

  /** Draw the fight at time t (s) and hold it there (tests, captures). */
  seek(t) {
    const f = this._f;
    if (!f) return null;
    f.paused = true;
    cancelAnimationFrame(this._raf);
    f.t = t; f.cap = Infinity;
    this.canvas.style.visibility = '';
    this._draw(f, Math.min(t, f.end - 1e-3));             // (past the end: the field as it is left)
    return f;
  }

  _frame(f) {
    if (f.t >= f.end) { this._over(f); return; }
    this._draw(f, f.t);
    this._audio(f, f.t);
  }

  /**
   * The fight is over (the tank has left the frame): its field is drawn once as it stands — the dead down, the living at
   * their posts — and left there, still, until the scene changes; the loops stop, the director is told.
   */
  _over(f) {
    cancelAnimationFrame(this._raf);
    f.state = 'over';
    f.t = f.end;
    this._draw(f, f.end - 1e-3);
    for (const h of [f.engine, f.tracks]) h?.stop?.(0.4);
    this.o.done?.();
  }

  /** A world point on the screen: [css x, css y, view depth (m)] through the still camera and the still's cover. */
  _proj(f, x, y, z) {
    const m = f.vp, cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [f.ox + (cx / cw + 1) * 960 * f.k, (1 - cy / cw) * 540 * f.k, cw];
  }

  /**
   * Seat a plan on this screen: the still's cover (as the backdrop draws it), every actor sampled through the fight;
   * out if one would cross the card's text or if too little of it shows (off the screen, behind the badge). The canvas
   * covers what the fight touches.
   */
  _setup(p, set, R) {
    const { w, h, k, ox } = R;
    const st = seatGround(p, set.data, R);
    this.lastSeen = st.seen ?? null;
    this.why = st.why || (st.seen < SEAT_MIN ? `seen ${st.seen.toFixed(2)}` : null);
    if (st.why || st.seen < SEAT_MIN) return null;
    const f = { p, set, w, h, k, ox, vp: set.data.vp, p11: set.data.p11, t: 0, end: p.end ?? p.dur, paused: false,
      dpr: Math.min(devicePixelRatio || 1, 2, 2880 / w), seed: p.seed, heard: new Set(), seen: st.seen, box: st.box, R,
      masked: new Map(), mc: new Map(), pose: new Map(), fresh: 0, odo: null };
    // the MGs: the pillbox's (its embrasure flickers) and any prone MG34 team's gunner (his own muzzle flashes)
    f.mgs = p.mg ? [{ at: p.mg.at, bursts: p.mg.bursts, emb: true }] : [];
    for (const s of p.soldiers) {
      const b = s.shots.filter((sh) => sh.pose === 'mg');
      if (!b.length) continue;
      const hd = Math.atan2(b[0].to[0] - b[0].from[0], b[0].to[2] - b[0].from[2]);
      f.mgs.push({ s, at: [s.at[0] + Math.sin(hd) * 1.1, 0.32, s.at[2] + Math.cos(hd) * 1.1], bursts: b.map((sh) => ({ t: sh.t, dur: MG_BURST, target: sh.to })) });
    }
    const cs = this.canvas.style;
    cs.left = `${f.box.x}px`; cs.top = `${f.box.y}px`; cs.width = `${f.box.w}px`; cs.height = `${f.box.h}px`;
    this.canvas.width = Math.round(f.box.w * f.dpr); this.canvas.height = Math.round(f.box.h * f.dpr);
    const th = this.o.theater?.() || 'temperate';
    this._puffs = this._puffs || {};
    if (!this._puffs[th]) {
      this._puffs[th] = puffSprites((STILL_SCENES[th] || STILL_SCENES.temperate).dust);
      this._puffs[th].earth = puffSprites([40, 33, 26]).dust;   // a shell's thrown earth, darker than the ground
    }
    f.puffs = this._puffs[th];
    return f;
  }

  _draw(f, t) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';   // the atlas drawn down to a phone's 18 px men
    f.pose.clear();
    f.fresh = 0; f.pending = false;
    const list = [];
    for (const s of f.p.soldiers) {
      const a = soldierAt(s, t, f.end);
      if (a) list.push({ s, a, xy: this._proj(f, a.p[0], a.p[1], a.p[2]) });
    }
    const tk = f.p.tank && tankAt(f.p.tank, t);
    if (tk) list.push({ tank: tk, a: { alpha: 1 }, xy: this._proj(f, tk.p[0], tk.p[1], tk.p[2]) });
    list.sort((a, b) => b.xy[2] - a.xy[2]);               // the further first
    this._fxBack(f, t);
    for (const it of list) this._actor(f, it);
    f.odo = tk ? tk.odo : null;                            // (the tank moved since: masked afresh)
    this._fxFront(f, t);
  }

  /** An actor's cell: his clip in the heading nearest his own (as rendered around the still camera) and its frame. */
  _cell(f, it) {
    const D = f.set.data;
    if (it.tank) {
      const k = it.tank, V = D.vehicle;
      if (k.recoil > 0) return D.cells[k.recoil > 0.5 ? 'veh_fire_0' : 'veh_fire_1'];
      const yd = k.yaw * 180 / Math.PI;
      if (yd > 0.5) {
        let best = 0;
        V.turret.forEach((y, i) => { if (Math.abs(y - yd) < Math.abs(V.turret[best] - yd)) best = i; });
        if (best > 0) return D.cells[`veh_turret_${best}`];
      }
      const set = V.also && k.odo >= V.also.from ? `veh_${V.also.key}_drive_` : 'veh_drive_';   // seen from the road's far end
      return D.cells[`${set}${Math.floor((((k.odo % 0.48) + 0.48) % 0.48) / 0.12) % 4}`];
    }
    const a = it.a, L = D.looks[it.s.look];
    if (!L) return null;
    // a man who is hit goes down first (the 'down' clip: he pitches forward to the ground), then his arms go slack
    // (a German's own die clip has his fall in it: straight through)
    const df = L.fall ? DIE_FALL : 0, fall = a.act === 'die' && a.phase < df, act0 = fall ? 'down' : a.act;
    const ph = fall ? a.phase / df : a.act === 'die' ? (a.phase - df) / (1 - df) : a.phase;
    let act = act0;
    for (const alt of [act0, ...(FALLBACK[act0] || [])]) if (L.acts[alt]) { act = alt; break; }
    const c = L.acts[act];
    if (!c) return null;
    const rel = ((((D.away - a.h) * 180 / Math.PI) % 360) + 360) % 360;
    let hd = c.headings[0];
    for (const x of c.headings) { const d = Math.abs(((x - rel + 540) % 360) - 180); if (d < Math.abs(((hd - rel + 540) % 360) - 180)) hd = x; }
    const n = c.frames;
    const k = GAITS[act] ? Math.round(ph * n) % n
      : FIRE.has(act) ? Math.min(n - 1, a.frame === 'shot' ? 1 : a.frame === 'aim2' ? 2 : 0)
        : SWAY.has(act) ? Math.min(n - 1, a.frame === 'b' ? 1 : 0)
          : act === 'dead' ? 0 : Math.min(n - 1, Math.floor(ph * n));
    return D.cells[`${it.s.look}_${hd}_${act}_${k}`];
  }

  /**
   * One actor at its depth's scale, hidden pixel by pixel behind the still's nearer parts (its depth regions): most
   * sprites have nothing nearer in their box (the blocks' nearest values say so) and go straight on.
   */
  _actor(f, it) {
    const cell = this._cell(f, it);
    if (!cell) return;
    const [x, y, z] = it.xy, D = f.set.data, k = f.k, d = f.dpr;
    const s = (f.p11 * 540 / z) / cell[6] / D.scale * k;   // css px per atlas px
    const dw = Math.max(1, Math.round(cell[2] * s * d)), dh = Math.max(1, Math.round(cell[3] * s * d));
    const dx = Math.round((x - cell[4] * s - f.box.x) * d), dy = Math.round((y - cell[5] * s - f.box.y) * d);
    if (dx > this.canvas.width || dy > this.canvas.height || dx + dw < 0 || dy + dh < 0 || it.a.alpha <= 0.01) return;
    const bx = f.box.x + dx / d, by = f.box.y + dy / d;
    if (behindBadge(f.R, bx, by, bx + dw / d, by + dh / d)) return;   // hidden there anyway (and the card's text is on it)
    const { ctx } = this;
    ctx.globalAlpha = it.a.alpha;
    f.pose.set(it.s || 'tank', { cell, x, y, s });                 // where he is drawn (his muzzle's flash, a throw's release)
    const occ = this._occluders(f, dx, dy, dw, dh, z - TOL);
    if (!it.tank && !(occ && this._nearer(occ, (x - f.ox) / k, y / k))) {   // the contact darkening under him (his sun
      const m = f.p11 * 540 / z * k * d, lying = /prone|dead|down|die|hit|mg/.test(it.a.act);   // shadow is in his sprite),
      ctx.fillStyle = 'rgba(24,21,16,0.16)';                                       // unless his feet are behind something
      ctx.beginPath(); ctx.ellipse((x - f.box.x) * d, (y - f.box.y) * d, (lying ? 0.75 : 0.3) * m, 0.09 * m, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (!occ) {
      ctx.drawImage(f.set.atlas, cell[0], cell[1], cell[2], cell[3], dx, dy, dw, dh);
      f.masked.set(it.s || 'tank', { clear: true, rect: [dx, dy, dw, dh] });   // nothing nearer in his box
    } else {
      // an actor standing at the same place in the same pose (a man firing, the tank at a halt) is masked once into the
      // fight's mask cache (one large canvas, drawn from like the atlas); one on the move (new pixels every frame) is
      // masked into the scratch canvas and drawn from there
      const moving = it.tank ? it.tank.odo !== f.odo : !!GAITS[it.a.act];
      const key = `${cell[0]},${cell[1]},${dx},${dy},${dw},${dh},${Math.round(z * 10)}`;
      let e = moving ? null : f.mc.get(key);
      if (!e) {
        // (the fight's first frames, everyone fading in at once: a few masks a frame, no long task on a phone)
        if (f.fresh >= (f.cap ?? Infinity)) { f.pending = true; ctx.globalAlpha = 1; return; }   // (staging: a few a frame)
        f.fresh++;
        e = this._mask(f, cell, occ, dx, dy, dw, dh, !moving);
        if (!moving) f.mc.set(key, e);
      }
      f.masked.set(it.s || 'tank', { opaque: e.opaque, hidden: e.hidden, rect: [dx, dy, dw, dh] });   // (the tests read it)
      ctx.drawImage(e.c, e.x, e.y, dw, dh, dx, dy, dw, dh);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The actor's cell cut pixel by pixel where the still has something nearer than him (his shadow too), in the scratch
   * canvas; `keep`: copied into the fight's mask cache (shelf-packed; full, it starts over). @returns {{c, x, y, opaque, hidden}}
   */
  _mask(f, cell, occ, dx, dy, dw, dh, keep) {
    const d = f.dpr, k = f.k;
    let c = this._scratch;
    if (!c || c.width < dw || c.height < dh) {                     // CPU-backed: read back and written every mask
      c = this._scratch = document.createElement('canvas');
      c.width = Math.max(dw, c?.width || 0, 128); c.height = Math.max(dh, c?.height || 0, 128);
    }
    const g = c.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, dw, dh);
    g.imageSmoothingQuality = 'high';
    g.drawImage(f.set.atlas, cell[0], cell[1], cell[2], cell[3], 0, 0, dw, dh);
    const im = g.getImageData(0, 0, dw, dh), px = im.data;
    let opaque = 0, hidden = 0;
    for (let j = 0; j < dh; j++) {
      const v = (f.box.y + (dy + j + 0.5) / d) / k;
      for (let i = 0; i < dw; i++) {
        const o = (j * dw + i) * 4, a = px[o + 3];
        if (!a) continue;
        if (a >= 128) opaque++;
        const u = (f.box.x + (dx + i + 0.5) / d - f.ox) / k;
        if (this._nearer(occ, u, v)) { px[o + 3] = 0; if (a >= 128) hidden++; }
      }
    }
    g.putImageData(im, 0, 0);
    if (!keep) return { c, x: 0, y: 0, opaque, hidden };
    const M = this._maskCache();
    if (M.f !== f) { M.g.clearRect(0, 0, MASK_W, MASK_H); M.x = M.y = M.row = 0; M.f = f; f.mc.clear(); }   // a new fight's
    if (M.x + dw > MASK_W) { M.x = 0; M.y += M.row + 1; M.row = 0; }
    if (M.y + dh > MASK_H) { M.g.clearRect(0, 0, MASK_W, MASK_H); M.x = M.y = M.row = 0; f.mc.clear(); }   // full: start over
    const x = M.x, y = M.y;
    M.g.drawImage(c, 0, 0, dw, dh, x, y, dw, dh);
    M.x += dw + 1; M.row = Math.max(M.row, dh);
    return { c: M.c, x, y, opaque, hidden };
  }

  /** The depth regions under a sprite's device box that hold something nearer than z, with z's threshold in each. */
  _occluders(f, dx, dy, dw, dh, z) {
    const k = f.k, d = f.dpr, out = [];
    const u0 = (f.box.x + dx / d - f.ox) / k, u1 = (f.box.x + (dx + dw) / d - f.ox) / k;
    const v0 = (f.box.y + dy / d) / k, v1 = (f.box.y + (dy + dh) / d) / k;
    for (const r of f.set.depth) {
      if (u1 < r.x0 || u0 >= r.x0 + r.w || v1 < r.y0 || v0 >= r.y0 + r.h) continue;
      // (255 holds "further than z1, or sky": a man or the tank beyond the region's range is hidden only by what is in it)
      const thr = Math.min(255, Math.floor((z - r.z0) / (r.z1 - r.z0) * 254));
      if (thr <= 0) continue;                             // nearer than all of the region: nothing there hides him
      const bx0 = Math.max(0, Math.floor((u0 - r.x0) / 16)), bx1 = Math.min(r.bw - 1, Math.floor((u1 - r.x0) / 16));
      const by0 = Math.max(0, Math.floor((v0 - r.y0) / 16)), by1 = Math.min(Math.ceil(r.h / 16) - 1, Math.floor((v1 - r.y0) / 16));
      let any = false;
      for (let by = by0; by <= by1 && !any; by++) for (let bx = bx0; bx <= bx1; bx++) if (r.min[by * r.bw + bx] < thr) { any = true; break; }
      if (any) out.push({ r, thr });
    }
    return out.length ? out : null;
  }

  /** Whether the still has something nearer than the actor at still px (u, v). */
  _nearer(occ, u, v) {
    for (const { r, thr } of occ) {
      const x = Math.floor(u - r.x0), y = Math.floor(v - r.y0);
      if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
      if (r.q[y * r.w + x] < thr) return true;
    }
    return false;
  }

  /** css px per metre at view depth z. */
  _pxm(f, z) { return f.p11 * 540 / z * f.k; }

  _puff(img, x, y, size, rot, a) {
    if (a <= 0.004 || size < 0.6) return;
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /** Device px of a world point in this canvas, and its depth. */
  _dev(f, x, y, z) { const [a, b, w] = this._proj(f, x, y, z); return [(a - f.box.x) * f.dpr, (b - f.box.y) * f.dpr, w]; }

  /**
   * Behind the men: the shells' and the grenades' bursts on the ground — a flash, earth and smoke thrown up and
   * drifting off, a dust skirt, clods — to the scene's scale (a 75 mm high-explosive shell: a few metres of earth, no
   * fireball by day; a hand grenade about half that).
   */
  _fxBack(f, t) {
    for (const [n, sh] of f.p.shells.entries()) this._burst(f, sh.target, t - (sh.t + sh.flight), n, 1);
    for (const [n, g] of (f.p.nades || []).entries()) this._burst(f, g.to, t - (g.t + g.flight), 40 + n, 0.5);
  }

  /** One burst `a` s after it, at world point `target`; sc: its size (1 = the tank's shell). */
  _burst(f, target, a, n, sc) {
    if (a < 0 || a > 7 * sc + 1) return;
    const { ctx } = this, P = f.puffs;
    const [x, y, z] = this._dev(f, ...target), m = this._pxm(f, z) * f.dpr, R = 1.6 * m * sc, rs = Math.sqrt(sc);
    const g = 9.8 * m;                                  // gravity, device px / s^2
    if (a < 0.14) {                                     // the flash, an orange core at the ground
      const q = a / 0.14, r = R * (1.1 + 1.6 * q), cy = y - 0.35 * R, gr = ctx.createRadialGradient(x, cy, 0, x, cy, r);
      gr.addColorStop(0, `rgba(255,240,210,${0.95 * (1 - q)})`); gr.addColorStop(0.35, `rgba(255,170,80,${0.7 * (1 - q)})`);
      gr.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(x - r, cy - r, 2 * r, 2 * r);
      ctx.globalCompositeOperation = 'source-over';
    }
    for (let i = 0; i < 10; i++) {                      // the dust and smoke: thrown up, billowing, drifting off
      const h1 = hash(f.seed + n * 31 + i), h2 = hash(f.seed + n * 17 + i * 3.1), b = a - 0.04 - 0.025 * i;
      if (b < 0) continue;
      const climb = 1 - Math.exp(-b * 2.2), up = (0.25 + 0.26 * i) * R * climb + 0.1 * R * b;
      const px = x + (h1 - 0.5) * R * (0.5 + 0.1 * i) * (0.6 + climb) + 0.45 * m * b, py = y - 0.25 * R - up;
      const size = R * (0.6 + 0.09 * i) * (0.7 + 0.8 * climb) * (1 + 0.07 * b);
      const al = Math.min(1, b / 0.1) * Math.max(0, 1 - Math.max(0, b - 1.6 * sc) / (5 * sc)) * (0.85 - 0.035 * i);
      this._puff(P.dust[i % 2], px, py, size, h2 * 6.28, al);
    }
    for (let i = 0; i < 7; i++) {                       // the fountain of earth, darker than the ground it leaves
      const h1 = hash(f.seed + n * 41 + i * 2.3), b = a - 0.01 * i, v = (3.5 + 5.5 * h1) * m * rs;
      if (b < 0 || b > 1.7) continue;
      const up = Math.max(0, v * b - 0.5 * g * b * b), px = x + (hash(f.seed + n * 43 + i) - 0.5) * R * (0.4 + 1.2 * b);
      const al = Math.min(1, b / 0.05) * Math.max(0, 1 - Math.max(0, b - 0.5) / 1.2) * 0.9;
      this._puff(P.earth[i % 2], px, y - 0.2 * R - up, R * (0.55 + 0.35 * h1) * (1 + 0.9 * b), h1 * 6.28, al);
    }
    for (let i = 0; i < (sc < 1 ? 0 : 4); i++) {         // the dust skirt along the ground (a shell's)
      const side = i % 2 ? 1 : -1, q = 1 - Math.exp(-a * 2.4), h1 = hash(f.seed + n * 7 + i);
      this._puff(P.dust[i % 2], x + side * (1.0 + 1.4 * h1) * R * q, y - 0.12 * R, R * (0.9 + 1.3 * q), h1 * 6, 0.5 * Math.max(0, 1 - a / (4 * sc)));
    }
    if (a < 1.3) {                                      // clods: ragged specks of earth on their arcs
      ctx.fillStyle = `rgba(36,29,22,${Math.min(0.95, 1.5 - a)})`;
      for (let i = 0; i < Math.round(16 * sc); i++) {
        const h1 = hash(f.seed + n * 3 + i), h2 = hash(f.seed + i * 5 + n), an = -Math.PI / 2 + (h1 - 0.5) * 2.0, v = (4 + 7 * h2) * m * rs;
        const px = x + Math.cos(an) * v * a, py = y - 0.2 * R + Math.sin(an) * v * a + 0.5 * g * a * a;
        if (py > y + 0.1 * R) continue;
        const r0 = Math.max(0.7 * f.dpr, (0.05 + 0.09 * hash(f.seed + i * 7.7)) * m);
        ctx.beginPath(); ctx.ellipse(px, py, r0, r0 * (0.55 + 0.4 * h2), h1 * 6.28 + a * 9, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /** A man's muzzle on the screen as he is drawn now (device px), from his sprite's own muzzle point; else null. */
  _muzzle(f, s) {
    const q = f.pose.get(s), c = q?.cell;
    if (!c || c[7] == null) return null;
    return [(q.x + (c[7] - c[4]) * q.s - f.box.x) * f.dpr, (q.y + (c[8] - c[5]) * q.s - f.box.y) * f.dpr];
  }

  /**
   * In front of the men: muzzle flashes at each gun's own muzzle (a rifle's, a Thompson's or MP40's, a pistol's, the
   * MG's flicker), the MGs' tracers (every third round), dust kicked up where the rounds land, grenades in the air,
   * and the tank gun's flash, blast dust and smoke.
   */
  _fxFront(f, t) {
    const { ctx } = this, P = f.puffs, D = f.set.data;
    const flash = (x, y, r, a) => {
      if (a <= 0.01) return;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,248,215,${a})`); gr.addColorStop(0.35, `rgba(255,196,96,${0.65 * a})`); gr.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.globalCompositeOperation = 'source-over';
    };
    const kick = (wx, wy, wz, age, seed, size = 0.6) => {   // a round's dust where it lands
      if (age < 0 || age > 0.7) return;
      const [x, y, z] = this._dev(f, wx, wy, wz), m = this._pxm(f, z) * f.dpr;
      this._puff(P.dust[seed & 1], x, y - (0.15 + 0.5 * age) * m, (size + 0.9 * age) * m, seed, 0.75 * (1 - age / 0.7));
    };
    for (const [n, s] of f.p.soldiers.entries()) {
      const w = D.looks[s.look]?.w || 'long';
      for (const [i, sh] of s.shots.entries()) {
        const a = t - sh.t, seed = f.seed + n * 101 + i * 7.3;
        if (sh.pose !== 'mg' && a >= 0 && a < 0.09) {        // the muzzle flash, at his gun's muzzle as drawn
          const hd = Math.atan2(sh.to[0] - sh.from[0], sh.to[2] - sh.from[2]), up = sh.pose === 'prone' ? 0.28 : sh.pose === 'kneel' ? 1.05 : 1.42;
          const [wx, wy, wz] = this._dev(f, sh.from[0] + Math.sin(hd) * 0.75, up, sh.from[2] + Math.cos(hd) * 0.75);
          const mz = this._muzzle(f, s) || [wx, wy];
          flash(mz[0], mz[1], Math.max(1.6 * f.dpr, MUZZLE[w] * this._pxm(f, wz) * f.dpr), 1 - a / 0.09);
        }
        const tx = sh.to[0] + (hash(seed) - 0.5) * 2.6, tz = sh.to[2] + (hash(seed + 1) - 0.5) * 2.6;
        if (sh.pose !== 'mg') kick(tx, s.side === 'ally' ? 0.4 + 0.5 * hash(seed + 2) : 0, tz, a - 0.08, seed, s.side === 'ally' ? 0.45 : 0.6);
      }
      if (s.segs.some((g) => g.act === 'mg')) {              // an MG gunner's flicker through his burst
        const st = soldierAt(s, t, f.end), mz = st?.frame === 'shot' && this._muzzle(f, s);
        if (mz) flash(mz[0], mz[1], Math.max(2 * f.dpr, MUZZLE.mg * this._pxm(f, this._proj(f, ...st.p)[2]) * f.dpr), 0.95);
      }
    }
    for (const [b, E] of f.mgs.entries()) {                   // every MG's rounds: tracers and their dust
      for (const [j, B] of E.bursts.entries()) {
        if (t < B.t || t > B.t + B.dur + 0.8) continue;
        for (let i = 0; i * MG_RATE < B.dur; i++) {
          const te = B.t + i * MG_RATE, a = t - te, seed = f.seed + b * 211 + j * 53 + i * 1.7;
          if (a < 0) break;
          const tx = B.target[0] + (hash(seed) - 0.5) * 4, tz = B.target[2] + (hash(seed + 1) - 0.5) * 4, at = E.at;
          const L = Math.hypot(tx - at[0], tz - at[2]), fl = L / ROUND_V;
          if (i % 3 === 0 && a < fl) {                       // a tracer: a hot head and a fading streak behind it
            const p1 = a / fl, p0 = Math.max(0, p1 - 2.2 / L);
            const P0 = [at[0] + (tx - at[0]) * p0, at[1] * (1 - p0), at[2] + (tz - at[2]) * p0];
            const P1 = [at[0] + (tx - at[0]) * p1, at[1] * (1 - p1), at[2] + (tz - at[2]) * p1];
            const [x0, y0] = this._dev(f, ...P0), [x1, y1, z1] = this._dev(f, ...P1), wd = Math.max(0.9 * f.dpr, 0.05 * this._pxm(f, z1) * f.dpr);
            const gr = ctx.createLinearGradient(x0, y0, x1, y1);
            gr.addColorStop(0, 'rgba(255,90,30,0)'); gr.addColorStop(0.7, 'rgba(255,130,50,0.55)'); gr.addColorStop(1, 'rgba(255,226,170,0.95)');
            ctx.lineCap = 'round'; ctx.strokeStyle = gr; ctx.lineWidth = wd; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            flash(x1, y1, 2.2 * wd, 0.7);                      // its glow
          }
          if (i % 2 === 0) kick(tx, 0, tz, a - fl, seed);
        }
        if (E.emb && t < B.t + B.dur && hash(Math.floor(t * 30) + b) > 0.3) {   // the pillbox's embrasure flickers
          const [x, y, z] = this._dev(f, ...E.at);
          flash(x, y, Math.max(2, 0.4 * this._pxm(f, z) * f.dpr), 0.9);
        }
      }
    }
    for (const g of f.p.nades || []) {                       // a grenade in the air: a dark speck on its arc
      const u = (t - g.t) / g.flight;
      if (u < 0 || u >= 1) continue;
      const x0 = g.from[0] + Math.sin(g.h) * 0.35, z0 = g.from[2] + Math.cos(g.h) * 0.35, L = Math.hypot(g.to[0] - x0, g.to[2] - z0);
      const H = 1.4 + 0.12 * L, wp = (v) => [x0 + (g.to[0] - x0) * v, 1.75 * (1 - v) + (g.to[1] || 0) * v + 4 * H * v * (1 - v), z0 + (g.to[2] - z0) * v];
      const [x, y, z] = this._dev(f, ...wp(u)), [xb, yb] = this._dev(f, ...wp(Math.max(0, u - 0.06))), m = this._pxm(f, z) * f.dpr;
      ctx.strokeStyle = 'rgba(30,26,20,0.35)'; ctx.lineWidth = Math.max(0.7 * f.dpr, 0.05 * m); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xb, yb); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = 'rgba(24,22,18,0.95)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.9 * f.dpr, 0.08 * m), 0, Math.PI * 2); ctx.fill();
    }
    const k = f.p.tank;
    for (const [n, sh] of (f.p.shells || []).entries()) {   // the tank gun: flash, the blast's dust, its smoke
      const a = t - sh.t;
      if (a < 0 || a > 4) continue;
      const st = tankAt(k, sh.t), hd = st.h + st.yaw;
      const mx = st.p[0] + Math.sin(hd) * 3.4, my = st.p[1] + 1.95, mz = st.p[2] + Math.cos(hd) * 3.4;
      const [x, y, z] = this._dev(f, mx, my, mz), m = this._pxm(f, z) * f.dpr;
      if (a < 0.15) flash(x, y, 1.9 * m, Math.min(1, 1.5 * (1 - a / 0.15)));   // about four frames at the fight's 30 Hz
      for (let i = 0; i < 5; i++) {                       // the smoke ring and its cloud, drifting off
        const h1 = hash(f.seed + n * 13 + i), q = 1 - Math.exp(-a * 3);
        const px = x + Math.sin(hd) * (0.6 + 1.6 * q) * m * (i / 4) + (h1 - 0.5) * m * q + 0.4 * m * a, py = y - (0.2 + 0.5 * a) * m * (0.4 + h1);
        this._puff(P.dark[i % 2], px, py, (1.1 + 2.4 * q) * m, h1 * 6, 0.55 * Math.min(1, a / 0.1) * Math.max(0, 1 - a / 4) * (1 - 0.1 * i));   // the smoke comes up after the flash
      }
      for (let i = 0; i < 4; i++) {                       // the blast's dust off the deck
        const side = i % 2 ? 1 : -1, q = 1 - Math.exp(-a * 3.5), h1 = hash(f.seed + n * 5 + i * 2);
        const [gx, gy] = this._dev(f, st.p[0] + side * (1.5 + 2 * q), st.p[1] + 0.2, st.p[2] + (h1 - 0.5) * 3);
        this._puff(P.dust[i % 2], gx + Math.sin(hd) * m, gy, (1.2 + 2 * q) * m, h1 * 6, 0.45 * Math.max(0, 1 - a / 1.6));
      }
    }
  }

  /** The fight's loops: the tank's engine and tracks (silent until it is heard). */
  _sound(f) {
    const a = this.o.audio?.();
    if (!a?.unlocked || !a.playSfx) return;
    f.audio = a;
    if (f.p.tank) {
      f.engine = a.playSfx('tank_engine', null, { loop: true, gain: 0.0001, rate: 0.9, muffle: true }) || null;
      f.tracks = a.playSfx('tank_tracks', null, { loop: true, gain: 0.0001, rate: 0.85, muffle: true }) || null;
    }
  }

  /**
   * Per frame: each report heard its distance after the flash (rifle, MG burst, the tank gun, the shell's crump), all
   * muffled and quiet; the tank's engine and tracks louder while it drives, nearer, and gone with it.
   */
  _audio(f, t) {
    const a = f.audio;
    if (!a) return;
    const once = (key, at, fn) => { if (!f.heard.has(key) && t >= at) { f.heard.add(key); if (t < at + 0.6) fn(); } };
    const D = f.set.data;
    for (const [n, s] of f.p.soldiers.entries()) {
      const id = REPORT[s.side]?.[D.looks[s.look]?.w || 'long'] || 'rifle_shot';
      for (const [i, sh] of s.shots.entries()) {
        if (sh.pose === 'mg') continue;                       // (an MG's bursts: below)
        const z = this._proj(f, ...sh.from)[2];
        once(`s${n}.${i}`, sh.t + z / SOUND, () => a.playSfx(id, null, { gain: id === 'pistol_shot' ? 0.035 : 0.045, rate: 0.85 + 0.25 * hash(sh.t), muffle: true, dedupe: 0 }));
      }
    }
    for (const [e, E] of (f.mgs || []).entries()) {
      const z = this._proj(f, ...E.at)[2];
      for (const [b, B] of E.bursts.entries()) {
        once(`m${e}.${b}`, B.t + z / SOUND, () => a.playSfx('mg_burst', null, { gain: 0.06, rate: 0.85 + 0.2 * hash(B.t), muffle: true, dedupe: 0 }));
      }
    }
    for (const [n, g] of (f.p.nades || []).entries()) {
      const z = this._proj(f, ...g.to)[2];
      once(`n${n}`, g.t + g.flight + z / SOUND, () => a.playSfx('explosion_grenade', null, { gain: 0.08, rate: 0.95, muffle: true, dedupe: 0 }));
    }
    for (const [n, sh] of (f.p.shells || []).entries()) {
      const st = tankAt(f.p.tank, sh.t), zg = this._proj(f, ...st.p)[2], zi = this._proj(f, ...sh.target)[2];
      once(`g${n}`, sh.t + zg / SOUND, () => a.playSfx('tank_cannon', null, { gain: 0.12, rate: 0.8, muffle: true, dedupe: 0 }));
      once(`i${n}`, sh.t + sh.flight + zi / SOUND, () => a.playSfx('explosion_far', null, { gain: 0.11, rate: 0.95, muffle: true, dedupe: 0 }));
    }
    const k = f.p.tank && tankAt(f.p.tank, t), k0 = f.p.tank && tankAt(f.p.tank, t - 0.2);
    const moving = k && k0 ? Math.abs(k.odo - k0.odo) > 0.05 : false, near = k ? Math.min(1, 110 / this._proj(f, ...k.p)[2]) : 0;
    const fade = 1;
    const ge = k ? (moving ? 0.05 : 0.025) * near * fade : 0, gt = k && moving ? 0.04 * near * fade : 0;
    if (f.engine && !f.engine.ended && Math.abs(ge - (f.ge ?? -1)) > 0.002) { f.engine.setGain(ge); f.ge = ge; }
    if (f.tracks && !f.tracks.ended && Math.abs(gt - (f.gt ?? -1)) > 0.002) { f.tracks.setGain(gt); f.gt = gt; }
  }

  /** The theatre's sprites and depth, fetched at low priority (the menu is up by now) and decoded once. */
  async _load(th) {
    if (this._sets[th]) return this._sets[th].ready;
    const set = this._sets[th] = {};
    set.ready = (async () => {
      const data = (await DATA[th]()).default;
      const img = (url) => new Promise((res, rej) => {
        const im = new Image();
        im.decoding = 'async'; im.fetchPriority = 'low';
        im.onload = () => res(im); im.onerror = rej;
        im.src = url;
      });
      const [atlas, ...depths] = await Promise.all([img(data.atlas.url), ...data.depth.map((d) => img(d.url))]);
      set.data = data;
      const later = () => new Promise((res) => setTimeout(res, 0));   // one region per task: no long task on a phone
      const gc = document.createElement('canvas');           // through the still's own menu grade, like the still
      gc.width = atlas.width; gc.height = atlas.height;
      const gg = gc.getContext('2d'), gf = this.o.grade?.();
      if (gf) gg.filter = gf;
      for (let y = 0; y < atlas.height; y += 256) {          // (in bands, a task each: the grade is per pixel)
        if (y) await later();
        const hh = Math.min(256, atlas.height - y);
        gg.drawImage(atlas, 0, y, atlas.width, hh, 0, y, atlas.width, hh);
      }
      set.atlas = gc;
      await later();                                         // its first draw (an upload, a decode) here, not in a fight's first frame
      const wc = document.createElement('canvas'); wc.width = wc.height = 2;
      wc.getContext('2d').drawImage(gc, 0, 0, 2, 2, 0, 0, 2, 2);
      await later();
      this._maskCache();
      if (!this._scratch) { const sc = this._scratch = document.createElement('canvas'); sc.width = 256; sc.height = 256; sc.getContext('2d', { willReadFrequently: true }); }
      set.depth = [];
      for (const [i, d] of data.depth.entries()) {
        await later();
        const [x0, y0, x1, y1] = d.rect, w = x1 - x0, h = y1 - y0, c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(depths[i], 0, 0);
        const px = g.getImageData(0, 0, w, h).data, q = new Uint8Array(w * h);
        for (let k = 0; k < w * h; k++) q[k] = px[k * 4];
        // the nearest value in each 16 x 16 block: most sprites need no per-pixel test at all
        const bw = Math.ceil(w / 16), bh = Math.ceil(h / 16), min = new Uint8Array(bw * bh).fill(255);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const b = (y >> 4) * bw + (x >> 4); if (q[y * w + x] < min[b]) min[b] = q[y * w + x]; }
        set.depth.push({ ...d, x0, y0, w, h, q, min, bw });
      }
      this._puffs = this._puffs || {};                        // the burst's and the guns' puffs, here and not at the fight's start
      if (!this._puffs[th]) {
        await later();
        const pf = puffSprites((STILL_SCENES[th] || STILL_SCENES.temperate).dust);
        await later();
        pf.earth = puffSprites([40, 33, 26]).dust;             // a shell's thrown earth, darker than the ground
        this._puffs[th] = pf;
      }
      return set;
    })();
    try { return await set.ready; } catch (e) { delete this._sets[th]; throw e; }
  }
}
