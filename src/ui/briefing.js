/**
 * Briefing (design-spec §6.6), two parts; Esc skips.
 *  1. Historical slideshow framed 4:3 inside a black page: 4 rotating images crossfading every 6 s (a grey Europe
 *     map with the target circled, renders of our own scene graded B&W, a team photo), "Mission N" + date on top,
 *     the title in heavy red condensed type, 2–3 paragraphs of our own context, a faint SHADOW SIX watermark.
 *  2. The Colonel's tactical advice: a camera tour over the live map at 0.5× zoom stopping on start, objectives
 *     (red circle), dangers and extraction, with subtitles along the bottom (TTS when available). Esc starts.
 * @module ui/briefing
 */

import { forcedRuleLines } from '../core/house-rules.js';
import { getPortraitURL } from '../art/portraits.js';
import { el, btn } from './dom.js';
import { cap } from './menu-kit.js';
import { UI } from './ui-config.js';
import { catalogueEntry, formatMissionDate } from './catalogue.js';
import { europeSVG, project } from './europe.js';
import { tourStops } from './tour.js';
import { briefingCueFor } from '../audio/music-cues.js';
import { isTouchUI } from './touch.js';

/**
 * Theatre-correct photo set [archival, tinted, cold] for a mission's briefing slides (names in assets/ui/briefing,
 * built by tools/ui/build_briefing_photos.py; sources in CREDITS.md). M1-M3 are Norway 1941 and each has its own
 * set; other missions fall back by theatre so no North-Africa print appears in a Norway briefing.
 * @param {{id?:string, theater?:string}} def @param {number} [n] campaign number (varies the snow fallback)
 * @returns {string[]}
 */
export function briefingPhotos(def, n = 0) {
  const byMission = {
    m01: ['norway-landing', 'norway-airfield', 'norway-vaagso'],   // Sola airfield raid
    m02: ['norway-harbour', 'lofoten-craft', 'norway-snow'],       // Stamsund, Lofoten (Operation Claymore)
    m03: ['norway-commandos', 'norway-prisoners', 'norway-vaagso'], // Sysendam dam, Eidfjord
  };
  if (byMission[def?.id]) return byMission[def.id];
  const th = def?.theater || 'temperate';
  if (th === 'snow') return n % 2 ? ['norway-harbour', 'lofoten-craft', 'norway-snow'] : ['norway-landing', 'norway-airfield', 'norway-vaagso'];
  if (th === 'desert') return ['desert', 'stuka', 'france-road'];
  return ['france-tank', 'stuka', 'france-road'];
}

export class Briefing {
  constructor(hud) {
    this.hud = hud;
    this.root = el('div', 'ui-briefing', hud.root);
    this.root.hidden = true;
    this.part = 0;
  }

  get active() {
    return this.part > 0;
  }

