/**
 * BCD enemy states (docs/bcd-plan.md §1.1–§1.3, §1.9): knock-out (`stunned`, wake timer → alarm), handcuffs
 * (`bound`, comrades free → both alarm), puppet control, cigarette packs carried, uniforms taken; placeholder
 * looks of the new unit types; save/load of the BCD fields. Only called when `world.rules.id === 'BCD'` (or
 * by BCD-only abilities), so BEL enemies never enter these states.
 * @module ai/bcd-enemy
 */

import { CONFIG } from '../config.js';
import { canSee } from './perception.js';
import { isAnimal, ANIMAL_TYPES } from './bcd-ranks.js';
import { createAnimal } from '../art/animal-placeholder.js';

/** Brain states added by BCD (EnemyBrain.deserialize accepts them). */
export const BCD_BRAIN_STATES = Object.freeze(['STUNNED', 'BOUND', 'PUPPET', 'STONE', 'CIGS', 'REVIVE', 'LIPSTICK', 'FLEE', 'REPORT']);
/** §1.1 "aware" states: a knock-out on a man in one of these has no effect. */
export const AWARE_KO = new Set(['COMBAT', 'SEARCH', 'CHALLENGE', 'HOLD', 'ARREST', 'REINFORCE', 'BODY', 'TRACKS', 'ALARM_RUN', 'REVIVE', 'FLEE']);

/** Placeholder tints (bcd-plan §4 "NOW placeholder"): BEL officer tinted black for the Gestapo, etc. */
const LOOK = {
  gestapo: { soldierType: 'officer', colors: { body: 0x16161a, hat: 0x0c0c0e } },
  lieutenant: { soldierType: 'officer', colors: { body: 0x6a6e66, hat: 0x3a3d3a } },
  zookeeper: { soldierType: 'soldier', colors: { body: 0x5a6450, hat: 0x3c3a30 } },
  snitch: { soldierType: 'soldier', colors: { body: 0x7a7468, hat: 0x5a564c } },
  pow: { soldierType: 'soldier', colors: { body: 0x7a7468, hat: 0x5a564c } },
};

/** Unit constructor extras for BCD soldier types ({} for every BEL type). */
export function bcdModelOpts(soldierType, spawn = {}) {
  if (ANIMAL_TYPES.includes(soldierType)) return { model: createAnimal(soldierType, spawn.colors || {}) };
  const L = LOOK[soldierType];
  return L ? { modelOpts: { soldierType: L.soldierType, colors: spawn.colors ?? L.colors } } : {};
}

/** Default weapons of the BCD unit types (§1.9; null = unarmed). */
export const BCD_WEAPON = { gestapo: 'gestapoLuger', lieutenant: 'luger', zookeeper: null, snitch: null, pow: null, lion: 'lionClaw', ostrich: 'ostrichKick', chicken: null };

/** Per-enemy BCD setup when it joins a BCD world: cigarette pack (§1.5), dog tuning (§1.9). */
export function bcdEnemyInit(e, world) {
  const noPack = isAnimal(e) || ['dog', 'zookeeper', 'pow', 'snitch'].includes(e.soldierType);
  e.cigs = e.spawn?.cigs ?? (noPack ? 0 : CONFIG.bcd.cigarettes.perSoldier);
  e.uniformTaken = false;
  if (e.spawn?.weapon === undefined && e.soldierType in BCD_WEAPON) e.weapon = BCD_WEAPON[e.soldierType];
  if (e.soldierType === 'dog' && world.rules.animals && e.weapon === 'dogBite') e.weapon = 'dogBiteBcd';
  installBcdSystems(world);
}

/** Save fields (only written under the BCD ruleset). */
export function bcdSerialize(e) {
  return { ko: e.ko, koT: e.koT, puppetOf: e.puppetOf?.id ?? null, cigs: e.cigs ?? 0, uniformTaken: !!e.uniformTaken, weapon: e.weapon, droppedWeapon: e.droppedWeapon ?? null,
    puppetSince: e._puppetSince ?? null, koReported: !!e._koReported, rearm: e._rearm ? { ...e._rearm } : null, dropAt: e._dropAt ?? null };
}

export function bcdDeserialize(e, d) {
  e.ko = d.ko ?? null;
  e.koT = d.koT ?? 0;
  e.cigs = d.cigs ?? 0;
  e.uniformTaken = !!d.uniformTaken;
  if (d.weapon !== undefined) e.weapon = d.weapon;
  e.droppedWeapon = d.droppedWeapon ?? null;
  e._puppetOfId = d.puppetOf;
  e._puppetSince = d.puppetSince ?? undefined;
  e._koReported = !!d.koReported;
  e._rearm = d.rearm ? { ...d.rearm } : null;
  e._dropAt = d.dropAt ?? null;
  if (d.puppetOf != null && e.world) e.puppetOf = e.world.byId(d.puppetOf) ?? null;
  if (e.puppetOf) e.puppetOf.puppet = e;
  if (e.ko && !e.puppetOf) layDown(e, e.ko); // layDown keeps state 'carried' but records _bcdState for dropCarried
}

