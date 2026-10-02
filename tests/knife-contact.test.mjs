/**
 * Contact knife kill (user 2026-10-02: "When killing someone from behind it should look like you are stabbing the front
 * neck from behind. When stabbing from the front it should look as if there is no distance"), drawn on the real bodies.
 * M0 (the fuel guard on open ground) from behind and from the front, M1 (the opening sentry e6) from behind; stepped
 * deterministically (g.step(); G.render(1/60, 1)), the pair measured every frame (art/knife-kill.js pairMetrics):
 *  - behind: at the hit frame the attacker's chest is on the victim's back (surface gap within a few cm), his left palm
 *    on the victim's mouth (≤ 5 cm), the knife tip at the front of the throat (≤ 5 cm); the victim's drawn root never
 *    slides while he is held; he ends on his face ahead of where he stood and the settle ragdoll takes over without a
 *    pop (no bone moves more than a few cm in a frame from the fall's end through the ragdoll and its bake)
 *  - front: chest to chest (gap ≈ 0), the blade in his belly; he is pushed back and falls on his back
 *  - both: the stab cry on the hit frame, the quip after it, the AI never hears it (no noise, no alarm)
 * Shots: knife-contact-behind-{game,side}.png at the hit (the grab and the throat), knife-contact-front-side.png.
 */
import { writeFileSync } from 'node:fs';

export const timeout = 240_000;

