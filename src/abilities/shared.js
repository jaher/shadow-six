/**
 * Shared actions (design-spec §3.2) — owned by ABILITIES:
 *   hand     H  role-gated pick-up (§3.2 table): bodies (GB, Spy), barrels (GB), items/ammo/crates, the decoy (GB),
 *               a sprung trap (Sapper), the deployed raft (Marine, packs it 2.0 s); carrying a barrel + click a body
 *               = hide the body under the barrel (§3.4). 0.6 s items, 1.0 s bodies/barrels.
 *   drop     right-click while carrying: 0.8 s, the body lies down / the barrel stands upright.
 *   firstAid K  medic (Driver → Spy → Sniper): +34 HP at 0.5 s of 1.5 s, 6 doses, walks to 1.2 m.
 *   use      (lever cursor) doors/hideouts, switches, valves, phones, ladders, clotheslines, jail doors (§3.2 durations).
 *   board    (vehicle cursor) get into a vehicle / man a gun; operator rules of §3.7 (driving itself: VEHICLES).
 * @module abilities/shared
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { canPickUp } from '../items.js';
import { timedTask, bodyNear, interactableNear, freeToAct, inShallow, dropCarried, dropSpot, enemyNear } from './common.js';
import { suspiciousAct } from './system.js';
import { ACTIVATABLE, BCD_ACTIVATABLE } from '../entities/interactables.js';
import { tryDress, dressIn, dressTask } from './spy.js';
import { takeSpot } from './spy-actions.js';
import { reviveDowned } from '../entities/downed.js';
import { isTransportable, liveLoadNear, transportMode, takeLoad, carriesMan, transportTimes, DRAG_ROLES, liftHint } from './bodies.js';

const A = CONFIG.abilities;

/**
 * What would H grab at `t` (entity or clicked point)?
 * @returns {{kind:'body'|'barrel'|'hideBody'|'item'|'raft', ent:any} | null}
 */
export function handTarget(c, t, world) {
  if (!t) return null;
  const x = t.x, z = t.z;
  const ko = !!world.rules?.knockouts; // BCD §1.1: an unconscious / cuffed man is carried like a body
  const isBody = (e) => (e.kind === 'enemy' || e.kind === 'commando') && (!e.alive || (ko && e.kind === 'enemy' && !!e.ko && !e.puppetOf));
  // BCD §1.5: a dead or unconscious soldier who still has his pack → the hand takes the pack first
  const packOf = (e) => world.rules?.cigarettes && e?.kind === 'enemy' && (!e.alive || e.ko) && (e.cigs ?? 0) > 0 && e.state !== 'carried';
  const carryingBarrel = c.carrying?.interactKind === 'barrel';
  if (carryingBarrel) {
    const b = isBody(t) ? t : bodyNear(world, x, z, 1.2);
    return b && !b.hiddenUnderBarrel ? { kind: 'hideBody', ent: b } : null;
  }
  if (c.carrying) return null;
  if (packOf(t)) return { kind: 'loot', ent: t };
  if (isBody(t) && t.state !== 'carried') return { kind: 'body', ent: t };
  if (t.kind === 'commando' && t.alive && isTransportable(t, world)) return { kind: 'body', ent: t }; // §C.1 downed buddy / cannotWalk guest
  if (t.kind === 'vehicle') return t.vehicleType === 'raft' ? { kind: 'raft', ent: t } : null;
  if (t.kind === 'interactable') return t.interactKind === 'barrel' ? { kind: 'barrel', ent: t } : { kind: 'item', ent: t };
  const it = interactableNear(world, x, z, 1.2, (i) => i.interactKind === 'barrel' || ['pickup', 'ammo', 'crate', 'decoy', 'trap'].includes(i.interactKind));
  if (it) return it.interactKind === 'barrel' ? { kind: 'barrel', ent: it } : { kind: 'item', ent: it };
  const b = bodyNear(world, x, z, 1.2) || (ko ? enemyNear(world, x, z, 1.2, (q) => !!q.ko && !q.puppetOf && q.state !== 'carried') : null);
  if (b) return packOf(b) ? { kind: 'loot', ent: b } : { kind: 'body', ent: b };
  const live = liveLoadNear(world, x, z, 1.2);
  if (live) return { kind: 'body', ent: live };
  const raft = world.vehicles.find((v) => v.vehicleType === 'raft' && !v.destroyed && Math.hypot(v.x - x, v.z - z) < 2);
  return raft ? { kind: 'raft', ent: raft } : null;
}

