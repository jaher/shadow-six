/**
 * LOADING screen with tips (docs/menus-art-direction.md S14): used when the briefing is skipped or unavailable —
 * loading a save, quick load, restart, and MISSION SELECT → "start without briefing". Black paper (B3), the
 * briefing geometry (photo x 12–390, text column x 407–632) so loading → briefing moves nothing, a Ken Burns photo
 * print, the mission title in Anton red, a typed tip card that swaps every 8 s (→ / RB forces the next), and a brass
 * progress rule that never jumps backwards. The rule follows the real load (Game.loadMission 'mission:progress':
 * stages + bytes received, engine/load-progress.js), then waits (bounded) for the talking portraits and the mission's
 * sound pack, so the briefing / first frame does not stream them. Also fronts every normal mission start
 * (hud.startMission, `brief: true` → the briefing opens when it closes). DOM only.
 * @module ui/loading
 */

import { hasQuickSave, quickLoad as storeQuickLoad, loadSlot as storeLoadSlot, loadAutoSave } from '../save.js';
import { el } from './dom.js';
import { photoPrint, cap } from './menu-kit.js';
import { easeProgress, pickTip } from './menu-model.js';
import { catalogueEntry, formatMissionDate } from './catalogue.js';
import { TIPS, loadSeen, markSeen } from './tips.js';
import { drawEurope } from './europe.js';
import { MISSIONS } from '../missions/index.js';
import { isTouchUI } from './touch.js';

export class Loading {
  constructor(hud) {
    this.hud = hud;
    this.active = false;
    this.seen = loadSeen();
  }

  /** Photo for the mission: its graded diorama still when baked, else the Europe map with the target ringed. */
  photo(def, c) {
    const th = def?.theater || 'temperate';
    const still = this.hud.backdrop?.stillURL?.(th);
    if (still) return still;
    const cv = document.createElement('canvas');
    cv.width = 760;
    cv.height = 868;
    drawEurope(cv.getContext('2d'), cv.width, cv.height, c || def?.mapPos);
    return cv.toDataURL('image/png');
  }

