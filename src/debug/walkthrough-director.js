/**
 * Camera director of debug VIDEO MODE (debug/walkthrough.js) and of the SOLUTION replay's smart camera
 * (debug/solution-replay.js, whose host composes simpler shots and forces no cones): frames the acting commando together with what matters
 * to the step (his target, the guard whose cone he slips past, the objective, the charge about to blow) in the part of
 * the screen the walkthrough's bar and caption leave free, the mission's camera pitch (walkthrough `pitchAt`) and the
 * player's own yaw — swung by up to 55° only while a building has hidden the men (or the guards) in the shot for a
 * while, kept for the rest of the shot. A calm camera (user 2026-11-09: "Debug solutions dont need the camera to be
 * moving around so much, it used to be more static before"): it holds a framing while the acting men stay in its dead
 * zone, follows a man walking out of it by sliding just enough, reframes for a new subject at once only when it
 * matters (an action watched, a blast) or the man is off screen, else once the framing has been held SHOT_HOLD_MS;
 * slow critically damped springs, one eased move (or a cut in a time-lapse) for a long way, fewer zoom moves; the
 * hosts' FocusKeeper keeps a man at work on screen while another takes his turn. It only moves the camera and picks
 * which cones are drawn: it never touches the simulation (tests/debug-walkthrough-sim.test.mjs checks the run is the
 * scripted one). The framing maths is pure (framePoints, calmFrame, tests/unit/walkthrough-director.test.mjs);
 * tools/perf/camera-motion.mjs measures the camera's motion over a whole walkthrough.
 * @module debug/walkthrough-director
 */

import * as THREE from 'three';
import { anyHit, buildGridG, gridable, gridOf } from './ray-grid.js';
import { idleWarm } from '../engine/idle-warm.js';

const PX_PER_M = 40; // CSS px per metre at zoom 1 (CONFIG.camera.pxPerMeterAt1x)
/** Yaws (deg, relative to the player's own) the director may swing to when a building hides the shot. */
export const YAW_OFFSETS = Object.freeze([0, -30, 30, -55, 55]);
/** Wall-clock ms of the yaw check's rays a frame (at least one ray a frame): see Director._yaw. */
export const YAW_RAY_MS = 3;

/** Structures that never hide anyone from the camera: trees and bushes (art/terrain.js TREE_TYPES) — a building does. */
const NOT_IN_THE_WAY = new Set(['tree', 'pine', 'palm', 'bush']);

/**
 * Smoke, glass, decals and the like — see-through meshes (all of their materials drawn without depth writes, or faint)
 * — never hide a man (user 2026-11-09: no yaw swing for smoke).
 */
export function seeThrough(m) {
  if (/smoke|steam|vapou?r|haze|cloud/i.test(m.name || '')) return true;
  const ms = Array.isArray(m.material) ? m.material : [m.material];
  return ms.every((x) => !x || x.visible === false || x.depthWrite === false || (x.transparent && (x.opacity ?? 1) < 0.6));
}

/** The solid meshes drawn under `o` (it and its ancestors visible; sprites and see-through ones out): what can stand between a man and the camera. */
function shownMeshes(o, out) {
  if (!o.visible) return out;
  if (o.isMesh && !o.isSprite && !seeThrough(o)) out.push(o);
  for (const c of o.children) shownMeshes(c, out);
  return out;
}

/** Screen-space metres of a world point for a camera at yaw `az` / pitch `el` (u: screen right, w: screen down). */
export function screenMetres(p, az, el) {
  const ca = Math.cos(az), sa = Math.sin(az), se = Math.sin(el), ce = Math.cos(el);
  return { u: p.x * ca - p.z * sa, w: (p.x * sa + p.z * ca) * se - (p.y || 0) * ce };
}

/**
 * Camera target (ground point at the view centre) and zoom that show every point of `pts` inside `rect` (view CSS px)
 * with a margin, the points' box centred in `rect`. The box is at least `minSpan` screen metres (a man alone is shown
 * with the ground around him), the zoom kept within [minZoom, maxZoom].
 * @param {{x:number, y?:number, z:number}[]} pts
 * @param {{az:number, el:number, width:number, height:number, ppm1?: number}} view  ppm1: px per metre at zoom 1
 * @param {{x:number, y:number, w:number, h:number}} rect
 * @returns {{x:number, z:number, zoom:number, fit:boolean}} fit: everything fits at that zoom
 */
