/**
 * Video mode (debug/walkthrough.js): the Sniper's scope before every sniper shot (user 2026-10-22: "In the walk-through
 * we should see rhe sniper scope moving around before sniper hits target"). The player's own scope — the 88-px ring,
 * its reticle and range read-out (ui/cursor.js) over the live 2× lens (render/scope-magnifier.js) — aimed by the
 * walkthrough instead of the mouse, the way a player would aim it:
 *  - the scope comes up off the man (about three glass radii away), drifts and searches round him, finds him, overshoots
 *    a little and settles on him with a breathing sway and a hand's tremor (the lens marks him as a valid shot does once
 *    the reticle is on him); a beat on him, then the shot — the recoil throws the view up with a flash, it comes back down
 *    on him as he falls — then the scope comes down;
 *  - a second shot right after (M2: e4 at the rocks, e5 on the wall walk 1.1 s later) is the same sequence: the scope stays
 *    up while the bolt is worked and swings from the first man to the second.
 * It is set off by the sniper's own order and his ability:start (the target is the order's: no per-mission script), ends at
 * the `shot` his rifle fires, and never touches the simulation: the shot is the scripted run's tick. What it needs in wall
 * time comes from the pace, as the action holds' does (debug/action-hold.js): the clock is slowed (pacer.boost capped:
 * the same ticks in the same order, only spread over more frames) so that the shot lands SCOPE_SHOW.shot s of wall time
 * after the scope came up — ~2.4 s for the whole sequence in AUTO, shorter at the faster fixed speeds (showScale: 4×
 * ~1.3 s). A jump, a scrub or a skipped wait (fast-forward) never shows it: it ends at once and the pace is the jump's.
 * The lens programs are compiled at the walkthrough's start when the squad has a rifle (warmScope: no compile mid-play).
 * The aim path is pure (aimPath; tests/unit/walkthrough-scope.test.mjs).
 * @module debug/walkthrough-scope
 */

import * as THREE from 'three';
import { compileAhead } from '../engine/parallel-compile.js';
import { ScopeMagnifier, glassRadius } from '../render/scope-magnifier.js';
import { spring } from './walkthrough-director.js';

/** Timings (wall s at AUTO; scaled by showScale at the faster fixed speeds) and sizes (glass radii). */
export const SCOPE_SHOW = Object.freeze({
  /** The scope comes up: it rises into place this long. */
  up: 0.2,
  /** The first man: the search ends on him at `find`, the shot at `shot` (the beat on him between). */
  find: 1.0, shot: 1.5,
  /** A man right after another: the swing ends on him at `swingFind`, the shot at `swingShot` after the order. */
  swingFind: 0.55, swingShot: 1.05,
  /** After the shot: on the man as he falls (and while the bolt is worked: a second shot may follow), then down. */
  post: 0.7, drop: 0.22,
  /** The slowest the clock is slowed to, and the pace right after the shot (eased back up by the end of `post`). */
  minRate: 0.15, postRate: 0.5,
  /** Where the search starts (glass radii off him), the hand's tremor and the breathing sway (glass radii), its period (s). */
  startR: 3.0, tremor: 0.035, sway: 0.075, swayPeriod: 2.6,
  /** The recoil's kick (glass radii, up the screen) and the muzzle flash (s). */
  recoil: 0.75, flash: 0.09,
  /** Within this many glass radii of him the lens marks him (as it marks a valid target under the player's scope). */
  lock: 0.45,
  /** Game s an order may wait for its ability:start before the scope comes down unused. */
  waitStart: 2.5,
  /** Game s the rifle's aim takes (CONFIG.weapons.sniper.aim: ability:start → the shot). */
  aim: 0.6,
  /** The pace's spring (rad/s, log2 space): down into the scope's slow motion in ~0.1 s (the rifle's 0.6 s of aim must
   * not be spent at the play's pace: at 4× it would be gone in 0.15 s), back up after the shot in ~0.4 s. */
  paceDown: 30, paceUp: 8,
  /** The most the clock runs at the frame the scope comes up (sim s per wall s). */
  enter: 1,
});

