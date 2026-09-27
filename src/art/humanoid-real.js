/**
 * Realistic character library (MPFB bodies on the Quaternius UAL rig, CC0): the drop-in successor of art/humanoid.js.
 * Wired into the game through art/unit-model.js (Unit models, gameplay anim mapping, placeholder fallback).
 *
 *   await loadCharacterLibrary();                       // manifest + runtimes + animation libraries (+ optional preload)
 *   assignEnemyLooks(missionId, spawns);                // optional: squad-aware face/variant picks for a whole mission
 *   const m = createRealHumanoid({ faction: 'enemy', soldierType: 'sentry', seed: 'm3:e12', missionId: 3 });
 *   scene.add(m.root); m.setAnim('walk', { moveSpeed: 0.9 }); m.update(dt);   // ARCHITECTURE model interface
 *   setCharacterView({ camera, pxPerMetre: 40 * zoom });                     // once per frame: LOD + off-screen throttling
 *
 * createRealHumanoid() is synchronous like createHumanoid(): `root` is returned at once and the skinned body is added
 * to it when its GLB is ready (`m.ready` resolves; the last setAnim/setColors/setDisguise is replayed then).
 *
 * Assets: assets/characters/manifest.json (ids, LOD files, sockets, headgear, variants, seeds); runtimes are the
 * verified group runtimes in src/art/characters/ (copied from the character pipeline, see tools/characters/).
 *   commandos_a  greenberet, sniper, marine (+marine_diver in water)  ca_runtime: shouldered long-gun rig, go_prone/get_up
 *   commandos_b  sapper, driver (+driver_burns from M8), spy (+disguise) charkit: gait by speed, grounding, sitOn, carryBody
 *   enemies      99 variants (11 looks, 16 face archetypes)               squadkit over enemykit: jitter, posture, face fixes
 *   guests       McRae, Informer, Gilbert, 4 prisoners, tram driver      guestkit: tied / following / boarding clips
 *   dogs         3 Alsatians                                              dogkit
 *
 * Pooling for 60+ soldiers: one parsed template (GLB, geometry, atlas, adapted clips) per character id shared by every
 * instance; one AnimationMixer per instance, stepped by update(dt) at full rate on screen and every 4th call off
 * screen (dt accumulated, so the pose is right when it comes back), frozen once a corpse has settled.
 * @module art/humanoid-real
 */
import * as THREE from 'three';

const ROOT = new URL('../../assets/characters/', import.meta.url);
const url = (p) => new URL(p, ROOT).href;
/** Runtimes live next to this module (moved from assets/characters/runtime in art integration 2). */
const RT = new URL('./characters/', import.meta.url);
const rt = (p) => new URL(p, RT).href;

/** Animation names the ARCHITECTURE contract requires (missing ones fall back to idle). */
export const ANIMS = ['idle', 'walk', 'run', 'crawl_idle', 'crawl', 'swim', 'dive', 'aim', 'shoot', 'stab',
  'throw', 'punch', 'plant', 'climb', 'carry_idle', 'carry_walk', 'die', 'dead', 'surrender', 'salute',
  'look_around', 'use'];
const WATER = new Set(['swim', 'swim_idle', 'dive']);
const LOCO = new Set(['walk', 'run', 'sprint', 'crawl', 'swim', 'crouch_walk', 'carry_walk', 'drag', 'tied_walk', 'follow_walk']);
// design-spec §3.1 / §4.1 ground speeds (m/s) used when the caller gives none; keeps the feet planted at game speed
const SPEED = {
  player: { walk: 2.25, run: 4.5, crawl: 0.9, swim: 1.8, crouch_walk: 2.25, carry_walk: 1.6, drag: 1.6 },
  fast: { run: 5.4 },   // greenberet, driver
  enemy: { walk: 0.9, run: 3.8, crouch_walk: 0.9 },
  neutral: { walk: 2.25, run: 4.5, crawl: 0.9, tied_walk: 1.1, follow_walk: 2.25 },
};
// ARCHITECTURE roster colours are irrelevant for textured bodies; the ARCHITECTURE roles map through manifest.roles
const DEFAULT_WEAPON = { greenberet: 'colt1911', sniper: 'no4_sniper', marine: 'harpoon_gun', marine_diver: 'harpoon_gun',
  sapper: 'walther_p38', driver: 'thompson', driver_burns: 'thompson', spy: 'walther_p38' };

