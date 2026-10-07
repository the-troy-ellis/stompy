import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lobbyHTML } from '../src/ui/lobby.js';
import * as P from '../src/net/protocol.js';

// The arena lobby (#185, spec 08 § Lobby).
test('the lobby lists each pilot with chassis, ping and whether they are in, under the mode, map and limit', () => {
  const html = lobbyHTML({ pilots: [{ id: 1, name: 'TROY', color: 0, ch: 'kestrel', ping: 23, ready: 1 }, { id: 2, name: '<B>', color: 1, ch: 'puncher', ping: 0, ready: 0 }], me: 1, mode: 'ffa', pal: 'ice', limit: 10 });
  assert.match(html, /FREE-FOR-ALL · GLACIER · FIRST TO 10/);
  assert.match(html, /TROY<\/td>\s*<td>KESTREL<\/td>\s*<td class="dim">23 ms<\/td>\s*<td>IN<\/td>/);
  assert.match(html, /PURPLE PUNCHER/);
  assert.match(html, /&lt;B&gt;/, 'callsigns are escaped');
  assert.match(html, /--<\/td>\s*<td><span class="dim">HERE/);
  assert.match(html, /data-a="ready">READY/);
  assert.match(html, /data-a="leave">LEAVE/);
  assert.match(html, /<tr class="me">[\s\S]*TROY/);
});

test('hello carries the chassis; ready and ping go out as the relay expects', () => {
  assert.deepEqual(P.hello('A', 2, 'warden'), { t: 'hello', v: P.PROTOCOL, name: 'A', color: 2, ch: 'warden' });
  assert.deepEqual(P.ready(), { t: 'ready' });
  assert.deepEqual(P.ping(3, 41.6), { t: 'ping', n: 3, rtt: 42 });
  assert.ok(P.PROTOCOL >= 9);
});
