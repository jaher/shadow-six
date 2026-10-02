/**
 * Vehicles, water craft, planes, trains/trams and fixed-gun emplacements — owned by VEHICLES
 * (docs/ARCHITECTURE.md "Vehicles & emplacements", design-spec §3.2, §3.6, §3.7, §4.2 OCLU, §7.7).
 *
 * - Registry: `VEHICLE_TYPES` (+ `registerVehicleType`) holds every BEL type (M1–M20, §7.7). Missions
 *   spawn by type name; the legacy names of the foundation (`tank`, `armoredcar`, `fuel_truck`, `car`,
 *   `plane`, `halftrack`) are aliases.
 * - Operators (§3.7): land → Driver (spawn `operators` overrides, e.g. the Spy in M16), water craft →
 *   Marine (`diver`), planes → McRae, fixed guns → Driver. Passengers fill the remaining seats (§3.2).
 * - Driving (§3.7): no pathfinding. `driveTo` turns in place (tank 45°/s, truck 60°/s) then drives a
 *   straight line at slow/fast speed and stops at the first blocking cell (checked every tick ahead of
 *   the nose, so other vehicles stop it too). `straightReach()` feeds the forbidden cursor.
 * - Run-over (§3.7 ATROPELLO): at fast speed anyone on foot in the front sensor box dies silently;
 *   at slow speed enemies step aside. Trains kill in their own box and stop for vehicles on the track.
 * - Damage (§3.7 .IMPACTOS, §3.6): bullets count hits vs the type's budget (tanks immune, tanker explodes
 *   from one), explosions per class (grenade / bomb / shell / vehicle / barrel). Wrecks burn 20 s then stay
 *   as B.HIGH obstacles.
 * - Tainted (§3.7, §4.3): an enemy who sees a commando board marks it; see ai/vehicle-ai.js.
 * - Enemy crews are lightweight records (`vehicle.crew`); the vehicle itself is the viewer (it carries a
 *   `vision` from its profile) and ai/vehicle-ai.js drives patrols / standby / firing.
 * @module entities/vehicle
 */

import { turretArc, clampTraverse, liftAt, ownerHeight } from '../world/placement.js';
import * as THREE from 'three';
import { Entity } from './entity.js';
import { CONFIG, KILL } from '../config.js';
import { createVehicleModel, VEHICLE_MODELS } from '../art/vehicles.js';
import { createLibraryVehicleModel, seatSide, vehicleArtContext } from '../art/vehicle-model.js';
import { createKitVehicleModel } from '../art/kit-vehicles.js';
import { createCrewFigures } from '../art/vehicle-crew.js';
import { angleTo, turnTowardsAngle, angleDiff } from '../core/math.js';
import { B, T } from '../world/grid.js';
import { hullRect, capsuleRectGap, bodyCapsule, isSolidHull, bodyShape, bodyGap } from '../world/body-clearance.js';
import { makeVision } from './enemy.js';
import { Projectile, explode, hitBarrel } from './projectile.js';
import { createVehicleBrain } from '../ai/vehicle-ai.js';
import { canSee as perceptionCanSee } from '../ai/perception.js';
import { inContact, ramGate, applyRamResponse, bumpGate } from '../world/breakables.js';

/** Minimum spacing (m) between units stepping out of a hull: per-seat exit offset / occupied-spot test. */
const EXIT_SPACING = 0.9;

const DEG = Math.PI / 180;

/**
 * Who may operate each vehicle kind by default (§3.7). Entries name a commando role, or a guest's
 * id (§3.5 guests are `role:'guest'` commandos identified by `guestId`/tag): McRae, the M10 guest,
 * is the only one who can fly the Ju 52.
 */
export const DEFAULT_OPERATORS = Object.freeze({
  land: ['driver'], boat: ['diver'], plane: ['mcrae'], emplacement: ['driver'], rail: [],
});

/** Does operator list `ops` name `unit` — by role, or (a §3.5 guest) by its guestId / tag? */
export function operatorMatches(ops, unit) {
  if (!unit || !ops) return false;
  if (ops.includes(unit.role)) return true;
  if (unit.role !== 'guest') return false;
  return (unit.guestId != null && ops.includes(unit.guestId)) || (unit.tag != null && ops.includes(unit.tag));
}

/**
 * Vehicle type registry. Fields:
 *  kind: 'land'|'boat'|'plane'|'emplacement'|'rail'; model: art/vehicles.js key (missing → local box);
 *  speed: CONFIG.vehicles speed key ({slow, fast, turn}); hits: bullets to destroy (null = n/a, 0 = immune);
 *  armor: 'none' | 'light' (grenades destroy) | 'heavy' (only bombs and shells); weapons: CONFIG.weapons keys
 *  (first = primary; 'torpedo' = mini-sub tubes); size: [length, width] m (run-over box, occluder, wreck; land vehicles
 *  match the library models' real dimensions — art/vehicle-model.js fits oversize boat / plane / gun visuals instead);
 *  occludes: stamps grid.dynamicBlock (§4.2 OCLU); runover: kills in the front box at fast speed;
 *  tanker: any hit explodes it (§3.6); raft: deflates instead of being destroyed by bullets (§4.3);
 *  fastOnly: single speed (motorcycle); vision: profile when crewed (tank / sdkfz); legacy aliases via `alias`;
 *  unmannable: no commando may ever man it (§3.4: the 210 mm mortar and the M20 anti-tank gun [guide]) — a
 *  mission can also set `unmannable: true` on any spawn.
 */
export const VEHICLE_TYPES = {
  // --- water craft (Marine) ---
  raft: { kind: 'boat', model: 'raft', speed: 'raft', hits: null, size: [2.6, 1.3], occludes: false, raft: true },
  rowboat: { kind: 'boat', model: 'raft', speed: 'boat', hits: 30, size: [3.6, 1.5], occludes: false },
  patrolboat: { kind: 'boat', model: 'patrolboat', speed: 'boat', hits: 60, size: [8, 2.6], occludes: true, weapons: ['mg'], vision: 'mg' },
  minisub: { kind: 'boat', model: 'raft', speed: 'boat', hits: 30, size: [6, 1.4], occludes: false, weapons: ['torpedo'], torpedoes: 2 },
  // --- land (Driver) ---
  truck: { kind: 'land', model: 'truck', speed: 'truck', hits: 30, size: [6.3, 2.4], occludes: true, runover: true, grenadeDestructible: true },
  opel_blitz: { alias: 'truck' },
  opel_blitz_tanker: { kind: 'land', model: 'fuel_truck', speed: 'truck', hits: 1, size: [6.3, 2.4], occludes: true, runover: true, tanker: true },
  fuel_truck: { alias: 'opel_blitz_tanker' },
  kubelwagen: { kind: 'land', model: 'car', speed: 'car', hits: 20, size: [3.8, 1.6], occludes: true, runover: true },
  willys: { kind: 'land', model: 'car', speed: 'car', hits: 30, size: [3.4, 1.6], occludes: true, runover: true },
  horch: { kind: 'land', model: 'car', speed: 'car', hits: 30, size: [4.9, 1.9], occludes: true, runover: true },
  citroen15: { kind: 'land', model: 'car', speed: 'car', hits: 60, size: [4.8, 1.9], occludes: true, runover: true },
  van: { kind: 'land', model: 'truck', speed: 'car', hits: 60, size: [5, 2.1], occludes: true, runover: true },
  car: { kind: 'land', model: 'car', speed: 'car', hits: 60, size: [4.8, 1.9], occludes: true, runover: true },
  motorcycle: { kind: 'land', model: 'motorcycle', speed: 'motorcycle', hits: 20, size: [2.3, 1.7], occludes: false, runover: true, fastOnly: true },
  panzer2: { kind: 'land', model: 'tank', speed: 'tank', hits: 1000, armor: 'light', size: [5, 2.8], occludes: true, runover: true, weapons: ['cannon', 'tankMg'], vision: 'tank', turret: true },
  panzer3: { kind: 'land', model: 'tank', speed: 'tank', hits: 0, armor: 'heavy', size: [5.5, 2.9], occludes: true, runover: true, weapons: ['cannon', 'tankMg'], vision: 'tank', turret: true },
  panzer4: { kind: 'land', model: 'tank', speed: 'tank', hits: 0, armor: 'heavy', size: [6.6, 2.9], occludes: true, runover: true, weapons: ['cannon', 'tankMg'], vision: 'tank', turret: true },
  tank: { alias: 'panzer2' },
  sdkfz: { kind: 'land', model: 'armoredcar', speed: 'halftrack', hits: 500, armor: 'light', size: [5.9, 2.2], occludes: true, runover: true, weapons: ['tankMg'], vision: 'sdkfz', turret: true },
  armoredcar: { alias: 'sdkfz' },
  halftrack: { alias: 'sdkfz' },
  // --- planes (McRae) ---
  autogyro: { kind: 'plane', model: 'plane', speed: 'plane', hits: 30, size: [5, 5], occludes: false },
  ju52: { kind: 'plane', model: 'plane', speed: 'plane', hits: 30, size: [10, 12], occludes: true },
  ju87: { kind: 'plane', model: 'plane', speed: 'plane', hits: 30, size: [8, 11], occludes: true },
  plane: { alias: 'ju52' },
  // --- rail (scheduled, not steerable) ---
  train: { kind: 'rail', model: 'train', speed: 'rail', hits: 0, armor: 'heavy', size: [30, 3.4], occludes: true, rail: true },
  tram: { kind: 'rail', model: 'tram', speed: 'rail', hits: 0, armor: 'heavy', size: [10, 2.6], occludes: true, rail: true },
  // --- fixed guns (one operator; Ctrl+click) ---
  mgNest: { kind: 'emplacement', model: 'mgNest', speed: null, hits: null, size: [2, 2], occludes: false, weapons: ['mg'], vision: 'mg' },
  cannon: { kind: 'emplacement', model: 'cannon', speed: null, hits: null, size: [3, 2], occludes: false, weapons: ['cannon'], vision: 'cannon' },
  // §3.4 / §5 artillery gunner: enemy-only guns, never manned by a commando [guide]
  mortar210: { kind: 'emplacement', model: 'cannon', speed: null, hits: null, size: [3, 3], occludes: false, weapons: ['cannon'], vision: 'cannon', unmannable: true },
  atgunM20: { kind: 'emplacement', model: 'cannon', speed: null, hits: null, size: [3, 2], occludes: false, weapons: ['cannon'], vision: 'cannon', unmannable: true },
  mortar: { alias: 'mortar210' },
  atgun: { alias: 'atgunM20' },
};

/** Legacy export name (foundation stub) — same object. */
export const VEHICLE_DEFAULTS = VEHICLE_TYPES;

/**
 * Register (or replace) a vehicle type — backwards-compatible catalogue extension (§7.7).
 * @param {string} type @param {object} def see VEHICLE_TYPES
 */