let LIB = null, loading = null;
/** Below this many px/m (LOD1/LOD2 sizes) mixers step every 2nd frame with the accumulated dt. */
const HALF_RATE_PX = 50;
const CRAWLING = /^crawl(_unarmed|_knife)?$/;
const live = new Set();
const view = { px: 40, frustum: null, tick: 0 };
const _m4 = new THREE.Matrix4(), _sph = new THREE.Sphere(new THREE.Vector3(), 1.3);

/** fnv1a 32-bit (same hash as the pipeline's variety.js). */
function fnv1a(str) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(String(str))) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }

async function initCommandos(L) {
  const [CA, PK, PW, CB, CBW] = await Promise.all(['commandos_a/ca_runtime.js', 'pipeline/charkit.js',
    'pipeline/weapons.js', 'commandos_b/charkit.js', 'commandos_b/weapons.js'].map(p => import(rt(p))));
  const cbLib = async () => {   // commandos_b verified library: own clips + enemy/guest clips it lacks (rw/common.js loadLib)
    const lib = await CB.loadAnimLibrary(url('anims/commando_anims.glb'));
    for (const u of ['anims/enemy_anims.glb', 'anims/guest_anims.glb']) {
      try {
        const ex = await CB.loadAnimLibrary(url(u));
        for (const [k, c] of ex.clips) if (!lib.clips.has(k)) lib.clips.set(k, c);
        for (const [k, m] of Object.entries(ex.meta)) if (!lib.meta[k]) lib.meta[k] = m;
      } catch (e) { console.warn('[humanoid-real] optional anim library failed', u, e); }
    }
    return lib;
  };
  const [caLib, caW, bLib, bW] = await Promise.all([CA.loadCALib(), PW.loadWeapons(url('weapons/weapons.glb')), cbLib(),
    CBW.loadWeapons(url('weapons/weapons_b.glb'))]);
  L.rt.commandos_a = {
    load: (e) => PK.loadCharacter(url(e.glb)),
    create: (tpl) => CA.createCommando(tpl, caLib),
    equip: (h, w) => CA.equipCA(h, caW, w), lib: caLib,
  };
  L.rt.commandos_b = {
    load: (e) => CB.loadCharacter(url(e.glb)),
    create: (tpl, o) => CB.createHumanoid(tpl, bLib, { disguise: o.disguiseTpl || null }),
    equip: (h, w) => CBW.equip(h, bW, w), lib: bLib,
    prop: (h, n) => CBW.equipProp(h, bW, n),   // clip-bound props: time_bomb on plant, mills_bomb on throw, wire_cutters on cut_wire
  };
}

async function initEnemies(L) {
  const [EK, SK] = await Promise.all([import(rt('enemies/enemykit.js')), import(rt('commandos_b/squadkit.js'))]);
  const E = await EK.loadEnemySet(url('enemies/'), { anims: url('anims/base_anims.glb'), weapons: url('weapons/weapons.glb'),
    enemyAnims: url('anims/enemy_anims.glb') });
  try {   // clips the enemy set lacks but the game needs on Germans too (same UAL rig): a body on a commando's shoulder
    const PK = await import(rt('pipeline/charkit.js'));
    const ca = await PK.loadAnimLibrary(url('anims/commando_anims.glb'));
    for (const n of ['carried']) if (!E.lib.clips.has(n) && ca.clips.has(n)) { E.lib.clips.set(n, ca.clips.get(n)); E.lib.meta[n] ||= ca.meta[n]; }
  } catch (e) { console.warn('[humanoid-real] carried clip for enemies unavailable', e); }
  L.rt.enemies = { EK, SK, E, picks: new Map() };
}

async function initGuests(L) {
  const [GK, GC] = await Promise.all([import(rt('guests/guestkit.js')), import(rt('guests/charkit.js'))]);
  const lib = await GK.loadGuestLib();
  L.rt.guests = {
    load: (e) => GC.loadCharacter(url(e.glb)),
    create: (tpl, o) => GK.createGuest(tpl, lib, { id: o.id }), lib,
  };
}

