/**
 * Ambient aircraft flyovers (vehicle integration, ambient step): now and then a Luftwaffe element — a Rotte of Bf 109s,
 * a vic of Ju 52s, a lone Storch or a pair of Stukas — crosses the map at low altitude with its engines droning
 * overhead. Purely ambient: nothing in the simulation sees, hears or reacts to them.
 *
 *   const cfg = flyoverConfig(def);                // per mission: def.ambient.flyovers, else FLYOVER_DEFAULTS[id]
 *   flyoverAssets(def)                             // library types to preload (Game 'vehicles' stage)
 *   const fo = createFlyovers(world, def, { renderer });   // → ticks with the vehicle tickers (art/vehicle-model.js)
 *
 * Deterministic: the whole schedule is a pure function of the replay seed + mission id (its own PRNG — the world's
 * RNG is never consumed) and every aircraft position a pure function of SIM time, so a replay, a save/load or a
 * paused frame shows the same aircraft at the same place. Never during the briefing / Colonel's tour (the sim clock
 * is stopped and nothing is shown outside 'playing' / 'paused'); the first element comes `first` seconds into play.
 *
 * Visuals: the library aircraft in the theater paint, trimmed level (the models rest in their three-point attitude),
 * main gear retracted where the real type retracted it (Bf 109), propellers replaced by a translucent blur disc.
 * The ground shadow is the real sun shadow: a shadow-only twin of each aircraft (a material that writes neither colour
 * nor depth, excluded from AO / x-ray) rides the same sun ray just under the tallest shadow casters, so the shadow is the true
 * silhouette, falls on roofs and relief and stays inside the refitted shadow frustum. Sound: a 'plane_engine' loop per
 * element, panned with the camera and Doppler-shifted by its radial speed to the listener.
 *
 * Mission data (`def.ambient.flyovers`): false | true | { enabled, types: ['bf109'|'ju52'|'storch'|'ju87'],
 * interval: [min, max] s, first: [min, max] s, altitude: [min, max] m, count: [min, max] }. Night missions and every
 * mission not listed in FLYOVER_DEFAULTS are off unless their def enables it.
 * @module render/flyovers
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createVehicleVisual } from '../art/vehicle-library.js';
import { vehicleArtReady, vehicleArtContext, addVehicleTicker, markShared } from '../art/vehicle-model.js';

/** Library type, cruise speed (m/s: a slow low-level cruise), formation sizes (weights for 1, 2, 3), altitude band (m). */
export const FLYOVER_TYPES = Object.freeze({
  bf109: { lib: 'bf109_e', speed: 92, sizes: [0.2, 0.6, 0.2], alt: [55, 85], spacing: 30, retract: /^(wheel_[lr]|gear_[lr]|leg_[lr]|oleo_[lr])$/ },
  ju52: { lib: 'ju52_3m', speed: 58, sizes: [0.4, 0.2, 0.4], alt: [60, 85], spacing: 55 },
  storch: { lib: 'fi156_storch', speed: 34, sizes: [1, 0, 0], alt: [40, 60], spacing: 30 },
  ju87: { lib: 'ju87_b', speed: 72, sizes: [0, 0.6, 0.4], alt: [55, 85], spacing: 32 },
});

/**
 * Period / place defaults per mission id (only listed missions get flyovers without their own data). Types follow
 * what flew there: Sola / Værnes / Herdla transports and fighters, desert Stukas and liaison Storches, the Tunis
 * air bridge. Off: Claymore (no air opposition), the Eidfjord dam, Finnmark, D-Day, dawn / night and castle missions.
 */
export const FLYOVER_DEFAULTS = Object.freeze({
  m01: { types: ['ju52', 'bf109', 'ju87'], interval: [110, 240], first: [35, 70] },
  m04: { types: ['ju52', 'bf109', 'storch'], interval: [140, 280] },
  m05: { types: ['bf109', 'ju52', 'storch'], interval: [110, 240] },
  m06: { types: ['storch'], interval: [260, 420] },
  m07: { types: ['bf109', 'ju52'], interval: [160, 320] },
  m08: { types: ['ju87', 'bf109', 'storch'], interval: [100, 220] },
  m09: { types: ['bf109', 'storch', 'ju87'], interval: [120, 260] },
  m10: { types: ['ju52', 'bf109', 'ju87', 'storch'], interval: [90, 200] },
  m11: { types: ['storch', 'ju52'], interval: [220, 400] },
  m12: { types: ['ju52', 'bf109'], interval: [110, 240] },
  m13: { types: ['bf109'], interval: [200, 380] },
  m15: { types: ['bf109', 'storch'], interval: [180, 340] },
  m16: { types: ['storch'], interval: [260, 420] },
  m18: { types: ['storch'], interval: [260, 420] },
  m19: { types: ['bf109', 'ju52'], interval: [200, 380] },
});

