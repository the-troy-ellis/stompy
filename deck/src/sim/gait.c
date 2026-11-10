#include "sim/game.h"
// Legs: planted feet and two-bone IK. A planted foot stays exactly where it
// landed while the body moves over it; once the hip has passed it by half a
// stride it lifts, arcs, and lands half a stride ahead of where the body will
// be at touchdown. Feet never slide, and faster walking just means quicker
// steps. The gait clock is distance travelled, not time.

v3 restFoot(Game *G, const Mech *m, int i, float ahead) {
  float s = m->ch->scale; const LegPlan *leg = &m->geo->legs[i]; float c = cosf(m->yaw), sn = sinf(m->yaw);
  float lx = leg->fx * s, lz = leg->fz * s + ahead;
  float x = m->x + c * lx + sn * lz, z = m->z - sn * lx + c * lz;
  return V3(x, terHeight(&G->ter, x, z), z);
}
// A point in the cycle where no leg is mid-swing: 0.45 for the stock plans.
static float restCyc(const Geo *g) {
  for (int pass = 0; pass < 2; pass++) for (float c = pass ? 0 : 0.45f; c < 1; c += 0.005f) {
    int free = 1;
    for (int i = 0; i < g->nLegs; i++) { float u = fmodf(c - g->legs[i].ph + 2, 1); if (u < g->swing) free = 0; }
    if (free) return c + (pass ? 0.005f : 0);
    if (!pass) break;
  }
  return 0.45f;
}
static void stillBody(Mech *m) { m->torsoInit = 0; m->torsoDrop = 0; m->torsoNod = 0; m->pInit = 0; m->pAhead = 0; }
void initFeet(Game *G, Mech *m) {
  for (int i = 0; i < m->geo->nLegs; i++) { m->feet[i].pos = restFoot(G, m, i, 0); m->feet[i].lifted = 0; m->feet[i].yaw = m->yaw; }
  m->bob = 0; m->cyc = restCyc(m->geo); stillBody(m);
}
static v3 swingTarget(Game *G, const Mech *m, int i, float u, float D, float dir, float sw, float back) {
  return restFoot(G, m, i, dir * ((1 - u) * sw * D + ((1 - sw) / 2) * D - back));
}
float runOf(const Mech *m, float pace) {
  const Gait *gp = gaitOf(m); float t = clampf((pace - gp->runAt) / 0.2f, 0, 1);
  return m->maxSpeed >= gp->runMin ? t * t * (3 - 2 * t) : 0;
}
float swingNow(const Mech *m, float pace) { const Geo *g = m->geo; return lerpf(g->swing, maxf(g->swing, gaitOf(m)->runSwing), runOf(m, pace)); }
// How far a planted foot may sit ahead of or behind its rest spot before its leg is straight.
static float legRoom(const Geo *g, float s, float crouch) {
  float room = 1e9f, L = (g->l1 + g->l2) * 0.97f, dy = g->hip - crouch - g->ankle;
  for (int i = 0; i < g->nLegs; i++) {
    const LegPlan *l = &g->legs[i]; float dx = l->fx - l->hx, flat = L * L - dy * dy - dx * dx;
    if (flat <= 0) return 0;
    float r = sqrtf(flat), off = l->fz - l->hz;
    room = minf(room, minf(r - off, r + off));
  }
  return maxf(0, room) * s;
}
float strideOf(const Mech *m, float pace, float sw) {
  const Geo *g = m->geo; const Gait *gp = gaitOf(m); float s = m->ch->scale, top = m->maxSpeed;
  float reach = 2 * legRoom(g, s, gp->crouch * pace) / (1 - sw) * 0.85f;
  float cad = lerpf(gp->cadence, gp->runCadence ? gp->runCadence : gp->cadence, runOf(m, pace));
  float want = maxf(s * (g->stride[0] + g->stride[1]), (2 * top) / cad);
  float Dtop = maxf(s * g->stride[0], minf(want, reach));
  return s * g->stride[0] + (Dtop - s * g->stride[0]) * pace;
}
static int legOk(const Mech *m, int i) { return m->hp[m->geo->legs[i].hx > 0 ? SEC_LL : SEC_RL] > 0; }

