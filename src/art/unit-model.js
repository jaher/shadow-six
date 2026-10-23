/**
 * Unit models: the realistic character library (art/humanoid-real.js) behind the ARCHITECTURE model contract that
 * Unit uses (root, setAnim, update(dt, unit), setColors, setDisguise, dispose), with the placeholder capsule
 * (art/humanoid.js) as the fallback when the library is disabled (`?chars=0`), not loaded (node tests, load failure,
 * timeout) or a character fails to build.
 *
 *   await prepareCharacters(missionDef);        // game.loadMission: library + squad-aware enemy looks
 *   const m = createUnitModel({ faction, role, soldierType, spawnId, squad, x, z, guestId });
 *   charactersFrame(camera, zoom);              // once per rendered frame: LOD by zoom + off-screen throttling
 *
 * Per model: gameplay names map to clips (unit-anim-map.js: prone deaths, syringe, dig, change_clothes, cut_wire,
 * set_trap, sniper kneel_shoot, enemy body-check kneel, dog clips), locomotion playback follows the MEASURED ground
 * speed of the rendered root (no foot sliding at any speedMul / vel), commandos swap the weapon prop per action.
 * @module art/unit-model
 */
import { MeshDepthMaterial, Object3D, Matrix4, Vector3, Quaternion, BufferAttribute, LoopOnce } from 'three';
import { applyClothWind } from './cloth-wind.js';
import { createHumanoid } from './humanoid.js';
import { CONFIG } from '../config.js';
import * as HR from './humanoid-real.js';
import { idleWarm } from '../engine/idle-warm.js';
import { GROUND_CLIPS } from './characters/commandos_b/ground.js';
import { GROUND_CLIPS as GUEST_GROUND_CLIPS } from './characters/guests/ground.js';
import { applyRagdollPose, rememberIdle, captureBase, lyingBase } from './ragdoll-pose.js';
import { liveView } from '../physics/ragdoll.js';
import { mapAnim, LOCOMOTION, actionWeapon, CARRY_WEAPON, lookType, guestCharacter, missionNumber, chargeProp } from './unit-anim-map.js';
import { transportState, transportClip, poseTransported, captureStart, groundDraggedLegs, dragGroundWeight, localOf, localRot, setBody } from './transport-pose.js';
import { carrierContact, loadSway, loadGait } from './transport-contact.js';
import { BoneGuard, StickyGuard, capturePose, mixPose } from './pose-blend.js';
import { proneGround, PRONE_CLIP } from './prone-ground.js';
import { restOnGround, corpseGround, warmCorpse, CORPSE_BONES } from './corpse-ground.js';
import { turnStep } from './turn-step.js';
import { stairGait, stairGround, stairStep, rampGround } from './stair-gait.js';
import { ladderClimb, ladderEndShift } from './ladder-climb.js';
import { climbPlanOf } from './wall-climb.js';
import { railArms } from './rail-arms.js';
import { steepLadder } from '../entities/stair-walk.js';
import { swimFrame, wadeOffset, waterColumn } from './swim-pose.js';
import { due, runSync } from '../engine/slice.js';
import { earlyFetch } from '../engine/early-fetch.js';

const PRONE_SHOT = /^prone_(shoot|shoot_smg|pistol_shoot)$/;
/** The Spy's pending orders whose action blends in from the last pose shown (art/spy-actions.js). */
const PRE_POSE = new Set(['syringe', 'use']);
/** s: a lying ragdoll's takeover eases the pose on screen (end of the fall, of a put-down) into the ragdoll's — as
 *  long as the kits cross-fade die → dead. */
const SETTLE_EASE = 0.35;
/** Stance transitions play over exactly the sim's stance-change time (CONFIG.units.stanceDown / stanceUp). */
const transitionTime = (tr) => (tr === 'go_prone' ? CONFIG.units.stanceDown : CONFIG.units.stanceUp);
const TR_CLIP = /^(go_prone|get_up)$/;
/** world/grid.js T.WATER, T.SHALLOW: a body in the water floats. */
const WATER_CODES = [5, 6];
/** ms of corpse solves per rendered frame (art/corpse-ground.js; ~0.5 ms each while a ragdoll moves); frames a body
 *  may keep its last solve's corrections while over it. */
const CORPSE_BUDGET_MS = 1.5, CORPSE_STALE = 6, CORPSE_BUDGET = { frame: -1, ms: 0 };
/** s after death: the death clip (no ragdoll) is laid on the ground from here, eased in over CORPSE_REST_EASE s. */
const CORPSE_REST_AT = 1.2, CORPSE_REST_EASE = 0.35;

const ctx = { ready: false, missionId: null, missionNo: 0, theater: 'temperate' };
/** Rendered-frame counter (charactersFrame): a character whose subtree matrices are current for this frame is
 *  skipped by every later scene.updateMatrixWorld of the frame (water mirror, render passes). */
const FRAME = { n: 0 };
const baseUpdateMW = Object3D.prototype.updateMatrixWorld;
/** Base px per metre of the game camera at zoom 1 (manifest.lodRule). */
export const PX_PER_METRE = 40;

/** False with `?chars=0` in the page URL. */
export function charactersEnabled() {
  try { return !/[?&]chars=0(&|$)/.test(globalThis.location?.search || ''); } catch { return true; }
}

/** Current character context (tests / debug). */
export function characterContext() { return { ...ctx }; }

const squadId = (s) => (s.squad && typeof s.squad === 'object' ? s.squad.id ?? null : s.squad ?? null);

/**
 * Load the character library and assign this mission's enemy looks. Units created afterwards get real bodies;
 * on failure (or `?chars=0`) they keep the placeholder.
 * @param {object} def normalized mission def
 * @param {{timeoutMs?:number}} [o]
 * @returns {Promise<boolean>} true when real characters are active
 */
