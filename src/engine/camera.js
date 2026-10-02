/**
 * Camera — design-spec §2.1–§2.3. Owned by CORE2.
 *
 * CameraController = ONE view: a BEL fixed 3/4 OrthographicCamera (pitch 40° below horizontal; yaw
 * CONFIG.camera.yawDeg / Options "Camera angle": 0 = BEL (map x = screen x, north up, walls face the screen head-on),
 * default +15° so axis-aligned buildings show a sliver of their shaded east side; ground depth foreshortened by
 * sin 40°). Panning, clamping, zoom anchoring and picking work in screen axes, so they follow the yaw.
 * Scale is defined in CSS pixels per metre (CONFIG.camera.pxPerMeterAt1x = 40 at 1×), so a larger window shows
 * more map. Discrete zoom
 * levels 0.5/1/2 tween over 0.25 s keeping the ground point under the cursor (wheel) or the screen
 * centre (keys) fixed; recentring tweens over 0.35 s; the target is clamped so the view shows at most
 * boundsMargin (4 m) beyond the map edge at yaw 0 (with yaw: see clampHalfExtents — every map point stays
 * reachable, the slanted corners may overshoot; a pan that meets the limit slides along it; recentres, tracking
 * and the briefing tour use focusTarget, void-free unless the point needs the loose limit); a view can track a unit.
 *
 * CameraRig = the multi-view manager (§2.3 F2–F7): 1–6 views with cycling layouts, each with its own
 * target, zoom and tracking; the active view gets a 2 px red frame and receives orders, zoom and
 * scrolling. Rendering uses a scissor + viewport per view. The rig also owns the camera DOM input:
 * edge scroll (whole window incl. the HUD), arrow keys (via Input.isDown), middle-drag and the wheel.
 * `game.cameraController` is the rig's active view.
 * @module engine/camera
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/math.js';

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Smoothstep easing for tweens. */
const ease = (t) => t * t * (3 - 2 * t);

