/**
 * Device class → default quality preset. Phones and tablets (a touch-first screen, or a mobile GPU) start on a mobile
 * preset instead of CONFIG.render.preset: 'medium', or 'low' for the weaker mobile GPUs. Every preset caps the
 * devicePixelRatio (low 1, medium 1.25 … ultra 2), so a 3× phone never renders at its full native resolution.
 * A quality the player picked in OPTIONS (remembered under PRESET_CHOSEN_KEY) and ?preset= in the URL always win. Desktop
 * (fine pointer, desktop GPU) is unchanged.
 * @module engine/device
 */

/** localStorage flag set when the player picks a QUALITY in OPTIONS (ui/hud.js setOption). */
export const PRESET_CHOSEN_KEY = 'shadowsix.preset.chosen';

/** Mobile GPU families by their WEBGL_debug_renderer_info string (Apple GPU = iPhone / iPad when touch-first). */
const MOBILE_GPU = /adreno|mali|powervr|apple gpu|immortalis|xclipse|videocore|tegra/i;
/** The weaker ones: older Adreno (≤ 6x0), Mali-G5x/G7x below G710, PowerVR, VideoCore, Tegra. */
const WEAK_GPU = /adreno \(tm\) [1-5]\d\d|adreno \(tm\) 6[0-3]\d|mali-[tg][1-6]\d\b|mali-g7[0-7]\b|powervr|videocore|tegra/i;

/** Unmasked renderer string of a WebGL context ('' when the browser hides it). */
export function gpuName(gl) {
  try {
    const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
    return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl?.getParameter?.(gl.RENDERER) || '');
  } catch {
    return '';
  }
}

/**
 * The default preset for a device, or null to keep the desktop default.
 * @param {{touch?: boolean, gpu?: string}} d touch = touch-first screen (ui/touch.js touchFirst)
 * @returns {'low'|'medium'|null}
 */
export function mobilePreset({ touch = false, gpu = '' } = {}) {
  const mobileGpu = MOBILE_GPU.test(gpu);
  // a touch laptop with a desktop GPU reports a fine pointer (touchFirst false); Apple GPU on a Mac is desktop
  if (!touch && !(mobileGpu && !/apple gpu/i.test(gpu))) return null;
  return WEAK_GPU.test(gpu) ? 'low' : 'medium';
}

/**
 * Boot-time preset: the URL's ?preset=, else the quality chosen in OPTIONS on a mobile device, else the mobile default.
 * @param {{param?: string|null, touch?: boolean, gpu?: string, options?: {preset?: string, presetChosen?: boolean}}} o
 * @returns {string|null} null = keep the renderer's default (desktop)
 */
export function bootPreset({ param = null, touch = false, gpu = '', options = {} } = {}) {
  if (param) return param;
  const m = mobilePreset({ touch, gpu });
  if (!m) return null;
  return options.presetChosen && options.preset ? options.preset : m;
}
