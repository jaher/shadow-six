/**
 * Gate smash visuals (design-spec §3.7 ramming addendum). Reads sim state, never writes it:
 *   - intact breakable gates (art/breakable-gates.js) sit on the ground and animate their leaves (open swing, the
 *     bow of a slow push);
 *   - a broken gate's piece meshes leave the gate group and follow their physics bodies (physics/debris.js poses ×
 *     the piece's layout-local offset); without physics (Rapier missing) the pieces lie where a canned, seeded
 *     scatter puts them;
 *   - FX: splinters / chips / surface puff at the contact, snow clumps off the top rail (snow theaters), landing
 *     puffs, a camera shake scaled by the distance to the view centre; small pitch bumps when a vehicle rolls over
 *     wreckage.
 * @module render/gate-smash-visuals
 */

import * as THREE from 'three';
import { spawnGateFx } from './gate-smash-fx.js';
import { addSnowCover } from '../art/terrain/snowfx.js';
import { tornWoodMat } from '../art/breakable-gates.js';
import { pieceLocal, HULL_CLEARANCE } from '../physics/debris.js';
import { rng32, hashStr } from '../world/breakables.js';

const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const poseMatrix = (p, out) => out.compose(_p.set(p[0], p[1], p[2]), _q.set(p[3], p[4], p[5], p[6]), _s.set(1, 1, 1));
const gateModelOf = (o) => o?.userData?.gate || o?.children?.find?.((c) => c.userData?.gate)?.userData.gate || null;

const DUSTED = new Map();
/** Light, patchy snow on the debris (the full prop cover would turn a plank lying flat white on white). */
export const DEBRIS_SNOW = { uSnowAmt: { value: 0.45 }, uSnowBias: { value: -0.38 } };
/**
 * The debris variant of a (snow-covered) shared prop material: same colour and textures, the prop snow cover swapped
 * for a dusting (cached per material). Without the prop cover (no snow theater) the material is kept as is.
 */
function debrisMaterial(m) {
  if (Array.isArray(m)) return m.map(debrisMaterial);
  if (!m || !m.userData?.snowCover) return m;
  if (!DUSTED.has(m)) {
    const c = m.clone(); // clone() does not carry the prop snow patch (onBeforeCompile)
    c.userData = { shared: true, debris: true, snowCover: true };
    addSnowCover(c, { uniforms: DEBRIS_SNOW });
    DUSTED.set(m, c);
  }
  return DUSTED.get(m);
}

