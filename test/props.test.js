import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProps, propFor, PROP_KEYS } from '../src/mesh/props.js';

const bounds = b => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.d.length; i += 9) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], b.d[i + j]); hi[j] = Math.max(hi[j], b.d[i + j]); }
  return { lo, hi };
};

test('the props #98 asks for exist, each with a wreck', () => {
  for (const k of ['relay', 'tank', 'truck', 'launcher', 'pad']) assert.ok(PROP_KEYS.includes(k), k);
  for (const k of ['relay', 'tank', 'truck', 'launcher']) assert.ok(PROP_KEYS.includes(`${k}Wreck`), `${k}Wreck`);
});

test('the scenery library #161 asks for exists', () => {
  for (const k of ['bunker', 'pipe', 'wall', 'mast', 'crates', 'deadTree', 'vent', 'spire']) assert.ok(PROP_KEYS.includes(k), k);
});

test('the lava vent has a glowing part, drawn as an extra mesh; nothing else glows', () => {
  assert.equal(propFor({ mesh: 'vent', alive: true, radius: 9, height: 6 }).glow, 'ventGlow');
  assert.equal(propFor({ mesh: 'bunker', alive: true, radius: 6, height: 5 }).glow, null);
  const glow = buildProps().ventGlow, lava = [1, 0.42, 0.08];
  for (let i = 6; i < glow.d.length; i += 9) assert.deepEqual([glow.d[i], glow.d[i + 1], glow.d[i + 2]].map(v => +v.toFixed(2)), lava);
});

test('every prop is under 120 triangles and fits its unit footprint', () => {
  for (const [k, b] of Object.entries(buildProps())) {
    const tris = b.d.length / 27;
    assert.ok(tris > 0 && tris <= 120, `${k}: ${tris} triangles`);
    const { lo, hi } = bounds(b);
    assert.ok(lo[1] > -0.1 && hi[1] <= 1.05, `${k} height ${lo[1]}..${hi[1]}`);
    assert.ok(Math.max(-lo[0], hi[0]) <= 1.05, `${k} width`);
    assert.ok(Math.max(-lo[2], hi[2]) <= 1.35, `${k} length`);
  }
});

test('propFor picks the intact mesh, the wreck, or the toppled mesh', () => {
  const e = { mesh: 'relay', alive: true, radius: 4, height: 20 };
  assert.deepEqual(propFor(e), { key: 'relay', head: null, glow: null, sy: 20, tint: 1 });
  assert.equal(propFor({ ...e, alive: false }).key, 'relayWreck');
  const toppled = propFor({ ...e, alive: false, fall: { yaw: 0, t: 1 } });
  assert.equal(toppled.key, 'relay');
  assert.ok(toppled.tint < 1);
});

test('the launcher has a turning head until it is wrecked; the pad scales with its radius', () => {
  const l = { mesh: 'launcher', alive: true, radius: 5, height: 6 };
  assert.equal(propFor(l).head, 'launcherHead');
  assert.equal(propFor({ ...l, alive: false }).head, null);
  assert.equal(propFor({ mesh: 'pad', alive: true, radius: 14, height: 0 }).sy, 14);
});

test('an entity without a known mesh falls back to boxes', () => {
  assert.equal(propFor({ mesh: null, alive: true }), null);
  assert.equal(propFor({ mesh: 'castle', alive: true }), null);
});

// Placement (#162): world/props.js scatters, sim/entities.js keeps them.
import { makeTerrain } from '../src/world/terrain.js';
import { scatterProps, outpostSites, SINGLES } from '../src/world/props.js';
import { createGame, startMatch } from '../src/sim/state.js';
import { sceneryNear, sceneryAlong, pushOutOfEntities } from '../src/sim/entities.js';
import { rayHit } from '../src/sim/geom.js';
import { missionDef, MISSIONS } from '../src/data/missions.js';
import { flatZones, polar } from '../src/sim/placement.js';
import { M, frustumPlanes, sphereVisible } from '../src/util/math.js';
import { makePropBatches, clearProps, batchEntities } from '../src/render/propBatch.js';
import { recordFx } from '../src/sim/fx.js';

const match = (def, seed = 1234) => {
  const G = createGame({ fx: recordFx(), seed });
  startMatch(G, { name: 'T', pal: 'dusk', foes: ['jackal'], intel: '', ...def }, seed, false, 'kestrel');
  return G;
};
const counts = list => list.reduce((c, p) => ({ ...c, [p.mesh]: (c[p.mesh] || 0) + 1 }), {});

