/**
 * Boat wakes on the GPU (src/art/water.js WakeTracker + src/art/water/ripples.js crest channel): the Marine rows a
 * raft across the M2 river — the ripple sim holds crisp crest foam (.a) on the Kelvin arms and wash foam (.b)
 * astern, the crest foam fades within a second once the raft stops, and nothing raises a GL error.
 * The river is cleared first: the soldiers AND the patrol boat (its MG crew is a crew record, not one of the enemies:
 * since men in an open boat are seen in any cone it shot the Marine, the mission was lost and the frozen game left
 * the last crest particle of the wake standing).
 */
export default async function waterWake(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    await g.loadMission('m02');
    g.start();
    const W = G.world, wt = W.water, gl = G.renderer.renderer.getContext();
    if (!wt) return { built: false };
    for (const e of W.enemies || []) { e.alive = false; e.hp = 0; e.setPosition?.(-500, -500); }
    for (const q of [...W.vehicles]) if (q.crew?.length) W.remove(q); // the patrol boat and its MG crew
    W.flushRemovals?.();
    const v = W.spawnVehicle('raft', { x: 3.9, z: 36.5, heading: 0.66 });
    const c = W.commandos.find((k) => k.role === 'diver'); c.setPosition(v.x, v.z); v.enter(c);
    v.followPath([{ x: 22.5, z: 50.6 }], { fast: true });
    const R = wt.system.ripples, ren = G.renderer.renderer, buf = new Uint16Array(4);
    const half = (u) => { const e = (u >> 10) & 31, m = u & 1023, s = u >> 15 ? -1 : 1; return e ? s * 2 ** (e - 15) * (1 + m / 1024) : s * m / 16777216; };
    const texel = (x, z) => {
      ren.readRenderTargetPixels(R.a, Math.floor((x - R.origin.x) / R.size * R.res), Math.floor((z - R.origin.y) / R.size * R.res), 1, 1, buf);
      return [...buf].map(half);
    };
    gl.getError();
    for (let f = 0; f < 120; f++) { g.advance(1 / 30); g.centerOn(v.x, v.z); G.render(1 / 30, 1); }
    const st = wt.wakes.state.get(v), out = { built: true, speed: st?.v };
    const arms = (st?.arms || []).map((a) => a.filter((p) => p.age > 0.4 && p.age < 1.5));
    out.armCrest = arms.map((a) => a.map((p) => texel(p.x, p.z)[3]));
    const h = Math.atan2(v.z - 36.5, v.x - 3.9);
    out.wash = [2.5, 4, 6].map((d) => texel(v.x - Math.cos(h) * d, v.z - Math.sin(h) * d)[2]);
    out.open = texel(v.x + Math.sin(h) * 4.5, v.z - Math.cos(h) * 4.5)[3]; // abeam ahead of the arms: still water
    v.stop();
    const sample = arms.flat().slice(0, 6);
    for (let f = 0; f < 120; f++) { g.advance(1 / 30); G.render(1 / 30, 1); }
    out.afterStop = sample.map((p) => texel(p.x, p.z)[3]);
    out.armsLeft = (st?.arms || []).reduce((n, a) => n + a.length, 0);
    out.gl = gl.getError();
    out.playing = G.state === 'playing' && c.alive; // nothing else (a hostile left on the river) cut the run short
    return out;
  });
  console.log('    [water-wake]', JSON.stringify(r, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
  t.ok(r.built, 'water built for M2');
  t.ok(r.playing, 'the run went on undisturbed: the Marine alive, the mission still playing');
  if (!r.built) return;
  t.ok(r.speed > 3, `raft rowing at speed (${r.speed})`);
  for (const [i, a] of r.armCrest.entries()) {
    const lit = a.filter((q) => q > 0.05).length;
    t.ok(a.length >= 3 && lit >= a.length * 0.6, `Kelvin arm ${i}: crest foam on ${lit}/${a.length} crest points`);
  }
  t.ok(r.wash.every((q) => q > 0.15), `wash foam astern (${r.wash.map((q) => q.toFixed(2))})`);
  t.ok(r.open < 0.05, 'no crest foam outside the V');
  t.ok(r.afterStop.every((q) => q < 0.05) && r.armsLeft === 0, 'stopped: the crest lines fade and the arms run out');
  t.equal(r.gl, 0, 'no GL error');
  await t.shot('water-wake-m02');
}
