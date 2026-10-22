/**
 * Video mode plays M3's whole walkthrough smoothly, in AUTO (the default) and at a fixed 4× (user 2026-10-14: "Also
 * work on performance in mission 3 video mode 4x (I see it gets stuck when exploding the dam and also when the sapper
 * goes through the fence towards the building with the ramp)", "Make sure performance of mission 3 walkthrough is
 * flawless"; 2026-10-15: "Also prioritize fixing perf issues of mission 3 walk through. There should not be any
 * stuckness").
 *
 * From the title card to the end card (chapter cards, action holds, fast waits, the blasts), at 1920×1080, every
 * displayed frame is timed, with:
 *  - the shader programs three compiles during play (none: everything the walkthrough shows was drawn by the load's
 *    warm-up frame — staged ruins, the dam burst, the escape truck, blood, cones, digs, LODs, Game._warmFrame);
 *  - the longest gap between two ticks (the solution driver's own planning, sliced into ≤ 6 ms pieces: driver.mjs
 *    PLAN_SLICE_MS; the shed ramp's 9 s search and the bunker blast's 2 s of path floods are gone);
 *  - the longest single tick (the bunker blast's, now its reinforcements' bodies are built ahead: engine/idle-warm.js);
 *  - the worst frame and the 99th percentile (user 2026-10-14: "In mission 3 there is periods where browser freezes
 *    and the lower left graphs shows gaps of idleness. Fix that." — a gap in the ?debug perf graph is a long frame), and
 *    every long task (Long Tasks API: a stall in a frame or between two — GC, decode, a fit, a freeze).
 * The bounds are the targets on a calm desktop — no frame and no main-thread task over 50 ms, p99 ≤ 25 ms, no tick over
 * 50 ms — as multiples of the run's own median frame (`unit`, at least 16.7 ms: 3×, 1.5×, 3×), so a host whose
 * frames take longer for others' work (a shared machine: CPU and GPU) scales them; a loaded host (unit over 17 ms: its
 * tail grows faster than its median from contention alone) gets 4× / 2× / 4×, and a run that misses on it is played
 * once more. Programs and driver gaps are checked as they are.
 */
export const timeout = 5_400_000;

import { videoPerf } from './video-perf-lib.mjs';

export default async function videoPerfM03(page, t) {
  return videoPerf(page, t, 'm03');
}
