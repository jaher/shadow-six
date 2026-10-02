/**
 * Catalogue → building library bridge (ART integration 2). props.js `buildProp` asks this module for the realistic
 * GLB visuals of every catalogue type the library covers; GAMEPLAY footprints stay the catalogue/mission ones (the
 * visual is centred, rotated and scaled onto them, mismatches are logged in `buildingLog()`).
 *
 *   await prepareMissionArt(missionDef, { assets, quality });  // manifest + preload the mission's assets (browser only)
 *   const v = libraryVisual('barracks', params, ctx);            // null → keep the placeholder
 *
 * Variant choice: the mission's `variant` hint (VARIANT_HINTS) → candidate assets, theater-filtered, ranked by how well
 * their main footprint fits `w × d`, then a pick seeded by hash(mission id, structure id) → deterministic per mission.
 * @module art/building-props
 */

import * as THREE from 'three';
import { loadBuildingLibrary, preloadBuildings, createBuilding, buildingMeta, setBuildingZoom, expandBuildingNames } from './building-library.js';
import { makeFlag, dressFlags, tickFlags } from './flags.js';
import { B, T } from '../world/grid.js';
import { fuelTankAsset, isFuelStructure, FUEL_VARIANTS } from './fuel-tanks.js';
import { pipeRunPairs, buildPipeRun } from './fuel-pipes.js';
import { attachFuelHooks, tickFuelHooks, resetFuelHooks } from './fuel-hooks.js';

/** Catalogue type → library type (same name unless listed). `null` = no library visual (placeholder). */
export const LIB_TYPE = { generator: null, telegraph_pole: null, radio_mast: null, sign: null, searchlight: null, lamp_post: null };

/**
 * Mission `variant` hints (design-spec §7.6 / building-inventory names) → preferred library assets.
 * `null` = the hint names something the library does not model yet → keep the placeholder.
 */
export const VARIANT_HINTS = {
  barracks: {
    timber_long: ['barracks_a', 'barracks_b', 'barracks_c'], log_garrison: ['barracks_b', 'barracks_c', 'barracks_a'],
    // M20 (Germany): German plank barrack huts; the range barracks is a Fachwerk house (Breisgau / Alsatian)
    hut_timber_barrack: ['hut_timber_barrack_a', 'hut_timber_barrack_b', 'hut_timber_barrack_c'],
    house_half_timber_turret: ['house_halftimber_d'],
  },
  hut: {
    sentry_box: ['guard_hut_b'], log_cabin: ['log_cabin_a', 'log_cabin_b'], relay_station: ['guard_hut_a', 'log_cabin_a'],
    guard_hut: ['guard_hut_a'], fishing_shed: ['fishing_shed_a', 'fishing_shed_b'], boathouse: ['naust_a', 'naust_b'],
    hut_timber_barrack: ['hut_timber_barrack_a', 'hut_timber_barrack_b', 'hut_timber_barrack_c', 'hut_timber_barrack_d'],
    open_shed_bench: null, // M20's range bench: drawn by its art module (the outhouses of M5 / M19 keep their library pick)
  },
  house: {
    timber_2storey: ['house_timber_a', 'house_timber_b', 'house_timber_c'], admin_brick: ['dam_house_a', 'dam_house_b', 'house_timber_c'],
    house_half_timber_steeple: ['house_halftimber_e'], house_half_timber_turret: ['house_halftimber_d'],
    // M20 castle masonry drawn by the mission's art module (missions/scripts/m20-art.js → art/castle-kit.js)
    castle_range_block: null, stair_tower: null, stair_block: null, chateau_wing: null, house_turret_small: null,
    chateau_hq: ['chateau_hq'], // the Neo-Gothic chateau HQ (tools/blender/military/scripts/chateau_hq.py)
  },
  bunker: { surveillance: ['bunker'], mg_nest: ['mg_nest'] },
  watchtower: { timber_mg: ['watchtower'], turret_round_crenellated: null, bartizan_round_decor: null, mg_platform: null }, // mg_platform: art/mg-platform.js (procedural)
  hangar: { shed: ['barn_b', 'barn_a'] },
  ruins: { rubble: null, wall_ruin: null },
  bridge: { bridge_timber_moat: null, bridge_timber_moat_lanterns: null },
  dam: { concrete_arch: ['dam_arch'] },
  gate: { barrier_boom: null, chainlink: null },
  fueltank: {}, // the fuel-tank family resolves its own variants (art/fuel-tanks.js)
  tent: {}, well: {},
  // Atlantic Wall (M14 art pass; reusable by M6/M7/M8/M10/M11/M15): the fit ranks the sizes, so one hint list
  // serves the small H612-type and the wide H679-type casemate
  casemate_gun: {
    casemate_embrasure: ['casemate_h612', 'casemate_h679'], gun_turret_block: ['gun_turret_block'], gun_pit_open: ['gun_pit_open'],
  },
  flat_roof_house: { barracks_concrete_2st: ['barracks_concrete_2st'] },
  sea_wall: { at_wall_segment: ['at_wall_segment'] },
  sign: { buoy_red: ['buoy_red'], sign_minen: ['sign_minen'], sign_sperrgebiet: ['sign_sperrgebiet'] },
  crates: {
    beach_tetrahedron: ['beach_tetrahedron'], dragons_teeth: ['dragons_teeth'], czech_hedgehog: ['czech_hedgehog'],
  },
};
Object.assign(VARIANT_HINTS.barracks, { barracks_concrete_2st: ['barracks_concrete_1st', 'barracks_concrete_2st'] });
Object.assign(VARIANT_HINTS.hut, { shed_concrete: ['shed_concrete'] });
Object.assign(VARIANT_HINTS.house, { house_concrete_2st: ['house_coastal_normandy'] });
Object.assign(VARIANT_HINTS.bunker, { blockhouse_small: ['blockhouse_small'] });

