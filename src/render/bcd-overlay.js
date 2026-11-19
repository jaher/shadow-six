/**
 * BCD ground overlays (docs/bcd-plan.md §1.1, §1.3): the puppet's translucent blue range disc (13.5 m) around
 * each controller with his blue ring on the puppet, and a knock-out timer arc under every stunned man
 * (the "zzz" ring: the arc shrinks as he comes round), and set-piece timers (`world._bcdTimers` {x, z, k}: papers
 * burning, missions/setpieces-bcd.js) as a filling orange arc. Drawn by render/selection.js; BCD worlds only.
 *
 * Like the selection rings they are GROUND DECALS (Renderer.decalScene: depth-tested, no depth writes, bent over
 * the visual ground relief via world.groundY), so the puppet's / puppeteer's legs, walls and vehicles cover them
 * instead of the disc and ring being painted over the men. Colours are linear HDR values fed to tone mapping + LUT
 * (the old after-post overlay used display sRGB #3a8cff / #f0c040).
 * @module render/bcd-overlay
 */

import { waterColumn } from '../art/swim-pose.js';
import * as THREE from 'three';
import { CONFIG } from '../config.js';

// measured on b00 (AgX + LUT): BLUE ring ≈ rgb(40,140,205), KO ≈ rgb(226,187,68); the disc at 12 % tints the ground
// about as much as the old #3a8cff overlay did
const BLUE = new THREE.Color().setRGB(-0.9, -0.05, 3.0, THREE.LinearSRGBColorSpace);
const DISC = new THREE.Color().setRGB(0.02, 0.1, 0.4, THREE.LinearSRGBColorSpace);
const KO = new THREE.Color().setRGB(2.4, 0.7, -0.5, THREE.LinearSRGBColorSpace);
// set-piece timers (`world._bcdTimers`: papers burning, missions/setpieces-bcd.js): a hot orange-red that fills up
const BURN = new THREE.Color().setRGB(3.0, 0.45, -0.4, THREE.LinearSRGBColorSpace);
const LIFT = 0.015; // m above the ground (+ polygonOffset)

