// The mission editor's export, import and problem list
// (docs/specs/15-mission-editor.md § Acceptance 2 and 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toSource, fromSource, check } from '../src/data/missionIO.js';
import { MISSIONS, contractDef } from '../src/data/missions.js';
import { polar, toPolar, roundPolar } from '../src/sim/placement.js';

const bare = ({ name: _name, ...d }) => d;
const ALL = [...MISSIONS, ...[12, 13, 14, 15, 16].map(contractDef)];
const NAMED = { m99: 'X' };   // check()'s names, for the made-up missions below

for (const m of ALL) {
  test(`${m.key || m.name}: export and import give the same mission, and exporting twice the same text`, () => {
    const text = toSource(m);
    assert.ok(!/\bname:/.test(text), 'the display name stays in names.js');
    const back = fromSource(text);
    assert.deepEqual(back, bare(m));
    assert.equal(toSource(back), text);
  });
}

test('the export reuses the shapes missions.js names, and overrides after the spread', () => {
  const m10 = toSource(MISSIONS.find(m => m.key === 'm10'));
  assert.match(m10, /\{ \.\.\.TANK, id: 'store1', at: \[0, 70\], tags: \['store'\] \}/);
  assert.match(toSource(MISSIONS.find(m => m.key === 'm09')), /\.\.\.PROP_TANK, id: 'refinery1'/);
  assert.match(toSource(MISSIONS.find(m => m.key === 'm03')), /\{ \.\.\.PAD, id: 'exit'/);
});

test('an untouched mission keeps its numbers exactly; only what moves is rounded', () => {
  const m03 = MISSIONS.find(m => m.key === 'm03');
  assert.match(toSource(m03), /at: \[213, 151\]/);
  assert.deepEqual(roundPolar([212.6, 152.4]), [213, 150]);
  assert.deepEqual(roundPolar([359.6, 2]), [0, 0]);
  assert.deepEqual(roundPolar([-10.2, 97.5]), [350, 100]);
  for (const at of [[0, 100], [90, 250], [213, 151], [359, 1000]]) {
    const p = polar(at), [b, d] = toPolar(p.x, p.z);
    assert.ok(Math.abs(b - at[0]) < 1e-9 && Math.abs(d - at[1]) < 1e-9, `${at} came back as ${[b, d]}`);
  }
});

test('the parser reads missions.js as written: comments, shapes, routes, Infinity, double quotes', () => {
  const src = readFileSync(new URL('../src/data/missions.js', import.meta.url), 'utf8');
  const m04 = src.slice(src.indexOf("{ key: 'm04'"), src.indexOf("// Act II"));
  assert.deepEqual(fromSource(m04), bare(MISSIONS.find(m => m.key === 'm04')));
  const d = fromSource(`{ key: "m99", seed: 1, foes: [], /* a note */ entities: [{ ...TRUCK, id: 't', at: [1, 2], path: ROUTE, hp: Infinity, label: 'IT\\'S' }] },`);
  assert.equal(d.entities[0].hp, Infinity);
  assert.equal(d.entities[0].label, "IT'S");
  assert.equal(d.entities[0].path.length, 5);
  assert.equal(d.entities[0].kind, 'vehicle');
  assert.deepEqual(fromSource(toSource({ key: 'm99', foes: [{ type: 'jackal', at: [-5, 1e3], face: -0.5 }], intel: 'A\nB' })),
    { key: 'm99', foes: [{ type: 'jackal', at: [-5, 1000], face: -0.5 }], intel: 'A\nB' });
});

test('the parser says what it cannot read, with the line, and never runs code', () => {
  assert.throws(() => fromSource("{ key: 'm99',\n  foes: [...[1, 2].map(x => x)] }"), /Line 2: .*Write it out in full/);
  assert.throws(() => fromSource("{ key: 'm99', foes: FOES }"), /FOES is not something I know/);
  assert.throws(() => fromSource("{ key: 'm99', foes: [] "), /the text ended/);
  assert.throws(() => fromSource('{ key: alert(1) }'), /can't be read/);
  assert.throws(() => fromSource('nothing here'), /no mission here/);
  assert.throws(() => fromSource("{ a: 1 } { b: 2 }"), /more after the mission/);
});

const problems = def => check(def, NAMED).map(p => p.text);

test('the campaign has no problems but its names', () => {
  for (const m of MISSIONS) {
    const left = check(m).filter(p => p.id !== 'key');
    assert.deepEqual(left, [], `${m.key}: ${left.map(p => p.text).join(' ')}`);
  }
  assert.deepEqual(check({ key: 'm01', foes: [] }), []);
  assert.deepEqual(problems({ key: 'm13', foes: [] }), ['m13 has no name yet.']);
});

test('check: targets, convoys and ids that are not there', () => {
  assert.deepEqual(problems({ key: 'm99', foes: [], objectives: [{ type: 'destroy', targets: ['relay'], label: 'RELAY' }] }), ['DESTROY RELAY has nothing tagged relay.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], objectives: [{ type: 'protect', targets: ['store'] }] }), ['PROTECT has nothing tagged store.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], entities: [{ kind: 'nav', id: 'exit', at: [0, 500] }], objectives: [{ type: 'escort', convoy: 'c', to: 'exit' }] }),
    ['ESCORT has no vehicle tagged c.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], objectives: [{ type: 'extract', at: 'lz' }] }), ['EXTRACT goes to lz. There is no lz.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], waves: [{ at: 5, foes: ['jackal'], from: 'ridge' }, { when: { obj: 2, done: 1 }, foes: ['jackal'] }] }),
    ['A wave comes from ridge. There is no ridge.', 'A wave waits for objective 3. There is no objective 3.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], objectives: [{ type: 'survive', seconds: 9, waves: [{ at: 0, foes: ['jackal'], from: 'nowhere' }] }] }),
    ['A wave comes from nowhere. There is no nowhere.']);
  assert.deepEqual(check({ key: 'm99', foes: [], objectives: [{ type: 'extract', at: 'lz' }] }, NAMED)[0].id, 'objectives.0');
});

