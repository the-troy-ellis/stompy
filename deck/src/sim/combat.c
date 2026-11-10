#include "sim/game.h"
#include <stdio.h>
#include <string.h>
const float DEATH_BEAT = 0.25f, DEATH_BUCKLE = 0.3f, DEATH_TOPPLE = 0.8f, WRECK_SETTLE = 1.0f, WRECK_BURN = 30;
static const float BUCKLE_DROP = 0.4f, WRECK_POPS = 3;

static void alertEnemy(Game *G, Mech *e, Mech *src) {
  AI *a = &e->ai; a->aware = 1; a->hitAt = G->time;
  if (src && src != e) { a->bx = src->x; a->by = src->y; a->bz = src->z; a->bvx = 0; a->bvz = 0; a->bAt = G->time; a->hasBelief = 1; }
}
// What a round does beyond its damage, by weapon: a bolt scrambles and rattles; anything with `knock` shoves.
void onShotHit(Game *G, Shot *s, Mech *t, v3 p) {
  const WeaponDef *d = &WEAPONS[s->type];
  if (!t->alive && !t->isDying) return;
  if (d->scramble) {
    t->scramble = maxf(t->scramble, d->scramble);
    float a = viewYaw(t), side = -signf((p.x - t->x) * cosf(a) - (p.z - t->z) * sinf(a)); if (!side) side = 1;
    feel(G, FE_BOLT, t, 1, side, NULL, t == G->player ? NULL : &p);
  }
  if (d->knock && t->alive) { float h = hypot2(s->v.x, s->v.z); if (h < 1e-6f) h = 1; float dir[2] = { s->v.x / h, s->v.z / h }; knock(G, t, s->owner, d->knock, dir, 0); }
}
static v3 lerp3(v3 a, v3 b, float t) { return vadd(a, vmul(vsub(b, a), t)); }
// The part comes off: an arm as one piece from the shoulder, a leg as thigh, shin and foot.
static void shedSection(Game *G, Mech *m, int sec, v3 p) {
  Rng *r = &G->rng; const Geo *g = m->geo; float s = m->ch->scale; v3 away = vnorm(V3(m->x - p.x, 0.4f, m->z - p.z));
#define FLING() vadd(vmul(away, -rngRange(r, 3, 7)), V3(rngRange(r, -2, 2), rngRange(r, 4, 8), rngRange(r, -2, 2)))
  if (sec == SEC_LA || sec == SEC_RA) { m4 tf = torsoFrame(m); v3 at = m4apply(&tf, V3((sec == SEC_LA ? 1 : -1) * g->armX, g->armY, 0)); shedPart(G, m, PART_ARM, at, FLING()); return; }
  for (int i = 0; i < g->nLegs; i++) {
    if ((g->legs[i].hx > 0) != (sec == SEC_LL)) continue;
    v3 hip = V3(m->x, m->y + g->hip * s, m->z), f = m->feet[i].pos;
    shedPart(G, m, PART_ULEG, lerp3(hip, f, 0.3f), FLING()); shedPart(G, m, PART_LLEG, lerp3(hip, f, 0.7f), FLING()); shedPart(G, m, PART_FOOT, f, FLING());
  }
#undef FLING
}
void loseSection(Game *G, Mech *m, int sec, v3 p, Mech *src) {
  m->hp[sec] = 0;
  for (int i = 0; i < m->nW; i++) if (m->w[i].mount == sec) m->w[i].dead = 1;
  shedSection(G, m, sec, p);
  feel(G, FE_SECTIONLOST, m, 1, sec == SEC_LA || sec == SEC_LL ? -1 : sec == SEC_RA || sec == SEC_RL ? 1 : 0, NULL, m == G->player ? NULL : &p);
  explode(G, p, 0);
  if (m == G->player) {
    int leg = sec == SEC_LL || sec == SEC_RL; char flat[48]; snprintf(flat, sizeof flat, "%s destroyed.", SECTION_NAME[sec]);
    if (leg && m->hp[SEC_LL] <= 0 && m->hp[SEC_RL] <= 0) voice(G, VO_LEGSLOST, NULL, 1, 0);
    else voice(G, leg ? VO_LEGLOST : VO_ARMLOST, flat, 1, 0);
  } else if (src == G->player) {
    char t[64]; const char *n = SECTION_NAME[sec]; char up[16]; int i; for (i = 0; n[i] && i < 15; i++) up[i] = n[i] >= 'a' && n[i] <= 'z' ? n[i] - 32 : n[i]; up[i] = 0;
    snprintf(t, sizeof t, "%s: %s DESTROYED", CHASSIS_NAME[m->type], up); msg(G, t, 0);
  }
}
static void beginDeath(Game *G, Mech *m) {
  Rng *r = &G->rng; v3 c = centerOf(m);
  m->alive = 0; m->isDying = 1;
  m->dying.t = 0; m->dying.exploded = 0; m->dying.angle = 0; m->dying.drop = 0; m->dying.buckle = 0;
  m->dying.fallYaw = m->yaw + (rngChance(r, 0.5f) ? 0 : PI_F) + rngRange(r, -0.7f, 0.7f); m->dying.roll = rngRange(r, -0.6f, 0.6f);
  G->fx.sfx(G->fx.ud, SFX_WHINE, m == G->player ? NULL : &c, 0, 0);
  if (G->target == m) G->target = NULL;
}
void destroy(Game *G, Mech *m, Mech *src) {
  if (m == G->player) { endGuide(G, 1); G->mDown = 0; }
  beginDeath(G, m);
  if (m == G->player) {
    int foeShut = 0; for (int i = 0; i < G->nMechs; i++) { Mech *e = &G->mechs[i]; if (e->team != m->team && e->alive && e->shutdown) foeShut = 1; }
    G->death.melee = m->lastHitMelee; G->death.shutdown = m->shutdown; G->death.foeShutdown = foeShut;
    G->state = ST_OVER; G->endT = 3.2f; G->won = 0;
    msg(G, "MECH DESTROYED", 1);
    return;
  }
  if (src == G->player) { G->stats.kills++; G->lastKillMelee = m->lastHitMelee; G->hasLastKill = 1; }
  voice(G, m->lastHitMelee == 2 ? VO_KILLSTOMP : m->lastHitMelee ? VO_KILLPUNCH : VO_KILL, NULL, 1, DEATH_BEAT * 1000);
}
void damage(Game *G, Mech *m, v3 p, float amt, Mech *src, int beam, int melee) {
  if (!m->alive) return;
  if (!melee) m->lastHitMelee = 0;
  int sec = sectionHit(m, p);
  if (m->hp[sec] <= 0) sec = SEC_T;
  m->hp[sec] -= amt;
  if (!beam) hitSparks(G, m, p, sec, amt);
  if (src == G->player && m != G->player) { if (!beam) { G->stats.hits++; G->hitStop = HIT_STOP; } G->stats.dealt += amt; G->hitMark = 0.25f; }
  float a = viewYaw(m), side = -signf((p.x - m->x) * cosf(a) - (p.z - m->z) * sinf(a));
  if (!beam) feel(G, FE_HIT, m, amt / 10 * HIT_BY_SECTION[sec], side, NULL, m == G->player ? NULL : &p);
  if (m == G->player) {
    G->stats.taken += amt;
    if (!beam || !(G->hasBeamOnAt && G->time - G->beamOnAt < BEAM_CONTACT_GAP)) G->fx.sfx(G->fx.ud, SFX_CLANG, NULL, sec, 0);
    if (beam) { G->beamOnAt = G->time; G->hasBeamOnAt = 1; }
    if (!G->target && src && src->alive) G->target = src;
  } else if (m->team != 0) alertEnemy(G, m, src);
  if (m->hp[sec] > 0) {
    if (m == G->player && sec == SEC_T && m->hp[SEC_T] < m->max[SEC_T] * 0.3f) G->fx.say(G->fx.ud, "Warning. Critical damage.", 0, 0);
    return;
  }
  float over = -m->hp[sec];
  m->hp[sec] = 0;
  if (sec == SEC_T) { destroy(G, m, src); return; }
  loseSection(G, m, sec, p, src);
  if (over > 0) { m->hp[SEC_T] -= over; if (m->hp[SEC_T] <= 0) { m->hp[SEC_T] = 0; destroy(G, m, src); } }
}
static void makeWreck(Game *G, Mech *m, float roll) {
  if (G->nWrecks >= MAX_WRECKS) { memmove(&G->wrecks[0], &G->wrecks[1], sizeof(Wreck) * (MAX_WRECKS - 1)); G->nWrecks = MAX_WRECKS - 1; }
  Rng *r = &G->rng; Wreck *w = &G->wrecks[G->nWrecks++]; int ammo = 0;
  for (int i = 0; i < m->nW; i++) if (m->w[i].def->ammo && m->w[i].ammo > 0 && !m->w[i].dead) ammo = 1;
  w->x = m->x; w->y = m->y; w->z = m->z; w->yaw = m->yaw; w->chassis = m->type; w->scale = m->ch->scale; w->t = 0; w->roll = roll; w->settle = 0;
  w->nPops = 2 + rngInt(r, 3);
  for (int i = 0; i < w->nPops; i++) w->pops[i] = rngRange(r, 0.3f, WRECK_POPS);
  for (int i = 1; i < w->nPops; i++) for (int j = i; j > 0 && w->pops[j] < w->pops[j - 1]; j--) { float t = w->pops[j]; w->pops[j] = w->pops[j - 1]; w->pops[j - 1] = t; }
  w->hasBigPop = ammo; w->bigPop = ammo ? rngRange(r, 1, 2) : 0;
}
// The death in beats: a quarter-second freeze with a rising whine, the torso blows (arms and plates
// fly), the legs buckle, the body topples about its feet, then it is a wreck that pops.
void stepDying(Game *G, float dt) {
  for (int i = 0; i < G->nMechs; i++) {
    Mech *m = &G->mechs[i]; if (!m->isDying) continue;
    m->dying.t += dt;
    if (!m->dying.exploded && m->dying.t >= DEATH_BEAT) {
      m->dying.exploded = 1; Rng *r = &G->rng; v3 c = centerOf(m);
      explode(G, c, 1); explode(G, vadd(c, V3(rngRange(r, -3, 3), 2, rngRange(r, -3, 3))), 0);
      for (int sec = SEC_LA; sec <= SEC_RA; sec++) if (m->hp[sec] > 0) { m->hp[sec] = 0; shedSection(G, m, sec, vadd(c, V3(rngRange(r, -1, 1), 0, rngRange(r, -1, 1)))); }
      for (int k = 0; k < 4; k++) shedPart(G, m, PART_PLATE, vadd(c, V3(rngRange(r, -1, 1), rngRange(r, -1, 1), rngRange(r, -1, 1))), V3(rngRange(r, -8, 8), rngRange(r, 4, 12), rngRange(r, -8, 8)));
      if (m == G->player) feel(G, FE_DEATH, m, 1, 0, NULL, NULL);
    }
    if (m->dying.exploded) {
      float b = minf(1, (m->dying.t - DEATH_BEAT) / DEATH_BUCKLE);
      m->dying.buckle = b; m->dying.drop = b * b * BUCKLE_DROP * m->geo->hip * m->ch->scale;
      float u = clampf((m->dying.t - DEATH_BEAT - DEATH_BUCKLE) / DEATH_TOPPLE, 0, 1);
      m->dying.angle = b * 0.12f + u * u * (PI_F / 2 - 0.12f) * 0.95f;
      if (u >= 1) {
        makeWreck(G, m, m->dying.roll);
        scorch(G, m->x, m->z, 5 * m->ch->scale, m->y);
        v3 at = V3(m->x, m->y, m->z); G->fx.sfx(G->fx.ud, SFX_BOOM, &at, 0, 0);
        if (m == G->player) { m->fallen.on = 1; m->fallen.angle = m->dying.angle; m->fallen.fallYaw = m->dying.fallYaw; m->fallen.roll = m->dying.roll; m->fallen.drop = m->dying.drop; }
        m->isDying = 0; m->gone = 1;
      }
    }
  }
}
void stepWrecks(Game *G, float dt) {
  Rng *r = &G->rng; float smoke[3] = { 0.2f, 0.19f, 0.18f };
  for (int i = 0; i < G->nWrecks; i++) {
    Wreck *w = &G->wrecks[i]; w->t += dt; w->settle = minf(1, w->t / WRECK_SETTLE);
    while (w->nPops && w->t >= w->pops[0]) {
      memmove(&w->pops[0], &w->pops[1], sizeof(float) * 3); w->nPops--;
      v3 p = V3(w->x + rngRange(r, -2, 2) * w->scale, w->y + rngRange(r, 1, 3) * w->scale, w->z + rngRange(r, -2, 2) * w->scale);
      explode(G, p, 0);
      for (int k = 0; k < 4; k++) particle(G, p, V3(rngRange(r, -2, 2), rngRange(r, 2, 5), rngRange(r, -2, 2)), rngRange(r, 1.5f, 2.5f), rngRange(r, 1.2f, 2.2f) * w->scale, smoke, PK_SMOKE, 0, 0);
    }
    if (w->hasBigPop && w->t >= w->bigPop) { w->hasBigPop = 0; explode(G, V3(w->x, w->y + 2 * w->scale, w->z), 1); }
    if (w->t < WRECK_BURN && rngChance(r, dt * 5)) particle(G, V3(w->x + rngRange(r, -2, 2), w->y + 2, w->z + rngRange(r, -2, 2)), V3(rngRange(r, -0.5f, 0.5f), rngRange(r, 3, 5), rngRange(r, -0.5f, 0.5f)), rngRange(r, 2, 3.5f), rngRange(r, 1, 2.2f), smoke, PK_SMOKE, 0, 0);
  }
}

