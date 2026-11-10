#include "render/scene.h"
#include "render/mesh.h"
#include "sim/game.h"
#include <stdlib.h>
#include <string.h>

struct Scene {
  MechParts parts[CH_N]; int built[CH_N]; Mesh wreck[CH_N]; Mesh fx[FX_N]; Mesh sky; Mesh ground[TER_CHUNKS * TER_CHUNKS]; v3 chunkC[TER_CHUNKS * TER_CHUNKS]; int worldSeed, worldBiome;
  InstBuf inst; float *instData; v3 camRight, camUp; float jitter;
};
Scene *sceneInit(void) {
  Scene *s = calloc(1, sizeof *s);
  for (int k = 0; k < FX_N; k++) s->fx[k] = buildEffectShape(k);
  s->sky = buildSky(); s->inst = glrInstBuf(MAX_PARTS); s->instData = malloc(sizeof(float) * 20 * (MAX_PARTS + 64)); s->worldSeed = -1;
  return s;
}
static MechParts *partsOf(Scene *s, int ch) { if (!s->built[ch]) { s->parts[ch] = buildMechParts(ch); s->wreck[ch] = buildWreck(ch); s->built[ch] = 1; } return &s->parts[ch]; }
void sceneLoadWorld(Scene *s, const Game *G) {
  if (s->worldSeed == G->ter.seed && s->worldBiome == G->biome) return;
  s->worldSeed = G->ter.seed; s->worldBiome = G->biome;
  for (int cz = 0; cz < TER_CHUNKS; cz++) for (int cx = 0; cx < TER_CHUNKS; cx++) {
    int i = cz * TER_CHUNKS + cx; glrFree(&s->ground[i]); s->ground[i] = buildTerrainChunk(&G->ter, cx, cz, &PALS[G->biome]);
    float w = G->ter.hx * 2 / TER_CHUNKS; s->chunkC[i] = V3(-G->ter.hx + (cx + 0.5f) * w, 60, -G->ter.hz + (cz + 0.5f) * w);
  }
}
static m4 instMat(v3 p, float yaw, float tumble, float size) { return m4mul(m4mul(m4mul(m4T(p.x, p.y, p.z), m4RY(yaw)), m4RX(tumble)), m4S(size, size, size)); }
// A box from `a` to `b`, `w` across: the beams and the tracers.
static m4 beamMat(v3 a, v3 b, float w) {
  v3 d = vsub(b, a), up = fabsf(d.y) < 0.9f * vlen(d) ? V3(0, 1, 0) : V3(1, 0, 0), x = vnorm(vcross(d, up)), z = vnorm(vcross(x, d));
  m4 m = {{ x.x * w, x.y * w, x.z * w, 0, d.x, d.y, d.z, 0, z.x * w, z.y * w, z.z * w, 0, a.x, a.y, a.z, 1 }}; return m;
}
static void drawLimb(Scene *s, Mesh *mesh, v3 P, v3 Q, v3 pole, float sc) { m4 m = m4limb(P, Q, pole, sc); glrDraw(mesh, &m); }