/** Why `c` can't pick up what handTarget found (role table §3.2), or true. */
function handAllowed(c, h, world) {
  switch (h.kind) {
    case 'body': { // §C.5: GB/Spy shoulder, anyone else drags when `dragBodies` is on
      const m = transportMode(c, null, world);
      if (m !== 'shoulder' && m !== 'drag') return m;
      return h.ent.hiddenUnderBarrel ? 'Nothing there.' : true;
    }
    case 'barrel': return h.ent.canUse(c);
    case 'hideBody': return true;
    case 'loot': return canPickUp(c.role, 'cigarettes') ? true : "Can't take that.";
    case 'raft':
      if (!canPickUp(c.role, 'raft')) return "Can't pack the raft.";
      if (h.ent.occupants?.length) return 'Someone is aboard.';
      return inShallow(world, c) || !world.groundAt(c.x, c.z).water ? true : 'Only from shallow water or the bank.';
    default: return h.ent.canUse ? h.ent.canUse(c) : "Can't pick that up.";
  }
}

registerAbility({
  id: 'hand', label: 'Hand', icon: '✋', hotkey: 'h', roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  targeting: 'point', cursor: 'hand', order: 80, group: 'hand', visibleToEnemies: false,
  range: A.hand.reach,
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.stance === 'dive') return 'Surface first.';
    const h = handTarget(c, t, world);
    if (!h) return 'Nothing to pick up.';
    return handAllowed(c, h, world);
  },
  approachPoint(c, t, world) { return handTarget(c, t, world)?.ent ?? t; },
  // the result would be a drag (not GB/Spy, dragBodies on) → the collar-pulling hand (§C.5)
  cursorFor: (c, t, world) => (handTarget(c, t, world)?.kind === 'body' && transportMode(c, null, world) === 'drag' ? 'hand_drag' : null),
  // H while dragging a man lifts him to the shoulder (§C.5)
  redirect: (c) => (carriesMan(c) && c.carryMode === 'drag' && c.world?.house?.dragBodies ? { id: 'carryToggle', target: c } : null),
  // §D.1: a lift / grab in progress is picked up again after a load with its elapsed time (bodies only)
  resume(c, t, world, a) {
    const ent = a?.data?.load != null ? world.byId(a.data.load) : null;
    if (!ent || !isTransportable(ent, world) || !a.data.mode) return null;
    return handTask(c, { kind: 'body', ent }, world, a.data.mode, a.t || 0);
  },
  start(c, t, world) {
    const h = handTarget(c, t, world);
    return handTask(c, h, world, h.kind === 'body' ? transportMode(c, null, world) : null, 0);
  },
});

/** The hand task (start or resume at `t0` s): pick up, lift / grab a man, hide a body, loot, pack the raft. */
function handTask(c, h, world, mode, t0) {
    const ent = h.ent;
    const T = transportTimes();
    const dur = h.kind === 'loot' ? CONFIG.bcd.lootTime : h.kind === 'raft' ? A.raftPack : h.kind === 'item' ? A.hand.min : h.kind === 'hideBody' ? A.carry.drop : mode === 'drag' ? T.grab : A.carry.pick;
    c.playAction(h.kind === 'item' ? 'use' : mode === 'drag' ? 'drag_grab' : mode === 'shoulder' ? 'lift_to_shoulder' : 'plant', dur);
    const lift = h.kind === 'body' ? liftHint(ent, c, mode, dur, t0) : null;
    return timedTask({
      dur, t0,
      save: h.kind === 'body' ? () => ({ load: ent.id, mode }) : null,
      tick: lift?.tick, onCancel: lift?.clear, onEnd: lift?.clear,
      steps: [{ at: dur, fn: () => {
        if (handAllowed(c, h, world) !== true) return false;
        switch (h.kind) {
          case 'body':
            if (!isTransportable(ent, world)) return false;
            return takeLoad(c, ent, mode, world);
          case 'barrel':
            ent.carriedBy = c;
            c.carrying = ent;
            c.refreshAbilities();
            return true;
          case 'hideBody': {
            const barrel = c.carrying;
            c.carrying = null;
            barrel.carriedBy = null;
            barrel.x = ent.x; barrel.z = ent.z; barrel.y = 0;
            barrel.hidesBody = ent;
            ent.hiddenUnderBarrel = true;
            ent.hiddenBody = true; // removed from perception (§3.4)
            if (ent.object3d) ent.object3d.visible = false;
            c.refreshAbilities();
            return true;
          }
          case 'loot': { // BCD §1.5
            const n = ent.cigs ?? 0;
            if (n <= 0) return false;
            ent.cigs = 0;
            c.gainItem('cigarettes', n);
            world.events.emit('message', { text: `${c.nickname}: took a pack of cigarettes.`, kind: 'info', unit: c });
            return true;
          }
          case 'raft':
            if (!ent.pack) { world.remove(ent); c.gainItem('inflatableBoat', 1); return true; }
            return ent.pack(c);
          default:
            return ent.pickUp ? ent.pickUp(c) : ent.interact(c);
        }
      } }],
    });
}