const BASE = { enabled: true, types: ['bf109', 'ju52'], interval: [150, 300], first: [45, 90], altitude: null, count: null };

/**
 * Normalized flyover settings of a mission, or null (off).
 * @param {object} def mission definition (`ambient.flyovers`, `id`, `lighting` / `theater` for night)
 * @param {{night?: boolean}} [o] night flag when already resolved (the vehicle art context)
 */
export function flyoverConfig(def, o = {}) {
  const own = def?.ambient?.flyovers;
  if (own === false || own?.enabled === false) return null;
  const listed = FLYOVER_DEFAULTS[def?.id];
  if (own == null && !listed) return null;
  const night = o.night ?? (def?.theater === 'night' || /night|moon/.test(String(def?.lighting?.hdri || '')));
  if (night && !(own === true || own?.enabled === true)) return null; // blacked-out aircraft at night: not shown
  const c = { ...BASE, ...(listed || {}), ...(own && typeof own === 'object' ? own : {}) };
  c.types = (c.types || []).filter((t) => FLYOVER_TYPES[t]);
  if (!c.types.length) return null;
  const pair = (v, d) => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [Math.min(...v), Math.max(...v)] : d);
  c.interval = pair(c.interval, BASE.interval);
  c.first = pair(c.first, BASE.first);
  c.altitude = pair(c.altitude, null);
  c.count = pair(c.count, null);
  c.enabled = true;
  return c;
}

/** Library types a mission's flyovers need (preloaded with the mission's vehicles). */
export function flyoverAssets(def, o = {}) {
  const c = flyoverConfig(def, o);
  return c ? [...new Set(c.types.map((t) => FLYOVER_TYPES[t].lib))].sort() : [];
}

/** mulberry32 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The first `n` passes of a mission (pure). Each element's GROUND SHADOW crosses a point in the map's central 70 %
 * (with no sun: its ground track does) on a random heading; the aircraft fly from R before that point to R after it,
 * R = half the map diagonal + the shadow offset + 250 m, so they come and go out of sight and earshot.
 * @param {object} cfg flyoverConfig() result
 * @param {{seed?: number, id?: string, size?: number[], sun?: {x:number,y:number,z:number}|null, floor?: number}} o
 *   sun: unit vector towards the sun; floor: world y the altitudes are measured from (highest ground of the map);
 *   viewK: 1 / tan(camera pitch) — an aircraft at height h is drawn over the ground h·viewK north of it
 * @param {number} [n] passes
 * @returns {object[]} [{k, t0, dur, type, lib, n, alt, speed, heading, dx, dz, x0, z0, R, sx, sz, wing: [{a, b, dy, ph}]}]
 */
