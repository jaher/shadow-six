/**
 * Parked / static vehicles among a mission's STRUCTURES (vehicle integration): rail wagons and locomotives
 * (`train_car` variants), the K5 railway gun, towed flak, parked aircraft, U-boats and airfield windsocks are drawn
 * with the realistic vehicle library (art/vehicle-library.js) instead of the prop placeholders. Gameplay stays the
 * structure's own footprint (grid blocks, interactables, demolition anchors): only the meshes change.
 *
 *   const extra = staticVehicleAssets(missionDef);         // → prepareVehicleArt(def, { extra }) preloads them
 *   dressStaticVehicles(world, missionDef);                  // after the map is built (world.structures)
 *
 * Fit: the model keeps its true scale, centred on the footprint with its front along the structure heading, while it
 * overhangs the footprint by ≤ 15 %; a bigger model is scaled down to the footprint (≥ 0.6, logged). Ground contact:
 * the model's pivot is its ground centre (wheels / keel on y = 0 of the structure group, which sits on the ground).
 * Windsocks turn downwind with inertia and fill with the wind speed (limp in a calm, fully out at ≈ 15 kt).
 * @module art/static-vehicles
 */

import * as THREE from 'three';
import { createVehicleVisual, vehicleLibraryReady, resolveVehicle } from './vehicle-library.js';
import { vehicleArtReady, vehicleArtContext, noteVehicleArt, addVehicleTicker, markShared } from './vehicle-model.js';
import { createWindsockSock } from './windsock-sock.js';

/** Structure type (+ variant hint) → library asset / type, or null (keep the placeholder, logged). */
export function staticVehicleAsset(type, variant = '') {
  const v = String(variant || '').toLowerCase();
  switch (type) {
    case 'train_car':
      if (/boat|cradle/.test(v)) return null;
      if (/loco/.test(v)) return 'loco_br52';
      if (/coach|passenger/.test(v)) return 'coach';
      if (/tip/.test(v)) return 'mine_tipper';
      if (/mine/.test(v)) return 'mine_cart';
      if (/flat|tarp|logs/.test(v)) return 'wagon_flat';
      if (/tank/.test(v)) return 'wagon_tank';
      if (/open|gondola|coal/.test(v)) return 'wagon_open';
      return 'wagon_covered';
    case 'railway_gun': return 'railgun_k5';
    case 'aa_gun': return /quad|flak38|field/.test(v) ? null : 'flak88';
    case 'plane': return /storch/.test(v) ? 'fi156_storch' : /109|fighter/.test(v) ? 'bf109_e' : /87|stuka/.test(v) ? 'ju87_b' : 'ju52_3m';
    case 'uboat': return 'uboat_viic';
    case 'windsock': return 'windsock';
    case 'fuel_bowser': case 'bomb_trolley': case 'starter_cart': case 'chocks': return type;
    default: return null;
  }
}

const STATIC_TYPES = new Set(['train_car', 'railway_gun', 'aa_gun', 'plane', 'uboat', 'windsock', 'fuel_bowser', 'bomb_trolley', 'starter_cart', 'chocks']);

/** Library assets the mission's static structures need (for the preload). */
export function staticVehicleAssets(def) {
  const out = new Set();
  for (const s of def?.structures || []) {
    if (!STATIC_TYPES.has(s?.type)) continue;
    const a = staticVehicleAsset(s.type, s.variant);
    if (a) out.add(a);
  }
  return [...out].sort();
}

/** Placement of a library model on a structure footprint: scale (≤ 1) and whether it was shrunk. */
export function fitOnFootprint(model, fp) {
  const [L, W] = model, [fl, fw] = fp;
  if (!(fl > 0) || !(fw > 0) || (L <= fl * 1.15 && W <= fw * 1.15)) return 1;
  return Math.max(0.6, Math.min(1, (fl * 1.1) / L, (fw * 1.1) / W));
}

/**
 * Swap the placeholder meshes of every static vehicle structure for the library model.
 * @param {object} world (world.structures: Map id → {type, def, object3d}; world.wind for windsocks)
 * @param {object} def mission definition (theater)
 * @returns {object[]} dressed structures [{id, asset, scale}]
 */
