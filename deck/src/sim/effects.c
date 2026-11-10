#include "sim/game.h"
#include <string.h>
#include <stdio.h>

void msg(Game *G, const char *text, int warn) {
  if (G->nMsgs >= MAX_MSGS) { memmove(&G->msgs[0], &G->msgs[1], sizeof(Msg) * (MAX_MSGS - 1)); G->nMsgs = MAX_MSGS - 1; }
  Msg *m = &G->msgs[G->nMsgs++]; snprintf(m->text, sizeof m->text, "%s", text); m->t = 3.5f; m->warn = warn;
}
// One particle into the pool. Past the cap the oldest goes.
void particle(Game *G, v3 p, v3 v, float life, float size, const float col[3], int kind, float grav, float spin) {
  Particles *P = &G->parts; int i;
  if (P->n < MAX_PARTS) i = P->n++;
  else { i = 0; float oldest = 1e9f; for (int k = 0; k < P->n; k += 7) if (P->life[k] < oldest) { oldest = P->life[k]; i = k; } }
  P->p[i] = p; P->v[i] = v; P->life[i] = life; P->life0[i] = life; P->size[i] = size; P->kind[i] = (unsigned char)kind; P->grav[i] = grav; P->spin[i] = spin;
  P->col[i][0] = col[0]; P->col[i][1] = col[1]; P->col[i][2] = col[2];
}
void stepParticles(Game *G, float dt) {
  Particles *P = &G->parts;
  for (int i = 0; i < P->n; ) {
    P->life[i] -= dt;
    if (P->life[i] <= 0) { int l = --P->n; if (i != l) { P->p[i] = P->p[l]; P->v[i] = P->v[l]; P->life[i] = P->life[l]; P->life0[i] = P->life0[l]; P->size[i] = P->size[l]; P->kind[i] = P->kind[l]; P->grav[i] = P->grav[l]; P->spin[i] = P->spin[l]; memcpy(P->col[i], P->col[l], sizeof P->col[i]); } continue; }
    int k = P->kind[i];
    if (k == PK_SMOKE || k == PK_DUST) { P->v[i] = vmul(P->v[i], maxf(0, 1 - 1.5f * dt)); P->v[i].y += 1.2f * dt; P->size[i] += dt * (k == PK_SMOKE ? 1.1f : 0.6f); }
    else if (k == PK_FIRE || k == PK_FLAME) { P->v[i] = vmul(P->v[i], maxf(0, 1 - 2.5f * dt)); P->v[i].y += 2 * dt; }
    else if (k == PK_SPARK || k == PK_DEBRIS) {
      P->v[i].y -= P->grav[i] * dt;
      float g = terHeight(&G->ter, P->p[i].x, P->p[i].z);
      if (P->p[i].y < g + 0.2f && P->v[i].y < 0) { P->p[i].y = g + 0.2f; P->v[i] = V3(P->v[i].x * 0.4f, -P->v[i].y * 0.3f, P->v[i].z * 0.4f); }
    }
    P->p[i] = vadd(P->p[i], vmul(P->v[i], dt));
    i++;
  }
}
// A piece of a mech that fell off: it tumbles, bounces once, and lies there.
void shedPart(Game *G, Mech *m, int part, v3 p, v3 v) {
  Rng *r = &G->rng;
  if (G->nDebris >= MAX_DEBRIS) { memmove(&G->debris[0], &G->debris[1], sizeof(Debris) * (MAX_DEBRIS - 1)); G->nDebris = MAX_DEBRIS - 1; }
  Debris *d = &G->debris[G->nDebris++];
  d->part = part; d->chassis = m->type; d->scale = m->ch->scale; d->p = p; d->v = v;
  d->rot = V3(rngRange(r, 0, 6.28f), m->yaw, rngRange(r, 0, 6.28f)); d->spin = V3(rngRange(r, -6, 6), rngRange(r, -3, 3), rngRange(r, -6, 6));
  d->landed = 0; d->bounced = 0; d->t = 0; d->life = 20;
}
void stepDebris(Game *G, float dt) {
  for (int i = 0; i < G->nDebris; ) {
    Debris *d = &G->debris[i];
    d->t += dt;
    if (!d->landed) {
      d->v.y -= 18 * dt;
      d->p = vadd(d->p, vmul(d->v, dt)); d->rot = vadd(d->rot, vmul(d->spin, dt));
      float g = terHeight(&G->ter, d->p.x, d->p.z) + 0.4f * d->scale;
      if (d->p.y <= g) {
        d->p.y = g;
        if (!d->bounced && -d->v.y > 3) { d->bounced = 1; d->v = V3(d->v.x * 0.5f, -d->v.y * 0.3f, d->v.z * 0.5f); d->spin = vmul(d->spin, 0.4f); }
        else { d->landed = 1; d->v = V3(0, 0, 0); d->spin = V3(0, 0, 0); }
      }
    } else if (d->t > d->life - 2) d->p.y -= dt * 0.9f * d->scale;   // sinks away over its last two seconds
    if (d->t >= d->life) { G->debris[i] = G->debris[--G->nDebris]; continue; }
    i++;
  }
}
// Section-specific hit effects: sparks fan off the armour away from the blow; a leg hit kicks
// dust up at the feet; a torso hit leaves smoke; a big blow knocks a plate loose.
const float PLATE_DMG = 6;
void hitSparks(Game *G, Mech *m, v3 p, int sec, float amt) {
  Rng *r = &G->rng; float k = clampf(amt / 10, 0.3f, 2), s = m->ch->scale;
  v3 n = vnorm(vsub(p, V3(m->x, p.y, m->z)));
  if (!(vlen(n) > 0.5f)) n = V3(0, 0, 1);
  int leg = sec == SEC_LL || sec == SEC_RL, torso = sec == SEC_T;
  int sparks = (int)((leg ? 4 : torso ? 6 : 8) * k + 0.5f);
  for (int i = 0; i < sparks; i++) {
    float col[3] = { 1, rngRange(r, 0.7f, 0.95f), 0.3f };
    particle(G, p, vadd(vmul(n, rngRange(r, 4, 12)), V3(rngRange(r, -3, 3), rngRange(r, 1, 6), rngRange(r, -3, 3))), rngRange(r, 0.15f, 0.4f), rngRange(r, 0.2f, 0.45f), col, PK_SPARK, 20, 0);
  }
  float dust[3] = { G->pal.shade[0] * 0.8f * PALS[G->biome].low[0], G->pal.shade[1] * 0.8f * PALS[G->biome].low[1], G->pal.shade[2] * 0.8f * PALS[G->biome].low[2] };
  if (leg) for (int i = 0; i < (int)(4 * k + 0.5f); i++)
    particle(G, V3(m->x + rngRange(r, -1.5f, 1.5f) * s, m->y + 0.3f, m->z + rngRange(r, -1.5f, 1.5f) * s), V3(rngRange(r, -2, 2), rngRange(r, 1, 3), rngRange(r, -2, 2)), rngRange(r, 0.5f, 0.9f), rngRange(r, 0.6f, 1.2f) * s, dust, PK_SMOKE, 0, 0);
  float smoke[3] = { 0.25f, 0.23f, 0.22f };
  if (torso) for (int i = 0; i < (int)(2 * k + 0.5f); i++)
    particle(G, vadd(p, vmul(n, 0.5f)), vadd(vmul(n, 1.5f), V3(rngRange(r, -0.5f, 0.5f), rngRange(r, 1.5f, 3), rngRange(r, -0.5f, 0.5f))), rngRange(r, 1, 1.8f), rngRange(r, 0.8f, 1.4f), smoke, PK_SMOKE, 0, 0);
  if (amt >= PLATE_DMG) for (int i = 0, nP = amt >= PLATE_DMG * 2 ? 2 : 1; i < nP; i++)
    shedPart(G, m, PART_PLATE, vadd(p, vmul(n, 0.3f)), vadd(vmul(n, rngRange(r, 3, 7)), V3(rngRange(r, -2, 2), rngRange(r, 3, 7), rngRange(r, -2, 2))));
}
void scorch(Game *G, float x, float z, float r, float y) {
  if (r < 3) return;   // small blasts leave no mark: a volley of ten would tile the ground
  for (int i = 0; i < G->nScorch; i++) { Scorch *s = &G->scorch[i]; if (s->r >= r * 0.8f && hypot2(s->x - x, s->z - z) < s->r * 1.2f) return; }
  Scorch *s = &G->scorch[G->scorchAt]; G->scorchAt = (G->scorchAt + 1) % MAX_SCORCH; if (G->nScorch < MAX_SCORCH) G->nScorch++;
  s->x = x; s->z = z; s->r = r; s->y = y;
}
// A blast: a shockwave ring on the ground if it is near, fire, smoke, debris, the thump by distance.
void explode(Game *G, v3 p, int big) {
  Rng *r = &G->rng; int n = big ? 34 : 10; float s = big ? 1.6f : 0.7f;
  float gy = terHeight(&G->ter, p.x, p.z);
  if (p.y - gy < 10) {
    float ring[3] = { 0.95f, 0.86f, 0.66f };
    particle(G, V3(p.x, gy + 0.3f, p.z), V3(0, 0, 0), 0.4f, big ? 26 : 9, ring, PK_SHOCK, 0, 0);
    scorch(G, p.x, p.z, big ? 4.5f : 1.8f, gy);
  }
  for (int i = 0; i < n; i++) {
    float col[3] = { 1, rngRange(r, 0.45f, 0.9f), 0.1f };
    v3 v = vmul(vnorm(V3(rngRange(r, -1, 1), rngRange(r, -0.2f, 1), rngRange(r, -1, 1))), rngRange(r, 3, 14) * s);
    particle(G, p, v, rngRange(r, 0.35f, 0.9f), rngRange(r, 0.6f, 1.6f) * s, col, PK_FIRE, 0, 0);
  }
  float smoke[3] = { 0.25f, 0.23f, 0.22f }, dark[3] = { 0.2f, 0.2f, 0.2f };
  for (int i = 0; i < n / 2; i++) particle(G, vadd(p, V3(rngRange(r, -2, 2), rngRange(r, 0, 2), rngRange(r, -2, 2))), V3(rngRange(r, -1, 1), rngRange(r, 2, 5), rngRange(r, -1, 1)), rngRange(r, 1.5f, 3), rngRange(r, 1, 2.4f) * s, smoke, PK_SMOKE, 0, 0);
  if (big) for (int i = 0; i < 12; i++) particle(G, p, V3(rngRange(r, -9, 9), rngRange(r, 8, 20), rngRange(r, -9, 9)), rngRange(r, 1.5f, 2.6f), rngRange(r, 0.4f, 1.1f), dark, PK_DEBRIS, 26, 0);
  float d = vlen(vsub(p, G->eye));
  feel(G, FE_EXPLOSION, G->player, (big ? 1 : 0.35f) * clampf(1 - d / 220, 0, 1), 0, NULL, &p);
  G->fx.sfx(G->fx.ud, SFX_BOOM, &p, big, 0);
}
