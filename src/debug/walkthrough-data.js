/**
 * Walkthrough data (debug VIDEO MODE, debug/walkthrough.js): the per-mission tools/solutions/<id>.walkthrough.mjs
 * format (docs/walkthrough-format.md, version 1) — parsing of `on` cues, defaults for a solution without a walkthrough
 * file, the step that is current after a given checkpoint, and validation against the solution and the mission.
 * Pure: no DOM, no game (tests/unit/walkthrough.test.mjs).
 * @module debug/walkthrough-data
 */

export const FORMAT_VERSION = 1;
export const ROLES = Object.freeze(['greenberet', 'sniper', 'diver', 'sapper', 'driver', 'spy']);
/** Words `look` accepts besides ids, roles and points. */
export const LOOK_WORDS = Object.freeze(['decoy', 'charge']);
export const MAX_SAY = 240;

/** Checkpoint id of a checkpoint name: its first word ('A2 sergeant e1 trapped' → 'A2'). */
export const cpId = (name) => String(name ?? '').trim().split(/\s+/)[0] || '';

/**
 * Parse a beat's `on`. Returns {kind:'order', role, action, target?} | {kind:'kill', tag} | {kind:'objective', id} |
 * {kind:'state', tag, state} | {kind:'alarm', on: boolean} | null (not understood).
 */
