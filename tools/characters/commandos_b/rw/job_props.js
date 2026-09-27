// job_props.js - numeric verification: hand-held props per clip, seat alignment (sit/drive), fireman's carry.
import { THREE, ROSTER, loadLib, makeChar, loadWeapons } from './common.js';
import { equipProp } from '/chars/commandos_b/pipeline/web/weapons.js';
import { lowestVertex } from '/chars/commandos_b/pipeline/web/charkit.js';
const R = (x, n = 3) => +(+x).toFixed(n);
const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const mesh0 = (h) => { let m = null; h.object.traverse(o => { if (!m && o.isSkinnedMesh && o.visible && /LOD0$/.test(o.name)) m = o; }); if (!m) h.object.traverse(o => { if (!m && o.isSkinnedMesh && o.visible) m = o; }); return m; };
export default async function (canvas, W, H, args) {
  const lib = await loadLib({ fix: true }); const Wp = await loadWeapons('/chars/commandos_b/out/weapons/weapons.glb');
  const scene = new THREE.Scene(); const res = { weaponKeys: Object.keys(Wp), props: {}, seat: {}, carry: {} };
  const get = (id) => ROSTER.find(r => r.id === id);
  const cases = args.only === 'carry' ? [] : [['sapper', 'time_bomb', 'plant'], ['sapper', 'time_bomb', 'set_trap'], ['sapper', 'mills_bomb', 'throw'], ['sapper', 'wire_cutters', 'cut_wire'], ['officer_v00', 'cigarette', 'smoke']];
  for (const [id, prop, clip] of cases) {
    const h = await makeChar(get(id), lib, null); scene.add(h.object);
    const o = equipProp(h, Wp, prop, [clip]); if (!o) { res.props[`${id}:${prop}:${clip}`] = 'missing prop'; continue; }
    h.setAnim(clip, { fade: 0, loop: true }); const d = h.clip(clip).duration; const s = { vis: 0, n: 0, gripErr: 0, minY: 9, headMin: 9, ikErr: 0 };
    for (let t = 0; t < d; t += 1 / 30) {
      h.update(1 / 30); h.object.updateMatrixWorld(true); s.n++;
      if (!o.visible) continue; s.vis++;
      const hand = wp(h.bones.hand_r).lerp(wp(h.bones.middle_01_r), 0.55); const g = o.userData.sockets.grip_r ? wp(o.userData.sockets.grip_r) : wp(o);
      const fing = prop === 'cigarette' ? wp(h.bones.index_02_r).lerp(wp(h.bones.middle_02_r), 0.5) : hand;
      s.gripErr = Math.max(s.gripErr, g.distanceTo(fing));
      s.minY = Math.min(s.minY, new THREE.Box3().setFromObject(o).min.y);
      const mouth = wp(h.bones.Head).add(new THREE.Vector3(0, -0.02, 0.1).applyQuaternion(h.object.quaternion));
      s.headMin = Math.min(s.headMin, wp(o).distanceTo(mouth));
      if (h.propIkError != null) s.ikErr = Math.max(s.ikErr, h.propIkError);
    }
    res.props[`${id}:${prop}:${clip}`] = { visibleFrac: R(s.vis / s.n, 2), maxGripErr: R(s.gripErr), minY: R(s.minY), minDistToMouth: R(s.headMin), ikErr: R(s.ikErr) };
    // prop must be hidden outside its clip
    h.setAnim('idle', { fade: 0 }); h.update(0.2); res.props[`${id}:${prop}:${clip}`].hiddenInIdle = !o.visible;
    scene.remove(h.object);
  }
  if (args.only !== 'carry') for (const id of ['driver', 'sapper', 'spy', 'officer_v00']) for (const clip of ['sit', 'drive']) {
    const h = await makeChar(get(id), lib, null); scene.add(h.object);
    h.setAnim(clip, { fade: 0 }); h.update(0.5);
    for (const [tag, sy, fy] of [['kubel', 0.62, 0.30], ['truck', 1.25, 0.85], ['chair', 0.46, 0.0]]) {
      h.object.position.set(0, 0, 0); h.setAnim(clip, { fade: 0 }); h.update(0.5);
      const r = h.sitOn(new THREE.Vector3(0.3, sy, -0.2), { floorY: fy });
      let fe = 9, pe = 0; for (let k = 0; k < 20; k++) { h.update(0.1); h.object.updateMatrixWorld(true);
        fe = Math.min(fe, Math.min(wp(h.bones.ball_l).y, wp(h.bones.ball_r).y) - fy);
        pe = Math.max(pe, Math.abs(lowestVertex(mesh0(h), /^(pelvis|thigh_)/, (v) => Math.hypot(v.x - 0.3, v.z + 0.2 + 0.04) < 0.2) - sy)); }
      res.seat[`${id}:${clip}:${tag}`] = { seatErr: R(r.err), seatErrAnim: R(pe), pelvisAboveSeat: R(r.pelvisY - sy), feetAboveFloorBeforeIK: R(r.feetY - fy), feetAboveFloorMin: R(fe), ikErr: R(h.seatFeetErr || 0) };
    }
    scene.remove(h.object);
  }
  for (const id of ['spy', 'greenberet']) {
    const h = await makeChar(get(id), lib, null); const v = await makeChar(get('rifleman_v00'), lib, null); scene.add(h.object);
    h.object.rotation.y = 0.7; h.setAnim('carry_walk', { fade: 0, loop: true }); h.carryBody(v, args.carry || {});
    const d = h.clip('carry_walk').duration; const s = { shoulder: 0, lowY: 9, spineGap: 9, headGap: 9, vHeadY: [9, -9] };
    for (let t = 0; t < d; t += 1 / 20) {
      h.update(1 / 20);
      const sh = wp(h.bones.upperarm_r).lerp(wp(h.bones.neck_01 || h.bones.Head), 0.35);
      s.shoulder = Math.max(s.shoulder, wp(v.bones.pelvis).distanceTo(sh));
      s.lowY = Math.min(s.lowY, lowestVertex(mesh0(v)));
      for (const b of ['spine_01', 'spine_02', 'spine_03', 'pelvis']) for (const c of ['spine_01', 'spine_02', 'spine_03', 'neck_01']) if (h.bones[c] && v.bones[b]) s.spineGap = Math.min(s.spineGap, wp(v.bones[b]).distanceTo(wp(h.bones[c])));
      s.headGap = Math.min(s.headGap, wp(v.bones.pelvis).distanceTo(wp(h.bones.Head)));
      const hy = wp(v.bones.Head).y; s.vHeadY = [Math.min(s.vHeadY[0], hy), Math.max(s.vHeadY[1], hy)];
      // victim head must be behind the carrier (his back), legs in front
      s.headBehind = wp(v.bones.Head).sub(wp(h.bones.spine_03)).dot(new THREE.Vector3(0, 0, 1).applyQuaternion(h.object.quaternion));
      s.feetFront = wp(v.bones.foot_l).sub(wp(h.bones.spine_03)).dot(new THREE.Vector3(0, 0, 1).applyQuaternion(h.object.quaternion));
    }
    res.carry[id] = { pelvisToShoulderMax: R(s.shoulder), victimLowestY: R(s.lowY), minTrunkGap: R(s.spineGap), victimPelvisToCarrierHead: R(s.headGap), victimHeadY: s.vHeadY.map(x => R(x, 2)), headFwd: R(s.headBehind, 2), feetFwd: R(s.feetFront, 2) };
    scene.remove(h.object, v.object);
  }
  return { count: 0, render: () => null, result: () => res };
}