export function registerVehicleType(type, def) {
  VEHICLE_TYPES[type] = { ...def };
  return VEHICLE_TYPES[type];
}

/** Follow aliases to the canonical type name. */
export function canonicalType(type) {
  let t = type, n = 0;
  while (VEHICLE_TYPES[t]?.alias && n++ < 8) t = VEHICLE_TYPES[t].alias;
  return VEHICLE_TYPES[t] ? t : 'truck';
}

/** Resolved per-type definition (registry + CONFIG.vehicles numbers; runtime units m/s, rad/s). */
export function vehicleDef(type) {
  const canon = canonicalType(type);
  const base = VEHICLE_TYPES[canon];
  const V = CONFIG.vehicles;
  const sp = (base.speed && V[base.speed]) || { slow: 0, fast: 0, turn: 0 };
  const seats = V.seats?.[type] ?? V.seats?.[canon] ?? base.seats ?? V.capacity[type] ?? V.capacity[base.kind] ?? 1;
  return {
    weapons: [], armor: 'none', ...base,
    type: canon,
    slow: base.fastOnly ? sp.fast : sp.slow, fast: sp.fast, speed: sp.fast, turn: sp.turn * DEG,
    seats,
    weapon: base.weapons?.[0] ?? null, weapon2: base.weapons?.[1] ?? null,
    boat: base.kind === 'boat',
    operators: DEFAULT_OPERATORS[base.kind] || [],
  };
}

/**
 * Emplacement gun shapes (no ART model yet): sandbag pit ring, carriage, barrel on an elevating
 * cradle. `len`/`r` barrel, `elev` deg, `pit` ring radius, `shield` gun shield, `trail` split trails.
 * mortar210 is the 21 cm Mörser 18 of BEL M7/M8 — a long, steeply raised barrel readable at 1x.
 */
const GUN_SHAPES = {
  mortar210: { len: 5.2, r: 0.17, elev: 30, pit: 2.1, carriage: [1.5, 0.8, 3.2], shield: false, trail: 2.8 },
  cannon: { len: 3.0, r: 0.09, elev: 6, pit: 1.6, carriage: [1.1, 0.55, 1.6], shield: true, trail: 1.8 },
  atgunM20: { len: 2.6, r: 0.07, elev: 3, pit: 1.5, carriage: [1.0, 0.5, 1.4], shield: true, trail: 1.6 },
  mgNest: { len: 1.0, r: 0.035, elev: 2, pit: 1.0, carriage: [0.25, 0.5, 0.25], shield: false, trail: 0 },
};

/** Emplacement placeholder: pit + gun; turret = the traversing gun group (barrel along +z). */
function gunModel(type, def) {
  type = canonicalType(type);
  const S = GUN_SHAPES[type] || GUN_SHAPES.cannon;
  const [l, w] = def.size;
  const root = new THREE.Group();
  root.name = `vehicle:${type}`;
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a5048, roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.4 });
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  // sandbag ring, open at the back (−z) for the crew
  const n = Math.max(8, Math.round(S.pit * 7)), bagH = S.pit > 1.2 ? 0.75 : 0.55;
  const bagGeo = new THREE.BoxGeometry((2 * Math.PI * S.pit) / n * 0.95, bagH, 0.45);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (Math.abs(Math.cos(a) + 1) < 0.35) continue; // gap at the rear
    const b = add(root, bagGeo, bagMat, Math.sin(a) * S.pit, bagH / 2, Math.cos(a) * S.pit);
    b.rotation.y = a;
  }
  const turret = new THREE.Group();
  root.add(turret);
  const [cw, ch, cl] = S.carriage;
  add(turret, new THREE.BoxGeometry(cw, ch, cl), steel, 0, ch / 2 + 0.15, 0);
  if (S.trail) { // split trails running back from the carriage
    for (const sx of [-1, 1]) {
      const t = add(turret, new THREE.BoxGeometry(0.16, 0.14, S.trail), steel, sx * cw * 0.35, 0.12, -S.trail / 2);
      t.rotation.y = sx * 0.18;
    }
  }
  if (type !== 'mgNest') { // road wheels / pedestal
    const wheel = new THREE.CylinderGeometry(ch * 0.9, ch * 0.9, 0.18, 14);
    for (const sx of [-1, 1]) add(turret, wheel, dark, sx * (cw / 2 + 0.1), ch * 0.9, 0).rotation.z = Math.PI / 2;
  }
  const cradle = new THREE.Group(); // elevating mass, pivots at the trunnions
  cradle.position.y = ch + 0.25;
  cradle.rotation.x = -S.elev * Math.PI / 180;
  turret.add(cradle);
  add(cradle, new THREE.BoxGeometry(S.r * 4.2, S.r * 3.4, S.len * 0.35), steel, 0, 0, S.len * 0.05);
  const barrel = add(cradle, new THREE.CylinderGeometry(S.r, S.r * 1.25, S.len, 12), dark, 0, 0, S.len / 2 - S.len * 0.1);
  barrel.rotation.x = Math.PI / 2;
  add(cradle, new THREE.CylinderGeometry(S.r * 1.35, S.r * 1.35, S.len * 0.06, 12), dark, 0, 0, S.len * 0.9 - S.len * 0.03)
    .rotation.x = Math.PI / 2; // muzzle band
  if (S.shield) add(turret, new THREE.BoxGeometry(cw * 1.6, 1.0, 0.05), steel, 0, ch + 0.45, cl * 0.25);
  const mats = [bagMat, steel, dark], base = mats.map((m) => m.color.getHex());
  return {
    root, turret, dims: { w, l, h: 1.0 },
    // barrel reach from the pivot and trunnion height (world/placement.js turretArc, placement rule d)
    gun: { len: S.len * 0.9, h: ch + 0.25 },
    update() {},
    // local = world turret heading − hull heading; rotation.y turns the other way (as boxModel)
    setTurretHeading(r) { turret.rotation.y = -r; },
    setGunLift(a) { cradle.rotation.x = -S.elev * Math.PI / 180 - (Number.isFinite(a) ? a : 0); },
    setDestroyed(on) { mats.forEach((m, i) => m.color.setHex(on ? 0x1d1a17 : base[i])); if (on) cradle.rotation.x = 0.12; },
    dispose() { root.traverse((o) => { o.geometry?.dispose(); }); mats.forEach((m) => m.dispose()); },
  };
}

