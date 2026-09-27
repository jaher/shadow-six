/**
 * BCD AI reactions (docs/bcd-plan.md §1.4 stones, §1.5 cigarette packs, §1.8 lipstick): pure world-level
 * entry points called by the BCD abilities, and the per-step behaviour of the STONE / CIGS / LIPSTICK brain
 * states (run by bcd-brain.bcdState). Stones do NOT go through the BEL noise system (a level-1 noise makes
 * investigators walk over at once); they count per soldier in a rolling window instead.
 * @module ai/bcd-reactions
 */

import { CONFIG } from '../config.js';
import { canSee } from './perception.js';
import { AWARE_KO } from './bcd-enemy.js';
import { isAnimal } from './bcd-ranks.js';

const DEG = Math.PI / 180;
/** Types that never react to stones or packs (§1.4, §1.5). */
const DEAF = new Set(['dog', 'lion', 'ostrich', 'chicken', 'pow', 'zookeeper', 'snitch']);
const NO_PACKS = new Set(['mg', 'crew', 'gunner', 'gestapo', 'dog', 'lion', 'ostrich', 'chicken', 'pow', 'zookeeper', 'snitch', 'officer', 'general', 'truckDriver']);
/** Brain states from which a stone / pack may take over. */
const OPEN = new Set(['IDLE', 'RETURN', 'STONE', 'INVESTIGATE', 'DECOY']);

/** Awake, unaware, reacting enemy that may be lured at all. */
function lurable(e) {
  if (!e.alive || e.removed || e.incapacitated || !e.brain || isAnimal(e)) return false;
  if (!e.brain.arch?.reacts || e.state === 'inVehicle') return false;
  const s = e.brain.state;
  return !AWARE_KO.has(s) && (e.alertLevel ?? 0) < 2 && OPEN.has(s);
}

/**
 * A stone landed at (x, z) (§1.4). Soldiers within the click radius look for 4 s; the 3rd stone within 20 s
 * makes a walker go over and search (posts only look). @returns {object[]} enemies that reacted
 */
export function stoneLanded(world, x, z, thrower = null, hitUnit = null) {
  const S = CONFIG.bcd.stones;
  const out = [];
  if (!world.rules?.stones) return out; // BEL: stones do not exist
  for (const e of world.enemies) {
    if (DEAF.has(e.soldierType) || !lurable(e)) continue;
    if (e !== hitUnit && Math.hypot(e.x - x, e.z - z) > S.noiseRadius) continue;
    const b = e.brain;
    e._stoneT = (e._stoneT || []).filter((t) => world.time - t <= S.window);
    e._stoneT.push(world.time);
    const walk = e._stoneT.length >= S.investigateAt && e.flags.investigates && !e.flags.holdsPost;
    b.goal = { x, z, stone: true };
    b.bcdEnter('STONE', walk ? 'go' : 'look');
    e.stop();
    if (walk) b._go(x, z, CONFIG.ai.investigate.speed);
    else e.faceTowards(x, z);
    out.push(e);
  }
  world.events.emit('bcd:stone', { x, z, thrower, reacted: out });
  return out;
}

/** STONE state step: look at the point, or walk over and look around. */
export function stoneStep(b) {
  const e = b.enemy, g = b.goal, S = CONFIG.bcd.stones;
  if (!g) return b._set('RETURN');
  if (b.phase === 'look') {
    e.faceTowards(g.x, g.z);
    b._look(0);
    if (b.pt >= S.lookTime) b._set('RETURN');
    return;
  }
  if (b.phase === 'go') {
    if (b._dist(g) <= 1.2 || (!e.isMoving && b.pt > 0.3)) { e.stop(); b.phase = 'search'; b.pt = 0; b.world.events.emit('bark', { unit: e, line: 'ger_suspicious' }); }
    return;
  }
  e.sweepActive = false;
  e.headOffset = 90 * DEG * Math.sin((2 * Math.PI * b.pt) / S.investigateLook);
  if (b.pt >= S.investigateLook) { e._stoneT = []; b._set('RETURN'); }
}