/**
 * Placeholder-art pass (tools/audit/placeholder-audit.mjs): mission variants that drew as grey catalogue boxes and
 * whose real-world counterpart the library models at a fitting size. Their gameplay nav stays the mission's
 * (footprints, walk heights): the asset's own roofs / ladders / climb edges are not added (world/map-library.js
 * `navOverridden`). Flat-roofed walkable houses keep the kit visual (art/kit-buildings.js): a library house of
 * another height would put the roof walkers inside it.
 */
export const PLACEHOLDER_HINTS = {
  villa: { hq_villa_brick: ['villa_hq'], mansion_hq_mansard: ['villa_hq_b', 'villa_hq'], mansion_hq_mansard_wing: ['villa_hq', 'villa_hq_b'] },
  cable_car_station: { lower: ['cable_station_lower'], upper_blockhouse: ['cable_station_upper'] },
  watermill: { watermill: ['watermill_a', 'watermill_b'] },
  lock_gate: { lock_gates: ['lock_gates'] },
  control_shack: { guard_hut_a: ['guard_hut_a'] },
  truss_bridge: { truss_bridge_maas: ['bridge_truss_maas'] },
  radio_mast: { wurzburg_dish: ['radar_dish_a'] },
};
for (const [type, hints] of Object.entries(PLACEHOLDER_HINTS)) {
  VARIANT_HINTS[type] ??= {};
  for (const [v, list] of Object.entries(hints)) if (!Object.prototype.hasOwnProperty.call(VARIANT_HINTS[type], v)) VARIANT_HINTS[type][v] = list;
}
/** Did this structure get its library visual through the placeholder-art hints (nav stays the mission's)? */
export const placeholderHinted = (type, p = {}) => !p.asset && !!PLACEHOLDER_HINTS[type]?.[p.variant];

/**
 * Does the mission opt this structure into a library visual by name (an explicit `asset`, or a `variant` the hints
 * map to assets)? Extra (§7.7) props only switch to the library on such an opt-in (art/props-extra.js).
 */
export function libraryHinted(type, p = {}) {
  if (p.asset) return true;
  const h = VARIANT_HINTS[type];
  return !!(h && p.variant != null && Object.prototype.hasOwnProperty.call(h, p.variant) && h[p.variant]);
}

/** Footprint kinds that describe the structure's body (used to fit the visual onto the gameplay footprint). */
const MAIN_KINDS = new Set(['building', 'bunker', 'sentry_box', 'tower_leg', 'tent', 'curtain_wall', 'wall', 'wire_fence',
  'gatehouse', 'bridge_deck', 'turret', 'tower', 'well', 'tank', 'hut', 'pier', 'dolphin', 'abutment', 'gate_passage']);

const S = { ready: false, failed: false, mission: null, structures: [], log: [], live: new Set(), quality: 'default' };

/** FNV-1a string hash → [0, 1). */
export function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 1000003) / 1000003;
}

/** Is the library loaded (manifest in memory)? Node / unit tests: never. */
export const libraryReady = () => S.ready;
/** Fit/variant log of the current mission (strings). */
export const buildingLog = () => S.log.slice();

