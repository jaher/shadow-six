/**
 * Locomotion matrix (user, M3 video 2026-10-07: "spy doesnt walk"; "soldiers should walk in all configurations (spy
 * when dressed up as nazi officer, all soldiers should walk/run in all configurations)"). Every character × gait ×
 * configuration the game has is moved over the M3 snow with the real character library, drawn every tick with the
 * camera on him (nothing culled or throttled). On every tick he really moves:
 *   - the clip is a stepping clip (walk / run / crawl / carry / drag / dog trot…), never an idle or action pose;
 *   - his feet (crawling: elbows; a dog: paws, left − right or hind − fore) alternate: fore-aft range ≥ SWING;
 *   - a foot stays planted: the stiller limb of the pair moves at < SKATE of his ground speed (an idle pose carried along, a frozen
 *     mixer or a clip played far too slowly all slide at ~100 %).
 * Rows: the six commandos walk / run / crawl, the Spy in the German officer's uniform walk / run / crawl, the Green
 * Beret crawling knife in fist, a pistol shot on the move (walking and crawling: §3.2 fires on the move — the legs
 * used to freeze in the shoot pose; walking, the shot's arms are layered over the stride), a body on the shoulder, a body dragged, every enemy type and the dog walk / run,
 * two guests walk / run, and a man eased aside standing (Unit._nudge — used to glide in his idle pose).
 */
export const timeout = 480_000;   // ~4–5 min under load (80 rows drawn every tick)

export const SKATE = 0.6;      // planted-limb slide / ground speed (walk / run ≈ 0.1–0.45 measured)
export const SWING = 0.3;      // m: smallest left − right fore-aft range of a stepping gait (walk ≈ 1.2–1.8 measured)

