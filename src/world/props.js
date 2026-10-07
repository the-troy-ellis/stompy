import { makeRng } from '../sim/rng.js';
import { BOUND } from './terrain.js';

const { sin, cos, hypot, max, min, PI } = Math;

// Scenery props (docs/specs/07-atmosphere.md § Props): scattered from the map
// seed by biome rules, so every client of a seed gets the same field. Each
// is a spec for addEntity (mesh, x, z, yaw, radius, height); the caller makes
// them indestructible structures. Three kinds of placement:
//   clusters round each outpost (outpostSites, which terrainMesh.js also
//     builds its abandoned blocks around): a bunker, crates, a tank, a run of
//     pipe and a run of wall;
//   pylon lines: masts every PYLON_GAP metres along a few straight lines;
//   singles: the biome's own things, scattered.
// Nothing lands in `avoid` (circles [x, z, r]: the start, a mission's pads and
// structures), within `paths` (a convoy's road), on a steep slope, or on
// another prop. A long prop (pipe, wall) is laid as a chain of short
// segments, so each one's round footprint fits it.

export const OUTPOSTS = 4, PYLON_GAP = 150, PATH_CLEAR = 30;
// [key, radius range, height range] per kind of prop.
const SIZE = {
  bunker: [[5, 7], [4, 6]], crates: [[3, 4.5], [3, 4.5]], tank: [[4, 6], [6, 8]], pipe: [[4, 4], [4, 4]], wall: [[3, 3], [4, 5]],
  mast: [[4, 4], [28, 34]], deadTree: [[2.5, 3.5], [10, 15]], spire: [[4, 8], [15, 30]], vent: [[7, 11], [5, 8]],
};
// The biome's singles: [key, count]. Pylon lines and outposts are everywhere.
export const SINGLES = {
  dusk: [['crates', 8], ['bunker', 5], ['tank', 3], ['wall', 4]],
  ice: [['deadTree', 30], ['spire', 14], ['crates', 4]],
  volcanic: [['vent', 12], ['bunker', 5], ['crates', 4]],
};
const PYLON_LINES = 2;

// The outposts' centres, from the seed: about 280 to 880 m out.
export function outpostSites(seed) {
  const r = makeRng(seed * 31 + 7);
  return Array.from({ length: OUTPOSTS }, () => { const a = r.range(0, 2 * PI), d = r.range(280, 880); return [sin(a) * d, cos(a) * d]; });
}
// Each outpost's abandoned blocks (terrainMesh.js bakes them into the ground
// mesh; the scatter keeps clear of them): seven { x, z, w, h, d, yaw, g }
// within 45 m of the site, and a radio tower { x, z } off to one side.
export function outposts(seed) {
  const r = makeRng(seed * 13 + 5);
  return outpostSites(seed).map(([cx, cz]) => ({
    x: cx, z: cz, tower: { x: cx + 40, z: cz - 30 },
    blocks: Array.from({ length: 7 }, () => ({ x: cx + r.range(-45, 45), z: cz + r.range(-45, 45), w: r.range(9, 23), h: r.range(7, 29), d: r.range(9, 23), g: r.range(0.45, 0.65), yaw: r.range(0, 0.4) })),
  }));
}

const segDist = (x, z, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return hypot(x - ax - dx * t, z - az - dz * t);
};

export function scatterProps(seed, biome, ter, { avoid: given = [], paths = [] } = {}) {
  const r = makeRng(seed * 17 + 3), out = [], avoid = [...given];
  const size = key => { const [[r0, r1], [h0, h1]] = SIZE[key]; return { radius: r.range(r0, r1), height: r.range(h0, h1) }; };
  // Free ground for a footprint: in bounds, clear of the avoid list, the
  // paths and every prop already down, and not too steep across it.
  const free = (x, z, rad) => {
    if (Math.abs(x) > BOUND - rad || Math.abs(z) > BOUND - rad) return false;
    for (const [ax, az, ar] of avoid) if (hypot(x - ax, z - az) < ar + rad) return false;
    for (const p of paths) for (let i = 1; i < p.length; i++) if (segDist(x, z, p[i - 1], p[i]) < PATH_CLEAR + rad) return false;
    for (const o of out) if (hypot(x - o.x, z - o.z) < o.radius + rad + 4) return false;
    const hs = [ter.height(x - rad, z), ter.height(x + rad, z), ter.height(x, z - rad), ter.height(x, z + rad)];
    return max(...hs) - min(...hs) < rad * 0.6 + 2;
  };
  const put = (key, x, z, yaw, s) => { out.push({ mesh: key, x, z, yaw, radius: s.radius, height: s.height }); };
  // One prop near (x, z) within `spread`: a few tries, then give up.
  const near = (key, x, z, spread) => {
    const s = size(key);
    for (let k = 0; k < 8; k++) {
      const px = x + r.range(-spread, spread), pz = z + r.range(-spread, spread);
      if (free(px, pz, s.radius)) { put(key, px, pz, r.range(0, 2 * PI), s); return true; }
    }
    return false;
  };
  // A run of n segments of a long prop, centred near (x, z), all at one yaw.
  const run = (key, x, z, spread, n) => {
    const s = size(key), step = s.radius * 2.6;
    for (let k = 0; k < 8; k++) {
      const yaw = r.range(0, PI), fx = sin(yaw), fz = cos(yaw), cx = x + r.range(-spread, spread), cz = z + r.range(-spread, spread);
      const at = Array.from({ length: n }, (_, i) => [cx + fx * (i - (n - 1) / 2) * step, cz + fz * (i - (n - 1) / 2) * step]);
      if (!at.every(([px, pz]) => free(px, pz, s.radius))) continue;
      for (const [px, pz] of at) put(key, px, pz, yaw, s);
      return true;
    }
    return false;
  };

  const sites = outposts(seed);
  for (const o of sites) {   // the blocks and the tower are in the way too
    for (const k of o.blocks) avoid.push([k.x, k.z, Math.hypot(k.w, k.d) / 2]);
    avoid.push([o.tower.x, o.tower.z, 3]);
  }
  for (const { x: cx, z: cz } of sites) {
    near('bunker', cx, cz, 60);
    near('crates', cx, cz, 50); near('crates', cx, cz, 50);
    near('tank', cx, cz, 60);
    run('pipe', cx, cz, 50, 3);
    run('wall', cx, cz, 60, 4);
  }
  for (let l = 0; l < PYLON_LINES; l++) {
    // A straight line across the map: a heading and an offset from the centre.
    const a = r.range(0, PI), off = r.range(-BOUND * 0.6, BOUND * 0.6), fx = sin(a), fz = cos(a), s = size('mast');
    for (let t = -BOUND; t <= BOUND; t += PYLON_GAP) {
      const x = fz * off + fx * t, z = -fx * off + fz * t;
      if (free(x, z, s.radius)) put('mast', x, z, a + PI / 2, s);   // the dishes face along the line
    }
  }
  for (const [key, n] of SINGLES[biome] || []) for (let i = 0; i < n; i++) near(key, 0, 0, BOUND);
  return out;
}

// What scatterProps must keep clear of in a mission: the start (and its flat
// ground), the mission's flat pads and its structures, and its roads.
export function missionAvoid(start, zones, entities) {
  return {
    avoid: [[start.x, start.z, 140], ...zones.map(([x, z, rad]) => [x, z, rad + 10]), ...entities.map(e => [e.x, e.z, e.radius + 25])],
    paths: entities.filter(e => e.path).map(e => [[e.x, e.z], ...e.path]),
  };
}
