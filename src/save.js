/**
 * Quick save / quick load. Snapshot = mission id + World.serialize() (entities, grid layers, RNG,
 * stats, objectives) + alarm. Loading rebuilds the mission from its definition, then restores each
 * entity by numeric id (ids are deterministic per mission load). Entities that did not exist at
 * load time (e.g. reinforcements) are respawned from their kind when possible; entities absent from
 * the snapshot are removed. Stored in localStorage (wrapped in try/catch; memory fallback).
 * @module save
 */

import { Entity } from './entities/entity.js';
import { Commando } from './entities/commando.js';
import { Enemy } from './entities/enemy.js';
import { Bomb, Trap, Decoy } from './abilities/charges.js';
import { bcdPostRestore } from './ai/bcd-enemy.js';
import { createPickup } from './entities/interactables.js';
import { restoreHouseRules } from './core/house-rules.js';

export const SAVE_KEY = 'shadowsix.quicksave.v1';
const SAVE_VERSION = 1;
let memorySlot = null;

/**
 * Serialize the running game to a plain object.
 * @param {import('./game.js').Game} game
 */
export function snapshot(game) {
  const w = game.world;
  if (!w) return null;
  return {
    v: SAVE_VERSION,
    mission: game.missionDef?.id ?? game.missionIndex,
    campaign: w.campaign ?? 'BEL',
    savedAt: Date.now(),
    // the id counter too: a load resumes numbering exactly where the saved run was (unique + deterministic)
    // + AI director state (footprints with their ids: trackers re-link the print they follow)
    world: { ...w.serialize(), nextId: Entity.nextId, ai: w.ai?.serialize?.() ?? null },
    alarm: w.alarm?.serialize?.() ?? null,
    // electric-fence power table (§7.6 st_fence "powered until fence_switch is used"): not part of any entity
    fencePower: w.fencePower ? [...w.fencePower] : null,
    // bodies-design §D.1: the house rules the run was made with (+ physics tier) and the physics layer (§A.10)
    house: w.house ? { ...w.house } : null,
    physics: w.physics?.serialize?.() ?? null,
    marks: w.marks?.serialize?.() ?? null, // explosion craters / scorch (visual, persistent)
    blood: w.blood?.serialize?.() ?? null, // bodies-design §B.7: pools (re-simulated from seeds), decals, smears, stains
    camera: game.cameraController.getState?.() ?? null,
    views: game.cameraRig?.getState?.() ?? null,
    flow: game.flow?.serialize?.() ?? null,
    ...(game.difficulty ? { difficulty: game.difficulty } : null), // BCD Skill: loaded before the mission (BEL: absent)
    end: game.pendingEnd ? { ...game.pendingEnd } : null,
    endFlags: game._endFlags ? { ...game._endFlags } : null,
    // the player's own pause (P) only: menus, notes and dialogs pause too, but a load must not keep those
    paused: game.state === 'paused' && !!game.playerPaused,
  };
}

/**
 * Restore a snapshot into the game (rebuilds the mission first). A load during a mission resumes
 * play, unless the player had paused (P) when saving — then it comes back paused (§8.4, §6.8).
 * Loading outside a mission (title "Continue", debrief) goes through the briefing as before.
 * @returns {Promise<boolean>}
 */
export async function restore(game, snap) {
  if (!snap || snap.v !== SAVE_VERSION) return false;
  const prevState = game.state;
  if (snap.difficulty) game.difficulty = snap.difficulty; // BCD Easy/Hard variant must be built before the entities restore
  const w = await game.loadMission(snap.mission);
  restoreWorld(w, snap.world);
  if (snap.alarm) w.alarm?.deserialize?.(snap.alarm);
  restoreFencePower(w, snap.fencePower);
  restorePhysicsLayer(w, snap);
  if (snap.views && game.cameraRig?.setState) game.cameraRig.setState(snap.views, (id) => w.byId(id));
  else {
    const cam = snap.camera;
    if (cam?.zoom) game.cameraController.setZoom(cam.zoom);
    if (cam && Number.isFinite(cam.x)) game.cameraController.centerOn(cam.x, cam.z);
  }
  if (snap.flow) game.flow?.deserialize?.(snap.flow);
  game.pendingEnd = snap.end ? { ...snap.end } : null;
  game._endFlags = snap.endFlags ? { ...snap.endFlags } : {};
  const sel = w.commandos.filter((c) => c.selected && c.alive);
  game.input.select(sel.length ? sel : w.commandos.filter((c) => c.alive).slice(0, 1));
  const inMission = prevState === 'playing' || prevState === 'paused';
  game.state = !inMission ? 'briefing' : snap.paused ? 'paused' : 'playing';
  game.playerPaused = game.state === 'paused';
  game.events.emit('game:state', { from: 'briefing', to: game.state });
  return true;
}

/**
 * Restore the simulation part of a snapshot (time, rng, stats, objectives, grid, entities) into a
 * freshly built mission world. Exported for the unit tests (no Game needed).
 * @param {import('./world/world.js').World} w
 * @param {object} S snapshot.world
 */
