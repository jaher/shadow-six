/**
 * V wakes behind swimming ducks: two thin crest lines spreading out from the breast at the Kelvin-like angle of a
 * slow swimmer (half-angle ≈ 22°), lighter crests with a darker trough inside, broken into short wavelets, fading over
 * ~3.6 s; at speed (the take-off run, the landing skid) a broken white wash down the middle as well. Each duck leaves a trail of bow points
 * on the water (one every 0.18 s, or every 0.3 m at speed); every point's crest moves out sideways at v·tan(22°) from where it was laid, so
 * the arms bend with the duck's track and stay behind on the water when it stops. Drawn as one dynamic ribbon mesh
 * on the late FX layer (after the water surface, depth-tested against it): one draw call for every duck, no ripple-sim
 * budget (the boat wakes keep that). Pure geometry from the bird sim state; frozen with sim time while paused.
 * @module art/duck-wake
 */
import * as THREE from 'three';
import { FX_LAYER } from './water/passes.js';

const TAN = 0.4, LIFE = 3.6, WASH = 1.2, EMIT = 0.18, MAXS = 32, SIDES = [1, -1];

/** Is the duck on the surface making way (paddling, the take-off run, the landing skid)? Its speed through the water. */
export function wakeSpeed(b) {
  if (b.hidden) return -1;
  if (b.st === 'swim') return b.act === 'dive' && b.dv >= 1 ? -1 : b.v || 0;
  if (b.st === 'skid') return b.v || 0;
  if (b.st === 'flee' && b.run && b.run.t >= 0) return b.v || 0;
  return -1;
}

