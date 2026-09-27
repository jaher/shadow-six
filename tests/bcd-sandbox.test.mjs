/**
 * BCD sandbox end-to-end (GPU headless, docs/bcd-plan.md §3 N13): loads b00 under the BCD ruleset in the real
 * game (renderer, HUD, input) and uses every expansion gadget once; then proves a BEL mission still loads with
 * no BCD ability reachable (X = knife).
 */
export default async function bcdSandbox(page, t) {
  const same = (a, b, msg) => t.equal(JSON.stringify(a), JSON.stringify(b), msg);
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('b00');
    const G = g.game;
    let w = G.world;
    g.start();
    const out = { rules: w.rules.id, errors: [], msgs: [] };
    G.events.on('message', (m) => out.msgs.push(`${w.time.toFixed(1)} ${m.text}`));
    G.events.on('alarm:start', (m) => out.msgs.push(`${w.time.toFixed(1)} alarm ${m.cause} ${m.x?.toFixed?.(0)},${m.z?.toFixed?.(0)}`));
    G.events.on('unit:killed', (m) => out.msgs.push(`${w.time.toFixed(1)} killed ${m.unit.tag ?? m.unit.role} by ${m.killer?.tag ?? m.killer?.role ?? m.cause}`));
    G.events.on('enemy:spotted', (m) => out.msgs.push(`${w.time.toFixed(1)} spotted ${m.enemy.tag} -> ${m.target.role ?? m.target.tag}`));
    G.events.on('game:state', (m) => out.msgs.push(`${w.time.toFixed(1)} state ${m.from}->${m.to}`));
    G.events.on('mission:lost', (m) => out.msgs.push(`${w.time.toFixed(1)} LOST ${JSON.stringify(m.reason ?? m)}`));
    const E = (id) => w.enemies.find((e) => e.tag === id);
    const C = (role) => w.commandos.find((c) => c.role === role);
    const use = (c, id, tgt) => c.issue({ type: 'ability', id, target: tgt });
    // knock-outs ×3, cuffs, hanger, wardrobe
    out.koFist = use(C('greenberet'), 'knockoutFist', E('ko_gb'));
    out.koClub = use(C('driver'), 'knockoutClub', E('ko_drv'));
    out.koChloro = use(C('spy'), 'knockoutChloroform', E('ko_spy'));
    g.advance(2);
    out.ko = ['ko_gb', 'ko_drv', 'ko_spy'].map((id) => E(id).ko);
    use(C('greenberet'), 'handcuff', E('ko_gb'));
    use(C('spy'), 'hanger', E('ko_spy'));
    g.advance(2.5);
    out.cuffed = E('ko_gb').ko;
    out.gbPacks = C('greenberet').inventory.get('cigarettes') ?? 0;
    out.wardrobe = [...(C('spy').wardrobe || [])];
    use(C('spy'), 'uniform', C('spy'));
    g.advance(2);
    out.spyUniform = C('spy').disguised ? C('spy').uniformType : null;
    // puppet: R on the cuffed man, walk him 3 m, release
    out.puppetOn = use(C('greenberet'), 'puppet', E('ko_gb'));
    g.advance(0.2);
    out.puppetOf = E('ko_gb').puppetOf?.role ?? null;
    g.render?.(); // puppet disc + knock-out timer arcs (render/bcd-overlay)
    out.overlay = !!G.selection?.bcd;
    use(C('greenberet'), 'puppet', E('ko_gb'));
    g.advance(0.2);
    out.puppetReleased = E('ko_gb').puppetOf === null && E('ko_gb').ko === 'bound';
    // fresh map per station group (a found knock-out raises the alarm, as it should)
    await g.loadMission('b00'); g.start();
    w = G.world;
    // stones and packs
    const walker = E('stone_walker');
    out.stone = use(C('sniper'), 'stone', { x: walker.x - 2, z: walker.z + 1 });
    g.advance(1.5);
    out.stoneState = walker.brainState;
    out.pack = use(C('sapper'), 'cigarettes', { x: 48, z: 30 });
    g.advance(1.5);
    out.packState = E('pack_guard').brainState;
    // Lee-Enfield at 25 m
    const d = C('driver');
    d.x = 70; d.z = 15; d.stop();
    g.advance(0.1);
    out.rifle = use(d, 'rifle', E('range_25'));
    g.advance(1);
    out.rifleKill = E('range_25').alive === false;
    // Natasha's lipstick on the lieutenant
    out.lipstick = use(C('natasha'), 'lipstick', E('lieut1'));
    g.advance(1);
    out.lipState = E('lieut1').brainState;
    await g.loadMission('b00'); g.start();
    w = G.world;
    const d2 = C('driver');
    // machines: drawbridge switch, sea mine by boat, wagon push, lift, knapsack, Skopje joins
    const dv = C('diver');
    dv.x = 27.5; dv.z = 74; dv.stop();
    out.bridge = use(dv, 'use', w.interactables.find((i) => i.tag === 'bridge_switch'));
    g.advance(1.5);
    out.bridgeRaised = w.interactables.find((i) => i.tag === 'bridge1').raised;
    const gb = C('greenberet');
    gb.x = 42; gb.z = 71.5; gb.stop();
    out.push = use(gb, 'use', w.interactables.find((i) => i.tag === 'wagon1'));
    g.advance(4);
    out.wagonMoved = Math.abs(w.interactables.find((i) => i.tag === 'wagon1').x - 45) > 0.5;
    d2.x = 90.5; d2.z = 82; d2.stop();
    out.knap = use(d2, 'use', w.interactables.find((i) => i.tag === 'knap_drv'));
    g.advance(1.5);
    d2.x = 103; d2.z = 86; d2.stop();
    g.advance(0.5);
    out.skopje = C('skopje').state;
    // last (the blast is heard map-wide): a boat hull sets off a sea mine
    const boat = w.vehicles.find((v) => v.tag === 'boat1') || w.vehicles[0];
    boat.x = 15; boat.z = 69;
    g.advance(0.2);
    out.mine = w.interactables.find((i) => i.tag === 'mine1').exploded;
    // Commando Warnings topbar did not throw; zoo runs
    out.ticks = w.tick;
    out.gstate = G.state; out.end = G.pendingEnd ?? null;
    out.driver = { alive: d2.alive, state: d2.state, x: d2.x, z: d2.z, act: d2.currentActionId, hp: d2.hp };
    g.render?.();
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.rules, 'BCD', 'b00 runs the BCD ruleset');
  same(r.ko, ['stunned', 'stunned', 'stunned'], 'Fist, Blackjack and Chloroform knock out');
  t.equal(r.cuffed, 'bound', 'handcuffs');
  t(r.gbPacks >= 1, 'cuffing moved the pack');
  same(r.wardrobe, ['officer'], 'hanger took the officer uniform');
  t.equal(r.spyUniform, 'officer', 'U puts it on');
  t.equal(r.puppetOf, 'greenberet', 'puppet control');
  t(r.puppetReleased, 'released puppet sits down cuffed');
  t(r.overlay, 'puppet disc / knock-out arcs drawn');
  t.equal(r.stoneState, 'STONE', 'the stone made him look');
  t.equal(r.packState, 'CIGS', 'the pack lured the post');
  t(r.rifleKill, 'Lee-Enfield one-shot kill at 25 m');
  t.equal(r.lipState, 'LIPSTICK', 'lipstick');
  t(r.bridgeRaised, 'drawbridge raised');
  t(r.mine, 'the boat set off the sea mine');
  t(r.wagonMoved, 'the wagon rolled');
  t.equal(r.skopje, 'active', 'Skopje joined');
  await t.shot('bcd-sandbox');

  // BEL regression in the real game: m00 has no BCD ability and X is the knife
  const b = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const G = g.game, w = G.world;
    g.start();
    const bcd = ['knockoutFist', 'knockoutClub', 'knockoutChloroform', 'handcuff', 'hanger', 'stone', 'cigarettes', 'puppet', 'rifle', 'lipstick', 'beretta'];
    return {
      rules: w.rules.id,
      leaked: w.commandos.flatMap((c) => c.abilities.filter((id) => bcd.includes(id))),
      x: G.input.abilitiesForCode('KeyX').map((d) => d.id),
      y: G.input.abilitiesForCode('KeyY').map((d) => d.id),
      v: G.input.abilitiesForCode('KeyV').map((d) => d.id),
    };
  });
  t.log(JSON.stringify(b));
  t.equal(b.rules, 'BEL');
  same(b.leaked, [], 'no BCD ability under BEL');
  same(b.x, ['knife'], 'X is still the knife');
  same(b.y, [], 'Y does nothing');
  same(b.v, [], 'V does nothing');
}