/** Local extents of an asset's body: {w, d, cx, cz} in sidecar coords (x east, z south). */
export function assetExtents(name, deck = false) {
  const a = buildingMeta(name);
  if (!a) return null;
  if (deck === 'bridge' && a.bridge?.deck?.length >= 3) { // bridges / dams / piers: fit the walkable deck
    const xs = a.bridge.deck.map((q) => q[0]), zs = a.bridge.deck.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }
  if (deck && a.walkableRoofs?.length) { // raised deck structures (watchtowers): fit the deck, legs may splay out
    const pts = a.walkableRoofs.flatMap((r) => r.points);
    const xs = pts.map((q) => q[0]), zs = pts.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, deckY: Math.max(...a.walkableRoofs.map((r) => r.elev)) };
  }
  let fps = a.footprints.filter((f) => MAIN_KINDS.has(f.kind));
  if (!fps.length) fps = a.footprints;
  let pts = fps.flatMap((f) => f.points || []);
  if (a.bridge?.deck && !pts.length) pts = a.bridge.deck;
  if (!pts.length) pts = [[a.bbox.min[0], a.bbox.min[2]], [a.bbox.max[0], a.bbox.max[2]]];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { w: Math.max(0.2, x1 - x0), d: Math.max(0.2, z1 - z0), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

/** Does asset `name` suit the theater (its own tags, or a snow variant for snow maps)? */
function suits(name, theater) {
  const a = buildingMeta(name);
  if (!a || a.destroyed || a.snow) return false;
  if (!theater) return true;
  const th = theater === 'night' ? 'temperate' : theater;
  return a.theaters.includes(theater) || a.theaters.includes(th) || (theater === 'snow' && (!!a.snowVariant || a.theaters.includes('temperate')));
}

/** Catalogue type for the library (or null). */
export function libTypeOf(type) {
  if (!S.ready || S.disabled) return null;
  if (Object.prototype.hasOwnProperty.call(LIB_TYPE, type)) return LIB_TYPE[type];
  return S.manifest.types[type] ? type : null;
}

/**
 * Choose the library asset for a structure.
 * @param {string} type catalogue type
 * @param {object} p structure params ({id, variant, w, d, r, x, z, asset?})
 * @param {{theater?: string, missionId?: string}} [ctx]
 * @returns {{name: string, turn: number, ext: object, fit: number}|null} turn = extra 90° turns (0 | 1)
 */
export function pickAsset(type, p = {}, ctx = {}) {
  if (!S.ready || S.disabled) return null;
  const M = S.manifest, theater = ctx.theater;
  let cands;
  const fuel = !p.asset && isFuelStructure({ ...p, type }) ? fuelTankAsset({ ...p, type }, { theater, structures: ctx.structures ?? S.structures, has: (n) => !!M.assets[n] }) : null;
  if (p.asset && M.assets[p.asset]) cands = [p.asset];                      // explicit asset name (mission override)
  else if (fuel) cands = [fuel];                                            // fuel-tank family (docs/fuel-tanks.md)
  else if (isFuelStructure({ ...p, type }) && FUEL_VARIANTS.includes(p.variant)) return null; // modelled family, asset not shipped
  else {
    const lt = libTypeOf(type);
    const hints = VARIANT_HINTS[type];
    const hinted = hints && p.variant != null && Object.prototype.hasOwnProperty.call(hints, p.variant);
    if (!lt && !(hinted && hints[p.variant])) return null; // catalogue types the library lacks: hinted variants only
    if (hinted) {
      if (hints[p.variant] === null) return null;
      cands = hints[p.variant].filter((n) => M.assets[n]);
      const th = cands.filter((n) => suits(n, theater));
      if (th.length) cands = th;
    } else if (typeof p.variant === 'string' && M.assets[p.variant]) cands = [p.variant];
    else cands = M.types[lt].variants.filter((n) => suits(n, theater));
  }
  if (!cands.length) return null;
  const w = p.w ?? (p.r != null ? p.r * 2 : null), d = p.d ?? (p.r != null ? p.r * 2 : null);
  const deckFit = /^(bridge|dam|pier|rail_bridge|truss_bridge|mobile_bridge)$/.test(type) ? 'bridge' : p.deckY != null || type === 'watchtower';
  const scored = cands.map((name) => scoreOf(name, w, d, deckFit, theater));
  let best = Math.min(...scored.map((s) => s.fit));
  // size fallback: no candidate within ±25 % per axis → a related, better-sized building of the same function
  const alts = !p.asset && w && d && Math.min(...scored.map((s) => s.err)) > FIT_OK ? (SIZE_ALTS[type] || []).filter((n) => M.assets[n] && !cands.includes(n) && suits(n, theater)) : [];
  if (alts.length) {
    const more = alts.map((name) => scoreOf(name, w, d, deckFit, theater)).filter((s) => s.fit + 0.12 < best);
    if (more.length) {   // the badly-sized hinted assets leave the pool
      const keep = scored.filter((s) => s.err <= FIT_OK);
      scored.length = 0; scored.push(...keep, ...more);
      best = Math.min(...scored.map((s) => s.fit));
    }
  }
  const pool = scored.filter((s) => s.fit <= best + 0.18);
  const key = `${ctx.missionId ?? S.mission ?? ''}|${p.id ?? `${type}@${p.x ?? 0},${p.z ?? 0}`}`;
  return pool[Math.floor(hash01(key) * pool.length)];
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Fit score of an asset on a w × d footprint: |ln| scale error summed over both axes (+ snow penalty). */
function scoreOf(name, w, d, deckFit, theater) {
  const ext = assetExtents(name, deckFit);
  let fit = 0, turn = 0;
  if (w && d) {
    const a = Math.abs(Math.log(w / ext.w)) + Math.abs(Math.log(d / ext.d));
    const b = Math.abs(Math.log(w / ext.d)) + Math.abs(Math.log(d / ext.w));
    // only turn when the aspect clearly asks for it (turning moves the doors to another face)
    if (b + 0.25 < a) { fit = b; turn = 1; } else fit = a;
  }
  const err = fit;
  if (theater === 'snow' && !buildingMeta(name).snowVariant) fit += 0.3; // prefer assets with a real snow version
  return { name, turn, ext, fit, err };
}

/** Summed |ln scale| above which the size fallback looks at related buildings (~ one axis off by 40 %). */
const FIT_OK = 0.33;
/**
 * Related buildings of the same function tried when no hinted asset is near the footprint's size (review: an 8 × 6 m
 * "timber barracks" squeezed a 12 m barracks to 0.67 × and its doors to 1.7 m).
 */
export const SIZE_ALTS = {
  barracks: ['log_cabin_b', 'house_timber_b', 'house_timber_a'],
  hut: ['log_cabin_a', 'log_cabin_b', 'guard_hut_a'],
  house: ['log_cabin_b', 'house_halftimber_b', 'house_timber_b'],
  hangar: ['barn_b', 'barn_a', 'station_rail_goods'],
};

/**
 * Real-world scale rules for a fitted building (review: soldiers are 1.8 m, doors must stay door-sized and windows
 * square): one near-uniform plan scale u (per-axis deviation ≤ 12 %, u within 0.72–1.4), height follows u but never
 * shrinks a door under 1.9 m (or its native height when lower) and never grows one past +15 %. Where the footprint is
 * further off, the visual overhangs / falls short of it slightly instead of distorting.
 * @returns {{sx: number, sy: number, sz: number}}
 */
export function fitScale(rawX, rawZ, maxDoorH = 0) {
  const u = clamp(Math.sqrt(rawX * rawZ), 0.72, 1.4);
  const sx = clamp(clamp(rawX, u / 1.12, u * 1.12), 0.72, 1.4), sz = clamp(clamp(rawZ, u / 1.12, u * 1.12), 0.72, 1.4);
  const lo = maxDoorH > 0 ? clamp(1.9 / maxDoorH, 0.85, 1) : 0.8;
  const sy = clamp(Math.sqrt(sx * sz), lo, maxDoorH > 0 ? 1.15 : 1.25);
  return { sx, sy, sz };
}

/**
 * Realistic visual for a catalogue structure, fitted onto its gameplay footprint.
 * @param {string} type catalogue type
 * @param {object} p structure params (x, z, rot, id, variant, w, d, r, flag, destructible, asset)
 * @param {{theater?: string, missionId?: string}} [ctx]
 * @returns {null|{object3d: THREE.Group, asset: string, scale: number[], doors: object[], ladders: object[],
 *   roofs: object[], climbEdges: object[], anchors: object[], bridge: object|null, piers: object[], ready: Promise<void>,
 *   setDoorOpen: (id: string, t: number) => void, dispose: () => void}}
 */
export function libraryVisual(type, p = {}, ctx = {}) {
  const pick = pickAsset(type, p, ctx);
  if (!pick) return null;
  const theater = ctx.theater;
  // `artOffset: [dx, dz]` (m): the model only, nudged off a neighbour it would clip (the gameplay footprint stays)
  const x = (p.x ?? 0) + (p.artOffset?.[0] ?? 0), z = (p.z ?? 0) + (p.artOffset?.[1] ?? 0), rot = p.rot ?? 0;
  const b = createBuilding(pick.name, { x: 0, z: 0, rot: 0, id: p.id, theater, destroyed: !!p.destroyed });
  if (!b) return null;
  const outer = new THREE.Group();
  outer.name = `prop:${type}${p.id ? ':' + p.id : ''}`;
  // `elev`: the visual stands that high (m) — a dam whose crest is a raised deck (M3: the downstream face shows)
  outer.position.set(x, p.elev ?? 0, z);
  outer.rotation.y = -rot;
  const fit = new THREE.Group(); fit.name = 'fit';
  const turnG = new THREE.Group(); turnG.rotation.y = -pick.turn * Math.PI / 2;
  const { ext } = pick;
  const ew = pick.turn ? ext.d : ext.w, ed = pick.turn ? ext.w : ext.d;
  const w = p.w ?? (p.r != null ? p.r * 2 : null), d = p.d ?? (p.r != null ? p.r * 2 : null);
  const rawX = w ? w / ew : 1, rawZ = d ? d / ed : 1;
  // raised decks (watchtowers) match the gameplay deck height (units stand at deckY); bridges/dams keep the plain
  // footprint fit (their spans must meet the banks); buildings follow the real-world scale rules (fitScale)
  const deckY = p.deckY ?? (type === 'watchtower' ? p.h : null);
  const doorsH = (buildingMeta(pick.name)?.doors || []).filter((dd) => dd.kind !== 'gate' && dd.height < 3.2).map((dd) => dd.height);
  const spanFit = /^(bridge|dam|pier|rail_bridge|truss_bridge|mobile_bridge|wall|fence|gate|castle_wall|moat|lock_gate|water_gate)$/.test(type);
  let sx, sy, sz;
  if (spanFit || (ext.deckY && deckY)) {
    sx = clamp(rawX, 0.55, 1.8); sz = clamp(rawZ, 0.55, 1.8);
    sy = ext.deckY && deckY ? clamp(deckY / ext.deckY, 0.7, 1.4) : clamp(Math.sqrt(sx * sz), 0.8, 1.25);
  } else ({ sx, sy, sz } = fitScale(rawX, rawZ, doorsH.length ? Math.max(...doorsH) : 0));
  fit.scale.set(sx, sy, sz);
  b.object3d.position.set(-ext.cx, 0, -ext.cz);
  outer.add(fit); fit.add(turnG); turnG.add(b.object3d);
  if (w && d && (rawX < 0.8 || rawX > 1.25 || rawZ < 0.8 || rawZ > 1.25)) {
    S.log.push(`fit ${p.id ?? type}: ${b.asset} ${ew.toFixed(1)}×${ed.toFixed(1)} m → ${w}×${d} m (scale ${rawX.toFixed(2)}×${rawZ.toFixed(2)}${rawX !== sx || rawZ !== sz ? ', clamped' : ''})`);
  }
  outer.updateMatrixWorld(true);
  const M = b.object3d.matrixWorld.clone();
  const v = new THREE.Vector3();
  const pt = (q) => { v.set(q[0], 0, q[1]).applyMatrix4(M); return [v.x, v.z]; };
  const p3 = (q) => { v.set(q[0], q[1], q[2]).applyMatrix4(M); return { x: v.x, y: v.y, z: v.z }; };
  const hd = (h) => { v.set(Math.cos(h ?? 0), 0, Math.sin(h ?? 0)).transformDirection(M); return Math.atan2(v.z, v.x); };
  const a = b.meta;
  const doors = a.doors.map((dd) => ({ id: dd.id, kind: dd.kind, node: dd.node, heading: hd(dd.heading), width: dd.width * sx, height: dd.height * sy,
    ...p3(dd.pos), approach: dd.approach ? (([ax, az]) => ({ x: ax, z: az }))(pt(dd.approach)) : null }));
  const ladders = a.ladders.map((l) => ({ a: pt(l.a), b: pt(l.b), y: l.y * sy }));
  const roofs = a.roofs.map((r) => ({ ...r, points: r.points.map(pt), elev: (r.elev ?? 0) * sy }));
  const climbEdges = a.climbEdges.map((c) => ({ ...c, a: pt(c.a), b: pt(c.b), y: c.y != null ? c.y * sy : c.y, top: c.top != null ? c.top * sy : c.top }));
  const anchors = a.anchors.map((an) => ({ ...an, pos: p3(an.pos), heading: hd(an.heading) }));
  const bridge = a.bridge ? { ...a.bridge, deck: a.bridge.deck ? a.bridge.deck.map(pt) : null, crest: a.bridge.crest_poly ? a.bridge.crest_poly.map(pt) : null } : null;
  const piers = a.footprints.filter((f) => /^(pier|bent|dolphin|gate_pier)$/.test(f.kind)).map((f) => {
    const q = f.points.map(pt), cx = q.reduce((s, e) => s + e[0], 0) / q.length, cz = q.reduce((s, e) => s + e[1], 0) / q.length;
    return { x: cx, z: cz, r: Math.max(0.3, Math.max(...q.map((e) => Math.hypot(e[0] - cx, e[1] - cz))) * 0.8), points: q };
  });
  // sidecar footprints in world coords (props.js format) — used for types outside the catalogue only
  const footprints = a.footprints.map((f) => {
    const fp = { shape: 'poly', points: f.points.map(pt), kind: f.kind };
    if (/^water/.test(f.kind)) fp.terrain = T.WATER;
    else if (/^(bridge_deck|drawbridge|quay|footboard|landing)$/.test(f.kind)) fp.bridge = 1;
    else fp.block = B[f.block] ?? B.NONE;
    return fp;
  });
  const state = { b, disposed: false };
  const flags = dressFlags(b.object3d, b.asset, { flag: !!p.flag, theater });
  if (p.flag && !flags.length) {
    // garrison marker (§ barracks flags) on an asset without its own pole: a pole at the east gable
    const pole = makeFlag({ pole: true, h: 6.5, theater });
    pole.position.set(ew / 2 + 1.8, 0, ed / 2 + 0.4); // SE corner: faces the camera
    pole.scale.set(1 / sx, 1 / sy, 1 / sz);
    fit.add(pole);
  }
  let dressDam = null;
  if (type === 'dam') {
    // the mission's own cliffs/terrain make the gorge: the asset's rock walls and rim crags would float on flat ground
    // …and the snow draped over those crags goes with them (else it floats as sheets over the gorge)
    // …and (raised dam, `elev`: the drape pieces float in the air) every snow triangle not lying on the concrete
    dressDam = (bb) => {
      const hideRock = () => {
        bb.object3d.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => /rock_cliff|scree/.test(m.name))) o.visible = false; });
        stripDrape(bb.object3d, /rock_cliff|scree/, /snow/);
        if (p.elev > 0) keepDrapeOnHosts(bb.object3d, /snow/, /rock_cliff|scree|decal|glass/);
      };
      hideRock();
      const prev = bb.object3d.userData.onLodAttached;
      bb.object3d.userData.onLodAttached = (...args) => { prev?.(...args); hideRock(); };
    };
    dressDam(b);
  }
  if (/^oil_tank_column/.test(b.asset)) {
    // M11: the pale pipe run with red flanges and valves to the neighbouring column(s) (art/fuel-pipes.js)
    const same = (q) => q === p || (q.id != null && q.id === p.id && q.x === p.x && q.z === p.z);
    outer.updateMatrixWorld(true);
    const inv = outer.matrixWorld.clone().invert();
    for (const run of pipeRunPairs(ctx.structures ?? S.structures)) {
      if (!same(run.owner)) continue;
      const g = buildPipeRun(run);
      g.applyMatrix4(inv);
      outer.add(g);
    }
  }
  outer.userData.libraryAsset = b.asset;
  attachFuelHooks(outer, b, p, anchors);
  outer.userData.setDoorOpen = (id, t) => state.b.setDoorOpen(id, t);
  // explosiveTarget destroyed → swap to the modelled destroyed variant when there is one (else the caller burns it)
  outer.userData.destroy = () => {
    // a snow variant without its own ruin (dam_arch_snow) falls back on its base asset's (dam_arch_destroyed)
    const base = type === 'dam' ? buildingMeta(b.asset)?.base : null;
    const dn = a.destroyedVariant ?? (base ? buildingMeta(base)?.destroyedVariant : null);
    if (!dn || !buildingMeta(dn)) return false;
    const nb = createBuilding(dn, { x: 0, z: 0, rot: 0, id: p.id, theater });
    if (!nb) return false;
    nb.object3d.position.copy(state.b.object3d.position);
    state.b.dispose();
    turnG.add(nb.object3d);
    S.live.delete(state.b); S.live.add(nb);
    state.b = nb;
    outer.userData.libraryAsset = nb.asset;
    dressFlags(nb.object3d, nb.asset, { flag: false });
    dressDam?.(nb);
    return true;
  };
  S.live.add(b);
  const dispose = () => { if (state.disposed) return; state.disposed = true; state.b.dispose(); S.live.delete(state.b); outer.removeFromParent(); };
  return { object3d: outer, asset: b.asset, scale: [sx, sy, sz], matrix: M, footprints, doors, ladders, roofs, climbEdges, anchors, bridge, piers,
    ready: b.ready, setDoorOpen: outer.userData.setDoorOpen, dispose };
}

