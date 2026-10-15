/**
 * No surface draws darker than itself in the first frames after a mission load (cold: a fresh browser).
 * A material texture loading in the background (engine/texture-memory.js loadCompressedTexture: the image, then its
 * GPU compression) is drawn as an empty texture until both are done: M11's gravel ramp came out dark for its first
 * 100–120 frames on a loaded host. The load now waits for every such texture and builds the missions' own scenery
 * (their scripts' `visuals`) before its loading screen closes (game.js loadMission).
 * For M11 (the gravel ramp), M12 (the ashlar platform), M8 (the gravel wadis) and M5 (its cable car's line: a model's
 * first-update build), from `mission:loaded` on (tools/perf/first-frames.mjs):
 *  - no draw samples a not-yet-uploaded (version 0) texture in the first FRAMES frames;
 *  - a watched surface's screen patch (the camera centred on it) is never darker than RATIO × its settled luminance
 *    in its first 120 frames.
 */
import { findChrome, GPU_ARGS, SWIFTSHADER_ARGS } from './harness.mjs';
import { firstFrames, SURFACES } from '../tools/perf/first-frames.mjs';

export const timeout = 900_000;
const FRAMES = 240, RATIO = 0.8;

export default async function (page, t) {
  const h = t.harness;
  for (const mission of ['m11', 'm12', 'm08', 'm05']) {
    const r = await firstFrames({ chromium: h.browser.browserType(), executablePath: findChrome(), args: h.mode === 'swiftshader' ? SWIFTSHADER_ARGS : GPU_ARGS,
      url: h.url, mission, frames: FRAMES, ratio: RATIO });
    t.log(`${mission}: load ${r.loadMs} ms; ${r.frames} frames; frames with a dark draw: ${r.darkDrawFrames}${r.darkDraws.length ? ` (${r.darkDraws.slice(0, 4).map((d) => `${d.what} ${d.frames.join('..')}`).join('; ')})` : ''}`);
    for (const [id, s] of Object.entries(r.surfaces)) {
      t.log(`  ${id}: found at frame ${s.found}, settled luminance ${s.settled}, darkest early ${s.minEarly}, ${s.darkFrames} frames darker than ${RATIO} × settled; first ${s.head.join(' ')}`);
    }
    t.equal(r.errs.length, 0, `${mission}: page errors ${r.errs.join(' | ')}`);
    t.equal(r.errors.length, 0, `${mission}: probe errors ${r.errors.join(' | ')}`);
    t.equal(r.darkDrawFrames, 0, `${mission}: ${r.darkDrawFrames} frames drew a texture not uploaded yet: ${r.darkDraws.map((d) => `${d.what} (frames ${d.frames.join('..')})`).join('; ')}`);
    const ids = Object.keys(r.surfaces);
    t(ids.length >= (SURFACES[mission] || []).length, `${mission}: the watched surface was not found`);
    for (const id of ids) {
      const s = r.surfaces[id];
      t(s.samples > FRAMES / 2 && s.settled > 5, `${id}: ${s.samples} samples, settled luminance ${s.settled} (not on screen?)`);
      t.equal(s.darkFrames, 0, `${id}: ${s.darkFrames} early frames darker than ${RATIO} × its settled luminance ${s.settled} (frames ${s.darkSpan?.join('..')}, darkest ${s.minEarly})`);
    }
  }
}
