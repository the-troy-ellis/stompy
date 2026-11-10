#include "sim/game.h"
// One mech, one frame: speed, jets, gravity, heat, shutdown, cooldowns, legs.
static const float PUSH_DECAY = 2.5f;   // a push of v m/s moves the mech about v / PUSH_DECAY metres

float gradeFactor(float grade) { return clampf(grade > 0 ? 1 - grade * WALK.slopeUp : 1 - grade * WALK.slopeDown, WALK.slopeMin, WALK.slopeMax); }
float slopeFactor(Game *G, const Mech *m) {
  if (grips(m)) return 1;   // four legs keep their grip
  float fx = sinf(m->yaw), fz = cosf(m->yaw);
  return gradeFactor((groundUnder(G, m, m->x + fx * 2, m->z + fz * 2) - groundUnder(G, m, m->x - fx * 2, m->z - fz * 2)) / 4);
}
static void landingDust(Game *G, Mech *m, float ground, float force) {
  Rng *r = &G->rng; float s = m->ch->scale; const float *low = PALS[G->biome].low;
  float col[3] = { low[0] * 0.85f * G->pal.shade[0], low[1] * 0.85f * G->pal.shade[1], low[2] * 0.85f * G->pal.shade[2] };
  int n = (int)(4 * FEEL[FE_LAND].dust * force * s + 0.5f);
  for (int i = 0; i < n; i++) particle(G, V3(m->x + rngRange(r, -1.5f, 1.5f) * s, ground + 0.3f, m->z + rngRange(r, -1.5f, 1.5f) * s), V3(rngRange(r, -3, 3), rngRange(r, 1, 3), rngRange(r, -3, 3)), rngRange(r, 0.7f, 1.2f), rngRange(r, 0.6f, 1.1f) * s, col, PK_SMOKE, 0, 0);
  if (force > 0.7f) {
    int ring = (int)(6 * FEEL[FE_LAND].dust * s + 0.5f);
    for (int i = 0; i < ring; i++) {
      float a = (i / (float)ring) * TAU + rngRange(r, -0.1f, 0.1f), v = rngRange(r, 9, 14) * force;
      particle(G, V3(m->x + sinf(a) * 1.2f * s, ground + 0.2f, m->z + cosf(a) * 1.2f * s), V3(sinf(a) * v, rngRange(r, 0.5f, 1.5f), cosf(a) * v), rngRange(r, 0.5f, 0.9f), rngRange(r, 0.8f, 1.4f) * s, col, PK_SMOKE, 0, 0);
    }
  }
}
static void finishStep(Game *G, Mech *m, float dt) {
  m->heat = maxf(0, m->heat - (m->shutdown ? 20 : m->sinkRate) * dt);
  v3 at = V3(m->x, m->y, m->z);
  if (!m->shutdown && m->heat >= 100) {   // heat 100 shuts the reactor down
    m->shutdown = 1;
    feel(G, FE_SHUTDOWN, m, 1, 0, NULL, m == G->player ? NULL : &at);
    if (m == G->player) { G->fx.sfx(G->fx.ud, SFX_POWERDOWN, NULL, 0, 0); voice(G, VO_SHUTDOWN, NULL, 1, 0); }
  } else if (m->shutdown && m->heat < 45) {   // 45 restarts it
    m->shutdown = 0;
    feel(G, FE_RESTART, m, 1, 0, NULL, m == G->player ? NULL : &at);
    if (m == G->player) { G->fx.sfx(G->fx.ud, SFX_POWERUP, NULL, 0, 0); voice(G, VO_ONLINE, NULL, 1, 0); }
  }
  if (m == G->player && m->heat > 80 && !m->shutdown) G->fx.say(G->fx.ud, "Warning. Heat critical.", 0, 0);
  for (int i = 0; i < m->nW; i++) m->w[i].cd = maxf(0, m->w[i].cd - dt);
  if (m->scramble > 0) m->scramble = maxf(0, m->scramble - dt);
  stepFeel(m, dt);
  gait(G, m, dt);
}
void stepMech(Game *G, Mech *m, float dt) {
  Rng *r = &G->rng; float legs = (m->hp[SEC_LL] > 0 ? 0.5f : 0) + (m->hp[SEC_RL] > 0 ? 0.5f : 0);
  float maxS = m->maxSpeed * (legs >= 1 ? 1 : legs > 0 ? 0.45f : 0);   // no legs: sat down, a turret
  if (m->heat > 85) maxS *= 0.65f;
  if (!m->air) maxS *= slopeFactor(G, m);
  if (m->dig > 0) { m->dig = maxf(0, m->dig - dt); maxS *= WALK.digSlow; }
  float target = !m->alive || m->shutdown ? 0 : m->throttle * maxS;
  m->speed += clampf(target - m->speed, -11 * dt, 7 * dt);   // mechs speed up slowly
  float *push = m->push;
  const float *fly = m->air && m->jet.blasted ? m->jet.fly : NULL;
  float x0 = m->x, z0 = m->z;
  float nx = clampf(m->x + (sinf(m->yaw) * m->speed + push[0] + (fly ? fly[0] : 0)) * dt, -G->ter.bx, G->ter.bx);
  float nz = clampf(m->z + (cosf(m->yaw) * m->speed + push[1] + (fly ? fly[1] : 0)) * dt, -G->ter.bz, G->ter.bz);
  m->x = nx; m->z = nz; m->walled = 0;
  m->slide = dt > 0 ? signf(m->speed) * hypot2(m->x - x0, m->z - z0) / dt : m->speed;
  float keep = maxf(0, 1 - PUSH_DECAY * dt);
  push[0] *= keep; push[1] *= keep;
  float skid = hypot2(push[0], push[1]);   // skidding: dust streaks behind the feet while the push is strong
  if (skid > 2 && m->alive && !m->air && rngChance(r, dt * FEEL_KNOCK.skidDust * minf(1, skid / 10))) {
    const float *low = PALS[G->biome].low; float col[3] = { low[0] * 0.8f, low[1] * 0.8f, low[2] * 0.8f };
    particle(G, V3(m->x - push[0] / skid * 1.5f * m->ch->scale + rngRange(r, -1, 1), m->y + 0.3f, m->z - push[1] / skid * 1.5f * m->ch->scale + rngRange(r, -1, 1)),
      V3(-push[0] * 0.3f + rngRange(r, -1, 1), rngRange(r, 1, 2.5f), -push[1] * 0.3f + rngRange(r, -1, 1)), rngRange(r, 0.5f, 0.9f), rngRange(r, 0.6f, 1.1f) * m->ch->scale, col, PK_SMOKE, 0, 0);
  }
  float ground = groundUnder(G, m, m->x, m->z);
  stepJets(G, m, dt);
  m->vy -= 18 * dt;
  m->y += m->vy * dt;
  if (m->air) {
    m->airT += dt;
    if (m->vy < 0 && tryStomp(G, m, m->airT)) m->airT = 0;   // coming down onto a mech: a stomp
  }
  if (m->vy <= 0 && m->y - ground < 1.2f) {
    if (m->air) {
      float force = clampf(-m->vy / 20, 0.25f, 1); v3 at = V3(m->x, m->y, m->z);
      m->airT = 0;
      feel(G, FE_LAND, m, force, 0, NULL, m == G->player ? NULL : &at);
      if (m == G->player) G->fx.sfx(G->fx.ud, SFX_LAND, NULL, force, 0);
      else G->fx.sfx(G->fx.ud, SFX_STEP, &at, force * 0.8f, m->ch->scale);
      landingDust(G, m, ground, force);
      m->speed *= 1 - WALK.digCut * force; m->dig = WALK.digHold * force;   // the landing digs the feet in
    }
    m->y = ground; m->vy = 0; m->air = 0;
  } else if (m->y > ground + 1.2f) m->air = 1;
  if (m->y < ground) { m->y = ground; m->vy = maxf(0, m->vy); }
  finishStep(G, m, dt);
}
