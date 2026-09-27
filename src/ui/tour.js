/**
 * The Colonel's tactical tour (design-spec §6.6 part 2): stops on start, objectives, dangers and extraction,
 * each with a line of advice in our own words. Pure logic (unit-tested); a mission may override it with
 * `def.briefing.tour = [{x, z, text, kind?}]`.
 * @module ui/tour
 */

const DANGER_TYPES = new Set(['mg', 'sniper', 'officer', 'dog', 'tankcrew']);

function centroid(list) {
  const n = list.length || 1;
  return { x: list.reduce((a, u) => a + u.x, 0) / n, z: list.reduce((a, u) => a + u.z, 0) / n };
}

/**
 * @param {object} world live world (commandos, enemies, objectives, extraction)
 * @param {object} def normalized mission def
 * @returns {{kind:'start'|'objective'|'danger'|'extraction', x:number, z:number, text:string}[]}
 */
export function tourStops(world, def) {
  if (Array.isArray(def?.briefing?.tour) && def.briefing.tour.length) {
    return def.briefing.tour.map((s) => ({ kind: s.kind || 'objective', x: s.x, z: s.z, text: s.text || '' }));
  }
  const out = [];
  const team = (world?.commandos || []).filter((c) => c.alive !== false);
  const src = team.length ? team : def?.commandos || [];
  if (src.length) {
    const c = centroid(src);
    const n = src.length;
    out.push({ kind: 'start', ...c, text: `Officer, your ${n === 1 ? 'man goes' : `${n} men go`} in here. Keep them together until you know the ground.` });
  }
  const structs = def?.structures || [];
  for (const o of world?.objectives || def?.objectives || []) {
    if (o.hidden || o.type === 'escape') continue;
    const ids = o.targets || [];
    const t = ids.map((id) => structs.find((s) => s.id === id) || world?.interactables?.find?.((q) => q.id === id || q.tag === id)).find((s) => s && s.x != null);
    const at = t || (o.x != null ? o : null);
    if (at) out.push({ kind: 'objective', x: at.x, z: at.z, text: `Your objective: ${String(o.text || '').replace(/\.$/, '').toLowerCase()}. I have circled it in red.` });
  }
  const foes = (world?.enemies || []).filter((e) => e.alive !== false);
  const special = foes.filter((e) => DANGER_TYPES.has(e.soldierType || e.type));
  const pick = special.length ? special : foes;
  if (pick.length) {
    // densest cluster: the enemy with most neighbours within 12 m
    let best = pick[0], bestN = -1;
    for (const e of pick) {
      const k = foes.filter((f) => Math.hypot(f.x - e.x, f.z - e.z) < 12).length;
      if (k > bestN) {
        best = e;
        bestN = k;
      }
    }
    const around = foes.filter((f) => Math.hypot(f.x - best.x, f.z - best.z) < 12);
    const c = centroid(around);
    out.push({ kind: 'danger', ...c, text: `Watch this spot: ${around.length} ${around.length === 1 ? 'sentry covers' : 'guards cover'} it. Study their cones before you move.` });
  }
  const ex = world?.extraction || def?.extraction;
  if (ex && ex.x != null) out.push({ kind: 'extraction', x: ex.x, z: ex.z, text: 'When the job is done, every man comes back here. No one is left behind.' });
  return out;
}
