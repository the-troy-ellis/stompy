#include "render/hud.h"
#include "data/names.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
const float HUD_GREEN[3] = { 0.36f, 1, 0.36f }, HUD_AMBER[3] = { 1, 0.8f, 0.2f }, HUD_RED[3] = { 1, 0.27f, 0.27f }, HUD_DIM[3] = { 0.14f, 0.42f, 0.14f }, HUD_WHITE[3] = { 0.95f, 1, 0.95f }, HUD_BLACK[3] = { 0.02f, 0.03f, 0.02f };
struct Hud { FloatBuf b; Mesh m; int w, h; };
// The 5x7 font: ASCII 32 to 95 (lower case is drawn as upper), seven rows of five.
static const char *FONT[64] = {
  "...................................",
  "..#....#....#....#....#.........#..",
  "",
  "",
  "",
  "##..###..#...#...#...#...#..###..##",
  "",
  ".##....#...#.......................",
  "...#...#...#....#....#.....#.....#.",
  ".#.....#.....#....#....#...#...#...",
  "......#.#...#..#####..#...#.#......",
  ".......#....#..#####..#....#.......",
  ".....................##....#...#...",
  "...............#####...............",
  "..........................##...##..",
  "....#....#...#...#...#...#....#....",
  ".###.#...##..###.#.###..##...#.###.",
  "..#...##....#....#....#....#...###.",
  ".###.#...#....#...#...#...#...#####",
  "#####...#...#.....#.....##...#.###.",
  "...#...##..#.#.#..#.#####...#....#.",
  "######....####.....#....##...#.###.",
  "..###.#...#....####.#...##...#.###.",
  "#####....#...#...#...#....#....#...",
  ".###.#...##...#.###.#...##...#.###.",
  ".###.#...##...#.####....#...#.###..",
  "......##...##........##...##.......",
  "......##...##........##....#...#...",
  "...#...#...#...#.....#.....#.....#.",
  "..........#####.....#####..........",
  ".#.....#.....#.....#...#...#...#...",
  ".###.#...#....#...#...#.........#..",
  "",
  ".###.#...##...#######...##...##...#",
  "####.#...##...#####.#...##...#####.",
  ".#####....#....#....#....#.....####",
  "####.#...##...##...##...##...#####.",
  "######....#....####.#....#....#####",
  "######....#....####.#....#....#....",
  ".#####....#....#.####...##...#.####",
  "#...##...##...#######...##...##...#",
  "#####..#....#....#....#....#..#####",
  "....#....#....#....##...##...#.###.",
  "#...##..#.#.#..##...#.#..#..#.#...#",
  "#....#....#....#....#....#....#####",
  "#...###.###.#.##.#.##...##...##...#",
  "#...###..##.#.##..###...##...##...#",
  ".###.#...##...##...##...##...#.###.",
  "####.#...##...#####.#....#....#....",
  ".###.#...##...##...##.#.##..#..##.#",
  "####.#...##...#####.#.#..#..#.#...#",
  ".#####....#.....###.....#....#####.",
  "#####..#....#....#....#....#....#..",
  "#...##...##...##...##...##...#.###.",
  "#...##...##...##...#.#.#..#.#...#..",
  "#...##...##...##.#.##.#.###.###...#",
  "#...##...#.#.#...#...#.#.#...##...#",
  "#...##...#.#.#...#....#....#....#..",
  "#####....#...#...#...#...#....#####",
  ".###..#....#....#....#....#....###.",
  "",
  ".###....#....#....#....#....#..###.",
  "",
  "..............................#####",
};
static const char *GLYPH(int c) {
  static char buf[36];
  if (c >= 'a' && c <= 'z') c -= 32;
  if (c < 32 || c > 95) return NULL;
  const char *g = FONT[c - 32]; if (!g || !g[0]) return NULL;
  size_t n = strlen(g); memset(buf, '.', 35); buf[35] = 0; memcpy(buf, g, n < 35 ? n : 35);
  return buf;
}
Hud *hudInit(void) { Hud *h = calloc(1, sizeof *h); return h; }
void hudBegin(Hud *h, int w, int ht) { h->w = w; h->h = ht; fbClear(&h->b); }
static void tri(Hud *h, float x0, float y0, float x1, float y1, float x2, float y2, const float c[3]) {
  float v[27] = { x0, y0, 0, 0, 0, 1, c[0], c[1], c[2], x1, y1, 0, 0, 0, 1, c[0], c[1], c[2], x2, y2, 0, 0, 0, 1, c[0], c[1], c[2] };
  fbPush(&h->b, v, 27);
}
void hudRect(Hud *h, float x, float y, float w, float ht, const float c[3]) { tri(h, x, y, x + w, y, x + w, y + ht, c); tri(h, x, y, x + w, y + ht, x, y + ht, c); }
void hudBox(Hud *h, float x, float y, float w, float ht, float t, const float c[3]) { hudRect(h, x, y, w, t, c); hudRect(h, x, y + ht - t, w, t, c); hudRect(h, x, y, t, ht, c); hudRect(h, x + w - t, y, t, ht, c); }
void hudLine(Hud *h, float x0, float y0, float x1, float y1, float t, const float c[3]) {
  float dx = x1 - x0, dy = y1 - y0, l = sqrtf(dx * dx + dy * dy); if (l < 1e-4f) return;
  float nx = -dy / l * t / 2, ny = dx / l * t / 2;
  tri(h, x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, c); tri(h, x0 + nx, y0 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, c);
}
void hudArc(Hud *h, float cx, float cy, float r, float a0, float a1, float t, const float c[3]) {
  int n = (int)(fabsf(a1 - a0) * r / 6) + 2; if (n > 96) n = 96;
  for (int i = 0; i < n; i++) { float u0 = a0 + (a1 - a0) * i / n, u1 = a0 + (a1 - a0) * (i + 1) / n; hudLine(h, cx + sinf(u0) * r, cy - cosf(u0) * r, cx + sinf(u1) * r, cy - cosf(u1) * r, t, c); }
}
void hudPoly(Hud *h, const float *xy, int n, const float c[3]) { for (int i = 1; i < n - 1; i++) tri(h, xy[0], xy[1], xy[i * 2], xy[i * 2 + 1], xy[i * 2 + 2], xy[i * 2 + 3], c); }
float hudTextW(float px, const char *s) { return (float)strlen(s) * 6 * px - px; }
void hudText(Hud *h, float x, float y, float px, const char *s, const float c[3]) {
  for (; *s; s++, x += 6 * px) {
    const char *g = GLYPH((unsigned char)*s); if (!g) continue;
    for (int r = 0; r < 7; r++) for (int k = 0; k < 5; k++) if (g[r * 5 + k] == '#') hudRect(h, x + k * px, y + r * px, px, px, c);
  }
}
void hudTextC(Hud *h, float cx, float y, float px, const char *s, const float c[3]) { hudText(h, cx - hudTextW(px, s) / 2, y, px, s, c); }
void hudFlush(Hud *h, float dither) {
  if (!h->b.n) return;
  m4 o = m4ortho(0, (float)h->w, (float)h->h, 0, -1, 1);
  glrMode(3); glrSetCamera(&o, V3(0, 0, 0)); glrDither(dither);
  glrUpdate(&h->m, h->b.d, h->b.n / 9); m4 I = m4id(); glrDraw(&h->m, &I);
  glrDither(1); fbClear(&h->b);
}
void hudEnd(Hud *h) { hudFlush(h, 1); }
int project(const m4 *vp, v3 p, int w, int ht, float *sx, float *sy) {
  const float *m = vp->m;
  float cx = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12], cy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13], cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (cw <= 0.01f) return 0;
  *sx = (cx / cw * 0.5f + 0.5f) * w; *sy = (1 - (cy / cw * 0.5f + 0.5f)) * ht; return 1;
}

