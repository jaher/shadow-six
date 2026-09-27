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
 * Head direction: when `enemy.sweepActive` is true the head yaw is heading + headOffset + sweepOffset(t)
 * (the sweep is centred on headOffset, so a post can re-centre it on a noise); otherwise heading +
 * headOffset. The brain owns both fields. Head turns are instant [EXE PASO 90].
 * @module ai/perception
 */

import { CONFIG } from '../config.js';
import { recognises } from './bcd-ranks.js';

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
  const base = enemy.headOffset || 0;
  return enemy.sweepActive ? base + sweepOffset(enemy, t) : base;
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
    heading: enemy.heading + theta, theta, halfFov: v.fov / 2, near, far, elevated: !!(v.elevated || enemy.elevated),
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
    if (target.hiddenBody || target.carriedBy || target.state === 'carried' || target.hidden) return null;
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
  return target.isLow ? 'near' : 'full';
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
  const cls = targetClass(target, o, viewer);
  if (!cls) return 'none';
  const cone = o.cone || coneAt(viewer, world?.time);
  const zone = pointInCone(cone, target.x, target.z);
  if (!zone || (zone === 'far' && cls === 'near')) return 'none';
  // Roof rule (§4.2): a unit on a roof is invisible to viewers more than rooftopDelta lower, and vice versa.
  const S = CONFIG.stealth, vy = cone.vy ?? (viewer.y || 0), ty = target.y || 0;
  if ((vy >= S.roofY || ty >= S.roofY) && Math.abs(vy - ty) > S.rooftopDelta) return 'none';
  const low = isBody(target) || cls === 'near';
  // Deck-edge rule (§4.7): a body or a low (prone) unit lying on a raised surface above the viewer's eye
  // (a wall walk, a deck) is hidden by the surface edge — the low-surface case of the roof rule (M2 walk_sw).
  // `falling`: the victim of a kill seen as he drops (notifyKill) is still upright, so the rule waits.
  if (low && ty > cone.y && !target.falling) return 'none';
  const los = world.grid.lineOfSight(cone.x, cone.z, target.x, target.z, {
    viewerElevated: cone.elevated, targetLow: low, viewerY: vy, targetY: ty, dynamic: o.dynamic ?? target.kind !== 'vehicle',
    ownHull: viewer.ownHull, ownOwner: postOwner(viewer, world),
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

/** Dead units (any faction) that can still be found: not jailed/removed (+ world.ai.extraBodies). */
export function bodiesOf(world) {
  const out = [];
  for (const list of [world.enemies, world.commandos]) {
    for (const u of list) if (!u.alive && !u.removed && u.state !== 'jailed') out.push(u);
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
  const dx = noise.x - enemy.x, dz = noise.z - enemy.z;
  return dx * dx + dz * dz <= noise.radius * noise.radius;
}

/** Namespace object (ARCHITECTURE "Cross-team interfaces": perception.canSee / perception.coneAt). */
export const perception = { canSee, coneAt, pointInCone, sweepOffset, ellipseFar, probe, perceive, headTheta };
export default perception;
