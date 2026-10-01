/**
 * Voice lines (design-spec §9.4): per-commando lines (new SHADOW SIX text), German enemy barks with
 * English glosses for subtitles, and the VoiceDirector that enforces the anti-spam rules.
 * File convention for recorded/TTS voices: assets/audio/voice/<speaker>/<key>_<n>.ogg (n = index in
 * the list below); assets/audio/voice/lines.json may override any path.
 * @module audio/voice-lines
 */

const L = (...texts) => texts.map((t) => (Array.isArray(t) ? { text: t[0], gloss: t[1] } : typeof t === 'object' ? t : { text: t }));
/** A line with a recorded take (`rec` = file stem in assets/audio/voice/lines.json). */
const R = (text, rec, gloss) => (gloss ? { text, gloss, rec } : { text, rec });
/** The shared commando acknowledgements (voices v2: every commando says them in his own voice, primary + urgent alt). */
const ACK = {
  select: [R('Yes, sir!', 'yes_sir'), R('Ready.', 'ready'), R('What now?', 'what_now')],
  ack_move: [R('On my way.', 'on_my_way'), R('Right away.', 'right_away'), R('Understood.', 'understood')],
  ack_act: [R('Consider it done.', 'consider_it_done'), R('Understood.', 'understood')],
  hurt: [R("I'm hit!", 'i_m_hit')],
};
/** bodies-design §C.7 buddy-rescue lines every commando (and guest) has (no voice pack yet: synth / subtitle; kept out of
 * the `rec` mapping below). `moan` = a downed man's sparse groan (distinct from the instant `pain` grunt on a hit). */
const RESCUE = {
  man_down: L('Man down!', "He's hit!", 'Cover him!', 'Medic!'),
  hurry: L("Hurry, he's fading!", "He won't last much longer!"),
  revived: L('Thanks, mate.', 'Back on my feet.', 'I owe you one.'),
  moan: L('Ngh…', 'Aagh…', "Can't… feel my legs…"),
};
/** Recording stem of a line = its text slugged (ä→ae…, accents dropped, non-alphanumerics → `_`): "What'll it be?" → what_ll_it_be. */
export const recOf = (text) => String(text).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe')
  .replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
/**
 * Shared acknowledgements first, then the man's own lines.  Voices v2 recorded every commando line, so every other
 * key (cant, spotted, alarm, death, special_*, act_*) is voiced via its `rec`.  On the ACK keys the man's own flavour
 * lines stay unrecorded (never picked while a pack is loaded) until the talking-portrait set renders their
 * lip-synced clips: the portrait of a select/order/hurt line must match the voice (docs/talking-portraits.md).
 */
const withRec = (o) => ({ ...RESCUE, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ACK[k] ? [...ACK[k], ...v]
  : v.map((l) => (l.rec ? l : { ...l, rec: recOf(l.text) }))])), pain: PAIN });
/**
 * Pain grunts (voices v2 `<char>/pain/pain_hit_{1,2,3}`, non-verbal, each man's own voice): voiced the instant a
 * commando is hit, with the talking portrait's flinch clip rendered from the same grunt (docs/talking-portraits.md §9).
 * Non-verbal: empty text (= the recording's), no subtitle, and no urgent alt take.
 */
const PAIN = Object.freeze(['pain_hit_1', 'pain_hit_2', 'pain_hit_3'].map((rec) => Object.freeze({ text: '', rec, nonverbal: true })));