export default async function walkMatrix(page, t) {
  // WM_ONLY=<regexp>: measure only the matching rows (iterating on one configuration)
  const rows = await page.evaluate(async (only) => {
    const g = window.__game, G = g.game;
    const H = await import('/tests/bodies-page.mjs');
    const THREE = await import('three');
    const { LOCOMOTION } = await import('/src/art/unit-anim-map.js');
    const { Commando } = await import('/src/entities/commando.js');
    const { Enemy } = await import('/src/entities/enemy.js');
    await g.loadMission('m03'); g.start(); await G.mapHandle?.ready;
    const W = G.world;
    W.enemies.forEach(H.freeze);
    for (const e of W.enemies) e.coneVisible = false;
    const hurt = [];
    for (const ev of ['unit:damaged', 'unit:downed', 'unit:killed']) W.events.on(ev, (p) => hurt.push(`${ev} ${p.unit?.tag || p.unit?.id} by ${p.source?.tag || p.source?.id || p.source || ''} ${p.cause || ''} t=${W.time.toFixed(1)}`));
    const spot = H.openSpot(W, 100, 60, 14);
    H.clearArea(W, spot.x, spot.z, 26);
    g.setZoom?.(2);
    const inv = new THREE.Matrix4();
    const STEP = /walk|run|crawl|swim|drag|trot|sprint/;
    const out = [];
    // (the pistol rows sound the alarm: barracks squads turn out — frozen like everyone else, nobody shoots the bench)
    const tick = () => { G.step(1 / 60); for (const e of W.enemies) if (e.brain && !e.brain.frozen) H.freeze(e); };
    // (the matrix is a test bench, not a mission: a lost / won state would stop every mixer — Game.render animates
    // only while playing)
    const draw = (u) => { if (G.state !== 'playing') { out.push({ state: G.state, at: u.tag || u.id }); G.state = 'playing'; } g.centerOn(u.x, u.z); G.render(1 / 60, 1); };
    const ticks = (n, u, fn) => { for (let i = 0; i < n; i++) { tick(); draw(u); fn?.(i); } };
    const add = async (u) => { W.add(u); await u.model.ready; H.freeze(u); return u; };
    const sock = (u, n) => { let b = u.model.real?.getSocket?.(n) || null; if (!b) u.model.root.traverse((o) => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
    const test = [];   // every man of the matrix: the others are parked out of the way
    const park = (u) => test.forEach((o, k) => { if (o !== u && o.alive && !o.carriedBy && o.world) { o.stop?.(); o.path = null; o.setPosition(spot.x - 12 + (k % 8) * 1.6, spot.z + 11 + Math.floor(k / 8) * 1.6); } });
    const reset = (u) => { park(u); u.stop?.(); u.path = null; u.setPosition(spot.x - 6, spot.z); u.heading = 0; u.prevHeading = 0; ticks(2, u); };
    const stance = (u, s) => { if (u.stance !== s) { u.setStance(s); ticks(70, u); } };

    /**
     * Sample `n` ticks after `warm` (only ticks where the drawn body really moved count). `go()` starts the motion.
     * limbs: the planted limbs (feet; crawling: elbows; dog: four paws — swing from the first two). stepping: false = no gait clip expected
     * (a man eased aside in his idle pose: only his feet are checked).
     */
    const measure = (label, u, go, { warm = 40, n = 120, limbs = null, stepping = true } = {}) => {
      if (only && !new RegExp(only).test(label)) return;
      if (go() === false) { out.push({ label, err: 'no path' }); return; }
      const names = limbs || (u.stance === 'crawl' ? ['lowerarm_l', 'lowerarm_r'] : ['foot_l', 'foot_r']);
      const L = names.map((n) => sock(u, n)), ok = L.every(Boolean), hr = sock(u, 'hand_r'), hd = sock(u, 'Head');
      let arm = 0, layer = 0;
      // left − right; four paws: also hind − fore each side (a gallop lands its hind paws together)
      const pairs = L.length === 4 ? [[0, 1], [0, 2], [1, 3]] : [[0, 1]], lo = pairs.map(() => Infinity), hi = pairs.map(() => -Infinity);
      let slide = 0, moved = 0, prevP = null, prevRoot = null, mv = 0;
      const clips = {};
      ticks(warm + n, u, (i) => {
        const m = u.model;
        m.root.updateMatrixWorld(true);
        const root = m.root.getWorldPosition(new THREE.Vector3());
        const d = prevRoot ? Math.hypot(root.x - prevRoot.x, root.z - prevRoot.z) : 0;
        const moving = prevRoot && d > 0.2 / 60;
        prevRoot = root;
        if (i < warm || !moving) { prevP = null; return; }
        mv++;
        const k = `${m.anim}:${m.clip}`; clips[k] = (clips[k] || 0) + 1;
        // a shot on the move: the action's arms over the legs (UnitModel._upperLayer) — the gun hand at the shoulders
        if (m._upName && hr && hd) { inv.copy(m.root.matrixWorld).invert(); const y = hr.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).y / hd.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).y; arm = Math.max(arm, y); layer++; }
        if (!ok) return;
        const P = L.map((b) => b.getWorldPosition(new THREE.Vector3()));
        // planted = the limb that moves least this tick; its ground motion is the slide (a carried pose: both
        // limbs travel with the body, slide ≈ the distance moved)
        if (prevP) slide += Math.min(...P.map((p, k) => Math.hypot(p.x - prevP[k].x, p.z - prevP[k].z)));
        moved += d;
        prevP = P;
        inv.copy(m.root.matrixWorld).invert();
        const Q = P.map((p) => p.clone().applyMatrix4(inv).z);
        pairs.forEach(([a, b], k) => { const s = Q[a] - Q[b]; lo[k] = Math.min(lo[k], s); hi[k] = Math.max(hi[k], s); });
      });
      const ks = Object.keys(clips);
      out.push({ label, stepping, clips, limbs: ok, mv, moved: +moved.toFixed(2),
        loco: ks.length > 0 && ks.every((c) => LOCOMOTION.has(c.split(':')[0]) && STEP.test(c.split(':')[1])),
        swing: mv ? +Math.max(...pairs.map((_, k) => hi[k] - lo[k])).toFixed(3) : null, skate: moved > 0.15 ? +(slide / moved).toFixed(3) : null,
        stance: u.stance, ustate: u.state, layer, arm: +arm.toFixed(2), speed: +(u.speed || 0).toFixed(2), gait: +(u.model.gaitSpeed || 0).toFixed(2), id: u.model.characterId, state: G.state });
      u.stop?.(); u.path = null;
      ticks(15, u);
    };
    const walkTo = (u, run = false, dist = 10, dir = 0) => () => u.moveTo(u.x + Math.cos(dir) * dist, u.z + Math.sin(dir) * dist, { run });

    // ---- commandos: every role, walk / run / crawl
    const roles = ['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy'];
    const C = {};
    for (const role of roles) test.push(C[role] = W.commandos.find((c) => c.role === role) || await add(new Commando({ role, x: spot.x, z: spot.z })));
    for (const role of roles) {
      const c = C[role];
      reset(c); measure(`${role} walk`, c, walkTo(c));
      reset(c); measure(`${role} run`, c, walkTo(c, true, 16));
      reset(c); stance(c, 'crawl'); measure(`${role} crawl`, c, walkTo(c, false, 4), { n: 150 }); stance(c, 'stand');
    }
    // ---- the Spy as a German officer (the user's report)
    const spy = C.spy;
    spy.setDisguise(true);
    reset(spy); measure('spy disguised walk', spy, walkTo(spy));
    reset(spy); measure('spy disguised run', spy, walkTo(spy, true, 16));
    reset(spy); stance(spy, 'crawl'); measure('spy disguised crawl', spy, walkTo(spy, false, 4), { n: 150 }); stance(spy, 'stand');
    spy.setDisguise(false);
    // ---- weapons: crawling knife in fist; a pistol shot on the move, walking and crawling (§3.2)
    const gb = C.greenberet;
    reset(gb); stance(gb, 'crawl'); gb.readyTool = 'knife';
    measure('greenberet crawl knife', gb, walkTo(gb, false, 4), { n: 150 });
    gb.readyTool = null; stance(gb, 'stand');
    const mark = await add(new Enemy({ id: 'wm_mark', soldierType: 'soldier', x: spot.x, z: spot.z + 7 }));
    test.push(mark);
    const fire = (c, dist) => () => {
      const ok = walkTo(c, false, dist)();
      // (the mark ahead on his way: he fires without turning off it)
      if (ok) { ticks(25, c); mark.setPosition(c.x + 7, c.z + 0.3); c.issue({ type: 'ability', id: 'pistol', target: mark }); }
      return ok;
    };
    reset(gb); measure('greenberet walk firing pistol', gb, fire(gb, 10), { warm: 0, n: 60 });
    const dv = C.diver;
    reset(dv); stance(dv, 'crawl'); measure('diver crawl firing pistol', dv, fire(dv, 4), { warm: 0, n: 80 });
    stance(dv, 'stand');
    // ---- with a load: a body on the shoulder, a body dragged by the armpits
    const carry = async (c, mode, id) => {
      reset(c);
      const v = await add(new Enemy({ id, soldierType: 'soldier', x: c.x + 1, z: c.z }));
      v.die?.('test', null); ticks(90, c);
      c.issue({ type: 'ability', id: 'hand', target: v });
      for (let i = 0; i < 400 && c.carrying !== v; i++) { tick(); draw(c); }
      if (c.carrying === v && c.carryMode !== mode) c.issue({ type: 'ability', id: 'carryToggle', target: c });
      for (let i = 0; i < 300 && (c.carryMode !== mode || c.currentAction); i++) { tick(); draw(c); }
      return c.carrying === v && c.carryMode === mode;
    };
    if (await carry(gb, 'shoulder', 'wm_v1')) measure('greenberet carry', gb, walkTo(gb, false, 7)); else out.push({ label: 'greenberet carry', err: 'no lift' });
    const drv = C.driver;
    if (await carry(drv, 'drag', 'wm_v2')) measure('driver drag', drv, walkTo(drv, false, 4, Math.PI), { n: 150 }); else out.push({ label: 'driver drag', err: 'no drag' });
    // ---- enemies: every soldier type (+ officer, engineer, Afrika Korps, winter, dog), walk and run
    for (const type of ['soldier', 'sentry', 'sergeant', 'trooper', 'mg', 'crew', 'officer', 'engineer', 'afrika', 'winter', 'dog']) {
      const e = await add(new Enemy({ id: `wm_${type}`, soldierType: type, x: spot.x, z: spot.z }));
      test.push(e);
      const limbs = type === 'dog' ? ['hpaw_l', 'hpaw_r', 'fpaw_l', 'fpaw_r'] : null;
      reset(e); measure(`enemy ${type} walk`, e, walkTo(e), { limbs });
      reset(e); measure(`enemy ${type} run`, e, walkTo(e, true, 16), { limbs });
      W.remove(e); test.splice(test.indexOf(e), 1);
    }
    // ---- guests (McRae, a prisoner)
    for (const guestId of ['mcrae', 'prisoner_worker']) {
      const q = await add(new Commando({ role: 'guest', guestId, x: spot.x, z: spot.z }));
      test.push(q);
      reset(q); measure(`guest ${guestId} walk`, q, walkTo(q));
      reset(q); measure(`guest ${guestId} run`, q, walkTo(q, true, 12));
      W.remove(q); test.splice(test.indexOf(q), 1);
    }
    // ---- eased aside standing: two Germans stopped on one spot, the one giving way shuffles off (Unit._nudge)
    const a = await add(new Enemy({ id: 'wm_na', soldierType: 'soldier', x: spot.x, z: spot.z }));
    const b = await add(new Enemy({ id: 'wm_nb', soldierType: 'soldier', x: spot.x, z: spot.z }));
    park(null);
    a.setPosition(spot.x, spot.z); b.setPosition(spot.x + 0.12, spot.z + 0.04);
    a.heading = b.heading = Math.PI / 2;
    const ax = a.x, bx = b.x;
    a._settle = b._settle = () => {};   // (the 4 Hz settle would walk him off: the shuffle under test is Unit._nudge)
    ticks(2, a);
    const giver = Math.abs(a.x - ax) > Math.abs(b.x - bx) ? a : b;
    measure('enemy eased aside', giver, () => true, { warm: 0, n: 50, stepping: false });
    out.push({ hurt });
    return out;
  }, process.env.WM_ONLY || null);
  for (const row of rows) t.log(JSON.stringify(row));
  for (const r of rows) {
    if (!r.label) continue;   // (a state note)
    if (r.err) { t(false, `${r.label}: ${r.err}`); continue; }
    t(r.mv >= 20, `${r.label}: moved on ≥ 20 ticks (${r.mv}, ${r.moved} m)`);
    if (!r.stepping) t(Object.keys(r.clips).every((k) => k.startsWith('idle')), `${r.label}: eased aside in his standing pose ${JSON.stringify(r.clips)}`);
    if (r.stepping) {
      t(r.loco, `${r.label}: a stepping clip on every moving tick ${JSON.stringify(r.clips)}`);
      t(r.swing >= SWING, `${r.label}: feet alternate (swing ${r.swing} m ≥ ${SWING})`);
    }
    if (/walk firing/.test(r.label)) t(r.layer >= 10 && r.arm >= 0.7, `${r.label}: the gun arm up at the shoulders over the walking legs (${r.layer} ticks, hand at ${r.arm} of head height)`);
    t(r.limbs, `${r.label}: limbs found`);
    if (r.skate != null) t(r.skate <= SKATE, `${r.label}: planted limb stays put (slides ${r.skate} of ground speed ≤ ${SKATE})`);
  }
}
