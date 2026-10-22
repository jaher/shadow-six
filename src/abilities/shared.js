/**
 * Shared actions (design-spec §3.2) — owned by ABILITIES:
 *   hand     H  role-gated pick-up (§3.2 table): bodies (GB, Spy), barrels (GB), items/ammo/crates, the decoy (GB),
 *               a sprung trap (Sapper), the deployed raft (Marine: deflates it, in his kit at 2.0 s, then folds and
 *               shoulders the pack, 3.6 s in all — raftPackTask); carrying a barrel + click a body
 *               = hide the body under the barrel (§3.4). 0.6 s items, 1.0 s bodies/barrels. On a placed time / remote
 *               bomb the order goes on to the Sapper's takeCharge (house rule recoverCharges, abilities/sapper.js).
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
import { bodyGap, hasObstacles } from '../world/body-clearance.js';
import { wrapAngle } from '../core/math.js';
import { suspiciousAct } from './system.js';
import { ACTIVATABLE, BCD_ACTIVATABLE } from '../entities/interactables.js';
import { tryDress, dressIn, dressTask } from './spy.js';
import { takeSpot } from './spy-actions.js';
import { reviveDowned } from '../entities/downed.js';
import { isTransportable, liveLoadNear, transportMode, takeLoad, carriesMan, transportTimes, DRAG_ROLES, liftHint } from './bodies.js';
import { structureEntry, entryTask, ENTRY_REACH } from './bunker-entry.js';
import { RAFT, raftTimes, pushRaftAct } from './raft-actions.js';

const A = CONFIG.abilities;
const BAR = A.carry.barrel;
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** The longest clear step (m, ≤ len, 5 cm steps) from where `c` stands along (ux, uz): walkable, level, his body clear of solids. */
function clearStep(world, c, ux, uz, len, facing = Math.atan2(uz, ux)) {
  const g = world?.grid, e0 = g?.elevAt ? g.elevAt(c.x, c.z) : 0, solids = !!world && hasObstacles(world);
  const clear = (s) => {
    const x = c.x + ux * s, z = c.z + uz * s;
    if (g && (!g.walkableAt(x, z) || (g.elevAt && Math.abs(g.elevAt(x, z) - e0) > 0.05))) return false;
    return !solids || bodyGap(world, x, z, facing, 'stand') >= 0;
  };
  for (; len > 0.02; len -= 0.05) {
    let ok = true;
    for (let k = 1; k <= 4 && ok; k++) ok = clear((len * k) / 4);
    if (ok) return len;
  }
  return 0;
}

/**
 * The pick-up's step in to a drum (user 2026-10-22: "he bends/crouches to the drum, his hands reach it"): he stops
 * `carry.reach` short of it (a drum is solid, his body keeps clear of it on the way) — too far to take it — so the
 * pick-up steps him straight in until its centre is `barrel.stand` m ahead, over the first `barrel.step` s (eased; the
 * barrel_lift clip steps the same distance). As far as the way is clear (walkable, level, his body clear of solids —
 * the drum included), else a shorter step or none. Deterministic. @returns {{from:{x:number,z:number}, ux:number,
 * uz:number, len:number, t0:number, t1:number}|null}
 */
export function barrelStep(world, c, b) {
  const dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz);
  if (!(d > BAR.stand + 0.02)) return null;
  const ux = dx / d, uz = dz / d, len = clearStep(world, c, ux, uz, d - BAR.stand);
  return len > 0 ? { from: { x: c.x, z: c.z }, ux, uz, len, t0: 0, t1: BAR.step } : null;
}

/** The step back off a drum just stood down (`barrel.back` m from `barrel.backAt` s to the end), as far as it is clear. */
function barrelBack(world, c, dur) {
  const ux = -Math.cos(c.heading), uz = -Math.sin(c.heading), len = clearStep(world, c, ux, uz, BAR.back, c.heading);
  return len > 0 ? { from: { x: c.x, z: c.z }, ux, uz, len, t0: BAR.backAt, t1: dur } : null;
}
/** Move `c` along a planned step at task time tt (eased). */
function stepTo(c, st, tt) {
  const k = smooth((tt - st.t0) / (st.t1 - st.t0)) * st.len;
  c.x = st.from.x + st.ux * k; c.z = st.from.z + st.uz * k;
}

