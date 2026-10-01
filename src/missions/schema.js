/**
 * Mission schema normalizer (design-spec §7.3 + ARCHITECTURE § Missions). Validates a mission def and
 * returns a NEW object with every §7.3 field present and defaulted, so systems never need `?.`/`??` on
 * mission data. Used by Game.loadMission and map-builder (idempotent: normalizing a normalized def
 * returns it unchanged). Legacy ARCHITECTURE forms are accepted and converted:
 *   route: [{x,z,wait,look}] + routeMode   → route: {type:'PINGPONG'|'LOOP', vel, points}
 *   post: {scan, period}                  → post: {heading, sweep, period, scan}
 *   extraction: {x, z, r}                 → extraction: {zone:{x,z,r}, x, z, r}
 *   par: {time, kills}                    → par: {time}  (kills are not scored, §8.2)
 * Pure module (no three.js).
 * @module missions/schema
 */
import { validateRoads } from '../world/roads.js';

import { footprintConflicts } from '../world/placement.js';

import { ACTION_VERBS } from './setpiece-actions.js';

export const CAMPAIGN_IDS = Object.freeze(['BEL', 'BCD']);
export const SOLDIER_TYPES = Object.freeze(['sentry', 'soldier', 'sergeant', 'trooper', 'mg', 'officer', 'truckDriver',
  'courier', 'crew', 'gunner', 'engineer', 'general', 'dog', 'tutorial',
  'gestapo', 'lieutenant', 'zookeeper', 'snitch', 'pow', 'lion', 'ostrich', 'chicken']); // BCD types (bcd-plan §1.9)
export const ROUTE_TYPES = Object.freeze(['LOOP', 'PINGPONG', 'STOPPED', 'EXIT']);
export const COMMANDO_ROLES = Object.freeze(['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy', 'guest', 'natasha', 'skopje']);
/** Data that only exists under the BCD ruleset (validateMission warns when a non-BCD mission uses it). */
export const BCD_ONLY = Object.freeze({
  soldierTypes: ['gestapo', 'lieutenant', 'zookeeper', 'snitch', 'pow', 'lion', 'ostrich', 'chicken'],
  roles: ['natasha', 'skopje'],
  interactables: ['seaMine', 'pushable', 'lift', 'drawbridge', 'drawbridgeSwitch', 'knapsack', 'penGate'],
});

/** §4.1 per-type behaviour flag defaults (per-spawn `flags` override). */
export function defaultFlags(soldierType, hasRoute) {
  const holds = ['sentry', 'mg', 'gunner', 'crew', 'officer', 'general', 'truckDriver'].includes(soldierType) && !hasRoute;
  return {
    holdsPost: holds,
    investigates: !holds,
    followsTracks: hasRoute || !holds, // patrols SIGUEHUELLAS 1; investigating types too
    ignoresBodies: ['crew', 'gunner', 'officer', 'general', 'truckDriver'].includes(soldierType),
    raisesAlarmOnSight: false,
    firesOnSight: ['mg', 'crew', 'gunner', 'dog'].includes(soldierType),
  };
}

const NORMALIZED = Symbol('normalizedMission');

/** Mission arrays whose entries may carry `only: 'easy' | 'hard'` (BCD difficulty variants). */
const VARIANT_LISTS = ['enemies', 'vehicles', 'interactables', 'items', 'commandos', 'structures'];

/**
 * BCD Easy/Hard (docs/bcd-plan.md §1.12): difficulty is DATA. A def may carry `variants: {easy: {...}, hard: {...}}`
 * and list entries tagged `only: 'easy' | 'hard'`. For a difficulty this returns a new def where:
 *   - tagged entries of the other difficulty are dropped (extra guards / removals, per-variant object positions);
 *   - the variant patch is merged: `par`, `enemyPatch: {id: {...fields}}` (new facing, sweep, route type…),
 *     `routeSpeedMul` (route `vel` × mul) and `pauseMul` (waypoint waits × mul), any other key overrides.
 * A def without variants / tags, or a null difficulty on such a def (→ 'hard', the retail base), is returned as is
 * when there is nothing to do — so every BEL mission passes through untouched.
 * @param {object} def
 * @param {'easy'|'hard'|null} difficulty
 */
