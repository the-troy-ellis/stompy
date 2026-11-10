// Everything that makes a noise, synthesised: oscillator and filtered-noise
// voices for the one-shots, one sub-bass thump voice with a soft clipper, the
// continuous loops (reactor hum, jets, servo, beam, melt sizzle, fusion scan)
// through a bus that ducks under impacts. No samples yet (docs/roadmap.md:
// CC0 clips layer on top later). Positioned sounds pan by bearing and fade by
// distance, heard from the cockpit.
#ifndef AUDIO_H
#define AUDIO_H
#include "sim/game.h"
typedef struct Audio Audio;
Audio *audioInit(void);
void audioQuit(Audio *a);
void audioSetVolume(Audio *a, float v);
void audioListener(Audio *a, v3 ear, float yaw);
void audioSfx(Audio *a, int kind, const v3 *at, float p1, float p2);
void audioThump(Audio *a, float bass, float duck, const v3 *at);
void audioFusion(Audio *a, int on, float p);
void audioChirp(Audio *a);   // the cockpit voice's two-note blip under a line of text
void audioTick(Audio *a, const Game *G, int paused);   // the loops follow the state
void audioMenuClick(Audio *a);
#endif
