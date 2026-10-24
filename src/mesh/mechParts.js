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
export const BARREL_AT = { forward: [0, -1.15, 1.45], reverse: [0, -1.15, 1.45], quad: [0, -0.5, 1.6], puncher: [0, -1.15, 1.45], light1: [0, -0.85, 1.1], sniper1: [0, -1.0, 1.5] };
export const styleOf = ch => ch.style || ch.legs;

const part = f => { const b = new Builder(); f(b); return b; };
// The joints: round, so a limb turning about one never shows a box corner
// cutting through its neighbour. A hinge is a drum across the limb (along its
// x, the axis a knee or a shoulder turns about), `d` across and `len` wide; a
// ball is a sphere `d` across. Each is sized to cover the corners that sweep
// round it, and left out of the HUD's wireframe (Builder.joint).
const hinge = (b, at, d, len, col) => b.joint(j => j.cyl(chain(M.T(...at), M.RZ(Math.PI / 2), M.S(d, len, d)), col));
const ball = (b, at, d, col) => b.joint(j => j.sphere(chain(M.T(...at), M.S(d, d, d)), col));
const palette = ch => ({ c: ch.col, dark: mul(ch.col, 0.55), acc: ch.acc, glass: [0.08, 0.1, 0.13], tube: [0.06, 0.06, 0.07] });

export function buildMechParts(ch) {
  const legs = LEGS[ch.legs] || LEGS.forward, body = BODY[styleOf(ch)] || BODY[ch.legs] || BODY.forward;
  return { ...legs(ch, geoFor(ch)), ...body(ch) };
}