  /** Enter part 1 for the loaded mission (docs/menus-art-direction.md S15 + A4: BEL's exact layout on B3). */
  open(def) {
    this.def = def;
    this.cat = catalogueEntry(def);
    this.part = 1;
    this.slide = 0;
    this.slideT = 0;
    this.root.hidden = false;
    this.root.className = 'ui-briefing part1 mk-bgpaper';
    this.root.replaceChildren();
    const rm = !!this.hud.kit?.reducedMotion;
    this.root.classList.toggle('rm', rm);
    const box = el('div', 'brbox', this.root);
    el('div', 'mk-watermark', this.root);
    const n = this.cat?.n ?? (def.id === 'm00' ? 0 : '');
    const head = el('div', 'head', box);
    el('span', 'kicker', head, n === 0 ? 'Training' : n ? `Mission ${n}` : 'Operation');
    el('span', 'date', head, def.date || this.cat?.date ? formatMissionDate(def.date || this.cat.date) : '');
    // the photo frame: hard edge, no border [orig]; 4 slides, film-gate dissolve + Ken Burns
    const left = el('div', 'slides', box);
    left.addEventListener('click', () => this.advance());
    this.slides = this._images(def).map((s, i) => {
      const f = el('div', `slide ${s.kind} ${i === 0 ? 'on' : ''} ${i % 2 ? 'kb-b' : 'kb-a'}`.replace(/\s+/g, ' ').trim(), left);
      if (s.svg) f.innerHTML = s.svg;
      else {
        const im = el('img', null, f);
        im.src = s.src;
        im.alt = '';
      }
      return f;
    });
    this.pips = el('div', 'pips', box);
    this.slides.forEach((_, i) => el('i', i === 0 ? 'on' : '', this.pips));
    const right = el('div', 'text', box);
    const title = el('h1', 'title', right);
    title.setAttribute('aria-label', def.title || def.id);
    const words = String(def.title || def.id).split(' ');
    const cut = words.length > 2 ? Math.floor(words.length / 2) : 1;
    const lines = words.length > 1 ? [words.slice(0, cut).join(' '), words.slice(cut).join(' ')] : [words[0]];
    lines.forEach((t, i) => {
      const l = el('span', 'line', title, t);
      l.style.setProperty('--d', `${i * 150}ms`);
      l.setAttribute('aria-hidden', 'true');
    });
    const place = def.location || this.cat?.place || def.subtitle || '';
    if (place) el('div', 'place', right, place);
    const paras = this._paragraphs(def);
    paras.forEach((t, i) => {
      const p = el('p', null, right, t);
      p.style.setProperty('--d', `${450 + i * 200}ms`);
    });
    // the mission's forced house rules (bodies-design §0.3), before the player commits
    const rules = forcedRuleLines(def);
    if (rules.length) {
      const r = el('p', 'rules', right, `Standing orders: ${rules.join(' ')}`);
      r.style.setProperty('--d', `${450 + paras.length * 200}ms`);
    }
    const touch = isTouchUI();
    const skip = el('button', 'skip', box, touch ? 'SKIP ›' : 'Press Escape to skip');
    skip.type = 'button';
    skip.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
    // the shared KeyHintBar for the rest (BEL's own line above keeps Esc); phones get real PREV / NEXT buttons
    const bar = el('nav', `mk-hints br-hints ${touch ? 'touch' : ''}`.trim(), box);
    bar.setAttribute('aria-label', 'Controls');
    const hints = touch
      ? [[null, '‹ PREV', () => this.back()], [null, 'NEXT ›', () => this.advance()], [null, 'CONTINUE', () => this.next(), 'go']]
      : [['← →', 'SLIDE', () => this.advance()], ['↵', 'NEXT PART', () => this.next()]];
    for (const [c, label, fn, cls] of hints) {
      const h = el('button', `mk-hint ${touch ? `mk-touchbtn ${cls || ''}` : ''}`.trim(), bar);
      h.type = 'button';
      if (c) h.append(cap(c));
      h.append(label);
      h.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    }
    if (this.slides.some((f) => f.classList.contains('capture'))) this._captureLater(def);
    this.hud.sound?.play('projector');
    this.hud.game.audio?.music?.(briefingCueFor(def)); // the mission's briefing loop (ducks under the Colonel)
  }

  /** Space / → / click: the next slide now. */
  advance() {
    if (this.part !== 1 || !this.slides?.length) return;
    this.slideT = UI.briefingSlide;
    this.update(0);
  }

  /** ←: the previous slide. */
  back() {
    if (this.part !== 1 || !this.slides?.length) return;
    this._show((this.slide - 1 + this.slides.length) % this.slides.length);
  }

  _show(i) {
    this.slideT = 0;
    const prev = this.slides[this.slide];
    prev.classList.remove('on');
    prev.classList.add('off'); // film-gate dissolve out (500 ms) with its flicker
    setTimeout(() => prev.classList.remove('off'), 520);
    this.slide = i;
    const cur = this.slides[i];
    cur.classList.remove('on');
    void cur.offsetWidth; // restart the Ken Burns
    cur.classList.add('on');
    [...(this.pips?.children || [])].forEach((p, k) => p.classList.toggle('on', k <= i));
  }

  _paragraphs(def) {
    const out = [];
    if (this.cat?.context) out.push(this.cat.context);
    if (def.briefing?.history) out.push(def.briefing.history);
    if (def.briefing?.text) out.push(def.briefing.text);
    const obj = (def.objectives || []).filter((o) => !o.hidden).map((o) => o.text);
    if (obj.length && out.length < 3) out.push(`Orders: ${obj.join('; ')}.`);
    return out.slice(0, 3);
  }

