import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryHTML, summaryRows, voteOf, VOTES, otherMode } from '../src/ui/summary.js';
import * as P from '../src/net/protocol.js';

// The round-end summary and vote (#187, spec 08 § Vote).
const pilots = [
  { id: 1, name: 'A', color: 0, kills: 3, deaths: 1, acc: 42, best: 2, team: 0 },
  { id: 2, name: 'B', color: 1, kills: 5, deaths: 0, acc: -1, best: 5, team: 1 },
];

test('the summary lists kills, deaths, accuracy and best streak, the winner first, and three votes', () => {
  const html = summaryHTML({ pilots, me: 1, mode: 'ffa', title: 'B WINS THE ROUND', votes: [0, 2, 1], mine: 1, next: 10 });
  assert.match(html, /<h1>B WINS THE ROUND<\/h1>/);
  assert.match(html, /B<\/td>\s*<td>5<\/td><td>0<\/td><td><span class="dim">--<\/span><\/td><td>5<\/td>[\s\S]*A<\/td>\s*<td>3<\/td><td>1<\/td><td>42%<\/td><td>2<\/td>/, 'most kills first; no accuracy yet is --');
  assert.match(html, /data-v="0">NEXT MAP<span class="n"><\/span>/);
  assert.match(html, /class="go on" data-a="vote" data-v="1">SAME MAP<span class="n"> · 2<\/span>/, 'my vote lit, with its count');
  assert.match(html, /data-v="2">TEAM DEATHMATCH<span class="n"> · 1/, 'the other mode');
  assert.match(html, /Next round in <span class="next-in">10<\/span> s/);
  assert.match(summaryHTML({ pilots, me: 1, mode: 'tdm', title: 'X' }), /data-v="2">FREE-FOR-ALL/);
});

test('in team deathmatch the rows go by side', () => {
  const rows = summaryRows({ pilots, me: 1, mode: 'tdm' });
  assert.match(rows, /A<\/td><td>STEEL<\/td>[\s\S]*B<\/td><td>RED<\/td>/);
});

test('each button sends vote { map, mode } in the order the relay counts them', () => {
  assert.deepEqual(VOTES, ['next', 'same', 'mode']);
  assert.deepEqual(voteOf(0, 'ffa'), { map: 'next', mode: 'ffa' });
  assert.deepEqual(voteOf(1, 'ffa'), { map: 'same', mode: 'ffa' });
  assert.deepEqual(voteOf(2, 'ffa'), { map: 'next', mode: 'tdm' });
  assert.deepEqual(voteOf(2, 'tdm'), { map: 'next', mode: 'ffa' });
  assert.equal(otherMode('tdm'), 'ffa');
  assert.deepEqual(P.vote('same', 'ffa'), { t: 'vote', map: 'same', mode: 'ffa' });
  assert.deepEqual(P.roundStats(41.6), { t: 'stats', acc: 42 });
});

test('the relay counts the same options in the same order', async () => {
  const { readFileSync } = await import('node:fs');
  const py = readFileSync(new URL('../server/server.py', import.meta.url), 'utf8');
  assert.deepEqual([...py.match(/^VOTES = \(([^)]*)\)/m)[1].matchAll(/"(\w+)"/g)].map(m => m[1]), VOTES);
});
