/** Contract: when state !== 'playing' the sim does not advance, also through the test API. */
export default async function testapi(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    await g.loadMission('m00');
    const G = g.game;
    const briefing = { state: G.state, step: g.step(), ran: g.advance(1), tick: G.world.tick };
    g.start();
    const playing = { step: g.step(), ran: g.advance(1), tick: G.world.tick };
    g.pause(true);
    const paused = { state: G.state, step: g.step(), ran: g.advance(1), tick: G.world.tick };
    g.pause(false);
    return { briefing, playing, paused };
  });
  t.log(JSON.stringify(r));
  t.equal(r.briefing.step, false, 'step() during briefing does nothing');
  t.equal(r.briefing.ran, 0, 'advance() during briefing runs 0 ticks');
  t.equal(r.briefing.tick, 0, 'no ticks during briefing');
  t.equal(r.playing.step, true, 'step() while playing');
  t(r.playing.ran > 0, 'advance() while playing returns ticks run');
  t.equal(r.playing.tick, r.playing.ran + 1, 'tick count matches');
  t.equal(r.paused.ran, 0, 'advance() while paused runs 0 ticks');
  t.equal(r.paused.tick, r.playing.tick, 'paused sim does not advance');
}
