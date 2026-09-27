/**
 * Win timing + destroyed messages (design-spec §7.4, §8.1): M1 (extraction:null) wins 5 s after o1
 * completes, not the same tick; a commando death during that grace turns it into a loss; the
 * "destroyed" message uses a display name, never a raw id (relay_hut / relay_mast).
 */
export default async function winTiming(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const G = g.game;
    const ev = [];
    const offs = ['mission:won', 'mission:lost', 'message'].map((k) =>
      G.events.on(k, (p) => ev.push({ k, text: p?.text ?? p?.reason ?? null, t: +(G.world?.clock ?? 0).toFixed(2) })));
    const out = {};
    const blow = (w) => {
      for (const id of ['relay_hut', 'relay_mast']) {
        const it = w.interactables.find((i) => i.tag === id);
        it?.takeDamage(1e6, null, 'explosion');
      }
    };
    // --- relay destroyed → o1 done → win only after 5 s
    await g.loadMission('m01');
    g.start();
    let w = G.world;
    blow(w);
    const t0 = w.clock;
    g.advance(0.1);
    out.o1 = (w.objectives || []).find((o) => o.id === 'o1')?.done;
    out.at01 = G.state;
    g.advance(4.7);
    out.at48 = G.state;
    g.advance(0.4);
    const won = ev.find((e) => e.k === 'mission:won');
    out.won = { state: G.state, after: won ? +(won.t - t0).toFixed(2) : null };
    out.msgs = ev.filter((e) => e.k === 'message').map((e) => e.text);
    ev.length = 0;
    // --- a commando dies during the win grace → loss, no win
    await g.loadMission('m01');
    g.start();
    w = G.world;
    blow(w);
    g.advance(1);
    w.commandos[0].die('test');
    g.advance(8);
    out.died = { state: G.state, ev: ev.filter((e) => e.k !== 'message').map((e) => e.k + ':' + e.text) };
    ev.length = 0;
    // --- evidence path (finding s9): applyExplosion at the relay station → still 'playing' 0.3 s later,
    // 'won' only once the 5 s grace has elapsed
    const { applyExplosion } = await import('/src/abilities/explosions.js');
    await g.loadMission('m01');
    g.start();
    w = G.world;
    const hut = w.interactables.find((i) => i.tag === 'relay_hut');
    const mast = w.interactables.find((i) => i.tag === 'relay_mast');
    for (const it of [hut, mast]) if (it && !it.destroyed) applyExplosion(w, it.x, it.z, 'bomb', null);
    const t1 = w.clock;
    g.advance(0.3);
    out.expl = { o1: (w.objectives || []).find((o) => o.id === 'o1')?.done, at03: G.state };
    g.advance(4.4);
    out.expl.at47 = G.state;
    g.advance(0.6);
    const won2 = ev.find((e) => e.k === 'mission:won');
    out.expl.state = G.state;
    out.expl.after = won2 ? +(won2.t - t1).toFixed(2) : null;
    offs.forEach((o) => o());
    return out;
  });
  t.log(JSON.stringify(r));
  t.equal(r.o1, true, 'o1 completes when the relay hut and mast are destroyed');
  t.equal(r.at01, 'playing', 'no instant win on the objective tick (§7.4)');
  t.equal(r.at48, 'playing', 'still playing 4.8 s after o1');
  t.equal(r.won.state, 'won', 'M1 wins after the 5 s grace');
  t.near(r.won.after, 5.0, 0.06, 'win fires 5 s after o1 completes');
  t(!r.msgs.some((m) => /relay_hut|relay_mast|_/.test(m)), 'no raw ids in destroyed messages');
  t(r.msgs.includes('Relay station destroyed.'), 'relay hut uses its display name');
  t(r.msgs.includes('Radio mast destroyed.'), 'relay mast uses its display name');
  t.equal(r.died.state, 'lost', 'a death during the win grace is a loss (§8.1 "provided no commando is dead")');
  t(!r.died.ev.some((e) => e.startsWith('mission:won')), 'no win after a death in the grace');
  t.equal(r.expl.o1, true, 'explosion at the relay completes o1');
  t.equal(r.expl.at03, 'playing', 'not won 0.3 s after the relay explosion (finding s9)');
  t.equal(r.expl.at47, 'playing', 'still playing 4.7 s after the relay explosion');
  t.equal(r.expl.state, 'won', 'explosion path wins after the grace');
  t.near(r.expl.after, 5.0, 0.06, 'explosion-path win fires 5 s after o1');
}
