/**
 * Video mode: the Sniper's scope before every sniper shot (src/debug/walkthrough-scope.js; user 2026-10-22: "In the
 * walk-through we should see rhe sniper scope moving around before sniper hits target"):
 *  - the aim path: the scope comes up off the man, searches round him, settles on him (the lens marks him), keeps a
 *    breathing sway, the recoil throws it up with a flash after the shot, it comes down at the end; a second man is a swing;
 *  - the pace: only ever slowed (the same ticks, spread over more frames), so the shot lands SCOPE_SHOW.shot s of wall
 *    time after the scope came up in AUTO (showScale shorter at the faster fixed speeds), the clock eased back up after
 *    it; two shots in a row (M2's e4 then e5 1.1 s later) are one sequence; a jump (fast-forward) ends it at once.
 */
import { test, assert, near } from './lib.mjs';
import { SCOPE_SHOW, showScale, startOffset, searchPath, aimPath, hash01, ScopeShow } from '../../src/debug/walkthrough-scope.js';

const R = 36;

test('scope show: the time scale (AUTO and 1× full length, 4× shorter but kept visible)', () => {
  assert.equal(showScale('auto'), 1);
  assert.equal(showScale(1), 1);
  assert.equal(showScale(0.5), 1);
  near(showScale(2), 1 / Math.SQRT2, 1e-9);
  assert.equal(showScale(4), 0.55);
  assert.ok(SCOPE_SHOW.shot * showScale(4) >= 0.8, 'at 4× the scope is up at least 0.8 s before the shot');
});

test('scope show: the search starts off the man and ends on him, the lens marks him only once the reticle is on him', () => {
  for (const tag of ['e4', 'e5', 'b10', 'victim']) {
    const seed = hash01(tag);
    assert.ok(seed >= 0 && seed < 1);
    const from = startOffset(seed, R);
    near(Math.hypot(from.x, from.y), SCOPE_SHOW.startR * R, 1e-6, `${tag}: starts ${SCOPE_SHOW.startR} glass radii off him`);
    const seg = { kind: 'first', s0: 0, from, T: SCOPE_SHOW.find };
    const p0 = searchPath('first', from, R, seg.T, 0);
    near(p0.x, from.x, 1e-6); near(p0.y, from.y, 1e-6);
    const end = searchPath('first', from, R, seg.T, seg.T);
    assert.equal(end.x, 0); assert.equal(end.y, 0);
    // (continuous: no jump between two frames anywhere along the search)
    let prev = p0, maxStep = 0, minD = Infinity, lockedAt = null;
    for (let s = 1 / 60; s <= seg.T + 1e-9; s += 1 / 60) {
      const p = searchPath('first', from, R, seg.T, s);
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
      if (s < seg.T * 0.5) minD = Math.min(minD, Math.hypot(p.x, p.y));
      const a = aimPath(seg, s, R, 1, { seed });
      if (a.locked && lockedAt == null) lockedAt = s;
    }
    assert.ok(maxStep < 0.6 * R, `${tag}: a smooth sweep (largest step ${maxStep.toFixed(1)} px a frame)`);
    assert.ok(minD > SCOPE_SHOW.lock * R, `${tag}: the first half of the search does not sit on him (closest ${minD.toFixed(1)} px)`);
    assert.ok(lockedAt != null && lockedAt > 0.4 && lockedAt <= seg.T, `${tag}: on him by the end of the search (${lockedAt?.toFixed(2)} s)`);
  }
});

