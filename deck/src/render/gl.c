#include "render/gl.h"
#include <SDL.h>
#include <GL/gl.h>
#include <GL/glext.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define GLFN(ret, name, args) static ret (APIENTRYP p##name) args;
#define GLLIST \
  GLFN(GLuint, glCreateShader, (GLenum)) GLFN(void, glShaderSource, (GLuint, GLsizei, const GLchar *const *, const GLint *)) GLFN(void, glCompileShader, (GLuint)) \
  GLFN(void, glGetShaderiv, (GLuint, GLenum, GLint *)) GLFN(void, glGetShaderInfoLog, (GLuint, GLsizei, GLsizei *, GLchar *)) GLFN(GLuint, glCreateProgram, (void)) \
  GLFN(void, glAttachShader, (GLuint, GLuint)) GLFN(void, glLinkProgram, (GLuint)) GLFN(void, glGetProgramiv, (GLuint, GLenum, GLint *)) GLFN(void, glGetProgramInfoLog, (GLuint, GLsizei, GLsizei *, GLchar *)) \
  GLFN(void, glUseProgram, (GLuint)) GLFN(GLint, glGetUniformLocation, (GLuint, const GLchar *)) GLFN(void, glUniformMatrix4fv, (GLint, GLsizei, GLboolean, const GLfloat *)) \
  GLFN(void, glUniform3f, (GLint, GLfloat, GLfloat, GLfloat)) GLFN(void, glUniform1f, (GLint, GLfloat)) GLFN(void, glUniform1i, (GLint, GLint)) GLFN(void, glUniform2f, (GLint, GLfloat, GLfloat)) \
  GLFN(void, glGenVertexArrays, (GLsizei, GLuint *)) GLFN(void, glBindVertexArray, (GLuint)) GLFN(void, glDeleteVertexArrays, (GLsizei, const GLuint *)) \
  GLFN(void, glGenBuffers, (GLsizei, GLuint *)) GLFN(void, glBindBuffer, (GLenum, GLuint)) GLFN(void, glBufferData, (GLenum, GLsizeiptr, const void *, GLenum)) GLFN(void, glDeleteBuffers, (GLsizei, const GLuint *)) \
  GLFN(void, glEnableVertexAttribArray, (GLuint)) GLFN(void, glDisableVertexAttribArray, (GLuint)) GLFN(void, glVertexAttribPointer, (GLuint, GLint, GLenum, GLboolean, GLsizei, const void *)) \
  GLFN(void, glVertexAttribDivisor, (GLuint, GLuint)) GLFN(void, glVertexAttrib4f, (GLuint, GLfloat, GLfloat, GLfloat, GLfloat)) GLFN(void, glDrawArraysInstanced, (GLenum, GLint, GLsizei, GLsizei)) \
  GLFN(void, glBindAttribLocation, (GLuint, GLuint, const GLchar *))
GLLIST
#undef GLFN
#define glCreateShader pglCreateShader
#define glShaderSource pglShaderSource
#define glCompileShader pglCompileShader
#define glGetShaderiv pglGetShaderiv
#define glGetShaderInfoLog pglGetShaderInfoLog
#define glCreateProgram pglCreateProgram
#define glAttachShader pglAttachShader
#define glLinkProgram pglLinkProgram
#define glGetProgramiv pglGetProgramiv
#define glGetProgramInfoLog pglGetProgramInfoLog
#define glUseProgram pglUseProgram
#define glGetUniformLocation pglGetUniformLocation
#define glUniformMatrix4fv pglUniformMatrix4fv
#define glUniform3f pglUniform3f
#define glUniform1f pglUniform1f
#define glUniform1i pglUniform1i
#define glUniform2f pglUniform2f
#define glGenVertexArrays pglGenVertexArrays
#define glBindVertexArray pglBindVertexArray
#define glDeleteVertexArrays pglDeleteVertexArrays
#define glGenBuffers pglGenBuffers
#define glBindBuffer pglBindBuffer
#define glBufferData pglBufferData
#define glDeleteBuffers pglDeleteBuffers
#define glEnableVertexAttribArray pglEnableVertexAttribArray
#define glDisableVertexAttribArray pglDisableVertexAttribArray
#define glVertexAttribPointer pglVertexAttribPointer
#define glVertexAttribDivisor pglVertexAttribDivisor
#define glVertexAttrib4f pglVertexAttrib4f
#define glDrawArraysInstanced pglDrawArraysInstanced
#define glBindAttribLocation pglBindAttribLocation