/** speaker (commando role / 'ger' / guests / 'colonel') → key → [{text, gloss?}]. */
export const LINES = Object.freeze({
  greenberet: withRec({ // Tiny (Irish, gruff)
    select: L('Aye?', 'McHale.', "What'll it be?"), ack_move: L("On me way.", 'Right so.', "Movin'.", 'Grand.'),
    ack_act: L('Leave him to me.', 'Quiet as a church mouse.'), act_kill: L('Sleep tight.'), act_ok: L('Sorted.'),
    special_decoy: L("That'll turn a few heads."), special_dig: L('Snug as a bug.'), special_barrel: L('Heavy wee thing.'),
    cant: L("Can't do that one, sir.", 'Not with these hands.'), hurt: L("Argh! I'm grand, I'm grand!", "They've nicked me!"),
    spotted: L('Ah, feck.'), death: L('Tell me mam…'), alarm: L("That's torn it — they've the siren going!"),
  }),
  sniper: withRec({ // Duke (upper-class RP)
    select: L('Woolridge.', 'At your disposal.', 'Yes?'), ack_move: L('Very well.', 'If I must.', 'Quite.'),
    ack_act: L('One shot will suffice.', "Hold still, there's a good fellow."), act_kill: L('Clean.'), act_ok: L('Secured.'),
    cant: L('Hardly my department, old boy.'), cant_noammo: L("I'm afraid I'm out of rounds."),
    hurt: L("Blast. I'm hit.", 'Rather inconvenient.'), spotted: L("Ah. We've been noticed."), death: L('Most… unsporting.'),
    alarm: L('The alarm, I fear.'),
  }),
  diver: withRec({ // Fins (sarcastic Australian)
    select: L('Blackwood.', 'Yeah, what now?', 'Mm?'), ack_move: L('Righto… sir.', 'Off I go, then.', 'No worries.'),
    ack_act: L('Into the drink.', 'Nice and quiet.'), special_raft: L('Hop in, mind the paint.'), act_ok: L('Done and dusted.'),
    special_dive: L('See you on the other side.'), cant: L('Not without a boat, mate.', "In this? You're joking."),
    hurt: L('Strewth! That stings!'), spotted: L('Oh, bloody marvellous.'), death: L("Should've… stayed in the water."),
    alarm: L("Here we go — siren's up!"),
  }),
  sapper: withRec({ // Inferno (dry northern English)
    select: L('Hancock.', 'Sapper here.'), ack_move: L('On it.', 'Right you are.', 'Moving.'),
    ack_act: L('Charge set — ten seconds, run!', "This'll make a lovely bang.", "Wire's no bother."),
    special_detonate: L('Fire in the hole.'), act_ok: L('Sorted, that.'), cant: L('Wrong tool for that.', "Wire's live — not touching it."),
    hurt: L("Ahh! I'm hit!"), spotted: L("They've clocked me!"), death: L("Should've… cut the other one."), alarm: L("That's the alarm, lads."),
  }),
  driver: withRec({ // Tread (Brooklyn)
    select: L('Yeah, boss?', 'Tread here.', 'Whaddaya need?'), ack_move: L('You got it.', 'On my way, boss.', 'Easy money.'),
    ack_act: L('Time to make some noise.'), act_ok: L('Done deal.'), special_drive: L('Hop in, fellas.', 'Hold onto your helmets.'),
    special_heal: L("Hold still, this'll pinch."), cant: L('Not my line of work, boss.'), hurt: L('Ow! They winged me!'),
    spotted: L('Uh-oh.'), death: L("Aw, this ain't good…"), alarm: L("Aw geez, they sounded the alarm!"),
  }),
  spy: withRec({ // Spooky (French)
    select: L('Oui?', 'Duchamp.', 'Mon capitaine?'), ack_move: L("D'accord.", 'Bien sûr.', 'I go.'),
    ack_act: L('A small prick… et voilà.', 'Nobody will notice.'), special_uniform: L('Now I am one of them.'), act_ok: L('Voilà.'),
    special_distract: L(['Guten Tag, Soldat. Alles ruhig?', 'Good day, soldier. All quiet?'],
      ['Na, Kamerad — wie läuft der Dienst?', 'Well, comrade — how goes the duty?'], ['Stehen Sie bequem.', 'At ease.']),
    cant: L('Non. That, I cannot do.'), hurt: L('Aïe! Merde…'), spotted: L('Zut, they know me.'), death: L('Pour… la France…'),
    alarm: L("L'alarme! Vite!"),
  }),
  mcrae: { ...RESCUE, select: L("Get me to that kite and I'll fly her home.", 'About time, lads.') },
  informer: { ...RESCUE, select: L('Thank God you came.') },
  gilbert: { ...RESCUE, select: L('Mes hommes vous suivront.', 'Allez, vite!') },
  ger: {
    ger_halt: L(R('Halt! Wer da?', 'halt_wer_da', "Halt! Who's there?"), R('Hände hoch!', 'haende_hoch', 'Hands up!'), ['Halt!', 'Stop!'], ['Stehen bleiben!', 'Stand still!'], ['Wer da?', "Who's there?"], ['Hände hoch!', 'Hands up!'], ['Keine Bewegung!', "Don't move!"]),
    ger_suspicious: L(R('Was war das?', 'was_war_das', 'What was that?'), ['Da war doch was…', 'There was something…'], ['Hallo? Ist da jemand?', 'Hello? Anyone there?'],
      ['Spuren… frische Spuren.', 'Tracks… fresh tracks.'], ['Was piept da?', "What's beeping?"]),
    ger_giveup: L(['Nichts. Nur der Wind.', 'Nothing. Just the wind.'], ["Ich seh' schon Gespenster.", "I'm seeing ghosts."], ['Zurück auf Posten.', 'Back to post.']),
    ger_mandown: L(R('Achtung!', 'achtung', 'Look out!'), ['Mann am Boden!', 'Man down!'], ['Hier liegt einer!', "Someone's lying here!"], ['Sanitäter!', 'Medic!']),
    ger_alarm: L(R('Alarm!', 'alarm', 'Alarm!'), R('Da ist jemand!', 'da_ist_jemand', "Someone's there!"), ['Alarm! Alarm!', 'Alarm! Alarm!'], ['Eindringlinge!', 'Intruders!'], ['Sie sind hier!', "They're here!"]),
    ger_combat: L(R('Feuer!', 'feuer', 'Fire!'), R('Achtung!', 'achtung', 'Look out!'), ['Da drüben!', 'Over there!'], ['Schießt doch!', 'Shoot!']),
    ger_arrest: L(R('Hände hoch!', 'haende_hoch', 'Hands up!'), ['Mitkommen!', 'Come with us!'], ['Abführen!', 'Take him away!']),
    ger_distracted: L(['Jawohl, Herr Offizier!', 'Yes, sir!'], ['Zu Befehl!', 'At your command!'], ['Alles ruhig, Herr Hauptmann.', 'All quiet, Captain.']),
    spy_unmask: L(['Das ist kein Offizier — ein Spion!', "That's no officer — a spy!"]),
    ger_hurt: L(['Ich bin getroffen!', "I'm hit!"], ['Argh!'], ['Ngh!']),
    ger_death: L(['Aaargh!'], ['Uhh…'], ['Nein…'], ['Ahh!'], ['Ghh…'], ['Oh…']),
    courier: L(['Ich hole Verstärkung!', "I'll get reinforcements!"]),
    sergeant_order: L(['Ausschwärmen!', 'Spread out!'], ['Weitergehen!', 'Move on!']),
  },
  dog: { dog: L(['*bark*'], ['*growl*'], ['*whimper*']) },
});

