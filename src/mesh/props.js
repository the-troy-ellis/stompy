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
  concrete: [0.56, 0.55, 0.51], bark: [0.36, 0.31, 0.27], rock: [0.25, 0.21, 0.2], lava: [1, 0.42, 0.08],
  ice: [0.74, 0.86, 0.94], iceDeep: [0.48, 0.66, 0.8],
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
  // Scenery (spec 07 § Props): placed by biome in #162, hp Infinity unless a
  // mission says otherwise.
  // A bunker: a low tapered block with a gun slit, a roof plate and a door.
  bunker: b => {
    box(b, 0, 0, 0, 1.9, 0.74, 1.9, C.concrete, M.id(), 0.78, 0.78);
    box(b, 0, 0.74, 0, 1.3, 0.12, 1.3, C.dark, M.id(), 0.9, 0.9);
    box(b, 0, 0.42, 0.86, 1.1, 0.12, 0.12, C.glass);
    box(b, 0, 0, -0.9, 0.42, 0.5, 0.16, C.dark);
    box(b, 0.42, 0.86, 0.2, 0.06, 0.14, 0.06, C.red);
  },
  // A pipe run: two pipes along z on three tapered stands, with flanges on
  // the big one.
  pipe: b => {
    for (const z of [-1.05, 0, 1.05]) box(b, 0, 0, z, 0.9, 0.64, 0.14, C.rust, M.id(), 0.85, 1);
    for (const [x, r] of [[-0.2, 0.32], [0.24, 0.2]]) b.cyl(chain(M.T(x, 0.64 + r / 2, 0), M.RX(Math.PI / 2), M.S(r, 2.6, r)), C.steel, 6);
    for (const z of [-0.55, 0.55]) box(b, -0.2, 0.62, z, 0.4, 0.4, 0.06, C.hazard);
  },
  // A wall segment: a long slab along z, thicker at the foot, with a cap and
  // buttresses on the near side.
  wall: b => {
    box(b, 0, 0, 0, 0.36, 0.88, 2.6, C.concrete, M.id(), 0.6, 1);
    box(b, 0, 0.88, 0, 0.26, 0.1, 2.64, C.dark);
    for (const z of [-0.9, 0, 0.9]) box(b, 0.24, 0, z, 0.3, 0.6, 0.2, C.concrete, M.id(), 0.2, 1);
    box(b, -0.19, 0.3, 0.45, 0.02, 0.12, 0.9, C.hazard);
  },
  // An antenna mast: a tapering lattice on a footing, a dish half way up
  // looking along +z, and a red lamp on top. Built for a mast about seven
  // times as tall as its radius: the dish is squashed in y so it reads round
  // once scaled.
  mast: b => {
    box(b, 0, 0, 0, 0.7, 0.08, 0.7, C.dark, M.id(), 0.6, 0.6);
    box(b, 0, 0.08, 0, 0.34, 0.86, 0.34, C.steel, M.id(), 0.3, 0.3);
    for (const y of [0.3, 0.68]) box(b, 0, y, 0, 0.42 - y * 0.3, 0.012, 0.42 - y * 0.3, C.rust);
    b.cyl(chain(M.T(0, 0.55, 0.36), M.S(1, 0.14, 1), M.RX(1.2), M.S(0.9, 0.07, 0.9)), C.tank, 8);
    box(b, 0, 0.545, 0.1, 0.06, 0.01, 0.26, C.dark);
    box(b, 0, 0.94, 0, 0.16, 0.025, 0.16, C.red);
  },
  // A crate stack: five crates, slightly askew, two on top.
  crates: b => {
    const crate = (x, y, z, s, yaw, col) => box(b, x, y, z, s, s * 0.5, s, col, chain(M.T(x, 0, z), M.RY(yaw), M.T(-x, 0, -z)));
    crate(-0.5, 0, -0.45, 0.9, 0.1, C.olive);
    crate(0.5, 0, -0.4, 0.9, -0.08, C.rust);
    crate(0.1, 0, 0.55, 0.9, 0.3, C.olive);
    crate(-0.35, 0.45, -0.3, 0.8, 0.5, C.hazard);
    crate(0.4, 0.45, -0.25, 0.8, -0.2, C.olive);
  },
  // A dead tree (ice): a bent five-sided trunk and bare branches.
  deadTree: b => {
    b.cyl(chain(M.T(0, 0.3, 0), M.S(0.32, 0.6, 0.32)), C.bark, 5, 0.6);
    b.cyl(chain(M.T(0.03, 0.75, 0), M.RZ(-0.15), M.S(0.19, 0.34, 0.19)), C.bark, 5, 0.3);
    for (const [y, yaw, tilt, len] of [[0.45, 0.4, 0.9, 0.5], [0.58, 2.6, 1.0, 0.44], [0.7, 4.3, 0.8, 0.36], [0.82, 1.6, 0.6, 0.26]])
      box(b, 0, 0, 0, 0.09, len, 0.09, C.bark, chain(M.T(0, y, 0), M.RY(yaw), M.RX(tilt)), 0.4, 0.4);
    box(b, 0, 0, 0, 0.5, 0.04, 0.5, C.ice, M.RY(0.4), 0.6, 0.6);   // drifted snow at the foot
  },
  // A lava vent (volcanic): a broken rock cone round a glowing crater. The
  // lava dome and the cracks down the side are ventGlow, drawn glowing.
  vent: b => {
    b.cyl(chain(M.T(0, 0.35, 0), M.S(2, 0.7, 2)), C.rock, 8, 0.42);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.37 + 0.3;
      box(b, Math.sin(a) * 0.85, 0, Math.cos(a) * 0.85, 0.36, 0.24 + (i % 2) * 0.12, 0.3, C.char, M.RY(a), 0.6, 0.6);
    }
    for (const [x, z, h] of [[0.32, 0.1, 0.9], [-0.25, -0.2, 0.84]]) box(b, x, 0.7, z, 0.18, h - 0.7, 0.16, C.rock, M.RY(x * 3), 0.5, 0.5);
  },
  ventGlow: b => {
    b.cyl(chain(M.T(0, 0.73, 0), M.S(0.8, 0.08, 0.8)), C.lava, 8, 0.6);   // a dome of lava just over the rim, so it shows from the side
    // Three cracks, each down the middle of a face of the cone.
    for (const a of [0.39, 2.75, 4.32]) b.quad(...[[-0.05, 0.68], [0.05, 0.68], [0.1, 0.04], [-0.1, 0.04]].map(([x, y]) => {
      const r = (0.42 + (0.69 - y) * 0.83) * 0.924, s = Math.sin(a), c = Math.cos(a);   // on the face, not the corner
      return [s * (r + 0.01) + c * x, y, c * (r + 0.01) - s * x];
    }), C.lava, [0, 0.4, 0]);
  },
  // An ice spire: a tall six-sided shard with two smaller ones leaning off it.
  spire: b => {
    b.cyl(chain(M.T(0, 0.5, 0), M.S(0.7, 1, 0.7)), C.ice, 6, 0);
    b.cyl(chain(M.T(0.35, 0.3, 0.2), M.RZ(-0.35), M.S(0.42, 0.55, 0.42)), C.iceDeep, 6, 0);
    b.cyl(chain(M.T(-0.3, 0.22, -0.25), M.RX(-0.3), M.RZ(0.3), M.S(0.36, 0.4, 0.36)), C.ice, 5, 0);
    box(b, 0, 0, 0, 1.3, 0.05, 1.1, C.iceDeep, M.RY(0.5), 0.8, 0.8);
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
// glow: an extra mesh drawn glowing (lava); sy: the vertical scale; tint:
// dark once it's been punched over.
export function propFor(e) {
  if (!e.mesh || !BUILD[e.mesh]) return null;
  const wreck = !e.alive && !e.fall && BUILD[`${e.mesh}Wreck`] ? `${e.mesh}Wreck` : null;
  const key = wreck || e.mesh, head = !wreck && BUILD[`${e.mesh}Head`] ? `${e.mesh}Head` : null;
  const glow = !wreck && BUILD[`${e.mesh}Glow`] ? `${e.mesh}Glow` : null;
  return { key, head, glow, sy: FLAT.has(e.mesh) ? e.radius : e.height, tint: !e.alive && !wreck ? 0.45 : 1 };
}