export class CameraController {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.domElement the canvas (client-rect origin for picking)
   * @param {object} [opts.input] Input instance (legacy; the rig reads keys)
   * @param {object} [opts.config] overrides for CONFIG.camera
   */
  constructor({ domElement, input = null, config = {} } = {}) {
    this.cfg = { ...CONFIG.camera, ...config };
    this.domElement = domElement;
    this.input = input;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, this.cfg.distance * 2 + 400);
    this.camera.name = 'gameCamera';
    this.target = new THREE.Vector3(0, 0, 0);
    this.azimuth = THREE.MathUtils.degToRad(this.cfg.yawDeg);
    this.elevation = THREE.MathUtils.degToRad(this.cfg.pitchDeg);
    this.distance = this.cfg.distance;
    this.zoom = this.cfg.defaultZoom;
    this.zoomTarget = this.zoom;
    this.bounds = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    /**
     * Scenery apron (m) drawn past every map edge (art/apron.js), or null (no guarantee: unit tests, placeholder
     * ground). When set, the zoom floor keeps the view's true ground footprint inside it (see apronMinZoom): the
     * player never sees the void past the map at any zoom / yaw / aspect.
     */
    this.apron = null;
    /** Lowest / highest visual ground height (m) inside the apron (river beds, drifts): footprint slack. */
    this.groundRange = [-1.6, 1.2];
    /** Zoom floors already reported (one console line per map / view size / yaw). */
    this._apronLogged = new Set();
    /**
     * Height (CSS px) of the HUD top bar over this view's top edge (0 = none). The clamp and the programmatic focus
     * treat the view as the part BELOW it (usableHalf): every map point can be scrolled clear of the bar.
     */
    this.hudTop = 0;
    /** View rectangle inside the canvas, CSS px (multi-view). */
    this.rect = { x: 0, y: 0, w: 1, h: 1 };
    this.width = 1;
    this.height = 1;
    this.enabled = true;
    /** Entity the view follows (§2.3 tracking camera), or null. */
    this.tracking = null;
    this._zoomTween = null; // {from, to, t, dur, anchor:{gx, gz, ox, oz}}
    this._panTween = null; // {fx, fz, tx, tz, t, dur}
    this._applyTransform();
  }

  // ------------------------------------------------------------ transform

  /** Unit vector from target towards the camera: (sin yaw·cos 40°, sin 40°, cos yaw·cos 40°). */
  viewOffset(out = new THREE.Vector3()) {
    const ce = Math.cos(this.elevation);
    return out.set(Math.sin(this.azimuth) * ce, Math.sin(this.elevation), Math.cos(this.azimuth) * ce);
  }

  /** Camera yaw (deg, + swings the camera east so east faces show on screen-right); keeps the target. */
  setYaw(deg) {
    const a = THREE.MathUtils.degToRad(Number(deg) || 0);
    if (a === this.azimuth) return;
    this.azimuth = a;
    // the clamps depend on the yaw: re-aim at the old centre like a recentre, so switching the Options angle near
    // a map corner shows no void wedge (the loose manual-scroll clamp would leave up to ~11 m at 45°)
    const f = this.focusTarget(this.target.x, this.target.z);
    this.target.x = f.x;
    this.target.z = f.z;
    this._applyTransform();
  }

  /** Current yaw in degrees. */
  get yawDeg() {
    return THREE.MathUtils.radToDeg(this.azimuth);
  }

  /** CSS pixels per metre (along screen x) at the current zoom (§2.2: 40 × zoom). */
  pxPerMeter(zoom = this.zoom) {
    return this.cfg.pxPerMeterAt1x * zoom;
  }

  _applyTransform() {
    const mz = Math.max(this.minZoomForMap(), this.apronMinZoom()); // a resize/new map may make the view larger than the map
    if (this.zoom < mz) this.zoom = mz;
    if (this.zoomTarget < mz) this.zoomTarget = mz;
    this._clamp(); // zoom/resize change the view extents → re-clamp the target
    const cam = this.camera;
    const k = this.cfg.pxPerMeterAt1x;
    cam.left = -this.width / 2 / k;
    cam.right = this.width / 2 / k;
    cam.top = this.height / 2 / k;
    cam.bottom = -this.height / 2 / k;
    cam.zoom = this.zoom;
    cam.near = 1;
    cam.far = this.distance * 2 + 400;
    cam.position.copy(this.target).addScaledVector(this.viewOffset(_v), this.distance);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** Viewport size in CSS pixels (the view's rectangle size). */
  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rect.w = this.width;
    this.rect.h = this.height;
    this._applyTransform();
  }

  /** Place the view inside the canvas (CSS px, origin top-left). */
  setRect(x, y, w, h) {
    this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    this.resize(w, h);
  }

  /** HUD top-bar height over this view (CSS px); re-clamps when it changes. */
  setHudTop(px) {
    const v = Math.max(0, Number(px) || 0);
    if (Math.abs(v - this.hudTop) < 0.5) return;
    this.hudTop = v;
    this._applyTransform();
  }

  /**
   * The view part below the HUD top bar in ground metres: half-width `hw` (screen x), half-depth `hh` (screen-down,
   * foreshortened) and `sh`, how far its centre sits down-screen from the target. hudTop 0 → the whole view, sh 0.
   */
  usableHalf(zoom = this.zoom) {
    const ppm = this.pxPerMeter(zoom), fore = Math.sin(this.elevation) || 1;
    const top = Math.min(this.hudTop || 0, this.height * 0.5);
    return { hw: this.width / 2 / ppm, hh: (this.height - top) / 2 / ppm / fore, sh: top / 2 / ppm / fore };
  }

  /** World offset (m) from the target to the usable view's centre (sh along screen-down = (sin yaw, cos yaw)). */
  usableShift(zoom = this.zoom) {
    const sh = this.usableHalf(zoom).sh;
    return { x: sh * Math.sin(this.azimuth), z: sh * Math.cos(this.azimuth) };
  }

  /** Map bounds (m); the VIEW may show up to CONFIG.camera.boundsMargin beyond them (§2.3). */
  setBounds(width, depth) {
    const m = this.cfg.boundsMargin ?? 0;
    this.bounds = { minX: -m, minZ: -m, maxX: width + m, maxZ: depth + m };
    this._applyTransform(); // clamps
  }

  /**
   * Width (m) of the scenery apron past the map edges, or null; `range` = [lowest, highest] ground y in it.
   * Re-applies the zoom floor (apronMinZoom) and the clamp.
   */
  setApron(width, range = null) {
    this.apron = Number.isFinite(width) && width > 0 ? width : null;
    if (range) this.groundRange = [Math.min(0, range[0]), Math.max(0, range[1])];
    this._applyTransform();
  }

  /**
   * How far (m) past the map edge the view's TRUE ground footprint can reach at this zoom: the clamp margin, the
   * slanted-corner overshoot at the clamp limit, and the shift of the footprint when the screen-corner rays meet
   * ground below / above y = 0 (an orthographic ray moves h·cot(pitch) along the view per metre of height).
   */
  voidReach(zoom = this.zoom) {
    const M = this.cfg.boundsMargin ?? 0;
    const [lo, hi] = this.groundRange, cot = 1 / Math.tan(this.elevation);
    const slack = Math.max(-lo, hi) * cot;
    return M + this.clampOvershoot(zoom) + slack;
  }

  /** Smallest zoom whose voidReach stays inside the apron (0 without an apron). */
  apronMinZoom() {
    if (!this.apron) return 0;
    const ck = `${this.apron}|${this.width}|${this.height}|${this.hudTop}|${this.azimuth}|${this.groundRange}|${this.cfg.boundsMargin}`;
    if (this._apronZ?.k === ck) return this._apronZ.z;
    const z = this._apronMinZoom();
    this._apronZ = { k: ck, z };
    return z;
  }

  _apronMinZoom() {
    if (this.voidReach(this._zoomFloor()) <= this.apron) return 0;
    let lo = this._zoomFloor(), hi = Math.max(lo * 2, this.cfg.zoomLevels[this.cfg.zoomLevels.length - 1] * 2);
    if (this.voidReach(hi) > this.apron) return hi; // a view this large never fits: the closest zoom we allow
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (this.voidReach(m) > this.apron) lo = m; else hi = m; }
    const key = `${Math.round(this.bounds.maxX)}x${Math.round(this.bounds.maxZ)}@${Math.round(this.width)}x${Math.round(this.height)}/${Math.round(this.yawDeg)}`;
    if (!this._apronLogged.has(key)) {
      this._apronLogged.add(key);
      console.info(`[camera] zoom floor ${hi.toFixed(3)} (map ${key}): a wider view would show past the ${this.apron} m apron`);
    }
    return hi;
  }

  /** The lowest zoom setZoom accepts before the map / apron floors. */
  _zoomFloor() {
    return this.cfg.zoomLevels[0] * 0.5;
  }

  /** Half-extents (m, world x / z) of the visible ground footprint around the target. */
  viewHalfExtents(zoom = this.zoom) {
    const ppm = this.pxPerMeter(zoom);
    const hw = this.width / 2 / ppm;
    const hh = this.height / 2 / ppm / (Math.sin(this.elevation) || 1);
    const ca = Math.abs(Math.cos(this.azimuth)), sa = Math.abs(Math.sin(this.azimuth));
    return { x: hw * ca + hh * sa, z: hw * sa + hh * ca };
  }

  /**
   * Half-extents (m, world x / z) of the rectangle the TARGET is kept inside (inset from the bounds).
   * Yaw 0: the view's own half-extents (the view edge stops exactly boundsMargin past the map edge).
   * With yaw the view is a rotated rectangle: keeping it wholly inside the bounds would leave wedges along every
   * map edge (up to 2·hw·sin(yaw) m deep) that can never be scrolled into view. So the inset is the largest one
   * that still lets every map point come at least reachMargin (r, 2 m) inside the view: the inner rectangle
   * (hw−r, hh−r) scaled by k = min((hw−r)/ex', (hh−r)/ez') where ex'/ez' are its rotated extents, plus M —
   * never more than the strict (void-free) inset. The view's slanted corners may then show a little ground past
   * the margin (see clampOvershoot); the mid-points of the screen edges stay close to it.
   */
  clampHalfExtents(zoom = this.zoom) {
    const u = this.usableHalf(zoom);
    const ca = Math.abs(Math.cos(this.azimuth)), sa = Math.abs(Math.sin(this.azimuth));
    const e = { x: u.hw * ca + u.hh * sa, z: u.hw * sa + u.hh * ca };
    if (sa < 1e-9) return e;
    const M = this.cfg.boundsMargin ?? 0, r = Math.min(M, this.cfg.reachMargin ?? M);
    const hw = Math.max(0, u.hw - r);
    const hh = Math.max(0, u.hh - r);
    const rx = hw * ca + hh * sa, rz = hw * sa + hh * ca;
    const k = Math.min(rx > 0 ? hw / rx : 1, rz > 0 ? hh / rz : 1);
    return { x: Math.min(e.x, M + hw * k), z: Math.min(e.z, M + hh * k) };
  }

  /**
   * How far (m) past the bounds the view's farthest corner may reach at the clamp limit (0 at yaw 0 without a HUD
   * bar; with one, the bar's own depth at the north limit — the ground under the bar is drawn too).
   */
  clampOvershoot(zoom = this.zoom) {
    const e = this.viewHalfExtents(zoom), c = this.clampHalfExtents(zoom), s = this.usableShift(zoom);
    return Math.max(e.x - c.x + Math.abs(s.x), e.z - c.z + Math.abs(s.z));
  }

  /** Smallest zoom at which the view still fits inside the map bounds (a tiny map never shows past its margin). */
  minZoomForMap() {
    const b = this.bounds;
    if (!b) return 0;
    const f = (z) => { const e = this.clampHalfExtents(z); return Math.max(e.x / ((b.maxX - b.minX) / 2), e.z / ((b.maxZ - b.minZ) / 2)); };
    let z = f(1); // exact at yaw 0 (extents ∝ 1/zoom); with yaw the fixed margin term needs a few fixed-point steps
    if (Math.abs(Math.sin(this.azimuth)) > 1e-9) for (let i = 0; i < 8 && z > 0; i++) z *= f(z);
    return z;
  }

  /**
   * Keep the target inside the clamp rectangle (clampHalfExtents, applied to the usable view's centre — the target
   * shifted down-screen past the HUD bar); centre when the map is smaller than the view.
   */
  _clamp() {
    const f = this._looseFit(this.target.x, this.target.z);
    if (!f) return;
    this.target.x = f.x;
    this.target.z = f.z;
  }

  /** The manual-scroll clamp of a wanted target (x, z) (see _clamp), or null without bounds. */
  _looseFit(x, z) {
    const b = this.bounds;
    if (!b) return null;
    const e = this.clampHalfExtents(), s = this.usableShift();
    const fit = (v, lo, hi, half) => (hi - lo <= 2 * half ? (lo + hi) / 2 : clamp(v, lo + half, hi - half));
    return { x: fit(x + s.x, b.minX, b.maxX, e.x) - s.x, z: fit(z + s.z, b.minZ, b.maxZ, e.z) - s.z };
  }

  /**
   * Target for a PROGRAMMATIC look at (x, z) (recentre, tracking, briefing tour, save restore): the strict clamp
   * (view wholly inside the bounds, as at yaw 0), loosened toward the manual-scroll clamp only as far as needed to
   * bring the point `inset` (fraction of the half-view; CONFIG focusInset) inside the play view — the part below the
   * HUD top bar (usableHalf), so the point never lands under the bar. With yaw this keeps the slanted wedges the
   * loose clamp allows (clampHalfExtents) to deliberate pushes against the map edge. Yaw 0: plain clamp.
   */
  focusTarget(x, z, inset = this.cfg.focusInset ?? 0.24) {
    const b = this.bounds;
    if (!b) return { x, z };
    const fit = (v, lo, hi, half) => (hi - lo <= 2 * half ? (lo + hi) / 2 : clamp(v, lo + half, hi - half));
    const u = this.usableHalf(), s = this.usableShift();
    const L = this._looseFit(x - s.x, z - s.z); // the point at the centre of the view part below the HUD bar
    if (Math.abs(Math.sin(this.azimuth)) < 1e-9) return L;
    const se = this.viewHalfExtents(), S = { x: fit(x - s.x, b.minX, b.maxX, se.x), z: fit(z - s.z, b.minZ, b.maxZ, se.z) };
    const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth);
    const k = 1 - inset;
    const hw = u.hw * k, hh = u.hh * k;
    const sees = (t) => {
      const dx = x - t.x, dz = z - t.z;
      return Math.abs(dx * ca - dz * sa) <= hw + 1e-9 && Math.abs(dx * sa + dz * ca - u.sh) <= hh + 1e-9;
    };
    if (sees(S)) return S;
    const at = (f) => ({ x: S.x + (L.x - S.x) * f, z: S.z + (L.z - S.z) * f });
    if (!sees(L)) return L;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (sees(at(m))) hi = m; else lo = m; }
    return at(hi);
  }

  /**
   * Centre the view on a ground point immediately (cancels a recentre tween); see focusTarget.
   * @param {number} [inset] focusTarget's inset (fraction of the half-view kept clear around the point)
   */
  centerOn(x, z, inset) {
    this._panTween = null;
    const f = this.focusTarget(x, z, inset);
    this.target.set(f.x, 0, f.z);
    this._applyTransform();
  }

  /**
   * Recentre with a tween (§2.3: 0.35 s). @param {number} [dur] seconds (0 = immediate)
   */
  recenterOn(x, z, dur = this.cfg.recenterTween) {
    if (!(dur > 0)) return this.centerOn(x, z);
    const f = this.focusTarget(x, z);
    this._panTween = { fx: this.target.x, fz: this.target.z, tx: f.x, tz: f.z, t: 0, dur };
  }

  /** Is a ground point inside this view (with an inset margin in CSS px)? */
  isOnScreen(x, z, marginPx = 0, y = 0) {
    const p = this.worldToView(x, y, z);
    return p.x >= marginPx && p.x <= this.width - marginPx && p.y >= marginPx && p.y <= this.height - marginPx;
  }

  /** Like isOnScreen, but the top limit is the HUD top bar's lower edge (+ margin): visible to the player. */
  isVisible(x, z, marginPx = 0, y = 0) {
    const p = this.worldToView(x, y, z);
    return p.x >= marginPx && p.x <= this.width - marginPx && p.y >= this.hudTop + marginPx && p.y <= this.height - marginPx;
  }

  /** Pan by a world-space ground offset (m). */
  panBy(dx, dz) {
    this.target.x += dx;
    this.target.z += dz;
    this._applyTransform();
  }

  /** Pan by screen pixels (drag, 1:1): the ground moves with the cursor. */
  panScreen(dxPx, dyPx) {
    const ppm = this.pxPerMeter();
    const fore = Math.sin(this.elevation) || 1; // one screen px of height spans 1/sin(el) px-metres of ground
    this._panScreenMetres(dxPx / ppm, dyPx / ppm / fore);
  }

  /**
   * Pan by ground metres along screen-right (gx) and screen-down (gy). With yaw a screen axis is slanted against the
   * map edges: a move that meets a clamp edge keeps its component ALONG that edge and slides the view along it
   * (per-axis clamp), so holding Up against the west limit still climbs to the north edge (verifier: M1 objective).
   */
  _panScreenMetres(gx, gy) {
    const ca = Math.cos(this.azimuth), sa = Math.sin(this.azimuth);
    this.target.x += gx * ca + gy * sa;
    this.target.z += -gx * sa + gy * ca;
    this._applyTransform(); // clamps each world axis on its own = slide along the edge
  }

  // ------------------------------------------------------------ zoom

  /** Nearest discrete level index to a zoom value. */
  _levelIndex(z) {
    const L = this.cfg.zoomLevels;
    let best = 0;
    for (let i = 1; i < L.length; i++) if (Math.abs(L[i] - z) < Math.abs(L[best] - z)) best = i;
    return best;
  }

  /**
   * Set the zoom (1 = 40 CSS px/m).
   * @param {number} z
   * @param {boolean} [immediate=true] false → tween (0.25 s) around the screen centre
   */
  setZoom(z, immediate = true) {
    const L = this.cfg.zoomLevels;
    const to = Math.max(clamp(z, L[0] * 0.5, L[L.length - 1] * 2), this.minZoomForMap(), this.apronMinZoom());
    this.zoomTarget = to;
    if (immediate) {
      this._zoomTween = null;
      this.zoom = to;
      this._applyTransform();
    } else {
      this._zoomTween = { from: this.zoom, to, t: 0, dur: this.cfg.zoomTween, anchor: null };
    }
  }

  /**
   * Step one discrete level (§2.2). With a client point (wheel) the ground under the cursor stays
   * fixed during the tween; without one (numpad keys) the screen centre stays fixed.
   * @param {number} dir +1 zoom in, −1 zoom out
   */
  zoomStep(dir, clientX, clientY) {
    const L = this.cfg.zoomLevels;
    const i = clamp(this._levelIndex(this.zoomTarget) + Math.sign(dir), 0, L.length - 1);
    this._zoomTo(L[i], clientX, clientY);
  }

  /** Numpad * / Backspace: back to 1× around the screen centre. */
  zoomReset() {
    this._zoomTo(this.cfg.defaultZoom);
  }

  /**
   * Continuous zoom (touch pinch), immediate: the ground under the client point (the fingers' midpoint) stays put.
   * Kept within the discrete levels' range (0.5×–2×) and the map's zoom floor; the target is re-clamped.
   * @returns {number} the zoom applied
   */
  zoomAt(z, clientX, clientY) {
    const L = this.cfg.zoomLevels;
    const to = Math.max(clamp(z, L[0], L[L.length - 1]), this.minZoomForMap());
    const before = this.screenToGround(clientX, clientY);
    this._zoomTween = null;
    this._panTween = null;
    this.zoom = this.zoomTarget = to;
    this._applyTransform();
    const after = before && this.screenToGround(clientX, clientY);
    if (after) this.panBy(before.x - after.x, before.z - after.z);
    return this.zoom;
  }

  _zoomTo(level, clientX, clientY) {
    const to = Math.max(level, this.minZoomForMap(), this.apronMinZoom());
    if (Math.abs(to - this.zoomTarget) < 1e-6 && !this._zoomTween) return;
    let anchor = null;
    if (clientX !== undefined && clientY !== undefined) {
      const g = this.screenToGround(clientX, clientY);
      if (g) anchor = { gx: g.x, gz: g.z, ox: g.x - this.target.x, oz: g.z - this.target.z, z0: this.zoom };
    }
    this.zoomTarget = to;
    this._zoomTween = { from: this.zoom, to, t: 0, dur: this.cfg.zoomTween, anchor };
  }

  /** True while a zoom or recentre tween runs. */
  get tweening() {
    return !!(this._zoomTween || this._panTween);
  }

  // ------------------------------------------------------------ tracking

  /** Lock the view onto a unit (commando, enemy or vehicle), §2.3. */
  track(entity) {
    this.tracking = entity || null;
    this._panTween = null;
    if (entity) this.centerOn(entity.x, entity.z);
  }

  untrack() {
    this.tracking = null;
  }

  // ------------------------------------------------------------ per frame

  /**
   * Per-frame update (real time, independent of the simulation): tweens, tracking, panning.
   * @param {number} dt seconds
   * @param {{x:number, y:number}} [pan] pan direction (−1..1 per axis, screen space) from keys / edge
   */
  update(dt, pan = null) {
    const zt = this._zoomTween;
    if (zt) {
      zt.t = Math.min(1, zt.t + (zt.dur > 0 ? dt / zt.dur : 1));
      this.zoom = zt.from + (zt.to - zt.from) * ease(zt.t);
      if (zt.anchor) {
        // ground offset from the target to the anchor scales with 1/zoom (orthographic)
        const a = zt.anchor, s = a.z0 / this.zoom;
        this.target.x = a.gx - a.ox * s;
        this.target.z = a.gz - a.oz * s;
      }
      if (zt.t >= 1) { this.zoom = zt.to; this._zoomTween = null; }
      this._applyTransform();
    }
    const pt = this._panTween;
    if (pt && !this.tracking) {
      pt.t = Math.min(1, pt.t + (pt.dur > 0 ? dt / pt.dur : 1));
      const k = ease(pt.t);
      this.target.x = pt.fx + (pt.tx - pt.fx) * k;
      this.target.z = pt.fz + (pt.tz - pt.fz) * k;
      if (pt.t >= 1) this._panTween = null;
      this._applyTransform();
    }
    const tr = this.tracking;
    if (tr) {
      if (tr.removed) this.tracking = null;
      else {
        const f = this.focusTarget(tr.x, tr.z);
        this.target.x = f.x;
        this.target.z = f.z;
        this._applyTransform();
      }
    }
    if (!this.enabled || this.tracking || !pan || (!pan.x && !pan.y)) return;
    const speed = this.cfg.scrollSpeed / this.zoom; // §2.3: 30 m/s ÷ zoom (ground metres)
    this._panTween = null;
    this._panScreenMetres(pan.x * speed * dt, pan.y * speed * dt);
  }

  // ------------------------------------------------------------ projection helpers

  /** Client-space origin of this view (canvas rect + view rect). */
  _origin() {
    const r = this.domElement?.getBoundingClientRect?.() || { left: 0, top: 0 };
    return { left: r.left + this.rect.x, top: r.top + this.rect.y };
  }

  /** Is a client point inside this view's rectangle? */
  contains(clientX, clientY) {
    const o = this._origin();
    return clientX >= o.left && clientX < o.left + this.width && clientY >= o.top && clientY < o.top + this.height;
  }

  /**
   * Ground point (y = `height`) under a client-space pixel, or null if the ray misses.
   * @returns {{x:number, z:number} | null}
   */
  screenToGround(clientX, clientY, height = 0) {
    const o = this._origin();
    _ndc.set(((clientX - o.left) / this.width) * 2 - 1, -((clientY - o.top) / this.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.camera);
    _plane.constant = -height;
    const hit = _ray.ray.intersectPlane(_plane, _v);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** View-local CSS pixel of a world point (origin = the view's top-left). */
  worldToView(x, y, z) {
    _v.set(x, y, z).project(this.camera);
    return { x: ((_v.x + 1) / 2) * this.width, y: ((1 - _v.y) / 2) * this.height, visible: Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 };
  }

  /**
   * Client-space pixel of a world point.
   * @returns {{x:number, y:number, visible:boolean}}
   */
  worldToScreen(x, y, z) {
    const o = this._origin();
    const p = this.worldToView(x, y, z);
    return { x: o.left + p.x, y: o.top + p.y, visible: p.visible };
  }

  /**
   * The four corners of the view intersected with the horizontal plane at height `y` (shadow fit).
   * @param {number} [y=0]
   * @returns {{x:number, y:number, z:number}[]}
   */
  groundFootprint(y = 0) {
    const out = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _ndc.set(nx, ny);
      _ray.setFromCamera(_ndc, this.camera);
      _plane.constant = -y;
      const hit = _ray.ray.intersectPlane(_plane, _v);
      if (hit) out.push({ x: hit.x, y, z: hit.z });
    }
    return out;
  }

  /** Serializable view state (save games). */
  getState() {
    return { x: this.target.x, z: this.target.z, zoom: this.zoomTarget, track: this.tracking?.id ?? null };
  }

  /** Restore getState() output; `resolve(id)` maps a tracked entity id back to the entity. */
  setState(s, resolve = null) {
    if (!s) return;
    if (Number.isFinite(s.zoom)) this.setZoom(s.zoom);
    if (Number.isFinite(s.x)) { // the saved target itself (re-clamped), not a recentre on it (focusTarget shifts past the HUD bar)
      this._panTween = null;
      this.target.set(s.x, 0, s.z);
      this._applyTransform();
    }
    this.tracking = s.track != null && resolve ? resolve(s.track) || null : null;
  }

  /** Copy target/zoom/bounds from another view (new multi-view panes start as a copy). */
  copyFrom(o) {
    this.bounds = { ...o.bounds };
    this.apron = o.apron;
    this.groundRange = o.groundRange.slice();
    this.azimuth = o.azimuth;
    this.zoom = this.zoomTarget = o.zoomTarget;
    this.target.copy(o.target);
    this._applyTransform();
  }

  dispose() {}
}

// ================================================================ multi-view

/**
 * Multi-view layouts per view count (§2.3): arrays of [x, y, w, h] fractions of the canvas; the
 * first rect is view 1. Repeating an F-key cycles the layouts of its count.
 */
export const VIEW_LAYOUTS = Object.freeze({
  1: [[[0, 0, 1, 1]]],
  2: [
    [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]], // side by side
    [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]], // stacked
  ],
  3: [
    [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]], // 1 big + 2
    [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]], // 3 columns
    [[0, 0, 1, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]], // 1 wide + 2
  ],
  4: [
    [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]], // 2×2
    [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 1 / 3, 1 / 3]], // 1 big + 3
  ],
  5: [
    [[0, 0, 0.5, 1], [0.5, 0, 0.25, 0.5], [0.75, 0, 0.25, 0.5], [0.5, 0.5, 0.25, 0.5], [0.75, 0.5, 0.25, 0.5]], // 1 big + 4
    [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]], // 2 + 3
  ],
  6: [
    [[0, 0, 1 / 3, 0.5], [1 / 3, 0, 1 / 3, 0.5], [2 / 3, 0, 1 / 3, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]], // 3×2
    [[0, 0, 2 / 3, 2 / 3], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], [0, 2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 1 / 3, 1 / 3]], // 1 big + 5
  ],
});