export function framePoints(pts, view, rect, { minSpan = [16, 10], minZoom = 0.42, maxZoom = 1.35, margin = 0.12 } = {}) {
  const ppm1 = view.ppm1 || PX_PER_M;
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
  for (const p of pts) {
    const s = screenMetres(p, view.az, view.el);
    if (s.u < u0) u0 = s.u;
    if (s.u > u1) u1 = s.u;
    if (s.w < w0) w0 = s.w;
    if (s.w > w1) w1 = s.w;
  }
  if (!Number.isFinite(u0)) return null;
  const su = Math.max(u1 - u0, minSpan[0]), sw = Math.max(w1 - w0, minSpan[1]);
  const aw = Math.max(40, rect.w * (1 - 2 * margin)), ah = Math.max(40, rect.h * (1 - 2 * margin));
  const want = Math.min(aw / su, ah / sw) / ppm1;
  const zoom = Math.max(minZoom, Math.min(maxZoom, want));
  const ppm = zoom * ppm1;
  const uc = (u0 + u1) / 2, wc = (w0 + w1) / 2;
  const rcx = rect.x + rect.w / 2, rcy = rect.y + rect.h / 2;
  const uT = uc - (rcx - view.width / 2) / ppm, wT = wc - (rcy - view.height / 2) / ppm;
  const ca = Math.cos(view.az), sa = Math.sin(view.az), se = Math.sin(view.el) || 1;
  const vT = wT / se;
  return { x: uT * ca + vT * sa, z: -uT * sa + vT * ca, zoom, fit: want >= minZoom - 1e-9 };
}

/**
 * framePoints, but when everything does not fit even at the widest zoom the first `must` points (the acting men) win:
 * the other points are dropped, farthest from them first, until the rest fits.
 */
export function frameWithPriority(pts, must, view, rect, opts) {
  let list = pts.slice();
  let f = framePoints(list, view, rect, opts);
  if (!f || f.fit || list.length <= must) return f;
  const core = list.slice(0, Math.max(1, must));
  const cx = core.reduce((a, p) => a + p.x, 0) / core.length, cz = core.reduce((a, p) => a + p.z, 0) / core.length;
  const rest = list.slice(core.length).sort((a, b) => Math.hypot(b.x - cx, b.z - cz) - Math.hypot(a.x - cx, a.z - cz));
  while (rest.length) {
    rest.shift();
    f = framePoints(core.concat(rest), view, rect, opts);
    if (f.fit) return f;
  }
  return framePoints(core, view, rect, opts);
}

/**
 * The largest free rectangle of the view: the view minus the strips the UI covers (`top` px from the top, `bottom` px
 * from the bottom, `right` px), then minus `block` (a rect in a corner, the HUD's knapsack): full width above it, or
 * the full height beside it, whichever is larger.
 */
export function freeRect({ width, height, top = 0, bottom = 0, left = 0, right = 0, block = null }) {
  let r = { x: left, y: top, w: Math.max(40, width - left - right), h: Math.max(40, height - top - bottom) };
  if (block && block.w > 0 && block.h > 0) {
    const bx0 = block.x, by0 = block.y;
    const above = { ...r, h: Math.max(40, Math.min(r.y + r.h, by0) - r.y) };
    const beside = { ...r, w: Math.max(40, Math.min(r.x + r.w, bx0) - r.x) };
    const overlaps = bx0 < r.x + r.w && by0 < r.y + r.h;
    if (overlaps) r = above.w * above.h >= beside.w * beside.h ? above : beside;
  }
  return r;
}

/** Is unit `u` acting (on the move, his vehicle on the move, walking up to an order, an action under way — a long
 * chat-up or lying dug in is no action)? */
export function isActing(u) {
  if (!u || u.alive === false || u.removed) return false;
  return !!u.path || !!u.pendingAbility || (!!u.currentAction && !['distract', 'shovel'].includes(u.currentActionId)) || !!(u.vehicle?.path || u.vehicle?.isMoving);
}

/**
 * Always action (video mode): what the camera shows while the step's men (`who`) stand idle — another commando at
 * work, the one ordered last (`orderT`: unit → game time of his last order); else a walking guard the step names
 * (`tags`: its look / cones), else the nearest guard walking within 35 m of the first idle man. null: the step's men
 * act (the usual shot), or nothing else moves.
 */
export function pickLive({ who = [], commandos = [], enemies = [], tags = new Set(), orderT = null } = {}) {
  const idle = who.filter((u) => u && u.alive !== false && !u.removed);
  if (!idle.length || idle.some(isActing)) return null;
  const others = commandos.filter((c) => !idle.includes(c) && isActing(c)).sort((a, b) => (orderT?.get(b) ?? -1) - (orderT?.get(a) ?? -1));
  if (others.length) return others[0];
  const a0 = idle[0], d = (e) => Math.hypot(e.x - a0.x, e.z - a0.z);
  const walking = enemies.filter((e) => e && e.alive !== false && !e.removed && !!e.path && d(e) < 45);
  return walking.filter((e) => tags.has(e.tag)).sort((a, b) => d(a) - d(b))[0] || walking.filter((e) => d(e) < 35).sort((a, b) => d(a) - d(b))[0] || null;
}

