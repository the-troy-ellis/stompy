// A damped spring for squash, wobble, sag and the camera bob. Critically
// damped by default (zeta 1: no overshoot); lower zeta for a wobble that rings.
#ifndef SPRING_H
#define SPRING_H
typedef struct { float x, v, k, c; } Spring;
void springInit(Spring *s, float k, float zeta);
void springTune(Spring *s, float k, float zeta);
float springStep(Spring *s, float dt, float target);
static inline void springKick(Spring *s, float v) { s->v += v; }
#endif
