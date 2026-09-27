import { THREE, ROSTER, loadLib, makeChar } from './common.js';
import { start, run, r2 } from './metrics.js';
export default async function (canvas, W, H, args) {
  const lib = await loadLib(); const R = ROSTER.find(r => r.id === (args.id || 'mcrae')); const h = await makeChar(R, lib, null); const out = {};
  const c = args.clip || 'crawl'; const v = args.v ?? 0.9;
  const a = start(h, c, { speed: v }); const d = h.clip(h.animClip).duration / a.getEffectiveTimeScale();
  const fr = run(h, d, v); const K = args.keys || ['hand_l', 'foot_l', 'ball_l', 'calf_l'];
  out.meta = { clip: h.animClip, ts: a.getEffectiveTimeScale(), d };
  out.rows = fr.filter((f, i) => i % 3 === 0).map(f => K.map(k => [r2(f[k].y, 3), r2(f[k].z, 3)]));
  return { count: 0, result: () => out };
}
