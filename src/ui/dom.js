/**
 * Small DOM helpers shared by the UI modules.
 * @module ui/dom
 */

/** Create an element: el('div', 'cls', parent, 'text'). */
export function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Element from an SVG/HTML string (first child). */
export function fromHTML(html, cls, parent) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const e = t.content.firstElementChild;
  if (e && cls) e.classList.add(...cls.split(' '));
  if (e) parent?.appendChild(e);
  return e;
}

/** A styled button with an optional accelerator letter: btn('(N)EXT MISSION', fn). */
export function btn(label, onClick, parent, cls = 'ui-btn') {
  const b = el('button', cls, parent, label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick?.(e);
  });
  return b;
}

/** mm:ss / h:mm:ss */
export function fmtTime(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Tooltip text attached to any HUD element (read by the tooltip manager). */
export function tip(e, text) {
  if (e) e.dataset.tip = text;
  return e;
}

/** World point → client px using the game camera (null when behind / no camera). */
export function worldToClient(game, x, y, z, V3) {
  const cam = game?.cameraController?.camera;
  const dom = game?.renderer?.domElement;
  if (!cam || !dom || !V3) return null;
  const v = new V3(x, y, z).project(cam);
  if (v.z > 1 || v.z < -1) return null;
  const r = dom.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}
