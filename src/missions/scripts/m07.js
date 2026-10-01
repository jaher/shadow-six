/**
 * BEL Mission 7 "Chase of the Wolves": mission-local helpers (docs/missions/m07.md §5.2, §10, §11, §14 R6).
 * Owned by MISSIONS.
 *
 *  - UBOATS: the two moored U-boats (centre, rotation, length) and the local x of the torpedo stack on each
 *    after deck. The stern (NW end) is local −x; the demolition marker sits on the torpedoes (§13 #9).
 *  - nearUboatHull / inMarker: a charge that goes off on a hull but not by the torpedoes only scorches it (T2).
 *  - chargesLeft / afloat: soft-lock guard (T6): fewer time bombs left than U-boats still afloat.
 *  - spawnVillageOfficer: the one sergeant who staggers out of the blown village barracks (T5, [P][K]).
 * @module missions/scripts/m07
 */

import { Enemy } from '../../entities/enemy.js';

const deg = (d) => (d * Math.PI) / 180;

/** U-boat hulls: centre, rot (deg, bow direction), length × beam; `torpX` = local x of the torpedo stack. */
export const UBOATS = {
  // parallel to the quay, 6 m NW of the dossier's centre: 3.4 m of deep water to the quay's shallow rim along the
  // whole hull, and a 4 m channel between its bow and the lighthouse mole (the boat's way to the slipway)
  uboat_1: { x: 28.95, z: 139.5, rot: 42.1, w: 67, d: 6, torpX: -25, marker: 'u1_charge' },
  // parallel to the pier and 1.8 m NE of the dossier's point: its hull lies flush against the pier's S face
  uboat_2: { x: 24.4, z: 158.2, rot: 43, w: 67, d: 6, torpX: -29.5, marker: 'u2_charge' },
};

/** Local (lx, lz) of a hull → world (x, z). */
export function hullPoint(b, lx, lz = 0) {
  const c = Math.cos(deg(b.rot)), s = Math.sin(deg(b.rot));
  return { x: +(b.x + lx * c - lz * s).toFixed(2), z: +(b.z + lx * s + lz * c).toFixed(2) };
}

/** World (x, z) → hull-local (lx, lz). */
function toLocal(b, x, z) {
  const c = Math.cos(deg(b.rot)), s = Math.sin(deg(b.rot)), dx = x - b.x, dz = z - b.z;
  return { lx: dx * c + dz * s, lz: -dx * s + dz * c };
}

/** Is (x, z) on (or within `pad` m of) a hull? Returns the hull id or null. */
export function nearUboatHull(x, z, pad = 1) {
  for (const [id, b] of Object.entries(UBOATS)) {
    const { lx, lz } = toLocal(b, x, z);
    if (Math.abs(lx) <= b.w / 2 + pad && Math.abs(lz) <= b.d / 2 + pad) return id;
  }
  return null;
}

/** Is (x, z) inside any of the named demolition markers? */
export function inMarker(world, x, z, ids) {
  return ids.some((id) => {
    const m = world.markers?.get?.(id);
    return !!m && Math.hypot(x - m.x, z - m.z) <= (m.r ?? 3);
  });
}

/** Explosive target (interactable) standing for a U-boat. */
const targetOf = (world, id) => (world.interactables || []).find((i) => i.interactKind === 'explosiveTarget' && (i.tag === id || i.id === id));

/** How many of the given U-boats are still afloat. */
export function afloat(world, ids = Object.keys(UBOATS)) {
  return ids.filter((id) => { const t = targetOf(world, id); return t && !t.destroyed; }).length;
}

/**
 * Time bombs still usable: in any commando's knapsack, lying on the ground (the air-drop crate or a dropped
 * charge) or armed and not yet gone off. Counted generously (dead men's kit too): T6 must never fail early.
 */
export function chargesLeft(world) {
  let n = 0;
  for (const c of world.commandos || []) n += c.inventory?.get?.('timeBomb') ?? 0;
  for (const it of world.interactables || []) {
    if (it.removed) continue;
    if (it.interactKind === 'pickup' && it.itemId === 'timeBomb') n += it.count ?? 1;
    else if (it.interactKind === 'crate') n += it.contents?.timeBomb ?? 0;
    else if (it.interactKind === 'bomb' && it.bombKind === 'time' && !it.exploded) n += 1;
  }
  return n;
}

/** T5: the survivor of the village barracks blast, sent to look at the rubble and then along the street. */
export function spawnVillageOfficer(world) {
  if (world.byId?.('e_vil_off')) return null;
  const e = new Enemy({
    id: 'e_vil_off', soldierType: 'sergeant', x: 128.5, z: 83.5, heading: deg(180),
    flags: { investigates: true, followsTracks: true },
  });
  world.add(e);
  e.brain?.reinforce?.([{ x: 126, z: 81.5 }], [{ x: 112, z: 81.5 }, { x: 126, z: 81.5 }]);
  world.events.emit('message', { text: 'Someone staggered out of the rubble!', kind: 'warn' });
  return e;
}
