// The platform: an SDL2 window with a GL 3.3 context, the Deck's controller
// (sticks, triggers, bumpers, paddles, trackpads, gyro), a mouse and keyboard
// second, rumble, and the audio device. Everything SDL lives in src/platform.
#ifndef PLATFORM_H
#define PLATFORM_H
#include "sim/sim.h"

enum { PB_A, PB_B, PB_X, PB_Y, PB_LB, PB_RB, PB_BACK, PB_START, PB_LS, PB_RS, PB_UP, PB_DOWN, PB_LEFT, PB_RIGHT, PB_P1, PB_P2, PB_P3, PB_P4, PB_LT, PB_RT, PB_N };
enum { KEY_W, KEY_S, KEY_A, KEY_D, KEY_Q, KEY_E, KEY_C, KEY_R, KEY_Z, KEY_X, KEY_G, KEY_F, KEY_SPACE, KEY_ESC, KEY_RET, KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_TAB, KEY_F3, KEY_N };
enum { MB_L, MB_R, MB_M, MB_4, MB_5, MB_N };
// The raw state this frame: what is held, what went down this frame, the analog parts.
typedef struct {
  int padOn, held[PB_N], press[PB_N];
  float lx, ly, rx, ry, lt, rt;        // sticks (-1..1, dead zone applied), triggers (0..1)
  int gyroOn; float gyro[3];          // rad/s this frame, if the pad has one
  int padTouched[2];                   // a finger on the left and right trackpads
  int keyHeld[KEY_N], keyPress[KEY_N], mbHeld[MB_N], mbPress[MB_N];
  float mdx, mdy;                      // mouse motion this frame, pixels
  int anyKeyPress, mouseMoved, padActive;
} Raw;

typedef struct Platform Platform;
Platform *platInit(int w, int h, int fullscreen);
void platQuit(Platform *p);
void platPoll(Platform *p, Raw *raw, int *quit);   // the events of one frame into `raw`
void platSwap(Platform *p);
void platSize(Platform *p, int *w, int *h);
double platNow(void);                               // seconds
void platRumble(Platform *p, float low, float high, int ms);
void platRelativeMouse(Platform *p, int on);
int platHasGyro(Platform *p);
int platHasPad(Platform *p);
const char *platPadName(Platform *p);
void platWarp(Platform *p);
#endif
