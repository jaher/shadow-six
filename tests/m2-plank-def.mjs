/** Shared by the unit and browser gate-smash tests (no node imports: the browser loads it too). */

/**
 * M2 with the two-leaf plank gate swapped in for the boom barrier, in its old 4 m palisade opening (the plank tests).
 */
export function m2PlankDef(def0) {
  const g = def0.structures.find((x) => x.id === 'gate_se');
  return { ...def0, structures: def0.structures.map((x) => {
    if (x.id === 'gate_se') return { ...x, look: 'palisade_double', gap: undefined };
    if (x.id !== 'camp_wall') return x;
    const [seg] = x.segments, [a, b] = seg, L = Math.hypot(b[0] - a[0], b[1] - a[1]), se = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const r2 = (v) => +v.toFixed(2), half = g.w / 2;
    const s0 = [[r2(g.x + se[0] * half), r2(g.z + se[1] * half)], ...seg.slice(1, -1), [r2(g.x - se[0] * half), r2(g.z - se[1] * half)]];
    return { ...x, segments: [s0, ...x.segments.slice(1)] };
  }) };
}
