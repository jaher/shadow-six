/**
 * M2 barrier gate, MG platforms and access platform (user request "Make a barrier gate. In mission 2 there should be
 * a machine gun on a platform and a platform to be able to enter the space which has the car on the side…").
 *   - gate_se is a boom barrier: walkers (a commando, a German soldier) go round the lowered boom by the footway
 *     beside its fork rest; a slow truck stops at it; a fast truck snaps the pole and drives on;
 *   - a fast smash leaves no pole piece inside a wheel of the stopped truck;
 *   - t1 / t2 are open timber MG platforms: the gunner up there (deck 5.5 m) kneels at the MG (its mount laid along his
 *     heading, his hands on the grips), sees a man in his arc and fires; the daylight flash leaves the MG muzzle;
 *   - plat_sw: units walk up the stair onto the landing / wall walk and back down into the camp, following its slope.
 * Screens (docs/screenshots): m2-barrier-lowered(-z2), m2-barrier-smashed(-z2), m2-barrier-mg-platform(-z2),
 * m2-barrier-access-platform(-z2) — default camera (zoom 1) and zoom 2.
 */
import { saveJpeg } from './bodies-physics.test.mjs';

/** Four M2 loads + four simulated scenes (~45 s of game time, frames rendered): more than 90 s on a busy machine. */
export const timeout = 480_000;

