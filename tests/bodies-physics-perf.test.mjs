/**
 * bodies-design §D.2 perf probe: the HIGH preset at 1920×1080 with 60 live enemies (AI on) on screen and three grenades
 * going off together among them. Frame = the sim ticks of one displayed 60 Hz frame + one render + gl.finish (the old
 * probe timed g.advance(), which renders too, so it counted the render twice).
 *   - the fixed ragdoll / prop caps hold on every preset (§0.2: the same caps on low, high and ultra);
 *   - physics step p95 ≤ PHYS_P95_MS and the worst single physics tick ≤ PHYS_MAX_MS (asserted, not just printed);
 *   - the blasts (physics, ragdoll poses, blood, VFX) add ≤ ADD_MS to the median frame of the same view before them;
 *   - the absolute 16.6 ms target is printed. On the headless test machine the 60-enemy high-1080p view itself runs
 *     at ~16-22 ms p95 before any blast (render-bound: characters, terrain, post), so the absolute target is reported
 *     rather than asserted; the bodies systems' own share is what this suite guards.
 */
const FRAME_TARGET_MS = 16.6;
const PHYS_P95_MS = 1.5; // 8 capped blast ragdolls with CCD on (1.0 ms design budget before CCD; see bodies-design §D.2)
const PHYS_MAX_MS = 12;
const ADD_MS = 5;

