/**
 * Water down the dam (M3, structure `waterFx`; design-spec §7.6; docs/water-pipeline.md §11): spillway sheets pouring
 * from the two gate bays (travel-time advected), thin trickles and seeps down the face, a spray-soaked splash zone, dark
 * wet streaks, frozen trickles and a row of icicles (Norway, March); below, the plunge pool and tailwater driven by a
 * baked flow field (dam-water-pool.js), GPU spray and mist (dam-water-spray.js) and ripples in the water sim.
 * The sound is the mission's positional ambience layers `waterfall`, `waterfall_roar`, `rapids` (missions/m03).
 * Everything goes once the dam is destroyed (a short fade) and the burst takes over (render/dam-breach.js: the
 * reservoir pours through the breach, boils at the landing and surges down the river; the lake behind keeps it
 * running, strongest just after the blast and then steady). Visual only.
 *
 *   const fx = createDamWater(world, structures); fx?.frame(dt); fx?.dispose();
 * @module render/dam-water
 */
import * as THREE from 'three';
import { FX_LAYER, WATER_LEVEL } from '../art/water.js';
import { faceSampler, faceRibbon } from './dam-water-geom.js';
import { sheetMaterial, crownMaterial, splashMaterial, wetMaterial, iceMaterial, damWaterUniforms as U, damLight } from './dam-water-mats.js';
import { createDamSpray } from './dam-water-spray.js';
import { createDamPool, poolSources } from './dam-water-pool.js';
import { createBreach } from './dam-breach.js';

/** True when the mission's structures include a dam with water effects (createDamWater would build something). */
export function hasDamWater(structures) {
  return [...(structures?.values?.() || [])].some((s) => s.def?.waterFx && s.object3d);
}
export { loadDamPoolTextures } from './dam-water-pool.js';

/** Default trickles [u, yTop, width, kind] in the dam frame (u along the crest, m; y world). */
export const DAM_STREAMS = [
  [-11.0, 6.9, 0.22, 'flow'], [-9.2, 5.2, 0.3, 'ice'], [-7.4, 6.3, 0.16, 'flow'], [-5.6, 4.6, 0.35, 'ice'], [-3.6, 6.9, 0.2, 'flow'],
  [3.4, 5.8, 0.18, 'flow'], [5.2, 6.9, 0.32, 'ice'], [6.9, 4.1, 0.2, 'flow'], [8.8, 6.6, 0.26, 'flow'], [10.8, 5.0, 0.28, 'ice'], [12.2, 6.8, 0.15, 'flow'],
];
/** Spillway gate bays (u range) and the height the water leaves them at. */
const BAYS = [[-1.55, -0.45], [0.45, 1.55]], BAY_TOP = 4.3;
const OLD_STREAKS = [[-12.6, 2.2], [-10.1, 3.5], [-6.3, 1.6], [-2.6, 2.8], [2.4, 3.9], [4.4, 1.8], [7.7, 2.6], [11.6, 3.1]];
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * @param {object} world (events, water?, scene via caller)
 * @param {Map<string, {def:object, object3d:THREE.Object3D}>} structures map handle structures
 * @returns {{group:THREE.Group, frame:(dt:number)=>void, dispose:()=>void, stats:object}|null}
 */