test('scope show: settled on him with a little breathing sway; the recoil kicks it up with a flash; then down', () => {
  const seed = hash01('e4');
  const seg = { kind: 'first', s0: 0, from: startOffset(seed, R), T: SCOPE_SHOW.find };
  // the settle: never more than a small part of the glass off him, never quite still
  const xs = [];
  for (let s = seg.T + 0.2; s < SCOPE_SHOW.shot; s += 1 / 60) { const a = aimPath(seg, s, R, 1, { seed }); xs.push(a); assert.ok(Math.hypot(a.x, a.y) < 0.3 * R, `settled at ${s.toFixed(2)}`); assert.ok(a.locked); }
  const spread = Math.max(...xs.map((a) => a.y)) - Math.min(...xs.map((a) => a.y));
  assert.ok(spread > 1 && spread < 0.3 * R, `a breathing sway (${spread.toFixed(1)} px)`);
  // the shot at 1.5 s: up the screen (negative y), a flash for SCOPE_SHOW.flash s, back on him within ~0.5 s
  const fired = SCOPE_SHOW.shot;
  const peak = Math.min(...Array.from({ length: 20 }, (_, i) => aimPath(seg, fired + i / 120, R, 1, { fired, seed }).y));
  assert.ok(peak < -0.5 * R, `the recoil throws the view up (${peak.toFixed(1)} px)`);
  assert.ok(aimPath(seg, fired + 0.01, R, 1, { fired, seed }).flash && !aimPath(seg, fired + SCOPE_SHOW.flash + 0.01, R, 1, { fired, seed }).flash, 'the muzzle flash, briefly');
  assert.ok(Math.abs(aimPath(seg, fired + 0.5, R, 1, { fired, seed }).y) < 0.25 * R, 'back on him as he falls');
  assert.ok(!aimPath(seg, 1.1, R, 1, { seed }).flash, 'no flash before the shot');
  // up and down
  const u0 = aimPath(seg, 0, R, 1, { up0: 0, seed }), u1 = aimPath(seg, SCOPE_SHOW.up + 0.01, R, 1, { up0: 0, seed });
  assert.ok(u0.scale < 0.9 && u1.scale === 1, 'the scope comes up: it grows into place');
  const d0 = 2.2, d1 = aimPath(seg, d0 + SCOPE_SHOW.drop, R, 1, { fired, drop: d0, seed });
  assert.ok(d1.y > 0.9 * R && d1.scale < 0.95, `and goes down at the end (${d1.y.toFixed(1)} px, ×${d1.scale.toFixed(2)})`);
});

test('scope show: a second man is a swing from where the scope is', () => {
  const from = { x: -420, y: 130 };
  const T = SCOPE_SHOW.swingFind;
  const half = searchPath('swing', from, R, T, T * 0.55);
  assert.ok(Math.hypot(half.x, half.y) < 0.3 * Math.hypot(from.x, from.y), 'most of the way over by half-time (a fast pan)');
  let over = 0;
  for (let s = T * 0.55; s < T; s += 1 / 120) { const p = searchPath('swing', from, R, T, s); over = Math.max(over, -(p.x * from.x + p.y * from.y) / Math.hypot(from.x, from.y)); }
  assert.ok(over > 0.1 * R && over < 0.5 * R, `a small overshoot past him (${over.toFixed(1)} px)`);
});

/** A walkthrough stand-in: the pacer, the world's events and clock, the cursor (the scripted scope's hook). */
function host({ speed = 'auto' } = {}) {
  const handlers = new Map();
  const events = { on: (n, f) => { (handlers.get(n) || handlers.set(n, []).get(n)).push(f); return () => {}; }, emit: (n, p) => { for (const f of handlers.get(n) || []) f(p); } };
  const world = { time: 100, events, commandos: [] };
  const wk = {
    world, stopped: false, paused: false, _held: () => false, speedSetting: speed,
    pacer: { speed: speed === 'auto' ? 1 : speed, boost: 1, turbo: false },
    game: { hud: { cursor: { scripted: null, setScripted(fn) { this.scripted = fn; } } } },
  };
  return { wk, world, events };
}

/**
 * Run frames of `dt` wall s: the pace `natural` set each frame (as the walkthrough's _pace / AUTO does), then the show's
 * cap; the clock advances by the capped rate (the ticks it grants), the solution's events fire at their game times.
 */
function play(h, show, { natural = 1, until, dt = 1 / 60, script = [] }) {
  const { wk, world, events } = h;
  const rows = [];
  let wall = 0;
  for (let i = 0; i < 2000 && !until(rows); i++) {
    wk.pacer.boost = (typeof natural === 'function' ? natural(i) : natural) / wk.pacer.speed;
    show.frame(dt);
    const rate = wk.pacer.speed * wk.pacer.boost;
    const t0 = world.time;
    world.time += rate * dt;
    wall += dt;
    for (const ev of script) if (!ev.done && world.time >= ev.t) { ev.done = true; ev.fn(); }
    rows.push({ wall, t: world.time, rate, on: show.on, s: show.s, t0 });
  }
  return rows;
}