/** Critically damped spring step of value `x` (velocity `v`) toward `to`: returns [x, v]. ω: stiffness (1/s). */
export function spring(x, v, to, w, dt) {
  const f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const xn = (f * x + dt * v + hhoo * to) * det;
  const vn = (v + hoo * (to - x)) * det;
  return [xn, vn];
}

// ------------------------------------------------------------------ the calm camera
// (user 2026-11-09: "Debug solutions dont need the camera to be moving around so much, it used to be more static
// before" — the director held no framing: every frame it flew to the shot's own, so each man added to or dropped from
// the shot, each new subject, each step of a walking man and each change of the shot's zoom moved the camera)

/** The usual shot's least span (screen m: framePoints' minSpan) — a man alone with ground round him; [16, 10] until 2026-11-09. */
export const SHOT_SPAN = Object.freeze([20, 12.5]);
/** A framing is held at least this long (wall ms) before a reframe nothing forces (see calmFrame). */
export const SHOT_HOLD_MS = 3500;
/** The dead zone: the acting men anywhere in this middle part of the free rectangle (fraction of its width and height) — the camera stays. */
export const DEAD_ZONE = 0.7;
/** The always-action edge: an acting man past this middle part of the free rectangle is brought back at once. */
export const SAFE_ZONE = 0.9;
/** A reframe keeps the zoom it has unless the shot's own differs by more than this (|ln|: ~25%). */
export const ZOOM_STEP = 0.22;
/** A held framing up to this much wider than the shot's own (ln: ~1.65×) is kept; wider, it closes in once the hold is up. */
export const ZOOM_SLACK = 0.5;
/** Pan / zoom spring stiffness (1/s; critically damped: no overshoot). */
export const PAN_W = 2.2;
export const ZOOM_W = 1.2;
/** A reframe farther than this (m) is an eased move of EASE_MS (by distance), not a spring's sweep; in a time-lapse, a cut. */
export const EASE_FROM = 16;
export const EASE_MS = Object.freeze([900, 1600]);
/** keepInSafe stays off this long (wall ms) after a new framing: the springs bring the men in, no jump. */
export const SETTLE_MS = 1800;
/** Focus hysteresis (FocusKeeper): a man keeps the shot this long (wall ms) while he acts, unless something matters more. */
export const FOCUS_MIN_MS = 4000;
/** Yaw: a swing only once the acting men have been hidden this long (wall ms; the other points of the shot: twice as long). */
export const YAW_PERSIST_MS = 2000;

/** Screen px of world point `p` for a camera at ground target `t` ({x, z}) and `zoom` (orthographic, as CameraController projects it). */
export function screenPx(p, view, t, zoom) {
  const ppm = zoom * (view.ppm1 || PX_PER_M), a = screenMetres(p, view.az, view.el), c = screenMetres({ x: t.x, y: 0, z: t.z }, view.az, view.el);
  return { x: view.width / 2 + (a.u - c.u) * ppm, y: view.height / 2 + (a.w - c.w) * ppm };
}

/** `rect` shrunk about its centre to the fraction `k` of its width and height. */
export function insetRect(rect, k) {
  return { x: rect.x + (rect.w * (1 - k)) / 2, y: rect.y + (rect.h * (1 - k)) / 2, w: rect.w * k, h: rect.h * k };
}

/** The ground target that moves the picture by (dx, dy) screen px at `zoom` (the points go the other way). */
function shiftTarget(t, dx, dy, view, zoom) {
  const ppm = zoom * (view.ppm1 || PX_PER_M), du = dx / ppm, dv = dy / ppm / (Math.sin(view.el) || 1);
  const ca = Math.cos(view.az), sa = Math.sin(view.az);
  return { x: t.x + du * ca + dv * sa, z: t.z - du * sa + dv * ca };
}

/** framePoints' framing `f` at another zoom: the same box centred in `rect` (the target moves with the zoom unless `rect` is the view's centre). */
export function atZoom(f, zoom, view, rect) {
  const k = 1 / (f.zoom * (view.ppm1 || PX_PER_M)) - 1 / (zoom * (view.ppm1 || PX_PER_M));
  const dx = rect.x + rect.w / 2 - view.width / 2, dy = rect.y + rect.h / 2 - view.height / 2;
  // (the target sits dx/ppm off the box centre: a change of ppm moves it by dx·Δ(1/ppm), as a pan of that many metres)
  const t = shiftTarget(f, dx * k * f.zoom * (view.ppm1 || PX_PER_M), dy * k * f.zoom * (view.ppm1 || PX_PER_M), view, f.zoom);
  return { x: t.x, z: t.z, zoom, fit: f.fit };
}