static const char *VS =
  "#version 330 core\n"
  "layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;"
  "layout(location=3) in vec4 m0; layout(location=4) in vec4 m1; layout(location=5) in vec4 m2; layout(location=6) in vec4 m3; layout(location=7) in vec4 aInst;"
  "uniform mat4 uVP; uniform vec3 uEye; uniform vec3 uLight; uniform vec3 uShade; uniform int uMode;"
  "out vec3 vCol; out float vDist; out float vEm;"
  "void main() {"
  "  mat4 M = mat4(m0, m1, m2, m3);"
  "  vec4 wp = M * vec4(aPos, 1.0);"
  "  vec3 n = normalize(mat3(M) * aNrm);"
  "  vec3 col = aCol * aInst.rgb;"
  "  float em = max(aInst.a, uMode == 1 ? 1.0 : 0.0);"
  "  float diff = max(0.0, dot(n, uLight)) * 0.72 + 0.28 + 0.1 * n.y;"
  "  vec3 lit = col * diff * uShade;"
  "  vCol = (uMode == 0) ? mix(lit, col, em) : (uMode == 2 ? normalize(aPos) : col);"
  "  vEm = em; vDist = length(wp.xyz - uEye);"
  "  if (uMode == 2) { vec3 d = normalize(aPos); gl_Position = uVP * vec4(uEye + d * 1500.0, 1.0); gl_Position.z = gl_Position.w * 0.9999; }"
  "  else gl_Position = uVP * wp;"
  "}";
static const char *FS =
  "#version 330 core\n"
  "in vec3 vCol; in float vDist; in float vEm; out vec4 o;"
  "uniform vec3 uFog; uniform vec2 uFogRange; uniform int uMode; uniform float uDither; uniform vec3 uZen; uniform vec3 uHor;"
  "const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);"
  "void main() {"
  "  if (uDither < 1.0) { int x = int(gl_FragCoord.x) & 3, y = int(gl_FragCoord.y) & 3; if ((B[y * 4 + x] + 0.5) / 16.0 >= uDither) discard; }"
  "  vec3 c = vCol;"
  "  if (uMode == 2) { float t = smoothstep(-0.02, 0.35, vCol.y); c = mix(uHor, uZen, t); }"
  "  else if (uMode != 3) { float f = clamp((vDist - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0); c = mix(c, uFog, f * f * (3.0 - 2.0 * f)); }"
  "  o = vec4(c, 1.0);"
  "}";
static GLuint prog; static GLint uVP, uEye, uLight, uShade, uMode, uFog, uFogRange, uDither, uZen, uHor; static int draws, mode;

