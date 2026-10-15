/**
 * Shader warm-up that never freezes the page (KHR_parallel_shader_compile). three compiles a material's program the
 * first time it is drawn, and that first use waits until the driver has linked it: the load's warm-up frames (every
 * material of the map × every pass) held the main thread for 5–20 s, one program after the other.
 *
 * compileAhead(renderer, frame) runs the warm-up frame as a PROBE first:
 *  1. the same frame, except that a draw whose program three has just created is skipped right there — before the
 *     first use that would wait. three has issued that program's compile + link by then, and the driver links all of
 *     them in parallel (on the RTX 5090 test box: 8 heavy programs, 10.4 s one by one, 5.5 s side by side);
 *  2. COMPLETION_STATUS polled between tasks (no query ever waits) until every new program is linked;
 *  3. each program's first use (its uniform and attribute tables) a few per task;
 * after which the caller draws the frame for real: no draw waits for a compile any more. Same programs (three keys
 * them by their source: the probe creates exactly the ones the real frame uses), same frame.
 *
 * Only draws that every frame redraws are skipped in the probe: the scenes passed in `scenes` (the world scene, its
 * decal and overlay scenes — including the water mirror and x-ray passes that redraw them), shadow maps (three draws
 * those with no scene) and everything inside `composer.render` (post passes). Anything else — a one-time bake inside
 * the frame (an FFT spectrum, an atlas) — draws as before (its program compiles as before). `all: true` skips every
 * new-program draw (a warm-up whose draws only exist to compile).
 *
 * Without the extension (or with a lost context) it returns at once: the real frame compiles as it always did.
 * @module engine/parallel-compile
 */
import { nextTask, sleep, SLICE_MS, SLICED } from './slice.js';

/** Thrown from a new program's first use inside the probe: unwinds that one draw (caught in renderBufferDirect). */
const SKIP = { compileAhead: 'skip' };

/** Has this renderer's context got KHR_parallel_shader_compile? (getExtension also enables it) */
export function parallelCompileAvailable(renderer) {
  try {
    const gl = renderer?.getContext?.();
    return !!(gl && !gl.isContextLost() && gl.getExtension('KHR_parallel_shader_compile'));
  } catch { return false; }
}

/** Totals over the session (debug / tests). */
export const compileAheadStats = { runs: 0, programs: 0, skipped: 0, waitMs: 0, firstUseMs: 0, probeMs: 0, timeouts: 0 };

/**
 * Probe `frame` (a synchronous function that renders), wait for its new programs without blocking, prepare their first
 * use; the caller then renders for real.
 * @param {import('three').WebGLRenderer} renderer
 * @param {() => void} frame
 * @param {{scenes?: object[], composer?: {render: Function}|null, all?: boolean, timeout?: number,
 *   budget?: number, cancelled?: () => boolean, scene?: object, maxPerPart?: number, extra?: object[],
 *   textures?: boolean}} [o] `scene`: a whole-map frame of that scene, probed in parts (framesInParts, with `extra`)
 * @returns {Promise<{programs: number, skipped: number, probeMs: number, waitMs: number, firstUseMs: number,
 *   timedOut: boolean}|null>} null: not available here (the caller's frame compiles as it always did)
 */
