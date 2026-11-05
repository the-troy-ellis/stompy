import { propInto, PROP_KEYS } from '../mesh/props.js';

// Props drawn batched by mesh (docs/specs/07-atmosphere.md § Props): one
// instanced draw per mesh key that has anything in view. Each instance is
// PROP_FLOATS numbers: x y z yaw, the footprint and height scales, a tint and
// a glow. No GL here, so the culling is testable headless (acceptance 4).
export const PROP_FLOATS = 8, PROP_CAP = 512;

export function makePropBatches() {
  return Object.fromEntries(PROP_KEYS.map(k => [k, { key: k, data: new Float32Array(PROP_CAP * PROP_FLOATS), n: 0 }]));
}

function add(b, x, y, z, yaw, sx, sy, tint, glow) {
  if (b.n >= PROP_CAP) return;
  const d = b.data, o = b.n++ * PROP_FLOATS;
  d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = tint; d[o + 7] = glow;
}

const P = {};
// Add a list of entities (G.entities, G.scenery) to the batches (emptied by
// clearProps once a frame): past `far` (metres from the
// eye) or wholly out of view (`seen(x, y, z, r)`, which counts the culled)
// nothing is issued. A prop that is toppling or lying where it fell, and an
// entity with no prop mesh, goes to `rest(e)` to be drawn on its own.
export function clearProps(B) { for (const k in B) B[k].n = 0; }
export function batchEntities(B, entities, eye, far, seen, rest) {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if ((e.kind === 'nav' && !e.mesh) || (!e.alive && !e.wreck)) continue;
    const dx = e.x - eye[0], dz = e.z - eye[2];
    if (dx * dx + dz * dz > far * far) continue;
    const h = e.height || 0;
    if (!seen(e.x, e.y + h / 2, e.z, Math.max(h, e.radius * 2) + 2)) continue;
    const prop = propInto(e, P);
    if (!prop || e.fall) { rest(e); continue; }
    add(B[prop.key], e.x, e.y, e.z, e.yaw, e.radius, prop.sy, prop.tint, 0);
    if (prop.head) add(B[prop.head], e.x, e.y, e.z, e.yaw + (e.headYaw || 0), e.radius, prop.sy, prop.tint, 0);
    if (prop.glow) add(B[prop.glow], e.x, e.y, e.z, e.yaw, e.radius, prop.sy, prop.tint, 1);
  }
}

// The forest's trees (docs/specs/39-forest.md), batched the same way: one
// instanced draw per kind. Trees come from the field's cells within `far` of
// (cx, cz), each cell culled whole by `seen`; a standing tree goes in as its
// crown radius and height, turned and tinted by its own dice.
export const TREE_CAP = 6000;
export function makeTreeBatches(kinds) {   // standing and lying (`<kind>Down`)
  return Object.fromEntries([...kinds, ...kinds.map(k => `${k}Down`)].map(k => [k, { key: k, data: new Float32Array(TREE_CAP * PROP_FLOATS), n: 0 }]));
}
export function batchTrees(B, T, kinds, cx, cz, far, seen, cellsNear, cell) {
  for (const k in B) B[k].n = 0;
  if (!T) return;
  const [x0, x1, z0, z1] = cellsNear(T, cx, cz, far, NEAR_CELLS), list = kinds.map(k => B[k]), down = kinds.map(k => B[`${k}Down`]), f2 = far * far;
  for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
    const c = i + T.nx * j, a = T.start[c], b = T.start[c + 1];
    if (a === b) continue;
    if (!seen(T.x[a], T.y[a] + 10, T.z[a], cell + 12)) continue;
    for (let t = a; t < b; t++) {
      const st = T.state[t];
      if (st === 1) continue;   // falling: drawn on its own (render/scene.js)
      const dx = T.x[t] - cx, dz = T.z[t] - cz;
      if (dx * dx + dz * dz > f2) continue;
      const bt = st ? down[T.kind[t]] : list[T.kind[t]];
      if (bt.n >= TREE_CAP) continue;
      const d = bt.data, o = bt.n++ * PROP_FLOATS;
      d[o] = T.x[t]; d[o + 1] = T.y[t]; d[o + 2] = T.z[t];
      d[o + 3] = (st ? T.fall[t] : T.yaw[t]) * (Math.PI * 2 / 256);   // down: the way it fell, lying along it
      d[o + 4] = st ? T.h[t] : T.r[t]; d[o + 5] = T.h[t]; d[o + 6] = 0.85 + T.tint[t] * (0.3 / 256); d[o + 7] = 0;
    }
  }
}
const NEAR_CELLS = [0, 0, 0, 0];
