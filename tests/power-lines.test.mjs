/**
 * Power lines, telegraph wires and cable-car ropes meet their towers in the real game (user report, M3: "The power
 * lines dont line up exactly with the power towers"). Every mission loads in turn; for every conductor drawn (each
 * mesh carrying `userData.cableSpans`: the furniture wires, the cable-car ropes) both drawn ends lie ≤ 2 cm from their
 * tower's fixing node (`cable:<k>`, art/cable-attach.js) where the model finally stands (seated, lifted, turned),
 * the wind sway leaves the ends still, every insulator of a wired tower carries a conductor, and each mission that
 * authors a line (wired telegraph_pole / pylons, telegraph furniture, a cable car) draws it.
 * Unit side (models measured, pairing, Node build of every mission's lines): tests/unit/power-lines.test.mjs.
 */
/** Every mission (M1–M20 + sandboxes) loads in turn. */
export const timeout = 1_500_000;

export default async function powerLines(page, t) {
  // POWER_LINES_MISSIONS=m03,m05 narrows a dev run (the full test loads every mission)
  const only = process.env.POWER_LINES_MISSIONS?.split(',').filter(Boolean);
  const ids = (await page.evaluate(async () => (await import('./src/missions/index.js')).MISSIONS.map((m) => m.id))).filter((id) => !only || only.includes(id));
  const all = [];
  for (const id of ids) {
    const r = await page.evaluate(async (mid) => {
      const { getMission } = await import('./src/missions/index.js');
      const { measureCableEnds, cableNodes } = await import('./src/art/cable-attach.js');
      const { expandFurniture, normalizeRoadNetwork } = await import('./src/world/roads.js');
      const g = window.__game, def = getMission(mid);
      await g.loadMission(mid);
      g.start();
      g.advance(0.5); // a cable car strings its line on its first update
      g.render();
      const scene = g.game.renderer.scene;
      const ends = measureCableEnds(scene);
      // the drawn ends and the sway weights there (the wind shader moves a vertex by aSway: 0 = fixed)
      const sway = [], used = new Set(), towers = new Set();
      scene.traverse((m) => {
        const S = m.userData?.cableSpans, G = m.geometry?.userData?.spans;
        if (!m.isMesh || !S || !G) return;
        const A = m.geometry.attributes.aSway;
        S.forEach((s, k) => {
          used.add(s.a); used.add(s.b); towers.add(s.a.parent); towers.add(s.b.parent);
          if (A) for (const i0 of G.ends[k]) for (let j = 0; j < G.ring; j++) sway.push(Math.abs(A.getX(i0 + j)));
        });
      });
      const idle = [];
      for (const tw of towers) for (const n of cableNodes(tw)) if (!used.has(n)) idle.push(`${tw.parent?.name || tw.name}:${n.name}`);
      const ids = new Map((def.structures || []).map((s) => [s.id, s]));
      const authored = (def.structures || []).filter((s) => s.type === 'telegraph_pole' && ids.get(s.wireTo)?.type === 'telegraph_pole').length
        + expandFurniture(normalizeRoadNetwork(def)).lines.length + (def.vehicles || []).filter((v) => v.vehicleType === 'cable_car').length;
      const bad = ends.filter((e) => !(e.gap <= 0.02)).slice(0, 6).map((e) => `${e.mesh} #${e.span}${e.end} ${e.node} gap ${e.gap.toFixed(3)} m at ${e.at.map((v) => v.toFixed(1))}`);
      return { id: mid, ends: ends.length, worst: Math.max(0, ...ends.map((e) => e.gap)), bad, sway: Math.max(0, ...sway), idle: idle.slice(0, 6), towers: towers.size, authored };
    }, id);
    all.push(r);
    if (r.ends || r.authored) t.log(`${id}: ${r.ends / 2} conductors on ${r.towers} towers / portals, worst end gap ${(r.worst * 100).toFixed(2)} cm`);
  }
  for (const r of all) {
    t.equal(r.bad.length, 0, `${r.id}: every conductor end ≤ 2 cm from its insulator ${r.bad.join('; ')}`);
    t(r.sway < 1e-6, `${r.id}: the wind never moves a conductor's ends (${r.sway})`);
    t.equal(r.idle.length, 0, `${r.id}: every insulator of a wired tower carries a conductor ${r.idle.join(', ')}`);
    t(!r.authored || r.ends > 0, `${r.id}: its authored lines are drawn`);
  }
  if (ids.includes('m03')) t(all.find((r) => r.id === 'm03')?.ends === 16, 'M3: two pylon spans × four conductors');
}
