/**
 * Selection markers — rings under selected commandos, fading move-target markers and a dashed path preview.
 *
 * All three are GROUND DECALS in Renderer.decalScene (like the vision cones): drawn right after the world into
 * its colour+depth buffer, depth-tested (no depth writes), so the soldier, his weapon, vehicles, trees and
 * buildings draw OVER the ring where they overlap it (BEL: the unit stands on its circle). They sit on the
 * surface at the unit's height (terrain relief via world.groundY, bridge decks, walkable roofs via grid.elevAt),
 * lifted a few cm + polygonOffset against z-fighting, and go through AO/tone mapping/LUT with the world, so the
 * colours below are pre-tone-mapping values calibrated to read as the bright BEL green/yellow on screen
 * (tests/selection-ring.test.mjs samples them).
 *
 * X-ray: each ring and path has a muted "ghost" twin on XRAY_LAYER, drawn by XRayPass (engine/post-passes.js)
 * with depthFunc GreaterDepth and a depth margin (GHOST_MARGIN): it only shows where something stands well
 * above the decal (a roof, a tree canopy), never where the soldier's own legs cover it, so a selected commando
 * hidden under a roof keeps a visible selection with his x-ray silhouette. The RING ghost is armed only while
 * that commando is actually x-rayed (XRayPass.isHidden, GPU occlusion queries on his silhouette draw): a soldier
 * in plain view next to a truck gets no ghost over the cab. Path ghosts stay armed (the route under a roof).
 *
 * Pulse (render/ring-pulse.js, ported from the author's 3d_chess selection halo): each ring is a soft annulus drawn
 * by the chess fragment profile (peak + exp glow, alpha discard) whose radius and alpha pulse from the moment that
 * commando was selected — wide and bright, contracting and dimming over 1.2 s, snapping back and repeating. Real
 * time (performance.now), so it keeps pulsing while the game is paused; the reduced-motion option freezes it at the
 * resting size. Move-target markers use the chess valid-move disc pulse from their spawn time. The ghost pulses too.
 *
 * BCD overlays (puppet disc and ring, knock-out arcs; render/bcd-overlay.js) are ground decals in the same group.
 * See docs/ARCHITECTURE.md § Rendering pieces.
 * @module render/selection
 */

import * as THREE from 'three';
import { BcdOverlay } from './bcd-overlay.js';
import { XRAY_LAYER } from '../engine/post-passes.js';
import { reducedMotion } from './fx.js';
import { CHESS_MARKER, CHESS_RING, RING_PROFILE_GLSL, ringShape } from './ring-pulse.js';

/**
 * Linear HDR colours fed to AgX + the theater LUT (they are decals, tone-mapped with the world). AgX desaturates
 * bright primaries, so the channels that should vanish are slightly negative (wide gamut; SanitizePass keeps
 * values ≥ −0.3·max) and luminance stays under the bloom threshold. Measured on M1 snow (tests/out):
 * RING → ≈ rgb(169,237,147) (old overlay #9cff7a), RUN → ≈ rgb(235,213,54) (old #ffd24a).
 */
const RING_COLOR = new THREE.Color().setRGB(-0.6, 2.4, -0.2, THREE.LinearSRGBColorSpace);
const RUN_COLOR = new THREE.Color().setRGB(2.2, 1.0, -0.4, THREE.LinearSRGBColorSpace);
const GHOST_COLOR = 0xc8ff90; // x-ray rim colour (CONFIG.render.xray.rim)
const MARKER_LIFE = 0.9; // s
const MARKER_FADE = 0.3; // s: the marker fades out over the end of its life (it pulses/contracts before that)
/** m per chess unit: the resting ring's centre line (chess 0.34) sits at the old ring's 0.47 m around a 1.8 m man. */
export const RING_SCALE = 0.47 / 0.34;
/** m per chess unit for move-target markers: resting centre line (chess 0.29) at the old marker's 0.225 m. */
export const MARKER_SCALE = 0.225 / 0.29;
const GHOST_DIM = 0.55 / 0.95; // x-ray ghost alpha relative to the ring (the old 0.55 vs 0.95)
const MAX_PATH_POINTS = 1024;
const PATH_STEP = 1.0; // m: path segments are split so the line follows the ground relief
const RING_LIFT = 0.01, MARKER_LIFT = 0.02, PATH_LIFT = 0.08; // m above the surface (+ polygonOffset; lines get none)
/** m: a ghost fragment is drawn only when the visible surface is this far in front of it (roof/canopy, not legs). */
export const GHOST_MARGIN = 1.5;