/** Page side: fresh M2, everyone frozen out of the way; returns helpers' results of `scene`. */
async function m2(page, scene, arg = {}) {
  return page.evaluate(async ({ scene, arg }) => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    await g.loadMission('m02'); g.start(); await G.mapHandle?.ready;
    g.setPreset('high');
    const W = G.world, out = {};
    if (W.alarm) W.alarm.fireEvent = () => {};
    for (const e of W.enemies) { H.freeze(e); e.coneVisible = false; }
    const gate = W.interactables.find((i) => i.tag === 'gate_se'), truck = W.vehicles.find((v) => v.tag === 'truck');
    const d = gate.params.structure, rot = d.rot, tx = Math.cos(rot), tz = Math.sin(rot);
    const local = (x, z) => [(x - gate.x) * tx + (z - gate.z) * tz, -(x - gate.x) * tz + (z - gate.z) * tx];
    const shot = (x, z, zoom, ticks = 8) => { g.centerOn(x, z); g.setZoom(zoom); for (let i = 0; i < ticks; i++) G.render(1 / 60, 1); return G.renderer.renderer.domElement.toDataURL('image/jpeg', 0.86); };
    const park = (u) => u.setPosition(Math.min(W.width - 3, 75), 95);
    if (scene === 'walk') {
      // walkers go round the lowered boom: a commando from outside in, a German soldier from inside out
      H.clearArea(W, gate.x, gate.z, 14);
      const c = W.commandos.find((q) => q.role === 'sniper'), e = W.enemies.find((q) => q.id === 'e6' || q.tag === 'e6') || W.enemies.find((q) => !q.vehicle);
      for (const q of W.commandos) if (q !== c) park(q);
      // the inside ends stand clear of the parked truck's hull (6.3 × 2.4 m at (50, 44), 47.4°): nobody stands in a vehicle
      c.setPosition(60.5, 55); e.setPosition(51.5, 42);
      out.order = [c.moveTo(52.5, 43), e.moveTo(61, 55.5)];
      const track = [[], []];
      H.run(g, G, 60 * 25, 10, () => { [c, e].forEach((u, i) => track[i].push(local(u.x, u.z))); });
      out.end = [[c.x, c.z], [e.x, e.z]].map((p) => p.map((v) => +v.toFixed(2)));
      out.footway = track.map((t) => Math.min(...t.map(([u, v]) => Math.hypot(u - (d.w / 2 + d.gap[1]) / 2, v))));
      out.inBoom = track.map((t) => t.filter(([u, v]) => Math.abs(u) < d.w / 2 - 0.1 && Math.abs(v) < 0.25).length);
      out.gateOpen = gate.open; out.destroyed = gate.destroyed;
      out.z1 = shot(gate.x + 1, gate.z + 1, 1); out.z2 = shot(gate.x + 0.5, gate.z + 0.8, 2);
    } else if (scene === 'ram') {
      // the truck: slow (stops at the lowered boom) or fast (snaps the pole and drives on)
      H.clearArea(W, gate.x, gate.z, 30);
      const driver = W.commandos.find((q) => q.role === 'driver');
      for (const q of W.commandos) if (q !== driver) park(q);
      driver.setPosition(truck.x - 2.5, truck.z + 2.5); truck.enter(driver);
      const ev = [];
      for (const n of ['gate:smash', 'gate:settled', 'gate:hold']) G.events.on(n, (x) => ev.push([n, +W.time.toFixed(2), x?.outcome ?? null, x?.kind ?? null]));
      g.centerOn(gate.x + 2, gate.z + 2.5);
      H.run(g, G, 60, 2);
      const S = arg.strip ? new H.Strip(G, { cols: 4, rows: 2, cropW: 960, cropH: 600, tileW: 480, tileH: 300 }) : null;
      S?.grab('before');
      out.order = truck.handleOrder(driver, { type: 'move', x: 67.4, z: 57.6, run: !!arg.fast });
      let at = null;
      const marks = [[0, 'snap'], [0.15, 'pole flies'], [0.4, 'in flight'], [0.8, 'falling'], [1.6, 'landing'], [3.5, 'settled'], [6, 'aftermath']];
      H.run(g, G, 60 * 9, arg.strip ? 1 : 10, () => {
        if (at == null && gate.destroyed) at = W.time;
        if (at != null && marks.length && W.time - at >= marks[0][0] - 1e-6) S?.grab(marks.shift()[1]);
      });
      out.ev = ev; out.destroyed = gate.destroyed; out.smash = gate.smash ? { outcome: gate.smash.outcome, kind: gate.smash.kind } : null;
      out.past = (truck.x - gate.x) * Math.cos(truck.heading) + (truck.z - gate.z) * Math.sin(truck.heading);
      const pg = W.physics.gates?.byKey('gate_se');
      out.bodies = pg ? pg.bodies.map((b) => ({ p: b.pieces.join('+'), hinged: !!b.hinged, fixed: b.fixed })) : [];
      // no settled pole piece inside a wheel of the stopped truck (sample points through each piece's box, tested in
      // each wheel mesh's own frame against its bounds)
      const THREE = await import('three'), wheels = [];
      truck.object3d.updateMatrixWorld(true);
      truck.object3d.traverse((o) => { if (o.isMesh && /wheel|tyre|tire/i.test(`${o.name} ${o.parent?.name || ''}`)) wheels.push(o); });
      out.wheels = wheels.length; out.wheelHits = 0; out.loose = [];
      for (const b of pg?.bodies || []) for (const id of b.pieces) {
        const p = pg.byId.get(id), q = new THREE.Quaternion(b.pose[3], b.pose[4], b.pose[5], b.pose[6]);
        const ql = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rz || 0));
        const c = new THREE.Vector3(...p.c).applyQuaternion(q).add(new THREE.Vector3(b.pose[0], b.pose[1], b.pose[2]));
        if (!b.hinged) out.loose.push([id, +c.x.toFixed(2), +c.z.toFixed(2)]);
        for (let i = 0; i <= 10; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
          const v = new THREE.Vector3((i / 5 - 1) * p.h[0], (j - 1) * p.h[1], (k - 1) * p.h[2]).applyQuaternion(ql).add(c);
          for (const wm of wheels) {
            if (!wm.geometry.boundingBox) wm.geometry.computeBoundingBox();
            if (wm.geometry.boundingBox.containsPoint(wm.worldToLocal(v.clone()))) out.wheelHits++;
          }
        }
      }
      out.truckAt = [+truck.x.toFixed(2), +truck.z.toFixed(2)];
      if (S) out.strip = S.jpeg(0.86);
      if (arg.fast) { out.z1 = shot(gate.x + 2, gate.z + 2, 1); out.z2 = shot(gate.x + 1.5, gate.z + 1.8, 2); }
    } else if (scene === 'mg') {
      // the MG gunner on t2 (deck 5.5 m): a man in his arc outside the NE wall is seen and fired on
      const e9 = W.enemies.find((q) => q.tag === 'e9' || q.id === 'e9'), c = W.commandos.find((q) => q.role === 'sniper');
      for (const q of W.commandos) if (q !== c) park(q);
      if (e9.brain) { delete e9.brain.update; e9.brain.frozen = false; } // un-freeze the gunner only
      const h = e9.post?.heading ?? e9.heading;
      c.setPosition(e9.x + Math.cos(h) * 14, e9.z + Math.sin(h) * 14);
      out.gunner = { y: +(e9.y ?? 0).toFixed(2), x: e9.x, z: e9.z };
      const ev = [];
      G.events.on('enemy:spotted', (x) => { if (x.enemy === e9) ev.push(['spotted', +W.time.toFixed(2)]); });
      G.events.on('shot', (x) => { if (x.shooter === e9) ev.push(['shot', +W.time.toFixed(2), !!x.hit]); });
      let mid = null;
      H.run(g, G, 60 * 8, 6, () => { if (!mid && ev.some((e) => e[0] === 'shot')) mid = shot(e9.x - 1.5, e9.z - 2.5, 2, 2); });
      out.ev = ev.slice(0, 8); out.hurt = c.hp < (c.maxHp ?? 100) || !c.alive;
      // he works the platform MG: kneeling behind it, its mount laid along his facing, the flash at its muzzle
      const mf = (W.fx?.items || []).filter((i) => i.kind === 'muzzle_flash').slice(-1)[0], mt = e9._mgm;
      out.man = { manned: !!e9._mgManned, clip: e9.model?.clip ?? null, hands: !!e9.model?.real?.inner?.mount,
        flash: mf ? [+Math.hypot(mf.x - e9.x, mf.z - e9.z).toFixed(2), +(mf.opts?.y ?? 0).toFixed(2), !!mf.opts?.day] : null, gunOff: null };
      if (mt) {   // angle between the gun's muzzle axis (its +x) and his heading
        mt.gun.updateMatrixWorld(true);
        const m = mt.gun.matrixWorld.elements, gx = m[0], gz = m[2], h = e9.heading;
        out.man.gunOff = +Math.abs(Math.atan2(gx * Math.sin(h) - gz * Math.cos(h), gx * Math.cos(h) + gz * Math.sin(h))).toFixed(3);
      }
      out.z1 = shot(e9.x - 1, e9.z - 2, 1); out.z2 = mid || shot(e9.x - 1.5, e9.z - 2.5, 2);
    } else if (scene === 'plat') {
      // plat_sw: a commando walks down the stair from the wall walk into the camp, then back up
      const c = W.commandos.find((q) => q.role === 'sniper');
      for (const q of W.commandos) if (q !== c) park(q);
      for (const e of W.enemies) if (Math.hypot(e.x - 29, e.z - 42) < 8) park(e);
      c.setPosition(28.3, 42.9); c.y = W.grid.elevAt(28.3, 42.9); H.run(g, G, 4, 2); // staged on the wall walk by the landing
      out.start = +c.y.toFixed(2);
      const legs = [];
      for (const [x, z] of [[33.5, 42.2], [28.3, 42.9]]) {
        const ok = c.moveTo(x, z); let jump = 0, prev = c.y, low = 9, high = -9, mid = null;
        H.run(g, G, 60 * 12, 6, () => {
          jump = Math.max(jump, Math.abs(c.y - prev)); prev = c.y; low = Math.min(low, c.y); high = Math.max(high, c.y);
          if (!mid && c.y > 0.8 && c.y < 1.4) mid = shot(30.2, 42.2, 2, 2);
        });
        legs.push({ ok, end: [+c.x.toFixed(2), +c.z.toFixed(2), +c.y.toFixed(2)], jump: +jump.toFixed(3), low: +low.toFixed(2), high: +high.toFixed(2) });
        if (mid && !out.z2) out.z2 = mid;
      }
      out.legs = legs;
      out.z1 = shot(29, 41.5, 1);
      out.z2 ||= shot(29.5, 41.8, 2);
    }
    return out;
  }, { scene, arg });
}

