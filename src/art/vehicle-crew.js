/**
 * Visible vehicle crews (art integration 2 + vehicle integration ambient step): a realistic figure
 *  - per crew RECORD (vehicle.crew entries that are not a mission Enemy of their own) at the model's crew socket:
 *    the patrol boat's bow gunner and stern hand, the tank / 8-Rad commander in the hatch, the motorcycle rider and
 *    sidecar passenger, the driver (and co-driver) of cars and lorries, the 251's driver;
 *  - per OCCUPANT (a commando or an enemy soldier who got in) at the model's boarding seat in order, driver first —
 *    on vehicles whose seats are seen (cars, lorry cabs, the R75, the 251; not under a canvas, not in a tank).
 * Seated figures sit on the seat: the clip ('drive' / 'sit') is posed once and the figure lowered so its pelvis sits
 * just above the cushion; under a closed roof (Opel Blitz cab, Citroën) it is lowered further until the head clears
 * the roof lining — no head through the roof. Weapons are put away while seated. A figure disappears when its
 * record dies, its occupant gets out (he stands at the door, entities/vehicle.js exit) or the vehicle is destroyed.
 * Open boats without crew records (the raft, the rowboat, the escape boat) draw their men through art/boat-crew.js:
 * seated / kneeling on the hull's own layout, the Marine paddling or rowing, stepping in and out.
 * Nothing is built when the character library is not active (placeholders / node tests).
 * @module art/vehicle-crew
 */
import { Vector3 } from 'three';
import { createUnitModel, characterContext } from './unit-model.js';
import { createBoatCrew } from './boat-crew.js';

/** Seats per art/vehicles.js model key (placeholder models): [x, y, z] in model space, clip, parent ('turret'). */
export const CREW_SEATS = {
  patrolboat: [{ p: [0, 1.1, 3.0], anim: 'idle' }, { p: [0.5, 1.1, -3.4], anim: 'look_around' }],
  tank: [{ p: [0, -0.18, -0.15], anim: 'look_around', parent: 'turret' }],
  armoredcar: [{ p: [0, -0.2, 0], anim: 'look_around', parent: 'turret' }],
  motorcycle: [{ p: [-0.3, 0.45, -0.25], anim: 'drive' }, { p: [0.45, 0.2, -0.2], anim: 'sit' }],
};

/** Occupants are drawn in these registry model keys only (open seats or glazed cabs). */
const OCCUPANT_MODELS = new Set(['car', 'truck', 'fuel_truck', 'motorcycle', 'armoredcar']);
/** Hip joint above the seat cushion (m) and head top above the head bone (m). */
const HIP_ABOVE_SEAT = 0.1, HEAD_TOP = 0.14;

/** Model options that reproduce a unit's own look (entities/enemy.js, commando.js modelOpts). */
function lookOf(u) {
  const s = u.spawn || {};
  if (u.faction === 'player') return { faction: 'player', role: u.role, colors: s.colors, guestId: u.role === 'guest' ? s.guestId ?? s.id ?? null : null };
  return { faction: 'enemy', soldierType: u.soldierType || 'crew', colors: s.colors, spawnId: s.id ?? u.id ?? null, squad: s.squad?.id ?? s.squad ?? null, x: s.x, z: s.z };
}

/**
 * Seat a figure: clip, weapon away. A fixed `seat.dy` (standing hatch / cupola poses) places it at once; a seated
 * seat (dy null) is settled once the clip has blended in (settle()), hidden until then.
 */
function seatFigure(m, seat) {
  m.setAnim(seat.anim);
  const f = { m, seat, t: 0, settled: seat.dy != null || !m.isReal };
  if (f.settled) m.root.position.y = seat.dy ?? 0;
  else m.root.visible = false;
  m.ready?.then?.(() => { if (seat.anim === 'drive' || seat.anim === 'sit') m.real?.setWeapon?.(null); });
  return f;
}

const _v = new Vector3();
/**
 * Seated figure on its seat, measured in the posed clip: the pelvis just above the cushion (the socket), right over
 * it (seated clips carry the pelvis ~0.27 m behind the feet-root), and under a closed roof the head top below the lining.
 */
