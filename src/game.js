/**
 * Game — state machine (title/briefing/playing/paused/won/lost), fixed-step simulation loop with an
 * accumulator + max substeps, mission loading and the per-frame render. See ARCHITECTURE.md § Game.
 *
 * Tick order in step(dt): input commands → commandos → enemies → vehicles → projectiles →
 * interactables → alarm → objectives → fx → world.time += dt.
 * In test mode (`?test=1`, or opts.manualTick) the sim only advances through step()/advance().
 * @module game
 */

import { normalizeMission } from './missions/schema.js';
import { placeSpawn } from './world/placement.js';

/** Spawn def after the placement rules, standing on the measured surface (tower decks: grid elev, not the authored y). */
const placed = (world, spawn) => {
  const s = placeSpawn(spawn, world.placement, spawnFree(world));
  const e = world.grid?.elevAt?.(s.x, s.z) ?? 0;
  return (s.y ?? 0) > 0 && e > 0 && Math.abs(e - s.y) < 0.5 && e !== s.y ? { ...s, y: e } : s;
};

/** Spawn-placement test (world/placement.js placeSpawn): walkable at the spawn's own elevation. */
const spawnFree = (world) => (x, z, s) => {
  const g = world.grid;
  return !!g && g.walkableAt(x, z) && Math.abs((g.elevAt?.(x, z) ?? 0) - (s.y ?? 0)) < 0.3;
};
import { Flow } from './core/flow.js';
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { EventBus } from './core/events.js';
import { checkObjectives, createObjectives, extractionStatus, skipExtractionDrive, updateExtractionVehicle } from './core/objectives.js';
import { Renderer } from './engine/renderer.js';
import { CameraRig } from './engine/camera.js';
import { Input } from './engine/input.js';
import { assets } from './engine/assets.js';
import { World } from './world/world.js';
import { Commando } from './entities/commando.js';
import { admitAtSpawn } from './entities/interactables.js';
import { Enemy } from './entities/enemy.js';
import { Entity } from './entities/entity.js';
import { Alarm } from './ai/alarm.js';
import { Selection } from './render/selection.js';
import { FIRST_AID_DOSES, firstAidCarrier, defaultInventory, spawnInventory } from './items.js';
import * as MapBuilder from './world/map-builder.js';
import { prepareMissionArt } from './art/building-props.js';
import { createPhysics } from './physics/world-physics.js';
import { NULL_PHYSICS } from './physics/null-physics.js';
import { PhysicsVisuals } from './render/physics-visuals.js';
import { BlastMarks } from './render/blast-marks.js';
import { BloodSystem } from './render/blood/index.js';
import { resolveHouseRules, tierFromPreset } from './core/house-rules.js';
import { nobodyLeftToHelp } from './entities/downed.js';
import { prepareCharacters, awaitUnitModels, warmUnitModels, warmUnitModelsG, queueIdleWarm, queueAheadModels, charactersFrame, transportFrame, releaseCharacters } from './art/unit-model.js';
import { idleWarm } from './engine/idle-warm.js';
import { knifeKillFrame } from './art/knife-kill.js';
import { barrelCarryFrame } from './art/barrel-carry.js';
import { digWarmObjects } from './art/shovel-dig.js';

/** Let the page paint once (a frame, then a task: the DOM drawn), at most ~50 ms (a hidden tab draws no frames). */
function paintOnce() {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, 50);
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(t); res(); }, 0));
  });
}
import { spyActionsFrame, spyWarmObjects } from './art/spy-actions.js';
import { raftActionsFrame, raftPassWanted, raftWarmObjects } from './art/raft-actions.js';
import { switchStationsFrame } from './art/switch-station.js';
import { prepareVehicleArt, warmVehicleArt, tickVehicles, releaseVehicles, createVehicleLamps, vehicleDecalWarm } from './art/vehicle-model.js';
import { staticVehicleAssets, dressStaticVehicles } from './art/static-vehicles.js';
import { flyoverAssets, createFlyovers } from './render/flyovers.js';
import { createLoadProgress, loadBudget } from './engine/load-progress.js';
import { DownloadMeter } from './engine/download-meter.js';
import { openMissionPack } from './engine/mission-pack.js';
import { earlyFetch, dropEarlyFetches, earlyFetchSlots, MAX_ACTIVE as MAX_EARLY } from './engine/early-fetch.js';
import { terrainTexRes } from './art/terrain.js';
import { terrainLayerUrls } from './art/terrain/terrain.js';
import { loadRapier } from './physics/rapier-loader.js';
import * as Missions from './missions/index.js';
import * as VehicleMod from './entities/vehicle.js';
import * as FxMod from './render/fx.js';
import * as ConeMod from './render/vision-cone.js';
import * as HudMod from './ui/hud.js';
import * as AudioMod from './audio/audio.js';
import { quickSave, quickLoad, saveSlot, loadSlot, autoSave } from './save.js';
import { probe as probeCone } from './ai/perception.js';
import { mgMountFrame } from './render/mg-mount.js';
import { ScopeMagnifier } from './render/scope-magnifier.js';
import { chunkLargeMeshes, chunkLargeMeshesG, releaseAllChunks } from './engine/chunking.js';
import { DynamicResolution } from './engine/dynamic-res.js';
import { sessionCache } from './engine/asset-cache.js';
import { deferMaterialDisposal, flushMaterialDisposal, holdingMaterials } from './engine/program-keeper.js';
import { TextureWarmer, releaseUnloadTextures, texturesLoading, texturesLoaded } from './engine/texture-memory.js';
import { compileAhead, framesInParts } from './engine/parallel-compile.js';
import { runSliced, runSync, due, nextTask } from './engine/slice.js';
import { fitLadders, fitLaddersG } from './art/ladder-frame.js';

/** Resolve the first function/class export among candidate names (stub modules may vary). */
function pick(mod, ...names) {
  for (const n of names) if (typeof mod?.[n] === 'function') return mod[n];
  return null;
}

/** Ordered mission list from missions/index.js. */
export function missionList() {
  const m = Missions.MISSIONS || Missions.missions || Missions.default;
  return Array.isArray(m) ? m : [];
}

export class Game {
  /**
   * @param {HTMLElement} container element that receives the canvas (#view)
   * @param {{manualTick?: boolean, preset?: string, hudRoot?: HTMLElement, preserveDrawingBuffer?: boolean}} [opts]
   */
  constructor(container, opts = {}) {
    this.container = container;
    /** @type {'title'|'briefing'|'playing'|'paused'|'won'|'lost'} */
    this.state = 'title';
    /** True while paused by the player's own P (not a menu/notes/dialog pause); saved with the game (§8.4). */
    this.playerPaused = false;
    /** Single event bus for the whole game; every World uses it as world.events. */
    this.events = new EventBus();
    /** @type {World|null} */
    this.world = null;
    this.missionDef = null;
    this.missionIndex = -1;
    /** ?debug only (debug/debug-mode.js): {flags: {invulnerable, noDetect}, transformDef(def)}; null otherwise. */
    this.debug = null;
    this.manualTick = !!opts.manualTick;
    this.accumulator = 0;
    this.timeScale = CONFIG.sim.timeScale;
    this.frameTime = 0;
    this._queue = [];
    this.cones = null;
    this._raf = 0;
    this._last = 0;
    this.fps = 0;

    /** Player options (§2.3, §5, §6.8). activePause: orders allowed while paused (⚑ option, off = faithful). */
    this.options = { activePause: false, edgeScroll: true, edgeScrollOverHud: true, warnings: true, cheats: false, ...(opts.options || {}) };
    this.renderer = new Renderer(container, { preset: opts.preset, preserveDrawingBuffer: opts.preserveDrawingBuffer });
    /** Multi-view camera rig (§2.3); `cameraController` is its active view. */
    this.cameraRig = new CameraRig({ domElement: this.renderer.domElement, uiScale: () => this.hud?.uiScale || 1, hudTop: () => this.hud?.topBarHeight || 0 });
    this.cameraRig.edgeScroll = this.options.edgeScroll;
    this.cameraRig.edgeOverHud = this.options.edgeScrollOverHud;
    // Keep the ortho frustums in sync with the canvas (else the view is stretched horizontally).
    this.renderer.onResize = (w, h) => this.cameraRig.resize(w, h);
    this.renderer.setCamera(this.cameraRig.mainCamera);
    /** Dynamic resolution controller (engine/dynamic-res.js) or null; see setDynamicResolution. */
    this.dynres = null;
    this.mobileDevice = !!opts.mobile;
    this.setDynamicResolution(CONFIG.render.dynamicResolution?.enabled ?? 'auto');
    // explosion camera shake (VFX), off with the reduced-motion option (FX.shakeOffset returns null)
    this.cameraRig.shake = () => (this.world?.fx?.shakeOffset ? this.world.fx.shakeOffset() : null);
    this.input = new Input(this, this.renderer.domElement);
    this.cameraRig.input = this.input;
    this.cameraRig.onChange = (rig) => this.events.emit('camera:views', { count: rig.count, layout: rig.layout, active: rig.activeIndex });
    /** §8.1 pending end state: {won, reason, t} (grace countdown) | null. */
    this.pendingEnd = null;
    this.selection = new Selection(this.renderer.decalScene);
    this.selection.xrayHidden = (o) => this.renderer.passes?.xray?.isHidden(o) ?? true;
    assets.init(this.renderer.renderer, this.events);

    const createAudio = pick(AudioMod, 'createAudio', 'default');
    this.audio = safe(() => createAudio?.(this.events), 'audio') || null;
    const createHud = pick(HudMod, 'createHud', 'default');
    const HudClass = !createHud && pick(HudMod, 'HUD', 'Hud');
    const hudRoot = opts.hudRoot || document.getElementById('hud') || container;
    this.hud = safe(() => (createHud ? createHud(this, hudRoot) : HudClass ? new HudClass(this, hudRoot) : null), 'hud');
    /** Campaign flow / scoring / passwords (CORE2, src/core/flow.js). */
    this.flow = new Flow(this, Missions.CAMPAIGNS?.BEL || [], 'BEL', { persist: !this.manualTick });

    this._onVisibility = () => {
      if (document.hidden && this.state === 'playing' && !this.manualTick) this.pause(true);
    };
    document.addEventListener('visibilitychange', this._onVisibility);
    // §5.1: F5 is suppressed in-game; if the browser reloads anyway, an auto-save protects the player.
    this._onUnload = () => {
      if (this.world && (this.state === 'playing' || this.state === 'paused') && !this.manualTick) autoSave(this);
    };
    window.addEventListener('beforeunload', this._onUnload);
  }