export function flyoverSchedule(cfg, o = {}, n = 8) {
  if (!cfg) return [];
  const size = o.size || [100, 100], floor = o.floor ?? 0, sun = o.sun || null;
  const rnd = prng(hashStr(`${o.seed ?? 1}|${o.id ?? ''}|flyovers`));
  const out = [];
  let t = lerp(cfg.first[0], cfg.first[1], rnd());
  for (let k = 0; k < n; k++) {
    const type = cfg.types[Math.min(cfg.types.length - 1, Math.floor(rnd() * cfg.types.length))];
    const T = FLYOVER_TYPES[type];
    let r = rnd(), m = 1;
    for (let i = 0; i < 3; i++) { r -= T.sizes[i]; if (r < 0) { m = i + 1; break; } if (i === 2) m = 3; }
    if (cfg.count) m = Math.max(cfg.count[0], Math.min(cfg.count[1], m));
    const band = cfg.altitude || T.alt, alt = lerp(band[0], band[1], rnd());
    const cx = size[0] * (0.15 + 0.7 * rnd()), cz = size[1] * (0.15 + 0.7 * rnd());
    // aircraft track = shadow track shifted towards the sun by alt / tan(elevation)
    let sx = 0, sz = 0;
    if (sun && sun.y > 0.08) { const q = alt / sun.y; sx = sun.x * q; sz = sun.z * q; }
    // 'overhead' passes fly along the line joining the shadow and the aircraft as the camera sees it (drawn alt·k
    // up-screen = north of its ground point), so both cross the view; the rest keep a random heading (shadow only)
    const ax = -sx, az = -sz + alt * (o.viewK ?? 1.19), r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
    const heading = r1 < 0.5 && Math.hypot(ax, az) > 1 ? Math.atan2(az, ax) + (r2 < 0.5 ? Math.PI : 0) + (r3 - 0.5) * 0.28 : r4 * Math.PI * 2;
    const dx = Math.cos(heading), dz = Math.sin(heading);
    const R = Math.hypot(size[0], size[1]) / 2 + Math.hypot(sx, sz) + 250;
    const speed = T.speed * (0.93 + 0.14 * rnd());
    const wing = [{ a: 0, b: 0, dy: 0, ph: rnd() * 6.283 }];
    for (let i = 1; i < m; i++) {
      const side = i % 2 ? 1 : -1, rank = Math.ceil(i / 2);
      wing.push({ a: -T.spacing * 0.8 * rank * (0.9 + 0.2 * rnd()), b: side * T.spacing * rank * (0.9 + 0.2 * rnd()), dy: (rnd() - 0.5) * 6, ph: rnd() * 6.283 });
    }
    out.push({ k, t0: +t.toFixed(3), dur: (2 * R) / speed, type, lib: T.lib, n: m, alt: floor + alt, speed, heading, dx, dz,
      x0: cx + sx, z0: cz + sz, R, sx, sz, wing });
    t += lerp(cfg.interval[0], cfg.interval[1], rnd());
  }
  return out;
}

/**
 * World pose of aircraft `i` of a pass at sim time `t` (pure): position, heading (rad, world XZ like entities),
 * bank / pitch (rad) from a gentle turbulence wobble.
 */
export function aircraftPose(p, i, t, out = {}) {
  const w = p.wing[i] || p.wing[0], s = (t - p.t0) * p.speed - p.R + w.a;
  const ph = w.ph + t * 0.9;
  const lat = w.b + Math.sin(ph * 0.37) * 1.6, up = w.dy + Math.sin(ph * 0.53 + 1) * 1.1;
  out.x = p.x0 + p.dx * s - p.dz * lat;
  out.z = p.z0 + p.dz * s + p.dx * lat;
  out.y = p.alt + up;
  out.heading = p.heading;
  out.bank = Math.sin(ph * 0.37 + 0.6) * 0.05 + Math.sin(ph * 1.7) * 0.012;
  out.pitch = Math.cos(ph * 0.53 + 1) * 0.02;
  return out;
}

/** Passes in the air at sim time t (from a schedule). */
export const activePasses = (sched, t) => sched.filter((p) => t >= p.t0 && t <= p.t0 + p.dur);

// ------------------------------------------------------------------ runtime (browser)

/** Height (m) above the ground at which a shadow twin rides its sun ray. */
const TWIN_H = 30;
/** Engine pitch per type (Argus 10 of the Storch whines, three BMW 132s of the Ju 52 drone). */
const PITCH = { bf109: 1.08, ju52: 0.82, storch: 1.3, ju87: 0.96 };
const SOUND_C = 343;

let SHADOW_ONLY = null;
/** Material of the shadow twins: writes neither colour nor depth (three's shadow pass uses its own depth material). */
function shadowOnly() {
  SHADOW_ONLY ||= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  SHADOW_ONLY.userData.shared = true;
  return SHADOW_ONLY;
}

/**
 * Shadow-map material of a twin: an ordered (4×4 Bayer) dither keeps a fraction `uDens` of its texels, so after the
 * PCF filter the shadow is only partly dark — the soft, washed-out shadow of an aircraft far up the sun ray
 * (penumbra ≈ ray length × 0.0093 rad, the sun's apparent diameter).
 */
