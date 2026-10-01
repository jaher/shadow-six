/**
 * bodies-design §E browser (part B, blood) on M1 (snow): a sniper kill (entry mist, exit spatter cone, a pool that
 * soaks into the snow with a darker core and a pink halo), a knife kill (arterial spurt, the attacker's sleeve), a fresh
 * body dragged (heel furrow + smear with halo, lying IN the furrow) and one carried on the shoulder (drips + bloody boot
 * prints of the carrier), clothing stains; a quick save → load re-simulates the same pool masks; censored mode shows
 * no blood. Screenshots → docs/screenshots/bodies-blood-snow-*.jpg (game zoom strip + 1:1 close-ups at zoom 4).
 */
import { saveJpeg } from './bodies-physics.test.mjs';

export default async function bodiesBlood(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const Wp = await import('/src/abilities/weapons.js');
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    let W = G.world;
    const out = { hasBlood: !!W.blood };
    for (let i = 0; i < 40 && !W.blood?.layers; i++) await new Promise((ok) => setTimeout(ok, 50));
    out.layers = !!W.blood?.layers;
    // M1 squad: Green Beret, Diver, Driver — the Diver fires the (test) sniper shots, the Driver shoulders a body
    const cs = W.commandos, gb = cs.find((c) => c.role === 'greenberet'), sniper = cs.find((c) => c !== gb), spy = cs.find((c) => c !== gb && c !== sniper);
    const sp = H.openSpot(W, gb.x, gb.z, 9);
    H.clearArea(W, sp.x, sp.z, 22);
    W.enemies.forEach(H.freeze);
    for (const e of W.enemies) e.coneVisible = false;
    const gs = W.enemies.filter((e) => e.alive && e.soldierType !== 'dog').slice(0, 3);
    gs[0].setPosition(sp.x - 1.5, sp.z - 1.0, 0); gs[1].setPosition(sp.x + 2.5, sp.z + 1.2, Math.PI); gs[2].setPosition(sp.x - 3, sp.z + 3, 0);
    sniper.setPosition(sp.x - 12, sp.z - 1.0, 0); gb.setPosition(sp.x + 3.3, sp.z + 1.2, Math.PI); spy.setPosition(sp.x + 6, sp.z + 3, 0);
    H.run(g, G, 10);
    const game = new H.Strip(G, { cols: 3, rows: 2, tileW: 420, tileH: 280, cropW: 780, cropH: 520 });
    const close = new H.Strip(G, { cols: 2, rows: 3, tileW: 600, tileH: 360, cropW: 600, cropH: 360 });
    const view = (x, z, zoom) => { g.setZoom(zoom); g.centerOn(x, z); };
    Wp.fireBullet(W, sniper, gs[0], 999, 'sniper', 'sniperRifle');      // exit spatter east
    gs[1].die('knife', gb);                                              // arterial spurt
    H.run(g, G, 60, 1);
    view(sp.x + 0.5, sp.z + 0.3, 2); game.grab('1 s: spatter + knife spurt');
    view(sp.x + 2.8, sp.z + 1.2, 4); close.grab('knife: arterial spurt (zoom 4)');
    H.run(g, G, 240, 1);                                                // die clips + settle, rendered every tick
    H.run(g, G, 1500, 8);
    view(sp.x + 0.5, sp.z + 0.3, 2); game.grab('30 s: pools soak into the snow');
    out.pools30 = W.blood.pools.map((p) => ({ surface: p.surface, age: +p.age.toFixed(1), steps: p.sim?.steps ?? 0 }));
    // a fresh kill dragged 6 m: furrow + smear + halo
    Wp.fireBullet(W, sniper, gs[2], 999, 'sniper', 'sniperRifle');
    H.run(g, G, 150, 1);
    const carry = (c, body, mode, tx, tz, n) => {
      body.state = 'carried'; body.carriedBy = c; c.carrying = body; c.carryMode = mode;
      c.moveTo(tx, tz);
      H.run(g, G, n, 2); // part C: the game places a dragged body itself (0.95 m behind along the path)
    };
    gb.setPosition(gs[2].x + 0.9, gs[2].z, Math.PI);
    carry(gb, gs[2], 'drag', sp.x + 3.5, sp.z + 7.5, 420);
    out.smears = W.blood.smears.length;
    view(sp.x + 0.6, sp.z + 5.2, 2); game.grab('drag: heel furrow + smear');
    view(sp.x + 0.2, sp.z + 4.8, 4); close.grab('drag on snow: smear in the furrow, pink halo');
    // the spy shoulders the knife victim through its pool: drips + bloody prints
    const kp = W.blood.pools.find((p) => p.unitId === gs[1].id) || gs[1];
    spy.setPosition(kp.x - 0.3, kp.z, 0);                              // he steps through the knife victim's pool
    carry(spy, gs[1], 'shoulder', sp.x + 8, sp.z - 3, 300);
    out.drips = W.blood.decals.filter((d) => d.k === 7 || d.k === 6).length; { const bb = W.blood.bleeders.get(gs[1].id); out.dbg = bb ? { left: bb.left, total: bb.total, done: bb.done, st: gs[1].state, cm: spy.carryMode, d: Math.hypot(spy.x - (sp.x + 8), spy.z - (sp.z - 3)) } : "none"; }
    out.prints = W.blood.decals.filter((d) => d.k === 8 || d.k === 9).length;
    view(sp.x + 5.2, sp.z - 1.2, 4); close.grab('shoulder carry: drips + bloody prints');
    view(sp.x + 4, sp.z, 2); game.grab('shoulder carry: drips, prints');
    H.run(g, G, 60 * 90, 60);                                            // 90 s more: the snow keeps it vivid (×4)
    view(sp.x - 1.4, sp.z - 1.0, 4); close.grab('pool on snow, 2 min (zoom 4)');
    gs[0].object3d.visible = false; H.run(g, G, 1, 1);
    close.grab('same pool, body hidden: core, fingers, halo');
    gs[0].object3d.visible = true;
    // stains: the sniper victim's chest (entry + exit), close
    out.stains = (W.blood.stains.get(gs[0].id) || []).length; out.gbStains = (W.blood.stains.get(gb.id) || []).length;
    view(gs[0].x, gs[0].z, 4); close.grab('clothing stains (entry + exit)');
    view(sp.x + 1, sp.z + 2, 2); game.grab('2 min later (game zoom)');
    out.close = close.jpeg();
    // save → load: pools re-simulate from their seeds to the same masks
    const hash = (sim) => { const d = sim.writeTile(new Uint8Array(64 * 64 * 4)); let h = 0; for (let i = 0; i < d.length; i++) h = (Math.imul(h, 31) + d[i]) | 0; return h; };
    const replay = (B, p) => { const q = { ...p, sim: null }; B._sim(q); q.sim.advanceTo(p.age); return hash(q.sim); };
    G.quickSave();
    const refs = W.blood.pools.map((p) => ({ id: p.id, age: p.age, h: replay(W.blood, p) }));
    const ok = await G.quickLoad();
    W = G.world;
    for (let i = 0; i < 40 && !W.blood?.layers; i++) await new Promise((res) => setTimeout(res, 50));
    out.loaded = ok && W.blood.pools.length === refs.length;
    out.sameMasks = refs.every((rf) => { const p = W.blood.pools.find((q) => q.id === rf.id); return !!p && Math.abs(p.age - rf.age) < 1e-3 && replay(W.blood, p) === rf.h; });
    H.run(g, G, 30, 1);
    out.afterLoad = { pools: W.blood.pools.length, decals: W.blood.decals.length, smears: W.blood.smears.length, stains: W.blood.stains.size };
    // censored: every blood layer hidden, nothing new recorded
    G.options.censored = true;
    const n0 = W.blood.decals.length + W.blood.pools.length;
    out.enemiesAfterLoad = [W.enemies.length, W.enemies.filter((e) => e.alive).length];
    const v = W.enemies.find((e) => e.alive && e.soldierType !== 'dog') || W.enemies.find((e) => e.alive);
    if (!v) { out.game = game.jpeg(); return out; }
    v.setPosition(sp.x + 1, sp.z - 3, 0); H.freeze(v);
    out.cmdAfterLoad = W.commandos.map((c) => [c.role, c.alive]); out.ok = ok;
    const sn2 = W.commandos.find((c) => c.role === sniper.role && c.alive) || W.commandos.find((c) => c.alive);
    if (!sn2) { out.game = game.jpeg(); return out; }
    sn2.setPosition(sp.x - 8, sp.z - 3, 0);
    Wp.fireBullet(W, sn2, v, 999, 'sniper', 'sniperRifle');
    H.run(g, G, 240, 4);
    out.censoredNew = W.blood.decals.length + W.blood.pools.length - n0;
    out.censoredHidden = !W.blood.layers.pools.mesh?.visible && !W.blood.layers.decals.mesh.visible;
    view(sp.x + 1, sp.z + 2, 2); H.run(g, G, 1, 1); game.grab('after a load, CENSORED: no blood');
    out.game = game.jpeg();
    G.options.censored = false;
    return out;
  });
  console.log('    after load', JSON.stringify([r.ok, r.enemiesAfterLoad, r.cmdAfterLoad, r.afterLoad]));
  saveJpeg('bodies-blood-snow-strip.jpg', r.game);
  saveJpeg('bodies-blood-snow-close.jpg', r.close);
  t.ok(r.hasBlood && r.layers, 'world.blood with its drawn layers');
  t.ok(r.pools30.length >= 2 && r.pools30.every((p) => p.surface === 'snow' && p.steps > 100), `snow pools simulated ${JSON.stringify(r.pools30)}`);
  t.ok(r.smears > 20, `drag smear segments ${r.smears}`);
  t.ok(r.drips >= 2, `shoulder drips ${r.drips} ${JSON.stringify(r.dbg)}`);
  t.ok(r.prints >= 2, `bloody boot prints ${r.prints}`);
  t.ok(r.stains >= 2 && r.gbStains >= 1, `stain slots: victim ${r.stains}, knife attacker ${r.gbStains}`);
  t.ok(r.loaded, 'quick load restores the pools');
  t.ok(r.sameMasks, 'restored pools re-simulate to the same masks');
  t.equal(r.censoredNew, 0, 'censored: no new blood');
  t.ok(r.censoredHidden, 'censored: blood layers hidden');
  console.log(`    bodies-blood: pools ${JSON.stringify(r.pools30)}, smears ${r.smears}, drips ${r.drips}, prints ${r.prints}, stains ${r.stains}/${r.gbStains}, after load ${JSON.stringify(r.afterLoad)}`);
}
