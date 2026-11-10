#include "render/mesh.h"
#include <string.h>
#include <stdlib.h>

static void push9(Builder *B, v3 p, v3 n, const float c[3]) { float v[9] = { p.x, p.y, p.z, n.x, n.y, n.z, c[0], c[1], c[2] }; fbPush(&B->b, v, 9); }
void bTri(Builder *B, v3 a, v3 b, v3 c, const float col[3], const v3 *ref, int up) {
  v3 n = vnorm(vcross(vsub(b, a), vsub(c, a)));
  if (up ? n.y < 0 : (ref && vdot(n, vsub(a, *ref)) < 0)) { n = vmul(n, -1); v3 t = b; b = c; c = t; }   // orient outward, and wind to match
  push9(B, a, n, col); push9(B, b, n, col); push9(B, c, n, col);
}
void bQuad(Builder *B, v3 a, v3 b, v3 c, v3 d, const float col[3], const v3 *ref) { bTri(B, a, b, c, col, ref, 0); bTri(B, a, c, d, col, ref, 0); }
void bCube(Builder *B, const m4 *m, const float col[3], float tx, float tz) {
  v3 C[8]; const float k[2] = { -0.5f, 0.5f };
  for (int i = 0; i < 8; i++) { float y = k[(i >> 1) & 1]; int top = y > 0; C[i] = m4apply(m, V3(k[i & 1] * (top ? tx : 1), y, k[(i >> 2) & 1] * (top ? tz : 1))); }
  v3 ctr = m4apply(m, V3(0, 0, 0));
  static const int F[6][4] = { { 0, 2, 6, 4 }, { 1, 3, 7, 5 }, { 0, 1, 5, 4 }, { 2, 3, 7, 6 }, { 0, 1, 3, 2 }, { 4, 5, 7, 6 } };
  for (int f = 0; f < 6; f++) bQuad(B, C[F[f][0]], C[F[f][1]], C[F[f][2]], C[F[f][3]], col, &ctr);
}
void bCyl(Builder *B, const m4 *m, const float col[3], int n, float top) {
  v3 lo[32], hi[32]; v3 ctr = m4apply(m, V3(0, 0, 0)), cLo = m4apply(m, V3(0, -0.5f, 0)), cHi = m4apply(m, V3(0, 0.5f, 0));
  for (int i = 0; i < n; i++) { float a = (i / (float)n) * TAU; lo[i] = m4apply(m, V3(sinf(a) * 0.5f, -0.5f, cosf(a) * 0.5f)); hi[i] = m4apply(m, V3(sinf(a) * 0.5f * top, 0.5f, cosf(a) * 0.5f * top)); }
  for (int i = 0; i < n; i++) {
    int j = (i + 1) % n;
    if (top > 0) bQuad(B, lo[i], lo[j], hi[j], hi[i], col, &ctr); else bTri(B, lo[i], lo[j], hi[0], col, &ctr, 0);
    bTri(B, cLo, lo[i], lo[j], col, &ctr, 0);
    if (top > 0) bTri(B, cHi, hi[i], hi[j], col, &ctr, 0);
  }
}
void bSphere(Builder *B, const m4 *m, const float col[3], int n, int r) {
  v3 ctr = m4apply(m, V3(0, 0, 0));
#define P(i, j) m4apply(m, V3(sinf((j) / (float)r * PI_F) * sinf((i) / (float)n * TAU) * 0.5f, cosf((j) / (float)r * PI_F) * 0.5f, sinf((j) / (float)r * PI_F) * cosf((i) / (float)n * TAU) * 0.5f))
  for (int j = 0; j < r; j++) for (int i = 0; i < n; i++) {
    v3 a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    if (j == 0) bTri(B, a, c, d, col, &ctr, 0); else if (j == r - 1) bTri(B, a, b, c, col, &ctr, 0); else bQuad(B, a, b, c, d, col, &ctr);
  }
#undef P
}
Mesh bUpload(Builder *B) { Mesh m = glrUpload(B->b.d, B->b.n / 9); fbClear(&B->b); return m; }

