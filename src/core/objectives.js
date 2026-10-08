/**
 * Mission objective evaluator (pure, no three.js). Mission defs (docs/ARCHITECTURE.md § Missions):
 *   {id, text, type:'destroy'|'kill'|'reach'|'escape'|'rescue'|'steal'|'survive', targets?:[ids],
 *    zone?:{x,z,r}, required:true, hidden?:false, duration?:s (survive), roles?:[role] (reach/escape)}
 * Runtime state adds {done, failed}. `checkObjectives(world)` runs once per tick (mission.checkObjectives
 * in the tick order), emits 'objective:update' on every change and reports win/loss.
 * @module core/objectives
 */

/**
 * Build runtime objectives from mission definitions.
 * @param {object[]} defs
 * @returns {object[]}
 */
export function createObjectives(defs = []) {
  return defs.map((d) => ({ required: true, hidden: false, targets: [], ...d, done: false, failed: false }));
}

/** True when an entity counts as destroyed/dead (or no longer exists). */
export function isGone(e) {
  if (!e || e.removed) return true;
  if (e.destroyed) return true;
  if (e.alive === false) return true;
  if (typeof e.hp === 'number' && e.hp <= 0 && e.kind !== 'prop' && e.kind !== 'interactable') return true;
  return false;
}

const inZone = (e, zone) => !!zone && Math.hypot(e.x - zone.x, e.z - zone.z) <= zone.r;

function livingCommandos(world, roles) {
  return world.commandos.filter((c) => c.alive !== false && !c.removed && (!roles || roles.includes(c.role)));
}

function extractionZone(obj, world) {
  if (obj.zone) return obj.zone;
  const ex = world.mission?.extraction;
  if (ex && typeof ex.x === 'number') return { x: ex.x, z: ex.z, r: ex.r ?? 4 };
  return null;
}

const aboard = (c, v) => c.vehicle === v || (v.occupants || []).includes(c) || (v.passengers || []).includes(c) || v.driver === c;

/** True when (x, z) lies off the playable map (the vehicle drove off an edge). */
function offMap(e, world) {
  const W = world.width, D = world.depth;
  if (!(W > 0 && D > 0)) return false;
  return e.x < 0 || e.z < 0 || e.x > W || e.z > D;
}

/**
 * §8.1 vehicle extraction: the escape vehicle has "left" once it is inside `extraction.exit`
 * (circle x,z,r) or has driven off the map edge (or a script flagged `drivenOff`). Latched on the
 * vehicle (`passedExit`) so the men aboard still count after it rolls on past the exit (e.g. the
 * escaped-early dialog → Continue while a time bomb ticks, §7.5 edge case).
 */
function vehicleLeft(v, ex, world) {
  if (v.passedExit) return true;
  if (v.destroyed || v.removed) return false;
  const exit = ex.exit;
  const out = v.drivenOff === true || offMap(v, world)
    || (!!exit && typeof exit.x === 'number' && inZone(v, { x: exit.x, z: exit.z, r: exit.r ?? 3 }));
  // latch only with someone aboard: an empty truck parked on the exit does not extract anyone later
  if (out && (world.commandos || []).some((c) => c.alive !== false && !c.removed && aboard(c, v))) v.passedExit = true;
  return out;
}

function escaped(c, obj, world) {
  const ex = world.mission?.extraction;
  if (!obj.zone && ex?.vehicleId != null) {
    const v = world.byId(ex.vehicleId);
    // aboard AND the vehicle has passed the exit / driven off — never just "aboard a parked truck"
    return !!v && aboard(c, v) && vehicleLeft(v, ex, world);
  }
  const zone = extractionZone(obj, world);
  const pos = c.vehicle && c.state === 'inVehicle' ? c.vehicle : c;
  return inZone(pos, zone);
}

/**
 * Evaluate one objective against the world.
 * @returns {'done'|'failed'|null} new terminal status, or null while still open
 */
