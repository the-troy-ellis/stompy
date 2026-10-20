import { meshChunk, boundsOf } from '../world/mesher.js';

// The ground's mesher off the main thread (docs/specs/18-voxel-ground.md
// § Rendering): render/ground.js sends a chunk's corners, this sends back its
// triangles and box. `pal` comes once per world.
let pal = null;
self.onmessage = ({ data: d }) => {
  if (d.pal) { pal = d.pal; return; }
  const f = meshChunk(d.D, d.T, d.dims, d.o, d.s, pal);
  self.postMessage({ id: d.id, ver: d.ver, world: d.world, f, box: boundsOf(f) }, [f.buffer]);
};
