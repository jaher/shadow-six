/**
 * BEL M17 "Before Dawn" mission glue (docs/missions/m17.md §5.4, §7, §13). Owned by MISSIONS.
 *  - the back gate is `locked` (no hand opens it, dossier §5.2) but the `gate_control` box must still swing it:
 *    Interactable.setOpen refuses a locked door, so the box's 'door' event unlocks, moves and relocks it here;
 *  - D1: the five prisoners stay drawn behind the wire while jailed (the engine hides jailed units); they are
 *    still not selectable, not seen and not hit until the pen door frees them;
 *  - the pen gate swings open once the prisoners are out (cosmetic, as M10's pen).
 * @module missions/scripts/m17
 */
import { CONFIG } from '../../config.js';

/** The five prisoners: Claude Gilbert heads the file, fr1–fr4 follow in single file (§3.5). */
export const GUESTS = Object.freeze(['gilbert', 'fr1', 'fr2', 'fr3', 'fr4']);

/** The door interactable of gate structure `id` (tagged with the structure id by the map builder). */
export function gateDoor(world, id) {
  return (world.interactables || []).find((i) => i.interactKind === 'door' && !i.enterable
    && (i.tag === id || i.params?.structure?.id === id)) || null;
}

/** Open / shut a locked gate from its control (the lock only refuses hands). @returns {boolean} */
export function setLockedGate(world, id, open) {
  const d = gateDoor(world, id);
  if (!d) return false;
  const was = d.locked;
  d.locked = false;
  const ok = d.open === !!open || d.setOpen(!!open);
  d.locked = was;
  return !!ok;
}

/** Open the pen gate once the prisoners are free. */
export function openPen(world) {
  const d = gateDoor(world, 'pen_gate');
  if (d) { d.locked = false; d.setOpen(true); }
}

/** A freed prisoner steps to his own place in a line 1 m apart along the cage's S side, W to E, centred on the jail
 *  door (the engine frees every jailed man onto the one door point, stacked). @returns {boolean} */
export function lineUp(world, unit) {
  const k = Math.max(GUESTS.indexOf(unit?.tag), GUESTS.indexOf(unit?.id));
  const jail = (world.interactables || []).find((i) => i.interactKind === 'jail' && (i.tag === 'pen_door' || i.id === 'pen_door'));
  if (k < 0 || !jail || unit.alive === false) return false;
  const a = (332 * Math.PI) / 180, s = (k - 2) * 1.0; // along the S side (the camp's u axis)
  const x = jail.x + Math.cos(a) * s, z = jail.z + Math.sin(a) * s;
  if (world.grid && !world.grid.walkableAt(x, z)) return false;
  if (unit.setPosition) unit.setPosition(x, z); else { unit.x = x; unit.z = z; }
  return true;
}

/** T6: a north-bank alarm sounds the camp's siren too, raised where the north one was (not at the map origin). */
export function northAlarm(world, p) {
  return world.alarm?.fireEvent('RINT', { cause: 'script', x: p?.x ?? 0, z: p?.z ?? 0 });
}

/** D1: keep the jailed prisoners visible behind the mesh. */
export function showCaged(world) {
  for (const c of world.commandos || []) {
    if (c.role === 'guest' && c.state === 'jailed' && c.object3d) c.object3d.visible = true;
  }
}

/** Everyone alive (commandos and prisoners) aboard vehicle `id`? */
export function allAboard(world, id) {
  const v = world.byId?.(id);
  if (!v) return false;
  const men = (world.commandos || []).filter((c) => c.alive !== false && !c.removed);
  return men.length > 0 && men.every((c) => (v.occupants || []).includes(c) || c.vehicle === v);
}

/** States in which a T4 runner is already busy with something better (as enemy-brain BUSY). */
const BUSY_T4 = new Set(['CHALLENGE', 'HOLD', 'ARREST', 'COMBAT', 'BODY', 'ALARM_RUN', 'DEAD']);

/**
 * T4 the pillbox blown: each sent man runs to his own spot by the rubble, looks about and goes home (Prima: "two
 * going E, two coming back"; Kildread: the Spy waits there for them). A patrol goes by its leader, the file
 * following. `spots`: [[x, z]…] by order of `ids`.
 */
export function investigateBlast(world, ids, spots) {
  ids.forEach((id, k) => {
    const e = world.byId(id), b = e?.brain;
    if (!e?.alive || !b?._startInvestigate || BUSY_T4.has(b.state)) return; // the blast's own alert does not count
    const lead = b._leader?.();
    if (lead && lead !== e && lead.alive) return; // squad members follow their leader
    const [x, z] = spots[k % spots.length];
    b._startInvestigate(x, z, CONFIG.ai.investigate.runSpeed);
  });
}
