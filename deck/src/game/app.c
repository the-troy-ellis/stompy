#include "game/app.h"
#include "sim/game.h"
#include "platform/platform.h"
#include "platform/controls.h"
#include "platform/audio.h"
#include "render/gl.h"
#include "render/scene.h"
#include "render/hud.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { SC_TITLE, SC_MAIN, SC_MISSIONS, SC_FREE, SC_MECH, SC_SETTINGS, SC_PLAY, SC_PAUSE, SC_DEBRIEF };
typedef struct {
  float padSens, mouseSens, gyroSens, fov, volume; int invertY, gyroMode, rumble, reducedMotion, hudScale, fullscreen, diff;
  int chassis, mission, biome, timeOfDay, foes, cleared;
} Prefs;
typedef struct {
  Platform *plat; Audio *audio; Scene *scene; Hud *hud; Game *G; Prefs prefs; Raw raw;
  int screen, sel, from; float t, spin; int w, h; double lastSaid[8]; char lastText[8][64]; double lastAny; int quit;
  int shotFrames; const char *shotPath; int frame; float fps; int debug; unsigned seed; int demo;
} App;
static App *A;

// --- settings on disk (a few key=value lines) ---------------------------------------------------
static const char *prefsPath(void) {
  static char p[512]; const char *x = getenv("XDG_CONFIG_HOME"), *home = getenv("HOME");
  if (x) snprintf(p, sizeof p, "%s/stompy-deck", x); else snprintf(p, sizeof p, "%s/.config/stompy-deck", home ? home : ".");
  return p;
}
static void prefsDefault(Prefs *p) { memset(p, 0, sizeof *p); p->padSens = 1; p->mouseSens = 1; p->gyroSens = 1; p->fov = 62; p->volume = 0.8f; p->gyroMode = 1; p->rumble = 1; p->hudScale = 1; p->fullscreen = 1; p->diff = DIFF_NORMAL; p->foes = 3; p->timeOfDay = TIME_DUSK; }
static void prefsLoad(Prefs *p) {
  prefsDefault(p); char path[600]; snprintf(path, sizeof path, "%s/settings.txt", prefsPath()); FILE *f = fopen(path, "r"); if (!f) return;
  char k[64]; float v;
  while (fscanf(f, "%63[^=]=%f\n", k, &v) == 2) {
#define L(name, field) if (!strcmp(k, name)) p->field = v;
    L("padSens", padSens) L("mouseSens", mouseSens) L("gyroSens", gyroSens) L("fov", fov) L("volume", volume) L("invertY", invertY) L("gyroMode", gyroMode) L("rumble", rumble) L("reducedMotion", reducedMotion)
    L("hudScale", hudScale) L("fullscreen", fullscreen) L("diff", diff) L("chassis", chassis) L("mission", mission) L("biome", biome) L("timeOfDay", timeOfDay) L("foes", foes) L("cleared", cleared)
#undef L
  }
  fclose(f);
}
static void prefsSave(const Prefs *p) {
  char cmd[700]; snprintf(cmd, sizeof cmd, "mkdir -p '%s'", prefsPath()); if (system(cmd) != 0) return;
  char path[600]; snprintf(path, sizeof path, "%s/settings.txt", prefsPath()); FILE *f = fopen(path, "w"); if (!f) return;
  fprintf(f, "padSens=%g\nmouseSens=%g\ngyroSens=%g\nfov=%g\nvolume=%g\ninvertY=%d\ngyroMode=%d\nrumble=%d\nreducedMotion=%d\nhudScale=%d\nfullscreen=%d\ndiff=%d\nchassis=%d\nmission=%d\nbiome=%d\ntimeOfDay=%d\nfoes=%d\ncleared=%d\n",
    p->padSens, p->mouseSens, p->gyroSens, p->fov, p->volume, p->invertY, p->gyroMode, p->rumble, p->reducedMotion, p->hudScale, p->fullscreen, p->diff, p->chassis, p->mission, p->biome, p->timeOfDay, p->foes, p->cleared);
  fclose(f);
}

