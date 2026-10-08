/**
 * Vision cones — owned by AI (design-spec §4.2 Display, §10.2). The drawn cone IS the detection geometry:
 * the fan is perception.coneAt(enemy) (apex, head heading, ±halfFov, near(θ) = far(θ)/2, far(θ)) cut by
 * grid.castRay — the same DDA, static blocks, raised cells and dynamic (vehicle) occluders that
 * perception.canSee's grid.lineOfSight uses. Rays: ≥ 96 across the aperture (≤ 0.75° apart), then
 * adaptive refinement: an interval is split while its mid ray's hit point lies more than
 * CONFIG.stealth.coneRayTol from the chord of its neighbours, so occluder corners get rays at angle ± ε
 * (tests/unit/cone-fidelity.test.mjs samples 2,000 points against this polygon).
 *
 * Look [EXE]: flat 50% alpha, hard edges, BEL palette green (#02BC6F near / #07675A far) or desert orange
 * (#D26E02 / #6B4C01) from mission.coneColors; ground layer (Renderer.decalScene: depth-tested, so trees,
 * roofs and tall props draw over it). No colour change by alert level unless CONFIG.stealth.alertTint.
 * VisionCones shows ONE cone at a time (CONFIG.stealth.multiCone), brightens the spotter's cone to 75% for
 * 1 s (§4.2 "automatically illuminated") and draws the red 0.6 m probe ring (setProbe(x, z)).
 * @module render/vision-cone
 */

import * as THREE from 'three';
import { ownerHeight } from '../world/placement.js';
import { CONFIG } from '../config.js';
import { coneAt, probe as probeCone, postOwner } from '../ai/perception.js';

const Y = 0.07;
/** Rebuild thresholds: 2 cm / ~0.06°. */
const EPS_POS = 0.02, EPS_ANG = 0.001;
const DEG = Math.PI / 180;

/** Legacy export (alertTint colours by alertLevel 0/1/2). */
export const CONE_COLORS = [0x02bc6f, 0xe0c030, 0xe04030];

/** Near/far colours (hex numbers) of a palette name ('green' | 'desert'). */
export function paletteColors(name = 'green') {
  const p = CONFIG.stealth.coneColors[name] || CONFIG.stealth.coneColors.green;
  return { near: new THREE.Color(p.near).getHex(), far: new THREE.Color(p.far).getHex() };
}

/**
 * The cone fan of a viewer: angles (rad, ascending) and ray lengths clipped at far (m).
 * @param {object} enemy viewer (coneAt input)
 * @param {object|null} grid NavGrid (castRay) or null (no occlusion)
 * @param {{t?: number, rays?: number, tol?: number, maxRays?: number}} [o]
 * @returns {{cone: object, angles: number[], dists: number[]}|null}
 */
export function coneFan(enemy, grid, o = {}) {
  const cone = coneAt(enemy, o.t);
  if (!cone) return null;
  const S = CONFIG.stealth;
  const fov = cone.halfFov * 2;
  const base = Math.max(o.rays ?? S.coneRays, Math.ceil(fov / (0.75 * DEG)));
  const tol = o.tol ?? S.coneRayTol;
  const maxRays = o.maxRays ?? S.coneMaxRays;
  const castOpts = { viewerElevated: cone.elevated, viewerY: cone.vy, ownHull: enemy.ownHull, ownOwner: postOwner(enemy, enemy.world),
    overWalls: cone.overWalls && enemy.world ? { heightOf: ownerHeight(enemy.world), eyeY: cone.y } : undefined };
  const cast = grid ? (a) => grid.castRay(cone.x, cone.z, a, cone.far, castOpts) : () => cone.far;
  const a0 = cone.heading - cone.halfFov;
  const angles = [], dists = [];
  let count = base + 1;
  const MIN_DA = 2e-5;
  // chord error of the mid ray against the segment p0→p1 (XZ, relative to the apex)
  const err = (aa, da, ab, db, am, dm) => {
    const x0 = Math.cos(aa) * da, z0 = Math.sin(aa) * da, x1 = Math.cos(ab) * db, z1 = Math.sin(ab) * db;
    const xm = Math.cos(am) * dm, zm = Math.sin(am) * dm;
    const ex = x1 - x0, ez = z1 - z0, L2 = ex * ex + ez * ez;
    let u = L2 > 0 ? ((xm - x0) * ex + (zm - z0) * ez) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    return Math.hypot(xm - (x0 + ex * u), zm - (z0 + ez * u));
  };
  const refine = (aa, da, ab, db, depth) => {
    if (ab - aa < MIN_DA || count >= maxRays || depth > 24) return;
    const am = (aa + ab) / 2, dm = cast(am);
    // split while the mid hit is off the chord, or across a depth discontinuity (occluder corner / shadow
    // edge) until the two rays are within 2 cm of each other at their far end (angle ± ε)
    const jump = Math.abs(da - db) > 0.5 && (ab - aa) * Math.max(da, db) > 0.02;
    if (!jump && err(aa, da, ab, db, am, dm) <= tol) return;
    count++;
    refine(aa, da, am, dm, depth + 1);
    angles.push(am); dists.push(dm);
    refine(am, dm, ab, db, depth + 1);
  };
  let pa = a0, pd = cast(a0);
  angles.push(pa); dists.push(pd);
  for (let k = 1; k <= base; k++) {
    const a = a0 + (fov * k) / base, d = cast(a);
    refine(pa, pd, a, d, 0);
    angles.push(a); dists.push(d);
    pa = a; pd = d;
  }
  return { cone, angles, dists };
}