test('the scatter is the seed\'s: the same seed and biome give the same props, another seed others', () => {
  const ter = makeTerrain(77), a = scatterProps(77, 'ice', ter), b = scatterProps(77, 'ice', makeTerrain(77));
  assert.deepEqual(a, b);
  assert.notDeepEqual(scatterProps(78, 'ice', makeTerrain(78)).map(p => p.x), a.map(p => p.x));
});

test('each biome gets outposts, pylon lines and its own singles, and none of the others\'', () => {
  for (const [biome, own] of Object.entries(SINGLES)) {
    const c = counts(scatterProps(5, biome, makeTerrain(5)));
    assert.ok(c.mast >= 15, `${biome}: pylons ${c.mast}`);
    assert.ok(c.pipe >= 6 && c.wall >= 8 && c.bunker >= 2, `${biome}: outposts ${JSON.stringify(c)}`);
    for (const [k, n] of own) assert.ok(c[k] >= n * 0.6, `${biome}: ${k} ${c[k]} of ${n}`);
  }
  const ice = counts(scatterProps(5, 'ice', makeTerrain(5))), dusk = counts(scatterProps(5, 'dusk', makeTerrain(5)));
  assert.ok(!ice.vent && !dusk.vent && !dusk.deadTree && !dusk.spire);
  const total = Object.values(ice).reduce((a, b) => a + b, 0);
  assert.ok(total > 60 && total < 200, `ice: ${total} props`);
});

test('outpost clusters sit round the outposts the terrain mesh builds', () => {
  const props = scatterProps(9, 'dusk', makeTerrain(9));
  for (const [x, z] of outpostSites(9)) {
    const near = props.filter(p => Math.hypot(p.x - x, p.z - z) < 140 && p.mesh !== 'mast');
    assert.ok(near.length >= 4, `outpost at ${x | 0},${z | 0}: ${near.length} props`);
  }
});

test('nothing is placed on the start, a mission\'s pads and structures, or a convoy\'s road', () => {
  for (let n = 0; n < MISSIONS.length; n++) {
    const def = missionDef(n), seed = def.seed ?? 7 + n * 13;
    const G = createGame({ fx: recordFx(), seed });
    startMatch(G, def, seed, false, 'kestrel');
    assert.ok(G.scenery.length > 30, `mission ${n + 1}: ${G.scenery.length} props`);
    const st = def.start ? polar(def.start) : { x: 0, z: 0 };
    for (const p of G.scenery) {
      assert.ok(Math.hypot(p.x - st.x, p.z - st.z) >= 140 + p.radius, `mission ${n + 1}: a ${p.mesh} on the start`);
      for (const [x, z, r] of flatZones(def)) assert.ok(Math.hypot(p.x - x, p.z - z) >= r + p.radius, `mission ${n + 1}: a ${p.mesh} on a pad`);
      for (const e of G.entities) assert.ok(Math.hypot(p.x - e.x, p.z - e.z) >= e.radius + p.radius, `mission ${n + 1}: a ${p.mesh} on ${e.id}`);
    }
  }
});

test('scenery is indestructible and untargetable; props: false and a flat test map leave the map bare', () => {
  const G = match({});
  assert.ok(G.scenery.length > 30);
  assert.ok(G.scenery.every(e => e.hp === Infinity && !e.targetable && e.kind === 'structure' && e.mesh));
  assert.ok(!G.entities.some(e => G.scenery.includes(e)), 'scenery is apart from the mission\'s entities');
  assert.equal(match({ props: false }).scenery.length, 0);
  const F = createGame({ fx: recordFx(), seed: 3 });
  startMatch(F, { name: 'T', pal: 'dusk', foes: ['jackal'], intel: '' }, 3, false, 'kestrel', { terrainOpts: { flat: true } });
  assert.equal(F.scenery.length, 0);
});

