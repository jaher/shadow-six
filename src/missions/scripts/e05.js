/**
 * LIGHTS OUT e05 "Cold Iron": mission glue (docs/expansion/e05.md §6, §9). Owned by the e05 build.
 * Installed once by `mission.script` (the set-piece director's first tick; again on a quick load's rebuilt world):
 *
 *  - objectives: o1 / o3 when a commando has taken the card index / the call-sign book (their `documents` pickups),
 *    o2 when Grethe joins (a commando reached her chair: `joinsAt`), o4 while the drawbridge is up and its keeper can
 *    no longer lower it (bound, a puppet, or dead) — the span brought down again (a commando at the switch) clears it
 *    until it is up again; o5 is the engine's escape objective (the cove), which waits for o1–o4;
 *  - the keeper re-lowers (§9): `relowerAfter` s (variant: Easy 120, Hard 60) after the span rises, the keeper k1 —
 *    awake, free and not a puppet — works the switch again and the span comes down. Knocked out (or carried) he only
 *    waits: he comes round in half a minute and lowers it the moment he can (the briefing's "See to him"). Only the
 *    cuffs, the strings or death stop him for good;
 *  - the burn script (§9): on the fort's alarm (RFORT), while the index is not in a commando's hands, the Kriminalrat
 *    g3 runs for it — to the study while it lies on the desk, to wherever it fell if he dropped it — and on with it to
 *    the signal station's stove on the NE bastion; `burnTime` s there (Easy 45, Hard 30, an orange ring under him
 *    filling) and the mission is lost. Knocked out, he drops the index where he falls and the script waits for him:
 *    awake again, he picks it up and goes on (the time already burned stays burned). Cuffed, on strings or dead, the
 *    script ends (the index lies where he fell);
 *  - Lark is dead: the mission is lost;
 *  - visuals (browser only): scripts/e05-art.js — the fort, the rooms (their roofs lift while a commando is inside).
 * The script's state (the papers, the burn, the keeper's clock) is a set-piece of its own (`e05_state`), saved with the
 * game: a quick load rebuilds the world, restores it and re-runs this script on it. A loose index dropped in play is a
 * pickup made at run time, which a load does not bring back: the state keeps where it lies and the script lays it
 * there again.
 * Everything here reads `world.mission` (the e05 def): no layout of its own.
 * @module missions/scripts/e05
 */

import { createPickup } from '../../entities/interactables.js';
import { SetPiece, registerSetpiece } from '../setpiece-base.js';
import { runSliced } from '../../engine/slice.js';
import { buildE05ArtG } from './e05-art.js';

/** Burn-script and keeper defaults (the variants override: `burnTime`, `relowerAfter`). */
export const E05 = { burnTime: 30, relowerAfter: 60, runSpeed: 3.0, stoveReach: 1.6, switchReach: 1.6, pickReach: 1.2 };

const byTag = (w, tag) => (w.interactables || []).find((i) => (i.tag ?? i.id) === tag && !i.removed) || null;
const enemy = (w, id) => (w.enemies || []).find((e) => (e.tag ?? e.id) === id) || null;
/** Out of the fight for good (the script's actors): dead, cuffed or on puppet strings. */
export const outForGood = (e) => !e || e.alive === false || e.removed || e.ko === 'bound' || !!e.puppetOf;
/** Out for now: also knocked out (he wakes in 30 s) or carried. */
export const outNow = (e) => outForGood(e) || !!e.ko || !!e.carriedBy;
const held = (w, tag) => !!w._e05?.held?.[tag];
/** A pickup still lying on the map (not taken, not swept off). */
const lying = (it) => !!it && !it.removed && it.count > 0 && it.alive !== false;

/** The script state's fields that are saved with the game (everything else is rebuilt from the world). */
export const E05_SAVED = ['held', 'g3Index', 'indexAt', 'burn', 'upAt', 'keeperGo', 'keeperUseT', 'relowered'];
const freshState = () => ({ held: { index: false, callbook: false }, g3Index: false, indexAt: null, burn: null, upAt: null, keeperGo: false, keeperUseT: null, relowered: 0 });