/** @param {number} cap ducks @param {{layer?:number}} [o] */
export function createDuckWakes(cap, o = {}) {
  const segs = MAXS + 1, perDuck = segs * (2 * 4 + 3), maxV = Math.max(1, cap) * perDuck;
  const pos = new Float32Array(maxV * 3), col = new Float32Array(maxV * 4), idx = new Uint32Array(Math.max(1, cap) * MAXS * (2 * 18 + 12));
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), ca = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  const ia = new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('color', ca); g.setIndex(ia); g.setDrawRange(0, 0);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'duckWakes'; mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.layers.set(o.layer ?? FX_LAYER);
  mesh.userData.waterIgnore = true; mesh.userData.dynamic = true; mesh.userData.ambientLife = 'wake';
  mesh.userData.warmShow = true; // (drawn by the load's program warm-up frame even before any duck swims)
  const trails = new Map(), crest = [0.6, 0.64, 0.68], dark = [0.02, 0.03, 0.04], foam = [0.85, 0.88, 0.9];
  const stats = { points: 0, ducks: 0, verts: 0 };
  let nv = 0, ni = 0;

  const vtx = (x, y, z, c, a) => { const k = nv * 3, q = nv * 4; pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; col[q] = c[0]; col[q + 1] = c[1]; col[q + 2] = c[2]; col[q + 3] = a; return nv++; };

  /** Ribbon along points (px, pz, nx, nz = outward unit, w = width, a = alpha), `bands` across. */
  function ribbon(P, n, y, prof) {
    const B = prof.length, base = nv;
    for (let i = 0; i < n; i++) {
      const p = P[i], x = p[0], z = p[1], dx = p[2] * p[4], dz = p[3] * p[4], al = p[5];
      for (let j = 0; j < B; j++) { const r = prof[j], o = r[0]; vtx(x + dx * o, y, z + dz * o, r[1], al * r[2]); }
    }
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < B; j++) {
      const a = base + i * B + j, b = a + 1, c = a + B, d = c + 1;
      idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = b; idx[ni++] = c; idx[ni++] = d;
    }
  }
  const ARM = [[1, crest, 0], [0, crest, 1], [-0.9, dark, 0.45], [-2, dark, 0]], MID = [[-1, foam, 0], [0, foam, 1], [1, foam, 0]];
  const arm = [], mid = [];
  for (let i = 0; i <= MAXS; i++) { arm.push([0, 0, 0, 0, 0, 0]); mid.push([0, 0, 0, 0, 0, 0]); }

  /**
   * @param {object[]} birds the ducks @param {number} t sim time (s) @param {number} level water surface y (when a duck has no b.gy)
   * @param {(x:number,z:number,y:number)=>boolean} [inView]
   */
  function update(birds, t, level, inView) {
    nv = 0; ni = 0; stats.points = 0; stats.ducks = 0;
    for (const b of birds) {
      let T = trails.get(b);
      const v = wakeSpeed(b), L = b.S.len, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      if (!T) { if (v <= 0.03) continue; T = { s: [], last: -1e9, lx: 0, lz: 0 }; trails.set(b, T); }
      const S = T.s;
      while (S.length && t - S[0].t > LIFE) S.shift();
      if (t < T.last) { S.length = 0; T.last = -1e9; } // sim time went back (restart): start over
      const bx = b.x + c * L * 0.3, bz = b.z + s * L * 0.3;
      const moved = Math.hypot(bx - T.lx, bz - T.lz); // a point every 0.12 s, or every 0.3 m at speed
      if (v > 0.03 && ((t - T.last >= EMIT && moved > 0.02) || moved >= 0.3)) {
        T.last = t; T.lx = bx; T.lz = bz; T.k = (T.k || 0) + 1;
        // rip: this point's wavelet strength (crests every ~3 points: a row of short wavelets, not one drawn line)
        S.push({ x: bx, z: bz, nx: -s, nz: c, v, t, y: Number.isFinite(b.gy) ? b.gy : level, k: T.k, rip: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T.k * 2.1)) });
        if (S.length > MAXS) S.shift();
      }
      if (!S.length) { if (v <= 0.03) trails.delete(b); continue; }
      if (inView && !inView(b.x, b.z, level) && !inView(S[0].x, S[0].z, level)) continue; // the duck or its trail's far end
      stats.ducks++;
      const half = L * 0.13, y = S[S.length - 1].y + 0.012, live = v > 0.03;
      for (const sd of SIDES) {
        let n = 0;
        if (live) { const q = arm[n++]; q[0] = bx + -s * sd * half * 0.5; q[1] = bz + c * sd * half * 0.5; q[2] = -s * sd; q[3] = c * sd; q[4] = 0.02; q[5] = 0; }
        for (let i = S.length - 1; i >= 0; i--) {
          const p = S[i], a = t - p.t, off = half + Math.min(p.v, 1.2) * TAN * a, q = arm[n++];
          q[0] = p.x + p.nx * sd * off; q[1] = p.z + p.nz * sd * off; q[2] = p.nx * sd; q[3] = p.nz * sd;
          q[4] = 0.022 + 0.012 * a;
          const f = 1 - a / LIFE;
          q[5] = 0.34 * Math.min(1.2, p.v / 0.3) * f * f * Math.min(1, a / 0.3) * p.rip;
        }
        if (n >= 2) ribbon(arm, n, y, ARM);
      }
      // the wash down the middle at speed (run / skid): broken foam, short-lived
      let n = 0;
      for (let i = S.length - 1; i >= 0 && n <= MAXS; i--) {
        const p = S[i], a = t - p.t;
        if (a > WASH) break;
        const q = mid[n++], br = p.k & 1 ? 1 : 0.15, side = p.k & 1 ? 1 : -1; // the feet's splashes, left, right, left…
        q[0] = p.x - p.nz * L * 0.35 + p.nx * side * L * 0.05; q[1] = p.z + p.nx * L * 0.35 + p.nz * side * L * 0.05; q[2] = p.nx; q[3] = p.nz;
        const f = 1 - a / WASH;
        q[4] = 0.035 + 0.01 * Math.min(p.v, 4) + 0.06 * a; q[5] = Math.min(0.42, Math.max(0, (p.v - 0.7) / 4)) * f * f * br;
      }
      if (n >= 2) ribbon(mid, n, y + 0.002, MID);
      stats.points += S.length;
    }
    for (const b of trails.keys()) if (!birds.includes(b)) trails.delete(b);
    g.setDrawRange(0, ni);
    stats.verts = nv;
    mesh.visible = ni > 0;
    if (ni) {
      pa.needsUpdate = true; ca.needsUpdate = true; ia.needsUpdate = true;
      pa.clearUpdateRanges(); pa.addUpdateRange(0, nv * 3); ca.clearUpdateRanges(); ca.addUpdateRange(0, nv * 4); ia.clearUpdateRanges(); ia.addUpdateRange(0, ni);
    }
    return ni / 3;
  }

  /** Crest colour from the sky light (linear RGB, about the brightness of the sky in the water), night dimmed. */
  function setLight(sky, k = 1) {
    const m = Math.max(1e-3, sky[0], sky[1], sky[2]);
    for (let i = 0; i < 3; i++) { crest[i] = (sky[i] / m) * 0.5 * k; foam[i] = (0.6 + 0.4 * sky[i] / m) * 0.85 * k; }
  }

  function dispose() { g.dispose(); mat.dispose(); }
  return { mesh, update, setLight, dispose, stats, trails };
}