  /** The active camera view (CameraController) of the multi-view rig. */
  get cameraController() {
    return this.cameraRig.active;
  }

  // ------------------------------------------------------------ state machine

  _setState(s) {
    if (this.state === s) return;
    const from = this.state;
    this.state = s;
    if (s !== 'paused') this.playerPaused = false;
    this.events.emit('game:state', { from, to: s });
  }

  /** Queue a closure (orders from input/UI) to run at the start of the next sim tick. */
  enqueue(fn) {
    this._queue.push(fn);
    // BEL lets you give orders while paused: apply immediately when the sim is frozen.
    if (this.state !== 'playing') this._flushQueue();
  }

  _flushQueue() {
    const q = this._queue;
    this._queue = [];
    for (const fn of q) {
      try {
        fn();
      } catch (err) {
        console.error('[game] queued command failed', err);
      }
    }
  }

  // ------------------------------------------------------------ missions

  /**
   * Build a World from a mission definition (id string, index, or def object). → state 'briefing'.
   * @param {string|number|object} idOrIndex
   */
  async loadMission(idOrIndex = 0) {
    // `building`: the frame loop does not draw while a world is being built (cleared by the latest load only)
    const token = (this._buildToken = {});
    this.building = true;
    try {
      return await this._loadMission(idOrIndex);
    } finally {
      if (this._buildToken === token) { this.building = false; earlyFetchSlots(MAX_EARLY); } // (a load cut short keeps no limit)
    }
  }