function ditherDepth() {
  const m = new THREE.MeshDepthMaterial();
  const u = { value: 1 };
  m.userData.dens = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDens = u;
    sh.fragmentShader = 'uniform float uDens;\n' + sh.fragmentShader.replace('void main() {', `void main() {
  ivec2 bq = ivec2(mod(gl_FragCoord.xy, 4.0));
  int bi = bq.x + bq.y * 4;
  float bt = float(bi == 0 ? 0 : bi == 1 ? 8 : bi == 2 ? 2 : bi == 3 ? 10 : bi == 4 ? 12 : bi == 5 ? 4 : bi == 6 ? 14 : bi == 7 ? 6
    : bi == 8 ? 3 : bi == 9 ? 11 : bi == 10 ? 1 : bi == 11 ? 9 : bi == 12 ? 15 : bi == 13 ? 7 : bi == 14 ? 13 : 5) / 16.0 + 1.0 / 32.0;
  if (bt > uDens) discard;`);
  };
  m.customProgramCacheKey = () => 'flyover-dither';
  return m;
}

let DISC = null;
/** Propeller blur: faint disc, darker tip ring, two soft blade smears (turned every frame for the shimmer). */
function discMaterial() {
  if (DISC) return DISC;
  const N = 128, d = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1, r = Math.hypot(x, y), a = Math.atan2(y, x);
    let v = 0;
    if (r < 1) {
      const smear = Math.pow(Math.max(0, Math.cos(2 * a)), 6) * 0.35 * (0.3 + 0.7 * r);
      const tip = Math.exp(-(((r - 0.93) / 0.05) ** 2)) * 0.35, hub = r < 0.14 ? 0.55 : 0;
      v = Math.min(1, 0.12 + smear + tip + hub) * Math.min(1, (1 - r) / 0.03);
    }
    const k = (j * N + i) * 4; d[k] = d[k + 1] = d[k + 2] = 26; d[k + 3] = Math.round(255 * v);
  }
  const tex = new THREE.DataTexture(d, N, N); tex.needsUpdate = true; tex.magFilter = tex.minFilter = THREE.LinearFilter;
  DISC = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  DISC.userData.shared = true;
  return DISC;
}

/**
 * Nose-down trim that levels a model resting in its three-point attitude: the line from the propeller hub to the
 * elevator hinge (≈ the fuselage datum; the tailplane sits a little above it, hence +1.5°) is brought horizontal.
 */
export function trimPitch(meta) {
  const parts = meta?.parts || [];
  const hub = (parts.find((q) => q.kind === 'prop' && /^prop(_c)?$/.test(q.node)) || parts.find((q) => q.kind === 'prop'))?.pivot;
  const el = parts.find((q) => /^elevator/.test(q.node))?.pivot;
  if (!hub || !el || !(hub[2] - el[2] > 1)) return 0;
  const a = Math.atan2(hub[1] - el[1], hub[2] - el[2]) + 1.5 * Math.PI / 180;
  return Math.max(0, Math.min(16 * Math.PI / 180, a));
}

/** One aircraft: the visible model (+ prop discs) and its shadow-only twin. */
function buildCraft(type, theater, seed, group) {
  const T = FLYOVER_TYPES[type];
  const mk = () => {
    const vis = createVehicleVisual(T.lib, { theater, seed });
    const holder = new THREE.Group(), trim = new THREE.Group();
    holder.rotation.order = 'YXZ'; holder.visible = false;
    holder.add(trim); trim.add(vis.object3d); group.add(holder);
    return { vis, holder, trim };
  };
  const c = { type, a: mk(), b: mk(), discs: [], ready: false, pass: -1 };
  c.a.holder.name = `flyover:${T.lib}`; c.b.holder.name = `flyover-shadow:${T.lib}`;
  Promise.all([c.a.vis.ready, c.b.vis.ready]).then(() => {
    const meta = c.a.vis.meta;
    const trim = trimPitch(meta);
    c.a.holder.userData.trim = trim; // tests: the fuselage datum (0, sin trim, cos trim) flies level
    for (const s of [c.a, c.b]) {
      s.trim.rotation.x = trim;
      const props = (meta?.parts || []).filter((q) => q.kind === 'prop' && !/siren/.test(q.node));
      s.vis.object3d.traverse((o) => {
        if (props.some((q) => q.node === o.name) || (T.retract && T.retract.test(o.name))) o.traverse((m) => { if (m.isMesh) m.visible = false; });
      });
      markShared(s.vis.object3d);
    }
    // blur discs on the visible model, at each prop hub, facing along its axis
    const R = (meta?.dims?.prop_d || 2.8) / 2;
    for (const q of (meta?.parts || []).filter((p) => p.kind === 'prop' && !/siren/.test(p.node))) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), discMaterial());
      // the disc faces along the thrust line: model +z tilted nose-up by the three-point trim
      const ax = new THREE.Vector3(0, Math.sin(trim), Math.cos(trim));
      disc.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -trim);
      disc.position.set(...q.pivot).addScaledVector(ax, 0.05);
      disc.renderOrder = 5; disc.castShadow = false;
      disc.userData.axis = ax;
      c.a.vis.object3d.add(disc); c.discs.push(disc);
    }
    c.a.vis.object3d.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    // the twin draws nothing on screen (no colour, no depth, no AO / x-ray / reflection) — it only fills the shadow map
    c.dither = ditherDepth();
    c.b.vis.object3d.traverse((o) => { if (o.isMesh) { o.material = shadowOnly(); o.customDepthMaterial = c.dither; o.castShadow = true; o.receiveShadow = false; o.userData.aoExclude = true; o.userData.noXray = true; o.renderOrder = -10; } });
    c.ready = true;
  });
  return c;
}