/**
 * Second pass after save.restore has respawned / restored every entity (BCD worlds only): links that point at
 * entities restored later than their owner — the puppet ↔ controller pair, brain goal refs (cigarette pack,
 * victim, guard), Natasha's lipstick target, a reviver's claim on the man on the ground.
 */
export function bcdPostRestore(world) {
  const byId = (id) => (id != null ? world.byId(id) ?? null : null);
  for (const e of world.enemies) {
    if (e._puppetOfId != null && !e.puppetOf) e.puppetOf = byId(e._puppetOfId);
    if (e.puppetOf) e.puppetOf.puppet = e;
    const b = e.brain;
    const ids = b?._bcdGoalIds;
    if (ids && b.goal) for (const k of Object.keys(ids)) if (!b.goal[k]) b.goal[k] = byId(ids[k]);
    if (b) b._bcdGoalIds = null;
    if (b?._lipstickById != null && !b.lipstickBy) b.lipstickBy = byId(b._lipstickById);
    if (b?.state === 'LIPSTICK' && b.lipstickBy) b.lipstickBy._lipstickTarget = e;
    if (b?.state === 'REVIVE' && b.goal?.victim) b.goal.victim._reviver = e;
    if (b?.state === 'CIGS' && b.goal?.pack) b.goal.pack.claimedBy = e;
  }
  for (const c of world.commandos) {
    const r = c._bcdRefs;
    if (!r) continue;
    c._bcdRefs = null;
    if (r.puppet != null) { const p = byId(r.puppet); if (p) { c.puppet = p; p.puppetOf = c; } }
    if (r.lipstickTarget != null) c._lipstickTarget = byId(r.lipstickTarget);
    c.refreshAbilities?.();
  }
}

/** Put the man on the ground in knock-out state `ko` (no movement, no cone, lying animation). */
function layDown(e, ko) {
  if (e.state !== 'carried') e.state = ko;
  e._bcdState = ko; // what dropCarried restores
  e.stop?.();
  e.sweepActive = false;
  e._animOverride = { name: 'dead', t: Infinity };
  e._anim = null;
  e._setAnim?.('dead');
}

/**
 * Stand him up again after waking / being freed. He is unarmed until he picks his weapon up from where he fell
 * (§1.2 [rec]): a CONFIG.bcd.rearmTime pickup when he stands up there; carried away, when he next passes it.
 */
function standUp(e) {
  e.ko = null;
  e.koT = 0;
  e._bcdState = null;
  e._koReported = false;
  if (e.state === 'stunned' || e.state === 'bound') e.state = 'active';
  if (e.droppedWeapon != null) {
    const at = e._dropAt ?? { x: e.x, z: e.z };
    const near = Math.hypot(e.x - at.x, e.z - at.z) <= CONFIG.bcd.rearmReach;
    e._rearm = { x: at.x, z: at.z, t: CONFIG.bcd.rearmTime, started: near };
  }
  e._animOverride = null;
  e._anim = null;
}

/**
 * Why a knock-out cannot affect `e` at all (§1.1): animals, patrol members, the dead. null = valid target.
 * (An aware target is a valid click — the swing plays and misses; see koLands.)
 */
export function koImmune(e) {
  if (!e || e.kind !== 'enemy') return 'Pick a soldier.';
  if (!e.alive) return 'Already dead.';
  if (isAnimal(e) || e.soldierType === 'dog') return "Can't knock out an animal.";
  if (e.ko === 'bound' || e.puppetOf) return 'Already cuffed.';
  // [RU] the MP40 patrols (squad members, troopers) cannot be knocked out; a lone sergeant sentry can
  if ((e.squad || e.soldierType === 'trooper') && e.soldierType !== 'gestapo') return "Can't knock out a patrol soldier.";
  return null;
}

/** Does a knock-out by `attacker` land (§1.1): the target is unaware and his cone does not hold the attacker. */
export function koLands(e, attacker, world) {
  if (koImmune(e)) return false;
  if (e.ko === 'stunned') return true; // re-knocking resets the timer
  const s = e.brain?.state;
  if (AWARE_KO.has(s) || (e.alertLevel ?? 0) >= 2) return false;
  return canSee(e, attacker, world, { ignoreDisguise: true }) === 'none';
}

/** Per awake step (BCD): the timed pickup of the weapon he dropped when knocked out (see standUp). */
export function rearmStep(e, dt, world) {
  const r = e._rearm;
  if (!r) return;
  if (e.droppedWeapon == null) { e._rearm = null; return; }
  if (!r.started && Math.hypot(e.x - r.x, e.z - r.z) <= CONFIG.bcd.rearmReach) r.started = true;
  if (!r.started || (r.t -= dt) > 0) return;
  e.weapon = e.droppedWeapon;
  e.droppedWeapon = null;
  e._rearm = null;
  world?.events.emit('enemy:rearmed', { enemy: e });
}

