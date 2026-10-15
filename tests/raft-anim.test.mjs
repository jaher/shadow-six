/**
 * The Marine's raft, drawn (user 2026-10-14: "Also animate better how [...] the marine very quickly deflated and folds
 * the raft. Also when the raft is inflated it should be very clear it gets inflated."; abilities/raft-actions.js,
 * art/raft-actions.js, art/raft-hull.js). M2, the bank south-east of the settlement, stepped deterministically:
 *  - T (4.0 s): the strapped pack off his back onto the ground, then the hull's own pleat stack (no pack left over);
 *    the CO2 hiss at the cord; the hull drawn rising monotonically from a flat sheet (its mean height) while the
 *    chambers fill, full by RAFT.deploy.full; his hands on the valve and the tube; the raft spawned at the end IS the
 *    model drawn (no swap: same object, library geometry back on it) and he is aboard;
 *  - H on the raft (3.6 s): the valve hiss, the hull drawn falling monotonically to the flat sheet, the raft out of the
 *    sim at 2.0 s as before, folded / gathered, the pack lifted onto his back: at the end it rides on his spine, behind
 *    him at his back's height, and stays there (walking);
 *  - no page errors. Shots: raft-inflating.png, raft-inflated.png, raft-deflating.png, raft-packed.png.
 */
import { writeFileSync } from 'node:fs';

export const timeout = 240_000;