/**
 * Remove the triangles of `drape` meshes (snow cover) lying on hidden `host` meshes (crags) of the same LOD: a drape
 * triangle whose three vertices are within 0.35 m of a host vertex is dropped (geometry cloned, never shared).
 */
export function stripDrape(root, hostRe, drapeRe, tol = 0.35) {
  const lods = [];
  root.traverse((n) => { if (/^lod\d$/.test(n.name)) lods.push(n); });
  if (!lods.length) lods.push(root);
  const matOf = (o, re) => [].concat(o.material).some((m) => re.test(m?.name || ''));
  const v = new THREE.Vector3();
  for (const lod of lods) {
    const hosts = [], drapes = [];
    lod.traverse((o) => { if (o.isMesh && !o.userData.drapeStripped) { if (matOf(o, hostRe)) hosts.push(o); else if (matOf(o, drapeRe)) drapes.push(o); } });
    if (!hosts.length || !drapes.length) continue;
    lod.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert();
    const cell = new Set(), key = (x, y, z) => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
    for (const h of hosts) {
      const pos = h.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, h.matrixWorld);
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); cell.add(key(v.x, v.y, v.z)); }
    }
    const near = (x, y, z) => { const i = Math.round(x / tol), j = Math.round(y / tol), k = Math.round(z / tol);
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let e = -1; e <= 1; e++) if (cell.has(`${i + a},${j + c},${k + e}`)) return true; return false; };
    for (const d of drapes) {
      const g = d.geometry, pos = g.attributes.position, idx = g.index, m = new THREE.Matrix4().multiplyMatrices(inv, d.matrixWorld);
      const count = idx ? idx.count : pos.count, keep = [];
      const onHost = (i) => { v.fromBufferAttribute(pos, i).applyMatrix4(m); return near(v.x, v.y, v.z); };
      for (let t = 0; t + 2 < count; t += 3) {
        const a = idx ? idx.getX(t) : t, b2 = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
        if (!(onHost(a) && onHost(b2) && onHost(c))) keep.push(a, b2, c);
      }
      if (keep.length === count) continue;
      const ng = g.clone();
      ng.setIndex(keep);
      d.geometry = ng; d.userData.drapeStripped = true;
      if (!keep.length) d.visible = false;
    }
  }
}

