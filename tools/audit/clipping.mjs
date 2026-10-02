#!/usr/bin/env node
/**
 * Clipping / interpenetration audit (GPU headless, the browser test harness).
 *
 *   node tools/audit/clipping.mjs [--mission m01[,m02…]] [--dynamic 180] [--shots 6] [--clutter]
 *                                 [--seed 7] [--write-baseline] [--out docs/clipping] [--screens docs/screenshots]
 *
 * Per mission: static audit (every static render item pair, triangle-exact, see src/debug/clip-audit.js), turret
 * sweep (every turret over its arc), turret probe (tanks / armoured cars parked where they can drive beside every
 * wall, fence and building side, guns swept), floating props (flat bottoms vs the terrain) and dynamic audit
 * (`--dynamic` s of sim: patrols, vehicle routes, scripted commando moves along walls, bodies dropped next to
 * walls; 0 = off). Writes <out>/<mission>.json and 2×-zoom JPEG
 * crops of the worst unintended overlaps (<screens>/clip-<mission>-<kind><n>.jpg, ≤ 640×400).
 * --write-baseline merges the current static + turret unintended keys into tests/clip-baseline.json (accepted).
 * Default missions: m00 m01 m02 m03 b00.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const { diffBaseline } = await import(pathToFileURL(join(ROOT, 'src/debug/clip-rules.js')).href);

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);
const missions = String(arg('mission', 'm00,m01,m02,m03,b00')).split(',').filter(Boolean);
const dynSeconds = +arg('dynamic', 180);
const seed = +arg('seed', 7); // dynamic run's commando-move RNG (tests/clipping.test.mjs asserts seeds 7 and 11)
const nShots = +arg('shots', 6);
const OUT = resolve(ROOT, arg('out', 'docs/clipping'));
const SCREENS = resolve(ROOT, arg('screens', 'docs/screenshots'));
const BASELINE = join(ROOT, 'tests/clip-baseline.json');
mkdirSync(OUT, { recursive: true });
mkdirSync(SCREENS, { recursive: true });

const CROP_SIZE = { w: 640, h: 400 };
const VIEW = { width: 1280, height: 720 };

/** Mark the finding's contact box, render at 2× zoom centred on it and save the canvas centre (no HUD) as JPEG. */
async function crop(page, f, file) {
  const url = await page.evaluate(({ box, p, w, h }) => {
    const c = window.__game.clip;
    c.clearMarks(); c.mark(box);
    const u = c.snap(p, w, h);
    c.clearMarks();
    return u;
  }, { box: f.box, p: f.point, ...CROP_SIZE });
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  return relative(ROOT, file);
}

const fmt = (f) => `${f.a.cat}:${f.a.id} × ${f.b.cat}:${f.b.id} depth ${f.depth} m, contact ${f.contact} m${f.volume ? `, vol ${f.volume} m³` : ''}`
  + `${f.t != null ? ` @t=${f.t}s` : ''}${f.angleDeg != null ? ` @${f.angleDeg}°` : ''} (${f.point.x}, ${f.point.y}, ${f.point.z})`;

