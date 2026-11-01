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
