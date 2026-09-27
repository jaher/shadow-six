// floating-island check at bind pose vs idle@0 vs idle@1 (fit metrics)
import * as THREE from 'three';
import { setup, measure } from '/chars/fit/metrics.js';
import { makeRuntime } from '/chars/fit/rt.js';
export default async function () {
  const A = window.__args; const RT = await makeRuntime('enemy'); const out = {};
  for (const id of A.ids) {
    const { h } = await RT.make({ id, url: `/chars/enemies/out/${id}.glb` }); const ctx = setup(h); const r = {};
    h.mixer.stopAllAction(); h.object.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); }); h.object.updateMatrixWorld(true);
    r.bind = measure(ctx, h, { islandsCheck: true }).floating;
    for (const t of [0, 1]) { h.setAnim('idle', { fade: 0 }); const a = h._holdAction; a.time = t; h.update(0); h.object.updateMatrixWorld(true); r['idle' + t] = measure(ctx, h, { islandsCheck: true }).floating; }
    out[id] = r;
  }
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