export class GateSmashVisuals {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.gates = [];
    for (const it of world.interactables || []) {
      const model = gateModelOf(it.object3d);
      if (!model) continue;
      const rec = { gate: it, key: String(it.tag ?? it.id), model, root: it.object3d, detached: false, fallback: null, bumped: new Map() };
      this._seat(rec);
      this.gates.push(rec);
    }
    this._offs = [
      world.events.on('gate:smash', (e) => this._onSmash(e)),
      world.events.on('gate:hold', (e) => this._onHold(e)),
      world.events.on('gate:thud', (e) => spawnGateFx(world.fx, 'gate_thud', e.x, e.z, { v: e.v, heavy: e.heavy })),
    ];
  }

  _groundY(x, z) { const g = this.world.groundY; return typeof g === 'function' ? (g.call(this.world, x, z) || 0) : 0; }

  /**
   * Intact gate on the ground at its centre (the physics frame uses the same height); each post is set into the ground
   * under it (25 cm deep), so on a slope the downhill post does not hang in the air.
   */
  _seat(rec) {
    const gy = this._groundY(rec.gate.x, rec.gate.z), rot = rec.gate.params?.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot);
    rec.root.position.y = gy;
    for (const p of rec.model.layout.pieces) {
      const m = rec.model.pieces.get(p.id);
      if (p.kind !== 'post' || !m) continue;
      const x = rec.gate.x + c * p.c[0], z = rec.gate.z + s * p.c[0], T = this.world.terrain; // the bare terrain under it
      const top = p.c[1] + p.h[1], bot = Math.min(0, (T?.groundY ? T.groundY(x, z) : this._groundY(x, z)) - gy) - 0.25;
      m.scale.y = (top - bot) / (2 * p.h[1]);
      m.position.y = (top + bot) / 2;
    }
    rec.root.updateMatrixWorld(true);
  }

  frame(dt = 1 / 60) {
    const pw = this.world.physics;
    for (const rec of this.gates) {
      if (!rec.gate.destroyed) { rec.model.tick(dt); continue; }
      const pg = pw && !pw.isNull ? pw.gates?.byKey?.(rec.key) : null;
      if (pg?.broken) this._follow(rec, pg);
      else if (!rec.fallback) this._canned(rec);
    }
    this._bumps();
  }

  /** Move every non-post piece mesh from the gate group to the scene (world matrices set by hand from then on). */
  _detach(rec) {
    if (rec.detached) return;
    rec.detached = true;
    rec.root.updateMatrixWorld(true);
    const L = rec.model.layout, byId = new Map([...L.pieces, ...(L.splinters || [])].map((q) => [q.id, q]));
    for (const [id, m] of rec.model.pieces) {
      const p = byId.get(id);
      if (!p || p.kind === 'post') continue;
      m.removeFromParent();
      m.matrixAutoUpdate = false;
      // same wood, the snow cover thinned to a dusting on whatever face ends up on top
      m.traverse((o) => { if (o.isMesh) o.material = debrisMaterial(o.material); });
      this.scene.add(m);
    }
    for (const g of rec.model.leaves) g.userData.detached = true;
  }

  _follow(rec, pg) {
    this._detach(rec);
    if (!rec.torn) {
      // a board / rail half whose other half went into another body broke at its seam: its torn zone shows fresh wood
      rec.torn = true;
      const bodyOf = new Map();
      pg.bodies.forEach((b, i) => { for (const id of b.pieces) bodyOf.set(id, i); });
      for (const [id, mesh] of rec.model.pieces) {
        const half = /^(L\d+(?:p\d+|r\d))([ab])$/.exec(id);
        if (!half || !Array.isArray(mesh.material) || mesh.material.length < 3) continue;
        const other = half[1] + (half[2] === 'a' ? 'b' : 'a');
        if (bodyOf.has(id) && bodyOf.get(other) !== bodyOf.get(id)) { mesh.material = mesh.material.slice(); mesh.material[2] = tornWoodMat(); }
      }
    }
    rec.poses ||= new Map();
    for (const b of pg.bodies) {
      if (rec.poses.get(b) === b.pose) continue;
      rec.poses.set(b, b.pose);
      poseMatrix(b.pose, _m);
      for (const id of b.pieces) {
        const mesh = rec.model.pieces.get(id), p = pg.byId.get(id);
        if (!mesh || !p) continue;
        mesh.matrix.multiplyMatrices(_m, poseMatrix(pieceLocal(p), _l));
        mesh.matrixWorldNeedsUpdate = true;
        mesh.visible = true; // a splinter shows once its board broke
      }
    }
  }

  /** No physics: a seeded scatter ahead of the gate, every piece lying flat (static wreckage). */
  _canned(rec) {
    this._detach(rec);
    const sm = rec.gate.smash || {}, L = rec.model.layout, rand = rng32(hashStr(`canned:${rec.key}:${sm.seed ?? 0}`));
    const rot = rec.gate.params?.rot ?? 0, hd = sm.info?.heading ?? rot + Math.PI / 2;
    const dx = Math.cos(hd), dz = Math.sin(hd), tx = Math.cos(rot), tz = Math.sin(rot);
    for (const p of L.pieces) {
      if (p.kind === 'post') continue;
      const mesh = rec.model.pieces.get(p.id);
      const along = 0.8 + rand() * (sm.outcome === 'shatter' ? 6 : 3.5), lat = (rand() - 0.5) * 2.5;
      const x = rec.gate.x + tx * p.c[0] * 0.8 + dx * along + -dz * lat, z = rec.gate.z + tz * p.c[0] * 0.8 + dz * along + dx * lat;
      const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, rand() * Math.PI * 2));
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      mesh.matrix.compose(_p.set(x, this._groundY(x, z) + p.h[2] + 0.005, z), yaw.multiply(flat), _s.set(1, 1, 1));
      mesh.matrixWorldNeedsUpdate = true;
    }
    rec.fallback = true;
  }
}

