/**
 * Vehicle ambient step (GPU): M1's seeded aircraft flyover — nothing during the briefing, the element in the air at its
 * scheduled sim time, trimmed library aircraft with prop discs and a shadow-only twin on the sun ray (drawn by the shadow
 * pass only), identical after a reload with the same seed; windsocks droop in a calm and stream downwind in a blow.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const THREE = await import('three');
    await G.loadMission('m01');
    const F = G.world.flyovers;
    out.has = !!F;
    if (!F) return out;
    const p = F.schedule()[0];
    // briefing: the sim clock is stopped and nothing is shown, even at the pass time
    G.world.time = p.t0 + p.dur / 2; G.render(1 / 60, 1);
    out.briefing = [G.state, F.group.visible, F.active().length];
    g.start();
    G.world.time = p.t0 + p.dur / 2;
    for (let k = 0; k < 3; k++) G.render(1 / 60, 1);
    await new Promise((ok) => setTimeout(ok, 200));
    G.render(1 / 60, 1);
    const kids = F.group.children.filter((h) => h.visible);
    const plane = kids.find((h) => /^flyover:/.test(h.name)), twin = kids.find((h) => /^flyover-shadow:/.test(h.name));
    out.play = { active: F.active().length, n: p.n, type: p.type, visible: kids.length, plane: plane?.name, twin: !!twin };
    if (plane && twin) {
      const sun = G.renderer.sunDir, a = plane.position, b = twin.position;
      const k = (a.y - b.y) / sun.y; // the twin rides the plane's sun ray
      out.ray = Math.hypot(a.x - sun.x * k - b.x, a.z - sun.z * k - b.z);
      let meshes = 0, shadowOnly = 0, discs = 0;
      twin.traverse((o) => { if (o.isMesh) { meshes++; if (o.material.colorWrite === false && o.castShadow && o.customDepthMaterial) shadowOnly++; } });
      plane.traverse((o) => { if (o.isMesh && o.geometry?.type === 'CircleGeometry') discs++; });
      out.twin = [meshes, shadowOnly, discs, +b.y.toFixed(1), +a.y.toFixed(1)];
      // level flight: model +z (nose) horizontal after the three-point trim
      const m = plane.children[0].children[0].matrixWorld, tr = plane.userData.trim || 0;
      out.noseY = +new THREE.Vector3(0, Math.sin(tr), Math.cos(tr)).transformDirection(m).y.toFixed(3);
      out.upY = +new THREE.Vector3(0, 1, 0).transformDirection(m).y.toFixed(3);
      out.trim = +(tr * 180 / Math.PI).toFixed(1);
    }
    // engine drone: a keyed 'plane_engine' loop while playing (panned / Doppler-shifted per frame), silenced on pause
    const loops = () => [...(G.audio?.loops?.entries?.() || [])].filter(([k]) => /^flyover:/.test(k)).map(([, v]) => v.id);
    out.sound = loops();
    G.pause(true); G.render(1 / 60, 1);
    out.soundPaused = loops().length;
    G.pause(false);
    // deterministic under the replay seed: a reload gives the same schedule
    const s1 = JSON.stringify(F.schedule().slice(0, 3).map((q) => [q.t0, q.type, q.n, q.heading]));
    await G.loadMission('m01');
    out.same = s1 === JSON.stringify(G.world.flyovers.schedule().slice(0, 3).map((q) => [q.t0, q.type, q.n, q.heading]));
    // windsock: calm vs a coast blow
    const base = (await import('/src/missions/m00_sandbox.js')).default;
    out.sock = {};
    for (const preset of ['calm', 'coast']) {
      await G.loadMission({ ...base, id: 'm00', enemies: [], weather: { wind: { preset, dirDeg: 30 } },
        structures: [...(base.structures || []), { id: 'ws', type: 'windsock', x: 30, z: 30, rot: 0, w: 1, d: 1, h: 6 }] });
      g.start();
      for (let k = 0; k < 150; k++) { g.step(); G.render(1 / 30, 1); }
      const s = [...G.world.structures.values()].find((q) => q.def.id === 'ws');
      const root = s.object3d.getObjectByName('static-vehicle:windsock');
      const seg1 = root?.getObjectByName('sock_seg1'), seg4 = root?.getObjectByName('sock_seg4');
      if (!seg1 || !seg4) { out.sock[preset] = null; continue; }
      const p1 = seg1.getWorldPosition(new THREE.Vector3()), p4 = seg4.getWorldPosition(new THREE.Vector3());
      const w = G.world.wind.sample(30, 30);
      const d = p4.clone().sub(p1), hor = Math.hypot(d.x, d.z);
      let cloth = 0, rigid = 0; // one continuous cloth tube per LOD; the hinged segment meshes stay hidden
      root.traverse((o) => { if (o.name === 'sock_cloth') cloth++; });
      seg1.traverse((o) => { if (o.isMesh && o.visible) rigid++; });
      out.sock[preset] = { cloth, rigid, wind: +w.speed.toFixed(2), droop: +(Math.atan2(-d.y, hor) * 180 / Math.PI).toFixed(0),
        dot: +((d.x * w.x + d.z * w.z) / (hor * Math.hypot(w.x, w.z) || 1)).toFixed(2) };
    }
    return out;
  });
  t.log(JSON.stringify(r));
  t.ok(r.has, 'M1 has ambient flyovers');
  t.equal(r.briefing[1], false, 'nothing shown during the briefing / Colonel\'s tour');
  t.ok(r.play.active === 1 && r.play.visible === 2 * r.play.n, `the ${r.play.type} element is in the air (${r.play.visible} objects)`);
  t.ok(r.ray < 0.05, `shadow twin on the aircraft's sun ray (${r.ray?.toFixed(3)})`);
  t.ok(r.twin[0] > 0 && r.twin[1] === r.twin[0], `twin draws only into the shadow map (${r.twin[1]}/${r.twin[0]} meshes)`);
  t.ok(r.twin[2] >= 1, `propeller blur disc(s): ${r.twin[2]}`);
  t.ok(r.twin[3] < 20 && r.twin[4] > 50, `twin low on the ray (${r.twin[3]} m), aircraft at altitude (${r.twin[4]} m)`);
  t.ok(Math.abs(r.noseY) < 0.06 && r.upY > 0.95 && r.trim > 5, `flying level and upright, three-point attitude (${r.trim}°) trimmed out (datum y ${r.noseY}, up ${r.upY})`);
  t.ok(r.same, 'same seed → same flyovers after a reload');
  t.ok(r.sound?.length === 1 && r.sound[0] === 'plane_engine' && r.soundPaused === 0, `engine loop while playing, silent when paused (${JSON.stringify(r.sound)} / ${r.soundPaused})`);
  t.ok(r.sock.calm && r.sock.coast, 'windsock built from the library');
  t.ok(r.sock.calm.cloth >= 1 && r.sock.calm.rigid === 0, `continuous cloth sock (${r.sock.calm.cloth} LOD meshes), no hinged segments shown`);
  t.ok(r.sock.calm.droop > 45, `calm (${r.sock.calm.wind} m/s): the sock droops (${r.sock.calm.droop}°)`);
  t.ok(r.sock.coast.droop < 20, `blow (${r.sock.coast.wind} m/s): the sock streams out (${r.sock.coast.droop}°)`);
  t.ok(r.sock.coast.dot > 0.8, `…pointing downwind (cos ${r.sock.coast.dot})`);
}
