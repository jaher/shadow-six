/**
 * Nobody crawls into a solid prop (user: "neither soldiers not commandos can cross cars or any other object which could
 * be climbed on"; docs/clipping-audit.md "Characters and solid objects"). M2: a commando crawls at the crate stack
 * `crates1` from 8 directions and at the fuel depot; b00 (BCD sandbox): at the pushable fuel tank, the rail wagon and
 * the crates. The body never gets into the prop on the way (body-clearance gap ≥ 0) and the posed meshes never
 * overlap it by more than the audit's 5 cm, on the way or at the stop. Then the Green Beret pushes the wagon at a man
 * lying across the rail: it stops short of him. Saves tests/out/body-props.png.
 */
export default async function bodyProps(page, t) {
  const r = await page.evaluate(async () => {
    const { setup, approachRuns, BC } = await import('/tests/vehicle-clear-page.mjs');
    const out = { runs: [] };
    {
      const { g, w } = await setup('m02', { n: 0 });
      const c = w.commandos.find((u) => u.alive);
      for (const [T, ks] of [[{ x: 46, z: 48, r: 1.4, id: 'crates1' }, [0, 1, 2, 3, 4, 5, 6, 7]], [{ x: 49.64, z: 27.94, r: 4.6, id: 'depot_a' }, [3]]]) {
        for (const R of approachRuns(g, w, c, T, { ks })) out.runs.push({ id: T.id, ...R });
      }
    }
    const { g, G, w, tick } = await setup('b00', { n: 0 });
    const c = w.commandos.find((u) => u.alive);
    for (const [T, ks] of [[{ x: 62, z: 82, r: 1.7, id: 'tank1' }, [0, 2, 4, 6]], [{ x: 45, z: 70, r: 2.7, id: 'wagon1' }, [2, 6]], [{ x: 60, z: 30, r: 1, id: 'crates' }, [0, 4]]]) {
      for (const R of approachRuns(g, w, c, T, { ks })) out.runs.push({ id: T.id, ...R });
    }
    // the wagon pushed at a man lying across the rail
    const { Enemy } = await import('/src/entities/enemy.js');
    const wag = w.interactables.find((i) => i.variant === 'wagon');
    const gb = w.commandos.find((u) => u.role === 'greenberet' || u.role === 'driver');
    const e = w.add(new Enemy({ soldierType: 'soldier', x: 51, z: 70.3, heading: Math.PI / 2 }));
    if (e.brain) e.brain.update = () => {};
    e.setStance('crawl'); tick(10);
    gb.stop?.(); gb.setPosition(wag.x - 3.2, wag.z, 0); gb.setStance('stand'); tick(5);
    out.pushTaken = wag.interact(gb);
    let minGap = Infinity;
    const hull = () => ({ x: wag.x, z: wag.z, h: wag.heading ?? 0, hl: wag.size[0] / 2, hw: wag.size[1] / 2 });
    for (let s = 0; s < 900 && wag.goal; s++) { tick(1); minGap = Math.min(minGap, BC.capsuleRectGap(BC.bodyCapsule(e.x, e.z, e.heading, e.stance), hull())); }
    out.push = { stopped: !wag.goal, wagonX: +wag.x.toFixed(2), minGap: +minGap.toFixed(3), alive: e.alive, moved: +Math.hypot(e.x - 51, e.z - 70.3).toFixed(3) };
    g.setZoom(2.4); g.centerOn(wag.x + 3, wag.z); G.render(0, 1);
    return out;
  });
  await t.shot('body-props');
  t.ok(r.runs.length === 17, `17 crawls (${r.runs.length})`);
  for (const R of r.runs) {
    const tag = `${R.id} crawl from ${R.k * 45}°`;
    if (R.skip) { t.ok(false, `${tag}: no free start`); continue; }
    t.ok(R.took && R.arrived, `${tag}: order taken and finished (${JSON.stringify(R)})`);
    t.ok(R.minGap >= 0, `${tag}: body never in a solid on the way (min gap ${R.minGap})`);
    t.ok(R.worst <= 0.05, `${tag}: posed meshes never overlap a prop by more than 5 cm (${R.worst} m ${R.hit} at ${R.at})`);
  }
  t.ok(r.pushTaken, 'the Green Beret pushes the wagon');
  t.ok(r.push.stopped && r.push.wagonX < 51, `the wagon stops short of the man on the rail (${JSON.stringify(r.push)})`);
  t.ok(r.push.minGap >= 0 && r.push.alive && r.push.moved < 1e-3, `it never rolls into or through him (${JSON.stringify(r.push)})`);
}
