// The mission editor's way in and out (docs/specs/15-mission-editor.md):
// `toSource(def)` writes a mission as the JS that src/data/missions.js holds,
// `fromSource(text)` reads it back with a small parser for that literal shape
// (never eval), and `check(def)` lists what is wrong with one in plain words.
// Exporting is the mission's data, not its original text: a `.map(...)` or a
// route kept in a const comes out written in full. The display name lives in
// names.js, so it never goes in.
import { SHAPES, ROUTES } from './missions.js';
import { NAMES } from './names.js';
import { polar } from '../sim/placement.js';
import { BOUND } from '../world/terrain.js';

// The order fields are written in, so the same mission is always the same
// text; anything not listed follows in alphabetical order.
const ORDER = {
  mission: ['key', 'pal', 'seed', 'time', 'ramp', 'weather', 'prefer', 'start', 'props', 'flat', 'foes', 'entities', 'objectives', 'waves', 'intel'],
  foe: ['type', 'at', 'face', 'aware', 'profile'],
  entity: ['kind', 'id', 'at', 'mesh', 'label', 'tags', 'height', 'radius', 'hp', 'pad', 'speed', 'path'],
  objective: ['type', 'label', 'targets', 'convoy', 'to', 'at', 'minAlive', 'seconds', 'within', 'after', 'secondary', 'waves'],
  wave: ['at', 'when', 'foes', 'from', 'dist', 'reveal'],
};
const LISTS = ['foes', 'entities', 'objectives', 'waves'];   // a mission's lists, one item a line
const keysOf = (o, order) => [...order.filter(k => k in o), ...Object.keys(o).filter(k => !order.includes(k)).sort()];

// ---- Writing ----

const str = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const ident = k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : str(k));
function value(v, order = []) {
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number') return Object.is(v, -0) ? '0' : String(v);
  if (typeof v === 'boolean' || v === null) return String(v);
  if (Array.isArray(v)) return `[${v.map(x => value(x)).join(', ')}]`;
  const ks = keysOf(v, order);
  return ks.length ? `{ ${ks.map(k => `${ident(k)}: ${value(v[k])}`).join(', ')} }` : '{}';
}
const same = (a, b) => value(a) === value(b);

// The shape an entity was made from: every one of the shape's fields present,
// the same kind and mesh, and the most fields equal. Its other fields follow
// the spread, as missions.js writes `{ ...TANK, id, at, tags: ['store'] }`.
function shapeOf(e) {
  let best = null, score = 0;
  for (const [name, s] of Object.entries(SHAPES)) {
    if (!Object.keys(s).every(k => k in e) || s.kind !== e.kind || s.mesh !== e.mesh) continue;
    const n = Object.keys(s).filter(k => same(s[k], e[k])).length;
    if (n > score) { best = name; score = n; }
  }
  return best;
}
function entity(e) {
  const name = shapeOf(e);
  if (!name) return value(e, ORDER.entity);
  const s = SHAPES[name], ks = keysOf(e, ORDER.entity).filter(k => !(k in s) || !same(s[k], e[k]));
  return `{ ...${name}${ks.map(k => `, ${ident(k)}: ${value(e[k])}`).join('')} }`;
}
function objective(o) {
  if (!Array.isArray(o.waves) || !o.waves.length) return value(o, ORDER.objective);
  const head = keysOf(o, ORDER.objective).filter(k => k !== 'waves').map(k => `${ident(k)}: ${value(o[k])}`);
  return `{ ${head.join(', ')}, waves: [\n${o.waves.map(w => `      ${value(w, ORDER.wave)},\n`).join('')}    ] }`;
}
const ITEM = { foes: f => (typeof f === 'string' ? str(f) : value(f, ORDER.foe)), entities: entity, objectives: objective, waves: w => value(w, ORDER.wave) };

// One mission as an entry of MISSIONS: the scalars on the first line, each
// list one item a line, the intel last.
export function toSource(def) {
  const ks = keysOf(def, ORDER.mission).filter(k => k !== 'name');
  const head = ks.filter(k => !LISTS.includes(k) && k !== 'intel').map(k => `${ident(k)}: ${value(def[k])}`);
  const lines = [head.length ? `{ ${head.join(', ')},` : '{'];
  for (const k of LISTS.filter(l => l in def)) {
    const list = def[k];
    if (!Array.isArray(list) || !list.length) lines.push(`  ${k}: ${Array.isArray(list) ? '[]' : value(list)},`);
    else lines.push(`  ${k}: [`, ...list.map(x => `    ${ITEM[k](x)},`), '  ],');
  }
  if ('intel' in def) lines.push(`  intel: ${value(def.intel)},`);
  if (lines.length === 1 && !head.length) return '{},\n';
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, ' }');
  return lines.join('\n') + ',\n';
}

