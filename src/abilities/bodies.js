/**
 * Drag and shoulder carry (docs/bodies-design.md §C.1–§C.5), owned by ABILITIES. Transport helpers shared with
 * `hand` / `drop` / `firstAid` in shared.js, plus two house-rule abilities (both `houseRule: 'dragBodies'`, so the
 * 1998 lists stay pinned under `classic1998` and in every BEL enumeration):
 *   drag         Shift+H  (binding `dragBody`): the hand cursor latched in DRAG mode for any commando.
 *   carryToggle  H while dragging = lift to the shoulder (GB/Spy, 1.0 s); Shift+H while shouldering = lower to a
 *                drag (0.8 s). The Lift / Drag buttons of the action bar issue it too.
 * A transported man keeps `state 'carried'` + `carriedBy` in both modes; the transporter has `carrying` and
 * `carryMode ∈ {'shoulder','drag'}`. Events: `load:picked {carrier, load, mode}`, `load:mode {carrier, mode}`,
 * `load:dropped {carrier, load, how}` (the last from common.dropCarried).
 * @module abilities/bodies
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { canPickUp } from '../items.js';
import { timedTask, freeToAct, bodyNear, enemyNear } from './common.js';
import { suspiciousAct } from './system.js';

/** The six commandos (guests never transport anyone, §C.1). */
export const DRAG_ROLES = Object.freeze(['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy']);

/** May `c` put a man on his shoulders (the 1998 table: GB + Spy)? */
export const canShoulder = (c) => canPickUp(c?.role, 'body');

/** May `c` drag a man (house rule `dragBodies`, any of the six)? */
export const canDrag = (c, world = c?.world) => !!world?.house?.dragBodies && DRAG_ROLES.includes(c?.role);

/**
 * Is `u` a man a commando may move (§C.1): a body, a BCD knock-out / cuffed man, a DOWNED commando or guest, a guest
 * who can't walk. Not one that is already carried or hidden under a barrel.
 */
export function isTransportable(u, world) {
  if (!u || (u.kind !== 'enemy' && u.kind !== 'commando') || u.removed) return false;
  if (u.state === 'carried' || u.carriedBy || u.hiddenUnderBarrel || u.state === 'inVehicle') return false;
  if (!u.alive) return true;
  if (u.kind === 'enemy') return !!world?.rules?.knockouts && !!u.ko && !u.puppetOf;
  return !!u.downed || (!!u.cannotWalk && u.state !== 'jailed');
}

/** Living transportable man (downed buddy, cannotWalk guest) nearest to (x, z) within r. */
export function liveLoadNear(world, x, z, r = 1.2) {
  let best = null, bd = Infinity;
  for (const u of world.commandos) {
    if (!u.alive || !(u.downed || u.cannotWalk) || !isTransportable(u, world)) continue;
    const d = Math.hypot(u.x - x, u.z - z);
    if (d <= r && d < bd) { best = u; bd = d; }
  }
  return best;
}

/**
 * The man H / Shift+H would move for a click (entity or point), or null: the clicked man, else the nearest body,
 * knock-out or live load within 1.2 m.
 */
export function findLoad(world, t) {
  if (!t) return null;
  if (isTransportable(t, world)) return t;
  if (t.kind && t.kind !== 'terrain') return null;
  const x = t.x, z = t.z;
  const b = bodyNear(world, x, z, 1.2);
  if (b && isTransportable(b, world)) return b;
  const ko = world.rules?.knockouts ? enemyNear(world, x, z, 1.2, (q) => isTransportable(q, world)) : null;
  return ko || liveLoadNear(world, x, z, 1.2);
}

/**
 * Transport mode for picking up a man: 'shoulder' | 'drag' | a refusal string. `force` = 'drag' (Shift+H).
 * @returns {'shoulder'|'drag'|string}
 */
export function transportMode(c, force = null, world = c?.world) {
  if (force === 'drag') return canDrag(c, world) ? 'drag' : "Can't drag bodies.";
  if (canShoulder(c)) return 'shoulder';
  if (canDrag(c, world)) return 'drag';
  return "Can't carry bodies.";
}

/** Durations of the transitions (s). */
export function transportTimes() {
  const A = CONFIG.abilities.carry, D = CONFIG.bodies.drag;
  return { lift: A.pick, grab: D.grab, putDown: A.drop, release: D.release, toShoulder: D.toShoulder, toDrag: D.toDrag };
}

/**
 * Take `ent` up (the end of the pick-up / grab task). Keeps the pre-existing API: `state 'carried'`, `carriedBy`,
 * `c.carrying`; adds `c.carryMode`. A live load (downed buddy) stops whatever he was doing.
 */
export function takeLoad(c, ent, mode, world = c.world) {
  if (ent.alive) { ent.stop?.(); ent.cancelAction?.(); if (ent.pendingAbility) ent.pendingAbility = null; }
  ent._preCarryState = ent.alive ? ent.state : null;
  ent.state = 'carried';
  ent.carriedBy = c;
  c.carrying = ent;
  c.carryMode = mode;
  if (c.stance !== 'stand') c.setStance('stand');
  if (c.disguised) suspiciousAct(world, c, 'carry');
  c.refreshAbilities();
  world?.events.emit('load:picked', { carrier: c, load: ent, mode });
  return true;
}

