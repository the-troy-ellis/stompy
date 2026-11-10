#include "sim/game.h"
#include <string.h>
static void nullSay(void *u, const char *l, int f, float d) { (void)u; (void)l; (void)f; (void)d; }
static void nullSfx(void *u, int k, const v3 *at, float a, float b) { (void)u; (void)k; (void)at; (void)a; (void)b; }
static void nullThump(void *u, float b, float d, float h, const v3 *at) { (void)u; (void)b; (void)d; (void)h; (void)at; }
static void nullFusion(void *u, int on, float p) { (void)u; (void)on; (void)p; }
const Fx NULL_FX = { NULL, nullSay, nullSfx, nullThump, nullFusion };

void gameInit(Game *G, Fx fx, unsigned seed) {
  memset(G, 0, sizeof *G);
  G->fx = fx; rngSeed(&G->rng, seed); G->state = ST_BRIEF; G->diff = DIFF_NORMAL; G->view = V3(0, 0, 1); G->fogScale = 1;
  dataInit();
}
// The stock loadout: every hardpoint's stock weapon, then the fusion cannon; the systems' stock levels.
void applyStockLoadout(Game *G, Mech *m) {
  const Chassis *ch = m->ch; m->nW = 0; int sides[CAT_N] = { 0 };
  for (int i = 0; i < ch->nHard && m->nW < MAX_WEAPONS; i++) {
    const Hardpoint *h = &ch->hard[i]; Weapon *w = &m->w[m->nW++]; memset(w, 0, sizeof *w);
    w->type = h->stock; w->def = &WEAPONS[h->stock]; w->mount = h->loc; w->ammo = w->def->ammo; w->side = sides[w->def->cat]++;
    w->cd = rngRange(&G->rng, 0, w->def->cd * 0.5f);   // staggered, so a volley of guns doesn't fire as one
  }
  Weapon *f = &m->w[m->nW++]; memset(f, 0, sizeof *f); f->type = W_FUSION; f->def = &WEAPONS[W_FUSION]; f->mount = SEC_T;
  float armour = 1 + ARMOUR_HP * ch->armour;
  for (int s = 0; s < SEC_N; s++) m->max[s] = m->hp[s] = ch->hp[s] * armour;
  m->sinkRate = ch->sink + SINK_PER_LEVEL * ch->sinks;
  m->maxSpeed = ch->speed * (1 - ARMOUR_SPEED * ch->armour);
  m->jets = ch->jets;
}
Mech *newMech(Game *G, int type, int team, float x, float z, float yaw) {
  if (G->nMechs >= MAX_MECHS) return NULL;
  Mech *m = &G->mechs[G->nMechs]; memset(m, 0, sizeof *m);
  m->idx = G->nMechs++; m->type = type; m->ch = &CHASSIS[type]; m->geo = geoFor(type); m->team = team; m->alive = 1;
  m->x = x; m->z = z; m->y = terHeight(&G->ter, x, z); m->yaw = yaw; m->fuel = 1; m->stepAt = -9; m->lastYaw = yaw; m->meltAt = -1; m->lastArm = SEC_RA;
  applyStockLoadout(G, m);
  aiInit(G, m);
  initFeet(G, m);
  initFeel(m);
  return m;
}
void palAt(PalVariant *out, int biome, int t) { const PalDef *b = &PALS[biome]; *out = t == TIME_NIGHT ? b->night : t == TIME_DAWN ? b->dawn : b->day; }
void blendPal(const PalVariant *a, const PalVariant *b, float t, PalVariant *out) {
  for (int i = 0; i < 3; i++) { out->zen[i] = lerpf(a->zen[i], b->zen[i], t); out->hor[i] = lerpf(a->hor[i], b->hor[i], t); out->shade[i] = lerpf(a->shade[i], b->shade[i], t); out->light[i] = lerpf(a->light[i], b->light[i], t); }
  out->fog[0] = lerpf(a->fog[0], b->fog[0], t); out->fog[1] = lerpf(a->fog[1], b->fog[1], t);
  float n = sqrtf(out->light[0] * out->light[0] + out->light[1] * out->light[1] + out->light[2] * out->light[2]); if (n < 1e-6f) n = 1;
  for (int i = 0; i < 3; i++) out->light[i] /= n;
}
float darkness(const PalVariant *p) { return clampf((0.8f - (p->shade[0] + p->shade[1] + p->shade[2]) / 3) / 0.35f, 0, 1); }
void fogOf(const Game *G, float out[2]) { float f = WEATHER[G->weather].fog; out[0] = G->pal.fog[0] * f; out[1] = G->pal.fog[1] * f; }

