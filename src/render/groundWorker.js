import { meshChunk, boundsOf } from '../world/mesher.js';

// The ground's mesher off the main thread (docs/specs/18-voxel-ground.md
// § Rendering): render/ground.js sends a chunk's corners, this sends back its
// triangles and box. `pal` comes once per world.
let pal = null;
self.onmessage = ({ data: d }) => {
  if (d.pal) { pal = d.pal; return; }
  const f = meshChunk(d.D, d.T, d.dims, d.o, d.s, pal, d.skip);
  if (d.patch != null) self.postMessage({ world: d.world, patch: d.patch, f, box: boundsOf(f), D: d.D, T: d.T }, [f.buffer, d.D.buffer, d.T.buffer]);   // a fine patch's (render/ground.js tickPatches): its arrays go back to be filled again
  else self.postMessage({ id: d.id, ver: d.ver, world: d.world, f, box: boundsOf(f) }, [f.buffer]);
};
