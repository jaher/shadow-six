/**
 * Debug VIDEO MODE camera director maths (src/debug/walkthrough-director.js) and its pacing (TickPacer speeds / skip
 * waits boost, src/debug/solution-replay.js): framing puts every point inside the free rectangle, centred; the acting
 * men win when everything does not fit; the free rectangle avoids the HUD's corner block; the spring settles. The calm
 * camera (user 2026-11-09: "Debug solutions dont need the camera to be moving around so much, it used to be more static
 * before"): a framing held while the acting men stay in its dead zone, slid (never re-centred) as a man walks out of
 * it, a new subject taken at once only when it matters or is off screen, fewer zoom moves, an acting man never past the
 * safe edge; the focus hysteresis (no ping-pong between men acting by turns); the yaw swung only for a lasting
 * occlusion and kept for the rest of the shot; smoke and other see-through meshes hide nobody.
 */
import { test, assert, near } from './lib.mjs';
import {
  framePoints, frameWithPriority, freeRect, screenMetres, spring, calmFrame, keepInSafe, atZoom, screenPx, insetRect, FocusKeeper,
  seeThrough, shotKey, Director, SHOT_HOLD_MS, DEAD_ZONE, SAFE_ZONE, FOCUS_MIN_MS, ZOOM_STEP, YAW_PERSIST_MS,
} from '../../src/debug/walkthrough-director.js';
import { TickPacer } from '../../src/debug/solution-replay.js';
import { WALK_SPEEDS, SKIP_BOOST } from '../../src/debug/walkthrough.js';

const deg = (d) => (d * Math.PI) / 180;
/** Screen px of world point p for a camera at target (tx, tz) / zoom, as CameraController projects it (orthographic). */
function project(p, view, t, zoom) {
  const ppm = 40 * zoom, a = screenMetres(p, view.az, view.el), c = screenMetres({ x: t.x, y: 0, z: t.z }, view.az, view.el);
  return { x: view.width / 2 + (a.u - c.u) * ppm, y: view.height / 2 + (a.w - c.w) * ppm };
}

test('framePoints: every point inside the free rectangle, the box centred in it, at any yaw / pitch', () => {
  for (const [az, el] of [[0, 40], [15, 40], [-30, 64], [45, 55]]) {
    const view = { az: deg(az), el: deg(el), width: 1280, height: 720 };
    const rect = { x: 160, y: 130, w: 900, h: 380 };
    const pts = [{ x: 100, y: 0, z: 40 }, { x: 112, y: 2, z: 47 }, { x: 95, y: 7, z: 52 }];
    const f = framePoints(pts, view, rect);
    assert.ok(f.fit, `${az}/${el} fits`);
    const s = pts.map((p) => project(p, view, f, f.zoom));
    for (const q of s) assert.ok(q.x >= rect.x && q.x <= rect.x + rect.w && q.y >= rect.y && q.y <= rect.y + rect.h, `${az}/${el}: ${JSON.stringify(q)} in the rect`);
    const cx = (Math.min(...s.map((q) => q.x)) + Math.max(...s.map((q) => q.x))) / 2, cy = (Math.min(...s.map((q) => q.y)) + Math.max(...s.map((q) => q.y))) / 2;
    near(cx, rect.x + rect.w / 2, 0.5, 'centred x');
    near(cy, rect.y + rect.h / 2, 0.5, 'centred y');
  }
});

test('framePoints: one man is shown with ground around him (min span), zoom kept in its range', () => {
  const view = { az: deg(15), el: deg(40), width: 1280, height: 720 };
  const f = framePoints([{ x: 50, y: 0, z: 50 }], view, { x: 0, y: 100, w: 1280, h: 500 });
  assert.ok(f.zoom <= 1.35 && f.zoom >= 0.42);
  const g = framePoints([{ x: 0, y: 0, z: 0 }, { x: 300, y: 0, z: 300 }], view, { x: 0, y: 100, w: 1280, h: 500 });
  assert.ok(!g.fit && Math.abs(g.zoom - 0.42) < 1e-9, 'too wide: the widest zoom, not fitted');
});