export async function prepareCharacters(def, { timeoutMs = 20000 } = {}) {
  ctx.ready = false;
  if (!def || !charactersEnabled()) return false;
  ctx.missionId = def.id ?? 'm'; ctx.missionNo = missionNumber(def.id); ctx.theater = def.theater || 'temperate';
  let timer;
  try {
    await Promise.race([HR.loadCharacterLibrary(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('character library timeout')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
  const spawns = (def.enemies || []).filter((e) => e.soldierType !== 'dog' && e.id != null)
    .map((e) => ({ id: String(e.id), soldierType: lookType(e, ctx.theater, ctx.missionId), x: e.x || 0, z: e.z || 0, squad: squadId(e) }));
  HR.assignEnemyLooks(ctx.missionId, spawns);
  // the men's body GLBs download now, while the map builds (engine/early-fetch.js): the units stage builds them later
  earlyFetch(HR.missionCharacterUrls(ctx.missionId, { roles: (def.commandos || []).map((c) => c.role).filter(Boolean), mission: ctx.missionNo }));
  ctx.ready = true;
  return true;
}

/** Stop creating real characters (mission unloaded) and drop every live one. */
export function releaseCharacters() { ctx.ready = false; AHEAD.clear(); HR.disposeAllCharacters?.(); }

/**
 * Bodies built ahead for men the simulation will only spawn later — a barracks' reinforcements (ai/alarm.js
 * `${barracks}#${k}.${gen}.${i}`): built on a still screen (engine/idle-warm.js), taken by createUnitModel when the
 * man appears instead of being built in the tick that spawns him (M3's bunker blast: ~20 ms of the tick). The same
 * body either way: everything it is made of follows from the spawn id (variant, jitter, kit), nothing from the moment.
 */
const AHEAD = new Map();
const aheadKey = (o) => (o.faction === 'enemy' && o.spawnId != null && !o.colors && !o.variantId ? `${o.spawnId}|${o.soldierType}|${o.squad ?? ''}` : null);
export function buildAhead(opts) {
  if (!ctx.ready || !HR.characterLibrary()) return;
  const o = { faction: 'enemy', ...opts }, k = aheadKey(o);
  if (!k || AHEAD.has(k)) return;
  try { AHEAD.set(k, HR.createRealHumanoid(realOpts(o))); } catch (e) { console.warn('[unit-model] build ahead', e); }
}

/** Queue (idle-warm) the bodies of every barracks squad's first release (gen 0), within each pool. */
export function queueAheadModels(world) {
  let n = 0;
  for (const b of Object.values(world?.alarm?.barracks || {})) {
    let pool = b.pool ?? 0;
    for (const s of b.squads || []) {
      const m = Math.min(s.size ?? 0, pool);
      pool -= m;
      const squadId = `${b.id}#${s.k}`;
      for (let i = 0; i < m; i++) {
        const spawnId = `${squadId}.${s.gen ?? 0}.${i}`, soldierType = i === 0 ? 'sergeant' : 'trooper';
        idleWarm.add(`ahead ${spawnId}`, () => buildAhead({ soldierType, spawnId, squad: squadId }));
        n++;
      }
    }
  }
  return n;
}

/** Wait (bounded) until every unit's body is built so the mission does not start with pop-ins. */
export async function awaitUnitModels(units, ms = 15000) {
  const all = Promise.all(units.map((u) => u.model?.ready).filter(Boolean));
  let timer;
  await Promise.race([all, new Promise((ok) => { timer = setTimeout(ok, ms); })]);
  clearTimeout(timer);
}

/** Clips whose grounding is computed lazily on first use (runtime ground curves): done once at load instead. */
const WARM_CLIPS = ['idle', 'walk', 'run', 'die', 'dead', 'die_prone', 'dead_prone', 'crawl', 'crawl_idle', 'kneel_shoot',
  'aim', 'shoot', 'crouch_idle', 'carried'];

/**
 * Precompute every body's per-clip grounding (runtime caches, per template / variant) behind the loading screen, so a
 * squad switching to run/aim or the first death in combat does not stall a frame. Bounded by `budgetMs`.
 * @returns {number} ms spent
 */
export function warmUnitModels(units, budgetMs = 1200) { return runSync(warmUnitModelsG(units, budgetMs)); }

/**
 * warmUnitModels() as a sliced job (engine/slice.js): one clip (or one corpse template) at a time, pausing when the
 * slice is used. The budgets count the work only (not the pauses): the same warming as one straight run.
 * @returns {Generator<void, number>} ms of work
 */
export function* warmUnitModelsG(units, budgetMs = 1200) {
  let work = 0;
  const timed = (fn) => { const t = performance.now(); try { fn(); } finally { work += performance.now() - t; } };
  for (const u of units) {
    if (work > budgetMs) break;
    const R = u.model?.real, H = R?.inner;
    if (!H) continue;
    // prone clips are fitted per body (prone-fit.js, 20-80 ms each): warm them for the squad, lazily for the Germans
    const names = u.faction === 'player' ? WARM_CLIPS : WARM_CLIPS.filter((n) => !PRONE_CLIP.test(n));
    for (const n of names) {
      let failed = false;
      timed(() => { try { if (H.warmGround) H.warmGround([n]); else R.hasAnim(n); } catch (e) { failed = true; console.warn('[unit-model] warm', e); } });
      if (failed) break; // (as before: an error ends this unit's warm-up)
      if (due()) yield;
    }
  }
  // the belt kit and the samples a corpse is laid on the ground with (art/corpse-ground.js): once per template
  // (5-60 ms), not at the first death of each in combat
  const w1 = work;
  for (const u of units) {
    if (work - w1 > budgetMs / 2) break;
    timed(() => { try { if (u.model?.real?.inner && !u.model.dog) warmCorpse(u.model); } catch (e) { console.warn('[unit-model] warm corpse', e); } });
    if (due()) yield;
  }
  return work;
}

/** Clips whose first use fits them to the body (prone-fit.js) or grounds them (ground.js): 5–40 ms each — by their meta,
 * and, in the runtimes that ground a clip by its name (commandos_b, guests: charkit `GROUND_CLIPS`), by name too: the
 * Sapper's cut_wire / plant / set_trap, a knife's stab, a dig were left out and grounded mid-play (M3 t≈1520.9: the
 * cutters' first use, ~20 ms in a tick). */
const BY_NAME = { commandos_b: GROUND_CLIPS, guests: GUEST_GROUND_CLIPS };
const FITTED = (m, name, runtime) => !!((m && (m.prone || m.paths || m.ground)) || BY_NAME[runtime]?.has(name));
/** Clips seen first mid-play (M3's walkthrough): played early, so warmed first. */
const EARLY_CLIPS = ['go_prone', 'crawl_idle_unarmed', 'crawl_unarmed', 'crawl_idle', 'crawl', 'prone_turn_r', 'prone_turn_l', 'get_up',
  'set_trap', 'cut_wire', 'take_charge', 'plant', 'prone_shoot', 'prone_aim', 'crawl_knife'];

/**
 * Queue (engine/idle-warm.js) the clip work warmUnitModels leaves to first use: every fitted / grounded clip of the
 * squad's bodies (the prone set, the Sapper's plant / set_trap / cut_wire: 20–40 ms each, a frame each mid-play) and
 * the Germans' prone death clips, one task per clip and body template. Run on still screens (the walkthrough's cards);
 * what is left fills lazily at first use, as before. Pure cache fills: the poses are the same either way.
 */
export function queueIdleWarm(units) {
  const L = HR.characterLibrary?.();
  if (!L) return 0;
  const seen = new Set();
  let n = 0;
  const add = (R, name, label) => {
    const k = `${R.characterId}|${name}`;
    if (seen.has(k)) return;
    seen.add(k);
    idleWarm.add(label, () => R.hasAnim(name));
    n++;
  };
  // (the squad's clips in the order play first needs them — EARLY_CLIPS for every man before the rest for any — then
  // the Germans' prone deaths)
  const squad = [];
  for (const u of units) {
    const R = u.model?.real;
    if (!R?.inner || u.model?.dog) continue;
    const lib = L.rt?.[R.entry?.runtime]?.lib;
    if (!lib?.clips) continue;
    if (u.faction === 'player') {
      for (const nm of lib.clips.keys()) if (FITTED(lib.meta?.[nm], nm, R.entry?.runtime)) squad.push([EARLY_CLIPS.indexOf(nm) + 1 || 99, R, nm, `${u.role || u.id} ${nm}`]);
    }
  }
  squad.sort((a, b) => a[0] - b[0]); // (stable: the men in their order within a rank)
  // the squad's early clips, then the Germans' fitted deaths (M3's first knife kill, t 217: a 7.5 ms fit inside its
  // tick when the title card was left before the queue reached them), then the rest of the squad's clips
  const early = squad.filter((q) => q[0] < 99), rest = squad.filter((q) => q[0] >= 99);
  for (const [, R, nm, label] of early) add(R, nm, label);
  for (const u of units) {
    const R = u.model?.real;
    if (!R?.inner || u.model?.dog || u.faction === 'player') continue;
    const lib = L.rt?.[R.entry?.runtime]?.lib;
    if (!lib?.clips) continue;
    for (const nm of ['die_prone', 'dead_prone']) if (lib.clips.has(nm)) add(R, nm, `${R.characterId} ${nm}`);
    for (const nm of lib.clips.keys()) if (/^(die|dead)/.test(nm) && FITTED(lib.meta?.[nm], nm, R.entry?.runtime)) add(R, nm, `${R.characterId} ${nm}`);
  }
  for (const [, R, nm, label] of rest) add(R, nm, label);
  return n;
}

/**
 * Per-frame view update shared by every character: frustum (off-screen throttling) + LOD from the camera zoom.
 * @param {import('three').Camera|false} camera the view camera; false when several views are drawn (no culling)
 * @param {number} [pxPerMetre] CSS px per metre of the game camera (40 × zoom)
 */
export function charactersFrame(camera, pxPerMetre = PX_PER_METRE) {
  FRAME.n++;
  if (!HR.characterLibrary()) return;
  HR.setCharacterView({ camera, pxPerMetre: Math.round(pxPerMetre) });
}

function realOpts(o) {
  if (o.faction === 'enemy') {
    const soldierType = o.soldierType === 'dog' ? 'dog' : lookType({ id: o.spawnId, soldierType: o.soldierType }, ctx.theater, ctx.missionId);
    return { faction: 'enemy', soldierType, missionId: ctx.missionId, spawnId: o.spawnId != null ? String(o.spawnId) : undefined,
      squad: o.squad ?? null, x: o.x || 0, z: o.z || 0 };
  }
  if (o.role === 'guest') return { faction: 'neutral', id: guestCharacter(o.guestId), weapon: null };
  return { faction: 'player', role: o.role || 'greenberet', mission: ctx.missionNo, weapon: CARRY_WEAPON[o.role] ?? undefined };
}

/**
 * Model for a Unit: real character when the library is ready, else the placeholder capsule.
 * @param {{faction?:string, role?:string, soldierType?:string, spawnId?:string, squad?:string, x?:number, z?:number,
 *   guestId?:string, colors?:object}} opts
 */
export function createUnitModel(opts = {}) {
  if (!ctx.ready || !HR.characterLibrary()) return createHumanoid(opts);
  const k = aheadKey(opts), pre = k && AHEAD.get(k);
  if (pre) { AHEAD.delete(k); return new UnitModel(pre, opts); }
  try { return new UnitModel(HR.createRealHumanoid(realOpts(opts)), opts); } catch (e) {
    console.warn('[unit-model] real character failed, placeholder used', e);
    return createHumanoid(opts);
  }
}

const _rq = new Quaternion(), _bq = new Quaternion(), _bq2 = new Quaternion(), _bq3 = new Quaternion(), _bq3b = new Quaternion(), _v1 = new Vector3(), _v2 = new Vector3();
const _tgq = new Quaternion(), _tgp = new Vector3(), _tgx = new Vector3(1, 0, 0);   // transition ground guard temps
const SPEED_SEND = 0.04;   // re-time the gait when the measured speed moved by > 4 %
/**
 * A shot on the move (§3.2, Unit.playAction keeps the legs stepping): the action clip's arms, chest and head are layered
 * over the walk / run — upper-body tracks only, at UPPER_W against the gait's weight 1 (~95 %), faded in / out.
 */
const UPPER_BONES = /^(spine_0[23]|neck_01|head|clavicle_|upperarm_|lowerarm_|hand_|thumb_|index_|middle_|ring_|pinky_)/i;
const UPPER_W = 20;
/** One shadow-depth material for every skinned character mesh: three's shared depth material would otherwise flip
 *  between skinned and static programs at every character in the shadow pass (program-parameter churn). */
let SKIN_DEPTH = null;
const TINY_EXTRA = 400;   // static kit pieces under this many triangles cast no shadow (canteens, pouches, badges)

function prepareMeshes(root) {
  SKIN_DEPTH ||= new MeshDepthMaterial();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.isSkinnedMesh) o.userData.noXray = true;   // x-ray shows the body silhouette only (post-passes XRayPass)
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const cut = mat && mat.alphaTest > 0;
    const tris = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position?.count || 0) / 3;
    o.receiveShadow = true;
    if (o.isSkinnedMesh) { o.castShadow = !cut; if (!cut) o.customDepthMaterial = SKIN_DEPTH; }
    if (o.isSkinnedMesh && o.geometry.attributes._mask) applyClothWind(o, (a) => new BufferAttribute(a, 2)); // step 4w
    else o.castShadow = /^weapon_|^prop_/.test(o.name) || tris >= TINY_EXTRA;
  });
}

