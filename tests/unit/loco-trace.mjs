/**
 * Locomotion trace helpers (headless): per-tick position / speed / heading / anim of chosen units and the
 * smoothness + overlap metrics the locomotion tests assert (jerk = speed spikes and stop-starts, heading
 * flips, unit-vs-unit overlap). Not a *.test.mjs file: imported by locomotion.test.mjs and scratch scripts.
 */
import { makeSim } from './abilsim.mjs';
import { Entity } from '../../src/entities/entity.js';

const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

/** Boot a full mission def headless (brains on). */
export function missionSim(def) {
  Entity.nextId = 1;
  return makeSim(def);
}

/**
 * Step `sim` for `secs`, sampling `ids` every tick.
 * @returns {{ids: string[], samples: Record<string, {t:number,x:number,z:number,h:number,v:number,anim:string,moving:boolean}[]>}}
 */
export function trace(sim, ids, secs, { dt = 1 / 60, each = null } = {}) {
  const samples = Object.fromEntries(ids.map((id) => [id, []]));
  const n = Math.round(secs / dt);
  for (let k = 0; k < n; k++) {
    const before = ids.map((id) => { const u = sim.get(id); return u ? { x: u.x, z: u.z } : null; });
    sim.step(dt);
    ids.forEach((id, i) => {
      const u = sim.get(id), b = before[i];
      if (!u || !b) return;
      samples[id].push({ t: sim.world.time, x: u.x, z: u.z, h: u.heading, v: Math.hypot(u.x - b.x, u.z - b.z) / dt, anim: u._anim, moving: !!u._moving, alive: u.alive });
    });
    each?.(sim, k);
  }
  return { ids, samples };
}

/**
 * Smoothness metrics of one unit's samples.
 * - stopStarts: moving→still→moving flips where the still gap is shorter than `minPause` s (a visible stutter)
 * - animFlips: walk/run ↔ idle animation switches
 * - maxAccel: largest |Δspeed|/dt between consecutive moving ticks (m/s²) — speed spikes
 * - maxTurn: largest heading change per tick while moving (rad)
 */
export function smoothness(s, { dt = 1 / 60, minPause = 0.5 } = {}) {
  let stopStarts = 0, animFlips = 0, maxAccel = 0, maxTurn = 0, still = 0, wasMoving = false;
  for (let k = 1; k < s.length; k++) {
    const a = s[k - 1], b = s[k];
    if (!b.alive) break;
    const mv = b.v > 0.05;
    if (mv && !wasMoving && still > 0 && still < minPause) stopStarts++;
    if (mv) still = 0; else if (wasMoving || still > 0) still += dt;
    wasMoving = mv;
    if (a.anim !== b.anim && a.anim && b.anim) animFlips++;
    if (a.v > 0.05 && b.v > 0.05) {
      maxAccel = Math.max(maxAccel, Math.abs(b.v - a.v) / dt);
      maxTurn = Math.max(maxTurn, Math.abs(angDiff(b.h, a.h)));
    }
  }
  return { stopStarts, animFlips, maxAccel, maxTurn };
}

/** Closest approach between two traced units (m) and the time it happened. */
export function closest(tr, a, b) {
  const A = tr.samples[a], B = tr.samples[b];
  let best = Infinity, t = 0;
  for (let k = 0; k < Math.min(A.length, B.length); k++) {
    if (!A[k].alive || !B[k].alive) continue;
    const d = Math.hypot(A[k].x - B[k].x, A[k].z - B[k].z);
    if (d < best) { best = d; t = A[k].t; }
  }
  return { d: best, t };
}
