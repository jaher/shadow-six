// Copied from scratchpad chars/pipeline/web/variety.js by tools/characters/consolidate/copy_runtime.py (imports/URLs rewritten; moved to src/art/characters in art integration 2). CC0 project code.
// variety.js — deterministic enemy variant assignment (character-bible §5.2) over prebuilt variant GLBs.
// seed = FNV-1a(missionId:spawnId) -> mulberry32. Neighbour rule: no two soldiers within 30 m or in the same squad
// share a head variant (+ skin tone, facial hair, glasses key); up to 8 redraws, then least-used variant.
export function fnv1a(str) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// variants: [{id, key:'arch|tone|facialHair|glasses', ...}] for one soldierType (from the *.report.json enemy block)
// spawns: [{id, type, x, z, squad}] ; returns Map spawnId -> variant
export function assignVariants(missionId, spawns, variantsByType, { radius = 30 } = {}) {
  const out = new Map(); const used = new Map();
  const sorted = [...spawns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of sorted) {
    const vs = variantsByType[s.type]; if (!vs || !vs.length) continue;
    const near = sorted.filter(o => o !== s && out.has(o.id) && ((o.squad && o.squad === s.squad) || Math.hypot(o.x - s.x, o.z - s.z) < radius));
    const bad = (v) => near.some(o => { const w = out.get(o.id); return w.head === v.head || w.key === v.key; });
    let pick = null;
    for (let attempt = 0; attempt < 8 && !pick; attempt++) {
      const r = mulberry32(fnv1a(`${missionId}:${s.id}`) + attempt);
      const v = vs[Math.floor(r() * vs.length) % vs.length];
      if (!bad(v)) pick = v;
    }
    if (!pick) pick = [...vs].sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0)).find(v => !bad(v)) || vs[0];
    used.set(pick.id, (used.get(pick.id) || 0) + 1);
    out.set(s.id, pick);
  }
  return out;
}

// per-instance cosmetic variation that needs no extra GLB (bible §5.2 "uniform variation" + height/width)
export function instanceJitter(missionId, spawnId) {
  const r = mulberry32(fnv1a(`${missionId}:${spawnId}:jit`));
  return { heightScale: 0.97 + r() * 0.06, widthScale: 0.97 + r() * 0.07, clothTint: [0.94 + r() * 0.12, 0.94 + r() * 0.12, 0.94 + r() * 0.12] };
}
