// Mission placement (docs/specs/03-objectives.md § Placement): positions are
// polar [bearing°, distance] from the start, so a mission file reads like a
// sketch. Bearing 0 is straight ahead (north on the compass), 90 to the right
// (east).
export const polar = ([bearing, dist]) => { const b = bearing * Math.PI / 180; return { x: -Math.sin(b) * dist, z: Math.cos(b) * dist }; };
// A mission's extra flat pads, for makeTerrain's `zones`.
export const flatZones = def => (def.flat || []).map(([b, d, r]) => { const p = polar([b, d]); return [p.x, p.z, r]; });