  /**
   * Show the screen, run `work()` (a Promise), then wait for a key (or continue after 400 ms when `auto`).
   * @param {{missionId?:string, title?:string, auto?:boolean, brief?:boolean}} info brief: open the briefing after
   * @param {() => Promise<any>} work
   */
  async run(info, work) {
    const hud = this.hud, kit = hud.kit;
    const def = MISSIONS.find((m) => m.id === info.missionId) || null;
    const c = catalogueEntry(info.missionId) || {};
    const n = hud.game.flow?.numberOf(info.missionId) || c.n;
    let shown = 0, target = 0.08, raf = 0, last = 0, tipT = 0, done = false, cont = null, real = null;
    let bar, pct, prompt, tipHost, size;
    const offProgress = hud.game.events?.on?.('mission:progress', (e) => { real = e; });
    const tipOf = () => pickTip(TIPS, { theater: def?.theater, mission: info.missionId, seen: this.seen, rnd: Math.random() });
    const showTip = (first) => {
      const t = tipOf();
      if (!t || !tipHost) return;
      markSeen(this.seen, t.id);
      const card = el('div', 'mk-tip mk-paper', tipHost);
      card.insertAdjacentHTML('afterbegin', '<svg class="clip" viewBox="0 0 12 30" aria-hidden="true"><path d="M3 26V6a3 3 0 0 1 6 0v18a1.6 1.6 0 0 1-3.2 0V8" fill="none" stroke="#c9a24a" stroke-width="1.6" stroke-linecap="round"/></svg>');
      el('div', 'mk-letterhead', card, 'FIELD TIP');
      el('p', 'mk-typed', card, t.text);
      const olds = [...tipHost.children].slice(0, -1);
      if (!first) {
        kit.sound.play('paper');
        card.animate?.([{ transform: 'translateX(40%) rotate(3deg)', opacity: 0 }, { transform: 'rotate(-1deg)', opacity: 1 }], { duration: kit.reducedMotion ? 120 : 220, easing: 'cubic-bezier(.22,.8,.26,1)' });
      }
      setTimeout(() => olds.forEach((o) => o.remove()), 240);
      tipT = 0;
    };
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      if (!done && real) target = Math.max(target, Math.min(0.97, real.p)); // real stages + bytes (never backwards)
      else if (!done) target = Math.min(0.92, target + dt * 0.35 * (1 - target)); // no progress events: ease toward 92 %
      if (size && real?.bytes) size.textContent = `${(real.bytes / 1e6).toFixed(1)} MB`;
      shown = easeProgress(shown, done ? 1 : target, dt);
      if (bar) bar.style.transform = `scaleX(${shown.toFixed(4)})`;
      if (pct) pct.textContent = `LOADING ${Math.round(shown * 100)}%`;
      tipT += dt;
      if (tipT > 8) showTip(false);
    };
    this.active = true;
    kit.open({
      id: 'loading', bg: 'paper', className: 'mk-loading', scrim: false, hints: false,
      render: (box) => {
        const ph = el('div', 'mk-brphoto', box);
        const p = photoPrint(ph, { src: this.photo(def, c), grade: 'gray' });
        p.classList.add('kenburns');
        const col = el('div', 'mk-brtext', box);
        const head = el('div', 'mk-brhead', box);
        el('span', null, head, n ? `Mission ${n}` : (info.title || 'Operation'));
        el('span', null, head, formatMissionDate(def?.date || c.date || ''));
        const t = el('h1', 'mk-brtitle', col);
        const words = String(def?.title || c.title || info.title || '').split(' ');
        const cut = words.length > 2 ? Math.floor(words.length / 2) : 1; // the briefing's line break (S15: "Baptism / of Fire")
        el('span', null, t, words.slice(0, cut).join(' '));
        if (words.length > 1) el('span', null, t, words.slice(cut).join(' '));
        tipHost = el('div', 'mk-tiphost', col);
        showTip(true);
        const nt = el('button', 'mk-hint mk-nexttip', col);
        nt.type = 'button';
        nt.append(cap('→'), 'NEXT TIP');
        nt.addEventListener('click', (e) => { e.stopPropagation(); showTip(false); });
        const foot = el('div', 'mk-loadbar', box);
        const rule = el('div', 'rule', foot);
        bar = el('div', 'fill', rule);
        pct = el('span', 'pct', foot, 'LOADING 0%');
        size = el('span', 'mb', foot);
        prompt = el('span', 'press', foot);
        el('div', 'mk-watermark', box.parentElement);
      },
      onKey: (e) => {
        if (e.code === 'ArrowRight' || e.code === 'BracketRight') { showTip(false); return true; }
        if (done && cont) cont();
        return true;
      },
      onBack: () => { if (done && cont) cont(); return true; },
      onClick: () => { if (done && cont) cont(); },
    }, { reset: true });
    hud.backdrop?.setMode('paper');
    raf = requestAnimationFrame(tick);
    let result;
    try {
      await new Promise((r) => setTimeout(r, 30)); // first paint before the heavy work
      result = await work();
      if (result) await this.settle();
    } catch (err) {
      console.warn('[loading] failed', err);
      result = false;
    }
    done = true;
    await new Promise((resolve) => {
      cont = resolve;
      if (info.auto !== false || !result) setTimeout(resolve, 400);
      else {
        prompt.textContent = isTouchUI() ? 'TAP TO CONTINUE' : 'PRESS ANY KEY';
        prompt.classList.add('mk-press');
        pct.textContent = 'LOADING 100%';
      }
    });
    cancelAnimationFrame(raf);
    offProgress?.();
    this.active = false;
    kit.close();
    hud.backdrop?.setMode('off');
    if (result && info.brief && hud.game.state === 'briefing' && hud.def) hud.briefing.open(hud.def);
    return result;
  }

  /** After the world is built: the talking portraits and the mission's decoded sounds (each bounded, never fails). */
  async settle(ms = 6000) {
    const hud = this.hud, a = hud.game.audio;
    const jobs = [hud.portraitsReady, a?.engine ? a.preloading : null].filter(Boolean).map((p) => Promise.resolve(p).catch(() => null));
    if (!jobs.length) return;
    let timer;
    await Promise.race([Promise.all(jobs), new Promise((ok) => { timer = setTimeout(ok, ms); })]);
    clearTimeout(timer);
  }

  /** MISSION SELECT → "(S)TART WITHOUT BRIEFING". */
  async startDirect(id) {
    const hud = this.hud;
    hud.closeAll();
    // no briefing: the loaded mission passes through 'briefing' — keep the music silent until the start stinger
    const ok = await this.run({ missionId: id, auto: false }, () => (hud.game.flow ? hud.game.flow.startMission(id) : hud.game.loadMission(id))
      .then(() => { hud.game.audio?.music?.(null); return true; }));
    if (!ok) return hud.game.quitToTitle?.();
    hud.briefing.close();
    hud.game.flow ? hud.game.flow.begin() : hud.game.start();
  }

  async loadSlot(i, s) {
    this.hud.menus.close(false);
    const ok = await this.run({ missionId: s?.mission, title: s?.name }, () => storeLoadSlot(this.hud.game, i));
    this.hud.message(ok ? 'GAME LOADED.' : 'LOAD FAILED.', ok ? 'info' : 'warn');
    if (!ok && !this.hud.world) this.hud.screens.openMain();
    return ok;
  }

  async quickLoad() {
    if (!hasQuickSave()) return false;
    this.hud.menus.close(false);
    let mission = null;
    try { mission = JSON.parse(localStorage.getItem('shadowsix.quicksave.v1') || 'null')?.mission; } catch { /* memory quicksave */ }
    const ok = await this.run({ missionId: mission ?? this.hud.def?.id, title: 'QUICK SAVE' }, () => storeQuickLoad(this.hud.game));
    if (!ok && !this.hud.world) this.hud.screens.openMain();
    return ok;
  }

  async autoLoad() {
    this.hud.menus.close(false);
    const ok = await this.run({ title: 'AUTOSAVE' }, () => loadAutoSave(this.hud.game));
    if (!ok && !this.hud.world) this.hud.screens.openMain();
    return ok;
  }

  /** RESTART MISSION (confirmed): reload and brief again. */
  async restart() {
    const id = this.hud.def?.id ?? this.hud.game.missionDef?.id;
    if (id == null) return;
    this.hud.menus.close(false);
    await this.hud.startMission(id);
  }
}
