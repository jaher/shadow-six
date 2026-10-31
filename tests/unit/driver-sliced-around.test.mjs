/**
 * D.runSliced(it, around) (tools/solutions/driver.mjs): a check sliced over frames that changes the world while it runs
 * (sneak.mjs moversOff: the line-of-sight layer without the movers; the walkers' turns flag) puts the world back for
 * the frames between its slices — `around.leave()` before each pause, `around.enter()` after it — and once at the end;
 * aborted between two slices, the check's generator is closed (its own finally blocks run) and the world put back.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';
import { makeDriver, PLAN_SLICE_MS } from '../../tools/solutions/driver.mjs';

const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* busy */ } };
const sim = () => makeSim({ size: [20, 20], commandos: [{ role: 'greenberet', x: 5, z: 5 }], enemies: [] }, { brains: false });

test('runSliced around: the world as the check left it only inside its slices, put back for every pause and at the end', async () => {
  const s = sim(), log = [];
  let changed = false;
  const D = makeDriver(s.world, { step: () => s.step(), quiet: true, log: () => {}, pause: async () => { log.push(`pause:${changed}`); } });
  const around = { enter() { changed = true; log.push('enter'); }, leave() { changed = false; log.push('leave'); } };
  function* check() {
    for (let i = 0; i < 4; i++) { assert.ok(changed, 'inside a slice the world is the check\'s'); spin(PLAN_SLICE_MS * 0.8); yield; }
    return 42;
  }
  const r = await D.runSliced(check(), around);
  assert.equal(r, 42);
  assert.equal(changed, false, 'put back at the end');
  assert.ok(log.filter((x) => x.startsWith('pause')).length >= 1, 'it paused');
  assert.ok(log.every((x) => x !== 'pause:true'), `never paused with the world changed: ${log.join(' ')}`);
});

test('runSliced around: aborted between slices -> the generator closed (its finally ran) and the world put back', async () => {
  const s = sim();
  let changed = false, closed = false, stop = false;
  const D = makeDriver(s.world, { step: () => s.step(), quiet: true, log: () => {}, aborted: () => stop, pause: async () => { stop = true; } });
  const around = { enter() { changed = true; }, leave() { changed = false; } };
  function* check() {
    try { for (;;) { spin(PLAN_SLICE_MS * 0.8); yield; } } finally { closed = true; }
  }
  let threw = false;
  try { await D.runSliced(check(), around); } catch { threw = true; }
  assert.ok(threw, 'the abort surfaced');
  assert.ok(closed, 'the check\'s finally ran');
  assert.equal(changed, false, 'the world put back');
});

test('runSliced: without a pause hook (headless) one go, enter / leave once', async () => {
  const s = sim();
  let n = 0;
  const D = makeDriver(s.world, { step: () => s.step(), quiet: true, log: () => {} });
  function* check() { for (let i = 0; i < 3; i++) { spin(PLAN_SLICE_MS); yield; } return 'ok'; }
  const r = await D.runSliced(check(), { enter() { n++; }, leave() { n += 10; } });
  assert.equal(r, 'ok');
  assert.equal(n, 11);
});
