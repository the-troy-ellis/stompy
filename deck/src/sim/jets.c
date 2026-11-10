#include "sim/game.h"
// Blast-off jets (docs/specs/26-blast-off.md): hold JUMP on the ground with the
// jets ready and they charge; let go and the mech blasts off, up and along the
// way it walks, higher the fuller the charge. `fuel` is how ready the jets are.
static float vyOf(const JetsDef *T, float c) { return T->vy[0] + (T->vy[1] - T->vy[0]) * (maxf(c, T->tap) - T->tap) / (1 - T->tap); }
static float topOf(const Mech *o) { return o->y + o->geo->height * o->ch->scale; }
static void walkVel(const Mech *m, float v[2]) { v[0] = sinf(m->yaw) * m->speed + m->push[0] * 0.4f; v[1] = cosf(m->yaw) * m->speed + m->push[1] * 0.4f; }
static void groundVel(const Mech *m, float v[2]) { walkVel(m, v); if (m->air && m->jet.blasted) { v[0] += m->jet.fly[0]; v[1] += m->jet.fly[1]; } }

static void blastRing(Game *G, v3 p, float c, float s) {
  Rng *r = &G->rng; float gy = terHeight(&G->ter, p.x, p.z);
  float ring[3] = { 0.95f, 0.86f, 0.66f }, ring2[3] = { 0.85f, 0.7f, 0.5f };
  particle(G, V3(p.x, gy + 0.3f, p.z), V3(0, 0, 0), 0.45f, (12 + 22 * c) * s, ring, PK_SHOCK, 0, 0);
  if (c > 0.5f) particle(G, V3(p.x, gy + 0.2f, p.z), V3(0, 0, 0), 0.8f, (20 + 26 * c) * s, ring2, PK_SHOCK, 0, 0);
  scorch(G, p.x, p.z, (2.2f + 3.2f * c) * s, gy);
  const float *low = PALS[G->biome].low; int n = (int)(18 + 30 * c);
  for (int i = 0; i < n; i++) {
    float a = (i / (float)n) * TAU + rngRange(r, -0.1f, 0.1f), v = rngRange(r, 10, 20) * (0.6f + 0.7f * c);
    particle(G, V3(p.x + sinf(a) * 2 * s, gy + 0.6f, p.z + cosf(a) * 2 * s), V3(sinf(a) * v, rngRange(r, 0.5f, 3), cosf(a) * v), rngRange(r, 0.8f, 1.5f), rngRange(r, 1.2f, 2.4f) * s, low, PK_DUST, 0, 0);
  }
  for (int i = 0; i < (int)(4 + 8 * c); i++) { float a = rngRange(r, 0, TAU), v = rngRange(r, 6, 14) * (0.5f + 0.5f * c); particle(G, V3(p.x, gy + 0.8f, p.z), V3(sinf(a) * v, rngRange(r, 6, 14) * (0.5f + 0.5f * c), cosf(a) * v), rngRange(r, 0.9f, 1.6f), rngRange(r, 0.4f, 0.8f) * s, low, PK_DEBRIS, 18, 0); }
  float fire[3] = { 1, 0.6f, 0.2f }, smoke[3] = { 0.3f, 0.28f, 0.26f };
  for (int i = 0; i < (int)(3 + 6 * c); i++) particle(G, V3(p.x + rngRange(r, -1, 1) * s, gy + 0.5f, p.z + rngRange(r, -1, 1) * s), V3(rngRange(r, -2, 2), rngRange(r, 2, 8), rngRange(r, -2, 2)), rngRange(r, 0.25f, 0.5f), rngRange(r, 1.4f, 2.4f) * s, fire, PK_FIRE, 0, 0);
  for (int i = 0; i < 12; i++) particle(G, V3(p.x + rngRange(r, -3, 3), gy + 1, p.z + rngRange(r, -3, 3)), V3(rngRange(r, -2, 2), rngRange(r, 1, 4), rngRange(r, -2, 2)), rngRange(r, 1.6f, 2.6f), rngRange(r, 1.8f, 3.2f) * s, smoke, PK_SMOKE, 0, 0);
}
// The speed along an aimed blast takes: to where `o` will be when a flight up at `vy` comes down on its top.
static void aimBlast(const Mech *m, const Mech *o, float vy, const JetsDef *T, float out[2]) {
  float y0 = m->y + 0.5f, d = vy * vy + 36 * (y0 - topOf(o));
  float t = d > 0 ? (vy + sqrtf(d)) / 18 : vy / 9 + sqrtf(maxf(0, 2 * y0 / 18));
  float v[2], w[2]; groundVel(o, v); walkVel(m, w);
  float ax = (o->x + v[0] * t - m->x) / t - w[0], az = (o->z + v[1] * t - m->z) / t - w[1], sp = hypot2(ax, az);
  if (sp > T->aimFwd) { ax *= T->aimFwd / sp; az *= T->aimFwd / sp; }
  out[0] = ax; out[1] = az;
}
void blastOff(Game *G, Mech *m) {
  const JetsDef *T = &JETS[m->jets]; float c = maxf(m->jet.charge, T->tap), k = (c - T->tap) / (1 - T->tap);
  m->vy = vyOf(T, c);
  Mech *lock = m->jet.lock && m->jet.lock->alive && !(m->throttle < 0) ? m->jet.lock : NULL;
  float along = T->fwd * c * m->throttle;
  if (lock) aimBlast(m, lock, m->vy, T, m->jet.fly); else { m->jet.fly[0] = sinf(m->yaw) * along; m->jet.fly[1] = cosf(m->yaw) * along; }
  m->y += 0.5f; m->air = 1;
  m->heat += T->heat[0] + (T->heat[1] - T->heat[0]) * k;
  m->fuel = 0;
  m->jet.blasted = 1; m->jet.top = m->y; m->jet.hasBase = 0; m->jet.lock = lock; m->jet.used = 0; m->jet.away = 0;
  v3 at = V3(m->x, m->y, m->z);
  feel(G, FE_BLASTOFF, m, 0.4f + 0.6f * c, 0, NULL, m == G->player ? NULL : &at);
  blastRing(G, at, c, m->ch->scale);
  G->fx.sfx(G->fx.ud, SFX_BLASTOFF, m == G->player ? NULL : &at, c, 0);
}
static void streak(Game *G, Mech *m) {
  Rng *r = &G->rng; if (!rngChance(r, 0.6f)) return;
  float smoke[3] = { 0.4f, 0.38f, 0.36f }, fire[3] = { 1, 0.7f, 0.3f };
  particle(G, V3(m->x + rngRange(r, -1, 1), m->y + 0.5f, m->z + rngRange(r, -1, 1)), V3(rngRange(r, -1, 1), -2, rngRange(r, -1, 1)), rngRange(r, 0.8f, 1.6f), rngRange(r, 0.8f, 1.4f) * m->ch->scale, smoke, PK_SMOKE, 0, 0);
  particle(G, V3(m->x, m->y + 0.3f, m->z), V3(0, -6, 0), 0.2f, 0.7f * m->ch->scale, fire, PK_FIRE, 0, 0);
}
void stepJets(Game *G, Mech *m, float dt) {
  if (!m->jets) { m->jet.charge = 0; return; }
  const JetsDef *T = &JETS[m->jets];
  int able = m->alive && !m->shutdown && !m->air && m->fuel >= 1;
  if (m->jetting && able) m->jet.charge = minf(1, m->jet.charge + dt / T->charge);
  else if (m->jet.charge > 0) { if (!m->jetting && able) blastOff(G, m); m->jet.charge = 0; }
  if (!m->jet.charge) m->fuel = minf(1, m->fuel + dt / T->recharge);
  if (m->air) m->jet.top = maxf(m->jet.top, m->y);
  else if (m->jet.blasted && m->vy <= 0) { m->jet.blasted = 0; m->jet.lock = NULL; m->jet.hasAt = 0; }
  if (m->jet.blasted && m->vy > 0) streak(G, m);
}
// A flight from (x, y, z) at (vx, vy, vz), stepped at 20 a second for up to 6 s until it meets the ground or a mech's top.
static int flight(Game *G, const Mech *m, float x, float y, float z, float vx, float vy, float vz, v3 *at, float *tOut, Mech **onMech) {
  float rm = m->geo->radius * m->ch->scale, h = 0.05f; *onMech = NULL;
  for (float t = h; t < 6; t += h) {
    vy -= 18 * h; x += vx * h; y += vy * h; z += vz * h;
    if (vy < 0) for (int i = 0; i < G->nMechs; i++) {
      Mech *o = &G->mechs[i]; if (o == m || !o->alive) continue;
      float top = topOf(o); if (y > top + 0.5f || y <= top - 2) continue;
      float v[2]; groundVel(o, v);
      if (hypot2(o->x + v[0] * t - x, o->z + v[1] * t - z) < (rm + o->geo->radius * o->ch->scale) * 1.2f) { *at = V3(x, top, z); *tOut = t; *onMech = o; return 1; }
    }
    float g = terHeight(&G->ter, x, z);
    if (y <= g) { *at = V3(x, g, z); *tOut = t; return 1; }
  }
  return 0;
}
// In the air after a blast: the movement controls push the flight a little, and a lock pulls it onto the target.
void airSteer(Game *G, Mech *m, float along, float across, float dt) {
  const JetsDef *T = m->jets ? &JETS[m->jets] : NULL;
  if (!T || !m->jet.blasted || !m->air) return;
  float fx = sinf(m->yaw), fz = cosf(m->yaw), sx = fx * along + fz * across, sz = fz * along - fx * across;
  if (along || across) {
    if (!m->jet.hasBase) { m->jet.hasBase = 1; m->jet.base = hypot2(m->jet.fly[0], m->jet.fly[1]); }
    m->jet.fly[0] += sx * T->steer * dt; m->jet.fly[1] += sz * T->steer * dt;
    float cap = m->jet.base + JETS_FLIGHT.steerOver, sp = hypot2(m->jet.fly[0], m->jet.fly[1]);
    if (sp > cap) { m->jet.fly[0] *= cap / sp; m->jet.fly[1] *= cap / sp; }
  }
  float v[2]; groundVel(m, v); Mech *onM; v3 at; float t;
  m->jet.hasAt = flight(G, m, m->x, m->y, m->z, v[0], m->vy, v[1], &at, &t, &onM);
  if (m->jet.hasAt) { m->jet.at = at; m->jet.atT = t; m->jet.atMech = onM; }
  Mech *o = m->jet.lock;
  if (!o) return;
  if (!o->alive || !m->jet.hasAt) { m->jet.lock = NULL; return; }
  m->jet.away = (along || across) && sx * (o->x - m->x) + sz * (o->z - m->z) < 0 ? m->jet.away + dt : 0;
  float ov[2]; groundVel(o, ov); float mx = o->x + ov[0] * t - at.x, mz = o->z + ov[1] * t - at.z, miss = hypot2(mx, mz);
  if (m->jet.away >= T->letGo || miss > JETS_FLIGHT.escape) { m->jet.lock = NULL; return; }
  if (miss < 0.05f || t < 0.1f) return;
  float k = minf(minf(miss / t, T->assist * dt), T->assistMax - m->jet.used);
  if (k <= 0) return;
  m->jet.fly[0] += mx / miss * k; m->jet.fly[1] += mz / miss * k; m->jet.used += k;
}
// The lock while charging on the ground: the foe this charge would blast at, and where it would land.
void jetLock(Game *G, Mech *m) {
  const JetsDef *T = m->jets ? &JETS[m->jets] : NULL;
  if (!T || m->jet.blasted) return;
  int was = m->jet.on;
  m->jet.lock = NULL; m->jet.on = 0; m->jet.hasAt = 0;
  if (!(m->jet.charge > 0) || m->air || !m->alive) return;
  float cone = cosf(JETS_FLIGHT.cone); Mech *lock = NULL; float best = cone;
  for (int i = 0; i < G->nMechs; i++) {
    Mech *o = &G->mechs[i]; if (o == m || !o->alive || o->team == m->team || hypot2(o->x - m->x, o->z - m->z) > T->reach) continue;
    float d = vdot(vnorm(vsub(centerOf(o), G->eye)), G->view);
    if (o == G->target && d > cone) { lock = o; break; }
    if (d > best) { best = d; lock = o; }
  }
  if (lock) G->target = lock;
  float vy = vyOf(T, m->jet.charge), w[2]; walkVel(m, w); int back = m->throttle < 0;
  float along = T->fwd * maxf(m->jet.charge, T->tap) * m->throttle, fly[2];
  if (lock && !back) aimBlast(m, lock, vy, T, fly); else { fly[0] = sinf(m->yaw) * along; fly[1] = cosf(m->yaw) * along; }
  m->jet.lock = lock;
  Mech *onM; v3 at; float t;
  m->jet.hasAt = flight(G, m, m->x, m->y + 0.5f, m->z, w[0] + fly[0], vy, w[1] + fly[1], &at, &t, &onM);
  if (m->jet.hasAt) { m->jet.at = at; m->jet.atT = t; m->jet.atMech = onM; }
  m->jet.on = lock && !back && m->jet.hasAt && onM == lock;
  if (m->jet.on && !was && m == G->player) G->fx.sfx(G->fx.ud, SFX_LOCK, NULL, 0, 0);
}