/**
 * The script's saved state (mission `setpieces: [{type: 'e05_state', id: 'e05_state'}]`): a set-piece, so World.serialize
 * keeps it with the game. It saves the live script state (`world._e05`); a load hands it back to the script — which, on a
 * quick load, installs after it (the director loads set-pieces before its first tick runs the mission script).
 */
export class E05State extends SetPiece {
  constructor(spec) { super(spec); this.st = null; }
  save() {
    const S = this.world?._e05 ?? this.st ?? freshState(), o = {};
    for (const k of E05_SAVED) if (S[k] !== undefined) o[k] = S[k];
    return JSON.parse(JSON.stringify(o));
  }
  load(s) {
    this.st = { ...freshState(), ...(s || {}) };
    if (this.world?._e05) { Object.assign(this.world._e05, JSON.parse(JSON.stringify(this.st))); reconcile(this.world); }
  }
}
registerSetpiece('e05_state', E05State);

/** Mark objective `id` done (once). */
function complete(w, id) {
  const o = (w.objectives || []).find((q) => q.id === id);
  if (!o || o.done) return;
  o.done = true;
  o.hidden = false;
  w.events.emit('objective:update', { objective: o });
}
/** Undo objective `id` (a state objective that no longer holds). */
function uncomplete(w, id) {
  const o = (w.objectives || []).find((q) => q.id === id);
  if (!o || !o.done) return;
  o.done = false;
  w.events.emit('objective:update', { objective: o });
}

/** The papers on the map: when a commando picks one up, its objective is done (o1 the index, o3 the call-sign book). */
function papersTick(w) {
  const S = w._e05;
  for (const [tag, obj] of [['index', 'o1'], ['callbook', 'o3']]) {
    if (S.held[tag]) continue;
    const it = S.papers[tag];
    if (!it) continue;
    if (lying(it)) continue;
    if (S.g3Index && tag === 'index') continue; // (the Kriminalrat took it off the desk / the floor: nobody of ours holds it)
    S.held[tag] = true;
    if (tag === 'index') S.indexAt = null;
    complete(w, obj);
    w.events.emit('message', { text: tag === 'index' ? 'The card index: two hundred names.' : 'The call-sign book.', kind: 'objective' });
  }
}

/** o4: the span up and its keeper unable to bring it down again; it comes down → o4 is open again. */
function bridgeTick(w, dt) {
  const S = w._e05, br = S.bridge, k1 = enemy(w, 'k1');
  if (!br) return;
  const up = br.raised && !(br.moving > 0);
  if (up && !S.upAt) S.upAt = w.time;
  if (!br.raised) S.upAt = null;
  if (up && outForGood(k1)) complete(w, 'o4');
  else if (!up && (w.objectives || []).find((o) => o.id === 'o4')?.done) { // (raised again, it counts again)
    uncomplete(w, 'o4');
    w.events.emit('message', { text: 'The drawbridge is coming down: the camp can walk into the fort again.', kind: 'warn' });
  }
  // the keeper re-lowers (design §9): awake, free, not a puppet — he walks back to the switch and brings it down (a
  // knock-out only holds him while he is out: outNow; cuffed, on strings or dead he never does: outForGood)
  if (!up || !S.upAt || outNow(k1) || k1.brain?.state === 'COMBAT') { S.keeperGo = false; S.keeperUseT = null; return; }
  if (w.time - S.upAt < S.relowerAfter && !S.keeperGo) return;
  const sw = S.switch;
  if (!sw) return;
  S.keeperGo = true;
  const d = Math.hypot(k1.x - sw.x, k1.z - sw.z);
  if (d > E05.switchReach + 0.4) {
    if (!k1.isMoving && !k1.path) k1.moveTo(sw.x - 1.0, sw.z + 0.8);
    return;
  }
  if (S.keeperUseT == null) { S.keeperUseT = 1.0; k1.stop?.(); k1.faceTowards?.(sw.x, sw.z); k1.playAction?.('use', 1.0); return; }
  if ((S.keeperUseT -= dt) > 0) return;
  S.keeperUseT = null;
  S.keeperGo = false;
  sw.interact(k1); // the span comes down (5 s)
  S.upAt = null;
  S.relowered = (S.relowered || 0) + 1;
  w.events.emit('message', { text: 'The bridge keeper has lowered the drawbridge again.', kind: 'warn' });
}

