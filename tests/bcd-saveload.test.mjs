/**
 * BCD quick save / load round trips (GPU headless, b00 under the BCD ruleset): mid-puppet, the Spy in an
 * officer's uniform, a knocked-out man being carried, a cigarette-pack lure and Natasha's lipstick.
 */
export default async function bcdSaveload(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, out = {};
    const W = () => G.world;
    const E = (id) => W().enemies.find((e) => e.tag === id);
    const C = (role) => W().commandos.find((c) => c.role === role);
    const use = (c, id, tg) => c.issue({ type: 'ability', id, target: tg });
    const rt = async () => { g.quickSave(); await g.quickLoad(); if (G.state !== 'playing') g.start(); };
    // A: puppet + officer uniform
    await g.loadMission('b00'); g.start();
    use(C('greenberet'), 'knockoutFist', E('ko_gb'));
    use(C('spy'), 'knockoutChloroform', E('ko_spy'));
    g.advance(2);
    use(C('greenberet'), 'handcuff', E('ko_gb'));
    use(C('spy'), 'hanger', E('ko_spy'));
    g.advance(2.5);
    use(C('spy'), 'uniform', C('spy')); g.advance(2);
    use(C('greenberet'), 'puppet', E('ko_gb')); g.advance(0.2);
    out.before = { puppet: C('greenberet').puppet?.tag ?? null, uni: C('spy').uniformType, wardrobe: [...(C('spy').wardrobe || [])] };
    await rt();
    out.after = { puppet: C('greenberet').puppet?.tag ?? null, uni: C('spy').uniformType, wardrobe: [...(C('spy').wardrobe || [])], disg: C('spy').disguised };
    const p0 = { x: E('ko_gb').x, z: E('ko_gb').z }, gb0 = { x: C('greenberet').x, z: C('greenberet').z };
    C('greenberet').issue({ type: 'move', x: gb0.x + 3, z: gb0.z });
    g.advance(3);
    out.puppetMoved = Math.hypot(E('ko_gb').x - p0.x, E('ko_gb').z - p0.z);
    out.gbMoved = Math.hypot(C('greenberet').x - gb0.x, C('greenberet').z - gb0.z);
    out.released = C('greenberet').rightClick(); g.advance(0.2);
    out.releasedState = E('ko_gb').brainState ?? E('ko_gb').brain?.state;
    // B: carried knocked-out man, save/load, drop
    await g.loadMission('b00'); g.start();
    const gb = C('greenberet');
    use(gb, 'knockoutFist', E('ko_gb')); g.advance(2);
    use(gb, 'hand', E('ko_gb')); g.advance(6);
    if (!gb.carrying) { use(gb, 'hand', E('ko_gb')); g.advance(6); }
    out.carried = E('ko_gb').state;
    await rt();
    use(C('greenberet'), 'drop', C('greenberet')); g.advance(2);
    out.dropped = { state: E('ko_gb').state, ko: E('ko_gb').ko };
    // C: cigarette pack lure + lipstick
    await g.loadMission('b00'); g.start();
    use(C('sapper'), 'cigarettes', { x: 48, z: 30 }); g.advance(1.5);
    out.cigsBefore = E('pack_guard').brain.state;
    await rt();
    out.cigsAfter = { st: E('pack_guard').brain.state, pack: !!E('pack_guard').brain.goal?.pack };
    await g.loadMission('b00'); g.start();
    use(C('natasha'), 'lipstick', E('lieut1')); g.advance(1);
    out.lipBefore = E('lieut1').brain.state;
    await rt(); g.advance(0.2);
    out.lipAfter = { st: E('lieut1').brain.state, tgt: C('natasha')._lipstickTarget?.tag ?? null };
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.before.puppet, 'ko_gb', 'puppet before');
  t.equal(r.after.puppet, 'ko_gb', 'puppet link survives the load');
  t.equal(r.after.uni, 'officer', 'officer uniform survives the load');
  t.equal(JSON.stringify(r.after.wardrobe), JSON.stringify(r.before.wardrobe), 'wardrobe survives');
  t(r.puppetMoved > 1.5 && r.gbMoved < 0.5, `move order drives the puppet after load (${r.puppetMoved}, ${r.gbMoved})`);
  t(r.released && r.releasedState === 'BOUND', 'right-click releases the puppet after load');
  t.equal(r.carried, 'carried', 'carrying the knocked-out man');
  t.equal(r.dropped.state, 'stunned', 'dropped after a load he stays down');
  t.equal(r.cigsBefore, 'CIGS');
  t(r.cigsAfter.st === 'CIGS' && r.cigsAfter.pack, 'pack lure survives the load');
  t.equal(r.lipBefore, 'LIPSTICK');
  t(r.lipAfter.st === 'LIPSTICK' && r.lipAfter.tgt === 'lieut1', 'lipstick survives the load');
}
