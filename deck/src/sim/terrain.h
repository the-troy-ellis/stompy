// The ground: a grid of 24 m cells with value-noise heights and a flat
// landing zone around the start. height(x, z) samples the same triangle split
// as the mesh, so mechs stand exactly on what is drawn (an invariant).
#ifndef TERRAIN_H
#define TERRAIN_H
#include "util/mathx.h"
#define TER_CELL 24.f
#define TER_EDGE 90.f
#define TER_NX 96
#define TER_NZ 96
typedef struct {
  int nx, nz; float hx, hz, bx, bz;   // half sizes, and how far out anyone can walk
  float hs[(TER_NX + 1) * (TER_NZ + 1)];
  int seed, flat;
} Terrain;
void terMake(Terrain *t, int seed, int flat);
float terHeight(const Terrain *t, float x, float z);
static inline int terSolid(const Terrain *t, float x, float y, float z) { return y < terHeight(t, x, z); }
// Where a ray first meets the ground: the distance along it, or -1.
float terRay(const Terrain *t, v3 o, v3 d, float maxT);
#endif