/** Transported men posed this frame (UnitModel.update queues them; transportFrame() poses them after every update). */
const PENDING = new Set();

/**
 * Pose every transported man queued this frame (bodies-design §C.10), after every model's own update so both the
 * load and the transporter are in this frame's pose: the load's paired track / hold, its secondary motion, the
 * transporter's hands on the load. Game.render calls it once per frame after the entity loop.
 */
export function transportFrame() {
  for (const m of PENDING) m._transportPost();
  PENDING.clear();
}

/** Real character behind the Unit model contract. */
export class UnitModel {
  constructor(real, opts) {
    this.real = real; this.opts = opts; this.root = real.root; this.object = real.root;
    this.characterId = real.characterId; this.isReal = true; this.fallback = null;
    this.root.userData.reflectCull = true;   // water mirror render skips it when far from every water body
    // ~100 nodes per character: its own update() refreshes the subtree once per frame (and only when the pose or the
    // root moved); the scene-wide updates of the same frame skip it (the parent is the static scene)
    const root = this.root; this._mw = new Matrix4(); this._mwValid = false;
    root.updateMatrixWorld = function (force) {
      if (this._mwTok === FRAME.n && this.parent && this.parent.isScene) return;
      baseUpdateMW.call(this, force);
    };
    this.dog = real.entry?.group === 'dogs';
    this.player = opts.faction === 'player' && opts.role !== 'guest';
    /** The Marine: swims and dives (art/swim-pose.js poses him in the water; his wetsuit body while he is in it). */
    this.swimmer = this.player && opts.role === 'diver';
    this.anim = 'idle'; this.clip = null; this.disguised = false; this.unit = null;
    this._o = {}; this._v = 0; this._sent = 0; this._last = null; this._idleN = 0; this._weapon = undefined; this._carried = false; this._stance = 'stand';
    this._guard = new BoneGuard(); this._rdGuard = new StickyGuard(); this._blend = null;
    this._guardWriter = { before: (b) => this._guard.touch(b), after() {} };
    /** Optional procedural pose written after the mixer: (model, dt, guard) => pose changed (art/shovel-dig.js). */
    this.overlay = null;
    this.ready = real.ready.then(() => this._onReady());
  }

  /** Root matrix of this frame before the runtime solves IK / grounding in world space (the scene updates the rest). */
  /** Shift the root off a ladder link's end that lies in the ladder's way / against its wall (view only). */
  _ladderEnd(u) {
    const w = u.world;
    if (!w?.ladderFrames?.size || u.alive === false || u.vehicle || u.state === 'inVehicle' || u.state === 'carried' || u.carriedBy || u.stance === 'swim' || u.stance === 'dive') { this._lEnd = null; return; }
    const sh = ladderEndShift(w, u.x, u.y ?? 0, u.z);
    this._lEnd = sh;
    if (sh) { this.root.position.x += sh.x; this.root.position.z += sh.z; }
  }

  _rootMatrix() {
    const r = this.root; r.updateMatrix();
    if (r.parent) r.matrixWorld.multiplyMatrices(r.parent.matrixWorld, r.matrix); else r.matrixWorld.copy(r.matrix);
  }

  _onReady() {
    const R = this.real;
    if (!R.inner) {   // body failed to build → placeholder inside the same root
      this.isReal = false;
      delete this.root.updateMatrixWorld;   // placeholder: plain three.js matrix updates
      this.fallback = createHumanoid(this.opts);
      this.root.add(this.fallback.root);
      this.fallback.setAnim(this.anim, this._o);
      this.fallback.setDisguise?.(this.disguised);
      return this;
    }
    prepareMeshes(R.root);
    if (this.dog && R.inner.footfallsMeasured) this.pawFalls = [];   // its prints come from its paws (_footfalls)
    if (this.opts.role === 'sapper') for (const p of ['time_bomb', 'remote_bomb', 'mills_bomb', 'wire_cutters']) R.equipProp(p);
    this._weapon = undefined;
    this._apply(true);
    return this;
  }

  _ctx() {
    const u = this.unit;
    const st = this.dog ? null : transportState(u);
    const c = { dog: this.dog, faction: this.opts.faction, role: this.opts.role, actionId: u?.currentActionId ?? null,
      stance: u?.stance ?? 'stand', carried: u?.state === 'carried', tool: u?.readyTool ?? (u?.pendingAbility?.def?.id === 'knife' ? 'knife' : null), load: st ? transportClip(st) : null,
      mounted: !!u?._mgManned,   // at a platform MG (render/mg-mount.js): kneeling behind it
      waterLayer: this.swimmer,   // the Marine's swim / dive poses (art/swim-pose.js)
      wallPose: !this.dog && !!(u?._climb && climbPlanOf(u)) };   // a wall climb posed on the face (art/wall-climb.js): the mantle clip not under it
    c.weapon = this._wantWeapon(c);   // prone clips follow the carry class of the weapon in hand (unit-anim-map proneAnim)
    return c;
  }

