/**
 * bodies-design §E browser (part A, the world): an M2 bomb next to the crate stack, the truck, the SE hut and two
 * guards — the crates wake and tumble (nav re-stamp), the truck rocks, nearby glass blows out and doors swing; a quick
 * save taken while bodies fly loads (Rapier snapshot) and they settle; censored mode draws graves instead of bodies.
 */
import { saveJpeg } from './bodies-physics.test.mjs';

export default async function bodiesPhysicsWorld(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const P = await import('/src/entities/projectile.js');
    await g.loadMission('m02'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    const W = G.world, out = {}; out.warns = []; const _w = console.warn; console.warn = (...a) => { out.warns.push(a.map((x) => String(x?.stack || x)).join(' ').slice(0, 600)); _w(...a); };
    G._checkEnd = () => {};   // staging: the bomb wrecks the escape truck (M2 would be lost)
    const bx = 48.4, bz = 48.8;
    const crate = W.physics.props.items.find((i) => i.key === 'crates1');
    out.crate0 = crate ? [...crate.pose] : null;
    const guards = W.enemies.filter((e) => e.alive && e.soldierType === 'soldier').slice(0, 2);
    guards[0].setPosition(bx - 1.6, bz - 1.2, 0.4); guards[1].setPosition(bx + 1.4, bz + 1.8, 2.5);
    for (const e of guards) H.freeze(e);
    for (const e of W.enemies) e.coneVisible = false;
    g.centerOn(bx, bz + 1); g.setZoom(1.25);
    H.run(g, G, 20);
    const strip = new H.Strip(G, { cols: 3, rows: 2, cropW: 1000, cropH: 660 });
    strip.grab('M2 bomb: 0.00 s');
    P.explode(W, bx, bz, 'bomb', W.commandos[0]);
    const truck = W.vehicles.find((v) => v.vehicleType === 'truck');
    let saved = null;
    H.run(g, G, 400, 1, (i) => {
      for (const e of W.enemies) e.coneVisible = false;
      if (i === 2) out.rock = !!truck?.blastRock;
      if ([8, 24, 60, 150].includes(i)) strip.grab(`${(i / 60).toFixed(2)} s`);
      if (i === 18 && !saved) { out.movingAtSave = W.physics.moving(); saved = G.quickSave?.() ?? null; }
    });
    strip.grab('6.67 s');
    out.strip = strip.jpeg();
    out.crate1 = crate ? [...crate.pose] : null;
    out.crateStamp = crate?.stamp ? crate.stamp.cells.length : 0;
    out.brokenPanes = [...(W.brokenPanes || [])];
    out.dead = guards.map((e) => ({ id: e.id, alive: e.alive, settled: e.settled, x: e.x, z: e.z }));
    // load the save taken at 0.30 s (bodies in the air): they finish the flight and settle again
    const ok = await G.quickLoad();
    const W2 = G.world;
    out.loaded = ok && W2 !== W;
    out.snapRagdolls = W2.physics.ragdolls.length;
    H.run(g, G, 360, 3);
    out.afterLoad = W2.enemies.filter((e) => guards.some((q) => q.id === e.id)).map((e) => ({ id: e.id, settled: e.settled, x: e.x, z: e.z }));
    out.marksAfterLoad = W2.marks.serialize().length;
    // censored: graves where the bodies lie
    G.options.censored = true;
    for (const e of W2.enemies) e.coneVisible = false;
    const body = W2.enemies.find((e) => !e.alive && e.settled && guards.some((q) => q.id === e.id));
    g.centerOn(body ? body.x : bx, body ? body.z : bz); g.setZoom(2.8); H.run(g, G, 4, 1);
    const cs = new H.Strip(G, { cols: 1, rows: 1, tileW: 900, tileH: 560, cropW: 1100, cropH: 685 });
    cs.grab('censored: graves');
    out.graves = G.physicsVisuals?.graves.size ?? 0;
    out.censored = cs.jpeg();
    G.options.censored = false;
    H.run(g, G, 2, 1);
    out.gravesAfter = G.physicsVisuals?.graves.size ?? 0;
    return out;
  });
  saveJpeg('bodies-physics-props-strip.jpg', r.strip);
  saveJpeg('bodies-physics-censored.jpg', r.censored);
  t.ok(r.crate0 && r.crate1, 'M2 crates are a loose prop');
  t.ok(Math.hypot(r.crate1[0] - r.crate0[0], r.crate1[2] - r.crate0[2]) > 0.5, `the bomb threw the crates (${JSON.stringify(r.crate1.slice(0, 3))})`);
  t.ok(r.rock, 'the truck rocks');
  t.ok(r.dead.every((d) => !d.alive && d.settled), `both guards died and settled ${JSON.stringify(r.dead)}`);
  t.ok(r.movingAtSave, 'the save was taken while bodies were flying');
  t.ok(r.loaded, 'quick load');
  t.ok(r.afterLoad.every((d) => d.settled), `after the load the bodies settle ${JSON.stringify(r.afterLoad)} snap ${r.snapRagdolls} warns ${r.warns.join(' | ')}`);
  t.ok(r.marksAfterLoad >= 1, 'the crater came back with the save');
  t.ok(r.graves >= 2, `censored: graves (${r.graves})`);
  t.equal(r.gravesAfter, 0, 'graves go when censored mode is off');
  console.log(`    bodies-physics-world: crate stamp ${r.crateStamp} cells, panes ${r.brokenPanes.join(',') || 'none'}, ragdolls from snapshot ${r.snapRagdolls}`);
}
