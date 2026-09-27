// Copied from scratchpad chars/enemies/web/enemy_variety.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// enemy_variety.js - deterministic variant assignment for the prebuilt enemy set (bible §5.2 neighbour rule), no deps.
// Each built GLB is a distinct man (archetype + jitter + proportion layer + tone + hair + glasses), so the hard rule is
// on the VARIANT: no two soldiers within `radius` m or in the same squad share one (any soldierType). Soft rule: inside
// a squad, archetypes differ too. Seeded order: FNV-1a(missionId:spawnId) -> mulberry32 shuffle, so saves/replays are stable.
export function fnv1a(str) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function assignEnemyVariants(missionId, spawns, variantsByType, { radius = 30 } = {}) {
  const out = new Map(); const used = new Map();
  const sorted = [...spawns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of sorted) {
    const vs = variantsByType[s.type]; if (!vs || !vs.length) continue;
    const near = sorted.filter(o => o !== s && out.has(o.id) && ((o.squad && o.squad === s.squad) || Math.hypot(o.x - s.x, o.z - s.z) < radius));
    const nearIds = new Set(near.map(o => out.get(o.id).id));
    const squadHeads = new Set(near.filter(o => o.squad && o.squad === s.squad).map(o => out.get(o.id).head));
    const r = mulberry32(fnv1a(`${missionId}:${s.id}`));
    const order = vs.map(v => [r(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    const byUse = (a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0);
    const pick = order.find(v => !nearIds.has(v.id) && !squadHeads.has(v.head))
      || order.find(v => !nearIds.has(v.id))
      || [...order].sort(byUse)[0];
    used.set(pick.id, (used.get(pick.id) || 0) + 1);
    out.set(s.id, pick);
  }
  return out;
}
