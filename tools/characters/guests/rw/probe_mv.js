import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { start, run, r2, minVertY } from './metrics.js';
export default async function (canvas, W, H, args) {
  const lib = await loadLib(); const h = await makeChar(ROSTER.find(r => r.id === (args.id || 'mcrae')), lib, null); const out = {};
  for (const c of args.clips || ['board_car']) { start(h, c, { loop: false }); const fr = run(h, h.clip(c).duration, 0, { verts: 4 }); out[c] = fr.filter(f => f.vy).map((f, i) => [i * 4, r2(f.vy[0], 3), f.vy[2], r2(f.ball_r.y, 3), r2(f.ball_l.y, 3)]); }
  return { count: 0, result: () => out };
}
