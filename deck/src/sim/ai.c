#include "sim/game.h"
// Enemy AI (docs/specs/05-ai.md): perception by line of sight, a per-chassis
// plan of behaviours, fire discipline by difficulty. Difficulty scales skill,
// never stats.
static const float ROUTE_FROM = 120;

void aiInit(Game *G, Mech *e) {
  Rng *r = &G->rng; AI *a = &e->ai; *a = (AI){ 0 };
  a->strafe = rngSign(r); a->strafeT = rngRange(r, 2, 5); a->jitter = rngRange(r, 0.2f, 0.8f); a->hitAt = -1e9f; a->lastSeen = -1e9f; a->reactAt = -1; a->profile = e->ch->profile;
}
static const Diff *diffOf(const Game *G) { return &DIFFS[G->diff]; }
static float towards(const Mech *e, float x, float z) { return atan2f(x - e->x, z - e->z); }
static float inMapX(const Game *G, float v) { return clampf(v, -G->ter.bx + 40, G->ter.bx - 40); }
static float inMapZ(const Game *G, float v) { return clampf(v, -G->ter.bz + 40, G->ter.bz - 40); }
static v3 eyeAt(Game *G, const Mech *e, float x, float z) { return V3(x, terHeight(&G->ter, x, z) + (e->geo->torsoY + e->geo->eye[1]) * e->ch->scale, z); }

// --- perception -----------------------------------------------------------
// Awareness by sight: line of sight within the difficulty's `sight` (shorter
// in weather), being hit, or an ally's shout. Lost contact for 8 s: search
// around the last fix. The AI aims where it believes you are.
static int perceive(Game *G, Mech *e, Mech *P, float dt, float *bx, float *bz) {
  AI *a = &e->ai; const PerceptionDef *K = &PERCEPTION;
  int look = G->time >= a->lookT;
  if (look) {
    a->lookT = G->time + K->lookEvery;
    float sight = diffOf(G)->sight * (1 - (1 - WEATHER[G->weather].radar) * 1.0f);
    float d = hypot2(P->x - e->x, P->z - e->z);
    int seen = P->alive && d < sight && !blockedLOS(G, eyeOf(e), centerOf(P));
    if (seen) {
      if (!a->aware) {   // first sight: react after the difficulty's delay
        if (a->reactAt < 0) a->reactAt = G->time + diffOf(G)->react;
        if (G->time >= a->reactAt) { a->aware = 1; a->shoutPending = 1; a->shoutAt = G->time + K->shoutDelay; }
      }
      if (a->aware) { a->seen = 1; a->lastSeen = G->time; a->bx = P->x; a->by = P->y; a->bz = P->z; a->bvx = sinf(P->yaw) * P->speed; a->bvz = cosf(P->yaw) * P->speed; a->bAt = G->time; a->hasBelief = 1; a->state = 0; }
    } else { a->seen = 0; if (!a->aware) a->reactAt = -1; }
  }
  if (a->aware && a->shoutPending && G->time >= a->shoutAt) {   // the contact call: allies nearby wake up
    a->shoutPending = 0;
    for (int i = 0; i < G->nMechs; i++) { Mech *o = &G->mechs[i]; if (o != e && o->alive && o->team == e->team && !o->ai.aware && hypot2(o->x - e->x, o->z - e->z) < K->shoutRange) { o->ai.aware = 1; o->ai.bx = a->bx; o->ai.by = a->by; o->ai.bz = a->bz; o->ai.bAt = G->time; o->ai.hasBelief = 1; } }
  }
  if (a->aware && !a->seen && a->hasBelief && G->time - a->lastSeen > K->lostAfter && a->state == 0) { a->state = 1; a->hasWp = 0; a->coverOn = 0; }   // lost contact: search
  if (a->seen) { *bx = P->x; *bz = P->z; return 1; }
  if (a->hasBelief) { float t = minf(K->extrapolate, G->time - a->bAt); *bx = a->bx + a->bvx * t; *bz = a->bz + a->bvz * t; return 1; }
  *bx = P->x; *bz = P->z; return 0;
}