export function applyVariant(def, difficulty) {
  if (!def || typeof def !== 'object') return def;
  const tagged = VARIANT_LISTS.some((k) => Array.isArray(def[k]) && def[k].some((e) => e && e.only));
  if (!def.variants && !tagged) return def;
  const d = difficulty === 'easy' ? 'easy' : 'hard';
  const out = { ...def, difficulty: d };
  delete out.variants;
  for (const k of VARIANT_LISTS) {
    if (!Array.isArray(def[k])) continue;
    out[k] = def[k].filter((e) => !e?.only || e.only === d).map((e) => {
      if (!e?.only) return e;
      const { only, ...rest } = e; // eslint-disable-line no-unused-vars
      return rest;
    });
  }
  const P = def.variants?.[d] || {};
  const { enemyPatch, routeSpeedMul, pauseMul, ...rest } = P;
  Object.assign(out, rest);
  if (enemyPatch || routeSpeedMul || pauseMul) {
    out.enemies = (out.enemies || []).map((e) => {
      let r = enemyPatch?.[e.id] ? { ...e, ...enemyPatch[e.id] } : e;
      if ((routeSpeedMul || pauseMul) && r.route) {
        const route = Array.isArray(r.route) ? { points: r.route } : { ...r.route };
        if (routeSpeedMul) route.vel = (route.vel ?? r.vel ?? 2) * routeSpeedMul;
        if (pauseMul && route.points) route.points = route.points.map((p) => (p.wait != null ? { ...p, wait: p.wait * pauseMul } : p));
        r = { ...r, route };
      }
      return r;
    });
  }
  return out;
}