async function initDogs(L) {
  const DK = await import(rt('guests/dogkit.js'));
  L.rt.dogs = { load: (e) => DK.loadDog(url(e.glb)), create: (tpl) => DK.createDog(tpl) };
}

/**
 * Run `fn` with three's file Cache on, then drop what it added: the four runtimes each parse the shared anims GLBs
 * (commando / enemy / guest / base) with their own GLTFLoader, and without this every copy downloaded them again
 * (≈ 5 MB per first mission load). Entries that existed before are kept; the Cache's previous state is restored.
 */
async function withSharedFetches(fn) {
  const C = THREE.Cache, was = C.enabled, before = new Set(Object.keys(C.files));
  C.enabled = true;
  try { return await fn(); } finally {
    for (const k of Object.keys(C.files)) if (!before.has(k)) C.remove(k);
    C.enabled = was;
  }
}

/**
 * Load the manifest, the runtimes and the shared animation libraries. Safe to call repeatedly.
 * @param {{groups?:string[], preload?:string[]}} [opts] groups: commandos|enemies|guests|dogs; preload: character ids
 * @returns {Promise<{manifest:object, rt:object}>}
 */
export async function loadCharacterLibrary({ groups = ['commandos', 'enemies', 'guests', 'dogs'], preload = [] } = {}) {
  if (!loading) loading = withSharedFetches(async () => {
    const manifest = await (await fetch(url('manifest.json'))).json();
    const L = { manifest, rt: {}, tpl: new Map() };
    const init = { commandos: initCommandos, enemies: initEnemies, guests: initGuests, dogs: initDogs };
    await Promise.all(groups.map(g => init[g](L)));
    return L;
  });
  LIB = await loading;
  await Promise.all(preload.map(id => template(id)));
  return LIB;
}

/** Library state (null before loadCharacterLibrary resolves). */
export function characterLibrary() { return LIB; }

function template(id) {
  const e = LIB.manifest.characters[id];
  if (!e) return Promise.reject(new Error('unknown character ' + id));
  if (e.group === 'enemies') return Promise.resolve(null);   // enemykit caches its own templates (E.templates)
  if (!LIB.tpl.has(id)) LIB.tpl.set(id, LIB.rt[e.runtime].load(e));
  return LIB.tpl.get(id);
}

function enemyType(soldierType = 'soldier', theatre = null) {
  const man = LIB.manifest; let t = soldierType;
  const th = theatre && man.theatres[theatre]; if (th && th[t]) t = th[t];
  if (!man.enemyTypes[t] && man.enemyAliases[t]) t = man.enemyAliases[t];
  return t;
}

/**
 * Squad-aware variant picks for a whole mission (bible §5.2: no two alike within 30 m / same squad, unique faces per
 * squad). Later createRealHumanoid({faction:'enemy', missionId, spawnId}) calls use these picks.
 * @param {string|number} missionId
 * @param {{id:string, soldierType?:string, type?:string, x:number, z:number, squad?:string, theatre?:string}[]} spawns
 * @returns {Map<string, string>} spawnId -> character id
 */
export function assignEnemyLooks(missionId, spawns) {
  const R = LIB && LIB.rt.enemies; if (!R) throw new Error('[humanoid-real] enemies not loaded');
  const sp = spawns.map(s => ({ id: String(s.id), type: enemyType(s.soldierType || s.type, s.theatre), x: s.x || 0, z: s.z || 0, squad: s.squad || null }))
    .filter(s => R.E.variantsByType[s.type]);
  const picks = R.SK.assignSquadVariants(missionId, sp, R.E.variantsByType);
  const out = new Map();
  for (const [sid, v] of picks) { R.picks.set(`${missionId}:${sid}`, v); out.set(sid, v.id); }
  return out;
}

