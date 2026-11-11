/**
 * The geometry gameplay measures, when it differs from the one drawn. A purely visual refinement of a mesh (the round
 * roofs of art/round-roofs.js: more segments on a true circle) must not move a nav stamp, a sight blocker, a solid or a
 * measured roof top by a hair: world/placement-visual.js reads the vertices and triangles of every structure (the cells a
 * building covers in a height band, its overhead cells, its convex hull, the tops it raycasts), and a 2 cm bulge at an eave
 * is enough to flip a 0.25 m raster cell. So the refined geometry registers the geometry it replaced here (cheap: it shares
 * the original's typed arrays), and the measuring code asks `gameplayGeometry(mesh.geometry)` — the same geometry object
 * for every mesh that never had a visual refinement, the authored one for those that did. Keyed by the drawn geometry
 * (a WeakMap: clones of a loaded scene share it, nothing to serialise in userData).
 * @module engine/gameplay-geometry
 */
const GAME = new WeakMap();

/** Register `game` (positions + index of the authored mesh) as what gameplay measures of the drawn geometry `drawn`. */
export function setGameplayGeometry(drawn, game) { GAME.set(drawn, game); }

/** The geometry gameplay measures for a drawn geometry: itself unless a refinement registered the authored one. */
export function gameplayGeometry(g) { return (g && GAME.get(g)) || g; }

/** Does this drawn geometry have a different gameplay geometry? */
export function hasGameplayGeometry(g) { return !!g && GAME.has(g); }
