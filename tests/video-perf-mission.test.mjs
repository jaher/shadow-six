/**
 * Video mode plays a mission's whole walkthrough smoothly (tests/video-perf-m03.test.mjs, any mission):
 *   VIDEO_PERF_MISSION=m11 node tests/run.mjs video-perf-mission      (VIDEO_PERF_SPEEDS=auto or =4: one run alone)
 * The same bounds as M3's: no shader program compiled during play (the load's warm-up drew everything the walkthrough
 * shows), no driver gap between ticks over 15 ms (sliced plans), no tick, frame or main-thread task over 3× the run's
 * median frame (4× on a loaded host), p99 within 1.5× (2×) — and the walkthrough wins unseen. It also reports the
 * longest stretch with no player order (user 2026-10-21: "Also make sure performance is flawless when working on
 * these solutions", "Good FPS, no delays, no long pauses").
 */
export const timeout = 5_400_000;

import { videoPerf } from './video-perf-lib.mjs';

export default async function videoPerfMission(page, t) {
  const mission = process.env.VIDEO_PERF_MISSION || 'm03';
  t.log(`mission ${mission}`);
  return videoPerf(page, t, mission);
}