/** The screen box (px) of points `pts[i0..i1)` under framing `t` / `zoom`. */
function boxPx(pts, i0, i1, view, t, zoom) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = i0; i < i1; i++) {
    const q = screenPx(pts[i], view, t, zoom);
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  return { x0, x1, y0, y1 };
}

const outside = (b, r) => b.x0 < r.x || b.x1 > r.x + r.w || b.y0 < r.y || b.y1 > r.y + r.h;

/** One axis of pushInto: the px that bring [lo, hi] inside [a, a + s] (a span longer than it: its middle on the middle). */
function push1(lo, hi, a, s) {
  return hi - lo > s ? (lo + hi) / 2 - (a + s / 2) : lo < a ? lo - a : hi > a + s ? hi - (a + s) : 0;
}

/** The px that bring box `b` back inside rect `r` (0 when it is in; when it is larger than `r`, its centre to r's). */
function pushInto(b, r) {
  return { dx: push1(b.x0, b.x1, r.x, r.w), dy: push1(b.y0, b.y1, r.y, r.h) };
}

/**
 * The px that bring the men's box `b` back inside the dead zone `inner` — on an axis where they span more than it (a
 * group), inside `edge` instead: a group is not re-centred for every step one of them takes.
 */
function deadPush(b, inner, edge) {
  const dx = b.x1 - b.x0 <= inner.w ? push1(b.x0, b.x1, inner.x, inner.w) : push1(b.x0, b.x1, edge.x, edge.w);
  const dy = b.y1 - b.y0 <= inner.h ? push1(b.y0, b.y1, inner.y, inner.h) : push1(b.y0, b.y1, edge.y, edge.h);
  return { dx, dy };
}

/**
 * The calm camera's framing for this frame. `held`: the framing it holds ({x, z, zoom, at: wall ms it was taken, key:
 * the subject it was taken for}), `want`: the shot's own (frameWithPriority), `pts` / `must`: the shot's points, the
 * first `must` its acting men. Returns the framing to fly to, `kind`:
 *  - 'keep'  the acting men are inside the dead zone (DEAD_ZONE of the free rect) and the zoom is near enough: nothing moves
 *            — a new subject already in the picture included, and a new subject that is still on screen, not urgent, while
 *            the framing is younger than `hold` (SHOT_HOLD_MS);
 *  - 'push'  the same men walked out of the dead zone: the framing slides just enough to keep them inside it (a man
 *            walking is followed, never re-centred step by step);
 *  - 'frame' the shot's own framing: a new subject outside the dead zone (at once when `urgent` — an action watched, a
 *            blast — or the hold is up, or an acting man is off screen), the men spread past the held zoom, a framing
 *            far wider than needed, or the shot's other points off screen once the hold is up. Its zoom is the held one
 *            when the two are within ZOOM_STEP: fewer zoom moves.
 * Pure (tests/unit/walkthrough-director.test.mjs).
 */
export function calmFrame(held, want, pts, must, view, rect, { now = 0, key = null, urgent = false, hold = SHOT_HOLD_MS, zone = DEAD_ZONE, safe = SAFE_ZONE } = {}) {
  if (!want) return held ? { ...held, kind: 'keep' } : null;
  const frame = () => {
    const lz = held ? Math.log(want.zoom / held.zoom) : 0;
    const f = held && Math.abs(lz) < ZOOM_STEP && fitsAt(held.zoom) ? atZoom(want, held.zoom, view, rect) : want;
    return { x: f.x, z: f.z, zoom: f.zoom, at: now, key, kind: 'frame' };
  };
  const n = Math.max(1, Math.min(must ?? 1, pts.length));
  const inner = insetRect(rect, zone), edge = insetRect(rect, safe);
  const fitsAt = (zoom) => { const b = boxPx(pts, 0, n, view, { x: 0, z: 0 }, zoom); return b.x1 - b.x0 <= edge.w && b.y1 - b.y0 <= edge.h; };
  if (!held) return frame();
  const men = boxPx(pts, 0, n, view, held, held.zoom);
  if (men.x1 - men.x0 > edge.w || men.y1 - men.y0 > edge.h) return frame(); // (spread past the held zoom: wider, now)
  const dead = deadPush(men, inner, edge);
  const out = dead.dx !== 0 || dead.dy !== 0, lost = outside(men, edge);
  const lz = Math.log(want.zoom / held.zoom); // (> 0: the shot wants it closer)
  const aged = now - held.at >= hold;
  if (key !== held.key) {
    if (!out && lz <= ZOOM_SLACK) return { ...held, key, kind: 'keep' }; // (the new subject is in the picture already)
    if (urgent || aged || lost) return frame();
    return { ...held, kind: 'keep' };
  }
  if (out) {
    const t = shiftTarget(held, dead.dx, dead.dy, view, held.zoom);
    return { ...held, x: t.x, z: t.z, kind: 'push' };
  }
  if (aged) {
    if (lz > ZOOM_SLACK) return frame();
    if (n < pts.length && outside(boxPx(pts, n, pts.length, view, held, held.zoom), edge)) {
      const f = frame();
      if (Math.hypot(f.x - held.x, f.z - held.z) > 2 || Math.abs(Math.log(f.zoom / held.zoom)) > 0.05) return f;
    }
  }
  return { ...held, kind: 'keep' };
}

