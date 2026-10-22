/**
 * A crawler on a raised deck narrower than he is long (the M3 dam crest, 2 m wide; clipping seed 11: the Sapper came up
 * the E stair feet first, heading down the flight, stepped off the run onto the crest on a heading his head was over the
 * parapet on, and turned on through the headings across it: his hand went 14 cm into it). On raised ground (y > 1, where
 * _guardBody does not watch) he turns only through headings with head and feet over walkable cells of his deck (Unit
 * _lyingOnDeck): back to the nearest such heading when he is on one that is not (_deckEscape), then the short way, the
 * long way round, else his body along his way feet first (_deckTurnHeading) — not swinging from side to side.
 */
import { test, assert } from './lib.mjs';
import { makeSim } from './abilsim.mjs';

const DECK_Y = 7.28, Z0 = 20.5, Z1 = 22.5; // a 2 m wide crest along x (a crawl body, 1.3 m head + 1.05 m feet, does not turn round on it)
const deg = (r) => ((r * 180) / Math.PI + 540) % 360 - 180;

/** A sandbox with a raised deck strip x 4..44, z 20.5..22.5 and a crawling Sapper on it. */
function crestSim(x, heading) {
  const s = makeSim({ commandos: [{ id: 'sap', role: 'sapper', x, z: 21.5 }], enemies: [] });
  const g = s.world.grid;
  for (let j = Math.floor(Z0 / g.cell); j < Math.ceil(Z1 / g.cell); j++) for (let i = Math.floor(4 / g.cell); i < Math.ceil(44 / g.cell); i++) g.elev[g.idx(i, j)] = DECK_Y;
  g.version++;
  const sap = s.cmd('sapper');
  Object.assign(sap, { y: DECK_Y, prevY: DECK_Y, path: null });
  sap.setStance('crawl');
  s.run(2); // (down on his belly: the getting-down turn is over)
  Object.assign(sap, { x, z: 21.5, prevX: x, prevZ: 21.5, heading, prevHeading: heading });
  return { s, sap, g };
}

/** Run 14 s toward the deck's west end; the headings he took (deg) and the ticks with head or feet off the deck. */
function crawlWest(x, heading) {
  const { s, sap } = crestSim(x, heading);
  assert.ok(sap.issue({ type: 'move', x: 6, z: 21.5 }), 'the deck is a way');
  const hs = [];
  let off = 0;
  for (let k = 0; k < 60 * 14; k++) {
    s.step();
    hs.push(deg(sap.heading));
    if (!sap._lyingOnDeck(sap.heading)) off++;
  }
  return { sap, hs, off };
}

test('crest turn: on a heading with his head over the edge he turns back to the deck, not on through the headings across it', () => {
  // 75°: his head 1.3 m ahead is 0.26 m past the deck's south edge; his way is west (180°): the free turn went 75° → 180° across it
  const { sap, hs } = crawlWest(30, (75 * Math.PI) / 180);
  assert.ok(Math.max(...hs.slice(0, 120)) <= 80, `his heading never swept the headings across the deck (max ${Math.max(...hs.slice(0, 120)).toFixed(0)}°)`);
  assert.ok(sap.x < 24, `and he went on along the deck (x ${sap.x.toFixed(1)})`);
});

test('crest turn: no room to turn round, he crawls his way feet first along the deck, steady (no side-to-side swinging)', () => {
  const { sap, hs, off } = crawlWest(30, (40 * Math.PI) / 180);
  assert.equal(off, 0, 'head and feet stay over the deck the whole way');
  const late = hs.slice(60 * 6);
  assert.ok(late.every((h) => Math.abs(h) < 12), `feet first: his body lies along the deck, head east (${Math.min(...late).toFixed(0)}° … ${Math.max(...late).toFixed(0)}°)`);
  assert.ok(sap.x < 24, `and he went on west along the deck (x ${sap.x.toFixed(1)})`);
});