test('scope show: AUTO — the shot lands ~1.5 s of wall time after the scope came up, at its own game time; eased back up', () => {
  const h = host();
  const show = new ScopeShow(h.wk);
  show.attach();
  assert.equal(typeof h.wk.game.hud.cursor.scripted, 'function', 'the cursor reads the scope from the show');
  const sn = { kind: 'commando', role: 'sniper', alive: true, currentActionId: null, _boltT: -1 };
  const e4 = { kind: 'enemy', tag: 'e4', x: 10, z: 10, alive: true };
  const tShot = 100 + 1 / 60 + SCOPE_SHOW.aim;
  show.order(sn, { type: 'ability', id: 'sniper', target: e4 });
  assert.ok(show.on, 'the order brings the scope up');
  let shotWall = null;
  const script = [
    { t: 100 + 1 / 60, fn: () => { sn.currentActionId = 'sniper'; h.events.emit('ability:start', { unit: sn, id: 'sniper', target: e4 }); } },
    { t: tShot, fn: () => { e4.alive = false; sn._boltT = h.world.time + 0.5; h.events.emit('shot', { shooter: sn, target: e4, weapon: 'sniper', hit: true }); } },
    { t: tShot + 0.1, fn: () => { sn.currentActionId = null; } },
  ];
  const rows = play(h, show, { natural: 2, script, until: (r) => r.length > 30 && !show.on });
  shotWall = rows.find((r) => r.t >= tShot)?.wall;
  assert.ok(Math.abs(shotWall - SCOPE_SHOW.shot) < 0.12, `the shot ${shotWall.toFixed(2)} s after the scope came up (want ${SCOPE_SHOW.shot})`);
  const total = rows[rows.length - 1].wall;
  assert.ok(total > 2.0 && total < 2.8, `the whole sequence ${total.toFixed(2)} s of wall time`);
  assert.ok(rows.every((r) => r.rate <= 2 + 1e-9), 'the pace is only ever slowed, never raised');
  assert.ok(rows.every((r) => r.rate >= SCOPE_SHOW.minRate - 1e-9), 'never stopped');
  // (the scope comes up at no more than 1× — a cut, as the camera's — then no step in the pace: a ramp on down into the
  // slow motion over a few frames and back up after the shot, within half an octave a frame)
  assert.ok(rows[0].rate <= SCOPE_SHOW.enter + 1e-9, `enters at ≤ ${SCOPE_SHOW.enter}× (${rows[0].rate.toFixed(2)})`);
  for (let i = 1; i < rows.length; i++) assert.ok(Math.abs(Math.log2(rows[i].rate / rows[i - 1].rate)) < 0.5, `smooth pace at ${rows[i].wall.toFixed(2)} s (${rows[i - 1].rate.toFixed(2)} → ${rows[i].rate.toFixed(2)})`);
  assert.ok(Math.abs(rows[rows.length - 1].rate - 2) < 0.15, `eased back up to the play's pace (${rows[rows.length - 1].rate.toFixed(2)})`);
  assert.deepEqual(show.log.map((e) => e.kind), ['up', 'aim', 'shot', 'drop', 'end']);
});

test('scope show: two shots in a row are one sequence swinging from the first man to the second (M2 e4, e5)', () => {
  const h = host();
  const show = new ScopeShow(h.wk);
  show.attach();
  const sn = { kind: 'commando', role: 'sniper', alive: true, currentActionId: null, _boltT: -1, pendingAbility: null };
  const e4 = { kind: 'enemy', tag: 'e4', x: 10, z: 10, alive: true }, e5 = { kind: 'enemy', tag: 'e5', x: 20, z: 18, alive: true };
  const t1 = 100 + 1 / 60 + SCOPE_SHOW.aim, t2o = t1 + 0.5 + 1 / 60, t2 = t2o + 1 / 60 + SCOPE_SHOW.aim;
  show.order(sn, { type: 'ability', id: 'sniper', target: e4 });
  const fire = (e) => () => { e.alive = false; sn._boltT = h.world.time + 0.5; h.events.emit('shot', { shooter: sn, target: e, weapon: 'sniper', hit: true }); };
  const start = (e) => () => { sn.currentActionId = 'sniper'; sn.pendingAbility = null; h.events.emit('ability:start', { unit: sn, id: 'sniper', target: e }); };
  const script = [
    { t: 100 + 1 / 60, fn: start(e4) }, { t: t1, fn: fire(e4) }, { t: t1 + 0.1, fn: () => { sn.currentActionId = null; } },
    { t: t2o, fn: () => { sn.pendingAbility = { id: 'sniper' }; show.order(sn, { type: 'ability', id: 'sniper', target: e5 }); } },
    { t: t2o + 1 / 60, fn: start(e5) }, { t: t2, fn: fire(e5) }, { t: t2 + 0.1, fn: () => { sn.currentActionId = null; } },
  ];
  const rows = play(h, show, { natural: 1, script, until: (r) => r.length > 30 && !show.on });
  const kinds = show.log.map((e) => e.kind);
  assert.deepEqual(kinds, ['up', 'aim', 'shot', 'swing', 'aim', 'shot', 'drop', 'end'], `one sequence (${kinds})`);
  assert.ok(rows.every((r) => r.on || r === rows[rows.length - 1]), 'the scope stays up from the first order to the end');
  const w1 = rows.find((r) => r.t >= t1).wall, w2o = rows.find((r) => r.t >= t2o).wall, w2 = rows.find((r) => r.t >= t2).wall;
  assert.ok(w2o - w1 >= SCOPE_SHOW.post * 0.6, `on the first man a moment after his shot (${(w2o - w1).toFixed(2)} s)`);
  assert.ok(Math.abs(w2 - w2o - SCOPE_SHOW.swingShot) < 0.15, `the second shot ~${SCOPE_SHOW.swingShot} s after its order (${(w2 - w2o).toFixed(2)} s)`);
  const total = rows[rows.length - 1].wall;
  assert.ok(total > 3 && total < 5.5, `both shots in ${total.toFixed(2)} s`);
});

