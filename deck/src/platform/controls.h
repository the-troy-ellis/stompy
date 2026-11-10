// The raw state of the pad, keys and mouse into the sim's input snapshot and
// the menus' presses. Pure: no SDL here, so the mapping is testable.
//
// Steam Deck layout (docs/controls.md):
//   Left stick    legs: sideways turns, up and down nudges the throttle
//   Right stick   torso twist and pitch (and steers a guided volley)
//   Gyro          fine aim, while a finger rests on the right trackpad (GYRO setting)
//   RT energy, RB ballistic, LT missiles (tap fires, hold flies them), LB fusion
//   A jump (hold to charge, let go to blast off), B centre torso, X next target, Y zoom
//   R4 and L4 (upper paddles) punch, R5 centre torso, L5 full stop; right stick click punches too
//   D-pad down stop, Start pause, View (Back) pause
#ifndef CONTROLS_H
#define CONTROLS_H
#include "platform/platform.h"
typedef struct { float padSens, mouseSens, gyroSens; int invertY, gyroMode; } ControlPrefs;   // gyroMode: 0 off, 1 right pad touch, 2 always
typedef struct { int up, down, left, right, accept, back, pause, debug, any; } MenuPress;
void controlsToInput(const Raw *raw, const ControlPrefs *prefs, Input *in, float dt);
void controlsToMenu(const Raw *raw, MenuPress *mp);
#endif