// Touchdown: the sound, the cockpit jolt, a puff of dust.
static void footDown(Game *G, Mech *m, Foot *f, float pace) {
  Mech *P = G->player; Rng *r = &G->rng; float d = P ? hypot2(m->x - P->x, m->z - P->z) : 1e9f;
  m->stepAt = G->time;
  if (m->pInit) springKick(&m->hull, -gaitOf(m)->sink * m->ch->scale * (0.4f + 0.6f * pace));   // the weight comes down on the new foot
  feel(G, FE_STEP, m, (0.35f + 0.65f * pace) * m->ch->scale * m->ch->scale, 0, NULL, m == P ? NULL : &f->pos);
  if (m == P) G->fx.sfx(G->fx.ud, SFX_STEP, NULL, 0.4f + 0.55f * pace, m->ch->scale);
  else if (d < 350) G->fx.sfx(G->fx.ud, SFX_STEP, &f->pos, 0.3f + 0.45f * pace, m->ch->scale);
  // A heavy mech's steps are felt through the ground within 40 m.
  if (m != P && m->ch->scale > 1.1f && d < 40) feel(G, FE_NEARSTEP, P, (1 - d / 40) * m->ch->scale * m->ch->scale, 0, NULL, &f->pos);
  if (pace > 0.25f && d < 260) {
    const float *low = PALS[G->biome].low; float col[3] = { low[0] * 0.8f * G->pal.shade[0], low[1] * 0.8f * G->pal.shade[1], low[2] * 0.8f * G->pal.shade[2] };
    int n = (int)(3 * FEEL[FE_STEP].dust * (0.5f + 0.5f * pace) * m->ch->scale + 0.5f);
    for (int i = 0; i < n; i++) particle(G, vadd(f->pos, V3(rngRange(r, -1, 1), 0.3f, rngRange(r, -1, 1))), V3(rngRange(r, -2, 2), rngRange(r, 0.5f, 1.5f), rngRange(r, -2, 2)), rngRange(r, 0.6f, 1), rngRange(r, 0.5f, 0.9f) * m->ch->scale, col, PK_SMOKE, 0, 0);
  }
}

// The pendulum body: the planted leg is held nearly straight and the hull
// vaults over it like a weight on a stiff pole, on a spring each footfall
// pushes down; the torso follows late on a softer spring and nods as it lags.
static void pendulumBody(Game *G, Mech *m, const Geo *g, const Gait *gp, float s, float pace, float v, float dt, float lame) {
  float l1 = g->l1 * s, l2 = g->l2 * s, c = cosf(m->yaw), sn = sinf(m->yaw);
  float knee = lerpf(gp->knee - gp->kneeFast * pace, gp->runKnee ? gp->runKnee : gp->knee, runOf(m, pace));
  float pole = sqrtf(l1 * l1 + l2 * l2 - 2 * l1 * l2 * cosf(knee * PI_F / 180)), full = (l1 + l2) * 0.98f;
  float up = -1e30f, cap = 1e30f, drop = 1e30f;
  for (int i = 0; i < g->nLegs; i++) {
    Foot *f = &m->feet[i];
    if (f->lifted || !legOk(m, i)) continue;
    const LegPlan *l = &g->legs[i]; float hx = m->x + (c * l->hx + sn * l->hz) * s, hz = m->z + (-sn * l->hx + c * l->hz) * s;
    float dx = f->pos.x - hx, dz = f->pos.z - hz, flat = dx * dx + dz * dz, side = dx * c - dz * sn, ay = f->pos.y + g->ankle * s;
    float h = sqrtf(maxf(0, pole * pole - flat));
    float top = ay + sqrtf(maxf(0, pole * pole - side * side));
    if (top - gp->vault * (top - ay - h) > up) { drop = top - ay - h; up = top - gp->vault * drop; }
    cap = minf(cap, ay + sqrtf(maxf(0, full * full - flat)));
  }
  if (!m->pInit) { m->pInit = 1; m->pWalk = 0; m->pDrop = drop < 1e30f ? drop : 0; m->pMean = m->pDrop; m->pVault = 0; m->pAhead = 0; springInit(&m->hull, gp->bodyK, gp->bodyZeta); m->pVault = -1e30f; }
  float walkY = up == -1e30f ? m->pWalk : minf(up, cap) - (m->y + g->hip * s);
  if (drop == 1e30f) drop = m->pDrop;
  m->pWalk = walkY; m->pDrop = drop; m->pMean = m->pMean + (drop - m->pMean) * minf(1, dt * 2);
  float k = clampf(pace / 0.3f, 0, 1), target = walkY * k * k * (3 - 2 * k);
  m->pVault = m->pVault == -1e30f ? target : m->pVault + (target - m->pVault) * minf(1, dt / 0.04f);
  springTune(&m->hull, gp->bodyK, gp->bodyZeta);
  springStep(&m->hull, dt, 0);
  float hullY = m->pVault + m->hull.x;
  float ahead = fabsf(v) * gp->speedUp * clampf((drop - m->pMean) / (0.05f * (l1 + l2)), -1, 1) * signf(v);
  m->pAhead = m->pAhead + (ahead - m->pAhead * 3) * dt;
  m->surge = m->pAhead / s;
  if (!m->torsoInit) { m->torsoInit = 1; springInit(&m->torso, 1 / (gp->lag * gp->lag), 0.7f); m->torso.x = hullY; }
  springTune(&m->torso, 1 / (gp->lag * gp->lag), 0.7f);
  springStep(&m->torso, dt, hullY);
  float lagM = m->torso.x - hullY;
  m->torsoDrop = lagM / s; m->torsoNod = -lagM * gp->nod;
  m->bob = minf(hullY, lame);
}

