/**
 * bodies-design §E browser (part A, physics): a grenade among M1 guards on open snow → ragdolls fly, land and settle on
 * the terrain (frame strip), survivors react; the crater + scorch marks; a quick save mid-flight loads and the bodies
 * settle; censored mode draws graves. Screenshots → docs/screenshots/bodies-physics-*.jpg.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './harness.mjs';

const SHOTS = join(ROOT, 'docs/screenshots');
export function saveJpeg(name, dataUrl) {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
}

export default async function bodiesPhysics(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const P = await import('/src/entities/projectile.js');
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    const W = G.world, out = { phys: !W.physics.isNull, tier: W.physics.tier, house: { ...W.house } };
    const c = W.commandos[0];
    const sp = H.openSpot(W, c.x, c.z, 9);
    H.clearArea(W, sp.x, sp.z, 22);
    const gs = W.enemies.filter((e) => e.alive && e.soldierType !== 'dog').slice(0, 4);
    [[1.3, 0.3], [2.2, 2.4], [5.2, 4.0], [7.0, 5.6]].forEach(([d, a], k) => { gs[k].setPosition(sp.x + d * Math.cos(a), sp.z + d * Math.sin(a), a + Math.PI); H.freeze(gs[k]); });
    g.centerOn(sp.x, sp.z + 0.5); g.setZoom(1.7);
    H.run(g, G, 20);
    const settled = [];
    W.events.on('body:settled', (e) => settled.push(e.unit.id));
    const noCones = () => { for (const e of W.enemies) e.coneVisible = false; };
    const strip = new H.Strip(G, { cols: 3, rows: 2, cropW: 900, cropH: 600 });
    strip.grab('0.00 s');
    P.explode(W, sp.x, sp.z, 'grenade', c);
    const ms = [], counts = [];
    H.run(g, G, 330, 1, (i) => {
      ms.push(W.physics.stats().ms); counts.push(W.physics.ragdolls.length);
      noCones();
      if ([9, 21, 42, 90, 330].includes(i)) strip.grab(`${(i / 60).toFixed(2)} s`);
    });
    out.strip = strip.jpeg();
    out.dead = gs.filter((e) => !e.alive).map((e) => ({ id: e.id, settled: e.settled, pose: !!e.bodyPose, walk: W.grid.walkableAt(e.x, e.z), dist: Math.hypot(e.x - sp.x, e.z - sp.z) }));
    out.survivors = gs.filter((e) => e.alive).map((e) => e.id);
    out.settledEvents = settled.length;
    out.stepP95 = H.p95(ms.filter((_, i) => counts[i] > 0));
    out.idleMs = (() => { const a = []; H.run(g, G, 60, 60, () => a.push(W.physics.stats().ms)); return H.p95(a); })();
    // the pelvis bone lies on the ground (the drawn body matches the sim)
    const d0 = gs.find((e) => !e.alive);
    if (d0?.model?.real) {
      const pel = d0.model.real.getSocket('pelvis'), v = pel.getWorldPosition(new pel.position.constructor());
      out.pelvisAboveGround = v.y - (W.groundY ? W.groundY(v.x, v.z) : 0);
    }
    // crater close-up (+ the marks list saved with the game)
    noCones(); g.setZoom(3.0); g.centerOn(sp.x, sp.z); G.render(0, 1);
    const cz = new H.Strip(G, { cols: 2, rows: 1, tileW: 620, tileH: 400, cropW: 900, cropH: 580 });
    cz.grab('grenade crater, snow (M1)');
    // hard floor: a grenade on the M1 road
    let road = null; const gr = W.grid;
    for (let k = 0; k < gr.size && !road; k += 5) if (gr.terrain[k] === 1 && !gr.block[k] && !gr.bridge[k]) road = { x: (k % gr.cols + 0.5) * gr.cell, z: (Math.floor(k / gr.cols) + 0.5) * gr.cell };
    if (road) {
      H.clearArea(W, road.x, road.z, 12);
      P.explode(W, road.x, road.z, 'grenade', c); H.run(g, G, 240, 4);
      g.centerOn(road.x, road.z); G.render(0, 1); cz.grab('grenade scorch, road (M1)');
    }
    out.marks = W.marks.serialize();
    out.craters = cz.jpeg();
    return out;
  });
  saveJpeg('bodies-physics-blast-strip.jpg', r.strip);
  saveJpeg('bodies-physics-craters.jpg', r.craters);
  t.ok(r.phys, 'Rapier physics active in the browser');
  t.equal(r.tier, 'high');
  t.ok(r.dead.length >= 1, `the grenade killed the nearest guards (${r.dead.length})`);
  for (const d of r.dead) t.ok(d.settled && d.pose && d.walk, `body ${d.id} settled on walkable ground ${d.dist.toFixed(1)} m from the blast ${JSON.stringify(d)}`);
  t.ok(r.settledEvents >= r.dead.length, 'body:settled per body');
  t.ok(r.pelvisAboveGround == null || (r.pelvisAboveGround > -0.1 && r.pelvisAboveGround < 0.45), `the drawn pelvis lies on the ground (${r.pelvisAboveGround?.toFixed(3)} m)`);
  t.ok(r.marks.some((m) => m.s === 'soft'), 'a crater recorded on the snow');
  t.ok(r.marks.some((m) => m.s === 'hard'), 'a scorch recorded on the road');
  t.ok(r.stepP95 < 4, `physics step p95 with ragdolls ${r.stepP95.toFixed(3)} ms`);
  t.ok(r.idleMs < 0.2, `idle physics step ${r.idleMs.toFixed(3)} ms`);
  console.log(`    bodies-physics: dead ${r.dead.length}, survivors ${r.survivors.length}, step p95 ${r.stepP95.toFixed(3)} ms, idle ${r.idleMs.toFixed(3)} ms, marks ${r.marks.map((m) => m.s).join('/')}`);
}
