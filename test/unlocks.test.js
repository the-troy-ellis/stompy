import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHASSIS, MECH_ORDER, isUnlocked, lockedLook } from '../src/data/chassis.js';
import { NAMES } from '../src/data/names.js';
import { menuBand } from '../src/render/scene.js';

test('six chassis in the selector; the new ones unlock after missions 6, 8 and 11', () => {
  assert.equal(MECH_ORDER.length, 6);
  assert.deepEqual(MECH_ORDER.slice(0, 3), ['kestrel', 'jackal', 'warden'], 'the old three first');
  assert.equal(MECH_ORDER.at(-1), 'puncher', 'the set piece last');
  for (const k of ['kestrel', 'jackal', 'warden']) assert.ok(isUnlocked(k, 0), `${k} is open from the start`);
  const at = { light1: 6, sniper1: 8, puncher: 11 };
  for (const [k, n] of Object.entries(at)) {
    assert.ok(!isUnlocked(k, n - 1), `${k} locked after ${n - 1}`);
    assert.ok(isUnlocked(k, n), `${k} open after ${n}`);
  }
});

test('a locked chassis is a dark silhouette, except PURPLE PUNCHER, which stays purple', () => {
  for (const k of ['light1', 'sniper1']) {
    const l = lockedLook(CHASSIS[k]);
    assert.ok(Math.max(...l.col, ...l.acc) < 0.1, `${k} should be near black`);
  }
  const p = lockedLook(CHASSIS.puncher);
  assert.ok(p.col[2] > p.col[0] && p.col[0] > p.col[1] && p.col[2] > 0.3, 'still purple');
  assert.deepEqual(p.acc, p.col, 'fists and all');
});

test('the menu says LOCKED and which mission opens it; the old three have their new role lines', () => {
  assert.equal(NAMES.locked(6), 'LOCKED · CLEAR MISSION 6');
  assert.equal(NAMES.roles.kestrel.role, 'REVERSE-JOINT · DOES A BIT OF EVERYTHING');
  assert.equal(NAMES.roles.jackal.role, 'FORWARD-JOINT · FAST, FLIMSY');
  assert.equal(NAMES.roles.warden.role, 'QUADRUPED · SLOW, STUBBORN');
  for (const k of MECH_ORDER) assert.ok(NAMES.roles[k]?.role, `${k} has a role line`);
});

test('the menu mech stands between the top of the screen and the selector panel', () => {
  const desk = menuBand(640, 416), phone = menuBand(360, 150);
  assert.ok(desk.top > 0.8 && phone.top > 0.8);
  assert.ok(Math.abs(phone.bottom - (1 - 2 * (150 / 360 - 0.03))) < 1e-9, 'its feet just above the panel');
  assert.ok(phone.bottom > desk.bottom, 'on a phone the panel is higher, so the band ends higher');
  assert.ok(menuBand(360, 5).bottom <= 1 - 2 * (0.35 - 0.03) + 1e-9, 'never squeezed to nothing');
});
