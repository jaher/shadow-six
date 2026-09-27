/**
 * Per-world ability systems (owned by ABILITIES), installed once per World by the first Commando added
 * (`installAbilitySystems(world)`, idempotent):
 *   - Spy disguise (§3.4): suspicious acts seen by an enemy unmask him (running, carrying a body, moving with the
 *     syringe/pistol armed, killing/injecting, entering a door or a vehicle); `enemy:unmasked-spy` from the AI is
 *     honoured too. Unmasking: uniform back to the knapsack, model swap, level-1 noise (9 m), witness N = 1000.
 *   - Witness rule (§3.4 shovel/diving gear): enemies whose cone held the man when he went under keep seeing him
 *     (near band) while he stays in their cone — `unit.witnesses` (read by perception.canSee).
 *   - Decoy pulse cadence (§3.4): one decoy noise every 1.5 s (30 BEL ticks) while switched on.
 * @module abilities/system
 */

import { CONFIG } from '../config.js';
import { canSee } from '../ai/perception.js';

const KEY = Symbol('abilitySystems');

/** Enemies that currently see `unit` (disguise ignored), for the suspicious-act checks. */
export function witnessesOf(world, unit, { near = false } = {}) {
  const out = [];
  for (const e of world.enemies) {
    if (!e.alive || !e.vision) continue;
    const z = canSee(e, unit, world, { ignoreDisguise: true });
    if (z !== 'none' && (!near || z === 'near')) out.push(e);
  }
  return out;
}

/**
 * Unmask a disguised Spy (§3.4). Idempotent.
 * @param {import('../world/world.js').World} world
 * @param {any} spy
 * @param {any} [witness] the enemy who saw him
 * @param {string} [why]
 */
export function unmaskSpy(world, spy, witness = null, why = 'seen') {
  if (!spy?.disguised) return false;
  spy.setDisguise ? spy.setDisguise(false) : (spy.disguised = false);
  if (spy.role === 'natasha') spy.uniformType = null; // BCD §1.8: Natasha's civilian cover is no uniform
  else if (spy.gainItem) spy.gainItem('uniform', 1); else spy.inventory?.set('uniform', 1);
  if (world.rules?.spyUniformFromCaptives && spy.role !== 'natasha') spy.uniformType = null; // BCD: no stale rank after an unmask
  const N = CONFIG.stealth.noise.spyUnmask;
  world.emitNoise(spy.x, spy.z, N.radius, 'spyUnmask', spy, N.level);
  if (witness) {
    witness.nervousness = Math.max(witness.nervousness || 0, 1000); // straight to CHALLENGE (§3.4)
    witness.target = spy;
    world.events.emit('bark', { unit: witness, line: 'spy_unmask' });
  }
  world.events.emit('message', { text: `${spy.nickname || 'Spy'} has been unmasked!`, kind: 'warn', unit: spy });
  if (!spy._unmaskFromEvent) world.events.emit('enemy:unmasked-spy', { enemy: witness, spy, why });
  // a distraction in progress ends
  if (spy.currentActionId === 'distract') spy.cancelAction?.();
  return true;
}

/**
 * Check a suspicious act by a disguised Spy: every enemy that sees him (disguise ignored) unmasks him.
 * @returns {boolean} unmasked
 */
export function suspiciousAct(world, spy, why) {
  if (!spy?.disguised) return false;
  const seen = witnessesOf(world, spy);
  if (!seen.length) return false;
  return unmaskSpy(world, spy, seen[0], why);
}

/** Record the enemies that see `unit` right now as witnesses (before he goes under). */
export function recordWitnesses(world, unit) {
  const ws = witnessesOf(world, unit);
  unit.witnesses = new Set(ws);
  return ws;
}

/** Install the per-world systems (idempotent). */
export function installAbilitySystems(world) {
  if (!world || world[KEY]) return world?.[KEY];
  const sys = { decoys: new Set() };
  world[KEY] = sys;

  world.listen('enemy:unmasked-spy', ({ enemy, spy }) => {
    if (!spy?.disguised) return;
    spy._unmaskFromEvent = true;
    try { unmaskSpy(world, spy, enemy, 'ai'); } finally { spy._unmaskFromEvent = false; }
  });
  // killing or injecting in view (§3.4): the killer is a disguised spy
  world.listen('unit:killed', ({ killer }) => {
    if (killer?.disguised) suspiciousAct(world, killer, 'kill');
  });
  world.listen('vehicle:enter', ({ unit }) => {
    if (unit?.disguised) suspiciousAct(world, unit, 'vehicle');
  });

  world.onBelTick((dt20, n) => {
    for (const c of world.commandos) {
      if (!c.alive) continue;
      // Spy: continuous suspicious states
      if (c.disguised) {
        const carryingBody = c.carrying && c.carrying.kind !== 'interactable';
        const armedMove = !!c.armed && c.isMoving;
        if (c.isRunning || carryingBody || armedMove) suspiciousAct(world, c, c.isRunning ? 'running' : carryingBody ? 'carry' : 'armed');
      }
      // witness bookkeeping: drop witnesses who lost him (canSee applies the near-band rule)
      if (c.witnesses?.size) {
        if (!c.buried && !c.underwater) c.witnesses.clear();
        else for (const e of [...c.witnesses]) if (!e.alive || canSee(e, c, world) === 'none') c.witnesses.delete(e);
      }
    }
    // decoy pulses every 1.5 s (30 ticks) while on
    const every = Math.round(CONFIG.stealth.noise.decoy.pulse * CONFIG.sim.belTickHz);
    for (const d of sys.decoys) {
      if (d.removed || !d.on) continue;
      if ((n - d.onTick) % every === 0) d.pulse();
    }
  });
  return sys;
}

/** The systems object of a world (installs on demand). */
export function systemsOf(world) {
  return installAbilitySystems(world);
}