test('frameWithPriority: when all cannot fit, the acting men stay in the picture', () => {
  const view = { az: deg(15), el: deg(64), width: 839, height: 412 };
  const rect = { x: 6, y: 111, w: 557, h: 176 };
  const actor = { x: 101, y: 0, z: 14.6 }, far = { x: 77, y: 0, z: 35.5 };
  const f = frameWithPriority([actor, far], 1, view, rect);
  const q = project(actor, view, f, f.zoom);
  assert.ok(q.x >= rect.x && q.x <= rect.x + rect.w && q.y >= rect.y && q.y <= rect.y + rect.h, `the actor is in the free rect (${JSON.stringify(q)})`);
});

test('freeRect: the larger of "above the HUD block" and "beside it"', () => {
  const desk = freeRect({ width: 1280, height: 720, top: 130, bottom: 150, right: 60, block: { x: 935, y: 497, w: 345, h: 224 } });
  assert.deepEqual([desk.x, desk.y, desk.w, Math.round(desk.h)], [0, 130, 1220, 367], 'desktop: full width above the knapsack');
  const land = freeRect({ width: 839, height: 412, top: 111, bottom: 80, right: 42, block: { x: 563, y: 233, w: 276, h: 179 } });
  assert.deepEqual([land.x, land.w], [0, 563], 'phone landscape: beside the knapsack');
});

test('spring: settles on the target without overshoot, from any start', () => {
  let x = 0, v = 0;
  let maxX = 0;
  for (let i = 0; i < 180; i++) { [x, v] = spring(x, v, 10, 3.2, 1 / 60); maxX = Math.max(maxX, x); }
  near(x, 10, 0.05, 'settled in 3 s');
  assert.ok(maxX <= 10 + 1e-6, 'no overshoot');
});

test('video mode pace: ½× to 4×, skip waits raises it, the pacer refuses other speeds', () => {
  const p = new TickPacer({ simDt: 1 / 60, maxPerFrame: 8, speeds: WALK_SPEEDS });
  assert.equal(p.speed, 1);
  let ticks = 0;
  const run = (frames, dt) => { for (let f = 0; f < frames; f++) { p.frame(dt, f * dt * 1000); while (p.canTick(0)) { p.take(); ticks++; } } };
  for (const s of WALK_SPEEDS) { p.setSpeed(s); ticks = 0; run(60, 1 / 60); near(ticks, 60 * s, 1, `${s}x`); }
  p.setSpeed(8);
  assert.equal(p.speed, 4, '8x is not a walkthrough speed');
  p.setSpeed(1); p.boost = SKIP_BOOST; ticks = 0; run(60, 1 / 60);
  near(ticks, 60 * SKIP_BOOST, 1, 'skip waits: 4x the chosen speed');
  assert.equal(p.rate, SKIP_BOOST);
});

