/**
 * Per-theater colour grade → 3D LUT (design-spec §2.4 "AgX tone mapping, then a per-theater 3D LUT";
 * realism-pipeline §3.4 "Grading"). The LUT is display-referred: it runs after OutputPass (tone mapping +
 * sRGB encode), on sRGB values in [0,1], like a .cube from Resolve.
 *
 * GRADES holds the parameters per LUT id (missions name one via `lighting.lut`); bakeLUTData() evaluates
 * gradeColor() on an N³ lattice. tools/render/bake-luts.mjs writes the same lattices to assets/luts/<id>.cube
 * so artists can refine them in a grading tool; a mission may then name a `.cube` path instead of an id.
 * Targets (BEL measured palette): average saturation ~0.15–0.35, midtones ~0.3–0.5; saturated colour is
 * reserved for flags, fire, blood and UI markers.
 * @module engine/grade
 */

/**
 * Grade parameters (all optional):
 *  wb [r,g,b] white-balance gains · lift [r,g,b] (adds to shadows) · gamma (>1 brightens mids) ·
 *  gain [r,g,b] · contrast (around pivot 0.46) · saturation · shadowTint / highlightTint [r,g,b] split tone
 *  (added, weighted by (1−luma)² / luma²) · vibrance (<0 tames already-saturated colours more)
 */
