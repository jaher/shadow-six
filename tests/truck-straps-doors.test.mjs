/**
 * Hands and straps at the M2 lorry (user requests 2026-10-07: "In the tailgate or the truck can we make the stripes
 * slide sideways as commandos enter the truck from behind" / "Can we have the commando arm close the door of the
 * car"), on the real character skeleton and the real Opel Blitz model:
 *  - a commando climbing in over the tailgate parts the five leather straps hanging in the rear opening
 *    (art/strap-curtain.js): the straps in his way slide sideways, no strap link inside his body on any drawn frame,
 *    the static straps hidden on every LOD, back at rest a few seconds after; getting out parts them again;
 *  - a commando getting into the driver's seat (art/door-hand.js): the door opens only as far as he can reach from the
 *    seat; seated, his fist goes onto the door's pull and the door swings shut WITH his hand — the grip within 3 cm of
 *    the pull on every frame of the pull, the door's angle the one the hand has; getting out his hand pushes it open,
 *    and outside he swings it shut by its edge (within 3 cm too).
 */
export const timeout = 240_000;

export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, g = G.game, dt = G.CONFIG.sim.dt, THREE = await import('three');
    await G.loadMission('m02'); G.start(); g.stop(); // deterministic: only our steps advance the figures
    const w = g.world, cam = g.cameraController;
    const v = w.byId('truck') || w.entities.find((e) => e.kind === 'vehicle' && e.tag === 'truck');
    await v.model.ready;
    const D = await import('/src/abilities/drive.js');
    const [a, b] = w.commandos.filter((q) => q.alive);
    // a quiet yard: no alarm, and nobody — the sentries, the armour, and any squad a barracks would release later —
    // moves, sees or shoots while we watch (M2's barracks squads walk over the snow drifts to the lorry since
    // fix/snow-drift-walkable: freezing only the men on the map at load let them down the man at the door)
    const { Enemy } = await import('/src/entities/enemy.js');
    Enemy.prototype.update = function () {};
    if (w.alarm) w.alarm.raise = () => null;
    for (const x of w.vehicles) if (x !== v) x.update = () => {}; v.taint = () => {}; v.bulletImmune = true;
    const hd = v.heading, C = v.model.curtain;
    const out = { curtain: !!C, straps: C?.state.straps.length ?? 0 };
    if (!C) return out;
    // the static straps are hidden on every LOD, the chain mesh is drawn
    let hidden = 0, shown = 0;
    v.model.visual.object3d.traverse((o) => { if (o.isMesh && /leather/.test(o.material?.name || '') && o !== C.mesh) (o.visible ? shown++ : hidden++); });
    out.staticHidden = hidden; out.staticShown = shown; out.meshIn = !!C.mesh.parent;
    // camera on the tailgate (the figures only have bones on screen)
    const aim = (x, z, yawDeg, el = 22, zoom = 4) => { const az = yawDeg * Math.PI / 180, e = el * Math.PI / 180, k = 1.5 / Math.tan(e); cam.elevation = e; cam.setYaw(yawDeg); cam.setZoom(zoom, true); cam.centerOn(x - Math.sin(az) * k, z - Math.cos(az) * k); };
    const back = Math.atan2(-Math.cos(hd), -Math.sin(hd)) * 180 / Math.PI;
    aim(v.x - Math.cos(hd) * 3, v.z - Math.sin(hd) * 3, back - 25);
    const step = () => { g.step(dt); g.render(1 / 60, 1); };
    // the figures are built asynchronously: wait for them (no frames pass meanwhile: the RAF loop is stopped)
    const ready = async () => { step(); const F = v._crewFig; for (const f of [...(F?.occupants?.values() || []), ...(F?.moving || [])]) await f.m.ready; };
    // the highest point of a figure's crown / neck / back / shoulders over the ceiling there (model frame, m)
    const fr = v.model.visual.object3d, CROWN = [['Head', 0.13], ['neck_01', 0.09], ['spine_03', 0.15], ['upperarm_l', 0.08], ['upperarm_r', 0.08]];
    const worst = { o: -1, at: '' };
    const overCeil = (m, ceil, tag = '') => {
      const B = m.real?.inner?.bones; if (!B?.Head) return -1;
      let o = -1;
      for (const [n, r] of CROWN) {
        if (!B[n]) continue;
        const p = fr.worldToLocal(B[n].getWorldPosition(new THREE.Vector3())), oo = p.y + r - ceil(p.x, p.z);
        if (oo > o) o = oo;
        if (oo > worst.o) { worst.o = oo; worst.at = `${tag} ${n} ${m.anim} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) root ${m.root.position.toArray().map((x) => x.toFixed(2))}`; }
      }
      return o;
    };
    const can = v.model.canopy;
    const canCeil = (x, z) => (z < can.zRear - 0.06 || z > can.zFront ? Infinity : z < can.zRear + 0.16 ? can.roll : can.roof);
    for (let i = 0; i < 20; i++) step();
    // --- straps: in over the tailgate, then out
    const p = D.boardPoint(v, a, 2);
    a.x = p.x; a.z = p.z; a.snap?.();
    for (let i = 0; i < 6; i++) step();
    const S = C.state, offs = () => S.straps.map((s) => s.P[6 * 3] - s.x);
    const P = await import('/src/art/strap-curtain.js');
    let pen = 0, maxOff = 0, bodies = 0, crown = -1, tail = 0;
    const tq = v.model.visual.parts.tailgate, tq0 = tq?.quaternion.clone();
    const tailgate = () => (tq ? tq.quaternion.angleTo(tq0) : 0); // the tailgate stays up: they climb over it
    out.canopy = can;
    v.enter(a, 2, 2);
    await ready();
    for (let i = 0; i < 100; i++) {
      step();
      if (S.bodies.length) { bodies++; pen = Math.max(pen, P.curtainPenetration(S)); }
      maxOff = Math.max(maxOff, ...offs().map(Math.abs));
      for (const q of v._crewFig?.moving || []) crown = Math.max(crown, overCeil(q.m, canCeil, 'in' + i));
      tail = Math.max(tail, tailgate());
    }
    out.inCrown = crown;
    for (let i = 0; i < 240; i++) step();
    out.inBodies = bodies; out.inPen = pen; out.inMax = maxOff; out.restAfterIn = Math.max(...offs().map(Math.abs));
    v.exit(a);
    await ready();
    pen = 0; maxOff = 0; bodies = 0; crown = -1;
    for (let i = 0; i < 100; i++) {
      step();
      if (S.bodies.length) { bodies++; pen = Math.max(pen, P.curtainPenetration(S)); }
      maxOff = Math.max(maxOff, ...offs().map(Math.abs));
      for (const q of v._crewFig?.moving || []) crown = Math.max(crown, overCeil(q.m, canCeil, 'out' + i));
      tail = Math.max(tail, tailgate());
    }
    out.tailgate = tail;
    out.outBodies = bodies; out.outPen = pen; out.outMax = maxOff; out.outCrown = crown;
    // --- the driver's door
    const rig = v.model.doorRigs(0)[0];
    out.doorFrac = rig.frac;
    const left = Math.atan2(rig.side * Math.sin(hd), -rig.side * Math.cos(hd)) * 180 / Math.PI;
    const dw = { x: v.x + 0.75 * Math.cos(hd) + rig.pivot[0] * Math.sin(hd), z: v.z + 0.75 * Math.sin(hd) - rig.pivot[0] * Math.cos(hd) };
    aim(dw.x, dw.z, left - 20 * rig.side, 22, 5);
    const q = D.boardPoint(v, b, 0);
    b.x = q.x; b.z = q.z; b.snap?.();
    for (let i = 0; i < 10; i++) step();
    v.model.boarding(0, 'open');
    for (let i = 0; i < 40; i++) step();
    out.openedTo = v.model.doorFrac(rig.node);
    const up = (u) => (u.alive === false ? 'dead' : u.downed ? 'downed' : 'up');
    out.bState = `${up(b)}/${up(a)}`; // nobody hurt: the climb-in is shown for a man on his feet
    v.enter(b, 0, 0);
    await ready();
    const errs = { close: [], push: [], shut: [] }, track = { close: [], push: [], shut: [] };
    const hand = () => v._crewFig?.occupants?.get(b)?.hand || [...(v._crewFig?.moving || [])].find((x) => x.u === b)?.hand || null;
    const fig = () => v._crewFig?.occupants?.get(b)?.m || [...(v._crewFig?.moving || [])].find((x) => x.u === b)?.m || null;
    const roof = v.model.seatHolder(0)?.roof ?? Infinity, half = Math.abs(rig.pivot[0]) + 0.04;
    const cabCeil = (x) => (Math.abs(x) < half ? roof + 0.01 : Infinity);
    let shutAt = -1, cabCrown = -1;
    for (let i = 0; i < 260; i++) {
      step();
      const m = fig(); if (m) cabCrown = Math.max(cabCrown, overCeil(m, cabCeil));
      const h = hand();
      if (h && (h.phase === 'close') && h.key.w > 0.999 && h.err != null) { errs.close.push(h.err); track.close.push(Math.abs(v.model.doorFrac(rig.node) - h.frac)); if (h.err > (out.closeWorst?.err ?? 0)) out.closeWorst = { err: h.err, frac: h.frac, lean: h.lean, role: b.role }; }
      if (shutAt < 0 && i > 60 && v.model.doorFrac(rig.node) === 0) shutAt = i;
    }
    out.shutAt = shutAt; out.shutAfterClose = v.model.doorFrac(rig.node);
    v.exit(b);
    await ready();
    for (let i = 0; i < 360; i++) {
      step();
      const m = fig(); if (m) cabCrown = Math.max(cabCrown, overCeil(m, cabCeil));
      const h = hand();
      if (h && (h.phase === 'push' || h.phase === 'shut') && h.key.w > 0.999 && h.err != null) { errs[h.phase].push(h.err); track[h.phase].push(Math.abs(v.model.doorFrac(rig.node) - h.frac)); if (h.err > (out[h.phase + 'Worst']?.err ?? 0)) out[h.phase + 'Worst'] = { err: h.err, frac: h.frac, lean: h.lean }; }
    }
    out.cabCrown = cabCrown; out.worst = worst;
    out.finalDoor = v.model.doorFrac(rig.node);
    out.bVisible = !!b.object3d?.visible;
    for (const k of Object.keys(errs)) { out[k + 'N'] = errs[k].length; out[k + 'Err'] = errs[k].length ? Math.max(...errs[k]) : null; out[k + 'Track'] = track[k].length ? Math.max(...track[k]) : null; }
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.curtain && r.straps === 5, `the M2 lorry has a strap curtain (${r.straps} straps)`);
  t.ok(r.staticHidden >= 2 && r.staticShown === 0 && r.meshIn, `static straps hidden on every LOD (${r.staticHidden}), the chain drawn`);
  t.ok(r.inBodies > 10, `climbing in, his body reaches the curtain (${r.inBodies} frames)`);
  t.ok(r.inMax > 0.15, `the straps in his way slide aside (${r.inMax.toFixed(3)} m)`);
  t.ok(r.inPen <= 0.002, `no strap inside him on any frame (${(r.inPen * 1000).toFixed(1)} mm)`);
  t.ok(r.restAfterIn < 0.03, `back at rest after (${(r.restAfterIn * 100).toFixed(1)} cm)`);
  t.ok(r.outBodies > 10 && r.outMax > 0.15 && r.outPen <= 0.002, `getting out parts them too (${r.outMax.toFixed(3)} m, ${(r.outPen * 1000).toFixed(1)} mm)`);
  t.ok(r.tailgate < 1e-3, `the tailgate stays up while they climb over it (${r.tailgate.toFixed(4)} rad)`);
  t.ok(r.inCrown <= 0.01 && r.outCrown <= 0.01, `he stoops under the rolled-up flap and the canvas: crown / back never through it (in ${(r.inCrown * 100).toFixed(1)} cm, out ${(r.outCrown * 100).toFixed(1)} cm over)`);
  t.ok(r.bState === 'up/up', `both men on their feet (not downed) before he gets in (${r.bState})`);
  t.ok(r.doorFrac > 0.45 && r.doorFrac < 1 && Math.abs(r.openedTo - r.doorFrac) < 0.02, `the door opens as far as he can reach from the seat (${(r.doorFrac * 75).toFixed(0)}°)`);
  t.ok(r.closeN > 15 && r.closeErr < 0.03, `pulling it shut: his grip on the pull within 3 cm on every frame (${r.closeN} frames, ≤ ${(r.closeErr * 100).toFixed(2)} cm)`);
  t.ok(r.closeTrack < 1e-6, 'the door is where his hand has it');
  t.ok(r.shutAt > 0 && r.shutAfterClose === 0, `shut by his hand (${r.shutAt} frames after he got in)`);
  t.ok(r.pushN > 10 && r.pushErr < 0.03, `getting out, his hand pushes it open (≤ ${(r.pushErr * 100).toFixed(2)} cm)`);
  t.ok(r.shutN > 10 && r.shutErr < 0.03, `outside, he swings it shut by its edge (≤ ${(r.shutErr * 100).toFixed(2)} cm)`);
  t.ok(r.cabCrown <= 0.015, `getting in and out of the cab his head stays under its roof (${(r.cabCrown * 100).toFixed(1)} cm over)`);
  t.ok(r.finalDoor === 0 && r.bVisible, 'door shut, his own model back');
}
