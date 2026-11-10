#include "platform/controls.h"
#include "sim/game.h"
static float curve(float v) { return signf(v) * v * v; }   // aim wants fine control near the centre and speed at the edge
void controlsToInput(const Raw *r, const ControlPrefs *pr, Input *in, float dt) {
  *in = noInput(); float inv = pr->invertY ? -1 : 1;
  // The pad.
  in->turn = -r->lx; in->thr = -r->ly;
  in->twist = -curve(r->rx) * pr->padSens; in->pitch = -curve(r->ry) * pr->padSens * inv;
  in->energy = r->held[PB_RT]; in->ballistic = r->held[PB_RB]; in->missile = r->held[PB_LT]; in->fusion = r->held[PB_LB];
  in->jets = r->held[PB_A]; in->centre = r->held[PB_B] || r->held[PB_P3];
  in->target = r->press[PB_X]; in->zoom = r->press[PB_Y]; in->stop = r->press[PB_DOWN] || r->press[PB_P4];
  in->punch = r->press[PB_RS] || r->press[PB_P1] || r->press[PB_P2];
  // The gyro: rad/s about the pad's axes. Held flat, yaw is the vertical axis (y) and pitch the sideways one (x).
  int gyroNow = r->gyroOn && (pr->gyroMode == 2 || (pr->gyroMode == 1 && r->padTouched[1]));
  if (gyroNow) { in->twistBy += r->gyro[1] * dt * pr->gyroSens; in->pitchBy += r->gyro[0] * dt * pr->gyroSens * inv; }
  // The keyboard and mouse, second.
  in->turn += (r->keyHeld[KEY_A] ? 1 : 0) - (r->keyHeld[KEY_D] ? 1 : 0);
  in->thr += (r->keyHeld[KEY_W] ? 1 : 0) - (r->keyHeld[KEY_S] ? 1 : 0);
  in->twist += (r->keyHeld[KEY_LEFT] ? 1 : 0) - (r->keyHeld[KEY_RIGHT] ? 1 : 0);
  in->pitch += (r->keyHeld[KEY_UP] ? 1 : 0) - (r->keyHeld[KEY_DOWN] ? 1 : 0);
  in->twistBy += -r->mdx * 0.0022f * pr->mouseSens; in->pitchBy += -r->mdy * 0.0022f * pr->mouseSens * inv;
  in->energy |= r->mbHeld[MB_L]; in->ballistic |= r->mbHeld[MB_R]; in->missile |= r->mbHeld[MB_M] || r->keyHeld[KEY_F]; in->fusion |= r->keyHeld[KEY_G];
  in->jets |= r->keyHeld[KEY_SPACE]; in->centre |= r->keyHeld[KEY_C];
  in->target |= r->keyPress[KEY_R]; in->zoom |= r->keyPress[KEY_Z]; in->stop |= r->keyPress[KEY_X]; in->punch |= r->keyPress[KEY_E] || r->mbPress[MB_4];
  in->turn = clampf(in->turn, -1, 1); in->thr = clampf(in->thr, -1, 1); in->twist = clampf(in->twist, -1, 1); in->pitch = clampf(in->pitch, -1, 1);
}
void controlsToMenu(const Raw *r, MenuPress *m) {
  static float lyWas, lxWas;
  m->up = r->press[PB_UP] || r->keyPress[KEY_UP] || r->keyPress[KEY_W] || (r->ly < -0.6f && lyWas >= -0.6f);
  m->down = r->press[PB_DOWN] || r->keyPress[KEY_DOWN] || r->keyPress[KEY_S] || (r->ly > 0.6f && lyWas <= 0.6f);
  m->left = r->press[PB_LEFT] || r->keyPress[KEY_LEFT] || r->keyPress[KEY_A] || (r->lx < -0.6f && lxWas >= -0.6f);
  m->right = r->press[PB_RIGHT] || r->keyPress[KEY_RIGHT] || r->keyPress[KEY_D] || (r->lx > 0.6f && lxWas <= 0.6f);
  m->accept = r->press[PB_A] || r->keyPress[KEY_RET] || r->keyPress[KEY_SPACE] || r->mbPress[MB_L];
  m->back = r->press[PB_B] || r->keyPress[KEY_ESC];
  m->pause = r->press[PB_START] || r->press[PB_BACK] || r->keyPress[KEY_ESC];
  m->debug = r->keyPress[KEY_F3] || (r->held[PB_BACK] && r->press[PB_Y]);
  m->any = r->anyKeyPress || r->padActive || r->mbPress[MB_L];
  lyWas = r->ly; lxWas = r->lx;
}
