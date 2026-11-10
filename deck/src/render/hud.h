// The HUD and every menu: monospace green text and line work drawn as
// polygons (a 5x7 pixel font, each pixel a quad), in a 2D pass on top of the
// 3D view. Readable at a glance at arm's length: heat, damage, target and
// ammo without reading (docs/specs/13-thunk.md § The ring).
#ifndef HUD_H
#define HUD_H
#include "render/gl.h"
#include "sim/game.h"
typedef struct Hud Hud;
extern const float HUD_GREEN[3], HUD_AMBER[3], HUD_RED[3], HUD_DIM[3], HUD_WHITE[3], HUD_BLACK[3];
Hud *hudInit(void);
void hudBegin(Hud *h, int w, int h_);
void hudEnd(Hud *h);                           // draws the batch
void hudFlush(Hud *h, float dither);           // draws what is batched so far, dithered (1: solid)
void hudText(Hud *h, float x, float y, float px, const char *s, const float col[3]);
void hudTextC(Hud *h, float cx, float y, float px, const char *s, const float col[3]);   // centred
float hudTextW(float px, const char *s);
void hudRect(Hud *h, float x, float y, float w, float ht, const float col[3]);
void hudBox(Hud *h, float x, float y, float w, float ht, float t, const float col[3]);   // an outline
void hudLine(Hud *h, float x0, float y0, float x1, float y1, float t, const float col[3]);
void hudArc(Hud *h, float cx, float cy, float r, float a0, float a1, float t, const float col[3]);   // angles: 0 at the top, clockwise
void hudPoly(Hud *h, const float *xy, int n, const float col[3]);   // a convex fan
// The instruments for a match in play (also the debrief and pause draw over them).
typedef struct { float hudScale; int showDebug; float fps; int draws; int padOn; } HudOpts;
void drawHud(Hud *h, const Game *G, const m4 *vp, int w, int ht, const HudOpts *o);
int project(const m4 *vp, v3 p, int w, int ht, float *sx, float *sy);   // 0 when behind the camera
#endif
