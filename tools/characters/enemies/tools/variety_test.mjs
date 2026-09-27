// variety_test.mjs - "any 30 soldiers generated with different seeds all look different" (bible §5.2 neighbour rule)
// node tools/variety_test.mjs  -> uses specs/*.json (same keys as out/enemies_index.json)
import fs from 'fs';
const vsrc = fs.readFileSync(new URL('../../pipeline/web/variety.js', import.meta.url));
const { instanceJitter } = await import('data:text/javascript,' + encodeURIComponent(vsrc));
const { assignEnemyVariants: assignVariants } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(new URL('../web/enemy_variety.js', import.meta.url))));
const dir = new URL('../specs/', import.meta.url).pathname;
const byType = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const s = JSON.parse(fs.readFileSync(dir + f)); const e = s.enemy;
  (byType[e.soldierType] ||= []).push({ id: s.id, head: e.archetype, key: e.key });
}
let worst = 0, tests = 0, fails = [];
for (let m = 1; m <= 20; m++) {
  for (const scen of ['cluster_rifle', 'cluster_mixed', 'spread']) {
    const types = ['rifleman', 'trooper', 'sentry', 'sergeant', 'mg', 'engineer', 'afrika', 'winter', 'crew', 'officer'];
    const allTypes = scen === 'cluster_rifle';
    const spawns = [];
    for (let i = 0; i < 30; i++) {
      const t = scen === 'cluster_rifle' ? 'rifleman' : types[(i * 7 + m) % types.length];
      const R = scen === 'spread' ? 120 : 10;
      spawns.push({ id: `s${String(i).padStart(2, '0')}`, type: t, x: Math.sin(i * 2.4 + m) * R, z: Math.cos(i * 1.7 + m) * R, squad: scen === 'spread' ? `q${i % 5}` : null });
    }
    const picks = assignVariants(`M${m}`, spawns, byType);
    // "look different": same type within 30 m or same squad must not share a variant (face+tone+hair+glasses)
    let dup = 0;
    for (const a of spawns) for (const b of spawns) if (a.id < b.id && ((a.squad && a.squad === b.squad) || Math.hypot(a.x - b.x, a.z - b.z) < 30) && picks.get(a.id).id === picks.get(b.id).id) dup++;
    // whole-set distinctness: variant + height/width/cloth jitter (rounded) as the visual signature
    const sig = new Set(spawns.map(s => { const j = instanceJitter(`M${m}`, s.id); return picks.get(s.id).id + '|' + j.heightScale.toFixed(2); }));
    tests++; worst = Math.max(worst, dup);
    if (dup || sig.size < 30) fails.push(`M${m} ${scen}: ${dup} neighbour duplicates, ${sig.size}/30 distinct signatures`);
  }
}
console.log('types', Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])));
console.log(`${tests} scenarios x 30 soldiers; worst neighbour duplicates ${worst}; failures ${fails.length}`);
fails.slice(0, 10).forEach(f => console.log('  ' + f));
