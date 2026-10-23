/**
 * Decoy sound waves on the GPU (user 2026-10-22: "When decoy beeps can we have some transparent air blast animation
 * around it", "Like sound wave"; then "For decoy I would rather have the air bend / refract with a spherical sound wave
 * around the decoy"; render/decoy-waves.js + render/decoy-refraction.js). M3's snow, a decoy switched on in the open by
 * the camp fence (a fence, boot prints and a shadow edge behind the wave: things whose bending shows):
 *  - the wave appears with the first beep (within two ticks), grows, fades, and is gone before the next beep (1.5 s);
 *    each beep starts a new one in the same slot;
 *  - the air bends and nothing is painted: the same frozen frame drawn with and without the refraction — a good share of
 *    the pixels move (block matching finds the picture shifted by several pixels where the shell is), while the frame's
 *    mean brightness changes by well under 1 %;
 *  - it costs one copy pair + one draw per decoy (3 draw calls) and nothing while no decoy beeps; the frame-time cost
 *    while a wave plays is measured (logged, loosely bounded);
 *  - no shader program is compiled while it plays (the load's warm-up frame linked all three: Game._warmFrame).
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
    g.setZoom(2);
    const info = G.renderer.renderer.info, progs = () => info.programs.length;
    const { Decoy } = await import('/src/abilities/charges.js');
    const decoy = new Decoy({ x: X, z: Z, owner: gb });
    w.add(decoy);
    for (let i = 0; i < 4; i++) { g.advance(dt); G.render(dt, 1); }
    const p0 = progs();
    const dw = G.selection.decoyWaves, pass = dw.pass;
    const beeps = [];
    w.events.on('noise', (n) => { if (n.kind === 'decoy') beeps.push({ t: w.time, radius: n.radius }); });
    decoy.setOn(true);
    const log = [];
    for (let i = 0; i < 270; i++) { // 4.5 s: three beeps
      g.advance(dt);
      G.render(dt, 1);
      const s = dw.slots[0];
      log.push([+w.time.toFixed(3), dw.active, s ? +s.age.toFixed(3) : -1, s ? +s.hi.toFixed(2) : 0, pass.draws]);
    }
    const p1 = progs();
    // freeze a wave at ~0.5 s into a pulse: the same frame with the refraction and without it
    while (!(dw.active && dw.slots[0].age > 0.5)) { g.advance(dt); G.render(dt, 1); if (w.time > 20) break; }
    const upd = dw.update; dw.update = () => {};
    const gl = G.renderer.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { G.render(0, 1); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const calls = () => G.renderer.stats().calls;
    pass.gain = 1; const on = grab(); const callsOn = calls(), drawsOn = pass.draws;
    const on2 = grab();
    pass.gain = 0; const off = grab(); const callsOff = calls();
    pass.gain = 1;
    const luma = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    let sumOn = 0, sumOff = 0, diff = 0, noise = 0, big = 0;
    const Y = new Float32Array(W * H), Y0 = new Float32Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const a = luma(on, i), b = luma(off, i), c = luma(on2, i);
      Y[p] = a; Y0[p] = b; sumOn += a; sumOff += b;
      const d = Math.max(Math.abs(on[i] - off[i]), Math.abs(on[i + 1] - off[i + 1]), Math.abs(on[i + 2] - off[i + 2]));
      if (Math.abs(a - c) > 3) noise++;
      if (d > 8) diff++;
      if (d > 24) big++;
    }
    // block matching: for the blocks the refraction changes most, where does the plain picture's content now sit?
    const B = 16, cands = [];
    for (let by = 40; by + B + 40 < H; by += B) for (let bx = 40; bx + B + 40 < W; bx += B) {
      let e = 0, tex = 0;
      for (let y = 0; y < B; y += 2) for (let x = 0; x < B; x += 2) { const p = (by + y) * W + bx + x; e += Math.abs(Y[p] - Y0[p]); tex += Math.abs(Y0[p] - Y0[p + 1]) + Math.abs(Y0[p] - Y0[p + W]); }
      cands.push([e, tex, bx, by]);
    }
    cands.sort((a, b) => b[0] - a[0]);
    const shifts = [];
    for (const [, tex, bx, by] of cands.slice(0, 60)) {
      if (tex < 60) continue; // (a flat block says nothing about a shift)
      let best = Infinity, bdx = 0, bdy = 0, zero = 0;
      for (let dy = -34; dy <= 34; dy++) for (let dx = -34; dx <= 34; dx++) {
        let s = 0;
        for (let y = 0; y < B; y += 2) for (let x = 0; x < B; x += 2) { const d = Y[(by + y) * W + bx + x] - Y0[(by + y + dy) * W + bx + x + dx]; s += d * d; }
        if (dx === 0 && dy === 0) zero = s;
        if (s < best) { best = s; bdx = dx; bdy = dy; }
      }
      if (zero > 0 && best < zero * 0.6) shifts.push(Math.hypot(bdx, bdy));
    }
    shifts.sort((a, b) => a - b);
    // frame cost: the frozen wave drawn, against the same frame without it (draw + a synced 1-pixel read-back)
    const px1 = new Uint8Array(4), ms = (gain) => {
      pass.gain = gain;
      const a = [], c = [];
      for (let i = 0; i < 30; i++) { G.render(0, 1); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); }
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now(); G.render(0, 1); const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        a.push(performance.now() - t0); c.push(t1 - t0);
      }
      a.sort((x, y) => x - y); c.sort((x, y) => x - y);
      return { frame: a[30], cpu: c[30] };
    };
    const msOn = ms(1), msOff = ms(0), msOn2 = ms(1);
    pass.gain = 1;
    // every preset has the pass (the chain is rebuilt with it on a preset change): the same bending at low and back at high
    const presets = {};
    const lumaOf = (a) => { let m = 0; for (let i = 0; i < a.length; i += 4) m += a[i] + a[i + 1] + a[i + 2]; return m; };
    for (const name of ['low', 'medium', 'ultra', 'high']) {
      g.setPreset(name);
      const p = dw.pass;
      for (let i = 0; i < 3; i++) G.render(0, 1);
      p.gain = 1; const a = grab(), drawsA = p.draws;
      p.gain = 0; const b = grab(); p.gain = 1;
      let d = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 8) d++;
      presets[name] = { draws: drawsA, diff: d / (W * H), rel: (lumaOf(a) - lumaOf(b)) / lumaOf(b), same: p === pass };
    }
    dw.update = upd;
    return {
      beeps: beeps.slice(0, 3), log, p0, p1, drawCalls: callsOn - callsOff, drawsOn, diff: diff / (W * H), big: big / (W * H), noise: noise / (W * H),
      presets, lumaRel: (sumOn - sumOff) / sumOff, shifts, nBlocks: cands.length, msOn, msOff, msOn2, slots: dw.slots.length,
      radius: g.CONFIG.stealth.noise.decoy.radius, pulse: g.CONFIG.stealth.noise.decoy.pulse,
    };
  });
  const { beeps, log } = r;
  const med = r.shifts.length ? r.shifts[r.shifts.length >> 1] : 0;
  t.log(`beeps at ${beeps.map((b) => b.t.toFixed(2)).join(', ')}; programs ${r.p0} → ${r.p1}; draw calls for the wave ${r.drawCalls} (${r.drawsOn} by the pass); ` +
    `pixels changed by the bending ${(r.diff * 100).toFixed(2)} % (${(r.big * 100).toFixed(2)} % by more than 24 levels; the scene's own noise ${(r.noise * 100).toFixed(2)} %); ` +
    `mean brightness ${(r.lumaRel * 100).toFixed(3)} %; block matching: ${r.shifts.length} blocks shifted, median ${med.toFixed(1)} px, max ${(r.shifts.at(-1) || 0).toFixed(1)} px; ` +
    `frame ms with the wave ${r.msOn.frame.toFixed(2)} / ${r.msOn2.frame.toFixed(2)} (CPU ${r.msOn.cpu.toFixed(2)}), without ${r.msOff.frame.toFixed(2)} (CPU ${r.msOff.cpu.toFixed(2)})`);
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
  t(log.filter((q) => q[1] === 0).every((q) => q[4] === 0), 'no draw by the pass while no wave is on screen');
  t(r.slots === 1, `one slot for the one decoy (${r.slots})`);
  t(r.p1 === r.p0, `no shader program compiled while the waves play (${r.p0} → ${r.p1})`);
  t(r.drawCalls === 3 && r.drawsOn === 3, `a wave costs two copies and one draw (${r.drawCalls} calls, ${r.drawsOn} by the pass)`);
  t(r.diff > 0.02 && r.big > 0.003, `the air bends: ${(r.diff * 100).toFixed(2)} % of the pixels change (${(r.big * 100).toFixed(2)} % strongly)`);
  t(r.shifts.length >= 3 && med >= 3, `the picture behind the shell is displaced: ${r.shifts.length} blocks, median shift ${med.toFixed(1)} px`);
  t(Math.abs(r.lumaRel) < 0.01, `nothing is painted: the frame's mean brightness changes by ${(r.lumaRel * 100).toFixed(3)} % (< 1 %)`);
  for (const [name, q] of Object.entries(r.presets)) t(q.draws === 3 && q.diff > 0.02 && Math.abs(q.rel) < 0.01 && (name === 'high' || !q.same), `preset ${name}: the pass is in the chain and bends the air (${q.draws} draws, ${(q.diff * 100).toFixed(1)} % pixels, brightness ${(q.rel * 100).toFixed(2)} %)`);
  t(r.msOn.frame - r.msOff.frame < 4 && r.msOn2.frame - r.msOff.frame < 4, `the frame costs ${(r.msOn.frame - r.msOff.frame).toFixed(2)} ms more while a wave plays (< 4 ms on this shared GPU)`);
}
