#include "sim/game.h"
// Lasers: continuous beams whose damage climbs while they stay on target. The
// ramp lives in the target (its armour melts), shared by every beam on it.
const float MELT_T = 3, MELT_MAX = 3.5f, MELT_COOL = 1.5f, BEAM_CONTACT_GAP = 0.6f;
float meltMult(float t) { float u = minf(1, t / MELT_T); return 1 + (MELT_MAX - 1) * (u * u * (3 - 2 * u)); }
float beamMult(const Mech *m) { return m->beamMech ? meltMult(m->beamMech->melt) : 1; }

static void drawBeam(Game *G, v3 a, v3 b, const WeaponDef *def, float mult) {
  if (G->nCBeams >= MAX_CBEAMS) return;
  float k = (mult - 1) / (MELT_MAX - 1);
  float stut = def->stutter && sinf(G->time * TAU * def->stutter) < 0 ? 0.35f : 1;
  CBeam *c = &G->cbeams[G->nCBeams++]; c->a = a; c->b = b;
  float t = 0.2f + 0.45f * k;
  for (int i = 0; i < 3; i++) c->col[i] = lerpf(def->col[i], 1, t);
  c->w = def->w * (0.8f + 0.9f * k) * rngRange(&G->rng, 0.85f, 1.15f) * stut;
}
// A flamer draws no line: a cone of fire puffs from the muzzle.
static void flameCone(Game *G, v3 a, v3 b, const WeaponDef *def) {
  Rng *r = &G->rng; v3 d = vsub(b, a); float life = 0.22f;
  for (int i = 0; i < 3; i++) {
    v3 v = vadd(vmul(d, rngRange(r, 0.75f, 1.05f) / life), V3(rngRange(r, -9, 9), rngRange(r, -3, 7), rngRange(r, -9, 9)));
    float t = rngNext(r), col[3] = { lerpf(def->col[0], 1, t), lerpf(def->col[1], 0.9f, t), lerpf(def->col[2], 0.4f, t) };
    particle(G, vadd(a, vmul(d, rngRange(r, 0, 0.15f))), v, life, rngRange(r, 0.45f, 0.8f), col, PK_FLAME, 0, 0);
  }
}
void toast(Game *G, Mech *t, float amt) { t->heat += amt; }
static void beamSound(Game *G, Mech *m, const v3 *at) {
  int plain = 0, small = 1, done[8] = { 0 };
  for (int i = 0; i < m->nW; i++) {
    Weapon *w = &m->w[i]; if (w->def->kind != WK_BEAM || w->dead) continue;
    if (w->def->sfx == SFX_K_TOASTER) { if (!done[1]) { done[1] = 1; G->fx.sfx(G->fx.ud, SFX_TOASTER, at, 0, 0); } }
    else { plain = 1; if (w->def->tons >= 5) small = 0; }
  }
  if (plain) G->fx.sfx(G->fx.ud, SFX_LASER, at, small, 0);
}
void beamTick(Game *G, Mech *m, float dt, v3 aim) {
  Rng *r = &G->rng; int any = 0;
  for (int i = 0; i < m->nW; i++) if (m->w[i].def->kind == WK_BEAM && !m->w[i].dead) any = 1;
  if (!any || m->shutdown || !m->alive) { m->beaming = 0; m->beamMech = NULL; return; }
  if (!m->beaming) { v3 mz = muzzleOf(m, &m->w[0]); beamSound(G, m, m == G->player ? NULL : &mz); }
  m->beaming = 1; m->beamEnd = aim; m->beamMech = NULL;
  for (int i = 0; i < m->nW; i++) {
    Weapon *w = &m->w[i]; if (w->def->kind != WK_BEAM || w->dead) continue;
    v3 mz = muzzleOf(m, w), dir = vnorm(vsub(aim, mz));
    Hit hit = rayHit(G, mz, dir, w->def->range, m);
    v3 end = hit.ok ? hit.point : vadd(mz, vmul(dir, w->def->range));
    Mech *t = hit.ok ? hit.mech : NULL; float mult = t ? meltMult(t->melt) : 1;
    if (w->def->cone) flameCone(G, mz, end, w->def); else drawBeam(G, mz, end, w->def, mult);
    m->heat += w->def->hps * dt;
    if (m == G->player) G->stats.shots += (int)(dt * 4);
    if (!hit.ok) continue;
    if (rngChance(r, dt * 25)) particle(G, end, V3(rngRange(r, -3, 3), rngRange(r, 1, 5), rngRange(r, -3, 3)), 0.25f, 0.3f + 0.1f * mult, w->def->col, PK_FIRE, 0, 0);
    if (t) {
      m->beamMech = t;
      damage(G, t, end, w->def->dps * mult * dt, m, 1, 0);
      if (w->def->targetHeat) toast(G, t, w->def->targetHeat * dt);
      float rate = w->def->meltRate ? w->def->meltRate : 1;   // melt rises once per frame however many beams
      if (t->meltFrame != G->frame) { t->meltFrame = G->frame; t->meltRate = rate; t->melt = minf(MELT_T, t->melt + dt * rate); }
      else if (rate > t->meltRate) { t->melt = minf(MELT_T, t->melt + dt * (rate - t->meltRate)); t->meltRate = rate; }
      t->meltAt = G->time;
    }
  }
}
// Armour cools whenever no beam touched it this frame.
void coolArmour(Game *G, float dt) { for (int i = 0; i < G->nMechs; i++) { Mech *m = &G->mechs[i]; if (m->melt > 0 && m->meltAt != G->time) m->melt = maxf(0, m->melt - MELT_COOL * dt); } }