export async function compileAhead(renderer, frame, o = {}) {
  if (!SLICED || !parallelCompileAvailable(renderer)) return null;
  const list = renderer.info?.programs;
  if (!Array.isArray(list) || typeof renderer.renderBufferDirect !== 'function') return null;
  const t0 = performance.now(), budget = o.budget ?? SLICE_MS;
  const scenes = new Set((o.scenes || []).filter(Boolean));
  const created = [], wrapped = [], drawn = new Set(), used = new Set();
  let ctx = null, skipped = 0, inComposer = 0;
  // (a part's run creates programs until its slice is used; the draws after that wait for the next run of the part:
  // three builds each new program's source in JS, 1–3 ms apiece)
  let runT0 = 0, newInRun = 0, deferred = false;
  const runBudget = o.scene ? budget : Infinity;
  const skippable = (scene) => !!(o.all || inComposer > 0 || scene == null || scenes.has(scene));
  // A skippable draw ends right after three has picked (or created) its program: every program's first use / uniform
  // fetch throws inside one, so the probe neither waits for a link nor draws, uploads or binds anything there (the
  // real frame does, its textures uploaded beforehand a slice at a time). Draws elsewhere run as they always did.
  const wrap = (p) => {
    if (!p || typeof p.getUniforms !== 'function') return;
    const realU = p.getUniforms, realA = p.getAttributes;
    wrapped.push([p, realU, realA]);
    // (`used`: every program the frame will draw with — new ones, and older ones never used yet: renderer.compileAsync
    // makes programs it never uses; their first use, its queries, would land in the real frame)
    p.getUniforms = function getUniformsProbe() { if (ctx?.skip) { used.add(p); throw SKIP; } return realU.call(this); };
    p.getAttributes = function getAttributesProbe() { if (ctx?.skip) { used.add(p); throw SKIP; } return realA.call(this); };
  };
  // three's program list: acquireProgram pushes a new WebGLProgram right after constructing it (compile + link issued)
  const push = list.push;
  const pushProbe = function pushProbe(...ps) {
    for (const p of ps) {
      if (!p || typeof p.getUniforms !== 'function') continue;
      if (ctx?.skip) { created.push(p); newInRun++; } // (a program a non-skippable draw creates waits there, as it always did)
      wrap(p);
    }
    return push.apply(this, ps);
  };
  const rbd = renderer.renderBufferDirect;
  const renderBufferDirectProbe = function renderBufferDirectProbe(camera, scene, geometry, material, object, group) {
    const skip = skippable(scene);
    if (skip && newInRun > 0 && performance.now() - runT0 > runBudget) { deferred = true; skipped++; return undefined; }
    const prev = ctx;
    ctx = { skip };
    if (material) drawn.add(material);
    try { return rbd.call(this, camera, scene, geometry, material, object, group); } catch (e) {
      if (e !== SKIP) throw e;
      skipped++;
      return undefined;
    } finally { ctx = prev; }
  };
  const comp = o.composer, compRender = comp?.render;
  const renderProbe = function renderProbe(...a) { inComposer++; try { return compRender.apply(this, a); } finally { inComposer--; } };
  /** One probe: the hooks in for the duration of `f` (synchronous), out again whatever happens. */
  const probe = (f) => {
    runT0 = performance.now(); newInRun = 0; deferred = false;
    for (const p of list) wrap(p);
    list.push = pushProbe;
    renderer.renderBufferDirect = renderBufferDirectProbe;
    if (comp && typeof compRender === 'function') comp.render = renderProbe;
    try {
      f();
    } finally {
      if (comp && typeof compRender === 'function') comp.render = compRender;
      renderer.renderBufferDirect = rbd;
      if (Object.prototype.hasOwnProperty.call(list, 'push')) delete list.push;
      if (list.push !== push) list.push = push;
      for (let i = wrapped.length - 1; i >= 0; i--) { const [p, u, a] = wrapped[i]; p.getUniforms = u; p.getAttributes = a; }
      wrapped.length = 0;
      // a skipped shadow draw left the sun's map unfinished: the next frame redraws it
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    }
    return deferred; // (true: run this part again)
  };
  // (`o.scene`: a whole-map frame is probed in parts — a share of the scene's drawables each, one task each)
  if (o.scene) await framesInParts(o.scene, frame, { maxPerPart: o.maxPerPart, run: probe, extra: o.extra });
  else probe(frame);
  const probeMs = performance.now() - t0;
  // 2. linked? (COMPLETION_STATUS never waits; programs finish roughly in order: one query per poll while waiting)
  const t1 = performance.now(), limit = o.timeout ?? 60000;
  for (const p of created) used.add(p);
  const pending = [...used];
  let i = 0, timedOut = false;
  while (i < pending.length) {
    const p = pending[i];
    let ready = true;
    try { ready = !p.program || p.isReady(); } catch { ready = true; }
    if (ready) { i++; continue; }
    if (performance.now() - t1 > limit) { timedOut = true; break; }
    if (o.cancelled?.()) break;
    await sleep(6);
  }
  const waitMs = performance.now() - t1;
  // 3. first use (uniform / attribute tables: a few queries each; a no-op for a program used before), a slice at a time
  const t2 = performance.now();
  let s0 = performance.now();
  for (const p of pending) {
    if (!p.program || (timedOut && !p.isReady())) continue; // (never one still linking: that would wait)
    try { p.getUniforms(); p.getAttributes(); } catch { /* reported by three on its own first use */ }
    if (performance.now() - s0 > budget) { await nextTask(); s0 = performance.now(); }
  }
  const firstUseMs = performance.now() - t2;
  // 4. the textures the frame samples, uploaded now a slice at a time (the real frame would upload them all at once)
  const t3 = performance.now();
  const uploads = o.textures === false ? 0 : await uploadTextures(renderer, drawn, budget, o.cancelled);
  const uploadMs = performance.now() - t3;
  const S = compileAheadStats;
  S.runs++; S.programs += created.length; S.skipped += skipped; S.waitMs += waitMs; S.firstUseMs += firstUseMs; S.probeMs += probeMs;
  S.uploads = (S.uploads || 0) + uploads; S.uploadMs = (S.uploadMs || 0) + uploadMs;
  if (timedOut) S.timeouts++;
  return { programs: created.length, skipped, probeMs: Math.round(probeMs), waitMs: Math.round(waitMs), firstUseMs: Math.round(firstUseMs), uploads, uploadMs: Math.round(uploadMs), timedOut };
}

