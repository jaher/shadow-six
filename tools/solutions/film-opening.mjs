/**
 * The art opening of a mission film (tools/solutions/capture-video.mjs): a slow establishing pan over the places the
 * game's own briefing tour names (src/ui/tour.js tourStops: the objectives, the densest guard cluster, the extraction,
 * the team's start), at the game's default zoom with a zoom-2 close-up on the first objective, under the mission's
 * title card, ending on the squad's start where the solution begins. Pure (no browser, no game): the capture feeds it
 * the stops and asks `openingAt(plan, t)` for the camera of every frame; unit-tested.
 *
 * The order is the briefing's turned round: objectives first (the title card sits over a close-up of the first one),
 * then the danger and the extraction, then the team — a drop-in that also keeps the pan short (the objective is
 * usually far from the start; going out and back doubled the path).
 */

/** Seconds a waypoint is held, by the stop's kind (the first one holds for the title card). */
export const DWELL = Object.freeze({ objective: 2.4, danger: 1.7, extraction: 1.9, start: 1.0 });
export const DEFAULTS = Object.freeze({
  budget: 17, // s, the whole opening (the title card included); the film's brief is 20 s at most
  titleSec: 3.6, // s the first waypoint is held under the title card
  zoom: 1, // the game's default zoom (CONFIG.camera.defaultZoom)
  detailZoom: 2, // the close-up on the first objective (the game's highest level)
  endZoom: 0.7, // the film's own zoom where the solution begins
  hard: 19.5, // s: never longer than this, whatever the map (the holds and flights are squeezed)
  vMin: 6, vMax: 20, // m/s of the pan (an orthographic view at 40 px/m: 20 m/s = 800 px/s, 1200 at the eased peak)
  legMin: 1.3, legMax: 6.5, // s of a flight
  zoomSec: 1.1, // s of a zoom change
});

const smooth = (u) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
const finite = (s) => s && Number.isFinite(s.x) && Number.isFinite(s.z);

/** A short on-screen label for a briefing stop (the Colonel's own sentence, cut down). */
export function stopLabel(s) {
  if (s?.label) return String(s.label); // (a cut names its own stops: m12.cut.mjs)
  const text = String(s?.text || '');
  switch (s?.kind) {
    case 'objective': {
      const m = /^Your objective:\s*(.+?)\.(?:\s+I have circled.*)?$/i.exec(text);
      const o = (m ? m[1] : text.split(/(?<=\.)\s/)[0].replace(/\.$/, '')).trim();
      return o ? `Objective: ${o[0].toUpperCase()}${o.slice(1)}` : 'Objective';
    }
    case 'danger': {
      const m = /(\d+)\s+guards?/i.exec(text);
      return m ? `${m[1]} ${+m[1] === 1 ? 'guard covers' : 'guards cover'} this ground` : 'Guards cover this ground'; // (M10's densest spot has one)
    }
    case 'extraction': return 'Extraction: every man comes back here';
    case 'start': return 'The team goes in here';
    default: return text.split(/(?<=\.)\s/)[0].replace(/\.$/, '');
  }
}

/**
 * The stops in opening order: objectives, danger, extraction, then the start. `start` (the solution's first focus) replaces the stop of kind 'start'.
 * `ordered`: the stops come from a cut (`openingStops` in m12.cut.mjs) that owns the list: its order stays and nothing is added, so the opening
 * ends where the cut's last stop is (a start stop if it names one) and the solution's first frame is a cut from there.
 */
export function orderStops(stops, start = null, ordered = false) {
  const ok = (stops || []).filter(finite);
  if (ordered) return ok;
  const by = (k) => ok.filter((s) => s.kind === k);
  const rest = ok.filter((s) => !['objective', 'danger', 'extraction', 'start'].includes(s.kind));
  const out = [...by('objective'), ...rest, ...by('danger'), ...by('extraction')];
  const team = by('start')[0];
  if (start && finite(start)) out.push({ kind: 'start', x: start.x, z: start.z, text: team?.text || '' });
  else if (team) out.push(team);
  return out;
}

/**
 * Plan the opening.
 * @param {{kind:string, x:number, z:number, text?:string}[]} stops tourStops(world, def)
 * @param {object} [o] DEFAULTS overrides + `start` {x, z}: where the solution begins (the pan ends there at `endZoom`)
 * @returns {{dur:number, titleSec:number, segs:object[], labels:{t0:number,t1:number,text:string,kind:string}[], stops:object[]}}
 */
