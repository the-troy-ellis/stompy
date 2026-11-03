// Ore seams (docs/specs/21-mining.md § Seams): bands of ore through the rock,
// from the ground's seed and nothing else, so every client and the mesher see
// the same ones and nothing is stored. Wavy layers SEAM_PITCH metres apart and
// SEAM_THICK of that thick (about 9 m, so the 8 m corner grid always catches
// a layer), thinned to patches by a sideways pattern. Pure: the sim, the
// mesher (in its worker) and the tests all call it.
export const SEAM_PITCH = 26, SEAM_THICK = 0.36;
const { sin, cos, floor } = Math;

export function seamAt(seed, x, y, z) {
  const s = (seed % 997) * 0.37;
  // The layers lean and roll a few metres across the map.
  const lay = y + 5 * sin(x * 0.011 + s) * cos(z * 0.013 - s * 1.3) + 3 * sin((x + z) * 0.007 + s * 2.1);
  const band = lay / SEAM_PITCH;
  if (band - floor(band) >= SEAM_THICK) return false;
  // Patches: a seam comes and goes along its layer.
  return sin(x * 0.019 + s * 3.1) + sin(z * 0.023 - s * 1.7) + 0.6 * sin((x - z) * 0.031 + floor(band) * 1.9) > -0.5;
}

// Isotope seams (docs/specs/33-production.md § The isotope plant and cores):
// rarer bands, thinner and further apart than ore, in patches that seldom
// show, laid on their own phase so they cross the ore's. Pure, as seamAt is.
export const ISO_PITCH = 47, ISO_THICK = 0.2;
export function isoAt(seed, x, y, z) {
  const s = (seed % 991) * 0.53;
  const lay = y + 6 * sin(x * 0.009 - s) * cos(z * 0.012 + s * 0.7) + 4 * sin((x - z) * 0.006 + s * 1.3);
  const band = lay / ISO_PITCH;
  if (band - floor(band) >= ISO_THICK) return false;
  return sin(x * 0.017 - s * 2.3) + sin(z * 0.021 + s * 1.1) + 0.6 * sin((x + z) * 0.027 + floor(band) * 2.3) > 0.9;
}

// Spread out (docs/specs/32-base-loop.md § Part 3): the rock near the silo
// runs thin and the rich ground is out there. `oreSpread` is how much of a
// plain cut's ore the ground at distance `d` from the silo gives (S:
// data/construct.js ORE_SPREAD): S.near at the silo, 1 at S.at, S.far by S.out.
export function oreSpread(d, S) {
  if (d <= S.at) return S.near + (1 - S.near) * Math.max(0, d) / S.at;
  return 1 + (S.far - 1) * Math.min(1, (d - S.at) / (S.out - S.at));
}

// Lodes: L.n rich patches, L.r across their middle, between L.near and L.far
// from the silo at (sx, sz), spread round it and inside the bounds (bx, bz).
// From the seed and nothing else.
function hash(seed, i) {
  let t = (Math.imul(seed | 0, 2654435761) ^ Math.imul(i + 1, 40503)) >>> 0;
  t ^= t >>> 15; t = Math.imul(t, 2246822519) >>> 0; t ^= t >>> 13; t = Math.imul(t, 3266489917) >>> 0; t ^= t >>> 16;
  return (t >>> 0) / 4294967296;
}
export function lodesFor(seed, sx, sz, bx, bz, L) {
  const out = [], a0 = hash(seed, 0) * 2 * Math.PI, edge = L.r + 20;
  for (let i = 0; i < L.n; i++) {
    const a = a0 + i * 2 * Math.PI / L.n + (hash(seed, 2 * i + 1) - 0.5) * 1.2;
    let d = L.near + hash(seed, 2 * i + 2) * (L.far - L.near), x, z;
    for (;;) {   // pulled in toward the silo if the map's edge is nearer (never under L.near / 2)
      x = sx + sin(a) * d; z = sz + cos(a) * d;
      if ((Math.abs(x) < bx - edge && Math.abs(z) < bz - edge) || d <= L.near / 2) break;
      d -= 10;
    }
    out.push({ x, z, r: L.r, found: false });
  }
  return out;
}
