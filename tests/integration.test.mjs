/**
 * Cross-team seams in the running game (gp merge): a planted time bomb survives quicksave/quickload
 * (CORE2 save ↔ ABILITIES charges); right-click holsters a drawn pistol (CORE2 input ↔ ABILITIES
 * {type:'cancel'}); Shift+click on the ground draws the red probe ring (CORE2 ↔ AI cones, UI no longer
 * intercepts); the escaped-early event opens the UI dialog whose CONTINUE resumes
 * through game.continueEscape (CORE2 ↔ UI); a portrait click selects via input.selectUnit.
 */
export default async function integration(page, t) {
  // --- time bomb across a quickload
  const bomb = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00');
    g.start();
    const sa = G.world.commandos.find((c) => c.role === 'sapper');
    const out = { planted: sa.issue({ type: 'ability', id: 'timeBomb', target: sa }) };
    g.advance(2.0);
    const b = G.world.interactables.find((i) => i.interactKind === 'bomb');
    out.fuseBefore = b ? +b.fuse.toFixed(2) : null;
    out.saved = G.quickSave();
    g.advance(1.0);
    out.loaded = await G.quickLoad();
    G.pause(false);
    const b2 = G.world.interactables.find((i) => i.interactKind === 'bomb');
    out.fuseAfter = b2 ? +b2.fuse.toFixed(2) : null;
    let boom = null;
    const off = G.events.on('bomb:exploded', () => { boom = G.world.time; });
    const t0 = G.world.time;
    g.advance(12);
    off();
    out.explodedAfter = boom != null ? +(boom - t0).toFixed(2) : null;
    return out;
  });
  t.log(JSON.stringify(bomb));
  t(bomb.planted && bomb.saved && bomb.loaded, 'planted, saved, loaded');
  t(bomb.fuseBefore != null && bomb.fuseAfter != null, 'the bomb is still there after quickload');
  t.near(bomb.fuseAfter, bomb.fuseBefore, 0.05, 'fuse restored');
  t(bomb.explodedAfter != null && Math.abs(bomb.explodedAfter - bomb.fuseAfter) < 0.1, 'and it goes off on time');

  // --- right-click holsters; syringe cursor arms the Spy; Shift+click ground probe ring
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00');
    g.start();
    g.setZoom(1);
    const w = G.world, inp = G.input;
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    inp.select([gb]);
    const out = {};
    out.target = inp.beginTargeting('pistol');
    out.issued = gb.issue({ type: 'ability', id: 'pistol', target: { x: gb.x + 3, z: gb.z } }); // a shot into the ground nearby
    g.advance(0.5);
    out.armedBefore = gb.armed;
    out.right = inp.rightClick();
    g.advance(0.1);
    out.armedAfter = gb.armed;
    g.centerOn(gb.x, gb.z);
    g.render();
    const p = G.cameraController.worldToScreen(gb.x + 2, 0, gb.z + 2);
    out.probePt = { x: p.x, y: p.y };
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.armedBefore, 'pistol', 'pistol drawn');
  t.equal(r.right, 'cancel', 'right-click cancels the weapon cursor');
  t.equal(r.armedAfter, null, 'and holsters the pistol');
  await page.keyboard.down('Shift');
  await page.mouse.click(r.probePt.x, r.probePt.y);
  await page.keyboard.up('Shift');
  const ring = await page.evaluate(() => ({ ring: !!window.__game.game.cones?.probe, marker: window.__game.game.probeMarker }));
  t(ring.ring && ring.marker, 'Shift+click on the ground drops the red probe ring');

  // --- escaped-early dialog → CONTINUE → game.continueEscape
  const esc = await page.evaluate(() => {
    const G = window.__game.game;
    let cont = 0;
    const orig = G.continueEscape.bind(G);
    G.continueEscape = () => { cont++; orig(); };
    G.pause(true);
    G.events.emit('mission:escaped', { reason: 'x', choices: ['continue', 'quickload'] });
    const card = document.querySelector('.ui-end.escaped');
    const btn = [...document.querySelectorAll('button')].find((b) => /\(C\)ONTINUE/.test(b.textContent));
    const shown = !!btn && !!card;
    btn?.click();
    return { shown, cont, state: G.state };
  });
  t.log(JSON.stringify(esc));
  t(esc.shown, 'escaped-early dialog shown');
  t.equal(esc.cont, 1, 'CONTINUE calls game.continueEscape');
  t.equal(esc.state, 'playing', 'and the game resumes');

  // --- portrait click selects through input.selectUnit
  const sel = await page.evaluate(() => {
    const G = window.__game.game;
    const sn = G.world.commandos.find((c) => c.role === 'sniper');
    let via = 0;
    const orig = G.input.selectUnit.bind(G.input);
    G.input.selectUnit = (c, o) => { via++; return orig(c, o); };
    G.input.deselectAll();
    G.hud.selectFromPortrait(sn, {});
    const selected = sn.selected;
    G.hud.selectFromPortrait(sn, {}); // §5.2: clicking a selected man's portrait deselects him
    G.input.selectUnit = orig;
    return { via, selected, again: sn.selected };
  });
  t(sel.via === 2 && sel.selected, 'portrait click → input.selectUnit');
  t(sel.again === false, 'second portrait click on the selected man deselects him (§5.2)');
}
