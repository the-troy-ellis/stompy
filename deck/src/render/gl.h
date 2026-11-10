// OpenGL 3.3 core, loaded through SDL at start (no loader library). One
// shader: flat-shaded polygons with a colour per vertex, one light, the
// palette's sky and fog, and an ordered dither for the few things that fade.
#ifndef GLR_H
#define GLR_H
#include "util/mathx.h"
#include <stddef.h>
typedef struct { unsigned vao, vbo; int n; } Mesh;           // triangles: pos, normal, colour per vertex (9 floats)
typedef struct { unsigned vbo; int cap; } InstBuf;           // per-instance: a mat4 and a colour + emissive (20 floats)
typedef struct { float *d; int n, cap; } FloatBuf;           // a growable vertex list
int glrInit(void);
void glrBegin(int w, int h, const float *clear3);
void glrSetCamera(const m4 *viewProj, v3 eye);
void glrSetLight(const float light[3], const float shade[3], const float fogCol[3], float fogNear, float fogFar);
void glrMode(int mode);                                      // 0 lit, 1 emissive, 2 sky, 3 hud (no light, no fog, no depth)
void glrDither(float coverage);                              // 1: solid; less: an ordered 4x4 dither of drawn and skipped pixels
void glrDepth(int test, int write);
Mesh glrUpload(const float *verts, int n);                   // n vertices
void glrUpdate(Mesh *m, const float *verts, int n);          // re-upload a dynamic mesh
void glrFree(Mesh *m);
void glrDraw(const Mesh *m, const m4 *model);
void glrDrawCol(const Mesh *m, const m4 *model, const float col[3], float emissive);
InstBuf glrInstBuf(int cap);
void glrDrawInst(const Mesh *m, InstBuf *b, const float *inst, int count);   // inst: count x 20 floats
void fbPush(FloatBuf *b, const float *v, int n);
void fbClear(FloatBuf *b);
int glrDrawCalls(void);
void glrReadPixels(int w, int h, unsigned char *rgb);
#endif
