// capjob.js - headgear sub-part float check: every island of the headgear mesh vs (other headgear islands + body), neutral pose
import * as THREE from 'three';
import { bake, indexOf, islands, islandGap } from '/chars/fit/geom.js';
import { makeRuntime } from '/chars/fit/rt.js';
export default async function (canvas, W, H) {
  const A = window.__args; const RT = await makeRuntime(A.kind);
  async function one(i) {
    const c = A.chars[i]; const { h } = await RT.make(c); h.update(0); h.object.updateMatrixWorld(true);
    const pre = h._disg ? 'disguise:' : '';
    const hg = h.parts[pre + 'headgear'], body = h.parts[pre + 'LOD0'];
    const res = { id: c.id, isl: [] };
    if (!hg) return { label: 'cap_' + c.id, res };
    const G = bake(hg), GI = indexOf(hg), Bd = bake(body), BI = indexOf(body);
    const gi = islands(G, GI); const ng = G.length / 3;
    const P = new Float32Array(G.length + Bd.length); P.set(G); P.set(Bd, G.length);
    const I = new Uint32Array(GI.length + BI.length); I.set(GI); for (let k = 0; k < BI.length; k++) I[GI.length + k] = BI[k] + ng;
    const lab = new Int32Array(P.length / 3); lab.set(gi.lab); lab.fill(gi.count, ng);
    const cnt = new Int32Array(gi.count); for (const l of gi.lab) cnt[l]++;
    const head = h.bones.Head.getWorldPosition(new THREE.Vector3());
    for (let l = 0; l < gi.count; l++) {
      const gap = islandGap(P, lab, l, I, 0.06, 1);
      let cx = 0, cy = 0, cz = 0; for (let k = 0; k < ng; k++) if (gi.lab[k] === l) { cx += G[k * 3]; cy += G[k * 3 + 1]; cz += G[k * 3 + 2]; }
      res.isl.push({ l, verts: cnt[l], gap: +Math.min(gap, 0.06).toFixed(4), at: [cx / cnt[l] - head.x, cy / cnt[l] - head.y, cz / cnt[l] - head.z].map(v => +v.toFixed(3)) });
    }
    res.isl.sort((a, b) => b.gap - a.gap);
    return { label: 'cap_' + c.id, res };
  }
  return { count: A.chars.length, render: one };
}
