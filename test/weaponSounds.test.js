import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestGame, stepFor, input, foes, freeze, DT } from './helpers.js';
import { initFeet } from '../src/sim/gait.js';
import { center } from '../src/sim/geom.js';
import { fire } from '../src/sim/combat.js';
import { applyLoadout } from '../src/sim/loadout.js';
import { WEAPONS } from '../src/data/weapons.js';
import { nullFx } from '../src/sim/fx.js';

const RECIPES = { ppc: 'thunderclap', gauss: 'bonker', mg: 'peashooter', flamer: 'toaster' };

test('each new weapon names its own recipe, and the recipe exists in the sim sink and the audio module', () => {
  const src = readFileSync(new URL('../src/audio/sound.js', import.meta.url), 'utf8');
  for (const [w, k] of Object.entries(RECIPES)) {
    assert.equal(WEAPONS[w].sfx, k, w);
    assert.equal(typeof nullFx.sfx[k], 'function', `the fx sink lacks ${k}`);
    assert.match(src, new RegExp(`\\n    ${k}\\(p\\) \\{`), `sound.js lacks ${k}(p)`);
  }
});

test('firing a shell plays its recipe, not the cannon; PEASHOOTER ticks once per round', () => {
  for (const w of ['ppc', 'gauss', 'mg']) {
    const G = createTestGame({ foes: ['warden'] });
    const P = G.player, e = foes(G)[0];
    Object.assign(e, { x: 0, z: 150, yaw: Math.PI }); initFeet(G, e); freeze(e);
    const slot = w === 'ppc' ? 'la' : 't1';
    applyLoadout(G, P, { hp: { la: null, ra: null, t1: null, t2: null, [slot]: w }, sys: { sinks: 0, armour: 0, jets: 1 } });
    const wp = P.weapons.find(x => x.type === w); wp.cd = 0;
    assert.ok(fire(G, P, wp, center(e), e));
    stepFor(G, 0.4);
    assert.equal(G.fx.calls('sfx.' + RECIPES[w]).length, w === 'mg' ? WEAPONS.mg.burst.n : 1, w);
    assert.equal(G.fx.calls('sfx.cannon').length, 0, `${w} should not sound like the autocannon`);
  }
});

test('TOASTER roars once as it lights, instead of the laser zap; a laser alongside still zaps', () => {
  const G = createTestGame({ foes: ['warden'] });
  const e = foes(G)[0];
  Object.assign(e, { x: 0, z: 60, yaw: Math.PI }); initFeet(G, e); freeze(e);
  applyLoadout(G, G.player, { hp: { la: 'flamer', ra: null, t1: null, t2: null }, sys: { sinks: 0, armour: 0, jets: 1 } });
  G.aim = center(e);
  stepFor(G, 1, input({ held: { energy: true } }));
  assert.equal(G.fx.calls('sfx.toaster').length, 1);
  assert.equal(G.fx.calls('sfx.laser').length, 0);
  const G2 = createTestGame({ foes: ['warden'] });
  applyLoadout(G2, G2.player, { hp: { la: 'flamer', ra: 'laser', t1: null, t2: null }, sys: { sinks: 0, armour: 0, jets: 1 } });
  stepFor(G2, DT * 3, input({ held: { energy: true } }));
  assert.equal(G2.fx.calls('sfx.toaster').length, 1);
  assert.equal(G2.fx.calls('sfx.laser').length, 1);
});