/** The show's time scale at a speed setting: AUTO and 1× (or slower) 1; faster fixed speeds shorter (2× 0.71, 4× 0.55). */
export function showScale(speed) {
  if (speed === 'auto' || !(+speed > 1)) return 1;
  return Math.max(0.55, 1 / Math.sqrt(+speed));
}

const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const easeOut = (u) => { u = Math.max(0, Math.min(1, u)); return 1 - (1 - u) * (1 - u); };

/** Catmull-Rom between p1 and p2 (p0, p3 the neighbours) at u ∈ [0, 1]. */
function cr(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** A stable number in [0, 1) from a string (the target's tag: each man's search starts on its own side). */
export function hash01(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}

/**
 * Where the search of a first man starts (px from him; `R` the glass radius): `startR` radii off, on a side picked by
 * `seed` ∈ [0, 1) — left or right of him, 20–60° off the horizontal, so the sweep crosses the screen.
 */
export function startOffset(seed, R) {
  const side = seed < 0.5 ? -1 : 1, up = (seed * 2) % 1 < 0.5 ? -1 : 1;
  const a = ((20 + 40 * ((seed * 7) % 1)) * Math.PI) / 180;
  const r = SCOPE_SHOW.startR * R;
  return { x: side * r * Math.cos(a), y: up * r * Math.sin(a) };
}

/**
 * The searching path of a segment: px from the man at `tau` s into it. `kind` 'first' (the scope just came up: a sweep
 * beside him, across, past him and back) or 'swing' (from the man before: a fast pan, a small overshoot); `from` the
 * start (px from him); `T` the time the path ends on him (s); afterwards {0, 0}. The tremor and sway come on top (aimPath).
 */
export function searchPath(kind, from, R, T, tau) {
  if (!(tau < T)) return { x: 0, y: 0 };
  const L = Math.hypot(from.x, from.y) || 1, ux = from.x / L, uy = from.y / L, px = -uy, py = ux;
  const sgn = from.x * from.y >= 0 ? 1 : -1; // (the bend's side: varied with the start)
  const P = (a, b) => ({ x: from.x * a + px * b * R * sgn, y: from.y * a + py * b * R * sgn });
  const O = (a, b) => ({ x: -ux * a * R + px * b * R * sgn, y: -uy * a * R + py * b * R * sgn });
  const pts = kind === 'swing'
    ? [P(1, 0), P(0.22, 0.3), O(0.32, -0.1), { x: 0, y: 0 }]
    : [P(1, 0), P(0.58, 0.85), P(0.16, -0.55), O(0.3, 0.18), { x: 0, y: 0 }];
  const knots = kind === 'swing' ? [0, 0.55, 0.8, 1] : [0, 0.3, 0.56, 0.8, 1];
  const f = Math.max(0, tau / T);
  let i = 0;
  while (i < knots.length - 2 && f > knots[i + 1]) i++;
  let u = (f - knots[i]) / (knots[i + 1] - knots[i]);
  if (i === 0) u = u * u * (2 - u); // (eases into the first move: the scope has just come up / the swing starts)
  if (i === knots.length - 2) u = easeOut(u); // (eases onto him)
  const q = (k) => pts[Math.max(0, Math.min(pts.length - 1, k))];
  return cr(q(i - 1), q(i), q(i + 1), q(i + 2), u);
}

/**
 * The full aim of the show at show time `s` (s), px from the man: the segment's search, then the breathing sway and the
 * hand's tremor (always: an unsteady hand), the recoil after the shot (`fired`: show time of the shot), the scope coming
 * up (`seg.s0` of the first segment) and going down (`drop`: show time it starts). `k`: showScale. Also the ring's scale.
 * @param {{kind: string, s0: number, from: {x:number, y:number}, T: number}} seg
 * @returns {{x: number, y: number, scale: number, flash: boolean, locked: boolean}}
 */
export function aimPath(seg, s, R, k = 1, { fired = null, drop = null, up0 = null, seed = 0 } = {}) {
  const S = SCOPE_SHOW, tau = s - seg.s0;
  const p = searchPath(seg.kind, seg.from, R, seg.T, tau);
  const ph = seed * 6.283;
  const tw = 2 * Math.PI;
  // the tremor: two incommensurate wobbles (more while searching), the breathing: a slow figure-eight once on him
  const tr = S.tremor * R * (tau < seg.T ? 1.4 : 1);
  let x = p.x + tr * (Math.sin(tw * 1.9 * s + ph) + 0.6 * Math.sin(tw * 3.7 * s + 2 * ph));
  let y = p.y + tr * (Math.sin(tw * 2.3 * s + 1.3 + ph) + 0.6 * Math.sin(tw * 4.1 * s + 0.4 + 3 * ph));
  const breath = S.sway * R * smooth((tau - seg.T) / 0.4 + 1);
  const w = tw / S.swayPeriod;
  x += breath * 0.55 * Math.sin(w * s * 0.5 + 0.7 + ph);
  y += breath * Math.sin(w * s + ph);
  const locked = Math.hypot(p.x, p.y) < S.lock * R;
  let scale = 1, flash = false;
  if (fired != null && s >= fired) {
    const t = s - fired, rise = 0.035 * k, fall = 7 / k;
    const kick = t < rise ? t / rise : Math.exp(-(t - rise) * fall) * Math.cos((t - rise) * 9 / k);
    y -= S.recoil * R * kick;
    x += S.recoil * R * 0.2 * (seed < 0.5 ? -1 : 1) * Math.max(0, kick);
    flash = t < S.flash * k;
  }
  if (up0 != null && s - up0 < S.up * k) { const e = smooth((s - up0) / (S.up * k)); y += 0.6 * R * (1 - e); scale = 0.86 + 0.14 * e; }
  if (drop != null && s >= drop) { const e = smooth((s - drop) / (S.drop * k)); y += 1.2 * R * e * e; scale *= 1 - 0.12 * e; }
  return { x, y, scale, flash, locked };
}

const _v = new THREE.Vector3();
const _hips = new WeakMap();

/** A man's hips bone (skinned body; else null): his body's centre in any pose — standing, falling, lying, ragdolled. */
function hipsOf(root) {
  if (!root) return null;
  let b = _hips.get(root);
  if (b === undefined) {
    b = null;
    root.traverse((o) => { if (!b && o.isBone && /hip|pelvis/i.test(o.name)) b = o; });
    _hips.set(root, b);
  }
  return b;
}

/**
 * The world point the reticle is put on: a man's chest (his hips bone, 0.3 m up: it follows him as he falls), else the
 * thing's drawn centre (a barrel, a tanker), else its sim position a metre up.
 */
export function aimPoint(u, world) {
  const root = u?.object3d || u?.model?.root;
  const h = u?.kind !== 'vehicle' && u?.interactKind == null ? hipsOf(root) : null;
  if (h) { _v.setFromMatrixPosition(h.matrixWorld); return { x: _v.x, y: _v.y + 0.3, z: _v.z }; }
  if (root) { _v.setFromMatrixPosition(root.matrixWorld); return { x: _v.x, y: _v.y + (u.kind === 'vehicle' ? 1.2 : 0.6), z: _v.z }; }
  const y = Number.isFinite(u?.y) ? u.y : (world?.grid?.elevAt?.(u.x, u.z) ?? 0);
  return { x: u.x, y: y + 1, z: u.z };
}

/** Does this order / ability start belong to the show (the Sniper's rifle, a commando's)? */
const isSnipe = (u, id) => id === 'sniper' && u?.kind === 'commando';

export class ScopeShow {
  /** @param {import('./walkthrough.js').Walkthrough} wk */
  constructor(wk) {
    this.wk = wk;
    this.on = false;
    this.s = 0; // show clock (wall s; still while paused)
    this.k = 1;
    this.sniper = null;
    this.seg = null; // {target, kind, s0, from, T, sShot, tOrder, tShot, started, fired}
    this.up0 = null;
    this.drop = null;
    this.capNow = null; // the pace cap in force (smoothed), sim s per wall s
    this.last = null; // the lens's last client position {x, y}
    this.log = []; // what the show did (tests): [{kind, t, s, target}]
    this._offs = [];
  }

  get world() { return this.wk.world; }

  attach() {
    const ev = this.world?.events;
    if (!ev?.on) return;
    const on = (n, f) => { const off = ev.on(n, f); if (typeof off === 'function') this._offs.push(off); };
    on('ability:start', (p) => this._started(p));
    on('shot', (p) => this._shot(p));
    this._fn = () => this.lens();
    this.cursor?.setScripted?.(this._fn);
  }

  detach() {
    for (const off of this._offs) off();
    this._offs = [];
    this.end();
    if (this._fn && this.cursor?.scripted === this._fn) this.cursor.setScripted(null); // (only its own: a jump's next walkthrough may hold it)
    this._fn = null;
  }

  get cursor() { return this.wk.game?.hud?.cursor || null; }

  /** The squad's sniper rifle (a man who can fire it): the walkthrough may show the scope. */
  static wanted(world) {
    return !!world?.commandos?.some((c) => c.role === 'sniper' && (c.inventory?.has?.('sniperRifle') || c.has?.('sniperRifle')));
  }

  _note(kind, extra = {}) {
    this.log.push({ kind, t: this.world.time, s: +this.s.toFixed(3), wall: performance.now(), target: this.seg?.target?.tag ?? this.seg?.target?.id ?? null, ...extra });
    if (this.log.length > 200) this.log.shift();
  }

  /** A player order (the walkthrough's _onOrder): the Sniper's rifle at a man → the scope comes up (or swings to him). */
  order(u, o) {
    if (o?.type !== 'ability' || !isSnipe(u, o.id)) return;
    const tgt = o.target && o.target !== u && typeof o.target === 'object' ? o.target : null;
    if (!tgt || !Number.isFinite(tgt.x) || this.wk.pacer.turbo) return;
    this._begin(u, tgt, this.world.time);
  }

  _begin(u, tgt, t) {
    const swing = this.on && this.sniper === u && this.seg && this.seg.fired != null;
    if (this.on && !swing && this.seg?.target === tgt) return; // (the same shot: its ability:start)
    const S = SCOPE_SHOW;
    if (!this.on) {
      this.on = true;
      this.s = 0;
      this.k = showScale(this.wk.speedSetting);
      this.up0 = 0;
      this.capNow = null;
      this.last = null;
    }
    this.sniper = u;
    // (no ticks granted ahead may run on now: a budget carried from a fast stretch — skip waits at 4× × 4 — would spend
    // the rifle's whole aim in a frame or two; the next frame grants the scope's pace)
    this.wk.pacer.budget = 0;
    if (this.drop != null) this.up0 = this.s; // (it was coming down: back up for the next man)
    this.drop = null;
    const kind = swing ? 'swing' : 'first';
    const k = this.k;
    this.seg = {
      target: tgt, kind, s0: this.s, from: null, T: (swing ? S.swingFind : S.find) * k, sShot: this.s + (swing ? S.swingShot : S.shot) * k,
      tOrder: t, tShot: t + S.aim + 1 / 60, started: false, fired: null, seed: hash01(tgt.tag ?? tgt.id ?? `${tgt.x},${tgt.z}`),
      cut: !swing,
    };
    this._note(kind === 'swing' ? 'swing' : 'up');
  }

  /** ability:start: the rifle's aim has begun — the shot is `aim` s of game time away. */
  _started(p) {
    if (!isSnipe(p?.unit, p?.id) || this.wk.pacer.turbo) return;
    const tgt = p.target && typeof p.target === 'object' && Number.isFinite(p.target.x) ? p.target : null;
    if (!tgt) return;
    if (!this.on || this.seg?.target !== tgt || this.seg.fired != null) this._begin(p.unit, tgt, this.world.time);
    this.seg.started = true;
    this.seg.tShot = this.world.time + SCOPE_SHOW.aim;
    this._note('aim');
  }

  /** The rifle fired: the recoil, the hit; the scope stays on him while he falls and the bolt is worked. */
  _shot(p) {
    if (!this.on || p?.shooter !== this.sniper || p?.weapon !== 'sniper' || !this.seg || this.seg.fired != null) return;
    this.seg.fired = this.s;
    this._note('shot', { hit: !!p.hit });
  }

  /** The show is over (or cut short by a jump): the scope gone, the pace the play's again. */
  end() {
    if (!this.on) return;
    this._note('end');
    this.on = false;
    this.seg = null;
    this.sniper = null;
    this.drop = null;
    this.capNow = null;
    this.last = null;
    this.aim = null;
  }

  /**
   * Per displayed frame (after the pace is set): the show's clock, its phases, and the cap on the pace.
   * @param {number} dt wall s
   */
  frame(dt) {
    if (!this.on) return;
    const wk = this.wk, p = wk.pacer, S = SCOPE_SHOW, k = this.k;
    // (a jump, a scrub, a skipped wait; a chapter card holding the clock: the scope is not left frozen up)
    if (p.turbo || wk.stopped || wk._held?.()) { this.end(); return; }
    const still = wk.paused;
    if (!still) this.s += Math.min(dt, 0.1);
    const seg = this.seg, t = this.world.time;
    // an order that never became a shot (refused, interrupted, the man gone): the scope comes down
    if (seg.fired == null && this.drop == null) {
      const u = this.sniper;
      const gone = !u || u.alive === false || u.removed || (seg.started && u.currentActionId !== 'sniper' && t > seg.tShot + 0.1)
        || (!seg.started && t - seg.tOrder > S.waitStart);
      if (gone) { this.drop = this.s; this._note('drop', { why: 'no shot' }); }
    }
    // after the shot: on the man while he falls, at least `post`, and while the bolt is worked (a second shot may follow)
    if (seg.fired != null && this.drop == null) {
      const bolt = (this.sniper?._boltT ?? -1) + 2 / 60;
      if (this.s - seg.fired >= S.post * k && t >= bolt && !this.sniper?.pendingAbility) { this.drop = this.s; this._note('drop'); }
    }
    if (this.drop != null && this.s - this.drop >= S.drop * k) { this.end(); return; }
    // the pace: the shot lands at sShot (the rifle's aim spread over the time left), then eased back up to the play's
    const natural = wk.pacer.speed * wk.pacer.boost;
    // (the scope comes up at no more than `enter` — a cut, as the camera's: from a fast stretch, 4× or a skip-waits 16×,
    // a spring down would spend the rifle's 0.6 s of aim on its way — then it eases on down to the scope's pace)
    if (this.capNow == null) { this.capNow = Math.min(natural, S.enter); this._capV = 0; }
    // (no catch-up while the scope is up: at most this frame's own ticks, at the scope's pace)
    if (!still) p.budget = Math.min(p.budget, (this.capNow * Math.min(dt, 0.25)) / (wk.simDt || 1 / 60) + 1);
    let cap = natural;
    if (seg.fired == null && this.drop == null) {
      const remWall = seg.sShot - this.s, remGame = Math.max(0, seg.tShot - t);
      cap = remWall > 0.02 ? remGame / remWall : natural;
    } else if (seg.fired != null && this.drop == null) {
      const u = Math.min(1, (this.s - seg.fired) / (S.post * k));
      const lo = Math.min(natural, S.postRate);
      cap = lo * Math.pow(natural / lo, smooth(u));
    }
    cap = Math.max(S.minRate, Math.min(natural, cap));
    // (a critically damped spring in log2 space, as AUTO's own: no step in the pace; the law above makes up for its lag)
    if (!still) {
      let x = Math.log2(this.capNow), v = this._capV;
      const to = Math.log2(cap);
      [x, v] = spring(x, v, to, to < x ? S.paceDown : S.paceUp, Math.min(dt, 0.1));
      this.capNow = Math.min(natural, 2 ** x);
      this._capV = this.capNow < natural ? v : Math.min(0, v);
      if (this.capNow < natural - 1e-6) p.boost = this.capNow / Math.max(1e-6, p.speed);
    }
  }

  /** The director's shot while the scope is up: the man (must), the Sniper near him, the step's look near him. */
  shot() {
    if (!this.on || !this.seg) return null;
    const wk = this.wk, tg = this.seg.target;
    const tp = wk._pointOf ? wk._pointOf(tg) : null;
    const tpt = tp || (Number.isFinite(tg.x) ? { x: tg.x, z: tg.z, y: tg.y ?? 0 } : null);
    if (!tpt) return null;
    const pts = [tpt];
    const sn = this.sniper && wk._pointOf ? wk._pointOf(this.sniper) : null;
    if (sn && Math.hypot(sn.x - tpt.x, sn.z - tpt.z) < 30) pts.push(sn);
    for (const r of wk.step?.look || []) {
      const q = typeof r === 'string' ? wk.resolve?.(r) : null;
      if (q && Math.hypot(q.x - tpt.x, q.z - tpt.z) < 25 && !pts.some((x) => Math.hypot(x.x - q.x, x.z - q.z) < 0.5)) pts.push(q);
    }
    const cut = this.seg.cut && !this._onScreen(tpt);
    this.seg.cut = false;
    // (once the reticle has found him the zoom holds — pans only — so the lens may reuse its image between renders)
    const holdZoom = this.s - this.seg.s0 >= this.seg.T * 0.8 || this.seg.fired != null || this.drop != null;
    return { pts, must: 1, frame: { minSpan: [14, 9], maxZoom: 1.25 }, pitch: wk._pitch?.(pts) ?? null, cut, stiff: 2.6, holdZoom, scope: true };
  }

  _onScreen(p) {
    const cc = this.wk.game?.cameraController;
    if (!cc?.worldToView) return false;
    const v = cc.worldToView(p.x, p.y ?? 0, p.z), r = this.wk.safeRect?.() || { x: 0, y: 0, w: cc.width, h: cc.height };
    return v.x > r.x + 30 && v.x < r.x + r.w - 30 && v.y > r.y + 30 && v.y < r.y + r.h - 30;
  }

  /**
   * The scope for this frame (ui/cursor.js scripted aim; read while the frame is drawn: the camera and the men as drawn):
   * client px, glass radius, the man marked once the reticle is on him, range. null: no scope now.
   */
  lens() {
    if (!this.on || !this.seg || this.wk.pacer.turbo) return null;
    const cc = this.wk.game?.cameraController, hud = this.wk.game?.hud;
    if (!cc?.worldToScreen) return null;
    const seg = this.seg, tg = seg.target;
    const ap = aimPoint(tg, this.world);
    const sp = cc.worldToScreen(ap.x, ap.y, ap.z);
    const R = glassRadius(hud?.scale || 1);
    if (!seg.from) {
      // the start: off him on a side of its own (the first man), or where the scope was (a swing to the next man)
      seg.from = seg.kind === 'swing' && this.last ? { x: this.last.x - sp.x, y: this.last.y - sp.y } : startOffset(seg.seed, R);
      if (seg.kind === 'first') seg.from = this._inView(sp, seg.from, R);
    }
    const a = aimPath(seg, this.s, R, this.k, { fired: seg.fired, drop: this.drop, up0: this.up0, seed: seg.seed });
    const x = sp.x + a.x, y = sp.y + a.y;
    this.last = { x, y };
    this.aim = { dx: a.x, dy: a.y, R, locked: a.locked, target: tg.tag ?? tg.id ?? null }; // (where the reticle is, from him: tests)
    if (!cc.contains?.(x, y)) return null;
    const sn = this.sniper;
    const range = sn ? Math.hypot(tg.x - sn.x, tg.z - sn.z) : null;
    const enemy = tg.kind === 'enemy' ? tg : null;
    return {
      x, y, radius: R * a.scale, scale: a.scale, bad: false, target: a.locked && enemy && enemy.alive !== false ? enemy : null, range,
      time: this.s, sway: true, flash: a.flash, scripted: true,
    };
  }

  /** The search's start kept inside the view (the other side of him when it would leave it). */
  _inView(sp, from, R) {
    const cc = this.wk.game?.cameraController;
    const o = cc?._origin ? cc._origin() : { left: 0, top: 0 };
    const W = cc?.width || innerWidth, H = cc?.height || innerHeight, m = R * 1.2;
    const out = (fx, fy) => sp.x + fx < o.left + m || sp.x + fx > o.left + W - m || sp.y + fy < o.top + m || sp.y + fy > o.top + H - m;
    let f = { ...from };
    if (out(f.x, f.y)) f = { x: -f.x, y: f.y };
    if (out(f.x, f.y)) f = { x: f.x, y: -f.y };
    if (out(f.x, f.y)) f = { x: f.x * 0.5, y: f.y * 0.5 };
    return f;
  }
}

/**
 * Compile the scope lens's programs now (the walkthrough's start: its title card, or the jump's fast-forward), not at the
 * first shot mid-play: a probe of one lens frame (render/scope-magnifier.js) whose new programs are linked by the driver
 * aside (engine/parallel-compile.js compileAhead, `all`: nothing is drawn, the canvas untouched). Its first frame's
 * bounds walk (the lens's culling) is done here too. Without KHR_parallel_shader_compile: nothing (the first shot
 * compiles as the player's first scope does). @returns {Promise<object|null>}
 */
export async function warmScope(game, { cancelled = () => false } = {}) {
  const R = game?.renderer, r = R?.renderer, cc = game?.cameraController, w = game?.world;
  if (!r || !cc || !w || !R.scene) return null;
  const M = (game.scopeMagnifier ||= new ScopeMagnifier(R));
  const o = cc._origin ? cc._origin() : { left: 0, top: 0 };
  const foe = w.enemies?.find((e) => e.alive !== false && e.object3d) || null;
  // the lens window on a guard (its highlight's programs too), wherever the view is: the frame's camera moved by the
  // world step that brings his chest to the view's centre (an orthographic camera: every point moves the same)
  const main = ((game.cameraRig?.count ?? 1) === 1 ? R.camera : null) || cc.camera;
  if (!main) return null;
  const cam = main.clone();
  if (foe && cc.target) {
    const ap = aimPoint(foe, w);
    cam.position.x += ap.x - cc.target.x; cam.position.y += ap.y - (cc.target.y || 0); cam.position.z += ap.z - cc.target.z;
    cam.updateMatrixWorld(true);
  }
  const s = { x: o.left + cc.width / 2, y: o.top + cc.height / 2, radius: glassRadius(game.hud?.scale || 1), bad: false, target: foe, time: 0, sway: false };
  const ctx = { view: cc, camera: cam, water: w.water?.system || null };
  const keep = { ...M.stats };
  const t0 = performance.now();
  let res = null;
  try {
    res = await compileAhead(r, () => { M.frame(s, ctx); }, { all: true, cancelled });
  } finally {
    Object.assign(M.stats, keep, { drawn: false });
    M._img.ok = false; // (nothing was drawn: the first real frame renders afresh)
    M._ema = 0; M._emaReuse = 0; M._age = 0;
  }
  return res ? { ...res, ms: Math.round(performance.now() - t0) } : null;
}