/** Visual pairing of a drum changing hands (art/barrel-carry.js): `key` pendingLift / pendingDrop on the drum. */
function barrelHint(b, c, key, dur, t0, spot = null) {
  b[key] = { by: c, t: t0, dur, spot };
  return {
    tick: (dt, tt) => { if (b[key]?.by === c) b[key].t = tt; },
    clear: () => { if (b[key]?.by === c) b[key] = null; },
  };
}

/** Where he stands to lay the drum he carries over a body: `drop` m short of it on his side, or null (not walkable). */
function hideStand(c, body, world) {
  const dx = c.x - body.x, dz = c.z - body.z, d = Math.hypot(dx, dz) || 1;
  const p = { x: body.x + (dx / d) * DROP_AHEAD, z: body.z + (dz / d) * DROP_AHEAD };
  return world?.grid && !world.grid.walkableAt(p.x, p.z) ? null : p;
}
/** abilities/common.js dropSpot: a drum is stood down this far ahead of him (the barrel_put_down clip's distance). */
const DROP_AHEAD = 0.6;

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
  const it = interactableNear(world, x, z, 1.2, (i) => i.interactKind === 'barrel' || ['pickup', 'ammo', 'crate', 'decoy', 'trap'].includes(i.interactKind)
    || (i.interactKind === 'bomb' && i.placed));
  if (it) return it.interactKind === 'barrel' ? { kind: 'barrel', ent: it } : { kind: 'item', ent: it };
  const b = bodyNear(world, x, z, 1.2) || (ko ? enemyNear(world, x, z, 1.2, (q) => !!q.ko && !q.puppetOf && q.state !== 'carried') : null);
  if (b) return packOf(b) ? { kind: 'loot', ent: b } : { kind: 'body', ent: b };
  const live = liveLoadNear(world, x, z, 1.2);
  if (live) return { kind: 'body', ent: live };
  const raft = world.vehicles.find((v) => v.vehicleType === 'raft' && !v.destroyed && Math.hypot(v.x - x, v.z - z) < 2);
  return raft ? { kind: 'raft', ent: raft } : null;
}

/**
 * An item lying inside a building with a walk-in (item `inside`: the structure id; M3's station shed: the charges on
 * its threshing floor, up the ramp and through the barn door): its entry (abilities/bunker-entry.js), or null. Such an
 * item is only reached through that entry — from the outer end of its path he walks in, kneels, takes it, walks out.
 */
export function insideEntry(world, ent) {
  const id = ent?.params?.inside;
  return id != null && ent.interactKind !== 'bomb' ? structureEntry(world, id) : null;
}

/** The walk in for an item inside a building (start, or resume from `a`): in, kneel, take it, out. */
function insideTakeTask(c, ent, world, ie, a = null) {
  const T = A.chargeTake ?? { grab: 0.5, dur: 1.0 }, n0 = a?.data?.n ?? ent.count ?? 1;
  return entryTask(c, world, ie.it, ie.entry, () => {
    if (ent.alive !== false && ent.count > 0 && (ent.canUse ? ent.canUse(c) === true : true)) { if (ent.pickUp) ent.pickUp(c); else ent.interact(c); }
    return true; // whatever he found, he walks back out
    // (a take per piece: the M3 shed's two charges, one after the other)
  }, { t0: a?.t ?? 0, data: a?.data ?? null, anim: 'take_charge', actAt: T.grab, actDur: T.dur * Math.max(1, Math.min(3, a?.data?.n ?? ent.count ?? 1)),
    save: () => ({ inside: ie.it.tag, item: ent.id, n: n0 }) });
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
  // an item inside a building: to the outer end of its walk-in (abilities/bunker-entry.js), not to the item
  // (a drum over a body: to the spot `DROP_AHEAD` short of it, where the set-down puts the drum on him)
  range: (c, t, world) => {
    const w = world ?? c.world, h = w ? handTarget(c, t, w) : null;
    if (h?.kind === 'hideBody' && hideStand(c, h.ent, w)) return 0.08;
    return w && insideEntry(w, h?.ent) ? ENTRY_REACH - 0.2 : A.hand.reach;
  },
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.stance === 'dive') return 'Surface first.';
    const h = handTarget(c, t, world);
    if (!h) return 'Nothing to pick up.';
    const ie = insideEntry(world, h.ent);
    if (ie?.it.destroyed) return 'Nothing left in there.';
    return handAllowed(c, h, world);
  },
  approachPoint(c, t, world) {
    const h = handTarget(c, t, world), ent = h?.ent;
    if (h?.kind === 'hideBody') return hideStand(c, ent, world) ?? ent;
    const ie = insideEntry(world, ent);
    return ie ? { x: ie.entry.path[0][0], z: ie.entry.path[0][1] } : ent ?? t;
  },
  // H on a placed charge: the Sapper's takeCharge does it (its walk-up, kneel and timing; Commando.useAbility `forward`)
  forward(c, t, world) {
    const ent = handTarget(c, t, world)?.ent;
    return ent?.interactKind === 'bomb' ? { id: 'takeCharge', target: ent } : null;
  },
  // the result would be a drag (not GB/Spy, dragBodies on) → the collar-pulling hand (§C.5)
  cursorFor: (c, t, world) => (handTarget(c, t, world)?.kind === 'body' && transportMode(c, null, world) === 'drag' ? 'hand_drag' : null),
  // H while dragging a man lifts him to the shoulder (§C.5)
  redirect: (c) => (carriesMan(c) && c.carryMode === 'drag' && c.world?.house?.dragBodies ? { id: 'carryToggle', target: c } : null),
  // §D.1: a lift / grab in progress is picked up again after a load with its elapsed time (bodies only)
  resume(c, t, world, a) {
    // a walk into a building for an item: back on its way (he must not be left in there)
    if (a?.data?.inside != null) {
      const it = a.data.item != null ? world.byId(a.data.item) : null, ie = structureEntry(world, a.data.inside);
      return it && ie ? insideTakeTask(c, it, world, ie, a) : null;
    }
    const ent = a?.data?.load != null ? world.byId(a.data.load) : null;
    if (!ent || !isTransportable(ent, world) || !a.data.mode) return null;
    return handTask(c, { kind: 'body', ent }, world, a.data.mode, a.t || 0);
  },
  start(c, t, world) {
    const h = handTarget(c, t, world);
    const ie = h.kind === 'item' ? insideEntry(world, h.ent) : null;
    if (ie) return insideTakeTask(c, h.ent, world, ie);
    return handTask(c, h, world, h.kind === 'body' ? transportMode(c, null, world) : null, 0);
  },
});