  /** Weapon prop the unit shows for the current gameplay anim (commandos: carry / action weapon; others: their own). */
  _wantWeapon(c) {
    if (!this.player) return this.real.inner?.weaponName || null;
    const idle = (this.anim === 'idle' || LOCOMOTION.has(this.anim) || this.anim === 'crawl_idle') && !this._upName;
    // crawling with the knife selected (Green Beret, knife cursor up) or crawling in on a knife order: crawl_knife, the knife in the fist
    // a knife order keeps the knife in the fist from the crawl-in through getting up and the last steps to the stab
    // …and a contact knife kill keeps it in his fist while his hands come off the victim (art/knife-kill.js)
    const knifeIn = (c.tool === 'knife' && (c.stance === 'crawl' || this.unit?.pendingAbility?.def?.id === 'knife')) || this._knifeShow;
    let want = idle ? (knifeIn ? 'knife' : null) : actionWeapon(this.opts.role, c.actionId);
    if (want === null) want = CARRY_WEAPON[this.opts.role] || false;
    // bodies-design §C.10: both hands on the load (slung weapon), none while down or carried
    const u = this.unit;
    if (u && ((u.carrying && u.carrying.kind !== 'interactable') || u.downed || u.state === 'carried' || u.pendingTransport)) want = false;
    if (this.overlay) want = false; // a procedural overlay has his hands (the shovel: art/shovel-dig.js re-checks when it ends)
    if (u?._ladder && steepLadder(u._ladder.link)) want = false; // both hands on the rungs (art/ladder-climb.js), the weapon slung
    if (u?._climb && climbPlanOf(u)) want = false; // (both hands on the wall he climbs: art/wall-climb.js)
    return want;
  }

  /**
   * Upper-body action layer while a shot on the move plays (Unit._animOverride.walked): the shoot / aim clip's upper
   * body over the stepping legs; faded out when the shot ends or he stops (the full action clip takes over then).
   */
  _upperLayer() {
    const u = this.unit, inner = this.real.inner, o = u?._animOverride;
    const want = inner?.mixer && inner.clip && !this.dog && o?.walked && o.t > 0 && (u.stance ?? 'stand') === 'stand'
      && LOCOMOTION.has(this.anim) ? o.name : null;
    if (want === (this._upName ?? null)) return;
    if (this._upAct) this._upAct.fadeOut(0.12);
    this._upAct = null; this._upName = want;
    if (want) {
      const c = this._ctx();
      const name = mapAnim(want, { ...c, stance: 'stand' }).find((n) => this.real.hasAnim(n));
      const src = name ? inner.clip(name) : null;
      if (src) {
        const cache = inner._upperClips || (inner._upperClips = new Map());
        let clip = cache.get(name);
        if (!clip) {
          clip = src.clone(); clip.name = `${name}:upper`;
          clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') && UPPER_BONES.test(t.name.slice(0, t.name.lastIndexOf('.')).split(/[/:]/).pop()));
          cache.set(name, clip);
        }
        if (clip.tracks.length) {
          const a = inner.mixer.clipAction(clip);
          a.reset(); a.setLoop(LoopOnce, 1); a.clampWhenFinished = true;
          a.setEffectiveWeight(UPPER_W); a.fadeIn(0.1); a.play();
          this._upAct = a;
        }
      }
    }
    this._weapon = undefined; this._weaponFor(this._ctx());   // the action's weapon in hand while the layer shows
  }

  /** Nominal gameplay speed (m/s) of the unit right now. */
  _nominal() { const u = this.unit; return u && typeof u.speed === 'number' ? u.speed : null; }

  _apply(restart = false, instant = false) {
    const R = this.real, c = this._ctx();
    this._carried = c.carried; this._stance = c.stance; this._load = c.load; this._mounted = c.mounted;
    const cands = mapAnim(this.anim, c);
    const clip = R.inner ? (cands.find((n) => R.hasAnim(n)) || 'idle') : cands[0];
    const o = { loop: this._o.loop ?? (this.anim !== 'die'), restart };
    if (instant) o.fade = 0; // a transport pose hands over: the posed bones already show the new clip's pose
    if (LOCOMOTION.has(this.anim)) {
      const v = this._nominal();
      if (v) { o.moveSpeed = v; this._v = v; this._sent = v; }
    }
    const prev = this.clip;
    if (prev !== clip) { this._clipPrev = prev; this._clipAt = this.unit?.world?.time ?? 0; } // (art/ladder-climb.js: what played before a climb's walk)
    this.clip = clip; this._turnClip = null;
    this._mwValid = false;
    // standing <-> prone through go_prone / get_up (0.5 / 0.6 s) for runtimes that do not do it themselves
    // (commandos_b, enemies; commandos_a and guests queue their own transition clips)
    const inner = R.inner, wasP = PRONE_CLIP.test(prev || ''), isP = PRONE_CLIP.test(clip);
    const tr = inner && !inner.ownTransitions && this._shown && prev && wasP !== isP && !c.carried
      && !/^(die|dead)/.test(clip) && !/^(die|dead)/.test(prev) ? (isP ? 'go_prone' : 'get_up') : null;
    if (inner && !inner.trDur) inner.trDur = { go_prone: transitionTime('go_prone'), get_up: transitionTime('get_up') };   // own-transition runtimes retime theirs
    if (tr && R.hasAnim(tr)) {
      const d = inner.clip?.(tr)?.duration ?? (isP ? 0.5 : 0.6), T = transitionTime(tr);
      // go_prone starts on the idle frame: a long fade dipped the toes; played over the sim's stance time exactly
      R.setAnim(tr, { loop: false, restart: true, fade: isP ? 0.08 : 0.1, speed: d / T });
      this._tr = { left: T - 0.08, clip, o };
    } else { this._tr = null; R.setAnim(clip, o); }
    // a prone shot plays to its end (bolt cycle 0.8 s, burst, pistol recover) although the sim's shoot state is
    // shorter (review: prone_shoot was cut after 0.3 s); setAnim defers the follow-up anim until then
    this._shot = inner && PRONE_SHOT.test(clip) ? { left: (inner.clip?.(clip)?.duration ?? 1) - 0.05, next: null } : null;
    this._shown = true;
    if (R.inner) this._weaponFor(c);
  }

  _weaponFor(c) {
    if (!this.player) return;
    const want = c.weapon;
    if (want === this._weapon) return;
    this._weapon = want;
    const w = this.real.setWeapon(want || null);
    if (w && !w.userData.prepared) { w.userData.prepared = true; prepareMeshes(w); }
    // commandos_b (Spy, Sapper, Driver): setWeapon shows the prop; the runtime's hold for the clip playing decides (a
    // pistol stays out of her hand in idle — it showed in her fist after the syringe was put away)
    if (w && this.real.entry?.runtime === 'commandos_b') this.real.inner?.solveWeapon?.(this.real.inner.animClip || this.clip);
  }

  setAnim(name, o = {}) {
    if (this.fallback) { this.anim = name; return this.fallback.setAnim(name, o); }
    if (name === this.anim && !o.restart) return;
    if (this._shot && !(/^(die|dead)/.test(name) || LOCOMOTION.has(name) || name === 'shoot')) { this._shot.next = [name, o]; return; }
    // (a ladder / a wall climb is posed over whatever plays — art/ladder-climb.js: the clip he was playing goes on under
    // it, not restarted on the mantle / idle: a clip cut off there jumped his hands and feet as the pose eased in)
    if ((name === 'climb' || name === 'ladder') && this.clip && this.real?.inner && !this.dog && this.unit
      && ((name === 'ladder' && this.unit._ladder && steepLadder(this.unit._ladder.link)) || (name === 'climb' && this.unit._climb && climbPlanOf(this.unit)))) { this.anim = name; this._o = { ...o, loop: true }; return; }
    this.anim = name; this._o = o;
    this._apply(!!o.restart);
  }

