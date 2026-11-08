/**
 * No flicker when a mission opens in video mode, AUTO (user 2026-11-08: "I see some flickering when opening mission 02
 * in debug mode, auto speed, is this a general problem across missions, please fix"). It was, in all 21 missions:
 *  - the clothing flutter (art/cloth-wind.js) measured each man's velocity from his position between two draws over sim
 *    time; the load's warm-up frame draws him where he was built (the world origin) at sim time 0 and the clock stands
 *    through the loading screen and the title card, so play's first frame saw a 100 m+ move in 1/60 s (M2's Green Beret
 *    705 m/s, M18 1410 m/s) and the shader, dividing by the speed capped at 20 m/s, flung coats, smocks and webbing
 *    metres out — huge dark spiky "capes" that shrank over half a second, blinking frame to frame;
 *  - a vision cone whose guard turned his head out of its pre-built sector (render/vision-cone.js) was drawn with a slice
 *    missing, or not at all, until the budgeted rebuild landed a few frames later (cones blinking).
 *
 * Every frame the game draws from the title card into the first seconds of play after ▶ Start is read back as a
 * box-filtered thumbnail (tools/perf/flicker-probe.js: no stall, the page's own requestAnimationFrame pacing) and searched
 * for A-B-A blinks (tools/perf/flicker-detect.mjs: a region of the 80 × 45 grid — 16 × 16 px at 1280 × 720 — that changes
 * sharply and changes back within 3 frames, a blob you see: 4 cells or more, or 40 levels; where the camera moved > 3 px
 * between those frames the change is the camera's, counted apart). And the two mechanisms directly: the flutter velocity every man is drawn with (≤ 30 m/s: no
 * man is carried faster), every shown cone's drawn window inside its sector. M2 (the report), M3 and M9 (snow and desert,
 * cones in the opening shots).
 */
import { flickerProbe } from '../tools/perf/flicker-probe.js';
import { detectFlicker, describe, visibleBlink } from '../tools/perf/flicker-detect.mjs';

export const timeout = 900_000;

const MISSIONS = (process.env.FLICKER_MISSIONS || 'm02,m03,m09').split(',');
const PLAY_MS = 5000;

/**
 * In the page: per drawn frame, shown cones whose drawn window sticks out of their sector (a slice missing). The cones
 * themselves are then left out of the picture the blink search reads (layer 31): a guard's cone turning with his head or
 * sliding with him as he walks along a wall moves across 16-px cells in a frame or two — motion, read as A-B-A by a cell
 * test — so a cone's blinks are judged by its mechanism here (window inside the sector), not by its pixels.
 */
function coneWatch() {
  const g = window.shadowSix, C = g.cones, W = (window.__coneWatch = { frames: 0, cut: 0, worst: 0, at: [] });
  const up = C.update;
  C.update = function (...a) {
    const r = up.apply(this, a);
    W.frames++;
    for (const c of C.cones.values()) { c.nearMesh.layers.set(31); c.farMesh.layers.set(31); }
    for (const [e, c] of C.cones) {
      const S = c._sector;
      if (!S || !c.group.visible) continue;
      const d = c.drawnWindow(), mid = (S.a0 + S.a1) / 2, dw = d.heading - mid;
      const out = Math.abs(dw - 2 * Math.PI * Math.round(dw / (2 * Math.PI))) + d.halfFov - (S.a1 - S.a0) / 2;
      if (out > 1e-6) { W.cut++; W.worst = Math.max(W.worst, out); if (W.at.length < 5) W.at.push(`e${e.id} t${g.world.time.toFixed(2)} ${(out * 57.3).toFixed(1)}°`); }
    }
    return r;
  };
}

export default async function openingFlicker(page, t) {
  const url = t.harness.url;
  page.setDefaultTimeout(240000);
  await page.context().addInitScript(flickerProbe, { maxW: 80 });
  for (const id of MISSIONS) {
    await page.goto(`${url}/index.html?debug&walkthrough=${id}&speed=auto`);
    await page.waitForFunction((m) => document.querySelector('#wt-card[data-kind=intro]') && window.shadowSix?.missionDef?.id === m, id, { timeout: 300000 });
    await page.waitForTimeout(1500);
    await page.evaluate(coneWatch);
    await page.evaluate(() => { const P = window.__flk; P.frames.length = 0; P.cloth.max = 0; P.cloth.n = 0; P.cloth.at.length = 0; });
    await page.locator('#wt-card [data-act=start]').click();
    await page.waitForFunction(() => window.shadowSix.world.time > 0, null, { timeout: 120000 });
    await page.waitForTimeout(PLAY_MS + 200); // (+ the last frames' readbacks)
    const r = await page.evaluate(() => { const P = window.__flk; P.on = false; return { frames: P.frames.filter((f) => f.px), cloth: P.cloth, err: P.err, cones: window.__coneWatch }; });
    await page.evaluate(() => { window.__flk.on = true; });
    t(!r.err, `${id}: probe ran (${r.err || 'ok'})`);
    const played = r.frames.filter((f) => f.m.st === 'playing' && f.m.wt > 0).length;
    t(played > 60, `${id}: ${r.frames.length} frames read back, ${played} of play`);
    t(r.cloth.max <= 30, `${id}: no man drawn with his coat flung out (flutter velocity max ${r.cloth.max} m/s, ${r.cloth.n} uploads > 30: ${JSON.stringify(r.cloth.at.slice(0, 4))})`);
    t(r.cones.cut === 0, `${id}: no cone drawn with a slice missing (${r.cones.cut} cone-frames of ${r.cones.frames} frames, worst ${(r.cones.worst * 57.3).toFixed(1)}°: ${r.cones.at.join(' ')})`);
    const det = detectFlicker(r.frames, { grid: [80, 45], T: 16, hidden: (m) => m.ld >= 0.99 || m.b === 1 });
    const seen = det.events.filter(visibleBlink);
    t.log(`${id}: ${det.stats.analysed} frames analysed, ${det.stats.cameraMotion} changes carried by the camera, ${det.stats.lowFps} across frames slower than ${det.stats.maxGap} ms, ${det.events.length - seen.length} one-cell edge steps`);
    t(seen.length === 0, `${id}: no A-B-A flicker from the title card into play, cones aside (${seen.length}${seen.length ? ': ' + seen.slice(0, 3).map((e) => describe(e, 45)).join(' / ') : ''})`);
  }
}
