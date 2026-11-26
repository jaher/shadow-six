/**
 * LIGHTS OUT mission 7 "White Out" (docs/expansion/e07.md): mission-local data and runtime glue. Owned by MISSIONS.
 *
 *  - the shapes the def, its art (art/e07-dressing.js) and its solution (tools/solutions/e07.solution.mjs) share: the
 *    ridge (a 30 m plateau reached only by the cable car), the rock spur and its tunnel, the avalanche gallery and the
 *    loaded cornice above it, the hotel, its sun terrace and the press lorry;
 *  - the `e07` set-piece (saved with the game):
 *      · the knapsack objectives (o1, o1b); the type plates (o2) are BCD's `evidence` set-piece (missions/setpieces-bcd.js:
 *        a hand device on the press lorry's tailboard, smashed by the Feldwebel `pf1` on the hotel's alarm unless taken);
 *      · closing the pass (o3): the cornice charge buries the gallery (men in the slide outside it die, men inside are
 *        shut in; the road is rock from z 18 to z 50) — or the fuel bowser blown up inside the tunnel bore (a burning
 *        wreck that seals it);
 *      · the goods cabin's berth: Vering, cuffed and laid down in the docked cabin's berth by the man who carried him,
 *        is put aboard as cargo (the cabin is a rail vehicle: BCD captive cargo, abilities/drive.js, loads land vehicles
 *        only); the car leaves the lower berth only with every living commando aboard, Vering aboard and o1–o3 done; on
 *        the way up, with the summit alarm (RSUM) raised and the flak crew alive, the flak shoots it down;
 *      · Vering does not run: on the hotel's alarm he leaves his desk for the woodshed corner behind the hotel and stays
 *        there (still a man the Spy can take);
 *      · the soft-lock guard: the cornice falls to a demolition charge only and the Sapper's pack holds one; with that
 *        charge spent elsewhere and the bowser blown outside the bore the mission fails (PASS_LOCK_FAIL) instead of
 *        running on, unwinnable;
 *      · the docked cabin with everyone and the Major aboard but o1–o3 not all done says what it still waits for.
 *  - `e07Script(spec)`: the mission script (installs nothing beyond the visuals; `.visuals` builds the art at load).
 * @module missions/scripts/e07
 */

import { SetPiece, registerSetpiece, inPoly } from '../setpiece-base.js';
import { runSliced } from '../../engine/slice.js';
import { startFlee } from '../../ai/bcd-brain.js';
import { B } from '../../world/grid.js';

export const RIDGE_Y = 30;
const deg = (d) => (d * Math.PI) / 180;
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

// ---------------------------------------------------------------- shapes (docs/expansion/e07.md §3–§4)
/** The ridge top (y 30): the plateau east of the cliff, reached only by the cable car. */
export const RIDGE = rect(107, 4, 120, 196);
/** The ridge's cliff foot (gameplay: a 2.5 m rock band; the 30 m face is drawn by the art). */
export const RIDGE_FACE = rect(104.6, 4, 107, 196);
/** The rock spur the tunnel pierces, either side of the bore (x 55.5–60.5). */
export const SPUR_W = [[43, 62], [55.4, 62], [55.4, 92], [44, 92], [42, 84], [42.5, 70]];
export const SPUR_E = [[60.6, 62], [74, 62], [77, 68], [77.5, 80], [75, 92], [60.6, 92]];
/** The tunnel bore: an open corridor through the spur (the rock is drawn over it). */
export const TUNNEL = { x0: 55.4, x1: 60.6, z0: 62, z1: 92 };
/** The bowser blown up with its centre in here seals the bore (o3, the loud way). */
export const TUNNEL_SEAL = rect(54, 63, 62, 91);
/** The avalanche gallery: concrete roof on pillars over the north road, its uphill (east) side a wall. */
export const GALLERY = { x0: 55, x1: 61.2, z0: 22, z1: 48 };
/** The snow bank between the gallery's wall and the slope (gameplay rock band; the cornice is drawn on its crest). */
export const CORNICE_BANK = rect(61.6, 21, 68, 47);
/** Where the charge has to go to bring the cornice down (the bank's foot on the slope side). */
export const CORNICE_AT = [70.6, 34];
/** The slide: everything here outside the gallery's inside is buried (rock to walkers; men in it die). */
export const SLIDE = rect(50, 17, 74, 51);
export const GALLERY_INSIDE = rect(55.2, 22.6, 61.0, 47.4);
/** The hotel (gasthof) and its sun terrace on the east end; Vering's desk is on the terrace. */
export const HOTEL = { x: 64, z: 120, w: 22, d: 11 };
export const TERRACE = { x: 78, z: 120, w: 6, d: 10 };
/** Where Vering goes on the hotel's alarm: behind the woodpile at the hotel's back corner. */
export const VERING_HIDE = [54.2, 112.4];
/** The plate case on the press lorry's tailboard (o2: the `evidence` hand device) and the spot the Feldwebel smashes it from. */
export const PLATE_CASE = [72.6, 161.9];
export const SMASH_AT = [73.6, 162.6];
/** The cable car: lower berth (east of the lower station) and the ridge station's berth. A bound man laid down within
 * BERTH_R of the lower berth while the cabin stands there is put aboard (cargo). */