// --- the instruments -------------------------------------------------------------------------------
static const float *hpCol(float frac, float t, float out[3]) {
  if (frac <= 0) { out[0] = 0.12f; out[1] = 0.12f; out[2] = 0.12f; return out; }
  if (frac < 0.15f && fmodf(t, 0.3f) < 0.15f) return HUD_WHITE;
  return frac > 0.6f ? HUD_GREEN : frac > 0.3f ? HUD_AMBER : HUD_RED;
}
// The ring: your own damage in the middle, heat up the left, jets up the right, speed along the bottom.
static void drawRing(Hud *h, const Game *G, float cx, float cy, float R, float s) {
  const Mech *P = G->player; float t = 2.5f * s, tmp[3];
  const float *dim = HUD_DIM;
  hudArc(h, cx, cy, R, -0.75f * PI_F, -0.25f * PI_F, t, dim);
  hudArc(h, cx, cy, R, 0.25f * PI_F, 0.75f * PI_F, t, dim);
  hudArc(h, cx, cy, R, 0.7f * PI_F, 1.3f * PI_F, t, dim);
  // Heat: filling upward, amber over 55, red over 80, flashing over 85. The reactor down: the arc goes dark and blinks.
  float heat = clampf(P->heat / 100, 0, 1); const float *hc = P->heat > 80 ? HUD_RED : P->heat > 55 ? HUD_AMBER : HUD_GREEN;
  if (P->heat > 85 && fmodf(G->time, 0.25f) < 0.12f) hc = HUD_WHITE;
  if (P->shutdown && fmodf(G->time, 0.6f) < 0.3f) hc = HUD_DIM;
  hudArc(h, cx, cy, R, -0.75f * PI_F, -0.75f * PI_F + 0.5f * PI_F * heat, t * 2.2f, hc);
  // Jets: how ready they are, filling upward; the charge over it.
  if (P->jets) {
    hudArc(h, cx, cy, R, 0.75f * PI_F, 0.75f * PI_F - 0.5f * PI_F * P->fuel, t * 2.2f, P->fuel >= 1 ? HUD_GREEN : HUD_DIM);
    if (P->jet.charge > 0) hudArc(h, cx, cy, R - 6 * s, 0.75f * PI_F, 0.75f * PI_F - 0.5f * PI_F * P->jet.charge, t * 1.6f, HUD_WHITE);
  }
  // Speed: reverse to full from left to right along the bottom (angles fall from 1.3 pi to 0.7 pi), a tick at zero, the throttle's notch outside it.
  float sp = clampf(P->speed / P->maxSpeed, -0.35f, 1), ang = (sp + 0.35f) / 1.35f, zero = 0.35f / 1.35f;
#define SPA(u) (1.3f * PI_F - 0.6f * PI_F * (u))
  if (ang > zero) hudArc(h, cx, cy, R, SPA(zero), SPA(ang), t * 2.2f, HUD_GREEN); else hudArc(h, cx, cy, R, SPA(ang), SPA(zero), t * 2.2f, HUD_AMBER);
  { float az = SPA(zero); hudLine(h, cx + sinf(az) * (R - 7 * s), cy - cosf(az) * (R - 7 * s), cx + sinf(az) * (R + 7 * s), cy - cosf(az) * (R + 7 * s), t, HUD_GREEN); }
  { float thr = (clampf(P->throttle, -0.35f, 1) + 0.35f) / 1.35f, at = SPA(thr); hudLine(h, cx + sinf(at) * (R + 5 * s), cy - cosf(at) * (R + 5 * s), cx + sinf(at) * (R + 12 * s), cy - cosf(at) * (R + 12 * s), t * 1.6f, HUD_AMBER); }
#undef SPA
  char b[24]; snprintf(b, sizeof b, "%d KPH", (int)(fabsf(P->speed) * 3.6f)); hudTextC(h, cx, cy + R + 16 * s, 2 * s, b, HUD_GREEN);
  // The damage diagram: torso, arms, legs, each by its armour.
  float u = R * 0.012f;
  hudRect(h, cx - 14 * u, cy - 30 * u, 28 * u, 32 * u, hpCol(P->hp[SEC_T] / P->max[SEC_T], G->time, tmp));
  hudRect(h, cx - 30 * u, cy - 26 * u, 12 * u, 30 * u, hpCol(P->hp[SEC_LA] / P->max[SEC_LA], G->time, tmp));
  hudRect(h, cx + 18 * u, cy - 26 * u, 12 * u, 30 * u, hpCol(P->hp[SEC_RA] / P->max[SEC_RA], G->time, tmp));
  hudRect(h, cx - 14 * u, cy + 6 * u, 12 * u, 34 * u, hpCol(P->hp[SEC_LL] / P->max[SEC_LL], G->time, tmp));
  hudRect(h, cx + 2 * u, cy + 6 * u, 12 * u, 34 * u, hpCol(P->hp[SEC_RL] / P->max[SEC_RL], G->time, tmp));
  if (P->heat > 85 && !P->shutdown) hudTextC(h, cx, cy - R - 18 * s, 2 * s, "HEAT", HUD_RED);
  if (P->shutdown) hudTextC(h, cx, cy - R - 18 * s, 2 * s, "SHUTDOWN", fmodf(G->time, 0.6f) < 0.3f ? HUD_RED : HUD_AMBER);
}
static void drawWeapons(Hud *h, const Game *G, float x, float y, float s) {
  const Mech *P = G->player; float px = 2 * s, row = 17 * s; int lastCat = -1; char b[40];
  const char *cats[CAT_N] = { "ENERGY  RT", "BALLISTIC  RB", "MISSILE  LT", "FUSION  LB" };
  for (int cat = 0; cat < CAT_N; cat++) for (int i = 0; i < P->nW; i++) {
    const Weapon *w = &P->w[i]; if (w->def->cat != cat) continue;
    if (cat != lastCat) { lastCat = cat; hudText(h, x, y, px, cats[cat], HUD_DIM); y += row; }
    int out = w->def->ammo && w->ammo <= 0; const float *c = w->dead || out ? HUD_RED : HUD_GREEN; if (w->dead) c = HUD_DIM;
    if (w->def->kind == WK_FUSION) {
      float p = P->fusion.on && P->fusion.mech ? minf(1, P->fusion.t / w->def->scan) : 0;
      snprintf(b, sizeof b, "%s", WEAPON_NAME[w->type]); hudText(h, x, y, px, b, w->cd > 0 ? HUD_DIM : P->fusion.mech ? HUD_WHITE : c);
      if (w->cd > 0) { snprintf(b, sizeof b, "%ds", (int)ceilf(w->cd)); hudText(h, x + 150 * s, y, px, b, HUD_DIM); }
      else if (p > 0) hudRect(h, x, y + 15 * s - 3 * s, 180 * s * p, 3 * s, HUD_WHITE);
    } else {
      hudText(h, x, y, px, WEAPON_NAME[w->type], c);
      if (w->def->ammo) { snprintf(b, sizeof b, "%d", w->ammo); hudText(h, x + 150 * s, y, px, b, c); }
      float cd = w->def->cd > 0 && w->def->kind != WK_BEAM ? 1 - clampf(w->cd / w->def->cd, 0, 1) : 1;
      if (cd < 1) hudRect(h, x, y + 15 * s - 3 * s, 180 * s * cd, 2 * s, HUD_DIM);
    }
    y += row;
  }
}
static void drawRadar(Hud *h, const Game *G, float cx, float cy, float R, float s) {
  const Mech *P = G->player; float yaw = viewYaw(P), range = RADAR_RANGE * WEATHER[G->weather].radar;
  hudArc(h, cx, cy, R, 0, TAU, 1.5f * s, HUD_DIM);
  float wedge[6] = { cx, cy, cx + sinf(-0.5f) * R, cy - cosf(-0.5f) * R, cx + sinf(0.5f) * R, cy - cosf(0.5f) * R }; hudPoly(h, wedge, 3, HUD_BLACK);
  hudLine(h, cx, cy, wedge[2], wedge[3], s, HUD_DIM); hudLine(h, cx, cy, wedge[4], wedge[5], s, HUD_DIM);
  hudRect(h, cx - 2 * s, cy - 2 * s, 4 * s, 4 * s, HUD_GREEN);
  for (int i = 0; i < G->nMechs; i++) {
    const Mech *m = &G->mechs[i]; if (m == P || !m->alive) continue;
    float dx = m->x - P->x, dz = m->z - P->z, d = hypot2(dx, dz); if (d > range) continue;
    float a = atan2f(dx, dz) - yaw, r = d / range * R, jx = P->scramble > 0 ? (rngNext((Rng *)&G->rng) - 0.5f) * 20 * s : 0;
    const float *c = m == G->target ? HUD_WHITE : m->team == 0 ? HUD_GREEN : HUD_RED;
    hudRect(h, cx + sinf(a) * r - 2.5f * s + jx, cy - cosf(a) * r - 2.5f * s, 5 * s, 5 * s, c);
  }
}
static void drawTarget(Hud *h, const Game *G, const m4 *vp, int w, int ht, float s) {
  const Mech *t = G->target, *P = G->player; if (!t || !t->alive || P->scramble > 0) return;
  v3 c = centerOf(t); float sx, sy; if (!project(vp, c, w, ht, &sx, &sy)) return;
  float rx, ry; v3 top = V3(t->x, t->y + t->geo->height * t->ch->scale, t->z); if (!project(vp, top, w, ht, &rx, &ry)) return;
  float R = maxf(14 * s, fabsf(sy - ry) * 0.75f), tmp[3]; const float *col = hpCol(t->hp[SEC_T] / t->max[SEC_T], G->time, tmp), tk = 2 * s;
  if (G->lockOn) { hudLine(h, sx, sy - R, sx + R, sy, tk, col); hudLine(h, sx + R, sy, sx, sy + R, tk, col); hudLine(h, sx, sy + R, sx - R, sy, tk, col); hudLine(h, sx - R, sy, sx, sy - R, tk, col); }
  else { float k = R * 0.4f; for (int i = 0; i < 4; i++) { float ox = i & 1 ? R : -R, oy = i & 2 ? R : -R; hudLine(h, sx + ox, sy + oy, sx + ox - (ox > 0 ? k : -k), sy + oy, tk, col); hudLine(h, sx + ox, sy + oy, sx + ox, sy + oy - (oy > 0 ? k : -k), tk, col); } }
  char b[24]; snprintf(b, sizeof b, "%d M", (int)vlen(vsub(c, G->eye))); hudTextC(h, sx, sy + R + 6 * s, 2 * s, b, col);
  if (G->lock) {   // the shell lead: where a BIG BOOMER fired now would meet it
    v3 lp = leadPoint(G->eye, t, WEAPONS[W_AC].speed); float lx, ly;
    if (project(vp, lp, w, ht, &lx, &ly)) { float d = 5 * s; hudLine(h, lx, ly - d, lx + d, ly, s, col); hudLine(h, lx + d, ly, lx, ly + d, s, col); hudLine(h, lx, ly + d, lx - d, ly, s, col); hudLine(h, lx - d, ly, lx, ly - d, s, col); }
  }
}
void drawHud(Hud *h, const Game *G, const m4 *vp, int w, int ht, const HudOpts *o) {
  const Mech *P = G->player; float s = o->hudScale * (ht / 800.f); if (s < 0.5f) s = 0.5f;
  float drop = (G->kick + (G->bobInit ? G->bob.x : 0)) * 2.5f * s;   // the HUD floats behind the camera drop
  float cx = w / 2.f, cy = ht / 2.f + drop;
  if (G->guide.on) {   // riding a volley: the nose camera
    hudTextC(h, cx, 40 * s, 3 * s, G->guide.n ? "MISSILE CAM" : "SIGNAL LOST", G->guide.n ? HUD_GREEN : HUD_RED);
    hudArc(h, cx, cy, 20 * s, 0, TAU, 2 * s, HUD_GREEN); hudBox(h, 0, 0, (float)w, (float)ht, 6 * s, HUD_DIM);
    return;
  }
  // The crosshair: four ticks and a dot; it holds still on a hit; an X when you land one.
  float r = 14 * s, g = 6 * s;
  hudLine(h, cx - r, cy, cx - g, cy, 2 * s, HUD_GREEN); hudLine(h, cx + g, cy, cx + r, cy, 2 * s, HUD_GREEN); hudLine(h, cx, cy - r, cx, cy - g, 2 * s, HUD_GREEN); hudLine(h, cx, cy + g, cx, cy + r, 2 * s, HUD_GREEN);
  hudRect(h, cx - s, cy - s, 2 * s, 2 * s, HUD_GREEN);
  if (G->hitMark > 0) { float k = 5 * s; hudLine(h, cx - k, cy - k, cx + k, cy + k, 2 * s, HUD_WHITE); hudLine(h, cx - k, cy + k, cx + k, cy - k, 2 * s, HUD_WHITE); }
  if (G->punchReady) hudTextC(h, cx, cy + 22 * s, 2 * s, "PUNCH", P->melee.on ? HUD_WHITE : HUD_AMBER);
  if (P->jet.charge > 0 && P->jet.on) hudTextC(h, cx, cy - 32 * s, 2 * s, "STOMP", HUD_WHITE);
  drawTarget(h, G, vp, w, ht, s);
  drawRing(h, G, 110 * s, ht - 125 * s + drop * 0.5f, 72 * s, s);
  drawWeapons(h, G, w - 215 * s, ht - 185 * s + drop * 0.5f, s);
  drawRadar(h, G, w - 75 * s, 80 * s, 55 * s, s);
  // The top line: what this is, how many are left, the clock, the heading.
  char b[64]; int left = 0; for (int i = 0; i < G->nMechs; i++) if (G->mechs[i].team != 0 && G->mechs[i].alive) left++;
  snprintf(b, sizeof b, "%s", G->def ? MISSION_NAME[G->def - MISSIONS] : "FREE PLAY"); hudText(h, 16 * s, 14 * s, 2 * s, b, HUD_DIM);
  snprintf(b, sizeof b, "ENEMIES %d", left); hudText(h, 16 * s, 32 * s, 2 * s, b, HUD_GREEN);
  snprintf(b, sizeof b, "%d:%02d", (int)G->time / 60, (int)G->time % 60); hudText(h, 16 * s, 50 * s, 2 * s, b, HUD_DIM);
  int hd = ((int)(-viewYaw(P) * 180 / PI_F) % 360 + 360) % 360; snprintf(b, sizeof b, "%03d", hd); hudTextC(h, cx, 14 * s, 2 * s, b, HUD_GREEN);
  for (int k = -3; k <= 3; k++) { float a = (hd + k * 15) - (hd % 15); float dx = (a - hd) * 4 * s; hudRect(h, cx + dx - s, 30 * s, 2 * s, ((int)a % 90 == 0 ? 8 : 4) * s, HUD_DIM); }
  if (G->target && G->target->alive) { float a = wrapA(atan2f(G->target->x - P->x, G->target->z - P->z) - viewYaw(P)) * 180 / PI_F; if (fabsf(a) < 50) hudRect(h, cx - a * 4 * s - 2 * s, 36 * s, 4 * s, 4 * s, HUD_RED); }
  // Messages: the cockpit voice and the rest, under the crosshair, the newest at the bottom.
  for (int i = 0; i < G->nMsgs; i++) { const Msg *m = &G->msgs[i]; if (m->t < 0.3f && fmodf(m->t, 0.1f) < 0.05f) continue; hudTextC(h, cx, cy + 60 * s + i * 16 * s, 2 * s, m->text, m->warn ? HUD_AMBER : HUD_GREEN); }
  if (o->showDebug) { snprintf(b, sizeof b, "%4.1f FPS  %d DRAWS  %d PARTS  %d SHOTS  %s", o->fps, o->draws, G->parts.n, G->nShots, o->padOn ? "PAD" : "KEYS"); hudText(h, 16 * s, 70 * s, 1.5f * s, b, HUD_DIM); }
  hudFlush(h, 1);
  // The flashes: a dithered sheet of red (damage) or white (the fusion discharge), never a blend.
  if (G->flash > 0.01f) { hudRect(h, 0, 0, (float)w, (float)ht, HUD_RED); hudFlush(h, clampf(G->flash * 0.5f, 0, 0.45f)); }
  if (G->whiteFlash > 0.01f) { hudRect(h, 0, 0, (float)w, (float)ht, HUD_WHITE); hudFlush(h, clampf(G->whiteFlash * 0.8f, 0, 0.7f)); }
  if (P->shutdown) { hudRect(h, 0, 0, (float)w, (float)ht, HUD_BLACK); hudFlush(h, 0.3f); }
}