static void resetMatch(Game *G, unsigned seed, int biome, int timeOfDay, int weather, int flat) {
  rngSeed(&G->rng, seed);
  G->biome = biome; G->timeOfDay = timeOfDay; G->weather = weather; palAt(&G->pal, biome, timeOfDay); G->hasRamp = 0;
  terMake(&G->ter, seed, flat);
  G->nMechs = 0; G->nShots = 0; G->parts.n = 0; G->nDebris = 0; G->nWrecks = 0; G->nMsgs = 0; G->nPulses = 0; G->nCBeams = 0; G->nScorch = 0; G->scorchAt = 0;
  G->target = NULL; G->aimMech = NULL; G->flash = G->shake = G->kick = G->whiteFlash = 0; G->bobInit = 0; G->zoom = 0; G->endT = 0; G->time = 0; G->frame = 0; G->hasBeamOnAt = 0;
  G->guide.on = 0; G->mDown = 0; G->won = 0; G->hitMark = 0; G->hitStop = 0; memset(&G->voice, 0, sizeof G->voice); G->voice.lastDry = -1e9f;
  memset(&G->stats, 0, sizeof G->stats); G->farthestShove = 0; G->hasLastKill = 0; memset(&G->death, 0, sizeof G->death);
}
static void polar(float bearingDeg, float dist, float *x, float *z) { float a = -bearingDeg * PI_F / 180; *x = sinf(a) * dist; *z = cosf(a) * dist; }
static void placeFoe(Game *G, const Foe *f, int i, int n) {
  Rng *r = &G->rng; float x, z;
  if (f->placed) polar(f->at[0], f->at[1], &x, &z);
  else { float a = (i / (float)n) * TAU + rngRange(r, -0.4f, 0.4f) + PI_F * 0.6f, d = rngRange(r, 520, 760); x = sinf(a) * d; z = cosf(a) * d; }
  x = clampf(x, -G->ter.bx, G->ter.bx); z = clampf(z, -G->ter.bz, G->ter.bz);
  Mech *e = newMech(G, f->type, 1, x, z, f->hasFace ? -f->face * PI_F / 180 : atan2f(-x, -z) + rngRange(r, -1, 1));
  if (!e) return;
  e->ai.aware = f->hasAware ? f->aware : rngChance(r, 0.3f);
  if (f->profile >= 0) e->ai.profile = f->profile;
}
static void beginPlay(Game *G, int chassis) {
  G->player = newMech(G, chassis, 0, 0, 0, 0);
  G->eye = eyeOf(G->player); G->view = dirOf(0, 0); G->aim = vadd(G->eye, vmul(G->view, 100));
  G->state = ST_PLAY; G->paused = 0;
}
void startMatch(Game *G, const Mission *def, unsigned seed, int chassis, int diff, int flat) {
  resetMatch(G, seed, def->pal, def->time, def->weather, flat);
  G->diff = diff; G->def = def; G->kind = 1;
  if (def->ramp[0] >= 0) { G->hasRamp = 1; palAt(&G->ramp0, def->pal, def->ramp[0]); palAt(&G->ramp1, def->pal, def->ramp[1]); G->rampSecs = def->rampSecs; }
  beginPlay(G, chassis);
  for (int i = 0; i < def->nFoes; i++) placeFoe(G, &def->foes[i], i, def->nFoes);
}
// Free play: a mix of foes on a ring, lighter ones more often.
void startFreePlay(Game *G, int biome, int timeOfDay, int weather, int nFoes, unsigned seed, int chassis, int diff, int flat) {
  resetMatch(G, seed, biome, timeOfDay, weather, flat);
  G->diff = diff; G->def = NULL; G->kind = 0;
  beginPlay(G, chassis);
  static const int POOL[] = { CH_JACKAL, CH_JACKAL, CH_KESTREL, CH_LIGHT1, CH_JACKAL, CH_WARDEN, CH_SNIPER1, CH_KESTREL, CH_PUNCHER };
  for (int i = 0; i < nFoes && i < MAX_MECHS - 1; i++) { Foe f = { POOL[rngInt(&G->rng, 9)], { 0, 0 }, 0, 0, 0, 0, 0, -1 }; placeFoe(G, &f, i, nFoes); }
}