/** Marker check. */
export function isNormalized(def) {
  return !!(def && def[NORMALIZED]);
}

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Validate a mission def. Never throws.
 * @param {object} def
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateMission(def) {
  const errors = [], warnings = [];
  if (!def || typeof def !== 'object') return { errors: ['mission def is not an object'], warnings };
  const id = def.id || '?';
  const E = (m) => errors.push(`[${id}] ${m}`), Wn = (m) => warnings.push(`[${id}] ${m}`);
  if (!def.id || typeof def.id !== 'string') E('missing string id');
  const size = def.size;
  const okSize = Array.isArray(size) && size.length === 2 && size.every((v) => typeof v === 'number' && v > 0);
  if (!okSize) E('size must be [W, D] metres > 0');
  if (def.campaign !== undefined && !CAMPAIGN_IDS.includes(def.campaign)) E(`unknown campaign "${def.campaign}"`);
  const [W, D] = okSize ? size : [Infinity, Infinity];
  const inMap = (x, z) => typeof x === 'number' && typeof z === 'number' && x >= 0 && z >= 0 && x <= W && z <= D;
  const ids = new Set();
  const addId = (v, what) => {
    if (v === undefined || v === null) return;
    if (ids.has(v)) E(`duplicate id "${v}" (${what})`);
    ids.add(v);
  };
  arr(def.commandos).forEach((c, i) => {
    if (!COMMANDO_ROLES.includes(c.role)) E(`commandos[${i}] unknown role "${c.role}"`);
    if (!inMap(c.x, c.z)) E(`commandos[${i}] position outside the map`);
    addId(c.id, 'commando');
  });
  arr(def.enemies).forEach((e, i) => {
    if (e.soldierType && !SOLDIER_TYPES.includes(e.soldierType)) Wn(`enemies[${i}] unknown soldierType "${e.soldierType}"`);
    if (!inMap(e.x, e.z)) E(`enemies[${i}] position outside the map`);
    addId(e.id, 'enemy');
    const r = e.route;
    if (r && !Array.isArray(r)) {
      if (r.type && !ROUTE_TYPES.includes(r.type)) E(`enemies[${i}].route.type "${r.type}"`);
      if (!Array.isArray(r.points)) E(`enemies[${i}].route.points must be an array`);
    }
    for (const p of (Array.isArray(r) ? r : r?.points) || []) if (!inMap(p.x, p.z)) Wn(`enemies[${i}] route point outside the map`);
  });
  arr(def.vehicles).forEach((v, i) => { addId(v.id, 'vehicle'); if (!inMap(v.x, v.z)) E(`vehicles[${i}] position outside the map`); });
  arr(def.enemies).forEach((e, i) => {
    if (e.vehicle != null && !arr(def.vehicles).some((v) => v.id === e.vehicle)) E(`enemies[${i}].vehicle "${e.vehicle}" names no vehicle`);
  });
  arr(def.structures).forEach((s, i) => {
    addId(s.id, 'structure');
    // explosive / carriable structures only exist as fuel drums (§3.6 barrel class), which the map builder
    // spawns as Barrel entities; any other explosive/carriable structure would be an inert prop
    const drum = s.type === 'barrels' && s.explosive === 'barrel';
    if (s.explosive != null && !drum) E(`structures[${i}] (${s.id ?? s.type}) explosive:${JSON.stringify(s.explosive)} is only supported as {type:'barrels', explosive:'barrel'}`);
    if (s.carriable && !drum) E(`structures[${i}] (${s.id ?? s.type}) carriable is only supported on explosive barrels`);
  });
  arr(def.zones).forEach((z, i) => {
    if (!z.id) E(`zones[${i}] missing id`);
    if (!Array.isArray(z.poly) || z.poly.length < 3) E(`zones[${i}] poly needs ≥ 3 points`);
  });
  arr(def.climbLinks).forEach((l, i) => {
    if (!Array.isArray(l.a) || !Array.isArray(l.b) || l.a.length < 2 || l.b.length < 2) E(`climbLinks[${i}] needs a:[x,z,y], b:[x,z,y]`);
    else if (!inMap(l.a[0], l.a[1]) || !inMap(l.b[0], l.b[1])) E(`climbLinks[${i}] endpoint outside the map`);
  });
  arr(def.ladders).forEach((l, i) => {
    if (!inMap(l.x, l.z) || !Array.isArray(l.top) || l.top.length < 2) E(`ladders[${i}] needs x, z and top:[x,z,y]`);
  });
  for (const j of arr(def.jails)) if (!arr(def.structures).some((s) => s.id === j)) Wn(`jail "${j}" is not a structure id`);
  // placement rule (c): building footprints must not overlap or crowd each other (eaves), nor sink into a deck
  for (const c of footprintConflicts(arr(def.structures))) {
    Wn(c.kind === 'overlap' ? `structures ${c.a} and ${c.b} overlap (footprints intersect)` : `structures ${c.a} and ${c.b} are ${c.gap} m apart: their eaves cross (keep ≥ 1.2 m or clipAllow)`);
  }
  // ABILITIES devices placed by the mission (switch, lever, valve, phone, clothesline, ammo, crate, jail, barrel…)
  if (def.interactables !== undefined && !Array.isArray(def.interactables)) E('interactables must be an array');
  if ((def.campaign ?? 'BEL') !== 'BCD') { // ruleset data guard: BCD-only types in a BEL mission
    arr(def.commandos).forEach((c, i) => { if (BCD_ONLY.roles.includes(c.role)) Wn(`commandos[${i}] role "${c.role}" exists only in campaign BCD`); });
    arr(def.enemies).forEach((e, i) => { if (BCD_ONLY.soldierTypes.includes(e.soldierType)) Wn(`enemies[${i}] soldierType "${e.soldierType}" exists only in campaign BCD`); });
    arr(def.interactables).forEach((it, i) => { const k = it?.interactKind || it?.kind; if (BCD_ONLY.interactables.includes(k)) Wn(`interactables[${i}] kind "${k}" exists only in campaign BCD`); });
  }
  arr(def.interactables).forEach((it, i) => {
    if (!(it?.interactKind || it?.kind)) E(`interactables[${i}] missing interactKind`);
    else if (!inMap(it.x, it.z)) E(`interactables[${i}] (${it.interactKind || it.kind}) outside the map`);
    if (it?.id != null) addId(it.id, 'interactable');
  });
  arr(def.objectives).forEach((o, i) => { if (!o.id) E(`objectives[${i}] missing id`); });
  // MISSIONS set-pieces (src/missions/setpieces.js): {type, id?, …}; triggers {on, do:[{verb…}]}
  if (def.setpieces !== undefined && !Array.isArray(def.setpieces)) E('setpieces must be an array');
  arr(def.setpieces).forEach((sp, i) => {
    if (!sp || typeof sp.type !== 'string') E(`setpieces[${i}] missing type`);
    if (sp?.id != null) addId(sp.id, 'setpiece');
  });
  if (def.triggers !== undefined && !Array.isArray(def.triggers)) E('triggers must be an array');
  arr(def.triggers).forEach((t, i) => {
    if (!t || typeof t.on !== 'string') E(`triggers[${i}] missing 'on'`);
    if (!Array.isArray(t?.do)) E(`triggers[${i}] 'do' must be an array of actions`);
    else t.do.forEach((a, k) => { if (!ACTION_VERBS.some((v) => a && a[v] !== undefined)) E(`triggers[${i}].do[${k}] unknown action`); });
  });
  if (def.script !== undefined && typeof def.script !== 'function') E('script must be a function (world, director)');
  const ex = def.extraction;
  if (ex && !(ex.vehicleId || ex.zone || (typeof ex.x === 'number' && typeof ex.z === 'number'))) E('extraction must be {vehicleId,…} | {zone:{x,z,r}} | {x,z,r} | null');
  if (ex?.spawnWhen) for (const o of ex.spawnWhen) if (!arr(def.objectives).some((q) => q.id === o)) Wn(`extraction.spawnWhen "${o}" is not an objective id`);
  for (const m of validateRoads(def)) Wn(m); // step 3p roads / pavements / furniture
  return { errors, warnings };
}

