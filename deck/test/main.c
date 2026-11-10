#include "test/test.h"
int tFails, tChecks; Rec REC;
static void rSay(void *u, const char *l, int f, float d) { (void)u; (void)f; (void)d; if (REC.nSaid < 16 && (REC.nSaid == 0 || strcmp(REC.said[REC.nSaid - 1], l))) snprintf(REC.said[REC.nSaid++], 80, "%s", l); }
static void rSfx(void *u, int k, const v3 *at, float a, float b) { (void)u; (void)at; (void)a; (void)b; REC.sfx[k]++; }
static void rThump(void *u, float b, float d, float h, const v3 *at) { (void)u; (void)d; (void)at; REC.bass += b; REC.thumps++; REC.haptic += h; }
static void rFusion(void *u, int on, float p) { (void)u; (void)on; (void)p; }
Fx recFx(void) { Fx f = { NULL, rSay, rSfx, rThump, rFusion }; memset(&REC, 0, sizeof REC); return f; }
void flatGame(Game *G, int chassis, unsigned seed) { gameInit(G, recFx(), seed); startFreePlay(G, PAL_DUSK, TIME_DUSK, WX_CLEAR, 0, seed, chassis, DIFF_NORMAL, 1); }
void steps(Game *G, const Input *in, int n) { for (int i = 0; i < n; i++) update(G, in, 1.f / 60); }
int saidLike(const char *sub) { for (int i = 0; i < REC.nSaid; i++) if (strstr(REC.said[i], sub)) return 1; return 0; }

void testData(void); void testGait(void); void testHeat(void); void testCombat(void); void testMelee(void); void testFusion(void); void testAi(void); void testTone(void); void testJets(void); void testMissiles(void); void testFeel(void);
int main(void) {
  struct { const char *n; void (*f)(void); } T[] = { { "data", testData }, { "gait", testGait }, { "heat", testHeat }, { "combat", testCombat }, { "melee", testMelee }, { "fusion", testFusion },
    { "jets", testJets }, { "missiles", testMissiles }, { "feel", testFeel }, { "ai", testAi }, { "tone", testTone } };
  for (unsigned i = 0; i < sizeof T / sizeof T[0]; i++) { int before = tFails; T[i].f(); printf("%-10s %s\n", T[i].n, tFails == before ? "ok" : "FAILED"); }
  printf("%d checks, %d failures\n", tChecks, tFails);
  return tFails ? 1 : 0;
}