/**
 * The camera framing `cam` ({x, z, zoom}) moved just enough that the acting men (the first `must` of `pts`) are inside
 * the SAFE_ZONE of the free rect — the always-action guarantee under the springs' lag. null: nothing to do.
 */
export function keepInSafe(cam, pts, must, view, rect, safe = SAFE_ZONE) {
  const n = Math.max(1, Math.min(must ?? 1, pts.length)), edge = insetRect(rect, safe);
  const b = boxPx(pts, 0, n, view, cam, cam.zoom);
  if (!outside(b, edge) || b.x1 - b.x0 > edge.w || b.y1 - b.y0 > edge.h) return null;
  const p = pushInto(b, edge);
  return shiftTarget(cam, p.dx, p.dy, view, cam.zoom);
}

/** The subject a shot is about, for the calm camera: its `key`, else its man's (`who`) role / tag / id; null: unnamed. */
export function shotKey(shot) {
  if (shot?.key != null) return shot.key;
  const u = shot?.who;
  return u ? `${u.kind === 'commando' ? u.role : u.tag ?? u.id ?? u.role ?? 'unit'}` : null;
}

/** Smoothstep easing of an eased move (0 → 1, no speed at either end). */
export const easeMove = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/**
 * Focus hysteresis of the shot's subject (the hosts' composeShot: the lead man, the man watched while the step's men
 * wait): a new man takes the shot at once when the one shown no longer acts (or is gone), for what matters more
 * (`urgent`: a kill, a blast, a detection risk), or once the one shown has had it FOCUS_MIN_MS; otherwise the one shown
 * keeps it — two men at work by turns no longer swap the shot every few seconds. Pure (unit-tested).
 */
export class FocusKeeper {
  constructor(minMs = FOCUS_MIN_MS) {
    this.minMs = minMs;
    this.reset();
  }

  reset() { this.unit = null; this.at = -Infinity; }

  /** The man to show of `cand` (the composer's own pick) at wall time `now`; `acting(u)`: is he at work. */
  pick(cand, now, { urgent = false, acting = isActing } = {}) {
    const cur = this.unit, gone = (u) => !u || u.alive === false || u.removed;
    if (gone(cand) || cand === cur) {
      if (cand === cur && !gone(cur)) return cur;
      if (gone(cand)) { if (gone(cur)) this.reset(); return gone(cur) ? cand ?? null : cur; }
    }
    if (gone(cur) || urgent || !acting(cur) || now - this.at >= this.minMs) { this.unit = cand; this.at = now; return cand; }
    return cur;
  }
}

export class Director {
  /** @param {import('./walkthrough.js').Walkthrough} wk */
  constructor(wk) {
    this.wk = wk;
    this.game = wk.game;
    this.on = true;
    this.cam = null; // smoothed {x, z, zoom, pitch, vx, vz, vzoom}
    this._saved = null;
    this._lastForced = '';
  }

  get cc() { return this.game.cameraController; }

  /** Take the camera: the view may go a little past the scroll limits (a man at the map's edge is still centred). */
  attach() {
    const cc = this.cc, rig = this.game.cameraRig;
    if (!cc || this._saved) return;
    this._saved = { elevation: cc.elevation, azimuth: cc.azimuth, bounds: { ...cc.bounds }, scripted: !!rig?.scripted };
    this.yaw = { want: 0, cur: 0, v: 0, at: -1, since: -1e9 }; // offsets (deg) from the player's yaw
    const extra = Math.min(16, cc.apron ? cc.apron * 0.5 : 6);
    const b = cc.bounds;
    if (b) cc.bounds = { minX: b.minX - extra, minZ: b.minZ - extra, maxX: b.maxX + extra, maxZ: b.maxZ + extra };
    cc.untrack?.();
    this.setOn(this.on);
    this._gridAhead();
  }

