#include "util/spring.h"
#include <math.h>
void springInit(Spring *s, float k, float zeta) { s->x = 0; s->v = 0; springTune(s, k, zeta); }
void springTune(Spring *s, float k, float zeta) { s->k = k; s->c = 2 * sqrtf(k) * zeta; }
// Semi-implicit Euler with substeps so a 50 ms frame stays stable.
float springStep(Spring *s, float dt, float target) {
  int n = (int)ceilf(dt / (1.f / 120)); if (n < 1) n = 1;
  float h = dt / n;
  for (int i = 0; i < n; i++) { s->v += (-s->k * (s->x - target) - s->c * s->v) * h; s->x += s->v * h; }
  if (fabsf(s->x - target) < 1e-5f && fabsf(s->v) < 1e-5f) { s->x = target; s->v = 0; }
  return s->x;
}