let autoSeed = 0;
function resolve(opts) {
  const man = LIB.manifest, C = man.characters;
  if (opts.id && C[opts.id]) return { id: opts.id, disguise: opts.id === 'spy' ? man.roles.spy.disguise : null };
  const faction = opts.faction || 'player';
  if (faction === 'player') {
    const r = man.roles[opts.role] || man.roles.greenberet;
    const id = r.burns && (opts.burns || (opts.mission ?? 0) >= 8) ? r.burns : r.default;
    return { id, water: r.water || null, disguise: r.disguise || null };
  }
  if (faction !== 'enemy') return { id: C[opts.role] ? opts.role : C[opts.guestId] ? opts.guestId : 'prisoner_worker' };
  const key = `${opts.missionId ?? 0}:${opts.spawnId ?? opts.seed ?? 'auto' + autoSeed++}`;
  const type = enemyType(opts.soldierType, opts.theatre);
  if (type === 'dog') { const d = Object.keys(C).filter(k => C[k].group === 'dogs'); return { id: d[fnv1a(key) % d.length] }; }
  const pick = opts.variantId || (LIB.rt.enemies && LIB.rt.enemies.picks.get(key) || {}).id;
  const list = man.enemyTypes[type] || man.enemyTypes.rifleman;
  return { id: pick || list[fnv1a(key) % list.length], key };
}

function inView(root, radius = 1.3) {
  if (!view.frustum) return true;
  _sph.center.setFromMatrixPosition(root.matrixWorld); _sph.center.y += 0.9; _sph.radius = radius;
  return view.frustum.intersectsSphere(_sph);
}
/** Off-screen bodies farther than this (m) from the view are not drawn at all (covers their long evening shadows). */
const DRAW_MARGIN = 9;

function hasClip(h, n) {
  if (!h.clip) return true;                        // dogs: the runtime ignores unknown names itself
  return !!((h.clipAlias && h.clipAlias[n]) || h.clip(n));
}

/** Meshes of a built character + its small static kit (squad extras: canteens, pouches, bread bags, bands). */
function kitOf(h) {
  if (h._kit) return h._kit;
  const meshes = [], extras = [];
  h.object.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    if (o.isSkinnedMesh) return;
    for (let p = o; p && p !== h.object; p = p.parent) if (/^(weapon_|prop_)/.test(p.name)) return;
    extras.push(o);
  });
  return (h._kit = { meshes, extras });
}

function findBone(h, name) {
  const b = h.bones || {}; if (b[name]) return b[name];
  const lc = name.toLowerCase(); for (const k in b) if (k.toLowerCase() === lc) return b[k];
  return null;
}

/**
 * Create a realistic humanoid behind the ARCHITECTURE model interface.
 * @param {{faction?:'player'|'enemy'|'neutral', role?:string, soldierType?:string, seed?:string|number, disguise?:boolean,
 *   id?:string, missionId?:string|number, spawnId?:string, squad?:string, x?:number, z?:number, theatre?:'desert'|'winter',
 *   variantId?:string, mission?:number, burns?:boolean, weapon?:string|null, posture?:boolean, extras?:boolean}} opts
 * @returns {{root:THREE.Group, object:THREE.Group, ready:Promise, characterId:string, entry:object, anim:string,
 *   setAnim:Function, update:Function, setColors:Function, setDisguise:Function, setLOD:Function, show:Function,
 *   setWeapon:Function, getSocket:Function, dispose:Function, inner:object|null}}
 */
