// Map sizes and shapes (docs/specs/35-bigger-maps.md part 5). A mission's
// `size` is [width, length] in metres (x across, z along), or one of the
// square presets; none is S, today's map. A combat mission needn't be square:
// `ground.shape.canyon` (world/terrain.js) makes a long canyon to fight
// your way along.
export const SIZES = { S: [2304, 2304], M: [3504, 3504], L: [4608, 4608] };
export const sizeOf = def => (typeof def?.size === 'string' ? SIZES[def.size] : def?.size) || SIZES.S;

// The test canyon: 3 km long and about 1 km across, a floor about 200 m wide
// winding along it between walls 80 m high. Free Play's CANYON map, and the
// perf harness's big-map scene.
export const CANYON = { size: [960, 3024], shape: { canyon: { width: 200, walls: 80, wind: 120 } } };

// Free Play in the canyon: you start near the south end, facing up it, and
// the foes wait in groups up the floor (bearing 0 is along +z: sim/placement.js).
export const CANYON_START = [180, 1150, 0];   // facing bearing 0: north, up the canyon
export function canyonFoes(types) {
  return types.map((type, i) => {
    const d = -900 + ((i + 1) / (types.length + 1)) * 2000;   // spread from about 900 m south of the centre to 1,100 m north
    return { type, at: [d < 0 ? 180 : 0, Math.abs(d)], face: 180 };   // all facing south, where you come from
  });
}