/** The index falls where its carrier fell (or is laid there again after a load): a loose pickup on the floor. */
function dropIndex(w, x, z) {
  const S = w._e05;
  S.g3Index = false;
  const it = createPickup('documents', x, z, 1, { id: 'index', label: 'Card index' });
  if (!w.scene) it.object3d = null;
  w.add(it);
  if (it.object3d && w.scene && !it.object3d.parent) w.scene.add(it.object3d);
  S.papers.index = it;
  S.indexAt = [+x.toFixed(2), +z.toFixed(2)];
  return it;
}

/** He picks the loose index up (off the desk or the floor): it leaves the map with him. */
function takeIndex(w, it) {
  const S = w._e05;
  it.count = 0;
  it.alive = false;
  w.removeLater?.(it);
  S.g3Index = true;
  S.indexAt = null;
}

const RING = 'e05_burn';
const clearRing = (w) => w._bcdTimers?.delete(RING);

/**
 * The burn script (design §9): RFORT → g3 to the index (the study, or where it fell), then to the stove; `burnTime` s
 * there → lost. A knock-out pauses it (he drops the index where he falls and wakes in half a minute); the index in a
 * commando's hands, or g3 cuffed, on strings or dead, ends it.
 */
function burnTick(w, dt, dir) {
  const S = w._e05, B = S.burn;
  if (!B || B.done) return;
  const g3 = enemy(w, 'g3');
  if (held(w, 'index') || outForGood(g3)) {
    if (S.g3Index && g3) dropIndex(w, g3.x, g3.z); // he falls with it: it lies where he fell
    B.done = true;
    clearRing(w);
    return;
  }
  if (outNow(g3)) { // knocked out (or carried): it falls with him; the script waits for him to come round
    if (S.g3Index) dropIndex(w, g3.x, g3.z);
    B.paused = true;
    clearRing(w);
    return;
  }
  B.paused = false;
  const it = S.papers.index;
  const loose = lying(it) ? it : null;
  if (!S.g3Index && !loose) { B.done = true; clearRing(w); return; } // (nothing left to burn)
  if (!B.started) {
    B.started = true;
    w.events.emit('message', { text: 'The Kriminalrat is making for the signal station with the index.', kind: 'warn' });
  }
  // the index on the desk: he takes it at his desk spot in the study; loose on the floor: where it lies
  const onDesk = loose && Math.hypot(loose.x - S.spots.index[0], loose.z - S.spots.index[1]) < 0.3;
  const goal = S.g3Index ? S.spots.stove : onDesk ? S.spots.study : [loose.x, loose.z];
  B.leg = S.g3Index ? 'stove' : onDesk ? 'study' : 'floor';
  const b = g3.brain;
  // he runs (ALARM_RUN: the brain's scripted runner, the same state the M16 engineers use); re-ordered if anything
  // (a noise, a body, a knock-out, a load) turned him aside or left him standing short of his goal
  const d = Math.hypot(g3.x - goal[0], g3.z - goal[1]);
  const reach = B.leg === 'stove' ? E05.stoveReach : B.leg === 'study' ? E05.stoveReach : E05.pickReach;
  if (b && b.state !== 'ALARM_RUN' && b.state !== 'COMBAT') {
    b._set('ALARM_RUN', 'run');
    b.goal = { x: goal[0], z: goal[1], speed: E05.runSpeed, event: 'E05_BURN', route: null, fired: true };
    b._go?.(goal[0], goal[1], E05.runSpeed);
    B.repath = 1.5;
  } else if (b?.state === 'ALARM_RUN') {
    B.repath = Math.max(-1, (B.repath ?? 0) - dt);
    const moved = b.goal?.x !== goal[0] || b.goal?.z !== goal[1];
    if (moved || (d > reach && !g3.isMoving && !g3.path && B.repath <= 0)) {
      b.goal = { x: goal[0], z: goal[1], speed: E05.runSpeed, event: 'E05_BURN', route: null, fired: true };
      b._go?.(goal[0], goal[1], E05.runSpeed);
      B.repath = 1.5;
    }
  }
  if (d > reach) return;
  if (!S.g3Index) { takeIndex(w, loose); return; } // (he sweeps it off the desk / snatches it off the floor)
  if (B.t == null) B.t = 0;
  B.t += dt;
  g3.stop?.();
  (w._bcdTimers || (w._bcdTimers = new Map())).set(RING, { x: g3.x, z: g3.z, k: Math.min(1, B.t / S.burnTime), kind: 'burn' });
  if (B.t >= S.burnTime) {
    B.done = true;
    clearRing(w);
    dir?.fail?.(w.mission?.e05Fail?.burned || 'THE CARD INDEX IS BURNING ON HAMMERØ.');
  }
}