export function dressStaticVehicles(world, def) {
  const out = [];
  if (!vehicleArtReady() || !vehicleLibraryReady() || !world?.structures) return out;
  const theater = vehicleArtContext().theater;
  for (const [id, s] of world.structures) {
    if (!STATIC_TYPES.has(s.type) || !s.object3d) continue;
    const asset = staticVehicleAsset(s.type, s.def?.variant);
    if (!asset || !resolveVehicle(asset)) { noteVehicleArt(`${id} (${s.type}${s.def?.variant ? ' ' + s.def.variant : ''}): no library model (placeholder)`); continue; }
    const vis = createVehicleVisual(asset, { theater, seed: id.length * 31 + (s.def?.x | 0), paint: s.def?.paint, destroyed: !!s.def?.wreck });
    if (!vis) continue;
    const holder = new THREE.Group(); holder.name = `static-vehicle:${asset}`;
    holder.rotation.y = Math.PI / 2; // structure local +X = its heading; the library model faces +Z
    holder.add(vis.object3d);
    const rec = { id, asset, scale: 1, vis };
    vis.ready.then(() => {
      const md = vis.meta?.dims || {}, b = vis.meta?.bbox;
      const L = md.length ?? md.length_over_buffers_loco ?? (b ? b.max[2] - b.min[2] : 1);
      const W = md.width ?? md.span ?? md.beam ?? (b ? b.max[0] - b.min[0] : 1);
      const fp = [s.def?.w ?? L, s.def?.d ?? W];
      // true scale when the overhang clears every other structure; else onto the footprint (windsocks never scale)
      const clear = asset === 'windsock' || overhangClear(world.grid, s.def, L, W);
      rec.scale = clear ? 1 : fitOnFootprint([L, W], fp);
      if (rec.scale < 1) { holder.scale.setScalar(rec.scale); noteVehicleArt(`${id} (${asset}) ${L.toFixed(1)}×${W.toFixed(1)} m scaled ${rec.scale.toFixed(2)} onto its ${fp[0]}×${fp[1]} m footprint`); }
      for (const c of s.object3d.children) if (c !== holder && !c.userData?.keepWithLibrary) c.visible = false;
      markShared(vis.object3d);
      if (asset === 'windsock') addVehicleTicker(windsockTicker(vis, s.object3d));
    });
    s.object3d.add(holder);
    out.push(rec);
  }
  return out;
}

/**
 * Does a model L × W centred on the structure (front along its heading) stay clear of every OTHER blocked cell?
 * Cells inside the structure's own footprint rectangle are its own; ≤ 1 % of the samples may touch (edge cells).
 */
export function overhangClear(grid, d, L, W) {
  if (!grid || !d) return true;
  const rot = d.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot), fl = (d.w ?? 0) / 2 + 0.26, fw = (d.d ?? 0) / 2 + 0.26;
  let n = 0, bad = 0;
  for (let a = -L / 2; a <= L / 2 + 1e-6; a += 0.5) for (let b = -W / 2; b <= W / 2 + 1e-6; b += 0.5) {
    if (Math.abs(a) <= fl && Math.abs(b) <= fw) continue; // own footprint
    const x = d.x + c * a - s * b, z = d.z + s * a + c * b;
    const { i, j } = grid.worldToCell(x, z);
    n++;
    if (!grid.inBounds(i, j) || grid.block[grid.idx(i, j)] !== 0) bad++;
  }
  return !n || bad / n <= 0.01;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
/**
 * Windsock driven by the shared WindField (world/wind.js): the sock yaws downwind with inertia (a light damped
 * spring) and its four hoops droop in a calm, lift as the wind rises (fully streamed ≈ 7.7 m/s = 15 kt), with a
 * gust-driven flutter. Frozen while the game is paused (dt = 0).
 */