function normRoute(e) {
  const r = e.route;
  if (!r) return null;
  const legacy = Array.isArray(r);
  const points = (legacy ? r : arr(r.points)).map((p) => ({ x: p.x, z: p.z, wait: num(p.wait, 0), look: p.look ?? null, ...(p.speed !== undefined ? { speed: p.speed } : {}) }));
  if (!points.length) return null;
  const type = legacy ? (e.routeMode ? String(e.routeMode).toUpperCase() : 'PINGPONG') : (r.type || 'PINGPONG');
  return { type, vel: num(legacy ? e.vel : r.vel, 1.0), points };
}

function normEnemy(e, i) {
  const soldierType = e.soldierType || 'soldier';
  const route = normRoute(e);
  const out = {
    ...e,
    id: e.id ?? `enemy${i}`,
    soldierType,
    heading: num(e.heading, 0),
    flags: { ...defaultFlags(soldierType, !!route), ...(e.flags || {}) },
    squad: e.squad ? { columns: 1, ...e.squad } : null,
    route,
    partner: e.partner ?? null,
    jail: e.jail ?? null,
    elevated: !!e.elevated,
    y: num(e.y, 0),
    nervousness: num(e.nervousness, 50),
  };
  if (!route) {
    const p = e.post || {};
    out.post = { heading: num(p.heading, out.heading), sweep: p.sweep ?? null, period: p.period ?? null, ...(p.scan ? { scan: p.scan } : {}), ...(p.giro != null ? { giro: p.giro } : {}) };
  } else out.post = null;
  delete out.routeMode;
  return out;
}

function normExtraction(ex) {
  if (!ex) return null;
  if (ex.vehicleId) return { exit: null, spawnWhen: [], ...ex };
  const zone = ex.zone || { x: ex.x, z: ex.z, r: num(ex.r, 3) };
  return { ...ex, zone: { r: 3, ...zone }, x: zone.x, z: zone.z, r: num(zone.r, 3) };
}

/**
 * An enemy spawn that carries `vehicle: '<vehicle id>'` rides that vehicle (§7.5 pboat "Crew: mg gunner",
 * e17 "on pboat"): he is not a standalone soldier but the vehicle's crew record (the vehicle is the viewer,
 * entities/vehicle.js). Such spawns are dropped from `enemies` and become (or replace the same-id string
 * of) a `{id, soldierType, post, crewOf}` record in the vehicle's `crew`; his post (sweep/giro) shapes the
 * vehicle's cone. Spawns naming no known vehicle stay enemies (validateMission reports them).
 * @returns {{enemies: object[], vehicles: object[]}}
 */
export function foldVehicleCrews(enemies, vehicles) {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const keep = [];
  for (const e of enemies) {
    const v = e.vehicle != null ? byId.get(e.vehicle) : null;
    if (!v) { keep.push(e); continue; }
    const post = e.post || e.giro != null ? { ...(e.post || {}), ...(e.giro != null ? { giro: e.giro } : {}) } : null;
    const rec = { id: e.id, soldierType: e.soldierType, post, crewOf: v.id };
    const crew = [...(v.crew || [])];
    const k = crew.findIndex((c) => (typeof c === 'string' ? c : c?.id) === e.id);
    if (k >= 0) crew[k] = rec; else crew.push(rec);
    v.crew = crew;
  }
  return { enemies: keep, vehicles };
}

/**
 * Validate + fill defaults. Throws on validation errors (message lists them); warnings go to console.warn.
 * @param {object} def mission def (ARCHITECTURE § Missions + design-spec §7.3)
 * @param {{strict?: boolean, quiet?: boolean}} [opts] strict: warnings are errors too
 * @returns {object} normalized def (new object; the input is not mutated)
 */