export function restoreWorld(w, S) {
  w.time = S.time;
  w.tick = S.tick;
  w.clock = S.clock ?? S.time;
  w.belTick = S.belTick ?? 0;
  w._belAcc = S.belAcc ?? 0;
  if (S.rng !== undefined) w.rng.snapshot = S.rng;
  Object.assign(w.stats, S.stats);
  for (const o of S.objectives || []) {
    const cur = w.objectives.find((x) => x.id === o.id);
    if (cur) Object.assign(cur, { done: o.done, failed: o.failed });
  }
  if (S.grid) w.grid.deserialize(S.grid);
  if (S.ai) w.ai?.deserialize?.(S.ai); // before the entities: brains resolve footprint ids
  const saved = new Map(S.entities.map((e) => [e.id, e]));
  for (const e of [...w.entities]) {
    if (e.kind === 'prop') continue;
    if (!saved.has(e.id)) w.remove(e);
  }
  for (const d of S.entities) {
    let e = w.byId(d.id);
    if (!e) e = respawn(w, d);
    if (!e) continue;
    try {
      e.deserialize(d);
    } catch (err) {
      console.warn('[save] could not restore entity', d.kind, d.id, err);
    }
  }
  if (w.rules?.id === 'BCD') bcdPostRestore(w); // BCD: links to entities restored after their owner
  // running actions that survive a load (the Spy's distraction), now that every target is restored
  for (const c of w.commandos || []) if (c._savedAction || c._savedTransition) c.resumeSavedAction?.();
  // ids of entities spawned during play (placed traps, deployed rafts …) are kept from the save, so the
  // id counter must move past them — otherwise the next spawn reuses a live id (replay m02: raft and trap
  // both id 36, the raft vanished on the following load).
  let maxId = 0;
  for (const e of w.entities) if (Number.isFinite(e.id) && e.id > maxId) maxId = e.id;
  for (const d of S.entities) if (Number.isFinite(d.id) && d.id > maxId) maxId = d.id;
  Entity.nextId = Math.max(Entity.nextId, maxId + 1, S.nextId ?? 0);
  return w;
}

/**
 * House rules + physics after a load (bodies-design §D.1, §A.10): the saved house layer wins (old saves keep the
 * current preset), its physics tier sets the caps, then the physics layer restores (a snapshot while bodies moved).
 */
export function restorePhysicsLayer(w, snap) {
  w.house = restoreHouseRules(snap.house, w.house);
  for (const c of w.commandos || []) c.refreshAbilities?.(); // house-rule abilities follow the restored layer (§C)
  try {
    w.physics?.setTier?.(w.house.physicsTier);
    if (snap.physics) w.physics?.restore?.(snap.physics);
    if (snap.marks) w.marks?.restore?.(snap.marks);
  } catch (err) { console.warn('[save] physics restore failed; bodies keep their saved poses', err); }
  try { w.blood?.restore?.(snap.blood || null); } catch (err) { console.warn('[save] blood restore failed', err); } // old saves: no blood
}

/**
 * Electric-fence power after a load: loadMission rebuilds every fence powered, while the switches come
 * back with their saved `on`. Use the saved table; older saves without it rebuild the power from the
 * restored switches (same mapping as Interactable._applyTargets).
 */
export function restoreFencePower(w, saved) {
  if (!w.fencePower) return;
  if (Array.isArray(saved)) {
    for (const [id, powered] of saved) if (w.fencePower.has(id)) w.fencePower.set(id, !!powered);
    return;
  }
  for (const sw of w.interactables || w.entities) {
    if (sw.interactKind !== 'switch') continue;
    for (const id of sw.targets || []) if (w.fencePower.has(id)) w.fencePower.set(id, sw.params?.powers ? sw.on : !sw.on);
  }
}

/** Recreate a unit that was spawned after mission load. */
function respawn(world, d) {
  let e = null;
  if (d.kind === 'commando') e = new Commando({ role: d.role, x: d.x, z: d.z, heading: d.heading, id: d.tag });
  else if (d.kind === 'enemy') e = new Enemy({ soldierType: d.soldierType, x: d.x, z: d.z, heading: d.heading, id: d.tag });
  else if (d.kind === 'vehicle' && d.vehicleType && world.vehicleFactory) {
    // spawned during play (deployed raft, scripted evac truck): same factory as the mission's vehicles
    e = world.vehicleFactory({ vehicleType: d.vehicleType, x: d.x, z: d.z, heading: d.heading, id: d.tag ?? undefined });
  } else if (d.kind === 'interactable') {
    // ABILITIES charges placed during play (§3.4): time/remote bombs, bear traps, decoys
    const owner = world.byId(d.planter) || null;
    if (d.interactKind === 'bomb') e = new Bomb({ x: d.x, z: d.z, y: d.y ?? 0, bombKind: d.bombKind, owner, fuse: d.fuse ?? undefined, fuse0: d.fuse0 ?? undefined, seq: d.seq, insideOf: d.insideOf ?? null });
    else if (d.interactKind === 'trap') e = new Trap({ x: d.x, z: d.z, owner, heading: d.trapHeading ?? 0 });
    else if (d.interactKind === 'decoy') e = new Decoy({ x: d.x, z: d.z, owner });
    else if (d.interactKind === 'pickup' && d.pack) { // BCD §1.5: a cigarette pack thrown during play
      e = createPickup(d.itemId || 'cigarettes', d.x, d.z, d.count ?? 1, { label: 'Cigarettes', pack: true });
      if (!world.scene) e.object3d = null;
    }
    if (e && d.interactKind === 'bomb') e._fresh = false;
    if (e && d.interactKind === 'trap') { e.sprung = !!d.sprung; if (e.sprung) { e.jaw = 1; e.object3d?.userData.setSprung?.(1); } }
    if (e && d.interactKind === 'decoy') {
      e.on = !!d.on;
      e.onTick = d.onTick ?? 0;
      e.pulses = d.pulses ?? 0;
      if (owner) owner.decoy = e; // decoyOf() finds it through the planter
    }
  }
  if (!e) return null;
  // drop the provisional id only if it is ours: it can equal the id of an entity respawned just before
  if (world._byId?.get(e.id) === e) world._byId.delete(e.id);
  e.id = d.id;
  world.add(e);
  return e;
}