/** Placeholder synth pitch per speaker (Hz). */
export const PITCH = Object.freeze({ greenberet: 95, sniper: 120, diver: 130, sapper: 115, driver: 125, spy: 140,
  mcrae: 110, informer: 135, gilbert: 118, colonel: 100, ger: 105, dog: 300 });

/** Legacy / short bark names used by emitters → §9.4 keys. */
export const LINE_ALIASES = Object.freeze({
  halt: 'ger_halt', suspicious: 'ger_suspicious', giveup: 'ger_giveup', mandown: 'ger_mandown', alarm_shout: 'ger_alarm',
  alarmShout: 'ger_alarm', combat: 'ger_combat', arrest: 'ger_arrest', distracted: 'ger_distracted', unmask: 'spy_unmask',
  spyUnmask: 'spy_unmask', ack: 'ack_move', order: 'ack_move', noammo: 'cant_noammo', kill: 'act_kill', bark: 'dog',
});

/**
 * Anti-spam rules. `cd` = per-speaker cooldown for that key (s); `global` = cooldown shared by every
 * speaker (so a squad doesn't shout in unison); `chance` = play probability; `prio` = priority (a
 * higher-priority line interrupts at once); `laconic` = muted by the Verbose/Laconic option; `sub` = subtitle shown;
 * `first` = variant index of a speaker's first line (else random; then round-robin, so never an immediate repeat);
 * `newMan` = a different commando's line replaces a same-or-lower-priority one at once (selecting a new man
 * always gets his answer, and the `cd` only holds while re-selecting the man who answered last).
 */
