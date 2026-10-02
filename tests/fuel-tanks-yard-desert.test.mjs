/** Fuel tanks, M8 + M11 defs in the dev tank yard (desert): see tests/fuel-tanks-yard.lib.mjs. */
import { load, shotAt, ZONE_SHOT, ZONES } from './fuel-tanks-yard.lib.mjs';

export default async function fuelTanksYardDesert(page, t) {
  // ---------------------------------------------------------------- M8 + M11 (desert)
  const desert = await load(page, 'desert');
  t.log('desert assets', JSON.stringify(desert));
  t.equal(desert.tank_b, 'fuel_tank_farm_9x7', 'M8 tank_b: 9 × 7 deck block');
  t.equal(desert.tank_a, 'fuel_tank_farm_85x63', 'M8 tank_a: 8.5 × 6.3 deck block');
  t.ok(!/oil_tank_column/.test(desert.drums_w1 || '') && !/oil_tank_column/.test(desert.drums_w2 || ''), `M8 drum dumps stay drum piles (${desert.drums_w1}, ${desert.drums_w2})`);
  for (const id of ['tank_w1', 'tank_w2', 'tank_w3', 'tank_q1', 'tank_q2']) t.ok(/^oil_tank_column(_b)?$/.test(desert[id] || ''), `M11 ${id}: process column (${desert[id]})`);
  const d1 = await page.evaluate(() => {
    const g = window.__game, G = g.game, w = G.world, P = window.__ty.props();
    const contain = (o) => {
      const v = new o.position.constructor(); o.updateMatrixWorld(true);
      const inv = o.matrixWorld.clone().invert(); let mx = 0, mz = 0, my = 0;
      o.traverse((m) => {
        if (!m.isMesh || !m.visible || /decal|pipe_run/.test(m.parent?.name || '') || !m.geometry) return;
        m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
        for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
          v.set(cx, cy, cz).applyMatrix4(m.matrixWorld).applyMatrix4(inv); mx = Math.max(mx, Math.abs(v.x)); mz = Math.max(mz, Math.abs(v.z)); my = Math.max(my, v.y);
        }
      });
      return { hx: +mx.toFixed(2), hz: +mz.toFixed(2), top: +my.toFixed(2) };
    };
    let runs = 0; G.renderer.scene.traverse((o) => { if (o.name === 'pipe_run') runs++; });
    const guard = w.byId('deck_guard');
    return { farm_b: contain(P.tank_b), farm_a: contain(P.tank_a), col: contain(P.tank_w2), runs, deckY: w.grid.elevAt(24, 22), guardY: w.grid.elevAt(guard.x, guard.z) };
  });
  t.log('desert contain', JSON.stringify(d1));
  t.ok(d1.farm_b.hx <= 4.5 + 0.3 && d1.farm_b.hz <= 3.5 + 0.8 && d1.farm_b.top <= 4.5 + 1.1, `tank_b inside 9 × 7 (+0.3; the south ladder cage 0.8): ${JSON.stringify(d1.farm_b)}`);
  t.ok(d1.farm_a.hx <= 4.25 + 0.3 && d1.farm_a.hz <= 3.15 + 0.8, `tank_a inside 8.5 × 6.3: ${JSON.stringify(d1.farm_a)}`);
  t.ok(d1.col.hx <= 1.75 + 0.3 && d1.col.hz <= 1.75 + 0.3 && d1.col.top <= 7.05, `column inside r 1.75 × 7: ${JSON.stringify(d1.col)}`);
  t.equal(d1.runs, 3, 'M11 pipe runs: w1-w2, w2-w3, q1-q2');
  t.ok(d1.deckY > 4.3 && d1.guardY > 4.3, `M8 deck walkable at 4.5 with the guard on it (deck ${d1.deckY}, guard cell ${d1.guardY})`);
  for (const [k, z] of [['m08', 1], ['m08', 2], ['m11', 1], ['m11', 2], ['m11q', 2]]) { await shotAt(page, ...ZONES[k], z); await ZONE_SHOT(page, t, `tanks-yard-${k}-intact-z${z}`); }
  const d2 = await page.evaluate(() => {
    const g = window.__game, G = g.game, w = G.world;
    g.pause(false);
    const sp = w.commandos.find((u) => u.role === 'sapper');
    sp.x = 21; sp.z = 26.3;                                            // 0.8 m off tank_b's south face
    const planted = g.useAbility(sp.id, 'timeBomb', sp.id);
    g.advance(1.5);
    const armed = w.entities?.filter?.((e) => /bomb/i.test(e.kind || e.constructor?.name || '')).length ?? null;
    g.order(sp.id, { type: 'move', x: 14, z: 44, run: true });
    w.byId('tank_q1').takeDamage(1, null, 'pistol');                   // a round bursts the quarry column
    w.interactables.find((i) => i.tag === 'tank_w2')?.destroy(null, 'explosion');
    g.advance(7.5);
    const gd0 = w.byId('deck_guard');                                  // (the bang of the column drew him off: back on deck)
    if (gd0?.alive) { gd0.x = 22; gd0.z = 21; if (gd0.brain) gd0.brain.frozen = true; }
    g.advance(3.5);
    const P = window.__ty.props(), gr = w.grid;
    let qAsset = null; G.renderer.scene.traverse((o) => { if (/barrels:tank_q1$/.test(o.name)) qAsset = o.userData.libraryAsset; });
    const lad = w.ladders.find((l) => l.id === 'ladder_b');
    let runs = 0; G.renderer.scene.traverse((o) => { if (o.name === 'pipe_run') runs++; });
    return { planted, armed, sx: sp.x, sz: sp.z, b: P.tank_b?.userData.libraryAsset, w2: P.tank_w2?.userData.libraryAsset, q: qAsset, deckY: gr.elevAt(24, 22),
      blockB: gr.blockAt(26, 20), blockQ: gr.blockAt(92, 75), blockW: gr.blockAt(78, 58), guard: w.byId('deck_guard')?.alive ?? false,
      ladder: gr.links.find((l) => l.id === lad?.linkId)?.enabled, runs };
  });
  t.log('desert after', JSON.stringify(d2));
  t.ok(d2.planted !== false, 'Sapper planted the bomb at tank_b');
  t.equal(d2.b, 'fuel_tank_farm_9x7_destroyed', 'tank_b wreck (bomb)');
  t.ok(/oil_tank_column(_b)?_destroyed/.test(d2.w2 || ''), `tank_w2 wreck (${d2.w2})`);
  t.ok(/oil_tank_column(_b)?_destroyed/.test(d2.q || ''), `quarry column burst like a barrel and left its wreck (${d2.q})`);
  t.ok(d2.deckY < 0.6, `the M8 deck walkway went with the tanks (elev ${d2.deckY})`);
  t.equal(d2.guard, false, 'the deck guard went down with the deck');
  t.equal(d2.ladder, false, 'ladder_b to the fallen deck disabled');
  t.ok(d2.blockB >= 1 && d2.blockQ >= 2 && d2.blockW >= 2, `wrecks keep blocking (tank_b ${d2.blockB}, q1 ${d2.blockQ}, w2 ${d2.blockW})`);
  t.equal(d2.runs, 3, 'pipe runs survive their tanks');
  await page.evaluate(() => window.__game.advance(8));               // let the blast dust settle: the fire + wrecks
  for (const [k, z] of [['m08', 1], ['m08', 2], ['m11', 1], ['m11', 2], ['m11q', 2]]) { await shotAt(page, ...ZONES[k], z); await ZONE_SHOT(page, t, `tanks-yard-${k}-destroyed-z${z}`); }
}
