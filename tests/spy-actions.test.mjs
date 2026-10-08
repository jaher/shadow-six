/**
 * The Spy's hands-on actions, drawn on the real bodies in the running game (user 2026-10-07: "The animation of the spy
 * grabbing clothes or injecting poison should be as realistic as possible"; abilities/spy-actions.js, art/spy-actions.js).
 * M3, stepped deterministically (g.step(); G.render(1/60, 1)):
 *  - injection from behind on a guard on open ground: at the kill (0.5 s after the start, as before) her left palm on
 *    his mouth, the needle point at the side of his neck (the carotid point, 12 mm in), chest on his back, the plunger
 *    home; his cry muffled; silent to the AI (no noise, no alarm); he is lowered onto his back into his corpse pose and
 *    the settle ragdoll takes over without a pop; the syringe out of her pocket only while used
 *  - injection from the front: the needle into the left side of his neck at a forearm's length
 *  - the clothesline: the tunic and the trousers off their pegs in her hands one after the other, the cap off its peg,
 *    the line left with the shirt and the towel, dressed (the disguise on) at the swap, behind the laundry, the cap
 *    seated on her head where the outfit's own cap sits
 * Shots: spy-inject-behind-{game,side}.png at the kill, spy-inject-lowered-side.png, spy-line-take-side.png,
 * spy-line-dressed-side.png.
 */
import { writeFileSync } from 'node:fs';

export const timeout = 300_000;

