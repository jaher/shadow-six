#!/usr/bin/env node
/**
 * Z-fighting detector (GPU, headless, through the browser test harness). User: "Make sure there is no z-fighting in
 * the geometry". Loads each mission in the real game, hides the units and effects, and reports:
 *
 *   a  coplanar / near-coplanar same-facing faces of two different meshes or items overlapping where the player sees
 *      them (a crossing at a small angle fights in a band along the crossing line: its area is what counts);
 *   b  the same inside one mesh / merged geometry: doubled faces, a slab top flush on a box top, a roof on a wall top;
 *   c  flat meshes on the terrain (decals, discs, threshing floors, piazzas, puddles, paving, road / track ribbons,
 *      patches, shadow planes) within the depth noise of the RENDERED terrain under them (sampled densely: the
 *      terrain is not flat), after the material's own treatment (polygonOffset, draw order, lift);
 *   d  ground layers overlapping coplanar with each other;
 *   e  flicker seen in renders: a grid of views over the whole map at the default and the closest zoom, each rendered
 *      with depth-only camera changes (near, far, a slide along the view axis: no pixel can move, only depth ties
 *      re-roll), with a sub-pixel shift and a sub-degree yaw (each again with a near change), and a control render;
 *      units, effects and particles hidden, water masked; clusters of changing pixels on static surfaces (thin
 *      intersection lines filtered out), named by an id pass.
 * Every geometric finding (a–d) is then CONFIRMED at its own spot: the flicker test of e at its best yaws (the default
 * camera angle first) at a close zoom, counting the changing pixels within 8 px of its sample points. Confirmed ones
 * are findings; the rest are `latent` in findings.json (coincident faces that render the same — one material, one UV
 * —, hidden under snow or water, …: listed, not gating) and `offscreen` (where the camera clamp never lets the player
 * look, e.g. dressing deep in the apron).
 * The depth noise is computed from the camera's real near / far, the depth format, float32 vertex rounding and the
 * rasterizer's sub-pixel snapping × the surface's depth slope at the default and the closest zoom, then scaled by a
 * calibration measured on this GPU (quad pairs a known gap apart; `calibration` in findings.json).
 * Note: depthWrite:false + a later renderOrder does not resolve a decal flush on the terrain (the decal is still depth-
 * tested against the terrain; the calibration's `decal` row measures it); it does resolve two decals with each other.
 *
 *   CHROME=…/chrome-nv.sh node tools/art/zfight.mjs --mission e01[,e02] [--out DIR] [--allow FILE] [--strict]
 *       [--only a,b,c,d,e] [--shots 40] [--zooms 1,2] [--yaw 15] [--min-px 6] [--max-views N] [--no-calibrate]
 *   CHROME=… node tools/art/zfight.mjs --sandbox b00 --units tonino,grethe,grethe_aux [--clips idle,walk,run,throw_stone,smalltalk]
 *
 * Writes <out>/findings.json, a crop per finding (<out>/<mission>-<n>.png: left the game frame, right the same with the
 * flicker hits in red and the spot's sample points ringed; kind e also <n>-heat.png at 2× pixels; latent examples
 * <mission>-L<n>.png) and the contact sheet
 * <out>/zfight-<mission>.jpg (< 2 MB). Default --out: ../commandos-shots/expansion/zfight/<mission>/ (tests/out/zfight
 * without that folder). Allow-list: --allow FILE, else tools/art/zfight-allow.json + tools/art/zfight-allow.<mission>.json
 * ({entries: [{mission, a, b?, kind?, near?: [x, z], r?, reason}]}, the intersection-allow format). --strict exits 1 on
 * any unallowed finding (latent ones do not count). --confirm N caps the close looks (default 400). One browser, one
 * page at a time. Typical cost: m03 (344k triangles + 780k terrain) ≈ 3–6 min on the RTX host.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { startHarness } = await import(pathToFileURL(join(ROOT, 'tests/harness.mjs')).href);
const { matchAllow, severityOf } = await import(pathToFileURL(join(ROOT, 'tools/art/zfight-core.mjs')).href).catch(async () => {
  // (node without the 'three' import map: the core imports three; register the unit tests' resolve hook)
  const { register } = await import('node:module');
  register(pathToFileURL(join(ROOT, 'tests/unit/resolve-hooks.mjs')).href);
  return import(pathToFileURL(join(ROOT, 'tools/art/zfight-core.mjs')).href);
});

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);
const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
const sandbox = arg('sandbox', null);
const missions = sandbox ? [sandbox] : list(arg('mission', 'm03'));
const only = arg('only', null);
const nShots = +arg('shots', 40);
const minPx = +arg('min-px', 6);
const zooms = arg('zooms', null) ? list(arg('zooms')).map(Number) : null;
const yaw = arg('yaw', null) != null ? +arg('yaw') : null;
const maxViews = arg('max-views', null) != null ? +arg('max-views') : null;
const [vw, vh] = list(arg('viewport', '1280x800').replace('x', ',')).map(Number);
const VIEW = { width: vw, height: vh };
const shotsRoot = resolve(ROOT, '../commandos-shots');
const outFor = (id) => {
  const o = arg('out', null);
  if (o) return resolve(o.includes('<mission>') ? o.replace('<mission>', id) : missions.length > 1 ? join(o, id) : o);
  return resolve(ROOT, existsSync(shotsRoot) ? join(shotsRoot, 'expansion/zfight', sandbox ? `${id}-units` : id) : join('tests/out/zfight', id));
};
const kinds = only ? new Set(list(only)) : null;
const wantE = !kinds || kinds.has('e');
const wantGeo = !kinds || ['a', 'b', 'c', 'd'].some((k) => kinds.has(k));

function allowFor(id) {
  const files = arg('allow', null) ? [resolve(arg('allow'))] : [join(ROOT, 'tools/art/zfight-allow.json'), join(ROOT, `tools/art/zfight-allow.${id}.json`)];
  const entries = [];
  for (const f of files) if (existsSync(f)) entries.push(...(JSON.parse(readFileSync(f, 'utf8')).entries || []));
  const bad = entries.filter((e) => !e.reason);
  if (bad.length) console.warn(`allow-list: ${bad.length} entries without a reason are ignored`);
  return entries;
}

const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return '?'; } })();
const pngOut = (file, url) => writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
const near2 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

const side = (m) => (m ? { id: m.path, item: m.item, part: m.part, mesh: m.name, mat: (m.mats || []).join('+') } : { id: '?', item: '?' });

/** e clusters (per view) → merged spots; matched to geometric findings when within 2 m and naming the same item. */
function mergeFlicker(clusters, geo) {
  const spots = [];
  for (const c of clusters) {
    if (!c.point) continue;
    const pt = { x: c.point[0], y: c.point[1], z: c.point[2] };
    const names = new Set([...c.pairs.flatMap((p) => [p.a?.path, p.b?.path]), ...c.under.slice(0, 2).flatMap((u) => [u.m?.path])].filter(Boolean));
    let s = spots.find((x) => near2(x.point, pt) < 1.5 && (![...names].length || [...names].some((n) => x.names.has(n))));
    if (!s) { s = { point: pt, names: new Set(), clusters: [], hits: 0, best: null }; spots.push(s); }
    for (const n of names) s.names.add(n);
    s.clusters.push(c); s.hits += c.hits;
    if (!s.best || c.hits > s.best.hits) s.best = c;
  }
  const leftovers = [];
  for (const s of spots) {
    const bestPair = s.best.pairs[0], under = s.best.under[0]?.m;
    const sideNames = (f) => [f.a?.id?.replace(/#\d+$/, ''), f.b?.id?.replace(/#\d+$/, '')].filter(Boolean);
    // a grid cluster on one of a geometric finding's sample points (≤ 1 m, naming one of its meshes), or inside its box
    // on the same meshes, is that finding's flicker: kept as kind e only if the close look does not confirm the finding
    // (it may then be a neighbour's)
    const nearPts = (f, r) => (f.pts || [[f.point.x, f.point.y, f.point.z]]).some((p) => Math.hypot(p[0] - s.point.x, p[1] - s.point.y, p[2] - s.point.z) <= r);
    const inBox = (f, m) => f.box && [0, 1, 2].every((k) => { const v = [s.point.x, s.point.y, s.point.z][k]; return v >= f.box.min[k] - m && v <= f.box.max[k] + m; });
    const attach = geo.find((f) => nearPts(f, 1) && sideNames(f).some((n) => s.names.has(n))) || geo.find((f) => nearPts(f, 0.4))
      || geo.find((f) => inBox(f, 1) && sideNames(f).some((n) => s.names.has(n)));
    const flick = { hits: s.hits, views: s.clusters.length, zooms: [...new Set(s.clusters.map((c) => c.zoom))], maxHits: s.best.hits, crop: s.best.crop, point: s.point };
    if (attach && (!attach.flicker || attach.flicker.hits < flick.hits)) attach.flicker = flick;
    leftovers.push({
      kind: 'e',
      a: side(bestPair ? bestPair.a : under),
      b: bestPair ? side(bestPair.b) : { ...side(under), note: 'the same mesh (no other mesh won any flipped pixel)' },
      point: { x: s.point.x, y: s.point.y, z: s.point.z }, box: { min: [s.point.x - 0.5, s.point.y - 0.2, s.point.z - 0.5], max: [s.point.x + 0.5, s.point.y + 0.2, s.point.z + 0.5] },
      px: s.best.hits, hits: s.hits, views: s.clusters.length, zooms: flick.zooms, sources: [...new Set(s.clusters.map((c) => (c.src & 1 ? 'depth' : '') + (c.src & 2 ? '+jitter' : '')))],
      pairs: s.best.pairs.map((p) => `${p.a?.path} = ${p.b?.path} (${p.px})`), under: s.best.under.map((u) => `${u.m?.path ?? 'masked'} (${u.px})`),
      yaws: [s.best.yaw], heatCrop: s.best.crop, visible: true, looseOf: attach || null,
    });
  }
  return leftovers;
}

const h = await startHarness({ viewport: VIEW });
let strictFail = false;
try {
  for (const id of missions) {
    const t0 = Date.now();
    const OUT = outFor(id);
    mkdirSync(OUT, { recursive: true });
    for (const old of readdirSync(OUT).filter((f) => /^(.*-\d+(-heat)?\.png|zfight-.*\.jpg|unit-.*\.png)$/.test(f))) unlinkSync(join(OUT, old));
    const page = await h.newPage(VIEW);
    page.setDefaultTimeout(0);
    await h.openGame(page);
    await page.evaluate((m) => window.__game.loadMission(m), id);
    await page.evaluate(() => Promise.resolve(window.__game.game.mapHandle?.ready).then(() => true));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500); // a few real frames: deferred texture uploads, late script visuals
    await page.evaluate(() => window.__game.game.mapHandle?.gameplayReady).catch(() => {});
    const errs0 = h.errors(page).length;
    await page.evaluate(async () => { const Z = await import('/tools/art/zfight-page.mjs'); Z.prepare(window.__game.game); });
    const report = { mission: id, date: new Date().toISOString(), commit, tool: 'tools/art/zfight.mjs', viewport: VIEW };
    if (!flag('no-calibrate')) {
      report.calibration = await page.evaluate(async () => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.calibrate(window.__game.game); });
      const c = report.calibration;
      console.log(`${id}: calibration safety ×${c.safety} — ` + c.zooms.map((z) => `zoom ${z.zoom}: flips up to ${z.measuredMm} mm gap (${z.measuredDepthMm} mm of depth; model ${z.modelDepthMm}); `
        + `decal dw:false+ro shows ${Math.round(z.decal['depthWrite:false+renderOrder'].shown * 100)} %, +polygonOffset ${Math.round(z.decal['polygonOffset-1/-2+depthWrite:false'].shown * 100)} %`).join('; '));
    }
    if (sandbox) {
      // ------------------------------------------------------------ characters
      const units = list(arg('units', 'tonino,grethe'));
      const clips = arg('clips', null) ? list(arg('clips')) : undefined;
      const r = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.characters(window.__game.game, o); }, { units, clips, zooms: zooms || undefined, minPx: 4 });
      const findings = [], latentU = [];
      let n = 0;
      const tiles = [];
      for (const u of r.units) {
        for (const p of u.poses) {
          if (p.skipped) { console.log(`   ${u.type} ${p.clip}: skipped (${p.skipped})`); continue; }
          // (posed triangles in contact: confirmed only by the flicker test — the geometric ones are listed as latent)
          for (const g of p.geometric) latentU.push({ ...g, unit: u.type, clip: p.clip });
          for (const f of p.flicker) {
            n++;
            const file = join(OUT, `unit-${u.type}-${n}.png`);
            pngOut(file, f.crop);
            findings.push({ kind: 'e', unit: u.type, clip: p.clip, zoom: f.zoom, yaw: f.yaw, hits: f.hits, px: f.hits, pairs: f.pairs, shot: file, a: { id: f.pairs[0]?.a ?? '?', item: u.type }, b: { id: f.pairs[0]?.b ?? '?', item: u.type }, point: { x: 0, y: 0, z: 0 } });
            if (tiles.length < 48) tiles.push({ url: f.crop, caption: `${n} ${u.type} ${p.clip} yaw ${f.yaw} z${f.zoom}: ${f.hits} px ${f.pairs.map((q) => `${q.a.split('/').pop()}=${q.b.split('/').pop()}`).join(' ')}` });
          }
          for (const pt of p.portraits || []) {
            const file = join(OUT, `unit-${u.type}-${p.clip.split(' ')[0]}-yaw${pt.yaw}.png`);
            pngOut(file, pt.url);
            if (tiles.length < 60) tiles.push({ url: pt.url, caption: `${u.type} ${p.clip} yaw ${pt.yaw} zoom ${pt.zoom}`, color: '#aaa' });
          }
          console.log(`   ${u.type} (${u.character}) ${p.clip}: ${p.flicker.length} flicker clusters, ${p.geometric.length} coplanar contacts (latent); meshes ${p.meshes.length}: ${p.meshes.slice(0, 6).join(', ')}`);
        }
      }
      const allow = allowFor(id);
      for (const f of findings) { const al = matchAllow(allow, id, f); f.allowed = !!al; f.reason = al?.reason ?? null; }
      const bad = findings.filter((f) => !f.allowed);
      report.units = r.units.map((u) => ({ type: u.type, character: u.character, poses: u.poses.map((p) => ({ clip: p.clip, skipped: p.skipped, meshes: p.meshes, geometric: p.geometric?.length ?? 0, flicker: p.flicker?.length ?? 0, views: p.views })) }));
      report.findings = findings.map((f) => ({ ...f, crop: undefined }));
      report.latent = latentU;
      report.summary = { findings: findings.length, unallowed: bad.length, latent: latentU.length };
      writeFileSync(join(OUT, 'findings.json'), JSON.stringify(report, null, 1));
      if (tiles.length) {
        const url = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.sheet(o.tiles, o); }, { tiles, title: `z-fighting: ${units.join(', ')} in ${id} (${commit}): ${findings.length} flicker clusters`, cols: 6, tileW: 300, aspect: 1.25 });
        pngOut(join(OUT, `zfight-${id}-units.jpg`), url);
      }
      console.log(`${id} units: ${findings.length} findings (${bad.length} unallowed) in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${OUT}`);
      if (bad.length) strictFail = true;
      await page.close();
      continue;
    }
    // ------------------------------------------------------------ map: kinds a–d
    let geo = { findings: [], stats: {} };
    if (wantGeo) {
      geo = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.geometric(window.__game.game, o); }, { only: only || undefined, minPx, zooms: zooms || undefined });
      const s = geo.stats;
      console.log(`${id}: ${s.surfaces} surfaces, ${s.triangles} triangles (+${s.terrainTriangles} terrain), ${s.pairTests} pair tests, ${s.terrainSamples} terrain samples `
        + `in ${Object.entries(s.ms).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(', ')} → ${geo.findings.length} geometric findings (dropped: ${s.dropped.hidden} hidden, ${s.dropped.small} < ${minPx} px²)`);
      report.model = geo.model;
    } else {
      // still collect the geometry (world points of the flicker clusters)
      await page.evaluate(async () => { const Z = await import('/tools/art/zfight-page.mjs'); Z.geometric(window.__game.game, { only: 'x' }); });
    }
    // ------------------------------------------------------------ kind e
    let fl = { clusters: [], views: [], stats: {} };
    if (wantE) {
      fl = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.flicker(window.__game.game, o); }, { zooms: zooms || undefined, yaw: yaw ?? undefined, maxViews: maxViews ?? undefined });
      console.log(`${id}: flicker over ${fl.stats.views} views in ${(fl.stats.ms / 1000).toFixed(0)} s → ${fl.clusters.length} clusters`);
    }
    const geoF = [...geo.findings];
    const eF = mergeFlicker(fl.clusters, geoF);
    // every geometric finding is confirmed (or not) by the flicker test at its own spot: the grid scan's clusters, else a
    // close look at its best yaws. Unseen ones are latent (coincident faces that look the same, hidden, under water…).
    const todo = geoF;
    const t1 = Date.now();
    const conf = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.confirmAll(window.__game.game, o.fs, { cap: o.cap }); }, { fs: todo.map((f) => ({ ...f, flicker: undefined })), cap: +arg('confirm', 800) });
    todo.forEach((f, i) => { f.confirm = conf[i] ?? { status: 'unchecked' }; });
    const eKeep = eF.filter((e) => !(e.looseOf && e.looseOf.confirm?.status === 'confirmed'));
    for (const e of eF) { if (e.looseOf) e.near = `${e.looseOf.a.item} × ${e.looseOf.b.item} (${e.looseOf.kind}, ${e.looseOf.confirm?.status})`; delete e.looseOf; }
    for (const f of geoF) if (f.flicker && f.confirm.status !== 'confirmed') delete f.flicker; // (that flicker is reported as kind e)
    const findings = [...geoF.filter((f) => f.confirm.status === 'confirmed'), ...eKeep];
    const latent = geoF.filter((f) => f.confirm.status !== 'confirmed' && f.confirm.status !== 'offscreen');
    const offscreen = geoF.filter((f) => f.confirm.status === 'offscreen');
    console.log(`${id}: confirmed ${geoF.length - latent.length - offscreen.length} of ${geoF.length} geometric findings at their spot (${latent.length} latent, ${offscreen.length} off screen) in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
    const allow = allowFor(id);
    for (const f of [...findings, ...latent]) {
      f.mission = id;
      f.severity = Math.max(f.flicker?.hits ?? 0, f.confirm?.near ?? 0, f.kind === 'e' ? f.hits : 0) >= 40 ? 'high' : findings.includes(f) ? 'medium' : 'low';
      const al = matchAllow(allow, id, f);
      f.allowed = !!al; f.reason = al?.reason ?? null;
    }
    const rank = { high: 0, medium: 1, low: 2 };
    const score = (f) => Math.max(f.flicker?.hits ?? 0, f.confirm?.near ?? 0, f.hits ?? 0);
    findings.sort((p, q) => (p.allowed - q.allowed) || (rank[p.severity] - rank[q.severity]) || (score(q) - score(p)) || (q.px - p.px));
    latent.sort((p, q) => q.px - p.px);
    // ------------------------------------------------------------ crops + sheet
    const tiles = [];
    const shoot = async (f, label, file) => {
      const r = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.snap(window.__game.game, o.f, { label: o.label }); }, { f: { ...f, flicker: undefined, heatCrop: undefined }, label });
      pngOut(file, r.url);
      return r;
    };
    for (const [k, f] of findings.entries()) {
      f.n = k + 1;
      if (k >= nShots) continue;
      const r = await shoot(f, `#${f.n}`, join(OUT, `${id}-${f.n}.png`));
      f.shot = join(OUT, `${id}-${f.n}.png`);
      f.view = { hits: r.hits, near: r.near, yaw: r.yaw, zoom: r.zoom };
      const heat = f.heatCrop || f.flicker?.crop;
      if (heat) { const hf = join(OUT, `${id}-${f.n}-heat.png`); pngOut(hf, heat); f.heatShot = hf; }
      tiles.push({ url: 'data:image/png;base64,' + readFileSync(f.shot).toString('base64'), caption: `#${f.n} ${f.kind}${f.allowed ? ' (allowed)' : ''} ${f.a.item} ${f.a.mat ?? ''} × ${f.b.item} ${f.b.mat ?? ''}: flicker ${score(f)} px`, color: f.allowed ? '#8c8' : f.severity === 'high' ? '#f88' : '#ddd' });
    }
    for (const [k, f] of latent.entries()) {
      f.n = `L${k + 1}`;
      if (k >= +arg('latent-shots', 9)) continue;
      const file = join(OUT, `${id}-${f.n}.png`);
      const r = await shoot(f, f.n, file);
      f.shot = file; f.view = { hits: r.hits, near: r.near, yaw: r.yaw, zoom: r.zoom };
      tiles.push({ url: 'data:image/png;base64,' + readFileSync(file).toString('base64'), caption: `${f.n} latent ${f.kind} ${f.a.item} ${f.a.mat ?? ''} × ${f.b.item} ${f.b.mat ?? ''}: ${f.px} px², no flicker seen`, color: '#999' });
    }
    for (const f of [...findings, ...latent]) { delete f.heatCrop; if (f.flicker) delete f.flicker.crop; }
    const bad = findings.filter((f) => !f.allowed);
    const byKind = {};
    for (const f of bad) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    report.stats = { geometric: geo.stats, flicker: { ...fl.stats, views: fl.views } };
    report.summary = { findings: findings.length, unallowed: bad.length, byKind, high: bad.filter((f) => f.severity === 'high').length, latent: latent.length, offscreen: offscreen.length };
    report.findings = findings;
    report.latent = latent;
    report.offscreen = offscreen.map((f) => ({ kind: f.kind, a: f.a.id, b: f.b.id, point: f.point, px: f.px }));
    const errs = h.errors(page).slice(errs0);
    if (errs.length) report.pageErrors = errs.slice(0, 20);
    writeFileSync(join(OUT, 'findings.json'), JSON.stringify(report, null, 1));
    if (tiles.length) {
      const url = await page.evaluate(async (o) => { const Z = await import('/tools/art/zfight-page.mjs'); return Z.sheet(o.tiles, o); }, { tiles, title: `z-fighting in ${id} (${commit}): ${bad.length} unallowed ${JSON.stringify(byKind)}`, cols: 3, tileW: 600, aspect: 0.62 });
      pngOut(join(OUT, `zfight-${id}.jpg`), url);
    }
    console.log(`${id}: ${findings.length} findings, ${bad.length} unallowed ${JSON.stringify(byKind)}, ${latent.length} latent, in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${OUT}`);
    for (const f of bad.slice(0, 15)) console.log(`   #${f.n} [${f.severity}] ${f.kind}${f.exact ? ' (exact duplicate)' : ''} ${f.a.item} ${f.a.part ?? ''} ${f.a.mat ?? ''} × ${f.b.item} ${f.b.part ?? ''} ${f.b.mat ?? ''} at (${f.point.x}, ${f.point.y}, ${f.point.z}): ${f.px} px², flicker ${score(f)} px`);
    if (errs.length) console.log('   page errors:', errs.slice(0, 3).join(' | '));
    if (bad.length) strictFail = true;
    await page.close();
  }
} finally {
  await h.close();
}
process.exit(flag('strict') && strictFail ? 1 : 0);