void gait(Game *G, Mech *m, float dt) {
  float v = m->walled ? m->slide : m->speed;
  const Gait *gp = gaitOf(m); const Geo *g = m->geo; float s = m->ch->scale, pace = minf(1, fabsf(v) / m->maxSpeed), crouch = -gp->crouch * s * pace;
  // No legs left: the hull sits on the ground, the torso still turns and fires.
  if (m->hp[SEC_LL] <= 0 && m->hp[SEC_RL] <= 0) {
    for (int i = 0; i < g->nLegs; i++) { m->feet[i].pos = restFoot(G, m, i, 0); m->feet[i].lifted = 0; m->feet[i].yaw = m->yaw; }
    m->bob = -(g->hip - 0.9f) * s; m->lean = 0; m->sway = 0; m->hipYaw = 0; m->surge = 0; m->lastYaw = m->yaw; m->runK = 0; m->runLean = 0; stillBody(m);
    return;
  }
  float missing = m->hp[SEC_LL] <= 0 ? 1 : m->hp[SEC_RL] <= 0 ? -1 : 0;   // one leg gone: lean toward the gap
  m->lean = missing * 0.14f;
  float dyaw = fabsf(wrapA(m->yaw - m->lastYaw));
  m->lastYaw = m->yaw;
  if (m->air) {   // legs hang under the body until touchdown
    for (int i = 0; i < g->nLegs; i++) { v3 r = restFoot(G, m, i, 0); m->feet[i].pos = V3(r.x, m->y + 1.4f * s, r.z); m->feet[i].lifted = 0; m->feet[i].yaw = m->yaw; }
    m->bob = 0; m->sway = 0; m->hipYaw = 0; m->surge = 0; m->wasAir = 1; stillBody(m);
    return;
  }
  if (m->wasAir) { m->wasAir = 0; m->cyc = restCyc(g); for (int i = 0; i < g->nLegs; i++) { m->feet[i].pos = restFoot(G, m, i, 0); m->feet[i].yaw = m->yaw; } }

  float sw = swingNow(m, pace), D = strideOf(m, pace, sw);
  float before[4]; int anySwing = 0;
  for (int i = 0; i < g->nLegs; i++) { float u = fmodf(m->cyc - g->legs[i].ph + 2, 1) / sw; before[i] = u < 1 ? u : -1; if (u < 1) anySwing = 1; }
  int moving = fabsf(v) > 0.3f || dyaw > 1e-4f;
  float adv = moving ? (fabsf(v) * dt + dyaw * 2.5f * s) / D : (anySwing ? dt / 0.6f : 0);
  m->cyc = fmodf(m->cyc + minf(adv, 0.2f), 1);
  float dir = fabsf(v) > 0.3f ? signf(v) : 0;
  float since = G->time - m->stepAt, tau = 0.1f, dip = since < 1 ? (since / tau) * expf(1 - since / tau) : 0;
  m->bob = crouch - dip * gp->drop * s * (0.4f + 0.6f * pace);
  float lurch = since < 1.5f ? (since / 0.16f) * expf(1 - since / 0.16f) : 0;
  m->surge = lurch * gp->surge * pace * dir;
  float back = lerpf(gp->plantBack[0], gp->plantBack[1], runOf(m, pace)) * ((1 - sw) / 2) * D;
  float sway = 0, turn = 0, lame = 1e30f;
  for (int i = 0; i < g->nLegs; i++) {
    Foot *f = &m->feet[i]; float u = fmodf(m->cyc - g->legs[i].ph + 2, 1) / sw;
    if (!legOk(m, i)) { f->lifted = 0; if (u < 1) lame = minf(lame, crouch - sinf(PI_F * u) * (gp->crouch + 0.35f) * s); continue; }
    if (u >= 1) {
      if (f->lifted) { f->pos = swingTarget(G, m, i, 1, D, dir, sw, back); f->yaw = m->yaw; f->lifted = 0; footDown(G, m, f, pace); }
      continue;
    }
    if (!f->lifted) { f->from = f->pos; f->lifted = 1; }
    v3 t = swingTarget(G, m, i, u, D, dir, sw, back); float e = (1 - cosf(PI_F * u)) / 2;   // the leg swings as a pendulum does
    if (hypot2(f->from.x - t.x, f->from.z - t.z) > 1.5f * D + 3 * s) f->from = t;   // shoved mid-stride: start from the target
    float up = sinf(PI_F * powf(u, gp->liftEarly)) * (gp->lift[0] + gp->lift[1] * pace) * s;
    f->pos = V3(lerpf(f->from.x, t.x, e), lerpf(f->from.y, t.y, e) + up, lerpf(f->from.z, t.z, e));
    f->yaw += wrapA(m->yaw - f->yaw) * minf(1, dt * 10);
    float arc = sinf(PI_F * u); const LegPlan *leg = &g->legs[i]; float side = signf(leg->hx) * (leg->hz >= -0.2f ? 1 : 0);
    sway -= side * arc * gp->sway * minf(1, 0.3f + pace);
    turn -= side * arc * gp->hipTurn * pace;
  }
  (void)before;
  pendulumBody(G, m, g, gp, s, pace, v, dt, lame);
  m->runK = m->runK + ((dir > 0 ? runOf(m, pace) : 0) - m->runK) * minf(1, dt * 4);
  m->runLean = gp->runLean * m->runK;
  m->bob -= gp->runDrop * s * m->runK;
  m->sway = sway; m->hipYaw = turn;
  for (int i = 0; i < g->nLegs; i++) {   // a planted foot left hopelessly far away just resets
    Foot *f = &m->feet[i]; if (f->lifted) continue;
    v3 r = restFoot(G, m, i, 0);
    if (hypot2(f->pos.x - r.x, f->pos.z - r.z) > 7 * s) f->pos = r;
  }
}
// Knee position by the law of cosines, bending toward `pole`.
v3 solveKnee(v3 H, v3 A, v3 pole, float l1, float l2) {
  v3 d = vsub(A, H); float raw = vlen(d); v3 n = vmul(d, 1 / (raw > 1e-6f ? raw : 1));
  float dist = clampf(raw, fabsf(l1 - l2) + 1e-3f, (l1 + l2) * 0.999f);
  float a = acosf(clampf((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
  v3 p = vsub(pole, vmul(n, vdot(pole, n)));
  p = vlen(p) < 1e-4f ? V3(0, 0, 1) : vnorm(p);
  return vadd(H, vadd(vmul(n, l1 * cosf(a)), vmul(p, l1 * sinf(a))));
}
