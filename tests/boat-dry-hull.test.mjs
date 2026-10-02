/**
 * Dry hulls (GPU): no water inside a boat (art/water/hulls.js). The water surface is painted flat magenta (its shader's
 * last line patched, so every water fragment that survives the depth test and the hull cut-out shows), then frame by
 * frame the pixels over the hull's floor — the raft's floor, the rowboat's floorboards, where the men sit — are read
 * back and must never be water, while a ring just outside the waterline (the side facing the camera) still is:
 *  - M2 river (the user's report: "It looks like water crosses the bottom of the inflatable boat"): the Marine's raft
 *    with the Green Beret seated, at rest (bobbing, pitching, rolling), paddled across and turned;
 *  - M13 sea (coast wind, FFT swell): the raft at rest, rowed and turned in open water;
 *  - M14 sea: the rowboat with the whole team aboard, at rest and rowed.
 * Before the fix the raft's floor (2 cm above the design waterline) went under the water plane for half of every bob.
 * RAFTDRY_SHOTS=<dir> also saves the magenta frames there.
 */
export const timeout = 420_000;

const SHOTS = process.env.RAFTDRY_SHOTS || '';

/** Page helpers: magenta water, per-frame pixel sampling of hull-frame points. */
function install() {
  const g = window.__game, G = g.game;
  const D = window.__dry = { g, G };
  D.paint = () => {
    for (const b of G.world.water.system.bodies) {
      const m = b.mesh.material, src = m.fragmentShader, tail = 'gl_FragColor = vec4(col, 1.0);';
      if (!src.includes(tail)) throw new Error('water shader tail not found');
      m.fragmentShader = src.slice(0, src.lastIndexOf(tail)) + 'gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);' + src.slice(src.lastIndexOf(tail) + tail.length);
      m.needsUpdate = true;
    }
  };
  D.magenta = (r, gg, b) => r - gg > 35 && b - gg > 35; // tone-mapped flat magenta ≈ (210, 146, 212)
  /**
   * Render one frame and read the pixels at hull-frame points (model space of the boat's visual: +x left, +y up,
   * +z bow). @returns {{floor:[n, wet], ring:[n, wet]}}
   */
  D.measure = async (boat, floorPts, ringPts) => {
    const THREE = await import('three');
    const R = G.renderer.renderer, gl = R.getContext(), cam = G.renderer.camera, o = boat.model.visual.object3d;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = (p) => { const v = o.localToWorld(new THREE.Vector3(...p)).project(cam); return [Math.round((v.x + 1) / 2 * W), Math.round((1 - v.y) / 2 * H)]; };
    // camera-facing side of the ring only (the hull hides the far side)
    const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld), oc = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const toCam = o.worldToLocal(cp.clone()).sub(o.worldToLocal(oc.clone())); toCam.y = 0;
    const near = ringPts.filter((p) => p[0] * toCam.x + p[2] * toCam.z > 0);
    const F = floorPts.map(px), Rg = near.map(px), all = F.concat(Rg);
    const x0 = Math.max(0, Math.min(...all.map((q) => q[0]))), x1 = Math.min(W - 1, Math.max(...all.map((q) => q[0])));
    const y0 = Math.max(0, Math.min(...all.map((q) => q[1]))), y1 = Math.min(H - 1, Math.max(...all.map((q) => q[1])));
    const w = x1 - x0 + 1, h = y1 - y0 + 1, buf = new Uint8Array(w * h * 4);
    R.setRenderTarget(null);
    gl.readPixels(x0, H - 1 - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const wet = (q) => { const i = ((y1 - q[1]) * w + (q[0] - x0)) * 4; return q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1 && D.magenta(buf[i], buf[i + 1], buf[i + 2]); };
    return { floor: [F.length, F.filter(wet).length], ring: [Rg.length, Rg.filter(wet).length] };
  };
  /** Hull-frame sample points: a grid over the floor (inside `inside(u, v)`) at height y, a ring outside. */
  D.points = (inside, y, ring) => {
    const floor = [];
    for (let u = -1.3; u <= 1.3; u += 0.1) for (let v = -0.5; v <= 0.5; v += 0.08) if (inside(u, v)) floor.push([v, y, u]);
    const out = [];
    for (let k = 0; k < 48; k++) { const t = k / 48 * 2 * Math.PI; out.push([Math.sin(t) * ring[1], 0, Math.cos(t) * ring[0]]); }
    return { floor, ring: out };
  };
  // the raft's floor: inside 0.8 × the tube centreline (raft.py floor_poly), 5 cm in; the rowboat's floorboards
  D.RAFT = D.points((u, v) => Math.abs(u / 0.85) ** 5.7 + Math.abs(v / 0.3) ** 2.5 <= 1, 0.02, [1.6, 0.95]);
  D.ROWBOAT = D.points((u, v) => Math.abs(v) <= 0.36 * (1 - (u / 1.5) ** 2) && Math.abs(u) <= 1.2, 0.045, [2.15, 0.95]);
  D.run = async (boat, pts, sec, rec, each) => {
    const n = Math.round(sec * 30);
    for (let k = 0; k < n; k++) {
      g.step(); g.step(); G.render(1 / 30, 1); G.cameraController.centerOn(boat.x, boat.z);
      each?.(k);
      const m = await D.measure(boat, pts.floor, pts.ring);
      rec.frames++; rec.floor += m.floor[0]; rec.floorWet += m.floor[1]; rec.ring += m.ring[0]; rec.ringWet += m.ring[1];
      if (m.floor[1]) rec.wetFrames++;
      rec.maxWet = Math.max(rec.maxWet, m.floor[1]);
      if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
    return rec;
  };
  D.rec = () => ({ frames: 0, floor: 0, floorWet: 0, wetFrames: 0, maxWet: 0, ring: 0, ringWet: 0 });
  /** Nearest open water (depth > minDepth, shore > minShore) to (x, z). */
  D.openWater = (x, z, minDepth = 0.9, minShore = 3) => {
    for (let r = 0; r < 150; r++) for (let a = 0; a < 32; a++) {
      const px = x + Math.cos(a / 16 * Math.PI) * r, pz = z + Math.sin(a / 16 * Math.PI) * r, s = G.world.water.sample(px, pz);
      if (s && s.depth > minDepth && s.shore > minShore) return { x: px, z: pz };
    }
    return null;
  };
}

export default async function (page, t) {
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, clip: { x: 340, y: 160, width: 600, height: 400 } }); };
  const report = (name, r) => {
    t.log(name, JSON.stringify(r));
    t.ok(r.frames > 30 && r.floor > r.frames * 20, `${name}: floor sampled (${r.frames} frames, ${r.floor} px)`);
    t.ok(r.floorWet === 0, `${name}: no water over the floor (${r.floorWet} wet px in ${r.wetFrames}/${r.frames} frames, max ${r.maxWet})`);
    t.ok(r.ring > r.frames * 8 && r.ringWet / r.ring > 0.6, `${name}: water still drawn just outside the waterline (${(100 * r.ringWet / Math.max(1, r.ring)).toFixed(0)} %)`);
  };

  // ---- M2 river: the Marine's raft, the Green Beret seated forward of him (as tests/boat-boarding)
  await page.evaluate(install);
  const m2 = await page.evaluate(async () => {
    const D = window.__dry, { g, G } = D;
    await g.loadMission('m02');
    g.start();
    const w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    const pb = w.vehicles.find((v) => v.tag === 'pboat'); if (pb) w.remove(pb);
    w.flushRemovals?.();
    const ma = w.commandos.find((c) => c.role === 'diver'), gb = w.commandos.find((c) => c.role === 'greenberet');
    ma.setPosition(19.5, 73.2, -Math.PI / 2); gb.setPosition(18.4, 75.4, -Math.PI / 2);
    G.cameraController.setZoom(3.5);
    G.cameraController.centerOn(19.5, 73);
    const idle = async (n) => { for (let k = 0; k < n; k++) { g.step(); g.step(); G.render(1 / 30, 1); if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)); } };
    await idle(15);
    ma.issue({ type: 'ability', id: 'raft', target: ma });
    await idle(72);
    const raft = D.boat = w.vehicles.find((v) => v.vehicleType === 'raft');
    for (let i = 0; i < 60 && !raft?.model?.isReady; i++) { await idle(6); await new Promise((r) => setTimeout(r, 50)); }
    gb.issue({ type: 'ability', id: 'enterVehicle', target: raft });
    await idle(200);
    D.paint();
    return { raft: !!raft, lib: raft?.model?.libType, aboard: raft?.occupants?.length, dry: w.water.dry?.length ?? 0 };
  });
  t.log('m02', JSON.stringify(m2));
  t.ok(m2.raft && m2.lib === 'raft' && m2.aboard === 2, 'M2: raft deployed, Marine and Green Beret aboard');
  const r2 = await page.evaluate(async () => {
    const D = window.__dry, b = D.boat, ma = D.G.world.commandos.find((c) => c.role === 'diver'), rec = D.rec();
    await D.run(b, D.RAFT, 3, rec);                                                   // at rest: bob, pitch, roll
    ma.issue({ type: 'move', x: 27.9, z: 49.6 });
    await D.run(b, D.RAFT, 4, rec);                                                   // paddled across
    ma.issue({ type: 'move', x: b.x - 4, z: b.z + 1.5 });
    await D.run(b, D.RAFT, 3, rec);                                                   // turned back
    return rec;
  });
  await shot('m02-dry');
  report('M2 raft (river)', r2);
  t.equal(m2.dry, 1, 'M2: the raft is cut out of the river');

  // ---- M13 sea: the raft in open water, rested, rowed and turned in the swell
  const m13 = await page.evaluate(async () => {
    const D = window.__dry, { g, G } = D;
    await g.loadMission('m13');
    g.start();
    const w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    w.flushRemovals?.();
    const raft = D.boat = w.vehicles.find((v) => v.vehicleType === 'raft');
    const ma = w.commandos.find((c) => c.role === 'diver'), other = w.commandos.find((c) => c !== ma && c.alive);
    const p = D.openWater(raft.x, raft.z);
    raft.x = p.x; raft.z = p.z; raft.heading = 0.3;
    raft.enter(ma); raft.enter(other);
    G.cameraController.setZoom(3.5);
    for (let k = 0; k < 60; k++) { g.step(); g.step(); G.render(1 / 30, 1); G.cameraController.centerOn(raft.x, raft.z); if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)); }
    D.paint();
    return { at: p, aboard: raft.occupants.length, type: w.water.sample(raft.x, raft.z)?.type, dry: w.water.dry?.length ?? 0 };
  });
  t.log('m13', JSON.stringify(m13));
  t.ok(m13.aboard === 2 && m13.type === 'sea', 'M13: raft with two men in the sea');
  const r13 = await page.evaluate(async () => {
    const D = window.__dry, b = D.boat, ma = D.G.world.commandos.find((c) => c.role === 'diver'), rec = D.rec();
    await D.run(b, D.RAFT, 2.5, rec);
    ma.issue({ type: 'move', x: b.x + 8, z: b.z + 3 });
    await D.run(b, D.RAFT, 2.5, rec);
    ma.issue({ type: 'move', x: b.x - 2, z: b.z - 7 });
    await D.run(b, D.RAFT, 2.5, rec);
    return rec;
  });
  await shot('m13-dry');
  report('M13 raft (sea)', r13);

  // ---- M14 sea: the rowboat, the whole team aboard (the start trigger seats them), at rest and rowed
  const m14 = await page.evaluate(async () => {
    const D = window.__dry, { g, G } = D;
    await g.loadMission('m14');
    g.start();
    const w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    w.flushRemovals?.();
    const boat = D.boat = w.vehicles.find((v) => v.vehicleType === 'rowboat');
    G.cameraController.setZoom(3.2);
    for (let k = 0; k < 60; k++) { g.step(); g.step(); G.render(1 / 30, 1); G.cameraController.centerOn(boat.x, boat.z); if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)); }
    D.paint();
    return { aboard: boat.occupants.length, lib: boat.model?.libType, type: w.water.sample(boat.x, boat.z)?.type, dry: w.water.dry?.length ?? 0 };
  });
  t.log('m14', JSON.stringify(m14));
  t.ok(m14.aboard >= 4 && m14.lib === 'rowboat', 'M14: rowboat with the team aboard');
  const r14 = await page.evaluate(async () => {
    const D = window.__dry, b = D.boat, ma = D.G.world.commandos.find((c) => c.role === 'diver'), rec = D.rec();
    await D.run(b, D.ROWBOAT, 2.5, rec);
    ma.issue({ type: 'move', x: b.x + 6, z: b.z + 6 });
    await D.run(b, D.ROWBOAT, 3, rec);
    return rec;
  });
  await shot('m14-dry');
  report('M14 rowboat (sea)', r14);
}