registerAbility({
  id: 'drop', label: 'Drop', icon: '⤓', hotkey: null, roles: ['greenberet', 'spy'], targeting: 'self', order: 81,
  houseRoles: { dragBodies: DRAG_ROLES }, // every dragger gets the Put down button (bodies-design §C.5)
  always: true, visibleToEnemies: false, available: (c) => !!c.carrying,
  canUse: (c) => (c.carrying ? true : 'Carrying nothing.'),
  // §D.1: a put-down / release in progress is picked up again after a load with its elapsed time
  resume(c, t, world, a) { return c.carrying ? dropTask(c, world, a?.t || 0) : null; },
  start(c, t, world) { return dropTask(c, world, 0); },
});

/** Put down / release the load (start, or resume at `t0` s). */
function dropTask(c, world, t0) {
    // §C.2 / §C.3: a drag is released in 0.6 s, a shouldered man is put down in 0.8 s (spec), a barrel stood up
    const man = carriesMan(c), drag = man && c.carryMode === 'drag';
    const dur = drag ? transportTimes().release : A.carry.drop;
    c.playAction(drag ? 'drag_release' : man ? 'put_down' : 'plant', dur);
    if (man) c.carryTransition = { kind: 'putDown', t: t0, dur, spot: dropSpot(c, 'gentle') }; // visual pairing: the load goes down with him, onto the spot
    const clear = () => { if (c.carryTransition?.kind === 'putDown') c.carryTransition = null; };
    return timedTask({
      dur, t0,
      tick: (dt, tt) => { if (c.carryTransition?.kind === 'putDown') c.carryTransition.t = tt; },
      onCancel: clear, onEnd: clear,
      steps: [{ at: dur, fn: () => { dropCarried(c, 'gentle'); c.refreshAbilities(); return true; } }],
    });
}

registerAbility({
  id: 'firstAid', label: 'First aid kit', icon: '✚', hotkey: 'k', roles: ['driver', 'spy', 'sniper'], item: 'firstAid',
  targeting: 'unit', cursor: 'syringe', order: 70, visibleToEnemies: false, range: A.firstAid.range,
  canUse(c, t, world = c.world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (!c.has('firstAid')) return 'No doses left.';
    if (!t || t.kind !== 'commando' || !t.alive) return 'Pick a wounded commando.';
    if (t.downed) { // bodies-design §C.6: K on a downed man revives him (house rule buddyRescue)
      if (!world?.house?.buddyRescue) return 'Pick a wounded commando.';
      if (t.state === 'carried' || t.carriedBy) return 'Put him down first.';
      if (t.state === 'inVehicle') return "Can't reach him there.";
      return true;
    }
    if (t.state === 'inVehicle' || t.hidden || t.state === 'hidden') return "Can't reach him there.";
    if (t.hp >= t.maxHp) return 'Not wounded.';
    return true;
  },
  // §D.1: a revive in progress is resumed after a load with its remaining time (a plain heal is not)
  resume(c, t, world) {
    if (!t?.downed || !t.alive || this.canUse(c, t, world) !== true) return null;
    const t0 = t._savedReviveT || 0;
    t._savedReviveT = 0;
    return reviveTask(c, t, world, t0);
  },
  start(c, t, world) {
    const F = A.firstAid;
    if (t.downed) return reviveTask(c, t, world);
    c.playAction('use', F.dur);
    return timedTask({
      dur: F.dur,
      steps: [{ at: F.at, fn: () => {
        if (!t.alive || !c.consume('firstAid')) return false;
        t.heal(F.heal);
        world.events.emit('message', { text: `${t.nickname} patched up (+${F.heal}).`, kind: 'info', unit: t });
        return true;
      } }],
    });
  },
});

