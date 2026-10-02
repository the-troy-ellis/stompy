import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, CATS, CAT_OF } from '../src/data/weapons.js';
import { CHASSIS, MECH_ORDER, MECH_INFO, HPK } from '../src/data/chassis.js';
import { GEO } from '../src/data/geo.js';
import { PALS } from '../src/data/palettes.js';
import { MISSIONS, missionDef } from '../src/data/missions.js';
import { NAMES } from '../src/data/names.js';

test('every chassis weapon and mount exists', () => {
  for (const [k, ch] of Object.entries(CHASSIS)) {
    assert.ok(GEO[ch.legs], `${k} legs`);
    assert.equal(ch.name, NAMES.chassis[k]);
    for (const [w, mount] of ch.weapons) { assert.ok(WEAPONS[w], `${k} ${w}`); assert.ok(HPK.includes(mount)); assert.ok(CATS.includes(CAT_OF[w])); }
    for (const s of HPK) assert.ok(ch.hp[s] > 0);
  }
  for (const k of MECH_ORDER) { assert.ok(CHASSIS[k]); assert.ok(MECH_INFO[k]); }
  for (const w of Object.keys(WEAPONS)) { assert.ok(CAT_OF[w], `category for ${w}`); assert.equal(WEAPONS[w].name, NAMES.weapons[w]); }
});
test('missions reference real palettes and chassis, and contracts continue', () => {
  for (let n = 0; n < MISSIONS.length + 6; n++) {
    const d = missionDef(n);
    assert.ok(PALS[d.pal], `${d.name} palette`);
    assert.ok(d.foes.length > 0);
    for (const f of d.foes) assert.ok(CHASSIS[f]);
  }
  assert.ok(missionDef(20).foes.length > missionDef(4).foes.length);
});
