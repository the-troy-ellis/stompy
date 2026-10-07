import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { damage } from '../src/sim/combat.js';
import { makeRng } from '../src/sim/rng.js';
import { BOUND } from '../src/world/terrain.js';
import { spawnPoint, sideOf, teamName, TEAM_COLORS } from '../src/net/teams.js';
import { lobbyHTML, lobbyRows } from '../src/ui/lobby.js';
import * as P from '../src/net/protocol.js';
import { DEFAULT_MELEE } from '../src/data/melee.js';

// Team deathmatch (#186, spec 08 § Modes).
test('spawnPoint(side) keeps a team on its own half, clear of the middle; free-for-all goes anywhere', () => {
  const G = createTestGame({ foes: ['jackal'] }), r = makeRng(3), rand = () => r.next();
  foes(G)[0].alive = false;
  for (const side of [-1, 1]) for (let i = 0; i < 300; i++) {
    const [x, z] = spawnPoint(G, side, rand);
    assert.ok(z * side > 25, `side ${side}: z ${z}`);
    assert.ok(Math.hypot(x, z) <= BOUND - 80 + 1e-6);
  }
  const zs = Array.from({ length: 300 }, () => spawnPoint(G, 0, rand)[1]);
  assert.ok(zs.some(z => z < -100) && zs.some(z => z > 100), 'free-for-all: both halves');
  assert.equal(sideOf('tdm', 0), -1); assert.equal(sideOf('tdm', 1), 1); assert.equal(sideOf('ffa', 1), 0);
});

test('a spawn keeps away from hostiles but not from teammates', () => {
  const G = createTestGame({ foes: ['jackal', 'jackal'] }), [a, b] = foes(G), r = makeRng(5), rand = () => r.next();
  Object.assign(a, { x: 0, z: -300 }); Object.assign(b, { x: 0, z: -300 });
  const far = Array.from({ length: 50 }, () => spawnPoint(G, -1, rand)).map(([x, z]) => Math.hypot(x - a.x, z - a.z));
  assert.ok(Math.min(...far) > 250, 'clear of the hostile on our half');
  a.team = 0; b.team = 0;   // both teammates now: they don't push the spawn away
  const near = Array.from({ length: 50 }, () => spawnPoint(G, -1, rand)).map(([x, z]) => Math.hypot(x - a.x, z - a.z));
  assert.ok(Math.min(...near) < 250, 'anywhere on our half');
});

// A foe standing in for a teammate in the arena, as net/client.js marks one.
function mateNearby() {
  const G = createTestGame({ foes: ['jackal'] });
  G.mode = 'mp';
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 7, yaw: Math.PI, remote: true, netId: 2, team: 0, mate: true }); initFeet(G, e); freeze(e);
  e.net = { x: e.x, y: e.y, z: e.z, yaw: e.yaw, tw: 0, p: 0, sp: 0, air: 0, al: 1, sd: 0, pu: 0, at: G.clock };
  return { G, e };
}

test('friendly fire is off: hitting or punching a teammate queues nothing to send and scores nothing', () => {
  const { G, e } = mateNearby();
  damage(G, e, [e.x, e.y + 4, e.z], 20, G.player);
  assert.equal(G.pendingHits.size, 0);
  assert.equal(G.stats.hits, 0);
  stepFor(G, 1 / 60, input({ punch: true }));
  stepFor(G, DEFAULT_MELEE.windup + 0.05);
  assert.ok(!G.pendingHits.get(2)?.amt, 'no punch damage for a teammate');
  e.mate = false;   // the same pilot on the other side: it counts
  damage(G, e, [e.x, e.y + 4, e.z], 20, G.player);
  assert.equal(G.pendingHits.get(2).amt, 20);
});

test('the lobby in team deathmatch: sides in the rows, STEEL first, and a picker with yours lit', () => {
  const pilots = [{ id: 1, name: 'A', color: 1, ch: 'kestrel', ping: 20, ready: 0, team: 1 }, { id: 2, name: 'B', color: 0, ch: 'warden', ping: 30, ready: 1, team: 0 }];
  const html = lobbyHTML({ pilots, me: 1, mode: 'tdm', pal: 'dusk', limit: 20 });
  assert.match(html, /TEAM DEATHMATCH · .* · FIRST TO 20/);
  assert.match(html, /data-mode="tdm"/);
  assert.match(html, /B<\/td>\s*<td>STEEL<\/td>[\s\S]*A<\/td>\s*<td>RED<\/td>/, 'STEEL first, each row with its side');
  assert.match(html, /<button class="go" data-a="team" data-team="0">/);
  assert.match(html, /<button class="go on" data-a="team" data-team="1">/, 'my side lit');
  assert.match(html, /Pick a side/);
  const ffa = lobbyHTML({ pilots, me: 1, mode: 'ffa', pal: 'dusk', limit: 10 });
  assert.doesNotMatch(ffa, /data-team|STEEL<\/td>/, 'no sides in a free-for-all');
  assert.doesNotMatch(lobbyRows({ pilots, me: 1, mode: 'ffa' }), /RED<\/td>/);
});

test('the team message, the side names and colours', () => {
  assert.deepEqual(P.team(1), { t: 'team', team: 1 });
  assert.deepEqual(P.team(0), { t: 'team', team: 0 });
  assert.ok(P.PROTOCOL >= 10);
  assert.deepEqual([teamName(0), teamName(1)], ['STEEL', 'RED']);
  assert.deepEqual(TEAM_COLORS, [0, 1]);
});

test('the relay forces the same team colours as the game', async () => {
  const { readFileSync } = await import('node:fs');
  const py = readFileSync(new URL('../server/server.py', import.meta.url), 'utf8');
  assert.deepEqual(py.match(/^TEAM_COLORS = \(([^)]*)\)/m)[1].split(',').map(Number), TEAM_COLORS);
});