  /**
   * The 4 slides (S15): 1 an archival B&W still of the landing ground, 2 a hand-tinted team print, 3 the animated
   * Europe map, 4 the target render graded cold grey. Engine renders fall back to the map when pixels are unreadable.
   * @returns {{kind:string, src?:string, svg?:string}[]}
   */
  _images(def) {
    const map = { kind: 'map', svg: this._mapSVG(def) };
    // BEL's rhythm: an archival B&W print, a hand-tinted aircraft print, the map, a foggy view of the target —
    // public-domain period photographs graded offline (tools/ui/build_briefing_photos.py, CREDITS.md)
    const set = briefingPhotos(def, this.cat?.n ?? 0);
    const P = (f) => `assets/ui/briefing/${f}.webp`;
    return [
      { kind: 'photo archival baked', src: P(set[0]) },
      { kind: 'photo tinted baked', src: P(set[1]) },
      map,
      { kind: 'photo cold baked', src: P(set[2]) },
    ];
  }

  /** Fill the engine-render slides a few frames after the map is up (the first frames may not be drawn yet). */
  _captureLater(def) {
    const token = (this._capTok = (this._capTok || 0) + 1);
    const run = (tries) => {
      if (this._capTok !== token || this.part !== 1) return;
      const [start, target] = this._renders(def); // tourStops order: start first, then the objective
      if (!target && tries > 0) return setTimeout(() => run(tries - 1), 250);
      const fill = (cls, src) => {
        const f = this.slides?.find((x) => x.classList.contains(cls));
        if (!f) return;
        if (src) f.querySelector('img').src = src;
        else {
          f.className = f.className.replace(/\bphoto\b|\bcold\b|\barchival\b/g, '').trim() + ' map';
          f.innerHTML = this._mapSVG(def);
        }
      };
      fill('archival', start || target);
      fill('cold', target);
    };
    setTimeout(() => run(this.hud.game.manualTick ? 0 : 6), this.hud.game.manualTick ? 0 : 200);
  }

