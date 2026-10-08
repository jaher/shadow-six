/**
 * Doors in hand on the other vehicles (user request 2026-10-07 "Can we have the commando arm close the door of the
 * car"; art/door-hand.js): the M12 Kübelwagen — front seats and a rear seat, left- and right-hand doors, the low
 * open-top doors taken from outside bent over them — and the M7 Sd.Kfz. 251, whose two rear doors (one hand on each)
 * the last man in pulls shut from inside, the first man out pushes open and the last man out shuts from outside.
 * Real skeletons, real models: the fist within 3 cm of the door's edge on every frame it holds it, the door's angle
 * the one his hand has, every door shut at the end, his own model back.
 */
export const timeout = 300_000;

async function run(page, mission, vid, cases) {
  return page.evaluate(async ({ mission, vid, cases }) => {
    const G = window.__game, g = G.game, dt = G.CONFIG.sim.dt;
    await G.loadMission(mission); G.start(); g.stop(); // deterministic: only our steps advance the figures
    const w = g.world, cam = g.cameraController;
    const v = w.byId(vid);
    await v.model.ready;
    // a quiet yard: no alarm, and nobody — the sentries, the armour, and any squad a barracks would release later —
    // moves, sees or shoots while we watch (M2's barracks squads walk over the snow drifts to the lorry since
    // fix/snow-drift-walkable: freezing only the men on the map at load let them down the man at the door)
    const { Enemy } = await import('/src/entities/enemy.js');
    Enemy.prototype.update = function () {};
    if (w.alarm) w.alarm.raise = () => null;
    for (const x of w.vehicles) if (x !== v) x.update = () => {};
    v.taint = () => {}; v.bulletImmune = true;
    const D = await import('/src/abilities/drive.js');
    const step = () => { g.step(dt); g.render(1 / 60, 1); };
    const ready = async () => { step(); const F = v._crewFig; for (const f of [...(F?.occupants?.values() || []), ...(F?.moving || [])]) await f.m.ready; };
    const men = w.commandos.filter((q) => q.alive), out = [];
    for (const [i, seat] of cases.entries()) {
      const u = men[i % men.length], rigs = v.model.doorRigs(seat);
      const p = D.boardPoint(v, u, seat); u.x = p.x; u.z = p.z; u.snap?.();
      cam.setZoom(4, true); cam.centerOn(v.x, v.z); // on screen: the figures have bones
      for (let k = 0; k < 10; k++) step();
      v.model.boarding(seat, 'open');
      for (let k = 0; k < 35; k++) step();
      const state0 = u.alive === false ? 'dead' : u.downed ? 'downed' : 'up'; // (a man hidden in cover boards too)
      v.enter(u, seat, seat); await ready();
      const hand = () => v._crewFig?.occupants?.get(u)?.hand || [...(v._crewFig?.moving || [])].find((x) => x.u === u)?.hand || null;
      const r = { seat, doors: rigs.map((q) => q.node), phases: [], err: 0, track: 0, n: 0, state: state0 };
      const watch = () => {
        const h = hand(); if (!h) return;
        if (!r.phases.includes(h.phase)) r.phases.push(h.phase);
        if (h.key?.w > 0.999 && h.err != null && ['close', 'push', 'shut'].includes(h.phase)) {
          r.n++; r.err = Math.max(r.err, h.err);
          for (const d of h.pair || [h]) r.track = Math.max(r.track, Math.abs(v.model.doorFrac(d.rig.node) - h.frac));
        }
      };
      for (let k = 0; k < 330; k++) { step(); watch(); }
      r.shutIn = rigs.map((q) => v.model.doorFrac(q.node));
      v.exit(u); await ready();
      for (let k = 0; k < 420; k++) { step(); watch(); }
      r.shutOut = rigs.map((q) => v.model.doorFrac(q.node));
      r.visible = !!u.object3d?.visible;
      out.push(r);
    }
    return out;
  }, { mission, vid, cases });
}

export default async function (page, t) {
  const kubel = await run(page, 'm12', 'kubel', [0, 1, 2]);
  t.log(JSON.stringify(kubel));
  for (const r of kubel) {
    const tag = `Kübelwagen seat ${r.seat} (${r.doors.join('/')})`;
    t.ok(r.state === 'up', `${tag}: on his feet (not downed) before he gets in (${r.state})`);
    t.ok(['close', 'push', 'shut'].every((p) => r.phases.includes(p)), `${tag}: pulls it shut, pushes it open, shuts it from outside (${r.phases.join(' > ')})`);
    t.ok(r.n > 40 && r.err < 0.03, `${tag}: fist on the door's edge within 3 cm (${r.n} frames, ≤ ${(r.err * 100).toFixed(2)} cm)`);
    t.ok(r.track < 1e-6, `${tag}: the door is where his hand has it`);
    t.ok(r.shutIn.every((f) => f === 0) && r.shutOut.every((f) => f === 0) && r.visible, `${tag}: shut after each, his own model back`);
  }
  const ht = await run(page, 'm07', 'halftrack', [0]);
  t.log(JSON.stringify(ht));
  const [r] = ht;
  t.ok(r.state === 'up', `251: on his feet (not downed) before he gets in (${r.state})`);
  t.ok(r.doors.length === 2, `Sd.Kfz. 251: both rear doors (${r.doors.join(', ')})`);
  t.ok(['close', 'push', 'shut'].every((p) => r.phases.includes(p)), `251: the last man in pulls them shut, out he pushes them open and shuts them behind him (${r.phases.join(' > ')})`);
  t.ok(r.n > 40 && r.err < 0.03, `251: a fist on each door's edge within 3 cm (${r.n} frames, ≤ ${(r.err * 100).toFixed(2)} cm)`);
  t.ok(r.track < 1e-6, '251: the doors are where his hands have them');
  t.ok(r.shutIn.every((f) => f === 0) && r.shutOut.every((f) => f === 0) && r.visible, '251: shut after each, his own model back');
}
