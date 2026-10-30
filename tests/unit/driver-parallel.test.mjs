/**
 * D.parallel (tools/solutions/driver.mjs): two parties ordered at once, each in its own async flow. The world steps
 * once per tick whatever the number of flows waiting on it (a barrier: the flows share the ticks), in the same order
 * every time; the first error ends the other flows at their next tick; one flow alone ticks at once as before; with
 * two flows waiting, one wait's end leaves the other's label shown (video mode's "waiting" tag).
 */
import { test, assert } from './lib.mjs';
import { makeDriver } from '../../tools/solutions/driver.mjs';

function rig() {
  const w = { time: 0, tick: 0, events: { on: () => () => {} }, commandos: [], enemies: [], vehicles: [], objectives: [], interactables: [] };
  const labels = [];
  const D = makeDriver(w, { step: () => { w.time += 1 / 60; w.tick++; }, dt: 1 / 60, quiet: true, watch: false, log: () => {}, onWait: (l) => labels.push(l) });
  return { w, D, labels };
}

test('D.parallel: the flows share the ticks (one world step per tick, whoever waits)', async () => {
  const { w, D } = rig();
  const log = [];
  await D.parallel(
    async () => { await D.wait(1); log.push(['a', w.tick]); },
    async () => { await D.until(() => w.tick >= 30, 5); log.push(['b0', w.tick]); await D.wait(1); log.push(['b', w.tick]); },
  );
  assert.equal(w.tick, 90, 'max(60, 30 + 60) ticks, not their sum');
  assert.deepEqual(log, [['b0', 30], ['a', 60], ['b', 90]]);
  await D.wait(0.1);
  assert.equal(w.tick, 96, 'one flow again: it ticks at once');
});

test('D.parallel: the same order every run; same-tick actions in the order of the flows', async () => {
  const runs = [];
  for (let k = 0; k < 3; k++) {
    const { w, D } = rig();
    const log = [];
    await D.parallel(
      async () => { for (let i = 0; i < 5; i++) { await D.wait(0.05); log.push(`a${w.tick}`); } },
      async () => { for (let i = 0; i < 5; i++) { await D.wait(0.05); log.push(`b${w.tick}`); } },
    );
    runs.push(log.join(' '));
  }
  assert.equal(runs[0], runs[1]);
  assert.equal(runs[1], runs[2]);
  assert.ok(runs[0].startsWith('a3 b3 a6 b6'), runs[0]);
});

test('D.parallel: the first error ends the other flows and is thrown', async () => {
  const { w, D } = rig();
  let other = 'running';
  const err = await D.parallel(
    async () => { await D.wait(10 / 60); throw new Error('boom'); },
    async () => { try { await D.wait(100 / 60); other = 'finished'; } catch (e) { other = `stopped: ${e.message}`; throw e; } },
  ).then(() => null, (e) => e);
  assert.equal(err?.message, 'boom');
  assert.equal(other, 'stopped: boom');
  assert.ok(w.tick <= 11, `stopped at once (${w.tick} ticks)`);
  const t0 = w.tick;
  await D.wait(0.1);
  assert.equal(w.tick, t0 + 6, 'the driver ticks on afterwards (the error is not left standing)');
});

test('D.parallel: one flow\'s wait ending leaves the other\'s label shown', async () => {
  const { w, D, labels } = rig();
  await D.parallel(
    async () => { await D.until(() => w.tick >= 10, 5, 'a waits'); },
    async () => { await D.until(() => w.tick >= 20, 5, 'b waits'); },
  );
  const i = labels.lastIndexOf('a waits');
  assert.ok(i >= 0 && labels.includes('b waits'), labels.join('|'));
  // a's end (tick 10) shows b's label again, not null; b's end clears it
  assert.equal(labels.at(-1), null);
  assert.ok(labels.slice(labels.indexOf('b waits') + 1, -1).every((l) => l !== null), labels.join('|'));
});

test('one flow: a wait label is cleared to null as before', async () => {
  const { w, D, labels } = rig();
  await D.until(() => w.tick >= 5, 5, 'x');
  D.waitNote('note');
  await D.until(() => w.tick >= 10, 5, 'y');
  D.waitNote(null);
  assert.deepEqual(labels, ['x', null, 'note', 'y', null, null]);
});

test('D.parallel: a flow that hands the frame back while it plans keeps its turn (the logic run\'s order, live too)', async () => {
  const { w, D } = rig();
  const log = [];
  await D.parallel(
    async () => { for (let i = 0; i < 3; i++) { await D.wait(1 / 60); await new Promise((r) => setTimeout(r, 3)); log.push(`a${w.tick}`); } },
    async () => { for (let i = 0; i < 3; i++) { await D.wait(1 / 60); log.push(`b${w.tick}`); } },
  );
  assert.equal(log.join(' '), 'a1 b1 a2 b2 a3 b3');
});
