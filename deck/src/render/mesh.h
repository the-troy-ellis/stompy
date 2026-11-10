// Flat-shaded triangle soup, hand-built: each chassis's parts (ported from
// the reference's mesh/mechParts.js), the effect shapes, the terrain chunks,
// the sky dome. Position, normal and colour per vertex.
#ifndef MESHB_H
#define MESHB_H
#include "render/gl.h"
#include "data/data.h"
#include "sim/terrain.h"
typedef struct { FloatBuf b; } Builder;
void bTri(Builder *B, v3 a, v3 b, v3 c, const float col[3], const v3 *ref, int up);
void bQuad(Builder *B, v3 a, v3 b, v3 c, v3 d, const float col[3], const v3 *ref);
void bCube(Builder *B, const m4 *m, const float col[3], float tx, float tz);   // a unit cube through m; the top face can taper
void bCyl(Builder *B, const m4 *m, const float col[3], int n, float top);
void bSphere(Builder *B, const m4 *m, const float col[3], int n, int r);
Mesh bUpload(Builder *B);   // uploads and clears

typedef struct { Mesh hip, uleg, lleg, foot, plate, torso, arm, barrel, fist; int hasFist, hasBarrel; v3 barrelAt; } MechParts;
MechParts buildMechParts(int chassis);
enum { FX_CUBE, FX_TETRA, FX_SPARK, FX_RING, FX_STAR, FX_CHUNK, FX_FLAT, FX_SHELL, FX_MISSILE, FX_BOLT, FX_BEAM, FX_DISC, FX_N };
Mesh buildEffectShape(int kind);
#define TER_CHUNKS 4
Mesh buildTerrainChunk(const Terrain *t, int cx, int cz, const PalDef *pal);   // one of TER_CHUNKS x TER_CHUNKS
Mesh buildSky(void);
Mesh buildWreck(int chassis);   // a flattened, scorched torso and hip, lying there
#endif