/** Placeholder model for types the ART catalogue does not have yet (train, tram, mgNest, cannon). */
function boxModel(type, def) {
  if (def.kind === 'emplacement') return gunModel(type, def);
  const [l, w] = def.size;
  const h = def.kind === 'emplacement' ? 1.0 : def.kind === 'rail' ? 3.2 : 1.6;
  const root = new THREE.Group();
  root.name = `vehicle:${type}`;
  const mat = new THREE.MeshStandardMaterial({ color: def.kind === 'emplacement' ? 0x8a7a5a : 0x3c4038, roughness: 0.9 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  hull.position.y = h / 2;
  hull.castShadow = hull.receiveShadow = true;
  root.add(hull);
  let turret = null, gunPivot = null;
  if (def.kind === 'emplacement') {
    turret = new THREE.Group();
    turret.position.y = h;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, type === 'cannon' ? 2.4 : 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = type === 'cannon' ? 1.2 : 0.6;
    gunPivot = new THREE.Group(); gunPivot.name = 'gunPivot'; // elevation (placement rule d: lift over walls)
    gunPivot.add(barrel);
    turret.add(gunPivot);
    root.add(turret);
  }
  return {
    root, turret, dims: { w, l, h },
    gun: turret ? { len: type === 'cannon' ? 2.4 : 1.2, h } : null,
    update() {},
    // local = world turret heading − hull heading; rotation.y turns the other way (headingToRotY = π/2 − h)
    setTurretHeading(r) { if (turret) turret.rotation.y = -r; },
    setGunLift(a) { if (gunPivot) gunPivot.rotation.x = -(Number.isFinite(a) ? a : 0); },
    setDestroyed(on) { mat.color.setHex(on ? 0x1d1a17 : 0x3c4038); },
    dispose() { root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); },
  };
}

/** Model through the ART modules: the realistic vehicle library (art/vehicle-model.js, once prepareVehicleArt ran), else
 *  the art/vehicles.js placeholders, else the local placeholder box (types the library has no model for: van, atgunM20 …). */
function modelFor(type, def, spawn = {}) {
  const real = createLibraryVehicleModel(type, def, spawn);
  if (real) return real;
  const kit = createKitVehicleModel(type, def, spawn, vehicleArtContext().theater); // placeholder-art pass (art/kit-vehicles.js)
  if (kit) return kit;
  if (VEHICLE_MODELS[def.model]) return createVehicleModel(def.model);
  if (VEHICLE_MODELS[type]) return createVehicleModel(type);
  return boxModel(type, def);
}

/** Enemy → commando visibility through the AI perception API. */
function canSeeUnit(viewer, unit, world) {
  return perceptionCanSee(viewer, unit, world) !== 'none';
}

export class Vehicle extends Entity {
  /**
   * @param {{vehicleType?:string, x:number, z:number, heading?:number, id?:string, driveable?:boolean,
   *   crew?:any[], model?:object, operators?:string[], route?:object, behavior?:string, giro?:number,
   *   track?:{x:number,z:number}[], schedule?:{period?:number, speed?:number, delay?:number}, used?:boolean}} spawn
   */
  constructor(spawn = {}) {
    super({ kind: 'vehicle', x: spawn.x ?? 0, z: spawn.z ?? 0, heading: spawn.heading ?? 0, tag: spawn.id ?? null });
    this.vehicleType = spawn.vehicleType || 'truck';
    const D = vehicleDef(this.vehicleType);
    if (spawn.operators) D.operators = [...spawn.operators];
    if (spawn.seats != null) D.seats = spawn.seats; // mission override (M3 evac_truck seats: 6)
    if (spawn.unmannable != null) D.unmannable = !!spawn.unmannable; // §3.4 per-spawn "never manned" flag
    if (Array.isArray(spawn.weapons)) { // per-spawn armament (M4's Panzer II: hull MG only, Kildread "armed like the SdKfz")
      D.weapons = [...spawn.weapons]; D.weapon = D.weapons[0] ?? null; D.weapon2 = D.weapons[1] ?? null;
    }
    if (spawn.boardAny) D.boardAny = true; // scripted escape boat (BEL exit vehicle, M4): anyone boards it from the bank
    this.def = D;
    this.spawn = spawn;
    /** 'land' | 'boat' | 'plane' | 'emplacement' | 'rail' */
    this.vehicleKind = D.kind;
    this.maxSpeed = D.slow;
    this.hp = spawn.hp ?? 100; // legacy pool (objectives/tests); destruction follows hits/explosion rules
    this.maxHp = this.hp;
    this.driveable = spawn.driveable !== false && D.kind !== 'rail';
    this.crewSpawn = spawn.crew || [];
    /** Enemy crew records {soldierType, alive, ref} (§4.1 `crew`/`truckDriver`/`officer`). `ref` is the
     *  entry's id: when it names a mission Enemy (e.g. crew: ['e17']) the record is LINKED to that
     *  soldier — it dies with him (killing the gunner silences the gun, §3.4) and he dies with the hull. */
    this.crew = this.crewSpawn.map((c) => (typeof c === 'string'
      ? { soldierType: c, alive: true, ref: c }
      : { soldierType: c.soldierType || 'crew', alive: true, ref: c.id ?? null, post: c.post || null }));
    /** A rider's post (schema folds `vehicle:`-carrying enemy spawns into crew records, §7.5 pboat e17
     *  "sweep 60, giro 180, facing travel") shapes the vehicle's own cone and gun traverse. */
    const crewPost = spawn.post ? null : this.crew.find((c) => c.post)?.post || null;
    this.faction = this.crew.length ? 'enemy' : 'neutral';
    this.occupants = [];
    this.driver = null;
    this.speed = 0;
    this.fast = false;
    this.path = null;
    this.pathIndex = 0;
    this.destroyed = false;
    this.tainted = false;
    this.taintedBy = null;
    /** Bullet hits taken (§3.7 .IMPACTOS) vs def.hits. */
    this.hits = 0;
    /** Straight-line drive goal (§3.7) or null. */
    this.goal = null;
    /** Weapon state: turret heading (world rad), cooldowns (s), queued volley. */
    this.turretHeading = this.heading;
    this.weaponCd = {};
    this.volley = null;
    this.torpedoes = D.torpedoes ?? 0;
    /** Emplacement traverse limit (§4.1 `giro`, deg total) around the post heading, or null = free. */
    this.giro = spawn.giro ?? crewPost?.giro ?? null;
    this.postHeading = this.heading;
    /** Raft suspicion (§4.3): on-site rafts nobody has used yet are not suspicious. */
    this.used = !!spawn.used;
    this.raftHits = 0;
    this.wreckT = 0;
    this.burning = false;
    // Enemy-crewed armour sees with its own cone (§4.2 tank / sdkfz / mg). Player-drivable Panzer II is bullet-immune.
    this.vision = this.crew.length && D.vision ? makeVision(D.vision, crewPost ? { ...spawn, post: crewPost } : spawn) : null;
    this.sweepActive = !!this.vision;
    this.headOffset = 0;
    this.bulletImmune = D.hits === 0 || (D.type === 'panzer2' && !this.crew.length && this.driveable)
      || CONFIG.vehicles.bulletImmune.includes(D.type);
    this.model = spawn.model || modelFor(this.vehicleType, D, spawn);
    this.object3d = this.model.root;
    this.waitT = 0;
    if (D.rail) this._initRail(spawn);
    this.brain = createVehicleBrain(this, spawn);
  }

  get isBoat() { return !!this.def.boat; }

  /** Per-frame visuals: enemy crew figures on open vehicles (art/vehicle-crew.js; built on the first frame). */
  renderUpdate(dt) {
    if (this._crewFig === undefined && this.model.isReady !== false) this._crewFig = this.world ? createCrewFigures(this) : undefined;
    this._crewFig?.update(dt);
  }

  // ---------------------------------------------------------------- operators & passengers

  /** Seats (operator included). */
  get capacity() { return this.def.seats; }

  /** The commando operating it (driver / gunner), or null. Alias of `driver`. */
  get operator() { return this.driver; }

  /** The mission Enemy a crew record is linked to (its `ref` names one), or null. */
  linkedCrew(c) {
    const u = c?.ref != null ? this.world?.byId(c.ref) : null;
    return u && u !== this && u.kind === 'enemy' ? u : null;
  }

  /** Enemy crew still alive. */
  get crewed() {
    if (this.destroyed) return false;
    for (const c of this.crew) {
      const u = this.linkedCrew(c);
      if (u && u.alive === false) c.alive = false; // the linked soldier died → his seat is empty
    }
    if (this.crew.some((c) => c.alive)) return true;
    // `spawn.gunner`: id of an Enemy entity manning this gun / driving (dies → the post can be taken, §3.4).
    // An enemy spawn's `emplacement: '<vehicle id>'` names the same link from the soldier's side.
    const gid = this.spawn.gunner ?? this._emplacementGunnerId();
    const g = gid != null ? this.world?.byId(gid) : null;
    return !!(g && g.alive);
  }

  /**
   * The living mission Enemy manning this vehicle as a linked soldier (`spawn.gunner`, an enemy spawn's
   * `emplacement: <id>`, or a crew record naming him), or null. When one mans an emplacement his own
   * (drawn) cone is the gun's only detection geometry (§4.2 'logic = display', §10.2).
   */
  get gunnerEnemy() {
    if (this.destroyed || !this.world) return null;
    const gid = this.spawn.gunner ?? this._emplacementGunnerId();
    const g = gid != null ? this.world.byId(gid) : null;
    if (g && g.kind === 'enemy' && g.alive !== false) return g;
    for (const c of this.crew) {
      const u = this.linkedCrew(c);
      if (u && u.alive !== false) return u;
    }
    return null;
  }

  /** Id of the mission Enemy whose spawn says `emplacement: <this vehicle's id>` (cached once found), or null. */
  _emplacementGunnerId() {
    if (this._empGunner !== undefined) return this._empGunner;
    const tag = this.tag, w = this.world;
    if (tag == null || !w?.enemies) return null;
    const e = w.enemies.find((u) => u.spawn?.emplacement === tag && u.spawn.id != null);
    if (!e) return null; // not cached: the soldier may be spawned after the gun
    return (this._empGunner = e.spawn.id);
  }

  /** May `unit` operate (drive / row / fly / man) this vehicle? (§3.7 operator table) */
  canOperate(unit) {
    if (this.def.unmannable) return false; // §3.4: the 210 mm mortar / M20 anti-tank gun are never manned
    return !!unit && unit.faction === 'player' && operatorMatches(this.def.operators, unit) && this.driveable;
  }

  /**
   * Can `unit` get in? Capacity, state, crew, emplacement and boat rules (§3.2, §3.7).
   * @returns {true|string} reason when not
   */
  canEnter(unit) {
    if (this.destroyed) return 'destroyed';
    if (!unit || !unit.alive) return 'dead';
    if (this.occupants.includes(unit)) return 'already inside';
    if (this.crewed) return 'enemy crew aboard';
    if (this.def.type === 'train') return 'cannot board a train';
    if (this.def.rail && this.speed > 0) return 'it is moving';
    if (this.occupants.length >= this.capacity) return 'full';
    if (this.def.unmannable && unit.faction !== 'enemy') return 'this gun can never be manned';
    const op = this.canOperate(unit);
    if (this.def.kind === 'emplacement' && !op) return 'only the Driver can man this gun';
    // §3.4 raft/boats: the Marine boards first; others board while the boat sits in shallow water.
    if (this.isBoat && !this.driver && !op && !this.def.boardAny) return 'the Marine must board first';
    if (this.isBoat && !op && this.world && !this._nearShallowOrBank()) return 'the boat must be in shallow water';
    return true;
  }

  /** Boat within reach of shallow water or the bank (boarding / leaving, §3.2). */
  _nearShallowOrBank() {
    const g = this.world.grid;
    const r = Math.max(this.def.size[0], this.def.size[1]) / 2 + 1;
    for (let a = 0; a < 16; a++) {
      for (const f of [0, 0.6, 1]) {
        const x = this.x + Math.cos((a / 16) * 2 * Math.PI) * r * f, z = this.z + Math.sin((a / 16) * 2 * Math.PI) * r * f;
        const { i, j } = g.worldToCell(x, z);
        if (!g.inBounds(i, j)) continue;
        const k = g.idx(i, j);
        if (g.terrain[k] === T.SHALLOW || g.isWalkable(i, j) || g.bridge[k]) return true;
      }
    }
    return false;
  }

  /**
   * Put a unit inside (hidden from enemies, §4.2). The first capable commando becomes the operator.
   * Enemies who see the commando board mark the vehicle tainted (§3.7, §4.3).
   * @returns {boolean}
   */
  enter(unit) {
    const enemyCrew = unit?.faction === 'enemy' && !this.destroyed && this.occupants.length < this.capacity;
    if (!enemyCrew && this.canEnter(unit) !== true) return false;
    if (unit.faction === 'player') this._checkTaint(unit);
    // where he got in from (visual only: art/boat-crew.js draws him stepping / hoisting himself in from there)
    if (Number.isFinite(unit.x)) unit.boardFrom = { x: unit.x, z: unit.z, t: this.world?.time ?? 0, swim: unit.stance === 'swim' || unit.stance === 'dive' };
    this.occupants.push(unit);
    if (!this.driver && this.canOperate(unit)) this.driver = unit;
    this.model.boarding?.(this.occupants.length - 1, 'enter'); // that seat's door / hatch opens and closes
    unit.stop?.();
    unit.state = 'inVehicle';
    unit.vehicle = this;
    if (unit.object3d) unit.object3d.visible = false;
    if (unit.faction === 'player') this.used = true;
    this.world?.events.emit('vehicle:enter', { vehicle: this, unit });
    return true;
  }

  /** §4.3: every living enemy who sees `unit` right now taints the vehicle. */
  _checkTaint(unit) {
    const w = this.world;
    if (!w || this.tainted || !w.enemies) return;
    const seer = w.enemies.find((e) => e.alive && e.vision && canSeeUnit(e, unit, w));
    if (seer) this.taint(seer);
  }

  /** Mark tainted (§3.7): every enemy who sees it attacks it until destroyed, even when empty. */
  taint(by = null) {
    if (this.tainted || this.destroyed) return;
    this.tainted = true;
    this.taintedBy = by;
    this.world?.events.emit('vehicle:tainted', { vehicle: this, by });
    if (by) {
      by.target = this;
      this.world?.emitNoise?.(by.x, by.z, CONFIG.stealth.noise.alarmShout?.radius ?? 18, 'alarmShout', by);
    }
  }

  /**
   * Let a unit out onto a walkable cell within CONFIG.vehicles.exitRadius (§3.7). Boats: only near
   * shallow water or the bank, except the Marine in diving gear who may leave in deep water (§3.2).
   * @param {object} unit @param {number} [x] @param {number} [z] preferred point
   * @param {{force?: boolean}} [o] force: destroyed vehicle / scripted (skips the boat rule)
   * @returns {boolean}
   */
  exit(unit, x, z, o = {}) {
    const k = this.occupants.indexOf(unit);
    if (k < 0) return false;
    const w = this.world;
    let p = null;
    if (w) {
      const diver = unit.role === 'diver' && (unit.stance === 'dive' || unit.diving || unit.canSwim);
      if (this.isBoat && !o.force && !this.destroyed && !this._nearShallowOrBank() && !diver) return false;
      // a scripted exit of an enemy rider (mission scripts: `exit(e, x, z, {force})`) steps out through his seat's
      // door like everyone else, then walks to the point (the lorry driver of M4 heads for his errand)
      const doorFirst = unit.faction !== 'player' && x != null && !this.isBoat && !this.destroyed && this.def.kind === 'land';
      p = this._exitPoint(doorFirst ? undefined : x, doorFirst ? undefined : z, diver && this.isBoat, unit, k);
      if (doorFirst && p) o = { ...o, walkTo: { x, z } };
      if (!p && !o.force && !this.destroyed) return false;
    }
    this.occupants.splice(k, 1);
    if (!this.destroyed) this.model.boarding?.(k, 'exit');
    if (this.driver === unit) this.driver = this.occupants.find((u) => this.canOperate(u)) || null;
    if (!this.driver) this._halt();
    p = p || { x: this.x, z: this.z };
    unit.state = 'active';
    unit.vehicle = null;
    unit.setPosition?.(p.x, p.z, this.heading);
    if (unit.object3d) unit.object3d.visible = true;
    if (o.walkTo && Math.hypot(o.walkTo.x - p.x, o.walkTo.z - p.z) > 0.6) unit.moveTo?.(o.walkTo.x, o.walkTo.z);
    w?.events.emit('vehicle:exit', { vehicle: this, unit });
    return true;
  }

  /**
   * Walkable (or, for a swimmer, water) cell within exitRadius of the hull, nearest the preferred point.
   * Per-seat exit: with no preferred point each seat steps out at its own spot along the side, and cells
   * already taken by another standing unit are skipped (units never stack on one point), unless nothing
   * else is free.
   */
  _exitPoint(px, pz, swim = false, unit = null, seat = 0) {
    const g = this.world.grid;
    const R = CONFIG.vehicles.exitRadius + Math.max(...this.def.size) / 2;
    // the seat's door side (art/vehicle-model.js seatSide: LHD driver left, R75 sidecar right, tailgate / rear doors)
    const ss = seatSide(this.vehicleType, this.def.kind, seat);
    const side = this.heading + (ss ? ss.side : 1) * Math.PI / 2;
    const [len, wid] = this.def.size;
    const out = ss?.back ? 0.5 : wid / 2 + 1;
    const along = px == null ? (ss ? (ss.back ? -(len / 2 + 1) : -ss.row * EXIT_SPACING) : (seat % 2 ? 1 : -1) * Math.ceil(seat / 2) * EXIT_SPACING) : 0;
    const want = {
      x: px ?? this.x + Math.cos(side) * out + Math.cos(this.heading) * along,
      z: pz ?? this.z + Math.sin(side) * out + Math.sin(this.heading) * along,
    };
    const others = [];
    for (const list of [this.world.commandos, this.world.enemies]) {
      for (const u of list || []) {
        if (u === unit || u.removed || u.vehicle || u.state === 'inVehicle') continue;
        if (Number.isFinite(u.x) && Math.hypot(u.x - this.x, u.z - this.z) <= R + EXIT_SPACING) others.push(u);
      }
    }
    const taken = (x, z) => others.some((u) => Math.hypot(u.x - x, u.z - z) < EXIT_SPACING);
    let best = null, bd = Infinity, bestAny = null, bdAny = Infinity;
    const step = g.cell;
    for (let dx = -R; dx <= R; dx += step) {
      for (let dz = -R; dz <= R; dz += step) {
        const x = this.x + dx, z = this.z + dz;
        if (dx * dx + dz * dz > R * R) continue;
        if (this._inHull(x, z, 0.3)) continue;
        const { i, j } = g.worldToCell(x, z);
        if (!g.inBounds(i, j) || !g.isWalkable(i, j, { swim })) continue;
        if (this.world.vehicles.some((v) => v !== this && !v.removed && !v.hiddenRail && v._inHull(x, z, 0.3))) continue;
        const d = Math.hypot(x - want.x, z - want.z);
        const pt = g.cellCenter ? g.cellCenter(i, j) : { x, z };
        if (d < bdAny) { bdAny = d; bestAny = pt; }
        if (d < bd && !taken(pt.x, pt.z)) { bd = d; best = pt; }
      }
    }
    return best || bestAny;
  }

  /** Point inside this hull's oriented rectangle (+margin)? */
  _inHull(x, z, margin = 0, hx = this.x, hz = this.z, h = this.heading) {
    const dx = x - hx, dz = z - hz;
    const c = Math.cos(h), s = Math.sin(h);
    const along = dx * c + dz * s, across = -dx * s + dz * c;
    return Math.abs(along) <= this.def.size[0] / 2 + margin && Math.abs(across) <= this.def.size[1] / 2 + margin;
  }

  // ---------------------------------------------------------------- driving (§3.7: no pathfinding)

  /** Can this hull's kind occupy the cell at (x, z)? Static layers only (+ other vehicles). */
  passableAt(x, z) {
    const w = this.world;
    const g = w.grid;
    const { i, j } = g.worldToCell(x, z);
    // scripted escape vehicles (§7.6 evac_truck) enter from / leave past the map edge
    if (!g.inBounds(i, j)) return !!this.offMapOK;
    const k = g.idx(i, j);
    const t = g.terrain[k];
    if (this.isBoat) {
      if (!(t === T.WATER || t === T.SHALLOW)) return false;
      if (g.block[k] === B.HIGH && !g.bridge[k]) return false;
    } else {
      if (g.block[k] !== B.NONE && !this._rammable(x, z)) return false;
      if (g.navBlock?.[k]) return false; // what the visuals occupy (steps, woodpiles, tower legs; placement rule e)
      // eaves, porch roofs, balconies lower than the hull + turret (placement rule e overhead clearance)
      if (g.overLo && g.overLo[k] < Infinity && g.overLo[k] < this._groundAt(x, z) + this.hullHeight() + 0.1) return false;
      if (t === T.WATER && !g.bridge[k]) return false;
      if (g.elev && g.elev[k] > 0.3) return false;
    }
    for (const v of w.vehicles) {
      if (v === this || v.removed || v.hiddenRail || (v.destroyed && v.wreckBaked)) continue;
      if (v._inHull(x, z, 0.1)) return false;
    }
    return true;
  }

  /** Ground height under (x, z) (the visual ground when the terrain provides one, else 0). */
  _groundAt(x, z) {
    const w = this.world, gy = w?.groundY;
    return typeof gy === 'function' ? gy.call(w, x, z) : 0;
  }

  /** Height of the hull + turret / cab / canvas above its ground (m, the model's bounds; fallback 2.4). */
  hullHeight() {
    if (this._hullH != null) return this._hullH;
    const o = this.object3d;
    let h = this.def.height ?? 2.4, meshes = 0;
    if (o) {
      o.updateMatrixWorld(true);
      o.traverse((n) => { if (n.isMesh) meshes++; });
      const b = new THREE.Box3().setFromObject(o);
      if (meshes && !b.isEmpty()) h = Math.max(0.5, b.max.y - o.position.y);
    }
    if (meshes) this._hullH = h; // a model still loading (truck GLB) is measured again later
    return h;
  }

  /** §3.7 ramming: at fast speed, barriers and light gates (interactables flagged light/barrier) give way. */
  _rammable(x, z) {
    if (!this.fast || !this.world?.interactables) return false;
    const it = this.world.interactables.find((o) => !o.destroyed && (o.barrier || o.light || o.interactKind === 'barrier')
      && Math.hypot(o.x - x, o.z - z) < (o.radius || 1.5) + 1);
    return !!it;
  }

  /**
   * A closed gate / boom barrier at (x, z) (its own grid cells, still blocked)? Routes probe the hull centre only, so
   * a route vehicle also checks its bumper against shut gates: the lorry waits with its nose at the level-crossing
   * boom (M4), not through it with its cab over the rails (real-length models would stop the train).
   */
  _closedGateAt(x, z) {
    const w = this.world, g = w?.grid;
    if (!g || this.isBoat || !w.interactables) return false;
    const { i, j } = g.worldToCell(x, z);
    if (!g.inBounds(i, j)) return false;
    const k = g.idx(i, j), own = g.owner?.[k];
    if (!own || g.block[k] === B.NONE) return false;
    return w.interactables.some((o) => o.owner === own && !o.destroyed && o.open === false && (o.barrier || o.interactKind === 'door'))
      && !this._rammable(x, z);
  }

  /** Nose probe points of the hull placed at (x, z) facing h. */
  _nosePoints(x, z, h, strict = true) {
    const [l, wd] = this.def.size;
    const c = Math.cos(h), s = Math.sin(h);
    const nx = x + c * (l / 2), nz = z + s * (l / 2);
    if (!strict) return [[x, z]];
    const px = -s * (wd / 2 + 0.05), pz = c * (wd / 2 + 0.05); // the full hull width (+5 cm): mirrors and wings clear walls
    // across the width at ≤ 0.4 m (under a grid cell): a lone post or a tree trunk never slips between two samples
    const pts = [[nx, nz]], n = Math.max(1, Math.ceil((wd + 0.1) / 2 / 0.4));
    for (let k = 1; k <= n; k++) { const f = k / n; pts.push([nx + px * f, nz + pz * f], [nx - px * f, nz - pz * f]); }
    return pts;
  }

  /**
   * Distance the vehicle can drive straight toward (x, z) before its nose meets a blocking cell (§3.7
   * forbidden cursor when ~0). Assumes it has turned to face the point first.
   * @returns {number} metres (0 = can't move that way)
   */
  straightReach(x, z) {
    if (!this.world || !this.def.fast) return 0;
    const d = Math.hypot(x - this.x, z - this.z);
    if (d < 1e-3) return 0;
    const h = angleTo(this.x, this.z, x, z);
    const st = CONFIG.vehicles.probeStep;
    const c = Math.cos(h), s = Math.sin(h);
    let reach = 0;
    for (let t = st; t <= d + 1e-6; t += st) {
      const ok = this._nosePoints(this.x + c * t, this.z + s * t, h).every(([px, pz]) => this.passableAt(px, pz));
      if (!ok) break;
      reach = t;
    }
    return Math.min(reach, d);
  }

  /** Can the operator's straight-line click at (x, z) move the vehicle at all? (cursor feedback) */
  canDriveTo(x, z) {
    if (this.world?.driveRules?.some((r) => r(this, x, z) === false)) return false; // MISSIONS rules (M19 no rowing upstream)
    return this.driveable && !this.destroyed && this.vehicleKind !== 'emplacement' && this.straightReach(x, z) >= 0.5;
  }

  /**
   * §3.7 drive: turn in place toward (x, z), then drive in a STRAIGHT line at slow (click) or fast
   * (double-click) speed; the vehicle stops at the first blocking cell. Motorcycles have one speed.
   * @returns {boolean} false when the vehicle can't move that way
   */
  driveTo(x, z, fast = false) {
    if (!this.world || this.destroyed || !this.def.fast || this.vehicleKind === 'emplacement' || this.def.rail) return false;
    // §3.7 ramming: reachability is judged at the ordered speed (a fast order goes through barriers)
    const wasFast = this.fast;
    this.fast = !!fast || !!this.def.fastOnly;
    if (!this.canDriveTo(x, z)) { this.fast = wasFast; return false; }
    this.maxSpeed = this.fast ? this.def.fast : this.def.slow;
    this.path = null;
    this.goal = { x, z, strict: true };
    return true;
  }

  /**
   * Follow a scripted route of straight segments (AI patrols / exits; no A*). Each waypoint may carry
   * `wait` (s). @param {{x:number,z:number,wait?:number}[]} pts @param {{fast?:boolean, speed?:number}} [o]
   */
  followPath(pts, o = {}) {
    if (!pts?.length || this.destroyed) return false;
    this.fast = !!o.fast;
    this.maxSpeed = o.speed ?? (this.fast ? this.def.fast : this.def.slow);
    this.path = pts.map((p) => ({ ...p }));
    this.pathIndex = 0;
    this.goal = { ...this.path[0], strict: false };
    return true;
  }

  /** Legacy (placeholder API): land vehicles path over land (A*), boats straight over water. */
  moveTo(x, z) {
    if (!this.world || this.destroyed || !this.def.fast) return false;
    const path = this.isBoat ? (this.straightReach(x, z) >= Math.hypot(x - this.x, z - this.z) - 0.5 ? [{ x, z }] : null)
      : this.world.findPath(this.x, this.z, x, z, { swim: false });
    if (!path) return false;
    return this.followPath(path, { fast: true });
  }

  /** Stop now (keeps the route cleared). */
  stop() { this._halt(); }

  _halt() {
    const was = this.speed > 0 || !!this.goal;
    this.path = null;
    this.goal = null;
    this.speed = 0;
    if (was && this.world) this.world.events.emit('vehicle:stop', { vehicle: this });
  }

  /**
   * Order from a commando inside (commando.issue hook): 'move' → driveTo (run = double-click = fast);
   * 'stop' → halt. Only the operator steers; passengers' orders are refused.
   * @returns {boolean}
   */
  handleOrder(unit, order) {
    if (!order) return false;
    if (order.type === 'stop') { if (unit === this.driver) this._halt(); return true; }
    if (order.type !== 'move') return false;
    const w = this.world;
    const say = (text) => { w?.events.emit('message', { text: `${unit.nickname || unit.role}: ${text}`, kind: 'warn', unit }); return false; };
    if (unit !== this.driver) return say(this.driver ? 'only the operator steers.' : `I can't drive this.`);
    if (this.vehicleKind === 'emplacement') return say('the gun is fixed.');
    if (!this.driveTo(order.x, order.z, !!order.run)) {
      w?.events.emit('ui:cursor', { cursor: 'forbidden', x: order.x, z: order.z });
      return say(`can't get there in a straight line.`);
    }
    return true;
  }

  // ---------------------------------------------------------------- per-step update

  update(dt) {
    if (this._pendingOccupants) this._relinkOccupants();
    if (this.destroyed) {
      this._updateWreck(dt);
      this.model.update?.(dt, this);
      return;
    }
    this.brain?.update(dt);
    if (this.def.rail) this._updateRail(dt);
    else if (this.goal) this._updateDrive(dt);
    if (this.speed > 0.05 && this.def.runover) this._runover();
    this._updateWeapons(dt);
    for (const u of this.occupants) { u.x = this.x; u.z = this.z; u.heading = this.heading; u.snap?.(); }
    // placement rule (d): the barrel never swings through a wall — closed arcs are skipped, low ones lift it
    const arc = this.gunArc();
    // (every angle closed — the housing under an overhang: the turret stays where it is, barrel level)
    if (arc && !arc.some((v) => v !== Infinity)) { this.turretHeading = this._turretKeep ?? this.turretHeading; this.model.setGunLift?.(0); }
    else if (arc) { this.turretHeading = clampTraverse(arc, this.turretHeading); this.model.setGunLift?.(liftAt(arc, this.turretHeading)); }
    this._turretKeep = this.turretHeading;
    this.model.setTurretHeading?.(this.turretHeading - this.heading);
    this.model.update?.(dt, this);
  }

  /** One step of the straight-line drive / scripted route (§3.7). */
  _updateDrive(dt) {
    if (this.waitT > 0) { this.waitT -= dt; this.speed = 0; return; }
    const g = this.goal;
    const d = Math.hypot(g.x - this.x, g.z - this.z);
    if (d < (g.strict ? 0.3 : 0.8)) return this._nextWaypoint();
    const want = angleTo(this.x, this.z, g.x, g.z);
    const diff = Math.abs(angleDiff(this.heading, want));
    const h0 = this.heading;
    this.heading = turnTowardsAngle(this.heading, want, this.def.turn * dt);
    // turning in place / in a bend never swings the hull over a man on the ground (body clearance)
    if (this.heading !== h0 && !this._lethal() && this._stepAside(this._bodiesUnder(this.x, this.z, this.heading), this.x, this.z, this.heading).length) {
      this.heading = h0;
      return this._bodyBlocked(g, dt);
    }
    // Player driving: turn in place first, then a straight line. Routes (AI) turn while rolling.
    if (g.strict && diff > CONFIG.vehicles.alignDeg * DEG) { this.speed = 0; return; }
    if (!g.strict && diff > Math.PI / 3) { this.speed = 0; return; } // routes: sharp bends / reversals turn in place
    const was = this.speed;
    // routes: slow down in bends so the turning circle (v / turn rate) still reaches the waypoint
    const target = g.strict ? this.maxSpeed
      : Math.min(this.maxSpeed * Math.max(0.25, Math.cos(Math.min(diff, Math.PI / 2))), diff > 0.2 ? Math.max(0.8, this.def.turn * d * 0.5) : Infinity);
    // after a gate smash the vehicle claws its speed back slowly (world/breakables.js applyRamResponse)
    const acc = this.ramDrag > 0 ? ((this.ramDrag = Math.max(0, this.ramDrag - dt)), 0.12) : 1;
    this.speed = Math.min(target, this.speed + this.maxSpeed * 2 * acc * dt);
    const step = Math.min(d, this.speed * dt);
    const h = g.strict ? want : this.heading;
    const nx = this.x + Math.cos(h) * step, nz = this.z + Math.sin(h) * step;
    const ahead = CONFIG.vehicles.probeStep;
    const clear = this._nosePoints(nx + Math.cos(h) * ahead, nz + Math.sin(h) * ahead, h, g.strict).every(([px, pz]) => this.passableAt(px, pz))
      && (g.strict || !this._closedGateAt(nx + Math.cos(h) * (this.def.size[0] / 2 + ahead), nz + Math.sin(h) * (this.def.size[0] / 2 + ahead)));
    if (!clear) {
      if (g.strict) { if (this.speed > 0.5) bumpGate(this); this._halt(); return; } // §3.7 stops at the first blocking cell (a closed gate there bows: §3.7 addendum)
      this.speed = 0; // routes wait until the way is clear (e.g. a vehicle parked on the road)
      this.blockedT = (this.blockedT || 0) + dt;
      return;
    }
    // a man's body (a crawler's legs, a prone head) in the hull's way: at run-over speed he is run over (§3.7),
    // otherwise the vehicle stops short of him — it never rolls over him and leaves him alive under the chassis
    const under = this._bodiesUnder(nx, nz, h);
    if (under.length) {
      if (this._lethal()) for (const u of under) this._runoverKill(u);
      else if (this._stepAside(under, nx, nz, h).length) return this._bodyBlocked(g, dt);
    }
    this.blockedT = 0;
    if (g.strict) this.heading = want;
    this.x = nx;
    this.z = nz;
    this._breakBarriers();
    if (was === 0 && this.speed > 0) this.world?.events.emit('vehicle:move', { vehicle: this, speed: this.maxSpeed });
  }

  /** Advance a scripted route (followPath) or finish the drive. */
  _nextWaypoint() {
    if (!this.path) { this._halt(); return; }
    const cur = this.path[this.pathIndex];
    if (cur?.wait > 0) { this.waitT = cur.wait; this.speed = 0; }
    this.pathIndex++;
    if (this.pathIndex >= this.path.length) {
      const done = this.path;
      this.path = null;
      this.goal = null;
      this.speed = 0;
      this.world?.events.emit('vehicle:stop', { vehicle: this });
      this.brain?.onRouteEnd?.(done);
      return;
    }
    const p = this.path[this.pathIndex];
    this.goal = { x: p.x, z: p.z, strict: false };
  }

  /** §3.7 ramming: barriers and light gates in the nose break at fast speed. */
  _breakBarriers() {
    if (!this.fast || !this.world?.interactables) return;
    const [nx, nz] = this._nosePoints(this.x, this.z, this.heading)[0];
    for (const o of this.world.interactables) {
      if (o.destroyed || !(o.barrier || o.light || o.interactKind === 'barrier')) continue;
      if (o.ramBreak) { // gate smash (world/breakables.js): contact at the gate plane, outcome from J = m·v
        if (o.open || !inContact(this, o)) continue;
        const r = ramGate(this, o);
        if (r.outcome !== 'hold') o.ramBreak(this);
        applyRamResponse(this, o, r);
        if (r.outcome === 'hold') return;
        continue;
      }
      if (Math.hypot(o.x - nx, o.z - nz) > (o.radius || 1.5) + 0.5) continue;
      if (o.destroy) o.destroy(this, 'ram'); else o.takeDamage?.(KILL, this, 'ram');
      o.destroyed = true;
      this.world.events.emit('structure:destroyed', { id: o.tag ?? o.id, type: o.interactKind || 'barrier', owner: this });
    }
  }

  // ---------------------------------------------------------------- run-over (§3.7 ATROPELLO) and trains

  /** Units on foot inside an oriented box [from..to] ahead of (x, z, h), ±half across. */
  _unitsInBox(from, to, half, x = this.x, z = this.z, h = this.heading) {
    const w = this.world;
    if (!w) return [];
    const c = Math.cos(h), s = Math.sin(h);
    const r = Math.max(Math.abs(from), Math.abs(to)) + half;
    return w.entitiesInRadius(x, z, r, (u) => (u.kind === 'commando' || u.kind === 'enemy') && u.alive
      && !u.vehicle && u.state !== 'inVehicle' && !u.underwater && !((u.y || 0) > 1.5)).filter((u) => {
      const dx = u.x - x, dz = u.z - z;
      const along = dx * c + dz * s, across = -dx * s + dz * c;
      return along >= from && along <= to && Math.abs(across) <= half;
    });
  }

  /**
   * §3.7: at fast speed (actual speed ≥ CONFIG.vehicles.runoverSpeedFrac × def.fast) anyone on foot in the front sensor box (1.8–5.4 m ahead, ±1.35 m) dies silently,
   * friends included. At slow speed enemies step aside, turn and shoot (a commando driver taints it).
   */
  _runover() {
    const [from, to, half] = CONFIG.vehicles.runoverBox;
    const dir = this.reversing ? Math.PI : 0;
    // The kill needs the vehicle actually travelling at fast speed, not just a fast order: a truck
    // still accelerating from standstill applies the slow-speed rule.
    const lethal = this.fast && this.speed >= (this.def.fast || 0) * CONFIG.vehicles.runoverSpeedFrac;
    for (const u of this._unitsInBox(from, to, half, this.x, this.z, this.heading + dir)) {
      if (lethal) {
        u.die?.('runover', this.driver || this);
        this.world.events.emit('vehicle:runover', { vehicle: this, victim: u });
      } else if (u.kind === 'enemy') {
        if (u.stepAside && this.world.time < u.stepAside.until && u.path) continue; // already on his way out
        const side = this.heading + Math.PI / 2;
        const sgn = (-(u.x - this.x) * Math.sin(this.heading) + (u.z - this.z) * Math.cos(this.heading)) >= 0 ? 1 : -1;
        const D = CONFIG.vehicles.runoverDodge;
        const nx = u.x + Math.cos(side) * D * sgn, nz = u.z + Math.sin(side) * D * sgn, g = this.world.grid;
        // he runs there (straight, over walkable ground), then turns to face it — never a jump
        const hd = angleTo(nx, nz, this.x, this.z);
        if (u.state === 'active' && g.walkableAt(nx, nz) && g.walkableLine(u.x, u.z, nx, nz)
          && u.walkStraight?.(nx, nz, { run: true, onArrive: () => { u.heading = hd; } })) u.stepAside = { by: this, until: this.world.time + 2.5 };
        else u.heading = angleTo(u.x, u.z, this.x, this.z);
        if (this.driver && this.driver.faction === 'player') this.taint(u);
      }
    }
  }

  /** At run-over speed now (§3.7: a fast order AND the actual speed ≥ runoverSpeedFrac × fast)? */
  _lethal() {
    return !!this.def.runover && this.fast && this.speed >= (this.def.fast || 0) * CONFIG.vehicles.runoverSpeedFrac;
  }

  _runoverKill(u) {
    if (!u.alive) return;
    u.die?.(this.def.rail ? 'train' : 'runover', this.driver || this);
    this.world.events.emit('vehicle:runover', { vehicle: this, victim: u });
  }

  /**
   * A man in the way of a non-lethal move: the vehicle waits (blockedT); the player's straight drive gives up
   * (halts) after 1.5 s so a man lying in the way does not leave the order hanging.
   */
  _bodyBlocked(g, dt) {
    this.speed = 0;
    this.blockedT = (this.blockedT || 0) + dt;
    if (g?.strict && this.blockedT > 1.5) { this.blockedT = 0; this._halt(); }
  }

  /**
   * §3.7 slow rule for men the hull would touch: an enemy of the other side on his feet steps aside — he walks
   * (runs) straight to a free spot beside the hull placed at (x, z, h), over walkable ground, and turns to face it (a
   * commando driver taints him); the vehicle waits for him meanwhile. Returns who is still in the way: friends, men
   * lying down, men stepping aside and anyone with no free spot beside the hull — the vehicle stops for them.
   */
  _stepAside(under, x, z, h) {
    if (!under.length) return under;
    const R = hullRect(this, x, z, h), c = Math.cos(h), s = Math.sin(h), w = this.world;
    const side = this.driver?.faction ?? this.faction ?? 'enemy';
    return under.filter((u) => {
      if (u.kind !== 'enemy' || u.faction === side || u.stance === 'crawl' || u.stance === 'downed' || u.state !== 'active') return true;
      if (u.stepAside?.by === this && w.time < u.stepAside.until && u.path) return true; // on his way out
      const dx = u.x - x, dz = u.z - z, along = dx * c + dz * s, lat = -dx * s + dz * c;
      const off = R.hw + bodyShape(u.stance).r + 0.25;
      for (const sg of lat >= 0 ? [1, -1] : [-1, 1]) {
        const px = x + c * along - s * sg * off, pz = z + s * along + c * sg * off;
        if (!w.grid.walkableAt(px, pz) || !w.grid.walkableLine(u.x, u.z, px, pz)) continue;
        const hd = angleTo(px, pz, x, z);
        if (capsuleRectGap(bodyCapsule(px, pz, hd, u.stance), R) < 0.1 || bodyGap(w, px, pz, hd, u.stance, this) < 0.1) continue;
        if (!u.walkStraight?.(px, pz, { run: true, onArrive: () => { u.heading = hd; } })) continue;
        u.stepAside = { by: this, until: w.time + 2.5 };
        if (this.driver && this.driver.faction === 'player') this.taint(u);
        return true;
      }
      return true;
    });
  }

  /**
   * Men on foot whose body (world/body-clearance.js: a disc standing, a capsule along the heading lying down) would be
   * within `margin` of this hull placed at (x, z, h).
   */
  _bodiesUnder(x, z, h, margin = 0.05) {
    const w = this.world;
    if (!w || !isSolidHull(this)) return [];
    const R = hullRect(this, x, z, h);
    const reach = Math.hypot(R.hl, R.hw) + 1.2 + margin;
    return w.entitiesInRadius(x, z, reach, (u) => (u.kind === 'commando' || u.kind === 'enemy') && u.alive
      && !u.vehicle && u.state !== 'inVehicle' && u.state !== 'carried' && !u.underwater && !((u.y || 0) > 1.5)
      && u.stance !== 'swim' && u.stance !== 'dive')
      .filter((u) => capsuleRectGap(bodyCapsule(u.x, u.z, u.heading, u.stance), R) < margin);
  }

  /** Kill box of a rail vehicle (§3.7 [data] train: −31.5..+16 m along, ±3.4 m). */
  get killBox() {
    if (this.def.type === 'train') return CONFIG.vehicles.train.box;
    const [l, w] = this.def.size;
    return [-l / 2, l / 2 + 1, w / 2 + 0.2];
  }

  /**
   * Trains and trams (§3.7, §7.1 M4/M15): follow `spawn.track` (polyline, points may carry `wait`) on a
   * periodic `schedule` {period, speed, delay, mode:'once'|'pingpong'}. 'once' (train): appears, runs the
   * track, disappears, repeats every period. Kills everything on foot in the kill box; stops while a
   * vehicle is on the track ahead (the M4 motorcycle trick).
   */
  _updateRail(dt) {
    const track = this.track;
    if (!track || track.length < 2) return;
    const S = this.schedule;
    if (!this.railRunning) {
      this.railT -= dt;
      if (this.railT > 0) return;
      this.railRunning = true;
      this.hiddenRail = false;
      if (this.object3d) this.object3d.visible = true;
      this.railS = this.railDir > 0 ? 0 : this.trackLen;
      this._placeOnTrack();
      this.world?.events.emit('train:pass', { train: this });
      this.world?.events.emit('vehicle:move', { vehicle: this, speed: S.speed });
    }
    if (this.waitT > 0) { this.waitT -= dt; this.speed = 0; return; }
    const [from, to, half] = this.killBox;
    // A vehicle standing on the track ahead stops the train (§3.7).
    // `harmless` rail types (cable car, mine cart) run overhead / on their own rails: no kill box, never blocked.
    const harmless = !!this.def.harmless;
    const blocker = !harmless && this.world.vehicles.find((v) => v !== this && !v.removed && !v.def.rail && !v.destroyed
      && this._inBoxOf(v.x, v.z, 0, to + 1, half + Math.max(...v.def.size) / 2));
    // §7.1 M15: a tram with `accident` hitting a tanker blows it up as an "accident" (no alarm noise)
    if (blocker && blocker.def.tanker && (this.spawn.accident || this.schedule.accident)) {
      blocker.spawn.accident = true;
      blocker.destroy(this, 'accident');
    } else if (blocker) { if (this.speed > 0) this.world.events.emit('vehicle:stop', { vehicle: this }); this.speed = 0; return; }
    // §7.1 M18 damaged track (MISSIONS set-piece `rail_line`: a grenade on the rails): world.railBlocks [{x,z,r,active}]
    const rb = !harmless && this.world.railBlocks?.find((b) => b.active !== false && this._inBoxOf(b.x, b.z, 0, to + 1 + (b.r ?? 1), half + (b.r ?? 1)));
    if (rb) { if (this.speed > 0) this.world.events.emit('vehicle:stop', { vehicle: this }); this.speed = 0; return; }
    this.speed = S.speed;
    const prevS = this.railS;
    this.railS += this.railDir * S.speed * dt;
    // station stops (track points with `wait`)
    for (const p of this.trackStops) {
      if ((prevS - p.s) * (this.railS - p.s) < 0 || this.railS === p.s) { this.railS = p.s; this.waitT = p.wait; break; }
    }
    const end = this.railDir > 0 ? this.railS >= this.trackLen : this.railS <= 0;
    this.railS = Math.max(0, Math.min(this.trackLen, this.railS));
    this._placeOnTrack();
    for (const u of harmless ? [] : this._unitsInBox(from, to, half)) {
      u.die?.('train', this);
      this.world.events.emit('vehicle:runover', { vehicle: this, victim: u });
    }
    // …and anyone whose body reaches under the hull (a crawler's legs beside the rails)
    for (const u of this._bodiesUnder(this.x, this.z, this.heading, 0)) this._runoverKill(u);
    if (end) {
      if (S.mode === 'pingpong') { this.railDir = -this.railDir; this.waitT = S.endWait ?? 5; return; }
      this.railRunning = false;
      this.hiddenRail = true;
      this.speed = 0;
      if (this.object3d) this.object3d.visible = false;
      this.railT = S.period;
      this.world.events.emit('vehicle:stop', { vehicle: this });
    }
  }

  _inBoxOf(x, z, from, to, half) {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const dx = x - this.x, dz = z - this.z;
    const along = dx * c + dz * s, across = -dx * s + dz * c;
    return along >= from && along <= to && Math.abs(across) <= half;
  }

  /** Set up track geometry (called from the constructor for rail types). */
  _initRail(spawn) {
    this.track = (spawn.track || []).map((p) => (Array.isArray(p) ? { x: p[0], z: p[1], y: p[2] ?? null, wait: 0 } : { x: p.x, z: p.z, y: p.y ?? null, wait: p.wait || 0 }));
    const T0 = CONFIG.vehicles.trainSchedule;
    const sc = spawn.schedule || {};
    this.schedule = { period: sc.period ?? T0.period, speed: sc.speed ?? T0.speed, delay: sc.delay ?? T0.delay,
      mode: sc.mode ?? (this.def.type === 'train' ? 'once' : 'pingpong'), endWait: sc.endWait, accident: !!sc.accident };
    this.segLen = [];
    this.trackLen = 0;
    this.trackStops = [];
    for (let k = 0; k < this.track.length; k++) {
      if (k > 0) {
        const a = this.track[k - 1], b = this.track[k];
        this.segLen.push(Math.hypot(b.x - a.x, b.z - a.z));
        this.trackLen += this.segLen[k - 1];
      }
      if (this.track[k].wait > 0 && k > 0 && k < this.track.length - 1) this.trackStops.push({ s: this.trackLen, wait: this.track[k].wait });
    }
    this.railDir = 1;
    this.railS = 0;
    this.railT = this.schedule.delay;
    this.railRunning = false;
    // A 'once' train is off-map between passes; a tram is always visible.
    this.hiddenRail = this.schedule.mode === 'once';
    if (this.hiddenRail && this.object3d) this.object3d.visible = false;
    if (this.track.length >= 2) this._placeOnTrack();
    if (this.schedule.mode !== 'once') { this.railT = sc.delay ?? 0; } // pingpong: docked at the start for `delay` s
  }

  _placeOnTrack() {
    let s = this.railS, k = 0;
    while (k < this.segLen.length - 1 && s > this.segLen[k]) { s -= this.segLen[k]; k++; }
    const a = this.track[k], b = this.track[k + 1];
    const f = this.segLen[k] > 0 ? Math.min(1, s / this.segLen[k]) : 0;
    this.x = a.x + (b.x - a.x) * f;
    this.z = a.z + (b.z - a.z) * f;
    if (a.y != null && b.y != null) this.y = a.y + (b.y - a.y) * f; // cable car: height along the cable
    this.heading = angleTo(a.x, a.z, b.x, b.z) + (this.railDir < 0 ? Math.PI : 0);
  }

  // ---------------------------------------------------------------- weapons (§3.7 armed vehicles, Ctrl+click)

  /** Who gets the credit / is the shooter for kills: the commando operator, else the vehicle. */
  get shooter() { return this.driver || this; }

  /** Weapon to use against a target at distance d (tank: MG inside the cannon's 13.5 m minimum). */
  weaponFor(d, pref = null) {
    const W = CONFIG.weapons;
    const list = this.def.weapons || [];
    if (pref && list.includes(pref)) return pref;
    for (const id of list) {
      if (id === 'torpedo') return this.torpedoes > 0 ? id : null;
      const w = W[id];
      if (!w) continue;
      if (w.minRange && d < w.minRange) continue;
      if (w.range && d > w.range) continue;
      return id;
    }
    return null;
  }

  /** Traverse limit (giro): may the gun point at heading h? Around the post heading for an emplacement,
   *  around the current heading for a moving mount (boat MG 'facing travel', §7.5). */
  /**
   * Traverse arc of this vehicle's gun over the static scene (world/placement.js turretArc): lift per angle,
   * Infinity where the barrel would pass through a wall / building. Lazy; recomputed when the grid changes or
   * the hull moves. null for guns without a model barrel (no `model.gun`).
   */
  gunArc() {
    const w = this.world, g = this.model?.gun;
    if (!w?.grid || !g || this.destroyed) return null;
    const key = `${w.grid.version}|${this.x.toFixed(1)}|${this.z.toFixed(1)}|${(this.y || 0).toFixed(1)}`;
    if (this._arcKey !== key) {
      this._arcKey = key;
      // the hull itself is never in block / navBlock (vehicles stamp the dynamic layer only): nothing to skip
      this._arc = turretArc(w.grid, this.x, this.z, { len: g.len, h: g.h, back: g.back, housing: g.hl ? { hl: g.hl, hw: g.hw, top: g.top } : null, heightOf: ownerHeight(w), y0: Math.max(this.y || 0, this._groundAt(this.x, this.z)) }); // y: a hull on a ridge / deck (M11)
    }
    return this._arc;
  }

  canTraverse(h) {
    const arc = this.gunArc();
    if (arc && liftAt(arc, h) === Infinity) return false;
    if (this.giro == null || this.giro >= 360) return true;
    const ref = this.vehicleKind === 'emplacement' ? this.postHeading : this.heading;
    return Math.abs(angleDiff(ref, h)) <= (this.giro * DEG) / 2 + 1e-6;
  }

  /** Visual muzzle {x, y, z} of weapon `id` on the model (VFX flash only; gameplay keeps muzzleToward), or null. */
  _muzzleFx(id) {
    const m = this.model;
    if (!m?.muzzleWorld) return null;
    m.setTurretHeading?.(this.turretHeading - this.heading);
    return m.muzzleWorld(id, this);
  }

  /** Muzzle point: hull edge toward (x, z), so the own hull (stamped as occluder) doesn't block the shot. */
  muzzleToward(x, z) {
    const h = angleTo(this.x, this.z, x, z);
    const r = Math.min(this.def.size[0], this.def.size[1]) / 2 + 0.4;
    const c = Math.cos(h - this.heading), s = Math.sin(h - this.heading);
    const [l, w] = this.def.size;
    const t = Math.min(Math.abs(c) > 1e-6 ? (l / 2) / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? (w / 2) / Math.abs(s) : Infinity);
    const d = Math.max(r, t + 0.3);
    return { x: this.x + Math.cos(h) * d, z: this.z + Math.sin(h) * d };
  }

  /**
   * Fire the vehicle / emplacement weapon (Ctrl+click §3.7, AI) at an entity or {x, z}.
   * MG types fire bursts (tankMg: 10 rounds at 10 rounds/s, 0.25 s pause); the cannon a `shell`
   * (reload 1.5 s, minimum 13.5 m); the mini-sub a torpedo straight along its heading.
   * @param {object} target entity or point @param {{weapon?: string}} [o]
   * @returns {boolean} fired (or queued)
   */
  fireAt(target, o = {}) {
    const w = this.world;
    if (!w || this.destroyed || !target || !this.def.weapons?.length) return false;
    if (!this.driver && !this.crewed) return false; // nobody at the gun
    if (target === this || this.occupants.includes(target)) return false;
    const d = Math.hypot(target.x - this.x, target.z - this.z);
    const id = this.weaponFor(d, o.weapon);
    if (!id) return false;
    const h = angleTo(this.x, this.z, target.x, target.z);
    if (id !== 'torpedo' && !this.canTraverse(h)) return false;
    if ((this.weaponCd[id] || 0) > 0 || (this.volley && id !== 'cannon' && id !== 'torpedo')) return false;
    const W = CONFIG.weapons;
    if (id !== 'torpedo') this.turretHeading = h;
    w.events.emit('vehicle:fire', { vehicle: this, target, weapon: id, muzzle: this._muzzleFx(id) });
    if (id === 'cannon') {
      const m = this.muzzleToward(target.x, target.z);
      w.add(new Projectile('shell', { from: m, to: { x: target.x, z: target.z }, source: this.shooter, vehicle: this }));
      this.weaponCd.cannon = W.cannon.reload;
      w.emitNoise(this.x, this.z, W.cannon.noise, W.cannon.noiseKind, this.shooter);
      return true;
    }
    if (id === 'torpedo') {
      const R = CONFIG.vehicles.torpedo;
      const m = this.muzzleToward(this.x + Math.cos(this.heading) * 10, this.z + Math.sin(this.heading) * 10);
      w.add(new Projectile('torpedo', {
        from: m, to: { x: m.x + Math.cos(this.heading) * R.range, z: m.z + Math.sin(this.heading) * R.range }, source: this.shooter, vehicle: this,
      }));
      this.torpedoes--;
      this.weaponCd.torpedo = 1.0;
      return true;
    }
    const wd = W[id];
    this.volley = { id, target, left: wd.rounds || 1, t: 0, interval: 1 / (wd.roundRate || 20) };
    w.emitNoise(this.x, this.z, wd.noise, wd.noiseKind || 'mg', this.shooter);
    return true;
  }

  /** Cooldowns and burst rounds (hitscan, deterministic hits like every BEL gun §4.1). */
  _updateWeapons(dt) {
    for (const k in this.weaponCd) if (this.weaponCd[k] > 0) this.weaponCd[k] -= dt;
    const v = this.volley;
    if (!v) return;
    v.t -= dt;
    while (v.t <= 0 && v.left > 0) {
      this._fireRound(v.id, v.target);
      v.left--;
      v.t += v.interval;
    }
    if (v.left <= 0) {
      this.volley = null;
      this.weaponCd[v.id] = CONFIG.weapons[v.id].cadence ?? 0.25;
    }
  }

  /** One MG round at the target (entity → hits it if still in range and in LOS; point → first thing there). */
  _fireRound(id, target) {
    const w = this.world;
    const wd = CONFIG.weapons[id];
    let tgt = target;
    if (tgt && tgt.alive === false && tgt.kind !== 'vehicle') tgt = null;
    if (tgt && !('kind' in tgt)) tgt = pointTarget(w, tgt.x, tgt.z, this);
    const aim = tgt || target;
    const m = this.muzzleToward(aim.x, aim.z);
    const d = Math.hypot(aim.x - this.x, aim.z - this.z);
    let hit = false;
    // the gun looks out from the hull's own height (a hull on a ridge fires down over the rim, M11 quarry);
    // never up: targetY is left out, so raised cells above the hull (a bunker roof, a cliff) still block (M11 D4)
    if (tgt && d <= wd.range + 0.5 && w.grid.lineOfSight(m.x, m.z, ...edgePoint(tgt, m), { dynamic: tgt.kind !== 'vehicle', viewerY: this.y || 0 })) {
      hit = true;
      if (tgt.kind === 'vehicle') tgt.takeDamage(wd.dmg, this.shooter, id);
      else if (tgt.explodeBarrel || tgt.barrel) hitBarrel(w, tgt, this.shooter);
      else tgt.takeDamage?.(wd.dmg, this.shooter, id);
    }
    w.events.emit('shot', { from: m, to: { x: aim.x, z: aim.z }, shooter: this.shooter, target: tgt, hit, weapon: id, muzzle: this._muzzleFx(id) });
    if (!hit) w.events.emit('hit', { x: aim.x, z: aim.z, surface: 'ground', target: null, weapon: id });
  }

  // ---------------------------------------------------------------- damage (§3.7 .IMPACTOS, §3.6)

  /**
   * Damage entry point (world.damageRadius, weapons). Bullet causes count hits against the type's
   * budget; explosion causes go through explosionHit(). Occupants are protected by the hull.
   * @param {number} amount @param {any} source @param {string} cause weapon id / explosion class
   */
  takeDamage(amount, source, cause = 'bullet') {
    if (this.destroyed || this.def.kind === 'rail') return;
    if (EXPLOSION_CAUSES.has(cause)) {
      const cls = cause === 'explosion' ? (amount >= KILL ? 'bomb' : 'grenade') : cause === 'timeBomb' || cause === 'remoteBomb' ? 'bomb' : cause;
      this.explosionHit(cls, source);
      return;
    }
    this.bulletHit(source, cause);
  }

  /** One bullet / MG round (§3.7): tanker explodes, raft deflates after 3, tanks immune, others count hits. */
  bulletHit(source, cause = 'bullet') {
    if (this.destroyed) return;
    const w = this.world;
    const D = this.def;
    w?.events.emit('hit', { x: this.x, z: this.z, surface: D.raft ? 'rubber' : 'metal', target: this, weapon: cause });
    if (D.tanker) { this.destroy(source, cause); return; }
    if (D.raft) {
      if (++this.raftHits >= CONFIG.vehicles.raftHits) this.destroy(source, 'deflated');
      return;
    }
    if (this.bulletImmune || D.hits == null || D.hits === 0) return;
    this.hits++;
    if (this.hits >= D.hits) this.destroy(source, cause);
  }

  /**
   * Explosion of class `cls` reached the hull (§3.6/§3.7): grenade/barrel/vehicle blasts destroy
   * unarmoured and light-armour (Panzer II, SdKfz) vehicles; bombs and shells destroy everything but trains.
   */
  explosionHit(cls, source) {
    if (this.destroyed || this.def.kind === 'rail') return false;
    const heavy = this.def.armor === 'heavy' || CONFIG.vehicles.heavyArmor.includes(this.def.type);
    const strong = cls === 'bomb' || cls === 'shell' || cls === 'torpedo';
    if (heavy && !strong) return false;
    this.destroy(source, cls);
    return true;
  }

  /**
   * Destroy: crew and occupants die, the hull blows up as a `vehicle` explosion (+ `barrel` for the tanker,
   * §3.6); a raft just deflates (occupants dumped). The wreck burns 20 s then stays as a B.HIGH obstacle.
   */
  destroy(source = null, cause = null) {
    if (this.destroyed) return;
    const w = this.world;
    this.destroyed = true;
    this.alive = false;
    this.hp = 0;
    this.path = null;
    this.goal = null;
    this.speed = 0;
    this.volley = null;
    for (const c of this.crew) {
      const u = c.alive ? this.linkedCrew(c) : null;
      c.alive = false;
      if (u && u.alive !== false && u.state !== 'jailed') u.die?.('explosion', source); // linked crew go down with the hull
    }
    const deflate = this.def.raft && cause === 'deflated';
    for (const u of [...this.occupants]) {
      this.exit(u, undefined, undefined, { force: true });
      if (!deflate) u.die?.('explosion', source);
    }
    this.model.setDestroyed?.(true);
    w?.events.emit('vehicle:destroyed', { vehicle: this, source, cause });
    if (!w) return;
    if (deflate || this.def.raft) return;
    const accident = !!this.spawn.accident;
    if (this.def.kind !== 'emplacement') {
      this.burning = true;
      this.wreckT = 0;
      w.events.emit('fire', { x: this.x, z: this.z, on: true });
      explode(w, this.x, this.z, 'vehicle', source, { exclude: this, accident });
      if (this.def.tanker) explode(w, this.x, this.z, 'barrel', source, { exclude: this, accident, silent: true });
    }
  }

  /** Burning wreck (§3.6 fire 100/s within its cells) → then baked into the static grid as B.HIGH. */
  _updateWreck(dt) {
    if (!this.burning || !this.world) return;
    this.wreckT += dt;
    const w = this.world;
    const R = CONFIG.vehicles.wreckFireRadius;
    for (const u of w.entitiesInRadius(this.x, this.z, Math.max(...this.def.size) / 2 + R, (e) => (e.kind === 'commando' || e.kind === 'enemy') && e.alive)) {
      if (this._inHull(u.x, u.z, R - 1)) u.takeDamage?.(CONFIG.weapons.fire.dps * dt, this, 'fire');
    }
    if (this.wreckT >= CONFIG.vehicles.wreckBurn) {
      this.burning = false;
      w.events.emit('fire', { x: this.x, z: this.z, on: false });
      this._bakeWreck();
    }
  }

  _bakeWreck() {
    if (this.wreckBaked || !this.world || this.def.kind === 'boat') return;
    this.wreckBaked = true;
    this.world.grid.fillOrientedRect(this.x, this.z, this.def.size[0], this.def.size[1], this.heading, 'block', B.HIGH, `wreck:${this.id}`);
  }

  /** Stamp the hull into grid.dynamicBlock (§4.2 OCLU); called by World.refreshDynamicOccluders(). */
  stampOccluder(grid) {
    if (!this.def.occludes || this.removed || this.hiddenRail || this.wreckBaked) return;
    grid.stampDynamic(this.x, this.z, this.def.size[0], this.def.size[1], this.heading);
  }

  // ---------------------------------------------------------------- save / load

  serialize() {
    return {
      ...super.serialize(), vehicleType: this.vehicleType, hp: this.hp, hits: this.hits, raftHits: this.raftHits,
      tainted: this.tainted, destroyed: this.destroyed, used: this.used, torpedoes: this.torpedoes,
      wreckT: this.wreckT, burning: this.burning, ...(this.blastFlip ? { blastFlip: { ...this.blastFlip, t0: -1e3 } } : null), passedExit: !!this.passedExit, drivenOff: !!this.drivenOff, crew: this.crew.map((c) => c.alive),
      // a save taken after a load but before the first tick still carries the not-yet-relinked occupants
      occupants: this._pendingOccupants ? [...this._pendingOccupants.ids] : this.occupants.map((u) => u.id),
      driver: this._pendingOccupants ? this._pendingOccupants.driver ?? null : this.driver?.id ?? null,
      rail: this.def.rail ? { s: this.railS, t: this.railT, dir: this.railDir, running: this.railRunning } : null,
      // drive state (§10 a quickload replays identically): the exact leg, waypoint, remaining wait, speed
      drive: {
        path: this.path ? this.path.map((p) => ({ ...p })) : null, pathIndex: this.pathIndex,
        goal: this.goal ? { ...this.goal } : null, waitT: this.waitT, speed: this.speed, fast: this.fast,
        maxSpeed: this.maxSpeed ?? null, blockedT: this.blockedT || 0, ramDrag: this.ramDrag || 0, turretHeading: this.turretHeading,
        weaponCd: { ...this.weaponCd },
      },
      brain: this.brain?.serialize?.() ?? null,
    };
  }

  deserialize(d) {
    super.deserialize(d);
    this.blastFlip = d.blastFlip ? { ...d.blastFlip } : null; // a wreck thrown over stays over (visual, bodies §A.7)
    this.hp = d.hp ?? this.hp;
    this.hits = d.hits ?? 0;
    this.raftHits = d.raftHits ?? 0;
    this.tainted = !!d.tainted;
    this.used = !!d.used;
    this.passedExit = !!d.passedExit; // §8.1 extraction latch (core/objectives)
    this.drivenOff = !!d.drivenOff;
    this.torpedoes = d.torpedoes ?? this.torpedoes;
    if (Array.isArray(d.crew)) d.crew.forEach((a, k) => { if (this.crew[k]) this.crew[k].alive = a; });
    if (d.rail && this.def.rail) {
      Object.assign(this, { railS: d.rail.s, railT: d.rail.t, railDir: d.rail.dir, railRunning: d.rail.running });
      this.hiddenRail = !d.rail.running && this.schedule?.mode === 'once';
      if (this.object3d) this.object3d.visible = !this.hiddenRail;
    }
    if (d.destroyed && !this.destroyed) {
      this.destroyed = true;
      this.alive = false;
      this.model.setDestroyed?.(true);
      this.burning = !!d.burning;
      this.wreckT = d.wreckT ?? 0;
      if (!this.burning && !this.def.raft) this._bakeWreck();
    }
    if (d.drive) this._restoreDrive(d.drive);
    if (d.brain) this.brain?.deserialize?.(d.brain, !!d.drive);
    // occupants are re-linked on the next update (the units may be deserialized after the vehicle)
    this._pendingOccupants = Array.isArray(d.occupants) && d.occupants.length ? { ids: d.occupants, driver: d.driver } : null;
  }

  /** Restore the exact scripted-route / drive state saved by serialize() (no re-planning). */
  _restoreDrive(D) {
    this.path = Array.isArray(D.path) ? D.path.map((p) => ({ ...p })) : null;
    this.pathIndex = D.pathIndex ?? 0;
    this.goal = D.goal ? { ...D.goal } : null;
    this.waitT = D.waitT ?? 0;
    this.speed = D.speed ?? 0;
    this.fast = !!D.fast;
    if (D.maxSpeed != null) this.maxSpeed = D.maxSpeed;
    this.blockedT = D.blockedT || 0;
    this.ramDrag = D.ramDrag || 0; // gate smash re-acceleration drag (world/breakables.js)
    if (Number.isFinite(D.turretHeading)) this.turretHeading = D.turretHeading;
    if (D.weaponCd) this.weaponCd = { ...D.weaponCd };
  }

  /** Re-attach saved occupants by id (save games). */
  _relinkOccupants() {
    const p = this._pendingOccupants;
    this._pendingOccupants = null;
    if (!p || !this.world) return;
    this.occupants = p.ids.map((id) => this.world.byId(id)).filter(Boolean);
    for (const u of this.occupants) {
      u.vehicle = this;
      u.state = 'inVehicle';
      if (u.object3d) u.object3d.visible = false;
    }
    this.driver = this.occupants.find((u) => u.id === p.driver) || this.occupants.find((u) => this.canOperate(u)) || null;
  }
}

/** Causes that are explosions (everything else hitting a vehicle is a bullet / MG round). */
const EXPLOSION_CAUSES = new Set(['explosion', 'grenade', 'bomb', 'timeBomb', 'remoteBomb', 'shell', 'vehicle', 'barrel', 'torpedo']);

/** First thing at a clicked point for a round: unit, vehicle hull or barrel within 1 m. */
function pointTarget(world, x, z, self) {
  const near = world.entitiesInRadius(x, z, 8, (e) => e !== self && !e.removed && (
    ((e.kind === 'commando' || e.kind === 'enemy') && e.alive && !e.vehicle && Math.hypot(e.x - x, e.z - z) < 1)
    || (e.kind === 'vehicle' && !e.destroyed && !e.hiddenRail && e._inHull(x, z, 0.5))
    || ((e.barrel || e.explodeBarrel) && !e.destroyed && Math.hypot(e.x - x, e.z - z) < 1)));
  near.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  return near[0] || null;
}

/** Point of `tgt` to trace a shot to from `from` (vehicle: the hull edge facing the shooter). */
function edgePoint(tgt, from) {
  if (tgt.kind !== 'vehicle') return [tgt.x, tgt.z];
  const m = tgt.muzzleToward(from.x, from.z);
  return [m.x, m.z];
}

/** Factory installed as world.vehicleFactory by the Game. */
export function createVehicle(spawn) {
  return new Vehicle(spawn);
}

export default Vehicle;