// --- the effects sink: the sim's requests into sound, text and the pad's rumble --------------------
static void fxSay(void *u, const char *line, int force, float delayMs) {
  App *a = u; (void)delayMs; double now = platNow();
  int slot = -1; for (int i = 0; i < 8; i++) if (!strcmp(a->lastText[i], line)) slot = i;
  if (!force && ((slot >= 0 && now - a->lastSaid[slot] < 6) || now - a->lastAny < 1.2)) return;   // each line at most every 6 s, never on top of itself
  if (slot < 0) { slot = 0; for (int i = 1; i < 8; i++) if (a->lastSaid[i] < a->lastSaid[slot]) slot = i; snprintf(a->lastText[slot], 64, "%s", line); }
  a->lastSaid[slot] = now; a->lastAny = now;
  msg(a->G, line, strncmp(line, "Warning", 7) == 0);
  audioChirp(a->audio);
}
static void fxSfx(void *u, int k, const v3 *at, float p1, float p2) { App *a = u; audioSfx(a->audio, k, at, p1, p2); }
static void fxThump(void *u, float bass, float duck, float haptic, const v3 *at) {
  App *a = u; audioThump(a->audio, bass, duck, at);
  if (haptic > 2 && a->prefs.rumble) platRumble(a->plat, clampf(bass, 0, 1), clampf(haptic / 100, 0, 1) * 0.6f, (int)haptic);
}
static void fxFusion(void *u, int on, float p) { App *a = u; audioFusion(a->audio, on, p); }

