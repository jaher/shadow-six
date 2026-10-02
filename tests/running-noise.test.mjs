/**
 * House rule runningNoise (design-spec §4.4 "Running is heard"): the M0 bridge sentry (47,30) holds his post looking
 * west, his head fixed. The Green Beret passes 6 m behind his back, over the ground east of the bridge (7.5 m radius):
 *  A) walking → nothing: the sentry never turns, no "?", no noise rings.
 *  B) running → the sentry turns round to the steps, a "?" shows over him, "Was war das?", noise rings spread from
 *     the runner's feet, and he spots the runner ("Halt!"); the rings are gone 1 s after the last step.
 *     SHADOW SIX smooth turn: he turns round on the spot at the eased body rate (≈ 1.15 s for 180°) — every rendered
 *     tick shows an intermediate heading (no snap, ≤ 3° a tick), his feet step round (art/turn-step.js) and the cone
 *     turns with him.
 * Every other enemy and commando is removed so only the sentry can react.
 */
export const timeout = 240_000; // two mission loads and ~160 rendered frames (slow under load)

async function setup(page, run) {
  return page.evaluate(async (run) => {
    const g = window.__game, G = g.game;
    await g.loadMission('m00');
    const w = G.world;
    for (const e of [...w.enemies]) if (e.tag !== 'sentry_bridge') w.remove(e);
    for (const c of [...w.commandos]) if (c.role !== 'greenberet') w.remove(c);
    const s = w.enemies.find((e) => e.tag === 'sentry_bridge');
    s.setPosition(s.x, s.z, Math.PI);
    Object.assign(s.post, { heading: Math.PI, sweep: 0, scan: null });
    const gb = w.commandos[0];
    gb.setPosition(53, 22, Math.PI / 2);
    g.start();
    g.setZoom(1.6);
    g.centerOn(50, 30);
    const log = { heard: 0, barks: 0, turns: 0 };
    w.events.on('enemy:heard-steps', () => log.heard++);
    w.events.on('enemy:noise-turn', (p) => { if (p.kind === 'footsteps') log.turns++; });
    w.events.on('bark', (b) => { if (b.unit === s && b.line === 'ger_suspicious') log.barks++; });
    window.__rn = { s, gb, log, h0: s.heading, house: w.house.runningNoise };
    g.order(gb.id, { type: 'move', x: 53, z: 38, run });
    return { house: w.house.runningNoise, rings: !!G.selection?.noise };
  }, run);
}

async function watch(page, seconds) {
  return page.evaluate(async (seconds) => {
    const g = window.__game, G = g.game, R = window.__rn;
    const turn = () => Math.abs(Math.atan2(Math.sin(R.s.heading - R.h0), Math.cos(R.s.heading - R.h0)));
    let maxTurn = 0, maxMarks = 0, maxRings = 0, markText = '', stopT = null, ringsAfterStop = null;
    const states = new Set();
    for (let i = 0; i < seconds * 10; i++) {
      g.advance(0.1);
      G.render(0.1, 1);
      maxTurn = Math.max(maxTurn, turn());
      const marks = [...document.querySelectorAll('.hud-mark')];
      if (marks.length > maxMarks) { maxMarks = marks.length; markText = marks[0].textContent; }
      maxRings = Math.max(maxRings, G.selection.noise.active);
      states.add(R.s.brainState);
      if (stopT == null && !R.gb.path) stopT = i;
      if (stopT != null && i - stopT === 10) ringsAfterStop = G.selection.noise.active; // 1 s after his last step
    }
    return { maxTurn, maxMarks, markText, maxRings, ringsAfterStop, states: [...states], ...R.log, x: R.gb.x, z: R.gb.z };
  }, seconds);
}