// ---- Reading ----

// Tokens: punctuation, strings, numbers and names, with comments skipped.
function tokens(text) {
  const out = [], re = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|(\.\.\.|[{}[\]:,()])|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|(-?[A-Za-z_$][\w$]*)|(.)/gy;
  let m;
  while ((m = re.exec(text)) && m[0] !== '') {
    const line = text.slice(0, m.index).split('\n').length;
    if (m[1]) out.push({ t: m[1], line });
    else if (m[2]) out.push({ t: 'str', v: unquote(m[2]), line });
    else if (m[3]) out.push({ t: 'num', v: Number(m[3]), line });
    else if (m[4]) out.push({ t: 'name', v: m[4], line });
    else if (m[5]) out.push({ t: m[5], line });   // the parser says it can't read it, where it stands
    if (re.lastIndex >= text.length) break;
  }
  return out;
}
function unquote(s) {
  const esc = { n: '\n', t: '\t', r: '\r', 0: '\0' };
  return s.slice(1, -1).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, c) =>
    c.length > 1 ? String.fromCodePoint(parseInt(c.replace(/[u{}x]/g, ''), 16)) : (esc[c] ?? c));
}
const copy = v => (Array.isArray(v) ? v.map(copy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v);
const CONSTS = { true: true, false: false, null: null, Infinity: Infinity, '-Infinity': -Infinity };
const NAMED = { ...ROUTES, ...SHAPES };

// One mission literal, as missions.js writes it (an `export`, a trailing
// comma or the `MISSIONS = [` around it are not part of it). Throws with the
// line on anything it can't read.
export function fromSource(text) {
  const ts = tokens(text);
  let i = 0;
  const peek = () => ts[i], end = () => ts[ts.length - 1]?.line ?? 1;
  const fail = (msg, tok = peek()) => { throw new Error(`Line ${tok ? tok.line : end()}: ${msg}`); };
  const eat = t => { if (peek()?.t !== t) fail(`expected ${t}${peek() ? `, not ${show(peek())}` : ', and the text ended'}.`); return ts[i++]; };
  const show = tok => (tok.t === 'str' ? `'${tok.v}'` : tok.t === 'num' || tok.t === 'name' ? String(tok.v) : tok.t);
  const named = tok => {
    if (tok.v in CONSTS) return CONSTS[tok.v];
    if (tok.v in NAMED) return copy(NAMED[tok.v]);
    return fail(`${tok.v} is not something I know. Write it out in full.`, tok);
  };
  function val() {
    const tok = peek();
    if (!tok) return fail('the text ended too soon.');
    if (tok.t === '{') return obj();
    if (tok.t === '[') return arr();
    i++;
    if (tok.t === 'str' || tok.t === 'num') return tok.v;
    if (tok.t === 'name') {
      if (['(', '.', '=', '=>'].includes(peek()?.t)) fail(`code like ${tok.v}(...) can't be read. Write it out in full.`, tok);
      return named(tok);
    }
    return fail(`I can't read "${show(tok)}" here.`, tok);
  }
  function obj() {
    eat('{');
    const o = {};
    while (peek()?.t !== '}') {
      if (peek()?.t === '...') {
        i++;
        const tok = eat('name'), s = named(tok);
        if (!s || typeof s !== 'object' || Array.isArray(s)) fail(`...${tok.v} is not a shape.`, tok);
        Object.assign(o, s);
      } else {
        const k = peek()?.t === 'str' || peek()?.t === 'name' || peek()?.t === 'num' ? ts[i++] : fail('expected a field name.');
        eat(':');
        o[String(k.v)] = val();
      }
      if (peek()?.t !== ',') break;
      i++;
    }
    eat('}');
    return o;
  }
  function arr() {
    eat('[');
    const a = [];
    while (peek()?.t !== ']') {
      if (peek()?.t === '...') fail('a spread in a list can\'t be read. Write it out in full.');
      a.push(val());
      if (peek()?.t !== ',') break;
      i++;
    }
    eat(']');
    return a;
  }
  while (peek() && peek().t !== '{') i++;   // skip `export const X =`, `[` and the like
  if (!peek()) fail('there is no mission here. A mission starts with {.');
  const def = obj();
  while (peek() && [',', ']', ';'].includes(peek().t)) i++;
  if (peek()) fail(`there is more after the mission: ${show(peek())}.`);
  if (!def || typeof def !== 'object' || Array.isArray(def)) fail('that is not a mission.');
  return def;
}

// ---- Problems ----

const MECH_RADIUS = 6;   // m: a mech, for "two things in the same place"
const upper = s => String(s).toUpperCase();
// What is wrong with a mission, as [{ id, text }]: `id` says what it is about
// ('foes.2', 'entities.truck1', 'objectives.0', 'waves.1', 'start', 'key').
// It never blocks PLAY; a broken mission is still worth trying.
export function check(def, names = NAMES.missions) {
  const out = [], add = (id, text) => out.push({ id, text });
  const ents = def.entities || [], foes = def.foes || [], objs = def.objectives || [];
  const ids = new Map();
  for (const e of ents) if (e.id != null) ids.set(e.id, (ids.get(e.id) || 0) + 1);
  for (const [id, n] of ids) if (n > 1) add(`entities.${id}`, `Two things are called ${id}.`);
  const has = id => ids.has(id), tagged = t => (def.base && t === 'silo' ? [def.base] : ents.filter(e => (e.tags || []).includes(t)));   // a base brings its silo (spec 20)
  const entId = (e, i) => `entities.${e.id ?? i}`;
  // Each entity's display name and its number among those with the same one, as "TRUCK 2".
  const seen = new Map(), title = new Map();
  ents.forEach((e, i) => {
    const l = e.label || (e.kind === 'vehicle' ? 'TRUCK' : e.kind === 'turret' ? 'LAUNCHER' : e.kind === 'nav' ? 'NAV POINT' : 'STRUCTURE');
    seen.set(l, (seen.get(l) || 0) + 1);
    title.set(i, `${l} ${seen.get(l)}`);
  });

  objs.forEach((o, n) => {
    const id = `objectives.${n}`, name = `${upper(o.type)}${o.label ? ` ${o.label}` : ''}`;
    if (o.type === 'destroy' || o.type === 'protect' || o.type === 'keep') {
      for (const t of o.targets || []) if (!tagged(t).length) add(id, `${name} has nothing tagged ${t}.`);
      if (!(o.targets || []).length) add(id, `${name} has no targets.`);
    }
    if (o.type === 'escort') {
      if (!ents.some(e => e.kind === 'vehicle' && (e.tags || []).includes(o.convoy))) add(id, `${name} has no vehicle tagged ${o.convoy}.`);
      if (!has(o.to)) add(id, `ESCORT goes to ${o.to}. There is no ${o.to}.`);
    }
    if (o.type === 'extract' && !has(o.at)) add(id, `EXTRACT goes to ${o.at}. There is no ${o.at}.`);
    (o.waves || []).forEach((w, k) => wave(w, `${id}.waves.${k}`));
  });
  (def.waves || []).forEach((w, k) => wave(w, `waves.${k}`));
  function wave(w, id) {
    if (typeof w.from === 'string' && w.from !== 'ring' && !has(w.from)) add(id, `A wave comes from ${w.from}. There is no ${w.from}.`);
    if (w.when && !objs[w.when.obj]) add(id, `A wave waits for objective ${w.when.obj + 1}. There is no objective ${w.when.obj + 1}.`);
  }

  // Where everything stands, in metres from the map's centre.
  const things = [];
  if (def.start) things.push({ id: 'start', what: 'The start', ...polar(def.start), r: MECH_RADIUS });
  else things.push({ id: 'start', what: 'The start', x: 0, z: 0, r: MECH_RADIUS });
  foes.forEach((f, i) => { if (typeof f === 'object' && f.at) things.push({ id: `foes.${i}`, what: 'A foe', ...polar(f.at), r: MECH_RADIUS }); });
  ents.forEach((e, i) => {
    if (!e.at) return;
    const r = e.radius ?? (e.kind === 'vehicle' ? 2.2 : 3);
    things.push({ id: entId(e, i), what: title.get(i), ...polar(e.at), r, nav: e.kind === 'nav' });
    if (e.kind === 'vehicle' && Array.isArray(e.path) && e.path.length) {
      const p = polar(e.at), q = polar(e.path[0]);
      if (Math.hypot(p.x - q.x, p.z - q.z) > 100) add(entId(e, i), `${title.get(i)} starts off its route.`);
      if (e.path.some(pt => outside(polar(pt)))) add(entId(e, i), `${title.get(i)}'s route leaves the map.`);
    }
  });
  function outside(p) { return Math.abs(p.x) > BOUND || Math.abs(p.z) > BOUND; }
  for (const t of things) if (outside(t)) add(t.id, `${t.what} is outside the map.`);
  // Nav points are there to be walked onto, so only bodies count.
  const bodies = things.filter(t => !t.nav);
  for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
    const p = bodies[a], q = bodies[b];
    if (Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r) add(q.id, 'Two things stand in the same place.');
  }
  if (def.key && !names[def.key]) add('key', `${def.key} has no name yet.`);
  return out;
}