function ringGeometry(inner, outer, seg = 48, rings = 1) {
  const g = new THREE.RingGeometry(inner, outer, seg, rings);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Depth-tested ground-decal material (like the vision cones). */
function decalMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
}

/**
 * Give `mat` the chess ring profile: the annulus mesh is only the canvas (with margin for the glow); the fragment
 * alpha is max(0.8·ring, 0.35·glow)·opacity around the centre line between `userData.ring.uRingInner/Outer` (local
 * metres), discarded below 0.01. Chains an existing onBeforeCompile (the x-ray ghost's depth trick).
 */
export function pulseRingMaterial(mat) {
  const u = { uRingInner: { value: 0.4 }, uRingOuter: { value: 0.55 } };
  mat.userData.ring = u;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.call(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRingXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRingXZ = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRingXZ;\nuniform float uRingInner;\nuniform float uRingOuter;')
      .replace('#include <alphatest_fragment>', `${RING_PROFILE_GLSL}\n  #include <alphatest_fragment>`);
  };
  mat.customProgramCacheKey = () => `ring-pulse|${prevKey}`;
  return mat;
}

/** Set a pulse material's radii (m) and alpha. */
function setRing(mat, shape, alphaK = 1) {
  mat.userData.ring.uRingInner.value = shape.inner;
  mat.userData.ring.uRingOuter.value = shape.outer;
  mat.opacity = shape.alpha * alphaK;
}

/**
 * Turn `mat` into an x-ray ghost: drawn only where the world depth is more than `margin` m in front of the
 * fragment (depthFunc GreaterDepth against a depth pulled toward the camera by `margin`). Works for lines too
 * (polygonOffset does not), in orthographic and perspective views.
 */