// --- mech parts --------------------------------------------------------------
static m4 ch2(m4 a, m4 b) { return m4mul(a, b); }
static m4 ch3(m4 a, m4 b, m4 c) { return m4mul(m4mul(a, b), c); }
static m4 S1(float x, float y, float z) { return m4S(x, y, z); }
static void col3(float o[3], const float c[3], float k) { o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; }
// The joints: round, so a limb turning about one never shows a box corner cutting through its neighbour.
static void hinge(Builder *B, v3 at, float d, float len, const float col[3]) { m4 m = ch3(m4T(at.x, at.y, at.z), m4RZ(PI_F / 2), S1(d, len, d)); bCyl(B, &m, col, 8, 1); }
static void ball(Builder *B, v3 at, float d, const float col[3]) { m4 m = ch2(m4T(at.x, at.y, at.z), S1(d, d, d)); bSphere(B, &m, col, 8, 4); }
#define CUBE(mat, c, tx, tz) do { m4 _m = (mat); bCube(B, &_m, c, tx, tz); } while (0)
static const float GLASS[3] = { 0.08f, 0.1f, 0.13f }, TUBE[3] = { 0.06f, 0.06f, 0.07f };

static void legsForward(Builder *B, MechParts *P, const float *c, const float *dark, const Geo *g) {
  float l1 = g->l1, l2 = g->l2, k2 = l2 / 2.5f, w = g->girth;
  CUBE(S1(2.6f * w, 0.9f * w, 1.6f * w), dark, 1, 1); P->hip = bUpload(B);
  CUBE(ch2(m4T(0, -l1 / 2, 0), S1(0.95f * w, l1 + 0.2f, 1.25f * w)), c, 0.85f, 0.9f); ball(B, V3(0, 0, 0), 1.3f * w, dark); hinge(B, V3(0, -l1, 0.05f), 1.4f * w, 1.15f * w, dark); P->uleg = bUpload(B);
  CUBE(ch2(m4T(0, -l2 / 2, -0.1f), S1(0.8f * w, l2, 1.05f * w)), c, 1, 1); CUBE(ch2(m4T(0, -1.1f * k2, -0.65f * w), S1(0.3f * w, 1.8f * k2, 0.3f * w)), dark, 1, 1); ball(B, V3(0, -l2, -0.05f), 1.0f * w, dark); P->lleg = bUpload(B);
  CUBE(ch2(m4T(0, -0.2f, 0.35f * w), S1(1.25f * w, 0.4f * w, 2.3f * w)), dark, 0.8f, 0.8f); P->foot = bUpload(B);
}
// Bird legs: an armoured thigh, a slimmer shin with a hydraulic ram, a three-toed claw with a spur behind.
static void legsReverse(Builder *B, MechParts *P, const float *c, const float *dark, const Geo *g) {
  float l1 = g->l1, l2 = g->l2, k2 = l2 / 2.9f;
  CUBE(S1(2.8f, 0.9f, 1.8f), dark, 1, 1); CUBE(ch2(m4T(0, -0.1f, -0.9f), S1(1.4f, 0.6f, 0.5f)), c, 1, 1); P->hip = bUpload(B);
  CUBE(ch2(m4T(0, -l1 / 2, 0), S1(1.15f, l1 + 0.2f, 1.45f)), c, 0.8f, 0.85f); ball(B, V3(0, 0, 0), 1.5f, dark); hinge(B, V3(0, -l1, 0), 1.6f, 1.25f, dark); P->uleg = bUpload(B);
  CUBE(ch2(m4T(0, -l2 / 2, 0), S1(0.7f, l2, 0.9f)), c, 1.2f, 1.15f); CUBE(ch2(m4T(0, -1.3f * k2, 0.55f), S1(0.28f, 2.2f * k2, 0.28f)), dark, 1, 1); ball(B, V3(0, -l2, 0), 0.95f, dark); P->lleg = bUpload(B);
  CUBE(ch2(m4T(0, -0.15f, 0), S1(0.8f, 0.5f, 0.8f)), dark, 1, 1);
  CUBE(ch2(m4T(0, -0.32f, 1.0f), S1(0.38f, 0.34f, 1.7f)), dark, 0.7f, 0.8f);
  for (int sx = -1; sx <= 1; sx += 2) CUBE(ch3(m4T(sx * 0.42f, -0.32f, 0.75f), m4RY(sx * 0.42f), S1(0.34f, 0.32f, 1.45f)), dark, 0.7f, 0.8f);
  CUBE(ch2(m4T(0, -0.32f, -0.6f), S1(0.3f, 0.3f, 0.9f)), dark, 0.7f, 0.8f); P->foot = bUpload(B);
}
// A low armoured hull on four bowed legs: a thigh, a tapering shin and a broad pad of a foot.
static void legsQuad(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc, const Geo *g) {
  float l1 = g->l1, l2 = g->l2;
  CUBE(S1(3.4f, 1.3f, 4.4f), c, 0.85f, 0.9f); CUBE(ch2(m4T(0, -0.1f, 2.45f), S1(2.4f, 0.9f, 0.7f)), dark, 0.8f, 0.8f); CUBE(ch2(m4T(0, 0.15f, -2.35f), S1(2.6f, 1.0f, 0.6f)), dark, 1, 1);
  for (int sx = -1; sx <= 1; sx += 2) for (int sz = -1; sz <= 1; sz += 2) ball(B, V3(sx * 1.45f, 0, sz * 1.6f), 1.2f, acc);
  P->hip = bUpload(B);
  CUBE(ch2(m4T(0, -l1 / 2, 0), S1(0.8f, l1, 0.9f)), c, 1, 1); hinge(B, V3(0, -l1, 0), 1.2f, 1.05f, dark); P->uleg = bUpload(B);
  CUBE(ch2(m4T(0, -l2 / 2, 0), S1(0.55f, l2, 0.6f)), c, 1.45f, 1.4f); ball(B, V3(0, -l2, 0), 0.8f, dark); P->lleg = bUpload(B);
  CUBE(ch2(m4T(0, -0.17f, 0), S1(1.15f, 0.35f, 1.15f)), dark, 0.75f, 0.75f); P->foot = bUpload(B);
}
static void bodyForward(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc) {
  CUBE(ch2(m4T(0, 1.3f, 0), S1(3.4f, 2.6f, 2.6f)), c, 0.85f, 0.8f); CUBE(ch2(m4T(0, 2.15f, 1.3f), S1(1.6f, 0.9f, 1)), GLASS, 0.75f, 0.6f);
  CUBE(ch2(m4T(1.25f, 2.85f, -0.2f), S1(1.15f, 0.7f, 1.6f)), acc, 1, 1); CUBE(ch2(m4T(-1.25f, 2.85f, -0.2f), S1(1.15f, 0.7f, 1.6f)), acc, 1, 1); CUBE(ch2(m4T(0, 1.0f, -1.5f), S1(2, 1.6f, 0.6f)), dark, 1, 1);
  P->torso = bUpload(B);
  CUBE(ch2(m4T(0, -0.6f, 0.1f), S1(0.95f, 1.8f, 1.15f)), c, 1, 1); hinge(B, V3(0, 0.15f, 0), 1.5f, 1.25f, acc); P->arm = bUpload(B);
  P->barrelAt = V3(0, -1.15f, 1.45f); CUBE(ch2(m4T(0, -1.15f, 1.45f), S1(0.38f, 0.38f, 2.3f)), dark, 1, 1); P->barrel = bUpload(B); P->hasBarrel = 1;
}
// The mech from the sketch: square torso, domed cockpit, missile pods on the shoulders.
static void bodyReverse(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc) {
  CUBE(ch2(m4T(0, 1.3f, 0), S1(3.2f, 2.6f, 2.4f)), c, 0.95f, 0.95f);
  CUBE(ch2(m4T(0, 2.95f, 0.2f), S1(1.6f, 0.8f, 1.5f)), c, 0.6f, 0.6f); CUBE(ch2(m4T(0, 3.42f, 0.2f), S1(0.95f, 0.25f, 0.9f)), c, 0.55f, 0.55f);
  CUBE(ch2(m4T(0, 3.0f, 0.92f), S1(0.95f, 0.26f, 0.12f)), GLASS, 1, 1);
  for (int sx = -1; sx <= 1; sx += 2) {
    CUBE(ch2(m4T(sx * 1.75f, 3.0f, -0.1f), S1(1.25f, 1.25f, 1.45f)), acc, 1, 1);
    for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) CUBE(ch2(m4T(sx * 1.75f + (i - 1) * 0.34f, 3.0f + (j - 1) * 0.34f, 0.64f), S1(0.2f, 0.2f, 0.06f)), TUBE, 1, 1);
  }
  CUBE(ch2(m4T(0, 1.0f, -1.35f), S1(2, 1.6f, 0.5f)), dark, 1, 1);
  P->torso = bUpload(B);
  CUBE(ch2(m4T(0, -0.6f, 0.1f), S1(0.95f, 1.8f, 1.15f)), c, 1, 1); hinge(B, V3(0, 0.15f, 0), 1.45f, 1.2f, dark); P->arm = bUpload(B);
  P->barrelAt = V3(0, -1.15f, 1.45f); CUBE(ch2(m4T(0, -1.15f, 1.45f), S1(0.38f, 0.38f, 2.3f)), dark, 1, 1); P->barrel = bUpload(B); P->hasBarrel = 1;
}
// PURPLE PUNCHER: a torso wider than it is tall, shoulders like a fridge, a low cockpit slit under a flat head,
// short thick arms, and two oversized yellow fists (their own part, so they swing and read as fists from 400 m).
static void bodyPuncher(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc) {
  float acc75[3], acc85[3]; col3(acc75, acc, 0.75f); col3(acc85, acc, 0.85f);
  CUBE(ch2(m4T(0, 1.2f, 0), S1(4.6f, 2.4f, 3.0f)), c, 0.92f, 0.9f);
  for (int sx = -1; sx <= 1; sx += 2) CUBE(ch2(m4T(sx * 2.45f, 1.75f, -0.05f), S1(1.5f, 1.7f, 2.3f)), dark, 0.9f, 0.9f);
  CUBE(ch2(m4T(0, 2.62f, 0.25f), S1(1.9f, 0.45f, 1.6f)), c, 0.85f, 0.85f); CUBE(ch2(m4T(0, 1.8f, 1.52f), S1(2.4f, 0.26f, 0.08f)), GLASS, 1, 1);
  CUBE(ch2(m4T(0, 0.95f, -1.75f), S1(2.8f, 1.6f, 0.6f)), dark, 1, 1); CUBE(ch2(m4T(-0.9f, 0.9f, 1.75f), S1(0.42f, 0.42f, 1.2f)), dark, 1, 1);
  CUBE(ch2(m4T(-1.25f, 2.55f, 0.1f), S1(1.0f, 0.7f, 1.2f)), acc, 1, 1);
  for (int i = 0; i < 3; i++) for (int j = 0; j < 2; j++) CUBE(ch2(m4T(-1.25f + (i - 1) * 0.28f, 2.42f + j * 0.28f, 0.72f), S1(0.18f, 0.18f, 0.06f)), TUBE, 1, 1);
  P->torso = bUpload(B);
  CUBE(ch2(m4T(0, -0.55f, 0.1f), S1(1.35f, 1.5f, 1.45f)), c, 1, 1); hinge(B, V3(0, 0.15f, 0), 1.8f, 1.6f, dark); P->arm = bUpload(B);
  CUBE(ch2(m4T(0, -1.75f, 0.3f), S1(1.65f, 1.5f, 1.7f)), acc, 0.95f, 0.95f);
  for (int i = 0; i < 4; i++) CUBE(ch2(m4T((i - 1.5f) * 0.4f, -2.55f, 0.35f), S1(0.34f, 0.22f, 1.5f)), acc75, 1, 1);
  CUBE(ch2(m4T(0.95f, -1.6f, 0.75f), S1(0.35f, 0.8f, 0.6f)), acc85, 1, 1);
  P->fist = bUpload(B); P->hasFist = 1;
}
// BIG TROUBLE: a narrow torso with a single eye slit, a little fin, a RATATAT stub low on the front, small arms.
static void bodyLight1(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc) {
  CUBE(ch2(m4T(0, 1.1f, 0), S1(2.2f, 2.0f, 2.0f)), c, 0.85f, 0.8f); CUBE(ch2(m4T(0, 1.55f, 1.02f), S1(1.3f, 0.18f, 0.06f)), GLASS, 1, 1);
  CUBE(ch2(m4T(0, 2.3f, -0.25f), S1(0.28f, 0.6f, 1.3f)), acc, 0.6f, 0.7f); CUBE(ch2(m4T(0, 0.9f, -1.15f), S1(1.4f, 1.2f, 0.4f)), dark, 1, 1); CUBE(ch2(m4T(-0.7f, 0.8f, 1.2f), S1(0.22f, 0.22f, 0.9f)), dark, 1, 1);
  P->torso = bUpload(B);
  CUBE(ch2(m4T(0, -0.45f, 0.05f), S1(0.7f, 1.2f, 0.85f)), c, 1, 1); hinge(B, V3(0, 0.1f, 0), 1.05f, 0.9f, dark); P->arm = bUpload(B);
  P->barrelAt = V3(0, -0.85f, 1.1f); CUBE(ch2(m4T(0, -0.85f, 1.1f), S1(0.3f, 0.3f, 1.6f)), dark, 1, 1); P->barrel = bUpload(B); P->hasBarrel = 1;
}
// LONG LARRY: a slim torso with a visor, a tall sensor mast with a dish, a LIL ZAPPER stub on the front, slim arms.
static void bodySniper1(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc) {
  CUBE(ch2(m4T(0, 1.25f, 0), S1(2.6f, 2.3f, 2.3f)), c, 0.85f, 0.85f); CUBE(ch2(m4T(0, 1.95f, 1.17f), S1(1.4f, 0.45f, 0.1f)), GLASS, 1, 1);
  CUBE(ch2(m4T(0.7f, 3.4f, -0.5f), S1(0.18f, 2.3f, 0.18f)), dark, 1, 1); CUBE(ch2(m4T(0.7f, 4.6f, -0.5f), S1(0.7f, 0.22f, 0.7f)), acc, 1, 1); CUBE(ch2(m4T(0.7f, 4.0f, -0.3f), S1(0.55f, 0.55f, 0.1f)), acc, 1, 1);
  CUBE(ch2(m4T(0, 1.0f, -1.3f), S1(1.8f, 1.4f, 0.5f)), dark, 1, 1); CUBE(ch2(m4T(-0.9f, 1.3f, 1.3f), S1(0.25f, 0.25f, 0.7f)), dark, 1, 1);
  P->torso = bUpload(B);
  CUBE(ch2(m4T(0, -0.55f, 0.1f), S1(0.8f, 1.6f, 1.0f)), c, 1, 1); hinge(B, V3(0, 0.15f, 0), 1.3f, 1.05f, acc); P->arm = bUpload(B);
  P->barrelAt = V3(0, -1.0f, 1.5f); CUBE(ch2(m4T(0, -1.0f, 1.5f), S1(0.34f, 0.34f, 2.4f)), dark, 1, 1); P->barrel = bUpload(B); P->hasBarrel = 1;
}
// The quadruped's turret: cockpit at the front, an ANGRY BEES box on top.
static void bodyQuad(Builder *B, MechParts *P, const float *c, const float *dark, const float *acc) {
  CUBE(ch2(m4T(0, 0.7f, 0), S1(2.7f, 1.4f, 2.5f)), c, 0.85f, 0.85f); CUBE(ch2(m4T(0, 0.85f, 1.3f), S1(1.5f, 0.5f, 0.25f)), GLASS, 1, 1); CUBE(ch2(m4T(0, 1.75f, -0.3f), S1(1.8f, 0.75f, 1.5f)), acc, 1, 1);
  for (int i = 0; i < 4; i++) for (int j = 0; j < 2; j++) CUBE(ch2(m4T((i - 1.5f) * 0.4f, 1.6f + j * 0.3f, 0.46f), S1(0.22f, 0.22f, 0.06f)), TUBE, 1, 1);
  P->torso = bUpload(B);
  CUBE(ch2(m4T(0, -0.35f, 0.2f), S1(0.8f, 1.1f, 1.6f)), c, 1, 1); hinge(B, V3(0, 0, 0), 1.1f, 0.9f, dark); P->arm = bUpload(B);
  P->barrelAt = V3(0, -0.5f, 1.6f); CUBE(ch2(m4T(0, -0.5f, 1.6f), S1(0.36f, 0.36f, 2.4f)), dark, 1, 1); P->barrel = bUpload(B); P->hasBarrel = 1;
}
MechParts buildMechParts(int chassis) {
  Builder B = { { 0 } }; MechParts P; memset(&P, 0, sizeof P);
  const Chassis *ch = &CHASSIS[chassis]; const Geo *g = geoFor(chassis); float dark[3]; col3(dark, ch->col, 0.55f);
  switch (ch->legs) { case LEG_REVERSE: legsReverse(&B, &P, ch->col, dark, g); break; case LEG_QUAD: legsQuad(&B, &P, ch->col, dark, ch->acc, g); break; default: legsForward(&B, &P, ch->col, dark, g); break; }
  { m4 m = S1(0.9f, 0.12f, 0.7f); bCube(&B, &m, ch->col, 1, 1); P.plate = bUpload(&B); }
  switch (ch->style) {
    case STYLE_REVERSE: bodyReverse(&B, &P, ch->col, dark, ch->acc); break;
    case STYLE_QUAD: bodyQuad(&B, &P, ch->col, dark, ch->acc); break;
    case STYLE_PUNCHER: bodyPuncher(&B, &P, ch->col, dark, ch->acc); break;
    case STYLE_LIGHT1: bodyLight1(&B, &P, ch->col, dark, ch->acc); break;
    case STYLE_SNIPER1: bodySniper1(&B, &P, ch->col, dark, ch->acc); break;
    default: bodyForward(&B, &P, ch->col, dark, ch->acc); break;
  }
  free(B.b.d);
  return P;
}
// --- effect shapes (spec 14: effects are solids; each kind has a shape that reads at a glance) ---
Mesh buildEffectShape(int kind) {
  Builder B = { { 0 } }; static const float W[3] = { 1, 1, 1 }; m4 I = m4id(); v3 o = V3(0, 0, 0);
  switch (kind) {
    case FX_CUBE: bCube(&B, &I, W, 1, 1); break;
    case FX_FLAT: { m4 m = S1(1.6f, 0.35f, 1.6f); bCube(&B, &m, W, 1, 1); break; }
    case FX_CHUNK: bCube(&B, &I, W, 0.6f, 0.7f); break;
    case FX_TETRA: { v3 a = V3(0, 0.6f, 0), b = V3(-0.5f, -0.3f, 0.45f), c = V3(0.5f, -0.3f, 0.45f), d = V3(0, -0.3f, -0.55f);
      bTri(&B, a, b, c, W, &o, 0); bTri(&B, a, c, d, W, &o, 0); bTri(&B, a, d, b, W, &o, 0); bTri(&B, b, d, c, W, &o, 0); break; }
    case FX_SPARK: { m4 m = S1(0.16f, 0.16f, 1); bCube(&B, &m, W, 1, 1); break; }
    case FX_SHELL: { m4 m = S1(0.3f, 0.3f, 1.4f); bCube(&B, &m, W, 1, 1); break; }
    case FX_BOLT: bSphere(&B, &I, W, 8, 4); break;
    case FX_MISSILE: { m4 m = ch2(m4RX(PI_F / 2), S1(0.5f, 1.4f, 0.5f)); bCyl(&B, &m, W, 6, 1); m4 n = ch3(m4T(0, 0, 1.0f), m4RX(PI_F / 2), S1(0.5f, 0.6f, 0.5f)); bCyl(&B, &n, W, 6, 0); break; }
    case FX_BEAM: { m4 m = ch2(m4T(0, 0.5f, 0), S1(1, 1, 1)); bCube(&B, &m, W, 1, 1); break; }   // a unit box from y 0 to 1: beamMat lays it from a to b
    case FX_RING: case FX_DISC: { int n = 16; float in = kind == FX_RING ? 0.82f : 0;
      for (int i = 0; i < n; i++) { float a0 = i / (float)n * TAU, a1 = (i + 1) / (float)n * TAU;
        v3 p0 = V3(sinf(a0), 0, cosf(a0)), p1 = V3(sinf(a1), 0, cosf(a1)), q0 = vmul(p0, in), q1 = vmul(p1, in);
        if (in > 0) { bTri(&B, p0, p1, q1, W, NULL, 1); bTri(&B, p0, q1, q0, W, NULL, 1); } else bTri(&B, p0, p1, V3(0, 0, 0), W, NULL, 1); }
      break; }
    case FX_STAR: { int n = 7; for (int i = 0; i < n; i++) { float a = i / (float)n * TAU, b = (i + 0.5f) / (float)n * TAU, c = (i + 1) / (float)n * TAU;
      v3 p = V3(sinf(a) * 0.35f, cosf(a) * 0.35f, 0), q = V3(sinf(b), cosf(b), 0), r = V3(sinf(c) * 0.35f, cosf(c) * 0.35f, 0);
      bTri(&B, p, q, r, W, NULL, 0); bTri(&B, r, q, p, W, NULL, 0); bTri(&B, V3(0, 0, 0), p, r, W, NULL, 0); bTri(&B, V3(0, 0, 0), r, p, W, NULL, 0); } break; }
    default: break;
  }
  Mesh m = bUpload(&B); free(B.b.d); return m;
}
// The terrain in chunks: a cell is two triangles with the same split height() samples; coloured by height and slope.
Mesh buildTerrainChunk(const Terrain *t, int cx, int cz, const PalDef *pal) {
  Builder B = { { 0 } }; int cw = t->nx / TER_CHUNKS, ch = t->nz / TER_CHUNKS;
  for (int j = cz * ch; j < (cz + 1) * ch; j++) for (int i = cx * cw; i < (cx + 1) * cw; i++) {
    float x0 = -t->hx + i * TER_CELL, z0 = -t->hz + j * TER_CELL, x1 = x0 + TER_CELL, z1 = z0 + TER_CELL;
    int W = t->nx + 1; float h00 = t->hs[j * W + i], h10 = t->hs[j * W + i + 1], h01 = t->hs[(j + 1) * W + i], h11 = t->hs[(j + 1) * W + i + 1];
    v3 a = V3(x0, h00, z0), b = V3(x1, h10, z0), c = V3(x0, h01, z1), d = V3(x1, h11, z1);
    v3 tris[2][3] = { { a, b, c }, { d, c, b } };   // the split height() samples: fx + fz < 1 is the (00, 10, 01) triangle
    for (int k = 0; k < 2; k++) {
      v3 n = vnorm(vcross(vsub(tris[k][1], tris[k][0]), vsub(tris[k][2], tris[k][0]))); if (n.y < 0) n = vmul(n, -1);
      float hm = (tris[k][0].y + tris[k][1].y + tris[k][2].y) / 3, u = clampf(hm / 230, 0, 1), col[3], slope = 1 - n.y;
      float hash = sinf(i * 12.9898f + j * 78.233f + k * 3.7f) * 43758.5453f; hash = (hash - floorf(hash)) * 0.08f - 0.04f;   // a little grain, so flats aren't one slab
      for (int q = 0; q < 3; q++) { float base = u < 0.5f ? lerpf(pal->low[q], pal->mid[q], u * 2) : lerpf(pal->mid[q], pal->high[q], (u - 0.5f) * 2); col[q] = clampf(lerpf(base, pal->rock[q], smooth((slope - 0.25f) / 0.3f)) * (1 + hash), 0, 1); }
      bTri(&B, tris[k][0], tris[k][1], tris[k][2], col, NULL, 1);
    }
  }
  Mesh m = bUpload(&B); free(B.b.d); return m;
}
Mesh buildSky(void) { Builder B = { { 0 } }; static const float W[3] = { 1, 1, 1 }; m4 m = S1(2, 2, 2); bSphere(&B, &m, W, 16, 8); Mesh s = bUpload(&B); free(B.b.d); return s; }
Mesh buildWreck(int chassis) {
  Builder B = { { 0 } }; const Chassis *ch = &CHASSIS[chassis]; float dark[3], dim[3]; col3(dark, ch->col, 0.35f); col3(dim, ch->col, 0.5f);
  m4 a = ch2(m4T(0, 0.9f, 0), S1(3.4f, 1.6f, 3.0f)); bCube(&B, &a, dim, 0.8f, 0.8f);
  m4 b = ch2(m4T(0, 0.5f, -1.6f), S1(2.8f, 1.0f, 1.8f)); bCube(&B, &b, dark, 1, 1);
  m4 c = ch3(m4T(1.2f, 0.4f, 1.4f), m4RY(0.5f), S1(0.8f, 0.8f, 1.8f)); bCube(&B, &c, dark, 1, 1);
  Mesh w = bUpload(&B); free(B.b.d); return w;
}
