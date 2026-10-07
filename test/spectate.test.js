import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from './helpers.js';
import { newMech } from '../src/sim/state.js';
import { viewYaw } from '../src/sim/geom.js';
import { startSpectate, nextSpectate, orbitSpectate, spectated, spectateCamera, SPECTATE } from '../src/net/spectate.js';

// The arena's spectator camera (#188, spec 08 § Spectate).
const arena = () => {
  const G = createTestGame({ foes: [] });
  for (const [id, x] of [[2, 100], [5, -150], [3, 40]]) {
    const m = newMech(G, 'kestrel', 0, x, 200, 0);
    Object.assign(m, { remote: true, netId: id });
    G.mechs.push(m);
  }
  G.player.alive = false;
  return G;
};
const byId = (G, id) => G.mechs.find(m => m.netId === id);

test('spectating starts on your killer, or the first pilot alive if the killer is gone', () => {
  const G = arena();
  assert.equal(startSpectate(G, 5).id, 5);
  byId(G, 5).alive = false;
  assert.equal(startSpectate(G, 5).id, 2, 'the lowest id still standing');
  assert.equal(startSpectate(G, 0).id, 2, 'no killer (you went down on your own)');
});

test('TGT cycles through the pilots alive; a watched pilot who dies hands over to the next', () => {
  const G = arena();
  startSpectate(G, 2);
  nextSpectate(G); assert.equal(G.spectate.id, 3);
  nextSpectate(G); assert.equal(G.spectate.id, 5);
  nextSpectate(G); assert.equal(G.spectate.id, 2, 'round again');
  byId(G, 2).alive = false;
  assert.equal(spectated(G).netId, 3);
  assert.equal(G.spectate.id, 3);
  for (const id of [3, 5]) byId(G, id).alive = false;
  assert.equal(spectated(G), null);
  assert.equal(spectateCamera(G), null, 'nobody left: the renderer keeps the cockpit view');
});

test('the camera sits behind and above the pilot, orbits, and never goes into the ground', () => {
  const G = arena(), m = byId(G, 2);
  m.yaw = 0.7; m.twist = 0.3;
  startSpectate(G, 2);
  const { eye, at } = spectateCamera(G), fwd = [Math.sin(viewYaw(m)), Math.cos(viewYaw(m))];
  assert.ok((eye[0] - at[0]) * fwd[0] + (eye[2] - at[2]) * fwd[1] < 0, 'behind where the torso faces');
  assert.ok(eye[1] > at[1], 'above');
  orbitSpectate(G, Math.PI, 10);
  assert.equal(G.spectate.pitch, SPECTATE.pitchMax, 'the orbit pitch is clamped');
  const front = spectateCamera(G).eye;
  assert.ok((front[0] - at[0]) * fwd[0] + (front[2] - at[2]) * fwd[1] > 0, 'orbited round to the front');
  orbitSpectate(G, 0, -10);
  G.ter = { ...G.ter, height: () => 1000 };   // a cliff behind
  const low = spectateCamera(G).eye;
  assert.ok(low[1] >= 1000 + SPECTATE.ground);
});
