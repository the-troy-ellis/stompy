import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, stepFor, input, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { fire } from '../src/sim/combat.js';
import { applyLoadout, choicesFor } from '../src/sim/loadout.js';
import { WEAPONS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS } from '../src/data/chassis.js';
import { FEEL } from '../src/data/feel.js';

const D = WEAPONS.ppc;
const setup = () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 200, yaw: Math.PI }); initFeet(G, e); freeze(e);
  applyLoadout(G, P, { hp: { la: 'ppc', ra: 'laser', t1: 'ac', t2: 'lrm' }, sys: { sinks: 0, armour: 0, jets: 1 } });
  P.weapons.forEach(w => { w.cd = 0; });
  G.aim = center(e);
  return { G, P, e };
};

test('THUNDERCLAP is an energy weapon any energy hardpoint can take, and the feel table has its rows', () => {
  assert.equal(CAT_OF.ppc, 'energy');
  assert.ok(choicesFor(CHASSIS.kestrel.hardpoints[0]).includes('ppc'));
  assert.ok(FEEL.fireBolt && FEEL.bolt);
  assert.ok(D.tons > 0 && D.fp > 0 && D.bolt);
});

test('held ENERGY fires the bolt beside the beam; it flies at its speed, hits for 14 and scrambles the target for 1.5 s', () => {
  const { G, P, e } = setup();
  const hp = { ...e.hp }, heat0 = P.heat;
  stepFor(G, DT, input({ held: { energy: true } }));
  const bolt = G.shots.find(s => s.type === 'ppc');
  assert.ok(bolt, 'no bolt in the air');
  assert.ok(Math.abs(Math.hypot(...bolt.v) - D.speed) < 0.5, 'flies at its speed (shells drop a little)');
  assert.ok(P.heat - heat0 >= D.heat - 0.5, 'the bolt costs its heat (less one frame of sinking)');
  stepFor(G, 0.6);
  const lost = Object.keys(hp).reduce((a, k) => a + hp[k] - e.hp[k], 0);
  assert.ok(lost >= D.dmg - 1e-6, `took ${lost}`);
  assert.ok(e.scramble > 0 && e.scramble <= D.scramble, `scramble ${e.scramble}`);
  assert.ok(Math.abs(e.wob.p.v) + Math.abs(e.wob.p.x) + Math.abs(e.wob.r.x) + Math.abs(e.wob.r.v) > 0.05, 'no wobble kick');
  stepFor(G, D.scramble + 0.1);
  assert.equal(e.scramble, 0);
  assert.equal(P.weapons.find(w => w.type === 'ppc').cd > 0, true);
});

test('a bolt on the player scrambles the player; on another pilot it rides the hit as zap', () => {
  const G = createTestGame({ foes: ['warden'] });
  const P = G.player, e = foes(G)[0];
  Object.assign(e, { x: 0, z: 200, yaw: Math.PI }); initFeet(G, e);
  applyLoadout(G, e, { hp: { t1: 'lrm', ra: 'ac', la: 'ppc' }, sys: { sinks: 0, armour: 0, jets: 1 } });
  const w = e.weapons.find(x => x.type === 'ppc'); w.cd = 0;
  assert.ok(fire(G, e, w, center(P), P));
  stepFor(G, 0.6);
  assert.ok(P.scramble > 0, 'the player was not scrambled');
  // The arena: the shooter reports it.
  const G2 = createTestGame({ foes: ['warden'] });
  G2.mode = 'mp';
  const r = foes(G2)[0];
  Object.assign(r, { x: 0, z: 200, yaw: Math.PI, remote: true, netId: 7, team: 0 }); initFeet(G2, r); freeze(r);
  applyLoadout(G2, G2.player, { hp: { la: 'ppc', ra: 'laser', t1: 'ac', t2: 'lrm' }, sys: { sinks: 0, armour: 0, jets: 1 } });
  const pw = G2.player.weapons.find(x => x.type === 'ppc'); pw.cd = 0;
  assert.ok(fire(G2, G2.player, pw, center(r), r));
  stepFor(G2, 0.6);
  assert.equal(G2.pendingHits.get(7)?.zap, 1);
  assert.ok(!(r.scramble > 0), 'the remote copy is not scrambled here');
});