export const GRADES = {
  neutral: {},
  norway: { wb: [0.99, 1.0, 1.02], lift: [0.012, 0.014, 0.022], gamma: 1.02, gain: [1.0, 1.0, 1.0], contrast: 1.06, saturation: 0.86, shadowTint: [-0.01, 0.0, 0.018], highlightTint: [0.008, 0.004, -0.004], vibrance: -0.15 },
  temperate: { wb: [1.01, 1.0, 0.98], lift: [0.012, 0.012, 0.01], gamma: 1.0, gain: [1.0, 0.99, 0.96], contrast: 1.07, saturation: 0.82, shadowTint: [-0.004, 0.004, 0.006], highlightTint: [0.012, 0.006, -0.01], vibrance: -0.2 },
  frost: { wb: [0.98, 1.0, 1.03], lift: [0.014, 0.016, 0.022], gamma: 1.0, gain: [0.98, 0.99, 1.0], contrast: 1.05, saturation: 0.72, shadowTint: [-0.008, 0.0, 0.016], highlightTint: [0.0, 0.0, 0.004], vibrance: -0.25 },
  coast: { wb: [0.99, 1.0, 1.0], lift: [0.01, 0.014, 0.016], gamma: 1.0, gain: [1.0, 1.0, 0.98], contrast: 1.06, saturation: 0.84, shadowTint: [-0.01, 0.006, 0.01], highlightTint: [0.01, 0.006, -0.006], vibrance: -0.15 },
  desert: { wb: [1.02, 1.0, 0.96], lift: [0.014, 0.01, 0.006], gamma: 0.98, gain: [1.0, 0.98, 0.94], contrast: 1.1, saturation: 0.84, shadowTint: [0.0, -0.002, 0.008], highlightTint: [0.016, 0.008, -0.012], vibrance: -0.2 },
  urban: { wb: [1.01, 1.0, 0.98], lift: [0.012, 0.01, 0.008], gamma: 1.0, gain: [1.0, 0.99, 0.96], contrast: 1.12, saturation: 0.86, shadowTint: [0.0, 0.0, 0.008], highlightTint: [0.012, 0.006, -0.008], vibrance: -0.15 },
  dawn: { wb: [1.04, 1.0, 0.94], lift: [0.016, 0.012, 0.018], gamma: 1.0, gain: [1.0, 0.97, 0.9], contrast: 1.05, saturation: 0.85, shadowTint: [-0.006, 0.0, 0.016], highlightTint: [0.02, 0.008, -0.014], vibrance: -0.1 },
  night: { wb: [0.9, 0.98, 1.1], lift: [0.006, 0.01, 0.022], gamma: 1.04, gain: [0.92, 0.96, 1.0], contrast: 1.04, saturation: 0.6, shadowTint: [-0.01, 0.0, 0.02], highlightTint: [0.01, 0.006, 0.0], vibrance: -0.2 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Apply a grade to one display-referred sRGB colour (in/out [0,1]). Pure; also used by unit tests.
 * @param {number[]} rgb @param {object} g grade params @param {number[]} [out]
 */
export function gradeColor(rgb, g, out = [0, 0, 0]) {
  let r = rgb[0], gg = rgb[1], b = rgb[2];
  const wb = g.wb || [1, 1, 1], lift = g.lift || [0, 0, 0], gain = g.gain || [1, 1, 1];
  const gamma = g.gamma ?? 1, contrast = g.contrast ?? 1, sat = g.saturation ?? 1, vib = g.vibrance ?? 0;
  r *= wb[0]; gg *= wb[1]; b *= wb[2];
  // lift / gain (CDL-like), then gamma on mids
  r = gain[0] * (r + lift[0] * (1 - r)); gg = gain[1] * (gg + lift[1] * (1 - gg)); b = gain[2] * (b + lift[2] * (1 - b));
  if (gamma !== 1) { r = Math.pow(Math.max(r, 0), 1 / gamma); gg = Math.pow(Math.max(gg, 0), 1 / gamma); b = Math.pow(Math.max(b, 0), 1 / gamma); }
  // contrast around a mid-grey pivot
  const P = 0.46;
  r = (r - P) * contrast + P; gg = (gg - P) * contrast + P; b = (b - P) * contrast + P;
  // saturation (+ vibrance: extra desaturation proportional to the existing chroma)
  const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  const chroma = Math.max(r, gg, b) - Math.min(r, gg, b);
  const s = Math.max(0, sat * (1 + vib * clamp01(chroma * 2)));
  r = l + (r - l) * s; gg = l + (gg - l) * s; b = l + (b - l) * s;
  // split toning
  const st = g.shadowTint, ht = g.highlightTint;
  const lc = clamp01(l);
  if (st) { const w = (1 - lc) * (1 - lc); r += st[0] * w; gg += st[1] * w; b += st[2] * w; }
  if (ht) { const w = lc * lc; r += ht[0] * w; gg += ht[1] * w; b += ht[2] * w; }
  out[0] = clamp01(r); out[1] = clamp01(gg); out[2] = clamp01(b);
  return out;
}

/** @returns {object} grade params for an id (unknown → neutral). */
export function gradeFor(id) {
  return GRADES[id] || GRADES.neutral;
}

/**
 * Evaluate a grade on an N³ lattice, red fastest (the .cube and Data3DTexture order).
 * @returns {Uint8Array} RGBA8, length N³·4
 */
export function bakeLUTData(g, size = 32) {
  const data = new Uint8Array(size * size * size * 4);
  const c = [0, 0, 0], o = [0, 0, 0];
  let k = 0;
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        c[0] = ri / (size - 1); c[1] = gi / (size - 1); c[2] = bi / (size - 1);
        gradeColor(c, g, o);
        data[k++] = Math.round(o[0] * 255); data[k++] = Math.round(o[1] * 255); data[k++] = Math.round(o[2] * 255); data[k++] = 255;
      }
    }
  }
  return data;
}

/** Serialise a grade as an Adobe/Resolve .cube file (float lattice, red fastest). */
export function gradeToCube(g, size = 33, title = 'SHADOW SIX grade') {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const c = [0, 0, 0], o = [0, 0, 0];
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        c[0] = ri / (size - 1); c[1] = gi / (size - 1); c[2] = bi / (size - 1);
        gradeColor(c, g, o);
        lines.push(`${o[0].toFixed(5)} ${o[1].toFixed(5)} ${o[2].toFixed(5)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}
