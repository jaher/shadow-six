/**
 * Perception — owned by AI (design-spec §4.2–§4.4, §10.2). THE CONE GEOMETRY HERE IS SHARED BY DETECTION
 * AND DISPLAY: render/vision-cone.js draws coneAt(enemy) cut by grid.castRay; detection tests
 * pointInCone(coneAt(enemy), …) + band rule + roof rule + deck-edge rule + grid.lineOfSight (same DDA, same occluders).
 *
 *   coneAt(enemy, t?)                  → Cone {x, z, y, heading, theta, halfFov, near, far, elevated}
 *   sweepOffset(enemy, t)              → θ(t) = A·sin(2π(t + φ)/P)  (radians)
 *   ellipseFar(a, θ, ratio?)           → a·b/√((b cosθ)² + (a sinθ)²), b = a·ratio (§4.2 VISTAELIPTICA)
 *   pointInCone(cone, x, z)            → 'near' | 'far' | null   (geometry only, no LOS)
 *   canSee(viewer, target, world, o?)  → 'none' | 'near' | 'far' (band rule + roof rule + LOS)
 *   probe(world, x, z)                 → first enemy whose standing-test cone contains (x, z), or null
 *   perceive(enemy, world)             → the §4.3 seen list {commandos, bodies, prints} (≤ 16 objects)
 *
 * Head direction: when `enemy.sweepActive` is true the head yaw is heading + headOffset + headCarry +
 * sweepW·sweepOffset(t) (the sweep is centred on headOffset, so a post can re-centre it on a noise); otherwise heading +
 * headOffset + headCarry. The brain owns these fields. BEL turned heads instantly [EXE PASO 90]; SHADOW SIX turns a
 * guard who hears something on the spot at an eased rate (enemy-brain _turnTo): the sweep weight sweepW (default 1)
 * fades the sweep out for the turn and back in after it, and headCarry (default 0) carries a head that was turned away
 * when the turn began round with the body, so the cone moves continuously.
 * @module ai/perception
 */

import { ownerHeight } from '../world/placement.js';
import { CONFIG } from '../config.js';
import { recognises } from './bcd-ranks.js';
import { stepHearingMul } from './running-noise.js';

const TAU = Math.PI * 2;

/**
 * @typedef {object} Cone
 * @property {number} x @property {number} z  apex (viewer position)
 * @property {number} y        eye height (m): viewer y + eyeHeight
 * @property {number} vy       viewer foot height (m) (roof rule, LOS elev)
 * @property {number} heading  head direction (rad) = body heading + theta
 * @property {number} theta    head yaw offset from the body heading (rad) — drives the ellipse
 * @property {number} halfFov  half aperture (rad)
 * @property {number} near     near-band radius at theta (m) = far/2 for elliptical profiles
 * @property {number} far      far radius at theta (m)
 * @property {boolean} elevated
 * @property {boolean} overlooks  viewer looks down past the roof rule (balcony sentry)
 */

/** θ(t) sweep offset for an enemy (radians). φ = vision.phase (s). */
export function sweepOffset(enemy, t) {
  const v = enemy.vision;
  if (!v || !v.sweep || !v.period) return 0;
  const A = enemy.sweepAmp ?? v.sweep, P = enemy.sweepPeriod ?? v.period;
  return A * Math.sin((TAU * (t + (v.phase || 0))) / P);
}

/** Elliptical far range at head offset θ (§4.2): a·b/√((b cosθ)² + (a sinθ)²), b = a·ratio. */
export function ellipseFar(a, theta, ratio = CONFIG.stealth.ellipseRatio) {
  const b = a * ratio;
  const c = Math.cos(theta), s = Math.sin(theta);
  return (a * b) / Math.sqrt((b * c) ** 2 + (a * s) ** 2);
}

/** Head yaw offset θ (rad) of a viewer at time t (see module doc). */
export function headTheta(enemy, t) {
  const base = (enemy.headOffset || 0) + (enemy.headCarry || 0);
  return enemy.sweepActive ? base + (enemy.sweepW ?? 1) * sweepOffset(enemy, t) : base;
}

/**
 * Current cone geometry of a viewer (enemy or {x, z, heading, vision, y?}).
 * @param {object} enemy
 * @param {number} [t] sim time (default enemy.world.time)
 * @returns {Cone|null} null when the viewer has no cone (vision null)
 */
