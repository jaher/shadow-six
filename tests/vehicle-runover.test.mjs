/**
 * Moving vehicles and men in their lane (user: "neither soldiers nor commandos can cross cars or any other object which
 * could be climbed on"; docs/clipping-audit.md "Characters and vehicles"). On M1: a slow truck stops short of a commando
 * lying across its lane and waits; a standing German in the lane of a slow (empty) truck steps aside — he runs there,
 * no jump — and the truck goes on past him; a fast truck runs a crawling German over (BEL §3.7). Nobody is left alive
 * under a chassis. Parked vehicles: vehicle-block.test.mjs.
 */
export default async function vehicleRunover(page, t) {
  const r = await page.evaluate(async () => {
    const { setup, BC, freeze } = await import('/tests/vehicle-clear-page.mjs');
    const { Enemy } = await import('/src/entities/enemy.js');
    const { w, spots, tick, mesh } = await setup('m01', { n: 1, R: 8.5 });
    const out = { spots: spots.length, moving: {} };
    if (!spots.length) return out;
    const p = spots[0];
    // a slow truck and a commando lying across its lane
    const man = w.commandos.find((c) => c.alive);
    const tr = w.spawnVehicle('truck', { x: p.x - 7, z: p.z, heading: 0, friendly: true });
    man.stop?.(); man.setPosition(p.x + 1, p.z + 0.6, Math.PI / 2); man.setStance('crawl'); tick(20);
    tr.followPath([{ x: p.x + 8, z: p.z }], { fast: false });
    let minGap = Infinity;
    for (let s = 0; s < 420; s++) { tick(1); minGap = Math.min(minGap, BC.unitGap(man)); }
    out.moving.slow = { alive: man.alive, minGap: +minGap.toFixed(3), mesh: +mesh(man).toFixed(3), truckX: +(tr.x - p.x).toFixed(2) };
    man.setPosition(p.x + 25, p.z - 5, 0);
    w.remove(tr); tick(2);
    // a slow truck and a German standing in its lane: he steps aside (runs, no jump), the truck goes on
    const tr1 = w.spawnVehicle('truck', { x: p.x - 7, z: p.z, heading: 0, friendly: true });
    const st = w.add(new Enemy({ soldierType: 'soldier', x: p.x + 1, z: p.z + 0.3, heading: Math.PI }));
    freeze(st); tick(10);
    tr1.followPath([{ x: p.x + 8, z: p.z }], { fast: false });
    let jump = 0, gap = Infinity, px = st.x, pz = st.z;
    for (let s = 0; s < 600; s++) {
      tick(1);
      jump = Math.max(jump, Math.hypot(st.x - px, st.z - pz)); px = st.x; pz = st.z;
      gap = Math.min(gap, BC.capsuleRectGap(BC.bodyCapsule(st.x, st.z, st.heading, st.stance), BC.hullRect(tr1)));
    }
    out.moving.aside = { alive: st.alive, jump: +jump.toFixed(3), minGap: +gap.toFixed(3), moved: +Math.hypot(st.x - p.x - 1, st.z - p.z - 0.3).toFixed(2), truckX: +(tr1.x - p.x).toFixed(2) };
    w.remove(st); w.remove(tr1); tick(2);
    // a fast truck and a crawling German
    const tr2 = w.spawnVehicle('truck', { x: p.x - 7, z: p.z, heading: 0, friendly: true });
    const ger = w.add(new Enemy({ soldierType: 'soldier', x: p.x + 3, z: p.z + 0.5, heading: Math.PI / 2 }));
    freeze(ger);
    ger.setStance('crawl'); tick(20);
    tr2.followPath([{ x: p.x + 8, z: p.z }], { fast: true });
    let underAlive = 0;
    for (let s = 0; s < 240; s++) { tick(1); if (ger.alive && BC.unitGap(ger) < -0.02) underAlive++; }
    out.moving.fast = { alive: ger.alive, cause: ger.deathCause ?? null, underAlive, truckX: +(tr2.x - p.x).toFixed(2) };
    return out;
  });
  t.log(JSON.stringify(r.moving));
  t.ok(r.spots === 1, `a free spot on M1 (${r.spots})`);
  const S = r.moving.slow, A = r.moving.aside, F = r.moving.fast;
  t.ok(S.alive && S.minGap >= 0 && S.mesh <= 0.02, `slow truck stops short of a man lying in its lane (${JSON.stringify(S)})`);
  t.ok(S.truckX < -1, `…and waits there (${S.truckX})`);
  t.ok(A.alive && A.moved > 0.5 && A.minGap >= 0, `a German standing in a slow truck's lane steps out of it alive (${JSON.stringify(A)})`);
  t.ok(A.jump < 0.2, `…running, not jumping aside (largest step ${A.jump} m)`);
  t.ok(A.truckX > 5, `…and the truck goes on past him (${A.truckX})`);
  t.ok(!F.alive && F.cause === 'runover' && F.underAlive === 0, `fast truck runs a crawler over, never drives over him alive (${JSON.stringify(F)})`);
}
