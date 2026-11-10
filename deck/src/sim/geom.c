#include "sim/game.h"

m4 frameOf(const Mech *m) { return m4mul(m4mul(m4T(m->x, m->y + m->bob, m->z), m4RY(m->yaw)), m4S(m->ch->scale, m->ch->scale, m->ch->scale)); }
m4 torsoFrame(const Mech *m) { return m4mul(m4mul(frameOf(m), m4T(0, m->geo->torsoY + m->torsoDrop, 0)), m4RY(m->twist)); }
v3 centerOf(const Mech *m) { return V3(m->x, m->y + 4.2f * m->ch->scale, m->z); }
v3 muzzleOf(const Mech *m, const Weapon *w) {
  m4 tf = torsoFrame(m); const Geo *g = m->geo;
  if (w->mount == SEC_T) return m4apply(&tf, w->def->kind == WK_MISSILE ? V3(w->side % 2 ? -1.25f : 1.25f, g->rackY, 0.6f) : V3(-0.9f, g->acY, 1.6f));
  return m4apply(&tf, V3((w->mount == SEC_LA ? 1 : -1) * g->armX, g->armY - 1.2f, 2.4f));
}
v3 eyeOf(const Mech *m) { m4 tf = torsoFrame(m); return m4apply(&tf, V3(m->geo->eye[0], m->geo->eye[1], m->geo->eye[2])); }
// Where a shell fired now from `from` at `speed` meets a mech walking on its heading.
v3 leadPoint(v3 from, const Mech *t, float speed) {
  v3 c = centerOf(t), v = V3(sinf(t->yaw) * t->speed, 0, cosf(t->yaw) * t->speed), p = c;
  for (int i = 0; i < 2; i++) { float tof = vlen(vsub(p, from)) / speed; p = vadd(c, vmul(v, tof)); }
  return p;
}
// A ray against an upright cylinder standing at (x, y, z): the nearest t >= 0 on its side within its height, or -1.
float rayUpright(v3 o, v3 d, float x, float y, float z, float R, float H) {
  float ox = o.x - x, oz = o.z - z, a = d.x * d.x + d.z * d.z;
  if (a < 1e-8f) return -1;
  float b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - R * R, disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  float sq = sqrtf(disc), t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
  if (t0 >= 0) { float h = o.y + d.y * t0; if (h >= y && h <= y + H) return t0; }
  if (t1 >= 0) { float h = o.y + d.y * t1; if (h >= y && h <= y + H) return t1; }
  return -1;
}
static float rayCyl(v3 o, v3 d, const Mech *m) { return rayUpright(o, d, m->x, m->y, m->z, m->geo->radius * m->ch->scale, m->geo->height * m->ch->scale); }
float rayTerrainG(Game *G, v3 o, v3 d, float maxT) {
  if (!(maxT > 0) || !isfinite(o.x + o.y + o.z + d.x + d.y + d.z)) return -1;
  return terRay(&G->ter, o, d, maxT);
}
Hit rayHit(Game *G, v3 o, v3 d, float maxT, const Mech *ignore) {
  Hit h = { 0 }; float bt = 1e30f; Mech *bm = NULL;
  for (int i = 0; i < G->nMechs; i++) {
    Mech *m = &G->mechs[i];
    if (!m->alive || m == ignore) continue;
    float t = rayCyl(o, d, m);
    if (t >= 0 && t <= maxT && t < bt) { bt = t; bm = m; }
  }
  float tt = rayTerrainG(G, o, d, bt < 1e30f ? bt : maxT);
  if (tt >= 0) { bt = tt; bm = NULL; }
  if (bt < 1e30f) { h.ok = 1; h.t = bt; h.mech = bm; h.point = vadd(o, vmul(d, bt)); }
  return h;
}
// Which section a point on the body is: legs by side below the leg top, arms out past 1.6 units in torso space.
int sectionHit(const Mech *m, v3 p) {
  float dx = p.x - m->x, dz = p.z - m->z, ly = (p.y - m->y) / m->ch->scale;
  if (ly < m->geo->legTop) { float a = m->yaw; return dx * cosf(a) - dz * sinf(a) > 0 ? SEC_LL : SEC_RL; }
  float a = viewYaw(m), lx = (dx * cosf(a) - dz * sinf(a)) / m->ch->scale;
  return lx > 1.6f ? SEC_LA : lx < -1.6f ? SEC_RA : SEC_T;
}
float groundUnder(Game *G, const Mech *m, float x, float z) { return terHeight(&G->ter, x, z); }
int blockedLOS(Game *G, v3 a, v3 b) { v3 d = vsub(b, a); float l = vlen(d); if (l < 1) return 0; return rayTerrainG(G, a, vmul(d, 1 / l), l - 1) >= 0; }
