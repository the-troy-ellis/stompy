// Scalars, 3-vectors and 4x4 column-major matrices. Plain C, no allocation.
#ifndef MATHX_H
#define MATHX_H
#include <math.h>

#define TAU 6.28318530717958647692f
#define PI_F 3.14159265358979323846f

typedef struct { float x, y, z; } v3;
typedef struct { float m[16]; } m4;

static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static inline float lerpf(float a, float b, float t) { return a + (b - a) * t; }
static inline float smooth(float t) { t = clampf(t, 0, 1); return t * t * (3 - 2 * t); }
static inline float wrapA(float a) { a = fmodf(a, TAU); if (a > PI_F) a -= TAU; if (a < -PI_F) a += TAU; return a; }
static inline float signf(float v) { return v > 0 ? 1.f : v < 0 ? -1.f : 0.f; }
static inline float minf(float a, float b) { return a < b ? a : b; }
static inline float maxf(float a, float b) { return a > b ? a : b; }
static inline float hypot2(float x, float z) { return sqrtf(x * x + z * z); }

static inline v3 V3(float x, float y, float z) { v3 r = { x, y, z }; return r; }
static inline v3 vadd(v3 a, v3 b) { return V3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline v3 vsub(v3 a, v3 b) { return V3(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline v3 vmul(v3 a, float s) { return V3(a.x * s, a.y * s, a.z * s); }
static inline float vdot(v3 a, v3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline v3 vcross(v3 a, v3 b) { return V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
static inline float vlen(v3 a) { return sqrtf(a.x * a.x + a.y * a.y + a.z * a.z); }
static inline v3 vnorm(v3 a) { float l = vlen(a); if (l < 1e-9f) l = 1; return vmul(a, 1 / l); }
static inline v3 vmix(v3 a, v3 b, float t) { return V3(lerpf(a.x, b.x, t), lerpf(a.y, b.y, t), lerpf(a.z, b.z, t)); }
// Unit vector for a yaw (about +y, growing to the left) and a pitch.
static inline v3 dirOf(float yaw, float pitch) { return V3(sinf(yaw) * cosf(pitch), sinf(pitch), cosf(yaw) * cosf(pitch)); }

m4 m4id(void);
m4 m4mul(m4 a, m4 b);
m4 m4T(float x, float y, float z);
m4 m4S(float x, float y, float z);
m4 m4RX(float a);
m4 m4RY(float a);
m4 m4RZ(float a);
m4 m4persp(float fovy, float aspect, float n, float f);
m4 m4ortho(float l, float r, float b, float t, float n, float f);
m4 m4lookAt(v3 eye, v3 at, v3 up);
v3 m4apply(const m4 *m, v3 p);
v3 m4applyDir(const m4 *m, v3 d);
// A matrix that hangs a limb mesh (built along -y from its pivot) from P to Q, bending toward `pole`.
m4 m4limb(v3 P, v3 Q, v3 pole, float s);
#endif
