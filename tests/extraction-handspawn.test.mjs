/**
 * §7.6 / §8.1 regression (M3 evac_truck spawned by hand before its script ran, as in the play-review
 * probe): boarding alone must not win. The truck is adopted by the escape script, drives off north
 * once everyone is aboard and o3 completes only when it reaches `exit` (60,0,r3). A second run
 * checks that ESC during the drive-off skips it (escape completes at once).
 */
export default async function extractionHandspawn(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const run = async (skip) => {
      const out = {};
      await g.loadMission('m03');
      g.start();
      const w = G.world;
      for (const e of [...w.enemies]) w.remove(e); // world.remove: a bare `removed` flag leaves them in play
      const ob = (id) => (G.world.objectives || []).find((o) => o.id === id);
      const v = w.spawnVehicle('truck', { id: 'evac_truck', x: 60, z: 10, heading: Math.PI / 2, friendly: true, seats: 6 }); // the M3 pickup
      ob('o1').done = true; ob('o2').done = true;
      g.advance(0.5);
      out.phase0 = G._endFlags?.evacPhase;
      const men = w.commandos.filter((c) => c.alive !== false && !c.removed);
      out.board = men.map((c, i) => { c.x = v.x + 2.5; c.z = v.z + (i - 1.5) * 0.8; c.snap?.(); return v.enter(c); });
      g.advance(0.2);
      out.phase1 = G._endFlags?.evacPhase;
      out.o3early = ob('o3').done;
      out.stateEarly = G.state;
      out.zEarly = +v.z.toFixed(1);
      if (skip) {
        out.skipped = G.skipExtraction();
        g.advance(0.2);
      } else {
        // (hand-spawned facing south, it has to turn round in the bay first: a multi-point turn since 2026-10-07 — no
        // more pivoting on the spot through the rim — so the drive to the exit takes up to ~30 s, not 10)
        for (let k = 0; k < 160 && G.state === 'playing'; k++) g.advance(0.25);
      }
      out.o3 = ob('o3').done;
      out.state = G.state;
      out.zWin = +v.z.toFixed(1);
      return out;
    };
    return { drive: await run(false), skip: await run(true) };
  });
  t.log(JSON.stringify(r));
  const d = r.drive, s = r.skip;
  t.equal(d.phase0, 'wait', 'the hand-spawned truck is adopted and waits');
  t(d.board.every(Boolean), 'every commando can board');
  t.equal(d.phase1, 'leave', 'all aboard → it drives off');
  t.equal(d.o3early, false, 'o3 not done the moment the last man boards');
  t.equal(d.stateEarly, 'playing', 'no instant win on boarding');
  t.equal(d.o3, true, 'o3 completes once it reaches the exit');
  t.equal(d.state, 'won', 'mission won');
  t(d.zWin <= 3 && d.zWin < d.zEarly, `won only after driving north to the exit (z ${d.zEarly} → ${d.zWin})`);
  t.equal(s.phase1, 'leave', 'skip run: driving off');
  t.equal(s.skipped, true, 'ESC skips the drive-off');
  t.equal(s.state, 'won', 'skip → won immediately');
  t(s.zWin > 5, `skip won without the drive (z ${s.zWin})`);
}