export default async function runningNoise(page, t) {
  // A) walking behind his back: silent
  const a0 = await setup(page, false);
  t.equal(a0.house, true, 'SHADOW SIX: running is heard');
  t(a0.rings, 'noise rings installed');
  const a = await watch(page, 9);
  t.log('walk:', JSON.stringify(a));
  t(a.z > 37, `walked the whole pass (z ${a.z.toFixed(1)})`);
  t(a.maxTurn < 0.05, `sentry never turned (${a.maxTurn.toFixed(3)} rad)`);
  t.equal(a.heard, 0, 'no step heard');
  t.equal(a.maxMarks, 0, 'no "?"');
  t.equal(a.maxRings, 0, 'no noise ring');
  await t.shot('running-noise-walk');

  // B) running behind his back: heard
  await setup(page, true);
  const b = await page.evaluate(async () => {
    const g = window.__game, G = g.game, R = window.__rn;
    const { coneAt } = await import('/src/ai/perception.js');
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    // advance to the first heard step, then grab the frame with the "?" and the rings showing
    for (let i = 0; i < 60 && !R.log.heard; i++) { g.advance(0.05); G.render(0.05, 1); }
    for (let i = 0; i < 3; i++) { g.step(); G.render(1 / 60, 1); }
    const marks = [...document.querySelectorAll('.hud-mark')];
    const out = { heard: R.log.heard, marks: marks.length, markText: marks[0]?.textContent ?? '', rings: G.selection.noise.active,
      turn3: Math.abs(wrap(R.s.heading - R.h0)) };
    // then tick by tick (one sim step, one rendered frame) through the turn: heading, cone, the feet stepping round
    const hs = [R.s.heading], cones = [], drawn = [], feet = [];
    let planted = 0;
    for (let i = 0; i < 120; i++) {
      g.step(); G.render(1 / 60, 1);
      hs.push(R.s.heading);
      const cone = G.cones?.cones?.get?.(R.s); // the drawn cone (the noise-turn flash shows it) follows his heading
      if (cone?.group?.visible && cone._key) { cones.push(Math.abs(wrap(cone._key.h - coneAt(R.s).heading))); drawn.push(cone._key.h); }
      const st = R.s.model?._turnStep;
      if (st?.feet) planted++;
      if (st?.step && feet.at(-1) !== st.step.s) feet.push(st.step.s);
      if (i === 30) window.__rnMid = Math.abs(wrap(R.s.heading - R.h0));
      if (!R.s.brain.turn && i > 10) break;
    }
    const steps = hs.slice(1).map((h, k) => Math.abs(wrap(h - hs[k])));
    out.ticks = steps.length;
    out.maxStep = Math.max(...steps);
    out.distinct = new Set(hs.map((h) => h.toFixed(3))).size;
    out.turn = Math.abs(wrap(R.s.heading - R.h0));
    out.mid = window.__rnMid;
    out.real = !!R.s.model?.isReal;
    out.planted = planted;
    out.coneFrames = cones.length;
    out.coneLag = cones.length ? Math.max(...cones) : null;
    out.coneJump = drawn.length > 1 ? Math.max(...drawn.slice(1).map((h, k) => Math.abs(wrap(h - drawn[k])))) : null;
    out.feet = feet.join('');
    out.state = R.s.brainState;
    return out;
  });
  t.log('first step heard, then the turn:', JSON.stringify(b));
  t(b.heard >= 1, 'a step heard');
  t(b.marks >= 1 && b.markText === '?', `"?" over the sentry (${b.marks} "${b.markText}")`);
  t(b.rings >= 1, 'a noise ring on the ground');
  t(b.turn3 < 0.2, `3 ticks after the step he has only begun to turn (${b.turn3.toFixed(3)} rad): no snap`);
  t(b.maxStep <= (Math.PI / 60) + 1e-6, `never more than 3° a tick (${(b.maxStep * 180 / Math.PI).toFixed(2)}°)`);
  t(b.ticks >= 40 && b.distinct >= 40, `the turn shows on ${b.ticks} ticks, ${b.distinct} distinct headings`);
  t(b.mid > 0.4 && b.mid < b.turn - 0.3, `half a second in he is part way round (${b.mid?.toFixed(2)} of ${b.turn.toFixed(2)} rad)`);
  t(b.turn > 1, `the sentry turned to the steps (${b.turn.toFixed(2)} rad)`);
  t(b.coneFrames >= 30 && b.coneLag < 0.03, `the drawn cone is his cone (${b.coneFrames} frames, ≤ ${b.coneLag?.toFixed(3)} rad off)`);
  t(b.coneJump < 0.17, `the drawn cone turns with him, never jumps (≤ ${(b.coneJump * 180 / Math.PI).toFixed(1)}° a frame)`);
  if (b.real) t(b.planted > 20 && b.feet.length >= 2 && !/ll|rr/.test(b.feet), `his feet step round, in turn (${b.feet}, planted ${b.planted} frames)`);
  await t.shot('running-noise-run');
  const r = await watch(page, 6);
  t.log('run:', JSON.stringify(r));
  t(r.turns >= 1, 'cone flash (enemy:noise-turn)');
  t(r.barks >= 1, '"Was war das?"');
  t(r.states.includes('CHALLENGE') || r.states.includes('COMBAT'), `he spotted the runner (${r.states})`);
  t.equal(r.ringsAfterStop, 0, 'rings gone 1 s after the last step');
}
