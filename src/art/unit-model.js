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
import { MeshDepthMaterial, Object3D, Matrix4, Vector3, Quaternion, BufferAttribute } from 'three';
import { applyClothWind } from './cloth-wind.js';
import { createHumanoid } from './humanoid.js';
import { CONFIG } from '../config.js';
import * as HR from './humanoid-real.js';
import { applyRagdollPose, rememberIdle, captureBase, lyingBase } from './ragdoll-pose.js';
import { liveView } from '../physics/ragdoll.js';
import { mapAnim, LOCOMOTION, actionWeapon, CARRY_WEAPON, lookType, guestCharacter, missionNumber } from './unit-anim-map.js';
import { transportState, transportClip, poseTransported, captureStart, groundDraggedLegs, dragGroundWeight, localOf, localRot, setBody } from './transport-pose.js';
import { carrierContact, loadSway, loadGait } from './transport-contact.js';
import { BoneGuard, StickyGuard, capturePose, mixPose } from './pose-blend.js';
import { proneGround, PRONE_CLIP } from './prone-ground.js';
import { turnStep } from './turn-step.js';

const PRONE_SHOT = /^prone_(shoot|shoot_smg|pistol_shoot)$/;
/** The Spy's pending orders whose action blends in from the last pose shown (art/spy-actions.js). */
const PRE_POSE = new Set(['syringe', 'use']);
/** s: a lying ragdoll's takeover eases the pose on screen (end of the fall, of a put-down) into the ragdoll's — as
 *  long as the kits cross-fade die → dead. */
const SETTLE_EASE = 0.35;
/** Stance transitions play over exactly the sim's stance-change time (CONFIG.units.stanceDown / stanceUp). */
const transitionTime = (tr) => (tr === 'go_prone' ? CONFIG.units.stanceDown : CONFIG.units.stanceUp);
const TR_CLIP = /^(go_prone|get_up)$/;

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
  ctx.ready = true;
  return true;
}

/** Stop creating real characters (mission unloaded) and drop every live one. */
export function releaseCharacters() { ctx.ready = false; HR.disposeAllCharacters?.(); }

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
export function warmUnitModels(units, budgetMs = 1200) {
  const t0 = performance.now();
  for (const u of units) {
    if (performance.now() - t0 > budgetMs) break;
    const R = u.model?.real, H = R?.inner;
    if (!H) continue;
    try {
      // prone clips are fitted per body (prone-fit.js, 20-80 ms each): warm them for the squad, lazily for the Germans
      const names = u.faction === 'player' ? WARM_CLIPS : WARM_CLIPS.filter((n) => !PRONE_CLIP.test(n));
      if (H.warmGround) H.warmGround(names);
      else for (const n of names) R.hasAnim(n);
    } catch (e) { console.warn('[unit-model] warm', e); }
  }
  return performance.now() - t0;
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
  try { return new UnitModel(HR.createRealHumanoid(realOpts(opts)), opts); } catch (e) {
    console.warn('[unit-model] real character failed, placeholder used', e);
    return createHumanoid(opts);
  }
}