const CAMERA_ICON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/></svg>';

export class CameraRig {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.domElement the canvas
   * @param {object} [opts.input] Input (arrow keys via isDown('panLeft'…)); may be attached later
   * @param {object} [opts.config] overrides for CONFIG.camera
   * @param {() => number} [opts.uiScale] HUD scale (edge zone = edgePx × uiScale CSS px)
   * @param {() => number} [opts.hudTop] height (CSS px) of the HUD top bar over the canvas top (views clear it)
   */
  constructor({ domElement, input = null, config = {}, uiScale = null, hudTop = null } = {}) {
    this.cfg = { ...CONFIG.camera, ...config };
    this.domElement = domElement;
    this.input = input;
    this.uiScale = uiScale || (() => 1);
    this.hudTop = hudTop || (() => 0);
    this.views = [new CameraController({ domElement, config })];
    this.activeIndex = 0;
    this.count = 1;
    this.layout = 0;
    this.canvasW = 1;
    this.canvasH = 1;
    /** The camera handed to the Renderer (a copy of the active view's camera in single-view mode). */
    this.mainCamera = this.views[0].camera.clone();
    this.mainCamera.name = 'gameCamera';
    /** §2.3 edge scroll on/off, and whether it also works over the HUD (BEL; the modern option disables). */
    this.edgeScroll = this.cfg.edgeScroll !== false;
    this.edgeOverHud = true;
    this.enabled = true;
    /** §6.8 faithful pause: user scrolling (arrows, edge, middle-drag) is frozen; tweens and zoom still run. */
    this.panLocked = false;
    /** A scripted camera move owns the view (the briefing tour): Game.render locks user scrolling while it is set. */
    this.scripted = false;
    /** Called after views/layout/active change: fn(rig). */
    this.onChange = null;
    this._pointer = { x: 0, y: 0, inside: false, overCanvas: false };
    this._drag = null;
    this._listeners = [];
    this._dom = null; // {frame, badges[]}
    if (domElement) this._attach();
  }