function settle(f) {
  const m = f.m, s = f.seat, par = m.root.parent;
  const pel = m.real?.getSocket?.('pelvis'), head = m.real?.getSocket?.('head');
  f.settled = true;
  if (!pel || !par) { m.root.position.y = -0.45; return; }
  m.root.position.set(0, 0, 0);
  par.updateWorldMatrix(true, false);
  m.root.updateMatrixWorld(true);
  const lp = par.worldToLocal(pel.getWorldPosition(_v)).clone();
  let dy = -(lp.y - HIP_ABOVE_SEAT);
  if (s.roof != null && head && s.holder) {
    const top = par.worldToLocal(head.getWorldPosition(_v)).y + HEAD_TOP + dy + s.holder.matrix.elements[13];
    if (top > s.roof) dy -= top - s.roof;
  }
  m.root.position.set(-lp.x, dy, -lp.z);
  f.dy = dy;
}

/**
 * Build the crew figures of a vehicle (or null when there is nothing to show now or later).
 * @param {object} v Vehicle entity (crew, occupants, model, def, vehicleType, linkedCrew)
 * @returns {{figures:object[], update:(dt:number)=>void, dispose:()=>void}|null}
 */
export function createCrewFigures(v) {
  if (!characterContext().ready || !v?.model?.root) return null;
  const key = v.def?.model || v.vehicleType;
  const lib = !!v.model.crewSeats;
  if (v.def?.kind === 'boat' && !v.crew?.length) return lib ? createBoatCrew(v, { createUnitModel, lookOf }) : null;
  const figures = [];
  // crew records: the model's crew sockets (library) or the fixed placeholder seats
  if (v.crew?.length) {
    const libSeats = lib ? v.model.crewSeats(key) : null;
    const seats = libSeats?.length ? libSeats.map((q) => ({ anim: q.anim, dy: q.dy, holder: q.object, roof: q.roof }))
      : (CREW_SEATS[key] || []).map((q) => ({ ...q, dy: q.p[1] }));
    v.crew.forEach((c, i) => {
      const seat = seats[i];
      if (!seat || v.linkedCrew?.(c)) return;
      const m = createUnitModel({ faction: 'enemy', soldierType: c.soldierType || 'crew', spawnId: c.ref ?? `${v.tag ?? v.id}:crew${i}` });
      if (!m.isReal) return;
      if (seat.p) m.root.position.set(seat.p[0], 0, seat.p[2]);
      const hull = v.model.root.children[0] || v.model.root;   // the hull group (boats bob with it)
      const parent = seat.holder || (seat.parent === 'turret' && v.model.turret ? v.model.turret : hull);
      parent.add(m.root);
      figures.push({ ...seatFigure(m, seat), c });
    });
  }
  const occ = new Map(); // unit → figure (occupants shown only on vehicles without crew records)
  const showOcc = lib && !figures.length && !v.crew?.length && OCCUPANT_MODELS.has(key) && !!v.model.seatHolder;
  if (!figures.length && !showOcc) return null;
  const syncOccupants = () => {
    const list = v.occupants || [];
    for (const [u, f] of occ) if (!list.includes(u) || f.k !== list.indexOf(u)) { f.m.dispose(); f.m.root.removeFromParent(); occ.delete(u); }
    list.forEach((u, k) => {
      if (occ.has(u) || u.alive === false) return;
      const seat = v.model.seatHolder(k);
      if (!seat) return;
      const m = createUnitModel(lookOf(u));
      if (!m.isReal) return;
      seat.object.add(m.root);
      occ.set(u, { ...seatFigure(m, { anim: seat.anim, dy: seat.dy, holder: seat.object, roof: seat.roof }), k, u });
    });
  };
  return {
    figures,
    occupants: occ,
    update(dt) {
      if (showOcc && !v.destroyed) syncOccupants();
      const tick = (f, on) => {
        if (on) {
          f.m.update(dt);
          // seated: settle once the clip has blended in (0.35 s of animation; the model steps off screen too)
          if (!f.settled && f.m.real?.inner && (f.t += dt) > 0.35) settle(f);
        }
        const vis = on && f.settled;
        if (f.m.root.visible !== vis) f.m.root.visible = vis;
      };
      for (const f of figures) tick(f, f.c.alive !== false && !v.destroyed);
      for (const f of occ.values()) tick(f, !v.destroyed && f.u.alive !== false && f.u.vehicle === v);
    },
    dispose() {
      for (const f of figures) f.m.dispose();
      for (const f of occ.values()) f.m.dispose();
      figures.length = 0; occ.clear();
    },
  };
}
