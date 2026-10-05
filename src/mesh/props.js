import { Builder } from './builder.js';
import { M, chain } from '../util/math.js';

// Mission props (docs/specs/07-atmosphere.md § Props): flat-shaded, under 120
// triangles each, readable at 400 m. Each is built in unit space: 1 across
// the footprint radius, 1 tall, nose along +z. scene.js scales it by the
// entity's radius and height, so the mesh always matches the hit cylinder.
// A structure that blows up shows its `<key>Wreck`; one punched over shows
// the intact mesh lying down. The pad is flat, so its height scales with
// its radius instead (it sits on a nav point, which has no height).
const C = {
  steel: [0.62, 0.63, 0.6], dark: [0.34, 0.35, 0.34], rust: [0.55, 0.36, 0.22], red: [0.85, 0.16, 0.12],
  hazard: [0.86, 0.68, 0.12], olive: [0.55, 0.58, 0.38], tyre: [0.1, 0.1, 0.11], glass: [0.12, 0.16, 0.2],
  char: [0.2, 0.19, 0.18], ash: [0.32, 0.3, 0.28], tank: [0.78, 0.76, 0.7], pad: [0.3, 0.31, 0.32],
};
const part = f => { const b = new Builder(); f(b); return b; };
const box = (b, x, y, z, w, h, d, col, extra = M.id(), tx = 1, tz = 1) => b.cube(chain(extra, M.T(x, y + h / 2, z), M.S(w, h, d)), col, tx, tz);

