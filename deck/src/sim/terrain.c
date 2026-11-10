#include "sim/terrain.h"
#include <math.h>

static float hashf(int i, int j, int seed) { float s = sinf(i * 127.1f + j * 311.7f + seed * 74.7f) * 43758.5453f; return s - floorf(s); }
static float vn(float x, float z, int seed) {
  float fi = floorf(x), fj = floorf(z); int i = (int)fi, j = (int)fj; float fx = x - fi, fz = z - fj;
  float u = fx * fx * (3 - 2 * fx), w = fz * fz * (3 - 2 * fz);
  return lerpf(lerpf(hashf(i, j, seed), hashf(i + 1, j, seed), u), lerpf(hashf(i, j + 1, seed), hashf(i + 1, j + 1, seed), u), w);
}
void terMake(Terrain *t, int seed, int flat) {
  t->nx = TER_NX; t->nz = TER_NZ; t->hx = TER_NX * TER_CELL / 2; t->hz = TER_NZ * TER_CELL / 2; t->bx = t->hx - TER_EDGE; t->bz = t->hz - TER_EDGE;
  t->seed = seed; t->flat = flat;
  int W = t->nx + 1;
  for (int j = 0; j <= t->nz; j++) for (int i = 0; i <= t->nx; i++) {
    float x = -t->hx + i * TER_CELL, z = -t->hz + j * TER_CELL, h = 0;
    if (!flat) {
      float f = vn(x / 380 + 40, z / 380 + 40, seed) * 0.6f + vn(x / 140, z / 140, seed) * 0.3f + vn(x / 55, z / 55, seed) * 0.1f;
      h = maxf(0, f - 0.36f) * 230;
      h *= clampf((hypot2(x, z) - 70) / 200, 0, 1);   // the flat landing zone around the start
    }
    t->hs[j * W + i] = h;
  }
}
float terHeight(const Terrain *t, float x, float z) {
  int W = t->nx + 1;
  float gx = clampf((x + t->hx) / TER_CELL, 0, t->nx - 1e-4f), gz = clampf((z + t->hz) / TER_CELL, 0, t->nz - 1e-4f);
  int i = (int)gx, j = (int)gz; float fx = gx - i, fz = gz - j;
  float h00 = t->hs[j * W + i], h10 = t->hs[j * W + i + 1], h01 = t->hs[(j + 1) * W + i], h11 = t->hs[(j + 1) * W + i + 1];
  return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}
// March in steps of a cell's quarter, then bisect the first crossing.
float terRay(const Terrain *t, v3 o, v3 d, float maxT) {
  if (!(maxT > 0)) return -1;
  float step = 6, prev = 0;
  if (o.y < terHeight(t, o.x, o.z)) return 0;
  for (float s = step; ; s += step) {
    float tt = s < maxT ? s : maxT;
    v3 p = vadd(o, vmul(d, tt));
    if (p.y < terHeight(t, p.x, p.z)) {
      float lo = prev, hi = tt;
      for (int k = 0; k < 8; k++) { float mid = (lo + hi) / 2; v3 q = vadd(o, vmul(d, mid)); if (q.y < terHeight(t, q.x, q.z)) hi = mid; else lo = mid; }
      return hi;
    }
    if (tt >= maxT) return -1;
    prev = tt;
    if (p.y > 400 && d.y > 0) return -1;   // above every hill and climbing
  }
}
