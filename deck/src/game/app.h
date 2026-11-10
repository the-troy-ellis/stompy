// The game around the sim: the screens (menu, mission and mech pick, settings,
// pause, debrief), the locked 60 fps loop with its fixed sim step, the effects
// sink wired to the audio and the rumble, and the saved settings.
#ifndef APP_H
#define APP_H
typedef struct { int w, h, fullscreen, autoFree, shotFrames; const char *shotPath; int seed; float skip; int demo; const char *screen; int debug, mech; } AppArgs;
int appRun(const AppArgs *a);
#endif