export function evaluateObjective(obj, world, objectives = world.objectives) {
  const targets = (obj.targets || []).map((id) => world.byId(id));
  switch (obj.type) {
    case 'destroy':
    case 'kill':
      return targets.length && targets.every(isGone) ? 'done' : null;
    case 'reach': {
      const cs = livingCommandos(world, obj.roles);
      const zone = obj.zone || extractionZone(obj, world);
      if (obj.all) return cs.length && cs.every((c) => inZone(c, zone)) ? 'done' : null;
      return cs.some((c) => inZone(c, zone)) ? 'done' : null;
    }
    case 'rescue': {
      if (targets.some((t) => !t || t.alive === false)) return 'failed';
      const zone = extractionZone(obj, world);
      return targets.length && targets.every((t) => inZone(t.vehicle && t.state === 'inVehicle' ? t.vehicle : t, zone)) ? 'done' : null;
    }
    case 'steal': {
      if (targets.some((t) => !t || t.destroyed || t.alive === false)) return 'failed';
      const stolen = (t) => t.stolen === true || (t.driver && t.driver.kind === 'commando') || (t.carriedBy && t.carriedBy.kind === 'commando');
      return targets.length && targets.every(stolen) ? 'done' : null;
    }
    case 'survive':
      return world.time >= (obj.duration ?? 0) ? 'done' : null;
    case 'escape': {
      // BEL: extraction only counts once every other required objective is complete.
      const othersDone = objectives.every((o) => o === obj || !o.required || o.type === 'escape' || o.done);
      if (!othersDone) return null;
      const cs = livingCommandos(world, obj.roles);
      return cs.length && cs.every((c) => escaped(c, obj, world)) ? 'done' : null;
    }
    default:
      return null;
  }
}

/**
 * Evaluate all open objectives; emits 'objective:update' for each change.
 * @returns {{changed: object[], won: boolean, lost: boolean}}
 */
export function checkObjectives(world) {
  const list = world.objectives;
  const changed = [];
  // Two passes so an 'escape' listed before its prerequisites resolves in the same tick.
  for (let pass = 0; pass < 2; pass++) {
    for (const o of list) {
      if (o.done || o.failed) continue;
      const r = evaluateObjective(o, world, list);
      if (!r) continue;
      o.done = r === 'done';
      o.failed = r === 'failed';
      if (r === 'done') o.hidden = false;
      changed.push(o);
      world.events?.emit('objective:update', { objective: o });
    }
  }
  const req = list.filter((o) => o.required);
  return { changed, won: req.length > 0 && req.every((o) => o.done), lost: req.some((o) => o.failed) };
}

/** A man counts for the end state unless dead (captured/jailed men still have to escape, §8.1). */
const isOut = (c) => c.alive === false || c.removed;
const isJailed = (c) => c.state === 'jailed' || c.state === 'captured' || c.jail != null;

/**
 * Extraction progress for the §8.1 end rules (commandos AND guests).
 * @returns {{living:number, escaped:number, jailed:number, anyEscaped:boolean, allEscaped:boolean,
 *            othersDone:boolean, hasExtraction:boolean}}
 */
export function extractionStatus(world) {
  const list = world.objectives || [];
  const esc = list.find((o) => o.type === 'escape') || { type: 'escape' };
  const ex = world.mission?.extraction;
  const hasExtraction = !!(esc.zone || (ex && (ex.vehicleId != null || typeof ex.x === 'number' || ex.zone)));
  const men = world.commandos.filter((c) => !isOut(c));
  let escapedN = 0, jailed = 0;
  for (const c of men) {
    if (isJailed(c)) jailed++;
    else if (hasExtraction && escaped(c, esc, world)) escapedN++;
  }
  const othersDone = list.every((o) => !o.required || o.type === 'escape' || o.done);
  return {
    living: men.length, escaped: escapedN, jailed, hasExtraction, othersDone,
    anyEscaped: escapedN > 0, allEscaped: men.length > 0 && escapedN === men.length,
  };
}

/** Reveal a hidden objective (e.g. discovered mid-mission). */
export function revealObjective(world, id) {
  const o = world.objectives.find((x) => x.id === id);
  if (o && o.hidden) {
    o.hidden = false;
    world.events?.emit('objective:update', { objective: o });
  }
  return o || null;
}

