// Dump every line the narrator reads as JSON: node tools/audio/narration/dump-text.mjs > lines.json
//   {<mission id>: [{id, text}]}  the part-1 briefing of each mission (ui/briefing-text.js: head, hist, p0.., rules)
//   {tour: [{id, text}]}           the Colonel's tour captions of every mission, each distinct text once (ui/tour.js
//                                  tourNarrationLines over the mission's world as the briefing builds it); the id is a
//                                  hash of the text, so a caption keeps its clip when others change
import { register } from 'node:module';
register('../../../tests/unit/resolve-hooks.mjs', import.meta.url);
const { MISSIONS } = await import('../../../src/missions/index.js');
const { briefingNarrationLines } = await import('../../../src/ui/briefing-text.js');
const { missionTourLines, tourClipId } = await import('./tour-world.mjs');
const out = {};
const tour = new Map();
const log = console.log;
console.log = console.info = console.warn = () => {}; // the map builder's chatter must not reach stdout
for (const def of MISSIONS) {
  const lines = briefingNarrationLines(def);
  if (lines.length) out[def.id] = lines;
  for (const l of missionTourLines(def)) tour.set(l.text, { id: tourClipId(l.text), text: l.text });
}
console.log = log;
out.tour = [...tour.values()].sort((a, b) => a.id.localeCompare(b.id));
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