Object.assign(GateSmashVisuals.prototype, {
  _rec(id) { return this.gates.find((r) => r.key === String(id)) || null; },

  _onSmash(e) {
    const w = this.world, fx = w.fx, rec = this._rec(e.id);
    const dir = { x: Math.cos(e.info?.heading ?? 0), z: Math.sin(e.info?.heading ?? 0) };
    const scale = e.outcome === 'shatter' ? 1.2 : 0.8, metal = rec?.model.layout.kind === 'wire';
    spawnGateFx(fx, 'gate_splinters', e.x, e.z, { dir, speed: e.speed, scale, y: e.info?.y ?? 0.7, metal });
    // snow lying on the top rail comes off (snow theaters: the prop snow cover is on)
    const snowy = w.mission?.theater === 'snow' || (w.mission?.lighting?.snow ?? 0) > 0 || w.theater === 'snow';
    if (snowy && rec) {
      const rot = rec.gate.params?.rot ?? 0;
      spawnGateFx(fx, 'gate_snow_clumps', rec.gate.x, rec.gate.z, { tx: Math.cos(rot), tz: Math.sin(rot), w: rec.model.layout.w, top: rec.model.layout.h, dx: dir.x, dz: dir.z });
    }
    // camera shake: a crash, not a blast — small, fading with the distance from the view centre
    const cam = w.game?.cameraController?.target || w.game?.cameraRig?.controller?.target;
    const d = cam ? Math.hypot(cam.x - e.x, cam.z - e.z) : 15;
    const amt = (e.outcome === 'shatter' ? 0.32 : 0.2) * Math.max(0, 1 - d / 45);
    if (amt > 0.01) fx?.vfx?.addShake?.(amt);
  },

  _onHold(e) {
    const rec = this._rec(e.id);
    if (!rec) return;
    rec.model.nudge(Math.min(0.9, 0.25 + (e.J || 0) / 4000), e.dir?.[1] ?? 1);
    spawnGateFx(this.world.fx, 'gate_thud', e.x, e.z, { v: 2, heavy: false });
  },

  /** A vehicle rolling over flat wreckage pitches a little (physics-visuals blast rock, tiny Δv). */
  _bumps() {
    const w = this.world;
    for (const rec of this.gates) {
      if (!rec.detached) continue;
      for (const v of w.vehicles || []) {
        if (v.removed || !(v.speed > 0.8) || Math.hypot(v.x - rec.gate.x, v.z - rec.gate.z) > 25) continue;
        const [l, wd] = v.def?.size || [4, 2], c = Math.cos(v.heading || 0), s = Math.sin(v.heading || 0);
        let seen = rec.bumped.get(v);
        if (!seen) rec.bumped.set(v, (seen = new Set()));
        for (const [id, mesh] of rec.model.pieces) {
          if (seen.has(id) || mesh.matrixAutoUpdate || !mesh.visible || mesh.userData.splinter) continue; // posts stay in the gate group
          const x = mesh.matrix.elements[12], y = mesh.matrix.elements[13], z = mesh.matrix.elements[14];
          const dx = x - v.x, dz = z - v.z, along = dx * c + dz * s, across = -dx * s + dz * c;
          // under a wheel track (front or rear axle band) and low enough to drive over
          if (Math.abs(along) > l / 2 - 0.3 || Math.abs(Math.abs(across) - wd / 2 + 0.3) > 0.35) continue;
          if (y - this._groundY(x, z) > HULL_CLEARANCE) continue;
          seen.add(id);
          if (v.blastRock && !v.blastRock.bump && w.time - v.blastRock.t0 < 0.6) continue;
          const back = along < 0 ? -1 : 1; // front wheels lift the nose, rear ones the tail
          v.blastRock = { t0: w.time, dv: 0.16, heavy: false, dx: -c * back, dz: -s * back, bx: v.x, bz: v.z, bump: true };
        }
      }
    }
  },

  dispose() {
    for (const off of this._offs) off?.();
    this._offs = [];
    for (const rec of this.gates) for (const m of rec.model.pieces.values()) if (m.parent === this.scene) this.scene.remove(m);
    this.gates = [];
  },
});