/**
 * §C.6 revive: 4.0 s kneeling beside him (`revive_give` / `revive_receive`), one dose spent at the end, 34 HP, he gets
 * up. A hit on the medic cancels it (the dose is kept: Commando.takeDamage); he may not be moved meanwhile.
 */
function reviveTask(c, t, world, t0 = 0) {
  const full = CONFIG.bodies.downed.revive;
  const dur = Math.max(1 / 60, full - t0);
  c.playAction('revive_give', dur);
  t.reviving = { by: c, t: t0, dur: full };
  const clear = () => { if (t.reviving?.by === c) t.reviving = null; };
  return timedTask({
    dur,
    tick: (dt, tt) => {
      if (!t.alive || !t.downed || t.state === 'carried') return 'failed';
      if (t.reviving) t.reviving.t = t0 + tt;
      return undefined;
    },
    onCancel: clear, onEnd: clear,
    steps: [{ at: dur, fn: () => {
      if (!t.alive || !t.downed || !c.consume('firstAid')) return false;
      reviveDowned(t, c);
      return true;
    } }],
  });
}

/** The Spy taking a uniform off a clothesline: she walks to the spot in front of it (abilities/spy-actions.js). */
const lineTake = (c, t, world) => (t?.interactKind === 'clothesline' && c?.role === 'spy' && t.count > 0 ? takeSpot(world ?? c.world, c, t) : null);

registerAbility({
  id: 'use', label: 'Use', icon: '⚙', hotkey: null, roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  targeting: 'interactable', cursor: 'lever', order: 90, group: 'use', visibleToEnemies: false,
  // a clothesline: to the spot in front of the uniform (she settles into it as she reaches up), anything else 1.2 m
  range: (c, t, world) => (lineTake(c, t, world) ? 0.45 : 1.2),
  approachPoint(c, t, world) { return lineTake(c, t, world) ?? undefined; }, // else the usual target point
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    const bcdDevice = (world ?? c.world)?.rules?.id === 'BCD' && BCD_ACTIVATABLE.has(t?.interactKind);
    if (!t || t.kind !== 'interactable' || !(ACTIVATABLE.has(t.interactKind) || bcdDevice)) return 'Nothing to operate.';
    if (c.carrying && t.enterable) return "Can't take that inside.";
    return t.canUse(c);
  },
  start(c, t, world) {
    // §3.4 the Spy at a clothesline: takes the uniform off the line piece by piece and puts it on (spy.js dressTask)
    if (t.interactKind === 'clothesline' && c.role === 'spy' && !c.carrying && (c.stance ?? 'stand') === 'stand' && t.canUse(c) === true) {
      const task = dressTask(world, c, t);
      if (task) return task;
    }
    const dur = t.activationTime;
    c.playAction('use', dur);
    return timedTask({
      dur,
      steps: [{ at: dur, fn: () => {
        if (t.canUse(c) !== true) return false;
        if (t.enterable && c.disguised) suspiciousAct(world, c, 'door'); // §3.4 door rule
        const ok = t.interact(c);
        if (ok && t.interactKind === 'clothesline') { // §3.4 the model swaps at once (unless watched)
          if (world.rules?.spyUniformFromCaptives) dressIn(world, c, t.params?.uniform ?? 'soldier'); // BCD §1.6 typed
          else tryDress(world, c);
        }
        return ok;
      } }],
    });
  },
});

// Boarding / leaving vehicles and manning guns: VEHICLES' `enterVehicle` / `leaveVehicle` (abilities/drive.js).
