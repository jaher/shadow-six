import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { start, run, r2 } from './metrics.js';
const J = ['pelvis', 'Head', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r', 'calf_l', 'calf_r', 'upperarm_r', 'clavicle_r', 'spine_03'];
export default async function (canvas, W, H, args) {
  const lib = await loadLib(); const h = await makeChar(ROSTER.find(r => r.id === (args.id || 'mcrae')), lib, null); const out = {};
  for (const c of args.clips || ['go_prone', 'get_up', 'board_car']) {
    start(h, c, { loop: false }); const fr = run(h, h.clip(c).duration, 0); const rows = [];
    for (let i = 1; i < fr.length; i++) { let mx = 0, at = ''; for (const j of J) { const d = fr[i][j].distanceTo(fr[i - 1][j]); if (d > mx) { mx = d; at = j; } } if (mx > 0.09) rows.push([i, r2(mx, 3), at, fr[i].pelvis.toArray().map(x => r2(x, 2))]); }
    out[c] = rows;
  }
  return { count: 0, result: () => out };
}
