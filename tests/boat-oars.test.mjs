/**
 * Oars, paddles and hands in the open boats (GPU; the user: "Do they grab the oars with the hands when on the boat"):
 *  - M14: the team aboard the rowboat, the Marine at the oars. Every frame of the strokes: a fist round each handle
 *    (the grip point within 3 cm of the oar's axis, on its handle, the fingers and thumb closed round it), each oar
 *    turning about its thole pivot on the gunwale, the blades buried on the drive and clear on the recovery, the row
 *    clock the wake's (both blades catch together), no oar through the hull or any man; pivoting on the spot one oar
 *    pulls while the other backs, his hands still on; the model's own oars (between the old thole pins) hidden;
 *  - M2: the Marine paddling the raft with the Green Beret and the Sniper aboard — both fists on the paddle all
 *    through the strokes, the raft's spare paddle stowed on its starboard tube, none of the paddles through the hull;
 *    then the stroke pinned phase by phase over the WHOLE cycle (strokes on either side, pivoting, and the blends to and
 *    from the rest hold at every phase — the run alone starts at whatever phase and side the wake's clock stands at,
 *    which hangs on how long the figures took to load): no part of the paddle through the tubes, the thwart or the
 *    floor, nor through a man, both fists on it, the paddle where the stroke puts it (the hand low on the shaft reaches);
 *  - no seated man's legs through a hull or its floor: the rowboat (5), the raft (3, M13's 5), the M4 escape boat.
 * Frames: tests/out/boat-oars-*.png.
 */
export const timeout = 300_000;

function install() {
  const g = window.__game, G = g.game;
  const S = window.__bo = { g, G };
  S.frame = (b) => { g.step(); G.render(1 / 60, 1); if (b) G.cameraController.centerOn(b.x, b.z); };
  S.run = async (n, b, fn) => { for (let k = 0; k < n; k++) { S.frame(b); fn?.(k); if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)); } };
  S.clear = async (id) => {
    await g.loadMission(id); g.start();
    const w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    w.flushRemovals?.();
    return w;
  };
  S.ready = async (b, n) => {
    for (let i = 0; i < 300; i++) {
      const cf = b._crewFig;
      if (cf && cf.occupants.size >= n && [...cf.occupants.values()].every((f) => f.ready && !f.tr)) return true;
      await S.run(4, b); await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };
  S.lib = async () => {
    if (S.T) return;
    S.T = await import('three');
    S.bc = await import('/src/art/boat-crew.js');
    S.oa = await import('/src/art/oars.js');
  };
  /** Ray caster on the boat's hull mesh (LOD0 'main', hull space). */
  S.hull = (b) => {
    const THREE = S.T, o = b.model.visual.object3d;
    const inst = [...o.children].find((c) => c.visible && c.children?.some?.((d) => /_lod0$/.test(d.name)));
    const main = inst.children.find((d) => /_lod0$/.test(d.name)).getObjectByName('main');
    const clone = main.clone(true); clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.set(1, 1, 1); clone.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    return {
      o,
      ray: (a, d, far = 5) => { rc.set(new THREE.Vector3(...a), new THREE.Vector3(...d).normalize()); rc.far = far; return rc.intersectObject(clone, true); },
      seg: (a, b2) => { const d = b2.clone().sub(a), L = d.length(); rc.set(a, d.normalize()); rc.far = L; return rc.intersectObject(clone, true); },
    };
  };
  /** Legs through the hull: limb points outside the skin (a ray toward the centreline crosses a side face) or under the floor. */
  S.limbs = (b) => {
    const THREE = S.T, H = S.hull(b), o = H.o;
    o.updateWorldMatrix(true, true);
    const bad = [];
    let n = 0;
    for (const f of b._crewFig.occupants.values()) {
      if (!f.m.root.visible) continue;
      n++;
      const B = f.m.real.inner.bones;
      for (const s of ['l', 'r']) {
        const P = (bn) => o.worldToLocal(B[bn + '_' + s].getWorldPosition(new THREE.Vector3()));
        const pts = [['knee', P('calf')], ['shin', P('calf').lerp(P('foot'), 0.5)], ['ankle', P('foot')], ['ball', P('ball')], ['toe', P('ball_leaf')]];
        for (const [nm, p] of pts) {
          const side = H.ray([p.x, p.y, p.z], [-Math.sign(p.x || 1), 0, 0], Math.abs(p.x)).filter((h) => Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y) < 0.7);
          const down = H.ray([p.x, Math.min(0.29, p.y + 0.3), p.z], [0, -1, 0], 1.5)[0];
          if (side.length || (down && p.y < down.point.y - 0.03)) bad.push(`${f.u.role}/${f.pose} ${nm}_${s} ${p.toArray().map((v) => v.toFixed(2))}`);
        }
      }
    }
    return { n, bad };
  };
  /** Bone segments of a figure (world), for clearance checks against an oar or a paddle. */
  S.segs = (f, skip = () => false) => {
    const B = f.m.real.inner.bones, out = [];
    const P = (n) => B[n]?.getWorldPosition(new S.T.Vector3());
    const pairs = [['thigh_l', 'calf_l', 0.075], ['calf_l', 'foot_l', 0.055], ['thigh_r', 'calf_r', 0.075], ['calf_r', 'foot_r', 0.055],
      ['upperarm_l', 'lowerarm_l', 0.05], ['lowerarm_l', 'hand_l', 0.04], ['upperarm_r', 'lowerarm_r', 0.05], ['lowerarm_r', 'hand_r', 0.04],
      ['pelvis', 'spine_03', 0.13], ['spine_03', 'Head', 0.1]];
    for (const [a, c, r] of pairs) if (!skip(a)) { const A = P(a), C = P(c); if (A && C) out.push({ a: A, b: C, r, n: `${f.u.role}:${a}` }); }
    return out;
  };
  /** Closest distance between segments p0p1 and q0q1. */
  S.segDist = (p0, p1, q0, q1) => {
    const u = p1.clone().sub(p0), v = q1.clone().sub(q0), w0 = p0.clone().sub(q0);
    const a = u.dot(u), bb = u.dot(v), c = v.dot(v), d = u.dot(w0), e = v.dot(w0), D = a * c - bb * bb;
    let sc = D < 1e-9 ? 0 : (bb * e - c * d) / D, tc;
    sc = Math.min(1, Math.max(0, sc));
    tc = Math.min(1, Math.max(0, (bb * sc + e) / c));
    sc = Math.min(1, Math.max(0, (bb * tc - d) / a));
    return p0.clone().addScaledVector(u, sc).distanceTo(q0.clone().addScaledVector(v, tc));
  };
}

