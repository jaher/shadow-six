/**
 * The raft's inside is its own fabric (user 2026-10-15: "When the inflatable raft is inflated there should not be water
 * or the ground inside it", then "Actually no water seems to be going inside the raft, it looks like the raft has a
 * hole in the front?"). The library raft's floor lay flat under its raised bow tube, leaving a slot between them that
 * showed the water beyond the bow (or, inside the dry-hull cut-out, the river bed) from every view into the boat; it
 * now sweeps up into the tube (art/raft-hull.js raftFloorFix, raft.py floor_z). And the hull drawn outside the sim —
 * inflating before the sim's raft exists, the sheet after it went into his kit — had no dry-hull cut-out: the sea's
 * swell washed over the spread sheet and the filling hull's floor (art/raft-actions.js raftDryHulls).
 *
 *  1. CLOSED: in both shipped LODs every open edge of the hull mesh round the floor (its rim) lies inside the tube,
 *     at the bow too (the floor ramps up into it there), so nothing can be seen through between floor and tube;
 *  2. NOTHING INSIDE: water painted flat magenta, the ground and its cover flat cyan (tests/raft-floor-lib.mjs), the
 *     pixels over the floor as drawn — points on it and 5 / 12 cm above it, whatever its state — are read back from
 *     the bow (ahead), astern (the view into the bow), the sides and quarters at the game's 40° and from 70° above:
 *     none may be water or ground —
 *       M2 river bank: inflating (sheet, chambers filling, full), the Marine aboard (LOD0 and LOD2), with the Green
 *       Beret, empty, beached on the snow (two headings), being deflated and folded (until gathered);
 *       M13 sea (swell): inflating at the rock's west side, and the raft afloat.
 * RAFTDRY_SHOTS=<dir> saves the worst view of any survey that fails.
 */
import { writeFileSync } from 'node:fs';
import { installRaftFloor } from './raft-floor-lib.mjs';

export const timeout = 600_000;

const SHOTS = process.env.RAFTDRY_SHOTS || '';