export const RULES = Object.freeze({
  select: { cd: 3, prio: 1, laconic: true, first: 0, newMan: true },
  ack_move: { cd: 0.8, prio: 1, laconic: true }, ack_act: { cd: 0.8, prio: 2, laconic: true },
  act_kill: { cd: 3, chance: 0.3, prio: 2, sub: true }, cant: { cd: 1.2, prio: 2, sub: true }, cant_noammo: { cd: 2, prio: 2, sub: true },
  hurt: { cd: 1.5, prio: 4, sub: true }, pain: { cd: 0.4, prio: 5, sub: false }, death: { cd: 0, prio: 6, sub: true }, spotted: { cd: 5, prio: 3, sub: true },
  alarm: { cd: 20, global: 20, prio: 3, sub: true }, special: { cd: 2, prio: 2, sub: true },
  ger_halt: { cd: 4, global: 0.6, prio: 3, sub: true }, ger_suspicious: { cd: 6, global: 1.5, prio: 2, sub: true },
  ger_giveup: { cd: 8, global: 2, prio: 1, sub: true }, ger_mandown: { cd: 6, global: 1, prio: 4, sub: true },
  ger_alarm: { cd: 5, global: 1.2, prio: 4, sub: true }, ger_combat: { cd: 4, global: 1, prio: 3, sub: true },
  ger_arrest: { cd: 5, global: 1, prio: 3, sub: true }, ger_distracted: { cd: 6, prio: 1, sub: true },
  spy_unmask: { cd: 5, prio: 5, sub: true }, ger_hurt: { cd: 1.5, prio: 4, sub: false }, ger_death: { cd: 0, prio: 6, sub: false },
  courier: { cd: 10, prio: 4, sub: true },
  man_down: { cd: 4, global: 2, prio: 5, sub: true }, hurry: { cd: 10, prio: 4, sub: true }, revived: { cd: 3, prio: 3, sub: true },
  moan: { cd: 7, chance: 0.6, prio: 1, sub: false }, sergeant_order: { cd: 8, global: 3, prio: 2, sub: true }, dog: { cd: 1.5, prio: 1, sub: false },
});
const DEFAULT_RULE = { cd: 2, prio: 2, sub: true };
export function ruleFor(key) { return RULES[key] || (key.startsWith('special') ? RULES.special : DEFAULT_RULE); }

/** Normalize a bark name to a §9.4 key. */
export function lineKey(line) { return LINE_ALIASES[line] || line; }

/** Speaker id for a unit (commando role, 'ger' for enemies, 'dog'). */
export function speakerOf(unit) {
  if (!unit) return 'ger';
  if (unit.kind === 'enemy') return unit.soldierType === 'dog' || unit.type === 'dog' ? 'dog' : 'ger';
  if (unit.guestId && LINES[unit.guestId]) return unit.guestId;
  return LINES[unit.role] ? unit.role : 'greenberet';
}

/** Seconds a commando line must have played before a newer same/lower-priority line may replace it (§9.4). */
export const REPLACE_AFTER = 0.4;
/** Max simultaneous enemy voices (the rest are dropped; the squad "joins in" over the next second). */
export const MAX_ENEMY_VOICES = 2;

/**
 * Decides whether a requested line plays. Pure bookkeeping (no WebAudio): the caller passes `now`
 * (seconds) and a `rand()` in [0,1). Commando voices share ONE slot (§9.4); enemy/other voices may overlap
 * up to MAX_ENEMY_VOICES.
 */