  async _loadMission(idOrIndex) {
    const list = missionList();
    let def = idOrIndex;
    if (typeof idOrIndex === 'number') def = list[idOrIndex];
    else if (typeof idOrIndex === 'string') def = list.find((m) => m.id === idOrIndex);
    if (!def || typeof def !== 'object') throw new Error(`unknown mission "${idOrIndex}"`);
    this.events.emit('mission:loading', { id: def.id }); // UI releases the menu diorama (menus-art-direction §1.10)
    this.unloadMission();
    this.missionIndex = list.indexOf(def);
    // a reload of a mission this page has built (a restart, a walkthrough jump back): its programs were kept
    // (engine/program-keeper.js), so the warm-ups draw for real at once (a compile probe would only cost its traversal)
    this._warmReload = sessionCache.missions.includes(def.id);
    sessionCache.beginMission(def.id); // asset cache: tag what this load uses; the last mission's data stays until settle()
    if (this.debug?.transformDef) def = this.debug.transformDef(def); // ?debug inspection options (debug/debug-options.js)
    def = normalizeMission(def, { difficulty: this.difficulty ?? null }); // design-spec §7.3 defaults (throws on invalid data); BCD Easy/Hard variant
    this.missionDef = def;
    Entity.nextId = 1; // deterministic ids (save/load, tests)

    const r = this.renderer;
    // real progress for the loading screen: stages + bytes received vs the mission's budget (engine/load-progress.js)
    const dlMeter = new DownloadMeter(); // the loading screen's live download figures (engine/download-meter.js)
    const prog = createLoadProgress({ events: this.events, id: def.id, preset: r.presetName, budget: await loadBudget(), dlMeter });
    this.loadProgress = prog;
    // mission asset pack + audio sprites (engine/mission-pack.js, audio/sprite-source.js): when the packs were
    // built (tools/packs/build-packs.mjs) the mission's ~1,000 files arrive as a few archive parts + sprite fetches
    // and every loader is served from memory; without packs this resolves null and the load is exactly as before
    const pack = await openMissionPack(def.id, r.presetName, (f) => prog.stage('lighting', f), dlMeter);
    this.missionPack = pack;
    // early downloads (engine/early-fetch.js): files a later stage will ask for start downloading now, behind what the
    // stages ahead of it wait for, so the link works through the CPU-bound map build (a pack already holds them all)
    dropEarlyFetches(30000);
    earlyFetchSlots(0); // (the HDRI below has the link to itself; one slot while the art libraries load, all from the map build)
    if (!pack) {
      safe(() => earlyFetch(terrainLayerUrls(def.theater || 'temperate', terrainTexRes(r.presetName, def.theater)), { rank: 0 }), 'early fetch: terrain');
      safe(() => this.hud?.prefetchMission?.(def), 'early fetch: portraits');
      safe(() => this.audio?.prefetchMission?.(def)?.catch?.(() => 0), 'early fetch: sounds');
    }
    this.audio?.setMissionSprites?.(pack ? { mission: def.id, preset: r.presetName } : null, dlMeter);
    prog.stage('lighting');
    // per-mission lighting from the mission file (sun, kelvin, HDRI, fog, LUT — design-spec §2.4)
    if (r.applyMissionLighting) await safeAsync(() => r.applyMissionLighting(def, { assets }), 'lighting');
    else r.setTheater?.(def.theater || 'temperate', def.lighting || null);
    const world = new World({ game: this, scene: r.scene, events: this.events, size: def.size, seed: def.seed ?? CONFIG.sim.seed, mission: def });
    this.world = world;
    world.alarm = new Alarm(world);
    world.debug = this.debug?.flags || null; // ?debug: {invulnerable, noDetect} read by Unit.takeDamage / perception
    const FX = pick(FxMod, 'FX', 'Fx', 'default');
    world.fx = safe(() => (FX ? new FX(world, r.scene) : null), 'fx');

    // x-ray: live commandos only (enemies are never x-rayed)
    r.xrayTargets = () => (this.world === world ? world.commandos.filter((c) => c.alive && c.object3d && !c.inGround && !c.scripted?.noXray).map((c) => c.object3d) : []);
    r.setMapBounds?.(def.size[0], def.size[1]);
    this.cameraRig.reset();
    this.cameraRig.setBounds(def.size[0], def.size[1]);
    this.cameraRig.setApron(null); // set again once the map's scenery apron is built (below)
    this.pendingEnd = null;
    this._endFlags = {};

    // realistic buildings & bridges (art/building-props.js): manifest + this mission's GLBs before the map builds
    // the three art libraries load side by side (perf/download-speed: their downloads and parses overlap instead of
    // waiting on each other; each fills only its own library, and the map build below starts once all three are in,
    // as before). The bar still walks buildings → characters → vehicles, each stage closing when its library is in.
    prog.stage('buildings');
    earlyFetchSlots(1);
    // (+ the raft a Marine carries in his kit: inflated on screen, art/raft-actions.js, it must not wait on its GLB)
    const kitRaft = (def.commandos || []).some((c) => c.role === 'diver' && (spawnInventory('diver', c.inventory, def.campaign || 'BEL').inflatableBoat ?? 0) > 0);
    let vehFrac = 0, vehStage = false;
    const artJobs = [
      safeAsync(() => prepareMissionArt(def, { assets, quality: r.presetName === 'ultra' ? 'ultra' : r.presetName === 'low' ? 'low' : 'default', preset: r.presetName }), 'buildings'),
      // realistic characters (art/unit-model.js): library + squad-aware enemy looks; placeholder capsules on failure
      safeAsync(() => prepareCharacters(def), 'characters'),
      // realistic vehicle library (art/vehicle-model.js): every vehicle type of the mission in the theater paint + its wreck
      safeAsync(() => prepareVehicleArt(def, { assets, quality: r.presetName, extra: [...staticVehicleAssets(def), ...(kitRaft ? ['raft'] : [])], ambient: flyoverAssets(def), canon: VehicleMod.canonicalType,
        onProgress: (d, n) => { vehFrac = d / Math.max(1, n); if (vehStage) prog.stage('vehicles', vehFrac); } }), 'vehicles'),
    ];
    await artJobs[0];
    prog.stage('characters');
    await artJobs[1];
    vehStage = true;
    prog.stage('vehicles', vehFrac);
    await artJobs[2];
    if (this.world !== world) return prog.cancel(), world; // unloaded / replaced while loading
    prog.stage('terrain');
    earlyFetchSlots(MAX_EARLY); // the map build is CPU work: the background downloads have the link
    // the physics module (Rapier, ~1.7 MB): fetched and compiled while the map builds; createPhysics awaits the same load
    loadRapier();
    await paintOnce(); // (the map build and the warm-up frame are long: a loading bar shows where the load is first)
    const build = pick(MapBuilder, 'buildMap', 'buildMission', 'build', 'default');
    // the map builds in slices (engine/slice.js): the same build, the loading screen drawing between them. What it starts
    // loading takes effect once the gate opens — after the steps below, where a synchronous build had returned
    let openGate = null;
    const mapOpts = { theater: def.theater, renderer: r, scene: r.scene, assets, gate: new Promise((ok) => { openGate = ok; }) };
    let handle, dressed = [];
    try {
      handle = MapBuilder.buildMapGen ? await safeAsync(() => runSliced(MapBuilder.buildMapGen(world, def, mapOpts)), 'map-builder')
        : build ? safe(() => build(world, def, mapOpts), 'map-builder') : null;
      if (this.world !== world) { safe(() => handle?.dispose?.(), 'map dispose'); return prog.cancel(), world; } // replaced meanwhile
      this.mapHandle = handle;
      dressed = safe(() => dressStaticVehicles(world, def), 'static vehicles') || []; // parked wagons / aircraft / flak: library models
      safe(() => createFlyovers(world, def, { renderer: r, seed: def.seed ?? CONFIG.sim.seed }), 'flyovers'); // ambient aircraft overhead
      safe(() => createVehicleLamps(r.scene, { preset: r.presetName }), 'vehicle lamps'); // night: real headlamp lights (fixed pool)
    } finally { openGate(); }
    // ground textures, grass and trees build asynchronously (decode + splat + tree workers): wait, bounded
    const ready = this.mapHandle?.ready;
    if (ready) await safeAsync(() => Promise.race([ready, new Promise((ok) => setTimeout(ok, 20000))]), 'terrain');
    // …but what the gameplay world measures on the art (the trees' branches: gun arcs) is in before play, however slow
    // the rest (a weak machine past the 20 s above): never a stamp landing mid-game (bounded: a stalled build plays on)
    const gp = this.mapHandle?.gameplayReady;
    if (gp) await safeAsync(() => Promise.race([gp, new Promise((ok) => setTimeout(ok, 60000))]), 'gameplay stamps');
    // the body solids men path and stand clear of (world/body-clearance.js) are what is drawn: a prop dressed as a
    // library vehicle is measured on its model, so they are measured again here, once every static vehicle's model is
    // in (awaited: the map's own re-stamp ran when the library buildings were in, before or after a vehicle's model —
    // M14's parked lorry was a 2.3 m or a 6.2 m solid depending on which came first)
    if (dressed.length && this.mapHandle?.restampBodySolidsG) {
      const t0 = performance.now(), all = Promise.allSettled(dressed.map((d) => d.ready));
      // (a model that never arrives — a stalled request — is waited for 60 s; its placeholder then stays drawn and solid)
      const done = await Promise.race([all.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 60000))]);
      if (!done) console.warn(`[game] static vehicle models still loading after ${Math.round(performance.now() - t0)} ms: body solids measured on what is drawn`);
      if (this.world !== world) return prog.cancel(), world;
      const owners = new Set(dressed.map((d) => world.structures?.get(d.id)?.owner).filter((o) => o != null));
      await safeAsync(() => runSliced(this.mapHandle.restampBodySolidsG(owners)), 'body solids');
      if (this.world !== world) return prog.cancel(), world;
    }
    await nextTask(); // (the steps below start on their own task, not on the one that finished the terrain)
    if (this.world !== world) return prog.cancel(), world; // unloaded / replaced while waiting
    // every climbed ladder measured on the built map, the missing ones built (art/ladder-frame.js)
    this.ladders = await safeAsync(() => runSliced(fitLaddersG(world, r.scene)), 'ladders'); // (a ladder at a time)
    if (this.world !== world) return prog.cancel(), world;
    // ruins waiting for their blast (art/building-props.js prepareDestroy: bunkers, dams): built now, off the scene —
    // their models load while the rest does; the warm-up frame draws them; the blast only moves them into place
    const ruins = [];
    // (+ the ruins of the buildings a destroy objective names: their blast is the shot too — M11's four rigs)
    const targets = new Set((def.objectives || []).filter((o) => o.type === 'destroy').flatMap((o) => o.targets || []));
    for (const it of world.interactables || []) {
      const ud = it.object3d?.userData, tag = it.tag ?? it.spawn?.id ?? it.id;
      const f = it.destructible && !it.destroyed && (ud?.stageAlways || targets.has(tag)) ? ud?.prepareDestroy : null;
      const rr = f ? safe(() => f(), 'ruin staging') : null;
      if (rr) { ruins.push(rr); await nextTask(); } // (a ruin a task: a bunker's wreck is ~100 ms of geometry)
    }
    if (this.world !== world) return prog.cancel(), world;
    // scenery apron past the map edges (art/apron.js): the camera keeps its true footprint inside it at every zoom
    const apron = this.mapHandle?.terrain?.apron;
    if (apron) this.cameraRig.setApron(apron.field.A, apron.range);
    // big static meshes (terrain, apron ring…) → culled spatial chunks: the view draws only the part it sees
    const ck = CONFIG.render.chunking;
    if (ck?.enabled !== false) this.chunkStats = await safeAsync(() => (chunkLargeMeshesG ? runSliced(chunkLargeMeshesG(r.scene, ck)) : chunkLargeMeshes(r.scene, ck)), 'chunking');
    if (this.world !== world) return prog.cancel(), world;
    prog.stage('units');
    await safeAsync(() => runSliced(this._spawnUnitsG(world, def)), 'spawn'); // (a unit at a time: engine/slice.js)
    if (this.world !== world) return prog.cancel(), world;
    await safeAsync(() => awaitUnitModels(world.entities.filter((e) => e.model?.ready)), 'character bodies');
    // (a clip at a time, the loading screen drawing between them: engine/slice.js)
    this.warmMs = await safeAsync(() => (warmUnitModelsG ? runSliced(warmUnitModelsG(world.entities.filter((e) => e.model?.real))) : warmUnitModels(world.entities.filter((e) => e.model?.real))), 'character grounding');
    // (the rest of the bodies' clip fits: on still screens — the walkthrough's cards — engine/idle-warm.js)
    safe(() => { idleWarm.clear(); queueIdleWarm(world.entities.filter((e) => e.model?.real)); queueAheadModels(world); }, 'idle warm queue');
    // vehicles, wrecks, lamps, scorch: shaders + textures + vertex buffers on the GPU now, not on the first pan / wreck swap
    // (+ the vehicles the mission brings on later, e.g. M3's escape truck: drawn now, kept off the scene — VehicleMod.laterVehicleModels)
    const later = safe(() => VehicleMod.laterVehicleModels?.(def), 'later vehicles') || [];
    for (const m of later) r.scene.add(m.root);
    // (their models complete — a covered lorry's canvas and rear straps are built after its GLB, a slice at a time —
    // before their frames are drawn: the straps' programs too)
    const vehReady = [...later, ...world.entities.map((e) => e.model)].map((m) => m?.ready).filter((p) => p && typeof p.then === 'function');
    if (vehReady.length) await safeAsync(() => Promise.race([Promise.all(vehReady), new Promise((ok) => setTimeout(ok, 8000))]), 'vehicle models');
    // (its programs linked aside first and its frames drawn a share of the scene per task: engine/parallel-compile.js)
    this.vehicleWarm = await safeAsync(() => warmVehicleArt(r.renderer, r.scene, r.camera, () => this.cameraRig.render(this.renderer, 0),
      { precompile: (f) => this._compileAhead(f, { parts: true }), runFrames: (f) => this._framesInParts(f) }), 'vehicle warm-up');
    for (const m of later) m.root.removeFromParent();
    if (this.world !== world) return prog.cancel(), world;
    // house rules (bodies-design §0.3) + blast/ragdoll physics (§A): Rapier over the finished map, null object on failure
    world.house = resolveHouseRules({ options: this.options, mission: def, tier: tierFromPreset(r.presetName) });
    world.physics = (await safeAsync(() => createPhysics(world, { tier: world.house.physicsTier }), 'physics')) || NULL_PHYSICS;
    // no physics on this machine: play by the rule the null object can honour (saved, so a load keeps it)
    if (world.physics.isNull) world.house.physicsGameplay = false;
    // the men were spawned under the default layer: their house-rule actions follow the one resolved now (drag,
    // takeCharge — a CLASSIC 1998 Sapper must not keep SHADOW SIX's takeCharge)
    for (const c of world.commandos) c.refreshAbilities?.();
    if (this.world !== world) { world.physics.dispose(); return prog.cancel(), world; }
    this.physicsVisuals = safe(() => new PhysicsVisuals(world, r.scene), 'physics visuals');
    world.marks = safe(() => new BlastMarks(world, r.scene), 'blast marks'); // craters / scorch (saved, visual only)
    world.blood = safe(() => new BloodSystem(world, r.scene), 'blood'); // pools, spatter, stains, smears (saved, visual only)
    const trails = world.terrain?.terrain?.trails;
    if (trails && world.blood) trails.onStep = (e) => world.blood?.onStep(e); // bloody boot prints on the real footfalls
    // first-hit hitch: compile the stain / spatter programs now (bounded; a slow driver just finishes later)
    if (world.blood?.warm) await safeAsync(() => Promise.race([world.blood.warm(r.renderer, r.camera), new Promise((ok) => setTimeout(ok, 4000))]), 'blood warm-up');
    if (world.marks?.warm) await safeAsync(() => Promise.race([world.marks.warm(r.renderer, r.camera), new Promise((ok) => setTimeout(ok, 4000))]), 'blast marks warm-up'); // crater decal program + atlas
    if (world.fx?.vfx?.warm) await safeAsync(() => Promise.race([world.fx.vfx.warm(r.renderer, r.camera), new Promise((ok) => setTimeout(ok, 4000))]), 'vfx warm-up'); // smoke / fire / debris programs
    // the blood's drawn layers come from a lazily loaded module: in the scene by now, whatever the network and the
    // machine's speed (the warm-up frame below raced them: the wind particles and the fish joined the scene before or
    // after them, depending on how long the warm-ups above took)
    if (world.blood?.layersReady) await safeAsync(() => Promise.race([world.blood.layersReady, new Promise((ok) => setTimeout(ok, 4000))]), 'blood layers');
    // what the map builds on its first frame (the dam's water: rays down its face and a flow bake, ~1.7 s on M3), now,
    // a slice at a time; the warm-up frame below is that first frame and puts it in the scene as it always did
    if (this.mapHandle?.prepareG) await safeAsync(() => runSliced(this.mapHandle.prepareG()), 'map first-frame build');
    if (this.world !== world) return prog.cancel(), world;
    // every pass's programs for everything on the map (shadow depth, AO normals, mirror, x-ray variants): compiled now,
    // not as first-sight hitches when the camera reaches them during play
    if (ruins.length) await safeAsync(() => Promise.race([Promise.all(ruins.map((rr) => rr.ready)), new Promise((ok) => setTimeout(ok, 8000))]), 'ruins');
    if (this.world !== world) return prog.cancel(), world;
    await paintOnce();
    if (this.world !== world) return prog.cancel(), world;
    // (+ a dig site and a shovel where the Green Beret stands: art/shovel-dig.js keeps their programs from then on)
    const gb = world.commandos.find((c) => c.role === 'greenberet');
    const dig = gb ? safe(() => digWarmObjects(gb.x, gb.z, (world.groundY?.(gb.x, gb.z) || 0) + (gb.y || 0)), 'dig warm-up') : null;
    safe(() => world.blood?.layers?.pools?.warmMesh?.(), 'blood pools warm-up'); // (drawn by the warm-up frame only)
    safe(() => this.selection?.noise?.prewarm?.(), 'noise ring warm-up'); // (the first running step's ring)
    const wireWarm = safe(() => this.mapHandle?.wire?.warmObjects?.(), 'wire warm-up') || []; // (a cut's flaps and hollow)
    // (+ the raft deflated / inflating and the strapped pack, where the Marine can inflate or pack one: art/raft-actions.js)
    const diver = world.commandos.find((c) => c.role === 'diver'), rv = world.vehicles.find((v) => v.vehicleType === 'raft') || diver;
    const raftWarm = rv && (kitRaft || world.vehicles.some((v) => v.vehicleType === 'raft'))
      ? await safeAsync(() => raftWarmObjects({ x: rv.x, z: rv.z, y: world.groundY?.(rv.x, rv.z) || 0 }), 'raft warm-up') : null;
    if (this.world !== world) { safe(() => raftWarm?.done(), 'raft warm-up'); return prog.cancel(), world; }
    // (+ the Spy's take and dressing props: her caps as loose props, the officer's cap, U's bundle — art/spy-actions.js)
    const spyWarm = safe(() => spyWarmObjects(world), 'spy warm-up');
    // (+ the ambient aircraft, built at load: shown over the middle of the map for the warm-up frame — render/flyovers.js)
    if (world.flyovers?.ready) await safeAsync(() => Promise.race([world.flyovers.ready, new Promise((ok) => setTimeout(ok, 4000))]), 'flyover models');
    const flyWarm = def.size ? safe(() => world.flyovers?.warmShow?.(def.size[0] / 2, 20, def.size[1] / 2), 'flyover warm-up') : null;
    // (+ a wreck's scorch decal in the ground-decal scene, where wrecks draw it — art/vehicle-model.js)
    const scorchWarm = def.size && r.decalScene ? safe(() => vehicleDecalWarm(), 'scorch warm-up') : null;
    if (scorchWarm) { scorchWarm.position.x = def.size[0] / 2; scorchWarm.position.z = def.size[1] / 2; r.decalScene.add(scorchWarm); }
    if (CONFIG.render.warmFrame !== false) {
      const extra = [...ruins.flatMap((rr) => rr.roots), ...(dig?.objects || []), ...wireWarm, ...(raftWarm?.objects || []), ...(spyWarm?.objects || [])];
      const xray = [...(dig?.xray || []), ...(raftWarm?.xray || []), ...(spyWarm?.xray || [])];
      const frame = () => this._warmFrame(extra, xray, 'world'), close = () => this._warmFrame(extra, xray, 'close');
      // the driver links the frames' programs aside first (engine/parallel-compile.js): the frames themselves never wait
      this.warmCompile = await safeAsync(() => this._compileAhead(frame, { parts: true, extra }), 'program warm-up (parallel compile)');
      // (`all`: its submerged-mask, trail and ripple passes render their own scenes — warm-ups too: skipped in the probe)
      if (this.world === world) await safeAsync(() => this._compileAhead(close, { all: true }), 'program warm-up, close-ups (parallel compile)');
      // (the whole-map frame drawn a share of the scene per task: engine/parallel-compile.js framesInParts; the men's
      // close-up / stained passes once, on a task of their own)
      const tw = performance.now();
      if (this.world === world) await safeAsync(() => this._framesInParts(frame, extra), 'program warm-up frame');
      if (this.world === world) { await nextTask(); safe(() => close(), 'program warm-up close-ups'); }
      this.warmFrameMs = Math.round(performance.now() - tw);
    }
    for (const o of wireWarm) o.userData.warmDispose?.();
    safe(() => dig?.done(), 'dig warm-up');
    safe(() => raftWarm?.done(), 'raft warm-up');
    safe(() => spyWarm?.done(), 'spy warm-up');
    safe(() => flyWarm?.done(), 'flyover warm-up');
    scorchWarm?.removeFromParent();
    if (this.world !== world) return prog.cancel(), world;
    await safeAsync(() => world.fx?.prescan?.(), 'fx scan'); // chimneys, drums, mission fx: now, not in the first tick of play
    if (this.world !== world) return prog.cancel(), world;
    prog.stage('finish');
    world.objectives = createObjectives(def.objectives || []);
    if (!world.extraction) world.extraction = def.extraction || null;
    world.stats.startTime = world.time;
    world.rebuildSpatial();
    for (const e of world.entities) e.snap?.();

    const cs = def.cameraStart || world.commandos[0] || { x: def.size[0] / 2, z: def.size[1] / 2 };
    // §2.3 mission start: cameraStart {x, z, zoom} (zoom defaults to 1×)
    this.cameraController.setZoom(def.cameraStart?.zoom || CONFIG.camera.defaultZoom);
    this.cameraController.centerOn(cs.x, cs.z);
    this.selection.attach(world);
    this.input.reset?.();
    const first = world.commandos.find((c) => c.alive);
    if (first) this.input.select([first]);
    this.accumulator = 0;
    // the mission's own scenery (its script's `visuals`: M11's ramps and portals, M12's platform…): built now, as the
    // load ends — not by the script's first run on the first tick of play, its textures still loading (dark surfaces
    // for the first frames) and its programs compiling then; the script finds it built (missions/setpieces.js)
    await safeAsync(() => def.script?.visuals?.(world), 'mission visuals'); // (may be a sliced job: M20's castle)
    if (this.world !== world) return prog.cancel(), world;
    // (and what a model builds on its first update: `model.prepare(entity)` — the cable car's line)
    for (const e of world.entities) if (typeof e.model?.prepare === 'function') safe(() => e.model.prepare(e), 'model prepare');
    // (the ladders measured again over that scenery — what _laddersFrame did on the first tick of play — sliced)
    if (def.script?.visuals && this.ladders) {
      safe(() => this.ladders.dispose(), 'ladders dispose');
      this.ladders = (await safeAsync(() => runSliced(fitLaddersG(world, r.scene)), 'ladders')) || null;
      if (this.ladders) this.ladders.late = true;
    }
    if (this.world !== world) return prog.cancel(), world;
    // every texture loading in the background (engine/texture-memory.js: the dressing / castle / pavement finishes made
    // by the scans above) decoded and compressed before the loading screen goes: none draws empty in the first view
    const tt = performance.now(), tn = texturesLoading();
    if (tn) await safeAsync(() => texturesLoaded(20000), 'textures');
    this.textureWait = { textures: tn, ms: Math.round(performance.now() - tt) };
    if (this.world !== world) return prog.cancel(), world;
    // the first frame itself (the start view, its LODs, the selection, the cones): whatever program it still lacks is
    // linked aside now, not in that frame (engine/parallel-compile.js; a render with dt 0 advances nothing)
    if (CONFIG.render.warmFrame !== false) await safeAsync(() => this._compileAhead(() => this.render(0, 1, true)), 'first frame programs');
    if (this.world !== world) return prog.cancel(), world;
    const lp = prog.done();
    // the world is built: free what earlier missions loaded and this one does not use (GPU textures, templates…)
    sessionCache.settle();
    // what the first view does not draw is uploaded a few textures per frame during the briefing (releases its page copy)
    this.textureWarmer ||= new TextureWarmer(r.renderer);
    this.textureWarmer.clear();
    this.textureWarmer.add(r.scene);
    this.lastLoad = { id: def.id, preset: r.presetName, ...lp };
    if (!this.manualTick) console.info(`[load] ${def.id} (${r.presetName}): ${(lp.bytes / 1e6).toFixed(1)} MB in ${lp.files} files, ${(lp.ms / 1000).toFixed(1)} s`);
    this._setState('briefing');
    this.hud?.onMissionLoaded?.(world, def);
    this.events.emit('mission:loaded', { mission: def, world });
    return world;
  }

  /**
   * One frame of the whole map (load time): the frame camera keeps the game's orientation with its frustum widened to
   * the map and a margin, the sun shadow fitted to the whole map, the characters all on screen, the water mirror
   * updated for it. Every material then acquires its programs in every pass now (three compiles on first use).
   * Restores the view; the next real frame refits everything. `only`: 'world' the whole-map frame alone (drawn in
   * parts at load: engine/parallel-compile.js framesInParts), 'close' the characters' close-up / stained passes and the
   * render-to-texture warms alone (once: they draw the men only — repeated per part they were most of each part's
   * cost); both by default. @returns {number} ms
   */
  _warmFrame(extra = [], xrayExtra = [], only = null) {
    const t0 = performance.now(), r = this.renderer, rig = this.cameraRig, def = this.missionDef, w = this.world;
    let restoreWarm = null;
    if (!r.camera || !w || !def?.size) return 0;
    const [W, D] = def.size, m = 12, cam = rig.mainCamera, saved = cam.clone();
    cam.copy(rig.active?.camera || cam);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [-m, W + m]) for (const z of [-m, D + m]) for (const y of [-3, 24]) {
      v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1; cam.zoom = 1; cam.clearViewOffset?.();
    cam.updateProjectionMatrix();
    const corners = (y) => [[-m, -m], [W + m, -m], [W + m, D + m], [-m, D + m]].map(([x, z]) => ({ x, y, z }));
    const scene = r.scene, autoMW = scene.matrixWorldAutoUpdate, few = [], lods = [], seen = new Set();
    // (`extra`: objects kept off the scene until something happens — staged ruins: drawn in this frame only)
    for (const o of extra) scene.add(o);
    try {
      safe(() => charactersFrame(cam, 40), 'warm characters'); // all on screen, the zoom-1 LOD
      safe(() => this.mapHandle?.frame?.(0, cam), 'warm terrain / water');
      r.fitShadowToView({ groundFootprint: corners });
      scene.updateMatrixWorld();
      scene.matrixWorldAutoUpdate = false;
      // programs are acquired before the instance count matters: one instance each (grass, trees, clutter…) keeps the
      // whole-map frame light on a phone GPU. Bounds a cull computes during this frame (the shadow reach test asks for
      // an instanced mesh's box lazily) would cover that one instance and be kept: the instanced grass, trench pieces,
      // tents and hedgehogs then lost their shadows whenever it was off screen. Bounds not computed yet go back to
      // unset with the count, and are computed over every instance the next time a cull asks.
      const oneInstance = (o) => {
        if (o.boundingBox === null) few.push(o, 'boundingBox', null);
        if (o.boundingSphere === null) few.push(o, 'boundingSphere', null);
        few.push(o, 'count', o.count); o.count = 1;
      };
      scene.traverse((o) => {
        if (o.isInstancedMesh && o.count > 1) oneInstance(o);
        else if (o.geometry?.isInstancedBufferGeometry && o.geometry.instanceCount > 1) { few.push(o.geometry, 'instanceCount', o.geometry.instanceCount); o.geometry.instanceCount = 1; }
        // what stays hidden until something happens (`userData.warmShow`: the M3 dam's burst, a ruin waiting for its
        // blast, blood decals before the first wound) is drawn in this frame too: its programs exist before it first
        // shows (the blast is the shot in video mode)
        if (o.userData?.warmShow) {
          if (!o.visible) { few.push(o, 'visible', false); o.visible = true; }
          if (o.isInstancedMesh && o.count === 0) oneInstance(o);
        }
        // every level of detail of the characters (the director zooms in and out: each LOD's own program variants)
        if (!o.visible && /^LOD\d$/.test(o.name)) lods.push(o);
      });
      // (one of each program signature among them: programSignature)
      scene.traverseVisible((o) => { if (o.isMesh) seen.add(programSignature(o)); });
      for (const g of lods) {
        const dup = [];
        let fresh = false;
        for (const o of drawnMeshes(g)) { const k = programSignature(o); if (seen.has(k)) dup.push(o); else { seen.add(k); fresh = true; } }
        if (!fresh) continue;
        few.push(g, 'visible', false); g.visible = true;
        for (const o of dup) { few.push(o, 'visible', true); o.visible = false; }
      }
      // (the ground decals' scene too: the selection's noise rings…)
      r.decalScene?.traverse((o) => { if (o.userData?.warmShow && !o.visible) { few.push(o, 'visible', false); o.visible = true; } });
      // a vision cone (one guard's: the cones come and go with video mode's steps) and the selection's path line
      const cones = this.cones, forced0 = cones?.forced, foe = w.enemies.find((e) => e.alive && e.vision);
      if (cones && 'forced' in cones && foe) { cones.forced = new Set([foe]); cones.deferForced = false; safe(() => cones.update(), 'warm cone'); cones.deferForced = true; }
      const path = safe(() => this.selection?._pathLine?.(0), 'warm path');
      if (path) path.visible = true; // (made once, hidden again below: shown on every call — a warm-up frame runs in parts)
      // (and the x-ray pass over `xrayExtra` too: props carried on a man, the shovel, draw their own silhouette variant)
      const xt = r.xrayTargets;
      if (xrayExtra.length) r.xrayTargets = () => [...(xt?.() || []), ...xrayExtra];
      restoreWarm = () => {
        r.xrayTargets = xt;
        if (path) path.visible = false;
        if (cones && 'forced' in cones && foe) { cones.forced = forced0; safe(() => cones.update(), 'warm cone'); }
      };
      if (only !== 'close') {
        safe(() => w.water?.system?.renderMirror?.(), 'warm water mirror'); // (deferred by Game.render's mirrorLater)
        r.render(0);
      }
      if (only === 'world') return Math.round(performance.now() - t0); // (the finally below restores)
      // the men again with blood on them (blood/stains.js: the stained variant of every character material compiles at
      // the first wound — a kill in video mode): only their subtrees and the lights (the same light set), every LOD;
      // then close up, clean and stained (the director's close shots: the full-detail LOD and the small kit — mess
      // tins, rolled Zeltbahns, pouches — that humanoid-real's applyLOD hides zoomed out, with its AO prepass draw)
      safe(() => {
        const units = w.entities.filter((e) => e.model?.root && e.alive !== false);
        if (!units.length) return;
        const stains = w.blood?.layers?.stains;
        const tops = new Set(), hid = [];
        for (const u of units) { let t = u.model.root; while (t?.parent && t.parent !== scene) t = t.parent; if (t?.parent === scene) tops.add(t); }
        const lit = (top) => { let l = false; top.traverse((o) => { if (o.isLight) l = true; }); return l; };
        for (const top of scene.children) if (top.visible && !tops.has(top) && !top.isLight && !lit(top)) { top.visible = false; hid.push(top); }
        const stained = () => { const undo = stains?.preview?.(units); if (undo) try { r.render(0); } finally { undo(); } };
        const dup = [];
        try {
          stained();
          charactersFrame(cam, 400);
          scene.updateMatrixWorld();
          for (const top of tops) for (const o of drawnMeshes(top)) { const k = programSignature(o); if (seen.has(k)) { o.visible = false; dup.push(o); } else seen.add(k); }
          r.render(0);
          stained();
        } finally { for (const o of dup) o.visible = true; for (const t of hid) t.visible = true; charactersFrame(cam, 40); }
      }, 'warm close-up / stained characters');
      // the water's mask of a submerged man (the Marine diving: its own override programs)
      safe(() => {
        const sys = w.water?.system, diver = w.commandos.find((c) => c.role === 'diver') || w.commandos[0], root = diver?.model?.root;
        if (!sys?.renderSubmergedMask || !root) return;
        sys.setSubmerged([{ root, sel: false, x: root.position.x, y: root.position.y, z: root.position.z }]);
        try { sys.renderSubmergedMask(r.renderer, { width: 256, height: 144 }); } finally { sys.setSubmerged(null); }
      }, 'warm submerged mask');
      // render-to-texture programs of the map's systems (footprint trails, water ripples)
      safe(() => w.terrain?.terrain?.trails?.warm?.(), 'warm trails');
      safe(() => w.water?.system?.ripples?.warm?.(), 'warm ripples');
    } finally {
      for (let i = few.length - 3; i >= 0; i -= 3) few[i][few[i + 1]] = few[i + 2];
      safe(() => restoreWarm?.(), 'warm restore');
      for (const o of extra) scene.remove(o);
      scene.matrixWorldAutoUpdate = autoMW;
      cam.copy(saved);
      cam.updateProjectionMatrix();
    }
    return Math.round(performance.now() - t0);
  }

  /**
   * Compile the programs a warm-up frame will use without freezing the page: `frame` runs once as a probe (its new
   * programs are created and linked by the driver in parallel; their draws skipped), the wait polls between tasks
   * (engine/parallel-compile.js). The caller then draws the frame for real. Without KHR_parallel_shader_compile: no-op.
   * @param {() => void} frame synchronous, repeatable (it restores what it changes)
   */
  _compileAhead(frame, { cancelled = () => !this.building, always = false, parts = false, extra = null, all = false } = {}) {
    if (this._warmReload && this.building && !always) return Promise.resolve(null);
    const r = this.renderer;
    // (`parts`: a whole-map frame, probed a share of the scene at a time: engine/parallel-compile.js framesInParts;
    // `extra`: what the frame adds to the scene for itself — staged ruins… — split among the parts too)
    // (`all`: a frame of warm-up draws only — its own render-to-texture scenes too — every draw may be skipped)
    return compileAhead(r.renderer, frame, { scenes: [r.scene, r.decalScene, r.overlayScene], composer: r.composer, cancelled, scene: parts ? r.scene : null, extra, all });
  }

  /** A whole-map warm-up frame drawn for real, a share of the scene per task (engine/parallel-compile.js). */
  _framesInParts(frame, extra = null) {
    return framesInParts(this.renderer.scene, frame, { extra });
  }

  /** Spawn commandos (with BEL first-aid kit rule), enemies and vehicles from the mission def. */
  _spawnUnits(world, def) { return runSync(Game.prototype._spawnUnitsG.call(this, world, def)); }

  /** _spawnUnits as a sliced job (engine/slice.js): the same spawns in the same order, pausing between units. */
  *_spawnUnitsG(world, def) {
    const roles = (def.commandos || []).map((c) => c.role);
    const medic = firstAidCarrier(roles);
    for (const spawn of def.commandos || []) {
      // keep `inventory` absent when the mission gives none (→ typical kit); otherwise it is the
      // mission's exact extras on top of the fixed kit (items.js spawnInventory)
      const s = { ...spawn, campaign: world.campaign, inventory: spawn.inventory ? { ...spawn.inventory } : undefined };
      // BEL: one 6-dose first-aid kit per mission, carried by Driver → Spy → Sniper (first present).
      if (s.role === medic && s.inventory?.firstAid === undefined && def.firstAid !== false) {
        s.inventory = { ...(s.inventory || defaultInventory(s.role)), firstAid: FIRST_AID_DOSES };
      }
      const c = new Commando(placed(world, s));
      world.add(c);
      // §7.3 `hideout`: he starts inside that structure's door, hidden from the first tick (M12 GB and Sniper)
      if (spawn.hideout) admitAtSpawn(world, c, spawn.hideout);
      // §7.3 `stance: 'crawl'`: the mission starts him prone (already down: no stance-change lockout)
      if (spawn.stance === 'crawl') { c.setStance('crawl'); c._stanceT = 0; }
      if (due()) yield;
    }
    for (const spawn of def.enemies || []) { world.add(new Enemy(placed(world, spawn))); if (due()) yield; }
    const Vehicle = pick(VehicleMod, 'Vehicle', 'default');
    const createVehicle = pick(VehicleMod, 'createVehicle');
    world.vehicleFactory = (spawn) => (createVehicle ? createVehicle(spawn) : new Vehicle(spawn));
    for (const spawn of def.vehicles || []) {
      safe(() => world.spawnVehicle(spawn.vehicleType || 'truck', spawn), 'vehicle');
      if (due()) yield;
    }
  }

  /** Dispose the current world and all per-mission render objects. */
  unloadMission() {
    // keep the shader programs warm: the next mission's first frame reuses them (engine/program-keeper.js)
    if (this.world) deferMaterialDisposal();
    this.textureWarmer?.clear();
    safe(() => this.cones?.dispose?.(), 'cones dispose');
    this.cones = null;
    this.selection.detach();
    this._queue = [];
    if (this.world) {
      // chunk rows first (engine/chunking.js): the map's dispose takes the chunked meshes out of the scene
      safe(() => releaseAllChunks(this.renderer.scene), 'chunk rows');
      safe(() => releaseUnloadTextures(), 'module textures'); // GPU copies of session-long module textures
      safe(() => this.mapHandle?.dispose?.(), 'map dispose');
      safe(() => this.ladders?.dispose?.(), 'ladders dispose');
      this.ladders = null;
      safe(() => this.world.fx?.dispose?.(), 'fx dispose');
      safe(() => this.physicsVisuals?.dispose?.(), 'physics visuals dispose');
      safe(() => this.world.marks?.dispose?.(), 'blast marks dispose');
      safe(() => this.world.blood?.dispose?.(), 'blood dispose');
      this.physicsVisuals = null;
      this.world.dispose();
      idleWarm.clear();
      safe(() => releaseCharacters(), 'characters dispose');
      safe(() => releaseVehicles(), 'vehicles dispose');
      // Anything the map builder added directly to the scene (terrain, props) is removed here.
      const keep = new Set(['sun', 'hemi']);
      for (const o of [...this.renderer.scene.children]) {
        if (keep.has(o.name) || o === this.renderer.sun.target || o.userData?.persistent) continue;
        this.renderer.scene.remove(o);
        o.traverse?.((n) => {
          n.geometry?.dispose?.();
        });
      }
    }
    this.world = null;
    this.mapHandle = null;
  }

  /** briefing → playing. */
  start() {
    if (!this.world) return;
    if (this.state === 'briefing' || this.state === 'paused') {
      this.audio?.unlock?.();
      this._setState('playing');
      this.audio?.music?.(this.missionDef?.theater || 'mission');
    }
  }

  /**
   * Mission start (briefing tour finished or skipped): centre the active view on the squad — its centroid (else the
   * centre of its screen bounding box) when every live commando then fits clear of the screen edges and the HUD top
   * bar (48 px inset, feet and head), else the selected commando (else the first live one). Clamped
   * like any recentre (camera.focusTarget). @returns {{x:number, z:number}|null} the point looked at
   */
  focusSquad() {
    const w = this.world, cc = this.cameraController;
    if (!w || !cc) return null;
    const alive = w.commandos.filter((c) => c.alive);
    if (!alive.length) return null;
    const sel = alive.filter((c) => c.selected);
    // whole body (feet and head) clear of the screen edges and of the HUD top bar
    const seen = (c) => cc.isVisible(c.x, c.z, 48, 0) && cc.isVisible(c.x, c.z, 48, 1.8);
    cc.untrack?.();
    const x = alive.reduce((s, c) => s + c.x, 0) / alive.length, z = alive.reduce((s, c) => s + c.z, 0) / alive.length;
    const IN = 0.5; // keep the squad in the middle half of the play view where the clamp allows (apron past the edge)
    cc.centerOn(x, z, IN);
    if (alive.every(seen)) return { x, z };
    // a lopsided squad: the centre of its screen-space bounding box fits more of it than the centroid
    const ca = Math.cos(cc.azimuth), sa = Math.sin(cc.azimuth);
    const us = alive.map((c) => c.x * ca - c.z * sa), vs = alive.map((c) => c.x * sa + c.z * ca);
    const mu = (Math.min(...us) + Math.max(...us)) / 2, mv = (Math.min(...vs) + Math.max(...vs)) / 2;
    const bx = mu * ca + mv * sa, bz = -mu * sa + mv * ca;
    cc.centerOn(bx, bz, IN);
    if (alive.every(seen)) return { x: bx, z: bz };
    const c = sel[0] || alive[0];
    cc.centerOn(c.x, c.z, IN);
    return { x: c.x, z: c.z };
  }

  pause(on = true) {
    if (on && this.state === 'playing') this._setState('paused');
    else if (!on && this.state === 'paused') this._setState('playing');
  }

  /** The player's own pause (P). Sets `playerPaused`, which a save records (§8.4: a load resumes unless saved paused). */
  togglePause() {
    const on = this.state === 'playing';
    this.pause(on);
    if (on && this.state === 'paused') this.playerPaused = true;
  }

  /** Back to the title screen. */
  quitToTitle() {
    this.unloadMission();
    this.missionDef = null;
    this._setState('title');
  }

  // ------------------------------------------------------------ simulation

  /** ONE fixed simulation tick (tests call this directly). */
  step(dt = CONFIG.sim.dt) {
    const w = this.world;
    if (!w) return;
    this._flushQueue();
    for (const e of w.entities) e.savePrev?.();
    w.rebuildSpatial();
    safe(() => w.refreshDynamicOccluders(), 'occluders');
    const run = (list) => {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.removed) continue;
        try {
          e.update(dt);
        } catch (err) {
          console.error(`[game] ${e.kind} #${e.id} update failed`, err);
        }
      }
    };
    run(w.commandos);
    run(w.enemies);
    safe(() => w.runBelTicks(dt), 'belTick'); // §10.1 tick-integer rules (nervousness…) at 20 Hz
    run(w.vehicles);
    run(w.projectiles);
    run(w.interactables);
    safe(() => w.physics.step(dt), 'physics'); // bodies-design §1 tick order: after interactables, before objectives
    w.alarm?.update(dt);
    const res = checkObjectives(w);
    safe(() => updateExtractionVehicle(w, (this._endFlags ||= {})), 'extraction'); // §7.6 scripted escape vehicle
    safe(() => w.fx?.update?.(dt), 'fx');
    if (w.blood) safe(() => w.blood.update(dt), 'blood');
    safe(() => (this.mapHandle?.update ? this.mapHandle.update(dt) : this.mapHandle?.terrain?.update?.(dt)), 'map');
    w.flushRemovals();
    w.time += dt;
    w.tick++;
    if (this.state === 'playing') {
      w.clock += dt; // §8.2 mission clock
      this._checkEnd(res || {}, dt);
    }
  }

  // ------------------------------------------------------------ end conditions (§8.1)

  /** Current loss condition, or null. @returns {{code:string, reason:string}|null} */
  _lossCondition(res) {
    const w = this.world;
    const alive = w.commandos.filter((c) => c.alive !== false && !c.removed);
    const jailed = (c) => c.state === 'jailed' || c.state === 'captured';
    // §8.1 alarm-fail scripts (M13 sub shelled, M15 general escaped, M16 bridge blown …): src/missions/setpieces.js
    if (w.scriptFail) return { code: 'script', reason: w.scriptFail };
    if (w.commandos.length && alive.every(jailed)) return { code: 'allLost', reason: 'ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.' };
    if (CONFIG.mission.failOnCommandoDeath && w.commandos.some((c) => c.alive === false)) return { code: 'died', reason: 'ONE OR MORE OF YOUR MEN DIED…' };
    // bodies-design §C.8: every man down / captured and nobody able to help → no 60 s wait
    if (w.house?.buddyRescue && nobodyLeftToHelp(w)) return { code: 'died', reason: 'NOBODY LEFT TO HELP.' };
    const ex = w.mission?.extraction;
    if (ex?.vehicleId != null) {
      const v = w.byId(ex.vehicleId);
      const escDone = (w.objectives || []).some((o) => o.type === 'escape' && o.done);
      if (v && (v.destroyed || v.removed) && !escDone) {
        const t = String(v.vehicleType || v.type || 'vehicle').toLowerCase();
        const label = /ju|plane/.test(t) ? 'JU-52' : /boat|launch/.test(t) ? 'BOAT' : 'TRUCK';
        return { code: 'vehicle', reason: `YOU DESTROYED THE ${label}, BUT YOU NEEDED IT TO ESCAPE.` };
      }
    }
    if (res.lost) {
      const o = (w.objectives || []).find((x) => x.failed && x.required);
      return { code: 'objective', reason: res.reason || (o ? `MISSION FAILED: ${o.text || o.id}` : 'MISSION FAILED') };
    }
    return null;
  }

  /**
   * §8.1: win at once (objective-only missions: after a 5 s grace with no one dead); losses start a 5 s grace countdown and fire only if the condition still holds
   * when it ends. Also: "ALL YOUR MEN MUST ESCAPE." (refused, once) and the "escaped, targets not done"
   * dialog (Continue gives pending timers 15 s).
   */
  _checkEnd(res, dt) {
    const w = this.world;
    const M = CONFIG.mission;
    const f = (this._endFlags ||= {});
    if (res.won) {
      const ex = w.extraction ?? w.mission?.extraction ?? null;
      // a won extraction never overrides a loss (e.g. a dead commando: the escape objective counts only the living)
      if (ex && !this._lossCondition(res)) {
        this.pendingEnd = null;
        this._endMission(true, 'MISSION COMPLETED');
        return;
      }
      // §7.4/§8.1 objective-only win (M1, extraction:null): fires 5 s after the objective completes,
      // provided no commando is dead; a loss condition during the grace takes over below.
      if (!this._lossCondition(res)) {
        const pw = this.pendingEnd;
        if (!pw?.won) {
          this.pendingEnd = { won: true, code: 'objectives', reason: 'MISSION COMPLETED', t: M.objectiveWinDelay };
          return;
        }
        pw.t -= dt;
        if (pw.t <= 1e-9) this._endMission(true, 'MISSION COMPLETED');
        return;
      }
    }
    if (this.pendingEnd?.won) this.pendingEnd = null;
    const p = this.pendingEnd;
    if (p) {
      p.t -= dt;
      if (p.t > 1e-9) return;
      this.pendingEnd = null;
      const again = this._lossCondition(res);
      if (again) this._endMission(false, again.reason);
      else this.events.emit('mission:countdown', { reason: null, t: 0 });
      return;
    }
    const loss = this._lossCondition(res);
    if (loss) {
      this.pendingEnd = { won: false, code: loss.code, reason: loss.reason, t: M.lostDelay };
      this.events.emit('mission:countdown', { reason: loss.reason, t: M.lostDelay });
      return;
    }
    if (f.continueUntil != null) {
      if (w.clock >= f.continueUntil) this._endMission(false, "YOU MANAGED TO ESCAPE, BUT YOU DIDN'T DESTROY THE TARGETS…");
      return;
    }
    const ex = extractionStatus(w);
    if (!ex.hasExtraction) return;
    if (ex.anyEscaped && ex.jailed > 0 && !f.refused) {
      f.refused = true;
      const reason = 'ALL YOUR MEN MUST ESCAPE.';
      this.events.emit('mission:refused', { reason });
      this.events.emit('message', { text: reason, kind: 'warn' });
    }
    if (ex.allEscaped && !ex.othersDone && !f.escapedAsked) {
      f.escapedAsked = true;
      this.pause(true);
      this.events.emit('mission:escaped', { reason: "YOU MANAGED TO ESCAPE, BUT YOU DIDN'T DESTROY THE TARGETS…", choices: ['continue', 'quickload'] });
    }
  }

  /** §7.6 ESC while the loaded escape vehicle drives off: skip the drive (escape completes next tick). */
  skipExtraction() {
    if (!this.world || this.state !== 'playing') return false;
    return !!safe(() => skipExtractionDrive(this.world, (this._endFlags ||= {})), 'extraction');
  }

  /** "(C)ONTINUE" on the escaped-early dialog: resume; the objectives have 15 s to complete (§8.1). */
  continueEscape() {
    if (!this.world) return;
    const f = (this._endFlags ||= {});
    f.continueUntil = this.world.clock + CONFIG.mission.escapeContinueWindow;
    this.pause(false);
  }

  _endMission(won, reason) {
    if (this.state === 'won' || this.state === 'lost') return; // idempotent: one mission:won/lost per run
    this.pendingEnd = null;
    const w = this.world;
    const stats = { ...w.stats, time: w.time - (w.stats.startTime || 0), mission: this.missionDef?.id };
    const score = safe(() => this.flow?.onMissionEnd(won, w, this.missionDef), 'flow') || { stars: null, merit: 0, rank: null, password: null };
    this._setState(won ? 'won' : 'lost');
    this.events.emit(won ? 'mission:won' : 'mission:lost', { reason, stats, ...score });
  }

  /**
   * Run up to round(seconds/dt) ticks synchronously (tests). Only ticks while state === 'playing'
   * (stops early on won/lost/pause). @returns {number} ticks actually run
   */
  advance(seconds) {
    const dt = CONFIG.sim.dt;
    const n = Math.max(0, Math.round(seconds / dt));
    let ran = 0;
    for (; ran < n; ran++) {
      if (this.state !== 'playing') break;
      this.step(dt);
    }
    this.render(0, 1);
    return ran;
  }

  // ------------------------------------------------------------ frame loop

  /** Start the requestAnimationFrame loop. */
  run() {
    if (this._raf) return;
    this._last = performance.now();
    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, CONFIG.render.maxDelta);
      this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
      this.frame(dt);
    };
    this._raf = requestAnimationFrame(frame);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /**
   * Dynamic resolution on / off: true, false, or 'auto' (phones and tablets only; never in test mode unless forced).
   * @param {boolean|'auto'} mode
   */
  setDynamicResolution(mode) {
    const on = mode === true || (mode === 'auto' && this.mobileDevice && !this.manualTick);
    if (on && !this.dynres) this.dynres = new DynamicResolution(CONFIG.render.dynamicResolution || {});
    if (!on && this.dynres) { this.dynres = null; this.renderer.setDynamicScale(1); }
    this.dynresMode = mode;
    return !!this.dynres;
  }

  /** One displayed frame (rAF): run it, then feed its timing to the dynamic resolution controller. */
  frame(dt) {
    const t0 = performance.now();
    this._frame(dt);
    const d = this.dynres;
    if (!d) return;
    // only frames that drew a playing / paused world count: menus, loads and covered views say nothing about the GPU
    if (this.building || !this.world || this._coveredFrames > 2) { this._dynLast = 0; return; }
    const now = performance.now();
    if (this._dynLast) {
      const s = d.sample(now - this._dynLast, now - t0);
      if (s != null) this.renderer.setDynamicScale(s);
    }
    this._dynLast = now;
  }

  /** One displayed frame: accumulate sim ticks (unless manualTick), then render. */
  _frame(dt) {
    const simDt = CONFIG.sim.dt;
    let alpha = 1;
    if (this.world && this.state === 'playing' && !this.manualTick) {
      this.accumulator += dt * this.timeScale;
      let steps = 0;
      while (this.accumulator >= simDt && steps < CONFIG.sim.maxStepsPerFrame && this.state === 'playing') {
        this.step(simDt);
        this.accumulator -= simDt;
        steps++;
      }
      if (steps >= CONFIG.sim.maxStepsPerFrame) this.accumulator = Math.min(this.accumulator, simDt);
      alpha = this.accumulator / simDt;
    }
    // a world being built is hidden by the loading screen (or holds the last frame of an instant restart): drawing
    // it half-built only competes with the load for the main thread (and compiles programs one frame at a time)
    if (!this.building) {
      // the page's first frame (post passes, the menus' scene): its programs linked aside first, the view waits for
      // them (engine/parallel-compile.js: ~17 programs blocked the boot 0.3–0.8 s)
      if (this._bootWarm !== true && !this.manualTick && CONFIG.render.warmFrame !== false) {
        this._bootWarm ||= this._compileAhead(() => this.render(0, 1, true), { cancelled: () => false })
          .catch(() => null).finally(() => { this._bootWarm = true; });
        if (this._bootWarm !== true) { safe(() => this.hud?.update?.(dt), 'hud'); return; }
      }
      // the view hidden behind an opaque menu layer (the menus' backdrop, its live diorama off): no GPU work for it
      const covered = this._viewCovered();
      this._coveredFrames = covered ? (this._coveredFrames || 0) + 1 : 0;
      this.render(dt, alpha, this._coveredFrames <= 2);
      // the first frame after a (re)load has acquired its programs: the previous mission's materials may go now
      if (holdingMaterials()) flushMaterialDisposal();
      // textures not drawn yet go to the GPU a few per frame, and their decoded page copy goes (engine/texture-memory.js)
      if (this.textureWarmer?.queue.length) this.textureWarmer.step(3); // ms a frame
    }
  }

  /**
   * Draw a frame: interpolated entity transforms, camera, cones, overlays, HUD. Never advances the sim.
   * @param {number} [dt] real frame delta (visual animation)
   * @param {number} [alpha] interpolation factor between the previous and current tick
   * @param {boolean} [draw] false: update everything but skip the GPU frame (view covered by a menu, see frame())
   */
  render(dt = 0, alpha = 1, draw = true) {
    const w = this.world;
    const animDt = this.state === 'playing' ? dt : 0;
    // §6.8: faithful pause freezes scrolling (arrows, edge, middle-drag); the ⚑ active-pause option allows it. The
    // Colonel's tour flies the camera itself (ui/briefing.js sets rig.scripted): no scrolling may fight it either.
    this.cameraRig.panLocked = (this.state === 'paused' && !this.options.activePause) || !!this.cameraRig.scripted;
    this.cameraRig.update(dt);
    if (w) {
      const cc0 = this.cameraController;
      // step 4w: publish the wind at the interpolated SIM time (frozen while paused, deterministic) before anything samples it
      if (w.wind) safe(() => w.wind.frame(Math.max(0, w.time - (1 - Math.min(1, alpha)) * CONFIG.sim.dt), cc0.target), 'wind');
      const rig = this.cameraRig, cam = (rig.count ?? 1) > 1 ? false : rig.active?.camera || this.renderer.camera;
      safe(() => charactersFrame(cam, cc0.pxPerMeter?.() ?? 40), 'characters view'); // LOD + off-screen culling/throttling
      safe(() => tickVehicles(animDt, cam || this.renderer.camera, w.wind ?? null), 'vehicles view'); // LOD by zoom, windsocks
      for (const e of w.entities) {
        e.syncTransform?.(alpha);
        if (e.soldierType === 'mg' && e.spawn?.tower != null) mgMountFrame(e); // platform MG laid along his facing (hand IK reads it)
        e.renderUpdate?.(animDt);
      }
      safe(() => transportFrame(), 'transport poses'); // carried / dragged men after both skeletons updated (§C.10)
      safe(() => barrelCarryFrame(w), 'barrel carry'); // a drum on the Green Beret's hands (after his skeleton updated)
      if (w.knifeKills?.length) safe(() => knifeKillFrame(w, alpha, CONFIG.sim.dt), 'knife kill poses'); // contact knife kills: both men posed together
      if (w.spyActs?.length) safe(() => spyActionsFrame(w, alpha, CONFIG.sim.dt), 'spy action poses'); // the Spy's injection / dressing
      // the Marine inflating / packing the raft, and the packed raft on his back (art/raft-actions.js)
      if (raftPassWanted(w)) safe(() => raftActionsFrame(w, alpha, CONFIG.sim.dt), 'raft actions');
      if (w.switchStations?.length) safe(() => switchStationsFrame(w, alpha, CONFIG.sim.dt), 'switch stations'); // levers + the operator's hand
      if (this.physicsVisuals) safe(() => this.physicsVisuals.frame(), 'physics visuals'); // props, vehicle rock, censored bodies
      // trails, grass, trees; the water's offscreen passes (FFT, caustics, ripples) only for a drawn frame — its mirror
      // waits for the frame's one world-matrix update below (WaterSystem.mirrorLater / renderMirror)
      const ws = w.water?.system;
      if (ws) ws.mirrorLater = true;
      safe(() => this.mapHandle?.frame?.(animDt, this.renderer.camera, draw), 'terrain frame');
      if (this.ladders) safe(() => this._laddersFrame(w), 'ladders');
      this._updateCones();
      this.renderer.fitShadowToView?.(this.cameraRig);
      const cc = this.cameraController;
      // §9 listener = view centre, maxDistance ∝ view width (screen width in ground metres); pan along screen-right (yaw)
      safe(() => this.audio?.update?.(cc.target.x, cc.target.z, cc.pxPerMeter ? cc.width / cc.pxPerMeter() : 40, cc.azimuth || 0), 'audio');
    }
    if (w?.fx) safe(() => w.fx.frame?.(), 'fx frame'); // VFX sort/upload, lights, decals (sim runs in step())
    if (w?.blood) safe(() => w.blood.frame(), 'blood frame'); // pool flow sims + atlas uploads, stain uniforms
    this.selection.update(dt);
    this.input.update?.(dt);
    // world matrices once per frame, not once per render pass (main, GTAO normals, x-ray, water, …): with 46 skinned
    // characters (~100 nodes each) the per-pass scene.updateMatrixWorld was the single largest CPU cost
    const scene = this.renderer.scene, autoMW = scene.matrixWorldAutoUpdate;
    if (draw) {
      scene.updateMatrixWorld();
      scene.matrixWorldAutoUpdate = false;
      try {
        if (w?.water?.system?.renderMirror) safe(() => w.water.system.renderMirror(), 'water mirror');
        this.cameraRig.render(this.renderer, dt);
        if (w) safe(() => this._scopeFrame(), 'scope magnifier'); // §5.3 sniper scope: 2× lens into the same canvas
      } finally { scene.matrixWorldAutoUpdate = autoMW; }
    }
    safe(() => this.hud?.update?.(dt), 'hud');
  }

  /**
   * Is the 3D view hidden behind an opaque full-screen layer? The boot screens (ui/boot.js) and the menus' backdrop
   * (ui/backdrop.js: fixed, opaque, above the canvas) while its live diorama is not running — the diorama draws through
   * the renderer itself.
   */
  _viewCovered() {
    // the boot screens (disclaimer, ident, title splash: fixed, opaque black) until their fade-out starts
    const bt = this.hud?.boot?.root;
    if (bt?.isConnected && !bt.hidden && !bt.classList.contains('leaving')) return true;
    const bd = this.hud?.backdrop;
    return !!(bd?.root && !bd.root.hidden && !bd.dio && bd.root.isConnected);
  }

  /** §5.3 sniper scope 2× magnifier: drawn into the canvas after the frame while the scope cursor is up. */
  _scopeFrame() {
    const s = this.hud?.cursor?.lensState?.() || null;
    if (!s) {
      if (this.scopeMagnifier) this.scopeMagnifier.stats.drawn = false;
      return;
    }
    this.scopeMagnifier ||= new ScopeMagnifier(this.renderer);
    const one = (this.cameraRig.count ?? 1) === 1; // one view: the frame's camera (with shake); several: the active view's
    this.scopeMagnifier.frame(s, { view: this.cameraController, camera: one ? this.renderer.camera : null, water: this.world?.water?.system || null });
  }

  // ------------------------------------------------------------ vision cones

  /** Toggle an enemy's vision-cone display (BEL: click an enemy / eye button). */
  toggleCone(enemy, on = !enemy.coneVisible) {
    if (!enemy) return;
    enemy.coneVisible = !!on;
  }

  /**
   * Built ladders follow their links (a raised ladder shows once lowered). A mission script draws its own scenery on
   * its first tick: the ladders are measured again then, once (a script with `.visuals` — M20's castle — had its
   * scenery built and the ladders measured again as the load ended: `late` already).
   */
  _laddersFrame(w) {
    if (!this.ladders.late && w.tick >= 1 && this.missionDef?.script) {
      this.ladders.dispose();
      this.ladders = fitLadders(w, this.renderer.scene);
      this.ladders.late = true;
    }
    this.ladders.frame();
  }

  _updateCones() {
    const w = this.world;
    if (!this.cones) {
      const Cones = pick(ConeMod, 'VisionCones', 'default');
      this.cones = safe(() => (Cones ? new Cones(w, this.renderer.decalScene || this.renderer.overlayScene) : null), 'vision-cones') || { update() {}, dispose() {} };
    }
    safe(() => this.cones.update(), 'vision-cones');
  }

  // ------------------------------------------------------------ save / load

  quickSave() {
    if (!this.world) return false;
    const ok = quickSave(this);
    this.events.emit('message', { text: ok ? 'Game saved.' : 'Save failed.', kind: ok ? 'info' : 'warn' });
    return ok;
  }

  async quickLoad() {
    const ok = await quickLoad(this);
    this.events.emit('message', { text: ok ? 'Game loaded.' : 'No quicksave.', kind: ok ? 'info' : 'warn' });
    return ok;
  }

  /** Save into named slot 0..9 (§8.4, Esc menu). */
  saveSlot(i, name) {
    if (!this.world) return false;
    const ok = saveSlot(this, i, name);
    this.events.emit('message', { text: ok ? 'Game saved.' : 'Save failed.', kind: ok ? 'info' : 'warn' });
    return ok;
  }

  async loadSlot(i) {
    const ok = await loadSlot(this, i);
    this.events.emit('message', { text: ok ? 'Game loaded.' : 'Empty slot.', kind: ok ? 'info' : 'warn' });
    return ok;
  }

  // ------------------------------------------------------------ probe marker (§4.2, §5.2 Shift+click ground)

  /**
   * Place the red probe marker: the first enemy whose cone covers (x, z) gets its cone shown (one at a
   * time — any cone shown by an earlier probe/Shift+click is hidden). @returns {number|null} enemy id
   */
  probe(x, z) {
    const w = this.world;
    if (!w) return null;
    this.probeMarker = { x, z };
    const e = safe(() => probeCone(w, x, z), 'probe');
    this.showOnlyCone(e || null);
    safe(() => this.cones?.setProbe?.(x, z, e || null), 'probe-ring'); // found now: the ring is triggered at once
    this.events.emit('ui:probe', { x, z, enemy: e || null });
    return e ? e.id : null;
  }

  /** Show one enemy's (or vehicle's/bunker's) cone and hide the others (§5.2 "one at a time"). */
  showOnlyCone(target) {
    const w = this.world;
    if (!w) return;
    for (const e of w.enemies) if (e !== target && e.coneVisible) e.coneVisible = false;
    if (target) this.toggleCone(target, true);
  }

  dispose() {
    this.stop();
    this.unloadMission();
    flushMaterialDisposal();
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('beforeunload', this._onUnload);
    safe(() => this.hud?.dispose?.(), 'hud');
    this.selection.dispose();
    this.input.dispose?.();
    this.cameraRig.dispose();
    this.flow?.dispose?.();
    this.scopeMagnifier?.dispose();
    this.renderer.dispose?.();
  }
}