  /**
   * The triangle grids of the structures' shown meshes (debug/ray-grid.js), built ahead on still screens
   * (engine/idle-warm.js: the walkthrough's title and chapter cards), so the yaw checks of play find them ready.
   */
  _gridAhead() {
    const w = this.wk.world;
    if (!w?.structures?.size) return;
    const seen = new Set();
    for (const st of w.structures.values()) {
      if (!st.object3d || NOT_IN_THE_WAY.has(st.type)) continue;
      for (const m of shownMeshes(st.object3d, [])) {
        if (!gridable(m) || seen.has(m.geometry)) continue;
        seen.add(m.geometry);
        idleWarm.add('ray grid', () => { if (!gridOf(m)) { const it = buildGridG(m.geometry, m.material); while (!it.next().done); } });
      }
    }
  }

  /** Give the camera back as it was (pitch, scroll limits, user scrolling); the cones the player chose stay. */
  detach() {
    const cc = this.cc, rig = this.game.cameraRig, s = this._saved;
    if (!s) return;
    this._saved = null;
    if (cc) {
      cc.elevation = s.elevation;
      cc.azimuth = s.azimuth;
      cc.bounds = s.bounds;
      cc._applyTransform?.();
    }
    if (rig) rig.scripted = s.scripted;
    if (this.game.cones && this._forcedCones) this.game.cones.forced = null; // only what this director forced
  }

  /** Director on (it flies the camera, user scrolling locked) or off (free camera: the user looks around). */
  setOn(on) {
    this.on = !!on;
    const rig = this.game.cameraRig;
    if (rig && this._saved) rig.scripted = this.on;
    if (this.on) { this.cam = null; this.held = null; this.move = null; } // re-acquire from wherever the user left the view
  }

  /** The framing held (calmFrame: {x, z, zoom, at, key}), null before the first shot. */
  get aim() { return this.held || null; }

  /** The shot's subject key (shotKey); an unnamed shot is the same subject while its first point moves on smoothly. */
  _key(shot) {
    const k = shotKey(shot);
    if (k != null) return k;
    const p = shot.pts[0], a = this._anon;
    if (!a || Math.hypot(p.x - a.x, p.z - a.z) > 4) this._anon = { x: p.x, z: p.z, n: (a?.n ?? 0) + 1 };
    else { a.x = p.x; a.z = p.z; }
    return `pt#${this._anon.n}`;
  }

