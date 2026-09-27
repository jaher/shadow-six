import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { start, run, r2, minVertY, snap } from './metrics.js';
export default async function (canvas, W, H, args) {
  const lib = await loadLib(); const out = {};
  for (const R of ROSTER.filter(r => r.group === 'guest')) {
    const h = await makeChar(R, lib, null); h.object.updateMatrixWorld(true);
    const m = h.parts.LOD2; const bind = m.geometry.attributes.position; let mn = 9; for (let i = 0; i < bind.count; i++) mn = Math.min(mn, bind.getY(i));
    const rec = { bindMinY: r2(mn, 3), ratio: h.info.pelvisRatio };
    for (const c of ['idle', 'tied_idle', 'talk', 'crawl_idle', 'stand_up']) { start(h, c); run(h, 0.3); const v = minVertY(h, 1); const s = snap(h); rec[c] = [r2(v[0], 3), v[2], r2(s.ball_l.y, 3), r2(s.foot_l.y, 3), r2(s.pelvis.y, 2), r2(s.Head.y, 2)]; }
    out[R.id] = rec;
  }
  return { count: 0, result: () => out };
}
