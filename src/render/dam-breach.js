/**
 * The burst dam (M3, structure `waterFx`; design-spec §7.6): once the dam is destroyed the raised reservoir pours
 * through the breach in dam_arch_destroyed as a thick tongue of water that falls into the pool, boils white at the
 * landing and sends a surge front of white water down the river. Its strength follows the reservoir's drain
 * (art/water.js `drains`, 40 s): full while the head is high, thinning and gone once the reservoir is down.
 * Visual only; owned by render/dam-water.js (`createBreach(...)` → {group, start, frame}).
 * @module render/dam-breach
 */
import * as THREE from 'three';
import { FX_LAYER, WATER_LEVEL } from '../art/water.js';
import { waterStrip } from './dam-water-geom.js';
import { sheetMaterial, foamMaterial } from './dam-water-mats.js';

/** The gap of dam_arch_destroyed in the dam frame (u centre, width m) and the crest's downstream edge (v). */
export const BREACH = { u0: 0, w: 4.4, vLip: 1.5, vBack: -4, fall: 6.5 };
/** Surge front speed down the river (m/s). */
const SURGE_SPEED = 7;

/**
 * @param {{x:number, z:number, rot:number}} def the dam's structure def
 * @param {object} fx its `waterFx` (`surge` or `downstream`: the river's centreline below the dam)
 * @param {number} level0 the reservoir's surface before the breach (m)
 */
export function createBreach(def, fx, level0) {
  const yW = WATER_LEVEL, H0 = Math.max(1, level0 - yW), B = BREACH;
  const c = Math.cos(def.rot ?? 0), s = Math.sin(def.rot ?? 0), X = def.x ?? 0, Z = def.z ?? 0;
  const world = (u, v) => [X + u * c - v * s, Z + u * s + v * c];
  const group = new THREE.Group();
  group.name = 'dam-breach';
  group.visible = false;
  const amt = { value: 0 }, geos = [], mats = [];
  // 1. the tongue, in the dam frame (x = u, z = v, y over the river level): scaled in y by the remaining head
  const tongue = new THREE.Group();
  tongue.position.set(X, yW, Z); tongue.rotation.y = -(def.rot ?? 0);
  const vEnd = B.vLip + B.fall, cols = 9, pos = [], flow = [];
  let along = 0, prev = null, rows = 0;
  for (let v = B.vBack; v <= vEnd + 1e-6; v += 0.25, rows++) {
    const y = v < B.vLip ? H0 * (1 - 0.25 * ((v - B.vBack) / (B.vLip - B.vBack)) ** 2) : 0.75 * H0 * (1 - ((v - B.vLip) / B.fall) ** 2);
    const spread = 1 + 0.35 * Math.max(0, (v - B.vLip) / B.fall);
    if (prev) along += Math.hypot(v - prev[0], y - prev[1]);
    prev = [v, y];
    for (let k = 0; k < cols; k++) {
      const a = k / (cols - 1), u = B.u0 + (a - 0.5) * B.w * spread;
      pos.push(u, y + 0.35 * (1 - (2 * a - 1) ** 2), v); flow.push(a, along);
    }
  }
  const idx = [];
  for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < cols; k++) { const a = r * cols + k; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  tg.setIndex(idx); tg.computeBoundingSphere();
  const add = (parent, g, m) => {
    m.uniforms.uFade = amt; // the breach's own strength, not the intact dam's fade
    const mesh = new THREE.Mesh(g, m);
    mesh.layers.set(FX_LAYER); mesh.renderOrder = 3; mesh.frustumCulled = false;
    parent.add(mesh); geos.push(g); mats.push(m);
    return mesh;
  };
  add(tongue, tg, sheetMaterial({ speed: 6.5, alpha: 0.97, len: along, seed: 4.2 }));
  group.add(tongue);
  // 2. the boil at the landing and the surge down the river (world space)
  const landing = world(B.u0, vEnd - 2.5); // under the tongue's end: the boil starts beneath it
  const line = [landing, ...(fx.surge || fx.downstream || [])];
  let surge = null, surgeLen = 0;
  if (line.length >= 2) {
    const g = waterStrip(line, { y: yW + 0.04, w0: 13, w1: 18, step: 1, cols: 13 });
    surgeLen = g.userData.len;
    surge = add(group, g, foamMaterial({ speed: 4.2, alpha: 0.9, len: surgeLen + 6, width: 17, fadeIn: 2.5, boil: 1.8, surge: 0.01, hot: [[0, 5, 0.12, 1], [-4, 2.5, 0.08, 0.7], [4, 2.5, 0.08, 0.7]] }));
  }
  const [dx, dz] = [world(0, 1)[0] - world(0, 0)[0], world(0, 1)[1] - world(0, 0)[1]];
  let t = -1;
  return {
    group,
    /** Where the water lands and which way it runs (mist / ripples). */
    landing: { x: world(B.u0, vEnd)[0], z: world(B.u0, vEnd)[1], dx, dz, w: B.w * 1.35 },
    get active() { return t >= 0 && amt.value > 0.001; },
    get surgeAt() { return t < 0 ? 0 : Math.min(surgeLen, SURGE_SPEED * t); },
    get surgeLine() { return line; },
    start() { if (t < 0) { t = 0; group.visible = true; } },
    /**
     * @param {number} dt
     * @param {number|null} level the reservoir's surface now (null: own drain curve)
     * @returns {number} strength 0..1
     */
    frame(dt, level) {
      if (t < 0) return 0;
      t += dt;
      const u = Math.min(1, t / 40), own = level0 + (yW - level0) * (1 - (1 - u) ** 3);
      const k = Math.max(0, Math.min(1, ((level ?? own) - yW) / H0));
      const ramp = Math.min(1, t / 0.6);
      amt.value = k < 2e-3 ? 0 : ramp * ramp * Math.min(1, k * 4); // (snap: the drain's last millimetres)
      tongue.scale.y = Math.max(0.04, k);
      if (surge) surge.material.uniforms.uSurge.value = Math.max(0.01, SURGE_SPEED * t);
      if (amt.value <= 0.001 && t > 2) group.visible = false;
      return amt.value;
    },
    dispose() { group.removeFromParent(); for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}
