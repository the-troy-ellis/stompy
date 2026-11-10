#include "sim/game.h"
#include <string.h>
// One frame of the whole simulation. `in` is the input snapshot; `dt` is seconds (the caller steps at 1/60).
Input noInput(void) { Input i; memset(&i, 0, sizeof i); return i; }

static void apart(Game *G) {   // mechs don't walk through each other
  for (int i = 0; i < G->nMechs; i++) for (int j = i + 1; j < G->nMechs; j++) {
    Mech *a = &G->mechs[i], *b = &G->mechs[j];
    if (!a->alive || !b->alive) continue;
    float dx = b->x - a->x, dz = b->z - a->z, d = hypot2(dx, dz), r = a->geo->radius * a->ch->scale + b->geo->radius * b->ch->scale;
    int over = a->y > b->y + b->geo->height * b->ch->scale - 0.5f || b->y > a->y + a->geo->height * a->ch->scale - 0.5f;
    if (d < r && d > 0.01f && !over) { float gap = r - d; a->x -= (dx / d) * gap * 0.5f; a->z -= (dz / d) * gap * 0.5f; b->x += (dx / d) * gap * 0.5f; b->z += (dz / d) * gap * 0.5f; }
  }
}
static void tickObjectives(Game *G) {   // eliminate: win when no enemy is alive
  if (G->state != ST_PLAY) return;
  for (int i = 0; i < G->nMechs; i++) if (G->mechs[i].team != 0 && G->mechs[i].alive) return;
  G->won = 1; G->state = ST_OVER; G->endT = 3.2f;
  voice(G, VO_COMPLETE, NULL, 1, 400);
}
void update(Game *G, const Input *in, float dt) {
  G->time += dt;
  if (G->hasRamp) blendPal(&G->ramp0, &G->ramp1, minf(1, G->time / G->rampSecs), &G->pal);
  G->nCBeams = 0;
  G->frame++;
  G->input = *in;
  Mech *P = G->player;
  if (P->alive && !P->shutdown && !G->paused) {
    if (in->thr) P->throttle = clampf(P->throttle + clampf(in->thr, -1, 1) * dt * 0.9f, -0.35f, 1);
    if (in->stop) P->throttle = 0;
    float legRate = P->ch->turn * dt * (P->hp[SEC_LL] > 0 && P->hp[SEC_RL] > 0 ? 1 : 0.5f) * (P->melee.on ? 0.5f : 1);   // half rate on one leg, and mid-swing
    P->yaw += clampf(in->turn, -1, 1) * legRate;
    if (G->guide.on) { G->guide.yaw += in->twist * 1.4f * dt + in->twistBy; G->guide.pitch = clampf(G->guide.pitch + in->pitch * 1.0f * dt + in->pitchBy, -1.3f, 1.3f); }
    else {
      P->twist = clampf(P->twist + in->twist * 1.6f * dt + in->twistBy, -1.9f, 1.9f);
      P->pitch = clampf(P->pitch + in->pitch * 0.9f * dt + in->pitchBy, -0.4f, 0.45f);
    }
    if (in->twist || in->twistBy) P->centring = 0;
    if (in->centre || P->centring) { P->twist *= maxf(0, 1 - 6 * dt); if (P->centring && fabsf(P->twist) < 0.01f) { P->twist = 0; P->centring = 0; } }
    P->jetting = !!in->jets;
    if (P->air && P->jet.blasted) airSteer(G, P, clampf(in->thr, -1, 1), clampf(in->turn, -1, 1), dt);
  } else P->jetting = 0;

  G->eye = eyeOf(P);
  G->view = dirOf(viewYaw(P), P->pitch);
  Hit aimHit = rayHit(G, G->eye, G->view, 1100, P);
  G->aim = aimHit.ok ? aimHit.point : vadd(G->eye, vmul(G->view, 1100));
  G->aimMech = aimHit.ok ? aimHit.mech : NULL;
  Mech *t = G->target;
  if (t && !t->alive) G->target = t = NULL;
  G->lock = t && vlen(vsub(centerOf(t), G->eye)) < WEAPONS[W_LRM].range && vdot(vnorm(vsub(centerOf(t), G->eye)), G->view) > cosf(0.3f);
  int was = G->lockOn, canFly = 0;
  for (int i = 0; i < P->nW; i++) if (P->w[i].def->cat == CAT_MISSILE && !P->w[i].dead && P->w[i].ammo > 0) canFly = 1;
  G->lockOn = G->lock && canFly;   // a lock that means something: the brackets snap to a diamond
  if (G->lockOn && !was && P->alive) G->fx.sfx(G->fx.ud, SFX_LOCK, NULL, 0, 0);
  if (!G->paused) jetLock(G, P);
  if (in->target && P->alive && !G->paused) cycleTarget(G);

  int live = P->alive && !G->paused;
  if (live && in->punch) meleePress(G, P);
  G->punchReady = live && !P->melee.on && meleeTarget(G, P) != NULL;
  int armed = live && !P->melee.on;   // no guns during a swing or its recovery
  P->beamOn = armed && in->energy && !G->guide.on;
  fusionTick(G, P, dt, armed && in->fusion && !G->guide.on);
  if (armed && in->energy && !G->guide.on) fireCat(G, CAT_ENERGY);   // bolts; beams skip themselves
  if (armed && in->ballistic) fireCat(G, CAT_BALLISTIC);
  missileTrigger(G, armed && (in->missile || in->missileTap));
  if (G->guide.on) steerVolley(G, dt);

  for (int i = 0; i < G->nMechs; i++) {
    Mech *m = &G->mechs[i];
    if (m->team != 0 && m->alive) { if (m->ai.still) { m->throttle = 0; m->jetting = 0; } else think(G, m, dt); }
    if (m->alive) { stepMech(G, m, dt); meleeTick(G, m, dt); }
    if (m->alive && m->beamOn) beamTick(G, m, dt, m == P ? G->aim : m->ai.beamAim); else m->beaming = 0;
    if (m != P) m->beamOn = 0;
  }
  coolArmour(G, dt);
  apart(G);
  tickObjectives(G);
  stepBursts(G, dt);
  stepShots(G, dt);
  stepDying(G, dt);
  updatePulses(G, dt);
  stepParticles(G, dt);
  stepDebris(G, dt);
  stepWrecks(G, dt);
  for (int i = 0; i < G->nMsgs; ) { G->msgs[i].t -= dt; if (G->msgs[i].t <= 0) { memmove(&G->msgs[i], &G->msgs[i + 1], sizeof(Msg) * (G->nMsgs - i - 1)); G->nMsgs--; } else i++; }
  G->flash = maxf(0, G->flash - dt * (G->reducedMotion ? 2.4f : 1.2f));
  G->shake = maxf(0, G->shake - dt * 2.2f);
  G->kick = maxf(0, G->kick - dt * 5);
  stepBob(G, dt);
  G->whiteFlash = maxf(0, G->whiteFlash - dt * (G->reducedMotion ? 3.2f : 1.6f));
  G->hitMark = maxf(0, G->hitMark - dt);
  G->hitStop = maxf(0, G->hitStop - dt);
  G->twistRate = fabsf(P->twist - G->lastTwist) / maxf(dt, 1e-3f);
  G->lastTwist = P->twist;
  if (G->state == ST_OVER) { G->endT -= dt; if (G->endT <= 0) G->state = ST_DEBRIEF; }
}
