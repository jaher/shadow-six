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
import { Flow } from './core/flow.js';
import { CONFIG } from './config.js';
import { EventBus } from './core/events.js';
import { checkObjectives, createObjectives, extractionStatus, skipExtractionDrive, updateExtractionVehicle } from './core/objectives.js';
import { Renderer } from './engine/renderer.js';
import { CameraRig } from './engine/camera.js';
import { Input } from './engine/input.js';
import { assets } from './engine/assets.js';
import { World } from './world/world.js';
import { Commando } from './entities/commando.js';
import { Enemy } from './entities/enemy.js';
import { Entity } from './entities/entity.js';
import { Alarm } from './ai/alarm.js';
import { Selection } from './render/selection.js';
import { FIRST_AID_DOSES, firstAidCarrier, defaultInventory } from './items.js';
import * as MapBuilder from './world/map-builder.js';
import { prepareMissionArt } from './art/building-props.js';
import { prepareCharacters, awaitUnitModels, warmUnitModels, charactersFrame, releaseCharacters } from './art/unit-model.js';
import { prepareTruckArt } from './art/truck-model.js';
import { createLoadProgress, loadBudget } from './engine/load-progress.js';
import * as Missions from './missions/index.js';
import * as VehicleMod from './entities/vehicle.js';
import * as FxMod from './render/fx.js';
import * as ConeMod from './render/vision-cone.js';
import * as HudMod from './ui/hud.js';
import * as AudioMod from './audio/audio.js';
import { quickSave, quickLoad, saveSlot, loadSlot, autoSave } from './save.js';
import { probe as probeCone } from './ai/perception.js';

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
    this.cameraRig = new CameraRig({ domElement: this.renderer.domElement, uiScale: () => this.hud?.uiScale || 1 });
    this.cameraRig.edgeScroll = this.options.edgeScroll;
    this.cameraRig.edgeOverHud = this.options.edgeScrollOverHud;
    // Keep the ortho frustums in sync with the canvas (else the view is stretched horizontally).
    this.renderer.onResize = (w, h) => this.cameraRig.resize(w, h);
    this.renderer.setCamera(this.cameraRig.mainCamera);
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
    const list = missionList();
    let def = idOrIndex;
    if (typeof idOrIndex === 'number') def = list[idOrIndex];
    else if (typeof idOrIndex === 'string') def = list.find((m) => m.id === idOrIndex);
    if (!def || typeof def !== 'object') throw new Error(`unknown mission "${idOrIndex}"`);
    this.events.emit('mission:loading', { id: def.id }); // UI releases the menu diorama (menus-art-direction §1.10)
    this.unloadMission();
    this.missionIndex = list.indexOf(def);
    def = normalizeMission(def, { difficulty: this.difficulty ?? null }); // design-spec §7.3 defaults (throws on invalid data); BCD Easy/Hard variant
    this.missionDef = def;
    Entity.nextId = 1; // deterministic ids (save/load, tests)

    const r = this.renderer;
    // real progress for the loading screen: stages + bytes received vs the mission's budget (engine/load-progress.js)
    const prog = createLoadProgress({ events: this.events, id: def.id, preset: r.presetName, budget: await loadBudget() });
    this.loadProgress = prog;
    prog.stage('lighting');
    // per-mission lighting from the mission file (sun, kelvin, HDRI, fog, LUT — design-spec §2.4)
    if (r.applyMissionLighting) await safeAsync(() => r.applyMissionLighting(def, { assets }), 'lighting');
    else r.setTheater?.(def.theater || 'temperate', def.lighting || null);
    const world = new World({ game: this, scene: r.scene, events: this.events, size: def.size, seed: def.seed ?? CONFIG.sim.seed, mission: def });
    this.world = world;
    world.alarm = new Alarm(world);
    const FX = pick(FxMod, 'FX', 'Fx', 'default');
    world.fx = safe(() => (FX ? new FX(world, r.scene) : null), 'fx');

    // x-ray: live commandos only (enemies are never x-rayed)
    r.xrayTargets = () => (this.world === world ? world.commandos.filter((c) => c.alive && c.object3d).map((c) => c.object3d) : []);
    r.setMapBounds?.(def.size[0], def.size[1]);
    this.cameraRig.reset();
    this.cameraRig.setBounds(def.size[0], def.size[1]);
    this.pendingEnd = null;
    this._endFlags = {};

    // realistic buildings & bridges (art/building-props.js): manifest + this mission's GLBs before the map builds
    prog.stage('buildings');
    await safeAsync(() => prepareMissionArt(def, { assets, quality: r.presetName === 'ultra' ? 'ultra' : r.presetName === 'low' ? 'low' : 'default' }), 'buildings');
    // realistic characters (art/unit-model.js): library + squad-aware enemy looks; placeholder capsules on failure
    prog.stage('characters');
    await safeAsync(() => prepareCharacters(def), 'characters');
    // realistic Opel Blitz trucks (art/truck-model.js): theater paint + burnt wreck GLBs; placeholders on failure
    prog.stage('vehicles');
    await safeAsync(() => prepareTruckArt(def, { assets }), 'trucks');
    if (this.world !== world) return prog.cancel(), world; // unloaded / replaced while loading
    prog.stage('terrain');
    const build = pick(MapBuilder, 'buildMap', 'buildMission', 'build', 'default');
    this.mapHandle = build ? safe(() => build(world, def, { theater: def.theater, renderer: r, scene: r.scene, assets }), 'map-builder') : null;
    // ground textures, grass and trees build asynchronously (decode + splat + tree workers): wait, bounded
    const ready = this.mapHandle?.ready;
    if (ready) await safeAsync(() => Promise.race([ready, new Promise((ok) => setTimeout(ok, 20000))]), 'terrain');
    if (this.world !== world) return prog.cancel(), world; // unloaded / replaced while waiting
    prog.stage('units');
    this._spawnUnits(world, def);
    await safeAsync(() => awaitUnitModels(world.entities.filter((e) => e.model?.ready)), 'character bodies');
    this.warmMs = await safeAsync(() => warmUnitModels(world.entities.filter((e) => e.model?.real)), 'character grounding');
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
    const lp = prog.done();
    this.lastLoad = { id: def.id, preset: r.presetName, ...lp };
    if (!this.manualTick) console.info(`[load] ${def.id} (${r.presetName}): ${(lp.bytes / 1e6).toFixed(1)} MB in ${lp.files} files, ${(lp.ms / 1000).toFixed(1)} s`);
    this._setState('briefing');
    this.hud?.onMissionLoaded?.(world, def);
    this.events.emit('mission:loaded', { mission: def, world });
    return world;
  }

  /** Spawn commandos (with BEL first-aid kit rule), enemies and vehicles from the mission def. */
  _spawnUnits(world, def) {
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
      world.add(new Commando(s));
    }
    for (const spawn of def.enemies || []) world.add(new Enemy(spawn));
    const Vehicle = pick(VehicleMod, 'Vehicle', 'default');
    const createVehicle = pick(VehicleMod, 'createVehicle');
    world.vehicleFactory = (spawn) => (createVehicle ? createVehicle(spawn) : new Vehicle(spawn));
    for (const spawn of def.vehicles || []) {
      safe(() => world.spawnVehicle(spawn.vehicleType || 'truck', spawn), 'vehicle');
    }
  }

  /** Dispose the current world and all per-mission render objects. */
  unloadMission() {
    safe(() => this.cones?.dispose?.(), 'cones dispose');
    this.cones = null;
    this.selection.detach();
    this._queue = [];
    if (this.world) {
      safe(() => this.mapHandle?.dispose?.(), 'map dispose');
      safe(() => this.world.fx?.dispose?.(), 'fx dispose');
      this.world.dispose();
      safe(() => releaseCharacters(), 'characters dispose');
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
    w.alarm?.update(dt);
    const res = checkObjectives(w);
    safe(() => updateExtractionVehicle(w, (this._endFlags ||= {})), 'extraction'); // §7.6 scripted escape vehicle
    safe(() => w.fx?.update?.(dt), 'fx');
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
    if (w.commandos.length && alive.every(jailed)) return { code: 'allLost', reason: 'ALL YOUR MEN HAVE DIED OR HAVE BEEN CAPTURED.' };
    if (CONFIG.mission.failOnCommandoDeath && w.commandos.some((c) => c.alive === false)) return { code: 'died', reason: 'ONE OR MORE OF YOUR MEN DIED…' };
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
      if (ex) {
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

  /** One displayed frame: accumulate sim ticks (unless manualTick), then render. */
  frame(dt) {
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
    this.render(dt, alpha);
  }

  /**
   * Draw a frame: interpolated entity transforms, camera, cones, overlays, HUD. Never advances the sim.
   * @param {number} [dt] real frame delta (visual animation)
   * @param {number} [alpha] interpolation factor between the previous and current tick
   */
  render(dt = 0, alpha = 1) {
    const w = this.world;
    const animDt = this.state === 'playing' ? dt : 0;
    // §6.8: faithful pause freezes scrolling (arrows, edge, middle-drag); the ⚑ active-pause option allows it.
    this.cameraRig.panLocked = this.state === 'paused' && !this.options.activePause;
    this.cameraRig.update(dt);
    if (w) {
      const cc0 = this.cameraController;
      // step 4w: publish the wind at the interpolated SIM time (frozen while paused, deterministic) before anything samples it
      if (w.wind) safe(() => w.wind.frame(Math.max(0, w.time - (1 - Math.min(1, alpha)) * CONFIG.sim.dt), cc0.target), 'wind');
      const rig = this.cameraRig, cam = (rig.count ?? 1) > 1 ? false : rig.active?.camera || this.renderer.camera;
      safe(() => charactersFrame(cam, cc0.pxPerMeter?.() ?? 40), 'characters view'); // LOD + off-screen culling/throttling
      for (const e of w.entities) {
        e.syncTransform?.(alpha);
        e.renderUpdate?.(animDt);
      }
      safe(() => this.mapHandle?.frame?.(animDt, this.renderer.camera), 'terrain frame'); // trails, grass, trees
      this._updateCones();
      this.renderer.fitShadowToView?.(this.cameraRig);
      const cc = this.cameraController;
      safe(() => this.audio?.update?.(cc.target.x, cc.target.z, 2 * (cc.viewHalfExtents?.().x || 20)), 'audio'); // §9 listener = view centre, maxDistance ∝ view width
    }
    if (w?.fx) safe(() => w.fx.frame?.(), 'fx frame'); // VFX sort/upload, lights, decals (sim runs in step())
    this.selection.update(dt);
    this.input.update?.(dt);
    // world matrices once per frame, not once per render pass (main, GTAO normals, x-ray, water, …): with 46 skinned
    // characters (~100 nodes each) the per-pass scene.updateMatrixWorld was the single largest CPU cost
    const scene = this.renderer.scene, autoMW = scene.matrixWorldAutoUpdate;
    scene.updateMatrixWorld();
    scene.matrixWorldAutoUpdate = false;
    try { this.cameraRig.render(this.renderer, dt); } finally { scene.matrixWorldAutoUpdate = autoMW; }
    safe(() => this.hud?.update?.(dt), 'hud');
  }

  // ------------------------------------------------------------ vision cones

  /** Toggle an enemy's vision-cone display (BEL: click an enemy / eye button). */
  toggleCone(enemy, on = !enemy.coneVisible) {
    if (!enemy) return;
    enemy.coneVisible = !!on;
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
    safe(() => this.cones?.setProbe?.(x, z), 'probe-ring');
    const e = safe(() => probeCone(w, x, z), 'probe');
    this.showOnlyCone(e || null);
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
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('beforeunload', this._onUnload);
    safe(() => this.hud?.dispose?.(), 'hud');
    this.selection.dispose();
    this.input.dispose?.();
    this.cameraRig.dispose();
    this.flow?.dispose?.();
    this.renderer.dispose?.();
  }
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
