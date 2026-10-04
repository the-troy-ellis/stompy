// Body plans, by leg type (a chassis may override any of it: geoFor). Lengths are model units (x chassis scale), and
// buildMechParts builds each type's leg meshes to match l1 / l2. Per leg:
// hip (hx, hz), rest foot (fx, fz) and its phase in the gait cycle; `swing`
// is the share of the cycle a foot spends in the air. +x is the mech's
// left, +z its front. `knee` is which way the joint bends.
export const GEO = {
  forward: { hip: 4.6, l1: 2.6, l2: 2.5, ankle: 0.42, knee: 'forward', swing: 0.42, stride: [3.5, 4.5],
    radius: 2.4, height: 7.9, legTop: 4.4, torsoY: 5, eye: [0, 2.35, 1.9], armX: 2.25, armY: 2.0, rackY: 3.2, acY: 1.6,
    legs: [{ hx: 0.95, hz: 0, fx: 1.1, fz: 0, ph: 0 }, { hx: -0.95, hz: 0, fx: -1.1, fz: 0, ph: 0.5 }] },
  // Bird-like: the joint points backward, feet are three-toed claws.
  reverse: { hip: 4.9, l1: 2.7, l2: 2.9, ankle: 0.5, knee: 'back', swing: 0.42, stride: [3.5, 4.5],
    radius: 2.4, height: 8.6, legTop: 4.7, torsoY: 5.3, eye: [0, 2.6, 1.5], armX: 2.3, armY: 2.0, rackY: 3.3, acY: 1.6,
    legs: [{ hx: 1.0, hz: 0.1, fx: 1.15, fz: 0.45, ph: 0 }, { hx: -1.0, hz: 0.1, fx: -1.15, fz: 0.45, ph: 0.5 }] },
  // Four legs bowed out like a spider's, trotting: diagonal pairs together.
  quad: { hip: 3.4, l1: 2.4, l2: 2.9, ankle: 0.35, knee: 'out', swing: 0.42, stride: [3.0, 3.6],
    radius: 3.1, height: 6.6, legTop: 3.3, torsoY: 4.0, eye: [0, 1.6, 1.4], armX: 1.9, armY: 1.2, rackY: 2.1, acY: 0.9,
    legs: [{ hx: 1.4, hz: 1.6, fx: 2.9, fz: 2.3, ph: 0 }, { hx: -1.4, hz: -1.6, fx: -2.9, fz: -2.2, ph: 0 },
           { hx: -1.4, hz: 1.6, fx: -2.9, fz: 2.3, ph: 0.5 }, { hx: 1.4, hz: -1.6, fx: 2.9, fz: -2.2, ph: 0.5 }] },
};
// A chassis's body plan: its leg type's, with the chassis's own `geo`
// partial (any of the fields above) merged over it. Raising or lowering the
// hip moves everything stacked on it (legTop, torsoY, height) with it unless
// the partial sets those too. Built once per chassis object.
const plans = new WeakMap();
export function geoFor(ch) {
  let g = plans.get(ch);
  if (g) return g;
  const base = GEO[ch.legs] || GEO.forward, o = ch.geo || {}, dh = (o.hip ?? base.hip) - base.hip;
  g = { ...base, legTop: base.legTop + dh, torsoY: base.torsoY + dh, height: base.height + dh, ...o };
  plans.set(ch, g);
  return g;
}
export const geoOf = m => geoFor(m.ch);