/**
 * §7.6 scripted escape vehicle (M3 `evac_truck`): when every objective in `extraction.spawnWhen` is
 * done, spawn `extraction.vehicleType` at `spawnAt` (may lie off the map edge), drive it to `arrive`
 * at `arrive.speed` and wait; once every living commando is aboard, drive it through `exit` and off
 * the map (north by default, `extraction.leave` overrides), which completes the escape objective.
 * Runs once per tick after checkObjectives. `flags` is persistent state saved with the game
 * (Game._endFlags): `evacSpawned` latches the spawn (a destroyed/removed truck never respawns) and
 * `evacPhase` is 'arrive' | 'wait' | 'leave'.
 * @param {object} world
 * @param {object} flags
 * @returns {object|null} the escape vehicle, when spawned
 */
export function updateExtractionVehicle(world, flags) {
  const ex = world.mission?.extraction;
  if (!ex || ex.vehicleId == null || !ex.spawnAt || !Array.isArray(ex.spawnWhen) || !ex.spawnWhen.length) return null;
  let v = world.byId(ex.vehicleId);
  const list = world.objectives || [];
  const spawnDue = () => ex.spawnWhen.every((id) => list.find((o) => o.id === id)?.done);
  if (!flags.evacSpawned) {
    if (v) {
      // already on the map (placed by the mission or spawned by hand): adopt it as the scripted
      // escape vehicle so it still waits for the team and drives off — never a soft lock
      if (v.destroyed || v.removed) return v;
      flags.evacSpawned = true;
      flags.evacPhase = v.goal || v.path ? 'arrive' : 'wait';
      v.offMapOK = true;
      return v;
    }
    if (!spawnDue()) return null;
    if (!world.vehicleFactory) return null;
    const s = ex.spawnAt;
    v = world.spawnVehicle(ex.vehicleType || 'truck', {
      id: ex.vehicleId, x: s.x, z: s.z, heading: s.heading ?? 0, friendly: ex.friendly !== false,
      ...(ex.seats != null ? { seats: ex.seats } : {}),
    });
    flags.evacSpawned = true;
    flags.evacPhase = 'arrive';
    v.offMapOK = true;
    // (`arrive.reverse`: it backs down to the pickup, nose out, so it can drive straight off — no turn in a dead end)
    if (ex.arrive) v.followPath([{ x: ex.arrive.x, z: ex.arrive.z }], { speed: ex.arrive.speed, reverse: !!ex.arrive.reverse });
    else flags.evacPhase = 'wait';
    return v;
  }
  if (!v || v.destroyed || v.removed) return v || null;
  v.offMapOK = true; // re-applied after a quick load (the respawned vehicle has no scripted flag)
  if (flags.evacPhase === 'arrive' && !v.goal && !v.path) {
    flags.evacPhase = 'wait';
  }
  if (flags.evacPhase === 'wait' && !v.goal && !v.path) {
    const men = world.commandos.filter((c) => !isOut(c));
    // leaves only once the spawn condition holds (a truck adopted early waits for o1/o2 too)
    if (men.length && men.every((c) => aboard(c, v)) && spawnDue()) {
      const exit = ex.exit;
      const pts = [];
      if (exit && typeof exit.x === 'number') pts.push({ x: exit.x, z: exit.z });
      const last = pts[pts.length - 1] || v;
      pts.push(ex.leave ? { x: ex.leave.x, z: ex.leave.z } : { x: last.x, z: -12 });
      v.followPath(pts, { speed: ex.arrive?.speed ?? ex.leave?.speed });
      // the last man's door shuts and he sits down before it pulls away (art/vehicle-crew.js climb, ~1.5 s)
      if (v.vehicleKind === 'land') v.waitT = Math.max(v.waitT || 0, 1.5);
      flags.evacPhase = 'leave';
    }
  }
  return v;
}

/**
 * §7.6 "ESC skips": while the loaded escape vehicle is driving off (`evacPhase` 'leave'), skip the
 * drive — the vehicle counts as gone (passed the exit / drove off), so the escape objective
 * completes on the next objective check.
 * @param {object} world
 * @param {object} flags  Game._endFlags
 * @returns {boolean} true when the drive-off was skipped
 */
export function skipExtractionDrive(world, flags) {
  const ex = world?.mission?.extraction;
  if (!ex || ex.vehicleId == null || flags?.evacPhase !== 'leave') return false;
  const v = world.byId(ex.vehicleId);
  if (!v || v.destroyed || v.removed || v.drivenOff) return false;
  v.drivenOff = true;
  v.passedExit = true;
  v.stop?.();
  flags.evacPhase = 'gone';
  return true;
}