export function normalizeMission(def, opts = {}) {
  if (isNormalized(def)) return def;
  def = applyVariant(def, opts.difficulty ?? def.difficulty ?? null); // BCD Easy/Hard (docs/bcd-plan.md §1.12)
  const { errors, warnings } = validateMission(def);
  if (opts.strict) errors.push(...warnings);
  if (errors.length) throw new Error(`invalid mission:\n  ${errors.join('\n  ')}`);
  if (warnings.length && !opts.quiet) console.warn(`[schema] ${warnings.join('; ')}`);
  const [W, D] = def.size;
  const theater = def.theater || 'temperate';
  const out = {
    ...def,
    campaign: def.campaign || 'BEL',
    title: def.title || def.id,
    subtitle: def.subtitle || '',
    theater,
    briefing: { text: '', objectivesSummary: '', ...(def.briefing || {}) },
    baseTerrain: def.baseTerrain || 'ground',
    coneColors: def.coneColors || (theater === 'desert' ? 'desert' : 'green'), // §4.2
    lighting: def.lighting || null, // { sunElevDeg, kelvin, hdri, fog, lut } — null = theater default
    water: def.water || null, // { velocity, angleDeg, turbulence }
    ambient: def.ambient || null, // { fish?: false, birds?: false, habitat?: 'fjord'|'sea'|'river'|'lake', density?: 0..2 } (render/ambient-life.js)
    weather: def.weather || null, // { wind?: {preset?, dirDeg?, speed?, gustiness?, turbulence?, blow?}, timeOfDay? } (world/wind.js)
    treeSnow: def.treeSnow ?? null, // snow load on the conifers 0..1.3 (art/terrain.js); null = theater default
    shoreShallowWidth: num(def.shoreShallowWidth, 2.0),
    terrain: arr(def.terrain),
    // step 3p (world/roads.js): road splines {surface, points, width, kerb?, sidewalk?, rails?, markings?, lamps?},
    // paved areas {surface, points | x,z,w,d, raise?, kerb?, quay?}, street furniture {type, variant?, x, z, rot?}
    roads: arr(def.roads),
    pavements: arr(def.pavements),
    furniture: arr(def.furniture),
    structures: arr(def.structures),
    commandos: arr(def.commandos).map((c) => ({ heading: 0, ...c })),
    ...foldVehicleCrews(arr(def.enemies).map(normEnemy),
      arr(def.vehicles).map((v, i) => ({ heading: 0, crew: [], driveable: true, ...v, id: v.id ?? `vehicle${i}` }))),
    items: arr(def.items).map((it) => ({ count: 1, ...it })),
    interactables: arr(def.interactables),
    objectives: arr(def.objectives).map((o) => ({ required: true, hidden: false, ...o })),
    zones: arr(def.zones).map((z) => ({ onSeen: null, onHeard: null, ...z })),
    // §4.9 / §7.4: the map-wide CONFIG.alarm.noZonesFallback only applies when the mission opts in, or when it
    // omits `zones` entirely (sandbox/test maps). An explicit `zones: []` (M1) means "the entire map is safe".
    noZonesFallback: def.noZonesFallback ?? def.zones === undefined,
    jails: arr(def.jails),
    alarmFail: def.alarmFail || null,
    setpieces: arr(def.setpieces),
    triggers: arr(def.triggers),
    climbLinks: arr(def.climbLinks).map((l) => ({ roles: ['greenberet'], ...l, a: [l.a[0], l.a[1], l.a[2] ?? 0], b: [l.b[0], l.b[1], l.b[2] ?? 0] })),
    ladders: arr(def.ladders).map((l) => ({ raised: false, y: 0, ...l, top: [l.top[0], l.top[1], l.top[2] ?? 0] })),
    triplines: arr(def.triplines),
    barracks: Object.fromEntries(Object.entries(def.barracks || {}).map(([k, b]) => [k, {
      pool: num(b.pool, 5),
      squads: arr(b.squads).map((s) => ({ event: 'RINT', size: 2, exitRoute: [], loop: [], ...s })),
    }])),
    reinforcements: def.reinforcements || null,
    par: { time: num(def.par?.time, 600) },
    startDisguised: arr(def.startDisguised),
    extraction: normExtraction(def.extraction),
    cameraStart: def.cameraStart || null,
    firstAid: def.firstAid ?? true,
  };
  if (!out.cameraStart && !out.commandos.length) out.cameraStart = { x: W / 2, z: D / 2 };
  Object.defineProperty(out, NORMALIZED, { value: true });
  return out;
}

/**
 * Deliberate compound joins for placement rule (c) (`footprintConflicts`): a tower on its ruin, a wing or lean-to on
 * its house, a terrace row sharing party walls. Appends each partner's id to the first structure's `clipAllow`
 * (in place, so scripts holding the same objects see it) and returns the array.
 * @param {object[]} structures
 * @param {[string, string][]} pairs
 * @returns {object[]}
 */
export function joinStructures(structures, pairs) {
  const byId = new Map(structures.filter((s) => s && s.id != null).map((s) => [s.id, s]));
  for (const [a, b] of pairs) {
    const s = byId.get(a);
    if (!s || !byId.has(b)) throw new Error(`joinStructures: unknown structure pair ${a} / ${b}`);
    s.clipAllow = [...new Set([...(s.clipAllow || []), b])];
  }
  return structures;
}
