import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addKill, liveKills, killWords, KILLFEED_MAX, KILLFEED_LIFE } from '../src/net/killfeed.js';

// The kill feed (#190, spec 08 § Kill feed).
test('the feed keeps the last four kills, each fading out over 6 s', () => {
  const feed = [];
  for (let i = 1; i <= 6; i++) addKill(feed, { killer: i, victim: 9, me: false, at: i * 1000 });
  assert.equal(feed.length, KILLFEED_MAX);
  assert.deepEqual(feed.map(e => e.killer), [3, 4, 5, 6], 'the oldest go first');
  const live = liveKills(feed, 6000);
  assert.deepEqual(live.map(e => +e.alpha.toFixed(3)), [1 - 3000 / KILLFEED_LIFE, 1 - 2000 / KILLFEED_LIFE, 1 - 1000 / KILLFEED_LIFE, 1].map(a => +a.toFixed(3)));
  assert.deepEqual(liveKills(feed, 3000 + KILLFEED_LIFE).map(e => e.killer), [4, 5, 6], 'one at 6 s is gone');
  assert.equal(feed.length, 3);
});

test('a kill reads KILLER DESTROYED VICTIM, a punch PUNCHED OUT, and a pilot alone WENT DOWN', () => {
  const name = id => ({ 1: 'ACE', 2: 'BOB' })[id];
  assert.deepEqual(killWords({ killer: 1, victim: 2 }, name), ['ACE', 'DESTROYED', 'BOB']);
  assert.deepEqual(killWords({ killer: 1, victim: 2, me: true }, name), ['ACE', 'PUNCHED OUT', 'BOB']);
  assert.deepEqual(killWords({ killer: 0, victim: 2 }, name), ['', 'WENT DOWN', 'BOB']);
});