static Shot *newShot(Game *G) {
  if (G->nShots >= MAX_SHOTS) { int k = -1; for (int i = 0; i < G->nShots; i++) if (!G->shots[i].guided) { k = i; break; } if (k < 0) return NULL; G->shots[k] = G->shots[--G->nShots]; }
  Shot *s = &G->shots[G->nShots++]; memset(s, 0, sizeof *s); return s;
}
// One shell out of the muzzle: a single shot, or one round of a burst.
static void roundOut(Game *G, Mech *m, Weapon *w, v3 mz, v3 dir) {
  const WeaponDef *d = w->def; Rng *r = &G->rng;
  if (d->jitter) dir = vnorm(vadd(dir, V3(rngRange(r, -d->jitter, d->jitter), rngRange(r, -d->jitter, d->jitter), rngRange(r, -d->jitter, d->jitter))));
  Shot *s = newShot(G); if (!s) return;
  s->kind = WK_SHELL; s->type = w->type; s->p = mz; s->v = vmul(dir, d->speed); s->owner = m; s->dmg = d->dmg; s->life = d->range / d->speed;
  float fire[3] = { 1, 0.8f, 0.3f };
  for (int i = 0; i < (d->burstN ? 2 : 5); i++) particle(G, vadd(mz, vmul(dir, 1.5f)), vadd(vmul(dir, rngRange(r, 4, 12)), V3(rngRange(r, -2, 2), rngRange(r, -1, 2), rngRange(r, -2, 2))), 0.15f, 0.6f, fire, PK_FIRE, 0, 0);
  int sfx = d->sfx == SFX_K_BONKER ? SFX_BONKER : d->sfx == SFX_K_PEASHOOTER ? SFX_PEASHOOTER : d->sfx == SFX_K_THUNDERCLAP ? SFX_THUNDERCLAP : SFX_CANNON;
  G->fx.sfx(G->fx.ud, sfx, &mz, 0, 0);
  m->flash.frame = G->frame; m->flash.p = mz; m->flash.dir = dir; m->flash.big = !d->burstN;
  float back[2] = { -dir.x, -dir.z };
  if (m == G->player || d->recoil) feel(G, d->bolt ? FE_FIREBOLT : d->recoil ? FE_FIREGAUSS : d->burstN ? FE_FIREMG : FE_FIREAC, m, 1, 0, back, m == G->player ? NULL : &mz);
  if (d->recoil) { float h = hypot2(dir.x, dir.z); if (h < 1e-6f) h = 1; m->push[0] -= dir.x / h * d->recoil; m->push[1] -= dir.z / h * d->recoil; }   // rocks the shooter back a step
}
int volley(Game *G, Mech *owner, int type, v3 mz, v3 dir, Mech *target) {
  const WeaponDef *d = &WEAPONS[type]; Rng *r = &G->rng; int vid = ++G->volleySeq;
  for (int i = 0; i < d->count; i++) {
    float sp = d->spread >= 0 ? d->spread : 0.08f, lift = d->lift >= 0 ? d->lift : 0.12f;
    v3 spread = vnorm(vadd(dir, V3(rngRange(r, -sp, sp), rngRange(r, 0, lift), rngRange(r, -sp, sp))));
    Shot *s = newShot(G); if (!s) break;
    s->kind = WK_MISSILE; s->type = type; s->p = vadd(mz, V3(rngRange(r, -0.6f, 0.6f), rngRange(r, -0.4f, 0.4f), rngRange(r, -0.6f, 0.6f)));
    s->v = vmul(spread, d->speed * rngRange(r, 0.85f, 1.1f)); s->owner = owner; s->dmg = d->dmg; s->life = d->range / d->speed + 1; s->target = d->homing ? target : NULL; s->vid = vid;
  }
  return vid;
}
int fire(Game *G, Mech *m, Weapon *w, v3 aim, Mech *target) {
  const WeaponDef *d = w->def;
  if (d->kind == WK_BEAM || d->kind == WK_FUSION) return 0;
  if (!m->alive || m->shutdown || w->dead || w->cd > 0 || (d->ammo && w->ammo <= 0)) return 0;
  v3 mz = muzzleOf(m, w), dir = vnorm(vsub(aim, mz));
  w->cd = d->cd; m->heat += d->heat;
  if (d->ammo) w->ammo--;
  if (m == G->player) G->stats.shots += d->count ? d->count : 1;
  if (d->kind == WK_SHELL) {
    roundOut(G, m, w, mz, dir);
    if (d->burstN) { w->burstLeft = d->burstN - 1; w->burstT = d->burstDt; w->burstAim = aim; }
  } else {
    int vid = volley(G, m, w->type, mz, dir, target);
    m->flash.frame = G->frame; m->flash.p = mz; m->flash.dir = dir; m->flash.big = 0;
    float back[2] = { -dir.x, -dir.z };
    if (m == G->player) { G->lastVolley = vid; feel(G, FE_FIRELRM, m, 1, 0, back, NULL); }
    G->fx.sfx(G->fx.ud, SFX_MISSILE, &mz, 0, 0);
  }
  return 1;
}
void stepBursts(Game *G, float dt) {
  for (int i = 0; i < G->nMechs; i++) { Mech *m = &G->mechs[i]; for (int k = 0; k < m->nW; k++) {
    Weapon *w = &m->w[k]; if (!w->burstLeft) continue;
    if (!m->alive || m->shutdown || w->dead) { w->burstLeft = 0; continue; }
    w->burstT -= dt;
    while (w->burstLeft > 0 && w->burstT <= 0) { v3 mz = muzzleOf(m, w); roundOut(G, m, w, mz, vnorm(vsub(w->burstAim, mz))); if (m == G->player) G->stats.shots++; w->burstLeft--; w->burstT += w->def->burstDt; }
  } }
}
// Shells and missiles, one frame: steer, fly, hit, splash.
void stepShots(Game *G, float dt) {
  Rng *r = &G->rng; float smoke[3] = { 0.55f, 0.53f, 0.5f };
  for (int i = 0; i < G->nShots; i++) {
    Shot *s = &G->shots[i];
    s->life -= dt;
    if (s->kind == WK_MISSILE) {
      if (s->guided && G->guide.on && s->vid == G->guide.vid) { float sp = vlen(s->v); s->v = vmul(vnorm(vadd(vnorm(s->v), vmul(G->guide.dir, dt * 7))), sp); }
      else if (s->target && s->target->alive) { v3 want = vnorm(vsub(centerOf(s->target), s->p)); float sp = vlen(s->v); s->v = vmul(vnorm(vadd(vnorm(s->v), vmul(want, dt * (s->owner == G->player ? 1.7f : 0.9f)))), sp); }
      s->smoke += dt; s->age += dt;
      if (s->smoke > 0.05f && (s->age > 0.3f || s->owner != G->player)) { s->smoke = 0; particle(G, s->p, V3(rngRange(r, -0.5f, 0.5f), rngRange(r, 0, 1), rngRange(r, -0.5f, 0.5f)), 0.9f, 0.5f, smoke, PK_SMOKE, 0, 0); }
    } else s->v.y -= 6 * dt;
    float stepL = vlen(s->v) * dt; v3 dir = vnorm(s->v);
    Hit hit = rayHit(G, s->p, dir, stepL, s->owner);
    if (hit.ok) {
      s->life = -1;
      if (hit.mech) { damage(G, hit.mech, hit.point, s->dmg, s->owner, 0, 0); onShotHit(G, s, hit.mech, hit.point); }
      if (s->kind == WK_MISSILE) blast(G, hit.point, s->dmg, s->owner, hit.mech);
      explode(G, hit.point, 0);
    } else s->p = vadd(s->p, vmul(s->v, dt));
    if (s->life <= 0 && s->kind == WK_MISSILE && !hit.ok) { blast(G, s->p, s->dmg, s->owner, NULL); explode(G, s->p, 0); }
  }
  for (int i = 0; i < G->nShots; ) { if (G->shots[i].life <= 0) G->shots[i] = G->shots[--G->nShots]; else i++; }
}
