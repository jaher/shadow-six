/**
 * D.breathe (tools/solutions/driver.mjs; user 2026-10-21: "Good FPS, no delays, no long pauses"): a wait whose
 * predicate is several costly checks (M12's way to the car: 11 routeClear passes, 40-55 ms in one go between two
 * ticks) hands the frame back between two of them once the driver's own work since the last tick passed
 * PLAN_SLICE_MS — through makeDriver's `pause` (a later frame, no tick in between), so the answer and the ticks are
 * those of the unsliced wait. Without a `pause` (headless, tests) it never waits.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { makeDriver, PLAN_SLICE_MS } from '../../tools/solutions/driver.mjs';

const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* busy */ } };
const sim = () => makeSim({ size: [20, 20], commandos: [{ role: 'greenberet', x: 5, z: 5 }], enemies: [] }, { brains: false });

test('driver breathe: slow checks in an untilAsync pause between them, no tick in between, same ticks as until', async () => {
  const s = sim();
  let pauses = 0, ticks = 0;
  const D = makeDriver(s.world, { step: () => { ticks++; s.step(); }, quiet: true, log: () => {}, pause: async () => { pauses++; } });
  let calls = 0;
  await D.untilAsync(async () => {
    calls++;
    const t0 = ticks;
    for (let i = 0; i < 4; i++) { await D.breathe(); assert.equal(ticks, t0, 'no tick inside the predicate'); spin(PLAN_SLICE_MS * 0.6); }
    return calls >= 3;
  }, 5, 'slow checks');
  assert.equal(ticks, 2, 'the same ticks as an unsliced wait (two failed asks)');
  assert.ok(pauses >= 3, `the frame handed back between checks (${pauses} pauses)`);
});

test('driver breathe: never waits without a pause hook or within the slice', async () => {
  const s = sim();
  const D = makeDriver(s.world, { step: () => s.step(), quiet: true, log: () => {} });
  spin(PLAN_SLICE_MS * 2);
  const r = D.breathe();
  assert.ok(r && typeof r.then === 'function');
  await r;
  let pauses = 0;
  const D2 = makeDriver(s.world, { step: () => s.step(), quiet: true, log: () => {}, pause: async () => { pauses++; } });
  await D2.wait(1 / 60); // (a tick starts the slice)
  await D2.breathe();
  assert.equal(pauses, 0, 'fresh slice: no pause');
});

test('driver breathe: with the replay\'s frame count, the checks between the ticks of one frame share a slice', async () => {
  const run = async (withFrame) => {
    const s = sim();
    let frameNo = 0, ticks = 0, pauses = 0;
    // (the replay grants four 4× ticks per displayed frame; a pause hands the frame back: the next one)
    const D = makeDriver(s.world, {
      step: () => { if (++ticks % 4 === 0) frameNo++; s.step(); }, quiet: true, log: () => {},
      pause: async () => { pauses++; frameNo++; }, ...(withFrame ? { frame: () => frameNo } : {}),
    });
    let calls = 0;
    await D.untilAsync(async () => { await D.breathe(); spin(PLAN_SLICE_MS * 0.4); return ++calls >= 12; }, 5, 'checks every tick');
    return { pauses, ticks };
  };
  const a = await run(false), b = await run(true);
  assert.equal(a.pauses, 0, 'per tick: each check within its own slice');
  assert.ok(b.pauses >= 2, `per frame: the frame handed back once its checks passed the slice (${b.pauses} pauses)`);
  assert.equal(a.ticks, b.ticks, 'the same ticks either way');
});

test('driver breathe: the ticks themselves are not the slice\'s (slow ticks, cheap checks: no pause; a sliced plan after them runs on)', async () => {
  const s = sim();
  let frameNo = 0, ticks = 0, pauses = 0;
  // (a boosted fixed speed: many ticks a frame, each taking real time; between them a cheap check — and a sliced plan)
  const D = makeDriver(s.world, {
    step: () => { if (++ticks % 8 === 0) frameNo++; spin(PLAN_SLICE_MS * 0.3); s.step(); }, quiet: true, log: () => {},
    pause: async () => { pauses++; frameNo++; }, frame: () => frameNo,
  });
  let calls = 0;
  await D.untilAsync(async () => { await D.breathe(); return ++calls >= 16; }, 5, 'cheap checks');
  assert.equal(pauses, 0, `8 ticks a frame of ${(PLAN_SLICE_MS * 0.3).toFixed(1)} ms each: no pause for the checks (${pauses})`);
  // a plan of 4 pieces of PLAN_SLICE_MS / 4 after a frame of slow ticks: one slice, no pause
  await D.wait(7 / 60);
  function* plan() { for (let i = 0; i < 4; i++) { spin(PLAN_SLICE_MS / 4 - 0.2); yield; } return 1; }
  assert.equal(await D.runSliced(plan()), 1);
  assert.equal(pauses, 0, `the plan's own work fits its slice (${pauses} pauses)`);
});
