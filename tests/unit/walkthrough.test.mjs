/**
 * Debug VIDEO MODE walkthrough data (src/debug/walkthrough-data.js, docs/walkthrough-format.md): every
 * tools/solutions/<id>.walkthrough.mjs is checked against its solution (one chapter per stage, one step per
 * D.checkpoint, in play order) and its mission (commandos, guard tags, ids); `on` cues parse and match live events;
 * the step on screen follows the checkpoints; a solution without a walkthrough file gets one from its stages and
 * checkpoints; the dev server lists tools/solutions/ (`?ls`) for the catalog.
 *   node tests/unit/run.mjs walkthrough
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './lib.mjs';
import {
  parseOn, matchOn, orderAction, normalizeWalkthrough, currentStep, fallbackStep, checkpointIdsFromSource, missionIds,
  validateWalkthrough, cpId, chapterOf,
} from '../../src/debug/walkthrough-data.js';
import { catalogFromFiles } from '../../src/debug/solutions.js';
import { normalizeMission } from '../../src/missions/schema.js';
import { getMission } from '../../src/missions/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOL = join(ROOT, 'tools/solutions');

/** Validation context of mission `id` (its solution's stages and checkpoints, its commandos and ids). */
async function ctxOf(id) {
  const mod = await import(`../../tools/solutions/${id}.solution.mjs`);
  const def = normalizeMission(getMission(id), { quiet: true });
  return {
    id, stages: mod.STAGES.map(([sid, title]) => ({ id: sid, title })),
    checkpoints: checkpointIdsFromSource(readFileSync(join(SOL, `${id}.solution.mjs`), 'utf8')),
    roles: def.commandos.map((c) => c.role), ids: missionIds(def), def,
  };
}

const walkthroughFiles = () => readdirSync(SOL).filter((f) => f.endsWith('.walkthrough.mjs')).map((f) => f.replace('.walkthrough.mjs', ''));

test('walkthrough files: every one validates against its solution and its mission', async () => {
  const ids = walkthroughFiles();
  assert.ok(ids.includes('m03'), 'm03 has a walkthrough');
  const bad = [];
  for (const id of ids) {
    let ctx, wt;
    try { ctx = await ctxOf(id); } catch (e) { bad.push(`${id}: no solution / mission to check against (${e.message})`); continue; }
    try { wt = (await import(`../../tools/solutions/${id}.walkthrough.mjs`)).WALKTHROUGH; } catch (e) { bad.push(`${id}: ${e.message}`); continue; }
    for (const e of validateWalkthrough(wt, ctx)) bad.push(`${id}.walkthrough.mjs: ${e}`);
  }
  assert.ok(!bad.length, `\n  ${bad.join('\n  ')}`);
});

test('walkthrough files: every walkthrough has a solution; the catalog marks which solutions have one', () => {
  const names = readdirSync(SOL);
  const cat = catalogFromFiles(names);
  for (const id of walkthroughFiles()) assert.ok(cat.some((e) => e.id === id && e.walkthrough), `${id}.walkthrough.mjs without ${id}.solution.mjs`);
  assert.deepEqual(catalogFromFiles(['m03.solution.mjs', 'm03.walkthrough.mjs', 'm14.solution.mjs', 'driver.mjs', 'm03.cut.mjs', 'b00.solution.mjs']),
    [{ id: 'b00', walkthrough: false }, { id: 'm03', walkthrough: true }, { id: 'm14', walkthrough: false }]);
});

test('m03: the narration says who acts, chapters carry titles, every step names a checkpoint of the solution', async () => {
  const ctx = await ctxOf('m03');
  const { WALKTHROUGH: wt } = await import('../../tools/solutions/m03.walkthrough.mjs');
  const n = normalizeWalkthrough(wt, { id: 'm03', stages: ctx.stages });
  assert.equal(n.chapters.length, ctx.stages.length);
  assert.equal(typeof n.pitchAt, 'function');
  for (const s of n.steps) {
    assert.ok(s.chapter, `${s.cp} belongs to a chapter`);
    assert.ok(s.say.length >= 30, `${s.cp}: a real sentence`);
  }
  const acted = n.steps.filter((s) => s.who.length).length;
  assert.ok(acted >= n.steps.length * 0.7, `most steps name the acting commando (${acted}/${n.steps.length})`);
});

