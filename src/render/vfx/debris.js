// CPU rigid debris (fixed-step, deterministic): instanced chunks + hero barrel pieces, shadow-casting.
import * as THREE from 'three';

function chunkGeometry(seedRand) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  const m = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!m.has(key)) m.set(key, 0.6 + seedRand() * 0.6);
    const s = m.get(key); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.6, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

/** Torn open barrel shell: jagged, peeled cylinder segment. */
export function tornShellGeometry(rand, radius = 0.29, height = 0.88) {
  const seg = 24, hs = 8, gap = 0.9 + rand() * 0.8;
  const g = new THREE.CylinderGeometry(radius, radius, height, seg, hs, true, gap / 2, Math.PI * 2 - gap);
  const p = g.attributes.position, v = new THREE.Vector3();
  const jag = []; for (let i = 0; i <= seg; i++) jag.push(rand());
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = Math.min(1, Math.max(0, (v.y / height) + 0.5)); // 0 bottom .. 1 top
    const a = Math.atan2(v.x, v.z);
    const peel = Math.pow(h, 2.2) * (0.35 + 0.4 * Math.abs(Math.sin(a * 1.5)));
    const r = 1 + peel + 0.08 * Math.sin(a * 7 + h * 4);
    v.x *= r; v.z *= r;
    const ji = Math.round(((a + Math.PI) / (Math.PI * 2)) * seg) % (seg + 1);
    if (h > 0.8) v.y -= jag[ji] * 0.25 * height * (h - 0.8) * 5;
    v.y *= 0.8 + 0.2 * Math.cos(a * 2);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Debris {
  constructor(scene, cap = 600, groundHeight = null) {
    this.gh = groundHeight || (() => 0); this.maxCap = cap;
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.1, flatShading: true });
    this.mesh = new THREE.InstancedMesh(chunkGeometry(rnd), this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.count = 0; this.mesh.name = 'vfx-debris';
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.cap = cap; this.items = []; this.heroes = []; this.scene = scene;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  /** chunk: {pos, vel, spin, size, color, trail(bool), burnTime} */
  add(c) {
    if (this.items.length >= this.cap) { // recycle the oldest resting (else oldest) plain chunk
      let k = this.items.findIndex((x) => !x.hero && x.rest); if (k < 0) k = this.items.findIndex((x) => !x.hero);
      if (k < 0) return null; this.items.splice(k, 1);
    }
    const it = { p: c.pos.clone(), v: c.vel.clone(), w: c.spin.clone(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(c.rot || 0, (c.rot || 0) * 2, 0)),
      size: c.size, col: c.color.clone(), trail: c.trail || 0, burn: c.burnTime || 0, rest: false, age: 0, hero: null, r: c.radius ?? c.size * 0.3 };
    this.items.push(it); return it;
  }

  addHero(mesh, c) { // individually meshed piece (barrel shell / lid) sharing the same physics
    mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    const it = this.add({ ...c, color: new THREE.Color(1, 1, 1), size: 1 });
    if (!it) return null;
    it.hero = mesh; it.r = c.radius; this.heroes.push(mesh); return it;
  }

  step(dt, onTrail) {
    const g = -9.81;
    for (const it of this.items) {
      it.age += dt;
      if (it.rest) { if (onTrail && it.burn > it.age) onTrail(it, dt, true); continue; }
      it.v.y += g * dt;
      it.v.multiplyScalar(1 - 0.02 * dt);
      it.p.addScaledVector(it.v, dt);
      const wl = it.w.length();
      if (wl > 1e-4) { this._q.setFromAxisAngle(this._s.copy(it.w).divideScalar(wl), wl * dt); it.q.premultiply(this._q); }
      const gy = this.gh(it.p.x, it.p.z);
      if (it.p.y < gy + it.r) { // ground contact
        it.p.y = gy + it.r;
        if (it.v.y < 0) it.v.y = -it.v.y * 0.28;
        it.v.x *= 0.6; it.v.z *= 0.6; it.w.multiplyScalar(0.55);
        if (Math.abs(it.v.y) < 0.6 && it.v.x * it.v.x + it.v.z * it.v.z < 0.1) { it.rest = true; it.v.set(0, 0, 0); }
      }
      if (onTrail && (it.trail || it.burn > it.age)) onTrail(it, dt, false);
    }
    // write instances
    let n = 0;
    for (const it of this.items) {
      if (it.hero) { it.hero.position.copy(it.p); it.hero.quaternion.copy(it.q); continue; }
      this._m.compose(it.p, it.q, this._s.setScalar(it.size));
      if (n < this.maxCap) { this.mesh.setMatrixAt(n, this._m); this.mesh.setColorAt(n, it.col); n++; }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const h of this.heroes) { this.scene.remove(h); h.geometry.dispose(); h.material.dispose?.(); }
    this.heroes = []; this.items = []; this.mesh.count = 0;
  }
  dispose() { this.clear(); this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
