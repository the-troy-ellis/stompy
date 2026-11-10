#include "sim/game.h"
// The fusion cannon (OOPS BUTTON): scan the resonant frequency, then dump the reactor into it.
static Weapon *fusionWeapon(Mech *m) { for (int i = 0; i < m->nW; i++) if (m->w[i].def->kind == WK_FUSION && !m->w[i].dead) return &m->w[i]; return NULL; }
// The mech the laser passes closest to, within its radius + slack, with nothing in the way.
static Mech *nearMiss(Game *G, Mech *m, v3 mz, v3 dir, const WeaponDef *d) {
  Mech *best = NULL; float bestD = 1e30f;
  for (int i = 0; i < G->nMechs; i++) {
    Mech *t = &G->mechs[i];
    if (!t->alive || t == m) continue;
    v3 c = centerOf(t), v = vsub(c, mz); float along = vdot(v, dir);
    if (along < 0 || along > d->range) continue;
    float miss = vlen(vsub(v, vmul(dir, along))), lim = t->geo->radius * t->ch->scale + d->slack;
    if (miss > lim || miss >= bestD) continue;
    if (rayTerrainG(G, mz, vnorm(v), vlen(v) - 1) >= 0) continue;
    best = t; bestD = miss;
  }
  return best;
}
void fusionTick(Game *G, Mech *m, float dt, int on) {
  Weapon *w = fusionWeapon(m); Rng *r = &G->rng;
  if (!on || !w || w->cd > 0 || m->shutdown || !m->alive) {
    m->fusion.on = 0; m->fusion.t = 0; m->fusion.mech = NULL;
    if (m == G->player) G->fx.fusionSound(G->fx.ud, 0, 0);
    return;
  }
  m->fusion.on = 1;
  const WeaponDef *d = w->def; v3 mz = muzzleOf(m, w), dir = vnorm(vsub(G->aim, mz));
  Hit hit = rayHit(G, mz, dir, d->range, m);
  Mech *tgt = hit.ok && hit.mech ? hit.mech : nearMiss(G, m, mz, dir, d);
  v3 end = tgt ? centerOf(tgt) : hit.ok ? hit.point : vadd(mz, vmul(dir, d->range));
  m->fusion.end = end;
  m->heat += d->scanHeat * dt;
  if (G->nCBeams < MAX_CBEAMS) { CBeam *c = &G->cbeams[G->nCBeams++]; c->a = mz; c->b = end; c->col[0] = d->col[0]; c->col[1] = d->col[1]; c->col[2] = d->col[2]; c->w = 0.05f + 0.035f * fabsf(sinf(G->time * 37)); }
  // The scan counts on one mech. A slip shorter than `grace` pauses it; longer, or onto another mech, and it starts over.
  if (tgt && tgt == m->fusion.mech) { m->fusion.t += dt; m->fusion.off = 0; }
  else if (m->fusion.mech && !tgt && (m->fusion.off += dt) < d->grace) { }
  else { m->fusion.mech = tgt; m->fusion.t = 0; m->fusion.off = 0; }
  m->fusion.slipping = m->fusion.mech && m->fusion.off > 0;
  if (m == G->player && m->fusion.mech && !m->fusion.slipping) {   // locked and on it: draw the torso gently toward the target
    v3 c = centerOf(m->fusion.mech), e = G->eye; float k = 1 - expf(-d->assist * dt);
    float wantTwist = wrapA(atan2f(c.x - e.x, c.z - e.z) - m->yaw), wantPitch = atan2f(c.y - e.y, hypot2(c.x - e.x, c.z - e.z));
    m->twist = clampf(m->twist + wrapA(wantTwist - m->twist) * k, -1.9f, 1.9f);
    m->pitch = clampf(m->pitch + (wantPitch - m->pitch) * k, -0.4f, 0.45f);
  }
  float p = m->fusion.mech ? minf(1, m->fusion.t / d->scan) : 0;
  if (m->fusion.mech && rngChance(r, dt * (20 + 60 * p))) particle(G, vadd(end, V3(rngRange(r, -1, 1), rngRange(r, -1, 1), rngRange(r, -1, 1))), V3(rngRange(r, -2, 2), rngRange(r, 0, 3), rngRange(r, -2, 2)), 0.3f, 0.3f, d->col, PK_FIRE, 0, 0);
  if (m == G->player) G->fx.fusionSound(G->fx.ud, 1, p);
  if (m->fusion.mech && m->fusion.t >= d->scan) fusionFire(G, m, w, mz, m->fusion.mech);
}
// Fire: launch the pulse down the beam, then the reactor pays for it: feedback into your own torso, a deep overload shutdown, a recharge.
void fusionFire(Game *G, Mech *m, Weapon *w, v3 mz, Mech *t) {
  const WeaponDef *d = w->def;
  launchPulse(G, mz, t, m);
  m->heat = d->overload; m->shutdown = 1; w->cd = d->cd;
  m->fusion.t = 0; m->fusion.mech = NULL; m->fusion.on = 0;
  feel(G, FE_FUSIONFIRE, m, 1, 0, NULL, m == G->player ? NULL : &mz);
  if (m == G->player) { G->fx.fusionSound(G->fx.ud, 0, 0); G->fx.sfx(G->fx.ud, SFX_FUSIONCRACK, NULL, 0, 0); G->fx.sfx(G->fx.ud, SFX_POWERDOWN, NULL, 0, 0); }
  float cost = m->max[SEC_T] * d->feedback;
  m->hp[SEC_T] -= cost;
  if (m == G->player) { G->stats.taken += cost; G->fx.sfx(G->fx.ud, SFX_CLANG, NULL, SEC_T, 0); }
  if (m->hp[SEC_T] <= 0) { m->hp[SEC_T] = 0; destroy(G, m, NULL); return; }
  if (m == G->player) G->fx.say(G->fx.ud, "Resonance discharge. Reactor overload. Torso damage.", 1, 0);
}
void launchPulse(Game *G, v3 a, Mech *target, Mech *shooter) {
  if (G->nPulses >= MAX_PULSES) return;
  Pulse *p = &G->pulses[G->nPulses++]; v3 end = centerOf(target);
  p->a = a; p->b = end; p->target = target; p->shooter = shooter; p->t = 0; p->dur = maxf(0.2f, vlen(vsub(end, a)) / WEAPONS[W_FUSION].pulseSpeed); p->hit = 0; p->seed = rngNext(&G->rng) * 100;
}
void updatePulses(Game *G, float dt) {
  Rng *r = &G->rng;
  for (int i = 0; i < G->nPulses; i++) {
    Pulse *pu = &G->pulses[i]; pu->t += dt;
    if (pu->target && pu->target->alive) pu->b = centerOf(pu->target);
    if (pu->hit || pu->t < pu->dur) continue;
    pu->hit = 1;
    explode(G, pu->b, 1); explode(G, vadd(pu->b, V3(0, 3, 0)), 1);
    float col[3] = { 0.95f, 0.85f, 1 };
    for (int k = 0; k < 14; k++) particle(G, vadd(pu->b, V3(rngRange(r, -2, 2), rngRange(r, -3, 3), rngRange(r, -2, 2))), V3(rngRange(r, -16, 16), rngRange(r, 4, 20), rngRange(r, -16, 16)), rngRange(r, 0.5f, 1.1f), rngRange(r, 0.8f, 2.2f), col, PK_FIRE, 0, 0);
    G->fx.sfx(G->fx.ud, SFX_FUSION, &pu->b, 0, 0);
    if (!pu->target || !pu->target->alive) continue;
    pu->target->hp[SEC_T] = 0; destroy(G, pu->target, pu->shooter);   // resonance: the whole frame shakes itself apart
  }
  for (int i = 0; i < G->nPulses; ) { if (G->pulses[i].t >= G->pulses[i].dur + 0.25f) G->pulses[i] = G->pulses[--G->nPulses]; else i++; }
}