const LEGS = {
  // Upper leg runs l1 down -y from the hip, lower leg l2 down from the knee;
  // `girth` thickens the whole leg (PURPLE PUNCHER's are tree trunks).
  forward(ch, g) {
    const { c, dark } = palette(ch), { l1, l2 } = g, k2 = l2 / 2.5, w = g.girth || 1;
    return {
      hip: part(b => b.cube(M.S(2.6 * w, 0.9 * w, 1.6 * w), dark)),
      uleg: part(b => { b.cube(chain(M.T(0, -l1 / 2, 0), M.S(0.95 * w, l1 + 0.2, 1.25 * w)), c, 0.85, 0.9); ball(b, [0, 0, 0], 1.3 * w, dark); hinge(b, [0, -l1, 0.05], 1.4 * w, 1.15 * w, dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -l2 / 2, -0.1), M.S(0.8 * w, l2, 1.05 * w)), c); b.cube(chain(M.T(0, -1.1 * k2, -0.65 * w), M.S(0.3 * w, 1.8 * k2, 0.3 * w)), dark); ball(b, [0, -l2, -0.05], 1.0 * w, dark); }),
      foot: part(b => b.cube(chain(M.T(0, -0.2, 0.35 * w), M.S(1.25 * w, 0.4 * w, 2.3 * w)), dark, 0.8, 0.8)),
      plate: part(b => b.cube(M.S(0.9, 0.12, 0.7), c)),   // a knocked-loose armour plate (hit feedback)
    };
  },
  // Bird legs: an armoured thigh, a slimmer shin with a hydraulic ram, a
  // three-toed claw with a spur behind.
  reverse(ch, g) {
    const { c, dark } = palette(ch), { l1, l2 } = g, k2 = l2 / 2.9;
    return {
      hip: part(b => { b.cube(M.S(2.8, 0.9, 1.8), dark); b.cube(chain(M.T(0, -0.1, -0.9), M.S(1.4, 0.6, 0.5)), c); }),
      uleg: part(b => { b.cube(chain(M.T(0, -l1 / 2, 0), M.S(1.15, l1 + 0.2, 1.45)), c, 0.8, 0.85); ball(b, [0, 0, 0], 1.5, dark); hinge(b, [0, -l1, 0], 1.6, 1.25, dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -l2 / 2, 0), M.S(0.7, l2, 0.9)), c, 1.2, 1.15); b.cube(chain(M.T(0, -1.3 * k2, 0.55), M.S(0.28, 2.2 * k2, 0.28)), dark); ball(b, [0, -l2, 0], 0.95, dark); }),
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
        for (const sx of [1, -1]) for (const sz of [1, -1]) ball(b, [sx * 1.45, 0, sz * 1.6], 1.2, acc);   // the hip joints
      }),
      uleg: part(b => { b.cube(chain(M.T(0, -l1 / 2, 0), M.S(0.8, l1, 0.9)), c); hinge(b, [0, -l1, 0], 1.2, 1.05, dark); }),
      lleg: part(b => { b.cube(chain(M.T(0, -l2 / 2, 0), M.S(0.55, l2, 0.6)), c, 1.45, 1.4); ball(b, [0, -l2, 0], 0.8, dark); }),
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
        hinge(b, [0, 0.15, 0], 1.5, 1.25, acc);   // the shoulder
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
        hinge(b, [0, 0.15, 0], 1.45, 1.2, dark);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.reverse), M.S(0.38, 0.38, 2.3)), dark)),
    };
  },
  // PURPLE PUNCHER: a torso wider than it is tall, shoulders like a fridge,
  // a low cockpit slit under a flat head, short thick arms, and two
  // oversized yellow fists (their own part, so they swing and read as fists
  // from 400 m). Its cannon pokes out low on the left; the FIRECRACKERS box
  // sits on the right shoulder.
  puncher(ch) {
    const { c, dark, acc, glass, tube } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 1.2, 0), M.S(4.6, 2.4, 3.0)), c, 0.92, 0.9);
        for (const sx of [1, -1]) b.cube(chain(M.T(sx * 2.45, 1.75, -0.05), M.S(1.5, 1.7, 2.3)), dark, 0.9, 0.9);   // the fridge shoulders
        b.cube(chain(M.T(0, 2.62, 0.25), M.S(1.9, 0.45, 1.6)), c, 0.85, 0.85);                                     // a flat head
        b.cube(chain(M.T(0, 1.8, 1.52), M.S(2.4, 0.26, 0.08)), glass);                                             // the slit
        b.cube(chain(M.T(0, 0.95, -1.75), M.S(2.8, 1.6, 0.6)), dark);
        b.cube(chain(M.T(-0.9, 0.9, 1.75), M.S(0.42, 0.42, 1.2)), dark);                                           // cannon stub
        b.cube(chain(M.T(-1.25, 2.55, 0.1), M.S(1.0, 0.7, 1.2)), acc);                                             // the FIRECRACKERS box
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
          b.cube(chain(M.T(-1.25 + (i - 1) * 0.28, 2.42 + j * 0.28, 0.72), M.S(0.18, 0.18, 0.06)), tube);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.55, 0.1), M.S(1.35, 1.5, 1.45)), c);
        hinge(b, [0, 0.15, 0], 1.8, 1.6, dark);
      }),
      // Hangs knuckles-down below the arm; a punch swings it forward, knuckles first.
      fist: part(b => {
        b.cube(chain(M.T(0, -1.75, 0.3), M.S(1.65, 1.5, 1.7)), acc, 0.95, 0.95);
        for (let i = 0; i < 4; i++) b.cube(chain(M.T((i - 1.5) * 0.4, -2.55, 0.35), M.S(0.34, 0.22, 1.5)), mul(acc, 0.75));
        b.cube(chain(M.T(0.95, -1.6, 0.75), M.S(0.35, 0.8, 0.6)), mul(acc, 0.85));   // a thumb
      }),
    };
  },
  // PIPSQUEAK (light1, placeholder name): a narrow torso with a single eye
  // slit, a little fin, a PEASHOOTER stub low on the front, and small arms
  // (the left one's gun is the FIRECRACKERS box, shaped by BARREL).
  light1(ch) {
    const { c, dark, acc, glass } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 1.1, 0), M.S(2.2, 2.0, 2.0)), c, 0.85, 0.8);
        b.cube(chain(M.T(0, 1.55, 1.02), M.S(1.3, 0.18, 0.06)), glass);   // the one eye
        b.cube(chain(M.T(0, 2.3, -0.25), M.S(0.28, 0.6, 1.3)), acc, 0.6, 0.7);
        b.cube(chain(M.T(0, 0.9, -1.15), M.S(1.4, 1.2, 0.4)), dark);
        b.cube(chain(M.T(-0.7, 0.8, 1.2), M.S(0.22, 0.22, 0.9)), dark);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.45, 0.05), M.S(0.7, 1.2, 0.85)), c);
        hinge(b, [0, 0.1, 0], 1.05, 0.9, dark);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.light1), M.S(0.3, 0.3, 1.6)), dark)),
    };
  },
  // BEANPOLE (sniper1, placeholder name): a slim torso with a visor, a tall
  // sensor mast with a dish, a MED LASER stub on the front, and slim arms
  // (the right one's BIG BONKER barrel is long, by BARREL).
  sniper1(ch) {
    const { c, dark, acc, glass } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 1.25, 0), M.S(2.6, 2.3, 2.3)), c, 0.85, 0.85);
        b.cube(chain(M.T(0, 1.95, 1.17), M.S(1.4, 0.45, 0.1)), glass);
        b.cube(chain(M.T(0.7, 3.4, -0.5), M.S(0.18, 2.3, 0.18)), dark);    // the mast...
        b.cube(chain(M.T(0.7, 4.6, -0.5), M.S(0.7, 0.22, 0.7)), acc);      // ...its cap...
        b.cube(chain(M.T(0.7, 4.0, -0.3), M.S(0.55, 0.55, 0.1)), acc);     // ...and a dish
        b.cube(chain(M.T(0, 1.0, -1.3), M.S(1.8, 1.4, 0.5)), dark);
        b.cube(chain(M.T(-0.9, 1.3, 1.3), M.S(0.25, 0.25, 0.7)), dark);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.55, 0.1), M.S(0.8, 1.6, 1.0)), c);
        hinge(b, [0, 0.15, 0], 1.3, 1.05, acc);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.sniper1), M.S(0.34, 0.34, 2.4)), dark)),
    };
  },
  // The digger (spec 20, placeholder name): a safety-yellow cab with a wide
  // window, black and yellow hazard stripes across its chest, an exhaust
  // stack, and an open hopper on its back for the ore. Short thick arms end
  // in two buckets (the `fist` part, so they swing like PURPLE PUNCHER's):
  // a scoop open to the front with a row of teeth.
  digger(ch) {
    const { c, dark, acc, glass } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 1.2, 0.35), M.S(3.8, 2.4, 2.4)), c, 0.92, 0.9);                       // the cab
        b.cube(chain(M.T(0, 2.0, 1.56), M.S(2.6, 0.75, 0.08)), glass);                           // its window
        b.cube(chain(M.T(0, 2.55, 0.35), M.S(3.0, 0.3, 2.0)), dark);                              // a roof rail
        for (let i = 0; i < 5; i++) b.cube(chain(M.T((i - 2) * 0.72, 0.75, 1.56), M.RZ(0.6), M.S(0.3, 0.9, 0.08)), acc);   // hazard stripes
        b.cube(chain(M.T(1.45, 3.15, -0.2), M.S(0.32, 1.5, 0.32)), dark);                         // the exhaust stack...
        b.cube(chain(M.T(1.45, 3.95, -0.2), M.S(0.42, 0.2, 0.42)), acc);                          // ...and its cap
        // The hopper: an open box on the back, a floor and four walls.
        b.cube(chain(M.T(0, 1.5, -1.6), M.S(3.2, 0.25, 1.9)), dark);
        b.cube(chain(M.T(0, 2.25, -2.5), M.S(3.2, 1.5, 0.2)), c, 0.95, 0.9);
        b.cube(chain(M.T(0, 2.1, -0.75), M.S(3.2, 1.2, 0.2)), c);
        for (const sx of [1, -1]) b.cube(chain(M.T(sx * 1.55, 2.2, -1.6), M.S(0.2, 1.4, 1.9)), c, 1, 0.9);
      }),
      arm: part(b => {
        b.cube(chain(M.T(0, -0.5, 0.15), M.S(1.2, 1.4, 1.3)), c);
        hinge(b, [0, 0.15, 0], 1.65, 1.45, dark);
      }),
      // Hangs below the arm, open to the front; the bite swings it forward and down.
      fist: part(b => {
        b.cube(chain(M.T(0, -1.7, -0.35), M.S(1.9, 1.4, 0.2)), acc);                              // the back
        b.cube(chain(M.T(0, -2.35, 0.35), M.S(1.9, 0.2, 1.5)), acc);                              // the floor
        for (const sx of [1, -1]) b.cube(chain(M.T(sx * 0.9, -1.85, 0.25), M.S(0.16, 1.1, 1.3)), mul(acc, 1.6));   // the sides
        for (let i = 0; i < 4; i++) b.cube(chain(M.T((i - 1.5) * 0.46, -2.4, 1.2), M.S(0.2, 0.18, 0.4)), dark);    // teeth
      }),
    };
  },
  // The hauler (docs/specs/21-mining.md § The hauler, placeholder name), on
  // the quad's legs: the digger's safety yellow, a low cab up front with
  // hazard stripes under its window, an exhaust stack, and behind it a big
  // open tub for the ore, its rims in black. No guns: its arms are lamp boxes.
  hauler(ch) {
    const { c, dark, acc, glass } = palette(ch);
    return {
      torso: part(b => {
        b.cube(chain(M.T(0, 0.2, -0.1), M.S(3.6, 0.4, 4.8)), dark);                               // the deck
        b.cube(chain(M.T(0, 1.15, 1.65), M.S(2.8, 1.5, 1.4)), c, 0.92, 0.9);                       // the cab
        b.cube(chain(M.T(0, 1.45, 2.36), M.S(2.2, 0.6, 0.08)), glass);                            // its window
        for (let i = 0; i < 4; i++) b.cube(chain(M.T((i - 1.5) * 0.66, 0.75, 2.36), M.RZ(0.6), M.S(0.28, 0.75, 0.08)), acc);   // hazard stripes
        b.cube(chain(M.T(1.1, 2.35, 1.3), M.S(0.28, 1.0, 0.28)), dark);                           // the exhaust stack...
        b.cube(chain(M.T(1.1, 2.9, 1.3), M.S(0.38, 0.16, 0.38)), acc);                            // ...and its cap
        // The tub: a floor and four walls, black along the top.
        b.cube(chain(M.T(0, 0.5, -1.0), M.S(3.4, 0.2, 3.2)), dark);
        b.cube(chain(M.T(0, 1.35, -2.55), M.S(3.4, 1.5, 0.2)), c, 0.95, 0.9);
        b.cube(chain(M.T(0, 1.35, 0.55), M.S(3.4, 1.5, 0.2)), c);
        for (const sx of [1, -1]) {
          b.cube(chain(M.T(sx * 1.65, 1.35, -1.0), M.S(0.2, 1.5, 3.2)), c, 1, 0.9);
          b.cube(chain(M.T(sx * 1.65, 2.15, -1.0), M.S(0.28, 0.12, 3.3)), acc);
        }
        b.cube(chain(M.T(0, 2.15, -2.55), M.S(3.5, 0.12, 0.28)), acc);
      }),
      arm: part(b => { b.cube(chain(M.T(0, -0.1, 0.3), M.S(0.6, 0.6, 1.0)), dark); hinge(b, [0, 0, 0], 0.8, 0.7, c); }),
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
        hinge(b, [0, 0, 0], 1.1, 0.9, dark);
      }),
      barrel: part(b => b.cube(chain(M.T(...BARREL_AT.quad), M.S(0.36, 0.36, 2.4)), dark)),
    };
  },
};

