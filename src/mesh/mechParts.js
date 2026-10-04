import { Builder } from './builder.js';
import { M, chain, mul } from '../util/math.js';
import { geoFor } from '../data/geo.js';

// Each chassis's flat-shaded parts, in two halves. The legs (hip, upper leg,
// lower leg, foot) come from its leg type and are sized from its body plan's
// l1 / l2 (geoFor): the IK in drawMech depends on those lengths. The body
// (torso, arm, barrel) comes from its `style`, which defaults to the leg type,
// so a new chassis can pair any legs with any silhouette. Keep each chassis's
// parts under 700 triangles (test/bodyPlans.test.js).
// Where each style's arm barrel sits in arm space. The barrel is its own part
// so an EMPTY arm hardpoint shows a bare arm, and each weapon can give it its
// own proportions (BARREL in scene.js).
export const BARREL_AT = { forward: [0, -1.15, 1.45], reverse: [0, -1.15, 1.45], quad: [0, -0.5, 1.6] };
export const styleOf = ch => ch.style || ch.legs;

const part = f => { const b = new Builder(); f(b); return b; };
const palette = ch => ({ c: ch.col, dark: mul(ch.col, 0.55), acc: ch.acc, glass: [0.08, 0.1, 0.13], tube: [0.06, 0.06, 0.07] });

export function buildMechParts(ch) {
  const legs = LEGS[ch.legs] || LEGS.forward, body = BODY[styleOf(ch)] || BODY[ch.legs] || BODY.forward;
  return { ...legs(ch, geoFor(ch)), ...body(ch) };
}

const LEGS = {
  // Upper leg runs l1 down -y from the hip, lower leg l2 down from the knee.
  forward(ch, g) {
    const { c, dark } = palette(ch), { l1, l2 } = g, k2 = l2 / 2.5;
    return {
      hip: part(b => b.cube(M.S(2.6, 0.9, 1.6), dark)),
      uleg: part(b => { b.cube(chain(M.T(0, -l1 / 2, 0), M.S(0.95, l1 + 0.2, 1.25)), c, 0.85, 0.9); b.cube(chain(M.T(0, -l1, 0.25), M.S(1.05, 0.75, 1)), dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -l2 / 2, -0.1), M.S(0.8, l2, 1.05)), c); b.cube(chain(M.T(0, -1.1 * k2, -0.65), M.S(0.3, 1.8 * k2, 0.3)), dark); }),
      foot: part(b => b.cube(chain(M.T(0, -0.2, 0.35), M.S(1.25, 0.4, 2.3)), dark, 0.8, 0.8)),
      plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),   // a knocked-loose armour plate (hit feedback)
    };
  },
  // Bird legs: an armoured thigh, a slimmer shin with a hydraulic ram, a
  // three-toed claw with a spur behind.
  reverse(ch, g) {
    const { c, dark } = palette(ch), { l1, l2 } = g, k2 = l2 / 2.9;
    return {
      hip: part(b => { b.cube(M.S(2.8, 0.9, 1.8), dark); b.cube(chain(M.T(0, -0.1, -0.9), M.S(1.4, 0.6, 0.5)), c); }),
      uleg: part(b => { b.cube(chain(M.T(0, -l1 / 2, 0), M.S(1.15, l1 + 0.2, 1.45)), c, 0.8, 0.85); b.cube(chain(M.T(0, -l1, 0), M.S(1.1, 0.8, 1.1)), dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -l2 / 2, 0), M.S(0.7, l2, 0.9)), c, 1.2, 1.15); b.cube(chain(M.T(0, -1.3 * k2, 0.55), M.S(0.28, 2.2 * k2, 0.28)), dark); }),
      plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),
      foot: part(b => {
        b.cube(chain(M.T(0, -0.15, 0), M.S(0.8, 0.5, 0.8)), dark);
        b.cube(chain(M.T(0, -0.32, 1.0), M.S(0.38, 0.34, 1.7)), dark, 0.7, 0.8);
        for (const sx of [1, -1]) b.cube(chain(M.T(sx * 0.42, -0.32, 0.75), M.RY(sx * 0.42), M.S(0.34, 0.32, 1.45)), dark, 0.7, 0.8);
        b.cube(chain(M.T(0, -0.32, -0.6), M.S(0.3, 0.3, 0.9)), dark, 0.7, 0.8);
      }),
    };
  },
  // A low armoured hull, drawn at hip height, on four bowed legs: a thigh,
  // a tapering shin and a broad pad of a foot.
  quad(ch, g) {
    const { c, dark, acc } = palette(ch), { l1, l2 } = g;
    return {
      hip: part(b => {
        b.cube(M.S(3.4, 1.3, 4.4), c, 0.85, 0.9);
        b.cube(chain(M.T(0, -0.1, 2.45), M.S(2.4, 0.9, 0.7)), dark, 0.8, 0.8);
        b.cube(chain(M.T(0, 0.15, -2.35), M.S(2.6, 1.0, 0.6)), dark);
        for (const sx of [1, -1]) for (const sz of [1, -1]) b.cube(chain(M.T(sx * 1.45, 0, sz * 1.6), M.S(0.95, 0.95, 0.95)), acc);
      }),
      uleg: part(b => { b.cube(chain(M.T(0, -l1 / 2, 0), M.S(0.8, l1, 0.9)), c); b.cube(chain(M.T(0, -l1, 0), M.S(0.95, 0.75, 0.95)), dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -l2 / 2, 0), M.S(0.55, l2, 0.6)), c, 1.45, 1.4); b.cube(chain(M.T(0, -0.2, 0), M.S(0.85, 0.5, 0.85)), dark); }),
      foot: part(b => b.cube(chain(M.T(0, -0.17, 0), M.S(1.15, 0.35, 1.15)), dark, 0.75, 0.75)),
      plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),
    };
  },
};

