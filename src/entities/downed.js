/**
 * Buddy rescue: the DOWNED state of a commando or guest (docs/bodies-design.md §C.6–§C.8, house rule `buddyRescue`).
 * A downable lethal hit leaves him alive at 0 HP, lying, bleeding out over `CONFIG.bodies.downed.bleedOut` s. He
 * can only crawl (0.3 m/s); comrades drag or carry him and revive him with the first-aid kit (K, 4 s, one dose,
 * 34 HP). Any further hit, or the bleed-out, kills him — and any commando death still fails the mission (§8.1).
 *   unit.downed = {t, cause, sourceId, since, hurried}   state 'downed', stance 'downed', alive, hp 0
 * Events: `unit:downed {unit, cause, source}`, `unit:revived {unit, by}`.
 * @module entities/downed
 */

import { CONFIG } from '../config.js';

const D = () => CONFIG.bodies.downed;

/**
 * Does a hit of `amount` (cause `cause`) leave `u` DOWNED instead of dead? Only when it would kill him and the house
 * rule is on and the hit is not clearly fatal (drowning, run over, train, fall, point-blank blast, big overkill), and
 * never for a man who is already down.
 */
export function isDownableHit(u, amount, cause, world = u?.world) {
  if (!world?.house?.buddyRescue || u?.kind !== 'commando' || !u.alive || u.downed) return false;
  if (u.hp - amount > 0) return false;
  const P = D();
  if (P.fatal.includes(cause)) return false;
  if (amount - u.hp > P.overkillMax) return false;
  const b = u._blastCtx;
  if (b && b.rk > 0 && b.d <= P.blastCore * b.rk) return false;
  if (u.state === 'inVehicle' || u.vehicle || u.state === 'jailed' || u.state === 'captured' || u.hidden) return false;
  if (u.stance === 'swim' || u.stance === 'dive' || u.underwater) return false; // he would drown
  const g = world.groundAt?.(u.x, u.z);
  if (g?.water && !g.bridge) return false;
  return true;
}

/** Put `u` DOWNED (the caller already applied the damage bookkeeping). */
export function enterDowned(u, cause, source) {
  const w = u.world;
  if (u.currentAction) { u.currentAction.cancel?.(); u.currentAction = null; u.currentActionId = null; }
  u.pendingAbility = null;
  u.armed = null;
  u.hanging = false;
  u.stop();
  if (u.carrying) u.dropLoad?.('downed');
  if (u.disguised && u.setDisguise) { /* the uniform stays on: a downed Spy is a downed Spy */ }
  u.hp = 0;
  u.downed = { t: D().bleedOut, cause, sourceId: source?.id ?? null, since: w?.time ?? 0, hurried: false };
  u.state = 'downed';
  u.stance = 'downed';
  u.moveMode = 'walk';
  u._stanceT = 0;
  u._animOverride = null;
  u.playAction?.('downed_fall', 0.9);
  if (w) {
    w.events.emit('unit:stance', { unit: u, stance: 'downed' });
    w.events.emit('unit:downed', { unit: u, cause, source });
    // a clock, not "60 s": the HUD message line is set in capitals (styles/ui.css .hud-message)
    const sec = Math.round(D().bleedOut), clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    w.events.emit('message', { text: `${String(u.nickname || u.name || 'Commando').toUpperCase()} IS DOWN — ${clock} TO BLEED OUT`, kind: 'alert', unit: u });
    const caller = barker(w, u);
    if (caller) w.events.emit('bark', { unit: caller, line: 'man_down', about: u });
    w.events.emit('bark', { unit: u, line: 'moan' });
  }
  return true;
}

/** The nearest other able commando within the bark range (else the selected one) — calls "Man down!". */
export function barker(w, u) {
  let best = null, bd = D().barkRange;
  for (const c of w.commandos) {
    if (c === u || !c.alive || c.downed || c.role === 'guest' || c.state === 'jailed') continue;
    const d = Math.hypot(c.x - u.x, c.z - u.z);
    if (d <= bd) { best = c; bd = d; }
  }
  return best || w.commandos.find((c) => c !== u && c.selected && c.alive && !c.downed) || null;
}

/**
 * Per-step bleed-out; he dies at 0. A medic working on him stops the bleeding (pressure, bandage): the clock is held
 * while a revive is in progress, so a revive begun with under 4 s left can still succeed. @returns {boolean} still downed
 */
export function tickDowned(u, dt) {
  const d = u.downed;
  if (!d || !u.alive) return false;
  if (!u.reviving) d.t -= dt;
  const w = u.world;
  if (!d.hurried && d.t <= D().hurry) {
    d.hurried = true;
    const c = w && barker(w, u);
    if (c) w.events.emit('bark', { unit: c, line: 'hurry', about: u });
  }
  if (d.t <= 0) {
    const src = d.sourceId != null ? w?.byId(d.sourceId) : null;
    w?.events.emit('message', { text: `${String(u.nickname || 'Commando').toUpperCase()} BLED OUT`, kind: 'alert', unit: u });
    u.downed = null;
    u.die(d.cause || 'bleedOut', src || null);
    return false;
  }
  return true;
}

/** Bring a downed man back (the end of the revive): 34 HP, gets up in 1.2 s, then active. */
export function reviveDowned(u, by) {
  if (!u.downed || !u.alive) return false;
  const P = D();
  u.downed = null;
  if (u.state === 'carried' && u.carriedBy) { const c = u.carriedBy; c.dropLoad ? c.dropLoad('gentle') : null; }
  u.hp = Math.min(u.maxHp, P.reviveHp);
  u.state = 'active';
  u.stance = 'stand';
  u._stanceT = P.standUp; // immobile while getting up
  u.playAction?.('revive_up', P.standUp); // prone → standing (get_up), else the supine stand_up
  const w = u.world;
  if (w) {
    w.events.emit('unit:stance', { unit: u, stance: 'stand' });
    w.events.emit('unit:revived', { unit: u, by });
    w.events.emit('message', { text: `${String(u.nickname || 'Commando').toUpperCase()} REVIVED`, kind: 'info', unit: u });
    w.events.emit('bark', { unit: u, line: 'revived' });
  }
  return true;
}

/** Can this man act for the team (§C.8 "nobody left to help")? */
const canAct = (c) => c.alive && !c.downed && !c.removed && !['jailed', 'captured', 'carried'].includes(c.state) && !c.cannotWalk && !c._joinsAt;

/**
 * §C.8: every commando is DOWNED, captured or jailed, and no guest can act (while at least one man is down).
 * @returns {boolean}
 */
export function nobodyLeftToHelp(world) {
  const men = world.commandos.filter((c) => c.alive !== false && !c.removed);
  return men.some((c) => c.downed) && !men.some(canAct);
}

/** Save fields of a downed man. */
export function serializeDowned(u) {
  const d = u.downed;
  return d ? { t: d.t, cause: d.cause, sourceId: d.sourceId, since: d.since, hurried: !!d.hurried,
    ...(d.alarmed ? { alarmed: true } : null), ...(d.covered ? { covered: d.covered, coverTick: d.coverTick } : null) } : null;
}
