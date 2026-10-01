/**
 * Per-frame visuals of the physics layer (bodies-design §A.6, §A.7, §A.4 censored path). Reads sim state, never
 * writes it: loose props follow their bodies, vehicles rock on a spring-damper after a blast (heavy ≤ 5°, light
 * ≤ 18°), and in censored mode a flying body is hidden, a dust puff marks its landing and a gravestone stands where it
 * settled.
 * @module render/physics-visuals
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { headingToRotY } from '../core/math.js';

const _m = new THREE.Matrix4(), _m0 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _qt = new THREE.Quaternion(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** Pose array [x,y,z,qx,qy,qz,qw] → Matrix4. */
function poseMatrix(p, out) { return out.compose(_p.set(p[0], p[1], p[2]), _q.set(p[3], p[4], p[5], p[6]), _s.set(1, 1, 1)); }

let GRAVE = null;
/**
 * A field grave that reads at game zoom (censored mode): a raised, rounded heap of fresh earth (lighter crown, darker
 * foot — never a flat dark oval that reads as a hole), a weathered wooden cross 1.35 m tall and a steel helmet hung on
 * it (the classic battlefield grave). Shared geometry / materials.
 */
function graveMesh() {
  if (!GRAVE) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c7d57, roughness: 0.88 });
    const earth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true });
    const post = new THREE.BoxGeometry(0.12, 1.35, 0.1).translate(0, 0.62, 0);
    const bar = new THREE.BoxGeometry(0.72, 0.11, 0.1).translate(0, 0.95, 0);
    const mound = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.85, 0.34, 1.7).translate(0, -0.02, -0.95);
    // fresh earth: light, dry crown; darker, damp foot; a little clod noise
    const pos = mound.attributes.position, col = new Float32Array(pos.count * 3), lo = new THREE.Color(0x3f3024), hi = new THREE.Color(0x8a7153), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const k = Math.min(1, Math.max(0, pos.getY(i) / 0.15)), n = (Math.sin(pos.getX(i) * 37.1 + pos.getZ(i) * 23.7) * 0.5 + 0.5) * 0.12;
      c.copy(lo).lerp(hi, Math.min(1, k * 0.9 + n)); col.set([c.r, c.g, c.b], i * 3);
    }
    mound.setAttribute('color', new THREE.BufferAttribute(col, 3));
    GRAVE = { post, bar, mound, wood, earth };
  }
  const g = new THREE.Group(); g.name = 'grave';
  for (const [geo, mat] of [[GRAVE.post, GRAVE.wood], [GRAVE.bar, GRAVE.wood], [GRAVE.mound, GRAVE.earth]]) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  const h = helmetMesh(); h.position.set(0, 1.28, 0.02); h.rotation.x = -0.25; g.add(h);
  return g;
}

/**
 * Where a grave fits (visual): the cross at (x, z) and the 1.8 m heap behind it on open ground — no blocked cell (a
 * crate stack, a wall) and no settled loose prop under it. Tries the body's own heading, then turns, then small shifts.
 * @returns {{x:number, z:number, h:number}}
 */
export function graveSpot(w, x, z, h, props = []) {
  const g = w.grid;
  const clear = (px, pz, hh) => {
    const fx = Math.cos(hh), fz = Math.sin(hh);
    for (let d = -0.3; d <= 2.0; d += 0.25) for (const sd of [-0.45, 0, 0.45]) {
      const qx = px - fx * d - fz * sd, qz = pz - fz * d + fx * sd; // along the heap (behind the cross) and across it
      if (!g.walkableAt(qx, qz)) return false;
      if (props.some((p) => Math.abs(p[0] - qx) < 0.8 && Math.abs(p[2] - qz) < 0.8)) return false;
    }
    return true;
  };
  for (const r of [0, 0.6, 1.2]) for (let a = 0; a < (r ? 8 : 1); a++) {
    const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
    for (const dh of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) if (clear(px, pz, h + dh)) return { x: px, z: pz, h: h + dh };
  }
  return { x, z, h };
}

