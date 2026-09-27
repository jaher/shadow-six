import { THREE, ROSTER } from '/chars/anim_check/common.js';
import { loadCharacter } from '/chars/pipeline/web/charkit.js';
import { loadCALib, createCommando } from '../ca_runtime.js';
import { snap, start, run } from '/chars/anim_check/metrics.js';
export default async function (c, W, H, args) {
  const lib = await loadCALib(); const R = ROSTER.find(r => r.id === (args.id || 'sniper'));
  const h = createCommando(await loadCharacter(R.url), lib); const out = [];
  for (const [a, b] of args.pairs || [['idle', 'crawl_idle']]) {
    start(h, a); run(h, 0.5); let prev = snap(h);
    for (let i = 1; i <= 120; i++) { h.setAnim(b); h.update(1 / 60); const s = snap(h); let mx = 0, at = '';
      for (const j of Object.keys(s)) { const d = s[j].clone().sub(s.pelvis).setY(s[j].y).distanceTo(prev[j].clone().sub(prev.pelvis).setY(prev[j].y)); if (d > mx) { mx = d; at = j; } }
      if (mx > (args.thr || 0.06) || i % 10 == 0) out.push([a + '>' + b, i, h._clipName, +mx.toFixed(3), at, +s.pelvis.y.toFixed(3)]); prev = s; }
  }
  return { count: 0, result: () => out };
}