export function planOpening(stops, o = {}) {
  const P = { ...DEFAULTS, ...o };
  let ws = orderStops(stops, o.start, !!o.ordered).map((s) => ({ ...s, label: stopLabel(s), dwell: s.dwell ?? DWELL[s.kind] ?? 1.6 })); // (`dwell`: a cut's own hold)
  if (!ws.length && finite(o.start)) ws = [{ kind: 'start', x: o.start.x, z: o.start.z, label: stopLabel({ kind: 'start' }), dwell: DWELL.start }];
  if (!ws.length) return { dur: 0, titleSec: 0, segs: [], labels: [], stops: [] };
  ws[0].dwell = Math.max(ws[0].dwell, P.titleSec); // the title card's hold
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const cost = (list) => { // s the whole thing takes at the fastest pan (legs at their minimum / vMax) + holds + zoom changes
    let t = list.reduce((a, w) => a + w.dwell, 0);
    for (let i = 1; i < list.length; i++) t += Math.max(P.legMin, dist(list[i - 1], list[i]) / P.vMax);
    return t + P.zoomSec * 2;
  };
  // too long for the budget even at the fastest pan: drop the optional stops (extraction, danger, a second objective); a cut's own list stays
  for (const kind of o.ordered ? [] : ['extraction', 'danger', 'objective']) {
    while (cost(ws) > P.budget && ws.length > 2) {
      const i = ws.map((w) => w.kind).lastIndexOf(kind);
      if (i <= 0 || (kind === 'objective' && ws.filter((w) => w.kind === 'objective').length < 2)) break;
      ws.splice(i, 1);
    }
  }
  // the flights share what the holds leave: speed v = path / time, within [vMin, vMax], each flight within [legMin, legMax]
  const holds = ws.reduce((a, w) => a + w.dwell, 0) + P.zoomSec * 2;
  const path = ws.slice(1).reduce((a, w, i) => a + dist(ws[i], w), 0);
  const free = Math.max(P.legMin * (ws.length - 1), P.budget - holds);
  const v = path > 0 ? Math.min(P.vMax, Math.max(P.vMin, path / free)) : P.vMin;
  const legs = ws.slice(1).map((w, i) => Math.min(P.legMax, Math.max(P.legMin, dist(ws[i], w) / v)));
  // segments: hold / zoom / fly, in order; the first waypoint is held at the close-up (the title), then zooms out
  const segs = [], labels = [];
  let t = 0;
  const first = ws[0], zin = first.kind === 'objective' || first.kind === 'danger' ? P.detailZoom : P.zoom;
  const at = (w, zoom) => ({ x: w.x, z: w.z, zoom });
  const push = (kind, dur, from, to, w) => { segs.push({ kind, t0: t, t1: t + dur, from, to, i: w }); t += dur; };
  const hold0 = Math.max(0.5, first.dwell - (zin !== P.zoom ? P.zoomSec : 0));
  labels.push({ t0: 0.4, t1: t + first.dwell, text: first.label, kind: first.kind });
  push('hold', hold0, at(first, zin), at(first, zin), 0);
  if (zin !== P.zoom) push('zoom', P.zoomSec, at(first, zin), at(first, P.zoom), 0);
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i], last = i === ws.length - 1, zEnd = last ? P.endZoom : P.zoom;
    push('fly', legs[i - 1], at(ws[i - 1], P.zoom), at(w, zEnd), i);
    labels.push({ t0: t - 0.5, t1: t + w.dwell, text: w.label, kind: w.kind });
    push('hold', w.dwell, at(w, zEnd), at(w, zEnd), i);
  }
  if (ws.length === 1 && P.endZoom !== segs[segs.length - 1].to.zoom) push('zoom', P.zoomSec, segs[segs.length - 1].to, at(ws[0], P.endZoom), 0); // (a lone stop: settle on the film's zoom)
  let titleSec = Math.min(P.titleSec, t);
  if (t > P.hard) { // squeeze to the hard cap
    const f = P.hard / t;
    for (const s of segs) { s.t0 *= f; s.t1 *= f; }
    for (const l of labels) { l.t0 *= f; l.t1 *= f; }
    titleSec *= f; t = P.hard;
  }
  return { dur: t, titleSec, segs, labels, stops: ws.map(({ kind, x, z, label }) => ({ kind, x, z, label })) };
}

/** Camera of the opening at time t (s): {x, z, zoom, label}. Eased flights and zooms; clamped to the ends. */
export function openingAt(plan, t) {
  const segs = plan?.segs || [];
  if (!segs.length) return null;
  const s = segs.find((g) => t >= g.t0 && t < g.t1) || (t < segs[0].t0 ? segs[0] : segs[segs.length - 1]);
  const k = s.kind === 'hold' ? 0 : smooth((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
  const lab = plan.labels.find((l) => t >= l.t0 && t < l.t1);
  return { x: lerp(s.from.x, s.to.x, k), z: lerp(s.from.z, s.to.z, k), zoom: lerp(s.from.zoom, s.to.zoom, k), label: lab?.text || '', kind: lab?.kind || '' };
}

/** Opacity of the title card at time t: full for the hold, then a one second fade. */
export function cardAlpha(plan, t) {
  const end = plan?.titleSec ?? 0;
  return t < end - 1 ? 1 : t >= end ? 0 : end - t;
}
