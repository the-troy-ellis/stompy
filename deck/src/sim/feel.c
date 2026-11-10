#include "sim/game.h"

// The body springs every mech carries: squash, wobble (pitch, roll), sag, inertia tilt.
void initFeel(Mech *m) {
  const FeelSpring *S = &FEEL_SPRING;
  m->push[0] = m->push[1] = 0;
  springInit(&m->squash, S->squashK, S->squashZeta);
  springInit(&m->wobP, S->wobbleK, S->wobbleZeta); springInit(&m->wobR, S->wobbleK, S->wobbleZeta);
  springInit(&m->sag, S->sagK, S->sagZeta);
  springInit(&m->tiltP, 120, 1); springInit(&m->tiltR, 120, 1);
  m->tiltInit = 0;
}
// Weight: the body tips about its feet against its own acceleration, back as it speeds up, forward as it brakes, out of a turn.
void inertiaTargets(const Mech *m, float accel, float yawRate, float *p, float *r) {
  const FeelInertia *I = &FEEL_INERTIA;
  if (m->air || !m->alive) { *p = 0; *r = 0; return; }
  *p = clampf(-accel * I->pitch, -I->max, I->max); *r = clampf(m->speed * yawRate * I->roll, -I->max, I->max);
}
static void stepTilt(Mech *m, float dt) {
  const FeelInertia *I = &FEEL_INERTIA;
  if (!m->tiltInit) { m->tiltInit = 1; m->tiltSpeed = m->speed; m->tiltYaw = m->yaw; }
  float accel = dt > 0 ? (m->speed - m->tiltSpeed) / dt : 0, yawRate = dt > 0 ? wrapA(m->yaw - m->tiltYaw) / dt : 0;
  m->tiltSpeed = m->speed; m->tiltYaw = m->yaw;
  float p, r; inertiaTargets(m, accel, yawRate, &p, &r);
  float k = I->k / (m->ch->scale * m->ch->scale);
  springTune(&m->tiltP, k, I->zeta); springTune(&m->tiltR, k, I->zeta);
  springStep(&m->tiltP, dt, p); springStep(&m->tiltR, dt, r);
}
void stepFeel(Mech *m, float dt) {
  springStep(&m->squash, dt, 0); springStep(&m->wobP, dt, 0); springStep(&m->wobR, dt, 0);
  stepTilt(m, dt);
  springStep(&m->sag, dt, m->shutdown ? FEEL[FE_SHUTDOWN].sag * m->ch->scale : 0);   // a reactor down slumps
}
// The camera's eased drop: two critically damped springs in series.
static void bobTune(Game *G) {
  if (!G->bobInit) { G->bobInit = 1; springInit(&G->bob, FEEL_SPRING.bobK, FEEL_SPRING.bobZeta); springInit(&G->bobIn, FEEL_SPRING.bobK, FEEL_SPRING.bobZeta); }
}
void stepBob(Game *G, float dt) { if (!G->bobInit) return; springStep(&G->bobIn, dt, 0); springStep(&G->bob, dt, G->bobIn.x); }

// One event, one row of the table. `k` is the intensity; `mech` is who it
// happened to; `roll` leans the wobble sideways; `dir` is the unit [x, z] a
// push goes along; `at` places the thump in the world (NULL: your own).
void feel(Game *G, int event, Mech *mech, float k, float roll, const float *dir, const v3 *at) {
  const FeelRow *row = &FEEL[event];
  if (!(k > 0)) return;
  const FeelView *V = &FEEL_VIEW; int mine = mech == G->player || mech == NULL;
  float rm = mine && G->reducedMotion ? V->reducedScale : 1;
  if (mine) {
    if (row->kick) G->kick = maxf(G->kick, row->kick * k * rm);
    if (row->bob) { bobTune(G); springKick(&G->bobIn, row->bob * k * rm); }
    if (row->shake) G->shake = minf(V->shakeMax, G->shake + row->shake * k * rm);
    if (row->flash) G->flash = minf(V->flashMax, G->flash + row->flash * k);
    if (row->white) G->whiteFlash = maxf(G->whiteFlash, row->white * k);
  }
  if (mech) {
    if (row->squash) springKick(&mech->squash, row->squash * k * 8 * rm);
    if (row->wobble) { springKick(&mech->wobP, row->wobble * k * (1 - 0.5f * fabsf(roll))); if (roll) springKick(&mech->wobR, row->wobble * k * roll); }
    if (row->push && dir) { mech->push[0] += dir[0] * row->push * k; mech->push[1] += dir[1] * row->push * k; }
    if (row->overshoot) {   // the restart snaps the body up past standing height before it settles
      float w = sqrtf(mech->sag.k);
      springKick(&mech->sag, -(w * maxf(0, mech->sag.x) + row->overshoot * mech->ch->scale * w * 2.718281828f * 1.6f) - mech->sag.v);
    }
  }
  if (row->bass || row->duck || row->haptic) G->fx.thump(G->fx.ud, row->bass * k, row->duck * k, mine && !G->reducedMotion ? row->haptic * k : 0, at);
}