/** The hand task (start or resume at `t0` s): pick up, lift / grab a man, hide a body, loot, pack the raft. */
function handTask(c, h, world, mode, t0) {
    const ent = h.ent;
    if (h.kind === 'raft') return raftPackTask(c, h, world);
    const T = transportTimes();
    const dur = h.kind === 'loot' ? CONFIG.bcd.lootTime : h.kind === 'raft' ? A.raftPack : h.kind === 'item' ? A.hand.min : h.kind === 'hideBody' ? A.carry.drop : mode === 'drag' ? T.grab : A.carry.pick;
    // a drum: he faces it, steps in to it and squats, his hands on its sides, and stands up with it (barrel_lift); laid
    // over a body: lowered onto him (barrel_put_down) — the drum on his hands meanwhile (art/barrel-carry.js)
    const drum = h.kind === 'barrel' ? ent : h.kind === 'hideBody' ? c.carrying : null;
    if (drum) c.faceTowards?.(ent.x, ent.z);
    // (the clip is played the tick the task starts: one tick longer, it ends with the task, not a tick of idle before
    // the hold — the drum on his hands would drop to the ground for that frame)
    c.playAction(h.kind === 'item' ? 'use' : h.kind === 'barrel' ? 'barrel_lift' : h.kind === 'hideBody' ? 'barrel_put_down' : mode === 'drag' ? 'drag_grab' : mode === 'shoulder' ? 'lift_to_shoulder' : 'plant', drum ? dur - t0 + CONFIG.sim.dt : dur);
    const step = t0 > 0 ? null : h.kind === 'barrel' ? barrelStep(world, c, ent) : h.kind === 'hideBody' ? barrelBack(world, c, dur) : null;
    const lift = h.kind === 'body' ? liftHint(ent, c, mode, dur, t0)
      : h.kind === 'barrel' ? barrelHint(ent, c, 'pendingLift', dur, t0)
        : h.kind === 'hideBody' ? barrelHint(drum, c, 'pendingDrop', dur, t0, { x: ent.x, z: ent.z }) : null;
    const tick = step ? (dt, tt) => { stepTo(c, step, tt); lift.tick(dt, tt); } : lift?.tick;
    return timedTask({
      dur, t0,
      save: h.kind === 'body' ? () => ({ load: ent.id, mode }) : null,
      tick, onCancel: lift?.clear, onEnd: lift?.clear,
      steps: [{ at: dur, fn: () => {
        if (handAllowed(c, h, world) !== true) return false;
        switch (h.kind) {
          case 'body':
            if (!isTransportable(ent, world)) return false;
            return takeLoad(c, ent, mode, world);
          case 'barrel':
            ent.carriedBy = c;
            c.carrying = ent;
            ent.carrySpin = wrapAngle((ent.heading || 0) - (c.heading || 0)); // its turn about its axis in his hands
            c.refreshAbilities();
            return true;
          case 'hideBody': {
            const barrel = c.carrying;
            c.carrying = null;
            barrel.carriedBy = null;
            barrel.x = ent.x; barrel.z = ent.z; barrel.y = 0;
            barrel.heading = wrapAngle((c.heading || 0) + (barrel.carrySpin || 0)); // stood down as he held it
            barrel.carrySpin = 0;
            barrel.snap?.();
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
          default:
            return ent.pickUp ? ent.pickUp(c) : ent.interact(c);
        }
      } }],
    });
}

/**
 * H on the raft (§3.4; user 2026-10-14 "the marine very quickly deflated and folds the raft", abilities/raft-actions.js):
 * he kneels facing it, opens the valve (the hiss), the chambers collapse, he drags the flat hull to his knees — at
 * raftPack (2.0 s, as before) the raft leaves the sim and is in his kit — then folds it, gathers it into a pack and
 * shoulders it (raftFold, 1.6 s). Interruptible throughout, as before (drawn by art/raft-actions.js).
 */
function raftPackTask(c, h, world) {
  const ent = h.ent, T = raftTimes('pack');
  c.faceTowards?.(ent.x, ent.z);
  const rec = pushRaftAct(world, { kind: 'pack', a: c, raft: ent, from: { x: c.x, z: c.z, h: Math.atan2(ent.z - c.z, ent.x - c.x) }, T, t0: world.time + CONFIG.sim.dt });
  c.playAction('plant', T.dur);
  return timedTask({
    dur: T.dur, phases: T.phases, present: true,
    onCancel: () => { rec.cancelled = world.time; },
    onEnd: (r) => { rec.ended = world.time; rec.result = r; },
    steps: [
      { at: RAFT.pack.open, fn: () => { // the valve open: the hiss as the air goes out
        if (!ent.removed) world.events.emit('raft:hiss', { unit: c, x: ent.x, z: ent.z, kind: 'deflate', dur: RAFT.pack.flat - RAFT.pack.open });
        return true;
      } },
      { at: T.gone, fn: () => {
        if (handAllowed(c, h, world) !== true) return false;
        if (ent.pack) { if (!ent.pack(c)) return false; } else { world.remove(ent); c.gainItem('inflatableBoat', 1); }
        rec.gone = world.time;
        return true;
      } },
    ],
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
    const drum = c.carrying?.interactKind === 'barrel' ? c.carrying : null;
    const dur = drag ? transportTimes().release : A.carry.drop;
    c.playAction(drag ? 'drag_release' : man ? 'put_down' : drum ? 'barrel_put_down' : 'plant', drum ? dur - t0 + CONFIG.sim.dt : dur);
    if (man) c.carryTransition = { kind: 'putDown', t: t0, dur, spot: dropSpot(c, 'gentle') }; // visual pairing: the load goes down with him, onto the spot
    // a drum is lowered in his hands onto the spot ahead of him (art/barrel-carry.js), and he steps back off it — the
    // spot is fixed where he stood when he began
    const spot = drum ? dropSpot(c, 'gentle') : null;
    const hint = drum ? barrelHint(drum, c, 'pendingDrop', dur, t0, spot) : null;
    const back = drum && t0 === 0 ? barrelBack(world, c, dur) : null;
    const clear = () => { if (c.carryTransition?.kind === 'putDown') c.carryTransition = null; hint?.clear(); };
    return timedTask({
      dur, t0,
      tick: (dt, tt) => { if (c.carryTransition?.kind === 'putDown') c.carryTransition.t = tt; hint?.tick(dt, tt); if (back) stepTo(c, back, tt); },
      onCancel: clear, onEnd: clear,
      steps: [{ at: dur, fn: () => { dropCarried(c, 'gentle', spot); c.refreshAbilities(); return true; } }],
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

/**
 * A Spy lying by a clothesline: up on her feet (CONFIG.units.stanceUp), then the take and the dressing (dressTask). One
 * task (interruptible, as the dressing): the walkthrough director reads its length and phases (actionClock).
 */
function standThenDress(world, c, line) {
  const up = CONFIG.units.stanceUp;
  c.setStance('stand');
  let inner = null, tt = 0;
  return {
    interruptible: true,
    present: true,
    get t() { return tt; },
    get dur() { return up + (inner ? inner.dur : 0); },
    get phases() { return inner ? [['stand', 0, up], ...inner.phases.map(([n, a, b]) => [n, a + up, b + up])] : [['stand', 0, up]]; },
    get phase() { return inner ? inner.phase : 'stand'; },
    update(dt) {
      tt += dt;
      if (inner) return inner.update(dt);
      if (tt < up - 1e-9 || c.stance !== 'stand') return 'running';
      inner = line.canUse(c) === true ? dressTask(world, c, line, { afterStand: true }) : null;
      return inner ? 'running' : 'failed';
    },
    cancel() { inner?.cancel?.(); },
  };
}

/** The Spy taking a uniform off a clothesline: she walks to the spot in front of it (abilities/spy-actions.js). */
const lineTake = (c, t, world) => (t?.interactKind === 'clothesline' && c?.role === 'spy' && t.count > 0 ? takeSpot(world ?? c.world, c, t) : null);
/**
 * A switch station's lever (world/switch-station.js): the spot in front of it the operator stands on, facing the kiosk
 * (his left hand on the lever), when it is free to stand on; else null (the switch point, as any device).
 */
const standSpot = (c, t, world) => {
  const s = t?.params?.stand, g = (world ?? c?.world)?.grid;
  return s && (!g?.walkableAt || g.walkableAt(s.x, s.z)) ? s : null;
};

registerAbility({
  id: 'use', label: 'Use', icon: '⚙', hotkey: null, roles: ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'],
  targeting: 'interactable', cursor: 'lever', order: 90, group: 'use', visibleToEnemies: false,
  // a clothesline: to the spot in front of the uniform (she settles into it as she reaches up); a switch station: onto
  // the spot in front of its lever; anything else 1.2 m
  // (onto the stand spot while walking; once he has stopped, a step short of it is close enough)
  range: (c, t, world) => (lineTake(c, t, world) ? 0.45 : standSpot(c, t, world) ? (c.path || c.isMoving ? 0.05 : 0.4) : 1.2),
  approachPoint(c, t, world) { return lineTake(c, t, world) ?? standSpot(c, t, world) ?? undefined; }, // else the usual target point
  canUse(c, t, world) {
    const f = freeToAct(c);
    if (f !== true) return f;
    const bcdDevice = (world ?? c.world)?.rules?.id === 'BCD' && BCD_ACTIVATABLE.has(t?.interactKind);
    if (!t || t.kind !== 'interactable' || !(ACTIVATABLE.has(t.interactKind) || bcdDevice)) return 'Nothing to operate.';
    if (c.carrying && t.enterable) return "Can't take that inside.";
    return t.canUse(c);
  },
  start(c, t, world) {
    // §3.4 the Spy at a clothesline: takes the uniform off the line piece by piece and puts it on (spy.js dressTask);
    // lying by it she gets up first (the line hangs at 1.8 m: user 2026-10-14 "animate better how the spy grabs the
    // clothes" — the walkthrough's Spy crawled up to it and took it lying down in 1.5 s)
    if (t.interactKind === 'clothesline' && c.role === 'spy' && !c.carrying && t.canUse(c) === true) {
      const st = c.stance ?? 'stand';
      if (st === 'stand') { const task = dressTask(world, c, t); if (task) return task; }
      else if (st === 'crawl' && takeSpot(world, c, t)) return standThenDress(world, c, t);
    }
    // at a switch station he faces the kiosk, on his feet (a crawler stands up first: the lever is at chest height)
    const spot = standSpot(c, t, world);
    let up = 0;
    if (spot) {
      c.heading = spot.h;
      if (c.stance === 'crawl') { c.setStance('stand'); up = CONFIG.units.stanceUp; }
    }
    const dur = up + t.activationTime;
    c.playAction('use', dur);
    // a raised ladder lowered from the top: its drawn swing down runs for the action (art/ladder-frame.js; visual only)
    const ladder = t.interactKind === 'ladder' && !t.lowered;
    if (ladder) { t.lowerStart = world.time; t.lowerDur = dur; }
    const task = timedTask({
      dur,
      onCancel: ladder ? () => { if (!t.lowered) t.lowerStart = null; } : undefined,
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
    if (up) task.leverDelay = up; // (art/switch-station.js: the lever's clock starts once he is up)
    return task;
  },
});

// Boarding / leaving vehicles and manning guns: VEHICLES' `enterVehicle` / `leaveVehicle` (abilities/drive.js).
