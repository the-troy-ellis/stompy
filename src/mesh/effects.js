import { Builder } from './builder.js';
import { M } from '../util/math.js';
import { KINDS } from '../sim/particles.js';

// Effect shapes (docs/specs/14-look-and-performance.md § The look 2): every
// effect is a small solid, one shape per kind, drawn instanced (one draw per
// shape) and coloured per instance, so the shapes are built white. Unit size:
// about 1 across, centred on the origin. ≤ 16 triangles each.
export const SHAPE_OF = { smoke: 'cube', dust: 'flat', fire: 'tetra', flame: 'tetra', debris: 'chunk', spark: 'sliver', rain: 'streak', snow: 'octa' };
export const EFFECT_SHAPES = ['cube', 'tetra', 'chunk', 'sliver', 'octa', 'flat', 'streak'];
export const shapeOf = kind => SHAPE_OF[kind] || 'cube';
// The same, by the particle pool's kind number (sim/particles.js KINDS).
export const SHAPE_BY_KIND = KINDS.map(shapeOf);
// Soft things dither out over the last third of their life (§ The look 3):
// an ordered 4x4 pattern of skipped pixels, never blending. Their shapes are
// drawn by the dithering shader, after the solid ones, since a shader that can
// skip pixels can turn off a phone GPU's early depth test.
export const DITHER_KINDS = ['smoke', 'dust'];
export const DITHER_SHAPES = [...new Set(DITHER_KINDS.map(shapeOf))];
const DITHERS = KINDS.map(k => DITHER_KINDS.includes(k));
export const DITHER_FROM = 1 / 3;   // of its life left

const W = [1, 1, 1], O = [0, 0, 0];
const solid = (b, verts, faces) => { for (const [a, c, d] of faces) b.tri(verts[a], verts[c], verts[d], W, O); };
const BUILD = {
  cube: b => b.cube(M.id(), W),
  chunk: b => b.cube(M.id(), W, 0.55, 0.7),        // a tapered lump of armour
  sliver: b => b.cube(M.S(0.16, 1, 0.16), W),      // thin: sparks
  streak: b => b.cube(M.S(0.05, 1, 0.05), W),      // thinner: rain
  flat: b => b.cube(M.S(1, 0.35, 1), W),           // dust that streams sideways
  // Fire: a tetrahedron is far less solid than a cube the same width, so it is
  // drawn ~1.4x wider to keep a fireball's weight.
  tetra: b => solid(b, [[0, 0.87, 0], [0.76, -0.43, 0.43], [-0.76, -0.43, 0.43], [0, -0.43, -0.87]], [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]),
  octa: b => {
    const v = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5]];
    solid(b, v, [[2, 0, 4], [2, 4, 1], [2, 1, 5], [2, 5, 0], [3, 4, 0], [3, 1, 4], [3, 5, 1], [3, 0, 5]]);
  },
};
export function buildEffectShapes() {
  return Object.fromEntries(EFFECT_SHAPES.map(k => { const b = new Builder(); BUILD[k](b); return [k, b]; }));
}

// How particle i of the pool P looks this frame, written into the Float32Array
// `out` as [size, r, g, b, glow, heat, dither] (glow 1 ignores the light; heat
// is for IR; dither is the share of its pixels skipped, 0 to 1). A typed
// array, not an object, so drawing thousands allocates nothing: numbers stored
// on an object's fields can be boxed one by one. Fire shrinks and reddens, a
// flamer's puff swells and reddens, smoke grows and fades into the horizon
// colour `hor`; the rest are plain and unlit. Smoke and dust dither out.
export function effectLook(P, i, hor, out) {
  const f = P.life[i] / P.max[i], kind = KINDS[P.kind[i]], c = P.col, c0 = c[i * 3], c1 = c[i * 3 + 1], c2 = c[i * 3 + 2];
  let size = P.size[i], emis = 1, heat = 0.3, r = c0, g = c1, b = c2;
  if (kind === 'fire') { size *= 0.4 + f * 0.8; r = 0.4 + (c0 - 0.4) * f; g = 0.1 + (c1 - 0.1) * f; b = 0.05 + (c2 - 0.05) * f; heat = f; }
  else if (kind === 'flame') { size *= 0.5 + (1 - f) * 3; r = 0.55 + (c0 - 0.55) * f; g = 0.12 + (c1 - 0.12) * f; b = 0.04 + (c2 - 0.04) * f; heat = f; }
  else if (kind === 'smoke') { size *= 1.6 - f * 0.8; r = hor[0] + (c0 - hor[0]) * f; g = hor[1] + (c1 - hor[1]) * f; b = hor[2] + (c2 - hor[2]) * f; emis = 0.6; heat = 0.15; }
  else emis = 0;
  out[0] = size; out[1] = r; out[2] = g; out[3] = b; out[4] = emis; out[5] = heat;
  out[6] = DITHERS[P.kind[i]] && f < DITHER_FROM ? 1 - f / DITHER_FROM : 0;
  return out;
}