let HELMET = null;
/** A field-grey M35-style steel helmet (lathe profile: dome, flared skirt), visual only. */
function helmetMesh() {
  if (!HELMET) {
    const prof = [[0, 0.13], [0.06, 0.128], [0.1, 0.115], [0.125, 0.09], [0.135, 0.055], [0.14, 0.02], [0.155, -0.005], [0.162, -0.012], [0.15, -0.01], [0.125, 0.01], [0, 0.01]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    HELMET = { geo: new THREE.LatheGeometry(prof, 20).scale(1, 1, 1.12), mat: new THREE.MeshStandardMaterial({ color: 0x4d5247, roughness: 0.62, metalness: 0.35 }) };
  }
  const m = new THREE.Mesh(HELMET.geo, HELMET.mat); m.castShadow = true; m.receiveShadow = true; m.name = 'loose-helmet';
  return m;
}

export class PhysicsVisuals {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.graves = new Map();
    this.helmets = new Map();
    this._landed = new Set();
    this._offBlast = world.events?.on?.('blast:front', (ev) => { if (!ev.restore) this._blowOff(ev); this._fenceBlast(ev); });
    /** palisade logs knocked by blasts: InstancedMesh → {base matrices, per-log motion} */
    this.fences = null;
  }

  /**
   * §A.8 fence sections (visual): palisade logs close to a blast are torn out and thrown (a short ballistic arc,
   * landing flat), those a little further lean away from it. The wall's nav / LOS footprint is unchanged.
   */
  _fenceBlast(ev) {
    if (!this.fences) {
      this.fences = [];
      this.scene?.traverse?.((o) => { if (o.isInstancedMesh && o.name === 'palisade') this.fences.push({ mesh: o, base: null, moves: new Map() }); });
    }
    const R = Math.max(ev.Rk || 0, 2), now = this.world.time;
    const M = new THREE.Matrix4(), p = new THREE.Vector3();
    for (const f of this.fences) {
      const m = f.mesh;
      if (!f.base) { f.base = []; for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M); f.base.push(M.clone()); } }
      m.updateMatrixWorld(true);
      for (let i = 0; i < f.base.length; i++) {
        p.setFromMatrixPosition(f.base[i]).applyMatrix4(m.matrixWorld);
        const d = Math.hypot(p.x - ev.x, p.z - ev.z);
        if (d > R || f.moves.has(i)) continue;
        const dx = (p.x - ev.x) / (d || 1), dz = (p.z - ev.z) / (d || 1), j = ((i * 2654435761) >>> 0) / 4294967296;
        const throwIt = d < R * 0.45;
        f.moves.set(i, { t0: ev.restore ? -1e9 : now + d / 340, dx, dz, j, throwIt,
          v: throwIt ? (1 - d / (R * 0.45)) * 7 + 3 : 0, lean: throwIt ? 0 : (0.2 + 0.45 * (1 - (d - R * 0.45) / (R * 0.55))) * (0.7 + 0.6 * j) });
      }
    }
  }

  _fences(w) {
    if (!this.fences) return;
    const now = w.time, M = new THREE.Matrix4(), T = new THREE.Matrix4(), q = new THREE.Quaternion(), ax = new THREE.Vector3(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const f of this.fences) {
      if (!f.moves.size) continue;
      let dirty = false;
      for (const [i, mv] of f.moves) {
        if (mv.done) continue;
        const t = now - mv.t0;
        if (t < 0) continue;
        f.base[i].decompose(pos, q, sc);
        ax.set(mv.dz, 0, -mv.dx).normalize(); // tip the top away from the blast
        let ang, lift = 0, off = 0;
        if (mv.throwIt) { // torn out: flies ~v·t, tumbles, lands flat and stops
          const tl = Math.max(0.35, mv.v * 0.102), tf = Math.min(t, tl); // lands when the arc (vy = v/2) comes down
          off = mv.v * tf * 0.8; lift = Math.max(0, mv.v * 0.5 * tf - 4.9 * tf * tf);
          ang = (Math.PI / 2) * Math.min(1, tf / tl);
          if (t >= tl) mv.done = true;
        } else { ang = mv.lean * Math.min(1, t / 0.25); if (t >= 0.25) mv.done = true; }
        T.makeRotationAxis(ax, ang);
        M.compose(pos.set(pos.x + mv.dx * off, pos.y + lift + (mv.throwIt ? Math.sin(ang) * 0.3 : 0), pos.z + mv.dz * off), q.premultiply(new THREE.Quaternion().setFromRotationMatrix(T)), sc);
        f.mesh.setMatrixAt(i, M); dirty = true;
      }
      if (dirty) { f.mesh.instanceMatrix.needsUpdate = true; f.mesh.computeBoundingSphere(); }
    }
  }

  /**
   * §A.8 blow-off (visual): the front lifts snow / dust off the roofs it reaches (a puff along the roof edge facing the
   * blast) and off the open ground in a ring; without the wind system (feat/phase3) the grass is pressed flat radially.
   */
  _blowOff(ev) {
    const w = this.world, fx = w.fx, R = Math.max(ev.Rk || 0, 3), Rb = Math.max(ev.Rb || 0, R * 1.6);
    const snowy = (x, z) => ((w.terrain?.materialAt?.(x, z)?.snow ?? 0) > 0.5 || w.mission?.theater === 'snow');
    if (fx?.spawn) {
      for (const s of w.mission?.structures || []) {
        if (s.x == null || s.z == null) continue;
        const d = Math.hypot(s.x - ev.x, s.z - ev.z), half = Math.max(s.w ?? 4, s.d ?? 4) / 2;
        if (d - half > 1.6 * R) continue;
        const ux = (ev.x - s.x) / (d || 1), uz = (ev.z - s.z) / (d || 1), top = (s.h ?? 3) + (typeof w.groundY === 'function' ? w.groundY(s.x, s.z) : 0);
        for (const k of [-1, 1]) {
          const px = s.x + ux * half * 0.8 - uz * k * half * 0.5, pz = s.z + uz * half * 0.8 + ux * k * half * 0.5;
          fx.spawn('dust_kick', px, pz, { y: top, scale: 1.3, surface: snowy(px, pz) ? 'snow' : 'dirt' });
        }
      }
      const n = ev.kind === 'grenade' ? 0 : 6, rr = Rb * 0.55; // the grenade's own dust skirt covers its ring
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (ev.x * 0.37 % 1), px = ev.x + Math.cos(a) * rr, pz = ev.z + Math.sin(a) * rr;
        if (!w.grid?.walkableAt?.(px, pz)) continue;
        fx.spawn('dust_kick', px, pz, { scale: 1.1, surface: snowy(px, pz) ? 'snow' : 'dirt' });
      }
    }
    const t = w.terrain;
    if (!w.wind?.addImpulse && t?.stampTrail) { // grass-ring fallback: blades pushed flat, pointing away from the blast
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, rr = Rb * 0.45;
        t.stampTrail('flatten', ev.x + Math.cos(a) * rr, ev.z + Math.sin(a) * rr, a, { length: Rb * 0.6, width: 1.2, record: false });
      }
    }
  }

  get censored() { return !!this.world.game?.options?.censored; }

  frame() {
    const w = this.world, pw = w.physics;
    if (pw && !pw.isNull) this._props(pw);
    this._vehicles(w);
    this._fences(w);
    this._censored(w);
    this._helmets(w);
  }

  /** Knock-loose helmets: ballistic arc + bounces on the ground from the head bone, then lie there (§A.4). */
  _helmets(w) {
    const now = w.time;
    for (const u of w.enemies) {
      const ho = u.helmetOff;
      if (!ho) continue;
      let h = this.helmets.get(u);
      if (!h) {
        const head = u.model?.real?.getSocket?.('head');
        if (!head) { u.helmetOff = null; continue; }
        u.model.real.show?.('headgear', false);
        const p = head.getWorldPosition(new THREE.Vector3());
        h = { mesh: helmetMesh(), p: p.add(new THREE.Vector3(0, 0.12, 0)), v: new THREE.Vector3(ho.vx, ho.vy, ho.vz), t: ho.t0, rest: false, ang: 0 };
        this.helmets.set(u, h); this.scene.add(h.mesh);
      }
      if (!h.rest) {
        const dt = Math.min(0.1, Math.max(0, now - h.t)); h.t = now;
        h.v.y -= 9.81 * dt; h.p.addScaledVector(h.v, dt); h.ang += ho.spin * dt * (h.v.length() / 6);
        const gy = typeof w.groundY === 'function' ? w.groundY(h.p.x, h.p.z) : 0;
        if (h.p.y < gy + 0.02) {
          h.p.y = gy + 0.02;
          h.v.y = Math.abs(h.v.y) * 0.3; h.v.x *= 0.55; h.v.z *= 0.55;
          if (h.v.length() < 0.4) { h.rest = true; h.flip = (u.id % 3 === 0); }
        }
      }
      h.mesh.position.copy(h.p);
      if (h.rest && h.flip) h.mesh.position.y += 0.125;   // lying dome-down
      h.mesh.rotation.set(h.rest ? (h.flip ? Math.PI : 0.25) : h.ang, u.id * 0.7, h.rest ? 0.12 : h.ang * 0.6);
    }
  }

  _props(pw) {
    for (const it of pw.props.items) {
      if (!it.moved || !it.obj) continue;
      const o = it.obj;
      if (!it._m0) { o.updateMatrix(); it._m0 = o.matrix.clone(); it._p0 = poseMatrix(it.pose0, new THREE.Matrix4()).invert(); o.matrixAutoUpdate = false; }
      if (it._last === it.pose) continue;
      it._last = it.pose;
      o.matrix.copy(poseMatrix(it.pose, _m).multiply(it._p0).multiply(it._m0));
      o.matrixWorldNeedsUpdate = true;
    }
  }

  _vehicles(w) {
    const V = CONFIG.physics.vehicles, now = w.time;
    for (const v of w.vehicles) {
      const f = v.blastFlip, o = v.object3d;
      if (f && o) { // thrown over: the roll eases in with a small bounce and stays (the wreck lies on its side / roof)
        const k = Math.min(1, Math.max(0, (now - f.t0) / V.flipTime)), e = 1 - Math.pow(1 - k, 3);
        const ang = f.ang * e + Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.12;
        _ax.set(f.dz, 0, -f.dx).normalize();
        // syncTransform only writes rotation.y (Euler): restart from the pure yaw, or the tilt would accumulate per frame
        o.quaternion.setFromAxisAngle(_up, headingToRotY(v.heading));
        o.quaternion.premultiply(_qt.setFromAxisAngle(_ax, ang));
        o.position.y += Math.abs(Math.sin(ang)) * 0.45 + (1 - Math.cos(ang)) * 0.35;
        o.matrixWorldNeedsUpdate = true;
        continue;
      }
      const r = v.blastRock;
      if (!r || !o) continue;
      const t = now - r.t0 - Math.hypot(v.x - (r.bx ?? v.x), v.z - (r.bz ?? v.z)) / 340;
      const heavy = r.heavy, maxDeg = heavy ? V.heavyRoll : V.lightRoll, dur = heavy ? V.heavyTime : 1.6;
      if (t > dur * 2.5) { v.blastRock = null; continue; }
      if (t < 0) continue;
      const amp = Math.min(maxDeg, r.dv * (heavy ? 4 : 9)) * Math.PI / 180;
      const w0 = (2 * Math.PI) / (heavy ? 0.8 : 1.1);
      const ang = amp * Math.exp(-V.damping * 0.5 * t) * Math.sin(w0 * t);
      // tilt the top away from the blast: axis = up × dir
      _ax.set(r.dz, 0, -r.dx).normalize();
      o.quaternion.setFromAxisAngle(_up, headingToRotY(v.heading));
      o.quaternion.premultiply(_qt.setFromAxisAngle(_ax, ang));
    }
  }

  _censored(w) {
    const on = this.censored;
    for (const u of w.commandos.concat(w.enemies)) {
      if (u.alive !== false || u.soldierType === 'dog') continue;
      const o = u.object3d;
      const flying = !!u._rd && u._rd.mode === 'blast';
      if (on && flying) { if (o && o.visible) { o.visible = false; u._censorHidden = true; } continue; }
      if (on && u.settled && !u.hiddenBody && !u.sunk && !u.buried && u.state === 'dead') {
        if (o && o.visible) { o.visible = false; u._censorHidden = true; }
        let g = this.graves.get(u);
        if (!g) {
          g = graveMesh(); this.graves.set(u, g); this.scene.add(g);
          if (!this._landed.has(u)) { this._landed.add(u); w.fx?.spawn?.('dust_kick', u.x, u.z, { scale: 1.2 }); }
        }
        if (!g.userData.spot || g.userData.at !== `${u.x},${u.z}`) {
          const props = (w.physics?.props?.items || []).filter((it) => it.moved && it.pose).map((it) => it.pose);
          g.userData.spot = graveSpot(w, u.x, u.z, u.heading || 0, props); g.userData.at = `${u.x},${u.z}`;
        }
        const S = g.userData.spot, gy = typeof w.groundY === 'function' ? w.groundY(S.x, S.z) : 0;
        g.position.set(S.x, gy + (u.y || 0), S.z);
        g.rotation.y = Math.PI / 2 - S.h;
        continue;
      }
      const g = this.graves.get(u);
      if (g) { this.scene.remove(g); this.graves.delete(u); }
      if (o && u._censorHidden && (!on || u.state !== 'dead')) { o.visible = true; u._censorHidden = false; }
    }
  }

  dispose() {
    this._offBlast?.();
    for (const h of this.helmets.values()) this.scene.remove(h.mesh);
    this.helmets.clear();
    for (const g of this.graves.values()) this.scene.remove(g);
    this.graves.clear();
  }
}
