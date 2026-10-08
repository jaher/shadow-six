/**
 * The burst dam (M3, structure `waterFx`; design-spec §7.6). Once the dam is destroyed the raised reservoir pours
 * through the slot blown in dam_arch_destroyed as one continuous body of water (render/dam-breach-glsl.js):
 * - on the reservoir, a funnel of flow lines converging on the slot's mouth (the lake drawn towards the breach);
 * - through the slot, the full width between its cheeks, a fast surface bending down from the reservoir's level to the
 *   lip (the drawdown), torn white round the pier stubs hanging into it;
 * - over the lip, a thick ballistic jet (top surface + side walls) that lands in the pool, with a churning white band
 *   at the lip, spray thrown off it, an impact cloud, spray and mist where it lands (render/dam-water-spray.js), the
 *   boil and a surge front running down the river.
 * The flow's shape follows the reservoir (art/water.js `drains`): just after the blast the water stands almost at full
 * height in the gap (the dam-break "wall") and races to the pool, then the drawdown develops and the reservoir drops
 * RESERVOIR_DRAWDOWN m and holds — a strong steady outflow for good (the lake behind keeps feeding it).
 * Visual only; owned by render/dam-water.js (`createBreach(...)` → {group, start, frame}).
 * @module render/dam-breach
 */
import * as THREE from 'three';
import { FX_LAYER, WATER_LEVEL, RESERVOIR_DRAWDOWN, DRAIN_S } from '../art/water.js';
import { waterStrip } from './dam-water-geom.js';
import { foamMaterial, damWaterUniforms, damLight } from './dam-water-mats.js';
import { breachMaterial } from './dam-breach-glsl.js';
import { createDamSpray } from './dam-water-spray.js';

/**
 * The slot blown through dam_arch_destroyed, in the dam frame (u along the crest, v downstream, y world) as the model
 * stands at the M3 dam (elev 7): the cheeks' faces at |u| `hw` from their upstream ends (`vMouth`) to the downstream
 * face (`vLip`); its floor a V down to `yFloor` (under the tailwater); the pier stubs hang into it from the deck down to
 * y ~3.7 (centre: |u| < 0.25, v -1 … 3; sides: |u| 1.75 … 2.25, v 1.5 … 3.1). `vEdge`: where the reservoir's own
 * water surface ends inside the slot — its polygon stops at the upstream face's arc (v -0.97 at u 0), but near a bank
 * the body's mask is the continuous shore field (art/water/bake.js), which runs on over the tailwater cells under the
 * deck: the drawn surface reaches ~1.5 m further (measured on screen). The flow stays on top of it up to there.
 * `rim` / `rimDeg`: the funnel on the reservoir.
 */
export const BREACH = { u0: 0, hw: 2.25, vMouth: -2.2, vLip: 3.1, vEdge: 0.55, yFloor: -2, rim: 11, rimDeg: 75 };
/** Settled drop of the surface from the reservoir to the lip, × the head over the slot's floor. */
export const BREACH_DRAW = 0.2;
const SURGE_SPEED = 7, SURGE_DELAY = 1.1; // the surge front leaves the landing once the water gets there
const OFF = 0.05;   // the flow surface over the reservoir's (clear of its ripples)
const OVER = 0.35;  // inside the slot the water runs this far into the cheeks (hidden in the concrete: no seam on a jagged face)
const WALL_T = 2.2; // the dam-break wall of water settles into the drawdown over ~this (s)
const COLS = 17, NF = 14, NN = 26, NW = 6;

/**
 * Long profile of the flow for reservoir level `L` (m) and the dam-break wall `w` (1 at the blast → 0 settled).
 * The surface stays at the reservoir's level (+OFF) while the reservoir's own water lies under it, bends down through
 * the slot to `yLip` and leaves the lip as a ballistic jet `yJet(x)` (x = metres past the lip) landing `xLand` out.
 */
export function breachProfile(L, w = 0, yW = WATER_LEVEL) {
  const B = BREACH, h = Math.max(0.5, L - B.yFloor);
  const d = BREACH_DRAW * h * (1 - 0.75 * w) + OFF;
  const v0 = B.vEdge + 0.15, run = B.vLip - v0, yTop = L + OFF, yLip = yTop - d;
  const slope = (-1.5 * d) / run;                      // dy/dv where the water leaves the slot
  const vh = Math.sqrt(2.25 + 19.62 * d);              // speed over the lip: the approach (1.5 m/s) + the drop
  const a = 9.81 / (2 * vh * vh);
  const xAt = (y) => (slope + Math.sqrt(slope * slope + 4 * a * Math.max(0.01, yLip - y))) / (2 * a);
  const xLand = xAt(yW);
  return {
    L, yTop, yLip, d, v0, run, slope, vh, a, xLand, vLand: B.vLip + xLand, xEnd: xAt(yW - 0.7),
    ySlot: (v) => (v <= v0 ? yTop : yTop - d * Math.min(1, (v - v0) / run) ** 1.5),
    yJet: (x) => yLip + slope * x - a * x * x,
  };
}