export function createDamWater(world, structures, renderer = null) {
  const gl = renderer?.isWebGLRenderer ? renderer : renderer?.renderer?.isWebGLRenderer ? renderer.renderer : null;
  const dams = [...(structures?.values?.() || [])].filter((s) => s.def?.waterFx && s.object3d);
  if (!dams.length) return null;
  const group = new THREE.Group();
  group.name = 'dam-water';
  const mats = [], geos = [], mists = [], hot = [], stats = { ribbons: 0, icicles: 0 };
  let pool = null, spray = null, breach = null;
  const add = (g, m, layerFx = true) => {
    if (!g) return null;
    const mesh = new THREE.Mesh(g, m);
    if (layerFx) mesh.layers.set(FX_LAYER);
    mesh.renderOrder = 3;
    group.add(mesh); geos.push(g); mats.push(m);
    return mesh;
  };
  const yW = WATER_LEVEL;
  for (const S of dams) {
    const def = S.def, F = faceSampler(S.object3d, def);
    if (!F.meshes) continue;
    const fx = def.waterFx || {}, streams = fx.streams || DAM_STREAMS, iceEnds = [];
    // 0. the burst (hidden until the dam is destroyed): from the reservoir's level before the breach
    if (!breach) {
      const dr = world.water?.drains?.find?.((d) => d.id === def.id);
      breach = createBreach(def, fx, dr?.from ?? (def.elev > 0 ? def.elev - 1.2 : yW + 4));
      group.add(breach.group);
    }
    // 1. spillway sheets from the gate bays, each with a splash crown where it hits the pool
    BAYS.forEach(([a, b], k) => {
      const g = faceRibbon(F, { u0: (a + b) / 2, w: b - a, yTop: BAY_TOP, yBot: yW, off: 0.07, cols: 4, seed: k });
      if (add(g, sheetMaterial({ speed: 2.0, alpha: 1, len: g?.userData.len, seed: k * 3.1, inception: 3.9 }))) stats.ribbons++;
      // the splash crown thrown up where it hits the pool
      const cw = b - a + 1.0, cr = faceRibbon(F, { u0: (a + b) / 2, w: cw, yTop: yW + 1.1, yBot: yW, off: 0.11, cols: 5, seed: k + 40 });
      add(cr, crownMaterial({ len: cr?.userData.len, seed: k * 5.7, inner: (b - a) / cw }));
      hot.push({ u: (a + b) / 2, w: 1.4, s: 1 });
    });
    // the splash zone: concrete soaked by the spray at the foot of the falls, rimed along its top
    const sz = faceRibbon(F, { u0: 0, w: 10, yTop: yW + 2.4, yBot: yW, off: 0.025, cols: 9, seed: 31 });
    add(sz, splashMaterial({ alpha: 0.55, len: sz?.userData.len, seed: 3 }));
    // 2. trickles (flowing or frozen) with their wet streaks, and old dry streaks from the crest
    streams.forEach(([u, yTop, w, kind], k) => {
      const wet = faceRibbon(F, { u0: u, w: w * 3.2, yTop: yTop + 0.35, yBot: yW, off: 0.03, cols: 3, wobble: 0.03, seed: k });
      add(wet, wetMaterial({ alpha: 0.42, len: wet?.userData.len, seed: k }));
      if (kind === 'ice') {
        const yEnd = Math.max(yW, yTop - (1.2 + 3.5 * hash(k + 0.3)));
        iceEnds.push([u, yEnd]);
        const ice = faceRibbon(F, { u0: u, w: w * 1.3, yTop, yBot: yEnd, off: 0.07, cols: 3, wobble: 0.025, seed: k });
        if (add(ice, iceMaterial({ alpha: 0.62, len: ice?.userData.len, seed: k }))) stats.ribbons++;
      } else {
        const g = faceRibbon(F, { u0: u, w, yTop, yBot: yW, off: 0.06, cols: 3, wobble: 0.04, seed: k });
        if (add(g, sheetMaterial({ speed: 0.8, alpha: 0.7, len: g?.userData.len, seed: k * 1.3, thin: true }))) stats.ribbons++;
        hot.push({ u, w: 0.5, s: 0.45 });
      }
    });
    OLD_STREAKS.forEach(([u, len], k) => {
      const g = faceRibbon(F, { u0: u, w: 0.5 + 0.3 * hash(k), yTop: 7.2, yBot: Math.max(yW, 7.2 - len), off: 0.02, cols: 3, wobble: 0.02, seed: k + 20 });
      add(g, wetMaterial({ alpha: 0.28, len: g?.userData.len, seed: k + 20 }));
    });
    // 3. icicles under the crest's parapet band and at the frozen trickles (lit, opaque ice)
    const tips = [];
    for (let u = -13; u <= 13; u += 0.3) {
      const r = hash(u * 3.7);
      if (r < 0.42) continue;
      const v = F.v(u, 7.6) ?? F.v(u, 7.2);
      if (v == null) continue;
      tips.push({ u, v: v + 0.08, y: 7.7, len: 0.12 + 0.85 * Math.pow(hash(u * 9.1), 2.5), r: 0.03 + 0.05 * hash(u * 5.3) });
    }
    // the frozen trickles end in a few icicles
    for (const [u, yEnd] of iceEnds) if (yEnd > yW + 0.5) for (let j = 0; j < 3; j++) {
      const uu = u + (j - 1) * 0.08, v = F.v(uu, yEnd + 0.1);
      if (v != null) tips.push({ u: uu, v: v + 0.07, y: yEnd + 0.25, len: 0.25 + 0.45 * hash(uu * 7 + j), r: 0.03 });
    }
    if (tips.length) {
      const cone = new THREE.ConeGeometry(1, 1, 6, 1, false).rotateX(Math.PI).translate(0, -0.5, 0);
      const iceMat = new THREE.MeshStandardMaterial({ name: 'dam_icicle', color: 0xdcebf2, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.88 });
      const inst = new THREE.InstancedMesh(cone, iceMat, tips.length), m4 = new THREE.Matrix4();
      tips.forEach((t, k) => {
        const [x, z] = F.world(t.u, t.v);
        m4.compose(new THREE.Vector3(x, t.y, z), new THREE.Quaternion(), new THREE.Vector3(t.r, t.len, t.r));
        inst.setMatrixAt(k, m4);
      });
      inst.name = 'dam-icicles'; inst.castShadow = false;
      group.add(inst); geos.push(cone); mats.push(iceMat);
      stats.icicles = tips.length;
    }
    buildFoot(F, def);
  }

  /** 4. the plunge pool and the tailwater (baked flow field), spray mist. */
  function buildFoot(F, def) {
    const mid = F.v(0, 0.15) ?? 3, c = Math.cos(def.rot ?? 0), sn = Math.sin(def.rot ?? 0);
    const feet = hot.filter((h) => h.s < 1).map((h) => ({ u: h.u, v: F.v(h.u, 0.15) })).filter((t) => t.v != null);
    const sources = poolSources(mid, feet);
    pool = createDamPool(world, F, { sources, boilV: mid + 1.6, mid, y: yW + 0.03, rot: [c, sn], uniforms: { ...U, ...damLight }, gl, sheets: BAYS.map(([a, b]) => (a + b) / 2) });
    if (pool) { pool.mesh.layers.set(FX_LAYER); group.add(pool.mesh); stats.bakeMs = Math.round(pool.field.ms); }
    // spray + mist emitters along the impact line of the curtain (strongest) and at the flowing trickles' feet
    const src = [];
    for (const h of hot) {
      const n = h.s >= 1 ? 4 : 1;
      for (let k = 0; k < n; k++) {
        const u = h.u + (n > 1 ? (k / (n - 1) - 0.5) * h.w : 0), v = F.v(u, 0.3) ?? mid, [x, z] = F.world(u, v + 0.5);
        src.push({ x, z, y: yW + 0.05, s: h.s, u });
      }
    }
    const [dx, dz] = (() => { const a = F.world(0, 0), b = F.world(0, 1); return [b[0] - a[0], b[1] - a[1]]; })();
    mists.push({ src, dx, dz });
    // spray, impact cloud and mist only off the sheets' plunges (the trickles' feet only ripple the pool)
    spray = createDamSpray(src.filter((q) => q.s >= 1), [dx, dz], { ...U, ...damLight });
    for (const m of spray.meshes) { m.layers.set(FX_LAYER); group.add(m); }
  }

  // runtime: time, mist, ripples in the water sim, fade-out once the dam is gone, then the burst
  let fading = false, disturbAcc = 0, gone = false, dseq = 0, burst = 0;
  const damIds = new Set(dams.map((s) => s.def.id).filter(Boolean));
  const off = (world.listen ? world.listen.bind(world) : world.events?.on?.bind(world.events))?.('structure:destroyed', (e) => { if (damIds.has(e?.id)) { fading = true; breach?.start(); } });
  let over = false; // the burst is over (no head left behind the breach): nothing at all
  // loaded with the dam already down: the intact dam's water is gone and the breach runs in its settled outflow
  for (const id of damIds) if (world.byId?.(id)?.destroyed) {
    gone = fading = true;
    for (const c of group.children) if (c !== breach?.group) c.visible = false;
    breach?.start(true);
  }
  const reservoir = () => world.water?.drains?.find?.((d) => damIds.has(d.id))?.body?.level ?? null;
  U.uFade.value = gone ? 0 : 1;
  U.uLight.value = world.mission?.theater === 'night' ? 0.35 : 0.82;
  // the sun (key light) and the sky for the lit water: direction, strength, night
  const lit = world.mission?.lighting || {}, night = world.mission?.theater === 'night' || (lit.sunElevDeg ?? 30) < 0;
  const el = ((lit.sunElevDeg ?? 30) * Math.PI) / 180, az = ((lit.sunAzimuthDeg ?? 135) * Math.PI) / 180;
  damLight.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(Math.max(el, 0.05)), -Math.cos(el) * Math.cos(az)).normalize();
  damLight.uNight.value = night ? 1 : 0;
  damLight.uSunI.value = night ? 0.15 : /overcast|fog|snow/.test(lit.hdri || '') ? 0.25 : 0.9;
  damLight.uSky.value.set(...(night ? [0.06, 0.08, 0.12] : [0.55, 0.6, 0.66]));
  return {
    group, stats, get pool() { return pool; },
    get breach() { return breach; },
    frame(dt) {
      if (over || !(dt > 0)) return;
      U.uTime.value = (U.uTime.value + dt) % 3600; // every animated term divides 3600 s
      if (!fading) pool?.frame(dt, U.uTime.value);
      if (fading && !gone) {
        U.uFade.value = Math.max(0, U.uFade.value - dt / 1.5);
        for (const c of group.children) if (c.isInstancedMesh) c.visible = false;
        // the intact dam's water is gone; the burst (its own group, its own strength) carries on
        if (U.uFade.value <= 0) { gone = true; for (const c of group.children) if (c !== breach?.group) c.visible = false; }
      }
      burst = breach ? breach.frame(dt, reservoir()) : 0;
      if (gone && !breach?.active && breach?.surgeAt > 0) { over = true; group.visible = false; return; }
      if (fading && world.wind?.sample && breach) { const w = world.wind.sample(breach.landing.x, breach.landing.z); breach.setWind(w.x || 0, w.z || 0, dt); }
      if (gone) { rippleBurst(dt); return; }
      if (spray && world.wind?.sample) { const w = world.wind.sample(mists[0].src[0].x, mists[0].src[0].z); spray.setWind(w.x || 0, w.z || 0, dt); }
      // the falling water keeps the pool rippling and foaming (water sim, ~10 Hz)
      const W = world.water;
      if (W?.disturb && mists.length && !fading && (disturbAcc += dt) > 0.1) {
        disturbAcc = 0;
        const s = mists[0].src[(dseq++) % mists[0].src.length];
        W.disturb(s.x + (hash(dseq) - 0.5) * 1.2, s.z + hash(dseq * 3) * 1.5, -0.04 * s.s, 0.7 + 0.6 * s.s, 0.5 * s.s);
      }
    },
    dispose() {
      if (typeof off === 'function') off();
      group.removeFromParent();
      pool?.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      spray?.dispose();
      breach?.dispose();
    },
  };

  /** While the reservoir pours through the breach: churn its landing and the surge front in the water sim (~10 Hz). */
  function rippleBurst(dt) {
    const W = world.water;
    if (!W?.disturb || burst <= 0.05 || (disturbAcc += dt) <= 0.1) return;
    disturbAcc = 0; dseq++;
    const L = breach.landing, j = hash(dseq) - 0.5;
    W.disturb(L.x + L.dz * j * L.w, L.z - L.dx * j * L.w, -0.12 * burst, 1.6, 0.3 * burst);
    const at = pointAlong(breach.surgeLine, breach.surgeAt);
    if (at) W.disturb(at[0] + (hash(dseq * 5) - 0.5) * 6, at[1] + (hash(dseq * 7) - 0.5) * 6, 0.1 * burst, 2.2, 0.15 * burst);
  }
}

/** The point `d` metres along a polyline of [x, z] points (clamped to its ends). */
function pointAlong(line, d) {
  if (!line || line.length < 2) return null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], l = Math.hypot(bx - ax, bz - az);
    if (d <= l || i + 2 === line.length) { const t = l ? Math.min(1, d / l) : 0; return [ax + (bx - ax) * t, az + (bz - az) * t]; }
    d -= l;
  }
  return null;
}