// --- behaviours -----------------------------------------------------------
typedef struct { Mech *P; float tx, tz, dist, toYaw; int seen; float reachP, reachE; } Ctx;
typedef struct { float moveYaw, thr; int jets, ok; } Out;
static Out none(void) { Out o = { 0, 0, 0, 0 }; return o; }
static Out go(float yaw, float thr) { Out o = { yaw, thr, 0, 1 }; return o; }

// How far a spot is in walking: a climb costs a walker its slope penalty; a cliff is Infinity.
static float travel(Game *G, const Mech *e, float x, float z) {
  float d = hypot2(x - e->x, z - e->z);
  if (d < 1) return d;
  int n = (int)ceilf(d / 4);
  for (int k = 0, h = 0; k < n; k++) { float f = (k + 1.f) / n, h2 = terHeight(&G->ter, e->x + (x - e->x) * f, e->z + (z - e->z) * f); if (k == 0) h = (int)terHeight(&G->ter, e->x, e->z); if (h2 - h > 1.6f * d / n) return 1e30f; h = (int)h2; }
  if (grips(e)) return d;
  return d / gradeFactor((terHeight(&G->ter, x, z) - terHeight(&G->ter, e->x, e->z)) / d);
}
static void strafeTick(Game *G, Mech *e, float dt) { e->ai.strafeT -= dt; if (e->ai.strafeT <= 0) { e->ai.strafe *= -1; e->ai.strafeT = rngRange(&G->rng, 3, 7); } }
// Approach above the band, back off below it, orbit inside it.
static Out keepRange(Game *G, Mech *e, const Ctx *c, float pref, float lo, float hi) {
  float s = e->ai.strafe;
  if (c->dist > pref * hi) return go(c->toYaw + s * 0.35f, 1);
  if (c->dist < pref * lo) return go(c->toYaw + PI_F - s * 0.6f, 1);
  return go(c->toYaw + s * PI_F / 2, 0.75f);
}
// Hot or hurt: the nearest spot nearby from which the target cannot be seen.
static int findCover(Game *G, Mech *e, Mech *target, float *ox, float *oz) {
  v3 tc = centerOf(target); int found = 0; float bestD = 1e30f;
  for (int di = 0; di < 3; di++) { float d = BEHAVIOUR.coverDists[di]; for (int k = 0; k < 8; k++) {
    float a = k * PI_F / 4, x = inMapX(G, e->x + sinf(a) * d), z = inMapZ(G, e->z + cosf(a) * d);
    if (!blockedLOS(G, eyeAt(G, e, x, z), tc)) continue;
    float t = travel(G, e, x, z); if (t >= 1e30f) continue;
    if (t < bestD) { bestD = t; *ox = x; *oz = z; found = 1; }
    if (found && bestD <= BEHAVIOUR.coverDists[0]) return 1;
  } }
  return found;
}
static Out cover(Game *G, Mech *e, const Ctx *c, int byTorso, float torso) {
  AI *a = &e->ai; const BehaviourDef *B = &BEHAVIOUR; int hot = e->heat > B->coverHeat, hurt = byTorso && e->hp[SEC_T] < e->max[SEC_T] * torso;
  if (!a->coverOn) {
    if (!(hot || (hurt && !(a->coverCd > G->time)))) return none();
    if (a->coverLookT > G->time) return none();
    a->coverLookT = G->time + B->coverEvery;
    float x = 0, z = 0; if (!findCover(G, e, c->P, &x, &z)) return none();
    a->coverOn = 1; a->coverX = x; a->coverZ = z; a->coverSince = G->time;
  }
  if (e->heat < B->coverLeave && (!hurt || G->time - a->coverSince > B->coverMaxWait)) { a->coverOn = 0; a->coverCd = G->time + B->coverRetry; return none(); }
  float d = hypot2(a->coverX - e->x, a->coverZ - e->z);
  a->lastSeen = G->time;   // hiding on purpose is not losing contact
  if (d < B->coverArrive) return go(e->yaw, 0);
  return go(towards(e, a->coverX, a->coverZ), 1);
}
// Light mechs: orbit close, flip the strafe when hit, jump over the target when near. With `stomp` the jump is a dive.
static Out harass(Game *G, Mech *e, const Ctx *c, float dt, int stomp) {
  AI *a = &e->ai; const BehaviourDef *B = &BEHAVIOUR;
  if (a->hitAt > -1e8f && (!a->hasFlipped || a->hitAt != a->flippedAt) && !(a->hitAt - a->flipT < B->hitFlipEvery && a->hasFlipped)) { a->hasFlipped = 1; a->flippedAt = a->flipT = a->hitAt; a->strafe *= -1; a->strafeT = rngRange(&G->rng, 3, 7); }
  if (a->jumpOn) {
    if (stomp && e->air && c->dist < B->stompOver) { a->jumpUntil = 0; Out o = go(c->toYaw, 0); o.jets = 0; return o; }
    if (G->time < a->jumpUntil) { Out o = go(stomp ? c->toYaw : a->jumpYaw, 1); o.jets = 1; return o; }
    if (e->air) return go(a->jumpYaw, 1);
    a->jumpOn = 0; a->jumpCd = G->time + B->jumpCooldown;
  }
  if (c->seen && c->dist < B->jumpWithin && !e->air && e->fuel >= 1 && !(a->jumpCd > G->time) && !e->melee.on && e->jets) {
    a->jumpOn = 1; a->jumpUntil = G->time + B->jumpFor; a->jumpYaw = c->toYaw;
    Out o = go(c->toYaw, 1); o.jets = 1; return o;
  }
  float mid = (B->harassBand[0] + B->harassBand[1]) / 2;
  return keepRange(G, e, c, mid, B->harassBand[0] / mid, B->harassBand[1] / mid);
}
// Snipers: a spot well above the target with line of sight; after `relocate` shots, another one, away from here.
static int findRidge(Game *G, Mech *e, Mech *target, int avoid, float ax, float az, float *ox, float *oz) {
  v3 tc = centerOf(target); float base = terHeight(&G->ter, target->x, target->z), bestD = 1e30f; int found = 0;
  for (int ri = 0; ri < 6; ri++) { float r = BEHAVIOUR.ridgeRadii[ri]; for (int k = 0; k < 16; k++) {
    float a = k * PI_F / 8, x = inMapX(G, target->x + sinf(a) * r), z = inMapZ(G, target->z + cosf(a) * r), h = terHeight(&G->ter, x, z);
    if (h < base + BEHAVIOUR.ridgeAbove) continue;
    if (avoid && hypot2(x - ax, z - az) < BEHAVIOUR.relocateAway) continue;
    if (blockedLOS(G, eyeAt(G, e, x, z), tc)) continue;
    float d = travel(G, e, x, z); if (d >= 1e30f) continue;
    if (d < bestD) { bestD = d; *ox = x; *oz = z; found = 1; }
  } }
  return found;
}
static Out ridge(Game *G, Mech *e, const Ctx *c, int relocate) {
  AI *a = &e->ai;
  if (relocate && a->shots - a->shotsAt >= relocate) { a->shotsAt = a->shots; a->hasMoveOff = 1; a->moveOffX = e->x; a->moveOffZ = e->z; a->ridgeLookT = 0; }
  if (!(a->ridgeLookT > G->time)) { a->ridgeLookT = G->time + BEHAVIOUR.ridgeEvery; float x = 0, z = 0; a->ridgeOn = findRidge(G, e, c->P, relocate && a->hasMoveOff, a->moveOffX, a->moveOffZ, &x, &z); if (a->ridgeOn) { a->ridgeX = x; a->ridgeZ = z; } }
  if (!a->ridgeOn) return none();
  if (hypot2(a->ridgeX - e->x, a->ridgeZ - e->z) < BEHAVIOUR.ridgeArrive) return none();
  return go(towards(e, a->ridgeX, a->ridgeZ), 1);
}
// Heavies advance together: no faster than the slowest ally within 150 m.
static void holdLine(Game *G, Mech *e, Out *out) {
  float slowest = e->maxSpeed;
  for (int i = 0; i < G->nMechs; i++) { Mech *o = &G->mechs[i]; if (o == e || o->team != e->team || !o->alive) continue; if (hypot2(o->x - e->x, o->z - e->z) <= BEHAVIOUR.lineRange) slowest = minf(slowest, o->maxSpeed); }
  if (slowest < e->maxSpeed) out->thr = minf(out->thr, slowest / e->maxSpeed);
}
static void avoidEdge(Game *G, Mech *e, Out *out) { if (fabsf(e->x) > G->ter.bx - 60 || fabsf(e->z) > G->ter.bz - 60) out->moveYaw = atan2f(-e->x, -e->z); }
static void avoidAllies(Game *G, Mech *e, Out *out) {
  float re = e->geo->radius * e->ch->scale;
  for (int i = 0; i < G->nMechs; i++) {
    Mech *o = &G->mechs[i]; if (o == e || o->team != e->team || !o->alive) continue;
    float dx = o->x - e->x, dz = o->z - e->z, d = hypot2(dx, dz), gap = re + o->geo->radius * o->ch->scale + BEHAVIOUR.allyGap;
    if (d > gap) continue;
    float rel = wrapA(atan2f(dx, dz) - out->moveYaw);
    if (fabsf(rel) > PI_F / 2) continue;
    float sg = signf(rel); if (!sg) sg = 1;
    out->moveYaw = out->moveYaw - sg * 0.7f * (1 - d / gap) - sg * 0.3f;
    return;
  }
}
int aiPlanBrawler(const Mech *e) { return e->ai.profile == PROF_BRAWLER; }
// Run the chassis's plan: the first driver with an opinion, then the shapers.
static Out steer(Game *G, Mech *e, const Ctx *c, float dt) {
  Out out = none(); int prof = e->ai.profile;
  switch (prof) {
    case PROF_HARASS: out = cover(G, e, c, 0, 0); if (!out.ok) out = harass(G, e, c, dt, 0); break;
    case PROF_LINE: out = keepRange(G, e, c, e->ch->pref, 0.6f, 1.35f); break;
    case PROF_SKIRMISH: out = cover(G, e, c, 1, 0.5f); if (!out.ok) out = harass(G, e, c, dt, 1); break;
    case PROF_SNIPER: out = ridge(G, e, c, (int)BEHAVIOUR.relocateAfter); if (!out.ok) out = cover(G, e, c, 1, BEHAVIOUR.coverTorso); if (!out.ok) out = keepRange(G, e, c, e->ch->pref, 0.6f, 1.35f); break;
    case PROF_BRAWLER: out = go(c->toYaw, c->dist > c->reachE * 0.8f ? 1 : 0); break;   // close along the shortest line and stay in reach; never retreats
    default: out = cover(G, e, c, 1, BEHAVIOUR.coverTorso); if (!out.ok) out = keepRange(G, e, c, e->ch->pref, 0.6f, 1.35f); break;
  }
  if (!out.ok) out = go(c->toYaw, 1);
  if (prof == PROF_LINE) holdLine(G, e, &out);
  avoidAllies(G, e, &out); avoidEdge(G, e, &out);
  return out;
}