function flatRing(inner, outer, seg, phi = 1, start = 0, len = Math.PI * 2) {
  const g = new THREE.RingGeometry(inner, outer, seg, phi, start, len);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class BcdOverlay {
  /**
   * @param {THREE.Group} group parent in the decal scene
   * @param {() => object|null} [getWorld] world for the ground height (world.groundY); null → flat at the unit's y
   */
  constructor(group, getWorld = () => null) {
    this.group = group;
    this.getWorld = getWorld;
    this.discs = [];
    this.rings = [];
    this.arcs = [];
    this.timers = [];
    // radial subdivisions so the 13.5 m disc can follow the ground relief
    this.discGeo = flatRing(0.05, CONFIG.bcd.puppet.range, 64, 14);
    this.ringGeo = flatRing(0.45, 0.58, 24);
    this._arcGeo = new Map();
  }

  _flat(geo, color, opacity) {
    const m = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      // (a flat decal on the ground: both sides in one pass, as the selection and noise rings — three's back / front pass
      // pair for a transparent double-sided material is two programs of its own, first linked at the first knock-out
      // in play: LIGHTS OUT e01's walkthrough at t≈129. One pass shares the noise rings' warmed program)
      forceSinglePass: true,
    }));
    m.renderOrder = 9;
    m.frustumCulled = false;
    m.visible = false;
    m.userData.base = geo;
    this.group.add(m);
    return m;
  }

  _pool(list, i, make) {
    if (!list[i]) list[i] = make();
    return list[i];
  }

  /** Arc base geometry for a fraction k (quantised to 1/24). */
  _arc(k) {
    const q = Math.max(1, Math.round(k * 24));
    if (!this._arcGeo.has(q)) this._arcGeo.set(q, flatRing(0.3, 0.42, 24, 1, 0, (q / 24) * Math.PI * 2));
    return this._arcGeo.get(q);
  }

  /** Place decal `m` at (x, z) with its vertices on the ground (relative to `y`, the unit's feet). */
  _place(m, x, y, z, base = m.userData.base) {
    const w = this.getWorld(), gy = typeof w?.groundY === 'function' ? w.groundY : null;
    const key = `${base.id}:${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}:${gy ? 1 : 0}`;
    m.position.set(x, y + LIFT, z);
    if (m.userData.key === key) return;
    if (m.userData.base !== base) {
      m.geometry.dispose();
      m.geometry = base.clone();
      m.userData.base = base;
    }
    m.userData.key = key;
    const pos = m.geometry.attributes.position, src = base.attributes.position;
    const g0 = gy ? gy.call(w, x, z) || 0 : 0;
    for (let k = 0; k < pos.count; k++) pos.setY(k, gy ? (gy.call(w, x + src.getX(k), z + src.getZ(k)) || 0) - g0 : 0);
    pos.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }

  /**
   * The pools' first range disc, puppet ring and knock-out arc made now (hidden): the load's program warm-up frame draws
   * them (`userData.warmShow`, Game._warmFrame), so the first stunned man's arc links no program in play (e02's first
   * knock-out, a double-sided decal: two programs, one per side's pass).
   */
  prewarm() {
    const d = this._pool(this.discs, 0, () => this._flat(this.discGeo, DISC, 0.12));
    const r = this._pool(this.rings, 0, () => this._flat(this.ringGeo, BLUE, 0.9));
    const a = this._pool(this.arcs, 0, () => this._flat(this._arc(1), KO, 0.85));
    for (const m of [d, r, a]) m.userData.warmShow = true;
  }

  update(world) {
    const ctl = world ? world.commandos.filter((c) => c.alive && c.puppet?.puppetOf === c) : [];
    const ko = world ? world.enemies.filter((e) => e.alive && e.ko === 'stunned' && e.state !== 'carried') : [];
    // (in the water the drawn body stands on the bed, art/swim-pose.js: the disc stays on the surface)
    const feet = (u) => (u.object3d ? (waterColumn(world, u.x, u.z) ? Math.max(u.object3d.position.y, u.y || 0) : u.object3d.position.y) : u.y || 0);
    for (let i = 0; i < Math.max(ctl.length, this.discs.length); i++) {
      const c = ctl[i];
      const d = this._pool(this.discs, i, () => this._flat(this.discGeo, DISC, 0.12));
      const r = this._pool(this.rings, i, () => this._flat(this.ringGeo, BLUE, 0.9));
      d.visible = r.visible = !!c;
      if (!c) continue;
      // the range disc lies on the ground (not on a roof the controller stands on): walls and roofs cover it
      const gy = typeof world.groundY === 'function' ? world.groundY(c.x, c.z) || 0 : 0;
      this._place(d, c.x, gy, c.z);
      const p = c.puppet;
      this._place(r, p.object3d?.position.x ?? p.x, feet(p), p.object3d?.position.z ?? p.z);
    }
    for (let i = 0; i < Math.max(ko.length, this.arcs.length); i++) {
      const e = ko[i];
      const a = this._pool(this.arcs, i, () => this._flat(this._arc(1), KO, 0.85));
      a.visible = !!e;
      if (!e) continue;
      this._place(a, e.object3d?.position.x ?? e.x, feet(e), e.object3d?.position.z ?? e.z, this._arc(Math.max(0, e.koT) / CONFIG.bcd.koDuration));
    }
    // (no per-frame arrays: the map is walked in place)
    let n = 0;
    if (world?._bcdTimers) {
      for (const t of world._bcdTimers.values()) {
        const a = this._pool(this.timers, n++, () => this._flat(this._arc(1), BURN, 0.9));
        a.visible = true;
        const gy = typeof world.groundY === 'function' ? world.groundY(t.x, t.z) || 0 : 0;
        this._place(a, t.x, gy, t.z, this._arc(Math.max(0.04, Math.min(1, t.k))));
      }
    }
    for (let i = n; i < this.timers.length; i++) this.timers[i].visible = false;
  }

  dispose() {
    for (const m of [...this.discs, ...this.rings, ...this.arcs, ...this.timers]) { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.discGeo.dispose();
    this.ringGeo.dispose();
    for (const g of this._arcGeo.values()) g.dispose();
  }
}
