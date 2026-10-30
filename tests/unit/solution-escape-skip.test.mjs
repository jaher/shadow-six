/**
 * §7.6 ESC skip in solution drivers (D.skipEscape): a solution that ends as a player would — everyone aboard the escape
 * vehicle, ESC to skip its drive-off (M4: the patrol boat would sail past the SW shore in plain view) — must end the
 * same way wherever it is played: the headless sim, the browser logic run, the debug replay and its walkthrough video
 * mode, the film capture, the trail and perf tools. A driver without the hook answers false, and M4's last wait used to
 * throw after 5 s there (the drive-off takes ~16 s).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import { headlessMission, headlessDriver } from '../../tools/solutions/headless.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** M4 headless with the villa down and every man aboard the moored patrol boat */
function loaded(s) {
  const w = s.world, boat = w.vehicles.find((v) => v.vehicleType === 'patrolboat');
  for (const o of w.objectives) if (o.id !== 'o3') o.done = true;
  for (const c of w.commandos) assert.ok(boat.enter(c), `${c.role} boards`);
  return { w, boat };
}

test('headless: the M4 boat\'s drive-off is skipped once it pulls away (escape done the next tick); not before', () => {
  const s = headlessMission('m04');
  assert.equal(typeof s.skipEscape, 'function');
  assert.equal(s.skipEscape(), false, 'nothing is driving off yet');
  const { w, boat } = loaded(s);
  for (let i = 0; i < 3 && !(boat.goal || boat.path); i++) s.step(); // (adopted as the escape vehicle, then loaded)
  assert.ok(boat.goal || boat.path, 'loaded: the boat pulls away');
  assert.equal(w.objectives.find((o) => o.id === 'o3').done, false);
  assert.equal(s.skipEscape(), true, 'ESC skips the drive');
  s.step();
  assert.equal(w.objectives.find((o) => o.id === 'o3').done, true, 'escaped');
  assert.equal(s.skipEscape(), false, 'only once');
});

test('headless driver: D.skipEscape() is the sim\'s hook (not the bare false of a driver without one)', async () => {
  const D = await headlessDriver('m04', { quiet: true, log: () => {}, watch: false });
  const { w, boat } = loaded(D.sim);
  for (let i = 0; i < 3 && !(boat.goal || boat.path); i++) D.sim.step();
  assert.equal(D.skipEscape(), true);
  D.sim.step();
  assert.equal(w.objectives.find((o) => o.id === 'o3').done, true);
});

test('every driver that plays a solution in a game passes the ESC skip (logic run, replay + walkthrough video, film, trail, perf)', () => {
  const files = ['tools/solutions/run-browser.mjs', 'src/debug/solution-replay.js', 'tools/solutions/capture-video.mjs', 'tools/solutions/trail.mjs',
    'tools/solutions/headless.mjs', 'tools/perf/cold-trace.mjs', 'tools/perf/sim-trace.mjs', 'tools/perf/driver-gaps.mjs', 'tests/m04-solution.test.mjs'];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const calls = src.split(/makeDriver\(/).length - 1, hooks = src.split(/skipEscape:/).length - 1;
    assert.ok(calls >= 1, `${f}: plays a solution`);
    assert.ok(hooks >= calls, `${f}: ${calls} driver(s), ${hooks} ESC hook(s)`);
  }
});

test('M4 ends with the ESC skip, falling back to the real drive-off where no hook is wired (no 5 s throw)', () => {
  const src = readFileSync(join(ROOT, 'tools/solutions/m04.solution.mjs'), 'utf8');
  const i = src.indexOf("D.checkpoint('J6");
  assert.ok(i > 0);
  const tail = src.slice(i, i + 600);
  assert.ok(/D\.skipEscape\(\) \|\| objective\(D, 'o3'\), 25/.test(tail), 'skip tried for up to 25 s: the boat\'s own drive-off (~16 s) ends it otherwise');
});