async function viewShot(page, t, name, o) {
  const url = await page.evaluate((o) => window.__saShot(o), o);
  writeFileSync(t.harness.shotPath(`${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

async function setupPage(page) {
  await page.evaluate(async () => {
    const g = window.__game, G = g.game, THREE = await import('three');
    window.__saShot = ({ x, z, h, dist = 12, half = 1.25, y = 0.95 }) => {
      const cam = G.renderer.camera, w = G.world;
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone(), up: cam.up.clone(), l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, n: cam.near, f: cam.far, z: cam.zoom };
      const c = new THREE.Vector3(x, (w.groundY?.(x, z) || 0) + y, z), d = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
      cam.position.copy(c).addScaledVector(d, dist).add(new THREE.Vector3(0, 0.6, 0)); cam.up.set(0, 1, 0); cam.lookAt(c);
      const asp = G.renderer.width / G.renderer.height;
      Object.assign(cam, { left: -half * asp, right: half * asp, top: half, bottom: -half, near: dist - 3.2, far: dist + 6, zoom: 1 });
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      G.renderer.render(0);
      const url = G.renderer.renderer.domElement.toDataURL('image/png');
      cam.position.copy(keep.p); cam.quaternion.copy(keep.q); cam.up.copy(keep.up);
      Object.assign(cam, { left: keep.l, right: keep.r, top: keep.t, bottom: keep.b, near: keep.n, far: keep.f, zoom: keep.z });
      cam.updateProjectionMatrix(); G.render(0, 1);
      return url;
    };
  });
}

async function inject(page, o) {
  return page.evaluate(async (o) => {
    const g = window.__game, G = g.game, THREE = await import('three');
    const SA = await import('/src/art/spy-actions.js');
    await g.loadMission('m03');
    const w = G.world;
    const spy = w.commandos.find((c) => c.role === 'spy');
    for (const c of w.commandos) if (c !== spy) c.setPosition(c.x + 3, c.z + 3, c.heading);
    const guard = w.enemies.find((e) => e.tag === 'e14' || e.spawn?.id === 'e14');
    for (const e of [...w.enemies]) if (e !== guard) w.remove(e);
    for (const v of [...w.vehicles]) if (v.crew?.some?.((c) => c.kind === 'enemy')) w.remove(v);
    const H = 0;
    guard.setPosition(133.5, 72.5, H);
    if (guard.route) guard.route = null;
    guard.post = Object.assign(guard.post || {}, { x: 133.5, z: 72.5, heading: H, sweep: 0, scan: null });
    if (o.blind) guard.brain.update = () => {};
    const a = H + o.off;
    spy.setPosition(guard.x + Math.cos(a) * 4, guard.z + Math.sin(a) * 4, a + Math.PI);
    g.start();
    await G.mapHandle?.ready;
    G.input.select?.([]);
    await spy.model?.ready; await guard.model?.ready;
    g.setZoom(3); g.centerOn(guard.x, guard.z);
    const step = () => { g.step(); G.render(1 / 60, 1); };
    for (let i = 0; i < 10; i++) step();
    const ev = [];
    w.events.on('unit:killed', (e) => ev.push({ t: w.time, ev: 'killed', cause: e.cause }));
    w.events.on('ability:start', (e) => ev.push({ t: w.time, ev: 'start', id: e.id }));
    w.events.on('ability:end', (e) => ev.push({ t: w.time, ev: 'end', id: e.id }));
    w.events.on('bark', (b) => ev.push({ t: w.time, ev: 'bark', line: b.line, muffle: !!b.muffle }));
    w.events.on('noise', (n) => ev.push({ t: w.time, ev: 'noise', kind: n.kind }));
    g.useAbility(spy.id, 'syringe', guard.id);
    const B = (u) => u.model.real.inner.bones;
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const NAMES = ['pelvis', 'spine_03', 'Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r'];
    const rows = [];
    let hitAt = null, hitM = null, rec = null, maxAlert = 0, shotAt = null;
    for (let i = 0; i < 400; i++) {
      step();
      if (guard.alive) maxAlert = Math.max(maxAlert, guard.alertLevel || 0);
      rec ||= (w.spyActs || []).find((r) => r.v === guard) || null;
      const m = SA.injectMetrics(spy, guard);
      rows.push({ t: w.time, alive: guard.alive, rd: !!guard._rd, baked: !!guard.bodyPose, shown: m?.shown, fill: m?.fill, vroot: [guard.model.root.position.x, guard.model.root.position.z],
        vb: NAMES.map((n) => wp(B(guard)[n]).toArray()) });
      if (!guard.alive && hitAt == null) { hitAt = w.time; hitM = m; if (o.stopAtHit) { shotAt = 'hit'; break; } }
      if (o.stopAt != null && hitAt != null && w.time >= hitAt + o.stopAt) { shotAt = 'later'; break; }
      if (hitAt != null && w.time > hitAt + 3.0 && guard.bodyPose) break;
    }
    return { rows, ev, hitAt, hitM, maxAlert, alarm: !!w.alarm?.active, cause: guard.deathCause, stance: guard.stance, shotAt,
      plan: rec ? { side: rec.side, v: rec.plan.v, lie: rec.plan.lie, close: rec.T.close, hit: rec.T.hit, dur: rec.T.dur } : null,
      mid: { x: (spy.x + guard.x) / 2, z: (spy.z + guard.z) / 2 }, corpse: [guard.x, guard.z] };
  }, o);
}

/** Largest bone move (m) between rows k-1 and k; a pop: more than it was already moving (×1.5, ≥ 3 cm). */
const step = (rows, k) => Math.max(...rows[k].vb.map((p, j) => { const q = rows[k - 1].vb[j]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
const popAt = (rows, k) => {
  if (k == null || k < 3) return { k, d: 0, before: 0, pop: false };
  const d = step(rows, k), before = Math.max(step(rows, k - 1), step(rows, k - 2));
  return { k, d: +d.toFixed(3), before: +before.toFixed(3), pop: d > Math.max(0.03, 1.5 * before) };
};

export default async function spyActions(page, t) {
  await setupPage(page);
  // ---- injection from behind
  const b = await inject(page, { off: Math.PI + 0.25 });
  const start = b.ev.find((e) => e.ev === 'start'), kill = b.ev.find((e) => e.ev === 'killed');
  t.log(JSON.stringify({ behind: b.hitM, plan: b.plan, maxAlert: b.maxAlert }));
  t(b.plan?.side === 'behind', 'a contact injection from behind');
  t(kill && kill.cause === 'injection', 'killed by the injection');
  t(Math.abs(kill.t - start.t - 0.5) <= 2 / 60 + 1e-6, `the kill 0.5 s after the start, as before (${(kill.t - start.t).toFixed(3)} s)`);
  const m = b.hitM;
  t(m.shown && m.fill <= 0.01, `the syringe in her fist, the plunger home (fill ${m.fill})`);
  t(m.tipCarotid <= 0.03, `the needle point at the side of his neck (${m.tipCarotid.toFixed(3)} m from the carotid point, ${m.depth.toFixed(3)} m in)`);
  t(m.palmMouth <= 0.05, `her palm over his mouth (${m.palmMouth.toFixed(3)} m)`);
  t(m.gap <= 0.03 && m.gap >= -0.07, `chest on his back (gap ${m.gap.toFixed(3)} m)`);
  const cry = b.ev.find((e) => e.ev === 'bark' && e.line === 'ger_cry_stab');
  t(cry && cry.muffle && Math.abs(cry.t - kill.t) < 1e-6, 'his cry at the kill, muffled');
  t(!b.ev.some((e) => e.ev === 'noise'), 'silent to the AI');
  t(!b.alarm && b.maxAlert === 0, 'no alarm, he never became aware');
  const startRow = b.rows.findIndex((r) => r.t >= start.t);
  t(b.rows[startRow].shown === false, 'the syringe still in her pocket as she starts');
  const late = b.rows.find((r) => r.t >= start.t + b.plan.dur - 0.05);
  t(late && late.shown === false, 'back in her pocket at the end');
  t(b.stance === 'stand', 'laid on his back');
  const slide = Math.max(...b.rows.filter((q) => q.t >= start.t && q.alive).map((q) => Math.hypot(q.vroot[0] - b.plan.v.x, q.vroot[1] - b.plan.v.z)));
  t(slide < 1e-3, `held where he stood (${slide.toFixed(4)} m)`);
  // the lowering into his corpse pose, then the settle ragdoll and its bake: no pop
  const idx = (f) => b.rows.findIndex(f);
  const pb = { laid: popAt(b.rows, idx((q) => q.t >= b.hitAt + 1.2)), ragdoll: popAt(b.rows, idx((q) => q.rd)), bake: popAt(b.rows, idx((q) => q.baked)) };
  t.log(JSON.stringify({ handovers: pb }));
  for (const [k, v] of Object.entries(pb)) t(!v.pop, `no pop at the ${k} hand-over (${v.d} m vs ${v.before} m/frame before)`);
  // shots: at the kill (game camera + side from his right: the needle), and laid down
  const bs = await inject(page, { off: Math.PI + 0.25, stopAtHit: true });
  t(bs.shotAt === 'hit', 'stopped at the kill for the shots');
  await page.evaluate(() => window.__game.game.render(0, 1));
  await t.shot('spy-inject-behind-game');
  await viewShot(page, t, 'spy-inject-behind-side', { x: bs.mid.x, z: bs.mid.z, h: Math.PI / 2 }); // from his right: the needle side
  const bl = await inject(page, { off: Math.PI + 0.25, stopAt: 0.85 });
  await viewShot(page, t, 'spy-inject-lowered-side', { x: bl.mid.x, z: bl.mid.z, h: -Math.PI / 2, y: 0.6 });
  // ---- injection from the front (his eyes off: he would see her come)
  const f = await inject(page, { off: 0, blind: true });
  t.log(JSON.stringify({ front: f.hitM, plan: f.plan }));
  t(f.plan?.side === 'front', 'a frontal injection');
  t(f.hitM.tipCarotid <= 0.03, `front: the needle in the side of his neck (${f.hitM.tipCarotid.toFixed(3)} m)`);
  t(Math.abs(f.hitM.root - 0.42) < 0.03, `front: a forearm apart (${f.hitM.root.toFixed(3)} m)`);
  t(f.stance === 'stand', 'front: falls on his back');
  // ---- the clothesline (nobody about)
  const L = await page.evaluate(async () => {
    const g = window.__game, G = g.game;
    const SA = await import('/src/art/spy-actions.js');
    await g.loadMission('m03');
    const w = G.world;
    const spy = w.commandos.find((c) => c.role === 'spy');
    for (const c of w.commandos) if (c !== spy) c.setPosition(c.x + 3, c.z + 3, c.heading);
    for (const e of [...w.enemies]) w.remove(e);
    const line = w.entities.find((i) => i.tag === 'uniform_line');
    spy.setPosition(line.x - 4, line.z + 2.6, -Math.PI / 4);
    g.start(); await G.mapHandle?.ready; await spy.model?.ready;
    g.setZoom(3); g.centerOn(line.x, line.z);
    const step = () => { g.step(); G.render(1 / 60, 1); };
    for (let i = 0; i < 10; i++) step();
    let start = null, end = null;
    w.events.on('ability:start', (e) => { if (e.id === 'use') start ??= w.time; });
    w.events.on('ability:end', (e) => { if (e.id === 'use') end ??= w.time; });
    g.useAbility(spy.id, 'use', line.id);
    const log = [];
    let rec = null, dressedAt = null, takeShot = null;
    for (let i = 0; i < 600 && (end == null || w.time < end + 0.5); i++) {
      step();
      rec ||= (w.spyActs || []).find((r) => r.a === spy) || null;
      if (start != null) log.push({ t: w.time - start, ...SA.dressMetrics(spy, line) });
      if (dressedAt == null && spy.disguised) dressedAt = w.time - start;
      if (start != null && takeShot == null && w.time - start >= SA.VD.grab + 0.12) { takeShot = { x: spy.x, z: spy.z }; window.__saTake = window.__saShot({ x: spy.x, z: spy.z, h: Math.PI }); }
    }
    return { log, T: rec?.T, plan: rec ? { take: rec.plan.take, cover: rec.plan.cover } : null, dressedAt, end: end - start, spy: [spy.x, spy.z], disguised: spy.disguised, count: line.count, takeShot, VD: SA.VD };
  });
  t.log(JSON.stringify({ line: { T: L.T, dressedAt: L.dressedAt, end: L.end, cover: L.plan?.cover } }));
  const at = (x) => L.log.find((q) => q.t >= x - 1e-6);
  const first = at(L.VD.peg2 + 0.02), pull = at(L.VD.peg2 + L.VD.leftLag + 0.02);
  t(first && [first.onLine.tunic, first.onLine.trousers].filter(Boolean).length === 1, 'one garment off its pegs first, the other still pegged');
  t(pull && pull.corner_l <= 0.02 && pull.corner_r <= 0.02, `the tunic and the trousers in her hands (corners ${pull?.corner_l} / ${pull?.corner_r} m from her palms)`);
  t(pull && !pull.onLine.tunic && !pull.onLine.trousers && pull.onLine.cap, 'both off their pegs, the cap still on its peg');
  const capped = at(0.9);
  t(capped && capped.capParent === 'hand_r', 'the cap off its peg in her right hand');
  t(L.count === 0 && L.disguised, 'the uniform off the line and on her');
  t(Math.abs(L.dressedAt - L.T.swap) <= 2 / 60 + 1e-6, `dressed at the swap (${L.dressedAt.toFixed(2)} s; before 1.5 s)`);
  t(Math.abs(L.end - L.T.dur) <= 2 / 60 + 1e-6, `the action ${L.end.toFixed(2)} s`);
  const last = L.log[L.log.length - 1];
  t(!last.onLine.tunic && !last.onLine.trousers && !last.onLine.cap, 'the line left with the shirt and the towel');
  t(L.plan?.cover && Math.hypot(L.spy[0] - L.plan.cover.x, L.spy[1] - L.plan.cover.z) < 0.05, 'dressed behind the laundry');
  const seat = L.log.filter((q) => q.capToWorn != null).map((q) => q.capToWorn);
  t(Math.min(...seat) <= 0.01, `the cap seated where the outfit's own cap sits (${Math.min(...seat).toFixed(4)} m)`);
  const take = await page.evaluate(() => window.__saTake);
  writeFileSync(t.harness.shotPath('spy-line-take-side.png'), Buffer.from(take.split(',')[1], 'base64'));
  await viewShot(page, t, 'spy-line-dressed-side', { x: L.spy[0], z: L.spy[1], h: Math.PI });
}
