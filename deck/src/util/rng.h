// The simulation's randomness: mulberry32, seeded from the match seed so a
// mission replays identically and the tests are reproducible.
#ifndef RNG_H
#define RNG_H
#include <stdint.h>
typedef struct { uint32_t s; } Rng;
void rngSeed(Rng *r, uint32_t seed);
float rngNext(Rng *r);                       // [0, 1)
float rngRange(Rng *r, float a, float b);
int rngInt(Rng *r, int n);
int rngChance(Rng *r, float p);
float rngSign(Rng *r);
#endif