  /** S15 map slide: cream sea, grey land, the dashed range arc from England drawing on, the pulsing red target label. */
  _mapSVG(def) {
    const W = 379, H = 434;
    const t = this.cat && Number.isFinite(this.cat.lat) ? this.cat : def.mapPos && Number.isFinite(def.mapPos.lat) ? def.mapPos : null;
    const view = t ? { lon0: t.lon - 16, lon1: t.lon + 16, lat0: Math.max(24, t.lat - 17), lat1: Math.min(72, t.lat + 11) } : undefined;
    const P = (lon, lat) => project(lon, lat, W, H, view);
    let extra = '';
    const [bx, by] = P(-0.8, 51.3); // the Allied base in southern England
    extra += `<g class="city"><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="2.6" fill="#2f2b27"/><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5.5" fill="none" stroke="#2f2b27" stroke-width=".8"/></g>`;
    if (t) {
      const [x, y] = P(t.lon, t.lat);
      const mx = (bx + x) / 2 + (y - by) * 0.18, my = (by + y) / 2 - (x - bx) * 0.18;
      extra += `<path class="arc" d="M${bx.toFixed(1)} ${by.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="#1d1a17" stroke-width="1.3" stroke-dasharray="5 4" pathLength="100"/>`;
      extra += `<ellipse class="ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="15" ry="12" fill="none" stroke="#c21414" stroke-width="2.4" transform="rotate(-12 ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
      const label = String(this.cat?.place || def.location || '').split(',')[0].toUpperCase();
      if (label) {
        const lw = Math.max(48, label.length * 6.6 + 12), lx = Math.min(W - lw - 6, Math.max(6, x - lw / 2)), ly = y > H * 0.3 ? y - 44 : y + 22;
        extra += `<g class="tlabel"><rect x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" width="${lw.toFixed(1)}" height="17" fill="#efe9d7" stroke="#c21414" stroke-width="1.6"/><text x="${(lx + lw / 2).toFixed(1)}" y="${(ly + 12.4).toFixed(1)}" text-anchor="middle" font-family="Oswald, Arial Narrow, sans-serif" font-size="10.5" font-weight="600" letter-spacing=".6" fill="#c21414">${label.replace(/[<&>]/g, '')}</text></g>`;
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${europeSVG(W, H, view)}${extra}</svg>`;
  }

  /** Renders of our own scene (target, start) captured right after a render call. */
  _renders(def) {
    const g = this.hud.game, cc = g.cameraController, cv = g.renderer?.domElement;
    if (!cc || !cv?.toDataURL || !g.world) return [];
    const saved = cc.getState?.();
    const pts = tourStops(g.world, def).filter((s) => s.kind === 'objective' || s.kind === 'start').slice(0, 2);
    const out = [];
    cc.setZoom?.(0.8); // a wider "reconnaissance" framing than play zoom
    for (const p of pts) {
      try {
        cc.centerOn(p.x, p.z);
        if (g.cameraRig?.render) g.render(0, 1); // the full frame path (rig, shadow fit), not a bare renderer call
        else g.renderer.render?.(0);
        out.push(cv.toDataURL('image/jpeg', 0.8));
      } catch {
        /* context without readable pixels: skip */
      }
    }
    if (saved) {
      cc.centerOn(saved.x, saved.z);
      cc.setZoom(saved.zoom);
    }
    return out.filter((u) => u && u.length > 16000); // a blank (undrawn) frame compresses to a few KB
  }

  _teamPhoto(def) {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 480;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a2824';
    ctx.fillRect(0, 0, 480, 480);
    const roles = [...new Set((def.commandos || []).map((u) => u.role))];
    const n = Math.max(1, roles.length), cols = Math.min(3, n), rows = Math.ceil(n / cols), s = 440 / Math.max(cols, rows);
    roles.forEach((r, i) => {
      const im = new Image();
      im.onload = () => {
        ctx.drawImage(im, 20 + (i % cols) * s + 6, 20 + Math.floor(i / cols) * s + 6, s - 12, s - 12);
        const img = this.slides?.find((f) => f.classList.contains('team'))?.querySelector('img');
        if (img) img.src = c.toDataURL('image/png');
      };
      im.src = getPortraitURL(r, { size: 160 });
    });
    return c.toDataURL('image/png');
  }

  /** Esc / continue. */
  next() {
    if (this.part === 1) this.openTour();
    else if (this.part === 2) this.finish();
  }

  /** Part 2 → start the mission. */
  finish() {
    if (!this.part) return;
    this.close();
    this.hud.game.start();
    this.hud.game.renderer?.domElement?.focus?.();
  }

  close() {
    this.stopVoice();
    const cc = this.hud.game.cameraController;
    if (this.part === 2 && this._saved && cc) {
      cc.centerOn(this._saved.x, this._saved.z);
      cc.setZoom(this._saved.zoom);
    }
    this.part = 0;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.hud.root.classList.remove('touring');
  }

  update(dt) {
    if (this.part === 1 && this.slides?.length > 1) {
      this.slideT += dt;
      if (this.slideT >= UI.briefingSlide) this._show((this.slide + 1) % this.slides.length);
    } else if (this.part === 2) this.updateTour(dt);
  }

  // ------------------------------------------------------------ part 2: the Colonel

  openTour() {
    const g = this.hud.game, cc = g.cameraController;
    this.part = 2;
    this.root.className = 'ui-briefing part2';
    this.root.classList.toggle('rm', !!this.hud.kit?.reducedMotion);
    this.root.replaceChildren();
    this.hud.root.classList.add('touring');
    this.stops = tourStops(g.world, this.def);
    // S16: letterbox bars (black paper), header + stop pips, the Colonel's silhouette card, subtitles, hint row
    const top = el('div', 'bar top', this.root);
    const n = this.cat?.n;
    el('div', 'hdr', top, `COLONEL'S ORDERS${n ? ` · MISSION ${n}` : ''}`);
    const pc = el('div', 'stoppips', top);
    this.pipEls = this.stops.map(() => el('i', null, pc));
    this.pipNum = el('span', 'num', pc);
    const bottom = el('div', 'bar bottom', this.root);
    const card = el('div', 'colonel', bottom);
    card.innerHTML = '<svg viewBox="0 0 60 70" aria-hidden="true"><rect width="60" height="70" fill="#1d1c17"/><path d="M30 14c7 0 11 5 11 12s-4 13-11 13-11-6-11-13 4-12 11-12zm-20 56c1-15 8-24 20-24s19 9 20 24z" fill="#050504"/><path d="M17 20c3-8 23-9 26 0l-3 1c-4-4-16-4-20 0z" fill="#050504"/></svg>';
    el('span', 'mk-nametape', card, 'H.Q.');
    const band = el('div', 'band', bottom);
    el('div', 'speaker', band, 'THE COLONEL');
    this.sub = el('div', 'sub', band);
    const nav = el('div', 'nav', bottom);
    const hint = (label, fn, cls = '') => {
      const b = btn(label, fn, nav, `tourhint ${cls}`.trim());
      return b;
    };
    const touch = isTouchUI();
    if (touch) nav.classList.add('touch');
    hint(touch ? '‹ PREV' : '← PREV', () => this.gotoStop(Math.max(0, this.stopIx - 1)));
    hint(touch ? 'NEXT ›' : 'SPACE NEXT', () => this.gotoStop(this.stopIx + 1));
    hint(touch ? 'START MISSION' : 'ESC START MISSION', () => this.finish(), 'start');
    this.marker = el('div', 'marker', this.root);
    this.marker.hidden = true;
    this.ring = this.marker; // legacy name (tests / tour)
    this._saved = cc?.getState?.();
    if (cc && this._saved) cc.setZoom(this._saved.zoom * UI.briefingZoom);
    this.stopIx = -1;
    this.stopT = 0;
    this._from = this._saved ? { x: this._saved.x, z: this._saved.z } : null;
    this.gotoStop(0);
  }

  gotoStop(i) {
    this.stopIx = i;
    this.stopT = 0;
    const s = this.stops[i];
    this.pipEls?.forEach((p, k) => p.classList.toggle('on', k <= i));
    if (this.pipNum) this.pipNum.textContent = `${Math.min(i + 1, this.stops.length)}/${this.stops.length}`;
    this.sub.classList.remove('in');
    void this.sub.offsetWidth;
    this.sub.classList.add('in');
    if (!s) {
      this.sub.textContent = 'That is all, officer. Good luck.';
      this.marker.hidden = true;
      return;
    }
    this.sub.textContent = s.text;
    this.root.dataset.stop = s.kind;
    const label = { objective: 'OBJECTIVE', danger: 'DANGER', extraction: 'EXTRACTION' }[s.kind];
    this.marker.className = `marker ${s.kind}`;
    this.marker.innerHTML = s.kind === 'objective'
      ? '<svg viewBox="-50 -50 100 100"><path class="ink" pathLength="100" d="M-38 -4C-37 -26 -12 -38 10 -35C32 -31 42 -12 38 8C34 29 10 40 -12 36C-32 32 -42 14 -36 -8C-33 -18 -24 -27 -14 -31"/></svg>'
      : s.kind === 'danger' ? '<svg viewBox="-50 -50 100 100"><path class="ink x" pathLength="100" d="M-16 -16L16 16M16 -16L-16 16"/></svg>'
        : s.kind === 'extraction' ? '<svg viewBox="-50 -50 100 100"><path class="ink arrow" pathLength="100" d="M-40 30Q-30 -10 0 -12M-9 -20L2 -12L-8 -3"/></svg>' : '';
    if (label) el('span', 'mk-nametape tape', this.marker, label);
    this.speak(s.text);
  }

  updateTour(dt) {
    const s = this.stops[this.stopIx];
    const cc = this.hud.game.cameraController;
    this.stopT += dt;
    if (s && cc) {
      const cur = cc.getState();
      const k = this.hud.kit?.reducedMotion ? 1 : Math.min(1, dt * 2.5);
      cc.centerOn(cur.x + (s.x - cur.x) * k, cur.z + (s.z - cur.z) * k);
      const p = cc.worldToScreen?.(s.x, 0, s.z);
      const show = !!p && s.kind !== 'start' && this.marker.childNodes.length > 0;
      this.marker.hidden = !show;
      if (show) this.marker.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    const dur = Math.max(UI.briefingStop, (s?.text.length || 0) / UI.barkCharsPerSec);
    if (s && this.stopT > dur) this.gotoStop(this.stopIx + 1);
  }

  /** TTS for the Colonel (British voice when present); skipped in deterministic test mode. */
  speak(text) {
    const ss = globalThis.speechSynthesis;
    if (!ss || this.hud.game.manualTick || !text) return;
    try {
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = ss.getVoices().find((x) => /en-GB/i.test(x.lang));
      if (v) u.voice = v;
      u.rate = 0.95;
      u.pitch = 0.8;
      u.volume = (this.hud.options.volMaster ?? 1) * (this.hud.options.volVoice ?? 1);
      ss.speak(u);
    } catch {
      /* no TTS */
    }
  }

  stopVoice() {
    try {
      globalThis.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }
}