const BUILD = {
  // Mission 2's radio relay: a hut, a tapering lattice mast with crossbars,
  // a dish and a red tip.
  relay: b => {
    box(b, 0, 0, 0, 1.7, 0.14, 1.5, C.dark);
    box(b, 0, 0.14, 0, 0.62, 0.72, 0.62, C.steel, M.id(), 0.35, 0.35);
    for (const y of [0.3, 0.5, 0.68]) box(b, 0, y, 0, 0.76 - y * 0.66, 0.025, 0.76 - y * 0.66, C.rust);
    b.cyl(chain(M.T(0, 0.66, 0.3), M.RX(1.2), M.S(0.8, 0.07, 0.8)), C.tank, 8);
    box(b, 0, 0.86, 0, 0.12, 0.14, 0.12, C.red);
  },
  relayWreck: b => {
    box(b, 0, 0, 0, 1.7, 0.12, 1.5, C.char);
    box(b, 0, 0.12, 0, 0.62, 0.16, 0.62, C.ash, M.id(), 0.85, 0.85);
    box(b, 0.3, 0.02, -0.15, 0.24, 0.1, 1.5, C.ash, M.RY(0.5), 0.6, 1);
    b.cyl(chain(M.T(-0.55, 0.05, 0.45), M.RZ(0.3), M.S(0.62, 0.06, 0.62)), C.char, 8);
  },
  // A fuel tank: a squat cylinder with a dome, a hazard band and a pipe.
  tank: b => {
    b.cyl(chain(M.T(0, 0.38, 0), M.S(1.8, 0.76, 1.8)), C.tank, 8);
    b.cyl(chain(M.T(0, 0.84, 0), M.S(1.8, 0.16, 1.8)), C.tank, 8, 0.45);
    b.cyl(chain(M.T(0, 0.58, 0), M.S(1.84, 0.08, 1.84)), C.hazard, 8);
    box(b, 0, 0, 0.98, 0.12, 0.12, 0.3, C.dark);
  },
  tankWreck: b => {
    b.cyl(chain(M.T(0, 0.12, 0), M.S(1.8, 0.24, 1.8)), C.char, 8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      box(b, 0, 0, 0, 0.5, 0.36, 0.06, C.ash, chain(M.RY(a), M.T(0, 0.2, 0.82), M.RX(0.45)), 0.3, 1);   // burst petals, leaning out
    }
  },
  // The escort truck: tyres, a flatbed, a cab at the nose and a cargo box.
  truck: b => {
    for (const [z, d] of [[-0.65, 0.95], [0.85, 0.36]]) for (const x of [-0.55, 0.55]) box(b, x, 0, z, 0.24, 0.36, d, C.tyre);   // the rear pair is a double axle
    box(b, 0, 0.18, -0.05, 1.0, 0.12, 2.5, C.dark);
    box(b, 0, 0.3, 0.88, 0.96, 0.5, 0.58, C.olive, M.id(), 1, 0.8);
    box(b, 0, 0.6, 1.05, 0.86, 0.14, 0.12, C.glass);
    box(b, 0, 0.3, -0.42, 1.0, 0.7, 1.5, C.olive);
    box(b, 0, 1.0, -0.42, 0.9, 0.02, 1.4, C.hazard);
  },
  truckWreck: b => {
    for (const z of [-0.95, 0.85]) for (const x of [-0.55, 0.55]) box(b, x, 0, z, 0.24, 0.28, 0.36, C.tyre);
    box(b, 0, 0.12, -0.05, 1.0, 0.12, 2.5, C.char);
    box(b, 0, 0.24, 0.88, 0.96, 0.36, 0.58, C.ash, M.id(), 0.9, 0.7);
    box(b, 0, 0.2, -0.42, 1.0, 0.4, 1.5, C.char, M.RZ(0.15), 0.8, 0.9);
  },
  // Mission 9's launcher: an octagonal bunker. Its head is a separate mesh
  // (launcherHead) so a turret can turn it.
  launcher: b => {
    b.cyl(chain(M.T(0, 0.27, 0), M.S(2, 0.54, 2)), C.steel, 8, 0.8);
    b.cyl(chain(M.T(0, 0.46, 0), M.S(1.72, 0.06, 1.72)), C.hazard, 8);
    box(b, 0, 0.54, 0, 0.5, 0.06, 0.5, C.steel);
  },
  launcherHead: b => {
    box(b, 0, 0.58, 0, 0.9, 0.36, 1.0, C.olive);
    for (const x of [-0.22, 0.22]) for (const y of [0.66, 0.82]) box(b, x, y, 0.5, 0.16, 0.1, 0.04, C.tyre);
    box(b, 0, 0.94, -0.2, 0.3, 0.06, 0.3, C.red);
  },
  launcherWreck: b => {
    b.cyl(chain(M.T(0, 0.22, 0), M.S(2, 0.44, 2)), C.char, 8, 0.8);
    box(b, 0.15, 0.3, 0.2, 0.9, 0.3, 1.0, C.ash, chain(M.RZ(0.5), M.RY(0.4)));
  },
  // The extraction pad: a flat octagon with a painted ring and corner lights.
  pad: b => {
    b.cyl(chain(M.T(0, 0.015, 0), M.S(2, 0.03, 2)), C.pad, 8);
    const ring = (r, i) => { const a = (i / 8) * Math.PI * 2; return [Math.sin(a) * r, 0.032, Math.cos(a) * r]; };
    for (let i = 0; i < 8; i++) b.quad(ring(0.62, i), ring(0.62, i + 1), ring(0.75, i + 1), ring(0.75, i), C.hazard, 'up');
    for (const a of [0, 1, 2, 3]) box(b, 0, 0.03, 0.88, 0.06, 0.03, 0.06, C.red, M.RY(a * Math.PI / 2 + Math.PI / 4));
  },
};
export const PROP_KEYS = Object.keys(BUILD);
// Props that scale up with the radius rather than the height.
const FLAT = new Set(['pad']);

export function buildProps() {
  return Object.fromEntries(PROP_KEYS.map(k => [k, part(BUILD[k])]));
}

// What to draw for an entity: `null` falls back to the boxes in scene.js.
// key: the base mesh; head: an extra mesh that turns with `e.headYaw`;
// sy: the vertical scale; tint: dark once it's been punched over.
export function propFor(e) {
  if (!e.mesh || !BUILD[e.mesh]) return null;
  const wreck = !e.alive && !e.fall && BUILD[`${e.mesh}Wreck`] ? `${e.mesh}Wreck` : null;
  const key = wreck || e.mesh, head = !wreck && BUILD[`${e.mesh}Head`] ? `${e.mesh}Head` : null;
  return { key, head, sy: FLAT.has(e.mesh) ? e.radius : e.height, tint: !e.alive && !wreck ? 0.45 : 1 };
}