test('a mech walks into a prop and is pushed out; a shot at a prop stops on it', () => {
  const G = match({}), p = G.scenery.find(e => e.mesh === 'bunker'), P = G.player;
  P.x = p.x + 1; P.z = p.z; P.y = G.ter.height(P.x, P.z);
  pushOutOfEntities(G, () => 3);
  assert.ok(Math.hypot(P.x - p.x, P.z - p.z) >= p.radius + 3 - 1e-6);
  P.x += 500;   // out of the way
  // From just above and beside it, down at its foot, so no slope gets in the
  // way (a hit is on the side of the cylinder: there is no lid).
  const o = [p.x - p.radius - 5, p.y + p.height + 3, p.z], to = [p.x - o[0], p.y + 0.5 - o[1], p.z - o[2]], L = Math.hypot(...to);
  const hit = rayHit(G, o, to.map(v => v / L), 400, P);
  assert.equal(hit?.ent, p, 'the shot stops on the bunker');
  assert.ok(hit.t < L);
});

test('the grid finds every prop a ray could touch, the same as walking the whole list', () => {
  const G = match({}, 4321);
  let rays = 0;
  for (let k = 0; k < 200; k++) {
    const a = k * 2.399, x0 = Math.sin(k * 7.1) * 900, z0 = Math.cos(k * 3.3) * 900, L = [5, 40, 300, 1100][k % 4];
    const x1 = x0 + Math.sin(a) * L, z1 = z0 + Math.cos(a) * L, out = [], n = sceneryAlong(G, x0, z0, x1, z1, out), got = new Set(out.slice(0, n));
    for (const e of G.scenery) {
      // Distance from the prop's centre to the segment: within its radius, the ray could touch it.
      const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((e.x - x0) * dx + (e.z - z0) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(e.x - x0 - dx * t, e.z - z0 - dz * t) < e.radius) { rays++; assert.ok(got.has(e), `ray ${k} missed a ${e.mesh}`); }
    }
  }
  assert.ok(rays > 5, `only ${rays} props were on a ray`);
  const e = G.scenery[0], out = [], n = sceneryNear(G, e.x + e.radius + 1, e.z, 2, out);
  assert.ok(out.slice(0, n).includes(e));
});

test('acceptance 4: with the camera facing away from an outpost, none of its props are issued, and they count as culled', () => {
  const G = match({}), [ox, oz] = outpostSites(G.ter.seed)[0], camp = G.scenery.filter(p => Math.hypot(p.x - ox, p.z - oz) < 120);
  assert.ok(camp.length >= 4);
  const eyeAt = (lookX, lookZ) => {
    const eye = [ox * 0.6, 40, oz * 0.6], VP = M.mul(M.persp(1.1, 16 / 9, 0.5, 1800), M.lookAt(eye, [lookX, 30, lookZ])), planes = frustumPlanes(VP);
    let culled = 0;
    const B = makePropBatches(), seen = (x, y, z, r) => sphereVisible(planes, x, y, z, r) || (culled++, false);
    clearProps(B);
    batchEntities(B, camp, eye, 5000, seen, () => {});
    return { issued: Object.values(B).reduce((a, b) => a + b.n, 0), culled };
  };
  const toward = eyeAt(ox, oz), away = eyeAt(-ox, -oz);
  assert.ok(toward.issued >= camp.length, `facing it: ${toward.issued} of ${camp.length}`);
  assert.equal(away.issued, 0);
  assert.equal(away.culled, camp.length);
});

test('props batch by mesh: one batch per key, the lava vent also fills its glow batch', () => {
  const B = makePropBatches(), all = () => true;
  const ents = [
    { kind: 'structure', mesh: 'vent', alive: true, x: 0, y: 0, z: 0, yaw: 0, radius: 9, height: 6 },
    { kind: 'structure', mesh: 'vent', alive: true, x: 30, y: 0, z: 0, yaw: 1, radius: 8, height: 6 },
    { kind: 'structure', mesh: 'crates', alive: true, x: 60, y: 0, z: 0, yaw: 0, radius: 4, height: 4 },
    { kind: 'structure', mesh: 'relay', alive: true, x: 90, y: 0, z: 0, yaw: 0, radius: 3, height: 18, fall: { yaw: 0, t: 0.5 } },
  ];
  const alone = [];
  clearProps(B);
  batchEntities(B, ents, [0, 0, 0], 1000, all, e => alone.push(e));
  assert.equal(B.vent.n, 2); assert.equal(B.ventGlow.n, 2); assert.equal(B.crates.n, 1); assert.equal(B.relay.n, 0);
  assert.deepEqual(alone, [ents[3]], 'a toppling prop is drawn on its own');
  assert.equal(B.ventGlow.data[7], 1); assert.equal(B.vent.data[7], 0);
});
