// Mission placement (docs/specs/03-objectives.md § Placement): positions are
// polar [bearing°, distance] from the start, so a mission file reads like a
// sketch. Bearing 0 is straight ahead (north on the compass), 90 to the right
// (east).
export const polar = ([bearing, dist]) => { const b = bearing * Math.PI / 180; return { x: -Math.sin(b) * dist, z: Math.cos(b) * dist }; };
// A mission's extra flat pads, for makeTerrain's `zones`: its `flat` list, and
// any entity with `pad: radius` (an extraction point, a structure's footing).
export const flatZones = def => [
  ...(def.start ? [(p => [p.x, p.z, 90])(polar(def.start))] : []),   // a moved start gets the start's flat ground
  ...(def.flat || []).map(([b, d, r]) => { const p = polar([b, d]); return [p.x, p.z, r]; }),
  ...(def.entities || []).filter(e => e.pad).map(e => { const p = polar(e.at); return [p.x, p.z, e.pad]; }),
];
// World to polar, the other way: [bearing° in [0, 360), dist] from the centre.
export const toPolar = (x, z) => [((Math.atan2(-x, z) * 180 / Math.PI) % 360 + 360) % 360, Math.hypot(x, z)];
// A position the mission editor moved or placed, rounded so the exported file
// stays readable: 1° and 5 m (docs/specs/15-mission-editor.md § Coordinates).
export const roundPolar = ([b, d]) => [((Math.round(b) % 360) + 360) % 360, Math.round(d / 5) * 5];
