/**
 * Men in the boat, drawn (GPU, M2): the Marine deploys the raft in the shallows and is seen kneeling in it, the Green
 * Beret steps in from the bank over the side tube and sits down facing the bow, the Marine paddles across — the blade
 * dips on alternating sides in step with the wake's strokes — and the Green Beret steps out on the far bank, where his
 * own model takes over. Frames: tests/out/boat-boarding-*.png (docs/screenshots/boat-boarding.jpg is cut from them).
 */
export const timeout = 240_000;

export default async function (page, t) {
  const setup = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m02');
    g.start();
    const w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    const pb = w.vehicles.find((v) => v.tag === 'pboat'); if (pb) w.remove(pb);
    w.flushRemovals?.();
    const ma = w.commandos.find((c) => c.role === 'diver'), gb = w.commandos.find((c) => c.role === 'greenberet');
    ma.setPosition(19.5, 73.2, -Math.PI / 2); gb.setPosition(18.4, 75.4, -Math.PI / 2);
    G.cameraController.setZoom(3);
    const S = window.__bb = { g, G, w, ma, gb, raft: null };
    S.frame = () => { g.step(); g.step(); G.render(1 / 30, 1); if (S.raft) G.cameraController.centerOn(S.raft.x, S.raft.z); };
    S.run = async (sec, fn) => { for (let k = 0; k < Math.round(sec * 30); k++) { S.frame(); fn?.(); if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0)); } };
    G.cameraController.centerOn(19.5, 73);
    await S.run(0.5);
    const ok = ma.issue({ type: 'ability', id: 'raft', target: ma });
    await S.run(2.4);
    S.raft = w.vehicles.find((v) => v.vehicleType === 'raft');
    // wait for the hull and the men's character models
    for (let i = 0; i < 60 && !(S.raft?._crewFig?.occupants?.get(ma)?.ready && !S.raft._crewFig.occupants.get(ma).tr); i++) { await S.run(0.2); await new Promise((r) => setTimeout(r, 50)); }
    const fm = S.raft?._crewFig?.occupants?.get(ma);
    return { ok, raft: !!S.raft, aboard: ma.vehicle === S.raft, fig: !!fm, clip: fm?.clip, vis: fm?.m.root.visible, k: fm?.k, paddle: !!fm?.paddle?.visible };
  });
  t.log(JSON.stringify(setup));
  t.ok(setup.ok && setup.raft && setup.aboard, 'the Marine deploys the raft and is aboard');
  t.ok(setup.fig && setup.vis && setup.k === 0 && setup.clip === 'kneel_shoot', `…and is SEEN in it, kneeling at the stern (${setup.clip})`);
  t.ok(setup.paddle, '…paddle in hand');
  await t.shot('boat-boarding-0-marine');

  // the Green Beret boards from the bank: watch his figure step in
  const inn = await page.evaluate(async () => {
    const S = window.__bb, { raft, gb } = S;
    gb.issue({ type: 'ability', id: 'enterVehicle', target: raft });
    const hw = 0.65, rec = { tr: 0, outside: 0, maxY: -9, visIn: 0 };
    let shotAt = null;
    for (let k = 0; k < 400; k++) {
      S.frame();
      const f = raft._crewFig?.occupants?.get(gb);
      if (f?.tr?.dir === 'in') {
        rec.tr++;
        const p = f.m.root.position;
        if (Math.abs(p.x) > hw || Math.abs(p.z) > 1.35) rec.outside++;
        rec.maxY = Math.max(rec.maxY, p.y);
        if (f.m.root.visible) rec.visIn++;
        if (shotAt == null && f.tr.t > f.tr.P.t1 * 0.9) { shotAt = k; break; }
      }
      if (k % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
    return rec;
  });
  await t.shot('boat-boarding-1-stepping-in');
  const seated = await page.evaluate(async () => {
    const S = window.__bb, { raft, gb, ma } = S;
    await S.run(2.5);
    const occ = raft._crewFig.occupants, fg = occ.get(gb), fm = occ.get(ma);
    const lp = (f) => f.m.root.position;
    return { n: occ.size, gb: { k: fg?.k, clip: fg?.clip, vis: fg?.m.root.visible, tr: !!fg?.tr, z: +lp(fg).z.toFixed(2), yaw: +fg.m.root.rotation.y.toFixed(2) },
      ma: { z: +lp(fm).z.toFixed(2), vis: fm.m.root.visible }, unitHidden: gb.object3d?.visible === false,
      paddleL: raft.model.visual.parts.paddle_l?.visible };
  });
  t.log(JSON.stringify({ inn, seated }));
  t.ok(inn.tr > 10 && inn.visIn > 5, `the Green Beret is drawn stepping in (${inn.tr} frames)`);
  t.ok(inn.outside > 0 && inn.maxY > 0.3, `…from outside the hull, over the tube (top ${inn.maxY.toFixed(2)} m)`);
  t.ok(seated.n === 2 && seated.gb.vis && !seated.gb.tr && seated.gb.k === 1 && seated.gb.clip === 'boat_sit', `two men seen aboard; GB sits on the floor (${JSON.stringify(seated.gb)})`);
  t.ok(seated.gb.z > seated.ma.z + 0.3 && Math.abs(seated.gb.yaw) < 0.05, '…forward of the Marine, facing the bow');
  t.ok(seated.unitHidden, 'his own (standing) model stays hidden while aboard');
  t.equal(seated.paddleL, false, 'the raft\'s port paddle left its rowlock (it is in the Marine\'s hands)');
  await t.shot('boat-boarding-2-aboard');

  // paddle across: the blade dips on alternating sides, in step with the wake's strokes (sampled every frame; two
  // screenshots on the way, half a stroke apart)
  const paddle = (frames) => page.evaluate(async (frames) => {
    const S = window.__bb, { raft, ma } = S, THREE = await import('three');
    if (!S.rowing) { S.rowing = true; ma.issue({ type: 'move', x: 27.9, z: 49.6 }); }
    const fm = raft._crewFig.occupants.get(ma), o = raft.model.visual.object3d;
    const r = { l: 0, r: 0, changes: 0, ok: 0, n: 0 };
    let last = 0;
    for (let k = 0; k < frames && Math.hypot(raft.x - 27.9, raft.z - 49.6) > 2.5; k++) {
      S.frame();
      const tip = fm.paddle?.visible ? o.worldToLocal(fm.paddle.localToWorld(new THREE.Vector3(0, -1.3, 0))) : null;
      const st = S.w.water?.wakes?.strokeOf?.(raft);
      if (tip && tip.y < 0 && (raft.speed || 0) > 0.5) {
        const side = tip.x > 0 ? 1 : -1; // model +x = the raft's left
        r[side > 0 ? 'l' : 'r']++;
        if (last && side !== last) r.changes++;
        last = side;
        if (st?.moving && st.t / st.period < 0.4) { r.n++; if (side === -st.side) r.ok++; } // wake +1 = the raft's right
      }
      if (k % 10 === 9) await new Promise((res) => setTimeout(res, 0));
    }
    return { ...r, at: [raft.x, raft.z] };
  }, frames);
  const pads = [await paddle(120)];
  await t.shot('boat-boarding-3-paddling');
  pads.push(await paddle(14));
  await t.shot('boat-boarding-4-paddling');
  pads.push(await paddle(900));
  await page.evaluate(() => window.__bb.run(1.0));
  const tot = pads.reduce((a, p) => ({ l: a.l + p.l, r: a.r + p.r, changes: a.changes + p.changes, ok: a.ok + p.ok, n: a.n + p.n }), { l: 0, r: 0, changes: 0, ok: 0, n: 0 });
  const at = pads[2].at;
  t.log(JSON.stringify({ pads }));
  t.ok(tot.l > 10 && tot.r > 10, `the blade dips on both sides (left ${tot.l}, right ${tot.r} frames)`);
  t.ok(tot.changes >= 4, `…alternating (${tot.changes} changes of side)`);
  t.ok(tot.n > 10 && tot.ok / tot.n > 0.8, `…on the side the wake draws its catch ring (${tot.ok}/${tot.n})`);
  t.ok(Math.hypot(at[0] - 27.9, at[1] - 49.6) < 3, 'the raft reaches the far bank');

  // the Green Beret steps out on the far bank
  const out = await page.evaluate(async () => {
    const S = window.__bb, { raft, gb } = S;
    const ok = gb.issue({ type: 'ability', id: 'leaveVehicle', target: gb });
    const rec = { out: 0, hiddenWhileOut: 0, figVis: 0 };
    let mid = false;
    for (let k = 0; k < 120; k++) {
      S.frame();
      const f = raft._crewFig?.occupants?.get(gb);
      if (f?.out) { rec.out++; if (gb.object3d?.visible === false) rec.hiddenWhileOut++; if (f.m.root.visible) rec.figVis++; }
      if (f?.out && f.tr.t > f.tr.P.t3 + f.tr.P.t2 * 0.6) { mid = true; break; }
    }
    return { ok, rec, mid, left: !gb.vehicle };
  });
  await t.shot('boat-boarding-5-stepping-out');
  const done = await page.evaluate(async () => {
    const S = window.__bb, { raft, gb } = S;
    await S.run(2.5);
    return { fig: raft._crewFig?.occupants?.has(gb), vis: gb.object3d?.visible, n: raft._crewFig?.occupants?.size, dist: +Math.hypot(gb.x - raft.x, gb.z - raft.z).toFixed(2) };
  });
  t.log(JSON.stringify({ out, done }));
  t.ok(out.ok && out.left, 'the Green Beret gets out (the sim puts him on the bank at once)');
  t.ok(out.rec.out > 5 && out.rec.figVis > 5 && out.rec.hiddenWhileOut === out.rec.out, `…and is drawn stepping out over the side (${out.rec.out} frames), his own model hidden meanwhile`);
  t.ok(!done.fig && done.vis === true && done.n === 1, 'then his own model stands on the bank; the Marine is still seen in the raft');
  await t.shot('boat-boarding-6-landed');
}
