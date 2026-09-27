/**
 * Headless AI sim harness for unit tests (no renderer): a World with Alarm + world.ai, commandos and
 * enemies from spawn data, and step() in the Game.step order (§10.1): occluders → commandos → enemies →
 * 20 Hz BEL ticks → alarm → removals → time.
 */
import { World } from '../../src/world/world.js';
import { Alarm } from '../../src/ai/alarm.js';
import { Commando } from '../../src/entities/commando.js';
import { Enemy } from '../../src/entities/enemy.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { CONFIG } from '../../src/config.js';

export const DT = CONFIG.sim.dt;

/** World from a (partial) mission def; `mission.enemies` are spawned, commandos via addCommando. */
export function makeWorld(mission = {}, { seed = 42 } = {}) {
  const def = normalizeMission({ id: 'aitest', size: [80, 80], ...mission }, { quiet: true });
  const w = new World({ size: def.size, mission: def, seed });
  w.alarm = new Alarm(w);
  w.log = [];
  for (const t of ['enemy:state', 'enemy:challenge', 'alarm:zone', 'alarm:start', 'shot', 'unit:held', 'unit:captured', 'unit:jailed', 'reinforcements', 'enemy:body-found', 'bark']) {
    w.events.on(t, (p) => w.log.push({ t: w.time, type: t, p }));
  }
  for (const s of def.enemies) w.add(new Enemy(s));
  return w;
}

/** Normalised enemy spawn (schema defaults + flags), added to the world. */
export function addEnemy(w, spawn) {
  const def = normalizeMission({ id: 'x', size: [w.width, w.depth], enemies: [spawn] }, { quiet: true });
  return w.add(new Enemy(def.enemies[0])) || w.enemies.at(-1);
}

export function addCommando(w, role, x, z, heading = 0) {
  const c = new Commando({ role, x, z, heading, campaign: 'BEL' });
  w.add(c);
  return c;
}

export function step(w, dt = DT) {
  w.rebuildSpatial();
  w.refreshDynamicOccluders();
  for (const c of w.commandos) if (!c.removed) c.update(dt);
  for (const e of [...w.enemies]) if (!e.removed) e.update(dt);
  w.runBelTicks(dt);
  for (const v of w.vehicles) if (!v.removed) v.update(dt);
  w.alarm.update(dt);
  w.flushRemovals();
  w.time += dt;
  w.tick++;
}

/** Run `secs` of sim; `until(w)` true stops early. @returns {number} sim time elapsed */
export function run(w, secs, until = null) {
  const n = Math.round(secs / DT);
  const t0 = w.time;
  for (let i = 0; i < n; i++) {
    step(w);
    if (until && until(w)) break;
  }
  return w.time - t0;
}

/** First log entry of `type` (optionally matching fn). */
export function first(w, type, fn = null) {
  return w.log.find((l) => l.type === type && (!fn || fn(l.p))) || null;
}
