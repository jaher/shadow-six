/**
 * SHADOW SIX house rule `runningNoise` (design-spec §4.4 amendment; not in BEL, where movement is silent [manual]):
 * a commando running upright makes a level-1 'footsteps' noise every CONFIG.stealth.runNoise.step metres. Its hearing
 * radius depends on the surface under his feet, read from grid data only (gameplay; the render-side surfaceAt in
 * render/blood/model.js reads render materials and must not drive the sim). Pure: the fixed-step sim calls
 * runNoiseStep() from Unit.update, so emission is deterministic; Unit.serialize saves the counter (_runNoiseD).
 * @module ai/running-noise
 */
import { CONFIG } from '../config.js';
import { T } from '../world/grid.js';

/** Raised floor / roof / platform: grid elev above this (m) counts as a hard floor (unless grid.naturalElev). */
const FLOOR_ELEV = 0.05;

/**
 * Gameplay step surface at (x, z): 'deck' (bridge deck, wood or metal) | 'floor' (built raised floor: roof, platform,
 * wall walk, tower; a raised cliff plateau or road ramp reads its terrain) |
 * 'road' | 'shallow' | 'ground' | 'snow' | 'grass' | 'sand' | 'mud' | 'water' (deep: swimmers make no step noise).
 * @param {import('../world/world.js').World} world
 */
export function stepSurface(world, x, z) {
  const g = world.grid;
  const i = Math.floor(x / g.cell), j = Math.floor(z / g.cell);
  if (!g.inBounds(i, j)) return 'ground';
  const k = g.idx(i, j);
  if (g.bridge[k]) return 'deck';
  // a roof, deck, wall walk or tower is a built floor; a raised plateau, terrace or ramp (naturalElev) is still the
  // snow, sand or grass it is made of
  if (g.elev[k] > FLOOR_ELEV && !g.naturalElev?.[k]) return 'floor';
  switch (g.terrain[k]) {
    case T.ROAD: return 'road';
    case T.SHALLOW: return 'shallow';
    case T.GRASS: return 'grass';
    case T.SNOW: return 'snow';
    case T.SAND: return 'sand';
    case T.MUD: return 'mud';
    case T.WATER: return 'water';
    default: return 'ground';
  }
}

/** Hearing radius (m) of one running step on `surface`, × the campaign's rules.enemyHearingMul. */
export function runNoiseRadius(world, surface) {
  const R = CONFIG.stealth.runNoise.radius;
  const r = R[surface] ?? R.ground;
  return r * (world.rules?.enemyHearingMul ?? 1);
}

/**
 * Does `unit` make running noise now? House rule on, a player commando on foot and free (not captured, hidden in a
 * building, in a vehicle), standing and running, not a disguised Spy (a German soldier running past is no news).
 */
export function makesRunNoise(unit, world, running = unit.moveMode === 'run' && !!unit.path) {
  if (!running || !world?.house?.runningNoise) return false;
  if (unit.faction !== 'player' || !unit.alive) return false;
  if (unit.state !== 'active' && unit.state !== 'busy') return false;
  if (unit.vehicle || unit.disguised) return false;
  return unit.stance === 'stand';
}

/**
 * Advance `unit`'s running-noise counter by the distance he covered this step and emit a 'footsteps' noise each
 * `step` metres. The counter starts at step·startFrac when a run begins (a short dash is still heard) and is
 * dropped whenever he is not running (Unit.update drops it on a step he does not move).
 * @param {object} unit a Unit (uses x, z, _runNoiseD)
 * @param {number} moved metres covered this step
 * @param {object} world
 * @param {boolean} [running] he ran this step (default: running now; Unit passes the mode from before an arrival)
 * @returns {object|null} the emitted noise payload fields, or null
 */
export function runNoiseStep(unit, moved, world, running) {
  if (!makesRunNoise(unit, world, running)) { unit._runNoiseD = null; return null; }
  const N = CONFIG.stealth.runNoise;
  if (unit._runNoiseD == null) unit._runNoiseD = N.step * N.startFrac;
  unit._runNoiseD += moved;
  if (unit._runNoiseD < N.step) return null;
  unit._runNoiseD -= N.step;
  const surface = stepSurface(world, unit.x, unit.z);
  if (surface === 'water') return null;
  const radius = runNoiseRadius(world, surface);
  const y = unit.y || 0;
  world.emitNoise(unit.x, unit.z, radius, 'footsteps', unit, 1, { surface, y });
  return { x: unit.x, z: unit.z, y, radius, surface };
}

/**
 * Hearing radius multiplier for `enemy` and a footsteps noise (perception.hears): dogs hear dogMul× further; a man
 * inside a vehicle (tank crew, driver) hears no steps (0). Manned emplacement gunners still hear them.
 */
export function stepHearingMul(enemy) {
  if (enemy.state === 'inVehicle' && enemy.vehicle?.vehicleKind !== 'emplacement') return 0;
  return enemy.soldierType === 'dog' ? CONFIG.stealth.runNoise.dogMul : 1;
}