export const CAR_LOW = { x: 95.6, z: 126, y: 0.5 };
export const CAR_TOP = { x: 109.6, z: 103.8, y: RIDGE_Y + 0.5 }; // the dock on the ridge station's south side
/** Where the ropes break over the head frame at the rim: the cabin climbs clear of the face and rides in over the lip
 * (the frame is the mission's art: art/e07-dressing.js; `support: false` = the cable kit draws only the rope grooves). */
// (on the plan line from the lower berth to the ridge berth: the cabin's heading at the dock and its footprint are the
// straight line's; only the height profile breaks — steep up the face, then level in over the lip)
export const CAR_BEND = { x: 105.6, z: 126 - 22.2 * (10 / 14), y: RIDGE_Y + 1.6, support: false };
/** The extraction's exit: the car docked at the ridge station. */
export const CAR_EXIT = { x: CAR_TOP.x, z: CAR_TOP.z, r: 3 };
export const BERTH_R = 2.6;

const inRect = (r, x, z) => x >= r[0][0] && x <= r[1][0] && z >= r[0][1] && z <= r[2][1];

/** The soft-lock fail: no charge left to bring the cornice down and the bowser burnt out of the bore. */
export const PASS_LOCK_FAIL = 'NO CHARGE LEFT AND THE BOWSER GONE: THE PASS CAN NO LONGER BE CLOSED.';

/**
 * Demolition charges (time or remote) that could still bring the cornice down, counted generously so the guard never
 * fails early: in a living commando's kit, still in a knapsack on the snow, set on the ground and not yet gone off,
 * lying as a pickup or in a crate, or in flight. (Only a demolition charge brings the cornice down: grenades do not.)
 * @param {import('../../world/world.js').World} world
 * @returns {number}
 */
export function passChargesLeft(world) {
  let n = 0;
  const bombs = (o) => (o?.remoteBomb ?? 0) + (o?.timeBomb ?? 0);
  for (const c of world.commandos || []) if (c.alive !== false) n += (c.inventory?.get?.('remoteBomb') ?? 0) + (c.inventory?.get?.('timeBomb') ?? 0);
  for (const it of world.interactables || []) {
    if (it.removed) continue;
    if (it.interactKind === 'bomb' && it.placed) n += 1;
    else if (it.interactKind === 'knapsack' && it.count > 0) n += bombs(it.contents ?? it.params?.contents);
    else if (it.interactKind === 'pickup' && (it.itemId === 'remoteBomb' || it.itemId === 'timeBomb')) n += it.count ?? 1;
    else if (it.interactKind === 'crate') n += bombs(it.contents);
  }
  for (const p of world.projectiles || []) if (!p.removed && p.alive !== false && (p.projKind === 'remoteBomb' || p.projKind === 'timeBomb')) n += 1;
  return n;
}

/** What the cabin waits for besides its passengers (o1–o3), as the player reads it. */
const DEPARTURE_NEEDS = [['o1', 'the Sapper\'s pack is still in the container'], ['o2', 'the type plates are still on the press lorry'],
  ['o3', 'the pass is still open']];
