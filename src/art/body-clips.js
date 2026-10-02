/**
 * Project-authored body-transport and buddy-rescue clips (docs/bodies-design.md §C.10), built at library load from
 * the clips every kit already has on the shared UAL skeleton (CC0: Quaternius UAL + the project's keyed poses). A clip
 * here is a stack of LAYERS sampled at 30 fps: each layer takes a source clip at a mapped time for a bone set and
 * blends over what is below with a time-varying weight (slerp for rotations, lerp for the pelvis position). Because
 * the recipes only name bones and clips, the same recipe works for commandos_a/b, enemies and guests alike, and a kit
 * without a source clip simply does not get that derived clip (unit-anim-map falls back).
 *
 *   addBodyClips(lib)          // lib = {clips: Map<name, AnimationClip>, meta}; returns the names added
 *
 * Paired transitions (lift_to_shoulder + the load's 'carried' pose, drag_grab + being_dragged) share their timing
 * with the gameplay durations (CONFIG.bodies / CONFIG.abilities.carry), so both skeletons move in step.
 * @module art/body-clips
 */
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, Quaternion, Vector3, Euler } from 'three';

const FPS = 30;
const RX = {
  all: /.*/,
  arms: /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/,
  armL: /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_.*_l$|^(clavicle|upperarm|lowerarm|hand)_l$/,
  armR: /^(clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_.*_r$|^(clavicle|upperarm|lowerarm|hand)_r$/,
  upper: /^(spine_0[123]|neck_01|head|clavicle|upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/i,
  spine: /^spine_0[123]$/,
  head: /^(neck_01|head)$/i,
  legs: /^(thigh|calf|foot|ball)_/,
  legR: /^(thigh|calf|foot|ball)_r$/,
  lower: /^(pelvis|thigh|calf|foot|ball)/,
};

const bone = (trackName) => trackName.slice(0, trackName.lastIndexOf('.'));
const prop = (trackName) => trackName.slice(trackName.lastIndexOf('.') + 1);

/** Samplers per source clip (interpolants keyed by track name). */
function sampler(clip) {
  const map = new Map();
  for (const t of clip.tracks) {
    const p = prop(t.name);
    if (p !== 'quaternion' && !(p === 'position' && bone(t.name) === 'pelvis')) continue;
    map.set(t.name, t.createInterpolant());
  }
  return { clip, dur: clip.duration, map };
}

/** Time mapping helpers (τ = output time in s, d = output duration). */
export const T = {
  /** a fixed frame of the source (seconds or a 0..1 fraction when `frac`) */
  at: (s, frac = false) => (τ, src) => (frac ? s * src.dur : s),
  /** the source looped at its own speed (× rate) */
  loop: (rate = 1, offset = 0) => (τ, src) => ((τ * rate + offset) % src.dur + src.dur) % src.dur,
  /** a source span [a, b] (fractions of the source) stretched over the output span [t0, t1] */
  span: (a, b, t0, t1) => (τ, src) => {
    const k = Math.min(1, Math.max(0, (τ - t0) / Math.max(1e-6, t1 - t0)));
    return (a + (b - a) * k) * src.dur;
  },
};

/** Weight helpers: constant, ramps (smoothstep) and pulses over the output time. */
export const W = {
  one: () => 1,
  k: (v) => () => v,
  ramp: (t0, t1, from = 0, to = 1) => (τ) => {
    const k = Math.min(1, Math.max(0, (τ - t0) / Math.max(1e-6, t1 - t0)));
    const s = k * k * (3 - 2 * k);
    return from + (to - from) * s;
  },
  /** in over [a, b], hold, out over [c, d] */
  hump: (a, b, c, d, peak = 1) => (τ) => peak * Math.min(W.ramp(a, b)(τ), 1 - W.ramp(c, d)(τ)),
  wave: (amp, period, base = 0, phase = 0) => (τ) => base + amp * (0.5 + 0.5 * Math.sin((τ / period + phase) * Math.PI * 2)),
};

const _q = new Quaternion(), _q2 = new Quaternion(), _v = new Vector3(), _v2 = new Vector3(), _e = new Euler();

/**
 * Build a clip from layers.
 * @param {Map<string, import('three').AnimationClip>} clips source library
 * @param {string} name output clip name
 * @param {{dur:number, layers:{src:string, bones?:RegExp, time?:Function, w?:Function, add?:{bone:string, axis:'x'|'y'|'z', deg:Function}}[]}} r
 * @returns {import('three').AnimationClip|null} null when a required source clip is missing
 */
export function buildClip(clips, name, r) {
  const srcs = [];
  for (const [i, L] of r.layers.entries()) {
    if (L.add) { srcs.push(null); continue; }
    const c = clips.get(L.src);
    if (!c && i === 0) return null; // the base layer is required; a missing overlay layer is skipped
    srcs.push(c ? sampler(c) : null);
  }
  const base = srcs[0];
  const names = [...base.map.keys()];
  const n = Math.max(2, Math.round(r.dur * FPS) + 1);
  const times = new Float32Array(n);
  const out = new Map(names.map((k) => [k, new Float32Array(n * (prop(k) === 'position' ? 3 : 4))]));
  for (let i = 0; i < n; i++) {
    const τ = (i / (n - 1)) * r.dur;
    times[i] = τ;
    for (const tn of names) {
      const isPos = prop(tn) === 'position', b = bone(tn), dst = out.get(tn);
      let have = false;
      for (let li = 0; li < r.layers.length; li++) {
        const L = r.layers[li], S = srcs[li];
        if (L.add) {
          if (isPos || L.add.bone !== b || !have) continue;
          const deg = L.add.deg(τ);
          _e.set(0, 0, 0); _e[L.add.axis] = (deg * Math.PI) / 180;
          _q.multiply(_q2.setFromEuler(_e));
          continue;
        }
        if (!S || (L.bones && !L.bones.test(b))) continue;
        // mirror: a left bone takes its right twin's rotation with the axis signs of `L.mirror` (UAL twins)
        const src = L.mirror ? tn.replace(/_l(\.|_)/, '_r$1') : tn;
        if (L.mirror && src === tn) continue;
        const ip = S.map.get(src);
        if (!ip) continue;
        const w = li === 0 || !have ? 1 : Math.min(1, Math.max(0, (L.w || W.one)(τ)));
        if (w <= 0) continue;
        const st = Math.min(S.dur, Math.max(0, (L.time || T.loop())(τ, S)));
        const v = ip.evaluate(st);
        if (isPos) {
          _v2.set(v[0], v[1], v[2]);
          if (!have || w >= 1) _v.copy(_v2); else _v.lerp(_v2, w);
        } else {
          _q2.set(v[0], v[1], v[2], v[3]);
          if (L.mirror) { _q2.x *= L.mirror[0]; _q2.y *= L.mirror[1]; _q2.z *= L.mirror[2]; }
          if (!have || w >= 1) _q.copy(_q2); else _q.slerp(_q2, w);
        }
        have = true;
      }
      if (isPos) { dst[i * 3] = _v.x; dst[i * 3 + 1] = _v.y; dst[i * 3 + 2] = _v.z; } else { _q.normalize(); dst[i * 4] = _q.x; dst[i * 4 + 1] = _q.y; dst[i * 4 + 2] = _q.z; dst[i * 4 + 3] = _q.w; }
    }
  }
  const tracks = names.map((tn) => (prop(tn) === 'position' ? new VectorKeyframeTrack(tn, times, out.get(tn)) : new QuaternionKeyframeTrack(tn, times, out.get(tn))));
  return new AnimationClip(name, r.dur, tracks);
}

/** UAL left/right twin sign pattern for mirrored arm rotations (verified visually: tests/bodies-dragcarry). */
export const MIRROR = [1, -1, -1];

/**
 * The recipes (gameplay durations: CONFIG.bodies / CONFIG.abilities.carry; §C.10 table). `loop` marks loops; `speedOf`
 * copies a source clip's groundSpeed (locomotion rate rule).
 */
export function recipes(mirror = MIRROR) {
  const r = RX;
  return [
    // DRAGGER: crouched hold at the head, hands hooked under the armpits (upper body of the backwards walk)
    ['drag_idle', { dur: 2.0, loop: true, layers: [
      { src: 'crouch_idle', time: T.loop(0.7) },
      { src: 'drag', bones: r.upper, time: T.at(0.12, true), w: W.k(0.85) },
      { add: { bone: 'spine_02', axis: 'z', deg: (τ) => 2.5 * Math.sin((τ / 2.0) * Math.PI * 2) } },
    ] }],
    // walking backwards bent over the load (the backwards walk's legs, a forward-bent back, the hold's arms)
    ['drag_walk', { dur: 0, loop: true, speedOf: 'drag', layers: [
      { src: 'drag', time: T.loop(1) },
      { src: 'crouch_idle', bones: r.spine, time: T.at(0.3, true), w: W.k(0.6) },
      { src: 'drag_idle', bones: r.arms, time: T.at(0), w: W.k(0.8) },
    ] }],
    // KNEELING REACH (helper pose): down on one knee (the kneeling shot's legs), torso bent over, both hands low
    ['kneel_reach', { dur: 1.0, layers: [
      { src: 'kneel_shoot', time: T.at(0.5, true) },
      { src: 'plant', bones: r.upper, time: T.at(0.45, true), w: W.k(0.85) },
    ] }],
    // MG GUNNER at a platform MG (render/mg-mount.js): held down on one knee behind the butt (the kneeling shot's pose
    // at mid-clip, not its stand-kneel-stand cycle), breathing; the arms are IK'd onto the gun's grips
    ['mg_kneel', { dur: 2.4, loop: true, layers: [
      { src: 'kneel_shoot', time: T.at(0.5, true) },
      { add: { bone: 'spine_02', axis: 'z', deg: (τ) => 1.2 * Math.sin((τ / 2.4) * Math.PI * 2) } },
    ] }],
    // kneel at his head (upright torso, one knee down), hook the armpits, then haul into the crouched hold
    ['drag_grab', { dur: 1.0, layers: [
      { src: 'idle', time: T.at(0) },
      { src: 'kneel_reach', time: T.at(0), w: W.ramp(0.0, 0.4) },
      { src: 'drag_idle', time: T.at(0), w: W.ramp(0.62, 1.0) },
    ] }],
    ['drag_release', { dur: 0.6, layers: [
      { src: 'drag_idle', time: T.at(0) },
      { src: 'plant', time: T.at(0.42, true), w: W.hump(0, 0.3, 0.38, 0.6) },
      { src: 'idle', time: T.at(0), w: W.ramp(0.4, 0.6) },
    ] }],
    // SHOULDER: squat, roll him across the shoulders, stand (paired with the load's 'carried' pose)
    ['lift_to_shoulder', { dur: 1.0, layers: [
      { src: 'plant', time: T.span(0.08, 0.42, 0, 0.5) },
      { src: 'carry_idle', time: T.at(0), w: W.ramp(0.45, 1.0) },
    ] }],
    ['drag_to_shoulder', { dur: 1.0, layers: [
      { src: 'drag_idle', time: T.at(0) },
      { src: 'plant', time: T.at(0.4, true), w: W.hump(0, 0.3, 0.5, 0.9) },
      { src: 'carry_idle', time: T.at(0), w: W.ramp(0.5, 1.0) },
    ] }],
    ['shoulder_to_drag', { dur: 0.8, layers: [
      { src: 'carry_idle', time: T.at(0) },
      { src: 'plant', time: T.at(0.4, true), w: W.hump(0, 0.3, 0.45, 0.8) },
      { src: 'drag_idle', time: T.at(0), w: W.ramp(0.45, 0.8) },
    ] }],
    ['put_down', { dur: 0.8, layers: [
      { src: 'carry_idle', time: T.at(0) },
      { src: 'plant', time: T.at(0.45, true), w: W.hump(0, 0.35, 0.5, 0.8) },
      { src: 'idle', time: T.at(0), w: W.ramp(0.5, 0.8) },
    ] }],
    // THE LOAD: dragged on his back by the armpits, arms up past the head, head lolling, heels on the ground
    ['being_dragged', { dur: 2.0, loop: true, layers: [
      { src: 'dead', time: T.at(1, true) },
      { src: 'surrender', bones: r.armR, time: T.at(0.95, true), w: W.k(0.9) },
      { src: 'surrender', bones: r.armL, mirror, time: T.at(0.95, true), w: W.k(0.9) },
      { add: { bone: 'neck_01', axis: 'y', deg: (τ) => 9 * Math.sin((τ / 2.0) * Math.PI * 2) } },
      // legs dragged together (heels close, knees soft): a long coat's skirt folds along them instead of fanning out
      { add: { bone: 'thigh_l', axis: 'z', deg: () => 15 } },
      { add: { bone: 'thigh_r', axis: 'z', deg: () => -15 } },
    ] }],
    // DOWNED (alive, prone): collapse, breathe with a hand under the wound, pull himself along one-armed
    ['downed_fall', { dur: 0.9, layers: [
      { src: 'idle', time: T.at(0) },
      { src: 'crouch_idle', time: T.at(0.2, true), w: W.hump(0, 0.3, 0.45, 0.8) },
      { src: 'crawl_idle', time: T.at(0), w: W.ramp(0.35, 0.85) },
    ] }],
    ['downed_idle', { dur: 3.0, loop: true, layers: [
      { src: 'crawl_idle', time: T.loop(0.6) },
      { src: 'dead_prone', bones: r.armL, time: T.at(1, true), w: W.k(0.8) },
      { add: { bone: 'spine_03', axis: 'z', deg: (τ) => 3 * Math.sin((τ / 3.0) * Math.PI * 2) } },
    ] }],
    ['downed_crawl', { dur: 0, loop: true, speedOf: 'crawl', layers: [
      { src: 'crawl', time: T.loop(1) },
      { src: 'dead_prone', bones: r.legR, time: T.at(1, true), w: W.k(0.85) },
      { src: 'dead_prone', bones: r.armL, time: T.at(1, true), w: W.k(0.5) },
    ] }],
    // MEDIC: kneeling beside him, working with both hands (4.0 s, one dose)
    ['revive_give', { dur: 4.0, loop: true, layers: [
      { src: 'kneel_reach', time: T.at(0) },
      { src: 'use', bones: r.arms, time: T.loop(1), w: W.k(0.6) },
      { add: { bone: 'spine_02', axis: 'x', deg: (τ) => 3 * Math.sin((τ / 1.3) * Math.PI * 2) } },
    ] }],
  ];
}

/**
 * Add the derived clips to a kit's library (idempotent; skips names the kit already has and recipes whose base clip it
 * lacks). @returns {string[]} names added
 */
export function addBodyClips(lib, { mirror = MIRROR, force = false } = {}) {
  if (!lib?.clips) return [];
  const added = [];
  for (const [name, r] of recipes(mirror)) {
    if (lib.clips.has(name) && !force) continue;
    let dur = r.dur;
    if (!dur) dur = lib.clips.get(r.layers[0].src)?.duration || 1;
    const c = buildClip(lib.clips, name, { ...r, dur });
    if (!c) continue;
    lib.clips.set(name, c);
    const m = { source: 'spliced (art/body-clips.js)', license: 'CC0 (project-authored from UAL / keyed poses)', loop: !!r.loop, duration: dur };
    const sm = r.speedOf && lib.meta?.[r.speedOf];
    if (sm?.groundSpeed) { m.groundSpeed = sm.groundSpeed; m.loco = true; if (sm.moveDir) m.moveDir = sm.moveDir; if (sm.reverse) m.reverse = sm.reverse; }
    if (lib.meta) lib.meta[name] = m;
    added.push(name);
  }
  return added;
}
