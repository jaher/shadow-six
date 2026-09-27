/**
 * Wild-animal brain (docs/bcd-plan.md §1.9; BCD only — BEL never spawns these types): lion, ostrich, chicken.
 * States IDLE (wander inside the pen), CHARGE, ATTACK, RETURN; chickens FLEE and cluck. Animals ignore
 * disguises, stones and packs, never use the soldier alarm system and never leave their pen
 * (`spawn.pen = {x, z, r}` or `{points:[[x, z], …]}`; an open `spawn.penGate` door lets ostriches roam and
 * attack soldiers too). Same public surface as EnemyBrain so world.ai / alarm / save treat it alike.
 * @module ai/animal-brain
 */

import { CONFIG } from '../config.js';

const noop = () => {};

function inPoly(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export class AnimalBrain {
  constructor(enemy) {
    this.enemy = enemy;
    this.kind = enemy.soldierType;
    this.state = 'IDLE';
    this.t = 0;
    this.target = null;
    this.hitT = 0;
    this.wanderT = 0;
    this.provokedBy = null;
    this.world = null;
    this._seen = [];
    this.arch = { reacts: false, alarms: false, challenges: false, script: 'animal' };
    this.bcd = false;
  }

  attach(world) {
    this.world = world;
    const e = this.enemy;
    this.home = { x: e.x, z: e.z };
    const p = e.spawn?.pen;
    this.pen = p?.points ? { points: p.points } : { x: p?.x ?? e.x, z: p?.z ?? e.z, r: p?.r ?? CONFIG.bcd.animals[this.kind]?.radius ?? 6 };
  }

  get cfg() { return CONFIG.bcd.animals[this.kind] || {}; }

  /** Pen gate open (ostriches roam the zoo)? */
  roaming() {
    const id = this.enemy.spawn?.penGate;
    if (id == null || !this.world) return false;
    const g = this.world.interactables.find((i) => (i.tag ?? i.id) === id);
    return !!g?.open;
  }

  inPen(x, z) {
    if (this.roaming()) return true;
    const P = this.pen;
    return P.points ? inPoly(P.points, x, z) : Math.hypot(x - P.x, z - P.z) <= P.r;
  }

  _set(s) {
    if (s === this.state) return;
    const from = this.state;
    this.state = s;
    this.t = 0;
    this.world?.events.emit('enemy:state', { enemy: this.enemy, from, to: s });
  }

  /** Prey in reach: commandos (and soldiers when an ostrich roams), inside the pen, within `r`. */
  _prey(r) {
    const e = this.enemy, w = this.world;
    const list = [...w.commandos];
    if (this.kind === 'ostrich' && this.roaming()) list.push(...w.enemies.filter((q) => q !== e && !q.brain?.arch?.script?.startsWith?.('animal') && q.soldierType !== 'zookeeper'));
    let best = null, bd = Infinity;
    for (const u of list) {
      if (!u.alive || u.removed || u.state === 'inVehicle' || u.hidden || u.state === 'hidden' || u.underwater) continue;
      if (!this.inPen(u.x, u.z)) continue;
      const d = Math.hypot(u.x - e.x, u.z - e.z);
      if (d <= r && d < bd) { bd = d; best = u; }
    }
    return best;
  }

  update(dt) {
    const e = this.enemy, w = this.world;
    if (!e.alive || !w) return;
    this.t += dt;
    this.hitT -= dt;
    if (this.kind === 'chicken') return this._chicken(dt);
    const C = this.cfg;
    const aggro = this.kind === 'lion' ? C.radius : C.provoke;
    if (this.state === 'IDLE' || this.state === 'RETURN') {
      const p = (this.provokedBy?.alive && this.inPen(this.provokedBy.x, this.provokedBy.z)) ? this.provokedBy : this._prey(aggro);
      if (p) { this.target = p; this._set('CHARGE'); }
    }
    const tg = this.target;
    if (this.state === 'CHARGE' || this.state === 'ATTACK') {
      if (!tg || !tg.alive || !this.inPen(tg.x, tg.z) || tg.state === 'inVehicle') { this.target = null; this.provokedBy = null; e.speedMul = 1; this._set('RETURN'); return; }
      const d = Math.hypot(tg.x - e.x, tg.z - e.z);
      const W = CONFIG.weapons[e.weapon] || { range: 1.5 };
      if (d <= W.range) {
        this._set('ATTACK');
        e.stop();
        e.faceTowards(tg.x, tg.z);
        if (this.hitT <= 0) {
          this.hitT = C.cadence ?? 1;
          e.playAction('stab', 0.4);
          tg.takeDamage(C.dmg ?? W.dmg ?? 40, e, this.kind);
          w.events.emit('hit', { x: tg.x, z: tg.z, surface: 'flesh', target: tg, weapon: this.kind });
        }
      } else {
        this._set('CHARGE');
        e.speedMul = (C.speed ?? 5) / CONFIG.ai.chaseSpeed;
        if (!e.isMoving || this.t > 0.4) { this.t = 0; e.moveTo(tg.x, tg.z, { run: true }); }
      }
      return;
    }
    e.speedMul = 1;
    if (this.state === 'RETURN') {
      if (!e.isMoving) this._set('IDLE');
      if (!this.inPen(e.x, e.z) && !e.isMoving) e.moveTo(this.home.x, this.home.z);
      return;
    }
    this.wanderT -= dt;
    if (this.wanderT <= 0 && !e.isMoving) {
      this.wanderT = 3 + w.rng.next() * 4;
      const P = this.pen, cx = P.x ?? this.home.x, cz = P.z ?? this.home.z, r = (P.r ?? 4) * 0.7;
      const a = w.rng.next() * Math.PI * 2, rr = w.rng.next() * r;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (this.inPen(x, z)) e.moveTo(x, z);
    }
  }

  _chicken() {
    const e = this.enemy, w = this.world, C = this.cfg;
    const near = [...w.commandos, ...w.enemies].find((u) => u !== e && u.alive && u.soldierType !== 'chicken' && Math.hypot(u.x - e.x, u.z - e.z) <= C.flee);
    if (!near) { if (this.state === 'FLEE' && !e.isMoving) this._set('IDLE'); return; }
    if (this.state === 'FLEE' && e.isMoving) return;
    this._set('FLEE');
    const dx = e.x - near.x, dz = e.z - near.z, n = Math.hypot(dx, dz) || 1;
    e.moveTo(e.x + (dx / n) * 4, e.z + (dz / n) * 4, { run: true });
    w.emitNoise(e.x, e.z, C.noiseRadius, 'cluck', e); // level 1 (CONFIG.stealth.noise.cluck)
  }

  onHurt(src) {
    if (src?.alive && this.kind !== 'chicken') { this.provokedBy = src; this.target = src; this._set('CHARGE'); }
  }

  onDeath() { this.enemy.speedMul = 1; this._set('DEAD'); }
  reacts() { return false; }
  isAware() { return this.state === 'CHARGE' || this.state === 'ATTACK'; }
  distractBy() { return false; }
  serialize() { return { animal: true, state: this.state, t: this.t, hitT: this.hitT, targetId: this.target?.id ?? null, provokedBy: this.provokedBy?.id ?? null }; }
  deserialize(d) {
    this.state = d.state ?? 'IDLE'; this.t = d.t ?? 0; this.hitT = d.hitT ?? 0;
    this.target = d.targetId != null ? this.world?.byId(d.targetId) ?? null : null;
    this.provokedBy = d.provokedBy != null ? this.world?.byId(d.provokedBy) ?? null : null;
  }
}

// the rest of the brain surface is inert for animals
for (const m of ['hear', 'notifyKill', 'belTick', 'releaseDistraction', 'onBodyFound', 'onAlarm', 'onSuspiciousAct', 'onTargetAttacked', 'onTargetGone', 'reinforce', 'bcdEnter']) AnimalBrain.prototype[m] = noop;