/**
 * A cigarette pack landed (§1.5): the nearest soldier whose NEAR band holds it walks over, kneels 3 s,
 * pockets it and walks back. @returns {object|null} the soldier who goes
 */
export function packLanded(world, pack) {
  if (!world.rules?.cigarettes) return null; // BEL: packs do not exist
  let best = null, bd = Infinity;
  const probe = { x: pack.x, z: pack.z, y: 0, isLow: false, isVisibleToEnemies: true };
  for (const e of world.enemies) {
    if (NO_PACKS.has(e.soldierType) || !lurable(e) || e.brain.state === 'STONE' && e.brain.phase !== 'look') continue;
    if (canSee(e, probe, world) !== 'near') continue;
    const d = Math.hypot(e.x - pack.x, e.z - pack.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return null;
  const b = best.brain;
  pack.claimedBy = best;
  b.goal = { x: pack.x, z: pack.z, pack };
  b.bcdEnter('CIGS', 'go');
  best.stop();
  b._go(pack.x, pack.z, CONFIG.ai.investigate.speed);
  world.events.emit('bcd:pack-lured', { enemy: best, pack });
  return best;
}

/** CIGS state step: go → kneel (cone shortened to the near band) → back. */
export function cigsStep(b) {
  const e = b.enemy, g = b.goal, C = CONFIG.bcd.cigarettes;
  if (!g || !g.pack) return b._set('RETURN');
  if (b.phase === 'go') {
    if (b._dist(g) <= 1.0 || (!e.isMoving && b.pt > 0.3)) {
      e.stop(); b.phase = 'kneel'; b.pt = 0;
      e.faceTowards(g.x, g.z);
      e.playAction('use', C.pickupTime);
      g.far = e.vision?.far;
      if (e.vision) e.vision.far = e.vision.near; // §1.5: the kneel lowers and shortens the cone
      b._look(0);
    }
    return;
  }
  if (b.phase === 'kneel' && b.pt >= C.pickupTime) {
    if (e.vision && g.far != null) e.vision.far = g.far;
    const p = g.pack;
    if (!p.removed) { e.cigs = (e.cigs ?? 0) + (p.count ?? 1); p.count = 0; b.world.removeLater?.(p); }
    b.world.events.emit('bcd:pack-taken', { enemy: e, pack: p });
    b._set('RETURN');
  }
}

/** Restore a shortened cone when a CIGS kneel is interrupted (state change). */
export function cigsAbort(b) {
  const g = b.goal;
  if (g?.pack && g.far != null && b.enemy.vision) { b.enemy.vision.far = g.far; g.far = null; }
}

/** Natasha's lipstick (§1.8): any rank but Gestapo; his cone follows her until it ends. */
export function startLipstick(e, natasha, world) {
  if (!world.rules?.guests) return false;
  if (!e?.alive || e.incapacitated || e.soldierType === 'gestapo' || isAnimal(e) || e.soldierType === 'dog') return false;
  const b = e.brain;
  if (!b || AWARE_KO.has(b.state)) return false;
  b.lipstickBy = natasha;
  b.bcdEnter('LIPSTICK');
  e.stop();
  natasha._lipstickTarget = e;
  world.events.emit('enemy:distracted', { enemy: e, spy: natasha, on: true, lipstick: true });
  return true;
}

/** LIPSTICK step: face her every tick; ends when she leaves his far band, is attacked or lets go. */
export function lipstickStep(b) {
  const e = b.enemy, n = b.lipstickBy;
  const far = e.vision?.far ?? 36;
  const over = !n || !n.alive || n._lipstickTarget !== e || Math.hypot(n.x - e.x, n.z - e.z) > far
    || (n._bcdAttackedT != null && b.world.time - n._bcdAttackedT < 0.1) || n.disguised === false;
  if (over) {
    if (n && n._lipstickTarget === e) n._lipstickTarget = null;
    b.lipstickBy = null;
    b.world.events.emit('enemy:distracted', { enemy: e, spy: n, on: false, lipstick: true });
    return b._set('RETURN');
  }
  e.stop();
  e.faceTowards(n.x, n.z);
  b._look(0);
}