/** Knock `e` out (stunned, wake timer `CONFIG.bcd.koDuration`). */
export function knockOut(e, by, world) {
  const fresh = !e.ko;
  e.ko = 'stunned';
  e.koT = CONFIG.bcd.koDuration;
  if (fresh) {
    if (e.weapon != null) { e.droppedWeapon = e.weapon; e._dropAt = { x: e.x, z: e.z }; } // else it still lies where he fell before
    e._rearm = null;
    e.weapon = null;
    e.target = null;
    e.nervousness = 0;
    e.alertLevel = 0;
    e.brain?.releaseDistraction?.();
  }
  layDown(e, 'stunned');
  e.brain?.bcdEnter?.('STUNNED');
  world.events.emit('enemy:ko', { enemy: e, by, fresh });
  return true;
}

/** Cuff a stunned man (§1.2): bound, no wake timer, his cigarette pack goes to the cuffer. */
export function cuff(e, by, world) {
  if (e.ko !== 'stunned') return false;
  e.ko = 'bound';
  e.koT = 0;
  layDown(e, 'bound');
  e.brain?.bcdEnter?.('BOUND');
  if (world.rules.cigarettes && (e.cigs ?? 0) > 0 && by?.gainItem) {
    by.gainItem('cigarettes', e.cigs);
    e.cigs = 0;
  }
  world.events.emit('enemy:cuffed', { enemy: e, by });
  return true;
}

/** Wake / free `e`: he stands, rearms and is alerted (the caller raises the alarm). */
export function rouse(e, world, why = 'wake') {
  if (e.carriedBy) {
    const c = e.carriedBy;
    const mode = c.carryMode || null;
    c.carrying = null;
    c.carryMode = null; c.carryTransition = null; // bodies-design §C.4: a load that wakes is dropped at once
    e.carriedBy = null;
    c.refreshAbilities?.();
    world.events.emit('load:dropped', { carrier: c, load: e, how: 'woke', mode });
  }
  e.puppetOf = null;
  standUp(e);
  world.events.emit('enemy:roused', { enemy: e, why });
}

/** Per-world BCD bookkeeping (idempotent): "attacked" stamps on commandos for puppet loss and warnings. */
export function installBcdSystems(world) {
  if (world._bcdSys) return world._bcdSys;
  const sys = { stones: [] };
  world._bcdSys = sys;
  const hit = (u) => { if (u && u.faction === 'player') u._bcdAttackedT = world.time; };
  world.listen('unit:damaged', (p) => hit(p.unit));
  world.listen('shot', (p) => {
    if (p.shooter?.faction !== 'enemy') return;
    if (p.target) hit(p.target);
    for (const c of world.commandos) if (c.alive && p.to && Math.hypot(c.x - p.to.x, c.z - p.to.z) < 1.5) hit(c);
  });
  // §1.3 selecting another man (the controller no longer selected) releases his puppet
  world.listen('unit:selected', () => {
    for (const c of world.commandos) {
      if (c.puppet && c._puppetSel && !c.selected) releasePuppet(c, world);
      c._puppetSel = !!c.selected;
    }
  });
  // §1.8 guests join when a commando reaches them (Skopje in the zoo, Natasha in her house)
  world.onBelTick(() => {
    for (const g of world.commandos) {
      const J = g._joinsAt;
      if (!J || g.state !== 'jailed' || !g.alive) continue;
      const by = world.commandos.find((c) => c !== g && c.alive && c.state !== 'jailed' && Math.hypot(c.x - (J.x ?? J[0]), c.z - (J.z ?? J[1])) <= (J.r ?? J[2] ?? 3));
      if (!by) continue;
      g.state = 'active';
      g._joinsAt = null;
      if (g.object3d) g.object3d.visible = true;
      world.events.emit('unit:freed', { unit: g, jailId: null, by });
      world.events.emit('message', { text: `${g.nickname} joins the team.`, kind: 'info', unit: g });
    }
  });
  return sys;
}

/** §1.3 take puppet control of a cuffed man: he stands and obeys `c`'s orders (brain PUPPET). */
export function takePuppet(e, c, world) {
  if (e.ko !== 'bound' || e.puppetOf) return false;
  e.puppetOf = c;
  c.puppet = e;
  c._puppetSel = !!c.selected;
  c.refreshAbilities?.();
  e._puppetSince = world.time;
  e.disguised = true; // read by distraction targets as "one of ours" (released when control ends)
  if (e.state === 'bound') e.state = 'active';
  e._animOverride = null;
  e._anim = null;
  e.brain?.bcdEnter?.('PUPPET');
  world.events.emit('bcd:puppet', { unit: c, puppet: e, on: true });
  return true;
}

/** §1.3 release a puppet: he sits down again, still cuffed. */
export function releasePuppet(c, world = c.world) {
  const e = c.puppet;
  c.puppet = null;
  c.refreshAbilities?.();
  if (!e || e.puppetOf !== c) return false;
  e.puppetOf = null;
  e.disguised = false;
  e._puppetJob = null;
  if (e._puppetTalk) { e._puppetTalk.brain?.releaseDistraction?.(); e._puppetTalk = null; }
  if (e.alive) { layDown(e, 'bound'); e.brain?.bcdEnter?.('BOUND'); }
  world?.events.emit('bcd:puppet', { unit: c, puppet: e, on: false });
  return true;
}