export function coneAt(enemy, t) {
  const v = enemy.vision;
  if (!v) return null;
  const time = t ?? enemy.world?.time ?? 0;
  const theta = headTheta(enemy, time);
  const a = v.far ?? v.range;
  const far = v.elliptical ? ellipseFar(a, theta, v.ellipseRatio) : a;
  const near = v.elliptical ? far / 2 : Math.min(v.near ?? v.nearRange, far);
  const vy = enemy.y || 0;
  return {
    x: enemy.x, z: enemy.z, y: vy + (v.eyeHeight ?? CONFIG.stealth.eyeHeight), vy,
    heading: enemy.heading + theta, theta, halfFov: v.fov / 2, near, far, elevated: !!(v.elevated || enemy.elevated), overlooks: !!v.overlooks, overWalls: !!v.overWalls,
  };
}

/**
 * Band of point (x, z) inside a cone, ignoring LOS. The cone is the circular sector apex→far (radius
 * far(θ)) within ±halfFov of the head heading; its near part (≤ near) is the near band. Exactly the
 * polygon VisionCone draws before occlusion (§10.2).
 * @returns {'near'|'far'|null}
 */
export function pointInCone(cone, x, z) {
  if (!cone) return null;
  const dx = x - cone.x, dz = z - cone.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > cone.far * cone.far) return null;
  if (d2 > 1e-12) {
    let a = Math.atan2(dz, dx) - cone.heading;
    a -= TAU * Math.round(a / TAU);
    if (Math.abs(a) > cone.halfFov) return null;
  }
  return d2 <= cone.near * cone.near ? 'near' : 'far';
}

/** Legacy helper (tests): band of (x, z) in the enemy's current cone. */
export function coneZone(enemy, x, z) {
  return pointInCone(coneAt(enemy), x, z);
}

/** Is `target` a body (dead unit or explicit body entity)? */
export function isBody(target) {
  return target.kind === 'body' || (target.hp !== undefined && target.alive === false);
}

/**
 * §4.2 band-rule class of a target: 'full' (seen in both bands), 'near' (near band only) or null (never).
 * @param {object} target
 * @param {{ignoreDisguise?: boolean}} [o]
 * @param {object} [viewer] the looking enemy (enables the §3.4 witness rule)
 */
export function targetClass(target, o = {}, viewer = null) {
  if (target.kind === 'footprint') return target.aiVisible === false ? null : 'near';
  if (isBody(target)) {
    // hidden (barrel), carried or inside a building: never seen (§4.7)
    if (target.hiddenBody || target.carriedBy || target.state === 'carried' || target.hidden || target.sunk) return null; // sunk: bodies-design §A.4
    return 'full';
  }
  if (target.kind === 'vehicle') return 'full';
  // a commando manning a gun (emplacement) is seen although he is 'inVehicle' (§4.2 band table)
  const manning = target.state === 'inVehicle' && target.vehicle?.vehicleKind === 'emplacement';
  if (!manning && target.isVisibleToEnemies === false) {
    // Witness rule (§3.4, ABILITIES): a buried GB / submerged Marine stays visible (near band, low) to the
    // enemies in `target.witnesses` — those whose cone held him when he went under.
    if (viewer && target.alive !== false && target.witnesses?.has?.(viewer)) return 'near';
    return null;
  }
  if (target.disguised && !o.ignoreDisguise && !(viewer && recognises(viewer, target))) return null; // BCD §1.6 ranks (BEL: never)
  // a man aboard an open boat (Unit.isVisibleToEnemies) is in plain view, whatever stance he climbed in with: a boat
  // on open water is seen anywhere in the cone, the light far band too (user, M3 2026-10-08: "Even the raft boat in the
  // light shaded field of view of a soldier makes the soldier see it") — §4.2 band table. Men sitting in a raft or
  // rowboat (`seated`) are still low behind cover on the bank (canSee: low LOS); men on a deck are not.
  if (target.state === 'inVehicle' && target.vehicle?.isOpenBoat) return 'full';
  return target.isLow ? 'near' : 'full';
}

/**
 * The open boat a target is aboard (Unit.isVisibleToEnemies), or null: the boat's own occluder stamp (the patrol
 * boat's hull) never hides the men on its deck (targetHull). Men sitting in a raft / rowboat are seen in both bands
 * but are low behind cover (canSee).
 */
function openBoatOf(target) {
  const v = target.state === 'inVehicle' ? target.vehicle : null;
  return v?.isOpenBoat ? v : null;
}

/**
 * Can `viewer` see `target` right now? Implements the §4.2 band rule (low targets and footprints: near
 * band only; bodies: full cone), the roof rule and grid LOS (static + dynamic occluders).
 * @param {object} viewer enemy, or {x, z, heading, vision, elevated?, y?}
 * @param {object} target unit/body/footprint/vehicle: {x, z, y?, kind?, isLow?, isVisibleToEnemies?, disguised?, falling?}
 * @param {import('../world/world.js').World} world
 * @param {{ignoreDisguise?: boolean, cone?: Cone, dynamic?: boolean}} [o] ignoreDisguise: suspicious-act
 *   check on a disguised spy; cone: precomputed coneAt(viewer) (perf); dynamic: false ignores the vehicle
 *   occluder layer (used when the target IS a vehicle, whose own hull is stamped there)
 * @returns {'none'|'near'|'far'}
 */