/**
 * Keep only the `drape` triangles (snow cover) that lie on a visible host mesh of the same LOD: a triangle is dropped
 * unless the top of some host triangle within one `cell` (plan) lies between `dy` m under and 0.6 m over its centroid
 * (geometry cloned).
 */
export function keepDrapeOnHosts(root, drapeRe, skipRe, cell = 0.5, dy = 0.8) {
  const lods = [];
  root.traverse((n) => { if (/^lod\d$/.test(n.name)) lods.push(n); });
  if (!lods.length) lods.push(root);
  const matOf = (o, re) => [].concat(o.material).some((m) => re.test(m?.name || ''));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const lod of lods) {
    const hosts = [], drapes = [];
    lod.traverse((o) => { if (o.isMesh && !o.userData.drapeKept) { if (matOf(o, drapeRe)) drapes.push(o); else if (o.visible && !matOf(o, skipRe)) hosts.push(o); } });
    if (!hosts.length || !drapes.length) continue;
    lod.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert(), top = new Map();
    const tri = (g, m, t, idx) => { const pos = g.attributes.position;
      for (const [v, k] of [[a, 0], [b, 1], [c, 2]]) v.fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(m); };
    for (const h of hosts) {
      const g = h.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count, m = new THREE.Matrix4().multiplyMatrices(inv, h.matrixWorld);
      for (let t = 0; t + 2 < n; t += 3) {
        tri(g, m, t, idx);
        const y = Math.max(a.y, b.y, c.y);
        for (let i = Math.floor(Math.min(a.x, b.x, c.x) / cell); i <= Math.floor(Math.max(a.x, b.x, c.x) / cell); i++)
          for (let j = Math.floor(Math.min(a.z, b.z, c.z) / cell); j <= Math.floor(Math.max(a.z, b.z, c.z) / cell); j++) {
            const k = `${i},${j}`, l = top.get(k); if (l) l.push(y); else top.set(k, [y]);
          }
      }
    }
    for (const d of drapes) {
      const g = d.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count, m = new THREE.Matrix4().multiplyMatrices(inv, d.matrixWorld), keep = [];
      for (let t = 0; t + 2 < n; t += 3) {
        tri(g, m, t, idx);
        const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3, i0 = Math.floor(x / cell), j0 = Math.floor(z / cell);
        let ok = false;
        for (let i = i0 - 1; i <= i0 + 1 && !ok; i++) for (let j = j0 - 1; j <= j0 + 1 && !ok; j++) { const l = top.get(`${i},${j}`); if (l && l.some((h) => h >= y - dy && h <= y + 0.6)) ok = true; }
        if (ok) keep.push(idx ? idx.getX(t) : t, idx ? idx.getX(t + 1) : t + 1, idx ? idx.getX(t + 2) : t + 2);
      }
      d.userData.drapeKept = true;
      if (keep.length === n) continue;
      const ng = g.clone(); ng.setIndex(keep); d.geometry = ng;
      if (!keep.length) d.visible = false;
    }
  }
}