// --- fire discipline -------------------------------------------------------
static v3 aimPoint(Game *G, Mech *e, Mech *P) {
  v3 c = centerOf(P);
  if (!diffOf(G)->sections) return c;
  float la = P->hp[SEC_LA] / P->max[SEC_LA], ra = P->hp[SEC_RA] / P->max[SEC_RA];
  if (P->hp[SEC_LA] <= 0 && P->hp[SEC_RA] <= 0) return c;
  int side = 0;
  if (P->hp[SEC_LA] > 0 && (P->hp[SEC_RA] <= 0 || la <= ra)) side = 1; else if (P->hp[SEC_RA] > 0) side = -1;
  if (side && minf(la, ra) >= 1) return c;
  float a = viewYaw(P), o = FIRE.armOffset * P->ch->scale;
  return vadd(c, V3(side * o * cosf(a), 0, -side * o * sinf(a)));
}
static float aimError(Game *G, Mech *e, Mech *P, float dist) { return dist * e->ch->acc0 * diffOf(G)->aimErr * (1 + fabsf(P->speed) / 14) * (P->air ? 1.6f : 1); }
static void decideFire(Game *G, Mech *e, Mech *P, float dist, float toYaw, float dt) {
  AI *a = &e->ai; Rng *r = &G->rng; float cap = diffOf(G)->heatCap;
  float off = fabsf(wrapA(toYaw - viewYaw(e)));
  a->lockT = off < FIRE.lockFace ? a->lockT + dt : 0;
  a->jitter -= dt;
  if (e->heat > cap) a->hot = 1; else if (a->hot && e->heat < cap - FIRE.coolBelow) a->hot = 0;
  int may = !a->hot && !e->shutdown && P->alive;
  v3 pc = aimPoint(G, e, P);
  Weapon *beam = NULL; for (int i = 0; i < e->nW; i++) if (e->w[i].def->kind == WK_BEAM && !e->w[i].dead) { beam = &e->w[i]; break; }
  if (beam && may && off < 0.3f && dist < beam->def->range * 0.95f) {   // lasers in bursts while on target and cool enough, with a drifting aim error
    if (e->heat > cap - 2) a->coolT = rngRange(r, 1.5f, 3);
    if ((a->coolT = maxf(0, a->coolT - dt)) == 0) {
      float err = aimError(G, e, P, dist);
      if (!a->hasAimPhase) { a->hasAimPhase = 1; a->aimPhase = a->strafeT + G->time * 0.1f; }
      float k = a->aimPhase - G->time * 0.1f;
      a->beamAim = vadd(pc, V3(sinf(k * 1.3f) * err, sinf(k * 1.7f) * err * 0.5f, cosf(k * 1.1f) * err));
      e->beamOn = 1;
    }
  }
  if (!may || off > 0.25f || a->jitter > 0) return;
  float alphaAt = a->profile == PROF_BRAWLER ? 0.4f : FIRE.alphaTorso;
  int alpha = P->hp[SEC_T] < P->max[SEC_T] * alphaAt;
  for (int i = 0; i < e->nW; i++) {
    Weapon *w = &e->w[i];
    if (w->def->kind == WK_BEAM || w->def->kind == WK_FUSION || w->dead || w->cd > 0 || dist > w->def->range * 0.95f) continue;
    if (w->def->kind == WK_MISSILE && w->def->homing && (dist < FIRE.lrmMin || a->lockT < FIRE.lockFor)) continue;
    v3 aim = pc;
    if (w->def->kind == WK_SHELL) { float t = dist / w->def->speed; aim = vadd(pc, V3(sinf(P->yaw) * P->speed * t, 0, cosf(P->yaw) * P->speed * t)); }
    float err = aimError(G, e, P, dist);
    aim = vadd(aim, V3(rngRange(r, -err, err), rngRange(r, -err, err) * 0.6f, rngRange(r, -err, err)));
    if (!fire(G, e, w, aim, P)) continue;
    a->shots++;
    if (!alpha) { a->jitter = rngRange(r, 0.15f, 0.6f); break; }
  }
}