// --- screens ---------------------------------------------------------------------------------------
static void click(App *a) { audioMenuClick(a->audio); if (a->prefs.rumble) platRumble(a->plat, 0.3f, 0, 30); }
static int playable(int i) { return MISSIONS[i].playable; }
static int unlocked(int ch) { return CHASSIS[ch].unlock <= A->prefs.cleared; }
static void startMission(App *a) {
  a->seed = (unsigned)platNow() * 7919u + 13;
  if (a->prefs.mission >= 0) startMatch(a->G, &MISSIONS[a->prefs.mission], (unsigned)MISSIONS[a->prefs.mission].seed, a->prefs.chassis, a->prefs.diff, 0);
  else startFreePlay(a->G, a->prefs.biome, a->prefs.timeOfDay, WX_CLEAR, a->prefs.foes, a->seed, a->prefs.chassis, a->prefs.diff, 0);
  a->G->reducedMotion = a->prefs.reducedMotion;
  a->screen = SC_PLAY; platRelativeMouse(a->plat, 1);
}
typedef struct { const char *label; char value[48]; } Row;
static void drawRows(App *a, const Row *rows, int n, float x, float y, float s, int sel) {
  for (int i = 0; i < n; i++) {
    const float *c = i == sel ? HUD_WHITE : HUD_GREEN; float yy = y + i * 24 * s;
    if (i == sel) hudText(a->hud, x - 20 * s, yy, 2.2f * s, ">", HUD_AMBER);
    hudText(a->hud, x, yy, 2.2f * s, rows[i].label, c);
    if (rows[i].value[0]) hudText(a->hud, x + 260 * s, yy, 2.2f * s, rows[i].value, c);
  }
}
static void nav(App *a, const MenuPress *mp, int n) { if (mp->up) { a->sel = (a->sel + n - 1) % n; click(a); } if (mp->down) { a->sel = (a->sel + 1) % n; click(a); } }
static void verdict(App *a, char *out, int n) {
  const Game *G = a->G;
  if (G->won) snprintf(out, n, "%s", G->stats.taken <= 0 ? VERDICT[VERDICT_UNTOUCHED] : G->hasLastKill && G->lastKillMelee ? VERDICT[VERDICT_PUNCHED] : VERDICT[VERDICT_WON]);
  else snprintf(out, n, "%s", G->death.shutdown && G->death.foeShutdown ? VERDICT[VERDICT_AWKWARD] : G->death.melee == 2 ? VERDICT[VERDICT_FLATTENED] : VERDICT[VERDICT_LOST]);
}
static void screens(App *a, const MenuPress *mp, float dt) {
  Hud *h = a->hud; float s = a->h / 800.f, cx = a->w / 2.f; char b[96]; Prefs *p = &a->prefs;
  a->t += dt; a->spin += dt * 0.35f;
  switch (a->screen) {
    case SC_TITLE:
      hudTextC(h, cx, 120 * s, 9 * s, "STOMPY", HUD_GREEN);
      hudTextC(h, cx, 200 * s, 2.5f * s, "BIG MECHS. THEY STOMP.", HUD_DIM);
      if (fmodf(a->t, 1) < 0.6f) hudTextC(h, cx, a->h - 90 * s, 2.5f * s, platHasPad(a->plat) ? "PRESS A" : "PRESS ENTER", HUD_AMBER);
      if (mp->accept || mp->any) { a->screen = SC_MAIN; a->sel = 0; click(a); }
      break;
    case SC_MAIN: {
      Row rows[4] = { { "CAMPAIGN", "" }, { "FREE PLAY", "" }, { "SETTINGS", "" }, { "QUIT", "" } };
      hudTextC(h, cx, 70 * s, 6 * s, "STOMPY", HUD_GREEN);
      drawRows(a, rows, 4, 80 * s, 200 * s, s, a->sel); nav(a, mp, 4);
      hudText(h, 80 * s, a->h - 60 * s, 1.8f * s, platPadName(a->plat), HUD_DIM);
      if (mp->accept) { click(a); if (a->sel == 0) { a->screen = SC_MISSIONS; a->sel = p->mission >= 0 ? p->mission : 0; } else if (a->sel == 1) { a->screen = SC_FREE; a->sel = 0; } else if (a->sel == 2) { a->screen = SC_SETTINGS; a->sel = 0; } else a->quit = 1; }
      break; }
    case SC_MISSIONS: {
      hudText(h, 80 * s, 70 * s, 3 * s, "ACT I", HUD_DIM);
      for (int i = 0; i < MISSION_N; i++) {
        float yy = 120 * s + i * 26 * s; int ok = playable(i), open = i <= p->cleared;
        const float *c = !ok || !open ? HUD_DIM : i == a->sel ? HUD_WHITE : HUD_GREEN;
        if (i == a->sel) hudText(h, 60 * s, yy, 2.2f * s, ">", HUD_AMBER);
        snprintf(b, sizeof b, "%d  %s%s", i + 1, MISSION_NAME[i], !ok ? "  (SOON)" : !open ? "  (LOCKED)" : i < p->cleared ? "  DONE" : ""); hudText(h, 80 * s, yy, 2.2f * s, b, c);
      }
      hudText(h, 80 * s, 260 * s, 2 * s, MISSIONS[a->sel].intel, HUD_GREEN);
      nav(a, mp, MISSION_N);
      if (mp->accept && playable(a->sel) && a->sel <= p->cleared) { click(a); p->mission = a->sel; a->screen = SC_MECH; a->sel = 0; for (int i = 0; i < CH_N; i++) if (MECH_ORDER[i] == p->chassis) a->sel = i; }
      if (mp->back) { a->screen = SC_MAIN; a->sel = 0; }
      break; }
    case SC_FREE: {
      Row rows[5] = { { "PLACE", "" }, { "TIME", "" }, { "ENEMIES", "" }, { "DIFFICULTY", "" }, { "GO", "" } };
      static const char *TIMES[4] = { "DAY", "DUSK", "NIGHT", "DAWN" };
      snprintf(rows[0].value, 48, "%s", PALS[p->biome].name); snprintf(rows[1].value, 48, "%s", TIMES[p->timeOfDay]); snprintf(rows[2].value, 48, "%d", p->foes); snprintf(rows[3].value, 48, "%s", DIFF_LABEL[p->diff]);
      for (int i = 0; i < 4; i++) for (char *q = rows[i].value; *q; q++) if (*q >= 'a' && *q <= 'z') *q -= 32;
      hudText(h, 80 * s, 70 * s, 3 * s, "FREE PLAY", HUD_DIM);
      drawRows(a, rows, 5, 80 * s, 140 * s, s, a->sel); nav(a, mp, 5);
      int d = mp->right - mp->left;
      if (d) { click(a); if (a->sel == 0) p->biome = (p->biome + PAL_N + d) % PAL_N; if (a->sel == 1) p->timeOfDay = (p->timeOfDay + 4 + d) % 4; if (a->sel == 2) p->foes = clampf(p->foes + d, 1, 8); if (a->sel == 3) p->diff = (p->diff + DIFF_N + d) % DIFF_N; }
      if (mp->accept && a->sel == 4) { click(a); p->mission = -1; a->screen = SC_MECH; a->sel = 0; for (int i = 0; i < CH_N; i++) if (MECH_ORDER[i] == p->chassis) a->sel = i; }
      if (mp->back) { a->screen = SC_MAIN; a->sel = 1; }
      break; }
    case SC_MECH: {
      int ch = MECH_ORDER[a->sel]; int open = unlocked(ch);
      hudText(h, 80 * s, 70 * s, 3 * s, "PICK A MECH", HUD_DIM);
      hudText(h, 80 * s, 120 * s, 4 * s, open ? CHASSIS_NAME[ch] : "LOCKED", open ? HUD_WHITE : HUD_RED);
      hudText(h, 80 * s, 170 * s, 2.2f * s, CHASSIS_ROLE[ch], HUD_GREEN);
      if (open) hudText(h, 80 * s, 200 * s, 1.8f * s, CHASSIS_KIT[ch], HUD_DIM); else { snprintf(b, sizeof b, "CLEAR MISSION %d", CHASSIS[ch].unlock); hudText(h, 80 * s, 200 * s, 1.8f * s, b, HUD_DIM); }
      snprintf(b, sizeof b, "%d T   %d KPH   %s", (int)CHASSIS[ch].tons, (int)(CHASSIS[ch].speed * 3.6f), CHASSIS[ch].jets ? "JETS" : "NO JETS"); hudText(h, 80 * s, 230 * s, 1.8f * s, b, HUD_DIM);
      hudTextC(h, cx, a->h - 60 * s, 2 * s, "LEFT / RIGHT PICK    A LAUNCH    B BACK", HUD_DIM);
      if (mp->left) { a->sel = (a->sel + CH_N - 1) % CH_N; click(a); } if (mp->right) { a->sel = (a->sel + 1) % CH_N; click(a); }
      if (mp->accept && open) { click(a); p->chassis = ch; if (!a->shotFrames) prefsSave(p); startMission(a); }
      if (mp->back) { a->screen = p->mission >= 0 ? SC_MISSIONS : SC_FREE; a->sel = 0; }
      break; }
    case SC_SETTINGS: {
      static const char *GYRO[3] = { "OFF", "RIGHT PAD", "ALWAYS" };
      Row rows[10] = { { "PAD SENS", "" }, { "GYRO", "" }, { "GYRO SENS", "" }, { "MOUSE SENS", "" }, { "INVERT Y", "" }, { "FOV", "" }, { "VOLUME", "" }, { "RUMBLE", "" }, { "REDUCED MOTION", "" }, { "FULLSCREEN", "" } };
      snprintf(rows[0].value, 48, "%.1fX", p->padSens); snprintf(rows[1].value, 48, "%s", GYRO[p->gyroMode]); snprintf(rows[2].value, 48, "%.1fX", p->gyroSens); snprintf(rows[3].value, 48, "%.1fX", p->mouseSens);
      snprintf(rows[4].value, 48, "%s", p->invertY ? "ON" : "OFF"); snprintf(rows[5].value, 48, "%d", (int)p->fov); snprintf(rows[6].value, 48, "%d%%", (int)(p->volume * 100 + 0.5f)); snprintf(rows[7].value, 48, "%s", p->rumble ? "ON" : "OFF");
      snprintf(rows[8].value, 48, "%s", p->reducedMotion ? "ON" : "OFF"); snprintf(rows[9].value, 48, "%s", p->fullscreen ? "ON (NEXT START)" : "OFF (NEXT START)");
      hudText(h, 80 * s, 70 * s, 3 * s, "SETTINGS", HUD_DIM);
      drawRows(a, rows, 10, 80 * s, 120 * s, s, a->sel); nav(a, mp, 10);
      int d = mp->right - mp->left;
      if (d) { click(a); switch (a->sel) {
        case 0: p->padSens = clampf(p->padSens + d * 0.1f, 0.3f, 2.5f); break; case 1: p->gyroMode = (p->gyroMode + 3 + d) % 3; break; case 2: p->gyroSens = clampf(p->gyroSens + d * 0.1f, 0.3f, 2.5f); break;
        case 3: p->mouseSens = clampf(p->mouseSens + d * 0.1f, 0.3f, 2.5f); break; case 4: p->invertY = !p->invertY; break; case 5: p->fov = clampf(p->fov + d * 5, 50, 95); break;
        case 6: p->volume = clampf(p->volume + d * 0.1f, 0, 1); audioSetVolume(a->audio, p->volume); break; case 7: p->rumble = !p->rumble; break; case 8: p->reducedMotion = !p->reducedMotion; break; case 9: p->fullscreen = !p->fullscreen; break; } }
      hudText(h, 80 * s, a->h - 60 * s, 1.8f * s, platHasGyro(a->plat) ? "GYRO FOUND" : "NO GYRO ON THIS PAD", HUD_DIM);
      if (mp->back || (mp->accept && 0)) { prefsSave(p); a->screen = SC_MAIN; a->sel = 2; }
      break; }
    case SC_PAUSE: {
      Row rows[3] = { { "RESUME", "" }, { "RESTART", "" }, { "MAIN MENU", "" } };
      hudRect(h, 0, 0, (float)a->w, (float)a->h, HUD_BLACK); hudFlush(h, 0.5f);
      hudTextC(h, cx, 160 * s, 4 * s, "PAUSED", HUD_GREEN);
      drawRows(a, rows, 3, cx - 100 * s, 260 * s, s, a->sel); nav(a, mp, 3);
      if (mp->accept) { click(a); if (a->sel == 0) { a->screen = SC_PLAY; platRelativeMouse(a->plat, 1); } else if (a->sel == 1) startMission(a); else { a->screen = SC_MAIN; a->sel = 0; } }
      if (mp->back || mp->pause) { a->screen = SC_PLAY; platRelativeMouse(a->plat, 1); }
      break; }
    case SC_DEBRIEF: {
      const Game *G = a->G; Row rows[3] = { { G->won && p->mission >= 0 && p->mission + 1 < MISSION_N ? "NEXT MISSION" : "AGAIN", "" }, { "REPLAY", "" }, { "MAIN MENU", "" } };
      hudRect(h, 0, 0, (float)a->w, (float)a->h, HUD_BLACK); hudFlush(h, 0.5f);
      verdict(a, b, sizeof b); hudTextC(h, cx, 120 * s, 6 * s, b, G->won ? HUD_GREEN : HUD_RED);
      snprintf(b, sizeof b, "KILLS %d   HITS %d / %d   DEALT %d   TAKEN %d   TIME %d:%02d", G->stats.kills, G->stats.hits, G->stats.shots, (int)G->stats.dealt, (int)G->stats.taken, (int)G->time / 60, (int)G->time % 60);
      hudTextC(h, cx, 210 * s, 2 * s, b, HUD_GREEN);
      if (G->farthestShove > 0) { snprintf(b, sizeof b, "FARTHEST SHOVE %d M", (int)(G->farthestShove / 2.5f)); hudTextC(h, cx, 240 * s, 2 * s, b, HUD_DIM); }
      drawRows(a, rows, 3, cx - 100 * s, 300 * s, s, a->sel); nav(a, mp, 3);
      if (mp->accept) { click(a);
        if (a->sel == 2) { a->screen = SC_MAIN; a->sel = 0; }
        else if (a->sel == 1) startMission(a);
        else { if (G->won && p->mission >= 0 && p->mission + 1 < MISSION_N) { p->mission++; if (!playable(p->mission)) { a->screen = SC_MISSIONS; a->sel = p->mission; break; } } startMission(a); } }
      break; }
    default: break;
  }
}
// A pilot for the tools' screenshots: walks at the nearest foe, aims the torso at it, fires what is in range.
static void demoPilot(Game *G, Input *in) {
  Mech *P = G->player, *t = NULL; float bd = 1e30f;
  for (int i = 0; i < G->nMechs; i++) { Mech *m = &G->mechs[i]; if (m == P || !m->alive) continue; float d = hypot2(m->x - P->x, m->z - P->z); if (d < bd) { bd = d; t = m; } }
  if (!t) return;
  G->target = t; v3 c = centerOf(t), e = G->eye; float want = atan2f(c.x - e.x, c.z - e.z), wp = atan2f(c.y - e.y, hypot2(c.x - e.x, c.z - e.z));
  in->turn = clampf(wrapA(want - P->yaw) * 2, -1, 1); in->thr = bd > 150 ? 0.6f : 0;
  in->twistBy = wrapA(want - viewYaw(P)) * 0.2f; in->pitchBy = (wp - P->pitch) * 0.2f;
  in->energy = bd < 400 && P->heat < 70; in->ballistic = bd < 500; in->missileTap = bd < 700 && fmodf(G->time, 5) < 0.02f;
}
// --- the loop ---------------------------------------------------------------------------------------
static void savePpm(const char *path, int w, int h, const unsigned char *rgb) {
  FILE *f = fopen(path, "wb"); if (!f) return; fprintf(f, "P6\n%d %d\n255\n", w, h);
  for (int y = h - 1; y >= 0; y--) fwrite(rgb + (size_t)y * w * 3, 1, (size_t)w * 3, f);
  fclose(f);
}
int appRun(const AppArgs *args) {
  App *a = calloc(1, sizeof *a); A = a; prefsLoad(&a->prefs);
  if (args->fullscreen >= 0) a->prefs.fullscreen = args->fullscreen;
  a->plat = platInit(args->w, args->h, a->prefs.fullscreen); if (!a->plat) return 1;
  if (!glrInit()) return 1;
  a->audio = audioInit(); audioSetVolume(a->audio, a->prefs.volume); a->scene = sceneInit(); a->hud = hudInit();
  a->G = calloc(1, sizeof *a->G);
  Fx fx = { a, fxSay, fxSfx, fxThump, fxFusion }; gameInit(a->G, fx, 1);
  a->screen = SC_TITLE; a->shotFrames = args->shotFrames; a->shotPath = args->shotPath;
  a->demo = args->demo; a->debug = args->debug;
  if (args->screen) { const char *n[] = { "title", "main", "missions", "free", "mech", "settings" }; for (int i = 0; i < 6; i++) if (!strcmp(args->screen, n[i])) a->screen = i; }
  if (args->mech >= 0) { a->sel = args->mech % CH_N; a->prefs.chassis = MECH_ORDER[a->sel]; }
  if (args->autoFree) {
    a->prefs.mission = -1; if (args->seed) a->seed = args->seed;
    startFreePlay(a->G, a->prefs.biome, a->prefs.timeOfDay, WX_CLEAR, a->prefs.foes, args->seed ? args->seed : 7, a->prefs.chassis, a->prefs.diff, 0); a->screen = SC_PLAY;
    for (float t = 0; t < args->skip; t += 1.f / 60) { Input in = noInput(); if (a->demo) demoPilot(a->G, &in); update(a->G, &in, 1.f / 60); }
  }
  double last = platNow(), acc = 0; const double STEP = 1.0 / 60;
  while (!a->quit) {
    int quit = 0; platPoll(a->plat, &a->raw, &quit); if (quit) break;
    platSize(a->plat, &a->w, &a->h);
    double now = platNow(), dt = now - last; last = now; if (dt > 0.1) dt = 0.1;   // a hitch never becomes a leap
    a->fps += ((float)(1 / maxf((float)dt, 1e-4f)) - a->fps) * 0.05f;
    MenuPress mp; controlsToMenu(&a->raw, &mp); if (mp.debug) a->debug = !a->debug;
    ControlPrefs cp = { a->prefs.padSens, a->prefs.mouseSens, a->prefs.gyroSens, a->prefs.invertY, a->prefs.gyroMode };
    Game *G = a->G; int playing = a->screen == SC_PLAY;
    if (playing) {
      if (mp.pause) { a->screen = SC_PAUSE; a->sel = 0; platRelativeMouse(a->plat, 0); playing = 0; }
      Input in; controlsToInput(&a->raw, &cp, &in, (float)dt);
      if (a->demo) demoPilot(G, &in);
      acc += dt; int n = 0;
      while (acc >= STEP && n < 4) { update(G, &in, (float)STEP); acc -= STEP; n++; in.punch = in.target = in.zoom = in.stop = in.missileTap = 0; in.twistBy = in.pitchBy = 0; }
      if (in.zoom) G->zoom = !G->zoom;
      if (G->state == ST_DEBRIEF) { a->screen = SC_DEBRIEF; a->sel = 0; platRelativeMouse(a->plat, 0); if (G->won && a->prefs.mission >= 0 && a->prefs.mission + 1 > a->prefs.cleared) { a->prefs.cleared = a->prefs.mission + 1; if (!a->shotFrames) prefsSave(&a->prefs); } }
      // Zoom is a toggle on Y.
      static int zoomWas; if (a->raw.press[PB_Y] || a->raw.keyPress[KEY_Z]) { if (!zoomWas) G->zoom = !G->zoom; zoomWas = 1; } else zoomWas = 0;
      audioListener(a->audio, G->eye, viewYaw(G->player));
      if (G->player->jet.charge > 0 && a->prefs.rumble) platRumble(a->plat, 0.15f * G->player->jet.charge, 0.1f, 40);
    } else acc = 0;
    audioTick(a->audio, G, a->screen != SC_PLAY && a->screen != SC_PAUSE && a->screen != SC_DEBRIEF);
    // Draw: the world (or the menu's turntable), then the HUD and the screen on top.
    m4 vp; int inMatch = a->screen == SC_PLAY || a->screen == SC_PAUSE || a->screen == SC_DEBRIEF;
    hudBegin(a->hud, a->w, a->h);
    if (inMatch) {
      SceneOpts so = { a->prefs.fov, a->w, a->h, NULL, 0, 0 }; sceneRender(a->scene, G, &so, &vp);
      HudOpts ho = { 1 + 0.25f * (a->prefs.hudScale - 1), a->debug, a->fps, glrDrawCalls(), platHasPad(a->plat) };
      if (G->player->alive || G->state != ST_DEBRIEF) drawHud(a->hud, G, &vp, a->w, a->h, &ho);
    } else {
      PalVariant pal; palAt(&pal, PAL_DUSK, TIME_DUSK);
      int ch = a->screen == SC_MECH ? MECH_ORDER[a->sel] : a->prefs.chassis;
      sceneMenuMech(a->scene, ch, a->spin, &pal, PAL_DUSK, a->w, a->h, &vp, a->screen == SC_MECH ? 0 : -1);
    }
    if (a->screen != SC_PLAY) screens(a, &mp, (float)dt);
    hudEnd(a->hud);
    platSwap(a->plat);
    a->frame++;
    if (a->shotFrames && a->frame >= a->shotFrames) { unsigned char *px = malloc((size_t)a->w * a->h * 3); glrReadPixels(a->w, a->h, px); savePpm(a->shotPath ? a->shotPath : "shot.ppm", a->w, a->h, px); free(px); break; }
  }
  if (!a->shotFrames) prefsSave(&a->prefs);   // a tool run leaves the settings alone
  audioQuit(a->audio); platQuit(a->plat);
  return 0;
}
