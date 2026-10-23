/**
 * Decoy sound waves on the GPU (user 2026-10-22: "When decoy beeps can we have some transparent air blast animation
 * around it", "Like sound wave"; render/decoy-waves.js). M3's snow, a decoy switched on in the open by the camp fence:
 *  - the wave appears with the first beep (within two ticks), grows, fades, and is gone before the next beep (1.5 s);
 *    each beep starts a new one — the same mesh, one draw;
 *  - it draws: with the wave and with the shader's gain at 0 the same frame differs in a good share of its pixels (the
 *    rings lie on the snow, not under it), and it costs exactly one draw call;
 *  - no shader program is compiled while it plays (the load's warm-up frame linked it: Game._warmFrame, `warmShow`);
 */
export const timeout = 300_000;

export default async function decoyWave(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, dt = g.CONFIG.sim.dt;
    await g.loadMission('m03');
    g.start();
    G.stop(); // explicit frames only
    const w = G.world, gb = w.commandos.find((c) => c.role === 'greenberet');
    for (const e of [...w.enemies]) w.remove(e); // calm: nobody reacts to the beeps
    const X = 34, Z = 56.2;
    gb.setPosition(X - 4, Z + 3, 0);
    g.centerOn(X, Z);
    g.setZoom(1.5);
    const info = G.renderer.renderer.info, progs = () => info.programs.length;
    const { Decoy } = await import('/src/abilities/charges.js');
    const decoy = new Decoy({ x: X, z: Z, owner: gb });
    w.add(decoy);
    for (let i = 0; i < 4; i++) { g.advance(dt); G.render(dt, 1); }
    const p0 = progs(), warm = G.selection.decoyWaves.slots[0]?.mesh.userData.warmShow === true;
    const beeps = [];
    w.events.on('noise', (n) => { if (n.kind === 'decoy') beeps.push({ t: w.time, radius: n.radius }); });
    decoy.setOn(true);
    const dw = G.selection.decoyWaves, log = [];
    let calls = null;
    for (let i = 0; i < 270; i++) { // 4.5 s: three beeps
      g.advance(dt);
      G.render(dt, 1);
      const m = dw.slots[0]?.mesh;
      log.push([+w.time.toFixed(3), dw.active, m ? +m.material.uniforms.uAge.value.x.toFixed(3) : -1, m ? +m.material.uniforms.uBand.value.y.toFixed(2) : 0]);
    }
    const p1 = progs();
    // pixels: freeze the wave at ~0.45 s into a pulse, then draw it at gain 1 and gain 0
    while (!(dw.active && dw.slots[0].mesh.material.uniforms.uAge.value.x > 0.42)) { g.advance(dt); G.render(dt, 1); if (w.time > 20) break; }
    const upd = dw.update; dw.update = () => {};
    const m = dw.slots[0].mesh, U = m.material.uniforms, gl = G.renderer.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { G.render(0, 1); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const c = () => G.renderer.stats().calls;
    G.render(0, 1);
    const onPx = grab(); const callsOn = c();
    m.visible = false; G.render(0, 1); const callsOff = c(); m.visible = true;
    U.uGain.value = 0; const offPx = grab(); U.uGain.value = 1;
    const on2Px = grab(); // (the same frame again: the scene's own frame-to-frame noise)
    const dd = (a, b, i) => Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    let diff = 0, big = 0, noise = 0;
    for (let i = 0; i < onPx.length; i += 4) {
      const stable = dd(onPx, on2Px, i) <= 4; // (pixels the scene itself leaves alone between two draws)
      if (!stable) noise++;
      const d = dd(onPx, offPx, i);
      if (stable && d > 4) diff++;
      if (stable && d > 20) big++;
    }
    noise /= W * H;
    dw.update = upd;
    return {
      beeps: beeps.slice(0, 3), log, p0, p1, warm, drawCalls: callsOn - callsOff, diff: diff / (W * H), big: big / (W * H), noise,
      slots: dw.slots.length, radius: g.CONFIG.stealth.noise.decoy.radius, pulse: g.CONFIG.stealth.noise.decoy.pulse,
    };
  });
  const { beeps, log } = r;
  t.log(`beeps at ${beeps.map((b) => b.t.toFixed(2)).join(', ')}; programs ${r.p0} → ${r.p1}; draw calls for the wave ${r.drawCalls}; pixels changed only by the wave ${(r.diff * 100).toFixed(2)} % (${(r.big * 100).toFixed(2)} % strongly; the scene's own noise ${(r.noise * 100).toFixed(2)} %)`);
  t(r.warm, 'the pool\'s first wave mesh is a warm-up object (userData.warmShow)');
  t(beeps.length === 3 && beeps.every((b) => b.radius === r.radius), `three beeps with the hearing radius ${r.radius}`);
  for (let k = 0; k < beeps.length; k++) {
    const b = beeps[k];
    const at = (s) => log.find((q) => q[0] >= b.t + s - 1e-6);
    t(at(2 / 60)[1] === 1, `beep ${k + 1}: the wave is drawn within two ticks of the beep`);
    const mid = at(0.5);
    t(mid[1] === 1 && mid[2] > 0.4 && mid[2] < 0.6, `beep ${k + 1}: it is running at 0.5 s (age ${mid[2]})`);
    t(at(0.9)[3] > mid[3], `beep ${k + 1}: it expands (band ${mid[3]} → ${at(0.9)[3]} m)`);
    if (k < 2) {
      t(at(1.42)[1] === 0, `beep ${k + 1}: it is gone before the next beep (1.42 s)`);
      t(Math.abs(beeps[k + 1].t - b.t - r.pulse) < 0.06, `beep ${k + 1}: the next beep follows after ${r.pulse} s`);
    }
  }
  t(r.slots === 1, `one mesh for the one decoy (${r.slots})`);
  t(r.p1 === r.p0, `no shader program compiled while the waves play (${r.p0} → ${r.p1})`);
  t(r.drawCalls === 1, `one draw call for the wave (${r.drawCalls})`);
  t(r.diff > 0.003 && r.big > 0.001, `the rings are on screen: ${(r.diff * 100).toFixed(2)} % of the pixels change (${(r.big * 100).toFixed(2)} % strongly)`);
}
