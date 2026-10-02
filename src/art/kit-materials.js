/**
 * Placeholder-art pass, catch-all: the primitive placeholder meshes that still have no dedicated kit model (U-boat
 * hulls, a battleship replica, bridge decks, set-piece decks …) keep their shapes but get the textured PBR finish of
 * their palette material (art/materials.js name → art/dressing.js set) with world-scale UVs, so nothing in a
 * mission draws as a flat-colour box. Shared geometry is cloned (the placeholders build their own per prop).
 * @module art/kit-materials
 */
import { dressingMaterial, boxUV } from './dressing.js';
import { paintedMaterial } from './kit-props.js';

/** Palette material name → [dressing set, paint colour?]. Glass, lamps, water, wire, black stay as they are. */
export const KIT_MATERIAL = {
  plaster: ['plaster'], plasterDark: ['plasterRough'], brick: ['brick'], roofTile: ['roofTerracotta'], roofTin: ['corrGalv'],
  roofTar: ['tarPaper'], wood: ['beam'], woodDark: ['beam'], planks: ['planks'], concrete: ['concrete'], stone: ['fieldstone'],
  rock: ['rock'], sandbag: ['burlap'], canvas: ['canvas'], metal: ['steel', 0x5a5e58], metalRust: ['corrRust'],
  olivePaint: ['steel', 0x56603f], greyPaint: ['steel', 0x6a6e68], fuelRed: ['steel', 0x7d2b20], tankCream: ['steel', 0xc4bba3],
  rail: ['castIron'], sleeper: ['creosote'], dirt: ['mud'], mud: ['mud'], bark: ['logs'], crater: ['mud', 0x4a4038],
};

/** Textured kit material for a palette material name, or null (keep it). */
export function kitMaterialFor(name) {
  const k = KIT_MATERIAL[name];
  if (!k) return null;
  return k[1] != null ? paintedMaterial(k[0], k[1]) : dressingMaterial(k[0]);
}

/**
 * Swap every palette-material mesh under `root` for its textured kit finish (world-scale UVs from the mesh's own
 * size). Instanced meshes and multi-material meshes are left alone. @returns {number} meshes changed
 */
export function kitify(root, tile = 2) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    const mat = kitMaterialFor(o.material?.name);
    if (!mat || !o.geometry?.attributes?.normal) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const sc = o.scale;
    if (sc.x !== 1 || sc.y !== 1 || sc.z !== 1) { // UVs in metres of the scaled mesh
      const t = g.clone(); t.scale(sc.x, sc.y, sc.z); boxUV(t, tile); g.setAttribute('uv', t.attributes.uv); t.dispose();
    } else boxUV(g, tile);
    g.parameters = o.geometry.parameters; // (tests read the primitive's dimensions)
    o.geometry = g;
    o.material = mat;
    n++;
  });
  return n;
}
