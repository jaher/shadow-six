/**
 * Spy: Spooky (design-spec §3.4) — owned by ABILITIES. Carrying bodies: the hand (shared.js); disguise
 * unmasking rules: abilities/system.js.
 *   syringe  L  melee 1.2 m (double-click runs up): 0.9 s, kill at 0.5 s, NO blood, unlimited.
 *   uniform  U  re-dress (1.5 s) only when no enemy cone currently contains him.
 *   distract D  in uniform: walks to 1.5 m, talks (`spy_distract`); the target stops and faces him (a patrol
 *               leader freezes his whole squad, facing the leader). Lasts until right-click / new order, the Spy
 *               > 3 m away, the target hearing a level ≥ 2 noise, an alarm reaching the target, the Spy unmasked.
 * @module abilities/spy
 */

import { registerAbility } from './registry.js';
import { CONFIG } from '../config.js';
import { timedTask, freeToAct, bark } from './common.js';
import { meleeReachable } from './knife.js';
import { witnessesOf } from './system.js';
import { wardrobeOf } from './bcd-melee.js';
import { distractable } from '../ai/bcd-ranks.js';

const A = CONFIG.abilities;
const S = CONFIG.weapons.syringe;

registerAbility({
  id: 'syringe', label: 'Lethal injection', icon: '💉', hotkey: 'l', roles: ['spy'], item: 'lethalInjection',
  targeting: 'enemy', cursor: 'syringe', order: 10, group: 'melee', visibleToEnemies: true, noiseRadius: 0,
  range: S.range,
  canUse(c, t) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.carrying) return 'Drop it first.';
    if (c.stance !== 'stand') return 'Stand up first.';
    return meleeReachable(c, t);
  },
  start(c, t, world) {
    c.playAction('stab', S.dur);
    return timedTask({
      dur: S.dur, interruptible: false,
      steps: [{ at: S.hit, fn: () => {
        if (!t.alive || Math.hypot(t.x - c.x, t.z - c.z) > S.range + 0.6) return false;
        t.die('injection', c); // no blood decal (§3.4); a seen kill unmasks him (system.js unit:killed)
        return true;
      } }],
    });
  },
});

/** Is `spy` inside any living enemy's cone right now (with LOS, disguise ignored)? */
export function inAnyCone(world, spy) {
  return witnessesOf(world, spy).length > 0;
}

/** Put the uniform on if nobody watches; returns true when dressed. */
export function tryDress(world, c) {
  if (c.disguised || !c.has('uniform') || inAnyCone(world, c)) return false;
  c.loseItem('uniform');
  c.setDisguise(true);
  return true;
}

/** BCD §1.6: put on wardrobe uniform `u` if not already disguised and nobody watches (uniformType set explicitly). */
export function dressIn(world, c, u) {
  if (c.disguised || !wardrobeOf(c).includes(u) || inAnyCone(world, c)) return false;
  c.uniformType = u;
  c.setDisguise(true);
  return true;
}

registerAbility({
  id: 'uniform', label: 'Uniform', icon: '🎖', hotkey: 'u', roles: ['spy'], item: 'uniform', targeting: 'self',
  order: 11, visibleToEnemies: true,
  canUse(c, t, world) {
    if (world.rules?.spyUniformFromCaptives) return wardrobeCanUse(c, world); // BCD §1.6: U cycles the wardrobe
    const f = freeToAct(c);
    if (f !== true) return f;
    if (c.disguised) return 'Already in uniform.';
    if (c.carrying) return 'Drop it first.';
    if (inAnyCone(world, c)) return 'Not while they are watching.';
    return true;
  },
  start(c, t, world) {
    if (world.rules?.spyUniformFromCaptives) {
      const T = CONFIG.bcd.uniformChange;
      c.playAction('use', T);
      return timedTask({ dur: T, steps: [{ at: T, fn: () => cycleUniform(world, c) }] });
    }
    c.playAction('use', A.uniform);
    return timedTask({ dur: A.uniform, steps: [{ at: A.uniform, fn: () => tryDress(world, c) }] });
  },
});

/** BCD wardrobe (§1.6): U is usable with any uniform held, unseen, hands free. */
function wardrobeCanUse(c, world) {
  const f = freeToAct(c);
  if (f !== true) return f;
  if (c.carrying) return 'Drop it first.';
  if (!wardrobeOf(c).length) return 'No uniform.';
  if (inAnyCone(world, c)) return 'Not while they are watching.';
  return true;
}

