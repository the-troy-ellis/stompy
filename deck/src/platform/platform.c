#include "platform/platform.h"
#include <SDL.h>
#include <stdio.h>
#include <string.h>

struct Platform {
  SDL_Window *win; SDL_GLContext gl; SDL_GameController *pad; int gyro, touchpads, hasRumble;
  Uint32 rumbleUntil; float rumbleLow, rumbleHigh;
  float lastGyro[3];
};
static const int PAD_MAP[PB_N] = { SDL_CONTROLLER_BUTTON_A, SDL_CONTROLLER_BUTTON_B, SDL_CONTROLLER_BUTTON_X, SDL_CONTROLLER_BUTTON_Y, SDL_CONTROLLER_BUTTON_LEFTSHOULDER, SDL_CONTROLLER_BUTTON_RIGHTSHOULDER,
  SDL_CONTROLLER_BUTTON_BACK, SDL_CONTROLLER_BUTTON_START, SDL_CONTROLLER_BUTTON_LEFTSTICK, SDL_CONTROLLER_BUTTON_RIGHTSTICK, SDL_CONTROLLER_BUTTON_DPAD_UP, SDL_CONTROLLER_BUTTON_DPAD_DOWN,
  SDL_CONTROLLER_BUTTON_DPAD_LEFT, SDL_CONTROLLER_BUTTON_DPAD_RIGHT, SDL_CONTROLLER_BUTTON_PADDLE1, SDL_CONTROLLER_BUTTON_PADDLE2, SDL_CONTROLLER_BUTTON_PADDLE3, SDL_CONTROLLER_BUTTON_PADDLE4, -1, -1 };
static const SDL_Scancode KEY_MAP[KEY_N] = { SDL_SCANCODE_W, SDL_SCANCODE_S, SDL_SCANCODE_A, SDL_SCANCODE_D, SDL_SCANCODE_Q, SDL_SCANCODE_E, SDL_SCANCODE_C, SDL_SCANCODE_R, SDL_SCANCODE_Z, SDL_SCANCODE_X, SDL_SCANCODE_G, SDL_SCANCODE_F,
  SDL_SCANCODE_SPACE, SDL_SCANCODE_ESCAPE, SDL_SCANCODE_RETURN, SDL_SCANCODE_UP, SDL_SCANCODE_DOWN, SDL_SCANCODE_LEFT, SDL_SCANCODE_RIGHT, SDL_SCANCODE_TAB, SDL_SCANCODE_F3 };