/**
 * After a load: the runtime links (the papers, the bridge, its switch) found again and a loose index — a pickup made in
 * play, which the load did not bring back — laid where it lay.
 */
function reconcile(w) {
  const S = w._e05;
  if (!S) return;
  S.papers.index = byTag(w, 'index');
  S.papers.callbook = byTag(w, 'callbook');
  if (!S.held.index && !S.g3Index && S.indexAt && !S.papers.index) dropIndex(w, S.indexAt[0], S.indexAt[1]);
}

/** mission.script: installed once per world (a quick load re-runs it on the rebuilt world). */
export function e05Script(w, dir) {
  const m = w.mission || {};
  const spots = m.e05Spots || {};
  const piece = dir?.get?.('e05_state') ?? null;
  const saved = piece?.st ? JSON.parse(JSON.stringify(piece.st)) : freshState();
  const S = w._e05 = {
    ...saved,
    burnTime: m.burnTime ?? E05.burnTime,
    relowerAfter: m.relowerAfter ?? E05.relowerAfter,
    papers: { index: null, callbook: null },
    bridge: byTag(w, 'drawbridge'),
    switch: byTag(w, 'bridge_switch'),
    spots: { study: spots.study || [44.6, 59.4], stove: spots.stove || [82.4, 45.4], index: spots.index || [42.2, 58.4] },
  };
  reconcile(w);
  // Grethe joins (o2) when a commando reaches her chair (bcd-enemy joinsAt): the engine reports it as a freed unit
  w.listen('unit:freed', (p) => { if (p?.unit?.role === 'grethe') complete(w, 'o2'); });
  // Lark must live
  w.listen('unit:killed', (p) => { if (p?.unit?.role === 'grethe' && !w.scriptFail) dir?.fail?.(m.e05Fail?.lark || 'LARK IS DEAD.'); });
  // the fort's alarm starts the burn script
  w.listen('alarm:zone', (p) => { if (p?.event === 'RFORT' && !S.burn) S.burn = { started: false, done: false, leg: null, t: null }; });
  w.onBelTick((dt) => {
    papersTick(w);
    bridgeTick(w, dt);
    burnTick(w, dt, dir);
  });
  if (w.scene && typeof e05Script.visuals === 'function') e05Script.visuals(w);
}

/** The fort's art alone (browser): built by Game as the load ends (sliced), found built by the script. */
e05Script.visuals = (w) => runSliced(buildE05ArtG(w));
