/**
 * Set-piece mechanics for BEL missions 4-20 (design-spec §7.1, §7.7, §8.1). Owned by MISSIONS.
 * Mission authors write data (+ an optional small script); this module runs it:
 *
 *   setpieces: [{type, id, ...}]      one entry per scripted mechanism (types: setpiece-types*.js, SETPIECE_TYPES)
 *   triggers:  [{on, match?, when?, once?, delay?, do:[actions]}]   event → actions (see runAction)
 *   alarmFail: {events:['DETONATE'], message} | {event, message}    §8.1 alarm-fail scripts (M12/M15/M16/M13)
 *   script(world, director)           optional per-mission hook, called once after the lazy init
 *
 * Every set-piece is an Entity of kind 'setpiece' (no update list): World.serialize saves it by id, so its
 * state survives quick save/load; the director ticks them at 20 Hz on world.onBelTick (§10.1). Ids that point
 * at vehicles/enemies are resolved lazily on the first tick (units spawn after the map is built).
 * A scripted mission failure sets `world.scriptFail = reason` (Game._lossCondition turns it into a loss).
 * @module missions/setpieces
 */

import { SetPiece, SETPIECE_TYPES, registerSetpiece, inPoly, inArea, P } from './setpiece-base.js';
import { installTriggers, runDelayed, TriggerState } from './setpiece-triggers.js';
import './setpieces-transport.js';
import './setpieces-structures.js';
import './setpieces-hazards.js';

export { SetPiece, SETPIECE_TYPES, registerSetpiece, inPoly, inArea, P };
export { cableCar } from './setpieces-transport.js';
export { Device, addDevice } from './setpiece-device.js';
export { ACTION_VERBS } from './setpiece-actions.js';

/**
 * Build the director for a world (called by map-builder after the grid/registries exist).
 * @returns {object|null} director (also `world.setpieces`)
 */
export function installSetpieces(world, mission, opts = {}) {
  const specs = mission.setpieces || [];
  const trig = mission.triggers || [];
  const af = mission.alarmFail;
  if (!specs.length && !trig.length && !af && typeof mission.script !== 'function') return null;
  const pieces = [];
  world._spMeshes = opts.meshes !== false;
  for (const s of specs) {
    const Cls = SETPIECE_TYPES[s.type];
    if (!Cls) throw new Error(`[setpieces] unknown set-piece type "${s.type}"`);
    const p = new Cls(s);
    world.add(p);
    pieces.push(p);
    p.build(world, { meshes: opts.meshes !== false });
  }
  // trigger bookkeeping (fired counts, pending delays) is itself a set-piece so it is saved with the game
  const tstate = trig.length ? new TriggerState({ type: '__triggers', id: '__triggers' }) : null;
  if (tstate) { world.add(tstate); pieces.push(tstate); }
  const dir = {
    world, pieces, tstate, triggers: trig.map((t, k) => ({ ...t, k })), started: false,
    get: (id) => pieces.find((p) => p.tag === id) || null,
    /** Scripted mission failure (§8.1 alarm-fail scripts): Game ends the mission after its 5 s grace. */
    fail(reason) {
      if (world.scriptFail) return;
      world.scriptFail = reason || 'MISSION FAILED';
      world.events.emit('message', { text: world.scriptFail, kind: 'warn' });
    },
    tick(dt) {
      // lazy init + restored state first, so 'start' triggers see the saved fired counts
      for (const p of pieces) {
        if (p.removed) continue;
        if (!p.inited) { p.inited = true; p.init(); }
        if (p._pendingLoad) { const s = p._pendingLoad; p._pendingLoad = null; p.load(s); }
      }
      if (!dir.started) start();
      for (const p of pieces) if (!p.removed) p.tick(dt);
      runDelayed(dir, dt);
    },
  };
  world.setpieces = dir;
  const start = () => {
    dir.started = true;
    installTriggers(dir);
    installAlarmFail(dir, af);
    if (typeof mission.script === 'function') mission.script(world, dir);
  };
  world.onBelTick((dt20) => dir.tick(dt20));
  return dir;
}

/** §8.1 alarm-fail: listed alarm events (fired by alarm zones or scripted runners) fail the mission. */
function installAlarmFail(dir, af) {
  if (!af) return;
  const events = new Set([].concat(af.events || [], af.event || []));
  const msg = af.message || 'MISSION FAILED';
  dir.world.listen('alarm:zone', (p) => { if (events.has(p.event)) dir.fail(msg); });
}