/**
 * Load the library manifest and preload every asset the mission's structures resolve to (browser only).
 * Safe to call repeatedly; resolves false when the library is unavailable (node, fetch failure) → placeholders.
 * @param {object} mission normalized mission def
 * @param {{assets?: object, quality?: string, timeoutMs?: number}} [o]
 */
export async function prepareMissionArt(mission, o = {}) {
  S.mission = mission?.id ?? null;
  S.structures = mission?.structures || [];
  S.log = [];
  if (typeof fetch !== 'function' || typeof document === 'undefined' || S.failed) return false;
  // ?buildings=0 → placeholder boxes (A/B perf checks, fallback on weak machines)
  S.disabled = o.enabled === false || /[?&]buildings=0\b/.test(globalThis.location?.search || '');
  if (S.disabled) return false;
  try {
    if (!S.ready) {
      const lib = await loadBuildingLibrary(o.assets ?? null, { quality: o.quality ?? 'default' });
      S.manifest = lib.manifest; S.ready = true;
    }
  } catch (e) {
    console.warn('[building-props] library unavailable, keeping placeholders:', e?.message || e);
    S.failed = true;
    return false;
  }
  const theater = mission?.theater || 'temperate', names = new Set();
  for (const s of mission?.structures || []) {
    const pk = pickAsset(s.type, s, { theater, missionId: S.mission });
    if (!pk) continue;
    const a = buildingMeta(pk.name);
    names.add(theater === 'snow' && a.snowVariant ? a.snowVariant : pk.name); // the variant createBuilding will use
  }
  const t0 = performance.now();
  const job = preloadBuildings([...names], { theater }); // + their destroyed variants
  await Promise.race([job, new Promise((ok) => setTimeout(ok, o.timeoutMs ?? 25000))]);
  let bytes = 0;
  for (const n of expandBuildingNames([...names], theater)) for (const l of buildingMeta(n).lods) bytes += l.bytes || 0;
  S.log.push(`preload ${names.size} assets (${(bytes / 1048576).toFixed(1)} MB GLB, all LODs) in ${Math.round(performance.now() - t0)} ms`);
  return true;
}

/** Use an already parsed manifest (node tests / tools): variant choice and fitting without loading any GLB. */
export async function useManifest(manifest, missionId = null, structures = []) {
  S.structures = structures;
  if (!manifest) { S.ready = false; S.manifest = null; return; } // back to placeholders
  const lib = await loadBuildingLibrary(null, { manifest });
  S.manifest = lib.manifest; S.ready = true; S.disabled = false; S.mission = missionId;
}

/** Per displayed frame: LOD by camera zoom (orthographic) + flag cloth animation. */
export function tickBuildings(dt, camera, wind = null) {
  if (camera && camera.zoom !== S.zoom) { S.zoom = camera.zoom; setBuildingZoom(camera.zoom); }
  tickFlags(dt, wind, camera);
  tickFuelHooks(dt);
}

/** Dispose every live library instance (mission unload). */
export function disposeMissionBuildings() {
  for (const b of S.live) b.dispose();
  S.live.clear();
  S.zoom = undefined;
  resetFuelHooks();
}
