// guestkit.js - SHADOW SIX runtime for the GUESTS (McRae, Informer, Gilbert + 4 M17 prisoners, tram driver).
// Built on charkit.js (rework commandos_b: gait variants by speed, per-character grounding, prone death) with:
//  * lib = shared rework anims (commandos_b/out/anims.glb) + guests/out/guest_anims.glb overlay (guest clips win)
//  * per-guest abilities (design-spec §3.5 / §3.1 table): M17 prisoners cannot crawl -> crawl/crawl_idle map to the
//    crouched walk/idle so a stray order never lies them down
//  * states: tied (bible §6: hands tied until freed) and following (single file behind Gilbert, 1.0 m spacing)
//    re-route the generic names: idle/walk/run -> tied_* / follow_*
//  * posture-aware transitions: standing <-> prone goes through go_prone / get_up (no 0.2 s cross-fade teleport);
//    run -> die uses die_run (stumble forward) and longer fades between very different poses
import * as THREE from 'three';
import { loadAnimLibrary, createHumanoid, VARIANTS, PRONE } from './charkit.js';

export const BASE_LIB = '/chars/commandos_b/out/anims.glb';
export const GUEST_LIB = '/chars/guests/out/guest_anims.glb';

export const GUESTS = {
  mcrae: { canCrawl: true, mission: 10 }, informer: { canCrawl: true, mission: 12 }, civ_tram_driver: { canCrawl: true, mission: 15 },
  gilbert: { canCrawl: false, mission: 17, leader: true }, prisoner_farmhand: { canCrawl: false, mission: 17 }, prisoner_worker: { canCrawl: false, mission: 17 },
  prisoner_oldman: { canCrawl: false, mission: 17 }, prisoner_clerk: { canCrawl: false, mission: 17 },
};

export async function loadGuestLib(base = BASE_LIB, extra = GUEST_LIB) {
  const lib = await loadAnimLibrary(base);
  const ex = await loadAnimLibrary(extra);
  for (const [k, c] of ex.clips) lib.clips.set(k, c);
  Object.assign(lib.meta, ex.meta);
  return lib;
}

// gait variants for the guest-only locomotion clips (speed in m/s picks the clip; timeScale matches groundSpeed)
Object.assign(VARIANTS, {
  tied_walk: [['tied_walk', 1.45], ['tied_walk_fast', 1e9]],
  follow_walk: [['follow_walk', 1e9]],
});
PRONE.add('go_prone');

const POSTURE = (n) => /^(crawl|die_prone|dead_prone|go_prone)/.test(n) ? 'prone' : /^(dead|die)/.test(n) ? 'down'
  : /^(sit|drive|boat_sit|board_)/.test(n) ? 'seat' : /^crouch|^follow_idle/.test(n) ? 'crouch' : 'stand';

export function createGuest(tpl, lib, opts = {}) {
  const id = opts.id || (tpl.url || '').split('/').pop().replace('.glb', '');
  const cfg = GUESTS[id] || { canCrawl: true };
  const h = createHumanoid(tpl, lib, opts);
  const base = h.setAnim;
  h.guest = { id, ...cfg }; h.tied = false; h.following = false;
  h.setTied = (on) => { h.tied = !!on; };
  h.setFollowing = (on) => { h.following = !!on; };
  let queued = null;
  h.setAnim = (name, o = {}) => {
    if (h._settled && h._settled !== h.animClip) h._settled = null;
    let n = name;
    if (!cfg.canCrawl && n === 'crawl') n = 'crouch_walk';
    if (!cfg.canCrawl && n === 'crawl_idle') n = 'crouch_idle';
    if (h.tied) { n = { idle: 'tied_idle', walk: 'tied_walk', run: 'tied_walk' }[n] || n; if (o.speed > 2.3) o = { ...o, speed: 2.3 }; }   // tied: no running (the game caps the move speed too)
    else if (h.following) n = { idle: 'follow_idle', walk: 'follow_walk' }[n] || n;
    const from = h.animClip || h.anim || 'idle', pf = POSTURE(from);
    if (h.animClip === 'go_prone' && queued && /^crawl/.test(n)) { queued = { n, o }; return; }
    // posture change stand -> prone: play go_prone first, then the requested prone clip
    if (o.fade !== 0 && pf !== 'prone' && pf !== 'down' && /^crawl/.test(n) && lib.clips.has('go_prone')) {
      queued = { n, o }; const a = base('go_prone', { loop: false, fade: 0.2 }); h._prone = true; return a;
    }
    if (o.fade !== 0 && pf === 'prone' && /^crawl/.test(from) && !/^(crawl|die|dead)/.test(n) && lib.clips.has('get_up')) {
      queued = { n, o }; return base('get_up', { loop: false, fade: 0.2 });
    }
    if ((lib.meta[h.animClip] || {}).travel && h._settled !== h.animClip && (n === 'dead' || n === (lib.meta[h.animClip] || {}).next)) { settle(); if (n === 'dead') return; }
    queued = null;
    if (n === 'die' && /^(run|walk_fast|sprint)/.test(from) && lib.clips.has('die_run')) {   // phase-matched forward fall
      const a = h.mixer.existingAction(h.clip(from)); const ph = a ? (a.time / a.getClip().duration) % 1 : 0;
      const k = Math.round(ph * 4) % 4; n = k ? 'die_run_' + k * 25 : 'die_run'; if (!lib.clips.has(n)) n = 'die_run';
    }
    const fade = o.fade ?? (/^die_run/.test(n) ? 0.15 : pf !== POSTURE(n) ? 0.35 : 0.2);
    return base(n, { ...o, fade });
  };
  // clips that end displaced (meta.travel / travelYaw: die_run, board_*): when they finish, move/turn the root by that
  // amount and continue with meta.next at no fade -> the body stays exactly where the clip left it
  const settle = () => {
    const cn = h.animClip, m = lib.meta[cn] || {}; if (!m.travel || h._settled === cn) return false;
    h._settled = cn;
    const obj = h.object; obj.updateMatrixWorld(true);
    const d = new THREE.Vector3(...m.travel).multiplyScalar(h.info.pelvisRatio || 1);   // clip pelvis motion is scaled by pelvisRatio (adaptClip)
    d.applyQuaternion(obj.quaternion); obj.position.add(d);
    if (m.travelYaw) obj.rotateY(THREE.MathUtils.degToRad(m.travelYaw));
    if (m.next) { base(m.next, { loop: (lib.meta[m.next] || {}).loop !== false, fade: 0 }); if (m.prone) h._prone = true; }
    return true;
  };
  h.settle = settle;
  const upd = h.update;
  h.update = (dt) => {
    upd(dt);
    const cn = h.animClip; if (!cn) return;
    const a = h.mixer.existingAction(h.clip(cn)); if (!a) return;
    const left = a.getClip().duration - a.time;
    if (queued && (cn === 'go_prone' || cn === 'get_up') && left <= 0.12) { const q = queued; queued = null; base(q.n, { ...q.o, fade: 0.12 }); }
    else if ((lib.meta[cn] || {}).travel && left <= 1e-3) { settle(); h.mixer.update(0); }
  };
  return h;
}