export default async function (page, t) {
  await page.evaluate(install);

  // ---------------------------------------------------------------- M14: the rowboat, the Marine at the oars
  const setup = await page.evaluate(async () => {
    const S = window.__bo, { G } = S;
    await S.lib();
    const w = await S.clear('m14');
    const b = S.b = w.vehicles.find((v) => v.vehicleType === 'rowboat');
    G.cameraController.setZoom(5);
    const ok = await S.ready(b, 5);
    await S.run(40, b);
    const cf = b._crewFig;
    return { ok, n: cf?.occupants.size, oars: cf?.oars?.length, rower: [...cf.occupants.values()].find((f) => f.pose === 'row')?.u.role,
      modelOars: Object.values(b.model.visual.parts).map((p) => p.visible), hold: cf.rig.hold };
  });
  t.log(JSON.stringify(setup));
  t.ok(setup.ok && setup.n === 5 && setup.oars === 2 && setup.rower === 'diver', 'M14: five aboard, the Marine on the rowing thwart, two oars');
  t.ok(setup.modelOars.every((v) => !v), 'the model\'s own oars hidden (ours turn between the new thole pins)');
  t.ok(setup.hold === 1, 'at rest he holds the oars');
  await t.shot('boat-oars-0-m14-rest');

  /** Per-frame oar / hand / blade / clearance record over `frames` frames. */
  const record = (frames, label) => page.evaluate(async ({ frames, label }) => {
    const S = window.__bo, { G } = S, THREE = S.T, b = S.b, cf = b._crewFig, H = S.hull(b), o = H.o;
    const f = [...cf.occupants.values()].find((x) => x.pose === 'row');
    const others = [...cf.occupants.values()].filter((x) => x !== f && x.m.root.visible);
    const lvl = G.world.water.level ?? 0;
    const r = { label, n: 0, grip: 0, along: [9, -9], tip: 0, thumb: 0, pivot: 0, wetDrive: [0, 0], dryRec: [0, 0], hull: [], men: 9, menAt: '', own: 9, uSync: 0,
      catchY: [], opp: [0, 0] };
    let lastU = null, lastSw = null;
    await S.run(frames, b, () => {
      o.updateWorldMatrix(true, true);
      r.n++;
      const B = f.m.real.inner.bones;
      const wk = G.world.water.wakes.strokeOf(b);
      if (wk?.moving && Math.abs(((wk.u - cf.rig.u + 1.5) % 1) - 0.5) > 0.03) r.uSync++;
      const sw = {};
      for (const oar of cf.oars) {
        const ob = oar.obj; ob.updateWorldMatrix(true, false);
        const org = ob.localToWorld(new THREE.Vector3()), ax = ob.localToWorld(new THREE.Vector3(1, 0, 0)).sub(org).normalize();
        // the pivot never leaves the oarlock
        const lp = o.worldToLocal(org.clone()), pv = S.oa.pivotOf(oar.s);
        r.pivot = Math.max(r.pivot, Math.hypot(lp.x - pv[0], lp.y - pv[1], lp.z - pv[2]));
        // the fist: grip point on the handle, fingers / thumb closed round it
        const h = cf.rig.hands?.[oar.s];
        if (h) {
          const g = S.bc.gripPoint(B, h).sub(org), tt = g.dot(ax);
          r.grip = Math.max(r.grip, g.clone().addScaledVector(ax, -tt).length());
          r.along = [Math.min(r.along[0], tt), Math.max(r.along[1], tt)];
          const tipD = (n) => { const p = B[n + '_' + h].getWorldPosition(new THREE.Vector3()).sub(org); return p.addScaledVector(ax, -p.dot(ax)).length(); };
          r.tip = Math.max(r.tip, tipD('middle_04_leaf'), tipD('index_04_leaf'));
          r.thumb = Math.max(r.thumb, tipD('thumb_04_leaf'));
        }
        // the blade: buried on the drive, clear of the water on the recovery — against the hull's own waterline (the
        // hull rides the swell; the sea's mean level is logged)
        const bw = ob.localToWorld(new THREE.Vector3(S.oa.BLADE_C, 0, 0)), bladeY = o.worldToLocal(bw.clone()).y, u = cf.rig.u;
        r.lvl = Math.max(r.lvl ?? -9, bw.y - lvl);
        if (cf.rig.rowAct > 0.99 && wk?.moving) {
          if (u > 0.1 && u < 0.4) { r.wetDrive[0]++; if (bladeY < -0.05) r.wetDrive[1]++; }
          if (u > 0.6 && u < 0.85) { r.dryRec[0]++; if (bladeY > 0.04) r.dryRec[1]++; }
          if (lastU != null && lastU > 0.9 && u < 0.03) r.catchY.push(+bladeY.toFixed(3)); // the frame of the catch
        }
        // through the hull: the loom's axis and its underside, pivot → tip and pivot → handle end
        const lw = (x, dy = 0) => o.localToWorld(o.worldToLocal(ob.localToWorld(new THREE.Vector3(x, 0, 0))).add(new THREE.Vector3(0, dy, 0)));
        for (const dy of [0, -0.022]) for (const [x0, x1] of [[0.05, S.oa.OAR.length - S.oa.OAR.inboard], [-0.05, -S.oa.OAR.inboard]]) {
          const hits = H.seg(o.worldToLocal(lw(x0, dy)), o.worldToLocal(lw(x1, dy)));
          if (hits.length && r.hull.length < 5) r.hull.push(`${label} ${oar.s > 0 ? 'port' : 'stbd'} ${x0 > 0 ? 'out' : 'in'} at ${hits[0].point.toArray().map((v) => v.toFixed(2))}`);
        }
        // clear of the other men, and of the oarsman's own legs
        const a0 = ob.localToWorld(new THREE.Vector3(-S.oa.OAR.inboard, 0, 0)), a1 = ob.localToWorld(new THREE.Vector3(S.oa.OAR.length - S.oa.OAR.inboard, 0, 0));
        for (const x of others) for (const sg of S.segs(x)) {
          const d = S.segDist(a0, a1, sg.a, sg.b) - sg.r - 0.024;
          if (d < r.men) { r.men = d; r.menAt = sg.n; }
        }
        for (const sg of S.segs(f, (n) => !/^(thigh|calf)/.test(n))) r.own = Math.min(r.own, S.segDist(a0, a1, sg.a, sg.b) - sg.r - 0.024);
        sw[oar.s] = oar.key.sweep;
      }
      // pivoting: one oar pulls while the other backs — the frames the oarsman pivots (rig.pivot: turning on the spot, the
      // wake's row clock stopped; the first frames of the turn the wake still sees the hull move and he pulls both)
      if (cf.rig.pivot && Math.abs(cf.rig.yawRate) > 0.3 && (b.speed || 0) < 0.1 && lastSw && cf.oars.every((x) => x.key.wet)) {
        r.opp[0]++; if (Math.sign(sw[1] - lastSw[1]) === -Math.sign(sw[-1] - lastSw[-1])) r.opp[1]++;
      }
      lastSw = sw; lastU = cf.rig.u;
    });
    r.grip = +r.grip.toFixed(4); r.tip = +r.tip.toFixed(3); r.thumb = +r.thumb.toFixed(3); r.pivot = +r.pivot.toFixed(6);
    r.men = +r.men.toFixed(3); r.own = +r.own.toFixed(3); r.along = r.along.map((v) => +v.toFixed(3));
    return r;
  }, { frames, label });

  const rest = await record(60, 'rest');
  t.log(JSON.stringify(rest));
  await page.evaluate(() => { const S = window.__bo, b = S.b; b.driver.issue({ type: 'move', x: b.x + 45, z: b.z }); });
  const row1 = await record(150, 'row');
  await t.shot('boat-oars-1-m14-rowing');
  const row2 = await record(130, 'row');
  await t.shot('boat-oars-2-m14-rowing');
  t.log(JSON.stringify(row1)); t.log(JSON.stringify(row2));
  // pivot: stopped, a move order to a point astern turns the boat on the spot first
  await page.evaluate(async () => { const S = window.__bo, b = S.b; b.driver.issue({ type: 'move', x: b.x, z: b.z }); await S.run(90, b); b.driver.issue({ type: 'move', x: b.x - 20, z: b.z + 14 }); });
  const piv = await record(150, 'pivot');
  t.log(JSON.stringify(piv));
  await t.shot('boat-oars-3-m14-turn');
  const all = [rest, row1, row2, piv];
  const max = (k) => Math.max(...all.map((r) => r[k]));
  t.ok(max('grip') <= 0.03, `a fist round each handle every frame: grip point ≤ ${(max('grip') * 100).toFixed(1)} cm from the oar's axis`);
  t.ok(all.every((r) => r.along[0] >= -0.63 && r.along[1] <= -0.4), `…on the handle (${JSON.stringify(all.map((r) => r.along))} m from the pivot; the handle is −0.6 … −0.46)`);
  t.ok(max('tip') <= 0.05 && max('thumb') <= 0.05, `…the fingers (${(max('tip') * 100).toFixed(1)} cm) and thumb (${(max('thumb') * 100).toFixed(1)} cm) closed round it`);
  t.ok(max('pivot') < 1e-4, 'each oar turns about its thole pivot (never leaves the oarlock)');
  const wd = row1.wetDrive[0] + row2.wetDrive[0], wdOk = row1.wetDrive[1] + row2.wetDrive[1];
  const dr = row1.dryRec[0] + row2.dryRec[0], drOk = row1.dryRec[1] + row2.dryRec[1];
  t.ok(wd > 40 && wdOk / wd > 0.95, `blades buried on the drive (${wdOk}/${wd})`);
  t.ok(dr > 40 && drOk / dr > 0.95, `…clear of the water on the recovery (${drOk}/${dr})`);
  const catches = [...row1.catchY, ...row2.catchY];
  t.ok(catches.length >= 2 && catches.every((y) => y > -0.12 && y < 0.25), `the stroke restarts at the wake's catch with the blades at the water (${JSON.stringify(catches)})`);
  t.ok(row1.uSync + row2.uSync <= 4, `the oarsman's stroke is the wake's clock (${row1.uSync + row2.uSync} frames off)`);
  t.ok(all.every((r) => !r.hull.length), `no oar through the hull or a thwart ${JSON.stringify(all.flatMap((r) => r.hull))}`);
  t.ok(Math.min(...all.map((r) => r.men)) > 0, `no oar through another man (closest ${Math.min(...all.map((r) => r.men))} m, ${all.map((r) => r.menAt).join(' ')})`);
  t.ok(Math.min(...all.map((r) => r.own)) > 0, `…nor through the oarsman's own legs (${Math.min(...all.map((r) => r.own))} m)`);
  t.ok(piv.opp[0] > 20 && piv.opp[1] / piv.opp[0] > 0.85, `pivoting: one oar pulls while the other backs (${piv.opp[1]}/${piv.opp[0]})`);
  const l14 = await page.evaluate(() => window.__bo.limbs(window.__bo.b));
  t.ok(l14.n === 5 && !l14.bad.length, `M14 rowboat: no boot through the planking or the floorboards ${JSON.stringify(l14.bad)}`);

  // ---------------------------------------------------------------- M2: the raft paddled, three aboard
  const raft = await page.evaluate(async () => {
    const S = window.__bo, { G } = S, THREE = S.T;
    const w = await S.clear('m02');
    const pb = w.vehicles.find((v) => v.tag === 'pboat'); if (pb) w.remove(pb); w.flushRemovals?.();
    const ma = w.commandos.find((c) => c.role === 'diver');
    ma.setPosition(19.5, 73.2, -Math.PI / 2);
    G.cameraController.setZoom(5); G.cameraController.centerOn(19.5, 73);
    await S.run(20);
    ma.issue({ type: 'ability', id: 'raft', target: ma });
    await S.run(150);
    const b = S.b = w.vehicles.find((v) => v.vehicleType === 'raft');
    for (const c of w.commandos) if (c !== ma && c.alive && b.occupants.length < 3) b.enter(c);
    const ok = await S.ready(b, 3);
    await S.run(30, b);
    const lim = S.limbs(b);
    ma.issue({ type: 'move', x: 27.9, z: 49.6 });
    const cf = b._crewFig, f = [...cf.occupants.values()].find((x) => x.pose === 'paddle'), H = S.hull(b), o = H.o;
    const others = [...cf.occupants.values()].filter((x) => x !== f);
    const r = { ok, lim, n: 0, grip: 0, low: [9, -9], tip: 0, hull: [], men: 9, menAt: '', spare: null, spareHull: 0 };
    await S.run(220, b, () => {
      const pd = f.paddle; if (!pd?.visible) return;
      o.updateWorldMatrix(true, true); pd.updateWorldMatrix(true, false);
      r.n++;
      const B = f.m.real.inner.bones;
      const org = pd.localToWorld(new THREE.Vector3()), ax = pd.localToWorld(new THREE.Vector3(0, -1, 0)).sub(org).normalize();
      for (const s of ['l', 'r']) {
        const g = S.bc.gripPoint(B, s).sub(org), tt = g.dot(ax);
        r.grip = Math.max(r.grip, g.clone().addScaledVector(ax, -tt).length());
        if (tt > 0.05) r.low = [Math.min(r.low[0], tt), Math.max(r.low[1], tt)];
      }
      // the shaft clear of the hull (the blade below the tube is in the water outside it) and of the men
      const tip = pd.localToWorld(new THREE.Vector3(0, -S.bc.PADDLE.length, 0));
      const hits = H.seg(o.worldToLocal(org.clone()), o.worldToLocal(tip.clone()));
      if (hits.length && r.hull.length < 5) r.hull.push(hits[0].point.toArray().map((v) => +v.toFixed(2)));
      for (const x of others) for (const sg of S.segs(x)) { const d = S.segDist(org, tip, sg.a, sg.b) - sg.r - 0.018; if (d < r.men) { r.men = d; r.menAt = sg.n; } }
    });
    // the spare paddle stowed on the starboard tube: its mesh inside the raft's outline, on top of the tube
    const node = b.model.visual.parts.paddle_r; node.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    node.traverse((n) => { if (n.isMesh) { const a = n.geometry.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < a.count; i += 3) box.expandByPoint(o.worldToLocal(n.localToWorld(v.fromBufferAttribute(a, i)))); } });
    r.spare = { min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)), vis: node.visible, l: b.model.visual.parts.paddle_l.visible };
    const g0 = S.bc.STOW.at(S.bc.STOW.d0.clone().multiplyScalar(-0.5).toArray()), g1 = S.bc.STOW.at(S.bc.STOW.d0.clone().multiplyScalar(1.0).toArray());
    r.spareHull = H.seg(g0, g1).length;
    r.grip = +r.grip.toFixed(4); r.men = +r.men.toFixed(3); r.low = r.low.map((v) => +v.toFixed(2));
    return r;
  });
  t.log(JSON.stringify(raft));
  await t.shot('boat-oars-4-m02-paddling');
  t.ok(raft.ok && raft.n > 150, 'M2: the Marine paddles the raft, the Green Beret and the Sniper aboard');
  t.ok(raft.grip <= 0.03, `both fists on the paddle all through the strokes (≤ ${(raft.grip * 100).toFixed(1)} cm off its axis; the lower hand ${raft.low.join('–')} m down the shaft)`);
  t.ok(!raft.hull.length, `the paddle never through the tubes ${JSON.stringify(raft.hull)}`);
  t.ok(raft.men > 0, `…nor through the men aboard (closest ${raft.men} m, ${raft.menAt})`);
  const sp = raft.spare;
  t.ok(sp.vis && !sp.l && sp.min[0] > -0.62 && sp.max[0] < -0.2 && sp.min[2] > -1.25 && sp.max[2] < 1.0 && sp.min[1] > 0.2, `the spare paddle stowed inside on the starboard tube ${JSON.stringify(sp)}`);
  t.ok(raft.spareHull === 0, '…lying on the tube, not through it');
  t.ok(raft.lim.n === 3 && !raft.lim.bad.length, `M2 raft (3): no leg through the tubes or the floor ${JSON.stringify(raft.lim.bad)}`);

  // the whole cycle, pinned: the paddler's overlay reads the stroke (rig.st) and the hold ↔ stroke blend (rig.act) as it
  // runs; each phase is held for two frames (the pose settles), the raft stopped
  const sweep = await page.evaluate(async () => {
    const S = window.__bo, THREE = S.T, b = S.b, cf = b._crewFig, H = S.hull(b), o = H.o;
    b.driver.issue({ type: 'move', x: b.x, z: b.z });
    const f = [...cf.occupants.values()].find((x) => x.pose === 'paddle'), others = [...cf.occupants.values()].filter((x) => x !== f);
    const root = f.m._body?.() || f.m.root, orig = f.m.overlay;
    let pin = null;
    f.m.overlay = (mm, dt, guard) => { if (pin) { cf.rig.st = { u: pin.u, s: pin.s, same: pin.same }; cf.rig.act = pin.act; } return orig(mm, dt, guard); };
    const r = { n: 0, hull: [], grip: 0, dev: 0, devAt: '', men: 9, menAt: '', low: [9, -9] };
    // shaft: its axis and 3 cm round it; blade (paddle-local −y 1.01 … 1.45, 17 cm wide in x): 1.5 cm beyond its edges
    const LINES = [[0, 0, 0, -1.45], [0.03, 0, 0.03, -1.45], [-0.03, 0, -0.03, -1.45], [0, 0, 0, -1.45, 0.03], [0, 0, 0, -1.45, -0.03],
      [0.1, -1.0, 0.1, -1.45], [-0.1, -1.0, -0.1, -1.45]];
    try {
      for (const same of [false, true]) for (const s of [1, -1]) for (const act of [1, 0.75, 0.5, 0.25, 0]) for (let i = 0; i < 40; i++) {
        pin = { u: i / 40, s, same, act };
        S.frame(b); S.frame(b);
        if (i % 10 === 9) await new Promise((res) => setTimeout(res, 0));
        const pd = f.paddle; if (!pd?.visible) continue;
        r.n++;
        o.updateWorldMatrix(true, true); pd.updateWorldMatrix(true, false);
        const tag = `u ${pin.u} s ${s}${same ? ' pivoting' : ''} act ${act}`;
        const B = f.m.real.inner.bones;
        const org = pd.localToWorld(new THREE.Vector3()), ax = pd.localToWorld(new THREE.Vector3(0, -1, 0)).sub(org).normalize();
        for (const h of ['l', 'r']) {
          const g = S.bc.gripPoint(B, h).sub(org), tt = g.dot(ax);
          r.grip = Math.max(r.grip, g.clone().addScaledVector(ax, -tt).length());
          if (tt > 0.05) r.low = [Math.min(r.low[0], tt), Math.max(r.low[1], tt)];
        }
        // the paddle where the key puts it (laid through both fists: off it only if a hand fell short)
        const P = S.bc.paddlePose(pin.u, s, same, act);
        const kd = root.localToWorld(new THREE.Vector3(...P.T)).sub(root.localToWorld(new THREE.Vector3(...P.G))).normalize();
        const dev = Math.acos(Math.min(1, ax.dot(kd))) * 180 / Math.PI;
        if (dev > r.dev) { r.dev = dev; r.devAt = tag; }
        const L = (x, y, z = 0) => o.worldToLocal(pd.localToWorld(new THREE.Vector3(x, y, z)));
        for (const [x0, y0, x1, y1, z = 0] of LINES) {
          const hits = H.seg(L(x0, y0, z), L(x1, y1, z));
          if (hits.length && r.hull.length < 6) r.hull.push(`${tag}: ${hits[0].point.toArray().map((v) => v.toFixed(2))}`);
        }
        const tip = pd.localToWorld(new THREE.Vector3(0, -S.bc.PADDLE.length, 0));
        for (const x of others) for (const sg of S.segs(x)) { const d = S.segDist(org, tip, sg.a, sg.b) - sg.r - 0.018; if (d < r.men) { r.men = d; r.menAt = `${sg.n} ${tag}`; } }
      }
    } finally { f.m.overlay = orig; }
    r.grip = +r.grip.toFixed(4); r.dev = +r.dev.toFixed(1); r.men = +r.men.toFixed(3); r.low = r.low.map((v) => +v.toFixed(2));
    return r;
  });
  t.log(JSON.stringify(sweep));
  t.ok(sweep.n === 800, `M2: the paddle posed at every pinned phase (${sweep.n}/800: 40 phases × either side × pivoting or not × 5 blends from the rest hold)`);
  t.ok(!sweep.hull.length, `…never through the tubes, the thwart or the floor, nor within 3 cm of them ${JSON.stringify(sweep.hull)}`);
  t.ok(sweep.grip <= 0.03, `…both fists on it (≤ ${(sweep.grip * 100).toFixed(1)} cm off its axis; the lower hand ${sweep.low.join('–')} m down the shaft)`);
  t.ok(sweep.dev <= 6, `…where the stroke puts it: the hand low on the shaft reaches its spot (≤ ${sweep.dev}° off the key, ${sweep.devAt})`);
  t.ok(sweep.men > 0, `…nor through the men aboard (closest ${sweep.men} m, ${sweep.menAt})`);

  // ---------------------------------------------------------------- M13 raft (five), M4 escape boat (standing)
  const more = await page.evaluate(async () => {
    const S = window.__bo, { G } = S;
    let w = await S.clear('m13');
    let b = S.b = w.vehicles.find((v) => v.vehicleType === 'raft');
    const ma = w.commandos.find((c) => c.role === 'diver');
    b.x = 74.11; b.z = 159.46; b.heading = 0.3;
    b.enter(ma); for (const c of w.commandos) if (c !== ma && c.alive) b.enter(c);
    G.cameraController.setZoom(5);
    await S.ready(b, 5); await S.run(30, b);
    const m13 = S.limbs(b);
    w = await S.clear('m04');
    b = S.b = w.vehicles.find((v) => v.tag === 'pboat');
    for (const c of w.commandos) if (c.alive) b.enter(c);
    await S.ready(b, Math.min(5, b.occupants.length)); await S.run(30, b);
    const m04 = S.limbs(b);
    return { m13, m04 };
  });
  t.log(JSON.stringify(more));
  t.ok(more.m13.n === 5 && !more.m13.bad.length, `M13 raft (5): no leg through the tubes or the floor ${JSON.stringify(more.m13.bad)}`);
  t.ok(more.m04.n >= 4 && !more.m04.bad.length, `M4 escape boat: the men stand on the deck, clear of its fittings ${JSON.stringify(more.m04.bad)}`);
}