static void openPad(Platform *p) {
  if (p->pad) return;
  for (int i = 0; i < SDL_NumJoysticks(); i++) {
    if (!SDL_IsGameController(i)) continue;
    p->pad = SDL_GameControllerOpen(i);
    if (!p->pad) continue;
    p->gyro = SDL_GameControllerHasSensor(p->pad, SDL_SENSOR_GYRO) && SDL_GameControllerSetSensorEnabled(p->pad, SDL_SENSOR_GYRO, SDL_TRUE) == 0;
    p->touchpads = SDL_GameControllerGetNumTouchpads(p->pad);
    p->hasRumble = SDL_GameControllerHasRumble(p->pad);
    printf("pad: %s (gyro %d, touchpads %d, rumble %d)\n", SDL_GameControllerName(p->pad), p->gyro, p->touchpads, p->hasRumble);
    return;
  }
}
Platform *platInit(int w, int h, int fullscreen) {
  SDL_SetHint(SDL_HINT_JOYSTICK_HIDAPI_STEAMDECK, "1");
  SDL_SetHint(SDL_HINT_GAMECONTROLLER_USE_BUTTON_LABELS, "0");
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER | SDL_INIT_AUDIO | SDL_INIT_TIMER) != 0) { fprintf(stderr, "SDL: %s\n", SDL_GetError()); return NULL; }
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1); SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
  Platform *p = calloc(1, sizeof *p);
  Uint32 flags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | (fullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);
  p->win = SDL_CreateWindow("Stompy", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, w, h, flags);
  if (!p->win) { fprintf(stderr, "window: %s\n", SDL_GetError()); return NULL; }
  p->gl = SDL_GL_CreateContext(p->win);
  if (!p->gl) { fprintf(stderr, "GL 3.3 context: %s\n", SDL_GetError()); return NULL; }
  SDL_GL_SetSwapInterval(1);   // the locked 60: vsync
  openPad(p);
  return p;
}
void platQuit(Platform *p) { if (!p) return; if (p->pad) SDL_GameControllerClose(p->pad); SDL_GL_DeleteContext(p->gl); SDL_DestroyWindow(p->win); SDL_Quit(); free(p); }
static float dead(float v) { return fabsf(v) < 0.08f ? 0 : v; }
// A stick with a round dead zone (worn sticks rest off centre), rescaled so just past it is just above zero.
static void stick(float x, float y, float *ox, float *oy) {
  const float DEAD = 0.2f; float m = hypot2(x, y);
  if (!(m > DEAD)) { *ox = 0; *oy = 0; return; }
  float k = minf(1, (m - DEAD) / (1 - DEAD)) / m; *ox = x * k; *oy = y * k;
}
void platPoll(Platform *p, Raw *raw, int *quit) {
  int heldWas[PB_N]; memcpy(heldWas, raw->held, sizeof heldWas);
  int keyWas[KEY_N]; memcpy(keyWas, raw->keyHeld, sizeof keyWas);
  int mbWas[MB_N]; memcpy(mbWas, raw->mbHeld, sizeof mbWas);
  memset(raw->press, 0, sizeof raw->press); memset(raw->keyPress, 0, sizeof raw->keyPress); memset(raw->mbPress, 0, sizeof raw->mbPress);
  raw->mdx = raw->mdy = 0; raw->anyKeyPress = 0; raw->mouseMoved = 0; raw->gyro[0] = raw->gyro[1] = raw->gyro[2] = 0;
  SDL_Event e;
  while (SDL_PollEvent(&e)) {
    switch (e.type) {
      case SDL_QUIT: *quit = 1; break;
      case SDL_CONTROLLERDEVICEADDED: openPad(p); break;
      case SDL_CONTROLLERDEVICEREMOVED: if (p->pad && e.cdevice.which == SDL_JoystickInstanceID(SDL_GameControllerGetJoystick(p->pad))) { SDL_GameControllerClose(p->pad); p->pad = NULL; openPad(p); } break;
      case SDL_MOUSEMOTION: raw->mdx += e.motion.xrel; raw->mdy += e.motion.yrel; raw->mouseMoved = 1; break;
      case SDL_KEYDOWN: if (!e.key.repeat) raw->anyKeyPress = 1; break;
      case SDL_CONTROLLERSENSORUPDATE: if (e.csensor.sensor == SDL_SENSOR_GYRO) { for (int i = 0; i < 3; i++) p->lastGyro[i] = e.csensor.data[i]; } break;
      default: break;
    }
  }
  const Uint8 *ks = SDL_GetKeyboardState(NULL);
  for (int i = 0; i < KEY_N; i++) { raw->keyHeld[i] = ks[KEY_MAP[i]] != 0; raw->keyPress[i] = raw->keyHeld[i] && !keyWas[i]; }
  Uint32 mb = SDL_GetMouseState(NULL, NULL);
  int mbm[MB_N] = { SDL_BUTTON_LMASK, SDL_BUTTON_RMASK, SDL_BUTTON_MMASK, SDL_BUTTON_X1MASK, SDL_BUTTON_X2MASK };
  for (int i = 0; i < MB_N; i++) { raw->mbHeld[i] = (mb & mbm[i]) != 0; raw->mbPress[i] = raw->mbHeld[i] && !mbWas[i]; }
  raw->padOn = p->pad != NULL; raw->gyroOn = p->pad && p->gyro; raw->padActive = 0;
  if (p->pad) {
    SDL_GameController *c = p->pad;
    for (int i = 0; i < PB_N; i++) { if (PAD_MAP[i] < 0) continue; raw->held[i] = SDL_GameControllerGetButton(c, PAD_MAP[i]) != 0; }
    raw->lt = SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_TRIGGERLEFT) / 32767.f; raw->rt = SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_TRIGGERRIGHT) / 32767.f;
    raw->held[PB_LT] = raw->lt > 0.35f; raw->held[PB_RT] = raw->rt > 0.35f;
    stick(SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_LEFTX) / 32767.f, SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_LEFTY) / 32767.f, &raw->lx, &raw->ly);
    stick(SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_RIGHTX) / 32767.f, SDL_GameControllerGetAxis(c, SDL_CONTROLLER_AXIS_RIGHTY) / 32767.f, &raw->rx, &raw->ry);
    for (int i = 0; i < PB_N; i++) { raw->press[i] = raw->held[i] && !heldWas[i]; if (raw->held[i]) raw->padActive = 1; }
    if (raw->lx || raw->ly || raw->rx || raw->ry) raw->padActive = 1;
    if (p->gyro) { for (int i = 0; i < 3; i++) raw->gyro[i] = p->lastGyro[i]; }
    for (int t = 0; t < 2; t++) { raw->padTouched[t] = 0; if (t < p->touchpads) { Uint8 st; float x, y, pr; if (SDL_GameControllerGetTouchpadFinger(c, t, 0, &st, &x, &y, &pr) == 0) raw->padTouched[t] = st != 0; } }
  } else { memset(raw->held, 0, sizeof raw->held); raw->lx = raw->ly = raw->rx = raw->ry = raw->lt = raw->rt = 0; }
  (void)dead;
  // Rumble: the strongest asked-for buzz wins until it runs out.
  if (p->pad && p->hasRumble && p->rumbleUntil && SDL_GetTicks() > p->rumbleUntil) { p->rumbleUntil = 0; p->rumbleLow = p->rumbleHigh = 0; SDL_GameControllerRumble(p->pad, 0, 0, 0); }
}
void platRumble(Platform *p, float low, float high, int ms) {
  if (!p->pad || !p->hasRumble || ms <= 0) return;
  Uint32 now = SDL_GetTicks(), until = now + ms;
  if (p->rumbleUntil > now && low < p->rumbleLow && high < p->rumbleHigh) return;
  p->rumbleLow = maxf(low, p->rumbleUntil > now ? p->rumbleLow : 0); p->rumbleHigh = maxf(high, p->rumbleUntil > now ? p->rumbleHigh : 0);
  p->rumbleUntil = until > p->rumbleUntil ? until : p->rumbleUntil;
  SDL_GameControllerRumble(p->pad, (Uint16)(clampf(p->rumbleLow, 0, 1) * 65535), (Uint16)(clampf(p->rumbleHigh, 0, 1) * 65535), (Uint32)(p->rumbleUntil - now));
}
void platSwap(Platform *p) { SDL_GL_SwapWindow(p->win); }
void platSize(Platform *p, int *w, int *h) { SDL_GL_GetDrawableSize(p->win, w, h); }
double platNow(void) { return SDL_GetPerformanceCounter() / (double)SDL_GetPerformanceFrequency(); }
void platRelativeMouse(Platform *p, int on) { (void)p; SDL_SetRelativeMouseMode(on ? SDL_TRUE : SDL_FALSE); }
int platHasGyro(Platform *p) { return p->pad && p->gyro; }
int platHasPad(Platform *p) { return p->pad != NULL; }
const char *platPadName(Platform *p) { return p->pad ? SDL_GameControllerName(p->pad) : "NO PAD"; }
void platWarp(Platform *p) { int w, h; SDL_GetWindowSize(p->win, &w, &h); SDL_WarpMouseInWindow(p->win, w / 2, h / 2); }
