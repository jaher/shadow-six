/**
 * Noise rings (house rule runningNoise, display option "NOISE RINGS"): each running step a player commando makes
 * shows a thin amber ring on the ground at his feet that grows to the step's hearing radius over GROW s and fades
 * out, so the player sees how far his running carries (louder on roads and decks, quieter on grass and sand). Like
 * the selection rings it is a GROUND DECAL (Renderer.decalScene: depth-tested, no depth writes) whose vertices
 * follow the ground relief. Off under reduced motion. Render time only: never touches the sim.
 * @module render/noise-rings
 */
import * as THREE from 'three';
import { reducedMotion } from './fx.js';

export const RING_GROW = 0.6; // s from the feet to the full radius
export const RING_LIFE = 0.9; // s (the last LIFE − GROW s hold the full radius while it fades)
export const RING_ALPHA = 0.4;
export const RING_WIDTH = 0.22; // m
const POOL = 8;
const SEG = 64;
const LIFT = 0.04; // m above the surface (+ polygonOffset)
/** The run-path amber (render/selection.js RUN_COLOR, linear HDR for AgX): reads on snow, sand and dark soil alike. */
const COLOR = new THREE.Color().setRGB(2.2, 1.0, -0.4, THREE.LinearSRGBColorSpace);

/**
 * Ring shape at age t (s) for a hearing radius R (m): {r, alpha} (alpha 0 once dead). Ease-out growth.
 * Pure (unit-tested).
 */
export function noiseRingShape(t, R) {
  if (!(t >= 0) || t >= RING_LIFE) return { r: R, alpha: 0 };
  const k = Math.min(1, t / RING_GROW);
  const r = Math.max(RING_WIDTH, R * (1 - (1 - k) * (1 - k)));
  return { r, alpha: RING_ALPHA * (1 - t / RING_LIFE) };
}

function ringGeometry() {
  const pos = new Float32Array((SEG + 1) * 2 * 3);
  const idx = [];
  for (let s = 0; s < SEG; s++) {
    const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class NoiseRings {
  /**
   * @param {THREE.Group} group parent in the decal scene
   */
  constructor(group) {
    this.group = group;
    this.world = null;
    /** @type {{mesh: THREE.Mesh, t: number, R: number, x: number, z: number, live: boolean}[]} */
    this.rings = [];
    this._off = null;
    this.enabled = true;
  }

  attach(world) {
    this.detach();
    this.world = world;
    this._off = world.events.on('noise', (n) => {
      if (n?.kind === 'footsteps' && n.source?.faction === 'player') this.spawn(n.x, n.z, n.radius);
    });
  }

  detach() {
    this._off?.();
    this._off = null;
    this.world = null;
    for (const r of this.rings) { r.live = false; r.mesh.visible = false; }
  }

  _on() {
    const o = this.world?.game?.options;
    return this.enabled && o?.noiseRings !== false && !reducedMotion(o?.reducedMotion);
  }

  /** A new ring at (x, z) growing to radius R (oldest pooled ring reused). */
  spawn(x, z, R) {
    if (!this._on() || !(R > 0)) return null;
    let r = this.rings.find((q) => !q.live);
    if (!r && this.rings.length < POOL) {
      const mesh = new THREE.Mesh(ringGeometry(), new THREE.MeshBasicMaterial({
        color: COLOR, transparent: true, opacity: 0, depthTest: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }));
      mesh.name = 'noise-ring';
      mesh.renderOrder = 9;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      r = { mesh, t: 0, R: 0, x: 0, z: 0, live: false };
      this.rings.push(r);
    }
    if (!r) r = this.rings.reduce((a, b) => (b.t > a.t ? b : a));
    Object.assign(r, { t: 0, R, x, z, live: true });
    this._frame(r);
    return r;
  }

  /** Per-frame (render time). */
  update(dt) {
    const on = this._on();
    for (const r of this.rings) {
      if (!r.live) continue;
      r.t += dt;
      if (!on || r.t >= RING_LIFE) { r.live = false; r.mesh.visible = false; continue; }
      this._frame(r);
    }
  }

  /** Lay ring `r` on the ground at its current radius. */
  _frame(r) {
    const { r: rad, alpha } = noiseRingShape(r.t, r.R);
    const m = r.mesh, w = this.world;
    const gy = typeof w?.groundY === 'function' ? (x, z) => (w.groundY(x, z) || 0) + (w.grid?.elevAt?.(x, z) || 0) : () => 0;
    const y0 = gy(r.x, r.z);
    m.position.set(r.x, y0 + LIFT, r.z);
    const pos = m.geometry.attributes.position, inner = Math.max(0, rad - RING_WIDTH);
    for (let s = 0; s <= SEG; s++) {
      const a = (s / SEG) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const rr = k ? rad : inner, x = c * rr, z = sn * rr;
        pos.setXYZ(s * 2 + k, x, gy(r.x + x, r.z + z) - y0, z);
      }
    }
    pos.needsUpdate = true;
    m.material.opacity = alpha;
    m.visible = alpha > 0.002;
  }

  /** Rings currently drawn (tests). */
  get active() {
    return this.rings.filter((r) => r.live && r.mesh.visible).length;
  }

  dispose() {
    this.detach();
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
    this.rings = [];
  }
}