export function parseOn(on) {
  const s = String(on ?? '').trim();
  if (!s) return null;
  if (s === 'alarm') return { kind: 'alarm', on: true };
  if (s === 'alarm:off') return { kind: 'alarm', on: false };
  let m = /^kill:([\w#.-]+)$/.exec(s);
  if (m) return { kind: 'kill', tag: m[1] };
  m = /^objective:([\w-]+)$/.exec(s);
  if (m) return { kind: 'objective', id: m[1] };
  m = /^state:([\w#.-]+):([A-Z_]+)$/.exec(s);
  if (m) return { kind: 'state', tag: m[1], state: m[2] };
  m = /^([a-z]+):([A-Za-z]+)(?:>([\w#.-]+))?$/.exec(s);
  if (m && ROLES.includes(m[1])) return { kind: 'order', role: m[1], action: m[2], target: m[3] ?? null };
  return null;
}

/** What an order is, in `on` words: the ability id, or move / run / crawl / stance / stop. */
export function orderAction(unit, o) {
  if (!o) return '';
  if (o.type === 'ability') return String(o.id || '');
  if (o.type === 'move') return o.run ? 'run' : unit?.stance === 'crawl' ? 'crawl' : 'move';
  return String(o.type || '');
}

/** Tag of an order's target (enemy tag, vehicle / interactable tag or id, role), or null. */
export function targetTag(t) {
  if (!t || typeof t !== 'object') return null;
  return t.tag ?? t.spawn?.id ?? t.role ?? t.id ?? null;
}

/**
 * Does live event `ev` match a parsed `on`? ev: {kind:'order', role, action, target} | {kind:'kill', tag} |
 * {kind:'objective', id} | {kind:'state', tag, state} | {kind:'alarm', on}.
 */
export function matchOn(p, ev) {
  if (!p || !ev || p.kind !== ev.kind) return false;
  switch (p.kind) {
    case 'order': {
      if (p.role !== ev.role) return false;
      // 'move' also matches a run or a crawl (any move order)
      if (p.action !== ev.action && !(p.action === 'move' && (ev.action === 'run' || ev.action === 'crawl'))) return false;
      return !p.target || p.target === ev.target;
    }
    case 'kill': return p.tag === ev.tag;
    case 'objective': return p.id === ev.id;
    case 'state': return p.tag === ev.tag && p.state === ev.state;
    case 'alarm': return p.on === ev.on;
    default: return false;
  }
}

const asList = (v) => (v == null ? [] : Array.isArray(v) && !(v.length === 2 && v.every((n) => typeof n === 'number')) ? v : [v]);
const isPoint = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n));

/**
 * The walkthrough the player sees: the file's (when there is one) completed with defaults from the solution — a
 * chapter per stage (its title from STAGES), a step per checkpoint met that the file does not describe (caption =
 * the checkpoint name without its id). `stages` = [{id, title}].
 */
export function normalizeWalkthrough(wt, { id = null, stages = [], missionTitle = null } = {}) {
  const src = wt && typeof wt === 'object' ? wt : {};
  const byId = new Map((src.chapters || []).map((c) => [String(c.id), c]));
  const chapters = stages.map((s) => {
    const c = byId.get(String(s.id)) || {};
    return { id: String(s.id), title: c.title || s.title || String(s.id), say: c.say || '' };
  });
  for (const c of src.chapters || []) if (!chapters.some((x) => x.id === String(c.id))) chapters.push({ id: String(c.id), title: c.title || String(c.id), say: c.say || '' });
  const steps = (src.steps || []).map((s, i) => ({
    cp: String(s.cp), index: i, chapter: chapterOf(String(s.cp), chapters),
    who: asList(s.who).filter((r) => ROLES.includes(r)), say: String(s.say || ''),
    look: asList(s.look), shot: !!s.shot, cones: s.cones == null ? null : asList(s.cones), zoom: s.zoom || null,
    beats: (s.beats || []).map((b) => ({ ...b, parsed: parseOn(b.on), look: b.look == null ? null : asList(b.look), cones: b.cones == null ? null : asList(b.cones) })),
  }));
  return {
    version: src.version ?? FORMAT_VERSION, mission: src.mission || id, title: src.title || missionTitle || id || '',
    intro: src.intro || '', outro: src.outro || '', chapters, steps, hasFile: !!wt,
    pitchAt: typeof src.pitchAt === 'function' ? src.pitchAt : null,
  };
}

/** Chapter id of checkpoint id `cp`: the longest chapter id it starts with ('G2' → 'G'). */
export function chapterOf(cp, chapters) {
  let best = null;
  for (const c of chapters) if (cp.startsWith(c.id) && (!best || c.id.length > best.length)) best = c.id;
  return best;
}

/** A step for a checkpoint the walkthrough file does not describe (built when the checkpoint is met). */
export function fallbackStep(name, chapters, index = -1) {
  const cp = cpId(name);
  const say = String(name ?? '').trim().slice(cp.length).trim();
  return { cp, index, chapter: chapterOf(cp, chapters), who: [], say: say ? say[0].toUpperCase() + say.slice(1) : cp, look: [], shot: false, cones: null, zoom: null, beats: [], fallback: true };
}

/**
 * The step on screen: the first step after the last checkpoint reached (`doneCps`, ids in order) that belongs to the
 * current chapter, else (the chapter's tail after its last checkpoint) the last step reached. null before anything.
 */
export function currentStep(wt, chapterId, doneCps) {
  const done = new Set(doneCps);
  const lastDone = doneCps.length ? doneCps[doneCps.length - 1] : null;
  let i = 0;
  if (lastDone) { const k = wt.steps.findIndex((s) => s.cp === lastDone); i = k >= 0 ? k + 1 : wt.steps.findIndex((s) => !done.has(s.cp)); }
  const next = i >= 0 ? wt.steps.slice(i).find((s) => !done.has(s.cp)) : null;
  if (next && (!chapterId || next.chapter === chapterId)) return next;
  return lastDone ? wt.steps.find((s) => s.cp === lastDone) || null : next || null;
}

/** Checkpoint ids a solution's source sets, in source order (`D.checkpoint('A1 …')`, quotes or backticks). */
export function checkpointIdsFromSource(src) {
  const out = [];
  const re = /\.checkpoint\(\s*(['"`])([^'"`]+)\1/g;
  for (let m; (m = re.exec(String(src))); ) { const id = cpId(m[2]); if (id && !out.includes(id)) out.push(id); }
  return out;
}

/** Every string `id` / `*Id` value anywhere in a (normalised) mission def. */
export function missionIds(def) {
  const ids = new Set();
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > 8) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && (k === 'id' || /Id$/.test(k))) ids.add(x);
      else if (typeof x === 'object') walk(x, depth + 1);
    }
  };
  walk(def, 0);
  return ids;
}

/**
 * Validate a walkthrough file. `ctx`: {id, stages: [{id}], checkpoints: [ids, in order], roles: [the mission's
 * commandos], ids: Set of mission ids (missionIds)}. Returns a list of error strings (empty = good).
 */
export function validateWalkthrough(wt, { id, stages = [], checkpoints = [], roles = ROLES, ids = new Set() } = {}) {
  const err = [];
  if (!wt || typeof wt !== 'object') return ['WALKTHROUGH is missing or not an object'];
  if (wt.version !== FORMAT_VERSION) err.push(`version must be ${FORMAT_VERSION} (is ${wt.version})`);
  if (id && wt.mission !== id) err.push(`mission must be '${id}' (is '${wt.mission}')`);
  for (const k of ['title', 'intro', 'outro']) if (wt[k] != null && typeof wt[k] !== 'string') err.push(`${k} must be a string`);
  if (wt.pitchAt != null && typeof wt.pitchAt !== 'function') err.push('pitchAt must be a function (x, z) → degrees');
  const ch = wt.chapters || [];
  const stIds = stages.map((s) => String(s.id));
  if (ch.map((c) => String(c.id)).join(',') !== stIds.join(',')) err.push(`chapters must be the solution's stages in order: [${stIds}] (are [${ch.map((c) => c.id)}])`);
  for (const c of ch) {
    if (!c.title || typeof c.title !== 'string') err.push(`chapter ${c.id}: title missing`);
    if (c.say != null && (typeof c.say !== 'string' || c.say.length > MAX_SAY)) err.push(`chapter ${c.id}: say must be a string of at most ${MAX_SAY} characters`);
  }
  const steps = wt.steps || [];
  const cps = steps.map((s) => String(s.cp));
  const dup = cps.filter((c, i) => cps.indexOf(c) !== i);
  if (dup.length) err.push(`duplicate steps: ${[...new Set(dup)]}`);
  const missing = checkpoints.filter((c) => !cps.includes(c));
  if (missing.length) err.push(`no step for checkpoint(s) ${missing} (one step per D.checkpoint)`);
  const unknown = cps.filter((c) => !checkpoints.includes(c));
  if (unknown.length) err.push(`step(s) ${unknown} name no checkpoint of the solution`);
  const order = cps.filter((c) => checkpoints.includes(c));
  const want = checkpoints.filter((c) => cps.includes(c));
  if (order.join(',') !== want.join(',')) err.push(`steps out of play order: [${order}] (solution: [${want}])`);
  const okRef = (r) => isPoint(r) || (typeof r === 'string' && (roles.includes(r) || ROLES.includes(r) || LOOK_WORDS.includes(r) || ids.has(r)));
  const refs = (where, list) => { for (const r of asList(list)) if (!okRef(r)) err.push(`${where}: unknown target ${JSON.stringify(r)} (a guard tag, a role, a mission id, 'decoy', 'charge' or [x, z])`); };
  const tags = (where, list) => { for (const r of asList(list)) if (typeof r !== 'string' || !ids.has(r)) err.push(`${where}: cones: unknown guard ${JSON.stringify(r)}`); };
  for (const s of steps) {
    const w = `step ${s.cp}`;
    if (!s.say || typeof s.say !== 'string') err.push(`${w}: say missing`);
    else if (s.say.length > MAX_SAY) err.push(`${w}: say is ${s.say.length} characters (at most ${MAX_SAY})`);
    for (const r of asList(s.who)) if (!roles.includes(r)) err.push(`${w}: who '${r}' is not a commando of this mission (${roles})`);
    refs(w, s.look);
    if (s.cones != null) tags(w, s.cones);
    if (s.zoom != null && !['close', 'wide'].includes(s.zoom)) err.push(`${w}: zoom must be 'close' or 'wide'`);
    if (s.shot && !asList(s.look).length) err.push(`${w}: shot needs a look`);
    for (const [i, b] of (s.beats || []).entries()) {
      const bw = `${w} beat ${i + 1}`;
      const p = parseOn(b.on);
      if (!p) err.push(`${bw}: on ${JSON.stringify(b.on)} not understood (see docs/walkthrough-format.md)`);
      else if (p.kind === 'order' && !roles.includes(p.role)) err.push(`${bw}: ${p.role} is not a commando of this mission`);
      else if ((p.kind === 'kill' || p.kind === 'state') && !ids.has(p.tag)) err.push(`${bw}: unknown guard ${p.tag}`);
      if (b.say != null && (typeof b.say !== 'string' || b.say.length > MAX_SAY)) err.push(`${bw}: say must be a string of at most ${MAX_SAY} characters`);
      refs(bw, b.look);
      if (b.cones != null) tags(bw, b.cones);
      if (b.hold != null && !(b.hold > 0)) err.push(`${bw}: hold must be a positive number of seconds`);
    }
  }
  return err;
}
