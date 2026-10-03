import { Builder } from './builder.js';
import { M, chain, mul } from '../util/math.js';

// Each chassis's flat-shaded parts: hip, upper leg, lower leg, foot, torso,
// arm. Leg lengths match GEO (l1 / l2): the IK in drawMech depends on them.
export function buildMechParts(ch) {
  if (ch.legs === 'reverse') return buildReverseParts(ch);
  if (ch.legs === 'quad') return buildQuadParts(ch);
  const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13];
  const part = f => { const b = new Builder(); f(b); return b; };
  return {
    hip: part(b => b.cube(M.S(2.6, 0.9, 1.6), dark)),
    // Upper leg runs 2.6 down -y from the hip, lower leg 2.5 down from the knee
    // (GEO.forward.l1 / l2): the IK in drawMech depends on these lengths.
    uleg: part(b => { b.cube(chain(M.T(0, -1.3, 0), M.S(0.95, 2.8, 1.25)), c, 0.85, 0.9); b.cube(chain(M.T(0, -2.6, 0.25), M.S(1.05, 0.75, 1)), dark); }),
    lleg: part(b => { b.cube(chain(M.T(0, -1.25, -0.1), M.S(0.8, 2.5, 1.05)), c); b.cube(chain(M.T(0, -1.1, -0.65), M.S(0.3, 1.8, 0.3)), dark); }),
    foot: part(b => b.cube(chain(M.T(0, -0.2, 0.35), M.S(1.25, 0.4, 2.3)), dark, 0.8, 0.8)),
    plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),   // a knocked-loose armour plate (hit feedback)
    torso: part(b => {
      b.cube(chain(M.T(0, 1.3, 0), M.S(3.4, 2.6, 2.6)), c, 0.85, 0.8);
      b.cube(chain(M.T(0, 2.15, 1.3), M.S(1.6, 0.9, 1)), glass, 0.75, 0.6);
      b.cube(chain(M.T(1.25, 2.85, -0.2), M.S(1.15, 0.7, 1.6)), acc);
      b.cube(chain(M.T(-1.25, 2.85, -0.2), M.S(1.15, 0.7, 1.6)), acc);
      b.cube(chain(M.T(0, 1.0, -1.5), M.S(2, 1.6, 0.6)), dark);
    }),
    arm: part(b => {
      b.cube(chain(M.T(0, -0.6, 0.1), M.S(0.95, 1.8, 1.15)), c);
      b.cube(chain(M.T(0, -1.15, 1.45), M.S(0.38, 0.38, 2.3)), dark);
      b.cube(chain(M.T(0, 0.25, 0), M.S(1.25, 0.8, 1.45)), acc);
    }),
  };
}

// The mech from the sketch: square torso, domed cockpit, missile pods on the
// shoulders, bird legs with clawed feet.

function buildReverseParts(ch) {
  const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13], tube = [0.06, 0.06, 0.07];
  const part = f => { const b = new Builder(); f(b); return b; };
  return {
    hip: part(b => { b.cube(M.S(2.8, 0.9, 1.8), dark); b.cube(chain(M.T(0, -0.1, -0.9), M.S(1.4, 0.6, 0.5)), c); }),
    // l1 = 2.7: an armoured thigh.
    uleg: part(b => { b.cube(chain(M.T(0, -1.35, 0), M.S(1.15, 2.9, 1.45)), c, 0.8, 0.85); b.cube(chain(M.T(0, -2.7, 0), M.S(1.1, 0.8, 1.1)), dark); }),
    // l2 = 2.9: a slimmer shin with a hydraulic ram.
    lleg: part(b => { b.cube(chain(M.T(0, -1.45, 0), M.S(0.7, 2.9, 0.9)), c, 1.2, 1.15); b.cube(chain(M.T(0, -1.3, 0.55), M.S(0.28, 2.2, 0.28)), dark); }),
    // Three toes forward and a spur behind.
    plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),   // a knocked-loose armour plate (hit feedback)
    foot: part(b => {
      b.cube(chain(M.T(0, -0.15, 0), M.S(0.8, 0.5, 0.8)), dark);
      b.cube(chain(M.T(0, -0.32, 1.0), M.S(0.38, 0.34, 1.7)), dark, 0.7, 0.8);
      for (const sx of [1, -1]) b.cube(chain(M.T(sx * 0.42, -0.32, 0.75), M.RY(sx * 0.42), M.S(0.34, 0.32, 1.45)), dark, 0.7, 0.8);
      b.cube(chain(M.T(0, -0.32, -0.6), M.S(0.3, 0.3, 0.9)), dark, 0.7, 0.8);
    }),
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
      b.cube(chain(M.T(0, -1.15, 1.45), M.S(0.38, 0.38, 2.3)), dark);
      b.cube(chain(M.T(0, 0.25, 0), M.S(1.2, 0.75, 1.35)), dark);
    }),
  };
}

// A low armoured hull on four bowed legs, weapons on a turret.
function buildQuadParts(ch) {
  const c = ch.col, dark = mul(c, 0.55), acc = ch.acc, glass = [0.08, 0.1, 0.13], tube = [0.06, 0.06, 0.07];
  const part = f => { const b = new Builder(); f(b); return b; };
  return {
    // The hull, drawn at hip height; leg mounts at the corners.
    hip: part(b => {
      b.cube(M.S(3.4, 1.3, 4.4), c, 0.85, 0.9);
      b.cube(chain(M.T(0, -0.1, 2.45), M.S(2.4, 0.9, 0.7)), dark, 0.8, 0.8);
      b.cube(chain(M.T(0, 0.15, -2.35), M.S(2.6, 1.0, 0.6)), dark);
      for (const sx of [1, -1]) for (const sz of [1, -1]) b.cube(chain(M.T(sx * 1.45, 0, sz * 1.6), M.S(0.95, 0.95, 0.95)), acc);
    }),
    // l1 = 2.4 thigh, l2 = 2.9 tapering shin, a broad pad of a foot.
    uleg: part(b => { b.cube(chain(M.T(0, -1.2, 0), M.S(0.8, 2.4, 0.9)), c); b.cube(chain(M.T(0, -2.4, 0), M.S(0.95, 0.75, 0.95)), dark); }),
    lleg: part(b => { b.cube(chain(M.T(0, -1.45, 0), M.S(0.55, 2.9, 0.6)), c, 1.45, 1.4); b.cube(chain(M.T(0, -0.2, 0), M.S(0.85, 0.5, 0.85)), dark); }),
    foot: part(b => b.cube(chain(M.T(0, -0.17, 0), M.S(1.15, 0.35, 1.15)), dark, 0.75, 0.75)),
    plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),   // a knocked-loose armour plate (hit feedback)
    // The turret: cockpit at the front, an LRM box on top.
    torso: part(b => {
      b.cube(chain(M.T(0, 0.7, 0), M.S(2.7, 1.4, 2.5)), c, 0.85, 0.85);
      b.cube(chain(M.T(0, 0.85, 1.3), M.S(1.5, 0.5, 0.25)), glass);
      b.cube(chain(M.T(0, 1.75, -0.3), M.S(1.8, 0.75, 1.5)), acc);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
        b.cube(chain(M.T((i - 1.5) * 0.4, 1.6 + j * 0.3, 0.46), M.S(0.22, 0.22, 0.06)), tube);
    }),
    arm: part(b => {
      b.cube(chain(M.T(0, -0.35, 0.2), M.S(0.8, 1.1, 1.6)), c);
      b.cube(chain(M.T(0, -0.5, 1.6), M.S(0.36, 0.36, 2.4)), dark);
    }),
  };
}
