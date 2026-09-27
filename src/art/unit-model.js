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
import * as HR from './humanoid-real.js';
import { mapAnim, LOCOMOTION, actionWeapon, CARRY_WEAPON, lookType, guestCharacter, missionNumber } from './unit-anim-map.js';
import { proneGround, PRONE_CLIP } from './prone-ground.js';

const PRONE_SHOT = /^prone_(shoot|shoot_smg|pistol_shoot)$/;

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

const _S = new Vector3(), _P = new Vector3(), _qInv = new Quaternion();
const _qFlip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const _qPitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.45);
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
    this._o = {}; this._v = 0; this._sent = 0; this._last = null; this._weapon = undefined; this._carried = false; this._stance = 'stand';
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
    const c = { dog: this.dog, faction: this.opts.faction, role: this.opts.role, actionId: u?.currentActionId ?? null,
      stance: u?.stance ?? 'stand', carried: u?.state === 'carried', tool: u?.readyTool ?? null };
    c.weapon = this._wantWeapon(c);   // prone clips follow the carry class of the weapon in hand (unit-anim-map proneAnim)
    return c;
  }

  /** Weapon prop the unit shows for the current gameplay anim (commandos: carry / action weapon; others: their own). */
  _wantWeapon(c) {
    if (!this.player) return this.real.inner?.weaponName || null;
    const idle = this.anim === 'idle' || LOCOMOTION.has(this.anim) || this.anim === 'crawl_idle';
    // crawling with the knife selected (Green Beret, knife cursor up): crawl_knife, the knife in the fist
    let want = idle ? (c.stance === 'crawl' && c.tool === 'knife' ? 'knife' : null) : actionWeapon(this.opts.role, c.actionId);
    if (want === null) want = CARRY_WEAPON[this.opts.role] || false;
    return want;
  }

  /** Nominal gameplay speed (m/s) of the unit right now. */
  _nominal() { const u = this.unit; return u && typeof u.speed === 'number' ? u.speed : null; }

  _apply(restart = false) {
    const R = this.real, c = this._ctx();
    this._carried = c.carried; this._stance = c.stance;
    const cands = mapAnim(this.anim, c);
    const clip = R.inner ? (cands.find((n) => R.hasAnim(n)) || 'idle') : cands[0];
    const o = { loop: this._o.loop ?? (this.anim !== 'die'), restart };
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
    if (tr && R.hasAnim(tr)) {
      const d = inner.clip?.(tr)?.duration ?? (isP ? 0.5 : 0.6);
      R.setAnim(tr, { loop: false, restart: true, fade: isP ? 0.08 : 0.2 });   // go_prone starts on the idle frame: a long fade dipped the toes
      this._tr = { left: d - 0.08, clip, o };
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
    this._rootMatrix();
    if (R.inner && this.unit && (this.unit.state === 'carried') !== this._carried) this._apply();
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
    if (this._tr && dt > 0 && (this._tr.left -= dt) <= 0) {   // transition clip done: the requested clip takes over
      const t = this._tr; this._tr = null;
      R.setAnim(t.clip, { ...t.o, fade: 0.1 });
      if (R.inner) this._weaponFor(this._ctx());
    }
    if (this._shot && dt > 0 && (this._shot.left -= dt) <= 0) { const nx = this._shot.next; this._shot = null; if (nx) this.setAnim(nx[0], nx[1]); }
    let stepped = R.update(dt);
    const root = this.root, u = this.unit;
    if (R.inner && u && u.state === 'carried' && u.carriedBy) stepped = this._carryPose(u.carriedBy) || stepped;
    else if (this._carryOn) { this._carryOn = false; const b = this._body(); b.position.set(0, 0, 0); b.quaternion.identity(); stepped = true; }
    else if (R.inner && (stepped || this._pg?.active)) stepped = this._prone(dt) || stepped;
    if (stepped || !this._mwValid || !this._mw.equals(root.matrix)) {
      baseUpdateMW.call(root, true);
      this._mw.copy(root.matrix); this._mwValid = true;
    }
    root._mwTok = FRAME.n;
  }

  _body() { return this.real.root.children.find((c) => c.name === 'body') || this.real.root; }

  /**
   * Prone bodies on the real terrain + prone turning (art/prone-ground.js): slope tilt, elbow / ankle relief, the
   * displayed heading turning at <= 75 deg/s with prone_turn_l / _r while lying still. @returns {boolean} pose changed
   */
  _prone(dt) {
    const R = this.real, inner = R.inner, u = this.unit;
    const prone = PRONE_CLIP.test(this.clip || '') && !this._tr;
    const st = this._pg || (this._pg = { active: false });
    if (!prone && !st.active) return false;
    const w = u?.world, ey = u?.y || 0;
    const res = proneGround(st, { root: this.root, body: this._body(), bones: inner.bones, dt, prone,
      moving: LOCOMOTION.has(this.anim) && this._v > 0.1, groundY: w?.groundY ? (x, z) => w.groundY(x, z) + ey : null });
    st.active = res.active;
    const turn = prone && res.turnDir && this.anim === 'crawl_idle' ? (res.turnDir > 0 ? 'prone_turn_l' : 'prone_turn_r') : null;
    if (turn !== this._turnClip && (!turn || R.hasAnim(turn))) {
      this._turnClip = turn;
      R.setAnim(turn || this.clip, { fade: 0.15 });
    }
    return true;
  }

  /**
   * Fireman's carry (as charkit.carryBody): the 'carried' pose facing backwards, pitched, its pelvis on the carrier's
   * right trapezius (between upperarm_r and the neck). @returns {boolean} true when placed
   */
  _carryPose(carrier) {
    const cm = carrier.model?.real;
    const ua = cm?.getSocket?.('upperarm_r'), nk = cm?.getSocket?.('neck_01') || cm?.getSocket?.('head');
    const pel = this.real.getSocket('pelvis');
    if (!ua || !nk || !pel) return false;
    const body = this._body(), root = this.root;
    body.quaternion.copy(_qFlip).multiply(_qPitch); body.position.set(0, 0, 0);
    baseUpdateMW.call(root, true);
    ua.getWorldPosition(_S); nk.getWorldPosition(_P); _S.lerp(_P, 0.35); _S.y += 0.1;
    pel.getWorldPosition(_P);
    _S.sub(_P).applyQuaternion(_qInv.copy(root.quaternion).invert());   // world delta → root space (no scale)
    body.position.copy(_S);
    this._carryOn = true;
    return true;
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