/** Save to localStorage (memory fallback). @returns {boolean} */
export function quickSave(game) {
  const snap = snapshot(game);
  if (!snap) return false;
  memorySlot = snap;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
  } catch {
    /* storage unavailable — memory slot still works this session */
  }
  return true;
}

/** Load the quicksave. @returns {Promise<boolean>} */
export async function quickLoad(game) {
  let snap = null;
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (s) snap = JSON.parse(s);
  } catch {
    snap = null;
  }
  snap = snap || memorySlot;
  if (!snap) return false;
  try {
    return await restore(game, snap);
  } catch (err) {
    console.warn('[save] quickload failed', err);
    return false;
  }
}

/** True when a quicksave exists. */
export function hasQuickSave() {
  try {
    if (localStorage.getItem(SAVE_KEY)) return true;
  } catch {
    /* ignore */
  }
  return !!memorySlot;
}

// ---------------------------------------------------------------- named slots, export/import (§8.4)

/** Number of named save slots per profile (Esc menu). */
export const SLOT_COUNT = 10;
export const SLOT_KEY = 'shadowsix.slot.v1.';
export const AUTOSAVE_KEY = 'shadowsix.autosave.v1';
const memorySlots = new Map();

function writeKey(key, snap) {
  memorySlots.set(key, snap);
  try {
    localStorage.setItem(key, JSON.stringify(snap));
    return true;
  } catch {
    return true; // memory copy still works this session
  }
}

function readKey(key) {
  try {
    const s = localStorage.getItem(key);
    if (s) return JSON.parse(s);
  } catch { /* fall through to memory */ }
  return memorySlots.get(key) || null;
}

/**
 * Save into named slot i (0..9). @param {string} [name] label shown in the menu
 * @returns {boolean}
 */
export function saveSlot(game, i, name) {
  if (!(i >= 0 && i < SLOT_COUNT)) return false;
  const snap = snapshot(game);
  if (!snap) return false;
  snap.name = name || `${game.missionDef?.name || snap.mission} — ${Math.floor((snap.world.clock || 0) / 60)}:${String(Math.floor((snap.world.clock || 0) % 60)).padStart(2, '0')}`;
  return writeKey(SLOT_KEY + i, snap);
}

/** Load named slot i. @returns {Promise<boolean>} */
export async function loadSlot(game, i) {
  const snap = readKey(SLOT_KEY + i);
  if (!snap) return false;
  try {
    return await restore(game, snap);
  } catch (err) {
    console.warn('[save] slot load failed', err);
    return false;
  }
}

/** Slot directory for the menu: [{slot, name, mission, savedAt} | null] × 10. */
export function listSlots() {
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = readKey(SLOT_KEY + i);
    out.push(s ? { slot: i, name: s.name || String(s.mission), mission: s.mission, savedAt: s.savedAt } : null);
  }
  return out;
}

/** Delete slot i. */
export function deleteSlot(i) {
  memorySlots.delete(SLOT_KEY + i);
  try { localStorage.removeItem(SLOT_KEY + i); } catch { /* ignore */ }
}

/** Export fallback (§8.4): the current game as a JSON string. */
export function exportSave(game) {
  const snap = snapshot(game);
  return snap ? JSON.stringify(snap) : null;
}

/** Import fallback: restore from an exported JSON string. @returns {Promise<boolean>} */
export async function importSave(game, json) {
  let snap = null;
  try {
    snap = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return false;
  }
  try {
    return await restore(game, snap);
  } catch (err) {
    console.warn('[save] import failed', err);
    return false;
  }
}

/** Auto-save on `beforeunload` (F5 may still reload in some browsers, §5.1). */
export function autoSave(game) {
  const snap = snapshot(game);
  return snap ? writeKey(AUTOSAVE_KEY, snap) : false;
}

export async function loadAutoSave(game) {
  const snap = readKey(AUTOSAVE_KEY);
  return snap ? restore(game, snap).catch(() => false) : false;
}
