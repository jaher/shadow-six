/**
 * Stance transitions in the game (user 2026-10-01, knife crawl-in: "the stand-up has no rise animation, so the model
 * snaps from prone to idle"; smooth, realistic movement): on M1 the Green Beret (commandos_a runtime), the Driver
 * (commandos_b) and a German (enemy runtime) lie down and get up side by side. Sampled every 0.1 s: each plays
 * go_prone / get_up over the whole stance time, the pelvis falls / rises monotonically through intermediate heights
 * (no pop), the body stays on the ground (lowest skinned vertex), and the root never moves. Then the Green Beret's knife
 * crawl-in: he gets up (get_up) with the knife in his fist and stabs with it.
 * Saves tests/out/stance-transitions.png (the stab). Frame strip / video: tools in docs/screenshots/stance-transitions.jpg.
 */
export const timeout = 150_000;

export default async function stanceTransitions(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    const { skinnedMinY } = await import('/src/art/characters/skin-min.js');
    const C = (await import('/src/config.js')).CONFIG;
    await g.loadMission('m01');
    const w = G.world;
    const guard = w.enemies.find((e) => e.tag === 'e6' || e.id === 'e6' || e.spawn?.id === 'e6');
    for (const e of [...w.enemies]) if (e !== guard) w.remove(e);
    for (const v of [...w.vehicles]) if (v.crew?.some?.((c) => c.kind === 'enemy')) w.remove(v);
    g.start();
    const gb = w.commandos.find((c) => c.role === 'greenberet'), dr = w.commandos.find((c) => c.role === 'driver');
    for (const c of w.commandos) if (c !== gb && c !== dr) c.setPosition(c.x + 30, c.z, c.heading);
    const X = guard.x, Z = guard.z + 9;
    const subjects = [gb, dr, guard];
    subjects.forEach((u, i) => { u.setPosition(X - 2.6 + 2.6 * i, Z, 0); u.stop?.(); });
    // the German holds this spot (his post moves with him; no patrol)
    Object.assign(guard.post || {}, { x: guard.x, z: guard.z, heading: 0, sweep: 0, scan: null });
    if (guard.route) guard.route = null;
    if (guard.brain) guard.brain.frozen = true;
    g.setZoom(1.6); g.centerOn(X, Z);
    const tick = (k) => { for (let i = 0; i < k; i++) { g.advance(1 / 60); G.render(1 / 60, 1); } };
    tick(40);
    const meshOf = (u) => { const I = u.model.real.inner; return Object.values(I.parts).find((p) => p.isSkinnedMesh && /LOD0|body/i.test(p.name)) || Object.values(I.parts).find((p) => p.isSkinnedMesh); };
    const v = new THREE.Vector3();
    const clipOf = (u) => { const m = u.model, I = m.real.inner; return I._clipName ?? (m._tr ? (m.real.anim || 'tr') : m.clip); };
    const sample = (u) => {
      u.model.root.updateMatrixWorld(true);
      const I = u.model.real.inner, gy = w.groundY(u.x, u.z) + (u.y || 0);
      return { clip: clipOf(u), pel: +(I.bones.pelvis.getWorldPosition(v).y - gy).toFixed(3), low: +(skinnedMinY(meshOf(u)) - gy).toFixed(3),
        x: u.x, z: u.z, stance: u.stance };
    };
    const run = (stance, dur) => {
      const rows = subjects.map(() => []);
      subjects.forEach((u) => u.setStance(stance));
      for (let k = 0; k <= Math.round((dur + 0.3) / 0.1); k++) {
        if (k) tick(6);
        subjects.forEach((u, i) => rows[i].push(sample(u)));
      }
      return rows;
    };
    const down = run('crawl', C.units.stanceDown);
    tick(60);
    const up = run('stand', C.units.stanceUp);
    // knife crawl-in: prone 5 m behind the guard (facing away), one knife click
    guard.setPosition(X, Z - 9, -Math.PI / 2);
    Object.assign(guard.post || {}, { x: guard.x, z: guard.z, heading: -Math.PI / 2, sweep: 0, scan: null });
    if (guard.route) guard.route = null;
    if (guard.brain) guard.brain.frozen = false;
    dr.setPosition(dr.x + 30, dr.z, dr.heading);
    gb.setPosition(guard.x, guard.z + 5, -Math.PI / 2); gb.setStance('crawl'); gb._stanceT = 0;
    tick(60);
    const ok = g.useAbility(gb.id, 'knife', guard.id);
    const knife = [];
    for (let i = 0; i < 900 && guard.alive; i++) {
      tick(1);
      if (gb.stance === 'stand' || gb.currentActionId === 'knife') knife.push({ clip: clipOf(gb), w: gb.model.real.weaponName(), up: gb._stanceT > 0, act: gb.currentActionId, x: gb.x, z: gb.z });
    }
    return { down, up, ok, killed: !guard.alive, knife, stanceDown: C.units.stanceDown, stanceUp: C.units.stanceUp,
      names: subjects.map((u) => u.role || u.soldierType || u.kind) };
  });
  const fmt = (rows) => rows.map((q) => `${q.clip}:${q.pel}/${q.low}`).join(' ');
  r.names.forEach((n, i) => t.log(`${n} down ${fmt(r.down[i])}\n      up ${fmt(r.up[i])}`));
  for (const [dir, R, T, clip] of [['down', r.down, r.stanceDown, 'go_prone'], ['up', r.up, r.stanceUp, 'get_up']]) {
    R.forEach((rows, i) => {
      const who = `${r.names[i]} ${dir}`;
      const during = rows.slice(1, Math.round(T / 0.1));   // 0.1 .. T-0.1 s
      t(during.every((q) => q.clip === clip), `${who}: ${clip} plays through the stance time (${during.map((q) => q.clip)})`);
      t(rows.slice(0, Math.round(T / 0.1) + 1).every((q) => Math.hypot(q.x - rows[0].x, q.z - rows[0].z) < 1e-6), `${who}: root stays put`);
      const p = rows.map((q) => q.pel), sgn = dir === 'up' ? 1 : -1;
      for (let k = 1; k < p.length; k++) t(sgn * (p[k] - p[k - 1]) > -0.03, `${who}: pelvis ${dir === 'up' ? 'dips' : 'bounces'} ${p[k - 1]} -> ${p[k]} at ${(k / 10).toFixed(1)} s`);
      for (let k = 1; k < p.length; k++) t(Math.abs(p[k] - p[k - 1]) < 0.4, `${who}: pelvis pops ${p[k - 1]} -> ${p[k]} in 0.1 s`);
      const lo = Math.min(p[0], p.at(-1)), hi = Math.max(p[0], p.at(-1));
      t(p.filter((y) => y > lo + 0.08 && y < hi - 0.08).length >= 3, `${who}: intermediate poses every 0.1 s (${p.join(', ')})`);
      t(rows.every((q) => q.low > -0.08 && q.low < 0.06), `${who}: on the ground throughout (lowest vertex ${rows.map((q) => q.low).join(', ')})`);
    });
  }
  t(r.ok !== false && r.killed, 'knife crawl-in: order accepted, guard killed');
  const rise = r.knife.filter((q) => q.up);
  t(rise.length >= 30, `knife crawl-in: getting up takes the stance time (${rise.length} ticks)`);
  t(rise.slice(2).every((q) => q.clip === 'get_up'), 'knife crawl-in: get_up plays while he gets up: ' + [...new Set(rise.map((q) => q.clip))]);
  t(rise.every((q) => q.w === 'knife'), 'knife crawl-in: knife in the fist while getting up: ' + [...new Set(rise.map((q) => q.w))]);
  t(rise.every((q) => Math.hypot(q.x - rise[0].x, q.z - rise[0].z) < 1e-6), 'knife crawl-in: no step while getting up');
  const stab = r.knife.filter((q) => q.act === 'knife');
  t(stab.length > 0 && stab.slice(1).every((q) => q.w === 'knife'), 'knife crawl-in: stabs with the knife: ' + [...new Set(stab.map((q) => q.w))]);
  await t.shot('stance-transitions');
}