/**
 * @param {{x:number, z:number, rot:number}} def the dam's structure def
 * @param {object} fx its `waterFx` (`surge` or `downstream`: the river's centreline below the dam)
 * @param {number} level0 the reservoir's surface before the breach (m)
 */
export function createBreach(def, fx, level0) {
  const yW = WATER_LEVEL, H0 = Math.max(1, level0 - yW), B = BREACH;
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), X = def.x ?? 0, Z = def.z ?? 0;
  const world = (u, v) => [X + u * c - v * s, Z + u * s + v * c];
  const [dx, dz] = [-s, c]; // downstream (world xz)
  const group = new THREE.Group();
  group.name = 'dam-breach';
  group.visible = false;
  const amt = { value: 0 }, geos = [], mats = [], sprays = [];
  const levelEnd = Math.max(yW, level0 - RESERVOIR_DRAWDOWN);
  const nominal = breachProfile(levelEnd, 0, yW);

  // 1. the flow surface (funnel → slot → jet) and the jet's side walls, in the dam frame (x = u, y world, z = v)
  const flowG = new THREE.Group();
  flowG.position.set(X, 0, Z); flowG.rotation.y = -(def.rot ?? 0);
  const slotV = [];
  for (let v = B.vMouth; v < B.vLip - 0.12; v += 0.25) slotV.push(v);
  slotV.push(B.vLip);
  const rows = NF + slotV.length + NN, nMain = rows * COLS, nWall = 2 * (NN + 1) * NW;
  const pos = new Float32Array((nMain + nWall) * 3), flow = new Float32Array((nMain + nWall) * 2), aux = new Float32Array((nMain + nWall) * 3);
  const acr = (k) => (2 * k) / (COLS - 1) - 1;
  const th = (B.rimDeg * Math.PI) / 180;
  const slotHw = (v) => B.hw + OVER - (OVER - 0.12) * Math.min(1, Math.max(0, (v - (B.vLip - 0.8)) / 0.8));
  const jetHw = (x) => B.hw + 0.12 + 0.12 * x;
  // funnel rows: from the rim (s 1) to just short of the mouth; each column a streamline from the rim to the mouth
  const funnelUV = (k, sr) => {
    const t = acr(k) * th, e = [acr(k) * (B.hw + OVER), B.vMouth], A = [B.u0 + B.rim * Math.sin(t), B.vMouth - B.rim * Math.cos(t)], f = sr ** 1.6;
    return [e[0] + (A[0] - e[0]) * f, e[1] + (A[1] - e[1]) * f];
  };
  const xs = new Float32Array(NN + 1); // metres past the lip of each jet row (0 = the lip, the slot's last row)
  /** Lay the vertices out for profile P (positions + the zone coordinate; travel times are fixed at build). */
  function shape(P) {
    let r = 0;
    for (let i = 0; i < NF; i++, r++) {
      const sr = 1 - i / NF;
      for (let k = 0; k < COLS; k++) { const [u, v] = funnelUV(k, sr), q = r * COLS + k; pos.set([u, P.yTop, v], q * 3); aux[q * 3] = -1 - sr; }
    }
    for (const v of slotV) {
      const y = P.ySlot(v), hw = slotHw(v), zz = -1 + (v - B.vMouth) / (B.vLip - B.vMouth);
      for (let k = 0; k < COLS; k++) { const q = r * COLS + k; pos.set([B.u0 + acr(k) * hw, y, v], q * 3); aux[q * 3] = Math.min(zz, -1e-4); }
      r++;
    }
    for (let j = 1; j <= NN; j++, r++) {
      const x = P.xEnd * (j / NN) ** 1.15; xs[j] = x;
      const y = P.yJet(x), hw = jetHw(x) + 0.15, crown = 0.15 * Math.min(1, x / 0.6);
      for (let k = 0; k < COLS; k++) { const q = r * COLS + k, ac = acr(k); pos.set([B.u0 + ac * hw, y + crown * (1 - ac * ac), B.vLip + x], q * 3); aux[q * 3] = x / P.xLand; }
    }
    // the side walls: just inside the top's frayed edges, from under it down into the pool, lip → past the landing
    let q = nMain;
    for (const sd of [-1, 1]) for (let j = 0; j <= NN; j++) {
      const x = xs[j], r2 = (jetHw(x) - 0.1) ** 2 / (jetHw(x) + 0.15) ** 2, yTop = P.yJet(x) + 0.15 * Math.min(1, x / 0.6) * (1 - r2) - 0.03;
      const u = B.u0 + sd * (jetHw(x) - 0.1);
      for (let m = 0; m < NW; m++, q++) {
        const f = m / (NW - 1);
        // (the flank bulges out like a round jet's, more so as it falls)
        const bulge = sd * (0.12 + 0.18 * Math.min(1, x / 2)) * Math.sin(Math.PI * Math.min(1, f * 1.3));
        pos.set([u + bulge, yTop + (yW - 0.4 - yTop) * f, B.vLip + x], q * 3);
        aux[q * 3] = x / P.xLand; aux[q * 3 + 1] = 1; aux[q * 3 + 2] = f;
      }
    }
  }
  shape(nominal);
  // travel time from the rim along the centre streamline, from the settled flow's speeds (fixed: the pattern never jumps)
  {
    const mid = (COLS - 1) >> 1, speed = new Float32Array(rows), tau = new Float32Array(rows);
    const wM = 2 * (B.hw + OVER);
    for (let r = 0; r < rows; r++) {
      const q = r * COLS, y = pos[(q + mid) * 3 + 1];
      if (r < NF) speed[r] = Math.max(0.25, (1.5 * wM) / Math.hypot(pos[q * 3] - pos[(q + COLS - 1) * 3], pos[q * 3 + 2] - pos[(q + COLS - 1) * 3 + 2]));
      else if (r < NF + slotV.length) speed[r] = Math.sqrt(2.25 + 19.62 * Math.max(0, nominal.yTop - y));
      else speed[r] = Math.sqrt(nominal.vh ** 2 + 19.62 * Math.max(0, nominal.yLip - y));
      if (r) {
        const a = (q + mid - COLS) * 3, b = (q + mid) * 3;
        tau[r] = tau[r - 1] + Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]) / (0.5 * (speed[r] + speed[r - 1]));
      }
      for (let k = 0; k < COLS; k++) flow.set([acr(k), tau[r]], (q + k) * 2);
    }
    let qq = nMain;
    for (const sd of [-1, 1]) for (let j = 0; j <= NN; j++) for (let m = 0; m < NW; m++, qq++) flow.set([sd, tau[NF + slotV.length - 1 + j]], qq * 2);
  }
  const idx = [];
  for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < COLS; k++) { const a = r * COLS + k; idx.push(a, a + COLS, a + 1, a + 1, a + COLS, a + COLS + 1); }
  for (let sd = 0; sd < 2; sd++) for (let j = 0; j < NN; j++) for (let m = 0; m + 1 < NW; m++) {
    const a = nMain + sd * (NN + 1) * NW + j * NW + m;
    idx.push(a, a + NW, a + 1, a + 1, a + NW, a + NW + 1);
  }
  const fg = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), auxA = new THREE.BufferAttribute(aux, 3).setUsage(THREE.DynamicDrawUsage);
  fg.setAttribute('position', posA); fg.setAttribute('flow', new THREE.BufferAttribute(flow, 2)); fg.setAttribute('aux', auxA);
  fg.setIndex(idx);
  const fmat = breachMaterial({ ...damWaterUniforms, ...damLight });
  fmat.uniforms.uAmt = amt;
  fmat.uniforms.uBend.value = (nominal.v0 + 0.3 - B.vMouth) / (B.vLip - B.vMouth);
  const flowMesh = new THREE.Mesh(fg, fmat);
  flowMesh.name = 'dam-breach-flow'; flowMesh.layers.set(FX_LAYER); flowMesh.renderOrder = 3; flowMesh.frustumCulled = false;
  flowG.add(flowMesh); geos.push(fg); mats.push(fmat);
  group.add(flowG);

  // 2. the boil at the landing and the surge down the river (world space; from the foot of the face, under the jet)
  const add = (g, m) => {
    m.uniforms.uFade = amt; // the breach's own strength, not the intact dam's fade
    const mesh = new THREE.Mesh(g, m);
    mesh.layers.set(FX_LAYER); mesh.renderOrder = 3; mesh.frustumCulled = false;
    group.add(mesh); geos.push(g); mats.push(m);
    return mesh;
  };
  const line = [world(B.u0, B.vLip + 1.9), ...(fx.surge || fx.downstream || [])];
  let surge = null, surgeLen = 0;
  if (line.length >= 2) {
    const g = waterStrip(line, { y: yW + 0.04, w0: 13, w1: 18, step: 1, cols: 13 });
    surgeLen = g.userData.len;
    // (`width` 12.5: the sides fade inside the strip from its start on — at 17 its first 13 m had hard straight edges)
    surge = add(g, foamMaterial({ speed: 4.2, alpha: 0.9, len: surgeLen + 6, width: 12.5, fadeIn: 2.5, boil: 1.8, surge: 0.01, hot: [[0, 5, 0.12, 1], [-4, 2.5, 0.08, 0.7], [4, 2.5, 0.08, 0.7]] }));
  }

  // 3. spray: thrown off the lip, and the impact cloud / spray / mist where the jet lands (GPU particles)
  const lipAmt = { value: 0 }, hitAmt = { value: 0 };
  const sprayU = (fade) => ({ ...damWaterUniforms, ...damLight, uFade: fade });
  const across = (n, v, y, st) => Array.from({ length: n }, (_, k) => { const [x, z] = world(B.u0 + ((k + 0.5) / n - 0.5) * 2 * (B.hw - 0.2), v); return { x, y, z, s: st }; });
  const lipSpray = createDamSpray(across(5, B.vLip + 0.25, nominal.yLip, 0.7), [dx, dz], sprayU(lipAmt), { spray: 170, mist: 0, cloud: 0 });
  const hitSpray = createDamSpray(across(6, nominal.vLand - 0.3, yW + 0.05, 1), [dx, dz], sprayU(hitAmt), { spray: 320, mist: 80, cloud: 72 });
  for (const sp of [lipSpray, hitSpray]) { sprays.push(sp); for (const m of sp.meshes) { m.layers.set(FX_LAYER); group.add(m); } }

  let t = -1, P = nominal, lastL = -1e9, lastW = -1e9;
  const landing = { x: 0, z: 0, dx, dz, w: 2 * jetHw(nominal.xLand) };
  const setLanding = () => { const [x, z] = world(B.u0, P.vLand); landing.x = x; landing.z = z; landing.w = 2 * jetHw(P.xLand); };
  setLanding();
  return {
    group,
    /** Where the water lands and which way it runs (ripples in the water sim). */
    landing,
    /** The current long profile (breachProfile). */
    get profile() { return P; },
    get flowMesh() { return flowMesh; },
    get active() { return t >= 0 && amt.value > 0.001; },
    get surgeAt() { return t < 0 ? 0 : Math.min(surgeLen, SURGE_SPEED * Math.max(0, t - SURGE_DELAY)); },
    get surgeLine() { return line; },
    /** Ease the spray's drift towards the wind (m/s, world xz). */
    setWind(x, z, dt) { for (const sp of sprays) sp.setWind(x, z, dt); },
    /** @param {boolean} [settled] loaded with the dam already down: straight into the steady outflow */
    start(settled = false) { if (t < 0) { t = settled ? 10 * DRAIN_S : 0; group.visible = true; } },
    /**
     * @param {number} dt
     * @param {number|null} level the reservoir's surface now (null: own drawdown curve)
     * @returns {number} strength 0..1
     */
    frame(dt, level) {
      if (t < 0) return 0;
      t += dt;
      const u = Math.min(1, t / DRAIN_S), own = level0 + (levelEnd - level0) * (1 - (1 - u) ** 3);
      const L = level ?? own, k = Math.max(0, Math.min(1, (L - yW) / H0));
      const ramp = Math.min(1, t / 0.6);
      amt.value = k < 2e-3 ? 0 : ramp * ramp * Math.min(1, k * 4); // (snap: the last millimetres of head)
      const w = Math.exp(-t / WALL_T);
      if (Math.abs(L - lastL) > 2e-3 || Math.abs(w - lastW) > 2e-3) {
        lastL = L; lastW = w; P = breachProfile(L, w, yW);
        shape(P); posA.needsUpdate = true; auxA.needsUpdate = true; setLanding();
        // the spray rides with the lip and the landing
        for (const m of lipSpray.meshes) m.position.y = P.yLip - nominal.yLip;
        for (const m of hitSpray.meshes) m.position.set(dx * (P.vLand - nominal.vLand), 0, dz * (P.vLand - nominal.vLand));
      }
      const front = -1 + 1.8 * Math.max(0, t - 0.1);
      fmat.uniforms.uFront.value = Math.min(2, front);
      fmat.uniforms.uMass.value = Math.max(0.5, Math.min(1.5, ((L - B.yFloor) / (level0 - B.yFloor)) ** 1.5 * (1 + 0.35 * w)));
      lipAmt.value = amt.value * Math.min(1, Math.max(0, front / 0.3));
      hitAmt.value = amt.value * Math.min(1, Math.max(0, (front - 0.9) / 0.4));
      if (surge) surge.material.uniforms.uSurge.value = Math.max(0.01, SURGE_SPEED * (t - SURGE_DELAY));
      if (amt.value <= 0.001 && t > 2) group.visible = false;
      return amt.value;
    },
    dispose() {
      group.removeFromParent();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const sp of sprays) sp.dispose();
    },
  };
}
