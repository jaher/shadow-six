/**
 * bodies-design §C.6–§C.8 / §E browser (buddy rescue) on M1 (snow): the Diver takes a lethal (downable) hit and goes
 * DOWNED (collapse, breathing on the snow, the portrait's red bleed-out ring and seconds), crawls one-armed at 0.3 m/s,
 * the Green Beret drags him to cover (Shift+H), the Driver (medic) revives him with the first-aid kit (K, 4 s) and he
 * gets up with 34 HP. Frame strips + a HUD shot → docs/screenshots/bodies-dragcarry-downed-*.jpg.
 */
import { saveJpeg } from './bodies-physics.test.mjs';

export default async function bodiesDowned(page, t) {
  await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    const W = G.world, out = {};
    const cs = W.commandos, gb = cs.find((c) => c.role === 'greenberet'), dr = cs.find((c) => c.role === 'driver'), dv = cs.find((c) => c.role === 'diver');
    const sp = H.openSpot(W, gb.x, gb.z, 9);
    H.clearArea(W, sp.x, sp.z, 24);
    W.enemies.forEach(H.freeze);
    for (const e of W.enemies) e.coneVisible = false;
    const foe = W.enemies.find((e) => e.alive && e.soldierType !== 'dog');
    const view = (x, z, zoom) => { g.setZoom(zoom); g.centerOn(x, z); };
    const tick = (n, every = 1) => H.run(g, G, n, every);
    const at = (fn, n = 400) => { for (let i = 0; i < n && !fn(); i++) H.run(g, G, 1, 1); return fn(); };
    dv.setPosition(sp.x, sp.z, 0); gb.setPosition(sp.x + 4, sp.z - 2, Math.PI); dr.setPosition(sp.x - 5, sp.z - 3.5, 0);
    foe.setPosition(sp.x + 16, sp.z + 12, Math.PI);
    tick(30, 2);
    const s1 = new H.Strip(G, { cols: 4, rows: 2, tileW: 380, tileH: 280, cropW: 600, cropH: 440 });
    view(sp.x, sp.z, 3);
    dv.takeDamage(dv.hp, foe, 'shot');
    out.downed = { state: dv.state, alive: dv.alive, hp: dv.hp, t: dv.downed?.t };
    tick(24); s1.grab('hit: he collapses, alive');
    tick(90); s1.grab('DOWNED: breathing, a hand on the wound');
    // the HUD: portrait with the bleed-out ring + seconds, the alert line
    G.render(0, 1);
    out.portrait = (() => { const p = document.querySelector(`.hud-portrait[data-unit-id="${dv.id}"]`); return p ? { downed: p.classList.contains('downed'), secs: p.querySelector('.downed-secs')?.textContent, glyph: p.dataset.glyph } : null; })();
    out.msg = document.querySelector('.hud-message')?.textContent || '';
    view(dv.x, dv.z, 2); G.render(0, 1);
    window.__bd = { H, sp, s1, view, tick, at, dv, gb, dr, foe, out };
    return out;
  });
  // the whole screen with the HUD: the downed portrait (red pulse, bleed-out ring + seconds) and the alert line
  await page.waitForTimeout(900); // portrait stills fade in
  await page.screenshot({ path: new URL('../docs/screenshots/bodies-dragcarry-downed-hud.jpg', import.meta.url).pathname, type: 'jpeg', quality: 82 });
  const r = await page.evaluate(async () => {
    const { H, sp, s1, view, tick, at, dv, gb, dr, out } = window.__bd;
    const G = window.__game.game;
    view(dv.x, dv.z, 3);
    // he crawls towards the rocks
    dv.issue({ type: 'move', x: sp.x - 1.2, z: sp.z - 1.5 });
    tick(60); view(dv.x, dv.z, 3); s1.grab('crawls one-armed, 0.3 m/s');
    out.crawl = { speed: +dv.speed.toFixed(2), anim: dv.model.clip };
    tick(120);
    // the Green Beret drags him (Shift+H)
    out.dragIssued = gb.issue({ type: 'ability', id: 'drag', target: dv });
    at(() => gb.carrying === dv); view(gb.x, gb.z, 3); s1.grab('Shift+H: the GB grabs his collar');
    out.load = { mode: gb.carryMode, state: dv.state, clip: dv.model.clip };
    gb.issue({ type: 'move', x: dr.x + 1.6, z: dr.z + 0.6 });
    tick(150); view(gb.x, gb.z, 3); s1.grab('drags his buddy to the medic');
    at(() => !gb.path, 900);
    gb.issue({ type: 'cancel' }); at(() => !gb.carrying);
    // the Driver revives him (K)
    const doses = dr.inventory.get('firstAid');
    out.reviveIssued = dr.issue({ type: 'ability', id: 'firstAid', target: dv });
    at(() => (dv.reviving?.t ?? 0) >= 1.5); view(dr.x + 0.6, dr.z + 0.3, 3); s1.grab('K: the medic works on him (4 s)');
    G.render(0, 1);
    out.reviveRing = !!document.querySelector(`.hud-portrait[data-unit-id="${dv.id}"].reviving`);
    at(() => !dv.downed); s1.grab('revived: 34 HP');
    tick(80); s1.grab('he gets up');
    out.revived = { hp: dv.hp, state: dv.state, stance: dv.stance, doses: [doses, dr.inventory.get('firstAid')] };
    out.strip = s1.jpeg();
    return out;
  });
  saveJpeg('bodies-dragcarry-downed-strip.jpg', r.strip);
  console.log('    downed', JSON.stringify({ ...r, strip: undefined }));
  t.ok(r.downed.alive && r.downed.state === 'downed' && r.downed.hp === 0, 'downed: alive at 0 HP');
  t.ok(r.portrait?.downed && Number(r.portrait.secs) > 50, `portrait ring ${JSON.stringify(r.portrait)}`);
  t.ok(Math.abs(r.crawl.speed - 0.3) < 1e-6, `crawl ${JSON.stringify(r.crawl)}`);
  t.ok(r.dragIssued && r.load.mode === 'drag' && r.load.state === 'carried', `dragged ${JSON.stringify(r.load)}`);
  t.ok(r.reviveIssued, 'revive order accepted');
  t.ok(r.revived.hp === 34 && r.revived.state === 'active' && r.revived.doses[1] === r.revived.doses[0] - 1, `revived ${JSON.stringify(r.revived)}`);
}
