#include "util/rng.h"
void rngSeed(Rng *r, uint32_t seed) { r->s = seed ? seed : 0x9e3779b9u; }
float rngNext(Rng *r) {
  r->s += 0x6d2b79f5u;
  uint32_t t = r->s;
  t = (t ^ (t >> 15)) * (t | 1u);
  t ^= t + (t ^ (t >> 7)) * (t | 61u);
  return (float)((t ^ (t >> 14)) / 4294967296.0);
}
float rngRange(Rng *r, float a, float b) { return a + rngNext(r) * (b - a); }
int rngInt(Rng *r, int n) { return (int)(rngNext(r) * n); }
int rngChance(Rng *r, float p) { return rngNext(r) < p; }
float rngSign(Rng *r) { return rngNext(r) < 0.5f ? 1.f : -1.f; }