/**
 * What decides the program three links for a mesh (its WebGLPrograms key, over-split on purpose): the material's kind,
 * features and maps, the mesh's attributes, skinning, morphs and the passes it takes part in — not which man it is.
 * The warm-up frame draws hidden levels of detail and the close-up kit once per signature: their programs link at
 * load, while every other man's vertex buffers stay off the GPU until the camera gets there (uploads are cheap,
 * programs are not).
 */
const SIG_TEX = ['map', 'alphaMap', 'normalMap', 'bumpMap', 'displacementMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'lightMap', 'envMap', 'specularMap', 'specularIntensityMap', 'specularColorMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap',
  'iridescenceThicknessMap', 'anisotropyMap', 'matcap', 'gradientMap'];
function programSignature(o) {
  const g = o.geometry, at = g?.attributes || {};
  const mat = (m) => (!m ? '-' : [m.type, m.customProgramCacheKey?.(), JSON.stringify(m.defines || null), m.vertexColors, m.alphaTest > 0, m.alphaHash,
    m.side, m.flatShading, m.fog, m.toneMapped, m.wireframe, m.transparent, m.premultipliedAlpha, m.dithering, m.clippingPlanes?.length || 0,
    m.normalMapType, m.envMap?.mapping, SIG_TEX.map((k) => (m[k] ? `${k}${m[k].channel}${m[k].colorSpace}` : '')).join('')].join(','));
  return [o.type, !!o.instanceColor, Object.keys(at).sort().map((k) => `${k}${at[k].itemSize}`).join('.'),
    Object.entries(g?.morphAttributes || {}).map(([k, v]) => `${k}${v.length}`).join('.'), g?.morphTargetsRelative, o.receiveShadow, o.castShadow,
    o.layers.mask, !!o.userData.aoExclude, !!o.userData.noXray, ...[].concat(o.material).map(mat)].join('|');
}
/** The meshes a subtree draws (its root counted visible): no hidden branch below it. */
function drawnMeshes(root) {
  const out = [];
  const walk = (o) => { if (o !== root && !o.visible) return; if (o.isMesh) out.push(o); for (const c of o.children) walk(c); };
  walk(root);
  return out;
}

/** Run fn, logging (as a warning, so tests don't fail on optional systems) and returning null on error. */
function safe(fn, label) {
  try {
    return fn();
  } catch (err) {
    console.warn(`[game] ${label} failed:`, err);
    return null;
  }
}

/** Async variant of safe(). */
async function safeAsync(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[game] ${label} failed:`, err);
    return null;
  }
}
