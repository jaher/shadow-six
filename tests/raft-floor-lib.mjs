/**
 * Page helpers for the raft's dry interior (tests/raft-dry-interior.test.mjs; user 2026-10-15: "When the inflatable raft
 * is inflated there should not be water or the ground inside it"). Installed with page.evaluate(installRaftFloor):
 * window.__rf.
 *
 *  - paint(): the water surface flat magenta (its shader's last line patched: every water fragment that survives the
 *    depth test and the dry-hull cut shows), the terrain and the ground cover (grass, weeds, stones, scrub) flat cyan;
 *  - points(vis): world points over the raft's FLOOR as drawn this frame — the floor's triangles (found once on the
 *    library geometry: up-facing, low, inside the tubes), sampled at four spots each and lifted 0.8 / 5 / 12 cm off it
 *    along its current normal — whatever the hull's state (inflating, flat, folded: the deformed buffers);
 *  - look(at, yaw, pitch, half): an orthographic close-up (pitch as the game camera's 40°, or steeper), rendered;
 *  - measure(vis): reads back the pixel under each point: a point in the hull's bowl sees the floor, the tubes, the
 *    thwart, a paddle or a crewman — never water or ground (there would be water over the floor, ground through it,
 *    or a gap in the hull that the eye looks through). Returns counts and the worst points (model space).
 */