test('always action: while the step\'s men stand idle the camera turns to another man at work, else the guard they wait for', async () => {
  const { pickLive, isActing } = await import('../../src/debug/walkthrough-director.js');
  const man = (role, o = {}) => ({ kind: 'commando', role, alive: true, x: 0, z: 0, path: null, pendingAbility: null, currentAction: null, currentActionId: null, ...o });
  const guard = (tag, x, z, o = {}) => ({ kind: 'enemy', tag, alive: true, x, z, path: null, ...o });
  const gb = man('greenberet'), sp = man('sapper', { x: 40 }), spy = man('spy', { x: 80, currentAction: {}, currentActionId: 'distract' });
  assert.ok(!isActing(gb) && !isActing(spy), 'standing, lying dug in or chatting a guard up is no action');
  assert.ok(isActing(man('x', { path: [1] })) && isActing(man('x', { pendingAbility: {} })) && isActing(man('x', { currentAction: {}, currentActionId: 'knife' })));
  assert.equal(pickLive({ who: [gb], commandos: [gb, sp, spy] }), null, 'nothing moves: the usual shot');
  sp.path = [[1, 1]];
  assert.equal(pickLive({ who: [gb], commandos: [gb, sp, spy] }), sp, 'the Sapper on the move');
  const dv = man('diver', { x: 90, pendingAbility: {} });
  const orderT = new Map([[sp, 10], [dv, 12]]);
  assert.equal(pickLive({ who: [gb], commandos: [gb, sp, dv], orderT }), dv, 'two at work: the one ordered last');
  assert.equal(pickLive({ who: [sp], commandos: [gb, sp, dv] }), null, 'the step\'s man acts: the usual shot');
  sp.path = null; dv.pendingAbility = null;
  const e19 = guard('e19', 20, 0, { path: [1] }), e7 = guard('e7', 10, 0, { path: [1] }), e9 = guard('e9', 5, 0);
  assert.equal(pickLive({ who: [gb], commandos: [gb, sp, dv], enemies: [e7, e19, e9], tags: new Set(['e19']) }), e19, 'the guard the step names, walking');
  assert.equal(pickLive({ who: [gb], commandos: [gb], enemies: [e7, e19, e9] }), e7, 'else the nearest walking guard');
  assert.equal(pickLive({ who: [gb], commandos: [gb], enemies: [guard('e1', 60, 0, { path: [1] }), e9] }), null, 'none walking near: the usual shot');
});

// ------------------------------------------------------------------ the calm camera

const VIEW = { az: deg(15), el: deg(52), width: 1280, height: 720 };
const RECT = { x: 6, y: 120, w: 1268, h: 440 };
const inRect = (q, r, pad = 0.5) => q.x >= r.x - pad && q.x <= r.x + r.w + pad && q.y >= r.y - pad && q.y <= r.y + r.h + pad;
/** A held framing of man `p` alone, taken at wall ms `at`, for subject `key`. */
const heldOn = (p, at = 0, key = 'gb') => ({ ...framePoints([p], VIEW, RECT, { minSpan: [20, 12.5] }), at, key });
const want = (pts, o = { minSpan: [20, 12.5] }) => frameWithPriority(pts, 1, VIEW, RECT, o);

test('calm camera: a man moving inside the dead zone moves nothing (shot hold)', () => {
  const p0 = { x: 50, y: 0, z: 40 }, held = heldOn(p0);
  for (const [dx, dz] of [[2, 0], [-3, 1], [0, 2.5], [3, -2]]) {
    const p = { x: p0.x + dx, y: 0, z: p0.z + dz };
    const f = calmFrame(held, want([p]), [p], 1, VIEW, RECT, { now: 500, key: 'gb' });
    assert.equal(f.kind, 'keep', `${dx},${dz}: held`);
    assert.ok(f.x === held.x && f.z === held.z && f.zoom === held.zoom, 'the framing is the held one');
    assert.ok(inRect(screenPx(p, VIEW, f, f.zoom), insetRect(RECT, DEAD_ZONE)), 'he is inside the dead zone');
  }
});