const _rq = new Quaternion(), _bq = new Quaternion(), _bq2 = new Quaternion(), _bq3 = new Quaternion(), _bq3b = new Quaternion(), _v1 = new Vector3(), _v2 = new Vector3();
const SPEED_SEND = 0.04;   // re-time the gait when the measured speed moved by > 4 %
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
    this.anim = 'idle'; this.clip = null; this.disguised = false; this.unit = null;
    this._o = {}; this._v = 0; this._sent = 0; this._last = null; this._idleN = 0; this._weapon = undefined; this._carried = false; this._stance = 'stand';
    this._guard = new BoneGuard(); this._rdGuard = new StickyGuard(); this._blend = null;
    /** Optional procedural pose written after the mixer: (model, dt, guard) => pose changed (art/shovel-dig.js). */
    this.overlay = null;
    this.ready = real.ready.then(() => this._onReady());
  }

  /** Root matrix of this frame before the runtime solves IK / grounding in world space (the scene updates the rest). */
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
    if (this.opts.role === 'sapper') for (const p of ['time_bomb', 'mills_bomb', 'wire_cutters']) R.equipProp(p);
    this._weapon = undefined;
    this._apply(true);
    return this;
  }

  _ctx() {
    const u = this.unit;
    const st = this.dog ? null : transportState(u);
    const c = { dog: this.dog, faction: this.opts.faction, role: this.opts.role, actionId: u?.currentActionId ?? null,
      stance: u?.stance ?? 'stand', carried: u?.state === 'carried', tool: u?.readyTool ?? (u?.pendingAbility?.def?.id === 'knife' ? 'knife' : null), load: st ? transportClip(st) : null,
      mounted: !!u?._mgManned };   // at a platform MG (render/mg-mount.js): kneeling behind it
    c.weapon = this._wantWeapon(c);   // prone clips follow the carry class of the weapon in hand (unit-anim-map proneAnim)
    return c;
  }

  /** Weapon prop the unit shows for the current gameplay anim (commandos: carry / action weapon; others: their own). */
  _wantWeapon(c) {
    if (!this.player) return this.real.inner?.weaponName || null;
    const idle = this.anim === 'idle' || LOCOMOTION.has(this.anim) || this.anim === 'crawl_idle';
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
    return want;
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
    this.anim = name; this._o = o;
    this._apply(!!o.restart);
  }

  update(dt, unit) {
    if (unit) this.unit = unit;
    if (this.fallback) { this.fallback.update(dt); return; }
    const R = this.real;
    if (R.inner && this.unit?.alive !== false && (this.unit?.blastReact || this._br)) this._blastReact(this.unit);
    this._rootMatrix();
    if (R.inner && this.unit && (this.unit.state === 'carried') !== this._carried) this._apply(false, true);
    else if (R.inner && this.unit && !!this.unit._mgManned !== !!this._mounted) this._apply();   // takes / leaves a platform MG
    else if (R.inner && this.unit && !this.dog) { const st = transportState(this.unit); if ((st ? transportClip(st) : null) !== (this._load ?? null)) this._apply(false, true); }
    // a transporter's hands empty / fill again as the load comes and goes
    if (R.inner && this.player && this.unit && !!(this.unit.carrying && this.unit.carrying.kind !== 'interactable') !== !!this._handsFull) { this._handsFull = !this._handsFull; this._weaponFor(this._ctx()); }
    // the ability's action id is set after its start() played the clip (Commando._updatePending): re-pick the weapon
    // then, so the knife stab shows the knife (not the carry pistol)
    if (R.inner && this.player && this.unit && (this.unit.currentActionId ?? null) !== (this._actId ?? null)) { this._actId = this.unit.currentActionId ?? null; this._weaponFor(this._ctx()); }
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
    } else this._last = null;
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
          if (applyRagdollPose(this, rec, now, this._rdGuard)) stepped = true;
          if (this._rdFrom) stepped = this._easeIntoRagdoll(now) || stepped;
        }
      } else if (this._rdLast) { this._rdLast = null; this._rdBase = null; this._rdFrom = null; this._mwValid = false; this._rdGuard.release(); }
      else if (!this._idleSeen && this.anim === 'idle' && stepped && ++this._idleN > 4) { rememberIdle(this); this._idleSeen = true; }
    }
    // walking in on a knife / syringe order (or up to a clothesline): the pose shown, for the contact kill / the Spy's
    // action to blend from (art/knife-kill.js, art/spy-actions.js; the action clip's first frame would jump)
    const pend = u?.pendingAbility?.def?.id;
    if (R.inner && this.player && stepped && (pend === 'knife' || (u?.role === 'spy' && PRE_POSE.has(pend)))) this._preKnife = capturePose(this);
    // procedural action overlay on the skeleton after the mixer (art/shovel-dig.js: digging, rising out of the snow)
    if (R.inner && this.overlay && !tst && !this._rdLast) { try { stepped = this.overlay(this, dt, this._guard) || stepped; } catch (e) { console.warn('[unit-model] overlay', e?.stack || e); this.overlay = null; } }
    // a standing German turning on the spot steps round, head leading (art/turn-step.js; SHADOW SIX smooth turn)
    if (R.inner && !this.dog && !this.player && !tst && !this._carryOn && !this._rdLast && !this._blend) stepped = turnStep(this, dt, this._guard) || stepped;
    // prone bodies on the real terrain (art/prone-ground.js) — not while transported or in a physics/baked ragdoll pose
    if (R.inner && !this.dog && !tst && !this._carryOn && !this._rdLast && (stepped || this._pg?.active)) stepped = this._prone(dt) || stepped;
    if (stepped || !this._mwValid || !this._mw.equals(root.matrix)) {
      baseUpdateMW.call(root, true);
      this._mw.copy(root.matrix); this._mwValid = true;
    }
    root._mwTok = FRAME.n;
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
      moving: LOCOMOTION.has(this.anim) && this._v > 0.1, groundY: w?.groundY ? (x, z) => w.groundY(x, z) + ey : null });
    st.active = res.active;
    const turn = prone && res.turnDir && this.anim === 'crawl_idle' ? (res.turnDir > 0 ? 'prone_turn_l' : 'prone_turn_r') : null;
    if (turn !== this._turnClip && (!turn || R.hasAnim(turn))) {
      this._turnClip = turn;
      R.setAnim(turn || this.clip, { fade: 0.15 });
    }
    return true;
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