export function windsockTicker(vis, anchor) {
  const st = { yaw: null, yawV: 0, fill: 0, t: 0 };
  const segs = ['sock_seg1', 'sock_seg2', 'sock_seg3', 'sock_seg4'];
  if (vis.meta) st.cloth = attachSockCloth(vis); // now (the model is loaded): the loading-screen warm-up compiles it
  return (dt, wind) => {
    if (!(dt > 0) || !vis.meta) return;
    st.t += dt;
    anchor.getWorldPosition(_a);
    const w = wind?.sample ? wind.sample(_a.x, _a.z) : { x: 2, z: 1, speed: Math.hypot(2, 1), gust: 0, turb: 0 };
    const sp = w.speed ?? Math.hypot(w.x, w.z);
    // downwind direction in the model's frame (+z = rest direction of the sock)
    const root = vis.object3d;
    root.updateMatrixWorld(true);
    _b.set(_a.x + (w.x || 0), _a.y, _a.z + (w.z || 0)); root.worldToLocal(_b);
    _a.set(0, 0, 0); root.localToWorld(_a); root.worldToLocal(_a);
    const want = sp > 0.2 ? Math.atan2(_b.x - _a.x, _b.z - _a.z) : st.yaw ?? 0;
    if (st.yaw == null) st.yaw = want;
    const d = Math.atan2(Math.sin(want - st.yaw), Math.cos(want - st.yaw));
    st.yawV += (d * 6 - st.yawV * 3.2) * dt;
    st.yaw += st.yawV * dt;
    vis.setPart('sock_yaw', st.yaw / (Math.PI / 2)); // part without limits: angle = t × 90°
    const target = Math.max(0, Math.min(1, (sp - 0.8) / 6.9)); // limp under ~1.5 kt, fully out at 15 kt
    st.fill += (target - st.fill) * Math.min(1, dt * 1.5);
    const flutter = (w.gust || 0) * 0.15 + (w.turb || 0) * 0.1;
    const ang = segs.map((n, k) => {
      const droop = (1 - st.fill) * (0.27 + 0.07 * k) + Math.sin(st.t * (7 + k * 2.3) + k) * 0.04 * (0.3 + flutter) * st.fill;
      const v = Math.max(-0.06, Math.min(1, droop));
      vis.setPart(n, v * DROOP_SIGN); // hinge nodes still posed (anchors, tests); the cloth below follows them smoothly
      return v * SOCK_DROOP_RAD;
    });
    if (st.cloth === undefined) st.cloth = attachSockCloth(vis);
    st.cloth?.update(ang, st.fill, st.t);
  };
}
/** sock_bend parts open toward limits_deg[0] (-80°), which lifts the sock in three.js space: droop = the negative side. */
const DROOP_SIGN = -1;
/** Hinge angle (rad, + = down) for droop 1: the part opens by |limits_deg[0]| = 80° (vehicle-library setPartValue). */
const SOCK_DROOP_RAD = (80 * Math.PI) / 180;

const CLOTH_MATS = new WeakMap();
/**
 * The library's sock material without its baked AO atlas (sampled through uv1, which the procedural cloth has no
 * layout for: the shade side would read the atlas' black corner). One copy per source material, shared by all socks.
 */
function clothMaterial(src, fallback) {
  if (!src) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.7, side: THREE.DoubleSide, vertexColors: true });
  let m = CLOTH_MATS.get(src);
  if (!m) {
    m = src.clone(); m.aoMap = null; m.side = THREE.DoubleSide; m.name = `${src.name}:cloth`;
    m.userData.shared = true; // cached across missions with its source: never disposed with one windsock
    CLOTH_MATS.set(src, m);
  }
  return m;
}

/**
 * Replace the four rigid sock segments of every LOD with one continuous cloth tube (art/windsock-sock.js), parented to
 * each LOD's sock_yaw node at the throat (sock_seg1's rest position). Returns null when the model has no sock.
 */
function attachSockCloth(vis) {
  const yaws = [], mats = {};
  vis.object3d.traverse((o) => { if (o.name === 'sock_yaw') yaws.push(o); });
  const seg1s = yaws.map((y) => y.getObjectByName('sock_seg1')).filter(Boolean);
  if (!seg1s.length) return null;
  for (const seg of seg1s) seg.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (/red/i.test(m.name) && !mats.red) mats.red = m;
      if (/white/i.test(m.name) && !mats.white) mats.white = m;
    }
    o.visible = false;
  });
  const red = clothMaterial(mats.red, 0x8a1a10), white = clothMaterial(mats.white, 0xc8c4b8);
  const sock = createWindsockSock(red, white);
  yaws.forEach((y, k) => {
    const seg = y.getObjectByName('sock_seg1');
    const m = k === 0 ? sock.mesh : new THREE.Mesh(sock.geometry, sock.mesh.material);
    m.name = 'sock_cloth'; m.castShadow = true; m.receiveShadow = true;
    m.position.copy(seg.position); // rotational part: its position stays the rest one
    y.add(m);
  });
  return sock;
}