test('calm camera: a man walking out of the dead zone slides the framing just enough (followed, not re-centred)', () => {
  const p0 = { x: 50, y: 0, z: 40 }, held = heldOn(p0, 0);
  const inner = insetRect(RECT, DEAD_ZONE);
  let h = held, pushes = 0;
  for (let i = 1; i <= 60; i++) {
    const p = { x: p0.x + i * 0.5, y: 0, z: p0.z }; // (walking 30 m east)
    const f = calmFrame(h, want([p]), [p], 1, VIEW, RECT, { now: i * 16, key: 'gb' });
    assert.ok(f.kind === 'keep' || f.kind === 'push', `step ${i}: ${f.kind}`);
    if (f.kind === 'push') {
      pushes++;
      const q = screenPx(p, VIEW, f, f.zoom);
      assert.ok(inRect(q, inner), `step ${i}: back inside the dead zone (${q.x.toFixed(1)}, ${q.y.toFixed(1)})`);
      const onEdge = Math.min(Math.abs(q.x - inner.x), Math.abs(q.x - inner.x - inner.w), Math.abs(q.y - inner.y), Math.abs(q.y - inner.y - inner.h));
      assert.ok(onEdge < 0.5, `step ${i}: on its edge, not re-centred (${onEdge.toFixed(2)} px)`);
      assert.equal(f.zoom, held.zoom, 'no zoom move');
      assert.equal(f.at, held.at, 'a push is no new framing (the hold runs on)');
    }
    h = f;
  }
  assert.ok(pushes > 20 && pushes < 60, `the first steps inside the dead zone moved nothing, then it followed (${pushes} pushes)`);
});

test('calm camera: a new subject — in the picture already: no move; on screen: held SHOT_HOLD_MS; off screen or urgent: at once', () => {
  const gb = { x: 50, y: 0, z: 40 }, held = heldOn(gb, 1000, 'gb');
  const inner = insetRect(RECT, DEAD_ZONE), edge = insetRect(RECT, SAFE_ZONE);
  // (a man 3 m off: inside the dead zone)
  const near3 = { x: 53, y: 0, z: 40 };
  const a = calmFrame(held, want([near3]), [near3], 1, VIEW, RECT, { now: 1200, key: 'spy' });
  assert.ok(a.kind === 'keep' && a.x === held.x && a.key === 'spy', 'in the dead zone: the shot is his, nothing moves');
  // (a man on screen but out of the dead zone: between the dead zone and the safe edge)
  let side = null;
  for (let d = 1; d < 40 && !side; d += 0.25) {
    const q = { x: gb.x + d * Math.cos(VIEW.az), y: 0, z: gb.z - d * Math.sin(VIEW.az) };
    const s = screenPx(q, VIEW, held, held.zoom);
    if (!inRect(s, inner, 0) && inRect(s, edge, 0)) side = q;
  }
  assert.ok(side, 'found a point between the dead zone and the safe edge');
  const b = calmFrame(held, want([side]), [side], 1, VIEW, RECT, { now: 1000 + SHOT_HOLD_MS - 100, key: 'spy' });
  assert.equal(b.kind, 'keep', 'on screen, not urgent, the framing young: held');
  const c = calmFrame(held, want([side]), [side], 1, VIEW, RECT, { now: 1000 + SHOT_HOLD_MS + 1, key: 'spy' });
  assert.equal(c.kind, 'frame', 'once the hold is up: his own framing');
  const u = calmFrame(held, want([side]), [side], 1, VIEW, RECT, { now: 1100, key: 'spy', urgent: true });
  assert.equal(u.kind, 'frame', 'urgent (an action watched, a blast): at once');
  const far = { x: 120, y: 0, z: 90 };
  const o = calmFrame(held, want([far]), [far], 1, VIEW, RECT, { now: 1100, key: 'spy' });
  assert.ok(o.kind === 'frame' && inRect(screenPx(far, VIEW, o, o.zoom), inner), 'off screen: at once (always action), framed in the dead zone');
});