  /** The active view (orders, zoom and scrolling apply to it). */
  get active() {
    return this.views[this.activeIndex];
  }

  // ------------------------------------------------------------ DOM input

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  _attach() {
    const el = this.domElement;
    // Edge scroll works wherever the pointer is inside the window — including over the HUD (§2.3).
    this._on(window, 'pointermove', (e) => {
      // a finger is not a hovering cursor: no edge scroll (touch panning is input/touch-game.js)
      if (e.pointerType === 'touch') { this._pointer.inside = false; return; }
      const r = el.getBoundingClientRect();
      this._pointer.x = e.clientX - r.left;
      this._pointer.y = e.clientY - r.top;
      this._pointer.inside = true;
      this._pointer.overCanvas = e.target === el;
      if (this._drag) {
        const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
        if (!this.panLocked) this.active.panScreen(-dx, -dy);
      }
    });
    this._on(document, 'pointerout', (e) => { if (!e.relatedTarget) this._pointer.inside = false; });
    this._on(window, 'blur', () => { this._pointer.inside = false; this._drag = null; });
    this._on(el, 'pointerdown', (e) => {
      if (e.button !== 1 || !this.enabled) return;
      e.preventDefault();
      if (this.panLocked) return; // §6.8 faithful pause: no middle-drag scrolling
      this._drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
      document.body.dataset.cursor = 'pan';
    });
    const endDrag = (e) => {
      if (this._drag && (e.button === 1 || e.type === 'pointercancel')) {
        this._drag = null;
        el.releasePointerCapture?.(e.pointerId);
        if (document.body.dataset.cursor === 'pan') document.body.dataset.cursor = '';
      }
    };
    this._on(el, 'pointerup', endDrag);
    this._on(el, 'pointercancel', endDrag);
    this._on(el, 'wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.deltaY === 0 || this.wheelZoom === false) return; // §6.8 option "wheel zoom
      const v = this.active;
      const inside = v.contains(e.clientX, e.clientY);
      v.zoomStep(e.deltaY < 0 ? 1 : -1, inside ? e.clientX : undefined, inside ? e.clientY : undefined);
    }, { passive: false });
    this._on(el, 'auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  /** Simulate the pointer position (tests / synthetic input): canvas-relative CSS px. */
  setPointer(x, y, inside = true, overCanvas = true) {
    Object.assign(this._pointer, { x, y, inside, overCanvas });
  }

  /** Current pan direction from arrow keys and the screen edges. */
  panInput() {
    let x = 0, y = 0;
    const inp = this.input;
    if (inp?.isDown) {
      if (inp.isDown('panLeft')) x -= 1;
      if (inp.isDown('panRight')) x += 1;
      if (inp.isDown('panUp')) y -= 1;
      if (inp.isDown('panDown')) y += 1;
    }
    const p = this._pointer;
    const hasFocus = typeof document === 'undefined' || document.hasFocus?.() !== false;
    if (this.edgeScroll && p.inside && !this._drag && hasFocus && (this.edgeOverHud || p.overCanvas)) {
      const e = this.cfg.edgePx * (this.uiScale() || 1);
      if (p.x <= e) x -= 1;
      else if (p.x >= this.canvasW - e) x += 1;
      if (p.y <= e) y -= 1;
      else if (p.y >= this.canvasH - e) y += 1;
    }
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  // ------------------------------------------------------------ views

  /**
   * F2–F7 (§2.3): show `n` views (1–6). Repeating the current count cycles its layouts. New views
   * start as copies of the active view; each keeps its own target, zoom and tracking afterwards.
   */
  setViews(n) {
    n = clamp(Math.round(n), 1, 6);
    if (n === this.count) {
      this.layout = (this.layout + 1) % VIEW_LAYOUTS[n].length;
    } else {
      const src = this.active;
      while (this.views.length < n) {
        const v = new CameraController({ domElement: this.domElement, config: this.cfg });
        v.copyFrom(src);
        this.views.push(v);
      }
      if (n < this.views.length) {
        // keep the active view as view 1 when shrinking so the player's current view survives
        if (this.activeIndex >= n) {
          const a = this.views.splice(this.activeIndex, 1)[0];
          this.views.unshift(a);
          this.activeIndex = 0;
        }
        this.views.length = n;
      }
      this.count = n;
      this.layout = 0;
    }
    this._layoutViews();
    this._updateDom();
    this.onChange?.(this);
    return { count: this.count, layout: this.layout };
  }

  /** Activate view i (click a view). */
  activate(i) {
    if (i < 0 || i >= this.count || i === this.activeIndex) return false;
    this.activeIndex = i;
    this._updateDom();
    this.onChange?.(this);
    return true;
  }

  /** Index of the view under a client point (−1 outside every view). */
  viewAt(clientX, clientY) {
    for (let i = 0; i < this.count; i++) if (this.views[i].contains(clientX, clientY)) return i;
    return -1;
  }

  /** Current layout rects in CSS px (canvas-relative). */
  rects() {
    return this.views.slice(0, this.count).map((v) => ({ ...v.rect }));
  }

  _layoutViews() {
    const L = VIEW_LAYOUTS[this.count][this.layout];
    const W = this.canvasW, H = this.canvasH;
    for (let i = 0; i < this.count; i++) {
      const [fx, fy, fw, fh] = L[i];
      const x = Math.round(fx * W), y = Math.round(fy * H);
      this.views[i].setRect(x, y, Math.round((fx + fw) * W) - x, Math.round((fy + fh) * H) - y);
    }
    this._syncHud();
  }

  /** Tell each view how much of its top the HUD top bar covers (CameraController.setHudTop). */
  _syncHud() {
    const top = Math.max(0, Number(this.hudTop()) || 0);
    for (let i = 0; i < this.count; i++) this.views[i].setHudTop(top - this.views[i].rect.y);
  }

  /** Canvas size in CSS px. */
  resize(width, height) {
    this.canvasW = Math.max(1, width);
    this.canvasH = Math.max(1, height);
    this._layoutViews();
  }

  setBounds(width, depth) {
    for (const v of this.views) v.setBounds(width, depth);
  }

  /** Scenery apron past the map edges for every view (CameraController.setApron). */
  setApron(width, range = null) {
    for (const v of this.views) v.setApron(width, range);
  }

  /** Options "Camera angle": yaw (deg) for every view, current and future. */
  setYaw(deg) {
    this.cfg.yawDeg = Number(deg) || 0;
    for (const v of this.views) v.setYaw(this.cfg.yawDeg);
  }

  /** Back to one untracked view (mission load). */
  reset() {
    for (const v of this.views) v.untrack();
    if (this.count !== 1 || this.activeIndex !== 0) {
      const a = this.active;
      this.views = [a];
      this.activeIndex = 0;
      this.count = 1;
      this.layout = 0;
      this._layoutViews();
      this._updateDom();
      this.onChange?.(this);
    }
  }

  /**
   * Per-frame update: the active view gets scrolling input; every view runs its tweens/tracking.
   * @param {number} dt seconds (real time)
   */
  update(dt) {
    const pan = this.enabled && !this.panLocked ? this.panInput() : null;
    this._syncHud(); // the UI scale (and so the bar) follows the window / Options
    for (let i = 0; i < this.count; i++) this.views[i].update(dt, i === this.activeIndex ? pan : null);
    this._updateDom();
  }

  /** Union footprint of every visible view (the shadow fit covers all views). */
  groundFootprint(y = 0) {
    if (this.count === 1) return this.active.groundFootprint(y);
    const out = [];
    for (let i = 0; i < this.count; i++) out.push(...this.views[i].groundFootprint(y));
    return out;
  }

  getState() {
    return { count: this.count, layout: this.layout, active: this.activeIndex, views: this.views.slice(0, this.count).map((v) => v.getState()) };
  }

  /** Restore getState(); `resolve(id)` → entity for tracked views. */
  setState(s, resolve = null) {
    if (!s?.views) return;
    this.reset();
    if (s.count > 1) this.setViews(s.count);
    for (let k = 0; k < 8 && this.layout !== (s.layout || 0); k++) this.setViews(this.count);
    s.views.forEach((vs, i) => this.views[i]?.setState(vs, resolve));
    this.activeIndex = clamp(s.active || 0, 0, this.count - 1);
    this._updateDom();
    this.onChange?.(this);
  }

  // ------------------------------------------------------------ rendering

  /**
   * Draw the frame. One view: the Renderer's full pipeline (post-processing) with `mainCamera` set to
   * the active view. Several views: a scissor + viewport per view with the plain forward path (world,
   * decals, overlay) — the "medium" look for the extra views (§2.3).
   * @param {import('./renderer.js').Renderer} R
   * @param {number} dt
   */
  render(R, dt) {
    this.mainCamera.copy(this.active.camera);
    // camera shake (explosions): an offset in the camera plane from `shake()` → {x, y} m, or null (none / reduced motion)
    const sh = this.shake?.();
    if (sh && (sh.x || sh.y)) { this.mainCamera.translateX(sh.x); this.mainCamera.translateY(sh.y); }
    this.mainCamera.updateMatrixWorld();
    if (this.count === 1) {
      R.render(dt);
      return;
    }
    const r = R.renderer;
    R.frame = (R.frame || 0) + 1;
    r.info.autoReset = false;
    r.info.reset();
    const prevAuto = r.autoClear;
    const prevTone = r.toneMapping;
    r.setRenderTarget(null);
    r.setScissorTest(true);
    for (let i = 0; i < this.count; i++) {
      const v = this.views[i];
      const { x, y, w, h } = v.rect;
      const yb = this.canvasH - y - h; // WebGL viewport origin is bottom-left
      r.setViewport(x, yb, w, h);
      r.setScissor(x, yb, w, h);
      r.autoClear = true;
      r.toneMapping = prevTone;
      r.render(R.scene, v.camera);
      r.autoClear = false;
      if (R.decalScene?.children.length) r.render(R.decalScene, v.camera);
      if (R.overlayScene?.children.length) {
        r.toneMapping = THREE.NoToneMapping;
        r.clearDepth();
        r.render(R.overlayScene, v.camera);
      }
    }
    r.toneMapping = prevTone;
    r.autoClear = prevAuto;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.canvasW, this.canvasH);
  }

  // ------------------------------------------------------------ DOM overlay (red frame, tracking badges)

  _ensureDom() {
    if (this._dom || typeof document === 'undefined' || !document.body) return this._dom;
    const frame = document.createElement('div');
    frame.className = 'view-active-frame';
    Object.assign(frame.style, {
      position: 'fixed', boxSizing: 'border-box', border: '2px solid rgb(220,0,0)', pointerEvents: 'none',
      zIndex: '4', display: 'none',
    });
    document.body.appendChild(frame);
    this._dom = { frame, badges: [] };
    return this._dom;
  }

  _badge(i) {
    const d = this._dom;
    if (!d.badges[i]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'view-track-badge';
      b.title = 'Tracking camera: click to release';
      b.innerHTML = CAMERA_ICON_SVG;
      Object.assign(b.style, {
        position: 'fixed', zIndex: '5', width: '28px', height: '28px', padding: '3px', display: 'none',
        border: '1px solid rgb(90,75,50)', background: 'rgba(20,18,12,0.75)', color: 'rgb(230,200,120)', cursor: 'pointer',
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.views[i]?.untrack();
      });
      document.body.appendChild(b);
      d.badges[i] = b;
    }
    return d.badges[i];
  }

  _updateDom() {
    const d = this._ensureDom();
    if (!d) return;
    const cr = this.domElement?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const f = d.frame;
    if (this.count > 1) {
      const r = this.active.rect;
      const s = f.style;
      const want = `${cr.left + r.x}px,${cr.top + r.y}px,${r.w}px,${r.h}px`;
      if (f._pos !== want || s.display !== 'block') {
        f._pos = want;
        Object.assign(s, { display: 'block', left: `${cr.left + r.x}px`, top: `${cr.top + r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      }
    } else if (f.style.display !== 'none') f.style.display = 'none';
    const n = Math.max(this.count, d.badges.length);
    for (let i = 0; i < n; i++) {
      const v = i < this.count ? this.views[i] : null;
      const on = !!v?.tracking;
      if (!on && !d.badges[i]) continue;
      const b = this._badge(i);
      if (on) {
        const r = v.rect;
        Object.assign(b.style, { display: 'block', left: `${cr.left + r.x + 8}px`, top: `${cr.top + r.y + r.h - 36}px` });
      } else if (b.style.display !== 'none') b.style.display = 'none';
    }
  }

  dispose() {
    for (const off of this._listeners) off();
    this._listeners.length = 0;
    if (this._dom) {
      this._dom.frame.remove();
      for (const b of this._dom.badges) b?.remove();
      this._dom = null;
    }
  }
}