test('check: two of one id, trucks off their route, the map edge, and things on top of each other', () => {
  const dup = { key: 'm99', foes: [], entities: [{ kind: 'nav', id: 'a', at: [0, 300] }, { kind: 'nav', id: 'a', at: [90, 300] }] };
  assert.deepEqual(problems(dup), ['Two things are called a.']);
  const truck = { kind: 'vehicle', label: 'TRUCK', tags: ['c'], speed: 7 };
  const off = { key: 'm99', foes: [], entities: [{ ...truck, id: 't1', at: [0, 100], path: [[0, 100], [0, 300]] }, { ...truck, id: 't2', at: [180, 200], path: [[0, 100], [0, 300]] }] };
  assert.deepEqual(check(off, NAMED), [{ id: 'entities.t2', text: 'TRUCK 2 starts off its route.' }]);
  assert.deepEqual(problems({ key: 'm99', foes: [{ type: 'jackal', at: [90, 1500] }] }), ['A foe is outside the map.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], start: [0, 1400, 0] }), ['The start is outside the map.']);
  assert.deepEqual(problems({ key: 'm99', foes: [], entities: [{ ...truck, id: 't', at: [0, 100], path: [[0, 100], [0, 2000]] }] }), ["TRUCK 1's route leaves the map."]);
  assert.deepEqual(problems({ key: 'm99', foes: [{ type: 'jackal', at: [0, 400] }, { type: 'warden', at: [0, 408] }] }), ['Two things stand in the same place.']);
  assert.deepEqual(problems({ key: 'm99', foes: [{ type: 'jackal', at: [0, 400] }, { type: 'warden', at: [0, 413] }] }), []);
  assert.deepEqual(problems({ key: 'm99', foes: [{ type: 'jackal', at: [0, 5] }] }), ['Two things stand in the same place.'], 'a foe on the start');
  assert.deepEqual(problems({ key: 'm99', foes: [{ type: 'jackal', at: [0, 400] }], entities: [{ kind: 'nav', id: 'n', at: [0, 400], radius: 14 }] }), [], 'a nav point is walked onto');
});