test('validation catches the usual mistakes', async () => {
  const ctx = await ctxOf('m03');
  const { WALKTHROUGH: good } = await import('../../tools/solutions/m03.walkthrough.mjs');
  assert.deepEqual(validateWalkthrough(good, ctx), []);
  const clone = () => ({ ...good, chapters: good.chapters.map((c) => ({ ...c })), steps: good.steps.map((s) => ({ ...s })) });
  const has = (w, re) => validateWalkthrough(w, ctx).some((e) => re.test(e));
  let w = clone(); w.steps.pop();
  assert.ok(has(w, /no step for checkpoint/));
  w = clone(); w.steps.push({ cp: 'Z9', say: 'Nothing happens here at all, really.' });
  assert.ok(has(w, /name no checkpoint/));
  w = clone(); [w.steps[0], w.steps[1]] = [w.steps[1], w.steps[0]];
  assert.ok(has(w, /out of play order/));
  w = clone(); w.steps[0] = { ...w.steps[0], who: 'sniper' };
  assert.ok(has(w, /not a commando of this mission/));
  w = clone(); w.steps[0] = { ...w.steps[0], look: ['e999'] };
  assert.ok(has(w, /unknown target/));
  w = clone(); w.steps[0] = { ...w.steps[0], cones: ['nobody'] };
  assert.ok(has(w, /unknown guard/));
  w = clone(); w.steps[0] = { ...w.steps[0], say: 'x'.repeat(300) };
  assert.ok(has(w, /at most 240/));
  w = clone(); w.steps[0] = { ...w.steps[0], beats: [{ on: 'greenberet decoy' }] };
  assert.ok(has(w, /not understood/));
  w = clone(); w.chapters.pop();
  assert.ok(has(w, /chapters must be the solution's stages/));
  w = clone(); w.version = 2;
  assert.ok(has(w, /version/));
});

test('on: cues parse and match live events', () => {
  assert.deepEqual(parseOn('greenberet:decoyToggle'), { kind: 'order', role: 'greenberet', action: 'decoyToggle', target: null });
  assert.deepEqual(parseOn('diver:harpoon>e2'), { kind: 'order', role: 'diver', action: 'harpoon', target: 'e2' });
  assert.deepEqual(parseOn('kill:e5'), { kind: 'kill', tag: 'e5' });
  assert.deepEqual(parseOn('objective:o1'), { kind: 'objective', id: 'o1' });
  assert.deepEqual(parseOn('state:e18:DISTRACTED'), { kind: 'state', tag: 'e18', state: 'DISTRACTED' });
  assert.deepEqual(parseOn('alarm:off'), { kind: 'alarm', on: false });
  for (const bad of ['', 'nobody:knife', 'greenberet', 'kill:', 'state:e1:lower']) assert.equal(parseOn(bad), null, bad);
  const ev = { kind: 'order', role: 'diver', action: 'harpoon', target: 'e2' };
  assert.ok(matchOn(parseOn('diver:harpoon'), ev) && matchOn(parseOn('diver:harpoon>e2'), ev));
  assert.ok(!matchOn(parseOn('diver:harpoon>e3'), ev) && !matchOn(parseOn('spy:harpoon'), ev) && !matchOn(parseOn('kill:e2'), ev));
  assert.ok(matchOn(parseOn('spy:move'), { kind: 'order', role: 'spy', action: 'crawl' }), "'move' matches any move order");
  assert.ok(!matchOn(parseOn('spy:run'), { kind: 'order', role: 'spy', action: 'move' }));
  assert.equal(orderAction({ stance: 'crawl' }, { type: 'move', x: 1, z: 1 }), 'crawl');
  assert.equal(orderAction({ stance: 'stand' }, { type: 'move', x: 1, z: 1, run: true }), 'run');
  assert.equal(orderAction({}, { type: 'ability', id: 'knife' }), 'knife');
});

test('the step on screen follows the checkpoints and the chapters', () => {
  const stages = [{ id: 'A', title: 'Stage A' }, { id: 'B', title: 'Stage B' }];
  const wt = normalizeWalkthrough({ version: 1, mission: 'mx', steps: [
    { cp: 'A1', say: 'one' }, { cp: 'A2', say: 'two' }, { cp: 'B1', say: 'three' }] }, { id: 'mx', stages });
  assert.deepEqual(wt.chapters.map((c) => c.title), ['Stage A', 'Stage B'], 'chapter titles default to the stage titles');
  assert.equal(currentStep(wt, 'A', []).cp, 'A1');
  assert.equal(currentStep(wt, 'A', ['A1']).cp, 'A2');
  assert.equal(currentStep(wt, 'A', ['A1', 'A2']).cp, 'A2', 'the tail of a chapter keeps its last step');
  assert.equal(currentStep(wt, 'B', ['A1', 'A2']).cp, 'B1');
  assert.equal(currentStep(wt, 'B', ['A1', 'A2', 'B1']).cp, 'B1');
  assert.equal(cpId('G2 charge one set'), 'G2');
  assert.equal(chapterOf('G2', [{ id: 'G' }, { id: 'H' }]), 'G');
  const f = fallbackStep('C3 Spy in uniform', wt.chapters.concat([{ id: 'C' }]));
  assert.equal(f.say, 'Spy in uniform');
  assert.equal(f.chapter, 'C');
  const none = normalizeWalkthrough(null, { id: 'm07', stages, missionTitle: 'Chase of the Wolves' });
  assert.ok(!none.hasFile && none.title === 'Chase of the Wolves' && none.steps.length === 0 && none.chapters.length === 2);
});

test('checkpoint ids come from the solution source in order; mission ids include tags and objects', () => {
  assert.deepEqual(checkpointIdsFromSource("D.checkpoint('A1 x'); await y; D.checkpoint(`A2 ${z}`); D.checkpoint(\"B1 q\")"), ['A1', 'A2', 'B1']);
  const ids = missionIds(normalizeMission(getMission('m03'), { quiet: true }));
  for (const k of ['e1', 'e18', 'e34', 'raft', 'dam_bunker', 'fence_switch', 'uniform_line', 'evac_truck', 'o1']) assert.ok(ids.has(k), k);
});

test('dev server: ?ls lists a directory as JSON (the catalog of tools/solutions/), files only', async () => {
  const { startServer } = await import('../../tools/serve.mjs');
  const s = await startServer({ port: 0 });
  try {
    const r = await fetch(`${s.url}tools/solutions/?ls`);
    assert.equal(r.status, 200);
    const names = await r.json();
    assert.ok(names.includes('m03.solution.mjs') && names.includes('m03.walkthrough.mjs') && names.includes('driver.mjs'));
    assert.ok(!names.some((n) => n.startsWith('.')));
    assert.equal((await fetch(`${s.url}tools/no-such-dir/?ls`)).status, 404);
    assert.equal((await fetch(`${s.url}tools/solutions/`)).status, 404, 'no listing without ?ls');
  } finally { await s.close(); }
});

test('solutions and walkthroughs load in the browser: no node-only import in them or in the tools/solutions files they import', () => {
  const seen = new Set();
  const bad = [];
  const scan = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src;
    try { src = readFileSync(join(SOL, file), 'utf8'); } catch { return; }
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (/^node:|^(fs|path|url|child_process|os)$/.test(spec)) bad.push(`${file} imports ${spec}`);
      else if (spec.startsWith('./')) scan(spec.slice(2));
    }
  };
  for (const f of readdirSync(SOL).filter((n) => /\.(solution|walkthrough)\.mjs$/.test(n))) scan(f);
  assert.ok(!bad.length, `\n  ${bad.join('\n  ')}`);
});