const BODY = {
  forward(ch) {
    const { c, dark, acc, glass } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 1.3, 0), M.S(3.4, 2.6, 2.6)), c, 0.85, 0.8);
        b.cube(chain(M.T(0, 2.15, 1.3), M.S(1.6, 0.9, 1)), glass, 0.75, 0.6);
        b.cube(chain(M.T(1.25, 2.85, -0.2), M.S(1.15, 0.7, 1.6)), acc);
        b.cube(chain(M.T(-1.25, 2.85, -0.2), M.S(1.15, 0.7, 1.6)), acc);
        b.cube(chain(M.T(0, 1.0, -1.5), M.S(2, 1.6, 0.6)), dark);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.6, 0.1), M.S(0.95, 1.8, 1.15)), c);
        b.cube(chain(M.T(0, 0.25, 0), M.S(1.25, 0.8, 1.45)), acc);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.forward), M.S(0.38, 0.38, 2.3)), dark)),
    };
  },
  // The mech from the sketch: square torso, domed cockpit, missile pods on
  // the shoulders.
  reverse(ch) {
    const { c, dark, acc, glass, tube } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 1.3, 0), M.S(3.2, 2.6, 2.4)), c, 0.95, 0.95);
        b.cube(chain(M.T(0, 2.95, 0.2), M.S(1.6, 0.8, 1.5)), c, 0.6, 0.6);          // the dome...
        b.cube(chain(M.T(0, 3.42, 0.2), M.S(0.95, 0.25, 0.9)), c, 0.55, 0.55);
        b.cube(chain(M.T(0, 3.0, 0.92), M.S(0.95, 0.26, 0.12)), glass);              // ...and its viewport
        for (const sx of [1, -1]) {                                                  // missile pods, tubes facing forward
          b.cube(chain(M.T(sx * 1.75, 3.0, -0.1), M.S(1.25, 1.25, 1.45)), acc);
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
            b.cube(chain(M.T(sx * 1.75 + (i - 1) * 0.34, 3.0 + (j - 1) * 0.34, 0.64), M.S(0.2, 0.2, 0.06)), tube);
        }
        b.cube(chain(M.T(0, 1.0, -1.35), M.S(2, 1.6, 0.5)), dark);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.6, 0.1), M.S(0.95, 1.8, 1.15)), c);
        b.cube(chain(M.T(0, 0.25, 0), M.S(1.2, 0.75, 1.35)), dark);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.reverse), M.S(0.38, 0.38, 2.3)), dark)),
    };
  },
  // The quadruped's turret: cockpit at the front, an LRM box on top.
  quad(ch) {
    const { c, dark, acc, glass, tube } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 0.7, 0), M.S(2.7, 1.4, 2.5)), c, 0.85, 0.85);
        b.cube(chain(M.T(0, 0.85, 1.3), M.S(1.5, 0.5, 0.25)), glass);
        b.cube(chain(M.T(0, 1.75, -0.3), M.S(1.8, 0.75, 1.5)), acc);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
          b.cube(chain(M.T((i - 1.5) * 0.4, 1.6 + j * 0.3, 0.46), M.S(0.22, 0.22, 0.06)), tube);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.35, 0.2), M.S(0.8, 1.1, 1.6)), c);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.quad), M.S(0.36, 0.36, 2.4)), dark)),
    };
  },
};
