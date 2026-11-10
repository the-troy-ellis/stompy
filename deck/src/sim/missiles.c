#include "sim/game.h"
// Missiles: tap to fire, hold to fly them, let go to detonate.
const float HOLD_TO_GUIDE = 0.22f, BLAST_R = 10;

void missileTrigger(Game *G, int down) {
  if (down && !G->mDown) { G->mDown = 1; G->mAt = G->time; G->mVid = fireCat(G, CAT_MISSILE) ? G->lastVolley : 0; }
  else if (down) { if (!G->guide.on && G->mVid && G->time - G->mAt >= HOLD_TO_GUIDE) startGuide(G, G->mVid); }
  else if (G->mDown) { G->mDown = 0; if (G->guide.on) endGuide(G, 1); }
}
static int guidedLive(Game *G, int vid, Shot **out, int max) {
  int n = 0;
  for (int i = 0; i < G->nShots && n < max; i++) { Shot *s = &G->shots[i]; if (s->vid == vid && s->owner == G->player && s->life > 0) out[n++] = s; }
  return n;
}
static v3 centroid(Shot **l, int n) { v3 c = V3(0, 0, 0); for (int i = 0; i < n; i++) c = vadd(c, l[i]->p); return vmul(c, 1.f / n); }
void startGuide(Game *G, int vid) {
  Shot *ms[32]; int n = guidedLive(G, vid, ms, 32);
  if (!n) return;
  v3 d = vnorm(ms[0]->v);
  G->guide.on = 1; G->guide.vid = vid; G->guide.yaw = atan2f(d.x, d.z); G->guide.pitch = asinf(clampf(d.y, -1, 1)); G->guide.dir = d; G->guide.pos = centroid(ms, n); G->guide.lost = 0; G->guide.n = n; G->guide.nose = G->guide.pos;
  for (int i = 0; i < n; i++) { ms[i]->guided = 1; ms[i]->target = NULL; ms[i]->life = maxf(ms[i]->life, 9); }
  G->zoom = 0;
  G->fx.sfx(G->fx.ud, SFX_BEEP, NULL, 0, 0);
}
// Each frame while flying: aim follows input, camera rides in the nose of the missile in front.
void steerVolley(Game *G, float dt) {
  G->guide.dir = dirOf(G->guide.yaw, G->guide.pitch);
  Shot *ms[32]; int n = guidedLive(G, G->guide.vid, ms, 32);
  G->guide.n = n;
  if (n) {
    G->guide.pos = centroid(ms, n); G->guide.fuel = 0; Shot *front = ms[0]; float best = -1e30f;
    for (int i = 0; i < n; i++) { G->guide.fuel = maxf(G->guide.fuel, ms[i]->life); float a = vdot(vsub(ms[i]->p, G->guide.pos), G->guide.dir); if (a > best) { best = a; front = ms[i]; } }
    G->guide.nose = front->p;
  } else if ((G->guide.lost += dt) > 0.6f) endGuide(G, 0);   // all hit something: signal lost, then home
}
void endGuide(Game *G, int detonate) {
  if (!G->guide.on) return;
  if (detonate) { Shot *ms[32]; int n = guidedLive(G, G->guide.vid, ms, 32); for (int i = 0; i < n; i++) { ms[i]->life = -1; blast(G, ms[i]->p, ms[i]->dmg, ms[i]->owner, NULL); explode(G, ms[i]->p, 0); } }
  G->guide.on = 0;
}
// Splash: anything within BLAST_R takes damage falling off with distance, on the side facing the blast.
void blast(Game *G, v3 p, float dmg, Mech *owner, Mech *direct) {
  for (int i = 0; i < G->nMechs; i++) {
    Mech *m = &G->mechs[i];
    if (!m->alive || m == owner || m == direct) continue;
    float R = m->geo->radius * m->ch->scale, top = m->y + m->geo->height * m->ch->scale;
    float hx = p.x - m->x, hz = p.z - m->z, hd = hypot2(hx, hz);
    float dy = p.y < m->y ? m->y - p.y : p.y > top ? p.y - top : 0, d = hypot2(maxf(0, hd - R), dy);
    if (d >= BLAST_R) continue;
    float nx = hd > 0.01f ? hx / hd : 1, nz = hd > 0.01f ? hz / hd : 0;
    v3 at = V3(m->x + nx * R, clampf(p.y, m->y + 1, top - 1), m->z + nz * R);
    damage(G, m, at, dmg * 0.8f * (1 - d / BLAST_R), owner, 0, 0);
    if (m->alive) { float dir[2] = { -nx, -nz }; knock(G, m, owner, FEEL[FE_BLAST].push * (1 - d / BLAST_R), dir, 0); }
  }
}
// Fire every weapon of one kind that is ready; held, each refires as it recharges.
int fireCat(Game *G, int cat) {
  Mech *P = G->player; int any = 0;
  for (int i = 0; i < P->nW; i++) if (P->w[i].def->cat == cat) any = fire(G, P, &P->w[i], G->aim, G->lock ? G->target : NULL) || any;
  return any;
}
void cycleTarget(Game *G) {
  Mech *foes[MAX_MECHS]; int n = 0;
  for (int i = 0; i < G->nMechs; i++) { Mech *m = &G->mechs[i]; if (m->alive && m->team != 0) foes[n++] = m; }
  if (!n) return;
  for (int i = 1; i < n; i++) for (int j = i; j > 0; j--) {   // nearest first
    float a = hypot2(foes[j]->x - G->player->x, foes[j]->z - G->player->z), b = hypot2(foes[j - 1]->x - G->player->x, foes[j - 1]->z - G->player->z);
    if (a < b) { Mech *t = foes[j]; foes[j] = foes[j - 1]; foes[j - 1] = t; } else break;
  }
  int at = -1; for (int i = 0; i < n; i++) if (foes[i] == G->target) at = i;
  G->target = foes[(at + 1) % n];
  G->fx.sfx(G->fx.ud, SFX_BEEP, NULL, 0, 0);
}