  /**
   * Per displayed frame (real seconds). The calm camera (user 2026-11-09): the shot's framing is only where the camera
   * may go — it holds the one it has while the acting men stay in its dead zone (calmFrame), slides it to follow a man
   * walking out of it, and reframes for a new subject (at once for an action watched or a blast, else once the framing
   * has been held SHOT_HOLD_MS) or when the men spread past it. Small moves are slow critically damped springs; a
   * reframe farther than EASE_FROM is one eased move (a cut in a time-lapse, or past `cutBeyond`); an acting man is
   * never left past the SAFE_ZONE edge (keepInSafe).
   */
  update(dt) {
    const g = this.game, cc = this.cc;
    if (!cc || !this._saved || g.world !== this.wk.world) return;
    this._cones();
    if (!this.on) return;
    const shot = this.wk.composeShot();
    if (!shot || !shot.pts.length) return;
    const rect = this.wk.safeRect();
    const pitch = shot.pitch ?? (this._saved.elevation * 180) / Math.PI;
    let c = this.cam;
    const elNow = c ? (c.pitch * Math.PI) / 180 : (pitch * Math.PI) / 180;
    this._yaw(shot, elNow, dt);
    const az = this._saved.azimuth + (this.yaw.cur * Math.PI) / 180;
    const view = { az, el: elNow, width: cc.width, height: cc.height, ppm1: cc.cfg?.pxPerMeterAt1x };
    // (`holdZoom`: pans only, at the zoom the camera has — the Sniper's scope settled on a man: a steady zoom lets the
    // lens reuse its image, render/scope-magnifier.js)
    const frame = shot.holdZoom && c ? { ...shot.frame, minZoom: c.zoom, maxZoom: c.zoom } : shot.frame;
    const want = frameWithPriority(shot.pts, shot.must ?? 1, view, rect, frame);
    if (!want) return;
    const now = performance.now(), key = this._key(shot), must = shot.must ?? 1;
    const k = Math.min(dt, 0.1);
    if (!c || shot.cut) {
      c = this.cam = { x: want.x, z: want.z, zoom: want.zoom, pitch, vx: 0, vz: 0, vzoom: 0, vp: 0 };
      this.held = { x: want.x, z: want.z, zoom: want.zoom, at: now, key, pitch };
      this.move = null;
      this.yaw.shotAt = now;
      this._framedAt = now;
    } else {
      const urgent = !!(shot.urgent || shot.hold || shot.stiff || shot.scope || shot.fresh);
      let h = calmFrame(this.held, want, shot.pts, must, view, rect, { now, key, urgent });
      if (shot.holdZoom) h = { ...h, zoom: c.zoom };
      // (the mission's pitch for the men follows them only when the framing moves: a held framing keeps its tilt)
      h.pitch = h.kind === 'keep' && Number.isFinite(this.held?.pitch) ? this.held.pitch : pitch;
      this.held = h;
      if (h.kind === 'frame') {
        this.yaw.shotAt = now; // (a new framing: the yaw may go back to the player's with it)
        this._framedAt = now;
        const d = Math.hypot(h.x - c.x, h.z - c.z);
        // a long way: a cut (in a time-lapse, any reframe past EASE_FROM — the time-lapse is a jump in time already)
        if (d > (shot.cutBeyond ?? 70) || (shot.lapse && d > EASE_FROM)) {
          Object.assign(c, { x: h.x, z: h.z, zoom: h.zoom, vx: 0, vz: 0, vzoom: 0 });
          this.move = null;
        } else if (d > EASE_FROM) {
          this.move = { x0: c.x, z0: c.z, lz0: Math.log(c.zoom), t0: now, ms: Math.min(EASE_MS[1], EASE_MS[0] + d * 14) };
        }
      }
      const m = this.move;
      if (m) {
        // one eased move to the new framing (it may still slide on meanwhile: the move ends on it)
        const u = Math.min(1, (now - m.t0) / m.ms), e = easeMove(u);
        c.x = m.x0 + (h.x - m.x0) * e;
        c.z = m.z0 + (h.z - m.z0) * e;
        c.zoom = Math.exp(m.lz0 + (Math.log(h.zoom) - m.lz0) * e);
        c.vx = 0; c.vz = 0; c.vzoom = 0;
        if (u >= 1) this.move = null;
      } else {
        const w = Math.min(shot.stiff ?? PAN_W, PAN_W);
        [c.x, c.vx] = spring(c.x, c.vx, h.x, w, k);
        [c.z, c.vz] = spring(c.z, c.vz, h.z, w, k);
        if (shot.holdZoom) c.vzoom = 0;
        else [c.zoom, c.vzoom] = spring(c.zoom, c.vzoom, h.zoom, ZOOM_W, k);
        // always action: the springs' lag never leaves an acting man past the safe edge — once the camera has had the
        // time to fly to a new framing (meanwhile he may be on his way into the picture: no jump to meet him)
        // (caught up within a few frames, not in one: a man added to the shot past the edge is no jump either)
        const s = now - (this._framedAt ?? -Infinity) > SETTLE_MS ? keepInSafe(c, shot.pts, must, view, rect) : null;
        if (s) { const f = Math.min(1, 12 * k); c.x += (s.x - c.x) * f; c.z += (s.z - c.z) * f; }
      }
      [c.pitch, c.vp] = spring(c.pitch, c.vp, h.pitch, 2.4, k);
    }
    cc.tracking = null;
    cc._panTween = null;
    cc._zoomTween = null;
    cc.elevation = (c.pitch * Math.PI) / 180;
    cc.azimuth = az;
    cc.zoom = cc.zoomTarget = c.zoom;
    cc.target.set(c.x, 0, c.z);
    cc._applyTransform();
    // (the clamp / zoom floor may refuse part of it: follow what the camera really did, so the spring never winds up)
    c.zoom = cc.zoom;
  }

  /**
   * Yaw: the player's own, unless a building hides part of the shot from it (the men in it, then its guards) for a
   * while: the acting men YAW_PERSIST_MS on end (the shot's other points twice that) — a man passing behind a corner
   * swings nothing. Then the nearest offset that shows more of it, kept for the rest of the shot: back to the player's
   * own only with a new framing (a reframe or a cut, `shotAt`) that it shows in full. Checked twice a second (real
   * time). Each check casts up to 25 rays at the structures round the men — a blasted bunker's ruin alone is ~80 000
   * triangles, ~100 ms of rays in one go — so a check is a job spread over the next frames, at most YAW_RAY_MS of rays
   * a frame (one at least): the same rays, the same decision, a few frames later. A ray walks each mesh's triangle grid
   * (debug/ray-grid.js: the cells it passes through only, the answer three's Raycaster gives — ~1 ms a ray against a
   * barracks became a few µs); a mesh met before its grid is built gets it built inside the job, in slices; the
   * structures' meshes are gridded ahead on the still screens (title and chapter cards: _gridAhead).
   */
  _yaw(shot, el, dt) {
    const y = this.yaw, now = performance.now();
    if (shot.cut) { y.cur = y.want; y.v = 0; this._yawJob = null; }
    if (!this._yawJob && now - y.at > 500 && !shot.noYaw) {
      y.at = now;
      this._yawJob = this._yawCheck(shot.pts.slice(0, 5), shot.must ?? 1, el);
    }
    if (this._yawJob) {
      const t0 = performance.now();
      for (;;) { const r = this._yawJob.next(); if (r.done) { this._yawJob = null; break; } if (performance.now() - t0 > YAW_RAY_MS) break; }
    }
    [y.cur, y.v] = spring(y.cur, y.v, y.want, 1.4, Math.min(dt, 0.1));
  }