  update(dt, unit) {
    if (unit) this.unit = unit;
    if (this.fallback) { this.fallback.update(dt); return; }
    const R = this.real;
    if (R.inner && this.unit?.alive !== false && (this.unit?.blastReact || this._br)) this._blastReact(this.unit);
    // standing / walking in the water: on the bed under it, not on its surface (art/swim-pose.js)
    if (R.inner && this.unit) wadeOffset(this, this.unit);
    // a ladder link's end in the ladder's way (its foot behind the rungs, against the wall) or against a wall's inner
    // face at the top: whoever stands there is drawn clear of it (art/ladder-climb.js ladderEndShift)
    if (R.inner && this.unit && !this.dog) this._ladderEnd(this.unit);
    // the Marine in the water wears the wetsuit body, whatever he plays there (the harpoon shot, gear on / off)
    if (this.swimmer && this.unit) {
      const u = this.unit, wet = !u.vehicle && u.state !== 'inVehicle' && (u.stance === 'swim' || u.stance === 'dive' || !!u.diving);
      if (wet !== !!this._wet) { this._wet = wet; R.setWet?.(wet ? true : null); }
    }
    this._rootMatrix();
    if (R.inner && this.unit && (this.unit.state === 'carried') !== this._carried) this._apply(false, true);
    else if (R.inner && this.unit && !!this.unit._mgManned !== !!this._mounted) this._apply();   // takes / leaves a platform MG
    else if (R.inner && this.unit && !this.dog) { const st = transportState(this.unit); if ((st ? transportClip(st) : null) !== (this._load ?? null)) this._apply(false, true); }
    // a transporter's hands empty / fill again as the load comes and goes
    if (R.inner && this.player && this.unit && !!(this.unit.carrying && this.unit.carrying.kind !== 'interactable') !== !!this._handsFull) { this._handsFull = !this._handsFull; this._weaponFor(this._ctx()); }
    // the ability's action id is set after its start() played the clip (Commando._updatePending): re-pick the weapon
    // then, so the knife stab shows the knife (not the carry pistol)
    if (R.inner && this.player && this.unit && (this.unit.currentActionId ?? null) !== (this._actId ?? null)) {
      this._actId = this.unit.currentActionId ?? null;
      // which charge (if any) the plant / take clips put in his hand: the one he sets or takes back, none for the trap
      R.inner.chargeProp = chargeProp(this._actId, this.unit.currentActionTarget);
      this._weaponFor(this._ctx());
    }
    // on / off a ladder: the weapon slung / back in hand
    const onLad = !!(this.unit?._ladder && steepLadder(this.unit._ladder.link)) || !!(this.unit?._climb && climbPlanOf(this.unit));
    if (R.inner && this.player && this.unit && onLad !== !!this._onLadder) { this._onLadder = onLad; this._weaponFor(this._ctx()); }
    // the contact knife kill's blend-out (abilities/knife.js sets knifeShow): the knife stays in his fist until it ends
    if (R.inner && this.player && this.unit) {
      const ks = (this.unit.knifeShow ?? -1) > (this.unit.world?.time ?? 0);
      if (ks !== !!this._knifeShow) { this._knifeShow = ks; this._weaponFor(this._ctx()); }
    }
    if (R.inner && dt > 0 && LOCOMOTION.has(this.anim)) {
      const p = this.root.position;
      if (this._last) {
        const nom = this._nominal();
        let d = Math.hypot(p.x - this._last.x, p.z - this._last.z) / dt;
        if (nom) d = Math.min(Math.max(d, nom * 0.4), nom * 1.3);
        this._v += (d - this._v) * Math.min(1, dt * 10);
        if (!this._tr && !this._turnClip && Math.abs(this._v - this._sent) > SPEED_SEND * Math.max(0.3, this._sent)) {
          this._sent = this._v;
          R.setAnim(this.clip, { moveSpeed: this._v });
        }
      } else this._last = { x: 0, z: 0 };
      this._last.x = p.x; this._last.z = p.z;
    } else if (dt > 0 || !LOCOMOTION.has(this.anim)) this._last = null; // (a 0-dt frame — paused, Game.advance's own render — keeps the last sample)
    // bodies-design §C.10 transport visuals: the pose he lay in when the hands take him, or the last transport pose
    // when it ends (both read before the mixer update), then last frame's direct bone writes are put back for the mixer
    const tst = R.inner && this.unit && !this.dog ? transportState(this.unit) : null;
    if (R.inner && tst && !this._carryOn) { this._blend = null; if (tst.kind === 'lift' || tst.kind === 'grab') captureStart(this); }
    if (R.inner && !tst && this._carryOn) this._startBlendOut(this.unit);
    if (this._tr && dt > 0 && (this._tr.left -= dt) <= 0) {   // transition clip done: the requested clip takes over
      const t = this._tr; this._tr = null;
      R.setAnim(t.clip, { ...t.o, fade: 0.1 });
      if (R.inner) this._weaponFor(this._ctx());
    }
    if (this._shot && dt > 0 && (this._shot.left -= dt) <= 0) { const nx = this._shot.next; this._shot = null; if (nx) this.setAnim(nx[0], nx[1]); }
    if (R.inner && this.unit && (this._upName || this.unit._animOverride?.walked)) this._upperLayer();
    this._guard.restore();
    let stepped = R.update(dt);
    const root = this.root, u = this.unit;
    if (tst) { this._carryOn = true; stepped = true; this._tst = tst; this._tstDt = dt; PENDING.add(this); } // posed in transportFrame()
    else if (this._carryOn) { this._carryOn = false; stepped = true; }
    if (this._blend && !tst) stepped = this._blendOutStep(dt, u) || stepped;
    if (R.inner && !this.dog) {
      // physics ragdoll (bodies-design §A.4): the live pose while it flies/settles, then the baked pose
      const rec = u && u.alive === false && u.state === 'dead' && !tst ? (u._rd ? liveView(u._rd) : u.bodyPose) : null;
      if (rec) {
        const now = u.world?.time ?? 0;
        const nudging = rec.n && now - (rec.tn ?? 0) < 0.35;
        const gliding = rec.g && now - (rec.tg ?? 0) < 0.35;
        const fresh = rec !== this._rdLast, easing = !!this._rdFrom;
        if (stepped || rec.live || nudging || gliding || easing || fresh || !this._mwValid) {
          // a ragdoll taking over from a transport pose (knocked off a shoulder: the drape spawn; a blast): its base is
          // the pose he had there
          if (this._blend && fresh && (rec.d || rec.mode === 'blast')) { this._rdBase = captureBase(this); this._rdBaseKey = rec.mode + ':' + rec.a.join(','); this._endBlendOut(); }
          else if (fresh && rec.mode !== 'blast' && !rec.d) this._lyingTakeover(rec, now);
          this._rdLast = rec;
          if (applyRagdollPose(this, rec, now, this._rdGuard)) {
            stepped = true;
            this._restCorpse(this._rdGuard); // laid on the drawn ground (art/corpse-ground.js)
          }
          if (this._rdFrom) stepped = this._easeIntoRagdoll(now) || stepped;
        }
      } else if (this._rdLast) { this._rdLast = null; this._rdBase = null; this._rdFrom = null; this._cgCache = null; this._mwValid = false; this._rdGuard.release(); }
      else if (!this._idleSeen && this.anim === 'idle' && stepped && ++this._idleN > 4) { rememberIdle(this); this._idleSeen = true; }
    }
    // walking in on a knife / syringe order (or up to a clothesline): the pose shown, for the contact kill / the Spy's
    // action to blend from (art/knife-kill.js, art/spy-actions.js; the action clip's first frame would jump)
    const pend = u?.pendingAbility?.def?.id;
    if (R.inner && this.player && stepped && (pend === 'knife' || (u?.role === 'spy' && PRE_POSE.has(pend)) || (u?.role === 'diver' && (pend === 'raft' || pend === 'hand')))) this._preKnife = capturePose(this);
    // procedural action overlay on the skeleton after the mixer (art/shovel-dig.js: digging, rising out of the snow)
    if (R.inner && this.overlay && !tst && !this._rdLast) { try { stepped = this.overlay(this, dt, this._guard) || stepped; } catch (e) { console.warn('[unit-model] overlay', e?.stack || e); this.overlay = null; } }
    // a standing man turning on the spot steps round, head leading; one eased aside steps after his body
    // (art/turn-step.js; SHADOW SIX smooth turn, M3 video "all soldiers should walk in all configurations")
    if (R.inner && !this.dog && !tst && !this._carryOn && !this._rdLast && !this._blend) stepped = turnStep(this, dt, this._guard) || stepped;
    // prone bodies on the real terrain (art/prone-ground.js) — not while transported or in a physics/baked ragdoll pose
    if (R.inner && !this.dog && !tst && !this._carryOn && !this._rdLast && (stepped || this._pg?.active)) stepped = this._prone(dt) || stepped;
    // on a flight of stairs: each foot on a tread, the body rising / sinking tread by tread (art/stair-gait.js); on a
    // ladder: hands and feet on its rungs (art/ladder-climb.js)
    if (R.inner && !this.dog && !tst && !this._carryOn && !this._rdLast && (this._sg || u?.world?.stairs?.size)) stepped = stairGait(this, dt, this._guard) || stepped;
    // a stance transition on a flight: neither _prone (excludes transitions) nor stairGait (locomotion only) owns
    // the body - the transition ground guard keeps the pelvis out of the treads (see _trGuard)
    if (R.inner && !this.dog) stepped = this._trGuard(tst) || stepped;
    if (R.inner && !this.dog && !tst && (this._lc || u?._ladder || u?._climb)) stepped = ladderClimb(this, dt, this._guard) || stepped;
    // on a stair, his arms inside its rails (art/rail-arms.js)
    if (R.inner && !this.dog && !tst && !this._rdLast && u?.world?.grid?.flights?.size) stepped = railArms(this, this._guard) || stepped;
    // the Marine swimming / diving: the procedural water poses (art/swim-pose.js)
    if (R.inner && this.swimmer && !tst && !this._rdLast) stepped = swimFrame(this, dt, this._guard) || stepped;
    // no ragdoll (physics off / failed): the settled death clip, laid on the drawn ground as it eases in after the fall
    // (with physics a settle ragdoll always follows — after the fall, after a put-down — and lays the body down itself)
    if (R.inner && !this.dog && !tst && !this._rdLast && u && u.alive === false && u.state === 'dead' && this.anim === 'dead' && !u.vehicle
      && (!u.world?.physics || u.world.physics.isNull)) {
      const k = Math.min(1, Math.max(0, ((u.world?.time ?? 0) - (u.deathTime ?? 0) - CORPSE_REST_AT) / CORPSE_REST_EASE));
      if (k > 0 && this._restCorpse(this._guardWriter, k)) stepped = true;
    }
    if (stepped || !this._mwValid || !this._mw.equals(root.matrix)) {
      baseUpdateMW.call(root, true);
      this._mw.copy(root.matrix); this._mwValid = true;
    }
    root._mwTok = FRAME.n;
    if (this.pawFalls && R.inner?.takeFootfalls) this._footfalls(R.inner);
    (this._rootPrev ||= root.position.clone()).copy(root.position); // (art/ladder-climb.js: the root's drawn place across a climb's ease in / out)
    this._rootYawPrev = root.rotation.y; // (and its drawn facing)
  }

