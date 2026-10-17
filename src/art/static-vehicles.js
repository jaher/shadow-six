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
import { iceFloe } from './kit-props.js';

/**
 * Structure type (+ variant hint) → library asset / type, or null (keep the placeholder, logged).
 * A structure of any other type opts in with `vehicleArt: '<library asset>'` (e.g. a parked lorry kept as decor/cover).
 */
export function staticVehicleAsset(type, variant = '', def = null) {
  if (def?.vehicleArt) return def.vehicleArt;
  const v = String(variant || '').toLowerCase();
  switch (type) {
    case 'train_car':
      if (/boat|cradle/.test(v)) return 'fishing_boat'; // M13 launch on its slipway cradle (placeholder-art pass)
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
/** Is this structure drawn with a library vehicle? (a static type, or an explicit `vehicleArt` opt-in) */
const isStaticVehicle = (type, def) => STATIC_TYPES.has(type) || !!def?.vehicleArt;

/** Library assets the mission's static structures need (for the preload). */
export function staticVehicleAssets(def) {
  const out = new Set();
  for (const s of def?.structures || []) {
    if (!isStaticVehicle(s?.type, s)) continue;
    const a = staticVehicleAsset(s.type, s.variant, s);
    if (a) out.add(a);
  }
  return [...out].sort();
}

/** Placement of a library model on a structure footprint: scale (≤ 1); `k` = how far past the footprint it may reach
 *  (`vehicleArtFit: 1`: exactly onto it — M7's cutters moored between jetty decks the grid does not block). */
export function fitOnFootprint(model, fp, k = 1.1) {
  const [L, W] = model, [fl, fw] = fp;
  if (!(fl > 0) || !(fw > 0)) return 1;
  if (k >= 1.1 && L <= fl * 1.15 && W <= fw * 1.15) return 1; // the default fit lets a model overhang by 15 %
  return Math.max(0.6, Math.min(1, (fl * k) / L, (fw * k) / W));
}

/** Static gun variants with a procedural kit model (art/field-guns.js, placed by scripts/m20-art.js). */
export const FIELD_GUN_VARIANTS = new Set(['flak38_quad_towed', 'flak38_quad_round_emplacement', 'towed_field_gun']);

/**
 * Swap the placeholder meshes of every static vehicle structure for the library model.
 * @param {object} world (world.structures: Map id → {type, def, object3d}; world.wind for windsocks)
 * @param {object} def mission definition (theater)
 * @returns {object[]} dressed structures [{id, asset, scale, vis, ready}] (`ready`: settles once the model is in place)
 */
export function dressStaticVehicles(world, def) {
  const out = [];
  if (!vehicleArtReady() || !vehicleLibraryReady() || !world?.structures) return out;
  const theater = vehicleArtContext().theater;
  for (const [id, s] of world.structures) {
    if (!isStaticVehicle(s.type, s.def) || !s.object3d) continue;
    const asset = staticVehicleAsset(s.type, s.def?.variant, s.def);
    if (!asset || !resolveVehicle(asset)) {
      // the field guns the library lacks are drawn by art/field-guns.js (M20's art pass, the only mission using them)
      const kit = FIELD_GUN_VARIANTS.has(s.def?.variant);
      noteVehicleArt(`${id} (${s.type}${s.def?.variant ? ' ' + s.def.variant : ''}): ${kit ? 'kit model (art/field-guns.js)' : 'no library model (placeholder)'}`);
      continue;
    }
    const vis = createVehicleVisual(asset, { theater, seed: id.length * 31 + (s.def?.x | 0), paint: s.def?.paint, destroyed: !!s.def?.wreck });
    if (!vis) continue;
    const holder = new THREE.Group(); holder.name = `static-vehicle:${asset}`;
    holder.rotation.y = Math.PI / 2; // structure local +X = its heading; the library model faces +Z
    // `vehicleArtY` (m): the model sits that much higher / lower (M7: a U-boat trimmed down to the walk deck at the
    // pier's level, a faering hauled up on the beach resting on its keel)
    if (Number.isFinite(s.def?.vehicleArtY)) holder.position.y = s.def.vehicleArtY;
    // `vehicleArtX` (m): slid along the structure heading (M7: each U-boat's tower over its gameplay tower block)
    if (Number.isFinite(s.def?.vehicleArtX)) holder.position.x = s.def.vehicleArtX;
    // an 'overturned' wreck (e.g. M15's car_wreck_overturned) lies on its roof: rolled 180 deg about its long axis
    const flip = /overturned/.test(String(s.def?.variant || '')) ? new THREE.Group() : null;
    // a sunken wreck (M4's tank in the inlet, art pass): `sink` m down, `list` / `trim` degrees of roll / pitch, on an
    // ice crust (`ice`: the walkable platform round it, drawn as rafted pack ice at the deck level)
    const sunk = !flip && (s.def?.sink || s.def?.list || s.def?.trim) ? new THREE.Group() : null;
    if (sunk) {
      sunk.name = 'sunken'; sunk.position.y = -(s.def.sink || 0);
      // `artShift` [along, across] m: the hull sits off-centre on its platform (M4: clear of the cliff foot)
      if (s.def.artShift) sunk.position.add(new THREE.Vector3(-(s.def.artShift[1] || 0), 0, s.def.artShift[0] || 0));
      sunk.rotation.set(((s.def.trim || 0) * Math.PI) / 180, 0, ((s.def.list || 0) * Math.PI) / 180);
      sunk.add(vis.object3d); holder.add(sunk);
      if (s.def.ice) s.object3d.add(iceCrust(s.def));
    } else if (flip) { flip.name = 'overturned'; flip.rotation.z = Math.PI; flip.add(vis.object3d); holder.add(flip); } else holder.add(vis.object3d);
    const rec = { id, asset, scale: 1, vis };
    // (`ready`: the model in, fitted, the placeholder hidden — what Game.loadMission awaits before the body solids are
    // measured on the drawn model: map-builder restampBodySolidsG)
    rec.ready = vis.ready.then(() => {
      const md = vis.meta?.dims || {}, b = vis.meta?.bbox;
      const L = md.length ?? md.length_over_buffers_loco ?? (b ? b.max[2] - b.min[2] : 1);
      const W = md.width ?? md.span ?? md.beam ?? (b ? b.max[0] - b.min[0] : 1);
      const fp = [s.def?.w ?? L, s.def?.d ?? W];
      if (flip) { // (roof down on the ground: lift by the model's height, less a crushed 8 cm of roof)
        const top = b ? b.max[1] : new THREE.Box3().setFromObject(vis.object3d).max.y;
        flip.position.y = Math.max(0, top - 0.08);
      }
      // true scale when the overhang clears every other structure; else onto the footprint (windsocks never scale;
      // `vehicleArtFit` always fits it)
      const clear = asset === 'windsock' || (!s.def?.vehicleArtFit && overhangClear(world.grid, s.def, L, W));
      rec.scale = clear ? 1 : fitOnFootprint([L, W], fp, typeof s.def?.vehicleArtFit === 'number' ? s.def.vehicleArtFit : 1.1);
      if (rec.scale < 1) { holder.scale.setScalar(rec.scale); noteVehicleArt(`${id} (${asset}) ${L.toFixed(1)}×${W.toFixed(1)} m scaled ${rec.scale.toFixed(2)} onto its ${fp[0]}×${fp[1]} m footprint`); }
      for (const c of s.object3d.children) if (c !== holder) hideExceptKept(c);
      // `vehicleArtHide`: model parts left off a parked one (M7: the oars of a faering hauled up on the beach)
      for (const part of s.def?.vehicleArtHide || []) vis.showPart?.(part, false);
      markShared(vis.object3d);
      if (asset === 'windsock') addVehicleTicker(windsockTicker(vis, s.object3d));
    });
    s.object3d.add(holder);
    out.push(rec);
  }
  return out;
}

/** Rafted pack ice round a sunken wreck: a few overlapping jagged floes over the structure's w × d at `ice.y`. */
function iceCrust(d) {
  const g = new THREE.Group(); g.name = 'ice-crust'; g.userData.keepWithLibrary = true;
  const w = d.w ?? 4, dd = d.d ?? 4, y = d.ice?.y ?? 0.05, zmin = d.ice?.zmin ?? -Infinity;
  let seed = 7;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // rafted floes over the deck (the walkable platform), overlapping and leaning a little, snow-crusted
  for (const [cx, cz, s] of [[-0.25, 0.1, 0.62], [0.3, -0.2, 0.55], [0.05, 0.35, 0.5], [-0.3, -0.35, 0.45], [0.35, 0.3, 0.4], [0, -0.05, 0.4]]) {
    let fz = cz * dd * 0.6, rx = s * w * 0.4, rz = s * dd * 0.4;
    const lim = (r) => r * 1.12 + 0.1;                                       // polygon jitter + bevel; floes spin freely
    if (fz - lim(Math.max(rx, rz)) < zmin) {                                  // stay off the -z side's limit
      rx = rz = Math.max(0.35, (fz - zmin - 0.1) / 1.12); fz = Math.max(fz, zmin + lim(rx));
    }
    g.add(iceFloe(R, cx * w * 0.6, fz, rx, rz, y + 0.03 + R() * 0.04, 0.2 + R() * 0.06, { n: 10, tilt: 0.06 }));
  }
  // broken floes and brash ice round the rim, awash at the waterline
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + R() * 0.4, rx = w * (0.52 + R() * 0.12), rz = dd * (0.52 + R() * 0.12);
    if (Number.isFinite(zmin) && Math.sin(a) < -0.3) continue;               // none on a limited -z side (M4: the cliff foot)
    g.add(iceFloe(R, Math.cos(a) * rx, Math.sin(a) * rz, 0.25 + R() * 0.3, 0.2 + R() * 0.25, y - 0.04, 0.09, { n: 7, tilt: 0.3, tint: 0xd2e0e8 }));
  }
  return g;
}

/** Hide a placeholder subtree, sparing any `keepWithLibrary` part inside it (e.g. M7's torpedo stack on the hull). */
function hideExceptKept(o) {
  if (o.userData?.keepWithLibrary) return;
  let kept = false;
  o.traverse((d) => { if (d !== o && d.userData?.keepWithLibrary) kept = true; });
  if (!kept || o.isMesh) { o.visible = false; return; }
  for (const c of o.children) hideExceptKept(c);
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