/**
 * The drawn polygons of a fan in world XZ: `far` = apex + outer boundary min(hit, far(θ)) (the whole cone
 * a standing target is seen in), `near` = apex + min(hit, near(θ)) (crawlers). Used by tests.
 * @returns {{far: number[][], near: number[][]}}
 */
export function conePolygons(fan) {
  const { cone, angles, dists } = fan;
  const far = [[cone.x, cone.z]], near = [[cone.x, cone.z]];
  for (let k = 0; k < angles.length; k++) {
    const c = Math.cos(angles[k]), s = Math.sin(angles[k]);
    const df = Math.min(dists[k], cone.far), dn = Math.min(dists[k], cone.near);
    far.push([cone.x + c * df, cone.z + s * df]);
    near.push([cone.x + c * dn, cone.z + s * dn]);
  }
  return { far, near };
}

/** One enemy's cone mesh: near fan + far ring, sharing one ray set. */
export class VisionCone {
  /**
   * Accepts `new VisionCone(enemy, world, opts)` or `new VisionCone(opts)`.
   * @param {object} [enemy] @param {object} [world]
   * @param {{palette?: 'green'|'desert', alertTint?: boolean, maxRays?: number}} [opts]
   */
  constructor(enemy = null, world = null, opts = {}) {
    if (enemy && !enemy.vision && !enemy.kind && world == null) { opts = enemy; enemy = null; }
    this.enemy = enemy;
    this.world = world;
    this.opts = opts;
    this.cap = (opts.maxRays ?? CONFIG.stealth.coneMaxRays) + 2;
    const n = this.cap;
    this.group = new THREE.Group();
    this.group.name = 'vision-cone';
    this.group.renderOrder = 5;
    this.nearGeo = new THREE.BufferGeometry();
    this.nearGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
    const ni = new Uint32Array((n - 1) * 3);
    for (let k = 0; k < n - 1; k++) ni.set([0, k + 2, k + 1], k * 3);
    this.nearGeo.setIndex(new THREE.BufferAttribute(ni, 1));
    this.farGeo = new THREE.BufferGeometry();
    this.farGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const fi = new Uint32Array((n - 1) * 6);
    for (let k = 0; k < n - 1; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3; // inner k, outer k, inner k+1, outer k+1
      fi.set([a, c, b, b, c, d], k * 6);
    }
    this.farGeo.setIndex(new THREE.BufferAttribute(fi, 1));
    const mat = () => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: CONFIG.stealth.coneAlpha, depthWrite: false, depthTest: true, fog: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    });
    this.nearMesh = new THREE.Mesh(this.nearGeo, mat());
    this.farMesh = new THREE.Mesh(this.farGeo, mat());
    this.nearMesh.frustumCulled = this.farMesh.frustumCulled = false;
    this.group.add(this.farMesh, this.nearMesh);
    this.object3d = this.group;
    this.highlight = false;
    this._colorKey = null;
    this._key = null;
    /** Number of fan rebuilds and rays of the last one (tests/perf). */
    this.rebuilds = 0;
    this.rayCount = 0;
    /** Last fan {cone, angles, dists} (tests: the drawn geometry). */
    this.fan = null;
  }

  /** Refresh the fan for `enemy` (call each frame while shown); rebuilds only when stale. @returns {boolean} rebuilt */
  update(enemy = this.enemy) {
    if (!enemy) return false;
    const grid = enemy.world?.grid || this.world?.grid || null;
    const cone = coneAt(enemy);
    this.group.visible = !!cone;
    if (!cone) return false;
    const gv = grid ? grid.version * 1e6 + (grid.dynamicVersion || 0) : -1;
    const k = this._key;
    this._setColor(enemy);
    if (k && k.gv === gv && Math.abs(k.x - cone.x) < EPS_POS && Math.abs(k.z - cone.z) < EPS_POS && Math.abs(k.h - cone.heading) < EPS_ANG &&
        k.far === cone.far && k.near === cone.near && k.fov === cone.halfFov && k.el === cone.elevated && k.vy === cone.vy) return false;
    this._key = { x: cone.x, z: cone.z, h: cone.heading, gv, far: cone.far, near: cone.near, fov: cone.halfFov, el: cone.elevated, vy: cone.vy };
    const fan = coneFan(enemy, grid && grid.castRay ? grid : null, { maxRays: this.cap - 2 });
    this.fan = fan;
    this.rebuilds++;
    const n = Math.min(fan.angles.length, this.cap);
    this.rayCount = n;
    const np = this.nearGeo.attributes.position.array;
    const fp = this.farGeo.attributes.position.array;
    const ex = cone.x, ez = cone.z;
    np[0] = ex; np[1] = Y; np[2] = ez;
    for (let i = 0; i < n; i++) {
      const a = fan.angles[i], d = fan.dists[i];
      const dn = Math.min(d, cone.near), df = Math.min(d, cone.far);
      const c = Math.cos(a), s = Math.sin(a);
      const o = (i + 1) * 3;
      np[o] = ex + c * dn; np[o + 1] = Y; np[o + 2] = ez + s * dn;
      const f = i * 6;
      fp[f] = ex + c * dn; fp[f + 1] = Y; fp[f + 2] = ez + s * dn;
      fp[f + 3] = ex + c * df; fp[f + 4] = Y; fp[f + 5] = ez + s * df;
    }
    this.nearGeo.setDrawRange(0, (n - 1) * 3);
    this.farGeo.setDrawRange(0, (n - 1) * 6);
    this.nearGeo.attributes.position.needsUpdate = true;
    this.farGeo.attributes.position.needsUpdate = true;
    return true;
  }

  /** Flat BEL palette (or alertTint colours), 50% alpha; 75% while the spotter highlight is on. */
  _setColor(enemy) {
    const tint = this.opts.alertTint ?? CONFIG.stealth.alertTint;
    const lvl = Math.max(0, Math.min(2, enemy.alertLevel | 0));
    const pal = this.opts.palette || this.world?.mission?.coneColors || enemy.world?.mission?.coneColors || 'green';
    const key = `${pal}|${tint ? lvl : 0}|${this.highlight}`;
    if (key === this._colorKey) return;
    this._colorKey = key;
    const c = paletteColors(pal);
    let near = c.near, far = c.far;
    if (tint && lvl > 0) {
      const t = new THREE.Color(CONFIG.stealth.alertTintColors[lvl]).getHex();
      near = t;
      far = new THREE.Color(t).multiplyScalar(0.55).getHex();
    }
    this.nearMesh.material.color.setHex(near);
    this.farMesh.material.color.setHex(far);
    const a = this.highlight ? CONFIG.stealth.spotterHighlight.alpha : CONFIG.stealth.coneAlpha;
    this.nearMesh.material.opacity = this.farMesh.material.opacity = a;
  }

  dispose() {
    this.nearGeo.dispose(); this.farGeo.dispose();
    this.nearMesh.material.dispose(); this.farMesh.material.dispose();
    this.group.removeFromParent();
  }
}