const h = await startHarness({ viewport: VIEW });
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { keys: [] };
const newKeys = new Set();
let failed = false;
try {
  for (const id of missions) {
    const t0 = Date.now();
    const page = await h.newPage(VIEW);
    await h.openGame(page);
    await page.evaluate((m) => window.__game.loadMission(m), id);
    await page.evaluate(() => Promise.resolve(window.__game.game.mapHandle?.ready).then(() => true)); // every mesh in
    await page.evaluate(() => window.__game.clipAudit());
    const st = await page.evaluate((clutter) => window.__game.clip.static({ clutter }), flag('clutter'));
    const tu = await page.evaluate(() => window.__game.clip.turrets());
    // turret probe (tanks / armoured cars parked beside every wall, fence and building side) + floating props
    const tp = await page.evaluate(() => window.__game.clip.turretProbe());
    const fl = await page.evaluate(() => window.__game.clip.floating());
    const bad = st.findings.filter((f) => !f.allowed);
    console.log(`${id}: ${st.items} items, ${st.pairsTested} pairs, ${st.findings.length} contacts, ${bad.length} unintended (${st.ms} ms); ${tu.turrets} turrets → ${tu.findings.length}`);
    for (const f of bad.slice(0, 8)) console.log('   ' + fmt(f));
    for (const f of tu.findings.slice(0, 4)) console.log('   turret ' + fmt(f));
    console.log(`   turret probe: ${tp.tests} parked guns at ${tp.spots} spots → ${tp.findings.filter((f) => f.depth > 0.05).length} overlaps > 5 cm; floating props: ${fl.findings.length} of ${fl.tested}`);
    for (const f of tp.findings.slice(0, 4)) console.log(`   probe ${f.probe} ${fmt(f)}`);
    for (const f of fl.findings.slice(0, 4)) console.log(`   ${f.kind} ${f.cat}:${f.id} gap ${f.gap} m (${f.x}, ${f.z})`);
    for (const f of [...bad, ...tu.findings]) newKeys.add(f.key);
    // crops of the worst static / turret findings (before the sim moves anything)
    for (const [k, f] of bad.slice(0, nShots).entries()) f.shot = await crop(page, f, join(SCREENS, `clip-${id}-s${k + 1}.jpg`));
    for (const [k, f] of tu.findings.slice(0, Math.min(3, nShots)).entries()) {
      await page.evaluate(({ tag, a }) => { const e = window.__game.game.world.entities.find((x) => `${x.tag ?? `${x.vehicleType}#${x.id}`}:turret` === tag); e?.model.setTurretHeading(a * Math.PI / 180 - e.heading); }, { tag: f.a.id, a: f.angleDeg });
      f.shot = await crop(page, f, join(SCREENS, `clip-${id}-t${k + 1}.jpg`));
    }
    let dyn = null;
    if (dynSeconds > 0) {
      await page.evaluate((s) => window.__game.clip.dynamicBegin({ seed: s }), seed);
      const tmp = new Map(); // key → temp crop of its worst moment so far
      let n = 0, last = 0;
      for (let t = 0; t < dynSeconds; t += 0.5) {
        const r = await page.evaluate(() => window.__game.clip.dynamicRun(0.5));
        for (const hit of r.hits) {
          if (hit.depth < 0.08 || n > 60) continue;
          const file = join(SCREENS, `.tmp-${id}-${n++}.jpg`);
          await crop(page, hit, file);
          if (tmp.has(hit.key)) try { unlinkSync(tmp.get(hit.key)); } catch { /* gone */ }
          tmp.set(hit.key, file);
        }
        if (r.t - last >= 30) { last = r.t; console.log(`   dynamic t=${r.t}s samples=${r.samples} overlaps=${r.found}`); }
        if (r.state !== 'playing') break;
      }
      dyn = await page.evaluate(() => window.__game.clip.dynamicEnd());
      console.log(`   dynamic: ${dyn.samples} samples over ${dyn.t} s → ${dyn.findings.length} penetrations > 5 cm${dyn.notes.length ? ' (' + dyn.notes.join('; ') + ')' : ''}`);
      for (const f of dyn.findings.slice(0, 6)) console.log('   dyn ' + fmt(f));
      const uo = dyn.unitOverlaps || [];
      console.log(`   units: ${uo.length} pairs closer than 0.6 m${uo.length ? ' — worst ' + uo.slice(0, 4).map((f) => `${f.a}/${f.b} ${f.dist} m @${f.t}s (${f.states.join('/')})`).join(', ') : ''}`);
      let k = 0;
      for (const f of dyn.findings) {
        const file = tmp.get(f.key);
        if (!file) continue;
        tmp.delete(f.key);
        if (k < nShots) { const dst = join(SCREENS, `clip-${id}-d${++k}.jpg`); renameSync(file, dst); f.shot = relative(ROOT, dst); } else unlinkSync(file);
      }
      for (const file of tmp.values()) try { unlinkSync(file); } catch { /* gone */ }
    }
    const diff = diffBaseline([...st.findings, ...tu.findings], baseline, id);
    if (diff.fresh.length) { failed = true; console.log(`   ${diff.fresh.length} NEW unintended overlaps (not in tests/clip-baseline.json)`); }
    if (diff.gone.length) console.log(`   ${diff.gone.length} baseline keys no longer found (fixed? prune): ${diff.gone.slice(0, 5).join(', ')}`);
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ mission: id, date: new Date().toISOString(), static: st, turrets: tu, turretProbe: tp, floating: fl, dynamic: dyn,
      baseline: { fresh: diff.fresh.map((f) => f.key), gone: diff.gone } }, null, 1));
    const errs = h.errors(page);
    if (errs.length) console.log('   page errors:', errs.slice(0, 3).join(' | '));
    await page.close();
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await h.close();
}
if (flag('write-baseline')) {
  const keep = (baseline.keys || []).filter((k) => !missions.some((m) => k.startsWith(m + ':')));
  const keys = [...new Set([...keep, ...newKeys])].sort();
  writeFileSync(BASELINE, JSON.stringify({ note: 'Accepted static/turret overlaps (tools/audit/clipping.mjs --write-baseline). Remove keys as they get fixed.', keys }, null, 1) + '\n');
  console.log(`baseline: ${keys.length} keys → ${relative(ROOT, BASELINE)}`);
  failed = false;
}
process.exit(failed ? 1 : 0);
