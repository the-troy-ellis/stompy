#ifndef TEST_H
#define TEST_H
#include "sim/game.h"
#include <stdio.h>
#include <string.h>
extern int tFails, tChecks;
#define CHECK(c) do { tChecks++; if (!(c)) { tFails++; printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define CHECKF(c, ...) do { tChecks++; if (!(c)) { tFails++; printf("  FAIL %s:%d: %s: ", __FILE__, __LINE__, #c); printf(__VA_ARGS__); printf("\n"); } } while (0)
// A recording effects sink: what the sim asked for.
typedef struct { int sfx[SFX_N]; char said[16][80]; int nSaid; float bass; int thumps; float haptic; } Rec;
extern Rec REC;
Fx recFx(void);
// A flat-ground game with the player in `chassis`, no foes, on NORMAL.
void flatGame(Game *G, int chassis, unsigned seed);
void steps(Game *G, const Input *in, int n);
int saidLike(const char *sub);
static inline void ready(Mech *m) { for (int i = 0; i < m->nW; i++) m->w[i].cd = 0; }   // the stock stagger, skipped
#endif
