/**
 * LIGHTS OUT mission 3 "Winter Quarters" (docs/expansion/e03.md): mission-local runtime glue. The rules themselves are
 * the generic BCD set-pieces of missions/setpieces-errands.js, placed by the mission data:
 *   - the well (bcd_errand): on the hall's alarm the chief runs to his table, takes the key-table binder and drops it
 *     down the camp well — mission lost — unless a commando holds it;
 *   - the kennel (bcd_kennel): the dogs stay kennelled until an alarm; then the handler opens the kennel gate;
 *   - Oberst Ansbach and his Gestapo escort go indoors on any alarm (bcd_withdraw);
 *   - the rope ferry rides its cable (bcd_cable_ferry), the Marine at the rope;
 *   - o1 is done once a commando holds the binder (bcd_item_objective).
 * Here: the rope ferry's vehicle type (a flat punt, eight seats, hauled at walking pace), the soft-lock guard on the
 * main mast's one charge (mastChargesLeft / checkMastCharge, the mission's `bomb:exploded` trigger, as M20's T7) and
 * the mission's scenery (art/e03-dressing.js buildE03Visuals, built by Game as the load ends).
 * @module missions/scripts/e03
 */
import { registerVehicleType } from '../../entities/vehicle.js';
import '../setpieces-errands.js';
import { buildE03Visuals, fadeE03Roofs } from '../../art/e03-dressing.js';

// the rope ferry: an open punt (its men sit low), hauled along its cable; bullets do not sink it
registerVehicleType('rope_ferry', { kind: 'boat', model: 'raft', speed: 'raft', hits: null, size: [6.4, 2.8], occludes: false, seated: true, seats: 8, ferry: true });

/** The soft-lock fail: the Sapper's one charge has gone off and the main mast still stands (o2 can no longer be done). */
export const NO_CHARGE_FAIL = 'WITHOUT THE CHARGE THE MAIN MAST CANNOT BE DROPPED.';

/**
 * Charges that can still drop the main mast. It falls to a demolition charge on its mark and to nothing else (`bombOnly`:
 * grenades do not touch it, and the map has no barrel), and the kit holds one remote charge. Counted generously, so the
 * guard never fails early: time or remote bombs in any commando's knapsack, lying on the ground or in a crate, set and
 * not yet gone off (taken back, a charge goes into the knapsack: counted either way), or in flight as a projectile.
 * @param {import('../../world/world.js').World} world
 * @returns {number}
 */
export function mastChargesLeft(world) {
  let n = 0;
  for (const c of world.commandos || []) n += (c.inventory?.get?.('remoteBomb') ?? 0) + (c.inventory?.get?.('timeBomb') ?? 0);
  for (const it of world.interactables || []) {
    if (it.removed) continue;
    if (it.interactKind === 'bomb' && it.placed) n += 1;
    else if (it.interactKind === 'pickup' && (it.itemId === 'remoteBomb' || it.itemId === 'timeBomb')) n += it.count ?? 1;
    else if (it.interactKind === 'crate') n += (it.contents?.remoteBomb ?? 0) + (it.contents?.timeBomb ?? 0);
  }
  for (const p of world.projectiles || []) if (!p.removed && p.alive !== false && (p.projKind === 'remoteBomb' || p.projKind === 'timeBomb')) n += 1;
  return n;
}

/**
 * The guard (the mission's `bomb:exploded` trigger, 0.5 s after the blast): the main mast standing and no charge left
 * to bring it down → the mission fails (M7 T6, M13 T7, M14 T4, M20 T7 do the same) instead of running on, unwinnable.
 * @returns {boolean} it failed the mission
 */
export function checkMastCharge(world, dir) {
  const mast = world.byId?.('mast_c');
  if (!mast || mast.destroyed || world.scriptFail) return false;
  if (mastChargesLeft(world) > 0) return false;
  dir?.fail?.(NO_CHARGE_FAIL);
  return true;
}

/** mission.script: installed once per world (a quick load runs it again on the rebuilt world). */
export function e03Script(world) {
  if (buildE03Visuals(world)) world.onBelTick(() => fadeE03Roofs(world)); // (visual only: the roofs over a commando)
}
// the mission's scenery alone: built by Game as the load ends, found built by the script (idempotent, no sim state)
e03Script.visuals = (world) => buildE03Visuals(world);
