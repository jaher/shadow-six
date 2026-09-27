/**
 * Visible enemy crews on open vehicles (art integration 2): a realistic figure per crew RECORD (vehicle.crew entries
 * that are not a mission Enemy of their own) at a seat of the vehicle model — the patrol boat's bow gunner and stern
 * hand, the tank / armoured-car commander standing in the turret hatch, the motorcycle rider and sidecar passenger.
 * Enclosed placeholder bodies (trucks, cars, tankers, planes) hide their cab, so no figure is built there.
 * A figure disappears when its record dies (`alive === false`) or the vehicle is destroyed. Nothing is built when the
 * character library is not active (placeholders / node tests).
 * @module art/vehicle-crew
 */
import { createUnitModel, characterContext } from './unit-model.js';

/** Seats per art/vehicles.js model key: [x, y, z] in model space, clip, parent ('turret' = turns with it). */
export const CREW_SEATS = {
  patrolboat: [{ p: [0, 1.1, 3.0], anim: 'idle' }, { p: [0.5, 1.1, -3.4], anim: 'look_around' }],
  tank: [{ p: [0, -0.18, -0.15], anim: 'look_around', parent: 'turret' }],
  armoredcar: [{ p: [0, -0.2, 0], anim: 'look_around', parent: 'turret' }],
  motorcycle: [{ p: [-0.3, 0.45, -0.25], anim: 'drive' }, { p: [0.45, 0.2, -0.2], anim: 'sit' }],
};

/**
 * Build the crew figures of a vehicle (or null when there is nothing to show).
 * @param {object} v Vehicle entity (crew, model, def, vehicleType, linkedCrew)
 * @returns {{figures:object[], update:(dt:number)=>void, dispose:()=>void}|null}
 */
export function createCrewFigures(v) {
  if (!characterContext().ready || !v?.crew?.length || !v.model?.root) return null;
  const seats = CREW_SEATS[v.def?.model || v.vehicleType];
  if (!seats) return null;
  const figures = [];
  v.crew.forEach((c, i) => {
    const seat = seats[i];
    if (!seat || v.linkedCrew?.(c)) return;
    const m = createUnitModel({ faction: 'enemy', soldierType: c.soldierType || 'crew', spawnId: c.ref ?? `${v.tag ?? v.id}:crew${i}` });
    if (!m.isReal) return;
    m.root.position.set(...seat.p);
    const hull = v.model.root.children[0] || v.model.root;   // the hull group (boats bob with it)
    const parent = seat.parent === 'turret' && v.model.turret ? v.model.turret : hull;
    parent.add(m.root);
    m.setAnim(seat.anim);
    figures.push({ m, c });
  });
  if (!figures.length) return null;
  return {
    figures,
    update(dt) {
      for (const f of figures) {
        const on = f.c.alive !== false && !v.destroyed;
        if (f.m.root.visible !== on) f.m.root.visible = on;
        if (on) f.m.update(dt);
      }
    },
    dispose() { for (const f of figures) f.m.dispose(); figures.length = 0; },
  };
}