/**
 * Flyovers of a loaded mission (null when off / no vehicle library). Ticks with the vehicle tickers (per displayed
 * frame, after the wind published the interpolated sim time).
 * @param {object} world live world (time, wind, game, groundY, scene)
 * @param {object} def mission definition
 * @param {{renderer?: object, seed?: number, night?: boolean, scene?: THREE.Object3D}} [o]
 * @returns {{group: THREE.Group, config: object, schedule: () => object[], active: () => object[], frame: Function, dispose: Function}|null}
 */
export function createFlyovers(world, def, o = {}) {
  if (!vehicleArtReady()) return null;
  const art = vehicleArtContext();
  const cfg = flyoverConfig(def, { night: o.night ?? art.night });
  if (!cfg || !world) return null;
  const r = o.renderer || null, scene = o.scene || world.scene;
  const size = def.size || [world.width || 100, world.depth || 100];
  const sd = r?.sunDir, sun = sd && sd.y > 0.08 ? { x: sd.x, y: sd.y, z: sd.z } : null;
  let floor = 0;
  if (world.groundY) for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) floor = Math.max(floor, world.groundY(size[0] * i / 10, size[1] * j / 10) || 0);
  const viewK = 1 / Math.tan(((CONFIG.camera?.pitchDeg ?? 40) * Math.PI) / 180);
  const sopt = { seed: o.seed ?? def.seed ?? 1, id: def.id, size, sun, floor, viewK };
  let sched = flyoverSchedule(cfg, sopt, 8);
  const group = new THREE.Group(); group.name = 'flyovers';
  scene?.add(group);
  const pool = [], live = new Map(), sounds = new Set();
  // the refitted shadow frustum starts 40 m above the tallest casters: a twin as long / wide as a Ju 52 reaches past
  // that towards the sun, so while one is up the near plane is pulled back by its size (depth range only, not texels)
  let nearPad = 0;
  const fit0 = r?.fitShadowToView, ownFit = !!r && Object.prototype.hasOwnProperty.call(r, 'fitShadowToView');
  if (fit0) {
    r.fitShadowToView = function (cc) {
      fit0.call(this, cc);
      const cam = this.sun?.shadow?.camera;
      if (nearPad > 0 && cam) { cam.near = Math.max(0.5, cam.near - nearPad); cam.updateProjectionMatrix(); }
    };
  }
  // twins ride just under the tallest casters the frustum is fitted for (renderer.shadowCasterHeight)
  const twinH = () => Math.max(2, Math.min(TWIN_H, (r?.shadowCasterHeight ?? TWIN_H) - 1));
  const P = {}, Q = {};
  const acquire = (type, k) => {
    let c = pool.find((q) => q.type === type && q.pass < 0);
    if (!c) { c = buildCraft(type, art.theater, hashStr(`${def.id}|${pool.length}`), group); pool.push(c); }
    c.pass = k;
    return c;
  };
  /** Half the larger of an aircraft's length / span (m). */
  const c0 = (type) => { const c = pool.find((q) => q.type === type && q.ready); const d = c?.a.vis.meta?.dims || {}; return Math.max(d.length || 12, d.span || 14) / 2; };
  const stateOk = () => { const s = world.game?.state; return s == null || s === 'playing' || s === 'paused'; };
  const audio = () => world.game?.audio || null;

  function place(c, p, i, t) {
    aircraftPose(p, i, t, P);
    const yaw = Math.PI / 2 - P.heading;
    const a = c.a.holder;
    a.position.set(P.x, P.y, P.z); a.rotation.set(P.pitch, yaw, P.bank);
    a.visible = c.ready;
    // shadow twin: slid down the sun ray to TWIN_H above the ground under it (same shadow, inside the shadow frustum)
    const b = c.b.holder;
    if (sun && c.ready) {
      let q = P.y / sun.y;
      const g = world.groundY?.(P.x - sun.x * q, P.z - sun.z * q) || 0;
      q = Math.max(0, (P.y - g - twinH()) / sun.y);
      b.position.set(P.x - sun.x * q, P.y - sun.y * q, P.z - sun.z * q); b.rotation.copy(a.rotation);
      const pen = ((P.y - g) / sun.y) * 0.0093; // penumbra width (m) on the ground
      c.dither.userData.dens.value = Math.max(0.55, Math.min(1, 1.4 - pen / 5));
      b.visible = true;
    } else b.visible = false;
    for (const d of c.discs) {
      d.userData.q0 ||= d.quaternion.clone();
      d.quaternion.copy(d.userData.q0).multiply(_qz.setFromAxisAngle(_Z, (t * 37.7 + i) % (Math.PI * 2)));
    }
  }

  function sound(p, t) {
    const au = audio(); if (!au?.startLoop) return;
    const key = `flyover:${p.k}`;
    const L = au.listener || { x: 0, z: 0 };
    const dist = (tt) => { aircraftPose(p, 0, tt, Q); return Math.hypot(Q.x - L.x, Q.y - (world.groundY?.(L.x, L.z) || 0), Q.z - L.z); };
    const vr = (dist(t) - dist(t - 0.05)) / 0.05; // + = receding
    const rate = (PITCH[p.type] || 1) * SOUND_C / (SOUND_C + Math.max(-150, Math.min(150, vr)));
    aircraftPose(p, 0, t, Q);
    const rec = au.startLoop(key, 'plane_engine', { x: Q.x, z: Q.z }, { range: 650, gain: 0.55 + 0.15 * p.n, rate, fadeIn: 1.2 });
    rec?.handle?.setPos?.({ x: Q.x, z: Q.z });
    if (rec?.handle?.src?.playbackRate) rec.handle.src.playbackRate.value = rate;
    sounds.add(key);
  }
  const silence = (keep = null) => { const au = audio(); for (const k of [...sounds]) if (!keep?.has(k)) { au?.stopLoop?.(k, 0.8); sounds.delete(k); } };

  const api = {
    group, config: cfg,
    schedule: () => sched,
    active: () => [...live.keys()].map((k) => sched[k]),
    /** Per displayed frame. */
    frame(dt, t = world.wind?.t ?? world.time) {
      if (!Number.isFinite(t)) return;
      if (t > sched[sched.length - 1].t0) sched = flyoverSchedule(cfg, sopt, sched.length * 2);
      const on = stateOk();
      group.visible = on;
      const now = on ? activePasses(sched, t) : [];
      const want = new Set(now.map((p) => p.k));
      for (const [k, cs] of live) if (!want.has(k)) { for (const c of cs) { c.pass = -1; c.a.holder.visible = c.b.holder.visible = false; } live.delete(k); }
      nearPad = 0;
      for (const p of now) {
        if (!live.has(p.k)) live.set(p.k, p.wing.map(() => acquire(p.type, p.k)));
        live.get(p.k).forEach((c, i) => place(c, p, i, t));
        const d = c0(p.type);
        nearPad = Math.max(nearPad, d + 5);
      }
      if (world.game?.state === 'playing') { for (const p of now) sound(p, t); silence(new Set(now.map((p) => `flyover:${p.k}`))); } else silence();
    },
    dispose() {
      silence(); stopTick?.();
      if (fit0 && r) { if (ownFit) r.fitShadowToView = fit0; else delete r.fitShadowToView; }
      for (const c of pool) { c.a.vis.dispose(); c.b.vis.dispose(); c.dither?.dispose(); for (const d of c.discs) d.geometry.dispose(); }
      group.removeFromParent(); pool.length = 0; live.clear();
    },
  };
  const stopTick = addVehicleTicker(() => api.frame(), api.dispose);
  world.flyovers = api;
  return api;
}
const _qz = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