test('calm camera: fewer zoom moves — a reframe keeps a near zoom; a far wider one closes in after the hold; spread men widen at once', () => {
  const gb = { x: 50, y: 0, z: 40 }, held = heldOn(gb, 0, 'gb');
  // (the shot asks for a slightly tighter zoom: kept)
  const far = { x: 110, y: 0, z: 40 };
  const z1 = held.zoom * Math.exp(ZOOM_STEP * 0.8);
  const f1 = calmFrame(held, want([far], { minSpan: [20, 12.5], minZoom: z1, maxZoom: z1 }), [far], 1, VIEW, RECT, { now: 10, key: 'spy', urgent: true });
  assert.equal(f1.kind, 'frame');
  near(f1.zoom, held.zoom, 1e-9, 'the reframe keeps the zoom it had');
  const box = screenPx(far, VIEW, f1, f1.zoom), rc = { x: RECT.x + RECT.w / 2, y: RECT.y + RECT.h / 2 };
  near(box.x, rc.x, 0.5, 'and still centres him (x)');
  near(box.y, rc.y, 0.5, 'and still centres him (y)');
  // (the shot asks for a far tighter zoom on the same man: only once the hold is up)
  const tight = want([gb], { minSpan: [20, 12.5], minZoom: held.zoom * 2, maxZoom: held.zoom * 2 });
  assert.equal(calmFrame(held, tight, [gb], 1, VIEW, RECT, { now: SHOT_HOLD_MS - 1, key: 'gb' }).kind, 'keep', 'young: no zoom-in');
  assert.equal(calmFrame(held, tight, [gb], 1, VIEW, RECT, { now: SHOT_HOLD_MS + 1, key: 'gb' }).kind, 'frame', 'old: it closes in');
  // (two men spread past the held picture: wider at once)
  const pts = [{ x: 20, y: 0, z: 40 }, { x: 80, y: 0, z: 40 }];
  const sp = calmFrame(held, frameWithPriority(pts, 2, VIEW, RECT, { minSpan: [20, 12.5] }), pts, 2, VIEW, RECT, { now: 10, key: 'gb' });
  assert.ok(sp.kind === 'frame' && sp.zoom < held.zoom, 'spread: wider now');
  for (const p of pts) assert.ok(inRect(screenPx(p, VIEW, sp, sp.zoom), RECT), 'both in the picture');
});

test('calm camera: keepInSafe brings an acting man past the safe edge back to it (always action), else nothing', () => {
  const gb = { x: 50, y: 0, z: 40 }, cam = heldOn(gb);
  assert.equal(keepInSafe(cam, [gb], 1, VIEW, RECT), null, 'centred: nothing to do');
  const run = { x: 50 + 30 * Math.cos(VIEW.az), y: 0, z: 40 - 30 * Math.sin(VIEW.az) };
  const s = keepInSafe(cam, [run], 1, VIEW, RECT);
  const edge = insetRect(RECT, SAFE_ZONE), q = screenPx(run, VIEW, { ...s, zoom: cam.zoom }, cam.zoom);
  assert.ok(s && inRect(q, edge) && Math.abs(q.x - (edge.x + edge.w)) < 0.5, `on the safe edge (${q.x.toFixed(1)} vs ${(edge.x + edge.w).toFixed(1)})`);
});

test('calm camera: atZoom keeps the framed box centred in the free rect at another zoom', () => {
  const pts = [{ x: 10, y: 0, z: 10 }, { x: 18, y: 1, z: 14 }];
  const f = framePoints(pts, VIEW, RECT);
  const g = atZoom(f, f.zoom * 0.8, VIEW, RECT);
  const s = pts.map((p) => screenPx(p, VIEW, g, g.zoom));
  near((Math.min(...s.map((q) => q.x)) + Math.max(...s.map((q) => q.x))) / 2, RECT.x + RECT.w / 2, 0.5, 'centred x');
  near((Math.min(...s.map((q) => q.y)) + Math.max(...s.map((q) => q.y))) / 2, RECT.y + RECT.h / 2, 0.5, 'centred y');
});

