/**
 * BCD set-pieces (docs/expansion/MECHANICS.md, "Papers on the table"). Owned by MISSIONS. Registered on import
 * (setpieces.js); only BCD missions place them.
 *
 *   evidence {id, at: [x, z], label?, objective?, take?: s, mesh?: false,
 *             burn?: {actor, at: [x, z], events: ['RMAS'], time: s | {easy, hard}, fail, face?: deg}}
 *
 *   - The papers lie at `at` as a hand device (Hand / Use, `take` s, as unseen as any use): using it takes them, sets
 *     the objective `objective` done and clears the table.
 *   - `burn`: once one of `events` has been raised (alarm:zone) and while the papers are still there, their keeper
 *     `actor` — when he is free: alive, not knocked out, cuffed, on strings, carried or aboard a vehicle — walks to the
 *     stove `at` (the FLEE walk: he goes and stays) and burns them for `time` s, an orange arc under him filling
 *     (render/bcd-overlay.js, `world._bcdTimers`). Taken first, or the keeper a captive, the alarm is only an alarm. The
 *     arc closed with the papers still on the table, the mission fails with `fail` (director.fail: the 5 s grace).
 *   - The state (taken, armed, phase, time burned) is saved with the game (SetPiece save / load).
 * @module missions/setpieces-bcd
 */

import * as THREE from 'three';
import { SetPiece, registerSetpiece, P } from './setpiece-base.js';
import { addDevice } from './setpiece-device.js';
import { runAction } from './setpiece-actions.js';
import { startFlee } from '../ai/bcd-brain.js';

/** Is enemy `e` free to act on his own (not a captive of any kind, not riding)? */
export function keeperFree(e) {
  return !!(e && e.alive !== false && !e.removed && !e.ko && !e.puppetOf && !e.carriedBy && e.state !== 'carried' && !e.vehicle && e.state !== 'inVehicle');
}

/** The burn time for the mission's difficulty (`time`: seconds, or {easy, hard}). */
export function burnTime(spec, world) {
  const t = spec?.time;
  if (t && typeof t === 'object') return world?.mission?.difficulty === 'easy' ? (t.easy ?? t.hard ?? 25) : (t.hard ?? t.easy ?? 25);
  return Number.isFinite(t) ? t : 25;
}

/** A small iron-bound key-table case with a sheaf of papers on it (visual; local origin on the table top). */
function caseMesh() {
  const g = new THREE.Group();
  g.name = 'evidence:case';
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2e2f30, roughness: 0.5, metalness: 0.6 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.95 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.32), wood);
  box.position.y = 0.08;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.03, 0.33), iron);
  lid.position.y = 0.175;
  const sheaf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.21), paper);
  sheaf.position.set(0.02, 0.2, 0);
  sheaf.rotation.y = 0.12;
  for (const m of [box, lid, sheaf]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

class Evidence extends SetPiece {
  build(world, opts = {}) {
    this.taken = false; this.armed = false; this.phase = 'idle'; this.burned = 0;
    const at = P(this.spec.at);
    this.device = addDevice(world, { ...at, id: `${this.tag}_case`, label: this.spec.label ?? 'Papers', sfx: 'papers', activation: this.spec.take ?? 0.8,
      meshes: false, canUseFn: () => (this.taken ? 'Nothing left to take.' : true), onUse: (c) => this.take(c) });
    if (opts.meshes !== false && world.scene && this.spec.mesh !== false) {
      this.mesh = caseMesh();
      this.mesh.position.set(at.x, this.spec.y ?? 0.82, at.z);
      this.mesh.rotation.y = -(this.spec.rot ?? 0);
      world.scene.add(this.mesh);
    }
    const B = this.spec.burn;
    if (B?.events?.length) world.listen('alarm:zone', (p) => { if (B.events.includes(p?.event)) this.armed = true; });
  }

  /** The papers taken by commando `c` (the device's use): the objective, the table cleared, no burn any more. */
  take(c) {
    if (this.taken) return false;
    this.taken = true;
    if (this.mesh) this.mesh.visible = false;
    this._clearRing();
    const w = this.world, keeper = this.spec.burn ? w.byId(this.spec.burn.actor) : null;
    if (this.phase === 'walk' || this.phase === 'burn') { this.phase = 'done'; if (keeper?.brain && keeper.alive) keeper.brain._set?.('RETURN'); }
    if (this.spec.objective && this.director) runAction(this.director, { objective: this.spec.objective, set: 'done' }, {});
    w.events.emit('message', { text: `${c?.nickname || 'Commando'} has the ${String(this.spec.label ?? 'papers').toLowerCase()}.`, kind: 'objective', unit: c });
    w.events.emit('bcd:evidence', { id: this.tag, taken: true, by: c });
    return true;
  }

  tick(dt) {
    const B = this.spec.burn;
    if (!B || this.taken || !this.armed || this.phase === 'done' || this.phase === 'ash') return;
    const w = this.world, e = w.byId(B.actor);
    if (!e || e.alive === false) { this.phase = 'done'; this._clearRing(); return; }
    const stove = P(B.at);
    if (this.phase === 'idle') {
      if (!keeperFree(e) || !e.brain) return;
      // (the keeper walks: FLEE with `walk`, he goes and stays there — ai/bcd-brain.js startFlee)
      if (!startFlee(e.brain, stove, { walk: true })) return;
      this.phase = 'walk';
      w.events.emit('message', { text: B.warn ?? 'The papers are being burned!', kind: 'warn' });
      w.events.emit('bcd:evidence', { id: this.tag, burning: 'walk', by: e });
      return;
    }
    if (!keeperFree(e)) { this.phase = 'idle'; this._clearRing(); return; } // taken captive on the way: he starts again when free
    if (this.phase === 'walk') {
      if (Math.hypot(e.x - stove.x, e.z - stove.z) > (B.reach ?? 1.6)) { if (!e.isMoving && e.brain?.state !== 'FLEE') startFlee(e.brain, stove, { walk: true }); return; }
      this.phase = 'burn';
      if (B.face != null) e.brain?._turnTo?.((B.face * Math.PI) / 180);
      e.playAction?.('use', burnTime(B, w));
      w.events.emit('bcd:evidence', { id: this.tag, burning: 'burn', by: e });
    }
    this.burned += dt;
    const T = burnTime(B, w);
    (w._bcdTimers || (w._bcdTimers = new Map())).set(this.tag, { x: e.x, z: e.z, k: Math.min(1, this.burned / T), kind: 'burn' });
    if (this.burned < T) return;
    this.phase = 'ash';
    this._clearRing();
    if (this.mesh) this.mesh.visible = false;
    w.events.emit('bcd:evidence', { id: this.tag, burned: true, by: e });
    this.director?.fail(B.fail ?? 'THE PAPERS ARE ASH.');
  }

  _clearRing() { this.world?._bcdTimers?.delete(this.tag); }

  save() { return { taken: this.taken, armed: this.armed, phase: this.phase, burned: this.burned }; }
  load(s) {
    this.taken = !!s.taken; this.armed = !!s.armed; this.phase = s.phase ?? 'idle'; this.burned = s.burned ?? 0;
    if (this.mesh) this.mesh.visible = !this.taken && this.phase !== 'ash';
    if (this.phase !== 'burn') this._clearRing();
  }
}
registerSetpiece('evidence', Evidence);