/** Visual pairing of a pick-up (bodies-design §C.10): the load follows the lift / grab clip (`pendingLift`). */
export function liftHint(ent, c, mode, dur, t0 = 0) {
  ent.pendingLift = { by: c, mode, t: t0, dur };
  c.pendingTransport = ent; // the lifter's hands empty (unit-model)
  return {
    tick: (dt, tt) => { if (ent.pendingLift?.by === c) ent.pendingLift.t = tt; },
    clear: () => { if (ent.pendingLift?.by === c) ent.pendingLift = null; if (c.pendingTransport === ent) c.pendingTransport = null; },
  };
}

/** True when `c` transports a man (not a barrel). */
export const carriesMan = (c) => !!c?.carrying && c.carrying.kind !== 'interactable';

registerAbility({
  id: 'drag', label: 'Drag', icon: '⇤', hotkey: null, roles: [...DRAG_ROLES], houseRule: 'dragBodies',
  targeting: 'point', cursor: 'hand_drag', order: 79, group: 'hand', visibleToEnemies: false, notOriginal: true,
  range: CONFIG.abilities.hand.reach,
  // Shift+H while shouldering a man lowers him to a drag (§C.5)
  redirect: (c) => (carriesMan(c) && c.carryMode === 'shoulder' ? { id: 'carryToggle', target: c } : null),
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.carrying) return 'Drop it first.';
    if (c.stance === 'dive') return 'Surface first.';
    const h = findLoad(world, t);
    if (!h) return 'Nothing to drag.';
    const m = transportMode(c, 'drag', world);
    return m === 'drag' ? true : m;
  },
  approachPoint(c, t, world) { return findLoad(world, t) ?? t; },
  // §D.1: a grab in progress is picked up again after a load with its elapsed time
  resume(c, t, world, a) {
    const ent = a?.data?.load != null ? world.byId(a.data.load) : null;
    return ent && isTransportable(ent, world) ? grabTask(c, ent, world, a.t || 0) : null;
  },
  start(c, t, world) { return grabTask(c, findLoad(world, t), world, 0); },
});

/** Drag grab (start, or resume at `t0` s): kneel at his head, hook the armpits, haul. */
function grabTask(c, ent, world, t0) {
    const T = transportTimes();
    c.playAction('drag_grab', T.grab);
    const lift = liftHint(ent, c, 'drag', T.grab, t0); // visual pairing (§C.10)
    return timedTask({
      dur: T.grab, t0, save: () => ({ load: ent.id }),
      tick: lift.tick, onCancel: lift.clear, onEnd: lift.clear,
      steps: [{ at: T.grab, fn: () => (isTransportable(ent, world) && canDrag(c, world) ? takeLoad(c, ent, 'drag', world) : false) }],
    });
}

registerAbility({
  id: 'carryToggle', label: 'Lift / Drag', icon: '⇅', hotkey: null, roles: [...DRAG_ROLES], houseRule: 'dragBodies',
  targeting: 'self', order: 82, visibleToEnemies: false, always: true, notOriginal: true,
  available: (c) => carriesMan(c),
  canUse(c) {
    if (!carriesMan(c)) return 'Carrying nothing.';
    if (c.carryMode === 'drag' && !canShoulder(c)) return 'Only the Green Beret and the Spy can shoulder a man.';
    return true;
  },
  // §D.1: a lift / lower in progress is picked up again after a load with its elapsed time (the saved carryMode is the
  // mode it started from)
  resume(c, t, world, a) { return carriesMan(c) ? toggleTask(c, world, a?.t || 0) : null; },
  start(c, t, world) { return toggleTask(c, world, 0); },
});

/** Drag ⇄ shoulder switch (start, or resume at `t0` s). */
function toggleTask(c, world, t0) {
    const T = transportTimes();
    const to = c.carryMode === 'drag' ? 'shoulder' : 'drag';
    const dur = to === 'shoulder' ? T.toShoulder : T.toDrag;
    c.playAction(to === 'shoulder' ? 'drag_to_shoulder' : 'shoulder_to_drag', dur);
    c.carryTransition = { kind: to === 'shoulder' ? 'toShoulder' : 'toDrag', t: t0, dur };
    return timedTask({
      dur, t0,
      tick: (dt, tt) => { if (c.carryTransition) c.carryTransition.t = tt; },
      onCancel: () => { c.carryTransition = null; },
      onEnd: () => { c.carryTransition = null; },
      steps: [{ at: dur, fn: () => {
        if (!carriesMan(c)) return false;
        c.carryMode = to;
        c.refreshAbilities();
        world.events.emit('load:mode', { carrier: c, mode: to });
        return true;
      } }],
    });
}