// --- one enemy, one frame ----------------------------------------------------
void think(Game *G, Mech *e, float dt) {
  Mech *P = G->player; Rng *r = &G->rng; AI *a = &e->ai; int brawling = a->profile == PROF_BRAWLER;
  float tx, tz; int seen = perceive(G, e, P, dt, &tx, &tz) && a->seen;
  float dx = tx - e->x, dz = tz - e->z, dist = hypot2(dx, dz), toYaw = atan2f(dx, dz);
  float moveYaw, thr = 1; int jets = 0;
  if (!a->aware) {   // a patrol between random waypoints
    if (!a->hasWp || hypot2(a->wp[0] - e->x, a->wp[1] - e->z) < 30) { a->hasWp = 1; a->wp[0] = clampf(e->x + rngRange(r, -250, 250), -G->ter.bx, G->ter.bx); a->wp[1] = clampf(e->z + rngRange(r, -250, 250), -G->ter.bz, G->ter.bz); }
    moveYaw = atan2f(a->wp[0] - e->x, a->wp[1] - e->z); thr = 0.5f;
  } else if (a->state == 1) {   // lost contact: go to where they were last seen, then poke around it
    if (!a->hasWp || hypot2(a->wp[0] - e->x, a->wp[1] - e->z) < 25) {
      int first = !a->hasWp && hypot2(a->bx - e->x, a->bz - e->z) > 25; a->hasWp = 1;
      if (first) { a->wp[0] = a->bx; a->wp[1] = a->bz; } else { a->wp[0] = clampf(a->bx + rngRange(r, -PERCEPTION.searchRadius, PERCEPTION.searchRadius), -G->ter.bx, G->ter.bx); a->wp[1] = clampf(a->bz + rngRange(r, -PERCEPTION.searchRadius, PERCEPTION.searchRadius), -G->ter.bz, G->ter.bz); }
    }
    moveYaw = atan2f(a->wp[0] - e->x, a->wp[1] - e->z); thr = 0.7f;
  } else {
    strafeTick(G, e, dt);
    float reachP = meleeOf(P)->reach * P->ch->scale + e->geo->radius * e->ch->scale, reachE = meleeOf(e)->reach * e->ch->scale + P->geo->radius * P->ch->scale;
    int tooClose = seen && dist < reachP * AI_PUNCH.keepOut;
    int punchable = a->profile != PROF_SNIPER && P->alive && canPunch(G, e) && meleeTarget(G, e) == P;
    if (P->shutdown && P->alive) { moveYaw = toYaw; thr = dist < reachP * 0.6f ? 0 : 1; }   // a shut-down player: walk up and shove them
    else if (punchable || e->melee.on) { moveYaw = toYaw; thr = 0; }
    else if (tooClose && !brawling) moveYaw = toYaw + PI_F - a->strafe * 0.6f;
    else { Ctx c = { P, tx, tz, dist, toYaw, seen, reachP, reachE }; Out o = steer(G, e, &c, dt); moveYaw = o.moveYaw; thr = o.thr; jets = o.jets; }
    e->jetting = jets;
    (void)ROUTE_FROM;
  }
  e->yaw += clampf(wrapA(moveYaw - e->yaw), -e->ch->turn * dt, e->ch->turn * dt);
  e->throttle = thr;
  if (!a->aware) { e->twist *= 1 - dt; return; }
  float wantTwist = clampf(wrapA(toYaw - e->yaw), -1.9f, 1.9f);
  e->twist += clampf(wrapA(wantTwist - e->twist), -2 * dt, 2 * dt);
  v3 pc = seen ? centerOf(P) : V3(tx, terHeight(&G->ter, tx, tz) + 4.2f * P->ch->scale, tz);
  e->pitch = atan2f(pc.y - (e->y + 6 * e->ch->scale), dist);
  if (a->profile != PROF_SNIPER && P->alive && canPunch(G, e) && meleeTarget(G, e) == P) {   // in reach and facing: the punch, by difficulty
    float p = AI_PUNCH.chance[G->diff];
    if (P->shutdown || rngChance(r, 1 - powf(1 - p, dt))) meleePress(G, e);
  }
  if (e->melee.on) { e->beamOn = 0; return; }
  if (!seen) { a->lockT = 0; return; }
  decideFire(G, e, P, dist, toYaw, dt);
}