/**
 * Keeps the shown cone(s) in `scene` (Renderer.decalScene). BEL shows ONE cone at a time
 * (CONFIG.stealth.multiCone): turning a cone on (enemy.coneVisible = true, the eye button / click) hides the
 * previously shown one. `?debug=cones` (or `showAll`) shows every cone (Shift+V cheat).
 * Spotter highlight: 'enemy:spotted' (CHALLENGE / COMBAT entry) or 'enemy:noise-turn' (a lure turns a
 * post-holder) makes that enemy's cone the shown one at 75%
 * alpha for 1 s. Probe marker: setProbe(x, z[, enemy]) drops the red 0.6 m ring; the first enemy whose cone (standing
 * test) contains it gets its cone shown and the ring pulses; each marker triggers once; clearProbe().
 */
export class VisionCones {
  constructor(world, scene, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.opts = opts;
    /** @type {Map<any, VisionCone>} */
    this.cones = new Map();
    /** Enemies whose cone is shown, oldest first. */
    this.shown = [];
    let dbg = false;
    try { dbg = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === 'cones'; } catch { dbg = false; }
    this.showAll = opts.showAll ?? dbg;
    /** Extra cones on show (debug video mode: the guards that matter to the step), or null. Drawing only. */
    this.forced = null;
    this.highlightUntil = new Map();
    this.probe = null;
    const offs = [
      world?.events?.on?.('enemy:spotted', ({ enemy }) => this.spotted(enemy)),
      // a post-holder swung round by a lure: show his cone turning (replay round 3, M3 bunker gunner)
      world?.events?.on?.('enemy:noise-turn', ({ enemy }) => this.spotted(enemy)),
    ].filter(Boolean);
    this._off = offs.length ? () => offs.forEach((f) => f()) : null;
  }

