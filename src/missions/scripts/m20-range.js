/**
 * M20 "Operation Valhalla": the firing line at practice (castle pass, user 2026-11-10: "shooting range with soldiers
 * actively shooting inside the castle"). Owned by MISSIONS; installed by scripts/m20.js on the 20 Hz tick.
 *
 * The range's riflemen (enemy spawns with `range: {pose, target, seed}`) hold their lanes — lying, kneeling or standing,
 * the rifle up at the target — and while the castle is calm (their brain IDLE at the post, no siren) each fires an aimed
 * round every few seconds (the shot's flash, report and the dust it kicks up in the backstop: the ordinary 'shot' event,
 * never a noise anyone hears) and works the bolt for a fresh clip every fifth. The NCO (`range.nco`) paces behind them,
 * his hands behind his back at his halts. A man sent to look, alarmed or fighting is a soldier like the rest: the
 * prone one gets up. The schedule is a function of the spawn's seed and the world clock (deterministic, headless too);
 * it is visual only (the sim reads none of it but the clip name the brain also sets, and the aim's weapon room, which
 * nothing in the open lanes engages).
 * @module missions/scripts/m20-range
 */

/** s between a rifleman's rounds (Kar 98k: aimed practice fire), the clip's five rounds, the reload. */
export const RANGE_GAP = [3.0, 6.4], RANGE_CLIP = 5, RANGE_RELOAD = 2.0;
/** Clips per pose (the enemies' kit): the hold while he aims, the round (and how long into it the shot goes), the reload. */
export const RANGE_POSE = {
  stand: { hold: 'rifle_aim', shoot: 'rifle_fire', shootT: 0.6, at: 0.0, reload: 'rifle_reload' },
  kneel: { hold: 'crouch_idle', shoot: 'kneel_shoot', shootT: 1.1, at: 0.35, reload: null },
  prone: { hold: null, shoot: 'shoot', shootT: 0.55, at: 0.0, reload: null },
};
/** The backstop the rounds kick up dust in: this far past the target along the lane. */
const PAST = 2.2;

/** Deterministic 0..1 from two integers (a small integer hash). */
export function h01(a, b) {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x9e37, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Is the rifleman `e` at practice: alive, his brain idle at his post, no siren? */
export function atPractice(e, w) {
  if (e.alive === false || e.removed) return false;
  const st = e.brain?.state;
  if (st != null && st !== 'IDLE') return false;
  if (w.alarm?.active) return false;
  const p = e.post;
  return !p || Math.hypot(p.x - e.x, p.z - e.z) < 0.7;
}

/** The round's report: the rifle's flash and bang down the lane, its dust in the backstop behind the target. */
function report(w, e, r) {
  const [tx, tz] = r.target, dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
  w.events?.emit?.('shot', { from: { x: e.x, z: e.z }, to: { x: tx + (dx / d) * PAST, z: tz + (dz / d) * PAST }, shooter: e, target: null, hit: false, weapon: e.weapon, practice: true });
}

/** One 20 Hz tick of the firing line. */
export function rangeTick(w) {
  const t = w.time ?? 0;
  for (const e of w.enemies || []) {
    const r = e.spawn?.range;
    if (!r || e.alive === false || e.removed) continue;
    const calm = atPractice(e, w);
    if (r.nco) {
      // (the brain sets 'idle' whenever he leaves an aware state; at his halts he stands at ease, hands behind him)
      if (calm && e.idleAnim !== 'idle_hands_back') e.idleAnim = 'idle_hands_back';
      else if (!calm && e.idleAnim === 'idle_hands_back') e.idleAnim = 'idle';
      continue;
    }
    const P = RANGE_POSE[r.pose] || RANGE_POSE.stand;
    if (!calm) {
      if (r.pose === 'prone' && e.stance === 'crawl') e.setStance?.('stand');
      if (P.hold && e.idleAnim === P.hold) e.idleAnim = 'idle';
      e._range = null;
      continue;
    }
    if (r.pose === 'prone') { if (e.stance !== 'crawl') e.setStance?.('crawl'); }
    else if (e.idleAnim !== P.hold) e.idleAnim = P.hold;
    const s = e._range || (e._range = { next: t + 1.2 + 4.5 * h01(r.seed ?? 1, 0), n: 0, shotAt: null });
    // (the report comes as the clip's recoil does: `at` s into the round's clip)
    if (s.shotAt != null && t >= s.shotAt) { s.shotAt = null; report(w, e, r); }
    if (t < s.next) continue;
    s.n++;
    if (s.n % (RANGE_CLIP + 1) === 0) {
      // a fresh clip: the bolt worked, five rounds pressed in (lying, he does it where he lies: no clip of his own)
      if (P.reload) e.playAction?.(P.reload, RANGE_RELOAD);
      s.next = t + RANGE_RELOAD + 1.0 + h01(r.seed ?? 1, s.n) * 1.5;
      continue;
    }
    if (P.shoot) e.playAction?.(P.shoot, P.shootT);
    if (P.at > 0) s.shotAt = t + P.at; else report(w, e, r);
    s.next = t + RANGE_GAP[0] + (RANGE_GAP[1] - RANGE_GAP[0]) * h01(r.seed ?? 1, s.n);
  }
}