// One draw per mech (docs/specs/14-look-and-performance.md § The plan, P4):
// every part of a chassis in one mesh, each vertex tagged with the bone that
// moves it, so drawMech fills a matrix per bone and draws once. Fists ride on
// their arm's bone. A bone whose part is gone (a shot-off limb, an empty
// hardpoint) gets a zero matrix and draws nothing.
export const BONE = { hip: 0, torso: 1, arm: [2, 3], barrel: [4, 5], leg: i => 6 + i * 3 };   // a leg's upper, lower, foot: leg(i), +1, +2
export const BONE_COUNT = 18;   // up to four legs
export const SKIN_FLOATS = 10;  // pos, normal, colour, bone

// `parts` as buildMechParts returns them; `legs` how many the chassis stands on.
export function skinMech(parts, legs) {
  const d = [];
  const add = (b, bone) => { if (!b) return; for (let i = 0; i < b.d.length; i += 9) d.push(...b.d.slice(i, i + 9), bone); };
  add(parts.hip, BONE.hip);
  add(parts.torso, BONE.torso);
  for (const s of [0, 1]) { add(parts.arm, BONE.arm[s]); add(parts.fist, BONE.arm[s]); add(parts.barrel, BONE.barrel[s]); }
  for (let i = 0; i < legs; i++) { add(parts.uleg, BONE.leg(i)); add(parts.lleg, BONE.leg(i) + 1); add(parts.foot, BONE.leg(i) + 2); }
  return { d };
}

// Where a mech's two headlamps sit, in torso space (docs/specs/07 §
// Headlights): on the torso's front face, a third of the way out to each
// side and a little above its middle, read off the torso mesh so every body
// style gets them in the right place.
export function lampSpots(parts) {
  const d = parts.torso.d;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < d.length; i += 9) {
    x0 = Math.min(x0, d[i]); x1 = Math.max(x1, d[i]); y0 = Math.min(y0, d[i + 1]); y1 = Math.max(y1, d[i + 1]); z1 = Math.max(z1, d[i + 2]);
  }
  const x = (x1 - x0) / 6, y = y0 + (y1 - y0) * 0.6, cx = (x0 + x1) / 2;
  return [[cx + x, y, z1 + 0.05], [cx - x, y, z1 + 0.05]];
}