static GLuint compile(GLenum type, const char *src) {
  GLuint s = glCreateShader(type); glShaderSource(s, 1, &src, NULL); glCompileShader(s);
  GLint ok; glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, NULL, log); fprintf(stderr, "shader: %s\n", log); }
  return s;
}
int glrInit(void) {
#define GLFN(ret, name, args) p##name = (ret (APIENTRYP) args)SDL_GL_GetProcAddress(#name); if (!p##name) { fprintf(stderr, "GL: no %s\n", #name); return 0; }
  GLLIST
#undef GLFN
  printf("GL: %s on %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));
  prog = glCreateProgram(); glAttachShader(prog, compile(GL_VERTEX_SHADER, VS)); glAttachShader(prog, compile(GL_FRAGMENT_SHADER, FS)); glLinkProgram(prog);
  GLint ok; glGetProgramiv(prog, GL_LINK_STATUS, &ok);
  if (!ok) { char log[2048]; glGetProgramInfoLog(prog, sizeof log, NULL, log); fprintf(stderr, "link: %s\n", log); return 0; }
  glUseProgram(prog);
  uVP = glGetUniformLocation(prog, "uVP"); uEye = glGetUniformLocation(prog, "uEye"); uLight = glGetUniformLocation(prog, "uLight"); uShade = glGetUniformLocation(prog, "uShade"); uMode = glGetUniformLocation(prog, "uMode");
  uFog = glGetUniformLocation(prog, "uFog"); uFogRange = glGetUniformLocation(prog, "uFogRange"); uDither = glGetUniformLocation(prog, "uDither"); uZen = glGetUniformLocation(prog, "uZen"); uHor = glGetUniformLocation(prog, "uHor");
  glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE); glCullFace(GL_BACK); glDisable(GL_BLEND);
  return 1;
}
void glrBegin(int w, int h, const float *c) { glViewport(0, 0, w, h); glClearColor(c[0], c[1], c[2], 1); glDepthMask(GL_TRUE); glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT); draws = 0; glUseProgram(prog); glrDither(1); }
void glrSetCamera(const m4 *vp, v3 eye) { glUniformMatrix4fv(uVP, 1, GL_FALSE, vp->m); glUniform3f(uEye, eye.x, eye.y, eye.z); }
void glrSetLight(const float l[3], const float s[3], const float f[3], float n, float fa) { glUniform3f(uLight, l[0], l[1], l[2]); glUniform3f(uShade, s[0], s[1], s[2]); glUniform3f(uFog, f[0], f[1], f[2]); glUniform2f(uFogRange, n, fa); }
void glrMode(int m) { mode = m; glUniform1i(uMode, m); if (m == 3) { glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); } else { glEnable(GL_DEPTH_TEST); if (m == 2) glDisable(GL_CULL_FACE); else glEnable(GL_CULL_FACE); } }
void glrDither(float c) { glUniform1f(uDither, c); }
void glrDepth(int test, int write) { if (test) glEnable(GL_DEPTH_TEST); else glDisable(GL_DEPTH_TEST); glDepthMask(write ? GL_TRUE : GL_FALSE); }
void glrSkyColours(const float zen[3], const float hor[3]);
void glrSkyColours(const float zen[3], const float hor[3]) { glUniform3f(uZen, zen[0], zen[1], zen[2]); glUniform3f(uHor, hor[0], hor[1], hor[2]); }
static void layout(void) {
  GLsizei st = 9 * sizeof(float);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(3 * sizeof(float)));
  glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, st, (void *)(6 * sizeof(float)));
}
Mesh glrUpload(const float *v, int n) {
  Mesh m = { 0 }; glGenVertexArrays(1, &m.vao); glGenBuffers(1, &m.vbo); glBindVertexArray(m.vao); glBindBuffer(GL_ARRAY_BUFFER, m.vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)n * 9 * sizeof(float), v, GL_STATIC_DRAW); layout(); m.n = n; glBindVertexArray(0); return m;
}
void glrUpdate(Mesh *m, const float *v, int n) {
  if (!m->vao) { *m = glrUpload(v, n); return; }
  glBindVertexArray(m->vao); glBindBuffer(GL_ARRAY_BUFFER, m->vbo); glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)n * 9 * sizeof(float), v, GL_STREAM_DRAW); m->n = n; glBindVertexArray(0);
}
void glrFree(Mesh *m) { if (m->vao) { glDeleteVertexArrays(1, &m->vao); glDeleteBuffers(1, &m->vbo); } m->vao = m->vbo = 0; m->n = 0; }
static void modelAttribs(const m4 *model, const float col[3], float em) {
  for (int i = 3; i <= 7; i++) glDisableVertexAttribArray(i);
  for (int c = 0; c < 4; c++) glVertexAttrib4f(3 + c, model->m[c * 4], model->m[c * 4 + 1], model->m[c * 4 + 2], model->m[c * 4 + 3]);
  glVertexAttrib4f(7, col[0], col[1], col[2], em);
}
void glrDrawCol(const Mesh *m, const m4 *model, const float col[3], float em) {
  if (!m->n) return;
  glBindVertexArray(m->vao); modelAttribs(model, col, em); glDrawArrays(GL_TRIANGLES, 0, m->n); draws++;
}
void glrDraw(const Mesh *m, const m4 *model) { static const float W[3] = { 1, 1, 1 }; glrDrawCol(m, model, W, 0); }
InstBuf glrInstBuf(int cap) { InstBuf b = { 0, cap }; glGenBuffers(1, &b.vbo); return b; }
void glrDrawInst(const Mesh *m, InstBuf *b, const float *inst, int count) {
  if (!m->n || count <= 0) return;
  glBindVertexArray(m->vao); glBindBuffer(GL_ARRAY_BUFFER, b->vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)count * 20 * sizeof(float), inst, GL_STREAM_DRAW);
  GLsizei st = 20 * sizeof(float);
  for (int i = 0; i < 5; i++) { glEnableVertexAttribArray(3 + i); glVertexAttribPointer(3 + i, 4, GL_FLOAT, GL_FALSE, st, (void *)(size_t)(i * 4 * sizeof(float))); glVertexAttribDivisor(3 + i, 1); }
  glDrawArraysInstanced(GL_TRIANGLES, 0, m->n, count); draws++;
  for (int i = 0; i < 5; i++) { glVertexAttribDivisor(3 + i, 0); glDisableVertexAttribArray(3 + i); }
  glBindVertexArray(0);
}
void fbPush(FloatBuf *b, const float *v, int n) {
  if (b->n + n > b->cap) { b->cap = (b->n + n) * 2 + 1024; b->d = realloc(b->d, b->cap * sizeof(float)); }
  memcpy(b->d + b->n, v, n * sizeof(float)); b->n += n;
}
void fbClear(FloatBuf *b) { b->n = 0; }
int glrDrawCalls(void) { return draws; }
// A screenshot: the frame as RGB, bottom row first.
void glrReadPixels(int w, int h, unsigned char *rgb);
void glrReadPixels(int w, int h, unsigned char *rgb) { glPixelStorei(GL_PACK_ALIGNMENT, 1); glReadPixels(0, 0, w, h, GL_RGB, GL_UNSIGNED_BYTE, rgb); }
