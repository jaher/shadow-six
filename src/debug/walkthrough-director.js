/**
 * Camera director of debug VIDEO MODE (debug/walkthrough.js): frames the acting commando together with what matters
 * to the step (his target, the guard whose cone he slips past, the objective, the charge about to blow) in the part of
 * the screen the walkthrough's bar and caption leave free, with smooth pans and zooms, the mission's camera pitch
 * (walkthrough `pitchAt`) and the player's own yaw — swung by up to 55° only while a building would hide the men or
 * the guards in the shot from the player's angle (checked twice a second; held at least 4 s, then back). It only moves the camera and picks which cones are drawn: it
 * never touches the simulation (tests/debug-walkthrough-sim.test.mjs checks the run is the scripted one).
 * The framing maths is pure (framePoints, tests/unit/walkthrough-director.test.mjs).
 * @module debug/walkthrough-director
 */

import * as THREE from 'three';

const PX_PER_M = 40; // CSS px per metre at zoom 1 (CONFIG.camera.pxPerMeterAt1x)
/** Yaws (deg, relative to the player's own) the director may swing to when a building hides the shot. */
export const YAW_OFFSETS = Object.freeze([0, -30, 30, -55, 55]);

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

/** Critically damped spring step of value `x` (velocity `v`) toward `to`: returns [x, v]. ω: stiffness (1/s). */
export function spring(x, v, to, w, dt) {
  const f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const xn = (f * x + dt * v + hhoo * to) * det;
  const vn = (v + hoo * (to - x)) * det;
  return [xn, vn];
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
    if (this.game.cones) this.game.cones.forced = null;
  }

  /** Director on (it flies the camera, user scrolling locked) or off (free camera: the user looks around). */
  setOn(on) {
    this.on = !!on;
    const rig = this.game.cameraRig;
    if (rig && this._saved) rig.scripted = this.on;
    if (this.on) this.cam = null; // re-acquire from wherever the user left the view
  }

  /** Per displayed frame (real seconds). */
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
    const want = frameWithPriority(shot.pts, shot.must ?? 1, view, rect, shot.frame);
    if (!want) return;
    const far = c && Math.hypot(want.x - c.x, want.z - c.z) > (shot.cutBeyond ?? 70);
    if (!c || far || shot.cut) {
      c = this.cam = { x: want.x, z: want.z, zoom: want.zoom, pitch, vx: 0, vz: 0, vzoom: 0, vp: 0 };
    } else {
      const k = Math.min(dt, 0.1);
      const w = shot.stiff ?? 3.2;
      [c.x, c.vx] = spring(c.x, c.vx, want.x, w, k);
      [c.z, c.vz] = spring(c.z, c.vz, want.z, w, k);
      [c.zoom, c.vzoom] = spring(c.zoom, c.vzoom, want.zoom, w * 0.7, k);
      [c.pitch, c.vp] = spring(c.pitch, c.vp, pitch, 2.4, k);
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
   * Yaw: the player's own, unless a building hides part of the shot from it (the men in it, then its guards): then
   * the nearest offset that shows more of it, held at least 4 s. Checked twice a second (real time).
   */
  _yaw(shot, el, dt) {
    const y = this.yaw, now = performance.now();
    if (shot.cut) { y.cur = y.want; y.v = 0; }
    if (now - y.at > 500 && !shot.noYaw) {
      y.at = now;
      const pts = shot.pts.slice(0, 5);
      const score = (off) => this._hidden(pts, shot.must ?? 1, this._saved.azimuth + (off * Math.PI) / 180, el);
      const cur = score(y.want);
      if (cur > 0 || (y.want !== 0 && now - y.since > 4000)) {
        let best = y.want, bestS = cur;
        for (const off of YAW_OFFSETS) {
          const sc = off === y.want ? cur : score(off);
          if (sc < bestS - 1e-9 || (sc === bestS && Math.abs(off) < Math.abs(best))) { best = off; bestS = sc; }
        }
        if (best !== y.want && (now - y.since > 4000 || bestS + 1 <= cur)) { y.want = best; y.since = now; }
      }
    }
    [y.cur, y.v] = spring(y.cur, y.v, y.want, 1.6, Math.min(dt, 0.1));
  }

  /** How hidden `pts` are behind the mission's structures from yaw `az` (a man of the first `must` counts 3). */
  _hidden(pts, must, az, el) {
    const w = this.wk.world;
    if (!w?.structures?.size) return 0;
    if (!this._ray) { this._ray = new THREE.Raycaster(); this._dir = new THREE.Vector3(); this._org = new THREE.Vector3(); }
    const dir = this._dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)); // towards the camera
    let s = 0;
    pts.forEach((p, i) => {
      if (p.unseen) return;
      const objs = [];
      for (const st of w.structures.values()) {
        const o = st.object3d, d = st.def;
        if (!o || (Number.isFinite(d?.x) && Math.hypot(d.x - p.x, d.z - p.z) > 45)) continue;
        objs.push(o);
      }
      if (!objs.length) return;
      this._org.set(p.x, (p.y || 0) + 1.1, p.z).addScaledVector(dir, 0.6);
      this._ray.set(this._org, dir);
      this._ray.far = 80;
      const hit = this._ray.intersectObjects(objs, true).find((h) => h.object.visible !== false && !h.object.isSprite);
      if (hit) s += i < must ? 3 : 1;
    });
    return s;
  }

  /** The step's cones (render only: VisionCones.forced). */
  _cones() {
    const cones = this.game.cones;
    if (!cones || !('forced' in cones)) return;
    const list = this.wk.conesNow();
    const key = list.map((e) => e.id).join(',');
    if (key === this._lastForced && cones.forced) return;
    this._lastForced = key;
    cones.forced = new Set(list);
  }
}
