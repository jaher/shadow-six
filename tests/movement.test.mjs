/**
 * Movement: order the Green Beret across the sandbox, past the house. He must arrive, and every sampled
 * position (and the path's straight segments) must stay on walkable cells — i.e. the path goes around
 * the building instead of through it.
 */
export default async function movement(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const w = g.game.world;
    for (const e of [...w.enemies]) w.remove(e); // no interference from sentries
    g.start();
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    const start = { x: gb.x, z: gb.z };
    const goal = { x: 16, z: 6 };
    const houseBlocked = !!w.grid.blockAt(16, 14);
    const straightClear = w.grid.walkableLine(start.x, start.z, goal.x, goal.z);
    const accepted = g.order(gb.id, { type: 'move', x: goal.x, z: goal.z, run: true });
    const samples = [];
    let arrivedAt = null;
    for (let i = 0; i < 400 && arrivedAt == null; i++) {
      g.advance(0.1);
      samples.push([gb.x, gb.z]);
      if (Math.hypot(gb.x - goal.x, gb.z - goal.z) < 0.6 && !gb.path?.length) arrivedAt = w.time;
    }
    const bad = samples.filter(([x, z]) => !w.grid.walkableAt(x, z)).length;
    let len = 0;
    for (let i = 1; i < samples.length; i++) len += Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]);
    // closest approach to the house centre: must stay outside its footprint
    const minHouse = Math.min(...samples.map(([x, z]) => Math.hypot(x - 16, z - 14)));
    g.centerOn(16, 12);
    return { accepted, houseBlocked, straightClear, arrivedAt, end: { x: gb.x, z: gb.z }, bad, len, direct: Math.hypot(goal.x - start.x, goal.z - start.z), minHouse, state: gb.state };
  });
  t.log(JSON.stringify(r));
  t(r.accepted !== false, 'move order accepted');
  t(r.houseBlocked, 'house footprint is blocked on the grid');
  t(!r.straightClear, 'straight line to goal crosses an obstacle (test premise)');
  t(r.arrivedAt != null, `commando arrived (end ${r.end.x.toFixed(2)},${r.end.z.toFixed(2)})`);
  t.equal(r.bad, 0, 'no sampled position on a blocked cell');
  t(r.len > r.direct + 0.5, `path detours around the house (len ${r.len.toFixed(1)} vs direct ${r.direct.toFixed(1)})`);
  t(r.minHouse > 2.5, `stayed outside the house (closest ${r.minHouse.toFixed(2)} m from centre)`);
  // running speed sanity: arrived in roughly len / runSpeed
  t(r.arrivedAt < 40, `arrived in ${r.arrivedAt?.toFixed(1)} s`);
  await t.shot('movement');
}
