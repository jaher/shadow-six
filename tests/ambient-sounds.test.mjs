/**
 * Ambient life sounds play in the real game (after the audio footprint pass, takes decode lazily): the quiet duck
 * calls (eider coo / grunt, mallard quack: synth), a flock's take-off flurry, and a leaping fish's splash (the recorded
 * splash take, ambience bus) each start a source on the ambience bus; "Nature sounds" off silences them.
 */
export default async function (page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, a = G.audio;
    await g.loadMission('m01'); g.start(); g.advance(0.5); G.render(1 / 60, 1);
    a.unlock(); await a.engine.ready;
    const at = { x: G.world.commandos[0].x, z: G.world.commandos[0].z };
    a.update?.(at.x, at.z, 40);
    const fire = async (ev, p) => {
      const n = a.log.length; G.world.events.emit(ev, { ...at, ...p });
      await new Promise((ok) => setTimeout(ok, 400));
      const e = a.log.slice(n).find((l) => /eider|mallard|duck_|fish_/.test(l.name));
      return e ? { name: e.name, played: !!e.played, bus: e.type, gain: e.gain } : null;
    };
    const out = {};
    out.coo = await fire('ambient:call', { species: 'eider', hen: false });
    a._duckCallAt = -1e9; out.grunt = await fire('ambient:call', { species: 'eider', hen: true });
    a._duckCallAt = -1e9; out.quack = await fire('ambient:call', { species: 'mallard', hen: true });
    out.flush = await fire('ambient:flush', { species: 'eider', kind: 'duck' });
    out.fish = await fire('ambient:fishjump', { species: 'salmon', size: 0.4 });
    a.setOption('natureSounds', false); a._duckCallAt = -1e9;
    out.off = await fire('ambient:call', { species: 'eider', hen: false });
    a.setOption('natureSounds', true);
    return out;
  });
  t.log(JSON.stringify(r));
  for (const k of ['coo', 'grunt', 'quack', 'flush', 'fish']) t.ok(r[k]?.played && r[k].bus === 'ambience', `${k}: ${JSON.stringify(r[k])}`);
  t.ok(!r.off, 'Nature sounds off: no call');
}
