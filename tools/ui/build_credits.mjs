#!/usr/bin/env node
/**
 * CREDITS.md → src/ui/credits-data.js (docs/menus-art-direction.md S12: "the credits list is generated from
 * CREDITS.md at build time"). Run after editing CREDITS.md: node tools/ui/build_credits.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const md = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
const clean = (s) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').replace(/\*|_\(|\)_/g, '').replace(/<!--.*?-->/g, '').trim();
const sections = [];
let cur = null;
let intro = [];
for (const line of md.split('\n')) {
  const h = /^##\s+(.*)$/.exec(line);
  if (h) {
    cur = { title: clean(h[1]).toUpperCase(), rows: [], text: [] };
    sections.push(cur);
    continue;
  }
  if (!cur) {
    if (line.trim() && !line.startsWith('#')) intro.push(clean(line));
    continue;
  }
  if (/^\|\s*-/.test(line)) continue;
  const m = /^\|(.*)\|\s*$/.exec(line);
  if (m) {
    const cells = m[1].split('|').map(clean);
    if (/^(component|asset)$/i.test(cells[0])) continue; // header row
    if (cells[0] && !/^—?$/.test(cells[0])) cur.rows.push(cells);
  } else if (line.trim() && !line.startsWith('<!--')) cur.text.push(clean(line));
}
const out = `/* Generated from CREDITS.md by tools/ui/build_credits.mjs. Do not edit by hand. */
export const CREDITS_INTRO = ${JSON.stringify(intro.join(' '))};
export const CREDITS_SECTIONS = ${JSON.stringify(sections, null, 1)};
`;
writeFileSync(join(ROOT, 'src/ui/credits-data.js'), out);
console.log('credits-data.js:', sections.map((s) => `${s.title} (${s.rows.length})`).join(', '));
