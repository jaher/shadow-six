/**
 * Game-grid integration: turn the nav grid's water cells (terrain T.WATER = 5 deep, T.SHALLOW = 6) into water bodies.
 * One body per 4-connected component; its outline is the exact cell mask (mask(x,z) + bounding polygon), the bed
 * comes from the top-down capture of the terrain mesh (or the depth heuristic), the current from mission.water.
 *
 *   for (const b of waterBodiesFromGrid(grid, mission)) water.addBody(b);
 *
 * @param {{cols:number, rows:number, terrain:Uint8Array}} grid  nav grid (CELL = 0.5 m, see docs/ARCHITECTURE.md)
 * @param {{water?:{velocity:number, angleDeg:number, turbulence?:number}|null, theater?:string, size?:number[]}} mission
 * @param {{cell?:number, level?:number, deepDepth?:number, shallowDepth?:number, minCells?:number, preset?:string}} [o]
 * @returns {object[]} addBody() descriptors
 */
export function waterBodiesFromGrid(grid, mission = {}, o = {}) {
  const cell = o.cell ?? 0.5, { cols, rows, terrain } = grid;
  const isW = (k) => terrain[k] === 5 || terrain[k] === 6;
  const comp = new Int32Array(cols * rows).fill(-1), out = [];
  const stack = [];
  for (let k0 = 0; k0 < cols * rows; k0++) {
    if (!isW(k0) || comp[k0] >= 0) continue;
    const id = out.length; let minI = cols, minJ = rows, maxI = 0, maxJ = 0, n = 0, edge = false, deep = 0;
    comp[k0] = id; stack.push(k0);
    while (stack.length) {
      const k = stack.pop(), i = k % cols, j = (k / cols) | 0; n++;
      if (terrain[k] === 5) deep++;
      minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) edge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
        const q = b * cols + a; if (isW(q) && comp[q] < 0) { comp[q] = id; stack.push(q); }
      }
    }
    out.push({ id, minI, minJ, maxI, maxJ, n, edge, deep });
  }
  const W = mission.water, flowing = W && W.velocity > 0;
  return out.filter((c) => c.n >= (o.minCells ?? 8)).map((c) => {
    const x0 = c.minI * cell, z0 = c.minJ * cell, x1 = (c.maxI + 1) * cell, z1 = (c.maxJ + 1) * cell;
    const sea = c.edge && (mission.theater === 'coast' || c.n > 0.25 * cols * rows);
    const type = o.type ?? (sea ? 'sea' : flowing ? 'river' : 'lake');
    const a = W ? (W.angleDeg || 0) * Math.PI / 180 : 0;
    return {
      type, level: o.level ?? 0, preset: o.preset,
      polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
      mask: (x, z) => { const i = Math.floor(x / cell), j = Math.floor(z / cell);
        return i >= 0 && j >= 0 && i < cols && j < rows && comp[j * cols + i] === c.id; },
      depth: c.deep > c.n * 0.2 ? (o.deepDepth ?? 2.5) : (o.shallowDepth ?? 0.8),
      bankWidth: mission.shoreShallowWidth ?? 2,
      flow: type === 'river' && flowing ? { dir: [Math.cos(a), Math.sin(a)], speed: W.velocity } : undefined,
      foam: W && W.turbulence != null ? 0.6 + W.turbulence : undefined,
    };
  });
}