test('focus hysteresis: the man shown keeps the shot while he acts, FOCUS_MIN_MS; no ping-pong; idle or urgent: at once', () => {
  const man = (role, o = {}) => ({ kind: 'commando', role, alive: true, x: 0, z: 0, path: [[1, 1]], pendingAbility: null, currentAction: null, ...o });
  const gb = man('greenberet'), dv = man('diver'), k = new FocusKeeper();
  assert.equal(k.pick(gb, 0), gb, 'the first pick');
  assert.equal(k.pick(dv, 1000), gb, 'the Diver ordered 1 s later while the GB still walks: the GB keeps the shot');
  assert.equal(k.pick(gb, 1500), gb);
  assert.equal(k.pick(dv, FOCUS_MIN_MS + 1), dv, 'after FOCUS_MIN_MS: the Diver');
  assert.equal(k.pick(gb, FOCUS_MIN_MS + 800), dv, 'and not straight back to the GB (no ping-pong)');
  dv.path = null;
  assert.equal(k.pick(gb, FOCUS_MIN_MS + 900), gb, 'the Diver stopped: the GB at once (always action)');
  assert.equal(k.pick(dv, FOCUS_MIN_MS + 1000, { urgent: true }), dv, 'a kill, a blast: at once');
  dv.alive = false;
  assert.equal(k.pick(gb, FOCUS_MIN_MS + 1100), gb, 'a dead man gives the shot up');
  assert.equal(shotKey({ who: gb }), 'greenberet');
  assert.equal(shotKey({ who: { kind: 'enemy', tag: 'e19' } }), 'e19');
  assert.equal(shotKey({ key: 'blast', who: gb }), 'blast');
});

test('occluders: smoke, glass and other see-through meshes never hide a man', () => {
  const mat = (o = {}) => ({ transparent: false, opacity: 1, depthWrite: true, visible: true, ...o });
  assert.ok(!seeThrough({ name: 'wall', material: mat() }), 'a wall hides');
  assert.ok(seeThrough({ name: 'mesh_2', material: mat({ transparent: true, depthWrite: false }) }), 'no depth write (decal, snow film, smoke card)');
  assert.ok(seeThrough({ name: 'pane', material: mat({ transparent: true, opacity: 0.35 }) }), 'faint glass');
  assert.ok(seeThrough({ name: 'smoke_column', material: mat() }), 'smoke by name');
  assert.ok(!seeThrough({ name: 'roof', material: [mat(), mat({ transparent: true, depthWrite: false })] }), 'a solid part among see-through ones hides');
});

test('yaw: swung only once the men have been hidden YAW_PERSIST_MS, kept for the shot, back with a new framing', () => {
  const real = performance.now;
  let T = 10000;
  performance.now = () => T;
  try {
    const d = new Director({ game: {}, world: null });
    d._saved = { azimuth: 0 };
    d.yaw = { want: 0, cur: 0, v: 0, at: -1, since: -1e9 };
    let hiddenAt0 = true;
    // (the men are hidden from the player's yaw while `hiddenAt0`; -30° shows them)
    d._hidden = function* (pts, must, az) { yield; const h = Math.abs(az) < 1e-6 ? hiddenAt0 : false; this._menHidden = h ? 1 : 0; return h ? 3 : 0; };
    const check = () => { const g = d._yawCheck([{ x: 0, z: 0 }], 1, deg(50)); while (!g.next().done); };
    for (let t = 0; t < YAW_PERSIST_MS; t += 500) { T = 10000 + t; check(); assert.equal(d.yaw.want, 0, `${t} ms hidden: no swing yet`); }
    T = 10000 + YAW_PERSIST_MS; check();
    assert.equal(d.yaw.want, -30, 'hidden long enough: swung to the nearest offset that shows them');
    hiddenAt0 = false;
    for (let t = 1; t <= 10; t++) { T += 500; check(); }
    assert.equal(d.yaw.want, -30, 'nothing hidden any more: the swung yaw stays for the rest of the shot');
    d.yaw.shotAt = T; T += 500; check();
    assert.equal(d.yaw.want, 0, 'a new framing that the player\'s yaw shows in full: back to it');
  } finally { performance.now = real; }
});
