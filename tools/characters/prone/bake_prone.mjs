#!/usr/bin/env node
// bake_prone.mjs - authors the prone animation set on the UAL skeleton (CC0 project code) and writes
//   <out>/prone_clips.json  (per-clip local quaternions + pelvis positions, meta)       -> write_anims.mjs
//   src/art/characters/prone-grips.js (weapon grip frames in hand space, used by every runtime's weapon code)
//
//   node --import ./tools/characters/prone/node-three.mjs tools/characters/prone/bake_prone.mjs [--out=DIR]
// Spec: docs/crawl-animation.md. Keyframes are procedural (elbow-first IK in crawl.mjs / prone_poses.mjs).
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadUAL } from './rig.mjs';
import { CRAWL, crawlPose, shoulderRef } from './crawl.mjs';
import { buildGrips, gripModule } from './grip_build.mjs';
import { extraClips } from './prone_clips.mjs';

const ROOT = new URL('../../../', import.meta.url);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', new URL('out/', import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });

const R = await loadUAL(new URL('assets/characters/anims/base_anims.glb', ROOT).pathname);
const SH = shoulderRef(R);
const clips = [];
/** Sample pose(t) at fps over dur seconds into a clip record; `extra(t, out)` may add per-frame meta. */
export function sample(name, dur, fps, pose, meta = {}, perFrame = null) {
  const n = Math.max(2, Math.round(dur * fps) + 1), frames = [], pf = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur, o = pose(t) || {};
    frames.push(R.snap());
    if (perFrame) pf.push(perFrame(t, o));
  }
  const c = { name, duration: dur, fps, frames, meta: { source: 'procedural keyframes (tools/characters/prone)', license: 'CC0 (project-authored)', ...meta } };
  if (perFrame) c.perFrame = pf;
  clips.push(c);
  return c;
}
const ctx = { R, SH, sample, clips };

// --- low crawl (1.0 s, 0.9 m/s) per carry style; contacts per frame for tests / grounding ---
const contact = (t, o) => ({ el: [o.planted.l ? 1 : 0, o.planted.r ? 1 : 0], ft: [o.footPlanted.l ? 1 : 0, o.footPlanted.r ? 1 : 0] });
const loco = { loop: true, loco: true, prone: true, groundSpeed: CRAWL.v, strokesPerCycle: 2, stroke: CRAWL.stroke, duty: CRAWL.duty };
sample('crawl', CRAWL.T, 30, (t) => crawlPose(R, t, 'long', SH), { ...loco, hold: 'crawl' }, contact);
sample('crawl_unarmed', CRAWL.T, 30, (t) => crawlPose(R, t, 'unarmed', SH), { ...loco }, contact);
sample('crawl_knife', CRAWL.T, 30, (t) => crawlPose(R, t, 'knife', SH), { ...loco, hold: 'crawl' }, contact);
// --- prone idle on the elbows: 16 breaths/min-ish (4 s), slow head scan (8 s loop) ---
const idleAt = (style) => (t) => {
  const breath = Math.sin(2 * Math.PI * t / 4), scan = t / 8;
  const hy = 0.21 * Math.sin(2 * Math.PI * scan) * Math.min(1, 1.25 * Math.abs(Math.sin(2 * Math.PI * scan)) ** 0.3);
  const shift = Math.sin(2 * Math.PI * t / 8 + 0.6);
  return crawlPose(R, 0, style, SH, { breath, headYaw: hy, roll: 0.035 * shift, leg: { l: 0.02 * shift, r: -0.02 * shift } });
};
const still = (t, o) => ({ el: [1, 1], ft: [1, 1] });
sample('crawl_idle', 8, 10, idleAt('long'), { loop: true, prone: true, hold: 'crawl' }, still);
sample('crawl_idle_unarmed', 8, 10, idleAt('unarmed'), { loop: true, prone: true }, still);

// --- aim / shoot / pistol / transitions / death / turns ---
extraClips(ctx);

// --- weapon grip frames (hand space) from the baked poses ---
const grips = buildGrips(ctx);
writeFileSync(new URL('src/art/characters/prone-grips.js', ROOT), gripModule(grips));
writeFileSync(OUT + 'prone_clips.json', JSON.stringify({ skeleton: 'UAL', clips }));
console.log(`baked ${clips.length} clips -> ${OUT}prone_clips.json; grips -> src/art/characters/prone-grips.js`);
for (const c of clips) console.log(`  ${c.name.padEnd(20)} ${c.duration.toFixed(2)} s  ${c.frames.length} frames`);