export function canSee(viewer, target, world, o = {}) {
  if (viewer.alive === false || viewer.state === 'dead' || viewer.incapacitated) return 'none'; // BCD: knocked out / cuffed
  if (world?.debug?.noDetect && viewer.faction !== 'player') return 'none'; // ?debug inspection mode: nobody sees anything
  const cls = targetClass(target, o, viewer);
  if (!cls) return 'none';
  const cone = o.cone || coneAt(viewer, world?.time);
  const zone = pointInCone(cone, target.x, target.z);
  if (!zone || (zone === 'far' && cls === 'near')) return 'none';
  // inside a bunker (abilities/bunker-entry.js: a Sapper setting a charge in there): behind its concrete, only its own
  // crew sees him, in their cone (the roof / slit grid cells say nothing about the room under them)
  const inside = target.insideStructure;
  if (inside) return inside.owner && postOwner(viewer, world) === inside.owner ? zone : 'none';
  // Roof rule (§4.2): a unit on a roof is invisible to viewers more than rooftopDelta lower, and vice versa.
  // A mission whose raised levels are open terraces and wall walks turns it off (`rules.roofRule: false`, M20).
  const S = CONFIG.stealth, vy = cone.vy ?? (viewer.y || 0), ty = target.y || 0;
  // `overlooks` (spawn flag): a sentry on a balcony or ledge looks DOWN past the rule (M12 jail ledge, ooc "overlooking
  // the lower level"); the men below still cannot see him, and he never sees up.
  if ((vy >= S.roofY || ty >= S.roofY) && Math.abs(vy - ty) > S.rooftopDelta && world?.mission?.rules?.roofRule !== false
    && !(cone.overlooks && vy > ty)) return 'none';
  const boat = openBoatOf(target);
  const low = isBody(target) || cls === 'near' || !!boat?.def?.seated; // seated in a raft: low behind cover, any band
  // Deck-edge rule (§4.7): a body or a low (prone) unit lying on a raised surface above the viewer's eye
  // (a wall walk, a deck) is hidden by the surface edge — the low-surface case of the roof rule (M2 walk_sw).
  // `falling`: the victim of a kill seen as he drops (notifyKill) is still upright, so the rule waits.
  if (low && ty > cone.y && !target.falling) return 'none';
  const los = world.grid.lineOfSight(cone.x, cone.z, target.x, target.z, {
    viewerElevated: cone.elevated, targetLow: low, viewerY: vy, targetY: ty, dynamic: o.dynamic ?? target.kind !== 'vehicle',
    ownHull: viewer.ownHull, ownOwner: postOwner(viewer, world),
    targetHull: boat?.def?.occludes ? { x: boat.x, z: boat.z, w: boat.def.size[0], d: boat.def.size[1], heading: boat.heading || 0 } : undefined,
    // an MG gunner on an open platform sees over a wall lower than his sight line to the target's head
    overWalls: cone.overWalls ? { heightOf: ownerHeight(world), eyeY: cone.y, targetTopY: ty + (low ? 0.4 : 1.5) } : undefined,
  });
  return los ? zone : 'none';
}

/**
 * Grid owner id of the structure an enemy is posted inside (mission `structure`, e.g. the M3 dam bunker crew):
 * its block cells must not blind him — he looks out through the firing slit (replay m03: e34 saw nothing).
 * @returns {number} 0 = none
 */
export function postOwner(viewer, world) {
  if (viewer._postOwner !== undefined) return viewer._postOwner;
  const id = viewer.spawn?.structure;
  const it = id != null && world?.byId ? world.byId(id) : null;
  const own = it?.owner || 0;
  if (it || id == null) viewer._postOwner = own; // cache once the structure is known
  return own;
}

/** §4.2 probe marker: the first living enemy whose current cone (standing test) contains (x, z). */
export function probe(world, x, z) {
  const dummy = { x, z, isLow: false, isVisibleToEnemies: true };
  for (const e of world.enemies) {
    if (!e.alive || !e.vision || e.removed || e.incapacitated) continue;
    if (canSee(e, dummy, world) !== 'none') return e;
  }
  return null;
}

/**
 * Dead units (any faction) that can still be found: not jailed/removed (+ world.ai.extraBodies). A spawn
 * flagged `quietBody` (the M19 caged dog) leaves no body anyone reacts to.
 */
export function bodiesOf(world) {
  const out = [];
  for (const list of [world.enemies, world.commandos]) {
    for (const u of list) if (!u.alive && !u.removed && u.state !== 'jailed' && !u.spawn?.quietBody) out.push(u);
  }
  for (const b of world.ai?.extraBodies || []) out.push(b);
  return out;
}