  /** One yaw check (a generator: it yields after every ray; see _yaw). */
  * _yawCheck(pts, must, el) {
    const y = this.yaw;
    // (each yaw's score is _hidden from there, asked inline: a generator function made per check — its own prototype
    // object each time — threw away optimised code at every check, ~100 deopts a walkthrough)
    const cur = yield* this._hidden(pts, must, this._saved.azimuth + (y.want * Math.PI) / 180, el);
    const men = this._menHidden, now = performance.now();
    // (how long, on end, the men — else anything of the shot — have been hidden from the yaw it has)
    y.menSince = men > 0 ? y.menSince ?? now : null;
    y.anySince = cur > 0 ? y.anySince ?? now : null;
    const persist = (y.menSince != null && now - y.menSince >= YAW_PERSIST_MS) || (y.anySince != null && now - y.anySince >= 2 * YAW_PERSIST_MS);
    if (persist) {
      let best = y.want, bestS = cur;
      for (const off of YAW_OFFSETS) {
        const sc = off === y.want ? cur : yield* this._hidden(pts, must, this._saved.azimuth + (off * Math.PI) / 180, el);
        if (sc < bestS - 1e-9 || (sc === bestS && Math.abs(off) < Math.abs(best))) { best = off; bestS = sc; }
      }
      if (best !== y.want && bestS < cur) { y.want = best; y.since = performance.now(); y.menSince = null; y.anySince = null; }
    } else if (cur === 0 && y.want !== 0 && (y.shotAt ?? -Infinity) > y.since) {
      // a new framing since the swing: the player's own yaw again if it shows the whole shot
      const s0 = yield* this._hidden(pts, must, this._saved.azimuth, el);
      if (s0 === 0) { y.want = 0; y.since = performance.now(); }
    }
  }

  /**
   * How hidden `pts` are behind the mission's structures from yaw `az` (a man of the first `must` counts 3): a
   * generator yielding after each ray, returning the score (`_menHidden`: how many of the men). Only what is drawn and
   * solid hides anyone: the meshes shown now (a building's other LODs, a hidden ruin waiting for its blast and the like
   * are not in the way), smoke, glass and other see-through stuff never (seeThrough).
   */
  * _hidden(pts, must, az, el) {
    const w = this.wk.world;
    this._menHidden = 0;
    if (!w?.structures?.size) return 0;
    if (!this._ray) { this._ray = new THREE.Raycaster(); this._dir = new THREE.Vector3(); this._org = new THREE.Vector3(); }
    let s = 0, men = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.unseen) continue;
      const objs = [];
      for (const st of w.structures.values()) {
        const o = st.object3d, d = st.def;
        if (!o || NOT_IN_THE_WAY.has(st.type) || (Number.isFinite(d?.x) && Math.hypot(d.x - p.x, d.z - p.z) > 45)) continue;
        shownMeshes(o, objs);
      }
      if (!objs.length) continue;
      // (a mesh without its triangle grid yet: built here first, a slice per step of this job)
      for (const m of objs) if (gridable(m) && !gridOf(m)) yield* buildGridG(m.geometry, m.material);
      const dir = this._dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); // towards the camera
      this._org.set(p.x, (p.y || 0) + 1.1, p.z).addScaledVector(dir, 0.6);
      this._ray.set(this._org, dir);
      this._ray.far = 80;
      if (anyHit(this._ray, objs)) { s += i < must ? 3 : 1; if (i < must) men++; } // (= this._ray.intersectObjects(objs, false).length > 0)
      yield;
    }
    this._menHidden = men;
    return s;
  }

  /** The step's cones (render only: VisionCones.forced). A host without conesNow (the SOLUTION replay) forces none. */
  _cones() {
    const cones = this.game.cones;
    if (!cones || !('forced' in cones)) return;
    if (typeof this.wk.conesNow !== 'function') return;
    const list = this.wk.conesNow();
    const key = list.map((e) => e.id).join(',');
    if (key === this._lastForced && cones.forced) return;
    this._lastForced = key;
    cones.forced = new Set(list);
    this._forcedCones = true;
  }
}