export function createRealHumanoid(opts = {}) {
  if (!LIB) throw new Error('[humanoid-real] await loadCharacterLibrary() first');
  const R = resolve(opts);
  const entry = LIB.manifest.characters[R.id];
  const faction = entry.faction;
  const root = new THREE.Group(); root.name = `real:${R.id}`;
  const body = new THREE.Group(); body.name = 'body'; root.add(body);   // built bodies live here (culling toggles it)
  const st = { anim: 'idle', o: {}, colors: null, disguise: !!opts.disguise, lodPx: null, acc: 0, n: 0, h: 0, deadT: 0, frozen: false };
  let land = null, water = null, cur = null;
  const both = () => [land, water].filter(Boolean);

  const build = async (id, disguiseTpl) => {
    const e = LIB.manifest.characters[id];
    if (e.group === 'enemies') {
      const { E, SK } = LIB.rt.enemies;
      const variant = E.variantsByType[e.soldierType].find(v => v.id === id);
      const spawn = { id: String(opts.spawnId ?? opts.seed ?? R.key ?? id), type: e.soldierType, x: opts.x || 0, z: opts.z || 0, squad: opts.squad || null };
      return SK.spawnSquadMember(E, opts.missionId ?? 0, spawn, variant, { posture: opts.posture !== false, extras: opts.extras !== false });
    }
    const rt = LIB.rt[e.runtime]; const tpl = await template(id);
    const h = rt.create(tpl, { id, disguiseTpl });
    const w = opts.weapon === undefined ? DEFAULT_WEAPON[id] : opts.weapon;
    if (w && rt.equip) rt.equip(h, w);
    return h;
  };
  const defSpeed = (n) => {
    const t = SPEED[faction === 'player' ? 'player' : faction] || SPEED.player;
    if (faction === 'player' && n === 'run' && /greenberet|driver/.test(R.id)) return SPEED.fast.run;
    return t[n] ?? null;
  };
  const play = (name, o = {}) => {
    if (water) {                                  // the Marine swaps to the wetsuit body in water (manifest.roles.diver)
      const next = WATER.has(name) ? water : land;
      if (next !== cur) { cur.object.visible = false; next.object.visible = true; cur = next; model.inner = cur; applyLOD(); }
    }
    const n = hasClip(cur, name) ? name : 'idle';
    const opt = { loop: o.loop !== false };
    if (o.fade != null) opt.fade = o.fade;
    if (o.transition === false) opt.transition = false;
    const ms = o.moveSpeed ?? (LOCO.has(n) ? (model.moveSpeed ?? defSpeed(n)) : null);
    if (ms != null) opt.speed = ms; else if (o.speed != null) opt.timeScale = o.speed;   // stub semantics: speed = playback rate
    const act = cur.setAnim(n, opt);
    if (o.restart && o.loop === false && act && typeof act.reset === 'function') act.reset().play();   // replay a one-shot
    st.deadT = 0; st.frozen = false;
  };
  const applyLOD = () => {
    const px = st.lodPx ?? view.px, far = px < HALF_RATE_PX;
    for (const h of both()) {
      h.autoLOD ? h.autoLOD(px) : h.setLOD && h.setLOD(px >= 60 ? 'LOD0' : px >= 28 ? 'LOD1' : 'LOD2');
      if (h._far === far) continue;
      // zoomed out: posture overlay off (1-2 px at this size, but 2 subtree matrix updates per frame), small kit off,
      // no GTAO prepass draw (contact AO of a 70 px figure is not visible)
      h._far = far;
      if (h.posture) h.posture.enabled = !far;
      const k = kitOf(h);
      for (const m of k.extras) m.visible = !far;
      for (const m of k.meshes) m.userData.aoExclude = far;
    }
  };

  const model = {
    root, object: root, characterId: R.id, entry, faction, anim: 'idle', disguised: st.disguise, moveSpeed: null, inner: null,
    setAnim(name, o = {}) {
      if (name === model.anim && !o.restart && o.moveSpeed == null && cur) return;
      model.anim = name; st.anim = name; st.o = o;
      if (cur) play(name, o);
    },
    /** Step the animation. @returns {boolean} true when the pose changed (the mixer stepped) */
    update(dt) {
      if (!cur) return false;
      st.acc += dt;
      body.visible = inView(root, DRAW_MARGIN);   // render culling of the whole skeleton subtree (all passes)
      if (st.frozen) return false;
      if (!inView(root) && (++st.n & 3)) return false;   // off screen: every 4th call, same total time
      // zoomed out (LOD1/2): 30 Hz, same total time. Not while crawling: the planted elbows / boots move against the
      // root every frame, and a pose that only catches up every other frame makes the crawl stutter (review)
      if ((st.lodPx ?? view.px) < HALF_RATE_PX && !CRAWLING.test(model.anim) && (++st.h & 1)) return false;
      const step = st.acc; st.acc = 0;
      cur.update(step);
      if ((model.anim === 'dead' || model.anim === 'dead_prone') && (st.deadT += step) > 1.5) st.frozen = true;   // settled corpse: stop stepping its mixer
      return true;
    },
    setColors(c = {}) {
      st.colors = c;
      const pass = {}; for (const k of ['tint', 'skin', 'cloth']) if (Array.isArray(c[k])) pass[k] = c[k];   // stub hex keys are ignored
      if (Object.keys(pass).length) for (const h of both()) h.setColors && h.setColors(pass);
    },
    setDisguise(on) {
      st.disguise = !!on; model.disguised = st.disguise;
      if (R.disguise && land && land.setDisguise) land.setDisguise(st.disguise);
    },
    /** LOD override in CSS px per metre (null = follow setCharacterView). */
    setLOD(pxPerMetre) { st.lodPx = pxPerMetre; applyLOD(); },
    _applyLOD: applyLOD,
    show(part, v) { for (const h of both()) h.show && h.show(part, v); },
    /** Equip a weapon prop by name (weapons.glb); a falsy name hides the current one (hands free). */
    setWeapon(name) {
      const rt = LIB.rt[entry.runtime]; if (!rt || !rt.equip) return null;
      return both().map((h) => {
        if (!name) { if (h.weapon) h.weapon.visible = false; return null; }
        if (h.weapon && h.weaponName === name) { h.weapon.visible = true; return h.weapon; }
        const w = rt.equip(h, name); if (w) w.visible = true;
        return w;
      })[0] || null;
    },
    /** Name of the weapon in hand ('' when hidden or none). */
    weaponName() { return cur && cur.weapon && cur.weapon.visible !== false ? cur.weaponName || '' : ''; },
    /** True when the built character has this clip (false before `ready`). */
    hasAnim(name) { return !!cur && hasClip(cur, name); },
    /** Clip-bound hand prop (commandos_b runtime: time_bomb, remote_bomb, mills_bomb, wire_cutters); null elsewhere. */
    equipProp(name) {
      const rt = LIB.rt[entry.runtime]; if (!rt || !rt.prop || !land) return null;
      return rt.prop(land, name);
    },
    /** Bone (hand_r, hand_l, head, spine_03, pelvis, ...) or equipped-weapon socket (muzzle, grip_r, grip_l, butt, ...). */
    getSocket(name) {
      if (!cur) return null;
      const ws = cur.weapon && cur.weapon.userData.sockets;
      return (ws && ws[name]) || findBone(cur, name);
    },
    dispose() {
      live.delete(model); root.removeFromParent();
      for (const h of both()) { if (h.mixer) { h.mixer.stopAllAction(); h.mixer.uncacheRoot(h.object); } h.object.removeFromParent(); }
      land = water = cur = null; model.inner = null;
    },
  };
  model.ready = (async () => {
    const disguiseTpl = R.disguise ? await template(R.disguise) : null;
    land = await build(R.id, disguiseTpl);
    if (R.water) water = await build(R.water, null);
    for (const h of both()) { h.object.visible = false; body.add(h.object); }
    if (!live.has(model)) { for (const h of both()) h.object.removeFromParent(); return model; }   // disposed while loading
    cur = land; cur.object.visible = true; model.inner = cur;
    if (st.colors) model.setColors(st.colors);
    model.setDisguise(st.disguise);
    applyLOD();
    play(st.anim, { ...st.o, fade: 0 });
    cur.update(0);
    return model;
  })().catch((e) => { console.error('[humanoid-real] failed to build', R.id, e); return model; });
  live.add(model);
  return model;
}

/**
 * Per-frame view state shared by every live character: frustum for off-screen throttling, px/m for LOD
 * (40 × zoom for the game camera; LOD0 >= 60, LOD1 >= 28 px/m; enemies use their own 120/50 thresholds).
 * @param {{camera?:THREE.Camera|false, pxPerMetre?:number}} v camera false = disable culling / throttling
 */
export function setCharacterView({ camera = null, pxPerMetre = null } = {}) {
  if (camera === false) view.frustum = null;   // several views (camera rig split screen): no frustum culling
  else if (camera) {
    camera.updateMatrixWorld();
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    (view.frustum || (view.frustum = new THREE.Frustum())).setFromProjectionMatrix(_m4);
  }
  if (pxPerMetre != null && pxPerMetre !== view.px) { view.px = pxPerMetre; for (const m of live) m._applyLOD(); }
}

/** Dispose every live character (mission unload). */
export function disposeAllCharacters() { for (const m of [...live]) m.dispose(); }

/** Live character count (debug / perf overlay). */
export function liveCharacterCount() { return live.size; }

export default createRealHumanoid;