export default async function raftDryInterior(page, t) {
  await page.evaluate(installRaftFloor);

  // ---- 1. the hull mesh is closed round the floor (both LODs)
  const closed = await page.evaluate(async () => {
    const { g, G } = window.__rf, THREE = await import('three');
    const RH = await import('/src/art/raft-hull.js');
    const VM = await import('/src/art/vehicle-model.js'), VE = await import('/src/entities/vehicle.js');
    await g.loadMission('m02'); g.start(); await G.mapHandle?.ready;
    const m = VM.createLibraryVehicleModel('raft', VE.vehicleDef('raft'), {});
    for (let i = 0; i < 200 && !m?.isReady; i++) await new Promise((r) => setTimeout(r, 50));
    if (!m?.isReady) return { error: 'raft model not ready' };
    G.renderer.scene.add(m.root); m.root.updateMatrixWorld(true);
    const space = m.visual.object3d, inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
    const L = RH.tubeLoop(), R = RH.HULL.R;
    const fromTube = (p) => { let bd = Infinity; for (let i = 0; i < L.n; i++) bd = Math.min(bd, (L.P[i * 3] - p.x) ** 2 + (L.P[i * 3 + 1] - p.y) ** 2 + (L.P[i * 3 + 2] - p.z) ** 2); return Math.sqrt(bd) / R; };
    const lods = {};
    space.traverse((o) => {
      if (!o.isMesh || !o.geometry?.index) return;
      let lod = null;
      for (let a = o; a && a !== space; a = a.parent) { if (/paddle|oar/i.test(a.name)) return; const k = /_lod(\d+)$/.exec(a.name); if (k) lod = +k[1]; }
      if (lod == null) return;
      const M = new THREE.Matrix4().copy(inv).multiply(o.matrixWorld), pos = o.geometry.attributes.position, idx = o.geometry.index;
      const P = [], key = new Map(), id = new Int32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(M), k = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
        if (!key.has(k)) { key.set(k, P.length); P.push(v); }
        id[i] = key.get(k);
      }
      const E = new Map();
      for (let tr = 0; tr < idx.count; tr += 3) {
        const a = id[idx.getX(tr)], b = id[idx.getX(tr + 1)], c = id[idx.getX(tr + 2)];
        for (const [u, v] of [[a, b], [b, c], [c, a]]) { if (u === v) continue; const k = u < v ? `${u}_${v}` : `${v}_${u}`; E.set(k, (E.get(k) || 0) + 1); }
      }
      const L0 = (lods[lod] ||= { rim: 0, out: [], bowTop: 0, minR: 9, maxR: 0 });
      for (const [k, n] of E) {
        if (n !== 1) continue;
        const [u, v] = k.split('_').map(Number), mid = P[u].clone().add(P[v]).multiplyScalar(0.5);
        if (!(Math.abs(mid.x) < 0.45 && mid.y < 0.16 && Math.abs(mid.z) < 1.2)) continue;   // round the floor
        const r = Math.max(fromTube(P[u]), fromTube(P[v]), fromTube(mid));
        L0.rim++; L0.minR = Math.min(L0.minR, r); L0.maxR = Math.max(L0.maxR, r);
        if (mid.z > 0.9) L0.bowTop = Math.max(L0.bowTop, mid.y);
        if (r >= 0.97) L0.out.push([+mid.x.toFixed(2), +mid.y.toFixed(3), +mid.z.toFixed(2), +r.toFixed(2)]);
      }
    });
    m.root.removeFromParent(); m.dispose?.();
    return { lods };
  });
  t.ok(!closed.error, `raft model: ${closed.error || 'loaded'}`);
  for (const lod of ['0', '2']) {
    const L = closed.lods?.[lod];
    t.log(`LOD${lod} floor rim: ${JSON.stringify(L && { rim: L.rim, minR: +L.minR.toFixed(2), maxR: +L.maxR.toFixed(2), bowTop: +L.bowTop.toFixed(3), out: L.out.slice(0, 6) })}`);
    t.ok(L && L.rim >= 20, `LOD${lod}: the floor's open rim found (${L?.rim} edges)`);
    t.ok(L && L.out.length === 0, `LOD${lod}: every open edge round the floor is inside the tube (worst ${L?.maxR?.toFixed(2)} R; outside: ${JSON.stringify(L?.out.slice(0, 4))})`);
    t.ok(L && L.bowTop > 0.06, `LOD${lod}: the floor rises into the raised bow (rim ${L?.bowTop?.toFixed(3)} m up)`);
  }

  // ---- 2. no water, no ground inside, whatever the raft is doing
  const scene = (mission, at, plan) => page.evaluate(async ({ mission, at, plan }) => {
    const RF = window.__rf, { g, G } = RF;
    const VL = await import('/src/art/vehicle-library.js');
    await g.loadMission(mission); g.start(); await G.mapHandle?.ready;
    const w = G.world; w.debug = { noDetect: true, invulnerable: true };
    for (const e of [...w.enemies]) w.remove(e);
    for (const v of [...w.vehicles]) if (v.def?.kind === 'boat' && v.vehicleType !== 'raft') w.remove(v);
    w.flushRemovals?.();
    const dv = w.commandos.find((c) => c.role === 'diver'), gb = w.commandos.find((c) => c !== dv && c.alive);
    for (const c of w.commandos) if (c !== dv && c !== gb) c.setPosition(c.x + 6, c.z + 6, c.heading);
    gb.setPosition(at[0] + 7, at[1] + 7, 0);
    dv.setPosition(at[0], at[1], 0);
    if (!dv.has('inflatableBoat')) dv.gainItem('inflatableBoat', 1);
    await dv.model?.ready;
    g.select([]); g.setZoom(2); g.centerOn(dv.x, dv.z);
    const step = () => { g.step(); G.render(1 / 60, 1); };
    const run = async (n) => { for (let i = 0; i < n; i++) { step(); if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0)); } };
    await run(20);
    RF.paint();
    const rows = [];
    const YAWS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => k * Math.PI / 4);
    const survey = (label, vis, S = null, o = {}) => {
      if (!vis || !vis.object3d.visible) { rows.push({ label, missing: true }); return; }
      const q = S ? Math.min(S.fill[0], S.fill[1], S.fill[2]) : 1;
      const lifts = [0.008, 0.05 * q, 0.12 * q].filter((h, i) => i === 0 || h > 0.01);
      const r = RF.survey(vis, { yaws: YAWS, pitches: [40, 70], lifts, shot: true, ...o });
      const shot = r.wet + r.dirt ? r.worst?.shot : null;
      if (r.worst) delete r.worst.shot;
      rows.push({ label, views: r.views, n: r.n, wet: r.wet, dirt: r.dirt, worst: r.worst, shot });
    };
    const actRec = (raft) => (w.raftActs || []).find((r) => !r.superseded && (raft ? r.raft === raft : r.kind === 'inflate'));
    // inflating
    let start = null;
    const off = w.events.on('ability:start', (e) => { if (e.unit === dv && start == null) start = w.time; });
    dv.issue({ type: 'ability', id: 'raft', target: dv });
    const times = [...plan.inflate];
    for (let i = 0; i < 60 * 14 && times.length; i++) {
      step(); if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
      if (start == null || w.time - start < times[0] - 1e-6) continue;
      const rec = actRec(null);
      survey(`inflating ${times.shift()} s`, rec?.vis?.handed ? null : rec?.vis?.model?.visual, rec?.vis?.S);
    }
    off();
    for (let i = 0; i < 900 && (dv.currentAction || dv.pendingAbility || !dv.vehicle); i++) { step(); if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0)); }
    await run(60);
    const raft = dv.vehicle?.vehicleType === 'raft' ? dv.vehicle : null;   // (the one he inflated: M13 has another)
    if (!raft) return { rows, error: 'no raft deployed (the Marine not aboard)' };
    const vis = raft.model.visual;
    survey('deployed, the Marine aboard', vis);
    if (plan.lod2) { VL.setVehicleZoom(0.5); await run(3); survey('deployed, the Marine aboard (LOD2)', vis, null, { half: 1.9 }); VL.setVehicleZoom(2); await run(3); }
    if (plan.crew) {
      gb.setPosition(raft.x + 1.2, raft.z + 1.2, 0);
      gb.issue({ type: 'ability', id: 'enterVehicle', target: raft });
      for (let i = 0; i < 30 && !gb.vehicle; i++) await run(20);
      await run(60);
      survey(`with the Green Beret (${raft.occupants.length} aboard)`, vis);
      if (gb.vehicle) { gb.issue({ type: 'ability', id: 'leaveVehicle', target: gb }); await run(150); }
      gb.setPosition(raft.x + 7, raft.z + 7, 0);
    }
    if (plan.empty || plan.beach || plan.pack) {
      if (dv.vehicle) { dv.issue({ type: 'ability', id: 'leaveVehicle', target: dv }); await run(150); }
      survey('empty', vis);
    }
    if (plan.beach) {
      const x0 = raft.x, z0 = raft.z, h0 = raft.heading, dx = dv.x, dz = dv.z;
      dv.setPosition(dx + 8, dz + 8, 0);
      for (const [ox, oz, h] of plan.beach) {
        raft.x = x0 + ox; raft.z = z0 + oz; raft.heading = h;
        await run(40);
        survey(`beached ${ox},${oz} (ground ${w.water.sample(raft.x, raft.z) ? 'wet' : 'dry'})`, vis);
      }
      raft.x = x0; raft.z = z0; raft.heading = h0;
      dv.setPosition(dx, dz, 0);
      await run(40);
    }
    if (plan.pack) {
      let t0 = null;
      const offP = w.events.on('ability:start', (e) => { if (e.unit === dv && t0 == null) t0 = w.time; });
      dv.issue({ type: 'ability', id: 'hand', target: raft });
      const pt = [...plan.pack];
      for (let i = 0; i < 60 * 12 && pt.length; i++) {
        step(); if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
        if (t0 == null || w.time - t0 < pt[0] - 1e-6) continue;
        const rec = actRec(raft), S = rec?.vis?.S;
        const label = `packing ${pt.shift()} s`;
        if (S && S.gather > 0.3) { rows.push({ label, skipped: 'gathered' }); continue; }
        survey(label + (raft.removed ? ' (in his kit)' : ''), raft.model.root.visible ? vis : null, S);
      }
      offP();
    }
    return { rows, raft: [raft.x, raft.z] };
  }, { mission, at, plan });

  const report = (where, r) => {
    t.ok(!r.error, `${where}: ${r.error || 'ran'}`);
    for (const row of r.rows || []) {
      if (row.skipped) { t.log(`${where} ${row.label}: ${row.skipped}`); continue; }
      t.ok(!row.missing, `${where} ${row.label}: the hull drawn`);
      if (row.missing) continue;
      t.log(`${where} ${row.label}: ${row.views} views, ${row.n} px, water ${row.wet}, ground ${row.dirt}${row.worst ? ` (worst: yaw ${row.worst.yaw} pitch ${row.worst.pitch} ${JSON.stringify(row.worst.bad.slice(0, 3))})` : ''}`);
      t.ok(row.n > row.views * 40, `${where} ${row.label}: floor sampled (${row.n} px)`);
      t.ok(row.wet === 0 && row.dirt === 0, `${where} ${row.label}: no water (${row.wet}) and no ground (${row.dirt}) seen inside the hull`);
      if (row.shot && SHOTS) writeFileSync(`${SHOTS}/${where}-${row.label.replace(/[^a-z0-9.]+/gi, '_')}.jpg`, Buffer.from(row.shot.split(',')[1], 'base64'));
    }
  };

  const m2 = await scene('m02', [42.75, 98.25], {
    inflate: [1.2, 1.6, 2.2, 2.8, 3.4, 3.9], lod2: true, crew: true, empty: true,
    beach: [[-2.5, 2.5, 0.6], [-3.5, 3.5, 2.4]], pack: [0.4, 1.0, 1.6, 2.1, 2.4, 2.7],
  });
  report('M2', m2);
  const m13 = await scene('m13', [73.2, 153.5], { inflate: [1.2, 1.8, 2.4, 3.0, 3.6] });
  report('M13', m13);
}