export default async function m2Barrier(page, t) {
  // 1. walkers round the lowered barrier
  const w = await m2(page, 'walk');
  t.log('walk', JSON.stringify({ ...w, z1: undefined, z2: undefined }));
  if (w.z1) saveJpeg('m2-barrier-lowered.jpg', w.z1);
  if (w.z2) saveJpeg('m2-barrier-lowered-z2.jpg', w.z2);
  t.ok(w.order[0] && w.order[1], 'both walkers got a path with the boom down');
  t.ok(!w.gateOpen && !w.destroyed, 'the boom stayed down');
  t.ok(Math.hypot(w.end[0][0] - 52.5, w.end[0][1] - 43) < 0.8, `the commando walked in round the barrier (${w.end[0]})`);
  t.ok(Math.hypot(w.end[1][0] - 61, w.end[1][1] - 55.5) < 0.8, `the soldier walked out round the barrier (${w.end[1]})`);
  t.ok(w.footway.every((m) => m < 0.8), `both used the footway beside the fork rest (closest ${w.footway.map((v) => v.toFixed(2))} m)`);
  t.ok(w.inBoom.every((n) => n === 0), 'nobody walked through the boom');
  // 2. trucks: slow stops, fast smashes
  const s = await m2(page, 'ram', { fast: false });
  t.log('slow', JSON.stringify(s));
  t.ok(s.order && !s.destroyed && s.past < 0 && s.ev.some((e) => e[0] === 'gate:hold'), `a slow truck stops at the lowered boom (${s.past.toFixed(2)} m)`);
  const f = await m2(page, 'ram', { fast: true, strip: true });
  t.log('fast', JSON.stringify({ ...f, strip: undefined, z1: undefined, z2: undefined }));
  if (f.strip) saveJpeg('m2-barrier-smash-strip.jpg', f.strip);
  if (f.z1) saveJpeg('m2-barrier-smashed.jpg', f.z1);
  if (f.z2) saveJpeg('m2-barrier-smashed-z2.jpg', f.z2);
  t.ok(f.order && f.destroyed && f.smash?.kind === 'boom' && f.smash.outcome !== 'hold', `a fast truck snaps the boom (${JSON.stringify(f.smash)})`);
  t.ok(f.bodies.some((b) => b.hinged && /pole0/.test(b.p)) && f.bodies.some((b) => !b.hinged), 'stub on the pin, the outer pole thrown off');
  t.ok(f.ev.some((e) => e[0] === 'gate:settled') && f.bodies.every((b) => b.fixed), 'the pieces settle');
  t.ok(f.past > 5, `the truck drove on (${f.past.toFixed(1)} m past)`);
  t.ok(f.wheels >= 4 && f.wheelHits === 0, `no pole piece lies in the stopped truck's wheels (${f.wheels} wheel meshes, ${f.wheelHits} sample points inside; truck ${f.truckAt}, pieces ${JSON.stringify(f.loose)})`);
  // 3. the MG gunner on his platform sees and fires
  const m = await m2(page, 'mg');
  t.log('mg', JSON.stringify({ ...m, z1: undefined, z2: undefined }));
  if (m.z1) saveJpeg('m2-barrier-mg-platform.jpg', m.z1);
  if (m.z2) saveJpeg('m2-barrier-mg-platform-z2.jpg', m.z2);
  t.ok(Math.abs(m.gunner.y - 5.5) < 0.15, `the gunner stands on the deck (y ${m.gunner.y})`);
  t.ok(m.ev.some((e) => e[0] === 'spotted') && m.ev.some((e) => e[0] === 'shot'), `he spots the man in his arc and fires (${JSON.stringify(m.ev)})`);
  t.ok(m.man.manned && m.man.clip === 'mg_kneel' && m.man.hands && m.man.gunOff != null && m.man.gunOff < 0.05,
    `he kneels at the MG, hands on its grips, the gun laid along his heading (${JSON.stringify(m.man)})`);
  t.ok(m.man.flash && m.man.flash[0] > 1.2 && m.man.flash[0] < 1.7 && Math.abs(m.man.flash[1] - 6.5) < 0.3 && m.man.flash[2],
    `the (daylight) flash leaves the MG muzzle, not his chest (${JSON.stringify(m.man.flash)})`);
  // 4. the access platform: down the stair into the camp and back up
  const p = await m2(page, 'plat');
  t.log('plat', JSON.stringify({ ...p, z1: undefined, z2: undefined }));
  if (p.z1) saveJpeg('m2-barrier-access-platform.jpg', p.z1);
  if (p.z2) saveJpeg('m2-barrier-access-platform-z2.jpg', p.z2);
  t.ok(Math.abs(p.start - 2.2) < 0.1, `starts on the landing / wall walk (y ${p.start})`);
  const [down, up] = p.legs;
  t.ok(down.ok && Math.hypot(down.end[0] - 33.5, down.end[1] - 42.2) < 0.8 && down.end[2] < 0.15, `walked down the stair into the camp (${down.end})`);
  t.ok(up.ok && Math.hypot(up.end[0] - 28.3, up.end[1] - 42.9) < 0.8 && Math.abs(up.end[2] - 2.2) < 0.1, `and back up onto the wall walk (${up.end})`);
  // on the stair he follows its slope (grid ramp), stepping on / off it eases: ~0.04-0.07 m per tick, never a cell's snap
  t.ok(Math.max(down.jump, up.jump) < 0.1, `his height changes smoothly on the stair (largest ${Math.max(down.jump, up.jump)} m per tick)`);
}
