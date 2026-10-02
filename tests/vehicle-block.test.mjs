/**
 * Nobody crosses a vehicle (user: "neither soldiers nor commandos can cross cars or any other object which could be
 * climbed on"; docs/clipping-audit.md "Characters and vehicles"). On M1: enemy soldiers ordered straight across a
 * parked truck, Kübelwagen and Panzer II (standing, crouched) walk round them. Moving vehicles: vehicle-runover.test.mjs.
 */
export default async function vehicleBlock(page, t) {
  const r = await page.evaluate(async () => {
    const { setup, BC, freeze } = await import('/tests/vehicle-clear-page.mjs');
    const { Enemy } = await import('/src/entities/enemy.js');
    const { w, spots, tick, mesh } = await setup('m01', { n: 1, R: 8.5 });
    const out = { spots: spots.length, walk: [] };
    if (!spots.length) return out;
    const p = spots[0];
    for (const [i, type] of ['truck', 'kubelwagen', 'panzer2'].entries()) {
      const v = w.spawnVehicle(type, { x: p.x, z: p.z, heading: 0.3 + i * 0.5, friendly: true });
      tick(2);
      const run = [[0 + i, 'stand'], [3 + i, 'crouch']].map(([k, st]) => { // two at once, from different sides
        const a = k * Math.PI / 4;
        const e = w.add(new Enemy({ soldierType: 'soldier', x: p.x + Math.cos(a) * 6, z: p.z + Math.sin(a) * 6, heading: a + Math.PI }));
        freeze(e);
        e.setStance(st);
        return { e, k, st, to: { x: p.x - Math.cos(a) * 6, z: p.z - Math.sin(a) * 6 }, minGap: Infinity };
      });
      tick(5);
      for (const R of run) R.ok = R.e.moveTo(R.to.x, R.to.z);
            for (let s = 0; s < 1200 && run.some((R) => R.e.path); s += 3) { tick(3); for (const R of run) R.minGap = Math.min(R.minGap, BC.unitGap(R.e)); }
      for (const R of run) {
        out.walk.push({ type, k: R.k, st: R.st, ok: R.ok, stance: R.e.stance, minGap: +R.minGap.toFixed(3), mesh: +mesh(R.e).toFixed(3),
          miss: +Math.hypot(R.e.x - R.to.x, R.e.z - R.to.z).toFixed(2) });
        w.remove(R.e);
      }
      w.remove(v); tick(2);
    }
    return out;
  });
  t.ok(r.spots === 1, `a free spot on M1 (${r.spots})`);
  t.ok(r.walk.length === 6, `six walks (${r.walk.length})`);
  for (const c of r.walk) {
    const tag = `enemy ${c.st} across ${c.type} (${c.k * 45}°)`;
    t.ok(c.ok && c.miss <= 1 && c.stance === c.st, `${tag}: arrives on the far side (${JSON.stringify(c)})`);
    t.ok(c.minGap >= 0, `${tag}: walks round the hull (min gap ${c.minGap})`);
    t.ok(c.mesh <= 0.02, `${tag}: no mesh overlap (${c.mesh})`);
  }
}