export default async function raftAnim(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    const RA = await import('/src/art/raft-actions.js');
    const { RAFT } = await import('/src/abilities/raft-actions.js');
    await g.loadMission('m02'); g.start(); await G.mapHandle?.ready;
    const w = G.world; w.debug = { noDetect: true, invulnerable: true };
    for (const e of [...w.enemies]) w.remove(e);
    const dv = w.commandos.find((c) => c.role === 'diver');
    for (const c of w.commandos) if (c !== dv) c.setPosition(c.x + 6, c.z + 6, c.heading);
    dv.setPosition(42.75, 98.25, 0);
    if (!dv.has('inflatableBoat')) dv.gainItem('inflatableBoat', 1);
    await dv.model?.ready;
    g.select([]); g.setZoom(3); g.centerOn(dv.x, dv.z);
    const idle = () => new Promise((res) => setTimeout(res, 0));
    const step = () => { g.step(); G.render(1 / 60, 1); };
    for (let i = 0; i < 20; i++) { step(); await idle(); }
    const shots = {};
    const shot = (name, x, z, h) => {
      const cam = G.renderer.camera, c = new THREE.Vector3(x, (w.groundY?.(x, z) || 0) + 0.4, z), d = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone(), l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, n: cam.near, f: cam.far, z: cam.zoom };
      cam.position.copy(c).addScaledVector(d, 6).add(new THREE.Vector3(0, 3, 0)); cam.up.set(0, 1, 0); cam.lookAt(c);
      const asp = G.renderer.width / G.renderer.height;
      Object.assign(cam, { left: -1.6 * asp, right: 1.6 * asp, top: 1.6, bottom: -1.6, near: 0.3, far: 30, zoom: 1 });
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); G.renderer.render(0);
      shots[name] = G.renderer.renderer.domElement.toDataURL('image/jpeg', 0.85);
      cam.position.copy(keep.p); cam.quaternion.copy(keep.q);
      Object.assign(cam, { left: keep.l, right: keep.r, top: keep.t, bottom: keep.b, near: keep.n, far: keep.f, zoom: keep.z });
      cam.updateProjectionMatrix();
    };
    const out = {};
    const hiss = [];
    w.events.on('raft:hiss', (e) => hiss.push({ t: w.time, kind: e.kind }));
    // ---------------------------------------------------------------- T: inflate
    let start = null, end = null;
    const offS = w.events.on('ability:start', (e) => { if (e.unit === dv && e.id === 'raft') start ??= w.time; });
    const offE = w.events.on('ability:end', (e) => { if (e.unit === dv && e.id === 'raft') end ??= w.time; });
    g.useAbility(dv.id, 'raft', dv.id);
    const rows = [];
    let model = null;
    for (let i = 0; i < 60 * 8 && (end == null || w.time < end + 0.3); i++) {
      step(); await idle();
      if (start == null) continue;
      const m = RA.raftMetrics(dv), tt = w.time - start;
      const rec = (w.raftActs || []).find((q) => q.a === dv && q.kind === 'inflate');
      model ||= rec?.vis?.model || null;
      rows.push({ t: tt, meanY: m.meanY, vol: m.volume, pack: m.pack, err: m.handErr, shown: !!model?.root?.visible && model.root.parent != null });
      if (!shots.inflating && tt >= 2.3) shot('inflating', dv.x + Math.cos(dv.heading) * 1.5, dv.z + Math.sin(dv.heading) * 1.5, dv.heading + 1.6);
      if (!shots.inflated && tt >= 3.6) shot('inflated', dv.x + Math.cos(dv.heading) * 1.5, dv.z + Math.sin(dv.heading) * 1.5, dv.heading + 1.6);
    }
    offS(); offE();
    const raft = w.vehicles.find((v) => v.vehicleType === 'raft');
    out.inflate = { start, end: end - start, rows, hiss: hiss.map((h) => ({ t: h.t - start, kind: h.kind })), aboard: dv.vehicle === raft,
      adopted: !!raft && !!model && raft.model === model && raft.object3d === model.root,
      restored: !!raft && raft.model?.visual?.object3d && (() => { let own = 0; raft.model.visual.object3d.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.raftUV) own++; }); return own === 0; })(),
      packAfter: RA.raftMetrics(dv).pack, D: RAFT.deploy };
    // ---------------------------------------------------------------- out, then H: deflate, fold, shoulder
    g.order(dv.id, { type: 'ability', id: 'leaveVehicle', target: dv });
    for (let i = 0; i < 180; i++) { step(); await idle(); }
    hiss.length = 0;
    start = null; end = null;
    let gone = null;
    const offS2 = w.events.on('ability:start', (e) => { if (e.unit === dv && e.id === 'hand') start ??= w.time; });
    const offE2 = w.events.on('ability:end', (e) => { if (e.unit === dv && e.id === 'hand') end ??= w.time; });
    g.useAbility(dv.id, 'hand', raft.id);
    const prow = [];
    for (let i = 0; i < 60 * 8 && (end == null || w.time < end + 0.4); i++) {
      step(); await idle();
      if (start == null) continue;
      const tt = w.time - start;
      if (gone == null && raft.removed) gone = tt;
      const m = RA.raftMetrics(dv);
      prow.push({ t: tt, meanY: m.meanY, pack: m.pack, on: m.packOnMarine, err: m.handErr });
      if (!shots.deflating && tt >= 1.2) shot('deflating', dv.x + Math.cos(dv.heading) * 1.3, dv.z + Math.sin(dv.heading) * 1.3, dv.heading + 1.6);
    }
    offS2(); offE2();
    const m = RA.raftMetrics(dv);
    const fwd = new THREE.Vector3(Math.cos(dv.heading), 0, Math.sin(dv.heading));
    const pk = m.packAt ? new THREE.Vector3(...m.packAt) : null;
    const gy = w.groundY?.(dv.x, dv.z) || 0;
    out.pack = { rows: prow, gone, end: end - start, hiss: hiss.map((h) => ({ t: h.t - start, kind: h.kind })), has: dv.has('inflatableBoat'), final: m.pack, on: m.packOnMarine,
      behind: pk ? pk.clone().sub(new THREE.Vector3(dv.x, pk.y, dv.z)).dot(fwd) : null, height: pk ? pk.y - gy : null, P: RAFT.pack };
    shot('packed', dv.x, dv.z, dv.heading + 2.6);
    // the pack stays on his back as he walks off
    g.order(dv.id, { type: 'move', x: dv.x - 5, z: dv.z + 1 });
    for (let i = 0; i < 60; i++) { step(); await idle(); }
    out.walking = RA.raftMetrics(dv);
    return { out, shots };
  });
  for (const [k, v] of Object.entries(r.shots)) writeFileSync(t.harness.shotPath(`raft-${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
  const I = r.out.inflate, P = r.out.pack, D = I.D;
  const at = (rows, x) => rows.find((q) => q.t >= x - 1e-6);
  t.log(JSON.stringify({ inflate: { end: I.end, hiss: I.hiss, adopted: I.adopted, restored: I.restored, aboard: I.aboard,
    meanY: [0.3, 0.8, 1.3, D.pull, 2, 2.5, 3, D.full, 3.8].map((x) => [x, +(at(I.rows, x)?.meanY ?? NaN).toFixed(4)]) } }));
  t.ok(Math.abs(I.end - D.close[1]) < 2 / 60 + 1e-6, `T takes ${I.end.toFixed(2)} s (4.0 s)`);
  t.ok(I.hiss.length === 1 && I.hiss[0].kind === 'inflate' && Math.abs(I.hiss[0].t - D.pull) < 2 / 60 + 1e-6, `the CO2 hiss at the cord (${JSON.stringify(I.hiss)})`);
  t.ok(at(I.rows, 0.3)?.pack === 'free' && !at(I.rows, 0.3)?.shown, 'first the strapped pack, off his back');
  t.ok(at(I.rows, 0.8)?.shown && at(I.rows, 0.8)?.pack === 'hidden', 'then the hull itself, spread out of the pack');
  // the hull drawn: a flat sheet at the cord, rising monotonically (its mean height) to the full raft
  const inf = I.rows.filter((q) => q.t >= D.pull && q.t <= D.full && q.meanY != null);
  let back = 0, backAt = null;
  for (let k = 1; k < inf.length; k++) { const d = inf[k - 1].meanY - inf[k].meanY; if (d > back) { back = d; backAt = inf[k].t; } }
  const y0 = at(I.rows, D.pull).meanY, y1 = at(I.rows, D.full - 0.02).meanY;
  t.ok(inf.length > 100, `the inflation drawn frame by frame (${inf.length} frames)`);
  t.ok(back <= 0.002, `…rising monotonically (largest step back ${(back * 1000).toFixed(2)} mm at ${backAt?.toFixed(2)} s)`);
  t.ok(y1 - y0 >= 0.06, `…from a flat sheet (mean height ${y0.toFixed(3)} m) to the round tubes (${y1.toFixed(3)} m)`);
  const mid = at(I.rows, (D.pull + D.full) / 2).meanY;
  t.ok(mid > y0 + 0.01 && mid < y1 - 0.01, `…visibly part-way half way through (${mid.toFixed(3)} m)`);
  // hands on the valve / the tube while it fills (fully weighted ones on their targets)
  const errs = I.rows.filter((q) => q.t > D.pull + 0.4 && q.t < D.full).flatMap((q) => [q.err?.l, q.err?.r]).filter((x) => x != null);
  t.ok(errs.length > 50 && Math.max(...errs) <= 0.03, `his hands on the valve and the tube (worst ${errs.length ? Math.max(...errs).toFixed(3) : '-'} m over ${errs.length} hand-frames)`);
  t.ok(I.adopted, 'the raft spawned is the hull drawn (same model, no swap)');
  t.ok(I.restored, '…its library geometry back on it (no deformation left)');
  t.ok(I.aboard, 'he is aboard');
  t.ok(I.packAfter === 'hidden', 'no pack on his back once the raft is out');
  // ---- pack
  t.log(JSON.stringify({ pack: { end: P.end, gone: P.gone, hiss: P.hiss, final: P.final, on: P.on, behind: P.behind, height: P.height,
    meanY: [0.3, P.P.open, 1.0, 1.4, P.P.flat].map((x) => [x, +(at(P.rows, x)?.meanY ?? NaN).toFixed(4)]) } }));
  t.ok(Math.abs(P.end - 3.6) < 2 / 60 + 1e-6, `H on the raft takes ${P.end.toFixed(2)} s (3.6 s: deflate 2.0 + fold 1.6)`);
  t.ok(P.gone != null && Math.abs(P.gone - 2.0) < 2 / 60 + 1e-6, `the raft out of the sim at ${P.gone?.toFixed(2)} s (2.0 s, as before)`);
  t.ok(P.hiss.length === 1 && P.hiss[0].kind === 'deflate' && Math.abs(P.hiss[0].t - P.P.open) < 2 / 60 + 1e-6, `the valve's hiss (${JSON.stringify(P.hiss)})`);
  const def = P.rows.filter((q) => q.t >= P.P.open && q.t <= P.P.flat && q.meanY != null);
  let up = 0, upAt = null;
  for (let k = 1; k < def.length; k++) { const d = def[k].meanY - def[k - 1].meanY; if (d > up) { up = d; upAt = def[k].t; } }
  const z0 = at(P.rows, P.P.open).meanY, z1 = at(P.rows, P.P.flat).meanY;
  t.ok(def.length > 50 && up <= 0.002, `the hull drawn sagging monotonically as it empties (largest step up ${(up * 1000).toFixed(2)} mm at ${upAt?.toFixed(2)} s)`);
  t.ok(z0 - z1 >= 0.06, `…from the full raft (${z0.toFixed(3)} m) to a flat sheet (${z1.toFixed(3)} m)`);
  t.ok(P.rows.some((q) => q.t > 3.3 && q.t < 3.55 && q.pack === 'free'), 'the pack lifted up from the ground');
  t.ok(P.has && P.final === 'back' && P.on, 'the folded pack ends on the Marine (on his spine)');
  t.ok(P.behind != null && P.behind < -0.05 && P.behind > -0.45, `…behind him (${P.behind?.toFixed(2)} m)`);
  t.ok(P.height > 0.8 && P.height < 1.6, `…at his back's height (${P.height?.toFixed(2)} m)`);
  t.ok(r.out.walking.pack === 'back' && r.out.walking.packOnMarine, 'and stays on his back as he walks off');
}