  /** §4.2 spotter highlight: show this enemy's cone at 75% alpha for 1 s. */
  spotted(enemy) {
    if (!enemy || !enemy.vision || !this.world.enemies?.includes?.(enemy)) return; // vehicle sightings: no foot cone
    enemy.coneVisible = true;
    this._promote(enemy);
    this.highlightUntil.set(enemy, (this.world.time ?? 0) + CONFIG.stealth.spotterHighlight.dur);
  }

  _promote(e) {
    const i = this.shown.indexOf(e);
    if (i >= 0) this.shown.splice(i, 1);
    this.shown.push(e);
    const max = Math.max(1, this.opts.multiCone ?? CONFIG.stealth.multiCone);
    while (this.shown.length > max) this.shown.shift().coneVisible = false;
  }

  /**
   * Drop the red probe marker at (x, z) (Shift+click on the ground). `enemy`: the cone the caller already found covering
   * the point and showed (Game.probe) — the marker is then triggered at once, so a later frame never re-shows a cone the
   * player has hidden since (eye tool, click) as a "late" trigger.
   */
  setProbe(x, z, enemy = null) {
    this.clearProbe();
    const r = CONFIG.stealth.probeRing / 2;
    const geo = new THREE.RingGeometry(r - 0.07, r, 32);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
    mesh.position.set(x, Y + 0.01, z);
    mesh.renderOrder = 6;
    this.scene?.add(mesh);
    this.probe = { x, z, mesh, triggered: !!enemy, enemy: enemy || null, t0: enemy ? (this.world.time ?? 0) : 0 };
    if (enemy) this._promote(enemy);
    return this.probe;
  }

  clearProbe() {
    if (!this.probe) return;
    this.probe.mesh.geometry.dispose();
    this.probe.mesh.material.dispose();
    this.probe.mesh.removeFromParent();
    this.probe = null;
  }

  _updateProbe() {
    const p = this.probe;
    if (!p) return;
    const now = this.world.time ?? 0;
    if (!p.triggered) {
      const e = probeCone(this.world, p.x, p.z);
      if (e) { p.triggered = true; p.enemy = e; p.t0 = now; e.coneVisible = true; this._promote(e); }
    }
    p.mesh.scale.setScalar(p.triggered ? 1 + 0.3 * Math.abs(Math.sin((now - p.t0) * 5)) : 1);
  }

  /** Per-frame refresh (call from Game.render). */
  update() {
    const w = this.world;
    for (const e of w.enemies) if (e.coneVisible && !this.shown.includes(e)) this._promote(e);
    this.shown = this.shown.filter((e) => e.coneVisible && w.enemies.includes(e));
    this._updateProbe();
    const now = w.time ?? 0;
    for (const e of w.enemies) {
      const show = (e.coneVisible || this.showAll || !!this.forced?.has(e)) && e.alive !== false && !e.removed && e.state !== 'dead' && !!e.vision && !e.incapacitated;
      let cone = this.cones.get(e);
      if (show) {
        if (!cone) { cone = new VisionCone(e, w, this.opts); this.cones.set(e, cone); this.scene.add(cone.group); }
        cone.highlight = (this.highlightUntil.get(e) ?? -1) > now;
        cone.update(e);
      } else if (cone) {
        cone.dispose();
        this.cones.delete(e);
      }
    }
    for (const [e, cone] of this.cones) if (!w.enemies.includes(e)) { cone.dispose(); this.cones.delete(e); }
  }

  dispose() {
    this._off?.();
    this.clearProbe();
    for (const c of this.cones.values()) c.dispose();
    this.cones.clear();
  }
}

export default VisionCones;
