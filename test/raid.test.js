// Build and fight, raids and salvage (docs/specs/20-build-and-fight.md § The
// raid, § Raids go for buildings): a raid is called with where it comes from
// and what is in it, and goes for the base; a foe's wreck gives salvage when
// a crew mech walks over it; `keep` fails when the silo falls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startMatch } from '../src/sim/state.js';
import { recordFx } from '../src/sim/fx.js';
import { destroy } from '../src/sim/combat.js';
import { damageEntity } from '../src/sim/entities.js';
import { raidLine, raidTarget, RAID_NEAR } from '../src/sim/raid.js';
import { spawnWave } from '../src/sim/waves.js';
import { placeFactory } from '../src/sim/base.js';
import { CONSTRUCT } from '../src/data/construct.js';
import { CHASSIS } from '../src/data/chassis.js';
import { rangeDef } from '../src/data/range.js';
import { check } from '../src/data/missionIO.js';
import { stepFor, freeze } from './helpers.js';

const KEEP = { type: 'keep', targets: ['silo'], label: 'SILO' };
const mission = (over = {}) => ({ name: 'Raid', pal: 'dusk', intel: '', foes: [], base: { silo: [-40, 70] }, objectives: [KEEP, { type: 'survive', seconds: 120 }], ...over });
const game = (def = mission()) => {
  const G = createGame({ fx: recordFx(), seed: 5 });
  startMatch(G, def, 5, false, 'kestrel', { terrainOpts: { flat: true } });
  return G;
};
const said = G => G.fx.calls('say').map(c => c.args[0]);
const J = CHASSIS.jackal.name;

test('a raid is called with where it comes from and what is in it', () => {
  assert.equal(raidLine({ from: 270 }, ['jackal', 'jackal']), `Raid west. Two ${J}s.`);
  assert.equal(raidLine({ from: 90 }, ['jackal', 'kestrel']), `Raid east. One ${J} and one ${CHASSIS.kestrel.name}.`);
  assert.equal(raidLine({ from: 'ring' }, ['jackal']), `Raid inbound. One ${J}.`);
});

test('a mission\'s raid wave is called a few seconds early, then walks on as raiders', () => {
  const G = game(mission({ waves: [{ at: 5, from: 270, foes: ['jackal', 'jackal'], raid: true }] }));
  stepFor(G, 1.5);
  assert.ok(!said(G).some(l => l.startsWith('Raid')), 'not yet');
  stepFor(G, 1);
  assert.ok(said(G).includes(`Raid west. Two ${J}s.`));
  assert.equal(G.mechs.filter(m => m.team === 1).length, 0, 'called before it comes');
  stepFor(G, 2.7);
  const raiders = G.mechs.filter(m => m.team === 1);
  assert.equal(raiders.length, 2);
  assert.ok(raiders.every(m => m.ai.raid && m.ai.aware));
});

test('raiders go for the nearest standing building, unless a crew mech is close', () => {
  const G = game(), P = G.player, s = G.base.silo;
  Object.assign(P, { x: 0, z: -600 });
  const [e] = spawnWave(G, ['jackal'], { from: 90, raid: true });
  Object.assign(e, { x: s.x + 300, z: s.z });
  assert.equal(raidTarget(G, e), s, 'the silo');
  G.base.ore = 200;
  Object.assign(P, { x: s.x + 200, z: s.z + 60, yaw: Math.PI / 2, twist: 0 });
  assert.ok(placeFactory(G, P));
  Object.assign(P, { x: 0, z: -600 });
  assert.equal(raidTarget(G, e), G.base.factory, 'the factory is nearer');
  destroy(G, G.base.factory, null); G.base.factory.alive = false;
  assert.equal(raidTarget(G, e), s, 'that one down: the silo again');
  Object.assign(P, { x: e.x - RAID_NEAR + 20, z: e.z });
  assert.equal(raidTarget(G, e), null, 'you, close by: it fights you');
});

test('left alone, a raider walks up to the silo and shoots it', () => {
  const G = game(mission({ objectives: [] })), P = G.player, s = G.base.silo;
  Object.assign(P, { x: -500, z: -500 }); freeze(P);
  const [e] = spawnWave(G, ['jackal'], { from: 90, raid: true });
  Object.assign(e, { x: s.x + 320, z: s.z });
  const hp = s.hp;
  stepFor(G, 25);
  assert.ok(s.hp < hp, `the silo took ${hp - s.hp}`);
});

test('a foe\'s wreck gives its salvage when a crew mech walks over it; the wreck stays', () => {
  const G = game(mission({ objectives: [], foes: [{ type: 'jackal', at: [180, 60] }] })), P = G.player, e = G.mechs.find(m => m.team === 1);
  freeze(e);
  destroy(G, e, P);
  stepFor(G, 6);
  const w = G.wrecks[0];
  assert.ok(w, 'it fell');
  assert.equal(w.salvage, CONSTRUCT.salvage.jackal);
  assert.equal(G.base.salvage, 0, 'not yet');
  Object.assign(P, { x: w.x + 2, z: w.z });
  stepFor(G, 0.1);
  assert.equal(G.base.salvage, CONSTRUCT.salvage.jackal);
  assert.equal(w.salvage, 0, 'once');
  assert.ok(said(G).includes('Salvage in.'));
  assert.ok(G.wrecks.includes(w), 'the wreck stays as scenery');
});

test('salvage goes by chassis, and with no base a wreck gives none', () => {
  for (const [type, worth] of Object.entries(CONSTRUCT.salvage)) {
    const G = game(mission({ objectives: [], foes: [{ type, at: [180, 80] }] })), e = G.mechs.find(m => m.team === 1);
    freeze(e); destroy(G, e, G.player); stepFor(G, 6);
    assert.equal(G.wrecks[0].salvage, worth, type);
  }
  const G = game(mission({ base: undefined, objectives: [], foes: [{ type: 'jackal', at: [180, 60] }] })), e = G.mechs.find(m => m.team === 1);
  freeze(e); destroy(G, e, G.player); stepFor(G, 6);
  assert.equal(G.wrecks[0].salvage, 0);
});

test('keep: the silo hit is said, the silo down fails the mission', () => {
  const G = game(), s = G.base.silo;
  stepFor(G, 0.2);
  assert.equal(G.objectives[0].state, 'active');
  damageEntity(G, s, 10, null);
  stepFor(G, 0.2);
  assert.ok(said(G).includes('Silo hit.'));
  damageEntity(G, s, CONSTRUCT.siloHp, null);
  stepFor(G, 0.2);
  assert.equal(G.objectives[0].state, 'failed');
  assert.equal(G.state, 'over');
  assert.equal(G.won, false);
});

test('keep is held, not done: the mission goes on until the rest is won, and then it is done', () => {
  const G = game(mission({ objectives: [KEEP, { type: 'survive', seconds: 4 }] }));
  stepFor(G, 2);
  assert.equal(G.state, 'play');
  stepFor(G, 2.5);
  assert.equal(G.state, 'over');
  assert.equal(G.won, true);
  assert.equal(G.objectives[0].state, 'done');
});

test('a mission with a base can keep its silo without tagging anything; the range can send a raid', () => {
  assert.deepEqual(check(mission()).filter(p => p.id.startsWith('objectives')), []);
  const def = rangeDef({ base: 'raid' });
  assert.ok(def.base && def.waves[0].raid);
});
