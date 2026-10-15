/**
 * Time-sliced load work: the loading screen (its bar, its tips, the ?debug perf graph) keeps drawing while a mission
 * builds. A long synchronous job is written as a generator that may pause where it says `if (due()) yield;`; a driver
 * runs it in slices of a few milliseconds and hands the main thread back between them. The job does the same work in
 * the same order either way — only where the page gets to draw in between changes.
 *
 *   function* job() { for (const x of list) { work(x); if (due()) yield; } return result; }
 *   runSync(job())                        // straight through (node tests, a caller that wants it now)
 *   await runSliced(job(), { budget: 8 }) // ≤ ~8 ms per task; frames are drawn between tasks
 *
 * `due()` is false outside a sliced run, so the same generator runs straight through under runSync or a plain call.
 * Nested generators delegate with `yield*` (their pauses reach the driver).
 * @module engine/slice
 */

/** Main-thread time a sliced job may take per task (ms): two slices and a loading-screen frame fit in 33 ms. */
export const SLICE_MS = 8;

/**
 * `?sliced=0` turns the responsive load off (A/B checks, tests/load-responsive.test.mjs): sliced jobs run straight
 * through, the compile probes, banded uploads and worker decodes step aside — the load as it was, blocking.
 */
export const SLICED = !(typeof location !== 'undefined' && /[?&]sliced=0\b/.test(location.search));

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
let deadline = Infinity;

/** Has the current slice used up its budget? (false outside runSliced: plain calls never pause) */
export function due() {
  return deadline !== Infinity && now() >= deadline;
}

/** Run a generator to its end at once. @returns its return value */
export function runSync(gen) {
  const saved = deadline;
  deadline = Infinity;
  try {
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  } finally { deadline = saved; }
}

let mc = null;
const mq = [];
/** A new task right away (a MessageChannel message: no 4 ms timer clamp; a timer where there is none). */
function postTask() {
  if (typeof MessageChannel === 'undefined') return new Promise((ok) => setTimeout(ok, 0));
  // (node: the port keeps the process alive only while something waits on it)
  if (!mc) { mc = new MessageChannel(); mc.port1.onmessage = () => { const f = mq.shift(); if (!mq.length) mc.port1.unref?.(); f?.(); }; }
  return new Promise((ok) => { mq.push(ok); mc.port1.ref?.(); mc.port2.postMessage(0); });
}

/**
 * Frame pacing. A stream of short tasks still starves rendering: Chrome draws a frame only every ~100 ms when tasks
 * keep coming (measured: the loading screen at 10 fps during a sliced map build). So once a frame is due (FRAME_DUE ms
 * since the last one began) the next slice waits until a frame has been drawn: requestAnimationFrame, then a task after
 * its paint. A hidden page draws no frames: tasks only (and a timer fallback, should frames stop).
 * The loading screen draws at ~35 fps: a frame every ~28 ms leaves the load ~90 % of the main thread (at 60 fps it
 * had ~78 %: M1 / M3 cold loads 5–10 % longer than the blocking load; ~1–2 % at this pace).
 */
const FRAME_DUE = 24;
/**
 * Work between two frames, all sliced jobs together (ms): a slice also ends this long after the last frame began, so
 * several jobs running at once (the map build, the texture pump, a compile wait) still leave a frame every ~28 ms.
 */
const FRAME_WORK = 26;
let lastFrame = -Infinity, rafOn = false, frameWaiters = [], stalled = false;
/** End of a slice of `budget` ms starting now (never less than 1 ms of work; frames not coming: the budget alone). */
const sliceEnd = (budget) => { const t = now(); return stalled ? t + budget : Math.min(t + budget, Math.max(t + 1, lastFrame + FRAME_WORK)); };
function onFrame() {
  lastFrame = now();
  stalled = false;
  const w = frameWaiters;
  frameWaiters = [];
  // continue after this frame's paint, not inside its rAF callbacks (that would hold the paint)
  for (const ok of w) postTask().then(ok);
  if (frameWaiters.length) requestAnimationFrame(onFrame); else rafOn = false;
}
function afterFrame() {
  return new Promise((ok) => {
    let done = false;
    const go = () => { if (!done) { done = true; ok(); } };
    frameWaiters.push(go);
    // (no frame coming — a hidden, occluded or frozen page: go on anyway, and pace by tasks until frames come back)
    setTimeout(() => { if (!done) { stalled = true; go(); } }, 100);
    if (!rafOn) { rafOn = true; requestAnimationFrame(onFrame); }
  });
}

/**
 * Resolve on a new task once the page has had its turn: input, and a frame whenever one is due (see FRAME_DUE).
 */
export function nextTask() {
  const visible = typeof document === 'undefined' || !document.hidden;
  if (visible && !stalled && typeof requestAnimationFrame === 'function' && now() - lastFrame >= FRAME_DUE) return afterFrame();
  // (stalled: one frame request stays out — the frame that answers it ends the stall)
  if (stalled && visible && !rafOn && typeof requestAnimationFrame === 'function') { rafOn = true; requestAnimationFrame(onFrame); }
  return postTask();
}

/** Resolve after `ms` (a timer: lets the GPU / a worker get on with it while the page draws). */
export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Run a generator in slices of `budget` ms, yielding to the page between them.
 * @param {Generator} gen
 * @param {{budget?: number, cancelled?: () => boolean}} [o] cancelled: checked between slices (the load was replaced:
 *   the job is abandoned — gen.return() runs its finally blocks)
 * @returns {Promise<any>} the generator's return value (undefined when cancelled)
 */
export async function runSliced(gen, o = {}) {
  if (!SLICED) return runSync(gen);
  const budget = o.budget ?? SLICE_MS;
  for (;;) {
    const saved = deadline;
    deadline = sliceEnd(budget);
    let r;
    try { r = gen.next(); } finally { deadline = saved; }
    if (r.done) return r.value;
    await nextTask();
    if (o.cancelled?.()) { try { gen.return(undefined); } catch { /* its own cleanup failed: nothing to add */ } return undefined; }
  }
}

/**
 * One step of a sliced job, inside someone else's task (a pump that interleaves several jobs): gen.next() with due()
 * turning true after `budget` ms (or the enclosing slice's end, whichever comes first).
 * @returns {IteratorResult<any>}
 */
export function stepFor(gen, budget = SLICE_MS) {
  const saved = deadline;
  deadline = Math.min(saved, sliceEnd(budget));
  try { return gen.next(); } finally { deadline = saved; }
}

/**
 * Sliced loop over an array (or a count): `fn(item, i)` for each, pausing when the slice is used up.
 * @template T @param {T[]|number} list @param {(x: T, i: number) => void} fn
 */
export function* eachSliced(list, fn) {
  const n = typeof list === 'number' ? list : list.length;
  for (let i = 0; i < n; i++) {
    fn(typeof list === 'number' ? i : list[i], i);
    if (due()) yield;
  }
}
