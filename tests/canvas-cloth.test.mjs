/**
 * Canvas covers on the GPU (user: "the cloth on the car is vibrating too fast" / "the back surface detaches from the
 * surrounding cloth around the sides / top"). M2's Opel Blitz (vehicle library, vehicle-model.js canvasFlap), the real mesh and the real patched material: every
 * vertex's displaced world position is read back from the GPU (tests/cloth-probe.mjs) at 60 fps of sim time, parked
 * and driving (downwind and into the wind), late in a mission (sim t = 600 s). Seam vertices stay welded (< 1 mm),
 * the motion is slow (spectral centroid < 1.6 Hz, < 10 % of the power above 2 Hz), and the GLSL matches its CPU twin.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, P = await import('/tests/cloth-probe.mjs'), C = await import('/src/art/cloth-wind.js');
    await g.loadMission('m02'); g.start(); g.advance(0.2);
    const v = G.world.entities.find((e) => e.kind === 'vehicle' && e.tag === 'truck');
    await v.model.ready;
    const root = v.model.root, shown = (m) => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
    const meshes = P.canvasMeshes(root).filter(shown), R = G.renderer.renderer, out = { meshes: meshes.length, runs: [] };
    if (!meshes.length) return out;
    const mesh = meshes[0], A = mesh.geometry.attributes, pr = P.makeProbe(R, mesh), n = pr.n;
    out.verts = n; out.cover = !!mesh.geometry.userData.canvasCover;
    { const rest = pr.rest(), E = P.triEdges(mesh.geometry); let m = 0; // longest rest edge, world metres
      for (let q = 0; q < E.length; q += 2) { const a = E[q] * 3, b = E[q + 1] * 3; m = Math.max(m, Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2])); }
      out.maxEdge = +m.toFixed(3); out.subdivided = m < 0.32; }
    for (const [speed, flip] of [[0, 0], [9, 0], [9, 1]]) {
      const pos0 = root.position.clone(), rot0 = root.rotation.y;
      if (flip) root.rotation.y += Math.PI;
      const hd = root.rotation.y, fx = Math.sin(hd), fz = Math.cos(hd), F = 150, T0 = 600;
      let groups = null, gap = 0, twin = 0, near = null, grow = 0, stretch = 0;
      const pick = [], ser = [], edges = P.triEdges(mesh.geometry);
      for (let k = -60; k < F; k++) {
        const tt = T0 + k / 60, s = speed * (k + 60) / 60;
        root.position.set(pos0.x + fx * s, pos0.y, pos0.z + fz * s); root.updateMatrixWorld(true);
        G.world.wind.frame(tt, { x: root.position.x, z: root.position.z });
        const p = pr.read(), rest = pr.rest();
        if (!groups) {
          groups = P.seamGroups(rest);
          near = P.nearPairs(rest, 2e-3, 0.04); // NOT welded, 2 mm–4 cm apart: back panel vs cover rim, the rolled-up hem
          for (let i = 0; i < n; i += 9) if (A.aFlap.getX(i) > 0.5) { pick.push(i); ser.push(new Float32Array(F)); }
        }
        if (k < 0) continue;
        gap = Math.max(gap, P.maxGap(p, groups));
        grow = Math.max(grow, P.maxGrowth(p, near));
        stretch = Math.max(stretch, P.maxStretch(p, rest, edges));
        const e = mesh.matrixWorld.elements;
        pick.forEach((i, j) => { // displacement along the welded direction (world)
          const dx = A.aFlapDir.getX(i), dy = A.aFlapDir.getY(i), dz = A.aFlapDir.getZ(i);
          const wx = e[0] * dx + e[4] * dy + e[8] * dz, wy = e[1] * dx + e[5] * dy + e[9] * dz, wz = e[2] * dx + e[6] * dy + e[10] * dz, l = Math.hypot(wx, wy, wz);
          ser[j][k] = ((p[i * 3] - rest[i * 3]) * wx + (p[i * 3 + 1] - rest[i * 3 + 1]) * wy + (p[i * 3 + 2] - rest[i * 3 + 2]) * wz) / l;
        });
        if (k % 50 === 0) { // GLSL vs CPU twin
          const U = { air: new Float32Array(4), k: new Float32Array(4), ph: new Float32Array(4) };
          C.canvasUniforms(C.canvasStateOf(mesh), e, U.air, U.k, U.ph);
          pick.forEach((i, j) => {
            const { D } = C.canvasEval([A.aFlapP.getX(i), A.aFlapP.getY(i), A.aFlapP.getZ(i)], [A.aFlapDir.getX(i), A.aFlapDir.getY(i), A.aFlapDir.getZ(i)],
              A.aFlap.getX(i), [A.aFlapG.getX(i), A.aFlapG.getY(i), A.aFlapG.getZ(i)], U);
            twin = Math.max(twin, Math.abs(D - ser[j][k]));
          });
        }
      }
      const st = C.canvasStateOf(mesh);
      out.runs.push({ speed, flip, air: +Math.hypot(st.ax, st.az).toFixed(2), gapMm: +(gap * 1000).toFixed(3), nearPairs: near.length / 3, growMm: +(grow * 1000).toFixed(2), stretchPct: +(stretch * 100).toFixed(1), twinMm: +(twin * 1000).toFixed(3),
        groups: groups.length, ...P.spectrum(ser, 60, 2) });
      root.position.copy(pos0); root.rotation.y = rot0; root.updateMatrixWorld(true);
    }
    pr.dispose();
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.meshes >= 1, 'the M2 truck has a canvas cover mesh');
  t.ok(r.cover, 'the cover went through applyCanvasCover (vehicle-model.js canvasFlap)');
  t.ok(r.subdivided, `flat end panels subdivided so they can billow (${r.verts} verts, longest edge ${r.maxEdge} m)`);
  for (const k of r.runs) {
    const tag = `${k.speed} m/s${k.flip ? ' into the wind' : ''}`;
    t.ok(k.groups > 100, `${tag}: seam groups found (${k.groups})`);
    t.ok(k.gapMm < 1, `${tag}: back / sides / top stay welded (max seam gap ${k.gapMm} mm)`);
    t.ok(k.nearPairs > 1000 && k.growMm < 12, `${tag}: nearby unwelded parts (separate back panel, rolled-up hem) move together (${k.nearPairs} pairs 2 mm–4 cm apart grow ≤ ${k.growMm} mm)`);
    t.ok(k.stretchPct < 30, `${tag}: no triangle edge stretches > 30 % (${k.stretchPct} %)`);
    t.ok(k.centroid < 1.6 && k.hiFrac < 0.1, `${tag}: slow billow, no vibration (centroid ${k.centroid} Hz, ${(k.hiFrac * 100).toFixed(1)} % > 2 Hz)`);
    t.ok(k.ptp > 0.003 && k.ptp < 0.3, `${tag}: amplitude ${k.ptp} m`);
    t.ok(k.twinMm < 0.5, `${tag}: GLSL matches the CPU twin (${k.twinMm} mm)`);
  }
  const into = r.runs.find((k) => k.flip), down = r.runs.find((k) => k.speed && !k.flip);
  t.ok(into.air > down.air + 5, `relative air: driving into the wind ${into.air} m/s > downwind ${down.air} m/s`);

  // PER-OBJECT UNIFORMS: three.js re-uploads a MeshStandardMaterial's uniforms only when the material changes between
  // draws, so two trucks drawn back to back with one shared material would both show the first one's state. Two real
  // truck instances (createLibraryVehicleModel: one shared library geometry + material) + a legacy pair sharing one material: count which object's
  // phases reach the GPU (gl.uniform4fv) in real rendered frames.
  const u = await page.evaluate(async () => {
    const g = window.__game, G = g.game, P = await import('/tests/cloth-probe.mjs'), C = await import('/src/art/cloth-wind.js');
    const VM = await import('/src/art/vehicle-model.js'), THREE = await import('three');
    const shown = (m) => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
    const v = G.world.entities.find((e) => e.kind === 'vehicle' && e.tag === 'truck');
    const r1 = v.model.root, m1 = P.canvasMeshes(r1).filter(shown)[0];
    const second = VM.createLibraryVehicleModel(v.vehicleType, v.def, { id: 'cloth-test-2' }); await second.ready;
    const r2 = second.root;
    r2.position.copy(r1.position).add(new THREE.Vector3(5, 0, 0)); r2.rotation.y = r1.rotation.y + 1.2; r1.parent.add(r2);
    r2.updateMatrixWorld(true);
    const m2 = P.canvasMeshes(r2).filter(shown)[0];
    // legacy: a plain copy of the cover sharing the FIRST truck's material (as an aFlap-only path would)
    // (placed with the first cover's own transform 5 m to the side: library geometry is quantized, its node scale carries the metres)
    const m3 = new THREE.Mesh(m1.geometry, m1.material);
    r1.parent.matrixWorld.clone().invert().multiply(m1.matrixWorld).decompose(m3.position, m3.quaternion, m3.scale);
    m3.position.x -= 5; r1.parent.add(m3);
    const out = { distinct12: m1.material !== m2.material, frames: [] };
    const gl = G.renderer.renderer.getContext(), orig = gl.uniform4fv;
    let ups = [];
    gl.uniform4fv = function (loc, val, ...a) { if (val && val.length === 4) ups.push(Array.from(val)); return orig.call(this, loc, val, ...a); };
    G.cameraController.centerOn(r1.position.x, r1.position.z); G.cameraController.setZoom(1.2);
    const x0 = r2.position.x;
    for (let k = 0; k < 24; k++) {
      r2.position.x = x0 + k * 0.15; ups = [];
      g.advance(1 / 60);
      const ph = [m1, m2, m3].map((m) => C.canvasStateOf(m)?.ph), hit = (q) => ph.findIndex((p) => p && q.every((x, i) => Math.abs(x - p[i]) < 1e-5));
      out.frames.push({ got: [...new Set(ups.map(hit).filter((i) => i >= 0))].sort().join('') });
    }
    gl.uniform4fv = orig;
    out.distinct13 = m3.material !== m1.material;
    out.differ = Math.max(...C.canvasStateOf(m1).ph.map((x, i) => Math.abs(x - C.canvasStateOf(m2).ph[i])));
    r2.removeFromParent(); m3.removeFromParent(); second.dispose();
    return out;
  });
  t.log(JSON.stringify({ ...u, frames: u.frames.map((f) => f.got).join(' ') }));
  t.ok(u.distinct12, 'each truck instance draws its canvas with its own material');
  t.ok(u.differ > 1e-3, 'the two trucks are in different canvas states');
  const late = u.frames.slice(2);
  t.ok(late.every((f) => f.got === '012'), `every truck's own phases reach the GPU every frame (${late.map((f) => f.got).join(' ')})`);
  t.ok(u.distinct13, 'a canvas material found shared at draw time is split per object');
}