/** BCD U: put on the next uniform of the wardrobe; after the last one, plain clothes; then the first again. */
export function cycleUniform(world, c) {
  const list = wardrobeOf(c);
  if (!list.length || inAnyCone(world, c)) return false;
  const idx = c.disguised ? list.indexOf(c.uniformType ?? 'soldier') : -1;
  const next = idx + 1;
  if (next >= list.length) { c.uniformType = null; c.setDisguise(false); return true; }
  c.uniformType = list[next];
  c.setDisguise(true);
  return true;
}

/** Squad members frozen with their leader (§3.4): same squad id, the target being its leader. */
export function squadOf(world, leader) {
  const sq = leader.squad;
  if (!sq || !(sq.leader === true || sq.leader === leader.tag || sq.leader === leader.id)) return [];
  return world.enemies.filter((e) => e !== leader && e.alive && e.squad && e.squad.id === sq.id);
}

registerAbility({
  id: 'distract', label: 'Distract', icon: '🗣', hotkey: 'd', roles: ['spy'], targeting: 'enemy', cursor: 'talk',
  order: 12, visibleToEnemies: false, range: A.distractRange,
  available: (c) => c.role === 'spy' && !c.puppet, // BCD §1.3: D goes to the puppet while one is active (BEL: never set)
  canUse(c, t) {
    const f = freeToAct(c);
    if (f !== true) return f;
    if (!c.disguised) return 'Only in uniform.';
    if (!t || t.kind !== 'enemy' || !t.alive) return 'Pick a soldier.';
    if (unreachableCrew(t)) return 'He is shut in his post.';
    if (!distractable(t)) return 'He is not fooled.'; // BCD §1.6: never the Gestapo (always true under BEL)
    if (t.brain?.isAware?.()) return 'He is on to us.';
    return true;
  },
  start(c, t, world) { return distractTask(c, t, world, false); },
  /** Save/load (§10.5): pick the running distraction up again; brains already come back DISTRACTED. */
  resume(c, t, world) { return t?.alive ? distractTask(c, t, world, true) : null; },
});

/**
 * Crews inside a structure (bunker, tower: spawn `structure`), in a vehicle, or of the `crew` archetype never
 * come out to chat (replay round 2, M3 e34): the order is refused with the forbidden cursor.
 */
function unreachableCrew(t) {
  return !!(t.spawn?.structure || t.structure || t.state === 'inVehicle' || t.vehicle || t.brain?.arch?.script === 'crew'
    || t.soldierType === 'crew');
}

/** The distract task (§3.4). `resumed`: rebuilt after a load — no bark, the brains are already restored. */
function distractTask(c, t, world, resumed) {
  const squad = squadOf(world, t);
  const all = [t, ...squad];
  let over = false;
  const end = () => { over = true; };
  const offs = [
    world.events.on('noise', (n) => {
      if ((n.level ?? 1) >= 2 && Math.hypot(n.x - t.x, n.z - t.z) <= n.radius) end();
    }),
    world.events.on('alarm:start', end),
    world.events.on('alarm:zone', (e) => {
      const z = world.alarm?.zoneAt?.(t.x, t.z);
      if (!e.zone || e.zone === 'global' || !z || e.zone === z.id || e.zone?.id === z.id) end();
    }),
    world.events.on('enemy:unmasked-spy', (e) => { if (e.spy === c) end(); }),
  ];
  if (!resumed) {
    for (const e of all) e.brain?.distractBy?.(c);
    bark(world, c, 'spy_distract');
    world.events.emit('message', { text: `${c.nickname}: "Guten Tag, Soldat…"`, kind: 'bark', unit: c });
  }
  const release = () => {
    for (const off of offs) off();
    for (const e of all) e.brain?.releaseDistraction?.();
    t._distractedBy = null;
  };
  t._distractedBy = c;
  let finished = false;
  return {
    interruptible: true,
    keepsState: false,
    update() {
      if (finished) return 'done';
      const gone = Math.hypot(c.x - t.x, c.z - t.z) > A.distractBreak;
      if (over || gone || !t.alive || !c.disguised || t.brain?.isAware?.()) {
        finished = true;
        release();
        return 'done';
      }
      // the target faces the Spy (his cone points at him); a frozen squad faces its leader
      t.stop?.(); t.sweepActive = false; t.headOffset = 0; t.faceTowards(c.x, c.z);
      for (const m of squad) if (m.alive) { m.stop?.(); m.sweepActive = false; m.headOffset = 0; m.faceTowards(t.x, t.z); }
      return 'running';
    },
    cancel() {
      if (!finished) { finished = true; release(); }
    },
  };
}
