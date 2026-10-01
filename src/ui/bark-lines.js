/**
 * Subtitle text for bark keys (design-spec §9.4, SHADOW SIX's own lines). Used by the UI only when a `bark`
 * event carries a key and no text; the audio voice bank owns the real clips. German lines carry an English gloss.
 * @module ui/bark-lines
 */

const L = (s) => s.split(' | ');

/** role → key → lines */
export const COMMANDO_LINES = {
  greenberet: { select: L('Aye? | McHale. | What\'ll it be?'), ack_move: L('On me way. | Right so. | Movin\'. | Grand.'), ack_act: L('Leave him to me. | Quiet as a church mouse.'), act_kill: L('Sleep tight.'), cant: L('Can\'t do that one, sir. | Not with these hands.'), hurt: L('Argh! I\'m grand, I\'m grand! | They\'ve nicked me!'), spotted: L('Ah, feck.'), death: L('Tell me mam…') },
  sniper: { select: L('Woolridge. | At your disposal. | Yes?'), ack_move: L('Very well. | If I must. | Quite.'), ack_act: L('One shot will suffice. | Hold still, there\'s a good fellow.'), act_kill: L('Clean.'), cant: L('Hardly my department, old boy.'), cant_noammo: L('I\'m afraid I\'m out of rounds.'), hurt: L('Blast. I\'m hit. | Rather inconvenient.'), spotted: L('Ah. We\'ve been noticed.'), death: L('Most… unsporting.') },
  diver: { select: L('Blackwood. | Yeah, what now? | Mm?'), ack_move: L('Righto… sir. | Off I go, then. | No worries.'), ack_act: L('Into the drink. | Nice and quiet.'), cant: L('Not without a boat, mate. | In this? You\'re joking.'), hurt: L('Strewth! That stings!'), spotted: L('Oh, bloody marvellous.'), death: L('Should\'ve… stayed in the water.') },
  sapper: { select: L('Hancock. | Sapper here.'), ack_move: L('On it. | Right you are. | Moving.'), ack_act: L('Charge set — ten seconds, run! | This\'ll make a lovely bang. | Wire\'s no bother.'), special_detonate: L('Fire in the hole.'), cant: L('Wrong tool for that.'), hurt: L('Ahh! I\'m hit!'), spotted: L('They\'ve clocked me!'), death: L('Should\'ve… cut the other one.') },
  driver: { select: L('Yeah, boss? | Tread here. | Whaddaya need?'), ack_move: L('You got it. | On my way, boss. | Easy money.'), ack_act: L('Time to make some noise.'), cant: L('Not my line of work, boss.'), hurt: L('Ow! They winged me!'), spotted: L('Uh-oh.'), death: L('Aw, this ain\'t good…') },
  spy: { select: L('Oui? | Duchamp. | Mon capitaine?'), ack_move: L('D\'accord. | Bien sûr. | I go.'), ack_act: L('A small prick… et voilà. | Nobody will notice.'), special_uniform: L('Now I am one of them.'), cant: L('Non. That, I cannot do.'), hurt: L('Aïe! Merde…'), spotted: L('Zut, they know me.'), death: L('Pour… la France…') },
};

/**
 * bodies-design §C.7 buddy-rescue lines (every commando; a role's own line wins). `{name}` = the downed man's nickname.
 * Censored mode keeps them: none is gory.
 */
export const RESCUE_LINES = {
  man_down: L('Man down! | {name}\'s hit! | {name} is down — cover him! | Medic! {name}\'s down!'),
  hurry: L('Hurry, he\'s fading! | {name} won\'t last much longer!'),
  revived: L('Thanks, mate. | Back on my feet. | I owe you one.'),
  moan: L('Ngh… | Aagh… | Can\'t… feel my legs…'),
};

/** German key → [[german, english gloss]] */
export const GERMAN_LINES = {
  ger_halt: [['Halt!', 'Stop!'], ['Stehen bleiben!', 'Stand still!'], ['Wer da?', 'Who\'s there?'], ['Hände hoch!', 'Hands up!'], ['Keine Bewegung!', 'Don\'t move!']],
  ger_suspicious: [['Was war das?', 'What was that?'], ['Da war doch was…', 'There was something…'], ['Hallo? Ist da jemand?', 'Hello? Anyone there?']],
  ger_giveup: [['Nichts. Nur der Wind.', 'Nothing. Just the wind.'], ['Zurück auf Posten.', 'Back to post.']],
  ger_mandown: [['Mann am Boden!', 'Man down!'], ['Hier liegt einer!', 'Someone\'s lying here!']],
  ger_alarm: [['Alarm! Alarm!', 'Alarm! Alarm!'], ['Eindringlinge!', 'Intruders!']],
  ger_combat: [['Feuer!', 'Fire!'], ['Da drüben!', 'Over there!']],
  ger_arrest: [['Mitkommen!', 'Come with us!'], ['Abführen!', 'Take him away!']],
  ger_distracted: [['Jawohl, Herr Offizier!', 'Yes, sir!'], ['Zu Befehl!', 'At your command!']],
  spy_unmask: [['Das ist kein Offizier — ein Spion!', 'That\'s no officer — a spy!']],
  ger_hurt: [['Ich bin getroffen!', 'I\'m hit!']],
  courier: [['Ich hole Verstärkung!', 'I\'ll get reinforcements!']],
};

const ALIASES = { halt: 'ger_halt', suspicious: 'ger_suspicious', giveup: 'ger_giveup', mandown: 'ger_mandown', alarm: 'ger_alarm', combat: 'ger_combat', arrest: 'ger_arrest', distracted: 'ger_distracted' };

/** Laconic mode mutes these (§9.4). */
export const ACK_KEYS = new Set(['select', 'ack_move', 'ack_act']);

/**
 * Resolve a bark payload to subtitle text.
 * @param {{unit?:object, line?:string|object, text?:string}} b
 * @param {number} [n] variant index (deterministic)
 * @returns {{text:string, gloss:string|null, german:boolean, key:string}|null}
 */
export function barkText(b, n = 0) {
  const line = b?.line;
  if (line && typeof line === 'object') return { text: line.text || '', gloss: line.gloss || line.en || null, german: !!(line.de || line.german), key: line.key || line.id || '' };
  // AUDIO-stamped payloads (§9.4): German barks come from speaker 'ger' (enemies) with an English gloss
  if (b?.text) return { text: b.text, gloss: b.gloss || null, german: !!(b.german || b.speaker === 'ger' || (b.gloss && b.unit?.faction === 'enemy')), key: String(line || '') };
  if (!line) return null;
  const key = String(line);
  const role = b.unit?.role;
  const own = role && COMMANDO_LINES[role]?.[key];
  if (own?.length && b.unit?.faction !== 'enemy') return { text: own[n % own.length], gloss: null, german: false, key };
  const rescue = RESCUE_LINES[key];
  if (rescue && b.unit?.faction !== 'enemy') {
    const name = b.about?.nickname || b.about?.name || 'He';
    return { text: rescue[n % rescue.length].replace(/\{name\}/g, name), gloss: null, german: false, key };
  }
  const g = GERMAN_LINES[key] || GERMAN_LINES[ALIASES[key]];
  if (g) {
    const [de, en] = g[n % g.length];
    return { text: de, gloss: en, german: true, key };
  }
  return /\s/.test(key) ? { text: key, gloss: null, german: false, key } : null;
}
