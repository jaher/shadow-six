import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { start, run, r2 } from './metrics.js';
export default async function (canvas, W, H, args) {
  const lib = await loadLib(); const h = await makeChar(ROSTER.find(r => r.id === 'mcrae'), lib, null); const out = {};
  for (const c of ['idle', 'walk_fast']) { const cl = h.clip(c); out[c] = { ud: cl.userData, tracks: cl.tracks.length, pel: Array.from(cl.tracks.find(t => t.name === 'pelvis.position').values.slice(0, 6)) }; }
  const a = start(h, 'walk', { speed: 2.25 }); const fr = run(h, 0.8, 2.25);
  out.rows = fr.filter((f, i) => i % 3 === 0).map(f => [r2(f.ball_l.y, 3), r2(f.ball_l.z, 3), r2(f.pelvis.z, 3)]); out.clip = h.animClip; out.ts = a.getEffectiveTimeScale();
  return { count: 0, result: () => out };
}