export default async function bodiesPhysicsPerf(page, t) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const P = await import('/src/entities/projectile.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    const { CONFIG } = await import('/src/config.js');
    const out = {};
    for (const q of ['high', 'low', 'ultra']) {
      await g.loadMission('m01'); g.start(); await G.mapHandle?.ready;
      g.setPreset(q);
      const W = G.world;
      W.physics.setTier(q);
      const c = W.commandos[0], sp = H.openSpot(W, c.x, c.z, 12) || { x: c.x, z: c.z + 12 };
      H.clearArea(W, sp.x, sp.z, 30);
      for (let k = 0; W.enemies.filter((e) => e.soldierType !== 'dog').length < 60; k++) {
        W.add(new Enemy({ id: 'pf' + k, soldierType: ['soldier', 'sentry', 'officer'][k % 3], x: sp.x, z: sp.z, heading: k }));
      }
      const men = W.enemies.filter((e) => e.alive && e.soldierType !== 'dog');
      await Promise.all(men.map((u) => u.model?.ready));
      // three groups of 8 around three bombs, the rest standing / patrolling around them (AI running)
      const centres = [[-8, 0], [0, 5], [8, -1]].map(([dx, dz]) => ({ x: sp.x + dx, z: sp.z + dz }));
      men.forEach((e, k) => {
        if (k < 24) { const cc = centres[k % 3], a = k * 0.9; e.setPosition(cc.x + Math.cos(a) * (1 + (k % 4) * 0.6), cc.z + Math.sin(a) * (1 + (k % 4) * 0.6), a); } else {
          e.setPosition(sp.x - 14 + ((k - 24) % 9) * 3.2, sp.z - 9 + Math.floor((k - 24) / 9) * 4.5, k);
        }
      });
      for (const e of W.enemies) e.coneVisible = false;
      g.centerOn(sp.x, sp.z); g.setZoom(1);
      const dt = CONFIG.sim.dt, per = Math.max(1, Math.round(1 / 60 / dt)); // one displayed 60 Hz frame = `per` sim ticks + one render
      const frame = () => { const t0 = performance.now(); for (let k = 0; k < per; k++) G.step(dt); const t1 = performance.now(); G.render(1 / 60, 1); G.renderer.renderer.getContext().finish(); return [t1 - t0, performance.now() - t1, performance.now() - t0]; };
      for (let i = 0; i < 40; i++) frame();
      const before = []; for (let i = 0; i < 90; i++) before.push(frame());
      for (const cc of centres) P.explode(W, cc.x, cc.z, 'grenade', c);
      const phys = [], during = [], active = [], props = [];
      for (let i = 0; i < 240; i++) { const f = frame(); const s = W.physics.stats(); during.push(f); if (s.ragdolls || s.props) phys.push(s.ms); active.push(s.ragdolls); props.push(s.props ?? 0); }
      for (let i = 0; i < 900 && (W.physics.moving() || W.physics.pendingSettle.length); i++) g.advance(1 / 60);
      const idle = []; for (let i = 0; i < 60; i++) { g.advance(1 / 60); idle.push(W.physics.stats().ms); }
      const p95 = (a) => +H.p95(a).toFixed(2);
      const p50 = (a) => { const b = [...a].sort((x, y) => x - y); return +(b[Math.floor(b.length / 2)] ?? 0).toFixed(2); };
      out[q] = {
        enemies: men.length, alive: W.enemies.filter((e) => e.alive).length, cap: W.physics.caps.ragdolls, propCap: W.physics.caps.props,
        maxActive: Math.max(0, ...active), maxProps: Math.max(0, ...props), ticks: phys.length,
        physP95: p95(phys), physMax: +Math.max(0, ...phys).toFixed(2), idleP95: p95(idle),
        frameP95Before: p95(before.map((f) => f[2])), frameP95During: p95(during.map((f) => f[2])),
        frameP50Before: p50(before.map((f) => f[2])), frameP50During: p50(during.map((f) => f[2])), frameMaxDuring: +Math.max(...during.map((f) => f[2])).toFixed(1),
        simP95During: p95(during.map((f) => f[0])), renderP95During: p95(during.map((f) => f[1])),
        simP95Before: p95(before.map((f) => f[0])), renderP95Before: p95(before.map((f) => f[1])),
        gameplayCaps: CONFIG.physics.gameplayCaps,
      };
    }
    return out;
  });
  for (const [q, v] of Object.entries(r)) {
    console.log(`    ${q.padEnd(6)} ${v.enemies} enemies (${v.alive} alive after), ragdolls ≤ ${v.maxActive}/${v.cap}, props ≤ ${v.maxProps}/${v.propCap}: physics p95 ${v.physP95} ms (max ${v.physMax}), idle ${v.idleP95}; frame p95 ${v.frameP95Before} → ${v.frameP95During} ms (max ${v.frameMaxDuring}; sim ${v.simP95Before} → ${v.simP95During}, render ${v.renderP95Before} → ${v.renderP95During})`);
    t.ok(v.maxActive <= v.gameplayCaps.ragdolls && v.cap === v.gameplayCaps.ragdolls, `${q}: the fixed ragdoll cap holds`);
    t.ok(v.maxProps <= v.gameplayCaps.props, `${q}: the fixed prop cap holds`);
    t.ok(v.idleP95 <= 0.2, `${q}: idle physics ${v.idleP95} ms`);
  }
  const h = r.high;
  t.ok(h.enemies >= 60, `60 enemies (${h.enemies})`);
  console.log(`    high 1080p absolute target ${FRAME_TARGET_MS} ms: ${h.frameP95During <= FRAME_TARGET_MS ? 'MET' : 'MISSED'} (p95 ${h.frameP95Before} before → ${h.frameP95During} ms during)`);
  // the added cost is judged on the median (the p95 of a shared headless GPU swings by ±5 ms run to run)
  t.ok(h.frameP50During <= h.frameP50Before + ADD_MS, `high 1080p: the blasts add ≤ ${ADD_MS} ms to the median frame (${h.frameP50Before} → ${h.frameP50During})`);
  t.ok(h.physMax <= PHYS_MAX_MS, `high: worst physics tick ${h.physMax} ms (≤ ${PHYS_MAX_MS})`);
  t.ok(h.physP95 <= PHYS_P95_MS, `high: physics p95 ${h.physP95} ms (≤ ${PHYS_P95_MS})`);
}