export class VoiceDirector {
  constructor({ rand = Math.random, laconic = false } = {}) {
    this.rand = rand;
    this.laconic = laconic;
    this.last = new Map(); // `${speakerId}|${key}` → time
    this.lastGlobal = new Map(); // key → time
    this.commando = null; // {id, key, prio, start, dur, handle}
    this.enemy = []; // [{id, key, prio, start, dur, handle}]
    this.variantIx = new Map(); // `${speaker}|${key}` → round-robin counter
    this.lastBy = new Map(); // key → speakerId of its last line
  }

  /**
   * @param {{speaker:string, speakerId:string|number, key:string, now:number, commando?:boolean, force?:boolean,
   *   prefer?:(line:object)=>boolean}} req  `prefer`: restrict the variants to these when any match (recorded takes)
   * @returns {{ok:boolean, reason?:string, line?:{text:string, gloss?:string}, n?:number, replaces?:object|null, rule?:object}}
   */
  request(req) {
    const { speaker, key, now } = req;
    const lines = LINES[speaker]?.[key];
    if (!lines || !lines.length) return { ok: false, reason: 'no-line' };
    const rule = ruleFor(key);
    if (this.laconic && rule.laconic && !req.force) return { ok: false, reason: 'laconic' };
    const k = `${req.speakerId}|${key}`;
    if (!req.force) {
      const t = this.last.get(k);
      // `newMan`: the cooldown only holds while he is still the last man who answered (re-selecting him again)
      const other = rule.newMan && this.lastBy.get(key) !== req.speakerId;
      if (t != null && now - t < rule.cd && !other) return { ok: false, reason: 'cooldown' };
      const g = this.lastGlobal.get(key);
      if (rule.global && g != null && now - g < rule.global) return { ok: false, reason: 'cooldown-global' };
    }
    this._expire(now);
    let replaces = null;
    if (req.commando) {
      const cur = this.commando;
      const newMan = rule.newMan && cur && cur.id !== req.speakerId && cur.prio <= rule.prio;
      if (cur && rule.prio <= cur.prio && now - cur.start < REPLACE_AFTER && !newMan) return { ok: false, reason: 'busy' };
      replaces = cur;
    } else if (this.enemy.length >= MAX_ENEMY_VOICES) {
      const low = this.enemy.reduce((a, b) => (a.prio <= b.prio ? a : b));
      if (low.prio >= rule.prio) return { ok: false, reason: 'busy' };
      replaces = low;
    }
    if (rule.chance != null && !req.force && this.rand() >= rule.chance) return { ok: false, reason: 'chance' };
    const vk = `${speaker}|${key}`;
    // lines with a recorded take win when the caller says it has them (req.prefer), so subtitles match the voice
    let pool = lines.map((_, i) => i);
    if (req.prefer) { const p = pool.filter((i) => req.prefer(lines[i])); if (p.length) pool = p; }
    const ix = (this.variantIx.get(vk) ?? rule.first ?? Math.floor(this.rand() * pool.length)) % pool.length;
    const n = pool[ix];
    this.variantIx.set(vk, ix + 1);
    this.last.set(k, now);
    this.lastGlobal.set(key, now);
    this.lastBy.set(key, req.speakerId);
    return { ok: true, line: lines[n], n, replaces, rule };
  }

  /** Register the voice that actually started (after request() said ok). */
  started(req, dur, replaced, handle = null) {
    const rec = { id: req.speakerId, key: req.key, prio: ruleFor(req.key).prio, start: req.now, dur, handle };
    if (req.commando) this.commando = rec;
    else { this.enemy = this.enemy.filter((e) => e !== replaced); this.enemy.push(rec); }
    return rec;
  }

  _expire(now) {
    if (this.commando && now >= this.commando.start + this.commando.dur) this.commando = null;
    this.enemy = this.enemy.filter((e) => now < e.start + e.dur);
  }

  reset() { this.last.clear(); this.lastGlobal.clear(); this.lastBy.clear(); this.commando = null; this.enemy = []; }
}