// One mech: the hull on its springs, the torso on top, the arms, and the legs by IK from the feet.
static void drawMech(Scene *s, const Game *G, const Mech *m, int armsOnly) {
  MechParts *P = partsOf(s, m->type); const Geo *g = m->geo; float sc = m->ch->scale;
  float sag = m->sag.x, tp = m->tiltP.x, tr = m->tiltR.x;
  m4 B;
  if (m->isDying) {   // the legs buckle and the body topples about the ground under it
    float f = m->dying.fallYaw;
    B = m4mul(m4mul(m4mul(m4mul(m4mul(m4T(m->x, m->y, m->z), m4RY(f)), m4RX(m->dying.angle)), m4RY(-f)), m4T(0, -m->dying.drop + m->bob, 0)), m4mul(m4RY(m->yaw), m4S(sc, sc, sc)));
  } else B = m4mul(m4mul(m4mul(m4mul(m4mul(m4T(m->x, m->y + m->bob - sag, m->z), m4RY(m->yaw)), m4S(sc, sc, sc)), m4RX(tp)), m4RZ(m->lean + tr)), m4T(m->sway, 0, m->surge));
  float sq = m->squash.x + m->jet.charge * 0.14f, wp = m->wobP.x, wr = m->wobR.x, mLean, mArm, mLunge; meleePose(m, &mLean, &mArm, &mLunge);
  m4 TB = m4mul(m4mul(m4mul(m4mul(m4mul(m4mul(B, m4T(0, g->torsoY + m->torsoDrop, 0)), m4S(1 + sq * 0.5f, 1 - sq, 1 + sq * 0.5f)), m4RY(m->twist)), m4T(0, 0, mLunge)), m4RX(wp - mLean + m->torsoNod + m->runLean)), m4RZ(wr));
  if (!armsOnly) {
    m4 H = m4mul(m4mul(B, m4T(0, g->hip, 0)), m4RY(m->hipYaw)); glrDraw(&P->hip, &H);
    glrDraw(&P->torso, &TB);
  }
  for (int side = 0; side < 2; side++) {   // arms: left (+x) and right
    int sec = side ? SEC_RA : SEC_LA; if (m->hp[sec] <= 0 && !m->isDying) continue;
    float sx = side ? -1 : 1; int swinging = m->melee.on && (m->melee.arm == sec || (m->melee.arm < 0));
    m4 A = m4mul(m4mul(TB, m4T(sx * g->armX, g->armY, 0)), m4RX(-m->pitch + (swinging ? mArm : 0)));
    if (armsOnly) A = m4mul(m4mul(m4mul(TB, m4T(sx * 2.4f, g->eye[1] - 0.9f, g->eye[2] + 1.9f)), m4RX(-1.25f - m->pitch * 0.5f + (swinging ? mArm : 0))), m4S(0.55f, 0.55f, 0.55f));   // the cockpit's shoulders: drawn in and forward of the eye
    glrDraw(&P->arm, &A);
    if (P->hasFist) glrDraw(&P->fist, &A);
    int gun = 0; for (int i = 0; i < m->nW; i++) if (m->w[i].mount == sec && !m->w[i].dead) gun = 1;
    if (P->hasBarrel && gun) glrDraw(&P->barrel, &A);
  }
  if (armsOnly) return;
  float c = cosf(m->yaw), sn = sinf(m->yaw);
  for (int i = 0; i < g->nLegs; i++) {
    const LegPlan *l = &g->legs[i]; int sec = l->hx > 0 ? SEC_LL : SEC_RL; if (m->hp[sec] <= 0 && !m->isDying) continue;
    v3 Hp = m4apply(&B, V3(l->hx, g->hip, l->hz));
    v3 A = vadd(m->feet[i].pos, V3(0, g->ankle * sc, 0));
    if (m->isDying) { v3 r = m4apply(&B, V3(l->fx, 0.2f, l->fz)); A = r; }
    v3 pole = g->knee == 1 ? V3(-sn, 0, -c) : g->knee == 2 ? vnorm(V3(c * l->hx + sn * l->hz, 0, -sn * l->hx + c * l->hz)) : V3(sn, 0, c);
    v3 K = solveKnee(Hp, A, pole, g->l1 * sc, g->l2 * sc);
    drawLimb(s, &P->uleg, Hp, K, pole, sc); drawLimb(s, &P->lleg, K, A, pole, sc);
    m4 F = m4mul(m4mul(m4T(A.x, A.y - g->ankle * sc + 0.2f * sc, A.z), m4RY(m->feet[i].yaw)), m4S(sc, sc, sc)); glrDraw(&P->foot, &F);
  }
  if (m->flash.frame >= G->frame - 1) {   // the muzzle flash, two frames, facing the camera's plane
    float k = m->flash.big ? 2.2f : 1.1f;
    m4 M = {{ s->camRight.x * k, s->camRight.y * k, s->camRight.z * k, 0, s->camUp.x * k, s->camUp.y * k, s->camUp.z * k, 0, 0, 0, 1, 0, m->flash.p.x, m->flash.p.y, m->flash.p.z, 1 }};
    static const float FL[3] = { 1, 0.9f, 0.5f }; glrMode(1); glrDrawCol(&s->fx[FX_STAR], &M, FL, 1); glrMode(0);
  }
}
static void drawParticles(Scene *s, const Game *G, const float fog[3]) {
  const Particles *P = &G->parts; static const int SHAPE[7] = { FX_CUBE, FX_TETRA, FX_SPARK, FX_CHUNK, FX_RING, FX_FLAT, FX_TETRA };
  for (int shape = 0; shape < FX_N; shape++) {
    int n = 0; float *d = s->instData; int emissive = shape == FX_TETRA || shape == FX_SPARK;
    for (int i = 0; i < P->n; i++) {
      int k = P->kind[i]; if (SHAPE[k] != shape || k == PK_SHOCK) continue;
      float age = 1 - P->life[i] / P->life0[i], size = P->size[i]; v3 p = P->p[i]; m4 M; float col[3];
      if (k == PK_SMOKE || k == PK_DUST) { float f = clampf((age - 0.5f) / 0.5f, 0, 1); for (int q = 0; q < 3; q++) col[q] = lerpf(P->col[i][q], fog[q], f * 0.8f); size *= age < 0.85f ? 1 : 1 - (age - 0.85f) / 0.15f; M = instMat(p, age * 1.5f + i, age * 0.8f, size); }
      else if (k == PK_FIRE || k == PK_FLAME) { float fl = 0.7f + 0.3f * sinf(G->time * 40 + i); col[0] = P->col[i][0]; col[1] = P->col[i][1] * fl; col[2] = P->col[i][2]; size *= 1 - age * 0.8f; M = instMat(p, i * 0.7f, age * 3, size); }
      else if (k == PK_SPARK) { memcpy(col, P->col[i], sizeof col); v3 b = vadd(p, vmul(P->v[i], 0.04f)); M = beamMat(p, b, size * 0.6f); }
      else { memcpy(col, P->col[i], sizeof col); M = instMat(p, age * 6 + i, age * 9, size * (age > 0.9f ? (1 - age) * 10 : 1)); }
      memcpy(d, M.m, 16 * sizeof(float)); d[16] = col[0]; d[17] = col[1]; d[18] = col[2]; d[19] = emissive ? 1 : (k == PK_SMOKE || k == PK_DUST ? 0.45f : 0); d += 20; n++;   // smoke and dust half glow, so they read in shadow
    }
    if (n) glrDrawInst(&s->fx[shape], &s->inst, s->instData, n);
  }
  // Shockwaves: flat rings that race out and dither away.
  glrMode(1);
  for (int i = 0; i < P->n; i++) {
    if (P->kind[i] != PK_SHOCK) continue;
    float age = 1 - P->life[i] / P->life0[i], r = P->size[i] * (0.15f + 0.85f * age);
    m4 M = m4mul(m4T(P->p[i].x, P->p[i].y, P->p[i].z), m4S(r, 1, r));
    glrDither(1 - age); glrDrawCol(&s->fx[FX_RING], &M, P->col[i], 1);
  }
  glrDither(1); glrMode(0);
}
static void drawDebris(Scene *s, const Game *G) {
  for (int i = 0; i < G->nDebris; i++) {
    const Debris *d = &G->debris[i]; MechParts *P = partsOf(s, d->chassis);
    Mesh *mesh = d->part == PART_ARM ? &P->arm : d->part == PART_ULEG ? &P->uleg : d->part == PART_LLEG ? &P->lleg : d->part == PART_FOOT ? &P->foot : &P->plate;
    m4 M = m4mul(m4mul(m4mul(m4mul(m4T(d->p.x, d->p.y, d->p.z), m4RY(d->rot.y)), m4RX(d->rot.x)), m4RZ(d->rot.z)), m4S(d->scale, d->scale, d->scale));
    glrDraw(mesh, &M);
  }
}
static void drawShots(Scene *s, const Game *G) {
  static const float GREY[3] = { 0.75f, 0.75f, 0.72f }, SHELL[3] = { 1, 0.75f, 0.35f };
  for (int i = 0; i < G->nShots; i++) {
    const Shot *sh = &G->shots[i]; const WeaponDef *d = &WEAPONS[sh->type]; v3 dir = vnorm(sh->v);
    if (sh->kind == WK_MISSILE) { m4 M = m4mul(m4limb(vadd(sh->p, vmul(dir, 0.7f)), vsub(sh->p, vmul(dir, 0.7f)), V3(0, 1, 0), 1), m4mul(m4RX(PI_F / 2), m4S(0.5f, 1, 0.5f))); glrDrawCol(&s->fx[FX_MISSILE], &M, GREY, 0); }
    else if (d->bolt) { m4 M = m4mul(m4T(sh->p.x, sh->p.y, sh->p.z), m4S(1.1f, 1.1f, 1.1f)); glrMode(1); glrDrawCol(&s->fx[FX_BOLT], &M, d->col, 1); glrMode(0); }
    else { float tl = d->tl ? d->tl : 2.5f, tw = d->tw ? d->tw : 0.3f; m4 M = beamMat(vsub(sh->p, vmul(dir, tl)), sh->p, tw); glrMode(1); glrDrawCol(&s->fx[FX_BEAM], &M, d->hasTracer ? d->tracer : SHELL, 1); glrMode(0); }
  }
  glrMode(1);
  for (int i = 0; i < G->nCBeams; i++) {   // your own beams leave from just past the cockpit's arms, thinner: a wedge at the eye would fill the screen
    const CBeam *b = &G->cbeams[i]; v3 a = b->a; float w = b->w;
    if (vlen(vsub(a, G->eye)) < 6) { v3 d = vsub(b->b, b->a); float l = vlen(d); if (l > 6) { a = vadd(a, vmul(d, 2.5f / l)); w *= 0.6f; } }
    m4 M = beamMat(a, b->b, w); glrDrawCol(&s->fx[FX_BEAM], &M, b->col, 1);
  }
  for (int i = 0; i < G->nPulses; i++) {   // the fusion pulse: a bright knot travelling the beam
    const Pulse *p = &G->pulses[i]; float u = clampf(p->t / p->dur, 0, 1); v3 at = vmix(p->a, p->b, u);
    static const float PC[3] = { 0.9f, 0.7f, 1 }; m4 M = m4mul(m4T(at.x, at.y, at.z), m4S(2.5f, 2.5f, 2.5f)); glrDrawCol(&s->fx[FX_BOLT], &M, PC, 1);
    m4 L = beamMat(p->a, p->b, 0.12f + 0.1f * sinf(p->seed + G->time * 50)); glrDrawCol(&s->fx[FX_BEAM], &L, WEAPONS[W_FUSION].col, 1);
  }
  glrMode(0);
}
static void drawWorld(Scene *s, const Game *G, v3 eye, float fogFar) {
  for (int i = 0; i < TER_CHUNKS * TER_CHUNKS; i++) {   // chunks past the fog are skipped
    float dx = maxf(0, fabsf(s->chunkC[i].x - eye.x) - G->ter.hx / TER_CHUNKS), dz = maxf(0, fabsf(s->chunkC[i].z - eye.z) - G->ter.hz / TER_CHUNKS);
    if (hypot2(dx, dz) > fogFar + 50) continue;
    m4 I = m4id(); glrDraw(&s->ground[i], &I);
  }
  const float *low = PALS[G->biome].low; float scorchCol[3] = { low[0] * 0.45f, low[1] * 0.42f, low[2] * 0.4f };   // the ground, darkened: a burn, not a hole
  for (int i = 0; i < G->nScorch; i++) { const Scorch *c = &G->scorch[i]; m4 M = m4mul(m4T(c->x, c->y + 0.12f, c->z), m4S(c->r, 1, c->r)); glrDrawCol(&s->fx[FX_DISC], &M, scorchCol, 0); }
  for (int i = 0; i < G->nWrecks; i++) {
    const Wreck *w = &G->wrecks[i]; partsOf(s, w->chassis);
    float sink = (1 - w->settle) * 0.8f;
    m4 M = m4mul(m4mul(m4mul(m4T(w->x, w->y - sink * 0.3f + 0.2f, w->z), m4RY(w->yaw)), m4RZ(w->roll * 0.5f + sinf(w->t * 9) * (1 - w->settle) * 0.1f)), m4S(w->scale, w->scale, w->scale));
    glrDraw(&s->wreck[w->chassis], &M);
  }
}
// The cockpit camera: the eye in the torso, dropped by the kick and the bob, jittered by the shake,
// turned by the wobble springs, swimming when hot, zoomed on Y, and riding a volley's nose when guiding.
static void cockpitCam(Scene *s, const Game *G, float fovDeg, v3 *eye, v3 *dir, v3 *up, float *fov) {
  const Mech *P = G->player;
  if (G->guide.on) { *fov = 0.95f; *dir = G->guide.dir; *eye = vadd(G->guide.nose, vadd(vmul(*dir, 1.5f), V3(0, 0.3f, 0))); *up = V3(0, 1, 0); return; }
  *fov = G->zoom ? 0.42f : fovDeg * PI_F / 180;
  float sh = G->shake * 0.012f, wv = FEEL_VIEW.wobble * (G->reducedMotion ? FEEL_VIEW.reducedScale : 1);
  s->jitter += 1; float jx = sinf(s->jitter * 12.9898f) * sh, jy = cosf(s->jitter * 78.233f) * sh;
  float yaw = viewYaw(P) + P->wobR.x * wv * 0.5f + jx, pitch = P->pitch + P->wobP.x * wv + jy + P->tiltP.x * FEEL_INERTIA.view, hot = P->shutdown ? 0 : hotFrac(P->heat);
  if (hot > 0) { *fov *= 1 + HEAT.fov * hot * sinf(G->time * 2.6f); yaw += HEAT.sway * hot * sinf(G->time * 1.9f); pitch += HEAT.sway * 0.6f * hot * cosf(G->time * 1.3f); }
  float drop = G->kick + (G->bobInit ? G->bob.x : 0), lurch = P->surge * P->ch->scale;
  v3 e = eyeOf(P);
  e = vadd(e, V3(sinf(P->yaw) * lurch, -drop * 0.35f - P->squash.x * 2 - P->jet.charge * 1.1f * P->ch->scale - P->sag.x, cosf(P->yaw) * lurch));
  float roll = P->wobR.x * wv * 0.6f + P->tiltR.x * 0.5f;
  if (P->fallen.on) { pitch -= P->fallen.angle * 0.9f; roll += P->fallen.roll * 0.8f; e.y -= P->fallen.drop + P->fallen.angle * 2; }
  else if (P->isDying) { pitch -= P->dying.angle * 0.9f; roll += P->dying.roll * 0.6f * P->dying.buckle; e.y -= P->dying.drop; }
  float g = terHeight(&G->ter, e.x, e.z) + 0.6f; if (e.y < g) e.y = g;
  *eye = e; *dir = dirOf(yaw, pitch - drop * 0.016f); *up = V3(sinf(roll) * cosf(yaw), cosf(roll), -sinf(roll) * sinf(yaw));
}
static void setup(Scene *s, const Game *G, v3 eye, v3 dir, v3 up, float fov, int w, int h, m4 *vp) {
  m4 proj = m4persp(fov, w / (float)h, 0.5f, 2000), view = m4lookAt(eye, vadd(eye, dir), up);
  *vp = m4mul(proj, view);
  s->camRight = vnorm(vcross(dir, up)); s->camUp = vnorm(vcross(s->camRight, dir));
  float fog[2]; fogOf(G, fog);
  glrBegin(w, h, G->pal.hor);
  glrSetCamera(vp, eye); glrSetLight(G->pal.light, G->pal.shade, G->pal.hor, fog[0], fog[1]);
  extern void glrSkyColours(const float zen[3], const float hor[3]); glrSkyColours(G->pal.zen, G->pal.hor);
  glrMode(2); glrDepth(0, 0); m4 I = m4id(); glrDraw(&s->sky, &I); glrDepth(1, 1); glrMode(0);
}
void sceneRender(Scene *s, const Game *G, const SceneOpts *o, m4 *vpOut) {
  v3 eye, dir, up; float fov;
  if (o->cam && o->cam->on) { eye = o->cam->eye; dir = vnorm(vsub(o->cam->at, o->cam->eye)); up = V3(0, 1, 0); fov = o->cam->fov; }
  else cockpitCam(s, G, o->fovDeg, &eye, &dir, &up, &fov);
  sceneLoadWorld(s, G);
  m4 vp; setup(s, G, eye, dir, up, fov, o->w, o->h, &vp); float fog[2]; fogOf(G, fog);
  drawWorld(s, G, eye, fog[1]);
  for (int i = 0; i < G->nMechs; i++) {
    const Mech *m = &G->mechs[i]; if (m->gone) continue;
    if (m == G->player && !(o->cam && o->cam->on)) { if (!G->guide.on && m->alive) drawMech(s, G, m, 1); continue; }
    if (hypot2(m->x - eye.x, m->z - eye.z) > fog[1] + 30) continue;
    drawMech(s, G, m, 0);
  }
  drawDebris(s, G);
  drawShots(s, G);
  const Mech *P = G->player;
  if (P->jet.hasAt && (P->jet.charge > 0 || P->jet.blasted)) {   // where this blast comes down: a ring on the ground, white on a stomp
    static const float RING[3] = { 0.5f, 1, 0.5f }, STOMP[3] = { 1, 1, 1 }; float r = P->geo->radius * P->ch->scale * 1.2f;
    m4 M = m4mul(m4T(P->jet.at.x, P->jet.at.y + 0.3f, P->jet.at.z), m4S(r, 1, r)); glrMode(1); glrDrawCol(&s->fx[FX_RING], &M, P->jet.on ? STOMP : RING, 1); glrMode(0);
  }
  drawParticles(s, G, G->pal.hor);
  if (vpOut) *vpOut = vp;
}
// The menu's turntable: the chassis on the desert, a camera circling it.
void sceneMenuMech(Scene *s, int chassis, float spin, const PalVariant *pal, int biome, int w, int h, m4 *vpOut, float yOffset) {
  (void)pal; (void)biome;
  static Game *MG; static int built, lastCh;
  if (!MG) { MG = calloc(1, sizeof *MG); }
  if (!built || lastCh != chassis) { gameInit(MG, NULL_FX, 5); startFreePlay(MG, PAL_DUSK, TIME_DUSK, WX_CLEAR, 0, 5, chassis, DIFF_NORMAL, 0); built = 1; lastCh = chassis; }
  MG->pal = *pal; MG->biome = biome;
  Input in = noInput(); update(MG, &in, 1.f / 60);
  Mech *m = MG->player; m->yaw = spin; m->twist = sinf(spin * 0.7f) * 0.3f;
  float R = 26 * m->ch->scale; v3 c = V3(m->x, m->y + 4.5f * m->ch->scale + yOffset, m->z);
  v3 eye = V3(c.x + sinf(0.6f) * R, c.y + 2.5f, c.z + cosf(0.6f) * R);
  sceneLoadWorld(s, MG);
  m4 vp; setup(s, MG, eye, vnorm(vsub(c, eye)), V3(0, 1, 0), 0.75f, w, h, &vp); float fog[2]; fogOf(MG, fog);
  drawWorld(s, MG, eye, fog[1]);
  drawMech(s, MG, m, 0);
  drawParticles(s, MG, MG->pal.hor);
  if (vpOut) *vpOut = vp;
}