  /**
   * A dog's footfalls this frame (dogkit measurePawContacts: the touchdowns of the gait clip playing) as world prints
   * for the terrain trails (art/terrain.js stampWorld drains `pawFalls`): {x, z, fore, side, w, l, gait}.
   */
  _footfalls(inner) {
    const q = inner.takeFootfalls();
    if (!q.length) return;
    const m = inner.object.matrixWorld, out = this.pawFalls;
    for (const f of q) {
      _v1.set(f.x, 0, f.z).applyMatrix4(m);
      out.push({ x: _v1.x, z: _v1.z, fore: f.fore, side: f.side, w: f.w, l: f.l, gait: f.gait, paw: f.paw });
    }
    if (out.length > 64) out.splice(0, out.length - 64);
  }

  _body() { return this.real.root.children.find((c) => c.name === 'body') || this.real.root; }

  /**
   * A lying (settle) ragdoll takes over this body: its base is the settled death clip as it lies on the ground (the
   * pose the physics' lying template stands for), not whatever is on screen — the die → dead cross-fade, a put-down —
   * and what is on screen eases into the ragdoll's pose over SETTLE_EASE s. A baked pose shown on a fresh model (a
   * load) gets the same base at once. The same ragdoll live → baked, or a corpse thrown again, keeps its base.
   */
  _lyingTakeover(rec, now) {
    const key = rec.mode + ':' + rec.a.join(',');
    if (this._rdBase && this._rdBaseKey === key) return;
    const c = { ...this._ctx(), carried: false, load: null, mounted: false, stance: rec.prone ? 'crawl' : 'stand' };
    const clip = mapAnim('dead', c).find((n) => this.real.hasAnim(n));
    const base = clip ? lyingBase(this, clip) : null;
    if (!base) return; // no clip: applyRagdollPose captures the pose on screen (as before)
    this._rdFrom = rec.live ? { pose: capturePose(this), t: now } : null;
    if (this._blend) this._endBlendOut();
    this._rdBase = base; this._rdBaseKey = key;
  }

  /** One frame of the ease from the pose on screen at a lying takeover into the ragdoll's. @returns {boolean} */
  _easeIntoRagdoll(now) {
    const F = this._rdFrom, k = Math.min(1, Math.max(0, (now - F.t) / SETTLE_EASE));
    if (k >= 1) { this._rdFrom = null; return false; }
    mixPose(this, F.pose, 1 - k * k * (3 - 2 * k), this._guard);
    return true;
  }

