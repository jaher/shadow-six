/**
 * Locomotion in the real game (playtest 2026-09-30: "some soldiers when they walk are jerking ... walk smoother
 * and without crossing each other"). Display frames at 75 Hz (not a multiple of the 60 Hz sim, so render
 * interpolation is exercised) are emulated like Game.frame(): sim ticks from an accumulator, then each traced
 * man's interpolated transform (Entity.syncTransform) is read per frame — positions, speeds and headings
 * exactly as drawn. Scenes: the M1 south patrol pair through its about-turn (the user's repro), the M2
 * patrols e2 × e3 crossing, and a three-man group move through the sandbox compound gate.
 */
export default async function locomotion(page, t) {
  const r = await page.evaluate(async () => {
    const g = window.__game, G = g.game, DT = 1 / 75, SIM = 1 / 60;
    /** Emulated display frames for `secs`: per-frame drawn x/z/yaw of each traced unit. */
    const frames = (units, secs) => {
      const out = units.map(() => []);
      let acc = 0;
      for (let f = 0; f < Math.round(secs / DT); f++) {
        acc += DT;
        while (acc >= SIM) { G.step(SIM); acc -= SIM; }
        units.forEach((u, i) => {
          u.syncTransform(acc / SIM);
          const o = u.object3d;
          out[i].push([o.position.x, o.position.z, o.rotation.y, u.alive]);
        });
      }
      return out;
    };
    /**
     * Drawn smoothness: largest one-frame speed blip (m/s², a jump that comes straight back — the stutter a
     * player sees) while walking, largest yaw step (rad/frame).
     */
    const metrics = (s) => {
      const v = s.map((p, k) => (k ? Math.hypot(p[0] - s[k - 1][0], p[1] - s[k - 1][1]) / DT : 0));
      let acc = 0, yaw = 0;
      for (let k = 2; k < s.length - 1; k++) {
        // a jerk is a one-frame blip (speed jumps and comes back), not a crisp start or stop
        if (v[k - 1] > 0.3 && v[k] > 0.3 && v[k + 1] > 0.3 && (v[k] - v[k - 1]) * (v[k] - v[k + 1]) > 0) acc = Math.max(acc, Math.min(Math.abs(v[k] - v[k - 1]), Math.abs(v[k] - v[k + 1])) / DT);
        let d = Math.abs(s[k][2] - s[k - 1][2]) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d;
        yaw = Math.max(yaw, d);
      }
      return { acc: +acc.toFixed(2), yaw: +yaw.toFixed(3) };
    };
    const minDist = (A, B) => { let m = Infinity; for (let k = 0; k < A.length; k++) if (A[k][3] && B[k][3]) m = Math.min(m, Math.hypot(A[k][0] - B[k][0], A[k][1] - B[k][1])); return +m.toFixed(3); };
    const out = {};

    // 1. M1 south patrol pair: walk-up, 4 s halt and about-turn at the south end, walk back
    await g.loadMission('m01'); g.start();
    let w = G.world;
    g.advance(28);
    const e8 = w.byId('e8'), e9 = w.byId('e9');
    const p = frames([e8, e9], 14);
    out.m01 = { lead: metrics(p[0]), mate: metrics(p[1]), min: minDist(p[0], p[1]), alarm: !!w.alarm?.active };
    g.centerOn(e8.x, e8.z); g.render();

    // 2. M2 patrols e2 and e3 cross between their routes' ends
    await g.loadMission('m02'); g.start();
    w = G.world;
    g.advance(188);
    const e2 = w.byId('e2'), e3 = w.byId('e3');
    const q = frames([e2, e3], 26);
    out.m02 = { e2: metrics(q[0]), e3: metrics(q[1]), min: minDist(q[0], q[1]), alarm: !!w.alarm?.active };

    // 3. sandbox: three commandos ordered as a group over the 3.5 m bridge and through the compound's west gate
    //    (enemies removed)
    await g.loadMission('m00'); g.start();
    w = G.world;
    for (const e of [...w.enemies]) w.remove(e);
    const men = w.commandos.slice(0, 3);
    men.forEach((c, k) => c.setPosition(30 + (k % 2) * 0.8, 29 + k * 0.8));
    G.input.select(men);
    G.input.orderMove(52, 30);
    g.advance(0.05);
    const s = frames(men, 22);
    const pairs = [minDist(s[0], s[1]), minDist(s[0], s[2]), minDist(s[1], s[2])];
    out.gate = { m: men.map((_, i) => metrics(s[i])), min: Math.min(...pairs), arrived: men.every((c) => !c.path && c.x > 48),
      walls: s.flat().filter(([x, z]) => !w.grid.walkableAt(x, z)).length };
    g.centerOn(48, 30); g.render();
    return out;
  });
  t.log(JSON.stringify(r));
  const turn = Math.PI / 60 * 1.6; // enemy turn rate (180°/s) per 60 Hz tick, with interpolation slack
  t(r.m01.min >= 0.85, `M1 pair never walks through each other (closest ${r.m01.min} m)`);
  for (const [k, m] of [['leader', r.m01.lead], ['follower', r.m01.mate]]) {
    t(m.acc < 12, `M1 ${k}: no speed spikes as drawn (${m.acc} m/s²)`);
    t(m.yaw < turn, `M1 ${k}: no heading flips as drawn (${m.yaw} rad/frame)`);
  }
  t(!r.m01.alarm && !r.m02.alarm, 'no alarm in the patrol scenes (premise)');
  t(r.m02.min >= 0.75, `M2 e2 × e3 pass each other (closest ${r.m02.min} m)`);
  for (const id of ['e2', 'e3']) t(r.m02[id].acc < 12 && r.m02[id].yaw < turn, `M2 ${id} smooth while dodging ${JSON.stringify(r.m02[id])}`);
  t(r.gate.arrived, 'the group went through the gate and arrived');
  t(r.gate.min >= 0.7, `group never passes through each other (closest ${r.gate.min} m)`);
  t.equal(r.gate.walls, 0, 'nobody pushed into a wall');
  r.gate.m.forEach((m, i) => t(m.acc < 12, `commando ${i}: no speed spikes as drawn (${m.acc} m/s²)`));
  await t.shot('locomotion');
}