export async function installRaftFloor() {
  const g = window.__game, G = g.game;
  const RF = window.__rf = { g, G };
  const THREE = await import('three');
  const FLOOR = new WeakMap();                       // library geometry → floor triangle starts (index offsets)
  const done = new WeakSet();
  RF.paint = () => {
    let water = 0, ground = 0;
    for (const b of G.world.water?.system?.bodies || []) {
      const m = b.mesh.material, src = m.fragmentShader, tail = 'gl_FragColor = vec4(col, 1.0);';
      if (done.has(m)) continue;
      if (!src.includes(tail)) throw new Error('water shader tail not found');
      m.fragmentShader = src.slice(0, src.lastIndexOf(tail)) + 'gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);' + src.slice(src.lastIndexOf(tail) + tail.length);
      m.needsUpdate = true; done.add(m); water++;
    }
    const cyan = RF.cyan ||= new THREE.MeshBasicMaterial({ color: 0x00ffff });
    G.renderer.scene.traverse((o) => {
      if (!o.isMesh || done.has(o)) return;
      if (o.userData.terrain || /^terrain/.test(o.name || '') || /^(grass|clutter|scrub)/.test(o.name || '')) { o.material = cyan; done.add(o); ground++; }
    });
    return { water, ground };
  };
  RF.wet = (r, gg, b) => r - gg > 35 && b - gg > 35;      // tone-mapped flat magenta
  RF.dirt = (r, gg, b) => gg - r > 50 && b - r > 50;      // tone-mapped flat cyan
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  /** The hull meshes of a raft visual's shown LOD: [{mesh, tris}] (tris: index offsets of the floor's triangles). */
  RF.floorOf = (vis) => {
    const space = vis.object3d, out = [];
    space.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(space.matrixWorld).invert(), M = new THREE.Matrix4();
    space.traverse((o) => {
      if (!o.isMesh || !o.geometry?.index) return;
      let lod = false;   // (the hull's own LOD meshes: not the paddles, nor the crew seated in it)
      for (let a = o; a && a !== space; a = a.parent) { if (!a.visible || /paddle|oar/i.test(a.name)) return; if (/_lod\d+$/.test(a.name)) lod = true; }
      if (!lod || o.isSkinnedMesh) return;
      const g0 = o.geometry.userData?.raftSource || o.geometry;
      let tris = FLOOR.get(g0);
      if (!tris) {
        M.copy(inv).multiply(o.matrixWorld);
        const pos = g0.attributes.position, idx = g0.index, list = [];
        for (let t = 0; t < idx.count; t += 3) {
          v0.fromBufferAttribute(pos, idx.getX(t)).applyMatrix4(M); v1.fromBufferAttribute(pos, idx.getX(t + 1)).applyMatrix4(M); v2.fromBufferAttribute(pos, idx.getX(t + 2)).applyMatrix4(M);
          const ok = [v0, v1, v2].every((p) => p.y < 0.135 && Math.abs(p.x) < 0.4 && Math.abs(p.z) < 1.1);
          if (!ok) continue;
          nn.crossVectors(e1.subVectors(v1, v0), e2.subVectors(v2, v0)).normalize();
          if (nn.y > 0.6) list.push(t);
        }
        FLOOR.set(g0, (tris = Int32Array.from(list)));
      }
      if (tris.length) out.push({ mesh: o, tris });
    });
    return out;
  };
  const BARY = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]];
  /** World points over the floor as drawn (lifted `lifts` m along its normal), with their model-space spots. */
  RF.points = (vis, lifts = [0.008, 0.05, 0.12]) => {
    const space = vis.object3d, pts = [], inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
    for (const { mesh, tris } of RF.floorOf(vis)) {
      const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, W = mesh.matrixWorld;
      for (const t of tris) {
        v0.fromBufferAttribute(pos, idx.getX(t)).applyMatrix4(W); v1.fromBufferAttribute(pos, idx.getX(t + 1)).applyMatrix4(W); v2.fromBufferAttribute(pos, idx.getX(t + 2)).applyMatrix4(W);
        nn.crossVectors(e1.subVectors(v1, v0), e2.subVectors(v2, v0));
        if (nn.lengthSq() < 1e-12) continue;
        nn.normalize();
        if (nn.dot(e1.set(0, 1, 0).transformDirection(space.matrixWorld)) < 0) nn.negate();
        for (const [a, b, c] of BARY) for (const h of lifts) {
          const p = new THREE.Vector3().addScaledVector(v0, a).addScaledVector(v1, b).addScaledVector(v2, c).addScaledVector(nn, h);
          pts.push({ p, h, m: p.clone().applyMatrix4(inv) });
        }
      }
    }
    return pts;
  };
  /** Orthographic close-up on `at` from heading `yaw` (rad), `pitch` (deg) below the horizontal, half-height `half` m. */
  RF.look = (at, yaw, pitch = 40, half = 1.7) => {
    const cam = G.renderer.camera, dist = 40, el = Math.tan(pitch * Math.PI / 180);
    RF.keep ||= { p: cam.position.clone(), q: cam.quaternion.clone(), l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, n: cam.near, f: cam.far, z: cam.zoom };
    const d = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    cam.position.copy(at).addScaledVector(d, dist).add(new THREE.Vector3(0, dist * el, 0)); cam.up.set(0, 1, 0); cam.lookAt(at);
    const asp = G.renderer.width / G.renderer.height;
    Object.assign(cam, { left: -half * asp, right: half * asp, top: half, bottom: -half, near: 1, far: dist * 4, zoom: 1 });
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    G.renderer.render(0);
  };
  /** The game's own camera back (after look()). */
  RF.unlook = () => {
    const cam = G.renderer.camera, k = RF.keep;
    if (!k) return;
    cam.position.copy(k.p); cam.quaternion.copy(k.q);
    Object.assign(cam, { left: k.l, right: k.r, top: k.t, bottom: k.b, near: k.n, far: k.f, zoom: k.z });
    cam.updateProjectionMatrix(); RF.keep = null;
  };
  /** Read the pixels under the floor points of `vis` in the frame just drawn: {n, wet, dirt, bad: [model-space points]}. */
  RF.measure = (vis, pts = RF.points(vis)) => {
    const R = G.renderer.renderer, gl = R.getContext(), cam = G.renderer.camera;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = pts.map((q) => { const s = q.p.clone().project(cam); return [Math.round((s.x + 1) / 2 * W), Math.round((1 - s.y) / 2 * H), s.z]; });
    const inb = px.filter((q) => q[0] >= 0 && q[0] < W && q[1] >= 0 && q[1] < H && q[2] > -1 && q[2] < 1);
    if (!inb.length) return { n: 0, wet: 0, dirt: 0, bad: [] };
    const x0 = Math.min(...inb.map((q) => q[0])), x1 = Math.max(...inb.map((q) => q[0])), y0 = Math.min(...inb.map((q) => q[1])), y1 = Math.max(...inb.map((q) => q[1]));
    const w = x1 - x0 + 1, h = y1 - y0 + 1, buf = new Uint8Array(w * h * 4);
    R.setRenderTarget(null);
    gl.readPixels(x0, H - 1 - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0, wet = 0, dirt = 0;
    const bad = [];
    px.forEach((q, i) => {
      if (q[0] < x0 || q[0] > x1 || q[1] < y0 || q[1] > y1 || !(q[2] > -1 && q[2] < 1)) return;
      const k = ((y1 - q[1]) * w + (q[0] - x0)) * 4, r = buf[k], gg = buf[k + 1], b = buf[k + 2];
      n++;
      const isW = RF.wet(r, gg, b), isD = !isW && RF.dirt(r, gg, b);
      if (isW) wet++; if (isD) dirt++;
      if ((isW || isD) && bad.length < 40) bad.push({ kind: isW ? 'water' : 'ground', h: pts[i].h, m: [+pts[i].m.x.toFixed(2), +pts[i].m.y.toFixed(2), +pts[i].m.z.toFixed(2)], px: [q[0], q[1]], rgb: [r, gg, b] });
    });
    return { n, wet, dirt, bad };
  };
  /** Centre of a visual as drawn (world). */
  RF.centre = (vis) => new THREE.Vector3().setFromMatrixPosition(vis.object3d.matrixWorld);
  /**
   * Look at the raft from `yaws` (rad, from its bow round) × `pitches` (deg) and measure each view:
   * {views, n, wet, dirt, worst: {yaw, pitch, bad}}.
   * `shot` (optional) gets a JPEG data URL of the worst view.
   */
  RF.survey = (vis, { yaws = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * Math.PI / 4), pitches = [40], half = 1.7, shot = false, lifts } = {}) => {
    const at = RF.centre(vis), rec = { views: 0, n: 0, wet: 0, dirt: 0, worst: null };
    // (yaws from the hull's own bow: 0 looks at it from ahead, π from astern — the view of the hole in the front)
    const f = new THREE.Vector3(0, 0, 1).transformDirection(vis.object3d.matrixWorld), base = Math.atan2(f.z, f.x);
    for (const p of pitches) for (const y of yaws) {
      RF.look(at, base + y, p, half);
      const r = RF.measure(vis, RF.points(vis, lifts));
      rec.views++; rec.n += r.n; rec.wet += r.wet; rec.dirt += r.dirt;
      if ((r.wet + r.dirt) > ((rec.worst?.wet ?? 0) + (rec.worst?.dirt ?? 0))) {
        rec.worst = { yaw: +y.toFixed(2), pitch: p, wet: r.wet, dirt: r.dirt, n: r.n, bad: r.bad.slice(0, 12) };
        if (shot) rec.worst.shot = G.renderer.renderer.domElement.toDataURL('image/jpeg', 0.85);
      }
    }
    RF.unlook();
    return rec;
  };
}