/**
 * The §4.3 seen list of one enemy for this step: commandos first (nearest first), then bodies, then
 * AI-visible footprints (near band only), at most CONFIG.stealth.seenListMax objects in total.
 * @param {object} enemy
 * @param {import('../world/world.js').World} world
 * @param {{bodies?: boolean, prints?: boolean, cone?: Cone}} [o]
 * @returns {{cone: Cone|null, commandos: {unit, zone, dist}[], bodies: {unit, zone, dist}[], prints: object[]}}
 */
export function perceive(enemy, world, o = {}) {
  const res = { cone: null, commandos: [], bodies: [], prints: [] };
  const cone = o.cone || coneAt(enemy, world.time);
  if (!cone) return res;
  res.cone = cone;
  const max = CONFIG.stealth.seenListMax;
  const r = cone.far + 1, r2 = r * r;
  const opt = { cone };
  for (const c of world.commandos) {
    if (!c.alive || c.removed) continue;
    const dx = c.x - cone.x, dz = c.z - cone.z, d2 = dx * dx + dz * dz;
    if (d2 > r2) continue; // cheap prefilter first (§10.5: distance, then angle, then LOS)
    const zone = canSee(enemy, c, world, opt);
    if (zone !== 'none') res.commandos.push({ unit: c, zone, dist: Math.sqrt(d2) });
  }
  res.commandos.sort((a, b) => a.dist - b.dist);
  if (res.commandos.length > max) res.commandos.length = max;
  let n = res.commandos.length;
  if (o.bodies !== false && n < max) {
    for (const b of bodiesOf(world)) {
      const dx = b.x - cone.x, dz = b.z - cone.z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const zone = canSee(enemy, b, world, opt);
      if (zone !== 'none') { res.bodies.push({ unit: b, zone, dist: Math.sqrt(d2) }); if (++n >= max) break; }
    }
  }
  if (o.prints && n < max && world.ai?.footprints) {
    for (const p of (world.ai.footprints.tracksNear?.(cone.x, cone.z, cone.near + 0.5) ?? world.ai.footprints.query(cone.x, cone.z, cone.near + 0.5))) {
      if (canSee(enemy, p, world, opt) !== 'none') { res.prints.push(p); if (++n >= max) break; }
    }
  }
  return res;
}

/** Commandos currently visible to `enemy`, nearest first. @returns {{unit, zone, dist}[]} */
export function visibleCommandos(enemy, world) {
  return perceive(enemy, world, { bodies: false }).commandos;
}

/** A not-yet-noticed body `enemy` sees in its full cone, or null (legacy helper). */
export function noticedBody(enemy, world) {
  if (enemy.flags?.ignoresBodies) return null;
  for (const b of perceive(enemy, world).bodies) if (!b.unit.bodyNoticed) return b.unit;
  return null;
}

/**
 * Does `enemy` hear a noise? Distance only — BEL hearing has no occlusion (§4.4). An enemy never hears
 * himself; noises from other enemies (their shots, "Halt!", barks) are heard like any other.
 */
export function hears(enemy, noise) {
  if (!enemy.alive || noise.source === enemy || !(noise.radius > 0)) return false;
  if (enemy.world?.debug?.noDetect) return false; // ?debug inspection mode: deaf too
  let r = noise.radius;
  // optional per-mission cap on how far an explosion carries to the guards (`rules.explosionHearing`, m; M10: the camp
  // and the airfield are ~100 m apart and each turns out only for its own bangs). Zone onHeard sensors keep their
  // map-wide reach for explosions (alarm.js, §4.9); without the rule nothing changes (§4.4 map-wide).
  const cap = noise.kind === 'explosion' ? enemy.world?.mission?.rules?.explosionHearing : null;
  if (cap > 0 && cap < r) r = cap;
  // SHADOW SIX runningNoise: dogs hear a running man further; a man inside a vehicle hears no steps
  // and a step is heard over its 3D distance (a guard on a roof or a plateau above a runner, or the reverse)
  let dy = 0;
  if (noise.kind === 'footsteps') { r *= stepHearingMul(enemy); dy = (noise.y ?? 0) - (enemy.y > 0 ? enemy.y : enemy.world?.grid?.elevAt(enemy.x, enemy.z) ?? 0); }
  const dx = noise.x - enemy.x, dz = noise.z - enemy.z;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

/** Namespace object (ARCHITECTURE "Cross-team interfaces": perception.canSee / perception.coneAt). */
export const perception = { canSee, coneAt, pointInCone, sweepOffset, ellipseFar, probe, perceive, headTheta };
export default perception;