export function ghostMaterial(mat, margin = GHOST_MARGIN) {
  mat.depthTest = true;
  mat.depthWrite = false;
  mat.depthFunc = THREE.GreaterDepth;
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 gq = projectionMatrix * vec4( mvPosition.xy, mvPosition.z + ${margin.toFixed(3)}, 1.0 );
        gl_Position.z = ( gq.z / gq.w ) * gl_Position.w; }`);
  };
  mat.customProgramCacheKey = () => `xray-ghost-${margin}`;
  mat.name = 'selection-ghost';
  return mat;
}

/** Surface height (m) at a point: raised walkable cells (roofs) + visual ground relief / bridge decks. */
function surfaceY(world, x, z) {
  const e = world?.grid?.elevAt ? world.grid.elevAt(x, z) : 0;
  const g = typeof world?.groundY === 'function' ? world.groundY(x, z) || 0 : 0;
  return e + g;
}

export class Selection {
  /**
   * @param {THREE.Scene} decalScene depth-tested ground-decal scene (Renderer.decalScene)
   */
  constructor(decalScene) {
    this.scene = decalScene;
    this.group = new THREE.Group();
    this.group.name = 'selection';
    this.group.renderOrder = 10;
    this.scene.add(this.group);
    // canvases for the chess profile: the pulse's full radius range plus the glow margin (≈1.2 half-widths)
    this.ringGeo = ringGeometry(0.25 * RING_SCALE, 0.52 * RING_SCALE, 64, 2);
    this.markerGeo = ringGeometry(0.19 * MARKER_SCALE, 0.45 * MARKER_SCALE, 40);
    /** @type {THREE.Mesh[]} */
    this.rings = [];
    /** @type {{mesh: THREE.Mesh, t: number}[]} */
    this.markers = [];
    this.showPaths = true;
    /** @type {THREE.Line[]} */
    this.pathLines = [];
    this._offs = [];
    this.world = null;
    /** (commandoRoot) → is he drawn as an x-ray silhouette? (XRayPass.isHidden; null = ghosts always armed) */
    this.xrayHidden = null;
    /** commando → real time (s) he was selected: each ring pulses from its own selection (a group starts together) */
    this._selT = new Map();
    /** real-time clock (s); the pulse ignores sim time and pause */
    this.clock = () => performance.now() / 1000;
    /** tests: a fixed time-since-selection for every ring (null = live) */
    this.pulseT = null;
  }

  /** Bind to a world's events (move markers). Call on every mission load. */
  attach(world) {
    this.detach();
    this.world = world;
    this._offs.push(world.events.on('ui:move-marker', ({ x, z, run }) => this.marker(x, z, run)));
  }

  detach() {
    for (const off of this._offs) off();
    this._offs = [];
    this.world = null;
    for (const m of this.markers) this._disposeMarker(m);
    this.markers = [];
    this._selT.clear();
    for (const r of this.rings) r.visible = false;
    for (const l of this.pathLines) l.visible = false;
  }

  /** Spawn a fading move-target marker (on the surface at x,z). */
  marker(x, z, run = false) {
    const mesh = new THREE.Mesh(this.markerGeo, pulseRingMaterial(decalMaterial(run ? RUN_COLOR : RING_COLOR, 1)));
    mesh.name = 'selection-marker';
    mesh.position.set(x, surfaceY(this.world, x, z) + MARKER_LIFT, z);
    mesh.renderOrder = 10;
    this.group.add(mesh);
    const m = { mesh, t: 0 };
    this._markerFrame(m, this._still());
    this.markers.push(m);
  }

  _disposeMarker(m) {
    this.group.remove(m.mesh);
    m.mesh.material.dispose();
  }

  _ring(i) {
    if (!this.rings[i]) {
      const geo = this.ringGeo.clone(); // own copy: its vertices follow the ground relief under the unit
      const r = new THREE.Mesh(geo, pulseRingMaterial(decalMaterial(RING_COLOR, 1)));
      r.name = 'selection-ring';
      r.renderOrder = 10;
      r.frustumCulled = false;
      const ghostMat = ghostMaterial(new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: GHOST_DIM, side: THREE.DoubleSide }));
      const ghost = new THREE.Mesh(geo, pulseRingMaterial(ghostMat));
      ghost.name = 'selection-ring-ghost';
      ghost.layers.set(XRAY_LAYER); // drawn only by XRayPass
      ghost.frustumCulled = false;
      r.add(ghost);
      r.userData.key = null;
      this.group.add(r);
      this.rings[i] = r;
    }
    return this.rings[i];
  }

  /** Bend ring `r` (centred at x,z) over the visual ground relief; flat where there is none (roofs, water). */
  _conform(r, x, z) {
    const w = this.world, gy = typeof w?.groundY === 'function' ? w.groundY : null;
    const key = gy ? `${x.toFixed(2)},${z.toFixed(2)}` : 'flat';
    if (r.userData.key === key) return;
    r.userData.key = key;
    const pos = r.geometry.attributes.position, base = this.ringGeo.attributes.position;
    const g0 = gy ? gy.call(w, x, z) || 0 : 0;
    for (let k = 0; k < pos.count; k++) {
      const vx = base.getX(k), vz = base.getZ(k);
      pos.setY(k, gy ? (gy.call(w, x + vx, z + vz) || 0) - g0 : 0);
    }
    pos.needsUpdate = true;
    r.geometry.computeBoundingSphere();
  }

  _pathLine(i) {
    if (!this.pathLines[i]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PATH_POINTS * 3), 3));
      const mat = new THREE.LineDashedMaterial({ color: RING_COLOR, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.75, depthTest: true, depthWrite: false, fog: false });
      const line = new THREE.Line(geo, mat);
      line.name = 'selection-path';
      line.frustumCulled = false;
      line.renderOrder = 10;
      const ghost = new THREE.Line(geo, ghostMaterial(new THREE.LineDashedMaterial({ color: GHOST_COLOR, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.45 })));
      ghost.name = 'selection-path-ghost';
      ghost.layers.set(XRAY_LAYER);
      ghost.frustumCulled = false;
      line.add(ghost);
      this.group.add(line);
      this.pathLines[i] = line;
    }
    return this.pathLines[i];
  }

  /** Fill `line` with the remaining path from (x,y,z), split into ≤ PATH_STEP pieces on the surface. */
  _fillPath(line, x, y, z, path, from) {
    const w = this.world, pos = line.geometry.attributes.position;
    let n = 0, px = x, pz = z;
    pos.setXYZ(n++, x, y + PATH_LIFT, z);
    for (let k = from; k < path.length && n < MAX_PATH_POINTS; k++) {
      const qx = path[k].x, qz = path[k].z;
      const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / PATH_STEP));
      for (let s = 1; s <= steps && n < MAX_PATH_POINTS; s++) {
        const u = s / steps, sx = px + (qx - px) * u, sz = pz + (qz - pz) * u;
        pos.setXYZ(n++, sx, surfaceY(w, sx, sz) + PATH_LIFT, sz);
      }
      px = qx; pz = qz;
    }
    pos.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
    line.geometry.computeBoundingSphere();
    line.computeLineDistances();
  }

  /**
   * Per-frame refresh (render time, not sim time).
   * @param {number} dt frame delta (s)
   */
  update(dt) {
    const w = this.world;
    if (w?.rules?.puppet) (this.bcd ||= new BcdOverlay(this.group, () => this.world)).update(w); // BCD puppet disc / knock-out arcs
    else this.bcd?.update(null);
    const sel = w ? w.commandos.filter((c) => c.selected && c.alive) : [];
    const now = this.clock(), still = this._still();
    for (const c of this._selT.keys()) if (!sel.includes(c)) this._selT.delete(c);
    for (const c of sel) if (!this._selT.has(c)) this._selT.set(c, now); // newly selected (together → same start)
    for (let i = 0; i < Math.max(sel.length, this.rings.length); i++) {
      const c = sel[i];
      if (!c) {
        if (this.rings[i]) this.rings[i].visible = false;
        if (this.pathLines[i]) this.pathLines[i].visible = false;
        continue;
      }
      const o = c.object3d?.position;
      const x = o ? o.x : c.x;
      const z = o ? o.z : c.z;
      const y = o ? o.y : surfaceY(w, x, z) + (c.y || 0);
      const r = this._ring(i);
      r.visible = true;
      r.position.set(x, y + RING_LIFT, z);
      this._conform(r, x, z);
      const shape = ringShape(this.pulseT ?? now - this._selT.get(c), CHESS_RING, RING_SCALE, still);
      setRing(r.material, shape);
      setRing(r.children[0].material, shape, GHOST_DIM);
      // x-ray ghost only while the commando himself is x-rayed (hidden): a visible soldier's ring is simply covered
      r.children[0].visible = !this.xrayHidden || !c.object3d || this.xrayHidden(c.object3d);
      const line = this._pathLine(i);
      const path = this.showPaths && c.path && c.pathIndex < c.path.length ? c.path : null;
      line.visible = !!path;
      if (path) {
        this._fillPath(line, x, y, z, path, c.pathIndex);
        line.material.color.copy(c.moveMode === 'run' ? RUN_COLOR : RING_COLOR);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      const k = m.t / MARKER_LIFE;
      if (k >= 1) {
        this._disposeMarker(m);
        this.markers.splice(i, 1);
        continue;
      }
      this._markerFrame(m, still);
    }
  }

  /** Reduced-motion option: rings and markers hold the resting (pulse 0) shape. */
  _still() {
    return reducedMotion(this.world?.game?.options?.reducedMotion);
  }

  /** Marker = chess valid-move disc pulsing from its spawn (render time), faded out over its last MARKER_FADE s. */
  _markerFrame(m, still) {
    setRing(m.mesh.material, ringShape(m.t, CHESS_MARKER, MARKER_SCALE, still), Math.min(1, (MARKER_LIFE - m.t) / MARKER_FADE));
  }

  dispose() {
    this.bcd?.dispose();
    this.detach();
    this.scene.remove(this.group);
    this.ringGeo.dispose();
    this.markerGeo.dispose();
    for (const r of this.rings) {
      r.geometry.dispose();
      r.material.dispose();
      r.children[0]?.material.dispose();
    }
    for (const l of this.pathLines) {
      l.geometry.dispose();
      l.material.dispose();
      l.children[0]?.material.dispose();
    }
  }
}
