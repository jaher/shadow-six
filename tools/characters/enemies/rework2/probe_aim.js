import * as THREE from 'three';
import { makeRuntime } from '/chars/fit/rt.js';
export default async function () {
  const A = window.__args; const RT = await makeRuntime('enemy'); const out = {};
  for (const id of A.ids) {
    const { h } = await RT.make({ id, url: `/chars/enemies/out/${id}.glb` });
    h.setAnim('idle', { fade: 0 }); h.update(0.016); h.setAnim(A.clip || 'aim', { fade: 0 }); h.update(0.016); h.object.updateMatrixWorld(true);
    const P = (n) => h.bones[n].getWorldPosition(new THREE.Vector3()).toArray().map(x => +x.toFixed(3));
    out[id] = { sh: P('upperarm_r'), el: P('lowerarm_r'), wr: P('hand_r'), head: P('Head'), neck: P('neck_01'), shL: P('upperarm_l'), elL: P('lowerarm_l'), wrL: P('hand_l'), swing: h.elbowSwing && +h.elbowSwing.toFixed(3) };
  }
  console.log(JSON.stringify(out));
  return { count: 0, render() {} };
}