  /**
   * A dead man's drawn body laid on the drawn ground (art/corpse-ground.js: the trunk onto it, the head, arms and legs
   * turned onto it) — not in the water (a body there floats; on a bridge's deck over it, yes). The result is reused while the pose under it does not
   * change (a settled corpse: no work per frame). `k` < 1 eases it in.
   * @param {{before:Function, after:Function}} writer guard around the bone writes @returns {boolean} posed
   */
  _restCorpse(writer, k = 1) {
    const u = this.unit, B = this.real?.inner?.bones;
    if (!u || !B || this.dog || u.vehicle) return false;
    const g = u.world?.grid, t = g?.terrainAt ? g.terrainAt(u.x, u.z) : null;
    const c = (t === WATER_CODES[0] || t === WATER_CODES[1]) && g.worldToCell ? g.worldToCell(u.x, u.z) : null;
    const deck = c && g.inBounds(c.i, c.j) && (g.bridge?.[g.idx(c.i, c.j)] || (g.elev?.[g.idx(c.i, c.j)] || 0) > 0.05);
    if ((c && !deck) || u.underwater || u.swimming) return false; // (on a bridge over the river: laid on its deck)
    // (one ground function per world: the pass keeps its ground lattice while it is the same)
    if (this._cgWorld !== u.world || this._cgWorldGY !== (u.world?.lyingY || u.world?.groundY)) { this._cgWorld = u.world; this._cgWorldGY = u.world?.lyingY || u.world?.groundY; this._cgGround = corpseGround(u); }
    const ground = this._cgGround;
    if (!ground) return false;
    const list = this._cgBones || (this._cgBones = CORPSE_BONES.map((n) => B[n]).filter(Boolean));
    const root = this.root, sig = this._cgSigArr || (this._cgSigArr = new Float64Array(list.length * 7 + 7));
    // the pose this pass starts from: the written bones' local values + the root
    let same = !!this._cgCache && k === this._cgCache.k, j = 0;
    const put = (v) => { if (sig[j] !== v) { same = false; sig[j] = v; } j++; };
    for (const b of list) { put(b.quaternion.x); put(b.quaternion.y); put(b.quaternion.z); put(b.quaternion.w); put(b.position.x); put(b.position.y); put(b.position.z); }
    put(root.position.x); put(root.position.y); put(root.position.z); put(root.quaternion.x); put(root.quaternion.y); put(root.quaternion.z); put(root.quaternion.w);
    if (same && this._cgCache.solved) {
      for (let i = 0; i < list.length; i++) { const b = list[i], c = this._cgCache.v[i]; writer?.before(b); b.quaternion.copy(c.q); b.position.copy(c.p); writer?.after(b); }
      baseUpdateMW.call(root, true);
      return true;
    }
    // a frame budget for the solves (a grenade among a squad: a dozen ragdolls moving at once): over it, a body whose
    // pose moved on since its last solve keeps that solve's corrections (each bone turned / moved by the same amount
    // relative to the new pose), and solves again within a few frames
    const C = this._cgCache, now = FRAME.n;
    if (CORPSE_BUDGET.frame !== now) { CORPSE_BUDGET.frame = now; CORPSE_BUDGET.ms = 0; }
    if (C?.d && k === C.k && CORPSE_BUDGET.ms > CORPSE_BUDGET_MS && now - C.at < CORPSE_STALE) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i], d = C.d[i];
        writer?.before(b); b.quaternion.premultiply(d.q).normalize(); b.position.add(d.p); writer?.after(b);
      }
      C.solved = false; // (the pose under it is not the one solved: a later frame solves it)
      baseUpdateMW.call(root, true);
      return true;
    }
    const t0 = performance.now();
    const raw = list.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
    const pre = k < 1 ? capturePose(this) : null;
    const res = restOnGround(this, ground, writer, this._cgLog || null);
    if (pre) { mixPose(this, pre, 1 - k, null); baseUpdateMW.call(root, true); }
    this._cgCache = { k, at: now, solved: true, v: list.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() })),
      d: list.map((b, i) => ({ q: b.quaternion.clone().multiply(raw[i].q.invert()), p: b.position.clone().sub(raw[i].p) })) };
    CORPSE_BUDGET.ms += performance.now() - t0;
    return !!res;
  }

  /**
   * Prone bodies on the real terrain + prone turning (art/prone-ground.js): slope tilt, elbow / ankle relief, the
   * displayed heading turning at <= 75 deg/s with prone_turn_l / _r while lying still. @returns {boolean} pose changed
   */
  _prone(dt) {
    const R = this.real, inner = R.inner, u = this.unit;
    // not while a stance transition plays (own-transition runtimes report the target clip already)
    const prone = PRONE_CLIP.test(this.clip || '') && !this._tr && !TR_CLIP.test(inner._clipName || inner.animClip || '');
    const st = this._pg || (this._pg = { active: false });
    // (not lying: the shown heading is the sim's — a stale one from the last time he lay down would make the next
    // lie-down start turned that way: b00 Green Beret lying down with his legs in a wagon)
    if (!prone && !st.active) { st.visYaw = null; return false; }
    const w = u?.world, ey = u?.y || 0;
    // a settle turn (Unit._arrive / _guardBody: turned clear of a hull in place) pivots about his hips, as its sweep was
    // checked, not about the chest
    const res = proneGround(st, { root: this.root, body: this._body(), bones: inner.bones, dt, prone, pivot: u?._turnInPlace ? 0 : undefined, done: u?._turnInPlace ? () => { u._turnInPlace = false; } : undefined,
      moving: LOCOMOTION.has(this.anim) && this._v > 0.1, ...this._proneGround(w, u, ey) });
    st.active = res.active;
    const turn = prone && res.turnDir && this.anim === 'crawl_idle' ? (res.turnDir > 0 ? 'prone_turn_l' : 'prone_turn_r') : null;
    if (turn !== this._turnClip && (!turn || R.hasAnim(turn))) {
      this._turnClip = turn;
      R.setAnim(turn || this.clip, { fade: 0.15 });
    }
    return true;
  }

  /**
   * Transition ground guard on flights: while get_up / go_prone plays on a flight, neither _prone (it excludes
   * transitions) nor stairGait (locomotion clips only) owns the body, and the clip can sink the pelvis through the
   * treads (m03 W stair get_up: pelvis -0.31 m vs its tread). While the transition runs, the flight's nosing line
   * (stairGround / rampGround) is a floor for the pelvis: the body group is pitched about the root's lateral axis
   * to lift the pelvis onto the line, or - the pelvis over / behind the root, where pitch cannot lift it - raised
   * outright by what pitch could not cover. Released when the transition ends (stair-gait takes over at locomotion
   * start). Nothing accumulates: last frame's application is restored first when nothing else rewrote the body
   * since, then re-measured and re-applied; the stored application is dropped the frame the conditions stop
   * holding. @param {object|null} tst the transport state of update() (a transported man is not guarded)
   * @returns {boolean} body written
   */
  _trGuard(tst) {
    const R = this.real, inner = R.inner, u = this.unit;
    let wrote = false;
    if (this._trg) {   // undo last frame's application before anything re-measures (never stack a rotation)
      const body = this._body(), st = this._trg; this._trg = null;
      if (body.quaternion.equals(st.q) && body.position.equals(st.p)) { body.quaternion.copy(st.q0); body.position.copy(st.p0); wrote = true; }
    }
    if (!inner || this.dog || tst || this._carryOn || this._rdLast || this._blend || !this._tr || this._wade) return wrote;
    if (!TR_CLIP.test(inner._clipName || inner.animClip || '')) return wrote;
    const sg = stairGround(u) || rampGround(u);
    if (!sg) return wrote;
    const root = this.root, body = this._body(), pelvis = inner.bones?.pelvis;
    if (!pelvis) return wrote;
    baseUpdateMW.call(root, true);
    pelvis.getWorldPosition(_tgp);
    const floorY = sg(_tgp.x, _tgp.z);
    if (floorY == null) return wrote;
    const deficit = floorY - _tgp.y;
    if (deficit <= 0.005) return wrote;
    const h = root.rotation.y;
    const along = (_tgp.x - root.position.x) * Math.sin(h) + (_tgp.z - root.position.z) * Math.cos(h), dy = _tgp.y - root.position.y;
    const cap = sg.maxTilt ?? (40 * Math.PI / 180);
    let th = 0;
    if (along > 0.1) {   // pitch can lift a pelvis ahead of the root: solve along*sin(th) + dy*(cos(th)-1) = deficit
      th = Math.min(cap, Math.max(0, deficit / along));
      for (let i = 0; i < 2; i++) {
        const f = along * Math.sin(th) + dy * (Math.cos(th) - 1) - deficit, fp = along * Math.cos(th) - dy * Math.sin(th);
        if (fp <= 1e-6) break;
        th = Math.min(cap, Math.max(0, th - f / fp));
      }
    }
    const lifted = along * Math.sin(th) + dy * (Math.cos(th) - 1);
    const st = { q0: body.quaternion.clone(), p0: body.position.clone(), q: null, p: null };
    if (th > 0) {   // (prone-ground's pitch convention: a negative rotation about +X raises the +Z forward side)
      _tgq.setFromAxisAngle(_tgx, -th);
      body.quaternion.premultiply(_tgq);
      body.position.applyQuaternion(_tgq);
    }
    if (deficit - lifted > 0) body.position.y += deficit - lifted;   // pitch capped / pelvis over the root: raise the rest outright
    st.q = body.quaternion.clone(); st.p = body.position.clone();
    this._trg = st;
    return true;
  }

  /**
   * Ground under a lying man for prone-ground: the world's (his level + the relief), or on a flight of stairs its
   * nosing line (he lies along the steps' edges, pitched up to the stair's slope: art/stair-gait.js stairGround).
   */
  _proneGround(w, u, ey) {
    if (!w?.groundY) return { groundY: null };
    // lying in the shallows: on the bed under the water, like the root (art/swim-pose.js wadeOffset)
    if (this._wade) return { groundY: (x, z) => { const c = waterColumn(w, x, z); return c ? c.bed : w.groundY(x, z) + ey; } };
    // (on a smooth ramp, the M3 barn's: its slope under him — rampGround)
    const sgS = stairGround(u), sg = sgS || rampGround(u);
    if (!sg) return { groundY: (x, z) => w.groundY(x, z) + ey };
    // (on a flight, its stepped surface too: prone-ground floors the hands / toes on the treads themselves)
    const ss = sgS ? stairStep(u) : null;
    return { groundY: (x, z) => sg(x, z) ?? w.groundY(x, z) + ey, maxTilt: sg.maxTilt, ...(ss ? { stepY: (x, z) => ss(x, z) } : {}) };
  }

  /** Post pass of a transported man (transportFrame): paired track / hold, sway, the transporter's hands. */
  _transportPost() {
    const st = this._tst, u = this.unit;
    this._tst = null;
    if (!st || !this.real.inner || !u) return;
    const root = this.root, body = this._body();
    if (!poseTransported(this, st, this._guard)) return;
    loadGait(this, st, this._tstDt, this._guard); // legs / arms swing with each of the transporter's steps (carry-legs)
    // heels trail on the ground (§C.2), eased in / out of the drag; through the rest of a lift / lower the ankles are
    // only kept out of the snow. Ground level: the transporter's in a transition (the load's y is still 1.2 m up).
    if (st.kind !== 'hold' || st.from === 'drag') {
      const ey = st.kind === 'hold' ? u.y || 0 : st.carrier?.y ?? u.y ?? 0;
      groundDraggedLegs(this, u, this._tstDt, this._guard, dragGroundWeight(st), ey);
    } else this._legLag = null;
    loadSway(this, st, this._tstDt, this._guard);
    baseUpdateMW.call(root, true);
    const cm = st.carrier?.model;
    if (cm?.real?.inner && carrierContact(cm, this, st, cm._guard)) baseUpdateMW.call(cm.root, true);
    const pel = this.real.getSocket('pelvis');
    (this._lastBodyW ||= { p: body.position.clone(), q: body.quaternion.clone() });
    if (pel) { pel.getWorldPosition(this._lastBodyW.p); pel.getWorldQuaternion(this._lastBodyW.q); } else this._lastBodyW = null;
    this._mw.copy(root.matrix); this._mwValid = true;
  }

  /** Transport over: blend from its last pose / placement into the ground pose (a fall when knocked off a shoulder). */
  _startBlendOut(u) {
    const last = this._lastBodyW;
    if (!last) return;
    const dr = u?.carryDrop, fall = !!dr && dr.how === 'shot' && dr.mode !== 'drag' && (u.world?.time ?? 0) - dr.t < 0.5;
    this._blend = { pose: capturePose(this), p: last.p.clone(), q: last.q.clone(), t: 0, dur: fall ? 0.6 : 0.3, fall };
    if (fall) { // he rolls off the right shoulder: a quarter turn about the carrier's forward axis on the way down
      const h = dr.ch ?? u.heading ?? 0;
      this._blend.mid = new Quaternion().setFromAxisAngle(_v1.set(Math.cos(h), 0, Math.sin(h)), -Math.PI / 2).multiply(last.q);
    }
    this._lastBodyW = null;
  }

  /**
   * One frame of the blend-out: the skeleton eases from the last transport pose into the mixer's, and the PELVIS frame
   * (not the body group, whose pelvis bone may be turned round in a 'carried' pose) moves from where it was to where
   * the mixer's pose puts it; a fall accelerates (k²).
   */
  _blendOutStep(dt) {
    const B = this._blend, root = this.root;
    B.t += dt;
    const k = Math.min(1, B.t / B.dur), e = B.fall ? k * k : k * k * (3 - 2 * k);
    root.updateMatrixWorld(true);
    const b = this._body(); b.position.set(0, 0, 0); b.quaternion.identity();
    const plT = localOf(this, 'pelvis', _v1), rpT = localRot(this, 'pelvis', _bq2);
    if (!plT || !rpT) { this._endBlendOut(); return true; }
    root.getWorldQuaternion(_rq);
    _v2.copy(plT).applyQuaternion(_rq).add(root.position); // pelvis target (world)
    _bq.copy(_rq).multiply(rpT);
    // a fall: the pelvis turns and the hips open together (the legs keep hanging while the torso comes round)
    const sm = (a, b0) => { const x = Math.min(1, Math.max(0, (k - a) / (b0 - a))); return x * x * (3 - 2 * x); };
    mixPose(this, B.pose, B.fall ? 1 - sm(0.2, 0.85) : 1 - e, this._guard);
    const pl = localOf(this, 'pelvis', _v1), rp = localRot(this, 'pelvis', _bq3);
    _v2.lerp(B.p, 1 - e);
    _bq3b.copy(_bq);
    if (B.mid) _bq.copy(B.q).slerp(B.mid, sm(0, 0.5)).slerp(_bq3b, sm(0.4, 0.85)); else _bq.copy(B.q).slerp(_bq3b, e);
    setBody(this, _v2, _bq, pl, rp);
    if (k >= 1) this._endBlendOut();
    return true;
  }

  _endBlendOut() {
    this._blend = null;
    const b = this._body(); b.position.set(0, 0, 0); b.quaternion.identity();
  }

  /**
   * Survivor blast reaction (bodies-design §A.5, visual only): flinch = 'hit', stagger = 'knockback', fall = 'die' then
   * 'stand_up'; the root leans off along the impulse (≤ 0.6 m) and blends back. The sim never reads any of it.
   */
  _blastReact(u) {
    const br = u?.blastReact, now = u?.world?.time ?? 0;
    if (!br || now - br.t0 > br.dur) {
      if (this._br) { this._br = null; this._apply(true); }
      if (br && now - br.t0 > br.dur) u.blastReact = null;
      return;
    }
    const t = now - br.t0, k = t / br.dur;
    // a fall: thrown down (the death fall, held at its end while he lies dazed), then gets up over the last 1.2 s
    const up = Math.max(0, br.dur - (CONFIG.physics.survivor.getUp || 1.2));
    const clip = br.kind === 'flinch' ? 'hit' : br.kind === 'stagger' ? 'knockback' : t < up ? 'die' : 'stand_up';
    const R = this.real;
    if (!this._br || this._br.clip !== clip || this._br.t0 !== br.t0) {
      const first = !this._br || this._br.t0 !== br.t0;
      this._br = { clip, t0: br.t0 };
      // the get-up starts from the lying pose: a long cross-fade hides the difference in the two clips' ends
      R.setAnim(R.hasAnim(clip) ? clip : 'hit', { loop: false, restart: true, fade: first ? 0.08 : 0.45, ...(clip === 'stand_up' ? { speed: (R.inner?.clip?.(clip)?.duration || 1.2) / (br.dur - up || 1.2) } : null) });
      this._mwValid = false;
    }
    // lean-off envelope: out fast, back slowly
    const env = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
    const off = br.off * Math.max(0, env) * (br.kind === 'flinch' ? 0.3 : 1);
    this.root.position.x += br.dx * off; this.root.position.z += br.dz * off;
  }

  /** Gait speed (m/s) the locomotion clip is currently timed for. */
  get gaitSpeed() { return this._sent; }

  setColors(c) { this.real.setColors(c); this.fallback?.setColors?.(c); }

  setDisguise(on) {
    this.disguised = !!on;
    this.real.setDisguise(this.disguised);
    this.fallback?.setDisguise?.(this.disguised);
  }

  setLOD(px) { this.real.setLOD(px); }

  dispose() { this.real.dispose(); this.fallback?.dispose?.(); }
}