/** Material slots that hold textures (three's built-in materials). */
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap', 'bumpMap', 'displacementMap',
  'lightMap', 'specularMap', 'specularIntensityMap', 'specularColorMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap', 'gradientMap', 'matcap'];

/**
 * Upload (renderer.initTexture: three's own upload path, the one its first draw would take) every texture these
 * materials sample that is not on the GPU yet — slots and uniforms, those added by onBeforeCompile included — a few
 * per task. Render targets are left alone. @returns {Promise<number>} textures uploaded
 */
export async function uploadTextures(renderer, materials, budget = SLICE_MS, cancelled = null) {
  const todo = new Set(), props = renderer.properties;
  const take = (t) => {
    if (Array.isArray(t)) { for (const x of t) take(x); return; }
    if (!t?.isTexture || t.isRenderTargetTexture || t.isVideoTexture || !(t.version > 0)) return;
    if (props.get(t).__version === t.version) return; // on the GPU already
    todo.add(t);
  };
  for (const m of materials) {
    for (const k of TEX_SLOTS) take(m[k]);
    for (const u of Object.values(m.uniforms || {})) take(u?.value);
    const mu = props.get(m)?.uniforms; // the program's uniforms (onBeforeCompile ones too)
    if (mu && mu !== m.uniforms) for (const u of Object.values(mu)) take(u?.value);
  }
  let n = 0, s0 = performance.now();
  for (const t of todo) {
    if (cancelled?.()) break;
    if (props.get(t).__version === t.version) continue; // (a sibling sharing its source went up meanwhile)
    try { renderer.initTexture(t); n++; } catch (e) { console.warn('[parallel-compile] upload failed', e); }
    if (performance.now() - s0 > budget) { await nextTask(); s0 = performance.now(); }
  }
  return n;
}

/** Objects a camera draws (meshes, points, lines, sprites). */
const drawable = (o) => o.isMesh || o.isPoints || o.isLine || o.isSprite;

/**
 * Run a whole-map frame in parts, one task each: the scene's drawable objects visible now are split into groups of at
 * most `maxPerPart`; part k draws with the other groups hidden (lights are never hidden: every part has the frame's
 * light set, so its programs are the frame's own). Each part is one call of `run(frame)` (default: frame()). A
 * part's cost is its share of the scene; what the frame does besides drawing (its setup) repeats per part. `extra`:
 * objects off the scene that the frame adds for itself (staged ruins…): split among the parts like the rest.
 * @param {import('three').Object3D} scene @param {() => void} frame
 * @param {{maxPerPart?: number, run?: (frame: () => void) => void, extra?: import('three').Object3D[]}} [o]
 * @returns {Promise<number>} parts
 */
export async function framesInParts(scene, frame, o = {}) {
  const items = [];
  const add = (x) => { if (drawable(x) && x.visible) items.push(x); };
  scene.traverse(add);
  for (const e of o.extra || []) if (e && e.parent !== scene) e.traverse(add);
  const per = Math.max(1, o.maxPerPart ?? PART_DRAWABLES), parts = Math.max(1, Math.ceil(items.length / per));
  const run = o.run || ((f) => { f(); return false; });
  let runs = 0;
  for (let k = 0; k < parts; k++) {
    const lo = k * per, hi = Math.min(items.length, lo + per);
    // `run` returns true when it left draws of this part for another run (engine/parallel-compile.js compileAhead)
    for (let again = true; again;) {
      const hidden = [];
      for (let i = 0; i < items.length; i++) if ((i < lo || i >= hi) && items[i].visible) { items[i].visible = false; hidden.push(items[i]); }
      try { again = run(frame) === true && ++runs < 4 * parts + 64; } finally { for (const x of hidden) x.visible = true; }
      if (again || k + 1 < parts) await nextTask();
    }
  }
  return parts;
}

/**
 * Drawables per part of a whole-map warm-up frame (framesInParts). A part also pays the frame's own setup (the scene's
 * matrices, its traversals, the frame's extra passes: ~20–40 ms on a busy host) whatever its size: fewer, larger parts
 * (a probe part's new programs are bounded by time anyway — compileAhead defers the rest to another run).
 */
export const PART_DRAWABLES = 600;