const listOf = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** Grid cells of polygon `poly` (centres inside). */
function polyCells(g, poly) {
  const out = [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const c = g.cell;
  for (let j = Math.max(0, Math.floor(z0 / c)); j <= Math.min(g.rows - 1, Math.floor(z1 / c)); j++) {
    for (let i = Math.max(0, Math.floor(x0 / c)); i <= Math.min(g.cols - 1, Math.floor(x1 / c)); i++) {
      const x = (i + 0.5) * c, z = (j + 0.5) * c;
      if (inPoly(poly, x, z)) out.push(j * g.cols + i);
    }
  }
  return out;
}

/** Stamp the cells (rock): walkers stop there; sight runs over it as over any rock (B.HIGH). */
function rockCells(g, cells) {
  for (const k of cells) { g.block[k] = B.HIGH; if (g.navBlock) g.navBlock[k] = 1; }
  g.version++;
}

const objective = (w, id) => (w.objectives || []).find((o) => o.id === id) || null;
function setDone(w, id) {
  const o = objective(w, id);
  if (!o || o.done || o.failed) return false;
  o.done = true; o.hidden = false;
  w.events.emit('objective:update', { objective: o });
  return true;
}

/** Every living commando (guests none here) aboard vehicle `v`. */
function teamAboard(w, v) {
  const men = (w.commandos || []).filter((c) => c.alive !== false && !c.removed);
  return men.length > 0 && men.every((c) => c.vehicle === v || v.occupants?.includes(c));
}

/**
 * The `e07` set-piece: objectives o1/o1b/o2/o3, the pass closing, the cable car's departure and the flak, Vering's
 * hide. Its state (`closed`, `plates`, `rsum`, `shot`, `hid`) is saved with the game; grid stamps are re-applied on load.
 */
class E07 extends SetPiece {
  build(world, opts = {}) {
    this.closed = null; // 'cornice' | 'bowser'
    this.rsum = false; // the summit alarm (RSUM) has been raised
    this.shot = false; // the car shot down
    this.hid = false; // Vering has gone to his hide
    this.trackT = 0; // s the flak has had the car in its sights
    this._meshes = opts.meshes !== false && !!world.scene;
    this.lockAt = null; // when the soft-lock guard looks next (a charge gone off, the bowser blown)
    this.waitSaid = null; // what the docked cabin last said it is waiting for
    world.listen('structure:destroyed', (p) => {
      if (p.id === 'cornice') this.closePass('cornice');
      else if (p.id === 'bowser') { this.bowserBlown(); this._lookAgain(); }
    });
    world.listen('bomb:exploded', () => this._lookAgain());
    world.listen('alarm:zone', (p) => {
      if (p.zone === 'z_summit') this.rsum = true;
      if (p.zone === 'z_hotel') this.veringHides();
    });
  }
  init() {
    this.car = this.world.byId('cablecar');
    this.vering = this.world.byId('vering');
  }

  // ---------------------------------------------------------------- o3: the pass closed
  /** The cornice comes down (the charge) or the bowser burns in the bore. */
  closePass(how, at = null) {
    if (this.closed) return false;
    this.closed = how;
    const w = this.world, g = w.grid;
    if (how === 'cornice') {
      // men caught in the slide outside the gallery die; those inside it are shut in (both ends buried)
      for (const u of [...w.enemies, ...w.commandos]) {
        if (!u.alive || u.removed || (u.y || 0) > 2) continue;
        if (inRect(SLIDE, u.x, u.z) && !inRect(GALLERY_INSIDE, u.x, u.z)) u.die?.('explosion', null);
      }
      this._stampSlide(g);
      this.say('The cornice is down. The north road is buried under the slide.', 'objective');
    } else {
      this.wreckAt = at || { x: (TUNNEL.x0 + TUNNEL.x1) / 2, z: (TUNNEL.z0 + TUNNEL.z1) / 2 };
      this._stampWreck(g);
      this.say('The bowser burns in the tunnel. Nothing gets through there now.', 'objective');
    }
    setDone(w, 'o3');
    w.events.emit('e07:pass-closed', { how });
    return true;
  }
  _stampSlide(g) {
    rockCells(g, polyCells(g, SLIDE).filter((k) => {
      const i = k % g.cols, j = Math.floor(k / g.cols), x = (i + 0.5) * g.cell, z = (j + 0.5) * g.cell;
      return !inRect(GALLERY_INSIDE, x, z);
    }));
  }
  _stampWreck(g) {
    const z = this.wreckAt?.z ?? 77;
    rockCells(g, polyCells(g, rect(TUNNEL.x0 - 0.5, z - 3.5, TUNNEL.x1 + 0.5, z + 3.5)));
  }
  bowserBlown() {
    const b = this.world.byId('bowser');
    if (!b || !inPoly(TUNNEL_SEAL, b.x, b.z)) return;
    this.closePass('bowser', { x: b.x, z: b.z });
  }

  // ---------------------------------------------------------------- the soft-lock guard
  /** Half a second after a charge went off or the bowser blew (the slide and the wreck have had their say), look. */
  _lookAgain() { if (!this.closed) this.lockAt = (this.world.time ?? 0) + 0.5; }
  /**
   * The pass can no longer be closed: the cornice falls to a demolition charge only (`by: ['bomb']`: grenades do not
   * touch it, the bowser's fuel-tank blast neither), the Sapper's pack holds one remote charge, and the bowser was the
   * other way. With the cornice standing, no charge left anywhere and the bowser burnt out of the bore, the mission
   * fails instead of running on, unwinnable (as e03's main mast, M20 T7).
   * @returns {boolean} it failed the mission
   */
  checkPassLock() {
    const w = this.world;
    if (this.closed || w.scriptFail || objective(w, 'o3')?.done) return false;
    const b = w.byId('bowser');
    if (b && !b.destroyed && !b.removed) return false;
    if (passChargesLeft(w) > 0) return false;
    this.director?.fail(PASS_LOCK_FAIL);
    return true;
  }

  // ---------------------------------------------------------------- Vering
  veringHides() {
    const v = this.vering || (this.vering = this.world.byId('vering'));
    if (this.hid || !v?.alive || v.ko || v.puppetOf || v.carriedBy || v.state === 'inVehicle' || !v.brain) return;
    this.hid = true;
    startFlee(v.brain, VERING_HIDE, { leave: false });
  }

  // ---------------------------------------------------------------- the cable car
  /** The cabin standing at the lower berth (not under way). */
  _atLowBerth(v) { return !!v && !v.destroyed && (v.railS ?? 0) <= 1e-6 && !(v.speed > 0); }
  /**
   * Vering laid down bound in the docked cabin's berth: put aboard as cargo (a seat at the back; never its operator).
   * The man who carried him drops him there (Drop): BCD captive cargo itself loads land vehicles only.
   */
  _berth() {
    const v = this.car, ver = this.vering;
    if (!this._atLowBerth(v) || !ver?.alive || ver.ko !== 'bound' || ver.carriedBy || ver.state === 'carried' || ver.vehicle || ver.puppetOf) return false;
    if (Math.hypot(ver.x - CAR_LOW.x, ver.z - CAR_LOW.z) > BERTH_R || v.canEnter(ver) !== true) return false;
    const free = v.freeSeats();
    v.enter(ver, free.length ? free[free.length - 1] : null);
    if (v.driver === ver) v.driver = null;
    this.world.events.emit('e07:aboard', { unit: ver });
    this.say('Major Vering is aboard the cabin, trussed like a sack of flour.', 'objective');
    return true;
  }
  /** The car may leave: everyone aboard, Vering aboard (or dead: o4 fails anyway), o1–o3 done. */
  departureReady() {
    const w = this.world, v = this.car;
    if (!v || v.destroyed) return false;
    if (!['o1', 'o2', 'o3'].every((id) => objective(w, id)?.done)) return false;
    const ver = this.vering;
    if (ver?.alive && !v.occupants?.includes(ver)) return false;
    return teamAboard(w, v);
  }
  /**
   * Everyone and the Major aboard the docked cabin while the pack, the plates or the pass are still to do: the cabin
   * says what it waits for (once for each new list), instead of waiting without a word.
   */
  _sayWaiting(v) {
    const w = this.world, ver = this.vering;
    const loaded = teamAboard(w, v) && (!ver?.alive || v.occupants?.includes(ver));
    const missing = loaded ? DEPARTURE_NEEDS.filter(([id]) => !objective(w, id)?.done).map(([, what]) => what) : [];
    const key = missing.join('|');
    if (!missing.length) { if (!loaded) this.waitSaid = null; return; }
    if (key === this.waitSaid) return;
    this.waitSaid = key;
    this.say(`The cabin stays at its berth: ${listOf(missing)}.`, 'warn');
  }
  _tickCar(dt) {
    const v = this.car;
    if (!v || v.destroyed || !v.track) return;
    const atLow = (v.railS ?? 0) <= 1e-6;
    if (atLow && !v.railRunning) this._sayWaiting(v);
    const go = atLow && this.departureReady();
    if (!v.railRunning) {
      if (go && v.railT > 3) v.railT = 2;
      else if (!go && v.railT < 1e8) v.railT = 1e9;
    } else {
      const docked = (v.railS ?? 0) <= 1e-6 || (v.railS ?? 0) >= (v.trackLen ?? 0) - 1e-6;
      if (docked) {
        if (go) { if (!(v.waitT <= 3)) v.waitT = 2; } else v.waitT = 1e9;
      }
    }
    // in the air with the summit alarm up: the flak tracks it and shoots it down
    const flying = v.railRunning && (v.railS ?? 0) > 0.5 && (v.railS ?? 0) < (v.trackLen ?? 0) - 0.5;
    const flak = ['fk1', 'fk2'].some((id) => { const e = this.world.byId(id); return e?.alive && !e.ko && !e.incapacitated; });
    if (flying && this.rsum && flak && !this.shot) {
      this.trackT += dt;
      if (this.trackT >= 2.5) this._shootDown(v);
    } else if (!flying) this.trackT = 0;
  }
  _shootDown(v) {
    this.shot = true;
    for (const u of [...(v.occupants || [])]) u.die?.('explosion', null);
    v.destroyed = true;
    if (v.object3d) v.object3d.visible = false;
    this.world.events.emit('e07:car-shot', { x: v.x, z: v.z, y: v.y });
    this.director?.fail('THE FLAK HAS SHOT DOWN THE CABLE CAR.');
  }

  // ---------------------------------------------------------------- per tick
  tick(dt) {
    const w = this.world;
    // o1 / o1b: a knapsack taken by its owner is gone from the snow
    for (const [id, o] of [['knap_sap', 'o1'], ['knap_drv', 'o1b']]) {
      if (objective(w, o)?.done) continue;
      const k = w.byId(id);
      if (!k || k.removed || k.count <= 0) setDone(w, o);
    }
    this._berth();
    this._tickCar(dt);
    if (this.lockAt != null && w.time >= this.lockAt - 1e-9) { this.lockAt = null; this.checkPassLock(); }
  }

  save() { return { closed: this.closed, rsum: this.rsum, shot: this.shot, hid: this.hid, wreckAt: this.wreckAt ?? null, lockAt: this.lockAt ?? null, waitSaid: this.waitSaid ?? null }; }
  load(s) {
    this.rsum = !!s.rsum; this.shot = !!s.shot; this.hid = !!s.hid;
    this.wreckAt = s.wreckAt || null;
    this.lockAt = s.lockAt ?? null;
    this.waitSaid = s.waitSaid ?? null;
    this.closed = s.closed || null;
    const g = this.world?.grid;
    if (g && this.closed === 'cornice') this._stampSlide(g);
    if (g && this.closed === 'bowser') this._stampWreck(g);
  }
}
registerSetpiece('e07', E07);

/** The e07 set-piece instance on a world (tests, the solution). */
export const e07Of = (world) => world.setpieces?.get?.('e07') ?? null;

/**
 * mission.script(world, director): the art (built once; `.visuals` builds it as the load ends — as a sliced job when
 * `artG` gives the build as a generator, engine/slice.js: the loading screen keeps drawing — so the script's call finds
 * it built). The runtime rules live in the `e07` set-piece.
 */
export function e07Script(art = null, artG = null) {
  const script = (world) => art?.(world);
  script.visuals = (world) => (artG ? runSliced(artG(world)) : art?.(world));
  return script;
}

export { deg };