/** The orthographic side view of the pair, rendered and read back in one task (the canvas keeps no buffer). */
async function sideShot(page, t, name) {
  const url = await page.evaluate(() => {
    const G = window.__game.game, restore = window.__kcSide(12);
    const u = G.renderer.renderer.domElement.toDataURL('image/png');
    restore(); G.render(0, 1);
    return u;
  });
  writeFileSync(t.harness.shotPath(`${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

async function kill(page, t, o) {
  const r = await page.evaluate(async (o) => {
    const g = window.__game, G = g.game, THREE = await import('three');
    const KK = await import('/src/art/knife-kill.js');
    await g.loadMission(o.mission);
    const w = G.world;
    const guard = w.enemies.find((e) => e.tag === o.guard || e.id === o.guard || e.spawn?.id === o.guard);
    for (const e of [...w.enemies]) if (e !== guard) w.remove(e);
    for (const v of [...w.vehicles]) if (v.crew?.some?.((c) => c.kind === 'enemy')) w.remove(v);
    const H = o.h ?? guard.heading;
    guard.setPosition(o.at?.[0] ?? guard.x, o.at?.[1] ?? guard.z, H);
    Object.assign(guard.post || (guard.post = {}), { x: guard.x, z: guard.z, heading: H, sweep: 0, scan: null });
    if (guard.route) guard.route = null;
    const gb = w.commandos.find((c) => c.role === 'greenberet');
    for (const c of w.commandos) if (c !== gb) c.setPosition(c.x + 30, c.z, c.heading);
    const a = H + o.off;
    gb.setPosition(guard.x + Math.cos(a) * 4, guard.z + Math.sin(a) * 4, a + Math.PI);
    g.start();
    await G.mapHandle?.ready;
    // face to face he would see the commando walk up: his eyes off for the frontal approach (the kill is the point here)
    if (o.blind) guard.brain.update = () => {};
    G.input.select?.([]);
    await gb.model?.ready; await guard.model?.ready;
    g.setZoom(3); g.centerOn(guard.x, guard.z);
    const step = () => { g.step(); G.render(1 / 60, 1); };
    for (let i = 0; i < 10; i++) step();
    const ev = [];
    w.events.on('unit:killed', (e) => ev.push({ t: w.time, ev: 'killed', cause: e.cause }));
    w.events.on('ability:start', (e) => ev.push({ t: w.time, ev: 'start', id: e.id }));
    w.events.on('bark', (b) => ev.push({ t: w.time, ev: 'bark', line: b.line }));
    w.events.on('noise', (n) => ev.push({ t: w.time, ev: 'noise', kind: n.kind }));
    g.useAbility(gb.id, 'knife', guard.id);
    const B = (u) => u.model.real.inner.bones;
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const NAMES = ['pelvis', 'spine_03', 'Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r'];
    const rows = [];
    let maxAlert = 0, hitAt = null, hitM = null, rec = null, shot = null;
    // side view (orthographic, perpendicular to his facing) of the pair, rendered into the canvas for the screenshot
    const cam = G.renderer.camera;
    const side = (dist = 12) => {
      const c = new THREE.Vector3((gb.model.root.position.x + guard.model.root.position.x) / 2, 0, (gb.model.root.position.z + guard.model.root.position.z) / 2);
      c.y = (w.groundY?.(c.x, c.z) || 0) + 1.0;
      const sd = new THREE.Vector3(-Math.sin(H), 0, Math.cos(H)).multiplyScalar(o.sideSign || -1);
      const keep = { p: cam.position.clone(), q: cam.quaternion.clone(), l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, n: cam.near, f: cam.far, z: cam.zoom };
      cam.position.copy(c).addScaledVector(sd, dist).add(new THREE.Vector3(0, 0.5, 0)); cam.lookAt(c);
      const hh = 1.2, asp = G.renderer.width / G.renderer.height;
      Object.assign(cam, { left: -hh * asp, right: hh * asp, top: hh, bottom: -hh, near: 1, far: 40, zoom: 1 }); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      G.renderer.render(0);
      return () => { cam.position.copy(keep.p); cam.quaternion.copy(keep.q); Object.assign(cam, { left: keep.l, right: keep.r, top: keep.t, bottom: keep.b, near: keep.n, far: keep.f, zoom: keep.z }); cam.updateProjectionMatrix(); };
    };
    window.__kcSide = side;
    for (let i = 0; i < 520; i++) {
      step();
      if (guard.alive) maxAlert = Math.max(maxAlert, guard.alertLevel || 0);
      rec ||= (w.knifeKills || []).find((k) => k.v === guard) || null;
      rows.push({ t: w.time, alive: guard.alive, rd: !!guard._rd, baked: !!guard.bodyPose, vroot: [guard.model.root.position.x, guard.model.root.position.z],
        vb: NAMES.map((n) => wp(B(guard)[n]).toArray()), ab: NAMES.map((n) => wp(B(gb)[n]).toArray()) });
      if (!guard.alive && hitAt == null) { hitAt = w.time; hitM = KK.pairMetrics(gb, guard); if (o.stopAtHit) { shot = true; break; } }
      if (hitAt != null && w.time > hitAt + 3.2 && guard.bodyPose) break;
    }
    return { rows, ev, hitAt, hitM, maxAlert, alarm: !!w.alarm?.active, cause: guard.deathCause, stance: guard.stance,
      plan: rec ? { side: rec.side, v: rec.plan.v, close: rec.close, hit: rec.hit } : null, corpse: [guard.x, guard.z], shot };
  }, o);
  return r;
}

/** Largest bone move (m) between rows k-1 and k. */
const step = (rows, key, k) => Math.max(...rows[k][key].map((p, j) => { const q = rows[k - 1][key][j]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }));
/**
 * A pop at a hand-over frame k: the body moves there by more than it was already moving (the two frames before; a
 * man still falling keeps falling) — 1.5× that, and never less than 3 cm. @returns {{k, d, before, pop}}
 */
const popAt = (rows, key, k) => {
  if (k == null || k < 3) return { k, d: 0, before: 0, pop: false };
  const d = step(rows, key, k), before = Math.max(step(rows, key, k - 1), step(rows, key, k - 2));
  return { k, t: rows[k].t, d: +d.toFixed(3), before: +before.toFixed(3), pop: d > Math.max(0.03, 1.5 * before) };
};
const jump = (rows, key, from, to) => {
  let mx = 0, at = null;
  for (let k = 1; k < rows.length; k++) {
    if (rows[k].t < from || rows[k].t > to) continue;
    rows[k][key].forEach((p, j) => { const q = rows[k - 1][key][j], d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d > mx) { mx = d; at = rows[k].t; } });
  }
  return { d: +mx.toFixed(3), at };
};

function common(t, r, label) {
  t(r.plan != null, `${label}: a contact kill`);
  t(r.hitAt != null && r.cause === 'knife', `${label}: knifed`);
  const start = r.ev.find((e) => e.ev === 'start');
  r = { ...r, hitAt: r.ev.find((e) => e.ev === 'killed').t };   // the hit tick's own clock (events), like the start's
  // (Game.advance's accumulator can put the start event a tick off the action's own clock)
  t(Math.abs(r.hitAt - start.t - r.plan.hit) < 2 / 60 + 1e-6 && r.plan.close <= 0.3 + 1e-9, `${label}: the kill ${(r.hitAt - start.t).toFixed(3)} s after the start (step ${r.plan.close.toFixed(3)} + 0.3 s)`);
  const cry = r.ev.find((e) => e.ev === 'bark' && e.line === 'ger_cry_stab');
  t(cry && Math.abs(cry.t - r.hitAt) < 1e-6, `${label}: his cry on the hit frame`);
  for (const q of r.ev.filter((e) => e.ev === 'bark' && e.line === 'act_kill')) t(q.t >= r.hitAt + 0.25, `${label}: the quip after the cry`);
  t(!r.ev.some((e) => e.ev === 'noise'), `${label}: silent to the AI`);
  t(!r.alarm, `${label}: no alarm`);
  // held: his drawn root does not move from the start of the action to the hit
  const held = r.rows.filter((q) => q.t >= start.t && q.alive);
  const slide = Math.max(...held.map((q) => Math.hypot(q.vroot[0] - r.plan.v.x, q.vroot[1] - r.plan.v.z)));
  t(slide < 1e-3, `${label}: victim held where he stood (slide ${slide.toFixed(4)} m)`);
}

export default async function knifeContact(page, t) {
  // ---- M0, from behind
  const b = await kill(page, t, { mission: 'm00', guard: 'guard_fuel', at: [16, 46], h: Math.PI, off: Math.PI + 0.3 });
  const mb = b.hitM;
  t.log(JSON.stringify({ behind: mb, plan: b.plan, maxAlert: b.maxAlert, stance: b.stance }));
  common(t, b, 'M0 behind');
  t(b.plan?.side === 'behind', 'M0: from behind');
  t(b.maxAlert === 0, 'M0 behind: he never became aware');
  t(mb.gap <= 0.02 && mb.gap >= -0.06, `M0 behind: chest on his back (gap ${mb.gap.toFixed(3)} m, torsos ${mb.torso.toFixed(3)} m)`);
  t(mb.palmMouth <= 0.05, `M0 behind: left palm on his mouth (${mb.palmMouth.toFixed(3)} m)`);
  t(mb.tipThroat <= 0.05, `M0 behind: knife tip at the front of his throat (${mb.tipThroat.toFixed(3)} m)`);
  t(b.stance === 'crawl', 'M0 behind: he ends on his face');
  const ahead = (b.corpse[0] - b.plan.v.x) * Math.cos(b.plan.v.h) + (b.corpse[1] - b.plan.v.z) * Math.sin(b.plan.v.h);
  t(ahead > 0.5, `M0 behind: pitched forward, away from the attacker (${ahead.toFixed(2)} m ahead)`);
  // the fall's end into the settle ragdoll and its bake: no pop
  const rdAt = b.rows.find((q) => q.rd)?.t, bakeAt = b.rows.find((q) => q.baked)?.t;
  t(rdAt != null && bakeAt != null, `M0 behind: settle ragdoll (${rdAt?.toFixed(2)}) and bake (${bakeAt?.toFixed(2)})`);
  // hand-overs: the drawn fall to the corpse clip, the corpse clip to the settle ragdoll, the ragdoll to its bake
  const idx = (f) => b.rows.findIndex(f);
  const pb = { fallEnd: popAt(b.rows, 'vb', idx((q) => q.t >= b.hitAt + 1.08)), ragdoll: popAt(b.rows, 'vb', idx((q) => q.rd)), bake: popAt(b.rows, 'vb', idx((q) => q.baked)) };
  const jHand = jump(b.rows, 'vb', b.hitAt + 1.0, b.hitAt + 1.6);
  t.log(JSON.stringify({ handovers: pb, maxMoveFallEndToRagdoll: jHand }));
  for (const [k, v] of Object.entries(pb)) t(!v.pop, `M0 behind: no pop at the ${k} hand-over (${v.d} m vs ${v.before} m/frame before)`);
  t(jHand.d < 0.08, `M0 behind: the corpse settles, nothing flies (${jHand.d} m/frame max over 1.0-1.6 s)`);
  // shots at the hit: the grab and the blade at the throat (game camera, both sides)
  const bs = await kill(page, t, { mission: 'm00', guard: 'guard_fuel', at: [16, 46], h: Math.PI, off: Math.PI + 0.3, stopAtHit: true });
  t(bs.shot, 'stopped at the hit for the shots');
  await page.evaluate(() => { window.__game.game.render(0, 1); });
  await t.shot('knife-contact-behind-game');
  await sideShot(page, t, 'knife-contact-behind-side');
  // ---- M0, from the front (face to face; his eyes off: he would see him come)
  const f = await kill(page, t, { mission: 'm00', guard: 'guard_fuel', at: [16, 46], h: Math.PI, off: 0, blind: true });
  const mf = f.hitM;
  t.log(JSON.stringify({ front: mf, plan: f.plan, stance: f.stance }));
  common(t, f, 'M0 front');
  t(f.plan?.side === 'front', 'M0: from the front');
  t(mf.gap <= 0.03 && mf.gap >= -0.06, `M0 front: no gap, chest to chest (${mf.gap.toFixed(3)} m, ${mf.root.toFixed(3)} m apart)`);
  t(mf.tipBelly <= 0.05, `M0 front: the blade in his belly (${mf.tipBelly.toFixed(3)} m)`);
  t(f.stance === 'stand', 'M0 front: falls on his back');
  const fidx = (fn) => f.rows.findIndex(fn);
  const pf = { pushedOff: popAt(f.rows, 'vb', fidx((q) => q.t >= f.hitAt + 0.66)), ragdoll: popAt(f.rows, 'vb', fidx((q) => q.rd)), bake: popAt(f.rows, 'vb', fidx((q) => q.baked)) };
  t.log(JSON.stringify({ frontHandovers: pf }));
  for (const [k, v] of Object.entries(pf)) t(!v.pop, `M0 front: no pop at the ${k} hand-over (${v.d} m vs ${v.before} m/frame before)`);
  const fs = await kill(page, t, { mission: 'm00', guard: 'guard_fuel', at: [16, 46], h: Math.PI, off: 0, blind: true, stopAtHit: true });
  t(fs.shot, 'front: stopped at the hit');
  await sideShot(page, t, 'knife-contact-front-side');
  // ---- M1, the opening sentry e6 from behind (facing north)
  const m1 = await kill(page, t, { mission: 'm01', guard: 'e6', h: -Math.PI / 2, off: Math.PI - 0.4 });
  t.log(JSON.stringify({ m1: m1.hitM, plan: m1.plan, maxAlert: m1.maxAlert }));
  common(t, m1, 'M1 behind');
  t(m1.plan?.side === 'behind' && m1.hitM.palmMouth <= 0.05 && m1.hitM.tipThroat <= 0.05 && m1.hitM.gap <= 0.02,
    `M1 behind: hand on his mouth, tip at his throat, chest on his back (${JSON.stringify(m1.hitM)})`);
  t(m1.maxAlert === 0, 'M1: he never became aware');
}
