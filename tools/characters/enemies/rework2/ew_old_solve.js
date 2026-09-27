export function solveEnemyWeapon(h, dt = 0) {
  const w = h.weapon; if (!w) return;
  const B = h.bones, name = h.weaponName, S = w.userData.sockets, clip = h._holdClip || 'idle', act = h._holdAction;
  h.object.updateMatrixWorld(true);
  const rootQ = h.object.getWorldQuaternion(Q());
  const fwd = V().set(0, 0, 1).applyQuaternion(rootQ), up = V().set(0, 1, 0).applyQuaternion(rootQ), left = V().set(1, 0, 0).applyQuaternion(rootQ);
  w.visible = true; h._twoHand = false;
  if (!LONG.has(name)) {   // pistol
    if (!HAND_CLIPS.includes(clip)) { w.visible = false; return; }
    const z = wpos(B.hand_r).sub(wpos(B.lowerarm_r)).normalize();
    setWorld(w, gunMatrix(w, S.grip_r, palm(B, 'r'), z, up)); return;
  }
  const g = GUN[name] || GUN.kar98k;
  let hold = HOLD_E[clip] || 'sling';
  const t = act ? act.time : 0;
  if (hold === 'drop') {
    const fallT = clip === 'die' ? 0.55 : 0;
    if (t < fallT) {   // still in the hand while he buckles
      setWorld(w, gunMatrix(w, S.grip_r, palm(B, 'r'), fwd.clone().multiplyScalar(0.6).addScaledVector(up, -0.8).normalize(), fwd)); return;
    }
    if (!h._dropM || h._dropClip !== clip) {   // lying on its side on the ground, beside the right hand / at his feet
      const dead = clip === 'die' || clip === 'dead';
      const dl = (h._rt && h._rt.dropLoc) || [-0.55, -0.25]; const loc = dead ? new THREE.Vector3(dl[0], 0, dl[1]) : new THREE.Vector3(-0.1, 0, 0.45);
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dead ? 0.5 : 1.35);
      const ql = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).premultiply(yaw);
      if (!w.userData.lbox) { w.updateMatrixWorld(true); const inv = w.matrixWorld.clone().invert(), bb = new THREE.Box3();
        w.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld.clone().premultiply(inv))); } }); w.userData.lbox = bb; }
      const bb = w.userData.lbox; let ymin = 9;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) ymin = Math.min(ymin, new THREE.Vector3(x, y, z).applyQuaternion(ql).y);
      loc.y = -ymin / Math.max(1e-3, h.object.scale.y) + 0.003;
      h._dropM = new THREE.Matrix4().compose(loc, ql, new THREE.Vector3(1, 1, 1)); h._dropClip = clip;
    }
    w.position.setFromMatrixPosition(h._dropM); w.quaternion.setFromRotationMatrix(h._dropM); w.scale.set(1, 1, 1); w.updateMatrixWorld(true);
    return;
  }
  h._dropM = null;
  // chest frame (follows spine bend): rotation of spine_03 away from its bind orientation
  const Rc = B.spine_03.getWorldQuaternion(Q()).multiply(rootQ.clone().multiply(h._bind.chestQ).invert());
  const cf = fwd.clone().applyQuaternion(Rc), cu = up.clone().applyQuaternion(Rc), cl = left.clone().applyQuaternion(Rc);
  if (hold === 'sling' || hold === 'back') {
    const s3 = wpos(B.spine_03), coat = /greatcoat|general_coat/.test(h.info.outfit || '') ? 0.015 : 0;
    if (hold === 'back') setWorld(w, gunMatrix(w, S.grip_r, s3.clone().addScaledVector(cf, -0.17 + coat).addScaledVector(cl, 0.05).addScaledVector(cu, 0.02), cl.clone().negate().addScaledVector(cu, 0.35).normalize(), cf.clone().negate()));
    else setWorld(w, gunMatrix(w, S.grip_r, s3.clone().addScaledVector(cf, -0.13 + coat).addScaledVector(cl, -0.13).addScaledVector(cu, -0.08), cu.clone().addScaledVector(cl, 0.18).addScaledVector(cf, -0.12).normalize(), cf.clone().negate()));
    return;
  }
  // ---- two-handed holds
  const shR = wpos(B.upperarm_r), neck = wpos(B.neck_01);
  // pitch: level by default; aim_up / aim_down (+-15 deg) or h.aimPitch (radians, set by the game for targets above/below)
  const req = h._requested || clip;
  const pitch = (h.aimPitch || 0) + (req === 'aim_up' ? 0.26 : req === 'aim_down' ? -0.26 : 0);
  let dir, butt;
  if (hold === 'aim' && g.aim === 'shoulder') {
    dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
    const pocket = shR.clone().lerp(neck, 0.3).addScaledVector(cf, 0.07);
    // cheek weld: bore ~5.5 cm under the right eye; the butt slides from the pocket towards that line by at most 4.5 cm
    const eye = h._bind.eyeHead.clone().applyMatrix4(B.Head.matrixWorld);
    const line = eye.clone().addScaledVector(up, -0.055).addScaledVector(dir, -dir.dot(V().subVectors(eye, pocket)));
    const bsock = (S.butt || V()).clone().sub(S.grip_r || V());
    const want = line.clone().addScaledVector(up, bsock.y);   // butt socket sits below the bore by the stock drop
    const d = want.clone().sub(pocket); if (d.length() > 0.045) d.setLength(0.045);
    butt = pocket.clone().add(d);
  } else if (hold === 'aim') {   // chest (MP40, folded stock)
    dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
    butt = shR.clone().lerp(wpos(B.pelvis), 0.33).addScaledVector(cf, 0.17).addScaledVector(cl, 0.05);
  } else {   // low / reload: butt at the right hip, muzzle forward-up across the body
    dir = fwd.clone().multiplyScalar(0.75).addScaledVector(up, 0.45).addScaledVector(left, 0.35).normalize();
    butt = wpos(B.pelvis).addScaledVector(up, 0.18).addScaledVector(cf, 0.13).addScaledVector(left, -0.12);
  }
  const bs = S.butt || new THREE.Vector3(0, 0, -0.3);
  setWorld(w, gunMatrix(w, bs, butt, dir.normalize(), up));
  const Mw = w.matrixWorld;
  const gr = S.grip_r.clone().applyMatrix4(Mw), sp = new THREE.Vector3(...g.support).applyMatrix4(Mw);
  const gx = V().setFromMatrixColumn(Mw, 0), gy = V().setFromMatrixColumn(Mw, 1);
  let tr = gr;
  if (hold === 'low' && act && S.grip_r) {   // bolt cycling during reload
    const u = THREE.MathUtils.clamp(t / Math.max(0.1, act.getClip().duration), 0, 1), k = Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 2;
    tr = gr.clone().addScaledVector(dir, 0.1 * k).addScaledVector(gy, 0.05 * k).addScaledVector(gx, -0.05 * k);
  }
  h.ikErrorR = handTo(B, 'r', tr, dir.clone().multiplyScalar(0.45).addScaledVector(gy, -0.75).addScaledVector(gx, 0.3));
  h.ikError = handTo(B, 'l', sp, gx.clone().multiplyScalar(-0.85).addScaledVector(dir, 0.45).addScaledVector(gy, 0.15));
  h._twoHand = true; h._support = g.support;
}
