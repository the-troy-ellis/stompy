#include "util/mathx.h"

m4 m4id(void) { m4 r = {{1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1}}; return r; }
m4 m4mul(m4 a, m4 b) {
  m4 o;
  for (int c = 0; c < 4; c++) for (int r = 0; r < 4; r++)
    o.m[c * 4 + r] = a.m[r] * b.m[c * 4] + a.m[4 + r] * b.m[c * 4 + 1] + a.m[8 + r] * b.m[c * 4 + 2] + a.m[12 + r] * b.m[c * 4 + 3];
  return o;
}
m4 m4T(float x, float y, float z) { m4 r = m4id(); r.m[12] = x; r.m[13] = y; r.m[14] = z; return r; }
m4 m4S(float x, float y, float z) { m4 r = m4id(); r.m[0] = x; r.m[5] = y; r.m[10] = z; return r; }
m4 m4RY(float a) { float c = cosf(a), s = sinf(a); m4 r = {{c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1}}; return r; }
m4 m4RX(float a) { float c = cosf(a), s = sinf(a); m4 r = {{1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1}}; return r; }
m4 m4RZ(float a) { float c = cosf(a), s = sinf(a); m4 r = {{c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1}}; return r; }
m4 m4persp(float fovy, float aspect, float n, float f) {
  float t = 1 / tanf(fovy / 2);
  m4 r = {{t / aspect,0,0,0, 0,t,0,0, 0,0,(f + n) / (n - f),-1, 0,0,(2 * f * n) / (n - f),0}};
  return r;
}
m4 m4ortho(float l, float r, float b, float t, float n, float f) {
  m4 o = m4id();
  o.m[0] = 2 / (r - l); o.m[5] = 2 / (t - b); o.m[10] = -2 / (f - n);
  o.m[12] = -(r + l) / (r - l); o.m[13] = -(t + b) / (t - b); o.m[14] = -(f + n) / (f - n);
  return o;
}
m4 m4lookAt(v3 eye, v3 at, v3 up) {
  v3 z = vnorm(vsub(eye, at)), x = vnorm(vcross(up, z)), y = vcross(z, x);
  m4 r = {{x.x,y.x,z.x,0, x.y,y.y,z.y,0, x.z,y.z,z.z,0, -vdot(x, eye),-vdot(y, eye),-vdot(z, eye),1}};
  return r;
}
v3 m4apply(const m4 *mm, v3 p) {
  const float *m = mm->m;
  return V3(m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12], m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13], m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]);
}
v3 m4applyDir(const m4 *mm, v3 p) {
  const float *m = mm->m;
  return V3(m[0] * p.x + m[4] * p.y + m[8] * p.z, m[1] * p.x + m[5] * p.y + m[9] * p.z, m[2] * p.x + m[6] * p.y + m[10] * p.z);
}
m4 m4limb(v3 P, v3 Q, v3 pole, float s) {
  float yx = P.x - Q.x, yy = P.y - Q.y, yz = P.z - Q.z;
  float yl = sqrtf(yx * yx + yy * yy + yz * yz); if (yl < 1e-9f) yl = 1; yx /= yl; yy /= yl; yz /= yl;
  float pd = pole.x * yx + pole.y * yy + pole.z * yz;
  float zx = pole.x - yx * pd, zy = pole.y - yy * pd, zz = pole.z - yz * pd;
  float zl = sqrtf(zx * zx + zy * zy + zz * zz);
  if (zl < 1e-4f) { zx = 0; zy = 0; zz = 1; } else { zx /= zl; zy /= zl; zz /= zl; }
  float xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
  m4 o = {{xx * s, xy * s, xz * s, 0, yx * s, yy * s, yz * s, 0, zx * s, zy * s, zz * s, 0, P.x, P.y, P.z, 1}};
  return o;
}