test('scope show: at 4× shorter but visible; a jump ends it at once; an order never fired comes down', () => {
  {
    const h = host({ speed: 4 });
    const show = new ScopeShow(h.wk);
    show.attach();
    const sn = { kind: 'commando', alive: true, currentActionId: null, _boltT: -1 }, e = { kind: 'enemy', tag: 'e', x: 0, z: 0, alive: true };
    const tShot = 100 + 1 / 60 + SCOPE_SHOW.aim;
    show.order(sn, { type: 'ability', id: 'sniper', target: e });
    const script = [{ t: 100 + 1 / 60, fn: () => { sn.currentActionId = 'sniper'; h.events.emit('ability:start', { unit: sn, id: 'sniper', target: e }); } },
      { t: tShot, fn: () => { e.alive = false; sn._boltT = h.world.time + 0.5; h.events.emit('shot', { shooter: sn, target: e, weapon: 'sniper', hit: true }); } },
      { t: tShot + 0.1, fn: () => { sn.currentActionId = null; } }];
    // (the play's pace still the skip-waits boost — 4× × 4 — for its first frames: the order comes out of a wait)
    h.wk.pacer.budget = 90;
    const rows = play(h, show, { natural: (i) => (i < 15 ? 16 : 4), script, until: (r) => r.length > 10 && !show.on });
    assert.ok(h.wk.pacer.budget <= 4, `4×: no ticks carried from the wait run on (${h.wk.pacer.budget})`);
    const shotWall = rows.find((r) => r.t >= tShot).wall, total = rows[rows.length - 1].wall;
    assert.ok(shotWall > 0.7 && shotWall < 0.95, `4×: the shot ${shotWall.toFixed(2)} s after the scope came up (0.6 s of game at 4× would be 0.15 s)`);
    assert.ok(total < 1.8, `4×: the whole sequence ${total.toFixed(2)} s`);
  }
  {
    const h = host();
    const show = new ScopeShow(h.wk);
    const sn = { kind: 'commando', alive: true, currentActionId: null }, e = { kind: 'enemy', tag: 'e', x: 0, z: 0, alive: true };
    show.order(sn, { type: 'ability', id: 'sniper', target: e });
    show.frame(1 / 60);
    h.wk.pacer.turbo = true; // (a jump / a scrub / a skipped wait)
    h.wk.pacer.boost = 1;
    show.frame(1 / 60);
    assert.ok(!show.on, 'a jump ends it at once');
    assert.equal(h.wk.pacer.boost, 1, 'and leaves the jump its pace');
    show.order(sn, { type: 'ability', id: 'sniper', target: e });
    assert.ok(!show.on, 'nor does an order start it during a jump');
  }
  {
    const h = host();
    const show = new ScopeShow(h.wk);
    const sn = { kind: 'commando', alive: true, currentActionId: null }, e = { kind: 'enemy', tag: 'e', x: 0, z: 0, alive: true };
    show.order(sn, { type: 'ability', id: 'sniper', target: e });
    const rows = play(h, show, { natural: 1, until: (r) => r.length > 10 && !show.on });
    assert.ok(!show.on && rows.length < 1000, 'an order that never fires: the scope comes down');
    assert.ok(show.log.some((x) => x.kind === 'drop' && x.why === 'no shot'));
  }
  {
    const h = host();
    const show = new ScopeShow(h.wk);
    show.order({ kind: 'commando' }, { type: 'ability', id: 'knife', target: { x: 1, z: 1 } });
    show.order({ kind: 'commando' }, { type: 'move', x: 1, z: 1 });
    assert.ok(!show.on, 'only the rifle');
  }
});
