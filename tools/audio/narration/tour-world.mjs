// The Colonel's tour as the briefing will show it, computed without a browser: the mission's grid-only world with its
// units spawned the way Game._spawnUnits places them, then ui/tour.js tourStops (the same function the briefing calls).
// Used by dump-text.mjs (what the narrator records) and tests/unit/narration.test.mjs (that the recording still
// matches). Needs the 'three' resolve hook (tests/unit/resolve-hooks.mjs).
import { World } from '../../../src/world/world.js';
import { buildMap } from '../../../src/world/map-builder.js';
import { normalizeMission } from '../../../src/missions/schema.js';
import { placeSpawn } from '../../../src/world/placement.js';
import { Commando } from '../../../src/entities/commando.js';
import { Enemy } from '../../../src/entities/enemy.js';
import { Vehicle } from '../../../src/entities/vehicle.js';
import { createObjectives } from '../../../src/core/objectives.js';
import { tourNarrationLines } from '../../../src/ui/tour.js';

/** A grid-only world of the mission at the moment its briefing opens. */
export function briefingWorld(def) {
  const n = normalizeMission(def, { quiet: true });
  const world = new World({ size: n.size, mission: n });
  buildMap(world, n, { meshes: false });
  const free = (x, z, s) => world.grid.walkableAt(x, z) && Math.abs((world.grid.elevAt?.(x, z) ?? 0) - (s.y ?? 0)) < 0.3;
  const placed = (s) => placeSpawn(s, world.placement, free);
  for (const c of n.commandos || []) world.add(new Commando(placed({ ...c, campaign: world.campaign })));
  for (const e of n.enemies || []) world.add(new Enemy(placed(e)));
  world.vehicleFactory = (s) => new Vehicle(s);
  for (const v of n.vehicles || []) { try { world.spawnVehicle(v.vehicleType || 'truck', v); } catch { /* as the game: skip */ } }
  world.objectives = createObjectives(n.objectives || []);
  if (!world.extraction) world.extraction = n.extraction || null;
  return { world, def: n };
}

/** The tour lines of a mission ({id, text}[]: t0.. per stop, then the sign-off), as the briefing shows them. */
export function missionTourLines(def) {
  const { world, def: n } = briefingWorld(def);
  try { return tourNarrationLines(world, n); } finally { world.dispose?.(); }
}

/** File id of a tour caption's clip: 't' + FNV-1a of the text (stable while the text is). */
export function tourClipId(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return 't' + h.toString(16).padStart(8, '0');
}
