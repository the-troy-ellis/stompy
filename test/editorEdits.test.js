// The mission editor's edits on a mission (src/ui/editor.js): placing,
// moving, turning, removing and routes, on the definition itself, so what the
// editor does to a mission is exactly what export writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, moveTo, faceTo, remove, findSource, routeOf, setRoute, mapThings } from '../src/ui/editor.js';
import { toSource, fromSource, check } from '../src/data/missionIO.js';
import { MISSIONS } from '../src/data/missions.js';
import { polar } from '../src/sim/placement.js';
import { createGame, startMatch } from '../src/sim/state.js';

const copy = key => fromSource(toSource(MISSIONS.find(m => m.key === key)));

test('placing makes each kind with a fresh id, at a rounded spot', () => {
  const d = copy('m02');
  const p = polar([33.4, 251]);
  assert.equal(place(d, 'FOE', p.x, p.z), 'foes.2');
  assert.deepEqual(d.foes[2], { type: 'jackal', at: [33, 250] });
  assert.equal(place(d, 'STRUCTURE', p.x, p.z), 'entities.relay4', 'm02 has relay1 to relay3');
  assert.equal(place(d, 'TURRET', p.x, p.z), 'entities.launcher1');
  assert.equal(place(d, 'PAD', p.x, p.z), 'entities.lz1');
  assert.equal(place(d, 'NAV', p.x, p.z), 'entities.nav1');
  assert.equal(place(d, 'VEHICLE', p.x, p.z), 'entities.truck1');
  const truck = findSource(d, 'entities.truck1').item;
  assert.deepEqual(truck.path, [[33, 250], [33, 450]]);
  assert.match(toSource(d), /\{ \.\.\.TRUCK, id: 'truck1'/);
  assert.match(toSource(d), /\{ \.\.\.RELAY, id: 'relay4', at: \[33, 250\] \}/);
  assert.equal(place(d, 'NOTHING', 0, 0), null);
});

test('moving rounds only what moved, and a ring foe gets a place', () => {
  const d = copy('m03'), before = toSource(d);
  const p = polar([101.2, 333]);
  moveTo(d, 'entities.truck2', p.x, p.z);
  const after = toSource(d), changed = before.split('\n').filter((l, i) => l !== after.split('\n')[i]);
  assert.equal(changed.length, 1, 'one line changed');
  assert.match(changed[0], /truck2/);
  assert.deepEqual(findSource(d, 'entities.truck3').item.at, [213, 151], 'the others keep their numbers');
  assert.deepEqual(findSource(d, 'entities.truck2').item.at, [101, 335]);
  const f = { key: 'm99', foes: ['jackal'] };
  moveTo(f, 'foes.0', ...Object.values(polar([0, 400])));
  assert.deepEqual(f.foes[0], { type: 'jackal', at: [0, 400] });
  moveTo(f, 'start', ...Object.values(polar([90, 102])));
  assert.deepEqual(f.start, [90, 100, 0]);
});

test('turning a foe or the start goes in 5° steps', () => {
  const d = { key: 'm99', foes: [{ type: 'jackal', at: [0, 400] }, 'warden'] };
  faceTo(d, 'foes.0', 182.4); faceTo(d, 'foes.1', -7); faceTo(d, 'start', 359);
  assert.equal(d.foes[0].face, 180);
  assert.deepEqual(d.foes[1], { type: 'warden', face: 355 });
  assert.deepEqual(d.start, [0, 0, 0]);
});

test('removing takes foes and entities out, and the start back to the centre', () => {
  const d = copy('m06');
  remove(d, ['foes.0', 'foes.2', 'entities.tank2', 'start']);
  assert.deepEqual(d.foes.map(f => f.type), ['light1', 'jackal']);
  assert.deepEqual(d.entities.map(e => e.id), ['tank1', 'lz']);
  assert.equal(d.start, undefined);
});

test('a convoy shares its route: changing it changes every truck that drives it', () => {
  const d = copy('m03');
  assert.equal(routeOf(d, 'entities.truck1').vehicles.length, 4);
  assert.equal(routeOf(d, 'entities.exit'), null, 'a nav point has no route');
  const path = [...routeOf(d, 'entities.truck1').path, [0, 1000]];
  setRoute(d, 'entities.truck3', path);
  for (const n of [1, 2, 3, 4]) assert.equal(findSource(d, `entities.truck${n}`).item.path.length, 6);
  assert.notEqual(findSource(d, 'entities.truck1').item.path, findSource(d, 'entities.truck2').item.path, 'each truck its own array');
});

test('the map shows every placed thing where the game puts it, and one line per route', () => {
  const d = copy('m03'), G = createGame({ seed: 1 });
  startMatch(G, d, d.seed, false, 'kestrel');
  const { things, routes, waves } = mapThings(d, G);
  assert.deepEqual(things.map(t => t.kind), ['start', 'vehicle', 'vehicle', 'vehicle', 'vehicle', 'pad']);
  for (const e of G.entities) {
    const t = things.find(x => x.id === `entities.${e.id}`);
    assert.ok(Math.abs(t.x - e.x) < 1e-9 && Math.abs(t.z - e.z) < 1e-9, `${e.id} where the game put it`);
  }
  assert.equal(routes.length, 1);
  assert.equal(routes[0].pts.length, 5);
  assert.deepEqual(waves.map(w => w.kind), ['bearing', 'bearing']);
});

test('a mission made from nothing with the palette checks clean and round-trips', () => {
  const d = { key: 'm01', pal: 'ice', seed: 5, foes: [], objectives: [{ type: 'eliminate' }], intel: 'A test.' };
  const at = b => polar([b, 400]);
  place(d, 'FOE', at(0).x, at(0).z);
  place(d, 'STRUCTURE', at(90).x, at(90).z);
  place(d, 'PAD', at(180).x, at(180).z);
  assert.deepEqual(check(d), []);
  assert.deepEqual(fromSource(toSource(d)), d);
});
