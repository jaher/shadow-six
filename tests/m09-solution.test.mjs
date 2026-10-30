/**
 * M09 "A Courtesy Call" full solution (tools/solutions/m09.solution.mjs) played in the running game with only player
 * orders: every man on foot dies unseen before the first blast. The Green Beret knifes Patrol SE and Patrol NW man by
 * man from the back of their files; the Sniper drops e2 and e1 in the forecourt and the Green Beret hides them behind
 * the yellow drums and knifes e3; the Spy, in uniform, injects the north yard's four guards and the E gate's two and
 * carries every body out of sight, and holds the courtyard patrol in talk while the Sniper shoots its three men. Then
 * the Sapper's two remote bombs raze the barracks (before a man of the garrison is out) and the radio hut with its
 * dish, the woken Panzers shoot the tanker the Driver parked across their bays and its fireball wrecks all three, and
 * the Green Beret's pistol fires the drum by the bunker and the drum pile between the weapons store and the command
 * post. Everyone boards our lorry. The game reports a win, no commando is ever spotted / challenged, no vehicle
 * tainted by a guard, nobody is ever inside a live cone (the driver's exposure watch; user 2026-10-08: "make sure no
 * commando goes inside the field of view of a solider before being spotted"), nobody finds a body, and the only alarm
 * is the one the design forces: every explosion trips the map-wide zone, so the first one is the barracks bomb's.
 * Logic only (Game.step, no frames): a long mission, many minutes.
 */
export const timeout = 3_600_000;

export default async function m09Solution(page, t) {
  const r = await page.evaluate(async () => {
    const G = window.__game, dt = G.CONFIG.sim.dt;
    await G.loadMission('m09');
    G.start();
    const { makeDriver } = await import('/tools/solutions/driver.mjs');
    const { solve } = await import('/tools/solutions/m09.solution.mjs');
    const { boardPoint } = await import('/src/abilities/drive.js');
    const { WALKTHROUGH } = await import('/tools/solutions/m09.walkthrough.mjs');
    const D = makeDriver(G.game.world, { step: () => { G.game.step(dt); }, dt, quiet: true, log: () => {} });
    const w = G.game.world;
    const found = [], spawned = [], blasts = [];
    let barrAt = null;
    const offs = [
      w.events.on('enemy:body-found', (e) => found.push({ t: w.time, line: `${e.enemy?.tag} found ${e.body?.unit?.tag ?? e.body?.tag ?? 'a body'}` })),
      w.events.on('structure:destroyed', (e) => { if (e.id === 'barr' && barrAt == null) barrAt = w.time; }),
      w.events.on('explosion', () => blasts.push(w.time)),
    ];
    const tags0 = new Set(w.enemies.map((e) => e.tag));
    let error = null;
    try { await solve(D, { boardPoint }); } catch (e) { error = String(e && e.message || e); }
    for (let i = 0; i < 1200 && G.game.state === 'playing'; i++) G.game.step(dt);
    for (const off of offs) off?.();
    for (const e of w.enemies) if (!tags0.has(e.tag)) spawned.push(e.tag);
    const cps = D.checkpoints, at = (id) => cps.find((c) => c.name.startsWith(id))?.t ?? null;
    const evac = w.byId('evac');
    const out = {
      error, state: G.game.state, time: w.time, detections: D.detections(), exposures: D.exposureReport(),
      objectives: Object.fromEntries(w.objectives.map((o) => [o.id, o.done])),
      alive: w.commandos.every((c) => c.alive), aboard: w.commandos.filter((c) => evac && c.vehicle === evac).length, crew: w.commandos.length,
      alarms: D.events.filter((e) => e.name === 'alarm:zone').map((e) => ({ t: e.t, line: e.line })),
      found: found.map((f) => `${f.t.toFixed(1)} ${f.line}`), spawned, barrAt, firstBlast: blasts[0] ?? null, bangsAt: at('H1'),
      footAlive: [...tags0].filter((tag) => w.enemies.find((e) => e.tag === tag)?.alive),
      panzers: ['pz1', 'pz2', 'pz3'].map((id) => !!w.byId(id)?.destroyed), tanker: !!w.byId('tanker')?.destroyed,
      kills: D.events.filter((e) => e.name === 'unit:killed').map((e) => e.line.split(' ')[0]),
      rounds: w.commandos.find((c) => c.role === 'sniper')?.inventory.get('sniperRifle') ?? 0,
      checkpoints: cps.map((c) => c.name.split(' ')[0]),
      unreached: WALKTHROUGH.steps.map((s) => s.cp).filter((id) => !cps.some((c) => c.name.split(' ')[0] === id)),
    };
    D.dispose();
    return out;
  });
  const first = r.alarms[0];
  t.log(`m09 solution: ${r.state} at t=${r.time.toFixed(1)} s, detections ${r.detections}, exposures ${r.exposures.length}, ${r.kills.length} killed, ${r.rounds} sniper round(s) left, first alarm ${first ? `${first.t.toFixed(1)} ${first.line}` : 'none'} (barracks razed at ${r.barrAt?.toFixed(2)}, first blast ${r.firstBlast?.toFixed(2)})`);
  for (const l of r.exposures) t.log(`EXPOSED ${l}`);
  for (const l of r.found) t.log(`FOUND ${l}`);
  t.equal(r.error, null, 'solution ran to the end');
  t.equal(JSON.stringify(r.objectives), JSON.stringify({ o1: true, o2: true, o3: true, o4: true, o5: true, o_ready: true, o6: true }), 'radio hut, aerial, weapons store, command post and bunker destroyed; away in our lorry');
  t.equal(r.state, 'won', 'the game reports the win');
  t.equal(r.detections, 0, 'never spotted, challenged or tainted');
  t.equal(r.exposures.length, 0, 'never inside a live cone (exposure watch)');
  t(r.alive, 'all five alive');
  t.equal(r.aboard, r.crew, 'everyone aboard our lorry');
  t.equal(r.found.length, 0, `nobody ever finds a body (${r.found.join(' | ')})`);
  t.equal(r.footAlive.join(','), '', 'every man on foot dead');
  t(r.panzers.every(Boolean) && r.tanker, `the tanker and all three Panzers wrecked (${r.panzers})`);
  t(first && r.firstBlast != null && first.t >= r.firstBlast - 1e-6 && /RINT \(explosion\)/.test(first.line), `the first alarm is the first blast's (${first?.line} at ${first?.t})`);
  t(r.barrAt != null && r.firstBlast != null && Math.abs(r.barrAt - r.firstBlast) < 0.05, `the first blast razes the barracks (${r.barrAt} vs ${r.firstBlast})`);
  t.equal(r.spawned.join(','), '', 'the garrison never turns out (razed by the blast that raises the alarm)');
  t(r.bangsAt != null && r.bangsAt >= r.firstBlast, `checkpoint H1 after the bangs (${r.bangsAt} vs ${r.firstBlast})`);
  t.equal(r.rounds, 0, 'all five sniper rounds spent (e2, e1, the courtyard patrol)');
  for (const k of ['A2', 'B3', 'B4', 'B6', 'B7', 'C2', 'D2', 'D3', 'D4', 'D5', 'E2', 'E3', 'F2', 'F3', 'F4', 'G1', 'G2', 'G3', 'G4', 'H1', 'H2', 'H3', 'H4', 'H6']) t(r.checkpoints.includes(k), `checkpoint ${k}`);
  // (video mode's caption is the step after the last checkpoint met within the chapter: every step's checkpoint must be met)
  t.equal(r.unreached.join(','), '', 'every walkthrough step\'s checkpoint is met');
}
